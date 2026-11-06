import test from 'node:test';
import assert from 'node:assert/strict';
import { mergeSession, removeSession, sessionEntries, lastSession, classifyEntry, machineInfoMap, garminIdOf, normaliseLog, newId, sortLog, buildEntry } from '../lib/log.js';

const gyms = [
  { id: 'generic', rooms: [
    { id: 'outdoor-activities', machines: [{ id: 'walk', logType: 'walk' }, { id: 'swim', logType: 'time' }] },
    { id: 'bw', machines: [{ id: 'push-ups', logType: 'reps' }, { id: 'elbow-planks', logType: 'time' }, { id: 'meditation', logType: 'time' }] }
  ] },
  { id: 'portofino', rooms: [{ id: 'wr', machines: [{ id: 'pm02', logType: 'weight' }, { id: 'tread', logType: 'cardio' }] }] },
  { id: 'other', rooms: [{ id: 'r', machines: [{ id: 'pm02', logType: 'reps' }] }] }
];
const info = machineInfoMap(gyms);

function e(o) { return { id: newId(), gymId: 'portofino', machineId: 'pm02', date: '2026-11-05', set: 1, weight: 60, reps: 12, notes: '', ...o }; }

test('mergeSession replaces a session in place and renumbers', () => {
  const log = [e({ set: 1, date: '2026-11-06' }), e({ set: 1 }), e({ set: 2, weight: 70 }), e({ set: 1, date: '2026-11-04' })];
  const out = mergeSession(log, { gymId: 'portofino', machineId: 'pm02', date: '2026-11-05' }, [{ weight: 80, reps: 8 }, { weight: 85, reps: 6 }, { weight: 90, reps: 4 }]);
  assert.equal(out.length, 5);
  const s = sessionEntries(out, { gymId: 'portofino', machineId: 'pm02', date: '2026-11-05' });
  assert.deepEqual(s.map(x => [x.set, x.weight]), [[1, 80], [2, 85], [3, 90]]);
  // order: 06 block, then 05 block, then 04
  assert.deepEqual(out.map(x => x.date), ['2026-11-06', '2026-11-05', '2026-11-05', '2026-11-05', '2026-11-04']);
});

test('mergeSession preserves ids and unknown fields on matching set indexes', () => {
  const log = [e({ id: 'keep1', garminId: '999', future: 'x' }), e({ id: 'keep2', set: 2 })];
  const out = mergeSession(log, { gymId: 'portofino', machineId: 'pm02', date: '2026-11-05' }, [{ weight: 1, reps: 1 }]);
  assert.equal(out.length, 1);
  assert.equal(out[0].id, 'keep1');
  assert.equal(out[0].garminId, '999');
  assert.equal(out[0].future, 'x');
  assert.equal(out[0].weight, 1);
});

test('mergeSession with a new date MOVES the session (bug #5 from the review)', () => {
  const log = [e({ set: 1 }), e({ set: 2 }), e({ set: 1, date: '2026-11-01', machineId: 'tread' })];
  const out = mergeSession(log, { gymId: 'portofino', machineId: 'pm02', date: '2026-11-05' }, [{ weight: 5, reps: 5 }], { gymId: 'portofino', machineId: 'pm02', date: '2026-11-03' });
  assert.equal(out.filter(x => x.machineId === 'pm02' && x.date === '2026-11-05').length, 0);
  const moved = out.filter(x => x.machineId === 'pm02' && x.date === '2026-11-03');
  assert.equal(moved.length, 1);
  assert.equal(moved[0].weight, 5);
  assert.deepEqual(out.map(x => x.date), ['2026-11-03', '2026-11-01']);
});

test('session identity respects gymId when both sides have it, ignores it on legacy rows', () => {
  const log = [e({ gymId: 'portofino' }), e({ gymId: 'other', reps: 20, weight: null }), e({ gymId: undefined, weight: 99 })];
  const s = sessionEntries(log, { gymId: 'portofino', machineId: 'pm02', date: '2026-11-05' });
  assert.equal(s.length, 2); // portofino row + legacy row (no gymId)
  assert.ok(s.every(x => x.gymId !== 'other'));
  const out = removeSession(log, { gymId: 'other', machineId: 'pm02', date: '2026-11-05' });
  assert.equal(out.length, 1);
  assert.equal(out[0].gymId, 'portofino');
});

