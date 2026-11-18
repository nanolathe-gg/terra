import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {surfaceRows, copySurface, spreadRule, ruleHere, SURFACE_SPREAD_STEP, SURFACE_FACT_RANGE, SURFACE_FACT_GRAY, SURFACE_FACT_ROOT, factPosition, factAtPosition, SURFACE_BUILTINS, SURFACE_STAGES, SURFACE_FACTS, SURFACE_FLAGS_ROW, SURFACE_DRAWABLE} from '../sculpt-material-model.js';
import {withWorldMaterials, materialsInUse, copyMaterials, roleOf, LIBRARY, surfaceMaterials, deleteMaterial, assignMaterial, worldMaterials, worldOwnMaterials, keptWorldMaterials, worldKept} from '../sculpt-materials.js';

const defaults = JSON.parse(readFileSync(new URL('../materials/defaults.json', import.meta.url), 'utf8'));
const world = name => JSON.parse(readFileSync(new URL(`../materials/${name}.json`, import.meta.url), 'utf8')).world;

test('the default surface draws every built-in once, in a stage order the draw can run, each engine surface with the world’s material', () => {
  const names = defaults.surface.map(l => l.builtin);
  assert.deepEqual([...names].sort(), Object.keys(SURFACE_BUILTINS).sort(), 'each built-in once');
  const stages = names.map(n => SURFACE_BUILTINS[n][0]);
  assert.deepEqual(stages, [...stages].sort((a, b) => a - b), 'listed in stage order');
  const {rows, flags} = surfaceRows(defaults.surface);
  assert.equal(rows.length, 2 * names.length, 'two rows a layer without a rule');
  assert.equal(flags[0], 1, 'materials read the wear and deposit facts');
  for (const l of defaults.surface) assert.equal(l.material?.startsWith('@') ?? false, SURFACE_DRAWABLE.includes(l.builtin), `${l.builtin}: the world’s material, by role, exactly where the engine colored it`);
  assert.ok(surfaceRows([{builtin: 'soil'}]).rows[0][2] === -2, 'an engine surface without a material draws nothing');
});

