// Render a reproduction scene and save its window: under Node on Dawn (repro/headless.mjs, the default), or in headless Chrome (WebGPU) with --chrome.
//   node render.mjs <scene.json> <out-dir> [--server http://127.0.0.1:<yours>] [--port <cdp>] [--query 'sun=90&sunHeight=30&cavity=.5'] [--clay] [--chrome]
//        [--map 4x4] [--configs DIR]
// --query sets page parameters over the scene's own: a key the scene's query also sets takes --query's value (review sun, knob trials,
// a retail match probe of a map setting such as undulation); --clay ticks the Clay box.
// The scene is {"biome": "green", "query": "", "ground": true, "strokes": [[kind, [[x,y],...], options], ...]}
// (sculpt-scene.js sceneNodes). H12b: the scene is played on a 4x4 map (--map WxH for another) with every stroke shifted by --offset (default 0:
// the window is the map's top-left 1024 px; --sea N sets the sea, default the map's), and the window is captured at 1x. Writes <out-dir>/ours.png (the
// window) and ours-heights.json (the displayed heights over the window, 512 x 512 samples at 2 px). Both hosts write the same bytes for the same pixels.
// Under Node the engine's files come from --server, or with no --server from this checkout (the world configs from go run ./cmd/terraform --dump-configs, or
// --configs DIR); --port is Chrome's alone (default 9450). --chrome needs --server: the page path has no default server, so it never loads
// another session's editor.
import {chromePath, chromeGpuFlags} from './chrome.mjs';
import {cdpPortFree} from './cdp-port.mjs';
import {encodePng} from './png.mjs';
import {spawn} from 'node:child_process';
import {mkdirSync, readFileSync, writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';

const args = process.argv.slice(2);
const opt = (name, fallback) => { const i = args.indexOf(name); return i >= 0 ? args.splice(i, 2)[1] : fallback; };
const flag = name => args.includes(name) && args.splice(args.indexOf(name), 1).length > 0;
const chrome = flag('--chrome'), serverArg = opt('--server', ''), server = serverArg, port = Number(opt('--port', 9450));
if (chrome && !server) { console.error('render.mjs: --chrome needs --server http://127.0.0.1:<port> of your own Go development server (there is no default server).'); process.exit(2); }
const extraQuery = opt('--query', ''), configs = opt('--configs', ''), [MAPX, MAPY] = opt('--map', '4x4').split('x').map(Number), WINDOW = 1024;
const TILE_PX = 16;   // the most pixels of a window the tile size may move
const clayOn = flag('--clay');
const OX = Number(opt('--offset', 0)), OY = OX, seaArg = opt('--sea', '');
const [sceneFile, out] = args;
// A stroke option (Steps, Gullies, Spurs...) is not a page setting: the scene's strokes take theirs from their cards and the world's defaults, so in a
// --query it would change nothing, without a word. Say so instead.
{
  const [{SHAPE_FIELDS, LANDFORM_KEYS, SECTION_KEYS}, {KNOBS}] = await Promise.all([import('../sculpt-scene.js'), import('../sculpt-knobs.js')]);
  const rows = new Set(KNOBS.flatMap(([, list]) => list.map(k => k[0]))), stroke = new Set([...SHAPE_FIELDS.map(f => f[0]), ...LANDFORM_KEYS, ...SECTION_KEYS]);
  const wrong = [...new URLSearchParams(extraQuery).keys()].filter(k => stroke.has(k) && !rows.has(k));
  if (wrong.length) { console.error(`render.mjs: --query ${wrong.join(', ')}: a stroke option, which a page setting does not reach. Set it in the scene's stroke cards, or as the world's default in materials/<world>.json world.knobDefaults.`); process.exit(2); }
}
const scene = JSON.parse(readFileSync(sceneFile, 'utf8'));
mkdirSync(out, {recursive: true});
const params = new URLSearchParams(`biome=${scene.biome}&mapX=${MAPX}&mapY=${MAPY}&scratch=1&gpuMB=512&heapMB=1536${seaArg !== '' ? '&sea=' + seaArg : ''}${scene.query ? '&' + scene.query : ''}`);
for (const [k, v] of new URLSearchParams(extraQuery)) params.set(k, v);   // the page reads a key's first value, so an appended one would lose
const search = params.toString();
const strokes = scene.strokes.map(([kind, points, options]) => [kind, points.map(([x, y]) => [x + OX, y + OY]), options]);
// base: the plain above the sea (repro/stats.py reads it; a map may hold its own, the `plain` setting).
const writeHeights = (sea, heights, base) => writeFileSync(`${out}/ours-heights.json`, JSON.stringify({grid: 512, sea, heights, ...(Number.isFinite(base) ? {base} : {})}));

if (chrome) await renderInChrome();
else await renderHeadless().catch(error => { console.error(`render.mjs: ${sceneFile}: ${error.message}`); process.exit(1); });

// The engine on Dawn, no browser: the page's steps for a scene with the page's own modules (repro/headless.mjs).
async function renderHeadless() {
  const t0 = Date.now(), headless = await import('./headless.mjs');
  await headless.openHost({server: serverArg, configs});
  const s = await headless.openScene(scene, search, {strokes});
  const time = await headless.weather(s);
  const options = s.drawOptions({clay: clayOn, light: 'original'});
  const pixels = await headless.renderWindow(s, {x: OX, y: OY, width: WINDOW, height: WINDOW, options});
  writeFileSync(`${out}/ours.png`, encodePng(WINDOW, WINDOW, pixels));
  writeHeights(s.config.seaLevel, await headless.windowHeights(s, {x: OX, y: OY}), s.config.baseHeight - s.config.seaLevel);
  // The picture must not depend on how the map is cut into tiles: the window's four 512 px tiles, baked alone, match the 256 px view tiles.
  const big = await headless.renderWindow(s, {x: OX, y: OY, width: WINDOW, height: WINDOW, tile: 512, options});
  let tiles = 0; for (let i = 0; i < big.length; i += 4) if (big[i] !== pixels[i] || big[i + 1] !== pixels[i + 1] || big[i + 2] !== pixels[i + 2]) tiles++;
  if (tiles > TILE_PX) { console.error(`render.mjs: ${sceneFile}: ${tiles} pixels change with the tile size`); process.exitCode = 1; }
  const weather = time ? (time.paged ? 'Weathered edges · GPU time pass in pages' : `Weathered edges · GPU time pass ${Math.round(time.milliseconds)} ms`) : 'Weathering off · authored surface';
  console.log(JSON.stringify({nodes: s.nodes.length, ms: Date.now() - t0, weather, tiles, console: s.errors.slice(0, 8), host: 'node'}));
  if (s.errors.length) process.exitCode = 1;
  s.dispose();
}

// The page in headless Chrome: the editor itself plays the scene (sculptDebug.scene) and the displayed canvas is cropped.
async function renderInChrome() {
  // The page used to fall back to the server's first world for an unknown one,
  // so a Moon scene could be written out as Green. Refuse before rendering:
  // the config request must answer for the scene's world (review A3).
  const sceneConfigResponse = await fetch(`${server}/config/${encodeURIComponent(scene.biome)}.json`);
  if (!sceneConfigResponse.ok) {
    console.error(`render.mjs: ${sceneFile}: world ${scene.biome} is not served (HTTP ${sceneConfigResponse.status})`);
    process.exit(1);
  }
  const sceneConfig = await sceneConfigResponse.json();
  if (sceneConfig.biomeId !== scene.biome) {
    console.error(`render.mjs: ${sceneFile}: asked for world ${scene.biome}, the server returned ${sceneConfig.biomeId}`);
    process.exit(1);
  }
  const url = `${server}/?${search}`;
  await cdpPortFree(port);
  const browser = spawn(chromePath, ['--headless=new', ...chromeGpuFlags,
    `--remote-debugging-port=${port}`, `--user-data-dir=${join(tmpdir(), `terraform-render-${port}`)}`, '--window-size=1500,1200', '--no-first-run', 'about:blank'], {stdio: 'ignore'});
  const sleep = ms => new Promise(r => setTimeout(r, ms));
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
    const loadedBiome = await ev('sculptDebug.biome');
    if (loadedBiome !== scene.biome) throw new Error(`page loaded world ${loadedBiome}, scene asks for ${scene.biome}`);
    if (clayOn) await ev(`(() => { const c = document.getElementById('clay'); c.checked = true; c.dispatchEvent(new Event('change', {bubbles: true})); })()`);
    const t0 = Date.now();
    const count = await ev(`sculptDebug.scene(${JSON.stringify(strokes)}, {ground: ${scene.ground !== false}})`);
    if (!await ready()) throw new Error('scene never finished: ' + await ev(`document.getElementById('error').textContent`));
    // The window at 1x: scroll the viewport to (OX, OY), wait for the chunks, crop the displayed canvas.
    await send('Emulation.setDeviceMetricsOverride', {width: 1700, height: 1300, deviceScaleFactor: 1, mobile: false});
    const view = await ev(`(async () => { sculptCanvas.resize(); sculptCanvas.zoom(1); const v = document.getElementById('viewport'); v.scrollLeft = ${OX}; v.scrollTop = ${OY}; await new Promise(r => requestAnimationFrame(r)); await sculptCanvas.idle(); const s = sculptCanvas.view(); const c = document.getElementById('terrain'); return {x: s.x, y: s.y, scale: s.scale, w: c.width, h: c.height}; })()`);
    if (view.x !== OX || view.y !== OY || view.scale !== 1 || view.w < WINDOW || view.h < WINDOW) throw new Error('the 1x window did not fit the viewport: ' + JSON.stringify(view));
    // The window's RGBA, written with the shared PNG writer so both hosts' files compare byte for byte.
    const rgba = await ev(`(() => { const d = document.getElementById('terrain').getContext('2d').getImageData(0, 0, ${WINDOW}, ${WINDOW}).data; let t = ''; for (let i = 0; i < d.length; i += 32768) t += String.fromCharCode(...d.subarray(i, i + 32768)); return btoa(t); })()`);
    writeFileSync(`${out}/ours.png`, encodePng(WINDOW, WINDOW, new Uint8Array(Buffer.from(rgba, 'base64'))));
    // The displayed heights over the window, 2 px apart: the editor's own sampler (the Time pass's height). Its first
    // call starts the CPU copy of the Time pass, so sample once, wait for the copy, then sample for real.
    const sampleWindow = `(() => { const out = new Array(512 * 512); for (let j = 0; j < 512; j++) for (let i = 0; i < 512; i++) out[j * 512 + i] = sculptDebug.corner(${OX} + 2 * i, ${OY} + 2 * j).eroded; return out; })()`;
    await ev(sampleWindow); await sleep(1500); await ev('sculptCanvas.idle()');
    writeHeights(await ev('sculptDebug.sea'), await ev(sampleWindow));
    // The picture must not depend on how the map is cut into tiles: the window's four 512 px tiles, baked alone, match the canvas's 256 px view tiles. A fed tile once
    // took its lattice's height from its width, so rows past that were one row repeated; every render reads this now. Triangles landing a hair apart leave a few single pixels.
    const tiles = await ev(`(async () => { const c = document.getElementById('terrain').getContext('2d'); let px = 0; for (const y of [0, 512]) for (const x of [0, 512]) { const b = await sculptCanvas.debugBake({x: ${OX} + x, y: ${OY} + y, width: 512, height: 512}, 1), o = new OffscreenCanvas(512, 512).getContext('2d'); o.drawImage(b, 0, 0); const A = c.getImageData(x, y, 512, 512).data, B = o.getImageData(0, 0, 512, 512).data; for (let i = 0; i < A.length; i += 4) if (A[i] !== B[i] || A[i + 1] !== B[i + 1] || A[i + 2] !== B[i + 2]) px++; } return px; })()`);
    if (tiles > TILE_PX) { console.error(`render.mjs: ${sceneFile}: ${tiles} pixels change with the tile size`); process.exitCode = 1; }
    console.log(JSON.stringify({nodes: count, ms: Date.now() - t0, weather: await ev(`document.getElementById('weather-state').textContent`), tiles, console: logs.slice(0, 8), host: 'chrome'}));
    ws.close();
  } finally { browser.kill(); }
}
