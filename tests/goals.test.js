import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as R from '../lib/goals.js';
import { garminIdOf } from '../lib/log.js';

// Ported from LogTrim tests/reports.test.js. Version 1 stored minutes and
// hours; version 2 stores seconds (D15), so durations below are ×60 or ×3600
// and the expected values follow.
const gyms = [
  { id: 'generic', rooms: [
    { id: 'outdoor-activities', machines: [{ id: 'walk', log_type: 'walk' }, { id: 'run', log_type: 'walk' }] },
    { id: 'bodyweight-no-equipment', machines: [{ id: 'push-ups', log_type: 'reps' }, { id: 'elbow-planks', log_type: 'time' }] }
  ] },
  { id: 'eg', rooms: [{ id: 'w', machines: [{ id: 'r03', log_type: 'weight' }, { id: 'tm', log_type: 'cardio' }] }] }
];
const E = o => ({ gym_id: 'generic', set: 1, variant: [], notes: '', ...o });

test('parseWellnessCSV: numbers, blanks → null, strings kept', () => {
  const rows = R.parseWellnessCSV('date,steps,sleep_sec,hrv_status\n2026-09-27,12756,30132,UNBALANCED\n2026-09-28,20070,,LOW\n');
  assert.equal(rows.length, 2);
  assert.equal(rows[0].steps, 12756);
  assert.equal(rows[0].sleep_sec, 30132);
  assert.equal(rows[0].hrv_status, 'UNBALANCED');
  assert.equal(rows[0].date, '2026-09-27');
  assert.equal(rows[1].sleep_sec, null);
});
test('parseWellnessCSV: empty text → []', () => assert.deepEqual(R.parseWellnessCSV(''), []));

// ─── computeGoals ───
const goals = [
  { id: 'steps', label: 'Steps', kind: 'sum', source: 'wellness', field: 'steps', target: 70000 },
  { id: 'cardioDays', label: 'Cardio days', kind: 'days', source: 'log', filter: 'cardio', target: 4 },
  { id: 'strengthDays', label: 'Strength days', kind: 'days', source: 'log', filter: 'strength', target: 3 },
  { id: 'zone2', label: 'Zone 2', kind: 'sum', source: 'log', field: 'zone2_sec', target: 2700, display: 'min' },
  { id: 'pushups', label: 'Pushups', kind: 'sum', source: 'log', field: 'reps', machine_ids: ['push-ups'], target: 140 },
  { id: 'plank', label: 'Plank', kind: 'sum', source: 'log', field: 'duration_sec', machine_ids: ['elbow-planks'], target: 315, display: 's' },
  { id: 'sleep', label: 'Sleep', kind: 'avg', source: 'wellness', field: 'sleep_sec', target: 25560, display: 'h' },
  { id: 'rhr', label: 'RHR', kind: 'avg', source: 'wellness', field: 'resting_hr_bpm', target: 46, direction: 'below' }
];
// Week Sat 9/26 .. Fri 10/2, "today" = Tue 9/29 (4 days elapsed)
const log = [
  E({ machine_id: 'push-ups', machine: 'Push Ups', date: '2026-09-29', reps: 30 }),
  E({ machine_id: 'elbow-planks', machine: 'Elbow Planks', date: '2026-09-29', duration_sec: 30 }),
  E({ machine_id: 'push-ups', machine: 'Push Ups', date: '2026-09-28', reps: 20 }),
  E({ machine_id: 'push-ups', machine: 'Push Ups', date: '2026-09-28', reps: 20 }),
  E({ machine_id: 'walk', machine: 'Walk', date: '2026-09-28', duration_sec: 6360, zone1_sec: 6000, zone2_sec: 360 }),
  E({ machine_id: 'walk', machine: 'Walk', date: '2026-09-27', duration_sec: 3000, zone1_sec: 2400, zone2_sec: 600 }),
  E({ gym_id: 'eg', machine_id: 'r03', machine: 'Chest Press', date: '2026-09-26', weight_lb: 100, reps: 10 }),
  E({ machine_id: 'walk', machine: 'Walk', date: '2026-09-25', duration_sec: 3000, zone1_sec: 2400, zone2_sec: 600 }), // prior week
  E({ machine_id: 'push-ups', machine: 'Push Ups', date: '2026-09-25', reps: 99 })                                     // prior week
];
const wellness = [
  { date: '2026-09-25', steps: 9000, sleep_sec: 21600, resting_hr_bpm: 50 },
  { date: '2026-09-26', steps: 9087, sleep_sec: 27468, resting_hr_bpm: 51 },
  { date: '2026-09-27', steps: 12756, sleep_sec: 30132, resting_hr_bpm: 47 },
  { date: '2026-09-28', steps: 20070, sleep_sec: null, resting_hr_bpm: 47 }
];
const ctx = { log, wellness, gyms, week_start: 'sat', today: '2026-09-29', offset: 0 };
const out = R.computeGoals(goals, ctx);
const by = id => out.results.find(r => r.id === id);

