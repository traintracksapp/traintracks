/**
 * Central app state: one object, changed by data.js and read by the screens.
 * Nothing here touches the network or the DOM.
 */
import { STORAGE } from '../lib/config.js';

export const S = {
  cfg: { user: '', repo: 'traintracks', token: '' },
  repo: null,            // GitHubRepo
  gyms: [],              // generic first (with the user's overrides), then the user's gyms
  genericLocal: null,    // equipment/generic.local.json
  log: [],               // format version 2, newest first
  oldFormat: false,      // the repo still holds version 1 data: show a notice, don't write
  needsSplit: false,     // the log is still one file (format version 2): show a notice, don't write
  legacyLogToo: false,   // workout-log.json is (back) next to the months: ignored, with a notice
  profile: {},
  plan: null,
  goals: null,
  wellness: [],
  buckets: {},
  version: null,         // the repo's VERSION file
  sha: { profile: null, plan: null, goals: null, genericLocal: null, gym: {} },
  loaded: false,
  loading: false,
  fromDevice: false,     // showing the copy kept on this device; GitHub not checked yet
  lastSyncError: null,   // { message, status, at }: the last background-save error (Settings)
  // navigation and screen state
  stack: ['home'],
  gym: null, room: null, machine: null,
  editSession: null,     // { gym_id, machine_id, date, variant } when editing
  logVariant: [],        // the variant chosen in the log form
  fromPlan: false,
  historyAll: false,
  weekOffset: 0,
  catalog: null
};

export const hasCfg = () => !!(S.cfg.user && S.cfg.repo && S.cfg.token);

/** Read the saved connection. 0.1.0 may have kept it in sessionStorage; that copy is moved to localStorage. */
export function loadCfg() {
  try {
    const local = JSON.parse(localStorage.getItem(STORAGE.cfg) || '{}');
    let session = {};
    try { session = JSON.parse(sessionStorage.getItem(STORAGE.cfg) || '{}'); } catch { /* none */ }
    Object.assign(S.cfg, session, local);
    if (!S.cfg.repo) S.cfg.repo = 'traintracks';
    if (session.token && !local.token) saveCfg();
  } catch { /* storage unavailable */ }
}

export function saveCfg() {
  try {
    localStorage.setItem(STORAGE.cfg, JSON.stringify(S.cfg));
    sessionStorage.removeItem(STORAGE.cfg);
    localStorage.removeItem('tt-remember'); // 0.1.0's option, no longer used
  } catch { /* storage unavailable */ }
}

export function clearToken() {
  S.cfg = { user: S.cfg.user, repo: S.cfg.repo, token: '' };
  saveCfg();
}

export const goalsCfg = () => (S.goals && Array.isArray(S.goals.goals) ? S.goals : null);
export const genericGym = () => S.gyms.find(g => g.id === 'generic') || null;
export const myGyms = () => S.gyms.filter(g => g.id !== 'generic');
