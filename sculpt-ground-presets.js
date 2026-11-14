import {copySteps,recipeSteps} from './sculpt-material-steps.js';
import gamePalette from './materials/palette.json' with {type:'json'};
import texturePresets from './materials/texture-presets.json' with {type:'json'};
import {TEXTURE_CONTROLS,copyTextureColors,copyTexturePalette} from './sculpt-texture-model.js';
// Absolute ground recipes. Slots 1–7 belong to the map; slot 0 belongs to the world.
// Colors are continuous RGB; numeric palette references normalize to RGB on input.
export const GROUND_SLOTS = 8;
export const GROUND_CACHE_BYTES = 128 * 1024 * 1024;
export const GROUND_CONTROLS = [
 ...TEXTURE_CONTROLS.map(([key,,lo,hi,def])=>[key,lo,hi,def]),
 ['grainFine',0,1,0],['grainMedium',0,1,0],['grainBroad',0,1,0],['grainRelief',0,8,0],['grainColorMix',0,1,0],['grainStretch',1,8,1],['grainDirection',0,180,0],
 ['bumpAmount',0,8,0],['bumpSize',3,96,16],['bumpStretch',1,4,1],
 ['plateAmount',0,8,0],['plateSize',12,256,64],['plateVariation',0,1,.5],['plateProfile',-1,1,0],['borderProfile',-1,1,-1],['crackWidth',0,12,2],['rimCurl',0,1,.3],['plateTilt',0,1,.2],['secondaryCracks',0,1,0],
 ['scratchAmount',0,8,0],['scratchSpacing',4,128,24],['scratchWidth',0,8,1],['scratchLength',4,256,64],['scratchConnect',0,1,.5],
 ['quietAmount',0,1,0],['quietSize',16,256,64],
 ['veinAmount',0,1,0],['veinSpacing',4,128,32],['veinWidth',0,4,1],
 ['pebbleAmount',0,8,0],['pebbleSize',3,48,8],['pebbleRound',0,1,.7],
 ['cushionAmount',0,8,0],['cushionSize',4,96,16],
 ['rippleAmount',0,6,0],['rippleSize',6,128,24],['rippleAsymmetry',0,1,.5],
 ['toneVariation',0,1,.2],['toneSize',8,256,64],['lineStrength',0,1,1],
 ['gloss',0,1,0],['sharpness',1,128,16],['roughness',0,1,.25],['roughnessScale',1,32,3],['wetness',0,1,.5],
];
export const GROUND_KEYS = GROUND_CONTROLS.map(([key]) => key);
export const GROUND_DEFAULTS = Object.fromEntries(GROUND_CONTROLS.map(([key,,,value]) => [key,value]));
const object = x => x && typeof x === 'object' && !Array.isArray(x);
const nameOf = name => { if (typeof name !== 'string' || !name.trim() || name.trim().length > 80) throw Error('A ground preset needs a name of 1 to 80 characters.'); return name.trim(); };
const recipeColor = value => {
 if(Number.isInteger(value)&&value>=0&&value<=255)return [...gamePalette.indexed[value]];
 if(!Array.isArray(value)||value.length!==3||value.some(n=>typeof n!=='number'||!Number.isFinite(n)||n<0||n>255))throw Error('Ground colors need RGB values from 0 to 255.');
 return [...value];
};
export function copyGroundRecipe(value) {
 if (!object(value)) throw Error('Invalid ground recipe.');
 const knobs = {...GROUND_DEFAULTS};
 if (value.knobs !== undefined && !object(value.knobs)) throw Error('Invalid ground settings.');
 for (const [key,lo,hi] of GROUND_CONTROLS) if (Object.hasOwn(value.knobs || {},key)) {
  const n=value.knobs[key]; if(typeof n!=='number'||!Number.isFinite(n)) throw Error(`Invalid ground setting: ${key}.`);
  knobs[key]=Math.max(lo,Math.min(hi,n));
 }
 if (!Array.isArray(value.ramp) || value.ramp.length !== 16) throw Error('A ground ramp needs 16 colors.');
 const variationRamp=value.variationRamp ?? value.ramp;
 if(!Array.isArray(variationRamp)||variationRamp.length!==16)throw Error('A ground variation ramp needs 16 colors.');
 if(value.presetKey!=null&&(typeof value.presetKey!=='string'||!value.presetKey.trim()||value.presetKey.length>80))throw Error('Invalid source preset.');
 const recipe={presetKey:value.presetKey??null,knobs,textureColors:copyTextureColors(value.textureColors),texturePalette:copyTexturePalette(value.texturePalette),ramp:value.ramp.map(recipeColor),variationRamp:variationRamp.map(recipeColor),line:recipeColor(value.line ?? value.ramp[0])};
 recipe.steps=value.steps?copySteps(value.steps):recipeSteps(recipe);return recipe;
}
export function copyGrounds(value) {
 if(value==null)return null;
 if(!Array.isArray(value)||value.length>=GROUND_SLOTS)throw Error('A map holds at most seven ground presets besides the world’s own.');
 for(const role of ['worldGround','worldWater'])if(value.filter(p=>p?.[role]===true).length>1)throw Error('Only one material can be assigned as '+role+'.');
 const slots=new Set(),keys=new Set();
 return value.map(p=>{
  if(!object(p)||!Number.isInteger(p.slot)||p.slot<1||p.slot>=GROUND_SLOTS||slots.has(p.slot))throw Error('A ground preset needs its own slot, 1 to 7.');
  slots.add(p.slot);const key=p.key??null;
  if(key!==null&&(typeof key!=='string'||!key.trim()||key.length>80||keys.has(key)))throw Error('Ground preset keys must be unique nonempty strings.');
  if(key)keys.add(key);
  return {slot:p.slot,name:nameOf(p.name),key,worldGround:p.worldGround===true,worldWater:p.worldWater===true,...copyGroundRecipe(p)};
 }).sort((a,b)=>a.slot-b.slot);
}
export const worldGrounds = config => copyGrounds(config.grounds) ?? [];
const freeSlot = grounds => {for(let slot=1;slot<GROUND_SLOTS;slot++)if(!grounds.some(p=>p.slot===slot))return slot;throw Error('A map holds at most seven ground presets besides the world’s own.');};
function uniqueName(grounds,name,worldName='World ground') {const taken=new Set([worldName,...grounds.map(p=>p.name)]);if(!taken.has(name))return name;for(let n=2;;n++)if(!taken.has(`${name} ${n}`))return `${name} ${n}`;}
export function addGround(grounds,recipe,name='Ground',worldName) {
 const slot=freeSlot(grounds),p={slot,name:uniqueName(grounds,nameOf(name),worldName),key:null,worldGround:false,worldWater:false,...copyGroundRecipe(recipe)};
 return {slot,grounds:[...grounds,p].sort((a,b)=>a.slot-b.slot)};
}
export function duplicateGround(grounds,slot,world) {
 const p=slot===0?world:grounds.find(p=>p.slot===slot);if(!p)throw Error(`No ground preset in slot ${slot}.`);
 return addGround(grounds,p,`${p.name} copy`,world?.name);
}
export function renameGround(grounds,slot,name) {
 if(!grounds.some(p=>p.slot===slot))throw Error(`No ground preset in slot ${slot}.`);
 return grounds.map(p=>p.slot===slot?{...p,name:nameOf(name)}:p);
}
export function setGround(grounds,slot,recipe) {
 if(!grounds.some(p=>p.slot===slot))throw Error(`No ground preset in slot ${slot}.`);
 const r=copyGroundRecipe(recipe);return grounds.map(p=>p.slot===slot?{...p,...r}:p);
}
export function strokeGround(node,grounds) {
 const slot=node?.params?.groundPreset;
 return Number.isInteger(slot)&&(slot===0||grounds.some(p=>p.slot===slot))?slot:-1;
}
export function keepStrokeGrounds(nodes,grounds) {
 return nodes.map(n=>n.params&&n.params.groundPreset!==undefined&&n.params.groundPreset!==strokeGround(n,grounds)?{...n,params:{...n.params,groundPreset:strokeGround(n,grounds)}}:n);
}
export function groundsInUse(nodes,grounds) {
 const used=new Set([...grounds.filter(p=>p.worldGround||p.worldWater).map(p=>p.slot),...nodes.filter(n=>!n.hidden&&(n.kind==='landform'||n.kind==='paint'&&(n.params?.paintChannel===26||n.params?.paintChannel===undefined))).map(n=>strokeGround(n,grounds))]);
 return grounds.filter(p=>used.has(p.slot)).sort((a,b)=>a.slot-b.slot);
}
export function deleteGround(grounds,nodes,slot) {
 if(slot===0)throw Error('The world’s own ground cannot be deleted.');
 if(!grounds.some(p=>p.slot===slot))throw Error(`No ground preset in slot ${slot}.`);
 const next=grounds.filter(p=>p.slot!==slot);return {grounds:next,nodes:keepStrokeGrounds(nodes,next)};
}
export const groundRecipeText = preset => JSON.stringify({format:'terraform-ground-recipe',name:preset.name,...copyGroundRecipe(preset)});
export function parseGroundRecipe(text) {
 let p;try{p=JSON.parse(text);}catch{throw Error('The clipboard has no ground recipe.');}
 if(p?.format!=='terraform-ground-recipe')throw Error('The clipboard has no ground recipe.');
 return {name:nameOf(p.name),...copyGroundRecipe(p)};
}
export function groundCacheUsage(count,pool) {
 if(!Number.isInteger(count)||count<0||count>GROUND_SLOTS||!Number.isInteger(pool)||pool<512||pool%512)throw Error('Invalid ground cache dimensions.');
 const bytes=count*28*pool*pool,capacity=Math.min(GROUND_SLOTS,Math.floor(GROUND_CACHE_BYTES/(pool*pool*28)));
 return {bytes,capacity,budget:GROUND_CACHE_BYTES,fits:bytes<=GROUND_CACHE_BYTES};
}

