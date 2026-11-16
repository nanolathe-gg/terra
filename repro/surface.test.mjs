import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {surfaceRows, copySurface, SURFACE_BUILTINS, SURFACE_STAGES, SURFACE_FACTS, SURFACE_FLAGS_ROW} from '../sculpt-material-model.js';
import {withWorldMaterials, materialsInUse, copyMaterials, roleOf, LIBRARY, surfaceMaterials, deleteMaterial, assignMaterial, worldMaterials, worldOwnMaterials, keptWorldMaterials, worldKept} from '../sculpt-materials.js';

const defaults = JSON.parse(readFileSync(new URL('../materials/defaults.json', import.meta.url), 'utf8'));
const world = name => JSON.parse(readFileSync(new URL(`../materials/${name}.json`, import.meta.url), 'utf8')).world;

test('the default surface draws every built-in once, in a stage order the draw can run, and reads no facts', () => {
  const names = defaults.surface.map(l => l.builtin);
  assert.deepEqual([...names].sort(), Object.keys(SURFACE_BUILTINS).sort(), 'each built-in once');
  const stages = names.map(n => SURFACE_BUILTINS[n][0]);
  assert.deepEqual(stages, [...stages].sort((a, b) => a - b), 'listed in stage order');
  const {rows, flags} = surfaceRows(defaults.surface);
  assert.equal(rows.length, 2 * names.length, 'two rows a layer without a rule');
  assert.equal(flags[0], 0, 'no fact is computed for the shipped stack');
});

test('rows sort by stage, keep the list order within a stage, and head each stage with its first row and count', () => {
  const {rows, head} = surfaceRows([{builtin: 'sand'}, {builtin: 'highland', amount: .5}, {builtin: 'fines', edge: {width: .2, noise: .6, noiseSize: 1}}, {builtin: 'rock'}]);
  assert.equal(rows.length, 8);
  assert.deepEqual(rows[0], [SURFACE_BUILTINS.highland[1], 1, -1, 0], 'stage 0 first; Highland ground’s strength is its World setting, so a stored Amount draws nothing');
  assert.deepEqual(rows.filter((_, i) => i % 2 === 0).map(r => r[0]), [0, 1, 6, 1], 'highland, rock, sand, fines by slot');
  assert.deepEqual(rows[7].slice(0, 3), [.2, .6, 1], 'an edge row');
  assert.equal(head.length, SURFACE_STAGES / 2);
  assert.deepEqual(head[0], [0, 1, 0, 0], 'stage 0: one layer at row 0; stage 1: none');
  assert.deepEqual(head[1], [2, 1, 0, 0], 'stage 2: rock at row 2');
  assert.deepEqual(head[2].slice(2), [4, 2], 'stage 5: sand then fines, the list order kept');
});

test('a rule adds its rows and turns facts on; a material layer binds the world’s copy of its library material', () => {
  const {rows, flags, head} = surfaceRows([
    {builtin: 'rock', where: [{fact: 'slope', from: 1, to: 9, fade: .2}, {fact: 'aboveSea', from: 10}]},
    {id: 'snow', material: 'green-ground', stage: 'snow', score: {terms: [{fact: 'abovePlain', weight: 1}, {fact: 'light', weight: -2}], from: 40, fade: 5}},
  ], key => key === 'green-ground' ? 9 : -1);
  assert.equal(flags[0], 1);
  assert.deepEqual(rows[0], [1, 1, -1, 3], 'rock: three rule rows');
  assert.deepEqual(rows[2], [1, 0, 0, 0], 'windows');
  assert.deepEqual(rows[3], [SURFACE_FACTS.indexOf('slope'), 1, 9, .2]);
  assert.equal(rows[4][2], 1e9, 'an open end');
  assert.deepEqual(rows[5], [-1, 1, 9, 3], 'the material layer: slot 9, three rule rows');
  assert.deepEqual(rows[7], [2, 40, 5, 0], 'a score');
  assert.deepEqual(head[3].slice(2), [5, 1], 'the snow stage starts at row 5');
  assert.notEqual(rows[1][3], rows[6][3], 'each layer its own salt');
});

test('a bad list is refused', () => {
  assert.throws(() => surfaceRows([{builtin: 'lava lamp'}]), /unknown built-in/);
  assert.throws(() => surfaceRows([{builtin: 'rock', where: [{fact: 'vibes'}]}]), /unknown fact/);
  assert.throws(() => surfaceRows([{material: 'green-ground'}]), /needs an id/);
  assert.throws(() => surfaceRows([{id: 'x', material: 'green-ground', stage: 'attic'}]), /unknown stage/);
  assert.throws(() => surfaceRows(Array.from({length: 33}, () => ({builtin: 'rock'}))), /at most/);
  const big = Array.from({length: 30}, (_, i) => ({id: 'm' + i, material: 'green-ground', where: [{fact: 'slope'}, {fact: 'slope'}, {fact: 'slope'}, {fact: 'slope'}]}));
  assert.throws(() => surfaceRows(big), new RegExp(`holds ${SURFACE_FLAGS_ROW}`));
  assert.deepEqual(surfaceRows(undefined).rows, [], 'no list: no layers');
});

