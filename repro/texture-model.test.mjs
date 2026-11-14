import test from 'node:test';
import assert from 'node:assert/strict';
import {GROUND_PRESETS,copyGroundRecipe,copyGrounds,groundsInUse,addGround,setGround,groundRecipeText,parseGroundRecipe,groundCacheUsage} from '../sculpt-ground-presets.js';
import {savedWorld,copySavedWorld} from '../sculpt-save.js';
test('procedural colors retain fractions; invalid palettes and duplicate assignments are rejected',()=>{
 const p=copyGroundRecipe(GROUND_PRESETS['violet-rippled-water']);assert.equal(p.textureColors.low[0],45.335);
 const list=addGround([],p,'Water').grounds;list[0].worldWater=true;
 assert.deepEqual(parseGroundRecipe(groundRecipeText(list[0])),{name:'Water',...p});
 assert.deepEqual(groundsInUse([],list),list);assert.equal(setGround(list,1,{...p,textureColors:{...p.textureColors,middle:[80.125,90.25,110.5]}})[0].worldWater,true);
 assert.throws(()=>copyGroundRecipe({...p,textureColors:{low:[NaN,2,3]}}));assert.throws(()=>copyGroundRecipe({...p,texturePalette:[256]}));assert.throws(()=>copyGroundRecipe({...p,texturePalette:Array(33).fill(1)}));
 assert.throws(()=>copyGrounds([list[0],{...list[0],slot:2}]),/one material/);
 assert.ok(groundCacheUsage(8,1024).fits);assert.equal(groundCacheUsage(3,2048).fits,false);
 const config={biomeId:'red',biome:'Red',defaults:{},engineDefaults:{},colors:{}};
 const world=savedWorld(config,new URLSearchParams(),{name:'Test',grounds:list,colors:{}});
 assert.deepEqual(copySavedWorld(JSON.parse(JSON.stringify(world)),config).grounds,list);
});
