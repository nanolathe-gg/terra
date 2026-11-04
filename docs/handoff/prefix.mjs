// One-time tool for retiring the specialized terrain kinds (see README.md here; delete after use).
// Samples the authored height (above the sea) under every point of each relative stroke (hill, mountain, plateau, offset, lower, ramp),
// with only the strokes before it applied, on a server running main BEFORE the retirement. Resumable: scenes already in out.json are skipped.
//   node prefix.mjs <server> <cdp-port> <out.json> <scene.json>...
import {spawn} from 'node:child_process';
import {readFileSync, writeFileSync, existsSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join, resolve} from 'node:path';
const [server, port, outFile, ...given] = process.argv.slice(2), files = given.map(f => resolve(f));
const RELATIVE = new Set(['hill', 'mountain', 'plateau', 'offset', 'lower', 'ramp']);
const sleep = ms => new Promise(r => setTimeout(r, ms));
const out = existsSync(outFile) ? JSON.parse(readFileSync(outFile, 'utf8')) : {};
for (const file of files) {
  if (out[file]) continue;
  const scene = JSON.parse(readFileSync(file, 'utf8'));
  const need = scene.strokes.map((s, i) => RELATIVE.has(s[0]) ? i : -1).filter(i => i >= 0);
  if (!need.length) { out[file] = {}; writeFileSync(outFile, JSON.stringify(out)); continue; }
  const chrome = spawn('/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', ['--headless=new', '--enable-gpu', '--use-angle=metal', `--remote-debugging-port=${port}`, `--user-data-dir=${join(tmpdir(), `terraform-prefix-${port}-${Date.now()}`)}`, '--window-size=1200,900', '--no-first-run', 'about:blank'], {stdio: 'ignore'});
  try {
    let ws;
    for (let i = 0; i < 100 && !ws; i++) { try { const p = (await (await fetch(`http://127.0.0.1:${port}/json/list`)).json()).find(x => x.type === 'page'); if (p) ws = new WebSocket(p.webSocketDebuggerUrl); } catch {} if (!ws) await sleep(200); }
    await new Promise(r => ws.onopen = r);
    let id = 0; const wait = new Map();
    ws.onmessage = e => { const m = JSON.parse(e.data); if (m.id && wait.has(m.id)) { wait.get(m.id)(m); wait.delete(m.id); } };
    const send = (method, params = {}) => new Promise(r => { const k = ++id; wait.set(k, r); ws.send(JSON.stringify({id: k, method, params})); });
    const ev = async expr => { const r = await send('Runtime.evaluate', {expression: expr, returnByValue: true, awaitPromise: true}); if (r.result?.exceptionDetails) throw new Error(r.result.exceptionDetails.exception?.description || r.result.exceptionDetails.text); return r.result?.result?.value; };
    await send('Runtime.enable'); await send('Page.enable');
    const url = `${server}/sculpt?biome=${scene.biome}&mapX=2&mapY=2&scratch=prefix${port}${scene.query ? '&' + scene.query : ''}`;
    await send('Page.navigate', {url});
    for (let i = 0; i < 1200; i++) { await sleep(500); if (await ev(`!!window.sculptCanvas && !!window.sculptDebug && !document.getElementById('editor')?.disabled`)) break; }
    await ev(`(() => { const w = document.getElementById('weather'); w.checked = false; w.dispatchEvent(new Event('change', {bubbles: true})); })()`);
    const res = {sea: await ev('sculptDebug.sea')};
    for (const i of need) {
      const t0 = Date.now();
      await ev(`sculptDebug.scene(${JSON.stringify(scene.strokes.slice(0, i))}, {ground: ${scene.ground !== false}})`);
      await ev('sculptCanvas.idle()');
      const pts = scene.strokes[i][1];
      // Ask twice: the first call can start the CPU copy's refresh.
      const q = `(${JSON.stringify(pts)}).map(([x, y]) => sculptDebug.corner(Math.max(0, x), Math.max(0, y)).authored - sculptDebug.sea)`;
      await ev(q); await sleep(300); await ev('sculptCanvas.idle()');
      res[i] = await ev(q);
      console.log(file, i, scene.strokes[i][0], JSON.stringify(res[i].map(v => Math.round(v * 10) / 10)), Date.now() - t0, 'ms');
    }
    out[file] = res; writeFileSync(outFile, JSON.stringify(out));
  } finally { chrome.kill('SIGKILL'); }
}
