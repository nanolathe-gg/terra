import test from 'node:test';
import assert from 'node:assert/strict';
import {drainageReference, NONE} from './drainage-reference.mjs';

test('a tilted plane drains every row to its low edge', () => {
  const w = 6, h = new Float32Array(w * w);
  for (let y = 0; y < w; y++) for (let x = 0; x < w; x++) h[y * w + x] = 10 - x;   // falls toward +x
  const {area, recv} = drainageReference(h, w);
  for (let y = 0; y < w; y++) assert.equal(recv[y * w + w - 1], NONE);
  for (let y = 0; y < w; y++) for (let x = 0; x < w; x++) assert.ok(area[y * w + x] >= 1);
  assert.equal([...Array(w).keys()].reduce((n, y) => n + area[y * w + w - 1], 0), w * w);   // the low column's outlets hold every cell
});

test('a pit fills to its lowest rim and drains out over it', () => {
  const w = 9, h = new Float32Array(w * w);
  for (let y = 0; y < w; y++) for (let x = 0; x < w; x++) h[y * w + x] = 1 + Math.hypot(x - 4, y - 4);
  h[4 * w + 7] -= 0.5; h[4 * w + 8] = 2;     // the lowest rim of the bowl is on the east side, with an outlet beyond it
  const {area, recv, F} = drainageReference(h, w);
  assert.equal(recv[4 * w + 4] !== NONE, true);           // the pit is no root now
  assert.equal(F[4 * w + 4], h[4 * w + 7]);              // it holds water up to its lowest rim
  let roots = 0, held = 0; for (let i = 0; i < w * w; i++) if (recv[i] === NONE) { roots++; held += area[i]; }
  assert.equal(held, w * w);                              // every cell ends in an edge outlet
  assert.ok(roots <= 4 * (w - 1));
});

test('a flat is routed to its way out, not left as outlets', () => {
  const w = 12, h = new Float32Array(w * w).fill(10);
  for (let y = 0; y < w; y++) for (let x = 0; x < 3; x++) h[y * w + x] = 4 + x;   // a shelf on the west and a drop; the flat spans x >= 3
  h[5 * w + 11] = 10;
  const {area, recv, D} = drainageReference(h, w);
  let roots = 0; for (let i = 0; i < w * w; i++) if (recv[i] === NONE) roots++;
  assert.ok(roots <= 2 * w + 2 * (w - 2));                // edge outlets only
  assert.equal(area.reduce((n, a, i) => n + (recv[i] === NONE ? a : 0), 0), w * w);
  for (let i = 0; i < w * w; i++) if (recv[i] !== NONE && h[i] === 10 && h[recv[i]] === 10) assert.ok(D[recv[i]] < D[i]);   // across the flat the distance falls
});

test('cells at or under the sea are outlets', () => {
  const w = 6, h = new Float32Array(w * w);
  for (let y = 0; y < w; y++) for (let x = 0; x < w; x++) h[y * w + x] = 5 - x;
  const {recv, area} = drainageReference(h, w, 3);
  assert.equal(recv[2], NONE); assert.equal(recv[3], NONE);   // x = 2 is at the sea, x = 3 under it
  assert.equal(area[2], 3); assert.equal(area[3], 1);         // the sea cell holds the land that drains to it
});
