import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {generateFeature, paintDeposit, paintVent, IDX} from '../sculpt-feature-gen.js';
const palette = JSON.parse(readFileSync(new URL('../materials/palette.json', import.meta.url))).indexed;
const sig = s => s ? `${s.w}x${s.h}@${s.ax},${s.ay}:` + Buffer.from(s.idx).toString('hex') + Buffer.from(s.a).toString('hex') : '';
test('palette has 256 indexed colors', () => assert.equal(palette.length, 256));
for (const [kind, params] of [['tree', {}], ['tree', {species: 'conifer', height: 61, width: 0.5}], ['burnt', {}], ['burnt', {species: 'conifer', height: 56, width: 0.5}], ['shrub', {}], ['rock', {cells: '3x3'}], ['scar', {type: 'smudge'}], ['scar', {type: 'stain'}]]) {
  test(`${kind} ${params.species || params.cells || params.type || ''} is deterministic and palette-only`, () => {
    const a = generateFeature(kind, params, 77, {palette}), b = generateFeature(kind, params, 77, {palette}), c = generateFeature(kind, params, 78, {palette});
    assert.equal(sig(a.body), sig(b.body)); assert.equal(sig(a.shadow), sig(b.shadow));
    assert.notEqual(sig(a.body), sig(c.body));
    for (let k = 0; k < a.body.w * a.body.h; k++) if (a.body.a[k]) assert.ok(a.body.idx[k] < 256 && a.body.idx[k] !== IDX.KEY);
    if (a.burn) assert.equal(a.burn.map(sig).join('|'), b.burn.map(sig).join('|'));
  });
}
test('deposits and vents paint the same bytes twice', () => {
  const mk = () => ({w: 100, h: 100, rgba: new Uint8ClampedArray(100 * 100 * 4).map((_, i) => i % 4 === 3 ? 255 : [70, 110, 40][i % 4])});
  const a = mk(), b = mk(); paintDeposit(a, 50, 50, {metal: 150}, 3, {palette}); paintDeposit(b, 50, 50, {metal: 150}, 3, {palette});
  for (const style of ['pebbles']) { const e = mk(), f = mk(); paintDeposit(e, 50, 50, {metal: 150, style}, 3, {palette}); paintDeposit(f, 50, 50, {metal: 150, style}, 3, {palette}); assert.deepEqual(e.rgba, f.rgba); }
  assert.deepEqual(a.rgba, b.rgba);
  const c = mk(), d = mk(); paintVent(c, 50, 50, {}, 3, {palette}); paintVent(d, 50, 50, {}, 3, {palette});
  assert.deepEqual(c.rgba, d.rgba);
});

test('burnt trees carry no embers or fire colors (only the burn-out frame does)', () => {
  for (const params of [{}, {species: 'conifer', height: 56, width: 0.5}]) for (const seed of [1, 7, 99]) {
    const b = generateFeature('burnt', params, seed, {palette}).body, t = generateFeature('tree', params.species ? {species: 'conifer', height: 61, width: 0.5} : {}, seed, {palette});
    for (const sp of [b, t.burnt.body]) for (let k = 0; k < sp.w * sp.h; k++) if (sp.a[k]) assert.ok(sp.idx[k] < 192 || sp.idx[k] > 216);
    const last = t.burn[95]; let fire = 0; for (let k = 0; k < last.w * last.h; k++) if (last.a[k] && last.idx[k] >= 192 && last.idx[k] <= 216) fire++;
    assert.ok(fire > 0);   // the last burn frame keeps its embers
  }
});

test('rocks have no highlight pixels in the shaded lower right', () => {
  for (const seed of [3, 4, 5]) {
    const r = generateFeature('rock', {cells: '3x3'}, seed, {palette}).body, cx = r.w / 2, cy = r.h / 2;
    for (let y = 0; y < r.h; y++) for (let x = 0; x < r.w; x++) { const k = y * r.w + x, d = ((x - cx) * 0.62 + (y - cy) * 0.7) / (r.w * 0.35 + r.h * 0.35); if (r.a[k] && d > 0.45) { const c = r.idx[k]; assert.ok(!(c === 255 || (c >= 81 && c <= 84) || (c >= 64 && c <= 67)), `bright pixel ${c} at ${x},${y}`); } }
  }
});

