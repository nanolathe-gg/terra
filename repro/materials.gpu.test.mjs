// Materials on the GPU (Dawn): the repeat joins itself, an edit reaches the art an export bakes and reverts exactly, a stroke's own
// material shows where it was painted, and every library material compiles and draws something.
import test from 'node:test';
import assert from 'node:assert/strict';
import {openHost, openScene, renderWindow} from './headless.mjs';
import {LIBRARY, addMaterial} from '../sculpt-materials.js';
import {groundPool} from '../sculpt-material-model.js';

const same = (a, b) => Buffer.compare(Buffer.from(a.buffer, a.byteOffset, a.byteLength), Buffer.from(b.buffer, b.byteOffset, b.byteLength)) === 0;
const mean = image => { const sum = [0, 0, 0]; for (let i = 0; i < image.length; i += 4) for (let c = 0; c < 3; c++) sum[c] += image[i + c]; return sum.map(v => v / (image.length / 4)); };

test('a world’s ground repeats, a material edit reaches export art and reverts exactly, and a stroke paints its own material', async () => {
  await openHost();
  const s = await openScene({biome: 'red', ground: false, strokes: []}, 'biome=red&mapX=5&mapY=5');
  try {
    const win = (x, y, options = {}) => renderWindow(s, {x, y, width: 256, height: 256, ...options}), own = s.materials;
    // The world's pair, then the extra materials Red's tools lay down (world.materials.extra).
    assert.deepEqual(own.map(m => [m.source, m.worldGround, m.worldWater]), [['red-ground', true, false], ['red-water', false, true], ...s.config.materials.extra.map(k => [k, false, false])]);
    // The material repeats every 512 px; the world's own level-ground settings repeat with its pool, a multiple of that.
    const here = await win(640, 640), pool = groundPool(s.config.material);
    assert.ok(same(here, await win(640 + pool, 640)), 'the plain repeats a pool to the right');
    assert.ok(same(here, await win(640, 640 + pool)), 'and a pool down');
    const art = await win(640, 640, {exportArt: true});
    s.setMaterials(own.map(m => m.worldGround ? {...m, seed: m.seed + 1} : m));
    assert.ok(!same(art, await win(640, 640, {exportArt: true})), 'a new seed changes the art an export bakes');
    s.setMaterials(own);
    assert.ok(same(art, await win(640, 640, {exportArt: true})), 'and the earlier material gives the earlier bytes');
    // Another material, chosen by a paint stroke: green where it was painted, the world's rust away from it.
    const added = addMaterial(own, LIBRARY['green-ground'], 'Grass'); s.setMaterials(added.materials);
    s.play([['paint', [[768, 768]], {groundPreset: added.slot, card: {diameter: 240, amount: 100, softness: 0}}]], {ground: false}); await s.fields.ready();
    const painted = mean(await renderWindow(s, {x: 736, y: 736, width: 64, height: 64})), away = mean(await renderWindow(s, {x: 1500, y: 1500, width: 64, height: 64}));
    assert.ok(painted[1] > painted[0] * 1.3, `the painted ground is grass (mean ${painted.map(Math.round)})`);
    assert.ok(away[0] > away[1] * 1.3, `the rest is the world's rust (mean ${away.map(Math.round)})`);
    assert.deepEqual(s.errors, []);
  } finally { s.dispose(); }
});

test('every library material compiles on the GPU and draws a picture that is not flat', async () => {
  await openHost();
  const s = await openScene({biome: 'green', ground: false, strokes: []}, 'biome=green&mapX=2&mapY=2');
  try {
    for (const [key, material] of Object.entries(LIBRARY)) {
      s.setMaterials(s.materials.map(m => m.worldGround ? {...m, ...material, name: m.name} : m));
      const image = await renderWindow(s, {x: 400, y: 400, width: 64, height: 64}), colors = new Set();
      for (let i = 0; i < image.length; i += 4) colors.add(image[i] << 16 | image[i + 1] << 8 | image[i + 2]);
      assert.ok(colors.size >= 2, `${key} draws more than one color`);
      assert.deepEqual(s.errors, [], key);
    }
  } finally { s.dispose(); }
});

