// The editor's zoom: above 100% the final image is baked at the screen's pixels (.5 up to 200%, .25 beyond), and 100% must give the 1x picture back.
//   node zoom.mjs <scene.json> [--server http://127.0.0.1:8801] [--port 9450] [--map 8] [--view 2560x1440]
// On one scene, once it has settled (window = 1024 px of the map from (256, 256); TILE_PX is the most pixels a tile size may move):
//  a  zoom 1, 2, 4: every tile in view ends at the level its zoom wants (1, .5, .25)
//  b  the canvas at zoom 2 is debugBake(tile, .5)
//  c  back at zoom 1 the canvas is byte equal to the first read: a fine image must be replaced, not shown sampled
//  d  four 256 px tiles joined against one 512 px tile, at .5 and at .25
//  e  an edit at zoom 2: console clean, no tile dirty, the view back at its level
//  f  no bakes over 2 s of idle, or for a repaint, at zoom 2 and zoom 4, and at zoom 4 from a view that cuts tiles: no loop, and what is seen stays in the cache
//  r  at zoom 4, a new view bakes what it shows and nothing around it: at most a quarter and a final image a tile
//  g  at the smallest GPU budget 100% settles on, zoom 4 settles without the error banner (the level may fall back; it is reported)
//  h  a detail bake the allocator refuses falls back to level 1 with no banner, and a budget change tries the finest again
// Writes one JSON line; exit 1 if any check fails.
import {chromePath, chromeGpuFlags} from './chrome.mjs';
import {cdpPortFree} from './cdp-port.mjs';
import {spawn} from 'node:child_process';
import {readFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';

const args = process.argv.slice(2);
const opt = (name, fallback) => { const i = args.indexOf(name); return i >= 0 ? args.splice(i, 2)[1] : fallback; };
const server = opt('--server', 'http://127.0.0.1:8801'), port = Number(opt('--port', 9450)), map = opt('--map', '8'), [vw, vh] = opt('--view', '2560x1440').split('x').map(Number);
const TILE_PX = 16, W = 1024, O = 256;
const [sceneFile] = args;
const scene = JSON.parse(readFileSync(sceneFile, 'utf8'));
const url = `${server}/?biome=${scene.biome}&mapX=${map}&mapY=${map}&scratch=1&gpuMB=512&heapMB=1536${scene.query ? '&' + scene.query : ''}`;
await cdpPortFree(port);
const chrome = spawn(chromePath, ['--headless=new', ...chromeGpuFlags,
  `--remote-debugging-port=${port}`, `--user-data-dir=${join(tmpdir(), `terra-zoom-${port}`)}`, `--window-size=${vw},${vh}`, '--no-first-run', 'about:blank'], {stdio: 'ignore'});
const sleep = ms => new Promise(r => setTimeout(r, ms));
const result = {scene: sceneFile, checks: {}};
const check = (name, ok, detail) => { result.checks[name] = detail === undefined ? ok : {ok, ...detail}; if (!ok) process.exitCode = 1; };
try {
  let ws;
  for (let i = 0; i < 75 && !ws; i++) {
    try { const t = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json(); const p = t.find(x => x.type === 'page'); if (p) ws = new WebSocket(p.webSocketDebuggerUrl); } catch {}
    if (!ws) await sleep(200);
  }
  await new Promise(r => ws.onopen = r);
  let id = 0; const wait = new Map(), logs = [];
  ws.onmessage = e => {
    const m = JSON.parse(e.data);
    if (m.id && wait.has(m.id)) { wait.get(m.id)(m); wait.delete(m.id); }
    if (m.method === 'Runtime.consoleAPICalled' && ['error', 'warning'].includes(m.params.type)) logs.push(m.params.type + ': ' + m.params.args.map(a => a.value ?? a.description).join(' '));
    if (m.method === 'Runtime.exceptionThrown') logs.push('exception: ' + (m.params.exceptionDetails.exception?.description || m.params.exceptionDetails.text));
  };
  const send = (method, params = {}) => new Promise(r => { const k = ++id; wait.set(k, r); ws.send(JSON.stringify({id: k, method, params})); });
  const ev = async expr => { const r = await send('Runtime.evaluate', {expression: expr, returnByValue: true, awaitPromise: true}); if (r.result?.exceptionDetails) throw new Error(r.result.exceptionDetails.exception?.description || r.result.exceptionDetails.text); return r.result?.result?.value; };
  const ready = async () => { for (let i = 0; i < 480; i++) { await sleep(250); if (await ev('!!window.sculptCanvas && !!window.sculptRegion && sculptRegion.canExport()')) { await ev('sculptCanvas.idle()'); return true; } } return false; };
  await send('Runtime.enable'); await send('Page.enable');
  await send('Page.navigate', {url});
  if (!await ready()) throw new Error('editor never became ready: ' + await ev(`document.getElementById('error').textContent`));
  const strokes = scene.strokes;
  await ev(`sculptDebug.scene(${JSON.stringify(strokes)}, {ground: ${scene.ground !== false}})`);
  if (!await ready()) throw new Error('scene never finished');
  await send('Emulation.setDeviceMetricsOverride', {width: vw, height: vh, deviceScaleFactor: 1, mobile: false});
  // Page-side helpers: reads of the terrain canvas are kept by name, and compared there (a window is 4 MB).
  await ev(`(() => {
    const keep = window.__z = {reads: {}};
    keep.read = (name, x, y, w, h) => { keep.reads[name] = document.getElementById('terrain').getContext('2d').getImageData(x, y, w, h).data; return true; };
    keep.diff = (a, b) => { const A = keep.reads[a], B = keep.reads[b]; let n = 0; for (let i = 0; i < A.length; i += 4) if (A[i] !== B[i] || A[i + 1] !== B[i + 1] || A[i + 2] !== B[i + 2] || A[i + 3] !== B[i + 3]) n++; return n; };
    keep.bake = async (name, x, y, w, h, level) => { const b = await sculptCanvas.debugBake({x, y, width: w, height: h}, level), o = new OffscreenCanvas(b.width, b.height).getContext('2d'); o.drawImage(b, 0, 0); keep.reads[name] = o.getImageData(0, 0, b.width, b.height).data; return [b.width, b.height]; };
    keep.join = (name, parts, w) => { const out = new Uint8ClampedArray(w * w * 4), half = w / 2; parts.forEach((p, k) => { const ox = (k % 2) * half, oy = (k >> 1) * half, A = keep.reads[p]; for (let y = 0; y < half; y++) out.set(A.subarray(y * half * 4, (y + 1) * half * 4), ((oy + y) * w + ox) * 4); }); keep.reads[name] = out; return true; };
    keep.goto = async z => { sculptCanvas.zoom(z); const v = document.getElementById('viewport'); v.scrollLeft = ${O} * z; v.scrollTop = ${O} * z; await new Promise(r => requestAnimationFrame(r)); await sculptCanvas.idle(); return sculptCanvas.view(); };
    // the tiles near the view (the planner bakes the ring around it too): 256 px display tiles, not the fit ones
    keep.tiles = () => { const v = sculptCanvas.view(), near = e => e.x + e.width > v.x - 256 && e.x < v.x + v.width + 256 && e.y + e.height > v.y - 256 && e.y < v.y + v.height + 256, seen = e => e.x + e.width > v.x && e.x < v.x + v.width && e.y + e.height > v.y && e.y < v.y + v.height;
      return sculptCanvas.cacheSnapshot().filter(e => !/,fit$/.test(e.key) && e.width <= 256 && near(e)).map(e => ({seen: seen(e), dirty: e.dirty, scale: e.scale ?? 1})); };
    return true; })()`);
  const level = async want => {   // wait until every tile in view is current and at the level wanted (or report where it stopped)
    let t;
    for (let i = 0; i < 80; i++) { await ev('sculptCanvas.idle()'); t = await ev('__z.tiles()'); const seen = t.filter(e => e.seen); if (seen.length && seen.every(e => !e.dirty && e.scale === want)) return {ok: true, tiles: seen.length}; await sleep(250); }
    return {ok: false, tiles: t.filter(e => e.seen).map(e => e.scale + (e.dirty ? 'd' : ''))};
  };
  const banner = () => ev(`document.getElementById('error').hidden`);
  const bakes = () => ev('sculptCanvas.stats().bakes');
  const repaint = async () => { const n = await bakes(); await ev('sculptCanvas.schedule()'); await sleep(1000); await ev('sculptCanvas.idle()'); return await bakes() - n; };

  // a
  await ev(`__z.goto(1)`); const a1 = await level(1); await ev(`__z.read('one', 0, 0, ${W}, ${W})`);
  await ev(`__z.goto(2)`); const a2 = await level(.5);
  check('a', a1.ok && a2.ok, {zoom1: a1, zoom2: a2});
  // b: the canvas at zoom 2, tile (256, 256) is its top-left 512 px
  await ev(`__z.read('canvas2', 0, 0, 512, 512)`);
  const size = await ev(`__z.bake('tile', ${O}, ${O}, 256, 256, .5)`);
  const b = await ev(`__z.diff('canvas2', 'tile')`);
  check('b', b <= TILE_PX && size[0] === 512, {pixels: b, bitmap: size});
  // f at zoom 2
  const f2a = await bakes(); await sleep(2000); const f2b = await bakes(), f2r = await repaint();
  // d: a 512 px tile above 1x is the check's, not a view's: the editor never asks for one
  await ev(`sculptCanvas.setBudgets({gpuMB: 2048})`);
  for (const [k, x, y] of [['d0', 0, 0], ['d1', 256, 0], ['d2', 0, 256], ['d3', 256, 256]]) await ev(`__z.bake('${k}', ${O} + ${x}, ${O} + ${y}, 256, 256, .5)`);
  await ev(`__z.join('joined', ['d0', 'd1', 'd2', 'd3'], 1024)`); await ev(`__z.bake('whole', ${O}, ${O}, 512, 512, .5)`);
  const d = await ev(`__z.diff('joined', 'whole')`);
  check('d', d <= TILE_PX, {pixels: d});
  for (const [k, x, y] of [['q0', 0, 0], ['q1', 256, 0], ['q2', 0, 256], ['q3', 256, 256]]) await ev(`__z.bake('${k}', ${O} + ${x}, ${O} + ${y}, 256, 256, .25)`);
  await ev(`__z.join('joined4', ['q0', 'q1', 'q2', 'q3'], 2048)`); await ev(`__z.bake('whole4', ${O}, ${O}, 512, 512, .25)`);
  const d4 = await ev(`__z.diff('joined4', 'whole4')`);
  await ev(`sculptCanvas.setBudgets({gpuMB: 512})`);
  check('d4', d4 <= TILE_PX, {pixels: d4});
  // a, f at zoom 4
  await ev(`__z.goto(4)`); const a4 = await level(.25);
  check('a4', a4.ok, a4);
  const f4a = await bakes(); await sleep(2000); const f4b = await bakes(), f4r = await repaint();
  check('f', f2a === f2b && f4a === f4b && !f2r && !f4r, {zoom2: [f2a, f2b, f2r], zoom4: [f4a, f4b, f4r]});
  // r: two tiles over and down, cutting tiles, on ground no bake has touched at this level
  const r0 = await bakes();
  await ev(`(async () => { const v = document.getElementById('viewport'); v.scrollLeft += ${(256 * 2 + 128) * 4}; v.scrollTop += ${(256 * 2 + 128) * 4}; await new Promise(r => requestAnimationFrame(r)); await sculptCanvas.idle(); })()`);
  const r1 = await level(.25); await sleep(1500); await ev('sculptCanvas.idle()'); const rb = await bakes() - r0, rs = (await ev('__z.tiles()')).filter(t => t.seen).length;
  check('r', r1.ok && rb <= rs * 2, {bakes: rb, seen: rs});
  // c
  await ev(`__z.goto(1)`); const c1 = await level(1); await ev(`__z.read('back', 0, 0, ${W}, ${W})`);
  const c = await ev(`__z.diff('one', 'back')`);
  check('c', c === 0 && c1.ok, {pixels: c, level: c1});
  // e
  await ev(`__z.goto(2)`); await level(.5);
  const extra = ['landform', [[O + 300, O + 300], [O + 420, O + 360]], {card: {diameter: 160, heightReference: 1, elevation: 124}, curve: {form: 'lfHill'}}];   // a rounded ridge ~100 above the plain
  await ev(`sculptDebug.scene(${JSON.stringify([...strokes, extra])}, {ground: ${scene.ground !== false}})`);
  if (!await ready()) throw new Error('edited scene never finished');
  await ev('sculptCanvas.idle()'); const e1 = await level(.5);
  const dirty = (await ev('__z.tiles()')).filter(t => t.seen && t.dirty).length;
  check('e', e1.ok && dirty === 0 && !logs.length && await banner(), {level: e1, dirty, console: logs.slice(0, 4)});
  // g: the smallest budget at which 100% itself settles (below it the editor's own floor refuses before any zoom: the GPU fields, the
  // canvas and a 256 px chunk do not fit), then zoom 4 on it. A refused 100% leaves logs and the banner that are not this check's.
  const settle = async () => { let g; for (let i = 0; i < 80; i++) { await ev('sculptCanvas.idle()'); g = (await ev('__z.tiles()')).filter(t => t.seen); if (g.length && g.every(t => !t.dirty)) break; await sleep(250); } return g; };
  let budget = 0;
  for (const mb of [128, 192, 256, 384]) {
    const mark = logs.length;
    try { await ev(`sculptCanvas.setBudgets({gpuMB: ${mb}})`); await ev(`__z.goto(1)`); const one = await settle(); if (one.length && one.every(t => !t.dirty) && await banner() && logs.length === mark) { budget = mb; break; } } catch (e) { if (!/exceed the GPU memory budget/.test(e.message)) throw e; }
    logs.length = mark; await ev(`document.getElementById('error').hidden = true`);
  }
  await ev(`__z.goto(4)`);
  const g = await settle(), gb = await bakes(); await sleep(1500); const ga = await bakes(), gr = await repaint();
  check('g', budget > 0 && g.length > 0 && g.every(t => !t.dirty) && await banner() && !logs.length && gb === ga && !gr, {budgetMB: budget, levels: [...new Set(g.map(t => t.scale))], bakesAfterSettle: ga - gb, bakesForRepaint: gr, console: logs.slice(0, 4)});
  // h: a detail bake the allocator refuses falls back a level at a time, with no banner, and a budget change tries the finest again
  await ev(`(() => { const r = sculptCanvas.renderer, a = r.allocate.bind(r); window.__alloc = a; r.allocate = (...x) => { if ((x[6] ?? 1) < 1) throw new Error('nanolathe: chunk needs 999 MB of GPU memory (refused for the check)'); return a(...x); }; return true; })()`);
  await ev(`sculptCanvas.invalidate()`); const h = await settle();
  const hb = await banner(), hl = [...new Set(h.map(t => t.scale))];
  await ev(`sculptCanvas.renderer.allocate = window.__alloc; sculptCanvas.setBudgets({gpuMB: 512}); true`); await ev(`sculptCanvas.invalidate()`); const h2 = await settle();
  check('h', hb && h.length > 0 && hl.length === 1 && hl[0] === 1 && h2.length > 0 && h2.every(t => t.scale === .25) && !logs.length, {refusedLevels: hl, banner: !hb, afterBudgetChange: [...new Set(h2.map(t => t.scale))], console: logs.slice(0, 4)});
  result.bakes = await bakes(); result.rebakes = await ev('sculptCanvas.stats().rebakes');
  ws.close();
} catch (err) { result.error = err.message; process.exitCode = 1; }
finally { chrome.kill(); }
console.log(JSON.stringify(result));
