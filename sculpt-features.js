// Generated map features (owner, November 5-6 2026). Each map carries its own feature set: a recipe in the save (sculpt-feature-set.js)
// from which sculpt-feature-gen.js draws every variant, lit by the map's light. Placements belong to the map, never to its baked terrain
// art. Deposits and vents are painted into the ground: the view draws them from the export art under them, with the export's painter.
import {GROUND_KINDS,FILL_KINDS,LABELS,PLURALS,MAX_VARIANTS,worldKinds,normalizeSet,variants as kindVariants,pickVariant,typeLabel,normalizePlacement,hash32,MAX_RECIPES,recipeId,makeRecipe,featureCatalog,FORMS,controlRequirement} from './sculpt-feature-set.js';
const MAX_STARTS=10;   // TA's limit of start positions on a map
const CELL=16,PATCH=128,DEFAULT_FILL={kind:'tree',region:'brush',density:15,clustering:.5,gap:1,seed:2701,margin:96,radius:128};
const clamp=(v,a,b) => Math.max(a,Math.min(b,v));
const key=p => p.kind+'@'+p.x+','+p.z;
const ordered=(a,b) => a.z-b.z || a.x-b.x || (a.kind<b.kind?-1:a.kind>b.kind?1:0) || a.v-b.v;
const intersects=(a,b) => a.x<b.x+b.width && b.x<a.x+a.width && a.y<b.y+b.height && b.y<a.y+a.height;
function hash(x,z,seed) {
  let n=Math.imul(x,374761393)^Math.imul(z,668265263)^seed;
  n=Math.imul(n^(n>>>13),1274126177); return ((n^(n>>>16))>>>0)/4294967296;
}
function noise(x,z,seed) {
  const ix=Math.floor(x),iz=Math.floor(z),fx=x-ix,fz=z-iz,sx=fx*fx*(3-2*fx),sz=fz*fz*(3-2*fz);
  return (hash(ix,iz,seed)*(1-sx)+hash(ix+1,iz,seed)*sx)*(1-sz)+(hash(ix,iz+1,seed)*(1-sx)+hash(ix+1,iz+1,seed)*sx)*sz;
}
function segmentDistance(p,a,b) {
  const dx=b.x-a.x,dz=b.z-a.z,t=clamp(((p.x-a.x)*dx+(p.z-a.z)*dz)/(dx*dx+dz*dz||1),0,1);
  return Math.hypot(p.x-a.x-dx*t,p.z-a.z-dz*t);
}
function insidePolygon(p,points) {
  let inside=false;
  for (let i=0,j=points.length-1;i<points.length;j=i++) {
    const a=points[i],b=points[j];
    if (segmentDistance(p,a,b)<1e-6) return true;
    if ((a.z>p.z)!==(b.z>p.z) && p.x<(b.x-a.x)*(p.z-a.z)/(b.z-a.z)+a.x) inside=!inside;
  }
  return inside;
}
function fillOptions(value={},base=DEFAULT_FILL) {
  const out={...base},limits={density:[0,100],clustering:[0,1],gap:[0,16],seed:[0,4294967295],margin:[0,4096],radius:[16,1024]};
  for (const [name,[lo,hi]] of Object.entries(limits)) if (Number.isFinite(Number(value[name]))) out[name]=clamp(Number(value[name]),lo,hi);
  for (const name of ['gap','seed']) out[name]=Math.round(out[name]);
  if (FILL_KINDS.includes(value.kind)) out.kind=value.kind;
  if (['brush','lasso','flood'].includes(value.region)) out.region=value.region;
  return out;
}

// A brush/lasso can only place footprints wholly inside its region. Sampling
// the rest of a large map does not affect those decisions. Flood still needs
// the complete connectivity mask.
export function featureRegionBounds(region,cols,rows,radius) {
  if(region?.type==='flood')return {x0:0,z0:0,x1:cols,z1:rows};
  const points=(region?.points||[]).map(p=>Array.isArray(p)?{x:p[0],z:p[1]}:p);
  if(points.some(p=>!Number.isFinite(p.x)||!Number.isFinite(p.z)))throw new Error('The fill region contains an invalid point.');
  if(!['brush','lasso'].includes(region?.type))throw new Error('Choose a brush, lasso or flood region.');
  if(!points.length)return {x0:0,z0:0,x1:0,z1:0};
  const reach=region.type==='brush'?(Number.isFinite(region.radius)?Math.max(0,region.radius):radius):0;
  let x0=Infinity,z0=Infinity,x1=-Infinity,z1=-Infinity;
  for(const p of points){x0=Math.min(x0,p.x);z0=Math.min(z0,p.z);x1=Math.max(x1,p.x);z1=Math.max(z1,p.z);}
  return {x0:clamp(Math.floor((x0-reach)/CELL),0,cols),z0:clamp(Math.floor((z0-reach)/CELL),0,rows),x1:clamp(Math.ceil((x1+reach)/CELL)+1,0,cols),z1:clamp(Math.ceil((z1+reach)/CELL)+1,0,rows)};
}

// A map's starts until the artist moves them: two, a unit in from opposite corners of the play area (half a unit on a one-unit side).
export function defaultStarts(map) { const mx=map.unitsX===1?128:256,mz=map.unitsY===1?128:256; return [{x:mx,z:mz},{x:map.playRight-mx,z:map.playBottom-mz}]; }

