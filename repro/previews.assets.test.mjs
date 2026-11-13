import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,readdirSync} from 'node:fs';
import {HELP_TOOLS,HELP_CONTROLS,HELP_FRAME,helpFrames,helpImage} from '../sculpt-help-examples.js';
const previews=new URL('../ui-previews/',import.meta.url);
// The committed images are the examples' current set: regenerate with repro/ui-previews.mjs when this fails.
test('published hover previews match the examples',()=>{
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
