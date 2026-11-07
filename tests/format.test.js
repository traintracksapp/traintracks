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
  assert.equal(fmtSeconds(90), '90 s');
  assert.equal(fmtSeconds(150), '2:30 min');
  assert.equal(fmtSeconds(null), '');
});

test('fmtNum: trims trailing zeros', () => {
  assert.equal(fmtNum(32.50), '32.5');
  assert.equal(fmtNum(1.0), '1');
  assert.equal(fmtNum(1.239), '1.24');
  assert.equal(fmtNum(null), '');
});

import { fmtWeight, fmtDate, fmtDateFull, fmtRange, fmtSet, fmtLast } from '../lib/format.js';

test('fmtWeight: negative weight is assistance', () => {
  assert.equal(fmtWeight(60), '60 lb');
  assert.equal(fmtWeight(-100), '100 lb assist');
  assert.equal(fmtWeight(null), '');
});

test('fmtDate: relative to today', () => {
  assert.equal(fmtDate('2026-11-07', '2026-11-07'), 'Today');
  assert.equal(fmtDate('2026-11-06', '2026-11-07'), 'Yesterday');
  assert.equal(fmtDate('2026-11-04', '2026-11-07'), '3d ago');
  assert.equal(fmtDate('2026-10-04', '2026-11-07'), 'Oct 4');
});

test('fmtDateFull / fmtRange', () => {
  assert.equal(fmtDateFull('2026-11-07'), 'Sat, Nov 7, 2026');
  assert.equal(fmtRange('2026-10-31', '2026-11-06'), 'Oct 31 – Nov 6');
});

test('fmtSet: each kind of set', () => {
  assert.equal(fmtSet({ weight_lb: 60, reps: 12 }), '60 lb × 12');
  assert.equal(fmtSet({ weight_lb: -85, reps: 7 }), '85 lb assist × 7');
  assert.equal(fmtSet({ reps: 20 }), '20 reps');
  assert.equal(fmtSet({ duration_sec: 60 }), '60 s');
  assert.equal(fmtSet({ duration_sec: 2700 }), '45 min');
  assert.equal(fmtSet({ distance_mi: 1.5, duration_sec: 1800, hr_avg_bpm: 95 }), '1.5 mi · 30 min · 20:00/mi · HR 95');
  assert.equal(fmtSet({ duration_sec: 300, speed_mph: 3.3, incline_pct: 4 }), '5 min · 3.3 mph · 4% incline · 18:11/mi');
  assert.equal(fmtSet({}), '—');
});

test('fmtLast: summaries', () => {
  const t = '2026-11-07';
  assert.equal(fmtLast([{ date: t, weight_lb: 60, reps: 12 }, { date: t, weight_lb: 70, reps: 8 }], t), 'Today · 70 lb × 2 sets');
  assert.equal(fmtLast([{ date: t, weight_lb: -100, reps: 10 }, { date: t, weight_lb: -85, reps: 7 }], t), 'Today · 85 lb assist × 2 sets');
  assert.equal(fmtLast([{ date: t, reps: 20 }, { date: t, reps: 25 }], t), 'Today · 45 reps · 2 sets');
  assert.equal(fmtLast([{ date: t, duration_sec: 60 }, { date: t, duration_sec: 60 }, { date: t, duration_sec: 60 }], t), 'Today · 3× 60 s');
  assert.equal(fmtLast([{ date: t, distance_mi: 2.2, duration_sec: 2640 }], t), 'Today · 2.2 mi in 44 min');
  assert.equal(fmtLast([{ date: t, duration_sec: 2700 }], t), 'Today · 45 min');
  assert.equal(fmtLast([], t), '');
});
