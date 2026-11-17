import test from 'node:test';
import assert from 'node:assert/strict';
import {SURFACE_RECORD_BYTES} from '../sculpt-renderer.js';
import {ChunkTerrainRenderer} from '../sculpt-chunk-renderer.js';
const fixture=()=>Object.assign(Object.create(ChunkTerrainRenderer.prototype),{
 budgetBytes:2048*1024**2,reservedBytes:0,fixedBytes:0,colorTiles:new Set(),
 number:(key,fallback)=>fallback,rockMax:(key,value)=>value,maskPacking:()=>({bytes:0,settingsBytes:0})
});
const region={fieldsX:0,fieldsY:0,fieldsWidth:257,fieldsHeight:257,gridWidth:129,gridHeight:129};
test('preview estimates include the selected raster, copied image and padded geometry record',()=>{
 const r=fixture(),width=513,height=321;
 for(const pixelScale of [2,3,4,8]){
  const e=r.estimate(region,width,height,4,4,{pixelScale,fastRaster:true});
  const w=Math.ceil(width/pixelScale),h=Math.ceil(height/pixelScale);
  assert.equal(e.output,w*h*12);assert.equal(e.geometryRecord,(w+2)*(h+2)*SURFACE_RECORD_BYTES);
 }
 const normal=r.estimate(region,width,height,4,4);
 assert.equal(normal.output,Math.ceil(width/2)*Math.ceil(height/2)*8+Math.ceil(width/4)*Math.ceil(height/4)*4);
 assert.equal(r.estimate(region,width,height,4,.5).output,Math.ceil(width/.5)*Math.ceil(height/.5)*12);
});


test('numeric lookups retain missing, zero, empty and invalid-value semantics',()=>{
 const r=Object.assign(Object.create(ChunkTerrainRenderer.prototype),{variant:new URLSearchParams('zero=0&empty=&negative=-2&bad=no'),rocks:new Map([[1,{knobs:{size:4}}],[2,{knobs:{size:9}}],[3,{knobs:{size:'bad'}}]])});
 assert.equal(r.number('missing',7),7);assert.equal(r.number('zero',7),0);assert.equal(r.number('empty',7),0);assert.equal(r.number('negative',7),-2);assert(Number.isNaN(r.number('bad',7)));
 assert.equal(r.variantNumber('missing',7),7);assert.equal(r.variantNumber('zero',7),0);assert.equal(r.variantNumber('empty',7),0);assert.equal(r.variantNumber('negative',7),-2);assert.equal(r.variantNumber('bad',7),7);
 assert.equal(r.rockMax('size',6),9);assert.equal(r.rockMax('size',12),12);assert.equal(r.rockMax('absent',6),6);
});
