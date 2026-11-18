// The bookkeeping of the paged fields' spill (sculpt-gpu-fields.js createPageSpill): CPU copies of evicted pages, used only under their stamp.
import test from 'node:test';
import assert from 'node:assert/strict';
import {createPageSpill} from '../sculpt-gpu-fields.js';

const bytes = n => new ArrayBuffer(n);

test('a copy is returned once, and only under the stamp it was made with', () => {
  const spill = createPageSpill(() => 100), e = spill.begin('s1', '4 0', 10, {seq: 0}), data = bytes(10);
  assert(e);
  assert(spill.fill('s1', e, data));
  assert.equal(spill.take('s1', '4 1'), null, 'a later stamp');
  assert.equal(spill.stats().entries, 0, 'a stale copy is dropped where it is found');
  const f = spill.begin('s1', '4 1', 10);
  spill.fill('s1', f, data);
  const got = spill.take('s1', '4 1');
  assert.equal(got.data, data);
  assert.equal(spill.take('s1', '4 1'), null, 'taken once: the page is resident again');
  assert.deepEqual({hits: spill.stats().hits, stale: spill.stats().stale, misses: spill.stats().misses, bytes: spill.stats().bytes}, {hits: 1, stale: 1, misses: 1, bytes: 0});
});

test('a copy whose read-back has not finished is never returned, and its late bytes are let go', () => {
  const spill = createPageSpill(() => 100), e = spill.begin('w3', '0 key', 10);
  assert.equal(spill.take('w3', '0 key'), null);
  assert.equal(spill.stats().unfinished, 1);
  assert.equal(spill.fill('w3', e, bytes(10)), false);
  assert.equal(spill.stats().entries, 0);
});

test('a dropped, cleared, replaced or failed copy is not filled', () => {
  const spill = createPageSpill(() => 100);
  const a = spill.begin('s1', 'x', 10); spill.drop('s1'); assert.equal(spill.fill('s1', a, bytes(10)), false);
  const b = spill.begin('s2', 'x', 10), w = spill.begin('w2', 'x', 10); spill.clear(k => k[0] === 's');
  assert.equal(spill.fill('s2', b, bytes(10)), false); assert(spill.fill('w2', w, bytes(10)));
  const c = spill.begin('w2', 'y', 10); assert.equal(spill.stats().entries, 1, 'a new copy of a key replaces the old one');
  assert.equal(spill.fill('w2', w, bytes(10)), false);
  assert.equal(spill.fill('w2', c, null), false, 'a failed read-back removes its reservation');
  assert.deepEqual([spill.stats().entries, spill.stats().bytes], [0, 0]);
});

test('the cap holds the most recently evicted copies, reserved bytes included', () => {
  let cap = 30;
  const spill = createPageSpill(() => cap), es = ['a', 'b', 'c'].map(k => [k, spill.begin(k, '0', 10)]);
  es.forEach(([k, e]) => spill.fill(k, e, bytes(10)));
  spill.begin('d', '0', 10);   // reserved, still reading back: counted
  assert.equal(spill.take('a', '0'), null, 'the oldest copy went to make room');
  assert.equal(spill.stats().bytes, 30);
  assert.equal(spill.begin('big', '0', 31), null, 'a copy larger than the cap is not kept');
  cap = 10; spill.trim();
  assert.deepEqual([spill.stats().entries, spill.stats().bytes], [1, 10]);
  assert.equal(spill.take('d', '0'), null, 'unfinished');
  assert.equal(spill.take('c', '0'), null, 'trimmed');
});

test('the page heap counts the copies that hold their bytes', () => {
  const spill = createPageSpill(() => 100), a = spill.begin('a', '0', 10), data = bytes(10);
  spill.begin('b', '0', 10);   // still reading back: reserved, not yet held
  spill.fill('a', a, data);
  assert.deepEqual(spill.buffers(), [data]);
  spill.take('a', '0');
  assert.deepEqual(spill.buffers(), []);
});
