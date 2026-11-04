import {createShapeEngine} from '/sculpt-gpu-fields.js';
const $=id=>document.getElementById(id),log=$('log');let frame=$('editor'),stop=false,lastSpec='';
const inventory=await (await fetch('/audit/inventory.json')).json(),scenes=await (await fetch('/audit/scenes.json')).json();
const line=s=>{log.textContent+=s+'\n';log.scrollTop=log.scrollHeight;};
const save=async(name,data)=>{const r=await fetch('/audit/save/'+name,{method:'POST',body:typeof data?.arrayBuffer==='function'?data:JSON.stringify(data)});if(!r.ok)throw Error(await r.text());};
const png=async(name,c)=>save(name,await c.convertToBlob({type:'image/png'}));
const delay=ms=>new Promise(r=>setTimeout(r,ms));
async function loadOnce(biome='green',query='',units=4){const spec=[biome,query,units].join('|');if(lastSpec===spec&&frame.contentWindow.terraformAudit)return frame.contentWindow.terraformAudit;lastSpec='';try{frame.contentWindow.terraformAudit?.device?.destroy();}catch{}frame.src=`/sculpt?biome=${biome}&mapX=${units}&mapY=${units}&scratch=audit-${Date.now()}&audit=1&gpuMB=512&heapMB=2048&${query}`;const t=performance.now();await delay(50);while(!frame.contentWindow.terraformAudit||new URL(frame.contentWindow.location.href).searchParams.get('scratch')!==new URL(frame.src).searchParams.get('scratch')){if(performance.now()-t>10000)throw Error('Audit hook timeout '+biome);await delay(50);}const api=frame.contentWindow.terraformAudit;await Promise.race([api.ready(),delay(20000).then(()=>{throw Error('Ready timeout '+biome);})]);lastSpec=spec;return api;}
async function load(...args){for(let attempt=0;attempt<3;attempt++){try{return await loadOnce(...args);}catch(e){line('Reloading scene after '+e.message);if(attempt===2)throw e;}}}
function summarize(a,b){const ga=a.getContext('2d').getImageData(0,0,a.width,a.height).data,gb=b.getContext('2d').getImageData(0,0,b.width,b.height).data;let abs=0,px=0,blocks=0,total=0,max=0;for(let y=0;y<a.height;y+=16)for(let x=0;x<a.width;x+=16){let sa=[0,0,0],sb=[0,0,0],la=0,lb=0,la2=0,lb2=0,n=0;for(let j=y;j<Math.min(y+16,a.height);j++)for(let i=x;i<Math.min(x+16,a.width);i++){let k=(j*a.width+i)*4,aa=0,bb=0;n++;for(let c=0;c<3;c++){const d=Math.abs(ga[k+c]-gb[k+c]);abs+=d;max=Math.max(max,d);sa[c]+=ga[k+c];sb[c]+=gb[k+c];aa+=ga[k+c]*[.2126,.7152,.0722][c];bb+=gb[k+c]*[.2126,.7152,.0722][c];}if(Math.abs(aa-bb)>8)px++;la+=aa;lb+=bb;la2+=aa*aa;lb2+=bb*bb;}if(Math.abs(la-lb)/n>6||Math.abs(Math.sqrt(Math.max(0,la2/n-(la/n)**2))-Math.sqrt(Math.max(0,lb2/n-(lb/n)**2)))>4||Math.hypot(...sa.map((v,c)=>(v-sb[c])/n))>8)blocks++;total++;}return {meanRGB:abs/(a.width*a.height*3),maxRGB:max,changedPixels:px/(a.width*a.height),changedBlocks:blocks/total};}
async function run(name,fn){stop=false;log.textContent=name+'\n';for(const b of document.querySelectorAll('button:not(#stop)'))b.disabled=true;try{await fn();line(stop?'STOPPED':'COMPLETE');}catch(e){line('FAIL '+e.stack);}finally{for(const b of document.querySelectorAll('button'))b.disabled=false;}}
$('stop').onclick=()=>{stop=true;};
$('scenes').onclick=()=>run('Reference scene capture',async()=>{const rows=[];const names=Object.keys(scenes).sort();$('progress').max=names.length;for(const [i,name] of names.entries()){if(i<Number($('start').value))continue;if(stop||i>=Number($('start').value)+Number($('limit').value))break;const s=scenes[name];line('Loading '+name);const api=await load(s.biome,s.query||'');const t=performance.now();api.scene(s.strokes,{ground:s.ground!==false});line('Rendering '+name);const result=await Promise.race([api.capture(),delay(90000).then(()=>{throw Error('Capture timeout '+name);})]);await png(`${$('label').value}/${name}/ours.png`,result.canvas);await save(`${$('label').value}/${name}/ours-heights.json`,await api.heights());rows.push({scene:name,ms:performance.now()-t,captureMs:result.ms,stats:api.stats()});await save(`${$('label').value}/${name}/stats.json`,rows.at(-1));await save(`${$('label').value}/scenes.json`,rows);line(`${i+1}/${names.length} ${name} ${(performance.now()-t).toFixed(0)} ms`);$('progress').value=i+1;}});
function shapeContext(key,kind){
 const p={craterlets:0,shorePlates:0,fingers:0,shoreLayers:0,spurCount:0,crestJag:0,crestVary:0,crestTaper:0,craterFacets:0,iceFacets:0,crystalCount:8,crystalSize:110,crystalForm:0};
 if(['terraces','ledge','terraceJitter','faceVariation'].includes(key))Object.assign(p,{curve:{form:'mesa'},lean:1,terraces:4,ledge:.55});
 if(key.startsWith('spur')||key.startsWith('crest'))p.spurCount=4;
 if(key.startsWith('rim'))Object.assign(p,{rimSectors:4,rimUnequal:.7,rimGaps:2});
 if(key.startsWith('fissureBranch'))p.fissureBranches=3;
 if(key==='fissureCell')p.fissureNetwork=1;
 if(key.startsWith('plate')||key==='shorePlates'||key.startsWith('frost')||key.startsWith('crystalShore'))Object.assign(p,{shorePlates:1,plateMaterial:key.startsWith('frost')?2:1,plateWaterPx:100,plateLandPx:120,plateSize:40,plateGap:5,plateHeight:7});
 if(key.startsWith('finger'))Object.assign(p,{fingers:1,fingerSize:1});
 if(key.startsWith('layer')||key.startsWith('lava')||key==='shoreLayers')Object.assign(p,{shoreLayers:5,layerPx:22,layerRiser:4,layerLedge:.7,layerRough:.5,layerVary:.4,layerStyle:key.includes('Circle')||key==='layerCircle'?1:0});
 if(['crystalTiers','crystalStep','crystalFacet','crystalSizeVar','crystalSmooth'].includes(key))Object.assign(p,{crystalForm:1,crystalSize:32});
 if(key.startsWith('berg')||key==='crystalAlign')Object.assign(p,{crystalForm:2,crystalSize:200,crystalCount:3,bergTilt:.3});
 if(key.startsWith('crystalCrater')||key==='craterFacets')p.craterFacets=.7;
 if(key==='iceFacetSize'||key==='iceFacets')p.iceFacets=.7;
 if(key==='maskAmount')p.maskChannel=1;
 return p;
}
function fieldDelta(a,b){let max=0,changed=0,nonfinite=0,hmax=0,h2=0,hchange=0;const planes=[];for(const [k,aa] of [...a.floats,...a.masks].entries()){const bb=[...b.floats,...b.masks][k];let pm=0,pc=0;for(let i=0;i<aa.length;i++){const d=Math.abs(aa[i]-bb[i]);if(!Number.isFinite(d)){nonfinite++;continue;}pm=Math.max(pm,d);if(d>1e-5)pc++;if(k===0){hmax=Math.max(hmax,d);h2+=d*d;if(d>.25)hchange++;}}max=Math.max(max,pm);changed+=pc;if(pc)planes.push({plane:k,max:pm,cells:pc});}return {max,changed,nonfinite,heightMax:hmax,heightRMS:Math.sqrt(h2/a.floats[0].length),heightChangedShare:hchange/a.floats[0].length,planes};}
$('shapes').onclick=()=>run('Shape field sensitivity',async()=>{
 const api=await load(),defaults=api.config.defaults,device=api.device,rows=[],toolRows=[];
 const engine=await createShapeEngine({device,grid:384,spacing:2,baseHeight:99,sea:75,minH:-15,maxH:375,pages:false});
 const base={...defaults,radius:140,amount:70,rough:.5,softness:.55,cracks:.5,seed:2701};
 const ctx={seed:2701,baseHeight:99,sea:75,params:n=>({...base,...n.params})};
 const path=[{x:240,y:310},{x:390,y:340},{x:500,y:300}];
 const ground={kind:'ground',seed:1337,amplitude:8,wavelength:100,coverage:.8};
 const prefix=[ground,{kind:'landform',seed:22,points:[{x:330,y:330}],params:{radius:220,elevation:199,combine:0,wander:0,widthVary:0,heightVary:0,curve:{form:'lfHill'}}}];
 const runNode=async node=>{const pre=['smooth','erase','sand','grass','paint'].includes(node.kind)?prefix:[ground];const t=performance.now(),h=engine.submit([...pre,node],ctx);const out=await h.land;await h.done;return {out,ms:performance.now()-t};};
 const cases=inventory.shapes.flatMap(f=>f[3].map(kind=>({field:f,kind})));$('progress').max=cases.length;
 for(const [i,{field:f,kind}] of cases.entries()){
  if(stop)break;const [key,,,kinds,lo,hi,step,scale]=f,params={...shapeContext(key,kind)},node={kind,seed:2701,points:path,params};
  const low={...node,params:{...params,[key]:lo/scale}},high={...node,params:{...params,[key]:hi/scale}};
  const a=await runNode(low),b=await runNode(high),d=fieldDelta(a.out,b.out);
  const row={key,kind,lo:lo/scale,hi:hi/scale,context:params,...d,loMs:a.ms,hiMs:b.ms};rows.push(row);
  if(d.max===0||d.nonfinite)line(`${key}/${kind}: ${d.nonfinite?'NONFINITE':'ZERO'}; ${a.ms.toFixed(1)} / ${b.ms.toFixed(1)} ms`);
  if(i%20===0){$('progress').value=i+1;await save(`${$('label').value}/shape-controls.json`,rows);await delay(0);}
 }
 await save(`${$('label').value}/shape-controls.json`,rows);
 for(const kind of ['landform','smooth','crater','fissure','erase','crystal','sand','grass','paint']){
  const node={kind,seed:2701,points:path,params:{...shapeContext('',kind),paintChannel:1}};const b=await runNode(node);const a=await engine.run(prefix,ctx);toolRows.push({kind,ms:b.ms,...fieldDelta(a,b.out)});
 }
 await save(`${$('label').value}/tools.json`,toolRows);engine.destroy();line(`${rows.length} control/tool combinations measured. ${rows.filter(r=>r.max===0).length} zero differences.`);
});
function worldFor(group,key){
 if(/^frost|^ice/.test(key))return 'ice';
 if(/^moon|^pock|^slopeMarks$|^wrinkles$/.test(key))return 'moon';
 if(/^lava|^layerCrease|^shineSlopeGate|^shoreEdge/.test(key))return 'lava';
 if(/^baseBand|^desert|^strata/.test(key))return 'desert';
 if(/^ring|^hillLight$/.test(key)||key==='apron'||key==='beachWidth')return 'archipelago';
 if(group.includes('Shine'))return 'crystal';
 if(/^bedDots|^bedDotCell|^cracked|^shoalGrain/.test(key))return 'red';
 return 'green';
}
function worldGates(group,key){
 const x={};
 if(group==='Boulders')x.boulders=.7;
 if(group==='Debris')x.debris=.7;
 if(group==='Sand')Object.assign(x,{sand:1.2,ripple:7,rippleHeight:1.4});
 if(group==='Strata')x.strata=.8;
 if(group==='Contour bands')x.banding=.7;
 if(group.includes('Shine'))for(const mat of ['Ground','Slope','Rock','Sand','Crystal']){x['shine'+mat]=.8;x['shine'+mat+'Rough']=.4;}
 if(group==='Rock face: gullies and ribs')x.gullyDepth=6;
 if(group==='Rock face: facets')x.facetTilt=.8;
 if(group==='Rock face: follows the slope')x.cliffFollow=1;
 if(group==='Pockmarks (Moon)')x.pockmark=.7;
 if(/^moonCup/.test(key))x.moonCups=.7;
 if(/^moonRib/.test(key))x.moonRibs=.7;
 if(/^moonFold/.test(key))x.moonFolds=.7;
 if(/^bedDot/.test(key))x.bedDots=.8;
 if(/^shoalBump/.test(key))x.shoalBump=3;
 if(/^ring/.test(key))Object.assign(x,{ringContrast:.8,ringShift:8,ringPatch:.6});
 return x;
}
$('world').onclick=()=>run('World visual sensitivity',async()=>{
 const rows=[],tasks=inventory.knobs.flatMap(([group,list])=>list.map(f=>({group,f,world:worldFor(group,f[0])}))).sort((a,b)=>a.world.localeCompare(b.world));
 $('progress').max=tasks.length*3;let progress=0;
 for(const world of [$('world-filter').value])for(let w=1;w<=3;w++){
  if(stop)break;const name=`${world}-${w}`,scene=scenes[name],api=await load(world,'');api.scene(scene.strokes,{ground:scene.ground!==false});await api.idle();
  const original=new Map(api.renderer.variant),rect={x:0,y:0,width:1024,height:1024};
  for(const {group,f:[key,label,lo,hi,step]} of tasks.filter(t=>t.world===world)){
   if(stop)break;
   // Endpoints of a direction wrap are identical. Use a half turn instead.
   const high=key==='wind'||key.endsWith('Dir')?180:hi;
   const gates=worldGates(group,key),saved={};for(const k of Object.keys(gates))saved[k]=api.renderer.variant.get(k);
   for(const [k,v] of Object.entries(gates))await api.knob(k,v);
   await api.knob(key,lo);const a=await api.capture(rect);
   await api.knob(key,high);const b=await api.capture(rect);
   const delta=summarize(a.canvas,b.canvas);
   rows.push({key,group,scene:name,lo,hi:high,gates,...delta,loMs:a.ms,hiMs:b.ms});
   if(w===1){await png(`${$('label').value}/world/${key}/lo.png`,a.canvas);await png(`${$('label').value}/world/${key}/hi.png`,b.canvas);}
   for(const [k,v] of Object.entries(saved))await api.knob(k,v??api.config.defaults[k]??0);
   await api.knob(key,original.get(key)??api.config.defaults[key]??0);
   progress++;$('progress').value=progress;if(progress%5===0){line(`${progress}/${tasks.length*3} ${name} ${key}: ${(delta.changedBlocks*100).toFixed(1)}% blocks`);await save(`${$('label').value}/world-${$('world-filter').value}.json`,rows);}
  }
 }
 await save(`${$('label').value}/world-${$('world-filter').value}.json`,rows);
});
$('perf').onclick=()=>run('Pipeline alternatives',async()=>{
 const rows=[],cases=[Object.keys(scenes).sort()[Number($('start').value)]];$('progress').max=cases.length;
 for(const [i,name] of cases.entries()){
  if(stop)break;const s=scenes[name],api=await load(s.biome,s.query||'');api.scene(s.strokes,{ground:s.ground!==false});const base=await api.capture();const baseStats=api.stats();await png(`${$('label').value}/perf/${name}/default.png`,base.canvas);
  for(const [key,value,id] of [['erosionAge',16,'relax16'],['reliefOctaves',3,'relief3']]){
   const old=api.renderer.variant.get(key)??api.config.defaults[key],started=performance.now();await api.knob(key,value);const trial=await api.capture(),settledMs=performance.now()-started;await png(`${$('label').value}/perf/${name}/${id}.png`,trial.canvas);rows.push({scene:name,candidate:id,baseMs:base.ms,trialMs:trial.ms,settledMs,baseStats,stats:api.stats(),...summarize(base.canvas,trial.canvas)});await api.knob(key,old);
  }
  await save(`${$('label').value}/performance-${name}.json`,rows);line(name+' measured');$('progress').value=i+1;
 }
});

