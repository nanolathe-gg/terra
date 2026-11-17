// Canonical fields wait for a reader during a gesture; retained page Time can
// advance while the gesture is held still. Both must equal fresh replay.
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {openScene} from './headless.mjs';
const scene=JSON.parse(readFileSync(new URL('./shape-scenes/green-landform.json',import.meta.url)));
const hash=r=>{const h=createHash('sha256');for(const a of Object.values(r.fields))if(ArrayBuffer.isView(a))h.update(new Uint8Array(a.buffer,a.byteOffset,a.byteLength));return h.digest('hex');};
test('whole-map fields merge held edits until a GPU or CPU reader, and release drains pending work',{timeout:120000},async()=>{
 const s=await openScene(scene,'biome=green&mapX=2&mapY=2&gpuMB=2048');let held=false,nodes=s.nodes.slice();const made=[];
 const common={worldSize:s.worldSize,worldGrid:s.worldGrid,baseHeight:s.config.baseHeight,maskKeys:s.engine.MASK_KEYS,nodes:()=>nodes,device:()=>s.renderer.device,context:s.context,gesture:()=>held};
 try{
  const f=s.fieldsModule.createGpuFields(common);made.push(f);f.changed();await f.ready();
  const e=f.engine(),original=e.submit;let evaluations=0,announced=0;e.submit=(...a)=>{if(!a[3]?.readOnly)evaluations++;return original(...a);};f.subscribeSubmit(()=>announced++);
  held=true;
  for(let i=0;i<20;i++){
   const added=s.engine.sceneNodes(s.config,[['landform',[[120,160],[220,160]],{card:{diameter:100,elevation:70+i}}]],{ground:false,seed:s.seed,settings:s.settings});nodes=[...s.nodes,...added];
   f.changed({x0:0,y0:0,x1:s.worldGrid-1,y1:s.worldGrid-1});
  }
  await s.renderer.device.queue.onSubmittedWorkDone();assert.equal(evaluations,0);assert.equal(announced,20);
  await f.gpuReady();assert.equal(evaluations,1);await f.ready();
  const fresh=s.fieldsModule.createGpuFields({...common,gesture:()=>false});made.push(fresh);fresh.changed();await fresh.ready();
  const rect={x0:0,y0:0,x1:Math.min(320,s.worldGrid-1),y1:Math.min(320,s.worldGrid-1)};
  assert.equal(hash(f.readCells(rect)),hash(fresh.readCells(rect)));
  f.changed(rect);f.changed(rect);await f.ready();assert.equal(evaluations,2,'CPU readers also force merged edits');
  f.changed(rect);f.changed(rect);held=false;f.settle();await f.ready();assert.equal(evaluations,3,'release drains the waiting request');
  assert.deepEqual(s.errors,[]);
 }finally{for(const f of made)f.engine()?.destroy();s.dispose();}
});
test('held paged feeds reuse old Time until still, then refine it before release',{timeout:120000},async()=>{
 const s=await openScene(scene,'biome=green&mapX=4&mapY=4&gpuMB=2048');let held=false,still=false,nodes=s.nodes.slice();const made=[];
 const common={worldSize:s.worldSize,worldGrid:s.worldGrid,baseHeight:s.config.baseHeight,maskKeys:s.engine.MASK_KEYS,nodes:()=>nodes,device:()=>s.renderer.device,context:s.context,gesture:()=>held,gestureSettled:()=>still};
 try{
  const time=s.engine.pagedTime({config:s.config,renderer:s.renderer,size:s.worldSize,spacing:s.spacing,material:s.material});
  const f=s.fieldsModule.createPagedFields(common);made.push(f);f.changed();f.setTime(time);
  const rect={x0:0,y0:0,x1:255,y1:255};await f.readRect(rect);const before=f.stats().gpuShape.weatherRuns;
  held=true;const added=s.engine.sceneNodes(s.config,[['landform',[[120,160],[220,160]],{card:{diameter:100,elevation:110}}]],{ground:false,seed:s.seed,settings:s.settings});nodes=[...s.nodes,...added];f.changed(rect);
  await f.readRect(rect);assert.equal(f.stats().gpuShape.weatherRuns,before,'moving input keeps retained Time');
  still=true;const warm=await f.readRect(rect);assert.equal(f.stats().gpuShape.weatherRuns,before+1,'still-held input refines Time');
  held=false;f.settle();await f.readRect(rect);assert.equal(f.stats().gpuShape.weatherRuns,before+1,'release reuses the warmed result');
  const fresh=s.fieldsModule.createPagedFields({...common,gesture:()=>false});made.push(fresh);fresh.changed();fresh.setTime(time);
  assert.equal(hash(warm),hash(await fresh.readRect(rect)));assert.deepEqual(s.errors,[]);
 }finally{for(const f of made){await f.coarseSettled();for(let i=0;i<500&&f.stats().gpuShape.cpuCopiesPending;i++)await new Promise(r=>setTimeout(r,10));f.destroy();}s.dispose();}
});


