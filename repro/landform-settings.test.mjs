import test from 'node:test';
import assert from 'node:assert/strict';
import {landformElevation} from '../sculpt-shape-presets.js';
import {prepareNode} from '../sculpt-gpu-fields.js';

test('sea-relative height follows the map sea while fixed elevation stays fixed',()=>{
  for(const sea of [0,23,75,255]){
    const params=new Proxy({radius:80,amount:70,rough:0,softness:.5,lean:1,elevation:-55,heightReference:1,curve:{form:'lfHill'}},{get:(p,k)=>p[k]??0});
    const node={kind:'landform',seed:2701,points:[{x:100,y:100},{x:160,y:100}],params};
    const context={seed:2701,baseHeight:sea+24,sea,params:n=>n.params};
    assert.equal(landformElevation(params,sea),sea-55);
    assert.equal(prepareNode(node,{grid:256,spacing:1},context).u.elev,sea-55);
    params.heightReference=0;
    assert.equal(prepareNode(node,{grid:256,spacing:1},context).u.elev,-55);
  }
});

test('a landform shares step count and flat share while choosing exactly one pass',async()=>{
  const {landformSteps}=await import('../sculpt-shape-presets.js');
  const source={terraces:6,ledge:.8,terraceJitter:.7,shoreLayers:12,layerLedge:.4,layerRough:.1};
  for(const stepReference of [0,1,2]){
    const p=landformSteps({...source,stepReference});
    assert.equal(p.terraces,stepReference?0:6);
    assert.equal(p.shoreLayers,stepReference?6:0);
    assert.equal(p.layerStyle,stepReference===2?1:0);
    assert.equal(p.layerLedge,.8);assert.equal(p.layerRough,.7);
  }
  assert.equal(source.shoreLayers,12,'resolution must not rewrite the authored recipe');
  assert.equal(landformSteps({...source,terraces:12}).terraces,8);
  assert.equal(landformSteps({...source,stepReference:1,terraces:12}).shoreLayers,12);
});

test('landform step details follow the active reference and count',async()=>{
  const {shapeControlAvailable:available}=await import('../sculpt-control-schema.js');
  for(const reference of [0,1,2]){
    const p={stepReference:reference,terraces:6};
    assert.equal(available('breakup','landform',p),reference===0);
    assert.equal(available('layerPx','landform',p),reference!==0);
    assert.equal(available('layerCircle','landform',p),reference===2);
    assert.equal(available('lavaSpread','landform',p),reference===1);
    assert.equal(available('layerJag','landform',p),reference!==0);
    for(const key of ['ledge','terraceJitter','layerPx','layerCircle','lavaSpread','layerJag','breakup'])assert.equal(available(key,'landform',{...p,terraces:0}),false);
  }
});

test('lfcrater: a stroke with impact features reads its path as the projectile\'s',async()=>{
  const {impactSetup,impactPoint,impactEnd,impactSpread,impactWeight,landformSigned,landformPeak}=await import('../sculpt-shape-presets.js');
  const q={radius:100,ejecta:1,secondaries:0,curve:{form:'lfCrater',knots:[[0,0],[.39,-.4],[.56,-.04],[1,1]]},heightReference:2,elevation:-15,combine:2};
  const drag=L=>[{x:0,y:0},{x:L,y:0}];
  // A click is vertical; a drag as long as the diameter is the 12 degree grazing threshold; a fifth of it about 47 degrees.
  assert.equal(impactSetup(q,[{x:5,y:5}]).angle,90);
  assert.ok(Math.abs(impactSetup(q,drag(200)).angle-12)<1e-9);
  assert.ok(Math.abs(impactSetup(q,drag(40)).angle-46.7)<.1);
  // The impact lands at the path's end; the path before it is a groove whose width follows the along curve over its value at the end (at least .05).
  assert.deepEqual(impactPoint(drag(120)),{x:120,y:0});
  assert.equal(impactEnd(q),1); assert.equal(impactEnd({...q,along:[[0,0],[1,.5]]}),.5); assert.equal(impactEnd({...q,along:[[0,1],[1,0]]}),.05);
  // Spread: even round a vertical impact; an uprange gap at 20 degrees; the sides only at 5 degrees.
  const at=(angle,deg)=>impactWeight(impactSpread(angle),deg*Math.PI/180);
  assert.equal(at(90,0),1); assert.equal(at(90,180),1);
  assert.ok(at(20,0)>1.5&&at(20,180)===0);
  assert.ok(at(5,90)>.99&&at(5,0)===0&&at(5,180)===0);
  // The crater's knot below 0 makes a signed section, peaking at its rim (share .39 of the half width from the foot).
  assert.ok(landformSigned(q)); assert.ok(!landformSigned({curve:{form:'lfHill'}}));
  assert.ok(Math.abs(landformPeak(q)-.39)<.02);
});

