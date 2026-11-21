// A world's tool and rock kit: the built-in world's tools and rock catalog (from its config), and the tools and rock types an earlier build
// kept in a world of your own, which opening a map makes the map's (mapOwnedKit; owner, 2026-11-19: everything lives with the map).
// Material dependencies are ordinary validated graphs inline, or references to the existing world roles/layers.
import {checkTool,storedCard,worldTools,shapeGone,toolShape,copyMapTools,addMapTool,MAP_TOOLS_MAX} from './sculpt-tools.js';
import {shapeFrom} from './sculpt-scene.js';
import {copyRocks,worldRocks,giveRockMaterials,ROCK_SLOTS} from './sculpt-rock-presets.js';
import {copyMaterial,copyMaterials,addMaterial,worldMaterials,worldOwnMaterials,worldKey,roleName,MAP_ROLES,MATERIAL_SLOTS,materialStates,materialStaged,materialCacheUsage} from './sculpt-materials.js';

import {orderedText} from './sculpt-share.js';

export const sameKitData=(a,b)=>orderedText(a)===orderedText(b);
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
  // An authored tool whose card holds a setting of the wrong kind is left out (storedCard), not the whole world.
  return value.flatMap(t=>{
    fields(t,['id','label','icon','color','group','shape','help','family','rock','material','card','ground'],'world tool');
    checkTool(t,'The world’s tool',s=>shapeFrom(config,s));
    if(ids.has(t.id)||/^map-/.test(t.id))throw Error('World tools need unique ids, separate from map tools.');ids.add(t.id);
    const [base]=worldTools({...config,tools:[t]});
    if(t.card!==undefined){
      if(native.has(t.id)||!/^world-[a-z0-9_-]+$/.test(t.id)||++own>MAP_TOOLS_MAX)throw Error(`A world holds at most ${MAP_TOOLS_MAX} authored tools, with world- ids.`);
      const card=storedCard(t.card,'The world’s tool');if(!card)return [];
      if(card.rockPreset>0||card.groundPreset>0)throw Error('A world tool carries rock and material references, not map slots.');
      return [{...base,card,...(t.ground!==undefined?{ground:copyMaterialRef(t.ground)}:{})}];
    }
    if(!native.has(t.id))throw Error('An authored world tool needs a world- id and its complete card.');
    if(t.ground!==undefined)throw Error('A portable ground reference belongs to an authored world tool.');
    return [base];
  });
}
function baseRocks(config){
  const rocks=worldRocks(config),given=giveRockMaterials(rocks,worldMaterials(config),rocks.map(r=>r.slot),config);
  return given.rocks.map(r=>{const m=given.materials.find(m=>m.slot===r.material),ref=m?referenceForMaterial(m.slot,given.materials,{key:'kit-'+(m.source??r.key).slice(0,70)}).ref:{world:'worldRock'};
    return {key:r.key,name:r.name,knobs:r.knobs,column:r.column,colors:r.colors,material:ref};});
}
// The world's built-in tools always come from its config, so a later config (a tool removed, renamed or added) reaches every world;
// a stored list contributes only the tools the artist authored (with a card). Entries without a card carry nothing of the artist's.
export function worldKit(config,world={}){
  if(!object(world))throw Error('Invalid world kit.');
  if(world.tools!==undefined&&!Array.isArray(world.tools))throw Error('A world’s tools are a list.');
  const authored=(world.tools??[]).filter(t=>object(t)&&t.card!==undefined&&!shapeGone(t,s=>shapeFrom(config,s)));   // a removed library shape drops the tool
  const kit={tools:copyWorldTools([...(config.tools??[]),...authored],config),rocks:copyWorldRocks(world.rocks===undefined?baseRocks(config):world.rocks)};
  const keys=new Set(kit.rocks.map(r=>r.key)),inline=new Map();
  for(const tool of kit.tools)if(authoredWorldTool(tool)&&tool.rock&&!keys.has(tool.rock))throw Error(`The world tool ${tool.label} names a rock type its world does not carry.`);
  for(const ref of [...kit.rocks.map(r=>r.material),...kit.tools.map(t=>t.ground)].filter(Boolean))if(!ref.world){const text=JSON.stringify([ref.name,ref.graph]);if(inline.has(ref.key)&&inline.get(ref.key)!==text)throw Error('Two material dependencies disagree about the same key.');inline.set(ref.key,text);}
  return kit;
}
// What a world record, a map's embedded world and a world file store: the tools the artist authored, and the rock catalog only where it
// differs from the one the config derives. The derived defaults stay derived, so library and config revisions reach the world.
export function storedWorldKit(config,world={}){
  const kit=worldKit(config,world),tools=kit.tools.filter(authoredWorldTool);
  return {...(tools.length?{tools}:{}),...(world.rocks!==undefined&&!same(kit.rocks,worldKit(config).rocks)?{rocks:kit.rocks}:{})};
}
export const optionalWorldKit=(world,config)=>storedWorldKit(config,world);
// A built-in world's own rock types (its config's) are the map's: editing or deleting one on a map never changes the world. Only an earlier
// build's world kept rock types of its own (mapOwnedKit turns them into the map's).
export const baseRockKeys=config=>new Set(worldRocks(config).map(r=>r.key));
const worldOwned=(key,builtIn,config)=>!(builtIn&&baseRockKeys(config).has(key));
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
export function instantiateWorldKit(config,world={}, {rocks=null,materials=null,source=world,append=true,builtIn=false}={}){
  const kit=worldKit(config,world),fresh=rocks==null;
  let nextMaterials=materials==null?worldMaterials(config):copyMaterials(materials),nextRocks=fresh?[]:validateWorldRocks(rocks,nextMaterials,{rocks:copyWorldRocks(source.rocks===undefined?baseRocks(config):source.rocks)});
  if(!fresh)nextRocks=validateWorldRocks(nextRocks,nextMaterials,kit).map(r=>r.worldKey&&!worldOwned(r.worldKey,builtIn,config)?(({worldKey:_,...local})=>local)(r):r);   // carrying to another world may turn a source-owned type into a local copy
  // In a world of your own, a carried map's copy of a built-in type that still agrees with the world's becomes its instance (a map made in the
  // built-in world kept its types as its own). A copy that disagrees, renamed or edited, stays the map's.
  if(!fresh&&!builtIn){const base=baseRockKeys(config),claimed=new Set(nextRocks.map(r=>r.worldKey).filter(Boolean));
    nextRocks=nextRocks.map(r=>{const t=!r.worldKey&&base.has(r.key)&&!claimed.has(r.key)?kit.rocks.find(t=>t.key===r.key):null;if(!t||!agrees(r,t,nextMaterials))return r;claimed.add(r.key);return {...r,worldKey:r.key};});}
  const missing=(fresh||append&&world.rocks!==undefined)?kit.rocks.filter(t=>!nextRocks.some(r=>r.worldKey===t.key)&&(fresh||worldOwned(t.key,builtIn,config))):[];
  const candidate=structuredClone(nextRocks),unbound=[];let staged=nextMaterials;
  try{
    for(const t of missing){let slot=1;while(candidate.some(r=>r.slot===slot))slot++;if(slot>=ROCK_SLOTS)throw Error('This map’s 15 rock slots are full.');
      const bound=bindMaterial(t.material,staged);if(bound.missing){unbound.push(t.key);continue;}staged=bound.materials;
      candidate.push({slot,key:candidate.some(r=>r.key===t.key)?null:t.key,...(worldOwned(t.key,builtIn,config)?{worldKey:t.key}:{}),name:t.name,knobs:structuredClone(t.knobs),column:structuredClone(t.column),colors:structuredClone(t.colors),...(bound.slot?{material:bound.slot}:{})});
    }
    // Ground materials published by tools are ordinary map materials too; role refs allocate nothing.
    for(const t of kit.tools)if(t.ground)staged=bindMaterial(t.ground,staged).materials;
    assertKitMaterials(staged);nextRocks=candidate;nextMaterials=staged;
  }catch(error){if(fresh)throw error;return {kit,rocks:nextRocks,materials:nextMaterials,unbound:missing.map(r=>r.key),reason:error.message};}
  return {kit,rocks:nextRocks,materials:nextMaterials,unbound,...(unbound.length?{reason:'A world rock type needs a material role this world does not have.'}:{})};
}
// A world tool's rock: the world-owned instance, else (a built-in world's own type, which stays the map's) the map's type of that key.
const toolRock=(key,rocks,config)=>rocks.find(r=>r.worldKey===key)??(baseRockKeys(config).has(key)?rocks.find(r=>!r.worldKey&&r.key===key):undefined);
export function resolvedWorldCard(tool,rocks,materials,config){
  const card=structuredClone(tool.card),rock=tool.rock;
  if(rock!==undefined){const r=toolRock(rock,rocks,config);card.rockPreset=r?.slot??-1;}
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
  if(tool.rock&&!toolRock(tool.rock,rocks,config)){
    const reason=refReason(kit.rocks.find(r=>r.key===tool.rock)?.material);if(reason)return reason;
    return rocks.length>=ROCK_SLOTS-1?'This map’s 15 rock slots are full.':'Add this tool’s world rock type to this map before drawing with it.';
  }
  if(tool.ground&&!materialRefSlot(tool.ground,materials))return refReason(tool.ground)||'This map cannot allocate this tool’s material within its material budget.';
  return '';
}
// An explicit Add/Clone uses the same portable template but allocates only its requested instance; it does not adopt other catalog entries.
export function addWorldRockInstance(template,rocks,materials){
  const [t]=copyWorldRocks([template]);let slot=1;while(rocks.some(r=>r.slot===slot))slot++;if(slot>=ROCK_SLOTS)throw Error('This map’s 15 rock slots are full.');
  const bound=bindMaterial(t.material,materials);if(bound.missing)throw Error('The world material this rock type needs is missing.');assertKitMaterials(bound.materials);
  const r={slot,key:rocks.some(r=>r.key===t.key)?null:t.key,name:t.name,knobs:t.knobs,column:t.column,colors:t.colors,...(bound.slot?{material:bound.slot}:{})};
  return {slot,rocks:[...rocks,r],materials:bound.materials};
}


