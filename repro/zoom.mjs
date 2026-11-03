// Check worker-backed zoom, tiled GPU renders, restoration, idle, and replay after an edit.
// node repro/zoom.mjs <scene.json> [--server URL] [--port N] [--map N] [--view WIDTHxHEIGHT]
// Reports split-tile pixel differences (tolerance 16), 1x restoration, and regional replay.
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
const url = `${server}/sculpt?biome=${scene.biome}&mapX=${map}&mapY=${map}&scratch=1&gpuMB=512&heapMB=1536${scene.query ? '&' + scene.query : ''}`;
await cdpPortFree(port);
const chrome = spawn('/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', ['--headless=new', '--enable-gpu', '--use-angle=metal',
  `--remote-debugging-port=${port}`, `--user-data-dir=${join(tmpdir(), `terraform-zoom-${port}`)}`, `--window-size=${vw},${vh}`, '--no-first-run', 'about:blank'], {stdio: 'ignore'});
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
  const ready = async () => { for (let i = 0; i < 480; i++) { await sleep(250); if (await ev(`!!window.sculptCanvas && (!document.getElementById('map-export')?.disabled || (${scene.biome === 'zhon'} && !document.getElementById('editor')?.disabled && sculptCanvas.idle().then(() => true)))`)) { if (scene.biome === 'zhon') await sleep(2500); return true; } } return false; };
  await send('Runtime.enable'); await send('Page.enable');
  await send('Page.navigate', {url});
  if (!await ready()) throw new Error('editor never became ready: ' + await ev(`document.getElementById('error').textContent`));
  const strokes = scene.strokes;
  await ev(`sculptDebug.scene(${JSON.stringify(strokes)}, {ground: ${scene.ground !== false}})`);
  if (!await ready()) throw new Error('scene never finished');
  await send('Emulation.setDeviceMetricsOverride', {width: vw, height: vh, deviceScaleFactor: 1, mobile: false});
  // Exercise worker-backed views and direct GPU bakes using the public debug API.
  await ev(`(() => {
    const z = window.__z = {reads: {}};
    z.goto = async scale => { sculptCanvas.zoom(scale); const v = document.getElementById('viewport'); v.scrollLeft = ${O} * scale; v.scrollTop = ${O} * scale; await new Promise(r => requestAnimationFrame(r)); await sculptCanvas.idle(); return sculptCanvas.view(); };
    z.read = name => { const c = document.getElementById('terrain'); z.reads[name] = c.getContext('2d').getImageData(0,0,c.width,c.height).data; return [c.width,c.height]; };
    z.bake = async (name,x,y,w,h,scale) => { const c = await sculptCanvas.debugBake({x,y,width:w,height:h},scale); z.reads[name] = c.getContext('2d').getImageData(0,0,c.width,c.height).data; return [c.width,c.height]; };
    z.join = (name,parts,w) => { const a = new Uint8ClampedArray(w*w*4), n=w/2; parts.forEach((p,k) => { const x=(k%2)*n,y=Math.floor(k/2)*n,b=z.reads[p]; for(let j=0;j<n;j++) a.set(b.subarray(j*n*4,(j+1)*n*4),((y+j)*w+x)*4); }); z.reads[name]=a; };
    z.diff = (a,b) => { const x=z.reads[a],y=z.reads[b]; if(x.length!==y.length) return -1; let n=0; for(let i=0;i<x.length;i+=4) if(x[i]!==y[i]||x[i+1]!==y[i+1]||x[i+2]!==y[i+2]||x[i+3]!==y[i+3]) n++; return n; };
  })()`);
  const one = await ev('__z.goto(1)'); await ev("__z.read('one')");
  const two = await ev('__z.goto(2)'), four = await ev('__z.goto(4)');
  check('zoom levels', one.scale === 1 && two.scale === 2 && four.scale === 4, {one: one.scale, two: two.scale, four: four.scale});
  for (const scale of [.5, .25]) {
    const side = scale === .5 ? 128 : 64, pixels = side / scale;
    for (const [i,x,y] of [[0,0,0],[1,side,0],[2,0,side],[3,side,side]]) await ev(`__z.bake('part${i}', ${O}+${x}, ${O}+${y}, ${side}, ${side}, ${scale})`);
    await ev(`__z.join('joined',['part0','part1','part2','part3'],${pixels*2})`);
    const size = await ev(`__z.bake('whole',${O},${O},${side*2},${side*2},${scale})`), difference = await ev("__z.diff('joined','whole')");
    check(`tiles ${scale}`, difference >= 0 && difference <= TILE_PX, {pixels: difference, bitmap: size});
  }
  await ev('__z.goto(1)'); await ev("__z.read('back')"); const restored = await ev("__z.diff('one','back')");
  check('restore 1x', restored === 0, {pixels: restored});
  const before = await ev('sculptCanvas.stats()'); await sleep(2000); await ev('sculptCanvas.idle()'); const after = await ev('sculptCanvas.stats()');
  check('idle', !after.pending && after.revision === before.revision && after.cachedChunks === before.cachedChunks, {before:before.cachedChunks, after:after.cachedChunks});
  const extra = ['hill', [[O+300,O+300],[O+420,O+360]], {card:{diameter:160,amount:100,roughness:10}}];
  await ev(`sculptDebug.scene(${JSON.stringify([...strokes, extra])}, {ground: ${scene.ground !== false}})`); await ev('sculptCanvas.idle()');
  const mismatch = await ev('sculptDebug.replayAll()'); check('edit replay', mismatch === 0 && !logs.length, {mismatch, console:logs.slice(0,4)});
  ws.close();
} catch (err) { result.error = err.message; process.exitCode = 1; }
finally { chrome.kill(); }
console.log(JSON.stringify(result));
