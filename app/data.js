/**
 * Everything the app reads from or writes to GitHub. Screens call these and
 * never touch the network themselves.
 *
 * Rules (see docs/DECISIONS.md):
 *  - every read goes through the Contents API so it is live and returns a sha;
 *  - every write sends the sha it loaded; a conflict re-reads and re-applies;
 *  - raw.githubusercontent.com is used only for images in PUBLIC repos (fast,
 *    cached, no token) and for the public gym catalog.
 */
import { GitHubRepo, isConflict, b64encodeBytes } from '../lib/github.js';
import { FILES, TEMPLATE, CATALOG, SYNC_PREFIXES } from '../lib/config.js';
import { toCSV } from '../lib/csv.js';
import { parseWellnessCSV, parseBucketsCSV } from '../lib/goals.js';
import { normaliseLog, sortLog } from '../lib/log.js';
import { applyGenericOverrides, serialiseGym, gymPathFor, GENERIC_ID, emptyOverrides } from '../lib/gyms.js';
import { planUpdate, changelogBetween } from '../lib/updater.js';
import { S, hasCfg } from './state.js';

export function connect() {
  S.repo = hasCfg() ? new GitHubRepo({ owner: S.cfg.user, repo: S.cfg.repo, token: S.cfg.token }) : null;
  S.repoPrivate = null;
  return S.repo;
}

function repo() { if (!S.repo) connect(); if (!S.repo) throw new Error('Set up GitHub in Settings first'); return S.repo; }

// ---------------------------------------------------------------- loading ----

export async function loadAll(onStatus) {
  const r = repo();
  S.loading = true;
  const status = onStatus || (() => {});
  try {
    status('Checking repository…');
    try { S.repoPrivate = !!(await r.info()).private; } catch (e) { if (e.status === 404) throw new Error('Repository not found — check username, repository and that the token can see it'); throw e; }
    status('Loading your data…');
    await Promise.all([loadGyms(), loadLog(), loadProfile(), loadPlan(), loadGoals(), loadWellness(), loadBuckets(), loadVersion()]);
    S.loaded = true;
  } finally { S.loading = false; }
}

export async function loadGyms() {
  const r = repo();
  const gyms = [];
  S.sha.gym = {};
  const [gen, local] = await Promise.all([r.getJSON(FILES.generic), r.getJSON(FILES.genericLocal)]);
  if (gen) {
    S.sha.gym[FILES.generic] = gen.sha;
    S.genericLocal = local ? local.data : null;
    S.sha.genericLocal = local ? local.sha : null;
    const g = applyGenericOverrides(gen.data, S.genericLocal);
    g._path = 'equipment/generic';
    gyms.push(g);
  }
  const dirs = await r.listDir(FILES.myGyms);
  const mine = await Promise.all(dirs.filter(d => d.type === 'dir').map(async d => {
    const p = `${FILES.myGyms}/${d.name}/gym.json`;
    try {
      const f = await r.getJSON(p);
      if (!f) return null;
      S.sha.gym[p] = f.sha;
      f.data._path = `${FILES.myGyms}/${d.name}`;
      if (!f.data.rooms) f.data.rooms = [];
      return f.data;
    } catch (e) { console.warn('gym', d.name, e); return null; }
  }));
  mine.filter(g => g && !g.removed).sort((a, b) => String(a.name).localeCompare(String(b.name))).forEach(g => gyms.push(g));
  S.gyms = gyms;
}

export async function loadLog() {
  const r = repo();
  const f = await r.getText(FILES.log);
  if (f) {
    let parsed = [];
    try { parsed = JSON.parse(f.text); } catch (e) { throw new Error('workout-log.json is not valid JSON'); }
    S.log = sortLog(normaliseLog(Array.isArray(parsed) ? parsed : []));
    S.sha.log = f.sha;
  } else { S.log = []; S.sha.log = null; }
  S.sha.csv = await r.shaOf(FILES.csv);
}

export async function loadProfile() {
  const f = await repo().getJSON(FILES.profile);
  S.profile = f ? (f.data || {}) : {};
  S.sha.profile = f ? f.sha : null;
}

export async function loadPlan() {
  try {
    const f = await repo().getJSON(FILES.plan);
    S.plan = f ? f.data : null; S.sha.plan = f ? f.sha : null;
  } catch (e) { console.warn('plan:', e); S.plan = null; S.sha.plan = null; }
}

export async function loadGoals() {
  const f = await repo().getJSON(FILES.goals);
  S.goals = f ? f.data : null; S.sha.goals = f ? f.sha : null;
}

export async function loadWellness() {
  const f = await repo().getText(FILES.wellness);
  S.wellness = f ? parseWellnessCSV(f.text) : [];
}

export async function loadBuckets() {
  const f = await repo().getText(FILES.buckets);
  S.buckets = f ? parseBucketsCSV(f.text) : {};
}

export async function loadVersion() {
  const f = await repo().getText(FILES.version);
  S.version = f ? f.text.trim() : null;
}

