// Card H7 item 1: where the time goes between an edit or a load and the final picture.
//   node repro/perf.mjs <map4|map8|map16|map40> --scene repro/scenes/green-2.json --out <dir>
//        [--server http://127.0.0.1:8867] [--port 9667] [--no-export] [--label name]
// Opens a fresh headless Chrome, installs timing hooks before the page runs (no page source is edited), then scripts:
//   load      scene applied, zoomed to 1x: first picture, weather ready, every visible chunk at final
//   drag      a stroke drag with real mouse events: rAF frame intervals
//   release   the stroke's release: time to weather ready and to every visible chunk at final
//   scroll    a pan across several chunks: rAF frame intervals, coverage, time to final after it stops
//   export    sculptMap.export (skipped with --no-export)
// and writes <out>/<mode>-perf.json.
// The hooks time GPU passes with timestamp queries (added to every pass that has none), the queue waits, and the JS
// stages a chunk bake runs through: region read (shape replay), field upload, draw encode, bitmap copy.
import {cdpPortFree} from './cdp-port.mjs';
import {spawn} from 'node:child_process';
import {mkdirSync, readFileSync, writeFileSync} from 'node:fs';
import {loadavg} from 'node:os';

const args = process.argv.slice(2);
const opt = (name, fallback) => { const i = args.indexOf(name); return i >= 0 ? args.splice(i, 2)[1] : fallback; };
const flag = name => { const i = args.indexOf(name); if (i >= 0) args.splice(i, 1); return i >= 0; };
const server = opt('--server', 'http://127.0.0.1:8867'), port = Number(opt('--port', 9667));
const sceneFile = opt('--scene', 'repro/scenes/green-2.json'), out = opt('--out', 'perf-out'), label = opt('--label', '');
const opt2 = (name, fallback) => { const i = process.argv.indexOf(name); return i >= 0 ? process.argv[i + 1] : fallback; };
const extraQuery = opt('--query', '');   // H7b: more page query, e.g. levels=0 or quarterFirst=0
const diagnosticGPU = flag('--diagnostic-gpu'), verifyPixels = flag('--verify-pixels'), verifyPicked = flag('--verify-picked'), selfTest = flag('--self-test');
const noExport = flag('--no-export'), only = opt('--only', '');   // --only load|drag|release|scroll: stop after that phase
const dragTool = opt('--tool', 'hill');   // H27: the brush the drag draws (hill, or landform to measure it beside a hill)
// A matching presentation must be a real tile drawing from the move's source
// revision or newer, intersecting the brush footprint and the visible viewport.
function matchesPresentation(p, move, revision, viewport, requireOverlap = true) {
  return p.type === 'presented' && p.t >= move.t && Number.isFinite(p.revision) && p.revision >= revision &&
    Number.isFinite(p.x) && Number.isFinite(p.y) && p.width > 0 && p.height > 0 &&
    (!requireOverlap || (p.x < move.worldX + move.radius && p.x + p.width > move.worldX - move.radius &&
    p.y < move.worldY + move.radius && p.y + p.height > move.worldY - move.radius)) &&
    Number.isFinite(p.screenX) && Number.isFinite(p.screenY) && p.screenWidth > 0 && p.screenHeight > 0 &&
    p.screenX < viewport.width && p.screenX + p.screenWidth > 0 &&
    p.screenY < viewport.height && p.screenY + p.screenHeight > 0;
}
if (selfTest) {
  const m = {t:10, worldX:30, worldY:30, radius:5}, v = {width:100,height:100};
  const p = {type:'presented',t:12,revision:2,x:20,y:20,width:20,height:20,screenX:20,screenY:20,screenWidth:20,screenHeight:20};
  if (!matchesPresentation(p,m,2,v) || matchesPresentation({...p,revision:1},m,2,v) ||
      matchesPresentation({...p,x:60},m,2,v) || !matchesPresentation({...p,x:60},m,2,v,false) || matchesPresentation({...p,screenX:120},m,2,v,false) ||
      matchesPresentation({...p,type:'bake-end'},m,2,v) || matchesPresentation({...p,t:9},m,2,v)) throw Error('presentation matching self-test failed');
  console.log('presentation matching self-test passed'); process.exit(0);
}
const [mode] = args;
if (!['map4', 'map8', 'map16', 'map40'].includes(mode)) { console.error('usage: node repro/perf.mjs <map4|map8|map16|map40> --scene <scene.json> --out <dir>'); process.exit(1); }
const scene = JSON.parse(readFileSync(sceneFile, 'utf8'));
mkdirSync(out, {recursive: true});
const sleep = ms => new Promise(r => setTimeout(r, ms));
const q = (a, p) => { if (!a.length) return null; const s = [...a].sort((x, y) => x - y); return s[Math.min(s.length - 1, Math.floor(p * s.length))]; };