test('a world whose surface draws a material gives a new map that material, bound to its library key and in use', () => {
  const w = world('green'), config = {materials: w.materials, surface: [...defaults.surface, {id: 'scree', name: 'Scree', material: 'green-debris', stage: 'land', where: [{fact: 'slope', from: 1}]}]};
  const list = withWorldMaterials(null, config), m = list.find(o => o.worldLayer === 'green-debris');
  assert.ok(m, 'added');
  assert.equal(m.source, 'green-debris');
  assert.equal(roleOf(m), 'worldLayer');
  assert.ok(materialsInUse([], list).some(o => o.slot === m.slot), 'in use');
  assert.deepEqual(copyMaterials(list).find(o => o.slot === m.slot).worldLayer, 'green-debris', 'kept by a save');
  assert.throws(() => copyMaterials([{...m, worldRock: true}]), /material of its own/);
  assert.ok(LIBRARY['green-debris']);
});

test('a surface from a save or a world file is checked and copied; a save carries an edited one only', async () => {
  const {copySurface} = await import('../sculpt-material-model.js');
  const {savedWorld, copySavedWorld} = await import('../sculpt-save.js');
  const layers = [...defaults.surface, {id: 'snow-1', name: 'Snow', material: 'ice-ground', stage: 'snow', amount: .6, where: [{fact: 'abovePlain', from: 40, fade: 6, extra: 1}], junk: true}];
  const copy = copySurface(layers);
  assert.deepEqual(copy.at(-1), {id: 'snow-1', name: 'Snow', amount: .6, where: [{fact: 'abovePlain', from: 40, fade: 6}], material: 'ice-ground', stage: 'snow'}, 'only the fields a layer has');
  assert.throws(() => copySurface([{id: 'bad id!', material: 'ice-ground'}]), /id of its own/);
  assert.throws(() => copySurface([{builtin: 'rock', where: [{fact: 'nope'}]}]), /unknown fact/);
  const w = world('green'), config = {biome: 'Green Planet', biomeId: 'green', materials: w.materials, surface: defaults.surface, defaults: {}, engineDefaults: {}};
  const plain = savedWorld(config, new URLSearchParams(), {name: 'Green Planet', colors: {}, knobs: {}});
  assert.equal(plain.surface, undefined, 'a world that kept its own surface saves none');
  const edited = savedWorld(config, new URLSearchParams(), {name: 'Green Planet', colors: {}, knobs: {}, surface: copy});
  assert.deepEqual(copySavedWorld(JSON.parse(JSON.stringify(edited)), config).surface, copy, 'an edited surface round-trips');
});

