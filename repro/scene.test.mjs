// The scene builder (sculpt-scene.js), which the page and the headless runner share: the node list a scripted scene makes, and the surface
// sliders' opening values, whose ranges must be sculpt.html's own (the browser clamps and snaps a slider to them).
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {sceneNodes, pageSettings, surfaceSliders, drawOptions, sliderRange, SURFACE_SLIDER_IDS, DEFAULT_SEED, strokeKind} from '../sculpt-scene.js';
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
});

test('a stroke\'s palette entry is the button whose preset draws its section form', () => {
  assert.equal(landformTool({curve: {form: 'lfCrater'}, heightReference: 2, elevation: -20}), 'crater');
  assert.equal(landformTool({curve: {form: 'lfCrystal'}, iceFacets: .6, facetForm: 2}), 'crystal');
  // Facets never move a stroke to the Crystals button: a faceted hill is a Hill.
  assert.equal(landformTool({curve: {form: 'lfHill'}, iceFacets: 1, facetForm: 1}), 'hill');
  assert.equal(landformTool({curve: {form: 'lfPlateau'}, iceFacets: 1, facetForm: 2}), 'plateau');
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
