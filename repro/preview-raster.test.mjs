import test from 'node:test';
import assert from 'node:assert/strict';
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
  assert.equal(e.output,w*h*12);assert.equal(e.geometryRecord,(w+2)*(h+2)*56);
 }
 const normal=r.estimate(region,width,height,4,4);
 assert.equal(normal.output,Math.ceil(width/2)*Math.ceil(height/2)*8+Math.ceil(width/4)*Math.ceil(height/4)*4);
 assert.equal(r.estimate(region,width,height,4,.5).output,Math.ceil(width/.5)*Math.ceil(height/.5)*12);
});
