import test from 'node:test';
import assert from 'node:assert/strict';
import {generateFeature, IDX} from '../sculpt-feature-gen.js';
import {treeBurn, shrubBurn, isFlameIndex} from '../sculpt-feature-fire.js';

const sig = s => `${s.w}x${s.h}@${s.ax},${s.ay}:` + Buffer.from(s.idx).toString('hex') + Buffer.from(s.a).toString('hex');
const fireCount = s => { let n = 0; for (let k = 0; k < s.w * s.h; k++) if (s.a[k] && isFlameIndex(s.idx[k])) n++; return n; };
const TREES = [['broadleaf', {}], ['conifer', {species: 'conifer', height: 61, width: 0.5}]];

for (const [name, params] of TREES) {
  test(`${name} burn: same bytes for the same seed, other bytes for another seed`, () => {
    const t = generateFeature('tree', params, 41), u = generateFeature('tree', params, 42);
    const a = treeBurn(t.body, t.burnt.body, 41, !!params.species), b = treeBurn(t.body, t.burnt.body, 41, !!params.species);
    assert.equal(a.map(sig).join('|'), b.map(sig).join('|'));
    assert.equal(a.map(sig).join('|'), t.burn.map(sig).join('|'));          // the feature carries this very sequence
    assert.notEqual(a.slice(9, 80).map(sig).join('|'), u.burn.slice(9, 80).map(sig).join('|'));
  });

  test(`${name} burn: 96 frames, fire in 1-94, palette indices only, last frame is the burnt successor with embers`, () => {
    for (const seed of [3, 1000]) {
      const t = generateFeature('tree', params, seed), burn = t.burn, dead = t.burnt.body, last = burn[95];
      assert.equal(burn.length, 96);
      for (let f = 1; f < 95; f++) assert.ok(fireCount(burn[f]) > 0, `frame ${f} has fire`);
      for (const s of burn) for (let k = 0; k < s.w * s.h; k++) if (s.a[k]) assert.ok(s.idx[k] !== IDX.KEY);
      assert.deepEqual([last.w, last.h, last.ax, last.ay], [dead.w, dead.h, dead.ax, dead.ay]);
      assert.deepEqual(Array.from(last.a), Array.from(dead.a));
      assert.ok(fireCount(last) > 0);
      if (!params.species) assert.equal(fireCount(burn[0]), 0, 'frame 0 is the living tree');
    }
  });
}

test('the steady burn moves: consecutive frames differ and the flame rises over the crown at times', () => {
  const burn = generateFeature('tree', {}, 1000).burn;
  let same = 0, high = 0;
  for (let f = 9; f < 79; f++) {
    if (sig(burn[f]) === sig(burn[f + 1])) same++;
    const s = burn[f]; let top = 0;
    for (let y = 0; y < s.h; y++) for (let x = 0; x < s.w; x++) { const k = y * s.w + x; if (s.a[k] && isFlameIndex(s.idx[k])) top = Math.max(top, s.ay - y); }
    if (top > 70) high++;
  }
  assert.equal(same, 0);
  assert.ok(high > 10, `the flame tops 70 px above the anchor in ${high} of 70 frames`);
});

test('shrub burn: 42 frames of flame, deterministic, small last frame', () => {
  const s = generateFeature('shrub', {}, 4001), a = shrubBurn(s.body, 4001), b = shrubBurn(s.body, 4001);
  assert.equal(a.length, 42);
  assert.equal(a.map(sig).join('|'), b.map(sig).join('|'));
  for (const f of a) assert.ok(fireCount(f) > 0.9 * f.a.reduce((p, c) => p + c, 0));
  const drawn = f => f.a.reduce((p, c) => p + c, 0);
  assert.ok(drawn(a[41]) < 0.75 * drawn(a[20]), 'the last frame is a smaller, dying flame');
});
