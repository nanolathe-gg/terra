// H22b: does every control the panel offers change the picture? In each of the nine worlds, on a few page loads and never one per control, every
// world row the panel shows enabled, every stroke option the panel shows on a stroke kind, and the eight page sliders are moved from their low
// end to their high end on a fixture that holds the features, and the two captures are compared: the most any pixel channel moves, and how many
// pixels change at all. A direction (`wind`, `*Dir`) moves a half turn, because the two ends of a full turn are one value. Each control is put
// back after its pair, and at the end of a world the first fixture is drawn again and must match its first capture, so no row leaks into the next.
//   node measure/world_controls.mjs [--find key,key] [--server http://127.0.0.1:8885] [--port 9685] [--out DIR] [--worlds green,lava] [--only key,key] [--set key=v,key=v] [--jobs 3]
// --jobs splits the worlds over that many browsers (CDP ports --port, then --port+2, +3, ...): a world takes about four minutes alone.
// --find key,key: instead of the sweep, set each other enabled row to its high end in turn and print which of the named rows then move (the search for a row's parent).
// Without --server the tool starts repro/audit/server.py itself (--audit-port, default 8885): terraformAudit exists only on that host's ?audit pages.
// Writes DIR/world-controls.json and prints one row per control and world. Exit 1 on a console error or on an unexplained exact 0, that is a
// row that reads 0 on every fixture (the first, the other two scenes, the diagnostic fixture; stroke rows the second stroke fixture) and is not on
// ALLOWED below. A row the panel disables with a reason is not swept in that state; it is swept again with its parents set (state "gated"), which
// proves it comes back. --set puts values in before the sweep, to probe a row under a gate.
import {cdpPortFree} from '../repro/cdp-port.mjs';
import {worldControlRequirement, shapeControlAvailable, PARKED_WORLD_CONTROLS} from '../sculpt-control-schema.js';
import {spawn} from 'node:child_process';
import {mkdirSync, writeFileSync, readFileSync, existsSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {dirname, join, resolve} from 'node:path';
const here = dirname(fileURLToPath(import.meta.url)), repo = resolve(here, '..');
const args = process.argv.slice(2), opt = (n, d) => { const i = args.indexOf(n); return i >= 0 ? args[i + 1] : d; };
const JOBS = Number(opt('--jobs', 3)), CHILD = args.includes('--child');
const port = Number(opt('--port', 9685)), out = resolve(opt('--out', 'world-controls')), auditPort = Number(opt('--audit-port', 8885));
const WORLDS = opt('--worlds', 'green,archipelago,crystal,desert,ice,lava,moon,red,zhon').split(',');
const FIND = opt('--find', '') ? opt('--find', '').split(',') : null;
const ONLY = opt('--only', '') ? opt('--only', '').split(',') : null;
const SET = Object.fromEntries((opt('--set', '') || '').split(',').filter(Boolean).map(s => s.split('=')).map(([k, v]) => [k, Number(v)]));
// Rows that read 0 and are kept on purpose. A reason a reader can check, or the row is a finding, not an entry.
const ALLOWED = {};
const SURFACE = [['relief', 0, 160], ['transition-detail', 0, 100], ['mineral-ring', 0, 100], ['ring-spread', 0, 100], ['ring-variation', 0, 100], ['scree', 0, 100], ['material-weathering', 0, 100], ['deposit-spread', 0, 100]];
// The stroke kinds that carry SHAPE_FIELDS rows, drawn one each on a grid of the 1024 px window.
const KIND_AT = {plateau: [130, 170], offset: [380, 170], hill: [630, 170], mountain: [880, 170], deep: [130, 500], shallow: [380, 500], crater: [630, 500], crystal: [880, 500], fissure: [130, 830], erase: [380, 830], paint: [630, 830]};
// The panel hides these until their switch is above 0 (updateControls in sculpt.js).
const GATE = {layerPx: 'shoreLayers', layerRiser: 'shoreLayers', layerLedge: 'shoreLayers', layerRough: 'shoreLayers', layerStyle: 'shoreLayers', layerVary: 'shoreLayers', layerCircle: 'shoreLayers', iceFacetSize: 'iceFacets', fingerAmount: 'fingers', fingerSize: 'fingers', fingerSpread: 'fingers', fingerHeight: 'fingers',
  spurLength: 'spurCount', spurSpread: 'spurCount', spurWidth: 'spurCount', spurTaper: 'spurCount', spurHeight: 'spurCount', spurForks: 'spurCount', spurBulb: 'spurCount', rimUnequal: 'rimSectors', rimGapWidth: 'rimGaps', fissureBranchLen: 'fissureBranches', fissureBranchSpread: 'fissureBranches', lavaMeander: 'shoreLayers', lavaSpread: 'shoreLayers', lavaCircleVary: 'shoreLayers'};
const sleep = ms => new Promise(r => setTimeout(r, ms));
const rows = [], logs = [], t0 = Date.now();
mkdirSync(out, {recursive: true});
let server = opt('--server', ''), audit = null;
if (!server) {
  server = `http://127.0.0.1:${auditPort}`;
  const py = process.env.PYTHON || '/Users/daniel/src/terraform/.venv/bin/python';
  audit = spawn(py, [join(repo, 'repro/audit/server.py'), '--source', repo, '--port', String(auditPort), '--out', join(out, 'audit-out'), '--assets', out], {stdio: 'ignore'});
  for (let i = 0; i < 100; i++) { try { if ((await fetch(server + '/audit/index.html')).ok) break; } catch {} await sleep(100); }
}
if (JOBS > 1 && !CHILD && WORLDS.length > 1) {
  // A pool of browsers, one child per world, the dearest worlds first; rows are merged into the same file and the same exit code.
  const pass = []; for (const f of ['--only', '--set']) if (opt(f, '')) pass.push(f, opt(f, ''));
  const cost = {green: 3, zhon: 2, red: 2}, order = [...WORLDS].sort((a, b) => (cost[b] || 1) - (cost[a] || 1)), queue = [...order], codes = [], tries = {};
  const slots = Array.from({length: Math.min(JOBS, WORLDS.length)}, (_, k) => new Promise(async done => {
    for (let w; (w = queue.shift());) {
      await new Promise(next => {
        const c = spawn(process.execPath, [fileURLToPath(import.meta.url), '--child', '--server', server, '--worlds', w, '--port', String(port + (k ? k + 1 : 0)), '--out', join(out, w), ...pass], {stdio: ['ignore', 'pipe', 'inherit']});
        let buf = ''; c.stdout.on('data', d => { buf += d; const lines = buf.split('\n'); buf = lines.pop(); for (const l of lines) console.log(l); });
        // A browser the host killed for memory leaves no file: that world goes round again, twice at most.
        c.on('close', code => { if (!existsSync(join(out, w, 'world-controls.json')) && (tries[w] = (tries[w] || 0) + 1) < 3) { console.error(`${w}: no result (exit ${code}), run again`); queue.push(w); } else codes.push(code); next(); });
      });
    }
    done();
  }));
  await Promise.all(slots); audit?.kill();
  const merged = WORLDS.map(w => JSON.parse(readFileSync(join(out, w, 'world-controls.json'), 'utf8')));
  const all = merged.flatMap(m => m.rows), bad = merged.flatMap(m => m.unexplained), con = merged.flatMap(m => m.console);
  writeFileSync(join(out, 'world-controls.json'), JSON.stringify({server, seconds: (Date.now() - t0) / 1000, rows: all, unexplained: bad, console: con}));
  console.log(`\n${all.filter(r => r.type === 'knob' && r.state === 'enabled').length} enabled world rows, ${all.filter(r => r.type === 'knob' && r.state === 'gated').length} gated, ${all.filter(r => r.type === 'shape').length} stroke rows, ${all.filter(r => r.type === 'surface').length} sliders; ${all.filter(r => r.zero).length} read 0, ${bad.length} unexplained (!), ${((Date.now() - t0) / 60000).toFixed(1)} min`);
  if (con.length) console.log('console:', con.slice(0, 5));
  process.exit(codes.some(c => c > 1) || con.length || bad.length ? 1 : 0);
}
await cdpPortFree(port);
const chrome = spawn('/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', ['--headless=new', '--enable-gpu', '--use-angle=metal', `--remote-debugging-port=${port}`,
  `--user-data-dir=${out}/.profile-${port}-${Date.now()}`, '--window-size=1500,1200', '--no-first-run', 'about:blank'], {stdio: 'ignore'});
const scenes = {};
for (const w of WORLDS) for (const n of [1, 2, 3]) scenes[`${w}-${n}`] = JSON.parse(readFileSync(join(repo, `repro/scenes/${w}-${n}.json`), 'utf8'));
let ws, id = 0; const wait = new Map();
const finish = code => { try { ws?.close(); } catch {} chrome.kill(); audit?.kill(); process.exit(code); };
try {
  for (let i = 0; i < 100 && !ws; i++) { try { const p = (await (await fetch(`http://127.0.0.1:${port}/json/list`)).json()).find(x => x.type === 'page'); if (p) ws = new WebSocket(p.webSocketDebuggerUrl); } catch {} if (!ws) await sleep(200); }
  await new Promise(r => ws.onopen = r);
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
      kinds() { return A.nodes.map(n => n.kind); },
      async putBack() { for (let i = 1; i < saved.length; i++) await A.edit(i, saved[i]); },
      state() { return {values: A.panelValues(), panel: [...document.querySelectorAll('#knobs [data-knob], #rendering-host [data-knob]')].map(r => ({key: r.dataset.knob, off: r.querySelector('input,select').disabled, reason: r.querySelector('.control-requirement')?.textContent || ''})), variant: Object.fromEntries(A.renderer.variant), knobs: A.knobs, fields: A.fields, defaults: Object.fromEntries(Object.keys(KINDS).map(k => [k, A.defaults(k)])), nodes: A.nodes.map(n => n.kind)}; },
      scenes: null
    };
  })()`;
  const load = async (world, query) => {
    await send('Page.navigate', {url: `${server}/sculpt?biome=${world}&mapX=4&mapY=4&scratch=wc${Date.now()}&audit=1&gpuMB=512&heapMB=2048${query ? '&' + query : ''}`});
    for (let i = 0; i < 400; i++) { await sleep(150); try { if (await ev('!!window.terraformAudit&&document.readyState==="complete"')) break; } catch {} }
    await ev('terraformAudit.ready()'); await ev(HELPERS.replace('KINDS', JSON.stringify(Object.fromEntries(Object.keys(KIND_AT).map(k => [k, 1]))))); await ev('terraformAudit.idle()');
  };
  const strokes = world => scenes[`${world}-1`];
  // A fixture is a stroke list. The diagnostic one is runner.js's: a plateau, a mountain, a deep stroke with shore plates, sand and paint.
  const diagnostic = world => [['plateau', [[270, 300], [550, 300]], {card: {diameter: 400, amount: 110, roughness: 35, cracks: 100}}], ['mountain', [[800, 150], [860, 430]], {card: {diameter: 320, amount: 130, cracks: 100}}],
    ['deep', [[0, 850], [1024, 850]], {card: {diameter: 600, shelves: 70, roughness: 40, shorePlates: 100, plateMaterial: world === 'ice' ? 2 : 1}, waterShore: 0, waterDeep: 0, waterBed: 0}], ['sand', [[350, 470], [650, 470]], {card: {diameter: 280, amount: 100}}], ['paint', [[350, 100], [500, 270]], {card: {diameter: 220, amount: 100, paintChannel: 1}}]];
  // The painted fixture: a mountain and a plateau with every paint channel laid on them, for the rows a painted or per-stroke path keeps alive at a world value of 0
  // (the stones of Denser scatter, the lines of Style: banding).
  const painted = () => [['mountain', [[300, 220], [700, 220]], {card: {diameter: 420, amount: 130, cracks: 100}}], ['plateau', [[300, 760], [700, 760]], {card: {diameter: 420, amount: 100, cracks: 100}}],
    // two water strokes with the choices the panel cannot show on the world: frost-needle shore plates (Melt pockets), and a cracked bed under a hard shore and step
    ['deep', [[60, 960], [460, 960]], {card: {diameter: 200, shelves: 70, shorePlates: 100, plateMaterial: 2}}], ['deep', [[560, 960], [960, 960]], {card: {diameter: 200, shelves: 70}, waterShore: 1, waterDeep: 1, waterBed: 3}],
    ...[1, 2, 3, 4, 5, 6, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22, 23, 24, 25].map((c, i) => ['paint', [[110 + (i % 6) * 160, 120 + Math.floor(i / 6) * 250], [170 + (i % 6) * 160, 120 + Math.floor(i / 6) * 250]], {card: {diameter: 120, amount: 100, paintChannel: c}}])];
  // The stroke fixture: one stroke of each kind carrying a shape option, shifted by `variant` so a second one differs in size and amount.
  const strokeFixture = variant => Object.entries(KIND_AT).map(([kind, [x, y]]) => [kind, [[x - 70, y], [x + 70, y + (variant ? 30 : 0)]], {card: {diameter: variant ? 260 : 180, amount: variant ? 100 : 70, roughness: variant ? 55 : 35}}]);
  const fmt = r => `${r.world.padEnd(12)}${r.type.padEnd(8)}${(r.stroke ? r.stroke + ':' : '') + r.key}`.padEnd(40) + `${String(r.max).padStart(4)}${String(r.px).padStart(9)}  ${r.fixture}${r.state === 'gated' ? ' gated ' + JSON.stringify(r.gates) : ''}${r.zero && !r.allowed ? '  !' : ''}`;
  const add = r => { rows.push(r); if (process.stdout.isTTY || !process.env.QUIET) console.log(fmt(r)); };
  for (const world of WORLDS) {
    const tw = Date.now(), fixtures = [[`${world}-1`, strokes(world).strokes, strokes(world).ground !== false, strokes(world).query], [`${world}-2`, scenes[`${world}-2`].strokes, scenes[`${world}-2`].ground !== false, scenes[`${world}-2`].query], [`${world}-3`, scenes[`${world}-3`].strokes, scenes[`${world}-3`].ground !== false, scenes[`${world}-3`].query], [`${world}-diagnostic`, diagnostic(world), true, strokes(world).query], [`${world}-painted`, painted(), true, strokes(world).query]];
    const setUp = async () => { await ev(`(async () => { for (const [k, v] of Object.entries(${JSON.stringify(SET)})) await terraformAudit.knob(k, v); })()`); return ev('__wc.state()'); };
    await load(world, fixtures[0][3] || '');
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
    for (const k of live) if (!panelRow[k.key] || panelRow[k.key].off !== Boolean(worldControlRequirement(k.key, values))) console.log(`   ${world} ${k.key}: the panel and the schema disagree`);
    const on = live.filter(k => panelRow[k.key] && !panelRow[k.key].off), off = live.filter(k => panelRow[k.key]?.off);
    const restoreAll = async () => { await ev(`(async () => { for (const [k, v] of Object.entries(${JSON.stringify(base)})) if (terraformAudit.renderer.variant.get(k) !== v) await terraformAudit.knob(k, v); })()`); };
    if (FIND) {
      await ev(`__wc.scene(${JSON.stringify(fixtures[0][1])}, ${fixtures[0][2]})`);
      const targets = all.filter(k => FIND.includes(k.key));
      for (const par of live.filter(k => !FIND.includes(k.key) && panelRow[k.key] && !panelRow[k.key].off)) {
        const was = await ev(`terraformAudit.renderer.variant.get(${JSON.stringify(par.key)})`); const hi = par.key === 'wind' || par.key.endsWith('Dir') ? 180 : par.hi;
        await ev(`terraformAudit.knob(${JSON.stringify(par.key)}, ${hi})`);
        const hit = [];
        for (const t of targets) { const m = await ev(`__wc.knobPair(${JSON.stringify(t.key)}, ${t.lo}, ${t.key.endsWith('Dir') ? 180 : t.hi})`); if (m.max > 0) hit.push(`${t.key}:${m.max}/${m.px}`); }
        await ev(`terraformAudit.knob(${JSON.stringify(par.key)}, ${was})`);
        if (hit.length) console.log(`${world} parent ${par.key}=${hi} moves ${hit.join(' ')}`);
      }
      continue;
    }
    const sweepKnob = async (k, fixture, state, gates) => {
      const hi = k.key === 'wind' || k.key.endsWith('Dir') ? 180 : k.hi, m = await ev(`__wc.knobPair(${JSON.stringify(k.key)}, ${k.lo}, ${hi})`);
      return {world, type: 'knob', key: k.key, group: k.group, fixture, state, gates, lo: k.lo, hi, ...m};
    };
    const stage = (name, t) => console.log(`   ${world} ${name} ${((Date.now() - t) / 1000).toFixed(0)} s`); let ts = Date.now();
    // Fixture 1: every enabled row; gated rows with their parents set.
    await ev(`__wc.scene(${JSON.stringify(fixtures[0][1])}, ${fixtures[0][2]})`); await ev('__wc.remember()');
    const results = new Map();
    for (const k of on) { const r = await sweepKnob(k, fixtures[0][0], 'enabled', {}); results.set(k.key, r); }
    for (const k of off) {
      const sets = gatesFor(k.key); if (!sets.length) { add({world, type: 'knob', key: k.key, group: k.group, fixture: fixtures[0][0], state: 'gated', gates: null, max: -1, px: -1, note: 'no knob clears the reason'}); continue; }
      let best = null;
      for (const gates of sets) {
        for (const [g, x] of Object.entries(gates)) await ev(`terraformAudit.knob(${JSON.stringify(g)}, ${x})`);
        const r = await sweepKnob(k, fixtures[0][0], 'gated', gates); await restoreAll();
        if (!best || r.max > best.max || (r.max === best.max && r.px > best.px)) best = r;
      }
      results.set('~' + k.key, best);
    }
    // The page sliders.
    for (const [sid, lo, hi] of SURFACE) { if (ONLY && !ONLY.includes(sid)) continue; if (await ev(`!!document.getElementById(${JSON.stringify(sid)}).closest('[hidden]')`)) continue; const m = await ev(`__wc.controlPair(${JSON.stringify(sid)}, ${lo}, ${hi})`); results.set('#' + sid, {world, type: 'surface', key: sid, fixture: fixtures[0][0], state: 'enabled', lo, hi, ...m}); }
    stage('rows', ts); ts = Date.now();
    // Leak check: the first fixture drawn again must match its first capture, so no row left a value behind.
    await restoreAll(); await ev(`__wc.scene(${JSON.stringify(fixtures[0][1])}, ${fixtures[0][2]})`);
    { const same = await ev('__wc.same()'); add({world, type: 'leak', key: 'world-end', fixture: fixtures[0][0], state: 'check', ...same, leak: same.max > 0}); }
    // A zero gets the other scenes and the diagnostic fixture before it counts.
    for (let f = 1; f < fixtures.length; f++) {
      const zeros = [...results.entries()].filter(([, r]) => r.max === 0);
      if (!zeros.length) break;
      if ((fixtures[f][3] || '') !== (fixtures[f - 1][3] || '')) { await load(world, fixtures[f][3] || ''); base = (await setUp()).variant; }
      await ev(`__wc.scene(${JSON.stringify(fixtures[f][1])}, ${fixtures[f][2]})`);
      for (const [name, r] of zeros) {
        for (const [g, x] of Object.entries(r.gates || {})) await ev(`terraformAudit.knob(${JSON.stringify(g)}, ${x})`);
        const m = r.type === 'surface' ? await ev(`__wc.controlPair(${JSON.stringify(r.key)}, ${r.lo}, ${r.hi})`) : await ev(`__wc.knobPair(${JSON.stringify(r.key)}, ${r.lo}, ${r.hi})`);
        if (r.state === 'gated') await restoreAll();
        r.tried = [...(r.tried || [fixtures[0][0]]), fixtures[f][0]];
        if (m.max > 0) { Object.assign(r, m, {fixture: fixtures[f][0]}); }
      }
    }
    for (const r of results.values()) { r.zero = r.max === 0; r.allowed = r.zero && (ALLOWED[r.key] || null); add(r); }
    stage('zero retries', ts); ts = Date.now();
    // Stroke options, on the stroke fixture.
    const shapeRows = [];
    for (const f of st.fields) {
      const [key, , , kinds, lo, hi, , scale, , choices] = f;
      // A choice moves between the first value and each of up to five others (the last one included); the row reads the most any pair moves.
      const picks = Array.isArray(choices) ? choices.map(c => c[0]).filter(c => c !== lo) : [hi], few = picks.length > 5 ? [...picks.filter((_, i) => i % Math.ceil(picks.length / 4) === 0).slice(0, 4), picks[picks.length - 1]] : picks;
      for (const kind of kinds) { if (!KIND_AT[kind] || (ONLY && !ONLY.includes(key))) continue; shapeRows.push({key, kind, lo, his: key.endsWith('Dir') ? [180] : few, scale}); }
    }
    await ev('terraformAudit.setBusy(false)');   // an edit is refused while the map is busy
    await ev(`__wc.scene(${JSON.stringify(strokeFixture(0))}, true)`);
    const nodeKinds = await ev('__wc.kinds()');   // a ground node leads only where the world's undulation is on
    const ctxFor = (key, kind) => {
      const p = {craterlets: 0, shorePlates: 0, fingers: 0, shoreLayers: 0, spurCount: 0, crestJag: 0, crestVary: 0, crestTaper: 0, craterFacets: 0, iceFacets: 0, crystalCount: 8, crystalSize: 110, crystalForm: 0};
      if (['terraces', 'ledge', 'terraceJitter'].includes(key)) p.terraces = 4;
      if (['ledge', 'terraceJitter'].includes(key)) p.ledge = .55;
      if (['faceVariation'].includes(key)) Object.assign(p, {facePx: 0});
      if (key.startsWith('spur') || key.startsWith('crest')) p.spurCount = 4;
      if (key.startsWith('rim')) Object.assign(p, {rimSectors: 4, rimUnequal: .7, rimGaps: 2});
      if (key.startsWith('fissureBranch')) p.fissureBranches = 3;
      if (key === 'fissureCell') p.fissureNetwork = 1;
      if (key.startsWith('plate') || key === 'shorePlates' || key.startsWith('frost') || key.startsWith('crystalShore')) Object.assign(p, {shorePlates: 1, plateMaterial: key.startsWith('frost') ? 2 : 1, plateWaterPx: 100, plateLandPx: 120, plateSize: 40, plateGap: 5, plateHeight: 7});
      if (key.startsWith('finger')) Object.assign(p, {fingers: 1, fingerAmount: 1, fingerSize: 1, fingerSpread: .5});
      if (key.startsWith('layer') || key.startsWith('lava') || key === 'shoreLayers') Object.assign(p, {shoreLayers: 5, layerPx: 22, layerRiser: 4, layerLedge: .7, layerRough: .5, layerVary: .4, layerStyle: key.includes('Circle') || key === 'layerCircle' || key === 'lavaCircleVary' ? 1 : 0});
      if (['crystalTiers', 'crystalStep', 'crystalFacet', 'crystalSizeVar', 'crystalSmooth'].includes(key)) Object.assign(p, {crystalForm: 1, crystalSize: 32});
      if (key.startsWith('berg') || key === 'crystalAlign') Object.assign(p, {crystalForm: 2, crystalSize: 200, crystalCount: 3, bergTilt: .3});
      if (key.startsWith('crystalCrater') || key === 'craterFacets') p.craterFacets = .7;
      if (key === 'iceFacetSize' || key === 'iceFacets') p.iceFacets = .7;
      if (key === 'maskAmount') p.maskChannel = 1;
      if (key === 'facing') p.lean = 3;
      return p;
    };
    // The panel's own test of a row on a kind, on the state the context sets (UI units for the availability test).
    const available = (key, kind, ctx, scales) => {
      const ui = {...st.defaults[kind]}; for (const [k, v] of Object.entries(ctx)) ui[k] = v * (scales[k] ?? 1);
      const net = kind === 'fissure' && Number(ui.fissureNetwork) >= .5;
      if (kind === 'fissure' && (net ? ['fissureBranches', 'fissureBranchLen', 'fissureBranchSpread', 'fissureTaper'].includes(key) : key === 'fissureCell')) return false;
      if (kind === 'crystal' && ['crystalAlign', 'bergFace', 'bergJitter', 'bergBreak', 'bergRough', 'bergTilt', 'bergTiltDir', 'bergFlat'].includes(key) && Number(ui.crystalForm) < 2) return false;
      if (key === 'frostNeedles' && Number(ui.plateMaterial) < 2) return false;
      if (GATE[key] && !(Number(ui[GATE[key]]) > 0)) return false;
      if (kind === 'crater' && ['crestJag', 'crestVary'].includes(key) && !(Number(ui.spurCount) > 0)) return false;   // on a crater the crest options only shape its spurs
      if (key === 'maskAmount' && !(Number(ui.maskChannel) >= 1)) return false;
      if (key === 'layerCircle' && Number(ui.layerStyle) !== 1) return false;
      return shapeControlAvailable(key, kind, ui);
    };
    // What a row's fixture needs whatever the panel shows: an offset has a shore only where it lowers the ground below the sea.
    const fixtureFor = (key, kind) => kind === 'offset' && (key.startsWith('plate') || key === 'shorePlates' || key.startsWith('frost') || key.startsWith('crystalShore')) ? {amount: -60} : {};
    const scaleOf = Object.fromEntries(st.fields.map(f => [f[0], f[7]]));
    const sresults = [];
    for (const r of shapeRows) {
      // A row the panel shows at the stroke's defaults is read there; one it hides until a parent is set is read with the parents set ("gated"), which is the proof it comes back.
      const i = nodeKinds.indexOf(r.kind), shown = available(r.key, r.kind, {}, scaleOf), gate = shown ? {} : ctxFor(r.key, r.kind), ctx = {...gate, ...fixtureFor(r.key, r.kind)};
      if (!shown && !available(r.key, r.kind, ctx, scaleOf)) continue;
      const [cx, cy] = KIND_AT[r.kind], crop = {x: cx - 210, y: cy - 165, width: 420, height: 330}, m = await ev(`__wc.strokePair(${i}, ${JSON.stringify(r.key)}, ${JSON.stringify(ctx)}, ${r.lo}, ${JSON.stringify(r.his)}, ${r.scale}, ${JSON.stringify(crop)})`);
      sresults.push({world, type: 'shape', key: r.key, stroke: r.kind, fixture: 'strokes-A', state: shown ? 'enabled' : 'gated', gates: shown ? {} : ctx, lo: r.lo, ...m, _r: r, _ctx: ctx, _i: i});
    }
    await ev('__wc.putBack()');
    stage('stroke rows', ts); ts = Date.now();
    const szeros = sresults.filter(r => r.max === 0);
    if (szeros.length) {
      await ev(`__wc.scene(${JSON.stringify(strokeFixture(1))}, true)`);
      if ((await ev('__wc.kinds()')).join() !== nodeKinds.join()) throw new Error('the second stroke fixture has other strokes');
      for (const r of szeros) {
        const m = await ev(`__wc.strokePair(${r._i}, ${JSON.stringify(r.key)}, ${JSON.stringify(r._ctx)}, ${r.lo}, ${JSON.stringify(r._r.his)}, ${r._r.scale}, {x: 0, y: 0, width: 1024, height: 1024})`);
        r.tried = ['strokes-A', 'strokes-B'];
        if (m.max > 0) Object.assign(r, m, {fixture: 'strokes-B'});
      }
      stage('stroke retries', ts);
    }
    for (const r of sresults) { delete r._r; delete r._ctx; delete r._i; r.zero = r.max === 0; r.allowed = r.zero && (ALLOWED[(r.stroke ? r.stroke + ':' : '') + r.key] || ALLOWED[r.key] || null); add(r); }
    console.log(`-- ${world}: ${((Date.now() - tw) / 1000).toFixed(0)} s`);
  }
  const bad = rows.filter(r => (r.zero && !r.allowed) || r.leak);
  writeFileSync(`${out}/world-controls.json`, JSON.stringify({server, seconds: (Date.now() - t0) / 1000, rows, unexplained: bad.map(r => `${r.world} ${r.stroke ? r.stroke + ':' : ''}${r.key}`), console: logs.slice(0, 20)}));
  const count = (t, p) => rows.filter(r => r.type === t && p(r)).length;
  console.log(`\n${count('knob', r => r.state === 'enabled')} enabled world rows, ${count('knob', r => r.state === 'gated')} gated, ${count('shape', () => true)} stroke rows, ${count('surface', () => true)} sliders; ${rows.filter(r => r.zero).length} read 0, ${bad.length} unexplained (!), ${((Date.now() - t0) / 60000).toFixed(1)} min`);
  if (logs.length) console.log('console:', logs.slice(0, 5));
  finish(logs.length || bad.length ? 1 : 0);
} catch (e) { console.error(e); finish(2); }
