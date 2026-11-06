/** Today's Route — the plan the coach wrote, drawn as stops on a rail line. */
import { S, hasCfg } from '../state.js';
import { html, act, setHTML, on, toast, showLoading, hideLoading, confirmDialog } from './dom.js';
import { screen, nav, home, back, current } from './nav.js';
import { dismissPlan } from '../data.js';
import { planStatus, resolveExercise, fmtPlanSets, validatePlan } from '../../lib/plan.js';
import { todayStr } from '../../lib/format.js';
import { STORAGE } from '../../lib/config.js';
import { startLog } from './logform.js';
import { celebrate } from './celebrate.js';

function renderPlan() {
  const p = S.plan;
  if (!p) { setHTML('planbody', html`<div class="empty"><div class="icon">🛤️</div><p>No route today.<br>Ask your coach to plan one.</p></div>`); return; }
  const problems = validatePlan(p);
  const st = planStatus(p, S.log, todayStr());
  const ex = p.exercises || [];
  let nextMarked = false;
  const stops = ex.map((e, i) => {
    const done = st.doneIds.has(e.machineId);
    const found = resolveExercise(S.gyms, e);
    const next = !done && !nextMarked; if (next) nextMarked = true;
    const sets = fmtPlanSets(e.sets);
    return html`<div class="stop ${done ? 'done' : ''} ${next ? 'next' : ''}" ${act('plan-log', { i })}>
      <div class="tx"><div class="nm">${done ? '✓ ' : ''}${e.machine || e.machineId}</div><div class="gy">${found ? `${found.gym.name}${found.gym.rooms.length > 1 ? ' · ' + found.room.name : ''}` : 'Not in your equipment'}</div>${sets ? html`<div class="ss">${sets}</div>` : ''}${e.note ? html`<div class="nt">${e.note}</div>` : ''}</div>
      <span class="mk">${done ? '✓' : found ? '›' : '?'}</span></div>`;
  });
  const all = st.total > 0 && st.done === st.total;
  setHTML('planbody', html`${p.coachNote ? html`<div class="coach">${p.coachNote}</div>` : ''}
    ${problems.length ? html`<div class="banner bad">This plan file has problems: ${problems.join('; ')}</div>` : ''}
    <div class="pprog ${all ? 'all' : ''}" ${all ? act('celebrate') : ''}><span><b>${st.done}</b> of ${st.total} stops logged${all ? ' 🏁' : ''}</span><span>${p.generatedAt ? new Date(p.generatedAt).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }) : ''}</span></div>
    <div class="sh">Stops — tap to log</div>
    <div class="route">${stops}</div>
    <div style="padding:8px 16px 24px"><button class="btn ghost" ${act('plan-dismiss')}>✕ Dismiss route</button></div>`);
}

/** Called after a session logged from the plan was saved. */
export function afterPlanLog() {
  if (current() === 'plan') renderPlan();
  const st = planStatus(S.plan, S.log, todayStr());
  if (!st.total || st.done < st.total) return;
  const key = S.plan.generatedAt || todayStr();
  try { if (localStorage.getItem(STORAGE.celebrated) === key) return; localStorage.setItem(STORAGE.celebrated, key); } catch (e) { /* ignore */ }
  setTimeout(() => celebrate(st.total), 400);
}

screen('plan', renderPlan);
on('plan-log', d => {
  const e = (S.plan.exercises || [])[Number(d.i)]; if (!e) return;
  const found = resolveExercise(S.gyms, e);
  if (!found) { toast('That machine is not in your equipment', 'err'); return; }
  S.gym = found.gym; S.room = found.room; S.machine = found.machine;
  startLog(null, { fromPlan: true });
});
on('celebrate', () => celebrate(planStatus(S.plan, S.log, todayStr()).total));
on('plan-dismiss', async () => {
  const ok = await confirmDialog('Dismiss this route?', 'The plan file is removed from your repo. Your coach can write a new one any time.', { ok: 'Dismiss', danger: true });
  if (!ok) return;
  showLoading('Dismissing…');
  try { if (hasCfg()) await dismissPlan(); else S.plan = null; toast('Route dismissed', 'ok'); home(); }
  catch (e) { toast(`Could not dismiss: ${e.message}`, 'err'); }
  finally { hideLoading(); }
});
