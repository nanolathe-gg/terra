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
  // A setting or color of the wrong kind is dropped (the world's default stands), not the whole world (AGENTS.md rule 7).
  const loaded=copySavedWorld({...value,colors:{slope:'red',sky:'#00ff00'},knobs:{rainErode:'NaN',faceWear:'.3'}},config);
  assert.deepEqual(loaded.colors,{sky:'#00ff00'});assert.deepEqual(loaded.knobs,{faceWear:'.3'});
  assert.throws(()=>copySavedWorld({...value,colors:'red'},config),/invalid/);
});
test('Shallow water is saved as a tone of the water; its old color and a bad tone are dropped',()=>{
  const value=savedWorld(config,new URLSearchParams(),{name:'Test',colors:{shallow:'#c03030',shallowTone:[.1,-.05,0]},knobs:{}});
  assert.deepEqual(value.colors.shallowTone,[.1,-.05,0]);assert.equal('shallow' in value.colors,false);
  assert.deepEqual(copySavedWorld(JSON.parse(JSON.stringify(value)),config),value);
  assert.equal('shallow' in copySavedWorld({...value,colors:{...value.colors,shallow:'#c03030'}},config).colors,false);
  for(const bad of ['#c03030',[.1,0],[2,0,0],['a',0,0]])assert.equal('shallowTone' in copySavedWorld({...value,colors:{shallowTone:bad}},config).colors,false,JSON.stringify(bad));
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
test('a saved world\'s numbers are checked as the server sends its defaults, as text; a word keeps its text',()=>{
  // As served (internal/site config: every default is text), with a word-valued default beside the numbers.
  const served={...config,defaults:{rainErode:'0',faceWear:'0.2',material:'varied'},engineDefaults:{groundFine:'1'}};
  const value=savedWorld(served,new URLSearchParams(),{});
  for(const bad of ['abc','NaN','1e999','','  ']){
    const knobs=copySavedWorld({...value,knobs:{...value.knobs,rainErode:bad,groundFine:bad,undulation:bad}},served).knobs;
    assert.equal(knobs.rainErode,undefined,`a world default's number: ${JSON.stringify(bad)}`);
    assert.equal(knobs.groundFine,undefined,`an engine default's number: ${JSON.stringify(bad)}`);
    assert.equal(knobs.undulation,undefined,`a slider without a default: ${JSON.stringify(bad)}`);
  }
  const kept=copySavedWorld({...value,knobs:{...value.knobs,rainErode:'.5',groundFine:2,undulation:'-1.5',material:'smooth'}},served).knobs;
  assert.deepEqual([kept.rainErode,kept.groundFine,kept.undulation,kept.material],['.5','2','-1.5','smooth']);
});
