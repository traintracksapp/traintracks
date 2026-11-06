/**
 * Weekly goals and the report behind them. Pure functions over the repo files:
 *   goals.json          { weekStart, hrZones, goals: [...] }
 *   workout-log.json    set entries
 *   daily-wellness.csv  optional, one row per complete Garmin day
 *   cardio-buckets.csv  optional, one row per Garmin activity, 5-bpm buckets
 *
 * Goal: { id, label, kind:'sum'|'days'|'avg', source:'log'|'wellness', field,
 *         machineIds, filter:'cardio'|'strength'|'any', target, unit,
 *         direction:'above'|'below', hrMin, hrMax }
 *
 * Heart-rate data is stored as neutral 5-bpm buckets; zones and HR-range
 * minutes are only ever computed here, at read time.
 */
import { weekBounds, inRange, toDate, fmtShortDate } from './dates.js';
import { todayStr } from './format.js';
import { machineInfoMap, classifyEntry, garminIdOf } from './log.js';
import { parseSimpleCSV } from './csv.js';

export const parseWellnessCSV = parseSimpleCSV;

function num(v) { const n = Number(v); return isNaN(n) ? 0 : n; }
function round1(v) { return Math.round(v * 10) / 10; }

// ---- heart-rate buckets ----

/** Column name -> { lo, hi, open } (hi exclusive), or null. */
export function bucketColumn(name) {
  let m;
  if ((m = /^hr_under(\d+)$/.exec(name))) return { lo: +m[1] - 5, hi: +m[1], open: 'low' };
  if ((m = /^hr(\d+)_up$/.exec(name))) return { lo: +m[1], hi: +m[1] + 5, open: 'high' };
  if ((m = /^hr(\d+)_(\d+)$/.exec(name))) return { lo: +m[1], hi: +m[2] + 1, open: null };
  return null;
}

/** cardio-buckets.csv text -> { activityId: { id, date, start, type, minutes, avgHr, maxHr, corrected, bins } } */
export function parseBucketsCSV(text) {
  const lines = String(text || '').split(/\r?\n/).filter(l => l.trim());
  const map = {};
  if (lines.length < 2) return map;
  const head = lines[0].split(',');
  const cols = head.map(bucketColumn);
  const at = n => head.indexOf(n);
  const iId = at('activity_id');
  if (iId < 0) return map;
  lines.slice(1).forEach(l => {
    const c = l.split(',');
    const id = c[iId];
    if (!id) return;
    const bins = [];
    cols.forEach((b, i) => { const v = Number(c[i]); if (b && v > 0) bins.push({ lo: b.lo, hi: b.hi, open: b.open, min: v }); });
    map[id] = {
      id, date: c[at('date')] || '', start: c[at('start')] || '', type: c[at('activity_type')] || '',
      minutes: num(c[at('minutes')]), avgHr: num(c[at('avg_hr')]), maxHr: num(c[at('max_minute_hr')]),
      corrected: c[at('corrected')] === 'y', bins
    };
  });
  return map;
}

/** Minutes between lo (inclusive) and hi (exclusive); either may be null. Edges inside a bucket take a proportional share. */
export function hrRangeMinutes(row, lo, hi) {
  if (!row || !row.bins) return 0;
  const a = lo == null || lo === '' ? -Infinity : Number(lo);
  const b = hi == null || hi === '' ? Infinity : Number(hi);
  let total = 0;
  row.bins.forEach(bin => {
    const blo = bin.open === 'low' && a === -Infinity ? -Infinity : bin.lo;
    const bhi = bin.open === 'high' && b === Infinity ? Infinity : bin.hi;
    const from = Math.max(a, blo), to = Math.min(b, bhi);
    if (to <= from) return;
    const width = bhi - blo;
    total += width === Infinity ? bin.min : bin.min * (to - from) / width;
  });
  return total;
}

export function cleanFloors(floors) {
  if (!Array.isArray(floors)) return [];
  const fl = floors.map(Number).filter(n => n > 0);
  for (let i = 1; i < fl.length; i++) if (fl[i] <= fl[i - 1]) return [];
  return fl;
}