test('computeGoals: week bounds and elapsed days', () => {
  assert.equal(out.start, '2026-09-26'); assert.equal(out.end, '2026-10-02');
  assert.equal(out.isCurrent, true); assert.equal(out.daysElapsed, 4);
});
test('steps: sums only in-week days; pace uses synced days', () => {
  const r = by('steps');
  assert.equal(r.value, 9087 + 12756 + 20070);
  assert.equal(r.daysWithData, 3);
  assert.equal(r.expected, 30000);
  assert.equal(r.status, 'onpace');
  assert.equal(r.note, '3 of 4 days synced');
});
test('cardio days: distinct dates, prior week excluded, drill-down lists dates', () => {
  const r = by('cardioDays');
  assert.equal(r.value, 2);
  assert.deepEqual(r.items.map(i => i.date), ['2026-09-27', '2026-09-28']);
  assert.equal(r.status, 'behind');
});
test('strength days: pushups-only day and plank day count', () => {
  const r = by('strengthDays');
  assert.deepEqual(r.items.map(i => i.date), ['2026-09-26', '2026-09-28', '2026-09-29']);
  assert.equal(r.status, 'hit');
});
test('zone2: summed across activities with per-date items', () => {
  const r = by('zone2');
  assert.equal(r.value, 960); // 16 min
  assert.equal(r.items.length, 2);
});
test('pushups: reps summed only for the machine, per-date set counts', () => {
  const r = by('pushups');
  assert.equal(r.value, 70);
  assert.deepEqual(r.items.map(i => [i.date, i.value, i.detail]), [['2026-09-28', 40, '2 sets'], ['2026-09-29', 30, '1 set']]);
  assert.equal(r.expected, 80);
  assert.equal(r.status, 'behind');
});
test('plank: duration summed', () => assert.equal(by('plank').value, 30));
test('sleep avg: skips null nights, no pace', () => {
  const r = by('sleep');
  assert.equal(r.value, 28800); // (7.63 h + 8.37 h) / 2 = 8 h
  assert.equal(r.daysWithData, 2);
  assert.equal(r.status, 'hit');
  assert.equal(r.expected, undefined);
});
test('rhr avg: direction below → 48.3 vs 46 is a miss', () => {
  const r = by('rhr');
  assert.equal(r.value, 48.3);
  assert.equal(r.status, 'miss');
});
test('prior week: finished week → hit/miss, no onpace', () => {
  const prev = R.computeGoals(goals, { ...ctx, offset: -1 });
  assert.equal(prev.isCurrent, false); assert.equal(prev.daysElapsed, 7);
  assert.equal(prev.results.find(r => r.id === 'pushups').value, 99);
  assert.equal(prev.results.find(r => r.id === 'pushups').status, 'miss');
  assert.equal(prev.results.find(r => r.id === 'cardioDays').value, 1);
});
test('avg with no data → nodata', () => {
  const o = R.computeGoals(goals, { ...ctx, wellness: [] });
  assert.equal(o.results.find(r => r.id === 'sleep').status, 'nodata');
  assert.equal(o.results.find(r => r.id === 'steps').value, 0);
});
test('fmtGoalNum: thousands, decimals, display units', () => {
  assert.equal(R.fmtGoalNum(41913), '41,913');
  assert.equal(R.fmtGoalNum(27468, 'h'), '7.6 h');
  assert.equal(R.fmtGoalNum(315, 's'), '315 s');
  assert.equal(R.fmtGoalNum(2700, 'min'), '45 min');
  assert.equal(R.fmtGoalNum(null), '—');
});
test('toStored / fromStored for the editor', () => {
  assert.equal(R.toStored(7.1, 'h'), 25560);
  assert.equal(R.fromStored(25560, 'h'), 7.1);
  assert.equal(R.toStored(45, 'min'), 2700);
  assert.equal(R.toStored(315, 's'), 315);
});

