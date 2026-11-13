// Rock presets through the editor (B2): the World pane's list and a shape's Rock option, in Chrome on your own server.
//   node repro/rock-presets-ui.mjs --server http://127.0.0.1:<yours> --port <cdp> [--out DIR]
// On modern Green with three shapes: the list holds the world's rock and the presets the world ships, the first not deletable (and saying why);
// Add a preset from Thin shale, pick it on the wall, edit one of its numbers, undo, redo, save and load it back (the same pixels each way);
// Recolor it (its rock color, then World's colors), undo and redo; Copy and Paste a recipe between two presets; delete the preset (its shape goes
// to Rock beneath) and undo that. Writes panel.png, colors.png and option.png (screenshots of the list, the colors and the shape's Rock option)
// and report.json into DIR.
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {mkdirSync, writeFileSync} from 'node:fs';
import {join} from 'node:path';
import {cdpPortFree} from './cdp-port.mjs';
const args = process.argv.slice(2), opt = (k, d) => args.includes(k) ? args[args.indexOf(k) + 1] : d;
const server = opt('--server', ''), port = Number(opt('--port', 0)), out = opt('--out', '/private/tmp/terraform-rock-presets-ui');
if (!server || !port) { console.error('rock-presets-ui.mjs: give --server (your own Go server) and --port (your CDP port)'); process.exit(2); }
await cdpPortFree(port); mkdirSync(out, {recursive: true});
const browser = spawn('/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', ['--headless=new', '--enable-gpu', '--use-angle=metal', `--remote-debugging-port=${port}`,
  `--user-data-dir=${join(out, 'profile-' + Date.now())}`, '--window-size=1440,900', '--no-first-run', 'about:blank'], {stdio: 'ignore'});