// Starting recipes are only absolute settings and palette entries.
const ramp = (dark,light) => Array.from({length:16},(_,i)=>Math.round(dark+(light-dark)*i/15));
const presets = {
 ...texturePresets,
 bed:{name:'Cracked bed',knobs:{plateAmount:3.5,plateSize:64,plateVariation:.8,plateProfile:-.2,borderProfile:-1,crackWidth:1.8,rimCurl:.65,plateTilt:.35,secondaryCracks:.5,toneVariation:.22,roughness:0},ramp:ramp(94,80),line:93},
 salt:{name:'Salt flat',knobs:{plateAmount:.7,plateSize:48,borderProfile:1,rimCurl:.2,crackWidth:1,grainFine:.12,toneVariation:.08,roughness:.1},ramp:ramp(86,80),line:80},
 gravel:{name:'Gravel',knobs:{pebbleAmount:3,pebbleSize:9,pebbleRound:.3,bumpAmount:.5,bumpSize:23,grainFine:.3,toneVariation:.2,roughness:.2},ramp:ramp(94,83),line:94},
 moss:{name:'Moss cushions',knobs:{cushionAmount:3,cushionSize:14,grainFine:.2,grainMedium:.2,quietAmount:.25,quietSize:40,toneVariation:.25,roughness:.1},ramp:ramp(174,164),line:174},
 ice:{name:'Ice',knobs:{plateAmount:.8,plateSize:100,plateVariation:.9,plateTilt:.15,crackWidth:.8,borderProfile:-1,rimCurl:.05,scratchAmount:.3,scratchSpacing:36,scratchWidth:.6,scratchConnect:.8,gloss:.7,sharpness:64,roughness:.05,toneVariation:.12},ramp:ramp(120,112),line:118},
 alien:{name:'Alien crust',knobs:{plateAmount:2,plateSize:36,plateProfile:.5,borderProfile:-.5,rimCurl:.25,veinAmount:.8,veinSpacing:19,veinWidth:1.5,rippleAmount:.3,rippleSize:18,rippleAsymmetry:.6,grainFine:.2,gloss:.3,toneVariation:.3},ramp:ramp(156,147),line:176},
};

export const GROUND_PRESETS=Object.fromEntries(Object.entries(presets).map(([presetKey,p])=>[presetKey,{...p,presetKey}]));
