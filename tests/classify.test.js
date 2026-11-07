import { test } from 'node:test';
import assert from 'node:assert/strict';
import { machineInfoMap, machineInfo, classifyEntry } from '../lib/classify.js';

// Ported from LogTrim tests/reports.test.js (classify), in version 2 field names.
const gyms = [
  { id: 'generic', rooms: [
    { id: 'outdoor-activities', machines: [{ id: 'walk', log_type: 'walk' }, { id: 'swim', log_type: 'time' }] },
    { id: 'bodyweight-no-equipment', machines: [{ id: 'push-ups', log_type: 'reps' }, { id: 'elbow-planks', log_type: 'time' }, { id: 'meditation', log_type: 'time' }] },
    { id: 'classes', machines: [{ id: 'spin-class', log_type: 'mins' }] }
  ] },
  { id: 'eg', rooms: [{ id: 'weights', machines: [{ id: 'r03', log_type: 'weight' }, { id: 'tread', log_type: 'cardio' }] }] }
];
const info = machineInfoMap(gyms);
const E = o => ({ gym_id: 'generic', date: '2026-11-05', ...o });
const c = o => classifyEntry(E(o), info);

test('classify: garmin walk with zones → cardio', () => assert.equal(c({ machine_id: 'walk', duration_sec: 2400, zone1_sec: 1800 }), 'cardio'));
test('classify: walk log_type without zones → cardio', () => assert.equal(c({ machine_id: 'walk', duration_sec: 2400 }), 'cardio'));
test('classify: swim (time, outdoor) → cardio', () => assert.equal(c({ machine_id: 'swim', duration_sec: 1800 }), 'cardio'));
test('classify: spin class (mins) → cardio', () => assert.equal(c({ machine_id: 'spin-class', duration_sec: 2700 }), 'cardio'));
test('classify: pushups (reps, no weight) → strength', () => assert.equal(c({ machine_id: 'push-ups', reps: 20 }), 'strength'));
test('classify: machine with weight → strength', () => assert.equal(c({ gym_id: 'eg', machine_id: 'r03', weight_lb: 100, reps: 10 }), 'strength'));
test('classify: plank (time) → strength', () => assert.equal(c({ machine_id: 'elbow-planks', duration_sec: 60 }), 'strength'));
test('classify: meditation (time) → other', () => assert.equal(c({ machine_id: 'meditation', duration_sec: 600 }), 'other'));
test('classify: legacy timed entry on unknown machine → cardio', () => assert.equal(c({ machine_id: 'm000', duration_sec: 1800 }), 'cardio'));
test('classify: unknown machine with reps → strength', () => assert.equal(c({ machine_id: 'm000', weight_lb: 50, reps: 12 }), 'strength'));
test('classify: incline treadmill entry → cardio', () => assert.equal(c({ machine_id: 'm000', duration_sec: 1800, incline_pct: 5 }), 'cardio'));

test('classify: speed, distance, heart rate or a Garmin link → cardio', () => {
  assert.equal(c({ machine_id: 'm000', speed_mph: 3.3 }), 'cardio');
  assert.equal(c({ machine_id: 'm000', distance_mi: 1.5 }), 'cardio');
  assert.equal(c({ machine_id: 'm000', hr_avg_bpm: 110 }), 'cardio');
  assert.equal(c({ machine_id: 'm000', garmin_id: '123456789' }), 'cardio');
  assert.equal(c({ machine_id: 'm000', notes: 'Garmin 12345678901' }), 'cardio');
});

test('classify: nothing recorded on an unknown machine → other', () => assert.equal(c({ machine_id: 'm000' }), 'other'));

test('machineInfo: gym-specific lookup wins; falls back to machine id for rows without gym_id', () => {
  const g2 = [{ id: 'a', rooms: [{ id: 'r', machines: [{ id: 'x', log_type: 'reps' }] }] },
              { id: 'b', rooms: [{ id: 'r', machines: [{ id: 'x', log_type: 'cardio' }] }] }];
  const m = machineInfoMap(g2);
  assert.equal(machineInfo(m, { gym_id: 'b', machine_id: 'x' }).log_type, 'cardio');
  assert.equal(machineInfo(m, { machine_id: 'x' }).log_type, 'reps');
  assert.equal(machineInfo(m, { gym_id: 'z', machine_id: 'nope' }), null);
});

test('machineInfoMap: log_type defaults to weight', () => {
  const m = machineInfoMap([{ id: 'g', rooms: [{ id: 'r', machines: [{ id: 'q' }] }] }]);
  assert.equal(m['g:q'].log_type, 'weight');
});
