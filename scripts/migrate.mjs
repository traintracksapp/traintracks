#!/usr/bin/env node
/**
 * Convert a LogTrim or TrainTracks 0.1.0 repo checkout (format version 1) into
 * format version 2, writing the result to a separate output folder. The
 * source folder is only read, never changed.
 *
 *   node scripts/migrate.mjs <source-dir> <output-dir> [--fixups <corrections.json>]
 *
 * The optional corrections file is the owner's own (see applyFixups in
 * lib/migrate.js); keep it outside the repo.
 *
 * Converts: workout-log.json (+ CSV), equipment/**\/gym.json and
 * equipment/generic.local.json. Copies gym images. Prints a report of every
 * conversion rule and anything it could not map. Goals, the plan and the
 * Garmin files are converted in later phases.
 */
import fs from 'node:fs';
import path from 'node:path';
import { convertLog, convertGym, convertLocalOverrides, applyFixups } from '../lib/migrate.js';
import { logToJSON, logToCSV } from '../lib/log.js';

const args = process.argv.slice(2);
const fi = args.indexOf('--fixups');
const fixupsPath = fi >= 0 ? args.splice(fi, 2)[1] : null;
const [src, dst] = args;
if (!src || !dst || (fi >= 0 && !fixupsPath)) { console.error('usage: node scripts/migrate.mjs <source-dir> <output-dir> [--fixups <corrections.json>]'); process.exit(2); }
if (path.resolve(src) === path.resolve(dst)) { console.error('output must be a different folder from the source'); process.exit(2); }

const readJSON = p => JSON.parse(fs.readFileSync(p, 'utf8'));
const write = (rel, text) => { const p = path.join(dst, rel); fs.mkdirSync(path.dirname(p), { recursive: true }); fs.writeFileSync(p, text); };

// Gyms
const gymFiles = [];
const walk = dir => { for (const n of fs.readdirSync(dir)) { const p = path.join(dir, n); if (fs.statSync(p).isDirectory()) walk(p); else if (n === 'gym.json') gymFiles.push(p); } };
if (fs.existsSync(path.join(src, 'equipment'))) walk(path.join(src, 'equipment'));
const gyms = gymFiles.map(p => ({ rel: path.relative(src, p), data: readJSON(p) }));
const localPath = path.join(src, 'equipment/generic.local.json');
const local = fs.existsSync(localPath) ? readJSON(localPath) : null;

for (const g of gyms) {
  write(g.rel, JSON.stringify(convertGym(g.data), null, 2) + '\n');
  const imgDir = path.join(path.dirname(path.join(src, g.rel)), 'images');
  if (fs.existsSync(imgDir)) for (const n of fs.readdirSync(imgDir)) write(path.join(path.dirname(g.rel), 'images', n), fs.readFileSync(path.join(imgDir, n)));
}
if (local) write('equipment/generic.local.json', JSON.stringify(convertLocalOverrides(local), null, 2) + '\n');

// Log
const logPath = path.join(src, 'workout-log.json');
const v1 = fs.existsSync(logPath) ? readJSON(logPath) : [];
const r = convertLog(v1, gyms.map(g => g.data), local);
let fx = null;
if (fixupsPath) {
  fx = applyFixups(r.log, readJSON(fixupsPath), gyms.map(g => convertGym(g.data)));
  r.log = fx.log;
}
write('workout-log.json', logToJSON(r.log));
write('workout-log.csv', logToCSV(r.log));

// Report
console.log(`Source: ${src}\nOutput: ${dst}\n`);
console.log(`Gyms converted: ${gyms.length}${local ? ' (+ generic.local.json)' : ''}`);
console.log(`Log entries: ${v1.length} in, ${r.log.length} out\n`);
console.log('Conversions applied (entries per rule):');
for (const [k, v] of Object.entries(r.counts).sort((a, b) => a[0].localeCompare(b[0]))) console.log(`  ${String(v).padStart(5)}  ${k}`);
if (fx) {
  console.log(`\nCorrections from ${fixupsPath}:`);
  for (const [k, v] of Object.entries(fx.counts).sort((a, b) => a[0].localeCompare(b[0]))) console.log(`  ${String(v).padStart(5)}  ${k}`);
  // Report what is left AFTER the corrections.
  const fixed = new Set((readJSON(fixupsPath).remap || []).map(x => x.machine_id));
  for (const k of Object.keys(r.unknownMachines)) { const id = /id ([^)]+)\)$/.exec(k); if (id && fixed.has(id[1])) delete r.unknownMachines[k]; }
  r.problems = r.problems.filter(p => !/: negative /.test(p));
  for (const e of r.log) for (const f of ['reps', 'duration_sec', 'distance_mi', 'speed_mph', 'hr_avg_bpm']) {
    if (e[f] != null && e[f] < 0) r.problems.push(`${e.date} ${e.machine} (${e.gym || '?'}) set ${e.set}: negative ${f} — kept as is`);
  }
  r.problems.push(...fx.problems);
}
const unk = Object.entries(r.unknownMachines);
console.log(`\nMachines not found in any gym (${unk.length}; kept as they are, need a decision):`);
for (const [k, v] of unk.sort((a, b) => b[1] - a[1])) console.log(`  ${String(v).padStart(5)}  ${k}`);
console.log(`\nTo check (${r.problems.length}): ${r.problems.length ? '\n  ' + r.problems.join('\n  ') : 'none'}`);
