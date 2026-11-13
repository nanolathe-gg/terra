import {createShapeEngine} from './sculpt-gpu-fields.js';
import {terrainAllocation} from './sculpt-memory.js';
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
export function createPreviewLattice(device,scene,memoryChanged=()=>{}){
  let engine=null,target=null,weather=null,starting=null,shapeKey='',key='',weatherKey='',weatherWindow=null,working=0,runs=0,timeRuns=0,weatherReuses=0,peak=0;
  const bytes=()=> (engine?.bytes()??0)+(target?.bytes??0)+(weather?.bytes??0)+(weather?.field?.size??0)+working;
  const dropWeather=()=>{weather?.weather.destroy();weather?.maps.forEach(b=>b.destroy());weather?.field?.destroy();weather=null;weatherKey='';weatherWindow=null;};
  const trim=()=>{target?.destroy();engine?.destroy();engine=target=starting=null;shapeKey=key='';working=0;};
  const clear=()=>{dropWeather();trim();};
  const plan=(region,on=true,deferTime=false)=>{
    const s=scene(),w=previewWindow(region,region.worldGrid,s.size,s.timeApron??128*s.spacing,deferTime?weatherWindow:null);
    const tm=on?s.previewTime?.({size:w.spacing*(w.side-1)+1,spacing:w.spacing}):null;
    const geometry=[w.grid,w.x,w.y,w.side].join(','),sk=[geometry,s.revision].join('|'),wk=[geometry,tm?.key??'',tm?.revB??s.revB].join('|'),cache=sk+'|'+wk;
    const reuse=Boolean(tm&&deferTime&&weather&&weatherKey===wk),runTime=tm&&!reuse&&key!==cache;
    // Shape planes/masks 56, worst shape scratch 56, Time working <=144 bytes
    // per cell. The extra reserve covers coast sites and request uniforms.
    const peakBytes=16*1024*1024+w.cells*(112+(tm?144:0))+65536;
    const requestPeak=runTime?peakBytes:16*1024*1024+w.cells*112+(weather?.bytes??0)+(weather?.field?.size??0)+65536;
    return {...w,s,tm,sk,wk,reuse,cache,peakBytes,additionalBytes:key===cache&&target?0:Math.max(0,requestPeak-bytes())};
  };
  return {
    grid:level=>{const s=scene();return previewGrid(s.size,s.grid,level);},plan,bytes,
    stats:()=>({runs,timeRuns,weatherReuses,bytes:bytes(),peakBytes:peak,grid:engine?.grid??null,side:target?.pw??null}),clear,trim,
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
            submitted=engine.submit(s.nodes,s.context,null,{readback:false,target});
          });
          await submitted.done;current();shapeKey=p.sk;runs++;
        }
        if(key!==p.cache){
          if(!p.reuse)dropWeather();else weatherReuses++;key='';
          if(tm&&!p.reuse){
            working=p.cells*144+65536;peak=Math.max(peak,bytes());memoryChanged();
            try{weather=await tm.run({planes:target.F,masks:target.Mk,grid:p.side,ox:p.x,oy:p.y,stale:()=>Boolean(signal?.aborted)||Boolean(stale?.())});timeRuns++;}
            finally{working=0;}
            current();weatherKey=p.wk;weatherWindow={x:p.x,y:p.y,side:p.side,spacing:p.spacing,grid:p.grid,cells:p.cells};
          }
          key=p.cache;
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
