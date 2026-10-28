// Regional authoring fields. The stroke graph is authoritative; cached prefix
// tiles are disposable. Every tile uses the same integer world lattice.
export function createRegionalFields({worldSize,worldGrid,baseHeight,keys,maskKeys,nodes,bounds,stages=nodes,readApron=() => 0,pointReads=() => [],replay,baseCell,budget=1024*1024*1024,chunkCells=256,workspaceBytesPerCell}) {
  const spacing=(worldSize-1)/(worldGrid-1),cache=new Map(),listeners=new Set(),masks=new Set(maskKeys);
  const bytesPerCell=keys.reduce((n,k) => n+(masks.has(k)?1:4),0);
  // Live fields, two nested brush work sets (including mask bases), source
  // and framed noise, two blur passes, distance/flood planes and the crop.
  const workCellBytes=workspaceBytesPerCell??bytesPerCell*3+Object.keys({x:0,y:0,detail:0,coastX:0,coastY:0,coastWidth:0,shelf:0}).length*8+96;
  let stageMeta=new WeakMap();
  let revision=0,compiled=null,cacheBytes=0,activeBytes=0,peakBytes=0,lastWorkingBytes=0,hits=0,misses=0,evictions=0,maxWorkingCells=0,pointSamples=0,connectionTiles=0,connectionCells=0;
  const clamp=(n,a,b) => Math.max(a,Math.min(b,n));
  const overlaps=(a,b) => a.x0<=b.x1 && b.x0<=a.x1 && a.y0<=b.y1 && b.y0<=a.y1;
  const clip=r => ({x0:clamp(r.x0,0,worldGrid-1),y0:clamp(r.y0,0,worldGrid-1),x1:clamp(r.x1,0,worldGrid-1),y1:clamp(r.y1,0,worldGrid-1)});
  const worldRect=r => ({x:r.x0*spacing,y:r.y0*spacing,width:(r.x1-r.x0)*spacing,height:(r.y1-r.y0)*spacing});
  const area=r => (r.x1-r.x0+1)*(r.y1-r.y0+1);
  function list() {
    if (!compiled) {
      compiled=stages().filter(n => !n.hidden); stageMeta=new WeakMap();
      // Capture metadata on the outer world grid before any nested brush view
      // temporarily changes the globals used by the original shape routines.
      for (const n of compiled) stageMeta.set(n,{bounds:bounds(n),pad:Math.max(0,Math.ceil(readApron(n))),points:pointReads(n)});
    }
    return compiled;
  }
  const boundsOf=n => stageMeta.get(n).bounds;
  const allocate=r => Object.fromEntries(keys.map(k => [k,masks.has(k)?new Int8Array(area(r)):new Float32Array(area(r))]));
  function evict(limit=budget/4) {
    while (cacheBytes>limit && cache.size) { const key=cache.keys().next().value; cacheBytes-=cache.get(key).bytes; cache.delete(key); evictions++; }
  }
  function reserve(bytes) {
    evict(Math.max(0,Math.min(budget/4,budget-activeBytes-bytes)));
    if (bytes+activeBytes+cacheBytes>budget) throw new Error(`This terrain read needs about ${Math.ceil((bytes+activeBytes)/1048576)} MB of field working memory; the JS budget is ${Math.floor(budget/1048576)} MB. Reduce the read size or brush neighbourhood, or increase the JS budget.`);
    activeBytes+=bytes; peakBytes=Math.max(peakBytes,activeBytes+cacheBytes);
  }
  // Each node reads only its own neighbourhood. Earlier nodes are fetched as
  // independent prefix tiles, so overlapping strokes never grow one enormous
  // path/bounding-box closure. Point baselines are separate prefix reads.
  function apron(rect,n) {
    const pad=stageMeta.get(n).pad,r=clip({x0:rect.x0-pad,y0:rect.y0-pad,x1:rect.x1+pad,y1:rect.y1+pad});
    const side=Math.max(r.x1-r.x0+1,r.y1-r.y0+1);
    r.x0=Math.min(r.x0,worldGrid-side); r.y0=Math.min(r.y0,worldGrid-side);
    r.x1=r.x0+side-1; r.y1=r.y0+side-1;
    return r;
  }
  function copy(source,sr,target,tr,channels=keys) {
    const x0=Math.max(sr.x0,tr.x0),x1=Math.min(sr.x1,tr.x1),y0=Math.max(sr.y0,tr.y0),y1=Math.min(sr.y1,tr.y1),sw=sr.x1-sr.x0+1,tw=tr.x1-tr.x0+1;
    for (const k of channels) for (let y=y0;y<=y1;y++) {
      const from=(y-sr.y0)*sw+x0-sr.x0,to=(y-tr.y0)*tw+x0-tr.x0;
      target[k].set(source[k].subarray(from,from+x1-x0+1),to);
    }
  }
  function prefixRegion(count,rect,run) {
    const bytes=area(rect)*bytesPerCell; reserve(bytes);
    let fields;
    try {
      fields=allocate(rect);
      for (let y=Math.floor(rect.y0/chunkCells)*chunkCells;y<=rect.y1;y+=chunkCells) for (let x=Math.floor(rect.x0/chunkCells)*chunkCells;x<=rect.x1;x+=chunkCells) {
        const tile=prefixTile(count,x,y,run); copy(tile.fields,tile.cells,fields,rect);
      }
      return {fields,bytes};
    } catch (err) { activeBytes-=bytes; throw err; }
  }
  function prefixPoint(count,x,y,run) {
    const key=count+':'+x+','+y;
    if (run.points.has(key)) return run.points.get(key);
    pointSamples++;
    const gx=clamp(x/spacing,0,worldGrid-1),gy=clamp(y/spacing,0,worldGrid-1),ix=Math.floor(gx),iy=Math.floor(gy),jx=Math.min(ix+1,worldGrid-1),jy=Math.min(iy+1,worldGrid-1),fx=gx-ix,fy=gy-iy;
    const cell=(cx,cy) => { const tx=Math.floor(cx/chunkCells)*chunkCells,ty=Math.floor(cy/chunkCells)*chunkCells,t=prefixTile(count,tx,ty,run); return t.fields.h[(cy-ty)*t.gridWidth+cx-tx]; };
    const v=(cell(ix,iy)*(1-fx)+cell(jx,iy)*fx)*(1-fy)+(cell(ix,jy)*(1-fx)+cell(jx,jy)*fx)*fy;
    run.points.set(key,v); return v;
  }
  function prefixTile(count,x,y,run) {
    const rect={x0:x,y0:y,x1:Math.min(worldGrid-1,x+chunkCells-1),y1:Math.min(worldGrid-1,y+chunkCells-1)};
    while (count>0 && !overlaps(boundsOf(list()[count-1]),rect)) count--;
    const key=count+':'+x+','+y;
    if (cache.has(key)) { const r=cache.get(key); cache.delete(key); cache.set(key,r); hits++; return r; }
    misses++;
    const n=count?list()[count-1]:null,bytes=area(rect)*bytesPerCell;
    let fields;
    if (!n) {
      reserve(bytes);
      try { fields=allocate(rect); fields.h.fill(baseHeight); } finally { activeBytes-=bytes; }
    } else {
      // Resolve remote points before keeping this node's scratch arrays live.
      // Recursive samples always ask for an earlier prefix, never this tile.
      for (const p of stageMeta.get(n).points) prefixPoint(count-1,p.x,p.y,run);
      const working=apron(rect,n),prior=prefixRegion(count-1,working,run),workingBytes=area(working)*workCellBytes+bytes;
      lastWorkingBytes=workingBytes+prior.bytes; maxWorkingCells=Math.max(maxWorkingCells,area(working));
      try {
        reserve(workingBytes);
        try {
          const source=replay(working,{node:n,fields:prior.fields,sample:(px,py) => prefixPoint(count-1,px,py,run),connects:(cx,cy,local) => connected(count,cx,cy,local,run)});
          fields=allocate(rect); copy(source,working,fields,rect);
        } finally { activeBytes-=workingBytes; }
      } finally { activeBytes-=prior.bytes; }
    }
    const r={fields,bytes,cells:rect,gridWidth:rect.x1-rect.x0+1,gridHeight:rect.y1-rect.y0+1};
    // A base tile has no authored state to preserve. Its short-lived arrays
    // are counted while copied and are discarded immediately after the read.
    if (count) { cache.set(key,r); cacheBytes+=bytes; peakBytes=Math.max(peakBytes,activeBytes+cacheBytes); evict(Math.min(budget/4,budget-activeBytes)); }
    return r;
  }
  // The finger pass's final land flood is a connectivity question, not a
  // finite-radius stencil. Only an unseeded component touching a working
  // boundary asks for other candidate tiles; no rectangle follows its path.
  function coastTile(count,x,y,run) {
    const rect={x0:x,y0:y,x1:Math.min(worldGrid-1,x+chunkCells-1),y1:Math.min(worldGrid-1,y+chunkCells-1)},n=list()[count-1];
    if (!overlaps(boundsOf(n),rect)) { const r=prefixTile(count-1,x,y,run); return {...r,fields:{h:r.fields.h,raw:r.fields.h}}; }
    const key=count+':coast:'+x+','+y;
    if (cache.has(key)) { const r=cache.get(key); cache.delete(key); cache.set(key,r); hits++; return r; }
    connectionTiles++;
    const working=apron(rect,n),prior=prefixRegion(count-1,working,run),bytes=area(rect)*8,workBytes=area(working)*workCellBytes+bytes;
    maxWorkingCells=Math.max(maxWorkingCells,area(working));
    let fields;
    try {
      reserve(workBytes);
      try {
        const source=replay(working,{node:n,fields:prior.fields,sample:(px,py) => prefixPoint(count-1,px,py,run),mode:'coast'});
        fields={h:new Float32Array(area(rect)),raw:new Float32Array(area(rect))}; copy(source,working,fields,rect,['h','raw']);
      } finally { activeBytes-=workBytes; }
    } finally { activeBytes-=prior.bytes; }
    const r={fields,bytes,cells:rect,gridWidth:rect.x1-rect.x0+1,gridHeight:rect.y1-rect.y0+1};
    cache.set(key,r); cacheBytes+=bytes; peakBytes=Math.max(peakBytes,activeBytes+cacheBytes); evict(Math.min(budget/4,budget-activeBytes)); return r;
  }
  function connected(count,x,y,local,run) {
    const seen=new Set(),queue=[]; let head=0,reserved=0;
    const add=id => {
      if (seen.has(id)) return;
      if (queue.length*64>=reserved) { reserve(4096*64); reserved+=4096*64; }
      seen.add(id); queue.push(id);
    };
    const at=(cx,cy) => {
      if (cx>=local.x0 && cy>=local.y0 && cx<=local.x1 && cy<=local.y1) {
        const i=(cy-local.y0)*local.grid+cx-local.x0; return [local.h[i],local.raw[i]];
      }
      const tx=Math.floor(cx/chunkCells)*chunkCells,ty=Math.floor(cy/chunkCells)*chunkCells,r=coastTile(count,tx,ty,run),i=(cy-ty)*r.gridWidth+cx-tx;
      return [r.fields.h[i],r.fields.raw[i]];
    };
    try {
      add(y*worldGrid+x);
      while (head<queue.length) {
        const id=queue[head++],cx=id%worldGrid,cy=(id-cx)/worldGrid,[height,raw]=at(cx,cy); connectionCells++;
        if (raw>local.sea) return true;
        if (!(height>local.sea)) continue;
        if (cx) add(id-1); if (cx+1<worldGrid) add(id+1); if (cy) add(id-worldGrid); if (cy+1<worldGrid) add(id+worldGrid);
      }
      return false;
    } finally { activeBytes-=reserved; }
  }
  function readCells(request,{cacheResult=true,forceReplay=false}={}) {
    if (![request.x0,request.y0,request.x1,request.y1].every(Number.isFinite) || request.x1<request.x0 || request.y1<request.y0) throw new Error('Invalid terrain cells.');
    const rect=clip({x0:Math.floor(request.x0),y0:Math.floor(request.y0),x1:Math.ceil(request.x1),y1:Math.ceil(request.y1)});
    if (forceReplay) clear();
    const run={points:new Map()},source=prefixRegion(list().length,rect,run);
    activeBytes-=source.bytes;
    const r={fields:source.fields,maskPlanes:maskKeys.map(k => source.fields[k]),gridWidth:rect.x1-rect.x0+1,gridHeight:rect.y1-rect.y0+1,gridSpacing:spacing,gridOrigin:[rect.x0*spacing,rect.y0*spacing],worldSize,worldGrid,revision,bytes:source.bytes,rect:worldRect(rect)};
    if (!cacheResult) evict(0);
    return r;
  }
  function read({x=0,y=0,width=0,height=width,apron=0}) {
    if (![x,y,width,height,apron].every(Number.isFinite) || width<0 || height<0 || apron<0) throw new Error('Invalid terrain region.');
    return readCells({x0:Math.floor((x-apron)/spacing),y0:Math.floor((y-apron)/spacing),x1:Math.ceil((x+width+apron)/spacing),y1:Math.ceil((y+height+apron)/spacing)});
  }
  function cell(ix,iy,key='h') {
    ix=clamp(Math.round(ix),0,worldGrid-1); iy=clamp(Math.round(iy),0,worldGrid-1);
    if (baseCell && !nodes().some(n => !n.hidden && n.points?.length && overlaps(bounds(n),{x0:ix,y0:iy,x1:ix,y1:iy}))) return key==='h'?baseCell(ix,iy):0;
    const tx=Math.floor(ix/chunkCells)*chunkCells,ty=Math.floor(iy/chunkCells)*chunkCells,r=prefixTile(list().length,tx,ty,{points:new Map()});
    return r.fields[key][(iy-ty)*r.gridWidth+ix-tx];
  }
  function sample(x,y,key='h') {
    const gx=clamp(x/spacing,0,worldGrid-1),gy=clamp(y/spacing,0,worldGrid-1),ix=Math.floor(gx),iy=Math.floor(gy),jx=Math.min(ix+1,worldGrid-1),jy=Math.min(iy+1,worldGrid-1),fx=gx-ix,fy=gy-iy;
    return (cell(ix,iy,key)*(1-fx)+cell(jx,iy,key)*fx)*(1-fy)+(cell(ix,jy,key)*(1-fx)+cell(jx,jy,key)*fx)*fy;
  }
  function clear() { cache.clear(); cacheBytes=0; }
  function changed(rect=null,keepPrefix=0) {
    revision++; compiled=null;
    // Appending or previewing the last shape keeps earlier prefix tiles valid;
    // an edit discards its suffix. This also bounds repeated gesture work.
    for (const [key,r] of cache) if (Number(key.split(':')[0])>keepPrefix) { cache.delete(key); cacheBytes-=r.bytes; }
    const event={revision,rect:rect?worldRect(clip(rect)):null};
    for (const fn of listeners) fn(event);
    return event;
  }
  function finalTile(key,r) {
    if (key.includes(':coast:')) return false;
    const count=Number(key.split(':')[0]);
    for (let i=count;i<list().length;i++) if (overlaps(boundsOf(list()[i]),r.cells)) return false;
    return true;
  }
  function replayDetail() {
    const worst=Object.fromEntries(keys.map(k => [k,0]));
    // Check cached final-prefix tiles; intermediate prefixes remain an
    // implementation detail and need not be reconstructed as entire shapes.
    for (const [key,before] of Array.from(cache)) {
      if (!finalTile(key,before)) continue;
      const after=readCells(before.cells,{cacheResult:false,forceReplay:true});
      for (const k of keys) for (let i=0;i<before.fields[k].length;i++) worst[k]=Math.max(worst[k],Math.abs(before.fields[k][i]-after.fields[k][i]));
    }
    return worst;
  }
  return {read,readCells,sample,cell,changed,replayDetail,subscribe(fn) { listeners.add(fn); return () => listeners.delete(fn); },setBudget(bytes) { if (!Number.isFinite(bytes) || bytes<1048576) throw new Error('JS field budget must be at least 1 MB.'); budget=bytes; evict(); },clear,
    stats:() => ({revision,residentBytes:cacheBytes+activeBytes,cacheBytes,cacheEntries:cache.size,lastWorkingBytes,peakBytes,budget,hits,misses,replays:misses,evictions,chunkCells,worldSize,worldGrid,gridSpacing:spacing,bytesPerCell,workspaceBytesPerCell:workCellBytes,maxWorkingCells,pointSamples,connectionTiles,connectionCells}),
    maskChunks:() => Array.from(cache.entries()).filter(([key,r]) => finalTile(key,r) && maskKeys.some(k => r.fields[k].some(v => v!==0))).map(([key,r]) => ({key:[r.cells.x0,r.cells.y0,r.cells.x1,r.cells.y1].join('_'),rect:worldRect(r.cells),gridWidth:r.gridWidth,gridHeight:r.gridHeight,gridOrigin:[r.cells.x0*spacing,r.cells.y0*spacing],gridSpacing:spacing,revision,version:revision,planes:maskKeys.map(k => r.fields[k]),masks:Object.fromEntries(maskKeys.map(k => [k,r.fields[k]]))}))};
}
