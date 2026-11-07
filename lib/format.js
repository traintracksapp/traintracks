/**
 * Display formatting. Stored values are in the units of docs/DATA-FORMAT.md;
 * these turn them into what people read and type.
 */

/** "32:45", "5", "1:30:00" → seconds. A plain number means minutes. Returns null for blank/invalid. */
export function parseDuration(v) {
  if (v == null || v === '') return null;
  if (typeof v === 'number') return isFinite(v) && v >= 0 ? Math.round(v * 60) : null;
  const s = String(v).trim();
  if (/^\d+(\.\d+)?$/.test(s)) return Math.round(parseFloat(s) * 60);
  const m = /^(?:(\d+):)?(\d{1,2}):(\d{2})$/.exec(s);
  if (!m) return null;
  return (+(m[1] || 0)) * 3600 + (+m[2]) * 60 + (+m[3]);
}

/** Seconds → "32:45", or "30" for whole minutes, "1:30:00" from an hour; "" for null. */
export function fmtDuration(sec) {
  if (sec == null || sec === '') return '';
  const t = Math.round(+sec);
  const h = Math.floor(t / 3600), m = Math.floor((t % 3600) / 60), s = t % 60;
  if (h) return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
  return s ? `${m}:${String(s).padStart(2, '0')}` : String(m);
}

/** Seconds → "45 s" when under a minute, else as fmtDuration. For planks and the like. */
export function fmtSeconds(sec) {
  if (sec == null || sec === '') return '';
  return sec < 60 ? `${Math.round(sec)} s` : fmtDuration(sec);
}

function fmtPaceMinutes(minPerMile) {
  const total = Math.round(minPerMile * 60);
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, '0')}/mi`;
}

/** Speed in mph → pace "20:00/mi"; "—" when not positive. */
export function fmtPace(mph) {
  if (!(mph > 0)) return '—';
  return fmtPaceMinutes(60 / mph);
}

/** Distance (mi) and duration (s) → pace "20:00/mi"; "—" when either is missing. */
export function fmtDistancePace(mi, sec) {
  if (!(mi > 0) || !(sec > 0)) return '—';
  return fmtPaceMinutes(sec / 60 / mi);
}

/** A number for display: drops trailing zeros, at most `dp` decimals. */
export function fmtNum(n, dp = 2) {
  if (n == null || n === '' || !isFinite(n)) return '';
  return String(+(+n).toFixed(dp));
}
