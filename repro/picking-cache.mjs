// Exercise independent picking-height coverage and multi-image bitmap reservation.
// Run on an isolated port against a Go editor built from this checkout.
import {spawn} from 'node:child_process';
import {mkdtempSync} from 'node:fs';
import {cdpPortFree} from './cdp-port.mjs';
const args=process.argv.slice(2),opt=(n,d)=>{const i=args.indexOf(n);return i<0?d:args[i+1]};
const port=Number(opt('--port','9697')),gpu=Number(opt('--gpu','256')),server=opt('--server','http://127.0.0.1:8891'),sleep=ms=>new Promise(r=>setTimeout(r,ms));
await cdpPortFree(port);
const chrome=spawn('/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',['--headless=new','--enable-gpu','--use-angle=metal',`--remote-debugging-port=${port}`,`--user-data-dir=${mkdtempSync('/private/tmp/terraform-picking-')}`,'--window-size=1900,1200','--no-first-run','about:blank'],{stdio:'ignore'});
let ws;
try {
 let tab;for(let i=0;i<100&&!tab;i++){try{tab=(await(await fetch(`http://127.0.0.1:${port}/json/list`)).json()).find(t=>t.type==='page')}catch{}if(!tab)await sleep(200)}
 if(!tab)throw Error('Browser did not open');ws=new WebSocket(tab.webSocketDebuggerUrl);await new Promise((r,j)=>{ws.onopen=r;ws.onerror=j});let id=0;const pending=new Map(),errors=[];
 ws.onmessage=e=>{const m=JSON.parse(e.data);if(m.id){pending.get(m.id)?.(m);pending.delete(m.id)}if(m.method==='Runtime.exceptionThrown')errors.push(m.params.exceptionDetails.exception?.description||m.params.exceptionDetails.text);if(m.method==='Runtime.consoleAPICalled'&&m.params.type==='error')errors.push(m.params.args.map(x=>x.value??x.description).join(' '))};
 const send=(method,params={})=>new Promise(r=>{const n=++id;pending.set(n,r);ws.send(JSON.stringify({id:n,method,params}))});
 const ev=async expression=>{const r=await send('Runtime.evaluate',{expression,awaitPromise:true,returnByValue:true});if(r.result?.exceptionDetails)throw Error(r.result.exceptionDetails.exception?.description||r.result.exceptionDetails.text);return r.result?.result?.value};
 await send('Runtime.enable');await send('Page.enable');await send('Emulation.setDeviceMetricsOverride',{width:1900,height:1200,deviceScaleFactor:1,mobile:false});
 await send('Page.addScriptToEvaluateOnNewDocument',{source:`(()=>{const orig=Worker.prototype.postMessage;window.__cacheAudit={jobs:[],presented:[],workerErrors:[],starts:[]};Worker.prototype.postMessage=function(job,...rest){if(!this.__auditHook){this.__auditHook=true;this.addEventListener('message',e=>{if(e.data?.kind==='error')__cacheAudit.workerErrors.push(e.data);if(e.data?.kind==='render-start')__cacheAudit.starts.push(e.data)})}if(job?.kind==='view')__cacheAudit.jobs.push({id:job.id,revision:job.revision,config:job.config,tiles:job.tiles,heightTiles:job.heightTiles});return orig.call(this,job,...rest)};window.addEventListener('terraform-render',e=>{const d=e.detail||{};if(d.phase==='presented'&&window.sculptDebug?.cacheAudit){const s=sculptDebug.cacheAudit();__cacheAudit.presented.push({id:d.id,revision:d.revision,bytes:Math.ceil(d.width/d.scale)*Math.ceil(d.height/d.scale)*4,live:s.bitmapBytes})}})})()`});
 await send('Page.navigate',{url:`${server}/sculpt?biome=green&mapX=4&mapY=4&sea=0&scratch=picking-${Date.now()}&audit=1&gpuMB=${gpu}&heapMB=128&weatheredView=0`});
 let ready=false;for(let i=0;i<600;i++){if(await ev(`!!window.sculptCanvas && !!window.sculptDebug?.cacheAudit && !document.getElementById('map-export')?.disabled`)){ready=true;break}await sleep(100)}if(!ready)throw Error('Editor did not become ready');
 const result=await ev(`(async()=>{
  const assert=(ok,msg)=>{if(!ok)throw Error(msg)};
  sculptDebug.scene([['hill',[[350,500],[650,600]],{card:{diameter:300,amount:100}}]],{ground:false});sculptCanvas.zoom(1);const vp=document.getElementById('viewport');vp.scrollLeft=0;vp.scrollTop=0;await new Promise(r=>setTimeout(r,100));await sculptCanvas.idle();
  const point={x:450,y:550},spacing=(sculptDebug.size-1)/(sculptDebug.grid-1),gx=point.x/spacing,gy=point.y/spacing,ix=Math.floor(gx),iy=Math.floor(gy);
  const m=await sculptRegion.readAuthored({x:ix,y:iy,width:2,height:2}),v=new DataView(m.data),at=i=>v.getFloat32(i*4,true),fx=gx-ix,fy=gy-iy;
  const expected=(at(0)*(1-fx)+at(1)*fx)*(1-fy)+(at(2)*(1-fx)+at(3)*fx)*fy;
  await sculptCanvas.idle();const before=sculptDebug.cacheAudit('snapshot',point.x,point.y);assert(before.images>0&&before.heights>0,'Need populated image and height caches: '+JSON.stringify(before));
  assert(Math.abs(before.sample-expected)<.001,'Initial sample does not match fresh GPU height '+JSON.stringify({before,expected}));
  const cleared=sculptDebug.cacheAudit('evictHeights',point.x,point.y);assert(cleared.heights===0&&cleared.images===before.images,'Height eviction changed bitmap cache');
  __cacheAudit.jobs.length=0;__cacheAudit.presented.length=0;sculptDebug.cacheAudit('schedule');await sculptCanvas.idle();
  const restored=sculptDebug.cacheAudit('snapshot',point.x,point.y),jobs=__cacheAudit.jobs.slice();
  assert(restored.images===before.images&&restored.heights>0,'Cached images did not regain picking heights: '+JSON.stringify({before,restored}));
  assert(Math.abs(restored.sample-expected)<.001,'Restored picking differs from current GPU height '+JSON.stringify({restored,expected}));
  assert(jobs.some(j=>(j.tiles?.length||0)===0&&(j.heightTiles?.length||0)>0),'No height-only viewport request: '+JSON.stringify(jobs));
  const vport=document.getElementById('viewport');vport.scrollLeft=700;await new Promise(r=>setTimeout(r,100));await sculptCanvas.idle();vport.scrollLeft=0;await new Promise(r=>setTimeout(r,100));await sculptCanvas.idle();
  const revisit=sculptDebug.cacheAudit('snapshot',point.x,point.y);assert(Math.abs(revisit.sample-expected)<.001,'Revisited picking differs from fresh GPU height');
  // Force multiple newly rendered images at the restricted budget and observe
  // live UI bytes after each admission. Each reservation excludes this tile's
  // incoming bytes, which PresentBitmap accounts separately.
  __cacheAudit.jobs.length=0;__cacheAudit.presented.length=0;
  sculptDebug.scene([['hill',[[450,550],[700,650]],{card:{diameter:280,amount:90}}]],{ground:false});await sculptCanvas.idle();
  const byId=new Map(__cacheAudit.jobs.map(j=>[j.id,j])),multi=__cacheAudit.jobs.filter(j=>(j.tiles?.length||0)>=2);
  assert(multi.length>0,'No multi-image viewport job');let checked=0;
  for(const p of __cacheAudit.presented){const job=byId.get(p.id);if(!job)continue;const reserved=job.config?.uiBitmapBytes;assert(Number.isFinite(reserved),'Missing bitmap reservation');assert(p.live-p.bytes<=reserved,'Bitmap reservation understated live cache: '+JSON.stringify({p,reserved}));checked++}
  assert(checked>=2,'Insufficient accepted image measurements');
  return{expected,initial:before.sample,afterEviction:restored.sample,revisit:revisit.sample,imagesKept:before.images,heightOnlyJobs:jobs.filter(j=>!(j.tiles?.length)&&j.heightTiles?.length).length,multiImageJobs:multi.length,acceptedImagesChecked:checked,gpuMiB:${gpu},heapMiB:128};
 })()`);
 console.log(JSON.stringify({...result,consoleErrors:errors.length,errors,trace:errors.length?await ev('JSON.stringify(__cacheAudit)'):undefined}));if(errors.length)throw Error('Browser errors: '+errors.join('; '));
}finally{ws?.close();chrome.kill('SIGTERM')}
