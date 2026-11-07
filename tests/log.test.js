import { test } from 'node:test';
import assert from 'node:assert/strict';
import { LOG_COLUMNS, LOG_TYPE_FIELDS, newId, inSession, sessionEntries, sortLog, mergeSession,
  removeSession, lastSession, sessionDates, machineSessions, moveSession, garminIdOf, logToCSV, logToJSON, zoneSeconds, minFromSec } from '../lib/log.js';
import { parseCSV } from '../lib/csv.js';

// Made-up data only: "Example Gym" (gym_id "eg"), machine "r02".
let k = 0;
const E = o => ({ id: `t${++k}`, gym_id: 'eg', machine_id: 'r02', date: '2026-11-05', set: 1, variant: [], weight_lb: 60, reps: 12, notes: '', ...o });
const S = (o = {}) => ({ gym_id: 'eg', machine_id: 'r02', date: '2026-11-05', variant: [], ...o });

test('LOG_COLUMNS: notes last, no duplicates, matches docs/DATA-FORMAT.md', () => {
  assert.equal(LOG_COLUMNS.at(-1), 'notes');
  assert.equal(new Set(LOG_COLUMNS).size, LOG_COLUMNS.length);
  assert.equal(LOG_COLUMNS.join(','),
    'id,date,time,gym_id,gym,room_id,room,machine_id,machine,variant,set,weight_lb,reps,duration_sec,duration_min,distance_mi,speed_mph,level,incline_pct,hr_avg_bpm,garmin_id,zone1_min,zone2_min,zone3_min,zone4_min,zone5_min,notes');
});

test('every log-type field is a CSV column', () => {
  for (const f of Object.values(LOG_TYPE_FIELDS).flat()) assert.ok(LOG_COLUMNS.includes(f), f);
});

test('newId: unique', () => {
  const ids = new Set(Array.from({ length: 2000 }, () => newId()));
  assert.equal(ids.size, 2000);
});

test('inSession: legacy rows without gym_id match on machine alone; other gyms do not', () => {
  assert.ok(inSession(E({ gym_id: undefined }), S()));
  assert.ok(!inSession(E({ gym_id: 'other' }), S()));
});

test('inSession: a different variant is a different session', () => {
  assert.ok(!inSession(E({ variant: ['wide'] }), S()));
  assert.ok(inSession(E({ variant: ['wide', 'incline'] }), S({ variant: ['incline', 'wide'] })));
  assert.ok(inSession(E({ variant: undefined }), S()));
});

test('mergeSession: saving REPLACES the session, never appends (3 sets stay 3)', () => {
  let log = [E({ set: 1 }), E({ set: 2 }), E({ set: 3 })];
  const sets = [{ weight_lb: 60, reps: 12 }, { weight_lb: 65, reps: 10 }, { weight_lb: 70, reps: 8 }];
  log = mergeSession(log, S(), sets);
  log = mergeSession(log, S(), sets); // save twice
  assert.equal(sessionEntries(log, S()).length, 3);
  assert.deepEqual(sessionEntries(log, S()).map(e => e.set), [1, 2, 3]);
});

test('mergeSession: fewer sets removes the extras', () => {
  const log = mergeSession([E({ set: 1 }), E({ set: 2 }), E({ set: 3 })], S(), [{ weight_lb: 1, reps: 1 }]);
  assert.equal(log.length, 1);
});

test('mergeSession: fields the form does not know survive (id, garmin_id, future fields)', () => {
  const log = [E({ id: 'keep-me', garmin_id: '123456789', future_field: 'x' })];
  const out = mergeSession(log, S(), [{ weight_lb: 80, reps: 5 }]);
  assert.equal(out[0].id, 'keep-me');
  assert.equal(out[0].garmin_id, '123456789');
  assert.equal(out[0].future_field, 'x');
  assert.equal(out[0].weight_lb, 80);
});

test('mergeSession: a cleared value passed as null is cleared', () => {
  const out = mergeSession([E({ weight_lb: 60 })], S(), [{ weight_lb: null, reps: 20 }]);
  assert.equal(out[0].weight_lb, null);
});