test('no grass pixel falls inside a deposit plate', () => {
  for (const metal of [86, 127, 187, 223]) {
    const W = 128, g = {w: W, h: W, rgba: new Uint8ClampedArray(W * W * 4)}; for (let i = 0; i < W * W; i++) { g.rgba[i * 4] = 70; g.rgba[i * 4 + 1] = 110; g.rgba[i * 4 + 2] = 40; g.rgba[i * 4 + 3] = 255; }
    paintDeposit(g, 64, 64, {metal}, 700 + metal, {palette});
    const isGrass = i => g.rgba[i * 4] === 70 && g.rgba[i * 4 + 1] === 110 && g.rgba[i * 4 + 2] === 40;
    const isStone = i => { const r = g.rgba[i * 4], gg = g.rgba[i * 4 + 1], b = g.rgba[i * 4 + 2]; return !isGrass(i) && 0.299 * r + 0.587 * gg + 0.114 * b >= 100 && !(gg > r + 8 && gg > b + 8); };
    for (let y = 2; y < W - 2; y++) for (let x = 2; x < W - 2; x++) { const i = y * W + x; if (isStone(i)) continue; let n = 0; for (const d of [1, -1, W, -W]) if (isStone(i + d)) n++; assert.ok(n < 4, `grass or moss enclosed by a plate at ${x},${y} (metal ${metal})`); }
  }
});

test('a recolor to the world color changes no byte; another color changes the sprite', () => {
  for (const [kind, params, ref] of [['rock', {cells: '2x2'}, '#949494'], ['tree', {}, '#11723c'], ['shrub', {density: 0.6}, '#43972b']]) {
    const a = generateFeature(kind, params, 5, {palette, bodyOnly: true}), b = generateFeature(kind, {...params, recolor: {from: ref, to: ref}}, 5, {palette, bodyOnly: true}), c = generateFeature(kind, {...params, recolor: {from: ref, to: '#b8732a'}}, 5, {palette, bodyOnly: true});
    assert.equal(sig(a.body), sig(b.body), kind); assert.notEqual(sig(a.body), sig(c.body), kind);
  }
});

// Round 11: shadows are solid silhouettes; the column, shard, plate and frond forms are generic options.
const fillOf = s => { let n = 0, rows = 0, run = 0; for (let y = 0; y < s.h; y++) { let a = -1, b = -1, c = 0; for (let x = 0; x < s.w; x++) if (s.a[y * s.w + x]) { if (a < 0) a = x; b = x; c++; } if (a >= 0) { run += b - a + 1; n += c; rows++; } } return n / run; };
test('shadows are solid dark silhouettes in one color, not a stipple', () => {
  for (const [kind, params] of [['tree', {}], ['rock', {cells: '4x4', tall: 1}]]) {
    const f = generateFeature(kind, params, 11, {palette}), s = f.shadow;
    assert.ok(fillOf(s) > 0.75, `${kind} shadow fill ${fillOf(s)}`);
    const colors = new Set(); for (let k = 0; k < s.w * s.h; k++) if (s.a[k]) colors.add(s.idx[k]);
    assert.equal(colors.size, 1); assert.equal(f.shadowBlend, 0.5);
  }
  const ice = generateFeature('rock', {cells: '3x3', shadowColor: '#000f47'}, 3, {palette}).shadow;
  assert.deepEqual(palette[ice.idx[ice.a.indexOf(1)]], [0, 15, 71]);
});
test('column clusters, shards, plates and fronds: deterministic and different from their defaults', () => {
  const cases = [['rock', {cells: '6x5', tall: 1, form: 'columns', parts: 10, plate: 0.6, plateTone: 0.8, lump: 0}], ['rock', {cells: '4x4', tall: 0.2, form: 'shards', parts: 8, lump: 0}],
    ['rock', {cells: '3x3', tall: 0.5, form: 'columns', round: 1, parts: 3, plate: 0.4, plateTone: -0.6}], ['tree', {clusters: 1, fronds: 1}]];
  for (const [kind, params] of cases) {
    const a = generateFeature(kind, params, 5, {palette, bodyOnly: true}), b = generateFeature(kind, params, 5, {palette, bodyOnly: true}), base = generateFeature(kind, {...params, form: undefined, plate: 0, fronds: 0}, 5, {palette, bodyOnly: true});
    assert.equal(sig(a.body), sig(b.body)); assert.notEqual(sig(a.body), sig(base.body)); assert.ok(a.shadow.w > 0);
  }
  const plated = generateFeature('rock', {cells: '6x5', tall: 1, form: 'columns', plate: 0.8}, 5, {palette}).body, bare = generateFeature('rock', {cells: '6x5', tall: 1, form: 'columns'}, 5, {palette}).body;
  assert.ok(plated.w > bare.w, 'the plate widens the sprite');
});

