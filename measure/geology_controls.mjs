// H16: does every geology control do something, on every world that sets it? Each knob is moved from the world's value to the default on the
// world's three reproduction scenes (repro/scenes), on the real engine, and the render is compared with the unmoved one: repro/compare.py's
// mean |diff| and share of pixels moved, and measure/impact.py's block share of the knob's class (decision 11: a kept control must move at least
// 5% of its class at 1x, beside a noise floor of 1-3%). A knob that prints 0.00 and 0.0% is dead on that world.
//   node measure/geology_controls.mjs [--server http://127.0.0.1:8885] [--port 9685] [--out DIR] [--only desert,lava] [--knobs banding,strata] [--probe archipelago.ringScatter=0] [--family geology|fractures]
// --family fractures (H17): the crack, joint, gully, scratch, facet and block knobs. Each scene's own value is read as the page reads it (the query, then
// Green's engine preset, then the scene's variant, then the world's table, then the default), a scene where a knob already sits at its target is shown as `=`
// and left out of the verdict, and the class is the slope blocks of measure/geology_diff.py (cracks and crack tone: slope at least .10; the structured face:
// at least .50), not the raised class. A seeded base in DIR/base is reused (copy a main render of the 27 scenes there to skip the 27 renders).
// Writes DIR/geology-controls.json and prints one row per (world, knob). Python is $PYTHON (default the main checkout's venv). Exit 1 on a console error.
import {execFileSync} from 'node:child_process';
import {existsSync, mkdirSync, readFileSync, writeFileSync} from 'node:fs';
const args = process.argv.slice(2), opt = (n, d) => { const i = args.indexOf(n); return i >= 0 ? args[i + 1] : d; };
const server = opt('--server', 'http://127.0.0.1:8885'), port = opt('--port', '9685'), out = opt('--out', 'geology-controls');
const only = opt('--only', '').split(',').filter(Boolean), knobsOnly = opt('--knobs', '').split(',').filter(Boolean);
const py = process.env.PYTHON || '/Users/daniel/src/terraform/.venv/bin/python';
const here = new URL('..', import.meta.url).pathname;
// The geology families: bed*, band*, strata*, ring*, layer*, the lava layer controls, the cap and foot bands, the column, and the rock structure
// they share a coordinate with (cliff*, joint*). The water-bed knobs (bedLit, bedTint, ...) are Water's, not geology.
const FAMILY = /^(rockOrder|rockFrom|bed(Spacing|Vary|Dip|DipDir|Ledge|Lip|Height|Flow|Bend|Punch)|banding|band[A-Z]\w*|sandBanding|sandBandSpacing|strata\w*|ring\w*|layer\w*|shoreLayers|lava(Meander|Spread|CircleVary|CreaseVary)|baseBand\w*|desertCapFlat|cliff\w*|joint\w*|column\w*|mineralDetail)$/;
// The class each family acts on (measure/geology_diff.py).
const CLASS = k => fractures ? (/^(crack|ribTilt)/.test(k) ? 'slope' : 'face') : /^(ring|mineral)/.test(k) || k === 'bandFoot' ? 'halo' : /^(layer|shoreLayers|lava)/.test(k) ? 'bank' : 'raised';
// Card units of the stroke options (sculpt.js SHAPE_FIELDS' last scale): a stroke that carries its own value is moved with the world's.
const CARD_SCALE = {shoreLayers: 1, layerPx: 1, layerCircle: 1, layerStyle: 1, layerRiser: 1, layerLedge: 100, layerRough: 100, layerVary: 100, lavaMeander: 100, lavaSpread: 100, lavaCircleVary: 100};
// Shape options that no world sets: red-2's own stroke carries terraces 7, ledge 40, jitter 60 (card units). Moved on that scene's card.
const CARD_ONLY = [{world: 'red', knob: 'terraces', from: 7, to: 0}, {world: 'red', knob: 'ledge', from: 40, to: 90}, {world: 'red', knob: 'terraceJitter', from: 60, to: 0}];
const family = opt('--family', 'geology');
const FRACTURES = /^(crack(Severity|Spacing|Length|Major|Minor|Hairline|Blocks|Width|Jagged|Network|Reach|Style|Dark|Lit)|joint(Spacing|Angle|Depth|Run|Gaps)|gully(Depth|Spacing|Width|Angle|Run|Gaps|Shade)|ribTilt|scratch(Depth|Spacing|Angle|Run|Gaps)|facet(Tilt|Size|Stretch|Step|Seam|Skew|Coarse)|blocks|block(Row|Width|Tilt|Step|Seam|Chip|Grit)|hillBlocks)$/;
const fractures = family === 'fractures';
const scenes = {};   // world -> the three scenes' variants, for the page's own values
for (const world of ['green', 'red', 'archipelago', 'moon', 'zhon', 'lava', 'desert', 'crystal', 'ice'])
  scenes[world] = [1, 2, 3].map(n => (JSON.parse(readFileSync(`${here}repro/scenes/${world}-${n}.json`, 'utf8')).query.match(/variant=(\w+)/) || [])[1] || '');
