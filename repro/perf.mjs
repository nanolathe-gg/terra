// LP0: the page's input-to-picture budget, with no editor files changed.
// node repro/perf.mjs map16 --scene repro/scenes/green-modern-2.json \
//   --server http://127.0.0.1:8897 --port 9891 --out /private/tmp/lp0 --no-export
// --viewport WIDTHxHEIGHT is terrain CSS pixels; default Chrome window: 1600x1200.
// --only load|drag|release|resume|slider|scroll; --sliders comma-separated knob IDs.
// --colors native|scripted: scripted explicitly substitutes value/input events.
// --warmup discards a session; --report FILE... prints the section 2 budget table.
// Use distinct CDP ports, discard one --warmup per fresh server, alternate workloads,
// and check ps -Ao pcpu,command -r | head before measured runs. Never time two at once.
import {cdpPortFree} from './cdp-port.mjs';
import {spawn, execFileSync} from 'node:child_process';
import {mkdirSync, readFileSync, writeFileSync, rmSync} from 'node:fs';
import {resolve, join} from 'node:path';
import {loadavg} from 'node:os';

const args = process.argv.slice(2);
const opt = (name, fallback) => { const i = args.indexOf(name); return i < 0 ? fallback : args.splice(i, 2)[1]; };
const flag = name => { const i = args.indexOf(name); if (i < 0) return false; args.splice(i, 1); return true; };
const quantile = (a, p) => { const s = a.filter(Number.isFinite).sort((a,b)=>a-b); return s.length ? s[Math.min(s.length-1, Math.ceil(s.length*p)-1)] : null; };
const distribution = (a, total=a.length) => ({n:a.length, censored:total-a.length,p50:quantile(a,.5),p95:quantile(a,.95),max:a.length?Math.max(...a):null});
const sleep = ms => new Promise(r=>setTimeout(r,ms));

function tileSamples(p,pointer=false){
  if(p.status==='blocked')return [];
  const paints=(p.events||[]).filter(e=>e.type==='paint');
  if(!p.inputs?.length&&!pointer){const t=p.phaseStartMs??p.anchors?.[0]?.t,e=paints.find(e=>e.t>=t);return e?[e.t-t]:[];}
  return (p.inputs||[]).filter(m=>!pointer||m.at).flatMap(m=>{const e=paints.find(e=>e.t>=m.t&&(m.kind==='stroke'&&m.rev!=null?e.rev>=m.rev:m.control==='knob-erosionRain'?e.feedSerial>=m.id:e.serial>=m.id)&&(!pointer||(m.at[0]>=e.x&&m.at[0]<e.x+e.width&&m.at[1]>=e.y&&m.at[1]<e.y+e.height)));return e?[e.t-m.t]:[];});
}
function releaseSample(p){
  if(p.status==='blocked')return [];
  const a=p.anchors?.at(-1);if(!a)return p.samples?.final?.slice(-1)||[];
  const c=p.events?.find(e=>e.type==='coverage'&&e.t>=a.t&&e.ready&&e.visible.every(k=>e.keys.some(t=>t.key===k&&!t.dirty&&t.level<=1)));
  return c?[c.t-a.t]:[];
}
function budgetTable(results) {
  const groups = [
    ['Stroke / move / shape-card (stroke sampled)',r=>[r.drag,r.resume].filter(Boolean),50,100],
    ['World / rock / surface / sun',r=>(r.slider||[]).filter(s=>['knob-faceBlockSize','knob-reliefAmount','knob-sunHeight'].includes(s.control)),50,100],
    ['Color / shine / light / palette (color, ambient sampled)',r=>(r.slider||[]).filter(s=>['colors','knob-ambient'].includes(s.control)),50,150],
    ['Time controls (Rain sampled)',r=>(r.slider||[]).filter(s=>s.control==='knob-erosionRain'),100,null],
    ['Pan / zoom onto uncached ground (pan sampled)',r=>[r.scroll].filter(Boolean),50,100],
    ['First picture after scene load',r=>[r.load].filter(Boolean),null,1000],
  ];
  const cell = (phases,key,budget) => {
    const samples=phases.flatMap(p=>key==='finalRelease'?releaseSample(p):key==='firstTile'?tileSamples(p):key==='pointer'?tileSamples(p,true):p.samples?.[key]||[]), total=phases.reduce((n,p)=>n+(key==='finalRelease'?1:key==='firstTile'?(p.inputs?.length||0):p.sampleTotals?.[key]??p.samples?.[key]?.length??0),0), d=distribution(samples,total);
    if(!d.n) return `unobserved (${d.censored} censored)`;
    // A high censored share must never turn into a passing p95.
    const status=budget==null?'':d.censored/total>.05?' FAIL (censored)':d.p95<=budget?' PASS':' FAIL';
    return `${d.p50.toFixed(1)} / ${d.p95.toFixed(1)}${status} [${d.n}/${total}]`;
  };
  const gaps=results.flatMap(r=>(r.slider||[]).filter(p=>p.status==='blocked').map(p=>r.label+': '+p.reason));
  const scripted=results.flatMap(r=>(r.slider||[]).filter(p=>p.control==='colors'&&p.driver?.startsWith('scripted')));
  const lines=[...(scripted.length?[`LABELED SUBSTITUTE: ${scripted.length} scripted Colors phases (value/input events on the existing picker, not native mouse).`,'']:[]),...(gaps.length?[`INCOMPLETE: ${gaps.length} native Colors phases; ${[...new Set(results.flatMap(r=>(r.slider||[]).filter(p=>p.status==='blocked').map(p=>p.reason)))].join('; ')}`,'']:[]),'All times ms: p50 / p95; [observed / requested]. Superseded inputs wait for a later current image.','',
    '| Interaction | First changed pixels | Whole view current | Release to final |',
    '| --- | ---: | ---: | ---: |'];
  for(const [name,select,first,whole] of groups){const p=results.flatMap(select);lines.push(`| ${name} | ${cell(p,'first',first)} | ${cell(p,'all',whole)} | ${cell(p,'finalRelease',null)} |`);}
  const phases=results.flatMap(r=>[r.load,r.drag,r.release,r.resume,...r.slider||[],r.scroll,r.export].filter(Boolean));
  const max=(f)=>Math.max(0,...phases.map(f));
  lines.push('',`Fresh stroke tiles (input to paint), first: ${cell(results.flatMap(r=>[r.drag,r.resume].filter(Boolean)),'firstTile',null)}; pointer: ${cell(results.flatMap(r=>[r.drag,r.resume].filter(Boolean)),'pointer',null)}; whole area: ${cell(results.flatMap(r=>[r.drag,r.resume].filter(Boolean)),'all',null)}.`,`Focus tile after pause/release: ${cell(results.flatMap(r=>[r.drag,r.resume,...r.slider||[]].filter(p=>p&&p.status!=='blocked')),'focus',600)}.`,`GPU queue wait max: ${max(p=>p.split?.queueWaitMs?.max||0).toFixed(1)} ms (wall, includes queueing).`,
    `GPU submission max: ${max(p=>p.split?.gpuSubmissionMs?.max||0).toFixed(1)} ms (timestamp span; budget 100 ms).`,
    `Longest observed long task (>50 ms): ${max(p=>p.split?.longTasks?.max||0)||'none'}; input handler max: ${max(p=>p.split?.handlerMs?.max||0).toFixed(1)} ms.`,
    `Specialized sets compiled: ${phases.reduce((n,p)=>n+(p.split?.specStats?.built||0),0)}; each set contains draw, bake and loose pipelines.`,
    `Off-screen GPU: ${max(p=>p.split?.offscreenGPU?.whollyOutsideMs||0).toFixed(1)} ms wholly outside; ${max(p=>p.split?.offscreenGPU?.mixedRegionMs||0).toFixed(1)} ms in mixed regions (largest individual phase) (not separable with pass timestamps).`,
    'Final-relative-to-today and early-preview overhead: this is today\'s baseline (ratio 1.00); no implementation comparison yet.');
  return lines.join('\n');
}
if(flag('--report')){console.log(budgetTable(args.map(f=>JSON.parse(readFileSync(f,'utf8')))));process.exit(0);}
const server=opt('--server',''),port=Number(opt('--port',0)),out=resolve(opt('--out','perf-out'));
const sceneFile=opt('--scene','repro/scenes/green-2.json'),label=opt('--label',''),viewport=opt('--viewport','');
const colorsMode=opt('--colors','native');
if(!['native','scripted'].includes(colorsMode))throw Error('--colors expects native|scripted');
const start=opt('--start','');const only=opt('--only',''),query=opt('--query',''),tool=opt('--tool','hill'),diameter=Number(opt('--diameter',0));
const featureDensity=Number(opt('--features','0'));
const sliderNames=opt('--sliders','knob-faceBlockSize,knob-reliefAmount,knob-ambient,knob-sunHeight,knob-erosionRain,colors').split(',');
const noExport=flag('--no-export'),warmup=flag('--warmup'),exact=flag('--exact-timestamps'),noSliders=flag('--no-sliders');
const [mode,...unknown]=args;
if(!['map4','map8','map16','map40'].includes(mode)||unknown.length||!server||!port||port===9450||new URL(server).port==='8801')throw Error('Give map4|map8|map16|map40, --server <your server> --port <your CDP> --out <outside repo>.');
if(viewport&&!/^\d{3,4}x\d{3,4}$/.test(viewport))throw Error('--viewport expects terrain WIDTHxHEIGHT');
if(out===process.cwd()||out.startsWith(process.cwd()+'/'))throw Error('--out must be outside the repository');
const scene=JSON.parse(readFileSync(sceneFile,'utf8'));mkdirSync(out,{recursive:true});

