// Materials (sculpt-materials.js): the node model's rules, what it compiles to, and a map's list of materials through save and world files.
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {NODES, LIBRARY, MAX_NODES, MATERIAL_SLOTS, copyMaterial, copyMaterials, blankMaterial, makeNode, orderNodes, nodeTypes, compileMaterial, programKey, programSource, stagePlan,
  materialReliefBound, materialRenderKey, soloMaterial, colorSources, materialColor, recolorMaterial, controlSpec, controlRange, nodeParams, withWorldMaterials, worldMaterials, adoptWorldMaterials, worldOwnMaterials, keptWorldMaterials, mergeWorldMaterials, worldKept, addMaterial, duplicateMaterial, setMaterial,
  assignMaterial, deleteMaterial, strokeMaterial, keepStrokeMaterials, materialsInUse, materialUsers, materialText, parseMaterialText, reseedMaterial, materialTint} from '../sculpt-materials.js';
import {graphPositions, cardHeight, CARD} from '../sculpt-material-graph.js';
import {savedWorld, copySavedWorld} from '../sculpt-save.js';

const config = {biomeId: 'red', biome: 'Red Planet', materials: {ground: 'red-ground', water: 'red-water'}, defaults: {}, engineDefaults: {}, colors: {}};
const node = (id, type, extra = {}) => ({id, type, ...extra});
const graph = nodes => copyMaterial({nodes});

test('every library material is valid, compiles, and survives a copy unchanged', () => {
  assert.ok(Object.keys(LIBRARY).length >= 5);
  for (const [key, m] of Object.entries(LIBRARY)) {
    assert.equal(m.source, key);
    assert.deepEqual(copyMaterial(JSON.parse(JSON.stringify(m))), copyMaterial(m), key);
    const program = compileMaterial(m), source = programSource(program);
    assert.equal(program.instructions.length, m.nodes.length);
    assert.match(source.main, /fn groundMain/); assert.match(programSource(program, true).main, /fn thumbMain/);
    assert.equal(m.nodes.filter(n => n.type === 'output').length, 1, key);
    assert.ok(m.palette.length >= 2 && m.dither.amount > 0, key + ' is reduced to a palette');
  }
});

test('connections are typed, loops are refused, and a deleted source leaves its input open', () => {
  assert.throws(() => graph([node('a', 'noise', {in: {in: 'b'}}), node('b', 'noise')]), /Coordinates needs a Warp/);
  assert.throws(() => graph([node('w', 'warp'), node('g', 'gradient', {in: {in: 'w'}})]), /Input needs a gray or color input/);
  assert.throws(() => graph([node('a', 'levels', {in: {in: 'b'}}), node('b', 'levels', {in: {in: 'a'}})]), /loop/);
  assert.throws(() => graph([node('o', 'output'), node('p', 'output')]), /one Material node/);
  assert.throws(() => graph([node('w', 'warp'), node('o', 'output', {in: {height: 'w'}})]), /Height needs a gray or color input/);
  // A gray input wired to a color reads its brightness: a Gradient with gray stops is a curve for a height.
  const curved = graph([node('n', 'noise'), node('g', 'gradient', {in: {in: 'n'}}), node('l', 'levels', {in: {in: 'g'}}), node('o', 'output', {in: {color: 'g', height: 'g'}})]);
  const at = id => curved.nodes.findIndex(n => n.id === id), main = programSource(compileMaterial(curved)).main;
  assert.match(programSource(compileMaterial(curved), true).main, new RegExp(`nLevels\\(s${at('l')},graphGray\\(v${at('g')}\\)\\)`)); assert.match(main, new RegExp(`let height=graphGray\\(v${at('g')}\\)\\.x`));
  assert.match(main, new RegExp(`var color=v${at('g')}\\.rgb`), 'a color input reads the color itself');
  const m = graph([node('n', 'noise'), node('g', 'gradient', {in: {in: 'gone'}}), node('o', 'output', {in: {color: 'g'}})]);
  assert.equal(m.nodes.find(n => n.id === 'g').in.in, null);
  assert.equal(graph([node('n', 'noise')]).nodes.at(-1).type, 'output', 'a graph always has its Material node');
  // Gray and color mix freely in a Combine; its output is color once either input is.
  const mixed = graph([node('n', 'noise'), node('g', 'gradient', {in: {in: 'n'}}), node('c', 'combine', {kind: 'multiply', in: {a: 'g', b: 'n'}})]);
  assert.equal(nodeTypes(mixed.nodes).get('c'), 'color'); assert.equal(nodeTypes(mixed.nodes).get('n'), 'gray');
});

