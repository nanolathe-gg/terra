// Actual Save -> Load between isolated browser profiles. Authored fixture only.
// node repro/save-load.mjs --server http://127.0.0.1:<yours> --port <cdp> --out <dir>
import {chromePath, chromeGpuFlags} from './chrome.mjs';
import assert from 'node:assert/strict';
import {isDeepStrictEqual} from 'node:util';
import {spawn} from 'node:child_process';
import {createHash} from 'node:crypto';
import {mkdirSync,mkdtempSync,writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {resolve,join} from 'node:path';
import {cdpPortFree} from './cdp-port.mjs';
const args=process.argv.slice(2),opt=k=>args[args.indexOf(k)+1],server=args.includes('--server')?opt('--server'):'',port=Number(args.includes('--port')?opt('--port'):0);
if(!server||!Number.isInteger(port)||port<1024)throw Error('Give your own --server and --port; the check uses that CDP port and the next.');
const out=resolve(args.includes('--out')?opt('--out'):mkdtempSync(join(tmpdir(),'terraform-save-load-')));mkdirSync(out,{recursive:true});
const sleep=ms=>new Promise(r=>setTimeout(r,ms)),browsers=[];
async function open(offset){
  const p=port+offset;await cdpPortFree(p);
  const browser=spawn(chromePath,['--headless=new',...chromeGpuFlags,`--remote-debugging-port=${p}`,`--user-data-dir=${join(out,'profile-'+offset)}`,'--window-size=1440,900','--no-first-run','about:blank'],{stdio:'ignore'});
  const item={browser};browsers.push(item);let ws;
  for(let i=0;i<100&&!ws;i++){try{const tabs=await(await fetch(`http://127.0.0.1:${p}/json/list`)).json();ws=new WebSocket(tabs.find(t=>t.type==='page').webSocketDebuggerUrl);}catch{}if(!ws)await sleep(100);}
  await new Promise(r=>ws.onopen=r);item.ws=ws;let id=0;const pending=new Map(),errors=[];
  ws.onmessage=e=>{const m=JSON.parse(e.data);if(m.id){pending.get(m.id)?.(m);pending.delete(m.id);}if(m.method==='Runtime.exceptionThrown')errors.push(m.params.exceptionDetails.exception?.description||m.params.exceptionDetails.text);};
  const send=(method,params={})=>new Promise((resolve,reject)=>{const n=++id;pending.set(n,m=>m.error?reject(Error(JSON.stringify(m.error))):resolve(m.result));ws.send(JSON.stringify({id:n,method,params}));});
  const ev=async expression=>{const r=await send('Runtime.evaluate',{expression,awaitPromise:true,returnByValue:true});if(r.exceptionDetails)throw Error(r.exceptionDetails.exception?.description||r.exceptionDetails.text);return r.result.value;};
  const ready=async condition=>{for(let i=0;i<1200;i++){try{if(await ev(`!!window.sculptDebug&&!!window.sculptCanvas&&!!window.sculptRegion&&sculptRegion.ready()&&(${condition||'true'})`)){await ev('sculptCanvas.idle()');return;}}catch{}await sleep(150);}throw Error('Save/load page did not become ready: '+errors.join('\n'));};
  await send('Runtime.enable');await send('Page.enable');return {send,ev,ready,errors};
}
const image=page=>page.ev(`(async()=>{const b=await sculptCanvas.debugBake({x:240,y:180,width:160,height:128},1),c=new OffscreenCanvas(b.width,b.height);c.getContext('2d').drawImage(b,0,0);b.close();return Array.from(c.getContext('2d').getImageData(0,0,c.width,c.height).data);})()`);
const normalize=s=>({...s,nodes:s.nodes.map(n=>({...n,hidden:Boolean(n.hidden)}))});
try{
  const source=await open(0);
  // The map's world settings come from the address here (rows, a borrowed beach, the sun's color); a map saves them whole (owner, 2026-11-19).
  await source.send('Page.navigate',{url:`${server}/?biome=green&mapX=2&mapY=1&sea=95&scratch=save-test&gpuMB=512&heapMB=1536&sunColor=ffd9a8&terraceBreak=.7&beachFrom=zhon&erosionRain=0&lowTint=.4`});await source.ready();
  await source.ev(`(()=>{const w=document.getElementById('weather');if(w.checked)w.click();const own=sculptDebug.sketch().materials.map(m=>m.worldGround?{...m,seed:3}:m),free=[...Array(15).keys()].map(i=>i+1).find(i=>!own.some(m=>m.slot===i)),sand={...Object.fromEntries(Object.entries(own.find(m=>m.worldGround)).filter(([k])=>!/^world/.test(k))),slot:free,name:'Second ground',seed:9};window.__fixture={slot:free,count:own.length+1};sculptDebug.scene([['hill',[[240,230],[430,260]],{card:{elevation:95,gullies:20}}],['paint',[[150,150]],{groundPreset:free,card:{diameter:120,amount:100,softness:0}}]],{ground:true,materials:[...own,sand]});const d=sculptRegion.mapData();d.name='Collaboration fixture';d.description='Self-contained save';d.starts=[{x:128,z:128},{x:768,z:256}];d.settings.minWind=7;d.features=[{kind:'deposit',v:0,x:8,z:8,metal:143}];sculptRegion.restoreMapData(d);return true;})()`);await source.ready();
  // Capture the blob produced by the real button; suppress the browser's disk download.
  await source.send('Browser.setDownloadBehavior',{behavior:'deny'});
  const saved=JSON.parse(await source.ev(`(async()=>{const original=URL.createObjectURL;URL.createObjectURL=blob=>{window.savedBlob=blob;return original(blob);};document.getElementById('save').click();return await savedBlob.text();})()`));
  assert.equal(saved.worldSettings.name,'Green Planet');assert.equal(saved.worldSettings.colors.sun,'#ffd9a8');assert.equal(saved.worldSettings.knobs.beachFrom,'zhon');assert.equal(saved.worldSettings.knobs.erosionRain,'0');assert.ok(saved.worldSettings.surface?.length,'the surface layers are saved whole');
  // The map's materials travel in the save; the world it embeds carries its own two (the ground was given another seed above).
  const fixture=await source.ev('window.__fixture');assert.equal(saved.materials.find(m=>m.worldGround).seed,3);assert.equal(saved.materials.length,fixture.count);assert.deepEqual(saved.worldSettings.materials,saved.materials.filter(m=>Object.keys(m).some(k=>/^world[A-Z]/.test(k)&&m[k])));
  // lowTint is a removed row (round 7): an address that names it leaves it out of the save, as the open would drop it.
  assert.equal(saved.worldSettings.knobs.lowTint,undefined);
  const uniforms=await source.ev(`Object.fromEntries(Object.keys(sculptDebug.sketch().worldSettings.knobs).map(k=>[k,sculptCanvas.renderer.variant.get(k)]))`);
  const file=join(out,'map.json');writeFileSync(file,JSON.stringify(saved));const before=await image(source);
  const recipient=await open(1);
  await recipient.send('Page.navigate',{url:`${server}/?biome=red&mapX=1&mapY=1&scratch=recipient`});await recipient.ready();
  const doc=await recipient.send('DOM.getDocument'),input=await recipient.send('DOM.querySelector',{nodeId:doc.root.nodeId,selector:'#file'});
  await recipient.send('DOM.setFileInputFiles',{nodeId:input.nodeId,files:[file]});await recipient.ready(`sculptDebug.biome==='green'&&sculptRegion.mapData().name==='Collaboration fixture'`);
  const restored=await recipient.ev('sculptDebug.sketch()');writeFileSync(join(out,'restored.json'),JSON.stringify(restored));
  const a=normalize(saved),b=normalize(restored),changed=[...new Set([...Object.keys(a),...Object.keys(b)])].filter(k=>!isDeepStrictEqual(a[k],b[k]));assert.equal(changed.join(','),'','saved recipe differs after loading');
  assert.equal(await recipient.ev(`new URL(location.href).searchParams.has('pendingSketch')`),false);
  for(let i=0;i<50&&!await recipient.ev(`sculptDebug.savedMap().then(m=>m?.mapData?.name==='Collaboration fixture')`);i++)await sleep(100);
  await recipient.send('Page.reload');await recipient.ready(`sculptRegion.mapData().name==='Collaboration fixture'`);
  const reopened=await recipient.ev('sculptDebug.sketch()');assert.equal(isDeepStrictEqual(normalize(reopened),normalize(saved)),true,'loaded map changed after a refresh');
  const restoredUniforms=await recipient.ev(`Object.fromEntries(Object.keys(sculptDebug.sketch().worldSettings.knobs).map(k=>[k,sculptCanvas.renderer.variant.get(k)]))`);
  const changedUniforms=Object.keys(uniforms).filter(k=>uniforms[k]!==restoredUniforms[k]).map(k=>`${k}: ${uniforms[k]} -> ${restoredUniforms[k]}`);
  assert.equal(changedUniforms.join(', '),'','renderer settings differ after loading');
  const after=await image(recipient);assert.equal(Buffer.from(after).equals(Buffer.from(before)),true,'rendered pixels differ after a fresh-profile load');
  for(const page of [source,recipient])assert.deepEqual(page.errors,[]);
  const report={sameRecipe:true,matchingPixels:before.length/4,rgbaSHA256:createHash('sha256').update(Buffer.from(before)).digest('hex'),world:saved.worldSettings.name,biome:saved.biome};
  writeFileSync(join(out,'report.json'),JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify(report));
}finally{for(const {ws,browser}of browsers){ws?.close();browser.kill();}}
