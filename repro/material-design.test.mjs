import test from 'node:test';import assert from 'node:assert/strict';
import {GROUND_PRESETS,copyGroundRecipe,groundCacheUsage,MATERIAL_REPEAT} from '../sculpt-ground-presets.js';
import {nodePreviewRecipe,compileSteps} from '../sculpt-material-steps.js';
import {graphPositions,nodeInputs} from '../sculpt-material-graph.js';
const keys=['rust-mottling','cloudy-green','blue-streaked-water','violet-rippled-water'];
test('node previews use ordinary graphs and leave the material untouched',()=>{
 for(const key of [...keys,'bed']){const recipe=copyGroundRecipe(GROUND_PRESETS[key]),before=structuredClone(recipe);
  for(const node of recipe.steps){const sample=nodePreviewRecipe(recipe,node.id);assert.equal(sample.recipe.knobs.textureDither,0);assert.equal(sample.recipe.steps.filter(n=>n.type==='output'&&n.enabled).length,1);assert.ok(compileSteps(sample.recipe).steps.length);}
  assert.deepEqual(recipe,before);
 }
 const p=copyGroundRecipe(GROUND_PRESETS['rust-mottling']);assert.match(nodePreviewRecipe(p,p.steps[0].id).description,/reference cells/);
});
test('Arrange preserves graphs, separates cards, and keeps dependencies left of consumers',()=>{
 for(const key of [...keys,'desert-clods']){const steps=copyGroundRecipe(GROUND_PRESETS[key]).steps,before=structuredClone(steps),pos=graphPositions(steps);assert.deepEqual(graphPositions(steps),pos);assert.deepEqual(steps,before);
  for(const s of steps){const p=pos.get(s.id),height=Math.max(90,54+nodeInputs(s).length*21);
   for(const [key]of nodeInputs(s))if(s[key])assert.ok(pos.get(s[key]).x<p.x,'dependency flows left to right');
   for(const other of steps){if(other.id===s.id)continue;const q=pos.get(other.id),h=Math.max(90,54+nodeInputs(other).length*21);assert.ok(p.x+176<=q.x||q.x+176<=p.x||p.y+height<=q.y||q.y+h<=p.y,'cards do not overlap');}
  }
 }
});
test('Arrange puts late branch inputs beside their consumer and follows input port order',()=>{
 const steps=[{id:'detail',type:'noise'},{id:'base',type:'noise'},{id:'a',type:'remap',source:'base'},{id:'b',type:'remap',source:'a'},{id:'join',type:'combine',source:'b',other:'detail'},{id:'out',type:'output',source:'join'}];
 const p=graphPositions(steps);assert.equal(p.get('detail').x,p.get('b').x);assert.ok(p.get('b').y<p.get('detail').y,'Base branch above Detail branch');
});
test('graph materials use a 512px repeat with 7 MiB of texture cache',()=>{
 assert.equal(MATERIAL_REPEAT,512);assert.equal(groundCacheUsage(1,MATERIAL_REPEAT).bytes,7*1024*1024);assert.ok(groundCacheUsage(7,MATERIAL_REPEAT).fits);
});
