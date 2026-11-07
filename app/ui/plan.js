/** Today's Route: the plan the coach wrote, drawn as stops on a line; and its card on home. */
import { S, hasCfg } from '../state.js';
import { html, act, setHTML, on, toast, showLoading, hideLoading, confirmDialog } from './dom.js';
import { screen, home, current } from './nav.js';
import { dismissPlan } from '../data.js';
import { homeSection } from './home.js';
import { planStatus, resolveExercise, fmtPlanSets, validatePlan, prefillFromPlan } from '../../lib/plan.js';
import { normalizeVariant } from '../../lib/variant.js';
import { localDate } from '../../lib/dates.js';
import { STORAGE } from '../../lib/config.js';
import { startLog, logHooks } from './logform.js';
import { celebrate } from './celebrate.js';

const exercises = () => (S.plan && Array.isArray(S.plan.exercises) ? S.plan.exercises : []);
const fmtWhen = s => { const d = s ? new Date(s) : null; return d && !isNaN(d) ? d.toLocaleString('en-US', { weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }) : ''; };

function renderPlan() {
  const p = S.plan;
  if (!p) { setHTML('planbody', html`<div class="empty"><div class="icon">🛤️</div><p>No route today.<br>Ask your coach to plan one.</p></div>`); return; }
  const problems = validatePlan(p);
  const st = planStatus(p, S.log, localDate());
  let nextMarked = false;
  const stops = exercises().map((e, i) => {
    if (!e || typeof e !== 'object') return '';
    const done = st.doneIdx.has(i), found = resolveExercise(S.gyms, e);
    const next = !done && !nextMarked;
    if (next) nextMarked = true;
    const v = normalizeVariant(e.variant);
    const sets = fmtPlanSets(e.sets);
    return html`<div class="stop ${done ? 'done' : ''} ${next ? 'next' : ''}" ${act('plan-log', { i })}>
      <div class="tx"><div class="nm">${done ? '✓ ' : ''}${e.machine || e.machine_id}${v.length ? html` <span class="vchips">${v.map(t => html`<span class="vchip">${t}</span>`)}</span>` : ''}</div><div class="gy">${found ? `${found.gym.name}${found.gym.rooms.length > 1 ? ' · ' + found.room.name : ''}` : 'Not in your equipment'}</div>${sets ? html`<div class="ss">${sets}</div>` : ''}${typeof e.note === 'string' && e.note ? html`<div class="nt">${e.note}</div>` : ''}</div>
      <span class="mk">${done ? '✓' : found ? '›' : '?'}</span></div>`;
  });
  const all = st.total > 0 && st.done === st.total;
  setHTML('planbody', html`${typeof p.coach_note === 'string' && p.coach_note ? html`<div class="coach">${p.coach_note}</div>` : ''}
    ${problems.length ? html`<div class="banner bad">This plan file has problems: ${problems.join('; ')}</div>` : ''}
    <div class="pprog ${all ? 'all' : ''}" ${all ? act('celebrate') : ''}><span><b>${st.done}</b> of ${st.total} stops logged${all ? ' 🏁' : ''}</span><span>${fmtWhen(p.generated_at)}</span></div>
    <div class="sh">Stops · tap to log</div>
    <div class="route">${stops}</div>
    <div style="padding:8px 16px 24px"><button class="btn ghost" ${act('plan-dismiss')}>✕ Dismiss route</button></div>`);
}

function planCard() {
  const p = S.plan;
  if (!p) return '';
  const st = planStatus(p, S.log, localDate());
  return html`<div class="sh first">Today's route</div>
    <div class="pc" ${act('nav', { to: 'plan' })}>
      <div class="pch"><span class="pcn">${st.done === st.total && st.total ? 'All stops done 🏁' : 'Route ready 🚂'}</span><span class="pct">${fmtWhen(p.generated_at).replace(/,? \d+:\d+.*$/, '')}</span></div>
      ${typeof p.coach_note === 'string' && p.coach_note ? html`<div class="pce">${p.coach_note}</div>` : ''}
      <div class="pcf"><b>${st.done}</b> of <b>${st.total}</b> stop${st.total === 1 ? '' : 's'} logged ›</div>
    </div>`;
}

/** After a session logged from the plan is saved: refresh, and celebrate once per plan when all stops are done. */
function afterPlanLog() {
  if (current() === 'plan') renderPlan();
  const st = planStatus(S.plan, S.log, localDate());
  if (!st.total || st.done < st.total) return;
  const key = S.plan.generated_at || localDate();
  try { if (localStorage.getItem(STORAGE.celebrated) === key) return; localStorage.setItem(STORAGE.celebrated, key); } catch { /* ignore */ }
  setTimeout(() => celebrate(st.total), 400);
}

logHooks.afterPlanLog = afterPlanLog;
logHooks.planSets = (gym, machine) => {
  const e = exercises().find(x => x && x.machine_id === machine.id && (!x.gym_id || x.gym_id === gym.id));
  return e ? { sets: prefillFromPlan(e), note: typeof e.note === 'string' ? e.note : '' } : null;
};

screen('plan', renderPlan);
homeSection(planCard);
on('plan-log', d => {
  const e = exercises()[Number(d.i)];
  if (!e) return;
  const found = resolveExercise(S.gyms, e);
  if (!found) { toast('That machine is not in your equipment', 'err'); return; }
  S.gym = found.gym; S.room = found.room; S.machine = found.machine;
  startLog(null, { fromPlan: true, variant: normalizeVariant(e.variant) });
});
on('celebrate', () => celebrate(planStatus(S.plan, S.log, localDate()).total));
on('plan-dismiss', async () => {
  if (!await confirmDialog('Dismiss this route?', 'The plan file is removed from your repo. Your coach can write a new one any time.', { ok: 'Dismiss', danger: true })) return;
  showLoading('Dismissing…');
  try { if (hasCfg()) await dismissPlan(); else S.plan = null; toast('Route dismissed', 'ok'); home(); }
  catch (e) { toast(`Could not dismiss: ${e.message}`, 'err'); }
  finally { hideLoading(); }
});
