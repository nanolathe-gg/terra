// Render a reproduction scene in headless Chrome (WebGPU) and save the canvas.
//   node render.mjs <scene.json> <out-dir> [--server http://127.0.0.1:8801] [--port 9450] [--query 'sun=90,45&cavity=.5'] [--clay]
// --query appends page parameters after the scene's own (review sun, knob trials); --clay ticks the Clay box.
// The scene is {"biome": "green", "query": "", "ground": true, "strokes": [[kind, [[x,y],...], options], ...]}
// (sculpt.js scriptedScene). Writes <out-dir>/ours.png and ours-heights.json
// (the displayed heights, grid x grid over the 1024-px map).
import {spawn} from 'node:child_process';
import {mkdirSync, readFileSync, writeFileSync} from 'node:fs';

const args = process.argv.slice(2);
const opt = (name, fallback) => { const i = args.indexOf(name); return i >= 0 ? args.splice(i, 2)[1] : fallback; };
const server = opt('--server', 'http://127.0.0.1:8801'), port = Number(opt('--port', 9450));
const extraQuery = opt('--query', '');
const clayOn = args.includes('--clay') && args.splice(args.indexOf('--clay'), 1).length > 0;
const [sceneFile, out] = args;
const scene = JSON.parse(readFileSync(sceneFile, 'utf8'));
mkdirSync(out, {recursive: true});
// The page used to fall back to the server's first world for an unknown one,
// so a Moon scene could be written out as Green. Refuse before rendering:
// the config request must answer for the scene's world (review A3).
const sceneConfigResponse = await fetch(`${server}/sculpt-config.json?biome=${encodeURIComponent(scene.biome)}`);
if (!sceneConfigResponse.ok) {
  console.error(`render.mjs: ${sceneFile}: world ${scene.biome} is not served (HTTP ${sceneConfigResponse.status})`);
  process.exit(1);
}
const sceneConfig = await sceneConfigResponse.json();
if (sceneConfig.biomeId !== scene.biome) {
  console.error(`render.mjs: ${sceneFile}: asked for world ${scene.biome}, the server returned ${sceneConfig.biomeId}`);
  process.exit(1);
}
const url = `${server}/sculpt?biome=${scene.biome}&scratch=1${scene.query ? '&' + scene.query : ''}${extraQuery ? '&' + extraQuery : ''}`;
const chrome = spawn('/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', ['--headless=new', '--enable-gpu', '--use-angle=metal',
  `--remote-debugging-port=${port}`, `--user-data-dir=${out}/.profile-${port}`, '--window-size=1500,1200', '--no-first-run', 'about:blank'], {stdio: 'ignore'});
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
  const ready = async () => { for (let i = 0; i < 480; i++) { await sleep(250); if (await ev(`!document.getElementById('export')?.disabled`)) return true; } return false; };
  await send('Runtime.enable'); await send('Page.enable');
  await send('Page.navigate', {url});
  if (!await ready()) throw new Error('editor never became ready: ' + await ev(`document.getElementById('error').textContent`));
  const loadedBiome = await ev('sculptDebug.biome');
  if (loadedBiome !== scene.biome) throw new Error(`page loaded world ${loadedBiome}, scene asks for ${scene.biome}`);
  if (clayOn) await ev(`(() => { const c = document.getElementById('clay'); c.checked = true; c.dispatchEvent(new Event('change', {bubbles: true})); })()`);
  const t0 = Date.now();
  const count = await ev(`sculptDebug.scene(${JSON.stringify(scene.strokes)}, {ground: ${scene.ground !== false}})`);
  if (!await ready()) throw new Error('scene never finished: ' + await ev(`document.getElementById('error').textContent`));
  const png = await ev(`document.getElementById('terrain').toDataURL('image/png')`);
  writeFileSync(`${out}/ours.png`, Buffer.from(png.split(',')[1], 'base64'));
  writeFileSync(`${out}/ours-heights.json`, JSON.stringify({grid: await ev('sculptDebug.grid'), sea: await ev('sculptDebug.sea'), heights: await ev('sculptDebug.heights()')}));
  console.log(JSON.stringify({nodes: count, ms: Date.now() - t0, mismatch: await ev('sculptDebug.replayAll()'), console: logs.slice(0, 8)}));
  ws.close();
} finally { chrome.kill(); }
