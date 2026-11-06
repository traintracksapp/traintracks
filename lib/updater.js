/**
 * In-app updater planning. Compares two repo trees (path -> blob sha) and
 * decides which template files to copy into the user's repo. Pure; the
 * network work is in app/data.js.
 *
 * Only paths under SYNC_PREFIXES are ever written. The user's data files,
 * workflows and overrides are never in scope.
 */
import { SYNC_PREFIXES } from './config.js';

export function inScope(path, prefixes) {
  return (prefixes || SYNC_PREFIXES).some(p => path === p || (p.endsWith('/') && path.startsWith(p)));
}

/**
 * tpl, mine: { path: sha }
 * -> { changed: [paths], added: [paths], unchanged: n }
 */
export function planUpdate(tpl, mine, prefixes) {
  const changed = [], added = [];
  let unchanged = 0;
  Object.keys(tpl).sort().forEach(p => {
    if (!inScope(p, prefixes)) return;
    if (!(p in mine)) added.push(p);
    else if (tpl[p] !== mine[p]) changed.push(p);
    else unchanged++;
  });
  return { changed, added, unchanged, all: [...added, ...changed] };
}

/** Turn a GitHub git/trees response into { path: sha } for blobs only. */
export function treeToMap(tree) {
  const map = {};
  ((tree && tree.tree) || []).forEach(t => { if (t.type === 'blob') map[t.path] = t.sha; });
  return map;
}

/** Compare two VERSION strings (semver-ish). -1, 0, 1. */
export function compareVersions(a, b) {
  const pa = String(a || '0').split('.').map(n => parseInt(n, 10) || 0);
  const pb = String(b || '0').split('.').map(n => parseInt(n, 10) || 0);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const x = pa[i] || 0, y = pb[i] || 0;
    if (x !== y) return x < y ? -1 : 1;
  }
  return 0;
}

/**
 * The part of CHANGELOG.md between the user's version and the template's.
 * Sections start with "## <version>".
 */
export function changelogBetween(text, fromVersion, toVersion) {
  const lines = String(text || '').split(/\r?\n/);
  const out = [];
  let keep = false;
  for (const l of lines) {
    const m = /^##\s+v?(\d[\w.\-]*)/.exec(l);
    if (m) keep = compareVersions(m[1], fromVersion) > 0 && compareVersions(m[1], toVersion) <= 0;
    if (keep) out.push(l);
  }
  return out.join('\n').trim();
}
