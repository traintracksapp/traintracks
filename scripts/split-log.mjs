#!/usr/bin/env node
/**
 * TrainTracks 0.2.x → 0.3.0: split the log into one file per month (format version 3).
 *
 *   node scripts/split-log.mjs <repo-dir> <output-dir>
 *
 * Run it from a checkout of the template at 0.3.0 or later. It reads
 * <repo-dir>/workout-log.json (never changes anything in <repo-dir>) and writes
 * into <output-dir>:
 *   log/YYYY-MM.json            the log, one file per month (docs/DATA-FORMAT.md)
 *   workout-log.csv             rebuilt from the months (same rows as before)
 *   .github/workflows/build-csv.yml   the new Action that rebuilds the CSV
 *   .github/workflows/garmin.yml      the Garmin workflow for the new layout
 * and prints a report: entries per month, and checks that the months hold
 * exactly the entries of the old file and that the CSV is unchanged.
 * Nothing is written unless every check passes.
 *
 * Then, in the repo, in ONE commit: add log/ and workout-log.csv from the
 * output, delete workout-log.json, and add or replace the two workflow files
 * (see "Upgrading to 0.3.0" in docs/SETUP.md).
 */
import fs from 'node:fs';
import path from 'node:path';
import { splitLog, joinMonths, monthToText, compareLogs, csvFromMonthFiles, sortMonthPaths, LEGACY_LOG, LOG_CSV, isMonthFile } from '../lib/months.js';
import { sortLog } from '../lib/log.js';

const [src, dst] = process.argv.slice(2);
const fail = (msg, code = 1) => { console.error(msg); process.exit(code); };
if (!src || !dst) fail('usage: node scripts/split-log.mjs <repo-dir> <output-dir>', 2);
if (path.resolve(src) === path.resolve(dst)) fail('the output must be a different folder from the repo', 2);

const logDir = path.join(src, 'log');
if (fs.existsSync(logDir) && fs.readdirSync(logDir).some(n => isMonthFile(`log/${n}`))) fail(`${src} already has month files in log/: it is split already. Nothing written.`);
const legacyPath = path.join(src, LEGACY_LOG);
if (!fs.existsSync(legacyPath)) fail(`${legacyPath} not found. Nothing written.`);
const legacyText = fs.readFileSync(legacyPath, 'utf8');
const log = JSON.parse(legacyText);
if (!Array.isArray(log)) fail(`${LEGACY_LOG} is not a list. Nothing written.`);
if (log.some(e => e && ('machineId' in e || 'datetime' in e || 'gymId' in e))) fail(`${LEGACY_LOG} is still in format version 1: run scripts/migrate.mjs first. Nothing written.`);

// ---- split and check ----
const months = splitLog(log);
const files = Object.fromEntries(Object.entries(months).map(([p, e]) => [p, monthToText(e)]));
const joined = joinMonths(Object.fromEntries(Object.entries(files).map(([p, t]) => [p, JSON.parse(t)])));
const cmp = compareLogs(log, joined);
const csv = csvFromMonthFiles(files);
const oldCsvPath = path.join(src, LOG_CSV);
const oldCsv = fs.existsSync(oldCsvPath) ? fs.readFileSync(oldCsvPath, 'utf8') : null;
const ids = log.map(e => e && e.id).filter(Boolean);
const dupIds = ids.length - new Set(ids).size;

console.log(`Log: ${log.length} entries in ${LEGACY_LOG} (${(Buffer.byteLength(legacyText) / 1024).toFixed(0)} KB)`);
console.log('Entries per month:');
for (const p of sortMonthPaths(Object.keys(months))) console.log(`  ${p}  ${String(months[p].length).padStart(5)}  (${(Buffer.byteLength(files[p]) / 1024).toFixed(1)} KB)`);
const total = Object.values(months).reduce((n, e) => n + e.length, 0);
const bytes = Object.values(files).reduce((n, t) => n + Buffer.byteLength(t), 0);
console.log(`  ${Object.keys(months).length} months, ${total} entries, ${(bytes / 1024).toFixed(0)} KB in all`);
if (months['log/undated.json']) console.log(`  NOTE: ${months['log/undated.json'].length} entries have no usable date; they are in log/undated.json`);
console.log(`Check: the months hold exactly the entries of ${LEGACY_LOG}: ${cmp.same ? 'yes' : `NO (${cmp.missing} missing, ${cmp.extra} extra)`}`);
console.log(`Check: same order (newest first): ${cmp.sameOrder ? 'yes' : `no: the old file was not in date order; the months are (${compareLogs(sortLog(log), joined).sameOrder ? 'a stable sort by date' : 'see the files'})`}`);
console.log(`Check: entry ids unique: ${dupIds ? `NO (${dupIds} duplicates; kept as they are)` : 'yes'}`);
if (oldCsv == null) console.log(`Check: ${LOG_CSV} rebuilt from the months (there was none before)`);
else console.log(`Check: ${LOG_CSV} rebuilt from the months is identical to the old one: ${csv === oldCsv ? 'yes' : 'no (the old CSV was out of step with the JSON, or in another order); the new one is built from the JSON'}`);
if (!cmp.same) fail('The split does not hold the same entries. Nothing written.');

// ---- write ----
const write = (rel, text) => { const p = path.join(dst, rel); fs.mkdirSync(path.dirname(p), { recursive: true }); fs.writeFileSync(p, text); };
for (const [p, t] of Object.entries(files)) write(p, t);
write(LOG_CSV, csv);
const here = path.resolve(new URL('..', import.meta.url).pathname);
for (const wf of ['build-csv.yml', 'garmin.yml']) write(`.github/workflows/${wf}`, fs.readFileSync(path.join(here, '.github/workflows', wf), 'utf8'));
console.log(`\nWrote ${Object.keys(files).length} month files, ${LOG_CSV} and .github/workflows/{build-csv,garmin}.yml to ${dst}`);
console.log(`Next, in the repo, as ONE commit:
  1. copy log/ and ${LOG_CSV} from ${dst}
  2. delete ${LEGACY_LOG}
  3. copy .github/workflows/build-csv.yml, and replace .github/workflows/garmin.yml
     (if you changed yours, e.g. its schedule, compare first)
  git add log ${LOG_CSV} .github/workflows/build-csv.yml .github/workflows/garmin.yml && git rm ${LEGACY_LOG}
  git commit -m "Split the workout log into monthly files (TrainTracks 0.3.0)"
Pushing workflow files needs a token or login allowed to change workflows (see docs/SETUP.md).`);
