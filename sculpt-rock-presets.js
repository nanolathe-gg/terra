// Geological starting points are ordinary artist settings and Rock column beds.
// No preset name reaches the renderer; the edited numbers are the saved result.
import {KNOBS} from './sculpt-knobs.js';
import {copyColumn,columnRows} from './sculpt-column.js';
const base={faceWhole:0,faceWholeLarge:0,faceRegular:0,faceJointWidth:1,faceSecondary:.35,faceContinuity:.8,faceDetailPatch:.6,faceFresh:.55,faceRind:.65,faceRindDepth:6,faceRindTone:-.22,faceRindWarmth:.25,faceRindRough:.7,bedCycleVary:.6,faceBedVary:1,faceBreak:.4,stoneRound:.15,stoneSlab:.25,faceJointTilt:12,faceScaleVary:.55,faceFold:0,faceSpall:.65,faceClast:0,faceClastSize:12,faceMineral:.3,runoff:.65,runoffScale:24,runoffConcentration:.65,runoffCut:2,runoffStain:.35,debrisAmount:1.1,debrisReach:80,debrisDepth:5,looseSize:7,stoneSort:.7,rockFace:2,faceRock:1,rockFaceFrom:.2,faceBed:5.5,faceLedge:2,faceRun:120,faceBlock:3,faceBlockSize:18,faceLean:0,faceWear:.25,faceCrease:.5,faceCreaseSize:6,faceScratch:.6,faceScratchSize:6,faceShade:.7,faceGrit:.15,faceGrass:.25,faceLayers:.3,faceMass:1,faceTone:.12,faceStrata:.08,faceWet:.2,
 faceStretch:1,faceBlockHeight:1,faceRound:0,faceJoint:.5,faceExtrude:0,faceLamina:0,faceLaminaSize:6,faceScratchLength:50,faceScratchAngle:0,faceGritSize:1.3,
 bedDip:0,bedDipDir:90,shineRock:.25,shineRockSharp:12,shineRockRough:.25,shineRockScale:3};
