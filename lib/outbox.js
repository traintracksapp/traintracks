/**
 * Saving in the background. A log change is recorded as an operation (what
 * the user did, not a copy of the log), kept on the device, shown at once,
 * and sent to GitHub by a single background sender. Operations that pile up
 * while a send is running go out together in the next commit.
 *
 * Operations are replayed on the log as it is at the branch head when they
 * are sent, so rows another writer added in between (a Garmin post, the
 * coach, another device) survive. Replaying an operation twice gives the same
 * result (a session replace, a delete or a move), so a resend is harmless.
 *
 * Pure: storage, the commit function and timers are passed in.
 */
import { mergeSession, removeSession, moveSession, sessionEntries, newId } from './log.js';
import { normalizeVariant } from './variant.js';

const key = s => ({ gym_id: s.gym_id, machine_id: s.machine_id, date: s.date, variant: normalizeVariant(s.variant) });
const opId = () => `op-${newId()}`;

/**
 * Replace session `from` with `sets` as session `to` (see mergeSession).
 * Each set is given the id of the entry it replaces in `log` (or a new id),
 * so the ids shown now are the ids that get saved.
 */
export function mergeOp(log, from, sets, to = from, message = 'Log session') {
  const existing = sessionEntries(log, from);
  const pinned = (sets || []).map((s, i) => ({ ...s, id: s.id || (existing[i] && existing[i].id) || newId() }));
  return { id: opId(), kind: 'merge', from: key(from), to: key(to), sets: pinned, message, at: new Date().toISOString() };
}
export const removeOp = (s, message = 'Delete session') => ({ id: opId(), kind: 'remove', s: key(s), message, at: new Date().toISOString() });
export const moveOp = (from, to, message = 'Move session') => ({ id: opId(), kind: 'move', from: key(from), to: { ...to }, message, at: new Date().toISOString() });

/** Apply one operation to a log (returns a new log; an unknown kind changes nothing). */
export function applyOp(log, op) {
  if (!op) return log;
  if (op.kind === 'merge') return mergeSession(log, op.from, op.sets, op.to);
  if (op.kind === 'remove') return removeSession(log, op.s);
  if (op.kind === 'move') return moveSession(log, op.from, op.to);
  return log;
}
export const applyOps = (log, ops) => (ops || []).reduce(applyOp, log);

/** Commit message for a batch: the operation's own message, or a count and the list. */
export function batchMessage(ops) {
  if (ops.length === 1) return ops[0].message;
  const all = `${ops.length} changes: ${ops.map(o => o.message).join('; ')}`;
  return all.length > 200 ? all.slice(0, 197) + '...' : all;
}

/**
 * The queue of unsent operations, kept in `storage` (localStorage) under `storageKey`.
 * Re-read on every call, so two tabs share it. Without storage it lives in memory.
 */
export function createOutbox(storage, storageKey) {
  let mem = [];
  const read = () => {
    if (!storage) return mem;
    try { const v = JSON.parse(storage.getItem(storageKey) || '[]'); return Array.isArray(v) ? v : []; }
    catch { return mem; }
  };
  const write = ops => {
    mem = ops;
    if (!storage) return;
    try { ops.length ? storage.setItem(storageKey, JSON.stringify(ops)) : storage.removeItem(storageKey); } catch { /* full or blocked: memory copy */ }
  };
  return {
    list: () => read(),
    add: op => { write([...read(), op]); },
    remove: ids => { const s = new Set(ids); write(read().filter(o => !s.has(o.id))); }
  };
}

/** Wait before retry number `n` (1, 2, ...): 2 s, 5 s, 15 s, 30 s, 1 min, then every 5 min. */
export const retryDelay = n => [2000, 5000, 15000, 30000, 60000][n - 1] || 300000;

/**
 * The background sender. `commit(ops)` writes the operations as one commit
 * and resolves with its result; `onSent(result, remaining)` runs after each
 * successful commit; `onChange(status)` whenever the status changes.
 * flush() starts a send now (or joins the one running) and resolves when the
 * queue is empty or a send failed (a retry is then scheduled).
 */
export function createSyncer({ outbox, commit, onSent = () => {}, onChange = () => {},
  schedule = (fn, ms) => setTimeout(fn, ms), cancel = t => clearTimeout(t) }) {
  let running = null, timer = null, failures = 0, error = null;
  const status = () => ({ pending: outbox.list().length, sending: !!running, error, failures });
  const changed = () => onChange(status());

  function flush() {
    if (running) return running;
    if (timer) { cancel(timer); timer = null; }
    if (!outbox.list().length) { error = null; failures = 0; changed(); return Promise.resolve(); }
    running = (async () => {
      try {
        for (let ops = outbox.list(); ops.length; ops = outbox.list()) {
          changed();
          const res = await commit(ops);
          outbox.remove(ops.map(o => o.id));
          failures = 0; error = null;
          onSent(res, outbox.list());
        }
      } catch (e) {
        failures++;
        error = e;
        timer = schedule(() => { timer = null; flush(); }, retryDelay(failures));
      } finally {
        running = null;
        changed();
      }
    })();
    changed();
    return running;
  }

  return { flush, status, add(op) { outbox.add(op); return flush(); } };
}
