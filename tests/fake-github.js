/**
 * In-memory stand-in for the GitHub Contents API, enough for the app's data
 * layer: GET/PUT/DELETE contents, directory listings, trees, repo info.
 * Blob shas are fake but change on every write, which is what the sha
 * conflict logic depends on.
 */
import { b64encodeText } from '../lib/github.js';

export function createFakeGitHub(initialFiles = {}, opts = {}) {
  const files = new Map(); // path -> { content: string, sha }
  let seq = 0;
  const sha = () => `sha${(++seq).toString().padStart(6, '0')}`;
  Object.entries(initialFiles).forEach(([p, c]) => files.set(p, { content: c, sha: sha() }));
  const log = [];
  const state = { files, log, failNext: null, private: !!opts.private };

  function json(status, body) {
    return { ok: status >= 200 && status < 300, status, json: async () => body, text: async () => JSON.stringify(body), arrayBuffer: async () => new TextEncoder().encode(typeof body === 'string' ? body : '').buffer };
  }

  async function fetch(url, init = {}) {
    const method = init.method || 'GET';
    log.push({ method, url });
    if (state.failNext) { const f = state.failNext; state.failNext = null; return json(f.status, { message: f.message || 'fail' }); }
    const u = new URL(url);
    const m = /^\/repos\/([^/]+)\/([^/]+)(\/.*)?$/.exec(u.pathname);
    if (!m) return json(404, { message: 'no route' });
    const rest = m[3] || '';
    if (rest === '') return json(200, { private: state.private, default_branch: 'main' });
    if (rest.startsWith('/git/trees/')) {
      return json(200, { tree: [...files.entries()].map(([path, f]) => ({ path, type: 'blob', sha: f.sha })) });
    }
    if (rest.startsWith('/actions/workflows/')) return json(204, null);
    if (rest.startsWith('/contents/')) {
      const path = decodeURIComponent(rest.slice('/contents/'.length));
      if (method === 'GET') {
        if (files.has(path)) {
          const f = files.get(path);
          if ((init.headers || {}).Accept === 'application/vnd.github.raw+json') return { ok: true, status: 200, text: async () => f.content, arrayBuffer: async () => new TextEncoder().encode(f.content).buffer, json: async () => ({}) };
          return json(200, { path, sha: f.sha, size: f.content.length, content: b64encodeText(f.content) });
        }
        const prefix = path ? path + '/' : '';
        const kids = new Map();
        for (const [p, f] of files) {
          if (!p.startsWith(prefix)) continue;
          const restp = p.slice(prefix.length);
          const name = restp.split('/')[0];
          if (!kids.has(name)) kids.set(name, { name, path: prefix + name, type: restp.includes('/') ? 'dir' : 'file', sha: restp.includes('/') ? 'tree' : f.sha, size: f.content.length });
        }
        if (!kids.size) return json(404, { message: 'Not Found' });
        return json(200, [...kids.values()]);
      }
      if (method === 'PUT') {
        const body = JSON.parse(init.body);
        const cur = files.get(path);
        if (cur && body.sha !== cur.sha) return json(409, { message: `${path} does not match ${cur.sha}` });
        if (!cur && body.sha) return json(422, { message: 'sha given for a new file' });
        const content = new TextDecoder().decode(Uint8Array.from(atob(body.content), c => c.charCodeAt(0)));
        const s = sha();
        files.set(path, { content, sha: s });
        return json(cur ? 200 : 201, { content: { sha: s, path }, commit: { sha: 'c' + s } });
      }
      if (method === 'DELETE') {
        const body = JSON.parse(init.body);
        const cur = files.get(path);
        if (!cur) return json(404, { message: 'Not Found' });
        if (body.sha !== cur.sha) return json(409, { message: 'stale' });
        files.delete(path);
        return json(200, { commit: {} });
      }
    }
    return json(404, { message: 'no route' });
  }

  return { fetch, state, files, log, read: p => files.get(p) && files.get(p).content, write: (p, c) => files.set(p, { content: c, sha: sha() }) };
}