test('lastSession returns the newest date sorted by set', () => {
  const log = [e({ set: 2, date: '2026-11-01' }), e({ set: 1, date: '2026-11-01' }), e({ set: 1, date: '2026-10-01' })];
  const ls = lastSession(log, 'pm02', 'portofino');
  assert.deepEqual(ls.map(x => x.set), [1, 2]);
  assert.equal(lastSession(log, 'nope'), null);
});

test('classifyEntry', () => {
  assert.equal(classifyEntry({ machineId: 'walk', gymId: 'generic', duration: 30 }, info), 'cardio');
  assert.equal(classifyEntry({ machineId: 'swim', gymId: 'generic', duration: 30 }, info), 'cardio');
  assert.equal(classifyEntry({ machineId: 'push-ups', gymId: 'generic', reps: 30 }, info), 'strength');
  assert.equal(classifyEntry({ machineId: 'elbow-planks', gymId: 'generic', duration: 60 }, info), 'strength');
  assert.equal(classifyEntry({ machineId: 'meditation', gymId: 'generic', duration: 600 }, info), 'other');
  assert.equal(classifyEntry({ machineId: 'pm02', gymId: 'portofino', weight: 50, reps: 10 }, info), 'strength');
  assert.equal(classifyEntry({ machineId: 'pm02', gymId: 'other', reps: 10 }, info), 'strength');
  assert.equal(classifyEntry({ machineId: 'tread', gymId: 'portofino', duration: 30, incline: 5 }, info), 'cardio');
  assert.equal(classifyEntry({ machineId: 'gone', duration: 30 }, info), 'cardio');
  assert.equal(classifyEntry({ machineId: 'pm02', gymId: 'portofino', garminId: '123456789', duration: 30 }, info), 'cardio');
  assert.equal(classifyEntry({ machineId: 'gone' }, info), 'other');
});

test('garminIdOf reads the field or the legacy notes tag', () => {
  assert.equal(garminIdOf({ garminId: 24609293314 }), '24609293314');
  assert.equal(garminIdOf({ notes: 'Walk (Garmin 24609293314; 2.1 mi).' }), '24609293314');
  assert.equal(garminIdOf({ notes: 'Garmin walk 24609293314' }), '24609293314');
  assert.equal(garminIdOf({ notes: 'no id here' }), null);
});

test('normaliseLog adds ids and promotes Garmin tags', () => {
  const out = normaliseLog([{ notes: 'Garmin 24609293314' }, { id: 'a' }, { id: 'a' }]);
  assert.ok(out[0].id);
  assert.equal(out[0].garminId, '24609293314');
  assert.equal(out[1].id, 'a');
  assert.notEqual(out[2].id, 'a');
});

test('newId is unique across many calls', () => {
  const s = new Set();
  for (let i = 0; i < 5000; i++) s.add(newId());
  assert.equal(s.size, 5000);
});

test('sortLog newest first, stable', () => {
  const out = sortLog([{ date: '2026-01-01', k: 1 }, { date: '2026-02-01', k: 2 }, { date: '2026-01-01', k: 3 }]);
  assert.deepEqual(out.map(x => x.k), [2, 1, 3]);
});

test('buildEntry fills every field and only set 1 carries notes', () => {
  const ctx = { gym: { id: 'g', name: 'G' }, room: { id: 'r', name: 'R' }, machine: { id: 'm', name: 'M' }, date: '2026-11-05', datetime: '2026-11-05 10:00:00 AM', notes: ' hi ' };
  const a = buildEntry(ctx, { weight: 50, reps: 10 }, 1), b = buildEntry(ctx, { weight: 50, reps: 10 }, 2);
  assert.equal(a.notes, 'hi'); assert.equal(b.notes, '');
  assert.equal(a.duration, null); assert.equal(a.gymId, 'g'); assert.equal(a.roomId, 'r');
  assert.ok(a.id && a.id !== b.id);
});
