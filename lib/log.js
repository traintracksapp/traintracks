/**
 * The workout log: one entry per SET. Pure functions over the array.
 *
 * Entry shape (all fields optional except machineId/date/set):
 *   { id, machineId, machine, gymId, gym, roomId, room, date, datetime, set,
 *     weight, reps, duration, level, incline, hr, notes,
 *     zone1..zone5 (legacy Garmin-posted copy), garminId }
 *
 * Session identity = (gymId, machineId, date). Older rows have no gymId; a
 * session key falls back to machineId alone for those, so pre-2026-09 data
 * still edits correctly.
 */

const CARDIO_LOG_TYPES = ['walk', 'pace', 'cardio', 'mins'];
/** 'time'-logged generic exercises that are not training (no day credit). */
export const NON_TRAINING = ['meditation', 'downward-dog'];

let _seq = 0;
/** Short unique id for a new entry. */
export function newId(now) {
  const t = (now != null ? now : Date.now()).toString(36);
  const r = Math.floor(Math.random() * 46656).toString(36).padStart(3, '0');
  _seq = (_seq + 1) % 1296;
  return `e${t}${r}${_seq.toString(36).padStart(2, '0')}`;
}

/** True when `e` belongs to the session (gymId, machineId, date). */
export function inSession(e, s) {
  if (!e || e.machineId !== s.machineId || e.date !== s.date) return false;
  if (s.gymId && e.gymId && e.gymId !== s.gymId) return false;
  return true;
}

/** Entries of one session, sorted by set number. */
export function sessionEntries(log, s) {
  return (log || []).filter(e => inSession(e, s)).sort((a, b) => (a.set || 0) - (b.set || 0));
}

/** Newest-first by date; stable within a date (insertion order kept). */
export function sortLog(log) {
  return [...log].sort((a, b) => a.date < b.date ? 1 : a.date > b.date ? -1 : 0);
}

/**
 * Replace a session: remove every entry matching `from` (gymId, machineId,
 * date) and insert `newSets` as the session `to` (defaults to `from`, i.e. a
 * normal edit). Changing the date on an edit therefore MOVES the session —
 * the old date is cleared and nothing is duplicated.
 *
 * Unknown fields on the existing entries (id, garminId, anything a future
 * version adds) are carried over onto the replacement set with the same
 * index, so editing in the app never strips data it does not render.
 */
export function mergeSession(log, from, newSets, to) {
  to = to || from;
  const existing = sessionEntries(log, from);
  const kept = (log || []).filter(e => !inSession(e, from));
  // If moving onto a date that already has a session for this machine, that
  // session is replaced too (one session per machine per day).
  const rest = to.date !== from.date || to.gymId !== from.gymId ? kept.filter(e => !inSession(e, to)) : kept;
  const merged = newSets.map((s, i) => {
    const base = existing[i] ? { ...existing[i] } : {};
    const out = { ...base, ...s, set: i + 1, date: to.date, machineId: to.machineId };
    if (to.gymId) out.gymId = to.gymId;
    if (!out.id) out.id = newId();
    return out;
  });
  // Insert at the position of the first entry of that date block (keeps
  // "earliest set first within a day" for display) — append within the day.
  const idx = rest.findIndex(e => e.date < to.date);
  const dayEnd = (() => { let last = -1; rest.forEach((e, i) => { if (e.date === to.date) last = i; }); return last; })();
  const at = dayEnd >= 0 ? dayEnd + 1 : (idx < 0 ? rest.length : idx);
  return [...rest.slice(0, at), ...merged, ...rest.slice(at)];
}

/** Remove a session entirely. */
export function removeSession(log, s) {
  return (log || []).filter(e => !inSession(e, s));
}

/** Most recent session on a machine (optionally within a gym). */
export function lastSession(log, machineId, gymId) {
  const es = (log || []).filter(e => e.machineId === machineId && (!gymId || !e.gymId || e.gymId === gymId));
  if (!es.length) return null;
  const d = es.map(e => e.date).sort().pop();
  return es.filter(e => e.date === d).sort((a, b) => (a.set || 0) - (b.set || 0));
}

