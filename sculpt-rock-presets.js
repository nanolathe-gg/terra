// Geological starting points are ordinary artist settings and Rock column beds.
// No preset name reaches the renderer; the edited numbers are the saved result.
import {LIBRARY,MATERIAL_SLOTS,addMaterial,materialCacheUsage,materialStaged,materialStates,roleOf} from './sculpt-materials.js';
import {KNOBS} from './sculpt-knobs.js';
import {copyColumn,columnRows,COLUMN_SLOTS} from './sculpt-column.js';
const base={faceWhole:0,faceWholeLarge:0,faceRegular:0,faceJointWidth:1,faceSecondary:.35,faceContinuity:.8,faceDetailPatch:.6,faceFresh:.55,faceRind:.65,faceRindDepth:6,faceRindTone:-.22,faceRindWarmth:.25,faceRindRough:.7,bedCycleVary:.6,faceBedVary:1,faceBreak:.4,stoneRound:.15,stoneSlab:.25,faceJointTilt:12,faceScaleVary:.55,faceFold:0,faceSpall:.65,faceClast:0,faceClastSize:12,faceMineral:.3,runoff:.65,runoffScale:24,runoffConcentration:.65,runoffCut:2,runoffStain:.35,debrisAmount:1.1,debrisReach:80,debrisDepth:5,looseSize:7,stoneSort:.7,rockFace:2,faceRock:1,rockFaceFrom:.2,faceBed:5.5,faceLedge:2,faceRun:120,faceBlock:3,faceBlockSize:18,faceLean:0,faceWear:.25,faceCrease:.5,faceCreaseSize:6,faceScratch:.6,faceScratchSize:6,faceShade:.7,faceGrass:.25,faceLayers:.3,faceMass:1,faceTone:.12,faceStrata:.08,faceWet:.2,
 faceStretch:1,faceBlockHeight:1,faceRound:0,faceJoint:.5,faceExtrude:0,faceLamina:0,faceLaminaSize:6,faceScratchLength:50,faceScratchAngle:0,
 bedDip:0,bedDipDir:90,shineRock:.25,shineRockSharp:12,shineRockRough:.25,shineRockScale:3};
