/**
 * Everything the app reads from or writes to GitHub. Screens call these and
 * never touch the network themselves. Rules (docs/DECISIONS.md):
 *  - reads go through the Contents API (live, returns the sha a write needs);
 *  - single files are written with the sha they were loaded with, and on a
 *    conflict re-read and written again;
 *  - the log is written as one commit (lib/logstore.js);
 *  - raw.githubusercontent.com is used only for images (display) and the
 *    public gym catalog.
 */
import { GitHubRepo, isConflict } from '../lib/github.js';
import { loadLog as loadLogAt, commitLog as commitLogFiles } from '../lib/logstore.js';
import { FILES, CATALOG, TEMPLATE } from '../lib/config.js';
import { sortLog } from '../lib/log.js';
import { applyGenericOverrides, genericOverridesFrom, serialiseGym, gymPathFor, GENERIC_ID } from '../lib/gyms.js';
import { parseWellnessCSV, parseBucketsCSV } from '../lib/goals.js';
import { convertGym } from '../lib/migrate.js';
import { S, hasCfg } from './state.js';

export function connect() {
  S.repo = hasCfg() ? new GitHubRepo({ owner: S.cfg.user, repo: S.cfg.repo, token: S.cfg.token }) : null;
  return S.repo;
}

function repo() {
  if (!S.repo) connect();
  if (!S.repo) throw new Error('Set up GitHub in Settings first');
  return S.repo;
}

const json = v => JSON.stringify(v, null, 2) + '\n';

// ---------------------------------------------------------------- loading ----

export async function loadAll(onStatus = () => {}) {
  const r = repo();
  S.loading = true;
  try {
    onStatus('Checking repository…');
    try { await r.info(); } catch (e) {
      if (e.status === 404) throw new Error('Repository not found. Check the username and repository, and that the token can see it.');
      if (e.status === 401) throw new Error('GitHub did not accept the token. Check it in Settings.');
      throw e;
    }
    onStatus('Loading your data…');
    await Promise.all([loadGyms(), loadLog(), loadProfile(), loadPlan(), loadGoals(), loadVersion(), loadWellness(), loadBuckets()]);
    S.loaded = true;
  } finally { S.loading = false; }
}

export async function loadGyms() {
  const r = repo();
  const gyms = [];
  S.sha.gym = {};
  const [gen, local] = await Promise.all([r.getJSON(FILES.generic), r.getJSON(FILES.genericLocal)]);
  S.genericLocal = local ? local.data : null;
  S.sha.genericLocal = local ? local.sha : null;
  if (gen) {
    S.sha.gym[FILES.generic] = gen.sha;
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
      return { rooms: [], ...f.data, _path: `${FILES.myGyms}/${d.name}` };
    } catch (e) { console.warn('gym', d.name, e); return null; }
  }));
  mine.filter(g => g && !g.removed).sort((a, b) => String(a.name).localeCompare(String(b.name))).forEach(g => gyms.push(g));
  S.gyms = gyms;
}

/** True when a log still holds version 1 entries (LogTrim / 0.1.0 field names). */
export const isOldFormat = log => log.some(e => e && ('machineId' in e || 'datetime' in e || 'gymId' in e));

export async function loadLog() {
  const { log } = await loadLogAt(repo());
  S.oldFormat = isOldFormat(log);
  S.log = sortLog(log);
}

export async function loadProfile() {
  const f = await repo().getJSON(FILES.profile);
  S.profile = f ? f.data || {} : {};
  S.sha.profile = f ? f.sha : null;
}

export async function loadPlan() {
  try {
    const f = await repo().getJSON(FILES.plan);
    S.plan = f ? f.data : null;
    S.sha.plan = f ? f.sha : null;
  } catch (e) { console.warn('plan:', e); S.plan = null; S.sha.plan = null; }
}

export async function loadGoals() {
  try {
    const f = await repo().getJSON(FILES.goals);
    S.goals = f ? f.data : null;
    S.sha.goals = f ? f.sha : null;
  } catch (e) { console.warn('goals:', e); S.goals = null; }
}

