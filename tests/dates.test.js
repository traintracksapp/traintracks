import { test } from 'node:test';
import assert from 'node:assert/strict';
import { addDays, daysBetween, weekBounds, inRange, fmtShortDate, isValidDate, isValidTime,
  localDate, localTime, timeFromLegacyDatetime } from '../lib/dates.js';

// Ported from LogTrim tests/reports.test.js (weekBounds)
test('weekBounds: sat start, Tue 9/29 → Sat 9/26 .. Fri 10/2', () => {
  assert.deepEqual(weekBounds('2026-09-29', 'sat'), { start: '2026-09-26', end: '2026-10-02' });
});
test('weekBounds: sat start, on a Saturday the week starts today', () => {
  assert.deepEqual(weekBounds('2026-09-26', 'sat'), { start: '2026-09-26', end: '2026-10-02' });
});
test('weekBounds: sat start, on a Friday the week started 6 days ago', () => {
  assert.deepEqual(weekBounds('2026-10-02', 'sat'), { start: '2026-09-26', end: '2026-10-02' });
});
test('weekBounds: offset -1 is the prior week', () => {
  assert.deepEqual(weekBounds('2026-09-29', 'sat', -1), { start: '2026-09-19', end: '2026-09-25' });
});
test('weekBounds: mon start', () => {
  assert.deepEqual(weekBounds('2026-09-29', 'mon'), { start: '2026-09-28', end: '2026-10-04' });
});
test('weekBounds: sun start', () => {
  assert.deepEqual(weekBounds('2026-09-29', 'sun'), { start: '2026-09-27', end: '2026-10-03' });
});
test('weekBounds: unknown weekStart falls back to monday', () => {
  assert.deepEqual(weekBounds('2026-09-29', 'xyz'), weekBounds('2026-09-29', 'mon'));
  assert.deepEqual(weekBounds('2026-09-29', undefined), weekBounds('2026-09-29', 'mon'));
});
test('weekBounds: crosses a month boundary correctly', () => {
  assert.deepEqual(weekBounds('2026-11-02', 'sat'), { start: '2026-10-31', end: '2026-11-06' });
});
test('weekBounds: full day names work', () => {
  assert.deepEqual(weekBounds('2026-09-29', 'Saturday'), weekBounds('2026-09-29', 'sat'));
});

test('addDays / daysBetween across DST and year ends', () => {
  assert.equal(addDays('2026-11-01', 1), '2026-11-02'); // US DST ends
  assert.equal(addDays('2026-03-08', 1), '2026-03-09'); // US DST starts
  assert.equal(addDays('2026-12-31', 1), '2027-01-01');
  assert.equal(addDays('2028-02-28', 1), '2028-02-29');
  assert.equal(daysBetween('2026-10-31', '2026-11-06'), 6);
});

test('inRange is inclusive and rejects blanks', () => {
  const b = { start: '2026-10-31', end: '2026-11-06' };
  assert.ok(inRange('2026-10-31', b));
  assert.ok(inRange('2026-11-06', b));
  assert.ok(!inRange('2026-11-07', b));
  assert.ok(!inRange('', b));
});

test('fmtShortDate', () => assert.equal(fmtShortDate('2026-11-07'), 'Sat 11/7'));

test('isValidDate / isValidTime', () => {
  assert.ok(isValidDate('2026-02-28'));
  assert.ok(!isValidDate('2026-02-30'));
  assert.ok(!isValidDate('2026-2-3'));
  assert.ok(isValidTime('23:59:59'));
  assert.ok(!isValidTime('24:00:00'));
  assert.ok(!isValidTime('9:00:00'));
});

test('localDate / localTime use the device clock', () => {
  const d = new Date(2026, 10, 7, 9, 5, 3); // local time
  assert.equal(localDate(d), '2026-11-07');
  assert.equal(localTime(d), '09:05:03');
});

test('timeFromLegacyDatetime converts version 1 datetimes', () => {
  assert.equal(timeFromLegacyDatetime('2026-11-05 12:14:40 PM'), '12:14:40');
  assert.equal(timeFromLegacyDatetime('2026-11-05 12:05:00 AM'), '00:05:00');
  assert.equal(timeFromLegacyDatetime('2026-11-05 1:02:03 PM'), '13:02:03');
  assert.equal(timeFromLegacyDatetime('2026-11-05 07:30'), '07:30:00');
  assert.equal(timeFromLegacyDatetime(''), '');
  assert.equal(timeFromLegacyDatetime(undefined), '');
  assert.equal(timeFromLegacyDatetime('garbage'), '');
});
