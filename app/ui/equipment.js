/** Manage equipment: gyms, rooms, machines, photos, catalog import. */
import { S, hasCfg, genericGym, myGyms } from '../state.js';
import { html, act, setHTML, setText, on, toast, $, modal, closeModal, val, confirmDialog, showLoading, hideLoading } from './dom.js';
import { screen, nav, back } from './nav.js';
import { saveGym, uploadImage, loadCatalog, importCatalogGym, imageUrl, loadGyms } from '../data.js';
import { newGym, newRoom, newMachine, GENERIC_ID } from '../../lib/gyms.js';
import { LOG_TYPES, CATALOG } from '../../lib/config.js';
import { renderHome } from './home.js';
import { hydrateImages } from './gyms.js';

const typeOptions = sel => Object.entries(LOG_TYPES).map(([k, v]) => html`<option value="${k}" ${sel === k ? 'selected' : ''}>${v.label}</option>`);

function renderEquip() {
  const mine = myGyms(), gen = genericGym();
  setHTML('eqbody', html`<div class="sh first">My gyms</div>
    ${mine.length ? html`<div class="card">${mine.map(g => html`<div class="row" ${act('eq-gym', { id: g.id })}><div class="ic">${g.icon || '🏋️'}</div><div class="tx"><h2>${g.name}</h2>${g.source ? html`<p>from catalog · ${g.source}</p>` : ''}</div><button class="ib" ${act('eq-gym-edit', { id: g.id })} aria-label="Edit">✏️</button><button class="ib danger" ${act('eq-gym-del', { id: g.id })} aria-label="Remove">🗑️</button><span class="ch">›</span></div>`)}</div>` : html`<div class="empty" style="padding:20px"><p>No gyms added yet.</p></div>`}
    <button class="btn dashed" ${act('eq-gym-add')}>＋ Add gym</button>
    <button class="btn dashed" style="background:none;border-style:solid" ${act('catalog-open')}>📚 Import from the gym catalog</button>
    <div class="sh">Common exercises</div>
    ${gen ? html`<div class="card"><div class="row" ${act('eq-gym', { id: gen.id })}><div class="ic">${gen.icon || '🏃'}</div><div class="tx"><h2>${gen.name}<span class="pill ro">template</span></h2><p>Updated with the app. You can hide exercises and add your own.</p></div><span class="ch">›</span></div></div>` : html`<div class="empty" style="padding:20px"><p>Generic gym not loaded.</p></div>`}`);
}

function renderGymEq() {
  const g = S.gym; if (!g) return;
  setText('gymeq-title', g.name);
  setHTML('gymeqbody', html`<div class="sh first">Rooms</div><div class="card">${g.rooms.map(r => html`<div class="row" ${act('eq-room', { id: r.id })}><div class="tx"><h2>${r.name}</h2></div><span class="meta">${r.machines.length} machines</span>${g._readonly && !r._local ? '' : html`<button class="ib" ${act('eq-room-edit', { id: r.id })} aria-label="Edit">✏️</button><button class="ib danger" ${act('eq-room-del', { id: r.id })} aria-label="Delete">🗑️</button>`}<span class="ch">›</span></div>`)}</div>
    <button class="btn dashed" ${act('eq-room-add')}>＋ Add room</button>`);
}

function renderRoomEq() {
  const r = S.room, g = S.gym; if (!r || !g) return;
  setText('roomeq-title', r.name);
  const ro = m => g._readonly && !m._local;
  setHTML('roomeqbody', html`<div class="sh first">Machines</div><div class="card">${r.machines.length ? r.machines.map(m => m.hidden
    ? html`<div class="row static dimmed"><div class="tx"><h2>${m.name} <span class="pill">hidden</span></h2></div><button class="ib" ${act('eq-m-unhide', { id: m.id })} aria-label="Unhide">👁️</button></div>`
    : html`<div class="row static"><div class="tx"><h2>${m.name}${ro(m) ? '' : ''}</h2><p>${LOG_TYPES[m.logType] ? LOG_TYPES[m.logType].label : m.logType}${m.musclesWorked ? ` · ${m.musclesWorked}` : ''}</p></div>${ro(m) ? html`<button class="ib" ${act('eq-m-hide', { id: m.id })} aria-label="Hide" title="Hide">🙈</button>` : html`<button class="ib" ${act('eq-m-edit', { id: m.id })} aria-label="Edit">✏️</button><button class="ib danger" ${act('eq-m-del', { id: m.id })} aria-label="Delete">🗑️</button>`}</div>`) : html`<div class="empty" style="padding:20px"><p>No machines yet.</p></div>`}</div>
    <button class="btn dashed" ${act('eq-m-add')}>＋ Add machine</button>
    ${g._readonly ? html`<p class="hint">Template exercises can be hidden but not edited; anything you add here is yours and survives app updates.</p>` : ''}`);
}

