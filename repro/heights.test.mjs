// The height image (a node of kind 'heights': sculpt-gpu-fields.js heightsFields, engine-shape.wgsl `heights`): what a save may hold, that the
// page's own save, load and undo copies keep it byte for byte. GPU integration checks are in heights.gpu.test.mjs.
// Every image here is synthetic (repro/heights-fixture.mjs).
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {heightsFields, heightsBounds, HEIGHTS_LIMIT, HEIGHTS_REACH} from '../sculpt-gpu-fields.js';
import {sceneNodes, heightsNode} from '../sculpt-scene.js';
import {clonePaths, validatePaths} from '../sculpt-paths.js';
import {mapGeometry} from '../sculpt-map.js';
import {encodeSamples, decodeSamples, bumps, fixtureScene, sceneText} from './heights-fixture.mjs';

const root = new URL('..', import.meta.url).pathname;
const config = {biomeId: 'green', baseHeight: 84, seaLevel: 75, size: 2336, worldSize: 2336, map: {width: 2080, height: 2176}, defaults: {undulation: 10, undulationScale: 200, undulationCover: .45}};
const small = (more = {}) => ({image: encodeSamples(bumps(6, 5, 40, [[2, 2, 100, 1.5]])), width: 6, height: 5, ...more});

test('a height image is checked: its size, its samples and its numbers', () => {
  assert.deepEqual(heightsFields(small()), {image: small().image, bits: 8, width: 6, height: 5, cell: 16, x: 0, y: 0, scale: 1, offset: 0, mode: 'replace'});
  assert.equal(heightsFields(small({image: encodeSamples(bumps(6, 5, 4000, []), 16), bits: 16, mode: 'cut', cell: 40, x: -3.5})).bits, 16);
  // The limit is a 40 x 40 map's height bytes, and an image of that size is accepted.
  assert.deepEqual(HEIGHTS_LIMIT, {width: mapGeometry(40, 40).widthCells, height: mapGeometry(40, 40).heightCells});
  const full = {image: encodeSamples(new Uint8Array(1282 * 1288)), width: 1282, height: 1288};
  assert.equal(heightsFields(full).image.length, 2201624);
  assert.throws(() => heightsFields({...full, width: 1283}, 'Height image (stroke 3)'), /^Error: Height image \(stroke 3\) has 1283 x 1288 samples, over the limit of 1282 x 1288\.$/);
  assert.throws(() => heightsFields({...full, height: 1289}), /over the limit of 1282 x 1288/);
  // Samples that are not the size the node gives, or not base64.
  assert.throws(() => heightsFields(small({width: 7})), /needs 7 x 5 samples of 8 bits as base64: 35 bytes, 48 characters/);
  assert.throws(() => heightsFields(small({bits: 16})), /needs 6 x 5 samples of 16 bits as base64: 60 bytes, 80 characters/);
  assert.throws(() => heightsFields(small({image: small().image.replace(/^./, '*')})), /as base64/);
  assert.throws(() => heightsFields(small({image: small().image.slice(0, -1) + '='})), /as base64/);   // padding the size does not have
  assert.throws(() => heightsFields(small({image: undefined})), /as base64/);
  assert.throws(() => heightsFields(small({bits: 12})), /8 or 16 bits/);
  assert.throws(() => heightsFields(small({width: 6.5})), /whole number of samples/);
  assert.throws(() => heightsFields(small({height: 0})), /whole number of samples/);
  for (const key of ['cell', 'x', 'y', 'scale', 'offset']) assert.throws(() => heightsFields(small({[key]: NaN})), /finite numbers/);
  assert.throws(() => heightsFields(small({cell: 0})), /cell \(1 to 1024 px\)/);
  assert.throws(() => heightsFields(small({mode: 'add'})), /has the mode "add"; the modes are raise, cut, flatten, replace/);
  // It covers its samples and the margin round them: sample (i, j) at (x + i cell, y + j cell).
  assert.deepEqual(heightsBounds(heightsFields(small({x: 64, y: 32}))), {x0: 64 - 16 * HEIGHTS_REACH, y0: 32 - 16 * HEIGHTS_REACH, x1: 64 + 16 * (5 + HEIGHTS_REACH), y1: 32 + 16 * (4 + HEIGHTS_REACH)});
});

test('a scene holds a height image as a stroke with no path', () => {
  const nodes = sceneNodes(config, [['hill', [[100, 100], [300, 120]], {}], ['heights', [], small({mode: 'raise', x: 48})]], {ground: false});
  assert.deepEqual(nodes.map(n => n.kind), ['landform', 'heights']);
  assert.deepEqual(nodes[1], {kind: 'heights', hidden: false, ...heightsFields(small({mode: 'raise', x: 48}))});
  assert.equal(nodes[1].params, undefined);   // params is a brush card, which the panel edits; the image's values are the node's own
  assert.throws(() => sceneNodes(config, [['heights', [], small({width: 9})]], {ground: false}), /scene stroke 0: the height image needs 9 x 5 samples/);
});

