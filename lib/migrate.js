/**
 * Convert data from format version 1 (LogTrim, TrainTracks 0.1.0) to version 2
 * (docs/DATA-FORMAT.md). Pure functions: they never read or write a repo.
 * Every conversion is counted by rule so a person can check the result
 * before anything is written.
 */
import { timeFromLegacyDatetime } from './dates.js';
import { garminIdOf, newId } from './log.js';

/** camelCase → snake_case ("logType" → "log_type", "hrMin" → "hr_min"). */
export const snake = k => k.replace(/([a-z0-9])([A-Z])/g, '$1_$2').toLowerCase();

const num = v => {
  if (v == null || v === '') return null;
  const n = typeof v === 'number' ? v : Number(v);
  return isFinite(n) ? n : null;
};
const secFromMin = v => { const n = num(v); return n == null ? null : Math.round(n * 60); };

/** A version 1 gym.json → version 2 (snake_case keys). */
export function convertGym(g) {
  const out = {};
  for (const [k, v] of Object.entries(g)) {
    if (k === 'rooms') continue;
    out[snake(k)] = v;
  }
  out.rooms = (g.rooms || []).map(r => {
    const room = {};
    for (const [k, v] of Object.entries(r)) if (k !== 'machines') room[snake(k)] = v;
    room.machines = (r.machines || []).map(m => Object.fromEntries(Object.entries(m).map(([k, v]) => [snake(k), v])));
    return room;
  });
  return out;
}

/** TrainTracks 0.1.0's equipment/generic.local.json → version 2 (snake_case keys). */
export function convertLocalOverrides(local) {
  if (!local) return null;
  const conv = o => Object.fromEntries(Object.entries(o).map(([k, v]) => [snake(k), v]));
  return { ...conv(local), machines: (local.machines || []).map(conv), rooms: (local.rooms || []).map(conv) };
}

/**
 * Machine lookup from version 1 gyms plus 0.1.0's generic overrides:
 * `${gymId}:${machineId}` and `machineId` → { logType, roomId }.
 */
export function v1MachineTypes(gyms, local) {
  const map = {};
  const add = (gymId, roomId, m) => {
    const info = { logType: m.logType || 'weight', roomId };
    map[`${gymId}:${m.id}`] = info;
    if (!map[m.id]) map[m.id] = info;
  };
  for (const g of gyms || []) for (const r of g.rooms || []) for (const m of r.machines || []) add(g.id, r.id, m);
  for (const m of (local && local.machines) || []) add('generic', m.roomId, m);
  return map;
}

/**
 * Convert one version 1 entry. Returns { entry, rules } where `rules` names
 * each conversion applied (for the report).
 */
export function convertEntry(e, types) {
  const rules = [];
  const info = (e.gymId && types[`${e.gymId}:${e.machineId}`]) || types[e.machineId] || null;
  const logType = info ? info.logType : null;
  const fieldId = e.garminId != null && e.garminId !== '' ? String(e.garminId) : null;
  const tagId = garminIdOf({ notes: e.notes });
  const linked = !!(fieldId || tagId);
  const out = {};

  // Fields carried over, renamed to snake_case; measurements are handled below.
  const MEASURED = new Set(['weight', 'reps', 'duration', 'level', 'incline', 'hr', 'datetime', 'zone1', 'zone2', 'zone3', 'zone4', 'zone5']);
  for (const [k, v] of Object.entries(e)) if (!MEASURED.has(k)) out[snake(k)] = v;

  out.id = e.id || newId();
  if (!e.id) rules.push('id: added');
  out.time = timeFromLegacyDatetime(e.datetime);
  rules.push(out.time ? 'time: from datetime' : 'time: none');
  out.variant = [];

  out.weight_lb = num(e.weight);
  out.reps = num(e.reps);
  out.hr_avg_bpm = num(e.hr);
  out.incline_pct = num(e.incline);
  out.duration_sec = null;
  out.distance_mi = null;
  out.speed_mph = null;
  out.level = null;

  const lvl = num(e.level);
  if (num(e.duration) != null) {
    if (logType === 'time') { out.duration_sec = Math.round(num(e.duration)); rules.push('duration: seconds (time)'); }
    else { out.duration_sec = secFromMin(e.duration); rules.push(`duration: minutes → seconds (${logType || 'unknown machine'})`); }
  }
  if (lvl != null) {
    let field;
    if (logType === 'walk') field = 'distance_mi';
    else if (logType === 'cardio') field = linked ? 'distance_mi' : 'speed_mph';
    else if (logType === 'pace') field = linked ? 'distance_mi' : 'level';
    else if (!logType) field = 'level'; // meaning unknown (early rows used pace or distance): kept as is, reported
    else field = 'level';
    out[field] = lvl;
    rules.push(`level → ${field} (${logType || 'unknown machine'}${logType === 'cardio' || logType === 'pace' ? (linked ? ', Garmin-linked' : ', hand-logged') : ''})`);
  }
  for (let i = 1; i <= 5; i++) {
    const z = secFromMin(e['zone' + i]);
    if (z != null) out[`zone${i}_sec`] = z;
  }
  if ([1, 2, 3, 4, 5].some(i => num(e['zone' + i]) != null)) rules.push('zones: minutes → seconds');

  if (fieldId) out.garmin_id = fieldId;
  else if (tagId) { out.garmin_id = tagId; rules.push('garmin_id: from notes tag'); }

  if (!logType) rules.push('machine: not found in any gym');
  for (const f of ['weight_lb', 'reps', 'duration_sec', 'distance_mi', 'speed_mph', 'hr_avg_bpm']) {
    if (out[f] != null && out[f] < 0) rules.push(`unusual: negative ${f}`);
  }
  return { entry: out, rules };
}

/**
 * Convert a whole version 1 log. Returns { log, counts, unknownMachines, problems }.
 * The result has exactly one entry per input entry, in the same order.
 */
export function convertLog(log, gyms, local) {
  const types = v1MachineTypes(gyms, local);
  const counts = {};
  const unknownMachines = {};
  const problems = [];
  const seen = new Set();
  const out = (log || []).map((e, i) => {
    const { entry, rules } = convertEntry(e, types);
    for (const r of rules) counts[r] = (counts[r] || 0) + 1;
    const unusual = rules.filter(r => r.startsWith('unusual: '));
    if (unusual.length) problems.push(`${entry.date} ${entry.machine} (${entry.gym || '?'}) set ${entry.set}: ${unusual.map(r => r.slice(9)).join(', ')} — kept as is`);
    if (rules.includes('machine: not found in any gym')) {
      const key = `${e.machine} (${e.gym || '?'}, id ${e.machineId})`;
      unknownMachines[key] = (unknownMachines[key] || 0) + 1;
    }
    if (seen.has(entry.id)) { problems.push(`duplicate id ${entry.id} at row ${i}; given a new id`); entry.id = newId(); }
    seen.add(entry.id);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(entry.date || '')) problems.push(`row ${i}: bad date ${JSON.stringify(entry.date)}`);
    return entry;
  });
  return { log: out, counts, unknownMachines, problems };
}
