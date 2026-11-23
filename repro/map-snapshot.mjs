// A saved map is its own world (owner, 2026-11-19: "Each file can be its own world and won't change"): retuning a built-in world must not
// change a map saved before. This check saves a Green map with one hill, then for each part of Green's data in turn edits the served file
// (materials/green.json, defaults.json, textures.json), reopens the map and compares its save and a baked window, and puts the file back.
//   node repro/map-snapshot.mjs --server http://127.0.0.1:<yours> --port <cdp> [--out dir]
// The server must serve THIS worktree (it reloads JSON on request). The files are restored in a finally block; if the run is killed, run
// `git checkout materials/` before anything else. Prints one JSON line: for each retune whether the save and the pixels stayed the same.
// Then it pulls a retune in on purpose (Apply look from the map's own world, its default) and checks the result draws as its reload does.
// A retune marked `snapshot: false` (a part the map does not keep) is reported, not failed; a kept part that changes exits 1.
// A saved map also opens when the browser cannot fetch its starter template.
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
  // Green's own layer list (world.surface, a copy of the shared stack plus its own layers since 2026-11-20); retuning the shared default
  // stack in defaults.json no longer reaches it, and the case tested nothing.
  {name: 'surface layers', file: 'green.json', snapshot: true, edit: g => { g.world.surface[1] = {...g.world.surface[1], name: 'Retuned cover'}; }},
  {name: 'material table', file: 'green.json', snapshot: true, edit: g => { g.material.rockSlope = .7; g.material.wetBand = 30; }},
  {name: 'placement table', file: 'green.json', snapshot: true, edit: g => { g.placement.rock.slope = .3; }},
  {name: 'water table', file: 'green.json', snapshot: true, edit: g => { g.water.shallowRGB = [200, 40, 40]; }},
  {name: 'rock type recipe', file: 'green.json', snapshot: true, edit: g => { Object.assign(g.world.rock.recipes.evad.knobs, {rockFace: 3, faceRock: 1, faceGrass: 0}); }},
  {name: 'template brushes', file: 'green.json', snapshot: true, edit: g => { g.world.tools.find(t=>t.id==='hill').label='Retuned hill'; }},
  {name: 'added highland role', file: 'green.json', snapshot: true, edit: g => { g.world.materials.high = 'green-moss'; }},
];
// A retune that changes no fresh map tests nothing: each must change a new map drawn the same way (`fresh`), or it is reported as vacuous.
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
  // idle() does not wait for the Time pass: bake once the map could be exported (weathering ready).
  const image = async () => { for (let i = 0; i < 300 && !await ev('sculptRegion.canExport()'); i++) await sleep(100); return bakeNow(); };
  const bakeNow = () => ev(`(async()=>{const b=await sculptCanvas.debugBake({x:100,y:60,width:200,height:160},1),c=new OffscreenCanvas(b.width,b.height);c.getContext('2d').drawImage(b,0,0);b.close();return Array.from(c.getContext('2d').getImageData(0,0,c.width,c.height).data);})()`);
  const normal = s => ({...s, nodes: s.nodes.map(n => ({...n, hidden: Boolean(n.hidden)}))});
  await send('Runtime.enable'); await send('Page.enable');
  await send('Page.navigate', {url: `${server}/?biome=green&mapX=1&mapY=1&newMap=1&gpuMB=512`}); await ready();
  await ev(`(()=>{const w=document.getElementById('weather');if(w.checked)w.click();sculptDebug.scene([['hill',[[120,120],[260,170]],{card:{elevation:90}}]],{ground:true});return true;})()`); await ready();
  for (let i = 0; i < 50 && !await ev(`sculptDebug.savedMap().then(m=>m?.nodes?.length>0)`); i++) await sleep(100);
  const reopen = async () => { await send('Page.navigate', {url: `${server}/?gpuMB=512`}); await ready(); return {save: normal(await ev('sculptDebug.sketch()')), pixels: await image()}; };
  const tab = await ev(`sessionStorage.getItem('terraform-tab-v1')`);
  // A new map with the same hill, in this tab, then the tab pointed back at the saved map (a newMap address reuses the tab's map id).
  const fresh = async () => {
    await ev(`sessionStorage.removeItem('terraform-tab-v1'),true`);
    await send('Page.navigate', {url: `${server}/?biome=green&mapX=1&mapY=1&newMap=1&gpuMB=512`}); await ready();
    await ev(`(()=>{const w=document.getElementById('weather');if(w.checked)w.click();sculptDebug.scene([['hill',[[120,120],[260,170]],{card:{elevation:90}}]],{ground:true});return true;})()`); await ready();
    const result = {save: normal(await ev('sculptDebug.sketch()')), pixels: await image()};
    await ev(`sessionStorage.setItem('terraform-tab-v1',${JSON.stringify(tab)}),true`);
    return result;
  };
  const differs = (a, b) => !Buffer.from(a.pixels).equals(Buffer.from(b.pixels)) || !isDeepStrictEqual(a.save.worldSettings, b.save.worldSettings) || !isDeepStrictEqual(a.save.rocks, b.save.rocks) || !isDeepStrictEqual(a.save.materials, b.save.materials) || !isDeepStrictEqual(a.save.column, b.save.column) || !isDeepStrictEqual(a.save.tools,b.save.tools);
  const freshBase = await fresh(), base = await reopen(), results = {};
  for (const r of RETUNES) {
    const path = file(r.file); if (!originals.has(path)) originals.set(path, readFileSync(path, 'utf8'));
    const data = JSON.parse(originals.get(path)); r.edit(data); writeFileSync(path, JSON.stringify(data));
    try {
      const freshNow = await fresh(), now = await reopen(), changed = Object.keys({...base.save, ...now.save}).filter(k => !isDeepStrictEqual(base.save[k], now.save[k]));
      results[r.name] = {snapshot: r.snapshot, saveSame: !changed.length, ...(changed.length ? {changed, world: Object.keys({...base.save.worldSettings, ...now.save.worldSettings}).filter(k => !isDeepStrictEqual(base.save.worldSettings?.[k], now.save.worldSettings?.[k])).map(k => k === 'colors' || k === 'knobs' ? k + ':' + Object.keys({...base.save.worldSettings[k], ...now.save.worldSettings[k]}).filter(j => !isDeepStrictEqual(base.save.worldSettings[k]?.[j], now.save.worldSettings[k]?.[j])).join('|') : k)} : {}), pixelsSame: Buffer.from(base.pixels).equals(Buffer.from(now.pixels)), fresh: differs(freshBase, freshNow)};
    } finally { writeFileSync(path, originals.get(path)); }
  }
  await send('Network.enable');
  await send('Network.setBlockedURLs',{urls:['*config/green.json','*materials/green.json']});
  try {
    const standalone=await reopen();
    results['template unavailable']={snapshot:true,saveSame:isDeepStrictEqual(standalone.save,base.save),
      pixelsSame:Buffer.from(base.pixels).equals(Buffer.from(standalone.pixels))};
  } finally { await send('Network.setBlockedURLs',{urls:[]}); }

  // Pulling a retune in on purpose: with Green's material table and a row retuned, Apply look from Green (every card) draws exactly what a
  // reload of the map then draws (the in-place apply and the load agree), and differs from the map as first saved. The second run opens the
  // dialog on its defaults (this world's own, every card: what Reset was) on the map the first left.
  const path = file('green.json'), retuned = JSON.parse(originals.get(path) ?? readFileSync(path, 'utf8')); if (!originals.has(path)) originals.set(path, readFileSync(path, 'utf8'));
  retuned.material.rockSlope = .7; retuned.material.wetBand = 30; retuned.world.knobDefaults.coastRamp = .2; retuned.placement.rock.slope = .3; retuned.world.engineDefaults.terraceCalm = .8; writeFileSync(path, JSON.stringify(retuned));
  try {
    for (const [name, act] of [['Apply look from Green', `(async()=>{document.getElementById('world-apply').click();await new Promise(r=>setTimeout(r,300));const s=document.getElementById('look-source');s.value='builtin:green';s.dispatchEvent(new Event('change'));for(let i=0;i<50&&document.getElementById('look-apply').disabled;i++)await new Promise(r=>setTimeout(r,100));document.getElementById('look-apply').click();return true;})()`], ['Apply look from Green again', `(async()=>{document.getElementById('world-apply').click();await new Promise(r=>setTimeout(r,300));for(let i=0;i<50&&document.getElementById('look-apply').disabled;i++)await new Promise(r=>setTimeout(r,100));document.getElementById('look-apply').click();return true;})()`]]) {
      const before = await reopen(); await ev(act); await sleep(500); await ready();
      const applied = await image(), appliedSave = normal(await ev('sculptDebug.sketch()'));
      // One Undo puts the map back: its picture and its save.
      await ev(`(()=>{document.getElementById('undo').click();return true;})()`); await sleep(300); await ready();
      const undone = {save: normal(await ev('sculptDebug.sketch()')), pixels: await image()};
      await ev(`(()=>{document.getElementById('redo').click();return true;})()`); await sleep(300); await ready();
      const redone = await image();
      for (let i = 0; i < 50 && !await ev(`sculptDebug.savedMap().then(m=>JSON.stringify(m?.worldSettings)===${JSON.stringify(JSON.stringify(appliedSave.worldSettings))})`); i++) await sleep(100);
      const reloaded = await reopen();
      results[name] = {snapshot: true, saveSame: isDeepStrictEqual(appliedSave.worldSettings, reloaded.save.worldSettings), pixelsSame: Buffer.from(applied).equals(Buffer.from(reloaded.pixels)), changed: !Buffer.from(applied).equals(Buffer.from(base.pixels)),
        undo: Buffer.from(undone.pixels).equals(Buffer.from(before.pixels)) && isDeepStrictEqual(undone.save.worldSettings, before.save.worldSettings), redo: Buffer.from(redone).equals(Buffer.from(applied))};
      if (!results[name].undo || !results[name].redo) results[name].pixelsSame = false;
      if (!results[name].changed) results[name].pixelsSame = false;
    }
  } finally { writeFileSync(path, originals.get(path)); }
  const failed = Object.entries(results).filter(([, r]) => r.snapshot && !(r.saveSame && r.pixelsSame)).map(([name]) => name);
  const vacuous = Object.entries(results).filter(([, r]) => r.fresh === false).map(([name]) => name);
  console.log(JSON.stringify({results, failed, vacuous, errors}));
  if (failed.length || vacuous.length || errors.length) process.exitCode = 1;
} finally {
  for (const [path, text] of originals) writeFileSync(path, text);
  ws?.close(); browser.kill();
}