test('a Blur at radius 0 leaves its input exactly; a wider one softens it, and the repeat still joins', async () => {
  await openHost();
  const s = await openScene({biome: 'green', ground: false, strokes: []}, 'biome=green&mapX=5&mapY=5');
  try {
    const dots = {id: 's', type: 'scatter', params: {spacing: 24, radius: 5, coverage: .7, hardness: .9}};
    const use = nodes => s.setMaterials(s.materials.map(m => m.worldGround ? {...m, nodes, palette: [], controls: [], frames: []} : m));
    const win = (x = 640, y = 640) => renderWindow(s, {x, y, width: 128, height: 128, exportArt: true}), pool = groundPool(s.config.material);
    use([dots, {id: 'o', type: 'output', in: {color: 's', height: 's'}, params: {relief: 2}}]); const plain = await win();
    const blurred = radius => use([dots, {id: 'b', type: 'blur', in: {in: 's'}, params: {radius}}, {id: 'o', type: 'output', in: {color: 'b', height: 'b'}, params: {relief: 2}}]);
    blurred(0); assert.ok(same(plain, await win()), 'radius 0 is the input itself');
    blurred(8); const soft = await win(); assert.ok(!same(plain, soft), 'radius 8 changes it');
    assert.ok(same(soft, await win(640 + pool, 640)) && same(soft, await win(640, 640 + pool)), 'the blurred repeat joins itself');
    assert.deepEqual(s.errors, []);
  } finally { s.dispose(); }
});

test('a Stamp at Coverage 0 is its Base; Stamp and Slope blur repeats join themselves; stage textures go with the last staged material', async () => {
  await openHost();
  const s = await openScene({biome: 'green', ground: false, strokes: []}, 'biome=green&mapX=5&mapY=5');
  try {
    const use = nodes => s.setMaterials(s.materials.map(m => m.worldGround ? {...m, nodes, palette: [], controls: [], frames: []} : m));
    const win = (x = 640, y = 640) => renderWindow(s, {x, y, width: 128, height: 128, exportArt: true}), pool = groundPool(s.config.material);
    const base = {id: 'b', type: 'noise', params: {size: 3}}, shape = {id: 'f', type: 'noise', kind: 'facets', params: {size: 14}};
    use([base, {id: 'o', type: 'output', in: {color: 'b'}}]); const plain = await win();
    const stamped = coverage => use([base, shape, {id: 'st', type: 'stamp', in: {base: 'b', shape: 'f'}, params: {coverage, radius: 14}}, {id: 'o', type: 'output', in: {color: 'st'}}]);
    stamped(0); assert.ok(same(plain, await win()), 'nothing stamped leaves the base');
    stamped(.8); const stamps = await win(); assert.ok(!same(plain, stamps));
    assert.ok(same(stamps, await win(640 + pool, 640)) && same(stamps, await win(640, 640 + pool)), 'the stamped repeat joins itself');
    use([shape, {id: 'h', type: 'noise', params: {size: 40, seed: 3}}, {id: 'sb', type: 'slopeblur', in: {in: 'f', slope: 'h'}, params: {distance: 12}}, {id: 'o', type: 'output', in: {color: 'sb', height: 'sb'}, params: {relief: 2}}]);
    const smeared = await win(); assert.ok(same(smeared, await win(640 + pool, 640)) && same(smeared, await win(640, 640 + pool)), 'the smeared repeat joins itself');
    // The stage textures exist while a material in use needs them, and go with the last one.
    const cache = s.renderer.groundCache, held = s.renderer.fixedBytes; assert.ok(cache.stageTexture, 'staged materials have their textures');
    use([base, {id: 'o', type: 'output', in: {color: 'b'}}]); assert.ok(same(plain, await win()));
    assert.equal(cache.stageTexture, null, 'none in use, none kept');
    if (held !== undefined) assert.ok(s.renderer.fixedBytes < held, 'and the renderer stops counting them');
    assert.deepEqual(s.errors, []);
  } finally { s.dispose(); }
});
