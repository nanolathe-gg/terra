// The height image (a node of kind 'heights': sculpt-gpu-fields.js heightsFields, engine-shape.wgsl `heights`): what a save may hold, that the
// page's own save, load and undo copies keep it byte for byte, and, under Node on Dawn (repro/headless.mjs), that a map holding only an image of
// bytes exports those bytes at every 16 px corner, that pages and the whole map agree on it, and that the preview lattice draws the same surface.
// Every image here is synthetic (repro/heights-fixture.mjs).
import test from 'node:test';
import assert from 'node:assert/strict';
import {existsSync, readFileSync} from 'node:fs';
import {join} from 'node:path';
import {heightsFields, heightsBounds, HEIGHTS_LIMIT, HEIGHTS_REACH} from '../sculpt-gpu-fields.js';
import {sceneNodes, heightsNode} from '../sculpt-scene.js';
import {clonePaths, validatePaths} from '../sculpt-paths.js';
import {cellHeights, mapGeometry} from '../sculpt-map.js';
import {encodeSamples, decodeSamples, bumps, hashBytes, fixtureScene, sceneText} from './heights-fixture.mjs';
import {DAWN_DEFAULT} from './headless.mjs';

const root = new URL('..', import.meta.url).pathname;
const config = {biomeId: 'green', baseHeight: 84, seaLevel: 75, size: 2336, worldSize: 2336, map: {width: 2080, height: 2176}, defaults: {undulation: 10, undulationScale: 200, undulationCover: .45}};
const small = (more = {}) => ({image: encodeSamples(bumps(6, 5, 40, [[2, 2, 100, 1.5]])), width: 6, height: 5, ...more});

test('a height image is checked: its size, its samples and its numbers', () => {
  assert.deepEqual(heightsFields(small()), {image: small().image, bits: 8, width: 6, height: 5, cell: 16, x: 0, y: 0, scale: 1, offset: 0, mode: 'replace'});
  assert.equal(heightsFields(small({image: encodeSamples(bumps(6, 5, 4000, []), 16), bits: 16, mode: 'cut', cell: 40, x: -3.5})).bits, 16);
  // The limit is a 40 x 40 map's height bytes, and an image of that size is accepted.
  assert.deepEqual(HEIGHTS_LIMIT, {width: mapGeometry(40, 40).widthCells, height: mapGeometry(40, 40).heightCells});
  const full = {image: encodeSamples(new Uint8Array(1282 * 1288)), width: 1282, height: 1288};
  assert.equal(heightsFields(full).image.length, 2201624);
  assert.throws(() => heightsFields({...full, width: 1283}, 'Height image (stroke 3)'), /^Error: Height image \(stroke 3\) has 1283 x 1288 samples, over the limit of 1282 x 1288\.$/);
  assert.throws(() => heightsFields({...full, height: 1289}), /over the limit of 1282 x 1288/);
  // Samples that are not the size the node gives, or not base64.
  assert.throws(() => heightsFields(small({width: 7})), /needs 7 x 5 samples of 8 bits as base64: 35 bytes, 48 characters/);
  assert.throws(() => heightsFields(small({bits: 16})), /needs 6 x 5 samples of 16 bits as base64: 60 bytes, 80 characters/);
  assert.throws(() => heightsFields(small({image: small().image.replace(/^./, '*')})), /as base64/);
  assert.throws(() => heightsFields(small({image: small().image.slice(0, -1) + '='})), /as base64/);   // padding the size does not have
  assert.throws(() => heightsFields(small({image: undefined})), /as base64/);
  assert.throws(() => heightsFields(small({bits: 12})), /8 or 16 bits/);
  assert.throws(() => heightsFields(small({width: 6.5})), /whole number of samples/);
  assert.throws(() => heightsFields(small({height: 0})), /whole number of samples/);
  for (const key of ['cell', 'x', 'y', 'scale', 'offset']) assert.throws(() => heightsFields(small({[key]: NaN})), /finite numbers/);
  assert.throws(() => heightsFields(small({cell: 0})), /cell \(1 to 1024 px\)/);
  assert.throws(() => heightsFields(small({mode: 'add'})), /has the mode "add"; the modes are raise, cut, flatten, replace/);
  // It covers its samples and the margin round them: sample (i, j) at (x + i cell, y + j cell).
  assert.deepEqual(heightsBounds(heightsFields(small({x: 64, y: 32}))), {x0: 64 - 16 * HEIGHTS_REACH, y0: 32 - 16 * HEIGHTS_REACH, x1: 64 + 16 * (5 + HEIGHTS_REACH), y1: 32 + 16 * (4 + HEIGHTS_REACH)});
});

