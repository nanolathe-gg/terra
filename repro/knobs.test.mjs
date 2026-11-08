// The World panel's knob path (sculpt-knobs.js), which the page's setKnob and the headless host share: what a knob's change sets and what it
// asks the host to run again, the Colors panel's rows and picks, and the panel facts a stroke's water choices turn on.
import test from 'node:test';
import assert from 'node:assert/strict';
import {KNOBS, applyKnob, colorRows, pickWorldColor, strokeWaterPicks, worldPanelValues} from '../sculpt-knobs.js';

const renderer = () => ({variant: new Map(), applied: 0, applyKnobs() { this.applied++; }, transitionBody: false, groundTiled: false});

test('a knob goes into the address and the renderer, and says what else it needs', () => {
  const settings = new URLSearchParams(), r = renderer(), nodes = [{kind: 'ground', amplitude: 10, wavelength: 200, coverage: .45, seed: 1}, {kind: 'landform', points: []}];
  assert.deepEqual(applyKnob({key: 'reliefAmount', value: '.7', settings, renderer: r, nodes, seed: 2701}), {});
  assert.equal(settings.get('reliefAmount'), '.7'); assert.equal(r.variant.get('reliefAmount'), '.7'); assert.equal(r.applied, 1);
  assert.deepEqual(applyKnob({key: 'undulationScale', value: '160', settings, renderer: r, nodes, seed: 2701}), {evaluate: 0, checkpoint: true, weather: true});
  assert.equal(nodes[0].wavelength, 160);
  assert.deepEqual(applyKnob({key: 'frostGaps', value: '1', settings, renderer: r, nodes, seed: 2701}), {evaluate: 0, weather: true});
  assert.deepEqual(applyKnob({key: 'sand', value: '1', settings, renderer: r, nodes, seed: 2701}), {weather: true});
  // The ground textures are chosen when the renderer starts: the address changes, the renderer does not.
  const applied = r.applied;
  assert.deepEqual(applyKnob({key: 'groundPattern', value: 'lava', settings, renderer: r, nodes, seed: 2701}), {reload: true});
  assert.equal(settings.get('groundPattern'), 'lava'); assert.equal(r.variant.has('groundPattern'), false); assert.equal(r.applied, applied);
});

test('Undulation height puts a ground node first on a map without one, and only when it turns on', () => {
  const settings = new URLSearchParams(), r = renderer(), nodes = [{kind: 'landform', points: []}];
  assert.deepEqual(applyKnob({key: 'undulation', value: '0', settings, renderer: r, nodes, seed: 2701}), {});
  assert.equal(nodes.length, 1);
  assert.deepEqual(applyKnob({key: 'undulation', value: '6', settings, renderer: r, nodes, seed: 2701}), {evaluate: 0, checkpoint: true, weather: true});
  assert.deepEqual(nodes[0], {kind: 'ground', amplitude: 6, wavelength: 160, seed: 2701 ^ 0x9e37});
});

test('every knob row has a label, a range and a default', () => {
  const keys = KNOBS.flatMap(([, list]) => list.map(k => k[0]));
  assert.equal(new Set(keys).size, keys.length, 'a knob in two groups');
  for (const [title, list] of KNOBS) for (const [key, label, min, max, step, value] of list) {
    assert.ok(title && label, key); assert.ok(min <= value && value <= max && step > 0, `${key}: ${min} ${value} ${max} ${step}`);
  }
});

test('the Colors panel shows the rows a world has, and a cleared row the server sets stays off', () => {
  const config = {layers: ['body'], material: {groundCover: {plants: {flowers: {palette: [[1, 2, 3, 1]]}}}}, colors: {sun: '#ffffff'}};
  const labels = colorRows(config, new URLSearchParams()).map(([, l]) => l);
  assert.ok(labels.includes('Flower 1') && !labels.includes('Flower 2') && !labels.includes('Beach') && !labels.includes('Strata 1'));
  assert.ok(colorRows({...config, layers: ['beach']}, new URLSearchParams('strata=1')).some(([k]) => k === 'beach' || k === 'strata1'));
  assert.deepEqual(pickWorldColor(config, {ground: '#101010'}, 'shallow', '#c03030'), {ground: '#101010', shallow: '#c03030'});
  assert.deepEqual(pickWorldColor(config, {sun: '#ffc880'}, 'sun', null), {sun: null});
  assert.deepEqual(pickWorldColor(config, {shallow: '#c03030'}, 'shallow', null), {});
});