// ---------------------------------------------------------------- hooks, installed before the page's own scripts
const HOOKS = `(() => {
const diagnosticGPU = ${diagnosticGPU}, verifyPixels = ${verifyPixels}, verifyPicked = ${verifyPicked};
const bitmapInfo = new WeakMap(), canvasInfo = new WeakMap(), presentedBitmaps = new WeakSet();
const P = window.__perf = {workerProfiles: [], worker: false, ev: [], gpu: [], passes: [], waits: [], images: [], draws: [], frames: [], stage: {}, ctx: ''};
const now = () => performance.now();
const ev = (type, data) => P.ev.push({t: now(), type, ...data});
const probes = new Map();
const probe = m => {
  const c = document.getElementById('terrain') || document.getElementById('map');
  if (!c || !Number.isFinite(m.screenX) || !Number.isFinite(m.screenY)) return null;
  const x=Math.max(0,Math.min(c.width-16,Math.floor(m.screenX)-8)), y=Math.max(0,Math.min(c.height-16,Math.floor(m.screenY)-8));
  if(c.width<16 || c.height<16)return null;
  return c.getContext('2d').getImageData(x,y,16,16).data;
};
P.mark = (type, data) => {
  ev(type,data);
  if(!verifyPixels)return;
  if(type==='move') { try { probes.set(data.k,{...data,before:probe(data)}); } catch(e) { ev('pixel-probe-error',{message:String(e)}); } }
  if(type==='rev' && probes.has(data.k)) probes.get(data.k).revision=data.rev;
};
P.present = d => {
  ev('presented',d);
  if(!verifyPixels)return;
  for(const [k,m] of probes) {
    if(m.revision==null || d.revision==null || d.revision<m.revision || !m.before ||
       !(d.x<m.worldX+m.radius && d.x+d.width>m.worldX-m.radius && d.y<m.worldY+m.radius && d.y+d.height>m.worldY-m.radius)) continue;
    try { const after=probe(m); if(after && after.some((v,i)=>v!==m.before[i])) { ev('pixel-change',{k,revision:d.revision}); probes.delete(k); } }
    catch(e) { ev('pixel-probe-error',{message:String(e)}); probes.delete(k); }
  }
};
const add = (name, ms) => { const s = P.stage[name] ??= {n: 0, ms: 0, max: 0}; s.n++; s.ms += ms; s.max = Math.max(s.max, ms); };
P.add = add;
// The Go worker owns its GPU device; public tile telemetry crosses that boundary.
window.addEventListener('terraform-render', event => {
 const d=event.detail||{},t=now();P.worker=true;
 if(d.phase==='presented') { P.present(d); return; }
 if(d.phase==='start') {ev('bake-start',{x:d.x,y:d.y,w:d.width,h:d.height,level:d.scale??1,id:d.id,rev:d.revision});return;}
 if(d.phase==='tile'||d.phase==='end') {
  const p=d.profile||{};ev('bake-end',{x:d.x,y:d.y,ms:d.milliseconds??p.TotalMilliseconds??0,level:d.scale??1,id:d.id,rev:d.revision});
  P.workerProfiles.push({t,...d});
  for(const [key,name] of Object.entries({TotalMilliseconds:'worker surface (wall)',FeedMilliseconds:'worker GPU feed (encode)',UploadMilliseconds:'worker field upload (CPU)',EncodeMilliseconds:'worker draw + bake (encode)',ReadbackMilliseconds:'worker GPU readback (wait + copy)'})) if(Number.isFinite(p[key]))add(name,p[key]);
  if(Number.isFinite(d.milliseconds)){add('worker tile (shape + time + surface)',d.milliseconds);if(Number.isFinite(p.TotalMilliseconds))add('worker shape + time + gather',Math.max(0,d.milliseconds-p.TotalMilliseconds));}
  return;
 }
 ev('worker-'+d.phase,d);
});
// ---- Optional original-only diagnostics. End-to-end runs do not instrument GPU passes.
P.readPasses = async () => ({});
if (diagnosticGPU) {
const devices = new WeakMap();
const cd = GPUDevice.prototype.createCommandEncoder;
const ring = new WeakMap();   // device -> {qs, resolve, next}
function slots(device) {
  let r = ring.get(device);
  if (!r && device.features.has('timestamp-query')) {
    const count = 2048; // the device allows 4096 queries a set, two a pass
    r = {qs: device.createQuerySet({type: 'timestamp', count: count * 2 > 4096 ? 4096 : count * 2}), resolve: device.createBuffer({size: 256 * count, usage: GPUBufferUsage.QUERY_RESOLVE | GPUBufferUsage.COPY_SRC}), next: 0, count, device};
    ring.set(device, r); P.ring = r;
  }
  return r;
}
GPUDevice.prototype.createCommandEncoder = function (d) { const e = cd.call(this, d); devices.set(e, this); return e; };
for (const kind of ['Compute', 'Render']) {
  const orig = GPUCommandEncoder.prototype['begin' + kind + 'Pass'];
  GPUCommandEncoder.prototype['begin' + kind + 'Pass'] = function (desc = {}) {
    const device = devices.get(this), r = diagnosticGPU && device && slots(device);
    if (!diagnosticGPU || !r || desc.timestampWrites || r.next >= r.count) return orig.call(this, desc);
    const i = r.next++, enc = this, endWrite = kind === 'Compute' ? 'endOfPassWriteIndex' : 'endOfPassWriteIndex';
    const pass = orig.call(this, {...desc, timestampWrites: {querySet: r.qs, beginningOfPassWriteIndex: 2 * i, [endWrite]: 2 * i + 1}});
    P.passes[i] = {label: desc.label || kind, kind, ctx: P.ctx};
    const end = pass.end.bind(pass);
    pass.end = () => { end(); enc.resolveQuerySet(r.qs, 2 * i, 2, r.resolve, 256 * i); };
    return pass;
  };
}
P.readPasses = async () => {   // copy the resolved timestamps, sum the milliseconds by pass label
  const r = P.ring; if (!r) return {};
  await r.device.queue.onSubmittedWorkDone();
  const n = r.next, read = r.device.createBuffer({size: 256 * Math.max(1, n), usage: GPUBufferUsage.MAP_READ | GPUBufferUsage.COPY_DST});
  const e = r.device.createCommandEncoder(); e.copyBufferToBuffer(r.resolve, 0, read, 0, 256 * Math.max(1, n)); r.device.queue.submit([e.finish()]);
  await read.mapAsync(GPUMapMode.READ);
  const view = new BigUint64Array(read.getMappedRange().slice(0)); read.destroy();
  const by = {};
  for (let i = 0; i < n; i++) {
    const a = view[i * 32], b = view[i * 32 + 1], ms = b > a ? Number(b - a) / 1e6 : 0, p = P.passes[i], key = p.ctx + ' | ' + p.label;
    const s = by[key] ??= {n: 0, ms: 0}; s.n++; s.ms += ms;
  }
  return by;
};
const qp = GPUQueue.prototype, sub = qp.submit, done = qp.onSubmittedWorkDone;
qp.submit = function (list) { ev('submit', {ctx: P.ctx}); return sub.call(this, list); };
qp.onSubmittedWorkDone = function () {
  const t = now(), ctx = P.ctx;
  return done.call(this).then(v => { const ms = now() - t; P.waits.push({t, ms, ctx}); add('queue wait | ' + ctx, ms); return v; });
};
}
// ---- display canvas paints: ImageBitmap draws are chunks, other draws are the overview
const di = CanvasRenderingContext2D.prototype.drawImage;
CanvasRenderingContext2D.prototype.drawImage = function (src, ...rest) {
  const result = di.call(this, src, ...rest);
  if (this.canvas?.id === 'terrain' || this.canvas?.id === 'map' || this.canvas?.dataset?.map !== undefined || this.canvas?.parentElement?.id === 'stage') {
    const info = bitmapInfo.get(src);
    P.draws.push({t: now(), chunk: src instanceof ImageBitmap || (P.worker && src instanceof HTMLCanvasElement), x: rest[0] ?? null});
    // A bitmap is tagged at the exact renderChunk result used to create it.
    // Cached paints keep their old source revision; they cannot impersonate a fresh bake.
    if (!P.worker && info && rest.length >= 4 && !presentedBitmaps.has(src)) { presentedBitmaps.add(src); P.present({...info, screenX:rest[0],screenY:rest[1],screenWidth:rest[2],screenHeight:rest[3]}); }
  }
  return result;
};
const cib = window.createImageBitmap;
window.createImageBitmap = function (...a) { const t = now(), info = canvasInfo.get(a[0]); return cib.apply(window, a).then(v => { if(info) bitmapInfo.set(v, info); add('bitmap copy', now() - t); return v; }); };
// ---- main-thread long tasks (over 50 ms): what blocks the page while a queue wait looks like GPU time
P.long = []; P.callers = {};
try { new PerformanceObserver(list => { for (const e of list.getEntries()) P.long.push({t: e.startTime, ms: e.duration}); }).observe({type: 'longtask', buffered: true}); } catch (e) {}
// ---- the weather state text
new MutationObserver(() => { const el = document.getElementById('weather-state'); if (el) ev('weather-state', {text: el.textContent}); }).observe(document, {subtree: true, childList: true, characterData: true});
// ---- JS stages of the map canvas, once it exists
let canvasValue;
const wrap = (obj, name, stage, tag) => {
  const f = obj[name]; if (typeof f !== 'function' || f.__wrapped) return;
  const g = function (...a) {
    const t = now(), prev = P.ctx; if (tag) P.ctx = tag;
    const finish = r => { P.ctx = prev; add(stage, now() - t); return r; };
    let r; try { r = f.apply(this, a); } catch (e) { P.ctx = prev; throw e; }
    return r && typeof r.then === 'function' ? r.then(finish, e => { P.ctx = prev; throw e; }) : finish(r);
  };
  g.__wrapped = true; obj[name] = g;
};
function patch(c) {
 if(!c?.renderer){P.worker=true;return;}
  const r = c.renderer, Base = Object.getPrototypeOf(Object.getPrototypeOf(r));
  if (verifyPicked && window.sculptRegion?.previewStroke) {
    const original = window.sculptRegion.previewStroke;
    window.sculptRegion.previewStroke = function(points, ...args) { const tip = points?.at(-1); if (tip) P.strokeTip = {x:tip.x,y:tip.y}; return original.call(this,points,...args); };
  }
  if (diagnosticGPU) r.timer = () => null; // pass hooks provide the diagnostic timings
  const rc = r.renderChunk.bind(r);
  r.renderChunk = async (request, options) => {
    const t = now(); ev('bake-start', {x: request.x, y: request.y, w: request.width, h: request.height, level: options?.scale ?? 1}); const prev = P.ctx; P.ctx = 'chunk';
    try { const result = await rc(request, options); const rev = options?.feed?.revision ?? request?.revision ?? null; if(result?.canvas) canvasInfo.set(result.canvas, {x:request.x,y:request.y,width:request.width,height:request.height,scale:options?.scale??1,revision:rev}); return result; } finally { P.ctx = prev; ev('bake-end', {x: request.x, y: request.y, ms: now() - t, rev: options?.feed?.revision ?? request?.revision ?? null, level: options?.scale ?? 1}); add('chunk bake (wall)', now() - t); }
  };
  if (diagnosticGPU) {
  wrap(r, 'upload', 'field upload (CPU pack + write)');
  wrap(Base, 'draw', 'draw + bake encode (CPU)');
  const region = window.sculptRegion;
  if (region) {
    let depth = 0;
    for (const name of ['readAsync', 'read']) {
      const f = region[name]; if (typeof f !== 'function') continue;
      region[name] = function (...a) {
        const t = now(), top = depth++ === 0;
        const fin = v => { depth--; if (top) { add('region read (shape replay + crop)', now() - t); ev('read', {ms: now() - t, rev: v?.revision}); } return v; };
        try { const v = f.apply(this, a); return v && v.then ? v.then(fin, e => { depth--; throw e; }) : fin(v); } catch (e) { depth--; throw e; }
      };
    }
  }
  if (region) for (const name of ['sampleAuthored', 'sample']) {   // the 128 x 128 overview samples the authored field point by point
    const f = region[name]; if (typeof f !== 'function') continue;
    region[name] = function (...a) {
      const t = now(); const v = f.apply(this, a), d = now() - t; add('field sample (' + name + ')', d);
      // every 97th call: who asked (the innermost page functions above the wrapper), with the time this call took
      if ((P.sampleCalls = (P.sampleCalls || 0) + 1) % 97 === 0) {
        const names = (new Error().stack.split('\\n').slice(2, 12).map(l => /at (?:async )?([\\w$.]+)/.exec(l)?.[1]).filter(n => n && !/^(Object\\.|Array\\.|new )?(sample|sampleAuthored|<anonymous>)$/.test(n))).slice(0, 3).join(' < ');
        const c = P.callers[names] ??= {n: 0, ms: 0}; c.n++; c.ms += d;
      }
      return v;
    };
  }
  // Original-build instrumentation only: worker builds returned above and never
  // request a removed application JavaScript module. This remains for alternating
  // measurements against the original baseline server.
  // The Time pass: every run of the erosion class, whether the fields feed it whole or a page asks for its window.
  import('/sculpt-erosion.js').then(m => {
    const proto = m.GpuErosion.prototype, run = proto.runGpu;
    proto.runGpu = async function (request) {
      const t = now(); ev('erode-start', {}); const prev = P.ctx; P.ctx = 'erode';
      try { const v = await run.call(this, request); P.erodeParts = v.parts; return v; } finally { P.ctx = prev; ev('erode-end', {ms: now() - t}); add('time pass (wall)', now() - t); }
    };
  }).catch(e => { P.patchError = String(e); });
  }
}
Object.defineProperty(window, 'sculptCanvas', {configurable: true, get: () => canvasValue, set: v => { canvasValue = v; try { patch(v); } catch (e) { P.patchError = String(e); } }});
// ---- rAF intervals, recorded on demand
P.frameStart = () => { P.frames = []; P.last = 0; const loop = t => { if (P.last) P.frames.push(t - P.last); P.last = t; if (P.frameOn) requestAnimationFrame(loop); }; P.frameOn = true; requestAnimationFrame(loop); };
P.frameStop = () => { P.frameOn = false; return P.frames.slice(); };
})()`;

