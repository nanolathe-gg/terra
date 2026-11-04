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
    for(const key of ['shoreLayers','layerLedge','layerRough','layerStyle'])assert.equal(available(key,'landform',p),false);
    assert.equal(available('breakup','landform',p),reference===0);
    assert.equal(available('layerPx','landform',p),reference!==0);
    assert.equal(available('layerCircle','landform',p),reference===2);
    assert.equal(available('lavaSpread','landform',p),reference===1);
    for(const key of ['ledge','terraceJitter','layerPx','layerCircle','lavaSpread','breakup'])assert.equal(available(key,'landform',{...p,terraces:0}),false);
  }
});