// ----------------------------------------------------------------- images ----

const _blobUrls = new Map();
/** URL for a machine image. Public repo: raw CDN URL. Private: fetched through the API into an object URL (cached). */
export async function imageUrl(gym, fileName) {
  if (!fileName || !S.repo) return null;
  const path = `${gym._path}/images/${fileName}`;
  if (S.repoPrivate === false) return S.repo.rawUrl(path);
  if (_blobUrls.has(path)) return _blobUrls.get(path);
  const p = (async () => {
    const bytes = await S.repo.getBytes(path);
    if (!bytes) return null;
    const url = URL.createObjectURL(new Blob([bytes], { type: 'image/jpeg' }));
    return url;
  })();
  _blobUrls.set(path, p);
  return p;
}
export function forgetImage(gym, fileName) { if (fileName) _blobUrls.delete(`${gym._path}/images/${fileName}`); }

// ------------------------------------------------------------------- log ------

/**
 * Apply a change to the log and write JSON + CSV. `apply(base) -> newLog`.
 * If GitHub reports the file moved underneath us (another device, the coach,
 * a Garmin Action), the log is re-read and the change re-applied once.
 */
export async function commitLog(apply, message) {
  const r = repo();
  let base = S.log;
  for (let attempt = 0; attempt < 2; attempt++) {
    const updated = sortLog(apply(base));
    try {
      const jr = await r.put(FILES.log, JSON.stringify(updated, null, 2) + '\n', S.sha.log, message || 'Update workout log');
      S.sha.log = jr.sha;
      S.log = updated;
      await writeCsv(updated);
      return updated;
    } catch (e) {
      if (attempt === 0 && isConflict(e)) {
        await loadLog();
        base = S.log;
        continue;
      }
      throw e;
    }
  }
}

async function writeCsv(entries) {
  const r = repo();
  const csv = toCSV(entries);
  try {
    const cr = await r.put(FILES.csv, csv, S.sha.csv, 'Update workout log CSV');
    S.sha.csv = cr.sha;
  } catch (e) {
    if (!isConflict(e)) throw e;
    S.sha.csv = await r.shaOf(FILES.csv);
    const cr = await r.put(FILES.csv, csv, S.sha.csv, 'Update workout log CSV');
    S.sha.csv = cr.sha;
  }
}

// ------------------------------------------------------------------ gyms ------

export async function saveGym(gym) {
  const r = repo();
  if (gym.id === GENERIC_ID) return saveGenericLocal();
  const path = `${gym._path}/gym.json`;
  const res = await r.putWithRetry(path, JSON.stringify(serialiseGym(gym), null, 2) + '\n', S.sha.gym[path] || null, `Update gym: ${gym.name}`);
  S.sha.gym[path] = res.sha;
}

/** Persist the user's changes to the read-only generic gym as generic.local.json. */
export async function saveGenericLocal() {
  const r = repo();
  const g = S.gyms.find(x => x.id === GENERIC_ID);
  if (!g) return;
  const ov = emptyOverrides();
  g.rooms.forEach(room => {
    if (room._local) ov.rooms.push({ id: room.id, name: room.name });
    room.machines.forEach(m => {
      if (m.hidden) ov.hidden.push(m.id);
      if (m._local) { const { _local, hidden, ...rest } = m; ov.machines.push({ roomId: room.id, ...rest }); }
    });
  });
  S.genericLocal = ov;
  const res = await r.putWithRetry(FILES.genericLocal, JSON.stringify(ov, null, 2) + '\n', S.sha.genericLocal, 'Update generic gym overrides');
  S.sha.genericLocal = res.sha;
}

export async function uploadImage(gym, fileName, base64) {
  const r = repo();
  const path = `${gym._path}/images/${fileName}`;
  const bytes = Uint8Array.from(atob(base64.replace(/\s/g, '')), c => c.charCodeAt(0));
  const sha = await r.shaOf(path);
  await r.put(path, bytes, sha, `Upload image ${fileName}`);
  forgetImage(gym, fileName);
}

export async function deleteGymFiles(gym) {
  // Removing a gym from the app does not delete its files (history is keyed by machine id; photos may be wanted again).
  return true;
}

// --------------------------------------------------------- profile/goals -----

export async function saveProfile(profile) {
  const res = await repo().putWithRetry(FILES.profile, JSON.stringify(profile, null, 2) + '\n', S.sha.profile, 'Update profile');
  S.sha.profile = res.sha; S.profile = profile;
}

export async function saveGoals(goals) {
  const res = await repo().putWithRetry(FILES.goals, JSON.stringify(goals, null, 2) + '\n', S.sha.goals, 'Update weekly goals');
  S.sha.goals = res.sha; S.goals = goals;
}

export async function dismissPlan() {
  if (S.sha.plan) {
    try { await repo().delete(FILES.plan, S.sha.plan, 'Dismiss workout plan'); }
    catch (e) { if (e.status !== 404) throw e; }
  }
  S.plan = null; S.sha.plan = null;
}

