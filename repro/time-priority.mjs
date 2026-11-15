// On demand: native Time may yield to a display-only source without changing bytes.
// node repro/time-priority.mjs --server http://127.0.0.1:<yours> --out <outside repo>
import assert from 'node:assert/strict';
import {readFileSync,writeFileSync,mkdirSync} from 'node:fs';
import {resolve} from 'node:path';
import {createHash} from 'node:crypto';
import * as H from './headless.mjs';
import {erosionOf} from '../sculpt-erosion.js';
import {readBuffer} from '../sculpt-gpu-fields.js';
const args=process.argv.slice(2),opt=name=>{const i=args.indexOf(name);return i<0?'':args.splice(i,2)[1];};
const server=opt('--server'),out=resolve(opt('--out'));
assert(server&&new URL(server).port!=='8801'&&!args.length&&out!==H.REPO&&!out.startsWith(H.REPO+'/'),'Use your own server and an outside-repository output folder.');
mkdirSync(out,{recursive:true});await H.openHost({server});
const scene=JSON.parse(readFileSync(new URL('./scenes/green-modern-2.json',import.meta.url))),s=await H.openScene(scene,'biome=green&mapX=4&mapY=4&scratch=1&gpuMB=512');
await s.fields.gpuReady();await s.fields.gpuQuiet();
const r=s.renderer,d=r.device,q=d.queue,erosion=await erosionOf(r),source=s.fields.gpuBuffers();await erosion.ready;await erosion.mapsPipeline();
const request={...s.engine.timeKnobs(r),planes:source.planes,masks:source.masks,rateMask:s.engine.MASK_KEYS.indexOf('ovErosion'),grid:source.grid,size:s.worldSize,spacing:s.spacing,seaLevel:s.config.seaLevel};
async function digest(result){
  const hashes=[];for(const [buffer,bytes]of [[result.weather,result.grid**2*8],...result.maps.map(buffer=>[buffer,result.grid**2*4])])hashes.push(createHash('sha256').update(new Uint8Array(await readBuffer(d,buffer,0,bytes))).digest('hex'));
  result.weather.destroy();result.maps.forEach(b=>b.destroy());return hashes;
}
const expected=await digest(await erosion.runGpu(request)),create=d.createCommandEncoder.bind(d),submit=q.submit.bind(q),make=d.createBuffer.bind(d),labels=new WeakMap();let recording=false,capture=false,submitted=[],allocated=[];
d.createCommandEncoder=desc=>{const e=create(desc),finish=e.finish.bind(e);e.finish=(...a)=>{const b=finish(...a);labels.set(b,desc?.label);return b;};return e;};
q.submit=list=>{if(recording)submitted.push(...list.map(b=>labels.get(b)));return submit(list);};
d.createBuffer=desc=>{const b=make(desc);if(capture){const row={label:desc.label,destroyed:0},destroy=b.destroy.bind(b);allocated.push(row);b.destroy=()=>{row.destroyed++;destroy();};}return b;};
const marker=make({size:16,usage:GPUBufferUsage.COPY_DST|GPUBufferUsage.COPY_SRC});q.writeBuffer(marker,0,new Uint32Array([1,2,3,4]));
let release,entered;const gate=new Promise(resolve=>{release=resolve;}),waiting=new Promise(resolve=>{entered=resolve;});let checks=0;
recording=true;const pending=erosion.runGpu({...request,beforeSlice:async()=>{if(++checks===1){entered();await gate;}}});await waiting;
assert.equal(submitted.length,0,'native Time submits nothing while a preview owns priority');const priority=create({label:'priority probe'});priority.clearBuffer(marker);submit([priority.finish()]);await q.onSubmittedWorkDone();assert.deepEqual(new Uint32Array(await readBuffer(d,marker,0,16)),new Uint32Array(4));release();
const actual=await digest(await pending);recording=false;assert.deepEqual(actual,expected,'yielding must preserve all native Time bytes');const completedSubmissions=submitted.filter(label=>label?.startsWith('erosion')).length;assert.equal(completedSubmissions,checks,'each native submission passes the priority boundary');
let obsolete=false;submitted=[];recording=capture=true;await assert.rejects(erosion.runGpu({...request,stale:()=>obsolete,beforeSlice:async()=>{obsolete=true;}}),{name:'AbortError'});recording=capture=false;
assert.equal(submitted.length,0,'an input made obsolete while yielding must not submit');assert(allocated.length&&allocated.every(b=>b.destroyed===1),'all canceled allocations retire once');
marker.destroy();d.createCommandEncoder=create;q.submit=submit;d.createBuffer=make;await q.onSubmittedWorkDone();await new Promise(resolve=>setTimeout(resolve,30));assert.deepEqual(s.errors,[]);
writeFileSync(out+'/time-priority.json',JSON.stringify({scene:'green-modern-2',grid:source.grid,age:request.age,rain:request.rain,sha:actual,different:0,priorityProbeRan:true,completedSubmissions,beforeSliceCalls:checks,canceledSubmissions:submitted.length,canceledAllocations:allocated,errors:s.errors}));s.dispose();process.exit(0);
