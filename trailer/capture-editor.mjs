// Capture the real editor for the trailer (docs/TRAILER.md shots 7-8): draw on a few worlds, drag a slider, open the material graph.
//   node trailer/capture-editor.mjs --server http://127.0.0.1:<yours> --port <cdp> --out <dir> [--worlds green,desert,ice,lava]
// Writes <dir>/<world>.mp4 for each world (and materials.mp4). Frames are taken after each input step ("stop motion"), so the clips play faster
// than real time. Headless Chrome draws no mouse pointer, so the capture adds a pointer element to the page; nothing else in the page changes.
import {browser, encoder, sleep} from './cdp.mjs';
import {mkdirSync} from 'node:fs';
import {join} from 'node:path';

const args = process.argv.slice(2);
const opt = (name, fallback) => { const i = args.indexOf(name); return i >= 0 ? args.splice(i, 2)[1] : fallback; };
const server = opt('--server', '').replace(/\/+$/, ''), port = Number(opt('--port', 0)), out = opt('--out', ''), worlds = opt('--worlds', 'green,desert,ice,lava').split(',');
if (!server || !port || !out || /:8801\b/.test(server)) { console.error('usage: --server <your own editor> --port <cdp> --out <dir> (never the owner\'s 8801)'); process.exit(2); }
mkdirSync(out, {recursive: true});
const VW = 1600, VH = 900;

const POINTER = `(() => { if (document.getElementById('trailer-pointer')) return true; const d = document.createElement('div'); d.id = 'trailer-pointer';
  d.style.cssText = 'position:fixed;left:0;top:0;width:24px;height:34px;pointer-events:none;z-index:2147483647;transform:translate(-100px,-100px)';
  d.innerHTML = '<svg width="24" height="34" viewBox="0 0 18 27"><path d="M1 1v21l5-5 4 9 4-2-4-9h7z" fill="#fff" stroke="#000" stroke-width="1.4" stroke-linejoin="round"/></svg>';
  document.body.appendChild(d); return true; })()`;