// ---------------------------------------------------------------- Chrome and CDP
await cdpPortFree(port);
const chrome = spawn('/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', ['--headless=new', '--enable-gpu', '--use-angle=metal', '--enable-precise-memory-info',
  `--remote-debugging-port=${port}`, `--user-data-dir=${out}/profile-${mode}`, '--window-size=1600,1200', '--no-first-run', 'about:blank'], {stdio: 'ignore'});
let ws, id = 0; const wait = new Map(), logs = [];
for (let i = 0; i < 100 && !ws; i++) { try { const p = (await (await fetch(`http://127.0.0.1:${port}/json/list`)).json()).find(p => p.type === 'page'); if (p) ws = new WebSocket(p.webSocketDebuggerUrl); } catch {} if (!ws) await sleep(200); }
if (!ws) throw new Error('CDP unavailable');
await new Promise(r => ws.onopen = r);
ws.onmessage = e => {
  const m = JSON.parse(e.data);
  if (m.id) { wait.get(m.id)?.(m); wait.delete(m.id); }
  if (m.method === 'Inspector.targetCrashed') logs.push('TARGET CRASHED');
  if (m.method === 'Runtime.exceptionThrown') logs.push(m.params.exceptionDetails.exception?.description || m.params.exceptionDetails.text);
  if (m.method === 'Runtime.consoleAPICalled' && m.params.type === 'error') logs.push(m.params.args.map(a => a.value ?? a.description).join(' '));
};
const send = (method, params = {}) => new Promise(r => { const k = ++id; wait.set(k, r); ws.send(JSON.stringify({id: k, method, params})); });
let longWait = false;
const ev = async expression => { const r = await Promise.race([send('Runtime.evaluate', {expression, awaitPromise: true, returnByValue: true}), sleep(longWait ? 900000 : 240000).then(() => { throw new Error('evaluate timed out: ' + expression.slice(0, 80)); })]); if (r.result?.exceptionDetails) throw new Error(r.result.exceptionDetails.exception?.description || r.result.exceptionDetails.text); return r.result?.result?.value; };
const mouse = (type, x, y) => send('Input.dispatchMouseEvent', {type, x, y, button: 'left', buttons: type === 'mouseReleased' ? 0 : 1, clickCount: 1});