$('regressions').onclick=()=>run('GPU regression and alternative suite',async()=>{
 const api=await load('green'),device=api.device,defaults=api.config.defaults;
 const {GpuErosion:Before}=await import('/audit/erosion-before.js'),{GpuErosion:After}=await import('/sculpt-erosion.js'),{readBuffer}=await import('/sculpt-gpu-fields.js');
 const code=api.renderer.preprocessShader(await (await fetch('/engine-erosion.wgsl')).text()),before=new Before(api.renderer,code),after=new After(api.renderer,code);
 const result={alternative:[],tools:[],basic:[],conditional:[],maskErase:null,shapePerformance:[]};
 const base={...defaults,radius:140,amount:70,rough:.5,softness:.55,cracks:.5,seed:2701,craterlets:0,shorePlates:0,fingers:0,shoreLayers:0,spurCount:0,iceFacets:0,craterFacets:0};
 const ctx={seed:2701,baseHeight:99,sea:75,params:n=>({...base,...n.params}),frost:{gaps:.3,gapSize:11,gapDepth:3,gapReach:.7}};
 const ground={kind:'ground',seed:1337,amplitude:8,wavelength:100,coverage:.8},path=[{x:240,y:310},{x:390,y:340},{x:500,y:300}];
 const hill={kind:'landform',seed:22,points:[{x:330,y:330}],params:{radius:220,elevation:199,combine:0,wander:0,widthVary:0,heightVary:0,curve:{form:'lfHill'}}};
 const e=await createShapeEngine({device,grid:384,spacing:2,baseHeight:99,sea:75,minH:-15,maxH:375});
 const run=async list=>{const t=performance.now(),h=e.submit(list,ctx);const out=await h.land;await h.done;return {out,ms:performance.now()-t,stats:e.stats().last};};
 for(const kind of ['landform','smooth','crater','fissure','erase','crystal','sand','grass','paint']){
  const pre=['smooth','erase'].includes(kind)?[ground,hill]:kind==='grass'?[ground,{kind:'sand',seed:1,points:path,params:{amount:100}}]:[ground];
  const a=await run(pre),b=await run([...pre,{kind,seed:2701,points:path,params:{...shapeContext('',kind),paintChannel:1}}]);result.tools.push({kind,...fieldDelta(a.out,b.out),ms:b.ms});
 }
 const fields=[['radius',40,200],['amount',20,140],['rough',0,1],['softness',0,1],['cracks',0,1],['seed',11,29]];
 for(const kind of ['landform','smooth','crater','fissure','erase','crystal','sand','grass','paint'])for(const [key,lo,hi] of fields){
  const pre=['smooth','erase'].includes(kind)?[ground,hill]:kind==='grass'?[ground,{kind:'sand',seed:1,points:path,params:{amount:100}}]:[ground];
  const n={kind,seed:2701,points:path,params:{}};const a=await run([...pre,{...n,seed:key==='seed'?lo:2701,params:{[key]:lo}}]),b=await run([...pre,{...n,seed:key==='seed'?hi:2701,params:{[key]:hi}}]);result.basic.push({key,kind,lo,hi,...fieldDelta(a.out,b.out)});
 }
 const initialMasks=await run([ground,...[18,20,22,24].map(paintChannel=>({kind:'paint',points:[{x:350,y:350}],params:{paintChannel,amount:100,radius:100,rough:0,softness:0}}))]);
 const erased=await run([ground,...[18,20,22,24,7].map(paintChannel=>({kind:'paint',points:[{x:350,y:350}],params:{paintChannel,amount:100,radius:100,rough:0,softness:0}}))]);
 result.maskErase={before:[14,15,16,17].map(i=>initialMasks.out.masks[i][175*384+175]),after:[14,15,16,17].map(i=>erased.out.masks[i][175*384+175])};
 for(const key of ['shorePlates','plateWaterPx','plateLandPx','plateSize','plateGap','plateHeight','plateMaterial','frostNeedles','crystalShoreSeam']){
  const f=inventory.shapes.find(f=>f[0]===key),kind='landform',params={...shapeContext(key,kind),elevation:20,combine:1,curve:{form:'lfShore'}};   // cut below the sea of 75
  for(const lean of [0]){const n={kind,seed:2701,points:path,params:{...params,lean}};const a=await run([ground,{...n,params:{...n.params,[key]:f[4]/f[7]}}]),b=await run([ground,{...n,params:{...n.params,[key]:f[5]/f[7]}}]);result.conditional.push({key,kind,lean,amount:params.amount,...fieldDelta(a.out,b.out)});}
 }
 for(const [kind,params] of [['landform',{curve:{form:'lfHill'}}],['landform',{spurCount:12,spurForks:2,iceFacets:1,curve:{form:'lfMountain'}}],['landform',{elevation:20,combine:1,stepReference:2,terraces:12,fingers:1.5,curve:{form:'lfShore'}}],['crater',{craterlets:12,craterEjecta:1,craterFacets:1}],['crystal',{crystalCount:24,crystalSize:100}],['smooth',{}]]){
  const times=[];for(let i=0;i<8;i++){const r=await run([ground,hill,{kind,seed:2701,points:path,params}]);if(i)times.push(r.stats);}
  result.shapePerformance.push({kind,params,times});
 }
 e.destroy();await save(`${$('label').value}/regressions.json`,result);line('Tools, basic controls, conditional controls and erase verified.');
 const cleanup=w=>[w.weather,...w.maps].forEach(b=>b.destroy());
 for(const grid of [256,512,768]){
  const engine=await createShapeEngine({device,grid,spacing:2,baseHeight:99,sea:75,minH:-15,maxH:375});
  await engine.run([ground,{...hill,points:[{x:grid,y:grid}],params:{radius:grid*.65,amount:130}}],ctx);
  for(const rain of grid===512?[0,1]:[0]){
   const request={planes:engine.planes,masks:engine.masks,rateMask:14,grid,size:grid*2,spacing:2,seaLevel:75,age:200,rain,talusAngle:40,envelope:.12,sand:0,wetReach:3,talusFull:2.5,wearFull:1.5,flowK:30};
   const times={before:[],after:[]};let comparison;
   for(let i=0;i<6;i++){
    const outputs={};for(const [name,algo] of i%2?[['after',after],['before',before]]:[['before',before],['after',after]]){outputs[name]=await algo.runGpu(request);if(i)times[name].push({wall:outputs[name].milliseconds,gpuWait:outputs[name].parts.gpu});}
    if(i===0){comparison={heightMax:0,heightChanged:0,mapBytesChanged:0,nonfinite:0};const [a,b]=await Promise.all([readBuffer(device,outputs.before.weather,grid*grid*4,grid*grid*4),readBuffer(device,outputs.after.weather,grid*grid*4,grid*grid*4)]);const aa=new Float32Array(a),bb=new Float32Array(b);for(let j=0;j<aa.length;j++){const d=Math.abs(aa[j]-bb[j]);comparison.heightMax=Math.max(comparison.heightMax,d);if(d)comparison.heightChanged++;if(!Number.isFinite(d))comparison.nonfinite++;}for(let k=0;k<3;k++){const [a,b]=await Promise.all([readBuffer(device,outputs.before.maps[k],0,grid*grid*4),readBuffer(device,outputs.after.maps[k],0,grid*grid*4)]);const aa=new Uint8Array(a),bb=new Uint8Array(b);for(let j=0;j<aa.length;j++)if(aa[j]!==bb[j])comparison.mapBytesChanged++;}}
    cleanup(outputs.before);cleanup(outputs.after);
   }
   result.alternative.push({grid,rain,age:200,envelope:.12,...comparison,times});await save(`${$('label').value}/regressions.json`,result);line(`${grid}² rain=${rain}: height max ${comparison.heightMax}, map byte differences ${comparison.mapBytesChanged}`);
  }
  engine.destroy();
 }
});
$('scale').onclick=()=>run('40×40 bounded-window editing',async()=>{
 const api=await load($('world-filter').value,'gpuPages=force',40),scene=scenes[$('world-filter').value+'-1'];
 const strokes=[];for(let y=0;y<20;y++)for(let x=0;x<20;x++)strokes.push(['landform',[[x*1024+360,y*1024+370],[x*1024+650,y*1024+500]],{card:{diameter:360},curve:{form:'lfHill'}}]);
 api.scene(strokes,{ground:true});const rows=[];
 for(const [x,y] of [[0,0],[19000,0],[0,19000],[19000,19000]]){const t=performance.now(),r=await api.capture({x,y,width:1024,height:1024});rows.push({x,y,wallMs:performance.now()-t,bakeMs:r.ms,stats:api.stats()});await png(`${$('label').value}/scale/${$('world-filter').value}-${x}-${y}.png`,r.canvas);line(`window ${x},${y}: ${rows.at(-1).wallMs.toFixed(0)}ms`);}
 for(let i=0;i<5;i++){const t=performance.now();await api.edit(1,{amount:75+i*5});const r=await api.capture();rows.push({edit:i,wallMs:performance.now()-t,bakeMs:r.ms,stats:api.stats()});}
 await save(`${$('label').value}/scale-${$('world-filter').value}.json`,{map:api.config.map,shapes:strokes.length,rows});
});
$('diagnostic').onclick=()=>run('Conditional controls on explicit feature fixtures',async()=>{
 const world=$('world-filter').value,api=await load(world),rows=[];
 const fixture=[['landform',[[270,300],[550,300]],{card:{diameter:400,heightReference:1,elevation:134,cracks:100}}],['landform',[[800,150],[860,430]],{card:{diameter:320,heightReference:1,elevation:154,cracks:100,wander:8,widthVary:0},curve:{form:'lfMountain'}}],['landform',[[0,850],[1024,850]],{card:{diameter:600,heightReference:1,elevation:-55,combine:1,cracks:0,shorePlates:1,plateMaterial:world==='ice'?2:1},curve:{form:'lfShore'},waterShore:0,waterDeep:0,waterBed:0}],['sand',[[350,470],[650,470]],{card:{diameter:280,amount:100}}],['paint',[[350,100],[500,270]],{card:{diameter:220,amount:100,paintChannel:1}}]];
 api.scene(fixture,{ground:true});await api.idle();const original=new Map(api.renderer.variant);
 const keys=world==='desert'?['strataContrast']:world==='zhon'?['beachWidth','apron']:world==='ice'?['frostGaps','frostGapReach','frostGapSize','frostGapDepth','mineralDetail','iceFrost']:world==='green'?['faceEdge','gullyRock','mineralDetail','rockOrder']:world==='archipelago'?['ringShiftDir','beachWidth','apron']:world==='crystal'?['shineSand','shineSandSharp','shineSandRough','shineSandScale']:['undulationScale','undulationCover','sandCrown','faceEdge','gullyRock','bedHeight','bedVary','bedDipDir','grooveSpacing','grooveAngle','grooveRun','bandWater','sandBanding','sandBandSpacing','shallowDepth','deepDepth','waterSoft','bankRock','bedPunch','cliffStagger','mineralDetail','debris','debrisReach','debrisSize','debrisSort','repose','facetCoarse','cliffDomain','crackWidth','crackHairline','boulderRound'];
 const tasks=inventory.knobs.flatMap(([group,list])=>list.map(f=>({group,f}))).filter(t=>keys.includes(t.f[0]));
 for(const {group,f:[key,,lo,hi,step]} of tasks){
  if(stop)break;const gates={...worldGates(group,key),undulation:10};
  if(group.startsWith('Rock')||['faceEdge','gullyRock'].includes(key))Object.assign(gates,{rockOrder:1,bedLedge:.7,jointDepth:4,bedDip:.7,cliffFollow:key==='cliffStagger'||key==='cliffDomain'?1:0,cliffStagger:.5,blocks:0});
  if(group==='Contour bands')Object.assign(gates,{banding:.8,sandBanding:.8});
  if(['shallowDepth','deepDepth','waterSoft','bandWater'].includes(key))Object.assign(gates,{deepEdge:0});
  if(key.startsWith('ring'))Object.assign(gates,{ringContrast:1,ringShift:20});
  if(key.startsWith('frost'))gates.frostGaps=.35;
  const saved={};for(const [k,v] of Object.entries(gates)){saved[k]=api.renderer.variant.get(k);await api.knob(k,v);}
  const high=key.endsWith('Dir')?180:hi;await api.knob(key,lo);const a=await api.capture();await api.knob(key,high);const b=await api.capture();
  const row={key,world,lo,hi:high,gates,...summarize(a.canvas,b.canvas)};
  await png(`${$('label').value}/diagnostic/${world}/${key}-lo.png`,a.canvas);await png(`${$('label').value}/diagnostic/${world}/${key}-hi.png`,b.canvas);
  const midA=lo+(high-lo)*.3,midB=lo+(high-lo)*.7;await api.knob(key,midA);const ma=await api.capture();await api.knob(key,midB);const mb=await api.capture();row.operatingRange={lo:midA,hi:midB,...summarize(ma.canvas,mb.canvas)};rows.push(row);
  for(const [k,v] of Object.entries(saved))await api.knob(k,v??api.config.defaults[k]??0);await api.knob(key,original.get(key)??api.config.defaults[key]??0);
  await save(`${$('label').value}/diagnostic-${world}.json`,rows);line(`${key}: ${(row.changedBlocks*100).toFixed(1)}% endpoint / ${(row.operatingRange.changedBlocks*100).toFixed(1)}% operating blocks`);
 }
});
$('features').onclick=()=>run('Feature placement and metadata sensitivity',async()=>{
 const api=await load('green'),f=api.features,rows=[],base={density:40,clustering:.5,gap:1,seed:2701,margin:0,radius:220};api.scene([],{ground:false});await api.idle();api.setBusy(false);
 const clean=()=>f.load({features:[],starts:[{x:500,z:500},{x:1600,z:1600}],fill:base});
 const region={type:'brush',points:[[500,500],[900,600]],radius:220};
 for(const [key,lo,hi] of [['density',5,85],['clustering',0,1],['gap',0,5],['seed',1,29],['margin',0,300],['radius',64,320]]){
  const samples=[];for(const value of [lo,hi]){clean();const options={...base,[key]:value};f.setFill(options);const t=performance.now();f.fillRegion('tree',key==='radius'?{...region,radius:value}:region,options);samples.push({value,ms:performance.now()-t,data:f.serialize().features});}
  rows.push({key,loCount:samples[0].data.length,hiCount:samples[1].data.length,changed:JSON.stringify(samples[0].data)!==JSON.stringify(samples[1].data),loMs:samples[0].ms,hiMs:samples[1].ms});
 }
 for(const kind of ['tree','foliage','rock']){clean();const t=performance.now();f.fillRegion(kind,region,base);rows.push({key:'kind:'+kind,count:f.serialize().features.length,ms:performance.now()-t});}
 for(const [type,r] of [['brush',region],['lasso',{type:'lasso',points:[[400,400],[900,400],[900,700],[400,700]]}],['flood',{type:'flood',x:500,z:500}]]){clean();const t=performance.now();f.fillRegion('tree',r,{...base,density:8});rows.push({key:'region:'+type,count:f.serialize().features.length,ms:performance.now()-t});}
 clean();const starts0=f.serialize().starts;f.addStart(900,900);f.moveStart(0,600,550);const starts1=f.serialize().starts;f.removeStart(2);const saved=f.serialize();f.load(saved);rows.push({key:'starts',before:starts0,after:starts1,roundtrip:JSON.stringify(saved)===JSON.stringify(f.serialize())});
 const original=api.metadata.serialize(),settings={minWind:7,maxWind:23,tidal:19,solar:13,gravity:111,surfaceMetal:9,mohoMetal:22,lava:true};api.metadata.load({name:'Audit fixture',description:'Metadata sensitivity fixture',settings});rows.push({key:'metadata',expected:settings,actual:api.metadata.serialize(),roundtrip:JSON.stringify(api.metadata.serialize().settings)===JSON.stringify(settings)});api.metadata.load(original);clean();api.setBusy(true);
 await save(`${$('label').value}/feature-controls.json`,rows);for(const r of rows)line(JSON.stringify(r));
});
$('internal').onclick=()=>run('Preset/internal sensitivity',async()=>{
 const world=$('world-filter').value,api=await load(world),all=await(await fetch('/audit/defaults.json')).json(),known=new Set([...inventory.shapes.map(f=>f[0]),...inventory.knobs.flatMap(([,l])=>l.map(f=>f[0]))]),rows=[];
 const fixture=[['landform',[[280,270],[550,300]],{card:{diameter:420,heightReference:1,elevation:134,cracks:100}}],['landform',[[800,120],[880,400]],{card:{diameter:320,heightReference:1,elevation:174,cracks:100,wander:8,widthVary:0},curve:{form:'lfMountain'}}],['landform',[[0,830],[1000,830]],{card:{diameter:620,heightReference:1,elevation:-55,combine:1,cracks:0,shorePlates:1,plateMaterial:world==='ice'?2:1},curve:{form:'lfShore'},waterBed:0,waterDeep:0,waterShore:0}],['crater',[[760,600]],{card:{diameter:300,amount:65,craterFacets:100,crystalCraterSkin:100}}]];
 const ranges={blockRow:[2,16],blockWidth:[3,20],blockStep:[0,2],blockChip:[0,4],columnContrast:[0,2],crystalCraterWebPx:[6,30],crystalCraterLight:[0,2],crystalShallowPx:[4,30],crystalSeamEnd:[.55,.95],crystalFace:[0,2],crystalTone:[0,2],crystalSeam:[0,2],erosionAge:[16,200],erosionRain:[0,1],talusAngle:[25,65],faceStreakFrom:[.1,1.5],rillDepth:[0,4],rillSpacing:[4,24],stoneSize:[2,16],outcrop:[0,2],cavity:[0,2],closeShadow:[0,2],microRock:[0,2]};
 const assignment=k=>k.startsWith('crystal')?'crystal':['shadeBlue','frostWet'].includes(k)?'ice':'green';
 const keys=Object.keys(all.defaults).filter(k=>!known.has(k)&&!['groundPattern'].includes(k)&&assignment(k)===world);
 const original=new Map(api.renderer.variant);
 for(const key of keys){
  if(stop)break;const gates={};if(key.startsWith('block')||key==='hillBlocks')Object.assign(gates,{blocks:1,rockOrder:1,hillBlocks:1});if(key.startsWith('crystalCrater'))Object.assign(gates,{crystalCraterWeb:1});if(key.startsWith('crystalShallow'))gates.crystalShallow=1;if(key.startsWith('rill'))gates.rillDepth=3;if(key.startsWith('stone'))gates.stoneDensity=1;
  const saved={};for(const [k,v] of Object.entries(gates)){saved[k]=api.renderer.variant.get(k);await api.knob(k,v);}
  const [lo,hi]=ranges[key]||[0,1];const outputs=[];for(const value of [lo,hi]){await api.knob(key,value);api.scene(fixture,{ground:true});outputs.push(await api.capture());}
  const row={key,world,lo,hi,gates,...summarize(outputs[0].canvas,outputs[1].canvas)};rows.push(row);await save(`${$('label').value}/internal-${world}.json`,rows);line(`${key}: ${(row.changedBlocks*100).toFixed(1)}% blocks, max RGB ${row.maxRGB}`);
  for(const [k,v] of Object.entries(saved))await api.knob(k,v??api.config.defaults[k]??0);await api.knob(key,original.get(key)??all.defaults[key]);
 }
});
$('repeat-perf').onclick=()=>run('Warm interleaved alternatives',async()=>{
 const name=Object.keys(scenes).sort()[Number($('start').value)],s=scenes[name],api=await load(s.biome,s.query||''),rows=[];
 api.scene(s.strokes,{ground:s.ground!==false});await api.capture();
 for(const [key,value] of [['reliefOctaves',3],['erosionAge',16]]){
  const original=api.renderer.variant.get(key)??api.config.defaults[key];
  for(let i=0;i<6;i++)for(const [label,v] of i%2?[['trial',value],['default',original]]:[['default',original],['trial',value]]){
   const t=performance.now();await api.knob(key,v);const c=await api.capture();rows.push({scene:name,key,label,iteration:i,captureMs:c.ms,settledMs:performance.now()-t,refinementMs:api.stats().gpuErosionMs});
  }await api.knob(key,original);
 }
 await save(`${$('label').value}/repeat-${name}.json`,rows);line(name+' complete; discard iteration zero for warm medians');
});

