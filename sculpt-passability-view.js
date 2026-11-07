import {MOVEMENT_FAMILIES,BLOCKED_COLOR,COVERAGE_COLORS,terrainLattice,familyCoverage,movementObstacles,overviewClass,inspectMovement} from './sculpt-passability.js';
const $=id=>document.getElementById(id),pause=()=>new Promise(r=>setTimeout(r,0));

// A diagnostic overlay over the editor's existing render, sampled by the export's
// own cellHeights path. No terrain shader, saved state, unit database or art fork.
export function mountPassability({config,sampleHeights,revision,ready,mapData,schedule,checkMemory}) {
  let active=false,model=null,job=null,cacheKey='',hoverKey='',analysisMs=0;
  const surface=new OffscreenCanvas(1,1),c=surface.getContext('2d');
  const family=()=>MOVEMENT_FAMILIES.find(f=>f.id===$('passability-family').value);
  function syncButtons(){for(const [id,on] of [['view-passability',active],['view-rendered',!active&&!$('clay').checked],['view-clay',!active&&$('clay').checked]])$(id).setAttribute('aria-pressed',String(on));}
  function legend(){const f=family();$('passability-overview-key').hidden=Boolean(f);$('passability-family-key').hidden=!f;$('passability-reference').textContent=f?`${f.label}: ${f.profiles.map(p=>`${p.size}×${p.size} / slope ${p.slope}${p.depth<10000?` / depth ≤${p.depth}`:''}${p.minDepth>0?` / depth ≥${p.minDepth}`:''}`).join(' · ')}`:'Overlapping movement families · hover terrain for the full set';}
  function setActive(on){
    active=on;$('passability-tools').hidden=!on;$('passability-legend').hidden=!on;syncButtons();
    if(!on){job?.controller.abort();job=null;model=null;cacheKey='';surface.width=surface.height=1;}
    else{legend();$('passability-state').textContent='Waiting for finished terrain…';$('passability-readout').textContent='Approximate reference profiles · Air crosses terrain; landing is not shown.';}
    schedule();
  }
  $('view-passability').addEventListener('click',()=>setActive(true));
  for(const id of ['view-rendered','view-clay'])$(id).addEventListener('click',()=>setActive(false));
  $('passability-family').addEventListener('change',()=>{cacheKey=hoverKey='';legend();$('passability-readout').textContent='Hover the terrain to inspect access and blocking reasons.';schedule();});
  function refresh(){
    if(!active)return;
    const token=revision();
    if(model?.revision===token||job?.revision===token)return;
    job?.controller.abort();model=null;cacheKey=hoverKey='';
    const controller=new AbortController(),current={revision:token,controller};job=current;
    $('passability-state').textContent='Updating exported heights…';
    $('passability-readout').textContent='Rechecking terrain; previous access colors are hidden.';
    // Start outside the presentation frame: sampleHeights waits for canvas.idle().
    setTimeout(async()=>{
      try{
        while(!ready()){controller.signal.throwIfAborted();await new Promise(r=>setTimeout(r,150));}
        controller.signal.throwIfAborted();
        const start=performance.now(),sampled=await sampleHeights(controller.signal);
        if(revision()!==token)throw new DOMException('Terrain changed','AbortError');
        const data=mapData(),map=config.map;checkMemory?.(sampled.heights.length*24);
        const lattice=terrainLattice({heights:sampled.heights,width:map.widthCells,height:map.heightCells,sea:config.seaLevel,obstacles:movementObstacles(config,data),lava:Boolean(data.settings?.lava)}),coverage=[];
        for(const f of MOVEMENT_FAMILIES){controller.signal.throwIfAborted();coverage.push(familyCoverage(lattice,f));await pause();}
        controller.signal.throwIfAborted();if(revision()!==token)throw new DOMException('Terrain changed','AbortError');
        model={...lattice,coverage,revision:token};analysisMs=Math.round(performance.now()-start);
        $('passability-state').textContent=`${map.widthCells} × ${map.heightCells} export cells · reference profiles`;
        $('passability-state').title=`Height sampling and classification: ${analysisMs} ms. Slopes are cell height spans, not degrees. Includes generated blocking features and map edges. Does not simulate traffic or turning.`;
        $('passability-readout').textContent='Hover terrain for movement families and blocking reasons. Air crosses terrain; landing is not shown.';
      }catch(error){
        if(error.name!=='AbortError'){$('passability-state').textContent='Passability unavailable';$('passability-readout').textContent=error.message;current.failed=true;}
      }finally{if(job===current&&!current.failed)job=null;if(active&&!current.failed)schedule();}
    },0);
  }
  function raster(v,scale){
    const f=family(),fi=MOVEMENT_FAMILIES.indexOf(f),key=[model.revision,f?.id,v.x,v.y,v.width,v.height,scale].join(',');
    if(key===cacheKey)return;cacheKey=key;
    surface.width=Math.max(1,Math.ceil(v.width*scale));surface.height=Math.max(1,Math.ceil(v.height*scale));
    const {width:w,height:h,heights,coverage}=model;
    const colors=(fi<0?[...MOVEMENT_FAMILIES.map(f=>f.color),BLOCKED_COLOR]:COVERAGE_COLORS).map(hex=>[1,3,5].map(i=>parseInt(hex.slice(i,i+2),16)));
    const image=c.createImageData(surface.width,surface.height),pixels=image.data;
    const z0=Math.max(0,Math.floor((v.y-128)/16)),z1=Math.min(h-1,Math.ceil((v.y+v.height+128)/16));
    // Rasterize projected cell columns into one image. Shared row boundaries
    // meet exactly: independent antialiased quads leave a distracting mesh at
    // Fit. Southward stamping also preserves which cell covers a cliff face.
    for(let px=0;px<surface.width;px++){
      const world=(v.x+(px+.5)/scale)/16,x=Math.floor(world),fx=world-x;
      if(x<0||x>=w-1)continue;
      const sy=z=>(z*16-((Math.max(config.seaLevel,heights[z*w+x])*(1-fx)+Math.max(config.seaLevel,heights[z*w+x+1])*fx)-config.baseHeight)/2-v.y)*scale;
      let top=sy(z0);
      for(let z=z0;z<z1;z++){
        const bottom=sy(z+1),from=Math.max(0,Math.ceil(Math.min(top,bottom)-.5)),to=Math.min(surface.height,Math.ceil(Math.max(top,bottom)-.5));top=bottom;
        if(to<=from)continue;
        const i=z*w+x,k=fi<0?overviewClass(coverage,i):coverage[fi][i],chosen=fi<0?(k<5?coverage[k][i]:0):k,color=colors[k];
        for(let py=from;py<to;py++){
          const off=(py*surface.width+px)*4,shade=chosen===1&&((px+py)&7)<2?.58:1;
          pixels[off]=color[0]*shade;pixels[off+1]=color[1]*shade;pixels[off+2]=color[2]*shade;pixels[off+3]=212;
        }
      }
    }
    c.putImageData(image,0,0);
  }
  function draw(ink,v,scale){
    if(!active)return;refresh();if(!model||model.revision!==revision())return;
    raster(v,scale);ink.save();ink.setTransform(1,0,0,1,0,0);ink.drawImage(surface,0,0);ink.restore();
  }
  function inspect(x,z){
    if(!active||!model)return;
    x=Math.floor(x/16);z=Math.floor(z/16);const i=z*model.width+x,key=[x,z,family()?.id,model.revision].join(',');if(hoverKey===key)return;hoverKey=key;
    if(x<0||z<0||x>=model.width||z>=model.height){$('passability-readout').textContent='Outside the map.';return;}
    const depth=model.sea-model.low[i],slope=model.high[i]-model.low[i],f=family();
    const groups=MOVEMENT_FAMILIES.map((g,k)=>`${g.label}: ${['blocked','some','all'][model.coverage[k][i]]}`);
    let details='';
    if(f){const results=inspectMovement(model,f,x,z);details=' · '+results.map(r=>`${r.size}×${r.size}${f.id==='kbots'?` slope ${r.slope}`:''}: ${r.pass?'fits':r.reason}`).join('; ');}
    $('passability-readout').textContent=`Cell ${x}, ${z} · ${depth>0?`water depth ${depth}`:'dry'} · cell slope ${slope}${details}`;
    $('passability-access').textContent=groups.join('  ·  ')+'  ·  Air: terrain-independent';
  }
  return {draw,inspect,get active(){return active;},setActive,stats:()=>({active,ready:Boolean(model)&&model.revision===revision(),analysisMs,revision:model?.revision??null,bytes:model?model.heights.length*(4+MOVEMENT_FAMILIES.length)+surface.width*surface.height*4:0}),
    // Inspection shares the live overlay's masks; used by browser acceptance checks.
    at:(x,z)=>model?{low:model.low[z*model.width+x],high:model.high[z*model.width+x],coverage:Object.fromEntries(MOVEMENT_FAMILIES.map((f,k)=>[f.id,model.coverage[k][z*model.width+x]]))}:null};
}
