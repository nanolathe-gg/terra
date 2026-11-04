// The drainage plane against a CPU reference, and its determinism, in an owned browser.
//   node repro/drainage.mjs [scene.json] [--map 4] [--paged] [--server http://127.0.0.1:8801] [--port 9450]
import {cdpPortFree} from './cdp-port.mjs';
import {spawn} from 'node:child_process';
import {mkdtempSync, readFileSync, rmSync} from 'node:fs';
import {createServer} from 'node:net';
import {drainageReference, NONE} from './drainage-reference.mjs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
async function freePort(port) {
  for (const host of ['127.0.0.1', '::1']) await new Promise((resolve, reject) => {
    const probe = createServer();
    probe.once('error', error => {
      if (host === '::1' && ['EAFNOSUPPORT', 'EADDRNOTAVAIL'].includes(error.code)) { resolve(); return; }
      reject(new Error(error.code === 'EADDRINUSE' ? `CDP port ${port} is already in use; choose another --port.` : `Cannot reserve CDP port ${port}: ${error.message}`));
    });
    probe.listen({port, host, exclusive: true}, () => probe.close(error => error ? reject(error) : resolve()));
  });
}
function openSocket(url) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(url), timer = setTimeout(() => { ws.close(); reject(new Error('Chrome WebSocket did not open.')); }, 15000);
    ws.addEventListener('open', () => { clearTimeout(timer); resolve(ws); }, {once: true});
    ws.addEventListener('error', () => { clearTimeout(timer); reject(new Error('Chrome WebSocket failed.')); }, {once: true});
    ws.addEventListener('close', () => { clearTimeout(timer); reject(new Error('Chrome WebSocket closed before opening.')); }, {once: true});
  });
}
function protocol(ws, errors) {
  let next = 0;
  const pending = new Map();
  const fail = message => { for (const q of pending.values()) { clearTimeout(q.timer); q.reject(new Error(message)); } pending.clear(); };
  ws.addEventListener('close', () => fail('Chrome WebSocket closed.'));
  ws.addEventListener('error', () => fail('Chrome WebSocket failed.'));
  ws.addEventListener('message', event => {
    let message;
    try { message = JSON.parse(event.data); } catch { fail('Chrome sent invalid protocol JSON.'); return; }
    if (message.id && pending.has(message.id)) {
      const q = pending.get(message.id); pending.delete(message.id); clearTimeout(q.timer);
      if (message.error) q.reject(new Error(`${q.method}: ${message.error.message}`)); else q.resolve(message.result);
    }
    if (errors.length < 20 && message.method === 'Runtime.consoleAPICalled' && message.params.type === 'error') errors.push('console: ' + message.params.args.map(a => a.value ?? a.description ?? a.type).join(' '));
    if (errors.length < 20 && message.method === 'Runtime.exceptionThrown') errors.push('exception: ' + (message.params.exceptionDetails.exception?.description || message.params.exceptionDetails.text));
  });
  return (method, params = {}, sessionId) => new Promise((resolve, reject) => {
    const id = ++next, timer = setTimeout(() => { pending.delete(id); reject(new Error(`Chrome command timed out: ${method}`)); }, 120000);
    pending.set(id, {method, resolve, reject, timer});
    try { ws.send(JSON.stringify({id, method, params, ...(sessionId ? {sessionId} : {})})); }
    catch (error) { clearTimeout(timer); pending.delete(id); reject(error); }
  });
}

