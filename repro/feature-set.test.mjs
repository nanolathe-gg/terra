// The map's generated feature set (sculpt-feature-set.js): the recipe a save keeps, its bounds, and the variants it draws.
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {worldKinds, defaultSet, normalizeSet, variants, pickVariant, normalizePlacement, MAX_VARIANTS, makeRecipe, featureCatalog, recipeId} from '../sculpt-feature-set.js';
import {generateFeature} from '../sculpt-feature-gen.js';
const palette = JSON.parse(readFileSync(new URL('../materials/palette.json', import.meta.url))).indexed;

const table = world => JSON.parse(readFileSync(new URL(`../materials/${world}.json`, import.meta.url), 'utf8'));
const green = {features: table('green').features}, bare = {};
const edit = (set,kind,values) => ({...set,[kind]:{...set[kind],recipes:set[kind].recipes.map((r,i)=>i===0?{...r,...values}:r)}});
const input = (values,config=green) => Object.entries(values).reduce((set,[kind,v])=>set[kind]?edit(set,kind,v):set,defaultSet(config));

test('every world has deposits and vents; trees, shrubs, rocks and scars come from the world table', () => {
  assert.deepEqual(worldKinds(green), ['deposit', 'vent', 'tree', 'shrub', 'rock', 'scar']);
  assert.deepEqual(worldKinds(bare), ['deposit', 'vent']);
  const kinds = {red: ['tree', 'rock', 'scar'], moon: ['rock'], archipelago: ['tree', 'shrub', 'scar'], desert: ['rock'], lava: ['rock', 'scar'], ice: ['rock'], crystal: ['rock'], zhon: ['tree', 'shrub', 'rock', 'scar']};
  for (const [world, own] of Object.entries(kinds)) assert.deepEqual(worldKinds({features: table(world).features}), ['deposit', 'vent', ...own], world);
});

test("a world's deposit and vent look reaches the painter; footprints take any size", () => {
  const red = {features: table('red').features}, lava = {features: table('lava').features};
  assert.equal(variants('deposit', defaultSet(red), red)[0].params.halo, red.features.deposit.params.halo);
  assert.equal(variants('vent', defaultSet(lava), lava)[0].params.rim, lava.features.vent.params.rim);
  assert.equal(variants('deposit', defaultSet(green), green)[0].params.halo, undefined);   // Green's look is the painter's default
  assert.deepEqual(variants('tree', defaultSet(red), red)[0].footprint, [2, 2]);
  const spire = variants('rock', defaultSet(lava), lava).find(v => v.params.tall === 1);
  assert.deepEqual(spire.footprint, [6, 5]); assert.equal(spire.params.metal, 0);
});

test('a saved recipe is kept to the world kinds and the settings bounds', () => {
  const set = normalizeSet(input({tree: {count: 99, seed: 7, taper: 3, energy: [900, -5]}, rock: {metal: [300, 10], shade: 'x'}, deposit: {metal: 1000}}), green);
  assert.equal(set.tree.recipes[0].count, MAX_VARIANTS); assert.equal(set.tree.recipes[0].seed, 7); assert.equal(set.tree.recipes[0].taper, 1); assert.deepEqual(set.tree.recipes[0].energy, [0, 900]);
  assert.deepEqual(set.rock.recipes[0].metal, [10, 255]); assert.equal(set.rock.recipes[0].shade, defaultSet(green).rock.recipes[0].shade); assert.equal(set.deposit.recipes[0].metal, 255);
  assert.equal(set.lava, undefined);
  assert.deepEqual(normalizeSet(undefined, green), defaultSet(green));
  assert.deepEqual(Object.keys(normalizeSet({tree: {count: 3}}, bare)), ['deposit', 'vent']);
});

test('variants keep their looks when the count grows, and placement keeps retail use shares', () => {
  for (const kind of worldKinds(green)) {
    const set = defaultSet(green), small = variants(kind, set, green), large = variants(kind, {...set, [kind]: {...set[kind], count: MAX_VARIANTS, makeRecipe, featureCatalog, recipeId}}, green);
    assert.deepEqual(large.slice(0, small.length), small.map(v => ({...v, weight: large[v.index].weight})), kind);
    const types = new Set(green.features[kind]?.types?.map((t, i) => i) || [0]);
    for (const t of types) if (large.length >= types.size) assert.ok(large.some(v => v.type === t), `${kind}: every type has a variant`);
    // A weighted pick over many cells reproduces each type's share.
    const counts = new Map(), n = 20000;
    for (let i = 0; i < n; i++) { const v = large[pickVariant(large, (i + 0.5) / n)]; counts.set(v.type, (counts.get(v.type) || 0) + 1); }
    const shares = green.features[kind]?.types || [{share: 1}], total = shares.reduce((s, t) => s + t.share, 0);
    shares.forEach((t, i) => assert.ok(Math.abs((counts.get(i) || 0) / n - t.share / total) < 0.01, `${kind} type ${i}`));
  }
});

