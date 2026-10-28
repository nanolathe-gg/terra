// Regional authoring fields. The stroke graph is authoritative; cached fields
// are disposable. Grid rectangles use inclusive sample indices on one fixed
// world lattice, so two callers share the same boundary samples and noise phase.
export function createRegionalFields({worldSize,worldGrid,baseHeight,keys,maskKeys,nodes,bounds,replay,baseCell,budget=1024*1024*1024,chunkCells=256}) {
  const spacing=(worldSize-1)/(worldGrid-1),cache=new Map(),listeners=new Set();
  let revision=0,cacheBytes=0,peakBytes=0,lastWorkingBytes=0,hits=0,misses=0,evictions=0;
  const bytesPerCell=(keys.length-maskKeys.length)*4+maskKeys.length;
  const clamp=(n,a,b) => Math.max(a,Math.min(b,n));
  const overlaps=(a,b) => a.x0<=b.x1 && b.x0<=a.x1 && a.y0<=b.y1 && b.y0<=a.y1;
  const union=(a,b) => ({x0:Math.min(a.x0,b.x0),y0:Math.min(a.y0,b.y0),x1:Math.max(a.x1,b.x1),y1:Math.max(a.y1,b.y1)});
  const clip=r => ({x0:clamp(r.x0,0,worldGrid-1),y0:clamp(r.y0,0,worldGrid-1),x1:clamp(r.x1,0,worldGrid-1),y1:clamp(r.y1,0,worldGrid-1)});
  const worldRect=r => ({x:r.x0*spacing,y:r.y0*spacing,width:(r.x1-r.x0)*spacing,height:(r.y1-r.y0)*spacing});
  function evict(limit=budget/4) {
    while (cacheBytes>limit && cache.size) { const key=cache.keys().next().value; cacheBytes-=cache.get(key).bytes; cache.delete(key); evictions++; }
  }
  // Several brushes sample their starting point or endpoints; coast passes
  // inspect a whole touched shore, and a crater stamps satellite craters after
  // its bowl. Include the complete reach of every connected shape. Repeating
  // this growth also includes earlier terrain read by a newly included shape.
  // This deliberately trades some replay work for the original brush ordering.
  function closure(request) {
    let r=clip(request),changed=true;
    const list=nodes().filter(n => !n.hidden && n.points?.length).map(n => bounds(n));
    while (changed) {
      changed=false;
      for (const b of list) if (overlaps(r,b)) {
        const next=clip(union(r,b));
        if (next.x0!==r.x0 || next.y0!==r.y0 || next.x1!==r.x1 || next.y1!==r.y1) { r=next; changed=true; }
      }
    }
    // Existing brush routines use square row strides. Extra samples are only
    // working space; readCells returns exactly the requested rectangle.
    const n=Math.max(r.x1-r.x0+1,r.y1-r.y0+1);
    r.x0=Math.min(r.x0,worldGrid-n); r.y0=Math.min(r.y0,worldGrid-n);
    r.x1=r.x0+n-1; r.y1=r.y0+n-1;
    return r;
  }
  function readCells(request,{cacheResult=true,forceReplay=false}={}) {
    const rect=clip({x0:Math.floor(request.x0),y0:Math.floor(request.y0),x1:Math.ceil(request.x1),y1:Math.ceil(request.y1)});
    const key=[rect.x0,rect.y0,rect.x1,rect.y1].join(',');
    if (!forceReplay && cache.has(key)) { const result=cache.get(key); cache.delete(key); cache.set(key,result); hits++; return result; }
    misses++;
    const working=closure(rect),n=working.x1-working.x0+1,w=rect.x1-rect.x0+1,h=rect.y1-rect.y0+1;
    // Live fields, nested crater work, mask bases, seven noise planes, framed
    // noise, two blur passes, coast distance/flood buffers and the output crop.
    // The conservative workspace reservation is checked before any allocation.
    const workingBytes=n*n*320+w*h*bytesPerCell;
    evict(Math.max(0,Math.min(budget/4,budget-workingBytes)));
    if (workingBytes+cacheBytes>budget) throw new Error(`This connected terrain region needs about ${Math.ceil(workingBytes/1048576)} MB of field working memory; the JS budget is ${Math.floor(budget/1048576)} MB. Increase the JS budget or split the connected shapes.`);
    lastWorkingBytes=workingBytes; peakBytes=Math.max(peakBytes,workingBytes+cacheBytes);
    const source=replay(working),fields={};
    for (const k of keys) {
      const out=fields[k]=new source[k].constructor(w*h),sx=rect.x0-working.x0;
      for (let y=0;y<h;y++) { const from=(rect.y0-working.y0+y)*n+sx; out.set(source[k].subarray(from,from+w),y*w); }
    }
    const result={fields,maskPlanes:maskKeys.map(k => fields[k]),gridWidth:w,gridHeight:h,gridSpacing:spacing,gridOrigin:[rect.x0*spacing,rect.y0*spacing],worldSize,worldGrid,revision,bytes:w*h*bytesPerCell,rect:worldRect(rect)};
    // Only regions containing authored shapes or nonzero base undulation need
    // cached planes. A blank map is represented by its base, with no entries.
    if (cacheResult && nodes().some(n => !n.hidden && (n.kind==='ground' && n.amplitude>0 || n.points?.length && overlaps(bounds(n),rect)))) { cache.set(key,result); cacheBytes+=result.bytes; evict(); }
    return result;
  }
  function read({x=0,y=0,width=0,height=width,apron=0}) {
    if (![x,y,width,height,apron].every(Number.isFinite) || width<0 || height<0 || apron<0) throw new Error('Invalid terrain region.');
    return readCells({x0:Math.floor((x-apron)/spacing),y0:Math.floor((y-apron)/spacing),x1:Math.ceil((x+width+apron)/spacing),y1:Math.ceil((y+height+apron)/spacing)});
  }
  function cell(ix,iy,key='h') {
    ix=clamp(ix,0,worldGrid-1); iy=clamp(iy,0,worldGrid-1);
    if (baseCell && !nodes().some(n => !n.hidden && n.points?.length && overlaps(bounds(n),{x0:ix,y0:iy,x1:ix,y1:iy}))) return key==='h'?baseCell(ix,iy):0;
    const tx=Math.floor(ix/chunkCells)*chunkCells,ty=Math.floor(iy/chunkCells)*chunkCells;
    const r=readCells({x0:tx,y0:ty,x1:Math.min(worldGrid-1,tx+chunkCells),y1:Math.min(worldGrid-1,ty+chunkCells)});
    return r.fields[key][(iy-ty)*r.gridWidth+ix-tx];
  }
  function sample(x,y,key='h') {
    const gx=clamp(x/spacing,0,worldGrid-1),gy=clamp(y/spacing,0,worldGrid-1),ix=Math.floor(gx),iy=Math.floor(gy),jx=Math.min(ix+1,worldGrid-1),jy=Math.min(iy+1,worldGrid-1);
    const fx=gx-ix,fy=gy-iy;
    return (cell(ix,iy,key)*(1-fx)+cell(jx,iy,key)*fx)*(1-fy)+(cell(ix,jy,key)*(1-fx)+cell(jx,jy,key)*fx)*fy;
  }
  function changed(rect=null) {
    revision++; cache.clear(); cacheBytes=0;
    const event={revision,rect:rect?worldRect(clip(rect)):null};
    for (const fn of listeners) fn(event);
    return event;
  }
  function replayDetail() {
    const worst=Object.fromEntries(keys.map(k => [k,0]));
    for (const [key,before] of Array.from(cache)) {
      const [x0,y0,x1,y1]=key.split(',').map(Number),after=readCells({x0,y0,x1,y1},{cacheResult:false,forceReplay:true});
      for (const k of keys) for (let i=0;i<before.fields[k].length;i++) worst[k]=Math.max(worst[k],Math.abs(before.fields[k][i]-after.fields[k][i]));
    }
    return worst;
  }
  return {read,readCells,sample,cell,closure,changed,replayDetail,subscribe(fn) { listeners.add(fn); return () => listeners.delete(fn); },setBudget(bytes) { if (!Number.isFinite(bytes) || bytes<1048576) throw new Error('JS field budget must be at least 1 MB.'); budget=bytes; evict(); },
    clear() { cache.clear(); cacheBytes=0; },stats:() => ({revision,residentBytes:cacheBytes,cacheBytes,cacheEntries:cache.size,lastWorkingBytes,peakBytes,budget,hits,misses,replays:misses,evictions,chunkCells,worldSize,worldGrid,gridSpacing:spacing}),
    maskChunks:() => Array.from(cache.entries()).filter(([,r]) => maskKeys.some(k => r.fields[k].some(v => v!==0))).map(([key,r]) => ({key:key.replaceAll(',','_'),rect:r.rect,gridWidth:r.gridWidth,gridHeight:r.gridHeight,gridOrigin:r.gridOrigin,gridSpacing:spacing,revision:r.revision,version:r.revision,planes:maskKeys.map(k => r.fields[k]),masks:Object.fromEntries(maskKeys.map(k => [k,r.fields[k]]))}))};
}
