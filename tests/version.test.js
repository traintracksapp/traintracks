import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { APP_VERSION } from '../lib/config.js';

const root = new URL('..', import.meta.url);

test('APP_VERSION, VERSION and package.json agree', () => {
  const file = fs.readFileSync(new URL('VERSION', root), 'utf8').trim();
  const pkg = JSON.parse(fs.readFileSync(new URL('package.json', root), 'utf8')).version;
  assert.equal(APP_VERSION, file);
  assert.equal(pkg, file);
});