test('lfimpact2: Buckling is its own impact row, on a landform that digs',async()=>{
  const {impactOn,bucklingOn,ejectaReach}=await import('../sculpt-shape-presets.js');
  const {shapeControlAvailable:available}=await import('../sculpt-control-schema.js');
  const {prepareNode}=await import('../sculpt-gpu-fields.js');
  const crater={radius:200,ejecta:0,buckling:.7,secondaries:0,curve:{form:'lfCrater',knots:[[0,0],[.39,-.4],[.56,-.04],[1,1]]},heightReference:2,elevation:-20,combine:2};
  const mound={...crater,heightReference:0,elevation:60,combine:0};
  // Buckling alone makes an impact (a drag lands at its end) and reaches the ejecta's distance; on a shape that does not dig it is off, and its row hidden.
  assert.ok(bucklingOn(crater)&&impactOn(crater)&&ejectaReach(crater)>0);
  assert.ok(!bucklingOn(mound)&&!impactOn(mound)&&ejectaReach(mound)===0);
  assert.equal(available('buckling','landform',crater),true);
  assert.equal(available('buckling','landform',mound),false);
  assert.equal(available('buckling','landform',{...crater,curve:{form:'lfRiver'}}),false);
  // Ejecta no longer drives it: each has its own height, on the same scale (.3 of the relief per 100%).
  const ctx={seed:1,baseHeight:99,sea:75,params:n=>new Proxy(n.params,{get:(o,k)=>o[k]??0})};
  const u=params=>prepareNode({kind:'landform',seed:1,points:[{x:500,y:500}],params},{grid:512,spacing:2},ctx).u;
  assert.ok(Math.abs(u(crater).bkAmt-.3*.7*20)<1e-9); assert.equal(u(crater).ejAmt,0);
  assert.equal(u({...crater,ejecta:.7,buckling:0}).bkAmt,0); assert.ok(u({...crater,ejecta:.7,buckling:0}).ejAmt>0);
});

test('lfimpact2: Secondaries\' distance moves the whole band, and the bounds with it',async()=>{
  const {impactReach}=await import('../sculpt-shape-presets.js');
  const {prepareNode}=await import('../sculpt-gpu-fields.js');
  const ctx={seed:1,baseHeight:99,sea:75,params:n=>new Proxy(n.params,{get:(o,k)=>o[k]??0})};
  const q={radius:200,ejecta:0,buckling:0,secondaries:6,curve:{form:'lfCrater',knots:[[0,0],[.39,-.4],[.56,-.04],[1,1]]},heightReference:2,elevation:-20,combine:2};
  const spots=near=>prepareNode({kind:'landform',seed:7,points:[{x:2000,y:2000}],params:{...q,secondaryDistance:near}},{grid:2048,spacing:2},ctx).multi.slice(1).map(m=>Math.hypot(m.segs[0].px-2000,m.segs[0].py-2000));
  // The same seed throws to the same azimuths and draws; every distance scales with the row.
  const a=spots(1.6),b=spots(1.1),c=spots(3.2);
  assert.equal(a.length,b.length); for(let i=0;i<a.length;i++){assert.ok(Math.abs(b[i]/a[i]-1.1/1.6)<1e-6); assert.ok(Math.abs(c[i]/a[i]-2)<1e-6);}
  // 1.6, the distance before the row, keeps the old bound (5.2 rim radii); the bound grows with the row.
  const W=200;
  assert.ok(impactReach({...q,secondaryDistance:3.2})>impactReach({...q,secondaryDistance:1.6})*1.9);
  assert.ok(Math.max(...c)<impactReach({...q,secondaryDistance:3.2})+W);
});
