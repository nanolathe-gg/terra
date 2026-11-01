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