// ─── variations (spec §4.9): a machine goal counts every variant unless filtered ───
test('variants count toward the machine goal by default; filters narrow it', () => {
  const vlog = [E({ machine_id: 'push-ups', date: '2026-09-28', reps: 10, variant: ['incline'] }), E({ machine_id: 'push-ups', date: '2026-09-28', reps: 20, variant: ['decline', 'wide'] }), E({ machine_id: 'push-ups', date: '2026-09-28', reps: 5 })];
  const gs = [
    { id: 'all', kind: 'sum', source: 'log', field: 'reps', machine_ids: ['push-ups'], target: 1 },
    { id: 'decline', kind: 'sum', source: 'log', field: 'reps', machine_ids: ['push-ups'], variants: ['decline'], target: 1 },
    { id: 'noincline', kind: 'sum', source: 'log', field: 'reps', machine_ids: ['push-ups'], exclude_variants: ['incline'], target: 1 }
  ];
  const o = R.computeGoals(gs, { log: vlog, gyms, week_start: 'sat', today: '2026-09-29' });
  assert.deepEqual(o.results.map(r => r.value), [35, 20, 25]);
});

// ─── heart-rate buckets ───
const BUCKET_CSV = [
  'date,start,activity_id,activity_type,duration_sec,hr_avg_bpm,hr_max_minute_bpm,corrected,hr_under70_sec,hr70_74_sec,hr100_104_sec,hr105_109_sec,hr115_119_sec,hr120_124_sec,hr125_129_sec,hr130_134_sec,hr185_up_sec',
  '2026-09-27,2026-09-27 08:00,24000000001,walking,3600,98,131,,120,480,1200,600,300,360,240,300,',
  '2026-09-28,2026-09-28 18:00,24000000002,running,1800,150,190,y,,,,,,600,,600,600',
  '2026-09-28,2026-09-28 20:00,24000000003,walking,900,101,104,,,,900,,,,,,',
  '2026-09-25,2026-09-25 08:00,24000000004,walking,1200,122,124,,,,,,,1200,,,'
].join('\n');
const B = R.parseBucketsCSV(BUCKET_CSV);

