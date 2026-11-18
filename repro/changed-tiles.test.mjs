import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {dirtyTileRects,invalidateRefinement,refinementValid} from '../sculpt-change-map.js';
test('unchanged fields produce no invalidation',()=>{assert.deepEqual(dirtyTileRects(new Uint32Array(9),150,64,2),[]);});
test('refinement dirtiness is sparse and clips the last grid tile',()=>{
 const flags=new Uint32Array(9);flags[1]=1;flags[8]=1;
 assert.deepEqual(dirtyTileRects(flags,150,64,2),[{x:128,y:0,width:128,height:128},{x:256,y:256,width:44,height:44}]);
});
test('moving geometry invalidates its accumulated refinement footprint, including its old base',()=>{
 let dirty=invalidateRefinement(null,{x0:10,y0:20,x1:30,y1:40},100);
 dirty=invalidateRefinement(dirty,{x0:20,y0:20,x1:50,y1:45},100);
 assert.deepEqual(dirty,{x0:10,y0:20,x1:50,y1:45});
 assert.equal(refinementValid(dirty,10,20),false);
 assert.equal(refinementValid(dirty,30,40),false);
 assert.equal(refinementValid(dirty,50,45),false);
 assert.equal(refinementValid(dirty,51,45),true);
 assert.equal(refinementValid(null,10,20),true);
});
test('global edits invalidate all refinement cells and clip oversized footprints',()=>{
 const all=invalidateRefinement({x0:10,y0:10,x1:20,y1:20},null,100);
 assert.deepEqual(all,{x0:0,y0:0,x1:99,y1:99});
 assert.deepEqual(invalidateRefinement(null,{x0:-10,y0:-20,x1:150,y1:120},100),all);
 assert.equal(refinementValid(all,99,99),false);
});

test('a no-op input preserves the pending edit stage while returning its own empty delta',()=>{
 const source=readFileSync(new URL('../sculpt-canvas.js',import.meta.url),'utf8');
 const code=source.slice(source.indexOf('  function changed('),source.indexOf('  function trimTo('));
 const host=new Function('previous',`let lastInput=previous,serial=7,rev={B:1,F:2};${code};const result=changed({stage:null,kind:'world'});return {lastInput,result};`);
 for(const stage of ['A','B','F']){
  const previous={stage,serial:7},result=host(previous);
  assert.equal(result.lastInput,previous,'keep the stage of unfinished work');
  assert.equal(result.result.stage,null,'bench still sees the no-op');assert.equal(result.result.serial,7);
 }
});