test('each built-in’s needs name real World settings, roles, world facts and surfaces', async () => {
  const {SURFACE_NEEDS} = await import('../sculpt-material-model.js');
  const {KNOBS, worldPanelValues} = await import('../sculpt-knobs.js');
  const {ROCK_KEYS} = await import('../sculpt-rock-presets.js');
  const {MAP_ROLES} = await import('../sculpt-materials.js');
  const {MASK_CHOICES} = await import('../sculpt-scene.js');
  const knobs = new Set([...KNOBS.flatMap(([, rows]) => rows.map(r => r[0])), ...ROCK_KEYS]);
  const facts = Object.keys(worldPanelValues({config: {surface: []}, renderer: {variant: new Map()}, nodes: [], colors: {}, materials: []}));
  const renderer = readFileSync(new URL('../sculpt-renderer.js', import.meta.url), 'utf8');
  assert.deepEqual(Object.keys(SURFACE_NEEDS).sort(), Object.keys(SURFACE_BUILTINS).sort(), 'every built-in has an entry');
  for (const [builtin, needs] of Object.entries(SURFACE_NEEDS)) for (const need of needs) {
    const kinds = ['control', 'role', 'layer', 'painted', 'column'].filter(k => need[k] !== undefined);
    assert.equal(kinds.length, 1, `${builtin}: one kind a need`);
    if (need.control) assert.ok(knobs.has(need.control), `${builtin}: ${need.control} is a World setting`);
    if (need.unless) assert.ok(facts.includes(need.unless), `${builtin}: ${need.unless} is a world fact`);
    if (need.role) assert.ok(MAP_ROLES.some(([r]) => r === need.role), `${builtin}: ${need.role} is a map role`);
    if (need.layer) assert.ok(renderer.includes(`this.layers.has('${need.layer}')`), `${builtin}: the renderer reads the world’s ${need.layer}`);
    if (need.painted) assert.ok(MASK_CHOICES.some(([, name]) => name.toLowerCase().startsWith(need.painted)), `${builtin}: Surface paint lays ${need.painted}`);
  }
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
  assert.throws(() => surfaceRows([{id: 'x'}]), /built-in, draws a material or grows plants/);
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

test('surface: a stored list from before the engine surfaces drew materials takes the world’s for them', async () => {
  const {withSurfaceMaterials} = await import('../sculpt-material-model.js');
  const base = [{builtin: 'sand', material: 'green-sand'}, {builtin: 'rock'}], old = [{builtin: 'sand', amount: .5}, {builtin: 'rock'}, {builtin: 'soil'}];
  assert.deepEqual(withSurfaceMaterials(old, base), [{builtin: 'sand', amount: .5, material: 'green-sand'}, {builtin: 'rock'}, {builtin: 'soil'}]);
});

test('plants grow on material layers: one kind each, a plants-only layer draws no material, and the bake gets each one\'s first row', async () => {
  const {surfaceRows, copySurface, coverRows, PLANT_MAX} = await import('../sculpt-material-model.js');
  const list = [
    {builtin: 'soil'},
    {id: 'moss-1', material: 'lush-ground', stage: 'land', where: [{fact: 'moisture', from: .4}], plants: {kind: 'moss', amount: .5}},
    {id: 'tufts-1', stage: 'ground', plants: {kind: 'grass', amount: 2}},
  ];
  const copied = copySurface(list);
  assert.equal(copied[2].material, undefined, 'a plants-only layer keeps no material');
  assert.equal(copied[2].plants.amount, 1, 'a density over 1 is held to 1');
  const out = surfaceRows(copied, key => key === 'lush-ground' ? 4 : -1);
  assert.deepEqual(out.plants.map(p => [p.kind, p.amount]).sort(), [[0, 1], [2, .5]]);
  for (const p of out.plants) assert.equal(out.rows[p.row][0], -1, 'an entry points at its layer\'s first row');
  const tufts = out.plants.find(p => p.kind === 0); assert.equal(out.rows[tufts.row][2], -3, 'plants only: the color pass skips it');
  assert.throws(() => surfaceRows([{builtin: 'soil', plants: {kind: 'grass', amount: 1}}]), /plants grow on a material layer/);
  assert.throws(() => copySurface([{id: 'x-1', stage: 'land'}]), /a material or plants/);
  assert.throws(() => surfaceRows(Array.from({length: PLANT_MAX + 1}, (_, i) => ({id: `p-${i}`, plants: {kind: 'grass', amount: 1}}))), /at most/);
  const site = {wet: [.25, .9], dry: .4, soil: {slope: [.6, 1.6], convex: .5, deposit: .3}, moisture: {perSwath: .5, swathRef: .35, shade: .28}, plants: {tuft: 4, shrub: 2, shrubs: 1.5}};
  const rows = coverRows(site, out.plants, .5);
  assert.deepEqual(rows[3], [2, 1, 1.5, 2], 'heights times Vegetation relief, then the entries');
  assert.deepEqual(rows[4], [out.plants[0].row, out.plants[0].kind, out.plants[0].amount, 0]);
  assert.deepEqual(coverRows(site, [], 1)[3], [0, 0, 0, 0], 'no plants: no plant rows');
});

test('Spread moves every limit of a rule together, never inverts a window, and at 0 packs the rule as written', () => {
  const moss = {id: 'moss-1', material: 'lush-ground', where: [{fact: 'moisture', from: .4, fade: .1}, {fact: 'light', from: .2, to: .8, fade: .1}]};
  const ledge = {id: 'ledge-1', material: 'lush-ground', score: {terms: [{fact: 'slope', weight: 1}, {fact: 'convexity', weight: 1.5}], from: 1.2, fade: .2}};
  for (const layer of [moss, ledge]) assert.deepEqual(surfaceRows([{...layer, spread: 0}], () => 3).rows, surfaceRows([layer], () => 3).rows, 'Spread 0 is the rule as written');
  const wide = spreadRule({...moss, spread: 1}).where, step = SURFACE_SPREAD_STEP;
  assert.ok(Math.abs(wide[0].from - (.4 - step.moisture)) < 1e-9 && wide[0].to === undefined, 'an open end stays open');
  assert.ok(Math.abs(wide[1].from - (.2 - step.light)) < 1e-9 && Math.abs(wide[1].to - (.8 + step.light)) < 1e-9, 'both ends move apart');
  const narrow = spreadRule({...moss, where: [{fact: 'light', from: .45, to: .55}], spread: -1}).where[0];
  assert.ok(narrow.from <= narrow.to && Math.abs(narrow.from - .5) < 1e-9, 'narrowed past its middle, the ends meet there');
  const lower = spreadRule({...ledge, spread: .5}).score.from;
  assert.ok(Math.abs(lower - (1.2 - .5 * (1 * step.slope + 1.5 * step.convexity) / 2)) < 1e-9, 'the threshold falls by the mean weighted step');
  // The draw and the inspector agree: the packed window and ruleHere both read the spread limits.
  const rows = surfaceRows([{...moss, spread: 1}], () => 3).rows;
  assert.ok(Math.abs(rows[3][1] - wide[0].from) < 1e-6, 'the packed window is the spread one');
  const facts = SURFACE_FACTS.map(f => f === 'moisture' ? .3 : f === 'light' ? .5 : 0);
  assert.equal(ruleHere(moss, facts).share, 0, 'moisture .3 is below the written window');
  assert.ok(ruleHere({...moss, spread: 1}, facts).share > .9, 'and inside the spread one');
});

test('a surface keeps a layer’s Spread through a save, clamped, and Highland ground takes none', () => {
  const list = copySurface([{id: 'moss-1', material: 'lush-ground', where: [{fact: 'moisture', from: .4}], spread: 3}, {builtin: 'highland', spread: .5}]);
  assert.equal(list[0].spread, 1);
  assert.equal(list[1].spread, undefined);
});

test('the fact view’s ranges in the shader are the model’s', () => {
  const wgsl = readFileSync(new URL('../engine-common.wgsl', import.meta.url), 'utf8');
  const list = name => wgsl.match(new RegExp(`const ${name} = array<f32, ${SURFACE_FACTS.length}>\\(([^)]*)\\)`))[1].split(',').map(Number);
  assert.deepEqual(list('SURFACE_FACT_LO'), SURFACE_FACTS.map(f => SURFACE_FACT_RANGE[f][0]));
  assert.deepEqual(list('SURFACE_FACT_HI'), SURFACE_FACTS.map(f => SURFACE_FACT_RANGE[f][1]));
  assert.deepEqual(['LO', 'HI'].map(end => Number(wgsl.match(new RegExp(`const SURFACE_FACT_GRAY_${end} = ([0-9.]+);`))[1])), SURFACE_FACT_GRAY);
  assert.deepEqual(list('SURFACE_FACT_ROOT'), SURFACE_FACTS.map(f => SURFACE_FACT_ROOT.includes(f) ? 1 : 0));
});

test('Steepness spreads its low end across the fact view, and a position maps back to its value', () => {
  assert.ok(factPosition('slope', 1) > .2, 'a slope of 1 sits past a fifth of the gray');
  assert.equal(factPosition('slope', 20), 1);
  assert.equal(factPosition('slope', 40), 1);
  assert.equal(factPosition('moisture', .25), .25);
  for (const [fact, v] of [['slope', 3], ['slope', .4], ['moisture', .7], ['aboveSea', 50]]) assert.ok(Math.abs(factAtPosition(fact, factPosition(fact, v)) - v) < 1e-9);
});

test('every fact has a range and a Spread step, and only a rule that reads Sheltered or Distance to water asks the draw to look around', () => {
  for (const f of SURFACE_FACTS) { assert.equal(SURFACE_FACT_RANGE[f]?.length, 2, f); assert.ok(SURFACE_SPREAD_STEP[f] > 0, f); }
  const flags = list => surfaceRows(list, () => 3).flags;
  assert.deepEqual(flags([{id: 'a', material: 'm', where: [{fact: 'north', from: .3}]}]), [1, 0, 0, 0]);
  assert.deepEqual(flags([{id: 'a', material: 'm', where: [{fact: 'sheltered', from: .3}]}]), [1, 1, 0, 0]);
  assert.deepEqual(flags([{id: 'a', material: 'm', score: {terms: [{fact: 'toWater', weight: -1}, {fact: 'slope'}]}}]), [1, 2, 0, 0]);
  assert.deepEqual(flags([{id: 'a', material: 'm', where: [{fact: 'sheltered', from: .3}]}, {id: 'b', material: 'm', where: [{fact: 'toWater', to: 40}]}]), [1, 3, 0, 0]);
});