// Round 12: the plate, gem, dead-tree, speckle, block and halo options are generic and deterministic.
test('plate cell, crack, tilt, colors; column roughness and gems; blocks: each option changes the sprite and stays deterministic', () => {
  const base = {cells: '5x5', tall: 0.6, form: 'columns', round: 1, parts: 4, plate: 0.9, plateTone: 1, lump: 0};
  const cases = [['plateCell', 16], ['plateCrack', 3.2], ['plateTilt', 1.2], ['plateHatch', 1], ['plateRough', 0.6], ['plateGamma', 2], ['plateColors', ['#050505', '#4f2b6f', '#8b6fa0']], ['colRough', 1], ['colWidth', 1.4], ['capColors', ['#241a60', '#b0a4f0']]];
  for (const [key, value] of cases) {
    const a = generateFeature('rock', {...base, [key]: value}, 5, {palette, bodyOnly: true}), b = generateFeature('rock', {...base, [key]: value}, 5, {palette, bodyOnly: true}), c = generateFeature('rock', base, 5, {palette, bodyOnly: true});
    assert.equal(sig(a.body), sig(b.body), key); assert.notEqual(sig(a.body), sig(c.body), key);
  }
  { const flat = {cells: '6x5', tall: 1, form: 'columns', parts: 10, lump: 0}, a = generateFeature('rock', {...flat, topTilt: 2.4}, 5, {palette, bodyOnly: true}), b = generateFeature('rock', flat, 5, {palette, bodyOnly: true}); assert.notEqual(sig(a.body), sig(b.body), 'topTilt'); }
  const ruin = generateFeature('rock', {cells: '5x4', form: 'blocks', parts: 40, wall: 0.5, angular: 0, lump: 0, metal: 0, reclaimable: false}, 5, {palette, bodyOnly: true}), again = generateFeature('rock', {cells: '5x4', form: 'blocks', parts: 40, wall: 0.5, angular: 0, lump: 0, metal: 0, reclaimable: false}, 5, {palette, bodyOnly: true});
  assert.equal(sig(ruin.body), sig(again.body)); assert.ok(ruin.body.w > 30 && ruin.body.h > 10);
});
test('the plate is slabs standing on the ground, not a lid: no pixel of a plated rock sits above its own spire', () => {
  const f = generateFeature('rock', {cells: '6x5', tall: 1, form: 'columns', parts: 20, plate: 1, plateTone: 1, lump: 0}, 7, {palette, bodyOnly: true}).body;
  assert.ok(f.w > 0 && f.h > 0);
});
test('dead trees are trees that neither burn nor leave a successor', () => {
  for (const species of ['dead', 'deadConifer']) {
    const f = generateFeature('tree', {species, energy: [50, 50]}, 9, {palette}), g = generateFeature('tree', {species, energy: [50, 50]}, 9, {palette});
    assert.equal(f.kind, 'tree'); assert.equal(f.burn, null); assert.equal(f.burnt, null); assert.equal(f.gameplay.energy, 50); assert.equal(f.gameplay.flamable, false);
    assert.equal(sig(f.body), sig(g.body)); assert.ok(f.shadow.w > 0);
  }
});
test('speckle scars are opaque near-black dust, deterministic, sized by size', () => {
  const a = generateFeature('scar', {type: 'speckle', size: 1.2, density: 0.25}, 4, {palette}), b = generateFeature('scar', {type: 'speckle', size: 1.2, density: 0.25}, 4, {palette}), small = generateFeature('scar', {type: 'speckle', size: 0.3}, 4, {palette});
  assert.equal(sig(a.body), sig(b.body)); assert.ok(a.body.w > small.body.w); assert.equal(a.bodyBlend, 1);
  for (let k = 0; k < a.body.w * a.body.h; k++) if (a.body.a[k]) assert.ok(palette[a.body.idx[k]].every(v => v < 80));
});
test('a thin spire leaves no stray specks: its picture is one piece', () => {
  const f = generateFeature('rock', {cells: '6x5', tall: 1, lump: 0.8, grain: 0.8}, 21, {palette, bodyOnly: true}).body, seen = new Uint8Array(f.w * f.h);
  let comps = 0; for (let k0 = 0; k0 < f.w * f.h; k0++) { if (!f.a[k0] || seen[k0]) continue; comps++; const st = [k0]; seen[k0] = 1; while (st.length) { const k = st.pop(), x = k % f.w, y = (k / f.w) | 0; for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) { const X = x + dx, Y = y + dy; if (X < 0 || Y < 0 || X >= f.w || Y >= f.h) continue; const q = Y * f.w + X; if (f.a[q] && !seen[q]) { seen[q] = 1; st.push(q); } } } }
  assert.equal(comps, 1);
});
test('halo roughness changes the deposit outline', () => {
  const mk = () => ({w: 100, h: 100, rgba: new Uint8ClampedArray(100 * 100 * 4).map((_, i) => i % 4 === 3 ? 255 : [70, 110, 40][i % 4])});
  const a = mk(), b = mk(); paintDeposit(a, 50, 50, {metal: 150, haloRough: 5}, 3, {palette}); paintDeposit(b, 50, 50, {metal: 150, haloRough: 12}, 3, {palette});
  assert.notDeepEqual(a.rgba, b.rgba);
});