const url = `${server}/sculpt?biome=${scene.biome || 'green'}&mapX=${mode.slice(3)}&mapY=${mode.slice(3)}&scratch=perf-${mode}-${port}&gpuMB=512&heapMB=1536${scene.query ? '&' + scene.query : ''}${extraQuery ? '&' + extraQuery : ''}`;
const result = {mode, label, query: extraQuery, scene: sceneFile, diagnosticGPU, verifyPixels, verifyPicked, startedAt: new Date().toISOString(), loadAverageAtStart: loadavg()};
const stable = async (quietMs = 1500, limitMs = 120000) => {
  if(await ev('Boolean(window.sculptCanvas?.stats?.().worker)')){await ev('sculptCanvas.idle()');return true;}   // wait for no bake/erode/read event for quietMs
  const t0 = Date.now();
  while (Date.now() - t0 < limitMs) {
    const last = await ev(`(() => { const e = __perf.ev.filter(x => x.type !== 'weather-state' || true); return performance.now() - (e.length ? e[e.length - 1].t : 0); })()`);
    if (last > quietMs) return true;
    await sleep(200);
  }
  return false;
};
// Final-in-view analysis from the event log between t0 and the end.
function analyse(events, visible, t0) {
  const bakes = new Map();   // chunk key -> list of {start, end}
  const open = new Map();
  for (const e of events) {
    if (e.type === 'bake-start') open.set(e.x + ',' + e.y, e.t);
    if (e.type === 'bake-end') { const k = e.x + ',' + e.y; (bakes.get(k) ?? bakes.set(k, []).get(k)).push({start: open.get(k), end: e.t, level: e.level ?? 1}); }
  }
  const ready = events.filter(e => e.type === 'weather-state' && /Weathered edges|ready on demand/.test(e.text) && e.t >= t0).map(e => e.t);
  const weatherReady = ready.length ? ready[0] - t0 : null;   // the first 'Weathered edges' text after t0
  const perChunk = {};
  // H7b: a bake at level 2 is a quarter image. 'final' is the last final-level bake; 'shown' is the first bake of any level (the chunk is on screen at least at quarter).
  let finalAll = 0, staleFinal = 0, shownAll = 0, missing = 0;
  for (const k of visible) {
    const list = bakes.get(k) ?? [], finals = list.filter(b => b.level === 1), last = finals.at(-1), first = list[0];
    perChunk[k] = last ? {final: last.end - t0, shown: first.end - t0, bakes: list.length, quarterBakes: list.length - finals.length, startedAfterWeather: weatherReady === null || last.start - t0 >= weatherReady - 1} : (first ? {final: null, shown: first.end - t0, bakes: list.length} : null);
    if (first) shownAll = Math.max(shownAll, first.end - t0);
    if (last) { finalAll = Math.max(finalAll, last.end - t0); if (weatherReady !== null && last.start - t0 < weatherReady - 1) staleFinal++; } else missing++;
  }
  const erode = events.filter(e => e.type === 'erode-end').map(e => e.t - t0);
  return {weatherReady, finalInView: missing ? null : finalAll, completionNote: 'Fresh bakes observed; missing tiles may be retained and cannot be certified by this event log.', shownInView: shownAll, visibleWithoutFinal: missing, quarterBakes: [...bakes.values()].reduce((n, l) => n + l.filter(b => b.level > 1).length, 0), chunksNotFinalAfterWeather: staleFinal, bakeCount: [...bakes.values()].reduce((n, l) => n + l.length, 0), erodeEnds: erode, visible: perChunk};
}
const splitStages = async () => {
  const workerProfiles=await ev('__perf.workerProfiles'),stage = await ev('__perf.stage'), passes = await ev('__perf.readPasses()'), waits = await ev('__perf.waits.map(w=>w.ms)');
  return {stage, workerProfiles, sampleCallers: await ev('Object.entries(__perf.callers).sort((a, b) => b[1].n - a[1].n).slice(0, 6).map(([k, v]) => [k, v.n * 97])'), longTasks: await ev('(() => { const l = __perf.long, sum = l.reduce((n, x) => n + x.ms, 0); return {n: l.length, totalMs: sum, top: l.slice().sort((a, b) => b.ms - a.ms).slice(0, 8).map(x => [Math.round(x.t), Math.round(x.ms)])}; })()'), gpuPassesMs: passes, erodeParts: await ev('__perf.erodeParts||null'), lastErosionParts: await ev('window.lastErosionParts||null')};
};
const flush = () => writeFileSync(`${out}/${mode}${label ? '-' + label : ''}-perf.json`, JSON.stringify({...result, console: logs.slice(0, 10)}, null, 1));
const reset = async () => ev('(() => { const P = __perf; P.ev.length = 0; P.draws.length = 0; P.waits.length = 0; P.stage = {}; P.passes.length = 0; P.long.length = 0; P.callers = {}; if (P.ring) P.ring.next = 0; P.erodeParts = null; P.workerProfiles=[]; return true; })()');