test('numbers are held in range, kinds choose their settings, and a new node has its own seed', () => {
  const m = graph([node('n', 'noise', {kind: 'waves', params: {size: 9999, direction: 30}}), node('r', 'noise', {kind: 'ridged'}), node('l', 'levels', {params: {low: .8, high: .2}})]);
  const waves = m.nodes[0], ridged = m.nodes[1];
  assert.equal(waves.params.size, 256); assert.equal(waves.params.direction, 30); assert.ok('crests' in waves.params);
  assert.deepEqual(Object.keys(ridged.params), ['size', 'layers', 'roughness', 'sharpness', 'seed']);
  assert.ok(m.nodes[2].params.high > m.nodes[2].params.low, 'Levels keeps High above Low');
  assert.throws(() => graph([node('n', 'noise', {kind: 'plasma'})]), /Invalid Noise type/);
  assert.throws(() => graph([node('n', 'noise', {params: {size: NaN}})]), /Invalid Size/);
  const next = makeNode('noise', m.nodes); assert.notEqual(next.params.seed, 0); assert.equal(makeNode('scatter', m.nodes).id, 'scatter');
  assert.throws(() => graph(Array.from({length: MAX_NODES + 1}, (_, i) => node('n' + i, 'constant'))), /at most 40/);
});

test('a gradient keeps 2 to 8 stops in order, and a stop may brighten up to 2', () => {
  const g = graph([node('n', 'noise'), node('g', 'gradient', {in: {in: 'n'}, stops: [[1, 2.5, 1, 1], [0, 0, 0, 0], [.5, .5, .5, .5]]})]).nodes[1];
  assert.deepEqual(g.stops, [[0, 0, 0, 0], [.5, .5, .5, .5], [1, 2, 1, 1]]);
  assert.throws(() => graph([node('g', 'gradient', {stops: [[0, 0, 0, 0]]})]), /2 to 8 stops/);
});

test('a Constant gives a gray value or a color, and its color publishes like a gradient’s', () => {
  const m = graph([node('k', 'constant', {kind: 'color', stops: [[.3, .2, 2.4, .1]]}), node('v', 'constant'), node('o', 'output', {in: {color: 'k'}})]);
  const k = m.nodes[0];
  assert.deepEqual(k.stops, [[0, .2, 2, .1]], 'one stop, brightened at most to 2'); assert.deepEqual(k.params, {});
  assert.equal(nodeTypes(m.nodes).get('k'), 'color'); assert.equal(nodeTypes(m.nodes).get('v'), 'gray');
  assert.ok(controlSpec(m, {label: 'Tint', node: 'k', param: 'stops'})?.stops);
  assert.deepEqual(compileMaterial(m).instructions.find(i => i.type === 'constant' && i.kind === 'color').args, [.2, 2, .1]);
  assert.deepEqual(graph([node('k', 'constant', {kind: 'color'})]).nodes[0].stops, [[0, .5, .5, .5]], 'a new color starts gray');
  for (const [key, lib] of Object.entries(LIBRARY)) assert.ok(!lib.nodes.some(n => n.type === 'gradient' && !n.in.in), `${key} makes a flat color with a Constant`);
});

test('Color adjust gives a color from gray or color, and its mask defaults to everywhere', () => {
  const m = graph([node('n', 'noise'), node('a', 'adjust', {in: {in: 'n'}, params: {hue: 400}}), node('o', 'output', {in: {color: 'a'}})]);
  assert.equal(nodeTypes(m.nodes).get('a'), 'color'); assert.equal(m.nodes[1].params.hue, 180);
  assert.match(programSource(compileMaterial(m)).main, /nAdjust\(s1,v0,vec4f\(1\)\)/);
});

test('the compiled program follows evaluation order and its pipeline key ignores numbers', () => {
  const m = LIBRARY['red-ground'], program = compileMaterial(m), index = new Map(program.nodes.map((n, i) => [n.id, i]));
  for (const n of program.nodes) for (const from of Object.values(n.in)) if (from) assert.ok(index.get(from) < index.get(n.id));
  const changed = structuredClone(m); changed.nodes[1].params.size = 20; changed.seed = 7;
  assert.equal(programKey(compileMaterial(changed)), programKey(program), 'a control or the seed never recompiles');
  assert.notEqual(materialRenderKey(changed), materialRenderKey(m));
  const rewired = structuredClone(m); rewired.nodes.find(n => n.type === 'output').in.height = rewired.nodes.find(n => n.type === 'levels').id;
  assert.notEqual(programKey(compileMaterial(copyMaterial(rewired))), programKey(program));
  // The seed reaches every seeded node's arguments.
  const seeded = compileMaterial({...m, seed: 5}).instructions.find(i => i.type === 'noise'), plain = program.instructions.find(i => i.type === 'noise');
  assert.equal(seeded.args[3], plain.args[3] + 5);
  assert.notEqual(reseedMaterial(m).seed, m.seed);
});

test('a Slope blur stages its input and its slope together, and passes its input through until a slope is wired', () => {
  const m = graph([node('n', 'noise'), node('h', 'gradient', {in: {in: 'n'}}), node('f', 'noise', {kind: 'facets'}), node('sb', 'slopeblur', {in: {in: 'f', slope: 'h'}}), node('o', 'output', {in: {color: 'sb'}})]);
  const program = compileMaterial(m), at = id => program.nodes.findIndex(n => n.id === id), plan = stagePlan(program), source = programSource(program);
  assert.deepEqual(plan.stages, [{step: at('sb'), type: 'slopeblur', kind: '', links: [at('f'), at('h')]}]);
  assert.match(source.stages, new RegExp(`textureStore\\(stageOut,vec2i\\(id.xy\\),vec4f\\(v${at('f')}.rgb,graphGray\\(v${at('h')}\\).x\\)\\)`), 'a color slope reads as its brightness');
  assert.match(source.stages, /fn slopePass/); assert.equal(nodeTypes(m.nodes).get('sb'), 'gray');
  const open = graph([node('f', 'noise'), node('sb', 'slopeblur', {in: {in: 'f'}}), node('o', 'output', {in: {color: 'sb'}})]), p = compileMaterial(open);
  assert.deepEqual(stagePlan(p).stages, []); assert.match(programSource(p).main, /let v1=v0;/);
});

