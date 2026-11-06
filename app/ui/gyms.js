/** Gym → rooms → machine grid → machine detail (history). */
import { S } from '../state.js';
import { html, act, setHTML, setText, on, toast, $, qs, confirmDialog, showLoading, hideLoading } from './dom.js';
import { screen, nav, refresh } from './nav.js';
import { imageUrl, commitLog } from '../data.js';
import { visibleCount } from '../../lib/gyms.js';
import { lastSession, sessionDates, sessionEntries, removeSession, garminIdOf } from '../../lib/log.js';
import { fmtLast, fmtSet, fmtDateFull, fmtDuration } from '../../lib/format.js';
import { zonesFromBuckets, cleanFloors } from '../../lib/goals.js';
import { AEROBIC_TYPES } from '../../lib/config.js';
import { startLog } from './logform.js';

export function openGym(gid) {
  const g = S.gyms.find(x => x.id === gid); if (!g) return;
  S.gym = g;
  if (g.rooms.length === 1) { S.room = g.rooms[0]; nav('machines'); }
  else nav('rooms');
}

function renderRooms() {
  if (!S.gym) return;
  setText('rooms-title', S.gym.name);
  setHTML('roomsbody', html`<div class="card" style="margin-top:12px">${S.gym.rooms.map(r => html`<div class="row" ${act('open-room', { id: r.id })}><div class="tx"><h2>${r.name}</h2></div><span class="meta">${visibleCount(r)} machines</span><span class="ch">›</span></div>`)}</div>`);
}

/** Fill <img data-img="gymId|file"> elements lazily (public: raw URL; private: API blob). */
export function hydrateImages(root) {
  (root || document).querySelectorAll('img[data-img]').forEach(async img => {
    const [gymId, file] = img.dataset.img.split('|');
    const gym = S.gyms.find(g => g.id === gymId);
    delete img.dataset.img;
    try {
      const url = await imageUrl(gym, file);
      if (url) { img.src = url; img.onerror = () => { img.parentElement.textContent = '🏋️'; }; }
      else img.parentElement.textContent = '🏋️';
    } catch (e) { img.parentElement.textContent = '🏋️'; }
  });
}

function imgBox(gym, m, cls) {
  return m.image ? html`<div class="${cls}"><img data-img="${gym.id}|${m.image}" alt="${m.name}" loading="lazy"></div>` : html`<div class="${cls}">🏋️</div>`;
}

function renderMachines() {
  if (!S.gym || !S.room) return;
  const multi = S.gym.rooms.length > 1;
  setText('machines-title', multi ? S.room.name : S.gym.name);
  const vis = S.room.machines.filter(m => !m.hidden);
  const grid = $('mgrid');
  grid.innerHTML = vis.length ? vis.map(m => {
    const ls = lastSession(S.log, m.id, S.gym.id);
    const lh = ls ? html`<div class="ml">${fmtLast(ls, m.logType)}</div>` : html`<div class="mn0">No sessions yet</div>`;
    return html`<button class="mc" ${act('open-machine', { id: m.id })}>${imgBox(S.gym, m, 'mi')}<div class="mn"><h3>${m.name}</h3>${lh}</div></button>`;
  }).join('') : html`<div class="empty" style="grid-column:1/-1"><div class="icon">🪑</div><p>No machines in this room yet.<br>Add some in Settings → Manage Equipment.</p></div>`;
  hydrateImages(grid);
}

function zoneRow(f0) {
  const row = S.buckets[garminIdOf(f0)];
  const fl = cleanFloors(S.goals && S.goals.hrZones);
  if (row && fl.length) {
    const z = zonesFromBuckets(row, fl);
    const parts = z.zones.map((v, i) => `Z${i + 1}:${v > 0 ? fmtDuration(v) + 'm' : '—'}`);
    if (z.below > 0) parts.unshift(`<Z1:${fmtDuration(z.below)}m`);
    return html`<div class="zr">${parts.join(' · ')}${row.avgHr ? ` · avg ${row.avgHr} bpm` : ''}</div>`;
  }
  if (![1, 2, 3, 4, 5].some(i => f0['zone' + i] != null)) return '';
  return html`<div class="zr">${[1, 2, 3, 4, 5].map(i => `Z${i}:${f0['zone' + i] != null ? fmtDuration(f0['zone' + i]) + 'm' : '—'}`).join(' · ')}</div>`;
}

