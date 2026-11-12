/**
 * Loading and saving the log. A save applies the change to the log at the
 * branch head and writes JSON + CSV as one commit on top of that head. If
 * another writer (another device, the coach, a Garmin Action) moved the
 * branch in between, the ref update is refused and it reloads and applies the
 * change again.
 *
 * A cache ({ head, tree, log, sha }) remembers the log as stored in the file
 * (its own order, not the app's sorted view) at a known commit, with the
 * file's blob sha. A save first asks for the branch head; if it is still the
 * cached commit, nothing is downloaded. If the branch moved, the new head's
 * tree says whether the log file itself changed (its blob sha); only then is
 * it downloaded again, as raw text. Common case: 4 calls (GET ref, POST trees,
 * POST commits, PATCH ref). After a save the cache holds what was just written.
 */
import { isConflict, gitBlobSha } from './github.js';
import { logToCSV, logToJSON } from './log.js';

export const LOG_JSON = 'workout-log.json';
export const LOG_CSV = 'workout-log.csv';

/** An empty cache to pass to loadLog() / commitLog(). */
export const newLogCache = () => ({ head: null, tree: null, log: null, sha: null });

/** Parse the log file's text (a missing file is an empty log). */
export function parseLog(text) {
  if (text == null) return [];
  const log = JSON.parse(text);
  if (!Array.isArray(log)) throw new Error(`${LOG_JSON} is not a list`);
  return log;
}

/**
 * Fill `cache` from a log already downloaded: head commit, its tree sha, the
 * file's blob sha (null if absent) and its text.
 */
export function primeLogCache(cache, { head, tree, sha, text }) {
  Object.assign(cache, { head, tree, sha: sha || null, log: parseLog(text) });
  return cache;
}

/**
 * The log at a commit (default: the branch head): { log, head, tree, sha }.
 * With `cache`, a log whose blob sha is unchanged is not downloaded again,
 * and the cache is filled with a private copy.
 */
export async function loadLog(repo, head, cache) {
  head = head || await repo.headSha();
  const t = await repo.treeAt(head);
  const sha = t.files[LOG_JSON] || null;
  let log;
  if (cache && cache.log && cache.sha && cache.sha === sha) log = structuredClone(cache.log);
  else log = sha ? parseLog(await repo.blobText(sha)) : [];
  if (cache) Object.assign(cache, { head, tree: t.sha, sha, log: structuredClone(log) });
  return { log, head, tree: t.sha, sha };
}

/**
 * Apply a change to the log and commit it.
 * `apply(log)` returns the new log, or null to cancel. It may be called more
 * than once (after a conflict), so it must work from the log it is given.
 * `cache` (optional, see above) skips the download when the log has not
 * changed, and is updated after the commit.
 * Returns { log, commit, parent, tree, sha, text }, or null if cancelled:
 * `parent` is the commit it was built on, `sha` and `text` the log file written.
 */
export async function commitLog(repo, apply, message, { attempts = 3, cache } = {}) {
  for (let i = 1; ; i++) {
    const head = await repo.headSha();
    const base = cache && cache.log && cache.head === head ? cache : await loadLog(repo, head, cache);
    const next = apply(structuredClone(base.log));
    if (next == null) return null;
    const text = logToJSON(next);
    try {
      const { commit, tree } = await repo.commitFiles({ [LOG_JSON]: text, [LOG_CSV]: logToCSV(next) }, message, head, base.tree);
      const sha = await gitBlobSha(text);
      if (cache) Object.assign(cache, { head: commit, tree, sha, log: structuredClone(next) });
      return { log: next, commit, parent: head, tree, sha, text };
    } catch (e) {
      if (!isConflict(e) || i >= attempts) throw e;
    }
  }
}
