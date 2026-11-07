/**
 * An in-memory GitHub for tests: one repo, one branch, real commit history.
 * Supports the Contents API (GET/PUT/DELETE, ?ref=), the Git Data API
 * (refs, commits, trees, blobs) and repo info. Writes made with `write()`
 * stand in for another writer (a device, the coach, an Action).
 */
const dec = b64 => new TextDecoder().decode(Uint8Array.from(atob(b64), c => c.charCodeAt(0)));
const enc = s => { const b = new TextEncoder().encode(s); let x = ''; b.forEach(c => { x += String.fromCharCode(c); }); return btoa(x); };

export function createFakeGitHub(initial = {}, { branch = 'main' } = {}) {
  let n = 0;
  const id = p => `${p}${(++n).toString(16).padStart(8, '0')}`;
  const blobs = new Map();   // sha -> text
  const trees = new Map();   // sha -> Map(path -> blobSha)
  const commits = new Map(); // sha -> { tree, parents, message }
  const calls = [];
  const hooks = { beforePatchRef: null, failNext: null };

  // Like git, a blob's sha comes from its content, so the same file has the same sha in any repo.
  const hash = s => { let h1 = 0x811c9dc5, h2 = 0x01000193; for (let i = 0; i < s.length; i++) { const c = s.charCodeAt(i); h1 = Math.imul(h1 ^ c, 16777619) >>> 0; h2 = Math.imul(h2 ^ c, 2246822519) >>> 0; } return h1.toString(16).padStart(8, '0') + h2.toString(16).padStart(8, '0'); };
  const blob = text => { const s = `b${hash(text)}`; blobs.set(s, text); return s; };
  const mkTree = m => { const s = id('t'); trees.set(s, m); return s; };
  const mkCommit = (tree, parents, message) => { const s = id('c'); commits.set(s, { tree, parents, message }); return s; };

  const t0 = new Map(Object.entries(initial).map(([p, c]) => [p, blob(c)]));
  let head = mkCommit(mkTree(t0), [], 'initial');

  const filesAt = ref => {
    const c = commits.get(ref === branch || ref == null ? head : ref);
    return c ? trees.get(c.tree) : null;
  };
  /** Another writer commits `files` ({path: text|null}) straight to the branch. */
  function write(files, message = 'external write') {
    const m = new Map(trees.get(commits.get(head).tree));
    for (const [p, t] of Object.entries(files)) t == null ? m.delete(p) : m.set(p, blob(t));
    head = mkCommit(mkTree(m), [head], message);
    return head;
  }
  const isAncestor = (anc, sha) => {
    const seen = [sha];
    while (seen.length) { const s = seen.pop(); if (s === anc) return true; const c = commits.get(s); if (c) seen.push(...c.parents); }
    return false;
  };

  const res = (status, body) => ({ ok: status < 300, status, json: async () => body, text: async () => (typeof body === 'string' ? body : JSON.stringify(body)),
    arrayBuffer: async () => new TextEncoder().encode(typeof body === 'string' ? body : '').buffer });

  async function fetch(url, init = {}) {
    const method = init.method || 'GET';
    const u = new URL(url);
    calls.push({ method, path: u.pathname });
    if (hooks.failNext) { const f = hooks.failNext; hooks.failNext = null; return res(f.status, { message: f.message || 'fail' }); }
    const m = /^\/repos\/[^/]+\/[^/]+(\/.*)?$/.exec(u.pathname);
    if (!m) return res(404, { message: 'Not Found' });
    const rest = m[1] || '';
    const body = init.body ? JSON.parse(init.body) : null;
    const ref = u.searchParams.get('ref');

    if (rest === '') return res(200, { default_branch: branch, private: false });
    if (rest === `/git/ref/heads/${branch}`) return res(200, { object: { sha: head } });
    if (rest.startsWith('/git/commits/') && method === 'GET') {
      const s = rest.slice('/git/commits/'.length), c = commits.get(s);
      return c ? res(200, { sha: s, tree: { sha: c.tree }, parents: c.parents.map(p => ({ sha: p })) }) : res(404, { message: 'Not Found' });
    }
    if (rest === '/git/blobs' && method === 'POST') return res(201, { sha: blob(dec(body.content)) });
    if (rest === '/git/trees' && method === 'POST') {
      const m2 = new Map(body.base_tree ? trees.get(body.base_tree) : []);
      for (const e of body.tree) e.sha == null ? m2.delete(e.path) : m2.set(e.path, e.sha);
      return res(201, { sha: mkTree(m2) });
    }
    if (rest === '/git/commits' && method === 'POST') return res(201, { sha: mkCommit(body.tree, body.parents, body.message) });
    if (rest === `/git/refs/heads/${branch}` && method === 'PATCH') {
      if (hooks.beforePatchRef) { const h = hooks.beforePatchRef; hooks.beforePatchRef = null; h(); }
      if (!body.force && !isAncestor(head, body.sha)) return res(422, { message: 'Update is not a fast forward' });
      head = body.sha;
      return res(200, { object: { sha: head } });
    }
    if (rest.startsWith('/git/trees/')) {
      return res(200, { tree: [...filesAt(null)].map(([path, sha]) => ({ path, type: 'blob', sha })) });
    }
    if (rest.startsWith('/actions/workflows/')) return res(204, null);
    if (rest.startsWith('/contents/')) {
      const path = decodeURIComponent(rest.slice('/contents/'.length));
      const files = filesAt(ref);
      if (!files) return res(404, { message: 'No commit found for the ref' });
      if (method === 'GET') {
        if (files.has(path)) {
          const s = files.get(path), text = blobs.get(s);
          if ((init.headers || {}).Accept === 'application/vnd.github.raw+json') return res(200, text);
          return res(200, { path, sha: s, content: enc(text) });
        }
        const prefix = path ? path + '/' : '';
        const kids = new Map();
        for (const [p, s] of files) {
          if (!p.startsWith(prefix)) continue;
          const tail = p.slice(prefix.length), name = tail.split('/')[0], dir = tail.includes('/');
          if (!kids.has(name)) kids.set(name, { name, path: prefix + name, type: dir ? 'dir' : 'file', sha: dir ? 'tree' : s });
        }
        return kids.size ? res(200, [...kids.values()]) : res(404, { message: 'Not Found' });
      }
      const cur = trees.get(commits.get(head).tree).get(path);
      if (method === 'PUT') {
        if (cur && body.sha !== cur) return res(409, { message: `${path} does not match ${body.sha}` });
        if (!cur && body.sha) return res(422, { message: 'sha given for a new file' });
        write({ [path]: dec(body.content) }, body.message);
        return res(cur ? 200 : 201, { content: { path, sha: trees.get(commits.get(head).tree).get(path) }, commit: { sha: head } });
      }
      if (method === 'DELETE') {
        if (!cur) return res(404, { message: 'Not Found' });
        if (body.sha !== cur) return res(409, { message: 'stale' });
        write({ [path]: null }, body.message);
        return res(200, { commit: { sha: head } });
      }
    }
    return res(404, { message: 'no route' });
  }

  return {
    fetch, calls, hooks, write,
    read: p => { const s = filesAt(null).get(p); return s == null ? null : blobs.get(s); },
    get head() { return head; },
    commitCount: () => { let k = 0, s = head; while (s) { k++; s = commits.get(s).parents[0]; } return k; },
    lastMessage: () => commits.get(head).message
  };
}
