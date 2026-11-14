// One small map exercises material assignment through the product's Wasm exporter.
import assert from 'node:assert/strict';
import {mkdirSync,readFileSync,writeFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {openHost,openScene,renderWindow,exportMap} from './headless.mjs';
import {buildWasm} from './export-node.mjs';
import {GROUND_PRESETS,addGround} from '../sculpt-ground-presets.js';
await openHost();const out='/private/tmp/texture-authoring-export';mkdirSync(out,{recursive:true});
let grounds=addGround([],GROUND_PRESETS['rust-mottling'],'Ground').grounds;
grounds=addGround(grounds,GROUND_PRESETS['violet-rippled-water'],'Water').grounds;
grounds[0].worldGround=true;grounds[1].worldWater=true;
const s=await openScene({biome:'red',ground:false,grounds,strokes:[['deep',[[256,256],[768,256]],{card:{diameter:400}}]]},'biome=red&mapX=2&mapY=2');
s.renderer.budgetBytes=256*1024*1024;
try{
 const before=await renderWindow(s,{x:256,y:192,width:128,height:128});
 const generations=s.renderer.groundCache.generations;
 // A burst of edits must retain only CPU recipe state until a draw consumes it.
 const queue=s.renderer.device.queue,submit=queue.submit.bind(queue);let editSubmissions=0;
 queue.submit=commands=>{editSubmissions++;submit(commands);};
 try{for(let i=0;i<120;i++){const pending=structuredClone(grounds);pending[1].steps.find(s=>s.type==='transform').params.patternWarp=i/10;s.setGrounds(pending);}}
 finally{queue.submit=submit;}
 assert.equal(editSubmissions,0,'slider inputs must not submit GPU work');
 assert.equal(s.renderer.groundCache.generations,generations,'intermediate recipes do not generate fields');
 s.setGrounds(grounds);
 const edited=structuredClone(grounds);edited[1].steps.find(s=>s.type==='gradient').colors[2]=[110,200,210].map(v=>v/255);s.setGrounds(edited);
 const after=await renderWindow(s,{x:256,y:192,width:128,height:128});assert.notDeepEqual(after,before,'water edits update visible water');assert.ok(s.renderer.groundCache.generations>generations,'color edits refresh the compiled material output');
 s.setGrounds(grounds);assert.deepEqual(await renderWindow(s,{x:256,y:192,width:128,height:128}),before,'restoration');
 const relief=structuredClone(grounds);relief[1].steps.find(s=>s.type==='output'&&s.target==='height').params.scale=4;s.setGrounds(relief);
 assert.notDeepEqual(await renderWindow(s,{x:256,y:192,width:128,height:128}),before,'water relief changes shading');
 s.setGrounds(grounds);assert.deepEqual(await renderWindow(s,{x:256,y:192,width:128,height:128}),before,'zero water relief restores flat pigment');
 const wasm=readFileSync(buildWasm(out+'/map-export.wasm'));
 const a=await exportMap(s,{name:'Texture authoring check',wasm});const b=await exportMap(s,{name:'Texture authoring check',wasm});
 assert.deepEqual(a.indexed,b.indexed,'exported art replay');assert.deepEqual(a.archive,b.archive,'exported archive replay');assert.ok(a.result.uniqueTiles>0);assert.deepEqual(s.errors,[]);
 writeFileSync(out+'/texture.ufo',a.archive);
 const report={archiveBytes:a.archive.length,uniqueTiles:a.result.uniqueTiles,sha256:createHash('sha256').update(a.archive).digest('hex'),coalescedInputs:120,inputGpuSubmissions:editSubmissions,waterColorEdit:true,waterRelief:true,materialOutputRefreshed:true,artReplay:'exact',archiveReplay:'exact',gpuErrors:s.errors};writeFileSync(out+'/report.json',JSON.stringify(report,null,2));console.log(JSON.stringify(report));
}finally{s.dispose();}process.exit(0);
