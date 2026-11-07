/** Manage equipment: gyms, rooms, machines (with photos and variations), and the gym catalog. */
import { S, hasCfg, genericGym, myGyms } from '../state.js';
import { html, act, setHTML, setText, on, toast, $, modal, closeModal, val, confirmDialog, showLoading, hideLoading } from './dom.js';
import { screen, nav } from './nav.js';
import { saveGym, uploadImage, loadCatalog, importCatalogGym } from '../data.js';
import { newGym, newRoom, newMachine, variationsText, parseVariationsText, GENERIC_ID } from '../../lib/gyms.js';
import { LOG_TYPES, CATALOG } from '../../lib/config.js';
import { renderHome } from './home.js';
import { hydrateImages } from './gyms.js';

let pendingPhoto = null; // base64 JPEG waiting to be saved with the machine

const typeOptions = sel => Object.entries(LOG_TYPES).map(([k, v]) => html`<option value="${k}" ${sel === k ? 'selected' : ''}>${v.label}</option>`);

function renderEquip() {
  const mine = myGyms(), gen = genericGym();
  setHTML('eqbody', html`<div class="sh first">My gyms</div>
    ${mine.length ? html`<div class="card">${mine.map(g => html`<div class="row" ${act('eq-gym', { id: g.id })}><div class="ic">${g.icon || '🏋️'}</div><div class="tx"><h2>${g.name}</h2>${g.source ? html`<p>from the catalog · ${g.source}</p>` : ''}</div><button class="ib" ${act('eq-gym-edit', { id: g.id })} aria-label="Edit">✏️</button><button class="ib danger" ${act('eq-gym-del', { id: g.id })} aria-label="Remove">🗑️</button><span class="ch">›</span></div>`)}</div>` : html`<div class="empty" style="padding:20px"><p>No gyms added yet.</p></div>`}
    <button class="btn dashed" ${act('eq-gym-add')}>＋ Add gym</button>
    <button class="btn dashed" style="background:none;border-style:solid" ${act('catalog-open')}>📚 Import from the gym catalog</button>
    <div class="sh">Common exercises</div>
    ${gen ? html`<div class="card"><div class="row" ${act('eq-gym', { id: gen.id })}><div class="ic">${gen.icon || '🏃'}</div><div class="tx"><h2>${gen.name}<span class="pill ro">template</span></h2><p>Updated with the app. You can hide exercises and add your own.</p></div><span class="ch">›</span></div></div>` : html`<div class="empty" style="padding:20px"><p>The common gym isn't loaded.</p></div>`}`);
}

function renderGymEq() {
  const g = S.gym;
  if (!g) return;
  setText('gymeq-title', g.name);
  setHTML('gymeqbody', html`<div class="sh first">Rooms</div><div class="card">${g.rooms.map(r => html`<div class="row" ${act('eq-room', { id: r.id })}><div class="tx"><h2>${r.name}</h2></div><span class="meta">${r.machines.filter(m => !m.hidden).length} machines</span>${g._readonly && !r._local ? '' : html`<button class="ib" ${act('eq-room-edit', { id: r.id })} aria-label="Edit">✏️</button><button class="ib danger" ${act('eq-room-del', { id: r.id })} aria-label="Delete">🗑️</button>`}<span class="ch">›</span></div>`)}</div>
    <button class="btn dashed" ${act('eq-room-add')}>＋ Add room</button>`);
}

function renderRoomEq() {
  const r = S.room, g = S.gym;
  if (!r || !g) return;
  setText('roomeq-title', r.name);
  const ro = m => g._readonly && !m._local;
  const vsum = m => Object.keys(m.variations || {}).length ? ` · variations: ${Object.keys(m.variations).join(', ')}` : '';
  setHTML('roomeqbody', html`<div class="sh first">Machines</div><div class="card">${r.machines.length ? r.machines.map(m => (m.hidden
    ? html`<div class="row static dimmed"><div class="tx"><h2>${m.name} <span class="pill">hidden</span></h2></div><button class="ib" ${act('eq-m-unhide', { id: m.id })} aria-label="Unhide" title="Unhide">👁️</button></div>`
    : html`<div class="row static"><div class="tx"><h2>${m.name}</h2><p>${LOG_TYPES[m.log_type] ? LOG_TYPES[m.log_type].label : m.log_type}${m.muscles_worked ? ` · ${m.muscles_worked}` : ''}${vsum(m)}</p></div>${ro(m) ? html`<button class="ib" ${act('eq-m-hide', { id: m.id })} aria-label="Hide" title="Hide">🙈</button>` : html`<button class="ib" ${act('eq-m-edit', { id: m.id })} aria-label="Edit">✏️</button><button class="ib danger" ${act('eq-m-del', { id: m.id })} aria-label="Delete">🗑️</button>`}</div>`)) : html`<div class="empty" style="padding:20px"><p>No machines yet.</p></div>`}</div>
    <button class="btn dashed" ${act('eq-m-add')}>＋ Add machine</button>
    ${g._readonly ? html`<p class="hint">Template exercises can be hidden but not edited. Anything you add here is yours and survives app updates.</p>` : ''}`);
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
on('eq-gym', d => { const g = S.gyms.find(x => x.id === d.id); if (g) { S.gym = g; nav('gymeq'); } });
on('eq-gym-add', () => modal(html`<h2>Add gym</h2><div class="mr"><label for="m1">Gym name</label><input id="m1" type="text" placeholder="e.g. Home gym"></div><div class="mr"><label for="m2">Icon (emoji)</label><input id="m2" type="text" value="🏋️" maxlength="4"></div><div class="mbs"><button class="mc2" ${act('modal-close')}>Cancel</button><button class="mo" ${act('eq-gym-add-do')}>Add</button></div>`));
on('eq-gym-add-do', async () => {
  const name = val('m1');
  if (!name) { toast('Enter a name', 'err'); return; }
  if (!hasCfg()) { toast('Set up GitHub first', 'err'); return; }
  const g = newGym(name, val('m2'), S.gyms.map(x => x.id).concat(GENERIC_ID));
  g._path = `equipment/my-gyms/${g.id}`;
  closeModal();
  S.gyms.push(g);
  await persist(g, () => { renderEquip(); renderHome(); toast(`${name} added`, 'ok'); });
});
on('eq-gym-edit', d => {
  const g = S.gyms.find(x => x.id === d.id);
  if (!g) return;
  modal(html`<h2>Edit gym</h2><div class="mr"><label for="m1">Name</label><input id="m1" type="text" value="${g.name}"></div><div class="mr"><label for="m2">Icon</label><input id="m2" type="text" value="${g.icon || '🏋️'}" maxlength="4"></div><div class="mr"><label for="m3">Location (optional)</label><input id="m3" type="text" value="${g.location || ''}"></div><div class="mbs"><button class="mc2" ${act('modal-close')}>Cancel</button><button class="mo" ${act('eq-gym-edit-do', { id: g.id })}>Save</button></div>`);
});
on('eq-gym-edit-do', async d => {
  const g = S.gyms.find(x => x.id === d.id);
  if (!g) return;
  g.name = val('m1') || g.name; g.icon = val('m2') || g.icon;
  if (val('m3')) g.location = val('m3'); else delete g.location;
  closeModal();
  await persist(g, () => { renderEquip(); renderHome(); toast('Gym updated', 'ok'); });
});
on('eq-gym-del', async d => {
  const g = S.gyms.find(x => x.id === d.id);
  if (!g) return;
  if (!await confirmDialog(`Remove ${g.name}?`, 'It disappears from the app. Its files stay in your repo and your workout history is kept, so you can bring it back later.', { ok: 'Remove', danger: true })) return;
  g.removed = true; // the Contents API can't move a folder, so the gym is flagged and skipped on load
  await persist(g, () => { S.gyms = S.gyms.filter(x => x.id !== d.id); renderEquip(); renderHome(); toast(`${g.name} removed from the app`, 'ok'); });
});

// ---- rooms ----
on('eq-room', d => { const r = S.gym.rooms.find(x => x.id === d.id); if (r) { S.room = r; nav('roomeq'); } });
on('eq-room-add', () => modal(html`<h2>Add room</h2><div class="mr"><label for="m1">Room name</label><input id="m1" type="text" placeholder="e.g. Machine room"></div><div class="mbs"><button class="mc2" ${act('modal-close')}>Cancel</button><button class="mo" ${act('eq-room-add-do')}>Add</button></div>`));
on('eq-room-add-do', async () => {
  const name = val('m1');
  if (!name) { toast('Enter a name', 'err'); return; }
  const r = newRoom(name);
  if (S.gym._readonly) r._local = true;
  S.gym.rooms.push(r);
  closeModal();
  await persist(S.gym, () => { renderGymEq(); toast(`${name} added`, 'ok'); });
});
on('eq-room-edit', d => {
  const r = S.gym.rooms.find(x => x.id === d.id);
  if (r) modal(html`<h2>Edit room</h2><div class="mr"><label for="m1">Name</label><input id="m1" type="text" value="${r.name}"></div><div class="mbs"><button class="mc2" ${act('modal-close')}>Cancel</button><button class="mo" ${act('eq-room-edit-do', { id: r.id })}>Save</button></div>`);
});
on('eq-room-edit-do', async d => {
  const r = S.gym.rooms.find(x => x.id === d.id);
  if (!r) return;
  r.name = val('m1') || r.name;
  closeModal();
  await persist(S.gym, () => { renderGymEq(); toast('Room updated', 'ok'); });
});
on('eq-room-del', async d => {
  const r = S.gym.rooms.find(x => x.id === d.id);
  if (!r) return;
  const n = r.machines.length;
  if (!await confirmDialog(`Delete room “${r.name}”?`, n ? `Its ${n} machine${n === 1 ? '' : 's'} will be removed from the app too. Logged history is kept.` : '', { ok: 'Delete', danger: true })) return;
  S.gym.rooms = S.gym.rooms.filter(x => x.id !== d.id);
  await persist(S.gym, () => { renderGymEq(); toast('Room deleted', 'ok'); });
});

// ---- machines ----
function machineModal(title, m, okAct) {
  return html`<h2>${title}</h2>
    <div class="mr"><label for="m1">Name</label><input id="m1" type="text" value="${m.name || ''}" placeholder="e.g. Chest press"></div>
    <div class="mr"><label for="m2">Muscles worked</label><input id="m2" type="text" value="${m.muscles_worked || ''}" placeholder="e.g. Chest, shoulders, triceps"></div>
    <div class="mr"><label for="m3">What you record</label><select id="m3">${typeOptions(m.log_type || 'weight')}</select></div>
    <div class="mr"><label for="m4">Variations (optional)</label><textarea id="m4" class="fi" rows="2" placeholder="grip: narrow, wide&#10;angle: flat, incline">${variationsText(m)}</textarea></div>
    <div class="mr"><label>Photo</label><div class="pa" id="mpa" ${act('photo-pick')}>${m.image ? html`<img data-img="${S.gym.id}|${m.image}" alt="">` : html`<span style="font-size:36px">📷</span>`}<span class="ph">${m.image ? 'Tap to replace' : 'Tap to take or choose a photo'}</span></div></div>
    <div class="mbs"><button class="mc2" ${act('modal-close')}>Cancel</button>${m.id ? html`<button class="md2" ${act('eq-m-del', { id: m.id })}>Delete</button>` : ''}<button class="mo" ${act(okAct, { id: m.id })}>${m.id ? 'Save' : 'Add'}</button></div>`;
}

/** Read the machine form; null (with a message) if something is wrong. */
function readMachineForm() {
  const name = val('m1');
  if (!name) { toast('Enter a name', 'err'); return null; }
  const v = parseVariationsText(($('m4') || {}).value);
  if (v.error) { toast(`Variations: ${v.error}`, 'err'); return null; }
  return { name, muscles_worked: val('m2'), log_type: val('m3') || 'weight', variations: v.variations };
}

on('eq-m-add', () => { pendingPhoto = null; modal(machineModal('Add machine', {}, 'eq-m-add-do')); });
on('eq-m-add-do', async () => {
  if (!hasCfg()) { toast('Set up GitHub first', 'err'); return; }
  const f = readMachineForm();
  if (!f) return;
  const m = newMachine(f);
  if (f.variations) m.variations = f.variations;
  if (S.gym._readonly) m._local = true;
  closeModal();
  showLoading('Saving machine…');
  try {
    if (pendingPhoto) { m.image = `${m.id}.jpg`; await uploadImage(S.gym, m.image, pendingPhoto); }
    S.room.machines.push(m);
    await saveGym(S.gym);
    renderRoomEq();
    toast(`${f.name} added`, 'ok');
  } catch (e) { toast(`Save failed: ${e.message}`, 'err'); }
  finally { hideLoading(); pendingPhoto = null; }
});
on('eq-m-edit', d => {
  const m = S.room.machines.find(x => x.id === d.id);
  if (!m) return;
  pendingPhoto = null;
  modal(machineModal('Edit machine', m, 'eq-m-edit-do'));
  hydrateImages($('mdbody'));
});
on('eq-m-edit-do', async d => {
  const m = S.room.machines.find(x => x.id === d.id);
  if (!m) return;
  const f = readMachineForm();
  if (!f) return;
  m.name = f.name; m.muscles_worked = f.muscles_worked; m.log_type = f.log_type;
  if (f.variations) m.variations = f.variations; else delete m.variations;
  closeModal();
  showLoading('Saving…');
  try {
    if (pendingPhoto) { const file = m.image || `${m.id}.jpg`; await uploadImage(S.gym, file, pendingPhoto); m.image = file; }
    await saveGym(S.gym);
    renderRoomEq();
    toast('Machine updated', 'ok');
  } catch (e) { toast(`Save failed: ${e.message}`, 'err'); }
  finally { hideLoading(); pendingPhoto = null; }
});
on('eq-m-del', async d => {
  const m = S.room.machines.find(x => x.id === d.id);
  if (!m) return;
  closeModal();
  const n = S.log.filter(e => e.machine_id === m.id && (!e.gym_id || e.gym_id === S.gym.id)).length;
  if (n > 0) {
    if (!await confirmDialog(`Hide ${m.name}?`, `It has ${n} logged set${n === 1 ? '' : 's'}, so it is hidden instead of deleted. Your history is kept and you can unhide it later.`, { ok: 'Hide' })) return;
    m.hidden = true;
  } else {
    if (!await confirmDialog(`Delete ${m.name}?`, '', { ok: 'Delete', danger: true })) return;
    S.room.machines = S.room.machines.filter(x => x.id !== m.id);
  }
  await persist(S.gym, () => { renderRoomEq(); toast(m.hidden ? 'Machine hidden' : 'Machine deleted', 'ok'); });
});
on('eq-m-hide', async d => { const m = S.room.machines.find(x => x.id === d.id); if (!m) return; m.hidden = true; await persist(S.gym, () => { renderRoomEq(); toast('Hidden', 'ok'); }); });
on('eq-m-unhide', async d => { const m = S.room.machines.find(x => x.id === d.id); if (!m) return; delete m.hidden; await persist(S.gym, () => { renderRoomEq(); toast('Restored', 'ok'); }); });

// ---- photos: resized to at most 1200 px and about 150 KB, as JPEG ----
on('photo-pick', () => $('photoin').click());
$('photoin').addEventListener('change', e => {
  const file = e.target.files[0];
  e.target.value = '';
  if (!file) return;
  const url = URL.createObjectURL(file);
  const img = new Image();
  img.addEventListener('load', () => {
    const max = 1200;
    let w = img.naturalWidth, h = img.naturalHeight;
    if (w > h && w > max) { h = Math.round(h * max / w); w = max; } else if (h > max) { w = Math.round(w * max / h); h = max; }
    const c = document.createElement('canvas');
    c.width = w; c.height = h;
    c.getContext('2d').drawImage(img, 0, 0, w, h);
    URL.revokeObjectURL(url);
    let q = 0.82, data = c.toDataURL('image/jpeg', q);
    while (data.length > 150 * 1024 * 1.37 && q > 0.4) { q -= 0.1; data = c.toDataURL('image/jpeg', q); }
    pendingPhoto = data.split(',')[1];
    const pa = $('mpa');
    if (pa) {
      pa.textContent = '';
      const im = document.createElement('img'); im.src = data; im.alt = '';
      const sp = document.createElement('span'); sp.className = 'ph'; sp.textContent = 'Photo ready ✓';
      pa.append(im, sp);
    }
  }, { once: true });
  img.addEventListener('error', () => { URL.revokeObjectURL(url); toast('That file is not an image this browser can read', 'err'); }, { once: true });
  img.src = url;
});

// ---- catalog ----
on('catalog-open', async () => {
  if (!hasCfg()) { toast('Set up GitHub first', 'err'); return; }
  showLoading('Loading the catalog…');
  let idx;
  try { idx = await loadCatalog(); } catch (e) { toast(e.message, 'err'); return; } finally { hideLoading(); }
  const rows = (Array.isArray(idx.gyms) ? idx.gyms : []).filter(c => c && c.id && c.id !== GENERIC_ID).map(c => {
    const have = S.gyms.find(g => g.id === c.id);
    const sub = [c.location, `${Number(c.machines) || 0} machines`].filter(Boolean).join(' · ');
    return html`<div class="sl catalog-row" style="cursor:default"><span style="font-size:22px">${c.icon || '🏋️'}</span><span><b>${c.name}</b>${have ? html` <span class="pill">installed</span>` : ''}<br><small>${sub}</small></span><button class="btn inline ${have ? 'ghost' : ''}" ${act('catalog-import', { id: c.id, replace: have ? '1' : '' })}>${have ? 'Replace' : 'Import'}</button></div>`;
  });
  modal(html`<h2>Gym catalog</h2><p class="mdp">Copies a gym, with photos, into your repo from ${CATALOG.owner}/${CATALOG.repo}. Change it freely afterwards; the catalog itself is never changed.</p><div class="mlist">${rows.length ? rows : html`<p class="hint">The catalog is empty.</p>`}</div><div class="mbs"><button class="mc2" ${act('modal-close')}>Close</button></div>`);
});
on('catalog-import', async d => {
  const c = ((S.catalog && S.catalog.gyms) || []).find(x => x.id === d.id);
  if (!c) return;
  closeModal();
  if (d.replace && !await confirmDialog(`Replace ${c.name}?`, 'Rooms, machines or photos you added or changed in it will be lost. Workout history is kept.', { ok: 'Replace', danger: true })) return;
  showLoading(`Importing ${c.name}…`);
  try { await importCatalogGym(d.id, m => { $('ldmsg').textContent = m; }); toast(`${c.name} imported`, 'ok'); renderEquip(); renderHome(); }
  catch (e) { console.error(e); toast(`Import failed: ${e.message}`, 'err'); }
  finally { hideLoading(); }
});
