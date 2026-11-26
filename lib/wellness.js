/**
 * Today's sleep and HRV for the weekly report (docs/DECISIONS.md, "Today's
 * sleep and HRV come from garmin-recent.json"). Pure.
 *
 * daily-wellness.csv holds finished days only, starting from yesterday, but
 * Garmin files a night's sleep and HRV under the day you wake up, so last
 * night belongs to today and would be missing until tomorrow's run.
 * garmin-recent.json (pipelines/garmin/sync_recent.py) already has it:
 *
 *   { today, sleep: { date, sleep_sec, score, deep_sec, light_sec, rem_sec, awake_sec,
 *                     respiration_brpm, spo2_pct },
 *     hrv: { date?, last_night_ms, weekly_avg_ms, status } }
 *
 * Only fields that are final once you wake up are used. Steps, calories,
 * resting heart rate, body battery and the rest of today's numbers are left
 * out: the day is not over.
 *
 * Rows here use Garmin's dates (a night under its wake-up day). The report
 * then files each night under the evening it starts (`byNight`, 0.4.5), so
 * last night shows as yesterday.
 */

import { addDays } from './dates.js';

const DATE = /^\d{4}-\d{2}-\d{2}$/;
const isObj = x => !!x && typeof x === 'object' && !Array.isArray(x);
const finite = v => (typeof v === 'number' && Number.isFinite(v) ? v : undefined);

/** garmin-recent.json `sleep` key → daily-wellness.csv column. */
export const SLEEP_FIELDS = {
  sleep_sec: 'sleep_sec',
  score: 'sleep_score',
  deep_sec: 'sleep_deep_sec',
  light_sec: 'sleep_light_sec',
  rem_sec: 'sleep_rem_sec',
  awake_sec: 'sleep_awake_sec',
  respiration_brpm: 'sleep_respiration_brpm',
  spo2_pct: 'sleep_spo2_pct'
};

/**
 * A wellness row for the snapshot's `today` built from last night's sleep and
 * HRV, or null. Sleep counts only when `sleep.date` is today (the pipeline
 * falls back to yesterday's sleep before the watch has synced). HRV counts
 * when `hrv.date` is today; files written before the pipeline recorded
 * `hrv.date` may hold yesterday's HRV as a fallback too, so for those it
 * counts only alongside today's sleep.
 */
export function todayWellnessRow(recent) {
  if (!isObj(recent) || typeof recent.today !== 'string' || !DATE.test(recent.today)) return null;
  const today = recent.today;
  const row = { date: today };
  let any = false;
  const sleep = isObj(recent.sleep) ? recent.sleep : null;
  const sleepToday = !!sleep && sleep.date === today;
  if (sleepToday) {
    for (const [from, to] of Object.entries(SLEEP_FIELDS)) {
      const v = finite(sleep[from]);
      if (v !== undefined) { row[to] = v; any = true; }
    }
  }
  const hrv = isObj(recent.hrv) ? recent.hrv : null;
  const hrvToday = !!hrv && (hrv.date != null ? hrv.date === today : sleepToday);
  if (hrvToday) {
    const v = finite(hrv.last_night_ms);
    if (v !== undefined) {
      row.hrv_ms = v;
      any = true;
      if (typeof hrv.status === 'string' && hrv.status) row.hrv_status = hrv.status;
    }
  }
  return any ? row : null;
}

/**
 * The wellness rows plus a row for today from garmin-recent.json. A row the
 * CSV already has for that date always wins. Returns a new array; the input is
 * not changed.
 */
export function withTodayWellness(rows, recent) {
  const list = Array.isArray(rows) ? rows : [];
  const row = todayWellnessRow(recent);
  if (!row || list.some(r => r && r.date === row.date)) return list.slice();
  return [...list, row];
}

/**
 * daily-wellness.csv columns measured overnight. Garmin dates them by the
 * morning you wake up; the report files them under the evening the night
 * starts (`byNight`).
 */
export const NIGHT_FIELDS = [...Object.values(SLEEP_FIELDS), 'hrv_ms', 'hrv_status'];

/**
 * The wellness rows with every overnight field moved to the day before
 * (docs/DECISIONS.md, "A night is filed under the evening it starts", 0.4.5):
 * "last night" is yesterday's row, next to yesterday's steps. Daytime fields
 * keep their date. A day keeps only the fields it has; a row with nothing left
 * is dropped. Rows without a valid date are left out. Returns new rows, sorted
 * by date; the input is not changed.
 */
export function byNight(rows) {
  const out = new Map();
  const put = (date, k, v) => { const r = out.get(date) || { date }; r[k] = v; out.set(date, r); };
  for (const r of Array.isArray(rows) ? rows : []) {
    if (!r || typeof r.date !== 'string' || !DATE.test(r.date)) continue;
    const night = addDays(r.date, -1);
    for (const [k, v] of Object.entries(r)) {
      if (k === 'date') continue;
      put(NIGHT_FIELDS.includes(k) ? night : r.date, k, v);
    }
  }
  return [...out.values()].sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
}

/** The report's wellness rows: the CSV plus last night (`withTodayWellness`), nights filed by their evening (`byNight`). */
export const reportWellness = (rows, recent) => byNight(withTodayWellness(rows, recent));