test('a scene holds a height image as a stroke with no path', () => {
  const nodes = sceneNodes(config, [['hill', [[100, 100], [300, 120]], {}], ['heights', [], small({mode: 'raise', x: 48})]], {ground: false});
  assert.deepEqual(nodes.map(n => n.kind), ['landform', 'heights']);
  assert.deepEqual(nodes[1], {kind: 'heights', hidden: false, ...heightsFields(small({mode: 'raise', x: 48}))});
  assert.equal(nodes[1].params, undefined);   // params is a brush card, which the panel edits; the image's values are the node's own
  assert.throws(() => sceneNodes(config, [['heights', [], small({width: 9})]], {ground: false}), /scene stroke 0: the height image needs 9 x 5 samples/);
});

test('the scene of the regional check is the fixture\'s formulas', () => {
  assert.equal(readFileSync(`${root}repro/shape-scenes/heights-bumps.json`, 'utf8'), sceneText(fixtureScene()));
});

// ---- on the GPU (Dawn's Node binding, as the render checks) ----
// These four run wherever the binding is installed (repro/check.sh quick, which needs it for its other steps too) and are skipped, by name, where it
// is not (the site's build runs the unit tests on a machine with no GPU).
const gpu = {skip: existsSync(join(process.env.TERRAFORM_WEBGPU || DAWN_DEFAULT, 'webgpu', 'index.js')) ? false : 'needs Dawn\'s Node binding (TERRAFORM_WEBGPU, repro/headless.mjs)'};
const open = async (strokes, query = '', map = '4x4') => {
  const headless = await import('./headless.mjs'), [mapX, mapY] = map.split('x');
  return headless.openScene({biome: 'green', ground: false, strokes}, `biome=green&mapX=${mapX}&mapY=${mapY}&scratch=1&gpuMB=512&heapMB=1536${query}`);
};
// The export's corner heights (sculpt-map.js cellHeights, which the page's export and the headless one call) over the fields as the export reads
// them: no Time pass has run, so the read is the authored surface.
const exported = async s => (await cellHeights(s.config.map, async request => { if (s.paged) return s.fields.readAsync(request); await s.fields.ready(); return s.fields.read(request); })).heights;
// A paged map copies its pages to the CPU in the background; letting the scene go while a copy is being read aborts the read, so wait for them.
async function pagesIdle(s) {
  await s.fields.coarseSettled();
  for (let i = 0; i < 500; i++) { const g = s.fields.stats().gpuShape; if (g.cpuCopyBytes === g.shapePages * 8 * s.fields.pageInfo().side ** 2) return; await new Promise(resolve => setTimeout(resolve, 10)); }
}
// A test image of bytes: bumps, with a block of hashed bytes (neighbors anywhere in 0..255), a one-sample spike beside a 0, a 200-unit step, and
// hashed bytes along the last row and column.
function hardBytes(width, height) {
  const out = bumps(width, height, 70, [[20, 18, 90, 7], [44, 40, 140, 10], [width - 12, height - 20, 110, 9], [80, 100, -60, 12]]), noise = hashBytes(width, height), mid = height >> 1;
  for (let j = mid; j < Math.min(height, mid + 20); j++) for (let i = 8; i < Math.min(width, 40); i++) out[j * width + i] = noise[j * width + i];
  out[30 * width + 60] = 255; out[31 * width + 60] = 0;
  for (let j = 0; j < 12; j++) for (let i = width - 10; i < width; i++) out[j * width + i] = i < width - 5 ? 0 : 200;
  for (let i = 0; i < width; i++) out[(height - 1) * width + i] = noise[i];
  for (let j = 0; j < height; j++) out[j * width + width - 1] = noise[j * width];
  return out;
}

