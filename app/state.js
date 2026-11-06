/**
 * Central app state. One object, mutated in place by data.js and read by the
 * screens. Nothing here touches the network or the DOM.
 */
import { STORAGE } from '../lib/config.js';

export const S = {
  cfg: { user: '', repo: 'traintracks', token: '' },
  remember: true,          // keep the token in localStorage (else sessionStorage)
  repo: null,              // GitHubRepo instance
  repoPrivate: null,       // true/false once known
  gyms: [],                // loaded gyms (generic first, with overrides applied)
  genericLocal: null,      // equipment/generic.local.json contents
  log: [],
  profile: {},
  plan: null,
  goals: null,
  wellness: [],
  buckets: {},
  version: null,           // VERSION file contents
  sha: { log: null, csv: null, profile: null, plan: null, goals: null, genericLocal: null, gym: {} },
  loaded: false,
  loading: false,
  // navigation
  stack: ['home'],
  gym: null, room: null, machine: null,
  editSession: null,       // { gymId, machineId, date } when editing
  fromPlan: false,
  weekOffset: 0,
  catalog: null,
  pendingPhoto: null       // base64 jpeg from the camera, waiting to be saved
};

export function hasCfg() { return !!(S.cfg.user && S.cfg.repo && S.cfg.token); }

export function loadCfg() {
  try {
    S.remember = localStorage.getItem(STORAGE.remember) !== 'no';
    const src = S.remember ? localStorage : sessionStorage;
    const saved = JSON.parse(src.getItem(STORAGE.cfg) || '{}');
    // token may have been left in localStorage by an older setting; honour whichever has it
    const alt = JSON.parse((S.remember ? sessionStorage : localStorage).getItem(STORAGE.cfg) || '{}');
    Object.assign(S.cfg, alt, saved);
    if (!S.cfg.repo) S.cfg.repo = 'traintracks';
  } catch (e) { /* storage unavailable */ }
}

export function saveCfg() {
  try {
    localStorage.setItem(STORAGE.remember, S.remember ? 'yes' : 'no');
    const dst = S.remember ? localStorage : sessionStorage, other = S.remember ? sessionStorage : localStorage;
    dst.setItem(STORAGE.cfg, JSON.stringify(S.cfg));
    other.removeItem(STORAGE.cfg);
  } catch (e) { /* storage unavailable */ }
}

export function clearCfg() {
  S.cfg = { user: S.cfg.user, repo: S.cfg.repo, token: '' };
  try { localStorage.removeItem(STORAGE.cfg); sessionStorage.removeItem(STORAGE.cfg); } catch (e) { /* ignore */ }
}

export function goalsCfg() { return S.goals && Array.isArray(S.goals.goals) ? S.goals : null; }
export function haveBuckets() { return Object.keys(S.buckets).length > 0; }
export function genericGym() { return S.gyms.find(g => g.id === 'generic') || null; }
export function myGyms() { return S.gyms.filter(g => g.id !== 'generic'); }
