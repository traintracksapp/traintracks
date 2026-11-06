/** Weekly report: one card per goal, with a track-style progress bar. */
import { S, goalsCfg } from '../state.js';
import { html, act, setHTML, on } from './dom.js';
import { screen } from './nav.js';
import { weekCtx, visibleResults } from './home.js';
import { fmtRange, fmtGoalNum } from '../../lib/format.js';

function goalCard(r, o) {
  const isAvg = r.kind === 'avg';
  const unit = r.unit || '';
  const val = fmtGoalNum(r.value, unit), tgt = fmtGoalNum(r.target, unit);
  const missTxt = isAvg && o.isCurrent ? (r.direction === 'below' ? 'Above target' : 'Below target') : 'Missed';
  const statusTxt = { hit: o.isCurrent && isAvg ? 'On target' : 'Hit ✓', onpace: 'On pace', behind: 'Behind', miss: missTxt, nodata: 'No data' }[r.status] || '';
  let sub;
  if (isAvg) sub = `${r.direction === 'below' ? '≤' : '≥'} ${tgt}${r.daysWithData != null ? ` · ${r.daysWithData} day${r.daysWithData === 1 ? '' : 's'}` : ''}`;
  else if (o.isCurrent) sub = r.status === 'hit' ? `Target reached on day ${o.daysElapsed}` : `Pace: ${fmtGoalNum(r.expected, unit)} by now`;
  else sub = r.status === 'hit' ? 'Target reached' : `${fmtGoalNum(Math.max(0, r.target - r.value), unit)} short`;
  if (r.note) sub = (sub ? sub + ' · ' : '') + r.note;
  const pct = Math.round((r.pct || 0) * 100);
  const paceMark = !isAvg && o.isCurrent && r.target ? html`<em style="left:${Math.min(100, Math.round(r.expected / r.target * 100))}%"></em>` : '';
  const rows = r.items.length ? r.items.map(i => html`<div class="rdr"><span class="d">${i.label}</span><span class="t">${i.detail || ''}</span><span class="v">${i.value != null ? fmtGoalNum(i.value, unit) : '✓'}</span></div>`) : html`<div class="none">Nothing logged yet this week.</div>`;
  return html`<div class="rc ${r.status}"><div class="rch" ${act('rc-toggle')}><div class="rcl"><div class="rcn">${r.label}</div><div class="rcs">${sub}</div></div><div class="rcv"><b>${val}${isAvg ? '' : html` <small>/ ${tgt}</small>`}</b><span>${statusTxt}</span></div></div><div class="track"><i style="width:${pct}%"></i>${paceMark}</div><div class="rdd">${rows}</div></div>`;
}

function renderReports(p) {
  if (!p || !p.refresh) { if (!p || !p.back) S.weekOffset = 0; }
  if (!goalsCfg()) {
    setHTML('repbody', html`<div class="empty"><div class="icon">🎯</div><p>No weekly goals yet.<br>Set a few targets and this page will track them.</p></div><button class="btn" ${act('nav', { to: 'goals' })}>Set up goals</button>`);
    return;
  }
  const o = weekCtx(S.weekOffset); const rs = visibleResults(o);
  const good = rs.filter(r => r.status === 'hit' || r.status === 'onpace').length;
  const hit = rs.filter(r => r.status === 'hit').length;
  const title = S.weekOffset === 0 ? 'This week' : S.weekOffset === -1 ? 'Last week' : `${-S.weekOffset} weeks ago`;
  const groups = [['Activity', r => r.source !== 'wellness' && !(r.machineIds && r.machineIds.length)], ['Bodyweight', r => r.source !== 'wellness' && r.machineIds && r.machineIds.length], ['Wellness', r => r.source === 'wellness']];
  setHTML('repbody', html`<div class="wkbar"><button class="nb" ${act('week-shift', { n: -1 })} aria-label="Earlier week">&#8249;</button><div class="wkttl"><b>${title}</b><span>${fmtRange(o.start, o.end)}${o.isCurrent ? ` · day ${o.daysElapsed} of 7` : ' · final'}</span></div><button class="nb" ${act('week-shift', { n: 1 })} aria-label="Later week" style="visibility:${S.weekOffset === 0 ? 'hidden' : 'visible'}">&#8250;</button></div>
    <div class="wksum"><span><b>${hit}</b> hit</span>${o.isCurrent ? html`<span><b>${good - hit}</b> on pace</span><span><b>${rs.length - good}</b> behind</span>` : html`<span><b>${rs.length - hit}</b> missed</span>`}</div>
    ${groups.map(([name, pred]) => { const list = rs.filter(pred); return list.length ? html`<div class="sh">${name}</div>${list.map(r => goalCard(r, o))}` : ''; })}
    ${!S.wellness.length && goalsCfg().goals.some(r => r.source === 'wellness') ? html`<p class="hint">Steps, sleep, HRV and resting-HR goals need <code>daily-wellness.csv</code> in your repo (Garmin pipeline).</p>` : ''}`);
}

screen('reports', renderReports);
on('rc-toggle', (d, el) => el.parentElement.classList.toggle('open'));
on('week-shift', d => { S.weekOffset = Math.min(0, S.weekOffset + Number(d.n)); renderReports({ refresh: true }); });
