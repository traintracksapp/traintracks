/**
 * Loading and saving the log. A save applies the change to the log at the
 * branch head and writes JSON + CSV as one commit on top of that head. If
 * another writer (another device, the coach, a Garmin Action) moved the
 * branch in between, the ref update is refused and it reloads and applies the
 * change again.
 *
 * A cache ({ head, tree, log }) remembers the log as stored in the file (its
 * own order, not the app's sorted view) at a known commit. A save first asks
 * for the branch head; if it is still the cached commit, the log is not
 * downloaded again. Common case: 4 calls (GET ref, POST trees, POST commits,
 * PATCH ref). After a save the cache holds what was just written.
 */
import { isConflict } from './github.js';
import { logToCSV, logToJSON } from './log.js';

export const LOG_JSON = 'workout-log.json';
export const LOG_CSV = 'workout-log.csv';

/** An empty cache to pass to loadLog() / commitLog(). */
export const newLogCache = () => ({ head: null, tree: null, log: null });

/**
 * The log at a commit (default: the branch head): { log, head, tree }. A
 * missing file is an empty log. With `cache`, it is filled with a private copy.
 */
export async function loadLog(repo, head, cache) {
  head = head || await repo.headSha();
  const [f, tree] = await Promise.all([repo.getText(LOG_JSON, head), repo.commitTree(head)]);
  const log = f ? JSON.parse(f.text) : [];
  if (!Array.isArray(log)) throw new Error(`${LOG_JSON} is not a list`);
  if (cache) Object.assign(cache, { head, tree, log: structuredClone(log) });
  return { log, head, tree };
}

/**
 * Apply a change to the log and commit it.
 * `apply(log)` returns the new log, or null to cancel. It may be called more
 * than once (after a conflict), so it must work from the log it is given.
 * `cache` (optional, see above) skips the download when the branch has not
 * moved, and is updated after the commit.
 * Returns { log, commit }, or null if cancelled.
 */
export async function commitLog(repo, apply, message, { attempts = 3, cache } = {}) {
  for (let i = 1; ; i++) {
    const head = await repo.headSha();
    const base = cache && cache.log && cache.head === head ? cache : await loadLog(repo, head, cache);
    const next = apply(structuredClone(base.log));
    if (next == null) return null;
    try {
      const { commit, tree } = await repo.commitFiles({ [LOG_JSON]: logToJSON(next), [LOG_CSV]: logToCSV(next) }, message, head, base.tree);
      if (cache) Object.assign(cache, { head: commit, tree, log: structuredClone(next) });
      return { log: next, commit };
    } catch (e) {
      if (!isConflict(e) || i >= attempts) throw e;
    }
  }
}
