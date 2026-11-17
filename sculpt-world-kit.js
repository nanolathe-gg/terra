// A world's tool and rock kit is portable data. Maps keep their own numeric slots; only explicit worldKey provenance makes a runtime
// rock a World edit. Material dependencies are ordinary validated graphs inline, or references to the existing world roles/layers.
import {checkTool,checkCard,worldTools,MAP_TOOLS_MAX} from './sculpt-tools.js';
import {shapeFrom} from './sculpt-scene.js';
import {copyRocks,worldRocks,giveRockMaterials,ROCK_SLOTS} from './sculpt-rock-presets.js';
import {copyMaterial,copyMaterials,addMaterial,setMaterial,worldMaterials,worldKey,roleName,MAP_ROLES,MATERIAL_SLOTS,materialStates,materialStaged,materialCacheUsage} from './sculpt-materials.js';

const ordered=v=>Array.isArray(v)?v.map(ordered):v&&typeof v==='object'?Object.fromEntries(Object.keys(v).sort().map(k=>[k,ordered(v[k])])):v;
export const sameKitData=(a,b)=>JSON.stringify(ordered(a))===JSON.stringify(ordered(b));
const same=sameKitData,object=v=>v&&typeof v==='object'&&!Array.isArray(v);
const KEY=/^[a-z][a-z0-9_-]{0,39}$/,roles=new Set(['worldGround','worldWater',...MAP_ROLES.map(([r])=>r)]);
const fields=(v,allowed,what)=>{if(!object(v)||Object.keys(v).some(k=>!allowed.includes(k)))throw Error(`Invalid ${what}.`);};
const name=(v,what,max=40)=>{if(typeof v!=='string'||!v.trim()||v.trim().length>max)throw Error(`${what} needs a name of 1 to ${max} characters.`);return v.trim();};
export const newWorldKey=prefix=>prefix+'-'+crypto.randomUUID().replaceAll('-','').slice(0,20);
export const authoredWorldTool=t=>Boolean(t?.card&&t.id?.startsWith('world-'));
export function copyMaterialRef(value){
  if(object(value)&&Object.hasOwn(value,'world')){fields(value,['world'],'world material reference');if(typeof value.world!=='string'||(!roles.has(value.world)&&!/^layer:.{1,80}$/.test(value.world)))throw Error('Unknown world material reference.');return {world:value.world};}
  fields(value,['key','name','graph'],'material dependency');
  if(typeof value.key!=='string'||!value.key||value.key.length>80)throw Error('A material dependency needs its own key.');
  return {key:value.key,name:name(value.name,'A material',80),graph:copyMaterial(value.graph)};
}
export function referenceForMaterial(slot,materials,{world='worldRock',key}={}){
  if(!(slot>0))return {ref:{world},materials};
  const m=materials.find(m=>m.slot===slot);if(!m)throw Error('The material to carry is missing.');
  const role=worldKey(m);if(role)return {ref:{world:role},materials};
  const id=m.key??key??newWorldKey('wmat');
  return {ref:{key:id,name:m.name,graph:copyMaterial(m)},materials:m.key===id?materials:materials.map(o=>o===m?{...o,key:id}:o)};
}
export function copyWorldRocks(value){
  if(!Array.isArray(value)||value.length>=ROCK_SLOTS)throw Error('A world holds at most 15 rock types besides its default rock.');
  const keys=new Set();
  return value.map((r,i)=>{
    fields(r,['key','name','knobs','column','colors','material'],'world rock type');
    if(typeof r.key!=='string'||!KEY.test(r.key)||keys.has(r.key))throw Error('World rock types need unique permanent keys.');keys.add(r.key);
    const [rock]=copyRocks([{slot:i+1,name:r.name,key:r.key,knobs:r.knobs,column:r.column,colors:r.colors}]);
    return {key:r.key,name:rock.name,knobs:rock.knobs,column:rock.column,colors:rock.colors,...(r.material!==undefined?{material:copyMaterialRef(r.material)}:{})};
  });
}
export function copyWorldTools(value,config){
  if(!Array.isArray(value))throw Error('A world’s tools are a list.');
  const ids=new Set(),native=new Set((config.tools??[]).map(t=>t.id));let own=0;
  return value.map(t=>{
    fields(t,['id','label','icon','color','group','shape','help','family','rock','material','card','ground'],'world tool');
    checkTool(t,'The world’s tool',s=>shapeFrom(config,s));
    if(ids.has(t.id)||/^map-/.test(t.id))throw Error('World tools need unique ids, separate from map tools.');ids.add(t.id);
    const [base]=worldTools({...config,tools:[t]});
    if(t.card!==undefined){
      if(native.has(t.id)||!/^world-[a-z0-9_-]+$/.test(t.id)||++own>MAP_TOOLS_MAX)throw Error(`A world holds at most ${MAP_TOOLS_MAX} authored tools, with world- ids.`);
      const card=checkCard(t.card,'The world’s tool');
      if(card.rockPreset>0||card.groundPreset>0)throw Error('A world tool carries rock and material references, not map slots.');
      return {...base,card,...(t.ground!==undefined?{ground:copyMaterialRef(t.ground)}:{})};
    }
    if(!native.has(t.id))throw Error('An authored world tool needs a world- id and its complete card.');
    if(t.ground!==undefined)throw Error('A portable ground reference belongs to an authored world tool.');
    return base;
  });
}
function baseRocks(config){
  const rocks=worldRocks(config),given=giveRockMaterials(rocks,worldMaterials(config),rocks.map(r=>r.slot),config);
  return given.rocks.map(r=>{const m=given.materials.find(m=>m.slot===r.material),ref=m?referenceForMaterial(m.slot,given.materials,{key:'kit-'+(m.source??r.key).slice(0,70)}).ref:{world:'worldRock'};
    return {key:r.key,name:r.name,knobs:r.knobs,column:r.column,colors:r.colors,material:ref};});
}
export function worldKit(config,world={}){
  if(!object(world))throw Error('Invalid world kit.');
  const kit={tools:copyWorldTools(world.tools===undefined?(config.tools??[]):world.tools,config),rocks:copyWorldRocks(world.rocks===undefined?baseRocks(config):world.rocks)};
  const keys=new Set(kit.rocks.map(r=>r.key)),inline=new Map();
  for(const tool of kit.tools)if(authoredWorldTool(tool)&&tool.rock&&!keys.has(tool.rock))throw Error(`The world tool ${tool.label} names a rock type its world does not carry.`);
  for(const ref of [...kit.rocks.map(r=>r.material),...kit.tools.map(t=>t.ground)].filter(Boolean))if(!ref.world){const text=JSON.stringify([ref.name,ref.graph]);if(inline.has(ref.key)&&inline.get(ref.key)!==text)throw Error('Two material dependencies disagree about the same key.');inline.set(ref.key,text);}
  return kit;
}
export function optionalWorldKit(world,config){
  const kit=worldKit(config,world);
  return {...(world.tools!==undefined?{tools:kit.tools}:{}),...(world.rocks!==undefined?{rocks:kit.rocks}:{})};
}
export function materialRefSlot(ref,materials){
  if(!ref)return 0;
  const m=ref.world?materials.find(m=>worldKey(m)===ref.world):materials.find(m=>m.key===ref.key&&m.name===ref.name&&same(copyMaterial(m),ref.graph));
  return m?.slot??0;
}
function bindMaterial(ref,materials){
  if(!ref||ref.world){const slot=materialRefSlot(ref,materials);return {slot,materials,missing:Boolean(ref?.world&&ref.world!=='worldRock'&&!slot)};}
  const held=materials.find(m=>m.key===ref.key);
  if(held){if(held.name!==ref.name||!same(copyMaterial(held),ref.graph))throw Error(`This map has an edited material with the key for ${ref.name}; its copy was kept.`);return {slot:held.slot,materials};}
  const added=addMaterial(materials,ref.graph,ref.name);
  return {slot:added.slot,materials:added.materials.map(m=>m.slot===added.slot?{...m,key:ref.key,name:ref.name}:m)};
}
export function assertKitMaterials(materials){
  const list=copyMaterials(materials),layers=list.reduce((n,m)=>n+1+materialStates(m).length,0);
  if(!materialCacheUsage(layers,undefined,list.some(materialStaged)).fits)throw Error('The world’s material dependencies exceed the material cache budget.');
  return list;
}
function templateOf(r,materials,key=r.worldKey??r.key){
  const ref=referenceForMaterial(r.material,materials);
  return {rock:{key,name:r.name,knobs:structuredClone(r.knobs),column:structuredClone(r.column??null),colors:structuredClone(r.colors??null),material:ref.ref},materials:ref.materials};
}
function agrees(r,template,materials){
  if(r.name!==template.name||!same(r.knobs,template.knobs)||!same(r.column??null,template.column??null)||!same(r.colors??null,template.colors??null))return false;
  const ref=template.material??{world:'worldRock'};
  if(ref.world){const actual=r.material>0?materials.find(m=>m.slot===r.material):materials.find(m=>m.worldRock);return actual?worldKey(actual)===ref.world:ref.world==='worldRock'&&!(r.material>0);}
  return materialRefSlot(ref,materials)===r.material;
}
// Loaded tables win. Equality is checked only here, never while an artist edits an established world-owned type.
export function validateWorldRocks(rocks,materials,sourceKit){
  const catalog=new Map(sourceKit.rocks.map(r=>[r.key,r])),seen=new Set();
  return copyRocks(rocks).map(r=>{if(!r.worldKey)return r;if(seen.has(r.worldKey))throw Error('Two map rock types claim the same world type.');seen.add(r.worldKey);
    const template=catalog.get(r.worldKey);if(template&&agrees(r,template,materials))return r;const {worldKey:_,...local}=r;return local;});
}
export function instantiateWorldKit(config,world={}, {rocks=null,materials=null,source=world,append=true}={}){
  const kit=worldKit(config,world),fresh=rocks==null;
  let nextMaterials=materials==null?worldMaterials(config):copyMaterials(materials),nextRocks=fresh?[]:validateWorldRocks(rocks,nextMaterials,{rocks:copyWorldRocks(source.rocks===undefined?baseRocks(config):source.rocks)});
  if(!fresh)nextRocks=validateWorldRocks(nextRocks,nextMaterials,kit);   // carrying to another world may turn a source-owned type into a local copy
  const missing=(fresh||append&&world.rocks!==undefined)?kit.rocks.filter(t=>!nextRocks.some(r=>r.worldKey===t.key)):[];
  const candidate=structuredClone(nextRocks),unbound=[];let staged=nextMaterials;
  try{
    for(const t of missing){let slot=1;while(candidate.some(r=>r.slot===slot))slot++;if(slot>=ROCK_SLOTS)throw Error('This map’s 15 rock slots are full.');
      const bound=bindMaterial(t.material,staged);if(bound.missing){unbound.push(t.key);continue;}staged=bound.materials;
      candidate.push({slot,key:candidate.some(r=>r.key===t.key)?null:t.key,worldKey:t.key,name:t.name,knobs:structuredClone(t.knobs),column:structuredClone(t.column),colors:structuredClone(t.colors),...(bound.slot?{material:bound.slot}:{})});
    }
    // Ground materials published by tools are ordinary map materials too; role refs allocate nothing.
    for(const t of kit.tools)if(t.ground)staged=bindMaterial(t.ground,staged).materials;
    assertKitMaterials(staged);nextRocks=candidate;nextMaterials=staged;
  }catch(error){if(fresh)throw error;return {kit,rocks:nextRocks,materials:nextMaterials,unbound:missing.map(r=>r.key),reason:error.message};}
  return {kit,rocks:nextRocks,materials:nextMaterials,unbound,...(unbound.length?{reason:'A world rock type needs a material role this world does not have.'}:{})};
}
export function resolvedWorldCard(tool,rocks,materials,config){
  const card=structuredClone(tool.card),rock=tool.rock;
  if(rock!==undefined){const r=rocks.find(r=>r.worldKey===rock);card.rockPreset=r?.slot??-1;}
  if(tool.ground){const slot=materialRefSlot(tool.ground,materials);card.groundPreset=slot?(materials.find(m=>m.slot===slot)?.worldGround?0:slot):-1;}
  return card;
}
export function worldToolUnavailable(tool,rocks,materials,config,kit={rocks:[]}){
  if(!authoredWorldTool(tool))return '';
  const refReason=ref=>{
    if(ref?.world&&!materialRefSlot(ref,materials)&&ref.world!=='worldRock')return `The world’s ${ref.world.startsWith('layer:')?'surface layer':roleName(ref.world)} material is missing.`;
    if(ref?.key){const held=materials.find(m=>m.key===ref.key);if(held&&!materialRefSlot(ref,materials))return `This map keeps a different copy of ${ref.name}.`;}
    return '';
  };
  if(tool.rock&&!rocks.some(r=>r.worldKey===tool.rock)){
    const reason=refReason(kit.rocks.find(r=>r.key===tool.rock)?.material);if(reason)return reason;
    return rocks.length>=ROCK_SLOTS-1?'This map’s 15 rock slots are full.':'Add this tool’s world rock type to this map before drawing with it.';
  }
  if(tool.ground&&!materialRefSlot(tool.ground,materials))return refReason(tool.ground)||'This map cannot allocate this tool’s material within its material budget.';
  return '';
}
// Capture only explicit world-owned instances. Unbound catalog entries survive; no recipe-key lookup publishes a local map copy.
export function captureWorldKit(kit,rocks,materials,{before=materials}={}){
  let next=materials;const bound=new Set();
  const catalog=kit.rocks.map(t=>{const r=rocks.find(r=>r.worldKey===t.key);if(!r)return structuredClone(t);const captured=templateOf(r,next,t.key);next=captured.materials;if(captured.rock.material?.key)bound.add(captured.rock.material.key);return captured.rock;});
  // A prior binding proves a tool's inline ground is world-owned before an artist's graph edit. Rejected adoption/key collisions prove
  // nothing, so an unrelated map graph can never be published merely because its key is the same. No persistent binding registry is kept.
  for(const t of kit.tools)if(t.ground?.key&&materialRefSlot(t.ground,before))bound.add(t.ground.key);
  const refresh=ref=>{if(!ref?.key||!bound.has(ref.key))return ref;const m=next.find(m=>m.key===ref.key);return m?{key:ref.key,name:m.name,graph:copyMaterial(m)}:ref;};
  return {kit:{rocks:catalog.map(r=>({...r,...(r.material?{material:refresh(r.material)}:{})})),tools:kit.tools.map(t=>({...structuredClone(t),...(t.ground?{ground:refresh(t.ground)}:{})}))},materials:next};
}
export function publishWorldRock(kit,rocks,materials,slot){
  const from=rocks.find(r=>r.slot===slot);if(!from)throw Error('Choose a rock type to save.');
  const key=from.worldKey&&kit.rocks.some(r=>r.key===from.worldKey)?from.worldKey:newWorldKey('wrock');
  const captured=templateOf(from,materials,key),held=kit.rocks.some(r=>r.key===key),next=held?kit.rocks.map(r=>r.key===key?captured.rock:r):[...kit.rocks,captured.rock];copyWorldRocks(next);
  return {kit:{...kit,rocks:next},rocks:rocks.map(r=>r===from?{...r,worldKey:key}:r),materials:captured.materials,key};
}
export function publishWorldTool(kit,rocks,materials,tool){
  let nextKit=structuredClone(kit),nextRocks=rocks,nextMaterials=materials;
  const card=checkCard(tool.card,'The world’s tool'),entry={...tool,id:newWorldKey('world'),card:{...card,preset:'custom'}};
  if(card.rockPreset>0){const result=publishWorldRock(nextKit,nextRocks,nextMaterials,card.rockPreset);nextKit=result.kit;nextRocks=result.rocks;nextMaterials=result.materials;entry.rock=result.key;delete entry.card.rockPreset;}
  if(card.groundPreset>0){const captured=referenceForMaterial(card.groundPreset,nextMaterials,{world:'worldGround'});entry.ground=captured.ref;nextMaterials=captured.materials;delete entry.card.groundPreset;}
  nextKit.tools.push(entry);
  return {kit:nextKit,rocks:nextRocks,materials:nextMaterials,id:entry.id};
}
// An explicit Add/Clone uses the same portable template but allocates only its requested instance; it does not adopt other catalog entries.
export function addWorldRockInstance(template,rocks,materials){
  const [t]=copyWorldRocks([template]);let slot=1;while(rocks.some(r=>r.slot===slot))slot++;if(slot>=ROCK_SLOTS)throw Error('This map’s 15 rock slots are full.');
  const bound=bindMaterial(t.material,materials);if(bound.missing)throw Error('The world material this rock type needs is missing.');assertKitMaterials(bound.materials);
  const r={slot,key:rocks.some(r=>r.key===t.key)?null:t.key,name:t.name,knobs:t.knobs,column:t.column,colors:t.colors,...(bound.slot?{material:bound.slot}:{})};
  return {slot,rocks:[...rocks,r],materials:bound.materials};
}

