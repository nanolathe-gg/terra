(() => {
if(!new URLSearchParams(location.search).has('interaction'))return;
const P=window.interactionPerf={events:[],stages:{},frames:[],frameRecords:[],long:[],inputs:[],samples:0};
addEventListener('unhandledrejection',e=>{if(P.disposing&&e.reason?.name==='AbortError')e.preventDefault();});
const now=()=>performance.now(),add=(name,ms)=>{const s=P.stages[name]??={n:0,ms:0,max:0};s.n++;s.ms+=ms;s.max=Math.max(s.max,ms);};
P.mark=(type,data={})=>P.events.push({t:now(),type,...data});
const di=CanvasRenderingContext2D.prototype.drawImage,seenBitmaps=new WeakSet();
CanvasRenderingContext2D.prototype.drawImage=function(src,...args){if(this.canvas.id==='terrain'){const detail=src instanceof ImageBitmap,fresh=detail&&!seenBitmaps.has(src);if(detail)seenBitmaps.add(src);P.mark('present',{detail,fresh});}return di.call(this,src,...args);};
new PerformanceObserver(list=>{P.long.push(...list.getEntries().map(x=>({t:x.startTime,ms:x.duration})));}).observe({type:'longtask',buffered:true});
const devices=new WeakMap(),create=GPUDevice.prototype.createCommandEncoder;
GPUDevice.prototype.createCommandEncoder=function(desc){const e=create.call(this,desc);devices.set(e,this);return e;};
let ring;
for(const kind of ['Compute','Render']){const original=GPUCommandEncoder.prototype['begin'+kind+'Pass'];GPUCommandEncoder.prototype['begin'+kind+'Pass']=function(desc={}){
 const device=devices.get(this);
 if(!device?.features.has('timestamp-query')||desc.timestampWrites)return original.call(this,desc);
 if(!ring)ring={device,query:device.createQuerySet({type:'timestamp',count:4096}),resolve:device.createBuffer({size:256*2048,usage:GPUBufferUsage.QUERY_RESOLVE|GPUBufferUsage.COPY_SRC}),next:0,labels:[]};
 if(ring.next>=2048)return original.call(this,desc);
 const i=ring.next++;ring.labels[i]=desc.label||kind;const pass=original.call(this,{...desc,timestampWrites:{querySet:ring.query,beginningOfPassWriteIndex:i*2,endOfPassWriteIndex:i*2+1}}),end=pass.end.bind(pass),enc=this;
 pass.end=()=>{end();enc.resolveQuerySet(ring.query,i*2,2,ring.resolve,i*256);};return pass;
};}
P.readGPU=async()=>{if(!ring)return {};const r=ring,n=r.next,d=r.device;await d.queue.onSubmittedWorkDone();const b=d.createBuffer({size:Math.max(256,n*256),usage:GPUBufferUsage.MAP_READ|GPUBufferUsage.COPY_DST}),e=d.createCommandEncoder();e.copyBufferToBuffer(r.resolve,0,b,0,Math.max(256,n*256));d.queue.submit([e.finish()]);await b.mapAsync(GPUMapMode.READ);const data=new BigUint64Array(b.getMappedRange().slice(0));b.destroy();const out={};for(let i=0;i<n;i++){const ms=Number(data[i*32+1]-data[i*32])/1e6,s=out[r.labels[i]]??={n:0,ms:0,max:0};s.n++;s.ms+=ms;s.max=Math.max(s.max,ms);}return out;};
const wrap=(obj,name)=>{const f=obj[name];if(typeof f!=='function')return;obj[name]=function(...args){const t=now(),finish=x=>{add(name,now()-t);return x;};const v=f.apply(this,args);return v?.then?v.then(finish):finish(v);};};
let canvas;
Object.defineProperty(window,'sculptCanvas',{configurable:true,get:()=>canvas,set:c=>{
 canvas=c;const r=c.renderer,rc=r.renderChunk.bind(r);
 r.renderChunk=async(request,options)=>{const t=now();P.mark('bake-start',{x:request.x,y:request.y,level:options?.scale??1,revision:options?.feed?.revision});try{return await rc(request,options);}finally{P.mark('bake-end',{x:request.x,y:request.y,ms:now()-t,level:options?.scale??1});}};
 for(const k of ['allocate','regionMesh','feedFromGpu'])wrap(r,k);
 wrap(Object.getPrototypeOf(Object.getPrototypeOf(r)),'draw');
 const api=window.sculptRegion;
 for(const k of ['previewStroke','previewMove']){const f=api[k];api[k]=function(...a){const t=now();const v=f.apply(this,a);P.inputs.push({t,ms:now()-t,revision:api.stats().revision});return v;};}
 api.subscribeSubmit?.(x=>P.mark('shape-submit',x));
}});
P.reset=()=>{P.events=[];P.stages={};P.frames=[];P.frameRecords=[];P.long=[];P.inputs=[];if(ring){ring.next=0;ring.labels=[];}};
P.start=()=>{P.on=true;let last=0;const loop=t=>{if(last){P.frames.push(t-last);P.frameRecords.push({t,ms:t-last});}last=t;if(P.on)requestAnimationFrame(loop);};requestAnimationFrame(loop);};
P.stop=()=>{P.on=false;};
})();
