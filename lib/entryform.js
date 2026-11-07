/**
 * The log form's columns for each machine log_type, and conversion between
 * what a person types and the stored fields (docs/DATA-FORMAT.md). Pure.
 *
 * Column kinds:
 *   num      a number (negative allowed only where `negative` is set)
 *   int      a whole number
 *   minutes  "30", "32:45" or "1:05:00" → duration_sec
 *   seconds  a number of seconds → duration_sec
 *   pace     not an input: shows the pace worked out from the row
 */
import { parseDuration, fmtDuration, fmtNum, fmtPace, fmtDistancePace } from './format.js';

export const FORM_COLUMNS = {
  weight: [{ field: 'weight_lb', kind: 'num', label: 'Weight (lb)', negative: true, ph: '0' }, { field: 'reps', kind: 'int', label: 'Reps', ph: '0' }],
  reps: [{ field: 'reps', kind: 'int', label: 'Reps', ph: '0' }],
  time: [{ field: 'duration_sec', kind: 'seconds', label: 'Seconds', ph: '60' }],
  mins: [{ field: 'duration_sec', kind: 'minutes', label: 'Minutes', ph: '45' }],
  cardio: [{ field: 'duration_sec', kind: 'minutes', label: 'Min', ph: '30' }, { field: 'speed_mph', kind: 'num', label: 'MPH', ph: '3.5' },
    { field: 'incline_pct', kind: 'num', label: 'Incline %', ph: '0' }, { field: 'hr_avg_bpm', kind: 'int', label: 'HR', ph: '120' }],
  pace: [{ field: 'duration_sec', kind: 'minutes', label: 'Min', ph: '30' }, { field: 'speed_mph', kind: 'num', label: 'MPH', ph: '3.5' }, { kind: 'pace', label: 'Pace' }],
  walk: [{ field: 'distance_mi', kind: 'num', label: 'Miles', ph: '1.5' }, { field: 'duration_sec', kind: 'minutes', label: 'Time (min)', ph: '30:00' }, { kind: 'pace', label: 'Pace' }]
};

export const columnsFor = logType => FORM_COLUMNS[logType] || FORM_COLUMNS.weight;

/** The text to show in each input for a stored set. */
export function rowValues(logType, set) {
  return columnsFor(logType).map(c => {
    if (!c.field) return '';
    const v = set ? set[c.field] : null;
    if (v == null || v === '') return '';
    if (c.kind === 'minutes') return fmtDuration(v);
    return fmtNum(v, 3);
  });
}

/**
 * Typed values (one string per column) → { fields, error }. `fields` holds
 * every input column's field, null when blank, so a cleared value is cleared.
 * Returns fields = null for a row with nothing typed.
 */
export function parseRow(logType, values) {
  const fields = {};
  let any = false;
  for (const [i, c] of columnsFor(logType).entries()) {
    if (!c.field) continue;
    const s = String(values[i] ?? '').trim();
    if (s === '') { fields[c.field] = null; continue; }
    any = true;
    let v;
    if (c.kind === 'minutes') v = parseDuration(s);
    else {
      v = Number(s);
      if (!isFinite(v)) v = null;
      else if (c.kind === 'int') v = Number.isInteger(v) ? v : null;
      else if (c.kind === 'seconds') v = Math.round(v);
    }
    if (v == null) return { fields: null, error: `${c.label}: "${s}" is not a valid ${c.kind === 'minutes' ? 'time (e.g. 30 or 32:45)' : c.kind === 'int' ? 'whole number' : 'number'}` };
    if (v < 0 && !c.negative) return { fields: null, error: `${c.label} can't be negative` };
    fields[c.field] = v;
  }
  return { fields: any ? fields : null, error: null };
}

/** The pace cell for a row of typed values (walk: distance and time; pace: speed). */
export function paceText(logType, values) {
  const cols = columnsFor(logType);
  const get = f => { const i = cols.findIndex(c => c.field === f); return i < 0 ? null : values[i]; };
  if (logType === 'walk') return fmtDistancePace(parseFloat(get('distance_mi')), parseDuration(get('duration_sec')));
  if (logType === 'pace') return fmtPace(parseFloat(get('speed_mph')));
  return '';
}
