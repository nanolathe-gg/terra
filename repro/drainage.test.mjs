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

test('a pit is a root and gathers its bowl', () => {
  const w = 5, h = new Float32Array(w * w);
  for (let y = 0; y < w; y++) for (let x = 0; x < w; x++) h[y * w + x] = 1 + Math.hypot(x - 2, y - 2);
  const {area, recv} = drainageReference(h, w);
  assert.equal(recv[12], NONE); assert.equal(area[12], 25);
});

test('cells at or under the sea are outlets', () => {
  const w = 6, h = new Float32Array(w * w);
  for (let y = 0; y < w; y++) for (let x = 0; x < w; x++) h[y * w + x] = 5 - x;
  const {recv, area} = drainageReference(h, w, 3);
  assert.equal(recv[2], NONE); assert.equal(recv[3], NONE);   // x = 2 is at the sea, x = 3 under it
  assert.equal(area[2], 3); assert.equal(area[3], 1);         // the sea cell holds the land that drains to it
});