const dump = JSON.parse(execFileSync(py, ['-c', `import json, sys, sculpt
scenes = json.loads(sys.argv[1])
eff = {}
for world, variants in scenes.items():
    base = sculpt.biome_config(world)
    eff[world] = []
    for v in variants:
        c = sculpt.apply_variant(base, world, v) if v else base
        eff[world].append({**c['defaults'], **c.get('engineDefaults', {})})
print(json.dumps({'d': sculpt.KNOB_DEFAULTS, 'w': sculpt.WORLD_KNOBS, 'e': eff}))`, JSON.stringify(scenes)], {cwd: here}).toString());
const states = [];
const same = (a, b) => String(a) === String(b) || (Number(a) === Number(b) && a !== '' && b !== '');
for (const world of fractures ? Object.keys(scenes) : Object.keys(dump.w)) for (const knob of Object.keys(dump.d)) {
  const re = fractures ? FRACTURES : FAMILY;
  if (!re.test(knob) || (only.length && !only.includes(world)) || (knobsOnly.length && !knobsOnly.includes(knob))) continue;
  if (fractures) {
    const at = dump.e[world].map(e => e[knob]);   // each scene's own value
    if (at.every(v => same(v, dump.d[knob]))) continue;
    states.push({world, knob, from: at.join('/'), applies: at.map(v => !same(v, dump.d[knob])), to: dump.d[knob], cls: CLASS(knob)});
  } else {
    const value = dump.w[world]?.[knob];
    if (value === undefined || same(value, dump.d[knob])) continue;
    states.push({world, knob, from: value, to: dump.d[knob], cls: CLASS(knob)});
  }
}
// --probe world.knob=value,...: knobs a world sets to the default's own value are skipped above; these move one from the world's value to a given one.
for (const p of opt('--probe', '').split(',').filter(Boolean)) {
  const [id, to] = p.split('='), [world, knob] = id.split('.');
  const at = fractures ? dump.e[world].map(e => e[knob]) : null;
  states.push({world, knob, from: fractures ? at.join('/') : dump.w[world]?.[knob] ?? dump.d[knob], applies: at?.map(v => !same(v, to)), to, cls: CLASS(knob)});
}
for (const s of fractures ? [] : CARD_ONLY) if ((!only.length || only.includes(s.world)) && (!knobsOnly.length || knobsOnly.includes(s.knob))) states.push({...s, cls: 'raised', card: true});
mkdirSync(out, {recursive: true});
const logs = [];
// One world's three scenes into dir, with the query and, optionally, an edit of every stroke card that carries the key.
function render(world, dir, query, edit) {
  for (const n of [1, 2, 3]) {
    let scene = `${here}repro/scenes/${world}-${n}.json`;
    if (edit) {
      const s = JSON.parse(readFileSync(scene, 'utf8'));
      for (const st of s.strokes) if (st[2]?.card && edit.knob in st[2].card) st[2].card[edit.knob] = edit.value;
      scene = `${dir}/${world}-${n}.scene.json`; mkdirSync(dir, {recursive: true}); writeFileSync(scene, JSON.stringify(s));
    }
    const res = execFileSync('node', [`${here}repro/render.mjs`, scene, `${dir}/${world}-${n}`, '--server', server, '--port', port, ...(query ? ['--query', query] : [])]).toString().trim().split('\n').pop();
    const info = JSON.parse(res);
    if (info.console.length || info.mismatch) logs.push(`${world}-${n} ${query}: ${JSON.stringify(info.console)} mismatch ${info.mismatch}`);
  }
}
const base = new Set();
const rows = [];
for (const s of states) {
  if (!base.has(s.world)) { if (!existsSync(`${out}/base/${s.world}-3/ours.png`)) render(s.world, `${out}/base`); base.add(s.world); }
  const id = `${s.world}.${s.knob}`;
  const scale = s.card ? 1 : CARD_SCALE[s.knob];
  if (s.card) render(s.world, `${out}/${id}`, '', {knob: s.knob, value: s.to});
  else render(s.world, `${out}/${id}`, `${s.knob}=${encodeURIComponent(s.to)}`, scale ? {knob: s.knob, value: Number(s.to) * scale} : null);
  const r = JSON.parse(execFileSync(py, [`${here}measure/geology_diff.py`, `${out}/base`, `${out}/${id}`, s.world, s.cls]).toString());
  const row = {...s, ...r, acts: Math.max(...r.class_changed.map((x, i) => s.applies && !s.applies[i] ? 0 : x ?? 0)) >= .05};
  rows.push(row);
  console.log(`${s.world.padEnd(12)}${s.knob.padEnd(16)}${String(s.from).slice(0, 18).padStart(18)} ->${String(s.to).slice(0, 8).padStart(9)}  mad ${r.mad.map(x => x.toFixed(2)).join('/')}  moved ${r.moved.map(x => (100 * x).toFixed(1)).join('/')}%  ${s.cls} ${r.class_share.map(x => (100 * x).toFixed(0)).join('/')}% of window, blocks changed ${r.class_changed.map((x, i) => s.applies && !s.applies[i] ? '=' : x == null ? '-' : (100 * x).toFixed(1)).join('/')}%${s.cls === 'slope' ? ` (face ${r.face_changed.map(x => x == null ? '-' : (100 * x).toFixed(1)).join('/')}%)` : s.cls === 'face' ? ` (slope ${r.slope_changed.map(x => x == null ? '-' : (100 * x).toFixed(1)).join('/')}%)` : ''}  ${row.acts ? '' : 'UNDER 5%'}`);
}
writeFileSync(`${out}/geology-controls.json`, JSON.stringify({rows, console: logs.slice(0, 20)}));
if (logs.length) console.log('console:', logs.slice(0, 5));
process.exit(logs.length ? 1 : 0);
