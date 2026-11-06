/** Home: today's route, this week, gyms. */
import { S, hasCfg, goalsCfg, genericGym, myGyms } from '../state.js';
import { html, act, setHTML, on, esc } from './dom.js';
import { screen, nav } from './nav.js';
import { gymMachineCount } from '../../lib/gyms.js';
import { TEMPLATE } from '../../lib/config.js';

export function docUrl(name) { return `https://github.com/${TEMPLATE.owner}/${TEMPLATE.repo}/blob/main/docs/${name}`; }
import { computeGoals, defaultGoals } from '../../lib/goals.js';
import { planStatus } from '../../lib/plan.js';
import { todayStr, fmtRange, fmtGoalNum } from '../../lib/format.js';
import { openGym } from './gyms.js';

export function weekCtx(offset) {
  const gc = goalsCfg() || defaultGoals();
  return computeGoals(gc.goals, { log: S.log, wellness: S.wellness, buckets: S.buckets, gyms: S.gyms, weekStart: gc.weekStart || 'mon', today: todayStr(), offset: offset || 0 });
}
/** Wellness goals only show when the repo actually has wellness data. */
export function visibleResults(o) { return o.results.filter(r => r.source !== 'wellness' || S.wellness.length); }

function gymRow(g) {
  const tot = gymMachineCount(g);
  const sub = g.rooms.length > 1 ? `${g.rooms.length} rooms · ${tot} machines` : `${tot} machines`;
  return html`<div class="row" ${act('open-gym', { id: g.id })}><div class="ic">${g.icon || '🏋️'}</div><div class="tx"><h2>${g.name}</h2><p>${sub}</p></div><span class="ch">›</span></div>`;
}

function planCard() {
  const p = S.plan;
  if (!p) return '';
  const st = planStatus(p, S.log, todayStr());
  const when = p.generatedAt ? new Date(p.generatedAt) : null;
  const whenTxt = when && !isNaN(when) ? when.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' }) : '';
  return html`<div class="sh first">Today's route</div>
    <div class="pc" ${act('nav', { to: 'plan' })}>
      <div class="pch"><span class="pcn">${st.done === st.total && st.total ? 'All stops done 🏁' : 'Route ready 🚂'}</span><span class="pct">${whenTxt}</span></div>
      ${p.coachNote ? html`<div class="pce">${p.coachNote}</div>` : ''}
      <div class="pcf"><b>${st.done}</b> of <b>${st.total}</b> stop${st.total === 1 ? '' : 's'} logged ›</div>
    </div>`;
}

function weekStrip() {
  if (!goalsCfg()) return '';
  const o = weekCtx(0); const rs = visibleResults(o);
  if (!rs.length) return '';
  const good = rs.filter(r => r.status === 'hit' || r.status === 'onpace').length;
  const chips = rs.map(r => html`<span class="chip ${r.status}">${r.label}: ${r.kind === 'avg' ? fmtGoalNum(r.value, r.unit) : `${fmtGoalNum(r.value, r.unit)}/${fmtGoalNum(r.target, r.unit)}`}</span>`);
  return html`<div class="sh">This week</div>
    <div class="wk" ${act('nav', { to: 'reports' })}>
      <div class="wkh"><b>${good} of ${rs.length} on track</b><span>${fmtRange(o.start, o.end)} · day ${o.daysElapsed} of 7</span></div>
      <div class="chips">${chips}</div>
    </div>`;
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
  const mine = myGyms(); const gen = genericGym();
  setHTML('homebody', html`${planCard()}${weekStrip()}
    <div class="sh ${!S.plan && !goalsCfg() ? 'first' : ''}">My gyms</div>
    ${mine.length ? html`<div class="card">${mine.map(gymRow)}</div>` : html`<div class="empty" style="padding:22px"><p>No gyms yet.<br>Add one in Settings → Manage Equipment, or import from the catalog.</p></div>`}
    ${gen ? html`<div class="sh">Common exercises</div><div class="card">${gymRow(gen)}</div>` : ''}
    <div class="version">${esc(S.cfg.user)}/${esc(S.cfg.repo)}${S.version ? ` · v${esc(S.version)}` : ''}</div>`);
}

screen('home', renderHome);
on('open-gym', d => openGym(d.id));
