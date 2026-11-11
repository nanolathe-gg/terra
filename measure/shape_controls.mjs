// H15: does every shape control do something on a landform (the one kind with a section since the specialized tools retired)? One stroke per case on the
// real engine, each control moved from its default; the number is the mean height change (units) over the cells either render raises or lowers by at least
// one unit. A control the panel offers that prints 0.00 is dead.
//   node measure/shape_controls.mjs [--server http://127.0.0.1:<yours>] [--port <cdp>] [--out DIR] [--chrome] [--configs DIR]
// Writes DIR/shape-controls.json; prints one row per control. Exit 1 on a console error. The heights are the authored fields, so the engine runs
// under Node on Dawn (repro/headless.mjs) by default, from this checkout or --server; --chrome plays each case in the page on --server (your own
// sculpt.py server, which --chrome needs: there is no default) and --port (default 9685).
import {cdpPortFree} from '../repro/cdp-port.mjs';
import {shapeControlAvailable} from '../sculpt-control-schema.js';
import {spawn} from 'node:child_process';
import {mkdirSync, writeFileSync} from 'node:fs';
const args = process.argv.slice(2), opt = (n, d) => { const i = args.indexOf(n); return i >= 0 ? args[i + 1] : d; };
const server = opt('--server', ''), port = Number(opt('--port', 9685)), out = opt('--out', 'shape-controls'), inChrome = args.includes('--chrome');
if (inChrome && !server) { console.error('shape_controls.mjs: --chrome needs --server http://127.0.0.1:<port> of your own sculpt.py server (there is no default server).'); process.exit(2); }
const STEP = 4, W = 1000, H = 600, YC = 500, Y0 = YC - H / 2, path = [[420, YC], [560, YC], [700, YC]];
const CARD = {diameter: 280, amount: 80, roughness: 40, softness: 50, cracks: 0};
// H27: a landform stands at an elevation (170: 71 above this 4x4 map's plain of 99), raised to it, with no variation until a row turns it on.
const LAND = {elevation: 170, combine: 0, wander: 0, widthVary: 0, heightVary: 0, curve: {form: 'lfHill'}};   // the hill form: a slope the whole width, where terraces and variation have room
const KINDS = {landform: {extra: LAND}};
// control: the UI's units; `base` is what the control needs on to mean anything (compared with and without the control's own value).
const CONTROLS = {
  curve: {set: {curve: {form: 'cliff'}}},
  terraces: {set: {terraces: 4}},
  ledge: {base: {terraces: 4}, set: {ledge: 90}},
  terraceJitter: {base: {terraces: 4}, set: {terraceJitter: 100}},
  lean: {set: {lean: 300}},
  facing: {base: {lean: 300}, set: {facing: 7}},   // south: the stroke runs east, and north is the default
  breakup: {base: {terraces: 4}, set: {breakup: 100}},
  crestTaper: {set: {crestTaper: 100}},
  // The landform's own (H27). Variation sizes and weights are read with the three variations on; a weight from 0 to 200 percent, a size from its default to 360 px.
  elevation: {set: {elevation: 230}},
  heightReference: {base:{elevation:110},set:{heightReference:1}},
  stepReference: {base:{elevation:20,combine:1,terraces:6,ledge:80},set:{stepReference:1}},
  combine: {set: {combine: 1}},
  wander: {set: {wander: 60}},
  widthVary: {set: {widthVary: 60}},
  heightVary: {set: {heightVary: 20}},
  gullies: {set: {gullies: 100}},   // P1
  gullySize: {base: {gullies: 100}, set: {gullySize: 100}},
  talus: {base: {gullies: 100, curve: {form: 'cliff'}}, set: {talus: 100}},   // P17: cones need Gullies for chutes and a face steeper than the talus angle
  varySize: {base: {wander: 40, widthVary: 40, heightVary: 12}, set: {varySize: 360}},
  wallVary: {base: {wander: 40, gullies: 100}, set: {wallVary: 100}},
  beds: {base: {gullies: 60}, set: {beds: 3}},
  bedSoft: {base: {gullies: 60, beds: 3, bedSoft: 0}, set: {bedSoft: 100}},
  varyFoot: {base: {wander: 40, widthVary: 40, heightVary: 12, varyFoot: 0}, set: {varyFoot: 200}},
  varyMiddle: {base: {wander: 40, widthVary: 40, heightVary: 12, varyMiddle: 0}, set: {varyMiddle: 200}},
  surf: {base: {elevation: -55, combine: 1}, set: {surf: 100}},   // P27: a water stroke's beach profile (Surf from 0 up)
  // lfcrater: the Ground reference (the hill's 71 units over the plain as an offset from the ground), a signed section (a knot below 0, flattened: a moat
  // round the hill), and the impact features. Any impact feature makes the path an impact track, so Ejecta and Secondaries are each read with the other barely on.
  heightRefGround: {base: {elevation: 170}, set: {heightReference: 2, elevation: 71}, under: [['landform', [[560, YC - 400], [560, YC + 400]], {card: {diameter: 900, elevation: 150, combine: 0, wander: 0, widthVary: 0, heightVary: 0, curve: {form: 'lfHill'}}}]]},
  curveSigned: {base: {combine: 2}, set: {combine: 2, curve: {form: 'lfHill', knots: [[0, 0], [.15, -.15], [.3, 0], [.58, .45], [.82, .86], [1, 1]]}}},
  ejecta: {base: {secondaries: 1}, set: {ejecta: 100}},
  secondaries: {base: {ejecta: 5}, set: {secondaries: 6}},
  // lfimpact2: Buckling, on a crater that digs (Ground, below 0) and is big enough to buckle (a 280 px rim radius: all of it), with no other impact row on.
  buckling: {base: {diameter: 900, heightReference: 2, elevation: -20, combine: 2, curve: {form: 'lfCrater'}}, set: {buckling: 100}},
  // lfimpact2: Secondaries' distance, its default (1 rim radius) to 3, with six secondaries.
  secondaryDistance: {base: {secondaries: 6, secondaryDistance: 10}, set: {secondaryDistance: 30}},
  // lfcrystal: the faceted structure (Facet shape) and each shape's rows, with facets on and that shape chosen; the size and coverage on prisms.
  // Spur variation: the spurs' width and height along them, read with six spurs on.
  crestVary: {base: {spurCount: 6, spurLength: 160}, set: {crestVary: 100}},
  facetForm: {base: {iceFacets: 65}, set: {facetForm: 1}},
  crystalStep: {base: {iceFacets: 65, facetForm: 1, crystalStep: 0}, set: {crystalStep: 32}},
  crystalTiers: {base: {iceFacets: 65, facetForm: 1, crystalTiers: 0}, set: {crystalTiers: 100}},
  crystalFacet: {base: {iceFacets: 65, facetForm: 1, crystalFacet: 0}, set: {crystalFacet: 100}},
  crystalSizeVar: {base: {iceFacets: 65, facetForm: 1, crystalSizeVar: 0}, set: {crystalSizeVar: 100}},
  iceFacets: {base: {iceFacets: 20, facetForm: 2}, set: {iceFacets: 90}},
  iceFacetSize: {base: {iceFacets: 60, facetForm: 2, iceFacetSize: 24}, set: {iceFacetSize: 96}},
  crystalSides: {base: {iceFacets: 60, facetForm: 2, crystalSides: 3}, set: {crystalSides: 8}},
  crystalTop: {base: {iceFacets: 60, facetForm: 2, crystalTop: 0}, set: {crystalTop: 90}},
  crystalVariation: {base: {iceFacets: 60, facetForm: 2, crystalVariation: 0}, set: {crystalVariation: 100}},
  crystalAlign: {base: {iceFacets: 60, facetForm: 2, crystalAlign: 0}, set: {crystalAlign: 100}},
  bergJitter: {base: {iceFacets: 60, facetForm: 2, bergJitter: 0}, set: {bergJitter: 100}},
  bergBreak: {base: {iceFacets: 60, facetForm: 2, bergBreak: 0}, set: {bergBreak: 6}},
  bergRough: {base: {iceFacets: 60, facetForm: 2, bergRough: 0}, set: {bergRough: 20}},
};
// The panel's own test: the control is shown to this kind (sculpt.js SHAPE_FIELDS kinds, all landform here, then shapeControlAvailable).
const shown = (key, kind, card) => kind === 'landform' && shapeControlAvailable(key, kind, {faceVariation: 80, ...card, lean: card.lean / 100, terraces: card.terraces || 0, ledge: .6, terraceJitter: .35});
const sleep = ms => new Promise(r => setTimeout(r, ms));
mkdirSync(out, {recursive: true});
const only = opt('--kinds', '').split(',').filter(Boolean);   // H27: only these kinds (a landform run does not repeat the others)
const rows = [], logs = [];
const moved = (a, b) => { const g = a[0]; let s = 0, n = 0; for (let i = 0; i < a.length; i++) { if (Math.abs(a[i] - g) < 1 && Math.abs(b[i] - g) < 1) continue; s += Math.abs(a[i] - b[i]); n++; } return n ? s / n : 0; };
async function sweep(heights) {
  for (const [name, d] of Object.entries(KINDS)) for (const [variant, face] of [['open', {}]]) {
    if (only.length && !only.includes(name)) continue;
    const kind = d.kind || name, card = {...CARD, ...(d.extra || {}), ...face}, cache = new Map();
    // `under`: strokes played first (a row whose control reads the ground under the stroke).
    const at = (c, under = []) => { const k = JSON.stringify([c, under]); if (!cache.has(k)) cache.set(k, heights(kind, c, under)); return cache.get(k); };
    for (const [key, c] of Object.entries(CONTROLS)) {
      const base = {...card, ...c.base}, show = shown(key, kind, base);
      rows.push({kind: name, variant, control: key, shown: show, moved: moved(await at(base, c.under), await at({...base, ...c.set}, c.under))});
    }
  }
}
const page = `biome=green&mapX=4&mapY=4&scratch=ctl${Date.now()}&gpuMB=512&heapMB=1536`;
if (!inChrome) {
  // The page's scene, as sculptDebug.scene plays it, on one engine: each case replaces the map's nodes and reads the authored heights back.
  const headless = await import('../repro/headless.mjs');
  await headless.openHost({server, configs: opt('--configs', '')});
  const s = await headless.openScene({biome: 'green', strokes: []}, page);
  try {
    await sweep(async (kind, card, under = []) => {
      s.play([...under, [kind, path, {card}]], {ground: false}); await s.fields.ready();
      const o = []; for (let y = 0; y < H; y += STEP) for (let x = 0; x < W; x += STEP) o.push(s.fields.sample(x, y + Y0)); return o;
    });
    logs.push(...s.errors);
  } finally { s.dispose(); }
} else {
await cdpPortFree(port);
const chrome = spawn('/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', ['--headless=new', '--enable-gpu', '--use-angle=metal', `--remote-debugging-port=${port}`,
  `--user-data-dir=${out}/.profile-${port}-${Date.now()}`, '--window-size=1500,1200', '--no-first-run', 'about:blank'], {stdio: 'ignore'});
try {
  let ws; for (let i = 0; i < 100 && !ws; i++) { try { const p = (await (await fetch(`http://127.0.0.1:${port}/json/list`)).json()).find(x => x.type === 'page'); if (p) ws = new WebSocket(p.webSocketDebuggerUrl); } catch {} if (!ws) await sleep(200); }
  await new Promise(r => ws.onopen = r);
  let id = 0; const wait = new Map();
  ws.onmessage = e => { const m = JSON.parse(e.data); if (m.id && wait.has(m.id)) { wait.get(m.id)(m); wait.delete(m.id); } if (m.method === 'Runtime.exceptionThrown') logs.push(m.params.exceptionDetails.exception?.description || m.params.exceptionDetails.text); if (m.method === 'Runtime.consoleAPICalled' && m.params.type === 'error') logs.push(m.params.args.map(a => a.value ?? a.description).join(' ').slice(0, 300)); };
  const send = (method, params = {}) => new Promise(r => { const k = ++id; wait.set(k, r); ws.send(JSON.stringify({id: k, method, params})); });
  const ev = async expression => { const r = await send('Runtime.evaluate', {expression, awaitPromise: true, returnByValue: true}); if (r.result?.exceptionDetails) throw new Error(r.result.exceptionDetails.exception?.description || r.result.exceptionDetails.text); return r.result.result.value; };
  const ready = async () => { for (let i = 0; i < 480; i++) { await sleep(120); if (await ev('!!window.sculptCanvas&&!document.getElementById("map-export").disabled')) return true; } throw new Error('never ready ' + logs.join('|')); };
  await send('Runtime.enable'); await send('Page.enable');
  await send('Page.navigate', {url: `${server}/sculpt.html?${page}`}); await ready();
  await sweep(async (kind, card, under = []) => {
    await ev(`sculptDebug.scene(${JSON.stringify([...under, [kind, path, {card}]])},{ground:false})`); await ready(); await ev('sculptCanvas.idle()');
    return ev(`(() => { const o = []; for (let y = 0; y < ${H}; y += ${STEP}) for (let x = 0; x < ${W}; x += ${STEP}) o.push(sculptDebug.corner(x, y + ${Y0}).authored); return o; })()`);
  });
  ws.close();
} finally { chrome.kill(); }
}
writeFileSync(`${out}/shape-controls.json`, JSON.stringify({rows, console: logs.slice(0, 10)}));
const names = Object.keys(KINDS), keys = Object.keys(CONTROLS);
for (const variant of ['open']) {
  console.log(`\n${variant.padEnd(15)}${names.map(n => n.padStart(9)).join('')}`);
  for (const key of keys) console.log(key.padEnd(15) + names.map(n => { const r = rows.find(x => x.kind === n && x.variant === variant && x.control === key); return (!r ? '' : r.moved.toFixed(2) + (r.shown ? (r.moved < .01 ? ' !' : '  ') : ' -')).padStart(9); }).join(''));
}
console.log('\n! shown but dead   - hidden from this stroke');
if (logs.length) console.log('console:', logs.slice(0, 5));
process.exit(logs.length ? 1 : 0);
