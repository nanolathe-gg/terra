// Geological presets through the editor: a shared undo step, saved recipe and exact reload pixels.
// node repro/rock-controls-ui.mjs --server http://127.0.0.1:8904 --port 9815 --out /private/tmp/terraform-rock-controls/ui
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {mkdirSync,writeFileSync} from 'node:fs';
import {join} from 'node:path';
import {cdpPortFree} from './cdp-port.mjs';
const args=process.argv.slice(2),opt=(k,d)=>args.includes(k)?args[args.indexOf(k)+1]:d;
const server=opt('--server','http://127.0.0.1:8904'),port=Number(opt('--port',9815)),out=opt('--out','/private/tmp/terraform-rock-controls/ui');
await cdpPortFree(port);mkdirSync(out,{recursive:true});
const browser=spawn('/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',['--headless=new','--enable-gpu','--use-angle=metal',`--remote-debugging-port=${port}`,`--user-data-dir=${join(out,'profile-'+Date.now())}`,'--window-size=1440,900','--no-first-run','about:blank'],{stdio:'ignore'});
const sleep=ms=>new Promise(r=>setTimeout(r,ms));let ws;
try{
  for(let i=0;i<100&&!ws;i++){try{const tab=(await(await fetch(`http://127.0.0.1:${port}/json/list`)).json()).find(t=>t.type==='page');if(tab)ws=new WebSocket(tab.webSocketDebuggerUrl);}catch{}if(!ws)await sleep(150);}
  await new Promise(r=>ws.onopen=r);let id=0;const pending=new Map(),errors=[],report={};
  ws.onmessage=e=>{const m=JSON.parse(e.data);if(m.id){pending.get(m.id)?.(m);pending.delete(m.id);}if(m.method==='Runtime.exceptionThrown')errors.push(m.params.exceptionDetails.exception?.description||m.params.exceptionDetails.text);if(m.method==='Runtime.consoleAPICalled'&&m.params.type==='error')errors.push(m.params.args.map(a=>a.value||a.description).join(' '));};
  const send=(method,params={})=>new Promise(r=>{const n=++id;pending.set(n,r);ws.send(JSON.stringify({id:n,method,params}));});
  const ev=async expression=>{const r=await send('Runtime.evaluate',{expression,awaitPromise:true,returnByValue:true});if(r.result?.exceptionDetails)throw Error(JSON.stringify(r.result.exceptionDetails));return r.result.result.value;};
  const ready=async()=>{for(let i=0;i<480;i++){if(await ev('!!window.sculptCanvas&&!document.getElementById("map-export").disabled')){await ev('sculptCanvas.idle()');return;}await sleep(150);}throw Error('Editor did not become ready: '+errors.join('\n'));};
  const point=selector=>ev(`(()=>{const e=document.querySelector(${JSON.stringify(selector)});e.scrollIntoView({block:'nearest'});const r=e.getBoundingClientRect();return {x:r.x+r.width/2,y:r.y+r.height/2};})()`);
  const mouse=(type,p,extra={})=>send('Input.dispatchMouseEvent',{type,...p,button:type==='mouseMoved'?'none':'left',buttons:type==='mousePressed'?1:0,clickCount:type==='mouseMoved'?0:1,...extra});
  const click=async selector=>{const p=await point(selector);await mouse('mousePressed',p);await mouse('mouseReleased',p);};
  const doubleClick=async selector=>{const p=await point(selector);for(const clickCount of [1,2]){await mouse('mousePressed',p,{clickCount});await mouse('mouseReleased',p,{clickCount});}};
  const drag=async(a,b)=>{await mouse('mousePressed',a);for(let i=1;i<=6;i++){await mouse('mouseMoved',{x:a.x+(b.x-a.x)*i/6,y:a.y+(b.y-a.y)*i/6},{button:'left',buttons:1});await sleep(20);}await mouse('mouseReleased',b);};
  const key=async name=>{await send('Input.dispatchKeyEvent',{type:'keyDown',key:name});await send('Input.dispatchKeyEvent',{type:'keyUp',key:name});};
  const nodes=()=>ev('sculptDebug.nodes()');
  await send('Runtime.enable');await send('Page.enable');await send('Emulation.setDeviceMetricsOverride',{width:1440,height:900,deviceScaleFactor:1,mobile:false});
  await send('Page.navigate',{url:`${server}/sculpt.html?biome=green&mapX=4&mapY=4&gpuMB=512&heapMB=1536&undulation=0`});await ready();
  await ev(`sculptDebug.scene([['landform',[[200,500],[800,500]],{card:{diameter:400,elevation:210,styleVegetation:0}}]],{ground:true}); true`);await ready();
  const set=async(id,value)=>{await ev(`(()=>{const e=document.getElementById(${JSON.stringify(id)});e.value=${JSON.stringify(String(value))};e.dispatchEvent(new Event('input',{bubbles:true}));e.dispatchEvent(new Event('change',{bubbles:true}));})()`);await ready();};
  const snapshot=()=>ev(`(()=>{const s=sculptDebug.sketch();return {rock:s.rock,column:s.column||null};})()`);
  const capture=()=>ev(`(async()=>{const b=await sculptCanvas.debugBake({x:256,y:256,width:512,height:512}),c=document.createElement('canvas');c.width=c.height=512;c.getContext('2d').drawImage(b,0,0);return c.toDataURL();})()`);
  await click('#tab-world');await ev(`document.getElementById('rock-preset').scrollIntoView({block:'center'});true`);
  assert.equal(await ev(`(()=>{const e=document.getElementById('rock-preset'),r=e.getBoundingClientRect();return r.width>100&&r.height>10&&e.checkVisibility();})()`),true);
  const original=await snapshot();
  await set('rock-preset','sandstone');const sand=await snapshot(),sandArt=await capture();
  assert.equal(await ev('document.getElementById("rock-preset").value'),'sandstone');
  await click('#undo');await ready();assert.deepEqual(await snapshot(),original);
  await click('#redo');await ready();assert.deepEqual(await snapshot(),sand);assert.equal(await capture(),sandArt);report.presetUndo='one undo and redo restore settings, column and pixels';
  await set('knob-faceRound',.6);assert.equal(await ev('document.getElementById("rock-preset").value'),'');await click('#undo');await ready();assert.deepEqual(await snapshot(),sand);report.sliderUndo='one undo restores the slider and named preset';
  for(const [key,value] of Object.entries({runoff:1.2,runoffScale:48,runoffConcentration:.4,runoffCut:5,runoffStain:.8,debrisAmount:1.5,debrisReach:92,debrisDepth:8,stoneSort:.2})){
    await set('knob-'+key,value);assert.equal((await snapshot()).rock[key],value);await click('#undo');await ready();assert.deepEqual(await snapshot(),sand);
  }
  report.weatheringUndo='all nine transport/sorting controls restore in one undo';
  const saved=await ev('sculptDebug.sketch()');writeFileSync(join(out,'rock-controls-demo.json'),JSON.stringify(saved,null,2));
  await set('rock-preset','granite');const graniteArt=await capture();assert.notEqual(graniteArt,sandArt);
  await ev(`sculptDebug.loadSketch(${JSON.stringify(saved)}); true`);await ready();assert.deepEqual(await snapshot(),sand);assert.equal(await capture(),sandArt);report.recipe='save/load restores identical rock pixels';
  await sleep(900);await send('Page.reload',{ignoreCache:true});await ready();assert.deepEqual(await snapshot(),sand);assert.equal(await capture(),sandArt);report.reload='autosave restores identical settings and pixels';
  await ev(`(()=>{const s=sculptDebug.sketch();s.rock.faceRound=2;try{sculptDebug.loadSketch(s);return false;}catch{return true;}})()`).then(ok=>assert(ok));assert.deepEqual(await snapshot(),sand);report.invalid='invalid rock recipe leaves the map intact';
  for(const key of ['shale','basalt','limestone']){await set('rock-preset',key);assert.equal(await ev('document.getElementById("rock-preset").value'),key);}
  await set('knob-faceLamina',0);assert.equal(await ev('document.getElementById("knob-faceLaminaSize").disabled'),true);await set('knob-faceLamina',1);assert.equal(await ev('document.getElementById("knob-faceLaminaSize").disabled'),false);report.dependency='fine layer spacing explains its inactive parent';
  await set('knob-runoff',0);assert.equal(await ev('document.getElementById("knob-runoffCut").disabled'),true);
  await set('knob-debrisAmount',0);assert.equal(await ev('document.getElementById("knob-debrisReach").disabled'),true);
  report.weatheringDependencies='runoff and debris children explain inactive parents';
  await set('rock-preset','sandstone');await click('#tab-world');await ev(`(()=>{const e=document.querySelector('[data-group="Rock & cliffs"]');e.open=true;document.getElementById('rock-preset').scrollIntoView({block:'center'});sculptCanvas.zoom(1);document.getElementById('viewport').scrollTo(0,200);return true;})()`);await ready();await sleep(300);
  const shot=await send('Page.captureScreenshot',{format:'png'});writeFileSync(join(out,'editor.png'),Buffer.from(shot.result.data,'base64'));
  assert.deepEqual(errors,[]);writeFileSync(join(out,'report.json'),JSON.stringify(report,null,2));console.log(JSON.stringify(report));
}finally{ws?.close();browser.kill();}
