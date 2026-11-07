/**
 * Dates are `YYYY-MM-DD` strings (local dates), times are `HH:MM:SS` (local,
 * 24-hour). Arithmetic is done at UTC noon so DST and time zones can never
 * shift a date.
 */
export const DAY_NAMES = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];

const pad = n => String(n).padStart(2, '0');

export function toDate(ds) { return new Date(ds + 'T12:00:00Z'); }
export function toStr(d) { return d.toISOString().slice(0, 10); }
export function addDays(ds, n) { const d = toDate(ds); d.setUTCDate(d.getUTCDate() + n); return toStr(d); }
export function dayIndex(ds) { return toDate(ds).getUTCDay(); }
export function daysBetween(a, b) { return Math.round((toDate(b) - toDate(a)) / 86400000); }

export function isValidDate(ds) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(ds || '')) return false;
  const d = toDate(ds);
  return !isNaN(d.getTime()) && toStr(d) === ds;
}

export function isValidTime(ts) {
  const m = /^(\d{2}):(\d{2}):(\d{2})$/.exec(ts || '');
  return !!m && +m[1] < 24 && +m[2] < 60 && +m[3] < 60;
}

/** The device's local date for a Date (default now). */
export function localDate(d = new Date()) {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/** The device's local time of day for a Date (default now). */
export function localTime(d = new Date()) {
  return `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}

/**
 * Bounds of the week containing `today`, shifted by `offset` weeks
 * (0 = this week, -1 = last week). `weekStart` is a day name; unknown → Monday.
 */
export function weekBounds(today, weekStart, offset = 0) {
  const ws = DAY_NAMES.indexOf(String(weekStart || 'mon').toLowerCase().slice(0, 3));
  const wsi = ws < 0 ? 1 : ws;
  const back = (dayIndex(today) - wsi + 7) % 7;
  const start = addDays(today, -back + 7 * offset);
  return { start, end: addDays(start, 6) };
}

export function inRange(ds, b) { return !!ds && ds >= b.start && ds <= b.end; }

/** "Sat 11/7" */
export function fmtShortDate(ds) {
  const d = toDate(ds);
  return `${DAY_NAMES[d.getUTCDay()].replace(/^./, c => c.toUpperCase())} ${d.getUTCMonth() + 1}/${d.getUTCDate()}`;
}

/** Version 1 `datetime` ("2026-11-05 12:14:40 PM") → version 2 `time` ("12:14:40"), or "" if unreadable. */
export function timeFromLegacyDatetime(dt) {
  const m = /(\d{1,2}):(\d{2})(?::(\d{2}))?\s*([AaPp][Mm])?\s*$/.exec(String(dt || '').trim());
  if (!m) return '';
  let h = +m[1];
  const ap = m[4] && m[4].toUpperCase();
  if (ap === 'PM' && h < 12) h += 12;
  if (ap === 'AM' && h === 12) h = 0;
  const t = `${pad(h)}:${m[2]}:${m[3] || '00'}`;
  return isValidTime(t) ? t : '';
}
