// Exact signed/unsigned-channel and filtered-sampling proof for LP5 inputs.
// node repro/color-mask-pack.mjs --server http://127.0.0.1:<yours> --out /private/tmp/lp5
import assert from 'node:assert/strict';
import {mkdirSync,readFileSync,writeFileSync} from 'node:fs';
import {resolve} from 'node:path';
import * as H from './headless.mjs';
import {preprocess} from '../sculpt-renderer.js';
const args=process.argv.slice(2),opt=(name,fallback)=>{const at=args.indexOf(name);return at<0?fallback:args.splice(at,2)[1];};
const server=opt('--server',''),out=resolve(opt('--out','/private/tmp/terraform-color-mask-pack'));
if(args.length||!server||new URL(server).port==='8801'||out===H.REPO||out.startsWith(H.REPO+'/'))throw Error('Give your own --server and an --out folder outside the repository.');
mkdirSync(out,{recursive:true});await H.openHost({server});
const s=await H.openScene({biome:'green',ground:false,strokes:[]},'biome=green&mapX=4&mapY=4&scratch=1&gpuMB=512'),r=s.renderer,d=r.device;
const width=5,height=35,layers=7,T=GPUTextureUsage,raw=new Int8Array(width*height*layers*4),values=[-128,-127,-64,0,1,63,126,127];
for(let i=0;i<raw.length;i++)raw[i]=values[(i*5+Math.floor(i/width))%values.length];
r.maskTexture=r.texture('signed mask fixture',width,height,layers,'rgba8snorm',4,T.COPY_DST|T.COPY_SRC|T.TEXTURE_BINDING);
const reference=r.texture('original signed masks',width,height,layers,'rgba8snorm',4,T.COPY_DST|T.TEXTURE_BINDING);r.colorMaskTexture=r.maskTexture;
d.queue.writeTexture({texture:r.maskTexture},raw,{bytesPerRow:width*4,rowsPerImage:height},[width,height,layers]);const original=d.createCommandEncoder();original.copyTextureToTexture({texture:r.maskTexture},{texture:reference},[width,height,layers]);d.queue.submit([original.finish()]);
const grid=new Uint8Array(width*height*4*4),unsigned=[0,1,63,127,128,200,254,255];
for(let i=0;i<grid.length;i++)grid[i]=unsigned[(i*3+Math.floor(i/width))%unsigned.length];
r.gridTexture=r.texture('unsigned grid fixture',width,height,4,'rgba8unorm',4,T.COPY_DST|T.COPY_SRC|T.TEXTURE_BINDING);
const gridReference=r.texture('original unsigned grids',width,height,4,'rgba8unorm',4,T.COPY_DST|T.TEXTURE_BINDING);
d.queue.writeTexture({texture:r.gridTexture},grid,{bytesPerRow:width*4,rowsPerImage:height},[width,height,4]);
const copyGrid=d.createCommandEncoder();copyGrid.copyTextureToTexture({texture:r.gridTexture},{texture:gridReference},[width,height,4]);d.queue.submit([copyGrid.finish()]);
// Keep the original forced budget; denser staging now needs three bands.

