import test from 'node:test';
import assert from 'node:assert/strict';
import {blankMaterial,copyMaterial,worldMaterials,addMaterial} from '../sculpt-materials.js';
import {copyRocks,duplicateRock,rockByKey} from '../sculpt-rock-presets.js';
import {mapOwnedKit,worldKit,storedWorldKit,baseRockKeys,copyMaterialRef,instantiateWorldKit,validateWorldRocks,resolvedWorldCard,worldToolUnavailable,authoredWorldTool,sameKitData,addWorldRockInstance} from '../sculpt-world-kit.js';
const config={biomeId:'fixture',materials:{ground:'green-ground',water:'green-water',rock:'green-rock'},tools:[{id:'hill',label:'Hill',icon:'hill',color:'#778899',group:'shape',rock:'soil'}]};
const graph=blankMaterial();
const template=(key='wrock-stone',extra={})=>({key,name:'Stone',knobs:{faceWhole:.8},column:null,colors:null,material:{key:'wmat-stone',name:'Stone grain',graph:copyMaterial(graph)},...extra});
const tool=(extra={})=>({id:'world-ridge',label:'Ridge',icon:'mountain',color:'#778899',group:'shape',shape:'mountain',family:'Highlands',card:{preset:'custom',diameter:320,curve:{form:'knots',knots:[[0,0],[.5,1],[1,0]]}},...extra});
const world=()=>({tools:[...config.tools,tool({rock:'wrock-stone',ground:{world:'worldGround'}})],rocks:[template()]});

test('portable kit references become ordinary slots without moving existing map slots',()=>{
 const w=world(),fresh=instantiateWorldKit(config,w);
 assert.equal(fresh.rocks[0].worldKey,'wrock-stone');
 const card=resolvedWorldCard(fresh.kit.tools[1],fresh.rocks,fresh.materials,config);
 assert.equal(card.rockPreset,1);assert.equal(card.groundPreset,0);assert.deepEqual(card.curve,w.tools[1].card.curve);
 const local={slot:1,key:'wrock-stone',name:'Map Stone',knobs:{faceWhole:.1},column:null,colors:null};
 const existing=instantiateWorldKit(config,w,{rocks:[local],materials:worldMaterials(config),source:{}});
 assert.deepEqual(existing.rocks[0],local);assert.equal(existing.rocks[1].slot,2);assert.equal(existing.rocks[1].key,null);assert.equal(existing.rocks[1].worldKey,'wrock-stone');
 assert.equal(resolvedWorldCard(w.tools[1],existing.rocks,existing.materials,config).rockPreset,2);assert.equal(rockByKey(existing.rocks,'wrock-stone'),2,'native world tool lookup prefers world instance over local recipe key');
});
test('load provenance requires exact recipe and material snapshot, not a matching source name',()=>{
 const w=world(),fresh=instantiateWorldKit(config,w),r=fresh.rocks[0];
 assert.equal(validateWorldRocks([r],fresh.materials,fresh.kit)[0].worldKey,r.worldKey);
 assert.equal(validateWorldRocks([{...r,knobs:{faceWhole:.2}}],fresh.materials,fresh.kit)[0].worldKey,undefined);
 const changed=fresh.materials.map(m=>m.slot===r.material?{...m,seed:33}:m);
 assert.equal(validateWorldRocks([r],changed,fresh.kit)[0].worldKey,undefined);
 assert.throws(()=>validateWorldRocks([r,{...r,slot:2,key:null}],fresh.materials,fresh.kit),/catalog key/);
 assert.throws(()=>copyRocks([{...r,worldKey:7}]),/key/);
});
test('full runtime and material tables fail adoption without any partial writes or replacement',()=>{
 const full=Array.from({length:15},(_,i)=>({slot:i+1,key:null,name:'Local '+i,knobs:{faceWhole:i/20},column:null,colors:null})),materials=worldMaterials(config),before=JSON.stringify([full,materials]);
 const result=instantiateWorldKit(config,world(),{rocks:full,materials,source:{}});
 assert.deepEqual(result.rocks,full);assert.deepEqual(result.materials,materials);assert.deepEqual(result.unbound,['wrock-stone']);assert.match(worldToolUnavailable(result.kit.tools[1],result.rocks,result.materials,config),/slot/);
 assert.equal(JSON.stringify([full,materials]),before);
 let crowded=materials;while(crowded.length<23)crowded=addMaterial(crowded,graph,'Map material').materials;
 const blocked=instantiateWorldKit(config,world(),{rocks:[],materials:crowded,source:{}});
 assert.deepEqual(blocked.materials,crowded);assert.deepEqual(blocked.rocks,[]);assert.match(blocked.reason,/23 materials/);
 assert.throws(()=>instantiateWorldKit(config,{...world(),rocks:Array.from({length:16},(_,i)=>template('wrock-'+i))}),/15 rock/);
});
test('malformed portable references/cards and conflicting inline identities reject before mutation',()=>{
 assert.throws(()=>copyMaterialRef({world:'not-a-role'}),/Unknown/);
 assert.throws(()=>worldKit(config,{...world(),tools:[tool({card:{rockPreset:3}})]}),/not map slots/);
 assert.throws(()=>worldKit(config,{...world(),tools:[tool({rock:'missing'})]}),/does not carry/);
 assert.throws(()=>worldKit(config,{...world(),rocks:[template(),template()]}),/unique permanent/);
 assert.throws(()=>worldKit(config,{...world(),rocks:[template(),template('wrock-other',{material:{key:'wmat-stone',name:'Other',graph}})]}),/disagree/);
 assert.throws(()=>worldKit(config,{tools:[tool({extra:true})]}),/Invalid world tool/);
 assert.throws(()=>worldKit(config,{tools:[{...tool(),id:'map-1'}]}),/separate/);
});

