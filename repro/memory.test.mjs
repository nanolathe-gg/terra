import {createPagedFields} from '../sculpt-gpu-fields.js';
import test from 'node:test';import assert from 'node:assert/strict';
import {createTerrainBudget,terrainAllocation,TerrainMemoryError,deviceMemory} from '../sculpt-memory.js';
test('automatic budget uses optional signals while an explicit choice wins',()=>{
 assert.equal(createTerrainBudget().mb,2048);assert.equal(createTerrainBudget({deviceMemory:4}).mb,1024);
 assert.equal(createTerrainBudget({deviceMemory:4,explicit:3072,preference:{mb:512}}).mb,3072);
});
test('an interrupted trial starts lower and a completed view clears its note',()=>{
 const saved=[],b=createTerrainBudget({preference:{mb:2048,trying:2048},save:p=>saved.push({...p})});assert.equal(b.mb,1536);
 b.begin();assert.equal(saved.at(-1).trying,1536);b.settled();assert.equal(saved.at(-1).trying,null);assert.equal(saved.at(-1).mb,1536);
 assert.equal(createTerrainBudget({explicit:1024,preference:{mb:2048,trying:2048}}).mb,1024);
 // A reload or closed tab before the view settles is not a crash: the next load keeps its budget.
 const left=[],c=createTerrainBudget({save:p=>left.push({...p})});c.begin();assert.equal(left.at(-1).trying,2048);c.leave();assert.equal(left.at(-1).trying,null);assert.equal(createTerrainBudget({preference:left.at(-1)}).mb,2048);
});
test('allocation failures step through the notches and stop at the floor',()=>{
 const saved=[],b=createTerrainBudget({explicit:2048,save:p=>saved.push(p)});for(const n of [1536,1024,768,512]){assert(b.lower('allocation failure'));assert.equal(b.mb,n);}assert.equal(b.lower('allocation failure'),false);assert.equal(createTerrainBudget({explicit:2048,preference:saved.at(-1)}).mb,512);b.choose(768);assert.equal(b.mb,768);
});
test('a budget above 4 GiB is an explicit choice, and a failure there steps down through the larger notches',()=>{
 assert.equal(createTerrainBudget({preference:{mb:8192}}).mb,2048,'the automatic budget does not grow');
 const b=createTerrainBudget({explicit:16384});assert.equal(b.mb,16384);
 for(const n of [8192,6144,4096,3072,2048]){assert(b.lower('allocation failure'));assert.equal(b.mb,n);}
 b.choose(6144);assert.equal(b.mb,6144);assert.throws(()=>b.choose(16385));
});
test('an allocation scope closes before yielding and retains the failure',async()=>{
 const calls=[],device={pushErrorScope:k=>calls.push(k),popErrorScope:()=>{calls.push('pop');return Promise.resolve({message:'forced OOM'});}};
 const pending=terrainAllocation(device,()=>{calls.push('create');return 1;});assert.deepEqual(calls,['out-of-memory','create','pop']);await assert.rejects(pending,TerrainMemoryError);
 device.popErrorScope=()=>Promise.resolve(null);await assert.rejects(terrainAllocation(device,()=>{throw Error('ordinary error');}),/ordinary error/);
});

test('a device restart records the failed notch and reloads only one step lower',()=>{
 let preference;const first=createTerrainBudget({explicit:2048,save:value=>preference=value});first.begin();first.settled();
 assert(first.restart('a lost GPU device'));first.leave();assert.equal(preference.trying,2048);assert.equal(preference.mb,1536);
 const next=createTerrainBudget({explicit:2048,preference});assert.equal(next.mb,1536);assert.match(next.reason,/lost GPU device/);
 const floor=createTerrainBudget({explicit:512});assert.equal(floor.restart('a lost GPU device'),false);assert.equal(floor.mb,512);
});

test('a lost device lowers the budget only when memory caused it',()=>{
 let clock=0;const now=()=>clock,load=preference=>{let saved=preference;const b=createTerrainBudget({preference,now,save:v=>saved=v});return {b,saved:()=>saved};};
 // After the view settled, a loss (sleep and wake, a driver reset) reloads at the same budget, the floor included, with no trial note.
 for(const mb of [2048,512]){const {b,saved}=load({mb});b.begin();b.settled();assert.equal(b.lost('a lost GPU device'),true);b.leave();assert.equal(saved().trying,null);assert.equal(createTerrainBudget({preference:saved()}).mb,mb);}
 // The browser says memory: one notch lower.
 {const {b,saved}=load({mb:2048});b.begin();b.settled();assert(b.lost('a lost GPU device',{memory:true}));assert.equal(createTerrainBudget({preference:saved()}).mb,1536);}
 // During a trial (before the view settled) it counts as the budget failing, and stops at the floor.
 {const {b,saved}=load({mb:2048});b.begin();assert(b.lost('a lost GPU device'));assert.equal(createTerrainBudget({preference:saved()}).mb,1536);}
 {const {b}=load({mb:512});b.begin();assert.equal(b.lost('a lost GPU device'),false);}
 // Right after an allocation failure lowered the budget in place, it reloads at that budget, not a second notch lower.
 {const {b,saved}=load({mb:2048});b.begin();b.settled();clock=1000;assert(b.lower('a GPU allocation failure'));clock=2000;assert(b.lost('a lost GPU device'));b.leave();
  assert.equal(saved().trying,null);assert.equal(createTerrainBudget({preference:saved()}).mb,1536);}
 // After one at the floor, it gives up rather than reload into the same failure; long after, it is any other loss.
 {const {b}=load({mb:512});b.begin();b.settled();clock=50000;assert.equal(b.lower('a GPU allocation failure'),false);clock=51000;assert.equal(b.lost('a lost GPU device'),false);clock=90000;assert.equal(b.lost('a lost GPU device'),true);}
});

