#!/usr/bin/env node
/**
 * TrainTracks 0.2.0 → 0.2.1: store heart-rate zones in minutes.
 *
 *   node scripts/zones-to-minutes.mjs <repo-dir> <output-dir>
 *
 * Reads workout-log.json and goals.json from <repo-dir> (never changed) and
 * writes converted workout-log.json, workout-log.csv and (if it changed)
 * goals.json into <output-dir>. zone1_sec … zone5_sec become zone1_min …
 * zone5_min (minutes, 2 decimals); the CSV gains duration_min. Copy the
 * output files into the repo and commit them together.
 */
import fs from 'node:fs';
import path from 'node:path';
import { zonesToMinutes, zoneGoalsToMinutes } from '../lib/migrate.js';
import { logToJSON, logToCSV } from '../lib/log.js';

const [src, dst] = process.argv.slice(2);
if (!src || !dst) { console.error('usage: node scripts/zones-to-minutes.mjs <repo-dir> <output-dir>'); process.exit(2); }
if (path.resolve(src) === path.resolve(dst)) { console.error('output must be a different folder from the source'); process.exit(2); }
fs.mkdirSync(dst, { recursive: true });

const logPath = path.join(src, 'workout-log.json');
const log = fs.existsSync(logPath) ? JSON.parse(fs.readFileSync(logPath, 'utf8')) : [];
const r = zonesToMinutes(log);
fs.writeFileSync(path.join(dst, 'workout-log.json'), logToJSON(r.log));
fs.writeFileSync(path.join(dst, 'workout-log.csv'), logToCSV(r.log));
console.log(`Log entries: ${log.length} in, ${r.log.length} out; ${r.changed} with zones converted to minutes`);
const left = r.log.filter(e => [1, 2, 3, 4, 5].some(i => `zone${i}_sec` in e)).length;
console.log(`Entries still with zone*_sec: ${left}`);

const goalsPath = path.join(src, 'goals.json');
if (fs.existsSync(goalsPath)) {
  const g = zoneGoalsToMinutes(JSON.parse(fs.readFileSync(goalsPath, 'utf8')));
  if (g.changed) fs.writeFileSync(path.join(dst, 'goals.json'), JSON.stringify(g.goals, null, 2) + '\n');
  console.log(`Goals on zone fields: ${g.changed}${g.changed ? ' (goals.json written)' : ' (goals.json unchanged, not written)'}`);
}
