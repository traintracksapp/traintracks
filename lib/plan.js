/**
 * Today's Plan (suggested-workout.json, written by the coach). Pure helpers.
 *
 * { generated_at, coach_note,
 *   exercises: [ { machine_id, gym_id?, machine, gym, room, variant?,
 *                  sets: [ { set, weight_lb, reps, duration_sec, distance_mi, speed_mph, incline_pct, level } ], note } ] }
 *
 * The file is written by an LLM, so it is untrusted: values are checked here
 * and everything shown goes through the escaping html template.
 */
import { normalizeVariant, sameVariant } from './variant.js';
import { fmtSet } from './format.js';

const PLAN_SET_FIELDS = ['weight_lb', 'reps', 'duration_sec', 'distance_mi', 'speed_mph', 'incline_pct', 'level', 'hr_avg_bpm'];

/** Keep only known numeric set fields with finite numbers. */
export function cleanPlanSet(s) {
  const out = {};
  if (!s || typeof s !== 'object') return out;
  for (const f of PLAN_SET_FIELDS) {
    const v = s[f];
    if (v == null || v === '') continue;
    const n = Number(v);
    if (isFinite(n)) out[f] = n;
  }
  return out;
}

/** The (gym, room, machine) a plan exercise refers to, or null. gym_id wins; otherwise the first gym with that machine id. */
export function resolveExercise(gyms, ex) {
  if (!ex || !ex.machine_id) return null;
  for (const g of gyms || []) {
    if (ex.gym_id && g.id !== ex.gym_id) continue;
    for (const r of g.rooms || []) {
      const m = (r.machines || []).find(x => x.id === ex.machine_id);
      if (m) return { gym: g, room: r, machine: m };
    }
  }
  return null;
}

/** Is a plan exercise logged today? Same machine (and gym, if given); with a variant, only that variant counts. */
export function exerciseDone(ex, log, today) {
  return (log || []).some(e => e.date === today && e.machine_id === ex.machine_id
    && (!ex.gym_id || !e.gym_id || e.gym_id === ex.gym_id)
    && (!ex.variant || !normalizeVariant(ex.variant).length || sameVariant(e.variant, ex.variant)));
}

/** { done, total, doneIdx: Set of exercise indexes } */
export function planStatus(plan, log, today) {
  const ex = (plan && Array.isArray(plan.exercises)) ? plan.exercises : [];
  const doneIdx = new Set(ex.map((e, i) => (e && exerciseDone(e, log, today) ? i : -1)).filter(i => i >= 0));
  return { done: doneIdx.size, total: ex.length, doneIdx };
}

/** "60 lb × 12, 80 lb × 10" */
export function fmtPlanSets(sets) {
  return (Array.isArray(sets) ? sets : []).map(s => cleanPlanSet(s)).filter(s => Object.keys(s).length).map(fmtSet).join(', ');
}

/** Rows for the log form from a plan exercise. */
export function prefillFromPlan(ex) {
  return (ex && Array.isArray(ex.sets) ? ex.sets : []).map(cleanPlanSet);
}

/** Problems with a plan file (empty = fine). */
export function validatePlan(plan) {
  if (!plan || typeof plan !== 'object') return ['not an object'];
  const problems = [];
  if (!Array.isArray(plan.exercises)) problems.push('exercises is not a list');
  (Array.isArray(plan.exercises) ? plan.exercises : []).forEach((e, i) => {
    if (!e || typeof e !== 'object') { problems.push(`exercise ${i + 1} is not an object`); return; }
    if (!e.machine_id) problems.push(`exercise ${i + 1} has no machine_id`);
    if (e.sets != null && !Array.isArray(e.sets)) problems.push(`exercise ${i + 1}: sets is not a list`);
  });
  return problems;
}
