// Smoke run: for each world, open the default editor (/sculpt with no map size, the 4x4 map), paint one stroke with every brush,
// undo it, and export. With --page8 it also opens one 8x8 map per world in --worlds8 (default green; which pages), paints one stroke and undoes it.
//   node repro/smoke.mjs [--server http://127.0.0.1:8801] [--port 9450] [--worlds green,lava] [--out dir] [--page8 [--worlds8 green,lava,ice]] [--no-export] [--shore]
//        [--jobs 3]
// --jobs runs that many browsers at once (default 3), on CDP ports --port, --port+1, ...: each world is its own browser either way.
// Prints one JSON line per world: the brushes that added a node and came back on undo, the export result and the console. The export runs in
// the page (export/ built for WebAssembly, in a worker), so this works on the Go server and on a static build alike; it must pass its self-check.
// Exit code 1 if any brush failed to add or undo a node, the console is not clean, or an export fails.
import {chromePath, chromeGpuFlags} from './chrome.mjs';
import {cdpPortFree} from './cdp-port.mjs';
import {spawn} from 'node:child_process';
import {mkdirSync, writeFileSync} from 'node:fs';

const args = process.argv.slice(2);
const opt = (name, fallback) => { const i = args.indexOf(name); return i >= 0 ? args.splice(i, 2)[1] : fallback; };
const flag = name => { const i = args.indexOf(name); if (i >= 0) args.splice(i, 1); return i >= 0; };
const server = opt('--server', 'http://127.0.0.1:8801'), port = Number(opt('--port', 9450)), out = opt('--out', 'smoke-out');
const worlds = opt('--worlds', 'green,red,archipelago,moon,lava,desert,crystal,ice').split(','), worlds8 = opt('--worlds8', 'green').split(','), page8 = flag('--page8'), noExport = flag('--no-export'), shore = flag('--shore');
const jobs = Math.max(1, Number(opt('--jobs', 3)));
mkdirSync(out, {recursive: true});
const sleep = ms => new Promise(r => setTimeout(r, ms));

async function session(url, port, fn) {
  const logs = [];
  await cdpPortFree(port);
  const chrome = spawn(chromePath, ['--headless=new', ...chromeGpuFlags, `--remote-debugging-port=${port}`,
    `--user-data-dir=${out}/profile-${port}-${Date.now()}`, '--window-size=1700,1300', '--no-first-run', 'about:blank'], {stdio: 'ignore'});
  try {
    let ws;
    for (let i = 0; i < 100 && !ws; i++) { try { const p = (await (await fetch(`http://127.0.0.1:${port}/json/list`)).json()).find(x => x.type === 'page'); if (p) ws = new WebSocket(p.webSocketDebuggerUrl); } catch {} if (!ws) await sleep(200); }
    await new Promise(r => ws.onopen = r);
    let id = 0; const wait = new Map();
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
    await send('Page.navigate', {url});
    return await fn({send, ev, logs});
  } finally { chrome.kill(); await sleep(600); }
}

const ready = async ev => {
  for (let i = 0; i < 600; i++) {
    if (await ev(`!!window.sculptCanvas && !document.getElementById('editor').disabled && sculptRegion.canExport()`)) { await ev('sculptCanvas.idle()'); await sleep(1500); return; }
    const e = await ev(`document.getElementById('error')?.textContent`); if (e) throw new Error(e);
    await sleep(300);
  }
  throw new Error('the editor never became ready');
};
const strokeAt = async (send, ev, tool) => {
  await ev(`document.querySelector('[data-tool="${tool}"]').click(); true`);
  if (tool === 'plateau') await ev(`for (const [id,v] of [['lf-route-smooth',80],['crest-taper',65]]) { const e=document.getElementById(id); e.value=v; e.dispatchEvent(new Event('input',{bubbles:true})); e.dispatchEvent(new Event('change',{bubbles:true})); } true`);
  if (tool === 'plateau' && shore) await ev(`for (const [id,v] of [['lf-combine',1],['lf-height-reference',1],['lf-elevation',-55],['fingers',100],['finger-size',65],['lf-step-reference',1],['sec-terraces',5]]) { const e=document.getElementById(id); e.value=v; e.dispatchEvent(new Event('input',{bubbles:true})); e.dispatchEvent(new Event('change',{bubbles:true})); } true`);
  const x0 = 700, y0 = 650, pts = [[0, 0], [60, 20], [120, 30], [180, 10], [240, 0]];
  const m = (type, x, y) => send('Input.dispatchMouseEvent', {type, x, y, button: 'left', buttons: type === 'mouseReleased' ? 0 : 1, clickCount: 1});
  await send('Input.dispatchMouseEvent', {type: 'mouseMoved', x: x0, y: y0});
  await m('mousePressed', x0, y0);
  for (const [dx, dy] of pts) { await m('mouseMoved', x0 + dx, y0 + dy); await sleep(30); }
  await m('mouseReleased', x0 + 240, y0);
  await ev('sculptCanvas.idle()');
};

