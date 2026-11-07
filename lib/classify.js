/**
 * Classify log entries as cardio / strength / other for the weekly report
 * (spec §6.3). Uses the machine's log_type when the machine still exists.
 */
import { garminIdOf, zoneSeconds } from './log.js';

const CARDIO_LOG_TYPES = ['walk', 'pace', 'cardio', 'mins'];
/** Timed generic exercises that are not training (no day credit). */
export const NON_TRAINING = ['meditation', 'downward-dog'];
const OUTDOOR_ROOM = 'outdoor-activities';

/** Lookup of machines from loaded gyms: `${gym_id}:${machine_id}` and, as a fallback, `machine_id` (first gym wins). */
export function machineInfoMap(gyms) {
  const map = {};
  for (const g of gyms || []) for (const r of g.rooms || []) for (const m of r.machines || []) {
    const info = { log_type: m.log_type || 'weight', room_id: r.id, gym_id: g.id, name: m.name, hidden: !!m.hidden };
    map[`${g.id}:${m.id}`] = info;
    if (!map[m.id]) map[m.id] = info;
  }
  return map;
}

/** The machine info for an entry, or null when its machine no longer exists. */
export function machineInfo(map, e) {
  if (!map || !e) return null;
  return (e.gym_id && map[`${e.gym_id}:${e.machine_id}`]) || map[e.machine_id] || null;
}

const has = v => v != null && v !== '';

/** 'cardio' | 'strength' | 'other' */
export function classifyEntry(e, map) {
  const mi = machineInfo(map, e);
  if ([1, 2, 3, 4, 5].some(i => zoneSeconds(e, i) != null) || garminIdOf(e) || (has(e.hr_avg_bpm) && e.hr_avg_bpm > 0)
      || has(e.incline_pct) || has(e.speed_mph) || has(e.distance_mi)) return 'cardio';
  if (mi && CARDIO_LOG_TYPES.includes(mi.log_type)) return 'cardio';
  if (mi && mi.log_type === 'time' && mi.room_id === OUTDOOR_ROOM) return 'cardio';
  if (has(e.reps) || has(e.weight_lb)) return 'strength';
  if (mi && (mi.log_type === 'time' || mi.log_type === 'reps')) return NON_TRAINING.includes(e.machine_id) ? 'other' : 'strength';
  if (!mi && has(e.duration_sec)) return 'cardio'; // timed entry on a machine that no longer exists (old walks)
  return 'other';
}
