// Save links in the editor: deterministic gzip, the link and address handling, the service errors.
import test from 'node:test';
import assert from 'node:assert/strict';
import {gunzipSync, gzipSync} from 'node:zlib';
import {shareText, gzipText, crc32, shareUrl, mapIdFromSearch, withoutMap, mapsService, postMap, getMap} from '../sculpt-share.js';
import {mapId} from '../deploy/worker/worker.js';

const text = JSON.stringify({format: 'nanolathe-terrain-sculpt', version: 6, nodes: [{kind: 'hill', x: 1.5}], note: 'é'.repeat(500)});

test('gzip is byte-identical on every run and inflates to the same text', async () => {
  const a = await gzipText(text), b = await gzipText(text);
  assert.deepEqual(a, b);
  assert.deepEqual([...a.slice(0, 10)], [0x1f, 0x8b, 8, 0, 0, 0, 0, 0, 0, 255]);   // fixed header: no time, no name
  assert.equal(gunzipSync(a).toString('utf8'), text);                                  // node checks the CRC and length trailer
  assert.notDeepEqual(await gzipText(text + ' '), a);
  assert.equal(await mapId(a), await mapId(b));                                        // so the same map is the same link
});

test('crc32 matches the reference value', () => {
  assert.equal(crc32(new TextEncoder().encode('123456789')), 0xcbf43926);
  assert.equal(crc32(new Uint8Array()), 0);
  assert.equal(gzipSync('').length > 0, true);
});

test('the share link is the page address with ?map=, and a static build links to the site root', () => {
  assert.equal(shareUrl('http://127.0.0.1:8851/?biome=red&mapX=4#x', 'abcdefghijklmnop'), 'http://127.0.0.1:8851/?map=abcdefghijklmnop');
  assert.equal(shareUrl('https://terra.nanolathe.gg/b/0123456789/?x=1', 'abcdefghijklmnop'), 'https://terra.nanolathe.gg/?map=abcdefghijklmnop');
  assert.equal(shareUrl('https://terra.nanolathe.gg/index.html?x=1', 'abcdefghijklmnop'), 'https://terra.nanolathe.gg/?map=abcdefghijklmnop');
});

test('the address: reading the map id and dropping it afterwards', () => {
  assert.equal(mapIdFromSearch('?biome=red&map=abcdefghijklmnop'), 'abcdefghijklmnop');
  assert.equal(mapIdFromSearch('?biome=red'), null);
  assert.equal(withoutMap('http://h/?map=abcdefghijklmnop&biome=red'), 'http://h/?biome=red');
  assert.equal(withoutMap('http://h/?map=abcdefghijklmnop'), 'http://h/');
});

test('services: a missing or unavailable maps service has a reason', () => {
  assert.equal(mapsService({maps: {available: true, url: 'api/maps/'}}).url, 'api/maps');
  assert.ok(mapsService({}).reason.length > 10);
  assert.ok(mapsService({maps: {available: false, reason: 'No.'}}).reason === 'No.');
});

const reply = (status, body) => async () => new Response(typeof body === 'string' ? body : JSON.stringify(body), {status});
test('posting: the id comes back; refusals and outages give plain messages', async () => {
  assert.equal(await postMap('w', new Uint8Array(3), reply(200, {id: 'abcdefghijklmnop'})), 'abcdefghijklmnop');
  await assert.rejects(postMap('w', new Uint8Array(3), reply(413, {})), /too large/);
  await assert.rejects(postMap('w', new Uint8Array(3), reply(400, {error: 'Not a save.'})), /refused this map: Not a save\./);
  await assert.rejects(postMap('w', new Uint8Array(3), async () => { throw new TypeError('x'); }), /could not be reached/);
  await assert.rejects(postMap('w', new Uint8Array(3), reply(200, {id: 'bad'})), /does not understand/);
});

test('opening: 404, outage, bad id and damage all leave the map alone and say so', async () => {
  assert.deepEqual(await getMap('w', 'abcdefghijklmnop', reply(200, {a: 1})), {a: 1});
  await assert.rejects(getMap('w', 'abcdefghijklmnop', reply(404, '')), /No saved map has this link.*left as it was/);
  await assert.rejects(getMap('w', 'abcdefghijklmnop', async () => { throw new TypeError('x'); }), /could not be reached.*left as it was/);
  await assert.rejects(getMap('w', 'abcdefghijklmnop', reply(500, '')), /error 500/);
  await assert.rejects(getMap('w', 'abcdefghijklmnop', reply(200, 'not json')), /damaged/);
  await assert.rejects(getMap('w', '../x', reply(200, {})), /not a valid map link/);
});

test('share, open, share again gives the same id', async () => {
  // A drawn stroke has no `hidden`; a loaded one has `hidden: false`, keys in another order, and an undefined leftover.
  const drawn = {format: 'nanolathe-terrain-sculpt', version: 6, nodes: [{kind: 'hill', seed: 3, params: {amount: 70, along: [[0, 1], [1, 0.5]]}}], size: 64, seed: 9};
  const loaded = JSON.parse(JSON.stringify({seed: 9, size: 64, nodes: [{params: {along: [[0, 1], [1, 0.5]], amount: 70}, hidden: false, seed: 3, kind: 'hill', frame: undefined}], version: 6, format: 'nanolathe-terrain-sculpt'}));
  assert.equal(await mapId(await gzipText(shareText(drawn))), await mapId(await gzipText(shareText(loaded))));
  // What the service stores is the text that was shared, so opening it and sharing it again is a fixed point.
  const text = shareText(drawn);
  assert.equal(shareText(JSON.parse(text)), text);
  assert.notEqual(shareText({...drawn, nodes: [{...drawn.nodes[0], hidden: true}]}), text);   // a hidden stroke is a real difference
});