test('a new seed redraws every variant; rock metal follows footprint across the range', () => {
  const set = defaultSet(green), a = variants('tree', set, green), b = variants('tree', edit(set,'tree',{seed:99}), green);
  assert.ok(a.every((v, i) => v.seed !== b[i].seed));
  const rocks = variants('rock', edit(set,'rock',{count:5,metal:[20,120]}), green);
  const metal = Object.fromEntries(rocks.map(v => [v.params.cells, v.params.metal]));
  assert.deepEqual(metal, {'1x1': 20, '2x2': 58, '3x3': 120, '3x2': 83, '4x3': 120});
  assert.deepEqual(variants('deposit', set, green)[0].footprint, [3, 3]);
});

test('the view draws the same body and shadow as the export, without burn frames', () => {
  const set = defaultSet(green);
  for (const kind of ['tree', 'shrub', 'rock', 'scar']) for (const v of variants(kind, set, green).slice(0, 3)) {
    const full = generateFeature(kind, v.params, v.seed, {light: {x: -0.62, y: -0.03}, palette}), view = generateFeature(kind, v.params, v.seed, {light: {x: -0.62, y: -0.03}, bodyOnly: true, palette});
    for (const part of ['body', 'shadow']) assert.deepEqual(view[part] && [...view[part].idx, ...view[part].a, view[part].ax, view[part].ay], full[part] && [...full[part].idx, ...full[part].a, full[part].ax, full[part].ay], `${kind} ${part}`);
    assert.deepEqual(view.gameplay, full.gameplay);
    if (kind === 'tree' && !String(v.params.species).startsWith('dead')) assert.ok(full.burn && !view.burn && !view.burnt);
    if (String(v.params.species).startsWith('dead')) assert.ok(!full.burn && !full.burnt);   // a dead tree neither burns nor leaves a successor
  }
});

test('placements: a retail placement (a name, no kind) is not a generated one; deposits keep their own metal', () => {
  assert.equal(normalizePlacement({name: 'Tree1', x: 4, z: 5}), null);
  assert.deepEqual(normalizePlacement({kind: 'deposit', v: 2, x: 4, z: 5, metal: 999}), {kind: 'deposit', v: 2, x: 4, z: 5, metal: 255});
  assert.deepEqual(normalizePlacement({kind: 'tree', v: -1, x: 1, z: 2, metal: 7}), {kind: 'tree', v: 0, x: 1, z: 2});
  assert.equal(normalizePlacement({kind: 'tree', x: 1.5, z: 2}), null);
});

test('the artist colors and rock angularity: bounds, the world default, and a recolor only once a color moves', () => {
  const set = normalizeSet(input({tree: {color: '#ABCDEF'}, shrub: {color: 'red'}, rock: {angular: 3, color: '#123'}}), green), d = defaultSet(green);
  assert.equal(set.tree.recipes[0].color, '#abcdef'); assert.equal(set.shrub.recipes[0].color, d.shrub.recipes[0].color); assert.equal(set.rock.recipes[0].angular, 1); assert.equal(set.rock.recipes[0].color, d.rock.recipes[0].color);
  for (const kind of ['tree', 'shrub', 'rock']) assert.ok(variants(kind, d, green).every(v => !v.params.recolor), kind);
  const red = {features: table('red').features};
  assert.ok(variants('rock', defaultSet(red), red).every(v => !v.params.recolor && v.params.angular === 0.45));
  assert.deepEqual(variants('tree', edit(d,'tree',{color:'#b8732a'}), green)[0].params.recolor, {from: '#11723c', to: '#b8732a'});
  assert.equal(variants('rock', edit(d,'rock',{angular:0.1}), green)[0].params.angular, 0.1);
});

// Initial stock recipes and edited recipes use the same save representation as a loaded map.
test('feature sets are fixed points before and after save/load', () => {
  for (const world of ['green','red','moon','archipelago','desert','lava','ice','crystal','zhon']) {
    const config={features:table(world).features};
    const stock=normalizeSet(undefined,config);
    assert.deepEqual(normalizeSet(JSON.parse(JSON.stringify(stock)),config),stock,world);
    const edited=edit(stock,'deposit',{count:7,seed:12345,weight:2.4,metal:211});
    assert.deepEqual(normalizeSet(JSON.parse(JSON.stringify(edited)),config),edited,world+' edited');
  }
});
