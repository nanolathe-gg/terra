// Render a reproduction scene in headless Chrome (WebGPU) and save the canvas.
//   node render.mjs <scene.json> <out-dir> [--server http://127.0.0.1:8801] [--port 9450] [--query 'sun=90,45&cavity=.5'] [--clay]
// --query appends page parameters after the scene's own (review sun, knob trials); --clay ticks the Clay box.
// The scene is {"biome": "green", "query": "", "ground": true, "strokes": [[kind, [[x,y],...], options], ...]}
// (sculpt.js scriptedScene). H12b: the scene is played on a 4x4 map with every stroke shifted by --offset (default 0:
// the window is the map's top-left 1024 px; --sea N sets the sea, default the map's), and the window is captured at 1x. Writes <out-dir>/ours.png (the
// window) and ours-heights.json (the displayed heights over the window, 512 x 512 samples at 2 px).
import {cdpPortFree} from './cdp-port.mjs';
import {spawn} from 'node:child_process';
import {mkdirSync, readFileSync, writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';

const args = process.argv.slice(2);
const opt = (name, fallback) => { const i = args.indexOf(name); return i >= 0 ? args.splice(i, 2)[1] : fallback; };
const server = opt('--server', 'http://127.0.0.1:8801'), port = Number(opt('--port', 9450));
const extraQuery = opt('--query', '');
const MAPX = 4, MAPY = 4, WINDOW = 1024;
const TILE_PX = 16;   // the most pixels of a window the tile size may move
const clayOn = args.includes('--clay') && args.splice(args.indexOf('--clay'), 1).length > 0;
const OX = Number(opt('--offset', 0)), OY = OX, seaArg = opt('--sea', '');
const [sceneFile, out] = args;
const scene = JSON.parse(readFileSync(sceneFile, 'utf8'));
mkdirSync(out, {recursive: true});
// The page used to fall back to the server's first world for an unknown one,
// so a Moon scene could be written out as Green. Refuse before rendering:
// the config request must answer for the scene's world (review A3).
const sceneConfigResponse = await fetch(`${server}/config/${encodeURIComponent(scene.biome)}.json`);
if (!sceneConfigResponse.ok) {
  console.error(`render.mjs: ${sceneFile}: world ${scene.biome} is not served (HTTP ${sceneConfigResponse.status})`);
  process.exit(1);
}
const sceneConfig = await sceneConfigResponse.json();
// A host without the exporter (the static site) leaves the export button off, so, as for Zhon, the enabled editor stands in for it.
const noExport = (await (await fetch(`${server}/services.json`)).json()).export?.available === false;
if (sceneConfig.biomeId !== scene.biome) {
  console.error(`render.mjs: ${sceneFile}: asked for world ${scene.biome}, the server returned ${sceneConfig.biomeId}`);
  process.exit(1);
}
const url = `${server}/sculpt.html?biome=${scene.biome}&mapX=${MAPX}&mapY=${MAPY}&scratch=1&gpuMB=512&heapMB=1536${seaArg !== '' ? '&sea=' + seaArg : ''}${scene.query ? '&' + scene.query : ''}${extraQuery ? '&' + extraQuery : ''}`;
await cdpPortFree(port);
const chrome = spawn('/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', ['--headless=new', '--enable-gpu', '--use-angle=metal',
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
  // A Zhon map cannot export (by design), so its export button never enables: its editor being enabled and the canvas idle stand in.
  const ready = async () => { for (let i = 0; i < 480; i++) { await sleep(250); if (await ev(`!!window.sculptCanvas && (!document.getElementById('map-export')?.disabled || (${scene.biome === 'zhon' || noExport} && !document.getElementById('editor')?.disabled && sculptCanvas.idle().then(() => true)))`)) { if (scene.biome === 'zhon' || noExport) await sleep(2500); return true; } } return false; };
  await send('Runtime.enable'); await send('Page.enable');
  await send('Page.navigate', {url});
  if (!await ready()) throw new Error('editor never became ready: ' + await ev(`document.getElementById('error').textContent`));
  const loadedBiome = await ev('sculptDebug.biome');
  if (loadedBiome !== scene.biome) throw new Error(`page loaded world ${loadedBiome}, scene asks for ${scene.biome}`);
  if (clayOn) await ev(`(() => { const c = document.getElementById('clay'); c.checked = true; c.dispatchEvent(new Event('change', {bubbles: true})); })()`);
  const t0 = Date.now();
  const count = await ev(`sculptDebug.scene(${JSON.stringify(scene.strokes.map(([kind, points, options]) => [kind, points.map(([x, y]) => [x + OX, y + OY]), options]))}, {ground: ${scene.ground !== false}})`);
  if (!await ready()) throw new Error('scene never finished: ' + await ev(`document.getElementById('error').textContent`));
  // The window at 1x: scroll the viewport to (OX, OY), wait for the chunks, crop the displayed canvas.
  await send('Emulation.setDeviceMetricsOverride', {width: 1700, height: 1300, deviceScaleFactor: 1, mobile: false});
  const view = await ev(`(async () => { sculptCanvas.resize(); sculptCanvas.zoom(1); const v = document.getElementById('viewport'); v.scrollLeft = ${OX}; v.scrollTop = ${OY}; await new Promise(r => requestAnimationFrame(r)); await sculptCanvas.idle(); const s = sculptCanvas.view(); const c = document.getElementById('terrain'); return {x: s.x, y: s.y, scale: s.scale, w: c.width, h: c.height}; })()`);
  if (view.x !== OX || view.y !== OY || view.scale !== 1 || view.w < WINDOW || view.h < WINDOW) throw new Error('the 1x window did not fit the viewport: ' + JSON.stringify(view));
  const png = await ev(`(() => { const c = document.getElementById('terrain'), o = new OffscreenCanvas(${WINDOW}, ${WINDOW}); o.getContext('2d').drawImage(c, 0, 0, ${WINDOW}, ${WINDOW}, 0, 0, ${WINDOW}, ${WINDOW}); return o.convertToBlob({type: 'image/png'}).then(b => new Promise(r => { const f = new FileReader(); f.onload = () => r(f.result); f.readAsDataURL(b); })); })()`);
  writeFileSync(`${out}/ours.png`, Buffer.from(png.split(',')[1], 'base64'));
  // The displayed heights over the window, 2 px apart: the editor's own sampler (the Time pass's height). Its first
  // call starts the CPU copy of the Time pass, so sample once, wait for the copy, then sample for real.
  const sampleWindow = `(() => { const out = new Array(512 * 512); for (let j = 0; j < 512; j++) for (let i = 0; i < 512; i++) out[j * 512 + i] = sculptDebug.corner(${OX} + 2 * i, ${OY} + 2 * j).eroded; return out; })()`;
  await ev(sampleWindow); await sleep(1500); await ev('sculptCanvas.idle()');
  const hs = {out: await ev(sampleWindow)};
  writeFileSync(`${out}/ours-heights.json`, JSON.stringify({grid: 512, sea: await ev('sculptDebug.sea'), heights: hs.out}));
  // The picture must not depend on how the map is cut into tiles: the window's four 512 px tiles, baked alone, match the canvas's 256 px view tiles. A fed tile once
  // took its lattice's height from its width, so rows past that were one row repeated; every render reads this now. Triangles landing a hair apart leave a few single pixels.
  const tiles = await ev(`(async () => { const c = document.getElementById('terrain').getContext('2d'); let px = 0; for (const y of [0, 512]) for (const x of [0, 512]) { const b = await sculptCanvas.debugBake({x: ${OX} + x, y: ${OY} + y, width: 512, height: 512}, 1), o = new OffscreenCanvas(512, 512).getContext('2d'); o.drawImage(b, 0, 0); const A = c.getImageData(x, y, 512, 512).data, B = o.getImageData(0, 0, 512, 512).data; for (let i = 0; i < A.length; i += 4) if (A[i] !== B[i] || A[i + 1] !== B[i + 1] || A[i + 2] !== B[i + 2]) px++; } return px; })()`);
  if (tiles > TILE_PX) { console.error(`render.mjs: ${sceneFile}: ${tiles} pixels change with the tile size`); process.exitCode = 1; }
  console.log(JSON.stringify({nodes: count, ms: Date.now() - t0, weather: await ev(`document.getElementById('weather-state').textContent`), mismatch: await ev('sculptDebug.replayAll()'), tiles, console: logs.slice(0, 8)}));
  ws.close();
} finally { chrome.kill(); }