const preset=(label,knobs,beds)=>({label,knobs:{...base,...knobs},sections:[{start:0,beds}]});
export const ROCK_PRESETS={
 sandstone:preset('Layered sandstone',{faceWhole:.8,faceRegular:.55,faceRindWarmth:.45,faceRindDepth:5,rockFace:3,faceStretch:2.4,faceBlockHeight:1.6,faceBlock:5.2,faceBlockSize:26,faceBed:9,faceLedge:3.5,faceSpall:1.3,faceJoint:.65,faceExtrude:.3,faceLamina:1,faceLaminaSize:7,faceWear:.3,faceScratch:1.2,faceStrata:.18},[[7,.85,0],[3,.28,1],[4,.65,2]]),
 shale:preset('Thin shale',{faceSecondary:.3,faceBlock:1.2,faceSpall:.25,faceBreak:.2,faceContinuity:.9,faceRindWarmth:.1,faceRindTone:-.3,stoneSlab:.85,stoneRound:.05,faceStretch:3.2,faceBlockHeight:.4,faceBlockSize:24,faceBed:3,faceLedge:3.2,faceJoint:.9,faceLamina:1,faceLaminaSize:6,faceExtrude:.2,faceWear:.1,faceScratch:.3,faceStrata:.22,shineRock:.18},[[2,.85,0],[1,.2,1],[3,.7,2],[1,.3,1]]),
 granite:preset('Rounded granite',{faceWhole:.85,faceRegular:.15,faceSecondary:.2,faceContinuity:.65,faceFresh:.65,faceRindWarmth:.15,faceRindTone:.2,faceRindDepth:9,stoneRound:.8,stoneSlab:.1,faceSpall:.15,faceMineral:.8,faceScaleVary:.8,faceBlockSize:34,faceBlockHeight:4,faceRound:.85,faceBlock:4,faceBed:7,faceLedge:0,faceJoint:1.1,faceWear:.65,faceExtrude:.15,faceLayers:0,faceMass:1.8,faceCrease:.35,faceScratch:.2,faceStrata:0,shineRock:.4,shineRockSharp:34,shineRockRough:.5},[[12,.8,0]]),
 basalt:preset('Jointed basalt',{faceWhole:1,faceRegular:.7,faceSecondary:.15,faceContinuity:.95,faceFresh:.7,faceRindWarmth:.5,faceRindTone:.1,faceRindRough:.85,faceBlockSize:14,faceBlockHeight:5,faceBed:7,faceBlock:3.5,faceLedge:.2,faceJoint:1.3,faceWear:.12,faceExtrude:.1,faceLayers:0,faceScratch:1.6,faceScratchLength:120,faceCrease:.2,faceStrata:0,shineRock:.3,shineRockSharp:28},[[12,.9,0]]),
 limestone:preset('Pitted limestone',{faceWhole:.6,faceRegular:.45,faceRindTone:.35,faceRindWarmth:.08,faceRindDepth:8,faceBlockSize:24,faceBlockHeight:1.8,faceRound:.55,faceBed:7,faceLedge:1.7,faceJoint:.8,faceWear:.8,faceCrease:3.5,faceCreaseSize:10,faceScratch:1.8,faceScratchLength:90,faceLamina:.3,faceWet:.2,shineRock:.15,shineRockSharp:8},[[8,.75,0],[3,.4,1]]),
 gneiss:preset('Folded gneiss',{faceWhole:.5,faceWholeLarge:.5,faceRegular:.3,faceRindWarmth:.12,faceRindRough:.35,faceFold:22,faceRun:190,bedDipDir:25,faceBlockSize:32,faceBlockHeight:3,faceRound:.65,faceBlock:4.5,faceLedge:1.8,faceBed:8,faceLamina:.65,faceLaminaSize:6,faceStrata:.4,faceSpall:.35,faceJointTilt:30,faceCrease:.2,faceMineral:.55,shineRock:.35},[[9,.9,0],[3,.3,1],[5,.75,2]]),
 schist:preset('Flaky schist',{faceFresh:.75,faceRindRough:.3,faceRindWarmth:.12,stoneSlab:.9,stoneRound:.05,bedDip:.35,bedDipDir:20,faceFold:5,faceRun:110,faceStretch:3.5,faceBlockHeight:.5,faceBlockSize:24,faceBed:4,faceLedge:2.8,faceSpall:1.2,faceBlock:1.8,faceSecondary:.3,faceBreak:.2,faceJointTilt:-32,faceJoint:1.1,faceRound:.1,faceLamina:.9,faceLaminaSize:6,faceMineral:.7,faceStrata:.3,shineRock:.5,shineRockSharp:40,shineRockRough:.3},[[3,.9,0],[2,.2,1],[2,.6,2]]),
 conglomerate:preset('Rounded conglomerate',{faceRindDepth:10,faceRindTone:.1,stoneRound:.95,stoneSlab:.05,faceClast:2.2,faceClastSize:14,faceRound:.95,faceBlock:1.3,faceBlockSize:32,faceBlockHeight:3,faceLedge:.4,faceLamina:0,faceJoint:.25,faceSpall:.25,faceMineral:.8,faceCrease:.35,faceBed:12,faceWear:.55},[[14,.55,0],[5,.4,1]]),
 breccia:preset('Angular breccia',{faceWhole:1,faceSecondary:.75,faceContinuity:.7,faceFresh:.8,faceRind:.5,faceRindDepth:4,stoneRound:.05,stoneSlab:.35,faceClast:3.5,faceClastSize:22,faceRound:.05,faceBlock:2.7,faceBlockSize:36,faceBlockHeight:3,faceLedge:.3,faceLamina:0,faceJoint:.8,faceSpall:.8,faceMineral:.75,faceCrease:.3,faceBed:14,faceWear:.15,looseSize:10},[[16,.7,0]]),
 // A wave-cut pavement: flat-lying siltstone cut into polygonal blocks by continuous joints (a tessellated pavement). Its blocks
 // stay low and smooth; the joints carry the relief, and it sheds no debris. With Rock at shores it is a jointed platform running from the shore
 // into the shallows. Its colour is the ground's own, a little darker: a pale warm crust (faceRindTone .35, faceRindWarmth .3), dry (faceWet 0),
 // with the generated rock's full hue grain (faceTone .5), so the game's palette mixes its maroon and olive entries into a brown instead of
 // landing on the maroon ones; the joints are narrow, half-deep shadowed lines (faceJointWidth 1.5, faceJoint 2), not open black trenches.
 siltstone:preset('Jointed siltstone',{debrisAmount:0,faceBed:7,faceLedge:0,faceRegular:.3,faceJointWidth:1.5,faceSecondary:.25,faceContinuity:1,faceFresh:.65,faceRindDepth:9,faceRindTone:.35,faceRindWarmth:.3,faceTone:.5,faceWet:0,faceBreak:0,stoneRound:.8,stoneSlab:.1,faceScaleVary:.3,faceSpall:0,faceMineral:.8,faceBlock:.5,faceBlockSize:18,faceWear:.8,faceCrease:.1,faceScratch:.2,faceLayers:0,faceMass:.5,faceStrata:0,faceBlockHeight:4,faceRound:.85,faceJoint:2,faceExtrude:.15,shineRock:.4,shineRockSharp:34,shineRockRough:.5},[[12,.8,0]])
};
// Rock surfaces a recipe may carry too (struct Rock): cracks, contour bands, moon pits and strokes, ice crystal strokes, crests, snow caps, fibres
// and aprons, the crystal web and rock on level tops (Rock crown). A recipe that does not set one takes the world's.
export const ROCK_SURFACE_KEYS=['crackSeverity','crackMajor','crackMinor','crackHairline','crackBlocks','crackSpacing','crackWidth','crackDark','crackNetwork','banding','pockmark','pockSize','moonCups','moonCupSize','moonCupDepth','cupStretch','moonRibs','moonRibDepth','moonRibDark','moonFolds','moonFoldSpacing','iceCrystal','iceCrest','iceSnow','iceFall','iceApron','gougeWeb','rockCrown'];
// One ordered headline list for the rock page and Pick.
export const ROCK_HEADLINES=['faceWhole','faceBlockSize','faceBed','faceWear','crackSeverity','faceScratch','runoff'];
export const ROCK_KEYS=[...Object.keys(base),'strata','strataContrast','strataGrain','absorbDepth','shadowTint',...ROCK_SURFACE_KEYS];
// The starting recipes' bed tones ({beds}, checkColors: shifts of the recipe's rock material's color): a preset made from one takes them. A world that names a recipe as its rock
// keeps its own colors (applyWorldRock takes the numbers and beds only), so its slot 0 looks as it did. Each color is an entry of the game's
// palette (materials/palette.json) on one ramp, so a lit face steps along that ramp instead of dithering between two hues: the palette has
// gray, olive, ochre, rose and blue-gray ramps from dark to light, and few orange-browns. A recipe's rock color is its material's Color
// (ROCK_MATERIALS: library entries like a rock graph, each at the color the recipe's rock had, measured as the material's GPU mean).
export const ROCK_COLORS={
 sandstone:{beds:[[0.0,0.0,0.0],[0.0941,-0.0784,0.251],[0.0941,0.0784,0.0471],[0.0314,-0.1569,0.1725],[-0.0941,-0.0784,-0.0471]]},   // ochre, rose beds
 shale:{beds:[[0.0314,0.0314,-0.0941],[0.0627,0.0627,0.0627],[-0.0314,-0.0314,-0.1569],[0.1255,0.1255,0.1255],[-0.0627,-0.0627,-0.0627]]},   // gray, olive beds
 granite:{beds:[[-0.098,-0.098,-0.098],[0.0902,0.0902,0.0902],[-0.1608,-0.1608,-0.1608],[0.1529,0.1529,0.1529],[-0.0353,-0.0353,-0.0353]]},   // modern Green's gray
 basalt:{beds:[[0.0,0.0,0.0],[0.0627,0.0784,0.0784],[-0.0314,-0.0471,-0.0314],[0.1412,0.1725,0.1725],[-0.0627,-0.1098,-0.0941]]},   // dark blue-gray
 limestone:{beds:[[0.0,0.0,0.0],[-0.0941,-0.0941,-0.0941],[0.1098,0.1098,0.1098],[-0.1882,-0.1882,-0.1725],[-0.0314,-0.0314,0.1255]]},   // pale cream
 gneiss:{beds:[[0.1255,0.1255,0.1255],[-0.1882,-0.1882,-0.1882],[0.1882,0.1882,0.1882],[-0.1255,-0.1255,-0.1255],[0.0,0.0,0.0]]},   // gray bands, light and dark
 schist:{beds:[[-0.0157,-0.0157,-0.1412],[0.0627,0.0627,0.0627],[-0.0941,-0.0941,-0.2196],[0.1255,0.1255,0.1255],[-0.1569,-0.1569,-0.2824]]},   // silver gray, olive beds
 conglomerate:{beds:[[0.0,0.0,0.0],[0.1098,0.1098,0.0941],[-0.0784,-0.0784,-0.0784],[0.2039,0.2039,0.1725],[-0.1412,-0.1412,-0.1412]]},   // olive tan
 breccia:{beds:[[0.0,0.0,0.0],[0.0627,-0.2039,-0.1725],[0.1255,0.1255,0.1255],[-0.0471,-0.2824,-0.251],[-0.1255,-0.1255,-0.1255]]},   // gray, rose clasts in its beds
 siltstone:{beds:[[0.0,0.0,0.0],[-0.0627,0.1569,0.0],[0.0471,0.0314,0.0314],[0.0,0.2196,0.0627],[-0.0471,-0.0314,-0.0314]]},   // maroon, olive beds
};
const ranges=new Map(KNOBS.flatMap(([,rows])=>rows.map(([key,,lo,hi])=>[key,[lo,hi]])));
// Validate the entire recipe before changing the open scene. Unknown, removed
// fields are ignored, like the editor's other saved controls. A finite number
// outside its control's range loads at the range's nearer end, so a map saved
// before a range moved still opens; anything else is refused.
export function copyRockSettings(value){
 if(value==null)return null;
 if(typeof value!=='object'||Array.isArray(value))throw Error('Invalid rock settings.');
 const result={};
 for(const key of ROCK_KEYS)if(Object.hasOwn(value,key)){
  const n=value[key],[lo,hi]=ranges.get(key);
  if(typeof n!=='number'||!Number.isFinite(n))throw Error(`Invalid rock setting: ${key}.`);
  result[key]=Math.min(hi,Math.max(lo,n));
 }
 return result;
}
// A world may name a recipe as its rock (config.rock = {recipe, beds}; materials/<world>.json world.rock): when its file loads, the recipe's
// numbers become the world's own, under a saved world and the page's address, and with `beds` its beds replace the column's, as the Rock recipe
// list does. The numbers stay in this file; a world with no `rock` is as its file says.
export function applyWorldRock(config){
 const p=ROCK_PRESETS[config.rock?.recipe];if(!p)return config;
 for(const[key,value]of Object.entries(p.knobs)){config.defaults[key]=String(value);delete config.engineDefaults?.[key];}
 if(config.rock.beds)config.column={...config.column,sections:structuredClone(p.sections)};
 return config;
}
export function rockPresetFor(values,column){
 return Object.entries(ROCK_PRESETS).find(([,p])=>Object.keys(p.knobs).every(k=>Math.abs(Number(values[k])-p.knobs[k])<1e-6)&&JSON.stringify(column?.sections)===JSON.stringify(p.sections))?.[0]||'';
}