export async function mountMapFeatures(api) {
  const {config,canvas}=api,map=config.map,doc=canvas.ownerDocument,$=id => doc.getElementById(id);
  const nothing=() => {};
  if (!map) return {serialize:() => ({features:[],featureSet:{},starts:[],fill:{...DEFAULT_FILL}}),load:nothing,draw:nothing,deactivate:nothing,activate:() => false,clearSelection:nothing,pointerSelect:() => false,hitAt:() => null,fitGround:async () => false,groundChanged:nothing,stats:() => ({imageBytes:0}),get selectionCount(){return 0;},get active(){return false;},get busy(){return false;}};
  const cols=map.playRight/CELL,rows=map.playBottom/CELL,shift=Math.floor(config.baseHeight/2),kinds=worldKinds(config);
  const defaults=() => defaultStarts(map);
  let set=normalizeSet(config.featureSet,config),placements=[],starts=defaults(),fill={...DEFAULT_FILL},generated=new Set(),mode='',placeKind='deposit',placeVariant=-1,selectedStart=0,rolls=0;
  let selection=new Set(),gesture=null,hover=null,space=false,message='';
  const panPointers=new Set(),controls=$('map-features-controls'),kindTabs=[...doc.querySelectorAll('[data-feature-kind]')],buttons=new Map([...doc.querySelectorAll('[data-feature-mode]')].map(b => [b.dataset.featureMode,b]));
  const enabled=() => api.enabled();
  const status=text => { message=text; $('feature-state').textContent=text; };
  // serialize()'s answer, kept until the next edit (guard: every edit starts there), change or load: every undo step of the map holds it, so a
  // step that did not touch the features shares the list instead of copying it, and an undo to such a step has nothing to load.
  let serialized=null;
  const guard=() => { serialized=null; if (enabled()) return true; status('Map editing is unavailable while terrain is loading or export is running.'); return false; };

  // ---- the set's variants ----
  // Each set edit makes a new `set`, so a kind's list is kept until the set object changes (draw asks for it per feature, per frame).
  const lists=new Map(),addresses=new Map(); let listsOf=null;
  function variantList(kind) { if (listsOf!==set) { lists.clear(); addresses.clear(); listsOf=set; } let list=lists.get(kind); if (!list) { list=kindVariants(kind,set,config); lists.set(kind,list); addresses.set(kind,new Map(list.map(v => [v.index,v]))); } return list; }
  const variantOf=p => { variantList(p.kind); return addresses.get(p.kind).get(p.v); };
  const activeRecipes={};
  const activeRecipe=(kind=placeKind) => set[kind]?.recipes.find(r => r.id===activeRecipes[kind]) || set[kind]?.recipes[0];
  const activeList=(kind=placeKind) => variantList(kind).filter(v => v.recipe===activeRecipe(kind)?.id);
  const depositMetal=() => activeRecipe('deposit')?.metal ?? 127;
  const footprint=p => variantOf(p)?.footprint||[1,1];
  const rectangle=p => { const [fw,fz]=footprint(p); return {x0:p.x*CELL,z0:p.z*CELL,x1:(p.x+fw)*CELL,z1:(p.z+fz)*CELL}; };
  function pointDistance(p,r) { return Math.hypot(Math.max(r.x0-p.x,0,p.x-r.x1),Math.max(r.z0-p.z,0,p.z-r.z1)); }
  function rectDistance(a,b) { return Math.hypot(Math.max(a.x0-b.x1,b.x0-a.x1,0),Math.max(a.z0-b.z1,b.z0-a.z1,0)); }
  function inBounds(p) { const [fw,fz]=footprint(p); return Number.isInteger(p.x) && Number.isInteger(p.z) && p.x>=0 && p.z>=0 && p.x+fw<=cols && p.z+fz<=rows; }
  function validStart(p) { return Number.isInteger(p.x) && Number.isInteger(p.z) && p.x>=0 && p.z>=0 && p.x<map.playRight && p.z<map.playBottom; }
  function overlaps(a,b,gap=0) { const [aw,az]=footprint(a),[bw,bz]=footprint(b); return a.x<b.x+bw+gap && a.x+aw+gap>b.x && a.z<b.z+bz+gap && a.z+az+gap>b.z; }
  const deposit=p => p.kind==='deposit';
  const scatter=p => FILL_KINDS.includes(p.kind);
  // `depots`: the deposits' rectangles, when the caller tests many placements against the same list (trimGenerated).
  function nearMargin(p,margin,list=placements,bases=starts,depots=null) {
    const rect=rectangle(p);
    return bases.some(s => pointDistance(s,rect)<margin) || (depots ?? list.filter(deposit).map(rectangle)).some(r => rectDistance(rect,r)<margin);
  }
  function trimGenerated(margin=fill.margin,list=placements,bases=starts) {
    let removed=0;const depots=list.filter(deposit).map(rectangle);
    const kept=list.filter(p => { const drop=generated.has(key(p)) && scatter(p) && nearMargin(p,margin,list,bases,depots); if (drop) { generated.delete(key(p)); selection.delete(p); removed++; } return !drop; });
    return {kept,removed};
  }
  // ---- pixels: a worker draws sprites and paints deposits and vents ----
  // The worker answers every job (a job's own failure comes back as its error). An error on the worker itself (it failed to load, or it died) fails
  // every job in flight and ends that worker: a job after it starts a new one (one that failed less than 2 s ago fails at once instead, so a
  // generator that cannot load is not started again on every draw). Such a failure is marked `lost`, so the sprite and thumbnail caches
  // drop the entry and ask again, where a job's own error is kept (it would fail the same way). A job given an abort signal is rejected, and
  // forgotten, when it aborts; the worker's answer is then dropped.
  let worker=null,jobId=0,lost=null;
  const jobs=new Map();
  function work(message,transfer=[],signal=null) {
    if (signal?.aborted) return Promise.reject(signal.reason);
    if (!worker && lost && performance.now()-lost.at<2000) return Promise.reject(Object.assign(new Error(lost.message),{lost:true}));
    if (!worker) {
      const own=new Worker(new URL('./sculpt-feature-worker.js',import.meta.url),{type:'module'});
      own.onmessage=({data}) => { const job=jobs.get(data.id); jobs.delete(data.id); if (!job) return; job.done(); if (data.error) job.reject(new Error(data.error)); else job.resolve(data); };
      own.onerror=event => {
        const message=event.message||'The feature generator could not start.';
        own.terminate(); if (worker===own) worker=null; lost={at:performance.now(),message};
        for (const [id,job] of jobs) if (job.worker===own) { jobs.delete(id); job.done(); job.reject(Object.assign(new Error(message),{lost:true})); }
        status(message);
      };
      worker=own;
    }
    const id=++jobId,own=worker;
    return new Promise((resolve,reject) => {
      const abort=() => { if (jobs.delete(id)) reject(signal.reason); };
      signal?.addEventListener('abort',abort,{once:true});
      jobs.set(id,{resolve,reject,worker:own,done:() => signal?.removeEventListener('abort',abort)});
      own.postMessage({...message,id},transfer);
    });
  }
  // The map's light for the generator: its sun in the sprites' view (TA's view looks down (0, south 1, up 2): x east, y the sun's
  // screen height, z toward the viewer) and, unless both are white, the world's sun and sky colors, its ambient share and the sun's
  // height, so features are lit and tinted as the ground under them (sculpt-feature-gen.js tintOf).
  const r3=v => Math.round(v*1000)/1000;
  function light() {
    const sun=api.light?.(); if (!sun) return null;
    const out={x:r3(sun[0]),y:r3(0.8944*sun[1]-0.4472*sun[2]),z:r3(0.4472*sun[1]+0.8944*sun[2])},c=api.lightColors?.()||{},white=v => !v || v.every(x => Math.abs(x-1)<1e-4);
    if (!white(c.sun) || !white(c.sky)) out.tint={sun:(c.sun||[1,1,1]).map(r3),sky:(c.sky||[1,1,1]).map(r3),ambient:r3(c.ambient??.42),up:r3(sun[2])};
    return out;
  }
  const lightKey=sun => sun?JSON.stringify(sun):'';
  async function bitmapOf(s) {
    if (!s) return null;
    const alpha=new Uint8Array(s.w*s.h); for (let i=0;i<alpha.length;i++) alpha[i]=s.rgba[i*4+3]?1:0;
    return {bitmap:await createImageBitmap(new ImageData(s.rgba,s.w,s.h)),w:s.w,h:s.h,ax:s.ax,ay:s.ay,alpha};
  }
  const sprites=new Map();
  const spriteKey=(v,sun) => { const at=lightKey(sun); if (v.keyLight!==at) { v.key=v.kind+'|'+v.seed+'|'+JSON.stringify(v.params)+'|'+at; v.keyLight=at; } return v.key; };
  function sprite(v) {
    const sun=light(); if (!sun || !v || GROUND_KINDS.includes(v.kind)) return null;
    const k=spriteKey(v,sun);
    let e=sprites.get(k);
    if (!e) {
      e={ready:false}; sprites.set(k,e);
      work({type:'sprite',kind:v.kind,params:v.params,seed:v.seed,light:sun}).then(async r => {
        Object.assign(e,{body:await bitmapOf(r.body),shadow:await bitmapOf(r.shadow),bodyBlend:r.bodyBlend,shadowBlend:r.shadowBlend,gameplay:r.gameplay,ready:true});
        if (sprites.get(k)!==e) return release(e);
        refreshVariants(); refreshSelection(); api.schedule();
      },err => { if (err.lost) { if (sprites.get(k)===e) sprites.delete(k); } else e.error=err.message; status('A feature could not be drawn: '+err.message); });
    }
    return e.ready?e:null;
  }
  function release(e) { e.body?.bitmap.close?.(); e.shadow?.bitmap.close?.(); e.bitmap?.close?.(); }
  // Keep only the current set's pixels.
  function prune() {
    const sun=light(),keep=new Set();
    if (sun) for (const kind of kinds) for (const v of variantList(kind)) keep.add(spriteKey(v,sun));
    for (const [k,e] of sprites) if (!keep.has(k)) { sprites.delete(k); release(e); }
    const live=new Set(placements.filter(p => GROUND_KINDS.includes(p.kind)).map(key)),origins=new Set();
    for (const [k,s] of stamps) if (!live.has(k)) { stamps.delete(k); release(s); }
    for (const p of placements) if (GROUND_KINDS.includes(p.kind)) { const o=exactOrigin(p); if (o) origins.add(o.ox+','+o.oy); }
    for (const [k,g] of grounds) if (!origins.has(k) && !g.pending) grounds.delete(k);
    const placed=new Set(placements.map(key)); for (const k of lifts.keys()) if (!placed.has(k)) lifts.delete(k);
    for (const kind of GROUND_KINDS) for (const v of variantList(kind)) keep.add('ground|'+kind+'|'+v.seed+'|'+JSON.stringify(kind==='deposit'?{...v.params,metal:depositMetal()}:v.params)+'|'+lightKey(sun));   // as thumbnail() keys them
    for (const k of thumbs.keys()) if (!keep.has(k)) thumbs.delete(k);
  }

  // ---- positions (client.featureScreenPos/featureAnchorY: the footprint centre, lifted by half the mean of the anchor cell's four
  // rounded, clamped corner bytes). `anchor` is in the export art's (TA screen) pixels; the view is lower by half the base height. ----
  const corner=(x,z) => { const h=api.sample(x*CELL,z*CELL); return Number.isFinite(h)?Math.round(clamp(h,0,255)):-1; };
  // The lift waits for heights the fields hold now (api.known): until the anchor cell's corners are read (a map just opened, an edit not yet
  // copied back), a placement keeps the lift it last had, and one with none yet is not drawn (anchor answers null). No sprite jumps as the
  // base height, then the shapes' heights, then the Time pass's arrive.
  const lifts=new Map(),CORNERS=[[0,0],[1,0],[0,1],[1,1]];
  function anchor(p) {
    const [fw,fz]=footprint(p),k=key(p);
    if (!api.known || CORNERS.every(([i,j]) => api.known((p.x+i)*CELL,(p.z+j)*CELL))) lifts.set(k,(corner(p.x,p.z)+corner(p.x+1,p.z)+corner(p.x,p.z+1)+corner(p.x+1,p.z+1))>>3);
    const lift=lifts.get(k);
    return lift===undefined?null:{x:p.x*CELL+fw*8,y:p.z*CELL+fz*8-lift};
  }
  const viewPoint=p => { const a=anchor(p); return a && {x:a.x,y:Math.floor(a.y+config.baseHeight/2)}; };
  function project(p) { const h=api.sample(p.x,p.z); return {x:p.x,z:p.z-Math.floor(clamp(Number.isFinite(h)?h:0,0,255)/2)+config.baseHeight/2}; }

  // ---- deposits and vents: painted into a 128 px patch of the export art centred on the anchor. The anchor is the export's: the
  // anchor cell's four corner bytes as the TNT carries them (sculpt-canvas.js reads them as the export samples them); the view's own
  // height stands in until they are read. Each patch is clean export art, so overlapping halos paint as the export paints them. ----
  const grounds=new Map(),stamps=new Map(),thumbs=new Map();let groundGen=0;
  const originOf=(p,corners) => { const [fw,fz]=footprint(p),sum=corners[0]+corners[1]+corners[2]+corners[3]; return {ox:p.x*CELL+fw*8-PATCH/2,oy:p.z*CELL+fz*8-(sum>>3)-PATCH/2}; };
  const exactOrigin=p => { const s=stamps.get(key(p)); return s?.exact && !s.exactStale?s.exact:null; };
  function groundOrigin(p) { const exact=exactOrigin(p); if (exact) return exact; const a=anchor(p); return a && {ox:a.x-PATCH/2,oy:a.y-PATCH/2}; }
  function flatGround() {
    const c=(api.groundColor?.()||[.21,.36,.1]).map(v => Math.round(clamp(v,0,1)*255)),rgba=new Uint8ClampedArray(PATCH*PATCH*4);
    for (let i=0;i<PATCH*PATCH;i++) { rgba[i*4]=c[0]; rgba[i*4+1]=c[1]; rgba[i*4+2]=c[2]; }
    return rgba;   // alpha 0: the painter marks what it writes
  }
  // A patch of export art (the part inside the map; the rest stays the world's mean ground, never written back), alpha 0.
  function patchOf(origin,rect,data) {
    const rgba=flatGround();
    for (let row=0;row<rect.height;row++) rgba.set(data.subarray(row*rect.width*4,(row+1)*rect.width*4),((rect.y-origin.oy+row)*PATCH+rect.x-origin.ox)*4);
    for (let i=3;i<rgba.length;i+=4) rgba[i]=0;
    return rgba;
  }
  const patchRect=o => { const x=Math.max(0,o.ox),y=Math.max(0,o.oy),x1=Math.min(map.width,o.ox+PATCH),y1=Math.min(map.height,o.oy+PATCH); return x1>x && y1>y?{x,y,width:x1-x,height:y1-y}:null; };
  // A deposit whose footprint centre cell lies under the sea (its four corner bytes' mean below the sea level) is drawn as under water.
  const underwater=p => { const c=[corner(p.x+1,p.z+1),corner(p.x+2,p.z+1),corner(p.x+1,p.z+2),corner(p.x+2,p.z+2)]; return c.every(v => v>=0) && (c[0]+c[1]+c[2]+c[3])/4<config.seaLevel; };
  const paintParams=p => p.kind==='deposit'?{...variantOf(p).params,metal:p.metal,...(underwater(p)?{underwater:true}:{})}:variantOf(p).params;
  const paint=(p,rgba,sun=light(),signal=null) => { const v=variantOf(p); return work({type:'paint',kind:p.kind,params:paintParams(p),seed:v.seed,light:sun,w:PATCH,h:PATCH,cx:PATCH/2,cy:PATCH/2,rgba},[rgba.buffer],signal).then(r => r.rgba); };
  function stampFor(p) {
    const pk=key(p);
    let s=stamps.get(pk); if (!s) { s={bitmap:null,want:'',painting:'',exact:null,exactStale:true}; stamps.set(pk,s); }
    const exact=exactOrigin(p),gk=exact?exact.ox+','+exact.oy:'';
    let g=exact?grounds.get(gk):null;
    if (exact && !g) { g={ox:exact.ox,oy:exact.oy,rgba:null,gen:0,stale:true,pending:false,failed:false,input:null}; grounds.set(gk,g); }
    const want=variantOf(p).seed+'|'+JSON.stringify(paintParams(p))+'|'+lightKey(light())+'|'+(g?.rgba?gk+'|'+g.gen:'flat');
    if (s.want!==want && s.painting!==want) {
      s.painting=want;
      paint(p,g?.rgba?g.rgba.slice():flatGround()).then(async rgba => {
        if (s.painting!==want) return;
        const bitmap=await createImageBitmap(new ImageData(rgba,PATCH,PATCH));
        if (s.painting!==want) { bitmap.close(); return; }
        s.bitmap?.close?.(); Object.assign(s,{bitmap,want,painting:''}); api.schedule();
      },err => { s.painting=''; status('A deposit or vent could not be painted: '+err.message); });
    }
    return s;
  }
  // One step of fitting the shown deposits and vents to the export, when the view is idle (sculpt-canvas.js): read an anchor's
  // corner bytes, or bake a patch of export art under one. Visible ones first. True when it did something.
  async function fitGround(view=null) {
    const seen=p => !view || intersects({x:p.x*CELL-64,y:p.z*CELL-160,width:PATCH+64,height:PATCH+224},view);
    const shown=placements.filter(p => GROUND_KINDS.includes(p.kind) && stamps.has(key(p))).sort((a,b) => seen(b)-seen(a));
    for (const p of shown) {
      const s=stamps.get(key(p)); if (s.exact && !s.exactStale) continue;
      s.exactStale=false; const corners=await api.exportCorners?.(p.x,p.z);
      if (!corners) { s.exactStale=true; return Boolean(api.exportCorners); }
      if (stamps.get(key(p))===s) { s.exact=originOf(p,corners); api.schedule(); }
      return true;
    }
    const live=new Set(shown.map(exactOrigin).filter(Boolean).map(o => o.ox+','+o.oy));
    for (const [gk,g] of grounds) if (!live.has(gk) && !g.pending) grounds.delete(gk);
    let best=null;
    for (const g of grounds.values()) { if (!g.stale || g.pending || g.failed) continue; const visible=!view || intersects({x:g.ox,y:g.oy+shift,width:PATCH,height:PATCH},view); if (!best || visible && !best.visible) best={g,visible}; }
    if (!best || !api.bakeArt) return false;
    const g=best.g,rect=patchRect(g);
    if (!rect) { Object.assign(g,{rgba:flatGround(),gen:++groundGen,stale:false}); return true; }
    g.pending=true;
    try { const r=await api.bakeArt(rect); if (r) Object.assign(g,{rgba:patchOf(g,rect,r.data),gen:++groundGen,stale:false,input:r.input}); api.schedule(); }
    catch (err) { if (err.name!=='AbortError') { console.error(err); g.failed=true; } }
    finally { g.pending=false; }
    return true;
  }
  function groundChanged(rect) {
    for (const g of grounds.values()) if (!rect || !g.input || intersects(rect,g.input)) { g.stale=true; g.failed=false; }
    for (const p of placements) { if (!GROUND_KINDS.includes(p.kind)) continue; const s=stamps.get(key(p)),[fw,fz]=footprint(p); if (s && (!rect || intersects(rect,{x:p.x*CELL-CELL,y:p.z*CELL-CELL,width:(fw+2)*CELL,height:(fz+2)*CELL}))) s.exactStale=true; }
  }

  // ---- the panel (index.html #map-features-panel) ----
  const unavailable=['tree','shrub','rock','scar'].filter(k => !kinds.includes(k));
  for (const option of $('feature-kind').options) option.disabled=!kinds.includes(option.value);
  for (const option of $('fill-kind').options) option.disabled=!kinds.includes(option.value);
  $('feature-kind-note').textContent=unavailable.length?`No generated ${unavailable.map(k => PLURALS[k]).join(', ').replace(/, ([^,]*)$/,' or $1')} for this world yet.`:'';
  const settingInputs=[...doc.querySelectorAll('#feature-place [data-setting]')];
  const paramInputs=[...doc.querySelectorAll('#feature-place [data-param]')];
  const numericInputs=[...doc.querySelectorAll('#map-features-panel input[type=range],#feature-selection-metal')];
  function showNumericValue(input) {
    const out=$(input.id+'-value'); if(!out)return;
    const digits=(input.step.split('.')[1]||'').length;
    out.textContent=input.dataset.unset==='true' ? input.dataset.unsetLabel||'Preset' : (input.dataset.valuePrefix||'')+Number(input.value).toFixed(digits)+(input.dataset.valueSuffix||'');
  }
  for(const input of numericInputs)input.addEventListener('input',()=>{input.dataset.unset='false';showNumericValue(input);});

  function updateRecipes(entry) {
    const select=$('feature-recipe');
    select.replaceChildren(...set[placeKind].recipes.map(r => {const o=doc.createElement('option');o.value=r.id;o.textContent=r.name;return o;})); select.value=entry.id;
    const presets=$('feature-preset');
    if(presets.dataset.kind!==placeKind) { presets.replaceChildren(...featureCatalog(config,placeKind).map(p => {const o=doc.createElement('option');o.value=p.id;o.textContent=p.name;return o;})); presets.dataset.kind=placeKind; }
    // A control the panel disables says why (AGENTS.md rule 9).
    const full=set[placeKind].recipes.length>=MAX_RECIPES,fullWhy=`A map holds at most ${MAX_RECIPES} styles of ${PLURALS[placeKind]??placeKind}.`;
    $('feature-add-recipe').disabled=!presets.options.length || full;
    $('feature-add-recipe').title=full?fullWhy:!presets.options.length?`This world has no starting styles for ${PLURALS[placeKind]??placeKind}.`:'';
    $('feature-duplicate-recipe').disabled=full; $('feature-duplicate-recipe').title=full?fullWhy:'';
    const used=placements.some(p => p.kind===placeKind && recipeId(p.v)===entry.id);
    $('feature-remove-recipe').disabled=used || set[placeKind].recipes.length<=1;
    $('feature-remove-recipe').title=used?'Remove this style’s placed features first.':set[placeKind].recipes.length<=1?'Keep at least one style of each kind.':'';
    if(doc.activeElement!==$('feature-recipe-name'))$('feature-recipe-name').value=entry.name;
    const firstVariant=activeList()[0], first=firstVariant?.params || {}, source=entry.data.types[firstVariant?.type] || {};
    const nominal=k => source.vary?.[k] ? (source.vary[k][0]+source.vary[k][1])/2 : source.params?.[k];
    for(const input of paramInputs) {
      const k=input.dataset.param, kind=input.dataset.paramKind;
      const row=input.closest('.control'); row.hidden=kind!==placeKind;
      const reason=controlRequirement(kind,k,first); input.disabled=Boolean(reason); input.title=reason;
      const note=row.querySelector('[data-requirement]'); if(note)note.textContent=reason;
      if(doc.activeElement!==input) {
        const fallback = k==='trunkColor' ? first.trunk?.[Math.floor(first.trunk.length/2)] || '#3b3323' : k==='accentColor' ? '#b8c277' : FORMS[kind]?.[k]?.[2];
        const value = ['species','canopyStyle'].includes(k) ? entry.params[k] ?? '' : entry.params[k] ?? (['height','width','reach','thick'].includes(k) ? nominal(k) : undefined) ?? first[k] ?? fallback;
        const inheritedVariation = k.endsWith('Variation') && entry.params[k] === undefined;
        if(input.type==='range'){input.dataset.unset=String(inheritedVariation);input.dataset.unsetLabel='Preset';}
        input.value = String(input.dataset.paramScale ? Number(value)*Number(input.dataset.paramScale) : value);
        if(inheritedVariation && !reason) input.title='Uses the preset’s size variation. Double-click to type; enter 0 to fix this dimension, or clear to restore the preset.';
        row.title=input.title;
      }
    }
  }
  function update() {
    controls.disabled=!enabled();
    for (const [name,button] of buttons) { button.setAttribute('aria-pressed',String(mode===name)); button.disabled=name==='fill' && !FILL_KINDS.some(k => kinds.includes(k)); button.title=button.disabled?'Fill places generated trees, shrubs and rocks; this world has none yet.':''; }
    // Starts is its own tool on the rail: the card takes its name, and the Place / Erase / Fill switch steps aside.
    $('map-features-title').textContent=mode==='starts'?'Start positions':'Features'; doc.querySelector('.feature-modes').hidden=mode==='starts';
    $('start-count').hidden=mode!=='starts'; $('start-count').textContent=`${starts.length} of ${MAX_STARTS}`;
    for (const tab of kindTabs) { const kind=tab.dataset.featureKind,off=!kinds.includes(kind); tab.setAttribute('aria-checked',String(kind===placeKind)); tab.disabled=off; tab.tabIndex=!off&&kind===placeKind?0:-1; tab.title=off?`No generated ${PLURALS[kind]} for this world yet.`:LABELS[kind]; }
    $('feature-place').hidden=mode!=='place';
    $('feature-starts').hidden=mode!=='starts';
    $('feature-fill').hidden=mode!=='fill'; if (mode==='fill') $('feature-fill').open=true;
    $('feature-kind').value=placeKind;
    const entry=activeRecipe();
    updateRecipes(entry);
    if (doc.activeElement!==$('feature-count')) $('feature-count').value=String(entry?.count??1);
    $('feature-count').max=String(MAX_VARIANTS);
    for (const row of doc.querySelectorAll('#feature-place [data-kind]')) row.hidden=row.dataset.kind!==placeKind;
    for (const input of settingInputs) {
      const [kind,name,end]=input.dataset.setting.split('.'),value=activeRecipe(kind)?.[name];
      const sample=activeList(kind).map(v => v.params),reason=sample.length && sample.every(p => controlRequirement(kind,name,p))?controlRequirement(kind,name,sample[0]):'';
      input.disabled=Boolean(reason); input.title=reason; input.closest('.control')?.setAttribute('title',reason);
      if (value===undefined || doc.activeElement===input) continue;
      input.value=String(end===undefined?value:value[Number(end)]);
      showNumericValue(input);
    }
    const select=$('start-list'); select.replaceChildren(...starts.map((s,i) => { const option=doc.createElement('option'); option.value=i; option.textContent=`${i+1}: (${s.x}, ${s.z})`; return option; }));
    select.value=String(selectedStart); $('start-remove').disabled=starts.length<=1 || selectedStart<0;
    $('fill-kind').value=fill.kind; $('fill-region').value=fill.region;
    for(const button of doc.querySelectorAll('[data-fill-region]'))button.setAttribute('aria-pressed',String(button.dataset.fillRegion===fill.region));
    for (const [name,input] of fillInputs) if (doc.activeElement!==input) input.value=String(fill[name]);
    numericInputs.forEach(showNumericValue);
    $('feature-count-line').textContent=`${placements.length} features · ${starts.length} starts`;
    $('feature-state').textContent=message;
    const hints={place:`Click a cell to place a ${LABELS[placeKind].toLowerCase()} (${placeVariant>=0?`variant ${placeVariant%MAX_VARIANTS+1}`:'a random variant'}). Select (V) moves, re-rolls and deletes placed features.`,erase:'Click or drag across feature footprints to erase them.',starts:'Click empty ground to add a start. Drag a marker, or Shift-click ground, to move the selected start.',fill:`${PLURALS[fill.kind]} fill: ${fill.region==='brush'?'drag a brush':fill.region==='lasso'?'draw a closed lasso':'click connected gentle dry ground'}. Space or middle-drag still pans.`};
    $('feature-help').textContent=hints[mode]||'Choose a feature tool, or keep sculpting terrain. Space or middle-drag pans in every tool.';
    refreshVariants();
    api.schedule();
  }
  function refreshVariants() {
    if (mode!=='place') return;
    const host=$('feature-variants'),list=activeList(),sun=light(),key0=placeKind+JSON.stringify(activeRecipe())+placeVariant+lightKey(sun);
    if (host.dataset.key!==key0 || host.children.length!==list.length+1) {
      host.dataset.key=key0;
      const random=doc.createElement('button'); random.type='button'; random.textContent='Random'; random.title='Each click picks a variant at random, from this style'; random.setAttribute('aria-pressed',String(placeVariant<0)); random.onclick=() => { placeVariant=-1; update(); };
      host.replaceChildren(random,...list.map(v => {
        const b=doc.createElement('button'); b.type='button'; b.dataset.variant=v.index; b.setAttribute('aria-pressed',String(placeVariant===v.index));
        b.title=`Variant ${v.localIndex+1}${typeLabel(v.kind,v.params)?' · '+typeLabel(v.kind,v.params):''}`; b.setAttribute('aria-label',b.title);
        const c=doc.createElement('canvas'); c.width=c.height=48; b.append(c); b.onclick=() => { placeVariant=v.index; update(); }; return b;
      }));
    }
    for (const b of host.querySelectorAll('button[data-variant]')) {
      const v=list.find(v => v.index===Number(b.dataset.variant)),c=b.querySelector('canvas'); if (!v || c.dataset.drawn) continue;
      const image=thumbnail(v); if (!image) continue;
      const g=c.getContext('2d'),k=Math.min(1,46/Math.max(image.width,image.height)); g.imageSmoothingEnabled=k<1; g.clearRect(0,0,48,48);
      g.drawImage(image,0,0,image.width,image.height,(48-image.width*k)/2,(48-image.height*k)/2,image.width*k,image.height*k); c.dataset.drawn='1';
    }
  }
  // A variant's picture for its button: the body and shadow, or a deposit or vent painted on the world's mean ground.
  function thumbnail(v) {
    if (!GROUND_KINDS.includes(v.kind)) {
      const e=sprite(v); if (!e) return null;
      const k=spriteKey(v,light());
      let t=thumbs.get(k);
      if (!t) {
        const x0=Math.min(-e.body.ax,e.shadow?-e.shadow.ax:0),y0=Math.min(-e.body.ay,e.shadow?-e.shadow.ay:0),x1=Math.max(e.body.w-e.body.ax,e.shadow?e.shadow.w-e.shadow.ax:0),y1=Math.max(e.body.h-e.body.ay,e.shadow?e.shadow.h-e.shadow.ay:0);
        t=new OffscreenCanvas(x1-x0,y1-y0); const g=t.getContext('2d');
        if (e.shadow) { g.globalAlpha=e.shadowBlend; g.drawImage(e.shadow.bitmap,-x0-e.shadow.ax,-y0-e.shadow.ay); }
        g.globalAlpha=e.bodyBlend; g.drawImage(e.body.bitmap,-x0-e.body.ax,-y0-e.body.ay); thumbs.set(k,t);
      }
      return t;
    }
    const params=v.kind==='deposit'?{...v.params,metal:depositMetal()}:v.params,sun=light(),k='ground|'+v.kind+'|'+v.seed+'|'+JSON.stringify(params)+'|'+lightKey(sun);
    const t=thumbs.get(k); if (t) return t.ready?t.canvas:null;
    const entry={ready:false}; thumbs.set(k,entry);
    const rgba=flatGround(); for (let i=3;i<rgba.length;i+=4) rgba[i]=255;
    work({type:'paint',kind:v.kind,params,seed:v.seed,light:sun,w:PATCH,h:PATCH,cx:PATCH/2,cy:PATCH/2,rgba},[rgba.buffer]).then(r => {
      const c=new OffscreenCanvas(80,80); c.getContext('2d').putImageData(new ImageData(r.rgba,PATCH,PATCH),-24,-24); Object.assign(entry,{ready:true,canvas:c,close:nothing}); refreshVariants();
    },err => { if (err.lost && thumbs.get(k)===entry) thumbs.delete(k); });
    return null;
  }
  // The selection's values (#feature-selection in the Select tool's panel).
  function refreshSelection() {
    const list=[...selection],box=$('feature-selection'); if (!box) return;
    const counts=new Map(); for (const p of list) counts.set(p.kind,(counts.get(p.kind)||0)+1);
    const deposits=list.filter(deposit),one=list.length===1?list[0]:null;
    let title='',values='';
    if (one) {
      const v=variantOf(one),[fw,fz]=v.footprint,type=typeLabel(one.kind,v.params),e=sprite(v),g=e?.gameplay,cells=`${fw}×${fz} ${fw*fz>1?'cells':'cell'}`;
      title=`${LABELS[one.kind]} · variant ${v.localIndex+1} of ${set[one.kind].recipes.find(r => r.id===v.recipe).count}${type?' · '+type:''}`;
      values={deposit:`${cells} · painted into the ground · metal for extractors on its cells`,vent:`${cells} · painted into the ground · a geothermal plant can stand on it`,
        tree:`${cells} · energy ${g?.energy??'…'} · blocks units · burns to a burnt tree`,shrub:`${cells} · energy ${g?.energy??'…'} · units pass over it · burns`,
        rock:`${cells} · metal ${v.params.metal} · blocks units · reclaimable`,scar:`${cells} · a mark on the ground · no gameplay`}[one.kind];
    } else if (list.length) {
      title=`${list.length} features selected`;
      values=[...counts].map(([kind,n]) => `${n} ${n===1?LABELS[kind].toLowerCase():PLURALS[kind]}`).join(', ');
    }
    $('feature-selection-title').textContent=title; $('feature-selection-values').textContent=values;
    $('feature-selection-metal-control').hidden=!deposits.length;
    const metal=$('feature-selection-metal');
    if (doc.activeElement!==metal) {
      const mixed=!deposits.length || !deposits.every(p => p.metal===deposits[0].metal);
      metal.dataset.unset=String(mixed);metal.dataset.unsetLabel='Mixed';metal.value=String(deposits[0]?.metal??0);
      showNumericValue(metal);
    }
    $('feature-reroll').disabled=!list.some(p => variantList(p.kind).filter(v => v.recipe===recipeId(p.v)).length>1);
    $('feature-reroll').title=$('feature-reroll').disabled?(list.length?'Each selected feature’s style has one variant: raise its Variants to re-roll it.':'Select a feature to re-roll it.'):'Swap for another variant of the same kind';
  }
  function selectionChanged() { refreshSelection(); doc.dispatchEvent(new Event('terraform-feature-mode')); api.schedule(); }
  function changed(text) { serialized=null; status(text); prune(); refreshSelection(); update(); api.change(); doc.dispatchEvent(new Event('terraform-feature-mode')); }
  function activate(next) {
    if (!guard()) return false;
    finishGesture(false);
    if (GROUND_KINDS.includes(next) || set[next]) { placeKind=next; placeVariant=-1; next='place'; }
    mode=next; hover=null; clearSelection(false); update(); doc.dispatchEvent(new Event('terraform-feature-mode')); return true;
  }
  function deactivate() { const wasActive=Boolean(mode)||selection.size>0; finishGesture(false); mode=''; hover=null; clearSelection(false); update(); if (wasActive) doc.dispatchEvent(new Event('terraform-feature-mode')); }
  function clearSelection(notify=true) { if (!selection.size) return; selection=new Set(); if (notify) selectionChanged(); else refreshSelection(); }

  for (const [name,button] of buttons) button.onclick=() => activate(name);
  // The kind tabs press the list behind them (#feature-kind), so its guard applies.
  for (const tab of kindTabs) { tab.onkeydown=e=>{if(!['ArrowRight','ArrowDown','ArrowLeft','ArrowUp','Home','End'].includes(e.key))return;e.preventDefault();const tabs=kindTabs.filter(b=>!b.disabled),i=tabs.indexOf(tab),next=e.key==='Home'?0:e.key==='End'?tabs.length-1:(i+(e.key==='ArrowRight'||e.key==='ArrowDown'?1:-1)+tabs.length)%tabs.length;tabs[next].click();tabs[next].focus();}; tab.onclick=() => { const list=$('feature-kind'); list.value=tab.dataset.featureKind; list.dispatchEvent(new Event('change')); }; }
  $('feature-kind').onchange=event => { if (!guard()) { update(); return; } placeKind=event.target.value; placeVariant=-1; status(''); update(); doc.dispatchEvent(new Event('terraform-feature-mode')); };
  $('feature-recipe').onchange=event => {if(!guard())return;activeRecipes[placeKind]=Number(event.target.value);placeVariant=-1;update();};
  $('feature-recipe-name').onchange=event => {if(!changeSet(placeKind,{name:event.target.value}))update();};
  $('feature-add-recipe').onclick=() => {const preset=featureCatalog(config,placeKind).find(p => p.id===$('feature-preset').value);if(preset)addRecipe(placeKind,preset);};
  $('feature-duplicate-recipe').onclick=() => addRecipe(placeKind,null,true);
  $('feature-remove-recipe').onclick=removeRecipe;
  for(const input of paramInputs)input.onchange=() => {
    const kind=input.dataset.paramKind, k=input.dataset.param, params={...activeRecipe(kind).params};
    if(input.value==='' || input.dataset.unset==='true') delete params[k];
    else params[k]=input.tagName==='SELECT'||input.type==='color'?input.value:Number(input.value)/(Number(input.dataset.paramScale)||1);
    if(!changeSet(kind,{params}))update();
  };
  $('feature-count').onchange=event => { if (!changeSet(placeKind,{count:Number(event.target.value)})) update(); };
  $('feature-new-set').onclick=() => { if (!guard()) return; const seed=hash32(activeRecipe().seed,Date.now()>>>0); changeSet(placeKind,{seed},`New variants of ${activeRecipe().name}; its placed features take the new looks.`); };
  for (const input of settingInputs) {
    const [kind,name,end]=input.dataset.setting.split('.');
    input.addEventListener('input',() => showNumericValue(input));
    input.addEventListener('change',() => {
      const value=input.type==='color'?input.value:Number(input.value); if (input.type!=='color' && !Number.isFinite(value)) { update(); return; }
      const next=end===undefined?value:Object.assign([...activeRecipe(kind)[name]],{[Number(end)]:value});
      if (!changeSet(kind,{[name]:next})) update();
    });
  }
  $('start-list').onchange=event => { if (!guard()) { update(); return; } selectedStart=Number(event.target.value); activate('starts'); };
  $('start-remove').onclick=() => removeStart(selectedStart);
  $('fill-kind').onchange=event => { if (setFill({kind:event.target.value})) activate('fill'); };
  for(const button of doc.querySelectorAll('[data-fill-region]'))button.onclick=()=>{if(setFill({region:button.dataset.fillRegion}))activate('fill');};
  $('fill-region').onchange=event => { if (setFill({region:event.target.value})) activate('fill'); };
  const fillInputs=new Map(['density','clustering','gap','seed','margin','radius'].map(name => [name,$('fill-'+name)]));
  for (const [name,input] of fillInputs) input.onchange=() => { if (!setFill({[name]:Number(input.value)})) update(); };
  $('feature-selection-metal').onchange=event => { const value=Number(event.target.value); if (event.target.value.trim()==='' || !Number.isFinite(value)) { refreshSelection(); return; } setSelectedMetal(value); };
  $('feature-reroll').onclick=() => rerollSelected();
  $('feature-delete').onclick=() => removeSelected();

  // ---- edits ----
  // Edit only the active recipe. Validate the whole placement set before committing:
  // a larger footprint must never silently overlap or delete an authored feature.
  function commitSet(next, text) {
    const previous=set, oldPlacements=placements, oldFootprints=placements.map(footprint);
    set=normalizeSet(next,config);
    const moved=placements.map((p,i) => {
      if(variantOf(p)) return {...p};
      const pool=variantList(p.kind).filter(v => v.recipe===recipeId(p.v));
      const same=pool.filter(v => v.footprint.every((size,j) => size===oldFootprints[i][j])), choices=same.length?same:pool;
      return choices.length?{...p,v:choices[p.v%MAX_VARIANTS%choices.length].index}:null;
    });
    const resized=moved.filter((p,i) => p && footprint(p).some((size,j) => size!==oldFootprints[i][j]));
    const mask=resized.some(p => generated.has(key(p)))?terrainMask():null;
    if(moved.some(p => !p) || resized.some(p => !inBounds(p) || moved.some(q => q!==p && overlaps(p,q))) || resized.some(p => generated.has(key(p)) && (!gentleFootprint(p,mask) || nearMargin(p,fill.margin,moved) || moved.some(q => q!==p && overlaps(p,q,fill.gap))))) {
      set=previous; status('This style would make placed features overlap, leave the map, or violate fill placement rules. Move those features before changing its footprint.'); update(); return false;
    }
    placements=moved; selection=new Set(oldPlacements.flatMap((p,i) => selection.has(p)?[moved[i]]:[]));
    if(!activeList().some(v => v.index===placeVariant))placeVariant=-1;
    changed(text); return true;
  }
  function changeSet(kind,edit,text) {
    if (!guard() || !set[kind]) return false;
    const current=activeRecipe(kind), next={...set,[kind]:{...set[kind],recipes:set[kind].recipes.map(r => r.id===current.id?{...r,...edit}:r)}};
    if(JSON.stringify(normalizeSet(next,config))===JSON.stringify(set))return false;
    return commitSet(next,text || `Updated ${current.name}; its placed features take the new look.`);
  }
  function addRecipe(kind, preset, duplicate=false) {
    if(!guard() || !set[kind] || set[kind].recipes.length>=MAX_RECIPES)return false;
    const group=set[kind], id=group.nextId;
    if(id>1000000)return false;
    const recipe=duplicate?{...structuredClone(activeRecipe(kind)),id,name:activeRecipe(kind).name+' copy'}:makeRecipe(kind,preset.data,id,preset.name);
    const next={...set,[kind]:{nextId:id+1,recipes:[...group.recipes,recipe]}};
    if(!commitSet(next,`Added ${recipe.name}.`))return false;
    activeRecipes[kind]=id; placeVariant=-1; update(); return true;
  }
  function removeRecipe() {
    if(!guard())return false;
    const entry=activeRecipe(),group=set[placeKind];
    if(group.recipes.length<=1 || placements.some(p => p.kind===placeKind && recipeId(p.v)===entry.id))return false;
    return commitSet({...set,[placeKind]:{...group,recipes:group.recipes.filter(r => r.id!==entry.id)}},`Removed ${entry.name}.`);
  }
  function addFeature(kind,x,z,options={}) {
    if (!guard()) return false;
    if (!kinds.includes(kind)) { status(`This world has no generated ${PLURALS[kind]||'features of that kind'} yet.`); return false; }
    const list=activeList(kind),v=Number.isInteger(options.v)&&variantList(kind).some(v => v.index===options.v)?options.v:pickVariant(list,hash32(hash32(x,z),++rolls)/4294967296);
    const p={kind,v,x,z}; if (kind==='deposit') p.metal=Math.round(clamp(Number.isFinite(options.metal)?options.metal:depositMetal(),0,255));
    if (options.generated && !scatter(p)) { status('Only trees, shrubs and rocks belong to a fill.'); return false; }
    if (!inBounds(p)) { status('The whole feature footprint must fit inside the play area.'); return false; }
    let list2=placements,removed=0;
    if (deposit(p)) list2=placements.filter(q => { const drop=generated.has(key(q)) && scatter(q) && rectDistance(rectangle(p),rectangle(q))<fill.margin; if (drop) { removed++; selection.delete(q); } return !drop; });
    if (list2.some(q => overlaps(p,q))) { status('That footprint overlaps another feature.'); return false; }
    if (options.generated && (!gentleFootprint(p,terrainMask()) || nearMargin(p,fill.margin) || placements.some(q => overlaps(p,q,fill.gap)))) { status('Fill needs gentle dry ground, a free footprint and the selected margins.'); return false; }
    const kept=new Set(list2.map(key)); for (const k of generated) if (!kept.has(k)) generated.delete(k);
    placements=[...list2,p]; rolls++; if (options.generated) generated.add(key(p));
    changed(`Placed ${LABELS[kind].toLowerCase()} ${v%MAX_VARIANTS+1} of ${list.length}${removed?`; cleared ${removed} fill features inside its margin`:''}.`); return true;
  }
  function removeFeature(index,notify=true) {
    if (!guard() || !Number.isInteger(index) || index<0 || index>=placements.length) return false;
    const [p]=placements.splice(index,1); generated.delete(key(p)); selection.delete(p);
    if (notify) changed(`Removed ${LABELS[p.kind].toLowerCase()}.`); else api.schedule(); return true;
  }
  function removeSelected() {
    if (!guard() || !selection.size) return false;
    const n=selection.size; placements=placements.filter(p => { const drop=selection.has(p); if (drop) generated.delete(key(p)); return !drop; }); selection=new Set();
    changed(`Deleted ${n} ${n===1?'feature':'features'}.`); return true;
  }
  // Re-roll: another variant of the same kind and footprint (any other footprint that still fits when it has none).
  function rerollSelected() {
    if (!guard() || !selection.size) return false;
    let swapped=0;
    for (const p of selection) {
      const list=variantList(p.kind).filter(v => v.recipe===recipeId(p.v)),[fw,fz]=footprint(p),others=placements.filter(q => q!==p);
      let pool=list.filter(v => v.index!==p.v && v.footprint[0]===fw && v.footprint[1]===fz);
      if (!pool.length) pool=list.filter(v => v.index!==p.v && inBounds({...p,v:v.index}) && !others.some(q => overlaps({...p,v:v.index},q)));
      if (!pool.length) continue;
      p.v=pickVariant(pool,hash32(hash32(p.x,p.z),++rolls)/4294967296); swapped++;
    }
    if (!swapped) { status('Each selected feature is the only variant of its kind and size.'); return false; }
    changed(`Re-rolled ${swapped} ${swapped===1?'feature':'features'}.`); return true;
  }
  function setSelectedMetal(value) {
    if (!guard()) return false;
    const metal=Math.round(clamp(value,0,255)),list=[...selection].filter(deposit).filter(p => p.metal!==metal);
    if (!list.length) { refreshSelection(); return false; }
    for (const p of list) p.metal=metal;
    changed(`Set ${list.length===1?'the deposit’s':list.length+' deposits’'} metal to ${metal}.`); return true;
  }
  // Moves the selection by whole cells; every moved footprint must stay in the play area and clear of the features left in place.
  function movable(dx,dz) {
    const rest=placements.filter(p => !selection.has(p));
    return [...selection].every(p => { const q={...p,x:p.x+dx,z:p.z+dz}; return inBounds(q) && !rest.some(r => overlaps(q,r)); });
  }
  function moveSelected(dx,dz) {
    if (!guard() || !selection.size || (!dx && !dz)) return false;
    if (!movable(dx,dz)) { status('That move would leave the play area or overlap a feature.'); return false; }
    // Old keys go first, so a feature moving onto a cell another one leaves keeps its own fill mark and painted stamp.
    const carried=[...selection].map(p => { const before=key(p),entry={p,fill:generated.delete(before),stamp:stamps.get(before)}; stamps.delete(before); return entry; });
    for (const {p,fill:wasFill,stamp} of carried) { p.x+=dx; p.z+=dz; if (wasFill) generated.add(key(p)); if (stamp) { stamp.exactStale=true; stamps.set(key(p),stamp); } }
    changed(`Moved ${selection.size} ${selection.size===1?'feature':'features'} ${Math.abs(dx)+Math.abs(dz)===1?'one cell':'by '+dx+', '+dz+' cells'}.`); return true;
  }
  function addStart(x,z) {
    if (!guard()) return false;
    const p={x:Math.round(x),z:Math.round(z)};
    if (!validStart(p)) { status('A start must lie inside the play area.'); return false; }
    if (starts.length>=MAX_STARTS) { status(`A map can have at most ${MAX_STARTS} starts. Move or remove an existing start.`); return false; }
    if (starts.some(s => s.x===p.x && s.z===p.z)) { status('Another start is already at that position.'); return false; }
    starts.push(p); selectedStart=starts.length-1; const trimmed=trimGenerated(); placements=trimmed.kept;
    changed(`Added start ${selectedStart+1}${trimmed.removed?`; cleared ${trimmed.removed} fill features inside its margin`:''}.`); return true;
  }
  function moveStart(index,x,z) {
    if (!guard() || !Number.isInteger(index) || index<0 || index>=starts.length) return false;
    const p={x:Math.round(x),z:Math.round(z)};
    if (!validStart(p)) { status('A start must lie inside the play area.'); return false; }
    if (starts.some((s,i) => i!==index && s.x===p.x && s.z===p.z)) { status('Another start is already at that position.'); return false; }
    if (starts[index].x===p.x && starts[index].z===p.z) { update(); return true; }
    starts[index]=p; selectedStart=index; const trimmed=trimGenerated(); placements=trimmed.kept;
    changed(`Moved start ${index+1}${trimmed.removed?`; cleared ${trimmed.removed} fill features inside its margin`:''}.`); return true;
  }
  function removeStart(index) {
    if (!guard() || !Number.isInteger(index) || index<0 || index>=starts.length) return false;
    if (starts.length<=1) { status('Keep at least one start position.'); return false; }
    starts.splice(index,1); selectedStart=Math.min(index,starts.length-1); changed('Removed the selected start.'); return true;
  }
  function setFill(value) {
    if (!guard()) return false;
    if (value.kind && !kinds.includes(value.kind)) { status(`This world has no generated ${PLURALS[value.kind]} yet.`); update(); return false; }
    const before=JSON.stringify(fill);
    fill=fillOptions(value,fill);
    const trimmed=trimGenerated(); placements=trimmed.kept;
    if (!trimmed.removed && JSON.stringify(fill)===before) { update(); return true; }   // nothing changed: no undo step
    changed(trimmed.removed?`Updated fill; cleared ${trimmed.removed} generated features inside the margin.`:'Updated fill controls.'); return true;
  }

  function terrainMask(bounds={x0:0,z0:0,x1:cols,z1:rows}) {
    const corners=new Int16Array((cols+1)*(rows+1)),gentle=new Uint8Array(cols*rows),stride=cols+1;
    for (let z=bounds.z0;z<=bounds.z1;z++) for (let x=bounds.x0;x<=bounds.x1;x++) corners[z*stride+x]=corner(x,z);
    // internal/mapgen/resources.go gentleLand: every covered cell has four
    // dry exported bytes with a corner difference of at most 10.
    for (let z=bounds.z0;z<bounds.z1;z++) for (let x=bounds.x0;x<bounds.x1;x++) {
      const i=z*stride+x,a=corners[i],b=corners[i+1],c=corners[i+stride],d=corners[i+stride+1],lo=Math.min(a,b,c,d);
      gentle[z*cols+x]=lo>config.seaLevel && Math.max(a,b,c,d)-lo<=10?1:0;
    }
    return gentle;
  }
  function gentleFootprint(p,mask) {
    const [fw,fz]=footprint(p);
    for (let z=p.z;z<p.z+fz;z++) for (let x=p.x;x<p.x+fw;x++) if (!mask[z*cols+x]) return false;
    return true;
  }
  function regionMask(region,gentle,bounds) {
    const mask=new Uint8Array(cols*rows),points=(region?.points||[]).map(p => Array.isArray(p)?{x:p[0],z:p[1]}:{x:p.x,z:p.z});
    if (points.some(p => !Number.isFinite(p.x) || !Number.isFinite(p.z))) throw new Error('The fill region contains an invalid point.');
    if (region?.type==='flood') {
      const x=Math.floor(region.x/CELL),z=Math.floor(region.z/CELL);
      if (x<0 || z<0 || x>=cols || z>=rows || !gentle[z*cols+x]) return mask;
      const todo=[z*cols+x]; mask[todo[0]]=1;
      for (let at=0;at<todo.length;at++) {
        const i=todo[at],xx=i%cols,zz=Math.floor(i/cols);
        for (const [nx,nz] of [[xx-1,zz],[xx+1,zz],[xx,zz-1],[xx,zz+1]]) if (nx>=0 && nz>=0 && nx<cols && nz<rows) { const j=nz*cols+nx; if (gentle[j] && !mask[j]) { mask[j]=1; todo.push(j); } }
      }
      return mask;
    }
    if (region?.type==='lasso' && points.length<3 || region?.type==='brush' && !points.length) return mask;
    if (!['brush','lasso'].includes(region?.type)) throw new Error('Choose a brush, lasso or flood region.');
    const radius=Number.isFinite(region.radius)?Math.max(0,region.radius):fill.radius;
    for (let z=bounds.z0;z<bounds.z1;z++) for (let x=bounds.x0;x<bounds.x1;x++) {
      const p={x:x*CELL+8,z:z*CELL+8};
      mask[z*cols+x]=region.type==='lasso'?Number(insidePolygon(p,points)):Number(points.some((q,i) => Math.hypot(p.x-q.x,p.z-q.z)<=radius || i>0 && segmentDistance(p,points[i-1],q)<=radius));
    }
    return mask;
  }
  function fillRegion(kind,region,options={}) {
    if (!guard()) return {added:0};
    const settings=fillOptions({...options,kind},fill),list=kinds.includes(settings.kind)?variantList(settings.kind):[];
    if (!list.length) { status(`This world has no generated ${PLURALS[settings.kind]} to fill.`); return {added:0}; }
    const bounds=featureRegionBounds(region,cols,rows,fill.radius),gentle=terrainMask(bounds),area=regionMask(region,gentle,bounds),candidates=[];
    // Acceptance depends only on the cell and seed. Reject it before sorting;
    // accepted candidates retain exactly the same relative placement order.
    for (let z=bounds.z0;z<bounds.z1;z++) for (let x=bounds.x0;x<bounds.x1;x++) if (area[z*cols+x]) {
      const cluster=clamp((noise(x/12,z/12,settings.seed^0x713c6a91)-.25)*2,0,1),probability=settings.density/100*(1-settings.clustering+settings.clustering*cluster*2);
      if (hash(x,z,settings.seed^0x517ad0f3)<probability) candidates.push({x,z,rank:hash(x,z,settings.seed^0x34da72f1)});
    }
    candidates.sort((a,b) => a.rank-b.rank || a.z-b.z || a.x-b.x);
    const occupied=new Uint8Array(cols*rows),put=p => { const [fw,fz]=footprint(p); for (let z=p.z;z<p.z+fz;z++) for (let x=p.x;x<p.x+fw;x++) occupied[z*cols+x]=1; };
    for (const p of placements) put(p);
    const deposits=placements.filter(deposit);
    let added=0;
    for (const c of candidates) {
      // The variants' weights carry retail's use shares (sculpt-feature-set.js). Position-keyed authoring randomness keeps a repeatable mix.
      const placed={kind:settings.kind,v:pickVariant(list,hash(c.x,c.z,settings.seed^0x25cd781b)),x:c.x,z:c.z},[fw,fz]=footprint(placed);
      if (!inBounds(placed) || !gentleFootprint(placed,gentle) || nearMargin(placed,settings.margin,deposits)) continue;
      let free=true;
      for (let z=c.z;z<c.z+fz && free;z++) for (let x=c.x;x<c.x+fw;x++) if (!area[z*cols+x]) { free=false; break; }
      for (let z=Math.max(0,c.z-settings.gap);z<Math.min(rows,c.z+fz+settings.gap) && free;z++) for (let x=Math.max(0,c.x-settings.gap);x<Math.min(cols,c.x+fw+settings.gap);x++) if (occupied[z*cols+x]) { free=false; break; }
      if (!free) continue;
      placements.push(placed); generated.add(key(placed)); put(placed); added++;
    }
    if (added) changed(`Filled ${added} ${PLURALS[settings.kind]}.`); else status('No features fit this region with the current density, terrain, spacing and margins.');
    return {added};
  }

  // Its parts are shared, never changed: a reader that wants to edit them copies them (load does).
  function serialize() {
    if (serialized) return {...serialized};
    const plain=p => { const out={kind:p.kind,v:p.v,x:p.x,z:p.z}; if (deposit(p)) out.metal=p.metal; return out; };
    serialized={features:placements.map(plain).sort(ordered),featureSet:structuredClone(set),starts:starts.map(p => ({...p})),fill:{...fill,generated:placements.filter(p => generated.has(key(p))).map(plain).sort(ordered)}};
    return {...serialized};
  }
  // A saved feature that does not fit this world or map is left out, said once.
  function load(data={}) {
    if (serialized && ['features','featureSet','starts','fill'].every(k => data[k]===serialized[k])) return;   // what this module holds now
    const nextSet=normalizeSet(data.featureSet ?? config.featureSet,config),nextStarts=(data.starts===undefined?defaults():data.starts),nextFill=fillOptions(data.fill||{});
    if (!Array.isArray(data.features??[]) || !Array.isArray(nextStarts) || nextStarts.length<1 || nextStarts.length>10) throw new Error('Map placements need a feature list and 1–10 starts.');
    const bases=nextStarts.map(p => ({x:p?.x,z:p?.z}));
    if (bases.some((p,i) => !validStart(p) || bases.some((q,j) => j<i && p.x===q.x && p.z===q.z))) throw new Error('Every start must be a distinct pixel position inside the play area.');
    set=nextSet;
    // The cells the features kept so far cover: a feature that overlaps one of them is left out, in the list's order (as testing it against each).
    const next=[],taken=new Uint8Array(cols*rows); let unfit=0;
    const free=p => { const [fw,fz]=footprint(p); for (let z=p.z;z<p.z+fz;z++) for (let x=p.x;x<p.x+fw;x++) if (taken[z*cols+x]) return false; return true; };
    for (const raw of data.features||[]) {
      const p=normalizePlacement(raw);
      if (!p) { unfit++; continue; }
      if (!kinds.includes(p.kind)) { unfit++; continue; }
      const list=variantList(p.kind); if (!list.some(v => v.index===p.v)) { unfit++; continue; }
      if (!inBounds(p) || !free(p)) { unfit++; continue; }
      const [fw,fz]=footprint(p); for (let z=p.z;z<p.z+fz;z++) taken.fill(1,z*cols+p.x,z*cols+p.x+fw);
      next.push(p);
    }
    const recorded=new Set((Array.isArray(data.fill?.generated)?data.fill.generated:[]).map(normalizePlacement).filter(Boolean).map(key));
    const previousGesture=gesture; gesture=null;
    if (previousGesture && canvas.hasPointerCapture?.(previousGesture.id)) canvas.releasePointerCapture(previousGesture.id);
    serialized=null; placements=next; starts=bases; fill=nextFill; generated=new Set(next.filter(p => scatter(p) && recorded.has(key(p))).map(key));
    selection=new Set(); selectedStart=Math.min(Math.max(0,selectedStart),starts.length-1); hover=null;
    if (!activeList().some(v => v.index===placeVariant)) placeVariant=-1;
    if (unfit) { status(`${unfit} saved ${unfit===1?'feature does':'features do'} not fit this world or map and ${unfit===1?'was':'were'} left out.`); doc.dispatchEvent(new CustomEvent('terraform-status',{detail:message})); }
    prune(); refreshSelection(); update(); doc.dispatchEvent(new Event('terraform-feature-mode'));
  }

  // ---- pointer and keys ----
  function screenPoint(event) { if (api.screenPoint) return api.screenPoint(event); const r=canvas.getBoundingClientRect(); return {x:(event.clientX-r.left)*canvas.width/r.width,z:(event.clientY-r.top)*canvas.height/r.height}; }
  function pick(p) { const q=api.pick(p.x,p.z); return q && Number.isFinite(q[0]) && Number.isFinite(q[1]) && q[0]>=0 && q[1]>=0 && q[0]<map.playRight && q[1]<map.playBottom?{x:q[0],z:q[1]}:null; }
  function hitFeature(p) { const x=Math.floor(p.x/CELL),z=Math.floor(p.z/CELL); return placements.findIndex(q => { const [fw,fz]=footprint(q); return x>=q.x && x<q.x+fw && z>=q.z && z<q.z+fz; }); }
  function hitStart(screen) { let found=-1,distance=16; starts.forEach((s,i) => { const p=project(s),d=Math.hypot(screen.x-p.x,screen.z-p.z); if (d<distance) { distance=d; found=i; } }); return found; }
  const drawOrder=(a,b) => (a.z*CELL+footprint(a)[1]*8)-(b.z*CELL+footprint(b)[1]*8) || ordered(a,b);
  // The feature under a screen point, the frontmost first: a drawn body pixel, then a body's box, then a deposit's or vent's
  // footprint, then any footprint under the picked ground cell.
  function hitAt(screen) {
    const near=placements.filter(p => Math.abs(p.x*CELL+8-screen.x)<112 && screen.z>p.z*CELL-160 && screen.z<p.z*CELL+200).filter(p => { const a=viewPoint(p); return a && Math.abs(a.x-screen.x)<96 && screen.z<a.y+96 && screen.z>a.y-128; }).sort(drawOrder).reverse();
    for (const pass of [0,1]) for (const p of near) {
      if (GROUND_KINDS.includes(p.kind)) continue;
      const e=sprite(variantOf(p)); if (!e) continue;
      const a=viewPoint(p),x=Math.floor(screen.x)-(a.x-e.body.ax),y=Math.floor(screen.z)-(a.y-e.body.ay),pad=pass?2:0;
      if (x>=-pad && y>=-pad && x<e.body.w+pad && y<e.body.h+pad && (pass || e.body.alpha[y*e.body.w+x])) return p;
    }
    for (const p of near) if (GROUND_KINDS.includes(p.kind)) { const a=viewPoint(p),[fw,fz]=footprint(p); if (a && Math.abs(screen.x-a.x)<=fw*8+4 && Math.abs(screen.z-a.y)<=fz*8+4) return p; }
    const ground=pick(screen),i=ground?hitFeature(ground):-1;
    return i>=0?placements[i]:null;
  }
  // The Select tool (V): sculpt-canvas.js asks first, before shapes. A click selects (Shift adds or removes), a drag moves the
  // selection on the cell grid.
  function pointerSelect(event,screen) {
    if (mode || !enabled()) return false;
    const p=hitAt(screen);
    if (!p) { if (!event.shiftKey) clearSelection(); return false; }
    if (event.shiftKey) { if (selection.has(p)) selection.delete(p); else selection.add(p); }
    else if (!selection.has(p)) selection=new Set([p]);
    api.deselectShapes?.(); selectionChanged();
    if (selection.has(p)) { const at=pick(screen); if (at) gesture={id:event.pointerId,type:'drag',origin:at,delta:{x:0,z:0},valid:true}; }
    status(selection.size===1?`Selected ${LABELS[p.kind].toLowerCase()}. Drag to move it; Delete removes it.`:`${selection.size} features selected.`);
    return true;
  }
  const stop=event => { event.preventDefault(); event.stopImmediatePropagation(); };
  function finishGesture(commit=true) {
    const g=gesture; gesture=null;
    if (!g) return;
    if (canvas.hasPointerCapture?.(g.id)) canvas.releasePointerCapture(g.id);
    if (g.type==='erase' && g.changed) changed('Erased feature footprints.');
    if (commit && enabled()) {
      if (g.type==='fill') fillRegion(fill.kind,{type:fill.region,points:g.points,radius:fill.radius});
      else if (g.type==='start' && g.target) moveStart(g.index,g.target.x,g.target.z);
      else if (g.type==='drag' && (g.delta.x || g.delta.z)) moveSelected(g.delta.x,g.delta.z);
    }
    update();
  }
  canvas.addEventListener('pointerdown',event => {
    if (!mode) return;
    if (gesture) { stop(event); return; }
    if (event.altKey && event.button===0) return;   // Alt-click is Pick's, from any tool (sculpt-canvas.js passes it to sculpt.js pickHere)
    // A pan that starts in the terrain handler stays there through release,
    // even if Space is released before the pointer. Do not strand its capture.
    if (space || event.button===1) { panPointers.add(event.pointerId); return; }
    if (event.button!==0) return;
    stop(event); if (!guard()) return;
    const screen=screenPoint(event),p=pick(screen); hover=p;
    if (mode==='starts') {
      const hit=hitStart(screen);
      if (hit>=0) { selectedStart=hit; gesture={id:event.pointerId,type:'start',index:hit,origin:screen,target:null}; }
      else if (p && event.shiftKey && selectedStart>=0) moveStart(selectedStart,p.x,p.z);
      else if (p) addStart(p.x,p.z);
    } else if (p && mode==='erase') { gesture={id:event.pointerId,type:'erase',changed:false}; const i=hitFeature(p); if (i>=0) { removeFeature(i,false); gesture.changed=true; } }
    else if (p && mode==='fill') {
      if (fill.region==='flood') fillRegion(fill.kind,{type:'flood',...p});
      else gesture={id:event.pointerId,type:'fill',points:[p]};
    } else if (p && mode==='place') { const at=placeAt(p); addFeature(placeKind,at.x,at.z,{v:at.v}); }
    if (gesture) canvas.setPointerCapture(event.pointerId); update();
  },true);
  canvas.addEventListener('pointermove',event => {
    if (gesture?.type==='drag' && gesture.id===event.pointerId) {
      stop(event); if (!enabled()) { finishGesture(false); return; }
      const at=pick(screenPoint(event)); if (!at) return;
      const delta={x:Math.round((at.x-gesture.origin.x)/CELL),z:Math.round((at.z-gesture.origin.z)/CELL)};
      if (delta.x!==gesture.delta.x || delta.z!==gesture.delta.z) { gesture.delta=delta; gesture.valid=movable(delta.x,delta.z); }
      api.schedule(); return;
    }
    if (!mode || panPointers.has(event.pointerId) || space && !gesture || event.buttons===4) return;
    if (gesture && gesture.id!==event.pointerId) { stop(event); return; }
    stop(event); const screen=screenPoint(event),p=pick(screen); hover=p;
    if (gesture?.id===event.pointerId) {
      if (!enabled()) { finishGesture(false); return; }
      if (p && gesture.type==='fill' && Math.hypot(p.x-gesture.points.at(-1).x,p.z-gesture.points.at(-1).z)>=4) gesture.points.push(p);
      else if (p && gesture.type==='start' && Math.hypot(screen.x-gesture.origin.x,screen.z-gesture.origin.z)>=2) gesture.target=p;
      else if (p && gesture.type==='erase') { const i=hitFeature(p); if (i>=0) { removeFeature(i,false); gesture.changed=true; } }
    }
    api.schedule();
  },true);
  for (const type of ['pointerup','pointercancel','lostpointercapture']) canvas.addEventListener(type,event => {
    if (panPointers.has(event.pointerId)) { panPointers.delete(event.pointerId); return; }
    if (gesture?.id===event.pointerId) {
      stop(event);
      if (type==='pointerup' && enabled() && gesture.type!=='drag') {
        const screen=screenPoint(event),p=pick(screen);
        if (p && gesture.type==='fill' && Math.hypot(p.x-gesture.points.at(-1).x,p.z-gesture.points.at(-1).z)>0) gesture.points.push(p);
        else if (p && gesture.type==='start' && Math.hypot(screen.x-gesture.origin.x,screen.z-gesture.origin.z)>=2) gesture.target=p;
        else if (p && gesture.type==='erase') { const i=hitFeature(p); if (i>=0) { removeFeature(i,false); gesture.changed=true; } }
      }
      if (gesture.type==='drag' && type==='pointerup' && !gesture.valid && (gesture.delta.x || gesture.delta.z)) { status('That move would leave the play area or overlap a feature.'); finishGesture(false); return; }
      finishGesture(type==='pointerup');
    } else if (mode && !space && event.button===0 && type!=='lostpointercapture') stop(event);
  },true);
  canvas.addEventListener('pointerleave',() => { if (!gesture) { hover=null; api.schedule(); } },true);
  const typing=target => ['INPUT','SELECT','TEXTAREA'].includes(target?.tagName) || target?.isContentEditable;
  doc.addEventListener('keydown',event => {
    if (typing(event.target) || doc.querySelector('dialog:modal')) return;   // a modal dialog (sculpt.js) has the keys
    if (event.code==='Space') { if (event.target?.tagName!=='BUTTON') space=true; return; }
    if (!mode && selection.size && !event.metaKey && !event.ctrlKey && !event.altKey) {
      if (['Delete','Backspace'].includes(event.key)) { stop(event); if (!event.repeat) removeSelected(); return; }
      if (event.key==='Escape') { stop(event); if (gesture) finishGesture(false); else clearSelection(); return; }
    }
    if (!mode) return;
    // Undo and Redo (sculpt.js) act with the tool still in hand; a gesture under way is dropped first.
    if ((event.metaKey||event.ctrlKey) && event.key.toLowerCase()==='z') { if (gesture) finishGesture(false); return; }
    if (event.key==='Escape') { if (doc.querySelector('#map-features-panel details.top-menu[open]')) return;   // the open menu closes first (sculpt-ui.js closeTop)
      stop(event); deactivate(); }
    else if (['Delete','Backspace'].includes(event.key)) { stop(event); if (!event.repeat && mode==='starts') removeStart(selectedStart); }
  },true);
  doc.addEventListener('keyup',event => { if (event.code==='Space') space=false; },true);
  doc.defaultView?.addEventListener('blur',() => { space=false; panPointers.clear(); finishGesture(false); });

  // What a click on a ground point places: the chosen variant, or a random one drawn for the cell (the same until something is placed,
  // so the outline under the pointer is the footprint the click makes), centred on the cell.
  function placeAt(p) {
    const list=activeList(),cx=Math.floor(p.x/CELL),cz=Math.floor(p.z/CELL),v=placeVariant>=0?placeVariant:pickVariant(list,hash32(hash32(cx,cz),rolls+1)/4294967296);
    const [fw,fz]=list.find(q => q.index===v)?.footprint||[1,1]; return {kind:placeKind,v,x:Math.floor(cx-(fw-1)/2),z:Math.floor(cz-(fz-1)/2)};
  }
  function draw(ink,view=null) {
    controls.disabled=!enabled(); ink.save(); ink.imageSmoothingEnabled=false;
    const drag=gesture?.type==='drag'?gesture.delta:null;
    // Before the height samples: a feature's art reaches at most 160 px around its cell and 128 px up with the ground's height.
    const seen=p => { if (!view) return true; const x=p.x*CELL,z=p.z*CELL+config.baseHeight/2; return x+224>=view.x && x-160<=view.x+view.width && z+224>=view.y && z-320<=view.y+view.height; };
    const shown=[];
    for (const source of placements) { const p=drag && selection.has(source)?{...source,x:source.x+drag.x,z:source.z+drag.z}:source; if (seen(p)) shown.push({p,source,row:p.z*CELL+footprint(p)[1]*8}); }
    shown.sort((a,b) => a.row-b.row || ordered(a.p,b.p));
    // Deposits and vents are ground: under every sprite, in row order (as the export paints them).
    for (const {p,source} of shown) {
      if (!GROUND_KINDS.includes(p.kind)) continue;
      const o=groundOrigin(p); if (!o) continue;   // no height read here yet (anchor); a dragged copy has no exact anchor yet: the view's height places it
      const s=stampFor(source);
      if (s.bitmap) ink.drawImage(s.bitmap,o.ox,o.oy+shift);
      else outline(p,'#b8eef3',[3,3]);
    }
    for (const {p} of shown) {
      if (GROUND_KINDS.includes(p.kind)) continue;
      const a=viewPoint(p); if (!a) continue;   // no height read here yet (anchor)
      const e=sprite(variantOf(p)); if (!e) { outline(p,'#b8eef3',[3,3]); continue; }
      if (e.shadow) { ink.globalAlpha=e.shadowBlend; ink.drawImage(e.shadow.bitmap,a.x-e.shadow.ax,a.y-e.shadow.ay); }
      ink.globalAlpha=e.bodyBlend; ink.drawImage(e.body.bitmap,a.x-e.body.ax,a.y-e.body.ay);
    }
    ink.globalAlpha=1;
    function outline(p,color,dash=[]) {
      const r=rectangle(p),points=[{x:r.x0,z:r.z0},{x:r.x1,z:r.z0},{x:r.x1,z:r.z1},{x:r.x0,z:r.z1}].map(project);
      ink.beginPath(); points.forEach((q,i) => i?ink.lineTo(q.x,q.z):ink.moveTo(q.x,q.z)); ink.closePath(); ink.strokeStyle=color; ink.lineWidth=1.5/(view?.scale||1); ink.setLineDash(dash.map(d => d/(view?.scale||1))); ink.stroke(); ink.setLineDash([]);
    }
    for (const {p,source} of shown) if (selection.has(source)) outline(p,drag && !gesture.valid?'#ff877e':'#ffe69c');
    if (hover && mode==='place') {
      const p=placeAt(hover);
      outline(p,inBounds(p) && !placements.some(q => overlaps(p,q))?'#b8eef3':'#ff877e');
    }
    starts.forEach((s,i) => {
      const p=gesture?.type==='start' && gesture.index===i && gesture.target?gesture.target:s;
      // Start positions use clamped TA height bytes: no terrain query is needed
      // when even the full 0–255 projection cannot put the marker in view.
      if(view&&(p.x+16<view.x||p.x-16>view.x+view.width||p.z+config.baseHeight/2+16<view.y||p.z-127+config.baseHeight/2-16>view.y+view.height))return;
      const at=project(p);
      ink.beginPath(); ink.arc(at.x,at.z,12,0,Math.PI*2); ink.fillStyle=mode==='starts' && selectedStart===i?'#ffe69c':'#163240dd'; ink.fill(); ink.lineWidth=2; ink.strokeStyle='#b8eef3'; ink.stroke();
      ink.fillStyle=mode==='starts' && selectedStart===i?'#18221a':'#ffffff'; ink.font='bold 12px sans-serif'; ink.textAlign='center'; ink.textBaseline='middle'; ink.fillText(String(i+1),at.x,at.z);
    });
    if (mode==='fill') {
      ink.strokeStyle='#b8eef3'; ink.lineWidth=1.5; ink.setLineDash([6,4]);
      if (fill.region==='brush' && hover) { const p=project(hover); ink.beginPath(); ink.arc(p.x,p.z,fill.radius,0,Math.PI*2); ink.stroke(); }
      if (gesture?.type==='fill') { ink.beginPath(); gesture.points.map(project).forEach((p,i) => i?ink.lineTo(p.x,p.z):ink.moveTo(p.x,p.z)); if (fill.region==='lasso') ink.closePath(); ink.stroke(); }
    }
    ink.restore(); if (mode) canvas.style.cursor=space?'grab':'crosshair';
  }
  // ---- export: the map's feature pack (export/featurepack.go) and its painted deposits and vents ----
  // Names carry a prefix of the map's own: TF and six base-36 digits of a hash of everything the pack's bytes depend on, the map's
  // name included, so two maps never share a name with different bytes (a feature lookup takes the first definition it finds).
  const base64=bytes => { let text=''; for (let i=0;i<bytes.length;i+=0x8000) text+=String.fromCharCode(...bytes.subarray(i,i+0x8000)); return btoa(text); };
  const frameOf=(s,duration=10) => ({width:s.w,height:s.h,x:s.ax,y:s.ay,duration,pixels:base64(s.idx),opaque:base64(s.a)});
  const hashText=text => { let h=0x811c9dc5; for (let i=0;i<text.length;i++) h=hash32(h,text.charCodeAt(i)); return h; };
  const rockHeight=([fw,fz]) => fw*fz===1?10:fw*fz<=4?15:20;   // retail rocks: 7-20 by size (spec section 4)
  function exportNames(prefix) {
    const P=prefix,counts={tree:'Tree',shrub:'Shrub',rock:'Rock',scar:'Scar'};
    return p => p.kind==='deposit'?`${P}Metal${p.metal}`:p.kind==='vent'?`${P}Vent`:`${P}${counts[p.kind]}${p.v+1}`;
  }
  async function featurePack(name,signal=null) {
    const sun=light(); if (!sun) throw new Error('Wait for the terrain to draw before exporting its features.');
    const used=[...new Map(placements.map(p => [p.kind+'|'+(p.kind==='deposit'?p.metal:GROUND_KINDS.includes(p.kind)?'':p.v),p])).values()].sort(ordered);
    const prefix='TF'+(hashText(JSON.stringify({name,world:config.biomeId,set,sun,used:used.map(p => [p.kind,p.v,p.metal??null])}))).toString(36).padStart(6,'0').slice(-6);
    const P=prefix,b=prefix.toLowerCase(),nameOf=exportNames(P),defs=[],sequences=[];
    const def=(n,keys) => defs.push({name:n,keys:[...keys,['filename',b]].map(([k,v]) => [k,String(v)])});
    const seq=(n,frames) => { sequences.push({name:n,frames}); return n; };
    const full=(kind,params,seed) => work({type:'full',kind,params,seed,light:sun},[],signal);
    const successors={},successorSeed=set.scar?.recipes.reduce((a,b) => a.id<b.id?a:b)?.seed??4783;
    const smudge=async () => successors.smudge??=(async () => { const f=await full('scar',{type:'smudge'},hash32(successorSeed,0x5d06e));
      def(`${P}Smudge`,[['description','Scorch Mark'],['footprintx',1],['footprintz',1],['height',0],['seqname',seq(`${b}sm`,[frameOf(f.body)])],['animtrans',1],['reclaimable',0],['blocking',0],['featuredead',`${P}Smudge`]]); return `${P}Smudge`; })();
    const stain=async () => successors.stain??=(async () => { const f=await full('scar',{type:'stain',size:1},hash32(successorSeed,0x57a1));
      def(`${P}Stain`,[['description','Rock Rubble'],['footprintx',1],['footprintz',1],['height',0],['seqname',seq(`${b}st`,[frameOf(f.body)])],...(f.shadow?[['seqnameshad',seq(`${b}sts`,[frameOf(f.shadow)])]]:[]),['shadtrans',1],['damage',20000],['reclaimable',0],['blocking',0],['featuredead',`${P}Stain`]]); return `${P}Stain`; })();
    let voidSeq=null;
    const transparent=() => voidSeq??=seq(`${b}v`,[{width:1,height:1,x:0,y:0,duration:10,pixels:base64(new Uint8Array([9])),opaque:base64(new Uint8Array([0]))}]);
    for (const p of used) {
      const n=nameOf(p),v=variantOf(p),i=p.v+1;
      if (p.kind==='deposit') { def(n,[['description','Metal'],['footprintx',3],['footprintz',3],['height',4],['seqname',transparent()],['metal',p.metal],['damage',32009],['indestructible',1],['reclaimable',0],['blocking',0],['shadtrans',1]]); continue; }
      if (p.kind==='vent') { def(n,[['description','Thermal Vent'],['footprintx',1],['footprintz',1],['height',0],['seqname',transparent()],['animating',1],['geothermal',1],['indestructible',1],['blocking',0]]); continue; }
      const f=await full(p.kind,v.params,v.seed),g=f.gameplay,[fw,fz]=v.footprint;
      if (p.kind==='tree') {
        const dead=await smudge(),burn=f.burn?.map(s => frameOf(s,2));   // 96 frames of 2 ticks: the 192-tick burn (spec section 4); a dead tree (species dead) neither burns nor leaves a burnt successor
        if (!f.burn) def(n,[['description','Dead Tree'],['footprintx',fw],['footprintz',fz],['height',40],['seqname',seq(`${b}t${i}`,[frameOf(f.body)])],['seqnameshad',seq(`${b}t${i}s`,[frameOf(f.shadow)])],['energy',g.energy],['featuredead',dead],['featurereclamate',dead],['animtrans',0],['shadtrans',1],['flamable',0],['reclaimable',1],['blocking',1]]);
        else {
        def(n,[['description','Tree'],['footprintx',fw],['footprintz',fz],['height',40],['seqname',seq(`${b}t${i}`,[frameOf(f.body)])],['seqnameshad',seq(`${b}t${i}s`,[frameOf(f.shadow)])],['seqnameburn',seq(`${b}t${i}b`,burn)],
          ['energy',g.energy],['featureburnt',`${n}B`],['featuredead',dead],['featurereclamate',dead],['sparktime',5],['spreadchance',g.spreadChance],['burnweapon','TreeBurn'],['animtrans',0],['shadtrans',1],['flamable',1],['reclaimable',1],['blocking',1]]);
        def(`${n}B`,[['description','Burnt Tree'],['footprintx',fw],['footprintz',fz],['height',40],['seqname',seq(`${b}t${i}x`,[frameOf(f.burnt.body)])],['seqnameshad',seq(`${b}t${i}xs`,[frameOf(f.burnt.shadow)])],
          ['energy',f.burnt.gameplay.energy],['featuredead',dead],['featurereclamate',dead],['animtrans',0],['shadtrans',1],['flamable',0],['reclaimable',1],['blocking',1]]);
        }
      } else if (p.kind==='shrub') {
        const dead=await smudge();   // retail shrubs burn to nothing and die to a smudge
        def(n,[['description','Shrub'],['footprintx',1],['footprintz',1],['height',4],['seqname',seq(`${b}h${i}`,[frameOf(f.body)])],['seqnameburn',seq(`${b}h${i}b`,f.burn.map(s => frameOf(s,2)))],
          ['energy',g.energy],['featuredead',dead],['featurereclamate',dead],['sparktime',5],['spreadchance',g.spreadChance],['burnweapon','ShrubBurn'],['animtrans',0],['shadtrans',1],['flamable',1],['reclaimable',1],['blocking',0]]);
      } else if (p.kind==='rock') {
        const dead=await stain();
        def(n,[['description','Rock'],['footprintx',fw],['footprintz',fz],['height',v.params.tall>0.4?60:rockHeight(v.footprint)],['seqname',seq(`${b}r${i}`,[frameOf(f.body)])],['seqnameshad',seq(`${b}r${i}s`,[frameOf(f.shadow)])],
          ['metal',g.metal],...(g.energy?[['energy',g.energy]]:[]),['damage',2000],['featuredead',dead],['featurereclamate',dead],['animtrans',0],['shadtrans',1],['reclaimable',v.params.reclaimable===false?0:1],['blocking',1]]);
      } else if (p.kind==='scar') {
        // The game draws the body translucent where the editor does (the generator's bodyBlend): a smudge is, a speckle and a stain are not.
        const smudgeType=v.params.type!=='stain';
        def(n,[['description',smudgeType?'Scorch Mark':'Rock Stain'],['footprintx',1],['footprintz',1],['height',0],['seqname',seq(`${b}c${i}`,[frameOf(f.body)])],...(f.shadow?[['seqnameshad',seq(`${b}c${i}s`,[frameOf(f.shadow)])]]:[]),
          ['animtrans',f.bodyBlend<1?1:0],['shadtrans',1],['damage',smudgeType?0:20000],['reclaimable',0],['blocking',0],['featuredead',n]]);
      }
    }
    return {pack:{prefix,defs,sequences},nameOf};
  }
  // Everything the export needs of the features: the pack, the placements by name, and each deposit's and vent's painted pixels at
  // its place in the export art (anchored on the exported heights, painted on clean export art, in the order the view draws them).
  async function exportFeatures({name,heights,width,bakeArt,signal}) {
    if (!placements.length) return {pack:null,placements:[],stamps:[]};
    const sun=light(),{pack,nameOf}=await featurePack(name,signal),out=[];
    for (const p of placements.filter(q => GROUND_KINDS.includes(q.kind)).sort(drawOrder)) {
      signal?.throwIfAborted();
      const at=(x,z) => heights[z*width+x],origin=originOf(p,[at(p.x,p.z),at(p.x+1,p.z),at(p.x,p.z+1),at(p.x+1,p.z+1)]),g=grounds.get(origin.ox+','+origin.oy),rect=patchRect(origin);
      let rgba=g?.rgba && !g.stale?g.rgba.slice():null;
      if (!rgba) { const art=rect && await bakeArt(rect); if (rect && !art) throw new Error('The map changed while its deposits were painted; export again.'); rgba=art?patchOf(origin,rect,art.data):flatGround(); }
      out.push({ox:origin.ox,oy:origin.oy,rgba:await paint(p,rgba,sun,signal)});
    }
    return {pack,placements:placements.map(p => ({name:nameOf(p),x:p.x,z:p.z})).sort(ordered),stamps:out};
  }

  // Resolves when every requested sprite and stamp is drawn and no ground waits to be read (tests and captures).
  async function settled() {
    const frame=() => new Promise(resolve => requestAnimationFrame(resolve));
    api.schedule(); await frame(); await frame();   // a draw asks for what the view shows
    for (let i=0;i<600;i++) {
      const waiting=jobs.size || [...grounds.values()].some(g => g.stale && !g.failed) || [...stamps.values()].some(s => s.painting || !s.exact || s.exactStale);
      if (!waiting) return true;
      await new Promise(resolve => setTimeout(resolve,50));
    }
    return false;
  }

  status(kinds.length>2?'Features ready.':'This world has generated deposits and vents only.'); update();
  return {serialize,load,draw,deactivate,activate,addFeature,removeFeature,removeSelected,rerollSelected,setSelectedMetal,moveSelected,changeSet,addRecipe,addStart,moveStart,removeStart,setFill,fillRegion,
    pointerSelect,hitAt,clearSelection,fitGround,exportFeatures,viewPoint:index => placements[index]?viewPoint(placements[index]):null,selected:() => [...selection].map(p => placements.indexOf(p)).sort((a,b) => a-b),select:list => { selection=new Set(list.map(i => placements[i]).filter(Boolean)); selectionChanged(); },groundChanged,settled,
    stats:() => ({imageBytes:[...sprites.values()].reduce((n,e) => n+(e.body?e.body.w*e.body.h*4:0)+(e.shadow?e.shadow.w*e.shadow.h*4:0),0)+[...stamps.values()].filter(s => s.bitmap).length*PATCH*PATCH*4,
      sprites:sprites.size,stamps:stamps.size,grounds:{fitted:[...grounds.values()].filter(g => g.rgba && !g.stale).length,waiting:[...grounds.values()].filter(g => g.stale && !g.failed).length,failed:[...grounds.values()].filter(g => g.failed).length}}),
    anchors:() => placements.filter(p => GROUND_KINDS.includes(p.kind)).map(p => ({kind:p.kind,x:p.x,z:p.z,origin:exactOrigin(p)})),
    get placements(){return placements.map(p => ({...p}));},get selectionCount(){return selection.size;},get hint(){return $('feature-help').textContent;},get active(){return Boolean(mode);},get mode(){return mode;},get busy(){return Boolean(gesture);},get status(){return message;}};
}