// These hooks are installed before modules execute. Narrow Fetch substitutions below
// expose lexical calls and entry metadata to the observer; they do not change work,
// scheduling, values, or rendering. Fail closed if an anchor changes in a later build.
function hooks(){
  const P=window.__perf={events:[],inputs:[],handlers:[],stages:[],waits:[],long:[],frames:[],serial:0,blocks:[],encoders:[],submits:[],compiles:[],ctx:null,pictures:new Map(),lastPixels:new Map(),active:false};
  const now=()=>performance.now();
  P.mark=(type,data={})=>{const e={t:now(),type,...data};P.events.push(e);return e;};
  P.call=(name,fn)=>{const t=now();try{return fn();}finally{const ms=now()-t;P.stages.push({t,name,ms});if(P.handler)P.handler.calls[name]=(P.handler.calls[name]||0)+ms;}};
  P.work=(encoder,kind,rect)=>{const e=P.encoders.findLast(e=>e.encoder===encoder);if(e){e.kind=kind;e.rect=rect;}};
  const intersects=(a,b)=>a.x<b.x+b.width&&b.x<a.x+a.width&&a.y<b.y+b.height&&b.y<a.y+a.height;
  P.visible=()=>{if(!window.sculptCanvas)return [];const v=sculptCanvas.view(),s=sculptCanvas.stats().displayChunkSize,keys=[];for(let y=Math.max(0,Math.floor(v.y/s)*s);y<v.y+v.height;y+=s)for(let x=Math.max(0,Math.floor(v.x/s)*s);x<v.x+v.width;x+=s)keys.push(x+','+y);return keys;};
  P.current=()=>{const v=sculptCanvas.view(),s=sculptCanvas.stats().displayChunkSize;return sculptCanvas.cacheSnapshot().filter(e=>e.key.endsWith(','+s+',detail')&&intersects(e,v));};
  P.input=(kind,control,at=null,t=now())=>{if(!P.active)return null;const m={id:++P.serial,t,kind,control,at,targets:[]};P.inputs.push(m);queueMicrotask(()=>{m.rev=window.sculptRegion?.stats().revision;m.targets=P.visible();if(kind==='stroke'){const v=sculptCanvas.view();const dirty=P.current().filter(e=>e.dirty);m.targets=dirty.map(e=>e.x+','+e.y);m.rectangles=dirty.map(e=>({x:e.x,y:e.y,width:e.width,height:e.height}));}});return m;};
  P.tag=entry=>{entry.__lpSerial??=P.serial;entry.__lpRev??=window.sculptRegion?.stats().revision;entry.__lpFeedSerial??=entry.__lpSerial;};
  // Observe actual tile paints. Pixel verification runs after timing stops;
  // reading a bitmap here would add 20-30 ms and change queue backpressure.
  const seen=new WeakSet(),closeBitmap=ImageBitmap.prototype.close;
  P.held=new WeakSet();P.deferred=new Set();P.pixelPaints=[];P.extraBitmapBytes=0;P.peakExtraBitmapBytes=0;
  ImageBitmap.prototype.close=function(){
    if((P.active||P.stoppedAt&&!P.pixelReady)&&P.held.has(this)){if(!P.deferred.has(this)){P.deferred.add(this);P.extraBitmapBytes+=this.width*this.height*4;P.peakExtraBitmapBytes=Math.max(P.peakExtraBitmapBytes,P.extraBitmapBytes);}return;}
    return closeBitmap.call(this);
  };
  P.prepare=async()=>{P.baseline=await cib(document.getElementById('terrain'));P.baselineBytes=P.baseline.width*P.baseline.height*4;};
  // Retain the immutable bitmaps the page already made, without copying or
  // reading pixels on its input/render path. Compare RGBA after timing stops.
  P.readPixels=()=>{
    if(P.pixelReady)return;const started=now(),c=document.createElement('canvas');c.width=P.baseline.width;c.height=P.baseline.height;
    const g=c.getContext('2d',{willReadFrequently:true});g.drawImage(P.baseline,0,0);
    for(const p of P.pixelPaints){
      const k=p.level,scale=p.view.scale,x0=Math.round((p.rect.x-p.view.x)*scale),y0=Math.round((p.rect.y-p.view.y)*scale),x1=Math.round((p.rect.x+p.bitmap.width*k-p.view.x)*scale),y1=Math.round((p.rect.y+p.bitmap.height*k-p.view.y)*scale);
      const x=Math.max(0,x0),y=Math.max(0,y0),w=Math.min(c.width,x1)-x,h=Math.min(c.height,y1)-y;if(w<=0||h<=0){p.event.changed=false;continue;}
      const before=new Uint32Array(g.getImageData(x,y,w,h).data.buffer);g.imageSmoothingEnabled=scale<1||k*scale<1;g.imageSmoothingQuality='high';g.drawImage(p.bitmap,x0,y0,x1-x0,y1-y0);const after=new Uint32Array(g.getImageData(x,y,w,h).data.buffer);
      p.event.changed=false;for(let i=0;i<after.length;i++)if(before[i]!==after[i]){p.event.changed=true;break;}
    }
    P.pixelReady=true;P.pixelObserverMs=now()-started;
    for(const bitmap of P.deferred)closeBitmap.call(bitmap);P.deferred.clear();P.extraBitmapBytes=0;
  };
  P.paint=(entry,v)=>{
    if(!P.active||!intersects(entry,v))return;
    const key=entry.x+','+entry.y;
    if(!seen.has(entry.bitmap)){
      seen.add(entry.bitmap);
      const event=P.mark('paint',{key,x:entry.x,y:entry.y,width:entry.width,height:entry.height,serial:entry.__lpSerial??0,feedSerial:entry.__lpFeedSerial,rev:entry.__lpRev,seq:entry.seq,level:entry.scale??1,weathered:entry.weathered,dirty:!!entry.dirty,changed:null});P.held.add(entry.bitmap);P.pixelPaints.push({event,bitmap:entry.bitmap,rect:{x:entry.x,y:entry.y},level:entry.scale??1,view:{...v}});
    }
    P.pictures.set(key,{serial:entry.__lpSerial??0,feedSerial:entry.__lpFeedSerial,rev:entry.__lpRev,level:entry.scale??1,weathered:entry.weathered,dirty:!!entry.dirty});
    const current=P.current();
    const state=window.sculptDebug?.state?.();const ready=window.sculptRegion?.canExport?.()!==false||state?.stroke||state?.moving;
    // Snapshot the actual visible cache. An authored-only tile during pending Rain
    // must never count as a current weathered view.
    P.mark('coverage',{ready,keys:current.map(e=>({key:e.x+','+e.y,x:e.x,y:e.y,width:e.width,height:e.height,dirty:e.dirty,level:e.scale??1,serial:P.pictures.get(e.x+','+e.y)?.serial??0,rev:P.pictures.get(e.x+','+e.y)?.rev,feedSerial:P.pictures.get(e.x+','+e.y)?.feedSerial})),visible:P.visible()});
  };
  const add=EventTarget.prototype.addEventListener,inputEvents=new WeakMap();
  EventTarget.prototype.addEventListener=function(type,fn,options){
    if(type!=='input'||typeof fn!=='function')return add.call(this,type,fn,options);
    return add.call(this,type,function(e){
      const top=!P.handler;let h=P.handler||inputEvents.get(e);if(!h){h={t:now(),control:e.target.id||e.target.getAttribute('aria-label'),value:e.target.value,isTrusted:e.isTrusted,calls:{},ms:0};inputEvents.set(e,h);P.handlers.push(h);P.input('slider',h.control);}if(top)P.handler=h;
      const start=now();try{return fn.call(this,e);}finally{if(top){h.ms+=now()-start;P.handler=null;}}
    },options);
  };
  document.addEventListener('pointerdown',e=>{if(P.active&&e.button===0&&e.target.id==='overlay'){P.mark('stroke-begin',{t:e.timeStamp,rev:sculptRegion.stats().revision});}},false);
  document.addEventListener('pointermove',e=>{if(e.buttons===1&&e.target.id==='overlay'){const r=e.target.getBoundingClientRect(),v=sculptCanvas.view(),at=[v.x+(e.clientX-r.left)/v.scale,v.y+(e.clientY-r.top)/v.scale];const mark=P.input('stroke',null,at,e.timeStamp);if(mark){mark.artAt=at;mark.worldAt=P.nextPointerAt??null;}P.nextPointerAt=null;}},false);
  const replace=History.prototype.replaceState;
  History.prototype.replaceState=function(...a){return P.call('history.replaceState',()=>replace.apply(this,a));};
  try{new PerformanceObserver(l=>{for(const e of l.getEntries())P.long.push({t:e.startTime,ms:e.duration});}).observe({type:'longtask',buffered:true});}catch{}
  const cib=window.createImageBitmap;
  window.createImageBitmap=function(...a){const t=now();return cib.apply(this,a).then(v=>{P.stages.push({t,name:'bitmap copy',ms:now()-t});return v;});};
  const cd=GPUDevice.prototype.createCommandEncoder,encMeta=new WeakMap(),bufferMeta=new WeakMap();
  GPUDevice.prototype.createCommandEncoder=function(desc){const enc=cd.call(this,desc),m={encoder:enc,device:this,label:desc?.label,t:now(),kind:P.ctx?.kind||'other',rect:P.ctx?.rect,passes:[]};P.encoders.push(m);encMeta.set(enc,m);return enc;};
  const finish=GPUCommandEncoder.prototype.finish;
  GPUCommandEncoder.prototype.finish=function(...a){const b=finish.apply(this,a);bufferMeta.set(b,encMeta.get(this));return b;};
  function slot(device){let b=P.blocks.at(-1);if(!b||b.device!==device||b.n===2048){b={device,n:0,queries:device.createQuerySet({type:'timestamp',count:4096}),resolve:device.createBuffer({size:2048*256,usage:GPUBufferUsage.QUERY_RESOLVE|GPUBufferUsage.COPY_SRC}),passes:[]};P.blocks.push(b);}return b;}
  for(const kind of ['Compute','Render']){
    const begin=GPUCommandEncoder.prototype['begin'+kind+'Pass'];
    GPUCommandEncoder.prototype['begin'+kind+'Pass']=function(desc={}){
      const m=encMeta.get(this);
      if(!m?.device.features.has('timestamp-query')||desc.timestampWrites||P.reading)return begin.call(this,desc);
      const b=slot(m.device),i=b.n++,p={label:desc.label||kind,meta:m,index:i};b.passes.push(p);m.passes.push(p);
      const pass=begin.call(this,{...desc,timestampWrites:{querySet:b.queries,beginningOfPassWriteIndex:i*2,endOfPassWriteIndex:i*2+1}}),end=pass.end.bind(pass),enc=this;
      pass.end=()=>{end();enc.resolveQuerySet(b.queries,i*2,2,b.resolve,i*256);};return pass;
    };
  }
  const submit=GPUQueue.prototype.submit,done=GPUQueue.prototype.onSubmittedWorkDone;
  GPUQueue.prototype.submit=function(list){const t=now();for(const b of list){const m=bufferMeta.get(b);if(m){m.submitted=t;m.submit=P.submits.length;}}P.submits.push({t});return submit.call(this,list);};
  GPUQueue.prototype.onSubmittedWorkDone=function(){const t=now();return done.call(this).then(v=>{if(!P.reading)P.waits.push({t,ms:now()-t});return v;});};
  for(const name of ['createComputePipeline','createRenderPipeline','createComputePipelineAsync','createRenderPipelineAsync']){
    const f=GPUDevice.prototype[name];GPUDevice.prototype[name]=function(...a){const t=now(),r=f.apply(this,a),finish=()=>P.compiles.push({t,ms:now()-t,name,label:a[0]?.label});if(r?.then)return r.then(v=>{finish();return v;});finish();return r;};
  }
  P.gpuRead=async()=>{
    P.reading=true;const out=[];
    try{for(const b of P.blocks){await done.call(b.device.queue);if(!b.n)continue;const read=b.device.createBuffer({size:b.n*256,usage:GPUBufferUsage.MAP_READ|GPUBufferUsage.COPY_DST}),e=cd.call(b.device);e.copyBufferToBuffer(b.resolve,0,read,0,b.n*256);submit.call(b.device.queue,[e.finish()]);await read.mapAsync(GPUMapMode.READ);const v=new BigUint64Array(read.getMappedRange());for(const p of b.passes){const a=v[p.index*32],z=v[p.index*32+1];if(z>=a&&a>0n)out.push({label:p.label,ms:Number(z-a)/1e6,start:Number(a)/1e6,end:Number(z)/1e6,t:p.meta.submitted,submit:p.meta.submit,kind:p.meta.kind,rect:p.meta.rect});}read.destroy();}
      // Align GPU timestamps to performance.now() after the measured work is
      // drained. Submit/completion brackets bound the clock-offset uncertainty.
      const device=sculptCanvas.renderer.device;await done.call(device.queue);
      const qs=device.createQuerySet({type:'timestamp',count:2}),resolve=device.createBuffer({size:256,usage:GPUBufferUsage.QUERY_RESOLVE|GPUBufferUsage.COPY_SRC}),read=device.createBuffer({size:256,usage:GPUBufferUsage.MAP_READ|GPUBufferUsage.COPY_DST}),enc=cd.call(device);
      if(!P.clockPipeline){P.clockBuffer=device.createBuffer({size:16,usage:GPUBufferUsage.STORAGE});P.clockPipeline=device.createComputePipeline({layout:'auto',compute:{module:device.createShaderModule({code:'@group(0) @binding(0) var<storage,read_write> value:array<u32>; @compute @workgroup_size(1) fn main(){value[0]=1u;}'}),entryPoint:'main'}});P.clockGroup=device.createBindGroup({layout:P.clockPipeline.getBindGroupLayout(0),entries:[{binding:0,resource:{buffer:P.clockBuffer}}]});}
      const pass=enc.beginComputePass({timestampWrites:{querySet:qs,beginningOfPassWriteIndex:0,endOfPassWriteIndex:1}});pass.setPipeline(P.clockPipeline);pass.setBindGroup(0,P.clockGroup);pass.dispatchWorkgroups(1);pass.end();enc.resolveQuerySet(qs,0,2,resolve,0);enc.copyBufferToBuffer(resolve,0,read,0,16);
      const before=now();submit.call(device.queue,[enc.finish()]);await done.call(device.queue);const after=now();await read.mapAsync(GPUMapMode.READ);const stamp=Number(new BigUint64Array(read.getMappedRange())[0])/1e6;
      if(!stamp)throw Error('GPU clock marker returned zero; off-screen attribution is unavailable');P.gpuClock={gpuStampMs:stamp,offsetMs:(before+after)/2-stamp,uncertaintyMs:(after-before)/2,calibratedAt:(before+after)/2};
      for(const p of out){p.cpuStart=p.start+P.gpuClock.offsetMs;p.cpuEnd=p.end+P.gpuClock.offsetMs;}
      read.destroy();resolve.destroy();qs.destroy();
    }finally{P.reading=false;}return out;
  };
  P.start=()=>{P.stoppedAt=0;P.pixelReady=false;P.active=true;P.frames=[];P.frameOn=true;const gen=P.frameGen=(P.frameGen||0)+1;let last=0;const f=t=>{if(!P.frameOn||gen!==P.frameGen)return;if(last)P.frames.push({t,ms:t-last});last=t;requestAnimationFrame(f);};requestAnimationFrame(f);P.specStart=window.sculptDebug?.specStats;window.sculptCanvas?.resetMetrics?.();return now();};
  P.stop=()=>{if(P.stoppedAt)return P.stoppedAt;P.active=false;P.frameOn=false;P.frameGen=(P.frameGen||0)+1;P.stopStats=sculptCanvas.stats();return P.stoppedAt=now();};
  P.reset=()=>{if(P.baseline){closeBitmap.call(P.baseline);P.baseline=null;}P.held=new WeakSet();P.pixelPaints=[];P.extraBitmapBytes=0;P.peakExtraBitmapBytes=0;P.active=false;P.frameOn=false;P.events=[];P.inputs=[];P.handlers=[];P.stages=[];P.waits=[];P.long=[];P.compiles=[];P.frames=[];P.submits=[];for(const b of P.blocks){b.queries.destroy();b.resolve.destroy();}P.blocks=[];P.encoders=[];};
  let canvas;
  Object.defineProperty(window,'sculptCanvas',{configurable:true,get:()=>canvas,set:c=>{canvas=c;const r=c.renderer;for(const name of ['applyKnobs','setColors','upload']){const f=r[name];r[name]=function(...a){return P.call(name,()=>f.apply(this,a));};}r.timer=()=>null;const base=Object.getPrototypeOf(Object.getPrototypeOf(r));if(!base.draw.__lpWrapped){const draw=base.draw;base.draw=async function(...a){const serial=P.serial,result=await draw.apply(this,a);return {...result,__lpSerial:serial};};base.draw.__lpWrapped=true;}const f=r.renderChunk;r.renderChunk=async function(request,options){const t=now(),previous=P.ctx;P.ctx={kind:'chunk',rect:{x:request.x,y:request.y,width:request.width,height:request.height}};P.mark('bake-start',{...P.ctx.rect,level:options?.scale??1});try{return await f.call(this,request,options);}finally{P.ctx=previous;P.mark('bake-end',{x:request.x,y:request.y,width:request.width,height:request.height,ms:now()-t,level:options?.scale??1});}};}});
}
function instrument(path,source){
  const replace=(before,after,count=1)=>{const found=source.split(before).length-1;if(found!==count)throw Error(`LP0 hook drift in ${path}: ${before.slice(0,70)} (${found}, expected ${count})`);source=source.split(before).join(after);};
  if(path==='/sculpt.js'){
    replace('saveWorlds();',"__perf.call('saveWorlds',()=>saveWorlds());",(source.match(/saveWorlds\(\);/g)||[]).length);
    replace('syncWorldControls();',"__perf.call('syncWorldControls',()=>syncWorldControls());",(source.match(/syncWorldControls\(\);/g)||[]).length);
  }
  if(path==='/sculpt-canvas.js'){
    // LP0c: observe synchronous cache retention when the export trial flips.
    // Scalars only; no extra stats walk or pixel read on the input path.
    replace('function configureChunks() {', 'function configureChunks() { const __lpCacheBefore=cache.size,__lpDisplayBefore=viewChunkSize(),__lpCanonicalBefore=canonicalSize;');
    replace('}finally{budgetUpdating=false;}', "}finally{__perf.mark('configure-chunks',{cacheBefore:__lpCacheBefore,cacheAfter:cache.size,displayBefore:__lpDisplayBefore,displayAfter:viewChunkSize(),canonicalBefore:__lpCanonicalBefore,canonicalAfter:canonicalSize});budgetUpdating=false;}");
    replace('const seq=changeSeq,result=await renderer.renderChunk', 'const __lpSerial=__perf.serial,seq=changeSeq,result=await renderer.renderChunk');
    replace('const result=await renderer.renderChunk(fields', 'const __lpSerial=__perf.serial,result=await renderer.renderChunk(fields');
    replace('entry={...rect,bitmap', 'entry={...rect,__lpSerial:result.__lpSerial??__lpSerial,__lpFeedSerial:__lpSerial,bitmap',2);
    replace('weathered:readWeather,fed:true,seq,', 'weathered:readWeather,fed:true,__lpRev:feed.revision,seq,');
    replace('weathered:readWeather,input:', 'weathered:readWeather,__lpRev:fields.revision,input:');
    replace('metrics();return entry;', '__perf.tag(entry);metrics();return entry;',2);
    replace('g.drawImage(entry.bitmap,x0,y0,x1-x0,y1-y0);','g.drawImage(entry.bitmap,x0,y0,x1-x0,y1-y0);__perf.paint(entry,v);');
  }
  if(path==='/sculpt-gpu-fields.js')replace("const enc = device.createCommandEncoder({label: 'shape'}), pass = enc.beginComputePass({label: 'shape passes'});", "const enc = device.createCommandEncoder({label: 'shape'});__perf.work(enc,'shape',{x:R.x0*spacing,y:R.y0*spacing,width:(R.x1-R.x0+1)*spacing,height:(R.y1-R.y0+1)*spacing});const pass = enc.beginComputePass({label: 'shape passes'});");
  if(path==='/sculpt-erosion.js'){
    replace('async runGpu(request) {', "async runGpu(request) { __perf.activeErosion=(__perf.activeErosion||0)+1;__perf.mark('erode-start',{grid:request.grid,ox:request.ox,oy:request.oy});");
    replace('const gpu = performance.now() - tSubmit;', "__perf.activeErosion--;__perf.mark('erode-end',{});const gpu = performance.now() - tSubmit;");
    replace('const tSubmit = performance.now();',"__perf.work(encoder,'time',{x:(request.ox??0)*spacing,y:(request.oy??0)*spacing,width:grid*spacing,height:grid*spacing});const tSubmit = performance.now();");
    // Metadata must be set before queue.submit and its pass metadata is read later.
  }
  return source;
}

