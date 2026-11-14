import test from 'node:test';
import assert from 'node:assert/strict';
import {addGround,GROUND_PRESETS,copyGroundRecipe,copyGrounds,groundCacheUsage,groundRecipeText,parseGroundRecipe} from '../sculpt-ground-presets.js';
import {materialLayers,replaceMaterialLayers,copyLayerSettings} from '../sculpt-material-layers.js';
test('layer reorder moves generators, preserves material palette and assignments, and copies without aliasing',()=>{
 const m=addGround([],GROUND_PRESETS['rust-mottling'],'Rust').grounds[0];m.worldGround=true;
 const green=copyGroundRecipe(GROUND_PRESETS['cloudy-green']);green.layers=[];green.layer.name='Green';m.layers=[green];
 const reversed=copyGrounds([replaceMaterialLayers(m,materialLayers(m).reverse())])[0];
 assert.equal(reversed.worldGround,true);assert.equal(reversed.layer.name,'Green');assert.deepEqual(reversed.textureColors,green.textureColors);
 assert.deepEqual(reversed.texturePalette,m.texturePalette);assert.equal(reversed.knobs.textureDither,m.knobs.textureDither);
 reversed.layers[0].textureColors.low[0]=0;assert.notEqual(m.textureColors.low[0],0);
 assert.deepEqual(parseGroundRecipe(groundRecipeText(m)),{name:m.name,...copyGroundRecipe(m)});
});
test('layer validation bounds allocation and rejects nested stacks, invalid masks and nonfinite controls',()=>{
 const p=copyGroundRecipe(GROUND_PRESETS['rust-mottling']);assert.throws(()=>copyGroundRecipe({...p,layers:[{...p,layers:[p]}]}),/nested/);
 assert.throws(()=>copyGroundRecipe({...p,layers:Array(8).fill(p)}));assert.throws(()=>copyLayerSettings({mask:'random'}));assert.throws(()=>copyLayerSettings({opacity:NaN}));assert.throws(()=>copyLayerSettings({terrainLow:50,terrainHigh:20}));
 assert.equal(groundCacheUsage(1,1024,8).fits,true);assert.equal(groundCacheUsage(2,1024,16).fits,false);
 assert.equal(groundCacheUsage(1,2048,3).fits,false);
});

test('component adjustments inherit pattern edits without duplicating artist settings',async()=>{
 const {resolveMaterialLayers}=await import('../sculpt-material-layers.js');
 const m=copyGroundRecipe(GROUND_PRESETS['rust-mottling']);
 m.knobs.patternSize=27;m.knobs.patternWarp=3;m.layer.seed=23;m.textureColors.high=[160,110,80];
 const rows=resolveMaterialLayers(m),fine=rows.find(p=>p.layer.effect==='detail'),dots=rows.find(p=>p.layer.effect==='dots');
 assert.equal(fine.knobs.patternSize,27);assert.equal(fine.knobs.patternWarp,3);assert.equal(fine.layer.seed,23);assert.deepEqual(fine.textureColors.high,[160,110,80]);
 assert.equal(fine.knobs.textureFineStructure,m.layers[0].knobs.textureFineStructure);assert.equal(dots.knobs.patternSize,27);assert.equal(dots.knobs.markDensity,m.layers[1].knobs.markDensity);
 const moved=replaceMaterialLayers(m,[m.layers[0],m,...m.layers.slice(1)]);assert.equal(resolveMaterialLayers(moved)[0].layer.opacity,0,'an adjustment needs a preceding pattern');
});
