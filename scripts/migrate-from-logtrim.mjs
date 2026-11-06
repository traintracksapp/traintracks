#!/usr/bin/env node
/**
 * migrate-from-logtrim.mjs — copy a LogTrim user repo's data into the
 * TrainTracks layout.
 *
 *   node scripts/migrate-from-logtrim.mjs <logtrim-checkout> <output-dir> [--link]
 *
 * Reads the old repo (never writes to it) and writes into <output-dir>:
 *   workout-log.json / .csv   every entry gets an id; "Garmin <id>" note tags become garminId;
 *                             gymId/roomId are filled in from the gyms where missing
 *   profile.json, goals.json, suggested-workout.json
 *   equipment/my-gyms/**      copied as-is (gym.json normalised)
 *   equipment/generic.local.json   the user's additions/hides to the generic gym, as overrides
 *   garmin-recent.json, cardio-minutes.csv, cardio-buckets.csv, daily-wellness.csv
 *   pipelines/garmin/{zones,corrections}.json
 *   MIGRATION-REPORT.md       what was mapped, what wasn't, proposed Garmin links
 *
 * --link also applies the unambiguous same-day Garmin links it proposes.
 * The output dir is meant to be committed on top of a fresh TrainTracks repo.
 */
import fs from 'node:fs';
import path from 'node:path';
import { normaliseLog, sortLog, garminIdOf, machineInfoMap, classifyEntry } from '../lib/log.js';
import { toCSV } from '../lib/csv.js';
import { parseBucketsCSV } from '../lib/goals.js';
import { serialiseGym } from '../lib/gyms.js';

const [,, SRC, OUT, ...flags] = process.argv;
if (!SRC || !OUT) { console.error('usage: migrate-from-logtrim.mjs <logtrim-checkout> <output-dir> [--link]'); process.exit(2); }
const LINK = flags.includes('--link');
const TEMPLATE_GENERIC = path.resolve(new URL('../equipment/generic/gym.json', import.meta.url).pathname);

const report = [];
const say = s => { report.push(s); console.log(s); };
const readJSON = p => fs.existsSync(p) ? JSON.parse(fs.readFileSync(p, 'utf8')) : null;
const writeJSON = (p, d) => { fs.mkdirSync(path.dirname(p), { recursive: true }); fs.writeFileSync(p, JSON.stringify(d, null, 2) + '\n'); };
const copy = (rel, to = rel) => { const s = path.join(SRC, rel); if (!fs.existsSync(s)) return false; const d = path.join(OUT, to); fs.mkdirSync(path.dirname(d), { recursive: true }); fs.cpSync(s, d, { recursive: true }); return true; };

say(`# Migration report — ${new Date().toISOString().slice(0, 16).replace('T', ' ')}\n`);
say(`Source: ${path.resolve(SRC)}\nOutput: ${path.resolve(OUT)}\n`);

// ---- gyms ----
const gyms = [];
const generic = readJSON(path.join(SRC, 'equipment/generic/gym.json'));
if (generic) gyms.push(generic);
const myDir = path.join(SRC, 'equipment/my-gyms');
if (fs.existsSync(myDir)) {
  for (const name of fs.readdirSync(myDir)) {
    const g = readJSON(path.join(myDir, name, 'gym.json'));
    if (!g) continue;
    gyms.push(g);
    copy(`equipment/my-gyms/${name}/images`);
    writeJSON(path.join(OUT, `equipment/my-gyms/${name}/gym.json`), serialiseGym(g));
  }
}
say(`## Gyms\n- ${gyms.length} gyms read (${gyms.filter(g => g.id !== 'generic').length} personal, copied to equipment/my-gyms/)`);

// generic overrides: anything in the user's generic gym that the template's doesn't have
const tplGeneric = readJSON(TEMPLATE_GENERIC);
if (generic && tplGeneric) {
  const ov = { hidden: [], machines: [], rooms: [] };
  const tplRooms = new Map(tplGeneric.rooms.map(r => [r.id, r]));
  for (const r of generic.rooms) {
    const tr = tplRooms.get(r.id);
    if (!tr) { ov.rooms.push({ id: r.id, name: r.name }); }
    for (const m of r.machines) {
      const tm = tr && tr.machines.find(x => x.id === m.id);
      if (!tm) { const { hidden, ...rest } = m; ov.machines.push({ roomId: r.id, ...rest }); if (hidden) ov.hidden.push(m.id); }
      else if (m.hidden) ov.hidden.push(m.id);
    }
  }
  if (ov.hidden.length || ov.machines.length || ov.rooms.length) {
    writeJSON(path.join(OUT, 'equipment/generic.local.json'), ov);
    say(`- generic.local.json: ${ov.machines.length} added machine(s) [${ov.machines.map(m => m.name).join(', ')}], ${ov.hidden.length} hidden, ${ov.rooms.length} added room(s)`);
  } else say('- generic gym matches the template; no overrides needed');
}

