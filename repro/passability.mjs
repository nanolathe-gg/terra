// Browser acceptance for the diagnostic view. Optional --sketch loads a local,
// uncommitted authored map. Own server and CDP port are mandatory.
import {chromePath, chromeGpuFlags} from './chrome.mjs';
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {readFileSync,writeFileSync,mkdirSync,mkdtempSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {cdpPortFree} from './cdp-port.mjs';
const arg=(name,fallback='')=>{const i=process.argv.indexOf(name);return i<0?fallback:process.argv[i+1];};
const server=arg('--server'),port=Number(arg('--port')),out=arg('--out','/tmp/terra-passability-study/browser'),sketch=arg('--sketch');
if(!server||!port)throw Error('Use --server and --port for your own preview.');
mkdirSync(out,{recursive:true});await cdpPortFree(port);
const browser=spawn(chromePath,['--headless=new',...chromeGpuFlags,`--remote-debugging-port=${port}`,`--user-data-dir=${mkdtempSync(join(tmpdir(),'terra-passability-'))}`,'--window-size=1600,1150','--no-first-run','about:blank'],{stdio:'ignore'});
const sleep=ms=>new Promise(r=>setTimeout(r,ms));let ws;
try{
 for(let i=0;i<100&&!ws;i++){try{const tabs=await(await fetch(`http://127.0.0.1:${port}/json/list`)).json();ws=new WebSocket(tabs.find(t=>t.type==='page').webSocketDebuggerUrl);}catch{}if(!ws)await sleep(150);}
 await new Promise(r=>ws.onopen=r);let id=0;const pending=new Map(),errors=[];
 ws.onmessage=e=>{const m=JSON.parse(e.data);if(m.id){pending.get(m.id)?.(m);pending.delete(m.id);}if(m.method==='Runtime.exceptionThrown')errors.push(m.params.exceptionDetails.exception?.description||m.params.exceptionDetails.text);if(m.method==='Runtime.consoleAPICalled'&&m.params.type==='error')errors.push(m.params.args.map(a=>a.value??a.description).join(' '));};
 const send=(method,params={})=>new Promise(r=>{const k=++id;pending.set(k,r);ws.send(JSON.stringify({id:k,method,params}));});
 const ev=async expression=>{const m=await send('Runtime.evaluate',{expression,awaitPromise:true,returnByValue:true});if(m.result?.exceptionDetails)throw Error(m.result.exceptionDetails.exception?.description||m.result.exceptionDetails.text);return m.result.result.value;};
 const until=async(expression,label,limit=120000)=>{const start=Date.now();while(Date.now()-start<limit){if(await ev(expression))return;await sleep(100);}throw Error(`${label}: ${await ev('document.getElementById("error").textContent')} / ${await ev('document.getElementById("passability-readout").textContent')}`);};
 const press=async selector=>{const p=await ev(`(()=>{const r=document.querySelector(${JSON.stringify(selector)}).getBoundingClientRect();return{x:r.x+r.width/2,y:r.y+r.height/2};})()`);for(const type of ['mousePressed','mouseReleased'])await send('Input.dispatchMouseEvent',{type,...p,button:'left',clickCount:1});};
 // A control in a closed menu (the view buttons in View, Share link in Map) is reached through its menu's button, and a view button's menu closes after.
 const click=async selector=>{const menu=await ev(`(()=>{const s=document.querySelector(${JSON.stringify(selector)}).closest('.surface');return s?.hidden?document.querySelector('[aria-controls="'+s.id+'"]').id:null;})()`);if(menu)await press('#'+menu);await press(selector);if(menu&&!selector.startsWith('#share'))await press('#'+menu);};
 const capture=async name=>{const r=await send('Page.captureScreenshot',{format:'png'});writeFileSync(join(out,name),Buffer.from(r.result.data,'base64'));};
 await send('Runtime.enable');await send('Page.enable');await send('Emulation.setDeviceMetricsOverride',{width:1600,height:1150,deviceScaleFactor:1,mobile:false});
 await send('Page.navigate',{url:`${server}/?biome=green&mapX=8&mapY=8&sea=75&scratch=passability-preview&gpuMB=512`});
 await until('!!window.sculptCanvas&&!document.getElementById("map-export").disabled','boot');
 if(sketch){await ev(`sculptDebug.loadSketch(${readFileSync(sketch,'utf8')})`);await until('!document.getElementById("map-export").disabled','load recipe');}
 await click('#fit');await ev('sculptCanvas.idle()');
 const before=await ev('JSON.stringify(sculptDebug.sketch())'),art=await ev('document.getElementById("terrain").toDataURL()');
 await click('#view-passability');await until('sculptCanvas.passability.stats().tiles>0&&!sculptCanvas.passability.stats().ready','first height tile');
 const partial=await ev('sculptCanvas.passability.stats()');assert(partial.tiles<partial.totalTiles);
 const pendingCell=await ev('(()=>{for(let z=0;z<264;z+=32)for(let x=0;x<258;x+=32)if(!sculptCanvas.passability.at(x,z))return{x,z};})()');assert(pendingCell,'unread cells remain unknown');
 await ev(`sculptCanvas.passability.inspect(${pendingCell.x*16},${pendingCell.z*16})`);assert.match(await ev('document.getElementById("passability-readout").textContent'),/waiting for heights/);
 await capture('partial.png');
 await until('sculptCanvas.passability.stats().ready','analyze');await ev('sculptCanvas.idle()');
 assert.equal(await ev('document.getElementById("view-rendered").getAttribute("aria-pressed")'),'false');
 const settledState=await ev('document.getElementById("passability-state").textContent');await click('#view-passability');
 assert.equal(await ev('document.getElementById("passability-state").textContent'),settledState,'clicking the active view keeps the completed status');
 assert.equal(await ev('JSON.stringify(sculptDebug.sketch())'),before,'a diagnostic view does not change the map recipe');
 assert.ok(await ev('document.getElementById("terrain").toDataURL()')===art,'the diagnostic is an overlay; terrain art is unchanged');
 const report={partial,analysis:await ev('sculptCanvas.passability.stats()')};
 const streamedOverlay=await ev('document.getElementById("overlay").toDataURL()');
 await ev('document.getElementById("passability-family").dispatchEvent(new Event("change"))');await ev('sculptCanvas.idle()');
 assert.equal(await ev('document.getElementById("overlay").toDataURL()'),streamedOverlay,'incremental columns match a complete overlay raster');report.overlayRaster='incremental and full rasters match exactly';
 report.fullGridComparison=await ev(`(async()=>{
  const {MOVEMENT_FAMILIES,terrainLattice,familyCoverage,movementObstacles}=await import('./sculpt-passability.js'),sampled=await sculptCanvas.sampleHeights(),config=sculptCanvas.renderer.config,map=config.map,data=sculptRegion.mapData();
  const t=terrainLattice({heights:sampled.heights,width:map.widthCells,height:map.heightCells,sea:config.seaLevel,obstacles:movementObstacles(config,data),lava:Boolean(data.settings?.lava)}),coverage=MOVEMENT_FAMILIES.map(f=>familyCoverage(t,f));let mismatches=0;
  for(let z=0;z<t.height;z++)for(let x=0;x<t.width;x++){const i=z*t.width+x,a=sculptCanvas.passability.at(x,z);if(!a||a.low!==t.low[i]||a.high!==t.high[i]||MOVEMENT_FAMILIES.some((f,k)=>a.coverage[f.id]!==coverage[k][i]))mismatches++;}
  return {cells:sampled.heights.length,mismatches};
 })()`);assert.equal(report.fullGridComparison.mismatches,0,'streaming matches complete export classification');
 if(sketch){
  report.westGap=await ev('sculptCanvas.passability.at(43,111)');assert.equal(report.westGap.coverage.vehicles,0);assert.equal(report.westGap.coverage.kbots,0);assert(report.westGap.coverage.hover>0);
  report.southeastClimbingCells=await ev('(()=>{let count=0;for(let z=138;z<163;z++)for(let x=146;x<183;x++){const a=sculptCanvas.passability.at(x,z);if(!a.coverage.vehicles&&a.coverage.kbots)count++;}return count;})()');assert(report.southeastClimbingCells>0);
 }
 await capture('overview.png');
 for(const family of ['vehicles','kbots','hover','amphibious','ships']){
  await ev(`(()=>{const s=document.getElementById('passability-family');s.value='${family}';s.dispatchEvent(new Event('change'));})()`);await ev('sculptCanvas.idle()');
  assert.equal(await ev('sculptCanvas.passability.stats().revision'),report.analysis.revision,'changing family reuses the sampled export');
  if(family==='vehicles'||family==='kbots')await capture(family+'.png');
 }
 // Changes, including map-only feature undo, invalidate and rebuild the access masks.
 const r0=await ev('sculptCanvas.passability.stats().revision');
 await click('#view-rendered');await click('#view-passability');await until('sculptCanvas.passability.stats().tiles>0&&!sculptCanvas.passability.stats().ready','restart partial stream');
 assert.equal(await ev('sculptCanvas.features.addFeature("rock",40,40)'),true);
 assert.equal(await ev('sculptCanvas.passability.at(40,40)'),null,'an edited revision cannot expose the old partial stream');
 await until(`sculptCanvas.passability.stats().ready&&sculptCanvas.passability.stats().revision!==${r0}`,'feature update');
 assert.equal((await ev('sculptCanvas.passability.at(40,40)')).coverage.vehicles,0);
 const r1=await ev('sculptCanvas.passability.stats().revision');await click('#undo');
 await until(`sculptCanvas.passability.stats().ready&&sculptCanvas.passability.stats().revision!==${r1}`,'feature undo');
 assert((await ev('sculptCanvas.passability.at(40,40)')).coverage.vehicles>0);
 report.featureUndo='blocking rock and undo both rebuild access';
 await click('#view-clay');await ev('sculptCanvas.idle()');assert.equal(await ev('sculptCanvas.passability.active'),false);assert.equal(await ev('document.getElementById("view-clay").getAttribute("aria-pressed")'),'true');
 await click('#view-rendered');await ev('sculptCanvas.idle()');assert.equal(await ev('document.getElementById("view-rendered").getAttribute("aria-pressed")'),'true');
 await click('#view-passability');await until('sculptCanvas.passability.stats().ready','reopen');
 await ev("(()=>{const s=document.getElementById('passability-family');s.value='overview';s.dispatchEvent(new Event('change'));})()");await ev('sculptCanvas.idle()');
 await capture('overview-final.png');
 // The existing dev share link opens this authored recipe on the isolated server.
 if(sketch){await click('#share-link');await until('!!document.getElementById("share-url").value','local preview link');report.preview=await ev('document.getElementById("share-url").value');assert(report.preview.startsWith(server),'preview must stay on our own local server');}
 assert.deepEqual(errors,[]);writeFileSync(join(out,'report.json'),JSON.stringify(report,null,2));console.log(JSON.stringify(report,null,2));
}finally{ws?.close();browser.kill();}
