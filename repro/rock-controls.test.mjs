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
 for(const value of [[],1,'x',{faceRound:NaN},{faceRound:Infinity},{faceRound:'0.5'},{faceRound:null}])assert.throws(()=>copyRockSettings(value));
 // A finite number outside its control's range loads at the range's nearer end (an old map still opens).
 assert.deepEqual(copyRockSettings({faceJoint:-1,faceStretch:0,faceClastSize:0,faceMineral:2,stoneSlab:2}),{faceJoint:0,faceStretch:.25,faceClastSize:3,faceMineral:1,stoneSlab:1});
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

test('rock controls explain their effective parents',async()=>{
 const {worldControlRequirement:reason}=await import('../sculpt-control-schema.js');
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
 assert.deepEqual(copyRockSettings({faceRindDepth:21,faceRindTone:-1}),{faceRindDepth:20,faceRindTone:-.65});
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
 assert.deepEqual(copyRockSettings({faceContinuity:2,faceJointWidth:4}),{faceContinuity:1,faceJointWidth:3});
});

test('whole blocks and block regularity are saved rock settings with effective parents',async()=>{
 const {worldControlRequirement:reason}=await import('../sculpt-control-schema.js');
 for(const key of ['faceWhole','faceWholeLarge','faceRegular']){
  assert.ok(ROCK_KEYS.includes(key));
  assert.ok(reason(key,{rockFace:0,faceTone:0}));
  assert.equal(reason(key,{rockFace:2}),'');
  assert.deepEqual(copyRockSettings({[key]:1.5}),{[key]:1});
 }
 assert.equal(reason('faceRegular',{rockFace:0,faceTone:.2}),'');   // it moves the blocks' colors too, as Joint spacing does
 for(const preset of Object.values(ROCK_PRESETS))for(const key of ['faceWhole','faceWholeLarge','faceRegular'])assert.ok(preset.knobs[key]>=0&&preset.knobs[key]<=1);
});

test('a map saved before Fine layer spacing began at 6 opens, its spacing at 6',()=>{
 assert.deepEqual(copyRockSettings({faceLaminaSize:3}),{faceLaminaSize:6});
 // The rock and column of a Thin shale wall saved at spacing 3 (round 5's R-shale-w), checked as the page opens a map (sculpt.js loadScene).
 const rock={faceWhole:.6,faceWholeLarge:0,faceRegular:.6,faceJointWidth:1,faceSecondary:.9,faceContinuity:.9,faceDetailPatch:.6,faceFresh:.55,faceRind:.65,faceRindDepth:6,faceRindTone:-.3,faceRindWarmth:.1,faceRindRough:.7,bedCycleVary:.6,faceBedVary:1,faceBreak:.4,stoneRound:.05,stoneSlab:.85,faceJointTilt:12,faceScaleVary:.55,faceFold:0,faceSpall:.65,faceClast:0,faceClastSize:12,faceMineral:.3,runoff:.65,runoffScale:24,runoffConcentration:.65,runoffCut:2,runoffStain:.35,debrisAmount:1.1,debrisReach:80,debrisDepth:5,looseSize:7,stoneSort:.7,rockFace:2,faceRock:1,rockFaceFrom:.2,faceBed:3,faceLedge:3.2,faceRun:120,faceBlock:3,faceBlockSize:24,faceLean:0,faceWear:.1,faceCrease:.5,faceCreaseSize:6,faceScratch:.3,faceScratchSize:6,faceShade:.7,faceGrit:.15,faceGrass:.25,faceLayers:.3,faceMass:1,faceTone:.12,faceStrata:.22,faceWet:.2,faceStretch:3.2,faceBlockHeight:.4,faceRound:0,faceJoint:.9,faceExtrude:.2,faceLamina:.65,faceLaminaSize:3,faceScratchLength:50,faceScratchAngle:0,faceGritSize:1.3,bedDip:0,bedDipDir:90,shineRock:.18,shineRockSharp:12,shineRockRough:.25,shineRockScale:3};
 const column={sections:[{start:0,beds:[[2,.85,0],[1,.2,1],[3,.7,2],[1,.3,1]]}],bands:[3.7,.84],wander:{value:5},variants:{}};
 assert.ok(copyColumn(column));
 assert.deepEqual(copyRockSettings(rock),{...rock,faceLaminaSize:6});
});
