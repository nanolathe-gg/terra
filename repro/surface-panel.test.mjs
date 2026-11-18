// World › Surface's list without the DOM (sculpt-surface-panel.js): which section a layer is in, from facts read directly.
import test from 'node:test';
import assert from 'node:assert/strict';
import {layerSection, moveLayer, whereWords, BUILTIN_WHERE, BUILTIN_PLACED_BY, SURFACE_PRESETS} from '../sculpt-surface-panel.js';
import {KNOBS} from '../sculpt-knobs.js';
import {SURFACE_BUILTINS} from '../sculpt-material-model.js';

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

test('a closed row says where the layer lies, in words from its own rule', () => {
  assert.equal(whereWords({id: 'a', material: 'x'}), 'Everywhere');
  assert.equal(whereWords({id: 'moss', where: [{fact: 'moisture', from: .4, fade: .1}, {fact: 'light', to: .8, fade: .1}]}), 'Where Moisture is above 0.4 and Sunlight is below 0.8');
  assert.equal(whereWords({id: 'b', where: [{fact: 'aboveSea', from: -2, to: 5.125}]}), 'Where Height above the sea is -2 to 5.13');
  assert.equal(whereWords({id: 'c', where: [{fact: 'top', to: -.1}]}), 'Where Lumps and hollows is below -0.1', 'a label’s parenthesis stays in the rule editor');
  assert.equal(whereWords({id: 'd', score: {terms: [{fact: 'slope', weight: 1}, {fact: 'convexity', weight: 1.5}], from: 1.2, fade: .2}}), 'Where a score of Steepness and Convexity passes 1.2');
  assert.equal(whereWords({id: 'e', score: {terms: [{fact: 'abovePlain', weight: 1}, {fact: 'light', weight: -2}, {fact: 'wetness'}], from: 40}}), 'Where a score of Height above the plain, less Sunlight and Wetness passes 40');
  assert.equal(whereWords({builtin: 'sand'}), 'Where sand is painted or deposited', 'a built-in by its own line');
  assert.equal(whereWords({builtin: 'rock', where: [{fact: 'slope', from: .2}]}), 'Where rock is bare: its faces and exposed ground, where Steepness is above 0.2', 'narrowed by its rule');
  assert.equal(whereWords({builtin: 'highland', where: [{fact: 'slope', from: .2}]}), BUILTIN_WHERE.highland, 'Highland ground takes no rule');
  assert.deepEqual(Object.keys(BUILTIN_WHERE).sort(), Object.keys(SURFACE_BUILTINS).sort(), 'one line for every built-in');
  for (const p of SURFACE_PRESETS) assert.ok(whereWords(p).length > 0, p.key);
});

test('Base band without a rock column says so',async()=>{
  const {layerSection}=await import('../sculpt-surface-panel.js');
  const facts=column=>({material:()=>true,control:key=>({value:1,label:key}),role:()=>({present:true}),layer:()=>true,fact:()=>0,column:()=>column});
  const band={id:'b',builtin:'baseBand',material:'desert-band'};
  assert.equal(layerSection(band,facts(true)).section,'drawing');
  assert.equal(layerSection(band,{...facts(true),column:undefined}).section,'drawing','unknown is no claim');
  const none=layerSection(band,facts(false));assert.equal(none.section,'idle');assert.match(none.reasons[0].text,/column of beds/);
});

test('each built-in names World settings that exist as the ones that place it', () => {
  const keys = new Set(KNOBS.flatMap(([, rows]) => rows.map(r => r[0])));
  for (const [builtin, list] of Object.entries(BUILTIN_PLACED_BY)) {
    assert.ok(SURFACE_BUILTINS[builtin], `${builtin} is a built-in`);
    for (const key of list) assert.ok(keys.has(key), `${builtin}: ${key} is a World setting`);
  }
});

test('every fact a rule may read has a name for the artist', async () => {
  const {FACT_LABELS} = await import('../sculpt-surface-panel.js'), {SURFACE_FACTS} = await import('../sculpt-material-model.js');
  for (const f of SURFACE_FACTS) assert.ok(FACT_LABELS[f]?.[0], f);
});
