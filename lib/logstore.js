/**
 * Loading and saving the log. A save reads the log at the branch head,
 * applies the change, and writes JSON + CSV as one commit on top of that
 * head. If another writer (another device, the coach, a Garmin Action) moved
 * the branch in between, it reloads and applies the change again.
 */
import { isConflict } from './github.js';
import { logToCSV, logToJSON } from './log.js';

export const LOG_JSON = 'workout-log.json';
export const LOG_CSV = 'workout-log.csv';

/** The log at a commit (default: the branch head): { log, head }. A missing file is an empty log. */
export async function loadLog(repo, head) {
  head = head || await repo.headSha();
  const f = await repo.getText(LOG_JSON, head);
  const log = f ? JSON.parse(f.text) : [];
  if (!Array.isArray(log)) throw new Error(`${LOG_JSON} is not a list`);
  return { log, head };
}

/**
 * Apply a change to the log and commit it.
 * `apply(log)` returns the new log, or null to cancel. It may be called more
 * than once (after a conflict), so it must work from the log it is given.
 * Returns { log, commit }, or null if cancelled.
 */
export async function commitLog(repo, apply, message, { attempts = 3 } = {}) {
  for (let i = 1; ; i++) {
    const { log, head } = await loadLog(repo);
    const next = apply(structuredClone(log));
    if (next == null) return null;
    try {
      const commit = await repo.commitFiles({ [LOG_JSON]: logToJSON(next), [LOG_CSV]: logToCSV(next) }, message, head);
      return { log: next, commit };
    } catch (e) {
      if (!isConflict(e) || i >= attempts) throw e;
    }
  }
}
