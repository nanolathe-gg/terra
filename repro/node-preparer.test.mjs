import test from 'node:test';
import assert from 'node:assert/strict';
import {prepareNode, createNodePreparer} from '../sculpt-gpu-fields.js';
import {shapeContext} from '../sculpt-scene.js';

// The kept preparation of a node (createNodePreparer) is what prepareNode makes now: nodes and the world's shape defaults are edited in place.
const text = p => JSON.stringify(p, (k, v) => ArrayBuffer.isView(v) ? [...v] : v);
const hill = (x, seed) => ({kind: 'landform', seed, points: [{x, y: 300}, {x: x + 120, y: 340}], params: {radius: 90, amount: 60, rough: .3, softness: .5, lean: 1, curve: {form: 'lfHill'}}});

test('a kept node preparation follows edits in place to the node, the defaults and the lattice', () => {
  const config = {seaLevel: 75, baseHeight: 99, defaults: {spurCount: '0'}}, context = () => shapeContext({config, settings: new Map(), seed: 5, minH: -15, maxH: 375});
  const geom = {grid: 512, spacing: 8, refSpacing: 2}, prepare = createNodePreparer(), a = hill(400, 11), b = hill(900, 12);
  const first = prepare(a, geom, context()), other = prepare(b, geom, context());
  assert.equal(text(first), text(prepareNode(a, geom, context())));
  assert.equal(prepare(a, geom, context()), first, 'an unchanged node is not prepared again');
  // A stroke grows its node in place; the other node keeps its preparation.
  a.points.push({x: 640, y: 380});
  const grown = prepare(a, geom, context());
  assert.notEqual(grown, first);
  assert.equal(text(grown), text(prepareNode(a, geom, context())));
  assert.equal(prepare(b, geom, context()), other);
  // A setting edited in place, and a move (the node's frame).
  a.params.radius = 140; assert.equal(text(prepare(a, geom, context())), text(prepareNode(a, geom, context())));
  a.frame = [1, 0, 0, 1, 30, -12]; assert.equal(text(prepare(a, geom, context())), text(prepareNode(a, geom, context())));
  // The world's shape defaults change under every node that leaves them unset.
  const before = prepare(b, geom, context());
  config.defaults.wander = '.8';
  const after = prepare(b, geom, context());
  assert.notEqual(after, before);
  assert.equal(text(after), text(prepareNode(b, geom, context())));
  config.defaults.wander = '.2';
  assert.equal(text(prepare(b, geom, context())), text(prepareNode(b, geom, context())));
  assert.notEqual(text(prepare(b, geom, context())), text(after), 'a default alone changes the preparation');
  // Another lattice has its own.
  const fine = {grid: 1024, spacing: 4, refSpacing: 2};
  assert.equal(text(prepare(b, fine, context())), text(prepareNode(b, fine, context())));
  assert.notEqual(text(prepare(b, fine, context())), text(prepare(b, geom, context())));
  // The sea is the context's.
  config.seaLevel = 40;
  assert.equal(text(prepare(a, geom, context())), text(prepareNode(a, geom, context())));
});

// Paged fields compare by text only the nodes an edit's rectangle reaches (the host calls changed() with a rectangle that holds an edited
// node's reach before and after); a whole change compares every node.
test('paged fields prepare again the nodes an edit reaches and keep the others without comparing them', async t => {
  t.mock.timers.enable({apis: ['setTimeout']});   // the coarse fill waits for a device that never comes: its timers must not hold the run open
  const {createPagedFields} = await import('../sculpt-gpu-fields.js');
  const config = {seaLevel: 75, baseHeight: 99, defaults: {spurCount: '0'}}, context = () => shapeContext({config, settings: new Map(), seed: 5, minH: -15, maxH: 375});
  const a = hill(960, 11), b = hill(3000, 12), nodes = [a, b];   // a lies across the first page border
  const fields = createPagedFields({worldSize: 4097, worldGrid: 2049, baseHeight: 99, maskKeys: [], nodes: () => nodes, device: () => null, context, budget: () => ({total: 2048 * 1048576, minimum: 300 * 1048576})});
  fields.changed();
  const before = fields.pageInfo().ring, stringify = JSON.stringify, seen = new Set();
  JSON.stringify = (v, ...rest) => { if (v === a || v === b) seen.add(v); return stringify(v, ...rest); };
  try {
    a.params = {...a.params, fingers: .6, fingerSize: 1};   // a coast pass: the ring the pages need grows
    fields.changed({x0: 380, y0: 50, x1: 700, y1: 300});
    assert.ok(seen.has(a), 'the edited node is compared');
    assert.ok(!seen.has(b), 'a node the rectangle misses keeps its preparation');
    assert.ok(fields.pageInfo().ring > before, 'the edit reaches the ring');
    seen.clear(); fields.changed();
    assert.ok(seen.has(a) && seen.has(b), 'a whole change compares every node');
  } finally { JSON.stringify = stringify; }
});
