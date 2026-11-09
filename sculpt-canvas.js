import {createPreviewFields} from './sculpt-preview.js';
import {selectionGeometry,hitSelection,drawSelection} from './sculpt-selection.js';
import {TerrainRenderer} from './sculpt-renderer.js';
import {drawMapBounds,sampleField,cellHeights,cellHeightTiles} from './sculpt-map.js';
import {mountMapExport} from './sculpt-export.js';
import {mountMapFeatures} from './sculpt-features.js';
import {mountPassability} from './sculpt-passability-view.js';
import {pagedBudget,VIEW_CANVASES} from './sculpt-scene.js';
const $=id=>document.getElementById(id),MB=1024*1024;
const clamp=(x,a,b)=>Math.max(a,Math.min(b,x));
const tick=()=>new Promise(resolve=>requestAnimationFrame(resolve));
const intersects=(a,b)=>a.x<b.x+b.width && b.x<a.x+a.width && a.y<b.y+b.height && b.y<a.y+a.height;
const number=(q,key,fallback,min,max)=>clamp(Number(q.get(key))||fallback,min,max);

// The DOM scroll area describes the whole map; both displayed canvases cover
// only the viewport. Full-resolution chunk images are expendable cache entries.
export async function mountMapCanvas({config,canvas,overlay,api,drawOptions}) {
  const map=config.map,query=new URLSearchParams(location.search),viewport=$('viewport'),stage=$('stage');
  config.maskKeys=api.maskKeys; config.gpuBudgetBytes=128*MB;
  const output=document.createElement('canvas'),renderer=await TerrainRenderer.createChunked(output,config);
  const g=canvas.getContext('2d'),ink=overlay.getContext('2d'),cache=new Map();
  const previewFields=createPreviewFields(renderer.device,api.previewScene);let previewReserved=false;
  let weatheredView=true;
  try{weatheredView=localStorage.getItem('terraform-weathered-view')!=='false';}catch{}
  if(query.has('weatheredView'))weatheredView=query.get('weatheredView')!=='0';
  $('weathered-view-control').hidden=false;$('weathered-view').checked=weatheredView;
  const displayLevel=()=>overview?Math.max(1,2**Math.floor(Math.log2(1/scale))):1;
  // H26: above 100% the final image is baked at the screen's pixels (.5 up to 200%, .25 beyond), so the grain stays one texel per drawn pixel; only the
  // fed path takes a level. A level that does not fit the GPU budget lowers `finest` until the next budget change.
  let finest=.25;
  const detailLevel=()=>overview||!levels||!api.gpuFeedActive?.()?1:Math.max(finest,scale<=1?1:scale<=2?.5:.25);
  const detailBytes=level=>{const size=viewChunkSize();return(Math.ceil(canvas.width*level/size)+1)*(Math.ceil(canvas.height*level/size)+1)*(size/level)**2*4;};   // the most its view's tiles can hold
  const offLevel=(e,want)=>(e.scale??1)!==want&&(e.fed||want===1);   // an image not at the level wanted; a non-fed one cannot be at a finer level, so it stays
  const cacheKey=(rect,size=canonicalSize)=>[rect.x,rect.y,size,overview?'fit':weatheredView?'detail':'authored'].join(',');
  let gpuBudget=number(query,'gpuMB',512,128,4096)*MB,heapBudget=number(query,'heapMB',1024,128,8192)*MB;
  const levels=query.get('levels')!=='0',levelsOverlay=query.get('levelsOverlay')==='1';   // H7b: levels 0 is the final-only canvas
  let dirtyMarks=0,retainedInvalidations=0;
  const interacting=()=>Boolean(gesture||api.previewActive?.());
  let cacheBytes=0,peakGPU=0,peakHeap=0,peakAccountedHeap=0,evictions=0,bakes=0,hits=0,rebakes=0,scale=1,overview=true,pending=false,drawing=false,rerun=false,epoch=0,viewEpoch=0,busy=false,features,metadata,passability,canonicalSize=512;
  let paintedView=-1,navigationTimer=null,activeBake=null;
  // Only optional background work and hover detail wait for navigation to
  // settle. Visible terrain starts immediately, including during a held pan.
  const navigationDelay=180;
  const navigating=()=>Boolean(pan||navigationPointer!==null||navigationTimer!==null);
  const bakedBefore=new Set(); let lastScroll=-Infinity,lastPresented=0,pendingStrokeTime=0,budgetUpdating=false;
  let heldSince=null,pan=null,space=false,gesture=null,hover=null,pointerTurn=true,optionsKey='';
  let hoveredNode=-1;
  let lastFrame=0,frameTimes=[],strokeTimes=[],resizePending=false;
  const coarse=new OffscreenCanvas(VIEW_CANVASES.overview,VIEW_CANVASES.overview),cg=coarse.getContext('2d');
  const panel=document.createElement('section'); panel.className='section files';
  panel.innerHTML=`<h3>Memory budgets</h3><label class="control" style="display:block">Terrain GPU budget (MiB)<input data-gpu type="number" min="128" max="4096" step="128" value="${gpuBudget/MB}"></label><label class="control" style="display:block">Page heap budget (MiB)<input data-heap type="number" min="128" max="8192" step="128" value="${heapBudget/MB}"></label><p class="small" data-memory></p><p class="small" data-drainage></p>`;
  $('graphics-host').append(panel);
  $('minimap-host').innerHTML=`<canvas data-nav width="${VIEW_CANVASES.minimap}" height="${VIEW_CANVASES.minimap}" tabindex="0" aria-label="Minimap: drag to pan, or use arrow keys"></canvas>`;
  const find=s=>document.querySelector(s),navigatorCanvas=find('[data-nav]'),ng=navigatorCanvas.getContext('2d');
  function state() { return {x:viewport.scrollLeft/(scale||1),y:viewport.scrollTop/(scale||1),width:canvas.width/(scale||1),height:canvas.height/(scale||1),scale,overview}; }
  const sourceSample=api.sample;
  function heightSample(x,y){for(const e of cache.values()){const r=e.heightPatch;if(e.weathered===weatheredView&&r&&x>=r.gridOrigin[0]&&y>=r.gridOrigin[1]&&x<=r.gridOrigin[0]+(r.gridWidth-1)*r.gridSpacing&&y<=r.gridOrigin[1]+(r.gridHeight-1)*r.gridSpacing)return sampleField(r,x,y);}return null;}
  function visibleSample(x,y){return heightSample(x,y)??(weatheredView?sourceSample:api.sampleAuthored??sourceSample)(x,y);}
  function keepHeight(r){return {fields:{h:r.fields.h},gridWidth:r.gridWidth,gridHeight:r.gridHeight,gridSpacing:r.gridSpacing,gridOrigin:r.gridOrigin,bytes:r.fields.h.byteLength};}
  function fixedGPU(external=true) { return (external?(api.gpuBytes?.()??0):0)+(previewReserved?64*MB:0)+(canvas.width*canvas.height+overlay.width*overlay.height+coarse.width*coarse.height+navigatorCanvas.width*navigatorCanvas.height)*4+(features?.stats?.().imageBytes||0); }
  function steadyGPU() { return fixedGPU()-(api.gpuTransientBytes?.()??0); }   // what a bake budgets against: fixedGPU less the Time pass's memory, gone when the pass ends
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
    const heightBytes=[...new Set([...cache.values()].map(e=>e.heightPatch?.fields.h.buffer).filter(Boolean))].reduce((n,b)=>n+b.byteLength,0),owned=ownedBytes()+(passability?.stats().bytes||0),accounted=heap+owned;
    peakGPU=Math.max(peakGPU,gpu);peakHeap=Math.max(peakHeap,heap);peakAccountedHeap=Math.max(peakAccountedHeap,accounted);
    find('[data-memory]').textContent=`Terrain ${(gpu/MB).toFixed(1)} / ${gpuBudget/MB} MiB · heap ${(accounted/MB).toFixed(1)} / ${heapBudget/MB} MiB · ${cache.size} cached · ${evictions} evictions · ${canonicalSize}px bake`;
    return {gpuBytes:gpu,peakGPUBytes:peakGPU,heapBytes:heap,peakHeapBytes:peakHeap,accountedHeapBytes:accounted,peakAccountedHeapBytes:peakAccountedHeap,ownedArrayBytes:owned,gpuBudget,heapBudget,cacheBytes,heightBytes,cachedChunks:cache.size,preview:previewFields.stats(),dirtyChunks:[...cache.values()].filter(e=>e.dirty).length,dirtyMarks,retainedInvalidations,evictions,bakes,hits,rebakes,levels:{quarter:[...cache.values()].filter(e=>(e.scale??1)>1).length,final:[...cache.values()].filter(e=>(e.scale??1)===1).length,quarterBytes:[...cache.values()].filter(e=>(e.scale??1)>1).reduce((n,e)=>n+e.bytes,0)},canonicalChunkSize:canonicalSize,displayChunkSize:viewChunkSize(),field:fields,renderer:render,strokeMilliseconds:strokeTimes.slice(),frameMilliseconds:frameTimes.slice()};
  }
  function remove(key) { const e=cache.get(key);if(!e)return;e.bitmap.close?.();cacheBytes-=e.bytes;cache.delete(key);evictions++; }
  // H6b: a bake from the GPU buffers records how many changes had been announced when it took them; it is still good if none announced since touched
  // its input (an edit elsewhere on the map, or a later move of the same stroke over other chunks, does not throw it away).
  let changeSeq=0;const changeLog=[];
  function changedSince(seq,input){return changeLog.length>=256&&changeLog[0].seq>seq+1||changeLog.some(c=>c.seq>seq&&(!c.rect||intersects(c.rect,input)));}
  function cancelBake(){activeBake?.controller.abort();}
  function clear(rect=null,{refinement=false}={}) {
    cancelBake();if(!refinement)previewFields.invalidate(rect);
    epoch++;changeLog.push({seq:++changeSeq,rect});if(changeLog.length>256)changeLog.shift();
    for(const e of cache.values())if(!(refinement&&(e.fit||e.weathered===false))&&(!rect||intersects(rect,e.input??e))){
      if(!e.dirty)dirtyMarks++;e.dirty=true;retainedInvalidations++;
    }
    coarseColour=true;features?.groundChanged?.(rect);schedule();
  }
  function trimTo(limit){limit=Math.max(0,limit);const v=state();for(const[key,e]of cache)if(cacheBytes>limit&&!intersects(e,v))remove(key);while(cacheBytes>limit&&cache.size)remove(cache.keys().next().value);}
  function configureChunks() {
    if(budgetUpdating)return;budgetUpdating=true;
    try {
      // Every selected budget uses the same bake lattice. Budget changes evict
      // images, rather than change GPU interpolation and palette decisions.
      const reserve=fixedGPU(false)-(previewReserved?64*MB:0)+512*512*8;   // the bake lattice does not depend on what the GPU fields hold
      finest=.25;renderer.setBudget(128*MB,reserve);const next=Math.min(512,renderer.recommendedChunkSize);
      if(next!==canonicalSize){for(const key of cache.keys())remove(key);canonicalSize=next;}
      trimTo(gpuBudget-fixedGPU()-renderer.stats().retainedBytes-32*MB);
      renderer.setBudget(gpuBudget,fixedGPU()+cacheBytes+canonicalSize*canonicalSize*8);
    }finally{budgetUpdating=false;}
  }
  async function region(request,options,signal,weather=true) {
    const required=renderer.requiredRegion(request,options),read=!weather&&api.readAuthored?api.readAuthored:api.readAsync??api.read;let r=await read(required,signal);signal?.throwIfAborted();
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
  // Smaller display tiles make completed detail visible sooner. Export keeps
  // its canonical chunk size and the renderer keeps the global field lattice.
  function viewChunkSize() { return Math.min(256,canonicalSize); }
  // Let optional whole-map work yield until the camera has its requested
  // images. A failed/paused render must not starve background work forever.
  function foregroundPending() {
    if(busy)return false;
    if(navigating())return true;
    if(!drawing&&!pending)return false;
    const v=state(),size=overview?256*displayLevel():viewChunkSize(),level=overview?displayLevel():levels&&interacting()&&api.gpuFeedActive?.()?2:detailLevel();
    for(let y=Math.max(0,Math.floor(v.y/size))*size;y<Math.min(map.height,v.y+v.height);y+=size)for(let x=Math.max(0,Math.floor(v.x/size))*size;x<Math.min(map.width,v.x+v.width);x+=size){
      const e=cache.get(cacheKey({x,y},size));if(!e||e.dirty||(level<2?offLevel(e,level):(e.scale??1)>level))return true;
    }
    return false;
  }
  // H7b: `scale` 2 bakes a quarter image (half the width and height, drawn at 2x); only the GPU-fed path takes it, and export never asks.
  async function bake(rect,exportArt=false,signal,stale=null,scale=1,fit=false,authoredPreview=false) {
    // Wait before preparing fields, too: a queued tile must not start a costly
    // paged replay for a viewport that has moved while the GPU was occupied.
    await renderer.previousChunk;
    signal?.throwIfAborted();
    if(stale?.())throw new DOMException('The view changed under a queued bake.','AbortError');
    const readWeather=exportArt||weatheredView&&!authoredPreview;
    const options=drawOptions?.()??api.drawOptions?.()??{},request={...rect,exportArt,worldSize:config.worldSize??config.size,worldGrid:fit?512:(config.worldGrid??config.grid)};
    // H6b: with the GPU fields on, the chunk's textures are made from the fields' buffers; no CPU read, no upload, no height patch kept.
    const feed=fit?await previewFields.feed():await api.gpuFeedSource?.(signal,() => renderer.requiredRegion(request,options),{weather:readWeather});   // H5b: a paged map prepares the pages under the chunk's lattice
    if(feed)try{
      signal?.throwIfAborted();
      if(stale?.())throw new DOMException('The scene changed under a queued bake.','AbortError');
      const required=renderer.requiredRegion(request,options),estimate=renderer.estimate(required,rect.width,rect.height,feed.maskCount,scale),ow=Math.ceil(rect.width/scale),oh=Math.ceil(rect.height/scale),copyBytes=ow*oh*8,room=gpuBudget-steadyGPU()-estimate.retainedBytes-estimate.workingBytes-copyBytes;
      // A level whose view does not fit beside the bake would have each tile evict the last, and every repaint would bake them all again.
      if(scale<1&&room<detailBytes(scale))throw new Error(`nanolathe: a view at level ${scale} needs more of GPU memory than the budget leaves`);
      trimTo(room);
      renderer.setBudget(gpuBudget,steadyGPU()+cacheBytes+copyBytes);signal?.throwIfAborted();
      const seq=changeSeq,result=await renderer.renderChunk(request,{...options,quality:'full',feed,scale,deferCompletion:!fit&&!exportArt});bakes++;
      const bitmap=await createImageBitmap(result.canvas,0,0,ow,oh,{colorSpaceConversion:'none'}),entry={...rect,bitmap,bytes:ow*oh*4,scale,fit,weathered:readWeather,fed:true,seq,input:{x:required.gridOrigin[0],y:required.gridOrigin[1],width:(required.gridWidth-1)*required.gridSpacing,height:(required.gridHeight-1)*required.gridSpacing},heightPatch:null};
      const key=rect.x+','+rect.y+','+canonicalSize+','+scale;if(bakedBefore.has(key))rebakes++;bakedBefore.add(key);metrics();return entry;
    }finally{feed.release?.();}
    const fields=await region(request,options,signal,readWeather);
    // H7 2b: the scene changed while this bake waited for its fields; its image would be dropped, so it never reaches the GPU.
    if(stale?.())throw new DOMException('The scene changed under a queued bake.','AbortError');
    const required=renderer.requiredRegion(request,options),estimate=renderer.estimate({...required,gridWidth:fields.gridWidth,gridHeight:fields.gridHeight},rect.width,rect.height,fields.maskPlanes?.length??api.maskKeys.length);
    checkHeap(fields,estimate.cpuPeakBytes);
    const copyBytes=rect.width*rect.height*8;trimTo(gpuBudget-steadyGPU()-estimate.retainedBytes-estimate.workingBytes-copyBytes);
    renderer.setBudget(gpuBudget,steadyGPU()+cacheBytes+copyBytes);signal?.throwIfAborted();
    const result=await renderer.renderChunk(fields,{...options,quality:'full',deferCompletion:!exportArt});bakes++;
    const bitmap=await createImageBitmap(result.canvas,0,0,rect.width,rect.height,{colorSpaceConversion:'none'}),entry={...rect,bitmap,bytes:rect.width*rect.height*4,weathered:readWeather,input:{x:fields.gridOrigin[0],y:fields.gridOrigin[1],width:(fields.gridWidth-1)*fields.gridSpacing,height:(fields.gridHeight-1)*fields.gridSpacing},heightPatch:keepHeight(fields)};
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
  function drawCoarse(terrain=true) {
    // Sample in slices, but never during a gesture: the overview is stale under the edit and refreshes on release.
    if(!gesture&&!navigating()&&coarseFirst.length+coarseRest.length&&stepCoarse(3))schedule();
    if(coarseColour) {
      const image=cg.createImageData(coarse.width,coarse.height),base=config.baseHeight,sea=config.seaLevel,mean=renderer.means?.ground||[.2,.3,.15];
      for(let y=0;y<coarse.height;y++)for(let x=0;x<coarse.width;x++) {
        const i0=y*coarse.width+x,h=coarseH[i0],i=i0*4,wet=h<sea,shade=clamp(.8+(h-base)*.005,.3,1.5),water=config.water?.shallowRGB||[42,87,130];
        for (let c=0;c<3;c++) image.data[i+c]=wet?water[c]:mean[c]*255*shade; image.data[i+3]=255;
      }
      cg.putImageData(image,0,0);coarseColour=false;
    }
    const v=state(); if(terrain){g.imageSmoothingEnabled=false;g.drawImage(coarse,v.x/map.width*coarse.width,v.y/map.height*coarse.height,v.width/map.width*coarse.width,v.height/map.height*coarse.height,0,0,canvas.width,canvas.height);}
    ng.imageSmoothingEnabled=false; ng.drawImage(coarse,0,0,navigatorCanvas.width,navigatorCanvas.height); ng.strokeStyle='#fff0a0'; ng.lineWidth=1; ng.strokeRect(v.x/map.width*200+.5,v.y/map.height*200+.5,Math.min(200,v.width/map.width*200),Math.min(200,v.height/map.height*200));
  }
  function overlays() {
    const v=state(); ink.setTransform(1,0,0,1,0,0); ink.clearRect(0,0,overlay.width,overlay.height); ink.save(); ink.scale(scale,scale); ink.translate(-v.x,-v.y);
    passability?.draw(ink,v,scale);
    // Map-coordinate height cells; this guide is only an overlay, never art.
    if($('tile-grid').checked){
      const step=scale>=.5?16:128,x0=Math.max(0,Math.floor(v.x/step)*step),x1=Math.min(map.width,v.x+v.width),y0=Math.max(0,Math.floor(v.y/step)*step),y1=Math.min(map.height,v.y+v.height);
      ink.lineWidth=1/scale;
      for(let x=x0;x<=x1;x+=step){ink.strokeStyle=x%128===0?'#d4ebd45c':'#c1dfcd24';ink.beginPath();ink.moveTo(x,y0);ink.lineTo(x,y1);ink.stroke();}
      for(let y=y0;y<=y1;y+=step){ink.strokeStyle=y%128===0?'#d4ebd45c':'#c1dfcd24';ink.beginPath();ink.moveTo(x0,y);ink.lineTo(x1,y);ink.stroke();}
    }
    drawMapBounds(ink,map,config,navigating()?coarseSample:api.sampleAuthored??sourceSample); features?.draw(ink,v);
    if(!navigating()&&api.currentTool()==='move'&&!features?.active){
      if(hoveredNode>=0&&hoveredNode!==api.selection())drawSelection(ink,geometry(hoveredNode),{label:api.selectionLabel(hoveredNode),hover:true});
      drawSelection(ink,geometry(api.selection()),{label:api.selectionLabel(api.selection()),pathMode:api.pathEditing?.()||api.drawMode?.()==='add',point:api.pathSelection?.(),activePath:api.pathIndex?.()});
      // H27: a landform's section picked on its along-the-path canvas, marked across the path.
      const mark=api.sectionMark?.();if(mark){const a=project(mark.a),b=project(mark.b);ink.save();ink.strokeStyle='#ffd27a';ink.lineWidth=2.5/scale;ink.beginPath();ink.moveTo(a.x,a.y);ink.lineTo(b.x,b.y);ink.stroke();ink.restore();}
    }
    if (!navigating() && hover && !features?.active && (api.currentTool()!=='move'||api.drawMode?.()==='add')) { ink.strokeStyle='#b8eef3'; ink.lineWidth=1/scale; ink.beginPath(); ink.arc(hover[0],hover[1]-(Math.max(config.seaLevel,visibleSample(...hover))-config.baseHeight)/2,Number($('diameter').value)/2,0,Math.PI*2); ink.stroke(); }
    // H7b: ?levelsOverlay=1 marks each shown chunk with its level: orange Q for a quarter image, green F for a final one.
    if(levelsOverlay)for(const e of cache.values())if(intersects(e,v)){const q=(e.scale??1)>1;ink.strokeStyle=q?'#ff9a3c':'#7dff7d';ink.lineWidth=2/scale;ink.strokeRect(e.x+1/scale,e.y+1/scale,e.width-2/scale,e.height-2/scale);ink.fillStyle=ink.strokeStyle;ink.font=`${16/scale}px monospace`;ink.fillText(q?'Q':'F',e.x+8/scale,e.y+20/scale);}
    ink.restore();
  }
  function coarseSample(x,y) { return coarseH[Math.round(clamp(y/(map.height-1),0,1)*(CH-1))*CW+Math.round(clamp(x/(map.width-1),0,1)*(CW-1))]; }
  // A tile's edges snap to whole canvas pixels. At a fractional offset (a fractional scroll on a 2x screen, or a zoom that is not
  // a whole number) two neighboring tiles each cover only part of their shared pixel, and the coarse picture underneath showed
  // through as a 1 px line. Neighbors round the same edge the same way, so they meet exactly.
  function paint(entry,v=state()) { const k=entry.scale??1,x0=Math.round((entry.x-v.x)*scale),y0=Math.round((entry.y-v.y)*scale),x1=Math.round((entry.x+entry.bitmap.width*k-v.x)*scale),y1=Math.round((entry.y+entry.bitmap.height*k-v.y)*scale);g.imageSmoothingEnabled=scale<1||k*scale<1;g.imageSmoothingQuality='high';g.drawImage(entry.bitmap,x0,y0,x1-x0,y1-y0); }
  function presentView() {
    const repaint=paintedView!==viewEpoch||cache.size===0;
    drawCoarse(repaint);
    if(repaint){
      const v=state(),size=overview?256*displayLevel():viewChunkSize();
      // Fit images are useful at every zoom. Keep them underneath close-view
      // tiles so newly exposed terrain has a picture without another GPU job.
      if(!overview)for(const e of [...cache.values()].filter(e=>e.fit&&intersects(e,v)).sort((a,b)=>b.scale-a.scale))paint(e,v);
      for(const [key,e] of cache)if(key===cacheKey(e,size)&&intersects(e,v))paint(e,v);
      paintedView=viewEpoch;presented(false);
    }
    overlays();
  }
  function presented(fresh=true) {
    const now=performance.now();if(lastPresented&&now-lastScroll<300&&now-lastPresented<3000){frameTimes.push(now-lastPresented);if(frameTimes.length>1024)frameTimes.shift();}lastPresented=now;
    if(fresh&&pendingStrokeTime){strokeTimes.push(now-pendingStrokeTime);if(strokeTimes.length>256)strokeTimes.shift();pendingStrokeTime=0;}
  }
  async function frame() {
    pending=false;let rendering=false;const renderStart=performance.now();
    try {
      // Presentation never waits for terrain generation. This path only copies
      // retained images while a chunk's fields, GPU work or snapshot are pending.
      if(drawing){if(paintedView!==viewEpoch)presentView();else if(passability?.active)overlays();rerun=true;return;}
      presentView();
      drawing=rendering=true;
      const key=JSON.stringify(drawOptions?.()??api.drawOptions?.()??{});if(optionsKey&&optionsKey!==key)clear();optionsKey=key;
      // H7 2b: while the Time pass is running, a bake would read the unweathered height and be redone when the weather lands.
      // The pass is submitted first (it starts with the edit) and chunks wait for it, for at most 8 s so a failed pass cannot hide the map.
      const weatherPending=weatheredView&&api.canExport&&!api.canExport()&&!interacting()&&!features?.busy;
      if(weatherPending){heldSince??=performance.now();}else heldSince=null;
      const holding=weatherPending&&performance.now()-heldSince<8000;
      if(holding)setTimeout(schedule,100);
      if(!busy){
        if(overview&&!previewReserved){previewReserved=true;api.fitGpuBudget?.();}
        const size=overview?256*displayLevel():viewChunkSize(),v=state(),jobs=[],token=epoch,viewToken=viewEpoch,previewing=interacting();
        for(let y=Math.max(0,Math.floor(v.y/size)-1)*size;y<Math.min(map.height,v.y+v.height+size);y+=size)for(let x=Math.max(0,Math.floor(v.x/size)-1)*size;x<Math.min(map.width,v.x+v.width+size);x+=size)jobs.push({x,y,width:Math.min(size,map.width-x),height:Math.min(size,map.height-y)});
        const dist=r=>Math.hypot(r.x+size/2-v.x-v.width/2,r.y+size/2-v.y-v.height/2);
        // H7b: with levels on, the visible chunks come before the margin, each group nearest the view's centre first (oldest first during a gesture).
        const levelsOn=levels&&api.gpuFeedActive?.();
        jobs.sort((a,b)=>{const visible=intersects(b,v)-intersects(a,v);if(visible)return visible;if(previewing){const age=(cache.get(cacheKey(a,size))?.bakedAt||0)-(cache.get(cacheKey(b,size))?.bakedAt||0);if(age)return age;}return dist(a)-dist(b);});
        // During a canvas gesture the plan's head takes turns: the stale visible chunk nearest the pointer (the brush's own feedback), then the
        // oldest stale one, which keeps every dirty chunk moving while pointer events cut each plan short (repro/interaction/REPORT.md item 6):
        // with D dirty visible chunks, each one is baked within 2(D-1) bakes, the pointer's within 2. A turn passes once its head's image is
        // kept; a plan that runs out of work, and each new gesture, start on the pointer's turn.
        if(!previewing)pointerTurn=true;
        let pointerHead=false,headBaked=false;
        if(previewing&&gesture&&pointerTurn&&hover){
          const gap=r=>Math.hypot(Math.max(0,r.x-hover[0],hover[0]-r.x-r.width),Math.max(0,r.y-hover[1],hover[1]-r.y-r.height));
          let best=-1;for(let i=0;i<jobs.length;i++){const r=jobs[i],e=cache.get(cacheKey(r,size));if(intersects(r,v)&&(!e||e.dirty)&&(best<0||gap(r)<gap(jobs[best])))best=i;}
          if(best>=0){jobs.unshift(...jobs.splice(best,1));pointerHead=true;}
        }
        const near={x:v.x-size,y:v.y-size,width:v.width+size*2,height:v.height+size*2};for(const e of cache.values())if(!intersects(e,near))e.heightPatch=null;
        // H7b: the plan. `want` 2 is a quarter image, 1 final. During a gesture every chunk without an image gets a quarter one and nothing
        // is refined; once it ends, a quarter image is replaced by a final one (visible chunks first, then the margin), and a chunk
        // whose final image is still current keeps it. Dirty images remain visible until a replacement arrives.
        const plan=[];
        if(overview)for(const rect of jobs)plan.push({rect,want:displayLevel()});
        else if(!levelsOn)for(const rect of jobs)plan.push({rect,want:1});
        else{
          if(interacting())for(const rect of jobs)plan.push({rect,want:2});
          else{
            // Cold visible tiles get local detail from authored fields first.
            // Weather can take seconds; cover the camera before waiting on it.
            // Retained detail (even if dirty) already provides that coverage.
            if(weatheredView)for(const rect of jobs)if(intersects(rect,v)&&!cache.has(cacheKey(rect,size)))plan.push({rect,want:2,authoredPreview:true});
            for(const rect of jobs)plan.push({rect,want:detailLevel()});
          }
        }
        for(const {rect,want,authoredPreview=false} of plan){
          if(token!==epoch||viewToken!==viewEpoch||busy||previewing!==interacting()){rerun=true;break;}
          if((previewing||navigating()||want<1)&&!intersects(rect,v))continue;   // a detail level bakes only what is seen: its ring would evict itself
          const key=cacheKey(rect,size);let e=cache.get(key);let baked=false;
          if(want===2&&e&&!e.dirty)continue;   // current detailed images also satisfy a preview request
          const upgrade=want<=1&&e&&(offLevel(e,want)||!overview&&e.weathered!==weatheredView);
          if((!e||e.dirty||upgrade)&&holding&&!overview&&!authoredPreview)continue;
          if(!e||e.dirty||upgrade){
            const controller=new AbortController();activeBake={controller,rect};
            // Scrolling changes the plan, but a tile still in view remains
            // useful. Keep it running instead of restarting on every input.
            try{e=await bake(rect,false,controller.signal,()=>token!==epoch||busy||viewToken!==viewEpoch&&!intersects(rect,state()),want,overview,authoredPreview);}
            catch(err){if(want<1&&String(err.message).includes('of GPU memory')){finest=want*2;rerun=true;break;}throw err;}   // fall back to the next coarser level, never the banner
            finally{if(activeBake?.controller===controller)activeBake=null;}
            baked=true;if(token!==epoch){
            // Keep a completed preview even if a newer input touched it. It remains dirty until the latest revision is baked.
            if(e.fed&&changedSince(e.seq,e.input))e.dirty=true;
            if(!e.fed){e.bitmap.close?.();break;}
          }
          // The image it replaces (a quarter one) is dropped now that the final one is in hand.
          const prior=cache.get(key);if(prior){prior.bitmap.close?.();cacheBytes-=prior.bytes;cache.delete(key);}
          e.bakedAt=performance.now();cache.set(key,e);cacheBytes+=e.bytes;if(previewing&&!headBaked){headBaked=true;pointerTurn=!pointerHead;}}
          else{hits++;cache.delete(key);cache.set(key,e);if(!e.heightPatch&&!e.fed){const input=await region({...rect,worldSize:config.worldSize??config.size,worldGrid:config.worldGrid??config.grid},drawOptions?.()??api.drawOptions?.()??{},undefined,weatheredView);checkHeap(input);e.heightPatch=keepHeight(input);}}
          if(cache.get(key)!==e)break;
          if(!baked)continue;   // The retained tiles were painted together above; only fresh tiles need another presentation.
          const current=state(),currentSize=overview?256*displayLevel():viewChunkSize();
          if(key===cacheKey(rect,currentSize)&&intersects(rect,current)){
            // A completed tile belongs at the latest camera coordinates, even
            // when input moved the view while its fields or image were pending.
            if(paintedView!==viewEpoch)presentView();else{paint(e,current);overlays();}
            presented();
          }
          if(token!==epoch||viewToken!==viewEpoch){rerun=true;break;}
          // Close-view snapshots overlap GPU work, so explicitly yield to input.
          // Fit keeps its GPU completion wait: its larger tiles need backpressure
          // before presentation to keep the full-map gesture responsive.
          await (!overview||!levels?tick():undefined);
        }
        if(!rerun&&token===epoch)pointerTurn=true;   // nothing newer arrived while this plan ran: the next move starts on the pointer's turn
        // Generated deposits and vents sit where the export puts them and take their colors from the export art under them
        // (sculpt-features.js): one anchor read or one 128 px patch per idle frame, after the view's own images and only once the
        // weather the export reads is in.
        if(!rerun&&token===epoch&&viewToken===viewEpoch&&!previewing&&!navigating()&&!holding&&(!api.canExport||api.canExport())&&await features?.fitGround?.(state()))rerun=true;
      }
      const m=metrics();$('timing').textContent=`Render ${Math.round(performance.now()-renderStart)} ms · ${(m.gpuBytes/MB).toFixed(0)} MiB`;$('timing').title='Wall time for the latest viewport render, including any chunk bakes. '+bakes+' bakes · '+evictions+' cache evictions';
    }catch(err){if(err.name==='AbortError')rerun=true;else{console.error(err);$('error').hidden=false;$('error').textContent=err.message;}}
    finally{if(rendering){drawing=false;if(rerun){rerun=false;schedule();}}}
  }
  // H7b: during a gesture a change is answered at once, not at the next animation frame (a pointer move is already one event a frame): the bake of
  // the change's chunks starts as soon as the one in flight ends, and nothing waits for a frame between them.
  function schedule() { if (!pending) { pending=true; if(levels&&interacting()&&!drawing)queueMicrotask(frame);else requestAnimationFrame(frame); } }
  function resize() {
    if(busy){resizePending=true;return;}resizePending=false;
    cancelBake();
    const centre=state();centre.x+=centre.width/2;centre.y+=centre.height/2;
    if (overview) scale=Math.min((viewport.clientWidth-28)/map.width,(viewport.clientHeight-28)/map.height);
    stage.style.width=map.width*scale+'px'; stage.style.height=map.height*scale+'px'; stage.style.margin=overview?'auto':'0'; stage.style.overflow='visible';
    const width=Math.max(1,Math.min(viewport.clientWidth,Math.ceil(map.width*scale))),height=Math.max(1,Math.min(viewport.clientHeight,Math.ceil(map.height*scale)));
    for (const c of [canvas,overlay]) { c.width=width; c.height=height; c.style.width=width+'px'; c.style.height=height+'px'; c.style.inset='auto'; }
    if(!overview){viewport.scrollLeft=centre.x*scale-canvas.width/2;viewport.scrollTop=centre.y*scale-canvas.height/2;}
    position();viewEpoch++;if(renderer&&!renderer.busy)configureChunks();schedule();
  }
  function position() { for (const c of [canvas,overlay]) { c.style.left=viewport.scrollLeft+'px'; c.style.top=viewport.scrollTop+'px'; }api.setViewFocus?.(state()); }
  function navigationChanged() {
    if(activeBake&&!intersects(activeBake.rect,state()))cancelBake();
    position();viewEpoch++;lastScroll=performance.now();schedule();
    clearTimeout(navigationTimer);
    navigationTimer=setTimeout(()=>{navigationTimer=null;schedule();},navigationDelay);
  }
  function zoom(next) {
    $('fit').setAttribute('aria-pressed',String(next==='overview'));$('one').setAttribute('aria-pressed',String(next===1));$('zoom').value=String(next);
    const v=state(),cx=v.x+v.width/2,cy=v.y+v.height/2;overview=next==='overview';if(!overview)scale=clamp(Number(next)||1,.1,4);
    resize();viewport.scrollLeft=Math.max(0,cx*scale-canvas.width/2);viewport.scrollTop=Math.max(0,cy*scale-canvas.height/2);position();schedule();
  }
  $('fit').onclick=()=>zoom('overview');$('one').onclick=()=>zoom(1);$('zoom').onchange=e=>zoom(e.target.value==='overview'?'overview':Number(e.target.value));
  $('tile-grid').onchange=()=>schedule();
  $('weathered-view').onchange=()=>{
    weatheredView=$('weathered-view').checked;
    try{localStorage.setItem('terraform-weathered-view',String(weatheredView));}catch{}
    cancelBake();viewEpoch++;schedule();
  };
  viewport.addEventListener('scroll',navigationChanged,{passive:true}); new ResizeObserver(resize).observe(viewport);
  function screen(event) { const r=overlay.getBoundingClientRect(),v=state(); return {x:v.x+(event.clientX-r.left)/scale,z:v.y+(event.clientY-r.top)/scale}; }
  function pick(cx,cy) {
    const v=state(),x=clamp(v.x+cx/scale,0,map.width-1),sy=v.y+cy/scale;
    let previousY=sy+170,previous=previousY-(Math.max(config.seaLevel,visibleSample(x,previousY))-config.baseHeight)/2-sy;
    for (let y=previousY-2;y>=sy-80;y-=2) { const value=y-(Math.max(config.seaLevel,visibleSample(x,y))-config.baseHeight)/2-sy; if (value<=0 && previous>=0) return [x,clamp(previousY-2*previous/Math.max(1e-6,previous-value),0,map.height-1)]; previous=value; previousY=y; }
    return [x,clamp(sy,0,map.height-1)];
  }
  function pickWorld(p) { const v=state(); return pick((p.x-v.x)*scale,(p.z-v.y)*scale); }
  let navigationPointer=null;
  function navigate(event){const r=navigatorCanvas.getBoundingClientRect();if(overview)zoom(1);viewport.scrollLeft=clamp((event.clientX-r.left)/r.width,0,1)*map.width*scale-canvas.width/2;viewport.scrollTop=clamp((event.clientY-r.top)/r.height,0,1)*map.height*scale-canvas.height/2;navigationChanged();}
  navigatorCanvas.onpointerdown=event=>{if(event.button!==0||busy||gesture||features?.busy)return;event.preventDefault();navigationPointer=event.pointerId;navigatorCanvas.setPointerCapture(event.pointerId);navigate(event);};
  navigatorCanvas.onpointermove=event=>{if(navigationPointer===event.pointerId)navigate(event);};
  const endNavigation=event=>{if(navigationPointer!==event.pointerId)return;navigationPointer=null;if(navigatorCanvas.hasPointerCapture(event.pointerId))navigatorCanvas.releasePointerCapture(event.pointerId);navigationChanged();};
  for(const name of ['pointerup','pointercancel','lostpointercapture'])navigatorCanvas.addEventListener(name,endNavigation);
  navigatorCanvas.onkeydown=event=>{const d={ArrowLeft:[-1,0],ArrowRight:[1,0],ArrowUp:[0,-1],ArrowDown:[0,1]}[event.key];if(!d||busy||gesture||features?.busy)return;event.preventDefault();event.stopPropagation();if(overview)zoom(1);viewport.scrollLeft+=d[0]*canvas.width*.2;viewport.scrollTop+=d[1]*canvas.height*.2;navigationChanged();};
  function localPoint(event){const p=screen(event),q=pickWorld(p);return {x:q[0],y:q[1]};}
  function nodeMetadata(index){return api.nodeMetadata?api.nodeMetadata(index):api.graph()[index];}
  const project=p=>({x:p.x,y:p.y-(Math.max(config.seaLevel,visibleSample(p.x,p.y))-config.baseHeight)/2});
  function geometry(index){return selectionGeometry(nodeMetadata(index),project,state());}
  function refreshHover(event){
    if(gesture||pan||busy||features?.active||api.currentTool()!=='move'||api.drawMode?.()==='add'||api.pathAdding?.()){hoveredNode=-1;overlay.style.cursor=pan?'grabbing':'crosshair';return;}
    const q=screen(event),hit=hitSelection(geometry(api.selection()),{x:q.x,y:q.z},api.pathEditing?.());
    const feature=!hit&&!api.pathEditing?.()&&features?.hitAt?.(q);
    hoveredNode=feature?-1:api.pickAt(localPoint(event));
    if(feature){overlay.style.cursor='move';return;}
    overlay.style.cursor=hit?.action==='rotate'?'grab':hit?.action==='scale'?'nwse-resize':hit?.action==='point'?'crosshair':hoveredNode>=0||hit?'move':'default';
  }
  overlay.addEventListener('pointerdown',event=>{
    if(![0,1].includes(event.button)||busy||gesture||pan||api.gestureActive?.()||!api.ready())return;event.preventDefault();overlay.focus({preventScroll:true});overlay.setPointerCapture(event.pointerId);
    if(space||event.button===1){pan={id:event.pointerId,x:event.clientX,y:event.clientY,left:viewport.scrollLeft,top:viewport.scrollTop};return;}
    if(features?.active)return;
    const p=localPoint(event),start=performance.now();hover=[p.x,p.y];
    // Select (V) picks a generated feature before a shape, unless a selected shape's handle is under the pointer (sculpt-features.js).
    if(api.currentTool()==='move'&&api.drawMode?.()!=='add'&&!api.pathEditing?.()&&!api.pathAdding?.()){const q=screen(event);if(!hitSelection(geometry(api.selection()),{x:q.x,y:q.z})&&features?.pointerSelect(event,q)){schedule();return;}}
    if(api.pathAdding?.()){api.addPathPoint(p);schedule();return;}
    if(api.currentTool()==='move'&&api.drawMode?.()!=='add'){
      const screenPoint=screen(event),selected=api.selection(),handles=geometry(selected);
      const hit=hitSelection(handles,{x:screenPoint.x,y:screenPoint.z},api.pathEditing?.());
      const index=hit?selected:api.selectAt(p);if(index<0)return;
      const pointIndex=hit?.action==='point'?hit.index:-1;api.selectPathPoint?.(pointIndex);
      // In path mode empty ground selects; only a point can start a drag.
      if(api.pathEditing?.()&&pointIndex<0)return;
      const h=geometry(index);if(api.beginMove(index)===false)return;
      gesture={id:event.pointerId,clientX:event.clientX,clientY:event.clientY,type:'move',index,start,p,screen:screenPoint,handles:h,amount:nodeMetadata(index)?.params?.amount??0,pointIndex,point:pointIndex>=0?{...nodeMetadata(index).points[pointIndex]}:null,action:hit?.action==='rotate'||hit?.action==='scale'||pointIndex>=0?hit.action:event.shiftKey?'amount':'move'};
    }else{
      const q=screen(event),hit=api.drawMode?.()==='add'?hitSelection(geometry(api.selection()),{x:q.x,y:q.z},true):null;
      const anchor=hit?.action==='point'?hit.index:-1,startPoint=anchor>=0?nodeMetadata(api.selection()).points[anchor]:p;
      api.beginStroke(api.drawingKind?.()||api.currentTool(),startPoint,api.strokeOptions(),anchor);
      gesture={id:event.pointerId,clientX:event.clientX,clientY:event.clientY,type:'stroke',points:[startPoint],start};
    }
    pendingStrokeTime=start;metadata?.update?.();schedule();
  });
  function preview(event,final=false){
    hover=pickWorld(screen(event));
    // A stationary release must not pick the newly raised surface again.
    if(gesture?.id!==event.pointerId||gesture.clientX===event.clientX&&gesture.clientY===event.clientY)return;
    if(gesture.type==='stroke'&&Math.hypot(hover[0]-gesture.points.at(-1).x,hover[1]-gesture.points.at(-1).y)>(final?0:3)){gesture.clientX=event.clientX;gesture.clientY=event.clientY;gesture.points.push({x:hover[0],y:hover[1]});pendingStrokeTime=performance.now();api.previewStroke(gesture.points);}
    else if(gesture.type==='move'){
      gesture.clientX=event.clientX;gesture.clientY=event.clientY;const q=screen(event),h=gesture.handles,c=h.pivot,around=(a,b,c1,d)=>[a,b,c1,d,c.x-a*c.x-c1*c.y,c.y-b*c.x-d*c.y];let edit;
      if(gesture.action==='point'){let dx=q.x-gesture.screen.x,dy=q.z-gesture.screen.z;if(event.shiftKey){if(Math.abs(dx)>Math.abs(dy))dy=0;else dx=0;}edit={point:{index:gesture.pointIndex,x:gesture.point.x+dx,y:gesture.point.y+dy}};}
      else if(gesture.action==='rotate'){let angle=Math.atan2(q.z-h.centre.y,q.x-h.centre.x)-Math.atan2(gesture.screen.z-h.centre.y,gesture.screen.x-h.centre.x);if(event.shiftKey)angle=Math.round(angle/(Math.PI/12))*Math.PI/12;edit={matrix:around(Math.cos(angle),Math.sin(angle),-Math.sin(angle),Math.cos(angle))};}
      else if(gesture.action==='scale'){let k=clamp(Math.hypot(q.x-h.centre.x,q.z-h.centre.y)/Math.max(1,Math.hypot(gesture.screen.x-h.centre.x,gesture.screen.z-h.centre.y)),.2,4);if(event.shiftKey)k=Math.round(k*10)/10;edit={matrix:around(k,0,0,k)};}
      else if(gesture.action==='amount')edit={amount:gesture.amount+(gesture.screen.z-q.z)*1.5};
      else edit={dx:q.x-gesture.screen.x,dy:q.z-gesture.screen.z};pendingStrokeTime=performance.now();api.previewMove(edit);
    }
  }
  overlay.addEventListener('pointermove',event=>{
    if(pan?.id===event.pointerId){viewport.scrollLeft=pan.left-event.clientX+pan.x;viewport.scrollTop=pan.top-event.clientY+pan.y;navigationChanged();return;}
    if(navigating()&&!gesture)return;
    preview(event);refreshHover(event);if(passability?.active){const p=pickWorld(screen(event));passability.inspect(...p);}if(gesture?.id===event.pointerId)schedule();overlays();
  });
  overlay.addEventListener('pointerleave',()=>{hoveredNode=-1;hover=null;overlays();});
  const end=event=>{if(pan?.id===event.pointerId){pan=null;navigationChanged();}if(gesture?.id===event.pointerId){const commit=event.type==='pointerup';if(commit)preview(event,true);const s=gesture;gesture=null;if(s.type==='move')api.endMove(commit);else api.endStroke(commit);if(commit)pendingStrokeTime=performance.now();}if(overlay.hasPointerCapture(event.pointerId))overlay.releasePointerCapture(event.pointerId);schedule();};
  for(const name of ['pointerup','pointercancel','lostpointercapture'])overlay.addEventListener(name,end);
  document.addEventListener('keydown',event=>{if(event.code==='Space'&&!['INPUT','TEXTAREA','SELECT'].includes(event.target.tagName)){space=true;event.preventDefault();}if(event.key==='Escape'&&gesture){event.preventDefault();end({pointerId:gesture.id,type:'pointercancel'});}});document.addEventListener('keyup',event=>{if(event.code==='Space')space=false;});
  window.addEventListener('blur',()=>{space=false;pan=null;navigationPointer=null;if(gesture)end({pointerId:gesture.id,type:'pointercancel'});schedule();});
  function budgets(){gpuBudget=clamp(Number(find('[data-gpu]').value)||512,128,4096)*MB;heapBudget=clamp(Number(find('[data-heap]').value)||1024,128,8192)*MB;api.setBudget?.(heapBudget*.65);api.fitGpuBudget?.();configureChunks();metrics();schedule();}
  find('[data-gpu]').onchange=budgets;find('[data-heap]').onchange=budgets;
  async function idle(){do{while(drawing||pending||renderer.busy||navigationTimer||navigating())await tick();await renderer.previousChunk;}while(drawing||pending||renderer.busy||navigationTimer||navigating());}
  // Each corner is sampled from an awaited canonical weather field (sculpt-map.js cellHeights). No uncached preview height may enter the TNT
  // while lazy tiles are refining.
  async function sampleHeights(signal){
    await idle();
    return cellHeights(map,async req=>{const r=await(api.readAsync?api.readAsync(req,signal):api.read(req));checkHeap(r);return r;},{signal,step:async()=>{metrics();await tick();}});
  }
  async function* sampleHeightTiles(signal){
    let v=state();
    const priority=t=>{const r={x:t.x*16,y:t.z*16,width:t.width*16,height:t.height*16};return(intersects(r,v)?0:map.width+map.height)+Math.hypot(r.x+r.width/2-v.x-v.width/2,r.y+r.height/2-v.y-v.height/2);};
    // Regional reads await only their own canonical pages. Do not wait for
    // canvas.idle(): useful access colors can precede the remaining art bakes.
    for await(const tile of cellHeightTiles(map,async req=>{const r=await(api.readAsync?api.readAsync(req,signal):api.read(req));checkHeap(r);return r;},{signal,priority})){
      yield tile;metrics();await tick();v=state();
    }
  }
  // paint(context, rect) draws on each chunk of export art before it is encoded: the map's painted deposits and vents.
  async function exportChunks(accept,signal,paint=null){
    await idle();const size=chunkSize(),total=Math.ceil(map.width/size)*Math.ceil(map.height/size);let index=0;
    for(let y=0;y<map.height;y+=size)for(let x=0;x<map.width;x+=size){signal?.throwIfAborted();const rect={x,y,width:Math.min(size,map.width-x),height:Math.min(size,map.height-y)},entry=await bake(rect,true,signal),tile=new OffscreenCanvas(rect.width,rect.height),c=tile.getContext('2d');c.drawImage(entry.bitmap,0,0);entry.bitmap.close?.();paint?.(c,rect);const png=await tile.convertToBlob({type:'image/png'});await accept({...rect,png},index++,total);tile.width=tile.height=1;metrics();}
  }
  // H6b: with the GPU feed the chunks rebake as a change is submitted (they read the GPU buffers); the overview and the save wait until the CPU copy holds it.
  const invalidate=change=>clear(api.expandDirty?.(change?.rect??null)??change?.rect??null);
  api.subscribeSubmit?.(change=>{if(api.gpuFeedActive?.()){pendingStrokeTime ||= performance.now();invalidate(change);}});
  api.subscribe?.(change=>{pendingStrokeTime ||= performance.now();markCoarse(change?.rect??null);if(!api.gpuFeedActive?.())invalidate(change);});
  function setBusy(on){busy=on;api.setBusy(on);$('weathered-view').disabled=on;find('[data-gpu]').disabled=on;find('[data-heap]').disabled=on;if(!on){if(resizePending)resize();else schedule();}}
  // The export's own numbers for one feature: an anchor cell's four corner bytes, sampled as sampleHeights samples them, and a
  // rectangle of export art. Either answers null when the scene changed while it was read.
  async function exportCorners(x,z){
    const seq=changeSeq,r=await(api.readAsync?api.readAsync({x:x*16,y:z*16,width:16,height:16}):api.read({x:x*16,y:z*16,width:16,height:16}));checkHeap(r);
    if(changedSince(seq,{x:x*16-16,y:z*16-16,width:48,height:48}))return null;
    return [[0,0],[1,0],[0,1],[1,1]].map(([dx,dz])=>Math.round(clamp(sampleField(r,(x+dx)*16,(z+dz)*16),0,255)));
  }
  async function bakeArt(rect){
    const seq=changeSeq,e=await bake(rect,true),tile=new OffscreenCanvas(rect.width,rect.height),c=tile.getContext('2d');c.drawImage(e.bitmap,0,0);e.bitmap.close?.();
    return changedSince(seq,e.input)?null:{data:c.getImageData(0,0,rect.width,rect.height).data,input:e.input};
  }
  features=await mountMapFeatures({config,canvas:overlay,exportCorners,bakeArt,screenPoint:screen,pick:(x,z)=>pickWorld({x,z}),sample:visibleSample,change:()=>{api.mapChanged();schedule();},schedule,enabled:()=>api.ready()&&!busy,
    light:()=>renderer.worldSun,lightColors:()=>({sun:renderer.colorOverrides?.sun||null,sky:renderer.colorOverrides?.sky||null,ambient:renderer.variant?.has('ambient')?Number(renderer.variant.get('ambient')):.42}),groundColor:()=>renderer.means?.ground,deselectShapes:()=>{if(api.selection()>=0)api.select?.(-1);}});api.registerFeatures?.(features);
  metadata=mountMapExport({config,canvas,stream:{sampleHeights,exportChunks,bakeArt},ready:()=>api.ready()&&(!api.canExport||api.canExport())&&!gesture&&!features.busy,revision:()=>api.revision?.()??epoch,mapData:api.mapData,features:()=>features,change:()=>{api.mapChanged();},onUpdate:fn=>api.onUpdate?.(fn),busy:setBusy,restore:schedule});api.registerMetadata?.(metadata);
  passability=mountPassability({config,sampleHeightTiles,revision:()=>api.revision?.()??epoch,ready:()=>api.ready()&&(!api.canExport||api.canExport())&&!interacting()&&!busy&&!features.busy,mapData:api.mapData,schedule,checkMemory:bytes=>api.checkMemory?.(bytes)});
  // H12: the least the terrain budget must hold besides the fields: the canvases, the bake lattice reserve and one 32 px chunk with the materials.
  // H13: what the paged fields must leave free: the canvas, one canonical chunk's whole working set (every mask layer the world has) and its copy.
  // It was a 32 px chunk's, so the fields took the rest of the budget and the first 512 px bake could not be allocated beside them.
  // The terrain canvas and its overlay share the view's size (resize); the paged fields' budget is the shared one (sculpt-scene.js pagedBudget).
  function minimumBytes(){return pagedBudget({gpuMB:0,renderer,chunk:canonicalSize,maskCount:api.maskKeys?.length,view:{width:canvas.width,height:canvas.height},preview:previewReserved,featureBytes:features?.stats?.().imageBytes||0}).minimum;}
  const result={renderer,passability,minimumBytes,foregroundPending,schedule,resize,pick,view:state,stats:metrics,heightSample,sampleHeights,exportChunks,setBusy,features,metadata,invalidate:clear,zoom,idle,debugBake:async(rect,level=1,exportArt=false)=>{await idle();const e=await bake(rect,exportArt,undefined,null,level);return e.bitmap;},setBudgets:({gpuMB=gpuBudget/MB,heapMB=heapBudget/MB}={})=>{find('[data-gpu]').value=gpuMB;find('[data-heap]').value=heapMB;budgets();},resetMetrics:()=>{peakGPU=peakHeap=peakAccountedHeap=0;strokeTimes.length=frameTimes.length=0;},get cacheKeys(){return [...cache.keys()];},cacheSnapshot:()=>[...cache].map(([key,e])=>({key,x:e.x,y:e.y,width:e.width,height:e.height,dirty:Boolean(e.dirty),seq:e.seq,scale:e.scale,input:e.input}))};
  window.sculptCanvas=result;resize();budgets();return result;
}
