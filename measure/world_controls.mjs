// H22b: does every control the panel offers change the picture? In each of the nine worlds, on a few page loads and never one per control, every
// world row the panel shows enabled, every stroke option the panel shows on a stroke kind, and the eight page sliders are moved from their low
// end to their high end on a fixture that holds the features, and the two captures are compared: the most any pixel channel moves, and how many
// pixels change at all. A direction (`wind`, `*Dir`) moves a half turn, because the two ends of a full turn are one value. Each control is put
// back after its pair, and at the end of a world the first fixture is drawn again and must match its first capture, so no row leaks into the next.
//   node measure/world_controls.mjs [--find key,key] [--out DIR] [--worlds green,lava] [--variant modern] [--only key,key] [--set key=v,key=v] [--jobs 3] [--configs DIR]
//        [--chrome --audit-port <yours> --assets DIR --port <cdp> | --chrome --server <a running audit host> --port <cdp>]
// The sweep runs under Node on Dawn by default (repro/headless.mjs, from this checkout's files; --configs DIR for sculpt.py --dump-configs output):
// a world is a page load in the page's own modules, a knob goes in through sculpt-knobs.js applyKnob as the page's setKnob does, a capture is one
// chunk baked as the page's debugBake bakes it, and the panel's rows are the ones sculpt.js buildKnobs makes, each enabled or not by
// worldControlRequirement on sculpt-knobs.js worldPanelValues, the same functions the panel runs. The surface sliders the panel offers are
// read from sculpt.html's markup (one inside a hidden container is not offered). --chrome sweeps the page in headless Chrome instead, and also
// checks that the panel's own rows say what the schema says (the panel's DOM): it needs the audit host, which it starts itself on --audit-port
// (your own: there is no default; --assets DIR is that host's assets root, which needs map-catalog.json and features/, as a card's own root has),
// or --server for one already running; terraformAudit exists only on that host's ?audit pages.
// --jobs splits the worlds over that many processes (Node) or browsers (Chrome; CDP ports --port, then --port+2, +3, ...). Alone, a world takes
// about four minutes in Chrome.
// --find key,key: instead of the sweep, set each other enabled row to its high end in turn and print which of the named rows then move (the search for a row's parent).
// Writes DIR/world-controls.json and prints one row per control and world. Exit 1 on a console error or on an unexplained exact 0, that is a
// row that reads 0 on every fixture (the world's three scenes, the diagnostic fixture, the painted fixture; stroke rows the second and wide stroke fixtures and
// Sand over the first) and is not on `ALLOWED` below. A row the panel disables with a reason is swept twice: with its parents set (state "gated"), which proves it comes back, and as it
// stands on every fixture while its reason holds (state "hidden"), which proves the reason true: it fails if the row moves HIDDEN_PX pixels or more,
// since a wrong gate hides a live control and nothing else would show it. The water rows are read once more under a Shallow water color, which no scene picks.
// --set puts values in before the sweep, to probe a row under a gate.
import {cdpPortFree} from '../repro/cdp-port.mjs';
import {worldControlRequirement, shapeControlAvailable, PARKED_WORLD_CONTROLS, LANDFORM_FACET_KEYS} from '../sculpt-control-schema.js';
import {spawn} from 'node:child_process';
import {mkdirSync, writeFileSync, readFileSync, existsSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {dirname, join, resolve} from 'node:path';
const here = dirname(fileURLToPath(import.meta.url)), repo = resolve(here, '..');
const args = process.argv.slice(2), opt = (n, d) => { const i = args.indexOf(n); return i >= 0 ? args[i + 1] : d; };
const JOBS = Number(opt('--jobs', 3)), CHILD = args.includes('--child'), CHROME = args.includes('--chrome');
const assets = opt('--assets', ''), port = Number(opt('--port', 9685)), out = resolve(opt('--out', 'world-controls')), auditPort = Number(opt('--audit-port', 0));
if (CHROME && !opt('--server', '') && !auditPort) { console.error('world_controls.mjs: --chrome needs --audit-port <port> (your own: the tool starts the audit host there) or --server <an audit host already running>; there is no default.'); process.exit(2); }
const WORLDS = opt('--worlds', 'green,archipelago,crystal,desert,ice,lava,moon,red,zhon').split(',');
const VARIANT = opt('--variant', '');
const FIND = opt('--find', '') ? opt('--find', '').split(',') : null;
const ONLY = opt('--only', '') ? opt('--only', '').split(',') : null;
const SET = Object.fromEntries((opt('--set', '') || '').split(',').filter(Boolean).map(s => s.split('=')).map(([k, v]) => [k, Number(v)]));
// Rows that read 0 and are kept on purpose. A reason a reader can check, or the row is a finding, not an entry.
const ALLOWED = {};
// A cancelled term leaves float rounding (Desert's bedSpacing, 1 px), not a control.
const HIDDEN_PX = 8;
// The rows a picked water color changes the answer for; no scene picks one, so the sweep does (H25).
const COLORED_ROWS = new Set(['deepEdge', 'shallowDepth', 'deepDepth', 'waterSoft', 'bandWater', 'bedLit', 'bedTint', 'bedBright', 'bedContrast', 'bedFlat', 'bedDots', 'shoalGrain', 'shoalBump']);
const reasonFor = r => ALLOWED[(r.stroke ? r.stroke + ':' : '') + r.key] || ALLOWED[r.key] || null;
const failed = r => (r.zero && !r.allowed) || r.leak || r.hides;
const named = r => `${r.world} ${r.stroke ? r.stroke + ':' : ''}${r.key}${r.hides ? ' moves while the panel says "' + r.reason + '"' : ''}`;
const judge = rows => { for (const r of rows) if (r.zero) { r.allowed = reasonFor(r); } return rows.filter(failed).map(named); };
// --recheck DIR: judge a finished sweep's file again against the lists above, with no browser.
if (args.includes('--recheck')) {
  const f = JSON.parse(readFileSync(join(resolve(opt('--recheck', '.')), 'world-controls.json'), 'utf8')), bad = judge(f.rows);
  console.log(`${f.rows.filter(r => r.zero).length} read 0: ${f.rows.filter(r => r.allowed).length} allowed, ${bad.length} unexplained`);
  for (const b of bad) console.log('!', b);
  process.exit(bad.length || f.console.length ? 1 : 0);
}
const SURFACE = [['relief', 0, 160], ['transition-detail', 0, 100], ['mineral-ring', 0, 100], ['ring-spread', 0, 100], ['ring-variation', 0, 100], ['material-weathering', 0, 100], ['deposit-spread', 0, 100]];
// The stroke kinds that carry SHAPE_FIELDS rows, drawn one each on a grid of the 1024 px window.
// lfcrater, lfcrystal: the Crater and Crystals buttons draw landforms, so the old crater and crystal kinds have no stroke here; their rows go with them.
const KIND_AT = {fissure: [130, 830], erase: [380, 830], paint: [630, 830], landform: [880, 830]};
// The retired tools' strokes as the landforms the shape buttons draw (sea-relative, about as tall above this map's plain as the old fixtures' Rise).
const PLATEAU = (pts, rise, card = {}) => ['landform', pts, {card: {heightReference: 1, elevation: 24 + rise, wander: 40, widthVary: 30, ...card}}];
const RIDGE = (pts, rise, card = {}) => ['landform', pts, {card: {heightReference: 1, elevation: 24 + rise, lean: 100, wander: 8, widthVary: 0, ...card}, curve: {form: 'lfMountain'}}];
const WATER = (pts, card = {}, picks = {}) => ['landform', pts, {card: {heightReference: 1, elevation: -55, combine: 1, cracks: 0, wander: 30, widthVary: 30, varySize: 210, ...card}, curve: {form: 'lfShore'}, ...picks}];
// The panel hides these until their switch is above 0 (updateControls in sculpt.js).
const GATE = {gullySize: 'gullies', talus: 'gullies', layerPx: 'shoreLayers', layerRiser: 'shoreLayers', layerLedge: 'shoreLayers', layerRough: 'shoreLayers', layerStyle: 'shoreLayers', layerVary: 'shoreLayers', layerCircle: 'shoreLayers', iceFacetSize: 'iceFacets', facetForm: 'iceFacets', fingerSize: 'fingers',
  spurLength: 'spurCount', spurSpread: 'spurCount', spurWidth: 'spurCount', spurTaper: 'spurCount', spurHeight: 'spurCount', spurForks: 'spurCount', spurBulb: 'spurCount', rimUnequal: 'rimSectors', rimGapWidth: 'rimGaps', fissureBranchLen: 'fissureBranches', fissureBranchSpread: 'fissureBranches', lavaSpread: 'shoreLayers', lavaCircleVary: 'shoreLayers'};
const sleep = ms => new Promise(r => setTimeout(r, ms));
const rows = [], logs = [], t0 = Date.now();
mkdirSync(out, {recursive: true});
let server = opt('--server', ''), audit = null, configs = opt('--configs', '');
if (!CHROME && !configs && !CHILD) { const {dumpConfigs} = await import('../repro/headless.mjs'); configs = dumpConfigs(); }   // once for every child
if (CHROME && !server) {
  server = `http://127.0.0.1:${auditPort}`;
  const py = process.env.PYTHON || '/Users/daniel/src/terraform/.venv/bin/python';
  audit = spawn(py, [join(repo, 'repro/audit/server.py'), '--source', repo, '--port', String(auditPort), '--out', join(out, 'audit-out'), ...(assets ? ['--assets', assets] : [])], {stdio: 'ignore'});
  for (let i = 0; i < 100; i++) { try { if ((await fetch(server + '/audit/index.html')).ok) break; } catch {} await sleep(100); }
}
if (JOBS > 1 && !CHILD && WORLDS.length > 1) {
  // A pool of browsers, one child per world, the dearest worlds first; rows are merged into the same file and the same exit code.
  const pass = []; for (const f of ['--only', '--set', '--variant']) if (opt(f, '')) pass.push(f, opt(f, ''));
  const cost = {green: 3, zhon: 2, red: 2}, order = [...WORLDS].sort((a, b) => (cost[b] || 1) - (cost[a] || 1)), queue = [...order], codes = [], tries = {};
  const slots = Array.from({length: Math.min(JOBS, WORLDS.length)}, (_, k) => new Promise(async done => {
    for (let w; (w = queue.shift());) {
      await new Promise(next => {
        const host = CHROME ? ['--chrome', '--server', server, '--port', String(port + (k ? k + 1 : 0))] : ['--configs', configs];
        const c = spawn(process.execPath, [fileURLToPath(import.meta.url), '--child', ...host, '--worlds', w, '--out', join(out, w), ...pass], {stdio: ['ignore', 'pipe', 'inherit']});
        let buf = ''; c.stdout.on('data', d => { buf += d; const lines = buf.split('\n'); buf = lines.pop(); for (const l of lines) console.log(l); });
        // A browser the host killed for memory leaves no file: that world goes round again, twice at most.
        c.on('close', code => { if (!existsSync(join(out, w, 'world-controls.json')) && (tries[w] = (tries[w] || 0) + 1) < 3) { console.error(`${w}: no result (exit ${code}), run again`); queue.push(w); } else codes.push(code); next(); });
      });
    }
    done();
  }));
  await Promise.all(slots); audit?.kill();
  const merged = WORLDS.map(w => JSON.parse(readFileSync(join(out, w, 'world-controls.json'), 'utf8')));
  const all = merged.flatMap(m => m.rows), bad = judge(all), con = merged.flatMap(m => m.console);
  writeFileSync(join(out, 'world-controls.json'), JSON.stringify({server: CHROME ? server : 'node', variant:VARIANT||null, seconds: (Date.now() - t0) / 1000, rows: all, unexplained: bad, console: con}));
  console.log(`\n${all.filter(r => r.type === 'knob' && r.state === 'enabled').length} enabled world rows, ${all.filter(r => r.type === 'knob' && r.state === 'gated').length} gated, ${all.filter(r => r.type === 'shape').length} stroke rows, ${all.filter(r => r.type === 'surface').length} sliders; ${all.filter(r => r.zero).length} read 0 (${all.filter(r => r.allowed).length} allowed), ${all.filter(r => r.hides).length} hidden and moving, ${bad.length} unexplained (!), ${((Date.now() - t0) / 60000).toFixed(1)} min`);
  if (con.length) console.log('console:', con.slice(0, 5));
  process.exit(codes.some(c => c > 1) || con.length || bad.length ? 1 : 0);
}
const scenes = {};
for (const w of WORLDS) for (const n of [1, 2, 3]) {
  for(const name of [`${w}-${n}`,...(VARIANT?[`${w}-${VARIANT}-${n}`]:[])]){
    const file=join(repo,`repro/scenes/${name}.json`);
    if(existsSync(file))scenes[name]=JSON.parse(readFileSync(file,'utf8'));
  }
}
// The stroke kinds whose tool defaults the state reads.
const KINDS = Object.fromEntries(Object.keys(KIND_AT).map(k => [k, 1]));
const pageQuery = (world, query) => { if(VARIANT){const params=new URLSearchParams(query);params.set('variant',VARIANT);query=params.toString();} return `biome=${world}&mapX=4&mapY=4&scratch=wc${Date.now()}&audit=1&gpuMB=512&heapMB=2048${query ? '&' + query : ''}`; };
// The two numbers of a pair: the most any pixel channel moves, and how many pixels move at all (RGBA captures, alpha left out).
const diff = (a, b) => { let max = 0, n = 0; for (let i = 0; i < a.length; i += 4) { const d = Math.max(Math.abs(a[i] - b[i]), Math.abs(a[i + 1] - b[i + 1]), Math.abs(a[i + 2] - b[i + 2])); if (d) { n++; if (d > max) max = d; } } return {max, px: n}; };
// The host the sweep drives, the same calls on either: the page in headless Chrome on the audit host (terraformAudit; the captures stay in the
// page and only the two numbers travel), or the page's own modules under Node on Dawn (repro/headless.mjs).
async function chromeHost() {
  await cdpPortFree(port);
  const chrome = spawn('/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', ['--headless=new', '--enable-gpu', '--use-angle=metal', `--remote-debugging-port=${port}`,
    `--user-data-dir=${out}/.profile-${port}-${Date.now()}`, '--window-size=1500,1200', '--no-first-run', 'about:blank'], {stdio: 'ignore'});
  let ws, id = 0; const wait = new Map();
  const close = () => { try { ws?.close(); } catch {} chrome.kill(); };
  try {
    for (let i = 0; i < 100 && !ws; i++) { try { const p = (await (await fetch(`http://127.0.0.1:${port}/json/list`)).json()).find(x => x.type === 'page'); if (p) ws = new WebSocket(p.webSocketDebuggerUrl); } catch {} if (!ws) await sleep(200); }
    await new Promise(r => ws.onopen = r);
  } catch (e) { close(); throw e; }
  ws.onmessage = e => { const m = JSON.parse(e.data); if (m.id && wait.has(m.id)) { wait.get(m.id)(m); wait.delete(m.id); } if (m.method === 'Runtime.exceptionThrown') logs.push(m.params.exceptionDetails.exception?.description || m.params.exceptionDetails.text); if (m.method === 'Runtime.consoleAPICalled' && m.params.type === 'error') logs.push(m.params.args.map(a => a.value ?? a.description).join(' ').slice(0, 300)); };
  const send = (method, params = {}) => new Promise(r => { const k = ++id; wait.set(k, r); ws.send(JSON.stringify({id: k, method, params})); });
  const ev = async expression => { const r = await send('Runtime.evaluate', {expression, awaitPromise: true, returnByValue: true}); if (r.result?.exceptionDetails) throw new Error(r.result.exceptionDetails.exception?.description || r.result.exceptionDetails.text); return r.result.result.value; };
  await send('Runtime.enable'); await send('Page.enable');
  // In-page helpers: captures stay in the page; only the two numbers travel.
  const HELPERS = `window.__wc = (() => {
    const A = window.terraformAudit, rect = {x: 0, y: 0, width: 1024, height: 1024};
    const grab = async (r = rect) => { const c = await A.capture(r); return c.canvas.getContext('2d').getImageData(0, 0, r.width, r.height).data; };
    let saved = [];
    const diff = (a, b) => { let max = 0, n = 0; for (let i = 0; i < a.length; i += 4) { const d = Math.max(Math.abs(a[i] - b[i]), Math.abs(a[i + 1] - b[i + 1]), Math.abs(a[i + 2] - b[i + 2])); if (d) { n++; if (d > max) max = d; } } return {max, px: n}; };
    let first = null;
    return {
      async remember() { first = await grab(); },
      async same() { const d = diff(first, await grab()); return d; },
      async knobPair(key, lo, hi) { const was = A.renderer.variant.get(key); await A.knob(key, lo); const a = await grab(); await A.knob(key, hi); const b = await grab(); await A.knob(key, was ?? A.config.defaults[key] ?? 0); return diff(a, b); },
      async controlPair(id, lo, hi) { const was = document.getElementById(id).value; await A.control(id, lo); const a = await grab(); await A.control(id, hi); const b = await grab(); await A.control(id, was); return diff(a, b); },
      async scene(strokes, ground) { A.scene(strokes, {ground}); await A.idle(); saved = A.nodes.map(n => ({...n.params})); },
      // One edit puts the stroke back to its drawn state, sets the row's context and its low end; the next pair's first edit is the restore of this one.
      async strokePair(i, key, ctx, lo, his, scale, crop) {
        await A.edit(i, {...saved[i], ...ctx, [key]: lo / scale}); const a = await grab(crop); let best = {max: 0, px: 0};
        for (const hi of his) { await A.edit(i, {[key]: hi / scale}); const d = diff(a, await grab(crop)); if (d.max > best.max || (d.max === best.max && d.px > best.px)) best = {...d, hi}; }
        return best;
      },
      // The Colors panel's own row: a hex picks the color, nothing clears it.
      pickColor(label, hex) { const [box, pick] = [...document.querySelectorAll('#world-colors .color-row')].find(r => r.firstElementChild.textContent === label).querySelectorAll('input'); if (hex) { pick.value = hex; pick.dispatchEvent(new Event('input', {bubbles: true})); } else { box.checked = false; box.dispatchEvent(new Event('change', {bubbles: true})); } },
      // A light color row (P12b): the picture with the color picked against the picture without it.
      async colorPair(label, hex) { this.pickColor(label); await A.idle(); const a = await grab(); this.pickColor(label, hex); await A.idle(); const b = await grab(); this.pickColor(label); await A.idle(); return diff(a, b); },
      kinds() { return A.nodes.map(n => n.kind); },
      async putBack() { for (let i = 1; i < saved.length; i++) await A.edit(i, saved[i]); },
      // a row is off by its reason line, not its disabled flag: the audit page's busy map disables the rendering switches too
      state() { return {values: A.panelValues(), panel: [...document.querySelectorAll('#knobs [data-knob], #rendering-host [data-knob]')].map(r => ({key: r.dataset.knob, off: Boolean(r.querySelector('.control-requirement')?.textContent), reason: r.querySelector('.control-requirement')?.textContent || ''})), variant: Object.fromEntries(A.renderer.variant), knobs: A.knobs, fields: A.fields, defaults: Object.fromEntries(Object.keys(KINDS).map(k => [k, A.defaults(k)])), nodes: A.nodes.map(n => n.kind)}; },
      scenes: null
    };
  })()`;
  const q = JSON.stringify;
  return {
    async load(world, query) {
      await send('Page.navigate', {url: `${server}/sculpt.html?${pageQuery(world, query)}`});
      for (let i = 0; i < 400; i++) { await sleep(150); try { if (await ev('!!window.terraformAudit&&document.readyState==="complete"')) break; } catch {} }
      await ev('terraformAudit.ready()'); await ev(HELPERS.replace('KINDS', q(KINDS))); await ev('terraformAudit.idle()');
    },
    setUp: set => ev(`(async () => { for (const [k, v] of Object.entries(${q(set)})) await terraformAudit.knob(k, v); return __wc.state(); })()`),
    panelValues: () => ev('terraformAudit.panelValues()'),
    variant: key => ev(`terraformAudit.renderer.variant.get(${q(key)})`),
    knob: (key, value) => ev(`terraformAudit.knob(${q(key)}, ${q(value)})`),
    restoreAll: base => ev(`(async () => { for (const [k, v] of Object.entries(${q(base)})) if (terraformAudit.renderer.variant.get(k) !== v) await terraformAudit.knob(k, v); })()`),
    knobPair: (key, lo, hi) => ev(`__wc.knobPair(${q(key)}, ${lo}, ${hi})`),
    controlPair: (sid, lo, hi) => ev(`__wc.controlPair(${q(sid)}, ${lo}, ${hi})`),
    scene: (list, ground) => ev(`__wc.scene(${q(list)}, ${ground})`),
    remember: () => ev('__wc.remember()'),
    same: () => ev('__wc.same()'),
    strokePair: (i, key, ctx, lo, his, scale, crop) => ev(`__wc.strokePair(${i}, ${q(key)}, ${q(ctx)}, ${lo}, ${q(his)}, ${scale}, ${q(crop)})`),
    pickColor: (label, hex) => ev(`__wc.pickColor(${q(label)}${hex ? ', ' + q(hex) : ''})`),
    colorPair: (label, hex) => ev(`__wc.colorPair(${q(label)}, ${q(hex)})`),
    hasColorRow: label => ev(`[...document.querySelectorAll('#world-colors .color-row')].some(r=>r.firstElementChild.textContent===${q(label)})`),
    sliderShown: sid => ev(`!document.getElementById(${q(sid)}).closest('[hidden]:not([role=tabpanel])')`),
    kinds: () => ev('__wc.kinds()'),
    putBack: () => ev('__wc.putBack()'),
    setBusy: on => ev(`terraformAudit.setBusy(${on})`),
    domPanel: true,   // the panel's rows are its DOM: check them against the schema
    drain() {},
    close
  };
}
// The surface sliders the panel offers: sculpt.html's markup, where a slider inside a container marked hidden (other than an inspector tab, which a
// click shows) is not offered, as the Chrome sweep asks the page (closest('[hidden]:not([role=tabpanel])')), with the groups the page shows or hides
// by the world's layers (sculpt-scene.js surfaceGroupsHidden). The legacy surface panel is hidden.
function offeredSliders(groups) {
  const html = readFileSync(join(repo, 'sculpt.html'), 'utf8'), open = [], offered = new Set();
  const VOID = new Set(['area', 'base', 'br', 'col', 'embed', 'hr', 'img', 'input', 'link', 'meta', 'source', 'track', 'wbr']);
  for (const [, close, name, attrs, self] of html.matchAll(/<(\/?)([a-zA-Z][\w-]*)((?:[^>"]|"[^"]*")*?)(\/?)>/g)) {
    const tag = name.toLowerCase(), bare = attrs.replace(/"[^"]*"/g, '""');
    if (close) { const k = open.findLastIndex(e => e.tag === tag); if (k >= 0) open.length = k; continue; }
    const sid = /\bid="([^"]*)"/.exec(attrs)?.[1];
    if (sid && SURFACE.some(([x]) => x === sid) && !open.some(e => e.hidden)) offered.add(sid);
    if (!VOID.has(tag) && !self) open.push({tag, hidden: sid in groups ? groups[sid] : /(^|\s)hidden(\s|=|$)/.test(bare) && !/\brole="tabpanel"/.test(attrs)});
  }
  return offered;
}
// Under Node: a page load is a scene opened as the page opens it, and each call does what the audit host's does, with the page's own code for a knob
// (sculpt-knobs.js applyKnob), a slider, a stroke edit, a color row and the panel's facts. A capture is one chunk, as debugBake bakes it.
async function nodeHost() {
  const headless = await import('../repro/headless.mjs'), {KNOBS, COLOR_KEYS, colorRows} = await import('../sculpt-knobs.js'), {SHAPE_FIELDS, toolDefaults} = await import('../sculpt-scene.js');
  await headless.openHost({configs});
  const keyOf = label => COLOR_KEYS.find(([, l]) => l === label)[0];
  const WEATHER_KEYS = ['erosion', 'erosionAge', 'erosionRain', 'erosionEnvelope'];   // the audit host's knob runs the Time pass again for these (repro/audit/hook.js)
  const rect = {x: 0, y: 0, width: 1024, height: 1024};
  let s = null, saved = [], first = null;
  const grab = (r = rect) => headless.renderWindow(s, {...r, tile: Math.max(r.width, r.height)});
  const knob = (key, value) => headless.knob(s, key, value, {weatherKeys: WEATHER_KEYS});
  const drain = () => { if (s) logs.push(...s.errors.splice(0)); };
  const h = {
    async load(world, query) {
      drain(); s?.dispose();
      s = await headless.openScene({biome: world, strokes: []}, pageQuery(world, query));
      s.renderer.setBudgetMB(512);   // the page's terrain budget (gpuMB): a 1024 px capture is one chunk
    },
    async setUp(set) { for (const [k, v] of Object.entries(set)) await knob(k, v); return h.state(); },
    async state() {
      // sculpt.js buildKnobs: a row for each knob that is not parked; the panel disables it by worldControlRequirement on these values.
      const values = await headless.panelValues(s);
      const panel = KNOBS.flatMap(([, list]) => list).filter(([key]) => !PARKED_WORLD_CONTROLS.has(key)).map(([key]) => { const reason = worldControlRequirement(key, values) || ''; return {key, off: Boolean(reason), reason}; });
      return {values, panel, variant: Object.fromEntries(s.renderer.variant), knobs: KNOBS, fields: SHAPE_FIELDS, defaults: Object.fromEntries(Object.keys(KINDS).map(k => [k, toolDefaults(s.config, k)])), nodes: s.nodes.map(n => n.kind)};
    },
    panelValues: () => headless.panelValues(s),
    variant: key => s.renderer.variant.get(key),
    knob,
    async restoreAll(base) { for (const [k, v] of Object.entries(base)) if (s.renderer.variant.get(k) !== v) await knob(k, v); },
    async knobPair(key, lo, hi) { const was = s.renderer.variant.get(key); await knob(key, lo); const a = await grab(); await knob(key, hi); const b = await grab(); await knob(key, was ?? s.config.defaults[key] ?? 0); return diff(a, b); },
    async controlPair(sid, lo, hi) { const was = s.sliders[sid]; await headless.slider(s, sid, lo); const a = await grab(); await headless.slider(s, sid, hi); const b = await grab(); await headless.slider(s, sid, was); return diff(a, b); },
    async scene(list, ground) { await headless.scene(s, list, {ground}); saved = s.nodes.map(n => ({...n.params})); },
    async remember() { first = await grab(); },
    async same() { return diff(first, await grab()); },
    // One edit puts the stroke back to its drawn state, sets the row's context and its low end; the next pair's first edit is the restore of this one.
    async strokePair(i, key, ctx, lo, his, scale, crop) {
      await headless.edit(s, i, {...saved[i], ...ctx, [key]: lo / scale}); const a = await grab(crop); let best = {max: 0, px: 0};
      for (const hi of his) { await headless.edit(s, i, {[key]: hi / scale}); const d = diff(a, await grab(crop)); if (d.max > best.max || (d.max === best.max && d.px > best.px)) best = {...d, hi}; }
      return best;
    },
    // The Colors panel's own row: a hex picks the color, nothing clears it.
    pickColor: (label, hex) => headless.pickColor(s, keyOf(label), hex || null),
    async colorPair(label, hex) { await h.pickColor(label); const a = await grab(); await h.pickColor(label, hex); const b = await grab(); await h.pickColor(label); return diff(a, b); },
    hasColorRow: label => colorRows(s.config, s.settings).some(([, l]) => l === label),
    sliderShown: sid => offeredSliders(s.engine.surfaceGroupsHidden(s.config)).has(sid),
    kinds: () => s.nodes.map(n => n.kind),
    async putBack() { for (let i = 1; i < saved.length; i++) await headless.edit(s, i, saved[i]); },
    setBusy() {},   // the audit page's busy map refuses edits; here nothing is busy
    domPanel: false,
    drain,
    close() { drain(); s?.dispose(); s = null; }
  };
  return h;
}
const host = CHROME ? await chromeHost() : await nodeHost();
const finish = code => { host.close(); audit?.kill(); process.exit(code); };
try {
  const fixtureName=(world,i)=>VARIANT&&scenes[`${world}-${VARIANT}-${i}`]?`${world}-${VARIANT}-${i}`:`${world}-${i}`;
  const strokes = world => scenes[fixtureName(world,1)];
  // A fixture is a stroke list. The diagnostic one is runner.js's: a plateau, a ridge, deep water with shore plates, sand and paint.
  const diagnostic = world => [PLATEAU([[270, 300], [550, 300]], 110, {diameter: 400, cracks: 100}), RIDGE([[800, 150], [860, 430]], 130, {diameter: 320, cracks: 100}),
    WATER([[0, 850], [1024, 850]], {diameter: 600, shorePlates: 1, plateMaterial: world === 'ice' ? 2 : 1}, {waterDeep: 0, waterBed: 0}), ['sand', [[350, 470], [650, 470]], {card: {diameter: 280, amount: 100}}], ['paint', [[350, 100], [500, 270]], {card: {diameter: 220, amount: 100, paintChannel: 1}}]];
  // The painted fixture: a ridge and a plateau with every paint channel laid on them, for the rows a painted or per-stroke path keeps alive at a world value of 0
  // (the stones of Denser scatter, the lines of Style: banding).
  const painted = () => [RIDGE([[300, 220], [700, 220]], 130, {diameter: 420, cracks: 100}), PLATEAU([[300, 760], [700, 760]], 100, {diameter: 420, cracks: 100}),
    // two water strokes with the choices the panel cannot show on the world: frost-needle shore plates (Melt pockets), and a cracked bed under a hard step
    WATER([[60, 960], [460, 960]], {diameter: 200, shorePlates: 1, plateMaterial: 2}), WATER([[560, 960], [960, 960]], {diameter: 200}, {waterDeep: 1, waterBed: 3}),
    // a partial Denser scatter over the ridge's flank: at full strength the paint is its own source, so only here does From cliff feet choose where stones lie
    ['paint', [[240, 220], [760, 220]], {card: {diameter: 460, amount: 35, paintChannel: 5}}],
    ...[1, 2, 3, 4, 5, 6, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22, 23, 24, 25].map((c, i) => ['paint', [[110 + (i % 6) * 160, 120 + Math.floor(i / 6) * 250], [170 + (i % 6) * 160, 120 + Math.floor(i / 6) * 250]], {card: {diameter: 120, amount: 100, paintChannel: c}}])];
  // The water picks: six water strokes, each with one combination of a stroke's edge and bed choices (hard, lit, faded, cracked, and the pairs the water rows' gates read),
  // for the rows a stroke's own choice keeps alive where the world's setting leaves them idle.
  // A seventh is a cracked bed under a hard step, edged with slab plates: where the water has a third color and the palette mixes pairs (no dither), the
  // step's deep share is drawn only by the crystal shallows beside slabs (engine-frag.wgsl crystalShallowWater), so only there does Cracked-bed transition depth show.
  const waterPicks = () => [[60, 200, {waterDeep: 1}], [60, 480, {waterBed: 1}], [60, 760, {waterDeep: 2}], [560, 200, {waterBed: 1, waterDeep: 2}], [560, 480, {waterBed: 3}], [560, 760, {waterBed: 1, waterDeep: 1}],
    [560, 960, {waterBed: 3, waterDeep: 1}, {diameter: 200, shorePlates: 1, plateMaterial: 1}]]
    .map(([x, y, picks, card]) => WATER([[x, y], [x + 400, y]], {diameter: 150, ...card}, picks));
  // The stroke fixture: one stroke of each kind carrying a shape option, shifted by `variant` so a second one differs in size and amount. The third is as wide as a world's own plateau.
  const strokeFixture = variant => Object.entries(KIND_AT).map(([kind, [x, y]]) => [kind, [[x - 70, y], [x + 70, y + (variant ? 30 : 0)]], {card: {diameter: [180, 260, 560][variant], amount: variant ? 100 : 70, roughness: variant ? 55 : 35}}]);
  // Two Sand strokes over the first stroke fixture's rows, for the options that scale what lies on the ground (Style: deposits).
  const sandOver = () => [170, 500, 830].map(y => ['sand', [[60, y], [950, y]], {card: {diameter: 300, amount: 100}}]);
  const fmt = r => `${r.world.padEnd(12)}${r.type.padEnd(8)}${(r.stroke ? r.stroke + ':' : '') + r.key}`.padEnd(40) + `${String(r.max).padStart(4)}${String(r.px).padStart(9)}  ${r.fixture}${r.state === 'gated' ? ' gated ' + JSON.stringify(r.gates) : ''}${r.zero && !r.allowed ? '  !' : ''}${r.hides ? '  ! hidden: ' + r.reason : ''}`;
  const add = r => { rows.push(r); if (process.stdout.isTTY || !process.env.QUIET) console.log(fmt(r)); };
  for (const world of WORLDS) {
    const tw = Date.now(), fixtures = [...[1,2,3].map(i=>{const name=fixtureName(world,i),s=scenes[name];return [name,s.strokes,s.ground!==false,s.query];}), [`${world}-diagnostic`, diagnostic(world), true, strokes(world).query], [`${world}-painted`, painted(), true, strokes(world).query], [`${world}-water`, waterPicks(), true, strokes(world).query]];
    const setUp = () => host.setUp(SET);
    await host.load(world, fixtures[0][3] || '');
    const st = await setUp(); let base = st.variant;
    const values = st.values, panelRow = Object.fromEntries(st.panel.map(r => [r.key, r])), all = st.knobs.flatMap(([group, list]) => list.map(f => ({group, key: f[0], lo: f[2], hi: f[3]})));
    const live = all.filter(k => !PARKED_WORLD_CONTROLS.has(k.key) && (!ONLY || ONLY.includes(k.key)));
    // The parents that clear a reason: try each knob at 1, then at its midpoint, greedily, until the row is enabled (the reason is the tool's own oracle).
    // The parents that clear a row's reason: every knob that clears it alone (an "any of" row has several), else the chain that does, one knob at a time (the reason is the tool's own oracle).
    const gatesFor = key => {
      const alone = [];
      for (const k of all) { for (const x of [1, (k.lo + k.hi) / 2, k.hi, k.lo]) { if (k.key === key || values[k.key] === x) continue; if (!worldControlRequirement(key, {...values, [k.key]: x})) { alone.push({[k.key]: x}); break; } } }
      if (alone.length) return alone.slice(0, 6);
      const v = {...values}, gates = {};
      for (let round = 0; round < 6 && worldControlRequirement(key, v); round++) {
        const before = worldControlRequirement(key, v); let done = false;
        for (const k of all) { for (const x of [1, (k.lo + k.hi) / 2, k.hi]) { if (k.key === key || v[k.key] === x) continue; if (worldControlRequirement(key, {...v, [k.key]: x}) !== before) { v[k.key] = x; gates[k.key] = x; done = true; break; } } if (done) break; }
        if (!done) return [];
      }
      return worldControlRequirement(key, v) ? [] : [gates];
    };
    // The panel's own word on a row is its disabled control; the schema function must say the same, or the gate search below would be searching another question.
    // In Chrome that is the panel's DOM; under Node the rows are what buildKnobs and the panel's sync compute (the same functions), so it holds by construction.
    for (const k of live) if (!panelRow[k.key] || panelRow[k.key].off !== Boolean(worldControlRequirement(k.key, values))) console.log(`   ${world} ${k.key}: the panel and the schema disagree`);
    const on = live.filter(k => panelRow[k.key] && !panelRow[k.key].off), off = live.filter(k => panelRow[k.key]?.off);
    const restoreAll = () => host.restoreAll(base);
    if (FIND) {
      await host.scene(fixtures[0][1], fixtures[0][2]);
      const targets = all.filter(k => FIND.includes(k.key));
      for (const par of live.filter(k => !FIND.includes(k.key) && panelRow[k.key] && !panelRow[k.key].off)) {
        const was = await host.variant(par.key); const hi = par.key === 'wind' || par.key.endsWith('Dir') ? 180 : par.hi;
        await host.knob(par.key, hi);
        const hit = [];
        for (const t of targets) { const m = await host.knobPair(t.key, t.lo, t.key.endsWith('Dir') ? 180 : t.hi); if (m.max > 0) hit.push(`${t.key}:${m.max}/${m.px}`); }
        await host.knob(par.key, was);
        if (hit.length) console.log(`${world} parent ${par.key}=${hi} moves ${hit.join(' ')}`);
      }
      continue;
    }
    const sweepKnob = async (k, fixture, state, gates) => {
      const hi = k.key === 'wind' || k.key.endsWith('Dir') ? 180 : k.hi, m = await host.knobPair(k.key, k.lo, hi);
      return {world, type: 'knob', key: k.key, group: k.group, fixture, state, gates, lo: k.lo, hi, ...m};
    };
    // The mirror of the gated pass: on this fixture, every row whose reason holds now, read as it stands. The reason is asked again here, because a scene's
    // strokes or query can clear it (a water stroke's Hard edge, Ice's variants). A row no knob can clear has no gated pass, so the fixture that clears it is its proof.
    const facts = new Map();
    const idle = async fixture => {
      const now = await host.panelValues();
      for (const k of live) {
        const reason = worldControlRequirement(k.key, now);
        if (!reason) { const r = facts.get(k.key); if (r && r.max <= 0) Object.assign(r, await sweepKnob(k, fixture, 'gated', {}), {note: 'a fixture cleared the reason'}); continue; }
        const hi = k.key === 'wind' || k.key.endsWith('Dir') ? 180 : k.hi, m = await host.knobPair(k.key, k.lo, hi);
        if (m.px >= HIDDEN_PX) add({world, type: 'knob', key: k.key, group: k.group, fixture, state: 'hidden', reason, lo: k.lo, hi, hides: true, ...m});
      }
    };
    const stage = (name, t) => console.log(`   ${world} ${name} ${((Date.now() - t) / 1000).toFixed(0)} s`); let ts = Date.now();
    // Fixture 1: every enabled row; gated rows with their parents set.
    await host.scene(fixtures[0][1], fixtures[0][2]); await host.remember();
    const results = new Map();
    for (const k of on) { const r = await sweepKnob(k, fixtures[0][0], 'enabled', {}); results.set(k.key, r); }
    for (const k of off) {
      const sets = gatesFor(k.key); if (!sets.length) { facts.set(k.key, {world, type: 'knob', key: k.key, group: k.group, fixture: fixtures[0][0], state: 'gated', gates: null, max: -1, px: -1, note: 'no knob clears the reason'}); continue; }
      let best = null;
      for (const gates of sets) {
        for (const [g, x] of Object.entries(gates)) await host.knob(g, x);
        const r = await sweepKnob(k, fixtures[0][0], 'gated', gates); await restoreAll();
        if (!best || r.max > best.max || (r.max === best.max && r.px > best.px)) best = r;
      }
      results.set('~' + k.key, best);
    }
    await idle(fixtures[0][0]);
    // Inactive inspector tabs do not make their controls inapplicable.
    for (const [sid, lo, hi] of SURFACE) { if (ONLY && !ONLY.includes(sid)) continue; if (!await host.sliderShown(sid)) continue; const m = await host.controlPair(sid, lo, hi); results.set('#' + sid, {world, type: 'surface', key: sid, fixture: fixtures[0][0], state: 'enabled', lo, hi, ...m}); }
    stage('rows', ts); ts = Date.now();
    // Leak check: the first fixture drawn again must match its first capture, so no row left a value behind.
    await restoreAll(); await host.scene(fixtures[0][1], fixtures[0][2]);
    { const same = await host.same(); add({world, type: 'leak', key: 'world-end', fixture: fixtures[0][0], state: 'check', ...same, leak: same.max > 0}); }
    // A zero gets the other scenes and the diagnostic fixture before it counts; every fixture checks the gates.
    for (let f = 1; f < fixtures.length; f++) {
      const zeros = [...results.entries()].filter(([, r]) => r.max === 0);
      if ((fixtures[f][3] || '') !== (fixtures[f - 1][3] || '')) { await host.load(world, fixtures[f][3] || ''); base = (await setUp()).variant; }
      await host.scene(fixtures[f][1], fixtures[f][2]);
      for (const [name, r] of zeros) {
        for (const [g, x] of Object.entries(r.gates || {})) await host.knob(g, x);
        const m = r.type === 'surface' ? await host.controlPair(r.key, r.lo, r.hi) : await host.knobPair(r.key, r.lo, r.hi);
        if (r.state === 'gated') await restoreAll();
        r.tried = [...(r.tried || [fixtures[0][0]]), fixtures[f][0]];
        if (m.max > 0) { Object.assign(r, m, {fixture: fixtures[f][0]}); }
      }
      await idle(fixtures[f][0]);
    }
    for (const r of [...results.values(), ...facts.values()]) { r.zero = r.max === 0; r.allowed = r.zero && reasonFor(r); add(r); }
    stage('zero retries', ts); ts = Date.now();
    // A Shallow water color, picked through the panel's own row, on a plain scene and on the water picks: a row the panel disables must stay put, one it leaves on must move on one of the two.
    await host.pickColor('Shallow water', '#c03030');
    const colored = new Map();
    for (const [fixture, list, ground] of [[fixtures[0][0], fixtures[0][1], fixtures[0][2]], [`${world}-water`, waterPicks(), true]]) {
      await host.scene(list, ground);
      const now = await host.panelValues();
      for (const k of live.filter(k => COLORED_ROWS.has(k.key))) {
        const reason = worldControlRequirement(k.key, now), m = await host.knobPair(k.key, k.lo, k.hi), row = {world, type: 'knob', key: k.key, group: k.group, fixture: fixture + ' + color', lo: k.lo, hi: k.hi, ...m};
        if (reason) { if (m.px >= HIDDEN_PX) add({...row, state: 'hidden', reason, hides: true}); }
        else if (!colored.has(k.key) || m.max > colored.get(k.key).max) colored.set(k.key, {...row, state: 'colored'});
      }
    }
    // A stroke's edge under the color: H24 hid it on a world of one or three tones, where it draws. waterPicks' third stroke is the faded one, and a ground node leads only where the world's undulation is on.
    await host.setBusy(false);   // an edit is refused while the map is busy
    const third = (await host.kinds()).indexOf('landform') + 2, shown = shapeControlAvailable('waterDeep', 'landform', {waterBed: 0, world: await host.panelValues()});
    const edge = await host.strokePair(third, 'waterDeep', {waterDeep: 0}, 0, [1, 2], 1, {x: 40, y: 670, width: 440, height: 180});
    colored.set('~waterDeep', {world, type: 'shape', stroke: 'landform', key: 'waterDeep', fixture: `${world}-water + color`, state: shown ? 'colored' : 'hidden', reason: shown ? '' : 'hidden under a picked color', hides: !shown && edge.px >= HIDDEN_PX, ...edge});
    await host.pickColor('Shallow water');
    for (const r of colored.values()) { r.zero = r.max === 0; r.allowed = r.zero && reasonFor(r); add(r); }
    stage('picked color', ts); ts = Date.now();
    // The light's colors (P12b): a warm sun and a cool sky, picked through the panel's own rows on the world's first scene. White (off) is the grey light.
    await host.scene(fixtures[0][1], fixtures[0][2]);
    for (const [label, hex, key] of [['Sun color', '#ffc880', 'sunColor'], ['Sky color', '#80a0ff', 'skyColor'], ...[1,2,3,4].map(i=>['Flower '+i,'#30b0ff','flower'+i])]) {
      if(key.startsWith('flower')&&(ONLY&&!ONLY.includes(key)||!await host.hasColorRow(label)))continue;
      const m = await host.colorPair(label, hex);
      add({world, type: 'knob', key, group: 'Colors', fixture: fixtures[0][0] + ' + ' + hex, lo: 'off', hi: hex, state: 'color', ...m, zero: m.max === 0, allowed: false});
    }
    // Stroke options, on the stroke fixture.
    const shapeRows = [];
    for (const f of st.fields) {
      const [key, , , kinds, lo, hi, , scale, , choices] = f;
      // A choice moves between the first value and each of up to five others (the last one included); the row reads the most any pair moves.
      const picks = Array.isArray(choices) ? choices.map(c => c[0]).filter(c => c !== lo) : [hi], few = picks.length > 5 ? [...picks.filter((_, i) => i % Math.ceil(picks.length / 4) === 0).slice(0, 4), picks[picks.length - 1]] : picks;
      for (const kind of kinds) { if (!KIND_AT[kind] || (ONLY && !ONLY.includes(key))) continue; shapeRows.push({key, kind, lo, his: key.endsWith('Dir') ? [180] : few, scale}); }
    }
    await host.setBusy(false);   // an edit is refused while the map is busy
    await host.scene(strokeFixture(0), true);
    const nodeKinds = await host.kinds();   // a ground node leads only where the world's undulation is on
    const ctxFor = (key, kind) => {
      const p = {craterlets: 0, shorePlates: 0, fingers: 0, shoreLayers: 0, spurCount: 0, crestJag: 0, crestVary: 0, crestTaper: 0, craterFacets: 0, iceFacets: 0, crystalCount: 8, crystalSize: 110, crystalForm: 0};
      if (['terraces', 'ledge', 'terraceJitter', 'breakup'].includes(key)) p.terraces = 4;
      if (['ledge', 'terraceJitter'].includes(key)) p.ledge = .55;
      if (key.startsWith('spur') || key.startsWith('crest')) p.spurCount = 4;
      if (key.startsWith('rim')) Object.assign(p, {rimSectors: 4, rimUnequal: .7, rimGaps: 2});
      if (key.startsWith('fissureBranch')) p.fissureBranches = 3;
      if (key === 'fissureCell') p.fissureNetwork = 1;
      if (key.startsWith('plate') || key === 'shorePlates' || key.startsWith('frost') || key.startsWith('crystalShore')) Object.assign(p, {shorePlates: 1, plateMaterial: key.startsWith('frost') ? 2 : 1, plateWaterPx: 100, plateLandPx: 120, plateSize: 40, plateGap: 5, plateHeight: 7});
      if (key.startsWith('finger')) Object.assign(p, {fingers: 1, fingerSize: 1});
      if (key.startsWith('layer') || key.startsWith('lava') || key === 'shoreLayers') Object.assign(p, {shoreLayers: 5, layerPx: 22, layerRiser: 4, layerLedge: .7, layerRough: .5, layerVary: .4, layerStyle: key.includes('Circle') || key === 'layerCircle' || key === 'lavaCircleVary' ? 1 : 0});
      if (['crystalTiers', 'crystalStep', 'crystalFacet', 'crystalSizeVar', 'crystalSmooth'].includes(key)) Object.assign(p, {crystalForm: 1, crystalSize: 32});
      if (key.startsWith('berg') || key === 'crystalAlign') Object.assign(p, {crystalForm: 2, crystalSize: 200, crystalCount: 3, bergTilt: .3});
      if (key.startsWith('crystalCrater') || key === 'craterFacets') p.craterFacets = .7;
      if (key === 'iceFacetSize' || key === 'iceFacets') p.iceFacets = .7;
      // lfcrystal: a landform's Facet shape rows, with facets on and the shape that shows them (Level tops on columns).
      if (kind === 'landform' && (key === 'facetForm' || LANDFORM_FACET_KEYS.includes(key))) Object.assign(p, {iceFacets: .7, facetForm: ['crystalTiers', 'crystalStep', 'crystalFacet', 'crystalSizeVar'].includes(key) ? 1 : 2, iceFacetSize: 40});
      if (key === 'facing') p.lean = 3;
      if (key === 'gullySize' || key === 'talus') p.gullies = 1;
      if (key === 'waterDeep') p.waterBed = 1;   // a stroke's edge choice shows where its own Lit bed draws the deep share
      if(kind==='landform'&&(key.startsWith('layer')||key.startsWith('lava')))Object.assign(p,{stepReference:key==='layerCircle'||key==='lavaCircleVary'?2:1,terraces:5,ledge:.7,terraceJitter:.5});
      return p;
    };
    // The panel's own test of a row on a kind, on the state the context sets (UI units for the availability test).
    const available = (key, kind, ctx, scales) => {
      const ui = {...st.defaults[kind], world: values}; for (const [k, v] of Object.entries(ctx)) ui[k] = v * (scales[k] ?? 1);
      const net = kind === 'fissure' && Number(ui.fissureNetwork) >= .5;
      if (kind === 'fissure' && (net ? ['fissureBranches', 'fissureBranchLen', 'fissureBranchSpread', 'fissureTaper'].includes(key) : key === 'fissureCell')) return false;
      if (kind === 'crystal' && ['crystalAlign', 'bergFace', 'bergJitter', 'bergBreak', 'bergRough', 'bergTilt', 'bergTiltDir', 'bergFlat'].includes(key) && Number(ui.crystalForm) < 2) return false;
      if (key === 'frostNeedles' && Number(ui.plateMaterial) < 2) return false;
      if (GATE[key] && !(kind==='landform'&&GATE[key]==='shoreLayers') && !(Number(ui[GATE[key]]) > 0)) return false;
      if (kind === 'crater' && ['crestJag', 'crestVary'].includes(key) && !(Number(ui.spurCount) > 0)) return false;   // on a crater the crest options only shape its spurs
      if (kind!=='landform' && key === 'layerCircle' && Number(ui.layerStyle) !== 1) return false;
      // The shared applicability rule receives engine units, just as updateControls does.
      return shapeControlAvailable(key, kind, {...ui, ...Object.fromEntries(Object.entries(scales).map(([k, scale]) => [k, ui[k] / scale]))});
    };
    // What a row's fixture needs whatever the panel shows.
    const fixtureFor = (key, kind) => {
      // Shore controls need a sea crossing: the ordinary raised landform fixture has none.
      if(kind==='landform'&&key==='stepReference')return {elevation:-55,combine:1,heightVary:0,terraces:6,ledge:.8};
      if(kind==='landform'&&key==='heightReference')return {elevation:110,heightReference:0};
      if(kind==='landform'&&(key.startsWith('finger')||key.startsWith('layer')||key.startsWith('lava')||key.startsWith('plate')||key==='shorePlates'||key.startsWith('frost')||key.startsWith('crystalShore')||key.startsWith('water')||key==='surf'))return {elevation:-55,combine:1,heightVary:0};
      return {};
    };
    const scaleOf = Object.fromEntries(st.fields.map(f => [f[0], f[7]]));
    const sresults = [];
    for (const r of shapeRows) {
      // A row the panel shows at the stroke's defaults is read there; one it hides until a parent is set is read with the parents set ("gated"), which is the proof it comes back.
      const i = nodeKinds.indexOf(r.kind), shown = available(r.key, r.kind, {}, scaleOf), gate = shown ? {} : ctxFor(r.key, r.kind), ctx = {...gate, ...fixtureFor(r.key, r.kind)};
      if (!shown && !available(r.key, r.kind, ctx, scaleOf)) continue;
      const [cx, cy] = KIND_AT[r.kind], crop = {x: cx - 210, y: cy - 165, width: 420, height: 330}, m = await host.strokePair(i, r.key, ctx, r.lo, r.his, r.scale, crop);
      sresults.push({world, type: 'shape', key: r.key, stroke: r.kind, fixture: 'strokes-A', state: shown ? 'enabled' : 'gated', gates: shown ? {} : ctx, lo: r.lo, ...m, _r: r, _ctx: ctx, _i: i});
    }
    await host.putBack();
    stage('stroke rows', ts); ts = Date.now();
    for (const [name, fixture] of [['strokes-B', strokeFixture(1)], ['strokes-wide', strokeFixture(2)], ['strokes-sand', [...strokeFixture(0), ...sandOver()]]]) {
      const szeros = sresults.filter(r => r.max === 0);
      if (!szeros.length) break;
      await host.scene(fixture, true);
      if ((await host.kinds()).slice(0, nodeKinds.length).join() !== nodeKinds.join()) throw new Error(name + ' has other strokes');
      for (const r of szeros) {
        const m = await host.strokePair(r._i, r.key, r._ctx, r.lo, r._r.his, r._r.scale, {x: 0, y: 0, width: 1024, height: 1024});
        r.tried = [...(r.tried || ['strokes-A']), name];
        if (m.max > 0) Object.assign(r, m, {fixture: name});
      }
      stage(name, ts); ts = Date.now();
    }
    // At sea zero the two height references coincide. Qualify their different
    // behavior on a nonzero sea instead of treating that identity as a dead row.
    const references=sresults.filter(r=>r.stroke==='landform'&&r.key==='heightReference'&&r.max===0);
    if(references.length){
      const query=new URLSearchParams(fixtures[0][3]||'');query.set('sea','75');
      await host.load(world,query.toString());await setUp();await host.setBusy(false);
      await host.scene(strokeFixture(0), true);
      for(const r of references){
        const m=await host.strokePair(r._i, r.key, r._ctx, r.lo, r._r.his, r._r.scale, {x:0,y:0,width:1024,height:1024});
        r.tried=[...(r.tried||['strokes-A']),'strokes-A sea=75'];
        if(m.max>0)Object.assign(r,m,{fixture:'strokes-A sea=75'});
      }
    }
    for (const r of sresults) { delete r._r; delete r._ctx; delete r._i; r.zero = r.max === 0; r.allowed = r.zero && reasonFor(r); add(r); }
    console.log(`-- ${world}: ${((Date.now() - tw) / 1000).toFixed(0)} s`);
  }
  host.drain();
  const bad = rows.filter(failed);
  writeFileSync(`${out}/world-controls.json`, JSON.stringify({server: CHROME ? server : 'node', variant:VARIANT||null, seconds: (Date.now() - t0) / 1000, rows, unexplained: bad.map(named), console: logs.slice(0, 20)}));
  const count = (t, p) => rows.filter(r => r.type === t && p(r)).length;
  console.log(`\n${count('knob', r => r.state === 'enabled')} enabled world rows, ${count('knob', r => r.state === 'gated')} gated, ${count('shape', () => true)} stroke rows, ${count('surface', () => true)} sliders; ${rows.filter(r => r.zero).length} read 0, ${rows.filter(r => r.hides).length} hidden and moving, ${bad.length} unexplained (!), ${((Date.now() - t0) / 60000).toFixed(1)} min`);
  if (logs.length) console.log('console:', logs.slice(0, 5));
  finish(logs.length || bad.length ? 1 : 0);
} catch (e) { console.error(e); finish(2); }
