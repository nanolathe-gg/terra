// Small GPU integration check for ground claims, recipe edits and deletion.
// No full scene sweep: a 128px window plus the authored field's slot bytes.
import assert from 'node:assert/strict';
import {openHost,openScene,renderWindow,windowHeights} from './headless.mjs';
import {addGround} from '../sculpt-ground-presets.js';
await openHost();console.log('ground slots: opening scene');
const grounds=addGround([],{knobs:{plateAmount:3},ramp:Array(16).fill(100)},'Bed').grounds;
const s=await openScene({biome:'green',ground:false,grounds,strokes:[]},'biome=green&mapX=2&mapY=2&scratch=ground-slots');
const rect={x:192,y:192,width:128,height:128};
try {
 console.log('ground slots: rendering original');
 const before=await renderWindow(s,rect),heights=await windowHeights(s);
 assert.equal(s.renderer.grounds.size,0,'unused presets do not reach the GPU');
 const stroke=['paint',[[256,256]],{groundPreset:1,card:{diameter:200,amount:100,softness:0}}];
 console.log('ground slots: applying ground paint');
 s.play([stroke]);console.log('ground slots: ground paint ready');
 assert.equal(s.renderer.grounds.size,1);assert.equal(s.renderer.groundCache.bytes,12*1024*1024);
 const previous=s.renderer.grounds;s.config.material.groundPool=2048;
 assert.throws(()=>s.renderer.setGrounds(new Map(Array.from({length:5},(_,i)=>[i+1,grounds[0]]))),/at most 2/);
 assert.equal(s.renderer.grounds,previous,'a budget rejection leaves the active table alone');
 s.config.material.groundPool=1024;
 const read=async()=>{await s.fields.gpuReady();const {masks}=s.fields.gpuBuffers();return new Uint32Array(await s.fieldsModule.readBuffer(s.renderer.device,masks,0,s.worldGrid*s.worldGrid*28));};
 const plane=words=>Array.from({length:words.length/7},(_,i)=>(words[i*7+5]>>>8)&255);
 const slots=plane(await read());
 assert.ok(slots.every(n=>n===0||n===2),'paint never interpolates one slot ID into another');
 const claims=slots.filter(n=>n===2).length;
 assert.ok(claims>0,'paint claims plane 21 for slot 1');
 assert.deepEqual(await windowHeights(s),heights,'ground paint leaves gameplay heights alone');
 console.log('ground slots: rendering recipe');
 const painted=await renderWindow(s,rect);
 const moved=painted.filter((v,i)=>i%4!==3&&v!==before[i]).length;
 assert.ok(moved>0,'the claimed recipe draws its own ground');
 const generated=s.renderer.groundCache.generations;
 s.setGrounds(grounds.map(p=>({...p,line:51})));
 assert.equal(s.renderer.groundCache.generations,generated,'color edits do not regenerate height');
 const node=s.nodes[0];s.setGrounds(grounds.map(p=>({...p,knobs:{...p.knobs,plateAmount:5}})));
 assert.equal(s.nodes[0],node,'editing a recipe does not replay unchanged strokes');
 s.setGrounds([]);
 assert.equal(s.nodes[0].params.groundPreset,-1);assert.equal(s.renderer.grounds.size,0);
 const cleared=await read();
 assert.equal(plane(cleared).some(Boolean),false,'deleting a preset clears its claims on replay');
 assert.ok(cleared.every(v=>v===0),'deleted ground paint does not become ordinary rock paint');
 s.setGrounds(grounds);
 s.play([['landform',[[256,256]],{groundPreset:1,card:{diameter:200,elevation:80}}]]);
 assert.ok(plane(await read()).some(n=>n===2),'landforms claim ground too');
 assert.deepEqual(s.errors,[]);
 console.log(JSON.stringify({paintedCells:claims,gameplayHeights:'unchanged',changedColorChannels:moved,landformClaim:true,deleteReplay:true}));
} finally {s.dispose();}
process.exit(0);
