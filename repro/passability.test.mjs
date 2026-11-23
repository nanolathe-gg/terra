import test from 'node:test';
import assert from 'node:assert/strict';
import {MOVEMENT_FAMILIES,terrainLattice,profileMask,familyCoverage,cellBlockReason,movementObstacles,createPassability,updatePassability,inspectMovement} from '../sculpt-passability.js';
import {mapGeometry,cellHeights,cellHeightTiles,cornerHeight,footprintApron} from '../sculpt-map.js';
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

// A 16 px lattice, read with the request's apron (the corners' footprints, sculpt-map.js footprintApron) as the fields read it, clipped at 0.
const sampleRead=map=>async({x,y,width,height,apron=0})=>{
  const x0=Math.max(0,Math.floor((x-apron)/16)),y0=Math.max(0,Math.floor((y-apron)/16)),w=Math.ceil((x+width+apron)/16)-x0+1,h=Math.ceil((y+height+apron)/16)-y0+1;
  return {gridWidth:w,gridHeight:h,gridOrigin:[x0*16,y0*16],gridSpacing:16,fields:{h:Float32Array.from({length:w*h},(_,i)=>{
    const xx=x0+i%w,zz=y0+Math.floor(i/w);
    return 74+xx*.23+zz*.15+(xx>=31&&xx<=34?25:0)+(zz>=30&&zz<=33?20:0)+(xx===map.widthCells-1?180:0);
  })}};
};
test('streamed tiles match complete masks across seams, features, water and exported map edges',async()=>{
  const obstacles=[{x:30,z:31,width:4,height:3},{x:64,z:60,width:2,height:5}];
  for(const map of [mapGeometry(3,2),{widthCells:70,heightCells:67}])for(const base of [null,0,99,255])for(const lava of [false,true]){
    const read=async req=>{const r=await sampleRead(map)(req);if(base!==null)r.fields.h.fill(base);return r;},sampled=await cellHeights(map,read);
    const full=terrainLattice({...sampled,width:map.widthCells,height:map.heightCells,sea:90,obstacles,lava}),expected=MOVEMENT_FAMILIES.map(f=>familyCoverage(full,f));
    for(const order of [1,-1]){
      const local=createPassability({width:full.width,height:full.height,sea:full.sea,obstacles,lava});
      for await(const tile of cellHeightTiles(map,read,{priority:t=>order*(t.x+t.z)})){
        updatePassability(local,tile);
        for(let z=0;z<local.height;z++)for(let x=0;x<local.width;x++){
          const i=z*local.width+x;if(!local.have[i])continue;
          for(const key of ['low','high','blocked'])assert.equal(local[key][i],full[key][i],`${key} at ${x},${z}`);
          local.coverage.forEach((a,k)=>assert.equal(a[i],expected[k][i],`${MOVEMENT_FAMILIES[k].id} at ${x},${z}`));
          if(x%32===0&&z%32===0)for(const f of MOVEMENT_FAMILIES)assert.deepEqual(inspectMovement(local,f,x,z),inspectMovement(full,f,x,z),'ready hover footprints use exact neighbor cells');
        }
      }
      assert.equal(local.cells,map.widthCells*map.heightCells);assert.deepEqual(local.heights,sampled.heights);
    }
  }
});
test('height tiles yield before the next read, honor cancellation and retain export rounding and clipping',async()=>{
  const map=mapGeometry(2,1),controller=new AbortController();let reads=0;
  // The read's first and last corners stand out far enough that their footprint means (a 16 px lattice: the corner's own sample weighs 9/16)
  // leave the byte range and their neighbors' stay inside it.
  const read=async req=>{reads++;const r=await sampleRead(map)(req),w=r.gridWidth,at=(px,py)=>(py-r.gridOrigin[1])/16*w+(px-r.gridOrigin[0])/16;r.fields.h.fill(99.5);r.fields.h[at(req.x,req.y)]=-150;r.fields.h[at(req.x+req.width,req.y+req.height)]=500;return r;};
  const stream=cellHeightTiles(map,read,{signal:controller.signal,priority:t=>-t.x}),first=await stream.next();
  assert.equal(reads,1);assert.equal(first.value.x,64);assert.equal(first.value.heights[0],0);assert.equal(first.value.heights.at(-1),255);
  controller.abort();await assert.rejects(stream.next(),{name:'AbortError'});assert.equal(reads,1);
  const exported=await cellHeights(map,read);assert.equal(exported.clipped,12);assert.equal(exported.heights[0],0);assert.equal(exported.heights.at(-1),255);
});

// A 2.0009 px lattice like a map's field: a ramp, plus a 5-8 px ripple of +-6 units (above the lattice's 4 px Nyquist), read from any origin that holds a corner's footprint.
const fineRead=(ripple=6)=>({x,y,width,height,apron=0})=>{
  const step=2.0009,x0=Math.max(0,Math.floor((x-apron)/step)),y0=Math.max(0,Math.floor((y-apron)/step)),w=Math.ceil((x+width+apron)/step)-x0+1,h=Math.ceil((y+height+apron)/step)-y0+1;
  return {gridWidth:w,gridHeight:h,gridOrigin:[x0*step,y0*step],gridSpacing:step,worldGrid:4000,fields:{h:Float32Array.from({length:w*h},(_,i)=>{
    const px=(x0+i%w)*step,py=(y0+Math.floor(i/w))*step;
    return 90+px*.05+py*.02+ripple*Math.sin(px*1.1+py*.3)*Math.cos(py*.8);
  })}};
};
test('a corner byte is its 16 px footprint mean: ramps and level ground keep their heights, sub-cell ripples go, and any read agrees',async()=>{
  const map=mapGeometry(1,1),smooth=(await cellHeights(map,fineRead())).heights,ramp=(await cellHeights(map,fineRead(0))).heights;
  let worst=0;for(let i=0;i<smooth.length;i++)worst=Math.max(worst,Math.abs(smooth[i]-ramp[i]));
  assert.ok(worst<=1,`a +-6 unit ripple under a cell moves a byte by ${worst}`);
  const point=(await cellHeights(map,fineRead(),{footprint:{kind:'point'}})).heights;let moved=0;for(let i=0;i<point.length;i++)if(Math.abs(point[i]-ramp[i])>1)moved++;
  assert.ok(moved>point.length/4,'point samples keep the ripple (the test has teeth)');
  for(let z=0;z<map.heightCells;z+=7)for(let x=0;x<map.widthCells;x+=5){
    const r=fineRead()({x:x*16-37,y:z*16-11,width:90,height:70,apron:footprintApron()});
    assert.equal(Math.round(Math.max(0,Math.min(255,cornerHeight(r,x*16,z*16)))),smooth[z*map.widthCells+x],`corner ${x},${z} from another read`);
  }
  assert.throws(()=>cornerHeight(fineRead()({x:320,y:320,width:16,height:16}),320,320),/footprint reaches past its read/);
});
