// The map's generated feature set (sculpt-feature-set.js): the recipe a save keeps, its bounds, and the variants it draws.
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {worldKinds, defaultSet, normalizeSet, variants, pickVariant, normalizePlacement, MAX_VARIANTS} from '../sculpt-feature-set.js';
import {generateFeature} from '../sculpt-feature-gen.js';
const palette = JSON.parse(readFileSync(new URL('../materials/palette.json', import.meta.url))).indexed;

const table = world => JSON.parse(readFileSync(new URL(`../materials/${world}.json`, import.meta.url), 'utf8'));
const green = {features: table('green').features}, bare = {};

test('every world has deposits and vents; trees, shrubs, rocks and scars come from the world table', () => {
  assert.deepEqual(worldKinds(green), ['deposit', 'vent', 'tree', 'shrub', 'rock', 'scar']);
  assert.deepEqual(worldKinds(bare), ['deposit', 'vent']);
  const kinds = {red: ['tree', 'rock', 'scar'], moon: ['rock'], archipelago: ['tree', 'shrub'], desert: ['rock'], lava: ['rock', 'scar'], ice: ['rock'], crystal: ['rock'], zhon: []};
  for (const [world, own] of Object.entries(kinds)) assert.deepEqual(worldKinds({features: table(world).features}), ['deposit', 'vent', ...own], world);
});

test("a world's deposit and vent look reaches the painter; footprints take any size", () => {
  const red = {features: table('red').features}, lava = {features: table('lava').features};
  assert.equal(variants('deposit', defaultSet(red), red)[0].params.halo, 0.9);
  assert.equal(variants('vent', defaultSet(lava), lava)[0].params.rim, 0.55);
  assert.equal(variants('deposit', defaultSet(green), green)[0].params.halo, undefined);   // Green's look is the painter's default
  assert.deepEqual(variants('tree', defaultSet(red), red)[0].footprint, [2, 2]);
  const spire = variants('rock', defaultSet(lava), lava).find(v => v.params.tall === 1);
  assert.deepEqual(spire.footprint, [6, 5]); assert.equal(spire.params.metal, 0);
});

test('a saved recipe is kept to the world kinds and the settings bounds', () => {
  const set = normalizeSet({tree: {count: 99, seed: 7, taper: 3, energy: [900, -5]}, rock: {metal: [300, 10], shade: 'x'}, deposit: {metal: 1000}, lava: {count: 2}}, green);
  assert.equal(set.tree.count, MAX_VARIANTS); assert.equal(set.tree.seed, 7); assert.equal(set.tree.taper, 1); assert.deepEqual(set.tree.energy, [0, 900]);
  assert.deepEqual(set.rock.metal, [10, 255]); assert.equal(set.rock.shade, defaultSet(green).rock.shade); assert.equal(set.deposit.metal, 255);
  assert.equal(set.lava, undefined);
  assert.deepEqual(normalizeSet(undefined, green), defaultSet(green));
  assert.deepEqual(Object.keys(normalizeSet({tree: {count: 3}}, bare)), ['deposit', 'vent']);
});

test('variants keep their looks when the count grows, and placement keeps retail use shares', () => {
  for (const kind of worldKinds(green)) {
    const set = defaultSet(green), small = variants(kind, set, green), large = variants(kind, {...set, [kind]: {...set[kind], count: MAX_VARIANTS}}, green);
    assert.deepEqual(large.slice(0, small.length), small.map(v => ({...v, weight: large[v.index].weight})), kind);
    const types = new Set(green.features[kind]?.types.map((t, i) => i) || [0]);
    for (const t of types) if (large.length >= types.size) assert.ok(large.some(v => v.type === t), `${kind}: every type has a variant`);
    // A weighted pick over many cells reproduces each type's share.
    const counts = new Map(), n = 20000;
    for (let i = 0; i < n; i++) { const v = large[pickVariant(large, (i + 0.5) / n)]; counts.set(v.type, (counts.get(v.type) || 0) + 1); }
    const shares = green.features[kind]?.types || [{share: 1}], total = shares.reduce((s, t) => s + t.share, 0);
    shares.forEach((t, i) => assert.ok(Math.abs((counts.get(i) || 0) / n - t.share / total) < 0.01, `${kind} type ${i}`));
  }
});

test('a new seed redraws every variant; rock metal follows footprint across the range', () => {
  const set = defaultSet(green), a = variants('tree', set, green), b = variants('tree', {...set, tree: {...set.tree, seed: 99}}, green);
  assert.ok(a.every((v, i) => v.seed !== b[i].seed));
  const rocks = variants('rock', {...set, rock: {...set.rock, count: 5, metal: [20, 120]}}, green);
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
    if (kind === 'tree') assert.ok(full.burn && !view.burn && !view.burnt);
  }
});

test('placements: a retail placement (a name, no kind) is not a generated one; deposits keep their own metal', () => {
  assert.equal(normalizePlacement({name: 'Tree1', x: 4, z: 5}), null);
  assert.deepEqual(normalizePlacement({kind: 'deposit', v: 2, x: 4, z: 5, metal: 999}), {kind: 'deposit', v: 2, x: 4, z: 5, metal: 255});
  assert.deepEqual(normalizePlacement({kind: 'tree', v: -1, x: 1, z: 2, metal: 7}), {kind: 'tree', v: 0, x: 1, z: 2});
  assert.equal(normalizePlacement({kind: 'tree', x: 1.5, z: 2}), null);
});

test('the artist colors and rock angularity: bounds, the world default, and a recolor only once a color moves', () => {
  const set = normalizeSet({tree: {color: '#ABCDEF'}, shrub: {color: 'red'}, rock: {angular: 3, color: '#123'}}, green), d = defaultSet(green);
  assert.equal(set.tree.color, '#abcdef'); assert.equal(set.shrub.color, d.shrub.color); assert.equal(set.rock.angular, 1); assert.equal(set.rock.color, d.rock.color);
  for (const kind of ['tree', 'shrub', 'rock']) assert.ok(variants(kind, d, green).every(v => !v.params.recolor), kind);
  const red = {features: table('red').features};
  assert.ok(variants('rock', defaultSet(red), red).every(v => !v.params.recolor && v.params.angular === 0.45));
  assert.deepEqual(variants('tree', {...d, tree: {...d.tree, color: '#b8732a'}}, green)[0].params.recolor, {from: '#11723c', to: '#b8732a'});
  assert.equal(variants('rock', {...d, rock: {...d.rock, angular: 0.1}}, green)[0].params.angular, 0.1);
});
