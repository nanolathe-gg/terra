// Card D phase 2. Placements belong to the map, never to its baked terrain art.
const CELL=16, FILL_KINDS=['tree','foliage','rock'];
const DEFAULT_FILL={kind:'tree',region:'brush',density:15,clustering:.5,gap:1,seed:2701,margin:96,radius:128};
const clamp=(v,a,b) => Math.max(a,Math.min(b,v));
const key=p => p.name.toLowerCase()+'@'+p.x+','+p.z;
const ordered=(a,b) => a.z-b.z || a.x-b.x || (a.name<b.name?-1:a.name>b.name?1:0);
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

export async function mountMapFeatures(api) {
  const {config,canvas}=api,map=config.map;
  if (!map) return {serialize:() => ({features:[],starts:[],fill:{...DEFAULT_FILL}}),load:() => {},draw:() => {},get active(){return false;},get busy(){return false;},deactivate:() => {}};
  const cols=map.playRight/CELL,rows=map.playBottom/CELL,doc=canvas.ownerDocument;
  const defaults=() => { const mx=map.unitsX===1?128:256,mz=map.unitsY===1?128:256; return [{x:mx,z:mz},{x:map.playRight-mx,z:map.playBottom-mz}]; };
  let placements=[],starts=defaults(),fill={...DEFAULT_FILL},generated=new Set(),mode='',selectedName='',selectedFeature=-1,selectedStart=0;
  let gesture=null,hover=null,space=false,ready=false,catalogue=null,catalogueError='',message='Reading the world’s feature catalogue…';
  const definitions=new Map(),images=new Map(),buttons=new Map(),panPointers=new Set();
  const root=doc.createElement('section'); root.className='section'; root.id='map-features-panel';
  root.innerHTML=`<h3>Features and starts</h3><fieldset id="map-features-controls" style="border:0;padding:0;margin:0;min-width:0" disabled>
    <div class="tools" data-tools style="margin-top:9px"></div>
    <p class="small" data-help></p><p class="small" data-catalogue></p>
    <div data-catalogue-controls><div class="row"><label>Kind <select data-filter><option value="all">All features</option><option value="tree">Trees</option><option value="foliage">Foliage</option><option value="rock">Rocks</option><option value="deposit">Metal deposits</option><option value="other">Other</option></select></label></div>
    <div data-catalogue-list style="max-height:220px;overflow:auto;margin:8px 0"></div><p class="small" data-selected></p></div>
    <div class="control"><label>Start positions <select data-starts style="width:100%;margin-top:4px"></select></label><button type="button" data-remove-start style="margin-top:6px">Remove selected start</button><p class="small">Click empty ground to add a start. Drag a numbered marker, or Shift-click ground, to move the selected start. Keep 1–10 starts.</p></div>
    <details data-fill><summary>Tree, foliage and rock fill</summary><div class="row"><label>Mix <select data-fill-kind><option value="tree">Trees</option><option value="foliage">Foliage</option><option value="rock">Rocks</option></select></label><label>Region <select data-fill-region><option value="brush">Brush</option><option value="lasso">Lasso</option><option value="flood">Flood</option></select></label></div>
      <div data-fill-controls></div><p class="small">Fill uses the world’s usage-weighted mix on dry cells whose four exported corner heights differ by at most 10. Brush and lasso fill on release; flood follows connected gentle dry ground.</p>
    </details><p class="small" data-count></p><p class="small" data-state role="status"></p>
  </fieldset>`;
  api.host.append(root);
  const $=selector => root.querySelector(selector),controls=$('fieldset'),fillInputs=new Map();
  const enabled=() => ready && api.enabled();
  const status=text => { message=text; $('[data-state]').textContent=text; };
  const guard=() => { if (enabled()) return true; status('Map editing is unavailable while terrain is loading or export is running.'); return false; };
  const definition=name => definitions.get(String(name).toLowerCase());
  const rectangle=(p,d=definition(p.name)) => ({x0:p.x*CELL,z0:p.z*CELL,x1:(p.x+d.footprintX)*CELL,z1:(p.z+d.footprintZ)*CELL});
  const deposit=d => d && (d.kind==='deposit' || d.name.toLowerCase()===String(catalogue?.depositName||'').toLowerCase());
  const scatter=d => d && FILL_KINDS.includes(d.kind);
  function pointDistance(p,r) { return Math.hypot(Math.max(r.x0-p.x,0,p.x-r.x1),Math.max(r.z0-p.z,0,p.z-r.z1)); }
  function rectDistance(a,b) { return Math.hypot(Math.max(a.x0-b.x1,b.x0-a.x1,0),Math.max(a.z0-b.z1,b.z0-a.z1,0)); }
  function inBounds(p,d) { return Number.isInteger(p.x) && Number.isInteger(p.z) && p.x>=0 && p.z>=0 && p.x+d.footprintX<=cols && p.z+d.footprintZ<=rows; }
  function validStart(p) { return Number.isInteger(p.x) && Number.isInteger(p.z) && p.x>=0 && p.z>=0 && p.x<map.playRight && p.z<map.playBottom; }
  function overlaps(a,ad,b,bd,gap=0) { return a.x< b.x+bd.footprintX+gap && a.x+ad.footprintX+gap>b.x && a.z<b.z+bd.footprintZ+gap && a.z+ad.footprintZ+gap>b.z; }
  function nearMargin(p,d,margin,list=placements,bases=starts) {
    const rect=rectangle(p,d);
    return bases.some(s => pointDistance(s,rect)<margin) || list.some(q => deposit(definition(q.name)) && rectDistance(rect,rectangle(q))<margin);
  }
  function trimGenerated(margin=fill.margin,list=placements,bases=starts) {
    let removed=0;
    const kept=list.filter(p => { const d=definition(p.name),drop=generated.has(key(p)) && scatter(d) && nearMargin(p,d,margin,list,bases); if (drop) { generated.delete(key(p)); removed++; } return !drop; });
    return {kept,removed};
  }
  function update() {
    controls.disabled=!enabled();
    for (const [name,button] of buttons) { button.setAttribute('aria-pressed',String(mode===name)); button.disabled=!ready || (['place','erase','fill'].includes(name) && !definitions.size) || (name==='deposit' && !definition(catalogue?.depositName)); }
    $('[data-catalogue-controls]').hidden=mode!=='place'||!definitions.size;
    $('[data-starts]').closest('.control').hidden=mode!=='starts';
    $('[data-fill]').hidden=mode!=='fill';if(mode==='fill')$('[data-fill]').open=true;
    $('[data-selected]').textContent=selectedName && definition(selectedName)?metadata(definition(selectedName)):'';
    const select=$('[data-starts]'); select.replaceChildren(...starts.map((s,i) => { const option=doc.createElement('option'); option.value=i; option.textContent=`${i+1}: (${s.x}, ${s.z})`; return option; }));
    select.value=String(selectedStart); $('[data-remove-start]').disabled=starts.length<=1 || selectedStart<0;
    $('[data-count]').textContent=`${placements.length} features · ${starts.length} starts`;
    $('[data-state]').textContent=message;
    const hints={place:'Click a cell to place the selected feature. Clicking an occupied footprint selects it; Delete removes it.',erase:'Click or drag across feature footprints to erase them.',deposit:'Click a cell to place the world’s metal deposit. Fill inside its margin is cleared.',starts:'Click empty ground to add a start. Drag a marker, or Shift-click ground, to move the selected start.',fill:`${fill.kind} fill: ${fill.region==='brush'?'drag a brush':fill.region==='lasso'?'draw a closed lasso':'click connected gentle dry ground'}. Space or middle-drag still pans.`};
    $('[data-help]').textContent=hints[mode]||'Choose a feature tool, or keep sculpting terrain. Space or middle-drag pans in every tool.';
    for (const [name,input] of fillInputs) input.value=String(fill[name]);
    api.schedule();
  }
  function changed(text) { selectedFeature=-1; status(text); update(); api.change(); }
  function activate(next) {
    if (!guard()) return false;
    finishGesture(false);mode=next==='deposit'&&!definition(catalogue?.depositName)?'starts':next;hover=null;update();doc.dispatchEvent(new Event('terraform-feature-mode'));return true;
  }
  function deactivate() { const wasActive=Boolean(mode);finishGesture(false);mode='';hover=null;update();if(wasActive)doc.dispatchEvent(new Event('terraform-feature-mode')); }
  function metadata(d) { return `${d.name} · ${d.footprintX}×${d.footprintZ} cells · metal ${d.metal} · energy ${d.energy} · ${d.blocking?'blocking':'nonblocking'} · ${d.reclaimable?'reclaimable':'not reclaimable'} · ${d.uses} map uses${d.animTrans||d.shadTrans?' · translucent preview at 50% alpha':''}`; }
  function refreshCatalogue() {
    const list=$('[data-catalogue-list]'),kind=$('[data-filter]').value; list.replaceChildren();
    for (const d of definitions.values()) {
      if (kind!=='all' && d.kind!==kind) continue;
      const button=doc.createElement('button'); button.type='button'; button.style.cssText='display:flex;align-items:center;gap:8px;width:100%;text-align:left;margin:3px 0;padding:5px';
      if (d.sprite) { const img=doc.createElement('img'); img.src=d.sprite.url; img.alt=''; img.loading='lazy'; img.style.cssText='width:40px;height:40px;object-fit:contain;image-rendering:pixelated;flex:none'; button.append(img); }
      const text=doc.createElement('span'); text.textContent=`${d.name} · ${d.footprintX}×${d.footprintZ} · ${d.uses} uses`; button.append(text); button.title=metadata(d);
      button.setAttribute('aria-pressed',String(selectedName===d.name)); button.onclick=() => { if (!guard()) return; selectedName=d.name; selectedFeature=-1; activate('place'); refreshCatalogue(); }; list.append(button);
    }
  }
  for (const [name,label] of [['place','Place feature'],['erase','Erase'],['deposit','Metal deposit'],['starts','Starts'],['fill','Fill']]) {
    const button=doc.createElement('button'); button.type='button';button.dataset.featureMode=name;button.textContent=label;button.onclick=()=>activate(name); $('[data-tools]').append(button); buttons.set(name,button);
  }
  $('[data-filter]').onchange=() => { if (guard()) refreshCatalogue(); };
  $('[data-starts]').onchange=event => { if (!guard()) { update(); return; } selectedStart=Number(event.target.value); activate('starts'); };
  $('[data-remove-start]').onclick=() => removeStart(selectedStart);
  $('[data-fill-kind]').onchange=event => { if (setFill({kind:event.target.value})) activate('fill'); };
  $('[data-fill-region]').onchange=event => { if (setFill({region:event.target.value})) activate('fill'); };
  for (const [name,label,min,max,step] of [['density','Density (%)',0,100,1],['clustering','Clustering',0,1,.05],['gap','Footprint gap (cells)',0,16,1],['seed','Seed',0,4294967295,1],['margin','Start / deposit margin (px)',0,4096,16],['radius','Brush radius (px)',16,1024,16]]) {
    const labelNode=doc.createElement('label'); labelNode.className='control'; labelNode.style.display='block'; labelNode.textContent=label;
    const input=doc.createElement('input'); input.type='number'; input.min=min; input.max=max; input.step=step; input.value=fill[name]; input.style.cssText='display:block;width:100%;box-sizing:border-box';
    input.onchange=() => { if (!setFill({[name]:Number(input.value)})) update(); }; labelNode.append(input); $('[data-fill-controls]').append(labelNode); fillInputs.set(name,input);
  }

  function addFeature(name,x,z,options={}) {
    if (!guard()) return false;
    const d=definition(name),p={name:d?.name||String(name),x,z};
    if (!d) { status('Choose an available feature from this world.'); return false; }
    if (options.generated && !scatter(d)) { status('Only trees, foliage and rocks belong to a generated fill.'); return false; }
    if (!inBounds(p,d)) { status('The whole feature footprint must fit inside the play area.'); return false; }
    let list=placements,removed=0;
    if (deposit(d)) {
      list=placements.filter(q => { const drop=generated.has(key(q)) && scatter(definition(q.name)) && rectDistance(rectangle(p,d),rectangle(q))<fill.margin; if (drop) removed++; return !drop; });
    }
    if (list.some(q => overlaps(p,d,q,definition(q.name)))) { status('That footprint overlaps another feature.'); return false; }
    if (options.generated) {
      if (!gentleFootprint(p,d,terrainMask()) || nearMargin(p,d,fill.margin) || placements.some(q => overlaps(p,d,q,definition(q.name),fill.gap))) { status('Fill needs gentle dry ground, a free footprint and the selected margins.'); return false; }
    }
    const kept=new Set(list.map(key)); for (const k of generated) if (!kept.has(k)) generated.delete(k);
    placements=[...list,p]; if (options.generated) generated.add(key(p));
    changed(`Placed ${d.name}${removed?`; cleared ${removed} fill features inside its margin`:''}.`); return true;
  }
  function removeFeature(index,notify=true) {
    if (!guard() || !Number.isInteger(index) || index<0 || index>=placements.length) return false;
    const [p]=placements.splice(index,1); generated.delete(key(p)); selectedFeature=-1;
    if (notify) changed(`Removed ${p.name}.`); else api.schedule(); return true;
  }
  function addStart(x,z) {
    if (!guard()) return false;
    const p={x:Math.round(x),z:Math.round(z)};
    if (!validStart(p)) { status('A start must lie inside the play area.'); return false; }
    if (starts.length>=10) { status('A map can have at most 10 starts. Move or remove an existing start.'); return false; }
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
    fill=fillOptions(value,fill); $('[data-fill-kind]').value=fill.kind; $('[data-fill-region]').value=fill.region;
    const trimmed=trimGenerated(); placements=trimmed.kept;
    changed(trimmed.removed?`Updated fill; cleared ${trimmed.removed} generated features inside the margin.`:'Updated fill controls.'); return true;
  }

  const corner=(x,z) => { const h=api.sample(x*CELL,z*CELL); return Number.isFinite(h)?Math.round(clamp(h,0,255)):-1; };
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
  function gentleFootprint(p,d,mask) {
    for (let z=p.z;z<p.z+d.footprintZ;z++) for (let x=p.x;x<p.x+d.footprintX;x++) if (!mask[z*cols+x]) return false;
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
    const settings=fillOptions({...options,kind},fill),mix=[...definitions.values()].filter(d => d.kind===settings.kind);
    if (!mix.length) { status(`This world has no ${settings.kind} features to fill.`); return {added:0}; }
    const bounds=featureRegionBounds(region,cols,rows,fill.radius),gentle=terrainMask(bounds),area=regionMask(region,gentle,bounds),total=mix.reduce((sum,d) => sum+Math.max(1,d.uses),0),candidates=[];
    // Acceptance depends only on the cell and seed. Reject it before sorting;
    // accepted candidates retain exactly the same relative placement order.
    for (let z=bounds.z0;z<bounds.z1;z++) for (let x=bounds.x0;x<bounds.x1;x++) if (area[z*cols+x]) {
      const cluster=clamp((noise(x/12,z/12,settings.seed^0x713c6a91)-.25)*2,0,1),probability=settings.density/100*(1-settings.clustering+settings.clustering*cluster*2);
      if (hash(x,z,settings.seed^0x517ad0f3)<probability) candidates.push({x,z,rank:hash(x,z,settings.seed^0x34da72f1)});
    }
    candidates.sort((a,b) => a.rank-b.rank || a.z-b.z || a.x-b.x);
    const occupied=new Uint8Array(cols*rows),put=p => { const d=definition(p.name); for (let z=p.z;z<p.z+d.footprintZ;z++) for (let x=p.x;x<p.x+d.footprintX;x++) occupied[z*cols+x]=1; };
    for (const p of placements) put(p);
    const deposits=placements.filter(p=>deposit(definition(p.name)));
    let added=0;
    for (const p of candidates) {
      // mapgenFeatures/placeVegetation use each definition's observed usage
      // as its weight. Position-keyed authoring randomness keeps a repeatable mix.
      let ticket=hash(p.x,p.z,settings.seed^0x25cd781b)*total,d=mix[mix.length-1];
      for (const candidate of mix) { ticket-=Math.max(1,candidate.uses); if (ticket<0) { d=candidate; break; } }
      const placed={name:d.name,x:p.x,z:p.z};
      if (!inBounds(placed,d) || !gentleFootprint(placed,d,gentle) || nearMargin(placed,d,settings.margin,deposits)) continue;
      let free=true;
      for (let z=p.z;z<p.z+d.footprintZ && free;z++) for (let x=p.x;x<p.x+d.footprintX;x++) if (!area[z*cols+x]) { free=false; break; }
      for (let z=Math.max(0,p.z-settings.gap);z<Math.min(rows,p.z+d.footprintZ+settings.gap) && free;z++) for (let x=Math.max(0,p.x-settings.gap);x<Math.min(cols,p.x+d.footprintX+settings.gap);x++) if (occupied[z*cols+x]) { free=false; break; }
      if (!free) continue;
      placements.push(placed); generated.add(key(placed)); put(placed); added++;
    }
    if (added) changed(`Filled ${added} ${settings.kind} features.`); else status('No features fit this region with the current density, terrain, spacing and margins.');
    return {added};
  }

  function serialize() {
    return {features:placements.map(p => ({...p})).sort(ordered),starts:starts.map(p => ({...p})),fill:{...fill,generated:placements.filter(p => generated.has(key(p))).map(p => ({...p})).sort(ordered)}};
  }
  function load(data={}) {
    const next=[],nextStarts=(data.starts===undefined?defaults():data.starts),nextFill=fillOptions(data.fill||{});
    if (!Array.isArray(data.features??[]) || !Array.isArray(nextStarts) || nextStarts.length<1 || nextStarts.length>10) throw new Error('Map placements need a feature list and 1–10 starts.');
    for (const p of data.features||[]) {
      const d=definition(p?.name);
      if (!d) throw new Error(`Feature ${String(p?.name)} is unavailable in this world${catalogueError?': '+catalogueError:''}.`);
      const placed={name:d.name,x:p.x,z:p.z};
      if (!inBounds(placed,d) || next.some(q => overlaps(placed,d,q,definition(q.name)))) throw new Error(`Feature ${d.name} has an out-of-play or overlapping footprint.`);
      next.push(placed);
    }
    const bases=nextStarts.map(p => ({x:p?.x,z:p?.z}));
    if (bases.some((p,i) => !validStart(p) || bases.some((q,j) => j<i && p.x===q.x && p.z===q.z))) throw new Error('Every start must be a distinct pixel position inside the play area.');
    const recorded=new Set((Array.isArray(data.fill?.generated)?data.fill.generated:[]).filter(p => p && typeof p.name==='string').map(key));
    const previousGesture=gesture; gesture=null;
    if (previousGesture && canvas.hasPointerCapture?.(previousGesture.id)) canvas.releasePointerCapture(previousGesture.id);
    placements=next; starts=bases; fill=nextFill; generated=new Set(next.filter(p => scatter(definition(p.name)) && recorded.has(key(p))).map(key));
    selectedFeature=-1; selectedStart=Math.min(Math.max(0,selectedStart),starts.length-1); gesture=null; hover=null;
    $('[data-fill-kind]').value=fill.kind; $('[data-fill-region]').value=fill.region; update();
  }
  function screenPoint(event) { if (api.screenPoint) return api.screenPoint(event); const r=canvas.getBoundingClientRect(); return {x:(event.clientX-r.left)*canvas.width/r.width,z:(event.clientY-r.top)*canvas.height/r.height}; }
  function pick(p) { const q=api.pick(p.x,p.z); return q && Number.isFinite(q[0]) && Number.isFinite(q[1]) && q[0]>=0 && q[1]>=0 && q[0]<map.playRight && q[1]<map.playBottom?{x:q[0],z:q[1]}:null; }
  function project(p) { const h=api.sample(p.x,p.z); return {x:p.x,z:p.z-Math.floor(clamp(Number.isFinite(h)?h:0,0,255)/2)+config.baseHeight/2}; }
  function featurePoint(p,d) {
    // client.featureScreenPos/featureAnchorY: footprint centre, but the four
    // rounded/clamped bytes at the anchor cell supply the integer half-height.
    const sum=corner(p.x,p.z)+corner(p.x+1,p.z)+corner(p.x,p.z+1)+corner(p.x+1,p.z+1);
    return {x:p.x*CELL+d.footprintX*8,z:p.z*CELL+d.footprintZ*8-(sum>>3)+config.baseHeight/2};
  }
  function hitFeature(p) { const x=Math.floor(p.x/CELL),z=Math.floor(p.z/CELL); return placements.findIndex(q => { const d=definition(q.name); return x>=q.x && x<q.x+d.footprintX && z>=q.z && z<q.z+d.footprintZ; }); }
  function hitStart(screen) { let found=-1,distance=16; starts.forEach((s,i) => { const p=project(s),d=Math.hypot(screen.x-p.x,screen.z-p.z); if (d<distance) { distance=d; found=i; } }); return found; }
  const stop=event => { event.preventDefault(); event.stopImmediatePropagation(); };
  function finishGesture(commit=true) {
    const g=gesture; gesture=null;
    if (!g) return;
    if (canvas.hasPointerCapture?.(g.id)) canvas.releasePointerCapture(g.id);
    if (g.type==='erase' && g.changed) changed('Erased feature footprints.');
    if (commit && enabled()) {
      if (g.type==='fill') fillRegion(fill.kind,{type:fill.region,points:g.points,radius:fill.radius});
      else if (g.type==='start' && g.target) moveStart(g.index,g.target.x,g.target.z);
    }
    update();
  }
  canvas.addEventListener('pointerdown',event => {
    if (!mode) return;
    if (gesture) { stop(event); return; }
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
    } else if (p) {
      const hit=hitFeature(p);
      if (hit>=0 && mode==='place') { selectedFeature=hit; selectedName=placements[hit].name; status('Selected '+selectedName+'; Delete removes it.'); refreshCatalogue(); }
      else addFeature(mode==='deposit'?catalogue?.depositName:selectedName,Math.floor(p.x/CELL),Math.floor(p.z/CELL));
    }
    if (gesture) canvas.setPointerCapture(event.pointerId); update();
  },true);
  canvas.addEventListener('pointermove',event => {
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
      if (type==='pointerup' && enabled()) {
        const screen=screenPoint(event),p=pick(screen);
        if (p && gesture.type==='fill' && Math.hypot(p.x-gesture.points.at(-1).x,p.z-gesture.points.at(-1).z)>0) gesture.points.push(p);
        else if (p && gesture.type==='start' && Math.hypot(screen.x-gesture.origin.x,screen.z-gesture.origin.z)>=2) gesture.target=p;
        else if (p && gesture.type==='erase') { const i=hitFeature(p); if (i>=0) { removeFeature(i,false); gesture.changed=true; } }
      }
      finishGesture(type==='pointerup');
    } else if (mode && !space && event.button===0 && type!=='lostpointercapture') stop(event);
  },true);
  canvas.addEventListener('pointerleave',() => { if (!gesture) { hover=null; api.schedule(); } },true);
  const typing=target => ['INPUT','SELECT','TEXTAREA'].includes(target?.tagName) || target?.isContentEditable;
  doc.addEventListener('keydown',event => {
    if (typing(event.target)) return;
    if (event.code==='Space') { if (event.target?.tagName!=='BUTTON') space=true; return; }
    if (!mode) return;
    if ((event.metaKey||event.ctrlKey) && event.key.toLowerCase()==='z') { deactivate(); return; }
    if (event.key==='Escape') { stop(event); deactivate(); }
    else if (['Delete','Backspace'].includes(event.key)) { stop(event); if (!event.repeat) { if (mode==='starts') removeStart(selectedStart); else if (selectedFeature>=0) removeFeature(selectedFeature); } }
  },true);
  doc.addEventListener('keyup',event => { if (event.code==='Space') space=false; },true);
  doc.defaultView?.addEventListener('blur',() => { space=false; panPointers.clear(); finishGesture(false); });

  function draw(ink,view=null) {
    controls.disabled=!enabled(); ink.save(); ink.imageSmoothingEnabled=false;
    const sorted=placements.map((p,i) => ({p,i,d:definition(p.name)})).filter(({p,d}) => { if (!view) return true; const at={x:p.x*CELL+d.footprintX*8,z:p.z*CELL+d.footprintZ*8+config.baseHeight/2},reach=Math.max(d.sprite?.width||0,d.sprite?.height||0,d.shadow?.width||0,d.shadow?.height||0,32)+128; return at.x+reach>=view.x && at.x-reach<=view.x+view.width && at.z+reach>=view.y && at.z-reach<=view.y+view.height; }).sort((a,b) => (a.p.z*CELL+a.d.footprintZ*8)-(b.p.z*CELL+b.d.footprintZ*8) || ordered(a.p,b.p));
    for (const {p,d} of sorted) {
      const at=featurePoint(p,d);
      for (const [sprite,translucent] of [[d.shadow,d.shadTrans],[d.sprite,d.animTrans]]) {
        const image=sprite && images.get(sprite.url); if (!image) continue;
        // Use the export crop's north-row tie when base/2 is a half pixel.
        // Native sprite pixels stay sharp; every body and shadow shares it.
        ink.globalAlpha=translucent ? .5 : 1; ink.drawImage(image,Math.floor(at.x)-sprite.xOffset,Math.floor(at.z)-sprite.yOffset);
      }
    }
    ink.globalAlpha=1;
    function outline(p,d,color) {
      const r=rectangle(p,d),points=[{x:r.x0,z:r.z0},{x:r.x1,z:r.z0},{x:r.x1,z:r.z1},{x:r.x0,z:r.z1}].map(project);
      ink.beginPath(); points.forEach((q,i) => i?ink.lineTo(q.x,q.z):ink.moveTo(q.x,q.z)); ink.closePath(); ink.strokeStyle=color; ink.lineWidth=1.5; ink.stroke();
    }
    if (mode && selectedFeature>=0 && placements[selectedFeature]) outline(placements[selectedFeature],definition(placements[selectedFeature].name),'#ffe69c');
    if (hover && ['place','deposit'].includes(mode)) {
      const d=definition(mode==='deposit'?catalogue?.depositName:selectedName),p={x:Math.floor(hover.x/CELL),z:Math.floor(hover.z/CELL)};
      if (d) outline(p,d,inBounds(p,d) && !placements.some(q => overlaps(p,d,q,definition(q.name)))?'#b8eef3':'#ff877e');
    }
    starts.forEach((s,i) => {
      const at=project(gesture?.type==='start' && gesture.index===i && gesture.target?gesture.target:s);
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

  try {
    if (config.services?.features?.available===false) throw new Error(config.services.features.reason);
    if (config.biomeId==='zhon') throw new Error('Zhon has no retail feature set; feature tools are disabled until the owner chooses one.');
    const response=await fetch('map-features/'+encodeURIComponent(config.biomeId)+'/catalog.json');
    if (!response.ok) { const data=await response.json().catch(()=>({})); throw new Error(data.error||'Feature catalogue unavailable (HTTP '+response.status+'). Build map-features with: go build -o <assets-root>/bin/map-features ./features'); }
    catalogue=await response.json();
    if (catalogue.unavailable) throw new Error(catalogue.unavailable);
    if (catalogue.world!==config.biomeId || !Array.isArray(catalogue.features)) throw new Error('The feature catalogue does not match this world.');
    const safeSprite=s => s && typeof s.url==='string' && s.url.startsWith('/map-features/'+encodeURIComponent(config.biomeId)+'/') && !s.url.includes('..') && /\.png$/.test(s.url) && Number.isInteger(s.width) && s.width>0 && Number.isInteger(s.height) && s.height>0 && Number.isFinite(s.xOffset) && Number.isFinite(s.yOffset)?s:null;
    for (const raw of [...catalogue.features].sort((a,b) => String(a.name)<String(b.name)?-1:String(a.name)>String(b.name)?1:0)) {
      if (typeof raw.name!=='string' || !raw.name || !Number.isInteger(raw.footprintX) || !Number.isInteger(raw.footprintZ) || raw.footprintX<1 || raw.footprintZ<1) continue;
      const d={...raw,sprite:safeSprite(raw.sprite),shadow:safeSprite(raw.shadow),uses:Math.max(0,Math.floor(Number(raw.uses)||0))}; definitions.set(d.name.toLowerCase(),d);
    }
    selectedName=[...definitions.values()][0]?.name||'';
    let missing=0;
    const urls=new Set([...definitions.values()].flatMap(d => [d.sprite?.url,d.shadow?.url]).filter(Boolean));
    await Promise.all([...urls].map(url => new Promise(resolve => { const image=new Image(); image.onload=() => { images.set(url,image); api.schedule(); resolve(); }; image.onerror=() => { missing++; resolve(); }; image.src=url; })));
    $('[data-catalogue]').textContent=`${definitions.size} features from ${catalogue.planet||catalogue.world}.${missing?' '+missing+' sprite images could not load.':''} Translucent bodies and shadows use 50% alpha in this first-frame preview.`;
    status('Feature catalogue ready.');
  } catch (error) {
    catalogueError=error.message; $('[data-catalogue]').textContent=catalogueError; status('Feature placement is unavailable; start positions remain editable.');
  }
  ready=true; refreshCatalogue(); update();
  return {serialize,load,draw,deactivate,activate,stats:()=>({imageBytes:[...images.values()].reduce((total,image)=>total+(image.naturalWidth||image.width)*(image.naturalHeight||image.height)*4,0)}),addFeature,removeFeature,addStart,moveStart,removeStart,setFill,fillRegion,get hint(){return $('[data-help]').textContent;},get active(){return Boolean(mode);},get busy(){return Boolean(gesture);},get status(){return message;}};
}