const preset=(label,knobs,beds)=>({label,knobs:{...base,...knobs},sections:[{start:0,beds}]});
export const ROCK_PRESETS={
 sandstone:preset('Layered sandstone',{faceWhole:.8,faceRegular:.55,faceRindWarmth:.45,faceRindDepth:5,rockFace:3,faceStretch:2.4,faceBlockHeight:1.6,faceBlock:5.2,faceBlockSize:26,faceBed:9,faceLedge:3.5,faceSpall:1.3,faceJoint:.65,faceExtrude:.3,faceLamina:1,faceLaminaSize:7,faceWear:.3,faceScratch:1.2,faceStrata:.18},[[7,.85,0],[3,.28,1],[4,.65,2]]),
 shale:preset('Thin shale',{faceSecondary:.3,faceBlock:1.2,faceSpall:.25,faceBreak:.2,faceContinuity:.9,faceRindWarmth:.1,faceRindTone:-.3,stoneSlab:.85,stoneRound:.05,faceStretch:3.2,faceBlockHeight:.4,faceBlockSize:24,faceBed:3,faceLedge:3.2,faceJoint:.9,faceLamina:1,faceLaminaSize:6,faceExtrude:.2,faceWear:.1,faceScratch:.3,faceStrata:.22,shineRock:.18},[[2,.85,0],[1,.2,1],[3,.7,2],[1,.3,1]]),
 granite:preset('Rounded granite',{faceWhole:.85,faceRegular:.15,faceSecondary:.2,faceContinuity:.65,faceFresh:.65,faceRindWarmth:.15,faceRindTone:.2,faceRindDepth:9,stoneRound:.8,stoneSlab:.1,faceSpall:.15,faceMineral:.8,faceScaleVary:.8,faceBlockSize:34,faceBlockHeight:4,faceRound:.85,faceBlock:4,faceBed:7,faceLedge:0,faceJoint:1.1,faceWear:.65,faceExtrude:.15,faceLayers:0,faceMass:1.8,faceCrease:.35,faceGrit:.6,faceGritSize:2,faceScratch:.2,faceStrata:0,shineRock:.4,shineRockSharp:34,shineRockRough:.5},[[12,.8,0]]),
 basalt:preset('Jointed basalt',{faceWhole:1,faceRegular:.7,faceSecondary:.15,faceContinuity:.95,faceFresh:.7,faceRindWarmth:.5,faceRindTone:.1,faceRindRough:.85,faceBlockSize:14,faceBlockHeight:5,faceBed:7,faceBlock:3.5,faceLedge:.2,faceJoint:1.3,faceWear:.12,faceExtrude:.1,faceLayers:0,faceScratch:1.6,faceScratchLength:120,faceCrease:.2,faceGrit:.3,faceStrata:0,shineRock:.3,shineRockSharp:28},[[12,.9,0]]),
 limestone:preset('Pitted limestone',{faceWhole:.6,faceRegular:.45,faceRindTone:.35,faceRindWarmth:.08,faceRindDepth:8,faceBlockSize:24,faceBlockHeight:1.8,faceRound:.55,faceBed:7,faceLedge:1.7,faceJoint:.8,faceWear:.8,faceCrease:3.5,faceCreaseSize:10,faceGrit:.25,faceScratch:1.8,faceScratchLength:90,faceLamina:.3,faceWet:.2,shineRock:.15,shineRockSharp:8},[[8,.75,0],[3,.4,1]]),
 gneiss:preset('Folded gneiss',{faceWhole:.5,faceWholeLarge:.5,faceRegular:.3,faceRindWarmth:.12,faceRindRough:.35,faceFold:22,faceRun:190,bedDipDir:25,faceBlockSize:32,faceBlockHeight:3,faceRound:.65,faceBlock:4.5,faceLedge:1.8,faceBed:8,faceLamina:.65,faceLaminaSize:6,faceStrata:.4,faceSpall:.35,faceJointTilt:30,faceGrit:.2,faceCrease:.2,faceMineral:.55,shineRock:.35},[[9,.9,0],[3,.3,1],[5,.75,2]]),
 schist:preset('Flaky schist',{faceFresh:.75,faceRindRough:.3,faceRindWarmth:.12,stoneSlab:.9,stoneRound:.05,bedDip:.35,bedDipDir:20,faceFold:5,faceRun:110,faceStretch:3.5,faceBlockHeight:.5,faceBlockSize:24,faceBed:4,faceLedge:2.8,faceSpall:1.2,faceBlock:1.8,faceSecondary:.3,faceBreak:.2,faceJointTilt:-32,faceJoint:1.1,faceRound:.1,faceLamina:.9,faceLaminaSize:6,faceMineral:.7,faceStrata:.3,shineRock:.5,shineRockSharp:40,shineRockRough:.3},[[3,.9,0],[2,.2,1],[2,.6,2]]),
 conglomerate:preset('Rounded conglomerate',{faceRindDepth:10,faceRindTone:.1,stoneRound:.95,stoneSlab:.05,faceClast:2.2,faceClastSize:14,faceRound:.95,faceBlock:1.3,faceBlockSize:32,faceBlockHeight:3,faceLedge:.4,faceLamina:0,faceJoint:.25,faceSpall:.25,faceMineral:.8,faceCrease:.35,faceBed:12,faceWear:.55,faceGrit:.15},[[14,.55,0],[5,.4,1]]),
 breccia:preset('Angular breccia',{faceWhole:1,faceSecondary:.75,faceContinuity:.7,faceFresh:.8,faceRind:.5,faceRindDepth:4,stoneRound:.05,stoneSlab:.35,faceClast:3.5,faceClastSize:22,faceRound:.05,faceBlock:2.7,faceBlockSize:36,faceBlockHeight:3,faceLedge:.3,faceLamina:0,faceJoint:.8,faceSpall:.8,faceMineral:.75,faceCrease:.3,faceBed:14,faceWear:.15,faceGrit:.25,looseSize:10},[[16,.7,0]]),
 // A wave-cut pavement: flat-lying siltstone cut into polygonal blocks by continuous joints (a tessellated pavement). Its blocks
 // stay low and smooth; the joints carry the relief, and it sheds no debris. With Rock at shores it is a jointed platform running from the shore
 // into the shallows. Its colour is the ground's own, a little darker: a pale warm crust (faceRindTone .35, faceRindWarmth .3), dry (faceWet 0),
 // with the generated rock's full hue grain (faceTone .5), so the game's palette mixes its maroon and olive entries into a brown instead of
 // landing on the maroon ones; the joints are narrow, half-deep shadowed lines (faceJointWidth 1.5, faceJoint 2), not open black trenches.
 siltstone:preset('Jointed siltstone',{debrisAmount:0,faceBed:7,faceLedge:0,faceRegular:.3,faceJointWidth:1.5,faceSecondary:.25,faceContinuity:1,faceFresh:.65,faceRindDepth:9,faceRindTone:.35,faceRindWarmth:.3,faceTone:.5,faceWet:0,faceBreak:0,stoneRound:.8,stoneSlab:.1,faceScaleVary:.3,faceSpall:0,faceMineral:.8,faceBlock:.5,faceBlockSize:18,faceWear:.8,faceCrease:.1,faceScratch:.2,faceGrit:.2,faceLayers:0,faceMass:.5,faceStrata:0,faceBlockHeight:4,faceRound:.85,faceJoint:2,faceExtrude:.15,faceGritSize:2,shineRock:.4,shineRockSharp:34,shineRockRough:.5},[[12,.8,0]])
};
export const ROCK_KEYS=[...Object.keys(base),'strata','strataContrast','strataGrain'];
const ranges=new Map(KNOBS.flatMap(([,rows])=>rows.map(([key,,lo,hi])=>[key,[lo,hi]])));
// Validate the entire recipe before changing the open scene. Unknown, removed
// fields are ignored, like the editor's other saved controls.
export function copyRockSettings(value){
 if(value==null)return null;
 if(typeof value!=='object'||Array.isArray(value))throw Error('Invalid rock settings.');
 const result={};
 for(const key of ROCK_KEYS)if(Object.hasOwn(value,key)){
  const n=value[key],[lo,hi]=ranges.get(key);
  if(typeof n!=='number'||!Number.isFinite(n)||n<lo||n>hi)throw Error(`Invalid rock setting: ${key}.`);
  result[key]=n;
 }
 return result;
}
// A world or a variant may name a recipe as its rock (config.rock = {recipe, beds}; sculpt.py WORLD_VARIANTS): when its file loads, the recipe's
// numbers become the world's own, under a saved world and the page's address, and with `beds` its beds replace the column's, as the Rock recipe
// list does. The numbers stay in this file; a world with no `rock` is as its file says.
export function applyWorldRock(config){
 const p=ROCK_PRESETS[config.rock?.recipe];if(!p)return config;
 for(const[key,value]of Object.entries(p.knobs)){config.defaults[key]=String(value);delete config.engineDefaults?.[key];}
 if(config.rock.beds)config.column={...config.column,sections:structuredClone(p.sections),variants:{}};
 return config;
}
export function rockPresetFor(values,column){
 return Object.entries(ROCK_PRESETS).find(([,p])=>Object.keys(p.knobs).every(k=>Math.abs(Number(values[k])-p.knobs[k])<1e-6)&&JSON.stringify(column?.sections)===JSON.stringify(p.sections))?.[0]||'';
}

