// One colored rock column feeds voxel relief, bands, block release and debris.
import assert from 'node:assert/strict';
import {mkdirSync,writeFileSync} from 'node:fs';
import {openHost,openScene,weather,renderWindow,windowHeights,knob,column} from './headless.mjs';
import {encodePng} from './png.mjs';
import {ROCK_PRESETS} from '../sculpt-rock-presets.js';
const arg=(k,d)=>process.argv.includes(k)?process.argv[process.argv.indexOf(k)+1]:d;
const out=arg('--out','/private/tmp/terraform-geology-provenance/gpu');mkdirSync(out,{recursive:true});
const scene={biome:'green',ground:true,strokes:[['landform',[[50,450],[350,440],[700,470],[1000,450]],{card:{diameter:500,elevation:210,lean:180,roughness:0,softness:10,wander:25,widthVary:8,heightVary:5,cracks:20,terraces:0,styleVegetation:0}}]]};
await openHost();const s=await openScene(scene,'biome=green&mapX=4&mapY=4&erosion=0&scratch=geology-provenance');
const create=s.renderer.device.createTexture.bind(s.renderer.device);
s.renderer.device.createTexture=d=>create({...d,usage:d.usage|(['rock debris provenance','rock weather field','rock flow terrain'].includes(d.label)?GPUTextureUsage.COPY_SRC:0)});
const readTexture=async t=>{const d=s.renderer.device,row=Math.ceil(t.width*16/256)*256,b=d.createBuffer({size:row*t.height,usage:GPUBufferUsage.COPY_DST|GPUBufferUsage.MAP_READ}),e=d.createCommandEncoder();e.copyTextureToBuffer({texture:t},{buffer:b,bytesPerRow:row},[t.width,t.height]);d.queue.submit([e.finish()]);await b.mapAsync(GPUMapMode.READ);const raw=new Float32Array(b.getMappedRange().slice(0)),out=[];b.destroy();for(let y=0;y<t.height;y++)for(let x=0;x<t.width;x++)out.push(...raw.slice(y*row/4+x*4,y*row/4+x*4+4));return out;};
const rect={x:256,y:260,width:512,height:512,tile:256},set=async v=>{for(const [k,x]of Object.entries(v))await knob(s,k,x);};
const render=clay=>renderWindow(s,{...rect,...(clay?{options:s.drawOptions({clay:true})}:{})});
const png=(name,a)=>writeFileSync(`${out}/${name}.png`,encodePng(rect.width,rect.height,a));
const diff=(a,b,mask=null)=>{let changed=0,count=0,sum=0;for(let i=0;i<a.length;i+=4){if(mask&&!mask[i/4])continue;count++;const d=Math.max(...[0,1,2].map(c=>Math.abs(a[i+c]-b[i+c])));changed+=d>0;sum+=d;}return{changed,percent:100*changed/count,mean:sum/count};};
const colors=[[177,117,79],[224,208,167],[101,77,70],[185,142,119],[110,105,95]];
let beds;
try{
 await weather(s);const heights=await windowHeights(s,{samples:64,step:8});
 await set({...ROCK_PRESETS.sandstone.knobs,strata:.5,strataContrast:.85,strataGrain:.25,faceFold:12,faceBedVary:1.4,faceBreak:.65,faceGrass:.2});
 beds={...s.worldColumn.column,origin:'plain',colors,sections:[{start:0,beds:[[11,.9,0],[5,.25,1],[3,.65,2],[7,.7,3]]}],variants:{}};
 await column(s,beds);const art=await render(false),clay=await render(true);png('layered',art);png('layered-clay',clay);
 await knob(s,'strata',0);const plain=await render(false);const mask=Array.from({length:art.length/4},(_,i)=>[0,1,2].some(c=>art[i*4+c]!==plain[i*4+c]));await knob(s,'strata',.5);
 const results={};
 const recolored={...beds,colors:colors.map(([r,g,b])=>[b,g,r])};await column(s,recolored);const recolor=await render(false);results.palette=diff(art,recolor,mask);assert.ok(results.palette.percent>5);assert.deepEqual(await render(true),clay,'color edits must not change geometry');png('palette-change',recolor);await column(s,beds);
 for(const [key,lo,hi]of [['bedCycleVary',0,1],['faceBedVary',0,3],['faceBreak',0,1],['faceBed',4,18],['faceFold',0,32],['strata',0,1],['strataContrast',0,1],['strataGrain',0,1]]){const old=s.renderer.variant.get(key);await knob(s,key,lo);const a=await render(false),ac=await render(true);await knob(s,key,hi);const b=await render(false),bc=await render(true);results[key]={art:diff(a,b,mask),clay:diff(ac,bc,mask)};assert.ok(results[key].art.percent>5,`${key} visible at 1x`);if(key.startsWith('strata'))assert.equal(results[key].clay.changed,0,`${key} is color only`);else assert.ok(results[key].clay.percent>5,`${key} changes the solid`);await knob(s,key,old);console.log(key,results[key]);}
 for(const key of ['faceBreak','faceBedVary','bedCycleVary']){const old=s.renderer.variant.get(key);await knob(s,key,0);const a=await render(false);await knob(s,key,.0001);results[key].zero=diff(a,await render(false));assert.ok(results[key].zero.mean<.1,`${key} continuous at zero`);await knob(s,key,old);}
 // Colors from an upstream source reach the apron independently of the ground's own color.
 await knob(s,'faceBreak',0);png('intact',await render(false));await knob(s,'faceBreak',1);png('released',await render(false));
 const a=await render(false);s.renderer.setBudgetMB(96);assert.deepEqual(await renderWindow(s,{...rect,tile:128}),a,'source colors and fracture debris are chunk invariant');s.renderer.setBudgetMB(128);
 // An upper red source must leave red debris on a lower blue bed. This
 // catches coloring deposits from their destination height instead of source.
 const trace={...beds,colors:[[180,30,20],[20,40,180],...colors.slice(2)],sections:[{start:0,beds:[[10000,.8,1]]},{start:70,beds:[[10000,.8,0]]}]};
 await column(s,trace);await render(false);
 const source=await readTexture(s.renderer.rockWeather.source),debris=await readTexture(s.renderer.rockWeather.final),terrain=await readTexture(s.renderer.rockWeather.owned[0]);
 let traced=0;for(let i=0;i<source.length;i+=4)if(terrain[i]<s.config.baseHeight+8&&debris[i+1]>.05&&source[i]>source[i+2]*1.2)traced++;
 assert.ok(traced>8,'upper-bed color must reach low-ground debris');results.upstreamColorCells=traced;
 await column(s,beds);
 assert.deepEqual(await windowHeights(s,{samples:64,step:8}),heights);assert.deepEqual(s.errors,[]);
 results.classPixels=mask.filter(Boolean).length;results.chunkDifferences=0;results.gameplayHeightDifferences=0;
 writeFileSync(`${out}/results.json`,JSON.stringify(results,null,2));writeFileSync(`${out}/scene.json`,JSON.stringify({...scene,rock:{...ROCK_PRESETS.sandstone.knobs,strata:.5,strataContrast:.85,strataGrain:.25,faceFold:12,faceBedVary:1.4,faceBreak:1},column:beds},null,2));
 // The same data works on a mountain and on the Desert world's ground.
 s.play([['mountain',[[340,560],[610,460]],{card:{diameter:500,elevation:280,roughness:20,softness:20,styleVegetation:0}}]],{ground:true});await weather(s);png('mountain',await render(false));
}finally{s.dispose();}
const desert=await openScene({...scene,biome:'desert',column:beds},'biome=desert&mapX=4&mapY=4&erosion=0');
try{for(const [k,v]of Object.entries({...ROCK_PRESETS.sandstone.knobs,strata:.5,strataContrast:.85,strataGrain:.25,faceFold:12,faceBedVary:1.4,faceBreak:.65}))await knob(desert,k,v);await weather(desert);png('desert',await renderWindow(desert,rect));assert.deepEqual(desert.errors,[]);}finally{desert.dispose();}
process.exit(0);
