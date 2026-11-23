// A world's shape tools as data: its table's world.tools (the toolbar's shape buttons, in order) and world.shapes (its numbers over the shape
// library, by shape name), served as config.tools and config.worldShapes (the Go site tool).
import test from 'node:test';
import assert from 'node:assert/strict';
import {runSite} from './site-cli.mjs';
import {mkdtempSync, readFileSync, readdirSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {LANDFORM_SHAPES, toolDefaults, sceneNodes, pageSettings, strokeCard, strokeParams} from '../sculpt-scene.js';
import {worldRocks, applyWorldRock} from '../sculpt-rock-presets.js';
import {LANDFORM_TOOL, MAP_TOOLS_MAX, worldTools, starterTools, toolShape, toolRockSlot, strokeTool, keepStrokeTools, inferStrokeTools, carryStrokes, markEdited, copyMapTools, addMapTool, deleteMapTool, nextMapToolId, CARD_KEYS} from '../sculpt-tools.js';

const root = new URL('..', import.meta.url).pathname, dir = mkdtempSync(join(tmpdir(), 'tools-test-'));
runSite(['--dump-configs', dir]);
const files = readdirSync(join(dir, 'config')).filter(f => f !== 'catalog.json' && f !== 'editor.json').sort();
const configs = Object.fromEntries(files.map(f => [f.replace(/\.json$/, ''), JSON.parse(readFileSync(join(dir, 'config', f), 'utf8'))]));
const WORLDS = ['green', 'red', 'archipelago', 'moon', 'lush', 'lava', 'desert', 'crystal', 'ice'];
const ENTRIES = [...Object.keys(LANDFORM_SHAPES).filter(k => k !== 'landform'), 'landform', 'fissure', 'smooth', 'erase', 'paint', 'sand', 'grass', 'move'];
test('every world defines valid library shapes and cards', async () => {
  const {shapeFrom} = await import('../sculpt-scene.js');
  for (const [name, config] of Object.entries(configs)) {
    assert.deepEqual(Object.keys(config.worldShapes), WORLDS, name);
    assert.deepEqual(Object.keys(config.biomeDescriptions), WORLDS, `${name}: a line per world for Start a map (site.json), in the picker's order`);
    for (const w of WORLDS) {
      const keys = Object.keys(config.worldShapes[w]);
      assert.ok(Object.keys(LANDFORM_SHAPES).every(k => keys.includes(k)), `${name}: ${w} defines every library shape`);
      for (const k of keys.filter(k => !Object.hasOwn(LANDFORM_SHAPES, k))) assert.notEqual(shapeFrom({worldShapes: config.worldShapes}, k, w), k, `${w}'s own shape ${k} comes from a library shape`);
    }
  }
  // A map tool saved from any of them holds only settings a card may hold (sculpt-tools.js copyMapTools).
  for (const w of WORLDS) for (const entry of ENTRIES) for (const key of Object.keys(toolDefaults(configs[w], entry))) assert.ok(CARD_KEYS.has(key), `${w} ${entry}: ${key}`);
});

test('a default Red ramp reaches the default plateau elevation', () => {
  const ramp = toolDefaults(configs.red, 'ramp');
  const plateau = toolDefaults(configs.red, 'plateau');
  assert.equal(ramp.heightReference, plateau.heightReference);
  assert.equal(ramp.elevation, plateau.elevation);
});

test('every world\'s toolbar is valid, its rocks are presets it ships', () => {
  for (const [name, config] of Object.entries(configs)) {
    const tools = worldTools(config), rocks = worldRocks(applyWorldRock(structuredClone(config)));
    assert.ok(tools.length > 0, name);
    assert.deepEqual(starterTools(config,rocks,[]).map(t=>t.id),tools.map(t=>t.id),name+': every starter brush fits in a map');
    for (const t of tools.filter(t => t.rock)) assert.ok(toolRockSlot(t, rocks, config.rock?.recipe) >= 0, `${name}: ${t.id} names ${t.rock}, which the world ships`);
    for (const t of tools.filter(t => t.material)) assert.ok([config.materials?.ground, config.materials?.high, ...(config.materials?.extra || [])].includes(t.material), `${name}: ${t.id} lays ${t.material}, which the world adds to a map`);
  }
  const today = {id: 'plateau', label: 'Plateau', icon: 'plateau', color: '#e6bb82', group: 'shape'};
  for (const bad of [{...today, id: 'fissure'}, {...today, id: 'a b'}, {...today, icon: 'star'}, {...today, color: 'red'}, {...today, group: 'paint'}, {...today, shape: 'mesa'}, {...today, label: ''}, {...today, id: 'map-1'}, {...today, family: ''}, {...today, family: 7}, {id: 'deep', label: 'Deep', icon: 'deep', color: '#7cb8e8', group: 'water', family: 'Hills'}])
    assert.throws(() => worldTools({tools: [bad]}), undefined, JSON.stringify(bad));
  assert.throws(() => worldTools({tools: [today, today]}), /twice/);
  assert.equal(worldTools({tools: [{...today, family: 'Highlands'}]})[0].family, 'Highlands', 'a Land tool may name its family');
  assert.equal(toolShape({id: 'soilHill', shape: 'hill'}), 'hill');
  assert.equal(toolShape(today), 'plateau');
});

test('a scene names shapes, so a world\'s toolbar cannot move it', () => {
  const config = configs.green, strokes = [['hill', [[100, 100], [300, 120]], {}], ['deep', [[400, 400], [600, 420]], {}], ['landform', [[500, 100]], {}], ['fissure', [[0, 0]], {}]];
  const nodes = sceneNodes(config, strokes, {settings: pageSettings(config, 'undulation=3')});
  assert.deepEqual(nodes.map(n => n.tool), [undefined, 'hill', 'deep', 'landform', undefined], 'a landform stroke names its shape as its tool');
  const without = {...config, tools: config.tools.filter(t => t.id !== 'hill').map(t => t.id === 'deep' ? {...t, id: 'lake', label: 'Lake'} : t)};
  assert.deepEqual(sceneNodes(without, strokes, {settings: pageSettings(without, 'undulation=3')}), nodes, 'Hill dropped and Deep water renamed: the same nodes');
});

test('a stroke shows as its tool, or as the generic landform where the toolbar lacks it; an old stroke takes its tool once', () => {
  const ids = new Set(['move', 'fissure', 'landform', 'hill', 'deep']), stroke = (tool, form = 'lfHill') => ({kind: 'landform', ...(tool ? {tool} : {}), params: {curve: {form}}});
  assert.equal(strokeTool(stroke('hill'), ids), 'hill');
  assert.equal(strokeTool(stroke('crater'), ids), 'landform');
  assert.equal(strokeTool({kind: 'fissure'}, ids), 'fissure');
  const kept = keepStrokeTools([stroke('hill'), stroke('crater'), {kind: 'ground'}], ids);
  assert.deepEqual(kept.map(n => n.tool), ['hill', 'landform', undefined]);
  assert.deepEqual(kept[1].params, stroke('crater').params, 'its numbers as they were');
  assert.deepEqual(kept.map(n => n.kept), [undefined, true, undefined], 'and kept for good');
  const old = inferStrokeTools([stroke(null, 'lfHill'), stroke(null, 'lfCrater'), stroke(null, 'lfShore'), stroke('hill', 'lfCrater')], ids);
  assert.deepEqual(old.map(n => n.tool), ['hill', 'landform', 'landform', 'hill'], 'inferred where the toolbar has the tool; a stroke that names one keeps it');
  // A tool may name its rock by a preset's key: the map's slot for it, 0 for the world's own recipe, Rock beneath without one, nothing for a tool that names none.
  const rocks = worldRocks({rock: {recipe: 'granite', presets: ['basalt']}});
  assert.equal(toolRockSlot({id: 'soilHill', rock: 'soil'}, rocks, 'granite'), 1);
  assert.equal(toolRockSlot({id: 'x', rock: 'basalt'}, rocks, 'granite'), 2);
  assert.equal(toolRockSlot({id: 'x', rock: 'granite'}, rocks, 'granite'), 0);
  assert.equal(toolRockSlot({id: 'x', rock: 'shale'}, rocks, 'granite'), -1);
  assert.equal(toolRockSlot({id: 'x'}, rocks), undefined);
  assert.equal(LANDFORM_TOOL.shape, 'landform');
});

test('a biome switch: a stroke whose tool the new world has takes its defaults where unedited; one it lacks becomes Landform with every number', () => {
  const ids = new Set(['landform', 'hill', 'map-1']), defaults = {hill: {radius: 120, wander: 34, lean: 1}, 'map-1': {radius: 80, wander: 2, lean: 1}};
  const list = [{kind: 'ground', amplitude: 3},
    {kind: 'landform', tool: 'hill', params: {radius: 200, wander: 10, lean: 1}, edited: ['radius']},
    {kind: 'landform', tool: 'mesa', params: {radius: 300, wander: 75, lean: 2}, edited: []},
    {kind: 'landform', tool: 'map-1', params: {radius: 80, wander: 2, lean: 1}, edited: []},
    {kind: 'fissure', params: {radius: 5}}];
  const out = carryStrokes(list, ids, n => defaults[n.tool] ?? null);
  assert.deepEqual(out.map(n => [n.tool, n.params]), [['hill', {radius: 200, wander: 34, lean: 1}], ['landform', {radius: 300, wander: 75, lean: 2}], ['map-1', {radius: 80, wander: 2, lean: 1}], [undefined, {radius: 5}]]);
  assert.ok(out.every(n => !('edited' in n)), 'the marks are the working copy\'s, not the map\'s');
  assert.deepEqual(out.map(n => n.kept), [undefined, true, undefined, undefined]);
});

// A tool made from a shape: Hill's card with a wider diameter and a rock slot.
const made = config => ({label: 'Broad hill', icon: 'hill', color: '#A0C080', group: 'shape', shape: 'hill', card: {...toolDefaults(config, 'hill'), diameter: 520, rockPreset: 1, preset: 'green'}});

test('a map\'s own tools: add, delete, ids never reused, checked before they touch the map', () => {
  const config = configs.green;
  let {id, tools} = addMapTool([], [], made(config));
  assert.equal(id, 'map-1');
  assert.deepEqual([tools[0].color, tools[0].card.preset, tools[0].card.diameter], ['#a0c080', 'custom', 520], 'a map tool\'s card is its own, never a world\'s preset');
  const second = addMapTool(tools, [], {...made(config), label: 'Lake', icon: 'deep', group: 'water', shape: 'deep', card: toolDefaults(config, 'deep')});
  assert.equal(second.id, 'map-2'); tools = second.tools;
  assert.deepEqual(deleteMapTool(tools, 'map-1').map(t => t.id), ['map-2']);
  assert.throws(() => deleteMapTool(tools, 'map-9'), /No tool/);
  // A stroke of a deleted tool keeps its id, so the next tool takes a new one and the stroke never shows as it.
  assert.equal(nextMapToolId(deleteMapTool(tools, 'map-2'), [{kind: 'landform', tool: 'map-2'}]), 'map-3');
  assert.deepEqual(copyMapTools(JSON.parse(JSON.stringify(tools))), tools);
  assert.equal(copyMapTools(undefined), null);
  for (const bad of [{}, [{...tools[0], id: 'fissure'}], [tools[0], tools[0]], [{...tools[0], icon: 'star'}], [{...tools[0], extra: 1}], [{...tools[0], label: ' '}]])
    assert.throws(() => copyMapTools(bad), undefined, JSON.stringify(bad).slice(0, 80));
  // A setting no card has any more (a removed option) is dropped (AGENTS.md rule 7); a card setting of the wrong kind leaves that one tool out, not the map.
  assert.deepEqual(copyMapTools([{...tools[0], card: {...tools[0].card, craterlets: 5}}]), [tools[0]]);
  for (const card of [{...tools[0].card, diameter: 'wide'}, {...tools[0].card, curve: {form: 'lfHill', knots: [[0]]}}])
    assert.deepEqual(copyMapTools([{...tools[0], card}, tools[1]]), [tools[1]], JSON.stringify(card).slice(0, 80));
  // Making a tool stays strict.
  assert.throws(() => addMapTool([], [], {...made(config), card: {...made(config).card, diameter: 'wide'}}), /not a number/);
  let many = [];
  for (let k = 0; k < MAP_TOOLS_MAX; k++) many = addMapTool(many, [], made(config)).tools;
  assert.throws(() => addMapTool(many, [], made(config)), /at most/);
});

test('a scene may carry the map\'s tools, and a stroke that names one draws its card', () => {
  const config = configs.green, {tools} = addMapTool([], [], made(config)), settings = pageSettings(config);
  const [node] = sceneNodes(config, [['map-1', [[100, 100], [300, 140]], {}]], {ground: false, settings, tools});
  assert.equal(node.kind, 'landform'); assert.equal(node.tool, 'map-1');
  const [same] = sceneNodes(config, [['hill', [[100, 100], [300, 140]], {card: {diameter: 520, rockPreset: 1}}]], {ground: false, settings});
  assert.deepEqual(node.params, same.params, 'the same numbers as its shape with the card\'s changes');
  assert.equal(node.params.radius, 260);
  assert.throws(() => sceneNodes(config, [['map-1', [[0, 0]], {}]], {ground: false, settings}), /not a tool/, 'without the map\'s tools the name means nothing');
});

test('a save and a share link carry the map\'s tools and each stroke\'s tool', async () => {
  const {shareText, gzipText} = await import('../sculpt-share.js'), {gunzipSync} = await import('node:zlib');
  const {tools} = addMapTool([], [], made(configs.green)), nodes = [{kind: 'landform', tool: 'map-1', points: [{x: 0, y: 0}], params: {radius: 260}}, {kind: 'landform', tool: 'hill', points: [{x: 1, y: 1}], params: {}}];
  const save = {version: 6, tools, tool: 'map-1', toolSettings: {'map-1': tools[0].card}, nodes};
  const back = JSON.parse(gunzipSync(await gzipText(shareText(save))).toString('utf8'));
  assert.deepEqual(copyMapTools(back.tools), tools);
  const ids = new Set(['landform', 'hill', ...copyMapTools(back.tools).map(t => t.id)]);
  assert.deepEqual(keepStrokeTools(back.nodes, ids).map(n => n.tool), ['map-1', 'hill']);
  assert.equal(shareText(back), shareText(save), 'sharing the loaded map again gives the same link');
  assert.deepEqual(keepStrokeTools(back.nodes, new Set(['landform', 'hill'])).map(n => n.tool), ['landform', 'hill'], 'a map without the tool shows its strokes as Landform');
});

test('a stroke that fell back keeps its shape for good: a Green hill through a world without Hill, then Desert', () => {
  const green = configs.green, desert = configs.desert, noHill = {...green, tools: green.tools.filter(t => t.id !== 'hill')};
  const ids = config => new Set(['landform', ...worldTools(config).map(t => t.id)]);
  const params = (config, shape) => strokeParams(strokeCard(config, toolDefaults(config, shape))), defaultsIn = config => n => params(config, n.tool);
  // A hill drawn on Green and widened by hand.
  const start = {kind: 'landform', tool: 'hill', points: [{x: 0, y: 0}], params: {...params(green, 'hill'), widthVary: .6}};
  let [n] = carryStrokes(markEdited([start], defaultsIn(green)), ids(noHill), defaultsIn(noHill));
  assert.deepEqual([n.tool, n.kept], ['landform', true]); assert.deepEqual(n.params, start.params);
  [n] = carryStrokes(markEdited([n], defaultsIn(noHill)), ids(desert), defaultsIn(desert));
  assert.deepEqual([n.tool, n.kept], ['landform', true]);
  assert.deepEqual(n.params, start.params, 'the numbers it started with: Desert\'s mesa (terraces 6, ledges) does not reach it');
  // A stroke drawn with the Landform button itself still follows the world where unedited.
  [n] = carryStrokes(markEdited([{kind: 'landform', tool: 'landform', points: [{x: 0, y: 0}], params: params(green, 'landform')}], defaultsIn(green)), ids(desert), defaultsIn(desert));
  assert.deepEqual([n.tool, n.kept, n.params.terraces], ['landform', undefined, 6]);
});

test('a world\'s own shape: a library shape as the world makes it, with its own numbers; scenes still name library shapes', async () => {
  const {shapeFrom} = await import('../sculpt-scene.js');
  const green = configs.green, worldShapes = {...green.worldShapes, green: {...green.worldShapes.green, mound: {from: 'hill', diameter: 140, elevation: 20}, hill: {...green.worldShapes.green.hill, from: 'mountain'}, odd: {from: 'mesa'}}};
  const config = {...green, worldShapes, tools: [...green.tools, {id: 'mound', label: 'Mound', icon: 'hill', color: '#b8d88d', group: 'shape', rock: 'soil', help: 'A small round rise.'}]};
  assert.equal(shapeFrom(config, 'mound'), 'hill');
  assert.equal(shapeFrom(config, 'hill'), 'hill', 'a library shape keeps its own: a `from` on it means nothing');
  assert.equal(shapeFrom(config, 'odd'), 'odd', 'a `from` that names no library shape draws nothing');
  assert.deepEqual(toolDefaults(config, 'mound'), {...toolDefaults(config, 'hill'), diameter: 140, elevation: toolDefaults(config, 'hill').elevation - 36 + 20}, 'the world\'s Hill with its own numbers');
  assert.deepEqual(toolDefaults(config, 'hill'), toolDefaults(green, 'hill'));
  assert.equal(worldTools(config).at(-1).help, 'A small round rise.');
  assert.throws(() => worldTools({...config, tools: [{...config.tools.at(-1), id: 'odd'}]}), /no shape/);
  assert.throws(() => worldTools({...config, tools: [{...config.tools.at(-1), help: ''}]}), /help/);
  assert.throws(() => sceneNodes(config, [['mound', [[0, 0]], {}]], {ground: false, settings: pageSettings(config)}), /not a tool/, 'a scene names library shapes');
  // A world that does not make the shape makes no landform of it, and the Tool preset menu does not offer that world (sculpt.js syncToolStyle).
  assert.equal(toolDefaults(config, 'mound', 'red').curve, undefined);
});

test('worlds ship no variants or variant toolbars', () => {
  for (const config of Object.values(configs)) assert.ok(!('variantTools' in config) && !('variants' in config) && !('variant' in config));
});

test('a tool may name the ground material it lays down; the world adds it to a map', async () => {
  const {withWorldMaterials, LIBRARY} = await import('../sculpt-materials.js');
  const {toolMaterialSlot} = await import('../sculpt-tools.js');
  const keys = Object.keys(LIBRARY), extra = keys.find(k => k.endsWith('-ground') && k !== 'green-ground');
  const list = withWorldMaterials(null, {materials: {ground: 'green-ground', water: 'green-water', extra: [extra, 'no-such-material']}});
  assert.equal(list.filter(m => m.source === extra).length, 1, 'the extra material is added once');
  assert.equal(withWorldMaterials(list, {materials: {ground: 'green-ground', water: 'green-water', extra: [extra]}}).length, list.length, 'and not again');
  assert.equal(toolMaterialSlot({id: 't', material: extra}, list), list.find(m => m.source === extra).slot);
  assert.equal(toolMaterialSlot({id: 't', material: 'green-ground'}, list), 0, 'the world\'s ground is slot 0');
  assert.equal(toolMaterialSlot({id: 't', material: 'green-water'}, list), -1, 'water is no ground: the ground beneath');
  assert.equal(toolMaterialSlot({id: 't'}, list), undefined);
});
