/**
 * Load and save timings on a phone-like link, against the in-memory fake
 * GitHub seeded with a made-up repo the size of a busy six months.
 *
 *   node tests/e2e/measure.mjs [app-dir] [--entries 1700] [--layout auto|v2|months] [--day0 2026-11-10]
 *
 * --day0: the newest date in the made-up log (it runs back from there). Saves
 * go to today's month, so a --day0 at the end of this month makes that month
 * full: the largest month a save uploads.
 *
 * app-dir: the app to serve (default: this checkout), so an older version can
 * be measured from a `git worktree`. The link is modelled, not emulated: one
 * shared downlink (8 Mbit/s) and uplink (2 Mbit/s), 120 ms round trips,
 * responses counted at their gzipped size (as GitHub and Pages send them),
 * request bodies uncompressed (browsers don't compress uploads). The CPU is
 * throttled 4x, and each GitHub API call adds 100 ms of server time. Every
 * request, app files included, goes through the model.
 *
 * Prints: first open (no copy on the device), second open (copy on the
 * device), and two saves in a row (time until GitHub has each), with the
 * number of GitHub calls and bytes each way.
 */
import { createRequire } from 'node:module';
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { createFakeGitHub } from '../fake-github.js';
import { logToJSON, logToCSV } from '../../lib/log.js';

const { chromium } = createRequire(import.meta.url)(process.env.PLAYWRIGHT_PATH || 'playwright');
const args = process.argv.slice(2);
const opt = (name, d) => { const i = args.indexOf(`--${name}`); return i >= 0 ? args.splice(i, 2)[1] : d; };
const ENTRIES = +opt('entries', 1700);
const DAY0 = opt('day0', '2026-11-10');
let LAYOUT = opt('layout', 'auto');
const APP = path.resolve(args[0] || new URL('../..', import.meta.url).pathname);
if (LAYOUT === 'auto') LAYOUT = /^0\.2\./.test(fs.readFileSync(path.join(APP, 'VERSION'), 'utf8')) ? 'v2' : 'months';

const LINK = { rttMs: 120, downBps: 8e6, upBps: 2e6, cpu: 4, serverMs: 100 }; // serverMs: GitHub's own time per API call

// ---------------------------------------------------------- made-up repo ----

