import {MOVEMENT_FAMILIES,BLOCKED_COLOR,COVERAGE_COLORS,createPassability,updatePassability,movementObstacles,overviewClass,inspectMovement} from './sculpt-passability.js';
const $=id=>document.getElementById(id);

// A diagnostic overlay over the editor's existing render, sampled by the export's
// own cellHeights path. No terrain shader, saved state, unit database or art fork.
export function mountPassability({config,sampleHeightTiles,revision,ready,mapData,schedule,checkMemory}) {
  let active=false,model=null,job=null,cacheKey='',hoverKey='',analysisMs=0,firstTileMs=0,dirtyColumns=null;
  const surface=new OffscreenCanvas(1,1),c=surface.getContext('2d');
  const family=()=>MOVEMENT_FAMILIES.find(f=>f.id===$('passability-family').value);
  function syncButtons(){for(const [id,on] of [['view-passability',active],['view-rendered',!active&&!$('clay').checked],['view-clay',!active&&$('clay').checked]])$(id).setAttribute('aria-pressed',String(on));}
  function legend(){const f=family();$('passability-overview-key').hidden=Boolean(f);$('passability-family-key').hidden=!f;$('passability-reference').textContent=f?`${f.label}: ${f.profiles.map(p=>`${p.size}×${p.size} / slope ${p.slope}${p.depth<10000?` / depth ≤${p.depth}`:''}${p.minDepth>0?` / depth ≥${p.minDepth}`:''}`).join(' · ')}`:'Overlapping movement families · hover terrain for the full set';}
  function setActive(on){
    if(active===on)return;
    active=on;$('passability-tools').hidden=!on;$('passability-legend').hidden=!on;syncButtons();
    if(!on){job?.controller.abort();job=null;model=null;cacheKey='';surface.width=surface.height=1;}
    else{legend();$('passability-state').textContent='Waiting for terrain…';$('passability-readout').textContent='Approximate reference profiles · Air crosses terrain; landing is not shown.';}
    schedule();
  }
  $('view-passability').addEventListener('click',()=>setActive(true));
  for(const id of ['view-rendered','view-clay'])$(id).addEventListener('click',()=>setActive(false));
  $('passability-family').addEventListener('change',()=>{cacheKey=hoverKey='';legend();$('passability-readout').textContent='Hover the terrain to inspect access and blocking reasons.';schedule();});
  function refresh(){
    if(!active)return;
    const token=revision();
    if(model?.revision===token||job?.revision===token)return;
    job?.controller.abort();model=null;cacheKey=hoverKey='';analysisMs=firstTileMs=0;
    const controller=new AbortController(),current={revision:token,controller};job=current;
    $('passability-state').textContent='Updating exported heights…';
    $('passability-state').title='';$('passability-access').textContent='';
    $('passability-readout').textContent='Rechecking terrain; previous access colors are hidden.';
    // Start outside the presentation frame; each tile publishes independently.
    setTimeout(async()=>{
      try{
        while(!ready()){controller.signal.throwIfAborted();await new Promise(r=>setTimeout(r,150));}
        controller.signal.throwIfAborted();
        const start=performance.now(),data=mapData(),map=config.map,n=map.widthCells*map.heightCells,obstacles=movementObstacles(config,data),lava=Boolean(data.settings?.lava);
        checkMemory?.(n*11+256*1024);controller.signal.throwIfAborted();
        if(revision()!==token)throw new DOMException('Terrain changed','AbortError');
        const currentModel={...createPassability({width:map.widthCells,height:map.heightCells,sea:config.seaLevel,obstacles,lava}),revision:token,tiles:0,totalTiles:Math.ceil(map.widthCells/32)*Math.ceil(map.heightCells/32),complete:false};model=currentModel;
        for await(const tile of sampleHeightTiles(controller.signal)){
          controller.signal.throwIfAborted();if(revision()!==token)throw new DOMException('Terrain changed','AbortError');
          const changed=updatePassability(currentModel,tile),left=changed.x,right=left+changed.width;
          dirtyColumns=dirtyColumns?[Math.min(left,dirtyColumns[0]),Math.max(right,dirtyColumns[1])]:[left,right];
          currentModel.tiles++;analysisMs=Math.round(performance.now()-start);if(!firstTileMs&&currentModel.cells)firstTileMs=analysisMs;
          $('passability-state').textContent=`${currentModel.tiles} / ${currentModel.totalTiles} height tiles · reference profiles`;
          hoverKey='';schedule();
        }
        controller.signal.throwIfAborted();if(revision()!==token)throw new DOMException('Terrain changed','AbortError');
        currentModel.complete=true;analysisMs=Math.round(performance.now()-start);
        $('passability-state').textContent=`${map.widthCells} × ${map.heightCells} export cells · reference profiles`;
        $('passability-state').title=`Height sampling and classification: ${analysisMs} ms. Slopes are cell height spans, not degrees. Includes generated blocking features and map edges. Does not simulate traffic or turning.`;
        $('passability-readout').textContent='Hover terrain for movement families and blocking reasons. Air crosses terrain; landing is not shown.';
      }catch(error){
        if(error.name!=='AbortError'&&job===current){model=null;$('passability-state').textContent='Passability unavailable';$('passability-readout').textContent=error.message;current.failed=true;}
      }finally{if(job===current&&!current.failed)job=null;if(active&&!current.failed)schedule();}
    },0);
  }
  function raster(v,scale){
    const f=family(),fi=MOVEMENT_FAMILIES.indexOf(f),key=[model.revision,f?.id,v.x,v.y,v.width,v.height,scale].join(',');
    if(key===cacheKey&&!dirtyColumns)return;
    const full=key!==cacheKey;cacheKey=key;
    if(full){surface.width=Math.max(1,Math.ceil(v.width*scale));surface.height=Math.max(1,Math.ceil(v.height*scale));}
    // Projection stays within each x column. Repaint only the columns whose
    // heights or footprints changed, retaining every other completed column.
    const px0=full?0:Math.max(0,Math.floor((dirtyColumns[0]-v.x)*scale)),px1=full?surface.width:Math.min(surface.width,Math.ceil((dirtyColumns[1]-v.x)*scale));dirtyColumns=null;
    if(px1<=px0)return;
    const {width:w,height:h,heights,coverage}=model;
    const colors=(fi<0?[...MOVEMENT_FAMILIES.map(f=>f.color),BLOCKED_COLOR]:COVERAGE_COLORS).map(hex=>[1,3,5].map(i=>parseInt(hex.slice(i,i+2),16)));
    const image=c.createImageData(px1-px0,surface.height),pixels=image.data;
    const z0=Math.max(0,Math.floor((v.y-128)/16)),z1=Math.min(h-1,Math.ceil((v.y+v.height+128)/16));
    // Rasterize projected cell columns into one image. Shared row boundaries
    // meet exactly: independent antialiased quads leave a distracting mesh at
    // Fit. Southward stamping also preserves which cell covers a cliff face.
    for(let px=px0;px<px1;px++){
      const world=(v.x+(px+.5)/scale)/16,x=Math.floor(world),fx=world-x;
      if(x<0||x>=w-1)continue;
      const sy=z=>(z*16-((Math.max(config.seaLevel,heights[z*w+x])*(1-fx)+Math.max(config.seaLevel,heights[z*w+x+1])*fx)-config.baseHeight)/2-v.y)*scale;
      let top=sy(z0);
      for(let z=z0;z<z1;z++){
        const bottom=sy(z+1),from=Math.max(0,Math.ceil(Math.min(top,bottom)-.5)),to=Math.min(surface.height,Math.ceil(Math.max(top,bottom)-.5));top=bottom;
        if(to<=from)continue;
        const i=z*w+x;if(!model.have[i])continue;
        const k=fi<0?overviewClass(coverage,i):coverage[fi][i],chosen=fi<0?(k<5?coverage[k][i]:0):k,color=colors[k];
        for(let py=from;py<to;py++){
          const off=(py*image.width+px-px0)*4,shade=chosen===1&&((px+py)&7)<2?.58:1;
          pixels[off]=color[0]*shade;pixels[off+1]=color[1]*shade;pixels[off+2]=color[2]*shade;pixels[off+3]=212;
        }
      }
    }
    c.putImageData(image,px0,0);
  }
  function draw(ink,v,scale){
    if(!active)return;refresh();if(!model||model.revision!==revision())return;
    raster(v,scale);ink.save();ink.setTransform(1,0,0,1,0,0);ink.drawImage(surface,0,0);ink.restore();
  }
  function inspect(x,z){
    if(!active)return;
    if(!model||model.revision!==revision()){$('passability-readout').textContent='Waiting for updated heights…';$('passability-access').textContent='';return;}
    x=Math.floor(x/16);z=Math.floor(z/16);const i=z*model.width+x,key=[x,z,family()?.id,model.revision].join(',');if(hoverKey===key)return;hoverKey=key;
    if(x<0||z<0||x>=model.width||z>=model.height){$('passability-readout').textContent='Outside the map.';return;}
    if(!model.have[i]){$('passability-readout').textContent=`Cell ${x}, ${z} · waiting for heights…`;$('passability-access').textContent='';return;}
    const depth=model.sea-model.low[i],slope=model.high[i]-model.low[i],f=family();
    const groups=MOVEMENT_FAMILIES.map((g,k)=>`${g.label}: ${['blocked','some','all'][model.coverage[k][i]]}`);
    let details='';
    if(f){const results=inspectMovement(model,f,x,z);details=' · '+results.map(r=>`${r.size}×${r.size}${f.id==='kbots'?` slope ${r.slope}`:''}: ${r.pass?'fits':r.reason}`).join('; ');}
    $('passability-readout').textContent=`Cell ${x}, ${z} · ${depth>0?`water depth ${depth}`:'dry'} · cell slope ${slope}${details}`;
    $('passability-access').textContent=groups.join('  ·  ')+'  ·  Air: terrain-independent';
  }
  return {draw,inspect,get active(){return active;},setActive,stats:()=>({active,ready:Boolean(model?.complete)&&model.revision===revision(),tiles:model?.tiles??0,totalTiles:model?.totalTiles??0,cells:model?.cells??0,firstTileMs,analysisMs,revision:model?.revision??null,bytes:model?model.heights.length*(6+MOVEMENT_FAMILIES.length)+surface.width*surface.height*4:0}),
    // Inspection shares the live overlay's masks; used by browser acceptance checks.
    at:(x,z)=>model&&model.revision===revision()&&x>=0&&z>=0&&x<model.width&&z<model.height&&model.have[z*model.width+x]?{low:model.low[z*model.width+x],high:model.high[z*model.width+x],coverage:Object.fromEntries(MOVEMENT_FAMILIES.map((f,k)=>[f.id,model.coverage[k][z*model.width+x]]))}:null};
}
