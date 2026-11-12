/**
 * Loading and saving the log (format version 3: one file per month,
 * lib/months.js). A save applies the change to the log at the branch head and
 * writes ONLY the month files that changed (a move across months touches two)
 * as one commit on top of that head. If another writer (another device, the
 * coach, a Garmin Action) moved the branch in between, the ref update is
 * refused and it reloads and applies the change again. The CSV export is not
 * written here: a GitHub Action rebuilds it from the months.
 *
 * A cache ({ head, tree, layout, months }) remembers every month file as
 * stored ({ path: { sha, text, entries } }) at a known commit. A save first
 * asks for the branch head; if it is still the cached commit, nothing is
 * downloaded. If the branch moved, the head's tree gives each month's blob
 * sha and only months whose sha changed are downloaded, as raw text. Common
 * case: 4 calls (GET ref, POST trees, POST commits, PATCH ref), uploading one
 * month. After a save the cache holds what was just written.
 *
 * A repo still in the single-file layout (workout-log.json, no log/) can be
 * read, but saving is refused (NotSplitError) until scripts/split-log.mjs has
 * been run: writing months next to the old file would leave two logs.
 */
import { isConflict, gitBlobSha } from './github.js';
import { LEGACY_LOG, logLayout, joinMonths, splitLog, monthChanges, parseLogFile } from './months.js';

export { LEGACY_LOG, LOG_CSV } from './months.js';

/** Saving refused: the repo's log is still one file. */
export class NotSplitError extends Error {
  constructor() {
    super('Your log is still one file (workout-log.json). Saving is off until it is split into months: see "Upgrading to 0.3.0" in the setup guide.');
    this.name = 'NotSplitError';
    this.code = 'not-split';
  }
}

/** An empty cache to pass to loadLog() / commitLog(). */
export const newLogCache = () => ({ head: null, tree: null, layout: null, months: null });

const entriesOf = months => Object.fromEntries(Object.entries(months).map(([p, m]) => [p, m.entries]));

/** The log (newest first) from a cache or loadLog() result. */
export function logOf(base) {
  if (!base || !base.months) return [];
  if (base.layout === 'single') return base.months[LEGACY_LOG] ? base.months[LEGACY_LOG].entries : [];
  return joinMonths(entriesOf(base.months));
}

/**
 * Fill `cache` from log files already downloaded: { head, tree, files: { path: { sha, text } } }
 * (other paths in `files` are ignored). Returns the log.
 */
export function primeLogCache(cache, { head, tree, files }) {
  const { layout, paths } = logLayout(files);
  const months = {};
  for (const p of paths) months[p] = { sha: files[p].sha, text: files[p].text, entries: parseLogFile(files[p].text, p) };
  Object.assign(cache, { head: head || null, tree: tree || null, layout, months });
  return logOf(cache);
}

/**
 * The log at a commit (default: the branch head): { log, head, tree, layout, months }.
 * With `cache`, months whose blob sha is unchanged are not downloaded again,
 * and the cache is filled.
 */
export async function loadLog(repo, head, cache) {
  head = head || await repo.headSha();
  const t = await repo.treeAt(head);
  const { layout, paths } = logLayout(t.files);
  const prev = (cache && cache.months) || {};
  const months = {};
  await Promise.all(paths.map(async p => {
    const sha = t.files[p];
    if (prev[p] && prev[p].sha === sha) { months[p] = prev[p]; return; }
    const text = await repo.blobText(sha);
    months[p] = { sha, text, entries: parseLogFile(text, p) };
  }));
  const base = { head, tree: t.sha, layout, months };
  if (cache) Object.assign(cache, base);
  return { ...base, log: structuredClone(logOf(base)) };
}

/**
 * Apply a change to the log and commit the months it changes.
 * `apply(log)` returns the new log, or null to cancel. It may be called more
 * than once (after a conflict), so it must work from the log it is given.
 * `cache` (optional, see above) skips downloads, and is updated after the commit.
 * Returns { log, commit, parent, tree, files }, or null if cancelled:
 * `parent` is the commit it was built on, `files` the month files written
 * ({ path: { sha, text } }, null for a month removed). If nothing changed, no
 * commit is made (`files` is empty and `commit` is the head).
 */
export async function commitLog(repo, apply, message, { attempts = 3, cache } = {}) {
  for (let i = 1; ; i++) {
    const head = await repo.headSha();
    const base = cache && cache.months && cache.head === head ? cache : await loadLog(repo, head, cache);
    if (base.layout === 'single') throw new NotSplitError();
    const next = apply(structuredClone(logOf(base)));
    if (next == null) return null;
    const { write, remove } = monthChanges(entriesOf(base.months), next);
    if (!Object.keys(write).length && !remove.length) return { log: next, commit: head, parent: head, tree: base.tree, files: {} };
    try {
      const { commit, tree } = await repo.commitFiles({ ...write, ...Object.fromEntries(remove.map(p => [p, null])) }, message, head, base.tree);
      const files = {};
      const months = { ...base.months };
      const split = splitLog(next);
      for (const [p, text] of Object.entries(write)) {
        files[p] = { sha: await gitBlobSha(text), text };
        months[p] = { ...files[p], entries: structuredClone(split[p]) };
      }
      for (const p of remove) { files[p] = null; delete months[p]; }
      if (cache) Object.assign(cache, { head: commit, tree, layout: 'months', months });
      return { log: next, commit, parent: head, tree, files };
    } catch (e) {
      if (!isConflict(e) || i >= attempts) throw e;
    }
  }
}

