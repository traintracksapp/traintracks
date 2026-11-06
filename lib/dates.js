/**
 * Date math on YYYY-MM-DD strings. All arithmetic is done at UTC noon so
 * DST and time zones can never shift a date.
 */
export const DAY_NAMES = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];

export function toDate(ds) { return new Date(ds + 'T12:00:00Z'); }
export function toStr(d) { return d.toISOString().slice(0, 10); }
export function addDays(ds, n) { const d = toDate(ds); d.setUTCDate(d.getUTCDate() + n); return toStr(d); }
export function dayIndex(ds) { return toDate(ds).getUTCDay(); }
export function daysBetween(a, b) { return Math.round((toDate(b) - toDate(a)) / 86400000); }

/**
 * Bounds of the week containing `today`, shifted by `offset` weeks
 * (0 = this week, -1 = last week). weekStart is a day name; unknown -> Monday.
 */
export function weekBounds(today, weekStart, offset) {
  const ws = DAY_NAMES.indexOf(String(weekStart || 'mon').toLowerCase().slice(0, 3));
  const wsi = ws < 0 ? 1 : ws;
  const back = (dayIndex(today) - wsi + 7) % 7;
  const start = addDays(today, -back + 7 * (offset || 0));
  return { start, end: addDays(start, 6) };
}

export function inRange(ds, b) { return !!ds && ds >= b.start && ds <= b.end; }

export function fmtShortDate(ds) {
  const d = toDate(ds);
  return `${DAY_NAMES[d.getUTCDay()].replace(/^./, c => c.toUpperCase())} ${d.getUTCMonth() + 1}/${d.getUTCDate()}`;
}

export function isValidDate(ds) {
  return /^\d{4}-\d{2}-\d{2}$/.test(ds || '') && !isNaN(toDate(ds).getTime());
}
