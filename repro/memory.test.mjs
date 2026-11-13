import test from 'node:test';import assert from 'node:assert/strict';
import {createTerrainBudget,terrainAllocation,TerrainMemoryError} from '../sculpt-memory.js';
test('automatic budget uses optional signals while an explicit choice wins',()=>{
 assert.equal(createTerrainBudget().mb,2048);assert.equal(createTerrainBudget({deviceMemory:4}).mb,1024);
 assert.equal(createTerrainBudget({deviceMemory:4,explicit:3072,preference:{mb:512}}).mb,3072);
});
test('an interrupted trial starts lower and a completed view clears its note',()=>{
 const saved=[],b=createTerrainBudget({preference:{mb:2048,trying:2048},save:p=>saved.push({...p})});assert.equal(b.mb,1536);
 b.begin();assert.equal(saved.at(-1).trying,1536);b.settled();assert.equal(saved.at(-1).trying,null);assert.equal(saved.at(-1).mb,1536);
 assert.equal(createTerrainBudget({explicit:1024,preference:{mb:2048,trying:2048}}).mb,1024);
});
test('allocation failures step through the notches and stop at the floor',()=>{
 const saved=[],b=createTerrainBudget({explicit:2048,save:p=>saved.push(p)});for(const n of [1536,1024,768,512]){assert(b.lower('allocation failure'));assert.equal(b.mb,n);}assert.equal(b.lower('allocation failure'),false);assert.equal(createTerrainBudget({explicit:2048,preference:saved.at(-1)}).mb,512);b.choose(768);assert.equal(b.mb,768);
});
test('an allocation scope closes before yielding and retains the failure',async()=>{
 const calls=[],device={pushErrorScope:k=>calls.push(k),popErrorScope:()=>{calls.push('pop');return Promise.resolve({message:'forced OOM'});}};
 const pending=terrainAllocation(device,()=>{calls.push('create');return 1;});assert.deepEqual(calls,['out-of-memory','create','pop']);await assert.rejects(pending,TerrainMemoryError);
 device.popErrorScope=()=>Promise.resolve(null);await assert.rejects(terrainAllocation(device,()=>{throw Error('ordinary error');}),/ordinary error/);
});
