// The end card's logo from a map save (docs/TRAILER.md, "End card"): the save opens in the real editor through its own Open (the #file
// input), so its materials, rocks, tools, world settings and Time all come with it; the picture is the editor's canvas once weathering is
// ready, with the navigator, the zoom bar and the editing overlay hidden. Writes a PNG (1280x616 by default) that cuts.html fits above
// the end card's lines.
//   node trailer/logo-from-save.mjs --server http://127.0.0.1:<yours> --port <cdp> --save trailer/logo-terra.json --out <dir>/logo/final.png
//     [--zoom 0.42] [--center 2195,1900] [--size 1280x616]
// --center is in map pixels (where the view centers); the default is the middle of the save's shapes.
import {browser, sleep} from './cdp.mjs';
import {mkdirSync, readFileSync, writeFileSync} from 'node:fs';
import {dirname, join, resolve} from 'node:path';

const args = process.argv.slice(2);
const opt = (name, fallback) => { const i = args.indexOf(name); return i >= 0 ? args.splice(i, 2)[1] : fallback; };
const server = opt('--server', '').replace(/\/+$/, ''), port = Number(opt('--port', 0)), save = resolve(opt('--save', '')), out = resolve(opt('--out', ''));
const zoom = Number(opt('--zoom', 0.42)), [OW, OH] = opt('--size', '1280x616').split('x').map(Number);
if (!server || !port || !save || !out || /:8801\b/.test(server)) { console.error('usage: --server <your own editor> --port <cdp> --save <map.json> --out <file.png> (never the owner\'s 8801)'); process.exit(2); }
// The middle of the shapes' points (each through its frame), unless --center says otherwise.
const centreArg = opt('--center', ''), centre = centreArg ? centreArg.split(',').map(Number) : (() => {
  const map = JSON.parse(readFileSync(save, 'utf8')), xs = [], ys = [];
  for (const n of map.nodes ?? []) { const f = n.frame ?? [1, 0, 0, 1, 0, 0]; for (const p of n.points ?? []) { xs.push(f[0] * p.x + f[2] * p.y + f[4]); ys.push(f[1] * p.x + f[3] * p.y + f[5]); } }
  return [(Math.min(...xs) + Math.max(...xs)) / 2, (Math.min(...ys) + Math.max(...ys)) / 2];
})();
const VW = OW + 460, VH = OH + 120;   // room for the rail, the panel, the header and the footer around the canvas
mkdirSync(dirname(out), {recursive: true});
const b = await browser({port, width: VW, height: VH, profile: join(dirname(out), `profile-logo-${Date.now()}`)});
try {
  await b.send('Page.navigate', {url: `${server}/?scratch=trailer-logo-${Date.now()}&gpuMB=1536&heapMB=2048`});
  for (let i = 0; i < 400; i++) { if (await b.ev(`!!window.sculptCanvas && !document.getElementById('editor').disabled`).catch(() => false)) break; await sleep(300); }
  await b.send('DOM.enable');
  const root = (await b.send('DOM.getDocument')).result.root.nodeId, input = (await b.send('DOM.querySelector', {nodeId: root, selector: '#file'})).result.nodeId;
  await b.send('DOM.setFileInputFiles', {nodeId: input, files: [save]});
  for (let i = 0; i < 200 && !/Loaded/.test(await b.ev(`document.getElementById('status').textContent`)); i++) await sleep(250);
  await b.ev(`(() => { const s = document.createElement('style'); s.textContent = '.map-navigator, .map-zoom, #overlay, #map-view-note, #passability-legend { visibility: hidden !important }'; document.head.appendChild(s); return true; })()`);
  await b.ev(`sculptCanvas.zoom(${zoom}, {x: ${centre[0]}, y: ${centre[1]}}); true`);
  // The final picture: every visible tile drawn, then weathering ready (idle() does not wait for the Time pass), then drawn again.
  for (let pass = 0; pass < 2; pass++) {
    await b.ev('sculptCanvas.idle()');
    for (let i = 0; i < 600 && !(await b.ev('!!window.sculptRegion?.canExport?.()').catch(() => false)); i++) await sleep(250);
    await sleep(1500);
  }
  const r = await b.ev(`(() => { const r = document.getElementById('terrain').getBoundingClientRect(); return [r.x, r.y, r.width, r.height]; })()`);
  // The middle of the canvas at the output's size (the view's centre is the canvas's centre).
  const clip = {x: r[0] + (r[2] - OW) / 2, y: r[1] + (r[3] - OH) / 2, width: OW, height: OH, scale: 1};
  if (clip.x < r[0] || clip.y < r[1]) throw new Error(`the canvas (${r.map(Math.round).join(' ')}) is smaller than ${OW}x${OH}`);
  const png = Buffer.from((await b.send('Page.captureScreenshot', {format: 'png', clip})).result.data, 'base64');
  writeFileSync(out, png);
  console.log(JSON.stringify({out, centre: centre.map(Math.round), zoom, canvas: r.map(Math.round), logs: b.logs.slice(0, 4)}));
} finally { await b.close(); }
