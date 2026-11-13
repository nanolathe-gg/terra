import test from 'node:test';
import assert from 'node:assert/strict';
import {TerrainRenderer} from '../sculpt-renderer.js';

test('an abandoned draw restores the bake state before retrying',async()=>{
 const r=Object.create(TerrainRenderer.prototype),failure=new Error('pipeline changed during bake');
 let submitted=0,baked=0;
 Object.assign(r,{config:{},variant:new Map(),layers:new Set(),fieldsDirty:true,
  syncWorld(){},i(){},f(){},v(){},device:{createCommandEncoder:()=>({finish(){return {};}}),queue:{submit(){submitted++;}}},
  bakeFields(){baked++;this.fieldsDirty=false;},specCheck(){throw failure;}});
 Object.defineProperty(r,'drawPipeline',{value:{}});
 await assert.rejects(r.draw(),e=>e===failure);
 assert.equal(baked,1);assert.equal(submitted,0);
 assert.equal(r.fieldsDirty,true);
});

test('bake pipeline compilation retries a specialization miss after an async boundary',async()=>{
 const r=Object.create(TerrainRenderer.prototype);let attempts=0,compiled=0;
 Object.assign(r,{specCache:new Map(),specKey:()=>({key:'new',values:{}}),
  async specialize(state){compiled++;this.specCache.set(state.key,{bake:'ready'});}});
 const result=await r.withPipelines(async()=>{attempts++;await Promise.resolve();return r.bakePipeline;});
 assert.equal(result,'ready');assert.equal(attempts,2);assert.equal(compiled,1);
});
