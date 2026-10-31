// Render material swatches from engine-materials.wgsl and a table (cards H3, H14). A dev tool.
//   node swatch.mjs <table.json> <out-dir> [--foot 1] [--size 512] [--cdp 9663]
// Runs the engine's own startup pass (makeMaterial, the compute shader makeMaterials dispatches) on the table's layers and writes
// <out-dir>/<material>.rgba (size x size x 4 bytes, raw, before any palette stage) and meta.json. A material named twice in the
// table's order is written once, from its first layer. --foot is a power of two: the mip level made with that footprint
// (--foot 4: each drawn pixel covers 4 material pixels, a quarter-resolution draw, and the swatch is size/4 square).
import {spawn} from 'node:child_process';
import {createServer} from 'node:http';
import {mkdirSync, readFileSync, writeFileSync} from 'node:fs';
import {dirname, resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {materialRows} from '../sculpt-material-model.js';

const here = dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2);
const opt = (name, fallback) => { const i = args.indexOf(name); return i >= 0 ? args.splice(i, 2)[1] : fallback; };
const foot = Number(opt('--foot', 1)), size = Number(opt('--size', 512)), cdp = Number(opt('--cdp', 9663));
const level = Math.round(Math.log2(foot));
const [tableFile, out] = args;
mkdirSync(out, {recursive: true});
const table = JSON.parse(readFileSync(tableFile, 'utf8'));
const rows = materialRows(table);
const shader = readFileSync(resolve(here, '../engine-materials.wgsl'), 'utf8');
const n = size >> level;
const page = `<!doctype html><body><script type="module">
const rows = ${JSON.stringify(rows)}, layers = ${table.order.length}, size = ${size}, level = ${level}, n = ${n};
const adapter = await navigator.gpu.requestAdapter(); const device = await adapter.requestDevice();
const module = device.createShaderModule({code: await (await fetch('/engine-materials.wgsl')).text()});
const info = await module.getCompilationInfo();
if (info.messages.some(m => m.type === 'error')) { document.title = 'ERR ' + info.messages.map(m => m.lineNum + ': ' + m.message).join(' | '); throw 0; }
const pipeline = await device.createComputePipelineAsync({layout: 'auto', compute: {module, entryPoint: 'makeMaterial'}});
const table = device.createBuffer({size: rows.length * 16, usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST});
device.queue.writeBuffer(table, 0, new Float32Array(rows.flat()));
const params = device.createBuffer({size: 16, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST});
device.queue.writeBuffer(params, 0, new Float32Array([size, 2 ** level, 0, 0]));
const texture = device.createTexture({size: [size, size, layers], format: 'rgba8unorm', mipLevelCount: level + 1, usage: GPUTextureUsage.STORAGE_BINDING | GPUTextureUsage.COPY_SRC});
const group = device.createBindGroup({layout: pipeline.getBindGroupLayout(0), entries: [{binding: 0, resource: {buffer: table}},
  {binding: 1, resource: texture.createView({dimension: '2d-array', baseMipLevel: level, mipLevelCount: 1})}, {binding: 2, resource: {buffer: params}}]});
const bytesPerRow = Math.ceil(n * 4 / 256) * 256;
const read = device.createBuffer({size: bytesPerRow * n * layers, usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ});
const enc = device.createCommandEncoder();
const pass = enc.beginComputePass(); pass.setPipeline(pipeline); pass.setBindGroup(0, group);
pass.dispatchWorkgroups(Math.ceil(n / 8), Math.ceil(n / 8), layers); pass.end();
for (let m = 0; m < layers; m++) enc.copyTextureToBuffer({texture, mipLevel: level, origin: [0, 0, m]}, {buffer: read, offset: m * bytesPerRow * n, bytesPerRow}, [n, n, 1]);
device.queue.submit([enc.finish()]);
await read.mapAsync(GPUMapMode.READ);
const src = new Uint8Array(read.getMappedRange());
window.result = {};
for (let m = 0; m < layers; m++) {
  const flat = new Uint8Array(n * n * 4);
  for (let y = 0; y < n; y++) flat.set(src.subarray(m * bytesPerRow * n + y * bytesPerRow, m * bytesPerRow * n + y * bytesPerRow + n * 4), y * n * 4);
  let s = ''; for (let i = 0; i < flat.length; i += 8192) s += String.fromCharCode(...flat.subarray(i, i + 8192));
  window.result[m] = btoa(s);
}
document.title = 'done';
</script></body>`;
const server = createServer((req, res) => {
  if (req.url === '/') { res.setHeader('content-type', 'text/html'); res.end(page); }
  else if (req.url === '/engine-materials.wgsl') { res.setHeader('content-type', 'text/plain'); res.end(shader); }
  else { res.statusCode = 404; res.end(); }
}).listen(0, '127.0.0.1');
await new Promise(r => server.once('listening', r));
const url = `http://127.0.0.1:${server.address().port}/`;
const chrome = spawn('/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', ['--headless=new', '--enable-gpu', '--use-angle=metal',
  `--remote-debugging-port=${cdp}`, `--user-data-dir=${resolve(out)}/.profile-${cdp}`, '--window-size=600,600', '--no-first-run', url], {stdio: 'ignore'});
const sleep = ms => new Promise(r => setTimeout(r, ms));
try {
  let ws;
  for (let i = 0; i < 75 && !ws; i++) {
    try { const t = await (await fetch(`http://127.0.0.1:${cdp}/json/list`)).json(); const p = t.find(x => x.type === 'page'); if (p) ws = new WebSocket(p.webSocketDebuggerUrl); } catch {}
    if (!ws) await sleep(200);
  }
  await new Promise(r => ws.onopen = r);
  let id = 0; const pending = new Map();
  ws.onmessage = e => { const m = JSON.parse(e.data); if (m.id) { pending.get(m.id)?.(m); pending.delete(m.id); } };
  const send = (method, params = {}) => new Promise(r => { const i = ++id; pending.set(i, r); ws.send(JSON.stringify({id: i, method, params})); });
  await send('Runtime.enable');
  let title = '';
  for (let i = 0; i < 150 && title !== 'done' && !title.startsWith('ERR'); i++) { await sleep(200); title = (await send('Runtime.evaluate', {expression: 'document.title'})).result.result.value || ''; }
  if (title !== 'done') throw new Error('swatch page: ' + title);
  const names = table.order;
  const r = await send('Runtime.evaluate', {expression: 'JSON.stringify(window.result)', returnByValue: true});
  const result = JSON.parse(r.result.result.value);
  const written = new Set();
  names.forEach((name, m) => { if (!written.has(name)) { written.add(name); writeFileSync(`${out}/${name}.rgba`, Buffer.from(result[m], 'base64')); } });
  writeFileSync(`${out}/meta.json`, JSON.stringify({foot, size: n, order: names}));
  console.log(`swatches ${names.join(',')} at ${n}x${n}, foot ${foot}`);
} finally { chrome.kill(); server.close(); }
process.exit(0);
