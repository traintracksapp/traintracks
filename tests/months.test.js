import { test } from 'node:test';
import assert from 'node:assert/strict';
import { monthPathOf, splitLog, joinMonths, monthToText, parseLogFile, logLayout, monthChanges, csvFromMonthFiles, compareLogs, sortMonthPaths, isMonthFile, UNDATED } from '../lib/months.js';
import { logToCSV, sortLog, mergeSession } from '../lib/log.js';

const E = (id, date, o) => ({ id, date, gym_id: 'g', machine_id: 'm', set: 1, variant: [], reps: 5, ...o });

test('an entry goes in the file of its month', () => {
  assert.equal(monthPathOf(E('a', '2026-11-04')), 'log/2026-11.json');
  assert.equal(monthPathOf(E('a', '2025-01-31')), 'log/2025-01.json');
  assert.equal(monthPathOf(E('a', '')), UNDATED);
  assert.equal(monthPathOf(E('a', '2026-13-01')), UNDATED);
  assert.equal(monthPathOf({ id: 'x' }), UNDATED);
});

test('isMonthFile: log/YYYY-MM.json and the undated file only', () => {
  assert.ok(isMonthFile('log/2026-11.json') && isMonthFile(UNDATED));
  assert.ok(!isMonthFile('log/2026-11.csv') && !isMonthFile('log/2026-1.json') && !isMonthFile('workout-log.json') && !isMonthFile('x/log/2026-11.json'));
});

test('split then join gives back a newest-first log unchanged', () => {
  const log = [E('n2', '2026-11-04', { set: 1 }), E('n3', '2026-11-04', { set: 2 }), E('n1', '2026-11-01'), E('o1', '2026-10-31'), E('s1', '2026-09-02')];
  const months = splitLog(log);
  assert.deepEqual(Object.keys(months).sort(), ['log/2026-09.json', 'log/2026-10.json', 'log/2026-11.json']);
  assert.deepEqual(joinMonths(months), log);
});

test('within a month: newest date first, a day keeps its order (sets stay in order)', () => {
  const months = splitLog([E('a', '2026-11-01'), E('b2', '2026-11-05', { set: 2 }), E('c', '2026-11-03'), E('b1', '2026-11-05', { set: 1 })]);
  assert.deepEqual(months['log/2026-11.json'].map(e => e.id), ['b2', 'b1', 'c', 'a']);
});

test('months are joined newest first, the undated file last', () => {
  assert.deepEqual(sortMonthPaths(['log/2025-12.json', UNDATED, 'log/2026-01.json']), ['log/2026-01.json', 'log/2025-12.json', UNDATED]);
});

test('file format: one entry per line, unknown fields and non-ASCII kept', () => {
  const entries = [E('a', '2026-11-04', { notes: 'Bodyweight — "ok", ✓\nline 2', extra_field: { x: [1, 2] } }), E('b', '2026-11-03')];
  const text = monthToText(entries);
  const lines = text.split('\n');
  assert.equal(lines[0], '[');
  assert.equal(lines[1], JSON.stringify(entries[0]) + ',');
  assert.equal(lines[2], JSON.stringify(entries[1]));
  assert.equal(lines[3], ']');
  assert.equal(lines[4], '');
  assert.equal(lines.length, 5);
  assert.deepEqual(parseLogFile(text), entries);
  assert.equal(monthToText([]), '[]\n');
});

test('a one-set change is a one-line diff', () => {
  const log = [E('a', '2026-11-04'), E('b', '2026-11-03'), E('c', '2026-11-02')];
  const before = monthToText(log).split('\n');
  const after = monthToText([log[0], { ...log[1], reps: 6 }, log[2]]).split('\n');
  assert.equal(before.filter((l, i) => l !== after[i]).length, 1);
});

test('parseLogFile refuses anything but a list', () => {
  assert.throws(() => parseLogFile('{"a":1}', 'log/2026-11.json'), /log\/2026-11\.json is not a list/);
});

test('logLayout: months, single file (not split yet), or none', () => {
  assert.deepEqual(logLayout({ 'log/2026-11.json': 1, 'log/2026-10.json': 1, 'profile.json': 1 }), { layout: 'months', paths: ['log/2026-11.json', 'log/2026-10.json'], legacyToo: false });
  assert.deepEqual(logLayout({ 'workout-log.json': 1, 'workout-log.csv': 1 }), { layout: 'single', paths: ['workout-log.json'], legacyToo: true });
  assert.equal(logLayout({ 'log/2026-11.json': 1, 'workout-log.json': 1 }).legacyToo, true);
  assert.equal(logLayout({ 'log/readme.txt': 1 }).layout, 'none');
});

test('monthChanges: only months whose content changed; emptied months removed', () => {
  const log = [E('n', '2026-11-04'), E('o', '2026-10-04'), E('s', '2026-09-04')];
  const before = splitLog(log);
  const next = mergeSession(log, { gym_id: 'g', machine_id: 'm', date: '2026-10-04', variant: [] }, [{ reps: 9 }], { gym_id: 'g', machine_id: 'm', date: '2026-12-01', variant: [] });
  const { write, remove } = monthChanges(before, next.filter(e => e.id !== 's'));
  assert.deepEqual(Object.keys(write).sort(), ['log/2026-12.json']);
  assert.deepEqual(remove, ['log/2026-09.json', 'log/2026-10.json']);
});

test('monthChanges ignores formatting: a pretty-printed month with the same entries is not rewritten', () => {
  const log = [E('a', '2026-11-04')];
  const pretty = JSON.parse(JSON.stringify(log, null, 2));
  assert.deepEqual(monthChanges({ 'log/2026-11.json': pretty }, log), { write: {}, remove: [] });
});

test('the CSV built from the month files equals the CSV of the single-file log', () => {
  const log = sortLog([E('a', '2026-11-04', { notes: 'a, "b"' }), E('b', '2026-10-01', { duration_sec: 1707, zone2_min: 1.73 }), E('c', '2026-11-04', { set: 2 }), E('d', '2025-12-31')]);
  const files = Object.fromEntries(Object.entries(splitLog(log)).map(([p, e]) => [p, monthToText(e)]));
  assert.equal(csvFromMonthFiles({ ...files, 'profile.json': '{}', 'workout-log.json': '[]' }), logToCSV(log));
});

test('compareLogs: same entries, missing, extra, order', () => {
  const a = [E('a', '2026-11-04'), E('b', '2026-11-03')];
  assert.deepEqual(compareLogs(a, [...a]), { same: true, missing: 0, extra: 0, sameOrder: true });
  assert.deepEqual(compareLogs(a, [a[1], a[0]]), { same: true, missing: 0, extra: 0, sameOrder: false });
  assert.deepEqual(compareLogs(a, [a[0]]), { same: false, missing: 1, extra: 0, sameOrder: false });
  assert.deepEqual(compareLogs(a, [...a, { ...a[0], reps: 6 }]).extra, 1);
  assert.equal(compareLogs([a[0], a[0]], [a[0]]).missing, 1, 'duplicates are counted');
});
