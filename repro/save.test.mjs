import {normalizeSet} from '../sculpt-feature-set.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import {savedWorld,worldOverrideCount,resetWorldOverrides,copySavedWorld,savedWorldId,sameSavedWorld} from '../sculpt-save.js';

const config={biomeId:'green',biome:'Green Planet',defaults:{rainErode:0,faceWear:.2},engineDefaults:{groundFine:1},colors:{slope:'#123456',sky:'#ffffff'},materials:{ground:'green-ground',water:'green-water'}};
test('a map world includes defaults, edited controls, URL overrides, disabled colors and its custom identity',()=>{
  const own={name:'My world',colors:{slope:null},knobs:{rainErode:'.6'}},query=new URLSearchParams('rainErode=.8&beachFrom=archipelago&sunColor=ffaa22&materialFoot=2&map=private-id&pendingSketch=token&gpuMB=512');
  const value=savedWorld(config,query,own);
  assert.equal(value.name,'My world');assert.equal(value.base,'green');assert.equal('variant' in value,false);
  assert.deepEqual(value.colors,{slope:null,sky:'#ffffff',sun:'#ffaa22'});
  assert.deepEqual(value.materials.map(m=>[m.source,m.worldGround,m.worldWater]),[['green-ground',true,false],['green-water',false,true]]);
  assert.equal(value.knobs.rainErode,'.8');assert.equal(value.knobs.faceWear,'0.2');assert.equal(value.knobs.groundFine,'1');assert.equal(value.knobs.beachFrom,'archipelago');assert.equal(value.knobs.materialFoot,undefined,'the removed preview footprint is not saved');
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
test('Shallow water is saved as a tone of the water; its old color is dropped and a bad tone rejected',()=>{
  const value=savedWorld(config,new URLSearchParams(),{name:'Test',colors:{shallow:'#c03030',shallowTone:[.1,-.05,0]},knobs:{}});
  assert.deepEqual(value.colors.shallowTone,[.1,-.05,0]);assert.equal('shallow' in value.colors,false);
  assert.deepEqual(copySavedWorld(JSON.parse(JSON.stringify(value)),config),value);
  assert.equal('shallow' in copySavedWorld({...value,colors:{...value.colors,shallow:'#c03030'}},config).colors,false);
  for(const bad of ['#c03030',[.1,0],[2,0,0],['a',0,0]])assert.throws(()=>copySavedWorld({...value,colors:{shallowTone:bad}},config),/invalid/);
});

test('World home counts stored differences from pristine data and Reset preserves identity',()=>{
  const base={...config,surface:[{builtin:'rock',amount:1}]};
  assert.equal(worldOverrideCount({name:'Custom',base:'green',knobs:{faceWear:'0.2'},colors:{sky:'#ffffff'},surface:structuredClone(base.surface)},base),0);
  const world={name:'Custom',base:'green',knobs:{faceWear:'.5'},colors:{sky:'#abcdef'},surface:[{builtin:'rock',amount:.3}],featureSet:normalizeSet(undefined,base)};
  assert.equal(worldOverrideCount({...world,knobs:{},colors:{},surface:base.surface},base),0,'a copied normalized default feature set is not an override');
  Object.values(world.featureSet)[0].recipes[0].name='Custom feature';
  assert.equal(worldOverrideCount(world,base),4);
  assert.deepEqual(resetWorldOverrides(world),{name:'Custom',base:'green',colors:{},knobs:{}});
  assert.equal(world.knobs.faceWear,'.5','Reset does not mutate its undo source');
});

test('a map whose world lacks tools added to yours since opens in yours; one with a tool yours lacks forks',()=>{
  const tool=id=>({id,label:'Ridge '+id,icon:'mountain',color:'#778899',group:'shape',shape:'mountain',card:{preset:'custom',diameter:320}});
  const map=copySavedWorld(JSON.parse(JSON.stringify(savedWorld(config,new URLSearchParams(),{name:'Mine',colors:{},knobs:{},tools:[tool('world-a')]}))),config);
  assert.equal(sameSavedWorld(map,{name:'Mine',colors:{},knobs:{},tools:[tool('world-a')]},config),true);
  assert.equal(sameSavedWorld(map,{name:'Mine',colors:{},knobs:{},tools:[tool('world-a'),tool('world-b')]},config),true,'yours gained a tool');
  assert.equal(sameSavedWorld(map,{name:'Mine',colors:{},knobs:{}},config),false,'yours lacks the map’s tool');
  assert.equal(sameSavedWorld(map,{name:'Mine',colors:{},knobs:{},tools:[{...tool('world-a'),label:'Renamed'}]},config),false,'yours changed it');
});
