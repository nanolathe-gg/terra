import {createShapeEngine,createNodePreparer,nodeContextKey,shapeScratchBytes,shapeRequestBytes} from './sculpt-gpu-fields.js';
import {terrainAllocation} from './sculpt-memory.js';
// Resolution is a display preference, separate from shape/voxel levels. Choose
// from the unsplit edit area, then hold that choice for the whole gesture.
export const previewQuality=value=>['2','3','4','8'].includes(String(value))?String(value):'auto';
export function previewPixels(preference,area,detail=1){
  return previewQuality(preference)==='auto'?(area.width*area.height<=(768*detail)**2?2:4):Number(preference);
}
// Three slow pictures lower Auto by one level. Recovery needs a sustained
// fast run and a minimum dwell, so a busy shared GPU cannot make it oscillate.
export function createPreviewLoad(){
 let scale=1,slow=0,fast=0,changedAt=-Infinity,changes=0,lastMs=null,samples=0,times=[];
 const observe=(ms,now)=>{
  if(!Number.isFinite(ms)||ms<=0||!Number.isFinite(now))return false;
  lastMs=ms;samples++;slow=ms>40?slow+1:0;fast=ms<18?fast+1:ms>28?0:Math.max(0,fast-1);
  const next=scale===1&&slow>=3?2:scale===2&&fast>=8?1:scale;
  if(next===scale||now-changedAt<500)return false;
  scale=next;slow=fast=0;changedAt=now;changes++;return true;
 };
 return {get scale(){return scale;},stats:()=>({scale,slow,fast,changes,lastMs,samples}),observe,
  resetCadence(){times=[];},
  complete(now,reset=false){
   if(reset)times=[];times.push(now);if(times.length>5)times.shift();
   // Browsers may deliver two queue-completion callbacks together. Four
   // intervals include those zero gaps rather than treating the batch as one
   // slow picture, and still respond within a few pictures under real load.
   return times.length===5?observe((now-times[0])/4,now):false;
  }
 };
}
const union=(a,b)=>!a||!b?null:{x:Math.min(a.x,b.x),y:Math.min(a.y,b.y),width:Math.max(a.x+a.width,b.x+b.width)-Math.min(a.x,b.x),height:Math.max(a.y+a.height,b.y+b.height)-Math.min(a.y,b.y)};
// A bounded, display-only lattice for zoomed-out views. It evaluates the same
// shape graph and masks; exports and picking continue to use canonical fields.
export function createPreviewFields(device,scene){
 let engine=null,target=null,starting=null,revision=-1,dirty=null,pending=true,runs=0;
 const grid=512;
 async function initialize(){const s=scene(),spacing=(s.size-1)/(grid-1);engine=await createShapeEngine({device,grid,spacing,refSpacing:s.spacing,baseHeight:s.baseHeight,sea:s.sea,minH:s.minH,maxH:s.maxH,pages:true});target=engine.makeTarget(0,0,grid,grid);}
 return {
  invalidate(rect){dirty=pending?union(dirty,rect):rect;pending=true;},
  bytes(){return (engine?.bytes()||0)+(target?.bytes||0);},
  stats(){return {grid,runs,revision,bytes:this.bytes()};},
  async feed(){
   if(!engine)await(starting??=initialize());
   const s=scene();
   if(revision!==s.revision){
    const sp=(s.size-1)/(grid-1),r=revision<0||!dirty?null:{x0:Math.max(0,Math.floor(dirty.x/sp)-6),y0:Math.max(0,Math.floor(dirty.y/sp)-6),x1:Math.min(grid-1,Math.ceil((dirty.x+dirty.width)/sp)+6),y1:Math.min(grid-1,Math.ceil((dirty.y+dirty.height)/sp)+6)};
    const h=engine.submit(s.nodes,s.context,r,{readback:false,target});h.done.catch(s.fail);revision=s.revision;runs++;dirty=null;pending=false;
   }
   return {planes:target.F,masks:target.Mk,maskCount:s.maskCount,grid,spacing:(s.size-1)/(grid-1),revision,weather:null,maps:null,field:null,release:()=>{}};
  },
  destroy(){target?.destroy();engine?.destroy();target=engine=null;starting=null;revision=-1;dirty=null;pending=true;}
 };
}

