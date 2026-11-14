// A typed, bounded DAG presented as an ordered recipe. IDs, not positions,
// connect steps; the GPU evaluates the same program for preview and export.
export const MAX_STEPS=40;
export const STEP_TYPES=['transform','noise','grain','dots','surface','constant','remap','combine','gradient','channel','hash','output'];
export const COMBINES=['replace','add','multiply','subtract','minimum','maximum','blend','screen'];
export const OUTPUTS=['color','height','roughness','wetness','gloss'];
export const STEP_PARAMS={
 transform:[['patternWarp','Distortion',0,24,0],['patternWarpSize','Distortion size',1,128,10],['phaseOctaves','Octaves',0,4,0],['phaseAxis','Axis balance',-1,1,0]],
 noise:[['patternSize','Size',1,128,8],['patternDetail','Secondary detail',0,1,.25],['patternGradient','Gradient noise',0,1,0],['patternLinear','Linear interpolation',0,1,0],['patternTurbulence','Turbulence',0,1,0],['patternCells','Cells',0,1,0],['patternStreak','Directional waves',0,1,0],['patternLength','Wave length',1,128,8],['patternDirection','Direction',0,180,45],['patternSlope','Crests',0,1,0],['patternOctaves','Octaves',0,5,0],['patternMottle','Broad variation',0,1,0],['patternMottleSize','Broad size',1,256,16]],
 grain:[['textureFineSize','Size',1,32,1],['textureFineGradient','Gradient noise',0,1,0],['textureFineWarp','Distortion influence',0,1,0]],
 dots:[['markAmount','Strength',0,1,1],['markSize','Radius',.25,16,1],['markSpacing','Spacing',2,64,5],['markDensity','Coverage',0,1,.2],['markScatter','Scatter',0,1.8,1.5],['markCore','Hardness',0,.95,.1],['markVariation','Variation',0,1,.3],['markFollow','Follow source',0,1,0],['markNoise','Noise distribution',0,1,0],['markNoiseSize','Noise size',1,32,2],['markLow','Noise coverage',0,.49,.1],['markHigh','Noise softness',.51,1,.65]],
 surface:[],constant:[['value','Value',-8,8,0]],
 remap:[['patternLow','Low',-.5,.49,0],['patternHigh','High',.51,1.5,1],['patternPower','Power',.2,4,1],['patternInvert','Invert',0,1,0],['patternClip','Hard clip',0,1,0],['patternSine','Sine shaping',0,1,0],['patternSineFrequency','Frequency',1,8,1]],
 combine:[['amount','Amount',-8,8,1],['offset','Second input offset',-8,8,0]],
 gradient:[['ease','Softness',0,1,1]],channel:[['channel','Component',0,3,0]],hash:[],
 output:[['scale','Scale',-8,8,1],['offset','Offset',-8,8,0]],
};
export const STEP_LABELS={transform:'Transform coordinates',noise:'Fractal noise',grain:'Fine noise',dots:'Scattered dots',surface:'Surface primitives',constant:'Constant',remap:'Remap values',combine:'Combine',gradient:'Color gradient',channel:'Extract component',hash:'Pixel variation',output:'Material output'};
const refKeys=['source','other','mask'];
export function copySteps(value){
 if(!Array.isArray(value)||value.length<1||value.length>MAX_STEPS)throw Error(`A layer needs 1–${MAX_STEPS} steps.`);
 const seen=new Set();
 const steps=value.map(s=>{
  if(!s||!STEP_TYPES.includes(s.type)||typeof s.id!=='string'||!s.id||s.id.length>80||seen.has(s.id))throw Error('Invalid or duplicate material step.');
  if(s.enabled!==undefined&&typeof s.enabled!=='boolean')throw Error('Invalid step visibility.');
  const p={};for(const [k,,lo,hi,d]of STEP_PARAMS[s.type]){const n=s.params?.[k]??d;if(typeof n!=='number'||!Number.isFinite(n))throw Error('Invalid step value: '+k);p[k]=Math.max(lo,Math.min(hi,n));}
  if(s.type==='channel')p.channel=Math.round(p.channel);
  const out={id:s.id,name:s.name??STEP_LABELS[s.type],type:s.type,enabled:s.enabled!==false,params:p};
  if(typeof out.name!=='string'||!out.name.trim()||out.name.length>80)throw Error('A step needs a name of 1–80 characters.');
  for(const key of refKeys){out[key]=s[key]??null;if(out[key]!==null&&!seen.has(out[key]))throw Error('Step sources must refer to an earlier step. Move its source first or reconnect it.');}
  if(s.type==='combine'){out.operation=s.operation??'blend';if(!COMBINES.includes(out.operation))throw Error('Invalid combine operation.');}
  if(s.type==='output'){out.target=s.target??'color';if(!OUTPUTS.includes(out.target))throw Error('Invalid material output.');}
  if(s.type==='gradient'){
   const colors=s.colors??[[0,0,0],[1,1,1]];
   if(![2,3,16].includes(colors.length)||colors.some(c=>!Array.isArray(c)||c.length!==3||c.some(v=>typeof v!=='number'||!Number.isFinite(v)||v<0||v>2)))throw Error('A gradient needs 2, 3, or 16 RGB colors from 0 to 2.');
   out.colors=colors.map(c=>[...c]);
  }
  if(s.position!==undefined){if(!s.position||!['x','y'].every(k=>typeof s.position[k]==='number'&&Number.isFinite(s.position[k])))throw Error('Invalid node position.');out.position={x:Math.max(-20000,Math.min(20000,s.position.x)),y:Math.max(-20000,Math.min(20000,s.position.y))};}
  seen.add(s.id);return out;
 });
 const types=new Map(),outputs=new Set();
 for(const s of steps){const a=types.get(s.source),b=types.get(s.other),c=types.get(s.mask);
  if(['noise','grain','transform'].includes(s.type)&&a&&a!=='position')throw Error('A generator or transform needs coordinates as its source.');
  if(s.type==='dots'&&a&&a!=='scalar')throw Error('Dot coverage needs a grayscale source.');
  if(['remap','gradient'].includes(s.type)&&a&&a!=='scalar')throw Error('Remap and gradient steps need a grayscale source.');
  if(s.type==='combine'&&[a,b].some(t=>t==='position'||t==='surface'))throw Error('Combine needs grayscale or color inputs.');
  if(s.type==='combine'&&c&&c!=='scalar')throw Error('A blend mask must be grayscale.');
  if(s.type==='channel'&&a&&a!=='surface'&&a!=='color')throw Error('Extract component needs a surface or color source.');
  if(s.type==='output'&&a&&(a==='position'||a==='surface'||s.target!=='color'&&a!=='scalar'))throw Error('Connect a color or grayscale value to Color; other outputs need grayscale.');
  if(s.type==='output'&&s.enabled){if(outputs.has(s.target))throw Error('Each material channel has one enabled output.');outputs.add(s.target);}
  types.set(s.id,s.type==='transform'?'position':s.type==='surface'?'surface':s.type==='gradient'||s.type==='combine'&&(a==='color'||b==='color')?'color':'scalar');
 }
 return steps;
}
export function stepTypes(steps){const types=new Map();for(const s of steps)types.set(s.id,s.type==='transform'?'position':s.type==='surface'?'surface':s.type==='gradient'||s.type==='combine'&&(types.get(s.source)==='color'||types.get(s.other)==='color')?'color':'scalar');return types;}
export function makeStep(type,steps=[]){
 const id='step-'+(1+Math.max(0,...steps.map(s=>Number(s.id.replace('step-',''))||0))),types=stepTypes(steps);
 const target=type==='output'?OUTPUTS.find(t=>!steps.some(s=>s.type==='output'&&s.enabled&&s.target===t)):null;
 if(type==='output'&&!target)throw Error('All material output channels already have a node.');
 const want=['noise','grain','transform'].includes(type)?'position':['remap','gradient','dots'].includes(type)||type==='output'&&target!=='color'?'scalar':type==='channel'?'surface':null;
 const source=['constant','surface','hash'].includes(type)?null:steps.findLast(s=>s.type!=='output'&&(want?types.get(s.id)===want:['scalar','color'].includes(types.get(s.id))))?.id??null;
 return copySteps([...steps,{id,name:STEP_LABELS[type],type,source,...(target?{target}:{} )}]).at(-1);
}
// Lower absolute recipes into ordinary steps. All recipes, including the older
// relief starters, run through this program; no alternate material evaluator.
export function recipeSteps(r){
 const k=r.knobs,c=r.textureColors,steps=[];let serial=0;
 const add=(type,name,props={})=>{const id='step-'+ ++serial;steps.push({id,type,name,...props});return id;};
 const params=type=>Object.fromEntries(STEP_PARAMS[type].map(([key,,, ,d])=>[key,k[key]??d]));
 const combine=(name,a,b,operation,amount=1,offset=0,mask=null)=>add('combine',name,{source:a,other:b,mask,operation,params:{amount,offset}});
 const constant=(name,value)=>add('constant',name,{params:{value}});
 let color=null,height=null,pigment=null;
 if(k.patternAmount<1){
  const surface=add('surface','Surface structure');
  height=add('channel','Surface height',{source:surface,params:{channel:0}});
  const tone=add('channel','Surface tone',{source:surface,params:{channel:1}}),variation=add('channel','Tone variation',{source:surface,params:{channel:2}}),line=add('channel','Lines',{source:surface,params:{channel:3}});
  const t=combine('Tone and variation',tone,variation,'add',.35);
  const ramp=add('gradient','Surface gradient',{source:t,colors:r.ramp.map(c=>c.map(v=>v/255)),params:{ease:0}});
  color=ramp;
  if(k.grainColorMix>0){const other=add('gradient','Alternate gradient',{source:t,colors:r.variationRamp.map(c=>c.map(v=>v/255)),params:{ease:0}}),hash=add('hash','Color variation');color=combine('Mix surface colors',color,other,'blend',k.grainColorMix,0,hash);}
  const ink=add('gradient','Line color',{source:null,colors:[r.line.map(v=>v/255),r.line.map(v=>v/255)],params:{ease:0}});color=combine('Blend lines',color,ink,'blend',1,0,line);
 }
 if(k.patternAmount>0){
  const transform=add('transform','Pattern distortion',{params:params('transform')});
  const coarse=add('noise','Mottling / streaks',{source:transform,params:params('noise')});
  let field=coarse,fine=null,marks=null;
  if(k.textureFineStructure>0||k.textureFine>0){fine=add('grain','Fine grain',{source:transform,params:params('grain')});}
  if(k.textureFineStructure>0)field=combine('Add fine detail',coarse,fine,'add',k.textureFineStructure,.5);
  pigment=add('remap','Pattern levels',{source:field,params:params('remap')});
  let paint=add('gradient','Pattern colors',{source:pigment,colors:[c.low,c.middle,c.high].map(c=>c.map(v=>v/255)),params:{ease:k.patternEase}});
  if(k.textureFine>0){const tint=add('gradient','Grain colors',{source:fine,colors:[c.fineLow,c.fineHigh],params:{ease:0}});paint=combine('Multiply grain',paint,tint,'multiply',k.textureFine);}
  if(k.markAmount>0){
   marks=add('dots','Scattered spots',{source:coarse,params:params('dots')});
   const solid=add('gradient','Spot color',{colors:[c.mark.map(v=>v/255),c.mark.map(v=>v/255)],params:{ease:0}});
   const replaced=combine('Blend spot color',paint,solid,'blend',1,0,marks);
   const tint=add('gradient','Spot multiplier',{source:marks,colors:[[1,1,1],c.markTint],params:{ease:0}});
   const multiplied=combine('Multiply spots',paint,tint,'multiply');
   paint=combine('Blend color treatments',replaced,multiplied,'blend',k.markMultiply);
  }
  color=color?combine('Blend procedural color',color,paint,'blend',k.patternAmount):paint;
  if(k.textureHeight||k.textureGrainHeight||k.texturePitDepth){
   const surface=add('surface','Relief primitives');height=add('channel','Primitive height',{source:surface,params:{channel:0}});
  }else if(!height)height=constant('Flat height',0);
 }
 if(color)add('output','Color output',{source:color,target:'color'});
 if(height)add('output','Height output',{source:height,target:'height',params:{scale:1,offset:0}});
 return copySteps(steps);
}
// Instructions are 288 bytes: two integer vec4s and sixteen argument vec4s.
export const STEP_STRIDE=288;
export const PROGRAM_BYTES=16+MAX_STEPS*STEP_STRIDE;
export function compileSteps(recipe){
 const steps=copySteps(recipe.steps),types=stepTypes(steps),indices=new Map(steps.map((s,i)=>[s.id,i])),shade=new Set(),sample=new Map();let signals=0;
 const reserve=(id,width=1)=>{if(id&&!sample.has(id)){sample.set(id,signals);signals+=width;}};
 // Surface primitives are four jointly sampled fields. Arithmetic after that
 // sampling boundary remains full precision, including palette interpolation.
 for(const s of steps){if(s.type==='surface'){reserve(s.id,4);shade.add(s.id);}if(s.type==='hash'||s.type==='gradient'||types.get(s.id)==='color'||[s.source,s.other,s.mask].some(id=>shade.has(id)))shade.add(s.id);}
 for(const s of steps){if(s.type==='gradient'||types.get(s.id)==='color'||s.type==='output')for(const id of [s.source,s.other,s.mask])if(id&&types.get(id)==='scalar'&&!shade.has(id))reserve(id);}
 const planes=Math.max(1,Math.ceil(signals/4));
 const instructions=steps.map(s=>{
  const code=[STEP_TYPES.indexOf(s.type)+1,s.enabled?1:0,sample.get(s.id)??-1,s.type==='combine'?COMBINES.indexOf(s.operation):s.type==='output'?OUTPUTS.indexOf(s.target):0];
  const links=[s.source,s.other,s.mask].map(id=>indices.get(id)??-1);links.push(types.get(s.id)==='color'?1:0);
  const args=STEP_PARAMS[s.type].map(([k])=>s.params[k]);
  if(s.type==='gradient'){args[1]=s.colors.length;args.push(...s.colors.flat());}
  return {code,links,args};
 });
 return {steps,instructions,planes,signals,sample};
}
// Projection/export bounds follow the authored arithmetic, including branches
// that amplify height. This is interval analysis, not a CPU texture renderer.
export function stepHeightBound(recipe){
 const values=new Map(),add=(a,b)=>[a[0]+b[0],a[1]+b[1]],sub=(a,b)=>[a[0]-b[1],a[1]-b[0]],mul=(a,b)=>{const v=[a[0]*b[0],a[0]*b[1],a[1]*b[0],a[1]*b[1]];return [Math.min(...v),Math.max(...v)];},mix=(a,b,w)=>add(a,mul(sub(b,a),w));
 let height=[0,0];
 for(const s of recipe.steps){const a=values.get(s.source)??[0,0],b=values.get(s.other)??[0,0],mask=values.get(s.mask)??[1,1],p=s.params;let v=a;
  if(!s.enabled){v=['noise','grain','dots','surface','constant'].includes(s.type)?[0,0]:a;}
  else switch(s.type){
   case 'noise':case 'dots':case 'remap':case 'hash':v=[0,1];break;
   case 'grain':v=[-1,2];break;
   case 'constant':v=[p.value,p.value];break;
   case 'surface':{const k=recipe.knobs;v=[-8-k.textureGrainHeight-k.texturePitDepth,8+k.textureGrainHeight+k.textureHeight];break;}
   case 'gradient':{const low=Math.min(...s.colors.flat()),high=Math.max(...s.colors.flat());v=s.colors.length===2?mix([low,high],[low,high],a):[low,high];break;}
   case 'combine':{const q=sub(b,[p.offset,p.offset]),w=mul([p.amount,p.amount],mask);switch(s.operation){
    case 'add':v=add(a,mul(q,w));break;case 'subtract':v=sub(a,mul(q,w));break;case 'multiply':v=mul(a,mix([1,1],q,w));break;
    case 'minimum':v=mix(a,[Math.min(a[0],q[0]),Math.min(a[1],q[1])],w);break;
    case 'maximum':v=mix(a,[Math.max(a[0],q[0]),Math.max(a[1],q[1])],w);break;
    case 'screen':v=mix(a,sub([1,1],mul(sub([1,1],a),sub([1,1],q))),w);break;
    default:v=mix(a,q,w);
   }break;}
   case 'output':v=add(mul(a,[p.scale,p.scale]),[p.offset,p.offset]);if(s.target==='height')height=v;break;
  }
  values.set(s.id,v);
 }
 return Math.max(...height.map(Math.abs));
}

// Graph layout order is independent of evaluation order. Connections retain IDs;
// only the compiler-facing list is sorted, after checking for cycles.
export function orderSteps(steps){
 const byId=new Map(steps.map(s=>[s.id,s])),visiting=new Set(),done=new Set(),ordered=[];
 if(byId.size!==steps.length)throw Error('Duplicate node ID.');
 const visit=s=>{if(done.has(s.id))return;if(visiting.has(s.id))throw Error('That connection would create a cycle.');visiting.add(s.id);
  for(const key of ['source','other','mask'])if(s[key]){const source=byId.get(s[key]);if(!source)throw Error('Missing source node.');visit(source);}
  visiting.delete(s.id);done.add(s.id);ordered.push(s);
 };
 for(const s of steps)visit(s);return copySteps(ordered);
}
export function materialRenderKey(recipe){
 return JSON.stringify(recipe,(key,value)=>['name','position','presetKey'].includes(key)?undefined:value);
}