// Reset changes only explicitly World-owned base instances, at their existing slots. Custom types become local copies so map content survives.
export function resetWorldKitInstances(config,kit,rocks,materials){
  const base=worldKit(config),catalog=new Map(base.rocks.map(r=>[r.key,r])),owned=new Set();let next=copyMaterials(materials);
  for(const r of rocks)if(r.worldKey){const ref=kit.rocks.find(t=>t.key===r.worldKey)?.material;if(ref?.key&&r.material>0&&next.find(m=>m.slot===r.material)?.key===ref.key)owned.add(ref.key);}
  const result=copyRocks(rocks).map(r=>{
    if(!r.worldKey)return r;const t=catalog.get(r.worldKey);if(!t){const {worldKey:_,...local}=r;return local;}
    if(t.material?.key){const held=next.find(m=>m.key===t.material.key);if(held&&!materialRefSlot(t.material,next)){
      if(!owned.has(t.material.key))throw Error(`Reset kept this map’s different copy of ${t.material.name}; remove the conflicting map material before resetting.`);
      next=setMaterial(next,held.slot,t.material.graph).map(m=>m.slot===held.slot?{...m,name:t.material.name}:m);
    }}
    const bound=bindMaterial(t.material,next);if(bound.missing)throw Error('A base world rock needs a missing material.');next=bound.materials;
    const {material:_,...rest}=r;return {...rest,name:t.name,knobs:structuredClone(t.knobs),column:structuredClone(t.column),colors:structuredClone(t.colors),...(bound.slot?{material:bound.slot}:{})};
  });assertKitMaterials(next);return {kit:base,rocks:result,materials:next};
}
