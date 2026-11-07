/**
 * The workout log (format version 2, docs/DATA-FORMAT.md): an array with one
 * entry per SET, newest date first. Pure functions only.
 *
 * A session is (gym_id, machine_id, date, variant). Old rows without gym_id
 * match on machine_id alone.
 */
import { toCSV } from './csv.js';
import { normalizeVariant, sameVariant } from './variant.js';

/** CSV columns, in order. `notes` is always last; new columns go before it. */
export const LOG_COLUMNS = [
  'id', 'date', 'time', 'gym_id', 'gym', 'room_id', 'room', 'machine_id', 'machine',
  'variant', 'set', 'weight_lb', 'reps', 'duration_sec', 'distance_mi', 'speed_mph',
  'level', 'incline_pct', 'hr_avg_bpm', 'garmin_id',
  'zone1_sec', 'zone2_sec', 'zone3_sec', 'zone4_sec', 'zone5_sec', 'notes'
];

/** The measurement fields each machine log_type records. */
export const LOG_TYPE_FIELDS = {
  weight: ['weight_lb', 'reps'],
  reps: ['reps'],
  time: ['duration_sec'],
  mins: ['duration_sec'],
  cardio: ['duration_sec', 'speed_mph', 'incline_pct', 'distance_mi', 'hr_avg_bpm'],
  pace: ['duration_sec', 'speed_mph', 'level', 'distance_mi', 'hr_avg_bpm'],
  walk: ['distance_mi', 'duration_sec', 'hr_avg_bpm']
};

/** Every measurement field, across all log types. */
export const MEASURE_FIELDS = [...new Set(Object.values(LOG_TYPE_FIELDS).flat())];

let seq = 0;
/** Short unique id for a new entry. */
export function newId(now = Date.now(), rand = Math.random) {
  seq = (seq + 1) % 1296;
  const r = Math.floor(rand() * 46656).toString(36).padStart(3, '0');
  return `e${now.toString(36)}${r}${seq.toString(36).padStart(2, '0')}`;
}

/** True when entry `e` belongs to session `s` = { gym_id, machine_id, date, variant }. */
export function inSession(e, s) {
  if (!e || e.machine_id !== s.machine_id || e.date !== s.date) return false;
  if (s.gym_id && e.gym_id && e.gym_id !== s.gym_id) return false;
  return sameVariant(e.variant, s.variant);
}

/** Entries of one session, sorted by set number. */
export function sessionEntries(log, s) {
  return (log || []).filter(e => inSession(e, s)).sort((a, b) => (a.set || 0) - (b.set || 0));
}

/** Newest date first; stable within a date. */
export function sortLog(log) {
  return [...(log || [])].sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0));
}

/**
 * Replace a session. Removes every entry of session `from` and inserts
 * `newSets` as session `to` (default: `from`). So saving never appends, and
 * changing the date (or variant) while editing MOVES the session. If `to`
 * already has entries (same machine, date and variant), they are replaced too.
 *
 * Each new set is laid over the existing entry with the same index, so fields
 * the form doesn't know (id, garmin_id, anything a later version adds)
 * survive. The form must pass every measurement field it shows, using null
 * for a cleared value.
 *
 * `newSets` may be empty, which deletes the session.
 */
export function mergeSession(log, from, newSets, to = from) {
  const target = { ...to, variant: normalizeVariant(to.variant) };
  const existing = sessionEntries(log, from);
  const rest = (log || []).filter(e => !inSession(e, from) && !inSession(e, target));
  const merged = (newSets || []).map((s, i) => {
    const out = { ...(existing[i] || {}), ...s };
    out.set = i + 1;
    out.date = target.date;
    out.machine_id = target.machine_id;
    if (target.gym_id) out.gym_id = target.gym_id;
    out.variant = target.variant;
    if (!out.id) out.id = newId();
    return out;
  });
  // Insert after the last entry of the same date, else before the first older date.
  let at = -1;
  rest.forEach((e, i) => { if (e.date === target.date) at = i + 1; });
  if (at < 0) { at = rest.findIndex(e => e.date < target.date); if (at < 0) at = rest.length; }
  return [...rest.slice(0, at), ...merged, ...rest.slice(at)];
}

