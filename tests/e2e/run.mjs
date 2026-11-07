/**
 * Browser smoke test. Serves the app locally, answers api.github.com and
 * raw.githubusercontent.com from the in-memory fake GitHub seeded with a data
 * folder, clicks through the screens and checks what was written.
 *
 *   node tests/e2e/run.mjs [data-dir] [screenshots-dir]
 *
 * data-dir: a TrainTracks user repo in format version 2 (default: the made-up
 * fixture). Never point this at anything but a COPY: nothing is written to
 * disk, but keep it that way.
 */
import { createRequire } from 'node:module';
import http from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createFakeGitHub } from '../fake-github.js';
import { parseCSV } from '../../lib/csv.js';
import { LOG_COLUMNS } from '../../lib/log.js';

const { chromium } = createRequire(import.meta.url)(process.env.PLAYWRIGHT_PATH || 'playwright');
const ROOT = path.resolve(new URL('../..', import.meta.url).pathname);
const DATA = path.resolve(process.argv[2] || path.join(ROOT, 'tests/fixtures/user-repo'));
const SHOTS = path.resolve(process.argv[3] || fs.mkdtempSync(path.join(os.tmpdir(), 'tt-shots-')));
fs.mkdirSync(SHOTS, { recursive: true });

// ---- seed the fake from the data dir; images are served from disk ----
const seed = {}, binaries = {};
function walk(dir, rel = '') {
  for (const name of fs.readdirSync(dir)) {
    if (name === '.git' || name === 'node_modules' || name.endsWith('.mjs')) continue;
    const p = path.join(dir, name), r = rel ? `${rel}/${name}` : name;
    if (fs.statSync(p).isDirectory()) walk(p, r);
    else if (/\.(jpe?g|png|gif|webp)$/i.test(name)) binaries[r] = p;
    else seed[r] = fs.readFileSync(p, 'utf8');
  }
}
walk(DATA);
if (!seed['equipment/generic/gym.json']) walk(path.join(ROOT, 'equipment'), 'equipment');
const fake = createFakeGitHub(seed);

// ---- static server for the app ----
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.webmanifest': 'application/manifest+json' };
const server = http.createServer((req, res) => {
  let p = decodeURIComponent(req.url.split('?')[0]);
  if (p.endsWith('/')) p += 'index.html';
  const f = path.join(ROOT, p);
  if (!f.startsWith(ROOT) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { res.writeHead(404); res.end('nf'); return; }
  res.writeHead(200, { 'Content-Type': MIME[path.extname(f)] || 'application/octet-stream' });
  fs.createReadStream(f).pipe(res);
});
await new Promise(r => server.listen(8089, r));

const browser = await chromium.launch();
const errors = [];
async function openPage(colorScheme = 'dark') {
  const ctx = await browser.newContext({ viewport: { width: 400, height: 820 }, deviceScaleFactor: 1, colorScheme });
  const page = await ctx.newPage();
  page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
  page.on('pageerror', e => errors.push(String(e)));
  await page.route(/https:\/\/api\.github\.com\/.*/, async route => {
    const req = route.request();
    const accept = req.headers().accept;
    const r = await fake.fetch(req.url(), { method: req.method(), headers: { Accept: accept }, body: req.postData() });
    const body = r.status === 204 ? '' : accept === 'application/vnd.github.raw+json' ? await r.text() : JSON.stringify(await r.json());
    await route.fulfill({ status: r.status, contentType: 'application/json', body });
  });
  await page.route(/https:\/\/raw\.githubusercontent\.com\/.*/, async route => {
    const m = /^\/[^/]+\/[^/]+\/[^/]+\/(.*)$/.exec(new URL(route.request().url()).pathname);
    const rel = m ? decodeURIComponent(m[1]) : '';
    if (binaries[rel]) return route.fulfill({ status: 200, contentType: 'image/jpeg', body: fs.readFileSync(binaries[rel]) });
    return route.fulfill({ status: 404, body: 'nf' });
  });
  await page.goto('http://localhost:8089/');
  await page.evaluate(() => localStorage.setItem('tt-cfg', JSON.stringify({ user: 'tester', repo: 'traintracks', token: 'github_pat_test' })));
  await page.goto('http://localhost:8089/');
  await page.waitForFunction(() => !document.getElementById('ld').classList.contains('on'), null, { timeout: 20000 });
  await page.waitForTimeout(300);
  return { ctx, page };
}

let n = 0;
const results = [];
const check = (name, ok, info) => { results.push({ name, ok }); console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}${!ok && info ? ` — ${info}` : ''}`); };
const readLog = () => JSON.parse(fake.read('workout-log.json') || '[]');

const { ctx, page } = await openPage();
const shot = async name => { await page.waitForTimeout(200); await page.screenshot({ path: path.join(SHOTS, `${String(++n).padStart(2, '0')}-${name}.png`), fullPage: true }); };
const text = async sel => (await page.textContent(sel)) || '';
const waitToast = async () => {
  await page.waitForFunction(() => /saved|failed|deleted|editing/i.test(document.getElementById('toast').textContent), null, { timeout: 15000 });
  const t = await text('#toast');
  await page.evaluate(() => { const t = document.getElementById('toast'); t.textContent = ''; t.className = ''; });
  return t;
};
async function goHome() { while (!(await page.$('#s-home.on'))) await page.click('.scr.on .back'); }
async function openMachineByName(gymName, machineName) {
  await goHome();
  await page.click(`#homebody .row:has-text("${gymName}")`);
  await page.waitForTimeout(200);
  if (await page.$('#s-rooms.on')) {
    for (const row of await page.$$('#roomsbody .row')) {
      await row.click(); await page.waitForTimeout(150);
      if (await page.$(`.mc:has-text("${machineName}")`)) break;
      await page.click('#s-machines .back');
    }
  }
  await page.click(`.mc:has-text("${machineName}")`);
}