const sleep = ms => new Promise(r => setTimeout(r, ms));
let ws; const report = {};
try {
  for (let i = 0; i < 100 && !ws; i++) { try { const tab = (await (await fetch(`http://127.0.0.1:${port}/json/list`)).json()).find(t => t.type === 'page'); if (tab) ws = new WebSocket(tab.webSocketDebuggerUrl); } catch {} if (!ws) await sleep(150); }
  await new Promise(r => ws.onopen = r);
  let id = 0; const pending = new Map(), errors = [];
  ws.onmessage = e => { const m = JSON.parse(e.data); if (m.id) { pending.get(m.id)?.(m); pending.delete(m.id); } if (m.method === 'Runtime.exceptionThrown') errors.push(m.params.exceptionDetails.exception?.description || m.params.exceptionDetails.text); if (m.method === 'Runtime.consoleAPICalled' && m.params.type === 'error') errors.push(m.params.args.map(a => a.value ?? a.description).join(' ')); };
  const send = (method, params = {}) => new Promise(r => { const n = ++id; pending.set(n, r); ws.send(JSON.stringify({id: n, method, params})); });
  const ev = async expression => { const r = await send('Runtime.evaluate', {expression, awaitPromise: true, returnByValue: true, userGesture: true}); if (r.result?.exceptionDetails) throw Error(JSON.stringify(r.result.exceptionDetails)); return r.result.result.value; };
  const ready = async () => { for (let i = 0; i < 480; i++) { if (await ev('!!window.sculptCanvas&&!document.getElementById("map-export").disabled')) { await ev('sculptCanvas.idle()'); return; } await sleep(150); } throw Error('Editor did not become ready: ' + errors.join('\n')); };
  const set = async (elementId, value) => { await ev(`(()=>{const e=document.getElementById(${JSON.stringify(elementId)});e.value=${JSON.stringify(String(value))};e.dispatchEvent(new Event('input',{bubbles:true}));e.dispatchEvent(new Event('change',{bubbles:true}));})()`); await ready(); };
  const click = async elementId => { await ev(`document.getElementById(${JSON.stringify(elementId)}).click()`); await sleep(50); await ready(); };
  const rocks = () => ev('sculptDebug.sketch().rocks');
  const nodes = () => ev('sculptDebug.nodes()');
  const capture = () => ev(`(async()=>{const b=await sculptCanvas.debugBake({x:300,y:240,width:512,height:512}),c=document.createElement('canvas');c.width=c.height=512;c.getContext('2d').drawImage(b,0,0);return c.toDataURL();})()`);
  const shot = async (selector, name, whole = false) => {
    await ready();
    const r = await ev(`(()=>{const e=document.querySelector(${JSON.stringify(selector)});const d=e.closest('details');if(d)d.open=true;e.scrollIntoView({block:'center',behavior:'instant'});const b=e.getBoundingClientRect();return {x:b.x-6,y:b.y-30,width:b.width+12,height:b.height+60};})()`);
    await sleep(500);
    // The tool tab's clip lands elsewhere in headless Chrome (its scroll is not yet drawn), so that one is the whole window.
    const s = await send('Page.captureScreenshot', whole ? {format: 'png'} : {format: 'png', clip: {...r, scale: 1}});
    if (!s.result) throw Error(`screenshot of ${selector}: ${JSON.stringify(s.error)} ${JSON.stringify(r)}`);
    writeFileSync(join(out, name), Buffer.from(s.result.data, 'base64'));
  };
  await send('Runtime.enable'); await send('Page.enable');
  await send('Emulation.setDeviceMetricsOverride', {width: 1440, height: 900, deviceScaleFactor: 1, mobile: false});
  await send('Emulation.setFocusEmulationEnabled', {enabled: true});   // the clipboard answers a focused page only
  await send('Browser.grantPermissions', {origin: server, permissions: ['clipboardReadWrite', 'clipboardSanitizedWrite']});
  await send('Page.navigate', {url: `${server}/?biome=green&variant=modern&mapX=4&mapY=4&gpuMB=512&heapMB=1536&sunHeight=25&flatShadow=1`}); await ready();
  // A wall, a dome and a hill, all on the rock beneath.
  await ev(`sculptDebug.scene([['plateau',[[260,330],[560,300]],{card:{diameter:420}}],['mountain',[[700,620]],{card:{diameter:260,elevation:120}}],['hill',[[420,700],[560,720]]]],{ground:true}); true`); await ready();
  await click('tab-world');
  // The list: the world's rock first (named after its recipe), then what the world ships.
  report.list = await ev(`[...document.getElementById('rock-presets').options].map(o=>o.textContent)`);
  assert.deepEqual(report.list, ["Rounded granite (the world's rock)", 'Smooth soil', 'Jointed basalt', 'Pitted limestone']);
  assert.equal(await ev(`document.getElementById('rock-delete').disabled`), true);
  assert.match(await ev(`document.getElementById('rock-presets-note').textContent`), /cannot be deleted/);
  assert.equal(await ev(`document.getElementById('rock-color').disabled`), true);
  assert.match(await ev(`document.getElementById('rock-colors-note').textContent`), /world’s rock wears the world’s colors/);
  await shot('#rock-presets-control', 'panel.png');
  // Add a preset from Thin shale: it is selected, and the rock rows show its numbers.
  await set('rock-add', 'shale');
  const shale = (await rocks()).find(r => r.name === 'Thin shale');
  assert.ok(shale, 'Add makes a preset from the starting recipe');
  assert.equal(await ev(`document.getElementById('rock-presets').value`), String(shale.slot));
  assert.equal(Number(await ev(`document.getElementById('knob-faceStretch').value`)), 3.2, 'the rows show the selected preset’s numbers');
  // Pick it on the wall (the shape's Rock option offers it by name).
  await ev(`document.querySelector('#layers li[data-index="0"] .layer-name').click()`); await ready(); await click('tab-tool');
  report.option = await ev(`[...document.getElementById('lf-rock').options].map(o=>o.textContent)`);
  assert.deepEqual(report.option, ['Rock beneath', 'Rounded granite', 'Smooth soil', 'Jointed basalt', 'Pitted limestone', 'Thin shale']);
  await set('lf-rock', shale.slot);
  assert.equal((await nodes())[0].params.rockPreset, shale.slot);
  await shot('#lf-rock-control', 'option.png', true);
  const picked = await capture();
  // Edit the preset: the wall changes, and the world's own number does not.
  const worldJoint = await ev(`sculptDebug.sketch().rock.faceJoint`);
  await click('tab-world'); await set('knob-faceJoint', 2.5);
  assert.equal((await rocks()).find(r => r.slot === shale.slot).knobs.faceJoint, 2.5);
  assert.equal(await ev(`sculptDebug.sketch().rock.faceJoint`), worldJoint, 'the world’s rock keeps its own number');
  let edited = await capture();
  assert.notEqual(edited, picked, 'editing the preset re-renders the shape that uses it');
  await click('undo'); assert.equal((await rocks()).find(r => r.slot === shale.slot).knobs.faceJoint, .9); assert.equal(await capture(), picked, 'undo');
  await click('redo'); assert.equal((await rocks()).find(r => r.slot === shale.slot).knobs.faceJoint, 2.5); assert.equal(await capture(), edited, 'redo');
  // Its colors: the recipe's own (Thin shale's gray rock), shown with the palette entry the game draws; recolored, undone, redone.
  const shaleColors = (await rocks()).find(r => r.slot === shale.slot).colors;
  assert.equal(shaleColors.rock, '#5b5b5b', 'a preset from a recipe wears the recipe’s colors');
  assert.equal(await ev(`document.getElementById('rock-color-world').checked`), false);
  await set('rock-color', '#2f4b5f');
  assert.deepEqual((await rocks()).find(r => r.slot === shale.slot).colors, {...shaleColors, rock: '#2f4b5f'});
  report.snap = await ev(`document.getElementById('rock-color-snap').title`);
  assert.equal(report.snap, 'Palette entry #2f4b5f', 'a palette entry snaps to itself');
  const recolored = await capture();
  assert.notEqual(recolored, edited, 'a preset recolored re-renders the shape that uses it');
  await shot('#rock-colors-control', 'colors.png');
  await click('undo'); assert.equal((await rocks()).find(r => r.slot === shale.slot).colors.rock, '#5b5b5b'); assert.equal(await capture(), edited, 'undo a color');
  await click('redo'); assert.equal((await rocks()).find(r => r.slot === shale.slot).colors.rock, '#2f4b5f'); assert.equal(await capture(), recolored, 'redo a color');
  // World's colors: the rock takes the world's (null); undone, it is the preset's own again.
  await click('rock-color-world');
  assert.equal((await rocks()).find(r => r.slot === shale.slot).colors.rock, null);
  assert.equal(await ev(`document.getElementById('rock-color').disabled`), true);
  assert.match(await ev(`document.getElementById('rock-colors-note').textContent`), /clear World’s colors/);
  await click('undo'); assert.equal((await rocks()).find(r => r.slot === shale.slot).colors.rock, '#2f4b5f'); assert.equal(await capture(), recolored, 'undo World’s colors');
  edited = recolored;
  // Translucent (B4): Color deepens with thickness on the selected preset (a rock row), then its Absorption color, undone, redone.
  await set('knob-absorbDepth', .7);
  assert.equal((await rocks()).find(r => r.slot === shale.slot).knobs.absorbDepth, .7);
  assert.equal(await ev(`sculptDebug.sketch().rock.absorbDepth ?? 0`), 0, 'the world’s rock stays opaque');
  const deep = await capture();
  assert.notEqual(deep, edited, 'a preset deepening with thickness re-renders its shape');
  assert.equal(await ev(`document.getElementById('rock-absorb').disabled`), true, 'its Absorption follows the world’s until World’s colors is cleared');
  await click('rock-absorb-world'); await set('rock-absorb', '#1b4b77');
  assert.equal((await rocks()).find(r => r.slot === shale.slot).colors.absorb, '#1b4b77');
  const blue = await capture();
  assert.notEqual(blue, deep, 'the absorption color re-renders the shape');
  await click('undo'); assert.notEqual((await rocks()).find(r => r.slot === shale.slot).colors?.absorb, '#1b4b77');
  await click('redo'); assert.equal((await rocks()).find(r => r.slot === shale.slot).colors.absorb, '#1b4b77'); assert.equal(await capture(), blue, 'redo the absorption color');
  edited = blue;
  // Save and load it back.
  const saved = await ev('sculptDebug.sketch()');
  await ev(`sculptDebug.loadSketch(${JSON.stringify(saved)}); true`); await ready();
  assert.deepEqual(await rocks(), saved.rocks); assert.equal(await capture(), edited, 'a save loads back to the same pixels');
  // Copy Smooth soil's recipe and paste it on the shale preset.
  await set('rock-presets', 1); await click('rock-copy');
  await set('rock-presets', shale.slot); await click('rock-paste');
  report.pasteNote = await ev(`document.getElementById('rock-presets-note').textContent`);
  const pasted = (await rocks()).find(r => r.slot === shale.slot);
  assert.deepEqual([pasted.name, pasted.knobs.rockFace, pasted.column], ['Thin shale', 0, null], 'Paste takes the recipe’s numbers and beds, the preset keeps its name');
  await click('undo');
  // Delete the preset: the wall goes to Rock beneath, in one undo step.
  await set('rock-presets', shale.slot); await click('rock-delete');
  assert.equal((await rocks()).some(r => r.slot === shale.slot), false);
  assert.equal((await nodes())[0].params.rockPreset, -1);
  await click('undo');
  assert.equal((await nodes())[0].params.rockPreset, shale.slot); assert.ok((await rocks()).some(r => r.slot === shale.slot));
  assert.equal(await capture(), edited, 'undoing the delete brings the shape’s rock back');
  // A tool that last chose a preset deleted since: picking the tool again shows and draws Rock beneath (an empty choice would read as the world's rock).
  const tool = async name => { await ev(`document.querySelector('[data-tool="${name}"]').click()`); await ready(); };
  await click('tab-tool'); await tool('plateau'); await set('lf-rock', shale.slot); await tool('mountain');
  await click('tab-world'); await set('rock-presets', shale.slot); await click('rock-delete');
  await click('tab-tool'); await tool('plateau');
  assert.equal(await ev(`document.getElementById('lf-rock').value`), '-1', 'a deleted preset shows as Rock beneath on the tool that chose it');
  assert.deepEqual(errors, []);
  report.result = 'list, add, pick, edit, recolor, translucency and absorption color, undo, redo, save and load, copy and paste, delete and undo, a tool whose preset is gone: all as expected';
} finally {
  writeFileSync(join(out, 'report.json'), JSON.stringify(report, null, 2));
  try { ws?.close(); } catch {}
  browser.kill();
}
console.log(JSON.stringify(report));
process.exit(0);
