// Compare the four reviewed procedural presets against a captured baseline.
// Run --capture on the base checkout first, then run here. Art stays in /tmp.
import assert from 'node:assert/strict';
import {mkdirSync,writeFileSync,readFileSync} from 'node:fs';
import {openHost,openScene,renderWindow} from './headless.mjs';
import {GROUND_PRESETS,addGround} from '../sculpt-ground-presets.js';
import {preprocess} from '../sculpt-renderer.js';
import {encodePng} from './png.mjs';
const keys=['rust-mottling','cloudy-green','blue-streaked-water','violet-rippled-water'];
await openHost();const out='/private/tmp/preset-components';mkdirSync(out,{recursive:true});
const s=await openScene({biome:'red',ground:false,strokes:[]},'biome=red&mapX=2&mapY=2&palette=off&view=color');
s.renderer.budgetBytes=256*1024*1024;
const rect={x:256,y:256,width:128,height:128},report={};
const differences=(a,b)=>{let pixels=0,max=0;for(let i=0;i<a.length;i+=4){let d=0;for(let c=0;c<3;c++)d=Math.max(d,Math.abs(a[i+c]-b[i+c]));if(d)pixels++;max=Math.max(max,d);}return {pixels,max};};
// Recompiling GPU arithmetic can change diffusion decisions near ties. Keep
// reporting those pixels, but compare pigment/shading exactly and report the
// dither distribution separately rather than freezing its individual dots.
function paletteStatistics(a,b){
 const n=a.length/4,means=[0,0,0],hist=new Map();let blockMax=0,blockMean=0;
 for(let i=0;i<a.length;i+=4){for(let c=0;c<3;c++)means[c]+=(b[i+c]-a[i+c])/n;const x=[...a.subarray(i,i+3)].join(','),y=[...b.subarray(i,i+3)].join(',');hist.set(x,(hist.get(x)??0)-1);hist.set(y,(hist.get(y)??0)+1);}
 const size=Math.sqrt(n);for(let y=0;y<size;y+=16)for(let x=0;x<size;x+=16)for(let c=0;c<3;c++){let diff=0;for(let j=0;j<16;j++)for(let i=0;i<16;i++){const at=((y+j)*size+x+i)*4+c;diff+=b[at]-a[at];}diff=Math.abs(diff/256);blockMax=Math.max(blockMax,diff);blockMean+=diff/((size/16)**2*3);}
 return {meanRGBDelta:means,paletteFrequencyDelta:Math.max(...[...hist.values()].map(Math.abs))/n,blockMeanDelta:blockMean,blockMaxDelta:blockMax};
}
async function palette(){const r=s.renderer,size=r.groundCache.pool,row=size*4,buffer=r.device.createBuffer({size:row*size,usage:GPUBufferUsage.COPY_DST|GPUBufferUsage.MAP_READ});const e=r.device.createCommandEncoder();e.copyTextureToBuffer({texture:r.groundCache.colorTexture},{buffer,bytesPerRow:row},[size,size,1]);r.device.queue.submit([e.finish()]);await buffer.mapAsync(GPUMapMode.READ);const bytes=new Uint8Array(buffer.getMappedRange()).slice();buffer.unmap();buffer.destroy();return bytes;}
async function raw(){
 const r=s.renderer,n=r.groundCache.pool,b=r.device.createBuffer({size:n*n*16,usage:GPUBufferUsage.STORAGE|GPUBufferUsage.COPY_SRC}),read=r.device.createBuffer({size:n*n*16,usage:GPUBufferUsage.COPY_DST|GPUBufferUsage.MAP_READ});
 const pipeline=r.device.createComputePipeline({layout:'auto',compute:{module:r.device.createShaderModule({code:preprocess(`/*COMMON*/
@group(1) @binding(0) var<storage,read_write> output:array<vec4f>;
@compute @workgroup_size(8,8) fn main(@builtin(global_invocation_id) id:vec3u){if(any(id.xy>=vec2u(textureDimensions(groundTex).x))){return;}output[id.y*textureDimensions(groundTex).x+id.x]=vec4f(materialRaw(vec2f(id.xy),1u),1);}`,r.commonSource,new Set())}),entryPoint:'main'}});
 const e=r.device.createCommandEncoder(),pass=e.beginComputePass();pass.setPipeline(pipeline);pass.setBindGroup(0,r.device.createBindGroup({layout:pipeline.getBindGroupLayout(0),entries:[{binding:0,resource:{buffer:r.uniformBuffer}},{binding:13,resource:r.groundCache.texture.createView({dimension:'2d-array'})}]}));pass.setBindGroup(1,r.device.createBindGroup({layout:pipeline.getBindGroupLayout(1),entries:[{binding:0,resource:{buffer:b}}]}));pass.dispatchWorkgroups(n/8,n/8);pass.end();e.copyBufferToBuffer(b,0,read,0,n*n*16);r.device.queue.submit([e.finish()]);await read.mapAsync(GPUMapMode.READ);const f=new Float32Array(read.getMappedRange()).slice();read.unmap();b.destroy();read.destroy();return f;
}
async function sample(p){const list=addGround([],p,p.name).grounds;list[0].worldGround=true;s.setGrounds(list);s.renderer.variant.set('view','color');s.renderer.applyKnobs();const color=await renderWindow(s,rect),grain=await palette(),float=await raw();s.renderer.variant.delete('view');s.renderer.applyKnobs();const shaded=await renderWindow(s,rect);return {color,grain,shaded,list,float};}
try{
 for(const key of keys){
  if(process.argv.includes('--capture')){const data=await sample(GROUND_PRESETS[key]);for(const part of ['color','grain','shaded','float'])writeFileSync(out+'/'+key+'-'+part+'.bin',Buffer.from(data[part].buffer));continue;}
  const before=Object.fromEntries(['color','grain','shaded','float'].map(part=>{const b=readFileSync(out+'/'+key+'-'+part+'.bin');return [part,part==='float'?new Float32Array(b.buffer.slice(b.byteOffset,b.byteOffset+b.byteLength)):b];}));
  const after=await sample(GROUND_PRESETS[key]);
  assert.equal(after.grain.length,before.grain.length,'Baseline repeat size differs; capture a matching baseline before comparing.');
  let f=0,max=0;for(let i=0;i<before.float.length;i++){const d=Math.abs(before.float[i]-after.float[i]);if(d)f++;max=Math.max(max,d);}
  report[key]={floatComponentsChanged:f,floatMaxDifference:max,nodes:after.list[0].steps.length,paletteStatistics:paletteStatistics(before.grain,after.grain),color:differences(before.color,after.color),shaded:differences(before.shaded,after.shaded),paletteRepeat:differences(before.grain,after.grain)};
  for(const [label,bytes]of [['before',before.grain],['after',after.grain]])writeFileSync(out+'/'+key+'-palette-'+label+'.png',encodePng(Math.sqrt(bytes.length/4),Math.sqrt(bytes.length/4),bytes));
  writeFileSync(out+'/'+key+'-before.png',encodePng(128,128,before.shaded));writeFileSync(out+'/'+key+'-after.png',encodePng(128,128,after.shaded));
  console.log(key,JSON.stringify(report[key]));
 }
 assert.deepEqual(s.errors,[]);writeFileSync(out+'/report.json',JSON.stringify(report,null,2));
 for(const r of Object.values(report))assert.ok(r.floatMaxDifference<1/255,'continuous difference below one channel byte');
 for(const r of Object.values(report))for(const channel of ['color','shaded'])assert.equal(r[channel].pixels,0,channel+' unchanged');
}finally{s.dispose();}process.exit(0);