test('supplied null catalogs and false material refs reject; missing optional roles leave types unbound',()=>{
 for(const key of ['tools','rocks'])assert.throws(()=>worldKit(config,{[key]:null}),/list|rock types/);
 for(const value of [null,false,0,'']){assert.throws(()=>worldKit(config,{rocks:[template('wrock-test',{material:value})]}));assert.throws(()=>worldKit(config,{tools:[tool({ground:value})]}));}
 // A stored entry without a card is not the artist's: it is dropped, and the config's tools are the world's built-in ones.
 assert.deepEqual(worldKit(config,{tools:[{id:'unknown',label:'Unknown',icon:'hill',color:'#778899',group:'shape',shape:'hill'}]}).tools.map(t=>t.id),['hill']);
 assert.throws(()=>worldKit(config,{tools:[tool({id:'hill'})]}),/world- ids|unique ids/);
 const missing=instantiateWorldKit(config,{rocks:[template('wrock-test',{material:{world:'worldSlope'}})]});
 assert.deepEqual(missing.rocks,[]);assert.deepEqual(missing.unbound,['wrock-test']);assert.match(missing.reason,/material role/);
});

test('kit object/card key order is canonical, while toolbar order remains meaningful',()=>{
 const w=world(),reorder=v=>Array.isArray(v)?v.map(reorder):v&&typeof v==='object'?Object.fromEntries(Object.keys(v).reverse().map(k=>[k,reorder(v[k])])):v;
 assert(sameKitData(worldKit(config,w),worldKit(config,reorder(w))));
 const two={...w,tools:[...w.tools,tool({id:'world-second',label:'Second'})]};
 assert(!sameKitData(worldKit(config,two),worldKit(config,{...two,tools:[two.tools[0],two.tools[2],two.tools[1]]})),'the authored tools keep their order');
 const absent=instantiateWorldKit(config,{tools:[tool({rock:'wrock-test'})],rocks:[template('wrock-test',{material:{world:'worldSlope'}})]});
 assert.match(worldToolUnavailable(absent.kit.tools.find(authoredWorldTool),absent.rocks,absent.materials,config,absent.kit),/slope cover material is missing/);
 assert.match(worldToolUnavailable(tool({ground:{world:'worldSlope'}}),[],worldMaterials(config),config),/slope cover material is missing/);
});

test('a positive world catalog reference never aliases slot0 through a default-recipe name collision',()=>{
 const c={...config,rock:{recipe:'wrock-stone'}},w=world(),full=Array.from({length:15},(_,i)=>({slot:i+1,key:null,name:'Local '+i,knobs:{},column:null,colors:null}));
 const result=instantiateWorldKit(c,w,{rocks:full,materials:worldMaterials(c),source:{}}),t=result.kit.tools[1];
 assert.match(worldToolUnavailable(t,result.rocks,result.materials,c,result.kit),/15 rock slots/);assert.equal(resolvedWorldCard(t,result.rocks,result.materials,c).rockPreset,-1);
});

test('foreign source native tools are not reinterpreted as destination native tools during carry',()=>{
 const source=world(),fresh=instantiateWorldKit(config,source);source.tools.push({id:'foreignKnoll',shape:'foreign-shape',label:'Foreign knoll',icon:'hill',color:'#778899',group:'shape'});
 const result=instantiateWorldKit(config,world(),{rocks:fresh.rocks,materials:fresh.materials,source});assert.equal(result.rocks[0].worldKey,'wrock-stone');
});
test('an explicit instance can recover its original world identity after capacity is freed',()=>{
 const w=world(),full=Array.from({length:15},(_,i)=>({slot:i+1,key:null,name:'Local '+i,knobs:{},column:null,colors:null})),rejected=instantiateWorldKit(config,w,{rocks:full,materials:worldMaterials(config),source:{}});
 assert.deepEqual(rejected.unbound,['wrock-stone']);
 const added=addWorldRockInstance(w.rocks[0],full.slice(0,-1),rejected.materials),bound=added.rocks.map(r=>r.slot===added.slot?{...r,worldKey:w.rocks[0].key}:r);
 assert.equal(worldToolUnavailable(w.tools[1],bound,added.materials,config,worldKit(config,w)),'');assert.equal(resolvedWorldCard(w.tools[1],bound,added.materials,config).rockPreset,15);
});


