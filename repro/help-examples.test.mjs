import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,readdirSync} from 'node:fs';
import {HELP_TOOLS,HELP_CONTROLS,HELP_FRAME,helpFrames,helpTimeline,helpImage} from '../sculpt-help-examples.js';
const previews=new URL('../ui-previews/',import.meta.url);

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
// The committed images are the examples' current set: regenerate with repro/ui-previews.mjs when this fails.
test('committed hover previews match the examples',()=>{
  const manifest=JSON.parse(readFileSync(new URL('manifest.json',previews),'utf8'));
  assert.deepEqual(manifest.frame,HELP_FRAME);
  assert.deepEqual(manifest.tools,HELP_TOOLS);
  assert.deepEqual(Object.keys(manifest.controls),Object.keys(HELP_CONTROLS));
  for(const [id,example] of Object.entries(HELP_CONTROLS))assert.deepEqual(manifest.controls[id],helpFrames(example),id);
  const size=name=>{const png=readFileSync(new URL(name,previews));return [png.readUInt32BE(16),png.readUInt32BE(20)];};
  const images=[...HELP_TOOLS.map(tool=>[helpImage({tool}),1]),...Object.entries(HELP_CONTROLS).map(([control,e])=>[helpImage({control}),helpFrames(e).length])];
  for(const [name,frames] of images)assert.deepEqual(size(name),[frames*HELP_FRAME.width,HELP_FRAME.height],name);
  const worlds=Object.values(manifest.worlds.images);
  for(const name of worlds)assert.deepEqual(size(name),[manifest.worlds.frame.width,manifest.worlds.frame.height],name);
  assert.deepEqual(readdirSync(previews).filter(f=>f.endsWith('.png')).sort(),[...images.map(([name])=>name),...worlds].sort());
});
