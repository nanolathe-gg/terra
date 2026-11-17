import test from 'node:test';
import assert from 'node:assert/strict';
import {blankMaterial,copyMaterial,worldMaterials,addMaterial} from '../sculpt-materials.js';
import {copyRocks,duplicateRock,rockByKey} from '../sculpt-rock-presets.js';
import {worldKit,copyMaterialRef,instantiateWorldKit,validateWorldRocks,captureWorldKit,publishWorldRock,publishWorldTool,resolvedWorldCard,worldToolUnavailable,authoredWorldTool,sameKitData,resetWorldKitInstances,addWorldRockInstance,stageWorldKitEdit} from '../sculpt-world-kit.js';
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
test('legacy edited inherited recipe keys and omitted base types stay map-local and unchanged',()=>{
 const legacy=[{slot:7,key:'soil',name:'My soil',knobs:{faceRock:.9},column:null,colors:null}],materials=worldMaterials(config),before=JSON.stringify([legacy,materials]);
 const result=instantiateWorldKit(config,{}, {rocks:legacy,materials,source:{}});
 assert.deepEqual(result.rocks,legacy);assert.equal(result.rocks.length,1);assert.equal(result.rocks[0].worldKey,undefined);
 assert.equal(JSON.stringify([legacy,materials]),before);
 const captured=captureWorldKit(worldKit(config),result.rocks,result.materials);
 assert.equal(captured.kit.rocks.find(r=>r.key==='soil').knobs.faceRock,0,'a checkpoint never publishes the legacy copy');
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
test('dirty artist edits retain ownership and are captured in one portable snapshot',()=>{
 const fresh=instantiateWorldKit(config,world()),rocks=fresh.rocks.map(r=>({...r,knobs:{faceWhole:.3}})),materials=fresh.materials.map(m=>m.key==='wmat-stone'?{...m,seed:42,palette:[1,2]}:m);
 const captured=captureWorldKit(fresh.kit,rocks,materials);
 assert.equal(captured.kit.rocks[0].knobs.faceWhole,.3);assert.equal(captured.kit.rocks[0].material.graph.seed,42);assert.deepEqual(captured.kit.rocks[0].material.graph.palette,[1,2]);
 assert.equal(rocks[0].worldKey,'wrock-stone');
 const snapshot=JSON.parse(JSON.stringify({rocks,materials,kit:captured.kit}));
 assert.deepEqual(copyRocks(snapshot.rocks),rocks);assert.deepEqual(snapshot.kit,captured.kit);
});
test('map duplicate clears provenance; explicit world promotion preserves numeric slot and carries material graph',()=>{
 const fresh=instantiateWorldKit(config,world()),duplicate=duplicateRock(fresh.rocks,1,null),local=duplicate.rocks.find(r=>r.slot===duplicate.slot);
 assert.equal(local.worldKey,undefined);assert.equal(local.key,null);
 const result=publishWorldRock(fresh.kit,duplicate.rocks,fresh.materials,duplicate.slot);
 assert.equal(result.rocks.find(r=>r.worldKey===result.key).slot,duplicate.slot);assert.equal(result.kit.rocks.at(-1).material.graph.seed,graph.seed);
 assert.notEqual(result.key,'wrock-stone');assert.equal(local.worldKey,undefined,'arguments are untouched');
});
test('saving a world tool atomically promotes its map-only rock and inline ground dependencies',()=>{
 const base=worldKit(config),rocks=[{slot:8,key:null,name:'Local',knobs:{faceWhole:.6},column:null,colors:null}],added=addMaterial(worldMaterials(config),graph,'Local ground');
 const before=JSON.stringify([base,rocks,added.materials]),result=publishWorldTool(base,rocks,added.materials,{...tool(),id:'unused',card:{preset:'custom',rockPreset:8,groundPreset:added.slot,along:[[0,1],[1,.5]]}});
 const copied=worldKit(config,result.kit),t=copied.tools.at(-1);
 assert(authoredWorldTool(t));assert.equal(t.card.rockPreset,undefined);assert.equal(t.card.groundPreset,undefined);assert.equal(result.rocks[0].slot,8);assert.equal(t.rock,result.rocks[0].worldKey);assert.equal(t.ground.graph.seed,graph.seed);
 assert.deepEqual(t.card.along,[[0,1],[1,.5]]);assert.equal(JSON.stringify([base,rocks,added.materials]),before);
 const newMap=instantiateWorldKit(config,result.kit);assert.equal(worldToolUnavailable(t,newMap.rocks,newMap.materials,config),'');
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
 assert.throws(()=>worldKit(config,{tools:[{id:'unknown',label:'Unknown',icon:'hill',color:'#778899',group:'shape',shape:'hill'}]}),/complete card/);
 assert.throws(()=>worldKit(config,{tools:[tool({id:'hill'})]}),/world- ids/);
 const missing=instantiateWorldKit(config,{rocks:[template('wrock-test',{material:{world:'worldSlope'}})]});
 assert.deepEqual(missing.rocks,[]);assert.deepEqual(missing.unbound,['wrock-test']);assert.match(missing.reason,/material role/);
});

test('carried source ownership cannot overwrite a disagreeing destination catalog',()=>{
 const source=world(),fresh=instantiateWorldKit(config,source),destination={...source,rocks:[template('wrock-stone',{knobs:{faceWhole:.2}})]};
 const carried=instantiateWorldKit(config,destination,{rocks:fresh.rocks,materials:fresh.materials,source});
 assert.equal(carried.rocks[0].knobs.faceWhole,.8);assert.equal(carried.rocks[0].worldKey,undefined);
 assert.equal(carried.rocks[1].worldKey,'wrock-stone');assert.equal(carried.rocks[1].knobs.faceWhole,.2);
 assert.equal(captureWorldKit(carried.kit,carried.rocks,carried.materials).kit.rocks[0].knobs.faceWhole,.2);
});
test('a rejected inline graph binding never publishes the colliding map graph',()=>{
 const w=world(),added=addMaterial(worldMaterials(config),{...graph,seed:42},'Stone grain'),materials=added.materials.map(m=>m.slot===added.slot?{...m,key:'wmat-stone'}:m);
 const rejected=instantiateWorldKit(config,w,{rocks:[],materials,source:{}});
 assert.deepEqual(rejected.unbound,['wrock-stone']);
 const captured=captureWorldKit(rejected.kit,rejected.rocks,rejected.materials);
 assert.equal(captured.kit.rocks[0].material.graph.seed,0);assert.equal(materials.at(-1).seed,42);
});
test('tools-only kits bind their ground on a legacy map and preserve dirty graph edits without a registry',()=>{
 const ref={key:'wmat-ground',name:'Ground grain',graph},w={tools:[tool({ground:ref})]},materials=worldMaterials(config);
 const result=instantiateWorldKit(config,w,{rocks:[],materials,source:{}});
 const added=result.materials.find(m=>m.key===ref.key);assert(added);assert.deepEqual(result.rocks,[]);
 const changed=result.materials.map(m=>m===added?{...m,seed:27}:m),dirty=captureWorldKit(result.kit,result.rocks,changed,{before:result.materials});
 assert.equal(dirty.kit.tools[0].ground.graph.seed,27);
 assert.equal(captureWorldKit(dirty.kit,result.rocks,changed).kit.tools[0].ground.graph.seed,27);
 const collision=result.materials.map(m=>m===added?{...m,seed:39}:m),rejected=instantiateWorldKit(config,w,{rocks:[],materials:collision,source:{}});
 assert.match(rejected.reason,/edited material/);assert.equal(captureWorldKit(rejected.kit,[],collision).kit.tools[0].ground.graph.seed,0);
});

test('kit object/card key order is canonical, while toolbar order remains meaningful',()=>{
 const w=world(),reorder=v=>Array.isArray(v)?v.map(reorder):v&&typeof v==='object'?Object.fromEntries(Object.keys(v).reverse().map(k=>[k,reorder(v[k])])):v;
 assert(sameKitData(worldKit(config,w),worldKit(config,reorder(w))));
 assert(!sameKitData(worldKit(config,w),worldKit(config,{...w,tools:[...w.tools].reverse()})));
 const absent=instantiateWorldKit(config,{tools:[tool({rock:'wrock-test'})],rocks:[template('wrock-test',{material:{world:'worldSlope'}})]});
 assert.match(worldToolUnavailable(absent.kit.tools[0],absent.rocks,absent.materials,config,absent.kit),/slope cover material is missing/);
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
test('Reset restores marked base types at their slots and leaves custom/local map content intact',()=>{
 const base=instantiateWorldKit(config),soil=base.rocks.find(r=>r.worldKey==='soil'),custom={slot:8,key:'wrock-custom',worldKey:'wrock-custom',name:'Custom',knobs:{faceWhole:.3},column:null,colors:null},local={slot:9,key:'greenstone',name:'Local greenstone',knobs:{faceWhole:.6},column:null,colors:null};
 const rocks=[{...soil,slot:7,knobs:{faceRock:.9}},custom,local],kit={tools:base.kit.tools,rocks:[...base.kit.rocks,{...template('wrock-custom'),name:'Custom',knobs:custom.knobs,material:{world:'worldRock'}}]},before=JSON.stringify([rocks,base.materials]);
 const reset=resetWorldKitInstances(config,kit,rocks,base.materials);
 assert.equal(reset.rocks[0].slot,7);assert.equal(reset.rocks[0].worldKey,'soil');assert.equal(reset.rocks[0].knobs.faceRock,0);
 assert.equal(reset.rocks[1].worldKey,undefined);assert.equal(reset.rocks[1].knobs.faceWhole,.3);assert.deepEqual(reset.rocks[2],local);assert.equal(JSON.stringify([rocks,base.materials]),before);
});
test('an explicit instance can recover its original world identity after capacity is freed',()=>{
 const w=world(),full=Array.from({length:15},(_,i)=>({slot:i+1,key:null,name:'Local '+i,knobs:{},column:null,colors:null})),rejected=instantiateWorldKit(config,w,{rocks:full,materials:worldMaterials(config),source:{}});
 assert.deepEqual(rejected.unbound,['wrock-stone']);
 const added=addWorldRockInstance(w.rocks[0],full.slice(0,-1),rejected.materials),bound=added.rocks.map(r=>r.slot===added.slot?{...r,worldKey:w.rocks[0].key}:r);
 assert.equal(worldToolUnavailable(w.tools[1],bound,added.materials,config,worldKit(config,w)),'');assert.equal(resolvedWorldCard(w.tools[1],bound,added.materials,config).rockPreset,15);
});


test('later World material edits preflight uninstantiated dependencies against a fresh map atomically',()=>{
 const c={...config,materials:{...config.materials,high:'green-rock'}},base=worldMaterials(c);
 assert.equal(base.length,4);
 const w={tools:config.tools,rocks:[template('wrock-role',{material:{world:'worldRock'}}),...Array.from({length:14},(_,i)=>template('wrock-extra'+i,{name:'Extra '+i,material:{key:'wmat-extra'+i,name:'Extra grain '+i,graph:copyMaterial(graph)}}))]};
 assert.equal(instantiateWorldKit(c,w).materials.length,18);
 const full=[{slot:1,key:'wrock-role',worldKey:'wrock-role',name:'Stone',knobs:{faceWhole:.8},column:null,colors:null},...Array.from({length:14},(_,i)=>({slot:i+2,key:null,name:'Local '+i,knobs:{},column:null,colors:null}))],current=instantiateWorldKit(c,w,{rocks:full,materials:base,source:w});
 assert.equal(current.materials.length,4);assert.equal(current.rocks.length,15);
 const added=addMaterial(current.materials,graph,'Private stone'),rocks=current.rocks.map(r=>r.slot===1?{...r,material:added.slot}:r),before=JSON.stringify([w,current]);
 assert.throws(()=>stageWorldKitEdit(c,w,rocks,added.materials,{before:current.materials}),/material cache budget/i);
 assert.equal(JSON.stringify([w,current]),before);
});
