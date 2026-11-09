// Authored coastline, not traced retail: one solid and rock recipe above/below water.
import assert from 'node:assert/strict';
import {mkdirSync,readFileSync,writeFileSync} from 'node:fs';
import {openHost,openScene,weather,renderWindow,windowHeights,knob} from './headless.mjs';
import {encodePng} from './png.mjs';
const opt=(k,d)=>process.argv.includes(k)?process.argv[process.argv.indexOf(k)+1]:d;
const out=opt('--out','/private/tmp/terraform-fracture-coast/gpu'),worlds=opt('--worlds','red,green,desert').split(',');
const fixture=JSON.parse(readFileSync(new URL('./fixtures/fracture-coast.json',import.meta.url)));
mkdirSync(out,{recursive:true});await openHost();const report={};
const diff=(a,b,mask=null)=>{let pixels=0,sum=0,n=0;for(let i=0;i<a.length;i+=4){if(mask&&!mask[i/4])continue;const d=Math.max(...[0,1,2].map(k=>Math.abs(a[i+k]-b[i+k])));pixels+=d>0;sum+=d;n++;}return{pixels,percent:100*pixels/n,mean:sum/n};};
for(const world of worlds){
 const query=new URLSearchParams(fixture.query);query.set('biome',world);
 const s=await openScene({...fixture,biome:world},query.toString()),folder=out+'/'+world;mkdirSync(folder,{recursive:true});
 const set=async values=>{for(const[k,v]of Object.entries(values))await knob(s,k,v);};
 const rect={x:384,y:500,width:512,height:512,tile:256};
 const render=clay=>renderWindow(s,{...rect,...(clay?{options:s.drawOptions({clay:true})}:{})});
 const png=(name,data,r=rect)=>writeFileSync(`${folder}/${name}.png`,encodePng(r.width,r.height,data));
 try{
  await weather(s);const heights=await windowHeights(s,{x:384,y:500,samples:64,step:8});
  const art=await render(false),clay=await render(true);png('coast',art);png('clay',clay);
  await knob(s,'rockFace',0);const smooth=await render(true);await knob(s,'rockFace',fixture.rock.rockFace);
  const mask=Array.from({length:512*512},(_,i)=>[0,1,2].some(k=>smooth[i*4+k]!==clay[i*4+k]));
  const r={classPixels:mask.filter(Boolean).length,controls:{},water:{}};assert.ok(r.classPixels>20000);
  for(const[key,lo,hi]of [['faceJointWidth',.25,3],['faceSecondary',0,1.5],['faceContinuity',0,1],['faceDetailPatch',0,1]]){
   await knob(s,key,lo);const a=await render(false),ac=await render(true);
   await knob(s,key,hi);const b=await render(false),bc=await render(true);
   r.controls[key]={art:diff(a,b,mask),clay:diff(ac,bc,mask)};assert.ok(r.controls[key].art.percent>=5,key+' Art impact');assert.ok(r.controls[key].clay.percent>=5,key+' solid impact');png(key+'-low',a);png(key+'-high',b);
   await knob(s,key,lo);const zero=await render(false);await knob(s,key,lo+.0001);r.controls[key].continuity=diff(zero,await render(false));assert.ok(r.controls[key].continuity.mean<.1,key+' low-end continuity');await knob(s,key,fixture.rock[key]);
  }
  const waterMask=mask.map((v,i)=>v&&Math.floor(i/512)>260);
  // Color choices must retain bed lighting, including on submerged rock.
  const colors={...s.renderer.colorOverrides};s.renderer.setColors({...colors,shallow:[.32,.53,.6],deep:[.06,.16,.24]});
  for(const[key,lo,hi]of [['bedLit',0,1],['bedTint',0,1],['bedContrast',0,1.3],['bedBright',.6,1.5]]){
   await knob(s,key,lo);const a=await render(false);await knob(s,key,hi);const b=await render(false);r.water[key]=diff(a,b,waterMask);assert.ok(r.water[key].percent>5,key+' with chosen water colors');await knob(s,key,Number(query.get(key)));assert.equal(diff(await render(true),clay).pixels,0,key+' cannot alter the solid');
  }
  png('custom-water',await render(false));s.renderer.setColors(colors);
  const final=await render(false);s.renderer.setBudgetMB(96);assert.equal(diff(await renderWindow(s,{...rect,tile:128}),final).pixels,0,'underwater chunk/budget invariance');s.renderer.setBudgetMB(256);
  assert.deepEqual(await windowHeights(s,{x:384,y:500,samples:64,step:8}),heights);
  // Read back the production voxel field. No CPU implementation of its work.
  const d=s.renderer.device,create=d.createBuffer.bind(d);d.createBuffer=o=>create({...o,usage:o.usage|(o.label?.startsWith('voxel ')?GPUBufferUsage.COPY_SRC:0)});
  const read=async b=>{const dst=d.createBuffer({size:b.size,usage:GPUBufferUsage.COPY_DST|GPUBufferUsage.MAP_READ}),e=d.createCommandEncoder();e.copyBufferToBuffer(b,0,dst,0,b.size);d.queue.submit([e.finish()]);await dst.mapAsync(GPUMapMode.READ);const data=dst.getMappedRange().slice(0);dst.destroy();return data;};
  const solid=async()=>{await renderWindow(s,{x:512,y:720,width:128,height:128,tile:128});const v=s.renderer.voxel;assert.equal(v.stats.pieces,1);return{bricks:new Int32Array(await read(v.bricks)),density:new Uint16Array(await read(v.density[0]))};};
  writeFileSync(folder+'/controls.json',JSON.stringify(r,null,2));console.log(world,'controls and water passed; reading volume');
  const on=await solid();await knob(s,'rockFace',0);const off=await solid();
  // Brick allocation uses GPU atomics: compare spatial identities, not append order.
  const key=(a,i)=>a.slice(i*4,i*4+3).join(',');
  const byBrick=new Map();for(let b=0;b<off.density.length/512;b++)byBrick.set(key(off.bricks,b),b);
  const voxels={dry:0,submerged:0,matchedBricks:0};for(let b=0;b<on.density.length/512;b++){
   const other=byBrick.get(key(on.bricks,b));if(other===undefined)continue;voxels.matchedBricks++;
   for(let i=0;i<512;i++)if(on.density[b*512+i]!==off.density[other*512+i]){const z=on.bricks[b*4+2]*8+Math.floor(i/64)+.5;if(z < -2)voxels.submerged++;else if(z>2)voxels.dry++;}
  }
  assert.equal(voxels.matchedBricks,on.density.length/512,'same authored surface allocates the same brick positions');
  assert.ok(voxels.submerged>500,'voxel relief must actually exist below water');assert.ok(voxels.dry>500,'same volume contains dry rock');r.changedVoxels=voxels;
  await knob(s,'rockFace',fixture.rock.rockFace);d.createBuffer=create;
  // Natural banks need the same geometry without Rock paint.
  s.play(fixture.strokes.filter(n=>n[0]!=='paint'),{ground:true});await weather(s);
  const natural=await render(true);await knob(s,'rockFace',0);r.naturalBank=diff(natural,await render(true),waterMask);assert.ok(r.naturalBank.percent>5,'natural submerged bank relief');
  // Deep painted rock must also be allocated for the vertical underwater ray.
  // Its depth exceeds the old slanted-ray guard at small render tiles.
  const deep=structuredClone(fixture.strokes);deep[1][2].card.elevation=-260;deep[2][2].card.diameter=650;
  s.play(deep,{ground:true});await knob(s,'rockFace',fixture.rock.rockFace);await weather(s);
  const deepRect={x:384,y:780,width:512,height:256,options:s.drawOptions({clay:true})};
  const deepArt=await renderWindow(s,{...deepRect,tile:256});
  assert.equal(diff(deepArt,await renderWindow(s,{...deepRect,tile:128})).pixels,0,'deep underwater partition invariance');
  r.deepPartitionPixelChanges=0;
  assert.deepEqual(s.errors,[]);r.partitionPixelChanges=0;r.gameplayHeightChanges=0;r.console=s.errors;report[world]=r;
  s.play(fixture.strokes,{ground:true});await knob(s,'rockFace',fixture.rock.rockFace);await weather(s);png('overview',await renderWindow(s,fixture.window),fixture.window);
  console.log(world,JSON.stringify(r));
 }finally{s.dispose();}
}
writeFileSync(out+'/results.json',JSON.stringify(report,null,2));process.exit(0);