test('a map holding only a height image of bytes exports those bytes at every corner', gpu, async () => {
  // The whole map's height bytes: sample (i, j) at pixel (16 i, 16 j), the corner the export reads. On the whole-map engine and in pages, and on the
  // smallest map, whose lattice is the coarsest (2.0025 px a cell against 2.0009).
  for (const [map, query] of [['4x4', ''], ['4x4', '&gpuPages=force'], ['1x1', '']]) {
    const {widthCells: w, heightCells: h} = mapGeometry(...map.split('x').map(Number)), bytes = hardBytes(w, h);
    const s = await open([['heights', [], {image: encodeSamples(bytes), width: w, height: h}]], query, map);
    try {
      const got = await exported(s);
      assert.equal(got.length, w * h);
      let wrong = 0; for (let k = 0; k < w * h; k++) if (got[k] !== bytes[k]) wrong++;
      assert.equal(wrong, 0, `${wrong} of ${w * h} corners differ on ${map}${query && ' in pages'}`);
      assert.deepEqual([...got.subarray((h - 1) * w)], bytes.slice((h - 1) * w));   // the last row
      assert.deepEqual(Array.from({length: h}, (_, j) => got[j * w + w - 1]), Array.from({length: h}, (_, j) => bytes[j * w + w - 1]));   // the last column
      if (s.paged) await pagesIdle(s);
      assert.deepEqual(s.errors, []);
    } finally { s.dispose(); }
  }
});

test('an image placed on the 16 px grid exports its bytes where it lies, in every mode that sets the ground to it', gpu, async () => {
  const w = 64, h = 48, bytes = hardBytes(w, h), at = {x: 320, y: 208}, image = encodeSamples(bytes);
  const s = await open([['heights', [], {image, width: w, height: h, ...at}]]);
  try {
    const mw = s.config.map.widthCells, inside = heights => { let wrong = 0; for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) if (heights[(at.y / 16 + j) * mw + at.x / 16 + i] !== bytes[j * w + i]) wrong++; return wrong; };
    const replaced = await exported(s);
    assert.equal(inside(replaced), 0);
    // Past the margin (two samples round the image) the plain is untouched; the row of corners just past the samples holds the repeated edge.
    const base = Math.round(s.config.baseHeight), row = at.y / 16, col = at.x / 16;
    assert.equal(replaced[(row - 3) * mw + col + 5], base); assert.equal(replaced[(row + h + 2) * mw + col + 5], base); assert.equal(replaced[(row + 5) * mw + col - 3], base); assert.equal(replaced[(row + 5) * mw + col + w + 2], base);
    assert.equal(replaced[(row - 1) * mw + col + 5], bytes[5]); assert.equal(replaced[(row + h) * mw + col + 5], bytes[(h - 1) * w + 5]);
    // Flatten is the image on its samples and eases into the plain across the margin; raise and cut keep the higher and the lower of image and plain.
    s.play([['heights', [], {image, width: w, height: h, ...at, mode: 'flatten'}]], {ground: false});
    const flat = await exported(s);
    assert.equal(inside(flat), 0);
    const edge = bytes[20 * w], between = flat[(row + 20) * mw + col - 1];
    assert.ok(Math.min(edge, base) <= between && between <= Math.max(edge, base) && flat[(row + 20) * mw + col - 2] === base, 'the margin lies between the edge sample and the plain');
    // (Where a sample is within a cell's slope of the plain the two cross between lattice cells, and the corner is a mix of both: those are left out.)
    for (const [mode, pick] of [['raise', Math.max], ['cut', Math.min]]) {
      s.play([['heights', [], {image, width: w, height: h, ...at, mode}]], {ground: false});
      const got = await exported(s); let wrong = 0, checked = 0;
      for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) if (Math.abs(bytes[j * w + i] - base) > 40) { checked++; if (got[(row + j) * mw + col + i] !== pick(base, bytes[j * w + i])) wrong++; }
      assert.ok(checked > 600 && wrong === 0, `${mode}: ${wrong} of ${checked}`);
    }
    // 16-bit samples with a scale: 256 steps a height unit.
    s.play([['heights', [], {image: encodeSamples(bytes.map(v => v * 256), 16), bits: 16, width: w, height: h, ...at, scale: 1 / 256}]], {ground: false});
    assert.equal(inside(await exported(s)), 0);
    assert.deepEqual(s.errors, []);
  } finally { s.dispose(); }
});

