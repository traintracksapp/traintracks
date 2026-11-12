import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createFakeGitHub } from './fake-github.js';
import { GitHubRepo } from '../lib/github.js';
import { commitLog, newLogCache } from '../lib/logstore.js';
import { sessionEntries } from '../lib/log.js';
import { monthToText } from '../lib/months.js';

const NOV = 'log/2026-11.json'; // every entry in these tests is in November 2026
import { mergeOp, removeOp, moveOp, applyOp, applyOps, batchMessage, createOutbox, createSyncer, retryDelay } from '../lib/outbox.js';

const entry = o => ({ id: 'x1', gym_id: 'eg', machine_id: 'r02', date: '2026-11-04', set: 1, variant: [], reps: 10, ...o });
const S1 = { gym_id: 'eg', machine_id: 'r02', date: '2026-11-05', variant: [] };
const S2 = { gym_id: 'eg', machine_id: 'p01', date: '2026-11-05', variant: [] };

/** A Storage-like object (localStorage stand-in). */
function memStorage() {
  const m = new Map();
  return { getItem: k => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)), removeItem: k => m.delete(k), m };
}

/** Timers you run by hand. */
function manualTimers() {
  const due = [];
  return { due, schedule: (fn, ms) => { const t = { fn, ms }; due.push(t); return t; }, cancel: t => { const i = due.indexOf(t); if (i >= 0) due.splice(i, 1); },
    runAll: () => { const all = due.splice(0); all.forEach(t => t.fn()); } };
}

function setup(log = [entry()]) {
  const gh = createFakeGitHub({ [NOV]: monthToText(log) });
  const repo = new GitHubRepo({ owner: 'someone', repo: 'traintracks', token: 't', fetch: gh.fetch });
  const cache = newLogCache();
  const storage = memStorage();
  const outbox = createOutbox(storage, 'tt-outbox:someone/traintracks');
  const timers = manualTimers();
  const sent = [], statuses = [];
  const syncer = createSyncer({
    outbox,
    commit: ops => commitLog(repo, log => applyOps(log, ops), batchMessage(ops), { cache }),
    onSent: (res, remaining) => sent.push({ res, remaining }),
    onChange: st => statuses.push(st),
    schedule: timers.schedule, cancel: timers.cancel
  });
  return { gh, repo, outbox, storage, syncer, timers, sent, statuses };
}
const readLog = gh => JSON.parse(gh.read(NOV));

// ---- operations ----

test('mergeOp keeps the ids of the entries it replaces and gives new sets an id now', () => {
  const log = [entry({ id: 'a', date: S1.date, set: 1 }), entry({ id: 'b', date: S1.date, set: 2 })];
  const op = mergeOp(log, S1, [{ reps: 1 }, { reps: 2 }, { reps: 3 }], S1, 'Edit');
  assert.deepEqual(op.sets.map(s => s.id).slice(0, 2), ['a', 'b']);
  assert.ok(op.sets[2].id && op.sets[2].id !== 'a');
  const out = applyOp(log, op);
  assert.deepEqual(sessionEntries(out, S1).map(e => e.id), op.sets.map(s => s.id));
});

test('operations survive a JSON round trip (they are stored on the device)', () => {
  const log = [entry()];
  const ops = [mergeOp(log, S1, [{ reps: 5 }], S1, 'Log'), removeOp({ ...S1, date: '2026-11-04' }, 'Delete'),
    moveOp(S1, { gym_id: 'g2', gym: 'G2', room_id: 'r', room: 'R', machine_id: 'm2', machine: 'M2' }, 'Move')];
  const back = JSON.parse(JSON.stringify(ops));
  assert.deepEqual(applyOps(log, back), applyOps(log, ops));
});

test('applying an operation twice gives the same log (a resend is harmless)', () => {
  const log = [entry(), entry({ id: 'y', machine_id: 'p01', date: S2.date })];
  const ops = [mergeOp(log, S1, [{ reps: 5 }, { reps: 6 }]), removeOp(S2),
    moveOp({ ...S1, date: '2026-11-04' }, { gym_id: 'eg', machine_id: 'm9', machine: 'M9' })];
  for (const op of ops) { const once = applyOp(log, op); assert.deepEqual(applyOp(once, op), once, op.kind); }
});

test('batchMessage: one message, or a count and the list (kept short)', () => {
  const a = { message: 'Log Row 2026-11-05' }, b = { message: 'Log Press 2026-11-05' };
  assert.equal(batchMessage([a]), 'Log Row 2026-11-05');
  assert.equal(batchMessage([a, b]), '2 changes: Log Row 2026-11-05; Log Press 2026-11-05');
  assert.ok(batchMessage(Array(30).fill(a)).length <= 200);
});

test('retryDelay backs off and levels out', () => {
  assert.equal(retryDelay(1), 2000);
  assert.ok(retryDelay(3) > retryDelay(2));
  assert.equal(retryDelay(50), 300000);
});

// ---- the outbox ----

test('outbox: kept in storage, shared through it, emptied by remove', () => {
  const st = memStorage();
  const a = createOutbox(st, 'k'), b = createOutbox(st, 'k');
  a.add({ id: '1' }); b.add({ id: '2' });
  assert.deepEqual(a.list().map(o => o.id), ['1', '2']);
  a.remove(['1']);
  assert.deepEqual(b.list().map(o => o.id), ['2']);
  b.remove(['2']);
  assert.equal(st.getItem('k'), null);
});

