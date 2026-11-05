import test from 'node:test';
import assert from 'node:assert/strict';
import {HELP_CONTROLS,helpFrames,helpTimeline} from '../sculpt-help-examples.js';

test('percentage previews include each 10% intermediate value',()=>{
  assert.deepEqual(helpFrames(HELP_CONTROLS['lf-gullies']).map(f=>f.value),[0,10,20,30,40,50,60,70,80,90,100]);
  assert.equal(helpFrames(HELP_CONTROLS.lean).at(-1).label,'3 : 1');
});
test('discrete previews show valid counts, not duplicate or fractional steps',()=>{
  assert.deepEqual(helpFrames(HELP_CONTROLS['sec-terraces']).map(f=>f.value),[0,1,2,3,4,5,6]);
  assert.deepEqual(helpFrames(HELP_CONTROLS['spur-count']).map(f=>f.value),[0,1,2,3,4,5,6,7]);
  for(const e of Object.values(HELP_CONTROLS)){
    const f=helpFrames(e);assert.equal(f[0].value,e.values[0]);assert.equal(f.at(-1).value,e.values[1]);
    assert(f.every((v,i)=>v.value%e.step===0&&(!i||v.value>f[i-1].value)));
  }
});
test('playback holds endpoints and reverses through intermediate frames',()=>{
  assert.deepEqual(helpTimeline(4),[0,0,0,1,2,3,3,3,2,1]);
  assert.deepEqual(helpTimeline(1),[0]);assert.deepEqual(helpTimeline(0),[]);
});
