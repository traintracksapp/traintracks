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

/** Seconds → "90 s" under two minutes, else "2:30 min". For planks and the like. */
export function fmtSeconds(sec) {
  if (sec == null || sec === '') return '';
  return sec < 120 ? `${Math.round(sec)} s` : `${fmtDuration(sec)} min`;
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

/** Weight for display: "60 lb"; negative = assistance, "100 lb assist". */
export function fmtWeight(w) {
  if (w == null || w === '') return '';
  return w < 0 ? `${fmtNum(-w)} lb assist` : `${fmtNum(w)} lb`;
}

/** Relative date: Today / Yesterday / 3d ago / Oct 4. `today` is a YYYY-MM-DD string. */
export function fmtDate(ds, today) {
  const d = new Date(ds + 'T12:00:00Z'), t = new Date(today + 'T12:00:00Z');
  const diff = Math.round((t - d) / 86400000);
  if (diff === 0) return 'Today';
  if (diff === 1) return 'Yesterday';
  if (diff > 1 && diff < 7) return `${diff}d ago`;
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' });
}

/** "Sat, Nov 7, 2026" */
export function fmtDateFull(ds) {
  return new Date(ds + 'T12:00:00Z').toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' });
}

/** "Oct 31 – Nov 6" */
export function fmtRange(s, e) {
  const f = d => new Date(d + 'T12:00:00Z').toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' });
  return `${f(s)} – ${f(e)}`;
}

/** One set for display, from whichever fields it has. */
export function fmtSet(s) {
  const parts = [];
  if (s.weight_lb != null) parts.push(`${fmtWeight(s.weight_lb)}${s.reps != null ? ` × ${s.reps}` : ''}`);
  else if (s.reps != null) parts.push(`${s.reps} rep${s.reps === 1 ? '' : 's'}`);
  if (s.distance_mi != null) parts.push(`${fmtNum(s.distance_mi)} mi`);
  if (s.duration_sec != null) parts.push(s.duration_sec < 120 && s.distance_mi == null && s.speed_mph == null ? fmtSeconds(s.duration_sec) : `${fmtDuration(s.duration_sec)} min`);
  if (s.speed_mph != null) parts.push(`${fmtNum(s.speed_mph)} mph`);
  if (s.incline_pct != null) parts.push(`${fmtNum(s.incline_pct)}% incline`);
  if (s.level != null) parts.push(`level ${fmtNum(s.level)}`);
  if (s.distance_mi != null && s.duration_sec != null) parts.push(fmtDistancePace(s.distance_mi, s.duration_sec));
  else if (s.speed_mph != null) parts.push(fmtPace(s.speed_mph));
  if (s.hr_avg_bpm != null) parts.push(`HR ${s.hr_avg_bpm}`);
  return parts.join(' · ') || '—';
}

/** One-line summary of a session, e.g. "Today · 60 lb × 3 sets", "2d ago · 45 reps · 3 sets". */
export function fmtLast(sets, today) {
  if (!sets || !sets.length) return '';
  const d = fmtDate(sets[0].date, today), f = sets[0], n = sets.length;
  const setsTxt = `${n} set${n === 1 ? '' : 's'}`;
  if (sets.some(s => s.weight_lb != null)) {
    const best = Math.max(...sets.filter(s => s.weight_lb != null).map(s => s.weight_lb));
    return `${d} · ${fmtWeight(best)} × ${setsTxt}`;
  }
  if (sets.some(s => s.reps != null)) {
    const tot = sets.reduce((a, s) => a + (s.reps || 0), 0);
    return `${d} · ${tot} rep${tot === 1 ? '' : 's'} · ${setsTxt}`;
  }
  if (f.distance_mi != null) return `${d} · ${fmtNum(f.distance_mi)} mi${f.duration_sec != null ? ` in ${fmtDuration(f.duration_sec)} min` : ''}`;
  if (sets.some(s => s.duration_sec != null)) {
    const tot = sets.reduce((a, s) => a + (s.duration_sec || 0), 0);
    return tot < 120 || n > 1 && tot < 600 ? `${d} · ${n}× ${fmtSeconds(Math.round(tot / n))}` : `${d} · ${fmtDuration(tot)} min`;
  }
  return d;
}
