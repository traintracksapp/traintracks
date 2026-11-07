import { test } from 'node:test';
import assert from 'node:assert/strict';
import { snake, convertGym, convertLocalOverrides, convertEntry, convertLog, v1MachineTypes, applyFixups } from '../lib/migrate.js';
import { LOG_COLUMNS } from '../lib/log.js';

// Version 1 fixtures (made-up gyms and ids).
const gyms = [
  { id: 'generic', name: 'Common Machines', isGeneric: true, rooms: [
    { id: 'outdoor-activities', name: 'Outdoor', machines: [{ id: 'walk', name: 'Walk', logType: 'walk', musclesWorked: '' }] },
    { id: 'bodyweight', name: 'Bodyweight', machines: [{ id: 'push-ups', name: 'Push Ups', logType: 'reps' }, { id: 'elbow-planks', name: 'Elbow Planks', logType: 'time' }] },
    { id: 'cardio', name: 'Cardio', machines: [{ id: 'elliptical', name: 'Elliptical', logType: 'pace' }, { id: 'treadmill', name: 'Treadmill', logType: 'cardio' }] },
    { id: 'classes', name: 'Classes', machines: [{ id: 'yoga', name: 'Yoga', logType: 'mins' }] }
  ] },
  { id: 'eg', name: 'Example Gym', rooms: [{ id: 'w', name: 'Weights', machines: [{ id: 'r02', name: 'Row', logType: 'weight' }, { id: 'tm', name: 'Treadmill', logType: 'cardio' }] }] }
];
const local = { hidden: [], machines: [{ roomId: 'outdoor-activities', id: 'm1700000000000', name: 'Jog', logType: 'walk', musclesWorked: '' }], rooms: [] };
const types = v1MachineTypes(gyms, local);
const V1 = o => ({ id: 'a1', machineId: 'r02', machine: 'Row', gymId: 'eg', gym: 'Example Gym', roomId: 'w', room: 'Weights',
  date: '2026-11-05', datetime: '2026-11-05 6:14:40 PM', set: 1, weight: null, reps: null, duration: null, level: null,
  incline: null, hr: null, notes: '', ...o });
const conv = o => convertEntry(V1(o), types).entry;

test('snake', () => {
  assert.equal(snake('logType'), 'log_type');
  assert.equal(snake('musclesWorked'), 'muscles_worked');
  assert.equal(snake('hrMin'), 'hr_min');
  assert.equal(snake('zone1'), 'zone1');
  assert.equal(snake('id'), 'id');
});

test('convertGym: snake_case keys at every level, values kept', () => {
  const g = convertGym(gyms[0]);
  assert.equal(g.is_generic, true);
  assert.equal(g.rooms[0].machines[0].log_type, 'walk');
  assert.equal(g.rooms[0].machines[0].muscles_worked, '');
  assert.ok(!('logType' in g.rooms[0].machines[0]));
});

test('convertLocalOverrides: machines and their room ids', () => {
  const l = convertLocalOverrides(local);
  assert.equal(l.machines[0].room_id, 'outdoor-activities');
  assert.equal(l.machines[0].log_type, 'walk');
  assert.equal(convertLocalOverrides(null), null);
});

test('every converted entry has only known v2 names or carried-over fields', () => {
  const e = conv({ weight: 60, reps: 12 });
  for (const k of Object.keys(e)) assert.ok(LOG_COLUMNS.includes(k), k);
});

test('ids and session keys renamed; datetime → 24-hour time', () => {
  const e = conv({});
  assert.equal(e.id, 'a1');
  assert.equal(e.gym_id, 'eg');
  assert.equal(e.machine_id, 'r02');
  assert.equal(e.room_id, 'w');
  assert.equal(e.time, '18:14:40');
  assert.deepEqual(e.variant, []);
  assert.ok(!('gymId' in e) && !('datetime' in e));
});

test('no datetime → empty time', () => assert.equal(conv({ datetime: undefined }).time, ''));

test('weight & reps', () => {
  const e = conv({ weight: 60, reps: 12 });
  assert.equal(e.weight_lb, 60);
  assert.equal(e.reps, 12);
});

test('time log type: duration already seconds', () => {
  assert.equal(conv({ gymId: 'generic', machineId: 'elbow-planks', duration: 60 }).duration_sec, 60);
});

test('mins log type: minutes → seconds', () => {
  assert.equal(conv({ gymId: 'generic', machineId: 'yoga', duration: 45 }).duration_sec, 2700);
});

test('walk: level is distance; fractional minutes rounded to whole seconds', () => {
  const e = conv({ gymId: 'generic', machineId: 'walk', duration: 52.85, level: 2.45, hr: 93 });
  assert.equal(e.distance_mi, 2.45);
  assert.equal(e.duration_sec, 3171);
  assert.equal(e.hr_avg_bpm, 93);
  assert.equal(e.level, null);
});