const budget=r.budgetBytes;r.budgetBytes=64*32*12/.35;await r.packColorMasks();r.budgetBytes=budget;
const common=readFileSync(new URL('../engine-common.wgsl',import.meta.url),'utf8'),source=preprocess(common,'',new Set(['VOLUME_RENDER','COLOR_PASS']))+`
@group(3) @binding(3) var reference:texture_2d_array<f32>;
@group(3) @binding(4) var<storage,read_write> checks:array<vec4u>;
@group(3) @binding(5) var originalGrid:texture_2d_array<f32>;
@compute @workgroup_size(8) fn check(@builtin(global_invocation_id) id:vec3u){
  if(id.x>=126u){return;}
  let points=array<vec2f,14>(vec2f(-.2),vec2f(0),vec2f(.1,.2),vec2f(.3,.4),vec2f(.5),vec2f(.92,.8),vec2f(1),vec2f(1.2),vec2f(.5,15.5/35.0),vec2f(.5,16.5/35.0),vec2f(.5,16.0/35.0),vec2f(.5,31.5/35.0),vec2f(.5,32.5/35.0),vec2f(.5,32.0/35.0));
  let layer=i32(id.x%9u);let uv=points[id.x/9u];var expected=vec4f(0);var actual=vec4f(0);
  if(layer<6){
    expected=sampleRegionalArray(reference,uv*vec2f(textureDimensions(reference)),layer);
    switch layer {case 1:{expected=vec4f(0,expected.g,0,0);}case 2:{expected=vec4f(0,0,expected.b,0);}case 3:{expected=vec4f(0,0,0,expected.a);}case 5:{expected=vec4f(expected.r,0,0,0);}default:{}}
    actual=sampleMasks(uv*vec2f(textureDimensions(reference)),layer);
  }else{
    let p=uv*vec2f(textureDimensions(originalGrid));
    switch layer {
      case 6:{let w=sampleRegionalArray(originalGrid,p,0);let t=sampleRegionalArray(originalGrid,p,2);expected=vec4f(w.rg,t.rg);}
      case 7:{expected=sampleRegionalArray(originalGrid,p,1);}
      default:{expected=vec4f(sampleRegionalArray(originalGrid,p,3).rg,0,0);}
    }
    actual=sampleRegionalArray(gridTex,p,layer-6);
  }
  checks[id.x*2u]=bitcast<vec4u>(expected);checks[id.x*2u+1u]=bitcast<vec4u>(actual);
}`;
const pipeline=await d.createComputePipelineAsync({layout:'auto',compute:{module:d.createShaderModule({label:'signed mask sampling check',code:source}),entryPoint:'check'}}),result=d.createBuffer({size:126*2*16,usage:GPUBufferUsage.STORAGE|GPUBufferUsage.COPY_SRC}),read=d.createBuffer({size:result.size,usage:GPUBufferUsage.COPY_DST|GPUBufferUsage.MAP_READ});
const encoder=d.createCommandEncoder(),pass=encoder.beginComputePass();pass.setPipeline(pipeline);
pass.setBindGroup(0,d.createBindGroup({layout:pipeline.getBindGroupLayout(0),entries:[{binding:4,resource:r.gridTexture.createView({dimension:'2d-array'})},{binding:7,resource:r.linearClamp}]}));
pass.setBindGroup(3,d.createBindGroup({layout:pipeline.getBindGroupLayout(3),entries:[{binding:2,resource:r.colorMaskTexture.createView({dimension:'2d-array'})},{binding:3,resource:reference.createView({dimension:'2d-array'})},{binding:4,resource:{buffer:result}},{binding:5,resource:gridReference.createView({dimension:'2d-array'})}]}));
pass.dispatchWorkgroups(16);pass.end();encoder.copyBufferToBuffer(result,0,read,0,result.size);d.queue.submit([encoder.finish()]);await read.mapAsync(GPUMapMode.READ);
const checks=new Uint32Array(read.getMappedRange());for(let sample=0;sample<126;sample++)assert.deepEqual([...checks.subarray(sample*8,sample*8+4)],[...checks.subarray(sample*8+4,sample*8+8)],'filtered packed input sample '+sample);
read.destroy();result.destroy();await d.queue.onSubmittedWorkDone();await new Promise(resolve=>setTimeout(resolve,30));assert.deepEqual(s.errors,[]);
writeFileSync(out+'/color-mask-pack.json',JSON.stringify({width,height,sourceLayers:layers,packedLayers:3,signedValues:values,unsignedValues:unsigned,gridSourceLayers:4,gridPackedLayers:3,samples:126,channelsCompared:504,packing:"in place in three bands at the original forced budget",different:0,errors:s.errors}));s.dispose();process.exit(0);
