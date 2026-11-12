import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createFakeGitHub } from './fake-github.js';
import { GitHubRepo, isConflict, b64encodeText, b64decodeText, gitBlobSha } from '../lib/github.js';
import { loadLog, commitLog, newLogCache, LOG_JSON, LOG_CSV } from '../lib/logstore.js';
import { mergeSession, logToJSON, logToCSV } from '../lib/log.js';
import { parseCSV } from '../lib/csv.js';

const S = { gym_id: 'eg', machine_id: 'r02', date: '2026-11-05', variant: [] };
const entry = o => ({ id: 'x1', gym_id: 'eg', machine_id: 'r02', date: '2026-11-04', set: 1, variant: [], reps: 10, ...o });
function setup(log = [entry()]) {
  const gh = createFakeGitHub({ [LOG_JSON]: logToJSON(log), [LOG_CSV]: logToCSV(log), 'goals.json': '{}\n' });
  const repo = new GitHubRepo({ owner: 'someone', repo: 'traintracks', token: 't', fetch: gh.fetch });
  return { gh, repo };
}

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

test('loadLog: reads the log at the head; a missing log is empty', async () => {
  const { repo } = setup();
  const { log, head } = await loadLog(repo);
  assert.equal(log.length, 1);
  assert.ok(head);
  const empty = createFakeGitHub({});
  assert.deepEqual((await loadLog(new GitHubRepo({ owner: 'o', repo: 'r', fetch: empty.fetch }))).log, []);
});

test('commitLog: JSON and CSV are written in ONE commit, and agree', async () => {
  const { gh, repo } = setup();
  const before = gh.commitCount();
  const r = await commitLog(repo, log => mergeSession(log, S, [{ reps: 20 }, { reps: 18 }]), 'Log r02 2026-11-05');
  assert.equal(gh.commitCount(), before + 1);
  assert.equal(gh.lastMessage(), 'Log r02 2026-11-05');
  const json = JSON.parse(gh.read(LOG_JSON));
  const csv = parseCSV(gh.read(LOG_CSV));
  assert.equal(json.length, 3);
  assert.deepEqual(csv.map(x => x.id), json.map(x => x.id));
  assert.equal(r.log.length, 3);
});

test('commitLog: another writer in between → reload, re-apply, nothing lost', async () => {
  const { gh, repo } = setup();
  // An Action posts a row after we read but before our ref update.
  gh.hooks.beforePatchRef = () => {
    const log = JSON.parse(gh.read(LOG_JSON));
    log.unshift(entry({ id: 'from-action', date: '2026-11-06', machine_id: 'walk' }));
    gh.write({ [LOG_JSON]: logToJSON(log), [LOG_CSV]: logToCSV(log) }, 'garmin post');
  };
  let calls = 0;
  await commitLog(repo, log => { calls++; return mergeSession(log, S, [{ reps: 20 }]); }, 'Log');
  assert.equal(calls, 2);
  const ids = JSON.parse(gh.read(LOG_JSON)).map(e => e.id);
  assert.ok(ids.includes('from-action'), 'the other writer\'s row survives');
  assert.ok(ids.includes('x1'));
  assert.equal(ids.length, 3);
  assert.deepEqual(parseCSV(gh.read(LOG_CSV)).map(x => x.id), ids);
});

test('commitLog: gives up after the allowed attempts and leaves the branch untouched', async () => {
  const { gh, repo } = setup();
  const keepMoving = () => { gh.write({ 'other.txt': String(Math.random()) }); gh.hooks.beforePatchRef = keepMoving; };
  gh.hooks.beforePatchRef = keepMoving;
  await assert.rejects(commitLog(repo, log => mergeSession(log, S, [{ reps: 1 }]), 'Log', { attempts: 2 }), isConflict);
  gh.hooks.beforePatchRef = null;
  assert.equal(JSON.parse(gh.read(LOG_JSON)).length, 1);
});

test('commitLog: apply returning null cancels without a commit', async () => {
  const { gh, repo } = setup();
  const before = gh.commitCount();
  assert.equal(await commitLog(repo, () => null, 'nothing'), null);
  assert.equal(gh.commitCount(), before);
});

