/** Settings (GitHub connection, manage, update) and Profile. */
import { S, hasCfg, saveCfg, clearCfg, loadCfg } from '../state.js';
import { html, raw, act, setHTML, on, toast, $, qs, showLoading, hideLoading, confirmDialog, modal, closeModal, esc } from './dom.js';
import { screen, nav, back, home } from './nav.js';
import { connect, loadAll, saveProfile, checkTemplate, applyTemplate, runGarminNow } from '../data.js';
import { APP_VERSION, TEMPLATE, STORAGE } from '../../lib/config.js';
import { renderHome, docUrl } from './home.js';

export async function doConnect() {
  saveCfg();
  if (!hasCfg()) { toast('Enter username, repository and token', 'err'); return; }
  connect();
  showLoading('Connecting…');
  try {
    await loadAll(m => { $('ldmsg').textContent = m; });
    toast(S.gyms.length || S.log.length ? 'Connected' : 'Connected — no data found yet', 'ok');
    home();
  } catch (e) {
    toast(`${e.message}`, 'err');
    renderHome();
  } finally { hideLoading(); }
}

function renderSettings() {
  const theme = (() => { try { return localStorage.getItem(STORAGE.theme) || 'auto'; } catch (e) { return 'auto'; } })();
  setHTML('settingsbody', html`
    <div class="sh first">GitHub connection</div>
    <div class="card">
      <div class="si"><label>Username</label><input id="su" type="text" placeholder="your-username" autocapitalize="none" autocomplete="username" spellcheck="false" value="${S.cfg.user}"></div>
      <div class="si"><label>Repository</label><input id="sr" type="text" placeholder="traintracks" autocapitalize="none" spellcheck="false" value="${S.cfg.repo}"></div>
      <div class="si"><label>Token</label><input id="sp" type="password" placeholder="github_pat_…" autocapitalize="none" autocomplete="off" spellcheck="false" value="${S.cfg.token}"></div>
    </div>
    <label class="chk"><input type="checkbox" id="sremember" ${S.remember ? 'checked' : ''}> Remember the token on this device</label>
    <button class="btn" ${act('connect')}>Connect &amp; load data</button>
    ${S.cfg.token ? html`<button class="btn ghost" ${act('forget-token')}>Forget token on this device</button>` : ''}
    <p class="hint">A fine-grained token scoped to <b>only</b> this repository with <b>Contents: Read and write</b>. It is stored ${S.remember ? 'in this browser' : 'for this session only'} and sent only to api.github.com. ${S.repoPrivate === true ? 'Your repository is private.' : S.repoPrivate === false ? 'Your repository is public — anyone can read your log and profile.' : ''}</p>

    <div class="sh">Manage</div>
    <div class="card">
      <div class="sl" ${act('nav', { to: 'equipment' })}><span>Manage equipment</span><span class="ch">›</span></div>
      <div class="sl" ${act('nav', { to: 'profile' })}><span>My profile</span><span class="ch">›</span></div>
      <div class="sl" ${act('nav', { to: 'goals' })}><span>Weekly goals</span><span class="ch">›</span></div>
      <div class="sl" ${act('reload')}><span>Reload data from GitHub</span><span class="ch">↻</span></div>
    </div>

    <div class="sh">Garmin</div>
    <div class="card">
      <div class="sl" ${act('garmin-run')}><span>Run Garmin sync now<br><small>Needs the pipeline enabled and a token with Actions: write</small></span><span class="ch">▶</span></div>
    </div>

    <div class="sh">App</div>
    <div class="card">
      <div class="si"><label>Theme</label><select id="stheme"><option value="auto" ${theme === 'auto' ? 'selected' : ''}>Auto</option><option value="dark" ${theme === 'dark' ? 'selected' : ''}>Dark</option><option value="light" ${theme === 'light' ? 'selected' : ''}>Light</option></select></div>
      <div class="sl" ${act('update-check')}><span>Update app from template<br><small>${TEMPLATE.owner}/${TEMPLATE.repo}</small></span><span class="ch">›</span></div>
      <div class="sl" ${act('copy-url', { what: 'app' })}><span>Copy this app's URL</span><span class="ch">⧉</span></div>
    </div>
    <div class="status" id="updstatus"></div>
    <div class="version">TrainTracks v${S.version || APP_VERSION} · <a href="${docUrl('SETUP.md')}" target="_blank" rel="noopener">Setup guide</a> · <a href="${docUrl('COACH.md')}" target="_blank" rel="noopener">Coach setup</a> · <a href="${docUrl('GARMIN.md')}" target="_blank" rel="noopener">Garmin</a></div>`);
  ['su', 'sr', 'sp'].forEach(id => $(id).addEventListener('input', readCfgFields));
  $('sremember').addEventListener('change', e => { S.remember = e.target.checked; saveCfg(); });
  $('stheme').addEventListener('change', e => applyTheme(e.target.value, true));
}

function readCfgFields() {
  S.cfg.user = $('su').value.trim(); S.cfg.repo = $('sr').value.trim() || 'traintracks'; S.cfg.token = $('sp').value.trim();
  saveCfg();
}

export function applyTheme(t, persist) {
  const root = document.documentElement;
  if (t === 'auto' || !t) root.removeAttribute('data-theme'); else root.setAttribute('data-theme', t);
  if (persist) try { localStorage.setItem(STORAGE.theme, t); } catch (e) { /* ignore */ }
}

