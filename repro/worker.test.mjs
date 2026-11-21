import test from 'node:test';
import assert from 'node:assert/strict';
import {gzipSync} from 'node:zlib';
import {createHash} from 'node:crypto';
import {handle, mapId, MAX_COMPRESSED, MAX_UNCOMPRESSED} from '../deploy/worker/worker.js';

// An in-memory stand-in for the parts of an R2 bucket the Worker uses.
function fakeBucket() {
  const store = new Map();
  const bucket = {store, puts: 0,
    async head(k) { return store.has(k) ? {key: k} : null; },
    async get(k) { return store.has(k) ? {body: new Blob([store.get(k).bytes]).stream(), ...store.get(k)} : null; },
    async put(k, bytes, opts) { bucket.puts++; store.set(k, {bytes: new Uint8Array(bytes), ...opts}); },
    async delete(k) { store.delete(k); }};
  return bucket;
}
const save = (extra = {}) => ({format: 'nanolathe-terrain-sculpt', version: 6, nodes: [{kind: 'hill', x: 1}], size: 64, ...extra});
const gz = o => gzipSync(typeof o === 'string' ? o : JSON.stringify(o), {level: 9});
const SITE = 'https://terra.nanolathe.gg';
const post = (env, body, headers = {}) => handle(new Request('https://w.test/maps', {method: 'POST', body, headers: {Origin: SITE, ...headers}}), env);
const env = (over = {}) => ({MAPS: fakeBucket(), ...over});

test('a good save round-trips with browser-readable headers', async () => {
  const pictures = {map: {image: 'data:image/webp;base64,UklGRg=='}};
  const e = env(), body = gz(save({pictures}));
  const r = await post(e, body);
  assert.equal(r.status, 200);
  const {id} = await r.json();
  assert.match(id, /^[a-z2-7]{16}$/);
  const g = await handle(new Request(`https://w.test/maps/${id}`), e);
  assert.equal(g.status, 200);
  assert.equal(g.headers.get('Content-Encoding'), 'gzip');
  assert.equal(g.headers.get('Content-Type'), 'application/json');
  assert.match(g.headers.get('Cache-Control'), /immutable/);
  assert.deepEqual(Buffer.from(await g.arrayBuffer()), body);
  // the /api prefix of the local server works too
  assert.equal((await handle(new Request(`https://w.test/api/maps/${id}`), e)).status, 200);
});

test('the id is the first 16 base32 characters of the SHA-256 of the gzip bytes', async () => {
  const body = gz(save());
  const d = createHash('sha256').update(body).digest();
  let bits = '';
  for (const b of d) bits += b.toString(2).padStart(8, '0');
  const A = 'abcdefghijklmnopqrstuvwxyz234567';
  let want = '';
  for (let i = 0; i < 16; i++) want += A[parseInt(bits.slice(i * 5, i * 5 + 5), 2)];
  assert.equal(await mapId(new Uint8Array(body)), want);
});

test('the same save twice gives one id and one write', async () => {
  const e = env(), body = gz(save());
  const a = await (await post(e, body)).json(), b = await (await post(e, body)).json();
  assert.equal(a.id, b.id);
  assert.equal(e.MAPS.puts, 1);
  const c = await (await post(e, gz(save({seed: 2})))).json();
  assert.notEqual(c.id, a.id);
  assert.equal(e.MAPS.puts, 2);
});

test('bad bodies are refused with clear errors and nothing is stored', async () => {
  const e = env();
  const cases = [
    [Buffer.from(JSON.stringify(save())), 400, /not gzip/],
    [gz('{not json'), 400, /not valid JSON/],
    [gz({format: 'other', version: 6, nodes: []}), 400, /not a Terraform save/],
    [gz({format: 'nanolathe-terrain-sculpt', nodes: []}), 400, /version/],
    [gz({format: 'nanolathe-terrain-sculpt', version: 6, nodes: 'x'}), 400, /nodes/],
    [gz([1, 2]), 400, /not a Terraform save/],
    [Buffer.concat([gz(save()).subarray(0, 20)]), 400, /damaged/],
    [gz(JSON.stringify(save({mapData: {pad: 'a'.repeat(MAX_UNCOMPRESSED + 1)}}))), 413, /uncompressed/],
    [gz(save({junk: 'stored for good'})), 400, /fields a save does not have \(junk\)/],
    [gz(save({biome: {x: 1}})), 400, /wrong kind of value/],
    [gz(save({pictures: {map: {image: 'https://example.test/map.webp'}}})), 400, /WebP map thumbnail/],
    [gz(save({pictures: {map: {image: 'data:image/webp;base64,' + 'A'.repeat(32 * 1024)}}})), 400, /WebP map thumbnail/],
    [gz(save({pictures: {map: {image: 'data:image/webp;base64,UklGRg=='}, tools: {}}})), 400, /WebP map thumbnail/],
    [gz(save({seaLevel: 'deep'})), 400, /wrong kind of value/],
    [Buffer.alloc(MAX_COMPRESSED + 1, 7), 413, /too large/],
  ];
  for (const [body, status, re] of cases) {
    const r = await post(e, body);
    assert.equal(r.status, status, String(re));
    assert.match((await r.json()).error, re);
  }
  assert.equal(e.MAPS.store.size, 0);
});

test('unknown and malformed ids are 404; other paths and methods are refused', async () => {
  const e = env();
  assert.equal((await handle(new Request('https://w.test/maps/aaaaaaaaaaaaaaaa'), e)).status, 404);
  assert.equal((await handle(new Request('https://w.test/maps/..%2Fx'), e)).status, 404);
  assert.equal((await handle(new Request('https://w.test/other'), e)).status, 404);
  assert.equal((await handle(new Request('https://w.test/maps', {method: 'PUT', body: 'x'}), e)).status, 405);
});

