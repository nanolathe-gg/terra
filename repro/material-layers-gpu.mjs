// Focused stack composition and regional replay; no world or scene sweep.
import assert from 'node:assert/strict';
import {mkdirSync,writeFileSync} from 'node:fs';
import {openHost,openScene,renderWindow} from './headless.mjs';
import {GROUND_PRESETS,addGround,copyGroundRecipe} from '../sculpt-ground-presets.js';
import {replaceMaterialLayers,materialLayers} from '../sculpt-material-layers.js';
import {encodePng} from './png.mjs';
await openHost();const out='/private/tmp/material-layers-gpu';mkdirSync(out,{recursive:true});
const grounds=addGround([],GROUND_PRESETS['rust-mottling'],'Stack').grounds;grounds[0].layers=[];grounds[0].worldGround=true;grounds[0].knobs.textureDither=0;
const s=await openScene({biome:'red',ground:false,grounds,strokes:[]},'biome=red&mapX=4&mapY=4&palette=off&view=color');
s.renderer.budgetBytes=256*1024*1024;
const rect={x:896,y:896,width:128,height:128};
const render=async(p,name)=>{s.setGrounds([p]);const a=await renderWindow(s,rect);if(name)writeFileSync(out+'/'+name+'.png',encodePng(128,128,a));return a;};
try{
 const baseline=await render(grounds[0],'base');
 const stacked=structuredClone(grounds[0]),layer=copyGroundRecipe(GROUND_PRESETS['cloudy-green']);layer.layers=[];layer.layer.height=1;layer.layer.opacity=.7;layer.layer.seed=7;layer.layer.surface=1;layer.knobs.gloss=.8;layer.knobs.roughness=.9;layer.steps.find(s=>s.type==='output'&&s.target==='height').params.scale=3;stacked.layers=[layer];
 const color=await render(stacked,'color');assert.notDeepEqual(color,baseline);
 const hidden=structuredClone(stacked);hidden.layers[0].layer.visible=false;assert.deepEqual(await render(hidden),baseline,'hidden layers are neutral');
 const off=structuredClone(stacked);off.layers[0].layer.opacity=0;assert.deepEqual(await render(off),baseline,'zero layer is neutral');
 const tiny=structuredClone(off);tiny.layers[0].layer.opacity=.00001;const near=await render(tiny,'tiny');let tinyChanged=0,tinyMax=0;for(let i=0;i<near.length;i+=4){const d=Math.max(...[0,1,2].map(c=>Math.abs(near[i+c]-baseline[i+c])));tinyMax=Math.max(tinyMax,d);if(d>1)tinyChanged++;}console.log({tinyChanged,tinyMax});assert.ok(tinyChanged<128*128*.01,'small layer steps are continuous');
 assert.notDeepEqual(await render(replaceMaterialLayers(stacked,materialLayers(stacked).reverse()),'reordered'),color,'order matters');
 const multiply=structuredClone(stacked);multiply.layers[0].layer.blend='multiply';assert.notDeepEqual(await render(multiply,'multiply'),color,'blend modes affect composition');
 const masked=structuredClone(stacked);Object.assign(masked.layers[0].layer,{mask:'procedural',maskPattern:'cells',maskSize:24,maskLow:.2,maskHigh:.7});
 const mask=await render(masked,'masked');assert.notDeepEqual(mask,color,'procedural mask matters');
 assert.deepEqual(await renderWindow(s,{...rect,x:rect.x+1024}),mask,'periodic masked stack');
 assert.deepEqual(await renderWindow(s,{...rect,tile:64}),mask,'regional masked stack');
 const terrain=structuredClone(stacked);Object.assign(terrain.layers[0].layer,{mask:'height',terrainLow:500,terrainHigh:600});assert.deepEqual(await render(terrain),baseline,'height range outside terrain removes layer');
 Object.assign(terrain.layers[0].layer,{terrainLow:-128,terrainHigh:512,terrainSoftness:1});assert.deepEqual(await render(terrain),color,'height range includes flat terrain');
 Object.assign(terrain.layers[0].layer,{mask:'slope',terrainLow:30,terrainHigh:80});assert.deepEqual(await render(terrain),baseline,'slope range excludes flat terrain');
 Object.assign(terrain.layers[0].layer,{terrainLow:-10,terrainHigh:10});assert.deepEqual(await render(terrain),color,'slope range includes flat terrain');
 const channels={};
 for(const view of ['relief','roughness','wetness']){s.renderer.variant.set('view',view);s.renderer.applyKnobs();const a=await render(stacked,view);assert.notDeepEqual(a,color);channels[view]=true;}
 s.renderer.variant.set('view','relief');s.renderer.applyKnobs();const raised=await render(stacked);const pits=structuredClone(stacked);pits.layers[0].layer.height=-1;assert.notDeepEqual(await render(pits,'pits'),raised,'signed relief cuts instead of raising');
 s.renderer.variant.set('view','palette-color');s.renderer.applyKnobs();masked.knobs.textureDither=1;const dither=await render(masked,'palette');assert.deepEqual(await renderWindow(s,{...rect,tile:64}),dither,'full-stack diffusion is regional');
 const allowed=new Set(masked.texturePalette.map(i=>s.renderer.paletteIndexed[i].join(',')));for(let i=0;i<dither.length;i+=4)assert.ok(allowed.has([...dither.slice(i,i+3)].join(',')),'palette applied after the stack');
 // Moving a terrain mask an infinitesimal amount cannot replace all grain.
 const td=structuredClone(masked);td.layers[0].layer.mask='height';td.layers[0].layer.maskAmount=0;const noMask=await render(td);td.layers[0].layer.maskAmount=.00001;const small=await render(td);let moved=0;for(let i=0;i<small.length;i+=4)if(small[i]!==noMask[i]||small[i+1]!==noMask[i+1]||small[i+2]!==noMask[i+2])moved++;assert.ok(moved<128*128*.01,'terrain-mask onset preserves diffusion grain');
 td.layers[0].layer.maskAmount=1;Object.assign(td.layers[0].layer,{terrainLow:30,terrainHigh:50,terrainSoftness:12});const final=await render(td,'terrain-palette');assert.deepEqual(await renderWindow(s,{...rect,tile:64}),final,'terrain-mask palette is regional');
 // Water uses the same composited surface finish, with neutral starter gloss.
 s.play([['deep',[[864,960],[1056,960]],{card:{diameter:500}}]],{ground:false});
 s.renderer.variant.delete('view');s.renderer.applyKnobs();
 const water={...grounds[0],...copyGroundRecipe(GROUND_PRESETS['violet-rippled-water']),worldGround:false,worldWater:true};
 const matte=await render(water);water.knobs.gloss=.9;water.knobs.sharpness=3;const shiny=await render(water,'water-shine');assert.notDeepEqual(shiny,matte,'water gloss affects visible art');
 water.knobs.roughness=.9;assert.notDeepEqual(await render(water),shiny,'water roughness affects visible art');
 assert.deepEqual(s.errors,[]);const report={layerOrder:true,visibility:true,signedRelief:true,waterFinish:true,blend:true,proceduralMasks:true,terrainMasks:true,neutralLayer:'exact',period:'exact',regional:'exact',palette:true,channels,terrainMaskOnsetChangedPixels:moved,gpuErrors:s.errors};writeFileSync(out+'/report.json',JSON.stringify(report,null,2));console.log(JSON.stringify(report));
}finally{s.dispose();}process.exit(0);
