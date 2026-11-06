/**
 * workout-log.csv — the export the coach reads. Generated from the JSON,
 * never hand-edited. The column order is a contract: positional parsers
 * exist (the coach, the Garmin skill), so new columns go on the END only.
 */

export const CSV_HEADER = 'datetime,gym,room,machine,machineId,set,weight,reps,duration,level,incline,hr,notes,zone1,zone2,zone3,zone4,zone5,garminId';

/** Commas, quotes and newlines inside values become spaces (no quoting). */
export function csvEsc(s) {
  return String(s == null ? '' : s).replace(/[,\n\r"]/g, ' ');
}

function cell(v) { return v == null || v === '' ? '' : String(v); }

export function entryToCsvRow(e) {
  return [
    csvEsc(e.datetime || e.date), csvEsc(e.gym), csvEsc(e.room), csvEsc(e.machine), cell(e.machineId), cell(e.set),
    cell(e.weight), cell(e.reps), cell(e.duration), cell(e.level), cell(e.incline), cell(e.hr),
    csvEsc(e.notes || ''),
    cell(e.zone1), cell(e.zone2), cell(e.zone3), cell(e.zone4), cell(e.zone5),
    cell(e.garminId)
  ].join(',');
}

export function toCSV(entries) {
  return [CSV_HEADER, ...entries.map(entryToCsvRow)].join('\n') + '\n';
}

/** Generic CSV -> array of objects (numbers parsed, blanks -> null). No quoting support by design. */
export function parseSimpleCSV(text) {
  const lines = String(text || '').split(/\r?\n/).filter(l => l.trim());
  if (!lines.length) return [];
  const head = lines[0].split(',');
  return lines.slice(1).map(l => {
    const cells = l.split(',');
    const row = {};
    head.forEach((h, i) => {
      const v = cells[i];
      if (v == null || v === '') { row[h] = null; return; }
      const n = Number(v);
      row[h] = isNaN(n) ? v : n;
    });
    return row;
  });
}