// ---- Rock presets (B2): a map's rocks, slot 0 the world's own and slots 1-15 its own recipes (the renderer's table, sculpt-renderer.js setRocks) ----
// Slot 0 is the world's flat rock numbers, its column and its colors, as every address names them; this list holds the other slots, each
// {slot, name, key, knobs, column, colors}. `key` names the preset for data (a world's shape tool names its rock by it, rockByKey): the starting
// recipe it came from ('soil', 'basalt', ...) while no other preset of the map carries that, else null; a rename keeps it. A preset takes slot 0's number for any it does not set, slot 0's beds if its column is null, and
// slot 0's colors where its colors are null: {rock, beds}, the rock's color and its beds' five material slots, each '#rrggbb' or null.
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
// With a world's config, a key may name one of the world's own rock types (worldRecipe).
export function recipeRock(key,config){
 const w=worldRecipe(config,key);if(w)return {knobs:w.knobs,column:w.column,colors:w.colors};
 const r=STARTING_RECIPES[key];if(!r)throw Error(`No starting recipe ${key}.`);
 return {knobs:{...r.knobs},column:r.sections?{sections:structuredClone(r.sections)}:null,colors:checkColors(ROCK_COLORS[key])};
}
// The rock material each starting recipe's faces show (library materials, materials/textures.json): its color, grain, grit and shine. A
// world's own rock type takes the one it names (`material`), else its `from` recipe's; Smooth soil none (the world's rock material).
export const ROCK_MATERIALS={sandstone:'rock-sandstone-ochre',conglomerate:'rock-conglomerate',siltstone:'rock-siltstone',shale:'rock-shale-gray',schist:'rock-schist',
 granite:'rock-granite-gray',gneiss:'rock-gneiss',breccia:'rock-breccia',basalt:'rock-basalt-blue',limestone:'rock-limestone-cream'};
