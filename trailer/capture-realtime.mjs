// Concept C (docs/TRAILER.md): one real-time take in the real editor. A screencast of our own headless Chrome, every frame placed by its own
// timestamp, so the clip lasts exactly as long as the take did. A clock badge in the corner (added by the capture, like the pointer) shows it.
//   node trailer/capture-realtime.mjs --server http://127.0.0.1:<yours> --port <cdp> --out <file.mp4> [--world desert]
// Prints the delivered frame rate, the take's wall-clock length, and how many canvas pixels the Size drag changed.
import {browser, encoder, sleep} from './cdp.mjs';
import {dirname, join} from 'node:path';

const args = process.argv.slice(2);
const opt = (name, fallback) => { const i = args.indexOf(name); return i >= 0 ? args.splice(i, 2)[1] : fallback; };
const server = opt('--server', '').replace(/\/+$/, ''), port = Number(opt('--port', 0)), out = opt('--out', ''), world = opt('--world', 'desert');
if (!server || !port || !out || /:8801\b/.test(server)) { console.error('usage: --server <your own editor> --port <cdp> --out <file.mp4> (never the owner\'s 8801)'); process.exit(2); }
const VW = 1600, VH = 900, FPS = 30;
const b = await browser({port, width: VW, height: VH, profile: join(dirname(out), `profile-rt-${Date.now()}`)});
const frames = [];
let px = 640, py = 450, down = false;
try {
  await b.send('Page.navigate', {url: `${server}/?biome=${world}&scratch=trailer-rt-${Date.now()}&gpuMB=1024&heapMB=1536`});
  for (let i = 0; i < 400; i++) { if (await b.ev(`!!window.sculptCanvas && !document.getElementById('editor').disabled`).catch(() => false)) break; await sleep(300); }
  await b.ev('sculptCanvas.idle()'); await b.ev('sculptCanvas.zoom(1, {x: 760, y: 560}); true'); await sleep(800);
  const tool = name => b.ev(`document.querySelector('[data-tool="${name}"]').click(); document.activeElement?.blur?.(); true`);
  const move = async (x, y) => { px = x; py = y; await b.ev(`document.getElementById('trailer-pointer').style.transform='translate(${x}px,${y}px)'; true`); await b.mouse('mouseMoved', x, y, down); };
  // Real time: the pointer glides over `ms`, a step a display frame.
  const glide = async (x, y, ms = 500) => { const x0 = px, y0 = py, t0 = Date.now(); for (;;) { const t = Math.min(1, (Date.now() - t0) / ms), e = t * t * (3 - 2 * t); await move(x0 + (x - x0) * e, y0 + (y - y0) * e); if (t >= 1) break; await sleep(16); } };
  const click = async (x, y) => { await glide(x, y); await b.mouse('mousePressed', x, y, true); await sleep(60); await b.mouse('mouseReleased', x, y, false); };
  const drag = async (points, ms) => { await glide(...points[0]); down = true; await b.mouse('mousePressed', px, py, true); const t0 = Date.now(), n = points.length - 1;
    for (;;) { const u = Math.min(1, (Date.now() - t0) / ms) * n, i = Math.min(n - 1, Math.floor(u)), f = u - i; await move(points[i][0] + (points[i + 1][0] - points[i][0]) * f, points[i][1] + (points[i + 1][1] - points[i][1]) * f); if (u >= n) break; await sleep(16); }
    down = false; await b.mouse('mouseReleased', px, py, false); };
  const curve = (pts, n = 40) => { const P = i => pts[Math.max(0, Math.min(pts.length - 1, i))], out = [];
    for (let i = 0; i < pts.length - 1; i++) for (let s = 0; s < n / (pts.length - 1); s++) { const t = s / (n / (pts.length - 1)), p0 = P(i - 1), p1 = P(i), p2 = P(i + 1), p3 = P(i + 2);
      out.push([0, 1].map(k => .5 * (2 * p1[k] + (-p0[k] + p2[k]) * t + (2 * p0[k] - 5 * p1[k] + 4 * p2[k] - p3[k]) * t * t + (-p0[k] + 3 * p1[k] - 3 * p2[k] + p3[k]) * t * t * t))); }
    out.push(pts.at(-1)); return out; };
  const canvasPixels = () => b.ev(`(() => { const c = document.getElementById('terrain'), d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data; window.__px = window.__px || []; window.__px.push(d); return d.length; })()`);
  const changed = () => b.ev(`(() => { const [a, z] = window.__px.slice(-2); let n = 0; for (let i = 0; i < a.length; i += 4) if (Math.abs(a[i] - z[i]) + Math.abs(a[i + 1] - z[i + 1]) + Math.abs(a[i + 2] - z[i + 2]) > 24) n++; return n; })()`);

  // Warm up outside the take: draw a butte and undo it, so shader compilation is not in the clip.
  await b.ev(`(() => { const d = document.createElement('div'); d.id = 'trailer-pointer'; d.style.cssText = 'position:fixed;left:0;top:0;width:24px;height:34px;pointer-events:none;z-index:2147483647';
    d.innerHTML = '<svg width="24" height="34" viewBox="0 0 18 27"><path d="M1 1v21l5-5 4 9 4-2-4-9h7z" fill="#fff" stroke="#000" stroke-width="1.4" stroke-linejoin="round"/></svg>'; document.body.appendChild(d); return true; })()`);
  await tool('butte'); await click(700, 500); await b.ev('sculptCanvas.idle()'); await sleep(1500);
  await b.ev(`document.getElementById('undo').click(); true`); await b.ev('sculptCanvas.idle()'); await sleep(1500);

  // The clock badge, then the take.
  await b.ev(`(() => { const d = document.createElement('div'); d.id = 'trailer-clock'; d.style.cssText = 'position:fixed;left:72px;top:58px;padding:6px 12px;border-radius:6px;background:rgba(0,0,0,.6);color:#fff;font:500 16px Helvetica Neue,Helvetica,Arial;z-index:2147483646;pointer-events:none';
    document.body.appendChild(d); const t0 = performance.now(); const tick = () => { const s = (performance.now() - t0) / 1000; d.textContent = '● Real time  ' + Math.floor(s / 60) + ':' + (s % 60).toFixed(1).padStart(4, '0'); requestAnimationFrame(tick); }; tick(); return true; })()`);
  b.on('Page.screencastFrame', p => { frames.push({ts: p.metadata.timestamp, data: Buffer.from(p.data, 'base64')}); b.send('Page.screencastFrameAck', {sessionId: p.sessionId}); });
  await b.send('Page.startScreencast', {format: 'jpeg', quality: 85, maxWidth: VW, maxHeight: VH, everyNthFrame: 1});
  const wall0 = Date.now();
  await sleep(800);
  await tool('butte'); await click(520, 430); await sleep(1600);
  await tool('hoodoos'); await click(860, 640); await sleep(1600);
  await tool('grayDome'); await click(1080, 300); await sleep(1600);
  // a low meandering ridge across the front, drawn as a hand would: a smooth curve
  await tool('hill'); await drag(curve([[300, 760], [480, 725], [700, 775], [900, 745]]), 1400);   // clear of the minimap (bottom left), which pans the view await sleep(2000);
  // select the butte and widen it with Size
  await tool('move'); await click(520, 420); await sleep(700); await canvasPixels();
  const r = await b.ev(`(() => { const e = document.getElementById('diameter'), r = e.parentElement.getBoundingClientRect(); return [r.x, r.y, r.width, r.height, +e.value, +e.min, +e.max]; })()`);
  if (r) { const [x, y, w, h, v0, lo, hi] = r, at = v => x + w * (v - lo) / (hi - lo), to = Math.min(hi, Math.round(v0 * 1.5)); await glide(at(v0), y + h / 2, 400); down = true; const t0 = Date.now();
    for (;;) { const u = Math.min(1, (Date.now() - t0) / 1400), e = u * u * (3 - 2 * u), v = Math.round(v0 + (to - v0) * e); await move(at(v), y + h / 2);
      await b.ev(`(() => { const e = document.getElementById('diameter'); e.value = ${v}; e.dispatchEvent(new Event('input', {bubbles: true})); return true; })()`); if (u >= 1) break; await sleep(30); }
    await b.ev(`document.getElementById('diameter').dispatchEvent(new Event('change', {bubbles: true})); true`); down = false; }
  await glide(700, 500, 400); await sleep(2000); await canvasPixels();
  const sizeChanged = await changed();
  // Export, once the editor allows it (the Time pass after the last edit): the wait is part of the take
  for (let i = 0; i < 200 && await b.ev(`document.getElementById('map-export').disabled`); i++) await sleep(100);
  const e = await b.ev(`(() => { const r = document.getElementById('open-export').getBoundingClientRect(); return [r.x + r.width / 2, r.y + r.height / 2]; })()`);
  await click(e[0], e[1]); await sleep(4500);
  const wall = (Date.now() - wall0) / 1000;
  await b.send('Page.stopScreencast'); await sleep(300);
  // Constant 30 fps from the frames' own timestamps: each tick shows the newest frame at or before it.
  const t0 = frames[0].ts, last = frames.at(-1).ts - t0, enc = encoder(out, {fps: FPS});
  for (let k = 0, j = 0; k / FPS <= last; k++) { while (j + 1 < frames.length && frames[j + 1].ts - t0 <= k / FPS) j++; await enc.write(frames[j].data); }
  await enc.end();
  console.log(JSON.stringify({frames: frames.length, seconds: +last.toFixed(2), wallSeconds: +wall.toFixed(2), deliveredFps: +(frames.length / last).toFixed(1), sizeDragChangedPixels: sizeChanged, console: b.logs.slice(0, 4)}));
} finally { await b.close(); }
