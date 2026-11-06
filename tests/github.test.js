import test from 'node:test';
import assert from 'node:assert/strict';
import { GitHubRepo, b64encodeText, b64decodeText, apiPath } from '../lib/github.js';
import { createFakeGitHub } from './fake-github.js';

function repo(fake) { return new GitHubRepo({ owner: 'me', repo: 'tt', token: 't', fetch: fake.fetch }); }

test('base64 round-trips unicode', () => {
  const s = 'héllo — 🏋️ "quotes"';
  assert.equal(b64decodeText(b64encodeText(s)), s);
  assert.equal(apiPath('equipment/my-gyms/a b/gym.json'), 'equipment/my-gyms/a%20b/gym.json');
});

test('getText / getJSON / listDir / shaOf', async () => {
  const fake = createFakeGitHub({ 'profile.json': '{"firstName":"J"}', 'equipment/my-gyms/a/gym.json': '{}', 'equipment/my-gyms/b/gym.json': '{}' });
  const r = repo(fake);
  const p = await r.getJSON('profile.json');
  assert.equal(p.data.firstName, 'J'); assert.ok(p.sha);
  assert.equal(await r.getText('nope.json'), null);
  const dirs = await r.listDir('equipment/my-gyms');
  assert.deepEqual(dirs.map(d => d.name).sort(), ['a', 'b']);
  assert.equal(dirs[0].type, 'dir');
  assert.deepEqual(await r.listDir('missing'), []);
  assert.equal(await r.shaOf('profile.json'), p.sha);
  assert.equal(await r.shaOf('zzz'), null);
  assert.equal((await r.info()).private, false);
});

test('put creates and updates with sha; stale sha conflicts', async () => {
  const fake = createFakeGitHub();
  const r = repo(fake);
  const a = await r.put('x.txt', 'one', null, 'create');
  assert.ok(a.sha);
  assert.equal(fake.read('x.txt'), 'one');
  const b = await r.put('x.txt', 'two', a.sha, 'update');
  assert.notEqual(b.sha, a.sha);
  await assert.rejects(() => r.put('x.txt', 'three', a.sha), e => e.status === 409);
  assert.equal(fake.read('x.txt'), 'two');
});

test('putWithRetry rebases on conflict', async () => {
  const fake = createFakeGitHub({ 'log.json': '[1]' });
  const r = repo(fake);
  const stale = (await r.getText('log.json')).sha;
  fake.write('log.json', '[1,2]'); // someone else wrote
  const res = await r.putWithRetry('log.json', '[1,9]', stale, 'm', cur => JSON.stringify([...JSON.parse(cur), 9]));
  assert.ok(res.sha);
  assert.equal(fake.read('log.json'), '[1,2,9]');
  const puts = fake.log.filter(l => l.method === 'PUT');
  assert.equal(puts.length, 2);
});

test('delete needs the right sha', async () => {
  const fake = createFakeGitHub({ 'plan.json': '{}' });
  const r = repo(fake);
  const s = (await r.getText('plan.json')).sha;
  await assert.rejects(() => r.delete('plan.json', 'wrong'), e => e.status === 409);
  assert.equal(await r.delete('plan.json', s), true);
  assert.equal(await r.getText('plan.json'), null);
});

test('tree and error messages', async () => {
  const fake = createFakeGitHub({ 'a': '1', 'b/c': '2' });
  const r = repo(fake);
  const t = await r.tree();
  assert.deepEqual(Object.keys(t).sort(), ['a', 'b/c']);
  fake.state.failNext = { status: 403, message: 'Resource not accessible by personal access token' };
  await assert.rejects(() => r.getText('a'), e => e.status === 403 && /not accessible/.test(e.message));
});
