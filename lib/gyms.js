/**
 * Gyms, rooms and machines (format version 2: snake_case). Pure helpers.
 *
 * gym.json: { id, name, icon, is_generic, subtitle?, location?, version?, source?, removed?,
 *   rooms: [ { id, name, machines: [ { id, name, muscles_worked, image, log_type, hidden?,
 *                                      variations?, variations_default? } ] } ] }
 *
 * The generic gym ships with the template and is read-only. A user's changes
 * to it live in equipment/generic.local.json:
 *   { hidden: [machine_id], machines: [ { room_id, ...machine } ], rooms: [ { id, name } ] }
 * and are merged on load, so template updates never wipe them.
 *
 * Runtime-only fields start with "_" and are never written.
 */
export const GENERIC_ID = 'generic';

export function slug(s) {
  return String(s || '').toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 48);
}

export const emptyOverrides = () => ({ hidden: [], machines: [], rooms: [] });

/** Merge generic.local.json onto the template's generic gym. Returns a new object. */
export function applyGenericOverrides(generic, local) {
  const ov = { ...emptyOverrides(), ...(local || {}) };
  const g = structuredClone(generic);
  g._readonly = true;
  for (const r of ov.rooms || []) if (!g.rooms.find(x => x.id === r.id)) g.rooms.push({ id: r.id, name: r.name, machines: [], _local: true });
  for (const m of ov.machines || []) {
    const room = g.rooms.find(r => r.id === m.room_id) || g.rooms[g.rooms.length - 1];
    if (!room) continue;
    const { room_id, ...machine } = m;
    const i = room.machines.findIndex(x => x.id === machine.id);
    if (i >= 0) room.machines[i] = { ...room.machines[i], ...machine, _local: true };
    else room.machines.push({ ...machine, _local: true });
  }
  const hidden = new Set(ov.hidden || []);
  for (const r of g.rooms) for (const m of r.machines) if (hidden.has(m.id)) m.hidden = true;
  return g;
}

/** The overrides to write after the user changed the generic gym in the app. */
export function genericOverridesFrom(gym) {
  const ov = emptyOverrides();
  for (const room of gym.rooms || []) {
    if (room._local) ov.rooms.push({ id: room.id, name: room.name });
    for (const m of room.machines || []) {
      if (m.hidden) ov.hidden.push(m.id);
      if (m._local) {
        const { hidden, ...rest } = stripRuntime(m);
        ov.machines.push({ room_id: room.id, ...rest });
      }
    }
  }
  return ov;
}

function stripRuntime(o) {
  return Object.fromEntries(Object.entries(o).filter(([k]) => !k.startsWith('_')));
}

/** The JSON written to gym.json: drops runtime fields, keeps everything else (incl. unknown fields). */
export function serialiseGym(gym) {
  const g = stripRuntime(gym);
  g.rooms = (gym.rooms || []).map(r => ({
    ...stripRuntime(r),
    machines: (r.machines || []).map(m => {
      const o = stripRuntime(m);
      if (!o.hidden) delete o.hidden;
      return o;
    })
  }));
  return g;
}

/** Walk every machine: cb(gym, room, machine). */
export function eachMachine(gyms, cb) {
  for (const g of gyms || []) for (const r of g.rooms || []) for (const m of r.machines || []) cb(g, r, m);
}

export function findMachine(gyms, machineId, gymId) {
  let hit = null;
  eachMachine(gyms, (g, r, m) => {
    if (!hit && m.id === machineId && (!gymId || g.id === gymId)) hit = { gym: g, room: r, machine: m };
  });
  return hit;
}

export const visibleCount = room => (room.machines || []).filter(m => !m.hidden).length;
export const gymMachineCount = gym => (gym.rooms || []).reduce((s, r) => s + visibleCount(r), 0);

export function newGym(name, icon, taken = []) {
  let id = slug(name) || 'gym';
  while (taken.includes(id)) id += '-2';
  return { id, name, icon: icon || '🏋️', is_generic: false, rooms: [{ id: 'main', name, machines: [] }] };
}
export const newRoom = name => ({ id: `${slug(name) || 'room'}-${Date.now().toString(36)}`, name, machines: [] });
export const newMachine = f => ({ id: `m${Date.now()}`, name: f.name, muscles_worked: f.muscles_worked || '', image: f.image || null, log_type: f.log_type || 'weight' });

export const gymPathFor = id => (id === GENERIC_ID ? 'equipment/generic' : `equipment/my-gyms/${id}`);

/** The variation groups a machine offers ({ group: [tags] }), or {}. */
export const variationsOf = m => (m && m.variations && typeof m.variations === 'object' ? m.variations : {});

/** Variations as editable text: one group per line, "grip: narrow, wide". */
export function variationsText(m) {
  return Object.entries(variationsOf(m)).map(([g, tags]) => `${g}: ${tags.join(', ')}`).join('\n');
}

/**
 * Parse the variations text back. Returns { variations, error }. Tags are
 * lowercase; a tag may appear in only one group (spec §4.9).
 */
export function parseVariationsText(text) {
  const out = {}, seen = new Set();
  for (const raw of String(text || '').split('\n')) {
    const line = raw.trim();
    if (!line) continue;
    const i = line.indexOf(':');
    if (i <= 0) return { variations: null, error: `"${line}": use "group: tag, tag"` };
    const group = line.slice(0, i).trim().toLowerCase();
    const tags = line.slice(i + 1).split(',').map(t => t.trim().toLowerCase().replace(/\s+/g, ' ')).filter(Boolean);
    if (!tags.length) return { variations: null, error: `"${group}" has no tags` };
    for (const t of tags) {
      if (t.includes(';')) return { variations: null, error: `"${t}": a tag can't contain ";"` };
      if (seen.has(t)) return { variations: null, error: `"${t}" appears twice; a tag can be in only one group` };
      seen.add(t);
    }
    out[group] = tags;
  }
  return { variations: Object.keys(out).length ? out : null, error: null };
}
