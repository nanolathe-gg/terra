import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,mkdtempSync} from 'node:fs';
import {runSite} from './site-cli.mjs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {defaultSet,normalizeSet,variants,makeRecipe,MAX_VARIANTS,controlRequirement} from '../sculpt-feature-set.js';
import {generateFeature} from '../sculpt-feature-gen.js';
import {movementObstacles} from '../sculpt-passability.js';
const root=new URL('..',import.meta.url).pathname,dir=mkdtempSync(join(tmpdir(),'feature-recipes-test-'));
runSite(['--dump-configs',dir]);
const config=world=>JSON.parse(readFileSync(join(dir,`config/${world}.json`))),green=config('green'),red=config('red'),palette=JSON.parse(readFileSync(root+'materials/palette.json')).indexed;
const recipe=(kind,source,id)=>{const p=green.featureCatalog.find(p=>p.id===source);assert.equal(p.kind,kind);return makeRecipe(kind,p.data,id,p.name);};

test('every world shares every preset, and each preset survives serialization in every world',()=>{
 let checked=0;
 for(const world of ['green','red','lava','ice','moon','desert','archipelago','crystal','lush']){
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


test('size variation is independent, bounded, stable through edits and fixed at zero',()=>{
 for(const kind of ['tree','shrub']){
  const set=defaultSet(green),r=makeRecipe(kind,{types:[{share:1,params:{species:'broadleaf',height:60,width:kind==='tree'?.7:30},vary:{height:[40,80]}}]});
  r.count=8;r.params={height:60,width:kind==='tree'?.7:30,heightVariation:0,widthVariation:0};set[kind].recipes=[r];
  const read=()=>variants(kind,normalizeSet(set,green),green),width=v=>kind==='tree'?v.params.height*v.params.width:v.params.width;
  // Use the allowed shrub height for its smaller size range.
  if(kind==='shrub')r.params.height=30;
  const base=read();assert.equal(new Set(base.map(v=>v.params.height)).size,1);assert.equal(new Set(base.map(width)).size,1);
  r.params.heightVariation=.5;const tall=read();
  tall.forEach((v,i)=>{assert.ok(Math.abs(width(v)-width(base[i]))<1e-9);assert.ok(v.params.height>=base[i].params.height*.5&&v.params.height<=base[i].params.height*1.5);});
  r.params.widthVariation=.5;const both=read();assert.deepEqual(both.map(v=>v.params.height),tall.map(v=>v.params.height));
  assert.ok(new Set(both.map(width)).size>1);
  r.count=12;const appearance=({weight,...v})=>v;assert.deepEqual(read().slice(0,8).map(appearance),both.map(appearance));
  assert.deepEqual(variants(kind,normalizeSet(JSON.parse(JSON.stringify(set)),red),red),read());
 }
});

test('variance keeps source range centers and preserves the other inherited dimension',()=>{
 const set=defaultSet(green),r=makeRecipe('tree',{types:[{share:1,params:{species:'broadleaf',height:60,width:.7},vary:{height:[40,80],width:[.5,.9]}}]});set.tree.recipes=[r];
 const original=variants('tree',set,green);
 r.params={heightVariation:.4};
 variants('tree',set,green).forEach((v,i)=>assert.ok(Math.abs(v.params.height*v.params.width-original[i].params.height*original[i].params.width)<1e-9));
 r.data.types[0]={share:1,params:{species:'tendril'},vary:{reach:[30,50],thick:[1,3]}};
 r.params={reachVariation:0,thickVariation:0};
 for(const v of variants('tree',set,green)){assert.equal(v.params.reach,40);assert.equal(v.params.thick,2);}
});

test('two-color surfaces keep geometry, shadows and burnt successors; preview matches export',()=>{
 const set=defaultSet(green),r=recipe('tree','red-tree-0',0);
 r.params={arms:12,reach:54,thick:3,curl:.7,reachVariation:.3,thickVariation:.25};set.tree.recipes=[r];
 const first=variants('tree',normalizeSet(set,green),green)[0],ctx={palette},base=generateFeature('tree',first.params,first.seed,ctx);
 const params={...first.params,accentAmount:.55,accentColor:'#b8c277',patternScale:8},colored=generateFeature('tree',params,first.seed,ctx),preview=generateFeature('tree',params,first.seed,{...ctx,bodyOnly:true});
 assert.deepEqual(preview.body,colored.body);assert.deepEqual(preview.shadow,colored.shadow);
 assert.deepEqual(colored.body.a,base.body.a);assert.deepEqual(colored.shadow,base.shadow);assert.deepEqual(colored.burnt,base.burnt);
 assert.notDeepEqual(colored.body.idx,base.body.idx);
 assert.deepEqual(generateFeature('tree',{...params,accentAmount:0},first.seed,ctx).body,base.body);
 assert.deepEqual(generateFeature('tree',params,first.seed,ctx),colored);
 // A tiny step at zero keeps the same geometry and cannot abruptly replace the material.
 const tiny=generateFeature('tree',{...params,accentAmount:1e-6},first.seed,ctx);assert.deepEqual(tiny.body,base.body);
});

test('canopy styles and new controls normalize and retain their availability rules',()=>{
 const set=defaultSet(green),r=set.tree.recipes[0];
 r.params={canopyStyle:'palm',heightVariation:10,widthVariation:-3,arms:30,reach:900,thick:20,accentAmount:2,accentColor:'#AABBCC',patternScale:100};
 const p=normalizeSet(set,green).tree.recipes[0].params;
 assert.deepEqual(p,{canopyStyle:'palm',heightVariation:.6,widthVariation:0,arms:16,reach:100,thick:5,accentAmount:1,accentColor:'#aabbcc',patternScale:24});
 assert.match(controlRequirement('tree','crown',{species:'broadleaf',canopyStyle:'palm'}),/Palm/);
 assert.match(controlRequirement('tree','arms',{species:'conifer'}),/tendril/);
 assert.equal(controlRequirement('tree','crown',{species:'conifer',fronds:.8}),'');
 assert.equal(controlRequirement('tree','arms',{species:'tendril'}),'');
 assert.match(controlRequirement('rock','patternScale',{accentAmount:0}),/coverage/);
 assert.equal(controlRequirement('rock','patternScale',{accentAmount:.5}),'');
 assert.match(controlRequirement('rock','patternScale',{accentAmount:1}),/below 100/);
 r.params={heightVariation:'bad',accentColor:'bad',canopyStyle:'bad'};assert.deepEqual(normalizeSet(set,green).tree.recipes[0].params,{});
 const ctx={palette,bodyOnly:true};
 const bodies=['round','clustered','palm'].map(canopyStyle=>generateFeature('tree',{height:65,canopyStyle},51,ctx).body);
 assert.notDeepEqual(bodies[0],bodies[1]);assert.notDeepEqual(bodies[1],bodies[2]);
});


test('rock dimension variation preserves footprints, seeds, and preview/export parity',()=>{
 const set=defaultSet(green),r=set.rock.recipes[0];r.params={heightVariation:.4,widthVariation:.3};
 const a=variants('rock',normalizeSet(set,green),green),b=variants('rock',normalizeSet(JSON.parse(JSON.stringify(set)),red),red);assert.deepEqual(a,b);
 const v=a[0],ctx={palette},one=generateFeature('rock',v.params,v.seed,ctx),two=generateFeature('rock',v.params,v.seed,{...ctx,bodyOnly:true});
 assert.deepEqual(one,two);assert.deepEqual(one.footprint,v.footprint);
 for(const key of ['heightVariation','widthVariation']){
  const changed=generateFeature('rock',{...v.params,[key]:0},v.seed,ctx);assert.notDeepEqual(one.body,changed.body);assert.deepEqual(one.footprint,changed.footprint);
 }
});
