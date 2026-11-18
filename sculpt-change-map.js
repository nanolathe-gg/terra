// Compare derived fields on the GPU; only a small tile bitset crosses back to
// JS. A height or mask edit already invalidates authored dependencies. This
// catches additional changes introduced by refinement without clearing the map.
const pipelines=new WeakMap();
// Geometry edits invalidate refinement even where their heights happen to match.
// Keep the accumulated footprint until a result for the new geometry replaces it.
export function invalidateRefinement(previous,rect,grid){
 const r=rect??{x0:0,y0:0,x1:grid-1,y1:grid-1};
 return {x0:Math.max(0,Math.min(previous?.x0??r.x0,r.x0)),y0:Math.max(0,Math.min(previous?.y0??r.y0,r.y0)),x1:Math.min(grid-1,Math.max(previous?.x1??r.x1,r.x1)),y1:Math.min(grid-1,Math.max(previous?.y1??r.y1,r.y1))};
}
export const refinementValid=(rect,x,y)=>!rect||x<rect.x0||y<rect.y0||x>rect.x1||y>rect.y1;
export function dirtyTileRects(flags,grid,tile,spacing){
 const columns=Math.ceil(grid/tile),out=[];
 for(let i=0;i<flags.length;i++)if(flags[i]){const x=(i%columns)*tile,y=Math.floor(i/columns)*tile;out.push({x:x*spacing,y:y*spacing,width:Math.min(tile,grid-x)*spacing,height:Math.min(tile,grid-y)*spacing});}
 return out;
}
export async function changedWeatherTiles(device,before,after,grid,spacing,tile=64){
 if(!before||Boolean(before.field)!==Boolean(after.field)||before.mapsOn===false)return null;
 let pipe=pipelines.get(device);
 if(!pipe){const module=device.createShaderModule({label:'changed refinement tiles',code:`
 struct Params {grid:u32,tile:u32,columns:u32,lanes:u32,stride:u32,step:u32};
 @group(0) @binding(0) var<uniform> p:Params;
 @group(0) @binding(1) var<storage,read> a:array<u32>;
 @group(0) @binding(2) var<storage,read> b:array<u32>;
 @group(0) @binding(3) var<storage,read_write> dirty:array<atomic<u32>>;
 @compute @workgroup_size(8,8) fn main(@builtin(global_invocation_id) id:vec3u){
  if(id.x>=p.grid||id.y>=p.grid){return;}
  let cell=id.y*p.grid+id.x;
  for(var lane=0u;lane<p.lanes;lane++){let i=cell*p.stride+lane*p.step;if(a[i]!=b[i]){atomicOr(&dirty[(id.y/p.tile)*p.columns+id.x/p.tile],1u);break;}}
 }`});pipe=device.createComputePipeline({label:'changed refinement tiles',layout:'auto',compute:{module,entryPoint:'main'}});pipelines.set(device,pipe);}
 const columns=Math.ceil(grid/tile),bytes=columns*columns*4,S=GPUBufferUsage,dirty=device.createBuffer({size:bytes,usage:S.STORAGE|S.COPY_SRC}),read=device.createBuffer({size:bytes,usage:S.COPY_DST|S.MAP_READ});
 const pairs=[[before.weather,after.weather,2,1,grid*grid],...before.maps.map((a,i)=>[a,after.maps[i],1,1,1]),...(before.field?[[before.field,after.field,1,1,1]]:[])];
 const uniform=device.createBuffer({size:pairs.length*256,usage:S.UNIFORM|S.COPY_DST}),data=new Uint32Array(pairs.length*64);pairs.forEach((p,i)=>data.set([grid,tile,columns,...p.slice(2)],i*64));device.queue.writeBuffer(uniform,0,data);
 const enc=device.createCommandEncoder({label:'changed refinement tiles'});
 try{
  for(const [i,pair] of pairs.entries()){const pass=enc.beginComputePass({label:'changed refinement tiles'});pass.setPipeline(pipe);pass.setBindGroup(0,device.createBindGroup({layout:pipe.getBindGroupLayout(0),entries:[{binding:0,resource:{buffer:uniform,offset:i*256,size:24}},{binding:1,resource:{buffer:pair[0]}},{binding:2,resource:{buffer:pair[1]}},{binding:3,resource:{buffer:dirty}}]}));pass.dispatchWorkgroups(Math.ceil(grid/8),Math.ceil(grid/8));pass.end();}
  enc.copyBufferToBuffer(dirty,0,read,0,bytes);device.queue.submit([enc.finish()]);await read.mapAsync(GPUMapMode.READ);return dirtyTileRects(new Uint32Array(read.getMappedRange().slice(0)),grid,tile,spacing);
 }finally{dirty.destroy();read.destroy();uniform.destroy();}
}
