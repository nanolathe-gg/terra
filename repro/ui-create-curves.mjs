// Focused spot check: first-run/New and previous-map restoration, numeric curves, live preview, and progress.
// node repro/ui-create-curves.mjs --server http://127.0.0.1:<yours> --port <cdp> --out /private/tmp/ui-create-curves
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {mkdirSync,writeFileSync} from 'node:fs';
import {join} from 'node:path';
import {cdpPortFree} from './cdp-port.mjs';
const args=process.argv.slice(2),opt=(k,d)=>args.includes(k)?args[args.indexOf(k)+1]:d;
const server=opt('--server','http://127.0.0.1:8953'),port=Number(opt('--port',9840)),out=opt('--out','/private/tmp/ui-redesign-spot');
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
  const rect=selector=>ev(`(()=>{const e=document.querySelector(${JSON.stringify(selector)});if(!e||e.closest('[hidden]'))return null;const r=e.getBoundingClientRect();return {x:Math.round(r.x),y:Math.round(r.y),width:Math.round(r.width),height:Math.round(r.height)};})()`);
  const shown=selector=>ev(`(()=>{const e=document.querySelector(${JSON.stringify(selector)});if(!e)return false;const r=e.getBoundingClientRect();return r.width>0&&r.height>0;})()`);
  // A tool is picked as an artist picks it: from the palette when it is expanded, else through its group's button on the rail.
  const pick=async tool=>{const sel=`[data-tool="${tool}"]`;if(!await shown(sel)){await click('#'+await ev(`document.querySelector(${JSON.stringify(sel)}).closest('.tool-group').querySelector('.rail-button').id`));assert(await shown(sel),tool+' shows in its flyout');}await click(sel);};
  const selectLast=async()=>{if(await ev('document.getElementById("pane-objects").hidden'))await click('#tab-objects');if(await ev('document.querySelector("#layers li:last-child .layer-name").getAttribute("aria-pressed")')!=='true')await click('#layers li:last-child .layer-name');await click('#tab-tool');};
  const top=()=>ev('document.querySelector(".inspector-content").scrollTop=0');
  await send('Runtime.enable');await send('Page.enable');await send('Emulation.setDeviceMetricsOverride',{width:1440,height:900,deviceScaleFactor:1,mobile:false});const url=`${server}/?biome=green&mapX=4&mapY=4&scratch=create-curves-test&gpuMB=512&heapMB=1536&undulation=0`;
  await send('Page.navigate',{url});await ready();
  await ev('localStorage.clear()');await send('Page.navigate',{url:server+'/index.html'});await ready();
  assert(await ev('document.getElementById("new-map-dialog").open'),'first run opens the picker');
  await ev(`document.getElementById('new-map-name').value='First map';document.querySelector('#new-map-worlds [data-world="green"]').click();document.getElementById('new-map-create').click()`);await sleep(300);await ready();
  assert.equal(await ev('document.getElementById("map-name").value'),'First map');assert.equal(await ev('document.getElementById("new-map-dialog").open'),false);
  assert.equal((await nodes()).length,0,'new map has no ground undulation or shapes');
  await pick('hill');await drag({x:450,y:290},{x:660,y:340});await ready();await ev('sculptRegion.select(sculptDebug.nodes().length-1)');await ready();
  await click('#curve-large');assert(await shown('#curve-numbers'));await ev(`document.getElementById('curve-point-index').value='1';document.getElementById('curve-point-index').dispatchEvent(new Event('change'))`);
  const original=await ev('sculptDebug.curve()');
  await ev(`document.getElementById('curve-point-y').value='.7';document.getElementById('curve-point-y').dispatchEvent(new Event('change',{bubbles:true}))`);await ready();
  assert.equal((await ev('sculptDebug.curve()')).knots[1][1],.7);
  await click('#curve-raise');await ready();assert.equal((await ev('sculptDebug.curve()')).knots[1][1],.75);
  await click('#undo');await ready();assert.equal((await ev('sculptDebug.nodes()')).at(-1).params.curve.knots[1][1],.7);
  await ev('sculptRegion.select(sculptDebug.nodes().length-1)');await ready();await click('#curve-large');
  await ev(`document.getElementById('curve-point-side').value='back';document.getElementById('curve-point-side').dispatchEvent(new Event('change',{bubbles:true}))`);await ready();
  assert.equal(await ev('document.getElementById("map-progress").hidden'),true,'point navigation does not leave progress busy');
  await ev(`document.getElementById('curve-point-index').value='1';document.getElementById('curve-point-index').dispatchEvent(new Event('change'));(()=>{const y=document.getElementById('curve-point-y');y.focus();y.value='999';y.dispatchEvent(new Event('change',{bubbles:true}));})()`);await ready();
  assert.equal(await ev('document.getElementById("curve-point-y").value'),'1.5','focused numeric field shows clamped height');
  await ev(`(()=>{const y=document.getElementById('curve-point-y');y.value='';y.dispatchEvent(new Event('change',{bubbles:true}));})()`);assert.equal(await ev('document.getElementById("curve-point-y").value'),'1.5','empty edit restores canonical height');
  const pendingResult=await ev(`(()=>{const e=document.getElementById('lf-elevation');for(const delta of [1,2]){e.value=Number(e.value)+delta;e.dispatchEvent(new Event('input',{bubbles:true}));e.dispatchEvent(new Event('change',{bubbles:true}));}return {busy:!document.getElementById('map-progress').hidden,dot:!!document.querySelector('.render-pending')};})()`);assert.deepEqual(pendingResult,{busy:true,dot:true});await ready();assert.equal(await ev('document.getElementById("map-progress").hidden'),true);assert.equal(await ev('document.querySelectorAll(".render-pending").length'),0);

  assert(await ev(`document.getElementById('curve-shape-preview').getContext('2d').getImageData(0,0,240,160).data.some((v,i)=>i%4===3&&v)`),'live terrain preview has rendered pixels');
  await send('Page.captureScreenshot',{format:'png'}).then(r=>writeFileSync(join(out,'curves.png'),Buffer.from(r.result.data,'base64')));
  await key('Escape');const kept=await ev('sculptDebug.sketch()');await click('#new-map');await ev(`document.getElementById('new-map-name').value='Second map';document.querySelector('#new-map-worlds [data-world="moon"]').click();document.getElementById('new-map-width').value='2';document.getElementById('new-map-height').value='3';document.getElementById('new-map-create').click()`);await sleep(300);await ready();
  assert.equal(await ev('sculptDebug.biome'),'moon');assert.equal(await ev('document.getElementById("map-name").value'),'Second map');assert.equal((await nodes()).length,0);assert.deepEqual(await ev('sculptDebug.sketch().map.unitsX'),2);
  await ev(`document.getElementById('share-restore').click()`);await sleep(300);await ready();
  assert.equal(await ev('sculptDebug.biome'),'green');assert.equal(await ev('document.getElementById("map-name").value'),'First map');assert.deepEqual(await ev('sculptDebug.sketch().nodes.map(n=>({...n,hidden:Boolean(n.hidden)}))'),kept.nodes.map(n=>({...n,hidden:Boolean(n.hidden)})));
  assert.equal(await ev('document.getElementById("map-progress").hidden'),true,'progress ends after latest result is displayed');
  assert.deepEqual(errors,[]);console.log(JSON.stringify({firstRun:true,newFlat:true,worldAndSize:true,previousRestored:true,numericPoint:true,raiseUndo:true,livePreview:true,noOpProgress:true,console:errors}));
}catch(err){console.error(err);process.exitCode=1;}finally{ws?.close();browser.kill();}