let bad = 0;
async function smokeWorld(world, port) {
  const url = `${server}/?biome=${world}&scratch=smoke-${world}-${Date.now()}&gpuMB=1024&heapMB=1536`;
  const result = await session(url, port, async ({send, ev, logs}) => {
    const r = {world, brushes: {}, export: null};
    try {
      await ready(ev);
      r.path = await ev('location.pathname');
      if (r.path !== new URL(url).pathname) throw new Error('Editor redirected away from its index URL: ' + r.path);
      await ev('sculptCanvas.zoom(1); true'); await sleep(500);
      // Every brush on this world's toolbar: the fixed ones and the world's own shape tools (a world may drop or add shape tools).
      for (const tool of await ev(`[...document.querySelectorAll('.tool-groups [data-tool]')].map(b => b.dataset.tool).filter(t => t !== 'move')`)) {
        const before = await ev('sculptDebug.nodes().length');
        await strokeAt(send, ev, tool);
        const added = (await ev('sculptDebug.nodes().length')) - before;
        await ev(`document.getElementById('undo').click(); true`); await ev('sculptCanvas.idle()');
        const back = await ev('sculptDebug.nodes().length');
        r.brushes[tool] = added === 1 && back === before ? 'ok' : `added ${added}, after undo ${back - before}`;
        if (r.brushes[tool] !== 'ok') bad++;
      }
      if (!noExport) {
        // Export an actual landform with the route and taper fields, after the brush/undo loop left the map empty.
        await strokeAt(send, ev, 'plateau');
        r.landformParams = await ev(`sculptDebug.nodes().at(-1).params`);
        if (r.landformParams.routeSmooth !== .8 || r.landformParams.crestTaper !== .65) bad++;
        if (shore && (r.landformParams.combine !== 1 || r.landformParams.fingers !== 1 || r.landformParams.terraces !== 5 || r.landformParams.stepReference !== 1 || r.landformParams.heightReference !== 1)) bad++;
        r.landformParams = {routeSmooth:r.landformParams.routeSmooth,crestTaper:r.landformParams.crestTaper,...(shore?{combine:r.landformParams.combine,elevation:r.landformParams.elevation,fingers:r.landformParams.fingers,terraces:r.landformParams.terraces,stepReference:r.landformParams.stepReference,heightReference:r.landformParams.heightReference}:{})};
        for (let i = 0; i < 400 && await ev(`document.getElementById('map-export').disabled`); i++) await sleep(250);   // the Time pass after the last undo
        const name = `Smoke${world}${Date.now() % 100000}`;
        await ev(`window.smokeExport={done:false};sculptMap.export(${JSON.stringify(name)}).then(x=>window.smokeExport={done:true,x},e=>window.smokeExport={done:true,error:e.message});true`);
        for (let i = 0; i < 1200; i++) { const q = await ev('window.smokeExport'); if (q?.done) { const check = q.x?.selfCheck; r.export = q.error ? 'FAILED: ' + q.error : check?.tnt && check.ota && check.archive && q.x.archiveBytes > 0 ? 'ok' : 'FAILED: self-check ' + JSON.stringify(check); r.exportResult = JSON.stringify(q.x ?? null).slice(0, 200); break; } await sleep(250); }
        r.export ??= 'FAILED: timed out';
        if (r.export !== 'ok') bad++;
      }
    } catch (err) { r.error = err.message; bad++; }
    r.console = logs.filter(l => !/favicon/.test(l)); if (r.console.length) bad++;
    return r;
  });
  console.log(JSON.stringify(result));
}
async function smokePage8(world, port) {
  const url = `${server}/?biome=${world}&mapX=8&mapY=8&scratch=smoke-8-${world}-${Date.now()}&gpuMB=1024&heapMB=1536`;
  const r = await session(url, port, async ({send, ev, logs}) => {
    const r = {page8: true, world};
    try {
      await ready(ev); await ev('sculptCanvas.zoom(1); true'); await sleep(500);
      r.paged = await ev('sculptDebug.pageInfo()?.np ?? null');
      for (const tool of ['hill', 'deep']) {   // a ridge, and water with its coast pass, on pages
        const before = await ev('sculptDebug.nodes().length'); await strokeAt(send, ev, tool);
        r.added = ((r.added ?? 0)) + (await ev('sculptDebug.nodes().length')) - before;
        await ev(`document.getElementById('undo').click(); true`); await ev('sculptCanvas.idle()');
        r.afterUndo = (r.afterUndo ?? 0) + (await ev('sculptDebug.nodes().length')) - before;
      }
      if (r.added !== 2 || r.afterUndo !== 0 || !r.paged) bad++;
    } catch (err) { r.error = err.message; bad++; }
    r.console = logs.filter(l => !/favicon/.test(l)); if (r.console.length) bad++;
    return r;
  });
  console.log(JSON.stringify(r));
}
// Each world is its own browser; `jobs` of them run at once, each on its own CDP port.
const queue = [...worlds.map(w => [smokeWorld, w]), ...(page8 ? worlds8.map(w => [smokePage8, w]) : [])];
await Promise.all(Array.from({length: Math.min(jobs, queue.length)}, async (_, j) => {
  for (let next; (next = queue.shift());) {
    const [run, world] = next;
    try { await run(world, port + j); } catch (err) { console.log(JSON.stringify({world, error: err.message})); bad++; }
  }
}));
writeFileSync(`${out}/done.txt`, bad ? 'FAILURES ' + bad : 'ok');
process.exit(bad ? 1 : 0);
