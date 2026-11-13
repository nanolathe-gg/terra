// The map carries its effective world settings, including defaults and URL overrides.
// Keep browser/session parameters out of the recipe; removed controls are dropped on load.
import {KNOBS} from './sculpt-knobs.js';
import {worldHexColors} from './sculpt-scene.js';

const worldKeys=config => new Set([...Object.keys(config.defaults||{}),...Object.keys(config.engineDefaults||{}),...KNOBS.flatMap(([,rows])=>rows.map(([key])=>key)),'groundPattern','beachFrom','materialFoot','sandEdge','view','fill','relief','palette','sun']);
export function savedWorld(config,settings,world) {
  const knobs={};
  for(const key of worldKeys(config)){const value=settings.get(key)??world.knobs?.[key]??config.defaults?.[key]??config.engineDefaults?.[key];if(value!==undefined&&value!==null)knobs[key]=String(value);}
  return {name:world.name||config.biome,base:config.biomeId,variant:config.variant||'',colors:worldHexColors(config,settings,world.colors||{}),knobs};
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
  for(const [key,v]of Object.entries(value.colors)){
    if(v!==null&&(typeof v!=='string'||!/^#[0-9a-f]{6}$/i.test(v)))throw Error('The saved world color '+key+' is invalid.');
    colors[key]=v;
  }
  return {name:value.name.slice(0,120),base:value.base,variant:typeof value.variant==='string'?value.variant:'',colors,knobs};
}
export function savedWorldId(s) {
  return typeof s.world==='string'&&/^[a-z0-9-]{1,80}$/.test(s.world)&&!['constructor','prototype'].includes(s.world)?s.world:s.biome;
}
