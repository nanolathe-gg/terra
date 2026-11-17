import test from 'node:test';
import assert from 'node:assert/strict';
import {planPreviewBlocks,previewGrid,previewWindow,previewQuality,previewPixels} from '../sculpt-preview.js';
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

test('a growing dirty area reuses a covering Time window, but a pan or level change does not',()=>{
 const size=8480,grid=2121,sp=(size-1)/(grid-1),apron=256;
 const region=(x,y,w,h)=>({gridOrigin:[x*sp,y*sp],gridWidth:w,gridHeight:h});
 const full=previewWindow(region(800,700,535,493),grid,size,apron);
 assert.equal(previewWindow(region(820,720,500,460),grid,size,apron,full),full);
 assert.notEqual(previewWindow(region(1000,700,535,493),grid,size,apron,full),full);
 assert.notEqual(previewWindow(region(800,700,535,493),4240,size,apron,full),full);
 assert.notEqual(previewWindow(region(900,800,100,100),grid,size,apron,full),full);
});

test('the 8 px first Time view keeps map edges and its full world-space apron',()=>{
 const size=8480,canonical=4240,grid=previewGrid(size,canonical,8),sp=(size-1)/(grid-1),apron=128*(size-1)/(canonical-1);
 assert.equal(grid,1061);assert(sp<=8&&sp>7.99);assert.equal((grid-1)*sp,size-1);
 for(const [x,y]of [[200,200],[0,0],[grid-300,grid-280]]){
  const w=previewWindow({gridOrigin:[x*sp,y*sp],gridWidth:300,gridHeight:280},grid,size,apron);
  assert(w.x<=x&&w.y<=y&&w.x+w.side>=x+300&&w.y+w.side>=y+280);
  for(const [origin,start,count]of [[w.x,x,300],[w.y,y,280]]){
   assert(origin===0||(start-origin)*sp>=apron);
   assert(origin+w.side===grid||(origin+w.side-start-count)*sp>=apron);
  }
 }
});


test('automatic preview resolution uses edit size at the current zoom; manual choices override it',()=>{
 const small={width:512,height:704},large={width:1280,height:1152};
 assert.equal(previewPixels('auto',small),2);assert.equal(previewPixels('auto',large),4);
 assert.equal(previewPixels('auto',{width:256,height:352},.5),2);
 for(const choice of ['2','3','4','8'])for(const area of [small,large])assert.equal(previewPixels(choice,area),Number(choice));
 for(const invalid of [undefined,null,'bad','0','1','9'])assert.equal(previewQuality(invalid),'auto');
});
