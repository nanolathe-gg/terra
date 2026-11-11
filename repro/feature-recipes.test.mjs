import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,mkdtempSync} from 'node:fs';
import {execFileSync} from 'node:child_process';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {defaultSet,normalizeSet,variants,makeRecipe,MAX_VARIANTS,controlRequirement} from '../sculpt-feature-set.js';
import {generateFeature} from '../sculpt-feature-gen.js';
import {movementObstacles} from '../sculpt-passability.js';
const root=new URL('..',import.meta.url).pathname,dir=mkdtempSync(join(tmpdir(),'feature-recipes-test-'));
execFileSync(process.env.PYTHON||'/Users/daniel/src/terraform/.venv/bin/python',[root+'sculpt.py','--dump-configs',dir]);
const config=world=>JSON.parse(readFileSync(join(dir,`config/${world}.json`))),green=config('green'),red=config('red'),palette=JSON.parse(readFileSync(root+'materials/palette.json')).indexed;
const recipe=(kind,source,id)=>{const p=green.featureCatalog.find(p=>p.id===source);assert.equal(p.kind,kind);return makeRecipe(kind,p.data,id,p.name);};

test('every world shares every preset, and each preset survives serialization in every world',()=>{
 let checked=0;
 for(const world of ['green','red','lava','ice','moon','desert','archipelago','crystal','zhon']){
  const c=config(world);assert.deepEqual(c.featureCatalog,green.featureCatalog);
  for(const preset of green.featureCatalog){const kind=preset.kind,r=makeRecipe(kind,preset.data,7,preset.name),s={...defaultSet(c),[kind]:{nextId:8,recipes:[r]}};
   const before=variants(kind,s,c),after=variants(kind,normalizeSet(JSON.parse(JSON.stringify(s)),c),c);
   assert.deepEqual(after,before,`${world}: ${preset.id}`);checked++;
  }
 }
 assert.ok(checked>500);
});

test('mixed recipes keep IDs and pixels through reordering, count edits, world changes and save/load',()=>{
 const set=defaultSet(green),t=recipe('tree','red-tree-0',4);t.color='#325caa';t.params={curl:.8};
 set.tree={nextId:5,recipes:[set.tree.recipes[0],t]};
 const a=variants('tree',set,green),custom=a.filter(v=>v.recipe===4),changed=structuredClone(set);
 changed.tree.recipes.reverse();changed.tree.recipes[1].count=1;
 const restored=normalizeSet(JSON.parse(JSON.stringify(changed)),config('lava'));
 assert.deepEqual(variants('tree',restored,config('lava')).filter(v=>v.recipe===4),custom);
 const v=custom[0],one=generateFeature('tree',v.params,v.seed,{palette,bodyOnly:true}),two=generateFeature('tree',variants('tree',restored,red)[0].params,v.seed,{palette});
 assert.deepEqual(one.body,two.body);assert.deepEqual(one.shadow,two.shadow);assert.ok(two.burn&&two.burnt);
 const obstacles=movementObstacles(red,{featureSet:restored,features:[{kind:'tree',v:4*MAX_VARIANTS,x:10,z:12}]});
 assert.deepEqual(obstacles,[{x:10,z:12,width:2,height:2}]);
});

test('a copied recipe edits independently; deleted IDs and invalid slots do not retarget placements',()=>{
 const set=defaultSet(green),a=set.rock.recipes[0],b={...structuredClone(a),id:9,name:'Blue rocks',color:'#4466bb'};
 set.rock={nextId:10,recipes:[b,a]};const before=variants('rock',set,green).filter(v=>v.recipe===0);
 b.params={tall:.8};assert.deepEqual(variants('rock',set,green).filter(v=>v.recipe===0),before);
 set.rock.recipes=[a];const normalized=normalizeSet(set,green);assert.equal(normalized.rock.nextId,10);
 assert.deepEqual(movementObstacles(green,{featureSet:normalized,features:[{kind:'rock',v:9*MAX_VARIANTS,x:1,z:1}]}),[]);
});

test('normalization bounds overrides and removes unsupported controls',()=>{
 const set=defaultSet(green);set.tree.recipes[0].params={species:'bogus',height:1e9,width:-2,removedControl:9};
 const normalized=normalizeSet(set,green);assert.deepEqual(normalized.tree.recipes[0].params,{height:110,width:.42});
 assert.match(controlRequirement('tree','width',{species:'tendril'}),/reach/);
 assert.match(controlRequirement('tree','taper',{species:'conifer'}),/broadleaf/);
 assert.equal(controlRequirement('tree','curl',{species:'tendril'}),'');
});


test('recipe gameplay settings override source presets, including dead trees and nonmetal rocks',()=>{
 const set=defaultSet(green),tree=recipe('tree','green-tree-2',1),rock=recipe('rock','lava-rock-0',2);
 assert.deepEqual(tree.energy,[50,50]);assert.deepEqual(rock.metal,[0,0]);
 tree.energy=[300,300];rock.metal=[40,40];
 set.tree={nextId:2,recipes:[tree]};set.rock={nextId:3,recipes:[rock]};
 const normalized=normalizeSet(set,green);
 assert.deepEqual(variants('tree',normalized,green)[0].params.energy,[300,300]);
 assert.equal(variants('rock',normalized,green)[0].params.metal,40);
});
