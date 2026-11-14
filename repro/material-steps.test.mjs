import test from 'node:test';import assert from 'node:assert/strict';
import {copySteps,compileSteps,recipeSteps,makeStep} from '../sculpt-material-steps.js';
import {copyGroundRecipe,GROUND_PRESETS,groundRecipeText,parseGroundRecipe} from '../sculpt-ground-presets.js';
const s=(id,type,more={})=>({id,type,...more});
test('sources are stable IDs; invalid connections, cycles, duplicate IDs and nonfinite settings are rejected',()=>{
 const steps=copySteps([s('a','constant'),s('b','constant'),s('mix','combine',{source:'a',other:'b',operation:'multiply'}),s('out','output',{source:'mix'})]);
 const moved=copySteps([steps[1],steps[0],...steps.slice(2)]);assert.equal(moved[2].source,'a');assert.equal(moved[2].other,'b');
 assert.throws(()=>copySteps([steps[2],...steps.slice(0,2)]),/earlier/);assert.throws(()=>copySteps([steps[0],steps[0]]),/duplicate/);
 assert.throws(()=>copySteps([s('a','constant',{params:{value:NaN}})]),/Invalid/);
 assert.throws(()=>copySteps([s('a','gradient'),s('b','remap',{source:'a'})]),/grayscale/);
 assert.throws(()=>copySteps([s('a','constant'),s('b','transform',{source:'a'})]),/coordinates/);
 assert.throws(()=>copySteps([s('a','gradient'),s('b','output',{source:'a',target:'height'})]),/grayscale/);
});
test('grayscale structure can feed separate color and height branches; save and clipboard retain the graph',()=>{
 const p=copyGroundRecipe(GROUND_PRESETS['cloudy-green']),field=p.steps.find(s=>s.type==='remap');
 const output=p.steps.find(s=>s.type==='output'&&s.target==='height');output.source=field.id;output.params.scale=3;
 assert.equal(p.steps.find(s=>s.type==='gradient').source,field.id);
 const copied=parseGroundRecipe(groundRecipeText({name:'Shared fields',...p}));assert.deepEqual(copied.steps,p.steps);
 copied.steps[0].params.patternWarp=19;assert.notEqual(p.steps[0].params.patternWarp,19);
 assert.ok(compileSteps(p).sample.has(field.id));assert.equal(makeStep('constant',p.steps).source,null);
});
test('reviewed recipes contain generic combines, editable gradients and outputs, with removed effects ignored',()=>{
 for(const key of ['rust-mottling','cloudy-green','blue-streaked-water','violet-rippled-water']){
  const p=copyGroundRecipe(GROUND_PRESETS[key]);assert.ok(p.steps.some(s=>s.type==='combine'));assert.ok(p.steps.some(s=>s.type==='gradient'));assert.ok(p.steps.some(s=>s.type==='output'&&s.target==='height'));
  const copied=copyGroundRecipe({...p,layer:{effect:'dots'},layers:[p]});assert.equal(copied.layer,undefined);assert.equal(copied.layers,undefined);assert.deepEqual(copied.steps,p.steps);
  assert.ok(compileSteps(p).signals<=4);
 }
});
test('height bounds include amplification and constant output offsets',async()=>{
 const {stepHeightBound}=await import('../sculpt-material-steps.js');
 const p=copyGroundRecipe(GROUND_PRESETS['cloudy-green']);
 p.steps=copySteps([s('a','constant',{params:{value:8}}),s('b','combine',{source:'a',other:'a',operation:'multiply',params:{amount:1}}),s('h','output',{source:'b',target:'height',params:{scale:2,offset:3}})]);
 assert.ok(stepHeightBound(p)>=131);
 p.steps.at(-1).params.scale=0;assert.equal(stepHeightBound(p),3);
});
test('graph connections sort evaluation order, reject cycles, and keep layout out of render keys',async()=>{
 const {orderSteps,materialRenderKey}=await import('../sculpt-material-steps.js');
 const nodes=[s('out','output',{source:'mix'}),s('mix','combine',{source:'a',other:'b',operation:'add'}),s('b','constant'),s('a','constant')];
 const ordered=orderSteps(nodes);assert.equal(ordered.at(-1).id,'out');assert.ok(ordered.findIndex(s=>s.id==='a')<ordered.findIndex(s=>s.id==='mix'));
 assert.throws(()=>orderSteps([s('a','remap',{source:'b'}),s('b','remap',{source:'a'})]),/cycle/);
 const recipe=copyGroundRecipe(GROUND_PRESETS['rust-mottling']),key=materialRenderKey(recipe);recipe.steps[0].position={x:200,y:300};recipe.steps[0].name='Warp';assert.equal(materialRenderKey(recipe),key);assert.deepEqual(copyGroundRecipe(recipe).steps[0].position,{x:200,y:300});
 recipe.steps[0].params.patternWarp+=1;assert.notEqual(materialRenderKey(recipe),key);
});

test('one noise node supports fractal, fine grain and pixel fields with bounded parameters',()=>{
 for(const kind of ['fractal','fine','pixel']){
  const recipe={steps:copySteps([{id:'n',type:'noise',kind},{id:'out',type:'output',source:'n'}])};
  assert.equal(recipe.steps[0].kind,kind);assert.ok(compileSteps(recipe).instructions[0].code[0]>0);
 }
 assert.throws(()=>copySteps([{id:'n',type:'noise',kind:'unknown'}]),/noise type/);
 const fine=copySteps([{id:'n',type:'noise',kind:'fine',params:{textureFineSize:1000}}])[0];assert.equal(fine.params.textureFineSize,32);
});

test('removed noise node forms are dropped with their links when opening an older graph',()=>{
 const nodes=copySteps([{id:'old',type:'grain'},{id:'out',type:'output',source:'old'}]);
 assert.equal(nodes.length,1);assert.equal(nodes[0].source,null);
});
