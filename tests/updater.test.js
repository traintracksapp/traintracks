import { test } from 'node:test';
import assert from 'node:assert/strict';
import { inScope, planUpdate, compareVersions, changelogBetween, checkForUpdate, applyUpdate } from '../lib/updater.js';
import { SYNC_PREFIXES, SYNC_EXCLUDE } from '../lib/config.js';
import { GitHubRepo } from '../lib/github.js';
import { createFakeGitHub } from './fake-github.js';

test('inScope: app files only; data, personal gyms and workflows never', () => {
  for (const p of ['index.html', 'app/main.js', 'lib/log.js', 'docs/SETUP.md', 'equipment/generic/gym.json', 'equipment/generic/images/run.jpg', 'pipelines/garmin/common.py', 'VERSION', 'CHANGELOG.md', '.nojekyll']) assert.ok(inScope(p), p);
  for (const p of ['workout-log.json', 'workout-log.csv', 'profile.json', 'goals.json', 'suggested-workout.json', 'equipment/my-gyms/x/gym.json',
    'equipment/generic.local.json', '.github/workflows/garmin.yml', 'daily-wellness.csv', 'CNAME', 'README.md', 'appendix/x', 'libx']) assert.ok(!inScope(p), p);
});

test('planUpdate: added, changed, unchanged; personal Garmin settings added if missing but never overwritten', () => {
  const tpl = { 'index.html': 'a', 'app/main.js': 'b', 'lib/new.js': 'c', 'workout-log.json': 'x', 'pipelines/garmin/zones.json': 'z1', 'pipelines/garmin/mapping.json': 'm1' };
  const mine = { 'index.html': 'a', 'app/main.js': 'OLD', 'workout-log.json': 'mine', 'pipelines/garmin/zones.json': 'MINE' };
  const p = planUpdate(tpl, mine);
  assert.deepEqual(p.changed, ['app/main.js']);
  assert.deepEqual(p.added, ['lib/new.js', 'pipelines/garmin/mapping.json']);
  assert.equal(p.unchanged, 2);
  assert.ok(SYNC_EXCLUDE.every(f => inScope(f, SYNC_PREFIXES)));
});

test('compareVersions', () => {
  assert.equal(compareVersions('0.2.0', '0.1.0'), 1);
  assert.equal(compareVersions('0.1.0', '0.1'), 0);
  assert.equal(compareVersions('0.2.0-dev', '0.2.0'), -1);
  assert.equal(compareVersions('0.2.0', '0.2.0-dev'), 1);
  assert.equal(compareVersions('1.10.0', '1.9.9'), 1);
});

test('changelogBetween: only the versions after mine, up to the template', () => {
  const cl = '# Changelog\n\n## 0.3.0\n\n- c\n\n## 0.2.0\n\n- b\n\n## 0.1.0\n\n- a\n';
  assert.equal(changelogBetween(cl, '0.1.0', '0.3.0'), '## 0.3.0\n\n- c\n\n## 0.2.0\n\n- b');
  assert.equal(changelogBetween(cl, '0.2.0', '0.2.0'), '');
});

function twoRepos() {
  const tplFake = createFakeGitHub({ 'index.html': '<new>', 'app/main.js': 'new main', 'lib/added.js': 'added', 'VERSION': '0.3.0\n',
    'CHANGELOG.md': '## 0.3.0\n- shiny\n## 0.2.0\n- old\n', 'pipelines/garmin/zones.json': '{"rhr_bpm":60}', 'equipment/generic/images/x.jpg': 'JPEGBYTES' });
  const myFake = createFakeGitHub({ 'index.html': '<old>', 'app/main.js': 'new main', 'VERSION': '0.2.0\n', 'workout-log.json': '[]\n', 'pipelines/garmin/zones.json': '{"rhr_bpm":46}' });
  const tpl = new GitHubRepo({ owner: 'traintracksapp', repo: 'traintracks', fetch: tplFake.fetch });
  const mine = new GitHubRepo({ owner: 'someone', repo: 'traintracks', token: 't', fetch: myFake.fetch });
  return { tplFake, myFake, tpl, mine };
}

test('checkForUpdate: plan, template version and the changelog since my version', async () => {
  const { tpl, mine } = twoRepos();
  const c = await checkForUpdate(tpl, mine, '0.2.0');
  assert.deepEqual(c.plan.all.sort(), ['CHANGELOG.md', 'VERSION', 'equipment/generic/images/x.jpg', 'index.html', 'lib/added.js'].sort());
  assert.equal(c.templateVersion, '0.3.0');
  assert.equal(c.changelog, '## 0.3.0\n- shiny');
});

test('applyUpdate: one commit; data and personal settings untouched', async () => {
  const { myFake, tpl, mine } = twoRepos();
  const c = await checkForUpdate(tpl, mine, '0.2.0');
  const before = myFake.commitCount();
  const n = await applyUpdate(tpl, mine, c);
  assert.equal(n, 5);
  assert.equal(myFake.commitCount(), before + 1);
  assert.equal(myFake.read('index.html'), '<new>');
  assert.equal(myFake.read('lib/added.js'), 'added');
  assert.equal(myFake.read('equipment/generic/images/x.jpg'), 'JPEGBYTES');
  assert.equal(myFake.read('VERSION'), '0.3.0\n');
  assert.equal(myFake.read('pipelines/garmin/zones.json'), '{"rhr_bpm":46}');
  assert.equal(myFake.read('workout-log.json'), '[]\n');
});

test('applyUpdate: retries once if the repo moved, then succeeds', async () => {
  const { myFake, tpl, mine } = twoRepos();
  const c = await checkForUpdate(tpl, mine, '0.2.0');
  myFake.hooks.beforePatchRef = () => myFake.write({ 'workout-log.json': '[{"x":1}]\n' }, 'app save');
  await applyUpdate(tpl, mine, c);
  assert.equal(myFake.read('workout-log.json'), '[{"x":1}]\n', 'the other write survives');
  assert.equal(myFake.read('index.html'), '<new>');
});

test('applyUpdate uses the given downloader (the app downloads raw files at the pinned commit)', async () => {
  const { tpl, mine, myFake } = twoRepos();
  const c = await checkForUpdate(tpl, mine, '0.2.0');
  assert.match(c.templateHead, /^c/);
  const asked = [];
  await applyUpdate(tpl, mine, c, () => {}, { download: async p => { asked.push(p); return new TextEncoder().encode(`raw:${p}`); } });
  assert.deepEqual(asked.sort(), c.plan.all.slice().sort());
  assert.equal(myFake.read('index.html'), 'raw:index.html');
});
