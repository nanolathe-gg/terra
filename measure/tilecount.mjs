// Export maps of growing size through the editor's real export and report how many distinct 32x32 tiles each uses.
//   node measure/tilecount.mjs [--worlds green,red,lava] [--sizes 4,8,12,16,20] [--variant modern] [--layout bare|landforms|dense] [--name Prefix]
//        [--fixed-name (no timestamp in the map name, so two builds' archives compare byte for byte: archiveSHA256)] [--out dir] [--configs DIR]
//        [--chrome --server http://127.0.0.1:<yours> --port <cdp> [--dry (print the Export pane's line and stop)]]
// Prints one JSON line per world and size: distinct tiles (uniqueTiles; before merging when the exporter merged), tile slots, the share of
// slots that are unique, export seconds, archive bytes, and the merge summary if the exporter merged. The layout is a scripted scene
// (repro/layouts.mjs: landforms by default, a few landforms spread over the map; 'bare' leaves the world's flat default ground; 'dense' fills it).
// The export runs under Node on Dawn by default (repro/headless.mjs exportMap: the page's modules bake the export art and the page's exporter,
// export/ built for WebAssembly, packs it; needs Go), from this checkout's files. --chrome exports in the page in headless Chrome instead (the Export
// pane, its worker and its line of text); it needs --server, your own Go development server (there is no default).
import {chromePath, chromeGpuFlags} from '../repro/chrome.mjs';
import {cdpPortFree} from '../repro/cdp-port.mjs';
import {layoutStrokes} from '../repro/layouts.mjs';
import {spawn} from 'node:child_process';
import {createHash} from 'node:crypto';
import {mkdirSync, mkdtempSync, readFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';

const args = process.argv.slice(2);
const opt = (name, fallback) => { const i = args.indexOf(name); return i >= 0 ? args.splice(i, 2)[1] : fallback; };
const chrome = args.includes('--chrome'), server = opt('--server', ''), port = Number(opt('--port', 9450)), out = opt('--out', 'tilecount-out'), configs = opt('--configs', '');
const worlds = opt('--worlds', 'green').split(','), sizes = opt('--sizes', '4,8').split(',').map(Number), variant = opt('--variant', ''), layout = opt('--layout', 'landforms'), prefix = opt('--name', 'Tiles'), stamp = args.includes('--fixed-name'), dry = args.includes('--dry');
if (chrome && !server) { console.error('tilecount.mjs: --chrome needs --server http://127.0.0.1:<port> of your own Go development server (there is no default server).'); process.exit(2); }
if (dry && !chrome) { console.error("tilecount.mjs: --dry prints the Export pane's line, which only the page has: add --chrome."); process.exit(2); }
mkdirSync(out, {recursive: true});
const sleep = ms => new Promise(r => setTimeout(r, ms));
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const search = (world, size) => `biome=${world}${variant ? '&variant=' + variant : ''}&mapX=${size}&mapY=${size}&scratch=tc-${world}-${size}-${Date.now()}&gpuMB=512&heapMB=1536`;
const mapName = (world, size) => `${prefix}${world}${size}${stamp ? '' : Date.now() % 100000}`;
const summary = x => ({uniqueTiles: x.uniqueTiles, tileSlots: x.tileSlots, uniqueShare: +(x.uniqueTiles / x.tileSlots).toFixed(4), merge: x.merge, metrics: x.metrics, selfCheck: x.selfCheck});

if (chrome) await inChrome(); else await inNode();

// The engine and the exporter under Node: one scene a map, opened as the page opens it, and its export.
async function inNode() {
  const headless = await import('../repro/headless.mjs'), {buildWasm} = await import('../repro/export-node.mjs');
  await headless.openHost({configs});
  const wasm = readFileSync(buildWasm(join(mkdtempSync(join(tmpdir(), 'tilecount-')), 'map-export.wasm')));
  for (const world of worlds) for (const size of sizes) {
    const row = {world, units: size, host: 'node'};
    let s = null;
    try {
      s = await headless.openScene({biome: world, strokes: layoutStrokes(layout, size)}, search(world, size));
      await headless.weather(s); row.nodes = s.nodes.length;
      const name = mapName(world, size), t0 = Date.now();
      row.progress = [];   // [chunks done, chunks total, distinct tiles so far], from the exporter's answer to each chunk
      const x = await headless.exportMap(s, {name, wasm, onChunk: (reply, done, total) => row.progress.push([done, total, reply.uniqueTiles])});
      row.seconds = +((Date.now() - t0) / 1000).toFixed(1);
      Object.assign(row, summary(x.result), {archiveBytes: x.archive.byteLength, archive: x.result.archive, archiveSHA256: sha(x.archive)});
      if (s.errors.length) row.console = s.errors.slice(0, 5);
      row.done = true;
    } catch (err) { row.error = err.message; }
    finally { s?.dispose(); }
    console.log(JSON.stringify(row));
  }
}

// The page in headless Chrome: the layout played as a scripted scene, then the Export pane's own export.
async function inChrome() {
  async function session(url, fn) {
    await cdpPortFree(port);
    const browser = spawn(chromePath, ['--headless=new', ...chromeGpuFlags, `--remote-debugging-port=${port}`,
      `--user-data-dir=${out}/profile-${port}-${Date.now()}`, '--window-size=1700,1300', '--no-first-run', 'about:blank'], {stdio: 'ignore'});
    try {
      let ws;
      for (let i = 0; i < 100 && !ws; i++) { try { const p = (await (await fetch(`http://127.0.0.1:${port}/json/list`)).json()).find(x => x.type === 'page'); if (p) ws = new WebSocket(p.webSocketDebuggerUrl); } catch {} if (!ws) await sleep(200); }
      await new Promise(r => ws.onopen = r);
      let id = 0; const wait = new Map();
      ws.onmessage = e => { const m = JSON.parse(e.data); if (m.id) { wait.get(m.id)?.(m); wait.delete(m.id); } };
      const send = (method, params = {}) => new Promise(r => { const k = ++id; wait.set(k, r); ws.send(JSON.stringify({id: k, method, params})); });
      const ev = async expression => { const r = await send('Runtime.evaluate', {expression, awaitPromise: true, returnByValue: true}); if (r.result?.exceptionDetails) throw new Error(r.result.exceptionDetails.exception?.description || r.result.exceptionDetails.text); return r.result?.result?.value; };
      await send('Runtime.enable'); await send('Page.enable');
      await send('Emulation.setDeviceMetricsOverride', {width: 1700, height: 1300, deviceScaleFactor: 1, mobile: false});
      await send('Page.navigate', {url});
      return await fn({send, ev});
    } finally { browser.kill(); await sleep(600); }
  }
  const ready = async ev => {
    for (let i = 0; i < 1200; i++) {
      if (await ev(`!!window.sculptCanvas && !document.getElementById('editor').disabled && !document.getElementById('map-export').disabled`)) { await ev('sculptCanvas.idle()'); await sleep(1500); return; }
      const e = await ev(`document.getElementById('error')?.textContent`); if (e) throw new Error(e);
      await sleep(300);
    }
    throw new Error('the editor never became ready');
  };
  for (const world of worlds) for (const size of sizes) {
    const row = {world, units: size, host: 'chrome'};
    try {
      await session(`${server}/?${search(world, size)}`, async ({ev}) => {
        await ready(ev); await ev(`sculptCanvas.zoom('overview'); true`); await sleep(800);
        row.nodes = await ev(`sculptDebug.scene(${JSON.stringify(layoutStrokes(layout, size))}, {ground: true})`); await ready(ev);
        for (let i = 0; i < 1200 && await ev(`document.getElementById('map-export').disabled`); i++) await sleep(250);
        row.stateBefore = await ev(`document.getElementById('map-export-state').textContent`);   // what the Export pane says before the export starts
        if (dry) return;
        const name = mapName(world, size), t0 = Date.now();
        await ev(`window.tc={done:false};sculptMap.export(${JSON.stringify(name)}).then(x=>window.tc={done:true,x},e=>window.tc={done:true,error:e.message});true`);
        row.progress = [];   // [chunks done, chunks total, distinct tiles so far], from the Export pane's own line
        for (let i = 0; i < 7200; i++) {
          const q = await ev('window.tc');
          const m = /(\d+) \/ (\d+) chunks · (\d+) unique tiles/.exec(await ev(`document.getElementById('map-export-state').textContent`) || '');
          if (m && !row.progress.some(p => p[0] === +m[1])) row.progress.push([+m[1], +m[2], +m[3]]);
          if (q?.done) { row.seconds = +((Date.now() - t0) / 1000).toFixed(1); if (q.error) row.error = q.error; else { const x = q.x; Object.assign(row, summary(x), {archiveBytes: x.archiveBytes}); row.archive = x.archive; row.archiveSHA256 = await ev(`window.tc.x.files.archive.arrayBuffer().then(b => crypto.subtle.digest('SHA-256', b)).then(h => [...new Uint8Array(h)].map(v => v.toString(16).padStart(2, '0')).join(''))`); } break; } await sleep(500); }
        row.state = await ev(`document.getElementById('map-export-state').textContent`);   // what the Export pane says afterwards
        row.done ??= true;
      });
    } catch (err) { row.error = err.message; }
    console.log(JSON.stringify(row));
  }
}