test('garminIdOf: reads the "Garmin <id>" tag from notes', () => {
  assert.equal(garminIdOf({ notes: 'Beach walk (Garmin 24000000011; 1.23 mi; +3 ft).' }), '24000000011');
  assert.equal(garminIdOf({ notes: 'Lower Loop (Garmin walk 24000000012; 2.99 mi)' }), '24000000012');
});
test('garminIdOf: a garmin_id field wins; no tag → null', () => {
  assert.equal(garminIdOf({ garmin_id: 24000000001, notes: 'Garmin 24000000009' }), '24000000001');
  assert.equal(garminIdOf({ notes: 'Avg HR: 131. Max HR:168' }), null);
  assert.equal(garminIdOf({ notes: 'Garmin says 12 floors' }), null);
  assert.equal(garminIdOf({}), null);
});
test('parseBucketsCSV: one row per activity, only non-empty buckets kept', () => {
  assert.equal(Object.keys(B).length, 4);
  const r = B['24000000001'];
  assert.equal(r.date, '2026-09-27'); assert.equal(r.type, 'walking'); assert.equal(r.duration_sec, 3600);
  assert.equal(r.bins.length, 8);
  assert.deepEqual(r.bins[2], { lo: 100, hi: 105, open: null, sec: 1200 });
  assert.equal(B['24000000002'].corrected, true);
  assert.equal(B['24000000002'].bins.length, 3);
});
test('parseBucketsCSV: empty / header-only / CRLF text', () => {
  assert.deepEqual(R.parseBucketsCSV(''), {});
  assert.deepEqual(R.parseBucketsCSV('date,start,activity_id\n'), {});
  assert.equal(Object.keys(R.parseBucketsCSV(BUCKET_CSV.replace(/\n/g, '\r\n'))).length, 4);
});
test('hrRangeSeconds: ranges on bucket edges are exact', () => {
  const r = B['24000000001'];
  assert.equal(R.hrRangeSeconds(r, null, 120), 2700);
  assert.equal(R.hrRangeSeconds(r, 120, 130), 600);
  assert.equal(R.hrRangeSeconds(r, 130, null), 300);
  assert.equal(R.hrRangeSeconds(r, null, null), 3600);
  assert.equal(R.hrRangeSeconds(r, 105, 120), 900);
});
test('hrRangeSeconds: open-ended buckets count for open-ended ranges', () => {
  assert.equal(R.hrRangeSeconds(B['24000000002'], 130, null), 1200);
  assert.equal(R.hrRangeSeconds(B['24000000002'], 185, null), 600);
  assert.equal(R.hrRangeSeconds(B['24000000001'], null, 70), 120);
});
test('hrRangeSeconds: an edge inside a bucket takes a proportional share', () => {
  assert.ok(Math.abs(R.hrRangeSeconds(B['24000000001'], 107, 110) - 360) < 1e-9);
});
test('hrRangeSeconds: missing row → 0', () => assert.equal(R.hrRangeSeconds(undefined, 100, 120), 0));
test('zonesFromBuckets: time below the first floor stays separate from zone 1', () => {
  const z = R.zonesFromBuckets(B['24000000001'], [105, 120, 130, 145, 155]);
  assert.equal(z.below, 1800);
  assert.deepEqual(z.zones, [900, 600, 300, 0, 0]);
});
test('zonesFromBuckets: moving a floor re-slices the same stored data', () => {
  assert.deepEqual(R.zonesFromBuckets(B['24000000001'], [100, 125, 130]).zones, [2460, 240, 300]);
});
test('zonesFromBuckets / cleanFloors: unusable floors → null / []', () => {
  assert.equal(R.zonesFromBuckets(B['24000000001'], null), null);
  assert.equal(R.zonesFromBuckets(B['24000000001'], [120, 110]), null);
  assert.deepEqual(R.cleanFloors(['105', 120]), [105, 120]);
  assert.deepEqual(R.cleanFloors(undefined), []);
});
test('hrRangeText', () => {
  assert.equal(R.hrRangeText(null, 120), 'under 120 bpm');
  assert.equal(R.hrRangeText(120, 130), '120–129 bpm');
  assert.equal(R.hrRangeText(130, null), '130+ bpm');
});