test('the cache budget counts the stage textures while a material in use needs them', async () => {
  const {materialCacheUsage, materialStaged, MAX_STAGES} = await import('../sculpt-materials.js');
  const plain = materialCacheUsage(2), staged = materialCacheUsage(2, 512, true);
  assert.equal(plain.stageBytes, 0); assert.equal(staged.stageBytes, (MAX_STAGES + 2) * 16 * 512 * 512); assert.equal(staged.bytes - plain.bytes, staged.stageBytes);
  assert.ok(!materialStaged(LIBRARY['red-ground']));
  assert.ok(materialStaged(graph([node('n', 'noise'), node('b', 'blur', {in: {in: 'n'}}), node('o', 'output', {in: {color: 'b'}})])));
  assert.ok(!materialStaged(graph([node('n', 'noise'), node('b', 'blur', {enabled: false, in: {in: 'n'}}), node('o', 'output', {in: {color: 'b'}})])), 'a Blur that is off needs none');
});

test('a Stamp stages only its Shape; its Base, Coordinates and Density are read where it stamps', () => {
  const m = graph([node('w', 'warp'), node('b', 'noise'), node('f', 'noise', {kind: 'facets'}), node('g', 'gradient', {in: {in: 'f'}}), node('d', 'noise', {kind: 'smooth'}),
    node('st', 'stamp', {in: {base: 'b', shape: 'g', in: 'w', density: 'd'}}), node('o', 'output', {in: {color: 'st'}})]);
  const program = compileMaterial(m), at = id => program.nodes.findIndex(n => n.id === id), plan = stagePlan(program), source = programSource(program);
  assert.deepEqual(plan.stages, [{step: at('st'), type: 'stamp', kind: '', links: [at('g')]}]); assert.equal(nodeTypes(m.nodes).get('st'), 'color');
  assert.match(source.main, new RegExp(`nStamp\\(s${at('st')},v${at('w')}.xy,v${at('b')},v${at('d')},true,0\\)`));
  for (const id of ['w', 'b', 'd']) assert.match(source.main, new RegExp(`let v${at(id)}=`), id + ' is read where it stamps');
  assert.doesNotMatch(source.main, new RegExp(`let v${at('f')}=`), 'the Shape comes from its stage'); assert.match(source.taps, /fn nStamp/);
  const open = graph([node('b', 'noise'), node('st', 'stamp', {in: {base: 'b'}}), node('o', 'output', {in: {color: 'st'}})]);
  assert.match(programSource(compileMaterial(open)).main, /let v1=v0;/, 'without a Shape it is its Base');
});

test('a Blur computes its input in a stage of its own; later passes read the stage, never the branch behind it', () => {
  const m = graph([node('n', 'noise'), node('b1', 'blur', {in: {in: 'n'}}), node('b2', 'blur', {in: {in: 'b1'}}), node('g', 'gradient', {in: {in: 'b2'}}),
    node('cav', 'cavity', {in: {in: 'b2'}}), node('soft', 'blur', {in: {in: 'g'}}), node('o', 'output', {in: {color: 'soft', height: 'cav'}})]);
  const program = compileMaterial(m), at = id => program.nodes.findIndex(n => n.id === id), plan = stagePlan(program), source = programSource(program);
  assert.deepEqual(plan.stages.map(st => st.step), [at('b1'), at('b2'), at('soft')]); assert.deepEqual(plan.stageReads, [false, true, true]); assert.ok(plan.mainReads);
  assert.equal(nodeTypes(m.nodes).get('soft'), 'color', 'a Blur gives what it reads'); assert.equal(nodeTypes(m.nodes).get('b1'), 'gray');
  assert.match(source.stages, /fn stage0/); assert.match(source.stages, /fn stage2/); assert.match(source.stages, /fn blurPass/);
  assert.doesNotMatch(source.main, new RegExp(`let v${at('n')}=`), 'the main pass leaves the blurred branch to its stage');
  assert.match(source.main, new RegExp(`let v${at('soft')}=stageAt\\(2,point\\)`)); assert.match(source.taps, /fn stageAt/);
  assert.equal(programSource(compileMaterial(graph([node('n', 'noise'), node('o', 'output', {in: {color: 'n'}})]))).stages, null, 'no Blur, no stages');
  const off = graph([node('n', 'noise'), node('b', 'blur', {enabled: false, in: {in: 'n'}}), node('o', 'output', {in: {color: 'b'}})]);
  assert.deepEqual(stagePlan(compileMaterial(off)).stages, [], 'a Blur that is off passes its input through');
  assert.throws(() => graph([node('n', 'noise'), ...Array.from({length: 5}, (_, i) => node('b' + i, 'blur', {in: {in: 'n'}}))]), /4 Blur, Slope blur or Stamp nodes/);
  assert.equal(materialReliefBound(copyMaterial({nodes: [node('k', 'constant', {params: {value: .5}}), node('b', 'blur', {in: {in: 'k'}}), node('o', 'output', {in: {height: 'b'}, params: {relief: 4}})]})), 2);
});

