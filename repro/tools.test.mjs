// A world's shape tools as data: its table's world.tools (the toolbar's shape buttons, in order) and world.shapes (its numbers over the shape
// library, by shape name), served as config.tools and config.worldShapes (sculpt.py world_configs).
import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {mkdtempSync, readFileSync, readdirSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {LANDFORM_SHAPES, toolDefaults, sceneNodes, pageSettings} from '../sculpt-scene.js';
import {TOOL_ICONS, FIXED_TOOLS, LANDFORM_TOOL, worldTools, toolShape, toolRockSlot, strokeTool, keepStrokeTools, inferStrokeTools} from '../sculpt-tools.js';

const root = new URL('..', import.meta.url).pathname, dir = mkdtempSync(join(tmpdir(), 'tools-test-'));
execFileSync(process.env.PYTHON || '/Users/daniel/src/terraform/.venv/bin/python', [root + 'sculpt.py', '--dump-configs', dir]);
const files = readdirSync(join(dir, 'config')).filter(f => f !== 'catalog.json').sort();
const configs = Object.fromEntries(files.map(f => [f.replace(/\.json$/, ''), JSON.parse(readFileSync(join(dir, 'config', f), 'utf8'))]));
const WORLDS = ['green', 'red', 'archipelago', 'moon', 'zhon', 'lava', 'desert', 'crystal', 'ice'];
const ENTRIES = [...Object.keys(LANDFORM_SHAPES).filter(k => k !== 'landform'), 'landform', 'fissure', 'smooth', 'erase', 'paint', 'sand', 'grass', 'move'];
// Every starting card the editor makes: each world and variant file, each entry, on its own world's preset and on every other world's (Tool preset).
const allDefaults = () => Object.fromEntries(Object.entries(configs).map(([name, config]) => [name, Object.fromEntries(ENTRIES.map(entry =>
  [entry, Object.fromEntries(WORLDS.map(w => [w, toolDefaults(config, entry, w)]))]))]));
const PINNED = '440b1e5e0c04b99abfe7e184846bb96537a7fbd516d8cc814fb3384560bdf763';

// The starting cards the old tables made (sculpt-scene.js TOOL_PRESETS over LANDFORM_TOOLS, main 1f0dcec0), which the world data reproduces.
test('every world defines every shape, and the starting cards are the old tables\' to the digit', () => {
  for (const [name, config] of Object.entries(configs)) {
    assert.deepEqual(Object.keys(config.worldShapes), WORLDS, name);
    for (const w of WORLDS) assert.deepEqual(Object.keys(config.worldShapes[w]).sort(), Object.keys(LANDFORM_SHAPES).sort(), `${name}: ${w}`);
  }
  assert.equal(createHash('sha256').update(JSON.stringify(allDefaults())).digest('hex'), PINNED);
});

// Main 1f0dcec0's thirteen shape buttons in sculpt.html, in order (Fissure, which sat between Crater and Faceted forms, is a fixed button now).
const TODAY = [['plateau', 'Plateau', '#e6bb82', 'shape'], ['hill', 'Hill', '#b8d88d', 'shape'], ['mountain', 'Mountain', '#b3bcca', 'shape'], ['ramp', 'Ramp', '#e5cfa5', 'shape'],
  ['valleyV', 'V valley', '#c7a97e', 'shape'], ['valleyU', 'U valley', '#c7a97e', 'shape'], ['valleyT', 'Terraced valley', '#c7a97e', 'shape'], ['crater', 'Crater', '#d5a18b', 'shape'],
  ['crystal', 'Faceted forms', '#aaa5ec', 'shape'], ['deep', 'Deep water', '#7cb8e8', 'water'], ['shallow', 'Shallow water', '#87d9da', 'water'], ['river', 'River', '#6fb1e0', 'water'],
  ['braided', 'Braided river', '#6fb1e0', 'water']].map(([id, label, color, group]) => ({id, label, icon: id, color, group}));

test('every world\'s toolbar is today\'s shape buttons: ids, labels, icons, colors, groups and order', () => {
  for (const [name, config] of Object.entries(configs)) assert.deepEqual(worldTools(config), TODAY, name);
  // The icon set is sculpt.html's template, and the fixed buttons (the generic Landform among them) are in the markup at their places.
  const html = readFileSync(root + 'sculpt.html', 'utf8'), template = html.split('<template id="tool-icons">')[1].split('</template>')[0];
  assert.deepEqual([...template.matchAll(/data-icon="(\w+)"/g)].map(m => m[1]), TOOL_ICONS);
  const palette = html.split('class="tool-groups"')[1].split('<template')[0];
  assert.deepEqual([...palette.matchAll(/data-tool="(\w+)"|id="(shape|water)-tools"/g)].map(m => m[1] ?? `[${m[2]}]`), ['move', 'landform', '[shape]', 'fissure', '[water]', 'smooth', 'erase', 'paint', 'sand', 'grass']);
  assert.deepEqual(FIXED_TOOLS.toSorted(), ['erase', 'fissure', 'grass', 'move', 'paint', 'sand', 'smooth']);
  for (const bad of [{...TODAY[0], id: 'fissure'}, {...TODAY[0], id: 'a b'}, {...TODAY[0], icon: 'star'}, {...TODAY[0], color: 'red'}, {...TODAY[0], group: 'paint'}, {...TODAY[0], shape: 'mesa'}, {...TODAY[0], label: ''}])
    assert.throws(() => worldTools({tools: [bad]}), undefined, JSON.stringify(bad));
  assert.throws(() => worldTools({tools: [TODAY[0], TODAY[0]]}), /twice/);
  assert.equal(toolShape({id: 'soilHill', shape: 'hill'}), 'hill');
  assert.equal(toolShape(TODAY[1]), 'hill');
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
  const old = inferStrokeTools([stroke(null, 'lfHill'), stroke(null, 'lfCrater'), stroke(null, 'lfShore'), stroke('hill', 'lfCrater')], ids);
  assert.deepEqual(old.map(n => n.tool), ['hill', 'landform', 'landform', 'hill'], 'inferred where the toolbar has the tool; a stroke that names one keeps it');
  // A tool may name its rock by a preset's key: the map's slot for it, Rock beneath without one, nothing for a tool that names none.
  const rocks = [{slot: 1, name: 'Smooth soil', key: 'soil'}, {slot: 2, name: 'Jointed basalt'}];
  assert.equal(toolRockSlot({id: 'soilHill', rock: 'soil'}, rocks), 1);
  assert.equal(toolRockSlot({id: 'x', rock: 'basalt'}, rocks), -1);
  assert.equal(toolRockSlot({id: 'x'}, rocks), undefined);
  assert.equal(LANDFORM_TOOL.shape, 'landform');
});
