import test from 'node:test';
import assert from 'node:assert/strict';
import {MOVEMENT_FAMILIES,terrainLattice,profileMask,familyCoverage,cellBlockReason,movementObstacles} from '../sculpt-passability.js';
const terrain=(width=12,height=12,base=99,extra={})=>terrainLattice({width,height,sea:75,heights:new Uint8Array(width*height).fill(base),edges:false,...extra});
const p={size:2,slope:15,depth:12,waterSlope:255,minDepth:-10000};

test('depth and slope limits include equality and use all four exported corners',()=>{
  const a=new Uint8Array(144).fill(99);a[6*12+6]=114;
  let t=terrain(12,12,99,{heights:a});assert.equal(cellBlockReason(t,p,5,5),'');
  a[6*12+6]=115;t=terrain(12,12,99,{heights:a});assert.match(cellBlockReason(t,p,5,5),/slope 16 > 15/);
  t=terrain(12,12,63);assert.equal(cellBlockReason(t,p,5,5),'');
  t=terrain(12,12,62);assert.match(cellBlockReason(t,p,5,5),/Water depth 13 > 12/);
});
test('one wet corner selects underwater slope limits; ships need their whole footprint submerged',()=>{
  const a=new Uint8Array(144).fill(99);a[6*12+6]=74;
  const t=terrain(12,12,99,{heights:a});assert.equal(cellBlockReason(t,p,5,5),'');
  assert.match(cellBlockReason(t,{...p,minDepth:3},5,5),/too shallow/);
});
test('footprints block narrow passages and do not aggregate a gentle ramp into a cliff',()=>{
  const a=Uint8Array.from({length:144},(_,i)=>99+(i%12)*10),t=terrain(12,12,99,{heights:a});
  assert.equal(profileMask(t,{...p,size:4})[6*12+6],1);
  const wall=terrain(12,12,99,{obstacles:[{x:0,z:0,width:5,height:12},{x:7,z:0,width:5,height:12}]});
  assert.equal(profileMask(wall,p)[6*12+6],1);assert.equal(profileMask(wall,{...p,size:3})[6*12+6],0);
});
test('coverage exposes class variation rather than averaging across a cliff',()=>{
  const a=new Uint8Array(144).fill(99);for(let z=0;z<12;z++)for(let x=6;x<12;x++)a[z*12+x]=116;
  const t=terrain(12,12,99,{heights:a});
  assert.equal(familyCoverage(t,MOVEMENT_FAMILIES[0])[6*12+6],0);
  assert.equal(familyCoverage(t,MOVEMENT_FAMILIES[1])[6*12+6],1);
});
test('hover admits deep water but keeps its land slope limit; air needs no surface mask',()=>{
  const t=terrain(12,12,0);assert.equal(familyCoverage(t,MOVEMENT_FAMILIES[2])[6*12+6],2);assert.equal(familyCoverage(t,MOVEMENT_FAMILIES[0])[6*12+6],0);
  assert.equal(MOVEMENT_FAMILIES.some(f=>f.id==='air'),false);
});
test('the exported boundary strips and molten cells reject surface movement',()=>{
  const t=terrain(12,12,99,{edges:true});assert.equal(t.blocked[0],2);assert.equal(t.blocked[4*12+4],0);assert.equal(t.blocked[6*12+10],2);
  assert.equal(terrain(12,12,74,{lava:true}).blocked[65],3);
});
test('only blocking generated features contribute their complete variant footprints',()=>{
  const config={features:{tree:{count:1,types:[{share:1,params:{cells:'2x2'}}]},rock:{count:1,types:[{share:1,params:{cells:'3x2'}}]}}};
  const features=['tree','rock','shrub','deposit','vent','scar'].map((kind,i)=>({kind,v:0,x:i*3,z:4}));
  assert.deepEqual(movementObstacles(config,{features}),[{x:0,z:4,width:2,height:2},{x:3,z:4,width:3,height:2}]);
});
