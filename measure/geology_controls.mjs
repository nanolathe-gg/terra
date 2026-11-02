// H16: does every geology control do something, on every world that sets it? Each knob is moved from the world's value to the default on the
// world's three reproduction scenes (repro/scenes), on the real engine, and the render is compared with the unmoved one: repro/compare.py's
// mean |diff| and share of pixels moved, and measure/impact.py's block share of the knob's class (decision 11: a kept control must move at least
// 5% of its class at 1x, beside a noise floor of 1-3%). A zero is inactive on these scenes; check parent gates and variants before calling a control dead.
//   node measure/geology_controls.mjs [--server http://127.0.0.1:8885] [--port 9685] [--out DIR] [--only desert,lava] [--knobs banding,strata] [--probe archipelago.ringScatter=0] [--family geology|fractures|shores|bodies|impacts] [--scenes DIR] [--list]
// --family impacts (H21): crater/rim/skin and regolith controls. Shape cards and top-level options win over query defaults;
// only matching stroke kinds count. --scenes DIR supplies probe scenes (missing files fall back to repro/scenes).
// --family fractures (H17): the crack, joint, gully, facet and block knobs. Each scene's own value is read as the page reads it (the query, then
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
const sceneRoot = opt('--scenes', `${here}repro/scenes`);
const scenePath = (world, n) => existsSync(`${sceneRoot}/${world}-${n}.json`) ? `${sceneRoot}/${world}-${n}.json` : `${here}repro/scenes/${world}-${n}.json`;
// The geology families: bed*, band*, strata*, ring*, layer*, the lava layer controls, the cap and foot bands, the column, and the rock structure
// they share a coordinate with (cliff*, joint*). The water-bed knobs (bedLit, bedTint, ...) are Water's, not geology.
const FAMILY = /^(rockOrder|rockFrom|bed(Spacing|Vary|Dip|DipDir|Ledge|Lip|Height|Bend|Punch)|banding|band[A-Z]\w*|sandBanding|sandBandSpacing|strata\w*|ring\w*|layer\w*|shoreLayers|lava(Meander|Spread|CircleVary|CreaseVary)|baseBand\w*|desertCapFlat|cliff\w*|joint\w*|column\w*|mineralDetail)$/;
// The class each family acts on (measure/geology_diff.py).
const SHORES = /^(shoal\w*|shelf\w*|shallowDepth|deepDepth|waterSoft|crispShore|stepSharp|stepSoftPx|deepEdge\w*|bed(Lit|Tint|Flat|Dots|DotCell|Relief|Contrast|Bright|CrackSlope)|crackedStep|crackedContrast|flatBank|bankPx|bankRock|beachWidth|apron|sandCrown|shoreEdge|bandWater|fingers|finger[A-Z]\w*|shoreLayers|layer(Px|Riser|Ledge|Rough|Style|Vary|Circle|Crease)|lava(Meander|Spread|CircleVary|CreaseVary)|shorePlates|plate[A-Z]\w*|crystalShore\w*|water(Shore|Deep|Bed))$/;
const SHORE_CLASS = k => /^(shoal(Stairs|ShoreSoft)|crispShore|shoreEdge|waterShore|shore)$/.test(k) ? 'edge' : /^(beachWidth|apron|sandCrown)$/.test(k) ? 'beach' : /^(flatBank|bankRock|layerCrease|lavaCreaseVary)$/.test(k) ? 'bank'
  : /^(bankPx|bankWidth|beachFlatness|fingers|finger[A-Z]\w*|shoreLayers|layer[A-Z]\w*|lava(Meander|Spread|CircleVary)|shorePlates|plate[A-Z]\w*|crystalShore\w*)$/.test(k) ? 'shore' : 'shallows';
const IMPACTS = /^(moon\w*|crater\w*|pock\w*|crystalCrater\w*|rim(Sectors|Unequal|Gaps|GapWidth|Height)|worms|wrinkles|slopeMarks)$/;
const IMPACT_CLASS = k => /^(worms|wrinkles|slopeMarks|moon(Ribs|RibDepth|RibDark|Cups|CupSize|CupDepth))$/.test(k) ? 'slope' : /^moonFold/.test(k) ? 'fold' : 'impact';
const CLASS = k => bodies ? BODY_CLASS(k) : impacts ? IMPACT_CLASS(k) : shores ? SHORE_CLASS(k) : fractures ? (/^(crack|ribTilt)/.test(k) ? 'slope' : 'face') : /^(ring|mineral)/.test(k) || k === 'bandFoot' ? 'halo' : /^(layer|shoreLayers|lava)/.test(k) ? 'bank' : 'raised';
// Card units of the stroke options (sculpt.js SHAPE_FIELDS' last scale): a stroke that carries its own value is moved with the world's.
const CARD_SCALE = {fingers: 100, fingerAmount: 100, fingerSize: 100, fingerSpread: 100, fingerHeight: 10, bankPx: 1, shorePlates: 1, plateWaterPx: 1, plateLandPx: 1, plateSize: 1, plateGap: 10, plateHeight: 10, plateMaterial: 1,
  crystalShoreSeam: 100, shelves: 100, bankWidth: 100, beachFlatness: 100, waterShore: 1, waterDeep: 1, waterBed: 1, shoreLayers: 1, layerPx: 1, layerCircle: 1, layerStyle: 1, layerRiser: 10, layerLedge: 100, layerRough: 100, layerVary: 100, lavaMeander: 100, lavaSpread: 100, lavaCircleVary: 100};
