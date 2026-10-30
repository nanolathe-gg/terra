// Repeat check of the shape on the GPU: two evaluations of a scene give identical planes (all 31), in one browser page.
//   node shapecheck.mjs <scene.json>... [--server http://127.0.0.1:8874] [--port 9668] [--out dir] [--map]
// Study scenes run on the 1024-px editor; with --map the same strokes run on a 4x4 map canvas (1168 samples, the whole map compared).
// Writes <out>/<scene>.json and prints a one-line summary per scene. Exit code 1 if a repeat differs.
import {spawn} from 'node:child_process';
import {mkdirSync, readFileSync, writeFileSync} from 'node:fs';
import {basename} from 'node:path';

const args = process.argv.slice(2), opt = (name, fallback) => { const i = args.indexOf(name); return i >= 0 ? args.splice(i, 2)[1] : fallback; };
const server = opt('--server', 'http://127.0.0.1:8874'), port = Number(opt('--port', 9674)), out = opt('--out', 'shapecheck-out'), mapSize = opt('--size', 4), mapMode = args.includes('--map') && args.splice(args.indexOf('--map'), 1).length > 0;
const scenes = args;
if (!scenes.length) { console.error('usage: node shapecheck.mjs <scene.json>... [--server url] [--port n] [--out dir] [--map]'); process.exit(2); }
mkdirSync(out, {recursive: true});
const sleep = ms => new Promise(r => setTimeout(r, ms));
let bad = 0;
for (const file of scenes) {
  const scene = JSON.parse(readFileSync(file, 'utf8')), name = basename(file, '.json') + (mapMode ? '-map' : '');
  const url = mapMode ? `${server}/sculpt?biome=${scene.biome}&mapX=${mapSize}&mapY=${mapSize}&scratch=shapecheck${Date.now()}&gpuMB=512&heapMB=1536${scene.query ? '&' + scene.query : ''}`
    : `${server}/sculpt?biome=${scene.biome}&scratch=shapecheck${Date.now()}${scene.query ? '&' + scene.query : ''}`;
  const chrome = spawn('/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', ['--headless=new', '--enable-gpu', '--use-angle=metal', `--remote-debugging-port=${port}`,
    `--user-data-dir=${out}/prof-${port}-${Date.now()}`, '--window-size=1500,1200', '--no-first-run', 'about:blank'], {stdio: 'ignore'});
  try {
    let ws;
    for (let i = 0; i < 100 && !ws; i++) { try { const p = (await (await fetch(`http://127.0.0.1:${port}/json/list`)).json()).find(x => x.type === 'page'); if (p) ws = new WebSocket(p.webSocketDebuggerUrl); } catch {} if (!ws) await sleep(200); }
    await new Promise(r => ws.onopen = r);
    let id = 0; const wait = new Map(), logs = [];
    ws.onmessage = e => { const m = JSON.parse(e.data); if (m.id && wait.has(m.id)) { wait.get(m.id)(m); wait.delete(m.id); }
      if (m.method === 'Runtime.exceptionThrown') logs.push('exception: ' + (m.params.exceptionDetails.exception?.description || m.params.exceptionDetails.text).slice(0, 400));
      if (m.method === 'Runtime.consoleAPICalled' && (m.params.type === 'error')) logs.push(m.params.args.map(a => a.value ?? a.description).join(' ').slice(0, 300)); };
    const send = (method, params = {}) => new Promise(r => { const k = ++id; wait.set(k, r); ws.send(JSON.stringify({id: k, method, params})); });
    const ev = async expression => { const r = await send('Runtime.evaluate', {expression, awaitPromise: true, returnByValue: true}); if (r.result?.exceptionDetails) throw new Error(r.result.exceptionDetails.exception?.description || r.result.exceptionDetails.text); return r.result.result.value; };
    const ready = async () => { for (let i = 0; i < 300; i++) { await sleep(500); if (await ev(mapMode ? '!!window.sculptCanvas&&!document.getElementById("map-export").disabled' : `!!window.sculptDebug&&!document.getElementById('export')?.disabled`)) return; } throw new Error('never ready: '+logs.join(' | ').slice(0,1500)+' '+await ev("document.getElementById('weather-state')?.textContent")); };
    await send('Runtime.enable'); await send('Page.enable'); await send('Page.navigate', {url}); await ready();
    const t0 = Date.now();
    await ev(`sculptDebug.scene(${JSON.stringify(scene.strokes)},{ground:${scene.ground !== false}});true`); await ready();
    const sceneMs = Date.now() - t0;
    const r = await ev('sculptDebug.shapeCompare()');
    writeFileSync(`${out}/${name}.json`, JSON.stringify({scene: file, sceneMs, console: logs.slice(0, 6), ...r}, null, 1));
    if (r.error) { console.log(`${name}: ${r.error}`); bad++; continue; }
    const rep = Object.values(r.repeat.planes).some(p => p.max > 0);
    console.log(`${name}: ${rep ? 'REPEAT DIFFERS' : 'repeat identical'} (two GPU runs, ${Object.keys(r.repeat.planes).length} planes)`);
    if (rep) bad++;
    if (logs.length) console.log('  console errors:', logs.slice(0, 3));
  } finally { chrome.kill(); await sleep(500); }
}
process.exit(bad ? 1 : 0);
