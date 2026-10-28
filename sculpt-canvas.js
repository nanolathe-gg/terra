import {TerrainRenderer} from './sculpt-renderer.js';
import {drawMapBounds} from './sculpt-map.js';
import {mountMapExport} from './sculpt-export.js';
import {mountMapFeatures} from './sculpt-features.js';
const $=id=>document.getElementById(id),MB=1024*1024;
const MASKS=['mr','ms','mw','mm','md','ml','mc','mb','mf','mx','my','mz','mg','mk'];
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
  config.gpuBudgetBytes=number(query,'gpuMB',512,128,4096)*MB;
  const output=document.createElement('canvas'),renderer=await TerrainRenderer.createChunked(output,config);
  const g=canvas.getContext('2d'),ink=overlay.getContext('2d'),cache=new Map();
  let gpuBudget=number(query,'gpuMB',512,128,4096)*MB,heapBudget=number(query,'heapMB',1024,128,8192)*MB;
  let cacheBytes=0,peakGPU=0,peakHeap=0,evictions=0,bakes=0,scale=0,overview=true,pending=false,drawing=false,rerun=false,epoch=0,busy=false,features,metadata;
  let pan=null,space=false,gesture=null,hover=null,optionsKey='',saveTimer=null,saving=false,saveAgain=false,lastMetadata='',docId=query.get('document')||'map-'+crypto.randomUUID();
  let maskVersions=new Map(),lastFrame=0,frameTimes=[],strokeTimes=[],coarseRevision=-1;
  const coarse=new OffscreenCanvas(256,256),cg=coarse.getContext('2d'),nav=document.createElement('canvas'); nav.width=nav.height=200;
  const panel=document.createElement('section'); panel.className='section files';
  panel.innerHTML=`<h3>Map view and memory</h3><div class="row"><button data-half>0.5×</button><button data-overview>Overview</button></div><canvas data-nav width="200" height="200" aria-label="Map minimap navigator" style="width:100%;height:auto;margin-top:9px;cursor:crosshair;image-rendering:pixelated"></canvas><label class="control" style="display:block">Terrain GPU budget (MiB)<input data-gpu type="number" min="128" max="4096" step="128" value="${gpuBudget/MB}"></label><label class="control" style="display:block">Page heap budget (MiB)<input data-heap type="number" min="128" max="8192" step="128" value="${heapBudget/MB}"></label><p class="small" data-memory></p><label class="control" style="display:block">Server document<input data-document value="${docId}"></label><div class="row"><button data-save>Save to server</button><button data-load>Reload document</button></div><p class="small" data-save-state>Changes save incrementally on this local server.</p>`;
  document.querySelector('aside').append(panel);
  const find=s=>panel.querySelector(s),navigatorCanvas=find('[data-nav]'),ng=navigatorCanvas.getContext('2d');
  function state() { return {x:viewport.scrollLeft/(scale||1),y:viewport.scrollTop/(scale||1),width:canvas.width/(scale||1),height:canvas.height/(scale||1),scale,overview}; }
  function gpuResident() { const s=renderer.stats(); return (s.residentBytes??s.gpuBytes??s.bytes??0)+cacheBytes+(canvas.width*canvas.height+overlay.width*overlay.height)*4+coarse.width*coarse.height*4+navigatorCanvas.width*navigatorCanvas.height*4+(features?.stats?.().imageBytes||0); }
  const originalKnobs=renderer.applyKnobs.bind(renderer),originalColors=renderer.setColors.bind(renderer);
  renderer.applyKnobs=(...args)=>{const r=originalKnobs(...args);clear();return r;};
  renderer.setColors=(...args)=>{const r=originalColors(...args);clear();return r;};
  function metrics() {
    const heap=performance.memory?.usedJSHeapSize??api.stats?.().residentBytes??0,gpu=gpuResident(); peakGPU=Math.max(peakGPU,gpu); peakHeap=Math.max(peakHeap,heap);
    find('[data-memory]').textContent=`Terrain ${(gpu/MB).toFixed(1)} / ${gpuBudget/MB} MiB · heap ${(heap/MB).toFixed(1)} / ${heapBudget/MB} MiB · ${cache.size} cached chunks · ${evictions} evictions`;
    return {gpuBytes:gpu,peakGPUBytes:peakGPU,heapBytes:heap,peakHeapBytes:peakHeap,cacheBytes,cachedChunks:cache.size,evictions,bakes,field:api.stats?.(),renderer:renderer.stats(),strokeMilliseconds:strokeTimes.slice(-100),frameMilliseconds:frameTimes.slice(-100)};
  }
  function remove(key) { const e=cache.get(key); if (!e) return; e.bitmap.close?.(); cacheBytes-=e.bytes; cache.delete(key); evictions++; }
  function clear(rect=null) { epoch++; for (const [key,e] of cache) if (!rect || intersects(rect,e)) remove(key); coarseRevision=-1; schedule(); }
  function trim(reserve=0) { for (const key of cache.keys()) { if (gpuResident()+reserve<=gpuBudget) break; remove(key); } if (gpuResident()+reserve>gpuBudget) throw new Error('Terrain GPU budget cannot hold this chunk and its apron. Reduce the chunk size or raise the budget.'); }
  function region(request,options) {
    const required=renderer.requiredRegion(request,options),r=api.read(required);
    if (r instanceof Promise) throw new Error('Regional replay must finish before a chunk is baked.');
    return {...request,...r,fields:r.fields,material:r.materialField??r.material,gridOrigin:r.gridOrigin,gridSpacing:r.gridSpacing,gridWidth:r.gridWidth,gridHeight:r.gridHeight,worldSize:config.worldSize??config.size,worldGrid:config.worldGrid??config.grid};
  }
  function chunkSize() { return Math.max(32,Math.min(512,renderer.recommendedChunkSize||512))&~31; }
  async function bake(rect,exportArt=false) {
    const options=drawOptions?.()??api.drawOptions?.()??{},request={...rect,exportArt,worldSize:config.worldSize??config.size,worldGrid:config.worldGrid??config.grid};
    const fields=region(request,options),estimate=fields.bytes??Object.values(fields.fields).filter(a=>ArrayBuffer.isView(a)).reduce((sum,a)=>sum+a.byteLength,0);
    const used=performance.memory?.usedJSHeapSize??api.stats?.().residentBytes??0;
    if (used+estimate>heapBudget) { api.evict?.(); if ((performance.memory?.usedJSHeapSize??0)+estimate>heapBudget) throw new Error('Regional replay would exceed the page heap budget. Reduce the connected stroke region or raise the budget.'); }
    trim(rect.width*rect.height*4);
    const result=await renderer.renderChunk(fields,{...options,quality:'full'}); bakes++;
    const bitmap=await createImageBitmap(result.canvas,0,0,rect.width,rect.height,{colorSpaceConversion:'none'});
    const entry={...rect,bitmap,bytes:rect.width*rect.height*4}; metrics(); return entry;
  }
  function drawCoarse() {
    const rev=api.revision?.()??epoch;
    if (coarseRevision!==rev) {
      const image=cg.createImageData(256,256),base=config.baseHeight,sea=config.seaLevel,mean=renderer.means?.ground||[.2,.3,.15];
      for (let y=0;y<256;y++) for (let x=0;x<256;x++) {
        const h=api.sample(x/255*(map.width-1),y/255*(map.height-1)),i=(y*256+x)*4,wet=h<sea,shade=clamp(.8+(h-base)*.005,.3,1.5),water=config.water?.shallowRGB||[42,87,130];
        for (let c=0;c<3;c++) image.data[i+c]=wet?water[c]:mean[c]*255*shade; image.data[i+3]=255;
      }
      cg.putImageData(image,0,0); coarseRevision=rev;
    }
    const v=state(); g.imageSmoothingEnabled=false; g.drawImage(coarse,v.x/map.width*256,v.y/map.height*256,v.width/map.width*256,v.height/map.height*256,0,0,canvas.width,canvas.height);
    ng.imageSmoothingEnabled=false; ng.drawImage(coarse,0,0,navigatorCanvas.width,navigatorCanvas.height); ng.strokeStyle='#fff0a0'; ng.lineWidth=1; ng.strokeRect(v.x/map.width*200+.5,v.y/map.height*200+.5,Math.min(200,v.width/map.width*200),Math.min(200,v.height/map.height*200));
  }
  function overlays() {
    const v=state(); ink.setTransform(1,0,0,1,0,0); ink.clearRect(0,0,overlay.width,overlay.height); ink.save(); ink.scale(scale,scale); ink.translate(-v.x,-v.y);
    drawMapBounds(ink,map,config,api.sample); features?.draw(ink,v); api.drawOverlay?.(ink,v);
    if (hover && !features?.active) { ink.strokeStyle='#b8eef3'; ink.lineWidth=1/scale; ink.beginPath(); ink.arc(hover[0],hover[1]-(Math.max(config.seaLevel,api.sample(...hover))-config.baseHeight)/2,Number($('diameter').value)/2,0,Math.PI*2); ink.stroke(); }
    ink.restore();
  }
  async function frame() {
    pending=false; if (drawing) { rerun=true; return; } drawing=true;
    const now=performance.now(); if (lastFrame) frameTimes.push(now-lastFrame); lastFrame=now;
    try {
      const key=JSON.stringify(drawOptions?.()??api.drawOptions?.()??{});if(optionsKey && optionsKey!==key)clear();optionsKey=key;
      drawCoarse(); overlays();
      if (!overview && !busy) {
        const size=chunkSize(),v=state(),jobs=[];
        for (let y=Math.max(0,Math.floor(v.y/size)-1)*size;y<Math.min(map.height,v.y+v.height+size);y+=size) for (let x=Math.max(0,Math.floor(v.x/size)-1)*size;x<Math.min(map.width,v.x+v.width+size);x+=size) jobs.push({x,y,width:Math.min(size,map.width-x),height:Math.min(size,map.height-y)});
        // Work nearest the viewport centre first; one-chunk margin is still baked.
        jobs.sort((a,b)=>Math.hypot(a.x-v.x-v.width/2,a.y-v.y-v.height/2)-Math.hypot(b.x-v.x-v.width/2,b.y-v.y-v.height/2));
        const token=epoch;
        for (const rect of jobs) {
          if (token!==epoch || busy) break;
          const key=rect.x+','+rect.y; let e=cache.get(key);
          if (!e) { e=await bake(rect); if (token!==epoch) { e.bitmap.close?.(); break; } cache.set(key,e); cacheBytes+=e.bytes; trim(); }
          else { cache.delete(key); cache.set(key,e); }
          g.imageSmoothingEnabled=false; g.drawImage(e.bitmap,(e.x-v.x)*scale,(e.y-v.y)*scale,e.width*scale,e.height*scale); overlays();
          await tick();
        }
      }
      const m=metrics(); $('timing').textContent=`${bakes} chunk bakes · ${(m.gpuBytes/MB).toFixed(1)} MiB terrain · ${evictions} evictions`;
    } catch (err) { $('error').hidden=false; $('error').textContent=err.message; }
    finally { drawing=false; if (rerun) { rerun=false; schedule(); } }
  }
  function schedule() { if (!pending) { pending=true; requestAnimationFrame(frame); } }
  function resize() {
    if (overview) scale=Math.min((viewport.clientWidth-28)/map.width,(viewport.clientHeight-28)/map.height);
    stage.style.width=map.width*scale+'px'; stage.style.height=map.height*scale+'px'; stage.style.margin=overview?'auto':'0'; stage.style.overflow='visible';
    const width=Math.max(1,Math.min(viewport.clientWidth,Math.ceil(map.width*scale))),height=Math.max(1,Math.min(viewport.clientHeight,Math.ceil(map.height*scale)));
    for (const c of [canvas,overlay]) { c.width=width; c.height=height; c.style.width=width+'px'; c.style.height=height+'px'; c.style.inset='auto'; }
    position(); schedule();
  }
  function position() { for (const c of [canvas,overlay]) { c.style.left=viewport.scrollLeft+'px'; c.style.top=viewport.scrollTop+'px'; } }
  function zoom(next) { $('fit').setAttribute('aria-pressed',String(next==='overview'));$('one').setAttribute('aria-pressed',String(next===1));find('[data-half]').setAttribute('aria-pressed',String(next===.5));find('[data-overview]').setAttribute('aria-pressed',String(next==='overview'));const v=state(),cx=v.x+v.width/2,cy=v.y+v.height/2; overview=next==='overview'; if (!overview) scale=next; resize(); viewport.scrollLeft=Math.max(0,cx*scale-canvas.width/2); viewport.scrollTop=Math.max(0,cy*scale-canvas.height/2); position(); schedule(); }
  $('fit').onclick=()=>zoom('overview'); $('one').onclick=()=>zoom(1); find('[data-half]').onclick=()=>zoom(.5); find('[data-overview]').onclick=()=>zoom('overview');
  viewport.addEventListener('scroll',()=>{position();schedule();},{passive:true}); new ResizeObserver(resize).observe(viewport);
  function screen(event) { const r=overlay.getBoundingClientRect(),v=state(); return {x:v.x+(event.clientX-r.left)/scale,z:v.y+(event.clientY-r.top)/scale}; }
  function pick(cx,cy) {
    const v=state(),x=clamp(v.x+cx/scale,0,map.width-1),sy=v.y+cy/scale;
    let previousY=sy+170,previous=previousY-(Math.max(config.seaLevel,api.sample(x,previousY))-config.baseHeight)/2-sy;
    for (let y=previousY-2;y>=sy-80;y-=2) { const value=y-(Math.max(config.seaLevel,api.sample(x,y))-config.baseHeight)/2-sy; if (value<=0 && previous>=0) return [x,clamp(previousY-2*previous/Math.max(1e-6,previous-value),0,map.height-1)]; previous=value; previousY=y; }
    return [x,clamp(sy,0,map.height-1)];
  }
  function pickWorld(p) { const v=state(); return pick((p.x-v.x)*scale,(p.z-v.y)*scale); }
  navigatorCanvas.onpointerdown=event=>{const r=navigatorCanvas.getBoundingClientRect(); if (overview) zoom(1); viewport.scrollLeft=(event.clientX-r.left)/r.width*map.width*scale-canvas.width/2; viewport.scrollTop=(event.clientY-r.top)/r.height*map.height*scale-canvas.height/2;position();schedule();};
  overlay.addEventListener('pointerdown',event=>{
    if (event.button!==0 && event.button!==1 || busy || !api.ready()) return;
    event.preventDefault(); overlay.focus({preventScroll:true}); overlay.setPointerCapture(event.pointerId);
    if (space || event.button===1) pan={id:event.pointerId,x:event.clientX,y:event.clientY,left:viewport.scrollLeft,top:viewport.scrollTop};
    else if (!features?.active) { const p=pickWorld(screen(event)); if (api.currentTool()==='move') api.selectAt?.({x:p[0],y:p[1]}); else gesture={id:event.pointerId,kind:api.currentTool(),points:[{x:p[0],y:p[1]}],options:api.strokeOptions(),start:performance.now()}; }
  });
  overlay.addEventListener('pointermove',event=>{if (pan?.id===event.pointerId) {viewport.scrollLeft=pan.left-event.clientX+pan.x;viewport.scrollTop=pan.top-event.clientY+pan.y;position();schedule();return;} hover=pickWorld(screen(event)); if (gesture?.id===event.pointerId && Math.hypot(hover[0]-gesture.points.at(-1).x,hover[1]-gesture.points.at(-1).y)>3) gesture.points.push({x:hover[0],y:hover[1]});overlays();});
  const end=event=>{if (pan?.id===event.pointerId) pan=null; if (gesture?.id===event.pointerId) {const s=gesture;gesture=null;if(event.type==='pointerup'){api.applyStroke(s.kind,s.points,s.options);strokeTimes.push(performance.now()-s.start);}}if(overlay.hasPointerCapture(event.pointerId))overlay.releasePointerCapture(event.pointerId);schedule();};
  for (const name of ['pointerup','pointercancel','lostpointercapture']) overlay.addEventListener(name,end);
  document.addEventListener('keydown',event=>{if(event.code==='Space'&&!['INPUT','TEXTAREA','SELECT'].includes(event.target.tagName)){space=true;event.preventDefault();}});document.addEventListener('keyup',event=>{if(event.code==='Space')space=false;});
  function budgets() { gpuBudget=clamp(Number(find('[data-gpu]').value)||512,128,4096)*MB;heapBudget=clamp(Number(find('[data-heap]').value)||1024,128,8192)*MB;renderer.setBudget?.(gpuBudget);api.setBudget?.(heapBudget);trim();schedule(); }
  find('[data-gpu]').onchange=budgets;find('[data-heap]').onchange=budgets;
  async function sampleHeights(signal) {
    const heights=new Uint8Array(map.widthCells*map.heightCells);let clipped=0;
    // Sampling one row at a time lets sparse replay reuse its current field chunk.
    for(let y=0;y<map.heightCells;y++){signal?.throwIfAborted();for(let x=0;x<map.widthCells;x++){const h=api.sample(x*16,y*16);if(h<0||h>255)clipped++;heights[y*map.widthCells+x]=Math.round(clamp(h,0,255));}if((y&15)===15)await tick();}
    return {heights,clipped};
  }
  async function exportChunks(accept,signal) {
    const size=chunkSize(),total=Math.ceil(map.width/size)*Math.ceil(map.height/size);let index=0;
    // Export borrows the same bounded working textures; visible cache entries may
    // be evicted, and the next screen draw rebuilds them from the graph.
    for(let y=0;y<map.height;y+=size)for(let x=0;x<map.width;x+=size){signal?.throwIfAborted();const rect={x,y,width:Math.min(size,map.width-x),height:Math.min(size,map.height-y)},entry=await bake(rect,true),tile=new OffscreenCanvas(rect.width,rect.height);tile.getContext('2d').drawImage(entry.bitmap,0,0);entry.bitmap.close?.();const png=await tile.convertToBlob({type:'image/png'});await accept({...rect,png},index++,total);}
  }
  async function saveDocument() {
    if(saving){saveAgain=true;return;}saving=true;
    try {
      const id=find('[data-document]').value.trim();if(!/^[A-Za-z0-9_-]{1,100}$/.test(id))throw new Error('Use letters, numbers, hyphens and underscores for the document name.');docId=id;
      const sketch=api.sketch(),body={format:'nanolathe-map-document',version:1,sketch,mapData:api.mapData(),map,biome:config.biomeId,seaLevel:config.seaLevel};
      const chunks=api.maskChunks?.()||[];for(const chunk of chunks){const header=new TextEncoder().encode(JSON.stringify({rect:chunk.rect,gridWidth:chunk.gridWidth,gridHeight:chunk.gridHeight,gridOrigin:chunk.gridOrigin,gridSpacing:chunk.gridSpacing,keys:MASKS})),planes=chunk.planes||[],bytes=new Uint8Array(4+header.length+planes.reduce((sum,a)=>sum+a.byteLength,0));new DataView(bytes.buffer).setUint32(0,header.length,true);bytes.set(header,4);let offset=4+header.length;for(const plane of planes){bytes.set(new Uint8Array(plane.buffer,plane.byteOffset,plane.byteLength),offset);offset+=plane.byteLength;}const version=hash(bytes);if(maskVersions.get(chunk.key)===version)continue;await json('/map-document/chunk?'+new URLSearchParams({id:docId,key:chunk.key}),{method:'PUT',headers:{'Content-Type':'application/octet-stream'},body:bytes});maskVersions.set(chunk.key,version);}
      const encoded=JSON.stringify(body);if(encoded!==lastMetadata){await json('/map-document?'+new URLSearchParams({id:docId}),{method:'PUT',headers:{'Content-Type':'application/json'},body:encoded});lastMetadata=encoded;}
      find('[data-save-state]').textContent='Saved to server · '+docId;
    }catch(err){find('[data-save-state]').textContent=err.message;throw err;}finally{saving=false;if(saveAgain){saveAgain=false;queueSave();}}
  }
  async function loadDocument() {
    const id=find('[data-document]').value.trim(),data=await json('/map-document?'+new URLSearchParams({id}));
    const documentData=data.document??data.metadata??data;
    if(documentData.biome!==config.biomeId||documentData.map?.unitsX!==map.unitsX||documentData.map?.unitsY!==map.unitsY||documentData.seaLevel!==config.seaLevel)throw new Error('Open a canvas with the document’s world, dimensions and sea level before loading it.');
    await api.loadSketch(documentData.sketch);api.restoreMapData(documentData.mapData);docId=id;lastMetadata=JSON.stringify(documentData);maskVersions.clear();clear();find('[data-save-state]').textContent='Reloaded server document · '+id;
  }
  function queueSave(){clearTimeout(saveTimer);saveTimer=setTimeout(()=>saveDocument().catch(()=>{}),700);}
  find('[data-save]').onclick=()=>saveDocument().catch(()=>{});find('[data-load]').onclick=()=>loadDocument().catch(err=>{find('[data-save-state]').textContent=err.message;});
  api.subscribe?.(change=>{clear(change?.rect??null);queueSave();});
  function setBusy(on){busy=on;api.setBusy(on);find('[data-gpu]').disabled=on;find('[data-heap]').disabled=on;find('[data-load]').disabled=on;if(!on)schedule();}
  features=await mountMapFeatures({config,host:document.querySelector('aside'),canvas:overlay,screenPoint:screen,pick:(x,z)=>pickWorld({x,z}),sample:api.sample,change:()=>{api.mapChanged();queueSave();schedule();},schedule,enabled:()=>api.ready()&&!busy});api.registerFeatures?.(features);
  metadata=mountMapExport({config,canvas,stream:{sampleHeights,exportChunks},ready:()=>api.ready()&&(!api.canExport||api.canExport())&&!gesture&&!features.busy,revision:()=>api.revision?.()??epoch,mapData:api.mapData,features:()=>features,change:()=>{api.mapChanged();queueSave();},onUpdate:fn=>api.onUpdate?.(fn),busy:setBusy,restore:schedule});api.registerMetadata?.(metadata);
  const result={renderer,schedule,resize,pick,view:state,stats:metrics,sampleHeights,exportChunks,saveDocument,loadDocument,setBusy,features,metadata,invalidate:clear,zoom,async idle(){while(drawing||pending)await tick();}};
  window.sculptCanvas=result;resize();budgets();return result;
}
