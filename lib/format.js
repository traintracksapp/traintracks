/**
 * Formatting helpers. Pure; no DOM.
 */

export function fmtPace(mph) {
  if (!mph || mph <= 0) return '—';
  const total = 60 / mph;
  const mins = Math.floor(total);
  const secs = Math.round((total - mins) * 60);
  return `${mins}:${String(secs).padStart(2, '0')}/mi`;
}

export function fmtWalkPace(dist, dur) {
  if (!dist || !dur || dist <= 0) return '—';
  const mpm = dur / dist;
  const m = Math.floor(mpm);
  const s = Math.round((mpm - m) * 60);
  return `${m}:${String(s).padStart(2, '0')}/mi`;
}

/** "45", "45:30" or "1:02:15" -> decimal minutes (null if empty). */
export function parseMinutes(val) {
  if (val == null || val === '') return null;
  const str = String(val).trim();
  if (!str) return null;
  if (str.includes(':')) {
    const parts = str.split(':').map(p => parseFloat(p) || 0);
    if (parts.length === 3) return parts[0] * 60 + parts[1] + parts[2] / 60;
    return parts[0] + parts[1] / 60;
  }
  const n = parseFloat(str);
  return isNaN(n) ? null : n;
}

/** decimal minutes -> "45" or "45:30". */
export function fmtDuration(mins) {
  if (mins == null || mins === '' || isNaN(mins)) return '';
  const m = Math.floor(mins);
  const s = Math.round((mins - m) * 60);
  if (s === 60) return String(m + 1);
  return s > 0 ? `${m}:${String(s).padStart(2, '0')}` : String(m);
}

/** YYYY-MM-DD for a Date in local time. */
export function todayStr(now) {
  const d = now || new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

/** Relative date: Today / Yesterday / 3d ago / Oct 4. */
export function fmtDate(ds, now) {
  const d = new Date(ds + 'T12:00:00');
  const t = now ? new Date(now) : new Date();
  t.setHours(12, 0, 0, 0);
  const diff = Math.round((t - d) / 86400000);
  if (diff === 0) return 'Today';
  if (diff === 1) return 'Yesterday';
  if (diff > 1 && diff < 7) return `${diff}d ago`;
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

export function fmtDateFull(ds) {
  return new Date(ds + 'T12:00:00').toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' });
}

export function fmtRange(s, e) {
  const f = d => new Date(d + 'T12:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  return `${f(s)} – ${f(e)}`;
}

/** Wall-clock time string the log stores next to the date. */
export function fmtClock(d) {
  return (d || new Date()).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
}

/** One-line summary of a session's sets, e.g. "Today · 60 lbs × 3 sets". */
export function fmtLast(sets, logType, now) {
  if (!sets || !sets.length) return '';
  const d = fmtDate(sets[0].date, now), f = sets[0];
  if (logType === 'walk' && f.level && f.duration) return `${d} · ${f.level}mi in ${fmtDuration(f.duration)}min (${fmtWalkPace(f.level, f.duration)})`;
  if (logType === 'pace' && f.level) return `${d} · ${f.duration}min @ ${f.level}mph (${fmtPace(f.level)})`;
  if (logType === 'time' && f.duration != null) return `${d} · ${sets.length}×${f.duration} sec`;
  if (logType === 'mins' && f.duration != null) return `${d} · ${fmtDuration(f.duration)} min`;
  if (f.weight != null) { const mx = Math.max(...sets.map(s => s.weight || 0)); return `${d} · ${mx} lbs × ${sets.length} sets`; }
  if (f.reps != null && f.weight == null) { const tot = sets.reduce((s, e) => s + (e.reps || 0), 0); return `${d} · ${tot} rep${tot === 1 ? '' : 's'} · ${sets.length} set${sets.length === 1 ? '' : 's'}`; }
  if (f.duration != null) {
    if (logType === 'cardio' || f.incline != null || f.hr != null) { const tot = sets.reduce((s, e) => s + (e.duration || 0), 0); return `${d} · ${tot} min`; }
    const tot = sets.reduce((s, e) => s + (e.duration || 0), 0); return `${d} · ${tot} min`;
  }
  return d;
}

/** Set line for history views. */
export function fmtSet(s, logType) {
  const t = logType || inferLogType(s);
  switch (t) {
    case 'cardio': return [s.duration != null ? s.duration + 'min' : '—', s.level ? s.level + 'mph' : null, s.incline != null ? s.incline + '% inc' : null, s.hr ? 'HR ' + s.hr : null].filter(Boolean).join(' · ');
    case 'walk': return `${s.level != null ? s.level : '—'}mi in ${s.duration != null ? fmtDuration(s.duration) : '—'}min — ${fmtWalkPace(s.level, s.duration)}`;
    case 'pace': return `${s.duration != null ? s.duration : '—'}min @ ${s.level || '?'}mph — ${fmtPace(s.level)}`;
    case 'time': return `${s.duration != null ? s.duration : '—'} sec`;
    case 'mins': return `${s.duration != null ? fmtDuration(s.duration) : '—'} min`;
    case 'reps': return `${s.reps != null ? s.reps : '—'} reps`;
    default: return `${s.weight != null ? s.weight : '—'} lbs × ${s.reps != null ? s.reps : '—'}`;
  }
}

/** Best-guess logType for an entry whose machine is unknown. */
export function inferLogType(e) {
  if (!e) return 'weight';
  if (e.weight != null) return 'weight';
  if (e.incline != null || e.hr != null) return 'cardio';
  if (e.level != null && e.duration != null) return 'pace';
  if (e.reps != null) return 'reps';
  if (e.duration != null) return 'time';
  return 'weight';
}

export function fmtGoalNum(v, unit) {
  if (v == null) return '—';
  const n = Number(v);
  const s = Math.abs(n) >= 1000 ? Math.round(n).toLocaleString('en-US') : (Number.isInteger(n) ? String(n) : n.toFixed(1));
  return unit ? `${s}${unit === 'h' || unit === 's' ? ' ' + unit : unit}` : s;
}

export function slug(s) {
  return String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
}
