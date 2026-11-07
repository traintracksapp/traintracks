import { test } from 'node:test';
import assert from 'node:assert/strict';
import { resolveExercise, planStatus, exerciseDone, fmtPlanSets, prefillFromPlan, validatePlan, cleanPlanSet } from '../lib/plan.js';

const gyms = [
  { id: 'generic', rooms: [{ id: 'bw', machines: [{ id: 'push-ups' }, { id: 'r02' }] }] },
  { id: 'eg', rooms: [{ id: 'w', machines: [{ id: 'r02' }] }] }
];

test('resolveExercise prefers gym_id, falls back to the first match', () => {
  assert.equal(resolveExercise(gyms, { machine_id: 'r02', gym_id: 'eg' }).gym.id, 'eg');
  assert.equal(resolveExercise(gyms, { machine_id: 'r02' }).gym.id, 'generic');
  assert.equal(resolveExercise(gyms, { machine_id: 'nope' }), null);
  assert.equal(resolveExercise(gyms, { machine_id: 'r02', gym_id: 'zzz' }), null);
  assert.equal(resolveExercise(gyms, null), null);
});

test('planStatus counts exercises logged today', () => {
  const plan = { exercises: [{ machine_id: 'push-ups' }, { machine_id: 'r02', gym_id: 'eg' }, { machine_id: 'squats' }] };
  const log = [
    { date: '2026-11-07', machine_id: 'push-ups', gym_id: 'generic' },
    { date: '2026-11-06', machine_id: 'squats' },
    { date: '2026-11-07', machine_id: 'r02', gym_id: 'generic' } // other gym: doesn't count for eg
  ];
  const st = planStatus(plan, log, '2026-11-07');
  assert.equal(st.total, 3);
  assert.equal(st.done, 1);
  assert.deepEqual([...st.doneIdx], [0]);
});

test('a planned variant is done only when that variant is logged', () => {
  const ex = { machine_id: 'push-ups', variant: ['decline'] };
  assert.equal(exerciseDone(ex, [{ date: 'd', machine_id: 'push-ups', variant: [] }], 'd'), false);
  assert.equal(exerciseDone(ex, [{ date: 'd', machine_id: 'push-ups', variant: ['decline'] }], 'd'), true);
  assert.equal(exerciseDone({ machine_id: 'push-ups' }, [{ date: 'd', machine_id: 'push-ups', variant: ['wide'] }], 'd'), true);
});

test('planStatus copes with a broken plan file', () => {
  assert.deepEqual(planStatus(null, [], 'd').total, 0);
  assert.deepEqual(planStatus({ exercises: 'x' }, [], 'd').total, 0);
  assert.equal(planStatus({ exercises: [null, { machine_id: 'a' }] }, [], 'd').total, 2);
});

test('cleanPlanSet keeps known numeric fields only (the plan is untrusted)', () => {
  assert.deepEqual(cleanPlanSet({ weight_lb: '60', reps: 12, evil: '<img>', duration_sec: 'abc', set: 1 }), { weight_lb: 60, reps: 12 });
  assert.deepEqual(cleanPlanSet('nope'), {});
});

test('fmtPlanSets / prefillFromPlan', () => {
  const sets = [{ set: 1, weight_lb: 60, reps: 15 }, { set: 2, weight_lb: 80, reps: 12 }];
  assert.equal(fmtPlanSets(sets), '60 lb × 15, 80 lb × 12');
  assert.deepEqual(prefillFromPlan({ sets }), [{ weight_lb: 60, reps: 15 }, { weight_lb: 80, reps: 12 }]);
  assert.equal(fmtPlanSets('x'), '');
  assert.deepEqual(prefillFromPlan({}), []);
});

test('validatePlan', () => {
  assert.deepEqual(validatePlan({ exercises: [{ machine_id: 'a', sets: [] }] }), []);
  assert.deepEqual(validatePlan(null), ['not an object']);
  assert.deepEqual(validatePlan({ exercises: [{}, 'x', { machine_id: 'a', sets: 3 }] }), ['exercise 1 has no machine_id', 'exercise 2 is not an object', 'exercise 3: sets is not a list']);
});
