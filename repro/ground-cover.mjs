// Vegetation controls and flower colors: live material edits, dependencies, and world-file round trip.
// node repro/ground-cover.mjs --server http://127.0.0.1:8921 --port 9927 --out /tmp/artist-ui
import {chromePath, chromeGpuFlags} from './chrome.mjs';
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {mkdirSync,writeFileSync} from 'node:fs';
import {join} from 'node:path';
import {cdpPortFree} from './cdp-port.mjs';
const args=process.argv.slice(2),opt=(k,d)=>args.includes(k)?args[args.indexOf(k)+1]:d;
const server=opt('--server','http://127.0.0.1:8921'),port=Number(opt('--port',9927)),out=opt('--out','/tmp/artist-ground-cover');
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
  const point=selector=>ev(`(()=>{const e=document.querySelector(${JSON.stringify(selector)});e.scrollIntoView({block:'nearest'});const r=e.getBoundingClientRect();return {x:r.x+r.width/2,y:r.y+r.height/2};})()`);
  const mouse=(type,p,extra={})=>send('Input.dispatchMouseEvent',{type,...p,button:type==='mouseMoved'?'none':'left',buttons:type==='mousePressed'?1:0,clickCount:type==='mouseMoved'?0:1,...extra});
  const click=async selector=>{const p=await point(selector);await mouse('mousePressed',p);await mouse('mouseReleased',p);};

  await send('Runtime.enable');await send('Page.enable');await send('Emulation.setDeviceMetricsOverride',{width:1440,height:900,deviceScaleFactor:1,mobile:false});
  const url=variant=>`${server}/?biome=green&variant=${variant}&mapX=4&mapY=4&scratch=cover-check&gpuMB=512&heapMB=1536`;
  await send('Page.navigate',{url:url('modern')});await ready();await click('#tab-world');
  const keys=['vegetationCover','plantRelief','flowerDensity'];
  report.controls=await ev(`Object.fromEntries(${JSON.stringify(keys.concat('plainRelief'))}.map(k=>{const e=document.getElementById('knob-'+k);return [k,{disabled:e.disabled,value:e.value,section:e.closest('.world-section').dataset.group}]}))`);
  assert(Object.entries(report.controls).every(([k,c])=>!c.disabled&&c.section===(k==='plainRelief'?'Ground':'Vegetation')));
  assert.equal(await ev(`document.querySelectorAll('#world-colors input[type=color][aria-label^=Flower]').length`),4);
  const knob=async(k,v)=>{await ev(`(()=>{const e=document.getElementById('knob-${k}');e.value=${v};e.dispatchEvent(new Event('input',{bubbles:true}));})()`);await ready();};
  await knob('vegetationCover',0);assert.equal(await ev(`document.querySelector('[data-knob="vegetationCover"]').hidden`),false);
  for(const k of keys.slice(1))assert.equal(await ev(`document.getElementById('knob-${k}').disabled`),true);
  await knob('vegetationCover',1.5);await knob('plantRelief',0);assert.equal(await ev(`document.getElementById('knob-flowerDensity').disabled`),false);
  await knob('plantRelief',1.5);await knob('flowerDensity',3);
  const table=()=>ev(`sculptCanvas.renderer.placementTable(sculptCanvas.renderer.variant).slice(201,206)`);
  const before=await table();
  const colors=['#30b0ff','#ff50e0','#20ffee','#ff6020'];
  for(let i=0;i<4;i++)await ev(`(()=>{const p=document.querySelector('input[aria-label="Flower ${i+1} base color"]');p.value='${colors[i]}';p.dispatchEvent(new Event('input',{bubbles:true}));})()`);
  await ready();const colored=await table();assert.notDeepEqual(colored,before);assert.deepEqual(colored.map(r=>r[3]),before.map(r=>r[3]));
  await knob('ambient',.5);assert.deepEqual(await table(),colored);report.live='three sliders and four colors reach material table; unrelated knob preserves colors; zero keeps its rows in the panel';
  await send('Page.reload');await sleep(700);await ready();await click('#tab-world');assert.deepEqual(await table(),colored);report.reload='vegetation and colors retained';
  const screen=await send('Page.captureScreenshot',{format:'png'});writeFileSync(join(out,'cover-colors.png'),Buffer.from(screen.result.data,'base64'));
  await ev(`window.__exportBlob=null;const originalCreate=URL.createObjectURL;URL.createObjectURL=b=>{window.__exportBlob=b;return originalCreate(b);}`);
  await click('#world-export');const exported=await ev('__exportBlob.text().then(JSON.parse)');report.export=exported;assert.equal(exported.world.colors.flower1,colors[0]);assert.equal(Number(exported.world.knobs.flowerDensity),3);
  await send('Page.navigate',{url:url('')});await ready();await click('#tab-world');
  // Every world has a ground-cover table, off at Vegetation cover 0: its color rows show, Vegetation cover is free, and the rows it gates say to raise it.
  assert.equal(await ev(`document.querySelectorAll('#world-colors input[type=color][aria-label^=Flower]').length`),4);
  assert.equal(await ev(`document.querySelectorAll('#world-colors input[type=color][aria-label^=Vegetation]').length`),1);
  // (The world's knobs carry across its variants, so the 1.5 set on Modern is here too: 0 is set to check the off state.)
  assert.equal(await ev(`document.getElementById('knob-vegetationCover').disabled`),false);await knob('vegetationCover',0);
  for(const k of keys.slice(1))assert.match(await ev(`document.getElementById('knob-${k}').closest('[data-knob]').querySelector('.control-requirement').textContent`),/Raise Vegetation cover/);
  assert.equal(await ev(`sculptCanvas.renderer.placementTable(sculptCanvas.renderer.variant)[162][0]`),0,'off: the cover rows are 0');
  await knob('vegetationCover',1);assert.equal(await ev(`sculptCanvas.renderer.placementTable(sculptCanvas.renderer.variant)[162][0]`),1);
  for(const k of keys.slice(1))assert.equal(await ev(`document.getElementById('knob-${k}').disabled`),false);
  report.everyWorld='original Green shows the vegetation and flower colors; Vegetation cover 0 turns the cover off and raising it turns it on';
  await ev(`(()=>{const data=${JSON.stringify(exported)},dt=new DataTransfer();data.world.name='Cover round trip';dt.items.add(new File([JSON.stringify(data)],'cover.world.json',{type:'application/json'}));const e=document.getElementById('world-file');e.files=dt.files;e.dispatchEvent(new Event('change',{bubbles:true}));})()`);
  await sleep(1000);await ready();await click('#tab-world');
  report.importVariant=await ev(`document.getElementById('variant-select').value`);
  assert.equal(report.importVariant,'modern','importing a Modern world must restore its ground-cover material');
  assert.deepEqual(await table(),colored);report.roundTrip='world JSON imported from original Green restores Modern, knobs, and colors';
  await click('#wsec-colors');await click('#world-reset');await ready();assert.equal(await ev(`document.querySelector('input[aria-label="Flower 1 base color"]').value`),'#ece8d6');report.reset='flower colors restored to material defaults';
  assert.deepEqual(errors,[]);report.console=errors;writeFileSync(join(out,'cover.json'),JSON.stringify(report,null,2));console.log(JSON.stringify(report));
}finally{ws?.close();browser.kill();}