$('surface').onclick=()=>run('Surface and legacy-control sensitivity',async()=>{
 const world=$('world-filter').value,api=await load(world),s=scenes[world+'-1'];api.scene(s.strokes,{ground:s.ground!==false});const rows=[];
 for(const [id,lo,hi] of [['relief',0,160],['transition-detail',0,100],['mineral-ring',0,100],['ring-spread',0,100],['ring-variation',0,100],['scree',0,100],['material-weathering',0,100],['deposit-spread',0,100]]){
  const original=frame.contentDocument.getElementById(id).value;await api.control(id,lo);const a=await api.capture();await api.control(id,hi);const b=await api.capture();await api.control(id,original);const r={key:id,world,lo,hi,...summarize(a.canvas,b.canvas)};rows.push(r);line(`${id}: ${(r.changedBlocks*100).toFixed(1)}% blocks, max RGB ${r.maxRGB}`);
 }await save(`${$('label').value}/surface-${world}.json`,rows);
});

$('feature-perf').onclick=()=>run('Bounded feature-fill comparison',async()=>{
 const api=await load('green'),{mountMapFeatures:before}=await import('/audit/features-before.js'),{mountMapFeatures:after}=await import('/sculpt-features.js'),rows=[],checks=[],catalog=await(await fetch('/map-features/green/catalog.json')).json();
 for(const units of [4,40]){
  const play=units*512,config={...api.config,map:{...api.config.map,unitsX:units,unitsY:units,playRight:play,playBottom:play}},counts=[0,0];
  const instances=await Promise.all([before,after].map((mount,i)=>mount({config,canvas:document.createElement('canvas'),host:document.createElement('div'),enabled:()=>true,change:()=>{},schedule:()=>{},pick:()=>({x:0,z:0}),screenPoint:()=>({x:0,z:0}),sample:(x,z)=>{counts[i]++;return z>play*.8?60:99+8*Math.sin(x/80)*Math.cos(z/60);}})));
  const cases=[['brush',{type:'brush',points:[[500,500],[900,600]],radius:220},40],['edge',{type:'brush',points:[[-60,-20],[160,100]],radius:120},85],['lasso',{type:'lasso',points:[[400,400],[900,400],[900,700],[400,700]]},40],['concave',{type:'lasso',points:[[400,400],[900,400],[600,550],[900,700],[400,700]]},40],['flood',{type:'flood',x:500,z:500},units===40?.02:8]];
  for(const [name,region,density] of cases){const trials=[];for(let repeat=0;repeat<3;repeat++){
   const pair=[];for(const i of repeat%2?[1,0]:[0,1]){const f=instances[i];f.load({features:[],starts:[{x:500,z:500},{x:play-100,z:play-100}],fill:{density,seed:2701,margin:96}});counts[i]=0;const t=performance.now();f.fillRegion('tree',region,{density,seed:2701,margin:96});pair[i]={ms:performance.now()-t,samples:counts[i],features:f.serialize().features};}trials.push({beforeMs:pair[0].ms,afterMs:pair[1].ms,beforeSamples:pair[0].samples,afterSamples:pair[1].samples,count:pair[0].features.length,identical:JSON.stringify(pair[0].features)===JSON.stringify(pair[1].features)});
  }rows.push({units,region:name,trials});line(`${units} units ${name}: identical=${trials.every(r=>r.identical)}, ${trials[1].beforeMs.toFixed(1)} -> ${trials[1].afterMs.toFixed(1)} ms`);await save(`${$('label').value}/feature-performance.json`,rows);}
  if(units===4)for(const kind of ['tree','foliage','rock'])for(const seed of [0,4294967295]){
   const initial=catalog.features.filter(d=>d.kind==='deposit').slice(0,1).map(d=>({name:d.name,x:38,z:35}));
   const out=instances.map(f=>{f.load({features:initial,starts:[{x:500,z:500}],fill:{seed}});f.fillRegion(kind,{type:'brush',points:[[450,400],[1000,700]],radius:200},{density:40,seed,margin:96});f.fillRegion(kind,{type:'lasso',points:[[450,400],[1000,400],[1000,700],[450,700]]},{density:85,seed,margin:96});return f.serialize();});
   checks.push({kind,seed,count:out[0].features.length,identical:JSON.stringify(out[0])===JSON.stringify(out[1])});
  }
 }
 await save(`${$('label').value}/feature-regressions.json`,checks);line('Mixed fills, existing deposits, overlapping regions and alternate seeds: '+checks.every(c=>c.identical));
});

$('ground-source').onclick=()=>run('Ground source selection',async()=>{
 const rows=[],s=scenes['green-1'];let api=await load('green');api.scene(s.strokes,{ground:s.ground!==false});const first=await api.capture(),original=new OffscreenCanvas(first.canvas.width,first.canvas.height);original.getContext('2d').drawImage(first.canvas,0,0);await png(`${$('label').value}/ground-source/default.png`,original);
 for(const [key,query] of [['groundPattern','groundPattern=desert']]){api=await load('green',query);api.scene(s.strokes,{ground:s.ground!==false});const trial=await api.capture(),r={key,query,...summarize(original,trial.canvas)};rows.push(r);await png(`${$('label').value}/ground-source/${key}.png`,trial.canvas);line(`${key}: ${(r.changedBlocks*100).toFixed(1)}% blocks`);}
 await save(`${$('label').value}/ground-source.json`,rows);
});
