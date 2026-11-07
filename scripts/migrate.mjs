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
 * Converts: workout-log.json (+ CSV), equipment/**\/gym.json,
 * equipment/generic.local.json, goals.json, profile.json and
 * suggested-workout.json. Copies gym images. Prints a report of every
 * conversion rule and anything it could not map.
 */
import fs from 'node:fs';
import path from 'node:path';
import { convertLog, convertGym, convertLocalOverrides, applyFixups, convertGoals, convertProfile, convertPlan, v1MachineTypes,
  convertCardioMinutesCSV, convertBucketsCSV, convertWellnessCSV, convertZones, convertCorrections, convertMapping,
  dropRemappedLocalMachines, remapMapping } from '../lib/migrate.js';
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

// The common gym is template-managed: the output gets the TEMPLATE's copy (this
// repo's), not the source's old one. The user's own changes to it are in
// generic.local.json, converted below.
const ROOT = path.resolve(new URL('..', import.meta.url).pathname);
const tplGenericDir = path.join(ROOT, 'equipment/generic');
const tplGeneric = fs.existsSync(path.join(tplGenericDir, 'gym.json')) ? readJSON(path.join(tplGenericDir, 'gym.json')) : null;
const copyDir = (from, rel) => { if (fs.existsSync(from)) for (const n of fs.readdirSync(from)) write(path.join(rel, n), fs.readFileSync(path.join(from, n))); };
const v2gyms = [];
for (const g of gyms) {
  const isGeneric = g.rel.split(path.sep).join('/') === 'equipment/generic/gym.json';
  if (isGeneric && tplGeneric) {
    write(g.rel, JSON.stringify(tplGeneric, null, 2) + '\n');
    copyDir(path.join(tplGenericDir, 'images'), 'equipment/generic/images');
    v2gyms.push(tplGeneric);
    continue;
  }
  const v2 = convertGym(g.data);
  v2gyms.push(v2);
  write(g.rel, JSON.stringify(v2, null, 2) + '\n');
  copyDir(path.join(path.dirname(path.join(src, g.rel)), 'images'), path.join(path.dirname(g.rel), 'images'));
}
let local2 = local ? convertLocalOverrides(local) : null;

// Log
const logPath = path.join(src, 'workout-log.json');
const v1 = fs.existsSync(logPath) ? readJSON(logPath) : [];
const r = convertLog(v1, gyms.map(g => g.data), local);
let fx = null, remapTargets = {};
if (fixupsPath) {
  const fixups = readJSON(fixupsPath);
  fx = applyFixups(r.log, fixups, v2gyms);
  r.log = fx.log;
  // Rows moved off a machine the user added to the common gym: drop that machine, and
  // re-point mapping.json entries at the new machine.
  for (const m of fixups.remap || []) {
    const [gid, mid] = m.to.split(':');
    const g = v2gyms.find(x => x.id === gid);
    const room = g && g.rooms.find(rm => rm.machines.some(x => x.id === mid));
    const mach = room && room.machines.find(x => x.id === mid);
    if (mach) remapTargets[m.machine_id] = { gym_id: g.id, gym: g.name, room_id: room.id, room: room.name, machine_id: mach.id, machine: mach.name };
  }
  local2 = dropRemappedLocalMachines(local2, Object.keys(remapTargets));
}
if (local2) write('equipment/generic.local.json', JSON.stringify(local2, null, 2) + '\n');
write('workout-log.json', logToJSON(r.log));
write('workout-log.csv', logToCSV(r.log));

// Goals, profile, plan
const goalNotes = [];
const maybe = name => (fs.existsSync(path.join(src, name)) ? readJSON(path.join(src, name)) : null);
const g1 = maybe('goals.json');
if (g1) { const g = convertGoals(g1); write('goals.json', JSON.stringify(g.goals, null, 2) + '\n'); goalNotes.push(...g.notes); }
const p1 = maybe('profile.json');
if (p1) write('profile.json', JSON.stringify(convertProfile(p1), null, 2) + '\n');
const s1 = maybe('suggested-workout.json');
if (s1) write('suggested-workout.json', JSON.stringify(convertPlan(s1, v1MachineTypes(gyms.map(g => g.data), local)), null, 2) + '\n');
// Garmin files (garmin-recent.json is not converted: the next Garmin run rewrites it)
const garminDone = [];
const csvConv = { 'cardio-minutes.csv': convertCardioMinutesCSV, 'cardio-buckets.csv': convertBucketsCSV, 'daily-wellness.csv': convertWellnessCSV };
for (const [f, fn] of Object.entries(csvConv)) if (fs.existsSync(path.join(src, f))) { write(f, fn(fs.readFileSync(path.join(src, f), 'utf8'))); garminDone.push(f); }
const jsonConv = { 'pipelines/garmin/zones.json': convertZones, 'pipelines/garmin/corrections.json': convertCorrections, 'pipelines/garmin/mapping.json': convertMapping };
for (const [f, fn] of Object.entries(jsonConv)) {
  if (!fs.existsSync(path.join(src, f))) continue;
  let out = fn(readJSON(path.join(src, f)));
  if (f.endsWith('mapping.json')) out = remapMapping(out, remapTargets);
  const tpl = path.join(ROOT, f); // the explanatory comment comes from the template (the old one names old keys)
  if (out && fs.existsSync(tpl)) { const c = readJSON(tpl)._comment; if (c) out._comment = c; }
  write(f, JSON.stringify(out, null, 2) + '\n');
  garminDone.push(f);
}
for (const f of ['VERSION']) if (fs.existsSync(path.join(src, f))) write(f, fs.readFileSync(path.join(src, f)));

// Report
console.log(`Source: ${src}\nOutput: ${dst}\n`);
console.log(`Gyms converted: ${gyms.length}${local ? ' (+ generic.local.json)' : ''}`);
console.log(`Log entries: ${v1.length} in, ${r.log.length} out`);
console.log(`Also converted: ${[...['goals.json', 'profile.json', 'suggested-workout.json'].filter(f => fs.existsSync(path.join(src, f))), ...garminDone].join(', ') || 'nothing else'}${goalNotes.length ? `\n  ${goalNotes.join('\n  ')}` : ''}\n`);
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
