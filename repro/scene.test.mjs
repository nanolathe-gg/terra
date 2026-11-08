// The scene builder (sculpt-scene.js), which the page and the headless runner share: the node list a scripted scene makes, and the surface
// sliders' opening values, whose ranges must be sculpt.html's own (the browser clamps and snaps a slider to them).
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {sceneNodes, pageSettings, shapeContext, surfaceSliders, drawOptions, sliderRange, SURFACE_SLIDER_IDS, DEFAULT_SEED, strokeKind, savedToolCard, toolDefaults} from '../sculpt-scene.js';
import {landformTool} from '../sculpt-shape-presets.js';

const root = new URL('..', import.meta.url).pathname;
const config = {biomeId: 'green', baseHeight: 99, seaLevel: 75, size: 2336, worldSize: 2336, map: {width: 2080, height: 2176},
  defaults: {undulation: 10, undulationScale: 200, undulationCover: .45, lean: 0}, material: {surfaceRelief: 1.12, materialWeathering: 0}};

test('a scene is the ground undulation, then one node per stroke with its seed', () => {
  const nodes = sceneNodes(config, [['hill', [[100, 100], [300, 120]], {card: {diameter: 240}}], ['fissure', [[500, 500]], {}]], {settings: pageSettings(config)});
  assert.deepEqual(nodes.map(n => n.kind), ['ground', 'landform', 'fissure']);
  assert.equal(nodes[0].seed, DEFAULT_SEED ^ 0x9e37);
  assert.deepEqual(nodes.slice(1).map(n => n.seed), [DEFAULT_SEED, (DEFAULT_SEED + 7919) >>> 0]);
  assert.equal(nodes[1].params.radius, 120);
  assert.equal(strokeKind('hill'), 'landform');
  assert.deepEqual(sceneNodes(config, [['fissure', [[0, 0]], {}]], {ground: false}).map(n => n.kind), ['fissure']);
  // lfcrater: the Crater button draws a landform from its preset (a signed section dug into the ground).
  assert.equal(strokeKind('crater'), 'landform');
  assert.equal(sceneNodes(config, [['crater', [[0, 0]], {}]], {ground: false})[0].params.heightReference, 2);
  assert.deepEqual(sceneNodes(config, [['hill', [[1, 2]], {}]]), sceneNodes(config, [['hill', [[1, 2]], {}]]), 'the same strokes give the same nodes');
  // The shape context's coast ramp: the world's, the address's, or (a world without one) the sections as drawn.
  assert.equal(shapeContext({config, settings: pageSettings(config), seed: 1}).coastRamp, 1);
  assert.equal(shapeContext({config, settings: pageSettings(config, 'coastRamp=.25'), seed: 1}).coastRamp, .25);
  assert.equal(shapeContext({config: {...config, defaults: {...config.defaults, coastRamp: .5}}, settings: pageSettings({defaults: {}}), seed: 1}).coastRamp, .5);
  // The ground node carries Undulation in the art: all of it unless the page says less.
  assert.equal(nodes[0].art, 1);
  assert.equal(sceneNodes(config, [], {settings: pageSettings(config, 'undulationArt=0')})[0].art, 0);
});

test('the page keeps only the kinds it draws', () => {
  // sculpt.js deserializeNodes keeps a saved node only if NODE_NAMES names its kind: the Crater and Crystals buttons draw landforms.
  const page = readFileSync(`${root}sculpt.js`, 'utf8'), names = page.match(/const NODE_NAMES=\{([^}]*)\}/)[1];
  assert.deepEqual([...names.matchAll(/(\w+):/g)].map(m => m[1]).sort(), ['erase', 'fissure', 'grass', 'ground', 'landform', 'paint', 'sand', 'smooth']);
});

