// Geological presets through the editor: a shared undo step, saved recipe and exact reload pixels.
// node repro/rock-controls-ui.mjs --server http://127.0.0.1:8904 --port 9815 --out /tmp/terraform-rock-controls/ui
import {chromePath, chromeGpuFlags} from './chrome.mjs';
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {mkdirSync,readFileSync,writeFileSync} from 'node:fs';
import {join} from 'node:path';
import {cdpPortFree} from './cdp-port.mjs';
const args=process.argv.slice(2),opt=(k,d)=>args.includes(k)?args[args.indexOf(k)+1]:d;
const server=opt('--server','http://127.0.0.1:8904'),port=Number(opt('--port',9815)),out=opt('--out','/tmp/terraform-rock-controls/ui');
await cdpPortFree(port);mkdirSync(out,{recursive:true});
const browser=spawn(chromePath,['--headless=new',...chromeGpuFlags,`--remote-debugging-port=${port}`,`--user-data-dir=${join(out,'profile-'+Date.now())}`,'--window-size=1440,900','--no-first-run','about:blank'],{stdio:'ignore'});
const sleep=ms=>new Promise(r=>setTimeout(r,ms));let ws;
try{
  for(let i=0;i<100&&!ws;i++){try{const tab=(await(await fetch(`http://127.0.0.1:${port}/json/list`)).json()).find(t=>t.type==='page');if(tab)ws=new WebSocket(tab.webSocketDebuggerUrl);}catch{}if(!ws)await sleep(150);}
  await new Promise(r=>ws.onopen=r);let id=0;const pending=new Map(),errors=[],report={};
  ws.onmessage=e=>{const m=JSON.parse(e.data);if(m.id){pending.get(m.id)?.(m);pending.delete(m.id);}if(m.method==='Runtime.exceptionThrown')errors.push(m.params.exceptionDetails.exception?.description||m.params.exceptionDetails.text);if(m.method==='Runtime.consoleAPICalled'&&m.params.type==='error')errors.push(m.params.args.map(a=>a.value||a.description).join(' '));};
  const send=(method,params={})=>new Promise(r=>{const n=++id;pending.set(n,r);ws.send(JSON.stringify({id:n,method,params}));});
  const ev=async expression=>{const r=await send('Runtime.evaluate',{expression,awaitPromise:true,returnByValue:true});if(r.result?.exceptionDetails)throw Error(JSON.stringify(r.result.exceptionDetails));return r.result.result.value;};
  const ready=async()=>{for(let i=0;i<480;i++){if(await ev('!!window.sculptCanvas&&!document.getElementById("map-export").disabled')){await ev('sculptCanvas.idle()');return;}await sleep(150);}throw Error('Editor did not become ready: '+errors.join('\n'));};
  const point=selector=>ev(`(()=>{const e=document.querySelector(${JSON.stringify(selector)});e.scrollIntoView({block:'nearest'}),window.scrollTo(0,0);const r=e.getBoundingClientRect();return {x:r.x+r.width/2,y:r.y+r.height/2};})()`);
  const mouse=(type,p,extra={})=>send('Input.dispatchMouseEvent',{type,...p,button:type==='mouseMoved'?'none':'left',buttons:type==='mousePressed'?1:0,clickCount:type==='mouseMoved'?0:1,...extra});
  const click=async selector=>{const p=await point(selector);await mouse('mousePressed',p);await mouse('mouseReleased',p);};
  const doubleClick=async selector=>{const p=await point(selector);for(const clickCount of [1,2]){await mouse('mousePressed',p,{clickCount});await mouse('mouseReleased',p,{clickCount});}};
  const drag=async(a,b)=>{await mouse('mousePressed',a);for(let i=1;i<=6;i++){await mouse('mouseMoved',{x:a.x+(b.x-a.x)*i/6,y:a.y+(b.y-a.y)*i/6},{button:'left',buttons:1});await sleep(20);}await mouse('mouseReleased',b);};
  const key=async name=>{await send('Input.dispatchKeyEvent',{type:'keyDown',key:name});await send('Input.dispatchKeyEvent',{type:'keyUp',key:name});};
  const nodes=()=>ev('sculptDebug.nodes()');
  await send('Runtime.enable');await send('Page.enable');await send('Emulation.setDeviceMetricsOverride',{width:1440,height:900,deviceScaleFactor:1,mobile:false});
  await send('Page.navigate',{url:`${server}/?biome=green&mapX=4&mapY=4&gpuMB=512&heapMB=1536&undulation=0`});await ready();
  await ev(`sculptDebug.scene([['landform',[[200,500],[800,500]],{card:{diameter:400,elevation:210,styleVegetation:0}}]],{ground:true}); true`);await ready();
  const set=async(id,value)=>{await ev(`(()=>{const e=document.getElementById(${JSON.stringify(id)});e.value=${JSON.stringify(String(value))};e.dispatchEvent(new Event('input',{bubbles:true}));e.dispatchEvent(new Event('change',{bubbles:true}));})()`);await ready();};
  const snapshot=()=>ev(`(()=>{const s=sculptDebug.sketch();return {rock:s.rock,column:s.column||null};})()`);
  const capture=()=>ev(`(async()=>{const b=await sculptCanvas.debugBake({x:256,y:256,width:512,height:512}),c=document.createElement('canvas');c.width=c.height=512;c.getContext('2d').drawImage(b,0,0);return c.toDataURL();})()`);
  await click('#tab-world');await ev(`document.getElementById('rock-preset').scrollIntoView({block:'center'}),window.scrollTo(0,0);true`);
  assert.equal(await ev(`(()=>{const e=document.getElementById('rock-preset'),r=e.getBoundingClientRect();return r.width>100&&r.height>10&&e.checkVisibility();})()`),true);
  const original=await snapshot();
  await set('rock-preset','sandstone');const sand=await snapshot(),sandArt=await capture();
  assert.equal(await ev('document.getElementById("rock-preset").value'),'sandstone');
  await click('#undo');await ready();assert.deepEqual(await snapshot(),original);
  await click('#redo');await ready();assert.deepEqual(await snapshot(),sand);assert.equal(await capture(),sandArt);report.presetUndo='one undo and redo restore settings, column and pixels';
  await set('knob-faceRound',.6);assert.equal(await ev('document.getElementById("rock-preset").value'),'');await click('#undo');await ready();assert.deepEqual(await snapshot(),sand);report.sliderUndo='one undo restores the slider and named preset';
  for(const [key,value] of Object.entries({faceJointWidth:2.5,faceSecondary:1.5,faceContinuity:.25,faceFresh:.9,faceRind:.9,faceRindDepth:14,faceRindTone:.4,faceRindWarmth:.9,faceRindRough:.15,bedCycleVary:.9,faceBreak:.8,faceBedVary:2.5,strata:.8,strataContrast:.95,strataGrain:.3,faceJointTilt:37,faceScaleVary:.9,faceFold:16,faceSpall:2.2,faceClast:2,faceMineral:.8,stoneRound:.65,stoneSlab:.6,runoff:1.2,runoffScale:48,runoffConcentration:.4,runoffCut:5,runoffStain:.8,debrisAmount:1.5,debrisReach:92,debrisDepth:8,stoneSort:.2})){
    await set('knob-'+key,value);assert.equal((await snapshot()).rock[key],value);await click('#undo');await ready();assert.deepEqual(await snapshot(),sand);
  }
  report.weatheringUndo='all tested structure, mineral, transport and fragment controls restore in one undo';
  // Existing Rock column slot colors, bed thickness and material assignment
  // edit the same recipe as voxel layers; palette edits must undo exactly.
  await set('knob-strata',.5);await set('knob-strataContrast',.8);
  const layerSettings=await snapshot(),layerArt=await capture();
  const columnEdit=async(path,value)=>{await ev(`(()=>{const e=document.querySelector('[data-column-path="'+${JSON.stringify(path)}+'"]');e.value=${JSON.stringify(String(value))};e.dispatchEvent(new Event('input',{bubbles:true}));e.dispatchEvent(new Event('change',{bubbles:true}));})()`);await ready();};
  await columnEdit('colors.0','#a46c48');assert.notEqual(await capture(),layerArt);await click('#undo');await ready();assert.deepEqual(await snapshot(),layerSettings);assert.equal(await capture(),layerArt);
  await columnEdit('sections.0.beds.0.0',13);assert.notEqual(await capture(),layerArt);await click('#undo');await ready();assert.deepEqual(await snapshot(),layerSettings);
  await columnEdit('sections.0.beds.0.2',2);assert.notEqual(await capture(),layerArt);await click('#undo');await ready();assert.deepEqual(await snapshot(),layerSettings);
  await columnEdit('colors.0','#a46c48');await columnEdit('colors.1','#c4bda8');await columnEdit('colors.2','#74675e');
  const colored=await snapshot(),coloredArt=await capture(),coloredRecipe=await ev('sculptDebug.sketch()');
  writeFileSync(join(out,'layered-rock-demo.json'),JSON.stringify(coloredRecipe,null,2));
  await set('knob-strata',0);await columnEdit('colors.0','#304080');await ev(`sculptDebug.loadSketch(${JSON.stringify(coloredRecipe)});true`);await ready();assert.deepEqual(await snapshot(),colored);assert.equal(await capture(),coloredArt);
  report.layerPalette='slot color, bed thickness and slot assignment undo exactly; layer coverage and palette survive save/load';
  await ev(`sculptDebug.loadSketch(${JSON.stringify({...await ev('sculptDebug.sketch()'),rock:sand.rock,column:sand.column})});true`);await ready();
  const saved=await ev('sculptDebug.sketch()');writeFileSync(join(out,'rock-controls-demo.json'),JSON.stringify(saved,null,2));
  await set('rock-preset','granite');const graniteArt=await capture();assert.notEqual(graniteArt,sandArt);
  await ev(`sculptDebug.loadSketch(${JSON.stringify(saved)}); true`);await ready();assert.deepEqual(await snapshot(),sand);assert.equal(await capture(),sandArt);report.recipe='save/load restores identical rock pixels';
  await sleep(900);await send('Page.reload',{ignoreCache:true});await ready();assert.deepEqual(await snapshot(),sand);assert.equal(await capture(),sandArt);report.reload='autosave restores identical settings and pixels';
  await ev(`(()=>{const s=sculptDebug.sketch();s.rock.faceRound=2;try{sculptDebug.loadSketch(s);return false;}catch{return true;}})()`).then(ok=>assert(ok));assert.deepEqual(await snapshot(),sand);report.invalid='invalid rock recipe leaves the map intact';
  for(const key of ['shale','basalt','limestone','gneiss','schist','conglomerate','breccia']){await set('rock-preset',key);assert.equal(await ev('document.getElementById("rock-preset").value'),key);}
  await set('knob-faceClastSize',28);assert.equal((await snapshot()).rock.faceClastSize,28);await click('#undo');await ready();assert.equal((await snapshot()).rock.faceClastSize,22);
  await set('knob-faceClast',0);assert.equal(await ev('document.getElementById("knob-faceClastSize").disabled'),true);
  await set('knob-faceLamina',0);assert.equal(await ev('document.getElementById("knob-faceLaminaSize").disabled'),true);await set('knob-faceLamina',1);assert.equal(await ev('document.getElementById("knob-faceLaminaSize").disabled'),false);report.dependency='fine layer spacing explains its inactive parent';
  await set('knob-runoff',0);assert.equal(await ev('document.getElementById("knob-runoffCut").disabled'),true);
  await set('knob-debrisAmount',0);assert.equal(await ev('document.getElementById("knob-debrisReach").disabled'),true);
  report.weatheringDependencies='runoff and debris children explain inactive parents';
  await set('rock-preset','sandstone');await click('#tab-world');await ev(`(()=>{const e=document.querySelector('[data-group="Rock & cliffs"]');e.open=true;document.getElementById('rock-preset').scrollIntoView({block:'center'}),window.scrollTo(0,0);sculptCanvas.zoom(1);document.getElementById('viewport').scrollTo(0,200);return true;})()`);await ready();await sleep(300);
  const shot=await send('Page.captureScreenshot',{format:'png'});writeFileSync(join(out,'editor.png'),Buffer.from(shot.result.data,'base64'));
  await set('rock-preset','gneiss');
  await ev(`sculptDebug.scene([['mountain',[[340,560],[610,460]],{card:{diameter:500,elevation:280,roughness:20,softness:20,styleVegetation:0}}]],{ground:true}); true`);await ready();
  const mountain=await ev('sculptDebug.sketch()');writeFileSync(join(out,'gneiss-mountain-demo.json'),JSON.stringify(mountain,null,2));
  const mountainArt=await capture();await set('rock-preset','conglomerate');await ev(`sculptDebug.loadSketch(${JSON.stringify(mountain)}); true`);await ready();assert.equal(await capture(),mountainArt);report.newTypeRecipe='folded mountain recipe reloads to identical pixels';
  // A single authored rock face continues through the coast, in the normal
  // editor recipe. Chosen water tints retain the same lighting controls.
  const coast=JSON.parse(readFileSync(new URL('./fixtures/fracture-coast.json',import.meta.url)));
  await send('Page.navigate',{url:server+'/?'+coast.query});await ready();
  assert.equal(await ev('document.getElementById("weather-state").textContent'),'Weathering off · authored surface');
  await ev(`sculptDebug.scene(${JSON.stringify(coast.strokes)},{ground:true});true`);await ready();
  await ev(`sculptDebug.loadSketch({...sculptDebug.sketch(),rock:${JSON.stringify(coast.rock)}});true`);await ready();
  const coastCapture=()=>ev(`(async()=>{const b=await sculptCanvas.debugBake({x:384,y:500,width:512,height:512}),c=document.createElement('canvas');c.width=c.height=512;c.getContext('2d').drawImage(b,0,0);return c.toDataURL();})()`);
  const coastArt=await coastCapture(),coastSave=await ev('sculptDebug.sketch()');writeFileSync(join(out,'red-coast-demo.json'),JSON.stringify(coastSave,null,2));
  await click('#tab-world');
  const pickWater=async(label,color)=>{await ev(`(()=>{const row=[...document.querySelectorAll('.world-colors .color-row')].find(r=>r.firstElementChild.textContent===${JSON.stringify(label)});const pick=row.querySelector('input[type=color]');pick.value=${JSON.stringify(color)};pick.dispatchEvent(new Event('input',{bubbles:true}));pick.dispatchEvent(new Event('change',{bubbles:true}));return true;})()`);await ready();};
  await pickWater('Shallow water','#528799');await pickWater('Deep water','#102938');const coloredCoast=await coastCapture();assert.notEqual(coloredCoast,coastArt);
  for(const k of ['bedTint','bedBright','bedContrast'])assert.equal(await ev(`document.getElementById('knob-${k}').disabled`),false,k+' remains enabled with picked colors');
  await set('knob-bedTint',0);assert.notEqual(await coastCapture(),coloredCoast);await set('knob-bedTint',.95);assert.equal(await coastCapture(),coloredCoast);
  // Water colors and existing bed settings belong to the world, not the map's
  // rock recipe. Restore the two overrides explicitly before testing that recipe.
  await ev(`(()=>{for(const label of ['Shallow water','Deep water']){const row=[...document.querySelectorAll('.world-colors .color-row')].find(r=>r.firstElementChild.textContent===label);const box=row.querySelector('input[type=checkbox]');box.checked=false;box.dispatchEvent(new Event('change',{bubbles:true}));}return true;})()`);await ready();
  await ev(`sculptDebug.loadSketch(${JSON.stringify(coastSave)});true`);await ready();assert.equal(await coastCapture(),coastArt);
  await sleep(900);await send('Page.reload',{ignoreCache:true});await ready();assert.equal(await coastCapture(),coastArt);
  report.coast='coastal fracture recipe reloads exactly; chosen water colors keep bed controls live; restoring tint restores exact pixels; zero erosion keeps export ready';
  assert.deepEqual(errors,[]);writeFileSync(join(out,'report.json'),JSON.stringify(report,null,2));console.log(JSON.stringify(report));
}finally{ws?.close();browser.kill();}
