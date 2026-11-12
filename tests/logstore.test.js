import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createFakeGitHub } from './fake-github.js';
import { GitHubRepo, gitBlobSha } from '../lib/github.js';
import { loadLog, commitLog, newLogCache, primeLogCache, NotSplitError } from '../lib/logstore.js';
import { mergeSession, removeSession, moveSession, logToJSON, logToCSV } from '../lib/log.js';
import { splitLog, monthToText, joinMonths, csvFromMonthFiles } from '../lib/months.js';

const S = { gym_id: 'eg', machine_id: 'r02', date: '2026-11-05', variant: [] };
const entry = o => ({ id: 'x1', gym_id: 'eg', machine_id: 'r02', date: '2026-11-04', set: 1, variant: [], reps: 10, ...o });
const NOV = 'log/2026-11.json', OCT = 'log/2026-10.json', SEP = 'log/2026-09.json';
const monthFiles = log => Object.fromEntries(Object.entries(splitLog(log)).map(([p, e]) => [p, monthToText(e)]));
const history = [entry(), entry({ id: 'o1', date: '2026-10-20' }), entry({ id: 'o2', date: '2026-10-02', set: 1 }), entry({ id: 's1', date: '2026-09-15' })];
function setup(log = history, extra = { 'goals.json': '{}\n' }) {
  const gh = createFakeGitHub({ ...monthFiles(log), ...extra });
  const repo = new GitHubRepo({ owner: 'someone', repo: 'traintracks', token: 't', fetch: gh.fetch });
  return { gh, repo };
}
const read = (gh, p) => { const t = gh.read(p); return t == null ? null : JSON.parse(t); };
const allLog = gh => joinMonths(Object.fromEntries([NOV, OCT, SEP, 'log/2026-12.json', 'log/2026-08.json'].filter(p => gh.read(p) != null).map(p => [p, read(gh, p)])));
const since = (gh, k) => gh.calls.slice(k).map(c => `${c.method} ${c.path.replace(/^\/repos\/[^/]+\/[^/]+/, '')}`);
/** The paths a commit's tree request wrote (from the fake's recorded requests is not possible; diff the trees instead). */
async function changedIn(repo, a, b) {
  const [x, y] = await Promise.all([repo.tree(a), repo.tree(b)]);
  return [...new Set([...Object.keys(x), ...Object.keys(y)])].filter(p => x[p] !== y[p]).sort();
}

test('loadLog: every month, newest first, as one log', async () => {
  const { repo } = setup();
  const { log, layout } = await loadLog(repo);
  assert.equal(layout, 'months');
  assert.deepEqual(log.map(e => e.id), ['x1', 'o1', 'o2', 's1']);
});

test('loadLog: a repo with no log yet is empty, and the first save creates the month', async () => {
  const { gh, repo } = setup([], {});
  assert.deepEqual((await loadLog(repo)).log, []);
  await commitLog(repo, log => mergeSession(log, S, [{ reps: 5 }]), 'Log');
  assert.equal(read(gh, NOV).length, 1);
});

test('a save is one commit holding only the month it changed', async () => {
  const { gh, repo } = setup();
  const before = gh.head, n = gh.commitCount();
  const r = await commitLog(repo, log => mergeSession(log, S, [{ reps: 20 }, { reps: 18 }]), 'Log r02 2026-11-05');
  assert.equal(gh.commitCount(), n + 1);
  assert.equal(gh.lastMessage(), 'Log r02 2026-11-05');
  assert.deepEqual(await changedIn(repo, before, gh.head), [NOV]);
  assert.deepEqual(Object.keys(r.files), [NOV]);
  assert.equal(r.files[NOV].text, gh.read(NOV));
  assert.equal(r.files[NOV].sha, await gitBlobSha(gh.read(NOV)));
  assert.equal(r.parent, before);
  assert.equal(r.commit, gh.head);
  assert.deepEqual(read(gh, NOV).map(e => e.id).slice(2), ['x1']);
  assert.equal(gh.read('workout-log.csv'), null, 'the app does not write the CSV');
  assert.equal(gh.read('workout-log.json'), null);
});

test('editing a session in an old month touches only that month', async () => {
  const { gh, repo } = setup();
  const before = gh.head;
  await commitLog(repo, log => mergeSession(log, { ...S, date: '2026-10-20' }, [{ reps: 99 }]), 'Edit');
  assert.deepEqual(await changedIn(repo, before, gh.head), [OCT]);
  assert.equal(read(gh, OCT).find(e => e.id === 'o1').reps, 99, 'the id is kept and the set replaced');
});

test('moving a session to another month (a date change) touches the two months', async () => {
  const { gh, repo } = setup();
  const before = gh.head;
  await commitLog(repo, log => mergeSession(log, { ...S, date: '2026-10-20' }, [{ reps: 11 }], { ...S, date: '2026-11-02' }), 'Move');
  assert.deepEqual(await changedIn(repo, before, gh.head), [OCT, NOV]);
  assert.ok(read(gh, NOV).some(e => e.id === 'o1' && e.date === '2026-11-02'));
  assert.ok(!read(gh, OCT).some(e => e.id === 'o1'));
});