test('mergeSession: new sets get ids, set numbers, session keys and a sorted variant', () => {
  const out = mergeSession([], S({ variant: ['wide', 'incline'] }), [{ reps: 10 }, { reps: 8 }]);
  assert.equal(out.length, 2);
  assert.ok(out[0].id && out[1].id && out[0].id !== out[1].id);
  assert.deepEqual(out.map(e => e.set), [1, 2]);
  assert.deepEqual(out[0].variant, ['incline', 'wide']);
  assert.equal(out[0].gym_id, 'eg');
});

test('mergeSession: changing the date while editing MOVES the session (spec §15.5)', () => {
  const log = [E({ date: '2026-11-03' }), E({ date: '2026-11-03', set: 2 })];
  const out = mergeSession(log, S({ date: '2026-11-03' }), [{ weight_lb: 60, reps: 12 }], S({ date: '2026-11-04' }));
  assert.equal(sessionEntries(out, S({ date: '2026-11-03' })).length, 0);
  assert.equal(sessionEntries(out, S({ date: '2026-11-04' })).length, 1);
  assert.equal(out.length, 1);
});

test('mergeSession: moving onto a date that already has that session replaces it', () => {
  const log = [E({ date: '2026-11-04', reps: 99 }), E({ date: '2026-11-03' })];
  const out = mergeSession(log, S({ date: '2026-11-03' }), [{ weight_lb: 60, reps: 12 }], S({ date: '2026-11-04' }));
  assert.equal(out.length, 1);
  assert.equal(out[0].reps, 12);
});

test('mergeSession: two variants on the same day are separate sessions', () => {
  let log = mergeSession([], S({ variant: ['wide'] }), [{ reps: 20 }]);
  log = mergeSession(log, S({ variant: ['narrow'] }), [{ reps: 15 }, { reps: 15 }]);
  assert.equal(log.length, 3);
  assert.equal(sessionEntries(log, S({ variant: ['wide'] })).length, 1);
  assert.equal(sessionEntries(log, S({ variant: ['narrow'] })).length, 2);
});

test('mergeSession: changing the variant while editing moves the session', () => {
  const log = [E({ variant: [] })];
  const out = mergeSession(log, S(), [{ reps: 10 }], S({ variant: ['incline'] }));
  assert.equal(out.length, 1);
  assert.deepEqual(out[0].variant, ['incline']);
});

test('mergeSession: placed within its date block; log stays newest first', () => {
  const log = [E({ date: '2026-11-06', machine_id: 'a' }), E({ date: '2026-11-05', machine_id: 'b' }), E({ date: '2026-11-01', machine_id: 'c' })];
  const out = mergeSession(log, S({ date: '2026-11-05' }), [{ reps: 1 }]);
  assert.deepEqual(out.map(e => e.date), ['2026-11-06', '2026-11-05', '2026-11-05', '2026-11-01']);
  assert.equal(out[2].machine_id, 'r02'); // after the existing 11-05 entry
  const out2 = mergeSession(log, S({ date: '2026-11-03' }), [{ reps: 1 }]);
  assert.deepEqual(out2.map(e => e.date), ['2026-11-06', '2026-11-05', '2026-11-03', '2026-11-01']);
  const out3 = mergeSession(log, S({ date: '2026-12-01' }), [{ reps: 1 }]);
  assert.equal(out3[0].date, '2026-12-01');
  const out4 = mergeSession(log, S({ date: '2026-01-01' }), [{ reps: 1 }]);
  assert.equal(out4.at(-1).date, '2026-01-01');
});

test('mergeSession: no sets deletes the session; removeSession too', () => {
  const log = [E(), E({ machine_id: 'other' })];
  assert.equal(mergeSession(log, S(), []).length, 1);
  assert.equal(removeSession(log, S()).length, 1);
});

test('mergeSession does not modify its input', () => {
  const log = [E({ reps: 5 })];
  mergeSession(log, S(), [{ reps: 9 }]);
  assert.equal(log[0].reps, 5);
});

