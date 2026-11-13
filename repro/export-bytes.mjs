// Same bytes: the page's export (export/ built for WebAssembly, in a worker) against the native command line, for the same chunks.
//   node repro/export-bytes.mjs [--maps green:4:landforms,lava:8:dense,red:16:dense] [--out dir] [--native path/to/map-export (default: built here from export/)]
//        [--configs DIR] [--chrome --server http://127.0.0.1:<yours> --port <cdp> [--features 6]]
// For each map (world:units:layout; the layouts are repro/layouts.mjs's scripted scenes: bare, landforms, dense) it opens a map of that size,
// plays the layout and exports it twice with the page's exporter, keeping every PNG chunk the exporter is sent and its start request. Those then go
// to the native exporter (`map-export --catalog-file --input --features-root`). It prints one JSON line per map: the SHA-256 of the .ufo and the
// indexed PNG from each of the page's exports (`wasm`) and from the native one, the export times and memory, and `same` (all three equal). Exit 1 if any differ.
// The export runs under Node on Dawn by default (repro/headless.mjs exportMap: the page's modules bake the art, the worker runs in a Node context,
// repro/export-node.mjs), from this checkout's files. --chrome exports in the page in headless Chrome instead; it needs --server, your own Go server
// server (there is no default). --features N places up to N of the map's generated features first (every kind the world has, deposits and vents
// first): the page paints them into the art with a 2D canvas, so they need --chrome.
// Output (chunks, manifests, the native files) goes to --out; nothing is written in the checkout.
import {cdpPortFree} from './cdp-port.mjs';
import {layoutStrokes} from './layouts.mjs';
import {spawn, execFileSync} from 'node:child_process';
import {mkdirSync, writeFileSync, readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {join, resolve} from 'node:path';

const args = process.argv.slice(2);
const opt = (name, fallback) => { const i = args.indexOf(name); return i >= 0 ? args.splice(i, 2)[1] : fallback; };
const chrome = args.includes('--chrome'), server = opt('--server', ''), port = Number(opt('--port', 9450)), out = resolve(opt('--out', 'export-bytes-out')), configs = opt('--configs', '');
const maps = opt('--maps', 'green:4:landforms,lava:8:dense,red:16:dense').split(',').map(m => { const [world, units, layout = 'landforms'] = m.split(':'); return {world, units: Number(units), layout}; });
const featureCount = Number(opt('--features', 0));
if (chrome && !server) { console.error('export-bytes.mjs: --chrome needs --server http://127.0.0.1:<port> of your own Go development server (there is no default server).'); process.exit(2); }
if (featureCount && !chrome) { console.error('export-bytes.mjs: --features needs --chrome: the page paints deposits and vents into the export art with a 2D canvas.'); process.exit(2); }
const root = new URL('..', import.meta.url).pathname;
mkdirSync(out, {recursive: true});
let native = opt('--native', '');
if (!native) { native = join(out, 'map-export'); execFileSync('go', ['build', '-trimpath', '-o', native, './export'], {cwd: root, stdio: 'inherit'}); }
const sleep = ms => new Promise(r => setTimeout(r, ms));
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const pageQuery = (world, units, label) => `biome=${world}&mapX=${units}&mapY=${units}&scratch=bytes-${label}-${Date.now()}&gpuMB=512&heapMB=1536`;

// One map: export it with the page's exporter (twice), keep the chunks and the start request, and return the two exports' digests.
const exportUnderNode = chrome ? null : await (async () => {
  const headless = await import('./headless.mjs'), {buildWasm} = await import('./export-node.mjs');
  await headless.openHost({configs});
  const wasm = readFileSync(buildWasm(join(out, 'map-export.wasm')));
  return async ({world, units, layout, label, dir, row}) => {
    const s = await headless.openScene({biome: world, strokes: layoutStrokes(layout, units)}, pageQuery(world, units, label));
    try {
      await headless.weather(s);
      row.features = 0; row.wasm = []; let kept = null;
      for (const pass of [0, 1]) {
        const t0 = performance.now(), x = await headless.exportMap(s, {name: 'Bytes ' + label, wasm});
        row.wasm.push({ufo: sha(x.archive), png: sha(x.indexed), seconds: +((performance.now() - t0) / 1000).toFixed(1), uniqueTiles: x.result.uniqueTiles, merged: x.result.merge?.mergedTiles ?? 0,
          featureCount: x.result.featureCount, metrics: x.result.metrics});
        kept ??= x;
      }
      const chunks = kept.chunks.map(c => { const path = join(dir, 'chunks', `c${c.y}_${c.x}.png`); writeFileSync(path, c.png); return {x: c.x, y: c.y, path}; });
      row.chunks = chunks.length; row.console = s.errors.slice(0, 5);
      return {start: kept.start, chunks};
    } finally { s.dispose(); }
  };
})();

async function exportInChrome({world, units, layout, label, dir, row}) {
  await cdpPortFree(port);
  const browser = spawn('/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', ['--headless=new', '--enable-gpu', '--use-angle=metal', `--remote-debugging-port=${port}`,
    `--user-data-dir=${out}/profile-${port}-${Date.now()}`, '--window-size=1700,1300', '--no-first-run', 'about:blank'], {stdio: 'ignore'});
  try {
    let ws;
    for (let i = 0; i < 100 && !ws; i++) { try { const p = (await (await fetch(`http://127.0.0.1:${port}/json/list`)).json()).find(x => x.type === 'page'); if (p) ws = new WebSocket(p.webSocketDebuggerUrl); } catch {} if (!ws) await sleep(200); }
    await new Promise(r => ws.onopen = r);
    let id = 0; const wait = new Map(), logs = [];
    ws.onmessage = e => {
      const m = JSON.parse(e.data);
      if (m.id) { wait.get(m.id)?.(m); wait.delete(m.id); }
      if (m.method === 'Runtime.exceptionThrown') logs.push(m.params.exceptionDetails.exception?.description || m.params.exceptionDetails.text);
      if (m.method === 'Runtime.consoleAPICalled' && m.params.type === 'error') logs.push(m.params.args.map(a => a.value ?? a.description).join(' ').slice(0, 300));
    };
    const send = (method, params = {}) => new Promise(r => { const k = ++id; wait.set(k, r); ws.send(JSON.stringify({id: k, method, params})); });
    const ev = async expression => { const r = await send('Runtime.evaluate', {expression, awaitPromise: true, returnByValue: true}); if (r.result?.exceptionDetails) throw new Error(r.result.exceptionDetails.exception?.description || r.result.exceptionDetails.text); return r.result?.result?.value; };
    await send('Runtime.enable'); await send('Page.enable');
    await send('Emulation.setDeviceMetricsOverride', {width: 1700, height: 1300, deviceScaleFactor: 1, mobile: false});
    await send('Page.navigate', {url: `${server}/sculpt.html?${pageQuery(world, units, label)}`});
    const ready = async () => {
      for (let i = 0; i < 1200; i++) {
        if (await ev(`!!window.sculptCanvas && !document.getElementById('editor').disabled && !document.getElementById('map-export').disabled`)) { await ev('sculptCanvas.idle()'); await sleep(1500); return; }
        const e = await ev(`document.getElementById('error')?.textContent`); if (e) throw new Error(e);
        await sleep(300);
      }
      throw new Error('the editor never became ready');
    };
    await ready(); await ev(`sculptCanvas.zoom('overview'); true`); await sleep(800);
    await ev(`sculptDebug.scene(${JSON.stringify(layoutStrokes(layout, units))}, {ground: true})`); await ready();
    // A few of the map's generated features on a diagonal of the play area, every kind the world has in turn (deposits and vents first).
    row.features = featureCount ? await ev(`(async () => { const kinds = Object.keys(sculptCanvas.features.serialize().featureSet); let placed = 0;
      for (let i = 0; i < ${featureCount}; i++) if (sculptCanvas.features.addFeature(kinds[i % kinds.length], 8 + i * Math.floor(${units} * 32 / ${featureCount + 1}), 8 + i * Math.floor(${units} * 32 / ${featureCount + 1}), {v: 0})) placed++;
      await sculptCanvas.features.settled(); return placed; })()`) : 0;
    await ev('sculptCanvas.idle()');
    for (let i = 0; i < 2400 && await ev(`document.getElementById('map-export').disabled`); i++) await sleep(250);
    // Keeps a copy of what the page sends its exporter (the start request and each chunk PNG) before the transfer empties it.
    await ev(`(() => { if (window.capture) return; window.capture = {start: null, chunks: []}; const post = Worker.prototype.postMessage;
      Worker.prototype.postMessage = function (message, transfer) { if (window.capture.on) { if (message?.op === 'start') window.capture.start = structuredClone(message);
        if (message?.op === 'chunk') window.capture.chunks.push({x: message.x, y: message.y, png: message.png.slice(0)}); } return post.call(this, message, transfer); }; })(); true`);
    const hash = key => `window.done.x.files.${key}.arrayBuffer().then(b => crypto.subtle.digest('SHA-256', b)).then(h => [...new Uint8Array(h)].map(v => v.toString(16).padStart(2, '0')).join(''))`;
    row.wasm = [];
    for (const pass of [0, 1]) {
      await ev(`window.capture.on = ${pass === 0}; window.done = null; window.t0 = performance.now(); sculptMap.export(${JSON.stringify('Bytes ' + label)}).then(x => window.done = {x, ms: performance.now() - t0}, e => window.done = {error: e.message}); true`);
      for (let i = 0; i < 4 * 3600 && !(await ev('!!window.done')); i++) await sleep(250);
      const d = await ev('window.done.error ? {error: window.done.error} : {ms: window.done.ms, result: {...window.done.x, files: undefined}}');
      if (d.error) throw new Error(d.error);
      row.wasm.push({ufo: await ev(hash('archive')), png: await ev(hash('indexed')), seconds: +(d.ms / 1000).toFixed(1), uniqueTiles: d.result.uniqueTiles, merged: d.result.merge?.mergedTiles ?? 0,
        featureCount: d.result.featureCount, metrics: d.result.metrics});
    }
    const start = await ev('window.capture.start'), count = await ev('window.capture.chunks.length'), chunks = [];
    for (let i = 0; i < count; i++) {
      const c = await ev(`(() => { const c = window.capture.chunks[${i}], b = new Uint8Array(c.png); let s = ''; for (let k = 0; k < b.length; k += 32768) s += String.fromCharCode(...b.subarray(k, k + 32768)); return {x: c.x, y: c.y, png: btoa(s)}; })()`);
      const path = join(dir, 'chunks', `c${c.y}_${c.x}.png`); writeFileSync(path, Buffer.from(c.png, 'base64')); chunks.push({x: c.x, y: c.y, path});
    }
    row.chunks = count; row.console = logs;
    return {start, chunks};
  } finally { browser.kill(); await sleep(600); }
}

let bad = 0;
for (const {world, units, layout} of maps) {
  const label = `${world}-${units}-${layout}`, dir = join(out, label), row = {map: label, host: chrome ? 'chrome' : 'node'};
  mkdirSync(join(dir, 'chunks'), {recursive: true});
  try {
    const {start, chunks} = await (chrome ? exportInChrome : exportUnderNode)({world, units, layout, label, dir, row});
    writeFileSync(join(dir, 'catalog.json'), JSON.stringify(start.catalog));
    writeFileSync(join(dir, 'manifest.json'), JSON.stringify({...start.metadata, chunks}));
    if (start.features) { mkdirSync(join(dir, 'features'), {recursive: true}); writeFileSync(join(dir, 'features', 'pack.json'), JSON.stringify(start.features)); }
    mkdirSync(join(dir, 'native'), {recursive: true});
    const name = 'Bytes ' + label, t0 = Date.now();
    const result = JSON.parse(execFileSync(native, ['--catalog-file', join(dir, 'catalog.json'), '--input', join(dir, 'manifest.json'), '--out', join(dir, 'native'), '--features-root', join(dir, 'features')], {encoding: 'utf8', maxBuffer: 1 << 26}));
    row.native = {ufo: sha(readFileSync(join(dir, 'native', `${name}.ufo`))), png: sha(readFileSync(join(dir, 'native', `${name}-indexed.png`))), seconds: +((Date.now() - t0) / 1000).toFixed(1),
      uniqueTiles: result.uniqueTiles, merged: result.merge?.mergedTiles ?? 0, featureCount: result.featureCount, metrics: result.metrics};
    row.same = row.wasm.every(b => b.ufo === row.native.ufo && b.png === row.native.png);
    if (!row.same || row.console.length) bad++;
  } catch (err) { row.error = err.message; bad++; }
  console.log(JSON.stringify(row));
}
process.exit(bad ? 1 : 0);
