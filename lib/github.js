/**
 * The one module that talks to GitHub. Everything goes through the Contents
 * API (always live, returns the blob sha needed for writes) — never through
 * raw.githubusercontent.com for anything we might write back or that must be
 * fresh. `fetch` is injectable so tests can run against a fake.
 *
 * Errors are thrown as GitHubError { status, message, path }.
 */

export class GitHubError extends Error {
  constructor(status, message, path) {
    super(message);
    this.name = 'GitHubError';
    this.status = status;
    this.path = path;
  }
}

export function b64encodeText(s) {
  const bytes = new TextEncoder().encode(s);
  return b64encodeBytes(bytes);
}

export function b64decodeText(b64) {
  const bin = atob(String(b64 || '').replace(/\s/g, ''));
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return new TextDecoder().decode(bytes);
}

export function b64encodeBytes(bytes) {
  let bin = '';
  const CHUNK = 0x8000;
  for (let i = 0; i < bytes.length; i += CHUNK) bin += String.fromCharCode.apply(null, bytes.subarray(i, i + CHUNK));
  return btoa(bin);
}

export function apiPath(path) {
  return String(path).split('/').map(encodeURIComponent).join('/');
}

export class GitHubRepo {
  /** opts: { owner, repo, token, branch='main', fetch=globalThis.fetch, api='https://api.github.com' } */
  constructor(opts) {
    this.owner = opts.owner;
    this.repo = opts.repo;
    this.token = opts.token || '';
    this.branch = opts.branch || 'main';
    this.api = opts.api || 'https://api.github.com';
    this._fetch = opts.fetch || ((...a) => globalThis.fetch(...a));
  }

  get base() { return `${this.api}/repos/${this.owner}/${this.repo}`; }

  headers(extra) {
    const h = { Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28', ...(extra || {}) };
    if (this.token) h.Authorization = `Bearer ${this.token}`;
    return h;
  }

  async _req(method, url, { body, accept, raw } = {}) {
    const init = { method, headers: this.headers(accept ? { Accept: accept } : null) };
    if (body !== undefined) { init.headers['Content-Type'] = 'application/json'; init.body = JSON.stringify(body); }
    const r = await this._fetch(url, init);
    if (!r.ok) {
      let msg = `GitHub ${r.status}`;
      try { const j = await r.json(); if (j && j.message) msg += `: ${j.message}`; } catch (e) { /* no body */ }
      throw new GitHubError(r.status, msg, url);
    }
    if (raw) return r;
    if (r.status === 204) return null;
    return r.json();
  }

  /** { private, default_branch, ... } */
  async info() { return this._req('GET', this.base); }

  /** Read a text file: { text, sha, size, path } (null if 404). */
  async getText(path) {
    let j;
    try { j = await this._req('GET', `${this.base}/contents/${apiPath(path)}?ref=${this.branch}`); }
    catch (e) { if (e.status === 404) return null; throw e; }
    if (Array.isArray(j)) throw new GitHubError(400, `${path} is a directory`, path);
    let text;
    if (j.content) text = b64decodeText(j.content);
    else {
      // >1 MB files come back without content; fetch the raw media type instead
      const r = await this._req('GET', `${this.base}/contents/${apiPath(path)}?ref=${this.branch}`, { accept: 'application/vnd.github.raw+json', raw: true });
      text = await r.text();
    }
    return { text, sha: j.sha, size: j.size, path };
  }

  /** Read a JSON file: { data, sha } (null if 404). */
  async getJSON(path) {
    const f = await this.getText(path);
    if (!f) return null;
    return { data: JSON.parse(f.text), sha: f.sha, path };
  }

  /** Binary file as bytes (Uint8Array), or null on 404. */
  async getBytes(path) {
    try {
      const r = await this._req('GET', `${this.base}/contents/${apiPath(path)}?ref=${this.branch}`, { accept: 'application/vnd.github.raw+json', raw: true });
      return new Uint8Array(await r.arrayBuffer());
    } catch (e) { if (e.status === 404) return null; throw e; }
  }

  /** Directory listing: [{ name, path, type, sha, size }] ([] if 404). */
  async listDir(path) {
    try {
      const j = await this._req('GET', `${this.base}/contents/${apiPath(path)}?ref=${this.branch}`);
      return Array.isArray(j) ? j : [];
    } catch (e) { if (e.status === 404) return []; throw e; }
  }

  /** The sha of a file without reading it (null if absent). */
  async shaOf(path) {
    const dir = path.includes('/') ? path.slice(0, path.lastIndexOf('/')) : '';
    const name = path.slice(path.lastIndexOf('/') + 1);
    const list = await this.listDir(dir);
    const f = list.find(x => x.name === name);
    return f ? f.sha : null;
  }

  /**
   * Write a file. `content` is a string (text) or a Uint8Array (binary).
   * `sha` is the blob sha the caller loaded (null to create). GitHub answers
   * 409 (or 422) when the sha is stale: the file changed underneath us.
   * Returns { sha, commit }.
   */
  async put(path, content, sha, message) {
    const body = { message: message || `Update ${path}`, branch: this.branch };
    body.content = typeof content === 'string' ? b64encodeText(content) : b64encodeBytes(content);
    if (sha) body.sha = sha;
    const j = await this._req('PUT', `${this.base}/contents/${apiPath(path)}`, { body });
    return { sha: j.content.sha, commit: j.commit && j.commit.sha };
  }

  /**
   * put() that survives a stale sha: on 409/422 it re-reads the current sha
   * and, if `rebase` is given, calls rebase(currentText) to produce the
   * content to write; otherwise it overwrites with the same content.
   */
  async putWithRetry(path, content, sha, message, rebase) {
    try { return await this.put(path, content, sha, message); }
    catch (e) {
      if (!isConflict(e)) throw e;
      const cur = await this.getText(path);
      const next = rebase ? await rebase(cur ? cur.text : null) : content;
      if (next == null) throw e;
      return this.put(path, next, cur ? cur.sha : null, message);
    }
  }

  async delete(path, sha, message) {
    await this._req('DELETE', `${this.base}/contents/${apiPath(path)}`, { body: { message: message || `Delete ${path}`, sha, branch: this.branch } });
    return true;
  }

  /** { path: blobSha } for the whole branch. */
  async tree(branch) {
    const j = await this._req('GET', `${this.base}/git/trees/${encodeURIComponent(branch || this.branch)}?recursive=1`);
    const map = {};
    (j.tree || []).forEach(t => { if (t.type === 'blob') map[t.path] = t.sha; });
    return map;
  }

  /** Trigger a workflow_dispatch (needs Actions: write on the token). */
  async dispatch(workflowFile, inputs) {
    await this._req('POST', `${this.base}/actions/workflows/${encodeURIComponent(workflowFile)}/dispatches`, { body: { ref: this.branch, inputs: inputs || {} } });
    return true;
  }

  rawUrl(path) {
    return `https://raw.githubusercontent.com/${this.owner}/${this.repo}/${this.branch}/${apiPath(path)}`;
  }
}

export function isConflict(e) {
  return e && (e.status === 409 || e.status === 422);
}
