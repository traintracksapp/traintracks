import { test } from 'node:test';
import assert from 'node:assert/strict';
import { FORM_COLUMNS, columnsFor, rowValues, parseRow, paceText } from '../lib/entryform.js';
import { LOG_TYPE_FIELDS } from '../lib/log.js';

test('every form field is a field of that log type', () => {
  for (const [t, cols] of Object.entries(FORM_COLUMNS)) {
    for (const c of cols) if (c.field) assert.ok(LOG_TYPE_FIELDS[t].includes(c.field), `${t}.${c.field}`);
  }
});

test('unknown log type falls back to weight & reps', () => assert.equal(columnsFor('zzz'), FORM_COLUMNS.weight));

test('weight: negative weight (assistance) is allowed', () => {
  assert.deepEqual(parseRow('weight', ['-100', '10']).fields, { weight_lb: -100, reps: 10 });
});

test('negative values elsewhere are rejected', () => {
  assert.match(parseRow('weight', ['50', '-3']).error, /Reps can't be negative/);
  assert.match(parseRow('walk', ['-1', '30']).error, /negative/);
});

test('reps must be whole numbers', () => assert.match(parseRow('reps', ['2.5']).error, /whole number/));

test('blank row → null fields, no error; blanks inside a row are null', () => {
  assert.deepEqual(parseRow('weight', ['', '']), { fields: null, error: null });
  assert.deepEqual(parseRow('weight', ['', '20']).fields, { weight_lb: null, reps: 20 });
});

test('minutes columns accept "30", "32:45" and "1:05:00" → seconds', () => {
  assert.equal(parseRow('mins', ['45']).fields.duration_sec, 2700);
  assert.equal(parseRow('walk', ['1.5', '32:45']).fields.duration_sec, 1965);
  assert.equal(parseRow('cardio', ['1:05:00', '', '', '']).fields.duration_sec, 3900);
  assert.match(parseRow('mins', ['5:6']).error, /valid time/);
});

test('time (planks) is entered in seconds', () => assert.deepEqual(parseRow('time', ['60']).fields, { duration_sec: 60 }));

test('cardio row', () => {
  assert.deepEqual(parseRow('cardio', ['30', '3.3', '4', '118']).fields, { duration_sec: 1800, speed_mph: 3.3, incline_pct: 4, hr_avg_bpm: 118 });
});

test('pace column is display only', () => {
  assert.deepEqual(parseRow('pace', ['30', '3', 'whatever']).fields, { duration_sec: 1800, speed_mph: 3 });
});

test('rubbish is an error naming the column', () => assert.match(parseRow('weight', ['abc', '5']).error, /Weight \(lb\)/));

test('rowValues: stored sets back into the form', () => {
  assert.deepEqual(rowValues('weight', { weight_lb: -85, reps: 7 }), ['-85', '7']);
  assert.deepEqual(rowValues('walk', { distance_mi: 2.2, duration_sec: 2640 }), ['2.2', '44', '']);
  assert.deepEqual(rowValues('mins', { duration_sec: 1965 }), ['32:45']);
  assert.deepEqual(rowValues('cardio', {}), ['', '', '', '']);
  assert.deepEqual(rowValues('reps', null), ['']);
});

test('round trip: rowValues → parseRow keeps the values', () => {
  const set = { duration_sec: 1965, speed_mph: 3.25, incline_pct: 2.5, hr_avg_bpm: 121 };
  assert.deepEqual(parseRow('cardio', rowValues('cardio', set)).fields, set);
});

test('paceText', () => {
  assert.equal(paceText('walk', ['1.5', '30']), '20:00/mi');
  assert.equal(paceText('pace', ['30', '3']), '20:00/mi');
  assert.equal(paceText('walk', ['', '30']), '—');
  assert.equal(paceText('weight', ['1', '2']), '');
});
