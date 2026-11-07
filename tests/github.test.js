import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createFakeGitHub } from './fake-github.js';
import { GitHubRepo, isConflict, b64encodeText, b64decodeText } from '../lib/github.js';
import { loadLog, commitLog, LOG_JSON, LOG_CSV } from '../lib/logstore.js';
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