const usage = 'Usage: node repro/drainage.mjs [scene.json] [--map 4] [--paged] [--server http://127.0.0.1:8801] [--port 9450]';
function parse(args) {
  const o = {server: 'http://127.0.0.1:8801', port: 9450, map: 4, paged: false, scene: null};
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === '--paged') o.paged = true;
    else if (a === '--server' || a === '--port' || a === '--map') { if (!args[i + 1]) throw new Error(usage); o[a.slice(2)] = args[++i]; }
    else if (a.startsWith('-') || o.scene) throw new Error(usage);
    else o.scene = a;
  }
  o.port = Number(o.port); o.map = Number(o.map); o.server = new URL(o.server).href.replace(/\/$/, '') + '/';
  return o;
}
const b64 = text => { const b = Buffer.from(text, 'base64'); return new Uint32Array(b.buffer, b.byteOffset, b.length / 4); };
const f32 = text => { const b = Buffer.from(text, 'base64'); return new Float32Array(b.buffer.slice(b.byteOffset, b.byteOffset + b.length)); };
function compare(label, heights, width, sea, area, recv, ms, passes) {
  const ref = drainageReference(heights, width, sea);
  let bad = 0, first = null;
  for (let i = 0; i < width * width; i++) if (area[i] !== ref.area[i] || recv[i] !== ref.recv[i]) { bad++; first ??= {cell: i, gpu: [area[i], recv[i]], cpu: [ref.area[i], ref.recv[i]]}; }
  let roots = 0, top = 0; for (let i = 0; i < ref.recv.length; i++) { if (ref.recv[i] === NONE) roots++; top = Math.max(top, ref.area[i]); }
  const line = {check: label, cells: width * width, mismatches: bad, roots, largestArea: top, passes, ms: Math.round(ms * 10) / 10};
  if (first) line.first = first;
  console.log(JSON.stringify(line));
  return bad;
}
async function main() {
  const options = parse(process.argv.slice(2));
  const {server, port, scene: sceneFile} = options;
  const scene = sceneFile ? JSON.parse(readFileSync(sceneFile, 'utf8')) : {biome: 'green', strokes: [], ground: true};
  await freePort(port);
  const url = new URL('sculpt', server); url.searchParams.set('biome', scene.biome); url.searchParams.set('scratch', '1');
  for (const [key, value] of [['mapX', String(options.map)], ['mapY', String(options.map)], ['gpuMB', '512'], ['heapMB', '1536']]) url.searchParams.set(key, value);
  if (options.paged) url.searchParams.set('gpuPages', 'force');
  for (const [key, value] of new URLSearchParams(scene.query || '')) url.searchParams.append(key, value);
  let profile, chrome, ws, closed = false, chromeError, endpoint, stderr = '', cleanupPromise, exited, failures = 0;
  const cleanup = () => cleanupPromise ??= (async () => {
    ws?.close();
    const waitForExit = async ms => { let timer; try { await Promise.race([exited, new Promise(resolve => { timer = setTimeout(resolve, ms); })]); } finally { clearTimeout(timer); } };
    if (chrome?.pid && !closed) { chrome.kill('SIGTERM'); await waitForExit(3000); if (!closed) { chrome.kill('SIGKILL'); await waitForExit(3000); } }
    if (profile) rmSync(profile, {recursive: true, force: true, maxRetries: 3, retryDelay: 100});
  })();
  try {
    profile = mkdtempSync(join(tmpdir(), 'nanolathe-drainage-'));
    await cdpPortFree(port);
    chrome = spawn('/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', ['--headless=new', '--enable-gpu', '--use-angle=metal', '--remote-debugging-address=127.0.0.1',
      `--remote-debugging-port=${port}`, `--user-data-dir=${profile}`, '--window-size=1500,1200', '--no-first-run', 'about:blank'], {stdio: ['ignore', 'ignore', 'pipe']});
    exited = new Promise(resolve => chrome.once('close', () => { closed = true; resolve(); }));
    chrome.once('error', error => { chromeError = error; });
    chrome.stderr.on('data', data => { stderr = (stderr + data).slice(-8192); endpoint = stderr.match(/DevTools listening on (ws:\/\/\S+)/)?.[1] || endpoint; });
    for (let i = 0; i < 75 && !endpoint; i++) { if (chromeError) throw chromeError; await sleep(200); }
    if (!endpoint) throw new Error('Chrome did not open CDP.');
    ws = await openSocket(endpoint);
    const errors = [], send = protocol(ws, errors);
    const {targetId} = await send('Target.createTarget', {url: 'about:blank'});
    const {sessionId} = await send('Target.attachToTarget', {targetId, flatten: true});
    const page = (method, params) => send(method, params, sessionId);
    const evaluate = async expression => {
      const result = await page('Runtime.evaluate', {expression, returnByValue: true, awaitPromise: true});
      if (result.exceptionDetails) throw new Error(result.exceptionDetails.exception?.description || result.exceptionDetails.text);
      return result.result?.value;
    };
    const ready = async () => {
      for (let i = 0; i < 960; i++) {
        if (errors.length) throw new Error(errors.slice(0, 20).join('\n'));
        const state = await evaluate(`(() => { const button=document.getElementById('map-export'); return {ready:Boolean(window.sculptCanvas&&window.sculptDebug&&button&&!button.disabled),error:document.getElementById('error')?.textContent?.trim()||''}; })()`);
        if (state.error) throw new Error(`Editor error: ${state.error}`);
        if (state.ready) return;
        await sleep(250);
      }
      throw new Error('Editor did not become ready.');
    };
    await page('Runtime.enable'); await page('Page.enable'); await page('Page.navigate', {url: url.href});
    await ready();
    // 1. Synthetic lattices: the GPU passes against the reference, on shapes that stress what a tour must get right.
    const synth = [];
    let seed = 12345; const rnd = () => (seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0) / 4294967296;
    { const w = 257, h = new Float32Array(w * w).map(() => rnd() * 100); synth.push(['noise (many pits)', h, w, -1e30]); }
    { const w = 200, h = new Float32Array(w * w).map(() => Math.floor(rnd() * 6)); synth.push(['six levels (ties, plateaus)', h, w, -1e30]); }
    { const w = 301, h = new Float32Array(w * w).fill(5000); let k = 0; for (let y = 0; y < w; y += 2) { for (let i = 0; i < w; i++) { const x = (y / 2) % 2 ? w - 1 - i : i; h[y * w + x] = 4000 - k++; } if (y + 2 < w) h[(y + 1) * w + ((y / 2) % 2 ? 0 : w - 1)] = 4000 - k++; }
      synth.push(['serpentine (one chain of ' + k + ' cells)', h, w, -1e30]); }
    { const w = 400, h = new Float32Array(w * w); for (let y = 0; y < w; y++) for (let x = 0; x < w; x++) h[y * w + x] = 80 * Math.sin(x / 31) * Math.cos(y / 23) + 0.37 * x + 0.21 * y + rnd(); synth.push(['smooth hills, sea at 20', h, w, 20]); }
    { const w = 1; synth.push(['one cell', new Float32Array([3]), w, -1e30]); }
    { const w = 2, h = new Float32Array([4, 3, 2, 1]); synth.push(['two by two', h, w, -1e30]); }
    for (const [label, h, w, sea] of synth) {
      const out = await evaluate(`drainageRun({heights:${JSON.stringify([...h])},width:${w},sea:${sea}})`);
      failures += compare(label, h, w, sea, out.area, out.recv, out.milliseconds, out.passes);
    }
    // 2. The live map: its plane against the reference over the lattice it came from, and twice for determinism.
    await evaluate(`sculptDebug.scene(${JSON.stringify(scene.strokes)}, {ground:${scene.ground !== false}})`);
    await ready();
    const live = await evaluate('drainageLive()');
    if (live.error) throw new Error('drainageLive: ' + JSON.stringify(live));
    const raw = b64(live.plane), area = new Uint32Array(live.cells), recv = new Uint32Array(live.cells);
    for (let i = 0; i < live.cells; i++) { area[i] = raw[2 * i]; recv[i] = raw[2 * i + 1]; }
    failures += compare(`live ${options.map}x${options.map} map${live.paged ? ' (paged)' : ''}`, f32(live.heights), live.width, live.sea, area, recv, live.milliseconds, live.passes);
    const again = await evaluate(`drainageRun({heights:${JSON.stringify([...f32(live.heights)])},width:${live.width},sea:${live.sea}})`);
    const same = again.area.every((v, i) => v === area[i]) && again.recv.every((v, i) => v === recv[i]);
    console.log(JSON.stringify({check: 'second run is byte-identical', identical: same, bytes: live.bytes, transientBytes: live.transientBytes, width: live.width}));
    if (!same) failures++;
    // 3. An edit: the badge says the plane is out of date from the change until the plane for the new revision exists. Replace the scene with one stroke fewer
    //    and watch the panel's line; the time is from the edit to a current plane (the Time stage's own work runs alongside).
    const badge = `document.querySelector('[data-drainage]')?.textContent||''`;
    const before = await evaluate(badge);
    await evaluate(`(() => { window.__edit = performance.now(); sculptDebug.scene(${JSON.stringify(scene.strokes.slice(0, -1))}, {ground:${scene.ground !== false}}); return 0; })()`);
    const seen = [];
    for (let i = 0; i < 1500; i++) {
      const [text, at] = await evaluate(`[${badge}, Math.round(performance.now() - window.__edit)]`);
      if (!seen.length || seen[seen.length - 1][0] !== text) seen.push([text, at]);
      if (/^Drainage plane: \d+ ×/.test(text) && seen.some(([t]) => /out of date/.test(t))) break;
      await sleep(10);
    }
    console.log(JSON.stringify({check: 'edit and stale badge', before, seen, staleSeen: seen.some(([t]) => /out of date/.test(t)), currentAfterMs: seen[seen.length - 1][1]}));
    if (!seen.some(([t]) => /out of date/.test(t)) || !/^Drainage plane: \d+ ×/.test(seen[seen.length - 1][0])) failures++;
    // 4. A local stroke with real mouse events, as an artist edits: the badge turns stale on the first move, and the plane is current again some time after the release.
    {
      const mouse = (type, x, y) => send('Input.dispatchMouseEvent', {type, x, y, button: 'left', buttons: type === 'mouseReleased' ? 0 : 1, clickCount: 1}, sessionId);
      const box = await evaluate(`(() => { const r = document.getElementById('overlay').getBoundingClientRect(); return {x: r.x, y: r.y, w: r.width, h: r.height}; })()`);
      await evaluate(`document.querySelector('[data-tool="hill"]').click(); true`);
      await sleep(500);
      const cx = box.x + box.w * .5, cy = box.y + box.h * .5;
      const seenStroke = [], note = async label => { const text = await evaluate(badge); if (!seenStroke.length || seenStroke.at(-1)[1] !== text) seenStroke.push([label, text]); };
      await mouse('mousePressed', cx, cy);
      for (let i = 1; i <= 24; i++) { await mouse('mouseMoved', cx + i * 8, cy + Math.sin(i / 4) * 40); await sleep(30); await note('drag'); }
      await mouse('mouseReleased', cx + 200, cy);
      await evaluate('window.__release = performance.now(); true');
      for (let i = 0; i < 2500; i++) {
        const [text, at] = await evaluate(`[${badge}, Math.round(performance.now() - window.__release)]`);
        if (!seenStroke.length || seenStroke.at(-1)[1] !== text) seenStroke.push([`+${at} ms`, text]);
        if (/^Drainage plane: \d+ ×/.test(text) && seenStroke.some(([, t]) => /out of date/.test(t))) break;
        await sleep(10);
      }
      console.log(JSON.stringify({check: 'a stroke, drag and release', states: seenStroke}));
      if (!/^Drainage plane: \d+ ×/.test(seenStroke.at(-1)[1])) failures++;
    }
    if (errors.length) throw new Error(errors.slice(0, 20).join('\n'));
  } finally { await cleanup(); }
  if (failures) throw new Error(`${failures} drainage checks failed.`);
}
main().catch(error => { console.error(`drainage.mjs: ${error.message}`); process.exitCode ||= 1; });
