// Focused spot check: accepted World details, column edit/undo, Fill regions and navigation.
// node repro/ui-finish.mjs --server http://127.0.0.1:<yours> --port <cdp> --out /private/tmp/ui-create-curves
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {mkdirSync,writeFileSync} from 'node:fs';
import {join} from 'node:path';
import {cdpPortFree} from './cdp-port.mjs';
const args=process.argv.slice(2),opt=(k,d)=>args.includes(k)?args[args.indexOf(k)+1]:d;
const server=opt('--server','http://127.0.0.1:8955'),port=Number(opt('--port',9860)),out=opt('--out','/private/tmp/ui-finish-assets/detail-check');
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
  const key=async name=>{await send('Input.dispatchKeyEvent',{type:'keyDown',key:name,code:name,windowsVirtualKeyCode:name==='Enter'?13:name==='Escape'?27:0});await send('Input.dispatchKeyEvent',{type:'keyUp',key:name,code:name,windowsVirtualKeyCode:name==='Enter'?13:name==='Escape'?27:0});};
  const shown=selector=>ev(`(()=>{const e=document.querySelector(${JSON.stringify(selector)});if(!e)return false;const r=e.getBoundingClientRect();return r.width>0&&r.height>0;})()`);
  await send('Runtime.enable');await send('Page.enable');await send('Emulation.setDeviceMetricsOverride',{width:1440,height:900,deviceScaleFactor:1,mobile:false});const url=`${server}/?biome=green&mapX=4&mapY=4&scratch=finish-details-test&gpuMB=512&heapMB=1536&undulation=0`;
  await send('Page.navigate',{url});await ready();

  await click('#tab-world');await click('#wsec-light-shine');await click('#wtab-light-shine-shine');await ev(`document.getElementById('world-fine').checked=true;document.getElementById('world-fine').dispatchEvent(new Event('change'))`);
  const visibleShine=()=>ev(`[...document.querySelectorAll('#wtp-light-shine-shine [data-knob]')].filter(e=>e.dataset.eligible==='true').map(e=>e.dataset.knob)`);
  let keys=await visibleShine();assert(keys.includes('shineGround'));assert(!keys.includes('shineSand'));assert(keys.includes('shineSlopeGate'),'common slope gate stays');
  await click('[data-shine-material="Sand"]');keys=await visibleShine();assert(!keys.includes('shineGround'));assert(!keys.includes('shineSlope'));assert(keys.includes('shineSand'));
  await ev(`document.getElementById('world-search').value='polish';document.getElementById('world-search').dispatchEvent(new Event('input'))`);
  assert(await ev(`[...document.querySelectorAll('#knobs [data-knob]')].some(e=>e.dataset.knob==='shineGroundSharp'&&!e.hidden)`),'parenthetical searchable');
  await ev(`document.getElementById('world-search').value='';document.getElementById('world-search').dispatchEvent(new Event('input'))`);
  await click('#wsec-rock-types');await click('#wtab-rock-types-layers');await click('#column-open');
  assert(await shown('#column-panel'));assert((await ev(`document.getElementById('column-title').textContent`)).includes(await ev(`document.getElementById('rock-current-name').textContent`)));
  const oldBed=await ev(`document.querySelector('#column-panel [data-column-path$="beds.0.0"]').value`);
  await ev(`(()=>{const e=document.querySelector('#column-panel [data-column-path$="beds.0.0"]');e.value=Number(e.value)+1;e.dispatchEvent(new Event('input'));e.dispatchEvent(new Event('change'));})()`);await ready();
  assert.notEqual(await ev(`document.querySelector('#column-panel [data-column-path$="beds.0.0"]').value`),oldBed);
  await send('Page.captureScreenshot',{format:'png'}).then(r=>writeFileSync(join(out,'column-sheet.png'),Buffer.from(r.result.data,'base64')));
  await key('Escape');assert(!await shown('#column-panel'));await click('#undo');await ready();await click('#column-open');assert.equal(await ev(`document.querySelector('#column-panel [data-column-path$="beds.0.0"]').value`),oldBed);
  await click('#column-done');await click('#wsec-sand');
  const folded=await ev(`document.querySelector('#wpane-sand .unavailable-summary button')?.textContent`);assert(folded,'reason summary available');
  await ev(`document.querySelector('#wpane-sand .unavailable-summary button').focus()`);await send('Input.dispatchKeyEvent',{type:'keyDown',key:'Enter',code:'Enter',windowsVirtualKeyCode:13,nativeVirtualKeyCode:13,text:'\r'});await send('Input.dispatchKeyEvent',{type:'keyUp',key:'Enter',code:'Enter',windowsVirtualKeyCode:13});
  assert.equal(await ev(`document.querySelector('#wpane-sand .unavailable-summary button').getAttribute('aria-expanded')`),'true');
  const ids=await ev(`[...document.querySelectorAll('[id]')].map(e=>e.id)`);assert.equal(ids.length,new Set(ids).size,'IDs unique');
  await send('Page.captureScreenshot',{format:'png'}).then(r=>writeFileSync(join(out,'world-folds.png'),Buffer.from(r.result.data,'base64')));
  await click('#tab-tool');await click('#feature-tool');await ev(`document.getElementById('feature-kind').value='rock';document.getElementById('feature-kind').dispatchEvent(new Event('change'))`);
  assert.equal(await ev(`document.getElementById('tool-help').textContent`),await ev(`document.getElementById('feature-help').textContent`));assert((await ev(`document.getElementById('tool-help').textContent`)).includes('rock'));
  await ev(`document.querySelector('[data-feature-mode="fill"]').click()`);await click('[data-fill-region="lasso"]');assert.equal(await ev(`document.getElementById('fill-region').value`),'lasso');assert.equal(await ev(`document.querySelector('[data-fill-region="lasso"]').getAttribute('aria-pressed')`),'true');
  await ev(`document.getElementById('map-name').value='A very long map name to check the topbar stays usable';document.getElementById('map-name').dispatchEvent(new Event('input'))`);assert((await ev(`document.getElementById('tab-map').textContent`)).includes('A very long map name'));
  await click('#open-export');assert(await shown('#share-menu'));assert.equal(await ev(`document.getElementById('share-menu').closest('#pane-export')!==null`),true);assert.equal(await ev(`document.getElementById('share-restore').closest('#pane-map')!==null`),true);
  assert.deepEqual(errors,[]);console.log(JSON.stringify({shineMaterials:true,search:true,columnSheetEditUndo:true,foldKeyboardReveal:true,uniqueIDs:true,featureHint:true,fillSegments:true,mapName:true,shareHome:true,console:errors}));
}catch(err){console.error(err);process.exitCode=1;}finally{ws?.close();browser.kill();}
