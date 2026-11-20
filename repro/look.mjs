// World › Apply look from… and Map › New map with this look (owner, 2026-11-19: a map holds its whole look; built-in worlds and other maps
// are where a look comes from). In a fresh profile:
// - a partial apply from another world (Rock types, Light & weather) changes only those, keeps the map in its world, and one Undo restores it;
// - a map saved with an edited row, a map tool and a feature set starts a new map with that look (blank, named, nothing to undo);
// - Apply look from that map's file, Tools only, brings its tool; a whole look from another world forks the map there.
//   node repro/look.mjs --server http://127.0.0.1:<yours> --port <cdp> [--out dir]
import {chromePath, chromeGpuFlags} from './chrome.mjs';
import {cdpPortFree} from './cdp-port.mjs';
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {mkdirSync, mkdtempSync, writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join, resolve} from 'node:path';

const args = process.argv.slice(2), opt = k => args[args.indexOf(k) + 1];
const server = args.includes('--server') ? opt('--server') : '', port = Number(args.includes('--port') ? opt('--port') : 0);
if (!server || !Number.isInteger(port) || port < 1024) throw Error('Give your own --server and --port.');
const out = resolve(args.includes('--out') ? opt('--out') : mkdtempSync(join(tmpdir(), 'terraform-look-'))); mkdirSync(out, {recursive: true});
const sleep = ms => new Promise(r => setTimeout(r, ms));
await cdpPortFree(port);
const browser = spawn(chromePath, ['--headless=new', ...chromeGpuFlags, `--remote-debugging-port=${port}`, `--user-data-dir=${join(out, 'profile-' + Date.now())}`, '--window-size=1440,900', '--no-first-run', 'about:blank'], {stdio: 'ignore'});
let ws;
try {
  for (let i = 0; i < 100 && !ws; i++) { try { const tabs = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json(); ws = new WebSocket(tabs.find(t => t.type === 'page').webSocketDebuggerUrl); } catch {} if (!ws) await sleep(100); }
  await new Promise(r => ws.onopen = r);
  let id = 0; const pending = new Map(), errors = [];
  ws.onmessage = e => { const m = JSON.parse(e.data); if (m.id) { pending.get(m.id)?.(m); pending.delete(m.id); } if (m.method === 'Runtime.exceptionThrown') errors.push(m.params.exceptionDetails.exception?.description || m.params.exceptionDetails.text); };
  const send = (method, params = {}) => new Promise((res, rej) => { const n = ++id; pending.set(n, m => m.error ? rej(Error(JSON.stringify(m.error))) : res(m.result)); ws.send(JSON.stringify({id: n, method, params})); });
  const ev = async x => { const r = await send('Runtime.evaluate', {expression: x, awaitPromise: true, returnByValue: true}); if (r.exceptionDetails) throw Error(r.exceptionDetails.exception?.description || r.exceptionDetails.text); return r.result.value; };
  const ready = async (c = 'true') => { for (let i = 0; i < 1200; i++) { try { if (await ev(`!!window.sculptDebug&&!!window.sculptCanvas&&!!window.sculptRegion&&sculptRegion.ready()&&(${c})`)) { await ev('sculptCanvas.idle()'); return; } } catch {} await sleep(150); } throw Error('page not ready: ' + errors.join('\n')); };
  const sketch = () => ev('sculptDebug.sketch()'), text = sel => ev(`document.querySelector(${JSON.stringify(sel)}).textContent`);
  const click = sel => ev(`(()=>{document.querySelector(${JSON.stringify(sel)}).click();return true;})()`);
  // The dialog: a source, the cards to take (all when omitted), then Apply.
  const apply = async (source, cards) => {
    await click('#world-apply'); await sleep(300);
    await ev(`(()=>{const s=document.getElementById('look-source');s.value=${JSON.stringify(source)};if(s.value!=='file')s.dispatchEvent(new Event('change'));for(const b of document.querySelectorAll('#look-cards input'))b.checked=${cards ? `${JSON.stringify(cards)}.includes(b.value)` : 'true'};document.getElementById('look-cards').dispatchEvent(new Event('change'));return true;})()`);
  };
  await send('Runtime.enable'); await send('Page.enable'); await send('DOM.enable');
  const report = {};
  // 1. A Green map with a hill on Broken slopes; a partial apply from Painted Desert.
  await send('Page.navigate', {url: `${server}/?biome=green&mapX=1&mapY=1&newMap=1&gpuMB=512`}); await ready();
  await ev(`(()=>{sculptDebug.scene([['hill',[[120,120],[260,170]],{card:{rockPreset:2,elevation:80}}]],{ground:true});return true;})()`); await ready();
  const before = await sketch();
  await apply('builtin:desert', ['rocks', 'light']);
  assert.match(await text('#look-note'), /Only the checked parts come from Painted Desert/);
  await click('#look-apply'); await sleep(500); await ready();
  const partial = await sketch();
  assert.equal(partial.biome, 'green', 'a partial look keeps the map in its world');
  assert.notDeepEqual(partial.rocks.map(r => r.name), before.rocks.map(r => r.name), 'Rock types came from Painted Desert');
  assert.notEqual(partial.worldSettings.knobs.sunHeight, before.worldSettings.knobs.sunHeight, 'Light & weather came from Painted Desert');
  assert.equal(partial.worldSettings.knobs.groundPatch, before.worldSettings.knobs.groundPatch, 'Ground stayed');
  assert.deepEqual(partial.materials.find(m => m.worldGround), before.materials.find(m => m.worldGround), 'the ground material stayed');
  assert.match(await ev(`document.getElementById('undo').title`), /applying a look/);
  await click('#undo'); await sleep(300); await ready();
  const undone = await sketch();
  assert.deepEqual(undone.rocks, before.rocks, 'one Undo restores the rock types');
  assert.deepEqual(undone.worldSettings.knobs, before.worldSettings.knobs, 'and every world row');
  assert.deepEqual(undone.nodes.map(n => n.params?.rockPreset), before.nodes.map(n => n.params?.rockPreset), 'and the shapes\' rock types');
  report.partial = 'Rock types and Light & weather from Painted Desert; Ground kept; one Undo restored all';
  // 2. The map's own look: an edited row, a map tool, a feature set. Save as tool through the shape card.
  await ev(`(()=>{const el=document.getElementById('knob-reliefAmount');el.value='1.1';el.dispatchEvent(new Event('input',{bubbles:true}));el.dispatchEvent(new Event('change',{bubbles:true}));return true;})()`); await sleep(800);
  const hill = await ev(`sculptDebug.sketch().nodes.findIndex(n=>n.kind==='landform')`);
  await ev(`(async()=>{const c=s=>document.querySelector(s).click(),w=ms=>new Promise(r=>setTimeout(r,ms));c('#tab-objects');await w(300);c('#layers li[data-index="${hill}"] .layer-name');await w(300);c('#tab-tool');await w(300);document.getElementById('tool-save').open=true;document.getElementById('tool-save-name').value='Look hill';document.getElementById('tool-save-name').dispatchEvent(new Event('input'));await w(200);c('#tool-save-button');return true;})()`); await ready();
  await ev(`(()=>{const d=sculptRegion.mapData();d.name='Look source';sculptRegion.restoreMapData(d);return true;})()`);
  const source = await sketch(); assert.equal(source.tools?.[0]?.label, 'Look hill', 'Save as tool saved to the map');
  const file = join(out, 'look-source.json'); writeFileSync(file, JSON.stringify(source));
  // 3. New map with this look.
  await click('#tab-map'); await click('#new-map-look'); await sleep(300);
  assert.equal(await text('#new-map-title'), 'New map with this look'); assert.equal(await ev(`document.getElementById('new-map-worlds').hidden`), true);
  await ev(`(()=>{document.getElementById('new-map-name').value='From a look';document.getElementById('new-map-width').value='2';document.getElementById('new-map-height').value='2';document.getElementById('new-map-create').click();return true;})()`);
  await sleep(1500); await ready(`sculptRegion.mapData().name==='From a look'`);
  const child = await sketch();
  assert.equal(child.nodes.filter(n => n.kind !== 'ground').length, 0, 'the new map starts blank');
  assert.equal(child.map.unitsX, 2, 'at the size chosen');
  assert.equal(child.worldSettings.knobs.reliefAmount, '1.1', 'with the edited row');
  assert.deepEqual(child.tools.map(t => t.label), ['Look hill'], 'with the map\'s tool');
  assert.deepEqual(child.mapData.featureSet, source.mapData.featureSet, 'with the feature styles');
  assert.deepEqual(child.rocks, source.rocks, 'with the rock types');
  assert.equal(await ev(`document.getElementById('undo').disabled`), true, 'nothing to undo on a new map');
  report.newMap = 'blank 2 x 2, the row, the tool, the rock types and the feature styles of the source';
  // 4. Apply look from that file, Tools only, onto a fresh Green map.
  await send('Page.navigate', {url: `${server}/?biome=green&mapX=1&mapY=1&newMap=1&gpuMB=512`}); await ready();
  await apply('file', ['tools']);
  const doc = await send('DOM.getDocument'), input = await send('DOM.querySelector', {nodeId: doc.root.nodeId, selector: '#look-file'});
  await send('DOM.setFileInputFiles', {nodeId: input.nodeId, files: [file]}); await sleep(500);
  assert.match(await text('#look-note'), /One Undo/);
  await click('#look-apply'); await sleep(500); await ready();
  const tooled = await sketch();
  assert.deepEqual(tooled.tools.map(t => t.label), ['Look hill'], 'Tools brought the file\'s tool');
  assert.notEqual(tooled.worldSettings.knobs.reliefAmount, '1.1', 'and nothing else');
  report.file = 'Tools from a map file, alone';
  // 5. A whole look from another world forks the map there.
  await apply('builtin:lava');
  assert.match(await text('#look-note'), /another world/);
  await click('#look-apply'); await sleep(2000); await ready(`sculptDebug.biome==='lava'`);
  const forked = await sketch();
  assert.equal(forked.worldSettings.name, 'Lava'); assert.deepEqual(forked.tools ?? [], [], 'a whole look takes the world\'s tools: none of its own');
  assert.match(await text('#status'), /Applied the look of Lava/);
  report.fork = 'whole look from Lava: the map forked into Lava with its look';
  assert.deepEqual(errors, []);
  console.log(JSON.stringify(report));
} finally { ws?.close(); browser.kill(); }
