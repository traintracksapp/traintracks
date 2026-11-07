/**
 * The in-app updater (spec §12). Compares the template's tree with the
 * user's and copies changed app files across in ONE commit, with the user's
 * own token. Only paths under SYNC_PREFIXES are ever written; SYNC_EXCLUDE
 * files are added when missing but never overwritten. Nothing is deleted.
 */
import { SYNC_PREFIXES, SYNC_EXCLUDE, TEMPLATE } from './config.js';
import { GitHubRepo, b64encodeBytes, isConflict } from './github.js';

export function inScope(path, prefixes = SYNC_PREFIXES) {
  return prefixes.some(p => path === p || (p.endsWith('/') && path.startsWith(p)));
}

/** tpl, mine: { path: blobSha } → { changed, added, unchanged, all } */
export function planUpdate(tpl, mine, prefixes = SYNC_PREFIXES, exclude = SYNC_EXCLUDE) {
  const changed = [], added = [];
  let unchanged = 0;
  for (const p of Object.keys(tpl).sort()) {
    if (!inScope(p, prefixes)) continue;
    if (!(p in mine)) added.push(p);
    else if (exclude.includes(p)) unchanged++;
    else if (tpl[p] !== mine[p]) changed.push(p);
    else unchanged++;
  }
  return { changed, added, unchanged, all: [...added, ...changed] };
}

/** Compare version strings ("0.2.0", "0.2.0-dev"): -1, 0, 1. A "-dev" build is older than its release. */
export function compareVersions(a, b) {
  const parse = v => { const [main, pre] = String(v || '0').split('-'); return { n: main.split('.').map(x => parseInt(x, 10) || 0), pre: pre || '' }; };
  const x = parse(a), y = parse(b);
  for (let i = 0; i < Math.max(x.n.length, y.n.length); i++) {
    const p = x.n[i] || 0, q = y.n[i] || 0;
    if (p !== q) return p < q ? -1 : 1;
  }
  if (x.pre === y.pre) return 0;
  if (!x.pre) return 1;
  if (!y.pre) return -1;
  return x.pre < y.pre ? -1 : 1;
}

/** The part of CHANGELOG.md newer than `from` and up to `to` (sections start with "## <version>"). */
export function changelogBetween(text, from, to) {
  const out = [];
  let keep = false;
  for (const l of String(text || '').split(/\r?\n/)) {
    const m = /^##\s+v?(\d[\w.-]*)/.exec(l);
    if (m) keep = compareVersions(m[1], from) > 0 && compareVersions(m[1], to) <= 0;
    if (keep) out.push(l);
  }
  return out.join('\n').trim();
}

/**
 * What an update would do: { plan, templateVersion, changelog, templateHead }.
 * `tpl` and `mine` are GitHubRepo instances. The template is pinned to its
 * current commit, so files downloaded later are exactly the ones compared.
 */
export async function checkForUpdate(tpl, mine, myVersion) {
  const templateHead = await tpl.headSha();
  const [tplTree, myTree, ver] = await Promise.all([tpl.tree(templateHead), mine.tree(), tpl.getText('VERSION', templateHead)]);
  const plan = planUpdate(tplTree, myTree);
  const templateVersion = ver ? ver.text.trim() : null;
  let changelog = '';
  if (plan.all.length) {
    const cl = await tpl.getText('CHANGELOG.md', templateHead);
    if (cl) changelog = changelogBetween(cl.text, myVersion || '0', templateVersion || '999');
  }
  return { plan, templateVersion, changelog, templateHead };
}

/**
 * Copy the planned files from the template into the user's repo as one
 * commit. Re-reads the user's head and retries once if it moved.
 * `download(path)` → bytes; by default through the template's API at the
 * pinned commit (the app passes a raw-file download, which isn't rate-limited).
 */
export async function applyUpdate(tpl, mine, check, onStatus = () => {}, { attempts = 2, download } = {}) {
  const plan = check.plan || check;
  const get = download || (p => tpl.getBytes(p, check.templateHead || tpl.branch));
  const files = [];
  for (const [i, p] of plan.all.entries()) {
    onStatus(`Downloading ${i + 1} of ${plan.all.length}: ${p}`);
    const bytes = await get(p);
    if (bytes != null) files.push({ path: p, content: b64encodeBytes(bytes) });
  }
  for (let attempt = 1; ; attempt++) {
    try {
      onStatus('Saving the update as one commit…');
      const head = await mine.headSha();
      const parent = await mine.req('GET', `/git/commits/${head}`);
      const tree = [];
      for (const f of files) {
        const blob = await mine.req('POST', '/git/blobs', { body: { content: f.content, encoding: 'base64' } });
        tree.push({ path: f.path, mode: '100644', type: 'blob', sha: blob.sha });
      }
      const t = await mine.req('POST', '/git/trees', { body: { base_tree: parent.tree.sha, tree } });
      const c = await mine.req('POST', '/git/commits', { body: { message: `Update TrainTracks app files from the template (${files.length})`, tree: t.sha, parents: [head] } });
      await mine.req('PATCH', `/git/refs/heads/${encodeURIComponent(mine.branch)}`, { body: { sha: c.sha, force: false } });
      return files.length;
    } catch (e) {
      if (!isConflict(e) || attempt >= attempts) throw e;
    }
  }
}

/** The template repo (public: no token needed). */
export const templateRepo = (fetchFn) => new GitHubRepo({ owner: TEMPLATE.owner, repo: TEMPLATE.repo, branch: TEMPLATE.branch, fetch: fetchFn });