test('built-in tools come from the config: a stored list cannot freeze, lose or break them',()=>{
 const stale={id:'removed',label:'Removed',icon:'hill',color:'#778899',group:'shape',shape:'hill'},relabeled={...config.tools[0],label:'Old hill'};
 const kit=worldKit(config,{tools:[relabeled,stale,tool()]});
 assert.deepEqual(kit.tools.map(t=>[t.id,t.label]),[['hill','Hill'],['world-ridge','Ridge']],'the config’s label wins, a removed one is dropped');
 assert.deepEqual(worldKit({...config,tools:[...config.tools,{...config.tools[0],id:'knoll',label:'Knoll',shape:'hill'}]},{tools:[tool()]}).tools.map(t=>t.id),['hill','knoll','world-ridge'],'a new built-in tool reaches the world');
});
test('a world stores only what its artist made',()=>{
 assert.deepEqual(storedWorldKit(config,{}),{});
 const derived=worldKit(config);assert.deepEqual(storedWorldKit(config,{tools:derived.tools,rocks:derived.rocks}),{},'the built-in tools and the derived catalog stay derived');
 const own=storedWorldKit(config,world());assert.deepEqual(own.tools.map(t=>t.id),['world-ridge']);assert.deepEqual(own.rocks.map(r=>r.key),['wrock-stone']);
});
test('a saved tool whose library shape is gone is left out, not fatal',()=>{
 assert.deepEqual(worldKit(config,{tools:[tool(),tool({id:'world-gone',shape:'retired-shape'})]}).tools.map(t=>t.id),['hill','world-ridge']);
});
test('a map tool whose library shape is gone is left out of the save it loads from',async()=>{
 const {copyMapTools}=await import('../sculpt-tools.js');
 const mapTool=(id,shape)=>({id,label:'Mine '+id,icon:'hill',color:'#778899',group:'shape',shape,card:{preset:'custom',diameter:300}});
 assert.deepEqual(copyMapTools([mapTool('map-1','hill'),mapTool('map-2','retired-shape')]).map(t=>t.id),['map-1']);
});
test('a saved world tool with a removed card setting loads without it; one with a setting of the wrong kind is left out (AGENTS.md rule 7)',()=>{
 const {card}=tool(),kept=worldKit(config,{tools:[tool({card:{...card,removedOption:5}})]}).tools.find(authoredWorldTool);
 assert.equal('removedOption' in kept.card,false);assert.deepEqual(kept.card,worldKit(config,{tools:[tool()]}).tools.find(authoredWorldTool).card);
 assert.deepEqual(worldKit(config,{tools:[tool({card:{...card,diameter:'wide'}}),tool({id:'world-other'})]}).tools.map(t=>t.id),['hill','world-other']);
});

test('an earlier build\'s world tools and rock types become the map\'s own (owner, 2026-11-19)',()=>{
 const w=world(),fresh=instantiateWorldKit(config,w);
 const save={nodes:[{kind:'landform',tool:'world-ridge',params:{}},{kind:'landform',tool:'hill',params:{}}],tool:'world-ridge',toolSettings:{'world-ridge':{diameter:200}},rocks:fresh.rocks,materials:fresh.materials,worldSettings:{name:'Mine',...w}};
 const {sketch,lost}=mapOwnedKit(save,config);
 assert.equal(lost,0);
 assert.deepEqual(sketch.tools.map(t=>[t.id,t.label,t.shape,t.card.rockPreset]),[['map-1','Ridge','mountain',1]],'the world tool is map-1, on the instance\'s slot');
 assert.deepEqual(sketch.nodes.map(n=>n.tool),['map-1','hill'],'its strokes follow');
 assert.equal(sketch.tool,'map-1');assert.deepEqual(sketch.toolSettings,{'map-1':{diameter:200}});
 assert.equal(sketch.rocks.some(r=>'worldKey' in r),false,'no rock type keeps a world\'s provenance');
 assert.equal('tools' in sketch.worldSettings||'rocks' in sketch.worldSettings,false,'and the world keeps no kit');
 assert.equal(mapOwnedKit(sketch,config).sketch,sketch,'a map already its own is left as it is');
});
