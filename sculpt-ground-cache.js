import {groundCacheUsage} from './sculpt-ground-presets.js';
// One layer per material in use. Color edits retain shape fields; palette grain is cached separately.
export class GroundCache {
 constructor(renderer,source,ditherSource){this.ditherSource=ditherSource;this.colorKeys=new Map();this.renderer=renderer;this.source=source;this.keys=new Map();this.layers=[];this.pool=0;this.generations=0;this.bytes=8;this.allocate(1,1);}
 allocate(pool,count){
  const r=this.renderer;
  if(this.texture){if(r.release)r.release(this.texture);else this.texture.destroy();}
  this.texture=r.device.createTexture({label:'ground recipes',size:[pool,pool,count],format:'rgba16float',usage:GPUTextureUsage.TEXTURE_BINDING|GPUTextureUsage.STORAGE_BINDING|GPUTextureUsage.COPY_SRC});
  if(this.colorTexture){if(r.release)r.release(this.colorTexture);else this.colorTexture.destroy();}
  this.colorTexture=r.device.createTexture({label:'material palette grain',size:[pool,pool,count],format:'rgba8unorm',usage:GPUTextureUsage.TEXTURE_BINDING|GPUTextureUsage.STORAGE_BINDING|GPUTextureUsage.COPY_SRC});
  r.track?.(this.colorTexture,'material palette grain',pool*pool*count*4,'materials');
  this.colorKeys.clear();this.bytes=pool*pool*count*12;r.track?.(this.texture,'ground recipes',pool*pool*count*8,'materials');
  if(r.resources)r.fixedBytes=[...r.resources.values()].filter(v=>v.kind==='materials'||v.kind==='shared').reduce((n,v)=>n+v.bytes,0);
  r.bindGroups={};this.keys.clear();
 }
 prepare(pool,grounds){
  const usage=groundCacheUsage(grounds.size,pool);
  if(!usage.fits)throw Error(`This world can use at most ${usage.capacity} ground materials within its 128 MiB cache budget.`);
  const layers=[...grounds.keys()].sort((a,b)=>a-b);
  if(this.pool!==pool||String(this.layers)!==String(layers)){
   this.allocate(layers.length?pool:1,Math.max(1,layers.length));this.pool=pool;this.layers=layers;
  }
  const r=this.renderer,table=r.uniform.get('ground');r.f('uPool',pool);
  for(let slot=0;slot<table.count;slot++)r.uniformView.setInt32(table.offset+slot*table.stride+table.members.get('cacheLayer').offset,layers.indexOf(slot),true);
  r.i('uGroundAny',layers.length?1:0);
 }
 sync(pool,grounds){
  this.prepare(pool,grounds);
  const r=this.renderer,layers=this.layers;
  const changed=[];
  for(const slot of layers){
   const knobs=grounds.get(slot).knobs,key=JSON.stringify(Object.fromEntries(Object.entries(knobs).filter(([k])=>!['textureFine','patternEase','markMultiply','textureDither','diffusionMix','paletteGamma','paletteRed','paletteGreen','paletteBlue','grainColorMix','gloss','sharpness','roughness','roughnessScale','wetness'].includes(k))));
   if(this.keys.get(slot)!==key)changed.push([slot,key]);
  }
  if(!changed.length){this.syncColors(pool,grounds,[]);return;}
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
  r.device.queue.submit([encoder.finish()]);buffers.forEach(b=>b.destroy());this.syncColors(pool,grounds,changed.map(([slot])=>slot));
 }

 syncColors(pool,grounds,fieldChanges){
  const r=this.renderer,device=r.device;
  for(const slot of this.layers){
   const recipe=grounds.get(slot);if(!recipe.knobs.textureDither)continue;
   const key=JSON.stringify(recipe);if(!fieldChanges.includes(slot)&&this.colorKeys.get(slot)===key)continue;
   if(!this.ditherPipeline)this.ditherPipeline=device.createComputePipeline({label:'material palette diffusion',layout:'auto',compute:{module:device.createShaderModule({label:'material palette diffusion',code:this.ditherSource}),entryPoint:'diffuseMaterial'}});
   r.flushUniforms();
   const error=device.createBuffer({label:'material error rows',size:(pool+2)*129*16,usage:GPUBufferUsage.STORAGE});
   const common=device.createBindGroup({layout:this.ditherPipeline.getBindGroupLayout(0),entries:[{binding:0,resource:{buffer:r.uniformBuffer}},{binding:13,resource:this.texture.createView({dimension:'2d-array'})}]});
   const encoder=device.createCommandEncoder({label:'material palette diffusion'}),jobs=[];
   for(let row=0;row<pool;row+=128){
    const job=device.createBuffer({size:16,usage:GPUBufferUsage.UNIFORM|GPUBufferUsage.COPY_DST});jobs.push(job);device.queue.writeBuffer(job,0,new Uint32Array([slot,this.layers.indexOf(slot),row,128]));
    const pass=encoder.beginComputePass();pass.setPipeline(this.ditherPipeline);pass.setBindGroup(0,common);
    pass.setBindGroup(1,device.createBindGroup({layout:this.ditherPipeline.getBindGroupLayout(1),entries:[{binding:0,resource:this.colorTexture.createView({dimension:'2d-array'})},{binding:1,resource:{buffer:error}},{binding:2,resource:{buffer:job}}]}));pass.dispatchWorkgroups(1);pass.end();
   }
   device.queue.submit([encoder.finish()]);error.destroy();jobs.forEach(b=>b.destroy());this.colorKeys.set(slot,key);
  }
 }
}
