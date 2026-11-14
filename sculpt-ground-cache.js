import {groundCacheUsage} from './sculpt-ground-presets.js';
// One layer per material in use. Color/finish edits upload uniforms only.
export class GroundCache {
 constructor(renderer,source){this.renderer=renderer;this.source=source;this.keys=new Map();this.layers=[];this.pool=0;this.generations=0;this.bytes=8;this.allocate(1,1);}
 allocate(pool,count){
  const r=this.renderer;
  if(this.texture){if(r.release)r.release(this.texture);else this.texture.destroy();}
  this.texture=r.device.createTexture({label:'ground recipes',size:[pool,pool,count],format:'rgba16float',usage:GPUTextureUsage.TEXTURE_BINDING|GPUTextureUsage.STORAGE_BINDING|GPUTextureUsage.COPY_SRC});
  this.bytes=pool*pool*count*8;r.track?.(this.texture,'ground recipes',this.bytes,'materials');
  if(r.resources)r.fixedBytes=[...r.resources.values()].filter(v=>v.kind==='materials'||v.kind==='shared').reduce((n,v)=>n+v.bytes,0);
  r.bindGroups={};this.keys.clear();
 }
 sync(pool,grounds){
  const usage=groundCacheUsage(grounds.size,pool);
  if(!usage.fits)throw Error(`This world can use at most ${usage.capacity} ground materials within its 128 MiB cache budget.`);
  const layers=[...grounds.keys()].sort((a,b)=>a-b);
  if(this.pool!==pool||String(this.layers)!==String(layers)){
   this.allocate(layers.length?pool:1,Math.max(1,layers.length));this.pool=pool;this.layers=layers;
  }
  const r=this.renderer,table=r.uniform.get('ground');r.f('uPool',pool);
  for(let slot=0;slot<table.count;slot++)r.uniformView.setInt32(table.offset+slot*table.stride+table.members.get('cacheLayer').offset,layers.indexOf(slot),true);
  r.i('uGroundAny',layers.length?1:0);
  const changed=[];
  for(const slot of layers){
   const knobs=grounds.get(slot).knobs,key=JSON.stringify(Object.fromEntries(Object.entries(knobs).filter(([k])=>!['grainColorMix','gloss','sharpness','roughness','roughnessScale','wetness'].includes(k))));
   if(this.keys.get(slot)!==key)changed.push([slot,key]);
  }
  if(!changed.length)return;
  if(!this.pipeline)this.pipeline=r.device.createComputePipeline({label:'ground generator',layout:'auto',compute:{module:r.device.createShaderModule({label:'ground generator',code:this.source}),entryPoint:'groundMain'}});
  // Upload all recipe rows before generation; the queue preserves these writes
  // ahead of the subsequent chunk bake without a CPU/GPU round trip.
  r.uniformsDirty=true;r.flushUniforms();
  const encoder=r.device.createCommandEncoder({label:'ground recipes'}),buffers=[];
  for(const [slot,key] of changed){
   const job=r.device.createBuffer({size:16,usage:GPUBufferUsage.UNIFORM|GPUBufferUsage.COPY_DST});buffers.push(job);
   r.device.queue.writeBuffer(job,0,new Uint32Array([slot,layers.indexOf(slot),0,0]));
   const pass=encoder.beginComputePass({label:'ground recipe'});pass.setPipeline(this.pipeline);
   pass.setBindGroup(0,r.device.createBindGroup({layout:this.pipeline.getBindGroupLayout(0),entries:[{binding:0,resource:{buffer:r.uniformBuffer}}]}));
   pass.setBindGroup(1,r.device.createBindGroup({layout:this.pipeline.getBindGroupLayout(1),entries:[{binding:0,resource:this.texture.createView({dimension:'2d-array'})},{binding:1,resource:{buffer:job}}]}));
   pass.dispatchWorkgroups(Math.ceil(pool/8),Math.ceil(pool/8));pass.end();this.keys.set(slot,key);this.generations++;
  }
  r.device.queue.submit([encoder.finish()]);buffers.forEach(b=>b.destroy());
 }
}
