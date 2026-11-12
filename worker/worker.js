// TrainTracks Worker — an optional relay for Claude Code, CoWork and skills (spec §11).
//
// It holds your GitHub token so the caller only needs the Worker's own secret.
// The coach in a claude.ai Project does NOT need this (it talks to
// api.github.com directly; *.workers.dev is not reachable from a personal-plan
// claude.ai sandbox).
//
// Authenticate every request with the header
//     Authorization: Bearer <SECRET_TOKEN>
// (?token=<SECRET_TOKEN> also works, for older callers). Whitespace around the
// secret is ignored on both sides.
//
// The log is one file per month, log/YYYY-MM.json (format version 3,
// docs/DATA-FORMAT.md); a GitHub Action rebuilds workout-log.csv from it about
// a minute after each write. Callers still see and send the whole log.
//
// Endpoints (all JSON unless noted):
//   GET  /                 health check: name, version and the endpoint list
//   GET  /log              workout-log.csv (text/csv; may be about a minute behind a write)
//   GET  /log-json         { log_json, head, entries, months, csv_rows, in_sync } read live: log_json is
//                          the whole log (all months, newest first); send `head` back to /log-write
//   POST /log-write        body { log_json, base_head, message?, allow_shrink? }: the whole log, edited.
//                          Commits only the month files that changed, as ONE commit on top of base_head.
//                          409 if the branch moved since that read; 409 if the log would shrink without
//                          allow_shrink; 409 if the repo's log is not split into months yet.
//   GET  /profile, /goals, /garmin   profile.json, goals.json, garmin-recent.json
//   POST /plan             body = the plan JSON (suggested-workout.json, format version 2)
//   POST /trigger-garmin   body { fetch_limit?, max_days? }   runs the garmin.yml workflow
//
// Settings (Cloudflare → Worker → Settings → Variables and Secrets), then click Deploy:
//   SECRET_TOKEN  a long random string you choose (secret)
//   GITHUB_PAT    fine-grained token for ONLY your TrainTracks repo: Contents read/write,
//                 Actions read/write (secret)
//   GITHUB_USER   your GitHub username
//   GITHUB_REPO   your repository name (usually traintracks)
//   GITHUB_BRANCH optional, default main

const VERSION = '0.3.0';
const LOG_COLUMNS = [
  'id', 'date', 'time', 'gym_id', 'gym', 'room_id', 'room', 'machine_id', 'machine',
  'variant', 'set', 'weight_lb', 'reps', 'duration_sec', 'duration_min', 'distance_mi', 'speed_mph',
  'level', 'incline_pct', 'hr_avg_bpm', 'garmin_id',
  'zone1_min', 'zone2_min', 'zone3_min', 'zone4_min', 'zone5_min', 'notes'
];

