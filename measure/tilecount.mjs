// Export maps of growing size through the editor's real export and report how many distinct 32x32 tiles each uses.
//   node measure/tilecount.mjs --server http://127.0.0.1:8841 --port 9741 [--worlds green,red,lava] [--sizes 4,8,12,16,20] [--variant modern]
//        [--layout bare|landforms] [--name Prefix] [--dry (print the Export pane's line and stop)] [--fixed-name (no timestamp in the map name, so two builds' archives compare byte for byte)] [--out dir] [--exports dir (the server's exports directory, to size the archives)]
// Prints one JSON line per world and size: distinct tiles (uniqueTiles; before merging when the exporter merged), tile slots, the share of
// slots that are unique, export seconds, archive bytes, and the merge summary if the exporter merged. The default layout is a few landforms
// (hill, mountain, plateau, deep water, river, valley) spread over the map; 'bare' leaves the world's flat default ground.
import {cdpPortFree} from '../repro/cdp-port.mjs';
import {spawn} from 'node:child_process';
import {mkdirSync, statSync} from 'node:fs';

const args = process.argv.slice(2);
const opt = (name, fallback) => { const i = args.indexOf(name); return i >= 0 ? args.splice(i, 2)[1] : fallback; };
const server = opt('--server', 'http://127.0.0.1:8801'), port = Number(opt('--port', 9450)), out = opt('--out', 'tilecount-out'), exportsDir = opt('--exports', '');
const worlds = opt('--worlds', 'green').split(','), sizes = opt('--sizes', '4,8').split(',').map(Number), variant = opt('--variant', ''), layout = opt('--layout', 'landforms'), prefix = opt('--name', 'Tiles'), stamp = args.includes('--fixed-name'), dry = args.includes('--dry');
mkdirSync(out, {recursive: true});
const sleep = ms => new Promise(r => setTimeout(r, ms));

async function session(url, fn) {
  await cdpPortFree(port);
  const chrome = spawn('/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', ['--headless=new', '--enable-gpu', '--use-angle=metal', `--remote-debugging-port=${port}`,
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
  } finally { chrome.kill(); await sleep(600); }
}
const ready = async ev => {
  for (let i = 0; i < 1200; i++) {
    if (await ev(`!!window.sculptCanvas && !document.getElementById('editor').disabled && !document.getElementById('map-export').disabled`)) { await ev('sculptCanvas.idle()'); await sleep(1500); return; }
    const e = await ev(`document.getElementById('error')?.textContent`); if (e) throw new Error(e);
    await sleep(300);
  }
  throw new Error('the editor never became ready');
};
// A stroke of about 18% of the canvas width at a fractional position (fx, fy) of the canvas.
const stroke = async (send, ev, tool, fx, fy, len = .18, diameter = 0) => {
  await ev(`document.querySelector('[data-tool="${tool}"]').click(); true`);
  if (diameter) await ev(`(()=>{const e=document.getElementById('diameter');e.value=${diameter};e.dispatchEvent(new Event('input',{bubbles:true}));e.dispatchEvent(new Event('change',{bubbles:true}))})()`);
  const r = await ev(`(()=>{const b=document.querySelector('#editor canvas, canvas')?.getBoundingClientRect();return b?{x:b.x,y:b.y,w:b.width,h:b.height}:null})()`);
  const x0 = r.x + r.w * fx, y0 = r.y + r.h * fy, L = r.w * len;
  const pts = [[0, 0], [.25, .08], [.5, .12], [.75, .04], [1, 0]];
  const m = (type, x, y) => send('Input.dispatchMouseEvent', {type, x, y, button: 'left', buttons: type === 'mouseReleased' ? 0 : 1, clickCount: 1});
  await send('Input.dispatchMouseEvent', {type: 'mouseMoved', x: x0, y: y0}); await m('mousePressed', x0, y0);
  for (const [dx, dy] of pts) { await m('mouseMoved', x0 + dx * L, y0 + dy * L); await sleep(30); }
  await m('mouseReleased', x0 + L, y0); await ev('sculptCanvas.idle()');
};
const PLAN = [['hill', .22, .25], ['mountain', .55, .22], ['plateau', .2, .6], ['deep', .6, .62], ['river', .38, .45], ['valleyV', .7, .8]];

for (const world of worlds) for (const size of sizes) {
  const url = `${server}/sculpt.html?biome=${world}${variant ? '&variant=' + variant : ''}&mapX=${size}&mapY=${size}&scratch=tc-${world}-${size}-${Date.now()}&gpuMB=512&heapMB=1536`;
  const row = {world, units: size};
  try {
    await session(url, async ({send, ev}) => {
      await ready(ev); await ev(`sculptCanvas.zoom('overview'); true`); await sleep(800);
      if (layout === 'dense') {   // strokes of the widest brush on a grid over the whole map, cycling through the tools
        const cells = Math.max(2, Math.round(size * .32)), tools = ['hill', 'mountain', 'plateau', 'valleyV', 'deep', 'river', 'hill', 'crater'];
        let n = 0; for (let j = 0; j < cells; j++) for (let i = 0; i < cells; i++) await stroke(send, ev, tools[n++ % tools.length], .06 + .88 * i / cells, .06 + .88 * (j + .5) / cells, .88 / cells * .8, 800);
        row.nodes = await ev('sculptDebug.nodes().length');
      }
      if (layout === 'landforms') {
        for (const [tool, fx, fy] of PLAN) await stroke(send, ev, tool, fx, fy);
        row.nodes = await ev('sculptDebug.nodes().length');
      }
      for (let i = 0; i < 1200 && await ev(`document.getElementById('map-export').disabled`); i++) await sleep(250);
      row.stateBefore = await ev(`document.getElementById('map-export-state').textContent`);   // what the Export pane says before the export starts
      if (dry) return;
      const name = `${prefix}${world}${size}${stamp ? '' : Date.now() % 100000}`, t0 = Date.now();
      await ev(`window.tc={done:false};sculptMap.export(${JSON.stringify(name)}).then(x=>window.tc={done:true,x},e=>window.tc={done:true,error:e.message});true`);
      row.progress = [];   // [chunks done, chunks total, distinct tiles so far], from the Export pane's own line
      for (let i = 0; i < 7200; i++) {
        const q = await ev('window.tc');
        const m = /(\d+) \/ (\d+) chunks · (\d+) unique tiles/.exec(await ev(`document.getElementById('map-export-state').textContent`) || '');
        if (m && !row.progress.some(p => p[0] === +m[1])) row.progress.push([+m[1], +m[2], +m[3]]);
        if (q?.done) { row.seconds = +((Date.now() - t0) / 1000).toFixed(1); if (q.error) row.error = q.error; else { const x = q.x; Object.assign(row, {uniqueTiles: x.uniqueTiles, tileSlots: x.tileSlots, uniqueShare: +(x.uniqueTiles / x.tileSlots).toFixed(4), merge: x.merge, metrics: x.metrics, selfCheck: x.selfCheck}); if (exportsDir) { try { row.archiveBytes = statSync(`${exportsDir}/${x.archive}`).size; } catch {} } row.archive = x.archive; } break; } await sleep(500); }
      row.state = await ev(`document.getElementById('map-export-state').textContent`);   // what the Export pane says afterwards
      row.done ??= true;
    });
  } catch (err) { row.error = err.message; }
  console.log(JSON.stringify(row));
}
