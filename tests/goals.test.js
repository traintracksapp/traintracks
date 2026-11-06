import test from 'node:test';
import assert from 'node:assert/strict';
import { weekBounds, addDays } from '../lib/dates.js';
import { parseBucketsCSV, hrRangeMinutes, zonesFromBuckets, computeGoals, cleanFloors, hrRangeText, cleanGoalsConfig, bucketColumn } from '../lib/goals.js';

const COLS = ['hr_under70', ...Array.from({ length: 23 }, (_, i) => `hr${70 + i * 5}_${74 + i * 5}`), 'hr185_up'];
function bucketRow(meta, mins) { // mins: { 'hr120_124': 5, ... }
  return [...meta, ...COLS.map(c => mins[c] != null ? mins[c] : '')].join(',');
}
const BUCKETS = ['date,start,activity_id,activity_type,minutes,avg_hr,max_minute_hr,corrected,' + COLS.join(','),
  bucketRow(['2026-11-03', '2026-11-03 07:00', '111111111', 'walking', '40', '110', '135', ''], { hr_under70: 2, hr80_84: 4, hr100_104: 10, hr105_109: 10, hr115_119: 4, hr120_124: 5, hr125_129: 3, hr130_134: 2 }),
  bucketRow(['2026-11-04', '2026-11-04 07:00', '222222222', 'running', '20', '150', '170', 'y'], { hr140_144: 5, hr145_149: 5, hr150_154: 5, hr155_159: 3, hr160_164: 2 })
].join('\n') + '\n';

test('weekBounds: Saturday-start weeks', () => {
  assert.deepEqual(weekBounds('2026-11-05', 'sat', 0), { start: '2026-10-31', end: '2026-11-06' });
  assert.deepEqual(weekBounds('2026-10-31', 'sat', 0), { start: '2026-10-31', end: '2026-11-06' });
  assert.deepEqual(weekBounds('2026-11-06', 'sat', -1), { start: '2026-10-24', end: '2026-10-30' });
  assert.deepEqual(weekBounds('2026-11-05', 'bogus', 0), { start: '2026-11-02', end: '2026-11-08' }); // Monday fallback
  assert.equal(addDays('2026-12-31', 1), '2027-01-01');
});

test('bucket columns parse', () => {
  assert.deepEqual(bucketColumn('hr_under70'), { lo: 65, hi: 70, open: 'low' });
  assert.deepEqual(bucketColumn('hr120_124'), { lo: 120, hi: 125, open: null });
  assert.deepEqual(bucketColumn('hr185_up'), { lo: 185, hi: 190, open: 'high' });
  assert.equal(bucketColumn('minutes'), null);
});

test('parseBucketsCSV + hrRangeMinutes', () => {
  const b = parseBucketsCSV(BUCKETS);
  assert.equal(Object.keys(b).length, 2);
  assert.equal(b['222222222'].corrected, true);
  assert.equal(hrRangeMinutes(b['111111111'], null, 120), 2 + 4 + 10 + 10 + 4); // under 120
  assert.equal(hrRangeMinutes(b['111111111'], 120, 130), 8);
  assert.equal(hrRangeMinutes(b['111111111'], 122, 130), 5 * 3 / 5 + 3); // proportional share of 120_124
  assert.equal(hrRangeMinutes(b['222222222'], 155, null), 3 + 2);
  assert.equal(hrRangeMinutes(b['222222222'], null, 150), 10);
  assert.equal(hrRangeMinutes(null, 0, 10), 0);
});

test('zonesFromBuckets keeps below-Z1 separate', () => {
  const b = parseBucketsCSV(BUCKETS);
  const z = zonesFromBuckets(b['111111111'], [105, 120, 130, 145, 155]);
  assert.equal(z.below, 2 + 4 + 10);
  assert.deepEqual(z.zones, [10 + 4, 5 + 3, 2, 0, 0]);
  assert.equal(zonesFromBuckets(b['111111111'], [120, 110]), null);
  assert.deepEqual(cleanFloors([105, '120', 130]), [105, 120, 130]);
  assert.deepEqual(cleanFloors([105, 105]), []);
  assert.equal(hrRangeText(120, 130), '120–129 bpm');
  assert.equal(hrRangeText(null, 120), 'under 120 bpm');
});

