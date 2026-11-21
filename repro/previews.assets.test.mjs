import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,readdirSync} from 'node:fs';
import {HELP_TOOLS,HELP_CONTROLS,HELP_FRAME,helpFrames,helpImage} from '../sculpt-help-examples.js';
import {KNOBS} from '../sculpt-knobs.js';
import {SHAPE_FIELDS, SURFACE_SLIDER_IDS} from '../sculpt-scene.js';
const previews=new URL('../ui-previews/',import.meta.url);
// The published images cover the editor's shape fields and World knobs. Regenerate them with repro/ui-previews.mjs.
test('published hover previews match the examples',()=>{
  const manifest=JSON.parse(readFileSync(new URL('manifest.json',previews),'utf8'));
  assert.deepEqual(manifest.frame,HELP_FRAME);
  assert.deepEqual(manifest.tools,HELP_TOOLS);
  const site=JSON.parse(readFileSync(new URL('../site.json',import.meta.url),'utf8'));
  const hasBeach=site.worlds.some(({id}) => JSON.parse(readFileSync(new URL(`../materials/${id}.json`,import.meta.url),'utf8')).world.materials.beach);
  const beachControls=new Set(['beachWidth', 'apron']);
  const expected = new Set([
    ...Object.keys(HELP_CONTROLS),
    ...SHAPE_FIELDS.map(([, id]) => id),
    ...KNOBS.flatMap(([, rows]) => rows.filter(([key]) => hasBeach || !beachControls.has(key)).map(([key]) => `knob-${key}`)),
    ...SURFACE_SLIDER_IDS, 'cracks', 'amount', 'roughness', 'softness',
    'knob-shallowTone', 'knob-sun', 'knob-sky',
  ]);
  assert.deepEqual(new Set(Object.keys(manifest.controls)), expected);
  for (const [id, frames] of Object.entries(manifest.controls)) {
    assert.ok(frames.length >= 2, id);
    assert.equal(new Set(frames.map(f => f.value)).size, frames.length, id);
    assert.ok(frames.every(f => f.label), id);
  }
  for(const [id,example] of Object.entries(HELP_CONTROLS))assert.deepEqual(manifest.controls[id],helpFrames(example),id);
  const size=name=>{const png=readFileSync(new URL(name,previews));return [png.readUInt32BE(16),png.readUInt32BE(20)];};
  const images=[...HELP_TOOLS.map(tool=>[helpImage({tool}),1]),...Object.entries(manifest.controls).map(([control,frames])=>[helpImage({control}),frames.length])];
  for(const [name,frames] of images)assert.deepEqual(size(name),[frames*HELP_FRAME.width,HELP_FRAME.height],name);
  const worlds=Object.values(manifest.worlds.images);
  for(const name of worlds)assert.deepEqual(size(name),[manifest.worlds.frame.width,manifest.worlds.frame.height],name);
  assert.deepEqual(readdirSync(previews).filter(f=>f.endsWith('.png')).sort(),[...images.map(([name])=>name),...worlds].sort());
});
