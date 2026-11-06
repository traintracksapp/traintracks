/**
 * Today's Plan (suggested-workout.json, written by the coach). Pure helpers:
 * match plan exercises to the user's equipment and log, and compute progress.
 *
 * {
 *   generatedAt, coachNote,
 *   exercises: [ { machineId, gymId?, machine, gym, room, sets:[{set,weight,reps,duration,level}], note } ]
 * }
 *
 * Everything in this file comes from a file the coach (an LLM) wrote, so it
 * is treated as untrusted: nothing here is ever interpolated into HTML.
 */

/** Find the (gym, room, machine) a plan exercise refers to, or null. gymId wins; falls back to the first gym with that machineId. */
export function resolveExercise(gyms, ex) {
  if (!ex || !ex.machineId) return null;
  for (const g of gyms || []) {
    if (ex.gymId && g.id !== ex.gymId) continue;
    for (const r of g.rooms || []) {
      const m = (r.machines || []).find(m => m.id === ex.machineId);
      if (m) return { gym: g, room: r, machine: m };
    }
  }
  return null;
}

/** Which plan exercises have a log entry today. */
export function planStatus(plan, log, today) {
  const ex = (plan && plan.exercises) || [];
  const logged = new Set((log || []).filter(e => e.date === today).map(e => e.gymId ? `${e.gymId}:${e.machineId}` : e.machineId));
  const done = ex.filter(e => logged.has(e.machineId) || (e.gymId && logged.has(`${e.gymId}:${e.machineId}`)) || [...logged].some(k => k.endsWith(':' + e.machineId)));
  return { done: done.length, total: ex.length, doneIds: new Set(done.map(e => e.machineId)) };
}

/** "60lbs×12, 80lbs×10" for a plan exercise. */
export function fmtPlanSets(sets) {
  return (sets || []).map(s => s.duration != null ? `${s.duration}${s.unit === 'min' ? 'min' : 'sec'}` : s.weight != null ? `${s.weight}lbs×${s.reps}` : s.reps != null ? `${s.reps} reps` : s.level != null ? `${s.level}` : '').filter(Boolean).join(', ');
}

/** Prefill rows for the log form from a plan exercise. */
export function prefillFromPlan(ex) {
  return ((ex && ex.sets) || []).map((s, i) => ({ set: i + 1, weight: s.weight ?? '', reps: s.reps ?? '', duration: s.duration ?? '', level: s.level ?? '', incline: s.incline ?? '', hr: '' }));
}

/** Sanity-check a plan file. Returns a list of problems (empty = fine). */
export function validatePlan(plan) {
  const problems = [];
  if (!plan || typeof plan !== 'object') return ['not an object'];
  if (!Array.isArray(plan.exercises)) problems.push('exercises is not an array');
  (plan.exercises || []).forEach((e, i) => {
    if (!e || typeof e !== 'object') { problems.push(`exercise ${i} is not an object`); return; }
    if (!e.machineId) problems.push(`exercise ${i} has no machineId`);
    if (e.sets && !Array.isArray(e.sets)) problems.push(`exercise ${i} sets is not an array`);
  });
  return problems;
}
