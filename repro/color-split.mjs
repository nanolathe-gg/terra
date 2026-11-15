// LP5 step 0: small current-tile proofs, deliberately outside the quick runner.
// node repro/color-split.mjs --server http://127.0.0.1:8940 --out /private/tmp/lp5
// --repo <comparison checkout> --label <name> also records an unsplit baseline.
// --edges-only runs just the odd-tile / mixed-recipe / stage-guard proof.
// Dawn timings here are not page input latency or the whole visible view.
import assert from 'node:assert/strict';
import {readFileSync,writeFileSync,mkdirSync} from 'node:fs';
import {resolve,dirname,join} from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {createHash} from 'node:crypto';
const args=process.argv.slice(2),opt=(name,fallback)=>{const i=args.indexOf(name);return i<0?fallback:args.splice(i,2)[1];};
const edgesAt=args.indexOf('--edges-only'),edgesOnly=edgesAt>=0;if(edgesOnly)args.splice(edgesAt,1);
const repo=resolve(opt('--repo',join(dirname(fileURLToPath(import.meta.url)),'..'))),server=opt('--server',''),out=resolve(opt('--out','/private/tmp/terraform-color-split')),label=opt('--label','split');
if(args.length||!server||new URL(server).port==='8801'||out===repo||out.startsWith(repo+'/')||!/^[\w-]+$/.test(label))throw Error('Give your own --server and an --out folder outside the repository.');
mkdirSync(out,{recursive:true});
const H=await import(pathToFileURL(join(repo,'repro/headless.mjs'))),{encodePng}=await import(pathToFileURL(join(repo,'repro/png.mjs'))),{TerrainRenderer}=await import(pathToFileURL(join(repo,'sculpt-renderer.js')));
await H.openHost({server});
const rows=[],sha=data=>createHash('sha256').update(data).digest('hex'),resources=r=>[...r.resources.values()].map(({label,bytes,kind})=>({label,bytes,kind}));
async function read(r){
  const d=r.device,w=r.canvas.width,h=r.canvas.height,row=Math.ceil(w*4/256)*256,b=d.createBuffer({size:row*h,usage:GPUBufferUsage.COPY_DST|GPUBufferUsage.MAP_READ}),e=d.createCommandEncoder();
  e.copyTextureToBuffer({texture:r.canvas.gpu.texture},{buffer:b,bytesPerRow:row},[w,h]);d.queue.submit([e.finish()]);await b.mapAsync(GPUMapMode.READ);
  const raw=new Uint8Array(b.getMappedRange()),data=new Uint8Array(w*h*4);for(let y=0;y<h;y++)data.set(raw.subarray(y*row,y*row+w*4),y*w*4);b.destroy();return data;
}
async function warm(r,options){
  if(!r.recolor)return null;
  r.voxel.clear(); // No authored voxel surface, guides, brick tables or density may survive.
  const retained=resources(r),result=await r.recolor(options),data=await read(r);
  return {result,data,retained};
}
for(const name of (edgesOnly?[]:['green-modern-2','green-2','red-3','green-7']))for(const features of [false,true]){
  const scene=JSON.parse(readFileSync(join(repo,'repro/scenes',name+'.json'))),s=await H.openScene(scene,`biome=${scene.biome}&mapX=16&mapY=16&scratch=1&gpuMB=512${scene.query?'&'+scene.query:''}`);
  if(features)for(const [k,v]of Object.entries({faceWhole:.5,faceWholeLarge:.5,faceFresh:1,faceRind:1,faceWet:.7,faceLamina:1,absorbDepth:1,shadowTint:1,cavity:1,closeShadow:1}))await H.knob(s,k,v);
  await H.weather(s);const r=s.renderer;r.timer=TerrainRenderer.prototype.timer.bind(r);r.setBudgetMB(1024);
  const rect={x:name==='green-2'?800:name==='green-7'?480:320,y:name==='green-2'?680:name==='green-7'?512:640,width:128,height:128,tile:128},options=s.drawOptions({clay:false,light:'original'}),tag=name+(features?'-features':'-default');
  const t=performance.now(),before=await H.renderWindow(s,{...rect,options}),initialMs=performance.now()-t;await r.gpuResult;const initialGpuMs=r.lastGPU;assert.equal(r.voxel.stats.pieces,1);
  // This Green 7 crop contains deep water: ambient alone changes no pixels.
  if(name==='green-7')r.setColors({...r.colorOverrides,deep:[.9,.12,.07]});else await H.knob(s,'ambient',.51);
  const cached=await warm(r,options),started=performance.now(),full=await H.renderWindow(s,{...rect,options}),fullMs=performance.now()-started;await r.gpuResult;const fullDrawGpuMs=r.lastGPU;
  if(cached)assert.equal(sha(cached.data),sha(full),tag+' cached color vs full split rebuild');
  assert.notEqual(sha(before),sha(full),tag+' edit must change pixels');
  let coldGate=null;
  if(r.recolor&&name==='green-modern-2'&&!features){
    await H.knob(s,'faceWet',0);await H.renderWindow(s,{...rect,options});await H.knob(s,'faceWet',.7);
    const cold=await warm(r,options),rebuilt=await H.renderWindow(s,{...rect,options});assert.equal(sha(cold.data),sha(rebuilt),'closed wetness gate crossing');
    coldGate={control:'faceWet',from:0,to:.7,sha:sha(rebuilt),warmSHA:sha(cold.data),warmResult:cold.result};
  }
  await r.device.queue.onSubmittedWorkDone();await new Promise(resolve=>setTimeout(resolve,30));assert.deepEqual(s.errors,[]);
  writeFileSync(join(out,`lp5-${label}-${tag}.rgba`),full);writeFileSync(join(out,`lp5-${label}-${tag}.png`),encodePng(128,128,full));
  rows.push({scene:name,features,edit:name==='green-7'?'deep color':'ambient',rect,initialMs,initialGpuMs,fullMs,fullDrawGpuMs,sha:sha(full),beforeSHA:sha(before),warmSHA:cached?sha(cached.data):null,warmResult:cached?.result??null,warmResources:cached?.retained??null,recordBytes:r.geometryRecord?.size??0,rendererRetained:r.stats().residentBytes,resources:resources(r),coldGate,errors:s.errors});
  console.log(tag,rows.at(-1).sha,cached?.result??'unsplit baseline');s.dispose();await new Promise(resolve=>setTimeout(resolve,30));
}
if(!edgesOnly)writeFileSync(join(out,`lp5-${label}.json`),JSON.stringify(rows));
if(edgesOnly||rows[0].warmResult){
  const scene={biome:'green',ground:true,strokes:[['plateau',[[260,420],[760,360]],{seed:11,card:{diameter:480,elevation:200,rockPreset:2}}],['mountain',[[960,760]],{seed:12,card:{diameter:300,elevation:140,rockPreset:0}}]]};
  const s=await H.openScene(scene,'biome=green&mapX=4&mapY=4&scratch=1&gpuMB=512&sunHeight=25&flatShadow=1');await H.weather(s);const r=s.renderer;r.setBudgetMB(1024);assert(r.rocks.size>0);
  const rect={x:500,y:400,width:131,height:129},options=s.drawOptions(),full=await H.renderWindow(s,{...rect,tile:256,options}),tiled=await H.renderWindow(s,{...rect,tile:64,options});assert.equal(sha(full),sha(tiled),'odd-sized mixed-recipe tiles');
  await H.renderWindow(s,{x:500,y:400,width:128,height:128,tile:128,options});r.voxel.clear();await H.knob(s,'ambient',.51);await r.recolor(options);await H.knob(s,'rockFace',3.9);await assert.rejects(()=>r.recolor(options),/requires [ABCDE]/);
  await r.device.queue.onSubmittedWorkDone();await new Promise(resolve=>setTimeout(resolve,30));assert.deepEqual(s.errors,[]);
  writeFileSync(join(out,`lp5-${label}-edges.json`),JSON.stringify({rect,mixedSlots:[...r.rocks.keys()],tiles:[64,256],sha:sha(full),different:0,geometryEditRejected:true,errors:s.errors}));s.dispose();
}
process.exit(0);
