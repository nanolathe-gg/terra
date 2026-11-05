import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {generateFeature, paintDeposit, paintVent, IDX} from '../sculpt-feature-gen.js';
const palette = JSON.parse(readFileSync(new URL('../materials/palette.json', import.meta.url))).indexed;
const sig = s => s ? `${s.w}x${s.h}@${s.ax},${s.ay}:` + Buffer.from(s.idx).toString('hex') + Buffer.from(s.a).toString('hex') : '';
test('palette has 256 indexed colors', () => assert.equal(palette.length, 256));
for (const [kind, params] of [['tree', {}], ['tree', {species: 'conifer', height: 61, width: 0.5}], ['burnt', {}], ['shrub', {}], ['rock', {cells: '3x3'}], ['scar', {type: 'smudge'}], ['scar', {type: 'stain'}]]) {
  test(`${kind} ${params.species || params.cells || params.type || ''} is deterministic and palette-only`, () => {
    const a = generateFeature(kind, params, 77), b = generateFeature(kind, params, 77), c = generateFeature(kind, params, 78);
    assert.equal(sig(a.body), sig(b.body)); assert.equal(sig(a.shadow), sig(b.shadow));
    assert.notEqual(sig(a.body), sig(c.body));
    for (let k = 0; k < a.body.w * a.body.h; k++) if (a.body.a[k]) assert.ok(a.body.idx[k] < 256 && a.body.idx[k] !== IDX.KEY);
    if (a.burn) assert.equal(a.burn.map(sig).join('|'), b.burn.map(sig).join('|'));
  });
}
test('deposits and vents paint the same bytes twice', () => {
  const mk = () => ({w: 100, h: 100, rgba: new Uint8ClampedArray(100 * 100 * 4).map((_, i) => i % 4 === 3 ? 255 : [70, 110, 40][i % 4])});
  const a = mk(), b = mk(); paintDeposit(a, 50, 50, {metal: 150}, 3, {palette}); paintDeposit(b, 50, 50, {metal: 150}, 3, {palette});
  assert.deepEqual(a.rgba, b.rgba);
  const c = mk(), d = mk(); paintVent(c, 50, 50, {}, 3, {palette}); paintVent(d, 50, 50, {}, 3, {palette});
  assert.deepEqual(c.rgba, d.rgba);
});