/** { below, zones:[...] } for one activity given ascending zone floors. */
export function zonesFromBuckets(row, floors) {
  const fl = cleanFloors(floors);
  if (!row || !fl.length) return null;
  return {
    below: hrRangeMinutes(row, null, fl[0]),
    zones: fl.map((f, i) => hrRangeMinutes(row, f, i + 1 < fl.length ? fl[i + 1] : null))
  };
}

export function isHrRangeGoal(goal) {
  return !!goal && goal.kind === 'sum' && (goal.hrMin != null || goal.hrMax != null);
}

export function hrRangeText(lo, hi) {
  const a = lo == null || lo === '' ? null : Number(lo), b = hi == null || hi === '' ? null : Number(hi);
  if (a == null && b == null) return 'any heart rate';
  if (a == null) return `under ${b} bpm`;
  if (b == null) return `${a}+ bpm`;
  return `${a}–${b - 1} bpm`;
}

// ---- the weekly computation ----

/**
 * ctx: { log, wellness, buckets, gyms, weekStart, today, offset }
 * -> { start, end, isCurrent, daysElapsed, results: [...] }
 */
export function computeGoals(goals, ctx) {
  const today = ctx.today || todayStr();
  const b = weekBounds(today, ctx.weekStart || 'mon', ctx.offset || 0);
  const isCurrent = inRange(today, b);
  const daysElapsed = isCurrent ? Math.round((toDate(today) - toDate(b.start)) / 86400000) + 1 : (b.start > today ? 0 : 7);
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
      const rows = wellness.filter(w => num(w[goal.field]) > 0).sort((a, b2) => a.date < b2.date ? -1 : 1);
      r.daysWithData = rows.length;
      r.items = rows.map(w => ({ date: w.date, label: fmtShortDate(w.date), value: num(w[goal.field]) }));
      if (goal.kind === 'avg') {
        r.value = rows.length ? round1(rows.reduce((s, w) => s + num(w[goal.field]), 0) / rows.length) : null;
      } else {
        r.value = rows.reduce((s, w) => s + num(w[goal.field]), 0);
        const expectedDays = isCurrent ? daysElapsed : 7;
        if (rows.length < expectedDays) r.note = `${rows.length} of ${expectedDays} day${expectedDays === 1 ? '' : 's'} synced`;
      }
    } else if (goal.kind === 'days') {
      const want = goal.filter || 'any';
      const byDate = {};
      log.forEach(e => {
        const c = classifyEntry(e, info);
        if (want !== 'any' && c !== want) return;
        if (want === 'any' && c === 'other') return;
        (byDate[e.date] = byDate[e.date] || new Set()).add(e.machine || e.machineId);
      });
      const dates = Object.keys(byDate).sort();
      r.value = dates.length;
      r.items = dates.map(d => ({ date: d, label: fmtShortDate(d), value: null, detail: [...byDate[d]].join(', ') }));
    } else if (isHrRangeGoal(goal)) {
      const byDate = {};
      const seen = new Set();
      log.forEach(e => {
        const id = garminIdOf(e);
        if (!id || seen.has(id) || !buckets[id]) return;
        seen.add(id);
        const v = hrRangeMinutes(buckets[id], goal.hrMin, goal.hrMax);
        if (!v) return;
        const d = byDate[e.date] = byDate[e.date] || { value: 0, names: new Set() };
        d.value += v; d.names.add(e.machine || e.machineId);
      });
      const dates = Object.keys(byDate).sort();
      r.value = round1(dates.reduce((s, d) => s + byDate[d].value, 0));
      r.items = dates.map(d => ({ date: d, label: fmtShortDate(d), value: round1(byDate[d].value), detail: [...byDate[d].names].join(', ') }));
      if (!haveBuckets) r.note = 'needs cardio-buckets.csv';
      else {
        const unlinked = Object.keys(buckets).filter(id => inRange(buckets[id].date, b) && !seen.has(id)).length;
        if (unlinked) r.note = `${unlinked} Garmin activit${unlinked === 1 ? 'y' : 'ies'} not in the log`;
      }
    } else {
      const ids = goal.machineIds && goal.machineIds.length ? goal.machineIds : null;
      const byDate = {};
      log.forEach(e => {
        if (ids && !ids.includes(e.machineId)) return;
        const v = num(e[goal.field]);
        if (!v) return;
        const d = byDate[e.date] = byDate[e.date] || { value: 0, sets: 0, names: new Set() };
        d.value += v; d.sets += 1; d.names.add(e.machine || e.machineId);
      });
      const dates = Object.keys(byDate).sort();
      r.value = round1(dates.reduce((s, d) => s + byDate[d].value, 0));
      r.items = dates.map(d => ({
        date: d, label: fmtShortDate(d), value: round1(byDate[d].value),
        detail: ids ? `${byDate[d].sets} set${byDate[d].sets === 1 ? '' : 's'}` : [...byDate[d].names].join(', ')
      }));
    }

    // ---- status / pace ----
    const t = num(goal.target);
    if (goal.kind === 'avg') {
      if (r.value == null) r.status = 'nodata';
      else r.status = (r.direction === 'below' ? r.value <= t : r.value >= t) ? 'hit' : 'miss';
      r.pct = r.value == null ? 0 : Math.min(1, r.direction === 'below' ? (r.value ? t / r.value : 1) : r.value / t);
    } else {
      const paceDays = r.source === 'wellness' && r.daysWithData != null ? Math.min(r.daysWithData, isCurrent ? daysElapsed : 7) : (isCurrent ? daysElapsed : 7);
      r.expected = round1(t * paceDays / 7);
      r.pct = t ? Math.min(1, r.value / t) : 0;
      if (r.value >= t) r.status = 'hit';
      else if (!isCurrent) r.status = (r.source === 'wellness' && paceDays < 7 && r.value >= r.expected) ? 'onpace' : 'miss';
      else r.status = r.value >= r.expected ? 'onpace' : 'behind';
    }
    return r;
  });

  return { start: b.start, end: b.end, isCurrent, daysElapsed, results };
}

