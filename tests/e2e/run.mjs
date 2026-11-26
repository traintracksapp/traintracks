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
import { localDate, weekBounds, addDays, fmtShortDate } from '../../lib/dates.js';

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
// keep one set, give it a variation in the per-set picker; the added set copies it
for (const extra of (await page.$$('#stb tr')).slice(1)) await (await extra.$('[data-act="log-rm-row"]')).click();
const vcell = await page.$('#stb [data-act="log-vpick"]');
if (vcell) {
  await vcell.click();
  await page.waitForSelector('#mov.on');
  const chip = await page.$('#mdbody [data-act="log-vp"]');
  tag = await chip.getAttribute('data-t');
  await chip.click();
  await shot('variation-picker');
  await page.click('#mdbody [data-act="log-vp-done"]');
  check('picker shows the choice in the set row', (await text('#stb .vcell')).includes(tag));
}
const rows0 = (await page.$$('#stb tr')).length;
await page.click('[data-act="log-add-row"]');
if (tag) check('a new set copies the variation of the set above', (await page.$$eval('#stb .vcell', els => els.map(e => e.textContent))).every(t => t.includes(tag)));
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

  // 5a. Push-ups: no weight column; one session of flat, incline and decline sets
  await openMachineByName('Common Machines', 'Push Ups');
  await page.click('[data-act="start-log"]');
  const head = await text('#swrap thead');
  check('push-ups show Variation and Reps, no weight', head.includes('Variation') && head.includes('Reps') && !/weight/i.test(head), head);
  for (const extra of (await page.$$('#stb tr')).slice(1)) await (await extra.$('[data-act="log-rm-row"]')).click();
  const pick = async (row, t) => {
    await page.click(`#stb tr >> nth=${row} >> [data-act="log-vpick"]`);
    await page.waitForSelector('#mov.on');
    await page.click(`#mdbody [data-act="log-vp"][data-t="${t}"]`);
    await page.click('#mdbody [data-act="log-vp-done"]');
  };
  await pick(0, 'flat'); // the default: shown as plain
  await page.click('[data-act="log-add-row"]'); await pick(1, 'incline');
  await page.click('[data-act="log-add-row"]'); await pick(2, 'decline');
  const puReps = ['20', '15', '10'];
  for (const [i, inp] of (await page.$$('#stb input')).entries()) await inp.fill(puReps[i]);
  check('set rows show their variations', (await page.$$eval('#stb .vcell', els => els.map(e => e.textContent))).join() === 'plain,incline,decline');
  await shot('pushups-variations');
  const pushBefore = fake.commitCount();
  await page.click('[data-act="log-save"]');
  const tpu = await waitToast();
  const today = await page.evaluate(() => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; });
  const pu = readLog().filter(e => e.machine_id === 'push-ups' && e.date === today).sort((a, b) => a.set - b.set);
  check('push-ups saved as one session of three rows', /saved/.test(tpu) && pu.length === 3 && fake.commitCount() === pushBefore + 1, JSON.stringify(pu));
  check('each row has its own variant and no weight', pu.map(e => (e.variant || []).join(';')).join() === ',incline,decline' && pu.map(e => e.reps).join() === '20,15,10' && pu.every(e => e.weight_lb == null) && pu.map(e => e.set).join() === '1,2,3', JSON.stringify(pu));
  const hist = await text('#detailbody .hi');
  check('history shows the variation per set', hist.includes('incline') && hist.includes('decline'), hist);
  await page.click('[data-act="edit-session"]');
  check('editing shows every set with its variation', (await page.$$eval('#stb .vcell', els => els.map(e => e.textContent))).join() === 'plain,incline,decline');
  // change the middle set to incline + wide, save: still one session, one row changed
  await page.click('#stb tr >> nth=1 >> [data-act="log-vpick"]');
  await page.click('#mdbody [data-act="log-vp"][data-t="wide"]');
  await page.click('#mdbody [data-act="log-vp-done"]');
  check('the picker summary combines groups', (await text('#stb tr >> nth=1 >> .vcell')) === 'wide · incline');
  await page.click('[data-act="log-save"]');
  await waitToast();
  const pu2 = readLog().filter(e => e.machine_id === 'push-ups' && e.date === today).sort((a, b) => a.set - b.set);
  check('edit kept one session with the ids and per-set variants', pu2.length === 3 && pu2.map(e => e.id).join() === pu.map(e => e.id).join() && pu2[1].variant.join(';') === 'incline;wide' && pu2[0].variant.length === 0, JSON.stringify(pu2));

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

  // 6b. Distance & time: "70:46" is typed as mm:ss on a keyboard that has ":"
  await openMachineByName('Common Machines', 'Walk');
  await page.click('[data-act="start-log"]');
  for (const extra of (await page.$$('#stb tr')).slice(1)) await (await extra.$('[data-act="log-rm-row"]')).click();
  const [miles, time] = await page.$$('#stb input');
  check('time column says Time, placeholder mm:ss', (await text('#swrap thead')).includes('Time') && await time.getAttribute('placeholder') === 'mm:ss');
  check('time input is not a digits-only keypad', await time.getAttribute('inputmode') === 'text' && await time.getAttribute('type') === 'text');
  await miles.fill('3.1');
  await time.fill('70:99');
  const beforeBad = fake.commitCount();
  await page.click('[data-act="log-save"]');
  await page.waitForTimeout(400);
  check('impossible time "70:99" refused', (await text('#toast')).includes('"70:99" is not a valid time') && fake.commitCount() === beforeBad);
  await page.evaluate(() => { const t = document.getElementById('toast'); t.textContent = ''; t.className = ''; });
  await time.fill('70:46');
  check('pace updates live from mm:ss', /\d/.test(await text('#stb .pace')));
  await page.fill('#lnotes', 'e2e: mm:ss walk');
  await page.click('[data-act="log-save"]');
  const t4 = await waitToast();
  const walkSet = readLog().find(e => e.notes === 'e2e: mm:ss walk');
  check('"70:46" saved as duration_sec 4246', /saved/.test(t4) && walkSet && walkSet.duration_sec === 4246 && walkSet.distance_mi === 3.1, JSON.stringify(walkSet));
  await page.click('[data-act="edit-session"]');
  check('editing shows the time back as h:mm:ss', await (await page.$$('#stb input'))[1].inputValue() === '1:10:46');
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
  check('plan pre-selects its variation on every set', (await page.$$eval('#stb .vcell', els => els.map(e => e.textContent))).join() === 'wide,wide');
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

  // 8e. Three Garmin walks on one day (each its own activity, each posted as set 1): move only the last one
  const W = { gym_id: 'generic', gym: 'Common Machines', room_id: 'outdoor-activities', room: 'Outdoor Activities', machine_id: 'walk', machine: 'Walk', date: '2026-11-09', set: 1, variant: [] };
  const nov2 = JSON.parse(fake.read('log/2026-11.json'));
  nov2.unshift(
    { ...W, id: 'gw3', time: '20:49:00', duration_sec: 1500, distance_mi: 1.2, hr_avg_bpm: 101, garmin_id: '24000000903', zone1_min: 20.5, notes: 'Evening walk (Garmin 24000000903)' },
    { ...W, id: 'gw2', time: '13:09:00', duration_sec: 900, distance_mi: 0.7, garmin_id: '24000000902', notes: 'Walk (Garmin 24000000902)' },
    { ...W, id: 'gw1', time: '11:50:00', duration_sec: 600, distance_mi: 0.5, garmin_id: '24000000901', notes: 'Walk (Garmin 24000000901)' });
  fake.write({ 'log/2026-11.json': monthToText(nov2) }, 'garmin post');
  await reopen();
  await page.waitForFunction(() => document.body.dataset.load === 'fresh', null, { timeout: 20000 });
  await openMachineByName('Common Machines', 'Walk');
  const walkDay = '.hi:has-text("Nov 9, 2026")';
  check('one Walk session with three sets, each with its own Move and Delete', (await page.$$(`${walkDay} .sr`)).length === 3 && (await page.$$(`${walkDay} [data-act="move-entry"]`)).length === 3 && (await page.$$(`${walkDay} [data-act="del-entry"]`)).length === 3,
    await text('#detailbody'));
  check('each Garmin set shows its start time', /11:50/.test(await text(walkDay)) && /20:49/.test(await text(walkDay)));
  await shot('walk-sets');
  const beforeMove = allFiles();
  const gw3Before = readLog().find(e => e.id === 'gw3');
  await page.click(`${walkDay} .sr:has-text("20:49") [data-act="move-entry"]`);
  check('the move modal says only this activity moves', /Only this activity moves/.test(await text('#mdbody')) && /20:49/.test(await text('#mdbody')));
  await page.selectOption('#mvto', 'example-gym|cardio|tm');
  await page.click('[data-act="move-session-do"]');
  await page.waitForFunction(() => /Moved|failed/.test(document.getElementById('toast').textContent), null, { timeout: 15000 });
  await waitSynced();
  const after = readLog();
  const gw3 = after.find(e => e.id === 'gw3');
  check('the 20:49 walk is on the other gym\'s machine', gw3.gym_id === 'example-gym' && gw3.gym === 'Example Gym' && gw3.room_id === 'cardio' && gw3.machine_id === 'tm' && gw3.machine === 'Treadmill' && gw3.set === 1, JSON.stringify(gw3));
  const strip = e => { const { gym_id, gym, room_id, room, machine_id, machine, set, ...r } = e; return JSON.stringify(r); };
  check('it keeps its id, Garmin link, time, distance, HR, zones and notes', strip(gw3) === strip(gw3Before));
  check('the other two walks stay on Walk, untouched', ['gw1', 'gw2'].every(id => { const e = after.find(x => x.id === id); return e.machine_id === 'walk' && e.gym_id === 'generic' && e.set === 1; }));
  check('the move is one commit of only that month', changedSince(beforeMove).join() === 'log/2026-11.json', changedSince(beforeMove).join());
  check('Walk now shows two sets that day', (await page.$$(`${walkDay} .sr`)).length === 2);
  // delete one of the two that are left
  await page.click(`${walkDay} .sr:has-text("13:09") [data-act="del-entry"]`);
  await page.click('[data-act="modal-ok"]');
  await waitToast();
  const left = readLog();
  check('deleting one walk leaves the other', !left.some(e => e.id === 'gw2') && left.some(e => e.id === 'gw1' && e.machine_id === 'walk') && left.some(e => e.id === 'gw3'));
  check('a one-set session has no per-set buttons', (await page.$$(`${walkDay} [data-act="move-entry"]`)).length === 0 && (await page.$$(`${walkDay} [data-act="move-session"]`)).length === 1);
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

