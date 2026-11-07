/** Settings: version and updates (top), GitHub connection, manage, app. */
import { S, hasCfg, saveCfg, clearToken } from '../state.js';
import { html, act, setHTML, on, toast, $, showLoading, hideLoading, confirmDialog } from './dom.js';
import { screen, home, refresh } from './nav.js';
import { connect, loadAll } from '../data.js';
import { APP_VERSION, STORAGE } from '../../lib/config.js';
import { renderHome, docUrl } from './home.js';

/** Extra settings sections registered by later features (updater, Garmin): fn() → html. */
const extras = { top: null, sections: [] };
export function settingsUpdateBox(fn) { extras.top = fn; }
export function settingsSection(fn) { extras.sections.push(fn); }

export async function doConnect() {
  saveCfg();
  if (!hasCfg()) { toast('Enter username, repository and token', 'err'); return; }
  connect();
  showLoading('Connecting…');
  try {
    await loadAll(m => { $('ldmsg').textContent = m; });
    toast(S.gyms.length || S.log.length ? 'Connected' : 'Connected, but no data found yet', 'ok');
    home();
  } catch (e) {
    toast(e.message, 'err');
    renderHome();
  } finally { hideLoading(); }
}

export async function reload() {
  showLoading('Reloading…');
  try { await loadAll(); toast('Data reloaded', 'ok'); refresh(); }
  catch (e) { toast(`Reload failed: ${e.message}`, 'err'); }
  finally { hideLoading(); }
}

function themeNow() { try { return localStorage.getItem(STORAGE.theme) || 'auto'; } catch { return 'auto'; } }

export function applyTheme(t, persist) {
  const root = document.documentElement;
  if (!t || t === 'auto') root.removeAttribute('data-theme'); else root.setAttribute('data-theme', t);
  if (persist) try { localStorage.setItem(STORAGE.theme, t); } catch { /* ignore */ }
}

function renderSettings() {
  const theme = themeNow();
  const ver = S.version || APP_VERSION;
  setHTML('settingsbody', html`
    <div class="vertop"><div><b>TrainTracks v${ver}</b><small>${hasCfg() ? `${S.cfg.user}/${S.cfg.repo}` : 'Not connected'}</small></div>${extras.top ? extras.top() : ''}</div>
    <div class="status" id="updstatus"></div>

    <div class="sh">GitHub connection</div>
    <div class="card">
      <div class="si"><label for="su">Username</label><input id="su" type="text" placeholder="your-username" autocapitalize="none" autocomplete="username" spellcheck="false" value="${S.cfg.user}"></div>
      <div class="si"><label for="sr">Repository</label><input id="sr" type="text" placeholder="traintracks" autocapitalize="none" spellcheck="false" value="${S.cfg.repo}"></div>
      <div class="si"><label for="sp">Token</label><input id="sp" type="password" placeholder="github_pat_…" autocapitalize="none" autocomplete="off" spellcheck="false" value="${S.cfg.token}"></div>
    </div>
    <button class="btn" ${act('connect')}>Connect &amp; load data</button>
    ${S.cfg.token ? html`<button class="btn ghost" ${act('forget-token')}>Forget the token on this device</button>` : ''}
    <p class="hint">Use a fine-grained token for <b>only</b> this repository with <b>Contents: Read and write</b>. It is kept in this browser and sent only to api.github.com. Your repository is public: anyone with the link can read your log, profile and Garmin files.</p>

    <div class="sh">Manage</div>
    <div class="card">
      <div class="sl" ${act('nav', { to: 'equipment' })}><span>Manage equipment</span><span class="ch">›</span></div>
      <div class="sl" ${act('nav', { to: 'profile' })}><span>My profile</span><span class="ch">›</span></div>
      <div class="sl" ${act('nav', { to: 'goals' })}><span>Weekly goals</span><span class="ch">›</span></div>
      <div class="sl" ${act('reload')}><span>Reload data from GitHub</span><span class="ch">↻</span></div>
    </div>
    ${extras.sections.map(fn => fn())}

    <div class="sh">App</div>
    <div class="card">
      <div class="si"><label for="stheme">Theme</label><select id="stheme"><option value="auto" ${theme === 'auto' ? 'selected' : ''}>Auto</option><option value="dark" ${theme === 'dark' ? 'selected' : ''}>Dark</option><option value="light" ${theme === 'light' ? 'selected' : ''}>Light</option></select></div>
    </div>
    <div class="version"><a href="${docUrl('SETUP.md')}" target="_blank" rel="noopener">Setup guide</a> · <a href="${docUrl('COACH.md')}" target="_blank" rel="noopener">Coach setup</a> · <a href="${docUrl('GARMIN.md')}" target="_blank" rel="noopener">Garmin</a></div>`);
  for (const id of ['su', 'sr', 'sp']) $(id).addEventListener('input', readCfgFields);
  $('stheme').addEventListener('change', e => applyTheme(e.target.value, true));
}

function readCfgFields() {
  S.cfg.user = $('su').value.trim();
  S.cfg.repo = $('sr').value.trim() || 'traintracks';
  S.cfg.token = $('sp').value.trim();
  saveCfg();
}

screen('settings', renderSettings);
on('connect', doConnect);
on('reload', reload);
on('forget-token', async () => {
  if (!await confirmDialog('Forget the token?', 'You will need to paste it again to use TrainTracks on this device.', { ok: 'Forget', danger: true })) return;
  clearToken();
  connect();
  S.loaded = false;
  toast('Token removed from this device', 'ok');
  renderSettings();
});
