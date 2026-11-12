import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isAppFile, toDownload, nextFiles, changedPaths, makeSnapshot, validSnapshot, withFile, withLogSave } from '../lib/snapshot.js';

const tree = {
  'workout-log.json': 'L1', 'workout-log.csv': 'C1', 'profile.json': 'P1', 'VERSION': 'V1',
  'equipment/generic/gym.json': 'G1', 'equipment/generic/images/run.jpg': 'I1',
  'equipment/my-gyms/a/gym.json': 'A1', 'equipment/my-gyms/a/images/x.jpg': 'I2', 'app/main.js': 'M1'
};

test('isAppFile: the files the app reads on load, and nothing else', () => {
  assert.ok(isAppFile('workout-log.json'));
  assert.ok(isAppFile('equipment/my-gyms/a/gym.json'));
  assert.ok(!isAppFile('workout-log.csv'), 'the CSV is an export; the app never reads it');
  assert.ok(!isAppFile('equipment/my-gyms/a/images/x.jpg'));
  assert.ok(!isAppFile('equipment/my-gyms/a/b/gym.json'));
  assert.ok(!isAppFile('app/main.js'));
});

test('first open: every app file is downloaded', () => {
  assert.deepEqual(toDownload(tree, {}), ['VERSION', 'equipment/generic/gym.json', 'equipment/my-gyms/a/gym.json', 'profile.json', 'workout-log.json']);
});

test('only files whose blob sha changed are downloaded', () => {
  const have = { 'workout-log.json': { sha: 'L0', text: '[]' }, 'profile.json': { sha: 'P1', text: '{}' }, 'VERSION': { sha: 'V1', text: '0.2.4' },
    'equipment/generic/gym.json': { sha: 'G1', text: '{}' }, 'equipment/my-gyms/a/gym.json': { sha: 'A1', text: '{}' } };
  assert.deepEqual(toDownload(tree, have), ['workout-log.json']);
  const files = nextFiles(tree, have, { 'workout-log.json': '[1]' });
  assert.deepEqual(files['workout-log.json'], { sha: 'L1', text: '[1]' });
  assert.equal(files['profile.json'], have['profile.json']);
  assert.ok(!('workout-log.csv' in files));
  assert.deepEqual(changedPaths(have, files), ['workout-log.json']);
});

test('a file removed from the repo is dropped (a dismissed plan, a deleted gym)', () => {
  const have = { 'suggested-workout.json': { sha: 'S1', text: '{}' }, 'profile.json': { sha: 'P1', text: '{}' } };
  const files = nextFiles({ 'profile.json': 'P1' }, have, {});
  assert.deepEqual(Object.keys(files), ['profile.json']);
  assert.deepEqual(changedPaths(have, files), ['suggested-workout.json']);
});

test('nextFiles refuses to invent a file that was not downloaded', () => {
  assert.throws(() => nextFiles({ 'profile.json': 'P2' }, { 'profile.json': { sha: 'P1', text: '{}' } }, {}), /not downloaded/);
});

test('validSnapshot accepts what makeSnapshot makes, and rejects anything else', () => {
  const s = makeSnapshot('c1', 't1', { 'profile.json': { sha: 'P1', text: '{}' } });
  assert.equal(validSnapshot(s), s);
  assert.equal(validSnapshot(null), null);
  assert.equal(validSnapshot({ ...s, v: 99 }), null);
  assert.equal(validSnapshot({ ...s, files: { x: { sha: 1 } } }), null);
});

test('withFile: the app wrote a file itself; the head is no longer known', () => {
  const s = makeSnapshot('c1', 't1', { 'profile.json': { sha: 'P1', text: '{}' }, 'suggested-workout.json': { sha: 'S1', text: '{}' } });
  const a = withFile(s, 'profile.json', '{"x":1}', 'P2');
  assert.deepEqual(a.files['profile.json'], { sha: 'P2', text: '{"x":1}' });
  assert.equal(a.head, null);
  const b = withFile(a, 'suggested-workout.json', null);
  assert.ok(!('suggested-workout.json' in b.files));
  assert.equal(s.files['profile.json'].sha, 'P1', 'the old snapshot is not changed');
});

test('withLogSave: built on the snapshot head → the new commit is the head; else the head is cleared', () => {
  const s = makeSnapshot('c1', 't1', { 'workout-log.json': { sha: 'L1', text: '[]' } });
  const res = { parent: 'c1', commit: 'c2', tree: 't2', sha: 'L2', text: '[1]' };
  const a = withLogSave(s, 'workout-log.json', res);
  assert.equal(a.head, 'c2');
  assert.equal(a.tree, 't2');
  assert.deepEqual(a.files['workout-log.json'], { sha: 'L2', text: '[1]' });
  const b = withLogSave(s, 'workout-log.json', { ...res, parent: 'c9' }); // someone else wrote in between
  assert.equal(b.head, null);
});
