import test from 'node:test';
import assert from 'node:assert/strict';
import {planPreviewBlocks,previewGrid,previewWindow} from '../sculpt-preview.js';
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

test('coarse shape windows cover renderer inputs and preserve world-space Time aprons',()=>{
 const size=8480,canonical=4240,grid=previewGrid(size,canonical,4),spacing=(size-1)/(grid-1),apron=128*(size-1)/(canonical-1);
 assert(spacing<=4&&spacing>3.99);assert.equal(previewGrid(size,canonical,2),canonical);
 for(const [x,y,width,height] of [[800,700,535,493],[0,0,535,493],[grid-535,grid-493,535,493]]){
   const r={gridOrigin:[x*spacing,y*spacing],gridWidth:width,gridHeight:height},w=previewWindow(r,grid,size,apron);
   assert(w.x<=x&&w.y<=y);assert(w.x+w.side>=x+width&&w.y+w.side>=y+height);
   assert(w.x>=0&&w.y>=0&&w.x+w.side<=grid&&w.y+w.side<=grid);
   for(const [lo,n,origin] of [[w.x,width,x],[w.y,height,y]]){
     assert(lo===0||(origin-lo)*spacing>=apron);
     assert(lo+w.side===grid||(lo+w.side-origin-n)*spacing>=apron);
   }
 }
 assert.equal((grid-1)*spacing,size-1);
});
