import test from 'node:test';
import assert from 'node:assert/strict';
import { fmtPace, fmtWalkPace, parseMinutes, fmtDuration, fmtLast, fmtSet, inferLogType, fmtGoalNum, slug, fmtDate } from '../lib/format.js';

test('fmtPace converts mph to min/mi', () => {
  assert.equal(fmtPace(6), '10:00/mi');
  assert.equal(fmtPace(3.5), '17:09/mi');
  assert.equal(fmtPace(0), '—');
  assert.equal(fmtPace(null), '—');
});

test('fmtWalkPace from distance and minutes', () => {
  assert.equal(fmtWalkPace(2, 40), '20:00/mi');
  assert.equal(fmtWalkPace(1.5, 30.5), '20:20/mi');
  assert.equal(fmtWalkPace(0, 30), '—');
});

test('parseMinutes accepts decimals, mm:ss and h:mm:ss', () => {
  assert.equal(parseMinutes('45'), 45);
  assert.equal(parseMinutes('45:30'), 45.5);
  assert.equal(parseMinutes('1:02:30'), 62.5);
  assert.equal(parseMinutes(''), null);
  assert.equal(parseMinutes(null), null);
  assert.equal(parseMinutes(0), 0);
  assert.equal(parseMinutes('abc'), null);
});

test('fmtDuration round-trips', () => {
  assert.equal(fmtDuration(45), '45');
  assert.equal(fmtDuration(45.5), '45:30');
  assert.equal(fmtDuration(22.65), '22:39');
  assert.equal(fmtDuration(null), '');
  assert.equal(fmtDuration(9.999), '10');
});

test('fmtLast summarises a session by type', () => {
  const now = new Date('2026-11-05T12:00:00');
  assert.equal(fmtLast([{ date: '2026-11-05', weight: 60, reps: 12 }, { date: '2026-11-05', weight: 80, reps: 10 }], 'weight', now), 'Today · 80 lbs × 2 sets');
  assert.equal(fmtLast([{ date: '2026-11-04', reps: 30 }, { date: '2026-11-04', reps: 25 }], 'reps', now), 'Yesterday · 55 reps · 2 sets');
  assert.equal(fmtLast([{ date: '2026-11-04', reps: 1 }], 'reps', now), 'Yesterday · 1 rep · 1 set');
  assert.equal(fmtLast([{ date: '2026-11-02', level: 2, duration: 40 }], 'walk', now), '3d ago · 2mi in 40min (20:00/mi)');
  assert.equal(fmtLast([{ date: '2026-11-02', duration: 60 }, { date: '2026-11-02', duration: 60 }], 'time', now), '3d ago · 2×60 sec');
  assert.equal(fmtLast([{ date: '2026-11-02', duration: 45.5 }], 'mins', now), '3d ago · 45:30 min');
});

test('fmtSet and inferLogType', () => {
  assert.equal(fmtSet({ weight: 50, reps: 10 }, 'weight'), '50 lbs × 10');
  assert.equal(fmtSet({ duration: 30, level: 3.5, incline: 10, hr: 125 }, 'cardio'), '30min · 3.5mph · 10% inc · HR 125');
  assert.equal(inferLogType({ weight: 50 }), 'weight');
  assert.equal(inferLogType({ incline: 2, duration: 20 }), 'cardio');
  assert.equal(inferLogType({ reps: 20 }), 'reps');
  assert.equal(inferLogType({ duration: 60 }), 'time');
});

test('fmtGoalNum and slug', () => {
  assert.equal(fmtGoalNum(70000), '70,000');
  assert.equal(fmtGoalNum(7.1, 'h'), '7.1 h');
  assert.equal(fmtGoalNum(null), '—');
  assert.equal(slug("Gold's Gym — NYC"), 'gold-s-gym-nyc');
});

test('fmtDate relative words', () => {
  const now = new Date('2026-11-05T09:00:00');
  assert.equal(fmtDate('2026-11-05', now), 'Today');
  assert.equal(fmtDate('2026-11-04', now), 'Yesterday');
  assert.equal(fmtDate('2026-11-01', now), '4d ago');
});
