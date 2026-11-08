// A world's World rows and colors as the panel offers them, for choosing what to try in a retail round (docs/RETAIL_ROUND.md):
//   node repro/retail_knobs.mjs <world> [--variant modern] [--configs DIR] [--group Relief] [--changed]
// One line per row: group, key (what repro/retail.sh --query takes), label, range and step, and this world's value (its preset over
// sculpt.py KNOB_DEFAULTS; `*` marks a row the world or variant sets away from KNOB_DEFAULTS). --group keeps the groups whose name
// contains the text; --changed keeps the rows the world sets. Then the Colors rows the world has, with its own base colors, and the
// brush presets it lays over the shape buttons (sculpt-scene.js TOOL_PRESETS). A row the panel disables still lists: its reason
// depends on the scene (water strokes, painted rock), so the sweep (measure/world_controls.mjs) is where a row's state is measured.
import {execFileSync} from 'node:child_process';
import {mkdtempSync, readFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {KNOBS, colorRows} from '../sculpt-knobs.js';
import {TOOL_PRESETS} from '../sculpt-scene.js';

const args = process.argv.slice(2), opt = (k, d) => { const i = args.indexOf(k); return i >= 0 ? args[i + 1] : d; };
const world = args[0];
if (!world || world.startsWith('--')) { console.error('usage: node repro/retail_knobs.mjs <world> [--variant v] [--configs DIR] [--group text] [--changed]'); process.exit(2); }
const repo = new URL('..', import.meta.url).pathname, variant = opt('--variant', '');
let configs = opt('--configs', '');
if (!configs) { configs = mkdtempSync(join(tmpdir(), 'terraform-configs-')); execFileSync(process.env.PYTHON || '/Users/daniel/src/terraform/.venv/bin/python', [join(repo, 'sculpt.py'), '--dump-configs', configs], {stdio: ['ignore', 'ignore', 'inherit']}); }
const config = JSON.parse(readFileSync(join(configs, 'config', `${world}${variant ? '--' + variant : ''}.json`), 'utf8'));
const py = process.env.PYTHON || '/Users/daniel/src/terraform/.venv/bin/python';
const defaults = JSON.parse(execFileSync(py, ['-c', 'import json, sculpt; print(json.dumps(sculpt.KNOB_DEFAULTS))'], {cwd: repo}).toString());
const group = opt('--group', ''), changedOnly = args.includes('--changed');
console.log(`${config.biome}${variant ? ' (' + variant + ')' : ''}: World rows (key = repro/retail.sh --query key)`);
for (const [title, rows] of KNOBS) {
  if (group && !title.toLowerCase().includes(group.toLowerCase())) continue;
  for (const [key, label, min, max, step, fallback] of rows) {
    // The engine preset (sculpt.py ENGINE_KNOBS) goes in ahead of the world's defaults, as the renderer reads them (sculpt-renderer.js).
    const value = config.engineDefaults?.[key] ?? config.defaults?.[key] ?? String(fallback), set = Number(value) !== Number(defaults[key] ?? fallback);
    if (changedOnly && !set) continue;
    console.log(`${title.padEnd(26)} ${key.padEnd(20)} ${String(value).padStart(7)}${set ? '*' : ' '} ${min}..${max} step ${step}  ${label}`);
  }
}
console.log('\nColors (the Colors panel; a row with no value is the texture\'s own):');
for (const [key, label] of colorRows(config, new URLSearchParams(config.variant ? 'variant=' + config.variant : ''))) console.log(`  ${label.padEnd(16)} ${config.colors?.[key] ?? ''}`);
console.log('\nBrush presets over the shape buttons (sculpt-scene.js TOOL_PRESETS):');
for (const [entry, preset] of Object.entries(TOOL_PRESETS[world] || {})) console.log(`  ${entry.padEnd(10)} ${JSON.stringify(preset)}`);