test('sortLog: newest first, stable within a day', () => {
  const log = [E({ date: '2026-11-01', machine_id: 'x' }), E({ date: '2026-11-03', machine_id: 'a' }), E({ date: '2026-11-03', machine_id: 'b' })];
  assert.deepEqual(sortLog(log).map(e => e.machine_id), ['a', 'b', 'x']);
});

test('lastSession: latest session with the same variant, else the latest of any', () => {
  const log = [
    E({ date: '2026-11-06', variant: ['incline'], reps: 30 }),
    E({ date: '2026-11-04', variant: [], reps: 20, set: 1 }), E({ date: '2026-11-04', variant: [], reps: 18, set: 2 }),
    E({ date: '2026-11-01', variant: ['wide'], reps: 10 })
  ];
  assert.deepEqual(lastSession(log, 'r02', 'eg', []).map(e => e.reps), [20, 18]);
  assert.deepEqual(lastSession(log, 'r02', 'eg', ['wide']).map(e => e.reps), [10]);
  assert.deepEqual(lastSession(log, 'r02', 'eg', ['diamond']).map(e => e.reps), [30]);
  assert.deepEqual(lastSession(log, 'r02', 'eg').map(e => e.reps), [30]);
  assert.equal(lastSession(log, 'nope', 'eg', []), null);
});

test('sessionDates: distinct, newest first', () => {
  const log = [E({ date: '2026-11-01' }), E({ date: '2026-11-04' }), E({ date: '2026-11-04', set: 2 })];
  assert.deepEqual(sessionDates(log, 'r02', 'eg'), ['2026-11-04', '2026-11-01']);
});

// Ported from LogTrim tests/reports.test.js (garminIdOf)
test('garminIdOf: reads the "Garmin <id>" tag from notes', () => {
  assert.equal(garminIdOf({ notes: 'Park walk (Garmin 12345678901; 2.1 mi)' }), '12345678901');
  assert.equal(garminIdOf({ notes: 'Garmin walk 12345678901' }), '12345678901');
});
test('garminIdOf: a garmin_id field wins; no tag → null', () => {
  assert.equal(garminIdOf({ garmin_id: '999999999', notes: 'Garmin 12345678901' }), '999999999');
  assert.equal(garminIdOf({ garmin_id: 123456789 }), '123456789');
  assert.equal(garminIdOf({ notes: 'felt good' }), null);
  assert.equal(garminIdOf(null), null);
});

test('logToCSV: header, one row per entry in log order, variant joined, notes quoted', () => {
  const log = [
    E({ id: 'a', variant: ['incline', 'wide'], reps: 20, weight_lb: null, notes: 'easy, fast' }),
    E({ id: 'b', date: '2026-11-04', duration_sec: 1945, hr_avg_bpm: 126, garmin_id: '12345678901' })
  ];
  const csv = logToCSV(log);
  assert.equal(csv.split('\n')[0], LOG_COLUMNS.join(','));
  const rows = parseCSV(csv);
  assert.equal(rows.length, 2);
  assert.equal(rows[0].id, 'a');
  assert.equal(rows[0].variant, 'incline; wide');
  assert.equal(rows[0].weight_lb, '');
  assert.equal(rows[0].notes, 'easy, fast');
  assert.equal(rows[1].duration_sec, '1945');
  assert.equal(rows[1].garmin_id, '12345678901');
});

test('logToCSV: fields that are not columns are left out of the CSV (kept in the JSON)', () => {
  const csv = logToCSV([E({ future_field: 'x' })]);
  assert.ok(!csv.includes('future_field'));
  assert.ok(logToJSON([E({ future_field: 'x' })]).includes('future_field'));
});

test('logToJSON: pretty-printed with a trailing newline', () => {
  assert.equal(logToJSON([]), '[]\n');
  assert.ok(logToJSON([E()]).startsWith('[\n  {'));
});

test('machineSessions: newest first; two variants on one day are two sessions', () => {
  const log = [E({ date: '2026-11-04', variant: ['wide'], reps: 1 }), E({ date: '2026-11-04', variant: [], set: 1 }), E({ date: '2026-11-04', variant: [], set: 2 }),
    E({ date: '2026-11-06', reps: 9 }), E({ date: '2026-11-06', machine_id: 'other' })];
  const s = machineSessions(log, 'r02', 'eg');
  assert.deepEqual(s.map(x => [x.date, x.variant.join(';'), x.sets.length]), [['2026-11-06', '', 1], ['2026-11-04', 'wide', 1], ['2026-11-04', '', 2]]);
});