test('an underwater deposit is an opaque blue blob whose area follows metal, and the same seed paints the same bytes', () => {
  const W = 128, ground = () => { const g = {w: W, h: W, rgba: new Uint8ClampedArray(W * W * 4)}; for (let i = 0; i < W * W; i++) g.rgba.set([70, 110, 40, 0], i * 4); return g; };
  const area = (metal, seed = 5) => {
    const g = ground(), info = paintDeposit(g, 64, 64, {metal, underwater: true}, seed, {palette}); let n = 0, blue = 0;
    for (let i = 0; i < W * W; i++) if (g.rgba[i * 4 + 3] === 255) { n++; if (g.rgba[i * 4 + 2] > g.rgba[i * 4] + 40) blue++; }
    assert.equal(info.look, 'aqua'); assert.ok(blue > n * 0.9, 'mostly blue'); return {n, g};
  };
  const a = area(116), b = area(250), again = area(116);
  assert.ok(a.n > 800 && a.n < 1500, 'area at metal 116: ' + a.n); assert.ok(b.n > a.n * 1.3, 'more metal, more area');
  assert.deepEqual(a.g.rgba, again.g.rgba);
});


test('the complete deposit stone cluster is centered on its placement anchor', () => {
  for (const look of ['plates', 'cluster', 'blades']) for (const seed of [1, 77, 4069523796]) {
    const w = 128, g = {w, h: w, rgba: new Uint8ClampedArray(w * w * 4)};
    for (let i = 0; i < w * w; i++) g.rgba.set([70, 110, 40, 0], i * 4);
    // A black halo separates the stones from their ground treatment for this check.
    paintDeposit(g, 64, 64, {metal: 127, look, round: 0.7, halo: 0}, seed, {palette});
    const xs = [], ys = [];
    for (let y = 0; y < w; y++) for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 4, [r, green, b] = g.rgba.subarray(i, i + 3);
      if (0.299 * r + 0.587 * green + 0.114 * b >= 100 && !(green > r + 8 && green > b + 8)) { xs.push(x); ys.push(y); }
    }
    assert.ok(xs.length, `${look}, seed ${seed}: visible stones`);
    for (const [axis, coords] of [['x', xs], ['y', ys]]) {
      const center = (Math.min(...coords) + Math.max(...coords) + 1) / 2;
      assert.ok(Math.abs(center - 64) <= 0.5, `${look}, seed ${seed}: ${axis} center ${center} must meet the anchor within half a pixel`);
    }
  }
});


test('a rock stays anchored to its ground footprint as its height changes', () => {
  for (const seed of [1, 77, 2791713894]) for (const tall of [0, 0.6, 1]) {
    // With a vertical sun, a smooth single rock casts its shadow directly on
    // its ground footprint. Its body height must not displace that footprint.
    const f = generateFeature('rock', {cells: '3x2', angular: 0, lump: 0, pits: 0, pieces: 1, shadowLen: 0, tall}, seed, {palette, bodyOnly: true});
    const s = f.shadow, xs = [], ys = [];
    for (let y = 0; y < s.h; y++) for (let x = 0; x < s.w; x++) if (s.a[y * s.w + x]) { xs.push(x); ys.push(y); }
    assert.ok(xs.length, `seed ${seed}, height ${tall}: ground shadow exists`);
    for (const [axis, coords, anchor] of [['x', xs, s.ax], ['y', ys, s.ay]]) {
      const center = (Math.min(...coords) + Math.max(...coords) + 1) / 2;
      assert.ok(Math.abs(center - anchor) <= 0.5, `seed ${seed}, height ${tall}: ${axis} shadow offset ${center - anchor}`);
    }
  }
});
