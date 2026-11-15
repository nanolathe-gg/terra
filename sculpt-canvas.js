import {createTerrainBudget,TerrainMemoryError} from './sculpt-memory.js';
import {createPreviewFields,createPreviewLattice,planPreviewBlocks} from './sculpt-preview.js';
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
  const terrainBudget=createTerrainBudget({explicit:query.has('gpuMB')?number(query,'gpuMB',2048,128,4096):undefined,deviceMemory:navigator.deviceMemory,preference:api.terrainBudgetPreference?.(),save:value=>api.saveTerrainBudget?.(value)});terrainBudget.begin();addEventListener('pagehide',()=>terrainBudget.leave());
  let restarting=false, suspended=false;
  const restartForMemory=why=>{
    if(restarting)return true;
    // Never discard a live recipe when local saving is unavailable. During
    // startup there is no editable recipe yet; the existing save is retained.
    if(!api.saveForGpuRestart?.())return false;
    const failed=terrainBudget.mb;if(!terrainBudget.restart(why))return false;
    restarting=true;
    const url=new URL(location.href);if(url.searchParams.has('gpuMB'))url.searchParams.set('gpuMB',failed);
    api.renderProgress?.('Restarting terrain with a smaller memory budget…');
    location.replace(url);return true;
  };
  config.onDeviceLost=()=>restartForMemory('a lost GPU device');
  config.onMemoryPressure=()=>restartForMemory('a GPU allocation failure');
  const output=document.createElement('canvas'),renderer=await TerrainRenderer.createChunked(output,config);
  const g=canvas.getContext('2d'),ink=overlay.getContext('2d'),cache=new Map();
  const previewFields=createPreviewFields(renderer.device,api.previewScene);
  const previewLattice=createPreviewLattice(renderer.device,api.previewScene,()=>metrics());
  // The half-level draft reads the quarter level's lattice (its shape and its own coarse Time), so it follows a release without waiting for the
  // canonical pages' Time; the finals read those pages.
  const previewGridFor=(level,block)=>block&&level>=2&&previewLattice?previewLattice.grid(Math.max(level,4)):(config.worldGrid??config.grid);
  let previewReserved=false;
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
  let gpuBudget=terrainBudget.mb*MB,heapBudget=number(query,'heapMB',1024,128,8192)*MB;
  const levels=query.get('levels')!=='0',levelsOverlay=query.get('levelsOverlay')==='1';   // H7b: levels 0 is the final-only canvas
  let dirtyMarks=0,retainedInvalidations=0;
  const interacting=()=>Boolean(gesture||api.previewActive?.());
  const pipelineWaits=new Map();
  let cacheBytes=0,peakGPU=0,peakHeap=0,peakAccountedHeap=0,evictions=0,bakes=0,hits=0,rebakes=0,scale=1,overview=true,pending=false,drawing=false,rerun=false,serial=0,viewEpoch=0,busy=false,features,metadata,passability,canonicalSize=512,displaySize=256;
  let paintedView=-1,navigationTimer=null,activeBake=null;
  // Only optional background work and hover detail wait for navigation to
  // settle. Visible terrain starts immediately, including during a held pan.
  const navigationDelay=180;
  const navigating=()=>Boolean(pan||navigationPointer!==null||navigationTimer!==null);
  const bakedBefore=new Set(); let lastScroll=-Infinity,lastPresented=0,pendingStrokeTime=0,budgetUpdating=false;
  let heldSince=null,pan=null,space=false,gesture=null,hover=null;
  const previewRejects=new Set();let previewRejectScope='';
  const DRAFT_REST=900;   // ms without input before the view refines from the half-level draft to final tiles
  const blocks=new Map();let blockBytes=0,focus=null,lastInputAt=performance.now(),released=false,ladderTimer=null,fineSinceCoarse=false,finalizing=false,warmedSerial=-1,draftDue=false;
  let hoveredNode=-1;
  let lastFrame=0,frameTimes=[],strokeTimes=[],resizePending=false;
  const coarse=new OffscreenCanvas(VIEW_CANVASES.overview,VIEW_CANVASES.overview),cg=coarse.getContext('2d');
  const panel=document.createElement('section'); panel.className='section files';
  panel.innerHTML=`<h3>Memory budgets</h3><label class="control" style="display:block">Terrain GPU budget (MiB)<input data-gpu type="number" min="128" max="4096" step="128" value="${gpuBudget/MB}"></label><label class="control" style="display:block">Page heap budget (MiB)<input data-heap type="number" min="128" max="8192" step="128" value="${heapBudget/MB}"></label><p class="small" data-memory></p>`;
  $('graphics-host').append(panel);
  $('minimap-host').innerHTML=`<canvas data-nav width="${VIEW_CANVASES.minimap}" height="${VIEW_CANVASES.minimap}" tabindex="0" aria-label="Minimap: drag to pan, or use arrow keys"></canvas>`;
  const find=s=>document.querySelector(s),navigatorCanvas=find('[data-nav]'),ng=navigatorCanvas.getContext('2d');
  function state() { return {x:viewport.scrollLeft/(scale||1),y:viewport.scrollTop/(scale||1),width:canvas.width/(scale||1),height:canvas.height/(scale||1),scale,overview}; }
  const sourceSample=api.sample;
  function heightSample(x,y){for(const e of cache.values()){const r=e.heightPatch;if(e.weathered===weatheredView&&r&&x>=r.gridOrigin[0]&&y>=r.gridOrigin[1]&&x<=r.gridOrigin[0]+(r.gridWidth-1)*r.gridSpacing&&y<=r.gridOrigin[1]+(r.gridHeight-1)*r.gridSpacing)return sampleField(r,x,y);}return null;}
  function visibleSample(x,y){return heightSample(x,y)??(weatheredView?sourceSample:api.sampleAuthored??sourceSample)(x,y);}
  function keepHeight(r){return {fields:{h:r.fields.h},gridWidth:r.gridWidth,gridHeight:r.gridHeight,gridSpacing:r.gridSpacing,gridOrigin:r.gridOrigin,bytes:r.fields.h.byteLength};}
  function fixedGPU(external=true) { return (external?(api.gpuBytes?.()??0)+blockBytes+(previewLattice?.bytes()??0):0)+(previewReserved?64*MB:0)+(canvas.width*canvas.height+overlay.width*overlay.height+coarse.width*coarse.height+navigatorCanvas.width*navigatorCanvas.height)*4+(features?.stats?.().imageBytes||0); }
  function steadyGPU() { return fixedGPU()-(api.gpuTransientBytes?.()??0); }   // what a bake budgets against: fixedGPU less the Time pass's memory, gone when the pass ends
  function gpuResident() { return renderer.stats().residentBytes+cacheBytes+fixedGPU(); }
  function ownedBytes(extra=[]){const buffers=new Set(api.residentBuffers?.()||[]);for(const e of cache.values())if(e.heightPatch)buffers.add(e.heightPatch.fields.h.buffer);for(const a of extra)if(ArrayBuffer.isView(a))buffers.add(a.buffer);const r=renderer.stats();return [...buffers].reduce((n,b)=>n+b.byteLength,0)+r.cpuRetainedBytes+(r.cpuWorkingBytes??0)+(api.workingBytes?.()??0);}
  function fieldArrays(r){return [...Object.values(r.fields),...Object.values(r.weather??{}),r.materialField??r.material].filter(ArrayBuffer.isView);}
  function checkHeap(r,upload=0){const arrays=fieldArrays(r),used=()=> (performance.memory?.usedJSHeapSize??0)+ownedBytes(arrays)+upload;if(used()>heapBudget){api.evict?.();for(const e of cache.values())e.heightPatch=null;if(used()>heapBudget)throw new Error('The regional field and weather working set exceeds the JS memory budget.');}}
  api.checkMemory=(extra=0)=>{let m=metrics();if(m.accountedHeapBytes+extra>heapBudget){api.evict?.();for(const e of cache.values())e.heightPatch=null;m=metrics();if(m.accountedHeapBytes+extra>heapBudget)throw new Error('The regional field and weather working set exceeds the JS memory budget.');}};
  function metrics() {
    const fields=api.stats?.()??{},render=renderer.stats(),heap=performance.memory?.usedJSHeapSize??0,gpu=gpuResident();
    const heightBytes=[...new Set([...cache.values()].map(e=>e.heightPatch?.fields.h.buffer).filter(Boolean))].reduce((n,b)=>n+b.byteLength,0),owned=ownedBytes()+(passability?.stats().bytes||0),accounted=heap+owned;
    peakGPU=Math.max(peakGPU,gpu);peakHeap=Math.max(peakHeap,heap);peakAccountedHeap=Math.max(peakAccountedHeap,accounted);
    find('[data-memory]').textContent=`Terrain ${(gpu/MB).toFixed(1)} / ${gpuBudget/MB} MiB · heap ${(accounted/MB).toFixed(1)} / ${heapBudget/MB} MiB · ${cache.size} cached · ${evictions} evictions · ${canonicalSize}px bake${terrainBudget.reason?' · '+terrainBudget.reason:''}`;
    return {gpuBytes:gpu,peakGPUBytes:peakGPU,heapBytes:heap,peakHeapBytes:peakHeap,accountedHeapBytes:accounted,peakAccountedHeapBytes:peakAccountedHeap,ownedArrayBytes:owned,gpuBudget,budgetReason:terrainBudget.reason,heapBudget,cacheBytes,heightBytes,cachedChunks:cache.size,previewBlocks:blocks.size,previewBlockBytes:blockBytes,preview:previewFields.stats(),previewLattice:previewLattice?.stats()??null,finalizing,dirtyChunks:[...cache.values()].filter(e=>e.dirty).length,dirtyMarks,retainedInvalidations,evictions,bakes,hits,rebakes,levels:{quarter:[...cache.values()].filter(e=>(e.scale??1)>1).length,final:[...cache.values()].filter(e=>(e.scale??1)===1).length,quarterBytes:[...cache.values()].filter(e=>(e.scale??1)>1).reduce((n,e)=>n+e.bytes,0)},canonicalChunkSize:canonicalSize,displayChunkSize:viewChunkSize(),field:fields,renderer:render,strokeMilliseconds:strokeTimes.slice(),frameMilliseconds:frameTimes.slice()};
  }
  function remove(key) { const e=cache.get(key);if(!e)return;renderer.releaseColorTile(e.color);e.bitmap.close?.();cacheBytes-=e.bytes;cache.delete(key);evictions++; }
  // H6b: a bake from the GPU buffers records how many changes had been announced when it took them; it is still good if none announced since touched
  // its input (an edit elsewhere on the map, or a later move of the same stroke over other chunks, does not throw it away).
  const rev={B:0,C:0,D:0,E:0,F:0},changeLog=[];let lastInput=null;
  // The shape rectangles edited since the view was last all final (none after a change with no rectangle). Previews use it; finals never do.
  // A Time result's rectangle does not widen it: on a paged map that is the stale pages, far more ground than the edit weathers.
  let editRect=null,editWide=false;
  // A preview redraws the surroundings of an edit, not every tile whose inputs reach it: a tile reads terrain up to 628 px away for shadows,
  // stones and tall ground, but an edit moves few pixels beyond its own bounds (measured on a hill stroke: 23 px). The margins cover the
  // edit's own projection at the map's tallest ground and its near shading; a far shadow waits for the tile's final. Final tiles keep the
  // full input test (changed()).
  function editSurroundings(rect){
    const up=Math.ceil(renderer.reaches().projection[1])+32,side=48,down=48,x=Math.floor((rect.x-side)/16)*16,y=Math.floor((rect.y-up)/16)*16;
    return {x,y,width:Math.ceil((rect.x+rect.width+side-x)/16)*16,height:Math.ceil((rect.y+rect.height+down-y)/16)*16};
  }
  // own: the picture came from the preview lattice, which has its own Time, so the canonical Time's result (a refinement) does not stale it.
  function changedSince(at,input,through='F',own=false){return changeLog.length>=256&&changeLog[0].serial>at+1||changeLog.some(c=>c.serial>at&&c.stage<=through&&!(own&&c.refinement)&&(!c.rect||intersects(c.rect,input)));}
  function cancelBake(input=false){if(!input||!activeBake?.finishOnInput)activeBake?.controller.abort();}
  function changed({stage=null,rect=null,refinement=false,world=rect===null&&!refinement,fields=[],channels=[],input=true,kind=null}={}) {
    if(stage!==null&&!'ABCDEF'.includes(stage))throw Error('Unknown dirty stage '+stage);
    let tiles=0;
    if(stage){
      cancelBake(true);if(stage==='A'&&!refinement)previewFields.invalidate(rect);
      api.renderProgress?.('Updating terrain…',true);
      if(!refinement){lastInputAt=performance.now();released=false;if(stage==='A'&&2*detailLevel()>=2)draftDue=true;}
      serial++;if(world)for(const s of new Set([stage,...fields.map(f=>f.stage),...channels.map(c=>c.stage)]))if(s in rev)rev[s]++;
      changeLog.push({serial,stage,rect,refinement});if(changeLog.length>256)changeLog.shift();
      if(!rect){editWide=true;editRect=null;}
      else if(stage==='A'&&!editWide){const a=editRect,x=a?Math.min(a.x,rect.x):rect.x,y=a?Math.min(a.y,rect.y):rect.y;editRect={x,y,width:(a?Math.max(a.x+a.width,rect.x+rect.width):rect.x+rect.width)-x,height:(a?Math.max(a.y+a.height,rect.y+rect.height):rect.y+rect.height)-y};}
      for(const e of cache.values())if(!(refinement&&(e.fit||e.weathered===false))&&(!rect||intersects(rect,e.input??e))){
        if(stage<='E'){renderer.releaseColorTile(e.color);e.color=null;e.finalCostMs=null;e.finalCostBudget=null;}
        if(!e.dirty){dirtyMarks++;tiles++;}e.dirty=true;retainedInvalidations++;
      }
      for(const e of blocks.values())if(!(refinement&&e.lattice)&&(!rect||intersects(rect,e.input??e))){if(stage<='E'){renderer.releaseColorTile(e.color);e.color=null;}e.dirty=true;}
      // Inputs invalidate metadata, not retained pixels. Replaying unchanged
      // tiles here competes with the new Time/draw work; results and camera
      // changes request their own composition.
      if(!refinement)configureChunks();
      coarseColour=true;features?.groundChanged?.(rect);schedule();
    }
    const record={serial,rev:{...rev},stage,rect:rect?{...rect}:null,fields,channels,tiles,kind};
    if(input)lastInput=record;
    return record;
  }
  function trimTo(limit,protectVisible=false){limit=Math.max(0,limit);const v=state();for(const[key,e]of cache)if(cacheBytes>limit&&!intersects(e,v))remove(key);if(protectVisible&&cacheBytes>limit)throw Error("The preview cannot fit beside the visible final images.");while(cacheBytes>limit&&cache.size)remove(cache.keys().next().value);}
  function reservePreview(){
    if(!finalizing)return;
    finalizing=false;api.fitGpuBudget?.();
  }
  function configureChunks() {
    if(budgetUpdating)return;budgetUpdating=true;
    try {
      renderer.trimColorTiles(()=>renderer.colorBytes<=colorReserve());reservePreview();
      // Keep the export's fixed trial: 128 MiB less room for its own output image. The view uses the actual budget below. The bake lattice
      // depends on neither the GPU fields nor the view: the window's canvases and the feature images are counted against the actual budget
      // (fixedGPU), and counted here they left a 4K window with many ground features no room for any tile, so every stroke threw.
      // A size that cannot be probed keeps the last one: the bake's own allocation reports a real shortage.
      const probe=(size,...args)=>{try{return renderer.chunkSize(...args);}catch(error){console.warn(error.message);return size;}};
      finest=.25;canonicalSize=Math.min(512,probe(canonicalSize,undefined,128*MB,512*512*8));
      // The export lattice may change with its fixed trial, but retained view
      // images keep their own 256 px grid. Only an actual budget shortage can
      // lower that grid; a knob changing the export's size never empties it.
      trimTo(gpuBudget-fixedGPU()-renderer.stats().retainedBytes-32*MB);
      // Neighbouring tiles rebuild the same voxels round their edges (a 256 px tile's solid covers about twice its area), so a larger view
      // tile bakes the same pixels with less of that overlap. Below 1024 MiB the working set of a 512 px tile is too large a share.
      const viewTile=gpuBudget>=1024*MB?512:256,nextDisplay=probe(displaySize,viewTile,gpuBudget,fixedGPU()+cacheBytes+viewTile*viewTile*8);
      if(nextDisplay!==displaySize){for(const key of cache.keys())remove(key);displaySize=nextDisplay;}
      // A knob may arrive during the voxel allocation readback. Its textures
      // must survive until that bake returns; bake() sets the next budget too.
      if(!renderer.busy)renderer.setBudget(gpuBudget,fixedGPU()+cacheBytes+Math.max(canonicalSize,displaySize)**2*8);
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
  // View tiles stay on one grid beside the export's canonical bake lattice.
  function viewChunkSize() { return displaySize; }
  // Let optional whole-map work yield until the camera has its requested
  // images. A failed/paused render must not starve background work forever.
  function foregroundPending() {
    if(busy)return false;
    if(navigating())return true;
    if(!drawing&&!pending&&!ladderTimer&&!pipelineWaits.size)return false;
    const v=state(),size=overview?256*displayLevel():viewChunkSize(),level=overview?displayLevel():detailLevel();
    for(let y=Math.max(0,Math.floor(v.y/size))*size;y<Math.min(map.height,v.y+v.height);y+=size)for(let x=Math.max(0,Math.floor(v.x/size))*size;x<Math.min(map.width,v.x+v.width);x+=size){
      const e=cache.get(cacheKey({x,y},size));if(!e||e.dirty||e.weathered&&!(e.weatherRevB>=rev.B)||!colorCovers(e,v)||(level<2?offLevel(e,level):(e.scale??1)>level))return true;
    }
    return false;
  }
  // Display levels use the same chunk pipeline; blocks copy its reusable output
  // synchronously, while final tiles and export keep immutable bitmaps.
  // The inputs of the whole visible view on a block's lattice, joined with the block's own: the lattice window of a gesture (bake()).
  function latticeWindow(planned,request,options){
    if(!interacting())return planned;
    const v=state(),x=Math.max(0,Math.floor(v.x/64)*64),y=Math.max(0,Math.floor(v.y/64)*64),x1=Math.min(map.width,Math.ceil((v.x+v.width)/64)*64),y1=Math.min(map.height,Math.ceil((v.y+v.height)/64)*64);
    if(x1<=x||y1<=y)return planned;
    const c=renderer.requiredRegion({...request,x,y,width:x1-x,height:y1-y},options),sp=planned.gridSpacing,end=r=>[r.gridOrigin[0]+(r.gridWidth-1)*sp,r.gridOrigin[1]+(r.gridHeight-1)*sp],a=end(planned),b=end(c);
    const gx=Math.min(planned.gridOrigin[0],c.gridOrigin[0]),gy=Math.min(planned.gridOrigin[1],c.gridOrigin[1]);
    return {...planned,gridOrigin:[gx,gy],gridWidth:Math.round((Math.max(a[0],b[0])-gx)/sp)+1,gridHeight:Math.round((Math.max(a[1],b[1])-gy)/sp)+1};
  }
  async function bake(rect,exportArt=false,signal,stale=null,scale=1,fit=false,block=false,warm=false) {
    // Wait before preparing fields, too: a queued tile must not start a costly
    // paged replay for a viewport that has moved while the GPU was occupied.
    await renderer.previousChunk;
    // The completed voxel solid is rebuilt every draw. Release it before page
    // preparation and Time allocate their working sets, rather than afterward.
    renderer.voxel.clear();
    if(previewLattice&&!exportArt&&!block&&!fit&&!warm&&!interacting()&&!finalizing){
      // The immutable preview picture remains visible; its source and future
      // refinement working sets no longer need to displace canonical pages.
      finalizing=true;previewLattice.clear();api.fitGpuBudget?.();
    }
    const costAt=performance.now(),costBudget=gpuBudget;
    signal?.throwIfAborted();
    if(stale?.())throw new DOMException('The view changed under a queued bake.','AbortError');
    const readWeather=exportArt||weatheredView,lattice=block&&scale>=2?previewLattice:null,sourceSerial=serial,sourceRev={...rev};
    const options=drawOptions?.()??api.drawOptions?.()??{},request={...rect,exportArt,worldSize:config.worldSize??config.size,worldGrid:fit?512:previewGridFor(scale,block)};
    // H6b: with the GPU fields on, the chunk's textures are made from the fields' buffers; no CPU read, no upload, no height patch kept.
    if(!exportArt)api.renderProgress?.('Shaping terrain…');
    const planned=renderer.requiredRegion(request,options),estimateBefore=renderer.estimate(planned,rect.width,rect.height,api.maskKeys.length,scale);let latticeRegion=planned;
    if(lattice){
      const copyBytes=Math.ceil(rect.width/scale)*Math.ceil(rect.height/scale)*8,visible=[...cache.values()].filter(e=>intersects(e,state())).reduce((n,e)=>n+e.bytes,0);
      // During a gesture the lattice's window covers the whole view's inputs, not this block's: the block grows with the gesture, and each
      // new window ran the lattice's Time again in the middle of the drag (40-50 ms, six times in a 40-move stroke). The view's window
      // is made once. Where it does not fit beside the visible tiles, the block's own window serves as before.
      const wide=latticeWindow(planned,request,options),wideExtra=wide===planned?0:lattice.plan(wide,readWeather,true).additionalBytes;
      latticeRegion=wide!==planned&&visible<=gpuBudget-steadyGPU()-estimateBefore.retainedBytes-estimateBefore.workingBytes-wideExtra-copyBytes?wide:planned;
      const extra=lattice.plan(latticeRegion,readWeather,interacting()).additionalBytes,room=()=>gpuBudget-steadyGPU()-estimateBefore.retainedBytes-estimateBefore.workingBytes-extra-copyBytes;
      // Input can change the graph while the preceding GPU submission drains.
      // Reclaim/replan against that graph before allocating its source.
      if(visible>room())api.releaseGpuStaging?.();
      if(visible>room()){previewRejects.add(previewSignature(rect,scale,planned,estimateBefore));if(previewRejects.size>128)previewRejects.delete(previewRejects.values().next().value);const error=Error('Preview source grew; replan at the current budget.');error.name='PreviewReplan';throw error;}
      trimTo(room(),true);
      // This is a transient source reservation, not a canonical tile-size probe.
      if(renderer.stats().residentBytes+steadyGPU()+cacheBytes+extra+copyBytes>gpuBudget)renderer.evict();
      api.fitGpuBudget?.();
    }else if(previewLattice&&previewLattice.bytes()&&estimateBefore.retainedBytes+estimateBefore.workingBytes+steadyGPU()+cacheBytes+Math.max(0,previewLattice.stats().peakBytes-previewLattice.bytes())>gpuBudget){
      // Keep an idle source only if it could refresh beside canonical work.
      // Its immutable image survives giving the buffers back to final tiles.
      previewLattice.trim();
    }
    const feed=fit?await previewFields.feed():lattice?await lattice.feed(latticeRegion,{weather:readWeather,signal,stale,deferTime:interacting()}):await api.gpuFeedSource?.(signal,() => renderer.requiredRegion(request,options),{weather:readWeather});   // H5b: a paged map prepares the pages under the chunk's lattice
    if(warm){feed?.release?.();return null;}   // the canonical pages (shape and Time) stay prepared for the finals
    if(!exportArt)api.renderProgress?.('Rendering surface…');
    if(feed)try{
      signal?.throwIfAborted();
      if(stale?.())throw new DOMException('The scene changed under a queued bake.','AbortError');
      // Warm the scheduled focus source while its final pipeline compiles.
      // Its pages stay cached after the lease is released. Direct readers
      // and export still complete their requested bake.
      if(!exportArt&&!block&&!fit&&stale&&pipelineWaits.has(renderer.specKey().key))return null;
      const required=renderer.requiredRegion(request,options),estimate=renderer.estimate(required,rect.width,rect.height,feed.maskCount,scale),ow=Math.ceil(rect.width/scale),oh=Math.ceil(rect.height/scale),copyBytes=ow*oh*8,room=gpuBudget-steadyGPU()-estimate.retainedBytes-estimate.workingBytes-copyBytes;
      // A level whose view does not fit beside the bake would have each tile evict the last, and every repaint would bake them all again.
      if(scale<1&&room<detailBytes(scale))throw new Error(`nanolathe: a view at level ${scale} needs more of GPU memory than the budget leaves`);
      // Cold page preparation may grow residency after the pure plan. Replan
      // before allocating, preserving every visible final image.
      if(block&&[...cache.values()].filter(e=>intersects(e,state())).reduce((n,e)=>n+e.bytes,0)>room){previewRejects.add(previewSignature(rect,scale,required,estimate));if(previewRejects.size>128)previewRejects.delete(previewRejects.values().next().value);const error=Error('Preview page residency grew; replan at the current budget.');error.name='PreviewReplan';throw error;}
      trimTo(room,block);
      renderer.setBudget(gpuBudget,steadyGPU()+cacheBytes+copyBytes);signal?.throwIfAborted();
      const measureFinal=!exportArt&&!block&&!fit&&scale===detailLevel()&&!api.previewActive?.()&&(!api.canExport||api.canExport());
      const atSerial=lattice?sourceSerial:serial,atRev=lattice?sourceRev:{...rev},result=await renderer.renderChunk(request,{...options,quality:'full',feed,scale,signal,stale,preview:block,fastRaster:block&&interacting(),deferPipelines:!exportArt,deferCompletion:!fit&&!exportArt});bakes++;
      const bitmap=block?new OffscreenCanvas(ow,oh):await createImageBitmap(result.canvas,0,0,ow,oh,{colorSpaceConversion:'none'});
      if(block)bitmap.getContext('2d').drawImage(result.canvas,0,0,ow,oh);
      const entry={...rect,bitmap,bytes:ow*oh*4,scale,fit,lattice:Boolean(lattice),weathered:readWeather,fed:true,serial:atSerial,rev:atRev,shapeRev:feed.revision,pipelineKey:result.pipelineKey,weatherRevB:fit?null:feed.weatherRevB,level:scale,input:{x:required.gridOrigin[0],y:required.gridOrigin[1],width:(required.gridWidth-1)*required.gridSpacing,height:(required.gridHeight-1)*required.gridSpacing},heightPatch:null};
      if(measureFinal)renderer.previousChunk.then(()=>{if(!changedSince(atSerial,entry.input,'E')){entry.finalCostMs=performance.now()-costAt;entry.finalCostBudget=costBudget;}},()=>{});
      const key=rect.x+','+rect.y+','+canonicalSize+','+scale;if(bakedBefore.has(key))rebakes++;bakedBefore.add(key);metrics();return entry;
    }finally{feed.release?.();}
    const fields=await region(request,options,signal,readWeather);
    // H7 2b: the scene changed while this bake waited for its fields; its image would be dropped, so it never reaches the GPU.
    if(stale?.())throw new DOMException('The scene changed under a queued bake.','AbortError');
    const required=renderer.requiredRegion(request,options),estimate=renderer.estimate({...required,gridWidth:fields.gridWidth,gridHeight:fields.gridHeight},rect.width,rect.height,fields.maskPlanes?.length??api.maskKeys.length);
    checkHeap(fields,estimate.cpuPeakBytes);
    const copyBytes=rect.width*rect.height*8;trimTo(gpuBudget-steadyGPU()-estimate.retainedBytes-estimate.workingBytes-copyBytes);
    renderer.setBudget(gpuBudget,steadyGPU()+cacheBytes+copyBytes);signal?.throwIfAborted();
    const atSerial=serial,atRev={...rev},result=await renderer.renderChunk(fields,{...options,quality:'full',signal,stale,deferPipelines:!exportArt,deferCompletion:!exportArt});bakes++;
    const bitmap=await createImageBitmap(result.canvas,0,0,rect.width,rect.height,{colorSpaceConversion:'none'}),entry={...rect,bitmap,bytes:rect.width*rect.height*4,weathered:readWeather,serial:atSerial,rev:atRev,shapeRev:fields.revision,weatherRevB:fields.weatherRevB??(readWeather?-1:atRev.B),level:1,input:{x:fields.gridOrigin[0],y:fields.gridOrigin[1],width:(fields.gridWidth-1)*fields.gridSpacing,height:(fields.gridHeight-1)*fields.gridSpacing},heightPatch:keepHeight(fields)};
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
  function colorCovers(e,v){
    if(!e.colorRect)return true;v??=state();if(!intersects(e,v))return true;
    const r=e.colorRect;return r.x<=Math.max(e.x,v.x)&&r.y<=Math.max(e.y,v.y)&&r.x+r.width>=Math.min(e.x+e.width,v.x+v.width)&&r.y+r.height>=Math.min(e.y+e.height,v.y+v.height);
  }
  function currentFinal(e){return e&&!e.dirty&&!e.fit&&!offLevel(e,detailLevel())&&e.weathered===weatheredView&&(!e.weathered||e.weatherRevB>=rev.B)&&colorCovers(e);}
  function blockClips(e,v){
    const clips=[],size=viewChunkSize();
    for(let y=Math.max(0,Math.floor(v.y/size)*size);y<Math.min(map.height,v.y+v.height);y+=size)for(let x=Math.max(0,Math.floor(v.x/size)*size);x<Math.min(map.width,v.x+v.width);x+=size){
      const final=cache.get(cacheKey({x,y},size));if(final&&colorCovers(final,v)&&final.weathered===e.weathered&&(!e.weathered||final.weatherRevB>=e.weatherRevB)&&(currentFinal(final)||final.serial>=e.serial))continue;
      const x0=Math.max(x,e.x,v.x),y0=Math.max(y,e.y,v.y),x1=Math.min(x+size,e.x+e.width,v.x+v.width,map.width),y1=Math.min(y+size,e.y+e.height,v.y+v.height,map.height);
      if(x1>x0&&y1>y0)clips.push({x:x0,y:y0,width:x1-x0,height:y1-y0});
    }return clips;
  }
  function paint(entry,v=state()) {
    const k=entry.scale??1,x0=Math.round((entry.x-v.x)*scale),y0=Math.round((entry.y-v.y)*scale),x1=Math.round((entry.x+entry.bitmap.width*k-v.x)*scale),y1=Math.round((entry.y+entry.bitmap.height*k-v.y)*scale);
    entry.paintedClips=entry.block?blockClips(entry,v):entry.colorRect?[entry.colorRect]:null;
    if(entry.paintedClips){if(!entry.paintedClips.length)return;g.save();g.beginPath();for(const r of entry.paintedClips)g.rect(Math.round((r.x-v.x)*scale),Math.round((r.y-v.y)*scale),Math.round((r.x+r.width-v.x)*scale)-Math.round((r.x-v.x)*scale),Math.round((r.y+r.height-v.y)*scale)-Math.round((r.y-v.y)*scale));g.clip();}
    g.imageSmoothingEnabled=scale<1||k*scale<1;g.imageSmoothingQuality='high';g.drawImage(entry.bitmap,x0,y0,x1-x0,y1-y0);
    if(entry.paintedClips)g.restore();
  }
  const blockKey=(r,level)=>[r.x,r.y,r.width,r.height,level,weatheredView].join(',');
  function dropBlocks(predicate=()=>true){for(const [key,e]of blocks)if(predicate(e)){renderer.releaseColorTile(e.color);blockBytes-=e.bytes;blocks.delete(key);}}
  function wakeLadder(delay){clearTimeout(ladderTimer);ladderTimer=setTimeout(()=>{ladderTimer=null;schedule();},Math.max(0,delay));}
  function previewSignature(r,level,q,e){return [r.x,r.y,r.width,r.height,level,...q.gridOrigin,q.gridWidth,q.gridHeight,q.fieldsX,q.fieldsY,q.fieldsWidth,q.fieldsHeight,e.workingBytes].join(',');}
  function previewCost(rect,level,options=drawOptions?.()??api.drawOptions?.()??{},visibleBytes=[...cache.values()].filter(e=>intersects(e,state())).reduce((n,e)=>n+e.bytes,0)){
    const request={...rect,worldSize:config.worldSize??config.size,worldGrid:previewGridFor(level,true)},required=renderer.requiredRegion(request,options),estimate=renderer.estimate(required,rect.width,rect.height,api.maskKeys.length,level),source=level>=4?previewLattice?.plan(required,weatheredView,interacting()).additionalBytes??0:0;
    return {required,estimate,total:estimate.retainedBytes+estimate.workingBytes+source+fixedGPU()+visibleBytes+Math.ceil(rect.width/level)*Math.ceil(rect.height/level)*8};
  }
  function releasePreviewMemory(area,level){
    if(!previewLattice||level<4)return;
    const whole=planPreviewBlocks(area,map,()=>true)[0];
    if(whole&&previewCost(whole,level).total>gpuBudget)api.releaseGpuStaging?.();
  }
  function previewPlan(area,level){
    const scope=[viewEpoch,gpuBudget,displaySize].join(',');
    if(scope!==previewRejectScope){previewRejects.clear();previewRejectScope=scope;}
    // An immutable current picture needs no source working set. In particular,
    // a retained 8 px answer survives the later 4 px source allocation.
    const current=[...blocks.values()].find(e=>e.level===level&&blockCurrent(e)&&e.x<=area.x&&e.y<=area.y&&e.x+e.width>=area.x+area.width&&e.y+e.height>=area.y+area.height);
    if(current)return [{x:current.x,y:current.y,width:current.width,height:current.height}];
    reservePreview();releasePreviewMemory(area,level);
    const options=drawOptions?.()??api.drawOptions?.()??{},visibleBytes=[...cache.values()].filter(e=>intersects(e,state())).reduce((n,e)=>n+e.bytes,0);
    return planPreviewBlocks(area,map,rect=>{const {required,estimate,total}=previewCost(rect,level,options,visibleBytes);
      return !previewRejects.has(previewSignature(rect,level,required,estimate))&&total<=gpuBudget&&estimate.geometryRecord<=renderer.device.limits.maxStorageBufferBindingSize;
    });
  }
  function coversView(e,v){return e.x<=v.x&&e.y<=v.y&&e.x+e.width>=Math.min(map.width,v.x+v.width)&&e.y+e.height>=Math.min(map.height,v.y+v.height);}
  function colorInputCurrent(e){return e?.color&&!e.color.retired&&!changedSince(e.color.serial,e.input,'E',e.lattice)&&e.weathered===weatheredView&&(!e.weathered||e.weatherRevB>=rev.B);}
  function colorCurrent(e){return colorInputCurrent(e)&&!offLevel(e,detailLevel());}
  async function retainColor(entry){
    const v=state();if(overview||!entry.fed||(!entry.block&&entry.scale!==detailLevel()||entry.block&&entry.scale!==4*detailLevel())||!intersects(entry,v)||changedSince(entry.serial,entry.input,'E'))return;
    const limit=colorReserve();if(!limit)return;
    const cost=renderer.colorTileBytes(),at=focus??[v.x+v.width/2,v.y+v.height/2],distance=e=>e.block?-1:Math.hypot(e.x+e.width/2-at[0],e.y+e.height/2-at[1]);
    if(cost>limit)return;
    for(const e of [...cache.values()].filter(e=>e.color).sort((a,b)=>distance(b)-distance(a))){if(renderer.colorBytes+cost<=limit)break;if(distance(e)<=distance(entry))return;renderer.releaseColorTile(e.color);e.color=null;}
    if(renderer.colorBytes+cost>limit)return;
    const tile=await renderer.retainColorTile();if(tile){tile.serial=entry.serial;tile.block=Boolean(entry.block);tile.rect={x:entry.x,y:entry.y,width:entry.width,height:entry.height};if(changedSince(entry.serial,entry.input,'E'))renderer.releaseColorTile(tile);else entry.color=tile;}
  }
  function blockCurrent(e){return e&&!e.dirty&&!changedSince(e.serial,e.input,'F',e.lattice)&&e.weathered===weatheredView&&(!e.weathered||e.weatherRevB>=rev.B);}
  function presentView() {
    const repaint=paintedView!==viewEpoch||cache.size===0;
    drawCoarse(repaint);
    if(repaint){
      const v=state(),size=overview?256*displayLevel():viewChunkSize();
      // Fit images are useful at every zoom. Keep them underneath close-view
      // tiles so newly exposed terrain has a picture without another GPU job.
      if(!overview)for(const e of [...cache.values()].filter(e=>e.fit&&intersects(e,v)).sort((a,b)=>b.scale-a.scale))paint(e,v);
      for(const [key,e] of cache)if(key===cacheKey(e,size)&&intersects(e,v))paint(e,v);
      if(!overview){
        for(const e of [...blocks.values()].filter(e=>e.weathered===weatheredView&&intersects(e,v)).sort((a,b)=>a.serial-b.serial||b.level-a.level))paint(e,v);
        for(const [key,e]of cache)if(key===cacheKey(e,size)&&intersects(e,v)&&currentFinal(e))paint(e,v);
      }
      paintedView=viewEpoch;presented(false);
    }
    overlays();
  }
  function presented(fresh=true) {
    api.presented?.();
    const now=performance.now();if(lastPresented&&now-lastScroll<300&&now-lastPresented<3000){frameTimes.push(now-lastPresented);if(frameTimes.length>1024)frameTimes.shift();}lastPresented=now;
    // Exercise the refinement working sets before clearing the crash note.
    if(fresh&&!foregroundPending()&&(!api.canExport||api.canExport()))terrainBudget.settled();
    if(fresh&&pendingStrokeTime){strokeTimes.push(now-pendingStrokeTime);if(strokeTimes.length>256)strokeTimes.shift();pendingStrokeTime=0;}
  }
  function watchPipelines(key,ready){
    if(pipelineWaits.has(key))return;
    pipelineWaits.set(key,ready);
    ready.then(()=>{pipelineWaits.delete(key);schedule();},error=>{pipelineWaits.delete(key);if(!renderer.recovering){console.error(error);$('error').hidden=false;$('error').textContent=error.message;}});
  }
  async function frame() {
    pending=false;if(suspended)return;let rendering=false;const renderStart=performance.now();
    try {
      // Presentation never waits for terrain generation. This path only copies
      // retained images while a chunk's fields, GPU work or snapshot are pending.
      if(drawing){if(paintedView!==viewEpoch)presentView();else if(passability?.active)overlays();rerun=true;return;}
      presentView();
      drawing=rendering=true;
      const delta=renderer.syncWorld(drawOptions?.()??api.drawOptions?.()??{});
      if(delta.stage)changed(delta);
      // H7 2b: while the Time pass is running, a bake would read the unweathered height and be redone when the weather lands.
      // The pass is submitted first (it starts with the edit) and chunks wait for it, for at most 8 s so a failed pass cannot hide the map.
      const weatherPending=weatheredView&&api.canExport&&!api.canExport()&&!interacting()&&!features?.busy;
      if(weatherPending){heldSince??=performance.now();}else heldSince=null;
      const holding=weatherPending&&performance.now()-heldSince<8000;
      if(holding){api.renderProgress?.('Weathering terrain…');setTimeout(schedule,100);}
      if(!busy){
        if(overview&&!previewReserved){previewReserved=true;api.fitGpuBudget?.();}
        const size=overview?256*displayLevel():viewChunkSize(),v=state(),jobs=[],token=serial,viewToken=viewEpoch;
        const previewing=interacting(),quiet=performance.now()-lastInputAt,at=focus??[v.x+v.width/2,v.y+v.height/2],levelsOn=levels&&api.gpuFeedActive?.();
        // Time edits get an 8 px first view, then the existing 4/2/final ladder.
        const coarseLevel=(previewLattice&&lastInput?.stage==='B'?8:4)*detailLevel();
        dropBlocks(e=>!intersects(e,v));
        for(const e of cache.values())if(e.color&&(!intersects(e,v)||e.color.retired)){renderer.releaseColorTile(e.color);e.color=null;}
        for(let y=Math.max(0,Math.floor(v.y/size)-1)*size;y<Math.min(map.height,v.y+v.height+size);y+=size)for(let x=Math.max(0,Math.floor(v.x/size)-1)*size;x<Math.min(map.width,v.x+v.width+size);x+=size)jobs.push({x,y,width:Math.min(size,map.width-x),height:Math.min(size,map.height-y)});
        const dist=r=>Math.hypot(r.x+r.width/2-at[0],r.y+r.height/2-at[1]);jobs.sort((a,b)=>intersects(b,v)-intersects(a,v)||dist(a)-dist(b));
        const near={x:v.x-size,y:v.y-size,width:v.width+size*2,height:v.height+size*2};for(const e of cache.values())if(!intersects(e,near))e.heightPatch=null;
        // Keep the focus tile first, then walk neighboring visible tiles.
        // Radial order alternates opposite sides of the view and repeatedly
        // evicts the six-page Time working set on a low-memory map.
        if(!overview&&!previewing){
          const n=jobs.filter(r=>intersects(r,v)).length;
          for(let i=1;i<n;i++){const p=jobs[i-1],distance=r=>(r.x-p.x)**2+(r.y-p.y)**2;let best=i;for(let j=i+1;j<n;j++)if(distance(jobs[j])<distance(jobs[best]))best=j;const [next]=jobs.splice(best,1);jobs.splice(i,0,next);}
        }
        // Finals start with the tiles around the edit and work outward: the ground that visibly changed is final first.
        const editNear=editRect&&!editWide?editSurroundings(editRect):null;
        const editCore=editNear?{x:editRect.x-32,y:editRect.y-32,width:editRect.width+64,height:editRect.height+64}:null,editTier=r=>!intersects(r,v)?0:intersects(r,editCore)?2:intersects(r,editNear)?1:0;
        if(editNear)jobs.sort((a,b)=>editTier(b)-editTier(a));
        const plan=[],stale=jobs.filter(r=>intersects(r,v)&&!currentFinal(cache.get(cacheKey(r,size))));
        if(!stale.length){editRect=null;editWide=false;draftDue=false;}
        const colorJobs=lastInput?.stage==='F'&&!holding?stale.filter(r=>colorCurrent(cache.get(cacheKey(r,size)))).sort((a,b)=>cache.get(cacheKey(a,size)).serial-cache.get(cacheKey(b,size)).serial||dist(a)-dist(b)):[];
        // With complete F coverage, refresh the oldest native picture first.
        // A coarse overpaint on every input would erase that progress; partial
        // caches still need its immediate answer for uncovered ground.
        const allColor=Boolean(colorJobs.length&&colorJobs.length===stale.length);
        // A partial cache gets one fast tile, then yields to the whole-view
        // preview. Repeated input must not starve uncovered ground behind F.
        const colorViewCurrent=[...blocks.values()].some(e=>e.level===coarseLevel&&blockCurrent(e)&&coversView(e,v));
        const colorBlock=stale.length&&lastInput?.stage==='F'&&!holding?[...blocks.values()].find(e=>colorInputCurrent(e)&&!blockCurrent(e)&&coversView(e,v)):null;
        if(colorBlock&&!allColor)plan.push({rect:{x:colorBlock.x,y:colorBlock.y,width:colorBlock.width,height:colorBlock.height},want:colorBlock.level,block:true});
        else if(colorJobs.length&&(allColor||!fineSinceCoarse||colorViewCurrent))for(const rect of colorJobs.slice(0,allColor||colorViewCurrent?undefined:1))plan.push({rect,want:detailLevel(),color:true});
        else if(overview)for(const rect of jobs)plan.push({rect,want:displayLevel()});
        else if(!levelsOn)for(const rect of jobs)plan.push({rect,want:1});
        else if(stale.length){
          const area=stale.reduce((a,r)=>{const x=Math.min(a.x,r.x),y=Math.min(a.y,r.y);return {x,y,width:Math.max(a.x+a.width,r.x+r.width)-x,height:Math.max(a.y+a.height,r.y+r.height)-y};});
          const clipped={x:Math.max(area.x,v.x),y:Math.max(area.y,v.y),width:Math.min(area.x+area.width,v.x+v.width)-Math.max(area.x,v.x),height:Math.min(area.y+area.height,v.y+v.height)-Math.max(area.y,v.y)};
          // Outside the edit's surroundings the retained final tiles stay on screen; with none retained there, the whole stale area is previewed.
          const nearX=editNear?Math.max(editNear.x,clipped.x):0,nearY=editNear?Math.max(editNear.y,clipped.y):0;
          const nearArea=editNear?{x:nearX,y:nearY,width:Math.min(editNear.x+editNear.width,clipped.x+clipped.width)-nearX,height:Math.min(editNear.y+editNear.height,clipped.y+clipped.height)-nearY}:null;
          const retained=e=>e&&e.bitmap&&!e.fit&&!offLevel(e,detailLevel())&&e.weathered===weatheredView;
          const previewArea=nearArea&&nearArea.width>0&&nearArea.height>0&&stale.every(r=>intersects(r,nearArea)||retained(cache.get(cacheKey(r,size))))?nearArea:clipped;
          const coarse=previewPlan(previewArea,coarseLevel).sort((a,b)=>dist(a)-dist(b));
          const coarseReady=coarse.every(r=>blockCurrent(blocks.get(blockKey(r,coarseLevel))));
          // F leaves geometry and Time unchanged. Reuse only measured costs
          // from completed final tiles on this same budget and display level.
          const fineReady=lastInput?.stage==='F'&&(!api.canExport||api.canExport())&&stale.every(r=>{const e=cache.get(cacheKey(r,size));return Number.isFinite(e?.finalCostMs)&&e.finalCostBudget===gpuBudget&&!e.fit&&!offLevel(e,detailLevel())&&e.weathered===weatheredView;});
          const cheapFinal=fineReady&&cache.get(cacheKey(stale[0],size)).finalCostMs<=50&&!(previewing&&renderer.colorBytes);
          const priorCoarse=coarse.length===1?blocks.get(blockKey(coarse[0],coarseLevel)):null;
          const fineBeforeCoarse=cheapFinal&&!fineSinceCoarse&&priorCoarse&&!changedSince(priorCoarse.serial,priorCoarse.input,'E')&&priorCoarse.weathered===weatheredView&&priorCoarse.weatherRevB>=rev.B&&renderer.specCache.has(renderer.specKey().key);
          if(coarseReady){const keep=new Set(coarse.map(r=>blockKey(r,coarseLevel)));dropBlocks(e=>e.level===coarseLevel&&!keep.has(blockKey(e,e.level)));}
          if(!coarseReady){
            if(fineBeforeCoarse)plan.push({rect:stale[0],want:detailLevel(),fineTurn:true});
            for(const rect of coarse)plan.push({rect,want:coarseLevel,block:true});
          }
          else if(released||quiet>=100||cheapFinal){
            // Cheap color finals preserve useful work during a drag. A paged
            // export-ready flag alone cannot certify new shape/Time pages.
            const middle=coarseLevel>4*detailLevel()?previewPlan(previewArea,4*detailLevel()).sort((a,b)=>dist(a)-dist(b)):[];
            if(middle.some(r=>!blockCurrent(blocks.get(blockKey(r,4*detailLevel()))))){
              for(const rect of middle)plan.push({rect,want:4*detailLevel(),block:true});
            }else{
              // The half-level picture is the resting state: it covers the stale ground first, and the finals wait until the artist has been
              // idle for DRAFT_REST, so the GPU is free for the next edit instead of deep in tiles that edit would discard. Finals already
              // measured as cheap (a color edit over kept records) still follow at once.
              // Zoomed in past 100% the half-level picture is a canonical block as costly as the finals it would precede, so there the finals
              // follow at once, as they did before the draft.
              const draftOn=2*detailLevel()>=2,draft=previewPlan(previewArea,2*detailLevel()).sort((a,b)=>dist(a)-dist(b)),draftReady=draft.every(r=>blockCurrent(blocks.get(blockKey(r,2*detailLevel()))));
              // A draft that cannot be made (no room for it, or its weather still pending) does not hold the finals back for good.
              if(draftReady)draftDue=false;
              const settled=fineReady&&(quiet>=100||cheapFinal),finalNow=settled||(released||quiet>=250)&&(!draftOn||draftReady&&quiet>=DRAFT_REST||quiet>=4*DRAFT_REST);
              // Whole-map feeds retain old Time while a refresh is pending.
              // Keep the current coarse answer until canonical weather arrives;
              // paged feeds still prepare their fresh canonical pages on demand.
              const waitCanonical=weatheredView&&api.canExport&&!api.canExport()&&!api.previewScene().paged;
              if(waitCanonical){
                // The draft reads the lattice's own Time, so it does not wait for the whole map's (which waits for it: previewWorkPending).
                if(previewLattice&&2*detailLevel()>=2&&!draftReady)for(const rect of draft)plan.push({rect,want:2*detailLevel(),block:true});
                wakeLadder(100);
              }
              else{
                if(holding||!finalNow)for(const rect of draft)plan.push({rect,want:2*detailLevel(),block:true});
                if(!holding&&finalNow){for(const rect of jobs)if(intersects(rect,v)&&(released||quiet>=100||cache.get(cacheKey(rect,size))?.finalCostMs<=50))plan.push({rect,want:detailLevel()});}
                else{
                  // While the draft rests, the finals' canonical pages are prepared, so the first final starts when the rest ends.
                  const warmDue=draftOn&&draftReady&&!holding&&!previewing&&warmedSerial!==serial;
                  if(warmDue&&quiet>=250)for(const rect of jobs)if(intersects(rect,v)&&!currentFinal(cache.get(cacheKey(rect,size))))plan.push({rect,want:detailLevel(),warm:true});
                  wakeLadder(Math.max(16,(draftOn&&draftReady&&!(warmDue&&quiet<250)?DRAFT_REST:250)-quiet));
                }
              }
            }
          }else wakeLadder(100-quiet);
        }else{
          if(blocks.size){
            // A completed final hides the coarse image, but its immutable F
            // inputs still answer the next drag. Keep only a covering record
            // at this level and within the existing optional cache quota.
            const count=blocks.size;dropBlocks(e=>!(colorInputCurrent(e)&&e.level===4*detailLevel()&&coversView(e,v)));
            if(blocks.size!==count){paintedView=-1;presentView();}
          }
          if(!previewing&&!navigating()&&quiet>=1000)for(const rect of jobs)if(!intersects(rect,v))plan.push({rect,want:detailLevel()});
          else if(quiet<1000)wakeLadder(1000-quiet);
        }
        // Immutable F inputs survive another F edit. Finish this cheap
        // native sweep without a new rAF wait after every input; a partial
        // cache, geometry/Time edit or navigation still replans immediately.
        const canContinueColor=color=>color&&allColor&&lastInput?.stage==='F'&&jobs.every(r=>!intersects(r,v)||colorCurrent(cache.get(cacheKey(r,size))));
        const colorResults=new Map();
        try{for(const [jobIndex,{rect,want,block=false,fineTurn=false,color=false,warm=false}] of plan.entries()){
          if(suspended||(token!==serial&&!canContinueColor(color))||viewToken!==viewEpoch||busy||previewing!==interacting()){rerun=true;break;}
          if((previewing||navigating()||want<1)&&!intersects(rect,v))continue;   // a detail level bakes only what is seen: its ring would evict itself
          if(block){
            const key=blockKey(rect,want),prior=blocks.get(key);if(blockCurrent(prior))continue;
            // Retained weather can answer a shape edit, but cannot answer a new
            // Rain value. Wait for that request instead of baking it repeatedly.
            if(prior&&!prior.dirty&&!changedSince(prior.serial,prior.input,'F',prior.lattice)&&prior.weatherRevB<rev.B&&!api.canExport?.()){wakeLadder(100);continue;}
            // Finish a small coarse refresh even if newer input arrives. Its
            // source revision stays old; the next turn picks up the newest edit.
            const finishOnInput=Boolean(previewLattice&&want>=4&&want===coarseLevel),controller=new AbortController();activeBake={controller,rect,finishOnInput,preview:want>=4};let e;
            try{if(lastInput?.stage==='F'&&colorInputCurrent(prior)){
              const result=await renderer.renderColorTile(prior.color,drawOptions?.()??api.drawOptions?.()??{}),bitmap=new OffscreenCanvas(Math.ceil(rect.width/want),Math.ceil(rect.height/want));bitmap.getContext('2d').drawImage(result.canvas,0,0);e={...prior,bitmap,serial:token,rev:{...rev}};
            }else e=await bake(rect,false,controller.signal,()=>!finishOnInput&&token!==serial||busy||viewToken!==viewEpoch,want,false,true);}
            finally{if(activeBake?.controller===controller)activeBake=null;}
            e.block=true;e.dirty=changedSince(e.serial,e.input,'F',e.lattice);e.bakedAt=performance.now();if(!e.color)await retainColor(e);
            if(want===coarseLevel){fineSinceCoarse=false;}
            if(prior){if(prior.color!==e.color)renderer.releaseColorTile(prior.color);blockBytes-=prior.bytes;}blocks.set(key,e);blockBytes+=e.bytes;
            paintedView=-1;presentView();presented();rerun=true;
            // The gates in this picture have already answered input. Compile
            // their exact final set without holding another preview behind it.
            const state=renderer.specKey();
            if(e.pipelineKey===state.key&&!renderer.specCache.has(state.key)&&!pipelineWaits.has(state.key))watchPipelines(state.key,renderer.specialize(state));
            if(token!==serial||viewToken!==viewEpoch){rerun=true;break;}continue;
          }
          if(warm){
            const controller=new AbortController();activeBake={controller,rect};
            try{await bake(rect,false,controller.signal,()=>token!==serial||busy||viewToken!==viewEpoch||interacting(),want,false,false,true);}
            finally{if(activeBake?.controller===controller)activeBake=null;}
            if(token!==serial||viewToken!==viewEpoch||interacting()){rerun=true;break;}
            if(jobIndex===plan.length-1)warmedSerial=serial;continue;
          }
          if(fineTurn){fineSinceCoarse=true;}
          const key=cacheKey(rect,size);let e=cache.get(key);let baked=false;
          const upgrade=want<=1&&e&&(offLevel(e,want)||!overview&&e.weathered!==weatheredView||!colorCovers(e,v));
          if((!e||e.dirty||upgrade)&&holding&&!overview)continue;
          if(!e||e.dirty||upgrade){
            const controller=new AbortController();activeBake={controller,rect};
            // Scrolling changes the plan, but a tile still in view remains
            // useful. Keep it running instead of restarting on every input.
            try{if(color){
              if(!colorResults.has(key)){
                const colorSerial=serial,colorRev={...rev},batch=plan.slice(jobIndex,jobIndex+4).filter(j=>j.color&&!j.block&&j.want===want).map(j=>({key:cacheKey(j.rect,size),prior:cache.get(cacheKey(j.rect,size))}));
                const result=await renderer.renderColorTiles(batch.map(j=>j.prior.color),drawOptions?.()??api.drawOptions?.()??{},v);
                const snapshots=await Promise.allSettled(result.regions.map(r=>createImageBitmap(result.canvas,r.x,r.y,r.width,r.height,{colorSpaceConversion:'none'})));
                const failure=snapshots.find(s=>s.status==='rejected');if(failure){for(const s of snapshots)if(s.status==='fulfilled')s.value.close();throw failure.reason;}
                const bitmaps=snapshots.map(s=>s.value);
                batch.slice(0,result.regions.length).forEach(({key,prior},i)=>colorResults.set(key,{...prior,bitmap:bitmaps[i],colorRect:result.regions[i].fresh,serial:colorSerial,rev:colorRev,dirty:changedSince(colorSerial,prior.input),pipelineKey:result.pipelineKey}));
              }
              e=colorResults.get(key);colorResults.delete(key);
            }else{e=await bake(rect,false,controller.signal,()=>token!==serial||busy||viewToken!==viewEpoch&&!intersects(rect,state()),want,overview);if(e&&!overview)await retainColor(e);}}
            catch(err){if(want<1&&String(err.message).includes('of GPU memory')){finest=want*2;rerun=true;break;}throw err;}   // fall back to the next coarser level, never the banner
            finally{if(activeBake?.controller===controller)activeBake=null;}
            // Keep the focus source resident while its pipeline finishes.
            // Preparing the rest would evict it before the first final draw.
            if(!e){if(!pipelineWaits.has(renderer.specKey().key))rerun=true;break;}
            baked=true;if(token!==serial){
            // Keep a completed preview even if a newer input touched it. It remains dirty until the latest revision is baked.
            if(e.fed&&changedSince(e.serial,e.input))e.dirty=true;
            if(!e.fed){e.bitmap.close?.();break;}
          }
          // The image it replaces (a quarter one) is dropped now that the final one is in hand.
          const prior=cache.get(key);
          if(prior?.finalCostBudget===gpuBudget&&e.scale===prior.scale&&!changedSince(prior.serial,e.input,'E')){e.finalCostMs??=prior.finalCostMs;e.finalCostBudget??=prior.finalCostBudget;}
          if(prior){if(prior.color!==e.color)renderer.releaseColorTile(prior.color);prior.bitmap.close?.();cacheBytes-=prior.bytes;cache.delete(key);}
          e.bakedAt=performance.now();cache.set(key,e);cacheBytes+=e.bytes;rerun=true;}
          else{hits++;cache.delete(key);cache.set(key,e);if(!e.heightPatch&&!e.fed){const input=await region({...rect,worldSize:config.worldSize??config.size,worldGrid:config.worldGrid??config.grid},drawOptions?.()??api.drawOptions?.()??{},undefined,weatheredView);checkHeap(input);e.heightPatch=keepHeight(input);}}
          if(baked&&lastInput?.stage==='F')fineSinceCoarse=true;
          if(cache.get(key)!==e)break;
          if(!baked)continue;   // The retained tiles were painted together above; only fresh tiles need another presentation.
          const current=state(),currentSize=overview?256*displayLevel():viewChunkSize();
          if(key===cacheKey(rect,currentSize)&&intersects(rect,current)){
            // A completed tile belongs at the latest camera coordinates, even
            // when input moved the view while its fields or image were pending.
            // A complete F sweep has not painted a newer coarse block. Its
            // finished tile can replace this rectangle even if another F edit
            // arrived; geometry/Time results still need stale-image clipping.
            if(paintedView!==viewEpoch||!currentFinal(e)&&!canContinueColor(color)){paintedView=-1;presentView();}
            else{paint(e,current);overlays();}
            presented();
          }
          if((token!==serial&&!canContinueColor(color))||viewToken!==viewEpoch){rerun=true;break;}
          // Each next chunk/color job awaits the preceding GPU completion;
          // snapshots also yield to the browser. An extra timer/task between
          // them only delays the sweep.
        }
        }finally{for(const e of colorResults.values())e.bitmap.close?.();}
        // Generated deposits and vents sit where the export puts them and take their colors from the export art under them
        // (sculpt-features.js): one anchor read or one 128 px patch per idle frame, after the view's own images and only once the
        // weather the export reads is in.
        if(!suspended&&!rerun&&token===serial&&viewToken===viewEpoch&&!previewing&&!navigating()&&!holding&&quiet>=1000&&(!api.canExport||api.canExport())&&await features?.fitGround?.(state()))rerun=true;
      }
      if(!rerun&&!interacting()&&!foregroundPending()&&(!api.canExport||api.canExport()))api.renderProgress?.(null);
      const m=metrics();$('timing').textContent=`Render ${Math.round(performance.now()-renderStart)} ms · ${(m.gpuBytes/MB).toFixed(0)} MiB`;$('timing').title='Wall time for the latest viewport render, including any chunk bakes. '+bakes+' bakes · '+evictions+' cache evictions';
    }catch(err){if(err.name==='PipelinesPending'){
      rerun=true;   // keep previews and canonical page preparation moving during compilation
      watchPipelines(err.key,err.ready);
    }else if(recoverAllocation(err))rerun=true;else if(err.name==='AbortError'||err.name==='PreviewReplan')rerun=true;else{console.error(err);$('error').hidden=false;$('error').textContent=err.message;}}
    finally{if(rendering){drawing=false;if(rerun){rerun=false;schedule();}}}
  }
  function recoverAllocation(error){
    if(!(error instanceof TerrainMemoryError)||!terrainBudget.lower('a GPU allocation failure'))return false;
    renderer.evict();for(const e of cache.values())e.color=null;dropBlocks();previewLattice?.clear();for(const [key,e]of cache)if(!intersects(e,state()))remove(key);
    gpuBudget=terrainBudget.mb*MB;find('[data-gpu]').value=terrainBudget.mb;
    api.fitGpuBudget?.();configureChunks();paintedView=-1;schedule();return true;
  }
  async function recoverMemory(error){
    if(!(error instanceof TerrainMemoryError))return false;
    // Time can fail alongside a useful view bake. Let that submitted work
    // finish before releasing its working textures or changing its budget.
    cancelBake();viewEpoch++;
    while(renderer.busy||drawing)await tick();
    return recoverAllocation(error);
  }
  // H7b: during a gesture a change is answered at once, not at the next animation frame (a pointer move is already one event a frame): the bake of
  // the change's chunks starts as soon as the one in flight ends, and nothing waits for a frame between them.
  let pendingFrame=null;
  function setSuspended(on) {
    if(suspended===on)return;suspended=on;
    if(on){cancelBake();viewEpoch++;clearTimeout(ladderTimer);ladderTimer=null;if(pendingFrame!==null)cancelAnimationFrame(pendingFrame);pendingFrame=null;pending=false;rerun=false;}
    else schedule();
  }
  function schedule() {
    if(suspended)return;
    // Input may have queued a presentation while the last bake was pending.
    // Once it ends, start the latest interactive refresh immediately as well.
    const immediate=levels&&interacting()&&!drawing;
    if(pending&&(!immediate||pendingFrame===null))return;
    if(pendingFrame!==null){cancelAnimationFrame(pendingFrame);pendingFrame=null;}
    pending=true;
    if(immediate)queueMicrotask(frame);
    else pendingFrame=requestAnimationFrame(()=>{pendingFrame=null;frame();});
  }
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
    position();viewEpoch++;lastScroll=performance.now();lastInputAt=performance.now();released=false;schedule();
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
  overlay.addEventListener('pointermove',event=>{const q=screen(event);focus=[q.x,q.z];
    if(pan?.id===event.pointerId){viewport.scrollLeft=pan.left-event.clientX+pan.x;viewport.scrollTop=pan.top-event.clientY+pan.y;navigationChanged();return;}
    if(navigating()&&!gesture)return;
    preview(event);refreshHover(event);if(passability?.active){const p=pickWorld(screen(event));passability.inspect(...p);}if(gesture?.id===event.pointerId)schedule();overlays();
  });
  overlay.addEventListener('pointerleave',()=>{hoveredNode=-1;hover=null;overlays();});
  const end=event=>{if(pan?.id===event.pointerId){pan=null;navigationChanged();}if(gesture?.id===event.pointerId){const commit=event.type==='pointerup';released=commit;if(commit)preview(event,true);const s=gesture;gesture=null;if(s.type==='move')api.endMove(commit);else api.endStroke(commit);released=commit;if(commit)pendingStrokeTime=performance.now();}if(overlay.hasPointerCapture(event.pointerId))overlay.releasePointerCapture(event.pointerId);schedule();};
  for(const name of ['pointerup','pointercancel','lostpointercapture'])overlay.addEventListener(name,end);
  document.addEventListener('keydown',event=>{if(event.code==='Space'&&!['INPUT','TEXTAREA','SELECT'].includes(event.target.tagName)){space=true;event.preventDefault();}if(event.key==='Escape'&&gesture){event.preventDefault();end({pointerId:gesture.id,type:'pointercancel'});}});document.addEventListener('keyup',event=>{if(event.code==='Space')space=false;});
  window.addEventListener('blur',()=>{space=false;pan=null;navigationPointer=null;if(gesture)end({pointerId:gesture.id,type:'pointercancel'});schedule();});
  function budgets(event){if(event?.target===find('[data-gpu]')){terrainBudget.choose(clamp(Number(find('[data-gpu]').value)||terrainBudget.mb,128,4096));const url=new URL(location.href);url.searchParams.set('gpuMB',terrainBudget.mb);history.replaceState(null,'',url);}gpuBudget=terrainBudget.mb*MB;heapBudget=clamp(Number(find('[data-heap]').value)||1024,128,8192)*MB;renderer.trimColorTiles(()=>renderer.colorBytes<=colorReserve());api.setBudget?.(heapBudget*.65);api.fitGpuBudget?.();configureChunks();metrics();schedule();}
  find('[data-gpu]').onchange=budgets;find('[data-heap]').onchange=budgets;
  async function idle(){do{while(drawing||pending||renderer.busy||pipelineWaits.size||navigationTimer||navigating()||api.pendingInputs?.()||ladderTimer&&foregroundPending())await tick();await renderer.previousChunk;}while(drawing||pending||renderer.busy||pipelineWaits.size||navigationTimer||navigating()||api.pendingInputs?.()||ladderTimer&&foregroundPending());}
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
  const invalidate=change=>changed({stage:'A',rect:api.expandDirty?.(change?.rect??null)??change?.rect??null,world:false,channels:[{name:'shape',stage:'A'}]});
  api.subscribeSubmit?.(change=>{if(api.gpuFeedActive?.()){pendingStrokeTime ||= performance.now();invalidate(change);}});
  api.subscribe?.(change=>{pendingStrokeTime ||= performance.now();markCoarse(change?.rect??null);if(!api.gpuFeedActive?.())invalidate(change);});
  function setBusy(on){busy=on;api.setBusy(on);$('weathered-view').disabled=on;find('[data-gpu]').disabled=on;find('[data-heap]').disabled=on;if(!on){if(resizePending)resize();else schedule();}}
  // The export's own numbers for one feature: an anchor cell's four corner bytes, sampled as sampleHeights samples them, and a
  // rectangle of export art. Either answers null when the scene changed while it was read.
  async function exportCorners(x,z){
    const seq=serial,r=await(api.readAsync?api.readAsync({x:x*16,y:z*16,width:16,height:16}):api.read({x:x*16,y:z*16,width:16,height:16}));checkHeap(r);
    if(changedSince(seq,{x:x*16-16,y:z*16-16,width:48,height:48}))return null;
    return [[0,0],[1,0],[0,1],[1,1]].map(([dx,dz])=>Math.round(clamp(sampleField(r,(x+dx)*16,(z+dz)*16),0,255)));
  }
  async function bakeArt(rect){
    const seq=serial,e=await bake(rect,true),tile=new OffscreenCanvas(rect.width,rect.height),c=tile.getContext('2d');c.drawImage(e.bitmap,0,0);e.bitmap.close?.();
    return changedSince(seq,e.input)?null:{data:c.getImageData(0,0,rect.width,rect.height).data,input:e.input};
  }
  features=await mountMapFeatures({config,canvas:overlay,exportCorners,bakeArt,screenPoint:screen,pick:(x,z)=>pickWorld({x,z}),sample:visibleSample,change:()=>{api.mapChanged();schedule();},schedule,enabled:()=>api.ready()&&!busy,
    light:()=>renderer.worldSun,lightColors:()=>({sun:renderer.colorOverrides?.sun||null,sky:renderer.colorOverrides?.sky||null,ambient:renderer.variant?.has('ambient')?Number(renderer.variant.get('ambient')):.42}),groundColor:()=>renderer.means?.ground,deselectShapes:()=>{if(api.selection()>=0)api.select?.(-1);}});api.registerFeatures?.(features);
  metadata=mountMapExport({config,canvas,stream:{sampleHeights,exportChunks,bakeArt},ready:()=>api.ready()&&(!api.canExport||api.canExport())&&!gesture&&!features.busy,revision:()=>api.revision?.()??serial,mapData:api.mapData,features:()=>features,change:()=>{api.mapChanged();},onUpdate:fn=>api.onUpdate?.(fn),busy:setBusy,restore:schedule});api.registerMetadata?.(metadata);
  passability=mountPassability({config,sampleHeightTiles,revision:()=>api.revision?.()??serial,ready:()=>api.ready()&&(!api.canExport||api.canExport())&&!interacting()&&!busy&&!features.busy,mapData:api.mapData,schedule,checkMemory:bytes=>api.checkMemory?.(bytes)});
  // H12: the least the terrain budget must hold besides the fields: the canvases, the bake lattice reserve and one 32 px chunk with the materials.
  // H13: what the paged fields must leave free: the canvas, one canonical chunk's whole working set (every mask layer the world has) and its copy.
  // It was a 32 px chunk's, so the fields took the rest of the budget and the first 512 px bake could not be allocated beside them.
  // The terrain canvas and its overlay share the view's size (resize); the paged fields' budget is the shared one (sculpt-scene.js pagedBudget).
  function colorReserve(){return overview?0:Math.max(0,Math.min(gpuBudget*.4,gpuBudget-512*MB));}
  function minimumBytes({previews=false}={}){
    let previewWorking=finalizing?cacheBytes+blockBytes:0;
    if(previews&&!finalizing&&!overview&&levels&&api.gpuFeedActive?.()){
      const v=state(),width=Math.min(map.width,Math.ceil(v.width/64)*64),height=Math.min(map.height,Math.ceil(v.height/64)*64),options=drawOptions?.()??api.drawOptions?.()??{};
      const request={x:Math.floor((map.width-width)/2),y:Math.floor((map.height-height)/2),width,height,worldSize:config.worldSize??config.size,worldGrid:config.worldGrid??config.grid};
      const sets=(previewLattice?[8,4,2]:[4,2]).map(k=>{const requestLevel={...request,worldGrid:previewGridFor(k*detailLevel(),true)},r=renderer.requiredRegion(requestLevel,options),e=renderer.estimate(r,width,height,api.maskKeys.length,k*detailLevel());
        if(k*detailLevel()>=4)e.source=previewLattice?.plan(r,weatheredView).peakBytes??0;return e;});
      // Distinct shape lattices keep separate inputs; equal lattices share them.
      // The final reserve already has the voxel pool.
      previewWorking=Math.max(...sets.map(e=>e.source??0))+(previewLattice?sets.reduce((n,e)=>n+e.input,0):Math.max(...sets.map(e=>e.input)))+sets.reduce((n,e)=>n+e.field+e.output+e.rockWeather,0)+Math.max(0,...sets.map(e=>e.loose-(renderer.looseBuffer?.size??0)));
    }
    const b=pagedBudget({gpuMB:0,renderer,chunk:canonicalSize,maskCount:api.maskKeys?.length,view:{width:canvas.width,height:canvas.height},preview:previewReserved,featureBytes:features?.stats?.().imageBytes||0,previewWorking:previewWorking+colorReserve()});
    return previews?b.previewMinimum:b.minimum;
  }
  // The current image owns its pixels independently of these working buffers.
  // Reclaim optional workspace before a whole-map Time request overlaps it.
  function prepareTime(bytes){
    if(suspended||drawing||renderer.busy)return false;
    if(gpuResident()+bytes>gpuBudget)renderer.evict();
    if(gpuResident()+bytes>gpuBudget)previewLattice.trim();
    if(gpuResident()+bytes>gpuBudget)previewLattice.clear();
    return true;
  }
  const result={setSuspended,get suspended(){return suspended;},renderer,passability,minimumBytes,prepareTime,foregroundPending,previewWorkPending:()=>Boolean(activeBake?.preview)||draftDue&&performance.now()-lastInputAt<DRAFT_REST,gpuWorkPending:()=>drawing||renderer.busy,prepareBackground:bytes=>{if(suspended||drawing||renderer.busy||foregroundPending())return false;if(gpuResident()+bytes>gpuBudget)renderer.evict();return gpuResident()+bytes<=gpuBudget;},schedule,resize,pick,view:state,stats:metrics,heightSample,sampleHeights,exportChunks,setBusy,features,metadata,changed,dirty:()=>lastInput?structuredClone(lastInput):null,recoverMemory,failNextWorkingAllocation:()=>{renderer.failWorkingAllocation=true;},releaseInput:()=>{released=true;schedule();},blockSnapshot:()=>[...blocks.values()].map(({bitmap,...e})=>e),get serial(){return serial;},get rev(){return {...rev};},zoom,idle,debugBake:async(rect,level=1,exportArt=false)=>{await idle();const e=await bake(rect,exportArt,undefined,null,level);return e.bitmap;},setBudgets:({gpuMB=gpuBudget/MB,heapMB=heapBudget/MB}={})=>{find('[data-gpu]').value=gpuMB;find('[data-heap]').value=heapMB;budgets({target:find('[data-gpu]')});},resetMetrics:()=>{peakGPU=peakHeap=peakAccountedHeap=0;strokeTimes.length=frameTimes.length=0;},get cacheKeys(){return [...cache.keys()];},cacheSnapshot:()=>[...cache].map(([key,e])=>({key,x:e.x,y:e.y,width:e.width,height:e.height,dirty:Boolean(e.dirty||e.weathered&&!(e.weatherRevB>=rev.B)||!colorCovers(e)),colorRect:e.colorRect,serial:e.serial,rev:e.rev,shapeRev:e.shapeRev,weatherRevB:e.weatherRevB,finalCostMs:e.finalCostMs,finalCostBudget:e.finalCostBudget,fit:e.fit,level:e.level,scale:e.scale,input:e.input}))};
  window.sculptCanvas=result;resize();budgets();return result;
}
