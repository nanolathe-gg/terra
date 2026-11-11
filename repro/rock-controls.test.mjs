import test from 'node:test';
import assert from 'node:assert/strict';
import {ROCK_PRESETS,ROCK_KEYS,copyRockSettings,rockPresetFor} from '../sculpt-rock-presets.js';
import {copyColumn} from '../sculpt-column.js';
test('geological presets are valid editable controls and column beds',()=>{
 for(const [key,p] of Object.entries(ROCK_PRESETS)){
  assert.deepEqual(copyRockSettings(p.knobs),p.knobs);
  assert.equal(rockPresetFor(p.knobs,copyColumn({sections:p.sections})),key);
  assert.equal(rockPresetFor({...p.knobs,faceJoint:p.knobs.faceJoint+.1},{sections:p.sections}),'');
  assert.ok(Object.keys(p.knobs).every(k=>ROCK_KEYS.includes(k)));
 }
});
test('rock recipes reject invalid controls and ignore removed options',()=>{
 for(const value of [[],1,'x',{faceRound:NaN},{faceJoint:-1},{faceRound:'0.5'},{faceStretch:0},{faceClastSize:0},{faceMineral:2},{stoneSlab:2}])assert.throws(()=>copyRockSettings(value));
 assert.deepEqual(copyRockSettings({removedOption:1,faceRound:.5}),{faceRound:.5});
 assert.equal(copyRockSettings(undefined),null);
});

// Gating follows every live source, including artist-painted stones.
test('weathering controls explain inactive parents and allow painted sorting',async()=>{
 const {worldControlRequirement:reason}=await import('../sculpt-control-schema.js');
 assert.ok(reason('runoffCut',{runoff:1,rockFace:0}));
 assert.equal(reason('runoffCut',{runoff:1,rockFace:2}),'');
 assert.ok(reason('debrisDepth',{debrisAmount:0}));
 assert.equal(reason('stoneSort',{stonePaint:1}),'');
 assert.equal(reason('sandLight',{beachLayer:1,sand:0,debrisAmount:1}),'');
});

test('new rock controls and static preset picker stay connected',async()=>{
 const {readFileSync}=await import('node:fs');
 const {worldControlRequirement:reason}=await import('../sculpt-control-schema.js');
 const html=readFileSync(new URL('../sculpt.html',import.meta.url),'utf8');
 for(const key of Object.keys(ROCK_PRESETS))assert.ok(html.includes(`value="${key}"`));
 assert.ok(reason('faceClastSize',{faceClast:0,rockFace:2}));
 assert.ok(reason('faceClastSize',{faceClast:1,rockFace:0}));
 assert.equal(reason('faceClastSize',{faceClast:1,rockFace:2}),'');
 assert.ok(reason('stoneRound',{stoneSlab:1,debrisAmount:1}));
 assert.equal(reason('stoneSlab',{stonePaint:1}),'');
 assert.equal(reason('bedDipDir',{rockFace:2,bedDip:0,faceFold:5}),'');
 assert.equal(reason('faceRound',{rockFace:0,faceClast:1,faceMineral:1}),'');
 assert.equal(reason('faceGritSize',{rockFace:0,faceGrit:0,faceMineral:1}),'');
});

test('layer colors and repetition use the map recipe and existing column palette',async()=>{
 const {worldControlRequirement:reason}=await import('../sculpt-control-schema.js');
 for(const key of ['strata','strataContrast','strataGrain','faceBedVary','bedCycleVary','faceBreak'])assert.ok(ROCK_KEYS.includes(key));
 assert.ok(reason('faceBreak',{rockFace:0}));
 assert.ok(reason('faceBedVary',{column:0,rockFace:2}));
 assert.equal(reason('faceBedVary',{column:1,rockFace:0,strata:1}),'');
 assert.deepEqual(copyRockSettings({strata:.8,strataContrast:.7,strataGrain:.4}),{strata:.8,strataContrast:.7,strataGrain:.4});
});


test('fracture and crust controls use cut sources and visible finish parents',async()=>{
 const {worldControlRequirement:reason}=await import('../sculpt-control-schema.js');
 for(const key of ['faceFresh','faceRind','faceRindDepth','faceRindTone','faceRindWarmth','faceRindRough'])assert.ok(ROCK_KEYS.includes(key));
 assert.ok(reason('faceFresh',{rockFace:2,faceBreak:0,faceSpall:0,faceJoint:0}));
 assert.equal(reason('faceFresh',{rockFace:2,faceBreak:.4}),'');
 assert.ok(reason('faceRindTone',{rockFace:2,faceRind:0}));
 assert.ok(reason('faceRindRough',{rockFace:2,faceRind:1,shineRock:0,shineRockRough:0,faceWet:0}));
 assert.equal(reason('faceRindRough',{rockFace:2,faceRind:1,faceWet:.3}),'');
 assert.equal(reason('faceRindDepth',{rockFace:2,faceRind:1,faceJoint:.5}),'');
 assert.throws(()=>copyRockSettings({faceRindDepth:21}));
 assert.throws(()=>copyRockSettings({faceRindTone:-1}));
});


test('fracture hierarchy and clustering have effective parents and saved ranges',async()=>{
 const {worldControlRequirement:reason}=await import('../sculpt-control-schema.js');
 for(const key of ['faceJointWidth','faceSecondary','faceContinuity','faceDetailPatch'])assert.ok(ROCK_KEYS.includes(key));
 for(const key of ['faceJointWidth','faceSecondary','faceContinuity']){
  assert.ok(reason(key,{rockFace:2,faceJoint:0}));
  assert.equal(reason(key,{rockFace:2,faceJoint:1}),'');
 }
 assert.ok(reason('faceDetailPatch',{rockFace:2,faceCrease:0,faceGrit:0,faceScratch:0}));
 assert.equal(reason('faceDetailPatch',{rockFace:2,faceCrease:.5}),'');
 assert.throws(()=>copyRockSettings({faceContinuity:2}));
 assert.throws(()=>copyRockSettings({faceJointWidth:4}));
});

test('whole blocks and block regularity are saved rock settings with effective parents',async()=>{
 const {worldControlRequirement:reason}=await import('../sculpt-control-schema.js');
 for(const key of ['faceWhole','faceWholeLarge','faceRegular']){
  assert.ok(ROCK_KEYS.includes(key));
  assert.ok(reason(key,{rockFace:0,faceTone:0}));
  assert.equal(reason(key,{rockFace:2}),'');
  assert.throws(()=>copyRockSettings({[key]:1.5}));
 }
 assert.equal(reason('faceRegular',{rockFace:0,faceTone:.2}),'');   // it moves the blocks' colors too, as Joint spacing does
 for(const preset of Object.values(ROCK_PRESETS))for(const key of ['faceWhole','faceWholeLarge','faceRegular'])assert.ok(preset.knobs[key]>=0&&preset.knobs[key]<=1);
});
