// Interaction regression for generated map features (sculpt-features.js), with real pointer and key input: the Features tool's
// set and placement, the Select tool's feature selection (select, Shift-add, drag on the cell grid, metal, re-roll, Delete), undo,
// the export of the placed features, and a world without generated trees. Writes screenshots to --out.
//   node repro/features.mjs --server http://127.0.0.1:8941 --port 9803 --out /tmp/features-e2e
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {mkdirSync, writeFileSync} from 'node:fs';
import {join} from 'node:path';
import {cdpPortFree} from './cdp-port.mjs';
const args = process.argv.slice(2), opt = (k, d) => args.includes(k) ? args[args.indexOf(k) + 1] : d;
const server = opt('--server', 'http://127.0.0.1:8801'), port = Number(opt('--port', 9450)), out = opt('--out', '/tmp/features-e2e');
await cdpPortFree(port); mkdirSync(out, {recursive: true});
const browser = spawn('/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', ['--headless=new', '--enable-gpu', '--use-angle=metal', `--remote-debugging-port=${port}`, `--user-data-dir=${join(out, 'profile')}`, '--window-size=1440,900', '--no-first-run', 'about:blank'], {stdio: 'ignore'});
const sleep = ms => new Promise(r => setTimeout(r, ms)); let ws;
const report = {};
try {
  for (let i = 0; i < 100 && !ws; i++) { try { const tab = (await (await fetch(`http://127.0.0.1:${port}/json/list`)).json()).find(t => t.type === 'page'); if (tab) ws = new WebSocket(tab.webSocketDebuggerUrl); } catch {} if (!ws) await sleep(150); }
  await new Promise(r => ws.onopen = r); let id = 0; const pending = new Map(), errors = [];
  ws.onmessage = e => { const m = JSON.parse(e.data); if (m.id) { pending.get(m.id)?.(m); pending.delete(m.id); } if (m.method === 'Runtime.exceptionThrown') errors.push(m.params.exceptionDetails.exception?.description || m.params.exceptionDetails.text); if (m.method === 'Runtime.consoleAPICalled' && m.params.type === 'error') errors.push(m.params.args.map(a => a.value ?? a.description).join(' ')); };
  const send = (method, params = {}) => new Promise(r => { const n = ++id; pending.set(n, r); ws.send(JSON.stringify({id: n, method, params})); });
  const ev = async expression => { const r = await send('Runtime.evaluate', {expression, awaitPromise: true, returnByValue: true}); if (r.result?.exceptionDetails) throw Error(JSON.stringify(r.result.exceptionDetails)); return r.result.result.value; };
  const ready = async () => { for (let i = 0; i < 480; i++) { if (await ev('!!window.sculptCanvas&&!!window.sculptRegion&&!document.getElementById("editor").disabled')) { await ev('sculptCanvas.idle()'); return; } await sleep(150); } throw Error('Editor did not become ready: ' + errors.join('\n')); };
  const settled = () => ev('(async()=>{await sculptCanvas.idle();await sculptCanvas.features.settled();await sculptCanvas.idle();return true;})()');
  const mouse = (type, p, extra = {}) => send('Input.dispatchMouseEvent', {type, ...p, button: type === 'mouseMoved' ? 'none' : 'left', buttons: type === 'mousePressed' ? 1 : 0, clickCount: type === 'mouseMoved' ? 0 : 1, ...extra});
  const click = async (p, extra = {}) => { await mouse('mouseMoved', p, extra); await mouse('mousePressed', p, extra); await mouse('mouseReleased', p, extra); await sleep(60); };
  const drag = async (a, b) => { await mouse('mouseMoved', a); await mouse('mousePressed', a); for (let i = 1; i <= 8; i++) { await mouse('mouseMoved', {x: a.x + (b.x - a.x) * i / 8, y: a.y + (b.y - a.y) * i / 8}, {button: 'left', buttons: 1}); await sleep(25); } await mouse('mouseReleased', b); await sleep(60); };
  const key = async name => { await send('Input.dispatchKeyEvent', {type: 'keyDown', key: name, code: name}); await send('Input.dispatchKeyEvent', {type: 'keyUp', key: name, code: name}); await sleep(60); };
  const press = selector => ev(`document.querySelector(${JSON.stringify(selector)}).click(),true`);
  const set = (selector, value) => ev(`(()=>{const e=document.querySelector(${JSON.stringify(selector)});e.value=${JSON.stringify(String(value))};e.dispatchEvent(new Event('input',{bubbles:true}));e.dispatchEvent(new Event('change',{bubbles:true}));return true;})()`);
  const shot = async (name, clip) => { const r = await send('Page.captureScreenshot', {format: 'png', ...(clip ? {clip: {...clip, scale: 1}} : {})}); writeFileSync(join(out, name), Buffer.from(r.result.data, 'base64')); };
  // A map point (pixels, as placements are stored) to the screen, through the editor's own projection of the feature's anchor.
  const screenOf = (kind, x, z) => ev(`(()=>{const f=sculptCanvas.features,i=f.placements.findIndex(p=>p.kind==='${kind}'&&p.x===${x}&&p.z===${z}),a=f.viewPoint(i),v=sculptCanvas.view(),r=document.getElementById('overlay').getBoundingClientRect();return a&&{x:Math.round(r.left+(a.x-v.x)*v.scale),y:Math.round(r.top+(a.y-v.y)*v.scale)};})()`);
  const groundScreen = (mx, mz) => ev(`(()=>{const v=sculptCanvas.view(),r=document.getElementById('overlay').getBoundingClientRect();return {x:Math.round(r.left+(${mx}-v.x)*v.scale),y:Math.round(r.top+(${mz}-v.y)*v.scale)};})()`);
  const placements = () => ev('sculptCanvas.features.serialize().features');
  await send('Runtime.enable'); await send('Page.enable'); await send('Emulation.setDeviceMetricsOverride', {width: 1440, height: 900, deviceScaleFactor: 1, mobile: false});

  await send('Page.navigate', {url: `${server}/sculpt.html?biome=green&mapX=4&mapY=4&scratch=features-test&gpuMB=512&heapMB=1536`}); await ready();
  await ev('(async()=>{sculptCanvas.zoom(1);const v=document.getElementById("viewport");v.scrollLeft=256;v.scrollTop=256;v.dispatchEvent(new Event("scroll"));await sculptCanvas.idle();return true;})()');
  // The Features tool opens on Place, metal deposits; the set's variants are pictured.
  await press('#feature-tool');
  assert.equal(await ev('sculptCanvas.features.active'), true); assert.equal(await ev('document.getElementById("feature-place").hidden'), false);
  assert.equal(await ev('document.getElementById("feature-kind").value'), 'deposit'); assert.equal(await ev('document.getElementById("feature-kind-note").textContent'), '');
  await settled(); await sleep(300);
  assert.equal(await ev('document.querySelectorAll("#feature-variants button[data-variant]").length'), 4);
  assert.equal(await ev('[...document.querySelectorAll("#feature-variants canvas")].filter(c=>c.dataset.drawn).length'), 4);
  // Place a deposit at a ground point, then the second tree variant, then a random rock.
  await click(await groundScreen(600, 520)); let list = await placements();
  assert.equal(list.length, 1); assert.equal(list[0].kind, 'deposit'); assert.equal(list[0].metal, 127);
  const deposit = list[0];
  await set('#feature-kind', 'tree'); await settled(); await press('#feature-variants button[data-variant="1"]');
  await click(await groundScreen(520, 400)); await click(await groundScreen(560, 400));
  await set('#feature-kind', 'rock'); await click(await groundScreen(700, 420));
  list = await placements(); assert.equal(list.length, 4); assert.deepEqual(list.filter(p => p.kind === 'tree').map(p => p.v), [1, 1]); assert.equal(list.filter(p => p.kind === 'rock').length, 1);
  report.place = list.map(p => `${p.kind}${p.v}@${p.x},${p.z}`).join(' ');
  // A set edit keeps placed features; New set draws other looks and one undo brings the old seed back.
  await set('#feature-kind', 'tree'); const seed = await ev('sculptCanvas.features.serialize().featureSet.tree.recipes[0].seed');
  await set('#feature-count', 9); assert.equal(await ev('sculptCanvas.features.serialize().featureSet.tree.recipes[0].count'), 9); assert.equal((await placements()).length, 4);
  await press('#feature-new-set'); assert.notEqual(await ev('sculptCanvas.features.serialize().featureSet.tree.recipes[0].seed'), seed);
  await press('#undo'); await ready(); assert.equal(await ev('sculptCanvas.features.serialize().featureSet.tree.recipes[0].seed'), seed);
  await settled(); await shot('panel-trees.png', {x: 1137, y: 50, width: 303, height: 700});
  // The artist colors and rock angularity: an edit is kept in the set, redraws the kind's variants, keeps placements, and undoes.
  const thumb = () => ev('(()=>{const c=document.querySelector("#feature-variants button[data-variant=\\"0\\"] canvas");return c&&c.dataset.drawn?c.toDataURL():"";})()');
  const leaf0 = await ev('sculptCanvas.features.serialize().featureSet.tree.recipes[0].color'), before = await thumb();
  await set('#feature-tree-color', '#b8732a'); await settled();
  assert.equal(await ev('sculptCanvas.features.serialize().featureSet.tree.recipes[0].color'), '#b8732a'); assert.equal((await placements()).length, 4);
  const after = await thumb(); assert.ok(before && after && after !== before, 'the leaf color redraws the variants');
  await press('#undo'); await ready(); assert.equal(await ev('sculptCanvas.features.serialize().featureSet.tree.recipes[0].color'), leaf0);
  await set('#feature-kind', 'rock'); await set('#feature-angular', 0.1); await set('#feature-rock-color', '#b07a5a'); await settled();
  assert.deepEqual(await ev('(({angular,color})=>({angular,color}))(sculptCanvas.features.serialize().featureSet.rock.recipes[0])'), {angular: 0.1, color: '#b07a5a'});
  await shot('panel-rocks.png', {x: 1137, y: 50, width: 303, height: 700});
  report.controls = 'leaf color redraws and undoes; rock angularity and color are kept in the set';
  // Select (V): click the deposit, drag it 4 cells right and 2 down, set its metal, re-roll it.
  await key('Escape'); await press('[data-tool="move"]'); await settled();
  await click(await screenOf('deposit', deposit.x, deposit.z));
  assert.deepEqual(await ev('sculptCanvas.features.selected().length'), 1); assert.equal(await ev('document.getElementById("feature-selection").hidden'), false);
  assert.equal(await ev('document.getElementById("feature-selection-metal-control").hidden'), false); assert.match(await ev('document.getElementById("feature-selection-title").textContent'), /^Metal deposit · variant \d of 4$/);
  await shot('select-deposit.png');
  const from = await screenOf('deposit', deposit.x, deposit.z); await drag(from, {x: from.x + 64, y: from.y + 32});
  list = await placements(); const moved = list.find(p => p.kind === 'deposit');
  assert.deepEqual([moved.x, moved.z], [deposit.x + 4, deposit.z + 2]); report.drag = `deposit ${deposit.x},${deposit.z} -> ${moved.x},${moved.z}`;
  await set('#feature-selection-metal', 205); assert.equal((await placements()).find(p => p.kind === 'deposit').metal, 205);
  await settled(); await shot('deposit-metal-205.png');
  const v0 = moved.v; await press('#feature-reroll'); assert.notEqual((await placements()).find(p => p.kind === 'deposit').v, v0);
  // Shift-click adds a tree; Delete removes both; one undo restores them, the next the re-roll.
  const tree = list.find(p => p.kind === 'tree'); await click(await screenOf('tree', tree.x, tree.z), {modifiers: 8});
  assert.equal(await ev('sculptCanvas.features.selected().length'), 2); assert.equal(await ev('document.getElementById("feature-selection-title").textContent'), '2 features selected');
  await key('Delete'); assert.equal((await placements()).length, 2);
  await press('#undo'); await ready(); list = await placements(); assert.equal(list.length, 4); assert.equal(list.find(p => p.kind === 'deposit').metal, 205);
  await press('#undo'); await ready(); assert.equal((await placements()).find(p => p.kind === 'deposit').v, v0);
  await press('#undo'); await ready(); assert.equal((await placements()).find(p => p.kind === 'deposit').metal, 127);
  await press('#undo'); await ready(); const back = (await placements()).find(p => p.kind === 'deposit'); assert.deepEqual([back.x, back.z], [deposit.x, deposit.z]);
  report.undo = 'delete, re-roll, metal and move each undo';
  // A drag onto another feature is refused.
  const rock = list.find(p => p.kind === 'rock'), at = await screenOf('deposit', back.x, back.z); await click(at);
  const target = await screenOf('rock', rock.x, rock.z); await drag(at, target);
  assert.deepEqual((({x, z}) => [x, z])((await placements()).find(p => p.kind === 'deposit')), [back.x, back.z]);
  // The export packs them: every placed feature in the archive's TNT, its sections and sprite bank in the archive, the self-check passed.
  for (let i = 0; i < 2400 && await ev(`document.getElementById('map-export').disabled`); i++) await sleep(250);
  const exported = await ev(`sculptMap.export('Features Test '+Date.now()%1e6).then(r => ({count: r.featureCount, check: r.selfCheck, placed: sculptCanvas.features.serialize().features.length}), e => ({error: e.message}))`);
  assert.equal(exported.error, undefined); assert.equal(exported.count, exported.placed); assert.equal(exported.check.archive, true); report.export = `${exported.count} features exported, self-check passed`;
  // A saved feature that does not fit is left out and said so.
  const loaded = await ev(`(async()=>{const s=sculptRegion.sketch();s.mapData={...s.mapData,features:[{name:'Tree1',x:5,z:5},...s.mapData.features]};sculptRegion.loadSketch(s);await sculptCanvas.idle();return {n:sculptCanvas.features.serialize().features.length,status:document.getElementById('status').textContent};})()`);
  assert.equal(loaded.n, 4); assert.match(loaded.status, /1 saved feature does not fit this world or map and was left out/); report.unfit = loaded.status;
  report.select = 'select, drag, metal, re-roll, Shift-add, Delete, refused overlap';
  // Every world places every kind: a kind its table lacks is Green's (sculpt.py biome_config), lit by the world's own sun. Moon has rocks of its
  // own and Green's trees, shrubs and scars; Zhon has no table and takes all four.
  for (const world of ['moon', 'zhon']) {
    await send('Page.navigate', {url: `${server}/sculpt.html?biome=${world}&mapX=4&mapY=4&scratch=features-test-${world}&gpuMB=512&heapMB=1536`}); await ready();
    await press('#feature-tool');
    assert.equal(await ev('document.getElementById("feature-kind-note").textContent'), '');
    assert.deepEqual(await ev('[...document.getElementById("feature-kind").options].filter(o=>!o.disabled).map(o=>o.value).sort()'), ['deposit', 'rock', 'scar', 'shrub', 'tree', 'vent']);
    assert.equal(await ev('document.querySelector("[data-feature-mode=fill]").disabled'), false);
    assert.equal(await ev('sculptCanvas.features.addFeature("rock",20,20)'), true); assert.equal(await ev('sculptCanvas.features.addFeature("tree",30,30)'), true);
    await settled(); await shot(`${world}-rock-tree.png`);
  }
  report.everyWorld = 'Moon and Zhon place every kind (a kind a world lacks is Green\'s)';
  // The shared catalog: import, duplicate, recolor, edit and place independently.
  await send('Page.navigate', {url: `${server}/sculpt.html?biome=green&mapX=4&mapY=4&gpuMB=512&heapMB=1536`}); await ready();
  await press('#feature-tool'); await set('#feature-kind','tree');
  await set('#feature-preset','red-tree-0'); await press('#feature-add-recipe');
  await set('#feature-recipe-name','Blue tendrils'); await set('#feature-tree-color','#325caa'); await set('#feature-form-tree-curl',.8);
  await set('#feature-form-tree-arms',12); await set('#feature-form-tree-reach',60); await set('#feature-form-tree-thick',6);
  await set('#feature-form-tree-reachVariation',35); await set('#feature-form-tree-thickVariation',20);
  assert.equal(await ev('document.getElementById("feature-tree-accent-color").disabled'),true);
  await set('#feature-form-tree-accentAmount',55); await set('#feature-tree-accent-color','#b8c277'); await set('#feature-form-tree-patternScale',9);
  assert.equal(await ev('document.getElementById("feature-tree-accent-color").disabled'),false);
  await settled();
  const artistParams=await ev('sculptCanvas.features.serialize().featureSet.tree.recipes[1].params');
  assert.deepEqual(artistParams,{curl:.8,arms:12,reach:60,thick:3,reachVariation:.35,thickVariation:.2,accentAmount:.55,accentColor:'#b8c277',patternScale:9});
  // Canopy edits use the same undo/save path and expose only relevant controls.
  await set('#feature-species','broadleaf'); await set('#feature-canopy-style','palm');
  assert.equal(await ev('document.getElementById("feature-form-tree-crown").disabled'),true);
  await set('#feature-form-tree-heightVariation',40); await set('#feature-form-tree-widthVariation',25);
  assert.equal(await ev('document.getElementById("feature-form-tree-heightVariation").value'),'40');
  await set('#feature-form-tree-widthVariation','');
  assert.equal(await ev('"widthVariation" in sculptCanvas.features.serialize().featureSet.tree.recipes[1].params'),false);
  for(let i=0;i<5;i++){await press('#undo');await ready();}
  await settled();
  assert.deepEqual(await ev('sculptCanvas.features.serialize().featureSet.tree.recipes[1].params'),artistParams);
  assert.equal(await ev('document.getElementById("feature-form-tree-width").disabled'),true);
  assert.match(await ev('document.getElementById("feature-form-tree-width").title'),/reach/);
  assert.equal(await ev('sculptCanvas.features.addFeature("tree",20,20)'),true);
  const firstRecipe=await ev('sculptCanvas.features.serialize().featureSet.tree.recipes[1]');
  await press('#feature-duplicate-recipe'); await set('#feature-recipe-name','Gold tendrils'); await set('#feature-tree-color','#bba144');
  assert.equal(await ev('sculptCanvas.features.addFeature("tree",30,20)'),true);
  assert.deepEqual(await ev('sculptCanvas.features.serialize().featureSet.tree.recipes[1]'),firstRecipe);
  await set('#feature-count',2); const mixed=await ev('sculptCanvas.features.serialize()');
  assert.equal(mixed.features.filter(p=>p.kind==='tree').every(p=>p.v>=16),true);
  await set('#feature-kind','rock'); await set('#feature-preset','lava-rock-0'); await press('#feature-add-recipe');
  await set('#feature-rock-color','#6977a5'); await set('#feature-form-rock-tall',.6); await set('#feature-form-rock-heightVariation',25); await set('#feature-form-rock-widthVariation',35);
  assert.equal(await ev('sculptCanvas.features.addFeature("rock",40,30)'),true);
  // A larger footprint edit is atomic: an invalid map keeps its recipes and placements.
  assert.equal(await ev('sculptCanvas.features.changeSet("rock",{params:{cells:"16x16"}})'),true);
  assert.equal(await ev('sculptCanvas.features.addFeature("tree",56,30)'),true);
  const safe=await ev('sculptCanvas.features.serialize()');
  assert.equal(await ev('sculptCanvas.features.changeSet("tree",{params:{cells:"16x16"}})'),false);
  assert.deepEqual(await ev('sculptCanvas.features.serialize()'),safe);
  await press('#undo'); await ready(); // undo the neighboring tree
  await press('#undo'); await ready(); // undo the large footprint
  // Fill mixes the map's independent recipes and keeps their stable variant addresses.
  const filled=await ev('sculptCanvas.features.fillRegion("tree",{type:"brush",points:[{x:1152,z:768}],radius:80},{density:50,margin:0,gap:1,seed:27})');
  assert.ok(filled.added>0);
  assert.ok(await ev('sculptCanvas.features.serialize().fill.generated.some(p=>p.v>=16)'));
  await press('#undo');await ready();
  assert.equal(await ev('sculptCanvas.features.serialize().fill.generated.length'),0);
  // Reorder recipes and reload: placed variant addresses still resolve to the same recipes.
  const beforeReorder=await ev('sculptCanvas.features.serialize()');
  await ev('(()=>{const s=sculptRegion.sketch();s.mapData.featureSet.tree.recipes.reverse();sculptRegion.loadSketch(s);return true;})()'); await ready();
  assert.deepEqual(await placements(),beforeReorder.features);
  await ev('(async()=>{sculptCanvas.zoom(1);const v=document.getElementById("viewport");v.scrollLeft=180;v.scrollTop=100;v.dispatchEvent(new Event("scroll"));await sculptCanvas.idle();return true;})()'); await settled(); await shot('mixed-recipes.png');
  const saved=await ev('sculptCanvas.features.serialize()');
  await set('#biome-select','biome:moon'); await sleep(500); await ready();
  assert.equal(await ev('sculptRegion.sketch().biome'),'moon');
  assert.deepEqual(await ev('sculptCanvas.features.serialize().featureSet'),saved.featureSet);
  assert.deepEqual(await placements(),saved.features);
  await ev('(async()=>{sculptCanvas.zoom(1);const v=document.getElementById("viewport");v.scrollLeft=180;v.scrollTop=100;v.dispatchEvent(new Event("scroll"));await sculptCanvas.idle();return true;})()'); await settled(); await shot('mixed-recipes-moon.png');
  const pack=await ev(`sculptMap.export('Mixed Recipes').then(r=>({count:r.featureCount,check:r.selfCheck}),e=>({error:e.message}))`);
  assert.equal(pack.error,undefined);assert.equal(pack.count,saved.features.length);assert.equal(pack.check.archive,true);
  // Custom worlds capture their recipes; clearing a map uses those defaults.
  await set('#world-new-name','Recipe test world');await press('#world-new');await sleep(500);await ready();
  assert.deepEqual(await ev('sculptCanvas.features.serialize().featureSet'),saved.featureSet);
  await ev('sculptCanvas.features.load({}),true');
  assert.deepEqual(await ev('sculptCanvas.features.serialize().featureSet'),saved.featureSet);
  const worldFile=await ev(`(async()=>{const original=URL.createObjectURL;let blob;try{URL.createObjectURL=b=>{blob=b;return original(b);};document.getElementById('world-export').click();return JSON.parse(await blob.text());}finally{URL.createObjectURL=original;}})()`);
  assert.deepEqual(worldFile.world.featureSet,saved.featureSet);
  const worldPath=join(out,'mixed.world.json');writeFileSync(worldPath,JSON.stringify(worldFile));
  const dom=await send('DOM.getDocument'),fileNode=await send('DOM.querySelector',{nodeId:dom.result.root.nodeId,selector:'#world-file'});
  await send('DOM.setFileInputFiles',{nodeId:fileNode.result.nodeId,files:[worldPath]});await sleep(500);await ready();
  await ev('sculptCanvas.features.load({}),true');
  assert.deepEqual(await ev('sculptCanvas.features.serialize().featureSet'),saved.featureSet);
  report.recipes='Artist canopy, size variation, tendril and camouflage edits undo/save/export correctly. Imported Red tendrils and Lava rocks; independent colors, duplicate, count edits, atomic footprint rejection, reorder/load, fill/undo, world switch, custom-world defaults, world file export/import and archive export passed';
  assert.deepEqual(errors, []);
  console.log(JSON.stringify(report, null, 1));
} finally { ws?.close(); browser.kill(); }
