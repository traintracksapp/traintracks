/** Weekly goals editor. Works on a copy (GE) until Save. */
import { S, hasCfg, goalsCfg, haveBuckets } from '../state.js';
import { html, act, setHTML, on, toast, modal, closeModal, val, numVal, showLoading, hideLoading, qsa, $ } from './dom.js';
import { screen, back, current } from './nav.js';
import { saveGoals } from '../data.js';
import { defaultGoals, GOAL_PRESETS, isHrRangeGoal, hrRangeText, cleanGoalsConfig } from '../../lib/goals.js';
import { machineOptions, findMachine } from '../../lib/gyms.js';
import { slug } from '../../lib/format.js';
import { renderHome } from './home.js';

let GE = null;

function machineName(id) { const f = findMachine(S.gyms, id); return f ? f.machine.name : id; }

function kindText(g) {
  if (g.kind === 'days') return `Days with ${g.filter === 'any' ? 'a workout' : g.filter}`;
  if (isHrRangeGoal(g)) return `Garmin minutes · ${hrRangeText(g.hrMin, g.hrMax)}`;
  if (g.source === 'wellness') return (g.kind === 'avg' ? 'Weekly average of ' : 'Weekly total of ') + String(g.field || '').replace(/_/g, ' ') + (g.direction === 'below' ? ' (lower is better)' : '');
  if (g.machineIds && g.machineIds.length) return `Total ${g.field} · ${g.machineIds.map(machineName).join(', ')}`;
  return `Weekly total of ${g.field}`;
}

function draw() {
  const days = [['sat', 'Saturday'], ['sun', 'Sunday'], ['mon', 'Monday'], ['tue', 'Tuesday'], ['wed', 'Wednesday'], ['thu', 'Thursday'], ['fri', 'Friday']];
  const fl = GE.hrZones || [];
  setHTML('goalsbody', html`<div class="sh first">Week</div><div class="card"><div class="si"><label>Starts on</label><select id="gws">${days.map(([v, n]) => html`<option value="${v}" ${GE.weekStart === v ? 'selected' : ''}>${n}</option>`)}</select></div></div>
    <div class="sh">Goals</div><div class="card">${GE.goals.length ? GE.goals.map((g, i) => html`<div class="gl"><div class="gn"><input type="text" value="${g.label}" data-gi="${i}" data-k="label" aria-label="Goal name"><div class="gk">${kindText(g)}</div></div><input class="gt" type="number" inputmode="decimal" value="${g.target}" data-gi="${i}" data-k="target" aria-label="Target"><button class="xb" ${act('goal-rm', { i })} aria-label="Remove">×</button></div>`) : html`<div class="empty" style="padding:20px"><p>No goals yet.</p></div>`}</div>
    <button class="btn dashed" ${act('goal-add')}>＋ Add goal</button>
    ${haveBuckets() || fl.length ? html`<div class="sh">Heart-rate zones</div><div class="card"><div class="gl" style="flex-wrap:wrap"><div class="gn" style="flex-basis:100%"><div style="font-size:14px;font-weight:650">Zone floors (bpm)</div><div class="gk">Where each zone starts. Garmin data is stored in 5-bpm buckets, so use multiples of 5. Display only — nothing stored is rewritten.</div></div><div class="zones">${[0, 1, 2, 3, 4].map(i => html`<input class="gt" type="number" inputmode="numeric" step="5" placeholder="Z${i + 1}" value="${fl[i] != null ? fl[i] : ''}" data-zi="${i}">`)}</div></div></div>` : ''}
    <p class="hint">Counts and sums come from your log; heart-rate-range minutes from <code>cardio-buckets.csv</code> for Garmin activities in your log; steps, sleep, HRV and resting HR from <code>daily-wellness.csv</code>. Saved to <code>goals.json</code>.</p>`);
}

function renderGoals(p) {
  if (!p || !p.refresh) GE = JSON.parse(JSON.stringify(goalsCfg() || defaultGoals()));
  draw();
}

function addPicker() {
  modal(html`<h2>Add goal</h2><div class="mlist">${GOAL_PRESETS.map((p, i) => p.pickHr && !haveBuckets() ? '' : html`<div class="sl" ${act('goal-preset', { i })}><span>${p.label}</span><span class="ch">›</span></div>`)}</div><div class="mbs"><button class="mc2" ${act('modal-close')}>Cancel</button></div>`);
}

