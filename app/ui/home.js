/** Home: today's route, this week, gyms. */
import { S, hasCfg, genericGym, myGyms } from '../state.js';
import { html, act, setHTML, on } from './dom.js';
import { screen } from './nav.js';
import { gymMachineCount } from '../../lib/gyms.js';
import { TEMPLATE } from '../../lib/config.js';
import { openGym } from './gyms.js';

export const docUrl = name => `https://github.com/${TEMPLATE.owner}/${TEMPLATE.repo}/blob/main/docs/${name}`;

/** Extra home sections (plan card, week strip) registered by other screens: fn() → html. */
const sections = [];
export function homeSection(fn) { sections.push(fn); }

function gymRow(g) {
  const tot = gymMachineCount(g);
  const sub = g.rooms.length > 1 ? `${g.rooms.length} rooms · ${tot} machines` : `${tot} machines`;
  return html`<div class="row" ${act('open-gym', { id: g.id })}><div class="ic">${g.icon || '🏋️'}</div><div class="tx"><h2>${g.name}</h2><p>${sub}</p></div><span class="ch">›</span></div>`;
}

export function renderHome() {
  if (!hasCfg()) {
    setHTML('homebody', html`<div class="empty" style="padding-top:60px"><div class="icon">🚉</div><p><b>Welcome aboard.</b><br>Connect your GitHub repository to get going.</p></div><button class="btn" ${act('nav', { to: 'settings' })}>Set up GitHub</button><p class="hint" style="text-align:center">New here? Read <a href="${docUrl('SETUP.md')}" target="_blank" rel="noopener">the setup guide</a>.</p>`);
    return;
  }
  if (!S.loaded) {
    setHTML('homebody', html`<div class="empty" style="padding-top:60px"><div class="icon">🚉</div><p>Not connected yet.</p></div><button class="btn" ${act('connect')}>Connect &amp; load data</button>`);
    return;
  }
  const mine = myGyms(), gen = genericGym();
  const extra = sections.map(fn => fn()).filter(Boolean);
  setHTML('homebody', html`
    ${S.oldFormat ? html`<div class="banner bad">This repository's data is still in the old format. Browsing works, but saving is turned off until it is migrated (see the setup guide).</div>` : ''}
    ${!S.oldFormat && S.needsSplit ? html`<div class="banner bad">Your log is still one file (workout-log.json). This version keeps one file per month. Browsing works, but saving is turned off until the log is split: see <a href="${docUrl('SETUP.md')}#upgrading-to-030" target="_blank" rel="noopener">Upgrading to 0.3.0</a>.</div>` : ''}
    ${S.legacyLogToo ? html`<div class="banner bad">workout-log.json is in your repository next to the monthly log files in log/. The app ignores it: the months are the log. If something old wrote it (an old Worker, an old Garmin workflow, a device still running an older version), see <a href="${docUrl('SETUP.md')}#upgrading-to-030" target="_blank" rel="noopener">Upgrading to 0.3.0</a>.</div>` : ''}
    ${extra}
    <div class="sh ${extra.length ? '' : 'first'}">My gyms</div>
    ${mine.length ? html`<div class="card">${mine.map(gymRow)}</div>` : html`<div class="empty" style="padding:22px"><p>No gyms yet.<br>Add one in Settings → Manage equipment, or import from the catalog.</p></div>`}
    ${gen ? html`<div class="sh">Common exercises</div><div class="card">${gymRow(gen)}</div>` : ''}`);
}

screen('home', renderHome);
on('open-gym', d => openGym(d.id));
