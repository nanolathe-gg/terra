import {withWorldMaterials,worldKept,worldOwnFor} from './sculpt-materials.js';
// The map carries its effective world settings, including defaults, URL overrides and the world's ground and water materials.
// Keep browser/session parameters out of the recipe; removed controls are dropped on load.
import {KNOBS} from './sculpt-knobs.js';
import {worldHexColors,isTone} from './sculpt-scene.js';
import {copySurface} from './sculpt-material-model.js';

const worldKeys=config => new Set([...Object.keys(config.defaults||{}),...Object.keys(config.engineDefaults||{}),...KNOBS.flatMap(([,rows])=>rows.map(([key])=>key)),'beachFrom','sandEdge','view','fill','relief','palette','sun']);
export function savedWorld(config,settings,world) {
  const knobs={};
  for(const key of worldKeys(config)){const value=settings.get(key)??world.knobs?.[key]??config.defaults?.[key]??config.engineDefaults?.[key];if(value!==undefined&&value!==null)knobs[key]=String(value);}
  // The world's surface layers where the artist changed them (docs/SURFACE_LAYERS.md); a world that kept its own carries none.
  return {materials:worldKept(withWorldMaterials(world.materials,config)),name:world.name||config.biome,base:config.biomeId,colors:worldHexColors(config,settings,world.colors||{}),knobs,...(world.surface?{surface:copySurface(world.surface)}:{})};
}
export function copySavedWorld(value,config) {
  if(value===undefined)return null;
  if(!value||value.base!==config.biomeId||typeof value.name!=='string'||!value.colors||Array.isArray(value.colors)||typeof value.colors!=='object'||!value.knobs||Array.isArray(value.knobs)||typeof value.knobs!=='object')throw Error('The saved world settings are invalid.');
  const keys=worldKeys(config),knobs={};
  for(const [key,v]of Object.entries(value.knobs)){
    if(!keys.has(key))continue;
    if((typeof v!=='string'&&typeof v!=='number')||String(v).length>128||(typeof (config.defaults?.[key]??config.engineDefaults?.[key])==='number'&&!Number.isFinite(Number(v))))throw Error('The saved world setting '+key+' is invalid.');
    knobs[key]=String(v);
  }
  const colors={};
  // Every color is a hex or null (off), but Shallow water's tone (sculpt-knobs.js waterTone); its old color (`shallow`) is dropped.
  for(const [key,v]of Object.entries(value.colors)){
    if(key==='shallow')continue;
    if(key==='shallowTone'?v!==null&&!isTone(v):v!==null&&(typeof v!=='string'||!/^#[0-9a-f]{6}$/i.test(v)))throw Error('The saved world color '+key+' is invalid.');
    colors[key]=key==='shallowTone'&&v?[...v]:v;
  }
  const surface=value.surface===undefined?null:copySurface(value.surface);
  return {materials:worldKept(withWorldMaterials(value.materials,config)),name:value.name.slice(0,120),base:value.base,colors,knobs,...(surface?{surface}:{})};
}
export function savedWorldId(s) {
  return typeof s.world==='string'&&/^[a-z0-9-]{1,80}$/.test(s.world)&&!['constructor','prototype'].includes(s.world)?s.world:s.biome;
}

// Whether a save's world (copySavedWorld's) draws as this browser's stored world of the same id (`mine`, the store's entry, or {} for a
// built-in never changed here): every World row, color, surface layer and kept material. Opening a map whose world differs keeps both
// (sculpt.js: the map's world opens as a world of its own), so a false "differs" only adds a world; it never loses one.
export function sameSavedWorld(theirs,mine,config) {
  const defaults=Object.fromEntries(KNOBS.flatMap(([,rows])=>rows.map(([key,,,,,value])=>[key,value])));
  const base=key=>config.defaults?.[key]??config.engineDefaults?.[key]??defaults[key];
  const keys=worldKeys(config);   // every key a save's world carries, a borrowed beach and the palette included
  for(const key of keys){
    const a=theirs.knobs?.[key]??base(key),b=mine.knobs?.[key]??base(key);
    if(a===undefined||b===undefined){if(a!==b)return false;continue;}
    const na=Number(a),nb=Number(b);
    if(Number.isFinite(na)&&Number.isFinite(nb)?na!==nb:String(a)!==String(b))return false;
  }
  const colors=own=>JSON.stringify(Object.entries(worldHexColors(config,new Map(),own||{})).map(([k,v])=>[k,typeof v==='string'?v.toLowerCase():v]).sort(([a],[b])=>a<b?-1:1));
  if(colors(theirs.colors)!==colors(mine.colors))return false;
  if(JSON.stringify(theirs.surface??null)!==JSON.stringify(mine.surface??null))return false;
  const a=worldOwnFor(theirs.materials,config),b=worldOwnFor(mine.materials,config,{stored:true});
  return JSON.stringify(Object.entries(a).sort())===JSON.stringify(Object.entries(b).sort());
}
