import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createFakeGitHub } from './fake-github.js';
import { GitHubRepo, isConflict, b64encodeText, b64decodeText, gitBlobSha } from '../lib/github.js';
import { loadLog, commitLog, newLogCache } from '../lib/logstore.js';
import { mergeSession } from '../lib/log.js';
import { splitLog, monthToText } from '../lib/months.js';

const S = { gym_id: 'eg', machine_id: 'r02', date: '2026-11-05', variant: [] };
const entry = o => ({ id: 'x1', gym_id: 'eg', machine_id: 'r02', date: '2026-11-04', set: 1, variant: [], reps: 10, ...o });
const monthFiles = log => Object.fromEntries(Object.entries(splitLog(log)).map(([p, e]) => [p, monthToText(e)]));
function setup(log = [entry()]) {
  const gh = createFakeGitHub({ ...monthFiles(log), 'goals.json': '{}\n' });
  const repo = new GitHubRepo({ owner: 'someone', repo: 'traintracks', token: 't', fetch: gh.fetch });
  return { gh, repo };
}
const NOV = 'log/2026-11.json';
const readMonth = (gh, p = NOV) => JSON.parse(gh.read(p));
const since = (gh, k) => gh.calls.slice(k).map(c => `${c.method} ${c.path.replace(/^\/repos\/[^/]+\/[^/]+/, '')}`);

test('base64 helpers round-trip non-ASCII text', () => {
  const s = 'Bodyweight — No Equipment ✓';
  assert.equal(b64decodeText(b64encodeText(s)), s);
});

test('getText / getJSON: content and sha; missing file → null', async () => {
  const { repo } = setup();
  const f = await repo.getJSON('goals.json');
  assert.deepEqual(f.data, {});
  assert.ok(f.sha);
  assert.equal(await repo.getText('nope.json'), null);
});

test('putFile: stale sha → 409 conflict; current sha → new sha', async () => {
  const { gh, repo } = setup();
  const f = await repo.getText('goals.json');
  gh.write({ 'goals.json': '{"x":1}\n' });
  await assert.rejects(repo.putFile('goals.json', '{}\n', f.sha), e => isConflict(e) && e.status === 409);
  const cur = await repo.getText('goals.json');
  const s = await repo.putFile('goals.json', '{"y":2}\n', cur.sha);
  assert.ok(s && s !== cur.sha);
  assert.equal(gh.read('goals.json'), '{"y":2}\n');
});

test('errors carry the status and GitHub message', async () => {
  const { gh, repo } = setup();
  gh.hooks.failNext = { status: 403, message: 'Resource not accessible by personal access token' };
  await assert.rejects(repo.getText('goals.json'), e => e.status === 403 && /Resource not accessible/.test(e.message));
});

test('commitFiles: contents go inline in the tree, no blob uploads', async () => {
  const { gh, repo } = setup();
  const k = gh.calls.length;
  const head = await repo.headSha();
  const r = await repo.commitFiles({ 'a.txt': 'Bodyweight — ✓\n', 'b.txt': 'b\n' }, 'two files', head);
  assert.equal(gh.head, r.commit);
  assert.equal(gh.read('a.txt'), 'Bodyweight — ✓\n');
  assert.equal(gh.read('b.txt'), 'b\n');
  assert.ok(!since(gh, k).some(c => c.includes('/git/blobs')));
});

test('tree: blob shas by path', async () => {
  const { repo } = setup();
  const t = await repo.tree();
  assert.deepEqual(Object.keys(t).sort(), [NOV, 'goals.json'].sort());
});

test('rawUrl is only a URL builder', () => {
  const repo = new GitHubRepo({ owner: 'someone', repo: 'traintracks' });
  assert.equal(repo.rawUrl('equipment/generic/images/push ups.jpg'),
    'https://raw.githubusercontent.com/someone/traintracks/main/equipment/generic/images/push%20ups.jpg');
});

// ---- 0.2.4: no stale answers from the browser cache; trees and raw blobs ----

/**
 * A fetch that behaves like a browser's HTTP cache in front of GitHub, whose
 * API answers say `Cache-Control: private, max-age=60`: a GET to a URL seen in
 * the last minute gets the old answer, unless the request opts out.
 */
function browserCache(fetch) {
  const seen = new Map();
  const wrapped = async (url, init = {}) => {
    const method = init.method || 'GET';
    const accept = (init.headers || {}).Accept || '';
    const key = `${url} ${accept}`;
    const fresh = init.cache === 'no-cache' || init.cache === 'no-store' || init.cache === 'reload';
    if (method === 'GET' && !fresh && seen.has(key)) { wrapped.stale++; return seen.get(key)(); }
    const r = await fetch(url, init);
    if (method === 'GET' && r.ok) { const body = await r.text(); const st = r.status; seen.set(key, () => ({ ok: true, status: st, json: async () => JSON.parse(body), text: async () => body })); return seen.get(key)(); }
    return r;
  };
  wrapped.stale = 0;
  return wrapped;
}