test('pages and the whole map agree on a scene of height images', gpu, async () => {
  const headless = await import('./headless.mjs'), scene = fixtureScene();
  // Undulation 3: the fixture was drawn on Green's undulating plain (the world's default until 2026-11-10); its cut and raise images move cells on
  // every side of the lines only against a ground that is not level.
  const s = await headless.openScene(scene, 'biome=green&scratch=1&mapX=4&mapY=4&gpuPages=force&gpuMB=512&heapMB=1536&undulation=3');
  try {
    const result = await s.engine.regionalCheck({fields: s.fields, device: s.renderer.device, nodes: s.nodes, context: s.context(), config: s.config, grid: s.worldGrid, spacing: s.spacing, minH: s.minH, maxH: s.maxH});
    assert.equal(result.mismatches, 0, JSON.stringify(Object.entries(result.planes).filter(([, p]) => p.mismatches)));
    assert.deepEqual(s.errors, []);
    // The check can fail: each image moves cells on both sides of the page seam (cell 512) and of the quadrant lines (cell 584).
    const whole = await s.fieldsModule.createShapeEngine({device: s.renderer.device, grid: s.worldGrid, spacing: s.spacing, baseHeight: s.config.baseHeight, sea: s.config.seaLevel, minH: s.minH, maxH: s.maxH});
    try {
      const rect = {x0: 100, y0: 280, x1: 840, y1: 880}, W = rect.x1 - rect.x0 + 1, H = rect.y1 - rect.y0 + 1;   // the cells the images cover
      const all = (await whole.run(s.nodes.slice(), s.context(), rect)).floats[0];
      for (const k of [2, 3, 4, 5]) {
        const without = (await whole.run(s.nodes.filter((_, i) => i !== k), s.context(), rect)).floats[0], moved = [0, 0, 0, 0];
        for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) if (all[y * W + x] !== without[y * W + x]) { moved[0] += rect.x0 + x < 512; moved[1] += rect.x0 + x >= 584; moved[2] += rect.y0 + y < 512; moved[3] += rect.y0 + y >= 584; }
        assert.ok(moved.every(n => n > 50), `image ${k} moves cells on both sides of the lines: ${moved}`);
      }
    } finally { whole.destroy(); }
  } finally { s.dispose(); }
});

// The same surface in JS (engine-shape.wgsl hmWeights and `heights`, replace): the preview lattice has its own spacing, so its values are
// compared with the formula, not with the map's.
function surface(values, f, px, py) {
  const collar = .15625, weights = t => {
    if (t <= collar) return [-.5 * t, 1, .5 * t, 0];
    if (t >= 1 - collar) return [0, -.5 * (t - 1), 1, .5 * (t - 1)];
    const span = 1 - 2 * collar, q = (t - collar) / span, a = 2 * q ** 3 - 3 * q * q + 1, b = (q ** 3 - 2 * q * q + q) * span, c = 3 * q * q - 2 * q ** 3, d = (q ** 3 - q * q) * span;
    return [a * -.5 * collar + b * -.5, a + c * .5 * collar + d * -.5, a * .5 * collar + b * .5 + c, c * -.5 * collar + d * .5];
  };
  const su = Math.fround(Math.fround(px - f.x) / f.cell), sv = Math.fround(Math.fround(py - f.y) / f.cell);   // in f32, as the shader finds it
  if (Math.max(-su, Math.fround(su - (f.width - 1)), -sv, Math.fround(sv - (f.height - 1))) > HEIGHTS_REACH) return null;
  const i = Math.floor(su), j = Math.floor(sv), wx = weights(su - i), wy = weights(sv - j), at = (a, b) => values[Math.max(0, Math.min(f.height - 1, b)) * f.width + Math.max(0, Math.min(f.width - 1, a))];
  let v = 0; for (let b = 0; b < 4; b++) for (let a = 0; a < 4; a++) v += wy[b] * wx[a] * at(i - 1 + a, j - 1 + b);
  return v;
}