test('moving a session to a month with no file yet creates it', async () => {
  const { gh, repo } = setup();
  await commitLog(repo, log => mergeSession(log, { ...S, date: '2026-11-04' }, [{ reps: 1 }], { ...S, date: '2026-12-01' }), 'Move');
  assert.deepEqual(read(gh, 'log/2026-12.json').map(e => e.id), ['x1']);
  assert.equal(gh.read(NOV), null, 'November had only that session: its file is removed');
});

test('deleting the last session of a month removes the month file', async () => {
  const { gh, repo } = setup();
  const before = gh.head;
  await commitLog(repo, log => removeSession(log, { ...S, date: '2026-09-15' }), 'Delete');
  assert.equal(gh.read(SEP), null);
  assert.deepEqual(await changedIn(repo, before, gh.head), [SEP]);
  assert.equal(allLog(gh).length, 3);
});

test('moving a session to another machine stays in its month', async () => {
  const { gh, repo } = setup();
  const before = gh.head;
  await commitLog(repo, log => moveSession(log, { ...S, date: '2026-10-02' }, { gym_id: 'generic', gym: 'Common', room_id: 'c', room: 'C', machine_id: 'walk', machine: 'Walk' }), 'Move');
  assert.deepEqual(await changedIn(repo, before, gh.head), [OCT]);
  assert.equal(read(gh, OCT).find(e => e.id === 'o2').machine_id, 'walk');
});

test('a change that changes nothing makes no commit', async () => {
  const { gh, repo } = setup();
  const n = gh.commitCount();
  const r = await commitLog(repo, log => removeSession(log, { ...S, date: '2020-01-01' }), 'Delete nothing');
  assert.equal(gh.commitCount(), n);
  assert.deepEqual(r.files, {});
});

test('a save uploads about one month, however long the history', async () => {
  const long = [];
  for (let m = 1; m <= 12; m++) for (let d = 1; d <= 28; d++) long.push(entry({ id: `e${m}-${d}`, date: `2026-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`, notes: 'x'.repeat(100) }));
  const gh = createFakeGitHub(monthFiles(long));
  const sizes = [];
  const fetch = (u, init) => { if (init.method === 'POST' && u.endsWith('/git/trees')) sizes.push(init.body.length); return gh.fetch(u, init); };
  const repo = new GitHubRepo({ owner: 'o', repo: 'r', token: 't', fetch });
  await commitLog(repo, log => mergeSession(log, { ...S, date: '2026-12-01' }, [{ reps: 3 }]), 'Log');
  const whole = logToJSON(long).length;
  assert.ok(sizes[0] < whole / 8, `${sizes[0]} bytes uploaded vs ${whole} for the whole log`);
});

test('another writer in between → reload, re-apply, nothing lost', async () => {
  const { gh, repo } = setup();
  gh.hooks.beforePatchRef = () => {
    const nov = read(gh, NOV);
    nov.unshift(entry({ id: 'from-action', date: '2026-11-06', machine_id: 'walk' }));
    gh.write({ [NOV]: monthToText(nov) }, 'garmin post');
  };
  let calls = 0;
  await commitLog(repo, log => { calls++; return mergeSession(log, S, [{ reps: 20 }]); }, 'Log');
  assert.equal(calls, 2);
  const ids = read(gh, NOV).map(e => e.id);
  assert.deepEqual(ids.sort(), ['from-action', ids.find(i => i.startsWith('e')), 'x1'].sort());
});

test('gives up after the allowed attempts and leaves the branch untouched', async () => {
  const { gh, repo } = setup();
  const keepMoving = () => { gh.write({ 'other.txt': String(Math.random()) }); gh.hooks.beforePatchRef = keepMoving; };
  gh.hooks.beforePatchRef = keepMoving;
  await assert.rejects(commitLog(repo, log => mergeSession(log, S, [{ reps: 1 }]), 'Log', { attempts: 2 }), e => e.status === 422);
  gh.hooks.beforePatchRef = null;
  assert.equal(read(gh, NOV).length, 1);
});

test('apply returning null cancels; apply works on a copy, so a retry starts from fresh data', async () => {
  const { gh, repo } = setup();
  const n = gh.commitCount();
  assert.equal(await commitLog(repo, () => null, 'nothing'), null);
  assert.equal(gh.commitCount(), n);
  gh.hooks.beforePatchRef = () => gh.write({ 'other.txt': 'x' });
  const seen = [];
  await commitLog(repo, log => { seen.push(log.length); log.push(entry({ id: `n${seen.length}`, date: '2026-11-01' })); return log; }, 'Add');
  assert.deepEqual(seen, [4, 4]);
  assert.equal(read(gh, NOV).length, 2);
});

// ---- the cache ----

