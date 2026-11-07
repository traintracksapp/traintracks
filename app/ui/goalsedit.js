/** Weekly goals editor. Works on a copy until Save. Targets are shown in display units, stored in field units. */
import { S, hasCfg, goalsCfg } from '../state.js';
import { html, act, setHTML, on, toast, modal, closeModal, val, numVal, showLoading, hideLoading, qsa, $ } from './dom.js';
import { screen, back } from './nav.js';
import { saveGoals } from '../data.js';
import { renderHome } from './home.js';
import { defaultGoals, GOAL_PRESETS, isHrRangeGoal, hrRangeText, cleanGoalsConfig, toStored, fromStored } from '../../lib/goals.js';
import { eachMachine, findMachine, slug } from '../../lib/gyms.js';

let GE = null;
const haveBuckets = () => Object.keys(S.buckets).length > 0;
const machineName = id => { const f = findMachine(S.gyms, id); return f ? f.machine.name : id; };
const unitWord = d => (d === 'h' ? 'hours' : d === 'min' ? 'minutes' : d === 's' ? 'seconds' : '');
const FIELD_WORDS = { reps: 'reps', duration_sec: 'time', weight_lb: 'weight', steps: 'steps', sleep_sec: 'sleep', hrv_ms: 'HRV', resting_hr_bpm: 'resting heart rate' };

function kindText(g) {
  if (g.kind === 'days') return `Days with ${g.filter === 'any' ? 'a workout' : g.filter}`;
  if (isHrRangeGoal(g)) return `Garmin time · ${hrRangeText(g.hr_min_bpm, g.hr_max_bpm)}`;
  const w = FIELD_WORDS[g.field] || String(g.field || '').replace(/_/g, ' ');
  if (g.source === 'wellness') return `${g.kind === 'avg' ? 'Weekly average' : 'Weekly total'} of ${w}${g.direction === 'below' ? ' (lower is better)' : ''}`;
  const vf = g.variants && g.variants.length ? ` (${g.variants.join(', ')} only)` : '';
  if (g.machine_ids && g.machine_ids.length) return `Total ${w} · ${g.machine_ids.map(machineName).join(', ')}${vf}`;
  return `Weekly total of ${w}`;
}

function draw() {
  const days = [['sat', 'Saturday'], ['sun', 'Sunday'], ['mon', 'Monday'], ['tue', 'Tuesday'], ['wed', 'Wednesday'], ['thu', 'Thursday'], ['fri', 'Friday']];
  const fl = GE.hr_zones_bpm || [];
  setHTML('goalsbody', html`<div class="sh first">Week</div><div class="card"><div class="si"><label for="gws">Starts on</label><select id="gws">${days.map(([v, n]) => html`<option value="${v}" ${GE.week_start === v ? 'selected' : ''}>${n}</option>`)}</select></div></div>
    <div class="sh">Goals</div><div class="card">${GE.goals.length ? GE.goals.map((g, i) => html`<div class="gl"><div class="gn"><input type="text" value="${g.label}" data-gi="${i}" data-k="label" aria-label="Goal name"><div class="gk">${kindText(g)}${g.display ? ` · target in ${unitWord(g.display)}` : ''}</div></div><input class="gt" type="number" inputmode="decimal" step="any" value="${fromStored(g.target, g.display)}" data-gi="${i}" data-k="target" aria-label="Target"><button class="xb" ${act('goal-rm', { i })} aria-label="Remove">×</button></div>`) : html`<div class="empty" style="padding:20px"><p>No goals yet.</p></div>`}</div>
    <button class="btn dashed" ${act('goal-add')}>＋ Add goal</button>
    ${haveBuckets() || fl.length ? html`<div class="sh">Heart-rate zones</div><div class="card"><div class="gl" style="flex-wrap:wrap"><div class="gn" style="flex-basis:100%"><div style="font-size:14px;font-weight:650">Zone floors (bpm)</div><div class="gk">Where each zone starts. Garmin data is stored in 5-bpm buckets, so use multiples of 5. This only changes how zones are shown; nothing stored is rewritten.</div></div><div class="zones">${[0, 1, 2, 3, 4].map(i => html`<input class="gt" type="number" inputmode="numeric" step="5" placeholder="Z${i + 1}" value="${fl[i] != null ? fl[i] : ''}" data-zi="${i}" aria-label="Zone ${i + 1} floor">`)}</div></div></div>` : ''}
    <p class="hint">Counts and sums come from your log (every variation of an exercise counts); heart-rate time from <code>cardio-buckets.csv</code> for Garmin activities in your log; steps, sleep, HRV and resting heart rate from <code>daily-wellness.csv</code>. Saved to <code>goals.json</code>.</p>`);
}

/** Copy typed values into the working copy (before redrawing or saving). */
function capture() {
  if (!GE) return;
  GE.week_start = ($('gws') || {}).value || GE.week_start;
  for (const el of qsa('[data-gi]')) {
    const g = GE.goals[Number(el.dataset.gi)];
    if (!g) continue;
    if (el.dataset.k === 'target') g.target = toStored(parseFloat(el.value) || 0, g.display);
    else g.label = el.value;
  }
  const zs = qsa('[data-zi]');
  if (zs.length) GE.hr_zones_bpm = zs.map(el => { const n = parseFloat(el.value); return isNaN(n) ? null : n; });
}

