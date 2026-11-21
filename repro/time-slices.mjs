// On-demand LP4 step 1 correctness proof, never a timing run.
// node repro/time-slices.mjs --base <unsliced commit> --out <outside repo>
// Reads the reference method from git into --out; the editor has one path.
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {mkdirSync,readFileSync,writeFileSync,unlinkSync} from 'node:fs';
import {resolve,join} from 'node:path';
import {pathToFileURL} from 'node:url';
import {createHash} from 'node:crypto';
import {openScene,REPO} from './headless.mjs';
import {GpuErosion} from '../sculpt-erosion.js';
import {readBuffer,createShapeEngine} from '../sculpt-gpu-fields.js';
const args=process.argv.slice(2),opt=(k)=>{const i=args.indexOf(k);return i<0?'':args.splice(i,2)[1];};
const base=opt('--base'),out=resolve(opt('--out')||'');
assert(base&&args.length===0&&out!==process.cwd()&&out!==REPO&&!out.startsWith(REPO+'/'),'Give --base and an outside-repository --out');
mkdirSync(out,{recursive:true});
execFileSync('git',['diff','--exit-code',base,'--','engine-*.wgsl'],{cwd:REPO});
const reference=execFileSync('git',['show',base+':sculpt-erosion.js'],{cwd:REPO,encoding:'utf8'});
assert(reference.includes('const gpu = performance.now() - tSubmit;'),'Reference must be the unsliced runner');
const refFile=join(out,'reference-erosion.mjs');
writeFileSync(refFile,reference.replace("'./sculpt-gpu-fields.js'",JSON.stringify(pathToFileURL(join(REPO,'sculpt-gpu-fields.js')).href)));
const {GpuErosion:Reference}=await import(pathToFileURL(refFile));unlinkSync(refFile);
const hash=buffer=>createHash('sha256').update(new Uint8Array(buffer)).digest('hex');
const results=[];
for(const name of ['green-modern-2','red-3','desert-2','lava-2','ice-2','crystal-2','moon-2','archipelago-2']){
 const scene=JSON.parse(readFileSync(join(REPO,'repro/scenes',name+'.json')));
 const s=await openScene(scene,`biome=${scene.biome}&mapX=4&mapY=4&gpuMB=512&heapMB=1536${scene.query?'&'+scene.query:''}`);
 try{
  await s.fields.gpuReady();await s.fields.gpuQuiet();
  const shape=await createShapeEngine({device:s.renderer.device,grid:s.worldGrid,spacing:s.spacing,baseHeight:s.config.baseHeight,sea:s.config.seaLevel,minH:s.minH,maxH:s.maxH,pages:true}),G=257,ox=0,oy=128,T=shape.makeTarget(ox,oy,G,G);
  try{
   shape.submit(s.nodes,s.context(),null,{readback:false,target:T});await s.renderer.device.queue.onSubmittedWorkDone();
   const raw=new Float32Array(await readBuffer(s.renderer.device,T.F,0,G*G*4));if(name==='green-modern-2')assert(raw.some(h=>h!==raw[0]),'Isolation window must contain active terrain');
   const source=s.renderer.preprocessShader(await(await fetch('engine-erosion.wgsl')).text()),old=new Reference(s.renderer,source),current=new GpuErosion(s.renderer,source);
   await old.ready;await current.ready;
   const device=s.renderer.device,queue=device.queue,create=device.createCommandEncoder.bind(device),createBuffer=device.createBuffer.bind(device),done=queue.onSubmittedWorkDone.bind(queue);
   let phase=null,commands=[],created=[],fences=0,obsolete=false,interleave=false;
   const marker=createBuffer({label:'priority marker',size:16,usage:GPUBufferUsage.COPY_SRC|GPUBufferUsage.COPY_DST});
   device.createCommandEncoder=function(desc){const e=create(desc),begin=e.beginComputePass.bind(e);e.beginComputePass=function(desc){const p=begin(desc),set=p.setPipeline.bind(p);let pipeline='';p.setPipeline=function(v){pipeline=v.label;return set(v);};for(const method of ['dispatchWorkgroups','dispatchWorkgroupsIndirect']){const run=p[method].bind(p);p[method]=function(...args){if(phase)commands.push([pipeline,method,args.filter(v=>typeof v==='number')]);return run(...args);};}return p;};return e;};
   device.createBuffer=function(desc){const b=createBuffer(desc);if(phase==='cancel'){const item={label:desc.label,destroyed:0},destroy=b.destroy.bind(b);created.push(item);b.destroy=()=>{item.destroyed++;destroy();};}return b;};
   queue.onSubmittedWorkDone=function(){return done().then(()=>{if(phase==='cancel'&&++fences===2)obsolete=true;if(phase==='interleave'&&!interleave){interleave=true;s.renderer.set('uColumnContrast',0);s.renderer.set('uColumnOrigin',500);s.renderer.flushUniforms();const e=create({label:'priority probe'});e.clearBuffer(marker,0,16);queue.submit([e.finish()]);} });};
   const digest=async r=>{const values=[];for(const [b,bytes] of [[r.weather,r.grid*r.grid*8],...r.maps.map(b=>[b,r.grid*r.grid*4])])values.push(hash(await readBuffer(device,b,0,bytes)));r.weather.destroy();r.maps.forEach(b=>b.destroy());return values;};
   const make=(age,rain)=>({...s.engine.timeKnobs(s.renderer),planes:T.F,masks:T.Mk,rateMask:s.engine.MASK_KEYS.indexOf('ovErosion'),grid:G,size:s.worldSize,spacing:s.spacing,seaLevel:s.config.seaLevel,ox,oy,age,rain});
   for(const age of [1,200])for(const rain of [0,1]){
    phase='reference';commands=[];const expected=await digest(await old.runGpu(make(age,rain))),order=commands;
    phase='sliced';commands=[];const r=await current.runGpu(make(age,rain)),iterations=r.parts.iterations.slice(),actual=await digest(r);
    assert.deepEqual(commands,order,`${name}: pass order`);assert.deepEqual(actual,expected,`${name}: Time bytes`);assert.equal(iterations.reduce((n,x)=>n+x,0),age);assert(iterations.every(x=>x<=8));
    results.push({scene:name,region:'window',grid:G,ox,oy,age,rain,identical:true,sha256:actual,dispatches:order.length,iterationBatches:iterations.filter(Boolean)});
   }
   // Also compare the whole-map field the nonpaged editor/exporter reads.
   const full=s.fields.gpuBuffers();assert(full&&full.grid===s.worldGrid);
   const whole={...make(200,1),planes:full.planes,masks:full.masks,grid:full.grid,ox:0,oy:0};
   phase='reference';commands=[];const expectedWhole=await digest(await old.runGpu(whole)),wholeOrder=commands;
   phase='sliced';commands=[];const wholeResult=await current.runGpu(whole),actualWhole=await digest(wholeResult);
   assert.deepEqual(commands,wholeOrder,`${name}: whole-map dispatch order`);assert.deepEqual(actualWhole,expectedWhole,`${name}: whole-map Time bytes`);
   assert.equal(wholeResult.parts.iterations.reduce((n,x)=>n+x,0),200);assert(wholeResult.parts.iterations.every(x=>x<=8));
   results.push({scene:name,region:'whole',grid:full.grid,ox:0,oy:0,age:200,rain:1,identical:true,sha256:actualWhole,dispatches:wholeOrder.length,iterationBatches:wholeResult.parts.iterations.filter(Boolean)});
   if(name==='green-modern-2'){
    phase=null;const request=make(200,1),expected=await digest(await old.runGpu(request)),saved=s.renderer.uniformData.slice(0);
    queue.writeBuffer(marker,0,new Uint32Array([1,2,3,4]));phase='interleave';interleave=false;const actual=await digest(await current.runGpu(request));phase=null;
    new Uint8Array(s.renderer.uniformData).set(new Uint8Array(saved));s.renderer.uniformsDirty=true;s.renderer.flushUniforms();
    assert(interleave);assert.deepEqual(new Uint32Array(await readBuffer(device,marker,0,16)),new Uint32Array(4));assert.deepEqual(actual,expected,'A higher-priority uniform write changed Time bytes');
    const contrast=s.renderer.variant.get('columnContrast');s.renderer.variant.set('columnContrast','0');s.renderer.set('uColumnContrast',0);s.renderer.flushUniforms();const withoutBeds=await digest(await old.runGpu(request));if(contrast===undefined||contrast===null)s.renderer.variant.delete('columnContrast');else s.renderer.variant.set('columnContrast',contrast);
    assert.notDeepEqual(withoutBeds,expected,'Uniform isolation fixture must visibly exercise hardness');
    new Uint8Array(s.renderer.uniformData).set(new Uint8Array(saved));s.renderer.uniformsDirty=true;s.renderer.flushUniforms();
    phase='cancel';created=[];fences=0;obsolete=false;commands=[];
    await assert.rejects(current.runGpu({...request,stale:()=>obsolete}),{name:'AbortError'});phase=null;
    assert(created.length>0&&created.every(b=>b.destroyed===1),'Canceled Time buffers leaked');
    assert(!commands.some(([entry])=>entry==='settleMain'||entry==='mapsMain'),'Canceled result was completed');
    results.push({scene:name,uniformIsolation:true,cancellation:true,destroyedBuffers:created.length,fencesBeforeCancel:fences});
   }
   phase=null;marker.destroy();device.createCommandEncoder=create;device.createBuffer=createBuffer;queue.onSubmittedWorkDone=done;
  }finally{T.destroy();shape.destroy();}
  assert.deepEqual(s.errors,[]);
 }finally{s.dispose();}
 console.log(name,'exact Time bytes and pass order');writeFileSync(join(out,'time-slices.json'),JSON.stringify({base,timingAccepted:false,results},null,2));
}
