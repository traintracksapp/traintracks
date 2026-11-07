/**
 * Weekly goals and the report behind them (spec §8; format version 2).
 *
 *   goals.json         { week_start, hr_zones_bpm, goals: [goal] }
 *   workout-log.json   one entry per set
 *   daily-wellness.csv optional; one row per complete Garmin day
 *   cardio-buckets.csv optional; one row per Garmin activity, 5-bpm buckets in seconds
 *
 * goal: { id, label, kind: 'sum'|'days'|'avg', source: 'log'|'wellness', field,
 *         machine_ids, variants, exclude_variants, filter: 'cardio'|'strength'|'any',
 *         hr_min_bpm, hr_max_bpm, target, display: 'h'|'min'|'s', direction: 'above'|'below' }
 *
 * Values and targets are in the field's own unit (durations in seconds);
 * `display` only says how to show them. Heart rate is stored as neutral
 * buckets; zones and HR-range time are computed here, when shown.
 */
import { weekBounds, inRange, toDate, fmtShortDate } from './dates.js';
import { garminIdOf, zoneSeconds } from './log.js';
import { machineInfoMap, classifyEntry } from './classify.js';
import { hasAllTags, hasAnyTag } from './variant.js';
import { parseCSV } from './csv.js';

const num = v => { const n = Number(v); return v == null || v === '' || isNaN(n) ? 0 : n; };
const round1 = v => Math.round(v * 10) / 10;
/** Round a stored value to one decimal of its display unit (h → 360 s, min → 6 s). */
export const roundForDisplay = (v, display) => (display === 'h' ? Math.round(v / 360) * 360 : display === 'min' ? Math.round(v / 6) * 6 : round1(v));

/** A CSV of numbers (wellness): numeric cells → numbers, blanks → null, other text kept. */
export function parseNumericCSV(text) {
  return parseCSV(text).map(r => Object.fromEntries(Object.entries(r).map(([k, v]) => {
    if (v === '') return [k, null];
    const n = Number(v);
    return [k, k !== 'date' && !isNaN(n) ? n : v];
  })));
}
export const parseWellnessCSV = parseNumericCSV;

// ---- heart-rate buckets ----

/** Bucket column → { lo, hi, open } (hi exclusive), or null. Columns are in seconds. */
export function bucketColumn(name) {
  let m;
  if ((m = /^hr_under(\d+)_sec$/.exec(name))) return { lo: +m[1] - 5, hi: +m[1], open: 'low' };
  if ((m = /^hr(\d+)_up_sec$/.exec(name))) return { lo: +m[1], hi: +m[1] + 5, open: 'high' };
  if ((m = /^hr(\d+)_(\d+)_sec$/.exec(name))) return { lo: +m[1], hi: +m[2] + 1, open: null };
  return null;
}

/** cardio-buckets.csv → { activity_id: { id, date, start, type, duration_sec, hr_avg_bpm, hr_max_bpm, corrected, bins: [{lo, hi, open, sec}] } } */
export function parseBucketsCSV(text) {
  const map = {};
  for (const r of parseCSV(text)) {
    const id = r.activity_id;
    if (!id) continue;
    const bins = [];
    for (const [k, v] of Object.entries(r)) {
      const b = bucketColumn(k);
      if (b && num(v) > 0) bins.push({ ...b, sec: num(v) });
    }
    map[id] = { id, date: r.date || '', start: r.start || '', type: r.activity_type || '', duration_sec: num(r.duration_sec),
      hr_avg_bpm: num(r.hr_avg_bpm), hr_max_bpm: num(r.hr_max_minute_bpm), corrected: r.corrected === 'y', bins };
  }
  return map;
}