/** Garmin outputs are optional and only displayed; a missing or unreadable file just means no data. */
export async function loadWellness() {
  try { const f = await repo().getText(FILES.wellness); S.wellness = f ? parseWellnessCSV(f.text) : []; }
  catch (e) { console.warn('wellness:', e); S.wellness = []; }
}

export async function loadBuckets() {
  try { const f = await repo().getText(FILES.buckets); S.buckets = f ? parseBucketsCSV(f.text) : {}; }
  catch (e) { console.warn('buckets:', e); S.buckets = {}; }
}

export async function loadVersion() {
  const f = await repo().getText(FILES.version);
  S.version = f ? f.text.trim() : null;
}

// ----------------------------------------------------------------- images ----

const localImages = new Map(); // path -> object URL, for photos uploaded this session (raw URLs lag ~5 min)

/** URL for a machine image. Repos are public, so the raw URL works; fresh uploads use a local copy. */
export function imageUrl(gym, file) {
  if (!file || !gym || !S.repo) return null;
  const path = `${gym._path}/images/${file}`;
  return localImages.get(path) || S.repo.rawUrl(path);
}

// -------------------------------------------------------------------- log ----

/**
 * Apply a change to the log and commit JSON + CSV together. `apply(log)` must
 * work from the log it is given: after a conflict it runs again on a fresh copy.
 */
export async function commitLog(apply, message) {
  if (S.oldFormat) throw new Error('This repository still has data in the old format. It must be migrated before the new app can save.');
  const res = await commitLogFiles(repo(), log => apply(log), message);
  if (res) S.log = sortLog(res.log);
  return S.log;
}

// ------------------------------------------------------------ single files ---

/** Write one JSON file with the sha it was loaded with; on a conflict, re-read the sha and write again. */
async function putJSON(path, data, sha, message) {
  const r = repo();
  try { return await r.putFile(path, json(data), sha, message); }
  catch (e) {
    if (!isConflict(e)) throw e;
    const cur = await r.getText(path);
    return r.putFile(path, json(data), cur ? cur.sha : null, message);
  }
}

export async function saveGym(gym) {
  if (gym.id === GENERIC_ID) return saveGenericLocal(gym);
  const path = `${gym._path}/gym.json`;
  S.sha.gym[path] = await putJSON(path, serialiseGym(gym), S.sha.gym[path] || null, `Update gym: ${gym.name}`);
}

export async function saveGenericLocal(gym) {
  const ov = genericOverridesFrom(gym);
  S.sha.genericLocal = await putJSON(FILES.genericLocal, ov, S.sha.genericLocal, 'Update my changes to the common gym');
  S.genericLocal = ov;
}

export async function saveProfile(profile) {
  S.sha.profile = await putJSON(FILES.profile, profile, S.sha.profile, 'Update profile');
  S.profile = profile;
}

export async function saveGoals(goals) {
  S.sha.goals = await putJSON(FILES.goals, goals, S.sha.goals, 'Update weekly goals');
  S.goals = goals;
}

/** Remove today's plan file. */
export async function dismissPlan() {
  const r = repo();
  const cur = await r.getText(FILES.plan);
  if (cur) await r.deleteFile(FILES.plan, cur.sha, 'Dismiss workout plan');
  S.plan = null; S.sha.plan = null;
}

// ----------------------------------------------------------------- photos ----

/** Upload a JPEG (base64) as a gym image. Shown from a local copy this session, since raw URLs lag behind. */
export async function uploadImage(gym, file, base64) {
  const r = repo();
  const path = `${gym._path}/images/${file}`;
  const bytes = Uint8Array.from(atob(base64.replace(/\s/g, '')), c => c.charCodeAt(0));
  const cur = await r.listDir(`${gym._path}/images`);
  const existing = cur.find(f => f.name === file);
  await r.putFile(path, bytes, existing ? existing.sha : null, `Upload image ${file}`);
  localImages.set(path, URL.createObjectURL(new Blob([bytes], { type: 'image/jpeg' })));
}