test('the page caches grow with a budget above 2 GiB and keep their caps at 2 GiB',t=>{
 t.mock.timers.enable({apis:['setTimeout']});
 const MB=1048576,caps=gpuMB=>{const fields=createPagedFields({worldSize:16385,worldGrid:8193,baseHeight:24,maskKeys:[],nodes:()=>[],device:()=>null,context:()=>({}),forceRing:4,budget:()=>({total:gpuMB*MB,minimum:300*MB})});
  try{fields.refit();return fields.stats().budget;}finally{fields.destroy();}};
 const side=512+8,shape=side*side*56,weather=512*512*20;
 assert.equal(caps(2048),24*shape+24*weather);
 assert.equal(caps(8192),96*shape+96*weather);
 assert(caps(768)<caps(2048),"a budget whose room is smaller than the caps holds fewer pages");
});
test('reserving preview memory reduces page counts without shrinking the shape ring',t=>{
 t.mock.timers.enable({apis:['setTimeout']});
 const MB=1048576;let previewMinimum=200*MB;
 const fields=createPagedFields({worldSize:1025,worldGrid:513,baseHeight:24,maskKeys:[],nodes:()=>[],device:()=>null,context:()=>({}),forceRing:320,budget:()=>({total:2048*MB,minimum:200*MB,previewMinimum})});
 try{fields.refit();const before=fields.stats();assert.equal(before.gpuShape.ring,320);previewMinimum=1900*MB;fields.refit();const after=fields.stats();assert.equal(after.gpuShape.ring,before.gpuShape.ring);assert(after.budget<before.budget);}
 finally{fields.destroy();}
});
test('the spill stays within the share of the page heap budget the fields are given, and lets go under pressure',t=>{
 t.mock.timers.enable({apis:['setTimeout']});
 const MB=1048576;let heap=Infinity;
 const fields=createPagedFields({worldSize:1025,worldGrid:513,baseHeight:24,maskKeys:[],nodes:()=>[],device:()=>null,context:()=>({}),forceRing:4,heapBudget:()=>heap});
 try{
  assert.equal(fields.stats().gpuShape.spill.cap,256*MB,'1/32 of the 8 GB assumed where the browser reports no device memory and is not a touch Apple device');
  heap=100*MB;assert.equal(fields.stats().gpuShape.spill.cap,100*MB);
  assert.deepEqual(fields.evict(),[]);
  assert.equal(fields.buffers().length,1,'the coarse lattice, before any page is read');
 }finally{fields.destroy();}
});
test('without a memory signal, an iPhone or iPad is planned as 4 GB and anything else as 8',()=>{
 const mac='Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Safari/605.1.15';
 assert.deepEqual(deviceMemory({deviceMemory:4,userAgent:mac,maxTouchPoints:5}),{gb:4,guessed:false},'a reported figure wins');
 assert.deepEqual(deviceMemory({userAgent:mac,maxTouchPoints:5}),{gb:4,guessed:true},'iPadOS Safari: a Mac with a touch screen');
 assert.deepEqual(deviceMemory({userAgent:'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1',maxTouchPoints:5}),{gb:4,guessed:true});
 assert.deepEqual(deviceMemory({userAgent:mac,maxTouchPoints:0}),{gb:8,guessed:true},'Safari on a Mac');
 assert.deepEqual(deviceMemory({userAgent:'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:133.0) Gecko/20100101 Firefox/133.0',maxTouchPoints:0}),{gb:8,guessed:true});
 const ipad=createTerrainBudget({deviceMemory:4,memoryGuessed:true});assert.equal(ipad.mb,1024);assert.equal(ipad.reason,'touch device without a memory signal');
});

test('the artist\'s budget choice is remembered without the address; an address gpuMB is not', async () => {
  const {createTerrainBudget} = await import('../sculpt-memory.js');
  let saved = null; const save = v => { saved = v; };
  const a = createTerrainBudget({save}); a.choose(4096); a.settled();
  assert.equal(saved.chosen, 4096);
  const b = createTerrainBudget({preference: saved, save});
  assert.equal(b.mb, 4096, 'the next load uses the choice');
  const c = createTerrainBudget({explicit: 768, save}); c.begin(); c.settled();
  assert.equal(saved.chosen, undefined, 'an address budget is used, never remembered');
  assert.equal(c.mb, 768);
});