// ---- log ----
const rawLog = readJSON(path.join(SRC, 'workout-log.json')) || [];
const byMachine = new Map(); // machineId -> [{gymId, roomId, gymName}]
gyms.forEach(g => g.rooms.forEach(r => r.machines.forEach(m => { if (!byMachine.has(m.id)) byMachine.set(m.id, []); byMachine.get(m.id).push({ gymId: g.id, roomId: r.id, gymName: g.name }); })));
let filled = 0, ambiguous = 0, unknown = new Map(), tagged = 0;
const log = sortLog(normaliseLog(rawLog)).map(e => {
  const out = { ...e };
  if (!out.gymId) {
    const hits = byMachine.get(out.machineId) || [];
    const byName = hits.filter(h => h.gymName === out.gym);
    const pick = byName.length === 1 ? byName[0] : hits.length === 1 ? hits[0] : null;
    if (pick) { out.gymId = pick.gymId; out.roomId = pick.roomId; filled++; }
    else if (hits.length > 1) ambiguous++;
    else unknown.set(out.machineId, (unknown.get(out.machineId) || 0) + 1);
  }
  if (out.garminId && !/Garmin\s+\d{9,}/i.test(out.notes || '')) tagged++;
  return out;
});
say(`\n## Workout log\n- ${log.length} entries; ${log.filter(e => e.garminId).length} linked to Garmin activities (${rawLog.filter(e => e.garminId).length} had a garminId field before; the rest came from the notes tag)`);
say(`- gymId/roomId filled in on ${filled} legacy entries; ${ambiguous} ambiguous (machineId in several gyms, gym name didn't settle it) left without gymId`);
if (unknown.size) say(`- machineIds not found in any gym (history kept, shown under the logged names): ${[...unknown].map(([k, n]) => `${k} (${n})`).join(', ')}`);

// ---- Garmin link proposals: unlinked cardio entries vs unlinked bucket rows on the same day ----
const bucketsText = fs.existsSync(path.join(SRC, 'cardio-buckets.csv')) ? fs.readFileSync(path.join(SRC, 'cardio-buckets.csv'), 'utf8') : '';
const buckets = parseBucketsCSV(bucketsText);
const linked = new Set(log.map(garminIdOf).filter(Boolean));
const unlinkedActs = Object.values(buckets).filter(b => !linked.has(b.id));
const proposals = [], unmatched = [];
const info = machineInfoMap(gyms);
const TYPE_WORDS = { walking: /walk|hike/i, hiking: /walk|hike/i, running: /run|jog|tread/i, treadmill_running: /run|jog|tread/i, cycling: /bike|ride|cycl|peloton/i, indoor_cycling: /bike|ride|cycl|peloton/i, elliptical: /ellip/i, indoor_cardio: /./, other: /./ };
const used = new Set();
for (const b of unlinkedActs.sort((x, y) => x.start < y.start ? -1 : 1)) {
  const re = TYPE_WORDS[b.type] || /./;
  const cands = log.filter(e => e.date === b.date && !garminIdOf(e) && !used.has(e.id) && e.set === 1 && e.duration != null
    && classifyEntry(e, info) === 'cardio' && re.test(`${e.machine} ${e.machineId}`)
    && Math.abs(Number(e.duration) - b.minutes) <= Math.max(5, 0.25 * b.minutes));
  if (cands.length === 1) { proposals.push({ act: b, entry: cands[0] }); used.add(cands[0].id); }
  else unmatched.push({ act: b, n: cands.length });
}
if (unlinkedActs.length) {
  say(`\n## Garmin activities not linked to a log entry (${unlinkedActs.length})`);
  proposals.forEach(p => say(`- ${p.act.date} ${p.act.type} ${p.act.id} (${p.act.minutes} min) ↔ "${p.entry.machine}" set ${p.entry.set} ${p.entry.duration} min${p.entry.notes ? ` — "${p.entry.notes.slice(0, 60)}"` : ''}  ${LINK ? '→ LINKED' : '(proposed; re-run with --link to apply)'}`));
  unmatched.forEach(u => say(`- ${u.act.date} ${u.act.type} ${u.act.id} (${u.act.minutes} min): ${u.n === 0 ? 'no matching hand-logged cardio that day — not in the log' : `${u.n} candidate entries, not linking automatically`}`));
  const notInLog = unmatched.filter(u => u.n === 0).length;
  if (notInLog) say(`\nTo add the ${notInLog} activities that were never logged as log rows, run the posting script once with an early --since, e.g.:\n  python pipelines/garmin/post_zone_records.py --cardio cardio-minutes.csv --log-json workout-log.json --log-csv workout-log.csv --garmin garmin-recent.json --since 2026-01-01 --dry-run\n(indoor types need pipelines/garmin/mapping.json; drop --dry-run to write).`);
  if (LINK) proposals.forEach(p => { const e = log.find(x => x.id === p.entry.id); e.garminId = p.act.id; });
}

writeJSON(path.join(OUT, 'workout-log.json'), log);
fs.writeFileSync(path.join(OUT, 'workout-log.csv'), toCSV(log));

// ---- simple copies ----
const copied = ['profile.json', 'goals.json', 'suggested-workout.json', 'garmin-recent.json', 'cardio-minutes.csv', 'cardio-buckets.csv', 'daily-wellness.csv'].filter(f => copy(f));
if (copy('cardio-minutes-pipeline/zones.json', 'pipelines/garmin/zones.json')) copied.push('zones.json → pipelines/garmin/');
if (copy('cardio-minutes-pipeline/corrections.json', 'pipelines/garmin/corrections.json')) copied.push('corrections.json → pipelines/garmin/');
say(`\n## Copied\n- ${copied.join(', ')}`);

// ---- things that do NOT carry over ----
say(`\n## Not migrated (by design)\n- worker.js, push.bat, purge-tokens.bat, the old scripts/ and workflow files — replaced by pipelines/garmin and .github/workflows/garmin.yml\n- Repository secrets (GARMIN_TOKENS, GARMIN_DISPLAY_NAME) and variables (GARMIN_ENABLED, GARMIN_TZ): set them again on the new repo\n- Indoor-activity routing that lived only in notes (e.g. Garmin "other" → Jog): add it to pipelines/garmin/mapping.json`);

fs.writeFileSync(path.join(OUT, 'MIGRATION-REPORT.md'), report.join('\n') + '\n');
console.log(`\nreport written to ${path.join(OUT, 'MIGRATION-REPORT.md')}`);