test('the preview lattice draws the same surface, from an image of the largest size', gpu, async () => {
  // sculpt-preview.js: the paged shader over one 512 x 512 target for the whole map, here a 40 x 40 map's (20,800 px: about 40.7 px a cell).
  const headless = await import('./headless.mjs'); await headless.openHost();
  const fieldsModule = await import('../sculpt-gpu-fields.js'), adapter = await navigator.gpu.requestAdapter(), device = await adapter.requestDevice();
  const {width, height} = HEIGHTS_LIMIT, size = Math.max(mapGeometry(40, 40).width, mapGeometry(40, 40).height) + 160, grid = 512, spacing = (size - 1) / (grid - 1), baseHeight = 84;
  const samples = Uint8Array.from({length: width * height}, (_, k) => { const i = k % width, j = (k - i) / width; return Math.round(127 + 60 * Math.sin(.021 * i + .013 * j) + 50 * Math.cos(.037 * j - .008 * i) + 12 * Math.sin(.31 * i) * Math.sin(.27 * j)); });
  const node = heightsNode({image: encodeSamples(samples), width, height, x: 16, y: 32}), nodes = [node], ctx = {seed: 1, params: n => n.params, sea: 75, baseHeight};
  const engine = await fieldsModule.createShapeEngine({device, grid, spacing, refSpacing: 2, baseHeight, sea: 75, minH: -15, maxH: 375, pages: true}), target = engine.makeTarget(0, 0, grid, grid);
  try {
    const run = async rect => { const h = engine.submit(nodes, ctx, rect, {readback: true, target}); await h.done; return h.land; };
    const all = await run(null), h = all.floats[0];
    let worst = 0, inside = 0;
    for (let y = 0; y < grid; y++) for (let x = 0; x < grid; x++) {
      const want = surface(samples, node, Math.fround(Math.fround(x) * Math.fround(spacing)), Math.fround(Math.fround(y) * Math.fround(spacing))), got = h[y * grid + x];
      if (want === null) { assert.equal(got, baseHeight, `cell ${x},${y} is outside the image`); continue; }
      inside++; worst = Math.max(worst, Math.abs(got - want));
    }
    assert.ok(inside > .95 * grid * grid && worst < .002, `${inside} cells inside, the worst ${worst} from the formula`);
    // An evaluation of a rectangle takes only the samples under it, and gives the same cells bit for bit.
    const rect = {x0: 201, y0: 97, x1: 333, y1: 260}, part = (await run(rect)).floats[0], w = rect.x1 - rect.x0 + 1;
    for (let y = rect.y0; y <= rect.y1; y++) for (let x = rect.x0; x <= rect.x1; x++) assert.equal(part[(y - rect.y0) * w + x - rect.x0], h[y * grid + x]);
  } finally { target.destroy(); engine.destroy(); device.destroy(); }
});

// ---- the page ----
// The page's own functions for a save, a load and an undo step (sculpt.js is the page's script and does not load under Node, so they are taken
// from its text and run here over a node list).
function pageNodeFunctions() {
  const page = readFileSync(`${root}sculpt.js`, 'utf8');
  const take = name => { const at = page.indexOf(`\nfunction ${name}(`), line = page.indexOf('\n', at + 1); assert.ok(at >= 0, name); return page.slice(at, page[line - 1] === '}' ? line : page.indexOf('\n}', at) + 2); };
  const names = page.match(/const NODE_NAMES=\{[^}]*\};/)[0];
  return new Function('clonePaths', 'validatePaths', 'heightsNode', `let nodes=[]; ${names} ${['cloneNodes', 'serializeNodes', 'deserializeNodes', 'checkedHeights'].map(take).join('\n')}
    return {cloneNodes, serializeNodes, deserializeNodes, set: list => { nodes = list; }, get: () => nodes};`)(clonePaths, validatePaths, heightsNode);
}

