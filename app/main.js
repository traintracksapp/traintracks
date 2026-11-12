/**
 * TrainTracks entry point: wires the screens, restores the saved connection
 * and loads the user's data from GitHub.
 */
import { S, hasCfg, loadCfg } from './state.js';
import { connect, loadAll, syncNow, showFromDevice } from './data.js';
import { wireDelegation, on, closeModal, toast, showLoading, hideLoading, $ } from './ui/dom.js';
import { home, refresh, current } from './ui/nav.js';
import { renderHome } from './ui/home.js';
import './ui/gyms.js';
import './ui/logform.js';
import './ui/plan.js';
import './ui/reports.js';
import './ui/goalsedit.js';
import './ui/equipment.js';
import './ui/profile.js';
import { applyTheme } from './ui/settings.js';
import './ui/updates.js';
import './ui/sync.js';
import { STORAGE, APP_VERSION } from '../lib/config.js';

wireDelegation();
on('modal-backdrop', (d, el, e) => { if (e.target === el) closeModal(); });

try { applyTheme(localStorage.getItem(STORAGE.theme) || 'auto'); } catch { /* ignore */ }
loadCfg();
connect();

// Screens that only show data, so they can be redrawn when newer data arrives.
// Forms and editors are left alone: redrawing them would lose what is typed.
const READ_ONLY = ['home', 'rooms', 'machines', 'detail', 'plan', 'reports'];

/** Open from the copy on this device (if any) at once, then bring it up to date from GitHub. */
async function boot() {
  home();
  if (!hasCfg()) return;
  document.body.dataset.load = 'loading';
  const fromDevice = await showFromDevice();
  if (fromDevice) { home(); document.body.dataset.load = 'device'; }
  else showLoading('Loading your data…');
  try {
    const changed = await loadAll(m => { if (!fromDevice) $('ldmsg').textContent = m; });
    if (!fromDevice) home();
    else if (changed && READ_ONLY.includes(current())) refresh();
    document.body.dataset.load = 'fresh';
  } catch (e) {
    console.error(e);
    document.body.dataset.load = 'error';
    if (fromDevice) toast(`Showing the copy on this device. GitHub: ${e.message}`, 'err');
    else { toast(`Load error: ${e.message}`, 'err'); renderHome(); }
  } finally { hideLoading(); }
}

boot();

// Coming back to the app after a minute or more: check GitHub (one call when
// nothing changed), since another device, the coach or a Garmin Action may
// have written to the repo.
let hiddenAt = 0;
document.addEventListener('visibilitychange', async () => {
  if (document.hidden) { hiddenAt = Date.now(); return; }
  syncNow();
  if (!hasCfg() || !S.loaded || S.loading || Date.now() - hiddenAt < 60 * 1000) return;
  try { if (await loadAll() && READ_ONLY.includes(current())) refresh(); } catch { /* quiet */ }
});

console.log(`TrainTracks v${APP_VERSION}`);
