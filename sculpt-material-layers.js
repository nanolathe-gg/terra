// Ordered layers, not a graph. Every layer uses the same procedural tools.
export const MAX_MATERIAL_LAYERS=8;
export const OUTPUT_KEYS=['textureDither','diffusionMix','paletteGamma','paletteRed','paletteGreen','paletteBlue'];
export const LAYER_CONTROLS=[
 ['opacity','Layer amount',0,1,1],['color','Color amount',0,1,1],['height','Relief amount',-1,1,1],['surface','Surface amount',0,1,1],['seed','Seed',0,1000,0],
 ['maskAmount','Mask amount',0,1,1],['maskSize','Mask size (px)',1,256,32],['maskDetail','Mask detail',0,1,.25],['maskWarp','Mask distortion (px)',0,24,0],['maskSeed','Mask seed',0,1000,17],['maskLow','Mask range low',0,.49,0],['maskHigh','Mask range high',.51,1,1],['maskInvert','Invert mask',0,1,0],
 ['terrainLow','Terrain range low',-128,512,0],['terrainHigh','Terrain range high',-127,1024,64],['terrainSoftness','Edge softness',.01,128,8],
];
export const LAYER_EFFECTS=['material','fine-tint','dots','detail'];
export const BLENDS=['normal','multiply','screen','add'];
export const MASKS=['everywhere','procedural','height','slope'];
export const PATTERNS=['clouds','cells','spots','ridges','waves','grain'];
export function copyLayerSettings(value={}){
 if(!value||typeof value!=='object'||Array.isArray(value))throw Error('Invalid material layer.');
 if(value.visible!==undefined&&typeof value.visible!=='boolean')throw Error('Invalid layer visibility.');
 const out={visible:value.visible!==false,name:value.name??'Base pattern',effect:value.effect??'material',blend:value.blend??'normal',mask:value.mask??'everywhere',maskPattern:value.maskPattern??'clouds'};
 if(typeof out.name!=='string'||!out.name.trim()||out.name.length>80)throw Error('A layer needs a name of 1 to 80 characters.');
 for(const [k,choices]of [['effect',LAYER_EFFECTS],['blend',BLENDS],['mask',MASKS],['maskPattern',PATTERNS]])if(!choices.includes(out[k]))throw Error('Invalid layer '+k+'.');
 for(const [k,,lo,hi,d]of LAYER_CONTROLS){const n=value[k]??d;if(typeof n!=='number'||!Number.isFinite(n))throw Error('Invalid layer '+k+'.');out[k]=Math.max(lo,Math.min(hi,n));}
 if(out.terrainHigh<=out.terrainLow)throw Error('Terrain range high must be above range low.');
 return out;
}
export const materialLayers=p=>[p,...(p.layers??[])];
export function patternSettings(kind){
 if(!PATTERNS.includes(kind))throw Error('Unknown procedural pattern.');
 return {patternAmount:1,patternGradient:0,patternCells:0,patternStreak:0,patternTurbulence:0,patternSize:32,patternDetail:.25,patternLength:96,patternDirection:45,patternSlope:0,patternLow:0,patternHigh:1,
 ...(kind==='cells'?{patternCells:1}:kind==='spots'?{patternCells:1,patternLow:.3,patternHigh:.8}:kind==='ridges'?{patternTurbulence:1}:kind==='waves'?{patternStreak:1,patternGradient:1,patternSize:6}:kind==='grain'?{patternSize:1,patternDetail:0}:{})};
}
// Moving the base also moves its procedural settings; palette treatment stays
// with the material, after the entire stack.
export function replaceMaterialLayers(material,layers){
 if(!layers.length||layers.length>MAX_MATERIAL_LAYERS)throw Error('A material needs 1–8 layers.');
 const [first,...rest]=layers.map(({layers,...p})=>structuredClone(p));
 return {...material,...first,knobs:{...first.knobs,...Object.fromEntries(OUTPUT_KEYS.map(k=>[k,material.knobs[k]]))},texturePalette:[...material.texturePalette],presetKey:material.presetKey??null,layers:rest};
}

// Conservative art-height reach: the shape family is clamped to ±8, plus
// pattern, fine relief and pits. Layer masks can only reduce this bound.
export const materialReliefBound=p=>materialLayers(p).reduce((n,l)=>n+(8+l.knobs.textureGrainHeight+Math.max(l.knobs.textureHeight,l.knobs.texturePitDepth))*l.layer.opacity*Math.abs(l.layer.height)*(l.layer.visible?1:0),0);

// Adjustment layers inherit the nearest preceding color generator's pattern
// context. This is an ordered stack dependency, not a user-managed reference.
// Artists edit the mottling once; its grain and dots follow those edits.
export function adjustmentOwns(effect,key){
 if(effect==='material')return true;
 if(effect==='fine-tint')return ['textureFine','textureFineSize','textureFineGradient','textureFineWarp'].includes(key);
 if(effect==='detail')return ['textureFineStructure','textureFineSize','textureFineGradient','textureFineWarp'].includes(key);
 if(effect==='dots')return key.startsWith('mark');
 return false;
}
export function resolveMaterialLayers(material){
 let pattern=null;
 return materialLayers(material).map(row=>{
  if(row.layer.effect==='material'){if(row.layer.color>0)pattern=row;return row;}
  if(!pattern)return {...row,layer:{...row.layer,opacity:0}};
  const own=Object.fromEntries(Object.entries(row.knobs).filter(([key])=>adjustmentOwns(row.layer.effect,key)));
  const knobs={...pattern.knobs,...own,patternAmount:1,textureHeight:0,textureGrainHeight:0,texturePitDepth:0};
  if(row.layer.effect==='detail'){knobs.textureFine=0;knobs.markAmount=0;}
  if(row.layer.effect==='fine-tint')knobs.markAmount=0;
  const ownColors=row.layer.effect==='fine-tint'?['fineLow','fineHigh']:row.layer.effect==='dots'?['mark','markTint']:[];
  const textureColors={...pattern.textureColors,...Object.fromEntries(ownColors.map(k=>[k,row.textureColors[k]]))};
  return {...row,layer:{...row.layer,seed:pattern.layer.seed,height:0,surface:0},knobs,textureColors,ramp:pattern.ramp,variationRamp:pattern.variationRamp,line:pattern.line};
 });
}
