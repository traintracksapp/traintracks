import { test } from 'node:test';
import assert from 'node:assert/strict';
import { slug, applyGenericOverrides, genericOverridesFrom, serialiseGym, findMachine, gymMachineCount, newGym, gymPathFor, variationsOf } from '../lib/gyms.js';

const generic = { id: 'generic', name: 'Common', is_generic: true, rooms: [
  { id: 'bw', name: 'Bodyweight', machines: [{ id: 'push-ups', name: 'Push Ups', log_type: 'reps' }, { id: 'squats', name: 'Squats', log_type: 'reps' }] },
  { id: 'out', name: 'Outdoor', machines: [{ id: 'walk', name: 'Walk', log_type: 'walk' }] }
] };

test('slug', () => {
  assert.equal(slug('Équinox 67th — NYC!'), 'equinox-67th-nyc');
  assert.equal(slug(''), '');
});

test('generic overrides merge: hidden, added machines, added rooms', () => {
  const g = applyGenericOverrides(generic, { hidden: ['squats'], machines: [{ room_id: 'out', id: 'm1', name: 'Jog', log_type: 'walk' }, { room_id: 'new-room', id: 'm2', name: 'X' }], rooms: [{ id: 'new-room', name: 'Mine' }] });
  assert.equal(g._readonly, true);
  assert.equal(g.rooms[0].machines.find(m => m.id === 'squats').hidden, true);
  assert.equal(g.rooms[1].machines.at(-1).name, 'Jog');
  assert.equal(g.rooms[2].id, 'new-room');
  assert.equal(g.rooms[2].machines[0].id, 'm2');
  assert.equal(generic.rooms[0].machines[1].hidden, undefined, 'the template copy is not modified');
});

test('generic overrides survive a round trip (what the updater relies on)', () => {
  const ov = { hidden: ['squats'], machines: [{ room_id: 'out', id: 'm1', name: 'Jog', log_type: 'walk', image: null, muscles_worked: '' }], rooms: [] };
  assert.deepEqual(genericOverridesFrom(applyGenericOverrides(generic, ov)), ov);
});

test('serialiseGym drops runtime fields, keeps hidden and unknown fields (e.g. variations)', () => {
  const g = { id: 'eg', name: 'Example', _path: 'x', rooms: [{ id: 'r', name: 'R', _local: true, machines: [
    { id: 'a', name: 'A', hidden: true, _local: true, variations: { grip: ['wide'] } }, { id: 'b', name: 'B', hidden: false }] }] };
  const s = serialiseGym(g);
  assert.equal(s._path, undefined);
  assert.equal(s.rooms[0]._local, undefined);
  assert.deepEqual(s.rooms[0].machines[0], { id: 'a', name: 'A', hidden: true, variations: { grip: ['wide'] } });
  assert.deepEqual(s.rooms[0].machines[1], { id: 'b', name: 'B' });
});

test('findMachine, gymMachineCount (hidden not counted)', () => {
  const g = applyGenericOverrides(generic, { hidden: ['squats'] });
  assert.equal(findMachine([g], 'walk').room.id, 'out');
  assert.equal(findMachine([g], 'walk', 'other'), null);
  assert.equal(gymMachineCount(g), 2);
});

test('newGym avoids taken ids; gymPathFor', () => {
  assert.equal(newGym('Home Gym', null, ['home-gym']).id, 'home-gym-2');
  assert.equal(gymPathFor('generic'), 'equipment/generic');
  assert.equal(gymPathFor('home-gym'), 'equipment/my-gyms/home-gym');
});

test('variationsOf', () => {
  assert.deepEqual(variationsOf({ variations: { grip: ['wide'] } }), { grip: ['wide'] });
  assert.deepEqual(variationsOf({}), {});
  assert.deepEqual(variationsOf(null), {});
});

import { variationsText, parseVariationsText } from '../lib/gyms.js';

test('variations text round trip', () => {
  const v = { grip: ['narrow', 'standard', 'wide'], angle: ['flat', 'incline'] };
  assert.equal(variationsText({ variations: v }), 'grip: narrow, standard, wide\nangle: flat, incline');
  assert.deepEqual(parseVariationsText(variationsText({ variations: v })), { variations: v, error: null });
});

test('parseVariationsText: tidy, empty and errors', () => {
  assert.deepEqual(parseVariationsText(' Grip :  Wide ,Narrow \n\n').variations, { grip: ['wide', 'narrow'] });
  assert.deepEqual(parseVariationsText(''), { variations: null, error: null });
  assert.match(parseVariationsText('just words').error, /group: tag/);
  assert.match(parseVariationsText('grip:').error, /no tags/);
  assert.match(parseVariationsText('a: wide\nb: wide').error, /only one group/);
});
