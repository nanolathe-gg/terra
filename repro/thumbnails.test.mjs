import test from 'node:test';
import assert from 'node:assert/strict';
import {copyPictures, savedPictures, pictureKey, mapPictureSize, toolFrame, TOOL_PATH, MAP_PICTURE, TOOL_PICTURE} from '../sculpt-thumbnails.js';
import {mapMeta} from '../sculpt-maps.js';

const webp = 'data:image/webp;base64,UklGRg4HAABXRUJQ';

test('a save keeps only small WebP data pictures, and a tool picture only with a key', () => {
  assert.equal(copyPictures(undefined), undefined);
  assert.equal(copyPictures('x'), undefined);
  assert.deepEqual(copyPictures({map: {image: webp}}), {map: {image: webp}});
  // Another address, another type or an oversized picture is dropped (an opened file must not make the editor fetch anything).
  for (const image of ['https://example.com/a.webp', 'data:image/png;base64,AAAA', 'data:image/svg+xml;base64,AAAA', webp + 'A'.repeat(40000), 'data:image/webp;base64,<script>'])
    assert.equal(copyPictures({map: {image}}), undefined, image.slice(0, 40));
  assert.deepEqual(copyPictures({tools: {hill: {key: 'abc123', image: webp}, plateau: {image: webp}, __proto__: {key: 'a', image: webp}, 'bad id!': {key: 'a', image: webp}}}), {tools: {hill: {key: 'abc123', image: webp}}});
  assert.equal(copyPictures({tools: {hill: {key: 'ABC', image: webp}}}), undefined);
});

test('a save carries the pictures of the tools the toolbar has', () => {
  const pictures = {map: {image: webp}, tools: {hill: {key: 'a', image: webp}, gone: {key: 'b', image: webp}}};
  assert.deepEqual(savedPictures(pictures, new Set(['hill'])), {map: {image: webp}, tools: {hill: {key: 'a', image: webp}}});
  assert.equal(savedPictures({map: null, tools: {}}, new Set()), undefined);
});

test('a key follows its inputs', () => {
  assert.equal(pictureKey({a: 1}, [2]), pictureKey({a: 1}, [2]));
  assert.notEqual(pictureKey({a: 1}, [2]), pictureKey({a: 1}, [3]));
  assert.match(pictureKey('x'), /^[a-z0-9]{1,32}$/);
});

test('the map picture fits its long side and bakes at a power-of-two level', () => {
  for (const [w, h] of [[2048, 2048], [8192, 8192], [2048, 1024], [512, 512], [20480, 512]]) {
    const s = mapPictureSize(w, h);
    assert.equal(Math.max(s.width, s.height), MAP_PICTURE);
    assert.equal(Math.log2(s.level) % 1, 0);
    assert.ok(Math.max(w, h) / s.level >= MAP_PICTURE, `${w}x${h} bakes at least the picture's size`);
  }
});

test('a tool picture frames the whole stroke at a zoom step, inside the fixture', () => {
  const xs = TOOL_PATH.map(p => p[0]), ys = TOOL_PATH.map(p => p[1]), box = {ax: Math.min(...xs), ay: Math.min(...ys), bx: Math.max(...xs), by: Math.max(...ys)};
  const small = toolFrame({...box, r: 150}), wide = toolFrame({...box, r: 500});
  for (const f of [small, wide]) {
    assert.equal(f.width / f.scale, 2 * TOOL_PICTURE.width); assert.equal(f.height / f.scale, 2 * TOOL_PICTURE.height);
    assert.ok(f.x >= 0 && f.y >= 0 && f.x + f.width <= 2048 && f.y + f.height <= 2048);
  }
  assert.ok(small.scale < wide.scale);
  assert.ok(wide.x <= box.ax - 500 && wide.x + wide.width >= box.bx + 500, 'the wide stroke is inside its frame');
});

test("Maps' list summary carries the map's picture, never another kind", () => {
  const s = {nodes: [], pictures: {map: {image: webp}}};
  assert.equal(mapMeta('a', s, 1).picture, webp);
  assert.equal(mapMeta('a', {nodes: [], pictures: {map: {image: 'https://example.com/x.webp'}}}, 1).picture, undefined);
});
