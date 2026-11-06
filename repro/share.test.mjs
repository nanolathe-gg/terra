// Save links in the editor: deterministic gzip, the link and address handling, the service errors, the previous-map slot.
import test from 'node:test';
import assert from 'node:assert/strict';
import {gunzipSync, gzipSync} from 'node:zlib';
import {gzipText, crc32, shareUrl, mapIdFromSearch, withoutMap, mapsService, postMap, getMap, keepPrevious, takePrevious, dropPrevious, PREVIOUS_KEY} from '../sculpt-share.js';
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
  assert.equal(shareUrl('http://127.0.0.1:8851/sculpt.html?biome=red&mapX=4#x', 'abcdefghijklmnop'), 'http://127.0.0.1:8851/sculpt.html?map=abcdefghijklmnop');
  assert.equal(shareUrl('https://terra.nanolathe.gg/b/0123456789/sculpt.html?x=1', 'abcdefghijklmnop'), 'https://terra.nanolathe.gg/?map=abcdefghijklmnop');
});

test('the address: reading the map id and dropping it afterwards', () => {
  assert.equal(mapIdFromSearch('?biome=red&map=abcdefghijklmnop'), 'abcdefghijklmnop');
  assert.equal(mapIdFromSearch('?biome=red'), null);
  assert.equal(withoutMap('http://h/sculpt.html?map=abcdefghijklmnop&biome=red'), 'http://h/sculpt.html?biome=red');
  assert.equal(withoutMap('http://h/sculpt.html?map=abcdefghijklmnop'), 'http://h/sculpt.html');
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

test('the previous-map slot holds one map and survives a failing store', () => {
  const store = new Map(), storage = {getItem: k => store.has(k) ? store.get(k) : null, setItem: (k, v) => store.set(k, v), removeItem: k => store.delete(k)};
  assert.equal(takePrevious(storage), null);
  assert.ok(keepPrevious(storage, 'one')); assert.ok(keepPrevious(storage, 'two'));
  assert.equal(takePrevious(storage), 'two'); assert.equal([...store.keys()].join(), PREVIOUS_KEY);
  dropPrevious(storage); assert.equal(takePrevious(storage), null);
  const full = {getItem() { throw new Error('x'); }, setItem() { throw new Error('full'); }, removeItem() { throw new Error('x'); }};
  assert.equal(keepPrevious(full, 'x'), false); assert.equal(takePrevious(full), null); dropPrevious(full);
});
