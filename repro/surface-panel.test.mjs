// World › Surface's list without the DOM (sculpt-surface-panel.js): which section a layer is in, from facts read directly.
import test from 'node:test';
import assert from 'node:assert/strict';
import {layerSection, moveLayer} from '../sculpt-surface-panel.js';

// A world as the panel's host reads it: World settings by key (rock: a rock type's setting), roles, surfaces and facts.
const world = ({controls = {}, roles = [], layers = [], facts = {}, materials = true, rocks = 0} = {}) => ({
  material: () => materials,
  control: key => key in controls ? {value: controls[key].value ?? controls[key], label: controls[key].label ?? key, note: controls[key].note ?? '', rock: Boolean(controls[key].rock), rocks} : null,
  role: key => ({present: roles.includes(key), name: 'highland ground'}),
  layer: name => layers.includes(name),
  fact: name => facts[name] ?? 0,
});

test('a built-in whose World setting is 0 cannot draw, says so and names the setting that turns it on', () => {
  const at = layerSection({builtin: 'soil', material: 'green-soil'}, world({controls: {soilRim: {value: 0, label: 'Bare soil where cover thins'}}}));
  assert.equal(at.section, 'idle');
  assert.deepEqual(at.reasons, [{text: 'Bare soil where cover thins is 0.', go: {control: 'soilRim'}}]);
  assert.equal(layerSection({builtin: 'soil', material: 'green-soil'}, world({controls: {soilRim: .4}})).section, 'drawing', 'raised, it draws');
});

test('a rock type’s setting counts for every rock in use, and a world fact can lift a need', () => {
  const crown = value => layerSection({builtin: 'crown'}, world({controls: {rockCrown: {value, label: 'Bare rock to the crown', rock: true}}, rocks: 2}));
  assert.equal(crown(.5).section, 'drawing');
  assert.equal(crown(0).reasons[0].text, 'Bare rock to the crown is 0 for the world’s rock and every rock type in use.');
  const slope = facts => layerSection({builtin: 'slopeCover'}, world({controls: {slopeTexture: 0}, facts})).section;
  assert.equal(slope({}), 'idle', 'its mask is times Sampled slope texture');
  assert.equal(slope({slopeSand: 1}), 'drawing', 'unless the world’s slopes are sand');
});

test('a lone setting brings its own requirement; several reasons do not repeat it', () => {
  const band = layerSection({builtin: 'baseBand', material: 'desert-band'}, world({controls: {baseBand: {value: 0, label: 'Gray band strength', note: 'Add a rock column.'}, strata: {value: .5, rock: true}}}));
  assert.equal(band.reasons[0].text, 'Gray band strength is 0. Add a rock column.');
  const both = layerSection({builtin: 'baseBand', material: 'desert-band'}, world({controls: {baseBand: {value: 0, label: 'Gray band strength', note: 'Add a rock column.'}, strata: {value: 0, label: 'Layer color coverage', rock: true}}}));
  assert.deepEqual(both.reasons.map(r => r.text), ['Gray band strength is 0.', 'Layer color coverage is 0 for the world’s rock.']);
  const highland = layerSection({builtin: 'highland'}, world({controls: {highland: {value: 0, label: 'Highland ground strength', note: 'The map has no highland material.'}}}));
  assert.equal(highland.reasons.length, 2, 'no highland material, and Strength 0');
  assert.match(highland.reasons[0].text, /no highland ground material/);
  assert.equal(highland.reasons[0].go, undefined, 'a role has no setting to go to');
});

test('Surface paint’s layers have their own section; Coverage 0 and a missing material draw nothing anywhere', () => {
  assert.equal(layerSection({builtin: 'paintedSnow', material: 'ice-ground'}, world()).section, 'painted');
  assert.deepEqual(layerSection({builtin: 'paintedSnow', material: 'ice-ground', amount: 0}, world()).reasons, [{text: 'Coverage is 0.'}]);
  assert.equal(layerSection({builtin: 'highland', amount: 0}, world({roles: ['worldHigh'], controls: {highland: 1}})).section, 'drawing', 'Highland ground’s strength is its World setting, not a Coverage');
  assert.equal(layerSection({id: 'moss-1', material: 'lush-ground'}, world({materials: false})).section, 'idle');
  assert.equal(layerSection({builtin: 'sand'}, world()).section, 'idle', 'an engine surface with no material draws nothing');
  assert.equal(layerSection({builtin: 'beach'}, world({layers: ['beach']})).section, 'drawing');
  assert.deepEqual(layerSection({builtin: 'beach'}, world()).reasons[0].go, {id: 'beach-from'}, 'another world’s beach turns it on');
});

test('what the panel cannot read is no claim', () => {
  assert.equal(layerSection({builtin: 'soil', material: 'green-soil'}, world()).section, 'drawing', 'no such setting row: no claim');
  for (const builtin of ['rock', 'chips']) assert.equal(layerSection({builtin}, world()).section, 'drawing');
  assert.equal(layerSection({builtin: 'sand', material: 'green-sand'}, world()).section, 'drawing', 'the sand’s sources are not read');
  assert.equal(layerSection({id: 'tufts-1', plants: {kind: 'grass', amount: .6}}, world()).section, 'drawing', 'a plants-only layer');
});

test('a move steps past the nearest layer it moves among and lands beside it, passing the layers of other sections between', () => {
  // Stage land, stored bottom first: soil (cannot draw), rock, beach (cannot draw), moss (added on top). The drawing section shows moss over rock.
  const layers = [{builtin: 'soil'}, {builtin: 'rock'}, {builtin: 'beach'}, {id: 'moss'}], keys = list => list.map(l => l.builtin ?? l.id);
  const drawing = [1, 3];
  assert.deepEqual(keys(moveLayer(layers, 3, -1, drawing)), ['soil', 'moss', 'rock', 'beach'], 'lowered: directly under rock, past beach');
  assert.deepEqual(keys(moveLayer(layers, 1, 1, drawing)), ['soil', 'beach', 'moss', 'rock'], 'rock raised: directly over moss, past beach');
  assert.equal(moveLayer(layers, 3, 1, drawing), null, 'the top of its peers');
  assert.equal(moveLayer(layers, 1, -1, drawing), null, 'the bottom of its peers');
  assert.deepEqual(keys(moveLayer(layers, 0, 1, [0, 2])), ['rock', 'beach', 'soil', 'moss'], 'in its own section: soil over beach');
  assert.deepEqual(keys(layers), ['soil', 'rock', 'beach', 'moss'], 'the list itself is left as it was');
  const swap = moveLayer(layers, 1, 1, [1, 2]);
  assert.deepEqual(keys(swap), ['soil', 'beach', 'rock', 'moss'], 'neighbors swap');
});