await cdpPortFree(port);
// A quiet start is part of LP0's protocol. macOS's driver counter catches GPU
// users that do not have a repro/measure process name; keep its readings with ps.
const gpuQuietSamples=[];
for(let quiet=0,t=Date.now();quiet<3;){
  let utilization=null;try{const raw=execFileSync('/usr/sbin/ioreg',['-l','-r','-c','AGXAccelerator'],{encoding:'utf8'});const m=/"Device Utilization %"\s*=\s*(\d+)/.exec(raw);if(m)utilization=Number(m[1]);}catch{}
  gpuQuietSamples.push({at:new Date().toISOString(),utilization});
  if(utilization===null)break;
  quiet=utilization<=20?quiet+1:0;
  if(Date.now()-t>180000)throw Error('GPU did not become quiet (<=20% driver utilization) before timing; retry in a quiet window.');
  if(quiet<3)await sleep(1000);
}
const profile=join(out,`profile-${port}`);
const chrome=spawn('/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',['--headless=new','--enable-gpu','--use-angle=metal','--enable-precise-memory-info',...(exact?['--disable-dawn-features=timestamp_quantization']:[]),`--remote-debugging-port=${port}`,`--user-data-dir=${profile}`,'--window-size=1600,1200','--no-first-run','about:blank'],{stdio:'ignore'});
let ws,id=0;const pending=new Map(),logs=[];
for(let i=0;i<100&&!ws;i++){try{const p=(await(await fetch(`http://127.0.0.1:${port}/json/list`)).json()).find(p=>p.type==='page');if(p)ws=new WebSocket(p.webSocketDebuggerUrl);}catch{}if(!ws)await sleep(200);}
if(!ws){chrome.kill();throw Error('CDP unavailable');}
await new Promise(r=>ws.onopen=r);
const send=(method,params={})=>new Promise((resolve,reject)=>{const k=++id;pending.set(k,{resolve,reject});ws.send(JSON.stringify({id:k,method,params}));});
let hookError;
ws.onmessage=async e=>{
  const m=JSON.parse(e.data);
  if(m.id){const p=pending.get(m.id);pending.delete(m.id);if(m.error)p?.reject(Error(JSON.stringify(m.error)));else p?.resolve(m.result);}
  if(m.method==='Runtime.exceptionThrown')logs.push(m.params.exceptionDetails.exception?.description||m.params.exceptionDetails.text);
  if(m.method==='Runtime.consoleAPICalled'&&m.params.type==='error')logs.push(m.params.args.map(a=>a.value??a.description).join(' '));
  if(m.method==='Fetch.requestPaused'){
    const p=m.params;
    try{const path=new URL(p.request.url).pathname,r=await send('Fetch.getResponseBody',{requestId:p.requestId}),raw=Buffer.from(r.body,r.base64Encoded?'base64':'utf8').toString(),source=instrument(path,raw);await send('Fetch.fulfillRequest',{requestId:p.requestId,responseCode:p.responseStatusCode,responseHeaders:p.responseHeaders.filter(h=>!['content-length','content-encoding'].includes(h.name.toLowerCase())),body:Buffer.from(source).toString('base64')});}
    catch(e){hookError=String(e);await send('Fetch.failRequest',{requestId:p.requestId,errorReason:'Failed'});}
  }
};
const ev=async expression=>{
  let timer;try{const r=await Promise.race([send('Runtime.evaluate',{expression,awaitPromise:true,returnByValue:true}),new Promise((_,reject)=>{timer=setTimeout(()=>reject(Error(`evaluate timed out: ${expression.slice(0,80)}`)),240000);})]);if(r.exceptionDetails)throw Error(r.exceptionDetails.exception?.description||r.exceptionDetails.text);return r.result?.value;}finally{clearTimeout(timer);}
};
const mouse=(type,x,y,down=true)=>send('Input.dispatchMouseEvent',{type,x,y,button:'left',buttons:type==='mouseReleased'?0:down?1:0,clickCount:1});
const click=async(x,y)=>{await mouse('mousePressed',x,y);await mouse('mouseReleased',x,y);};
const key=async k=>{for(const type of ['keyDown','keyUp'])await send('Input.dispatchKeyEvent',{type,key:k,code:k});};
const point=async selector=>ev(`(()=>{const e=document.querySelector(${JSON.stringify(selector)});if(!e)throw Error('Missing control '+${JSON.stringify(selector)});e.scrollIntoView({block:'center'});const r=e.getBoundingClientRect();return {x:r.x+r.width/2,y:r.y+r.height/2,w:r.width,h:r.height};})()`);
const clickElement=async selector=>{const p=await point(selector);await click(p.x,p.y);};
const result={schema:5,mode,label,colorsDriver:colorsMode,scene:sceneFile,query,startedAt:new Date().toISOString(),gpuQuietSamples,loadAverageAtStart:loadavg(),warmup,baseline:execFileSync('git',['merge-base','HEAD','main'],{encoding:'utf8'}).trim(),notes:['Paint endpoint is canvas draw completion, not physical display scanout.','First changed pixels compares tile RGBA after timing stops, replaying retained immutable bitmaps; no pixel readback runs on the measured path. Extra observer bitmap memory and untimed comparison cost are reported.','Pointer tiles use rendered art coordinates, not the inverse-projected ground pick. Whole current uses every affected visible cache tile and weather readiness, never bake frequency.','Pass timestamps cannot assign a mixed on/off-screen pass to individual pixels; wholly outside time is exact, mixed and area-weighted estimates are separate.','Final latency samples include held mid-drag pauses and release; uncompleted pauses are censored.','No editor files are changed; Fetch injects timing-only observers before modules execute.']};
try{result.processesAtStart=execFileSync('/bin/sh',['-c','ps -Ao pcpu,command -r | head'],{encoding:'utf8'});}catch(e){throw Error('Cannot check machine load; run with process inspection permission.');}
const filename=join(out,`${mode}${label?'-'+label:''}-perf.json`);
const flush=()=>{if(!warmup)writeFileSync(filename,JSON.stringify({...result,console:logs},null,1));};
const until=async(test,what,ms=180000)=>{const t=Date.now();for(;;){if(hookError)throw Error(hookError);if(await ev(test))return;if(Date.now()-t>ms)throw Error(`Timed out: ${what}`);const err=await ev('document.getElementById("error")?.textContent');if(err)throw Error(err);await sleep(100);}};
// The visible image may be final before the margin finishes. Continue observing the
// margin but keep each latency endpoint at the visible paint, not the quiet wait.
const settle=async()=>{await until(`(()=>{if(!window.sculptCanvas)return false;const keys=__perf.visible(),es=__perf.current();return keys.every(k=>es.some(e=>e.x+','+e.y===k&&!e.dirty&&(e.scale??1)<=1))&&sculptRegion.canExport()&&!sculptRegion.previewActive()&&!sculptCanvas.renderer.busy;})()`,'visible final');await ev('sculptCanvas.idle()');await sleep(150);};
const begin=async()=>{await ev('__perf.reset()');await ev('__perf.prepare()');return ev('__perf.start()');};
function analyze(data,t0,anchors=[]){
  const current=(p,m)=>m.kind==='stroke'&&m.rev!=null?p.rev>=m.rev:m.control==='knob-erosionRain'?p.feedSerial>=m.id:p.serial>=m.id;
  const paints=data.events.filter(e=>e.type==='paint'),coverage=data.events.filter(e=>e.type==='coverage'),first=[],pointer=[],all=[],final=[],focus=[],observations=[];
  const inputs=data.inputs;
  for(const m of inputs){
    const p=paints.find(e=>e.t>=m.t&&current(e,m)&&e.changed);
    if(p)first.push(p.t-m.t);
    if(m.at){const p=paints.find(e=>e.t>=m.t&&current(e,m)&&e.changed&&m.at[0]>=e.x&&m.at[0]<e.x+e.width&&m.at[1]>=e.y&&m.at[1]<e.y+e.height);if(p)pointer.push(p.t-m.t);}
    const c=coverage.find(e=>e.t>=m.t&&e.ready&&e.visible.every(k=>{const p=e.keys.find(p=>p.key===k);if(!p)return false;const affected=m.kind==='scroll'?false:m.kind!=='stroke'||!m.rectangles?.length||m.rectangles.some(r=>r.x<p.x+p.width&&p.x<r.x+r.width&&r.y<p.y+p.height&&p.y<r.y+r.height);return affected?current(p,m):m.kind==='scroll'?!p.dirty:true;}));
    if(c)all.push(c.t-m.t);observations.push({id:m.id,t:m.t,first:p?.t??null,all:c?.t??null});
  }
  for(const anchor of anchors){
    const targets=anchor.keys||data.visible,id=anchor.serial??inputs.filter(m=>m.t<=anchor.t).at(-1)?.id??0;
    const nextInput=inputs.find(m=>m.t>anchor.t)?.t??Infinity;
    const c=coverage.find(e=>e.t>=anchor.t&&e.t<nextInput&&e.ready&&targets.every(k=>e.keys.some(p=>p.key===k&&!p.dirty&&p.level<=1)));
    if(c)final.push(c.t-anchor.t);
    const at=anchor.at||[data.view.x+data.view.width/2,data.view.y+data.view.height/2];
    const focusView=coverage.find(e=>e.t>=anchor.t&&e.t<nextInput&&e.ready&&e.keys.some(p=>!p.dirty&&p.level<=1&&at[0]>=p.x&&at[0]<p.x+p.width&&at[1]>=p.y&&at[1]<p.y+p.height));if(focusView)focus.push(focusView.t-anchor.t);
  }
  if(!inputs.length){const p=paints.find(e=>e.t>=t0&&e.changed),c=coverage.find(e=>e.t>=t0&&e.ready&&data.visible.every(k=>e.keys.some(p=>p.key===k&&!p.dirty)));if(p)first.push(p.t-t0);if(c)all.push(c.t-t0);}
  const samples={first,pointer,all,final,focus},total=inputs.length||1;
  return {samples,observations,sampleTotals:{first:total,pointer:inputs.filter(m=>m.at).length,all:total,final:anchors.length,focus:anchors.length},latency:distribution(first,total),latencyPointer:distribution(pointer,inputs.filter(m=>m.at).length),latencyAll:distribution(all,total),final:distribution(final,anchors.length),focusFinal:distribution(focus,anchors.length)};
}
const capture=async(t0,anchors=[],extra={})=>{
  await ev('__perf.stop()');await ev('__perf.readPixels()');
  const data=await ev(`(()=>{const P=__perf,m=P.stopStats;return {events:P.events,inputs:P.inputs,handlers:P.handlers,stages:P.stages,waits:P.waits,long:P.long,frames:P.frames,compiles:P.compiles,specStart:P.specStart,specEnd:sculptDebug.specStats,view:sculptCanvas.view(),visible:P.visible(),chunk:m.displayChunkSize,memory:{gpuBytes:m.gpuBytes,peakGPUBytes:m.peakGPUBytes,heapBytes:m.heapBytes,peakHeapBytes:m.peakHeapBytes,peakAccountedHeapBytes:m.peakAccountedHeapBytes,rendererPeakBytes:m.renderer.peakBytes},end:P.stoppedAt,observer:{untimedPixelComparisonMs:P.pixelObserverMs,baselineBitmapBytes:P.baselineBytes,extraRetainedBitmapPeakBytes:P.peakExtraBitmapBytes}};})()`);
  data.inputs=data.inputs.filter(e=>e.t>=t0);data.events=data.events.filter(e=>e.t>=t0);const metricsEnd=extra.metricsUntil??data.end;for(const key of ['stages','waits','long','handlers','compiles'])data[key]=data[key].filter(e=>e.t>=t0&&e.t<=metricsEnd);
  const allPasses=await ev('__perf.gpuRead()'),gpuClock=await ev('__perf.gpuClock'),passes=allPasses.filter(p=>p.cpuEnd>=t0&&p.cpuStart<=metricsEnd),a=analyze(data,t0,anchors),stage={},byPass={},submits=new Map();
  for(const s of data.stages)(stage[s.name]??=[]).push(s.ms);
  const finals=data.events.filter(e=>e.type==='coverage'&&e.ready&&data.visible.every(k=>e.keys.some(p=>p.key===k&&!p.dirty&&p.level<=1))),finalT=finals.find(e=>e.t>=(data.inputs.at(-1)?.t??t0))?.t??data.end;
  const offscreen={whollyOutsideMs:0,mixedRegionMs:0,areaWeightedOutsideMs:0,unknownRegionMs:0,totalMeasuredMs:0,window:{from:t0,to:finalT}};
  for(const p of passes){
    const k=p.kind+' | '+p.label,b=byPass[k]??={n:0,ms:0,max:0};b.n++;b.ms+=p.ms;b.max=Math.max(b.max,p.ms);
    const s=submits.get(p.submit)||{start:p.start,end:p.end};s.start=Math.min(s.start,p.start);s.end=Math.max(s.end,p.end);submits.set(p.submit,s);
  }
  for(const p of allPasses){
    const ms=Math.max(0,Math.min(p.cpuEnd,finalT)-Math.max(p.cpuStart,t0));if(!ms)continue;offscreen.totalMeasuredMs+=ms;
    if(!p.rect){offscreen.unknownRegionMs+=ms;continue;}const r=p.rect,v=data.view,area=r.width*r.height,overlap=Math.max(0,Math.min(r.x+r.width,v.x+v.width)-Math.max(r.x,v.x))*Math.max(0,Math.min(r.y+r.height,v.y+v.height)-Math.max(r.y,v.y));
    if(overlap===0)offscreen.whollyOutsideMs+=ms;else if(overlap<area){offscreen.mixedRegionMs+=ms;offscreen.areaWeightedOutsideMs+=ms*(1-overlap/area);}
  }
  const calls={};for(const name of ['history.replaceState','saveWorlds','applyKnobs','syncWorldControls','setColors'])calls[name]=distribution(data.handlers.map(h=>h.calls[name]||0));
  if(extra.specStartOverride)data.specStart=extra.specStartOverride;const specStats={built:(data.specEnd?.built||0)-(data.specStart?.built||0),ms:(data.specEnd?.ms||0)-(data.specStart?.ms||0),start:data.specStart,end:data.specEnd};
  const phase={...extra,phaseStartMs:t0,anchors,latencyWindow:'Input through visible final; held-only completion and censoring are also reported',durationMs:data.end-t0,view:data.view,displayChunkSize:data.chunk,...a,rafMs:distribution(data.frames.filter(f=>f.t>=t0&&f.t<=metricsEnd).map(f=>f.ms)),split:{stage:Object.fromEntries(Object.entries(stage).map(([k,a])=>[k,{...distribution(a),totalMs:a.reduce((n,x)=>n+x,0)}])),queueWaitMs:distribution(data.waits.map(w=>w.ms)),gpuSubmissionMs:distribution([...submits.values()].map(s=>s.end-s.start)),longTasks:{...distribution(data.long.map(e=>e.ms)),totalMs:data.long.reduce((n,e)=>n+e.ms,0),top:data.long.sort((a,b)=>b.ms-a.ms).slice(0,8)},handlerMs:distribution(data.handlers.map(h=>h.ms)),handlerCalls:calls,specStats,pipelines:data.compiles,gpuPassesMs:byPass,bitmapCopyMs:distribution(stage['bitmap copy']||[]),memory:data.memory,observer:data.observer,gpuClock,offscreenGPU:offscreen},inputs:data.inputs,handlers:data.handlers};
  // Compact raw evidence remains in this one output file; no screenshots or tile art.
  const hold=anchors.at(-1)?.t??data.end;phase.heldLatency={first:distribution(a.observations.filter(o=>o.first!==null&&o.first<=hold).map(o=>o.first-o.t),data.inputs.length),wholeCurrent:distribution(a.observations.filter(o=>o.all!==null&&o.all<=hold).map(o=>o.all-o.t),data.inputs.length)};phase.events=data.events;const down=data.events.find(e=>e.type==='stroke-begin');if(down){const p=data.events.find(e=>e.type==='paint'&&e.t>=down.t&&e.rev>=down.rev&&e.changed);phase.firstStrokePreviewMs=p?p.t-down.t:null;phase.strokeBegin=down;}phase.latencyChanged=phase.latency;phase.samples.firstTile=tileSamples(phase);phase.latency=distribution(phase.samples.firstTile,data.inputs.length||1);phase.samples.pointer=tileSamples(phase,true);phase.latencyPointer=distribution(phase.samples.pointer,data.inputs.filter(m=>m.at).length);phase.releaseFinal=distribution(releaseSample(phase),1);phase.firstChunkPicture=phase.latency.p50;phase.shownInView=phase.latencyAll.p50;phase.finalInView=phase.final.p50;return phase;
};
const anchor=()=>ev('({t:performance.now(),serial:__perf.serial,keys:__perf.visible(),spec:sculptDebug.specStats,at:__perf.inputs.findLast(m=>m.at)?.at??null})');
const setup=async()=>{
  await ev(`sculptDebug.scene(${JSON.stringify(scene.strokes)},{ground:${scene.ground!==false}});sculptCanvas.zoom(1);document.getElementById('viewport').scrollTo(0,300);true`);await settle();
};