test('outbox: works in memory when storage is missing or throws', () => {
  const broken = { getItem() { throw new Error('blocked'); }, setItem() { throw new Error('blocked'); }, removeItem() { throw new Error('blocked'); } };
  for (const st of [null, broken]) {
    const o = createOutbox(st, 'k');
    o.add({ id: '1' });
    assert.deepEqual(o.list().map(x => x.id), ['1']);
    o.remove(['1']);
    assert.deepEqual(o.list(), []);
  }
});

// ---- the sender ----

test('sender: one change → one commit with JSON and CSV that agree; the queue empties', async () => {
  const { gh, syncer, outbox, sent } = setup();
  const before = gh.commitCount();
  await syncer.add(mergeOp(readLog(gh), S1, [{ reps: 20 }], S1, 'Log r02 2026-11-05'));
  assert.equal(gh.commitCount(), before + 1);
  assert.equal(gh.lastMessage(), 'Log r02 2026-11-05');
  assert.equal(readLog(gh).length, 2);
  assert.deepEqual(outbox.list(), []);
  assert.equal(sent.length, 1);
  assert.equal(syncer.status().pending, 0);
});

test('sender: changes made while a send is running go out together in the next commit', async () => {
  const { gh, syncer } = setup();
  const before = gh.commitCount();
  const log = readLog(gh);
  const first = syncer.add(mergeOp(log, S1, [{ reps: 20 }], S1, 'Log A'));
  syncer.add(mergeOp(log, S2, [{ reps: 8 }], S2, 'Log B'));
  syncer.add(removeOp({ ...S1, date: '2026-11-04' }, 'Delete C'));
  await first;
  assert.equal(gh.commitCount(), before + 2);
  assert.equal(gh.lastMessage(), '2 changes: Log B; Delete C');
  const ids = readLog(gh).map(e => e.machine_id + '/' + e.date);
  assert.deepEqual(ids.sort(), ['p01/2026-11-05', 'r02/2026-11-05']);
});

test('sender: another writer\'s row survives (the change is replayed on the current log)', async () => {
  const { gh, syncer, sent } = setup();
  const op = mergeOp(readLog(gh), S1, [{ reps: 20 }], S1, 'Log');
  const log = readLog(gh);
  log.unshift(entry({ id: 'from-garmin', machine_id: 'walk', date: '2026-11-05' }));
  gh.write({ [NOV]: monthToText(log) }, 'garmin post');
  await syncer.add(op);
  const ids = readLog(gh).map(e => e.id);
  assert.ok(ids.includes('from-garmin') && ids.includes('x1'));
  assert.equal(ids.length, 3);
  assert.ok(sent[0].res.log.some(e => e.id === 'from-garmin'), 'onSent gets the log as committed');
});

test('sender: a failure keeps the change, schedules a retry, and the retry sends it', async () => {
  const { gh, syncer, outbox, timers, statuses } = setup();
  gh.hooks.failNext = { status: 503, message: 'unavailable' };
  await syncer.add(mergeOp(readLog(gh), S1, [{ reps: 20 }], S1, 'Log'));
  assert.equal(outbox.list().length, 1);
  const st = syncer.status();
  assert.equal(st.pending, 1);
  assert.equal(st.error.status, 503);
  assert.equal(st.failures, 1);
  assert.equal(timers.due.length, 1);
  assert.equal(timers.due[0].ms, retryDelay(1));
  assert.ok(statuses.some(s => s.sending));
  timers.runAll();
  await syncer.flush();
  assert.equal(outbox.list().length, 0);
  assert.equal(syncer.status().error, null);
  assert.equal(readLog(gh).length, 2);
});

test('sender: flush() now cancels the pending retry and sends straight away', async () => {
  const { gh, syncer, outbox, timers } = setup();
  gh.hooks.failNext = { status: 500 };
  await syncer.add(mergeOp(readLog(gh), S1, [{ reps: 20 }]));
  assert.equal(timers.due.length, 1);
  await syncer.flush();
  assert.equal(timers.due.length, 0);
  assert.equal(outbox.list().length, 0);
});

test('sender: changes left from an earlier visit are sent by the next flush', async () => {
  const { gh, storage } = setup();
  const repo = new GitHubRepo({ owner: 'someone', repo: 'traintracks', token: 't', fetch: gh.fetch });
  createOutbox(storage, 'tt-outbox:someone/traintracks').add(mergeOp(readLog(gh), S1, [{ reps: 9 }], S1, 'Left over'));
  const outbox = createOutbox(storage, 'tt-outbox:someone/traintracks');
  const syncer = createSyncer({ outbox, commit: ops => commitLog(repo, l => applyOps(l, ops), batchMessage(ops)) });
  assert.equal(syncer.status().pending, 1);
  await syncer.flush();
  assert.equal(gh.lastMessage(), 'Left over');
  assert.equal(outbox.list().length, 0);
});

test('sender: an empty queue makes no calls', async () => {
  const { gh, syncer } = setup();
  const k = gh.calls.length;
  await syncer.flush();
  assert.equal(gh.calls.length, k);
});