/** Seconds between lo (inclusive) and hi (exclusive) bpm; either may be null. An edge inside a bucket takes a proportional share. */
export function hrRangeSeconds(row, lo, hi) {
  if (!row || !row.bins) return 0;
  const a = lo == null || lo === '' ? -Infinity : Number(lo);
  const b = hi == null || hi === '' ? Infinity : Number(hi);
  let total = 0;
  for (const bin of row.bins) {
    const blo = bin.open === 'low' && a === -Infinity ? -Infinity : bin.lo;
    const bhi = bin.open === 'high' && b === Infinity ? Infinity : bin.hi;
    const from = Math.max(a, blo), to = Math.min(b, bhi);
    if (to <= from) continue;
    const width = bhi - blo;
    total += width === Infinity ? bin.sec : bin.sec * (to - from) / width;
  }
  return total;
}

export function cleanFloors(floors) {
  if (!Array.isArray(floors)) return [];
  const fl = floors.map(Number).filter(n => n > 0);
  for (let i = 1; i < fl.length; i++) if (fl[i] <= fl[i - 1]) return [];
  return fl;
}

/** { below, zones: [...] } in seconds for one activity, given ascending zone floors (bpm). */
export function zonesFromBuckets(row, floors) {
  const fl = cleanFloors(floors);
  if (!row || !fl.length) return null;
  return { below: hrRangeSeconds(row, null, fl[0]), zones: fl.map((f, i) => hrRangeSeconds(row, f, i + 1 < fl.length ? fl[i + 1] : null)) };
}

export const isHrRangeGoal = g => !!g && g.kind === 'sum' && (g.hr_min_bpm != null || g.hr_max_bpm != null);

export function hrRangeText(lo, hi) {
  const a = lo == null || lo === '' ? null : Number(lo), b = hi == null || hi === '' ? null : Number(hi);
  if (a == null && b == null) return 'any heart rate';
  if (a == null) return `under ${b} bpm`;
  if (b == null) return `${a}+ bpm`;
  return `${a}–${b - 1} bpm`;
}

// ---- the weekly computation ----

/**
 * A log field's value for a sum goal. Zone fields are stored in minutes
 * (`zone2_min`) but goal targets for time are in seconds, so zones are read as
 * seconds; `zone2_sec` (goals and rows from before 0.2.1) means the same.
 */
export function logFieldValue(e, field) {
  const z = /^zone([1-5])_(?:min|sec)$/.exec(field || '');
  return z ? zoneSeconds(e, +z[1]) || 0 : num(e[field]);
}

/** Does a log entry count toward a machine goal (machine and variant filters)? */
export function entryMatchesGoal(e, goal) {
  const ids = goal.machine_ids && goal.machine_ids.length ? goal.machine_ids : null;
  if (ids && !ids.includes(e.machine_id)) return false;
  if (goal.variants && goal.variants.length && !hasAllTags(e.variant, goal.variants)) return false;
  if (goal.exclude_variants && goal.exclude_variants.length && hasAnyTag(e.variant, goal.exclude_variants)) return false;
  return true;
}

/**
 * ctx: { log, wellness, buckets, gyms, week_start, today, offset }
 * → { start, end, isCurrent, daysElapsed, results: [goal + { value, status, expected, pct, items, note, daysWithData }] }
 */
