import assert from 'node:assert/strict';
import {mkdirSync,writeFileSync} from 'node:fs';
import {openHost,openScene,renderWindow} from './headless.mjs';
import {GROUND_PRESETS,addGround} from '../sculpt-ground-presets.js';
import {encodePng} from './png.mjs';
await openHost();
const preset=process.argv[2]||'violet-rippled-water';assert.ok(GROUND_PRESETS[preset],'known material preset');
const out='/private/tmp/texture-authoring-check/'+preset;mkdirSync(out,{recursive:true});
const grounds=addGround([],GROUND_PRESETS[preset],'Material').grounds;
grounds[0].worldGround=true;
const s=await openScene({biome:'red',ground:false,grounds,strokes:[]},'biome=red&mapX=4&mapY=4&palette=off');
s.renderer.budgetBytes=256*1024*1024;
try{
 const r=s.renderer;const rect={x:896,y:896,width:256,height:256};
 const a=await renderWindow(s,rect);writeFileSync(out+'/material.png',encodePng(256,256,a));
 const b=await renderWindow(s,{...rect,x:rect.x+1024});assert.deepEqual(a,b,'period across pool');
 const parts=new Uint8Array(a.length);
 for(let y=0;y<2;y++)for(let x=0;x<2;x++){
  const p=await renderWindow(s,{...rect,x:rect.x+x*128,y:rect.y+y*128,width:128,height:128});
  for(let row=0;row<128;row++)parts.set(p.subarray(row*512,(row+1)*512),((y*128+row)*256+x*128)*4);
 }
 assert.deepEqual(a,parts,'regional render');assert.deepEqual(s.errors,[]);
 // Quantized pigment is a full repeat, shared by every chunk and export.
 const size=r.groundCache.pool,row=size*4;
 const buffer=r.device.createBuffer({size:row*size,usage:GPUBufferUsage.COPY_DST|GPUBufferUsage.MAP_READ});
 const encoder=r.device.createCommandEncoder();encoder.copyTextureToBuffer({texture:r.groundCache.colorTexture},{buffer,bytesPerRow:row},[size,size,1]);r.device.queue.submit([encoder.finish()]);await buffer.mapAsync(GPUMapMode.READ);
 const pixels=new Uint8Array(buffer.getMappedRange()).slice();buffer.unmap();buffer.destroy();
 writeFileSync(out+'/pigment.png',encodePng(size,size,pixels));
 const allowed=new Set(grounds[0].texturePalette.map(i=>r.paletteIndexed[i].join(',')));let unique=new Set();for(let i=0;i<pixels.length;i+=4){const color=[...pixels.subarray(i,i+3)].join(',');assert.ok(allowed.has(color),'material palette color');unique.add(color);}
 assert.ok(unique.size>4,'diffusion produces a textured palette');console.log(JSON.stringify({preset,pool:size,paletteColors:unique.size,regional:'exact',period:'exact',gpuErrors:s.errors}));
}finally{s.dispose();}process.exit(0);
