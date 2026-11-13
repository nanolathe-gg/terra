// The page's exporter (sculpt-export-worker.js running export/ built for WebAssembly) against the native one, without a browser: the
// worker runs in a Node context with an in-memory stand-in for the Origin Private File System's synchronous access handles
// (repro/export-node.mjs, which the headless export shares). Needs Go.
import test from 'node:test';
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {mkdtempSync, readFileSync, writeFileSync, mkdirSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createHash} from 'node:crypto';
import {deflateSync, crc32} from 'node:zlib';
import {storage, exportWorker, buildWasm} from './export-node.mjs';

const root = new URL('..', import.meta.url).pathname, work = mkdtempSync(join(tmpdir(), 'export-worker-'));
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
let go = null;
try { go = execFileSync('go', ['env', 'GOROOT'], {cwd: root, encoding: 'utf8'}).trim(); } catch {}

// An opaque RGBA PNG (filter 0 rows, zlib), enough for Go's decoder.
function png(width, height, pixel) {
  const raw = Buffer.alloc((width * 4 + 1) * height);
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) raw.set([...pixel(x, y), 255], y * (width * 4 + 1) + 1 + x * 4);
  const chunk = (type, data) => { const b = Buffer.alloc(12 + data.length); b.writeUInt32BE(data.length, 0); b.write(type, 4, 'latin1'); data.copy(b, 8); b.writeUInt32BE(crc32(b.subarray(4, 8 + data.length)), 8 + data.length); return b; };
  const header = Buffer.alloc(13); header.writeUInt32BE(width, 0); header.writeUInt32BE(height, 4); header.set([8, 6, 0, 0, 0], 8);
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', header), chunk('IDAT', deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
}