const hrGoals = [
  { id: 'easy', label: 'Under 120', kind: 'sum', source: 'log', hr_max_bpm: 120, target: 10800, display: 'min' },
  { id: 'z2', label: '120–129', kind: 'sum', source: 'log', hr_min_bpm: 120, hr_max_bpm: 130, target: 2700, display: 'min' },
  { id: 'zone2', label: 'Zone 2 (typed)', kind: 'sum', source: 'log', field: 'zone2_sec', target: 2700, display: 'min' }
];
const hrLog = [
  E({ machine_id: 'run', machine: 'Run', date: '2026-09-28', duration_sec: 1800, notes: 'Evening run (Garmin 24000000002; 3 mi).' }),
  E({ machine_id: 'walk', machine: 'Walk', date: '2026-09-27', set: 1, duration_sec: 3600, zone1_sec: 3000, zone2_sec: 600, garmin_id: '24000000001' }),
  E({ machine_id: 'walk', machine: 'Walk', date: '2026-09-27', set: 2, duration_sec: 60, notes: 'second set, same activity: Garmin 24000000001' }),
  E({ gym_id: 'eg', machine_id: 'tm', machine: 'Treadmill', date: '2026-09-26', duration_sec: 1800, zone2_sec: 1500 }),
  E({ machine_id: 'walk', machine: 'Walk', date: '2026-09-25', duration_sec: 1200, notes: 'Garmin 24000000004' })
];
const hrOut = R.computeGoals(hrGoals, { log: hrLog, buckets: B, gyms, week_start: 'sat', today: '2026-09-29', offset: 0 });
const hrBy = id => hrOut.results.find(r => r.id === id);

test("hr-range goal: sums bucket time for Garmin activities in this week's log", () => {
  assert.equal(hrBy('easy').value, 2700);
  assert.equal(hrBy('z2').value, 1200);
  assert.deepEqual(hrBy('z2').items.map(i => [i.date, i.value, i.detail]), [['2026-09-27', 600, 'Walk'], ['2026-09-28', 600, 'Run']]);
});
test('hr-range goal: an activity cited by two log rows is counted once', () => {
  assert.equal(hrBy('easy').items.length, 1);
  assert.equal(hrBy('easy').items[0].value, 2700);
});
test('hr-range goal: hand-typed zone time and prior-week activities are not counted', () => assert.equal(hrBy('z2').value, 1200));
test('hr-range goal: flags Garmin activities in the week that are not in the log', () => assert.equal(hrBy('z2').note, '1 Garmin activity not in the log'));
test('hr-range goal: status and pace work like any other sum', () => {
  assert.equal(hrBy('z2').status, 'behind');
  assert.equal(hrBy('z2').expected, 1542.9);
});
test('hr-range goal: no bucket file → 0 with a hint, typed-zone goals unaffected', () => {
  const o = R.computeGoals(hrGoals, { log: hrLog, gyms, week_start: 'sat', today: '2026-09-29', offset: 0 });
  assert.equal(o.results.find(r => r.id === 'z2').value, 0);
  assert.equal(o.results.find(r => r.id === 'z2').note, 'needs cardio-buckets.csv');
  assert.equal(o.results.find(r => r.id === 'zone2').value, 2100);
});
test('typed-zone goal still sums the log fields when buckets are present', () => assert.equal(hrBy('zone2').value, 2100));

test('cleanGoalsConfig: trims labels, numbers targets, checks zone floors', () => {
  const c = R.cleanGoalsConfig({ goals: [{ label: '  Steps ', target: '70000' }, { label: '' }], hr_zones_bpm: [105, 120, null] });
  assert.equal(c.ok, true);
  assert.deepEqual(c.goals.goals, [{ label: 'Steps', target: 70000 }]);
  assert.deepEqual(c.goals.hr_zones_bpm, [105, 120]);
  assert.equal(R.cleanGoalsConfig({ hr_zones_bpm: [120, 110] }).ok, false);
});

test('an average is judged at the precision it is shown with (LogTrim parity)', () => {
  // 7.094 h shows as "7.1 h"; against a 7.1 h target it is a hit, as in LogTrim
  const g = [{ id: 's', kind: 'avg', source: 'wellness', field: 'sleep_sec', target: 25560, display: 'h' }];
  const w = [{ date: '2026-09-27', sleep_sec: 25500 }, { date: '2026-09-28', sleep_sec: 25580 }];
  const r = R.computeGoals(g, { log: [], wellness: w, gyms, week_start: 'sat', today: '2026-09-29' }).results[0];
  assert.equal(r.value, 25560);
  assert.equal(r.status, 'hit');
  assert.equal(R.roundForDisplay(1234.4, 'min'), 1236);
  assert.equal(R.roundForDisplay(48.34), 48.3);
});