// Preview inputs live on one global lattice, including the map's last sample.
// The window keeps the same world-space Time apron as canonical pages.
export function previewGrid(size,canonicalGrid,level){
  return Math.min(canonicalGrid,Math.ceil((size-1)/Math.max(level,(size-1)/(canonicalGrid-1)))+1);
}
export function previewWindow(region,grid,size,apron,retained=null){
  const spacing=(size-1)/(grid-1),pad=Math.ceil(apron/spacing);
  const side=Math.min(grid,Math.max(region.gridWidth,region.gridHeight)+2*pad);
  const x=Math.max(0,Math.min(grid-side,Math.round(region.gridOrigin[0]/spacing)-pad));
  const y=Math.max(0,Math.min(grid-side,Math.round(region.gridOrigin[1]/spacing)-pad));
  // Keep a held stroke on its existing window while its dirty area grows.
  // Bound excess coverage by the same Time apron; a pan still needs new inputs.
  if(retained?.grid===grid&&retained.side<=side+2*pad&&retained.x<=x&&retained.y<=y&&retained.x+retained.side>=x+side&&retained.y+retained.side>=y+side)return retained;
  return {x,y,side,spacing,grid,cells:side*side};
}
// The same shape and Time kernels over a display-only window. Canonical pages,
// picking and export do not read these buffers. Only one window is retained.
// trim() gives back the shape engine and its target and keeps the window's Time result, which the next gesture begins with.
export function createPreviewLattice(device,scene,memoryChanged=()=>{}){
  let engine=null,target=null,weather=null,starting=null,shapeKey='',key='',weatherKey='',weatherWindow=null,weatherRevision=-1,weatherAtRest=false,restRevision=-1,working=0,runs=0,timeRuns=0,weatherReuses=0,peak=0;
  const bytes=()=> (engine?.bytes()??0)+(target?.bytes??0)+(weather?.bytes??0)+(weather?.field?.size??0)+working;
  const dropWeather=()=>{weather?.weather.destroy();weather?.maps.forEach(b=>b.destroy());weather?.field?.destroy();weather=null;weatherKey='';weatherWindow=null;};
  const trim=()=>{target?.destroy();engine?.destroy();engine=target=starting=null;shapeKey=key='';working=0;};
  const clear=()=>{dropWeather();trim();};
  // The prepared nodes of each lattice in use. The budget estimate plans the 8 px and 4 px lattices on every input, so one recipe per lattice
  // is kept, and a recipe made again prepares only the nodes that changed (createNodePreparer).
  const recipes=new Map(),prepare=createNodePreparer();
  const recipeFor=(s,w)=>{
    const rk=[s.revision,JSON.stringify(s.context)].join('|'),held=recipes.get(w.grid);
    if(held?.key===rk)return held.recipe;
    const geom={grid:w.grid,spacing:w.spacing,refSpacing:s.spacing},ck=nodeContextKey(s.context),recipe=new Map(s.nodes.map(n=>[n,prepare(n,geom,s.context,ck)]));
    if(!held&&recipes.size>=4)recipes.delete(recipes.keys().next().value);
    recipes.set(w.grid,{key:rk,recipe});return recipe;
  };
  const plan=(region,on=true,deferTime=false)=>{
    const s=scene(),w=previewWindow(region,region.worldGrid,s.size,s.timeApron??128*s.spacing,deferTime?weatherWindow:null);
    const tm=on?s.previewTime?.({size:w.spacing*(w.side-1)+1,spacing:w.spacing}):null;
    const geometry=[w.grid,w.x,w.y,w.side].join(','),sk=[geometry,s.revision].join('|'),wk=[geometry,tm?.key??'',tm?.revB??s.revB].join('|'),cache=sk+'|'+wk;
    // A gesture reuses the Time result it began with. One held while the scene was at rest (rest()) serves only if it was made for
    // that scene: any other is older, and the gesture begins with its own. `held` names what the buffers hold: a reused result is not
    // the current one, so a picture at rest runs Time again though the window and the shape are the same.
    const reuse=Boolean(tm&&deferTime&&weather&&weatherKey===wk&&(!weatherAtRest||weatherRevision===restRevision)),held=reuse?cache+'|kept':cache,runTime=tm&&!reuse&&key!==held;
    const recipe=recipeFor(s,w);
    const prepared=[...recipe.values()].flatMap(p=>p.multi??[p]),scratch=shapeScratchBytes(w.cells,prepared);
    const shapeBytes=w.cells*56+Math.max(scratch,engine?.bytes()??0)+shapeRequestBytes(prepared);
    const peakBytes=shapeBytes+(tm?w.cells*144+65536:0);
    const requestPeak=runTime?peakBytes:shapeBytes+(weather?.bytes??0)+(weather?.field?.size??0);
    return {...w,s,tm,sk,wk,reuse,held,recipe,nodes:[...recipe.keys()],peakBytes,additionalBytes:key===held&&target?0:Math.max(0,requestPeak-bytes())};
  };
  return {
    grid:level=>{const s=scene();return previewGrid(s.size,s.grid,level);},plan,bytes,
    stats:()=>({runs,timeRuns,weatherReuses,bytes:bytes(),peakBytes:peak,grid:engine?.grid??null,side:target?.pw??null}),clear,trim,
    // The scene's revision while no gesture is under way (the canvas says so each frame).
    rest(){restRevision=scene().revision;weatherAtRest=true;},
    async feed(region,{weather:on=true,signal,stale=()=>false,deferTime=false}={}){
      const current=()=>{signal?.throwIfAborted();if(stale?.())throw new DOMException('The preview lattice was superseded.','AbortError');};
      current();const p=plan(region,on,deferTime),{s,tm}=p;
      try{
        if(engine&&engine.grid!==p.grid)clear();
        if(!engine){
          starting??=createShapeEngine({device,grid:p.grid,spacing:p.spacing,refSpacing:s.spacing,baseHeight:s.baseHeight,sea:s.sea,minH:s.minH,maxH:s.maxH,pages:true});
          engine=await starting;current();
        }
        if(shapeKey!==p.sk){
          if(!p.reuse)dropWeather();key='';shapeKey='';let submitted;
          await terrainAllocation(device,()=>{
            if(!target||target.ox!==p.x||target.oy!==p.y||target.pw!==p.side){target?.destroy();target=engine.makeTarget(p.x,p.y,p.side,p.side);}
            submitted=engine.submit(p.nodes,s.context,null,{readback:false,target,prepare:n=>p.recipe.get(n)});
          });
          // The feed and Time pass use this same queue. Their reads follow shape
          // without a GPU-to-page round trip; the engine retires its scratch.
          submitted.done.catch(s.fail);current();shapeKey=p.sk;runs++;
        }
        if(key!==p.held){
          if(!p.reuse)dropWeather();else weatherReuses++;key='';
          if(tm&&!p.reuse){
            working=p.cells*144+65536;peak=Math.max(peak,bytes());memoryChanged();
            try{weather=await tm.run({planes:target.F,masks:target.Mk,grid:p.side,ox:p.x,oy:p.y,stale:()=>Boolean(signal?.aborted)||Boolean(stale?.())});timeRuns++;}
            finally{working=0;}
            current();weatherKey=p.wk;weatherWindow={x:p.x,y:p.y,side:p.side,spacing:p.spacing,grid:p.grid,cells:p.cells};weatherRevision=s.revision;weatherAtRest=!deferTime;
          }
          key=p.held;
        }
        peak=Math.max(peak,bytes());current();
        return {planes:target.F,masks:target.Mk,maskCount:s.maskCount,grid:p.side,origin:[p.x,p.y],spacing:p.spacing,revision:s.revision,weatherRevB:tm?.revB??s.revB,weather:weather?.weather??null,maps:weather?.maps??null,field:weather?.field??null,release:()=>{}};
      }catch(error){if(error.name==='TerrainMemoryError')clear();throw error;}
    }
  };
}