test('an engine-colored built-in may draw a library material, bound by that material, once in a list', () => {
  const surface = defaults.surface.map(l => l.builtin === 'sand' ? {...l, material: 'zhon-beach'} : l);
  const {rows, flags} = surfaceRows(surface, key => key === 'zhon-beach' ? 7 : -1);
  const at = rows.findIndex((r, i) => r[0] === SURFACE_BUILTINS.sand[1] && r[2] === 7);
  assert.ok(at >= 0, 'the sand row carries its material slot');
  assert.equal(flags[0], 1, 'a material needs the facts (wear and deposit for its pigment)');
  const w = world('green'), list = withWorldMaterials(null, {materials: w.materials, surface}), m = list.find(o => o.worldLayer === 'zhon-beach');
  assert.equal(m?.source, 'zhon-beach');
  assert.equal(m.name, LIBRARY['zhon-beach'].name);
  assert.deepEqual(copySurface(surface).find(l => l.builtin === 'sand'), {builtin: 'sand', name: 'Sand', material: 'zhon-beach'});
  assert.throws(() => copySurface([...surface, {builtin: 'sand', material: 'desert-ground'}]), /once in a list/);
  for (const b of ['highland', 'rock', 'slopeCover', 'beach', 'fines', 'crown', 'paintedRock', 'chips'])
    assert.throws(() => copySurface([{builtin: b, material: 'zhon-beach'}]), /Materials panel or Rock types/, b + ' takes its material from a role or its rock type');
  assert.deepEqual(copySurface([{builtin: 'highland', amount: .5, where: [{fact: 'slope'}], edge: {width: .2}}, {builtin: 'baseBand', amount: .3, edge: {width: .4}}]),
    [{builtin: 'highland'}, {builtin: 'baseBand', edge: {width: .4}}], 'Highland keeps no Amount, rule or edge; Base band no Amount');
  assert.throws(() => surfaceRows([{id: 'x'}]), /built-in or draws a material/);
  assert.throws(() => copySurface([{id: 'highland', material: 'red-ground'}]), /id of its own/, 'a material layer cannot take a built-in’s name');
  assert.throws(() => surfaceRows([{id: 'rock', material: 'red-ground'}]), /built-in's name/);
});

test('height contrast rides in the rule head; a layer without a rule gets an empty one, and only a layer that draws a material has it', () => {
  const {rows} = surfaceRows([{id: 'a', material: 'green-ground', edge: {height: .5}}, {id: 'b', material: 'green-ground', where: [{fact: 'slope', from: 1}], edge: {height: 2}}, {builtin: 'sand', edge: {height: 1}}]);
  assert.deepEqual(rows[0].slice(3), [1], 'one rule row');
  assert.deepEqual(rows[2], [1, 0, 0, .5], 'an empty windows rule carrying the contrast');
  assert.deepEqual(rows[3].slice(3), [2]);
  assert.equal(rows[5][3], 1, 'clamped to 1');
  assert.deepEqual(rows.at(-2).slice(3), [0], 'a built-in drawing its own color has no height to compare');
  assert.equal(copySurface([{id: 'a', material: 'x', edge: {height: .3, junk: 1}}])[0].edge.height, .3);
});

test('a map’s materials follow the surface: a copy no layer draws leaves unless a stroke uses it; layers that draw one material share its copy', () => {
  const w = world('green'), config = {materials: w.materials};
  const sandy = defaults.surface.map(l => l.builtin === 'sand' ? {...l, material: 'zhon-beach'} : l);
  const start = surfaceMaterials(defaults.surface, null, {config}), withSand = surfaceMaterials(sandy, start, {config});
  const copy = withSand.find(m => m.worldLayer === 'zhon-beach');
  assert.equal(copy?.source, 'zhon-beach');
  assert.equal(surfaceMaterials(defaults.surface, withSand, {config}).length, start.length, 'cleared: its copy leaves');
  const stroke = {kind: 'landform', hidden: true, params: {groundPreset: copy.slot}};
  const kept = surfaceMaterials(defaults.surface, withSand, {config, nodes: [stroke]}).find(m => m.slot === copy.slot);
  assert.ok(kept && !kept.worldLayer, 'a hidden stroke keeps it, unbound');
  // Sand dust drawing the same material shares the sand's copy.
  const dusty = sandy.map(l => l.builtin === 'sandDust' ? {...l, material: 'zhon-beach'} : l);
  assert.deepEqual(surfaceMaterials(dusty, withSand, {config}).filter(m => m.worldLayer === 'zhon-beach').map(m => m.slot), [copy.slot]);
  assert.throws(() => deleteMaterial(withSand, [], copy.slot), /draws surface layers/);
  assert.equal(assignMaterial(withSand, copy.slot, 'worldGround').find(m => m.slot === copy.slot).worldLayer, undefined, 'made the ground, it draws no layer');
});

test('surface: a hidden layer (the design view) draws nothing and keeps its place', () => {
  const list = [{builtin: 'rock'}, {id: 'cap', name: 'Cap', material: 'ice-ground', stage: 'snow', amount: .4}];
  const shown = surfaceRows(list), hidden = surfaceRows(list, () => -1, new Set(['rock', 'cap']));
  assert.deepEqual(hidden.layerRows, shown.layerRows);
  for (const i of [0, 1]) assert.equal(hidden.rows[hidden.layerRows[i]][1], 0);
  assert.equal(shown.rows[shown.layerRows[1]][1], .4);
});

test('surface: the world keeps its role and layer materials, as it keeps its ground and water', () => {
  const config = {materials: {ground: 'green-ground', water: 'green-water', slope: 'green-slope'}, surface: [{id: 'cap', name: 'Cap', material: 'ice-ground', stage: 'snow'}]};
  const fresh = worldMaterials(config);
  assert.deepEqual(worldOwnMaterials(fresh, config), [], 'nothing changed, nothing kept');
  const edited = fresh.map(m => m.worldSlope || m.worldLayer === 'ice-ground' ? {...m, seed: 9} : m), own = worldOwnMaterials(edited, config);
  assert.deepEqual(own.map(m => [m.replaces, m.worldSlope === true, m.worldLayer ?? null, m.seed]), [['green-slope', true, null, 9], ['ice-ground', false, 'ice-ground', 9]]);
  // Another map in the world shows the world's copies; a look whose layer draws another library material does not take the cap's edit.
  const other = worldMaterials({...config, worldMaterials: keptWorldMaterials(own, config)});
  assert.deepEqual(other.filter(m => m.worldSlope || m.worldLayer).map(m => m.seed), [9, 9]);
  const relooked = {...config, surface: [{id: 'cap', name: 'Cap', material: 'lush-ground', stage: 'snow'}]};
  assert.deepEqual(keptWorldMaterials(own, relooked).map(m => m.worldSlope ? 'slope' : m.worldLayer), ['slope']);
  assert.deepEqual(worldKept(edited).map(m => m.slot).length, 3 + 1, 'ground, water, slope and the cap go with the world');
});
