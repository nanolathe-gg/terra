// A map’s brush list through the editor, in Chrome on your own server.
//   node repro/tools-ui.mjs --server http://127.0.0.1:<yours> --port <cdp> [--out DIR]
// Draw with a starter brush, save the selected shape as a tool, draw with it,
// undo, redo, reopen, and delete it while preserving its stroke.
import {chromePath, chromeGpuFlags} from './chrome.mjs';
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {mkdirSync, writeFileSync} from 'node:fs';
import {join} from 'node:path';
import {cdpPortFree} from './cdp-port.mjs';
const args = process.argv.slice(2), opt = (k, d) => args.includes(k) ? args[args.indexOf(k) + 1] : d;
const server = opt('--server', ''), port = Number(opt('--port', 0)), out = opt('--out', '/tmp/terraform-tools-ui');
if (!server || !port) { console.error('tools-ui.mjs: give --server (your own Go server) and --port (your CDP port)'); process.exit(2); }
await cdpPortFree(port); mkdirSync(out, {recursive: true});
const browser = spawn(chromePath, ['--headless=new', ...chromeGpuFlags, `--remote-debugging-port=${port}`,
  `--user-data-dir=${join(out, 'profile-' + Date.now())}`, '--window-size=1440,900', '--no-first-run', 'about:blank'], {stdio: 'ignore'});
