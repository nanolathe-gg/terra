import {storeDocumentBakes,loadDocumentBakes} from './sculpt-document.js';
import {TerrainRenderer} from './sculpt-renderer.js';
import {drawMapBounds} from './sculpt-map.js';
import {mountMapExport} from './sculpt-export.js';
import {mountMapFeatures} from './sculpt-features.js';
const $=id=>document.getElementById(id),MB=1024*1024;
const clamp=(x,a,b)=>Math.max(a,Math.min(b,x));
const tick=()=>new Promise(resolve=>requestAnimationFrame(resolve));
const intersects=(a,b)=>a.x<b.x+b.width && b.x<a.x+a.width && a.y<b.y+b.height && b.y<a.y+a.height;
const number=(q,key,fallback,min,max)=>clamp(Number(q.get(key))||fallback,min,max);
function hash(bytes) { let h=2166136261; for (const b of bytes) h=Math.imul(h^b,16777619); return (h>>>0).toString(16); }
async function json(url,options={}) { const response=await fetch(url,options),data=await response.json(); if (!response.ok) throw new Error(data.error||`Request failed (${response.status})`); return data; }

// The DOM scroll area describes the whole map; both displayed canvases cover
// only the viewport. Full-resolution chunk images are expendable cache entries.
export async function mountMapCanvas({config,canvas,overlay,api,drawOptions}) {
  const map=config.map,query=new URLSearchParams(location.search),viewport=$('viewport'),stage=$('stage');
  config.maskKeys=api.maskKeys; config.gpuBudgetBytes=128*MB;
  const output=document.createElement('canvas'),renderer=await TerrainRenderer.createChunked(output,config);
  const g=canvas.getContext('2d'),ink=overlay.getContext('2d'),cache=new Map();
  let gpuBudget=number(query,'gpuMB',512,128,4096)*MB,heapBudget=number(query,'heapMB',1024,128,8192)*MB;
  const levels=query.get('levels')!=='0',levelsOverlay=query.get('levelsOverlay')==='1';   // H7b: levels 0 is the final-only canvas
  let cacheBytes=0,peakGPU=0,peakHeap=0,peakAccountedHeap=0,evictions=0,bakes=0,hits=0,rebakes=0,scale=1,overview=true,pending=false,drawing=false,rerun=false,epoch=0,viewEpoch=0,busy=false,features,metadata,canonicalSize=512;
  const bakedBefore=new Set(); let lastScroll=0,lastPresented=0,pendingStrokeTime=0,budgetUpdating=false;
  let afterGesture=false,lastViewEpoch=-1,heldSince=null,pan=null,space=false,gesture=null,hover=null,optionsKey='',saveTimer=null,saving=false,saveAgain=false,lastMetadata='',docId=query.get('document')||'map-'+crypto.randomUUID();
  let maskVersions=new Map(),lastFrame=0,frameTimes=[],strokeTimes=[],resizePending=false;
  const coarse=new OffscreenCanvas(128,128),cg=coarse.getContext('2d');
  const panel=document.createElement('section'); panel.className='section files';
  panel.innerHTML=`<h3>Map view and memory</h3><div class="row"><button data-half>0.5×</button><button data-overview>Overview</button></div><canvas data-nav width="200" height="200" aria-label="Map minimap navigator" style="width:100%;height:auto;margin-top:9px;cursor:crosshair;image-rendering:pixelated"></canvas><label class="control" style="display:block">Terrain GPU budget (MiB)<input data-gpu type="number" min="128" max="4096" step="128" value="${gpuBudget/MB}"></label><label class="control" style="display:block">Page heap budget (MiB)<input data-heap type="number" min="128" max="8192" step="128" value="${heapBudget/MB}"></label><p class="small" data-memory></p><label class="control" style="display:block">Server document<input data-document value="${docId}"></label><div class="row"><button data-save>Save to server</button><button data-load>Reload document</button></div><p class="small" data-save-state>Changes save incrementally on this local server.</p>`;
  document.querySelector('aside').append(panel);
  const find=s=>panel.querySelector(s),navigatorCanvas=find('[data-nav]'),ng=navigatorCanvas.getContext('2d');
  function state() { return {x:viewport.scrollLeft/(scale||1),y:viewport.scrollTop/(scale||1),width:canvas.width/(scale||1),height:canvas.height/(scale||1),scale,overview}; }
  const sourceSample=api.sample;
  function heightSample(x,y){for(const e of cache.values()){const r=e.heightPatch;if(r&&x>=r.gridOrigin[0]&&y>=r.gridOrigin[1]&&x<=r.gridOrigin[0]+(r.gridWidth-1)*r.gridSpacing&&y<=r.gridOrigin[1]+(r.gridHeight-1)*r.gridSpacing)return sampleField(r,x,y);}return null;}
  function visibleSample(x,y){return heightSample(x,y)??sourceSample(x,y);}
  function keepHeight(r){return {fields:{h:r.fields.h},gridWidth:r.gridWidth,gridHeight:r.gridHeight,gridSpacing:r.gridSpacing,gridOrigin:r.gridOrigin,bytes:r.fields.h.byteLength};}
  function fixedGPU(external=true) { return (external?(api.gpuBytes?.()??0):0)+(canvas.width*canvas.height+overlay.width*overlay.height+coarse.width*coarse.height+navigatorCanvas.width*navigatorCanvas.height)*4+(features?.stats?.().imageBytes||0); }
  function gpuResident() { return renderer.stats().residentBytes+cacheBytes+fixedGPU(); }
  const originalKnobs=renderer.applyKnobs.bind(renderer),originalColors=renderer.setColors.bind(renderer);
  renderer.applyKnobs=(...args)=>{const r=originalKnobs(...args);configureChunks();clear();return r;};
  renderer.setColors=(...args)=>{const r=originalColors(...args);clear();return r;};
  function ownedBytes(extra=[]){const buffers=new Set(api.residentBuffers?.()||[]);for(const e of cache.values())if(e.heightPatch)buffers.add(e.heightPatch.fields.h.buffer);for(const a of extra)if(ArrayBuffer.isView(a))buffers.add(a.buffer);const r=renderer.stats();return [...buffers].reduce((n,b)=>n+b.byteLength,0)+r.cpuRetainedBytes+(r.cpuWorkingBytes??0)+(api.workingBytes?.()??0);}
  function fieldArrays(r){return [...Object.values(r.fields),...Object.values(r.weather??{}),r.materialField??r.material].filter(ArrayBuffer.isView);}
  function checkHeap(r,upload=0){const arrays=fieldArrays(r),used=()=> (performance.memory?.usedJSHeapSize??0)+ownedBytes(arrays)+upload;if(used()>heapBudget){api.evict?.();for(const e of cache.values())e.heightPatch=null;if(used()>heapBudget)throw new Error('The regional field and weather working set exceeds the JS memory budget.');}}
  api.checkMemory=(extra=0)=>{let m=metrics();if(m.accountedHeapBytes+extra>heapBudget){api.evict?.();for(const e of cache.values())e.heightPatch=null;m=metrics();if(m.accountedHeapBytes+extra>heapBudget)throw new Error('The regional field and weather working set exceeds the JS memory budget.');}};
  function metrics() {
    const fields=api.stats?.()??{},render=renderer.stats(),heap=performance.memory?.usedJSHeapSize??0,gpu=gpuResident();
    const heightBytes=[...new Set([...cache.values()].map(e=>e.heightPatch?.fields.h.buffer).filter(Boolean))].reduce((n,b)=>n+b.byteLength,0),owned=ownedBytes(),accounted=heap+owned;
    peakGPU=Math.max(peakGPU,gpu);peakHeap=Math.max(peakHeap,heap);peakAccountedHeap=Math.max(peakAccountedHeap,accounted);
    find('[data-memory]').textContent=`Terrain ${(gpu/MB).toFixed(1)} / ${gpuBudget/MB} MiB · heap ${(accounted/MB).toFixed(1)} / ${heapBudget/MB} MiB · ${cache.size} cached · ${evictions} evictions · ${canonicalSize}px bake`;
    return {gpuBytes:gpu,peakGPUBytes:peakGPU,heapBytes:heap,peakHeapBytes:peakHeap,accountedHeapBytes:accounted,peakAccountedHeapBytes:peakAccountedHeap,ownedArrayBytes:owned,gpuBudget,heapBudget,cacheBytes,heightBytes,cachedChunks:cache.size,evictions,bakes,hits,rebakes,levels:{quarter:[...cache.values()].filter(e=>(e.scale??1)>1).length,final:[...cache.values()].filter(e=>(e.scale??1)===1).length,quarterBytes:[...cache.values()].filter(e=>(e.scale??1)>1).reduce((n,e)=>n+e.bytes,0)},canonicalChunkSize:canonicalSize,field:fields,renderer:render,strokeMilliseconds:strokeTimes.slice(),frameMilliseconds:frameTimes.slice()};
  }
  function remove(key) { const e=cache.get(key);if(!e)return;e.bitmap.close?.();cacheBytes-=e.bytes;cache.delete(key);evictions++; }
  // H6b: a bake from the GPU buffers records how many changes had been announced when it took them; it is still good if none announced since touched
  // its input (an edit elsewhere on the map, or a later move of the same stroke over other chunks, does not throw it away).
  let changeSeq=0;const changeLog=[];
  function changedSince(seq,input){return changeLog.length>=256&&changeLog[0].seq>seq+1||changeLog.some(c=>c.seq>seq&&(!c.rect||intersects(c.rect,input)));}
  function clear(rect=null) { epoch++;changeLog.push({seq:++changeSeq,rect});if(changeLog.length>256)changeLog.shift();for(const [key,e] of cache)if(!rect||intersects(rect,e.input??e))remove(key);coarseColour=true;schedule(); }
  function trimTo(limit){limit=Math.max(0,limit);const v=state();for(const[key,e]of cache)if(cacheBytes>limit&&!intersects(e,v))remove(key);while(cacheBytes>limit&&cache.size)remove(cache.keys().next().value);}
  function configureChunks() {
    if(budgetUpdating)return;budgetUpdating=true;
    try {
      // Every selected budget uses the same bake lattice. Budget changes evict
      // images, rather than change GPU interpolation and palette decisions.
      const reserve=fixedGPU(false)+512*512*8;   // the bake lattice does not depend on what the GPU fields hold
      renderer.setBudget(128*MB,reserve);const next=Math.min(512,renderer.recommendedChunkSize);
      if(next!==canonicalSize){for(const key of cache.keys())remove(key);canonicalSize=next;}
      trimTo(gpuBudget-fixedGPU()-renderer.stats().retainedBytes-32*MB);
      renderer.setBudget(gpuBudget,fixedGPU()+cacheBytes+canonicalSize*canonicalSize*8);
    }finally{budgetUpdating=false;}
  }
  async function region(request,options,signal) {
    const required=renderer.requiredRegion(request,options);let r=await (api.readAsync?api.readAsync(required,signal):api.read(required));signal?.throwIfAborted();
    // A covering CPU read may include an extra sample at a fractional boundary.
    // Upload the canonical requested lattice, keeping texture sizes stable.
    const step=r.gridSpacing,dx=Math.round((required.gridOrigin[0]-r.gridOrigin[0])/step),dy=Math.round((required.gridOrigin[1]-r.gridOrigin[1])/step),w=required.gridWidth,h=required.gridHeight;
    if(dx||dy||w!==r.gridWidth||h!==r.gridHeight){
      const cut=(a,n=1)=>{if(!a)return a;const out=new a.constructor(w*h*n);for(let y=0;y<h;y++)out.set(a.subarray(((y+dy)*r.gridWidth+dx)*n,((y+dy)*r.gridWidth+dx+w)*n),y*w*n);return out;};
      const fields=Object.fromEntries(Object.entries(r.fields).map(([k,a])=>[k,ArrayBuffer.isView(a)?cut(a):a])),weather=r.weather?Object.fromEntries(Object.entries(r.weather).map(([k,a])=>[k,cut(a)])):undefined,materialField=cut(r.materialField??r.material,4);
      const arrays=new Set([...Object.values(fields),...Object.values(weather??{}),materialField].filter(ArrayBuffer.isView));r={...r,fields,weather,materialField,gridOrigin:required.gridOrigin,gridWidth:w,gridHeight:h,maskPlanes:api.maskKeys.map(k=>fields[k]),bytes:[...arrays].reduce((sum,a)=>sum+a.byteLength,0)};
    }
    return {...request,...r,fields:r.fields,material:r.materialField??r.material,gridOrigin:r.gridOrigin,gridSpacing:r.gridSpacing,gridWidth:r.gridWidth,gridHeight:r.gridHeight,worldSize:config.worldSize??config.size,worldGrid:config.worldGrid??config.grid};
  }
  function chunkSize() { return canonicalSize; }
  // H7b: `scale` 2 bakes a quarter image (half the width and height, drawn at 2x); only the GPU-fed path takes it, and export never asks.
  async function bake(rect,exportArt=false,signal,stale=null,scale=1) {
    const options=drawOptions?.()??api.drawOptions?.()??{},request={...rect,exportArt,worldSize:config.worldSize??config.size,worldGrid:config.worldGrid??config.grid};
    // H6b: with the GPU fields on, the chunk's textures are made from the fields' buffers; no CPU read, no upload, no height patch kept.
    const feed=await api.gpuFeedSource?.(signal,() => renderer.requiredRegion(request,options));   // H5b: a paged map prepares the pages under the chunk's lattice
    if(feed)try{
      signal?.throwIfAborted();
      if(stale?.())throw new DOMException('The scene changed under a queued bake.','AbortError');
      const required=renderer.requiredRegion(request,options),estimate=renderer.estimate(required,rect.width,rect.height,feed.maskCount,scale),ow=Math.ceil(rect.width/scale),oh=Math.ceil(rect.height/scale),copyBytes=ow*oh*8;
      trimTo(gpuBudget-fixedGPU()-estimate.retainedBytes-estimate.workingBytes-copyBytes);
      renderer.setBudget(gpuBudget,fixedGPU()+cacheBytes+copyBytes);signal?.throwIfAborted();
      const seq=changeSeq,result=await renderer.renderChunk(request,{...options,quality:'full',feed,scale});bakes++;
      const bitmap=await createImageBitmap(result.canvas,0,0,ow,oh,{colorSpaceConversion:'none'}),entry={...rect,bitmap,bytes:ow*oh*4,scale,fed:true,seq,input:{x:required.gridOrigin[0],y:required.gridOrigin[1],width:(required.gridWidth-1)*required.gridSpacing,height:(required.gridHeight-1)*required.gridSpacing},heightPatch:null};
      const key=rect.x+','+rect.y+','+canonicalSize+','+scale;if(bakedBefore.has(key))rebakes++;bakedBefore.add(key);metrics();return entry;
    }finally{feed.release?.();}
    const fields=await region(request,options,signal);
    // H7 2b: the scene changed while this bake waited for its fields; its image would be dropped, so it never reaches the GPU.
    if(stale?.())throw new DOMException('The scene changed under a queued bake.','AbortError');
    const required=renderer.requiredRegion(request,options),estimate=renderer.estimate({...required,gridWidth:fields.gridWidth,gridHeight:fields.gridHeight},rect.width,rect.height,fields.maskPlanes?.length??api.maskKeys.length);
    checkHeap(fields,estimate.cpuPeakBytes);
    const copyBytes=rect.width*rect.height*8;trimTo(gpuBudget-fixedGPU()-estimate.retainedBytes-estimate.workingBytes-copyBytes);
    renderer.setBudget(gpuBudget,fixedGPU()+cacheBytes+copyBytes);signal?.throwIfAborted();
    const result=await renderer.renderChunk(fields,{...options,quality:'full'});bakes++;
    const bitmap=await createImageBitmap(result.canvas,0,0,rect.width,rect.height,{colorSpaceConversion:'none'}),entry={...rect,bitmap,bytes:rect.width*rect.height*4,input:{x:fields.gridOrigin[0],y:fields.gridOrigin[1],width:(fields.gridWidth-1)*fields.gridSpacing,height:(fields.gridHeight-1)*fields.gridSpacing},heightPatch:keepHeight(fields)};
    const key=rect.x+','+rect.y+','+canonicalSize;if(bakedBefore.has(key))rebakes++;bakedBefore.add(key);metrics();return entry;
  }
  // H7 2a: the overview is sampled once per edit, over the edit's dirty rectangle only, in slices that leave the frame free.
  // A 4 x 4 lattice of the 128 x 128 points (the same points the full overview samples) comes first and fills its blocks, so a
  // picture exists after ~1k samples; the rest follow when the page is idle. Heights are kept apart from colours: a colour or
  // weather change recolours without sampling (the overview shows authored heights, which weather never touches).
  const CW=coarse.width,CH=coarse.height,coarseH=new Float32Array(CW*CH),coarseHave=new Uint8Array(CW*CH),coarseQueued=new Uint8Array(CW*CH),coarseFirst=[],coarseRest=[];
  let coarseColour=true;
  function markCoarse(rect=null) {
    const wx=x=>x/(CW-1)*(map.width-1),wy=y=>y/(CH-1)*(map.height-1),px=map.width/(CW-1),py=map.height/(CH-1);
    for(let y=0;y<CH;y++)for(let x=0;x<CW;x++){
      const i=y*CW+x;if(coarseQueued[i])continue;
      if(rect&&(wx(x)<rect.x-px||wx(x)>rect.x+rect.width+px||wy(y)<rect.y-py||wy(y)>rect.y+rect.height+py))continue;
      coarseQueued[i]=1;((x&3)===0&&(y&3)===0?coarseFirst:coarseRest).push(i);
    }
  }
  function stepCoarse(budget) {
    const start=performance.now(),sample=api.sampleAuthored??api.sample;let did=false;
    for(const queue of [coarseFirst,coarseRest]){
      while(queue.length&&performance.now()-start<budget){
        const i=queue.pop(),x=i%CW,y=(i/CW)|0;coarseQueued[i]=0;
        const h=sample(x/(CW-1)*(map.width-1),y/(CH-1)*(map.height-1));coarseH[i]=h;coarseHave[i]=1;did=true;
        if((x&3)===0&&(y&3)===0)for(let dy=0;dy<4&&y+dy<CH;dy++)for(let dx=0;dx<4&&x+dx<CW;dx++){const j=i+dy*CW+dx;if(!coarseHave[j])coarseH[j]=h;}
      }
      if(queue.length)break;
    }
    if(did)coarseColour=true;return coarseFirst.length+coarseRest.length>0;
  }
  markCoarse();
  function drawCoarse() {
    // Sample in slices, but never during a gesture: the overview is stale under the edit and refreshes on release.
    if(!gesture&&coarseFirst.length+coarseRest.length&&stepCoarse(coarseFirst.length?400:overview?12:6)&&!gesture)schedule();
    if(coarseColour) {
      const image=cg.createImageData(coarse.width,coarse.height),base=config.baseHeight,sea=config.seaLevel,mean=renderer.means?.ground||[.2,.3,.15];
      for(let y=0;y<coarse.height;y++)for(let x=0;x<coarse.width;x++) {
        const i0=y*coarse.width+x,h=coarseH[i0],i=i0*4,wet=h<sea,shade=clamp(.8+(h-base)*.005,.3,1.5),water=config.water?.shallowRGB||[42,87,130];
        for (let c=0;c<3;c++) image.data[i+c]=wet?water[c]:mean[c]*255*shade; image.data[i+3]=255;
      }
      cg.putImageData(image,0,0);coarseColour=false;
    }
    const v=state(); g.imageSmoothingEnabled=false; g.drawImage(coarse,v.x/map.width*coarse.width,v.y/map.height*coarse.height,v.width/map.width*coarse.width,v.height/map.height*coarse.height,0,0,canvas.width,canvas.height);
    ng.imageSmoothingEnabled=false; ng.drawImage(coarse,0,0,navigatorCanvas.width,navigatorCanvas.height); ng.strokeStyle='#fff0a0'; ng.lineWidth=1; ng.strokeRect(v.x/map.width*200+.5,v.y/map.height*200+.5,Math.min(200,v.width/map.width*200),Math.min(200,v.height/map.height*200));
  }
  function overlays() {
    const v=state(); ink.setTransform(1,0,0,1,0,0); ink.clearRect(0,0,overlay.width,overlay.height); ink.save(); ink.scale(scale,scale); ink.translate(-v.x,-v.y);
    drawMapBounds(ink,map,config,api.sampleAuthored??sourceSample); features?.draw(ink,v); api.drawOverlay?.(ink,v);
    if (hover && !features?.active) { ink.strokeStyle='#b8eef3'; ink.lineWidth=1/scale; ink.beginPath(); ink.arc(hover[0],hover[1]-(Math.max(config.seaLevel,visibleSample(...hover))-config.baseHeight)/2,Number($('diameter').value)/2,0,Math.PI*2); ink.stroke(); }
    // H7b: ?levelsOverlay=1 marks each shown chunk with its level: orange Q for a quarter image, green F for a final one.
    if(levelsOverlay)for(const e of cache.values())if(intersects(e,v)){const q=(e.scale??1)>1;ink.strokeStyle=q?'#ff9a3c':'#7dff7d';ink.lineWidth=2/scale;ink.strokeRect(e.x+1/scale,e.y+1/scale,e.width-2/scale,e.height-2/scale);ink.fillStyle=ink.strokeStyle;ink.font=`${16/scale}px monospace`;ink.fillText(q?'Q':'F',e.x+8/scale,e.y+20/scale);}
    ink.restore();
  }
  function paint(entry,v=state()) { g.imageSmoothingEnabled=false;const k=entry.scale??1;g.drawImage(entry.bitmap,(entry.x-v.x)*scale,(entry.y-v.y)*scale,entry.bitmap.width*k*scale,entry.bitmap.height*k*scale); }
  function presented() {
    const now=performance.now();if(lastPresented&&now-lastScroll<300&&now-lastPresented<3000){frameTimes.push(now-lastPresented);if(frameTimes.length>1024)frameTimes.shift();}lastPresented=now;
    if(pendingStrokeTime){strokeTimes.push(now-pendingStrokeTime);if(strokeTimes.length>256)strokeTimes.shift();pendingStrokeTime=0;}
  }
  async function frame() {
    pending=false;if(drawing){rerun=true;return;}drawing=true;
    try {
      const key=JSON.stringify(drawOptions?.()??api.drawOptions?.()??{});if(optionsKey&&optionsKey!==key)clear();optionsKey=key;
      drawCoarse();overlays();
      // H7 2b: while the Time pass is running, a bake would read the unweathered height and be redone when the weather lands.
      // The pass is submitted first (it starts with the edit) and chunks wait for it, for at most 8 s so a failed pass cannot hide the map.
      const weatherPending=api.canExport&&!api.canExport()&&!gesture&&!features?.busy;
      if(weatherPending){heldSince??=performance.now();}else heldSince=null;
      const holding=weatherPending&&performance.now()-heldSince<8000;
      if(holding)setTimeout(schedule,100);
      if(!overview&&!busy){
        const size=chunkSize(),v=state(),jobs=[],token=epoch,viewToken=viewEpoch;
        for(let y=Math.max(0,Math.floor(v.y/size)-1)*size;y<Math.min(map.height,v.y+v.height+size);y+=size)for(let x=Math.max(0,Math.floor(v.x/size)-1)*size;x<Math.min(map.width,v.x+v.width+size);x+=size)jobs.push({x,y,width:Math.min(size,map.width-x),height:Math.min(size,map.height-y)});
        const dist=r=>Math.hypot(r.x+size/2-v.x-v.width/2,r.y+size/2-v.y-v.height/2);
        // H7b: with levels on, the visible chunks come before the margin, each group nearest the view's centre first.
        const levelsOn=levels&&api.gpuFeedActive?.();
        jobs.sort((a,b)=>levelsOn?(intersects(b,v)-intersects(a,v))||dist(a)-dist(b):dist(a)-dist(b));
        const near={x:v.x-size,y:v.y-size,width:v.width+size*2,height:v.height+size*2};for(const e of cache.values())if(!intersects(e,near))e.heightPatch=null;
        for(const rect of jobs){const e=cache.get(rect.x+','+rect.y+','+size);if(e&&intersects(rect,v))paint(e,v);}overlays();
        // H7b: the plan. `want` 2 is a quarter image, 1 final. During a gesture every chunk without an image gets a quarter one and nothing
        // is refined; once it ends, a quarter image is replaced by a final one (visible chunks first, then the margin), and a chunk
        // that already shows final is never replaced by a quarter one. 
        const plan=[];
        if(!levelsOn)for(const rect of jobs)plan.push({rect,want:1});
        else{
          if(gesture)for(const rect of jobs)plan.push({rect,want:2});
          else{
            if(viewEpoch!==lastViewEpoch){afterGesture=false;lastViewEpoch=viewEpoch;}   // a new view (a scroll or a zoom) starts afresh; a release goes straight to final
            for(const rect of jobs)plan.push({rect,want:1});
          }
        }
        for(const {rect,want} of plan){
          if(token!==epoch||viewToken!==viewEpoch||busy)break;
          const key=rect.x+','+rect.y+','+size;let e=cache.get(key);const old=e;let baked=false;
          if(want===2&&e)continue;   // a quarter plan item never replaces an image
          const upgrade=want===1&&e&&(e.scale??1)>1;
          if((!e||upgrade)&&holding)continue;
          if(!e||upgrade){e=await bake(rect,false,undefined,()=>token!==epoch||false,want);baked=true;if(token!==epoch){
            // H6b: a finished fed bake is shown even when a later change touched it (the picture is at most one move old), but not kept: the chunk bakes again.
            if(e.fed&&changedSince(e.seq,e.input)){if(intersects(rect,v)){paint(e,v);overlays();presented();}e.bitmap.close?.();break;}
            if(!e.fed){e.bitmap.close?.();break;}
          }
          // The image it replaces (a quarter one) is dropped now that the final one is in hand.
          const prior=cache.get(key);if(prior){prior.bitmap.close?.();cacheBytes-=prior.bytes;cache.delete(key);}
          cache.set(key,e);cacheBytes+=e.bytes;}
          else{hits++;cache.delete(key);cache.set(key,e);if(!e.heightPatch&&!e.fed){const input=await region({...rect,worldSize:config.worldSize??config.size,worldGrid:config.worldGrid??config.grid},drawOptions?.()??api.drawOptions?.()??{});checkHeap(input);e.heightPatch=keepHeight(input);}}
          if(token!==epoch||cache.get(key)!==e)break;
          if(viewToken!==viewEpoch){rerun=true;break;}
          if(intersects(rect,v)){paint(e,v);overlays();presented();}await (levels&&(gesture||baked)?undefined:tick());
        }
      }else if(overview)presented();
      const m=metrics();$('timing').textContent=`${bakes} bakes · ${(m.gpuBytes/MB).toFixed(1)} MiB terrain · ${evictions} evictions`;
    }catch(err){if(err.name!=='AbortError'){$('error').hidden=false;$('error').textContent=err.message;}}
    finally{drawing=false;if(rerun){rerun=false;schedule();}}
  }
  // H7b: during a gesture a change is answered at once, not at the next animation frame (a pointer move is already one event a frame): the bake of
  // the change's chunks starts as soon as the one in flight ends, and nothing waits for a frame between them.
  function schedule() { if (!pending) { pending=true; if(levels&&gesture&&!drawing)queueMicrotask(frame);else requestAnimationFrame(frame); } }
  function resize() {
    if(busy){resizePending=true;return;}resizePending=false;
    if (overview) scale=Math.min((viewport.clientWidth-28)/map.width,(viewport.clientHeight-28)/map.height);
    stage.style.width=map.width*scale+'px'; stage.style.height=map.height*scale+'px'; stage.style.margin=overview?'auto':'0'; stage.style.overflow='visible';
    const width=Math.max(1,Math.min(viewport.clientWidth,Math.ceil(map.width*scale))),height=Math.max(1,Math.min(viewport.clientHeight,Math.ceil(map.height*scale)));
    for (const c of [canvas,overlay]) { c.width=width; c.height=height; c.style.width=width+'px'; c.style.height=height+'px'; c.style.inset='auto'; }
    position();viewEpoch++;if(renderer&&!renderer.busy)configureChunks();schedule();
  }
  function position() { for (const c of [canvas,overlay]) { c.style.left=viewport.scrollLeft+'px'; c.style.top=viewport.scrollTop+'px'; } }
  function zoom(next) { $('fit').setAttribute('aria-pressed',String(next==='overview'));$('one').setAttribute('aria-pressed',String(next===1));find('[data-half]').setAttribute('aria-pressed',String(next===.5));find('[data-overview]').setAttribute('aria-pressed',String(next==='overview'));const v=state(),cx=v.x+v.width/2,cy=v.y+v.height/2; overview=next==='overview'; if (!overview) scale=next; resize(); viewport.scrollLeft=Math.max(0,cx*scale-canvas.width/2); viewport.scrollTop=Math.max(0,cy*scale-canvas.height/2); position(); schedule(); }
  $('fit').onclick=()=>zoom('overview'); $('one').onclick=()=>zoom(1); find('[data-half]').onclick=()=>zoom(.5); find('[data-overview]').onclick=()=>zoom('overview');
  viewport.addEventListener('scroll',()=>{position();viewEpoch++;lastScroll=performance.now();schedule();},{passive:true}); new ResizeObserver(resize).observe(viewport);
  function screen(event) { const r=overlay.getBoundingClientRect(),v=state(); return {x:v.x+(event.clientX-r.left)/scale,z:v.y+(event.clientY-r.top)/scale}; }
  function pick(cx,cy) {
    const v=state(),x=clamp(v.x+cx/scale,0,map.width-1),sy=v.y+cy/scale;
    let previousY=sy+170,previous=previousY-(Math.max(config.seaLevel,visibleSample(x,previousY))-config.baseHeight)/2-sy;
    for (let y=previousY-2;y>=sy-80;y-=2) { const value=y-(Math.max(config.seaLevel,visibleSample(x,y))-config.baseHeight)/2-sy; if (value<=0 && previous>=0) return [x,clamp(previousY-2*previous/Math.max(1e-6,previous-value),0,map.height-1)]; previous=value; previousY=y; }
    return [x,clamp(sy,0,map.height-1)];
  }
  function pickWorld(p) { const v=state(); return pick((p.x-v.x)*scale,(p.z-v.y)*scale); }
  navigatorCanvas.onpointerdown=event=>{const r=navigatorCanvas.getBoundingClientRect(); if (overview) zoom(1); viewport.scrollLeft=(event.clientX-r.left)/r.width*map.width*scale-canvas.width/2; viewport.scrollTop=(event.clientY-r.top)/r.height*map.height*scale-canvas.height/2;position();schedule();};
  function localPoint(event){const p=screen(event),q=pickWorld(p);return {x:q[0],y:q[1]};}
  function nodeMetadata(index){return api.nodeMetadata?api.nodeMetadata(index):api.graph()[index];}
  function moveHandles(index){const n=nodeMetadata(index);if(!n?.points?.length)return null;let ax=Infinity,ay=Infinity,bx=-Infinity,by=-Infinity;for(const p of n.points){ax=Math.min(ax,p.x);ay=Math.min(ay,p.y);bx=Math.max(bx,p.x);by=Math.max(by,p.y);}const x=(ax+bx)/2,y=(ay+by)/2,lift=(Math.max(config.seaLevel,visibleSample(x,y))-config.baseHeight)/2,radius=Math.min(Math.hypot(bx-ax,by-ay)/2+(n.params?.radius||40),config.size*.45);return {pivot:{x,y},centre:{x,y:y-lift},rotate:{x,y:y-lift-radius},scale:{x:x+radius*.707,y:y-lift+radius*.707}};}
  overlay.addEventListener('pointerdown',event=>{
    if(![0,1].includes(event.button)||busy||gesture||pan||api.gestureActive?.()||!api.ready())return;event.preventDefault();overlay.focus({preventScroll:true});overlay.setPointerCapture(event.pointerId);
    if(space||event.button===1){pan={id:event.pointerId,x:event.clientX,y:event.clientY,left:viewport.scrollLeft,top:viewport.scrollTop};return;}
    if(features?.active)return;
    const p=localPoint(event),start=performance.now();
    if(api.currentTool()==='move'){
      const screenPoint=screen(event),selected=api.selection(),handles=moveHandles(selected),hit=handles&&['rotate','scale'].find(k=>Math.hypot(screenPoint.x-handles[k].x,screenPoint.z-handles[k].y)<12/scale);
      const index=hit?selected:api.selectAt(p);if(index<0)return;const h=moveHandles(index);if(api.beginMove(index)===false)return;gesture={id:event.pointerId,clientX:event.clientX,clientY:event.clientY,type:'move',index,start,p,screen:screenPoint,handles:h,amount:nodeMetadata(index)?.params?.amount??0,action:event.shiftKey?'amount':hit||'move'};
    }else{api.beginStroke(api.currentTool(),p,api.strokeOptions());gesture={id:event.pointerId,clientX:event.clientX,clientY:event.clientY,type:'stroke',points:[p],start};}
    pendingStrokeTime=start;metadata?.update?.();schedule();
  });
  function preview(event,final=false){
    hover=pickWorld(screen(event));
    // A stationary release must not pick the newly raised surface again.
    if(gesture?.id!==event.pointerId||gesture.clientX===event.clientX&&gesture.clientY===event.clientY)return;
    if(gesture.type==='stroke'&&Math.hypot(hover[0]-gesture.points.at(-1).x,hover[1]-gesture.points.at(-1).y)>(final?0:3)){gesture.clientX=event.clientX;gesture.clientY=event.clientY;gesture.points.push({x:hover[0],y:hover[1]});pendingStrokeTime=performance.now();api.previewStroke(gesture.points);}
    else if(gesture.type==='move'){
      gesture.clientX=event.clientX;gesture.clientY=event.clientY;const q=screen(event),h=gesture.handles,c=h.pivot,around=(a,b,c1,d)=>[a,b,c1,d,c.x-a*c.x-c1*c.y,c.y-b*c.x-d*c.y];let edit;
      if(gesture.action==='rotate'){const angle=Math.atan2(q.z-h.centre.y,q.x-h.centre.x)-Math.atan2(gesture.screen.z-h.centre.y,gesture.screen.x-h.centre.x);edit={matrix:around(Math.cos(angle),Math.sin(angle),-Math.sin(angle),Math.cos(angle))};}
      else if(gesture.action==='scale'){const k=clamp(Math.hypot(q.x-h.centre.x,q.z-h.centre.y)/Math.max(1,Math.hypot(gesture.screen.x-h.centre.x,gesture.screen.z-h.centre.y)),.2,4);edit={matrix:around(k,0,0,k)};}
      else if(gesture.action==='amount')edit={amount:gesture.amount+(gesture.screen.z-q.z)*1.5};
      else edit={dx:q.x-gesture.screen.x,dy:q.z-gesture.screen.z};pendingStrokeTime=performance.now();api.previewMove(edit);
    }
  }
  overlay.addEventListener('pointermove',event=>{
    if(pan?.id===event.pointerId){viewport.scrollLeft=pan.left-event.clientX+pan.x;viewport.scrollTop=pan.top-event.clientY+pan.y;position();viewEpoch++;lastScroll=performance.now();schedule();return;}
    preview(event);if(gesture?.id===event.pointerId)schedule();overlays();
  });
  const end=event=>{if(pan?.id===event.pointerId)pan=null;if(gesture?.id===event.pointerId){const commit=event.type==='pointerup';if(commit)preview(event,true);const s=gesture;gesture=null;afterGesture=true;if(s.type==='move')api.endMove(commit);else api.endStroke(commit);if(commit)pendingStrokeTime=performance.now();queueSave();}if(overlay.hasPointerCapture(event.pointerId))overlay.releasePointerCapture(event.pointerId);schedule();};
  for(const name of ['pointerup','pointercancel','lostpointercapture'])overlay.addEventListener(name,end);
  document.addEventListener('keydown',event=>{if(event.code==='Space'&&!['INPUT','TEXTAREA','SELECT'].includes(event.target.tagName)){space=true;event.preventDefault();}if(event.key==='Escape'&&gesture)end({pointerId:gesture.id,type:'pointercancel'});});document.addEventListener('keyup',event=>{if(event.code==='Space')space=false;});
  window.addEventListener('blur',()=>{space=false;pan=null;if(gesture)end({pointerId:gesture.id,type:'pointercancel'});});
  function budgets(){gpuBudget=clamp(Number(find('[data-gpu]').value)||512,128,4096)*MB;heapBudget=clamp(Number(find('[data-heap]').value)||1024,128,8192)*MB;api.setBudget?.(heapBudget*.65);configureChunks();metrics();schedule();}
  find('[data-gpu]').onchange=budgets;find('[data-heap]').onchange=budgets;
  function sampleField(r,x,y){const a=r.fields.h,w=r.gridWidth,h=r.gridHeight,step=r.gridSpacing,ox=Math.round(r.gridOrigin[0]/step),oy=Math.round(r.gridOrigin[1]/step),gx=clamp(x/step-ox,0,w-1),gy=clamp(y/step-oy,0,h-1),ix=Math.floor(gx),iy=Math.floor(gy),jx=Math.min(ix+1,w-1),jy=Math.min(iy+1,h-1),fx=gx-ix,fy=gy-iy;return(a[iy*w+ix]*(1-fx)+a[iy*w+jx]*fx)*(1-fy)+(a[jy*w+ix]*(1-fx)+a[jy*w+jx]*fx)*fy;}
  async function idle(){while(drawing||pending||renderer.busy)await tick();}
  async function sampleHeights(signal){
    await idle();const heights=new Uint8Array(map.widthCells*map.heightCells);let clipped=0;
    // Each corner is sampled from an awaited canonical weather field. No
    // uncached preview height may enter the TNT while lazy tiles are refining.
    for(let z=0;z<map.heightCells;z+=32)for(let x=0;x<map.widthCells;x+=32){
      signal?.throwIfAborted();const nx=Math.min(32,map.widthCells-x),nz=Math.min(32,map.heightCells-z),req={x:x*16,y:z*16,width:(nx-1)*16,height:(nz-1)*16};
      const r=await(api.readAsync?api.readAsync(req,signal):api.read(req));checkHeap(r);
      for(let yy=0;yy<nz;yy++)for(let xx=0;xx<nx;xx++){const h=sampleField(r,(x+xx)*16,(z+yy)*16);if(h<0||h>255)clipped++;heights[(z+yy)*map.widthCells+x+xx]=Math.round(clamp(h,0,255));}metrics();await tick();
    }return{heights,clipped};
  }
  async function exportChunks(accept,signal){
    await idle();const size=chunkSize(),total=Math.ceil(map.width/size)*Math.ceil(map.height/size);let index=0;
    for(let y=0;y<map.height;y+=size)for(let x=0;x<map.width;x+=size){signal?.throwIfAborted();const rect={x,y,width:Math.min(size,map.width-x),height:Math.min(size,map.height-y)},entry=await bake(rect,true,signal),tile=new OffscreenCanvas(rect.width,rect.height);tile.getContext('2d').drawImage(entry.bitmap,0,0);entry.bitmap.close?.();const png=await tile.convertToBlob({type:'image/png'});await accept({...rect,png},index++,total);tile.width=tile.height=1;metrics();}
  }
  async function saveDocument() {
    if(saving){saveAgain=true;return;}saving=true;find('[data-load]').disabled=true;
    try {
      const id=find('[data-document]').value.trim();if(!/^[A-Za-z0-9_-]{1,100}$/.test(id))throw new Error('Use letters, numbers, hyphens and underscores for the document name.');if(id!==docId){docId=id;maskVersions.clear();lastMetadata='';}
      const writeChunk=async(key,bytes)=>{const version=hash(bytes);if(maskVersions.get(key)===version)return;await json('/map-document/chunk?'+new URLSearchParams({id,key}),{method:'PUT',headers:{'Content-Type':'application/octet-stream'},body:bytes});maskVersions.set(key,version);};
      const sketch=await storeDocumentBakes(api.sketch(),writeChunk),body={format:'nanolathe-map-document',version:1,sketch,mapData:api.mapData(),map,biome:config.biomeId,seaLevel:config.seaLevel};
      const chunks=(await api.maskChunks?.())||[];for(const chunk of chunks){const header=new TextEncoder().encode(JSON.stringify({rect:chunk.rect,gridWidth:chunk.gridWidth,gridHeight:chunk.gridHeight,gridOrigin:chunk.gridOrigin,gridSpacing:chunk.gridSpacing,keys:api.maskKeys})),planes=chunk.planes||[],bytes=new Uint8Array(4+header.length+planes.reduce((sum,a)=>sum+a.byteLength,0));new DataView(bytes.buffer).setUint32(0,header.length,true);bytes.set(header,4);let offset=4+header.length;for(const plane of planes){bytes.set(new Uint8Array(plane.buffer,plane.byteOffset,plane.byteLength),offset);offset+=plane.byteLength;}const version=hash(bytes);if(maskVersions.get(chunk.key)===version)continue;await json('/map-document/chunk?'+new URLSearchParams({id,key:chunk.key}),{method:'PUT',headers:{'Content-Type':'application/octet-stream'},body:bytes});maskVersions.set(chunk.key,version);}
      const encoded=JSON.stringify(body);if(encoded!==lastMetadata){await json('/map-document?'+new URLSearchParams({id}),{method:'PUT',headers:{'Content-Type':'application/json'},body:encoded});lastMetadata=encoded;}
      find('[data-save-state]').textContent='Saved to server · '+id;
    }catch(err){find('[data-save-state]').textContent=err.message;throw err;}finally{saving=false;find('[data-load]').disabled=busy;if(saveAgain){saveAgain=false;queueSave();}}
  }
  async function loadDocument() {
    clearTimeout(saveTimer);while(saving)await tick();clearTimeout(saveTimer);
    const id=find('[data-document]').value.trim(),data=await json('/map-document?'+new URLSearchParams({id}));
    const documentData=data.document??data.metadata??data;
    if(documentData.biome!==config.biomeId||documentData.map?.unitsX!==map.unitsX||documentData.map?.unitsY!==map.unitsY||documentData.seaLevel!==config.seaLevel)throw new Error('Open a canvas with the document’s world, dimensions and sea level before loading it.');
    const storedBytes=api.checkGraphMemory?.(documentData.sketch.nodes??[])??0;let encodedBytes=0;
    const sketch=await loadDocumentBakes(documentData.sketch,async key=>{const r=await fetch('/map-document/chunk?'+new URLSearchParams({id,key}));if(!r.ok)throw new Error('Could not read saved flow plane '+key);const rawLength=r.headers.get('Content-Length'),length=Number(rawLength);if(!/^\d+$/.test(rawLength??'')||!Number.isSafeInteger(length))throw new Error('The saved flow chunk has no valid byte length.');encodedBytes+=length;api.checkMemory?.(storedBytes+6*encodedBytes);return r.text();});
    await api.loadSketch(sketch);api.restoreMapData(documentData.mapData);docId=id;lastMetadata=JSON.stringify(documentData);maskVersions.clear();clear();find('[data-save-state]').textContent='Reloaded server document · '+id;
  }
  function queueSave(){clearTimeout(saveTimer);if(gesture||busy)return;saveTimer=setTimeout(()=>saveDocument().catch(()=>{}),700);}
  find('[data-save]').onclick=()=>saveDocument().catch(()=>{});find('[data-load]').onclick=()=>loadDocument().catch(err=>{find('[data-save-state]').textContent=err.message;});
  // H6b: with the GPU feed the chunks rebake as a change is submitted (they read the GPU buffers); the overview and the save wait until the CPU copy holds it.
  const invalidate=change=>clear(api.expandDirty?.(change?.rect??null)??change?.rect??null);
  api.subscribeSubmit?.(change=>{if(api.gpuFeedActive?.()){pendingStrokeTime ||= performance.now();invalidate(change);}});
  api.subscribe?.(change=>{pendingStrokeTime ||= performance.now();markCoarse(change?.rect??null);if(!api.gpuFeedActive?.())invalidate(change);queueSave();});
  function setBusy(on){busy=on;api.setBusy(on);find('[data-gpu]').disabled=on;find('[data-heap]').disabled=on;find('[data-load]').disabled=on||saving;if(!on){if(resizePending)resize();else schedule();}}
  features=await mountMapFeatures({config,host:document.querySelector('aside'),canvas:overlay,screenPoint:screen,pick:(x,z)=>pickWorld({x,z}),sample:visibleSample,change:()=>{api.mapChanged();queueSave();schedule();},schedule,enabled:()=>api.ready()&&!busy});api.registerFeatures?.(features);
  metadata=mountMapExport({config,canvas,stream:{sampleHeights,exportChunks},ready:()=>api.ready()&&(!api.canExport||api.canExport())&&!gesture&&!features.busy,revision:()=>api.revision?.()??epoch,mapData:api.mapData,features:()=>features,change:()=>{api.mapChanged();queueSave();},onUpdate:fn=>api.onUpdate?.(fn),busy:setBusy,restore:schedule});api.registerMetadata?.(metadata);
  const result={renderer,schedule,resize,pick,view:state,stats:metrics,heightSample,sampleHeights,exportChunks,saveDocument,loadDocument,setBusy,features,metadata,invalidate:clear,zoom,idle,debugBake:async(rect,level=1,exportArt=false)=>{await idle();const e=await bake(rect,exportArt,undefined,null,level);return e.bitmap;},setBudgets:({gpuMB=gpuBudget/MB,heapMB=heapBudget/MB}={})=>{find('[data-gpu]').value=gpuMB;find('[data-heap]').value=heapMB;budgets();},resetMetrics:()=>{peakGPU=peakHeap=peakAccountedHeap=0;strokeTimes.length=frameTimes.length=0;},get cacheKeys(){return [...cache.keys()];}};
  window.sculptCanvas=result;resize();budgets();return result;
}
