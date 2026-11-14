import test from 'node:test';import assert from 'node:assert/strict';
import {GROUND_PRESETS,copyGroundRecipe,groundCacheUsage,MATERIAL_REPEAT} from '../sculpt-ground-presets.js';
import {nodePreviewRecipe,compileSteps} from '../sculpt-material-steps.js';
import {graphPositions,graphRoutes,nodeInputs} from '../sculpt-material-graph.js';
const keys=['rust-mottling','cloudy-green','blue-streaked-water','violet-rippled-water'];
test('node previews use ordinary graphs and leave the material untouched',()=>{
 for(const key of [...keys,'bed']){const recipe=copyGroundRecipe(GROUND_PRESETS[key]),before=structuredClone(recipe);
  for(const node of recipe.steps){const sample=nodePreviewRecipe(recipe,node.id);assert.equal(sample.recipe.knobs.textureDither,0);assert.equal(sample.recipe.steps.filter(n=>n.type==='output'&&n.enabled).length,1);assert.ok(compileSteps(sample.recipe).steps.length);}
  assert.deepEqual(recipe,before);
 }
 const p=copyGroundRecipe(GROUND_PRESETS['rust-mottling']);assert.match(nodePreviewRecipe(p,p.steps[0].id).description,/reference cells/);
});
test('Arrange is deterministic and routes every reviewed connection outside node cards',()=>{
 for(const key of keys){const steps=copyGroundRecipe(GROUND_PRESETS[key]).steps,pos=graphPositions(steps);assert.deepEqual(graphPositions(steps),pos);
  const nodes=steps.map(step=>({step,position:pos.get(step.id),inputs:nodeInputs(step),height:Math.max(90,54+nodeInputs(step).length*21)})),routes=graphRoutes(nodes);
  assert.equal(routes.size,nodes.reduce((n,node)=>n+node.inputs.filter(([key])=>node.step[key]).length,0));
  for(const path of routes.values())for(let i=1;i<path.length;i++)for(const n of nodes){const a=path[i-1],b=path[i],left=n.position.x,right=left+176,top=n.position.y,bottom=top+n.height;
   const crosses=a.y===b.y&&a.y>top&&a.y<bottom&&Math.max(a.x,b.x)>left&&Math.min(a.x,b.x)<right||a.x===b.x&&a.x>left&&a.x<right&&Math.max(a.y,b.y)>top&&Math.min(a.y,b.y)<bottom;assert.equal(crosses,false,'wire crosses '+n.step.name);
  }
 }
});
test('graph materials use a 512px repeat with 7 MiB of texture cache',()=>{
 assert.equal(MATERIAL_REPEAT,512);assert.equal(groundCacheUsage(1,MATERIAL_REPEAT).bytes,7*1024*1024);assert.ok(groundCacheUsage(7,MATERIAL_REPEAT).fits);
});
