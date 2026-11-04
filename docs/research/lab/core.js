// Terrain lab host. Loads one experiment module (exp/<name>.js), compiles it with lib.wgsl and light.wgsl, renders each
// of its variants into its own canvas, and publishes timings on window.__lab for run.mjs. See README.md for the module API.
//
// URL: index.html?exp=<name>
//   &w=512&h=384      output size of every panel (pixels)
//   &px=1             world px per output pixel (resolution independence: 0.5 renders at 2x, 2 at half)
//   &ox=0&oy=0        window origin in world px
//   &world=green      colours from materials/<world>.json (measured means), plus the experiment's own overrides
//   &pal=1&dither=2   quantise to the TA palette (materials/palette.json); dither 0 nearest, 1 two nearest, 2 Knoll pattern
//   &az=315&el=38     sun azimuth (degrees clockwise from screen north; 315 = from the upper left) and elevation
//   &zk=0.7           height units to px for lighting (vertical scale)
//   &shadow=1&ao=1    the cast shadow and the occlusion
//   &v=all|a,b        which variants (labels) to render; default all
//   &p.<name>=<num>   override a parameter of every variant
//   &readback=1       keep each variant's heights on window.__lab.heights[label]

const qs = new URLSearchParams(location.search);
const num = (k, d) => (qs.has(k) ? Number(qs.get(k)) : d);
const log = s => { const el = document.getElementById('log'); if (el) el.textContent += s + '\n'; };

// Measured mean colours per world (materials/<world>.json "measured"), with fallbacks for worlds that lack a key.
const FALLBACK = {ground: [120, 110, 90], grass: [90, 100, 60], rock: [92, 88, 82], loose: [110, 100, 88], sand: [190, 170, 130], sky: [150, 170, 200], sun: [255, 244, 225], water: [40, 76, 200]};
async function worldColours(world) {
  const c = {...FALLBACK};
  try {
    const t = await (await fetch(`../../../materials/${world}.json`)).json();
    const m = t.measured || {};
    const mean = k => m[k]?.meanRGB;
    if (mean('ground') || mean('quilt')) c.ground = mean('ground') || mean('quilt');
    if (mean('slopeGrass')) c.grass = mean('slopeGrass');
    if (mean('rock')) c.rock = mean('rock');
    if (mean('water')) c.water = mean('water');
    if (mean('beach') || mean('fringe')) c.sand = mean('beach') || mean('fringe');
    c.loose = c.rock.map((v, i) => 0.55 * v + 0.45 * c.ground[i]);
  } catch (e) { log('world colours: ' + e.message); }
  return c;
}

function srgbToLin(v) { return Math.pow(v, 2.2); }
function oklab([r, g, b]) {
  const l = 0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b, m = 0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b, s = 0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b;
  const l_ = Math.cbrt(l), m_ = Math.cbrt(m), s_ = Math.cbrt(s);
  return [0.2104542553 * l_ + 0.7936177850 * m_ - 0.0040720468 * s_, 1.9779984951 * l_ - 2.4285922050 * m_ + 0.4505937099 * s_, 0.0259040371 * l_ + 0.7827717662 * m_ - 0.8086757660 * s_];
}

