// A headless Chrome on our own CDP port, for the trailer's captures (after repro/smoke.mjs's session). Never the owner's 9450 or editor.
import {chromePath, chromeGpuFlags} from '../repro/chrome.mjs';
import {cdpPortFree} from '../repro/cdp-port.mjs';
import {spawn} from 'node:child_process';

export const sleep = ms => new Promise(r => setTimeout(r, ms));

export async function browser({port, width, height, profile}) {
  if (!port) throw new Error('cdp: give an explicit CDP port of your own');
  await cdpPortFree(port);
  const chrome = spawn(chromePath, ['--headless=new', ...chromeGpuFlags, `--remote-debugging-port=${port}`, `--user-data-dir=${profile}`,
    `--window-size=${width},${height}`, '--no-first-run', '--hide-scrollbars', 'about:blank'], {stdio: 'ignore'});
  let ws;
  for (let i = 0; i < 100 && !ws; i++) {
    try { const p = (await (await fetch(`http://127.0.0.1:${port}/json/list`)).json()).find(x => x.type === 'page'); if (p) ws = new WebSocket(p.webSocketDebuggerUrl); } catch {}
    if (!ws) await sleep(200);
  }
  if (!ws) { chrome.kill(); throw new Error(`cdp: no Chrome on port ${port}`); }
  await new Promise(r => ws.onopen = r);
  let id = 0; const wait = new Map(), logs = [];
  ws.onmessage = e => {
    const m = JSON.parse(e.data);
    if (m.id) { wait.get(m.id)?.(m); wait.delete(m.id); }
    if (m.method === 'Runtime.exceptionThrown') logs.push(m.params.exceptionDetails.exception?.description || m.params.exceptionDetails.text);
    if (m.method === 'Runtime.consoleAPICalled' && m.params.type === 'error') logs.push(m.params.args.map(a => a.value ?? a.description).join(' ').slice(0, 300));
  };
  const send = (method, params = {}) => new Promise(r => { const k = ++id; wait.set(k, r); ws.send(JSON.stringify({id: k, method, params})); });
  const ev = async expression => {
    const r = await send('Runtime.evaluate', {expression, awaitPromise: true, returnByValue: true});
    if (r.result?.exceptionDetails) throw new Error(r.result.exceptionDetails.exception?.description || r.result.exceptionDetails.text);
    return r.result?.result?.value;
  };
  await send('Runtime.enable'); await send('Page.enable');
  await send('Emulation.setDeviceMetricsOverride', {width, height, deviceScaleFactor: 1, mobile: false});
  const shot = async (format = 'jpeg') => Buffer.from((await send('Page.captureScreenshot', {format, quality: 92})).result.data, 'base64');
  const mouse = (type, x, y, down = false) => send('Input.dispatchMouseEvent', {type, x, y, button: down || type !== 'mouseMoved' ? 'left' : 'none', buttons: down ? 1 : 0, clickCount: 1});
  const close = async () => { try { ws.close(); } catch {} chrome.kill(); await sleep(500); };
  return {send, ev, shot, mouse, logs, close};
}

// An ffmpeg that takes JPEG or PNG frames on stdin at a fixed rate and writes an H.264 file the Mac and the web play.
import {spawn as spawnProcess} from 'node:child_process';
export function encoder(file, {fps = 30, crf = 18} = {}) {
  const ff = spawnProcess('ffmpeg', ['-loglevel', 'error', '-y', '-f', 'image2pipe', '-framerate', String(fps), '-i', '-', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-crf', String(crf), '-movflags', '+faststart', file], {stdio: ['pipe', 'inherit', 'inherit']});
  const done = new Promise((resolve, reject) => ff.on('close', code => code === 0 ? resolve() : reject(new Error(`ffmpeg exited ${code} for ${file}`))));
  return {
    write: buffer => new Promise(r => ff.stdin.write(buffer) ? r() : ff.stdin.once('drain', r)),
    end: () => { ff.stdin.end(); return done; },
  };
}
