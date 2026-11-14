// On demand: cancel native terrain after count or solid completion, then replay.
import assert from 'node:assert/strict';
import {readFileSync,writeFileSync,mkdirSync} from 'node:fs';
import {resolve} from 'node:path';
import {createHash} from 'node:crypto';
import * as H from './headless.mjs';
const args=process.argv.slice(2),opt=name=>{const i=args.indexOf(name);return i<0?'':args.splice(i,2)[1];};
const server=opt('--server'),out=resolve(opt('--out'));
assert(server&&new URL(server).port!=='8801'&&!args.length&&out!==H.REPO&&!out.startsWith(H.REPO+'/'),'Use your own server and an outside-repository output folder.');
mkdirSync(out,{recursive:true});await H.openHost({server});
const scene=JSON.parse(readFileSync(new URL('./scenes/green-modern-2.json',import.meta.url))),s=await H.openScene(scene,'biome=green&variant=modern&mapX=4&mapY=4&scratch=1&gpuMB=2048');
await H.weather(s);const r=s.renderer,d=r.device,q=d.queue; r.setBudget(1024*1024*1024,0);
const window={x:0,y:300,width:512,height:512,tile:512},digest=bytes=>createHash('sha256').update(bytes).digest('hex');
const expected=digest(await H.renderWindow(s,window));await r.previousChunk;
const create=d.createCommandEncoder.bind(d),submit=q.submit.bind(q),complete=q.onSubmittedWorkDone.bind(q),map=r.voxel.readback.mapAsync.bind(r.voxel.readback),labels=new WeakMap();const own=r.voxel.own.bind(r.voxel);let submitted=[],allocated=[],mode=null,stale=false,solidPending=false;
r.voxel.own=(resource,label,bytes)=>{if(mode){const row={label,destroyed:0},destroy=resource.destroy.bind(resource);allocated.push(row);resource.destroy=()=>{row.destroyed++;destroy();};}return own(resource,label,bytes);};
d.createCommandEncoder=desc=>{const e=create(desc),finish=e.finish.bind(e);e.finish=(...args)=>{const b=finish(...args);labels.set(b,desc?.label);return b;};return e;};
q.submit=list=>{const names=list.map(b=>labels.get(b));submitted.push(...names);if(names.includes('voxel solid and terrain draw'))solidPending=true;return submit(list);};
q.onSubmittedWorkDone=()=>{const cancel=mode==='solid'&&solidPending;solidPending=false;return complete().then(()=>{if(cancel)stale=true;});};
r.voxel.readback.mapAsync=(...a)=>map(...a).then(()=>{if(mode==='count')stale=true;});
const results=[];
for(const boundary of ['count','solid']){
 mode=boundary;stale=solidPending=false;submitted=[];allocated=[];
 await assert.rejects(H.renderWindow(s,{...window,options:{...s.drawOptions(),stale:()=>stale}}),{name:'AbortError'});
 const labels=submitted.slice();await r.previousChunk;
 assert.equal(r.busy,false);assert.equal(r.voxel.owned.length,0);assert.equal(r.voxel.readback.mapState,'unmapped');assert.equal(r.geometryValid,false);assert(allocated.length&&allocated.every(x=>x.destroyed===1),'every canceled owned allocation must retire exactly once');
 assert(!labels.includes('present voxel terrain'),'an obsolete tile must not reach presentation');
 if(boundary==='count')assert(!labels.includes('voxel solid and terrain draw'),'obsolete counted solid must not be built');
 else{assert(labels.includes('voxel solid and terrain draw'),'solid boundary must actually be reached');assert(!labels.includes('terrain geometry after voxel solid'),'obsolete solid must not be drawn');}
 mode=null;stale=false;const actual=digest(await H.renderWindow(s,window));assert.equal(actual,expected,'a canceled working set must not corrupt the next tile');results.push({boundary,submitted:labels,allocations:allocated,ownedAfterCancel:0,mappedAfterCancel:false,nextSHA:actual,different:0});
}
r.voxel.own=own;d.createCommandEncoder=create;q.submit=submit;q.onSubmittedWorkDone=complete;r.voxel.readback.mapAsync=map;await q.onSubmittedWorkDone();await new Promise(resolve=>setTimeout(resolve,30));assert.deepEqual(s.errors,[]);
writeFileSync(out+'/voxel-cancel.json',JSON.stringify({scene:'green-modern-2',map:'4x4 nonpaged',window,expected,results,errors:s.errors}));s.dispose();process.exit(0);
