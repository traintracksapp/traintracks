/**
 * Exercise variations are tags on a log entry (spec §4.9). A variant is stored
 * as a sorted list of unique lowercase tags; the machine's default tags are not
 * stored, so "standard flat push-up" and an untagged push-up are the same.
 */

/** Clean a tag: trimmed, lowercase, inner whitespace collapsed. "" if nothing left. */
export function cleanTag(t) {
  return String(t ?? '').trim().toLowerCase().replace(/\s+/g, ' ');
}

/** Normalise a variant: accepts an array or a "a; b" string; drops blanks, duplicates and `defaults`; sorts. */
export function normalizeVariant(v, defaults = []) {
  const list = Array.isArray(v) ? v : String(v ?? '').split(';');
  const drop = new Set((defaults || []).map(cleanTag));
  return [...new Set(list.map(cleanTag).filter(t => t && !drop.has(t)))].sort();
}

/** True when two variants are the same set of tags (after normalising). */
export function sameVariant(a, b) {
  const x = normalizeVariant(a), y = normalizeVariant(b);
  return x.length === y.length && x.every((t, i) => t === y[i]);
}

/** True when `v` carries every tag in `required` (for goal filters). */
export function hasAllTags(v, required) {
  const have = new Set(normalizeVariant(v));
  return normalizeVariant(required).every(t => have.has(t));
}

/** True when `v` carries any tag in `excluded`. */
export function hasAnyTag(v, excluded) {
  const have = new Set(normalizeVariant(v));
  return normalizeVariant(excluded).some(t => have.has(t));
}