const TO = { gym_id: 'other', gym: 'Other Gym', room_id: 'c', room: 'Cardio', machine_id: 'tm', machine: 'Treadmill' };

test('moveSession: moves every set, keeps every field (garmin link, zones, notes)', () => {
  const log = [E({ id: 'g1', duration_sec: 1800, garmin_id: '24000000001', zone1_min: 20, notes: 'Garmin walk' }), E({ id: 'keep', machine_id: 'x' })];
  const out = moveSession(log, S(), TO);
  const m = out.find(e => e.id === 'g1');
  assert.deepEqual([m.gym_id, m.gym, m.room_id, m.machine_id, m.machine, m.set], ['other', 'Other Gym', 'c', 'tm', 'Treadmill', 1]);
  assert.equal(m.garmin_id, '24000000001');
  assert.equal(m.zone1_min, 20);
  assert.equal(m.date, '2026-11-05');
  assert.equal(out.length, 2);
  assert.deepEqual(out.map(e => e.id), ['g1', 'keep'], 'rows stay in place');
});

test('moveSession: onto a machine that already has a session that day, sets are added after it', () => {
  const log = [E({ id: 'a', gym_id: 'other', machine_id: 'tm', set: 1 }), E({ id: 'b', set: 1 }), E({ id: 'c', set: 2 })];
  const out = moveSession(log, S(), TO);
  assert.deepEqual(out.filter(e => e.machine_id === 'tm').map(e => [e.id, e.set]), [['a', 1], ['b', 2], ['c', 3]]);
});

test('moveSession: same machine or nothing to move → unchanged', () => {
  const log = [E({ id: 'a' })];
  assert.equal(moveSession(log, S(), { ...TO, gym_id: 'eg', machine_id: 'r02' }), log);
  assert.equal(moveSession(log, S({ date: '2020-01-01' }), TO), log);
});

test('CSV: duration_min is computed from duration_sec (2 decimals) and never stored', () => {
  const log = [E({ id: 'j', weight_lb: undefined, reps: undefined, duration_sec: 1707 }), E({ id: 'w', duration_sec: undefined })];
  const rows = parseCSV(logToCSV(log));
  assert.equal(rows[0].duration_sec, '1707');
  assert.equal(rows[0].duration_min, '28.45');
  assert.equal(rows[1].duration_min, '');
  assert.ok(!('duration_min' in log[0]));
  assert.deepEqual([minFromSec(731), minFromSec(45), minFromSec(60), minFromSec(null), minFromSec('')], [12.18, 0.75, 1, null, null]);
});

test('CSV: zones in minutes; rows from 0.2.0 with zone{i}_sec are exported in minutes too', () => {
  const log = [E({ id: 'new', zone1_min: 1.73, zone2_min: 19.72 }), E({ id: 'old', zone1_sec: 104, zone3_sec: 300 })];
  const rows = parseCSV(logToCSV(log));
  assert.deepEqual([rows[0].zone1_min, rows[0].zone2_min, rows[0].zone3_min], ['1.73', '19.72', '']);
  assert.deepEqual([rows[1].zone1_min, rows[1].zone2_min, rows[1].zone3_min], ['1.73', '', '5']);
  assert.ok(!logToCSV(log).split('\n')[0].includes('_sec,zone'));
});

test('zoneSeconds: minutes first, old seconds accepted, blank is null', () => {
  assert.equal(zoneSeconds({ zone2_min: 19.72 }, 2), 1183.2);
  assert.equal(zoneSeconds({ zone2_sec: 1183 }, 2), 1183);
  assert.equal(zoneSeconds({ zone2_min: 1, zone2_sec: 999 }, 2), 60);
  assert.equal(zoneSeconds({ zone2_min: '' }, 2), null);
  assert.equal(zoneSeconds({}, 2), null);
});
