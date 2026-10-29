// Render material swatches straight from material-model.wgsl and a table (card H3, item 3). A dev tool.
//   node swatch.mjs <table.json> <out-dir> [--foot 1] [--size 512] [--cdp 9663]
// Writes <out-dir>/<material>.rgba (size x size x 4 bytes, raw, before any palette stage) and meta.json.
// With --foot 4 each drawn pixel covers 4 material pixels (a quarter-resolution draw) and the swatch is size/4 square.
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
const [tableFile, out] = args;
mkdirSync(out, {recursive: true});
const table = JSON.parse(readFileSync(tableFile, 'utf8'));
const rows = materialRows(table);
const model = readFileSync(resolve(here, '../material-model.wgsl'), 'utf8');
const n = Math.floor(size / foot);
const page = `<!doctype html><body><script type="module">
const rows = ${JSON.stringify(rows)}, count = ${table.order.length}, foot = ${foot}, n = ${n};
const adapter = await navigator.gpu.requestAdapter(); const device = await adapter.requestDevice();
const code = \`@group(0) @binding(0) var<uniform> tab: array<vec4f, \${rows.length}>;
@group(0) @binding(1) var<uniform> job: vec4f; // x: material, y: foot
fn matRow(i: u32) -> vec4f { return tab[i]; }
\` + await (await fetch('/material-model.wgsl')).text() + \`
@vertex fn vs(@builtin(vertex_index) i: u32) -> @builtin(position) vec4f { let p = vec2f(f32((i << 1u) & 2u), f32(i & 2u)); return vec4f(p * 2.0 - 1.0, 0.0, 1.0); }
@fragment fn fs(@builtin(position) at: vec4f) -> @location(0) vec4f { return vec4f(mmColor(u32(job.x), (floor(at.xy) + 0.5) * job.y, job.y), 1.0); }\`;
const module = device.createShaderModule({code});
const info = await module.getCompilationInfo();
if (info.messages.some(m => m.type === 'error')) { document.title = 'ERR ' + info.messages.map(m => m.lineNum + ': ' + m.message).join(' | '); throw 0; }
const tabBuffer = device.createBuffer({size: rows.length * 16, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST});
device.queue.writeBuffer(tabBuffer, 0, new Float32Array(rows.flat()));
const jobBuffer = device.createBuffer({size: 16, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST});
const pipeline = device.createRenderPipeline({layout: 'auto', vertex: {module, entryPoint: 'vs'}, fragment: {module, entryPoint: 'fs', targets: [{format: 'rgba8unorm'}]}});
const group = device.createBindGroup({layout: pipeline.getBindGroupLayout(0), entries: [{binding: 0, resource: {buffer: tabBuffer}}, {binding: 1, resource: {buffer: jobBuffer}}]});
const target = device.createTexture({size: [n, n], format: 'rgba8unorm', usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.COPY_SRC});
const bytesPerRow = Math.ceil(n * 4 / 256) * 256;
const read = device.createBuffer({size: bytesPerRow * n, usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ});
window.result = {};
for (let m = 0; m < count; m++) {
  device.queue.writeBuffer(jobBuffer, 0, new Float32Array([m, foot, 0, 0]));
  const enc = device.createCommandEncoder();
  const pass = enc.beginRenderPass({colorAttachments: [{view: target.createView(), loadOp: 'clear', storeOp: 'store', clearValue: [0, 0, 0, 1]}]});
  pass.setPipeline(pipeline); pass.setBindGroup(0, group); pass.draw(3); pass.end();
  enc.copyTextureToBuffer({texture: target}, {buffer: read, bytesPerRow}, [n, n]);
  device.queue.submit([enc.finish()]);
  await read.mapAsync(GPUMapMode.READ);
  const src = new Uint8Array(read.getMappedRange()); const flat = new Uint8Array(n * n * 4);
  for (let y = 0; y < n; y++) flat.set(src.subarray(y * bytesPerRow, y * bytesPerRow + n * 4), y * n * 4);
  read.unmap();
  let s = ''; for (let i = 0; i < flat.length; i += 8192) s += String.fromCharCode(...flat.subarray(i, i + 8192));
  window.result[m] = btoa(s);
}
document.title = 'done';
</script></body>`;
const server = createServer((req, res) => {
  if (req.url === '/') { res.setHeader('content-type', 'text/html'); res.end(page); }
  else if (req.url === '/material-model.wgsl') { res.setHeader('content-type', 'text/plain'); res.end(model); }
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
  names.forEach((name, m) => writeFileSync(`${out}/${name}.rgba`, Buffer.from(result[m], 'base64')));
  writeFileSync(`${out}/meta.json`, JSON.stringify({foot, size: n, order: names}));
  console.log(`swatches ${names.join(',')} at ${n}x${n}, foot ${foot}`);
} finally { chrome.kill(); server.close(); }
process.exit(0);
