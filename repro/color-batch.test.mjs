import test from 'node:test';
import assert from 'node:assert/strict';
import {ChunkTerrainRenderer} from '../sculpt-chunk-renderer.js';
const fixture=()=>{
  const r=Object.create(ChunkTerrainRenderer.prototype);Object.assign(r,{resources:new Map(),outputBytes:0,reservedBytes:0,budgetBytes:64*1024,device:{limits:{maxTextureDimension2D:1024}},colorTargets:new Map(),colorTiles:new Set(),_busy:false});return r;
};
test('color batches shrink to fit memory and the device dimension limit',()=>{
  const r=fixture(),tile={width:32,height:32,outWidth:32,outHeight:32},tiles=[tile,tile,tile,tile];
  assert.equal(r.colorBatchSize(tiles),4);
  r.budgetBytes=20*1024;assert.equal(r.colorBatchSize(tiles),2);
  r.reservedBytes=8*1024;assert.equal(r.colorBatchSize(tiles),1);
  r.reservedBytes=12*1024;assert.equal(r.colorBatchSize(tiles),0);
  r.reservedBytes=0;r.budgetBytes=64*1024;r.device.limits.maxTextureDimension2D=64;assert.equal(r.colorBatchSize(tiles),2);
});
test('retiring a queued batch pins every input until its reader exits',async()=>{
  const r=fixture(),tiles=Array.from({length:4},()=>{const record={destroyed:0,destroy(){this.destroyed++;}};r.resources.set(record,{bytes:1,kind:'color-cache'});return {record,owned:[record],users:0,retired:false,width:32,height:32,outWidth:32,outHeight:32};});
  r.colorTiles=new Set(tiles);let resume;r.previousChunk=new Promise(resolve=>{resume=resolve;});
  const pending=r.renderColorTiles(tiles);assert(r.busy);
  for(const tile of tiles){assert.equal(tile.users,1);r.releaseColorTile(tile);assert.equal(tile.record.destroyed,0);}
  resume();await assert.rejects(pending,/evicted/);
  for(const tile of tiles){assert.equal(tile.users,0);assert.equal(tile.record.destroyed,1);}assert.equal(r.colorTiles.size,0);assert.equal(r.resources.size,0);assert(!r.busy);
});