test('a save\'s brush card counts only if this editor made it', () => {
  // An old save's Crater card (the retired tool's, which held craterlets and Fixed elevation 169) must not outvote the Crater preset.
  const fresh = toolDefaults(config, 'crater');
  assert.equal(fresh.heightReference, 2);
  const mine = {...fresh, elevation: -30, preset: 'custom', curve: fresh.curve, along: null};
  assert.equal(savedToolCard(config, 'crater', mine), mine, 'a card this editor made, with the artist\'s changes, is kept');
  assert.equal(savedToolCard(config, 'crater', {...fresh, preset: 'custom', heightReference: 0, elevation: 169, craterlets: 5}), null, 'a card holding a removed option starts from the preset');
  assert.deepEqual(savedToolCard(config, 'crater', {...fresh, heightReference: 0, elevation: 169, craterlets: 5}), fresh, 'so does one still on the preset');
  assert.equal(savedToolCard(config, 'plateau', {shallowMode: false, elevation: 3}), null, 'the November 3 retired tools\' cards too');
  assert.equal(savedToolCard(config, 'crater', undefined), null);
  // lfimpact2: a card saved by main e98bf1f7 (before the Buckling and Secondaries' distance rows) holds no key since removed, so it is kept and takes the new
  // rows from the preset.
  const older = Object.fromEntries(Object.entries(mine).filter(([k]) => !['buckling', 'secondaryDistance'].includes(k)));
  assert.equal(savedToolCard(config, 'crater', older), older, 'a card from before the two impact rows is kept');
  for (const entry of ['plateau', 'crater', 'crystal', 'river', 'fissure', 'paint', 'erase']) {
    const card = toolDefaults(config, entry);
    assert.deepEqual(savedToolCard(config, entry, card), card, `${entry}: today's own card is kept`);
  }
  // A card still on a world's preset was never edited, so it is that preset as it is today: a working map saved before Shallow water's Shelf section
  // draws the Shelf. A card the artist changed (custom) keeps its own curve; a card on another world's preset keeps that world's.
  const before = {...toolDefaults(config, 'shallow'), curve: {form: 'lfShore', knots: [[0, 0], [.9, 1], [1, 1]]}};
  assert.equal(savedToolCard(config, 'shallow', before).curve.form, 'lfShelf');
  assert.equal(savedToolCard(config, 'shallow', {...before, preset: 'custom'}).curve.form, 'lfShore');
  assert.deepEqual(savedToolCard(config, 'deep', {...toolDefaults(config, 'deep', 'red'), diameter: 999}), toolDefaults(config, 'deep', 'red'));
});

test('a stroke\'s palette entry is the button whose preset draws its section form', () => {
  assert.equal(landformTool({curve: {form: 'lfCrater'}, heightReference: 2, elevation: -20}), 'crater');
  assert.equal(landformTool({curve: {form: 'lfCrystal'}, iceFacets: .6, facetForm: 2}), 'crystal');
  // Facets never move a stroke to the Crystals button: a faceted hill is a Hill.
  assert.equal(landformTool({curve: {form: 'lfHill'}, iceFacets: 1, facetForm: 1}), 'hill');
  assert.equal(landformTool({curve: {form: 'lfPlateau'}, iceFacets: 1, facetForm: 2}), 'plateau');
  // Shallow water draws the Shelf section; a Shore that does not cut (an older Shallow stroke) is still Shallow water.
  assert.equal(sceneNodes(config, [['shallow', [[0, 0], [0, 200]], {}]], {ground: false})[0].params.curve.form, 'lfShelf');
  assert.equal(landformTool({curve: {form: 'lfShelf'}, combine: 2}), 'shallow');
  assert.equal(landformTool({curve: {form: 'lfShore'}, combine: 2}), 'shallow');
  assert.equal(landformTool({curve: {form: 'lfShore'}, combine: 1}), 'deep');
  assert.equal(strokeKind('crystal'), 'landform');
  assert.equal(sceneNodes(config, [['crystal', [[0, 0]], {}]], {ground: false})[0].params.curve.form, 'lfCrystal');
});

test('the surface sliders open where the browser puts them, and their ranges are sculpt.html\'s', () => {
  const html = readFileSync(`${root}sculpt.html`, 'utf8');
  for (const id of SURFACE_SLIDER_IDS) {
    const tag = html.match(new RegExp(`<input id="${id}"[^>]*>`))?.[0];
    assert.ok(tag, `${id} is in sculpt.html`);
    const attr = name => Number(tag.match(new RegExp(`${name}="([^"]+)"`))[1]);
    assert.deepEqual(sliderRange(id), [attr('min'), attr('max'), attr('step')], `${id}: min, max and step`);
  }
  const s = surfaceSliders(config, pageSettings(config, 'ringSpread=.3'));
  assert.equal(s.relief, 110, 'surfaceRelief 1.12 snaps to the relief slider\'s step of 5');
  assert.equal(s['ring-spread'], 30, 'the address sets a ring slider');
  assert.equal(drawOptions(s).detail, 1.1);
});