// ---- profile ----
const PFIELDS = [['firstName', 'First name', 'text', 'Your name'], ['birthYear', 'Birth year', 'number', '1980'], ['gender', 'Gender', 'text', 'e.g. Male, Female'], ['goals', 'Goals', 'textarea', 'What are you working toward?'], ['likes', 'Exercises I like', 'textarea', 'Machines or exercises you enjoy'], ['dislikes', 'Exercises I dislike', 'textarea', 'Things you avoid'], ['injuries', 'Injuries', 'textarea', 'Past or current injuries'], ['limitations', 'Limitations', 'textarea', 'Movements to avoid'], ['notes', 'Other notes', 'textarea', 'Anything else useful for your coach']];

function renderProfile() {
  const p = S.profile || {};
  const field = ([k, label, type, ph]) => html`<div class="pi"><label for="p-${k}">${label}</label>${type === 'textarea' ? html`<textarea class="fi" id="p-${k}" placeholder="${ph}">${p[k] || ''}</textarea>` : html`<input class="fi" id="p-${k}" type="${type}" placeholder="${ph}" value="${p[k] ?? ''}">`}</div>`;
  setHTML('profilebody', html`<div class="sh first">About you</div><div class="card">${PFIELDS.slice(0, 3).map(field)}</div><div class="sh">Fitness profile</div><div class="card">${PFIELDS.slice(3).map(field)}</div><p class="hint">Your coach reads this file (<code>profile.json</code>). ${S.repoPrivate === false ? 'Your repository is public, so this is visible to anyone — keep it to what you are happy to share.' : ''}</p>`);
}

screen('settings', renderSettings);
screen('profile', renderProfile);

on('connect', doConnect);
on('forget-token', async () => { clearCfg(); S.loaded = false; S.repo = null; renderSettings(); toast('Token forgotten on this device', 'ok'); });
on('reload', async () => {
  if (!hasCfg()) { toast('Set up GitHub first', 'err'); return; }
  showLoading('Reloading…');
  try { await loadAll(m => { $('ldmsg').textContent = m; }); toast('Data reloaded', 'ok'); renderHome(); }
  catch (e) { toast(e.message, 'err'); } finally { hideLoading(); }
});
on('profile-save', async () => {
  if (!hasCfg()) { toast('Set up GitHub first', 'err'); return; }
  const out = { ...S.profile };
  PFIELDS.forEach(([k]) => { const v = ($('p-' + k) || {}).value || ''; out[k] = k === 'birthYear' ? (v.trim() ? parseInt(v, 10) || null : null) : v.trim(); });
  showLoading('Saving profile…');
  try { await saveProfile(out); toast('Profile saved', 'ok'); back(); }
  catch (e) { toast(`Save failed: ${e.message}`, 'err'); } finally { hideLoading(); }
});
on('copy-url', () => {
  const url = location.href.split('#')[0];
  navigator.clipboard.writeText(url).then(() => toast('URL copied', 'ok')).catch(() => modal(html`<h2>App URL</h2><div class="mr"><input value="${url}" readonly></div><div class="mbs"><button class="mo" ${act('modal-close')}>Close</button></div>`));
});
on('garmin-run', async () => {
  if (!hasCfg()) { toast('Set up GitHub first', 'err'); return; }
  showLoading('Asking GitHub to run the Garmin workflow…');
  try { await runGarminNow(); toast('Garmin workflow started — data lands in a few minutes', 'ok'); }
  catch (e) { toast(e.status === 404 ? 'No garmin.yml workflow in this repo (Garmin not set up)' : e.status === 403 ? 'Token needs Actions: Read and write to trigger workflows' : e.message, 'err'); }
  finally { hideLoading(); }
});
on('update-check', async () => {
  if (!hasCfg()) { toast('Set up GitHub first', 'err'); return; }
  const el = $('updstatus');
  try {
    const check = await checkTemplate(m => { el.textContent = m; });
    if (!check.plan.all.length) { el.textContent = 'Already up to date ✓'; toast('Already up to date', 'ok'); return; }
    el.textContent = '';
    const list = check.plan.all.slice(0, 12).map(p => html`<li>${p}</li>`).join('') + (check.plan.all.length > 12 ? `<li>…and ${check.plan.all.length - 12} more</li>` : '');
    modal(html`<h2>Update available${check.templateVersion ? ` · v${check.templateVersion}` : ''}</h2>
      <p class="mdp">${check.changelog ? html`${check.changelog}` : `${check.plan.all.length} app file(s) differ from the template.`}</p>
      <details style="margin:-6px 0 12px;font-size:13px;color:var(--dim)"><summary>Files (${check.plan.all.length})</summary><ul style="padding:8px 0 0 18px;line-height:1.6">${raw(list)}</ul></details>
      <p class="mdp">Only app files are replaced; your log, profile, goals, gyms and workflows are never touched. Reload the page about a minute after it finishes.</p>
      <div class="mbs"><button class="mc2" ${act('modal-close')}>Not now</button><button class="mo" ${act('update-apply')}>Update</button></div>`);
    S._pendingUpdate = check;
  } catch (e) { el.textContent = ''; toast(`Update check failed: ${e.message}`, 'err'); }
});
on('update-apply', async () => {
  const check = S._pendingUpdate; if (!check) return;
  closeModal();
  const el = $('updstatus');
  showLoading('Updating…');
  try {
    const n = await applyTemplate(check, m => { el.textContent = m; $('ldmsg').textContent = m; });
    el.textContent = `Updated ${n} file(s) ✓ — reload the page in about a minute.`;
    toast(`${n} file(s) updated`, 'ok');
  } catch (e) { el.textContent = ''; toast(`Update failed: ${e.message}`, 'err'); }
  finally { hideLoading(); S._pendingUpdate = null; }
});