async function persist(gym, after) {
  showLoading('Saving…');
  try { await saveGym(gym); if (after) after(); }
  catch (e) { toast(`Save failed: ${e.message}`, 'err'); }
  finally { hideLoading(); }
}

screen('equipment', renderEquip);
screen('gymeq', renderGymEq);
screen('roomeq', renderRoomEq);

// ---- gyms ----
on('eq-gym', d => { const g = S.gyms.find(g => g.id === d.id); if (g) { S.gym = g; nav('gymeq'); } });
on('eq-gym-add', () => modal(html`<h2>Add gym</h2><div class="mr"><label>Gym name</label><input id="m1" type="text" placeholder="e.g. Gold's Gym"></div><div class="mr"><label>Icon (emoji)</label><input id="m2" type="text" value="🏋️" maxlength="4"></div><div class="mbs"><button class="mc2" ${act('modal-close')}>Cancel</button><button class="mo" ${act('eq-gym-add-do')}>Add</button></div>`));
on('eq-gym-add-do', async () => {
  const name = val('m1'); if (!name) { toast('Enter a name', 'err'); return; }
  if (!hasCfg()) { toast('Set up GitHub first', 'err'); return; }
  const g = newGym(name, val('m2'));
  if (S.gyms.find(x => x.id === g.id)) { toast('A gym with that name already exists', 'err'); return; }
  g._path = `equipment/my-gyms/${g.id}`;
  closeModal();
  S.gyms.push(g);
  await persist(g, () => { renderEquip(); renderHome(); toast(`${name} added`, 'ok'); });
});
on('eq-gym-edit', d => { const g = S.gyms.find(g => g.id === d.id); if (!g) return; modal(html`<h2>Edit gym</h2><div class="mr"><label>Name</label><input id="m1" type="text" value="${g.name}"></div><div class="mr"><label>Icon</label><input id="m2" type="text" value="${g.icon || '🏋️'}" maxlength="4"></div><div class="mr"><label>Location (optional)</label><input id="m3" type="text" value="${g.location || ''}"></div><div class="mbs"><button class="mc2" ${act('modal-close')}>Cancel</button><button class="mo" ${act('eq-gym-edit-do', { id: g.id })}>Save</button></div>`); });
on('eq-gym-edit-do', async d => {
  const g = S.gyms.find(g => g.id === d.id); if (!g) return;
  g.name = val('m1') || g.name; g.icon = val('m2') || g.icon; g.location = val('m3');
  closeModal();
  await persist(g, () => { renderEquip(); renderHome(); toast('Gym updated', 'ok'); });
});
on('eq-gym-del', async d => {
  const g = S.gyms.find(g => g.id === d.id); if (!g) return;
  const ok = await confirmDialog(`Remove ${g.name}?`, 'It disappears from the app. Its files stay in your repo and your workout history is kept, so you can import or re-add it later.', { ok: 'Remove', danger: true });
  if (!ok) return;
  // The Contents API cannot move a folder, so the gym file is flagged and skipped on load.
  g.removed = true;
  await persist(g, () => { S.gyms = S.gyms.filter(x => x.id !== d.id); renderEquip(); renderHome(); toast(`${g.name} removed from the app`, 'ok'); });
});