export async function run() {
  const expName = qs.get('exp') || 'mountain-gullies';
  const [lib, light, mod, palJson] = await Promise.all([
    fetch('lib.wgsl').then(r => r.text()), fetch('light.wgsl').then(r => r.text()),
    import(`./exp/${expName}.js`).then(m => m.default), fetch('../../../materials/palette.json').then(r => r.json())]);
  document.title = `Lab: ${mod.title}`;
  document.getElementById('title').textContent = mod.title;
  document.getElementById('about').textContent = mod.about || '';

  const adapter = await navigator.gpu.requestAdapter();
  const ts = adapter.features.has('timestamp-query');
  const device = await adapter.requestDevice({requiredFeatures: ts ? ['timestamp-query'] : []});

  const W = num('w', mod.size?.[0] ?? 512), Hh = num('h', mod.size?.[1] ?? 384), N = W * Hh;
  const paramNames = Object.keys(mod.params || {});
  const prmStruct = paramNames.length ? `struct Prm {\n${paramNames.map(k => `  ${k}: f32,`).join('\n')}\n  _pad0: f32, _pad1: f32, _pad2: f32, _pad3: f32,\n};` : 'struct Prm { _pad0: f32, _pad1: f32, _pad2: f32, _pad3: f32 };';
  let user = mod.wgsl || '';
  if (!/fn\s+matAt\s*\(/.test(user)) user += '\nfn matAt(p: vec2f, h: f32) -> vec4f { return vec4f(0.0); }\n';
  if (!/fn\s+albedoAt\s*\(/.test(user)) user += '\nfn albedoAt(p: vec2f, h: f32, n: vec3f, m: vec4f) -> vec3f { return albedoDefault(p, h, n, m); }\n';
  if (!/fn\s+lightAt\s*\(/.test(user)) user += '\nfn lightAt(p: vec2f, h: f32, n: vec3f, m: vec4f, x: i32, y: i32) -> vec3f { return lightDefault(p, h, n, m, x, y); }\n';
  const simWgsl = mod.sim?.wgsl || '';
  const bindings = `
struct Lab { size: vec4f, org: vec4f, sun: vec4f, look: vec4f, cGround: vec4f, cGrass: vec4f, cRock: vec4f, cLoose: vec4f,
             cSand: vec4f, cSky: vec4f, cSun: vec4f, cWater: vec4f, extra: vec4f };
${prmStruct}
@group(0) @binding(0) var<uniform> lab: Lab;
@group(0) @binding(1) var<uniform> prm: Prm;
@group(0) @binding(2) var<storage, read_write> H: array<f32>;
@group(0) @binding(3) var<storage, read_write> M: array<vec4f>;
@group(0) @binding(4) var<storage, read_write> SA: array<vec4f>;
@group(0) @binding(5) var<storage, read_write> SB: array<vec4f>;
@group(0) @binding(6) var<storage, read_write> OUT: array<u32>;
@group(0) @binding(7) var<storage, read> PAL: array<vec4f>;
`;
  const code = lib + bindings + user + '\n' + simWgsl + '\n' + light;
  const module = device.createShaderModule({code});
  const info = await module.getCompilationInfo();
  const errs = info.messages.filter(m => m.type === 'error');
  for (const m of info.messages) log(`${m.type} ${m.lineNum}:${m.linePos} ${m.message}  | ${code.split('\n')[m.lineNum - 1]?.trim()}`);
  if (errs.length) { window.__lab = {done: true, error: errs.map(e => `${e.lineNum}:${e.linePos} ${e.message}`)}; return; }

  const C = GPUShaderStage.COMPUTE;
  const bgl = device.createBindGroupLayout({entries: [
    {binding: 0, visibility: C, buffer: {type: 'uniform'}}, {binding: 1, visibility: C, buffer: {type: 'uniform'}},
    ...[2, 3, 4, 5, 6].map(b => ({binding: b, visibility: C, buffer: {type: 'storage'}})),
    {binding: 7, visibility: C, buffer: {type: 'read-only-storage'}}]});
  const layout = device.createPipelineLayout({bindGroupLayouts: [bgl]});
  const pipe = entry => device.createComputePipelineAsync({layout, compute: {module, entryPoint: entry}});
  const [pHeight, pLight] = await Promise.all([pipe('heightMain'), pipe('lightMain')]);
  const simEntries = mod.sim ? ['simInit', 'simStep', 'simApply'] : [];
  const pSim = Object.fromEntries(await Promise.all(simEntries.map(async e => [e, await pipe(e)])));

  const S = GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC | GPUBufferUsage.COPY_DST;
  const bH = device.createBuffer({size: N * 4, usage: S}), bM = device.createBuffer({size: N * 16, usage: S});
  const bA = device.createBuffer({size: N * 16, usage: S}), bB = device.createBuffer({size: N * 16, usage: S});
  const bOut = device.createBuffer({size: N * 4, usage: S});
  const pal = palJson.colours;
  const palData = new Float32Array(pal.length * 8);
  pal.forEach((c, i) => { const lin = c.map(v => srgbToLin(v / 255)); palData.set([...oklab(lin), 0, c[0] / 255, c[1] / 255, c[2] / 255, 1], i * 8); });
  const bPal = device.createBuffer({size: palData.byteLength, usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST});
  device.queue.writeBuffer(bPal, 0, palData);
  const uLab = device.createBuffer({size: 13 * 16, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST});
  const uPrm = device.createBuffer({size: Math.max(16, Math.ceil((paramNames.length + 4) / 4) * 16), usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST});
  const group = (a, b) => device.createBindGroup({layout: bgl, entries: [
    {binding: 0, resource: {buffer: uLab}}, {binding: 1, resource: {buffer: uPrm}}, {binding: 2, resource: {buffer: bH}}, {binding: 3, resource: {buffer: bM}},
    {binding: 4, resource: {buffer: a}}, {binding: 5, resource: {buffer: b}}, {binding: 6, resource: {buffer: bOut}}, {binding: 7, resource: {buffer: bPal}}]});
  const gAB = group(bA, bB), gBA = group(bB, bA);
  const qset = ts ? device.createQuerySet({type: 'timestamp', count: 6}) : null;
  const qres = ts ? device.createBuffer({size: 48, usage: GPUBufferUsage.QUERY_RESOLVE | GPUBufferUsage.COPY_SRC}) : null;
  const qread = ts ? device.createBuffer({size: 48, usage: GPUBufferUsage.MAP_READ | GPUBufferUsage.COPY_DST}) : null;
  const read = device.createBuffer({size: N * 4, usage: GPUBufferUsage.MAP_READ | GPUBufferUsage.COPY_DST});
  const readH = device.createBuffer({size: N * 4, usage: GPUBufferUsage.MAP_READ | GPUBufferUsage.COPY_DST});

  const allVariants = mod.variants?.length ? mod.variants : [{label: 'default', params: {}}];
  const pick = qs.get('v');
  const variants = !pick || pick === 'all' ? allVariants : allVariants.filter(v => pick.split(',').includes(v.label));
  const grid = document.getElementById('grid');
  const results = [], heights = {};
  for (const v of variants) {
    const L = {...(mod.lab || {}), ...(v.lab || {})};
    const lv = (k, d) => (qs.has(k) ? Number(qs.get(k)) : (L[k] ?? d));
    const world = qs.get('world') || L.world || mod.world || 'green';
    const col = {...(await worldColours(world)), ...(mod.colours || {}), ...(v.colours || {})};
    // Toward the sun, in screen axes (x right, y down, z up); az clockwise from screen north, so 315 is the upper left.
    const az = lv('az', 315) * Math.PI / 180, el = lv('el', 38) * Math.PI / 180;
    const sun = [Math.sin(az) * Math.cos(el), -Math.cos(az) * Math.cos(el), Math.sin(el)];
    const params = {...(mod.params || {}), ...(v.params || {})};
    for (const k of paramNames) if (qs.has('p.' + k)) params[k] = Number(qs.get('p.' + k));
    const c4 = k => [...col[k].map(x => x / 255), 1];
    const labData = new Float32Array([
      W, Hh, lv('px', 1), 0,
      lv('ox', 0), lv('oy', 0), lv('seed', 1), lv('zk', 0.7),
      ...sun, lv('shadow', 1),
      lv('pal', 1), lv('dither', 2), lv('exposure', 1), lv('ao', 1),
      ...c4('ground'), ...c4('grass'), ...c4('rock'), ...c4('loose'), ...c4('sand'), ...c4('sky'), ...c4('sun'), ...c4('water'),
      lv('sea', -1e6), pal.length, 0, 0]);
    device.queue.writeBuffer(uLab, 0, labData);
    const prmData = new Float32Array(Math.max(4, Math.ceil((paramNames.length + 4) / 4) * 4));
    paramNames.forEach((k, i) => { prmData[i] = params[k]; });
    device.queue.writeBuffer(uPrm, 0, prmData);
    const wg = [Math.ceil(W / 8), Math.ceil(Hh / 8)];
    const enc = device.createCommandEncoder();
    const pass = (p, q, groupFor, count = 1) => {
      const cp = enc.beginComputePass(ts && q >= 0 ? {timestampWrites: {querySet: qset, beginningOfPassWriteIndex: q, endOfPassWriteIndex: q + 1}} : {});
      cp.setPipeline(p);
      for (let i = 0; i < count; i++) { cp.setBindGroup(0, groupFor(i)); cp.dispatchWorkgroups(...wg); }
      cp.end();
    };
    pass(pHeight, 0, () => gAB);
    const iters = mod.sim ? (lv('iters', mod.sim.iterations ?? 0) | 0) : 0;
    if (mod.sim) {
      pass(pSim.simInit, -1, () => gAB);
      // simStep reads SA and writes SB; the groups alternate so iteration i reads what i - 1 wrote. lab.size.w is the
      // iteration count, constant over the run (use it for schedules); an even count leaves the result in buffer A.
      const sp = enc.beginComputePass(ts ? {timestampWrites: {querySet: qset, beginningOfPassWriteIndex: 2, endOfPassWriteIndex: 3}} : {});
      sp.setPipeline(pSim.simStep);
      for (let i = 0; i < iters; i++) { sp.setBindGroup(0, i % 2 ? gBA : gAB); sp.dispatchWorkgroups(...wg); }
      sp.end();
      pass(pSim.simApply, -1, () => (iters % 2 ? gBA : gAB));
    }
    pass(pLight, 4, () => gAB);
    enc.copyBufferToBuffer(bOut, 0, read, 0, N * 4);
    if (qs.get('readback') === '1') enc.copyBufferToBuffer(bH, 0, readH, 0, N * 4);
    if (ts) { enc.resolveQuerySet(qset, 0, 6, qres, 0); enc.copyBufferToBuffer(qres, 0, qread, 0, 48); }
    labData[3] = iters; device.queue.writeBuffer(uLab, 0, labData);   // (written before submit: the sim reads it)
    device.queue.submit([enc.finish()]);
    await read.mapAsync(GPUMapMode.READ);
    const px = new Uint8ClampedArray(read.getMappedRange().slice(0)); read.unmap();
    if (qs.get('readback') === '1') { await readH.mapAsync(GPUMapMode.READ); heights[v.label] = new Float32Array(readH.getMappedRange().slice(0)); readH.unmap(); }
    let ms = {};
    if (ts) {
      await qread.mapAsync(GPUMapMode.READ); const t = new BigUint64Array(qread.getMappedRange().slice(0)); qread.unmap();
      ms = {height: Number(t[1] - t[0]) / 1e6, sim: mod.sim ? Number(t[3] - t[2]) / 1e6 : 0, light: Number(t[5] - t[4]) / 1e6};
    }
    const fig = document.createElement('figure');
    const canvas = document.createElement('canvas'); canvas.width = W; canvas.height = Hh; canvas.dataset.label = v.label;
    canvas.getContext('2d').putImageData(new ImageData(px, W, Hh), 0, 0);
    const cap = document.createElement('figcaption');
    cap.textContent = `${v.label}${v.note ? ': ' + v.note : ''}  ·  ${ts ? `height ${ms.height.toFixed(1)} ms, ${mod.sim ? `sim ${ms.sim.toFixed(1)} ms (${iters} it), ` : ''}light ${ms.light.toFixed(1)} ms` : ''}`;
    fig.append(canvas, cap); grid.append(fig);
    results.push({label: v.label, note: v.note || '', ms, params, lab: L, world});
  }
  window.__lab = {done: true, exp: expName, title: mod.title, size: [W, Hh], results, heights};
  log(JSON.stringify(results.map(r => ({label: r.label, ms: r.ms}))));
}
