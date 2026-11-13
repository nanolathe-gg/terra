import test from 'node:test';
import assert from 'node:assert/strict';
import {planPreviewBlocks} from '../sculpt-preview.js';
import {createCoverage} from './perf-coverage.mjs';
const map={width:8192,height:8192},view={x:2048,y:2048,width:1728,height:1024};
test('a whole-view preview is one block when it fits',()=>{
 const p=planPreviewBlocks(view,map,()=>true);assert.equal(p.length,1);assert.deepEqual(p[0],view);
});
test('a constrained view uses four aligned blocks with complete nonoverlapping coverage',()=>{
 const fits=r=>r.width<=960&&r.height<=600,p=planPreviewBlocks(view,map,fits),c=createCoverage();assert.equal(p.length,4);
 for(const r of p){assert(fits(r));assert.equal(r.x%64,0);assert.equal(r.y%64,0);c.paint(r,{});}
 assert(c.covered([view]));assert.equal(p.reduce((a,r)=>a+r.width*r.height,0),view.width*view.height);
});
test('planning clips to map edges and leaves sampling on the global grid',()=>{
 const v={x:63,y:65,width:500,height:400},bounds={width:500,height:350},p=planPreviewBlocks(v,bounds,r=>r.width<=256&&r.height<=192),c=createCoverage();
 for(const r of p){assert.equal(r.x%64,0);assert.equal(r.y%64,0);assert(r.x+r.width<=500&&r.y+r.height<=350);c.paint(r,{});}
 assert(c.covered([{x:63,y:65,width:437,height:285}]));
});
test('an impossible working set fails before trying allocations',()=>{
 let calls=0;assert.throws(()=>planPreviewBlocks(view,map,()=>{calls++;return false;}),/memory budget/);assert.equal(calls,1);
});
