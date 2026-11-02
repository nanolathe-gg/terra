import test from 'node:test';
import assert from 'node:assert/strict';
import {shapeControlAvailable as available,controlLabel,PARKED_WORLD_CONTROLS} from '../sculpt-control-schema.js';
import {prepareNode} from '../sculpt-gpu-fields.js';

test('a hill exposes foot effects only as a ridge',()=>{
 assert.equal(available('baseVary','hill',{}),false);
 assert.equal(available('baseBump','hill',{crestJag:.2}),true);
 assert.equal(available('baseVary','hill',{spurCount:3}),true);
 assert.equal(available('moonLobes','mountain',{baseVary:15}),false);
 assert.equal(available('iceFacetSize','hill',{iceFacets:1}),false);
 assert.equal(available('iceFacetSize','mountain',{iceFacets:1}),true);
});
test('faceted forms and shoreline materials keep their own dependent controls',()=>{
 assert.equal(available('crystalTiers','crystal',{crystalForm:0}),false);
 assert.equal(available('crystalTiers','crystal',{crystalForm:1}),true);
 assert.equal(available('crystalCount','crystal',{crystalForm:1}),false);
 assert.equal(available('bergTiltDir','crystal',{crystalForm:2,bergTilt:0}),false);
 assert.equal(available('bergTiltDir','crystal',{crystalForm:2,bergTilt:.2}),true);
 assert.equal(available('frostNeedles','deep',{shorePlates:1,plateMaterial:1}),false);
 assert.equal(available('frostNeedles','deep',{shorePlates:1,plateMaterial:2}),true);
 assert.equal(available('crystalShoreSeam','deep',{shorePlates:1,plateMaterial:2}),false);
});
test('erase all masks includes all eight local style planes',()=>{
 const context={seed:1,baseHeight:99,sea:75,params:n=>new Proxy(n.params,{get:(q,k)=>q[k]??0})};
 const prepared=prepareNode({kind:'paint',seed:1,points:[{x:40,y:40}],params:{radius:20,amount:100,paintChannel:7,softness:.5}}, {grid:256,spacing:1},context);
 const writes=prepared.writes;
 assert.ok(writes,'paint preparation exposes mask writes');
 assert.deepEqual(writes.map(w=>w[0]),Array.from({length:18},(_,i)=>i));
 assert.ok(writes.every(w=>w[1]===0));
});
test('the parked control is only crevice',()=>{
 assert.deepEqual([...PARKED_WORLD_CONTROLS],['crevice']);
 assert.equal(controlLabel('moonCups','Moon cups'),'Slope cups');
 assert.equal(controlLabel('iceSoft','Ice lighting'),'Rounded lighting');
});

test('world dependencies explain bypasses without biome gates',async()=>{
 const {worldControlRequirement:requirement}=await import('../sculpt-control-schema.js');
 assert.match(requirement('bedVary',{column:1,rockOrder:1}),/authored bed profile/);
 assert.equal(requirement('bedVary',{column:0,rockOrder:1}),'');
 assert.match(requirement('undulationCover',{undulation:0}),/Undulation height/);
 assert.equal(requirement('undulationCover',{undulation:8}),'');
 assert.match(requirement('gullySpacing',{rockOrder:0,gullyDepth:1}),/Rock structure/);
 assert.match(requirement('jointRun',{rockOrder:1,jointDepth:0}),/Joint depth/);
 assert.equal(requirement('jointRun',{rockOrder:1,jointDepth:2}),'');
 assert.match(requirement('bedBend',{rockOrder:1,gullyDepth:0,ribTilt:0}),/Gully depth or Rib tilt/);
 assert.equal(requirement('bedBend',{rockOrder:1,gullyDepth:0,ribTilt:.2}),'');
 assert.equal(requirement('bedBend',{rockOrder:1,gullyDepth:4,ribTilt:0}),'');
 assert.match(requirement('cliffStagger',{cliffFollow:0,jointDepth:2}),/Follow terrain/);
 assert.match(requirement('cliffStagger',{cliffFollow:1,jointDepth:0}),/Joint depth/);
 assert.equal(requirement('cliffStagger',{cliffFollow:1,jointDepth:2}),'');
 assert.equal(requirement('boulderSize',{boulders:0}),'','painted scatter still uses size when global density is zero');
});