function pushGoal(p) { p.id = slug(p.label) + '-' + Date.now().toString(36); GE.goals.push(p); closeModal(); draw(); }

screen('goals', renderGoals);
on('goal-add', addPicker);
on('goal-rm', d => { GE.goals.splice(Number(d.i), 1); draw(); });
on('goal-preset', d => {
  const p = JSON.parse(JSON.stringify(GOAL_PRESETS[Number(d.i)]));
  if (p.pick) {
    const opts = machineOptions(S.gyms);
    modal(html`<h2>${p.label.replace('…', '')}</h2><div class="mr"><label>Exercise</label><select id="gpm">${opts.map(o => html`<option value="${o.id}">${o.label}</option>`)}</select></div><div class="mr"><label>Weekly target</label><input id="gpt" type="number" inputmode="decimal" value="${p.target}"></div><div class="mbs"><button class="mc2" ${act('modal-close')}>Cancel</button><button class="mo" ${act('goal-pick-done', { i: d.i })}>Add</button></div>`);
    return;
  }
  if (p.pickHr) {
    modal(html`<h2>Minutes in a heart-rate range</h2><p class="mdp">Counts Garmin minutes from the first number up to (not including) the second. Leave one blank for “under” or “and above”. Use multiples of 5.</p><div class="mr"><label>From (bpm)</label><input id="ghlo" type="number" inputmode="numeric" step="5" value="${p.hrMin}"></div><div class="mr"><label>Up to (bpm)</label><input id="ghhi" type="number" inputmode="numeric" step="5" value="${p.hrMax}"></div><div class="mr"><label>Weekly target (min)</label><input id="gpt" type="number" inputmode="decimal" value="${p.target}"></div><div class="mbs"><button class="mc2" ${act('modal-close')}>Cancel</button><button class="mo" ${act('goal-hr-done', { i: d.i })}>Add</button></div>`);
    return;
  }
  pushGoal(p);
});
on('goal-pick-done', d => {
  const p = JSON.parse(JSON.stringify(GOAL_PRESETS[Number(d.i)])); delete p.pick;
  const mid = val('gpm'); if (!mid) return;
  p.machineIds = [mid]; p.label = `${machineName(mid)} ${p.field === 'reps' ? 'reps' : 'seconds'}`;
  p.target = numVal('gpt') ?? p.target;
  pushGoal(p);
});
on('goal-hr-done', d => {
  const p = JSON.parse(JSON.stringify(GOAL_PRESETS[Number(d.i)])); delete p.pickHr;
  const lo = numVal('ghlo'), hi = numVal('ghhi');
  if (lo == null && hi == null) { toast('Enter at least one heart rate', 'err'); return; }
  if (lo != null && hi != null && hi <= lo) { toast('“Up to” must be higher than “From”', 'err'); return; }
  if (lo == null) delete p.hrMin; else p.hrMin = lo;
  if (hi == null) delete p.hrMax; else p.hrMax = hi;
  p.label = `Minutes at ${hrRangeText(p.hrMin, p.hrMax)}`;
  p.target = numVal('gpt') ?? p.target;
  pushGoal(p);
});
on('modal-close', () => closeModal());
on('goals-save', async () => {
  if (!hasCfg()) { toast('Set up GitHub in Settings first', 'err'); return; }
  if (!GE) return;
  // pull live field values
  GE.weekStart = ($('gws') || {}).value || GE.weekStart;
  qsa('[data-gi]').forEach(el => { const g = GE.goals[Number(el.dataset.gi)]; if (!g) return; if (el.dataset.k === 'target') g.target = parseFloat(el.value) || 0; else g.label = el.value; });
  const zs = qsa('[data-zi]'); if (zs.length) GE.hrZones = zs.map(el => { const n = parseFloat(el.value); return isNaN(n) ? null : n; });
  const c = cleanGoalsConfig(GE);
  if (!c.ok) { toast(c.error, 'err'); return; }
  showLoading('Saving goals…');
  try { await saveGoals(c.goals); toast('Goals saved', 'ok'); renderHome(); back(); }
  catch (e) { toast(`Save failed: ${e.message}`, 'err'); }
  finally { hideLoading(); }
});
