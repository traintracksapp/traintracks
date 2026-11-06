/**
 * Browser smoke test. Serves the app locally, intercepts api.github.com and
 * raw.githubusercontent.com with the in-memory fake seeded from a data
 * folder, and walks every screen while watching for console errors.
 *
 *   node tests/e2e/run.mjs [data-dir] [shots-dir]
 *
 * data-dir: a LogTrim/TrainTracks user repo checkout (default: fixtures).
 */
import { createRequire } from 'node:module';
const { chromium } = createRequire(import.meta.url)(process.env.PLAYWRIGHT_PATH || 'playwright');
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { createFakeGitHub } from '../fake-github.js';

const ROOT = path.resolve(new URL('../..', import.meta.url).pathname);
const DATA = path.resolve(process.argv[2] || path.join(ROOT, 'tests/fixtures/user-repo'));
const SHOTS = path.resolve(process.argv[3] || '/tmp/tt-shots');
fs.mkdirSync(SHOTS, { recursive: true });

// ---- seed the fake from the data dir (text files only; images served raw) ----
const seed = {};
const binaries = {};
function walk(dir, rel = '') {
  for (const name of fs.readdirSync(dir)) {
    if (name === '.git' || name === 'node_modules') continue;
    const p = path.join(dir, name), r = rel ? `${rel}/${name}` : name;
    if (fs.statSync(p).isDirectory()) walk(p, r);
    else if (/\.(jpe?g|png|gif|webp)$/i.test(name)) binaries[r] = p;
    else seed[r] = fs.readFileSync(p, 'utf8');
  }
}
if (fs.existsSync(DATA)) walk(DATA);
// the app's own generic gym when the data dir has none
if (!seed['equipment/generic/gym.json']) walk(path.join(ROOT, 'equipment'), 'equipment');
const fake = createFakeGitHub(seed, { private: false });

// ---- static server for the app ----
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.webmanifest': 'application/manifest+json', '.md': 'text/markdown' };
const server = http.createServer((req, res) => {
  let p = decodeURIComponent(req.url.split('?')[0]); if (p.endsWith('/')) p += 'index.html';
  const f = path.join(ROOT, p);
  if (!f.startsWith(ROOT) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { res.writeHead(404); res.end('nf'); return; }
  res.writeHead(200, { 'Content-Type': MIME[path.extname(f)] || 'application/octet-stream' }); fs.createReadStream(f).pipe(res);
});
await new Promise(r => server.listen(8089, r));

const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 400, height: 820 }, deviceScaleFactor: 2, colorScheme: 'dark' });
const page = await ctx.newPage();
const errors = [];
page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
page.on('pageerror', e => errors.push(String(e)));

await page.route(/https:\/\/api\.github\.com\/.*/, async route => {
  const req = route.request();
  const r = await fake.fetch(req.url(), { method: req.method(), headers: req.headers(), body: req.postData() });
  const body = r.status === 204 ? '' : (req.headers().accept === 'application/vnd.github.raw+json' ? await r.text() : JSON.stringify(await r.json()));
  await route.fulfill({ status: r.status, contentType: 'application/json', body });
});
await page.route(/https:\/\/raw\.githubusercontent\.com\/.*/, async route => {
  const u = new URL(route.request().url());
  const m = /^\/[^/]+\/[^/]+\/[^/]+\/(.*)$/.exec(u.pathname);
  const rel = m ? decodeURIComponent(m[1]) : '';
  if (binaries[rel]) return route.fulfill({ status: 200, contentType: 'image/jpeg', body: fs.readFileSync(binaries[rel]) });
  const f = fake.read(rel);
  if (f != null) return route.fulfill({ status: 200, contentType: 'text/plain', body: f });
  return route.fulfill({ status: 404, body: 'nf' });
});

await page.goto('http://localhost:8089/');
await page.evaluate(() => { localStorage.setItem('tt-cfg', JSON.stringify({ user: 'tester', repo: 'traintracks', token: 'github_pat_test' })); localStorage.setItem('tt-remember', 'yes'); });
await page.goto('http://localhost:8089/');
await page.waitForFunction(() => !document.getElementById('ld').classList.contains('on'), null, { timeout: 20000 });
await page.waitForTimeout(400);

let n = 0;
const shot = async name => { await page.waitForTimeout(250); await page.screenshot({ path: path.join(SHOTS, `${String(++n).padStart(2, '0')}-${name}.png`) }); };
const text = async sel => (await page.textContent(sel)) || '';
const results = [];
const check = (name, ok, info) => { results.push({ name, ok, info }); if (!ok) console.log('FAIL', name, info || ''); };

await shot('home');
check('home shows a gym', (await text('#homebody')).includes('Common'));
const hasPlan = (await page.$('.pc')) != null;

// plan
if (hasPlan) { await page.click('.pc'); await shot('plan'); check('plan has stops', (await page.$$('.stop')).length > 0); await page.click('#s-plan .back'); }

// reports
await page.click('#s-home [data-act="nav"][data-to="reports"]');
await shot('reports');
check('report cards or empty state', (await page.$$('.rc')).length > 0 || (await text('#repbody')).includes('No weekly goals'));
if ((await page.$('.rc'))) { await page.click('.rc .rch'); await shot('report-open'); }
await page.click('#s-reports .back');

// gyms -> machines -> detail
const gymRows = await page.$$('#homebody .row');
await gymRows[0].click();
await page.waitForTimeout(300);
if (await page.$('#s-rooms.on')) { await shot('rooms'); await page.click('#roomsbody .row'); }
await shot('machines');
check('machine grid rendered', (await page.$$('.mc')).length > 0);
await page.click('.mc');
await shot('detail');
check('detail has log button', (await text('#detailbody')).includes('Log today'));