export function renderDetail() {
  const m = S.machine, gym = S.gym; if (!m || !gym) return;
  setText('detail-title', m.name);
  const dates = sessionDates(S.log, m.id, gym.id);
  const shown = dates.slice(0, S.historyAll ? 200 : 5);
  const hist = shown.length ? shown.map(d => {
    const sets = sessionEntries(S.log, { gymId: gym.id, machineId: m.id, date: d });
    const notes = (sets.find(s => s.notes) || {}).notes || '';
    const f0 = sets[0];
    const isAero = AEROBIC_TYPES.includes(m.logType) || f0.incline != null || f0.hr != null || garminIdOf(f0);
    return html`<div class="hi"><div class="hd"><span>${fmtDateFull(d)}</span><div class="ha"><button class="ib" ${act('edit-session', { date: d })} title="Edit" aria-label="Edit">✏️</button><button class="ib danger" ${act('del-session', { date: d })} title="Delete" aria-label="Delete">🗑️</button></div></div>
      ${sets.map(s => html`<div class="sr"><span class="sn">Set ${s.set}</span><span class="sv">${fmtSet(s, m.logType)}</span></div>`)}
      ${isAero ? zoneRow(f0) : ''}
      ${notes ? html`<div class="hn">“${notes}”</div>` : ''}</div>`;
  }) : html`<div class="empty" style="padding:28px 24px"><div class="icon">📋</div><p>No sessions logged yet.</p></div>`;
  const more = dates.length > shown.length ? html`<button class="btn ghost" ${act('history-more')}>Show all ${dates.length} sessions</button>` : '';
  setHTML('detailbody', html`${imgBox(gym, m, 'hero')}<div class="dm"><h2>${m.name}</h2>${m.musclesWorked ? html`<p class="mu">${m.musclesWorked}</p>` : ''}</div>
    <button class="btn" ${act('start-log')}>Log today</button>
    <div class="sh">History</div>${hist}${more}`);
  hydrateImages($('detailbody'));
}

export function openMachine(mid, gymId) {
  const gym = gymId ? S.gyms.find(g => g.id === gymId) : S.gym;
  if (!gym) return;
  for (const r of gym.rooms) {
    const m = r.machines.find(m => m.id === mid);
    if (m) { S.gym = gym; S.room = r; S.machine = m; S.historyAll = false; nav('detail'); return; }
  }
}

screen('rooms', renderRooms);
screen('machines', renderMachines);
screen('detail', renderDetail);

on('open-room', d => { const r = S.gym.rooms.find(r => r.id === d.id); if (r) { S.room = r; nav('machines'); } });
on('open-machine', d => openMachine(d.id));
on('start-log', () => startLog(null));
on('edit-session', d => startLog(d.date));
on('history-more', () => { S.historyAll = true; renderDetail(); });
on('del-session', async d => {
  const ok = await confirmDialog('Delete session?', `${S.machine.name} on ${fmtDateFull(d.date)} will be removed from your log.`, { ok: 'Delete', danger: true });
  if (!ok) return;
  showLoading('Deleting…');
  try {
    const s = { gymId: S.gym.id, machineId: S.machine.id, date: d.date };
    await commitLog(base => removeSession(base, s), `Delete ${S.machine.name} ${d.date}`);
    toast('Session deleted', 'ok');
    renderDetail();
  } catch (e) { toast(`Delete failed: ${e.message}`, 'err'); }
  finally { hideLoading(); }
});