const sleep = ms => new Promise(r => setTimeout(r, ms));
// Each world's toolbar as its config lists it: its shape tools by family (families in the order they first come, a tool without one last),
// then any added brush, Landform and Fissure; its water tools.
const byFamily = list => { const groups = new Map(); for (const t of list) { const f = t.family ?? ''; if (!groups.has(f)) groups.set(f, []); groups.get(f).push(t.id); } return [...groups].sort(([a], [b]) => (a === '') - (b === '')).flatMap(([, ids]) => ids); };
const lists = {};
for (const w of ['green']) lists[w] = (await (await fetch(`${server}/config/${w}.json`)).json()).tools;
const bar = (w, mine = []) => ({Shape: [...byFamily(lists[w].filter(t => t.group === 'shape')), ...mine, 'landform', 'fissure'], Water: lists[w].filter(t => t.group === 'water').map(t => t.id)});
let ws; const report = {};
try {
  for (let i = 0; i < 100 && !ws; i++) { try { const tab = (await (await fetch(`http://127.0.0.1:${port}/json/list`)).json()).find(t => t.type === 'page'); if (tab) ws = new WebSocket(tab.webSocketDebuggerUrl); } catch {} if (!ws) await sleep(150); }
  await new Promise(r => ws.onopen = r);
  let id = 0; const pending = new Map(), errors = [];
  ws.onmessage = e => { const m = JSON.parse(e.data); if (m.id) { pending.get(m.id)?.(m); pending.delete(m.id); } if (m.method === 'Runtime.exceptionThrown') errors.push(m.params.exceptionDetails.exception?.description || m.params.exceptionDetails.text); if (m.method === 'Runtime.consoleAPICalled' && m.params.type === 'error') errors.push(m.params.args.map(a => a.value ?? a.description).join(' ')); };
  const send = (method, params = {}) => new Promise(r => { const n = ++id; pending.set(n, r); ws.send(JSON.stringify({id: n, method, params})); });
  const ev = async expression => { const r = await send('Runtime.evaluate', {expression, awaitPromise: true, returnByValue: true, userGesture: true}); if (r.result?.exceptionDetails) throw Error(JSON.stringify(r.result.exceptionDetails)); return r.result.result.value; };
  const ready = async () => { for (let i = 0; i < 480; i++) { if (await ev('!!window.sculptCanvas&&!document.getElementById("map-export").disabled')) { await ev('sculptCanvas.idle()'); return; } const e = await ev(`document.getElementById('error')?.textContent`); if (e) throw Error(e); await sleep(150); } throw Error('Editor did not become ready: ' + errors.join('\n')); };
  const open = async query => { await send('Page.navigate', {url: `${server}/?${query}&mapX=4&mapY=4&gpuMB=512&heapMB=1536`}); await sleep(500); await ready(); };
  const set = async (elementId, value, event = 'input') => { await ev(`(()=>{const e=document.getElementById(${JSON.stringify(elementId)});e.value=${JSON.stringify(String(value))};e.dispatchEvent(new Event(${JSON.stringify(event)},{bubbles:true}));e.dispatchEvent(new Event('change',{bubbles:true}));})()`); await ready(); };
  const click = async selector => { await ev(`document.querySelector(${JSON.stringify(selector)}).click()`); await sleep(50); await ready(); };
  const tool = name => click(`[data-tool="${name}"]`);
  const nodes = () => ev('sculptDebug.nodes()');
  const toolbar = () => ev(`Object.fromEntries(['Shape','Water'].map(g=>[g,[...document.querySelector('[aria-label="'+g+' tools"]').querySelectorAll('[data-tool]')].map(b=>b.dataset.tool)]))`);
  const title = () => ev(`document.getElementById('brush-title').textContent`);
  const mouse = (type, x, y) => send('Input.dispatchMouseEvent', {type, x, y, button: 'left', buttons: type === 'mouseReleased' ? 0 : 1, clickCount: 1});
  // A stroke with the mouse, as an artist draws one; it leaves the new shape selected.
  const draw = async (x0, y0, x1, y1) => { await send('Input.dispatchMouseEvent', {type: 'mouseMoved', x: x0, y: y0}); await mouse('mousePressed', x0, y0); for (let t = .25; t <= 1; t += .25) { await mouse('mouseMoved', x0 + (x1 - x0) * t, y0 + (y1 - y0) * t); await sleep(30); } await mouse('mouseReleased', x1, y1); await sleep(200); await ready(); };
  const select = async i => { await click('#tab-objects'); await click(`#layers li[data-index="${i}"] .layer-name`); await click('#tab-tool'); };
  const capture = () => ev(`(async()=>{const b=await sculptCanvas.debugBake({x:200,y:200,width:768,height:768}),c=document.createElement('canvas');c.width=c.height=768;c.getContext('2d').drawImage(b,0,0);return c.toDataURL();})()`);
  // A screenshot of one element, scrolled to the top of its pane (at most the window's height), or of the whole window with it in view.
  const shot = async (selector, name, whole = false, pad = 6) => {
    await ready();
    const r = await ev(`(()=>{const e=document.querySelector(${JSON.stringify(selector)});const d=e.closest('details');if(d)d.open=true;for(let p=e.parentElement;p;p=p.parentElement){const o=getComputedStyle(p).overflowY;if((o==='auto'||o==='scroll')&&p.scrollHeight>p.clientHeight){p.scrollTop+=e.getBoundingClientRect().top-p.getBoundingClientRect().top-8;break;}}for(const el of [document.scrollingElement,...document.querySelectorAll('.app,.world-panel,.shape-panel')])el.scrollTop=0;const b=e.getBoundingClientRect(),y=Math.max(0,b.y-${pad});return {x:Math.max(0,b.x-${pad}),y,width:b.width+${2 * pad},height:Math.min(b.height+${2 * pad},innerHeight-y)};})()`);
    await sleep(600);
    const s = await send('Page.captureScreenshot', whole ? {format: 'png'} : {format: 'png', clip: {...r, scale: 1}});
    if (!s.result) throw Error(`screenshot of ${selector}: ${JSON.stringify(s.error)}`);
    writeFileSync(join(out, name), Buffer.from(s.result.data, 'base64'));
  };
  const without = p => Object.fromEntries(Object.entries(p).filter(([k]) => !['river'].includes(k)));
  await send('Runtime.enable'); await send('Page.enable');
  await send('Emulation.setDeviceMetricsOverride', {width: 1440, height: 900, deviceScaleFactor: 1, mobile: false});
  await open('biome=green');
  await ev(`document.getElementById('seed-vary').checked=false;document.getElementById('seed-vary').dispatchEvent(new Event('change',{bubbles:true}));true`);
  // Green's toolbar.
  report.green = await toolbar();
  assert.deepEqual(report.green, bar('green'));
  await shot('.tool-groups', 'toolbar-green.png');
  // Draw with Hill: the stroke names its tool, and the selection says so.
  const hillTool = lists.green.find(t => t.id === 'hill');
  await tool('hill'); assert.equal(await title(), `New ${hillTool.label}`);
  await draw(380, 300, 640, 330);
  let ns = await nodes(); const hill = ns.length - 1;
  assert.deepEqual([ns[hill].kind, ns[hill].tool], ['landform', 'hill']);
  assert.equal(await title(), `Editing ${hillTool.label} ${hill + 1}`);
  // A tool that names its rock by a preset's key draws on that preset of the map's list (Hill on Smooth soil), the save holds the preset and the
  // stroke's choice, and a scene stroke with that choice is the same stroke.
  if (hillTool.rock) {
    const rocks = await ev('sculptDebug.sketch().rocks'), preset = rocks.find(r => r.key === hillTool.rock);
    assert.ok(preset, `the world ships the preset its Hill names (${hillTool.rock})`);
    assert.equal(ns[hill].params.rockPreset, preset.slot, 'the first stroke draws on it');
    report.hillRock = {key: hillTool.rock, slot: preset.slot, name: preset.name};
    const drawnParams = ns[hill].params;
    await ev(`sculptDebug.scene([['hill',[[400,400],[600,420]],{card:{rockPreset:${preset.slot}}}]],{ground:true}); true`); await ready();
    assert.deepEqual((await nodes()).at(-1).params, drawnParams, 'a scene stroke on the same preset has the same numbers');
    await click('#undo'); ns = await nodes(); assert.equal(ns[hill].params.rockPreset, preset.slot, 'undo brings the drawn hill back');
    await select(hill);
  }
  // Widen it (an edit the switch keeps), then Save it as a tool: Broad hill, the mountain icon, an orange.
  await set('lf-width-vary', 60);
  assert.equal(await ev(`document.getElementById('tool-save').hidden`), false, 'Save as tool shows in a selected shape\'s options');
  assert.equal(await ev(`document.getElementById('tool-save-name').value`), 'Hill 2', 'it starts with a name of its own');
  await set('tool-save-name', 'Broad hill'); await click('[data-icon-choice="mountain"]'); await set('tool-save-color', '#d08050');
  await shot('#tool-save', 'save-as-tool.png'); await shot('#tool-save', 'save-as-tool-window.png', true);
  await click('#tool-save-button');
  const saved = await ev('sculptDebug.sketch().tools');
  assert.deepEqual(saved.filter(t=>t.id.startsWith('map-')).map(t => [t.id, t.label, t.icon, t.color, t.group, t.shape]), [['map-1', 'Broad hill', 'mountain', '#d08050', 'shape', 'hill']]);
  report.withTool = await toolbar();
  assert.deepEqual(report.withTool, bar('green', ['map-1']), 'the saved tool joins Land');
  assert.equal((await nodes())[hill].tool, 'hill', 'saving a tool changes no stroke');
  await shot('.tool-groups', 'map-tool.png'); await tool('map-1'); await shot('#brush-title', 'map-tool-window.png', true);
  // Draw with it: its stroke has the hill's numbers and curves.
  await tool('map-1'); assert.equal(await title(), 'New Broad hill');
  assert.equal(await ev(`document.getElementById('tool-delete-control').hidden`), false, 'Delete shows on a map tool\'s brush');
  await draw(420, 520, 700, 560);
  ns = await nodes(); const mine = ns.length - 1;
  assert.equal(ns[mine].tool, 'map-1');
  assert.deepEqual(without(ns[mine].params), without(ns[hill].params), 'the new tool draws the selected shape\'s numbers, curves and rock');
  report.params = {widthVary: ns[mine].params.widthVary, wander: ns[mine].params.wander};
  const drawn = await capture();
  // Undo the stroke and the tool; redo both.
  await click('#undo'); assert.equal((await nodes()).length, mine);
  await click('#undo'); assert.ok(!(await ev('sculptDebug.sketch().tools')).some(t=>t.id==='map-1')); assert.ok(!(await toolbar()).Shape.includes('map-1'), 'undo takes the tool away');
  await click('#redo'); assert.ok((await toolbar()).Shape.includes('map-1'), 'redo brings it back');
  await click('#redo'); ns = await nodes(); assert.equal(ns.length, mine + 1); assert.equal(ns[mine].tool, 'map-1');
  assert.equal(await capture(), drawn, 'undo and redo: the same pixels');
  // Save (the autosave) and reload.
  const before = await nodes(); await sleep(1200);
  await open('biome=green');
  assert.deepEqual(await ev('sculptDebug.sketch().tools'), saved);
  assert.deepEqual((await nodes()).map(n => n.tool), before.map(n => n.tool));
  assert.ok((await toolbar()).Shape.includes('map-1'));
  assert.equal(await capture(), drawn, 'a reload gives the same pixels');
  // A save from before strokes named their tool (the owner's working maps): each landform takes, once, the tool its section form belongs to.
  const named = await ev('sculptDebug.sketch()'), old = structuredClone(named); for (const n of old.nodes) delete n.tool;
  await ev(`sculptDebug.loadSketch(${JSON.stringify(old)}); true`); await ready();
  assert.deepEqual((await nodes()).map(n => n.tool), before.map(n => n.kind === 'landform' ? 'hill' : undefined), 'both drew the Hill section: both are Hills');
  await ev(`sculptDebug.loadSketch(${JSON.stringify(named)}); true`); await ready();
  assert.deepEqual((await nodes()).map(n => n.tool), before.map(n => n.tool));
  const carried = (await nodes()).find(n => n.tool === 'map-1');
  // Delete the map's tool: its stroke keeps its numbers and shows as Landform; undo brings the tool back.
  await tool('map-1'); await click('#tool-delete');
  assert.ok(!(await toolbar()).Shape.includes('map-1'));
  ns = await nodes(); const orphan = ns.findIndex(n => n.tool === 'map-1');
  assert.deepEqual(without(ns[orphan].params), without(carried.params), 'Delete keeps its strokes\' numbers');
  await select(orphan); assert.equal(await title(), `Editing Landform ${orphan + 1}`);
  await click('#undo'); assert.ok((await toolbar()).Shape.includes('map-1'), 'undo brings the deleted tool back');
  assert.equal(await title(), `Editing Broad hill ${orphan + 1}`, 'and its stroke shows as it again');
  assert.deepEqual(errors, []);
  report.result = 'toolbars, draw, Save as tool, draw with it, undo, redo, reload, Delete and undo: all as expected';
} finally {
  writeFileSync(join(out, 'report.json'), JSON.stringify(report, null, 2));
  try { ws?.close(); } catch {}
  browser.kill();
}
console.log(JSON.stringify(report));
process.exit(0);
