// Concept C (docs/TRAILER.md): one real-time take in the real editor on Green Planet. Shapes are dragged (Mountain, Crater, Deep water, Hill),
// metal and trees are placed, and the game map is built. The two starts (and the far start's metal) are set before the take. A screencast of our own headless Chrome, every frame placed by its own timestamp, so
// the clip lasts exactly as long as the take did; a clock badge in the corner (added by the capture, like the pointer) shows it.
//   node trailer/capture-realtime.mjs --server http://127.0.0.1:<yours> --port <cdp> --out <file.mp4> [--ufo <dir>] [--name 'Terra Valley']
// After the take the build finishes off camera and, with --ufo, its .ufo is saved there (for Nanolathe). Prints the delivered frame rate,
// the take's wall-clock length and the export's tile count.
import {browser, encoder, sleep} from './cdp.mjs';
import {mkdirSync, writeFileSync} from 'node:fs';
import {dirname, join} from 'node:path';

const args = process.argv.slice(2);
const opt = (name, fallback) => { const i = args.indexOf(name); return i >= 0 ? args.splice(i, 2)[1] : fallback; };
const server = opt('--server', '').replace(/\/+$/, ''), port = Number(opt('--port', 0)), out = opt('--out', ''), ufo = opt('--ufo', ''), name = opt('--name', 'Terra Valley');
if (!server || !port || !out || /:8801\b/.test(server)) { console.error('usage: --server <your own editor> --port <cdp> --out <file.mp4> (never the owner\'s 8801)'); process.exit(2); }
const VW = 1600, VH = 900, FPS = 30;
// Where things go. At the take's view (zoom 0.75 on 900,760) a screen point is the map pixel ((x + 7) / 0.75, (y + 110) / 0.75).
const START1 = '1130, 880', START2 = '1792, 1792', METAL = [[788, 602], [840, 622], [893, 602]], FAR_METAL = [[106, 106], [114, 103], [110, 113]];
const b = await browser({port, width: VW, height: VH, profile: join(dirname(out), `profile-rt-${Date.now()}`)});
const frames = [];
let px = 640, py = 450, down = false;
try {
  await b.send('Page.navigate', {url: `${server}/?biome=green&scratch=trailer-rt-${Date.now()}&gpuMB=1024&heapMB=1536`});
  for (let i = 0; i < 400; i++) { if (await b.ev(`!!window.sculptCanvas && !document.getElementById('editor').disabled`).catch(() => false)) break; await sleep(300); }
  await b.ev('sculptCanvas.idle()'); await b.ev('sculptCanvas.zoom(0.75, {x: 900, y: 760}); true'); await sleep(800);
  await b.ev(`(() => { const e = document.getElementById('map-name'); e.value = ${JSON.stringify(name)}; e.dispatchEvent(new Event('input', {bubbles: true})); e.dispatchEvent(new Event('change', {bubbles: true})); return true; })()`);
  const press = selector => b.ev(`(() => { const e = document.querySelector(${JSON.stringify(selector)}); e.click(); document.activeElement?.blur?.(); return true; })()`);
  const tool = name => press(`[data-tool="${name}"]`);
  const move = async (x, y) => { px = x; py = y; await b.ev(`document.getElementById('trailer-pointer').style.transform='translate(${x}px,${y}px)'; true`); await b.mouse('mouseMoved', x, y, down); };
  // Real time: the pointer glides over `ms`, a step a display frame.
  const glide = async (x, y, ms = 280) => { const x0 = px, y0 = py, t0 = Date.now(); for (;;) { const t = Math.min(1, (Date.now() - t0) / ms), e = t * t * (3 - 2 * t); await move(x0 + (x - x0) * e, y0 + (y - y0) * e); if (t >= 1) break; await sleep(16); } };
  const click = async (x, y, ms) => { await glide(x, y, ms); await b.mouse('mousePressed', x, y, true); await sleep(40); await b.mouse('mouseReleased', x, y, false); };
  // After a shape: until the view is drawn (at most `max`), then a short look at it. Real time either way; nothing is retimed afterwards.
  const settle = async (hold = 250, max = 1100) => { await Promise.race([b.ev('sculptCanvas.idle().then(() => true)'), sleep(max)]); await sleep(hold); };
  const clickOn = async selector => { const r = await b.ev(`(() => { const r = document.querySelector(${JSON.stringify(selector)}).getBoundingClientRect(); return [r.x + r.width / 2, r.y + r.height / 2]; })()`); await click(r[0], r[1]); };
  const drag = async (points, ms) => { await glide(...points[0]); down = true; await b.mouse('mousePressed', px, py, true); const t0 = Date.now(), n = points.length - 1;
    for (;;) { const u = Math.min(1, (Date.now() - t0) / ms) * n, i = Math.min(n - 1, Math.floor(u)), f = u - i; await move(points[i][0] + (points[i + 1][0] - points[i][0]) * f, points[i][1] + (points[i + 1][1] - points[i][1]) * f); if (u >= n) break; await sleep(16); }
    down = false; await b.mouse('mouseReleased', px, py, false); };
  // A hand's stroke: a smooth curve through a few points (Catmull-Rom).
  const curve = (pts, n = 48) => { const P = i => pts[Math.max(0, Math.min(pts.length - 1, i))], out = [], per = Math.ceil(n / (pts.length - 1));
    for (let i = 0; i < pts.length - 1; i++) for (let s = 0; s < per; s++) { const t = s / per, p0 = P(i - 1), p1 = P(i), p2 = P(i + 1), p3 = P(i + 2);
      out.push([0, 1].map(k => .5 * (2 * p1[k] + (-p0[k] + p2[k]) * t + (2 * p0[k] - 5 * p1[k] + 4 * p2[k] - p3[k]) * t * t + (-p0[k] + 3 * p1[k] - 3 * p2[k] + p3[k]) * t * t * t))); }
    out.push(pts.at(-1)); return out; };

  // Warm up outside the take: draw a hill and undo it, so shader compilation is not in the clip.
  await b.ev(`(() => { const d = document.createElement('div'); d.id = 'trailer-pointer'; d.style.cssText = 'position:fixed;left:0;top:0;width:24px;height:34px;pointer-events:none;z-index:2147483647';
    d.innerHTML = '<svg width="24" height="34" viewBox="0 0 18 27"><path d="M1 1v21l5-5 4 9 4-2-4-9h7z" fill="#fff" stroke="#000" stroke-width="1.4" stroke-linejoin="round"/></svg>'; document.body.appendChild(d); return true; })()`);
  await tool('hill'); await drag([[600, 450], [700, 430]], 300); await b.ev('sculptCanvas.idle()'); await sleep(1500);
  await press('#undo'); await b.ev('sculptCanvas.idle()'); await sleep(1500);

  // The two starts, set before the take: start 1 on the open ground between the lake and the crater, a short walk from the metal placed
  // in the take; start 2 in the far corner with its own metal (off camera), so each commander builds on its own deposits. Map pixels;
  // deposits in 16-pixel cells.
  await b.ev(`(() => { const f = sculptMap.features; return f.moveStart(0, ${START1}) && f.moveStart(1, ${START2}) && ${JSON.stringify(FAR_METAL)}.every(([x, z]) => f.addFeature('deposit', x, z)); })()`) || (() => { throw new Error('could not set the starts and the far metal'); })();

  // The clock badge, then the take.
  await b.ev(`(() => { const d = document.createElement('div'); d.id = 'trailer-clock'; d.style.cssText = 'position:fixed;left:72px;top:58px;padding:6px 12px;border-radius:6px;background:rgba(0,0,0,.6);color:#fff;font:500 16px Helvetica Neue,Helvetica,Arial;z-index:2147483646;pointer-events:none';
    document.body.appendChild(d); const t0 = performance.now(); const tick = () => { const s = (performance.now() - t0) / 1000; d.textContent = '● Real time  ' + Math.floor(s / 60) + ':' + (s % 60).toFixed(1).padStart(4, '0'); requestAnimationFrame(tick); }; tick(); return true; })()`);
  b.on('Page.screencastFrame', p => { frames.push({ts: p.metadata.timestamp, data: Buffer.from(p.data, 'base64')}); b.send('Page.screencastFrameAck', {sessionId: p.sessionId}); });
  await b.send('Page.startScreencast', {format: 'jpeg', quality: 85, maxWidth: VW, maxHeight: VH, everyNthFrame: 1});
  const wall0 = Date.now();
  await sleep(400);
  // A map laid out as land is: a mountain range arching across the back, foothills at its foot, a lake winding through the low ground, a
  // crater alone on the open plain (nothing within reach of its craterlets), knolls at the front, metal by start 1, trees on the shores.
  await tool('mountain'); await drag(curve([[320, 255], [470, 210], [650, 240], [830, 205], [970, 245]]), 1000); await settle();
  await tool('hill'); await drag(curve([[400, 370], [490, 350], [560, 365]]), 420); await settle(150, 700);
  await drag(curve([[750, 355], [830, 340], [890, 350]]), 420); await settle();
  await tool('deep'); await drag(curve([[290, 610], [420, 570], [560, 615], [690, 595]]), 850); await settle();
  await tool('crater'); await drag([[1080, 500], [1130, 545]], 350); await settle();
  await tool('knollField'); await click(880, 815, 300); await settle(150, 800);
  // Metal round start 1, then trees along the lake's shores
  await press('#feature-tool'); await sleep(150); await press('[data-feature-kind="deposit"]');
  for (const [x, y] of METAL) { await click(x, y, 160); await sleep(50); }
  await press('[data-feature-kind="tree"]');
  for (const [x, y] of [[290, 515], [335, 500], [380, 512], [610, 525], [655, 512], [460, 690], [510, 700], [240, 560]]) { await click(x, y, 110); await sleep(30); }
  await sleep(500);
  // Build the game map
  await clickOn('#open-export'); await sleep(450);
  for (let i = 0; i < 300 && await b.ev(`document.getElementById('map-export').disabled`); i++) await sleep(100);
  await clickOn('#map-export'); await sleep(2500);
  const wall = (Date.now() - wall0) / 1000;
  await b.send('Page.stopScreencast'); await sleep(300);
  // Constant 30 fps from the frames' own timestamps: each tick shows the newest frame at or before it.
  const t0 = frames[0].ts, last = frames.at(-1).ts - t0, enc = encoder(out, {fps: FPS});
  for (let k = 0, j = 0; k / FPS <= last; k++) { while (j + 1 < frames.length && frames[j + 1].ts - t0 <= k / FPS) j++; await enc.write(frames[j].data); }
  await enc.end();
  // The build finishes off camera; its .ufo comes back from the pane's own download link.
  let state = '';
  for (let i = 0; i < 1200 && !(await b.ev(`!!document.querySelector('#map-download a')`)); i++) { await sleep(250); state = await b.ev(`document.getElementById('map-export-state').textContent`); }
  state = await b.ev(`document.getElementById('map-export-state').textContent`);
  let saved = null;
  if (ufo) {
    mkdirSync(ufo, {recursive: true});
    const file = await b.ev(`document.querySelector('#map-download a').download`);
    const size = await b.ev(`(async () => { window.__ufo = new Uint8Array(await (await fetch(document.querySelector('#map-download a').href)).arrayBuffer()); return window.__ufo.length; })()`);
    const parts = [];
    for (let o = 0; o < size; o += 1 << 20) parts.push(Buffer.from(await b.ev(`(() => { let s = ''; const a = window.__ufo.subarray(${o}, ${o + (1 << 20)}); for (let i = 0; i < a.length; i += 8192) s += String.fromCharCode(...a.subarray(i, i + 8192)); return btoa(s); })()`), 'base64'));
    saved = join(ufo, file); writeFileSync(saved, Buffer.concat(parts));
  }
  // Dry and level where the commanders land and build: the lowest and highest game height round each start and deposit (the levels line
  // gives the sea).
  const sites = await b.ev(`(async () => { const f = sculptMap.features.serialize(), g = sculptMap.geometry, c = await sculptCanvas.sampleHeights(), h = c.heights ?? c;
    // the lowest and highest cell height within 48 pixels of a point (the game's 16-pixel cells)
    const near = (x, z) => { const v = []; for (let j = -3; j <= 3; j++) for (let i = -3; i <= 3; i++) v.push(h[(Math.floor(z / 16) + j) * g.widthCells + Math.floor(x / 16) + i]); return [Math.min(...v), Math.max(...v)]; };
    return {levels: document.getElementById('levels').textContent, starts: f.starts.map(s => [s.x, s.z, ...near(s.x, s.z)]), deposits: f.features.filter(p => p.kind === 'deposit').map(p => [p.x * 16 + 16, p.z * 16 + 16, ...near(p.x * 16 + 16, p.z * 16 + 16)])}; })()`);
  console.log(JSON.stringify({sites, frames: frames.length, seconds: +last.toFixed(2), wallSeconds: +wall.toFixed(2), deliveredFps: +(frames.length / last).toFixed(1), export: state.slice(0, 200), ufo: saved, console: b.logs.slice(0, 4)}));
} finally { await b.close(); }