export function computeGoals(goals, ctx) {
  const today = ctx.today;
  const b = weekBounds(today, ctx.week_start || 'mon', ctx.offset || 0);
  const isCurrent = inRange(today, b);
  const daysElapsed = isCurrent ? Math.round((toDate(today) - toDate(b.start)) / 86400000) + 1 : b.start > today ? 0 : 7;
  const info = machineInfoMap(ctx.gyms);
  const log = (ctx.log || []).filter(e => inRange(e.date, b));
  const wellness = (ctx.wellness || []).filter(r => inRange(r.date, b));
  const buckets = ctx.buckets || {};
  const haveBuckets = Object.keys(buckets).length > 0;

  const results = (goals || []).map(goal => {
    const r = { ...goal, value: 0, items: [], daysWithData: null, note: '' };
    r.direction = goal.direction || 'above';
    r.source = goal.source || 'log';

    if (r.source === 'wellness') {
      const rows = wellness.filter(w => num(w[goal.field]) > 0).sort((x, y) => (x.date < y.date ? -1 : 1));
      r.daysWithData = rows.length;
      r.items = rows.map(w => ({ date: w.date, label: fmtShortDate(w.date), value: num(w[goal.field]) }));
      // An average is judged at the precision it is shown with (0.1 h, 0.1 min, 0.1), so "7.1 h" vs a 7.1 h target is a hit.
      if (goal.kind === 'avg') r.value = rows.length ? roundForDisplay(rows.reduce((s, w) => s + num(w[goal.field]), 0) / rows.length, goal.display) : null;
      else {
        r.value = rows.reduce((s, w) => s + num(w[goal.field]), 0);
        const expectedDays = isCurrent ? daysElapsed : 7;
        if (rows.length < expectedDays) r.note = `${rows.length} of ${expectedDays} day${expectedDays === 1 ? '' : 's'} synced`;
      }
    } else if (goal.kind === 'days') {
      const want = goal.filter || 'any';
      const byDate = {};
      for (const e of log) {
        const c = classifyEntry(e, info);
        if (want !== 'any' && c !== want) continue;
        if (want === 'any' && c === 'other') continue;
        (byDate[e.date] = byDate[e.date] || new Set()).add(e.machine || e.machine_id);
      }
      const dates = Object.keys(byDate).sort();
      r.value = dates.length;
      r.items = dates.map(d => ({ date: d, label: fmtShortDate(d), value: null, detail: [...byDate[d]].join(', ') }));
    } else if (isHrRangeGoal(goal)) {
      const byDate = {}, seen = new Set();
      for (const e of log) {
        const id = garminIdOf(e);
        if (!id || seen.has(id) || !buckets[id]) continue;
        seen.add(id);
        const v = hrRangeSeconds(buckets[id], goal.hr_min_bpm, goal.hr_max_bpm);
        if (!v) continue;
        const d = byDate[e.date] = byDate[e.date] || { value: 0, names: new Set() };
        d.value += v; d.names.add(e.machine || e.machine_id);
      }
      const dates = Object.keys(byDate).sort();
      r.value = round1(dates.reduce((s, d) => s + byDate[d].value, 0));
      r.items = dates.map(d => ({ date: d, label: fmtShortDate(d), value: round1(byDate[d].value), detail: [...byDate[d].names].join(', ') }));
      if (!haveBuckets) r.note = 'needs cardio-buckets.csv';
      else {
        const unlinked = Object.keys(buckets).filter(id => inRange(buckets[id].date, b) && !seen.has(id)).length;
        if (unlinked) r.note = `${unlinked} Garmin activit${unlinked === 1 ? 'y' : 'ies'} not in the log`;
      }
    } else {
      const ids = goal.machine_ids && goal.machine_ids.length;
      const byDate = {};
      for (const e of log) {
        if (!entryMatchesGoal(e, goal)) continue;
        const v = logFieldValue(e, goal.field);
        if (!v) continue;
        const d = byDate[e.date] = byDate[e.date] || { value: 0, sets: 0, names: new Set() };
        d.value += v; d.sets += 1; d.names.add(e.machine || e.machine_id);
      }
      const dates = Object.keys(byDate).sort();
      r.value = round1(dates.reduce((s, d) => s + byDate[d].value, 0));
      r.items = dates.map(d => ({ date: d, label: fmtShortDate(d), value: round1(byDate[d].value),
        detail: ids ? `${byDate[d].sets} set${byDate[d].sets === 1 ? '' : 's'}` : [...byDate[d].names].join(', ') }));
    }

    // ---- status and pace ----
    const t = num(goal.target);
    if (goal.kind === 'avg') {
      if (r.value == null) r.status = 'nodata';
      else r.status = (r.direction === 'below' ? r.value <= t : r.value >= t) ? 'hit' : 'miss';
      r.pct = r.value == null ? 0 : Math.min(1, r.direction === 'below' ? (r.value ? t / r.value : 1) : r.value / t);
    } else {
      const paceDays = r.source === 'wellness' && r.daysWithData != null ? Math.min(r.daysWithData, isCurrent ? daysElapsed : 7) : isCurrent ? daysElapsed : 7;
      r.expected = round1(t * paceDays / 7);
      r.pct = t ? Math.min(1, r.value / t) : 0;
      if (r.value >= t) r.status = 'hit';
      else if (!isCurrent) r.status = r.source === 'wellness' && paceDays < 7 && r.value >= r.expected ? 'onpace' : 'miss';
      else r.status = r.value >= r.expected ? 'onpace' : 'behind';
    }
    return r;
  });

  return { start: b.start, end: b.end, isCurrent, daysElapsed, results };
}

