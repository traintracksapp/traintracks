/**
 * The only code that talks to GitHub. `fetch` is injectable so tests run
 * against a fake.
 *
 * - Reads go through the Contents API (live, and it returns the blob sha a
 *   write needs). Never read through raw.githubusercontent.com anything you
 *   will write back: it caches for ~5 minutes.
 * - Single-file writes are Contents-API PUTs carrying the loaded sha.
 * - The log (JSON + CSV) is written as ONE commit through the Git Data API
 *   (file contents inline in the tree request); a ref update that isn't a
 *   fast-forward means someone else wrote first, and commitLog() reloads and
 *   re-applies.
 */

export class GitHubError extends Error {
  constructor(status, message, url) {
    super(message);
    this.name = 'GitHubError';
    this.status = status;
    this.url = url;
  }
}

/** 409/422: the sha or branch moved since it was read. */
export function isConflict(e) {
  return !!e && (e.status === 409 || e.status === 422);
}

export function b64encodeBytes(bytes) {
  let bin = '';
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
  return btoa(bin);
}
export const b64encodeText = s => b64encodeBytes(new TextEncoder().encode(s));
export function b64decodeText(b64) {
  const bin = atob(String(b64 || '').replace(/\s/g, ''));
  return new TextDecoder().decode(Uint8Array.from(bin, c => c.charCodeAt(0)));
}

const encPath = p => String(p).split('/').map(encodeURIComponent).join('/');

export class GitHubRepo {
  /** { owner, repo, token, branch = 'main', fetch, api = 'https://api.github.com' } */
  constructor(o) {
    this.owner = o.owner;
    this.repo = o.repo;
    this.token = o.token || '';
    this.branch = o.branch || 'main';
    this.api = o.api || 'https://api.github.com';
    this._fetch = o.fetch || ((...a) => globalThis.fetch(...a));
  }

  get base() { return `${this.api}/repos/${encodeURIComponent(this.owner)}/${encodeURIComponent(this.repo)}`; }

  async req(method, path, { body, accept, raw } = {}) {
    const headers = { Accept: accept || 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28' };
    if (this.token) headers.Authorization = `Bearer ${this.token}`;
    const init = { method, headers };
    if (body !== undefined) { headers['Content-Type'] = 'application/json'; init.body = JSON.stringify(body); }
    const url = this.base + path;
    const r = await this._fetch(url, init);
    if (!r.ok) {
      let msg = `GitHub ${r.status}`;
      try { const j = await r.json(); if (j && j.message) msg += `: ${j.message}`; } catch { /* no body */ }
      throw new GitHubError(r.status, msg, url);
    }
    if (raw) return r;
    return r.status === 204 ? null : r.json();
  }

  /** Repository info ({ default_branch, ... }). */
  info() { return this.req('GET', ''); }

  /** Commit sha at the head of the branch. */
  async headSha() {
    const j = await this.req('GET', `/git/ref/heads/${encodeURIComponent(this.branch)}`);
    return j.object.sha;
  }

  /** A text file: { text, sha } or null if absent. `ref` = commit sha or branch (default branch). */
  async getText(path, ref = this.branch) {
    const q = `/contents/${encPath(path)}?ref=${encodeURIComponent(ref)}`;
    let j;
    try { j = await this.req('GET', q); } catch (e) { if (e.status === 404) return null; throw e; }
    if (Array.isArray(j)) throw new GitHubError(400, `${path} is a directory`, path);
    let text;
    if (j.content) text = b64decodeText(j.content);
    else text = await (await this.req('GET', q, { accept: 'application/vnd.github.raw+json', raw: true })).text(); // files > 1 MB
    return { text, sha: j.sha };
  }

  /** A JSON file: { data, sha } or null if absent. */
  async getJSON(path, ref) {
    const f = await this.getText(path, ref);
    return f && { data: JSON.parse(f.text), sha: f.sha };
  }

  /** A binary file as bytes, or null if absent. */
  async getBytes(path, ref = this.branch) {
    try {
      const r = await this.req('GET', `/contents/${encPath(path)}?ref=${encodeURIComponent(ref)}`, { accept: 'application/vnd.github.raw+json', raw: true });
      return new Uint8Array(await r.arrayBuffer());
    } catch (e) { if (e.status === 404) return null; throw e; }
  }

  /** Directory listing [{ name, path, type, sha }] ([] if absent). */
  async listDir(path) {
    try {
      const j = await this.req('GET', `/contents/${encPath(path)}?ref=${encodeURIComponent(this.branch)}`);
      return Array.isArray(j) ? j : [];
    } catch (e) { if (e.status === 404) return []; throw e; }
  }

  /** Write one file. `content`: string or Uint8Array. `sha`: the loaded blob sha (null to create). Returns the new sha. */
  async putFile(path, content, sha, message) {
    const body = { message: message || `Update ${path}`, branch: this.branch,
      content: typeof content === 'string' ? b64encodeText(content) : b64encodeBytes(content) };
    if (sha) body.sha = sha;
    const j = await this.req('PUT', `/contents/${encPath(path)}`, { body });
    return j.content.sha;
  }

  /** Delete one file (sha = its current blob sha). */
  async deleteFile(path, sha, message) {
    await this.req('DELETE', `/contents/${encPath(path)}`, { body: { message: message || `Delete ${path}`, sha, branch: this.branch } });
  }

  /** Tree sha of a commit. */
  async commitTree(sha) {
    const j = await this.req('GET', `/git/commits/${encodeURIComponent(sha)}`);
    return j.tree.sha;
  }

  /**
   * Write several text files as one commit on top of `parentSha`, whose tree
   * is `baseTree` (looked up if not given). `files` = { path: text }. The
   * contents go inline in the tree request (no separate blob uploads, no
   * base64), so with `baseTree` known this is 3 calls: POST trees, POST
   * commits, PATCH ref. Throws a conflict (422) if the branch moved past
   * `parentSha`. Returns { commit, tree } (the new shas).
   */
  async commitFiles(files, message, parentSha, baseTree) {
    baseTree = baseTree || await this.commitTree(parentSha);
    const tree = Object.entries(files).map(([path, content]) => ({ path, mode: '100644', type: 'blob', content }));
    const t = await this.req('POST', '/git/trees', { body: { base_tree: baseTree, tree } });
    const c = await this.req('POST', '/git/commits', { body: { message, tree: t.sha, parents: [parentSha] } });
    await this.req('PATCH', `/git/refs/heads/${encodeURIComponent(this.branch)}`, { body: { sha: c.sha, force: false } });
    return { commit: c.sha, tree: t.sha };
  }

  /** { path: blobSha } for every file on a branch. */
  async tree(branch = this.branch) {
    const j = await this.req('GET', `/git/trees/${encodeURIComponent(branch)}?recursive=1`);
    const map = {};
    for (const t of j.tree || []) if (t.type === 'blob') map[t.path] = t.sha;
    return map;
  }

  /** Start a workflow (needs Actions: read & write on the token). */
  dispatch(workflowFile, inputs = {}) {
    return this.req('POST', `/actions/workflows/${encodeURIComponent(workflowFile)}/dispatches`, { body: { ref: this.branch, inputs } });
  }

  /** Public raw URL, for read-only display assets only. */
  rawUrl(path) {
    return `https://raw.githubusercontent.com/${this.owner}/${this.repo}/${this.branch}/${encPath(path)}`;
  }
}
