// Render material swatches from engine-materials.wgsl and a table (cards H3, H14). A dev tool.
//   node swatch.mjs <table.json> <out-dir> [--foot 1] [--size 512] [--cdp 9663]
// Runs the engine's own startup pass (makeMaterial, the compute shader makeMaterials dispatches) on the table's layers and writes
// <out-dir>/<material>.rgba (size x size x 4 bytes, raw, before any palette stage) and meta.json. A material named twice in the
// table's order is written once, from its first layer. --foot is a power of two: the mip level made with that footprint
// (--foot 4: each drawn pixel covers 4 material pixels, a quarter-resolution draw, and the swatch is size/4 square). The levels
// below it are made first, as the editor's startup makes them, because a lit material's level is a box mean of the one above.
// --auto-zq: first measures each lit layer's z (makeZ) and sets its zq rows to the field's own quantiles, written to meta.json (`zq`, by layer).
// --time: also times the whole startup chain (every level, every layer), seven runs, in meta.json (`times`, ms, first is cold).
// --z: runs entry makeZ instead (level 0): <name>.rgba holds a lit material's z, 16 bits as red*256+green, z = v / 65535 * 16 - 8.
import {spawn} from 'node:child_process';
import {createServer} from 'node:http';
import {mkdirSync, readFileSync, writeFileSync} from 'node:fs';
import {dirname, resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {materialRows, MM_ROWS} from '../sculpt-material-model.js';

const here = dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2);
const opt = (name, fallback) => { const i = args.indexOf(name); return i >= 0 ? args.splice(i, 2)[1] : fallback; };
const zMode = args.includes('--z') && args.splice(args.indexOf('--z'), 1).length > 0;
const foot = Number(opt('--foot', 1)), size = Number(opt('--size', 512)), cdp = Number(opt('--cdp', 9663));
const autoZq = args.includes('--auto-zq') && args.splice(args.indexOf('--auto-zq'), 1).length > 0;
const timing = args.includes('--time') && args.splice(args.indexOf('--time'), 1).length > 0;
const level = zMode ? 0 : Math.round(Math.log2(foot));
const [tableFile, out] = args;
mkdirSync(out, {recursive: true});
const table = JSON.parse(readFileSync(tableFile, 'utf8'));
const rows = materialRows(table);
const shader = readFileSync(resolve(here, '../engine-materials.wgsl'), 'utf8');
const n = size >> level;
const page = `<!doctype html><body><script type="module">
const rows = ${JSON.stringify(rows)}, layers = ${table.order.length}, size = ${size}, level = ${level}, n = ${n}, zMode = ${zMode}, autoZq = ${autoZq}, mmRows = ${MM_ROWS};
const timing = ${timing};
const adapter = await navigator.gpu.requestAdapter(); const device = await adapter.requestDevice();
const module = device.createShaderModule({code: await (await fetch('/engine-materials.wgsl')).text()});
const info = await module.getCompilationInfo();
if (info.messages.some(m => m.type === 'error')) { document.title = 'ERR ' + info.messages.map(m => m.lineNum + ': ' + m.message).join(' | '); throw 0; }
const makePipeline = entryPoint => device.createComputePipelineAsync({layout: 'auto', compute: {module, entryPoint}});
const pipeline = await makePipeline(zMode ? 'makeZ' : 'makeMaterial');
const table = device.createBuffer({size: rows.length * 16, usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST});
const upload = () => device.queue.writeBuffer(table, 0, new Float32Array(rows.flat()));
upload();
const maxLevel = Math.max(level, timing ? 6 : 0);
const texture = device.createTexture({size: [size, size, layers], format: 'rgba8unorm', mipLevelCount: Math.max(maxLevel + 1, 2), usage: GPUTextureUsage.STORAGE_BINDING | GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_SRC});
const view = m => texture.createView({dimension: '2d-array', baseMipLevel: m, mipLevelCount: 1});
const groupsFor = (pipe, withPrev, upTo) => {
  const g = [];
  for (let m = 0; m <= upTo; m++) {
    const p = device.createBuffer({size: 16, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST});
    device.queue.writeBuffer(p, 0, new Float32Array([size, 2 ** m, 0, 0]));
    const entries = [{binding: 0, resource: {buffer: table}}, {binding: 1, resource: view(m)}, {binding: 2, resource: {buffer: p}}];
    if (withPrev) entries.push({binding: 3, resource: view(m ? m - 1 : 1)});
    g.push(device.createBindGroup({layout: pipe.getBindGroupLayout(0), entries}));
  }
  return g;
};
const encodeChain = (enc, pipe, groups, upTo) => {
  for (let m = 0; m <= upTo; m++) {
    const pass = enc.beginComputePass(); pass.setPipeline(pipe); pass.setBindGroup(0, groups[m]);
    const d = Math.ceil((size >> m) / 8); pass.dispatchWorkgroups(d, d, layers); pass.end();
  }
};
const readLevel = async m => {
  const w = size >> m, bpr = Math.ceil(w * 4 / 256) * 256;
  const read = device.createBuffer({size: bpr * w * layers, usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ});
  const enc = device.createCommandEncoder();
  for (let l = 0; l < layers; l++) enc.copyTextureToBuffer({texture, mipLevel: m, origin: [0, 0, l]}, {buffer: read, offset: l * bpr * w, bytesPerRow: bpr}, [w, w, 1]);
  device.queue.submit([enc.finish()]);
  await read.mapAsync(GPUMapMode.READ);
  const src = new Uint8Array(read.getMappedRange()), out = [];
  for (let l = 0; l < layers; l++) {
    const flat = new Uint8Array(w * w * 4);
    for (let y = 0; y < w; y++) flat.set(src.subarray(l * bpr * w + y * bpr, l * bpr * w + y * bpr + w * 4), y * w * 4);
    out.push(flat);
  }
  read.destroy();
  return out;
};
window.zq = {};
if (autoZq) {
  // The 13 rank quantiles of each lit layer's z (the table's zq rows), from the layer's own z field at level 0.
  const zPipe = await makePipeline('makeZ');
  const enc = device.createCommandEncoder();
  encodeChain(enc, zPipe, groupsFor(zPipe, false, 0), 0);
  device.queue.submit([enc.finish()]);
  const P = [0.001, 0.01, 0.05, 0.1, 0.25, 0.4, 0.5, 0.6, 0.75, 0.9, 0.95, 0.99, 0.999];
  (await readLevel(0)).forEach((px, l) => {
    if (!(rows[l * mmRows + 39][0] > 0)) return;
    const z = new Float32Array(size * size);
    for (let i = 0; i < z.length; i++) z[i] = (((px[i * 4] << 8) | px[i * 4 + 1]) / 65535) * 16 - 8;
    z.sort();
    const q = P.map(p => z[Math.min(z.length - 1, Math.floor(p * z.length))]);
    window.zq[l] = q;
    for (let k = 0; k < 4; k++) rows[l * mmRows + 35 + k] = [0, 1, 2, 3].map(i => q[Math.min(k * 4 + i, 12)]);
  });
  upload();
}
const groups = groupsFor(pipeline, !zMode, maxLevel);
if (timing) {
  const times = [];
  for (let r = 0; r < 7; r++) {
    const t0 = performance.now(), enc = device.createCommandEncoder();
    encodeChain(enc, pipeline, groups, 6);
    device.queue.submit([enc.finish()]); await device.queue.onSubmittedWorkDone();
    times.push(performance.now() - t0);
  }
  window.times = times;
}
const enc = device.createCommandEncoder();
encodeChain(enc, pipeline, groups, level);
device.queue.submit([enc.finish()]);
window.result = {};
(await readLevel(level)).forEach((flat, l) => {
  let s = ''; for (let i = 0; i < flat.length; i += 8192) s += String.fromCharCode(...flat.subarray(i, i + 8192));
  window.result[l] = btoa(s);
});
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
  const zq = JSON.parse((await send('Runtime.evaluate', {expression: 'JSON.stringify(window.zq)', returnByValue: true})).result.result.value);
  const times = JSON.parse((await send('Runtime.evaluate', {expression: 'JSON.stringify(window.times||null)', returnByValue: true})).result.result.value);
  writeFileSync(`${out}/meta.json`, JSON.stringify({foot, size: n, order: names, zq, times}));
  console.log(`swatches ${names.join(',')} at ${n}x${n}, foot ${foot}`);
} finally { chrome.kill(); server.close(); }
process.exit(0);