export const recipeMaterial=(key,config)=>config?.rock?.recipes?.[key]?.material??ROCK_MATERIALS[key]??ROCK_MATERIALS[config?.rock?.recipes?.[key]?.from]??null;
// Rock types made from a starting recipe or a world's rock type that names a material (those in `slots`) show it (recipeMaterial): the map's copy of that library
// material, added while the list and the material cache have room; a rock type that already names one keeps it. The editor (sculpt.js)
// and the headless host give a map's world rock types theirs when the map has no rock list of its own, and a preset its own when added or
// started again from a recipe (`keyOf`: the recipe each rock type is made from, its key by default).
export function giveRockMaterials(rocks, materials, slots, config, keyOf = r => r.key) {
  let list = materials; const layers = l => l.reduce((n, m) => n + 1 + materialStates(m).length, 0), missed = [];
  const out = rocks.map(r => {
    if (!slots.includes(r.slot) || r.material > 0) return r;
    const key = recipeMaterial(keyOf(r), config), m = LIBRARY[key]; if (!m) return r;
    let at = list.find(o => o.source === key && !roleOf(o));
    if (!at) {
      // No room: the rock type shows the world's rock material, and the caller says so (`missed`, the rock types' names).
      if (list.length >= MATERIAL_SLOTS - 1 || !materialCacheUsage(layers(list) + 1 + materialStates(m).length, undefined, [...list, m].some(materialStaged)).fits) { missed.push(r.name); return r; }
      const added = addMaterial(list, m, m.name); list = added.materials; at = list.find(o => o.slot === added.slot);
    }
    return {...r, material: at.slot};
  });
  return {rocks: out, materials: list, missed};
}
// A world's own rock types (materials/<world>.json world.rock.recipes: {key: {label, material, from, knobs, beds, sections, colors}}): its numbers lie over the
// starting recipe it names (`from`, else none: the world's own rock under them, as Smooth soil's), its beds ([[thickness, hardness, slot], ...]),
// or its column sections by height ([{start, beds}, ...]), replace that recipe's, and its colors ({rock, beds, absorb}) that recipe's. A world's tools name them by key, as the built-in recipes.
export function worldRecipe(config,key){
 const w=config?.rock?.recipes?.[key];if(!w)return null;
 const from=w.from?STARTING_RECIPES[w.from]:null;if(w.from&&!from)throw Error(`The rock type ${key} starts from ${w.from}, which is no starting recipe.`);
 const sections=w.sections?structuredClone(w.sections):w.beds?[{start:0,beds:structuredClone(w.beds)}]:from?.sections?structuredClone(from.sections):null;
 return {label:w.label,knobs:{...(from?.knobs||{}),...copyRockSettings(w.knobs||{})},column:sections?{sections}:null,colors:checkColors(w.colors??(w.from?ROCK_COLORS[w.from]:null)??null)};
}
// A recipe's name: the world's own type's label, else the starting recipe's.
export const recipeLabel=(key,config)=>config?.rock?.recipes?.[key]?.label??STARTING_RECIPES[key]?.label;
// The starting recipe a preset still is (its numbers and beds as the recipe gives them), or ''.
export function rockRecipeFor(rock){
 const same=(a,b)=>JSON.stringify(a??null)===JSON.stringify(b??null);
 return Object.keys(STARTING_RECIPES).find(key=>{const r=recipeRock(key);return Object.keys(r.knobs).length===Object.keys(rock.knobs||{}).length&&Object.entries(r.knobs).every(([k,v])=>Math.abs(Number(rock.knobs?.[k])-v)<1e-6)&&same(r.colors,checkColors(rock.colors))&&same(r.column?.sections,rock.column?.sections);})||'';
}
// Slot 0's name: the recipe the world names as its rock, else World rock.
export const worldRockName=config=>ROCK_PRESETS[config.rock?.recipe]?.label||'World rock';
// The presets a world ships (a map starts with them): Smooth soil, then the recipes its data names (config.rock.presets, materials/<world>.json),
// built-in or the world's own (config.rock.recipes).
export function worldRocks(config){
 return [...new Set(['soil',...(config.rock?.presets||[])])].filter(key=>recipeLabel(key,config)).map((key,i)=>({slot:i+1,name:recipeLabel(key,config),key,...recipeRock(key,config)}));
}
// The slot of the preset a key names: a preset of the map that carries it, else 0 where it is the world's own rock's key (`worldKey`, its
// recipe: config.rock.recipe), else -1, Rock beneath (a world's tool that names a rock the map does not hold draws on the rock beneath).
export function rockByKey(rocks,key,worldKey=''){
 if(!key)return -1;
 const rock=rocks.find(r=>r.key===key);
 return rock?rock.slot:key===worldKey?0:-1;
}
const NAME_MAX=40,ROCK_FIELDS=['slot','name','key','knobs','column','colors','material','worldKey'],KEY=/^[a-z][a-z0-9_-]{0,39}$/;
// A preset's key: null, or a short lowercase name ('soil', 'basalt').
function checkKey(key){if(key==null)return null;if(typeof key!=='string'||!KEY.test(key))throw Error('A rock preset\'s key is a short lowercase name, such as soil or basalt.');return key;}
// A key for a preset made now: `key`, unless another preset of the map carries it (keys name one preset each).
const freeKey=(rocks,key)=>key&&!rocks.some(r=>r.key===key)?key:null;
function checkName(name){if(typeof name!=='string'||!name.trim()||name.trim().length>NAME_MAX)throw Error(`A rock preset needs a name of 1 to ${NAME_MAX} characters.`);return name.trim();}
// A preset's column: its sections alone (the beds; colors, bands and wander stay the world's), checked as a map's column is.
function checkColumn(column){if(column==null)return null;const c=copyColumn(column);if(!c.sections)throw Error('A rock preset\'s column needs its sections.');return {sections:c.sections};}
// A preset's colors: {beds, absorb}, its beds' tones (COLUMN_SLOTS [r, g, b] shifts of its material's color, -1 to 1: sculpt-column.js
// columnTones) and the color it deepens toward with thickness (Color deepens with thickness, '#rrggbb'), each null for slot 0's. None at all
// is null. The rock's own color is its material's Color; a `rock` color, or beds as colors, from an older save or recipe are dropped.
const HEX=/^#[0-9a-f]{6}$/i;
export function checkColors(colors){
 if(colors==null)return null;
 const fail=()=>{throw Error(`A rock preset's colors are {beds, absorb}: ${COLUMN_SLOTS} tones ([r, g, b] from -1 to 1) for its beds and one '#rrggbb' it deepens toward, or null for the world's.`);};
 if(typeof colors!=='object'||Array.isArray(colors)||Object.keys(colors).some(k=>!['rock','beds','absorb'].includes(k)))fail();
 const hex=v=>{if(typeof v!=='string'||!HEX.test(v))fail();return v.toLowerCase();};
 if(colors.beds!=null&&(!Array.isArray(colors.beds)||colors.beds.length!==COLUMN_SLOTS))fail();
 const tone=v=>{if(!Array.isArray(v)||v.length!==3||v.some(c=>typeof c!=='number'||!Number.isFinite(c)||c<-1||c>1))fail();return [...v];};
 const beds=colors.beds==null||colors.beds.every(v=>typeof v==='string')?null:colors.beds.map(tone),absorb=colors.absorb==null?null:hex(colors.absorb);
 return beds||absorb?{beds,...(absorb?{absorb}:{})}:null;
}
// A map's rock presets checked before they touch the open map (a save, a share link, a scene): slots 1-15, each once, a name, numbers within
// the controls' ranges, and a column the uniforms hold. No list is null (the world's own list then).
export function copyRocks(value){
 if(value==null)return null;
 if(!Array.isArray(value)||value.length>=ROCK_SLOTS)throw Error('Invalid rock presets.');
 const seen=new Set(),keys=new Set(),worldKeys=new Set();
 return value.map(r=>{
  if(!r||typeof r!=='object'||Array.isArray(r)||Object.keys(r).some(k=>!ROCK_FIELDS.includes(k)))throw Error('Invalid rock preset.');
  if(!Number.isInteger(r.slot)||r.slot<1||r.slot>=ROCK_SLOTS||seen.has(r.slot))throw Error('A rock preset needs its own slot, 1 to 15.');
  seen.add(r.slot);
  const key=checkKey(r.key);if(r.worldKey!==undefined){if(!checkKey(r.worldKey)||worldKeys.has(r.worldKey))throw Error('A world rock needs its own catalog key.');worldKeys.add(r.worldKey);}
  if(key&&keys.has(key))throw Error(`Two rock presets carry the key ${key}: a key names one preset.`);
  if(key)keys.add(key);
  // Its surface material: a map material's slot (1 to MATERIAL_SLOTS - 1), or none for the world's rock material.
  if(r.material!=null&&(!Number.isInteger(r.material)||r.material<0||r.material>=MATERIAL_SLOTS))throw Error(`A rock preset's material is a material slot, 1 to ${MATERIAL_SLOTS-1}.`);
  return {slot:r.slot,name:checkName(r.name),key,...(r.worldKey?{worldKey:r.worldKey}:{}),knobs:copyRockSettings(r.knobs??{}),column:checkColumn(r.column),colors:checkColors(r.colors),...(r.material>0?{material:r.material}:{})};
 }).sort((a,b)=>a.slot-b.slot);
}
const freeSlot=rocks=>{for(let s=1;s<ROCK_SLOTS;s++)if(!rocks.some(r=>r.slot===s))return s;throw Error('A map holds at most 15 rock presets besides the world\'s own.');};
// A name not yet in the list: the given one, else with a number after it.
export function uniqueRockName(rocks,name,slot0){
 const taken=new Set([slot0,...rocks.map(r=>r.name)]);if(!taken.has(name))return name;
 for(let k=2;;k++)if(!taken.has(`${name} ${k}`))return `${name} ${k}`;
}
// The list operations. Each returns a new list (and the preset's slot); none changes its arguments.
export function addRock(rocks,recipe,slot0Name='',config=null){
 const slot=freeSlot(rocks);
 return {slot,rocks:[...rocks,{slot,name:uniqueRockName(rocks,recipeLabel(recipe,config),slot0Name),key:freeKey(rocks,recipe),...recipeRock(recipe,config)}].sort((a,b)=>a.slot-b.slot)};
}
// A copy of a preset, or of slot 0 (`world`: {name, knobs, column} as the world's rock has them now; a copy of slot 0 keeps the world's colors,
// colors null, so it follows them).
export function duplicateRock(rocks,slot,world){
 const from=slot===0?world:rocks.find(r=>r.slot===slot);if(!from)throw Error(`No rock preset in slot ${slot}.`);
 const to=freeSlot(rocks);
 return {slot:to,rocks:[...rocks,{slot:to,name:uniqueRockName(rocks,`${from.name} copy`,world?.name),key:null,knobs:structuredClone(from.knobs),column:structuredClone(from.column??null),colors:checkColors(from.colors),...(from.material>0?{material:from.material}:{})}].sort((a,b)=>a.slot-b.slot)};
}
export function renameRock(rocks,slot,name){
 if(!rocks.some(r=>r.slot===slot))throw Error(`No rock preset in slot ${slot}.`);
 return rocks.map(r=>r.slot===slot?{...r,name:checkName(name)}:r);
}
// A preset's numbers and beds replaced (a starting recipe, a pasted recipe, an edit), its name and key kept; its colors too when `colors` is
// given (null: the world's), else kept. A preset without a key takes `key` (a pasted recipe's) when no other preset carries it.
export function setRock(rocks,slot,{knobs,column,key,...rest}){return rocks.map(r=>r.slot===slot?{...r,key:r.key??freeKey(rocks,checkKey(key)),knobs:copyRockSettings(knobs??{}),column:checkColumn(column),colors:'colors' in rest?checkColors(rest.colors):r.colors??null}:r);}
// A preset's colors replaced (the panel's color rows), its numbers and beds kept.
export function setRockColors(rocks,slot,colors){
 if(!rocks.some(r=>r.slot===slot))throw Error(`No rock preset in slot ${slot}.`);
 return rocks.map(r=>r.slot===slot?{...r,colors:checkColors(colors)}:r);
}
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
// The rock types a stroke on Rock beneath (at `index`; nodes.length for one not yet drawn) can show: a stroke claims its slot on the cells
// it shapes and Rock beneath claims nothing, so each cell keeps the claim of the last shown landform before it that reached the cell, and an
// unclaimed cell is the world's rock (engine-common.wgsl rockSlotAt). `reaches(n)` says whether an earlier stroke may reach this one's
// cells; a box test that errs toward yes keeps the answer honest. One slot is what the stroke shows everywhere; more than one, it varies.
// (Reset ground returns a cell to the world's rock, which is always in the list.)
export function rocksBeneath(nodes,index,rocks,reaches){
 const slots=new Set([0]);
 for(let i=0;i<Math.min(index,nodes.length);i++){const n=nodes[i];if(n?.kind!=='landform'||n.hidden)continue;const k=strokeRock(n,rocks);if(k>0&&reaches(n))slots.add(k);}
 return [...slots];
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
// A recipe on the clipboard: its name, numbers, beds and colors as JSON, so two sets of numbers can be compared or moved between maps and worlds.
const RECIPE_FORMAT='terraform-rock-recipe';
export const rockRecipeText=rock=>JSON.stringify({format:RECIPE_FORMAT,name:rock.name,key:rock.key??null,knobs:rock.knobs,column:rock.column??null,colors:rock.colors??null},null,1);
export function parseRockRecipe(text){
 let v;try{v=JSON.parse(text);}catch{throw Error('The clipboard holds no rock recipe.');}
 if(!v||v.format!==RECIPE_FORMAT)throw Error('The clipboard holds no rock recipe.');
 return {name:checkName(v.name),key:checkKey(v.key),knobs:copyRockSettings(v.knobs??{}),column:checkColumn(v.column),colors:checkColors(v.colors)};
}
// Slot 0 as a preset (for Duplicate and Copy): its name, every rock number as the world has it now, and its active row's sections.
export function worldRock(name,values,column){
 const sections=columnRows(column).starts.length?column.sections:null;
 return {name,knobs:Object.fromEntries(ROCK_KEYS.map(k=>[k,Number(values[k])]).filter(([,v])=>Number.isFinite(v))),column:sections?{sections:structuredClone(sections)}:null};
}
