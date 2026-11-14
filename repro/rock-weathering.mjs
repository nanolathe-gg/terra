// Authored 1x weathering fixture: transport, relief, paint, continuity and chunk invariance.
import assert from 'node:assert/strict';
import {mkdirSync,writeFileSync} from 'node:fs';
import {openHost,openScene,weather,renderWindow,windowHeights,knob,column} from './headless.mjs';
import {encodePng} from './png.mjs';
import {ROCK_PRESETS} from '../sculpt-rock-presets.js';
const arg=(k,d)=>process.argv.includes(k)?process.argv[process.argv.indexOf(k)+1]:d;
const out=arg('--out','/tmp/terraform-rock-weathering/gpu');mkdirSync(out,{recursive:true});
const scene={biome:'green',ground:true,strokes:[['landform',[[50,450],[350,440],[700,470],[1000,450]],{card:{diameter:500,elevation:210,lean:180,roughness:0,softness:10,wander:25,widthVary:8,heightVary:5,cracks:20,terraces:0,styleVegetation:0}}]]};
await openHost();
const s=await openScene(scene,'biome=green&mapX=4&mapY=4&erosion=0&scratch=rock-weathering');
// Read only for the check. The editor never reads the transport texture back.
const create=s.renderer.device.createTexture.bind(s.renderer.device);
s.renderer.device.createTexture=d=>create({...d,usage:d.usage|(d.label==='rock weather field'?GPUTextureUsage.COPY_SRC:0)});
const rect={x:256,y:260,width:512,height:512,tile:256};
const set=async values=>{for(const [k,v]of Object.entries(values))await knob(s,k,v);};
const png=(name,pixels)=>writeFileSync(`${out}/${name}.png`,encodePng(rect.width,rect.height,pixels));
const difference=(a,b,mask=null)=>{let pixels=0,total=0,max=0,sum=0;for(let i=0;i<a.length;i+=4){if(mask&&!mask[i/4])continue;total++;const d=Math.max(...[0,1,2].map(c=>Math.abs(a[i+c]-b[i+c])));if(d)pixels++;max=Math.max(max,d);sum+=d;}return{pixels,percent:100*pixels/total,max,mean:sum/total};};
try{
 await weather(s);const heights=await windowHeights(s,{samples:64,step:8});
 await set(ROCK_PRESETS.sandstone.knobs);await column(s,{...s.worldColumn.column,sections:ROCK_PRESETS.sandstone.sections,variants:{}});
 await set({runoff:0,debrisAmount:0,looseSupply:0});const before=await renderWindow(s,rect);png('before',before);
 await set({runoff:.8,debrisAmount:1.1,debrisReach:80,debrisDepth:5});const after=await renderWindow(s,rect);png('after',after);png('clay',await renderWindow(s,{...rect,options:s.drawOptions({clay:true})}));
 const affected=Array.from({length:rect.width*rect.height},(_,i)=>[0,1,2].some(c=>before[i*4+c]!==after[i*4+c]));
 const d=s.renderer.device,t=s.renderer.rockWeather.final,row=Math.ceil(t.width*16/256)*256;
 const b=d.createBuffer({size:row*t.height,usage:GPUBufferUsage.COPY_DST|GPUBufferUsage.MAP_READ});const e=d.createCommandEncoder();e.copyTextureToBuffer({texture:t},{buffer:b,bytesPerRow:row},[t.width,t.height]);d.queue.submit([e.finish()]);await b.mapAsync(GPUMapMode.READ);const field=new Float32Array(b.getMappedRange().slice(0));b.destroy();
 const stats={};for(let c=0;c<4;c++){const v=[];for(let y=0;y<t.height;y++)for(let x=0;x<t.width;x++)v.push(field[y*row/4+x*4+c]);v.sort((a,b)=>a-b);stats[['channel','debris','fines','wet'][c]]={max:v.at(-1),p90:v[Math.floor(v.length*.9)],nonzero:v.filter(x=>x>.01).length};}
 const map=new Uint8Array(t.width*t.height*4);for(let y=0;y<t.height;y++)for(let x=0;x<t.width;x++){const i=(y*t.width+x)*4,j=y*row/4+x*4;map[i]=Math.min(255,field[j]*170);map[i+1]=Math.min(255,field[j+1]*170);map[i+2]=Math.min(255,field[j+3]*255);map[i+3]=255;}writeFileSync(`${out}/transport.png`,encodePng(t.width,t.height,map));
 const impact={},continuity={};
 const tests={stoneRound:[0,1],stoneSlab:[0,1],runoff:[0,1.6],runoffScale:[8,70],runoffConcentration:[.1,1],runoffCut:[0,7],runoffStain:[0,1],debrisAmount:[0,1.8],debrisReach:[12,96],debrisDepth:[0,10],stoneSort:[0,1],looseSize:[3,14]};
 for(const [key,[lo,hi]]of Object.entries(tests)){const old=s.renderer.variant.get(key);await knob(s,key,lo);const a=await renderWindow(s,rect);await knob(s,key,hi);const b=await renderWindow(s,rect);await knob(s,key,old);impact[key]=difference(a,b,affected);console.log(key,impact[key]);assert.ok(impact[key].percent>=5,`${key} must move at least 5% of its weathered class`);}
 for(const key of ['stoneRound','stoneSlab','runoff','runoffCut','runoffStain','debrisAmount','debrisDepth']){const old=s.renderer.variant.get(key);await knob(s,key,0);const a=await renderWindow(s,rect);await knob(s,key,.0001);const b=await renderWindow(s,rect);await knob(s,key,old);continuity[key]=difference(a,b);assert.ok(continuity[key].mean<.1,`${key}: continuous at zero`);}
 assert.deepEqual(await windowHeights(s,{samples:64,step:8}),heights);
 const a=await renderWindow(s,rect);s.renderer.setBudgetMB(96);const b2=await renderWindow(s,{...rect,tile:128});assert.deepEqual(b2,a,'weathering must not depend on chunk partitions');
 s.renderer.setBudgetMB(128);
 const paint=channel=>s.play([...scene.strokes,['paint',[[512,512]],{card:{diameter:2000,amount:100,softness:0,roughness:0,paintChannel:channel}}]],{ground:true});
 paint(6);const sparse=await renderWindow(s,rect);const scatterPaint=difference(a,sparse,affected);assert.ok(scatterPaint.percent>5,'Sparser scatter must remove accumulated stones');
 paint(21);const removed=await renderWindow(s,rect);const depositPaint=difference(a,removed,affected);assert.ok(depositPaint.percent>5,'Deposits less must remove the accumulated bed');
 s.play([],{ground:false});await weather(s);await knob(s,'runoff',0);const flatWith=await renderWindow(s,rect);await knob(s,'debrisAmount',0);const flatWithout=await renderWindow(s,rect);
 const flat=difference(flatWith,flatWithout);assert.ok(flat.percent<.1,'no rockfall debris without a higher source');
 assert.deepEqual(s.errors,[]);writeFileSync(`${out}/results.json`,JSON.stringify({stats,impact,continuity,scatterPaint,depositPaint,flat,affectedPixels:affected.filter(Boolean).length,partitionPixelChanges:0,gameplayHeightChanges:0},null,2));
 writeFileSync(`${out}/scene.json`,JSON.stringify({...scene,rock:{...ROCK_PRESETS.sandstone.knobs,runoff:.8,debrisAmount:1.1,debrisReach:80,debrisDepth:5},column:{...s.worldColumn.column,sections:ROCK_PRESETS.sandstone.sections,variants:{}}},null,2));
}finally{s.dispose();}
process.exit(0);
