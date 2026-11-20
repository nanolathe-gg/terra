import {normalizeSet} from '../sculpt-feature-set.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import {savedWorld,worldOverrideCount,resetWorldOverrides,copySavedWorld} from '../sculpt-save.js';

const config={biomeId:'green',biome:'Green Planet',defaults:{rainErode:0,faceWear:.2},engineDefaults:{groundFine:1},colors:{slope:'#123456',sky:'#ffffff'},materials:{ground:'green-ground',water:'green-water'}};
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

test('Apply look: every setting, color and world material belongs to one card', async () => {
  const {lookCard, roleCard, LOOK_CARDS} = await import('../sculpt-save.js');
  const {KNOBS} = await import('../sculpt-knobs.js');
  const {MAP_ROLES} = await import('../sculpt-materials.js');
  const fs = await import('node:fs');
  // The homes as sculpt-ui.js holds them (it touches the page, so it is read as text here).
  const src = fs.readFileSync(new URL('../sculpt-ui.js', import.meta.url), 'utf8'), i = src.indexOf('export const WORLD_HOMES={'), j = src.indexOf('};', i);
  const {ROCK_HEADLINES} = await import('../sculpt-rock-presets.js');
  const homes = new Function('ROCK_HEADLINES', 'return ' + src.slice(i + 'export const WORLD_HOMES='.length, j + 1))(ROCK_HEADLINES);
  const homeOf = new Map(Object.entries(homes).flatMap(([home, keys]) => keys.split(' ').map(k => [k, home])));
  const cards = new Set(LOOK_CARDS.map(([c]) => c));
  for (const [, rows] of KNOBS) for (const [key] of rows) assert.ok(cards.has(lookCard(key, homeOf.get(key))), `the row ${key} belongs to a card`);
  for (const key of ['shallowTone', 'sun', 'sky', 'absorb', 'beachFrom', 'sandEdge']) assert.ok(cards.has(lookCard(key, '')), key);
  assert.equal(lookCard('palette', ''), null);
  assert.equal(lookCard('elevation', '', {row: false}), 'tools', 'a shape tool default is the Tools card\'s');
  for (const key of ['worldGround', 'worldWater', ...MAP_ROLES.map(([r]) => r), 'layer:green-snow']) assert.ok(cards.has(roleCard(key)), key);
  assert.equal(roleCard(null), null);
});

test('a map world includes defaults, edited controls, URL overrides, disabled colors and its custom identity',()=>{
  const own={name:'My world',colors:{slope:null},knobs:{rainErode:'.6'}},query=new URLSearchParams('rainErode=.8&beachFrom=archipelago&sunColor=ffaa22&materialFoot=2&map=private-id&pendingSketch=token&gpuMB=512');
  const value=savedWorld(config,query,own);
  assert.equal(value.name,'My world');assert.equal(value.base,'green');assert.equal('variant' in value,false);
  assert.deepEqual(value.colors,{slope:null,sky:'#ffffff',sun:'#ffaa22'});
  assert.deepEqual(value.materials.map(m=>[m.source,m.worldGround,m.worldWater]),[['green-ground',true,false],['green-water',false,true]]);
  assert.equal(value.knobs.rainErode,'.8');assert.equal(value.knobs.faceWear,'0.2');assert.equal(value.knobs.groundFine,'1');assert.equal(value.knobs.beachFrom,'archipelago');assert.equal(value.knobs.materialFoot,undefined,'the removed preview footprint is not saved');
  for(const key of ['map','pendingSketch','gpuMB','view'])assert.equal(key in value.knobs,false);
  assert.deepEqual(copySavedWorld(JSON.parse(JSON.stringify(value)),config),value);
});

test('engine tables travel with the map; a key the world no longer has, or a value of another kind, is dropped', async () => {
  const {engineTables,copyEngineTables,applyEngineTables} = await import('../sculpt-save.js');
  const base={material:{rockSlope:1.1,wetBand:13,rockMeanRGB:[1,2,3]},water:{shallowRGB:[9,9,9]}};
  assert.deepEqual(engineTables(base),base);
  assert.deepEqual(copyEngineTables({material:{rockSlope:.7,gone:1,wetBand:'x',rockMeanRGB:[4,5,6]},water:{shallowRGB:[1,1,1]},other:{}},base),{material:{rockSlope:.7,rockMeanRGB:[4,5,6]},water:{shallowRGB:[1,1,1]}});
  const live=structuredClone(base);applyEngineTables(live,{material:{rockSlope:.7}});assert.deepEqual(live.material,{rockSlope:.7,wetBand:13,rockMeanRGB:[1,2,3]},'a key the map lacks keeps the data\'s value');
});
