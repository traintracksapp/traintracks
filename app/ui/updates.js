/** Settings: the update box at the top, and the Garmin section. */
import { S, hasCfg } from '../state.js';
import { html, act, on, toast, $, modal, closeModal, showLoading, hideLoading } from './dom.js';
import { settingsUpdateBox, settingsSection } from './settings.js';
import { checkTemplate, applyTemplate, runGarminNow } from '../data.js';
import { TEMPLATE } from '../../lib/config.js';

let pending = null;

settingsUpdateBox(() => html`<button class="btn inline" ${act('update-check')}>Check for updates</button>`);
settingsSection(() => html`<div class="sh">Garmin</div>
  <div class="card"><div class="sl" ${act('garmin-run')}><span>Run the Garmin sync now<br><small>Needs Garmin set up (see the Garmin guide) and a token with Actions: Read and write</small></span><span class="ch">▶</span></div></div>`);

on('update-check', async () => {
  if (!hasCfg()) { toast('Set up GitHub first', 'err'); return; }
  const status = $('updstatus');
  status.textContent = `Comparing with ${TEMPLATE.owner}/${TEMPLATE.repo}…`;
  try {
    const c = await checkTemplate();
    status.textContent = '';
    if (!c.plan.all.length) { toast('Already up to date', 'ok'); status.textContent = 'Up to date ✓'; return; }
    pending = c;
    const shown = c.plan.all.slice(0, 15);
    modal(html`<h2>Update available${c.templateVersion ? ` · v${c.templateVersion}` : ''}</h2>
      ${c.changelog ? html`<pre class="changelog">${c.changelog}</pre>` : html`<p class="mdp">${c.plan.all.length} app file(s) differ from the template.</p>`}
      <details class="files"><summary>Files (${c.plan.all.length})</summary><ul>${shown.map(p => html`<li>${p}</li>`)}${c.plan.all.length > shown.length ? html`<li>…and ${c.plan.all.length - shown.length} more</li>` : ''}</ul></details>
      <p class="mdp">Only app files are replaced, in one commit. Your log, profile, goals, gyms, Garmin settings and workflows are never touched. Reload the page a minute or two after it finishes.</p>
      <div class="mbs"><button class="mc2" ${act('modal-close')}>Not now</button><button class="mo" ${act('update-apply')}>Update</button></div>`);
  } catch (e) { status.textContent = ''; toast(`Update check failed: ${e.message}`, 'err'); }
});

on('update-apply', async () => {
  if (!pending) return;
  closeModal();
  const status = $('updstatus');
  showLoading('Updating…');
  try {
    const n = await applyTemplate(pending, m => { status.textContent = m; $('ldmsg').textContent = m; });
    status.textContent = `Updated ${n} file(s) ✓ Reload the page in a minute or two, once GitHub Pages has rebuilt.`;
    toast('App updated', 'ok');
  } catch (e) { status.textContent = ''; toast(`Update failed: ${e.message}`, 'err'); }
  finally { hideLoading(); pending = null; }
});

on('garmin-run', async () => {
  if (!hasCfg()) { toast('Set up GitHub first', 'err'); return; }
  showLoading('Asking GitHub to run the Garmin workflow…');
  try { await runGarminNow(); toast('Garmin workflow started; data arrives in a few minutes', 'ok'); }
  catch (e) {
    toast(e.status === 404 ? 'No garmin.yml workflow in this repo (Garmin isn\'t set up)' : e.status === 403 ? 'The token needs Actions: Read and write to start workflows' : e.message, 'err');
  } finally { hideLoading(); }
});