test("a stroke's water choices count as the world switches they turn on", () => {
  const nodes = [{kind: 'ground'}, {kind: 'landform', params: {waterDeep: 2, waterBed: 3}}];
  assert.deepEqual(strokeWaterPicks(nodes), {deepEdge: 0, fadedEdge: 1, bedLit: 1, crackedBed: 1});
  const r = renderer(); r.variant.set('deepEdge', '1');
  const v = worldPanelValues({config: {layers: ['ring'], water: {}}, renderer: r, nodes, colors: {shallow: [1, 0, 0]}, weathering: true, materialWeathering: 0});
  assert.equal(v.deepEdge, 1); assert.equal(v.rampWater, 1); assert.equal(v.bedLit, 1); assert.equal(v.crackedBed, 1);
  assert.equal(v.waterColored, 1); assert.equal(v.waterTones, 2); assert.equal(v.ringLayer, 1); assert.equal(v.beachLayer, 0);
});

test('the column facts follow the active column: the map\'s own, its variant row, or none', () => {
  const facts = column => worldPanelValues({config: {layers: [], water: {}, column, variant: 'triad'}, renderer: renderer(), nodes: [], colors: {}, weathering: false, materialWeathering: 0});
  assert.equal(facts(undefined).column, 0, 'a world without a column');
  assert.equal(facts({bands: [3.7, 1]}).column, 0, 'contour bands alone are no column');
  assert.equal(facts({bands: [3.7, 1], sections: [{start: 0, beds: [[5, .8, 0], [7, .3, 1]]}]}).column, 1, 'a column the map added');
  assert.equal(facts({sections: []}).column, 0, 'every section removed');
  // A variant's row replaces the sections: emptied there, the world's own no longer draw.
  const rows = {sections: [{start: 0, beds: [[.3, .5, 0], [5.7, .5, 1]]}], variants: {triad: {sections: []}}};
  assert.equal(facts(rows).column, 0); assert.equal(facts(rows).capBed, 0);
  rows.variants.triad.sections = [{start: 0, beds: [[.3, .5, 0], [5.7, .5, 1]]}];
  assert.equal(facts(rows).column, 1); assert.equal(facts(rows).capBed, 1);
});

test('the rock facts are the world\'s own, and a Rock type draws with its own numbers', async () => {
  const {ROCK_TYPES, rockPreset} = await import('../sculpt-material-model.js');
  const facts = rock => worldPanelValues({config: {layers: [], water: {}, material: {rock}}, renderer: renderer(), nodes: [], colors: {}, weathering: false, materialWeathering: 0});
  assert.deepEqual([facts(undefined).rockCells, facts(undefined).rockJoint, facts(undefined).rockCurtains], [0, 2, 0], 'no rock: no blocks, the model\'s joint lines');
  assert.deepEqual([facts({joint: 3}).rockCells, facts({joint: 3}).rockJoint], [0, 3]);
  assert.equal(facts({size: 4.6, joint: 0}).rockCells, 1);
  const own = {size: 4.6}, at = t => rockPreset({rock: own}, new Map([['rockType', String(t)]]));
  assert.equal(at(0), own); assert.equal(rockPreset({}, new Map()).size, undefined);
  assert.equal(at(1), ROCK_TYPES[0].rock); assert.equal(at(1).size, 22, 'Granite is modern Green\'s');
  assert.equal(at(ROCK_TYPES.length), ROCK_TYPES.at(-1).rock); assert.equal(at(ROCK_TYPES.length + 1), own, 'an unknown type is the world\'s own');
  assert.equal(KNOBS.flatMap(([, l]) => l).find(k => k[0] === 'rockType')[3], ROCK_TYPES.length, 'the row offers every type');
  assert.ok(ROCK_TYPES.some(t => t.rock.joint > 0) && ROCK_TYPES.some(t => t.rock.curtain > 0) && ROCK_TYPES.every(t => t.rock.size > 0));
});
