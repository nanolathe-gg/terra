// GPU integration checks for imported height images. Run explicitly with repro/check.sh engine,
// or node --test repro/heights.gpu.test.mjs. A missing Dawn binding is an error here.
import test from 'node:test';
import assert from 'node:assert/strict';
import {HEIGHTS_REACH, HEIGHTS_LIMIT} from '../sculpt-gpu-fields.js';
import {cellHeights, mapGeometry, sampleField, footprintApron} from '../sculpt-map.js';
import {encodeSamples, bumps, hashBytes, fixtureScene} from './heights-fixture.mjs';
import {heightsNode} from '../sculpt-scene.js';

const open = async (strokes, query = '', map = '4x4') => {
  const headless = await import('./headless.mjs'), [mapX, mapY] = map.split('x');
  return headless.openScene({biome: 'green', ground: false, strokes}, `biome=green&mapX=${mapX}&mapY=${mapY}&scratch=1&gpuMB=512&heapMB=1536${query}`);
};
// The fields as the export reads them: no Time pass has run, so the read is the authored surface.
const readFor = s => async request => { if (s.paged) return s.fields.readAsync(request); await s.fields.ready(); return s.fields.read(request); };
// The authored surface at each cell corner (the field there, point-sampled): where a height image draws its samples.
const fieldCorners = async s => (await cellHeights(s.config.map, readFor(s), {footprint: {kind: 'point'}})).heights;
// The export's promise (sculpt-map.js cornerHeight): each corner byte is the surface's mean over the corner's 16 px square (1 px taps over
// +-8 px, the end taps at half weight), rounded and clamped. Checked against the export (cellHeights) by brute force over point samples of one
// read of the whole map; a corner whose mean lies within 1e-6 of a half may round either way (the two sums differ in their last bits).
async function exportIsFootprintMean(s, label) {
  const map = s.config.map, got = (await cellHeights(map, readFor(s))).heights;
  const r = await readFor(s)({x: 0, y: 0, width: (map.widthCells - 1) * 16, height: (map.heightCells - 1) * 16, apron: footprintApron()});
  const wt = t => (Math.abs(t) === 8 ? .5 : 1) / 16;
  let wrong = 0, first = '';
  for (let z = 0; z < map.heightCells; z++) for (let x = 0; x < map.widthCells; x++) {
    let mean = 0;
    for (let v = -8; v <= 8; v++) { let row = 0; for (let t = -8; t <= 8; t++) row += wt(t) * sampleField(r, x * 16 + t, z * 16 + v); mean += wt(v) * row; }
    const want = Math.round(Math.max(0, Math.min(255, mean))), k = z * map.widthCells + x;
    if (got[k] !== want && Math.abs(mean - Math.floor(mean) - .5) > 1e-6) { wrong++; first ||= `corner ${x},${z}: ${got[k]} for a mean of ${mean}`; }
  }
  assert.equal(wrong, 0, `${label}: ${wrong} corners are not their footprint mean (${first})`);
  return got;
}
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

test('a map holding only a height image of bytes draws those bytes at every corner and exports their footprint means', async () => {
  // The whole map's height bytes: sample (i, j) at pixel (16 i, 16 j), a cell corner. The surface passes through every sample there, and the export
  // takes each corner's 16 px mean of that surface (a hashed block does not survive it, a smooth image nearly does). On the whole-map engine and in pages, and on the
  // smallest map, whose lattice is the coarsest (2.0025 px a cell against 2.0009).
  for (const [map, query] of [['4x4', ''], ['4x4', '&gpuPages=force'], ['1x1', '']]) {
    const {widthCells: w, heightCells: h} = mapGeometry(...map.split('x').map(Number)), bytes = hardBytes(w, h);
    const s = await open([['heights', [], {image: encodeSamples(bytes), width: w, height: h}]], query, map);
    try {
      const got = await fieldCorners(s);
      assert.equal(got.length, w * h);
      let wrong = 0; for (let k = 0; k < w * h; k++) if (got[k] !== bytes[k]) wrong++;
      assert.equal(wrong, 0, `${wrong} of ${w * h} corners differ on ${map}${query && ' in pages'}`);
      const sent = await exportIsFootprintMean(s, `${map}${query && ' in pages'}`);
      let moved = 0; for (let k = 0; k < w * h; k++) if (sent[k] !== bytes[k]) moved++;
      assert.ok(moved > 0, 'the hashed block and the spike do not survive the footprint (the check has teeth)');
      assert.deepEqual([...got.subarray((h - 1) * w)], bytes.slice((h - 1) * w));   // the last row
      assert.deepEqual(Array.from({length: h}, (_, j) => got[j * w + w - 1]), Array.from({length: h}, (_, j) => bytes[j * w + w - 1]));   // the last column
      if (s.paged) await pagesIdle(s);
      assert.deepEqual(s.errors, []);
    } finally { s.dispose(); }
  }
});

