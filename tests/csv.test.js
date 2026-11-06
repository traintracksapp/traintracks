import test from 'node:test';
import assert from 'node:assert/strict';
import { toCSV, CSV_HEADER, csvEsc, parseSimpleCSV } from '../lib/csv.js';

test('header is the frozen contract with garminId last', () => {
  assert.equal(CSV_HEADER.split(',').length, 19);
  assert.ok(CSV_HEADER.endsWith(',garminId'));
  assert.ok(CSV_HEADER.startsWith('datetime,gym,room,machine,machineId,set,weight,reps,duration,level,incline,hr,notes,zone1'));
});

test('toCSV writes one row per entry, LF terminated, no quoting', () => {
  const csv = toCSV([
    { datetime: '2026-11-05 10:00:00 AM', gym: 'Home, Inc', room: 'R', machine: 'Push "Ups"', machineId: 'push-ups', set: 1, weight: null, reps: 30, notes: 'line\nbreak', garminId: '123456789' },
    { date: '2026-11-04', gym: 'G', room: 'R', machine: 'M', machineId: 'm1', set: 2, weight: 50, reps: 10, duration: null, zone1: 22.65 }
  ]);
  const lines = csv.split('\n');
  assert.equal(lines[0], CSV_HEADER);
  assert.equal(lines[1], '2026-11-05 10:00:00 AM,Home  Inc,R,Push  Ups ,push-ups,1,,30,,,,,line break,,,,,,123456789');
  assert.equal(lines[2], '2026-11-04,G,R,M,m1,2,50,10,,,,,,22.65,,,,,');
  assert.equal(lines[3], '');
  assert.ok(csv.endsWith('\n'));
});

test('csvEsc strips commas, quotes, newlines', () => {
  assert.equal(csvEsc('a,b"c\nd'), 'a b c d');
  assert.equal(csvEsc(null), '');
});

test('parseSimpleCSV parses numbers and blanks', () => {
  const rows = parseSimpleCSV('date,steps,hrv_status\n2026-11-01,8000,BALANCED\n2026-11-02,,\n');
  assert.equal(rows.length, 2);
  assert.equal(rows[0].steps, 8000);
  assert.equal(rows[0].hrv_status, 'BALANCED');
  assert.equal(rows[1].steps, null);
});