try {
  await send('Runtime.enable'); await send('Page.enable'); await send('Inspector.enable');
  await send('Page.addScriptToEvaluateOnNewDocument', {source: HOOKS});
  await send('Page.navigate', {url});
  const bootStart = Date.now();
  for (let i = 0; i < 1200; i++) {
    if (await ev(`!!window.sculptCanvas&&${scene.biome === 'zhon' ? 'true' : '!document.getElementById("map-export").disabled'}`)) break;   // Zhon cannot export, by design
    const e = await ev('document.getElementById("error")?.textContent'); if (e) throw new Error(e);
    await sleep(200);
  }
  result.bootReadyMs = Date.now() - bootStart;
  await ev('sculptCanvas.idle()');
  result.bootMs = Date.now() - bootStart; console.error('booted', result.bootMs);
  result.patchError = await ev('__perf.patchError||null');
  await reset();

  console.error('phase load'); flush();
  // ------------------------------------------------------------ load: the scene applied, then zoomed to 1x at the top-left
  const strokes = JSON.stringify(scene.strokes), ground = scene.ground !== false;
  const visibleOf = async () => ev(`(() => { const v = sculptCanvas.view(), stats = sculptCanvas.stats(), s = stats.displayChunkSize ?? stats.canonicalChunkSize, keys = [];
    for (let y = Math.floor(v.y / s) * s; y < v.y + v.height; y += s) for (let x = Math.floor(v.x / s) * s; x < v.x + v.width; x += s) keys.push(x + ',' + y); return {keys, chunk: s, view: v}; })()`);
  {
    const t0 = await ev(`(() => { const t = performance.now(); __perf.mark('load-start', {}); sculptDebug.scene(${strokes}, {ground: ${ground}}); sculptCanvas.zoom(1);
      const v = document.getElementById('viewport'); v.scrollLeft = 0; v.scrollTop = 300; return t; })()`);
    await sleep(500);
    await stable(2500);
    const events = await ev('__perf.ev'), draws = await ev('__perf.draws'), vis = await visibleOf();
    const a = analyse(events, vis.keys, t0), firstChunk = draws.find(d => d.chunk && d.t >= t0), firstAny = draws.find(d => d.t >= t0);
    result.load = {chunkSize: vis.chunk, view: vis.view, firstPictureAny: firstAny ? firstAny.t - t0 : null, firstChunkPicture: firstChunk ? firstChunk.t - t0 : null, ...a, split: await splitStages()};
    writeFileSync(`${out}/${mode}-events-load.json`, JSON.stringify({t0, events, draws: draws.length}));
  }

  if (only === 'load') throw new Error('stopped after load (--only)');
  console.error('phase drag'); flush();
  // ------------------------------------------------------------ drag: a stroke with real mouse events
  const box = await ev(`(() => { const r = document.getElementById('overlay')?.getBoundingClientRect() ?? document.querySelector('canvas').getBoundingClientRect(); return {x: r.x, y: r.y, w: r.width, h: r.height}; })()`);
  await ev(`document.querySelector('[data-tool="${dragTool}"]').click(); true`);
  await reset();
  const cx = box.x + box.w * .35, cy = box.y + box.h * .5;
  const drawSize = Number(opt2('--diameter', 0)); if (drawSize) await ev(`(() => { const d = document.getElementById('diameter'); d.value = ${drawSize}; d.dispatchEvent(new Event('input')); d.dispatchEvent(new Event('change')); })(); true`);
  const brushDiameter = await ev(`Number(document.getElementById('diameter')?.value || 0)`);
  if (!(brushDiameter > 0)) throw new Error('Cannot establish brush footprint');
  const dragView = await ev('sculptCanvas.view()');
  const viewportPixels = await ev(`(() => { const c = document.getElementById('terrain') || document.getElementById('map'); return {width:c.width,height:c.height}; })()`);
  await ev('__perf.frameStart(); true');
  const dragT0 = await ev('performance.now()'), dragWall = Date.now();
  await mouse('mousePressed', cx, cy);
  // H6b: move-to-picture latency. Each move is marked before it is sent and with the fields' revision after it was handled; a bake carries the
  // revision of the fields it read (a fed bake: the revision submitted when it took the buffers; a CPU bake: the last region read before it); the
  // picture is the first chunk paint after that bake ends.
  let moves = 0; for (let i = 1; i <= 70 && Date.now() - dragWall < 60000; i++) { moves++; await ev(`__perf.mark('move', {k: ${i}, worldX: ${dragView.x + (cx + i * 9 - box.x) / dragView.scale}, worldY: ${dragView.y + (cy + Math.sin(i / 6) * 60 - box.y) / dragView.scale}, radius: ${brushDiameter / 2}, screenX: ${cx + i * 9 - box.x}, screenY: ${cy + Math.sin(i / 6) * 60 - box.y}})`); await mouse('mouseMoved', cx + i * 9, cy + Math.sin(i / 6) * 60); await ev(`__perf.mark('rev', {k: ${i}, rev: window.sculptRegion?.stats?.()?.revision ?? window.sculptCanvas?.stats().revision ?? null, picked: ${verifyPicked} ? (window.sculptDebug?.strokeTip?.() ?? __perf.strokeTip ?? null) : null})`); await sleep(30); }
  // Keep the pointer held while the final move has an opportunity to present.
  await sleep(500);
  const frames = await ev('__perf.frameStop()');
  const dragEnd = await ev('performance.now()');
  const dragDraws = (await ev('__perf.draws')).filter(d => d.t >= dragT0 && d.t <= dragEnd);
  result.drag = {durationMs: dragEnd - dragT0, movesDelivered: moves, rafMs: {n: frames.length, p50: q(frames, .5), p95: q(frames, .95), max: Math.max(...frames, 0)}, chunkPaintsPerSecond: dragDraws.filter(d => d.chunk).length / ((dragEnd - dragT0) / 1000),
    erodeDuringDrag: (await ev('__perf.ev')).filter(e => e.type === 'erode-start').length, split: await splitStages()};
  {
    const events = await ev('__perf.ev'), draws = (await ev('__perf.draws')).filter(d => d.chunk), runs = (await ev('window.sculptRegion?.stats?.()?.gpuShape?.runLog || []')) || [];
    const marks = new Map(); for (const e of events) { if (e.type === 'move') (marks.get(e.k) ?? marks.set(e.k, {}).get(e.k)).t = e.t; if (e.type === 'rev') (marks.get(e.k) ?? marks.set(e.k, {}).get(e.k)).rev = e.rev; }
    const bakes = []; let lastRead = null;
    for (const e of events) { if (e.type === 'read') lastRead = e; if (e.type === 'bake-end') { const start = e.t - e.ms, read = events.filter(r => r.type === 'read' && r.t <= start).at(-1); bakes.push({end: e.t, rev: e.rev ?? read?.rev ?? null, key: e.x + ',' + e.y, level: e.level ?? 1}); } }
    const presented = events.filter(e => e.type === 'presented');
    const moveEvents = new Map(events.filter(e => e.type === 'move').map(e => [e.k, e]));
    const lat = [], latAny = []; let censored = 0, censoredAny = 0;
    for (const [k, m] of marks) {
      const move = moveEvents.get(k);
      if (m.t === undefined || m.rev == null || !move) { censored++; censoredAny++; continue; }
      const any = presented.find(p => matchesPresentation(p, move, m.rev, viewportPixels, false));
      if (any) latAny.push(any.t - m.t); else censoredAny++;
      const p = presented.find(p => matchesPresentation(p, move, m.rev, viewportPixels));
      if (!p) { censored++; continue; }
      lat.push(p.t - m.t);
    }
    writeFileSync(`${out}/${mode}-events-drag.json`, JSON.stringify({t0: dragT0, events, draws}));
    if (verifyPicked) { const picked = events.filter(e => e.type === 'rev').map(e => ({k:e.k, ...e.picked})); result.drag.pickedPath = picked; result.drag.pickedMissing = picked.filter(p => !Number.isFinite(p.x) || !Number.isFinite(p.y)).length; }
    result.drag.latencyAll = {available: false, reason: 'Whole-dirty-region presentation is not certified by tile counts; unchanged cached tiles may remain valid.'};
    if (verifyPixels) { const changed = new Set(events.filter(e => e.type === 'pixel-change').map(e => e.k)); result.drag.pixelProbe = {size: '16x16 at pointer', verified: changed.size, unverified: moves - changed.size, errors: events.filter(e => e.type === 'pixel-probe-error').length, note: 'Diagnostic only: canvas readback can perturb performance.'}; }
    result.drag.quarterBakes = bakes.filter(b => b.level > 1).length; result.drag.bakes = bakes.length;
    result.drag.latencyAny = {moves: marks.size, measured: latAny.length, censored: censoredAny, p50: q(latAny, .5), p95: q(latAny, .95), max: Math.max(...latAny, 0), basis: 'matching source revision, first actual new bitmap drawn anywhere visible'};
    result.drag.latency = {moves: marks.size, measured: lat.length, censored, p50: q(lat, .5), p95: q(lat, .95), max: Math.max(...lat, 0), basis: 'matching source revision, visible tile overlaps projected pointer-radius square (approximate brush feedback)'};
  }

  if (only === 'drag') throw new Error('stopped after drag (--only)');
  console.error('phase release'); flush();
  // ------------------------------------------------------------ release
  await reset();
  const relT0 = await ev('performance.now()');
  await mouse('mouseReleased', cx + 70 * 9, cy + Math.sin(70 / 6) * 60);
  {
    await sleep(500); await stable(2500);
    const events = await ev('__perf.ev'), vis = await visibleOf(), a = analyse(events, vis.keys, relT0);
    result.release = {...a, split: await splitStages()};
    writeFileSync(`${out}/${mode}-events-release.json`, JSON.stringify({t0: relT0, events}));
  }

  if (only === 'release') throw new Error('stopped after release (--only)');
  console.error('phase scroll'); flush();
  // ------------------------------------------------------------ scroll
  {
    await reset();
    longWait = true;
    const sc = await ev(`(() => { const v = document.getElementById('viewport'); return {w: v.scrollWidth, h: v.scrollHeight, cw: v.clientWidth, ch: v.clientHeight, left: v.scrollLeft, top: v.scrollTop}; })()`);
    const target = Math.min(sc.w - sc.cw, sc.left + 2400);
    const t0 = await ev(`new Promise(resolve => { const v = document.getElementById('viewport'), t0 = performance.now(), from = v.scrollLeft, to = ${target}, frames = 60; let k = 0; __perf.frameStart();
      const step = () => { k++; v.scrollLeft = from + (to - from) * k / frames; if (k < frames) requestAnimationFrame(step); else resolve(performance.now()); }; requestAnimationFrame(step); })`);
    const rafs = await ev('__perf.frameStop()'), stats = await ev('sculptCanvas.stats().frameMilliseconds || []');
    const stopT = t0;
    await sleep(300); await stable(2500);
    const events = await ev('__perf.ev'), vis = await visibleOf(), a = analyse(events, vis.keys, stopT), draws = await ev('__perf.draws');
    result.scroll = {distancePx: target - sc.left, rafMs: {n: rafs.length, p50: q(rafs, .5), p95: q(rafs, .95), max: Math.max(...rafs, 0)}, presentedMs: {n: stats.length, p50: q(stats, .5), p95: q(stats, .95), max: Math.max(...stats, 0)},
      timeToFinalAfterStop: a.finalInView, bakes: a.bakeCount, chunkPaints: draws.filter(d => d.chunk).length, split: await splitStages()};
  }

  if (only === 'scroll') throw new Error('stopped after scroll (--only)');
  console.error('phase export'); flush();
  longWait = false;
  // ------------------------------------------------------------ export
  if (!noExport) {
    await reset();
    const name = `Perf${mode}${port}x${Date.now() % 100000}`;
    await ev(`window.gateExport = {done: false}; const t = performance.now(); sculptMap.export(${JSON.stringify(name)}).then(r => window.gateExport = {done: true, ms: performance.now() - t, result: r}, e => window.gateExport = {done: true, error: e.message, ms: performance.now() - t}); true`);
    let g = null; for (let i = 0; i < 2400 && !g?.done; i++) { g = await ev('window.gateExport'); if (!g?.done) await sleep(500); }
    result.export = {name, ms: g?.ms ?? null, error: g?.error ?? null, split: await splitStages()};
  }
  result.memory = await ev('(() => { const m = sculptCanvas.stats(); return {gpuBytes: m.gpuBytes, peakGPUBytes: m.peakGPUBytes, heapBytes: m.heapBytes, peakHeapBytes: m.peakHeapBytes, cachedChunks: m.cachedChunks, bakes: m.bakes, worker:m.worker, pending:m.pending, rebakes: m.rebakes, cacheBytes: m.cacheBytes, levels: m.levels}; })()');
} catch (e) {
  result.error = String(e.stack || e);
} finally {
  result.console = logs.slice(0, 10); result.loadAverageAtEnd = loadavg();
  writeFileSync(`${out}/${mode}${label ? '-' + label : ''}-perf.json`, JSON.stringify(result, null, 1));
  console.log(JSON.stringify(result, (k, v) => k === 'visible' || k === 'events' ? undefined : v).slice(0, 4000));
  ws.close(); chrome.kill(); await sleep(500);
}
// A timer or the socket can keep node alive after the JSON is written; --only stops are not failures.
process.exit((result.error && !result.error.includes('(--only)')) || (result.drag?.latency?.censored > 0) || (result.drag?.latencyAny?.censored > 0) || (result.drag?.pixelProbe?.unverified > 0) || (result.drag?.pixelProbe?.errors > 0) || (result.drag?.pickedMissing > 0) ? 1 : 0);
