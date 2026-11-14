import test from 'node:test';
import assert from 'node:assert/strict';
import {GROUND_DEFAULTS,copyGroundRecipe,copyGrounds,addGround,duplicateGround,renameGround,setGround,deleteGround,groundsInUse,groundRecipeText,parseGroundRecipe,groundCacheUsage,keepStrokeGrounds} from '../sculpt-ground-presets.js';
const recipe={knobs:{plateAmount:3},ramp:Array(16).fill(100),line:50};
const node=slot=>({kind:'landform',params:{groundPreset:slot}});
test('ground list edits are immutable and deleting a preset releases its strokes',()=>{
 const a=addGround([],recipe,'Mud');const b=duplicateGround(a.grounds,a.slot);
 assert.equal(a.grounds.length,1);assert.equal(b.grounds.length,2);assert.equal(b.grounds[1].name,'Mud copy');
 const named=renameGround(b.grounds,2,'Clay');const edited=setGround(named,2,{...recipe,knobs:{plateAmount:5}});
 assert.equal(named[1].knobs.plateAmount,3);assert.equal(edited[1].knobs.plateAmount,5);
 const nodes=[node(1),node(2),node(0)],gone=deleteGround(edited,nodes,1);
 assert.deepEqual(gone.nodes.map(n=>n.params.groundPreset),[-1,2,0]);assert.equal(nodes[0].params.groundPreset,1);assert.equal(gone.nodes[1],nodes[1]);
 assert.equal(keepStrokeGrounds(nodes,edited)[0],nodes[0]);
 assert.throws(()=>deleteGround(edited,nodes,0));
});
test('recipes are absolute, bounded, palette-based and round-trip through save and clipboard',()=>{
 const p=copyGroundRecipe(recipe);assert.deepEqual(p.knobs,{...GROUND_DEFAULTS,plateAmount:3});
 const list=addGround([],p,'Mud').grounds;assert.deepEqual(copyGrounds(JSON.parse(JSON.stringify(list))),list);
 assert.deepEqual(parseGroundRecipe(groundRecipeText(list[0])),{name:'Mud',...p});
 assert.equal(copyGroundRecipe({...recipe,knobs:{plateAmount:999}}).knobs.plateAmount,8);
 assert.deepEqual(p.variationRamp,p.ramp);assert.notEqual(p.variationRamp,p.ramp);
 const tinted=copyGroundRecipe({...recipe,knobs:{grainColorMix:.7},variationRamp:Array(16).fill(170)});
 assert.deepEqual(parseGroundRecipe(groundRecipeText({name:'Colored grain',...tinted})),{name:'Colored grain',...tinted});
 assert.throws(()=>copyGroundRecipe({...recipe,variationRamp:[170]}));
 assert.throws(()=>copyGroundRecipe({...recipe,knobs:{plateAmount:NaN}}));assert.throws(()=>copyGroundRecipe({...recipe,ramp:Array(16).fill('#fff')}));
 assert.throws(()=>copyGrounds([list[0],list[0]]));assert.equal(copyGrounds(undefined),null);
});
test('only visible chosen presets count and the cache limit follows the world period',()=>{
 let grounds=[];for(let i=0;i<7;i++)grounds=addGround(grounds,recipe,'Ground').grounds;
 assert.throws(()=>addGround(grounds,recipe));
 assert.deepEqual(groundsInUse([node(1),node(1),{...node(2),hidden:true},node(7)],grounds).map(p=>p.slot),[1,7]);
 assert.deepEqual(groundCacheUsage(4,2048),{bytes:448*1024*1024,capacity:1,budget:128*1024*1024,fits:false});
 assert.deepEqual(groundsInUse([{kind:'paint',params:{groundPreset:1,paintChannel:3}},{kind:'paint',params:{groundPreset:2,paintChannel:26}}],grounds).map(p=>p.slot),[2]);
 assert.equal(groundCacheUsage(5,2048).fits,false);assert.equal(groundCacheUsage(4,1024).fits,true);
});
