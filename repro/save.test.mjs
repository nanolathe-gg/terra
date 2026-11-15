import test from 'node:test';
import assert from 'node:assert/strict';
import {savedWorld,copySavedWorld,savedWorldId} from '../sculpt-save.js';

const config={biomeId:'green',biome:'Green Planet',defaults:{rainErode:0,faceWear:.2},engineDefaults:{groundFine:1},colors:{slope:'#123456',sky:'#ffffff'},materials:{ground:'green-ground',water:'green-water'}};
test('a map world includes defaults, edited controls, URL overrides, disabled colors and its custom identity',()=>{
  const own={name:'My world',colors:{slope:null},knobs:{rainErode:'.6'}},query=new URLSearchParams('rainErode=.8&beachFrom=archipelago&sunColor=ffaa22&materialFoot=2&map=private-id&pendingSketch=token&gpuMB=512');
  const value=savedWorld(config,query,own);
  assert.equal(value.name,'My world');assert.equal(value.base,'green');assert.equal('variant' in value,false);
  assert.deepEqual(value.colors,{slope:null,sky:'#ffffff',sun:'#ffaa22'});
  assert.deepEqual(value.materials.map(m=>[m.source,m.worldGround,m.worldWater]),[['green-ground',true,false],['green-water',false,true]]);
  assert.equal(value.knobs.rainErode,'.8');assert.equal(value.knobs.faceWear,'0.2');assert.equal(value.knobs.groundFine,'1');assert.equal(value.knobs.beachFrom,'archipelago');assert.equal(value.knobs.materialFoot,'2');
  for(const key of ['map','pendingSketch','gpuMB'])assert.equal(key in value.knobs,false);
  assert.deepEqual(copySavedWorld(JSON.parse(JSON.stringify(value)),config),value);
  assert.equal(savedWorldId({biome:'green',world:'my-world-abcd'}),'my-world-abcd');
  assert.equal(savedWorldId({biome:'green',world:'__proto__'}),'green');
});
test('older maps remain loadable; removed controls are dropped and invalid embedded settings are rejected',()=>{
  assert.equal(copySavedWorld(undefined,config),null);
  const value=savedWorld(config,new URLSearchParams(),{name:'Test',colors:{},knobs:{}});
  assert.equal(copySavedWorld({...value,knobs:{...value.knobs,removedControl:'9'}},config).knobs.removedControl,undefined);
  assert.throws(()=>copySavedWorld({...value,base:'lava'},config),/invalid/);
  assert.throws(()=>copySavedWorld({...value,colors:{slope:'red'}},config),/invalid/);
  assert.throws(()=>copySavedWorld({...value,knobs:{rainErode:'NaN'}},config),/invalid/);
});
