import { test } from 'node:test';
import assert from 'node:assert/strict';
import { todayWellnessRow, withTodayWellness, byNight, reportWellness, NIGHT_FIELDS } from '../lib/wellness.js';
import { computeGoals, parseWellnessCSV } from '../lib/goals.js';

// Made-up data. The week of Mon 2030-03-04; "today" is Fri 2030-03-08.
const TODAY = '2030-03-08';
const h = x => Math.round(x * 3600);
const recent = (o = {}) => ({
  fetched_at: '2030-03-08T07:12:00Z',
  today: TODAY,
  today_stats: { steps: 1200, floors: 2, resting_hr_bpm: 51, active_kcal: 80, body_battery: 77, stress_avg: 20, week_steps: 54000 },
  training_readiness: { score: 80 },
  sleep: { date: TODAY, sleep_sec: h(8.05), score: 84, deep_sec: 5400, light_sec: 15000, rem_sec: 6300, awake_sec: 900, respiration_brpm: 14.2, spo2_pct: 95.5 },
  hrv: { date: TODAY, last_night_ms: 47, weekly_avg_ms: 44, status: 'BALANCED' },
  ...o
});
const csvRows = () => parseWellnessCSV(['date,steps,resting_hr_bpm,sleep_sec,hrv_ms,hrv_status',
  `2030-03-04,9000,52,${h(7.6)},41,BALANCED`,
  `2030-03-05,8000,53,${h(6.4)},39,BALANCED`,
  `2030-03-06,10000,52,${h(6.9)},42,BALANCED`,
  `2030-03-07,11000,51,${h(7.2)},43,BALANCED`].join('\n') + '\n');

test('todayWellnessRow: last night\'s sleep and HRV, mapped to the CSV columns', () => {
  assert.deepEqual(todayWellnessRow(recent()), {
    date: TODAY, sleep_sec: h(8.05), sleep_score: 84, sleep_deep_sec: 5400, sleep_light_sec: 15000, sleep_rem_sec: 6300,
    sleep_awake_sec: 900, sleep_respiration_brpm: 14.2, sleep_spo2_pct: 95.5, hrv_ms: 47, hrv_status: 'BALANCED'
  });
});

test('todayWellnessRow: daytime numbers are left out (today is not over)', () => {
  const row = todayWellnessRow(recent());
  for (const k of ['steps', 'floors', 'resting_hr_bpm', 'active_kcal', 'total_kcal', 'stress_avg', 'body_battery_high', 'body_battery_low', 'body_battery', 'week_steps', 'vo2max', 'intensity_moderate_sec'])
    assert.ok(!(k in row), k);
});

test('withTodayWellness: the snapshot adds a row for today', () => {
  const rows = csvRows();
  const out = withTodayWellness(rows, recent());
  assert.equal(out.length, 5);
  assert.equal(out[4].date, TODAY);
  assert.equal(out[4].sleep_sec, h(8.05));
  assert.equal(rows.length, 4, 'the input is not changed');
});

test('withTodayWellness: a CSV row for that date wins', () => {
  const rows = [...csvRows(), { date: TODAY, sleep_sec: h(6), hrv_ms: 30, steps: 15000 }];
  const out = withTodayWellness(rows, recent());
  assert.equal(out.length, 5);
  assert.deepEqual(out.filter(r => r.date === TODAY), [{ date: TODAY, sleep_sec: h(6), hrv_ms: 30, steps: 15000 }]);
});

test('sleep.date not today: no sleep fields; HRV only with its own date', () => {
  const sleepY = { ...recent().sleep, date: '2030-03-07' };
  // HRV dated today still counts.
  assert.deepEqual(todayWellnessRow(recent({ sleep: sleepY })), { date: TODAY, hrv_ms: 47, hrv_status: 'BALANCED' });
  // HRV also yesterday's: nothing for today.
  assert.equal(todayWellnessRow(recent({ sleep: sleepY, hrv: { ...recent().hrv, date: '2030-03-07' } })), null);
  // A file from before hrv.date: HRV may be yesterday's fallback, so it counts only with today's sleep.
  const { date, ...oldHrv } = recent().hrv;
  assert.equal(date, TODAY);
  assert.equal(todayWellnessRow(recent({ sleep: sleepY, hrv: oldHrv })), null);
  assert.equal(todayWellnessRow(recent({ hrv: oldHrv })).hrv_ms, 47);
  assert.deepEqual(withTodayWellness(csvRows(), recent({ sleep: sleepY, hrv: oldHrv })).length, 4);
});

