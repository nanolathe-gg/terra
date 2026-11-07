// Browser acceptance for the diagnostic view. Optional --sketch loads a local,
// uncommitted authored map. Own server and CDP port are mandatory.
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {readFileSync,writeFileSync,mkdirSync,mkdtempSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {cdpPortFree} from './cdp-port.mjs';
const arg=(name,fallback='')=>{const i=process.argv.indexOf(name);return i<0?fallback:process.argv[i+1];};
const server=arg('--server'),port=Number(arg('--port')),out=arg('--out','/private/tmp/terraform-passability-study/browser'),sketch=arg('--sketch');
if(!server||!port)throw Error('Use --server and --port for your own preview.');
mkdirSync(out,{recursive:true});await cdpPortFree(port);
const browser=spawn('/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',['--headless=new','--enable-gpu','--use-angle=metal',`--remote-debugging-port=${port}`,`--user-data-dir=${mkdtempSync(join(tmpdir(),'terraform-passability-'))}`,'--window-size=1600,1150','--no-first-run','about:blank'],{stdio:'ignore'});
const sleep=ms=>new Promise(r=>setTimeout(r,ms));let ws;
try{
 for(let i=0;i<100&&!ws;i++){try{const tabs=await(await fetch(`http://127.0.0.1:${port}/json/list`)).json();ws=new WebSocket(tabs.find(t=>t.type==='page').webSocketDebuggerUrl);}catch{}if(!ws)await sleep(150);}
 await new Promise(r=>ws.onopen=r);let id=0;const pending=new Map(),errors=[];
 ws.onmessage=e=>{const m=JSON.parse(e.data);if(m.id){pending.get(m.id)?.(m);pending.delete(m.id);}if(m.method==='Runtime.exceptionThrown')errors.push(m.params.exceptionDetails.exception?.description||m.params.exceptionDetails.text);if(m.method==='Runtime.consoleAPICalled'&&m.params.type==='error')errors.push(m.params.args.map(a=>a.value??a.description).join(' '));};
 const send=(method,params={})=>new Promise(r=>{const k=++id;pending.set(k,r);ws.send(JSON.stringify({id:k,method,params}));});
 const ev=async expression=>{const m=await send('Runtime.evaluate',{expression,awaitPromise:true,returnByValue:true});if(m.result?.exceptionDetails)throw Error(m.result.exceptionDetails.exception?.description||m.result.exceptionDetails.text);return m.result.result.value;};
 const until=async(expression,label,limit=120000)=>{const start=Date.now();while(Date.now()-start<limit){if(await ev(expression))return;await sleep(100);}throw Error(`${label}: ${await ev('document.getElementById("error").textContent')} / ${await ev('document.getElementById("passability-readout").textContent')}`);};
 const click=async selector=>{const p=await ev(`(()=>{const r=document.querySelector(${JSON.stringify(selector)}).getBoundingClientRect();return{x:r.x+r.width/2,y:r.y+r.height/2};})()`);for(const type of ['mousePressed','mouseReleased'])await send('Input.dispatchMouseEvent',{type,...p,button:'left',clickCount:1});};
 const capture=async name=>{const r=await send('Page.captureScreenshot',{format:'png'});writeFileSync(join(out,name),Buffer.from(r.result.data,'base64'));};
 await send('Runtime.enable');await send('Page.enable');await send('Emulation.setDeviceMetricsOverride',{width:1600,height:1150,deviceScaleFactor:1,mobile:false});
 await send('Page.navigate',{url:`${server}/sculpt.html?biome=green&mapX=8&mapY=8&sea=75&scratch=passability-preview&gpuMB=512`});
 await until('!!window.sculptCanvas&&!document.getElementById("map-export").disabled','boot');
 if(sketch){await ev(`sculptDebug.loadSketch(${readFileSync(sketch,'utf8')})`);await until('!document.getElementById("map-export").disabled','load recipe');}
 await click('#fit');await ev('sculptCanvas.idle()');
 const before=await ev('JSON.stringify(sculptDebug.sketch())'),art=await ev('document.getElementById("terrain").toDataURL()');
 await click('#view-passability');await until('sculptCanvas.passability.stats().ready','analyze');await ev('sculptCanvas.idle()');
 assert.equal(await ev('document.getElementById("view-rendered").getAttribute("aria-pressed")'),'false');
 assert.equal(await ev('JSON.stringify(sculptDebug.sketch())'),before,'a diagnostic view does not change the map recipe');
 assert.ok(await ev('document.getElementById("terrain").toDataURL()')===art,'the diagnostic is an overlay; terrain art is unchanged');
 const report={analysis:await ev('sculptCanvas.passability.stats()')};
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
 assert.equal(await ev('sculptCanvas.features.addFeature("rock",40,40)'),true);
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
