// Authored 1x cliff fixture: geological starting points and geometry-control impact.
import assert from 'node:assert/strict';
import {mkdirSync,writeFileSync} from 'node:fs';
import {openHost,openScene,weather,renderWindow,windowHeights,knob,column} from './headless.mjs';
import {encodePng} from './png.mjs';
import {ROCK_PRESETS} from '../sculpt-rock-presets.js';
const arg=(k,d)=>process.argv.includes(k)?process.argv[process.argv.indexOf(k)+1]:d;
const out=arg('--out','/private/tmp/terraform-rock-controls/gpu');mkdirSync(out,{recursive:true});
const scene={biome:'green',ground:true,strokes:[['landform',[[50,450],[350,440],[700,470],[1000,450]],{card:{diameter:500,elevation:210,lean:180,roughness:0,softness:10,wander:25,widthVary:8,heightVary:5,cracks:20,terraces:0,styleVegetation:0}}]]};
await openHost();
const s=await openScene(scene,'biome=green&mapX=4&mapY=4&erosion=0&scratch=rock-controls');
const rect={x:256,y:260,width:512,height:512,tile:256};
const difference=(a,b)=>{let pixels=0,max=0;for(let i=0;i<a.length;i+=4){const d=Math.max(...[0,1,2].map(c=>Math.abs(a[i+c]-b[i+c])));if(d)pixels++;max=Math.max(max,d);}return{pixels,percent:100*pixels/(a.length/4),max};};
const set=async values=>{for(const [k,v]of Object.entries(values))await knob(s,k,v);};
const png=(name,pixels)=>writeFileSync(`${out}/${name}.png`,encodePng(rect.width,rect.height,pixels));
try{
 await weather(s);const heights=await windowHeights(s,{samples:64,step:8});
 const baseline=await renderWindow(s,rect);png('default',baseline);
 for(const [key,p]of Object.entries(ROCK_PRESETS)){
  await set(p.knobs);await column(s,{...s.worldColumn.column,sections:p.sections,variants:{}});
  const art=await renderWindow(s,rect);png(key,art);png(key+'-clay',await renderWindow(s,{...rect,options:s.drawOptions({clay:true})}));
  assert.ok(difference(art,baseline).percent>5,`${key} must change the rock`);
  if(['gneiss','schist','conglomerate','breccia'].includes(key)){
   s.renderer.setBudgetMB(96);assert.deepEqual(await renderWindow(s,{...rect,tile:128}),art,`${key}: chunk and budget invariance`);s.renderer.setBudgetMB(128);
  }
 }
 await set(ROCK_PRESETS.sandstone.knobs);await column(s,{...s.worldColumn.column,sections:ROCK_PRESETS.sandstone.sections,variants:{}});
 await set({faceGrit:1,faceScratch:4,faceBlock:4,faceLamina:1.5});
 const tests={faceJointTilt:[-40,40],faceScaleVary:[0,1],faceFold:[0,40],faceSpall:[0,3],faceClast:[0,3],faceClastSize:[4,26],faceMineral:[0,1],faceStretch:[.5,3],faceBlockHeight:[.4,4],faceRound:[0,1],faceJoint:[0,2],faceExtrude:[-.7,.7],faceLamina:[0,2],faceLaminaSize:[6,14],faceScratchLength:[6,130],faceScratchAngle:[-45,45],faceGritSize:[1,5],faceWet:[0,1],shineRock:[0,1],shineRockSharp:[4,64],shineRockRough:[0,1]};
 await knob(s,'faceRock',0);const withoutRock=await renderWindow(s,rect);await knob(s,'faceRock',1);const withRock=await renderWindow(s,rect);
 const rockMask=Array.from({length:rect.width*rect.height},(_,i)=>[0,1,2].some(c=>withoutRock[i*4+c]!==withRock[i*4+c]));
 const rockPixels=rockMask.filter(Boolean).length;
 const classPercent=(a,b)=>100*rockMask.reduce((n,on,i)=>n+(on&&[0,1,2].some(c=>a[i*4+c]!==b[i*4+c])?1:0),0)/rockPixels;
 const impact={};
 for(const [key,[lo,hi]]of Object.entries(tests)){
  const old=s.renderer.variant.get(key),clast=s.renderer.variant.get('faceClast');if(key==='faceClastSize')await knob(s,'faceClast',2.5);await knob(s,key,lo);const a=await renderWindow(s,rect);await knob(s,key,hi);const b=await renderWindow(s,rect);await knob(s,key,old);if(key==='faceClastSize')await knob(s,'faceClast',clast);
  impact[key]={...difference(a,b),classPercent:classPercent(a,b)};console.log(key,JSON.stringify(impact[key]));assert.ok(impact[key].classPercent>=5,`${key}: less than 5% of the rock class at 1x`);
 }
 const continuity={},continuityClay={};
 // Only amplitudes cross zero. Positive spacing/size controls translate a
 // discrete 1px lattice; their tiny spatial shifts need not keep identical pixels.
 for(const key of ['faceJointTilt','faceScaleVary','faceFold','faceSpall','faceClast','faceMineral','faceRound','faceJoint','faceExtrude','faceLamina']){
  const old=s.renderer.variant.get(key),lo=0;await knob(s,key,lo);const a=await renderWindow(s,rect),ac=await renderWindow(s,{...rect,options:s.drawOptions({clay:true})});await knob(s,key,lo+.0001);const b=await renderWindow(s,rect),bc=await renderWindow(s,{...rect,options:s.drawOptions({clay:true})});await knob(s,key,old);
  continuity[key]=b.reduce((n,v,i)=>n+Math.abs(v-a[i]),0)/b.length;continuityClay[key]=bc.reduce((n,v,i)=>n+Math.abs(v-ac[i]),0)/bc.length;console.log('continuity',key,continuity[key],continuityClay[key]);
  // Coatings and polish amplify palette-bin crossings at moving 1px edges.
  // Bound Art below 0.08% of full scale and check the solid separately.
  assert.ok(continuity[key]<.2,`${key}: discontinuous material low end`);assert.ok(continuityClay[key]<.1,`${key}: discontinuous solid low end`);
 }
 assert.deepEqual(await windowHeights(s,{samples:64,step:8}),heights,'surface-only controls must not alter gameplay heights');
 const a=await renderWindow(s,rect);s.renderer.setBudgetMB(96);const b=await renderWindow(s,{...rect,tile:128});assert.deepEqual(b,a,'nondefault solids must be independent of chunk size and budget');
 assert.deepEqual(s.errors,[]);writeFileSync(`${out}/impact.json`,JSON.stringify({rockPixels,impact,continuity,continuityClay,gameplayHeightChanges:0,partitionPixelChanges:0},null,2));
 // A second authored shape exposes several face directions and the crown.
 await set(ROCK_PRESETS.gneiss.knobs);await column(s,{...s.worldColumn.column,sections:ROCK_PRESETS.gneiss.sections,variants:{}});
 s.renderer.setBudgetMB(128);s.play([['mountain',[[340,560],[610,460]],{card:{diameter:500,elevation:280,roughness:20,softness:20,styleVegetation:0}}]],{ground:true});await weather(s);
 png('mountain',await renderWindow(s,rect));png('mountain-clay',await renderWindow(s,{...rect,options:s.drawOptions({clay:true})}));assert.deepEqual(s.errors,[]);
}finally{s.dispose();}
process.exit(0);
