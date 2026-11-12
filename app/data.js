/**
 * Everything the app reads from or writes to GitHub. Screens call these and
 * never touch the network themselves. Rules (docs/DECISIONS.md):
 *  - the app opens from the copy of the repo's files kept on this device
 *    (lib/snapshot.js, app/devicestore.js), then asks GitHub for the branch
 *    head; if it moved, the head's tree gives every file's blob sha and only
 *    the files that changed are downloaded (raw text, by blob sha);
 *  - single files are written with the sha they were loaded with, and on a
 *    conflict re-read and written again;
 *  - the log is one file per month (lib/months.js); log changes are shown at
 *    once, kept on the device and sent in the background (lib/outbox.js); each
 *    send is one commit of the changed months only (lib/logstore.js), from a
 *    cached copy of the months that have not changed since the last load or save;
 *  - a repo whose log is still one file (workout-log.json) is shown, but
 *    saving is off until it is split (scripts/split-log.mjs);
 *  - raw.githubusercontent.com is used only for images (display) and the
 *    public gym catalog.
 */
import { GitHubRepo, isConflict } from '../lib/github.js';
import { commitLog as commitLogFiles, newLogCache, primeLogCache } from '../lib/logstore.js';
import { logLayout } from '../lib/months.js';
import { FILES, CATALOG, TEMPLATE, STORAGE } from '../lib/config.js';
import { createOutbox, createSyncer, mergeOp, removeOp, moveOp, applyOp, applyOps, batchMessage } from '../lib/outbox.js';
import { sortLog } from '../lib/log.js';
import { applyGenericOverrides, genericOverridesFrom, serialiseGym, gymPathFor, GENERIC_ID } from '../lib/gyms.js';
import { parseWellnessCSV, parseBucketsCSV } from '../lib/goals.js';
import { convertGym } from '../lib/migrate.js';
import { validSnapshot, toDownload, nextFiles, changedPaths, makeSnapshot, withFile, withLogSave } from '../lib/snapshot.js';
import { readSnapshot, writeSnapshot } from './devicestore.js';
import { S, hasCfg } from './state.js';

// The log's month files as stored, at a known commit (lib/logstore.js). Every
// load refreshes it; a save downloads only months that changed meanwhile.
const logCache = newLogCache();

// The files S was built from (lib/snapshot.js), as kept on the device.
let snap = null;
// Bumped after every background log save, so a load that was running at the
// same time does not put the older log back on screen.
let saves = 0;

// Unsent log changes for the connected repo, and the background sender.
let outbox = null, syncer = null;
const syncListeners = new Set();
S.sync = { pending: 0, sending: false, error: null, failures: 0 };

function storage() { try { return globalThis.localStorage || null; } catch { return null; } }
const repoKey = () => `${S.cfg.user}/${S.cfg.repo}`.toLowerCase();

function keep(next) {
  snap = next;
  if (snap && S.repo) writeSnapshot(repoKey(), snap);
}

export function connect() {
  Object.assign(logCache, newLogCache());
  snap = null;
  S.repo = hasCfg() ? new GitHubRepo({ owner: S.cfg.user, repo: S.cfg.repo, token: S.cfg.token }) : null;
  outbox = syncer = null;
  S.lastSyncError = readLastError();
  if (S.repo) {
    const r = S.repo;
    outbox = createOutbox(storage(), `${STORAGE.outbox}:${S.cfg.user}/${S.cfg.repo}`.toLowerCase());
    syncer = createSyncer({
      outbox,
      commit: ops => commitLogFiles(r, log => applyOps(log, ops), batchMessage(ops), { cache: logCache }),
      // What GitHub now holds, plus anything queued meanwhile: other writers' rows appear too.
      onSent: (res, remaining) => {
        if (!res || r !== S.repo) return;
        saves++;
        S.log = sortLog(applyOps(res.log, remaining));
        if (snap) keep(withLogSave(snap, res));
      },
      onChange: st => { if (r === S.repo) setSync(st); }
    });
  }
  setSync(syncer ? syncer.status() : { pending: 0, sending: false, error: null, failures: 0 });
  return S.repo;
}

function setSync(st) {
  S.sync = st;
  if (st.error && st.error !== lastErr) rememberError(st.error);
  lastErr = st.error;
  syncListeners.forEach(fn => { try { fn(st); } catch (e) { console.error(e); } });
}

// The last background-save error, kept on the device for Settings (diagnosis).
const errKey = () => `${STORAGE.lastError}:${repoKey()}`;
function readLastError() {
  try { const v = JSON.parse(storage().getItem(errKey()) || 'null'); return v && v.message ? v : null; } catch { return null; }
}
let lastErr = null;
function rememberError(e) {
  const v = { message: String(e.message || e), status: e.status || null, name: e.name || null, at: new Date().toISOString() };
  S.lastSyncError = v;
  try { storage().setItem(errKey(), JSON.stringify(v)); } catch { /* storage unavailable */ }
}