test('an image placed on the 16 px grid draws its bytes where it lies, in every mode that sets the ground to it, and exports their footprint means', async () => {
  const w = 64, h = 48, bytes = hardBytes(w, h), at = {x: 320, y: 208}, image = encodeSamples(bytes);
  const s = await open([['heights', [], {image, width: w, height: h, ...at}]]);
  try {
    const mw = s.config.map.widthCells, inside = heights => { let wrong = 0; for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) if (heights[(at.y / 16 + j) * mw + at.x / 16 + i] !== bytes[j * w + i]) wrong++; return wrong; };
    const replaced = await fieldCorners(s);
    assert.equal(inside(replaced), 0);
    await exportIsFootprintMean(s, 'replace');
    // Past the margin (two samples round the image) the plain is untouched; the row of corners just past the samples holds the repeated edge.
    const base = Math.round(s.config.baseHeight), row = at.y / 16, col = at.x / 16;
    assert.equal(replaced[(row - 3) * mw + col + 5], base); assert.equal(replaced[(row + h + 2) * mw + col + 5], base); assert.equal(replaced[(row + 5) * mw + col - 3], base); assert.equal(replaced[(row + 5) * mw + col + w + 2], base);
    assert.equal(replaced[(row - 1) * mw + col + 5], bytes[5]); assert.equal(replaced[(row + h) * mw + col + 5], bytes[(h - 1) * w + 5]);
    // Flatten is the image on its samples and eases into the plain across the margin; raise and cut keep the higher and the lower of image and plain.
    s.play([['heights', [], {image, width: w, height: h, ...at, mode: 'flatten'}]], {ground: false});
    const flat = await fieldCorners(s);
    assert.equal(inside(flat), 0);
    const edge = bytes[20 * w], between = flat[(row + 20) * mw + col - 1];
    assert.ok(Math.min(edge, base) <= between && between <= Math.max(edge, base) && flat[(row + 20) * mw + col - 2] === base, 'the margin lies between the edge sample and the plain');
    // (Where a sample is within a cell's slope of the plain the two cross between lattice cells, and the corner is a mix of both: those are left out.)
    for (const [mode, pick] of [['raise', Math.max], ['cut', Math.min]]) {
      s.play([['heights', [], {image, width: w, height: h, ...at, mode}]], {ground: false});
      const got = await fieldCorners(s); let wrong = 0, checked = 0;
      for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) if (Math.abs(bytes[j * w + i] - base) > 40) { checked++; if (got[(row + j) * mw + col + i] !== pick(base, bytes[j * w + i])) wrong++; }
      assert.ok(checked > 600 && wrong === 0, `${mode}: ${wrong} of ${checked}`);
    }
    // 16-bit samples with a scale: 256 steps a height unit.
    s.play([['heights', [], {image: encodeSamples(bytes.map(v => v * 256), 16), bits: 16, width: w, height: h, ...at, scale: 1 / 256}]], {ground: false});
    assert.equal(inside(await fieldCorners(s)), 0);
    await exportIsFootprintMean(s, '16-bit');
    assert.deepEqual(s.errors, []);
  } finally { s.dispose(); }
});

test('pages and the whole map agree on a scene of height images', async () => {
  const headless = await import('./headless.mjs'), scene = fixtureScene();
  // Undulation 3: the fixture was drawn on Green's undulating plain (the world's default until 2026-11-10); its cut and raise images move cells on
  // every side of the lines only against a ground that is not level.
  const s = await headless.openScene(scene, 'biome=green&scratch=1&mapX=4&mapY=4&gpuPages=force&gpuMB=512&heapMB=1536&undulation=3');
  try {
    const result = await s.engine.regionalCheck({fields: s.fields, device: s.renderer.device, nodes: s.nodes, context: s.context(), config: s.config, grid: s.worldGrid, spacing: s.spacing, minH: s.minH, maxH: s.maxH, ulps: s.engine.regionalUlps(process.platform === 'darwin')});
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

test('the preview lattice draws the same surface, from an image of the largest size', async () => {
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
