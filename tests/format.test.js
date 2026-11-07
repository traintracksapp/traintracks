import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseDuration, fmtDuration, fmtSeconds, fmtPace, fmtDistancePace, fmtNum } from '../lib/format.js';

// Ported from LogTrim tests/utils.test.js. LogTrim's parseMinutes returned
// minutes; parseDuration returns seconds (D15), so the expected values are ×60.
test('fmtPace: 3 mph → 20:00/mi', () => assert.equal(fmtPace(3), '20:00/mi'));
test('fmtPace: 4 mph → 15:00/mi', () => assert.equal(fmtPace(4), '15:00/mi'));
test('fmtPace: 3.5 mph → 17:09/mi', () => assert.equal(fmtPace(3.5), '17:09/mi'));
test('fmtPace: 0 → —', () => assert.equal(fmtPace(0), '—'));
test('fmtPace: null → —', () => assert.equal(fmtPace(null), '—'));
test('fmtPace: negative → —', () => assert.equal(fmtPace(-1), '—'));

// LogTrim fmtWalkPace(miles, minutes) → fmtDistancePace(miles, seconds)
test('fmtDistancePace: 1.5 mi in 30 min → 20:00/mi', () => assert.equal(fmtDistancePace(1.5, 1800), '20:00/mi'));
test('fmtDistancePace: 1 mi in 20 min → 20:00/mi', () => assert.equal(fmtDistancePace(1, 1200), '20:00/mi'));
test('fmtDistancePace: 2 mi in 45 min → 22:30/mi', () => assert.equal(fmtDistancePace(2, 2700), '22:30/mi'));
test('fmtDistancePace: 0 distance → —', () => assert.equal(fmtDistancePace(0, 1800), '—'));
test('fmtDistancePace: null distance → —', () => assert.equal(fmtDistancePace(null, 1800), '—'));
test('fmtDistancePace: null duration → —', () => assert.equal(fmtDistancePace(1.5, null), '—'));

test('parseDuration: "30" → 1800 s', () => assert.equal(parseDuration('30'), 1800));
test('parseDuration: "5:06" → 306 s', () => assert.equal(parseDuration('5:06'), 306));
test('parseDuration: "30:00" → 1800 s', () => assert.equal(parseDuration('30:00'), 1800));
test('parseDuration: "32:45" → 1965 s', () => assert.equal(parseDuration('32:45'), 1965));
test('parseDuration: "1:30:00" → 5400 s', () => assert.equal(parseDuration('1:30:00'), 5400));
test('parseDuration: "" → null', () => assert.equal(parseDuration(''), null));
test('parseDuration: null → null', () => assert.equal(parseDuration(null), null));
test('parseDuration: 30 (number, minutes) → 1800 s', () => assert.equal(parseDuration(30), 1800));
test('parseDuration: rubbish → null', () => { assert.equal(parseDuration('abc'), null); assert.equal(parseDuration('5:6'), null); });

test('fmtDuration: 1800 → "30"', () => assert.equal(fmtDuration(1800), '30'));
test('fmtDuration: 306 → "5:06"', () => assert.equal(fmtDuration(306), '5:06'));
test('fmtDuration: 1965 → "32:45"', () => assert.equal(fmtDuration(1965), '32:45'));
test('fmtDuration: 5400 → "1:30:00"', () => assert.equal(fmtDuration(5400), '1:30:00'));
test('fmtDuration: 0 → "0"', () => assert.equal(fmtDuration(0), '0'));
test('fmtDuration: null → ""', () => assert.equal(fmtDuration(null), ''));
test('round-trip "5:06"', () => assert.equal(fmtDuration(parseDuration('5:06')), '5:06'));
test('round-trip "32:45"', () => assert.equal(fmtDuration(parseDuration('32:45')), '32:45'));
test('round-trip "30:00"', () => assert.equal(fmtDuration(parseDuration('30:00')), '30'));

test('fmtSeconds: short holds in seconds', () => {
  assert.equal(fmtSeconds(45), '45 s');
  assert.equal(fmtSeconds(90), '1:30');
  assert.equal(fmtSeconds(null), '');
});

test('fmtNum: trims trailing zeros', () => {
  assert.equal(fmtNum(32.50), '32.5');
  assert.equal(fmtNum(1.0), '1');
  assert.equal(fmtNum(1.239), '1.24');
  assert.equal(fmtNum(null), '');
});
