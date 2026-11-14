import {materialLayers,resolveMaterialLayers,BLENDS,MASKS,PATTERNS,LAYER_EFFECTS} from './sculpt-material-layers.js';
import {groundCacheUsage} from './sculpt-ground-presets.js';
export function writeGroundData(r,recipe,view,at){
 const members=r.uniform.get('ground').members;
 for(const [key,value]of Object.entries(recipe.knobs))view.setFloat32(at+members.get(key).offset,value,true);
 const color=(offset,rgb,scale=255)=>(Array.isArray(rgb)?rgb:r.paletteIndexed[rgb]).forEach((v,c)=>view.setFloat32(offset+c*4,v/scale,true));
 for(const key of ['ramp','variationRamp'])recipe[key].forEach((rgb,k)=>color(at+members.get(key).offset+k*16,rgb));
 color(at+members.get('lineColor').offset,recipe.line);
 for(const [key,rgb]of Object.entries(recipe.textureColors))color(at+members.get('texture'+key[0].toUpperCase()+key.slice(1)).offset,rgb,['fineLow','fineHigh','markTint'].includes(key)?1:255);
 const palette=recipe.texturePalette.length?recipe.texturePalette:recipe.ramp;
 view.setInt32(at+members.get('texturePaletteCount').offset,palette.length,true);
 palette.forEach((rgb,k)=>color(at+members.get('texturePalette').offset+k*16,rgb));
}
// One cached procedural field per layer in use. Color edits retain shape fields; palette grain is cached separately.
export class GroundCache {
 constructor(renderer,source,ditherSource){this.ditherSource=ditherSource;this.colorKeys=new Map();this.renderer=renderer;this.source=source;this.keys=new Map();this.layers=[];this.pool=0;this.generations=0;this.bytes=8;this.layerStride=renderer.uniform.get('ground').stride+80;this.layerBuffer=renderer.device.createBuffer({label:'material layers',size:this.layerStride*64,usage:GPUBufferUsage.STORAGE|GPUBufferUsage.COPY_DST});renderer.track?.(this.layerBuffer,'material layers',this.layerStride*64,'materials');this.allocate(1,1,1);}
 allocate(pool,count,materials){
  const r=this.renderer;
  if(this.texture){if(r.release)r.release(this.texture);else this.texture.destroy();}
  this.texture=r.device.createTexture({label:'ground recipes',size:[pool,pool,count],format:'rgba16float',usage:GPUTextureUsage.TEXTURE_BINDING|GPUTextureUsage.STORAGE_BINDING|GPUTextureUsage.COPY_SRC});
  if(this.colorTexture){if(r.release)r.release(this.colorTexture);else this.colorTexture.destroy();}
  this.colorTexture=r.device.createTexture({label:'material palette grain',size:[pool,pool,materials],format:'rgba8unorm',usage:GPUTextureUsage.TEXTURE_BINDING|GPUTextureUsage.STORAGE_BINDING|GPUTextureUsage.COPY_SRC});
  r.track?.(this.colorTexture,'material palette grain',pool*pool*materials*4,'materials');
  if(this.maskTexture){if(r.release)r.release(this.maskTexture);else this.maskTexture.destroy();}
  this.maskTexture=r.device.createTexture({label:'material masks',size:[pool,pool,count],format:'r32float',usage:GPUTextureUsage.TEXTURE_BINDING|GPUTextureUsage.STORAGE_BINDING});
  r.track?.(this.maskTexture,'material masks',pool*pool*count*4,'materials');
  this.colorKeys.clear();this.bytes=pool*pool*(count*12+materials*4);r.track?.(this.texture,'ground recipes',pool*pool*count*8,'materials');
  if(r.resources)r.fixedBytes=[...r.resources.values()].filter(v=>v.kind==='materials'||v.kind==='shared').reduce((n,v)=>n+v.bytes,0);
  r.bindGroups={};this.keys.clear();
 }
 prepare(pool,grounds){
  const entries=[...grounds].sort(([a],[b])=>a-b).flatMap(([slot,p])=>resolveMaterialLayers(p).map((recipe,index)=>({slot,index,recipe})));
  const usage=groundCacheUsage(grounds.size,pool,entries.length);
  if(!usage.fits)throw Error(`These material layers need ${(usage.bytes/1048576).toFixed(0)} MiB; the cache budget is 128 MiB. Remove layers or use fewer assigned materials.`);
  const layers=[...grounds.keys()].sort((a,b)=>a-b);
  if(this.pool!==pool||String(this.layers)!==String(layers)||this.entries?.length!==entries.length){
   this.allocate(layers.length?pool:1,Math.max(1,entries.length),Math.max(1,layers.length));this.pool=pool;this.layers=layers;
  }
  const r=this.renderer,table=r.uniform.get('ground');r.f('uPool',pool);
  this.entries=entries;
  for(let slot=0;slot<table.count;slot++){const set=(k,v)=>r.uniformView.setInt32(table.offset+slot*table.stride+table.members.get(k).offset,v,true),first=entries.findIndex(e=>e.slot===slot),rows=entries.filter(e=>e.slot===slot);set('cacheLayer',first);set('stackStart',Math.max(0,first));set('stackCount',rows.length);set('colorLayer',layers.indexOf(slot));set('terrainMask',rows.some(e=>e.recipe.layer.visible&&e.recipe.layer.opacity>0&&['height','slope'].includes(e.recipe.layer.mask)&&e.recipe.layer.maskAmount>0)?1:0);}
  r.i('uGroundAny',layers.length?1:0);
 }
 sync(pool,grounds){
  this.prepare(pool,grounds);
  const r=this.renderer,layers=this.layers;
  const changed=[];
  const data=new ArrayBuffer(this.layerStride*Math.max(1,this.entries.length)),view=new DataView(data),groundStride=r.uniform.get('ground').stride;
  this.entries.forEach(({slot,index,recipe},row)=>{
   const at=row*this.layerStride;writeGroundData(r,recipe,view,at);view.setInt32(at+r.uniform.get('ground').members.get('cacheLayer').offset,row,true);
   const l=recipe.layer,values=[l.visible?l.opacity:0,l.color,l.height,l.surface,BLENDS.indexOf(l.blend),l.seed,MASKS.indexOf(l.mask),l.maskAmount,PATTERNS.indexOf(l.maskPattern),l.maskSize,l.maskDetail,l.maskWarp,l.maskSeed,l.maskLow,l.maskHigh,l.maskInvert,l.terrainLow,l.terrainHigh,l.terrainSoftness,LAYER_EFFECTS.indexOf(l.effect)];
   values.forEach((v,i)=>view.setFloat32(at+groundStride+i*4,v,true));
   const key=JSON.stringify([Object.fromEntries(Object.entries(recipe.knobs).filter(([k])=>!['textureFine','patternEase','markMultiply','textureDither','diffusionMix','paletteGamma','paletteRed','paletteGreen','paletteBlue','grainColorMix','gloss','sharpness','roughness','roughnessScale','wetness'].includes(k))),l.seed,values[19],...values.slice(6,16)]);
   if(l.visible&&l.opacity>0&&this.keys.get(row)!==key)changed.push([slot,key,row]);
  });
  const uploadKey=JSON.stringify([...grounds]);if(uploadKey!==this.uploadKey){r.device.queue.writeBuffer(this.layerBuffer,0,data);this.uploadKey=uploadKey;}
  if(!changed.length){this.syncColors(pool,grounds,[]);return;}
  if(!this.pipeline)this.pipeline=r.device.createComputePipeline({label:'ground generator',layout:'auto',compute:{module:r.device.createShaderModule({label:'ground generator',code:this.source}),entryPoint:'groundMain'}});
  // Upload all recipe rows before generation; the queue preserves these writes
  // ahead of the subsequent chunk bake without a CPU/GPU round trip.
  r.uniformsDirty=true;r.flushUniforms();
  const encoder=r.device.createCommandEncoder({label:'ground recipes'}),buffers=[];
  for(const [slot,key,row] of changed){
   const job=r.device.createBuffer({size:16,usage:GPUBufferUsage.UNIFORM|GPUBufferUsage.COPY_DST});buffers.push(job);
   r.device.queue.writeBuffer(job,0,new Uint32Array([slot,row,row,0]));
   const pass=encoder.beginComputePass({label:'ground recipe'});pass.setPipeline(this.pipeline);
   pass.setBindGroup(0,r.device.createBindGroup({layout:this.pipeline.getBindGroupLayout(0),entries:[{binding:0,resource:{buffer:r.uniformBuffer}},{binding:15,resource:{buffer:this.layerBuffer}}]}));
   pass.setBindGroup(1,r.device.createBindGroup({layout:this.pipeline.getBindGroupLayout(1),entries:[{binding:0,resource:this.texture.createView({dimension:'2d-array'})},{binding:1,resource:{buffer:job}},{binding:2,resource:this.maskTexture.createView({dimension:'2d-array'})}]}));
   pass.dispatchWorkgroups(Math.ceil(pool/8),Math.ceil(pool/8));pass.end();this.keys.set(row,key);this.generations++;
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
   const common=device.createBindGroup({layout:this.ditherPipeline.getBindGroupLayout(0),entries:[{binding:0,resource:{buffer:r.uniformBuffer}},{binding:13,resource:this.texture.createView({dimension:'2d-array'})},{binding:15,resource:{buffer:this.layerBuffer}},{binding:16,resource:this.maskTexture.createView({dimension:'2d-array'})}]});
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
