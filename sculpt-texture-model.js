// Shared numeric texture operations. Presets select amounts, never a world-specific shader.
export const TEXTURE_CONTROLS = [
 ['patternOctaves', 'Noise octaves', 0, 5, 0, 'Pattern'],
 ['patternLinear', 'Linear interpolation', 0, 1, 0, 'Pattern'],
 ['phaseOctaves', 'Phase octaves', 0, 4, 0, 'Distortion'],
 ['phaseAxis', 'Phase axis balance', -1, 1, 0, 'Distortion'],
 ['patternInvert', 'Invert', 0, 1, 0, 'Color'],
 ['patternClip', 'Hard clip', 0, 1, 0, 'Color'],
 ['patternSine', 'Sine shaping', 0, 1, 0, 'Color'],
 ['patternSineFrequency', 'Sine frequency', 1, 8, 1, 'Color'],

 ['patternAmount','Pattern blend',0,1,0,'Pattern'],
 ['patternSize','Pattern size',1,128,8,'Pattern'],['patternDetail','Secondary detail',0,1,.25,'Pattern'],
 ['patternGradient','Gradient noise',0,1,0,'Pattern'],['patternTurbulence','Turbulence',0,1,0,'Pattern'],['patternCells','Cellular structure',0,1,0,'Pattern'],
 ['patternStreak','Ripple structure',0,1,0,'Pattern'],['patternLength','Ripple length',1,128,8,'Pattern'],['patternDirection','Ripple direction',0,180,45,'Pattern'],['patternSlope','Ripple crests',0,1,0,'Pattern'],
 ['patternWarp','Phase amplitude',0,24,0,'Distortion'],['patternWarpSize','Phase size',1,128,10,'Distortion'],
 ['patternMottle','Broad mottling',0,1,0,'Distortion'],['patternMottleSize','Mottle size',1,256,16,'Distortion'],
 ['patternLow','Range low',-.5,.49,0,'Color'],['patternHigh','Range high',.51,1.5,1,'Color'],['patternPower','Power',.2,4,1,'Color'],['patternEase','Color softness',0,1,1,'Color'],
 ['textureFineStructure','Fine pattern detail',0,1,0,'Fine grain'],
 ['textureFine','Fine tint strength',0,1,0,'Fine grain'],['textureFineSize','Fine tint size',1,32,1,'Fine grain'],['textureFineGradient','Fine gradient noise',0,1,0,'Fine grain'],['textureFineWarp','Fine distortion',0,1,0,'Fine grain'],
 ['markAmount','Mark strength',0,1,0,'Marks'],['markSize','Mark radius',.25,16,1,'Marks'],['markSpacing','Mark spacing',2,64,5,'Marks'],['markDensity','Mark coverage',0,1,.2,'Marks'],['markScatter','Mark scatter',0,1.8,1.5,'Marks'],['markCore','Mark hardness',0,.95,.1,'Marks'],['markVariation','Mark variation',0,1,.3,'Marks'],['markFollow','Follow light areas',0,1,0,'Marks'],['markNoise','Noise marks',0,1,0,'Marks'],['markNoiseSize','Noise mark size',1,32,2,'Marks'],['markLow','Noise mark coverage',0,.49,.1,'Marks'],['markHigh','Noise mark softness',.51,1,.65,'Marks'],['markMultiply','Multiply mark tint',0,1,0,'Marks'],
 ['textureHeight','Pattern relief',0,8,0,'Relief'],['textureGrainHeight','Fine relief',0,4,0,'Relief'],['texturePitDepth','Mark depth',0,8,0,'Relief'],
 ['textureDither','Palette grain',0,1,0,'Palette'],['diffusionMix','Diffusion spread',0,1,0,'Palette'],['paletteGamma','Palette tone response',.5,2,1,'Palette'],
 ['paletteRed','Red color sensitivity',.25,2,1,'Palette'],['paletteGreen','Green color sensitivity',.25,2,1,'Palette'],['paletteBlue','Blue color sensitivity',.25,2,1,'Palette'],
];
export const TEXTURE_COLORS={low:[60,60,60],middle:[100,100,100],high:[145,145,145],mark:[30,30,30],fineLow:[1,1,1],fineHigh:[1,1,1],markTint:[1,1,1]};
export function copyTextureColors(value={}){
 if(!value||typeof value!=='object'||Array.isArray(value))throw Error('Invalid texture colors.');
 return Object.fromEntries(Object.entries(TEXTURE_COLORS).map(([k,d])=>{const a=value[k]??d,limit=['fineLow','fineHigh','markTint'].includes(k)?2:255;if(!Array.isArray(a)||a.length!==3||a.some(n=>typeof n!=='number'||!Number.isFinite(n)||n<0||n>limit))throw Error('Invalid texture color: '+k);return [k,[...a]];}));
}
export function copyTexturePalette(value=[]){if(!Array.isArray(value)||value.length>32||value.some(n=>!Number.isInteger(n)||n<0||n>255))throw Error('A texture palette needs at most 32 game color indices (0–255).');return [...new Set(value)];}
export function textureControlRequirement(key,k){
 const row=TEXTURE_CONTROLS.find(c=>c[0]===key);if(!row)return '';
 if(row[5]==='Palette')return key!=='textureDither'&&k.textureDither===0?'Raise Palette grain to use palette treatment.':'';
 if(key!=='patternAmount'&&k.patternAmount===0)return 'Raise Pattern blend to edit the procedural pattern.';
 if(['patternLength','patternDirection','patternSlope'].includes(key)&&k.patternStreak===0)return 'Raise Ripple structure to use this setting.';
 if(['patternWarpSize','phaseOctaves','phaseAxis'].includes(key)&&k.patternWarp===0)return 'Raise Phase amplitude to edit the phase field.';
 if(key==='patternSineFrequency'&&k.patternSine===0)return 'Raise Sine shaping to change its frequency.';
 if(key==='patternMottleSize'&&k.patternMottle===0)return 'Raise Broad mottling to change its size.';
 if(['textureFineSize','textureFineGradient','textureFineWarp'].includes(key)&&k.textureFine===0&&k.textureFineStructure===0)return 'Raise Fine tint strength or Fine pattern detail.';
 if(key.startsWith('mark')&&key!=='markAmount'&&k.markAmount===0)return 'Raise Mark strength to edit marks.';
 if(['markNoiseSize','markLow','markHigh'].includes(key)&&k.markNoise===0)return 'Raise Noise marks to shape their coverage.';
 if(['markSize','markSpacing','markDensity','markScatter','markCore','markVariation'].includes(key)&&k.markNoise===1)return 'Lower Noise marks to include scattered spots.';
 return '';
}