test('commitLog: apply works on a copy, so a retry starts from fresh data', async () => {
  const { gh, repo } = setup();
  gh.hooks.beforePatchRef = () => gh.write({ 'other.txt': 'x' });
  const seen = [];
  await commitLog(repo, log => { seen.push(log.length); log.push(entry({ id: `n${seen.length}` })); return log; }, 'Add');
  assert.deepEqual(seen, [1, 1]);
  assert.equal(JSON.parse(gh.read(LOG_JSON)).length, 2);
});

test('commitLog: other files are not touched', async () => {
  const { gh, repo } = setup();
  await commitLog(repo, log => mergeSession(log, S, [{ reps: 5 }]), 'Log');
  assert.equal(gh.read('goals.json'), '{}\n');
});

// ---- the log cache: fewer calls per save ----

const since = (gh, k) => gh.calls.slice(k).map(c => `${c.method} ${c.path.replace(/^\/repos\/[^/]+\/[^/]+/, '')}`);
const isLogDownload = c => c.includes(`/contents/${LOG_JSON}`) || c.startsWith('GET /git/blobs/');

test('commitLog with a warm cache: 4 calls, and the log is not downloaded', async () => {
  const { gh, repo } = setup();
  const cache = newLogCache();
  await loadLog(repo, null, cache);
  const k = gh.calls.length;
  await commitLog(repo, log => mergeSession(log, S, [{ reps: 20 }]), 'Log', { cache });
  const calls = since(gh, k);
  assert.deepEqual(calls, ['GET /git/ref/heads/main', 'POST /git/trees', 'POST /git/commits', 'PATCH /git/refs/heads/main']);
  assert.ok(!calls.some(isLogDownload));
});

test('commitLog: the cache is updated after a save, so the next save is 4 calls too', async () => {
  const { gh, repo } = setup();
  const cache = newLogCache();
  await loadLog(repo, null, cache);
  await commitLog(repo, log => mergeSession(log, S, [{ reps: 20 }]), 'Log 1', { cache });
  assert.equal(cache.head, gh.head);
  const k = gh.calls.length;
  await commitLog(repo, log => mergeSession(log, { ...S, date: '2026-11-06' }, [{ reps: 15 }]), 'Log 2', { cache });
  assert.equal(since(gh, k).length, 4);
  assert.equal(cache.head, gh.head);
  const json = JSON.parse(gh.read(LOG_JSON));
  assert.equal(json.length, 3);
  assert.deepEqual(cache.log, json);
  assert.deepEqual(parseCSV(gh.read(LOG_CSV)).map(x => x.id), json.map(x => x.id));
});

test('commitLog with a cold cache fills it on the first save', async () => {
  const { gh, repo } = setup();
  const cache = newLogCache();
  await commitLog(repo, log => mergeSession(log, S, [{ reps: 20 }]), 'Log', { cache });
  assert.equal(cache.head, gh.head);
  const k = gh.calls.length;
  await commitLog(repo, log => mergeSession(log, S, [{ reps: 21 }]), 'Log again', { cache });
  assert.equal(since(gh, k).length, 4);
});

test('commitLog: another writer moved the branch since the cache → reload, their row survives', async () => {
  const { gh, repo } = setup();
  const cache = newLogCache();
  await loadLog(repo, null, cache);
  const log = JSON.parse(gh.read(LOG_JSON));
  log.unshift(entry({ id: 'from-action', date: '2026-11-06', machine_id: 'walk' }));
  gh.write({ [LOG_JSON]: logToJSON(log), [LOG_CSV]: logToCSV(log) }, 'garmin post');
  const k = gh.calls.length;
  const seen = [];
  await commitLog(repo, l => { seen.push(l.map(e => e.id)); return mergeSession(l, S, [{ reps: 20 }]); }, 'Log', { cache });
  assert.ok(since(gh, k).some(isLogDownload), 'the log is downloaded again');
  assert.deepEqual(seen, [['from-action', 'x1']]);
  const ids = JSON.parse(gh.read(LOG_JSON)).map(e => e.id);
  assert.ok(ids.includes('from-action'));
  assert.equal(ids.length, 3);
  assert.deepEqual(parseCSV(gh.read(LOG_CSV)).map(x => x.id), ids);
  assert.equal(cache.head, gh.head);
});

