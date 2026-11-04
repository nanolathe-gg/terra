// Draw brush strokes on a blank sculpt page headlessly, then save the
// terrain canvas and displayed heights (for the Lava band and finger-coast
// comparisons with retail; see lava_bands.py and lava_coasts.py).
//
//   CAPTURE_PORT=9452 node lava_strokes.mjs scenes.json OUT_DIR
//
// scenes.json: {"scenes": [{"name", "url", "seed"?, "strokes": [{"tool",
//   "diameter"?, "amount"?, "softness"?, "roughness"?, "bank"?,
//   "points": [[x, y], ...]}]}]}; points are world px on the 1024 world.
import {spawn} from 'node:child_process';
import {mkdirSync, readFileSync, writeFileSync} from 'node:fs';
import {join} from 'node:path';

const [, , manifestPath, outDir] = process.argv;
const {scenes} = JSON.parse(readFileSync(manifestPath, 'utf8'));
mkdirSync(outDir, {recursive: true});
const port = Number(process.env.CAPTURE_PORT || 9452);
const chrome = spawn(process.env.CHROME || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  ['--headless=new', '--enable-gpu', '--use-angle=metal', `--remote-debugging-port=${port}`,
    `--user-data-dir=${join(outDir, '.profile')}`, '--window-size=1500,1250', '--no-first-run', 'about:blank'],
  {stdio: 'ignore'});
const sleep = ms => new Promise(r => setTimeout(r, ms));
let ws;
for (let i = 0; i < 50 && !ws; i++) {
  try {
    const t = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
    const p = t.find(x => x.type === 'page');
    if (p) ws = new WebSocket(p.webSocketDebuggerUrl);
  } catch { /* starting */ }
  if (!ws) await sleep(200);
}
await new Promise(r => { ws.onopen = r; });
let id = 0;
const wait = new Map();
ws.onmessage = e => { const m = JSON.parse(e.data); if (m.id && wait.has(m.id)) { wait.get(m.id)(m); wait.delete(m.id); } };
const send = (method, params = {}) => new Promise(r => { const k = ++id; wait.set(k, r); ws.send(JSON.stringify({id: k, method, params})); });
const ev = async expr => (await send('Runtime.evaluate', {expression: expr, returnByValue: true, awaitPromise: true})).result?.result?.value;
const ready = async () => {
  for (let i = 0; i < 600; i++) {
    await sleep(250);
    if (await ev(`!!document.getElementById('export') && !document.getElementById('export').disabled`)) return;
  }
  throw new Error('page never finished rendering');
};
const setRange = (rid, v) => ev(`(() => { const e = document.getElementById('${rid}'); if (!e) return; e.value = '${v}';
  e.dispatchEvent(new Event('input', {bubbles: true})); e.dispatchEvent(new Event('change', {bubbles: true})); })()`);

await send('Page.enable');
try {
  for (const scene of scenes) {
    await send('Page.navigate', {url: scene.url});
    await sleep(500);
    await ready();
    await ev(`document.getElementById('blank').click()`);
    await sleep(300);
    await ready();
    if (scene.seed !== undefined) {
      await ev(`(() => { const s = document.getElementById('seed'); s.value = '${scene.seed}'; s.dispatchEvent(new Event('change')); })()`);
    }
    const box = JSON.parse(await ev(`JSON.stringify(document.getElementById('overlay').getBoundingClientRect())`));
    const toScreen = ([x, y]) => ({x: box.left + x / 1024 * box.width, y: box.top + y / 1024 * box.height});
    const mouse = (type, q) => send('Input.dispatchMouseEvent', {type, x: q.x, y: q.y, button: 'left',
      buttons: type === 'mouseReleased' ? 0 : 1, clickCount: 1});
    for (const s of scene.strokes) {
      await ev(`document.querySelector('[data-tool=${s.tool}]').click()`);
      await sleep(100);
      if (s.diameter !== undefined) await setRange('diameter', s.diameter);
      if (s.amount !== undefined) await setRange('amount', s.amount);
      if (s.softness !== undefined) await setRange('softness', s.softness);
      if (s.roughness !== undefined) await setRange('roughness', s.roughness);
      const pts = s.points;
      await mouse('mousePressed', toScreen(pts[0]));
      for (let k = 1; k < pts.length; k++) {
        const [ax, ay] = pts[k - 1], [bx, by] = pts[k];
        const n = Math.max(1, Math.round(Math.hypot(bx - ax, by - ay) / 12));
        for (let j = 1; j <= n; j++) {
          await mouse('mouseMoved', toScreen([ax + (bx - ax) * j / n, ay + (by - ay) * j / n]));
          await sleep(16);
        }
      }
      await mouse('mouseReleased', toScreen(pts[pts.length - 1]));
      await sleep(300);
      await ready();
    }
    await sleep(500);
    await ready();
    const dataURL = await ev(`document.getElementById('terrain').toDataURL('image/png')`);
    writeFileSync(join(outDir, `${scene.name}.png`), Buffer.from(dataURL.split(',')[1], 'base64'));
    const dump = await ev(`JSON.stringify({grid: window.sculptDebug.grid, size: window.sculptDebug.size,
      base: window.sculptDebug.base, sea: window.sculptDebug.sea, heights: window.sculptDebug.heights()})`);
    writeFileSync(join(outDir, `${scene.name}.heights.json`), dump);
    console.log(scene.name, await ev(`document.getElementById('timing').textContent`));
  }
} finally {
  ws.close();
  chrome.kill();
}