test('Light and Cavity read their height at neighbors through a function of that branch only, with limits on chains', () => {
  const m = graph([node('w', 'warp'), node('n', 'noise', {in: {in: 'w'}}), node('other', 'noise'), node('light', 'light', {in: {in: 'n'}}), node('cav', 'cavity', {in: {in: 'light'}}),
    node('g', 'gradient', {in: {in: 'cav'}}), node('o', 'output', {in: {color: 'g', height: 'other'}})]);
  const program = compileMaterial(m), source = programSource(program), at = id => program.nodes.findIndex(n => n.id === id);
  const tap = source.taps.match(new RegExp(`fn tap${at('light')}\\(point:vec2f\\)->f32\\{[^}]*\\}`))[0];
  assert.match(tap, new RegExp(`let v${at('n')}=nNoise`)); assert.doesNotMatch(tap, new RegExp(`let v${at('other')}=`), 'only the branch it reads');
  assert.match(source.taps, new RegExp(`fn tap${at('cav')}`)); assert.match(source.main, /nLight\(/);
  const chain = [node('n', 'noise'), node('a', 'light', {in: {in: 'n'}}), node('b', 'cavity', {in: {in: 'a'}}), node('c', 'light', {in: {in: 'b'}})];
  assert.throws(() => graph(chain), /at most two in a chain/);
  assert.doesNotThrow(() => graph(chain.map(n => n.id === 'c' ? {...n, enabled: false} : n)));
});

test('the relief bound follows the graph, and a node shown alone is the same graph with one output', () => {
  assert.equal(materialReliefBound(LIBRARY['red-ground']), 0);
  const desert = LIBRARY['desert-ground'], relief = desert.nodes.find(n => n.type === 'output').params.relief;
  assert.ok(materialReliefBound(desert) >= relief * .5 && materialReliefBound(desert) < relief * 3);
  const solo = soloMaterial(desert, desert.nodes[1].id), out = solo.nodes.find(n => n.type === 'output');
  assert.equal(out.in.color, desert.nodes[1].id); assert.equal(out.in.height, null); assert.equal(solo.dither.amount, 0); assert.deepEqual(solo.palette, []);
  const warp = desert.nodes.find(n => n.type === 'warp'); assert.equal(soloMaterial(desert, warp.id).nodes.at(-1).kind, 'cells', 'coordinates are shown on a cell pattern');
  assert.equal(materialTint(LIBRARY['red-ground']).length, 3);
});

test('published controls name a node setting or a gradient’s colors, and vanish with their node', () => {
  const base = blankMaterial(), m = copyMaterial({...base, controls: [{label: 'Patch size', node: 'noise', param: 'size'}, {label: 'Colors', node: 'gradient', param: 'stops'}, {label: 'Gone', node: 'nothing', param: 'size'}, {label: 'Twice', node: 'noise', param: 'size'}], frames: [{name: 'Pattern', nodes: ['noise', 'missing']}]});
  assert.deepEqual(m.controls.map(c => c.label), ['Patch size', 'Colors']);
  assert.equal(controlSpec(m, m.controls[0]).spec.key, 'size'); assert.equal(controlSpec(m, m.controls[1]).stops, true);
  assert.deepEqual(m.frames, [{name: 'Pattern', nodes: ['noise']}]);
  const without = copyMaterial({...m, nodes: m.nodes.filter(n => n.id !== 'noise')});
  assert.deepEqual(without.controls.map(c => c.label), ['Colors']); assert.deepEqual(without.frames, []);
});

test('a map always has a ground and a water material, and an older save falls back to the world’s', () => {
  const list = worldMaterials(config);
  assert.deepEqual(list.map(m => [m.slot, m.source, m.worldGround, m.worldWater]), [[1, 'red-ground', true, false], [2, 'red-water', false, true]]);
  assert.deepEqual(withWorldMaterials(undefined, config), list);
  assert.equal(copyMaterials(undefined), null);
  const waterOnly = withWorldMaterials([{...list[1], slot: 5}], config);
  assert.deepEqual(waterOnly.map(m => [m.slot, m.worldGround, m.worldWater]), [[1, true, false], [5, false, true]]);
  assert.equal(worldMaterials({materials: {}}).find(m => m.worldGround).source, 'green-ground');
  assert.throws(() => copyMaterials([{...list[0], worldWater: true}]), /two materials/);
  assert.throws(() => copyMaterials([list[0], {...list[1], slot: 1}]), /own slot/);
  assert.throws(() => copyMaterials([list[0], {...list[0], slot: 3}]), /Only one material/);
  // Fields of an earlier format are dropped: what is left is a material with only its Material node.
  assert.deepEqual(copyMaterials([{slot: 1, name: 'Old', steps: [], knobs: {}}])[0].nodes.map(n => n.type), ['output']);
});

test('adding, assigning, deleting and what strokes keep', () => {
  let list = worldMaterials(config);
  const added = addMaterial(list, LIBRARY['desert-ground'], 'Sand'); list = added.materials; assert.equal(added.slot, 3);
  list = duplicateMaterial(list, 3).materials; assert.equal(list.at(-1).name, 'Sand copy');
  const stroke = slot => ({kind: 'landform', params: {groundPreset: slot}}), nodes = [stroke(3), stroke(0), stroke(-1), stroke(2), stroke(6), {kind: 'ground'}];
  assert.deepEqual(nodes.map(n => strokeMaterial(n, list)), [3, 0, -1, -1, -1, -1], 'water and missing slots are not ground choices');
  assert.deepEqual(materialsInUse(nodes, list).map(m => m.slot), [1, 2, 3]);
  assert.deepEqual(materialUsers(nodes, list, 3), {rocks: [], world: '', strokes: 1}); assert.deepEqual(materialUsers(nodes, list, 3, [{slot: 1, name: 'Granite', material: 3}]).rocks, ['Granite']); assert.throws(() => deleteMaterial(list, nodes, 3, [{slot: 1, name: 'Granite', material: 3}]), /surface of the rock type Granite/); assert.equal(materialUsers(nodes, list, 1).world, 'ground');
  assert.throws(() => deleteMaterial(list, nodes, 1), /world’s ground/);
  const gone = deleteMaterial(list, nodes, 3); assert.equal(gone.nodes[0].params.groundPreset, -1); assert.equal(gone.materials.length, 3);
  assert.equal(keepStrokeMaterials(nodes, list)[0], nodes[0], 'an unchanged stroke is the same object');
  const swapped = assignMaterial(list, 3, 'worldGround'); assert.deepEqual(swapped.filter(m => m.worldGround).map(m => m.slot), [3]);
  assert.throws(() => assignMaterial(list, 2, 'worldGround'), /world’s water/);
  let full = list; while (full.length < MATERIAL_SLOTS - 1) full = addMaterial(full, blankMaterial(), 'More').materials;
  assert.throws(() => addMaterial(full, blankMaterial()), new RegExp(`at most ${MATERIAL_SLOTS - 1} materials`));
  assert.equal(setMaterial(list, 3, LIBRARY['green-ground']).find(m => m.slot === 3).name, 'Sand', 'a new graph keeps the name and slot');
});

test('a published control has its own range inside the node setting’s, and a new one starts with a window about its value', () => {
  const base = blankMaterial(), size = nodeParams(base.nodes.find(n => n.id === 'noise')).find(p => p.key === 'size');
  assert.deepEqual(controlRange(size, 3.5), {min: 1, max: 14}); assert.deepEqual(controlRange(size, 40), {min: 10, max: 160});
  assert.deepEqual(controlRange({min: 0, max: 8}, 2.4), {min: 0, max: 8}, 'a setting that starts at 0 keeps its whole range');
  const ranged = copyMaterial({...base, controls: [{label: 'Size', node: 'noise', param: 'size', min: 2, max: 20}]});
  assert.deepEqual(ranged.controls, [{label: 'Size', node: 'noise', param: 'size', min: 2, max: 20}]);
  assert.deepEqual([controlSpec(ranged, ranged.controls[0]).spec.min, controlSpec(ranged, ranged.controls[0]).spec.max], [2, 20]);
  // A range outside the setting's is held inside it; an empty one falls back to the setting's own.
  const wide = controlSpec(ranged, {node: 'noise', param: 'size', min: -5, max: 9000}).spec; assert.deepEqual([wide.min, wide.max], [size.min, size.max]);
  const empty = controlSpec(ranged, {node: 'noise', param: 'size', min: 20, max: 20}).spec; assert.deepEqual([empty.min, empty.max], [size.min, size.max]);
  assert.throws(() => copyMaterial({...base, controls: [{label: 'Size', node: 'noise', param: 'size', min: 'a', max: 3}]}), /range/);
  // A copy saved before controls had ranges is still the library's material: the world does not mistake it for an edit.
  const older = worldMaterials(config).map(m => ({...m, controls: m.controls.map(({min, max, ...c}) => c)}));
  assert.ok(older.some(m => m.controls.some(c => c.param !== 'stops')), 'the fixture has a ranged control to lose');
  assert.deepEqual(worldOwnMaterials(copyMaterials(older), config), []);
  assert.deepEqual(keptWorldMaterials(older, config).map(m => m.controls), worldMaterials(config).map(m => m.controls));
  for (const [key, m] of Object.entries(LIBRARY)) for (const c of m.controls) if (c.param !== 'stops') {
    const {node, spec} = controlSpec(m, c); assert.ok(node.params[c.param] >= spec.min && node.params[c.param] <= spec.max, `${key}: ${c.label} starts inside its range`);
  }
});

test('the world’s ground and water belong to the world: a map takes them, and the world keeps only what differs from the library', () => {
  const fresh = worldMaterials(config);
  assert.deepEqual(worldOwnMaterials(fresh, config), [], 'a world nobody changed keeps nothing');
  // An edited ground is the world's: it is what the world keeps, and what a new map and another map's list take.
  const edited = fresh.map(m => m.worldGround ? {...m, seed: 4} : m), own = worldOwnMaterials(edited, config), mine = {...config, worldMaterials: own};
  assert.deepEqual(own.map(m => [m.worldGround, m.seed]), [[true, 4]], 'the untouched water is not kept');
  assert.equal(worldMaterials(mine).find(m => m.worldGround).seed, 4);
  assert.equal(worldMaterials(mine).find(m => m.worldWater).source, 'red-water');
  // Another map: its own material stays, in its slot; its ground gives way to the world's in the slot that map gave it, so a
  // stroke that named a slot still finds the same material there.
  const other = [{...LIBRARY['desert-ground'], slot: 1, name: 'Sand', key: null, worldGround: false, worldWater: false}, {...fresh[0], slot: 4}, {...fresh[1], slot: 2}];
  const taken = adoptWorldMaterials(other, mine);
  assert.deepEqual(taken.map(m => [m.slot, m.source, m.worldGround, m.seed]), [[1, 'desert-ground', false, 0], [2, 'red-water', false, 0], [4, 'red-ground', true, 4]]);
  assert.deepEqual(worldOwnMaterials(taken, config).map(m => m.seed), [4], 'and the world keeps the same after');
  // A map carried into another world takes that world's two and keeps its own others.
  const green = adoptWorldMaterials(taken, {materials: {ground: 'green-ground', water: 'green-water'}});
  assert.deepEqual(green.map(m => [m.slot, m.source]), [[1, 'desert-ground'], [2, 'green-water'], [4, 'green-ground']]);
  // A full list still holds both; a renamed material counts as changed; the pair is the two alone.
  let full = fresh; while (full.length < MATERIAL_SLOTS - 1) full = addMaterial(full, blankMaterial(), 'More').materials;
  assert.equal(adoptWorldMaterials(full, mine).length, MATERIAL_SLOTS - 1);
  assert.deepEqual(worldOwnMaterials(fresh.map(m => m.worldWater ? {...m, name: 'My sea'} : m), config).map(m => m.name), ['My sea']);
  assert.deepEqual(worldKept(taken).map(m => m.slot), [2, 4]);
});

test('what the world keeps follows the library material a look names, so looks that share one share the edit and others keep their own', () => {
  const snow = {materials: {ground: 'ice-ground', water: 'ice-water'}}, bergs = {materials: {ground: 'ice-bergs-ground', water: 'ice-water'}};
  const edit = (cfg, role, seed) => worldOwnMaterials(worldMaterials(cfg).map(m => m[role] ? {...m, seed} : m), cfg);
  let store = mergeWorldMaterials(undefined, edit(snow, 'worldGround', 7), snow);
  assert.deepEqual(store.map(m => [m.replaces, m.seed]), [['ice-ground', 7]]);
  assert.deepEqual(keptWorldMaterials(store, bergs), [], 'the other look names its own ground and keeps it');
  assert.equal(worldMaterials({...bergs, worldMaterials: keptWorldMaterials(store, bergs)}).find(m => m.worldGround).source, 'ice-bergs-ground');
  // An edit of the shared water on the other look joins the store without displacing the first look's ground, and both looks see it.
  store = mergeWorldMaterials(store, edit(bergs, 'worldWater', 5), bergs);
  assert.deepEqual(store.map(m => [m.replaces, m.seed]), [['ice-ground', 7], ['ice-water', 5]]);
  assert.deepEqual(keptWorldMaterials(store, snow).map(m => [m.replaces, m.seed]), [['ice-ground', 7], ['ice-water', 5]]);
  assert.deepEqual(keptWorldMaterials(store, bergs).map(m => m.replaces), ['ice-water']);
  // Back to the library's on one look removes only that look's own; an unmarked entry (a world file's) applies to any look;
  // a damaged entry is dropped.
  assert.deepEqual(mergeWorldMaterials(store, [], bergs).map(m => m.replaces), ['ice-ground']);
  const loose = worldMaterials(snow).filter(m => m.worldGround).map(m => ({...m, seed: 9}));
  assert.equal(keptWorldMaterials(loose, bergs)[0].seed, 9);
  assert.deepEqual(keptWorldMaterials([{worldGround: true, name: 'Broken', nodes: 'no'}, 4, null], snow), []);
});

test('materials round-trip through the clipboard text, the saved world and a world file', () => {
  const list = addMaterial(worldMaterials(config), {...LIBRARY['green-ground'], controls: [{label: 'Mottle', node: LIBRARY['green-ground'].nodes[1].id, param: 'size'}]}, 'Meadow').materials;
  const pasted = parseMaterialText(materialText(list[2])); assert.equal(pasted.name, 'Meadow'); assert.deepEqual(copyMaterial(pasted), copyMaterial(list[2]));
  assert.throws(() => parseMaterialText('{"format":"other"}'), /no material/);
  const world = savedWorld(config, new URLSearchParams(), {name: 'Mine', colors: {}, knobs: {}, materials: list});
  assert.deepEqual(world.materials, list.slice(0, 2), 'the saved world carries its ground and water; the map carries its own list');
  assert.deepEqual(copySavedWorld(JSON.parse(JSON.stringify(world)), config).materials, list.slice(0, 2));
  // A save from before materials (no list, or the earlier `grounds` key) loads with the world's own.
  const {materials, ...older} = world;
  assert.deepEqual(copySavedWorld({...older, grounds: [{slot: 1, name: 'Old preset', knobs: {}, ramp: []}]}, config).materials, worldMaterials(config));
  assert.throws(() => copySavedWorld({...world, materials: [{slot: 1, name: 'Broken', nodes: 'no'}]}, config), /at most 40 nodes|Invalid/);
});

test('Arrange places every node once, sources left of their readers, without overlaps', () => {
  for (const m of Object.values(LIBRARY)) {
    const places = graphPositions(m.nodes), byId = new Map(m.nodes.map(n => [n.id, n]));
    assert.equal(places.size, m.nodes.length);
    for (const n of m.nodes) for (const from of Object.values(n.in)) if (from) assert.ok(places.get(from).x < places.get(n.id).x, `${from} is left of ${n.id}`);
    const boxes = [...places].map(([id, p]) => ({...p, h: cardHeight(byId.get(id))}));
    for (const a of boxes) for (const b of boxes) if (a !== b && a.x === b.x) assert.ok(a.y + a.h <= b.y || b.y + b.h <= a.y, 'cards in a column do not overlap');
    assert.deepEqual(graphPositions(m.nodes), places, 'the layout is deterministic');
  }
  assert.ok(CARD.reach >= 12, 'ports are easy to grab');
});

test('the page declares every row the editor fills', () => {
  const page = readFileSync(new URL('../index.html', import.meta.url), 'utf8'), has = id => page.includes(`id="${id}"`);
  const most = Math.max(...Object.values(NODES).flatMap(spec => spec.kinds ? Object.keys(spec.kinds).map(k => spec.params(k).length) : [spec.params().length]));
  for (let i = 0; i < most; i++) assert.ok(has('node-param-' + i) && has('node-param-pin-' + i), 'a row for setting ' + i);
  for (let i = 0; i < Math.max(...Object.values(NODES).map(s => s.inputs.length)); i++) assert.ok(has('node-input-' + i));
  for (const list of ['ctl', 'wg', 'ww']) for (let i = 0; i < 12; i++) assert.ok(has(`${list}-${i}`) && has(`${list}-row-${i}`) && has(`${list}-color-${i}-7`), `${list} row ${i}`);
  for (const [type, spec] of Object.entries(NODES)) if (type !== 'output') assert.ok(page.includes(`data-type="${type}"`), `the add menu offers ${spec.label}`);
});

test('a map carried into another world takes its surfaces unless the artist edited them', () => {
  const moon = worldMaterials({materials: {ground: 'green-ground', water: 'green-water', rock: 'moon-rock', slope: 'moon-slope'}});
  const green = {materials: {ground: 'green-ground', water: 'green-water', rock: 'green-rock', slope: 'green-slope'}};
  const moved = adoptWorldMaterials(moon, green);
  assert.equal(moved.find(m => m.worldRock).source, 'green-rock'); assert.equal(moved.find(m => m.worldSlope).source, 'green-slope');
  const edited = moon.map(m => m.worldRock ? {...m, seed: m.seed + 1} : m);
  assert.equal(adoptWorldMaterials(edited, green).find(m => m.worldRock).source, 'moon-rock', 'an edited rock material stays the artist\'s');
});

test('a world’s highland material joins a new map, keeps its own role and leaves when assigned away', async () => {
  const {assignMaterial, materialsInUse} = await import('../sculpt-materials.js');
  const config = {materials: {ground: 'green-ground', water: 'green-water', high: 'crystal-ground'}};
  const list = withWorldMaterials(undefined, config), high = list.find(m => m.worldHigh);
  assert.equal(high?.source, 'crystal-ground');
  assert.ok(!high.worldGround && !high.worldWater);
  assert.ok(materialsInUse([], list).some(m => m.worldHigh), 'the renderer gets it with no stroke using it');
  assert.deepEqual(withWorldMaterials(undefined, {materials: {ground: 'green-ground', water: 'green-water'}}).filter(m => m.worldHigh), [], 'a world without one has none');
  assert.throws(() => copyMaterials(list.map(m => ({...m, worldHigh: true}))), /Only one/);
  const ground = list.find(m => m.worldGround);
  assert.throws(() => assignMaterial(list, ground.slot, 'worldHigh'), /Duplicate/);
  const moved = assignMaterial(list, high.slot, 'worldGround');
  assert.ok(!moved.some(m => m.worldHigh), 'a highland material made the ground stops being the highland');
});

test('the add-node menu names real types, and other editors’ names find them', () => {
  const page = readFileSync(new URL('../index.html', import.meta.url), 'utf8'), list = page.slice(page.indexOf('id="node-list"'), page.indexOf('</div>', page.indexOf('id="node-list"')));
  const entries = [...list.matchAll(/<button[^>]*data-type="([^"]+)"(?: data-kind="([^"]+)")?(?: data-keywords="([^"]*)")?>([^<]+)<\/button>/g)].map(([, type, kind, words, label]) => ({type, kind, words: words ?? '', label}));
  assert.ok(entries.length >= 25);
  for (const e of entries) { assert.ok(NODES[e.type], e.label); if (e.kind) assert.ok(Object.hasOwn(NODES[e.type].kinds ?? {}, e.kind), `${e.label}: ${e.kind}`); }
  const find = q => entries.filter(e => (e.label + ' ' + e.words).toLowerCase().includes(q)).map(e => `${e.type}:${e.kind ?? ''}`);
  for (const [q, want] of [['perlin', 'noise:gradient'], ['voronoi', 'noise:cells'], ['worley', 'noise:cracks'], ['tile sampler', 'stamp:'], ['bomber', 'stamp:'], ['hsl', 'adjust:'], ['posterize', 'levels:'],
    ['displace', 'warp:turbulence'], ['pixelate', 'warp:snap'], ['motion blur', 'blur:directional'], ['emboss', 'light:'], ['curvature', 'cavity:'], ['gradient map', 'gradient:']])
    assert.ok(find(q).includes(want), `“${q}” finds ${want}`);
  for (const [type, spec] of Object.entries(NODES)) for (const kind of Object.keys(spec.kinds ?? {})) if (!['combine'].includes(type)) assert.ok(entries.some(e => e.type === type && (e.kind === kind || (!e.kind && kind === Object.keys(spec.kinds)[0]))), `the menu offers ${spec.label} · ${spec.kinds[kind]}`);
});

test('every starting point joins a graph as valid, wired nodes, and its menu entry counts them', async () => {
  const {SNIPPETS, snippetNodes} = await import('../sculpt-materials.js');
  const page = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
  for (const [key, snippet] of Object.entries(SNIPPETS)) {
    const base = blankMaterial(), made = snippetNodes(key, base.nodes, {x: 100, y: 50});
    assert.equal(made.length, snippet.nodes.length, key);
    const m = copyMaterial({...base, nodes: [...base.nodes, ...made]});   // valid types, ranges and wiring
    assert.ok(programSource(compileMaterial(m)).main, key);
    const ids = new Set(base.nodes.map(n => n.id)); assert.ok(made.every(n => !ids.has(n.id)), `${key} takes fresh ids`);
    const wired = snippet.nodes.reduce((sum, n) => sum + Object.values(n.in ?? {}).filter(Boolean).length, 0);
    assert.equal(made.reduce((sum, n) => sum + Object.values(n.in).filter(v => made.some(o => o.id === v)).length, 0), wired, `${key} keeps its wiring`);
    assert.ok(page.includes(`data-snippet="${key}"`) && page.includes(`${snippet.name} (${snippet.nodes.length} nodes)`), `the menu offers ${snippet.name} with its count`);
  }
  // Twice into one graph: the second copy takes fresh ids again.
  const once = snippetNodes('cobbles', blankMaterial().nodes), twice = snippetNodes('cobbles', [...blankMaterial().nodes, ...once]);
  assert.ok(twice.every(n => !once.some(o => o.id === n.id)));
  assert.throws(() => snippetNodes('cobbles', Array.from({length: 38}, (_, i) => ({id: 'n' + i, params: {}}))), /at most 40/);
});

test('a material’s own Color moves every color step together, not the steps that scale it, and its palette with it', () => {
  const m = copyMaterial({nodes: [
    {id: 'n', type: 'noise'}, {id: 'g', type: 'gradient', in: {in: 'n'}, stops: [[0, .2, .3, .1], [1, .4, .5, .3]]},
    {id: 'shade', type: 'gradient', in: {in: 'n'}, stops: [[0, .8, .8, .8], [1, 1.2, 1.2, 1.2]]},
    {id: 'lit', type: 'combine', kind: 'multiply', in: {a: 'g', b: 'shade'}},
    {id: 'material', type: 'output', in: {color: 'lit'}}], palette: [10, 20, 30]});
  assert.deepEqual(colorSources(m).map(n => n.id), ['g'], 'a multiplier is not a color source');
  const red = recolorMaterial(m, [.7, .2, .1]);
  assert.deepEqual(materialColor(red).map(v => +v.toFixed(6)), [.7, .2, .1]);
  const g = red.nodes.find(n => n.id === 'g').stops;
  assert.ok(Math.abs((g[1][1] - g[0][1]) - .2) < 1e-9, 'the steps keep their differences');
  assert.deepEqual(red.nodes.find(n => n.id === 'shade').stops, m.nodes.find(n => n.id === 'shade').stops);
  assert.notDeepEqual(red.palette, m.palette, 'the palette moves with it');
  for (const key of Object.keys(LIBRARY)) assert.ok(colorSources(LIBRARY[key]).length, `${key} has a color to set`);
});
