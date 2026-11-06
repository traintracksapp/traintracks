import test from 'node:test';
import assert from 'node:assert/strict';
import { resolveExercise, planStatus, fmtPlanSets, validatePlan } from '../lib/plan.js';
import { inScope, planUpdate, treeToMap, compareVersions, changelogBetween } from '../lib/updater.js';
import { applyGenericOverrides, serialiseGym, findMachine, newGym, machineOptions } from '../lib/gyms.js';

const gyms = [
  { id: 'generic', name: 'Common', rooms: [{ id: 'bw', name: 'BW', machines: [{ id: 'push-ups', name: 'Push Ups', logType: 'reps' }] }] },
  { id: 'a', name: 'A', rooms: [{ id: 'r', name: 'R', machines: [{ id: 'pm02', name: 'Row', logType: 'weight' }] }] },
  { id: 'b', name: 'B', rooms: [{ id: 'r', name: 'R', machines: [{ id: 'pm02', name: 'Row B', logType: 'weight' }] }] }
];

test('resolveExercise prefers gymId, falls back to first match', () => {
  assert.equal(resolveExercise(gyms, { machineId: 'pm02', gymId: 'b' }).machine.name, 'Row B');
  assert.equal(resolveExercise(gyms, { machineId: 'pm02' }).gym.id, 'a');
  assert.equal(resolveExercise(gyms, { machineId: 'nope' }), null);
  assert.equal(resolveExercise(gyms, { machineId: 'pm02', gymId: 'zzz' }), null);
});

test('planStatus counts logged-today exercises', () => {
  const plan = { exercises: [{ machineId: 'pm02', gymId: 'a' }, { machineId: 'push-ups' }, { machineId: 'x' }] };
  const log = [{ date: '2026-11-05', machineId: 'pm02', gymId: 'a' }, { date: '2026-11-05', machineId: 'push-ups' }, { date: '2026-11-04', machineId: 'x' }];
  const s = planStatus(plan, log, '2026-11-05');
  assert.equal(s.done, 2); assert.equal(s.total, 3);
  assert.equal(fmtPlanSets([{ weight: 60, reps: 12 }, { reps: 20 }, { duration: 45 }]), '60lbs×12, 20 reps, 45sec');
  assert.deepEqual(validatePlan({ exercises: [{ machineId: 'a' }] }), []);
  assert.ok(validatePlan({ exercises: [{}] }).length);
});

test('updater scope and plan', () => {
  assert.ok(inScope('index.html')); assert.ok(inScope('app/ui/home.js')); assert.ok(inScope('equipment/generic/images/x.jpg'));
  assert.ok(!inScope('workout-log.json')); assert.ok(!inScope('equipment/my-gyms/a/gym.json')); assert.ok(!inScope('.github/workflows/garmin.yml')); assert.ok(!inScope('equipment/generic.local.json'));
  const p = planUpdate({ 'index.html': '1', 'app/a.js': '2', 'lib/new.js': '3', 'workout-log.json': '9' }, { 'index.html': '1', 'app/a.js': 'old' });
  assert.deepEqual(p.changed, ['app/a.js']); assert.deepEqual(p.added, ['lib/new.js']); assert.equal(p.unchanged, 1);
  assert.deepEqual(treeToMap({ tree: [{ path: 'a', type: 'blob', sha: 's' }, { path: 'd', type: 'tree', sha: 't' }] }), { a: 's' });
});

test('version compare and changelog slicing', () => {
  assert.equal(compareVersions('0.1.0', '0.1.0'), 0);
  assert.equal(compareVersions('0.2', '0.10.0'), -1);
  assert.equal(compareVersions('1.0.0', '0.9.9'), 1);
  const cl = '# Changelog\n\n## 0.3.0\n- c\n\n## 0.2.0\n- b\n\n## 0.1.0\n- a\n';
  assert.equal(changelogBetween(cl, '0.1.0', '0.3.0'), '## 0.3.0\n- c\n\n## 0.2.0\n- b');
  assert.equal(changelogBetween(cl, '0.3.0', '0.3.0'), '');
});

test('generic overrides merge: hidden, added machines, added rooms', () => {
  const generic = { id: 'generic', name: 'Common', rooms: [{ id: 'bw', name: 'BW', machines: [{ id: 'push-ups', name: 'Push Ups', logType: 'reps' }] }] };
  const g = applyGenericOverrides(generic, { hidden: ['push-ups'], machines: [{ roomId: 'outdoor', id: 'm1', name: 'Jog', logType: 'walk' }, { roomId: 'bw', id: 'push-ups', name: 'Push-ups!' }], rooms: [{ id: 'outdoor', name: 'Outdoor' }] });
  assert.equal(g._readonly, true);
  assert.equal(g.rooms.length, 2);
  assert.equal(g.rooms[0].machines[0].hidden, true);
  assert.equal(g.rooms[0].machines[0].name, 'Push-ups!');
  assert.equal(g.rooms[1].machines[0].id, 'm1');
  assert.equal(generic.rooms.length, 1); // input untouched
  assert.equal(applyGenericOverrides(generic, null).rooms[0].machines[0].hidden, undefined);
});

test('serialiseGym drops runtime fields and keeps hidden', () => {
  const g = { ...newGym('My Gym'), _path: 'x', _readonly: false, version: 2 };
  g.rooms[0].machines.push({ id: 'm1', name: 'A', hidden: true, _local: true });
  const d = serialiseGym(g);
  assert.equal(d._path, undefined); assert.equal(d.version, 2); assert.equal(d.id, 'my-gym');
  assert.deepEqual(d.rooms[0].machines[0], { id: 'm1', name: 'A', musclesWorked: '', image: null, logType: 'weight', hidden: true });
  assert.equal(findMachine(gyms, 'pm02', 'b').machine.name, 'Row B');
  assert.equal(machineOptions(gyms).length, 3);
});