try{
  await send('Runtime.enable');await send('Page.enable');
  await send('Page.addScriptToEvaluateOnNewDocument',{source:`(${hooks.toString()})()`});
  await send('Fetch.enable',{patterns:['sculpt.js','sculpt-canvas.js','sculpt-gpu-fields.js','sculpt-erosion.js'].map(p=>({urlPattern:'*/'+p,requestStage:'Response'}))});
  const terrain=viewport?viewport.split('x').map(Number):null;
  if(terrain)await send('Emulation.setDeviceMetricsOverride',{width:terrain[0]+392,height:terrain[1]+359,deviceScaleFactor:1,mobile:false});
  const url=`${server}/sculpt.html?biome=${scene.biome||'green'}&mapX=${mode.slice(3)}&mapY=${mode.slice(3)}&scratch=lp0-${port}&gpuMB=512&heapMB=1536${scene.query?'&'+scene.query:''}${query?'&'+query:''}`;
  await send('Page.navigate',{url});
  const boot=Date.now();await until('!!window.sculptCanvas&&!document.getElementById("map-export").disabled','editor boot');result.bootMs=Date.now()-boot;result.browser=await send('Browser.getVersion');
  if(terrain)await ev(`(()=>{const v=document.getElementById('viewport');v.style.width='${terrain[0]}px';v.style.height='${terrain[1]}px';v.style.flex='none';sculptCanvas.resize();})()`);
  // Finish the blank map's startup before measuring the authored scene load.
  await settle();console.error('phase load');
  {const t0=await begin();await ev(`__perf.input('load','scene');true`);const a=await anchor();delete a.keys;await setup();result.load=await capture(t0,[a]);result.viewport=result.load.view;flush();}
  if(only==='load'||warmup)throw Error('stopped after load (--only)');
  let box;
  const strokeMove=async(x,y)=>{await ev(`__perf.nextPointerAt=sculptCanvas.pick(${x}-(${box.x}),${y}-(${box.y}));true`);await mouse('mouseMoved',x,y);};
  const stroke=async(n=40)=>{
    box=await ev(`(()=>{const r=document.getElementById('overlay').getBoundingClientRect();return {x:r.x,y:r.y,w:r.width,h:r.height};})()`);
    if(await ev('sculptDebug.state().tool')!==tool)await clickElement(`[data-tool="${tool}"]`);
    if(diameter)await ev(`(()=>{const d=document.getElementById('diameter');d.value=${diameter};d.dispatchEvent(new Event('input'));})()`);
    const x=box.x+box.w*.25,y=box.y+box.h*.45;await mouse('mousePressed',x,y);
    for(let i=1;i<=n;i++){await strokeMove(x+box.w*.45*i/n,y+Math.sin(i/6)*40);await sleep(30);}return {x:x+box.w*.45,y:y+Math.sin(n/6)*40};
  };
  if(featureDensity){await ev(`(async()=>{const f=sculptCanvas.features,v=sculptCanvas.view();f.fillRegion('tree',{type:'lasso',points:[[v.x,v.y],[v.x+v.width,v.y],[v.x+v.width,v.y+v.height],[v.x,v.y+v.height]]},{density:${featureDensity},margin:0,gap:0});await f.settled?.();})()`);await settle();}
  if(start!=='slider'){
  console.error('phase drag / release');
  {const t0=await begin(),p=await stroke();const dragStop=await ev('performance.now()'),a=await anchor();await mouse('mouseReleased',p.x,p.y);await settle();const whole=await capture(t0,[a],{metricsUntil:dragStop});result.drag={...whole,heldUntil:dragStop,movesDelivered:whole.inputs.length};result.release=await capture(a.t,[a],{input:'stroke release',specStartOverride:a.spec});flush();}
  if(['drag','release'].includes(only))throw Error(`stopped after ${only} (--only)`);
  console.error('phase resume');
  {await setup();const t0=await begin(),p=await stroke(8),release=await anchor();await mouse('mouseReleased',p.x,p.y);await sleep(100);const began=await anchor(),pendingState=await ev('({weatherPending:!sculptRegion.canExport(),foregroundPending:sculptCanvas.foregroundPending(),rendererBusy:sculptCanvas.renderer.busy,timePassesInFlight:__perf.activeErosion||0})');const q={x:p.x-50,y:p.y+35};await mouse('mousePressed',q.x,q.y);for(let i=1;i<=32;i++){await strokeMove(q.x+i*4,q.y+Math.sin(i/4)*20);await sleep(30);}const a=await anchor();await mouse('mouseReleased',q.x+128,q.y+Math.sin(8)*20);await settle();result.resume=await capture(began.t,[a],{specStartOverride:began.spec,primingStart:t0,release,secondStroke:began,actualDelayMs:began.t-release.t,pendingAtResume:pendingState});flush();}
  if(only==='resume')throw Error('stopped after resume (--only)');
  }
  // --------------------------------------------- page-native slider drags
  const openWorld=async control=>{
    await clickElement('#tab-world');
    await ev(`(()=>{const e=${control==='colors'?"document.querySelector('#world-colors input[type=color]')":`document.getElementById(${JSON.stringify(control)})`};if(!e)throw Error('Missing row');for(let p=e.parentElement;p;p=p.parentElement)if(p.tagName==='DETAILS')p.open=true;})()`);
  };
  const scrub=async(control,paused,cold=false)=>{
    await openWorld(control);const row=await point(`.scrub[data-source="${control}"]`),spec=await ev(`(()=>{const e=document.getElementById(${JSON.stringify(control)});return {min:+e.min,max:+e.max,step:+e.step,value:+e.value,disabled:e.disabled};})()`);
    if(spec.disabled)throw Error(`${control} is disabled`);
    if(cold&&spec.value!==0)throw Error('Cold gate must start at zero');
    const t0=await begin(),anchors=[];
    // 4px clears the page's drag threshold. One legal step per event, with
    // back-and-forth sweeps where a row has fewer than 30 distinct positions.
    row.x=row.x-row.w/2+8+(spec.value-spec.min)/(spec.max-spec.min)*240;let value=spec.value,raw=spec.value,x=row.x,dir=value>(spec.max+spec.min)/2?-1:1;await mouse('mousePressed',row.x,row.y);
    for(let i=0;i<36;i++){
      if(value+dir*spec.step>spec.max||value+dir*spec.step<spec.min)dir=-dir;
      value=Math.max(spec.min,Math.min(spec.max,value+dir*spec.step));
      const dx=(value-raw)/(spec.max-spec.min)*240;raw=value;x+=dx;
      // Wide-range integer knobs need >4px to start. The first displacement
      // may cross two steps; subsequent steps follow the page's own rounding.
      if(i===0&&Math.abs(x-row.x)<4){x=row.x+dir*4.1;raw=spec.value+dir*4.1*(spec.max-spec.min)/240;value=spec.min+Math.round((raw-spec.min)/spec.step)*spec.step;}
      await mouse('mouseMoved',x,row.y);await sleep(30);
      if(paused&&i===17){anchors.push(await anchor());await sleep(1000);}
    }
    anchors.push(await anchor());await mouse('mouseReleased',x,row.y);await settle();
    const p=await capture(t0,anchors,{control,scenario:cold?'cold-gate':paused?'pause':'continuous',range:spec,pauseRequestedMs:paused?1000:0});
    p.valuesDelivered=p.handlers.length;p.distinctValues=new Set(p.handlers.map(h=>h.value)).size;
    await ev(`(()=>{const e=document.getElementById(${JSON.stringify(control)});e.value=${spec.value};e.dispatchEvent(new Event('input',{bubbles:true}));e.dispatchEvent(new Event('change',{bubbles:true}));})()`);await settle();
    if(!cold&&p.valuesDelivered<30)throw Error(`${control}: only ${p.valuesDelivered} value changes delivered`);
    return p;
  };
  if(!noSliders){
    result.slider=[];
    for(const control of sliderNames){
      for(const paused of [false,true]){
        console.error('phase slider',control,paused?'pause':'continuous');await setup();
        if(control==='colors')result.slider.push(await colorDrag(paused));else result.slider.push(await scrub(control,paused));flush();
      }
    }
    // A gate is a shader comparison, not every numerical zero. This gate
    // starts closed and has not been opened in this fresh session.
    console.error('phase slider cold gate');await setup();await openWorld('knob-creaseShade');
    await ev(`(()=>{const e=document.getElementById('knob-creaseShade');e.value=0;e.dispatchEvent(new Event('input',{bubbles:true}));})()`);await settle();
    result.coldGateBefore=await ev('sculptDebug.specStats');
    result.coldGateCache={note:'fresh session; creaseShade remained zero until this phase; no cache entries evicted'};
    const cold=await scrub('knob-creaseShade',false,true);const first=cold.observations[0];cold.coldCrossing=first?{firstMs:first.first===null?null:first.first-first.t,wholeMs:first.all===null?null:first.all-first.t,pipelinesBeforeFirst: cold.split.pipelines.filter(p=>p.t>=first.t&&p.t<first.first)}:null;cold.gate='u.creaseShade > 0.0';result.slider.push(cold);flush();
  }
  if(only==='slider')throw Error('stopped after slider (--only)');
  console.error('phase scroll');await setup();
  {const t0=await begin();const jump=await ev(`(()=>{const v=document.getElementById('viewport'),from={x:v.scrollLeft,y:v.scrollTop};__perf.input('scroll','viewport');v.scrollLeft=Math.min(v.scrollWidth-v.clientWidth,from.x+2400);v.scrollTop=Math.min(v.scrollHeight-v.clientHeight,from.y+2400);return {from,to:{x:v.scrollLeft,y:v.scrollTop}};})()`);const a=await anchor();delete a.keys;await settle();result.scroll=await capture(t0,[a],{jump,driver:'one pan onto uncached ground (diagonal so map4 large also exposes new ground)'});flush();}

  if(only==='scroll')throw Error('stopped after scroll (--only)');
  if(!noExport){console.error('phase export');const t0=await begin(),a=await anchor();await ev(`sculptMap.export('LP0${mode}${port}').then(r=>window.__export={done:true,result:r},e=>window.__export={done:true,error:e.message});true`);await until('window.__export?.done','export',900000);result.export=await capture(t0,[a],await ev('window.__export'));flush();}
}catch(e){if(!String(e).includes('(--only)'))result.error=String(e.stack||e);}
finally{
  result.finishedAt=new Date().toISOString();result.loadAverageAtEnd=loadavg();result.console=logs;flush();
  console.log(warmup?'Warm-up discarded.':budgetTable([result]));if(result.error)console.error(result.error);
  ws.close();chrome.kill();await new Promise(r=>chrome.exitCode!==null?r():chrome.once('exit',r));
  // This process owns this exact temporary Chrome profile; remove it promptly.
  rmSync(profile,{recursive:true,force:true});
}
process.exitCode=result.error?1:result.slider?.some(p=>p.status==='blocked')?2:0;

