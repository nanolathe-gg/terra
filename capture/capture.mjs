// Headless capture of terrain pages for review and regression baselines.
//
// Drives a separate headless Chrome over the DevTools protocol, so the
// user's own browser is never touched. Each scene loads a page, optionally
// sets the brush seed and example through the page's own controls, waits
// until the page reports a finished render (its Export button enables),
// then saves the terrain canvas and its timing text.
//
//   node capture.mjs scenes.json OUT_DIR
//
// scenes.json: {"scenes": [{"name", "url", "seed"?, "example"?}]}
import {chromePath, chromeGpuFlags} from '../repro/chrome.mjs';
import {spawn} from 'node:child_process';
import {createHash} from 'node:crypto';
import {mkdirSync, readFileSync, writeFileSync} from 'node:fs';
import {join} from 'node:path';

const [, , manifestPath, outDir] = process.argv;
if (!manifestPath || !outDir) {
  console.error('usage: node capture.mjs scenes.json OUT_DIR');
  process.exit(2);
}
const {scenes} = JSON.parse(readFileSync(manifestPath, 'utf8'));
mkdirSync(outDir, {recursive: true});

const port = Number(process.env.CAPTURE_PORT || 9431);
// --enable-gpu gives headless Chrome the real GPU on macOS: WebGPU runs on
// Dawn's Metal backend (navigator.gpu needs a secure context, which
// 127.0.0.1 is), and Metal-backed ANGLE serves the 2D overlay. SwiftShader
// timings would not be comparable with interactive use. toDataURL reads the
// last presented WebGPU frame.
const chrome = spawn(chromePath, ['--headless=new', ...chromeGpuFlags,
  `--remote-debugging-port=${port}`, `--user-data-dir=${join(outDir, '.profile')}`,
  '--window-size=1500,1250', '--no-first-run', 'about:blank'], {stdio: 'ignore'});
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

let socket;
for (let attempt = 0; attempt < 50 && !socket; attempt++) {
  try {
    const targets = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
    const page = targets.find(t => t.type === 'page');
    if (page) socket = new WebSocket(page.webSocketDebuggerUrl);
  } catch { /* Chrome still starting */ }
  if (!socket) await sleep(200);
}
if (!socket) { chrome.kill(); throw new Error('capture: headless Chrome did not start'); }
await new Promise(resolve => { socket.onopen = resolve; });
let nextID = 0;
const waiting = new Map();
socket.onmessage = event => {
  const message = JSON.parse(event.data);
  if (message.id && waiting.has(message.id)) { waiting.get(message.id)(message); waiting.delete(message.id); }
};
const send = (method, params = {}) => new Promise(resolve => {
  const id = ++nextID; waiting.set(id, resolve); socket.send(JSON.stringify({id, method, params}));
});
const evaluate = async expression =>
  (await send('Runtime.evaluate', {expression, returnByValue: true, awaitPromise: true})).result?.result?.value;

// A page is finished when its export control is enabled: the sculpt lab
// enables it only after the full draw and any refinement have completed.
async function settle(name, timeoutMs = 90000) {
  const started = Date.now();
  for (;;) {
    await sleep(300);
    const state = JSON.parse(await evaluate(`JSON.stringify({
      ready: !!document.getElementById('export') && !document.getElementById('export').disabled,
      error: (e => e && !e.hidden ? e.textContent : '')(document.getElementById('error')),
      refinement: document.getElementById('weather-state')?.textContent || '',
      timing: document.getElementById('timing')?.textContent || ''})`) || '{}');
    if (state.error) throw new Error(`capture: ${name}: page error: ${state.error}`);
    if (state.ready) return {...state, waitedMs: Date.now() - started};
    if (Date.now() - started > timeoutMs) throw new Error(`capture: ${name}: no finished render after ${timeoutMs} ms`);
  }
}

await send('Page.enable');
await send('Runtime.enable');
const results = [];
try {
  for (const scene of scenes) {
    await send('Page.navigate', {url: scene.url});
    await sleep(500);
    let state = await settle(scene.name);
    if (scene.seed !== undefined || scene.example !== undefined) {
      // Use the page's own controls so the scene is built exactly as an
      // author would build it: seed first, then the example loader.
      await evaluate(`(() => {
        const seed = document.getElementById('seed');
        if (${JSON.stringify(scene.seed ?? null)} !== null) {
          seed.value = ${JSON.stringify(String(scene.seed ?? ''))};
          seed.dispatchEvent(new Event('change'));
        }
        const example = document.getElementById('example');
        if (${JSON.stringify(scene.example ?? null)} !== null) example.value = ${JSON.stringify(scene.example ?? '')};
        document.getElementById('demo').click();
      })()`);
      await sleep(500);
      state = await settle(scene.name);
    }
    if (scene.eval) {
      // Drive page controls the way an author would, then wait again.
      const evalResult = await evaluate(scene.eval);
      if (evalResult !== undefined) console.log(`${scene.name} eval: ${evalResult}`);
      await sleep(500);
      state = await settle(scene.name);
    }
    await sleep(300);
    const dataURL = await evaluate(`document.getElementById('terrain').toDataURL('image/png')`);
    const png = Buffer.from(dataURL.split(',')[1], 'base64');
    writeFileSync(join(outDir, `${scene.name}.png`), png);
    if (scene.heights) {
      // Displayed heights for measurement; only pages with the debug hook.
      const dump = await evaluate(`JSON.stringify({grid: window.sculptDebug.grid, size: window.sculptDebug.size, base: window.sculptDebug.base, sea: window.sculptDebug.sea, heights: window.sculptDebug.heights()})`);
      writeFileSync(join(outDir, `${scene.name}.heights.json`), dump);
    }
    const result = {...scene, sha256: createHash('sha256').update(png).digest('hex'),
      refinement: state.refinement, timing: state.timing, waitedMs: state.waitedMs};
    results.push(result);
    console.log(`${scene.name}  ${result.sha256.slice(0, 12)}  ${state.refinement}`);
  }
} finally {
  writeFileSync(join(outDir, 'captures.json'), JSON.stringify({captured: new Date().toISOString(), results}, null, 2) + '\n');
  socket.close();
  chrome.kill();
}
