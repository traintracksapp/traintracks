import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cleanTag, normalizeVariant, sameVariant, hasAllTags, hasAnyTag } from '../lib/variant.js';

test('cleanTag: trims, lowercases, collapses spaces', () => assert.equal(cleanTag('  Wide   Grip '), 'wide grip'));

test('normalizeVariant: sorts, de-duplicates, drops blanks', () => {
  assert.deepEqual(normalizeVariant(['wide', 'Incline', 'wide', ' ']), ['incline', 'wide']);
});
test('normalizeVariant: accepts the CSV form "a; b"', () => {
  assert.deepEqual(normalizeVariant('wide; incline'), ['incline', 'wide']);
});
test('normalizeVariant: missing → []', () => {
  assert.deepEqual(normalizeVariant(undefined), []);
  assert.deepEqual(normalizeVariant(null), []);
  assert.deepEqual(normalizeVariant(''), []);
});
test('normalizeVariant: machine defaults are not stored', () => {
  assert.deepEqual(normalizeVariant(['standard', 'flat'], ['standard', 'flat']), []);
  assert.deepEqual(normalizeVariant(['wide', 'flat'], ['standard', 'flat']), ['wide']);
});

test('sameVariant ignores order, case and absence vs empty', () => {
  assert.ok(sameVariant(['wide', 'incline'], ['Incline', 'wide']));
  assert.ok(sameVariant(undefined, []));
  assert.ok(!sameVariant(['wide'], []));
});

test('hasAllTags / hasAnyTag for goal filters', () => {
  assert.ok(hasAllTags(['decline', 'wide'], ['decline']));
  assert.ok(!hasAllTags(['wide'], ['decline']));
  assert.ok(hasAllTags([], []));
  assert.ok(hasAnyTag(['decline', 'wide'], ['incline', 'wide']));
  assert.ok(!hasAnyTag(['decline'], ['incline']));
});
