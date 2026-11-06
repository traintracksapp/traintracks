/**
 * Gyms, rooms, machines. Pure helpers.
 *
 * gym.json: { id, name, icon, isGeneric, subtitle, location, version, source,
 *             rooms: [ { id, name, machines: [ { id, name, musclesWorked, image, logType, hidden } ] } ] }
 *
 * The generic gym ships with the template and is READ-ONLY in the app. A
 * user's changes to it live in equipment/generic.local.json:
 *   { hidden: ["machine-id"], machines: [ { roomId, ...machine } ], rooms: [ { id, name } ] }
 * and are merged on load, so template updates never wipe them.
 */
import { slug } from './format.js';

export const GENERIC_ID = 'generic';

export function emptyOverrides() { return { hidden: [], machines: [], rooms: [] }; }

/** Merge generic.local.json onto the template's generic gym (returns a new object). */
export function applyGenericOverrides(generic, local) {
  const ov = { ...emptyOverrides(), ...(local || {}) };
  const g = JSON.parse(JSON.stringify(generic));
  g._readonly = true;
  (ov.rooms || []).forEach(r => { if (!g.rooms.find(x => x.id === r.id)) g.rooms.push({ id: r.id, name: r.name, machines: [], _local: true }); });
  (ov.machines || []).forEach(m => {
    const room = g.rooms.find(r => r.id === m.roomId) || g.rooms[g.rooms.length - 1];
    if (!room) return;
    const { roomId, ...machine } = m;
    const i = room.machines.findIndex(x => x.id === machine.id);
    if (i >= 0) room.machines[i] = { ...room.machines[i], ...machine, _local: true };
    else room.machines.push({ ...machine, _local: true });
  });
  const hidden = new Set(ov.hidden || []);
  g.rooms.forEach(r => r.machines.forEach(m => { if (hidden.has(m.id)) m.hidden = true; }));
  return g;
}

/** Walk every machine: cb(gym, room, machine). */
export function eachMachine(gyms, cb) {
  (gyms || []).forEach(g => (g.rooms || []).forEach(r => (r.machines || []).forEach(m => cb(g, r, m))));
}

export function findMachine(gyms, machineId, gymId) {
  let hit = null;
  eachMachine(gyms, (g, r, m) => {
    if (m.id !== machineId) return;
    if (gymId && g.id !== gymId) return;
    if (!hit) hit = { gym: g, room: r, machine: m };
  });
  return hit;
}

export function visibleCount(room) { return (room.machines || []).filter(m => !m.hidden).length; }

export function gymMachineCount(gym) { return (gym.rooms || []).reduce((s, r) => s + visibleCount(r), 0); }

/** The JSON that is written to gym.json (drops runtime-only _fields). */
export function serialiseGym(gym) {
  const data = { id: gym.id, name: gym.name, icon: gym.icon || '🏋️', isGeneric: !!gym.isGeneric };
  ['subtitle', 'location', 'version', 'source'].forEach(k => { if (gym[k] != null && gym[k] !== '') data[k] = gym[k]; });
  if (gym.removed) data.removed = true; // removed from the app; files and history kept
  data.rooms = (gym.rooms || []).map(r => ({
    id: r.id, name: r.name,
    machines: (r.machines || []).map(m => {
      const o = { id: m.id, name: m.name, musclesWorked: m.musclesWorked || '', image: m.image || null, logType: m.logType || 'weight' };
      if (m.hidden) o.hidden = true;
      return o;
    })
  }));
  return data;
}

export function newGym(name, icon) {
  const id = slug(name) || `gym-${Date.now().toString(36)}`;
  return { id, name, icon: icon || '🏋️', isGeneric: false, rooms: [{ id: 'main', name, machines: [] }] };
}

export function newRoom(name) { return { id: `${slug(name)}-${Date.now().toString(36)}`, name, machines: [] }; }

export function newMachine(fields) {
  return { id: `m${Date.now()}`, name: fields.name, musclesWorked: fields.musclesWorked || '', image: fields.image || null, logType: fields.logType || 'weight' };
}

export function gymPathFor(id) { return id === GENERIC_ID ? 'equipment/generic' : `equipment/my-gyms/${id}`; }

/** Picker options: [{ id, gymId, label }] across visible machines. */
export function machineOptions(gyms) {
  const out = [];
  eachMachine(gyms, (g, r, m) => { if (!m.hidden) out.push({ id: m.id, gymId: g.id, label: `${m.name} (${g.name})` }); });
  return out;
}