/** Call fn(status) whenever the background save status changes: { pending, sending, error, failures }. */
export function onSync(fn) { syncListeners.add(fn); fn(S.sync); }

/** Send unsent log changes now (also retries after a failure). */
export function syncNow() { return syncer ? syncer.flush() : Promise.resolve(); }

function repo() {
  if (!S.repo) connect();
  if (!S.repo) throw new Error('Set up GitHub in Settings first');
  return S.repo;
}

const json = v => JSON.stringify(v, null, 2) + '\n';

// ---------------------------------------------------------------- loading ----

const isLogPath = p => p === FILES.legacyLog || p.startsWith(`${FILES.logDir}/`);

/** True when a log still holds version 1 entries (LogTrim / 0.1.0 field names). */
export const isOldFormat = log => log.some(e => e && ('machineId' in e || 'datetime' in e || 'gymId' in e));

/** A JSON file's data, or `fallback` when it is absent or (with `tolerant`) unreadable. */
function jsonOf(files, path, fallback, tolerant) {
  const f = files[path];
  if (!f) return fallback;
  try { return JSON.parse(f.text); } catch (e) {
    if (!tolerant) throw new Error(`${path} is not valid JSON: ${e.message}`);
    console.warn(path, e);
    return fallback;
  }
}

/** Build the app state from a set of files ({ path: { sha, text } }). `withLog` false keeps the log on screen. */
function applyFiles(files, { head, tree, withLog = true, legacyToo = false } = {}) {
  // gyms: the common gym with the user's changes, then the user's own gyms by name
  const gyms = [];
  const shaGym = {};
  const gen = jsonOf(files, FILES.generic, null);
  const local = jsonOf(files, FILES.genericLocal, null);
  if (gen) {
    shaGym[FILES.generic] = files[FILES.generic].sha;
    gyms.push({ ...applyGenericOverrides(gen, local), _path: 'equipment/generic' });
  }
  const mine = [];
  for (const p of Object.keys(files).filter(p => p.startsWith(`${FILES.myGyms}/`))) {
    const g = jsonOf(files, p, null, true);
    if (!g) continue;
    shaGym[p] = files[p].sha;
    mine.push({ rooms: [], ...g, _path: p.slice(0, -'/gym.json'.length) });
  }
  mine.filter(g => !g.removed).sort((a, b) => String(a.name).localeCompare(String(b.name))).forEach(g => gyms.push(g));

  const sha = p => (files[p] ? files[p].sha : null);
  const csv = (p, parse, empty) => { try { return files[p] ? parse(files[p].text) : empty; } catch (e) { console.warn(p, e); return empty; } };
  const profile = jsonOf(files, FILES.profile, {});
  let log = null;
  // The log: the month files (or the old single file, until it is split). Parsed into a scratch cache first.
  const scratch = newLogCache();
  if (withLog) log = primeLogCache(scratch, { head, tree, files });

  // Everything parsed: now replace the state.
  S.gyms = gyms;
  S.genericLocal = local;
  S.sha.genericLocal = sha(FILES.genericLocal);
  S.sha.gym = shaGym;
  S.profile = profile || {};
  S.sha.profile = sha(FILES.profile);
  S.plan = jsonOf(files, FILES.plan, null, true);
  S.sha.plan = S.plan ? sha(FILES.plan) : null;
  S.goals = jsonOf(files, FILES.goals, null, true);
  S.sha.goals = sha(FILES.goals);
  S.wellness = csv(FILES.wellness, parseWellnessCSV, []);
  S.buckets = csv(FILES.buckets, parseBucketsCSV, {});
  S.version = files[FILES.version] ? files[FILES.version].text.trim() : null;
  if (withLog) {
    S.oldFormat = isOldFormat(log);
    S.needsSplit = scratch.layout === 'single';
    // Changes not sent yet stay visible on top of what was loaded.
    S.log = sortLog(S.oldFormat || !outbox ? log : applyOps(log, outbox.list()));
    Object.assign(logCache, scratch);
  }
  S.legacyLogToo = !!legacyToo;
  // Screens hold the gym, room and machine they show: point them at the new copies.
  if (S.gym) S.gym = S.gyms.find(g => g.id === S.gym.id) || S.gym;
  if (S.gym && S.room) S.room = (S.gym.rooms || []).find(r => r.id === S.room.id) || S.room;
  if (S.room && S.machine) S.machine = (S.room.machines || []).find(m => m.id === S.machine.id) || S.machine;
}

/**
 * Show the copy kept on this device, if there is one (no network). Returns
 * true if the state now holds it. loadAll() then brings it up to date.
 */
export async function showFromDevice() {
  if (!S.repo || S.loaded) return false;
  const r = S.repo;
  const s = validSnapshot(await readSnapshot(repoKey()));
  if (!s || r !== S.repo || S.loaded) return false;
  try {
    applyFiles(s.files, { head: s.head, tree: s.tree, legacyToo: s.legacyToo });
    snap = s;
    S.loaded = true;
    S.fromDevice = true;
    return true;
  } catch (e) { console.warn('device copy unreadable:', e); return false; }
}