/** A goal value for display, using the goal's `display` unit: "41,913", "7.6 h", "45 min", "315 s". */
export function fmtGoalNum(v, display) {
  if (v == null) return '—';
  let n = Number(v), suffix = '';
  if (display === 'h') { n /= 3600; suffix = ' h'; }
  else if (display === 'min') { n /= 60; suffix = ' min'; }
  else if (display === 's') suffix = ' s';
  const s = Math.abs(n) >= 1000 ? Math.round(n).toLocaleString('en-US') : Number.isInteger(n) ? String(n) : n.toFixed(1);
  return s + suffix;
}

/** Display units → stored units, for the goals editor: 7.5 h → 27000. */
export const toStored = (v, display) => (display === 'h' ? Math.round(v * 3600) : display === 'min' ? Math.round(v * 60) : v);
export const fromStored = (v, display) => (display === 'h' ? round1(v / 3600) : display === 'min' ? round1(v / 60) : v);

/** Goals shown before the user sets any. */
export function defaultGoals() {
  return {
    week_start: 'mon',
    goals: [
      { id: 'cardio_days', label: 'Days with cardio', kind: 'days', source: 'log', filter: 'cardio', target: 3 },
      { id: 'strength_days', label: 'Days with strength', kind: 'days', source: 'log', filter: 'strength', target: 2 }
    ]
  };
}

/** Presets in the goals editor. `pick` = choose machines; `pick_hr` = choose a heart-rate range. Targets in stored units. */
export const GOAL_PRESETS = [
  { label: 'Days with cardio', kind: 'days', source: 'log', filter: 'cardio', target: 3 },
  { label: 'Days with strength', kind: 'days', source: 'log', filter: 'strength', target: 2 },
  { label: 'Days with any workout', kind: 'days', source: 'log', filter: 'any', target: 4 },
  { label: 'Time in a heart-rate range…', kind: 'sum', source: 'log', hr_min_bpm: 120, hr_max_bpm: 130, target: 2700, display: 'min', pick_hr: true },
  { label: 'Reps of an exercise…', kind: 'sum', source: 'log', field: 'reps', machine_ids: [], target: 100, pick: true },
  { label: 'Seconds of an exercise…', kind: 'sum', source: 'log', field: 'duration_sec', machine_ids: [], target: 300, display: 's', pick: true },
  { label: 'Total steps', kind: 'sum', source: 'wellness', field: 'steps', target: 70000 },
  { label: 'Average sleep', kind: 'avg', source: 'wellness', field: 'sleep_sec', target: 25200, display: 'h' },
  { label: 'Average HRV', kind: 'avg', source: 'wellness', field: 'hrv_ms', target: 40 },
  { label: 'Average resting heart rate (at most)', kind: 'avg', source: 'wellness', field: 'resting_hr_bpm', target: 55, direction: 'below' }
];

/** Validate and tidy a goals config before saving: { ok, error?, goals }. */
export function cleanGoalsConfig(cfg) {
  const out = structuredClone(cfg || {});
  out.goals = (out.goals || []).filter(g => g.label && String(g.label).trim()).map(g => ({ ...g, label: String(g.label).trim(), target: Number(g.target) || 0 }));
  if (out.hr_zones_bpm) {
    const fl = [];
    for (const v of out.hr_zones_bpm) { if (v == null || !(v > 0)) break; fl.push(Number(v)); }
    if (fl.some((v, i) => i && v <= fl[i - 1])) return { ok: false, error: 'Zone floors must go up from left to right' };
    if (fl.length) out.hr_zones_bpm = fl; else delete out.hr_zones_bpm;
  }
  return { ok: true, goals: out };
}