test('computeGoals: days, sums, HR range, wellness, status', () => {
  const gyms = [{ id: 'generic', rooms: [{ id: 'bw', machines: [{ id: 'push-ups', logType: 'reps' }] }, { id: 'outdoor-activities', machines: [{ id: 'walk', logType: 'walk' }, { id: 'run', logType: 'walk' }] }] }];
  const log = [
    { date: '2026-11-03', machineId: 'walk', machine: 'Walk', gymId: 'generic', duration: 40, garminId: '111111111' },
    { date: '2026-11-04', machineId: 'run', machine: 'Run', gymId: 'generic', duration: 20, notes: 'Run (Garmin 222222222)' },
    { date: '2026-11-04', machineId: 'push-ups', machine: 'Push Ups', gymId: 'generic', reps: 30 },
    { date: '2026-11-05', machineId: 'push-ups', machine: 'Push Ups', gymId: 'generic', reps: 40 },
    { date: '2026-10-01', machineId: 'push-ups', machine: 'Push Ups', gymId: 'generic', reps: 999 }
  ];
  const wellness = [{ date: '2026-11-01', steps: 10000, sleep_hours: 7 }, { date: '2026-11-02', steps: 12000, sleep_hours: 8 }, { date: '2026-11-03', steps: null, sleep_hours: null }];
  const goals = [
    { id: 'cd', kind: 'days', source: 'log', filter: 'cardio', target: 4 },
    { id: 'sd', kind: 'days', source: 'log', filter: 'strength', target: 2 },
    { id: 'pu', kind: 'sum', source: 'log', field: 'reps', machineIds: ['push-ups'], target: 140 },
    { id: 'z', kind: 'sum', source: 'log', hrMin: 120, hrMax: 130, target: 45 },
    { id: 'st', kind: 'sum', source: 'wellness', field: 'steps', target: 70000 },
    { id: 'sl', kind: 'avg', source: 'wellness', field: 'sleep_hours', target: 7.1 },
    { id: 'rhr', kind: 'avg', source: 'wellness', field: 'resting_hr', target: 46, direction: 'below' }
  ];
  const o = computeGoals(goals, { log, wellness, buckets: parseBucketsCSV(BUCKETS), gyms, weekStart: 'sat', today: '2026-11-05' });
  assert.equal(o.start, '2026-10-31'); assert.equal(o.isCurrent, true); assert.equal(o.daysElapsed, 6);
  const r = Object.fromEntries(o.results.map(x => [x.id, x]));
  assert.equal(r.cd.value, 2); assert.equal(r.cd.status, 'behind'); // expected 4*6/7=3.4
  assert.equal(r.sd.value, 2); assert.equal(r.sd.status, 'hit');
  assert.equal(r.pu.value, 70); assert.equal(r.pu.status, 'behind');
  assert.equal(r.z.value, 8); // only the walk has 120-129 minutes; run has none
  assert.equal(r.st.value, 22000); assert.equal(r.st.daysWithData, 2); assert.match(r.st.note, /2 of 6 days synced/);
  assert.equal(r.sl.value, 7.5); assert.equal(r.sl.status, 'hit');
  assert.equal(r.rhr.status, 'nodata');
});

test('computeGoals: finished week statuses', () => {
  const o = computeGoals([{ id: 'a', kind: 'days', filter: 'any', target: 1 }], { log: [{ date: '2026-10-25', machineId: 'x', reps: 1 }], gyms: [], weekStart: 'sat', today: '2026-11-05', offset: -1 });
  assert.equal(o.isCurrent, false); assert.equal(o.daysElapsed, 7);
  assert.equal(o.results[0].status, 'hit');
  const o2 = computeGoals([{ id: 'a', kind: 'days', filter: 'any', target: 3 }], { log: [], gyms: [], weekStart: 'sat', today: '2026-11-05', offset: -1 });
  assert.equal(o2.results[0].status, 'miss');
});

test('cleanGoalsConfig validates floors and labels', () => {
  assert.equal(cleanGoalsConfig({ goals: [{ label: ' ' }], hrZones: [100, 90] }).ok, false);
  const r = cleanGoalsConfig({ goals: [{ label: ' A ', target: '5' }, { label: '' }], hrZones: [100, 120, null, 150] });
  assert.equal(r.ok, true);
  assert.deepEqual(r.goals.goals, [{ label: 'A', target: 5 }]);
  assert.deepEqual(r.goals.hrZones, [100, 120]);
});