// 1. Home
await shot('home');
check('home lists gyms', (await page.$$('#homebody .row')).length > 0);
check('no old-format banner', !(await text('#homebody')).includes('old format'));

// 2. Browse: first gym → machines → detail
await page.click('#homebody .row');
await page.waitForTimeout(200);
if (await page.$('#s-rooms.on')) { await shot('rooms'); await page.click('#roomsbody .row'); }
await shot('machines');
check('machine grid rendered', (await page.$$('.mc')).length > 0);
await page.click('.mc');
await shot('detail');
check('detail has Log today', (await text('#detailbody')).includes('Log today'));

// 3. Log a new session on a machine with variations, choosing one
const usingFixture = !process.argv[2];
const machineName = usingFixture ? 'Seated Row' : null;
if (usingFixture) await openMachineByName('Example Gym', 'Seated Row');
await page.click('[data-act="start-log"]');
await shot('logform');
const commitsBefore = fake.commitCount();
const sizeBefore = readLog().length;
let tag = null;
const chip = await page.$('[data-act="log-var"]');
if (chip) { tag = await chip.getAttribute('data-t'); await chip.click(); await page.waitForTimeout(150); }
const rows0 = (await page.$$('#stb tr')).length;
await page.click('[data-act="log-add-row"]');
check('add set works', (await page.$$('#stb tr')).length === rows0 + 1);
for (const inp of await page.$$('#stb input')) await inp.fill('7');
await page.fill('#lnotes', 'e2e: smoke test, with a comma');
await shot('logform-filled');
await page.click('[data-act="log-save"]');
const t1 = await waitToast();
check('session saved', /saved/.test(t1), t1);
await shot('after-save');
const log1 = readLog();
check('one commit per save', fake.commitCount() === commitsBefore + 1, `${commitsBefore} -> ${fake.commitCount()}`);
const mine = log1.filter(e => e.notes === 'e2e: smoke test, with a comma');
check('new entries written in format version 2', mine.length === 1 && mine[0].id && mine[0].gym_id && mine[0].machine_id && /^\d\d:\d\d:\d\d$/.test(mine[0].time) && !('machineId' in mine[0]));
check('all sets saved', log1.length === sizeBefore + rows0 + 1, `${sizeBefore} -> ${log1.length}`);
if (tag) check('variation stored on every set', log1.filter(e => e.date === mine[0].date && e.machine_id === mine[0].machine_id && (e.variant || []).includes(tag)).length === rows0 + 1);
const csv1 = parseCSV(fake.read('workout-log.csv'));
check('CSV has the version 2 header', fake.read('workout-log.csv').split('\n')[0] === LOG_COLUMNS.join(','));
check('CSV matches the JSON row for row', csv1.length === log1.length && csv1.every((r, i) => r.id === log1[i].id));
check('notes keep their comma in the CSV', csv1.some(r => r.notes === 'e2e: smoke test, with a comma'));