/** Default goals for a fresh install. */
export function defaultGoals() {
  return {
    weekStart: 'mon',
    goals: [
      { id: 'cardioDays', label: 'Days with cardio', kind: 'days', source: 'log', filter: 'cardio', target: 3 },
      { id: 'strengthDays', label: 'Days with strength', kind: 'days', source: 'log', filter: 'strength', target: 2 }
    ]
  };
}

export const GOAL_PRESETS = [
  { label: 'Days with cardio', kind: 'days', source: 'log', filter: 'cardio', target: 3 },
  { label: 'Days with strength', kind: 'days', source: 'log', filter: 'strength', target: 2 },
  { label: 'Days with any workout', kind: 'days', source: 'log', filter: 'any', target: 4 },
  { label: 'Minutes in a heart-rate range…', kind: 'sum', source: 'log', hrMin: 120, hrMax: 130, target: 45, pickHr: true },
  { label: 'Reps of an exercise…', kind: 'sum', source: 'log', field: 'reps', machineIds: [], target: 100, pick: true },
  { label: 'Seconds of an exercise…', kind: 'sum', source: 'log', field: 'duration', machineIds: [], target: 300, unit: 's', pick: true },
  { label: 'Total steps', kind: 'sum', source: 'wellness', field: 'steps', target: 70000 },
  { label: 'Avg sleep (hours)', kind: 'avg', source: 'wellness', field: 'sleep_hours', target: 7, unit: 'h' },
  { label: 'Avg HRV', kind: 'avg', source: 'wellness', field: 'hrv_last_night', target: 40 },
  { label: 'Avg resting HR (max)', kind: 'avg', source: 'wellness', field: 'resting_hr', target: 50, direction: 'below' }
];

/** Validate and clean a goals config before saving. Returns { ok, error, goals }. */
export function cleanGoalsConfig(cfg) {
  const out = JSON.parse(JSON.stringify(cfg || {}));
  out.goals = (out.goals || []).filter(g => g.label && String(g.label).trim()).map(g => ({ ...g, label: String(g.label).trim(), target: Number(g.target) || 0 }));
  if (out.hrZones) {
    const fl = [];
    for (const v of out.hrZones) { if (v == null || !(v > 0)) break; fl.push(Number(v)); }
    if (fl.some((v, i) => i && v <= fl[i - 1])) return { ok: false, error: 'Zone floors must go up from left to right' };
    if (fl.length) out.hrZones = fl; else delete out.hrZones;
  }
  return { ok: true, goals: out };
}
