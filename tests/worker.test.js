import { test } from 'node:test';
import assert from 'node:assert/strict';
import worker, { logToCSV as wCSV, logToJSON as wJSON } from '../worker/worker.js';
import { logToCSV, logToJSON } from '../lib/log.js';
import { createFakeGitHub } from './fake-github.js';

const env = { SECRET_TOKEN: 's3cret\n', GITHUB_PAT: 'pat', GITHUB_USER: 'someone', GITHUB_REPO: 'traintracks' };
const E = o => ({ id: 'x1', date: '2026-11-04', gym_id: 'eg', machine_id: 'r02', machine: 'Row', set: 1, variant: [], reps: 10, notes: '', ...o });

function setup(files = {}) {
  const log = [E()];
  const gh = createFakeGitHub({ 'workout-log.json': logToJSON(log), 'workout-log.csv': logToCSV(log), 'profile.json': '{"first_name":"Sam"}\n', ...files });
  globalThis.fetch = gh.fetch;
  const call = (path, { method = 'GET', body, auth = 'Bearer s3cret', query = '' } = {}) => worker.fetch(new Request(`https://w.example${path}${query}`, {
    method, headers: { ...(auth ? { Authorization: auth } : {}), ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}) },
    body: body === undefined ? undefined : typeof body === 'string' ? body : JSON.stringify(body)
  }), env);
  return { gh, call };
}

test('the Worker writes the log files exactly as the app does', () => {
  const log = [E({ notes: 'a, "b"\nc', variant: ['wide', 'incline'], weight_lb: -85 }), E({ id: 'x2', reps: null })];
  assert.equal(wCSV(log), logToCSV(log));
  assert.equal(wJSON(log), logToJSON(log));
});

test('auth: Bearer header, trimmed; query token still accepted; wrong or missing → 401', async () => {
  const { call } = setup();
  assert.equal((await call('/')).status, 200);
  assert.equal((await call('/', { auth: 'Bearer  s3cret ' })).status, 200);
  assert.equal((await call('/', { auth: null, query: '?token=s3cret' })).status, 200);
  assert.equal((await call('/', { auth: 'Bearer nope' })).status, 401);
  assert.equal((await call('/', { auth: null })).status, 401);
});

test('an empty SECRET_TOKEN never lets anyone in', async () => {
  const { call } = setup();
  const saved = env.SECRET_TOKEN;
  env.SECRET_TOKEN = '  ';
  try { assert.equal((await call('/', { auth: 'Bearer ' })).status, 401); } finally { env.SECRET_TOKEN = saved; }
});

test('reads: profile, log CSV; a missing file is a clear 404', async () => {
  const { call } = setup();
  assert.deepEqual(await (await call('/profile')).json(), { first_name: 'Sam' });
  const csv = await (await call('/log')).text();
  assert.ok(csv.startsWith('id,date,time,'));
  const g = await call('/garmin');
  assert.equal(g.status, 404);
  assert.match((await g.json()).error, /not in the repo yet/);
});

test('/log-json returns the log, the head to write against and whether the CSV agrees', async () => {
  const { gh, call } = setup();
  const j = await (await call('/log-json')).json();
  assert.equal(j.head, gh.head);
  assert.equal(j.entries, 1);
  assert.equal(j.csv_rows, 1);
  assert.equal(j.in_sync, true);
});

test('/log-write: one commit with both files, CSV built from the JSON', async () => {
  const { gh, call } = setup();
  const { head, log_json } = await (await call('/log-json')).json();
  const log = JSON.parse(log_json);
  log.unshift(E({ id: 'x2', date: '2026-11-06', notes: 'easy, short' }));
  const before = gh.commitCount();
  const r = await call('/log-write', { method: 'POST', body: { log_json: JSON.stringify(log), base_head: head, message: 'Add a session' } });
  assert.equal(r.status, 200, await r.clone().text());
  assert.equal(gh.commitCount(), before + 1);
  assert.equal(gh.lastMessage(), 'Add a session');
  assert.equal(gh.read('workout-log.csv'), logToCSV(log));
  assert.equal(gh.read('workout-log.json'), logToJSON(log));
});

