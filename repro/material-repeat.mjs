// Small focused GPU checks for the graph repeat, independent of world ground.
import assert from 'node:assert/strict';
import {openHost,openScene,renderWindow} from './headless.mjs';
import {preprocess} from '../sculpt-renderer.js';
import {GROUND_PRESETS,addGround,MATERIAL_REPEAT} from '../sculpt-ground-presets.js';
// Probe the product's material sampler at exact world coordinates. Screen
// windows also contain voxel geometry, which can move their surface hit points.
async function repeat(renderer){
 const r=renderer,d=r.device,bytes=64*64*4,output=d.createBuffer({size:bytes,usage:GPUBufferUsage.STORAGE|GPUBufferUsage.COPY_SRC}),read=d.createBuffer({size:bytes,usage:GPUBufferUsage.COPY_DST|GPUBufferUsage.MAP_READ});
 const code=preprocess(`/*COMMON*/
@group(1) @binding(0) var<storage,read_write> output:array<u32>;
@compute @workgroup_size(8,8) fn main(@builtin(global_invocation_id) id:vec3u){
 let p=vec2f(id.xy)+480.0;let x=p+vec2f(512,0);let y=p+vec2f(0,512);
 let raw=materialRaw(p,1u);let pigment=materialPigment(p,1u);let height=materialRelief(p,1u);
 output[id.y*64u+id.x]=select(1u,0u,all(raw==materialRaw(x,1u))&&all(raw==materialRaw(y,1u))&&all(pigment==materialPigment(x,1u))&&all(pigment==materialPigment(y,1u))&&height==materialRelief(x,1u)&&height==materialRelief(y,1u));
}`,r.commonSource,new Set());
 const pipeline=d.createComputePipeline({layout:'auto',compute:{module:d.createShaderModule({code}),entryPoint:'main'}}),e=d.createCommandEncoder(),pass=e.beginComputePass();
 pass.setPipeline(pipeline);pass.setBindGroup(0,d.createBindGroup({layout:pipeline.getBindGroupLayout(0),entries:[{binding:0,resource:{buffer:r.uniformBuffer}},{binding:13,resource:r.groundCache.texture.createView({dimension:'2d-array'})},{binding:14,resource:r.groundCache.colorTexture.createView({dimension:'2d-array'})}]}));
 pass.setBindGroup(1,d.createBindGroup({layout:pipeline.getBindGroupLayout(1),entries:[{binding:0,resource:{buffer:output}}]}));pass.dispatchWorkgroups(8,8);pass.end();e.copyBufferToBuffer(output,0,read,0,bytes);d.queue.submit([e.finish()]);
 await read.mapAsync(GPUMapMode.READ);const failures=new Uint32Array(read.getMappedRange()).reduce((sum,x)=>sum+x,0);read.unmap();read.destroy();output.destroy();assert.equal(failures,0,'raw color, palette color, and height repeat exactly across the seam');
}
await openHost();const s=await openScene({biome:'red',ground:false,strokes:[]},'biome=red&mapX=2&mapY=2&palette=off&view=palette-color'),report={};
const requested=process.argv.indexOf('--preset');
try{for(const key of requested>=0?[process.argv[requested+1]]:['rust-mottling','cloudy-green','blue-streaked-water','violet-rippled-water']){
 const list=addGround([],GROUND_PRESETS[key],key).grounds;list[0].worldGround=true;s.setGrounds(list);
 const rect={x:256,y:256,width:64,height:64},base=await renderWindow(s,rect);
 assert.equal(s.renderer.groundCache.pool,MATERIAL_REPEAT);assert.equal(s.renderer.groundCache.bytes,7*1024*1024);
 assert.equal(s.renderer.uniformView.getFloat32(s.renderer.uniform.get('pool').offset,true),1024,'world repeat stays unchanged');
 await repeat(s.renderer);assert.deepEqual(await renderWindow(s,{...rect,tile:32}),base,'regional replay');
 report[key]={repeat:512,cacheMiB:7,period:'exact',regional:'exact'};
 }assert.deepEqual(s.errors,[]);console.log(JSON.stringify(report));}finally{s.dispose();}process.exit(0);