// ---- rooms ----
on('eq-room', d => { const r = S.gym.rooms.find(r => r.id === d.id); if (r) { S.room = r; nav('roomeq'); } });
on('eq-room-add', () => modal(html`<h2>Add room</h2><div class="mr"><label>Room name</label><input id="m1" type="text" placeholder="e.g. Machine room"></div><div class="mbs"><button class="mc2" ${act('modal-close')}>Cancel</button><button class="mo" ${act('eq-room-add-do')}>Add</button></div>`));
on('eq-room-add-do', async () => {
  const name = val('m1'); if (!name) { toast('Enter a name', 'err'); return; }
  const r = newRoom(name); if (S.gym._readonly) r._local = true;
  S.gym.rooms.push(r); closeModal();
  await persist(S.gym, () => { renderGymEq(); toast(`${name} added`, 'ok'); });
});
on('eq-room-edit', d => { const r = S.gym.rooms.find(r => r.id === d.id); if (!r) return; modal(html`<h2>Edit room</h2><div class="mr"><label>Name</label><input id="m1" type="text" value="${r.name}"></div><div class="mbs"><button class="mc2" ${act('modal-close')}>Cancel</button><button class="mo" ${act('eq-room-edit-do', { id: r.id })}>Save</button></div>`); });
on('eq-room-edit-do', async d => { const r = S.gym.rooms.find(r => r.id === d.id); if (!r) return; r.name = val('m1') || r.name; closeModal(); await persist(S.gym, () => { renderGymEq(); toast('Room updated', 'ok'); }); });
on('eq-room-del', async d => {
  const r = S.gym.rooms.find(r => r.id === d.id); if (!r) return;
  const n = r.machines.length;
  const ok = await confirmDialog(`Delete room “${r.name}”?`, n ? `Its ${n} machine${n === 1 ? '' : 's'} will be removed from the app too. Logged history is kept.` : '', { ok: 'Delete', danger: true });
  if (!ok) return;
  S.gym.rooms = S.gym.rooms.filter(x => x.id !== d.id);
  await persist(S.gym, () => { renderGymEq(); toast('Room deleted', 'ok'); });
});

// ---- machines ----
function machineModal(title, m, okAct) {
  return html`<h2>${title}</h2>
    <div class="mr"><label>Name</label><input id="m1" type="text" value="${m.name || ''}" placeholder="e.g. Chest press"></div>
    <div class="mr"><label>Muscles worked</label><input id="m2" type="text" value="${m.musclesWorked || ''}" placeholder="e.g. Chest, shoulders, triceps"></div>
    <div class="mr"><label>Log type</label><select id="m3">${typeOptions(m.logType || 'weight')}</select></div>
    <div class="mr"><label>Photo</label><div class="pa" id="mpa" ${act('photo-pick')}>${m.image ? html`<img data-img="${S.gym.id}|${m.image}" alt="">` : html`<span style="font-size:36px">📷</span>`}<span class="ph">${m.image ? 'Tap to replace' : 'Tap to take or choose a photo'}</span></div></div>
    <div class="mbs"><button class="mc2" ${act('modal-close')}>Cancel</button>${m.id ? html`<button class="md2" ${act('eq-m-del', { id: m.id })}>Delete</button>` : ''}<button class="mo" ${act(okAct, { id: m.id })}>${m.id ? 'Save' : 'Add'}</button></div>`;
}
on('eq-m-add', () => { S.pendingPhoto = null; modal(machineModal('Add machine', {}, 'eq-m-add-do')); });
on('eq-m-add-do', async () => {
  const name = val('m1'); if (!name) { toast('Enter a name', 'err'); return; }
  if (!hasCfg()) { toast('Set up GitHub first', 'err'); return; }
  const m = newMachine({ name, musclesWorked: val('m2'), logType: val('m3') });
  if (S.gym._readonly) m._local = true;
  closeModal(); showLoading('Saving machine…');
  try {
    if (S.pendingPhoto) { m.image = `${m.id}.jpg`; await uploadImage(S.gym, m.image, S.pendingPhoto); }
    S.room.machines.push(m);
    await saveGym(S.gym);
    renderRoomEq(); toast(`${name} added`, 'ok');
  } catch (e) { toast(`Save failed: ${e.message}`, 'err'); }
  finally { hideLoading(); S.pendingPhoto = null; }
});
on('eq-m-edit', d => { const m = S.room.machines.find(m => m.id === d.id); if (!m) return; S.pendingPhoto = null; modal(machineModal('Edit machine', m, 'eq-m-edit-do')); hydrateImages($('mdbody')); });
on('eq-m-edit-do', async d => {
  const m = S.room.machines.find(m => m.id === d.id); if (!m) return;
  m.name = val('m1') || m.name; m.musclesWorked = val('m2'); m.logType = val('m3') || m.logType;
  closeModal(); showLoading('Saving…');
  try {
    if (S.pendingPhoto) { const fn = m.image || `${m.id}.jpg`; await uploadImage(S.gym, fn, S.pendingPhoto); m.image = fn; }
    await saveGym(S.gym);
    renderRoomEq(); toast('Machine updated', 'ok');
  } catch (e) { toast(`Save failed: ${e.message}`, 'err'); }
  finally { hideLoading(); S.pendingPhoto = null; }
});
on('eq-m-del', async d => {
  const m = S.room.machines.find(m => m.id === d.id); if (!m) return;
  closeModal();
  const n = S.log.filter(e => e.machineId === m.id && (!e.gymId || e.gymId === S.gym.id)).length;
  if (n > 0) {
    const ok = await confirmDialog(`Hide ${m.name}?`, `It has ${n} logged set${n === 1 ? '' : 's'}, so it will be hidden instead of deleted. Your history is kept and you can unhide it later.`, { ok: 'Hide' });
    if (!ok) return;
    m.hidden = true;
  } else {
    const ok = await confirmDialog(`Delete ${m.name}?`, '', { ok: 'Delete', danger: true });
    if (!ok) return;
    S.room.machines = S.room.machines.filter(x => x.id !== m.id);
  }
  await persist(S.gym, () => { renderRoomEq(); toast(m.hidden ? 'Machine hidden' : 'Machine deleted', 'ok'); });
});
on('eq-m-hide', async d => { const m = S.room.machines.find(m => m.id === d.id); if (!m) return; m.hidden = true; await persist(S.gym, () => { renderRoomEq(); toast('Hidden', 'ok'); }); });
on('eq-m-unhide', async d => { const m = S.room.machines.find(m => m.id === d.id); if (!m) return; delete m.hidden; await persist(S.gym, () => { renderRoomEq(); toast('Restored', 'ok'); }); });

