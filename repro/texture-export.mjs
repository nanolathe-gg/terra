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
try{
 const before=await renderWindow(s,{x:256,y:192,width:128,height:128});
 const generations=s.renderer.groundCache.generations;
 const edited=structuredClone(grounds);edited[1].textureColors.high=[110,200,210];s.setGrounds(edited);
 const after=await renderWindow(s,{x:256,y:192,width:128,height:128});assert.notDeepEqual(after,before,'water edits update visible water');assert.equal(s.renderer.groundCache.generations,generations,'color-only edits retain field cache');
 s.setGrounds(grounds);assert.deepEqual(await renderWindow(s,{x:256,y:192,width:128,height:128}),before,'restoration');
 const relief=structuredClone(grounds);relief[1].knobs.textureHeight=4;s.setGrounds(relief);
 assert.notDeepEqual(await renderWindow(s,{x:256,y:192,width:128,height:128}),before,'water relief changes shading');
 s.setGrounds(grounds);assert.deepEqual(await renderWindow(s,{x:256,y:192,width:128,height:128}),before,'zero water relief restores flat pigment');
 const wasm=readFileSync(buildWasm(out+'/map-export.wasm'));
 const a=await exportMap(s,{name:'Texture authoring check',wasm});const b=await exportMap(s,{name:'Texture authoring check',wasm});
 assert.deepEqual(a.indexed,b.indexed,'exported art replay');assert.deepEqual(a.archive,b.archive,'exported archive replay');assert.ok(a.result.uniqueTiles>0);assert.deepEqual(s.errors,[]);
 writeFileSync(out+'/texture.ufo',a.archive);
 const report={archiveBytes:a.archive.length,uniqueTiles:a.result.uniqueTiles,sha256:createHash('sha256').update(a.archive).digest('hex'),waterColorEdit:true,waterRelief:true,fieldCacheRetained:true,artReplay:'exact',archiveReplay:'exact',gpuErrors:s.errors};writeFileSync(out+'/report.json',JSON.stringify(report,null,2));console.log(JSON.stringify(report));
}finally{s.dispose();}process.exit(0);