test('every request opts out of the browser cache (cache: no-cache)', async () => {
  const { gh } = setup();
  const seen = [];
  const repo = new GitHubRepo({ owner: 'someone', repo: 'traintracks', token: 't', fetch: (u, init) => { seen.push(init.cache); return gh.fetch(u, init); } });
  await repo.headSha();
  await repo.getText('goals.json');
  await commitLog(repo, log => mergeSession(log, S, [{ reps: 1 }]), 'Log');
  assert.ok(seen.length >= 5);
  assert.ok(seen.every(c => c === 'no-cache'), seen.join());
});

test('two saves within a minute both succeed behind a browser cache (was: GitHub 422)', async () => {
  const { gh } = setup();
  const fetch = browserCache(gh.fetch);
  const repo = new GitHubRepo({ owner: 'someone', repo: 'traintracks', token: 't', fetch });
  const cache = newLogCache();
  await loadLog(repo, null, cache);
  await commitLog(repo, log => mergeSession(log, S, [{ reps: 20 }]), 'Log 1', { cache });
  await commitLog(repo, log => mergeSession(log, { ...S, date: '2026-11-06' }, [{ reps: 15 }]), 'Log 2', { cache });
  // and a third from a cold cache, the case that used to fail three times in a row
  await commitLog(repo, log => mergeSession(log, { ...S, date: '2026-11-07' }, [{ reps: 12 }]), 'Log 3');
  assert.equal(fetch.stale, 0);
  assert.equal(readMonth(gh).length, 4);
});

test('the browser-cache stand-in does serve stale heads to a request that does not opt out', async () => {
  const { gh } = setup();
  const fetch = browserCache(gh.fetch);
  const url = 'https://api.github.com/repos/someone/traintracks/git/ref/heads/main';
  const a = await (await fetch(url, {})).json();
  gh.write({ 'other.txt': 'x' });
  const b = await (await fetch(url, {})).json();
  const c = await (await fetch(url, { cache: 'no-cache' })).json();
  assert.equal(a.object.sha, b.object.sha);
  assert.notEqual(c.object.sha, a.object.sha);
});

test('a conflict retry re-reads the head fresh and succeeds', async () => {
  const { gh } = setup();
  const repo = new GitHubRepo({ owner: 'someone', repo: 'traintracks', token: 't', fetch: browserCache(gh.fetch) });
  const cache = newLogCache();
  await loadLog(repo, null, cache);
  gh.hooks.beforePatchRef = () => gh.write({ 'other.txt': 'moved' });
  await commitLog(repo, log => mergeSession(log, S, [{ reps: 20 }]), 'Log', { cache });
  assert.equal(readMonth(gh).length, 2);
  assert.equal(gh.read('other.txt'), 'moved');
});

test('gitBlobSha is git\'s blob sha', async () => {
  assert.equal(await gitBlobSha('hello\n'), 'ce013625030ba8dba906f756967f9e9ca394464a'); // git hash-object
  assert.equal(await gitBlobSha(''), 'e69de29bb2d1d6434b8b29ae775ad8c2e48c5391');
  const { repo } = setup();
  const t = await repo.tree();
  assert.equal(t['goals.json'], await gitBlobSha('{}\n'));
});

test('treeAt: every file and the tree sha at a commit, not just the branch head', async () => {
  const { gh, repo } = setup();
  const old = gh.head;
  gh.write({ 'new.txt': 'n' });
  const at = await repo.treeAt(old);
  assert.ok(!('new.txt' in at.files) && NOV in at.files && at.sha);
  assert.ok('new.txt' in (await repo.treeAt()).files);
});

test('blobText: raw text by blob sha, non-ASCII intact, no size limit', async () => {
  const big = 'Bodyweight — ✓ '.repeat(80000) + '\n'; // > 1 MB
  const gh = createFakeGitHub({ 'big.txt': big });
  const repo = new GitHubRepo({ owner: 'o', repo: 'r', fetch: gh.fetch });
  const t = await repo.tree();
  assert.equal(await repo.blobText(t['big.txt']), big);
  const k = gh.calls.length;
  assert.equal((await repo.getText('big.txt')).text, big); // the Contents API needs a second call past 1 MB
  assert.equal(gh.calls.length - k, 2);
});