test('cardio, hand-logged: level is SPEED', () => {
  const e = conv({ machineId: 'tm', duration: 5, level: 3.3, incline: 4 });
  assert.equal(e.speed_mph, 3.3);
  assert.equal(e.distance_mi, null);
  assert.equal(e.incline_pct, 4);
  assert.equal(e.duration_sec, 300);
});

test('cardio, Garmin-linked: level is DISTANCE', () => {
  const e = conv({ machineId: 'tm', duration: 34.88333, level: 1.7, hr: 113, notes: 'Treadmill (Garmin 12345678901; 1.7 mi)' });
  assert.equal(e.distance_mi, 1.7);
  assert.equal(e.speed_mph, null);
  assert.equal(e.garmin_id, '12345678901');
  assert.equal(e.duration_sec, 2093);
});

test('pace: hand-logged level stays level; Garmin-linked is distance', () => {
  assert.equal(conv({ gymId: 'generic', machineId: 'elliptical', duration: 30, level: 8 }).level, 8);
  const g = conv({ gymId: 'generic', machineId: 'elliptical', duration: 30, level: 4.29, garminId: '123456789' });
  assert.equal(g.distance_mi, 4.29);
  assert.equal(g.garmin_id, '123456789');
});

test('zones: minutes → whole seconds', () => {
  const e = conv({ gymId: 'generic', machineId: 'elliptical', duration: 32.42, zone1: 1.97, zone2: 25.4, zone3: 4, zone4: 1, zone5: null, garminId: '1' });
  assert.equal(e.zone1_sec, 118);
  assert.equal(e.zone2_sec, 1524);
  assert.equal(e.zone3_sec, 240);
  assert.equal(e.zone4_sec, 60);
  assert.ok(!('zone5_sec' in e));
});

test('machines only in generic.local.json are found (e.g. a user-added Jog)', () => {
  const r = convertEntry(V1({ gymId: 'generic', machineId: 'm1700000000000', duration: 22.78, level: 1.33 }), types);
  assert.equal(r.entry.distance_mi, 1.33);
  assert.ok(!r.rules.includes('machine: not found in any gym'));
});

test('unknown machine: kept and reported; level kept as level because its meaning is unknown', () => {
  // Early rows on since-deleted machines used level for pace (min/mi) or distance.
  const r = convertEntry(V1({ gymId: undefined, machineId: 'Walk', gym: 'Old Gym', duration: 44, level: 20 }), types);
  assert.ok(r.rules.includes('machine: not found in any gym'));
  assert.equal(r.entry.level, 20);
  assert.equal(r.entry.distance_mi, null);
  assert.equal(r.entry.duration_sec, 2640);
  assert.equal(r.entry.machine_id, 'Walk');
});

test('fields version 2 does not know are carried over (snake_case)', () => {
  const e = conv({ someFutureField: 'x' });
  assert.equal(e.some_future_field, 'x');
});

test('numeric strings become numbers; blanks become null', () => {
  const e = conv({ weight: '60', reps: '', hr: undefined });
  assert.equal(e.weight_lb, 60);
  assert.equal(e.reps, null);
  assert.equal(e.hr_avg_bpm, null);
});

test('convertLog: one entry out per entry in, same order, counts and unknowns reported', () => {
  const log = [V1({ id: 'x', weight: 1, reps: 1 }), V1({ id: 'y', machineId: 'gone', gymId: undefined, gym: 'Old', machine: 'Gone', reps: 5 }), V1({ id: undefined })];
  const r = convertLog(log, gyms, local);
  assert.equal(r.log.length, 3);
  assert.deepEqual(r.log.slice(0, 2).map(e => e.id), ['x', 'y']);
  assert.ok(r.log[2].id);
  assert.equal(r.counts['id: added'], 1);
  assert.deepEqual(Object.keys(r.unknownMachines), ['Gone (Old, id gone)']);
  assert.deepEqual(r.problems, []);
});

test('convertLog: duplicate ids are fixed and reported', () => {
  const r = convertLog([V1({ id: 'd' }), V1({ id: 'd' })], gyms, local);
  assert.notEqual(r.log[0].id, r.log[1].id);
  assert.equal(r.problems.length, 1);
});

test('convertLog: negative reps are kept and listed for a decision', () => {
  const r = convertLog([V1({ id: 'n', reps: -4 })], gyms, local);
  assert.equal(r.log[0].reps, -4);
  assert.equal(r.problems.length, 1);
  assert.match(r.problems[0], /negative reps/);
});