test('commitLog with a cache: a write between our read and the ref update → retry from fresh data', async () => {
  const { gh, repo } = setup();
  const cache = newLogCache();
  await loadLog(repo, null, cache);
  gh.hooks.beforePatchRef = () => {
    const log = JSON.parse(gh.read(LOG_JSON));
    log.push(entry({ id: 'from-coach', date: '2026-11-03' }));
    gh.write({ [LOG_JSON]: logToJSON(log), [LOG_CSV]: logToCSV(log) }, 'coach');
  };
  let n = 0;
  await commitLog(repo, l => { n++; return mergeSession(l, S, [{ reps: 20 }]); }, 'Log', { cache });
  assert.equal(n, 2);
  const ids = JSON.parse(gh.read(LOG_JSON)).map(e => e.id);
  assert.ok(ids.includes('from-coach') && ids.includes('x1'));
  assert.equal(ids.length, 3);
  assert.deepEqual(cache.log.map(e => e.id), ids);
});

test('the cache keeps the file\'s stored order (not the app\'s date order)', async () => {
  const stored = [entry({ id: 'old', date: '2026-01-01' }), entry({ id: 'new', date: '2026-11-01' }), entry({ id: 'mid', date: '2026-06-01' })];
  const { gh, repo } = setup(stored);
  const cache = newLogCache();
  await loadLog(repo, null, cache);
  assert.deepEqual(cache.log.map(e => e.id), ['old', 'new', 'mid']);
  await commitLog(repo, log => [...log, entry({ id: 'added', date: '2026-11-05' })], 'Add', { cache });
  assert.deepEqual(JSON.parse(gh.read(LOG_JSON)).map(e => e.id), ['old', 'new', 'mid', 'added']);
  assert.deepEqual(cache.log.map(e => e.id), ['old', 'new', 'mid', 'added']);
});

test('the cache is a private copy: changing the returned log does not change the next save', async () => {
  const { gh, repo } = setup();
  const cache = newLogCache();
  const { log } = await loadLog(repo, null, cache);
  log[0].reps = 999;
  const r = await commitLog(repo, l => mergeSession(l, S, [{ reps: 20 }]), 'Log', { cache });
  r.log.forEach(e => { e.reps = 777; });
  await commitLog(repo, l => l.concat(entry({ id: 'z', date: '2026-11-07' })), 'Add', { cache });
  const json = JSON.parse(gh.read(LOG_JSON));
  assert.ok(!json.some(e => e.reps === 999 || e.reps === 777));
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
  assert.deepEqual(Object.keys(t).sort(), [LOG_CSV, LOG_JSON, 'goals.json'].sort());
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
  assert.equal(JSON.parse(gh.read(LOG_JSON)).length, 4);
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
  assert.equal(JSON.parse(gh.read(LOG_JSON)).length, 2);
  assert.equal(gh.read('other.txt'), 'moved');
});

test('commitLog: the branch moved but the log file did not → no download, its tree is enough', async () => {
  const { gh, repo } = setup();
  const cache = newLogCache();
  await loadLog(repo, null, cache);
  gh.write({ 'profile.json': '{}\n' }, 'profile from another device');
  const k = gh.calls.length;
  await commitLog(repo, log => mergeSession(log, S, [{ reps: 20 }]), 'Log', { cache });
  const calls = since(gh, k);
  assert.ok(!calls.some(isLogDownload), calls.join());
  assert.equal(calls.length, 5);
  assert.equal(gh.read('profile.json'), '{}\n');
  assert.equal(JSON.parse(gh.read(LOG_JSON)).length, 2);
});

test('commitLog returns the commit it built on, and the written file with its git blob sha', async () => {
  const { gh, repo } = setup();
  const before = gh.head;
  const r = await commitLog(repo, log => mergeSession(log, S, [{ reps: 20 }]), 'Log');
  assert.equal(r.parent, before);
  assert.equal(r.commit, gh.head);
  assert.equal(r.text, gh.read(LOG_JSON));
  assert.equal(r.sha, (await repo.tree())[LOG_JSON]);
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
  assert.ok(!('new.txt' in at.files) && LOG_JSON in at.files && at.sha);
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
