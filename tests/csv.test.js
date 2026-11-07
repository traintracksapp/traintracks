import { test } from 'node:test';
import assert from 'node:assert/strict';
import { csvField, toCSV, parseRows, parseCSV } from '../lib/csv.js';

// LogTrim replaced commas/quotes/newlines with spaces (csvEsc). Version 2 uses
// standard quoting instead, so notes keep their punctuation (spec §4.2, D6).
test('csvField: plain text unchanged', () => assert.equal(csvField('Hello'), 'Hello'));
test('csvField: comma → quoted, kept', () => assert.equal(csvField('a,b'), '"a,b"'));
test('csvField: quotes are doubled', () => assert.equal(csvField('say "hi"'), '"say ""hi"""'));
test('csvField: newline → quoted, kept', () => assert.equal(csvField('a\nb'), '"a\nb"'));
test('csvField: null/undefined → empty', () => { assert.equal(csvField(null), ''); assert.equal(csvField(undefined), ''); });
test('csvField: zero is written, not blank', () => assert.equal(csvField(0), '0'));
test('csvField: numbers are plain', () => { assert.equal(csvField(32.5), '32.5'); assert.equal(csvField(1945), '1945'); });
test('csvField: tag lists are joined with "; "', () => assert.equal(csvField(['incline', 'wide']), 'incline; wide'));
test('csvField: empty tag list → empty', () => assert.equal(csvField([]), ''));

test('toCSV: header, columns in order, LF endings, trailing newline', () => {
  const out = toCSV([{ b: 2, a: 1, extra: 'x' }], ['a', 'b', 'c']);
  assert.equal(out, 'a,b,c\n1,2,\n');
});

test('parseRows: quoted fields with commas, doubled quotes and newlines', () => {
  const rows = parseRows('a,b,c\n1,"x, y","he said ""no""\nthen left"\n');
  assert.deepEqual(rows, [['a', 'b', 'c'], ['1', 'x, y', 'he said "no"\nthen left']]);
});

test('parseRows: CRLF, empty fields and no trailing newline', () => {
  assert.deepEqual(parseRows('a,b\r\n1,\r\n,2'), [['a', 'b'], ['1', ''], ['', '2']]);
});

test('parseRows: blank lines are skipped; empty text → []', () => {
  assert.deepEqual(parseRows('a\n\n1\n'), [['a'], ['1']]);
  assert.deepEqual(parseRows(''), []);
});

test('parseCSV: rows keyed by header name, missing cells → ""', () => {
  assert.deepEqual(parseCSV('date,steps\n2026-11-01,9000\n2026-11-02\n'), [
    { date: '2026-11-01', steps: '9000' }, { date: '2026-11-02', steps: '' }
  ]);
});

test('parseCSV: column order does not matter to readers', () => {
  const a = parseCSV('x,y\n1,2\n')[0], b = parseCSV('y,x\n2,1\n')[0];
  assert.deepEqual(a, b);
});

test('round trip: toCSV → parseCSV keeps awkward values', () => {
  const notes = 'Hotel gym, 7,300 ft — "felt easy"\nlegs fresh';
  const back = parseCSV(toCSV([{ id: 'e1', notes }], ['id', 'notes']));
  assert.equal(back[0].notes, notes);
});

test('parseCSV: header-only text → []', () => assert.deepEqual(parseCSV('a,b\n'), []));