/** Distinct dates (newest first) a machine was logged. */
export function sessionDates(log, machineId, gymId) {
  const es = (log || []).filter(e => e.machineId === machineId && (!gymId || !e.gymId || e.gymId === gymId));
  return [...new Set(es.map(e => e.date))].sort().reverse();
}

/** Build machineId -> { logType, roomId, gymId, name, hidden } from the loaded gyms. */
export function machineInfoMap(gyms) {
  const map = {};
  (gyms || []).forEach(g => (g.rooms || []).forEach(r => (r.machines || []).forEach(m => {
    // first gym wins if an id is reused across gyms; key (gymId:machineId) is also stored
    if (!map[m.id]) map[m.id] = { logType: m.logType || 'weight', roomId: r.id, gymId: g.id, name: m.name, hidden: !!m.hidden };
    map[`${g.id}:${m.id}`] = { logType: m.logType || 'weight', roomId: r.id, gymId: g.id, name: m.name, hidden: !!m.hidden };
  })));
  return map;
}

export function machineInfo(info, e) {
  if (!info || !e) return null;
  return (e.gymId && info[`${e.gymId}:${e.machineId}`]) || info[e.machineId] || null;
}

/** 'cardio' | 'strength' | 'other' for one log entry. */
export function classifyEntry(e, info) {
  const mi = machineInfo(info, e);
  const hasZones = [1, 2, 3, 4, 5].some(i => e['zone' + i] != null);
  if (hasZones || garminIdOf(e) || (e.hr != null && e.hr > 0) || e.incline != null) return 'cardio';
  if (mi && CARDIO_LOG_TYPES.includes(mi.logType)) return 'cardio';
  if (mi && mi.logType === 'time' && mi.roomId === 'outdoor-activities') return 'cardio';
  if (e.reps != null || e.weight != null) return 'strength';
  if (mi && (mi.logType === 'time' || mi.logType === 'reps')) return NON_TRAINING.includes(e.machineId) ? 'other' : 'strength';
  if (!mi && e.duration != null) return 'cardio'; // legacy timed entry on a deleted machine
  return 'other';
}

const GARMIN_ID_RE = /Garmin(?:\s+[a-z]+)?\s+(\d{9,})/i;

/** Garmin activity id an entry is linked to: the garminId field, else the legacy "Garmin <id>" note tag. */
export function garminIdOf(e) {
  if (!e) return null;
  if (e.garminId != null && e.garminId !== '') return String(e.garminId);
  const m = GARMIN_ID_RE.exec(e.notes || '');
  return m ? m[1] : null;
}

/** Build a fresh entry from a form row. `ctx` = { gym, room, machine, date, datetime, notes }. */
export function buildEntry(ctx, fields, setNo) {
  return {
    id: newId(),
    machineId: ctx.machine.id, machine: ctx.machine.name,
    gymId: ctx.gym.id, gym: ctx.gym.name,
    roomId: ctx.room.id, room: ctx.room.name,
    date: ctx.date, datetime: ctx.datetime, set: setNo,
    weight: fields.weight ?? null, reps: fields.reps ?? null, duration: fields.duration ?? null,
    level: fields.level ?? null, incline: fields.incline ?? null, hr: fields.hr ?? null,
    notes: setNo === 1 ? (ctx.notes || '').trim() : ''
  };
}

/** Normalise an imported/legacy log: ensure ids, promote Garmin note tags to garminId. */
export function normaliseLog(log) {
  const seen = new Set();
  return (log || []).map(e => {
    const out = { ...e };
    if (!out.id || seen.has(out.id)) out.id = newId();
    seen.add(out.id);
    if ((out.garminId == null || out.garminId === '') && !out.garminId) {
      const gid = garminIdOf(out);
      if (gid) out.garminId = gid;
    }
    return out;
  });
}