// ---- photos ----
on('photo-pick', () => $('photoin').click());
$('photoin').addEventListener('change', e => {
  const file = e.target.files[0]; if (!file) return;
  const reader = new FileReader();
  reader.onload = ev => {
    const img = new Image();
    img.onload = () => {
      const c = document.createElement('canvas');
      const max = 1000; let w = img.width, h = img.height;
      if (w > h && w > max) { h = Math.round(h * max / w); w = max; } else if (h > max) { w = Math.round(w * max / h); h = max; }
      c.width = w; c.height = h; c.getContext('2d').drawImage(img, 0, 0, w, h);
      let q = .82, data = c.toDataURL('image/jpeg', q);
      while (data.length > 150 * 1024 * 1.37 && q > .4) { q -= .1; data = c.toDataURL('image/jpeg', q); }
      S.pendingPhoto = data.split(',')[1];
      const pa = $('mpa');
      if (pa) pa.innerHTML = `<img src="${data}" alt=""><span class="ph">Photo ready ✓</span>`;
    };
    img.src = ev.target.result;
  };
  reader.readAsDataURL(file); e.target.value = '';
});

// ---- catalog ----
on('catalog-open', async () => {
  if (!hasCfg()) { toast('Set up GitHub first', 'err'); return; }
  showLoading('Loading catalog…');
  let idx;
  try { idx = await loadCatalog(); } catch (e) { hideLoading(); toast(e.message, 'err'); return; }
  hideLoading();
  const rows = (idx.gyms || []).map(c => {
    const have = S.gyms.find(g => g.id === c.id);
    const sub = [c.location, `${c.machines} machine${c.machines === 1 ? '' : 's'}`].filter(Boolean).join(' · ');
    return html`<div class="sl catalog-row" style="cursor:default"><span style="font-size:22px">${c.icon || '🏋️'}</span><span><b>${c.name}</b>${have ? html` <span class="pill">installed</span>` : ''}<br><small>${sub}</small></span><button class="btn inline ${have ? 'ghost' : ''}" ${act('catalog-import', { id: c.id, replace: have ? '1' : '' })}>${have ? 'Replace' : 'Import'}</button></div>`;
  });
  modal(html`<h2>Gym catalog</h2><p class="mdp">Copies a gym (with photos) into your repo from ${CATALOG.owner}/${CATALOG.repo}. Edit it freely afterwards; the catalog is never changed.</p><div class="mlist">${rows.length ? rows : html`<p class="hint">Catalog is empty.</p>`}</div><div class="mbs"><button class="mc2" ${act('modal-close')}>Close</button></div>`);
});
on('catalog-import', async d => {
  const c = ((S.catalog && S.catalog.gyms) || []).find(c => c.id === d.id); if (!c) return;
  if (d.replace) {
    closeModal();
    const ok = await confirmDialog(`Replace ${c.name}?`, 'Any rooms, machines or photos you added or changed in it will be lost. Workout history is kept.', { ok: 'Replace', danger: true });
    if (!ok) return;
  } else closeModal();
  showLoading(`Importing ${c.name}…`);
  try { await importCatalogGym(d.id, m => { $('ldmsg').textContent = m; }); toast(`${c.name} imported`, 'ok'); renderEquip(); renderHome(); }
  catch (e) { toast(`Import failed: ${e.message}`, 'err'); console.error(e); }
  finally { hideLoading(); }
});