test('the worker exports the same bytes as the native exporter, and leaves only the two downloads behind', {skip: !go && 'needs Go'}, async () => {
  const wasmPath = join(work, 'map-export.wasm'), nativePath = join(work, 'map-export');
  buildWasm(wasmPath);
  execFileSync('go', ['build', '-o', nativePath, './export'], {cwd: root});
  const palette = JSON.parse(readFileSync(join(root, 'materials', 'palette.json'), 'utf8')).indexed;
  const world = JSON.parse(readFileSync(join(root, 'materials', 'green.json'), 'utf8')).world.export;
  const catalog = {worlds: {green: world}, palette, installedNames: []};
  // A 2x2 map: (2*32+2)*16 by (2*32+8)*16 px, in 512 px chunks; grit off the palette (nearest colors) and repeated ground (shared tiles).
  const width = 66 * 16, height = 72 * 16, metadata = {name: 'Worker Test', description: 'shim', world: 'green', unitsX: 2, unitsY: 2, seaLevel: 75,
    heights: Array.from({length: 66 * 72}, (_, i) => 40 + (i * 7) % 90), settings: world.climate, starts: [{x: 100, z: 200}, {x: 900, z: 700}],
    features: [{name: 'TFtestRock', x: 4, z: 6}, {name: 'TFtestTree', x: 20, z: 30}, {name: 'TFtestRock', x: 40, z: 9}]};
  // A feature pack as sculpt-features.js writes one: a rock, a tree that burns to a scar, and the scar (export/featurepack.go).
  const frame = (w, h, x, y, duration = 10, index = 90) => ({width: w, height: h, x, y, duration, pixels: Buffer.alloc(w * h, index).toString('base64'), opaque: Buffer.from(Array.from({length: w * h}, (_, i) => i % 7 ? 1 : 0)).toString('base64')});
  const common = name => [['filename', 'tftest'], ['featuredead', name], ['featurereclamate', name]];
  const features = {prefix: 'TFtest', defs: [
    {name: 'TFtestRock', keys: [['description', 'Rock'], ['footprintx', '2'], ['footprintz', '2'], ['height', '15'], ['seqname', 'tftestrock'], ['seqnameshad', 'tftestrocks'], ['metal', '50'], ['damage', '2000'], ['reclaimable', '1'], ['blocking', '1'], ...common('TFtestScar')]},
    {name: 'TFtestTree', keys: [['description', 'Tree'], ['footprintx', '1'], ['footprintz', '1'], ['height', '40'], ['seqname', 'tftesttree'], ['seqnameburn', 'tftestburn'], ['energy', '250'], ['flamable', '1'], ['featureburnt', 'TFtestScar'], ['burnweapon', 'TreeBurn'], ...common('TFtestScar')]},
    {name: 'TFtestScar', keys: [['description', 'Scar'], ['footprintx', '1'], ['footprintz', '1'], ['seqname', 'tftestscar'], ['animtrans', '1'], ...common('TFtestScar')]},
    {name: 'TFtestUnused', keys: [['footprintx', '1'], ['footprintz', '1'], ['filename', 'tftest'], ['seqname', 'tftestscar']]}],
  sequences: [{name: 'tftestrock', frames: [frame(30, 24, 15, 16)]}, {name: 'tftestrocks', frames: [frame(20, 10, 2, 4, 10, 47)]}, {name: 'tftesttree', frames: [frame(40, 60, 20, 58, 10, 42)]},
    {name: 'tftestburn', frames: Array.from({length: 6}, (_, i) => frame(40, 60 + i, 20, 58 + i, 2, 200 + i))}, {name: 'tftestscar', frames: [frame(20, 16, 10, 8, 10, 63)]}]};
  const pixel = (x, y) => { const c = palette[96 + ((x >> 6) + (y >> 6)) % 24]; return (x * 31 + y * 17) % 11 ? c : c.map(v => Math.min(255, v + 3)); };
  const chunks = [];
  for (let y = 0; y < height; y += 512) for (let x = 0; x < width; x += 512) {
    const bytes = png(Math.min(512, width - x), Math.min(512, height - y), (i, j) => pixel(x + i, y + j)), path = join(work, `c${x}_${y}.png`);
    writeFileSync(path, bytes); chunks.push({x, y, width: Math.min(512, width - x), height: Math.min(512, height - y), bytes, path});
  }
  // Native: the command line, as the tools run it.
  mkdirSync(join(work, 'features'), {recursive: true}); writeFileSync(join(work, 'features', 'pack.json'), JSON.stringify(features));
  writeFileSync(join(work, 'catalog.json'), JSON.stringify(catalog)); writeFileSync(join(work, 'manifest.json'), JSON.stringify({...metadata, chunks: chunks.map(({x, y, path}) => ({x, y, path}))}));
  const native = JSON.parse(execFileSync(nativePath, ['--catalog-file', join(work, 'catalog.json'), '--input', join(work, 'manifest.json'), '--out', join(work, 'out'), '--features-root', join(work, 'features')], {encoding: 'utf8'}));
  // The page's: the worker, fed as sculpt-export.js feeds it, with the tile store's budget at 0 so every tile spills to the stand-in OPFS.
  const top = storage(), call = exportWorker(readFileSync(wasmPath), top, go), job = '0123456789abcdef0123456789abcdef';
  const ready = await call({op: 'start', job, metadata, catalog, features, budgetMB: 0});
  assert.deepEqual([ready.width, ready.height], [width, height]);
  for (const c of chunks) { const reply = await call({op: 'chunk', x: c.x, y: c.y, width: c.width, height: c.height, png: c.bytes.buffer.slice(c.bytes.byteOffset, c.bytes.byteOffset + c.bytes.length)}); assert.equal(reply.type, 'progress'); }
  const done = await call({op: 'finish'});
  assert.equal(JSON.stringify(done.result.selfCheck), JSON.stringify({tnt: true, ota: true, archive: true}));   // the worker's objects are of another realm
  assert.equal(done.result.featureCount, 3);
  assert.equal(done.result.uniqueTiles, native.uniqueTiles);
  assert.equal(sha(new Uint8Array(await done.archive.arrayBuffer())), sha(readFileSync(join(work, 'out', 'Worker Test.ufo'))));
  assert.equal(sha(new Uint8Array(await done.indexed.arrayBuffer())), sha(readFileSync(join(work, 'out', 'Worker Test-indexed.png'))));
  // The tile store, the TNT and the staged copies were removed; the job's folder holds the two downloads.
  const folder = (await top.getDirectoryHandle('terraform-export')).entries.get(job);
  assert.deepEqual([...folder.entries.values()].map(f => f.size).sort((a, b) => a - b), [done.indexed.size, done.archive.size].sort((a, b) => a - b));
});
