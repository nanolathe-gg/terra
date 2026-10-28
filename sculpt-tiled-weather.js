import {quickMaterialField} from './sculpt-material-weathering.js';

// Large-map authoring policy. Keep the original whole-field worker for every
// worldGrid <= 1168; forceTiled exists only for the global/tiled comparison.
export const GLOBAL_WEATHER_GRID_LIMIT=1168;
export const tiledWeatherEnabled=(worldGrid,forceTiled=false) => worldGrid>GLOBAL_WEATHER_GRID_LIMIT || forceTiled;
const clamp=(v,a,b) => Math.max(a,Math.min(b,v));
const smooth=v => { const t=clamp(v,0,1); return t*t*(3-2*t); };
const overlap=(a,b) => a.x0<=b.x1 && b.x0<=a.x1 && a.y0<=b.y1 && b.y0<=a.y1;
const abortError=() => new DOMException('Weathering request was cancelled.','AbortError');

// One existing solver worker, never parallel replay. The fixed layout is 256
// lattice intervals per core (about 512 world pixels), a 64-interval output
// overlap, then a further 128-interval solver apron: 641 samples per solve.
// Neither geometry nor seeds depend on renderer chunks, requests or budgets.
export function createTiledWeather({read:readAuthored,worldSize,worldGrid,params={},budget=256*1048576,onProgress,onChange,
  forceTiled=false,workerFactory=() => new Worker(new URL('./sculpt-weathering.js',import.meta.url),{type:'module'})}) {
  if (typeof readAuthored!=='function' || !Number.isInteger(worldGrid) || worldGrid<2 || !(worldSize>1)) throw new Error('Invalid tiled weather lattice.');
  if (!tiledWeatherEnabled(worldGrid,forceTiled)) throw new Error('This map uses the existing global weather solver; forceTiled is a comparison diagnostic.');
  const core=256,blend=64,apron=128,solverGrid=core+2*(blend+apron)+1,spacing=(worldSize-1)/(worldGrid-1);
  const columns=Math.ceil((worldGrid-1)/core),cache=new Map();
  // Conservative reservation for the existing worker's solver, sand/material
  // work planes and transferred snapshots. A request also reserves its output.
  const solverWorkBytes=solverGrid*solverGrid*256;
  let settings=structuredClone(params),revision=0,worker=null,active=null,job=0,disposed=false,tail=Promise.resolve();
  let cacheBytes=0,inflightBytes=0,peakBytes=0,peakWorkBytes=0,hits=0,misses=0,evictions=0,solves=0,uniformSkips=0;
  let completed=0,lastMilliseconds=0;
  function reserve(bytes) {
    inflightBytes=bytes;
    evict(Math.max(0,budget-bytes));
    if (bytes>budget) throw new Error(`Tiled weather needs about ${Math.ceil(bytes/1048576)} MB of JS working memory; its budget is ${Math.floor(budget/1048576)} MB. Use a smaller requested region or increase the JS budget.`);
    peakWorkBytes=Math.max(peakWorkBytes,bytes); peakBytes=Math.max(peakBytes,bytes+cacheBytes);
  }
  function evict(limit=Math.max(0,budget-inflightBytes)) {
    while (cacheBytes>limit && cache.size) { const key=cache.keys().next().value; cacheBytes-=cache.get(key).bytes; cache.delete(key); evictions++; }
  }
  function current(rev,signal) { if (disposed || revision!==rev || signal?.aborted) throw abortError(); }
  function cells({x=0,y=0,width=0,height=width,apron:extra=0}={}) {
    if (![x,y,width,height,extra].every(Number.isFinite) || width<0 || height<0 || extra<0) throw new Error('Invalid weather region.');
    return {x0:clamp(Math.floor((x-extra)/spacing),0,worldGrid-1),y0:clamp(Math.floor((y-extra)/spacing),0,worldGrid-1),
      x1:clamp(Math.ceil((x+width+extra)/spacing),0,worldGrid-1),y1:clamp(Math.ceil((y+height+extra)/spacing),0,worldGrid-1)};
  }
  const worldRect=r => ({x:r.x0*spacing,y:r.y0*spacing,width:(r.x1-r.x0)*spacing,height:(r.y1-r.y0)*spacing});
  function tileRect(x,y,extra) { return {x0:x*core-extra,y0:y*core-extra,x1:(x+1)*core+extra,y1:(y+1)*core+extra}; }
  function clipped(r) { return {x0:clamp(r.x0,0,worldGrid-1),y0:clamp(r.y0,0,worldGrid-1),x1:clamp(r.x1,0,worldGrid-1),y1:clamp(r.y1,0,worldGrid-1)}; }
  function tiles(r) {
    const list=[],x0=clamp(Math.floor((r.x0-blend)/core),0,columns-1),x1=clamp(Math.floor((r.x1+blend)/core),0,columns-1);
    const y0=clamp(Math.floor((r.y0-blend)/core),0,columns-1),y1=clamp(Math.floor((r.y1+blend)/core),0,columns-1);
    // This order also defines floating-point accumulation at shared samples.
    for (let y=y0;y<=y1;y++) for (let x=x0;x<=x1;x++) if (overlap(r,tileRect(x,y,blend))) list.push({x,y,key:`${x},${y}`});
    return list;
  }
  function requiredRect(request) {
    const r=cells(request),list=tiles(r),samples=(r.x1-r.x0+1)*(r.y1-r.y0+1);
    return {rect:worldRect(r),cells:r,tiles:list.map(t => ({...t,output:worldRect(clipped(tileRect(t.x,t.y,blend))),input:worldRect(clipped(tileRect(t.x,t.y,blend+apron)))})),
      tileCount:list.length,gridWidth:r.x1-r.x0+1,gridHeight:r.y1-r.y0+1,solverGrid,solverWorkBytes,outputWorkBytes:samples*44};
  }
  function axisWeight(v,t) {
    const start=t*core,end=start+core;
    return v<start?smooth((v-(start-blend))/blend):v>end?smooth((end+blend-v)/blend):1;
  }
  // Fixed coordinate hash, followed by two avalanche multiplies. Zero is
  // allowed here: the unchanged solver has its own zero-state avoidance.
  function tileSeed(x,y) {
    let n=((Number.isFinite(settings.seed)?settings.seed:1)>>>0)^Math.imul(x+1,0x9e3779b1)^Math.imul(y+1,0x85ebca77)^0x51ed270b;
    n=Math.imul(n^(n>>>16),0x7feb352d); n=Math.imul(n^(n>>>15),0x846ca68b); return (n^(n>>>16))>>>0;
  }
  function stopWorker() { if (worker) worker.terminate(); worker=null; }
  function cancelActive() { const previous=active; active=null; stopWorker(); previous?.reject(abortError()); }
  function solve(request,rev,signal,progress) {
    current(rev,signal);
    return new Promise((resolve,reject) => {
      const id=++job,abort=() => { if (active?.job===id) cancelActive(); };
      const clean=() => signal?.removeEventListener('abort',abort);
      active={job:id,resolve:data => { clean(); resolve(data); },reject:error => { clean(); reject(error); }};
      try {
        if (!worker) {
          worker=workerFactory(); const instance=worker;
          instance.onmessage=event => {
            if (worker!==instance) return;
            const data=event.data,a=active;
            if (!a || data?.job!==a.job) return;
            if (data.done) { active=null; a.resolve(data); }
            else try { a.progress?.(data.progress); } catch (error) { active=null; stopWorker(); a.reject(error); }
          };
          instance.onerror=event => { if (worker!==instance) return; const a=active; active=null; stopWorker(); a?.reject(new Error(event.message||'Weather worker failed.')); };
        }
        active.progress=progress; signal?.addEventListener('abort',abort,{once:true});
        // These are fresh tile snapshots, never authored/cache buffers.
        worker.postMessage({...request,job:id},[request.height.buffer,request.protect.buffer]);
      } catch (error) { const a=active; active=null; stopWorker(); a?.reject(error); }
    });
  }
  function crop(input,channels,from,to) {
    if (!input) return null;
    const width=to.x1-to.x0+1,height=to.y1-to.y0+1,out=new Float32Array(width*height*channels);
    for (let y=0;y<height;y++) { const i=((to.y0-from.y0+y)*solverGrid+to.x0-from.x0)*channels; out.set(input.subarray(i,i+width*channels),y*width*channels); }
    return out;
  }
  function authoredRegion(source,rect) {
    const sw=source.gridWidth,sh=source.gridHeight,ox=Math.round(source.gridOrigin?.[0]/spacing),oy=Math.round(source.gridOrigin?.[1]/spacing);
    const width=rect.x1-rect.x0+1,height=rect.y1-rect.y0+1;
    if (!(source.fields?.h instanceof Float32Array) || !(sw>0 && sh>0) || ox>rect.x0 || oy>rect.y0 || ox+sw-1<rect.x1 || oy+sh-1<rect.y1) throw new Error('Tiled weather requires covering authored regional Float32 heights.');
    if (ox===rect.x0 && oy===rect.y0 && sw===width && sh===height) return source;
    // Multiplying a canonical index by spacing and dividing again can round
    // just beyond an integer. Accept the reader's extra boundary, then crop.
    const fields={},byPlane=new Map();
    for (const [key,input] of Object.entries(source.fields)) {
      const output=new input.constructor(width*height);
      for (let y=0;y<height;y++) { const start=(rect.y0-oy+y)*sw+rect.x0-ox; output.set(input.subarray(start,start+width),y*width); }
      fields[key]=output; byPlane.set(input,output);
    }
    const before=Object.values(source.fields).reduce((n,a) => n+a.byteLength,0),after=Object.values(fields).reduce((n,a) => n+a.byteLength,0);
    return {...source,fields,maskPlanes:source.maskPlanes?.map(a => byPlane.get(a)),gridWidth:width,gridHeight:height,gridOrigin:[rect.x0*spacing,rect.y0*spacing],rect:worldRect(rect),bytes:(source.bytes??before)-before+after};
  }
  function uniformResult(request) {
    const h=request.height[0];
    for (let i=0;i<request.height.length;i++) if (request.height[i]!==h) return null;
    const sea=request.seaLevel??0,relative=Math.fround(h-sea);
    if (!Number.isFinite(relative) || relative< -90 || relative>300) return null;
    let materialField=null;
    if (request.materialWeathering>0) {
      const height=request.height.map(v => v-sea);
      materialField=quickMaterialField({...request,height,baseHeight:request.baseHeight-sea,seaLevel:0});
      // Only a source-free constant plane has no material arrivals/runoff.
      // Its fine-ground channel still contains the existing seeded clusters.
      for (let i=3;i<materialField.length;i+=4) if (materialField[i]!==0) return null;
    }
    // The whole solver works at sea zero and restores sea into Float32 output.
    return {uniformBase:h,uniformDelta:Math.fround(Math.fround(relative+sea)-h),materialField};
  }
  async function tile(t,rev,signal,progress,outputBytes=0) {
    current(rev,signal);
    if (cache.has(t.key)) { const found=cache.get(t.key); cache.delete(t.key); cache.set(t.key,found); hits++; return found; }
    misses++; reserve(outputBytes+solverWorkBytes);
    const input=tileRect(t.x,t.y,blend+apron),rect=clipped(tileRect(t.x,t.y,blend));
    const source=authoredRegion(await readAuthored(worldRect(clipped(input)),signal),clipped(input)); current(rev,signal);
    const width=source.gridWidth,ox=Math.round(source.gridOrigin[0]/spacing),oy=Math.round(source.gridOrigin[1]/spacing);
    if (!(source.fields?.h instanceof Float32Array) || !width || !source.gridHeight) throw new Error('Tiled weather requires authored regional Float32 heights.');
    const height=new Float32Array(solverGrid*solverGrid),protect=new Float32Array(height.length);
    for (let y=0;y<solverGrid;y++) for (let x=0;x<solverGrid;x++) {
      const sx=clamp(input.x0+x,0,worldGrid-1)-ox,sy=clamp(input.y0+y,0,worldGrid-1)-oy,i=sy*width+sx,j=y*solverGrid+x;
      height[j]=source.fields.h[i]; protect[j]=source.fields.p?.[i]??0;
      if (!Number.isFinite(height[j]) || !Number.isFinite(protect[j])) throw new Error('Weathering requires finite authored height and protection.');
    }
    const request={...settings,height,protect,grid:solverGrid,size:(solverGrid-1)*spacing+1,seed:tileSeed(t.x,t.y)};
    const started=performance.now(),uniform=uniformResult(request);
    let result;
    if (uniform) {
      uniformSkips++;
      result={...uniform,materialField:crop(uniform.materialField,4,input,rect)};
    } else {
      const base=crop(height,1,input,rect),data=await solve(request,rev,signal,progress); current(rev,signal);
      for (const k of ['height','flow','deposit','talus']) if (!(data[k] instanceof Float32Array) || data[k].length!==solverGrid*solverGrid) throw new Error('Weather worker returned an invalid tile.');
      const delta=crop(data.height,1,input,rect);
      for (let i=0;i<delta.length;i++) delta[i]-=base[i];
      result={base,delta,flow:crop(data.flow,1,input,rect),deposit:crop(data.deposit,1,input,rect),talus:crop(data.talus,1,input,rect),
        sand:crop(data.sand,1,input,rect),materialField:crop(data.materialField,4,input,rect)};
      solves++;
    }
    // The existing presentation excludes authored routes from height deltas
    // after weathering. Keep that final mask as well as worker protection.
    if (source.fields.r) {
      const route=new Float32Array((rect.x1-rect.x0+1)*(rect.y1-rect.y0+1)); let nonzero=false;
      for (let y=rect.y0;y<=rect.y1;y++) for (let x=rect.x0;x<=rect.x1;x++) { const v=source.fields.r[(y-oy)*width+x-ox]; route[(y-rect.y0)*(rect.x1-rect.x0+1)+x-rect.x0]=v; if (v!==0) nonzero=true; }
      if (nonzero) result.route=route;
    }
    current(rev,signal); completed++; lastMilliseconds=performance.now()-started;
    result={...result,...t,rect,input,gridWidth:rect.x1-rect.x0+1,revision};
    result.bytes=256+Object.values(result).reduce((n,a) => n+(ArrayBuffer.isView(a)?a.byteLength:0),0);
    reserve(outputBytes); evict(Math.max(0,budget-inflightBytes-result.bytes));
    if (result.bytes+inflightBytes<=budget) { cache.set(t.key,result); cacheBytes+=result.bytes; peakBytes=Math.max(peakBytes,inflightBytes+cacheBytes); }
    onChange?.({revision,rect:worldRect(rect),tile:{x:t.x,y:t.y},ready:true});
    return result;
  }
  function enqueue(fn,signal) {
    const rev=revision,run=tail.then(() => { current(rev,signal); return fn(rev,signal); });
    tail=run.catch(() => {});
    // Reject a waiting request promptly too; the queued task checks the signal
    // before it can allocate or start a worker after an earlier read finishes.
    if (!signal) return run;
    return new Promise((resolve,reject) => {
      const abort=() => reject(abortError()); signal.addEventListener('abort',abort,{once:true});
      run.then(resolve,reject).finally(() => signal.removeEventListener('abort',abort));
      if (signal.aborted) abort();
    });
  }
  const signalOf=value => value?.signal??value;
  function progress(t,index,total,value=1) { onProgress?.({revision,progress:(index+value)/total,tile:{x:t.x,y:t.y},completed:index,total}); }
  function prepare(request,signal) {
    signal=signalOf(signal); const list=tiles(cells(request));
    return enqueue(async (rev,s) => {
      try { for (let i=0;i<list.length;i++) { await tile(list[i],rev,s,p => progress(list[i],i,list.length,p)); progress(list[i],i,list.length); } return stats(); }
      finally { reserve(0); }
    },signal);
  }
  function read(request,signal) {
    signal=signalOf(signal); const region=cells(request),list=tiles(region),n=(region.x1-region.x0+1)*(region.y1-region.y0+1);
    return enqueue(async (rev,s) => {
      if (region.x1-region.x0+1>GLOBAL_WEATHER_GRID_LIMIT || region.y1-region.y0+1>GLOBAL_WEATHER_GRID_LIMIT) throw new Error('Tiled weather reads at most 1168 samples per side. Read bounded regions instead of a whole large map.');
      const withSand=settings.sand>0,withMaterial=settings.materialWeathering>0;
      const outputBytes=n*(24+(withSand?4:0)+(withMaterial?16:0));
      try {
        // Refuse an accidental whole-world plane before asking authored replay
        // to allocate it. Full-map export requests bounded regions instead.
        reserve(outputBytes+solverWorkBytes); reserve(outputBytes);
        const authored=authoredRegion(await readAuthored(worldRect(region),s),region); current(rev,s);
        const width=region.x1-region.x0+1,height=region.y1-region.y0+1;
        if (authored.gridWidth!==width || authored.gridHeight!==height || Math.round(authored.gridOrigin[0]/spacing)!==region.x0 || Math.round(authored.gridOrigin[1]/spacing)!==region.y0) throw new Error('Authored weather region is not on the canonical world lattice.');
        const delta=new Float32Array(n),weights=new Float32Array(n),weather={flow:new Float32Array(n),deposit:new Float32Array(n),talus:new Float32Array(n),sand:withSand?new Float32Array(n):null};
        const materialField=withMaterial?new Float32Array(n*4):null;
        let deadline=performance.now()+8;
        for (let index=0;index<list.length;index++) {
          const t=await tile(list[index],rev,s,p => progress(list[index],index,list.length,p),outputBytes); current(rev,s);
          const x0=Math.max(region.x0,t.rect.x0),x1=Math.min(region.x1,t.rect.x1),y0=Math.max(region.y0,t.rect.y0),y1=Math.min(region.y1,t.rect.y1);
          for (let y=y0;y<=y1;y++) {
            for (let x=x0;x<=x1;x++) {
              const weight=axisWeight(x,t.x)*axisWeight(y,t.y); if (!weight) continue;
              const i=(y-region.y0)*width+x-region.x0,j=(y-t.rect.y0)*t.gridWidth+x-t.rect.x0;
              weights[i]+=weight; delta[i]+=(t.delta?.[j]??t.uniformDelta??0)*weight;
              for (const k of ['flow','deposit','talus','sand']) if (weather[k] && t[k]) weather[k][i]+=t[k][j]*weight;
              if (materialField && t.materialField) for (let c=0;c<4;c++) materialField[i*4+c]+=t.materialField[j*4+c]*weight;
            }
            if ((y&7)===7 && performance.now()>=deadline) { await new Promise(resolve => setTimeout(resolve,0)); current(rev,s); deadline=performance.now()+8; }
          }
          progress(list[index],index,list.length);
        }
        current(rev,s);
        const fields={...authored.fields,h:authored.fields.h.slice()};
        for (let i=0;i<n;i++) {
          fields.h[i]+=delta[i]/weights[i]*(1-(authored.fields.r?.[i]??0));
          for (const a of Object.values(weather)) if (a) a[i]/=weights[i];
          if (materialField) for (let c=0;c<4;c++) materialField[i*4+c]/=weights[i];
        }
        const extra=fields.h.byteLength+Object.values(weather).reduce((n,a) => n+(a?.byteLength??0),0)+(materialField?.byteLength??0);
        return {...authored,fields,weather,materialField,weatherRevision:revision,bytes:(authored.bytes??0)+extra};
      } finally { reserve(0); }
    },signal);
  }
  function cachedCell(x,y,key) {
    const list=tiles({x0:x,y0:y,x1:x,y1:y});
    let sum=0,weightSum=0,base=null,route=0;
    const material=key.startsWith('material')?Number(key.slice(8)):null;
    for (const t of list) {
      const weight=axisWeight(x,t.x)*axisWeight(y,t.y); if (!weight) continue;
      const found=cache.get(t.key); if (!found) return null;
      const i=(y-found.rect.y0)*found.gridWidth+x-found.rect.x0;
      let value;
      if (key==='h') { value=found.delta?.[i]??found.uniformDelta??0; base??=found.base?.[i]??found.uniformBase; route=found.route?.[i]??0; }
      else if (material!==null) value=found.materialField?.[i*4+material]??0;
      else value=found[key]?.[i]??0;
      sum=Math.fround(sum+value*weight); weightSum=Math.fround(weightSum+weight);
    }
    return Math.fround((key==='h'?base:0)+sum/weightSum*(key==='h'?1-route:1));
  }
  function sampleCached(x,y,key='h') {
    if (disposed || !Number.isFinite(x) || !Number.isFinite(y) || !['h','flow','deposit','talus','sand','material0','material1','material2','material3'].includes(key)) return null;
    const gx=clamp(x/spacing,0,worldGrid-1),gy=clamp(y/spacing,0,worldGrid-1),ix=Math.floor(gx),iy=Math.floor(gy),jx=Math.min(ix+1,worldGrid-1),jy=Math.min(iy+1,worldGrid-1),fx=gx-ix,fy=gy-iy;
    const a=cachedCell(ix,iy,key),b=cachedCell(jx,iy,key),c=cachedCell(ix,jy,key),d=cachedCell(jx,jy,key);
    if ([a,b,c,d].some(v => v===null)) return null;
    return (a*(1-fx)+b*fx)*(1-fy)+(c*(1-fx)+d*fx)*fy;
  }
  function invalidate(rect=null,nextParams) {
    revision++; cancelActive();
    if (nextParams!==undefined) { settings=structuredClone(nextParams); rect=null; }
    if (rect===null) { cache.clear(); cacheBytes=0; }
    else { const r=cells(rect); for (const [key,t] of cache) if (overlap(clipped(t.input),r)) { cache.delete(key); cacheBytes-=t.bytes; } }
    onChange?.({revision,rect,ready:false}); return revision;
  }
  function setBudget(bytes) { if (!Number.isFinite(bytes) || bytes<1048576) throw new Error('Weather JS budget must be at least 1 MB.'); budget=bytes; evict(); }
  function stats() { return {revision,cacheBytes,cpuCacheBytes:cacheBytes,residentBytes:cacheBytes+inflightBytes,inflightBytes,peakBytes,peakWorkBytes,budget,cacheEntries:cache.size,
    hits,misses,evictions,solves,uniformSkips,completed,lastMilliseconds,coreCells:core,coreWorldPixels:core*spacing,overlapCells:blend,solverApronCells:apron,solverGrid,solverWorkBytes,worldSize,worldGrid,gridSpacing:spacing}; }
  setBudget(budget);
  return {read,prepare,sampleCached,requiredRect,invalidate,setBudget,stats,dispose() { disposed=true; cancelActive(); cache.clear(); cacheBytes=0; }};
}