/** Turn a failed first call into a message that says what to fix. */
async function explain(r, e) {
  if (e.status === 401) return new Error('GitHub did not accept the token. Check it in Settings.');
  if (e.status === 404) {
    try { await r.info(); } catch (e2) {
      if (e2.status === 404) return new Error('Repository not found. Check the username and repository, and that the token can see it.');
      if (e2.status === 401) return new Error('GitHub did not accept the token. Check it in Settings.');
    }
    return new Error(`The branch ${r.branch} was not found in the repository.`);
  }
  return e;
}

/**
 * Bring the state up to date with GitHub: ask for the branch head; if it is
 * the one the state was built from, nothing else is needed. Otherwise read
 * the head's tree and download only the files whose blob sha changed.
 * Resolves true if anything shown changed. `force`: download every file again
 * (Settings → Reload), whatever the device copy says.
 */
export async function loadAll(onStatus = () => {}, { force = false } = {}) {
  const r = repo();
  S.loading = true;
  let changed = false;
  try {
    onStatus('Checking repository…');
    const gen = saves;
    let head;
    try { head = await r.headSha(); } catch (e) { throw await explain(r, e); }
    if (force || !(snap && snap.head === head)) {
      onStatus('Loading your data…');
      const t = await r.treeAt(head);
      const have = snap && !force ? snap.files : {};
      const need = toDownload(t.files, have);
      const got = Object.fromEntries(await Promise.all(need.map(async p => [p, await r.blobText(t.files[p])])));
      if (r !== S.repo) return false;
      let files = nextFiles(t.files, have, got);
      const lay = logLayout(t.files);
      const legacyToo = lay.layout === 'months' && lay.legacyToo;
      let next = makeSnapshot(head, t.sha, files, legacyToo);
      const logSent = saves !== gen && snap; // a save landed meanwhile: its months are newer than these
      if (logSent) {
        files = { ...Object.fromEntries(Object.entries(files).filter(([p]) => !isLogPath(p))),
          ...Object.fromEntries(Object.entries(snap.files).filter(([p]) => isLogPath(p))) };
        next = makeSnapshot(null, null, files, legacyToo);
      }
      changed = !snap || changedPaths(snap.files, files).length > 0 || !!snap.legacyToo !== legacyToo;
      applyFiles(files, { head, tree: t.sha, withLog: !logSent, legacyToo });
      keep(next);
    }
    S.loaded = true;
    S.fromDevice = false;
  } finally { S.loading = false; }
  syncNow(); // changes left on this device (from before, or that failed to send)
  return changed;
}

/** Remember a file the app just wrote itself, so the next open need not download it. */
function wrote(path, text, sha) {
  if (snap) keep(withFile(snap, path, text, sha));
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
 * Log changes. Each one is applied to S.log at once, kept on the device and
 * sent in the background; they return without waiting for GitHub. The
 * background save status is S.sync (see onSync).
 */
/** An expected refusal (shown to the user, not logged as an error). */
const refused = msg => Object.assign(new Error(msg), { refused: true });

function queue(op) {
  if (S.oldFormat) throw refused('This repository still has data in the old format. It must be migrated before the new app can save.');
  if (S.needsSplit) throw refused('Your log is still one file (workout-log.json). Saving is off until it is split into months: see "Upgrading to 0.3.0" in the setup guide.');
  repo();
  S.log = sortLog(applyOp(S.log, op));
  syncer.add(op).catch(e => console.error(e));
  return S.log;
}

/** Replace session `from` with `sets` as session `to` (a date or variant change moves it). */
export const saveSession = (from, sets, to, message) => queue(mergeOp(S.log, from, sets, to, message));
/** Delete a session. */
export const deleteSession = (s, message) => queue(removeOp(s, message));
/** Move a session to another machine: to = { gym_id, gym, room_id, room, machine_id, machine }. */
export const moveSessionTo = (from, to, message) => queue(moveOp(from, to, message));

// ------------------------------------------------------------ single files ---

/** Write one JSON file with the sha it was loaded with; on a conflict, re-read the sha and write again. */
async function putJSON(path, data, sha, message) {
  const r = repo();
  const text = json(data);
  let out;
  try { out = await r.putFile(path, text, sha, message); }
  catch (e) {
    if (!isConflict(e)) throw e;
    const cur = await r.getText(path);
    out = await r.putFile(path, text, cur ? cur.sha : null, message);
  }
  wrote(path, text, out);
  return out;
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
  wrote(FILES.plan, null);
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
  const text = json(serialiseGym(gym));
  S.sha.gym[p] = await r.putFile(p, text, cur ? cur.sha : null, `Import gym: ${gym.name}`);
  wrote(p, text, S.sha.gym[p]);
  if (snap) applyFiles(snap.files, { withLog: false }); else await loadAll();
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
