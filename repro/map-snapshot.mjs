// A saved map is its own world (owner, 2026-11-19: "Each file can be its own world and won't change"): retuning a built-in world must not
// change a map saved before. This check saves a Green map with one hill, then for each part of Green's data in turn edits the served file
// (materials/green.json, defaults.json, textures.json), reopens the map and compares its save and a baked window, and puts the file back.
//   node repro/map-snapshot.mjs --server http://127.0.0.1:<yours> --port <cdp> [--out dir]
// The server must serve THIS worktree (it reloads JSON on request). The files are restored in a finally block; if the run is killed, run
// `git checkout materials/` before anything else. Prints one JSON line: for each retune whether the save and the pixels stayed the same.
// A retune marked `snapshot: false` (a part the map does not keep) is reported, not failed; a kept part that changes exits 1.
// Built from data and not kept: the toolbar's built-in buttons and their presets (new shapes only), rock recipes and material starting
// points (adding only), the feature generator's tables (new features only).
import {chromePath, chromeGpuFlags} from './chrome.mjs';
import {cdpPortFree} from './cdp-port.mjs';
import {spawn} from 'node:child_process';
import {mkdirSync, mkdtempSync, readFileSync, writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {dirname, join, resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {isDeepStrictEqual} from 'node:util';

const args = process.argv.slice(2), opt = k => args[args.indexOf(k) + 1];
const server = args.includes('--server') ? opt('--server') : '', port = Number(args.includes('--port') ? opt('--port') : 0);
if (!server || !Number.isInteger(port) || port < 1024) throw Error('Give your own --server and --port.');
const out = resolve(args.includes('--out') ? opt('--out') : mkdtempSync(join(tmpdir(), 'terraform-map-snapshot-'))); mkdirSync(out, {recursive: true});
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..'), file = name => join(root, 'materials', name);
const sleep = ms => new Promise(r => setTimeout(r, ms));
// Each retune edits one served file. `snapshot`: the map saves this part, so the map must not change.
const RETUNES = [
  {name: 'row defaults', file: 'green.json', snapshot: true, edit: g => { g.world.knobDefaults.coastRamp = .2; g.world.knobDefaults.looseSupply = .6; }},
  {name: 'engine defaults', file: 'green.json', snapshot: true, edit: g => { g.world.engineDefaults.terraceCalm = .8; }},
  {name: 'rock column', file: 'green.json', snapshot: true, edit: g => { g.world.column.sections[0].beds[0] = [4, .1, 0]; }},
  {name: 'role materials', file: 'green.json', snapshot: true, edit: g => { g.world.materials.slope = 'green-moss'; g.world.materials.rock = 'green-band'; }},
  {name: 'library material graph', file: 'textures.json', snapshot: true, edit: t => { const m = t['green-ground']; m.nodes.find(n => n.type === 'noise').params.size *= 3; }},
  {name: 'surface layers', file: 'defaults.json', snapshot: true, edit: d => { d.surface[1] = {...d.surface[1], name: 'Retuned cover'}; }},
  {name: 'material table', file: 'green.json', snapshot: true, edit: g => { g.material.rockSlope = .7; g.material.wetBand = 30; }},
  {name: 'placement table', file: 'green.json', snapshot: true, edit: g => { g.placement.rock.slope = .3; }},
  {name: 'water table', file: 'green.json', snapshot: true, edit: g => { g.water.shallowRGB = [200, 40, 40]; }},
];
await cdpPortFree(port);
const browser = spawn(chromePath, ['--headless=new', ...chromeGpuFlags, `--remote-debugging-port=${port}`, `--user-data-dir=${join(out, 'profile')}`, '--window-size=1440,900', '--no-first-run', 'about:blank'], {stdio: 'ignore'});
const originals = new Map();
let ws;
try {
  for (let i = 0; i < 100 && !ws; i++) { try { const tabs = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json(); ws = new WebSocket(tabs.find(t => t.type === 'page').webSocketDebuggerUrl); } catch {} if (!ws) await sleep(100); }
  await new Promise(r => ws.onopen = r);
  let id = 0; const pending = new Map(), errors = [];
  ws.onmessage = e => { const m = JSON.parse(e.data); if (m.id) { pending.get(m.id)?.(m); pending.delete(m.id); } if (m.method === 'Runtime.exceptionThrown') errors.push(m.params.exceptionDetails.exception?.description || m.params.exceptionDetails.text); };
  const send = (method, params = {}) => new Promise((res, rej) => { const n = ++id; pending.set(n, m => m.error ? rej(Error(JSON.stringify(m.error))) : res(m.result)); ws.send(JSON.stringify({id: n, method, params})); });
  const ev = async x => { const r = await send('Runtime.evaluate', {expression: x, awaitPromise: true, returnByValue: true}); if (r.exceptionDetails) throw Error(r.exceptionDetails.exception?.description || r.exceptionDetails.text); return r.result.value; };
  const ready = async () => { for (let i = 0; i < 1200; i++) { try { if (await ev(`!!window.sculptDebug&&!!window.sculptCanvas&&!!window.sculptRegion&&sculptRegion.ready()`)) { await ev('sculptCanvas.idle()'); return; } } catch {} await sleep(150); } throw Error('page not ready: ' + errors.join('\n')); };
  const image = () => ev(`(async()=>{const b=await sculptCanvas.debugBake({x:100,y:60,width:200,height:160},1),c=new OffscreenCanvas(b.width,b.height);c.getContext('2d').drawImage(b,0,0);b.close();return Array.from(c.getContext('2d').getImageData(0,0,c.width,c.height).data);})()`);
  const normal = s => ({...s, nodes: s.nodes.map(n => ({...n, hidden: Boolean(n.hidden)}))});
  await send('Runtime.enable'); await send('Page.enable');
  await send('Page.navigate', {url: `${server}/?biome=green&mapX=1&mapY=1&newMap=1&gpuMB=512`}); await ready();
  await ev(`(()=>{const w=document.getElementById('weather');if(w.checked)w.click();sculptDebug.scene([['hill',[[120,120],[260,170]],{card:{elevation:90}}]],{ground:true});return true;})()`); await ready();
  for (let i = 0; i < 50 && !await ev(`sculptDebug.savedMap().then(m=>m?.nodes?.length>0)`); i++) await sleep(100);
  const reopen = async () => { await send('Page.navigate', {url: `${server}/?gpuMB=512`}); await ready(); return {save: normal(await ev('sculptDebug.sketch()')), pixels: await image()}; };
  const base = await reopen(), results = {};
  for (const r of RETUNES) {
    const path = file(r.file); if (!originals.has(path)) originals.set(path, readFileSync(path, 'utf8'));
    const data = JSON.parse(originals.get(path)); r.edit(data); writeFileSync(path, JSON.stringify(data));
    try {
      const now = await reopen(), changed = Object.keys({...base.save, ...now.save}).filter(k => !isDeepStrictEqual(base.save[k], now.save[k]));
      results[r.name] = {snapshot: r.snapshot, saveSame: !changed.length, ...(changed.length ? {changed} : {}), pixelsSame: Buffer.from(base.pixels).equals(Buffer.from(now.pixels))};
    } finally { writeFileSync(path, originals.get(path)); }
  }
  const failed = Object.entries(results).filter(([, r]) => r.snapshot && !(r.saveSame && r.pixelsSame)).map(([name]) => name);
  console.log(JSON.stringify({results, failed, errors}));
  if (failed.length || errors.length) process.exitCode = 1;
} finally {
  for (const [path, text] of originals) writeFileSync(path, text);
  ws?.close(); browser.kill();
}