// Choose the fewest cells in a balanced global grid that fit the available
// working memory. The caller supplies the renderer's pure estimate; no tile
// size, allocation, page preparation or GPU work participates in planning.
export function planPreviewBlocks(view,bounds,fits,grid=64){
  const x0=Math.max(0,Math.floor(view.x/grid)*grid),y0=Math.max(0,Math.floor(view.y/grid)*grid),x1=Math.min(bounds.width,Math.ceil((view.x+view.width)/grid)*grid),y1=Math.min(bounds.height,Math.ceil((view.y+view.height)/grid)*grid);
  if(x1<=x0||y1<=y0)return [];
  const columns=Math.ceil((x1-x0)/grid),rows=Math.ceil((y1-y0)/grid);
  // If one smallest cell cannot fit, splitting cannot make that cell cheaper.
  const x=x0+Math.floor((columns-1)/2)*grid,y=y0+Math.floor((rows-1)/2)*grid;
  if(!fits({x,y,width:Math.min(grid,x1-x),height:Math.min(grid,y1-y)}))throw Error('A preview block does not fit the terrain memory budget.');
  const axis=(lo,hi,cells,count)=>Array.from({length:count+1},(_,i)=>i===count?hi:lo+Math.floor(i*cells/count)*grid);
  for(let count=1;count<=columns*rows;count++){
    const candidates=[];
    for(let ny=1;ny<=Math.min(rows,count);ny++)if(count%ny===0&&count/ny<=columns)candidates.push([count/ny,ny]);
    const balance=([nx,ny])=>Math.abs(Math.log(((x1-x0)/nx)/((y1-y0)/ny)));
    candidates.sort((a,b)=>balance(a)-balance(b));
    for(const [nx,ny]of candidates){
      const xs=axis(x0,x1,columns,nx),ys=axis(y0,y1,rows,ny),rects=[];let valid=true;
      for(let j=1;j<ys.length&&valid;j++)for(let i=1;i<xs.length;i++){
        const rect={x:xs[i-1],y:ys[j-1],width:xs[i]-xs[i-1],height:ys[j]-ys[j-1]};
        if(!fits(rect)){valid=false;break;}rects.push(rect);
      }
      if(valid)return rects;
    }
  }
  throw Error('The visible preview cannot fit the terrain memory budget.');
}