test('a height image survives the page\'s save, load and undo byte for byte', () => {
  const page = pageNodeFunctions();
  const eight = bumps(64, 64, 70, [[20, 18, 90, 7], [44, 40, 140, 10]]), sixteen = bumps(9, 7, 21000, [[4, 3, 30000, 2]], 65535);
  page.set(sceneNodes(config, [['hill', [[100, 100], [300, 120]], {}], ['heights', [], {image: encodeSamples(eight), width: 64, height: 64, x: 320, y: 208}],
    ['heights', [], {image: encodeSamples(sixteen, 16), bits: 16, width: 9, height: 7, cell: 40, x: 12.5, y: -8, scale: 1 / 256, offset: 3, mode: 'flatten'}]]));
  const drawn = page.get(), saved = JSON.stringify(page.serializeNodes());
  // Load: the nodes of the saved text, saved again, are the same text for each image, and the same samples.
  page.set(page.deserializeNodes(JSON.parse(saved)));
  const loaded = page.get(), again = JSON.stringify(page.serializeNodes());
  for (const i of [2, 3]) assert.equal(JSON.stringify(JSON.parse(again)[i]), JSON.stringify(JSON.parse(saved)[i]));
  page.set(page.deserializeNodes(JSON.parse(again)));
  assert.equal(JSON.stringify(page.serializeNodes()), again);   // and from then on the whole list is
  assert.deepEqual([...decodeSamples(loaded[2].image)], eight);
  assert.deepEqual([...decodeSamples(loaded[3].image, 16)], sixteen);
  assert.deepEqual(loaded[3], {...drawn[3]});
  // Undo and redo: a history entry is cloneNodes() of the list, and a step back or forward is cloneNodes() of the entry.
  page.set(loaded);
  const entry = page.cloneNodes();
  page.set(loaded.filter(n => n.kind !== 'heights'));                // an edit: the images deleted
  const later = page.cloneNodes();
  page.set(page.cloneNodes(entry));                                  // undo
  assert.equal(JSON.stringify(page.serializeNodes()), again);
  assert.equal(page.get()[2].image, loaded[2].image);
  page.set(page.cloneNodes(later)); assert.deepEqual(page.get().map(n => n.kind), ['ground', 'landform']);   // redo
  page.set(page.cloneNodes(entry)); assert.equal(JSON.stringify(page.serializeNodes()), again);              // and undo again
});

test('a save with an image the engine cannot draw is refused when it loads', () => {
  const page = pageNodeFunctions(), good = {kind: 'heights', ...small()};
  assert.equal(page.deserializeNodes([{kind: 'ground', amplitude: 8}, good]).length, 2);
  assert.throws(() => page.deserializeNodes([{kind: 'ground', amplitude: 8}, {...good, width: 1283, height: 1288, image: ''}]), /^Error: Height image \(stroke 2\) has 1283 x 1288 samples, over the limit of 1282 x 1288\.$/);
  assert.throws(() => page.deserializeNodes([{...good, image: good.image.slice(4)}]), /^Error: Height image \(stroke 1\) needs 6 x 5 samples of 8 bits as base64: 30 bytes, 40 characters\.$/);
  // loadSketch makes the new node list before it changes anything, and a load into another world checks the images before it leaves this one.
  const text = readFileSync(`${root}sculpt.js`, 'utf8'), load = text.slice(text.indexOf('\nfunction loadSketch('), text.indexOf('\n}', text.indexOf('\nfunction loadSketch(')));
  assert.match(load.split('\n')[3], /^  const next=deserializeNodes\(/);
  assert.match(text, /copyColumn\(s\.column\);copyRockSettings\(s\.rock\);s\.nodes\.forEach\(checkedHeights\);\n    \} catch \(err\) \{ error\(err\.message\); return false; \}/);
});