// 11. Machine photos are shown whole (landscape, portrait, square), in both themes;
// a transparent PNG is uploaded on white, not black.
if (usingFixture) {
  for (const scheme of ['dark', 'light']) {
    const o = await openPage(scheme);
    const pg = o.page;
    const pshot = async name => { await pg.waitForTimeout(300); await pg.screenshot({ path: path.join(SHOTS, `${String(++n).padStart(2, '0')}-${name}-${scheme}.png`), fullPage: true }); };
    await pg.click('#homebody .row:has-text("Example Gym")');
    await pg.click('#roomsbody .row:has-text("Weight Room")');
    await pg.waitForFunction(() => [...document.querySelectorAll('.mi img')].length >= 2 && [...document.querySelectorAll('.mi img')].every(i => i.complete && i.naturalWidth), null, { timeout: 5000 });
    await pshot('photos-grid');
    const tiles = await pg.$$eval('.mc', els => els.map(e => e.querySelector('.mi').getBoundingClientRect().height));
    check(`grid tiles are the same size (${scheme})`, tiles.length >= 2 && tiles.every(h => Math.abs(h - tiles[0]) < 1), tiles.join());
    check(`grid photos shown whole (${scheme})`, (await pg.$$eval('.mi img', ims => ims.map(i => getComputedStyle(i).objectFit))).every(f => f === 'contain'));
    for (const [name, file] of [['Seated Row', 'landscape'], ['Assisted Pull-up', 'portrait']]) {
      await pg.click(`.mc:has-text("${name}")`);
      await pg.waitForFunction(() => { const i = document.querySelector('.hero img'); return i && i.complete && i.naturalWidth; }, null, { timeout: 5000 });
      await pshot(`photo-${file}`);
      const ok = await pg.$eval('.hero img', im => {
        const fit = getComputedStyle(im).objectFit, r = im.naturalWidth / im.naturalHeight, b = im.clientWidth / im.clientHeight;
        return (fit === 'contain' || Math.abs(r - b) < 0.02) && im.clientHeight >= 200;
      });
      check(`detail ${file} photo shown whole and not tiny (${scheme})`, ok);
      await pg.click('#s-detail .back');
    }
    await pg.click('#s-machines .back');
    await pg.click('#roomsbody .row:has-text("Cardio")');
    await pg.click('.mc:has-text("Treadmill")');
    await pg.waitForFunction(() => { const i = document.querySelector('.hero img'); return i && i.complete && i.naturalWidth; }, null, { timeout: 5000 });
    await pshot('photo-square');
    check(`detail square photo is square and full width (${scheme})`, await pg.$eval('.hero img', im => Math.abs(im.clientWidth - im.clientHeight) < 2 && im.clientWidth >= 380));
    // The editor: the current photo, then a transparent PNG
    while (!(await pg.$('#s-home.on'))) await pg.click('.scr.on .back');
    await pg.click('#s-home [data-act="nav"][data-to="settings"]');
    await pg.click('#settingsbody [data-act="nav"][data-to="equipment"]');
    await pg.click('#eqbody .row:has-text("Example Gym")');
    await pg.click('#gymeqbody .row:has-text("Weight Room")');
    await pg.click('[data-act="eq-m-edit"][data-id="assist"]');
    await pg.waitForFunction(() => { const i = document.querySelector('#mpa img'); return i && i.complete && i.naturalWidth; }, null, { timeout: 5000 });
    await pshot('photo-editor');
    check(`editor preview shows the photo whole (${scheme})`, await pg.$eval('#mpa img', im => getComputedStyle(im).objectFit === 'contain'));
    if (scheme === 'dark') {
      await pg.setInputFiles('#photoin', path.join(ROOT, 'tests/fixtures/photo-transparent.png'));
      await pg.waitForFunction(() => /Photo ready/.test(document.getElementById('mpa').textContent), null, { timeout: 5000 });
      const corner = await pg.$eval('#mpa img', async im => {
        await im.decode();
        const c = document.createElement('canvas'); c.width = im.naturalWidth; c.height = im.naturalHeight;
        const x = c.getContext('2d'); x.drawImage(im, 0, 0);
        return [...x.getImageData(1, 1, 1, 1).data];
      });
      check('a transparent PNG becomes white, not black', corner[0] > 240 && corner[1] > 240 && corner[2] > 240, corner.join());
      await pshot('photo-transparent-upload');
    }
    await o.ctx.close();
  }
}