function renderGoals(p) {
  if (!p || !p.refresh) GE = structuredClone(goalsCfg() || defaultGoals());
  draw();
}

function machineOptions() {
  const out = [];
  eachMachine(S.gyms, (g, r, m) => { if (!m.hidden && !out.find(o => o.id === m.id)) out.push({ id: m.id, label: `${m.name} (${g.name})` }); });
  return out.sort((a, b) => a.label.localeCompare(b.label));
}

function pushGoal(p) {
  capture();
  p.id = `${slug(p.label)}-${Date.now().toString(36)}`;
  GE.goals.push(p);
  closeModal();
  draw();
}

screen('goals', renderGoals);
on('goal-add', () => modal(html`<h2>Add goal</h2><div class="mlist">${GOAL_PRESETS.map((p, i) => (p.pick_hr && !haveBuckets() ? '' : html`<div class="sl" ${act('goal-preset', { i })}><span>${p.label}</span><span class="ch">›</span></div>`))}</div><div class="mbs"><button class="mc2" ${act('modal-close')}>Cancel</button></div>`));
on('goal-rm', d => { capture(); GE.goals.splice(Number(d.i), 1); draw(); });
on('goal-preset', d => {
  const p = structuredClone(GOAL_PRESETS[Number(d.i)]);
  if (p.pick) {
    modal(html`<h2>${p.label.replace('…', '')}</h2><div class="mr"><label for="gpm">Exercise</label><select id="gpm">${machineOptions().map(o => html`<option value="${o.id}">${o.label}</option>`)}</select></div><div class="mr"><label for="gpt">Weekly target${p.display ? ` (${unitWord(p.display)})` : ''}</label><input id="gpt" type="number" inputmode="decimal" value="${fromStored(p.target, p.display)}"></div><div class="mr"><label for="gpv">Only these variations (optional)</label><input id="gpv" type="text" placeholder="e.g. decline" autocapitalize="none"></div><div class="mbs"><button class="mc2" ${act('modal-close')}>Cancel</button><button class="mo" ${act('goal-pick-done', { i: d.i })}>Add</button></div>`);
    return;
  }
  if (p.pick_hr) {
    modal(html`<h2>Time in a heart-rate range</h2><p class="mdp">Counts Garmin time from the first number up to (not including) the second. Leave one blank for “under” or “and above”. Use multiples of 5.</p><div class="mr"><label for="ghlo">From (bpm)</label><input id="ghlo" type="number" inputmode="numeric" step="5" value="${p.hr_min_bpm}"></div><div class="mr"><label for="ghhi">Up to (bpm)</label><input id="ghhi" type="number" inputmode="numeric" step="5" value="${p.hr_max_bpm}"></div><div class="mr"><label for="gpt">Weekly target (minutes)</label><input id="gpt" type="number" inputmode="decimal" value="${fromStored(p.target, 'min')}"></div><div class="mbs"><button class="mc2" ${act('modal-close')}>Cancel</button><button class="mo" ${act('goal-hr-done', { i: d.i })}>Add</button></div>`);
    return;
  }
  pushGoal(p);
});
on('goal-pick-done', d => {
  const p = structuredClone(GOAL_PRESETS[Number(d.i)]);
  delete p.pick;
  const mid = val('gpm');
  if (!mid) return;
  p.machine_ids = [mid];
  const tags = val('gpv').split(',').map(t => t.trim().toLowerCase()).filter(Boolean);
  if (tags.length) p.variants = tags;
  p.label = `${machineName(mid)}${tags.length ? ` (${tags.join(', ')})` : ''} ${p.field === 'reps' ? 'reps' : 'seconds'}`;
  const t = numVal('gpt');
  if (t != null) p.target = toStored(t, p.display);
  pushGoal(p);
});
on('goal-hr-done', d => {
  const p = structuredClone(GOAL_PRESETS[Number(d.i)]);
  delete p.pick_hr;
  const lo = numVal('ghlo'), hi = numVal('ghhi');
  if (lo == null && hi == null) { toast('Enter at least one heart rate', 'err'); return; }
  if (lo != null && hi != null && hi <= lo) { toast('“Up to” must be higher than “From”', 'err'); return; }
  if (lo == null) delete p.hr_min_bpm; else p.hr_min_bpm = lo;
  if (hi == null) delete p.hr_max_bpm; else p.hr_max_bpm = hi;
  p.label = `Minutes at ${hrRangeText(p.hr_min_bpm, p.hr_max_bpm)}`;
  const t = numVal('gpt');
  if (t != null) p.target = toStored(t, 'min');
  pushGoal(p);
});
on('modal-close', () => closeModal());
on('goals-save', async () => {
  if (!hasCfg()) { toast('Set up GitHub in Settings first', 'err'); return; }
  if (!GE) return;
  capture();
  const c = cleanGoalsConfig(GE);
  if (!c.ok) { toast(c.error, 'err'); return; }
  showLoading('Saving goals…');
  try { await saveGoals(c.goals); toast('Goals saved', 'ok'); renderHome(); back(); }
  catch (e) { toast(`Save failed: ${e.message}`, 'err'); }
  finally { hideLoading(); }
});