test('/log-write: refused (409) if the repo moved since the read; nothing written', async () => {
  const { gh, call } = setup();
  const { head, log_json } = await (await call('/log-json')).json();
  gh.write({ 'other.txt': 'x' }, 'Garmin run');
  const r = await call('/log-write', { method: 'POST', body: { log_json, base_head: head } });
  assert.equal(r.status, 409);
  assert.match((await r.json()).error, /changed since you read/);
});

test('/log-write: a race during the write is also a 409', async () => {
  const { gh, call } = setup();
  const { head, log_json } = await (await call('/log-json')).json();
  gh.hooks.beforePatchRef = () => gh.write({ 'other.txt': 'x' });
  const r = await call('/log-write', { method: 'POST', body: { log_json, base_head: head } });
  assert.equal(r.status, 409);
  assert.equal(JSON.parse(gh.read('workout-log.json')).length, 1);
});

test('/log-write: refuses to shrink unless allow_shrink', async () => {
  const { call } = setup();
  const { head } = await (await call('/log-json')).json();
  const r = await call('/log-write', { method: 'POST', body: { log_json: '[]', base_head: head } });
  assert.equal(r.status, 409);
  assert.match((await r.json()).error, /shrink/);
  const ok = await call('/log-write', { method: 'POST', body: { log_json: '[]', base_head: head, allow_shrink: true } });
  assert.equal(ok.status, 200);
});

test('/log-write: bad requests are 400 and write nothing', async () => {
  const { gh, call } = setup();
  const { head } = await (await call('/log-json')).json();
  const before = gh.commitCount();
  for (const body of [{}, { log_json: 'nope', base_head: head }, { log_json: '{}', base_head: head }, { log_json: '[]' },
    { log_json: JSON.stringify([{ machineId: 'old', date: 'd' }]), base_head: head }]) {
    assert.equal((await call('/log-write', { method: 'POST', body })).status, 400, JSON.stringify(body));
  }
  assert.equal((await call('/log-write', { method: 'POST', body: '{not json' })).status, 400);
  assert.equal((await call('/log-write')).status, 405);
  assert.equal(gh.commitCount(), before);
});

test('/plan: saved from a POST body (no base64 in the URL), generated_at filled in', async () => {
  const { gh, call } = setup();
  const plan = { coach_note: 'Rows + walk', exercises: [{ machine_id: 'r02', machine: 'Row', sets: [{ set: 1, weight_lb: 60, reps: 12 }] }] };
  const r = await call('/plan', { method: 'POST', body: plan });
  assert.equal(r.status, 200);
  const saved = JSON.parse(gh.read('suggested-workout.json'));
  assert.equal(saved.coach_note, 'Rows + walk');
  assert.match(saved.generated_at, /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\dZ$/);
  // a second plan overwrites the first (needs the current sha)
  assert.equal((await call('/plan', { method: 'POST', body: { ...plan, coach_note: 'v2' } })).status, 200);
  assert.equal(JSON.parse(gh.read('suggested-workout.json')).coach_note, 'v2');
});

test('/plan: invalid plans are refused', async () => {
  const { call } = setup();
  assert.equal((await call('/plan', { method: 'POST', body: { exercises: 'x' } })).status, 400);
  assert.equal((await call('/plan', { method: 'POST', body: { exercises: [{ machine: 'no id' }] } })).status, 400);
});

test('/trigger-garmin dispatches garmin.yml with inputs', async () => {
  const { gh, call } = setup();
  const r = await call('/trigger-garmin', { method: 'POST', body: { fetch_limit: 300 } });
  assert.equal(r.status, 200);
  assert.ok(gh.calls.some(c => c.method === 'POST' && c.path.endsWith('/actions/workflows/garmin.yml/dispatches')));
});

test('GitHub errors come back with GitHub\'s message; unknown paths are 404', async () => {
  const { gh, call } = setup();
  gh.hooks.failNext = { status: 403, message: 'Resource not accessible by personal access token' };
  const r = await call('/profile');
  assert.equal(r.status, 502);
  assert.match((await r.json()).error, /Resource not accessible/);
  assert.equal((await call('/nope')).status, 404);
});
