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
import { LOG_COLUMNS, logToJSON } from '../../lib/log.js';
import { isMonthFile, joinMonths, monthToText, csvFromMonthFiles } from '../../lib/months.js';

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

let githubDown = false; // every GitHub API call fails while true
let githubDelay = 0;     // ms added to every GitHub API answer
let apiCalls = [];       // GitHub API calls, for counting
const browser = await chromium.launch();
const errors = [];
async function openPage(colorScheme = 'dark') {
  const ctx = await browser.newContext({ viewport: { width: 400, height: 820 }, deviceScaleFactor: 1, colorScheme });
  const page = await ctx.newPage();
  page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
  page.on('pageerror', e => errors.push(String(e)));
  await page.route(/https:\/\/api\.github\.com\/.*/, async route => {
    const req = route.request();
    apiCalls.push(`${req.method()} ${new URL(req.url()).pathname.replace(/^\/repos\/[^/]+\/[^/]+/, '')}`);
    if (githubDelay) await new Promise(r => setTimeout(r, githubDelay));
    if (githubDown) return route.fulfill({ status: 503, contentType: 'application/json', body: '{"message":"down for the test"}' });
    const accept = req.headers().accept;
    const r = await fake.fetch(req.url(), { method: req.method(), headers: { Accept: accept }, body: req.postData() });
    const body = r.status === 204 ? '' : accept === 'application/vnd.github.raw+json' ? await r.text() : JSON.stringify(await r.json());
    await route.fulfill({ status: r.status, contentType: 'application/json', body });
  });
  await page.route(/https:\/\/raw\.githubusercontent\.com\/.*/, async route => {
    const u = new URL(route.request().url());
    const m = /^\/([^/]+)\/([^/]+)\/[^/]+\/(.*)$/.exec(u.pathname);
    const rel = m ? decodeURIComponent(m[3]) : '';
    if (m && m[1] === 'logtrim' && m[2] === 'gyms') { // the public gym catalog, served from the fixture
      const f = path.join(ROOT, 'tests/fixtures/catalog', rel);
      return fs.existsSync(f) ? route.fulfill({ status: 200, contentType: 'application/json', body: fs.readFileSync(f) }) : route.fulfill({ status: 404, body: 'nf' });
    }
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
// The log is one file per month (format version 3).
const monthTexts = () => Object.fromEntries(fake.paths().filter(isMonthFile).map(p => [p, fake.read(p)]));
const readLog = () => joinMonths(Object.fromEntries(Object.entries(monthTexts()).map(([p, t]) => [p, JSON.parse(t)])));
const allFiles = () => Object.fromEntries(fake.paths().map(p => [p, fake.read(p)]));
const changedSince = before => { const now = allFiles(); return [...new Set([...Object.keys(before), ...Object.keys(now)])].filter(p => before[p] !== now[p]).sort(); };

const { ctx, page } = await openPage();
const shot = async name => { await page.waitForTimeout(200); await page.screenshot({ path: path.join(SHOTS, `${String(++n).padStart(2, '0')}-${name}.png`), fullPage: true }); };
const text = async sel => (await page.textContent(sel)) || '';
// Log saves return at once and are sent in the background: wait until GitHub has them.
const waitSynced = () => page.waitForFunction(() => document.body.dataset.sync === 'idle', null, { timeout: 15000 });
const waitToast = async () => {
  await page.waitForFunction(() => /saved|failed|deleted|editing/i.test(document.getElementById('toast').textContent), null, { timeout: 15000 });
  const t = await text('#toast');
  await page.evaluate(() => { const t = document.getElementById('toast'); t.textContent = ''; t.className = ''; });
  await waitSynced();
  return t;
};
async function goHome() { while (!(await page.$('#s-home.on'))) await page.click('.scr.on .back'); }
async function openMachineByName(gymName, machineName) {
  await goHome();
  await page.click(`#homebody .row:has-text("${gymName}")`);
  await page.waitForTimeout(200);
  if (await page.$('#s-rooms.on')) {
    const n = (await page.$$('#roomsbody .row')).length;
    for (let i = 0; i < n; i++) {
      await page.click(`#roomsbody .row >> nth=${i}`); await page.waitForTimeout(150);
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
const filesBefore = allFiles();
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
const touched1 = changedSince(filesBefore);
check('the save wrote only its month file', touched1.length === 1 && touched1[0] === `log/${mine[0].date.slice(0, 7)}.json`, touched1.join(', '));
check('the app no longer writes workout-log.json or the CSV', fake.read('workout-log.json') == null && fake.read('workout-log.csv') === filesBefore['workout-log.csv']);
check('the month file has one entry per line', fake.read(touched1[0]).split('\n').filter(l => l.startsWith('{')).length === JSON.parse(fake.read(touched1[0])).length);
// what the build-csv Action makes from the months
const csvText = csvFromMonthFiles(monthTexts());
const csv1 = parseCSV(csvText);
check('CSV has the header', csvText.split('\n')[0] === LOG_COLUMNS.join(','));
check('CSV built from the months matches the log row for row', csv1.length === log1.length && csv1.every((r, i) => r.id === log1[i].id));
check('notes keep their comma in the CSV', csv1.some(r => r.notes === 'e2e: smoke test, with a comma'));

// 4. Edit the session and change its date: it moves, nothing duplicated
await page.click('[data-act="edit-session"]');
await shot('editform');
await page.fill('#ldate', '2026-01-02');
const filesBeforeMove = allFiles();
await page.click('[data-act="log-save"]');
const t2 = await waitToast();
check('edit saved', /saved/.test(t2), t2);
const log2 = readLog();
const movedSets = log2.filter(e => e.machine_id === mine[0].machine_id && e.gym_id === mine[0].gym_id && e.date === '2026-01-02');
check('date change moved the session (no duplicate)', movedSets.length === rows0 + 1 && !log2.some(e => e.id === mine[0].id && e.date !== '2026-01-02'));
check('log size unchanged after the move', log2.length === log1.length, `${log1.length} -> ${log2.length}`);
check('ids kept through the edit', log2.some(e => e.id === mine[0].id));
check('moving to another month wrote exactly the two months', changedSince(filesBeforeMove).join() === ['log/2026-01.json', touched1[0]].sort().join(), changedSince(filesBeforeMove).join(', '));

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

  // 5b. Move a session to another machine (the fixture's treadmill session, which has heart rate)
  await openMachineByName('Example Gym', 'Treadmill');
  const tmBefore = readLog().find(e => e.id === 'f4');
  await page.click('[data-act="move-session"]');
  await shot('move-modal');
  await page.selectOption('#mvto', 'generic|cardio|treadmill');
  await page.click('[data-act="move-session-do"]');
  await page.waitForFunction(() => /Moved|failed/.test(document.getElementById('toast').textContent), null, { timeout: 15000 });
  await waitSynced();
  const tmAfter = readLog().find(e => e.id === 'f4');
  check('session moved to the other machine', tmAfter.gym_id === 'generic' && tmAfter.machine_id === 'treadmill' && tmAfter.room_id === 'cardio' && tmAfter.machine === 'Treadmill');
  check('moved session keeps its fields', tmAfter.hr_avg_bpm === tmBefore.hr_avg_bpm && tmAfter.duration_sec === tmBefore.duration_sec && tmAfter.date === tmBefore.date);
  check('old machine has no sessions left', (await text('#detailbody')).includes('No sessions logged yet'));
  await openMachineByName('Example Gym', 'Assisted Pull-up');

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

if (usingFixture) {
  // 8a. Today's route: shown on home; coach text is shown as text, never as HTML
  await goHome();
  check('home shows the route card', (await page.$('.pc')) != null);
  check('home shows the week strip', (await page.$('.wk')) != null);
  await page.click('.pc');
  await shot('plan');
  check('plan has 3 stops', (await page.$$('.stop')).length === 3);
  check('coach HTML is escaped', (await text('#planbody')).includes('<b>walk</b>') && !(await page.$('#planbody b:has-text("walk")')));
  check('injected image not created', (await page.$('#planbody img')) == null);
  check('unknown machine marked', (await text('#planbody')).includes('Not in your equipment'));
  // log the first stop from the plan: prefilled sets and the planned variation
  await page.click('.stop >> nth=0');
  await page.waitForTimeout(200);
  const vals = await page.$$eval('#stb input', els => els.map(e => e.value));
  check('plan prefills the sets', vals.join(',') === '60,12,65,10', vals.join(','));
  check('plan pre-selects its variation', (await page.$('.vc.on:has-text("wide")')) != null);
  await page.click('[data-act="log-save"]');
  const tp = await waitToast();
  check('logged from the plan', /saved/.test(tp) && readLog().some(e => e.machine_id === 'r02' && (e.variant || []).includes('wide') && e.weight_lb === 65), tp);
  await page.waitForTimeout(300);
  check('stop marked done', (await page.$$('.stop.done')).length === 1);
  await page.click('.stop >> nth=1');
  await page.click('[data-act="log-save"]');
  await waitToast();
  await page.waitForTimeout(500);
  check('two of three stops done', (await text('.pprog')).includes('2 of 3'));
  await page.click('#s-plan .back');

  // 8b. Weekly report and goals editor
  await page.click('#s-home [data-act="nav"][data-to="reports"]');
  await shot('report');
  check('report has a card per goal', (await page.$$('.rc')).length === 3);
  check('row reps goal counts the plan session', /\d+ \/ 60/.test(await text('.rc:has-text("Seated row reps") .rcv')));
  await page.click('.rc .rch');
  await page.click('[data-act="week-shift"][data-n="-1"]');
  check('earlier week shown', (await text('.wkttl')).includes('Last week'));
  await page.click('#s-reports [data-act="nav"][data-to="goals"]');
  await shot('goals');
  await page.click('[data-act="goal-add"]');
  await page.click('.mlist .sl:has-text("Reps of an exercise")');
  await page.selectOption('#gpm', 'r02');
  await page.fill('#gpt', '80');
  await page.fill('#gpv', 'wide');
  await page.click('[data-act="goal-pick-done"]');
  await page.click('[data-act="goals-save"]');
  await page.waitForTimeout(600);
  const goalsSaved = JSON.parse(fake.read('goals.json'));
  const added = goalsSaved.goals.find(g => (g.variants || []).includes('wide'));
  check('goal with a variation filter saved', !!added && added.machine_ids[0] === 'r02' && added.target === 80 && goalsSaved.week_start === 'sat');
  await goHome();

  // 8c. Profile
  await page.click('#s-home [data-act="nav"][data-to="settings"]');
  await page.click('#settingsbody [data-act="nav"][data-to="profile"]');
  await page.fill('#p-limitations', 'no deep squats');
  await page.click('[data-act="profile-save"]');
  await page.waitForTimeout(500);
  const prof = JSON.parse(fake.read('profile.json'));
  check('profile saved with snake_case keys', prof.limitations === 'no deep squats' && prof.first_name === 'Sam');

  // 8d. Equipment: add a machine with variations; catalog import
  await page.click('#settingsbody [data-act="nav"][data-to="equipment"]');
  await shot('equipment');
  await page.click('#eqbody .row:has-text("Example Gym")');
  await page.click('#gymeqbody .row:has-text("Weight Room")');
  await page.click('[data-act="eq-m-add"]');
  await page.fill('#m1', 'Cable Fly');
  await page.fill('#m4', 'height: low, mid, high');
  await shot('machine-modal');
  await page.click('[data-act="eq-m-add-do"]');
  await page.waitForTimeout(600);
  const eg = JSON.parse(fake.read('equipment/my-gyms/example-gym/gym.json'));
  const fly = eg.rooms[0].machines.find(m => m.name === 'Cable Fly');
  check('machine added with variations', !!fly && fly.variations && fly.variations.height.join() === 'low,mid,high' && fly.log_type === 'weight');
  check('other machines kept their variations', eg.rooms[0].machines.find(m => m.id === 'r02').variations.grip.length === 3);
  await page.click('#s-roomeq .back');
  await page.click('#s-gymeq .back');
  await page.click('[data-act="catalog-open"]');
  await page.waitForTimeout(300);
  await shot('catalog');
  await page.click('[data-act="catalog-import"][data-id="park"]');
  await page.waitForTimeout(1200);
  const park = fake.read('equipment/my-gyms/park/gym.json');
  check('catalog gym imported and converted', !!park && JSON.parse(park).rooms[0].machines[0].log_type === 'reps' && JSON.parse(park).source === 'logtrim/gyms@2026-09-18');
  await goHome();
  check('imported gym on home', (await text('#homebody')).includes('Park Bars'));
}

// 8. Settings: version near the top
await goHome();
await page.click('#s-home [data-act="nav"][data-to="settings"]');
await shot('settings');
const top = await text('.vertop');
check('settings shows the version at the top', /TrainTracks v\d/.test(top), top);
// The template is served by the same fake here, so it is identical: "up to date".
await page.click('[data-act="update-check"]');
await page.waitForFunction(() => /up to date|failed/i.test(document.getElementById('updstatus').textContent + document.getElementById('toast').textContent), null, { timeout: 15000 });
check('update check runs', /up to date/i.test(await text('#updstatus')), await text('#toast'));
check('Garmin section present', (await text('#settingsbody')).includes('Run the Garmin sync now'));

// 8c. Saving while GitHub can't be reached: shown at once, kept on the device, sent later
if (usingFixture) {
  await openMachineByName('Example Gym', 'Assisted Pull-up');
  await page.click('[data-act="start-log"]');
  const inputs = await page.$$('#stb input');
  await inputs[0].fill('-90'); await inputs[1].fill('6');
  for (const extra of (await page.$$('#stb tr')).slice(1)) await (await extra.$('[data-act="log-rm-row"]')).click();
  githubDown = true;
  const before = readLog().length;
  await page.click('[data-act="log-save"]');
  await page.waitForFunction(() => /saved/i.test(document.getElementById('toast').textContent), null, { timeout: 5000 });
  check('save returns at once and the set is shown', (await text('#detailbody')).includes('90 lb assist'));
  await page.waitForFunction(() => document.body.dataset.sync === 'error', null, { timeout: 15000 });
  await shot('not-saved-yet');
  check('the status pill says it is not on GitHub yet', /not saved to GitHub yet/i.test(await text('#syncpill')), await text('#syncpill'));
  check('the pill shows GitHub\'s own message', /GitHub 503: down for the test/.test(await text('#syncpill')), await text('#syncpill'));
  check('nothing reached GitHub', readLog().length === before && !readLog().some(e => e.weight_lb === -90));
  check('the change is kept on the device', await page.evaluate(() => Object.keys(localStorage).some(k => k.startsWith('tt-outbox:') && localStorage.getItem(k).includes('-90'))));
  // Close and reopen the app with GitHub back: the change is sent.
  githubDown = false;
  page.once('dialog', d => d.accept()); // "leave with unsaved changes?" on a desktop browser
  await page.reload();
  await page.waitForFunction(() => !document.getElementById('ld').classList.contains('on'), null, { timeout: 20000 });
  await waitSynced();
  check('sent after reopening', readLog().some(e => e.machine_id === 'assist' && e.weight_lb === -90));
  check('the pill is gone', await page.evaluate(() => document.getElementById('syncpill').hidden));
  check('the queue is empty', await page.evaluate(() => !Object.keys(localStorage).some(k => k.startsWith('tt-outbox:'))));
  await goHome();
  await page.click('#s-home [data-act="nav"][data-to="settings"]');
  check('Settings keeps the last save problem', /Last save problem \(.+\): (GitHub 503: down for the test|offline\?)/.test(await text('#settingsbody')), await text('#lastsyncerr'));

  // 8d. Opening again: shown from the copy on this device at once, then checked against GitHub
  const reopen = async () => {
    apiCalls = [];
    await page.goto('http://localhost:8089/');
    await page.waitForFunction(() => document.querySelectorAll('#homebody .row').length > 0 && !document.getElementById('ld').classList.contains('on'), null, { timeout: 20000 });
  };
  githubDelay = 1500;
  await reopen();
  check('reopening shows the device copy before GitHub answers', await page.evaluate(() => document.body.dataset.load === 'device') && apiCalls.length <= 1, `${await page.evaluate(() => document.body.dataset.load)} ${apiCalls.join(', ')}`);
  await page.waitForFunction(() => document.body.dataset.load === 'fresh', null, { timeout: 20000 });
  githubDelay = 0;
  await page.waitForTimeout(300);
  check('nothing changed on GitHub: one call (the branch head)', apiCalls.length === 1 && apiCalls[0] === 'GET /git/ref/heads/main', apiCalls.join(', '));
  // another device logs a set: the next open downloads only the log and shows the set
  const nov = JSON.parse(fake.read('log/2026-11.json'));
  nov.unshift({ ...readLog().find(e => e.machine_id === 'r02'), id: 'from-other-device', date: '2026-11-08', set: 1, notes: 'logged on another device' });
  fake.write({ 'log/2026-11.json': monthToText(nov) }, 'another device');
  await reopen();
  await page.waitForFunction(() => document.body.dataset.load === 'fresh', null, { timeout: 20000 });
  await page.waitForTimeout(300);
  const blobs = apiCalls.filter(c => c.startsWith('GET /git/blobs/'));
  check('only the changed month is downloaded, as a raw blob', blobs.length === 1 && apiCalls.length === 3 && !apiCalls.some(c => c.includes('/contents/')), apiCalls.join(', '));
  await openMachineByName('Example Gym', 'Seated Row');
  check('the other device\'s set is shown', (await text('#detailbody')).includes('logged on another device'));
}

await ctx.close();

// 9. Light theme, and a repo still in the old format: banner, and saving refuses
const old = createFakeGitHub({ ...seed, 'log/2026-11.json': JSON.stringify([{ machineId: 'push-ups', date: '2026-11-01', set: 1, reps: 5, gymId: 'generic' }]) });
const oldFetch = fake.fetch;
fake.fetch = old.fetch;
const { ctx: ctx2, page: p2 } = await openPage('light');
await p2.screenshot({ path: path.join(SHOTS, `${String(++n).padStart(2, '0')}-old-format-light.png`), fullPage: true });
check('old-format data shows a banner', ((await p2.textContent('#homebody')) || '').includes('old format'));
await ctx2.close();

// 10. Updated to 0.3.0 but the log not split yet: shown, with a notice, and saving is off
if (usingFixture) {
  const single = Object.fromEntries(Object.entries(seed).filter(([p]) => !isMonthFile(p)));
  const fixtureLog = joinMonths(Object.fromEntries(Object.entries(seed).filter(([p]) => isMonthFile(p)).map(([p, t]) => [p, JSON.parse(t)])));
  const unsplit = createFakeGitHub({ ...single, 'workout-log.json': logToJSON(fixtureLog) });
  fake.fetch = unsplit.fetch;
  const { ctx: ctx3, page: p3 } = await openPage();
  await p3.screenshot({ path: path.join(SHOTS, `${String(++n).padStart(2, '0')}-not-split.png`), fullPage: true });
  check('an unsplit log shows the split notice', ((await p3.textContent('#homebody')) || '').includes('still one file'));
  await p3.click('#homebody .row:has-text("Example Gym")');
  await p3.click('#roomsbody .row:has-text("Weight Room")');
  await p3.click('.mc:has-text("Seated Row")');
  check('an unsplit log is still shown (history)', /70 lb/.test((await p3.textContent('#detailbody')) || ''), await p3.textContent('#detailbody'));
  const nBefore = unsplit.commitCount();
  await p3.click('[data-act="start-log"]');
  await p3.click('[data-act="log-save"]');
  await p3.waitForTimeout(500);
  check('saving is refused with the split message, nothing written', /split into months/.test((await p3.textContent('#toast')) || '') && unsplit.commitCount() === nBefore, await p3.textContent('#toast'));
  await ctx3.close();
}
fake.fetch = oldFetch;

await browser.close();
server.close();

const realErrors = errors.filter(e => !/Failed to load resource.*(404|503)/.test(e));
check('no console errors (incl. Content-Security-Policy)', realErrors.length === 0, realErrors.join('\n'));
const failed = results.filter(r => !r.ok);
console.log(`${results.length - failed.length}/${results.length} checks passed; screenshots in ${SHOTS}`);
process.exit(failed.length ? 1 : 0);
