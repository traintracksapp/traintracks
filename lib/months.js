/**
 * The log in format version 3: one file per month, `log/YYYY-MM.json`
 * (docs/DATA-FORMAT.md). Pure functions only; the same rules are in
 * pipelines/garmin/logfmt.py and worker/worker.js, and tests check they agree.
 *
 * - An entry goes in the file of the month of its `date`. An entry without a
 *   usable date goes in `log/undated.json` (none should exist).
 * - Within a file: newest date first; the entries of one day in the order they
 *   were saved (sets in order). The whole log is the months newest first, so it
 *   reads exactly as the single file did, and the CSV is built in that order.
 * - Formatting: a JSON array with one entry per line, `[`, then
 *   JSON.stringify(entry) lines joined by `,`, then `]` and a newline. A one-set
 *   change is a one-line diff, and the files are about a fifth smaller than
 *   pretty-printed JSON. An empty month has no file.
 */
import { logToCSV } from './log.js';

export const LOG_DIR = 'log';
/** The single-file log of format version 2, retired by version 3 (kept readable for unsplit repos). */
export const LEGACY_LOG = 'workout-log.json';
/** The CSV export, rebuilt from the months by a GitHub Action (and by scripts/split-log.mjs). */
export const LOG_CSV = 'workout-log.csv';
export const UNDATED = `${LOG_DIR}/undated.json`;

const MONTH_FILE = /^log\/(\d{4})-(0[1-9]|1[0-2])\.json$/;

/** True for a month file of the log (or the undated file). */
export const isMonthFile = p => MONTH_FILE.test(p) || p === UNDATED;

/** The file an entry belongs in. */
export function monthPathOf(e) {
  const m = /^(\d{4})-(0[1-9]|1[0-2])-\d{2}/.exec((e && typeof e.date === 'string' && e.date) || '');
  return m ? `${LOG_DIR}/${m[1]}-${m[2]}.json` : UNDATED;
}

/** Month paths newest first, the undated file last. */
export const sortMonthPaths = paths => [...paths].sort((a, b) => (a === UNDATED ? 1 : b === UNDATED ? -1 : a < b ? 1 : a > b ? -1 : 0));

/**
 * The log split into months: { path: entries }. Each month keeps the log's
 * order, sorted newest date first (stable, so a day's sets keep their order).
 */
export function splitLog(log) {
  const out = {};
  for (const e of log || []) (out[monthPathOf(e)] ||= []).push(e);
  for (const p of Object.keys(out)) out[p] = sortByDate(out[p]);
  return out;
}

const sortByDate = list => list.map((e, i) => [e, i]).sort(([a, i], [b, j]) => {
  const x = (a && a.date) || '', y = (b && b.date) || '';
  return x < y ? 1 : x > y ? -1 : i - j;
}).map(([e]) => e);

/** The whole log from its months ({ path: entries }): newest month first. */
export function joinMonths(months) {
  return sortMonthPaths(Object.keys(months || {})).flatMap(p => months[p] || []);
}

/** A month file's text: one entry per line. */
export function monthToText(entries) {
  if (!entries || !entries.length) return '[]\n';
  return '[\n' + entries.map(e => JSON.stringify(e)).join(',\n') + '\n]\n';
}

/** Parse a month file (or the old single file): a list of entries. */
export function parseLogFile(text, path = 'log file') {
  const v = JSON.parse(text);
  if (!Array.isArray(v)) throw new Error(`${path} is not a list`);
  return v;
}

/**
 * Which layout a repo's files are in ({ path: anything }):
 *  - 'months': format version 3 (any log/ month file); `legacyToo` if the old file is still there;
 *  - 'single': only workout-log.json (version 2, not split yet);
 *  - 'none': no log yet (a new repo; saving creates months).
 */
export function logLayout(files) {
  const paths = Object.keys(files || {});
  const months = sortMonthPaths(paths.filter(isMonthFile));
  const legacy = paths.includes(LEGACY_LOG);
  if (months.length) return { layout: 'months', paths: months, legacyToo: legacy };
  if (legacy) return { layout: 'single', paths: [LEGACY_LOG], legacyToo: true };
  return { layout: 'none', paths: [], legacyToo: false };
}

/**
 * What to write so the months hold `next`: { write: { path: text }, remove: [path] }.
 * `before` = { path: entries } as loaded. Months are compared by their
 * canonical text, so a file only differently formatted is not rewritten.
 */
export function monthChanges(before, next) {
  const after = splitLog(next);
  const write = {}, remove = [];
  for (const [p, entries] of Object.entries(after)) {
    const text = monthToText(entries);
    if (!before[p] || monthToText(before[p]) !== text) write[p] = text;
  }
  for (const p of Object.keys(before || {})) if (!(p in after)) remove.push(p);
  return { write, remove: remove.sort() };
}

/** The CSV export built from the month files ({ path: text }). Other paths are ignored. */
export function csvFromMonthFiles(files) {
  const months = {};
  for (const [p, text] of Object.entries(files || {})) if (isMonthFile(p)) months[p] = parseLogFile(text, p);
  return logToCSV(joinMonths(months));
}

/** Entries as a set (id → canonical JSON) and the differences between two logs, for migration checks. */
export function compareLogs(a, b) {
  const key = e => JSON.stringify(e);
  const count = list => { const m = new Map(); for (const e of list) m.set(key(e), (m.get(key(e)) || 0) + 1); return m; };
  const x = count(a), y = count(b);
  let missing = 0, extra = 0;
  for (const [k, n] of x) missing += Math.max(0, n - (y.get(k) || 0));
  for (const [k, n] of y) extra += Math.max(0, n - (x.get(k) || 0));
  return { same: missing === 0 && extra === 0, missing, extra, sameOrder: a.length === b.length && a.every((e, i) => key(e) === key(b[i])) };
}
