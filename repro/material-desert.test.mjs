import test from 'node:test';import assert from 'node:assert/strict';
import {GROUND_PRESETS,copyGroundRecipe,groundRecipeText,parseGroundRecipe} from '../sculpt-ground-presets.js';
import {copySteps,compileSteps,programSource,nodePreviewRecipe,stepHeightBound} from '../sculpt-material-steps.js';
test('cellular/ridged fields and curl distortion survive recipe editing and share color/height',()=>{
 const p=copyGroundRecipe(GROUND_PRESETS['desert-clods']);assert.deepEqual(parseGroundRecipe(groundRecipeText({...p,name:'Study'})).steps,p.steps);
 for(const kind of ['cellular','ridged']){const q=structuredClone(p);q.steps.find(s=>s.id==='clods').kind=kind;q.steps=copySteps(q.steps);const source=programSource(compileSteps(q));assert.match(source,/stepFlow/);assert.match(source,kind==='cellular'?/stepCellular/:/stepRidged/);assert.ok(stepHeightBound(q)>0);assert.ok(nodePreviewRecipe(q,'clods').recipe.steps.length);}
 const invalid=structuredClone(p.steps);invalid[0].kind='unknown';assert.throws(()=>copySteps(invalid),/distortion/);
 const zero=structuredClone(p);zero.steps.find(s=>s.target==='height').params.scale=0;assert.equal(stepHeightBound(zero),0);
});