let rnd = 42;
const rand = () => ((rnd = (rnd * 1103515245 + 12345) % 2147483648) / 2147483648);
const pick = a => a[Math.floor(rand() * a.length)];
const generic = JSON.parse(fs.readFileSync(path.join(APP, 'equipment/generic/gym.json'), 'utf8'));
const seed = { 'equipment/generic/gym.json': JSON.stringify(generic, null, 2) + '\n', VERSION: fs.readFileSync(path.join(APP, 'VERSION'), 'utf8') };
const gyms = [];
for (let g = 1; g <= 7; g++) {
  const rooms = ['Weight Room — Upstairs', 'Cardio Floor', 'Machine Circuit'].map((rn, ri) => ({
    id: `room${ri}`, name: rn,
    machines: Array.from({ length: 14 }, (_, k) => ({ id: `machine-${ri}-${k}`, name: `${rn.split(' ')[0]} Station ${k + 1} (Plate Loaded)`, muscles_worked: 'Back, biceps, shoulders and core', log_type: ri === 1 ? 'pace' : 'weight', image: '' }))
  }));
  const gym = { id: `gym-${g}`, name: `Example Gym ${g} Fitness Club`, icon: '🏋️', rooms };
  gyms.push(gym);
  seed[`equipment/my-gyms/gym-${g}/gym.json`] = JSON.stringify(gym, null, 2) + '\n';
}
const log = [];
const day0 = Date.parse(`${DAY0}T00:00:00Z`);
for (let d = 0; log.length < ENTRIES; d++) {
  const date = new Date(day0 - d * 86400000).toISOString().slice(0, 10);
  const gym = pick(gyms);
  for (let s = 0; s < 4 && log.length < ENTRIES; s++) {
    const room = pick(gym.rooms), m = pick(room.machines);
    const sets = room.id === 'room1' ? 1 : 3;
    for (let k = 1; k <= sets && log.length < ENTRIES; k++) {
      const e = { id: `e${(log.length + 100000).toString(36)}x${k}`, date, time: '18:05:12', gym_id: gym.id, gym: gym.name, room_id: room.id, room: room.name,
        machine_id: m.id, machine: m.name, variant: rand() < 0.5 ? ['neutral', 'wide'] : [], set: k };
      if (room.id === 'room1') Object.assign(e, { duration_sec: 1200 + Math.floor(rand() * 1800), speed_mph: 3.4, distance_mi: 1.9, hr_avg_bpm: 120 + Math.floor(rand() * 20),
        garmin_id: String(19000000000 + log.length), zone1_min: 3.2, zone2_min: 14.5, zone3_min: 4.12, zone4_min: 0, zone5_min: 0,
        notes: `Garmin ${19000000000 + log.length}; placed where you logged that day. Felt fine.` });
      else Object.assign(e, { weight_lb: 40 + 5 * Math.floor(rand() * 20), reps: 8 + Math.floor(rand() * 5), notes: rand() < 0.9 ? 'Slow on the way down, last set close to failure, seat at 4, back pad at 2, felt strong' : '' });
      log.push(e);
    }
  }
}
if (LAYOUT === 'v2') {
  seed['workout-log.json'] = logToJSON(log);
  seed['workout-log.csv'] = logToCSV(log);
} else {
  const { splitLog, monthToText } = await import(path.join(APP, 'lib/months.js'));
  for (const [p, entries] of Object.entries(splitLog(log))) seed[p] = monthToText(entries);
  seed['workout-log.csv'] = logToCSV(log);
}
seed['profile.json'] = '{ "first_name": "Sam" }\n';
seed['goals.json'] = fs.readFileSync(new URL('../fixtures/user-repo/goals.json', import.meta.url), 'utf8');
const wcols = ['date', 'steps', 'distance_mi', 'resting_hr_bpm', 'active_kcal', 'total_kcal', 'sleep_sec', 'sleep_score', 'hrv_ms'];
seed['daily-wellness.csv'] = [wcols.join(','), ...Array.from({ length: 365 }, (_, i) => [new Date(day0 - i * 86400000).toISOString().slice(0, 10), 8000 + i, 3.9, 58, 540, 2600, 25200, 81, 44].join(','))].join('\n') + '\n';
const bcols = ['activity_id', 'date', 'start', 'activity_type', 'duration_sec', 'hr_avg_bpm', 'hr_max_minute_bpm', ...Array.from({ length: 14 }, (_, i) => `hr${90 + 5 * i}_${94 + 5 * i}_sec`)];
seed['cardio-buckets.csv'] = [bcols.join(','), ...Array.from({ length: 220 }, (_, i) => [19000000000 + i, '2026-10-01', '07:00', 'running', 1800, 128, 151, ...Array.from({ length: 14 }, () => 120)].join(','))].join('\n') + '\n';
const fake = createFakeGitHub(seed);
const logBytes = Object.entries(seed).filter(([p]) => p === 'workout-log.json' || p.startsWith('log/')).reduce((n, [, t]) => n + Buffer.byteLength(t), 0);

// ------------------------------------------------------------- the link ----

const link = { upFree: 0, downFree: 0 };
let calls = [], upBytes = 0, downBytes = 0;
const wait = ms => new Promise(r => setTimeout(r, Math.max(0, ms)));
async function through(reqBytes, respBody, compressible, serverMs = 0) {
  const now = Date.now();
  const upStart = Math.max(now, link.upFree);
  link.upFree = upStart + (reqBytes * 8 / LINK.upBps) * 1000;
  const ready = link.upFree + LINK.rttMs + serverMs;
  const size = (compressible ? zlib.gzipSync(respBody).length : respBody.length) + 300;
  const downStart = Math.max(ready, link.downFree);
  link.downFree = downStart + (size * 8 / LINK.downBps) * 1000;
  upBytes += reqBytes; downBytes += size;
  await wait(link.downFree - Date.now());
}

const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.webmanifest': 'application/manifest+json' };
async function wire(page) {
  await page.route(/.*/, async route => {
    const req = route.request();
    const u = new URL(req.url());
    const reqBytes = 400 + Buffer.byteLength(req.postData() || '');
    if (u.hostname === 'api.github.com') {
      const accept = req.headers().accept;
      const r = await fake.fetch(req.url(), { method: req.method(), headers: { Accept: accept }, body: req.postData() });
      const body = Buffer.from(r.status === 204 ? '' : accept === 'application/vnd.github.raw+json' ? await r.text() : JSON.stringify(await r.json()));
      calls.push(`${req.method()} ${u.pathname.replace(/^\/repos\/[^/]+\/[^/]+/, '')}`);
      await through(reqBytes, body, true, LINK.serverMs);
      return route.fulfill({ status: r.status, contentType: 'application/json', body });
    }
    if (u.hostname === 'localhost') {
      let p = decodeURIComponent(u.pathname);
      if (p.endsWith('/')) p += 'index.html';
      const f = path.join(APP, p);
      if (!f.startsWith(APP) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) return route.fulfill({ status: 404, body: 'nf' });
      const body = fs.readFileSync(f);
      await through(reqBytes, body, !/\.(png|jpg)$/.test(f));
      return route.fulfill({ status: 200, contentType: MIME[path.extname(f)] || 'application/octet-stream', body });
    }
    await through(reqBytes, Buffer.alloc(30000), false); // photos
    return route.fulfill({ status: 404, body: 'nf' });
  });
}