// 12. Last night's sleep and HRV (garmin-recent.json) join daily-wellness.csv in the report,
//     and every night is filed under the evening it starts (0.4.5): last night is yesterday.
if (usingFixture) {
  const today = localDate(), wk = weekBounds(today, 'mon');
  const days = [];
  for (let d = wk.start; d < today; d = addDays(d, 1)) days.push(d);
  const wGoals = { week_start: 'mon', goals: [
    { id: 'sleep', label: 'Average sleep', kind: 'avg', source: 'wellness', field: 'sleep_sec', target: 25560, display: 'h' },
    { id: 'steps', label: 'Total steps', kind: 'sum', source: 'wellness', field: 'steps', target: 70000 }] };
  // A row from last week too, so the wellness cards show even on a Monday.
  const wellnessCSV = 'date,steps,sleep_sec,hrv_ms\n' + [addDays(wk.start, -1), ...days].map(d => `${d},9000,25200,40`).join('\n') + '\n';
  const recentJSON = r => JSON.stringify({ today, today_stats: { steps: 1234 }, sleep: { date: today, sleep_sec: 28980, score: 80 }, hrv: { date: today, last_night_ms: 45, status: 'BALANCED' }, ...r });
  const sleepCard = async (pg) => {
    await pg.click('#s-home [data-act="nav"][data-to="reports"]');
    await pg.click('.rc:has-text("Average sleep") .rch');
    return { sub: (await pg.textContent('.rc:has-text("Average sleep") .rcs')) || '', rows: await pg.$$eval('.rc:has-text("Average sleep") .rdr .d', els => els.map(e => e.textContent)),
      steps: await pg.$$eval('.rc:has-text("Total steps") .rdr .d', els => els.map(e => e.textContent)) };
  };
  const base = { ...seed, 'goals.json': JSON.stringify(wGoals), 'daily-wellness.csv': wellnessCSV };
  const withRecent = createFakeGitHub({ ...base, 'garmin-recent.json': recentJSON() });
  fake.fetch = withRecent.fetch;
  let o = await openPage();
  let c = await sleepCard(o.page);
  await o.page.screenshot({ path: path.join(SHOTS, `${String(++n).padStart(2, '0')}-report-last-night.png`), fullPage: true });
  // Nights this week: from the week's first evening to last night (yesterday); none on its first day.
  const lastNight = c => days.length ? c.rows.length === days.length && c.rows[c.rows.length - 1] === fmtShortDate(addDays(today, -1)) : c.rows.length === 0;
  check('report lists last night\'s sleep under yesterday', lastNight(c), c.rows.join());
  check('report counts last night in the sleep days', !days.length || c.sub.includes(`${days.length} day`), c.sub);
  check('sleep and steps end on the same day', c.steps.join() === c.rows.join(), `${c.steps.join()} / ${c.rows.join()}`);
  // A device copy saved by 0.4.2 (no appFiles, no garmin-recent.json) at the current head: 0.4.4 still finds the file.
  await o.page.evaluate(() => new Promise((resolve, reject) => {
    const req = indexedDB.open('traintracks');
    req.onerror = () => reject(req.error);
    req.onsuccess = () => {
      const tx = req.result.transaction('snapshots', 'readwrite'), st = tx.objectStore('snapshots');
      st.openCursor().onsuccess = e => {
        const cur = e.target.result; if (!cur) return;
        const v = { ...cur.value, files: { ...cur.value.files } };
        delete v.appFiles; delete v.files['garmin-recent.json'];
        cur.update(v); cur.continue();
      };
      tx.oncomplete = () => { req.result.close(); resolve(); };
      tx.onerror = () => reject(tx.error);
    };
  }));
  await o.page.reload();
  await o.page.waitForFunction(() => !document.getElementById('ld').classList.contains('on'), null, { timeout: 20000 });
  await o.page.waitForTimeout(500);
  c = await sleepCard(o.page);
  check('a device copy from an older version gets garmin-recent.json at the same head', lastNight(c), c.rows.join());
  await o.ctx.close();
  // An unreadable garmin-recent.json is ignored: the report works from the CSV alone.
  fake.fetch = createFakeGitHub({ ...base, 'garmin-recent.json': '{ not json' }).fetch;
  o = await openPage();
  c = await sleepCard(o.page);
  check('a malformed garmin-recent.json is ignored', c.rows.length === Math.max(days.length - 1, 0), c.rows.join());
  await o.ctx.close();
  fake.fetch = oldFetch;
}

await browser.close();
server.close();

const realErrors = errors.filter(e => !/Failed to load resource.*(404|503)/.test(e));
check('no console errors (incl. Content-Security-Policy)', realErrors.length === 0, realErrors.join('\n'));
const failed = results.filter(r => !r.ok);
console.log(`${results.length - failed.length}/${results.length} checks passed; screenshots in ${SHOTS}`);
process.exit(failed.length ? 1 : 0);