test('missing or garbage snapshot: no row, rows unchanged', () => {
  const rows = csvRows();
  for (const bad of [null, undefined, 'text', 42, [], [recent()], {}, { today: 'tomorrow', sleep: recent().sleep },
    { today: 20300308 }, { today: TODAY }, { today: TODAY, sleep: 'x', hrv: [1] }, { today: TODAY, sleep: null, hrv: null }]) {
    assert.equal(todayWellnessRow(bad), null, JSON.stringify(bad));
    assert.deepEqual(withTodayWellness(rows, bad), rows);
  }
  assert.deepEqual(withTodayWellness(null, null), []);
  assert.equal(withTodayWellness(undefined, recent()).length, 1);
});

test('only finite numbers are taken', () => {
  const row = todayWellnessRow(recent({
    sleep: { date: TODAY, sleep_sec: '28980', score: null, deep_sec: NaN, light_sec: Infinity, rem_sec: { v: 1 }, awake_sec: true, respiration_brpm: 14, spo2_pct: [95] },
    hrv: { date: TODAY, last_night_ms: '47', status: 'BALANCED' }
  }));
  assert.deepEqual(row, { date: TODAY, sleep_respiration_brpm: 14 });
  // A status alone is not data.
  assert.equal(todayWellnessRow(recent({ sleep: null, hrv: { date: TODAY, last_night_ms: null, status: 'LOW' } })), null);
  // A status that is not a string is dropped.
  assert.deepEqual(todayWellnessRow(recent({ sleep: null, hrv: { date: TODAY, last_night_ms: 50, status: { x: 1 } } })), { date: TODAY, hrv_ms: 50 });
});

test('weekly report: today\'s sleep counts toward the average, the per-day list and the day count', () => {
  const goals = [
    { id: 'sleep', label: 'Average sleep', kind: 'avg', source: 'wellness', field: 'sleep_sec', target: h(7.1), display: 'h' },
    { id: 'hrv', label: 'Average HRV', kind: 'avg', source: 'wellness', field: 'hrv_ms', target: 40 },
    { id: 'steps', label: 'Total steps', kind: 'sum', source: 'wellness', field: 'steps', target: 70000 },
    { id: 'rhr', label: 'Resting HR', kind: 'avg', source: 'wellness', field: 'resting_hr_bpm', target: 55, direction: 'below' }
  ];
  const ctx = wellness => ({ log: [], wellness, buckets: {}, gyms: [], week_start: 'mon', today: TODAY });
  const before = computeGoals(goals, ctx(csvRows()));
  const after = computeGoals(goals, ctx(withTodayWellness(csvRows(), recent())));
  const g = (o, id) => o.results.find(r => r.id === id);

  assert.equal(before.isCurrent, true);
  assert.equal(before.daysElapsed, 5);
  // 7.6, 6.4, 6.9, 7.2 → 7.0 h: below 7.1. With 8.05 h last night → 7.2 h: met.
  assert.equal(g(before, 'sleep').value, h(7.0));
  assert.equal(g(before, 'sleep').status, 'miss');
  assert.equal(g(after, 'sleep').value, h(7.2));
  assert.equal(g(after, 'sleep').status, 'hit');
  assert.equal(g(after, 'sleep').daysWithData, 5);
  assert.deepEqual(g(after, 'sleep').items.map(i => i.date), ['2030-03-04', '2030-03-05', '2030-03-06', '2030-03-07', TODAY]);
  assert.equal(g(after, 'sleep').items[4].value, h(8.05));
  assert.equal(g(after, 'hrv').daysWithData, 5);
  assert.equal(g(after, 'hrv').value, 42.4);

  // Daytime goals see no row for today, so their pace and "synced" note are as before.
  for (const id of ['steps', 'rhr']) {
    const [b, a] = [g(before, id), g(after, id)];
    assert.equal(a.daysWithData, 4, id);
    assert.deepEqual([a.value, a.status, a.expected, a.note, a.items], [b.value, b.status, b.expected, b.note, b.items], id);
  }
  // Steps pace is judged on the 4 synced days: 38,000 vs 40,000 expected → behind.
  assert.equal(g(after, 'steps').expected, 40000);
  assert.equal(g(after, 'steps').status, 'behind');
  assert.equal(g(after, 'steps').note, '4 of 5 days synced');
});

test('weekly report: a snapshot dated in another week does not touch this one', () => {
  const goals = [{ id: 'sleep', label: 'Average sleep', kind: 'avg', source: 'wellness', field: 'sleep_sec', target: h(7.1), display: 'h' }];
  const old = recent({ today: '2030-02-25', sleep: { ...recent().sleep, date: '2030-02-25' }, hrv: { ...recent().hrv, date: '2030-02-25' } });
  const o = computeGoals(goals, { log: [], wellness: withTodayWellness(csvRows(), old), buckets: {}, gyms: [], week_start: 'mon', today: TODAY });
  assert.equal(o.results[0].daysWithData, 4);
});

