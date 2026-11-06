/**
 * TrainTracks — entry point. Wires the screens, restores the saved
 * connection and loads the user's data from GitHub.
 */
import { S, hasCfg, loadCfg } from './state.js';
import { connect, loadAll } from './data.js';
import { wireDelegation, on, closeModal, toast, showLoading, hideLoading, $ } from './ui/dom.js';
import { home } from './ui/nav.js';
import { renderHome } from './ui/home.js';
import './ui/gyms.js';
import './ui/logform.js';
import './ui/plan.js';
import './ui/reports.js';
import './ui/goals.js';
import './ui/equipment.js';
import { applyTheme } from './ui/settings.js';
import { STORAGE, APP_VERSION } from '../lib/config.js';

wireDelegation();
on('modal-backdrop', (d, el, e) => { if (e.target === el) closeModal(); });

try { applyTheme(localStorage.getItem(STORAGE.theme) || 'auto'); } catch (e) { /* ignore */ }
loadCfg();
connect();

async function boot() {
  home();
  if (!hasCfg()) return;
  showLoading('Loading your data…');
  try {
    await loadAll(m => { $('ldmsg').textContent = m; });
    home();
  } catch (e) {
    console.error(e);
    toast(`Load error: ${e.message}`, 'err');
    renderHome();
  } finally { hideLoading(); }
}

boot();

// Reload data when the app comes back to the foreground after a while
// (another device, the coach or an Action may have written to the repo).
let hiddenAt = 0;
document.addEventListener('visibilitychange', async () => {
  if (document.hidden) { hiddenAt = Date.now(); return; }
  if (!hasCfg() || !S.loaded || S.loading || Date.now() - hiddenAt < 10 * 60 * 1000) return;
  try { await loadAll(); if (S.stack.length === 1) renderHome(); } catch (e) { /* quiet */ }
});

console.log(`TrainTracks v${APP_VERSION}`);
