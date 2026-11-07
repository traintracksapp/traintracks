/**
 * CSV with standard quoting (RFC 4180). Every CSV has a header row and is read
 * by header name, never by position.
 */

/** One value as a CSV field: blank for null/undefined, tags joined with "; ", quoted when needed. */
export function csvField(v) {
  if (v == null) return '';
  let s = Array.isArray(v) ? v.join('; ') : String(v);
  if (/[",\r\n]/.test(s)) s = '"' + s.replace(/"/g, '""') + '"';
  return s;
}

/** Rows (objects) → CSV text with the given columns, LF line endings, trailing newline. */
export function toCSV(rows, columns) {
  const lines = [columns.join(',')];
  for (const r of rows) lines.push(columns.map(c => csvField(r[c])).join(','));
  return lines.join('\n') + '\n';
}

/** CSV text → array of string arrays. Handles quotes, doubled quotes, CRLF and newlines in quoted fields. */
export function parseRows(text) {
  const rows = [];
  let row = [], field = '', inQ = false, i = 0;
  const s = String(text || '');
  while (i < s.length) {
    const c = s[i];
    if (inQ) {
      if (c === '"') {
        if (s[i + 1] === '"') { field += '"'; i += 2; continue; }
        inQ = false; i++; continue;
      }
      field += c; i++; continue;
    }
    if (c === '"' && field === '') { inQ = true; i++; continue; }
    if (c === ',') { row.push(field); field = ''; i++; continue; }
    if (c === '\r' || c === '\n') {
      row.push(field); field = '';
      if (!(row.length === 1 && row[0] === '')) rows.push(row);
      row = [];
      i += (c === '\r' && s[i + 1] === '\n') ? 2 : 1;
      continue;
    }
    field += c; i++;
  }
  if (field !== '' || row.length) { row.push(field); rows.push(row); }
  return rows;
}

/** CSV text → array of objects keyed by header name (values are strings; missing cells are ""). */
export function parseCSV(text) {
  const rows = parseRows(text);
  if (!rows.length) return [];
  const head = rows[0].map(h => h.trim());
  return rows.slice(1).map(r => {
    const o = {};
    head.forEach((h, i) => { o[h] = r[i] ?? ''; });
    return o;
  });
}