test('warm cache: 4 calls, nothing downloaded; and again after the save', async () => {
  const { gh, repo } = setup();
  const cache = newLogCache();
  await loadLog(repo, null, cache);
  let k = gh.calls.length;
  await commitLog(repo, log => mergeSession(log, S, [{ reps: 20 }]), 'Log 1', { cache });
  assert.deepEqual(since(gh, k), ['GET /git/ref/heads/main', 'POST /git/trees', 'POST /git/commits', 'PATCH /git/refs/heads/main']);
  assert.equal(cache.head, gh.head);
  k = gh.calls.length;
  await commitLog(repo, log => mergeSession(log, { ...S, date: '2026-10-21' }, [{ reps: 15 }]), 'Log 2', { cache });
  assert.equal(since(gh, k).length, 4);
  assert.deepEqual(joinMonths(Object.fromEntries(Object.entries(cache.months).map(([p, m]) => [p, m.entries]))), allLog(gh));
});

test('the branch moved: only the months whose sha changed are downloaded', async () => {
  const { gh, repo } = setup();
  const cache = newLogCache();
  await loadLog(repo, null, cache);
  const oct = read(gh, OCT);
  oct.unshift(entry({ id: 'coach', date: '2026-10-30' }));
  gh.write({ [OCT]: monthToText(oct), 'profile.json': '{}\n' }, 'elsewhere');
  const k = gh.calls.length;
  const seen = [];
  await commitLog(repo, l => { seen.push(l.map(e => e.id)); return mergeSession(l, S, [{ reps: 20 }]); }, 'Log', { cache });
  const calls = since(gh, k);
  assert.equal(calls.filter(c => c.startsWith('GET /git/blobs/')).length, 1, calls.join());
  assert.deepEqual(seen, [['x1', 'coach', 'o1', 'o2', 's1']]);
  assert.ok(read(gh, OCT).some(e => e.id === 'coach'));
  assert.equal(cache.head, gh.head);
});

test('primeLogCache from downloaded files; the next save needs no download', async () => {
  const { gh, repo } = setup();
  const t = await repo.treeAt();
  const files = {};
  for (const p of [NOV, OCT, SEP]) files[p] = { sha: t.files[p], text: gh.read(p) };
  const cache = newLogCache();
  const log = primeLogCache(cache, { head: gh.head, tree: t.sha, files: { ...files, 'profile.json': { sha: 'x', text: '{}' } } });
  assert.equal(log.length, 4);
  assert.deepEqual(Object.keys(cache.months).sort(), [OCT, NOV, SEP].sort());
  const k = gh.calls.length;
  await commitLog(repo, l => mergeSession(l, S, [{ reps: 1 }]), 'Log', { cache });
  assert.equal(since(gh, k).length, 4);
});

test('the cache is a private copy: changing a returned log does not leak into the next save', async () => {
  const { gh, repo } = setup();
  const cache = newLogCache();
  const { log } = await loadLog(repo, null, cache);
  log[0].reps = 999;
  const r = await commitLog(repo, l => mergeSession(l, S, [{ reps: 20 }]), 'Log', { cache });
  r.log.forEach(e => { e.reps = 777; });
  await commitLog(repo, l => l.concat(entry({ id: 'z', date: '2026-11-07' })), 'Add', { cache });
  assert.ok(!allLog(gh).some(e => e.reps === 999 || e.reps === 777));
});

// ---- not split yet ----

test('a repo still in one file: readable, but saving is refused and nothing is written', async () => {
  const gh = createFakeGitHub({ 'workout-log.json': logToJSON(history), 'workout-log.csv': logToCSV(history) });
  const repo = new GitHubRepo({ owner: 'o', repo: 'r', token: 't', fetch: gh.fetch });
  const { log, layout } = await loadLog(repo);
  assert.equal(layout, 'single');
  assert.equal(log.length, 4);
  const n = gh.commitCount();
  await assert.rejects(commitLog(repo, l => mergeSession(l, S, [{ reps: 1 }]), 'Log'), e => e instanceof NotSplitError && /split into months/.test(e.message));
  assert.equal(gh.commitCount(), n);
});

test('months next to a left-over workout-log.json: the months are the log', async () => {
  const { gh, repo } = setup(history, { 'workout-log.json': logToJSON([entry({ id: 'stale' })]) });
  const { log, layout } = await loadLog(repo);
  assert.equal(layout, 'months');
  assert.ok(!log.some(e => e.id === 'stale'));
  await commitLog(repo, l => mergeSession(l, S, [{ reps: 1 }]), 'Log');
  assert.equal(read(gh, 'workout-log.json')[0].id, 'stale', 'the old file is left alone');
});

test('the CSV built from the months is the CSV of the whole log', async () => {
  const { gh, repo } = setup();
  await commitLog(repo, l => mergeSession(l, S, [{ reps: 1 }, { reps: 2 }]), 'Log');
  const files = Object.fromEntries([NOV, OCT, SEP].map(p => [p, gh.read(p)]));
  assert.equal(csvFromMonthFiles(files), logToCSV(allLog(gh)));
});