// ---- Rock presets (B2): a map's rocks, slot 0 the world's own and slots 1-15 its own recipes (the renderer's table, sculpt-renderer.js setRocks) ----
// Slot 0 is the world's flat rock numbers and its column, as every address names them; this list holds the other slots, each
// {slot, name, knobs, column}. A preset takes slot 0's number for any it does not set, and slot 0's beds if its column is null.
// A landform stroke chooses one (params.rockPreset: -1 Rock beneath, which claims nothing, else a slot).
export const ROCK_SLOTS=16;
// Smooth soil, the tenth starting recipe: the world's own rock with no rock showing, so a hill under it reads as a smooth, soil-covered rise with
// no jointed blocks (red-1's clay high-pass 1.56 to 0.69 over the whole window, by eye no blocks). Rock relief, its share of steep faces
// and the slope it starts at, debris, runoff and the soil terraces go; ledges are grass. Its numbers lie over the world's rock, and it keeps
// the world's beds.
export const SMOOTH_SOIL={label:'Smooth soil',knobs:{rockFace:0,faceRock:0,rockFaceFrom:2,debrisAmount:0,runoff:0,faceLayers:0,faceGrass:1}};
// The starting recipes a preset can start from: the nine, then Smooth soil.
export const STARTING_RECIPES={...ROCK_PRESETS,soil:SMOOTH_SOIL};
// A preset's numbers and beds as a starting recipe gives them (Smooth soil keeps the world's beds: column null).
export function recipeRock(key){
 const r=STARTING_RECIPES[key];if(!r)throw Error(`No starting recipe ${key}.`);
 return {knobs:{...r.knobs},column:r.sections?{sections:structuredClone(r.sections)}:null};
}
// The starting recipe a preset still is (its numbers and beds as the recipe gives them), or ''.
export function rockRecipeFor(rock){
 const same=(a,b)=>JSON.stringify(a??null)===JSON.stringify(b??null);
 return Object.keys(STARTING_RECIPES).find(key=>{const r=recipeRock(key);return Object.keys(r.knobs).length===Object.keys(rock.knobs||{}).length&&Object.entries(r.knobs).every(([k,v])=>Math.abs(Number(rock.knobs?.[k])-v)<1e-6)&&same(r.column?.sections,rock.column?.sections);})||'';
}
// Slot 0's name: the recipe the world names as its rock, else World rock.
export const worldRockName=config=>ROCK_PRESETS[config.rock?.recipe]?.label||'World rock';
// The presets a world ships (a map starts with them): Smooth soil, then the recipes its data names (config.rock.presets, sculpt.py).
export function worldRocks(config){
 return ['soil',...(config.rock?.presets||[])].filter(key=>STARTING_RECIPES[key]).map((key,i)=>({slot:i+1,name:STARTING_RECIPES[key].label,...recipeRock(key)}));
}
const NAME_MAX=40,ROCK_FIELDS=['slot','name','knobs','column'];
function checkName(name){if(typeof name!=='string'||!name.trim()||name.trim().length>NAME_MAX)throw Error(`A rock preset needs a name of 1 to ${NAME_MAX} characters.`);return name.trim();}
// A preset's column: its sections alone (the beds; colors, bands and wander stay the world's), checked as a map's column is.
function checkColumn(column){if(column==null)return null;const c=copyColumn(column);if(!c.sections)throw Error('A rock preset\'s column needs its sections.');return {sections:c.sections};}
// A map's rock presets checked before they touch the open map (a save, a share link, a scene): slots 1-15, each once, a name, numbers within
// the controls' ranges, and a column the uniforms hold. No list is null (the world's own list then).
export function copyRocks(value){
 if(value==null)return null;
 if(!Array.isArray(value)||value.length>=ROCK_SLOTS)throw Error('Invalid rock presets.');
 const seen=new Set();
 return value.map(r=>{
  if(!r||typeof r!=='object'||Array.isArray(r)||Object.keys(r).some(k=>!ROCK_FIELDS.includes(k)))throw Error('Invalid rock preset.');
  if(!Number.isInteger(r.slot)||r.slot<1||r.slot>=ROCK_SLOTS||seen.has(r.slot))throw Error('A rock preset needs its own slot, 1 to 15.');
  seen.add(r.slot);
  return {slot:r.slot,name:checkName(r.name),knobs:copyRockSettings(r.knobs??{}),column:checkColumn(r.column)};
 }).sort((a,b)=>a.slot-b.slot);
}
const freeSlot=rocks=>{for(let s=1;s<ROCK_SLOTS;s++)if(!rocks.some(r=>r.slot===s))return s;throw Error('A map holds at most 15 rock presets besides the world\'s own.');};
// A name not yet in the list: the given one, else with a number after it.
export function uniqueRockName(rocks,name,slot0){
 const taken=new Set([slot0,...rocks.map(r=>r.name)]);if(!taken.has(name))return name;
 for(let k=2;;k++)if(!taken.has(`${name} ${k}`))return `${name} ${k}`;
}
// The list operations. Each returns a new list (and the preset's slot); none changes its arguments.
export function addRock(rocks,recipe,slot0Name=''){
 const slot=freeSlot(rocks);
 return {slot,rocks:[...rocks,{slot,name:uniqueRockName(rocks,STARTING_RECIPES[recipe].label,slot0Name),...recipeRock(recipe)}].sort((a,b)=>a.slot-b.slot)};
}
// A copy of a preset, or of slot 0 (`world`: {name, knobs, column} as the world's rock has them now).
export function duplicateRock(rocks,slot,world){
 const from=slot===0?world:rocks.find(r=>r.slot===slot);if(!from)throw Error(`No rock preset in slot ${slot}.`);
 const to=freeSlot(rocks);
 return {slot:to,rocks:[...rocks,{slot:to,name:uniqueRockName(rocks,`${from.name} copy`,world?.name),knobs:structuredClone(from.knobs),column:structuredClone(from.column??null)}].sort((a,b)=>a.slot-b.slot)};
}
export function renameRock(rocks,slot,name){
 if(!rocks.some(r=>r.slot===slot))throw Error(`No rock preset in slot ${slot}.`);
 return rocks.map(r=>r.slot===slot?{...r,name:checkName(name)}:r);
}
// A preset's numbers and beds replaced (a starting recipe, a pasted recipe, an edit), its name kept.
export function setRock(rocks,slot,{knobs,column}){return rocks.map(r=>r.slot===slot?{...r,knobs:copyRockSettings(knobs??{}),column:checkColumn(column)}:r);}
// A preset deleted: the strokes that chose it go to Rock beneath (in the same undo step, sculpt.js). Slot 0 is the world's and stays.
export function deleteRock(rocks,nodes,slot){
 if(slot===0)throw Error('The world\'s own rock cannot be deleted.');
 if(!rocks.some(r=>r.slot===slot))throw Error(`No rock preset in slot ${slot}.`);
 return {rocks:rocks.filter(r=>r.slot!==slot),nodes:nodes.map(n=>Math.round(n.params?.rockPreset??-1)===slot?{...n,params:{...n.params,rockPreset:-1}}:n)};
}
// A stroke's choice as the list allows: -1 (Rock beneath), 0 or a slot the list holds; anything else is Rock beneath.
export function strokeRock(n,rocks){
 const k=Math.round(n?.params?.rockPreset??-1);
 return k===0||rocks.some(r=>r.slot===k)?k:-1;
}
// Strokes whose choice the list does not hold go to Rock beneath (a stroke carried from another map, a preset deleted elsewhere).
export const keepStrokeRocks=(nodes,rocks)=>nodes.map(n=>n.params&&n.params.rockPreset!==undefined&&strokeRock(n,rocks)!==Math.round(n.params.rockPreset)?{...n,params:{...n.params,rockPreset:-1}}:n);
// The slots in use: those a shown landform stroke chooses (slot 0 needs no slot of the table). Only these reach the renderer (setRocks): a
// preset no stroke uses builds no pipeline, moves no reach and no pixel.
export function rocksInUse(nodes,rocks){
 const used=new Set();
 for(const n of nodes)if(n.kind==='landform'&&!n.hidden){const k=strokeRock(n,rocks);if(k>0)used.add(k);}
 return rocks.filter(r=>used.has(r.slot));
}
// A recipe on the clipboard: its name, numbers and beds as JSON, so two sets of numbers can be compared or moved between maps and worlds.
const RECIPE_FORMAT='terraform-rock-recipe';
export const rockRecipeText=rock=>JSON.stringify({format:RECIPE_FORMAT,name:rock.name,knobs:rock.knobs,column:rock.column??null},null,1);
export function parseRockRecipe(text){
 let v;try{v=JSON.parse(text);}catch{throw Error('The clipboard holds no rock recipe.');}
 if(!v||v.format!==RECIPE_FORMAT)throw Error('The clipboard holds no rock recipe.');
 return {name:checkName(v.name),knobs:copyRockSettings(v.knobs??{}),column:checkColumn(v.column)};
}
// Slot 0 as a preset (for Duplicate and Copy): its name, every rock number as the world has it now, and its active row's sections.
export function worldRock(name,values,column,variant){
 const sections=columnRows(column,variant).starts.length?(column?.variants?.[variant]?.sections||column?.sections):null;
 return {name,knobs:Object.fromEntries(ROCK_KEYS.map(k=>[k,Number(values[k])]).filter(([,v])=>Number.isFinite(v))),column:sections?{sections:structuredClone(sections)}:null};
}