// --------------------------------------------------------------- the run ----

const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 400, height: 820 }, deviceScaleFactor: 1 });
const page = await ctx.newPage();
const errors = [];
page.on('pageerror', e => errors.push(String(e)));
await wire(page);
const cdp = await ctx.newCDPSession(page);
await cdp.send('Emulation.setCPUThrottlingRate', { rate: LINK.cpu });
await page.goto('http://localhost:8090/');
await page.evaluate(() => localStorage.setItem('tt-cfg', JSON.stringify({ user: 'tester', repo: 'traintracks', token: 'github_pat_test' })));

const results = [];
const reset = () => { calls = []; upBytes = 0; downBytes = 0; };
const homeShown = () => page.waitForFunction(() => !document.getElementById('ld').classList.contains('on') && document.querySelectorAll('#homebody .row').length > 0, null, { timeout: 120000, polling: 50 });
const fresh = () => page.waitForFunction(() => !document.body.dataset.load || document.body.dataset.load === 'fresh', null, { timeout: 120000, polling: 50 });
const kb = b => `${(b / 1024).toFixed(0)} KB`;

async function open(name) {
  reset();
  const t0 = Date.now();
  await page.goto('http://localhost:8090/');
  await homeShown();
  const tHome = Date.now() - t0;
  await fresh();
  const tFresh = Date.now() - t0;
  await page.waitForTimeout(300);
  results.push({ name, home: tHome, fresh: tFresh, calls: calls.filter(c => c).length, up: upBytes, down: downBytes, list: calls.slice() });
}

async function save(name) {
  await page.click('#homebody .row:has-text("Example Gym 1")');
  await page.click('#roomsbody .row:has-text("Weight Room")');
  await page.click('.mc >> nth=0');
  await page.click('[data-act="start-log"]');
  for (const inp of await page.$$('#stb input')) await inp.fill(String(5 + results.length));
  reset();
  const t0 = Date.now();
  await page.click('[data-act="log-save"]');
  await page.waitForFunction(() => /saved/i.test(document.getElementById('toast').textContent), null, { timeout: 30000, polling: 50 });
  const tScreen = Date.now() - t0;
  await page.waitForFunction(() => document.body.dataset.sync === 'idle' || document.body.dataset.sync === 'error', null, { timeout: 120000, polling: 50 });
  const tGitHub = Date.now() - t0;
  const state = await page.evaluate(() => document.body.dataset.sync);
  results.push({ name, screen: tScreen, github: tGitHub, ok: state === 'idle', calls: calls.length, up: upBytes, down: downBytes, list: calls.slice() });
  while (!(await page.$('#s-home.on'))) await page.click('.scr.on .back');
}

await open('first open (nothing on the device)');
await open('second open (copy on the device)');
await save('save 1');
await save('save 2 (right after)');
fake.write({ 'profile.json': '{ "first_name": "Sam", "note": "edited elsewhere" }\n' }, 'another device');
await open('open after another writer changed one small file');

await browser.close();
console.log(`app ${APP} (v${seed.VERSION.trim()}, layout ${LAYOUT}), ${ENTRIES} log entries (${kb(logBytes)} of log JSON), link ${LINK.downBps / 1e6}/${LINK.upBps / 1e6} Mbit/s, ${LINK.rttMs} ms RTT, CPU ${LINK.cpu}x`);
for (const r of results) {
  const t = r.home != null ? `home ${(r.home / 1000).toFixed(2)} s, up to date ${(r.fresh / 1000).toFixed(2)} s` : `screen back ${(r.screen / 1000).toFixed(2)} s, on GitHub ${(r.github / 1000).toFixed(2)} s${r.ok ? '' : ' (FAILED)'}`;
  console.log(`${r.name.padEnd(52)} ${t}; ${r.calls} GitHub calls, ${kb(r.up)} up, ${kb(r.down)} down`);
  if (process.env.VERBOSE) console.log('   ' + r.list.join('\n   '));
}
if (errors.length) console.log('page errors:', errors.join('\n'));
