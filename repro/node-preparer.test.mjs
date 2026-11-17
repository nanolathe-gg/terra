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