// The native chooser is a browser popup widget rather than page DOM. Locate
// its rainbow bar in a screenshot before timing, then drive that widget with
// the same real CDP mouse events as the scrub rows. No replacement picker.
async function colorDrag(paused){
  if(colorsMode==='scripted')return scriptedColor(paused);
  await clickElement('#tab-world');
  await ev(`(()=>{const e=document.querySelector('#world-colors input[type=color]');for(let p=e.parentElement;p;p=p.parentElement)if(p.tagName==='DETAILS')p.open=true;})()`);
  const original=await ev(`(()=>{const e=document.querySelector('#world-colors input[type=color]');return {value:e.value,checked:e.previousElementSibling.checked};})()`);
  await clickElement('#world-colors input[type=color]');await sleep(250);
  const screenshot=await send('Page.captureScreenshot',{format:'png'});
  const bar=await ev(`new Promise((resolve,reject)=>{const img=new Image();img.onload=()=>{const c=document.createElement('canvas');c.width=img.width;c.height=img.height;const g=c.getContext('2d');g.drawImage(img,0,0);const d=g.getImageData(0,0,c.width,c.height).data;
    for(let y=0;y<c.height;y++){let xs=[],bins=new Set();const check=()=>{if(xs.length<75||xs.at(-1)-xs[0]<100||xs.at(-1)-xs[0]>180||bins.size<5)return null;return {x:xs[0],y,width:xs.at(-1)-xs[0],screenshotWidth:c.width,screenshotHeight:c.height};};for(let x=0;x<c.width;x++){const i=(y*c.width+x)*4,r=d[i]/255,g=d[i+1]/255,b=d[i+2]/255,hi=Math.max(r,g,b),lo=Math.min(r,g,b);if(hi<.8||hi-lo<.7)continue;if(xs.length&&x-xs.at(-1)>20){const found=check();if(found)return resolve(found);xs=[];bins=new Set();}let h=hi===r?((g-b)/(hi-lo)+6)%6:hi===g?(b-r)/(hi-lo)+2:(r-g)/(hi-lo)+4;xs.push(x);bins.add(Math.floor(h));}const found=check();if(found)return resolve(found);}reject(Error('Native color spectrum not found'));};img.onerror=reject;img.src='data:image/png;base64,${screenshot.data}';})`);
  const t0=await begin(),anchors=[],x=bar.x+3,y=bar.y+5;
  await mouse('mousePressed',x,y);
  for(let i=1;i<=36;i++){await mouse('mouseMoved',x+(bar.width-6)*i/36,y);await sleep(30);if(paused&&i===18){anchors.push(await anchor());await sleep(1000);}}
  anchors.push(await anchor());await mouse('mouseReleased',x+bar.width-6,y);await key('Escape');await settle();
  const p=await capture(t0,anchors,{control:'colors',scenario:paused?'pause':'continuous',nativeSpectrum:bar,pauseRequestedMs:paused?1000:0});p.valuesDelivered=p.handlers.length;p.distinctValues=new Set(p.handlers.map(h=>h.value)).size;
  if(p.valuesDelivered<30){p.samples={first:[],firstTile:[],pointer:[],all:[],final:[],focus:[]};p.sampleTotals={first:36,pointer:0,all:36,final:anchors.length,focus:anchors.length};p.latencyChanged=distribution([],36);p.latency=distribution([],36);p.latencyPointer=distribution([],0);p.latencyAll=distribution([],36);p.final=distribution([],anchors.length);p.status='blocked';p.reason='Chrome native popup ignores CDP mouse events; no scripted substitute used';console.error('Colors gap:',p.reason);}
  if(p.valuesDelivered){await ev(`(()=>{const e=document.querySelector('#world-colors input[type=color]');e.value=${JSON.stringify(original.value)};e.dispatchEvent(new Event('input',{bubbles:true}));if(!${original.checked}){e.previousElementSibling.checked=false;e.previousElementSibling.dispatchEvent(new Event('change',{bubbles:true}));}})()`);await settle();}
  return p;
}