// A save of an earlier build, its kit made the map's own (owner, 2026-11-19: everything lives with the map): each tool its world authored
// becomes a map tool (its rock and ground as the save's slots; strokes, brush cards and the chosen tool follow its new id), and no rock
// type keeps a world's provenance. `config`: the save's own world. Returns the save and how many world tools did not fit.
export function mapOwnedKit(s,config){
  const world=s?.worldSettings;
  if(!object(world)||(world.tools===undefined&&world.rocks===undefined&&!(s.rocks??[]).some(r=>r?.worldKey)))return {sketch:s,lost:0};
  let authored=[];try{authored=worldKit(config,world).tools.filter(authoredWorldTool);}catch(_){}
  let own=copyMapTools(s.tools)??[],nodes=s.nodes??[],settings={...(s.toolSettings??{})},tool=s.tool,lost=0;
  const rocks=copyRocks(s.rocks)??[],materials=copyMaterials(s.materials)??[];
  for(const t of authored){
    if(own.length>=MAP_TOOLS_MAX){lost++;continue;}
    try{const added=addMapTool(own,nodes,{label:t.label,icon:t.icon,color:t.color,group:t.group,shape:shapeFrom(config,toolShape(t)),card:resolvedWorldCard(t,rocks,materials,config)});
      own=added.tools;nodes=nodes.map(n=>n?.tool===t.id?{...n,tool:added.id}:n);if(settings[t.id]){settings[added.id]=settings[t.id];delete settings[t.id];}if(tool===t.id)tool=added.id;}
    catch(_){lost++;}
  }
  const {tools:_t,rocks:_r,...kept}=world;
  return {sketch:{...s,worldSettings:kept,nodes,toolSettings:settings,tool,...(own.length?{tools:own}:{}),...(s.rocks?{rocks:rocks.map(({worldKey:_,...r})=>r)}:{})},lost};
}
