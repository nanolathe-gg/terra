import test from 'node:test';
import assert from 'node:assert/strict';
import {ROCK_PRESETS,ROCK_KEYS,copyRockSettings,rockPresetFor} from '../sculpt-rock-presets.js';
import {copyColumn} from '../sculpt-column.js';
test('geological presets are valid editable controls and column beds',()=>{
 for(const [key,p] of Object.entries(ROCK_PRESETS)){
  assert.deepEqual(copyRockSettings(p.knobs),p.knobs);
  assert.equal(rockPresetFor(p.knobs,copyColumn({sections:p.sections})),key);
  assert.equal(rockPresetFor({...p.knobs,faceJoint:p.knobs.faceJoint+.1},{sections:p.sections}),'');
  assert.equal(Object.keys(p.knobs).length,ROCK_KEYS.length);
 }
});
test('rock recipes reject invalid controls and ignore removed options',()=>{
 for(const value of [[],1,'x',{faceRound:NaN},{faceJoint:-1},{faceRound:'0.5'},{faceStretch:0}])assert.throws(()=>copyRockSettings(value));
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
