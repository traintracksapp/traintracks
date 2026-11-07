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
    else if (logType === 'pace') field = linked ? 'distance_mi' : 'speed_mph'; // LogTrim's form labelled it MPH
    else if (!logType) field = 'level'; // meaning unknown (early rows used pace or distance): kept as is, reported
    else field = 'level';
    out[field] = lvl;
    rules.push(`level → ${field} (${logType || 'unknown machine'}${logType === 'cardio' || logType === 'pace' ? (linked ? ', Garmin-linked' : ', hand-logged') : ''})`);
  }
  for (let i = 1; i <= 5; i++) {
    const z = num(e['zone' + i]);
    if (z != null) out[`zone${i}_min`] = Math.round(z * 100) / 100;
  }
  if ([1, 2, 3, 4, 5].some(i => num(e['zone' + i]) != null)) rules.push('zones: minutes (2 decimals)');

  if (fieldId) out.garmin_id = fieldId;
  else if (tagId) { out.garmin_id = tagId; rules.push('garmin_id: from notes tag'); }

  if (!logType) rules.push('machine: not found in any gym');
  // Negative weight_lb is valid: assistance on an assisted machine (see docs/DATA-FORMAT.md).
  for (const f of ['reps', 'duration_sec', 'distance_mi', 'speed_mph', 'hr_avg_bpm']) {
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

/**
 * Apply an owner's corrections to a converted (version 2) log. The
 * corrections file is personal (it names the owner's machines), so it is kept
 * outside the repo and passed in. Shape:
 *
 *   {
 *     "remap": [ { "machine_id": "m123", "to": "generic:walk", "level_is_pace": true } ],
 *     "negative_reps": { "generic:pull-ups": "generic:negative-pullups" }
 *   }
 *
 * - remap: move every entry on `machine_id` to the machine `to` (gym_id:machine_id),
 *   taking its gym/room/machine names from `gyms`. The old location is kept in
 *   `migrated_from` (JSON only). With `level_is_pace`, a `level` that was pace in
 *   min/mi becomes `distance_mi` = minutes ÷ pace, and the note says so.
 * - negative_reps: entries on the first machine with negative reps move to the
 *   second, with the reps made positive (e.g. negative pull-ups).
 * Sessions touched are renumbered 1..n in log order.
 * Returns { log, counts, problems }.
 */
export function applyFixups(log, fixups, gyms) {
  const counts = {};
  const problems = [];
  const bump = k => { counts[k] = (counts[k] || 0) + 1; };
  const machines = {};
  for (const g of gyms || []) for (const r of g.rooms || []) for (const m of r.machines || []) {
    machines[`${g.id}:${m.id}`] = { gym_id: g.id, gym: g.name, room_id: r.id, room: r.name, machine_id: m.id, machine: m.name };
  }
  const target = key => {
    const t = machines[key];
    if (!t) problems.push(`corrections: machine ${key} not found in the gyms`);
    return t;
  };
  const remaps = new Map();
  for (const r of (fixups && fixups.remap) || []) {
    const t = target(r.to);
    if (t) remaps.set(r.machine_id, { ...r, t });
  }
  const neg = Object.entries((fixups && fixups.negative_reps) || {}).map(([from, to]) => ({ from, t: target(to) })).filter(x => x.t);
  const touched = new Set();
  const key = e => `${e.gym_id}|${e.machine_id}|${e.date}|${(e.variant || []).join(';')}`;
  const moveTo = (e, t, why) => {
    touched.add(key(e));
    if (!e.migrated_from) e.migrated_from = `${e.machine} @ ${e.gym || '?'} (${e.machine_id})`;
    Object.assign(e, t);
    touched.add(key(e));
    bump(why);
  };

  const out = (log || []).map(orig => {
    const e = { ...orig };
    const r = remaps.get(e.machine_id);
    if (r) {
      moveTo(e, r.t, `moved to ${r.to}`);
      if (r.level_is_pace && e.level != null) {
        if (e.level > 0 && e.duration_sec > 0) {
          const pace = e.level;
          e.distance_mi = Math.round((e.duration_sec / 60 / pace) * 100) / 100;
          e.level = null;
          e.notes = `${e.notes ? e.notes + ' ' : ''}(distance estimated from a pace of ${pace} min/mi)`.trim();
          bump('pace → estimated distance');
        } else problems.push(`${e.date} ${e.machine}: level ${e.level} looks like pace but there is no duration; kept as level`);
      }
    }
    for (const n of neg) {
      if (`${e.gym_id}:${e.machine_id}` === n.from && e.reps != null && e.reps < 0) {
        e.reps = -e.reps;
        moveTo(e, n.t, `negative reps → ${n.t.gym_id}:${n.t.machine_id}`);
      }
    }
    return e;
  });

  const seq = {};
  for (const e of out) {
    const k = key(e);
    if (!touched.has(k)) continue;
    seq[k] = (seq[k] || 0) + 1;
    e.set = seq[k];
  }
  return { log: out, counts, problems };
}

// ---- goals.json, profile.json, suggested-workout.json ----

/** Version 1 wellness column → version 2 column and how its values change. */
export const WELLNESS_FIELD_MAP = {
  steps: ['steps', 1], distance_miles: ['distance_mi', 1], floors: ['floors', 1], resting_hr: ['resting_hr_bpm', 1],
  active_calories: ['active_kcal', 1], total_calories: ['total_kcal', 1], avg_stress: ['stress_avg', 1],
  body_battery_high: ['body_battery_high', 1], body_battery_low: ['body_battery_low', 1],
  intensity_moderate_min: ['intensity_moderate_sec', 60], intensity_vigorous_min: ['intensity_vigorous_sec', 60],
  sleep_hours: ['sleep_sec', 3600], sleep_score: ['sleep_score', 1], deep_sleep_min: ['sleep_deep_sec', 60],
  light_sleep_min: ['sleep_light_sec', 60], rem_sleep_min: ['sleep_rem_sec', 60], awake_min: ['sleep_awake_sec', 60],
  sleep_respiration: ['sleep_respiration_brpm', 1], sleep_spo2: ['sleep_spo2_pct', 1], hrv_last_night: ['hrv_ms', 1],
  hrv_status: ['hrv_status', 1], vo2max: ['vo2max', 1]
};

/**
 * Version 1 goals.json → version 2. Targets move to the stored unit of their
 * field (hours and minutes → seconds); `display` remembers how to show them.
 * Returns { goals, notes }.
 */
export function convertGoals(v1) {
  const notes = [];
  if (!v1 || typeof v1 !== 'object') return { goals: null, notes };
  const out = { week_start: v1.weekStart || 'mon' };
  if (Array.isArray(v1.hrZones)) out.hr_zones_bpm = v1.hrZones;
  out.goals = (v1.goals || []).map(g => {
    const n = {};
    for (const [k, v] of Object.entries(g)) {
      if (['machineIds', 'hrMin', 'hrMax', 'unit', 'field', 'target'].includes(k)) continue;
      n[snake(k)] = v;
    }
    if (g.machineIds) n.machine_ids = g.machineIds;
    let target = Number(g.target) || 0;
    if (g.hrMin != null || g.hrMax != null) {
      if (g.hrMin != null) n.hr_min_bpm = g.hrMin;
      if (g.hrMax != null) n.hr_max_bpm = g.hrMax;
      target *= 60; n.display = 'min';
    } else if (g.field) {
      if (g.source === 'wellness') {
        const [f, mult] = WELLNESS_FIELD_MAP[g.field] || [g.field, 1];
        n.field = f; target *= mult;
        if (mult === 3600) n.display = 'h'; else if (mult === 60) n.display = 'min';
        if (!WELLNESS_FIELD_MAP[g.field]) notes.push(`goal "${g.label}": unknown wellness field ${g.field}, kept`);
      } else if (/^zone[1-5]$/.test(g.field)) {
        n.field = `${g.field}_min`; target *= 60; n.display = 'min';
      } else if (g.field === 'duration') {
        n.field = 'duration_sec';
        if (g.unit === 's') n.display = 's';
        else { target *= 60; n.display = 'min'; notes.push(`goal "${g.label}": duration taken as minutes`); }
      } else if (g.field === 'weight') n.field = 'weight_lb';
      else if (g.field === 'hr') n.field = 'hr_avg_bpm';
      else n.field = g.field;
    }
    n.target = Math.round(target * 10) / 10;
    return n;
  });
  return { goals: out, notes };
}

/** Version 1 profile.json → version 2 (snake_case keys). */
export function convertProfile(v1) {
  if (!v1 || typeof v1 !== 'object') return {};
  return Object.fromEntries(Object.entries(v1).map(([k, v]) => [snake(k), v]));
}

/**
 * Version 1 suggested-workout.json → version 2. Set durations were seconds
 * for timed holds and minutes otherwise; `types` (from v1MachineTypes) decides.
 */
export function convertPlan(v1, types = {}) {
  if (!v1 || typeof v1 !== 'object') return null;
  const out = {};
  for (const [k, v] of Object.entries(v1)) if (k !== 'exercises') out[snake(k)] = v;
  out.exercises = (Array.isArray(v1.exercises) ? v1.exercises : []).map(e => {
    if (!e || typeof e !== 'object') return e;
    const n = {};
    for (const [k, v] of Object.entries(e)) if (k !== 'sets') n[snake(k)] = v;
    const info = (e.gymId && types[`${e.gymId}:${e.machineId}`]) || types[e.machineId] || null;
    const lt = info ? info.logType : null;
    n.sets = (Array.isArray(e.sets) ? e.sets : []).map(s => {
      const o = { set: s.set };
      if (s.weight != null) o.weight_lb = s.weight;
      if (s.reps != null) o.reps = s.reps;
      if (s.duration != null) o.duration_sec = lt === 'time' || s.unit === 'sec' ? s.duration : Math.round(s.duration * 60);
      if (s.incline != null) o.incline_pct = s.incline;
      if (s.level != null) o[lt === 'walk' ? 'distance_mi' : lt === 'cardio' || lt === 'pace' ? 'speed_mph' : 'level'] = s.level;
      return o;
    });
    return n;
  });
  return out;
}

// ---- Garmin files ----
import { parseCSV, toCSV } from './csv.js';

const BUCKET_V1 = /^hr(_under\d+|\d+_\d+|\d+_up)$/;
const r0 = v => (v === '' || v == null || isNaN(Number(v)) ? '' : String(Math.round(Number(v))));
const times = (v, k) => (v === '' || v == null || isNaN(Number(v)) ? '' : String(Math.round(Number(v) * k * 100) / 100));

/** Version 1 cardio-minutes.csv → version 2 (hr_avg_bpm, covered_sec in whole seconds). */
export function convertCardioMinutesCSV(text) {
  const cols = ['date', 'activity_id', 'activity_type', 'minute', 'hr_avg_bpm', 'covered_sec'];
  const rows = parseCSV(text).map(r => ({ ...r, hr_avg_bpm: r.avg_hr_weighted ?? r.hr_avg_bpm, covered_sec: r.seconds_covered != null ? r0(r.seconds_covered) : r.covered_sec }));
  return toCSV(rows, cols);
}

/** Version 1 cardio-buckets.csv → version 2 (minutes → whole seconds). The next Garmin run rebuilds it anyway. */
export function convertBucketsCSV(text) {
  const rows = parseCSV(text);
  if (!rows.length) return text;
  const v1cols = Object.keys(rows[0]);
  const bcols = v1cols.filter(c => BUCKET_V1.test(c));
  const cols = ['date', 'start', 'activity_id', 'activity_type', 'duration_sec', 'hr_avg_bpm', 'hr_max_minute_bpm', 'corrected', ...bcols.map(c => `${c}_sec`)];
  return toCSV(rows.map(r => {
    const o = { date: r.date, start: r.start, activity_id: r.activity_id, activity_type: r.activity_type, duration_sec: r0((Number(r.minutes) || 0) * 60),
      hr_avg_bpm: r.avg_hr, hr_max_minute_bpm: r.max_minute_hr, corrected: r.corrected };
    for (const c of bcols) o[`${c}_sec`] = r[c] === '' ? '' : r0(Number(r[c]) * 60);
    return o;
  }), cols);
}

/** Version 1 daily-wellness.csv → version 2 (renamed columns, hours and minutes → seconds). */
export function convertWellnessCSV(text) {
  const rows = parseCSV(text);
  const cols = ['date', ...Object.values(WELLNESS_FIELD_MAP).map(([c]) => c)];
  return toCSV(rows.map(r => {
    const o = { date: r.date };
    for (const [old, [neu, mult]] of Object.entries(WELLNESS_FIELD_MAP)) {
      const v = r[old] ?? r[neu] ?? '';
      o[neu] = mult === 1 || v === '' ? v : mult === 3600 ? r0(Number(v) * 3600) : times(v, mult);
    }
    return o;
  }), cols);
}

/** zones.json { rhr, hrmax, sinceDays } → { rhr_bpm, hr_max_bpm, since_days }. */
export function convertZones(z) {
  if (!z || typeof z !== 'object') return z;
  const out = {};
  for (const [k, v] of Object.entries(z)) {
    if (k === 'rhr') out.rhr_bpm = v;
    else if (k === 'hrmax') out.hr_max_bpm = v;
    else out[snake(k)] = v;
  }
  return out;
}

/** corrections.json: set_hr { hr } → { hr_bpm }; add { minutes, hr } → { duration_sec, hr_bpm }. */
export function convertCorrections(c) {
  if (!c || typeof c !== 'object') return c;
  const out = {};
  for (const [id, v] of Object.entries(c)) {
    if (id.startsWith('_') || !v || typeof v !== 'object') { out[id] = v; continue; }
    const n = { ...v };
    if (Array.isArray(v.set_hr)) n.set_hr = v.set_hr.map(s => { const { hr, ...rest } = s; return { ...rest, hr_bpm: s.hr_bpm ?? hr }; });
    if (Array.isArray(v.add)) n.add = v.add.map(a => ({ duration_sec: a.duration_sec ?? Math.round(Number(a.minutes) * 60), hr_bpm: a.hr_bpm ?? a.hr }));
    out[id] = n;
  }
  return out;
}

/** mapping.json values → snake_case keys. */
export function convertMapping(m) {
  if (!m || typeof m !== 'object') return m;
  return Object.fromEntries(Object.entries(m).map(([k, v]) => [k, v && typeof v === 'object' ? Object.fromEntries(Object.entries(v).map(([a, b]) => [snake(a), b])) : v]));
}

// ---- side effects of moving rows off a machine (corrections file `remap`) ----

/** Remove machines that rows were moved off from the user's additions to the common gym. */
export function dropRemappedLocalMachines(local, ids) {
  if (!local) return local;
  const gone = new Set(ids);
  return { ...local, machines: (local.machines || []).filter(m => !gone.has(m.id)), hidden: (local.hidden || []).filter(id => !gone.has(id)) };
}

/** Point mapping.json entries at the machine rows were moved to. `targets`: { old machine id → { gym_id, gym, room_id, room, machine_id, machine } }. */
export function remapMapping(mapping, targets) {
  if (!mapping) return mapping;
  return Object.fromEntries(Object.entries(mapping).map(([k, v]) => {
    const t = v && typeof v === 'object' && targets[v.machine_id];
    return [k, t ? { ...v, ...t } : v];
  }));
}

// ---- 0.2.0 → 0.2.1: heart-rate zones in minutes ----

/**
 * Log rows written by 0.2.0 carry zone{i}_sec; from 0.2.1 zones are zone{i}_min
 * (minutes, 2 decimals). Renames in place, keeping each entry's key order and
 * every other field. → { log, changed } (changed = number of entries).
 */
export function zonesToMinutes(log) {
  let changed = 0;
  const out = (log || []).map(e => {
    if (!e || ![1, 2, 3, 4, 5].some(i => `zone${i}_sec` in e)) return e;
    changed++;
    const n = {};
    for (const [k, v] of Object.entries(e)) {
      const m = /^zone([1-5])_sec$/.exec(k);
      if (!m) { n[k] = v; continue; }
      const key = `zone${m[1]}_min`;
      if (key in e) continue; // already has minutes: they win
      n[key] = v == null || v === '' || isNaN(+v) ? v : Math.round(+v / 60 * 100) / 100;
    }
    return n;
  });
  return { log: out, changed };
}

/** goals.json: sum goals on zone{i}_sec → zone{i}_min (targets stay in seconds). → { goals, changed } */
export function zoneGoalsToMinutes(goals) {
  if (!goals || !Array.isArray(goals.goals)) return { goals, changed: 0 };
  let changed = 0;
  const list = goals.goals.map(g => {
    const m = g && /^zone([1-5])_sec$/.exec(g.field || '');
    if (!m) return g;
    changed++;
    return { ...g, field: `zone${m[1]}_min` };
  });
  return { goals: { ...goals, goals: list }, changed };
}
