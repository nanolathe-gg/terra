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
