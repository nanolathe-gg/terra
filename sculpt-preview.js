import {createShapeEngine} from './sculpt-gpu-fields.js';
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
