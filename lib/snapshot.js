/**
 * The copy of the repo's files kept on the device (0.2.4), so the app opens
 * from it at once and then downloads only what changed. Pure: the device
 * storage (IndexedDB) and GitHub calls live in the app's data layer.
 *
 * A snapshot is { v, head, tree, files: { path: { sha, text } } }:
 *  - `files` holds every file the app reads on load, as stored (text), with
 *    its git blob sha;
 *  - `head` is a commit at which every one of those files has exactly that
 *    sha (or null when that is not known, e.g. after a save built on a newer
 *    head); `tree` is that commit's tree sha.
 * Opening: if the branch head is still `head`, nothing is downloaded. Else the
 * head's tree (one call) gives every file's blob sha, and only files whose sha
 * changed are downloaded.
 */
import { FILES } from './config.js';
import { isMonthFile, LEGACY_LOG } from './months.js';

export const SNAPSHOT_VERSION = 1;

/** Files the app reads on load, besides the log's month files and the user's gyms. */
export const APP_FILES = [FILES.generic, FILES.genericLocal, FILES.profile, FILES.goals,
  FILES.plan, FILES.wellness, FILES.buckets, FILES.version];

const MY_GYM = new RegExp(`^${FILES.myGyms.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}/[^/]+/gym\\.json$`);

/** True for a file the app may read on load (the old single-file log only while there are no months). */
export const isAppFile = p => APP_FILES.includes(p) || MY_GYM.test(p) || isMonthFile(p) || p === LEGACY_LOG;

/** The app's files in a tree ({ path: blobSha }): the old single-file log is left out once there are month files. */
export function appTree(treeFiles) {
  const paths = Object.keys(treeFiles).filter(isAppFile);
  const months = paths.some(isMonthFile);
  return Object.fromEntries(paths.filter(p => !(months && p === LEGACY_LOG)).map(p => [p, treeFiles[p]]));
}

/** A snapshot read back from the device, or null if it is not one this version understands. */
export function validSnapshot(x) {
  if (!x || x.v !== SNAPSHOT_VERSION || typeof x.files !== 'object' || !x.files) return null;
  for (const f of Object.values(x.files)) if (!f || typeof f.sha !== 'string' || typeof f.text !== 'string') return null;
  return x;
}

/** The app's files in a tree ({ path: blobSha }) whose sha differs from the device copy (`have`). */
export function toDownload(treeFiles, have = {}) {
  const t = appTree(treeFiles);
  return Object.keys(t).filter(p => !(have[p] && have[p].sha === t[p])).sort();
}

/**
 * The app's files at a tree: the device copy where the sha matches, else the
 * download (`got`: { path: text }). Files no longer in the tree are dropped.
 */
export function nextFiles(treeFiles, have = {}, got = {}) {
  const out = {};
  for (const [p, sha] of Object.entries(appTree(treeFiles))) {
    if (have[p] && have[p].sha === sha) out[p] = have[p];
    else if (p in got) out[p] = { sha, text: got[p] };
    else throw new Error(`${p} was not downloaded`);
  }
  return out;
}

/** Paths added, removed or changed between two file sets. */
export function changedPaths(before = {}, after = {}) {
  const all = new Set([...Object.keys(before), ...Object.keys(after)]);
  return [...all].filter(p => !before[p] || !after[p] || before[p].sha !== after[p].sha).sort();
}

/**
 * A new snapshot. `legacyToo`: the old single-file log is still in the repo
 * next to the months (it is not downloaded; the app shows a notice).
 */
export const makeSnapshot = (head, tree, files, legacyToo = false) => ({ v: SNAPSHOT_VERSION, head: head || null, tree: tree || null, files, legacyToo: !!legacyToo });

/**
 * After the app wrote one file itself (a gym, the profile...): the new text and
 * sha. The head is no longer known to match every file, so it is cleared (the
 * next open compares the tree, which is cheap). `text` null = deleted.
 */
export function withFile(snap, path, text, sha) {
  const files = { ...snap.files };
  if (text == null) delete files[path]; else files[path] = { sha, text };
  return { ...snap, head: null, tree: null, files };
}

/**
 * After a log save (commitLog's result): the month files written ({ path:
 * { sha, text } }, null = removed). If the save was built on the snapshot's
 * own head, the new commit is the head (nothing else changed); otherwise the
 * head is cleared.
 */
export function withLogSave(snap, res) {
  const follows = !!snap.head && snap.head === res.parent;
  const files = { ...snap.files };
  for (const [p, f] of Object.entries(res.files || {})) { if (f) files[p] = f; else delete files[p]; }
  return { ...snap, head: follows ? res.commit : null, tree: follows ? res.tree : null, files };
}
