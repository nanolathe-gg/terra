import test from 'node:test';
import assert from 'node:assert/strict';
import {dirtyTileRects} from '../sculpt-change-map.js';
test('unchanged fields produce no invalidation',()=>{assert.deepEqual(dirtyTileRects(new Uint32Array(9),150,64,2),[]);});
test('refinement dirtiness is sparse and clips the last grid tile',()=>{
 const flags=new Uint32Array(9);flags[1]=1;flags[8]=1;
 assert.deepEqual(dirtyTileRects(flags,150,64,2),[{x:128,y:0,width:128,height:128},{x:256,y:256,width:44,height:44}]);
});
