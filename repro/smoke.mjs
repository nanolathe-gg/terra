// Smoke run: for each world, open the default editor (/sculpt with no map size, the 4x4 map), paint one stroke with every brush,
// undo it, and export. With --page8 it also opens one 8x8 map (which pages), paints one stroke and undoes it.
//   node repro/smoke.mjs [--server http://127.0.0.1:8801] [--port 9450] [--worlds green,lava] [--out dir] [--page8] [--no-export]
// Prints one JSON line per world: the brushes that added a node and came back on undo, the export result and the console.
// Exit code 1 if any brush failed to add or undo a node, the console is not clean, or an export other than Zhon's (which cannot export, by design) fails.
import {spawn} from 'node:child_process';
import {mkdirSync, writeFileSync} from 'node:fs';

const args = process.argv.slice(2);
const opt = (name, fallback) => { const i = args.indexOf(name); return i >= 0 ? args.splice(i, 2)[1] : fallback; };
const flag = name => { const i = args.indexOf(name); if (i >= 0) args.splice(i, 1); return i >= 0; };
const server = opt('--server', 'http://127.0.0.1:8801'), port = Number(opt('--port', 9450)), out = opt('--out', 'smoke-out');
const worlds = opt('--worlds', 'green,red,archipelago,moon,zhon,lava,desert,crystal,ice').split(','), page8 = flag('--page8'), noExport = flag('--no-export');
mkdirSync(out, {recursive: true});
const sleep = ms => new Promise(r => setTimeout(r, ms));
const TOOLS = ['plateau', 'hill', 'mountain', 'ramp', 'deep', 'shallow', 'smooth', 'offset', 'crater', 'fissure', 'erase', 'crystal', 'sand', 'grass', 'paint'];

async function session(url, fn) {
  const logs = [];
  const chrome = spawn('/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', ['--headless=new', '--enable-gpu', '--use-angle=metal', `--remote-debugging-port=${port}`,
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

const ready = async (ev, exportable) => {
  for (let i = 0; i < 600; i++) {
    if (await ev(`!!window.sculptCanvas && !document.getElementById('editor').disabled && ${exportable ? `!document.getElementById('map-export').disabled` : 'true'}`)) { await ev('sculptCanvas.idle()'); await sleep(1500); return; }
    const e = await ev(`document.getElementById('error')?.textContent`); if (e) throw new Error(e);
    await sleep(300);
  }
  throw new Error('the editor never became ready');
};
const strokeAt = async (send, ev, tool) => {
  await ev(`document.querySelector('[data-tool="${tool}"]').click(); true`);
  const x0 = 700, y0 = 650, pts = [[0, 0], [60, 20], [120, 30], [180, 10], [240, 0]];
  const m = (type, x, y) => send('Input.dispatchMouseEvent', {type, x, y, button: 'left', buttons: type === 'mouseReleased' ? 0 : 1, clickCount: 1});
  await send('Input.dispatchMouseEvent', {type: 'mouseMoved', x: x0, y: y0});
  await m('mousePressed', x0, y0);
  for (const [dx, dy] of pts) { await m('mouseMoved', x0 + dx, y0 + dy); await sleep(30); }
  await m('mouseReleased', x0 + 240, y0);
  await ev('sculptCanvas.idle()');
};

let bad = 0;
for (const world of worlds) {
  const url = `${server}/sculpt?biome=${world}&scratch=smoke-${world}-${Date.now()}&gpuMB=512&heapMB=1536`;
  const result = await session(url, async ({send, ev, logs}) => {
    const r = {world, brushes: {}, export: null};
    try {
      await ready(ev, world !== 'zhon');
      await ev('sculptCanvas.zoom(1); true'); await sleep(500);
      for (const tool of TOOLS) {
        const before = await ev('sculptDebug.nodes().length');
        await strokeAt(send, ev, tool);
        const added = (await ev('sculptDebug.nodes().length')) - before;
        await ev(`document.getElementById('undo').click(); true`); await ev('sculptCanvas.idle()');
        const back = await ev('sculptDebug.nodes().length');
        r.brushes[tool] = added === 1 && back === before ? 'ok' : `added ${added}, after undo ${back - before}`;
        if (r.brushes[tool] !== 'ok') bad++;
      }
      if (!noExport) {
        if (world === 'zhon') r.export = await ev(`document.getElementById('map-export').disabled ? 'disabled, by design' : 'enabled'`);
        else {
          const name = `Smoke${world}${Date.now() % 100000}`;
          await ev(`window.smokeExport={done:false};sculptMap.export(${JSON.stringify(name)}).then(x=>window.smokeExport={done:true,x},e=>window.smokeExport={done:true,error:e.message});true`);
          for (let i = 0; i < 1200; i++) { const q = await ev('window.smokeExport'); if (q?.done) { r.export = q.error ? 'FAILED: ' + q.error : 'ok'; r.exportResult = JSON.stringify(q.x).slice(0, 200); break; } await sleep(250); }
          r.export ??= 'FAILED: timed out';
          if (r.export !== 'ok') bad++;
        }
      }
    } catch (err) { r.error = err.message; bad++; }
    r.console = logs.filter(l => !/favicon/.test(l)); if (r.console.length) bad++;
    return r;
  });
  console.log(JSON.stringify(result));
}
if (page8) {
  const url = `${server}/sculpt?biome=green&mapX=8&mapY=8&scratch=smoke-8-${Date.now()}&gpuMB=512&heapMB=1536`;
  const r = await session(url, async ({send, ev, logs}) => {
    const r = {page8: true};
    try {
      await ready(ev, true); await ev('sculptCanvas.zoom(1); true'); await sleep(500);
      r.paged = await ev('sculptDebug.pageInfo()?.np ?? null');
      const before = await ev('sculptDebug.nodes().length'); await strokeAt(send, ev, 'hill');
      r.added = (await ev('sculptDebug.nodes().length')) - before;
      await ev(`document.getElementById('undo').click(); true`); await ev('sculptCanvas.idle()');
      r.afterUndo = (await ev('sculptDebug.nodes().length')) - before;
      if (r.added !== 1 || r.afterUndo !== 0 || !r.paged) bad++;
    } catch (err) { r.error = err.message; bad++; }
    r.console = logs.filter(l => !/favicon/.test(l)); if (r.console.length) bad++;
    return r;
  });
  console.log(JSON.stringify(r));
}
writeFileSync(`${out}/done.txt`, bad ? 'FAILURES ' + bad : 'ok');
process.exit(bad ? 1 : 0);