// Owner-authorized alternative for a native popup that ignores CDP input.
// The existing picker and its own input listener do all editor work. Only
// the workload driver is scripted; no replacement control or render path.
async function scriptedColor(paused){
  await clickElement('#tab-world');
  const original=await ev(`(()=>{const e=document.querySelector('#world-colors input[type=color]');for(let p=e.parentElement;p;p=p.parentElement)if(p.tagName==='DETAILS')p.open=true;e.scrollIntoView({block:'center'});return {value:e.value,checked:e.previousElementSibling.checked,label:e.getAttribute('aria-label')};})()`);
  // A full hue sweep at fixed saturation/value: 36 distinct legal colors.
  const values=Array.from({length:36},(_,i)=>{const h=i/6,c=.65*.65,x=c*(1-Math.abs(h%2-1)),m=.65-c,rgb=h<1?[c,x,0]:h<2?[x,c,0]:h<3?[0,c,x]:h<4?[0,x,c]:h<5?[x,0,c]:[c,0,x];return '#'+rgb.map(v=>Math.round((v+m)*255).toString(16).padStart(2,'0')).join('');});
  const t0=await begin(),anchors=[];
  for(let i=0;i<values.length;i++){
    await ev(`(()=>{const e=document.querySelector('#world-colors input[type=color]');e.value=${JSON.stringify(values[i])};e.dispatchEvent(new Event('input',{bubbles:true}));})()`);
    await sleep(30);
    if(paused&&i===17){anchors.push(await anchor());await sleep(1000);}
  }
  anchors.push(await anchor());await settle();
  const p=await capture(t0,anchors,{control:'colors',scenario:paused?'pause':'continuous',driver:'scripted Colors value/input sequence (not native mouse)',picker:original.label,requestedValues:values,pauseRequestedMs:paused?1000:0});
  p.valuesDelivered=p.handlers.length;p.distinctValues=new Set(p.handlers.map(h=>h.value)).size;
  await ev(`(()=>{const e=document.querySelector('#world-colors input[type=color]');e.value=${JSON.stringify(original.value)};e.dispatchEvent(new Event('input',{bubbles:true}));if(!${original.checked}){e.previousElementSibling.checked=false;e.previousElementSibling.dispatchEvent(new Event('change',{bubbles:true}));}})()`);await settle();
  if(p.valuesDelivered!==36||p.distinctValues!==36||p.handlers.some(h=>h.isTrusted!==false))throw Error('Scripted Colors did not deliver 36 distinct, explicitly untrusted input events');
  return p;
}
