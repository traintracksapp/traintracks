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
import { FILES } from '../lib/config.js';
import { sortLog } from '../lib/log.js';
import { applyGenericOverrides, genericOverridesFrom, serialiseGym, GENERIC_ID } from '../lib/gyms.js';
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
    await Promise.all([loadGyms(), loadLog(), loadProfile(), loadPlan(), loadGoals(), loadVersion()]);
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
