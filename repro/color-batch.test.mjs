import test from 'node:test';
import assert from 'node:assert/strict';
import {ChunkTerrainRenderer,colorScissor} from '../sculpt-chunk-renderer.js';
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

test('native color scissors round out to pixels and leave resampling aprons intact',()=>{
  const tile={width:256,height:256,outWidth:256,outHeight:256,rect:{x:0,y:256,width:256,height:256}};
  assert.deepEqual(colorScissor(tile,{x:64,y:300,width:1728,height:1024}),[64,44,192,212]);
  assert.deepEqual(colorScissor(tile,{x:64.25,y:300.5,width:20.25,height:31}),[64,44,21,32]);
  assert.deepEqual(colorScissor({...tile,width:512,height:512,outWidth:512,outHeight:512},{x:64.25,y:300.5,width:20.25,height:31,scale:2}),[128,89,41,62]);
  assert.deepEqual(colorScissor(tile,{x:64,y:300,width:20,height:31,scale:.5}),[0,0,256,256]);
  assert.deepEqual(colorScissor({...tile,outWidth:128,outHeight:128},{x:64,y:300,width:20,height:31}),[0,0,256,256]);
});


test('retained color lattice drops bake aprons but keeps direct reads and edge guards',()=>{
  const r=fixture();r.layout={size:256};
  r.colorRegion={gridSpacing:2,gridOrigin:[100,200],gridWidth:1001,gridHeight:1001,fieldsX:500,fieldsY:600,fieldsWidth:513,fieldsHeight:513,reach:{draw:204,direct:61,look:194}};
  const a=r.colorLattice();
  assert.deepEqual([a.x,a.y,a.width,a.height],[196,196,265,265]);
  assert.deepEqual(a.origin,[246,296]);
  assert.equal(a.bytes,265*265*28+272);
  // The surface facts' look (distance to water, 194 px with its filter) reaches past a 128 px field window: the copy keeps it.
  const narrow=r.colorRegion.reach;r.colorRegion.reach={...narrow,draw:128};const l=r.colorLattice();r.colorRegion.reach=narrow;
  assert((l.origin[0])*2<=500-(194-128)&&(l.origin[1])*2<=600-(194-128),'the look reach stays in the copy');
  assert((l.origin[0]+l.width-1)*2>=500+512+(194-128)&&(l.origin[1]+l.height-1)*2>=600+512+(194-128));
  // A long mineral-margin lookup must keep its part outside the field window.
  r.colorRegion.reach.direct=700;const b=r.colorLattice();
  assert.equal(b.x,0);assert.equal(b.y,0);
  assert(b.width>a.width&&b.height>a.height);
  // Map boundaries clamp the copy without inventing or dropping samples.
  r.colorRegion={...r.colorRegion,fieldsX:0,fieldsY:0,fieldsWidth:2049,fieldsHeight:2049,gridOrigin:[0,0],gridWidth:1025,gridHeight:1025};
  const edge=r.colorLattice();assert.deepEqual([edge.x,edge.y,edge.width,edge.height],[0,0,1025,1025]);
});