// ---- the log files, written exactly as the app writes them (lib/log.js) ----
export function csvField(v) {
  if (v == null) return '';
  let s = Array.isArray(v) ? v.join('; ') : String(v);
  if (/[",\r\n]/.test(s)) s = '"' + s.replace(/"/g, '""') + '"';
  return s;
}
const round2 = x => Math.round(x * 100) / 100;
const numOrNull = v => (v == null || v === '' || isNaN(+v) ? null : +v);
// duration_min is computed (export only); zone minutes come from zone{i}_sec on rows older than 0.2.1.
export function csvRow(e) {
  const d = numOrNull(e.duration_sec);
  const r = { ...e, duration_min: d == null ? null : round2(d / 60) };
  for (let i = 1; i <= 5; i++) {
    if (r[`zone${i}_min`] != null) continue;
    const m = numOrNull(e[`zone${i}_min`]), s = numOrNull(e[`zone${i}_sec`]);
    r[`zone${i}_min`] = m != null ? m : s != null ? round2(s / 60) : null;
  }
  return r;
}
export const logToCSV = log => [LOG_COLUMNS.join(','), ...log.map(e => { const r = csvRow(e); return LOG_COLUMNS.map(c => csvField(r[c])).join(','); })].join('\n') + '\n';
export const logToJSON = log => JSON.stringify(log, null, 2) + '\n';

// ---- the month files, exactly as lib/months.js ----
const MONTH_FILE = /^log\/(\d{4})-(0[1-9]|1[0-2])\.json$/;
const UNDATED = 'log/undated.json';
export const isMonthFile = p => MONTH_FILE.test(p) || p === UNDATED;
export function monthPathOf(e) {
  const m = /^(\d{4})-(0[1-9]|1[0-2])-\d{2}/.exec((e && typeof e.date === 'string' && e.date) || '');
  return m ? `log/${m[1]}-${m[2]}.json` : UNDATED;
}
const sortMonthPaths = paths => [...paths].sort((a, b) => (a === UNDATED ? 1 : b === UNDATED ? -1 : a < b ? 1 : a > b ? -1 : 0));
export function splitLog(log) {
  const out = {};
  for (const e of log || []) (out[monthPathOf(e)] ||= []).push(e);
  for (const p of Object.keys(out)) {
    out[p] = out[p].map((e, i) => [e, i]).sort(([a, i], [b, j]) => {
      const x = (a && a.date) || '', y = (b && b.date) || '';
      return x < y ? 1 : x > y ? -1 : i - j;
    }).map(([e]) => e);
  }
  return out;
}
export const joinMonths = months => sortMonthPaths(Object.keys(months)).flatMap(p => months[p] || []);
export const monthToText = entries => (entries && entries.length ? '[\n' + entries.map(e => JSON.stringify(e)).join(',\n') + '\n]\n' : '[]\n');

const b64 = s => { const b = new TextEncoder().encode(s); let x = ''; for (let i = 0; i < b.length; i += 0x8000) x += String.fromCharCode.apply(null, b.subarray(i, i + 0x8000)); return btoa(x); };
const unb64 = s => new TextDecoder().decode(Uint8Array.from(atob(String(s).replace(/\s/g, '')), c => c.charCodeAt(0)));

export default {
  async fetch(request, env) {
    const cors = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Methods': 'GET, POST, OPTIONS', 'Access-Control-Allow-Headers': 'Authorization, Content-Type' };
    const json = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { ...cors, 'Content-Type': 'application/json' } });
    if (request.method === 'OPTIONS') return new Response(null, { headers: cors });

    const url = new URL(request.url);
    const auth = request.headers.get('Authorization') || '';
    const given = (auth.replace(/^Bearer\s+/i, '') || url.searchParams.get('token') || '').trim();
    const secret = String(env.SECRET_TOKEN || '').trim();
    if (!secret || !given || given !== secret) return json({ error: 'Unauthorized: send the Worker secret as "Authorization: Bearer <secret>"' }, 401);

    const branch = env.GITHUB_BRANCH || 'main';
    const base = `https://api.github.com/repos/${encodeURIComponent(env.GITHUB_USER)}/${encodeURIComponent(env.GITHUB_REPO)}`;
    const gh = async (method, path, body, accept) => {
      const res = await fetch(base + path, {
        method,
        headers: { Authorization: `Bearer ${String(env.GITHUB_PAT || '').trim()}`, Accept: accept || 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28', 'User-Agent': `TrainTracks-Worker/${VERSION}`, ...(body ? { 'Content-Type': 'application/json' } : {}) },
        body: body ? JSON.stringify(body) : undefined
      });
      const text = res.status === 204 ? '' : await res.text();
      if (!res.ok) { const e = new Error(`GitHub ${res.status}: ${(() => { try { return JSON.parse(text).message; } catch { return text.slice(0, 200); } })()}`); e.status = res.status; throw e; }
      return text;
    };
    const head = async () => JSON.parse(await gh('GET', `/git/ref/heads/${encodeURIComponent(branch)}`)).object.sha;
    const RAW = 'application/vnd.github.raw+json';
    // The log at a commit: its tree, layout ('months', 'single' = not split yet, 'none') and entries.
    const readLog = async ref => {
      const t = JSON.parse(await gh('GET', `/git/trees/${encodeURIComponent(ref)}?recursive=1`));
      const files = Object.fromEntries((t.tree || []).filter(x => x.type === 'blob').map(x => [x.path, x.sha]));
      const paths = Object.keys(files).filter(isMonthFile);
      const blob = sha => gh('GET', `/git/blobs/${sha}`, null, RAW);
      const months = {};
      let layout = 'none', log = [];
      if (paths.length) {
        layout = 'months';
        await Promise.all(paths.map(async p => { months[p] = JSON.parse(await blob(files[p])); }));
        log = joinMonths(months);
      } else if (files['workout-log.json']) {
        layout = 'single';
        log = JSON.parse(await blob(files['workout-log.json']));
      }
      const csv = files['workout-log.csv'] ? await blob(files['workout-log.csv']) : null;
      return { tree: t.sha, layout, months, log, csv };
    };
    const getFile = async (path, ref = branch) => {
      try {
        const j = JSON.parse(await gh('GET', `/contents/${path}?ref=${encodeURIComponent(ref)}`));
        return j.content ? unb64(j.content) : await gh('GET', `/contents/${path}?ref=${encodeURIComponent(ref)}`, null, 'application/vnd.github.raw+json');
      } catch (e) { if (e.status === 404) return null; throw e; }
    };
    const fail = (e, what) => json({ error: `${what}: ${e.message}` }, e.status === 404 ? 404 : e.status === 409 || e.status === 422 ? 409 : 502);

    try {
      // ---- reads ----
      if (request.method === 'GET' && url.pathname === '/') {
        return json({ ok: true, name: 'TrainTracks Worker', version: VERSION, repo: `${env.GITHUB_USER}/${env.GITHUB_REPO}`,
          endpoints: ['GET /log', 'GET /log-json', 'POST /log-write', 'GET /profile', 'GET /goals', 'GET /garmin', 'POST /plan', 'POST /trigger-garmin'] });
      }
      const plain = { '/profile': 'profile.json', '/goals': 'goals.json', '/garmin': 'garmin-recent.json', '/log': 'workout-log.csv' };
      if (request.method === 'GET' && plain[url.pathname]) {
        const text = await getFile(plain[url.pathname]);
        if (text == null) return json({ error: `${plain[url.pathname]} is not in the repo yet` }, 404);
        return new Response(text, { headers: { ...cors, 'Content-Type': url.pathname === '/log' ? 'text/csv' : 'application/json' } });
      }
      if (request.method === 'GET' && url.pathname === '/log-json') {
        const h = await head();
        const { log, layout, months, csv } = await readLog(h);
        return json({ ok: true, head: h, log_json: logToJSON(log), entries: log.length, layout, months: Object.keys(months).length,
          csv_rows: csv ? csv.trim().split('\n').length - 1 : 0, in_sync: csv === logToCSV(log) });
      }

      // ---- writes ----
      if (url.pathname === '/log-write' || url.pathname === '/plan' || url.pathname === '/trigger-garmin') {
        if (request.method !== 'POST') return json({ error: 'Use POST with a JSON body' }, 405);
        let body;
        try { body = await request.json(); } catch (e) { return json({ error: `The body is not valid JSON: ${e.message}` }, 400); }

        if (url.pathname === '/trigger-garmin') {
          const inputs = {};
          if (body && body.fetch_limit != null) inputs.fetch_limit = String(body.fetch_limit);
          if (body && body.max_days != null) inputs.max_days = String(body.max_days);
          await gh('POST', '/actions/workflows/garmin.yml/dispatches', { ref: branch, inputs });
          return json({ ok: true, message: 'Garmin workflow started; files update in a few minutes.' });
        }

        if (url.pathname === '/plan') {
          if (!body || typeof body !== 'object' || !Array.isArray(body.exercises)) return json({ error: 'A plan is an object with an "exercises" list (see docs/COACH.md)' }, 400);
          if (body.exercises.some(e => !e || typeof e !== 'object' || !e.machine_id)) return json({ error: 'Every exercise needs a machine_id' }, 400);
          if (!body.generated_at) body.generated_at = new Date().toISOString().replace(/\.\d+Z$/, 'Z');
          let sha = null;
          try { sha = JSON.parse(await gh('GET', `/contents/suggested-workout.json?ref=${encodeURIComponent(branch)}`)).sha; } catch (e) { if (e.status !== 404) throw e; }
          await gh('PUT', '/contents/suggested-workout.json', { message: 'Update workout plan', content: b64(JSON.stringify(body, null, 2) + '\n'), branch, ...(sha ? { sha } : {}) });
          return json({ ok: true, message: "Plan saved. Open TrainTracks to see Today's Route." });
        }

        // /log-write
        const { log_json: logJson, base_head: baseHead, message, allow_shrink: allowShrink } = body || {};
        if (typeof logJson !== 'string' || !logJson.trim()) return json({ error: 'Send log_json: the full workout-log.json text' }, 400);
        if (typeof baseHead !== 'string' || !baseHead) return json({ error: 'Send base_head: the "head" from the GET /log-json you edited. Nothing was written.' }, 400);
        let log;
        try { log = JSON.parse(logJson); if (!Array.isArray(log)) throw new Error('not a list'); } catch (e) { return json({ error: `log_json is not a JSON list: ${e.message}` }, 400); }
        if (log.some(e => !e || typeof e !== 'object' || 'machineId' in e || !e.machine_id || !e.date)) return json({ error: 'Every entry needs machine_id and date (format version 2, docs/DATA-FORMAT.md)' }, 400);

        const h = await head();
        if (h !== baseHead) return json({ error: 'The repo changed since you read the log. Nothing was written. GET /log-json again, re-apply your change to that copy, and resend.', head: h }, 409);
        const cur = await readLog(h);
        if (cur.layout === 'single') return json({ error: 'The log is still one file (workout-log.json): split it into months first (TrainTracks 0.3.0, docs/SETUP.md "Upgrading to 0.3.0"). Nothing was written.' }, 409);
        const before = cur.log.length;
        if (log.length < before && !allowShrink) return json({ error: `Refusing to shrink the log (${before} → ${log.length} entries). If deletions are intended, resend with "allow_shrink": true.` }, 409);

        // Only the months that changed, in one commit on top of base_head; the ref update is not forced.
        const next = splitLog(log);
        const tree = [];
        for (const [path, entries] of Object.entries(next)) {
          const text = monthToText(entries);
          if (!cur.months[path] || monthToText(cur.months[path]) !== text) tree.push({ path, mode: '100644', type: 'blob', content: text });
        }
        for (const path of Object.keys(cur.months)) if (!(path in next)) tree.push({ path, mode: '100644', type: 'blob', sha: null });
        if (!tree.length) return json({ ok: true, message: `No change: the log already holds these ${log.length} entries.`, head: h, months_written: [] });
        const t = JSON.parse(await gh('POST', '/git/trees', { base_tree: cur.tree, tree }));
        const c = JSON.parse(await gh('POST', '/git/commits', { message: message || 'Update workout log via Worker', tree: t.sha, parents: [h] }));
        try { await gh('PATCH', `/git/refs/heads/${encodeURIComponent(branch)}`, { sha: c.sha, force: false }); }
        catch (e) { if (e.status === 422) return json({ error: 'The repo changed while writing. Nothing was written. GET /log-json again and redo the change.' }, 409); throw e; }
        return json({ ok: true, message: `Log saved: ${log.length} entries (was ${before}); ${tree.length} month file(s) written. workout-log.csv follows in about a minute.`, head: c.sha, months_written: tree.map(x => x.path).sort() });
      }

      return json({ error: `No such endpoint: ${request.method} ${url.pathname}` }, 404);
    } catch (e) {
      return fail(e, 'GitHub request failed');
    }
  }
};
