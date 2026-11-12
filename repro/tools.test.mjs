// A world's shape tools as data: its table's world.tools (the toolbar's shape buttons, in order) and world.shapes (its numbers over the shape
// library, by shape name), served as config.tools and config.worldShapes (sculpt.py world_configs).
import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {mkdtempSync, readFileSync, readdirSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {LANDFORM_TOOLS, TOOL_PRESETS, toolDefaults} from '../sculpt-scene.js';

const root = new URL('..', import.meta.url).pathname, dir = mkdtempSync(join(tmpdir(), 'tools-test-'));
execFileSync(process.env.PYTHON || '/Users/daniel/src/terraform/.venv/bin/python', [root + 'sculpt.py', '--dump-configs', dir]);
const files = readdirSync(join(dir, 'config')).filter(f => f !== 'catalog.json').sort();
const configs = Object.fromEntries(files.map(f => [f.replace(/\.json$/, ''), JSON.parse(readFileSync(join(dir, 'config', f), 'utf8'))]));
const WORLDS = ['green', 'red', 'archipelago', 'moon', 'zhon', 'lava', 'desert', 'crystal', 'ice'];
const ENTRIES = [...Object.keys(LANDFORM_TOOLS), 'landform', 'fissure', 'smooth', 'erase', 'paint', 'sand', 'grass', 'move'];
// Every starting card the editor makes: each world and variant file, each entry, on its own world's preset and on every other world's (Tool preset).
const allDefaults = () => Object.fromEntries(Object.entries(configs).map(([name, config]) => [name, Object.fromEntries(ENTRIES.map(entry =>
  [entry, Object.fromEntries(WORLDS.map(w => [w, toolDefaults(config, entry, w)]))]))]));
const PINNED = '440b1e5e0c04b99abfe7e184846bb96537a7fbd516d8cc814fb3384560bdf763';

test('every world\'s shapes are its old brush presets, and the starting cards are pinned', () => {
  for (const [name, config] of Object.entries(configs)) {
    assert.deepEqual(Object.keys(config.worldShapes), WORLDS, name);
    for (const w of WORLDS) for (const entry of [...Object.keys(LANDFORM_TOOLS), 'landform'])
      assert.deepEqual(config.worldShapes[w][entry], TOOL_PRESETS[w]?.[entry === 'landform' ? 'plateau' : entry] ?? {}, `${name}: ${w} ${entry}`);
  }
  assert.equal(createHash('sha256').update(JSON.stringify(allDefaults())).digest('hex'), PINNED);
});

test('every world\'s toolbar is today\'s shape buttons: ids, labels, icons, colors, groups and order', () => {
  const html = readFileSync(root + 'sculpt.html', 'utf8'), group = name => html.split(`aria-label="${name} tools"`)[1].split('</div></div>')[0], buttons = [];
  for (const [g, name] of [['shape', 'Shape'], ['water', 'Water']])
    for (const m of group(name).matchAll(/<button data-tool="(\w+)"[^>]*aria-label="([^"]+)"[^>]*--tool-color:(#[0-9a-f]{6})/g))
      if (Object.hasOwn(LANDFORM_TOOLS, m[1])) buttons.push({id: m[1], label: m[2], icon: m[1], color: m[3], group: g});
  assert.equal(buttons.length, Object.keys(LANDFORM_TOOLS).length);
  for (const [name, config] of Object.entries(configs)) assert.deepEqual(config.tools, buttons, name);
});