// ---------------------------------------------------------------- catalog ----

function catalogRaw(path) { return `https://raw.githubusercontent.com/${CATALOG.owner}/${CATALOG.repo}/${CATALOG.branch}/${path}`; }

export async function loadCatalog() {
  const r = await fetch(`${catalogRaw('index.json')}?t=${Date.now()}`);
  if (!r.ok) throw new Error(`Could not load catalog (HTTP ${r.status})`);
  S.catalog = await r.json();
  return S.catalog;
}

async function fetchBytes(url) {
  const r = await fetch(url);
  if (!r.ok) throw new Error(`Download failed (HTTP ${r.status})`);
  return new Uint8Array(await r.arrayBuffer());
}

/** Copy a catalog gym (gym.json + images) into the user's repo. onStatus(msg). */
export async function importCatalogGym(id, onStatus) {
  const r = repo();
  const c = ((S.catalog && S.catalog.gyms) || []).find(c => c.id === id);
  if (!c) throw new Error('Gym not in catalog');
  const status = onStatus || (() => {});
  const path = gymPathFor(id);
  status(`Reading ${c.name}…`);
  const gres = await fetch(`${catalogRaw(`gyms/${id}/gym.json`)}?t=${Date.now()}`);
  if (!gres.ok) throw new Error(`gym.json download failed (HTTP ${gres.status})`);
  const gd = await gres.json();
  const images = [];
  (gd.rooms || []).forEach(room => (room.machines || []).forEach(m => { if (m.image) images.push(m.image); }));
  const existing = {};
  (await r.listDir(`${path}/images`)).forEach(f => { existing[f.name] = f.sha; });
  for (let i = 0; i < images.length; i++) {
    status(`Importing ${c.name}…\nphoto ${i + 1} of ${images.length}`);
    const fn = images[i];
    const bytes = await fetchBytes(catalogRaw(`gyms/${id}/images/${encodeURIComponent(fn)}`));
    await r.put(`${path}/images/${fn}`, bytes, existing[fn] || null, `Import image ${fn}`);
    forgetImage({ _path: path }, fn);
  }
  status(`Importing ${c.name}…\nsaving gym`);
  gd.source = `${CATALOG.owner}/${CATALOG.repo}@${S.catalog.version || S.catalog.updated || 'main'}`;
  if (id === GENERIC_ID) {
    // the generic gym is template-managed; importing it just refreshes equipment/generic
    const sha = S.sha.gym[FILES.generic] || await r.shaOf(FILES.generic);
    const res = await r.put(FILES.generic, JSON.stringify(gd, null, 2) + '\n', sha, 'Import generic gym from catalog');
    S.sha.gym[FILES.generic] = res.sha;
  } else {
    const p = `${path}/gym.json`;
    const sha = S.sha.gym[p] || await r.shaOf(p);
    const res = await r.put(p, JSON.stringify(serialiseGym(gd), null, 2) + '\n', sha, `Import gym: ${gd.name}`);
    S.sha.gym[p] = res.sha;
  }
  await loadGyms();
}

// ---------------------------------------------------------------- updater ----

/**
 * Compare the user's repo with the template and (if `apply`) copy changed
 * app files across with the user's token. Returns { plan, changelog, templateVersion }.
 */
export async function checkTemplate(onStatus) {
  const r = repo();
  const status = onStatus || (() => {});
  status('Comparing with template…');
  const tpl = new GitHubRepo({ owner: TEMPLATE.owner, repo: TEMPLATE.repo, branch: TEMPLATE.branch, token: '' });
  const [tplTree, mineTree, verFile] = await Promise.all([tpl.tree(), r.tree(), tpl.getText('VERSION')]);
  const plan = planUpdate(tplTree, mineTree, SYNC_PREFIXES);
  const templateVersion = verFile ? verFile.text.trim() : null;
  let changelog = '';
  if (plan.all.includes('CHANGELOG.md') || templateVersion !== S.version) {
    const cl = await tpl.getText('CHANGELOG.md');
    if (cl) changelog = changelogBetween(cl.text, S.version || '0', templateVersion || '999');
  }
  return { plan, changelog, templateVersion, tpl, tplTree, mineTree };
}

export async function applyTemplate(check, onStatus) {
  const r = repo();
  const status = onStatus || (() => {});
  const { plan, tpl, mineTree } = check;
  let done = 0;
  for (const p of plan.all) {
    status(`Updating ${p} (${done + 1}/${plan.all.length})…`);
    const bytes = await tpl.getBytes(p);
    if (bytes == null) continue;
    await r.put(p, bytes, mineTree[p] || null, `Update ${p} from template`);
    done++;
  }
  return done;
}

/** Trigger the Garmin workflow (needs Actions: write on the token). */
export async function runGarminNow() {
  return repo().dispatch('garmin.yml', {});
}

export { b64encodeBytes };