test('the scene of the regional check is the fixture\'s formulas', () => {
  assert.equal(readFileSync(`${root}repro/shape-scenes/heights-bumps.json`, 'utf8'), sceneText(fixtureScene()));
});

// ---- the page ----
// The page's own functions for a save, a load and an undo step (sculpt.js is the page's script and does not load under Node, so they are taken
// from its text and run here over a node list).
function pageNodeFunctions() {
  const page = readFileSync(`${root}sculpt.js`, 'utf8');
  const take = name => { const at = page.indexOf(`\nfunction ${name}(`), line = page.indexOf('\n', at + 1); assert.ok(at >= 0, name); return page.slice(at, page[line - 1] === '}' ? line : page.indexOf('\n}', at) + 2); };
  const names = page.match(/const NODE_NAMES=\{[^}]*\};/)[0];
  return new Function('clonePaths', 'validatePaths', 'heightsNode', `let nodes=[]; ${names} ${['cloneNodes', 'serializeNodes', 'deserializeNodes', 'checkedHeights'].map(take).join('\n')}
    return {cloneNodes, serializeNodes, deserializeNodes, set: list => { nodes = list; }, get: () => nodes};`)(clonePaths, validatePaths, heightsNode);
}

test('a height image survives the page\'s save, load and undo byte for byte', () => {
  const page = pageNodeFunctions();
  const eight = bumps(64, 64, 70, [[20, 18, 90, 7], [44, 40, 140, 10]]), sixteen = bumps(9, 7, 21000, [[4, 3, 30000, 2]], 65535);
  page.set(sceneNodes(config, [['hill', [[100, 100], [300, 120]], {}], ['heights', [], {image: encodeSamples(eight), width: 64, height: 64, x: 320, y: 208}],
    ['heights', [], {image: encodeSamples(sixteen, 16), bits: 16, width: 9, height: 7, cell: 40, x: 12.5, y: -8, scale: 1 / 256, offset: 3, mode: 'flatten'}]]));
  const drawn = page.get(), saved = JSON.stringify(page.serializeNodes());
  // Load: the nodes of the saved text, saved again, are the same text for each image, and the same samples.
  page.set(page.deserializeNodes(JSON.parse(saved)));
  const loaded = page.get(), again = JSON.stringify(page.serializeNodes());
  for (const i of [2, 3]) assert.equal(JSON.stringify(JSON.parse(again)[i]), JSON.stringify(JSON.parse(saved)[i]));
  page.set(page.deserializeNodes(JSON.parse(again)));
  assert.equal(JSON.stringify(page.serializeNodes()), again);   // and from then on the whole list is
  assert.deepEqual([...decodeSamples(loaded[2].image)], eight);
  assert.deepEqual([...decodeSamples(loaded[3].image, 16)], sixteen);
  assert.deepEqual(loaded[3], {...drawn[3]});
  // Undo and redo: a history entry is cloneNodes() of the list, and a step back or forward is cloneNodes() of the entry.
  page.set(loaded);
  const entry = page.cloneNodes();
  page.set(loaded.filter(n => n.kind !== 'heights'));                // an edit: the images deleted
  const later = page.cloneNodes();
  page.set(page.cloneNodes(entry));                                  // undo
  assert.equal(JSON.stringify(page.serializeNodes()), again);
  assert.equal(page.get()[2].image, loaded[2].image);
  page.set(page.cloneNodes(later)); assert.deepEqual(page.get().map(n => n.kind), ['ground', 'landform']);   // redo
  page.set(page.cloneNodes(entry)); assert.equal(JSON.stringify(page.serializeNodes()), again);              // and undo again
});

test('a save with an image the engine cannot draw is refused when it loads', () => {
  const page = pageNodeFunctions(), good = {kind: 'heights', ...small()};
  assert.equal(page.deserializeNodes([{kind: 'ground', amplitude: 8}, good]).length, 2);
  assert.throws(() => page.deserializeNodes([{kind: 'ground', amplitude: 8}, {...good, width: 1283, height: 1288, image: ''}]), /^Error: Height image \(stroke 2\) has 1283 x 1288 samples, over the limit of 1282 x 1288\.$/);
  assert.throws(() => page.deserializeNodes([{...good, image: good.image.slice(4)}]), /^Error: Height image \(stroke 1\) needs 6 x 5 samples of 8 bits as base64: 30 bytes, 40 characters\.$/);
  // loadSketch makes the new node list before it changes anything, and a load into another world checks the images before it leaves this one.
  const text = readFileSync(`${root}sculpt.js`, 'utf8'), load = text.slice(text.indexOf('\nfunction loadSketch('), text.indexOf('\n}', text.indexOf('\nfunction loadSketch(')));
  assert.match(load.split('\n')[3], /^  const next=deserializeNodes\(/);
  assert.match(text, /copyColumn\(s\.column\);copyRockSettings\(s\.rock\);copyRocks\(s\.rocks\);s\.nodes\.forEach\(checkedHeights\);\n    \} catch \(err\) \{ error\(err\.message\); return false; \}/);
});
