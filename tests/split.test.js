import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync, spawnSync } from 'node:child_process';
import { log as fixtureLog } from './fixtures/user-repo/make-log.mjs';
import { logToJSON, logToCSV, sortLog } from '../lib/log.js';
import { joinMonths, parseLogFile, compareLogs } from '../lib/months.js';

const ROOT = path.resolve(new URL('..', import.meta.url).pathname);
const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'tt-split-'));

/** A made-up repo in format version 2 (one file), a few months long. */
function v2Repo(log) {
  const d = tmp();
  fs.writeFileSync(path.join(d, 'workout-log.json'), logToJSON(log));
  fs.writeFileSync(path.join(d, 'workout-log.csv'), logToCSV(log));
  fs.writeFileSync(path.join(d, 'profile.json'), '{}\n');
  return d;
}
const longLog = () => {
  const out = [];
  for (let m = 12; m >= 1; m--) for (let d = 28; d >= 1; d -= 3) for (let s = 1; s <= 2; s++) {
    out.push({ id: `e${m}-${d}-${s}`, date: `2025-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`, gym_id: 'g', machine_id: 'm', set: s, variant: [], reps: 10, notes: s === 1 ? 'a, "quoted"' : '' });
  }
  return [...fixtureLog, ...out];
};
const readMonths = dir => {
  const months = {};
  for (const n of fs.readdirSync(path.join(dir, 'log'))) months[`log/${n}`] = parseLogFile(fs.readFileSync(path.join(dir, 'log', n), 'utf8'));
  return months;
};
const run = (...args) => spawnSync(process.execPath, [path.join(ROOT, 'scripts/split-log.mjs'), ...args], { encoding: 'utf8' });

test('split-log: months hold exactly the old entries, the CSV is unchanged, the source is untouched', () => {
  const log = longLog();
  const src = v2Repo(log), out = tmp();
  const before = fs.readFileSync(path.join(src, 'workout-log.json'), 'utf8');
  const r = run(src, out);
  assert.equal(r.status, 0, r.stderr + r.stdout);
  assert.match(r.stdout, /log\/2025-03\.json\s+20/);
  assert.match(r.stdout, /the months hold exactly the entries of workout-log\.json: yes/);
  assert.match(r.stdout, /identical to the old one: yes/);
  const months = readMonths(out);
  assert.equal(Object.keys(months).length, 14);
  assert.ok(compareLogs(log, joinMonths(months)).same);
  assert.deepEqual(joinMonths(months), sortLog(log));
  assert.equal(fs.readFileSync(path.join(out, 'workout-log.csv'), 'utf8'), fs.readFileSync(path.join(src, 'workout-log.csv'), 'utf8'));
  assert.ok(fs.existsSync(path.join(out, '.github/workflows/build-csv.yml')) && fs.existsSync(path.join(out, '.github/workflows/garmin.yml')));
  assert.equal(fs.readFileSync(path.join(src, 'workout-log.json'), 'utf8'), before);
  assert.deepEqual(fs.readdirSync(src).sort(), ['profile.json', 'workout-log.csv', 'workout-log.json']);
  assert.ok(!fs.existsSync(path.join(out, 'workout-log.json')));
});

test('split-log: a log out of date order is put in order, and says so', () => {
  const log = longLog();
  [log[3], log[40]] = [log[40], log[3]];
  const r = run(v2Repo(log), tmp());
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /same order \(newest first\): no/);
  assert.match(r.stdout, /hold exactly the entries of workout-log\.json: yes/);
});

test('split-log refuses: same folder, already split, version 1 data, no log', () => {
  const src = v2Repo(fixtureLog);
  assert.equal(run(src, src).status, 2);
  assert.equal(run(src).status, 2);
  const split = tmp(); fs.mkdirSync(path.join(split, 'log')); fs.writeFileSync(path.join(split, 'log/2026-11.json'), '[]\n');
  const out = tmp();
  let r = run(split, out);
  assert.equal(r.status, 1); assert.match(r.stderr, /split already/);
  const v1 = tmp(); fs.writeFileSync(path.join(v1, 'workout-log.json'), JSON.stringify([{ machineId: 'x', date: '2026-01-01' }]));
  r = run(v1, out);
  assert.equal(r.status, 1); assert.match(r.stderr, /version 1/);
  r = run(tmp(), out);
  assert.equal(r.status, 1); assert.match(r.stderr, /not found/);
  assert.deepEqual(fs.readdirSync(out), [], 'nothing written on a refusal');
});

// ---- the CSV Action ----

const yml = fs.readFileSync(path.join(ROOT, '.github/workflows/build-csv.yml'), 'utf8');
const inlineScript = () => /node --input-type=module -e '([\s\S]*?)'\n/.exec(yml)[1];

test('build-csv.yml: its script rebuilds the same CSV as the old single file had', () => {
  const log = longLog();
  const src = v2Repo(log), out = tmp();
  assert.equal(run(src, out).status, 0);
  fs.rmSync(path.join(out, 'workout-log.csv'));
  fs.cpSync(path.join(ROOT, 'lib'), path.join(out, 'lib'), { recursive: true });
  execFileSync(process.execPath, ['--input-type=module', '-e', inlineScript()], { cwd: out });
  assert.equal(fs.readFileSync(path.join(out, 'workout-log.csv'), 'utf8'), fs.readFileSync(path.join(src, 'workout-log.csv'), 'utf8'));
});

test('build-csv.yml cannot trigger itself', () => {
  const paths = /paths: \[([^\]]*)\]/.exec(yml)[1];
  assert.ok(!/workout-log\.csv/.test(paths), 'its own output is not a trigger');
  assert.match(paths, /'log\/\*\*'/);
  assert.match(yml, /git add workout-log\.csv\n/, 'it commits only the CSV');
  assert.ok(!/git add (?!workout-log\.csv)/.test(yml));
  assert.match(yml, /\[skip ci\]/);
  assert.match(yml, /concurrency:\s*\n\s*group: build-csv/);
  assert.match(yml, /workflows: \[garmin\]/, 'runs after the Garmin workflow, whose pushes start no workflows');
});

test('garmin.yml posts into log/ and commits it', () => {
  const g = fs.readFileSync(path.join(ROOT, '.github/workflows/garmin.yml'), 'utf8');
  assert.match(g, /post_zone_records\.py[\s\S]*--log-dir log/);
  assert.ok(!/--log-json/.test(g));
  assert.match(g, /blood-pressure\.csv workout-log\.json workout-log\.csv log; do/);
});