test('CORS: the site and localhost are allowed, others get no header, preflight answers', async () => {
  const e = env();
  const get = origin => handle(new Request('https://w.test/maps/aaaaaaaaaaaaaaaa', {headers: origin ? {Origin: origin} : {}}), e);
  assert.equal((await get('https://terra.nanolathe.gg')).headers.get('Access-Control-Allow-Origin'), 'https://terra.nanolathe.gg');
  assert.equal((await get('http://localhost:8851')).headers.get('Access-Control-Allow-Origin'), 'http://localhost:8851');
  assert.equal((await get('http://127.0.0.1:3000')).headers.get('Access-Control-Allow-Origin'), 'http://127.0.0.1:3000');
  assert.equal((await get('https://evil.example')).headers.get('Access-Control-Allow-Origin'), null);
  assert.equal((await get('https://localhost.evil.example')).headers.get('Access-Control-Allow-Origin'), null);
  assert.equal((await get(null)).headers.get('Access-Control-Allow-Origin'), null);
  const pre = await handle(new Request('https://w.test/maps', {method: 'OPTIONS', headers: {Origin: 'https://terra.nanolathe.gg'}}), e);
  assert.equal(pre.status, 204);
  assert.match(pre.headers.get('Access-Control-Allow-Methods'), /POST/);
  // configurable
  const e2 = env({ALLOWED_ORIGINS: 'https://a.test, https://b.test', ALLOW_LOCALHOST: '0'});
  const g2 = origin => handle(new Request('https://w.test/maps/aaaaaaaaaaaaaaaa', {headers: {Origin: origin}}), e2);
  assert.equal((await g2('https://b.test')).headers.get('Access-Control-Allow-Origin'), 'https://b.test');
  assert.equal((await g2('https://terra.nanolathe.gg')).headers.get('Access-Control-Allow-Origin'), null);
  assert.equal((await g2('http://localhost:1')).headers.get('Access-Control-Allow-Origin'), null);
});

test('delete needs the secret', async () => {
  const e = env({ADMIN_TOKEN: 's3cret'});
  const {id} = await (await post(e, gz(save()))).json();
  const del = auth => handle(new Request(`https://w.test/maps/${id}`, {method: 'DELETE', headers: auth ? {Authorization: auth} : {}}), e);
  assert.equal((await del(null)).status, 401);
  assert.equal((await del('Bearer wrong')).status, 401);
  assert.equal((await handle(new Request(`https://w.test/maps/${id}`), e)).status, 200);
  assert.equal((await del('Bearer s3cret')).status, 200);
  assert.equal((await handle(new Request(`https://w.test/maps/${id}`), e)).status, 404);
  // with no secret configured, delete is off even for an empty token
  const off = env();
  const r = await handle(new Request(`https://w.test/maps/${id}`, {method: 'DELETE', headers: {Authorization: 'Bearer '}}), off);
  assert.equal(r.status, 403);
});

test('CPU cost: hashing and checking a 100 KB save', async () => {
  const big = save({nodes: Array.from({length: 1500}, (_, i) => ({kind: 'hill', x: i, y: i * 2, r: 30, note: 'abcdefghij'.repeat(3)}))});
  const body = gz(big);
  const e = env();
  const t = performance.now();
  for (let i = 0; i < 20; i++) { e.MAPS = fakeBucket(); assert.equal((await post(e, body)).status, 200); }
  const ms = (performance.now() - t) / 20;
  console.log(`# ${JSON.stringify(big).length} bytes of JSON, ${body.length} gzipped: ${ms.toFixed(2)} ms per POST in Node`);
  assert.ok(ms < 10);
});

test('a save as the editor writes it is accepted: every field sketch() writes, of its kind', async () => {
  const e = env(), full = save({map: {unitsX: 4, unitsY: 4}, mapData: {name: 'x', features: []}, biome: 'green', world: 'green', worldSettings: {knobs: {}}, size: 1216, grid: 608,
    baseHeight: 104, seaLevel: 95, seed: 2701, varySeed: true, refinementSeed: 2701, column: {sections: []}, rock: {}, rocks: [], materials: [], tools: [], toolSettings: {},
    softness: 50, relief: 100, materialWeathering: 0, depositSpread: 65, transitionDetail: 65, tool: 'plateau', diameter: 800, amount: 70, roughness: 0, weather: false,
    clay: false, light: 'original', encoding: 'stroke-graph'});
  assert.equal((await post(e, gz(full))).status, 200);
});
test('a small gzip bomb is refused at forty times its size, before it is parsed', async () => {
  const e = env(), body = gz(JSON.stringify(save({mapData: {pad: 'a'.repeat(4 * 1024 * 1024)}})));
  assert.ok(body.length < 16 * 1024, `${body.length} bytes of gzip`);
  const r = await post(e, body);
  assert.equal(r.status, 413);
  assert.match((await r.json()).error, /40 times its gzip size/);
  assert.equal(e.MAPS.store.size, 0);
});
test('a save is accepted from the editor\'s site or localhost only', async () => {
  const e = env(), body = gz(save());
  for (const origin of [null, 'https://evil.example']) {
    const r = await handle(new Request('https://w.test/maps', {method: 'POST', body, headers: origin ? {Origin: origin} : {}}), e);
    assert.equal(r.status, 403, String(origin));
  }
  assert.equal((await post(e, body, {Origin: 'http://localhost:8801'})).status, 200);
  assert.equal(e.MAPS.store.size, 1);
});