// 4. Edit the session and change its date: it moves, nothing duplicated
await page.click('[data-act="edit-session"]');
await shot('editform');
await page.fill('#ldate', '2026-01-02');
await page.click('[data-act="log-save"]');
const t2 = await waitToast();
check('edit saved', /saved/.test(t2), t2);
const log2 = readLog();
const movedSets = log2.filter(e => e.machine_id === mine[0].machine_id && e.gym_id === mine[0].gym_id && e.date === '2026-01-02');
check('date change moved the session (no duplicate)', movedSets.length === rows0 + 1 && !log2.some(e => e.id === mine[0].id && e.date !== '2026-01-02'));
check('log size unchanged after the move', log2.length === log1.length, `${log1.length} -> ${log2.length}`);
check('ids kept through the edit', log2.some(e => e.id === mine[0].id));

// 5. Assisted machine: negative weight is accepted and shown as assistance
if (usingFixture) {
  await openMachineByName('Example Gym', 'Assisted Pull-up');
  check('history shows assistance', (await text('#detailbody')).includes('100 lb assist'));
  await page.click('[data-act="start-log"]');
  const inputs = await page.$$('#stb input');
  await inputs[0].fill('-85'); await inputs[1].fill('7');
  for (const extra of (await page.$$('#stb tr')).slice(1)) await (await extra.$('[data-act="log-rm-row"]')).click();
  await page.click('[data-act="log-save"]');
  const t3 = await waitToast();
  check('negative weight saved', /saved/.test(t3) && readLog().some(e => e.machine_id === 'assist' && e.weight_lb === -85), t3);
  await shot('assisted');

  // 6. Bad input is refused with a message, nothing written
  await page.click('[data-act="start-log"]');
  const before = fake.commitCount();
  const reps = (await page.$$('#stb input'))[1];
  await reps.fill('-3');
  await page.click('[data-act="log-save"]');
  await page.waitForTimeout(400);
  check('negative reps refused', (await text('#toast')).includes("can't be negative") && fake.commitCount() === before);
  await page.click('#s-log .back');
}

// 7. Delete a session
await goHome();
await page.click('#homebody .row');
await page.waitForTimeout(200);
if (await page.$('#s-rooms.on')) await page.click('#roomsbody .row');
await page.click('.mc');
const del = await page.$('[data-act="del-session"]');
if (del) {
  const size = readLog().length;
  await del.click();
  await page.click('[data-act="modal-ok"]');
  const t4 = await waitToast();
  check('session deleted', /deleted/.test(t4) && readLog().length < size, t4);
}

// 8. Settings: version near the top
await goHome();
await page.click('#s-home [data-act="nav"][data-to="settings"]');
await shot('settings');
const top = await text('.vertop');
check('settings shows the version at the top', /TrainTracks v\d/.test(top), top);

await ctx.close();

// 9. Light theme, and a repo still in the old format: banner, and saving refuses
const old = createFakeGitHub({ ...seed, 'workout-log.json': JSON.stringify([{ machineId: 'push-ups', date: '2026-11-01', set: 1, reps: 5, gymId: 'generic' }]) });
const oldFetch = fake.fetch;
fake.fetch = old.fetch;
const { ctx: ctx2, page: p2 } = await openPage('light');
await p2.screenshot({ path: path.join(SHOTS, `${String(++n).padStart(2, '0')}-old-format-light.png`), fullPage: true });
check('old-format data shows a banner', ((await p2.textContent('#homebody')) || '').includes('old format'));
fake.fetch = oldFetch;
await ctx2.close();

await browser.close();
server.close();

const realErrors = errors.filter(e => !/Failed to load resource.*404/.test(e));
check('no console errors (incl. Content-Security-Policy)', realErrors.length === 0, realErrors.join('\n'));
const failed = results.filter(r => !r.ok);
console.log(`${results.length - failed.length}/${results.length} checks passed; screenshots in ${SHOTS}`);
process.exit(failed.length ? 1 : 0);