// Shape options that no world sets: red-2's own stroke carries terraces 7, ledge 40, jitter 60 (card units). Moved on that scene's card.
const CARD_ONLY = [{world: 'red', knob: 'terraces', from: 7, to: 0}, {world: 'red', knob: 'ledge', from: 40, to: 90}, {world: 'red', knob: 'terraceJitter', from: 60, to: 0}];
// H21: read card limits/scales from the same declarations as toolDefaults. Top-level scriptedScene options use engine units and win over the card.
const impactFields = Object.fromEntries([...readFileSync(`${here}sculpt.js`, 'utf8').matchAll(/\['(\w+)','[^']*','[^']*',\[([^\]]*)\],([\d.]+),([\d.]+),[\d.]+,([\d.]+)/g)]
  .filter(m => IMPACTS.test(m[1])).map(m => [m[1], {kinds: [...m[2].matchAll(/'([^']+)'/g)].map(x => x[1]), lo: +m[3], hi: +m[4], scale: +m[5]}]));
// Crater spurs are child hills and inherit the crater's outline parameters (prepareNode); spurCount defaults to zero.
const impactStroke = (knob, st) => impactFields[knob].kinds.includes(st[0]) || (knob === 'moonLobes' && st[0] === 'crater' && (st[2]?.spurCount ?? st[2]?.card?.spurCount ?? 0) > 0);
for (const [k, f] of Object.entries(impactFields)) CARD_SCALE[k] = f.scale;
const family = opt('--family', 'geology');
const FRACTURES = /^(crack(Severity|Spacing|Major|Minor|Hairline|Blocks|Width|Network|Dark)|jointDepth|groove(Spacing|Angle|Run)|gully(Depth|Width|Shade)|ribTilt|facet(Tilt|Coarse)|blocks|block(Row|Width|Tilt|Step|Seam|Chip)|hillBlocks)$/;
const BODIES = /^(crystal[A-Z]\w*|ice[A-Z]\w*|frost[A-Z]\w*|lava(Calm|Chip|Crust|Dusk|Pillow|Veins))$/;
const BODY_CLASS = k => /^crystalCrater/.test(k) ? 'crater' : /^crystalShallow/.test(k) ? 'shallows' : /^(crystalShore|crystalSeam|frost|iceFrost)/.test(k) ? 'shore' : 'raised';
// The stroke kinds that carry each shape option (sculpt.js SHAPE_FIELDS), and the scale of the card's unit.
const KINDS = {crystalForm: ['crystal'], crystalTiers: ['crystal'], crystalSides: ['crystal'], crystalSize: ['crystal'], crystalStep: ['crystal'], crystalCount: ['crystal'], crystalTop: ['crystal'], crystalLean: ['crystal'], crystalVariation: ['crystal'],
  crystalAlign: ['crystal'], crystalFacet: ['crystal'], crystalSizeVar: ['crystal'], crystalSmooth: ['crystal'], crystalCraterPx: ['crater'], crystalCraterStep: ['crater'], crystalCraterSkin: ['crater'],
  crystalShoreSeam: ['deep', 'shallow', 'offset'], frostNeedles: ['deep', 'shallow', 'offset'], iceFacets: ['mountain'], iceFacetSize: ['hill', 'mountain']};
const BODY_SCALE = {crystalForm: 1, crystalTiers: 100, crystalSides: 1, crystalSize: 1, crystalStep: 1, crystalCount: 1, crystalTop: 100, crystalLean: 100, crystalVariation: 100, crystalAlign: 100, crystalFacet: 100, crystalSizeVar: 100, crystalSmooth: 100,
  crystalCraterPx: 1, crystalCraterStep: 10, crystalCraterSkin: 100, crystalShoreSeam: 100, frostNeedles: 100, iceFacets: 100, iceFacetSize: 1};
const impacts = family === 'impacts', shores = family === 'shores', bodies = family === 'bodies', fractures = family === 'fractures' || shores || bodies || impacts;   // both read each scene's own effective value
const scenes = {};   // world -> the three scenes' variants, for the page's own values
const queries = {};   // world -> the three scenes' own query pairs (zhon-1: beachWidth=0), which win over every table
for (const world of ['green', 'red', 'archipelago', 'moon', 'zhon', 'lava', 'desert', 'crystal', 'ice']) {
  const q = [1, 2, 3].map(n => new URLSearchParams(JSON.parse(readFileSync(scenePath(world, n), 'utf8')).query));
  queries[world] = q; scenes[world] = q.map(x => x.get('variant') || '');
}
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
// A stroke card that carries the option wins over the page's default for that stroke (lava-2 asks for four circular layers, ice-3 for no plates). Water strokes that
// disagree (lava-1's first stroke asks for no fingers, the rest take the world's) read `a|b`, and the scene counts as one where the option is not yet at its target.
const cardOf = (world, i, knob, fallback) => {
  const scale = bodies ? BODY_SCALE[knob] : CARD_SCALE[knob];
  if (!scale) return undefined;
  const strokes = JSON.parse(readFileSync(scenePath(world, i + 1), 'utf8')).strokes;
  const kinds = bodies ? KINDS[knob] : ['deep', 'shallow'];
  const f = impactFields[knob];
  const value = impacts ? Math.min(f.hi, Math.max(f.lo, Math.round(Number(fallback) * scale))) / scale : fallback;
  const values = [...new Set(strokes.filter(st => impacts ? impactStroke(knob, st) : kinds.includes(st[0])).map(st => impacts && knob in (st[2] || {}) ? st[2][knob]
    : st[2]?.card && knob in st[2].card ? st[2].card[knob] / scale : value))];
  return values.length ? values.join('|') : impacts ? null : undefined;
};
const effective = (world, knob) => dump.e[world].map((e, i) => {
  const page = queries[world][i].has(knob) ? queries[world][i].get(knob) : e[knob];
  if (impacts && impactFields[knob]) return cardOf(world, i, knob, page);
  return queries[world][i].has(knob) ? page : cardOf(world, i, knob, e[knob]) ?? e[knob];
});
const same = (a, b) => a === null || String(a) === String(b) || (Number(a) === Number(b) && a !== '' && b !== '');
for (const world of fractures ? Object.keys(scenes) : Object.keys(dump.w)) for (const knob of Object.keys(dump.d)) {
  const re = bodies ? BODIES : impacts ? IMPACTS : shores ? SHORES : fractures ? FRACTURES : FAMILY;
  if (bodies && /^lava(Meander|Spread|CircleVary|CreaseVary)$/.test(knob)) continue;   // Shores'
  if (!re.test(knob) || (only.length && !only.includes(world)) || (knobsOnly.length && !knobsOnly.includes(knob))) continue;
  if (fractures) {
    const at = effective(world, knob);
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
  const at = fractures ? effective(world, knob) : null;
  states.push({world, knob, from: fractures ? at.join('/') : dump.w[world]?.[knob] ?? dump.d[knob], applies: at?.map(v => !same(v, to)), to, cls: CLASS(knob)});
}
for (const s of fractures ? [] : CARD_ONLY) if ((!only.length || only.includes(s.world)) && (!knobsOnly.length || knobsOnly.includes(s.knob))) states.push({...s, cls: 'raised', card: true});
if (args.includes('--list')) { for (const s of states) console.log(s.world.padEnd(12), s.knob.padEnd(16), String(s.from).padStart(20), '->', s.to, s.cls); console.log(states.length, 'states'); process.exit(0); }   // --list: the states, no renders
mkdirSync(out, {recursive: true});
const logs = [];
// One world's three scenes into dir, with the query and, optionally, an edit of every stroke card that carries the key.
function render(world, dir, query, edit) {
  for (const n of [1, 2, 3]) {
    let scene = scenePath(world, n);
    // A knob the scene's own query already sets would win over the one appended (the page reads the first), so it leaves the scene's query.
    const key = query ? query.split('=')[0] : '', s = JSON.parse(readFileSync(scene, 'utf8')), own = new URLSearchParams(s.query);
    if (edit || own.has(key)) {
      if (own.has(key)) { own.delete(key); s.query = own.toString(); }
      // A stroke option is read from the stroke's card, never from the query: --family shores sets it on every water stroke (the card wins over the world's default).
      if (edit) for (const st of s.strokes) {
        if (impacts && impactStroke(edit.knob, st)) {
          st[2] = {...st[2], [edit.knob]: edit.value / CARD_SCALE[edit.knob]};
          continue;
        }
        const mine = bodies ? KINDS[edit.knob]?.includes(st[0]) : shores && ['deep', 'shallow'].includes(st[0]);
        if (mine && !st[2]?.card) st[2] = {...st[2], card: {}};
        if (!impacts && st[2]?.card && (edit.knob in st[2].card || mine)) st[2].card[edit.knob] = edit.value;
      }
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
  const scale = s.card ? 1 : bodies ? BODY_SCALE[s.knob] : CARD_SCALE[s.knob];
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