test('byNight: overnight fields move to the evening the night starts; daytime fields keep their day', () => {
  const rows = csvRows();
  const copy = JSON.parse(JSON.stringify(rows));
  const out = byNight(rows);
  assert.deepEqual(rows, copy, 'input unchanged');
  assert.deepEqual(out.map(r => r.date), ['2030-03-03', '2030-03-04', '2030-03-05', '2030-03-06', '2030-03-07']);
  // Sun 03-03: only the night that ended Mon morning.
  assert.deepEqual(out[0], { date: '2030-03-03', sleep_sec: h(7.6), hrv_ms: 41, hrv_status: 'BALANCED' });
  // Mon 03-04: Monday's steps and resting HR, Monday night's sleep and HRV (from Tuesday's row).
  assert.deepEqual(out[1], { date: '2030-03-04', steps: 9000, resting_hr_bpm: 52, sleep_sec: h(6.4), hrv_ms: 39, hrv_status: 'BALANCED' });
  // Thu 03-07: Thursday's steps; Thursday night is not known yet.
  assert.deepEqual(out[4], { date: '2030-03-07', steps: 11000, resting_hr_bpm: 51 });
});

test('byNight: every sleep column and HRV is overnight; nothing else is', () => {
  const row = { date: '2030-03-08', steps: 1, resting_hr_bpm: 50, body_battery_high: 90, vo2max: 42, stress_avg: 20 };
  for (const f of NIGHT_FIELDS) row[f] = f === 'hrv_status' ? 'LOW' : 7;
  const [night, day] = byNight([row]);
  assert.deepEqual(Object.keys(night).sort(), ['date', ...NIGHT_FIELDS].sort());
  assert.equal(night.date, '2030-03-07');
  assert.deepEqual(day, { date: '2030-03-08', steps: 1, resting_hr_bpm: 50, body_battery_high: 90, vo2max: 42, stress_avg: 20 });
  // A month and a year boundary.
  assert.equal(byNight([{ date: '2030-01-01', sleep_sec: 1 }])[0].date, '2029-12-31');
  assert.equal(byNight([{ date: '2030-03-01', hrv_ms: 1 }])[0].date, '2030-02-28');
});

test('byNight: rows without a valid date are left out; not a list → []', () => {
  assert.deepEqual(byNight([null, {}, { date: 'yesterday', sleep_sec: 1 }, { date: 20300301, sleep_sec: 1 }]), []);
  assert.deepEqual(byNight(null), []);
  assert.deepEqual(byNight('x'), []);
});

test('weekly report by night: last night is yesterday, next to yesterday\'s steps', () => {
  const goals = [
    { id: 'sleep', label: 'Average sleep', kind: 'avg', source: 'wellness', field: 'sleep_sec', target: h(7.1), display: 'h' },
    { id: 'hrv', label: 'Average HRV', kind: 'avg', source: 'wellness', field: 'hrv_ms', target: 40 },
    { id: 'steps', label: 'Total steps', kind: 'sum', source: 'wellness', field: 'steps', target: 70000 }
  ];
  const run = (offset = 0) => computeGoals(goals, { log: [], wellness: reportWellness(csvRows(), recent()), buckets: {}, gyms: [], week_start: 'mon', today: TODAY, offset });
  const g = (o, id) => o.results.find(r => r.id === id);
  const o = run();
  // Nights Mon–Thu: 6.4, 6.9, 7.2 and last night's 8.05 → 7.1375 h, shown as 7.1 h: met.
  assert.deepEqual(g(o, 'sleep').items.map(i => i.date), ['2030-03-04', '2030-03-05', '2030-03-06', '2030-03-07']);
  assert.equal(g(o, 'sleep').items[3].value, h(8.05));
  assert.equal(g(o, 'sleep').value, h(7.1));
  assert.equal(g(o, 'sleep').status, 'hit');
  assert.equal(g(o, 'hrv').value, 42.8); // 39, 42, 43, 47
  // Every card ends on the same day: yesterday.
  assert.deepEqual(g(o, 'steps').items.map(i => i.date), g(o, 'sleep').items.map(i => i.date));
  assert.equal(g(o, 'steps').value, 38000);
  // Sunday night (woke Monday 03-04) belongs to last week.
  const last = run(-1);
  assert.deepEqual(g(last, 'sleep').items.map(i => [i.date, i.value]), [['2030-03-03', h(7.6)]]);
  assert.deepEqual(g(last, 'steps').items, []);
});
