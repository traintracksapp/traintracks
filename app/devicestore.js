/**
 * The device copy of the repo's files (lib/snapshot.js), kept in IndexedDB.
 * Everything is best effort: a private window, a full disk or a browser
 * without IndexedDB just means the app loads from GitHub as before. Nothing
 * here throws.
 */
const DB = 'traintracks', STORE = 'snapshots';
let dbp = null;

function openDb() {
  if (dbp) return dbp;
  dbp = new Promise(resolve => {
    try {
      const idb = globalThis.indexedDB;
      if (!idb) return resolve(null);
      const req = idb.open(DB, 1);
      const t = setTimeout(() => resolve(null), 3000); // blocked or very slow: give up
      req.onupgradeneeded = () => { try { req.result.createObjectStore(STORE); } catch { /* exists */ } };
      req.onsuccess = () => { clearTimeout(t); resolve(req.result); };
      req.onerror = () => { clearTimeout(t); resolve(null); };
      req.onblocked = () => { clearTimeout(t); resolve(null); };
    } catch { resolve(null); }
  });
  return dbp;
}

function run(mode, fn) {
  return openDb().then(db => new Promise(resolve => {
    if (!db) return resolve(null);
    try {
      const tx = db.transaction(STORE, mode);
      const req = fn(tx.objectStore(STORE));
      tx.oncomplete = () => resolve(req ? req.result : null);
      tx.onerror = tx.onabort = () => resolve(null);
    } catch { resolve(null); }
  }));
}

/** The snapshot saved for `key` (user/repo), or null. */
export const readSnapshot = key => run('readonly', s => s.get(key)).then(v => v || null, () => null);

let chain = Promise.resolve();
/** Save the snapshot for `key`. Writes are applied in the order they are made. */
export function writeSnapshot(key, snap) {
  chain = chain.then(() => run('readwrite', s => s.put(snap, key))).catch(() => null);
  return chain;
}

/** Forget the snapshot for `key`. */
export function dropSnapshot(key) {
  chain = chain.then(() => run('readwrite', s => s.delete(key))).catch(() => null);
  return chain;
}
