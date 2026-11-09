// Fresh material must follow actual cuts; crust controls change finish, not the solid.
import assert from 'node:assert/strict';
import {mkdirSync,writeFileSync} from 'node:fs';
import {openHost,openScene,weather,renderWindow,windowHeights,knob,column} from './headless.mjs';
import {encodePng} from './png.mjs';
import {ROCK_PRESETS} from '../sculpt-rock-presets.js';
const arg=(k,d)=>process.argv.includes(k)?process.argv[process.argv.indexOf(k)+1]:d;
const out=arg('--out','/private/tmp/terraform-rock-rinds/gpu');mkdirSync(out,{recursive:true});
const scene={biome:'green',ground:true,strokes:[['landform',[[50,450],[350,440],[700,470],[1000,450]],{card:{diameter:500,elevation:210,lean:180,roughness:0,softness:10,wander:25,widthVary:8,heightVary:5,cracks:20,terraces:0,styleVegetation:0}}]]};
await openHost();const s=await openScene(scene,'biome=green&mapX=4&mapY=4&erosion=0');
const rect={x:256,y:260,width:512,height:512,tile:256},set=async values=>{for(const[k,v]of Object.entries(values))await knob(s,k,v);};
const render=clay=>renderWindow(s,{...rect,...(clay?{options:s.drawOptions({clay:true})}:{})});
const png=(name,pixels)=>writeFileSync(`${out}/${name}.png`,encodePng(512,512,pixels));
const diff=(a,b,mask=null)=>{let changed=0,sum=0,n=0;for(let i=0;i<a.length;i+=4){if(mask&&!mask[i/4])continue;const d=Math.max(...[0,1,2].map(c=>Math.abs(a[i+c]-b[i+c])));changed+=d>0;sum+=d;n++;}return{changed,percent:100*changed/n,mean:sum/n};};
const settings={...ROCK_PRESETS.sandstone.knobs,strata:.5,strataContrast:.7,strataGrain:.25,faceBed:11,faceFold:10,faceBlockSize:32,faceSpall:.9,faceBreak:.55,faceRind:.85,faceRindDepth:7,faceFresh:.7,faceRindWarmth:.2,faceRindTone:-.35,faceRindRough:.65,shineRock:.45,faceWet:.05,faceGrass:.3,faceGrit:.1};
const beds={colors:[[122,126,119],[165,163,147],[93,98,92],[148,145,128],[76,82,74]],sections:[{start:0,beds:[[9,.85,0],[4,.3,1],[3,.65,2]]}],variants:{},origin:'plain'};
try{
 await weather(s);const heights=await windowHeights(s,{samples:64,step:8});await set(settings);await column(s,beds);
 const art=await render(false),clay=await render(true);png('weathered',art);png('clay',clay);
 await set({faceRind:0,faceFresh:0});const unaltered=await render(false);png('unaltered',unaltered);await set(settings);
 await knob(s,'faceRock',0);const grass=await render(false);await knob(s,'faceRock',1);const rock=await render(false);
 const mask=Array.from({length:512*512},(_,i)=>[0,1,2].some(c=>grass[i*4+c]!==rock[i*4+c]));await knob(s,'faceRock',settings.faceRock);
 const results={classPixels:mask.filter(Boolean).length,controls:{},continuity:{}};
 for(const[key,lo,hi]of [['faceFresh',0,1],['faceRind',0,1],['faceRindDepth',0,18],['faceRindTone',-.65,.65],['faceRindWarmth',0,1],['faceRindRough',0,1]]){
  await knob(s,key,lo);const a=await render(false);await knob(s,key,hi);const b=await render(false);results.controls[key]=diff(a,b,mask);assert.ok(results.controls[key].percent>=5,`${key} must move 5% of the rock class`);assert.deepEqual(await render(true),clay,`${key} must not alter the solid`);png(key+'-low',a);png(key+'-high',b);
  await knob(s,key,0);const zero=await render(false);await knob(s,key,.0001);results.continuity[key]=diff(zero,await render(false));assert.ok(results.continuity[key].mean<.1,`${key} continuous at zero`);await knob(s,key,settings[key]);console.log(key,results.controls[key]);
 }
 // Freshness has no source without cuts. Turning release back on must expose it.
 await set({faceRind:0,faceFresh:0,faceBreak:0,faceSpall:0,faceJoint:0});const intact=await render(false);await knob(s,'faceFresh',1);assert.deepEqual(await render(false),intact,'fresh contrast without cuts must do nothing');
 await knob(s,'faceBreak',1);const cutFresh=await render(false);await knob(s,'faceFresh',0);const cutPlain=await render(false);results.releasedFresh=diff(cutFresh,cutPlain,mask);assert.ok(results.releasedFresh.percent>5);png('released-fresh',cutFresh);
 await set(settings);await set({faceWet:.85});png('wet',await render(false));await set(settings);
 const partition=await render(false);s.renderer.setBudgetMB(96);assert.deepEqual(await renderWindow(s,{...rect,tile:128}),partition);s.renderer.setBudgetMB(128);
 assert.deepEqual(await windowHeights(s,{samples:64,step:8}),heights);assert.deepEqual(s.errors,[]);
 results.partitionPixelChanges=0;results.gameplayHeightChanges=0;writeFileSync(`${out}/results.json`,JSON.stringify(results,null,2));
 writeFileSync(`${out}/scene.json`,JSON.stringify({...scene,rock:settings,column:beds},null,2));
 for(const type of ['granite','basalt','limestone','gneiss']){await set(ROCK_PRESETS[type].knobs);await column(s,{...beds,sections:ROCK_PRESETS[type].sections});png(type,await render(false));}
}finally{s.dispose();}
process.exit(0);