/**
 * Move a session to another machine (e.g. a Garmin session posted to the wrong
 * gym). `to` = { gym_id, gym, room_id, room, machine_id, machine }. Every field
 * is kept (garmin_id, zones, notes); the date and variant stay. If the target
 * machine already has a session that day, the moved sets are added after its
 * sets instead of replacing them.
 */
export function moveSession(log, from, to) {
  const moving = sessionEntries(log, from);
  if (!moving.length) return log;
  const target = { gym_id: to.gym_id, machine_id: to.machine_id, date: from.date, variant: normalizeVariant(from.variant) };
  if (target.gym_id === from.gym_id && target.machine_id === from.machine_id) return log;
  const ids = new Set(moving.map(e => e.id));
  const already = sessionEntries(log, target).length;
  const moved = new Map(moving.map((e, i) => [e.id, { ...e, ...to, set: already + i + 1 }]));
  // Keep each moved row where it was in the log; only its machine changes.
  return (log || []).map(e => (ids.has(e.id) ? moved.get(e.id) : e));
}

/** Remove a session entirely. */
export function removeSession(log, s) {
  return (log || []).filter(e => !inSession(e, s));
}

function onMachine(log, machineId, gymId) {
  return (log || []).filter(e => e.machine_id === machineId && (!gymId || !e.gym_id || e.gym_id === gymId));
}

/**
 * The most recent session on a machine, for pre-filling the log form: the
 * latest one with the same variant if there is one, else the latest of any
 * variant. Returns its entries sorted by set, or null.
 */
export function lastSession(log, machineId, gymId, variant) {
  const all = onMachine(log, machineId, gymId);
  if (!all.length) return null;
  const same = variant === undefined ? all : all.filter(e => sameVariant(e.variant, variant));
  const pool = same.length ? same : all;
  const date = pool.map(e => e.date).sort().pop();
  const v = pool.find(e => e.date === date).variant;
  return pool.filter(e => e.date === date && sameVariant(e.variant, v)).sort((a, b) => (a.set || 0) - (b.set || 0));
}

/** Sessions on a machine, newest first: [{ date, variant, sets }]. A day with two variants is two sessions. */
export function machineSessions(log, machineId, gymId) {
  const out = [];
  for (const e of onMachine(log, machineId, gymId)) {
    const v = normalizeVariant(e.variant);
    if (!out.find(s => s.date === e.date && sameVariant(s.variant, v))) out.push({ date: e.date, variant: v });
  }
  out.sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0));
  return out.map(s => ({ ...s, sets: sessionEntries(log, { gym_id: gymId, machine_id: machineId, date: s.date, variant: s.variant }) }));
}

/** Distinct dates (newest first) a machine was logged. */
export function sessionDates(log, machineId, gymId) {
  return [...new Set(onMachine(log, machineId, gymId).map(e => e.date))].sort().reverse();
}

const GARMIN_TAG = /Garmin(?:\s+[a-z]+)?\s+(\d{9,})/i;

/** The Garmin activity id an entry is linked to: `garmin_id`, else a "Garmin <id>" tag in the notes. */
export function garminIdOf(e) {
  if (!e) return null;
  if (e.garmin_id != null && e.garmin_id !== '') return String(e.garmin_id);
  const m = GARMIN_TAG.exec(e.notes || '');
  return m ? m[1] : null;
}

/** The CSV export of a log (same order as the JSON). */
export function logToCSV(log) {
  return toCSV(log || [], LOG_COLUMNS);
}

/** The JSON text of a log, as committed. */
export function logToJSON(log) {
  return JSON.stringify(log || [], null, 2) + '\n';
}