// log form
await page.click('[data-act="start-log"]');
await shot('logform');
const rowsBefore = (await page.$$('#stb tr')).length;
await page.click('[data-act="log-add-row"]');
check('add row works', (await page.$$('#stb tr')).length === rowsBefore + 1);
// fill the first input of every row with something
for (const inp of await page.$$('#stb input')) { if (!(await inp.inputValue())) await inp.fill('5'); }
await page.fill('#lnotes', 'e2e smoke test');
const logBefore = JSON.parse(fake.read('workout-log.json') || '[]').length;
await page.click('[data-act="log-save"]');
await page.waitForFunction(() => document.getElementById('toast').textContent.includes('saved') || document.getElementById('toast').textContent.includes('failed'), null, { timeout: 15000 });
const toastTxt = await text('#toast');
check('session saved', toastTxt.includes('saved'), toastTxt);
await shot('after-save');
const logAfter = JSON.parse(fake.read('workout-log.json') || '[]');
const csvAfter = fake.read('workout-log.csv') || '';
check('log grew', logAfter.length >= logBefore, `${logBefore} -> ${logAfter.length}`);
check('csv rows == json entries', csvAfter.trim().split('\n').length - 1 === logAfter.length, `${csvAfter.trim().split('\n').length - 1} vs ${logAfter.length}`);
check('csv header has garminId', csvAfter.startsWith('datetime,') && csvAfter.split('\n')[0].endsWith('garminId'));
check('new entry has id and gymId', logAfter.some(e => e.notes === 'e2e smoke test' && e.id && e.gymId));

// edit the same session: change date -> moves
await page.click('[data-act="edit-session"]');
await shot('editform');
await page.fill('#ldate', '2026-01-02');
await page.click('[data-act="log-save"]');
await page.waitForFunction(() => document.getElementById('toast').textContent.includes('saved'), null, { timeout: 15000 });
const logMoved = JSON.parse(fake.read('workout-log.json'));
const moved = logMoved.filter(e => e.notes === 'e2e smoke test');
check('date change moved the session (no duplicate)', moved.length >= 1 && moved.every(e => e.date === '2026-01-02'), JSON.stringify(moved.map(e => e.date)));
check('log size unchanged after move', logMoved.length === logAfter.length, `${logAfter.length} -> ${logMoved.length}`);

// settings, profile, goals, equipment
await page.click('#s-detail .back'); await page.click('#s-machines .back');
if (await page.$('#s-rooms.on')) await page.click('#s-rooms .back');
await page.click('#s-home [data-act="nav"][data-to="settings"]'); await shot('settings');
await page.click('#settingsbody [data-act="nav"][data-to="profile"]'); await shot('profile'); await page.click('#s-profile .back');
await page.click('#settingsbody [data-act="nav"][data-to="goals"]'); await shot('goals');
await page.click('[data-act="goal-add"]'); await shot('goal-picker'); await page.click('[data-act="modal-close"]');
await page.click('#s-goals .back');
await page.click('#settingsbody [data-act="nav"][data-to="equipment"]'); await shot('equipment');
await page.click('#eqbody .row'); await shot('gym-eq');
await page.click('#gymeqbody .row'); await shot('room-eq');
await page.click('[data-act="eq-m-add"]'); await shot('machine-modal'); await page.click('[data-act="modal-close"]');

// light theme look
await ctx.close();
const ctx2 = await browser.newContext({ viewport: { width: 400, height: 820 }, deviceScaleFactor: 2, colorScheme: 'light' });
const page2 = await ctx2.newPage();
await page2.route(/https:\/\/api\.github\.com\/.*/, async route => { const req = route.request(); const r = await fake.fetch(req.url(), { method: req.method(), headers: req.headers(), body: req.postData() }); const body = r.status === 204 ? '' : (req.headers().accept === 'application/vnd.github.raw+json' ? await r.text() : JSON.stringify(await r.json())); await route.fulfill({ status: r.status, contentType: 'application/json', body }); });
await page2.route(/https:\/\/raw\.githubusercontent\.com\/.*/, async route => { const u = new URL(route.request().url()); const m = /^\/[^/]+\/[^/]+\/[^/]+\/(.*)$/.exec(u.pathname); const rel = m ? decodeURIComponent(m[1]) : ''; if (binaries[rel]) return route.fulfill({ status: 200, contentType: 'image/jpeg', body: fs.readFileSync(binaries[rel]) }); return route.fulfill({ status: 404, body: 'nf' }); });
await page2.goto('http://localhost:8089/');
await page2.evaluate(() => { localStorage.setItem('tt-cfg', JSON.stringify({ user: 'tester', repo: 'traintracks', token: 'github_pat_test' })); });
await page2.goto('http://localhost:8089/');
await page2.waitForFunction(() => !document.getElementById('ld').classList.contains('on'), null, { timeout: 20000 });
await page2.waitForTimeout(400);
await page2.screenshot({ path: path.join(SHOTS, `${String(++n).padStart(2, '0')}-home-light.png`) });
await browser.close();
server.close();

const realErrors = errors.filter(e => !/Failed to load resource.*404/.test(e));
check('no console errors', realErrors.length === 0, realErrors.join('\n'));
const failed = results.filter(r => !r.ok);
console.log(`${results.length - failed.length}/${results.length} checks passed; screenshots in ${SHOTS}`);
process.exit(failed.length ? 1 : 0);