// ---------------------------------------------------------------- catalog ----

const catalogRaw = p => `https://raw.githubusercontent.com/${CATALOG.owner}/${CATALOG.repo}/${CATALOG.branch}/${p.split('/').map(encodeURIComponent).join('/')}`;

/** The public catalog's index (read-only, no token needed). */
export async function loadCatalog() {
  const res = await fetch(catalogRaw('index.json'), { cache: 'no-store' });
  if (!res.ok) throw new Error(`Could not load the catalog (HTTP ${res.status})`);
  S.catalog = await res.json();
  return S.catalog;
}

/**
 * Copy a catalog gym (gym.json + photos) into the user's repo. The catalog
 * is in format version 1, so gym.json is converted. onStatus(message).
 */
export async function importCatalogGym(id, onStatus = () => {}) {
  const r = repo();
  const c = ((S.catalog && S.catalog.gyms) || []).find(x => x.id === id);
  if (!c) throw new Error('That gym is not in the catalog');
  if (id === GENERIC_ID) throw new Error('The common gym comes with the app and is updated with it');
  const path = gymPathFor(id);
  onStatus(`Reading ${c.name}…`);
  const gres = await fetch(catalogRaw(`gyms/${id}/gym.json`), { cache: 'no-store' });
  if (!gres.ok) throw new Error(`gym.json download failed (HTTP ${gres.status})`);
  const gym = convertGym(await gres.json());
  const images = [...new Set(gym.rooms.flatMap(room => room.machines.map(m => m.image).filter(Boolean)))];
  const have = Object.fromEntries((await r.listDir(`${path}/images`)).map(f => [f.name, f.sha]));
  for (const [i, file] of images.entries()) {
    onStatus(`Importing ${c.name}…\nphoto ${i + 1} of ${images.length}`);
    const res = await fetch(catalogRaw(`gyms/${id}/images/${file}`));
    if (!res.ok) { console.warn('catalog image missing:', file); continue; }
    const bytes = new Uint8Array(await res.arrayBuffer());
    await r.putFile(`${path}/images/${file}`, bytes, have[file] || null, `Import image ${file}`);
    localImages.set(`${path}/images/${file}`, URL.createObjectURL(new Blob([bytes], { type: 'image/jpeg' })));
  }
  onStatus(`Importing ${c.name}…\nsaving gym`);
  gym.source = `${CATALOG.owner}/${CATALOG.repo}@${S.catalog.version || 'main'}`;
  delete gym.removed;
  const p = `${path}/gym.json`;
  const cur = await r.getText(p);
  S.sha.gym[p] = await r.putFile(p, json(serialiseGym(gym)), cur ? cur.sha : null, `Import gym: ${gym.name}`);
  await loadGyms();
}

/** Start the Garmin workflow (needs Actions: read & write on the token). */
export const runGarminNow = () => repo().dispatch('garmin.yml', {});

// ---------------------------------------------------------------- updater ----
import { checkForUpdate, applyUpdate, templateRepo } from '../lib/updater.js';

/** Compare this repo with the template: { plan, templateVersion, changelog }. */
export const checkTemplate = () => checkForUpdate(templateRepo(), repo(), S.version);

/** Copy the changed app files in one commit. Returns how many files. */
export function applyTemplate(check, onStatus) {
  // Raw downloads at the pinned template commit: exact, and not subject to the
  // 60-requests-an-hour limit on unauthenticated API calls.
  const download = async p => {
    const res = await fetch(`https://raw.githubusercontent.com/${TEMPLATE.owner}/${TEMPLATE.repo}/${check.templateHead}/${p.split('/').map(encodeURIComponent).join('/')}`);
    if (!res.ok) throw new Error(`Could not download ${p} (HTTP ${res.status})`);
    return new Uint8Array(await res.arrayBuffer());
  };
  return applyUpdate(templateRepo(), repo(), check, onStatus, { download });
}