test('convertLog: negative weight is assistance on an assisted machine, valid and not flagged', () => {
  const r = convertLog([V1({ id: 'a', weight: -100, reps: 10 }), V1({ id: 'b', weight: -85, reps: 7 })], gyms, local);
  assert.deepEqual(r.log.map(e => e.weight_lb), [-100, -85]);
  assert.deepEqual(r.problems, []);
  assert.equal(Math.max(...r.log.map(e => e.weight_lb)), -85); // less assistance = harder = "heavier"
});

test('convertLog does not modify its input', () => {
  const log = [V1({ weight: 5 })];
  convertLog(log, gyms, local);
  assert.equal(log[0].weight, 5);
  assert.ok('gymId' in log[0]);
});

// ---- corrections (applyFixups) ----
const gyms2 = [{ id: 'generic', name: 'Common Machines', rooms: [
  { id: 'outdoor-activities', name: 'Outdoor Activities', machines: [{ id: 'walk', name: 'Walk' }, { id: 'run', name: 'Run' }] },
  { id: 'bw', name: 'Bodyweight', machines: [{ id: 'pull-ups', name: 'Pull-ups' }, { id: 'negative-pullups', name: 'Negative Pullups' }, { id: 'push-ups', name: 'Push Ups' }] }
] }];
const V2 = o => ({ id: 'z', date: '2026-06-26', time: '', gym_id: undefined, gym: 'Old Park', room: 'Bars', machine_id: 'm9', machine: 'Pullups', set: 1, variant: [], reps: null, notes: '', ...o });

test('applyFixups: remap moves to the target machine and remembers where it came from', () => {
  const r = applyFixups([V2({ reps: 5 })], { remap: [{ machine_id: 'm9', to: 'generic:pull-ups' }] }, gyms2);
  const e = r.log[0];
  assert.equal(e.gym_id, 'generic');
  assert.equal(e.gym, 'Common Machines');
  assert.equal(e.room_id, 'bw');
  assert.equal(e.machine_id, 'pull-ups');
  assert.equal(e.machine, 'Pull-ups');
  assert.equal(e.migrated_from, 'Pullups @ Old Park (m9)');
  assert.equal(r.counts['moved to generic:pull-ups'], 1);
});

test('applyFixups: level_is_pace turns pace into an estimated distance', () => {
  const r = applyFixups([V2({ machine_id: 'w1', machine: 'Walk', duration_sec: 2640, level: 20 })],
    { remap: [{ machine_id: 'w1', to: 'generic:walk', level_is_pace: true }] }, gyms2);
  assert.equal(r.log[0].distance_mi, 2.2);
  assert.equal(r.log[0].level, null);
  assert.match(r.log[0].notes, /estimated from a pace of 20 min\/mi/);
});

test('applyFixups: pace without a duration is kept and reported', () => {
  const r = applyFixups([V2({ machine_id: 'w1', level: 20 })], { remap: [{ machine_id: 'w1', to: 'generic:walk', level_is_pace: true }] }, gyms2);
  assert.equal(r.log[0].level, 20);
  assert.equal(r.problems.length, 1);
});

test('applyFixups: negative reps move to the other machine as positive reps; sessions renumbered', () => {
  const log = [V2({ id: 'a', reps: 3, set: 1 }), V2({ id: 'b', reps: 4, set: 2 }), V2({ id: 'c', reps: -4, set: 3 })];
  const r = applyFixups(log, { remap: [{ machine_id: 'm9', to: 'generic:pull-ups' }], negative_reps: { 'generic:pull-ups': 'generic:negative-pullups' } }, gyms2);
  const [a, b, c] = r.log;
  assert.equal(c.machine_id, 'negative-pullups');
  assert.equal(c.reps, 4);
  assert.equal(c.set, 1);
  assert.deepEqual([a.machine_id, a.set, b.set], ['pull-ups', 1, 2]);
});

test('applyFixups: two old machines merged onto one machine and date are renumbered together', () => {
  const log = [V2({ id: 'a', machine_id: 'p1', set: 1 }), V2({ id: 'b', machine_id: 'p2', set: 1 })];
  const r = applyFixups(log, { remap: [{ machine_id: 'p1', to: 'generic:push-ups' }, { machine_id: 'p2', to: 'generic:push-ups' }] }, gyms2);
  assert.deepEqual(r.log.map(e => e.set), [1, 2]);
});

test('applyFixups: unknown target is reported; untouched rows unchanged', () => {
  const keep = V2({ machine_id: 'other', set: 7 });
  const r = applyFixups([keep], { remap: [{ machine_id: 'm9', to: 'generic:nope' }] }, gyms2);
  assert.equal(r.problems.length, 1);
  assert.deepEqual(r.log[0], keep);
});

test('applyFixups: no corrections → log unchanged', () => {
  const log = [V2({ reps: -1 })];
  assert.deepEqual(applyFixups(log, null, gyms2).log, log);
});