async function clip(name, url, script) {
  const b = await browser({port, width: VW, height: VH, profile: join(out, `profile-${name}-${Date.now()}`)});
  const enc = encoder(join(out, `${name}.mp4`));
  let frames = 0, px = -100, py = -100, down = false;
  const frame = async () => { await enc.write(await b.shot()); frames++; };
  const pointer = async (x, y) => { px = x; py = y; await b.ev(`document.getElementById('trailer-pointer').style.transform='translate(${x}px,${y}px)'; true`); await b.mouse('mouseMoved', x, y, down); };
  const hold = async (n, ms = 60) => { for (let i = 0; i < n; i++) { await sleep(ms); await frame(); } };
  // Glide the pointer to (x, y) over n frames; with press, drag from where it is.
  const glide = async (x, y, n = 15) => { const x0 = px, y0 = py; for (let i = 1; i <= n; i++) { const t = i / n, e = t * t * (3 - 2 * t); await pointer(x0 + (x - x0) * e, y0 + (y - y0) * e); await sleep(25); await frame(); } };
  const press = async () => { down = true; await b.mouse('mousePressed', px, py, true); };
  const release = async () => { down = false; await b.mouse('mouseReleased', px, py, false); };
  const path = async (points, n = 12) => { await glide(...points[0], 12); await press(); for (const p of points.slice(1)) await glide(...p, n); await release(); };
  const click = async (selector) => { const r = await b.ev(`(() => { const e = document.querySelector(${JSON.stringify(selector)}); if (!e) return null; const r = e.getBoundingClientRect(); return [r.x + r.width / 2, r.y + r.height / 2]; })()`); if (!r) return false; await glide(r[0], r[1], 10); await b.mouse('mousePressed', px, py, true); await b.mouse('mouseReleased', px, py, false); await hold(2); return true; };
  const tool = async name => { await b.ev(`document.querySelector('[data-tool="${name}"]').click(); document.activeElement?.blur?.(); true`); await hold(3); };
  // A slider ramped from its value to `to` through the page's own input events, the pointer riding along its bar.
  const slide = async (id, to, n = 30) => {
    const r = await b.ev(`(() => { const e = document.getElementById(${JSON.stringify(id)}); if (!e) return null; const r = e.parentElement.getBoundingClientRect(); return [r.x, r.y, r.width, r.height, +e.value, +e.min, +e.max]; })()`);
    if (!r) return false; const [x, y, w, h, v0, lo, hi] = r, at = v => x + w * (v - lo) / (hi - lo);
    await glide(at(v0), y + h / 2, 10); down = true;
    for (let i = 1; i <= n; i++) { const t = i / n, e = t * t * (3 - 2 * t), v = Math.round(v0 + (to - v0) * e); await pointer(at(v), y + h / 2);
      await b.ev(`(() => { const e = document.getElementById(${JSON.stringify(id)}); e.value = ${v}; e.dispatchEvent(new Event('input', {bubbles: true})); return true; })()`); await sleep(40); await frame(); }
    await b.ev(`document.getElementById(${JSON.stringify(id)}).dispatchEvent(new Event('change', {bubbles: true})); true`); down = false; return true;
  };
  const box = selector => b.ev(`(() => { const e = document.querySelector(${JSON.stringify(selector)}); if (!e || !e.offsetParent) return null; const r = (e.closest('.slider, label, .row') || e).getBoundingClientRect(); return [r.x, r.y, r.width, r.height]; })()`);
  try {
    await b.send('Page.navigate', {url});
    for (let i = 0; i < 400; i++) { if (await b.ev(`!!window.sculptCanvas && !document.getElementById('editor').disabled`).catch(() => false)) break; await sleep(300); }
    await b.ev('sculptCanvas.idle()'); await b.ev('sculptCanvas.zoom(0.6, {x: 1024, y: 880}); true'); await sleep(1200); await b.ev(POINTER);
    await pointer(640, 450);
    await script({b, frame, hold, glide, path, click, box, press, release, pointer, tool, slide});
    if (b.logs.length) console.error(`${name}: console:`, b.logs.slice(0, 4).join(' | '));
  } finally { await enc.end(); await b.close(); }
  console.log(`${name}: ${frames} frames`);
}

const tools = b => b.ev(`[...document.querySelectorAll('.tool-groups [data-tool]')].map(e => e.dataset.tool)`);
const SHAPES = {green: ['plateau', 'river'], desert: ['escarpment', 'river'], ice: ['mountain', 'deep'], lava: ['mountain', 'river']};

for (const world of worlds) {
  await clip(world, `${server}/?biome=${world}&scratch=trailer-${world}-${Date.now()}&gpuMB=1024&heapMB=1536`, async ({b, hold, path, click, tool, slide}) => {
    const have = await tools(b), [first, second] = SHAPES[world] ?? [];
    const shape = have.includes(first) ? first : have.find(t => !['move', 'landform'].includes(t)), water = have.includes(second) ? second : have.find(t => ['river', 'deep', 'shallow'].includes(t));
    await hold(8);
    await tool(shape);
    await path([[440, 380], [560, 350], [700, 370], [820, 340]], 14);
    await hold(30);
    if (water) {
      await tool(water);
      await path([[120, 720], [380, 680], [640, 730], [900, 690], [1220, 720]], 10);
      await hold(30);
    }
    if (world === 'green') {   // shot 8: Height on the selected shape, then the material graph
      await tool('move');
      await path([[630, 330], [631, 330]], 1); await hold(6);
      if (await slide('lf-elevation', 290, 36)) await hold(26);
      if (await clickText(b, 'Materials')) await hold(40, 80);
    }
  });
}

async function clickText(b, text) {
  return b.ev(`(() => { const e = [...document.querySelectorAll('button, a, [role=tab]')].find(e => e.textContent.trim() === ${JSON.stringify(text)} && e.offsetParent); if (!e) return false; e.click(); return true; })()`);
}
