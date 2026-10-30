// H2: the GPU erosion pass (erosion.wgsl) for the 1024-px study, run on the renderer's
// device in place of the droplet loop of sculpt-weathering.js (knob erosion 1). It keeps
// that worker's contract: the same mobility and lower/upper bounds (derived below from the
// same slope rules, at the worker's own largest budget), no change to submerged samples
// or to protected ones, and a height between sea -90 and sea +300. The worker then runs
// with the height this returns, so the apron, sand and material field are as before.
// Authoring prototype, not retail rules.

import {feedPasses, feedUniform} from './sculpt-gpu-fields.js';

const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const smooth = (a, b, v) => { const t = clamp((v - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };

// Constants of the model. Each comment says what it trades; the four knobs a user sees are
// erosionAge, erosionRain, columnContrast and talusAngle.
const BASE_RAIN = 0.006;   // height units a dry sample gains per iteration (times erosionRain)
const K_FLUX = 0.12;       // pipe flow per unit of surface difference: stable below .25 with four pipes
const DAMP = 0.85;         // flow a pipe keeps from the last iteration: sheets spread instead of ringing
const K_CAP = 0.3;         // sediment capacity per unit of sin(slope) * speed
const K_DISSOLVE = 0.5;    // share of the shortfall dissolved per iteration
const K_DEPOSIT = 0.3;     // share of the excess dropped per iteration (lower than dissolve: sediment travels)
const EVAPORATION = 0.01;  // standing water dries slowly, so pits fill and settle their sediment
const WET_FULL = 0.01;     // water depth at which the full capacity applies
const ROCK_WEAR = 15;      // hardest rock (hardness 1, contrast 1) wears 1/16 as fast as debris
const SOFT_EXTRA = 0;      // softest rock stands this many degrees steeper than loose debris (shale slopes as debris does)
const HARD_ANGLE = 80;     // repose of the hardest rock, degrees
const THERMAL = 0.05;      // share of a pair's excess slope moved per thermal step (eight pairs share a sample's budget)
// The worker's bounds, at three times its largest budget: it keeps each sample within 4 + 8 * steep below and 2.5 + 2.5 * steep
// above the authored height times its strength (.35 in its default call, never over 1), a budget too small for a ledge to retreat
// or a cliff to gather talus. A mesa 100 high saturated them at 1 and 2 (EXPERIMENTS: H2). Still a hard envelope around the authored form.
const BUDGET = 3;
const SHORE_BUDGET = 0.35;

// Same rules as the worker: slope measured in height per world px, mobility from the slope
// and the protection, the bounds around the authored height.
function fixedField({height, protect, rate, grid, size, seaLevel, envelope = 1}) {
  const n = grid * grid, spacing = (size - 1) / (grid - 1), gradient = new Float32Array(n), out = new Float32Array(n * 4);
  for (let y = 0; y < grid; y++) for (let x = 0; x < grid; x++) {
    const lx = Math.max(0, x - 1), rx = Math.min(grid - 1, x + 1), ty = Math.max(0, y - 1), by = Math.min(grid - 1, y + 1);
    gradient[y * grid + x] = Math.hypot((height[y * grid + rx] - height[y * grid + lx]) / ((rx - lx) * spacing), (height[by * grid + x] - height[ty * grid + x]) / ((by - ty) * spacing));
  }
  const MIN = seaLevel - 90, MAX = seaLevel + 300;
  for (let y = 0; y < grid; y++) for (let x = 0; x < grid; x++) {
    const i = y * grid + x, h = height[i], p = protect ? protect[i] : 0;
    out[i * 4] = h; out[i * 4 + 1] = h; out[i * 4 + 2] = 0;
    if (h <= seaLevel) { out[i * 4 + 2] = -1; continue; }
    if (p >= 1) continue;
    let slope = gradient[i];
    for (let yy = Math.max(0, y - 1); yy <= Math.min(grid - 1, y + 1); yy++) for (let xx = Math.max(0, x - 1); xx <= Math.min(grid - 1, x + 1); xx++) slope = Math.max(slope, gradient[yy * grid + xx]);
    const weight = smooth(.035, .20, slope) * (1 - clamp(p, 0, 1));
    if (weight <= 0) continue;
    const steep = smooth(.7, 1.5, slope);
    // H5: request.envelope (1: this budget; Green's engine asks for more) scales the budget above the shore band.
    // A coast is authored (water strokes) and a gentle shore moves its waterline far for a little height: within 20 units of the
    // sea the budget is the worker's own .35 (a dry sample stays dry), rising to BUDGET above that.
    const budget = SHORE_BUDGET + (BUDGET * envelope - SHORE_BUDGET) * smooth(seaLevel + 2, seaLevel + 20, h);
    out[i * 4] = Math.max(MIN, Math.min(h, seaLevel + 1), h - (4 + 8 * steep) * budget * weight);
    out[i * 4 + 1] = Math.min(MAX, h + (2.5 + 2.5 * steep) * budget * weight);
    // H3 override plane 14: the erosion rate there, times 1 + v (no erosion at -1).
    out[i * 4 + 2] = weight * (rate ? Math.max(0, rate[i]) : 1);
  }
  return out;
}

export class GpuErosion {
  constructor(renderer, source, tiled = false) {
    this.renderer = renderer; this.tiled = tiled;
    const device = this.device = renderer.device;
    const module = device.createShaderModule({label: 'erosion', code: source});
    this.ready = module.getCompilationInfo().then(info => {
      const errors = info.messages.filter(m => m.type === 'error');
      if (errors.length) throw new Error('nanolathe: erosion.wgsl does not compile:\n' + errors.map(e => `${e.lineNum}:${e.linePos} ${e.message}`).join('\n'));
      const C = GPUShaderStage.COMPUTE;
      const buffer = type => ({visibility: C, buffer: {type}});
      this.layout1 = device.createBindGroupLayout({label: 'erosion', entries: [{binding: 0, ...buffer('uniform')}, {binding: 1, ...buffer('read-only-storage')}, {binding: 2, ...buffer('storage')},
        {binding: 3, ...buffer('read-only-storage')}, {binding: 4, ...buffer('storage')}, {binding: 5, ...buffer('storage')}, {binding: 6, ...buffer('storage')}, {binding: 7, ...buffer('storage')}, ...(tiled ? [{binding: 8, ...buffer('read-only-storage')}] : [])]});
      this.layout0 = device.createBindGroupLayout({label: 'erosion u', entries: [{binding: 0, ...buffer('uniform')}]});
      const layout = device.createPipelineLayout({bindGroupLayouts: [this.layout0, this.layout1]});
      this.pipelines = {};
      return Promise.all(['offsetMain', 'fluxMain', 'waterMain', 'exchangeMain', 'settleMain', 'carryMain', 'thermalMain'].map(async entry =>
        { this.pipelines[entry] = await device.createComputePipelineAsync({label: entry, layout, compute: {module, entryPoint: entry}}); }));
    });
  }

  // H5: the maps pass (engine-weather.wgsl) on the erosion's own device and common source, built on first use.
  async mapsPipeline() {
    if (this.maps) return this.maps;
    const {device} = this, C = GPUShaderStage.COMPUTE, buffer = (type, binding) => ({binding, visibility: C, buffer: {type}});
    const source = this.renderer.preprocessShader(await (await fetch('/engine-weather.wgsl')).text());
    const module = device.createShaderModule({label: 'engine-weather', code: source});
    const info = await module.getCompilationInfo(), errors = info.messages.filter(m => m.type === 'error');
    if (errors.length) throw new Error('nanolathe: engine-weather.wgsl does not compile:\n' + errors.map(e => `${e.lineNum}:${e.linePos} ${e.message}`).join('\n'));
    const layout = device.createBindGroupLayout({label: 'engine-weather', entries: [buffer('uniform', 0), ...[1, 2, 3, 4].map(b => buffer('read-only-storage', b)), ...[5, 6, 7].map(b => buffer('storage', b))]});
    const pipeline = await device.createComputePipelineAsync({label: 'mapsMain', layout: device.createPipelineLayout({bindGroupLayouts: [this.layout0, layout]}), compute: {module, entryPoint: 'mapsMain'}});
    return this.maps = {layout, pipeline};
  }

  // H6b: the whole Time pass on GPU buffers (Green's map canvas, engine 1). The input is the GPU shape fields' own planes and masks
  // (request.planes, request.masks: the height, protection and erosion-override planes); engine-feed.wgsl builds the erosion state, the
  // fixed field and the active-tile list from them, and the maps pass follows the erosion as in run(). Nothing is read back: the result
  // is two buffers, `weather` (plane 0 the authored height the pass started from, plane 1 the eroded height) and `maps` (the three packed
  // layers), which the chunk bake reads in place and `readBuffer` brings to the CPU only when a CPU reader asks.
  async runGpu(request) {
    await this.ready;
    window.erodeRuns = (window.erodeRuns || 0) + 1;
    const feed = await feedPasses(this.device), mp = await this.mapsPipeline();
    const {device} = this, {grid, size, seaLevel} = request, n = grid * grid, spacing = request.spacing ?? (size - 1) / (grid - 1);   // H5b: a window of a larger map passes the map's spacing and its own origin
    const age = Math.max(1, Math.round(request.age)), rain = BASE_RAIN * request.rain, started = performance.now();
    const talus = Math.tan(request.talusAngle * Math.PI / 180);
    const params = new Float32Array([grid, spacing, rain, K_FLUX, DAMP, K_CAP, K_DISSOLVE, K_DEPOSIT, EVAPORATION, WET_FULL,
      this.renderer.variantNumber('columnContrast', 1), ROCK_WEAR, talus, Math.min(request.talusAngle + SOFT_EXTRA, 85) * Math.PI / 180, HARD_ANGLE * Math.PI / 180, THERMAL, request.ox ?? 0, request.oy ?? 0]);
    const S = GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC | GPUBufferUsage.COPY_DST;
    const make = (label, bytes, usage = S) => device.createBuffer({label, size: Math.max(16, bytes), usage});
    const tw = Math.ceil(grid / 8);
    const state = [0, 1, 2].map(k => make('erosion state ' + k, n * 16));
    const fluxA = make('erosion flux a', n * 16), fluxB = make('erosion flux b', n * 16), vel = make('erosion velocity', n * 8), acc = make('erosion totals', n * 16);
    const fixedBuffer = make('erosion fixed', n * 16), paramBuffer = make('erosion params', 80, GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST);
    const tileFlag = make('erosion tile flags', tw * tw * 4), tileList = make('erosion tiles', tw * tw * 8), tileCount = make('erosion tile count', 4);
    const tileArgs = make('erosion tile args', 12, S | GPUBufferUsage.INDIRECT);
    const weather = make('time pass height', n * 8), maps = [0, 1, 2].map(k => make('time pass map ' + k, n * 4));
    const uniform = feedUniform(device, {grid, cells: n, rateMask: request.rateMask, sea: seaLevel, spacing, envelope: request.envelope ?? 1, tilesWide: tw});
    device.queue.writeBuffer(paramBuffer, 0, params);
    this.renderer.setColumn();
    this.renderer.flushUniforms();
    const res = {'0.0': {buffer: uniform}, '0.1': {buffer: request.planes}, '0.2': {buffer: request.masks},
      '1.0': {buffer: state[0]}, '1.1': {buffer: state[1]}, '1.2': {buffer: state[2]}, '1.3': {buffer: fixedBuffer}, '1.4': {buffer: tileFlag}, '1.5': {buffer: tileList},
      '1.6': {buffer: tileCount}, '1.7': {buffer: tileArgs}, '1.8': {buffer: weather}, '1.9': {buffer: state[1]}};
    const group1 = (src, dst, fIn, fOut) => device.createBindGroup({layout: this.layout1, entries: [{binding: 0, resource: {buffer: paramBuffer}},
      {binding: 1, resource: {buffer: src}}, {binding: 2, resource: {buffer: dst}}, {binding: 3, resource: {buffer: fIn}}, {binding: 4, resource: {buffer: fOut}},
      {binding: 5, resource: {buffer: vel}}, {binding: 6, resource: {buffer: acc}}, {binding: 7, resource: {buffer: fixedBuffer}}, {binding: 8, resource: {buffer: tileList}}]});
    const group0 = device.createBindGroup({layout: this.layout0, entries: [{binding: 0, resource: {buffer: this.renderer.uniformBuffer}}]});
    const [s0, s1, s2] = state;
    const flux = group1(s0, s1, fluxA, fluxB), water = group1(s0, s2, fluxB, fluxA), exchange = group1(s2, s1, fluxA, fluxB), carry = group1(s1, s0, fluxA, fluxB);
    const thermalA = group1(s0, s1, fluxA, fluxB), thermalB = group1(s1, s0, fluxA, fluxB);
    const groups = Math.ceil(grid / 8), encoder = device.createCommandEncoder({label: 'erosion gpu'});
    // The erosion state, the fixed field and the active tiles, from the shape fields' planes.
    const input = encoder.beginComputePass({label: 'erosion input'});
    const feedStep = (entry, x, y = 1) => { input.setPipeline(feed.pipes[entry]); for (const [g, bg] of feed.groups(entry, res)) input.setBindGroup(g, bg); input.dispatchWorkgroups(x, y); };
    feedStep('seedMain', groups, groups); feedStep('tileFlagMain', groups, groups); feedStep('tileListMain', Math.ceil(tw / 8), Math.ceil(tw / 8)); feedStep('tileArgsMain', 1);
    input.end();
    encoder.copyBufferToBuffer(request.planes, 0, weather, 0, n * 4);   // plane 0 of `weather`: the authored height, which the blend and the maps pass read
    const pass = encoder.beginComputePass({label: 'erosion'});
    const step = (entry, group) => { pass.setPipeline(this.pipelines[entry]); pass.setBindGroup(0, group0); pass.setBindGroup(1, group); if (entry !== 'offsetMain') pass.dispatchWorkgroupsIndirect(tileArgs, 0); else pass.dispatchWorkgroups(groups, groups); };
    step('offsetMain', flux);
    for (let it = 0; it < age; it++) {
      step('fluxMain', flux); step('waterMain', water); step('exchangeMain', exchange); step('carryMain', carry);
      step('thermalMain', thermalA); step('thermalMain', thermalB);
    }
    step('settleMain', thermalA);
    step('thermalMain', thermalB); step('thermalMain', thermalA); step('thermalMain', thermalB); step('thermalMain', thermalA);
    pass.end();
    const output = encoder.beginComputePass({label: 'time pass output'});
    output.setPipeline(feed.pipes.refinedMain); for (const [g, bg] of feed.groups('refinedMain', res)) output.setBindGroup(g, bg); output.dispatchWorkgroups(groups, groups);
    output.end();
    const mapParams = make('erosion map params', 32, GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST);
    device.queue.writeBuffer(mapParams, 0, new Float32Array([grid, spacing, .36 / (age * BASE_RAIN), request.sand ?? 0, request.wetReach ?? 3, request.talusFull ?? 2.5, request.wearFull ?? 6, request.flowK ?? 4]));
    const mapGroup = device.createBindGroup({layout: mp.layout, entries: [{buffer: mapParams}, {buffer: s1}, {buffer: acc}, {buffer: fixedBuffer}, {buffer: weather, offset: 0, size: n * 4}, ...maps.map(buffer => ({buffer}))].map((resource, binding) => ({binding, resource}))});
    const second = encoder.beginComputePass({label: 'erosion maps'});
    second.setPipeline(mp.pipeline); second.setBindGroup(0, group0); second.setBindGroup(1, mapGroup); second.dispatchWorkgroups(groups, groups); second.end();
    const tSubmit = performance.now();
    device.queue.submit([encoder.finish()]);
    await device.queue.onSubmittedWorkDone();
    const gpu = performance.now() - tSubmit;
    [...state, fluxA, fluxB, vel, acc, fixedBuffer, paramBuffer, tileFlag, tileList, tileCount, tileArgs, mapParams, uniform].forEach(b => b.destroy());
    return {weather, maps, grid, bytes: n * 8 + n * 12, milliseconds: performance.now() - started, parts: {gpu, tiles: null, gpuFed: true}};
  }

  // H8 rule: the material field (engine-weather.wgsl mf*), the GPU form of sculpt-material-weathering.js's weatherMaterials. Reads the height the
  // pass left; returns Float32Array(grid * grid * 4): arrival, soil, softened source, source (gridTexture layer 1).
  async materialField({height, grid, size, seaLevel = 0, baseHeight = 24, seed = 1, depositSpread = .65, profile = {}}) {
    await this.ready;
    const {device} = this, n = grid * grid, spacing = (size - 1) / (grid - 1), spread = clamp(depositSpread, 0, 1);
    if (!this.field) {
      const module = device.createShaderModule({label: 'engine-weather material field', code: this.renderer.preprocessShader(await (await fetch('/engine-weather.wgsl')).text())});
      const errors = (await module.getCompilationInfo()).messages.filter(m => m.type === 'error');
      if (errors.length) throw new Error('nanolathe: engine-weather.wgsl does not compile:\n' + errors.map(e => `${e.lineNum}:${e.linePos} ${e.message}`).join('\n'));
      const entries = {source: 'mfSourceMain', drops: 'mfDropsMain', counts: 'mfCountsMain', blur: 'mfBlurMain', combine: 'mfCombineMain'};
      this.field = {};
      await Promise.all(Object.entries(entries).map(async ([k, entryPoint]) => { this.field[k] = await device.createComputePipelineAsync({label: entryPoint, layout: 'auto', compute: {module, entryPoint}}); }));
    }
    const P = this.field, S = GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC | GPUBufferUsage.COPY_DST, made = [];
    const make = (bytes, usage = S) => { const b = device.createBuffer({size: Math.max(16, bytes), usage}); made.push(b); return b; };
    const heightBuf = make(n * 4); device.queue.writeBuffer(heightBuf, 0, Float32Array.from(height));
    const [source, gx, gy, basin, deposit, flow, a, b, c, soft, settled, broad, runoff] = Array.from({length: 13}, () => make(n * 4)), field = make(n * 16);
    const mineral = profile.mineral === true, elevated = profile.elevatedCover || [0, 30, 0];
    const uniform = (sigma, axis) => {
      const buf = make(64, GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST), view = new DataView(new ArrayBuffer(64));
      [grid, spacing, seaLevel, baseHeight, spread].forEach((v, i) => view.setFloat32(i * 4, v, true));
      view.setUint32(20, seed >>> 0, true); view.setUint32(24, Math.round(n * .52), true);
      [profile.rockyCoasts ? 1 : 0, mineral ? 1 : 0, elevated[0], elevated[1], elevated[2], profile.transportSlopeStart ?? (mineral ? .07 : .60), profile.transportSlopeFull ?? (mineral ? .55 : 1.35), sigma, axis]
        .forEach((v, i) => view.setFloat32(28 + i * 4, v, true));
      device.queue.writeBuffer(buf, 0, view.buffer); return buf;
    };
    const encoder = device.createCommandEncoder({label: 'material field'});
    const run = (pipeline, ids, bufs, uni, groups) => {
      const pass = encoder.beginComputePass();
      pass.setPipeline(pipeline);
      pass.setBindGroup(2, device.createBindGroup({layout: pipeline.getBindGroupLayout(2), entries: [{binding: 0, resource: {buffer: uni}}, ...ids.map((binding, k) => ({binding, resource: {buffer: bufs[k]}}))]}));
      pass.dispatchWorkgroups(...groups); pass.end();
    };
    const tiles = Math.ceil(grid / 8), u0 = uniform(0, 0);
    run(P.source, [1, 2, 3, 4, 5], [heightBuf, source, gx, gy, basin], u0, [tiles, tiles]);
    run(P.drops, [1, 2, 3, 4, 6, 7], [heightBuf, source, gx, gy, deposit, flow], u0, [Math.ceil(Math.round(n * .52) / 64)]);
    const blur = (input, output, sigma) => {
      run(P.blur, [8, 9], [input, c], uniform(sigma, 0), [tiles, tiles]);
      run(P.blur, [8, 9], [c, output], uniform(sigma, 1), [tiles, tiles]);
    };
    run(P.counts, [6, 7, 9], [deposit, flow, a], uniform(0, 1), [tiles, tiles]);
    run(P.counts, [6, 7, 9], [deposit, flow, b], uniform(0, 2), [tiles, tiles]);
    blur(source, soft, 9 + spread * 17); blur(a, settled, 2.6); blur(a, broad, 9); blur(b, runoff, 3.5);
    run(P.combine, [1, 2, 5, 10, 11, 12, 13, 14], [heightBuf, source, basin, field, settled, broad, runoff, soft], u0, [tiles, tiles]);
    const read = make(n * 16, GPUBufferUsage.MAP_READ | GPUBufferUsage.COPY_DST);
    encoder.copyBufferToBuffer(field, 0, read, 0, n * 16);
    device.queue.submit([encoder.finish()]);
    await read.mapAsync(GPUMapMode.READ);
    const out = new Float32Array(read.getMappedRange().slice(0));
    made.forEach(buf => buf.destroy());
    return out;
  }

  // request: {height, protect, grid, size, seaLevel, age, rain, talusAngle}. Returns the eroded height (rock + debris), the
  // water throughput scaled like the worker's flow, the material deposited, the loose debris and the milliseconds spent.
  async run(request) {
    await this.ready;
    window.erodeRuns = (window.erodeRuns || 0) + 1;   // dev: how many passes a scene queued
    const {device} = this, {grid, size, seaLevel} = request, n = grid * grid, spacing = (size - 1) / (grid - 1);
    const age = Math.max(1, Math.round(request.age)), rain = BASE_RAIN * request.rain, started = performance.now();
    const talus = Math.tan(request.talusAngle * Math.PI / 180);
    const params = new Float32Array([grid, spacing, rain, K_FLUX, DAMP, K_CAP, K_DISSOLVE, K_DEPOSIT, EVAPORATION, WET_FULL,
      this.renderer.variantNumber('columnContrast', 1), ROCK_WEAR, talus, Math.min(request.talusAngle + SOFT_EXTRA, 85) * Math.PI / 180, HARD_ANGLE * Math.PI / 180, THERMAL]);
    const tBack0 = performance.now(); await device.queue.onSubmittedWorkDone(); const tBacklog = performance.now() - tBack0;   // GPU work queued ahead of the pass
    const tFixed0 = performance.now();
    const fixed = fixedField(request);
    const tFixed = performance.now() - tFixed0;
    const S = GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC | GPUBufferUsage.COPY_DST;
    const make = (label, bytes, usage = S) => device.createBuffer({label, size: bytes, usage});
    const state = [0, 1, 2].map(k => make('erosion state ' + k, n * 16));
    const fluxA = make('erosion flux a', n * 16), fluxB = make('erosion flux b', n * 16), vel = make('erosion velocity', n * 8), acc = make('erosion totals', n * 16);
    const fixedBuffer = make('erosion fixed', n * 16), paramBuffer = make('erosion params', 80, GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST);
    const initial = new Float32Array(n * 4);
    for (let i = 0; i < n; i++) initial[i * 4] = request.height[i];
    device.queue.writeBuffer(state[0], 0, initial);
    // H5 (engine-erosion.wgsl): the steps run over the active 8 x 8 tiles only. A tile is active when it or a tile beside it holds a sample
    // that can move (mobility above 0); the rest never change, so every state buffer starts with the authored height.
    let tileCount = 0, tileBuffer = null;
    if (this.tiled) {
      const tw = Math.ceil(grid / 8), flag = new Uint8Array(tw * tw), list = [];
      for (let y = 0; y < grid; y++) for (let x = 0; x < grid; x++) if (fixed[(y * grid + x) * 4 + 2] > 0) flag[(y >> 3) * tw + (x >> 3)] = 1;
      for (let ty = 0; ty < tw; ty++) for (let tx = 0; tx < tw; tx++) {
        let on = false;
        for (let dy = -1; dy <= 1 && !on; dy++) for (let dx = -1; dx <= 1; dx++) { const a = tx + dx, b = ty + dy; if (a >= 0 && b >= 0 && a < tw && b < tw && flag[b * tw + a]) { on = true; break; } }
        if (on) list.push(tx, ty);
      }
      tileCount = list.length / 2;
      tileBuffer = make('erosion tiles', Math.max(8, list.length * 4));
      device.queue.writeBuffer(tileBuffer, 0, new Uint32Array(list.length ? list : [0, 0]));
      device.queue.writeBuffer(state[1], 0, initial); device.queue.writeBuffer(state[2], 0, initial);
    }
    device.queue.writeBuffer(fixedBuffer, 0, fixed);
    device.queue.writeBuffer(paramBuffer, 0, params);
    for (const b of [...(this.tiled ? [] : [state[1], state[2]]), fluxA, fluxB, vel, acc]) device.queue.writeBuffer(b, 0, new Float32Array(b.size / 4));
    this.renderer.setColumn();
    this.renderer.flushUniforms();
    const group1 = (src, dst, fIn, fOut) => device.createBindGroup({layout: this.layout1, entries: [{binding: 0, resource: {buffer: paramBuffer}},
      {binding: 1, resource: {buffer: src}}, {binding: 2, resource: {buffer: dst}}, {binding: 3, resource: {buffer: fIn}}, {binding: 4, resource: {buffer: fOut}},
      {binding: 5, resource: {buffer: vel}}, {binding: 6, resource: {buffer: acc}}, {binding: 7, resource: {buffer: fixedBuffer}}, ...(tileBuffer ? [{binding: 8, resource: {buffer: tileBuffer}}] : [])]});
    const group0 = device.createBindGroup({layout: this.layout0, entries: [{binding: 0, resource: {buffer: this.renderer.uniformBuffer}}]});
    const [s0, s1, s2] = state;
    const flux = group1(s0, s1, fluxA, fluxB), water = group1(s0, s2, fluxB, fluxA), exchange = group1(s2, s1, fluxA, fluxB), carry = group1(s1, s0, fluxA, fluxB);
    const thermalA = group1(s0, s1, fluxA, fluxB), thermalB = group1(s1, s0, fluxA, fluxB);
    const groups = Math.ceil(grid / 8), encoder = device.createCommandEncoder({label: 'erosion'}), pass = encoder.beginComputePass({label: 'erosion'});
    const step = (entry, group) => { pass.setPipeline(this.pipelines[entry]); pass.setBindGroup(0, group0); pass.setBindGroup(1, group); if (this.tiled && entry !== 'offsetMain') { if (tileCount) pass.dispatchWorkgroups(tileCount); } else pass.dispatchWorkgroups(groups, groups); };
    step('offsetMain', flux);
    for (let it = 0; it < age; it++) {
      step('fluxMain', flux); step('waterMain', water); step('exchangeMain', exchange); step('carryMain', carry);
      step('thermalMain', thermalA); step('thermalMain', thermalB);
    }
    step('settleMain', thermalA);   // s0 -> s1: what is still carried drops where it is
    step('thermalMain', thermalB); step('thermalMain', thermalA); step('thermalMain', thermalB); step('thermalMain', thermalA);   // s1 -> s0 -> s1 -> s0 -> s1
    pass.end();
    // H5: the data maps (engine-weather.wgsl), one more pass over the final state, when the request asks for them.
    let mapBuffers = null, mapParams = null, authoredBuffer = null;
    if (request.maps) {
      const mp = await this.mapsPipeline();
      authoredBuffer = make('erosion authored', n * 4); device.queue.writeBuffer(authoredBuffer, 0, request.height);
      mapParams = make('erosion map params', 32, GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST);
      device.queue.writeBuffer(mapParams, 0, new Float32Array([grid, spacing, .36 / (age * BASE_RAIN), request.sand ?? 0, request.wetReach ?? 3, request.talusFull ?? 2.5, request.wearFull ?? 6, request.flowK ?? 4]));
      mapBuffers = [0, 1, 2].map(k => make('erosion map ' + k, n * 4, GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC));
      const mapGroup = device.createBindGroup({layout: mp.layout, entries: [mapParams, s1, acc, fixedBuffer, authoredBuffer, ...mapBuffers].map((b, binding) => ({binding, resource: {buffer: b}}))});
      const second = encoder.beginComputePass({label: 'erosion maps'});
      second.setPipeline(mp.pipeline); second.setBindGroup(0, group0); second.setBindGroup(1, mapGroup); second.dispatchWorkgroups(groups, groups); second.end();
    }
    const read = [make('erosion read state', n * 16, GPUBufferUsage.MAP_READ | GPUBufferUsage.COPY_DST), make('erosion read totals', n * 16, GPUBufferUsage.MAP_READ | GPUBufferUsage.COPY_DST), make('erosion read fixed', n * 16, GPUBufferUsage.MAP_READ | GPUBufferUsage.COPY_DST)];
    encoder.copyBufferToBuffer(s1, 0, read[0], 0, n * 16);
    encoder.copyBufferToBuffer(acc, 0, read[1], 0, n * 16);
    encoder.copyBufferToBuffer(fixedBuffer, 0, read[2], 0, n * 16);
    const mapRead = mapBuffers?.map(b => make('erosion read map', n * 4, GPUBufferUsage.MAP_READ | GPUBufferUsage.COPY_DST));
    mapBuffers?.forEach((b, k) => encoder.copyBufferToBuffer(b, 0, mapRead[k], 0, n * 4));
    const tSubmit = performance.now();
    device.queue.submit([encoder.finish()]);
    await device.queue.onSubmittedWorkDone();
    const tGpu = performance.now() - tSubmit, tMap0 = performance.now();
    await Promise.all([...read, ...(mapRead || [])].map(b => b.mapAsync(GPUMapMode.READ)));
    const maps = mapRead?.map(b => new Uint8Array(b.getMappedRange().slice(0)));
    mapRead?.forEach(b => b.destroy()); [...(mapBuffers || []), mapParams, authoredBuffer].forEach(b => b?.destroy());
    const st = new Float32Array(read[0].getMappedRange().slice(0)), at = new Float32Array(read[1].getMappedRange().slice(0)), fx = new Float32Array(read[2].getMappedRange().slice(0));
    read.forEach(b => b.destroy()); [...state, fluxA, fluxB, vel, acc, fixedBuffer, paramBuffer, tileBuffer].forEach(b => b?.destroy());
    const tRead = performance.now() - tMap0, tPost0 = performance.now();
    const height = new Float32Array(n), flow = new Float32Array(n), deposit = new Float32Array(n), debris = new Float32Array(n);
    // The worker's flow is droplets passed, about .36 per sample of rain-catching area; ours is the throughput in catchment samples.
    const flowScale = .36 / (age * rain);
    for (let i = 0; i < n; i++) {
      height[i] = st[i * 4] + st[i * 4 + 1]; debris[i] = st[i * 4 + 1];
      flow[i] = at[i * 4] * flowScale; deposit[i] = at[i * 4 + 1];
      if (!Number.isFinite(height[i])) throw new Error('nanolathe: erosion produced a non-finite height');
    }
    // offset: the column offset each sample read (columnOffset), kept so a review can place the beds on the profile.
    const offset = new Float32Array(n);
    for (let i = 0; i < n; i++) offset[i] = fx[i * 4 + 3];
    return {height, flow, deposit, debris, offset, maps, milliseconds: performance.now() - started, parts: {backlog: tBacklog, tiles: tileCount, fixedField: tFixed, gpu: tGpu, readback: tRead, post: performance.now() - tPost0}};
  }
}

// H6b: the renderer's erosion instance, built on first use as TerrainRenderer.erode does (Green's engine steps over active tiles).
export async function erosionOf(renderer) {
  if (!renderer.erosion) {
    const source = await (await fetch('/engine-erosion.wgsl')).text();
    renderer.erosion ??= new GpuErosion(renderer, renderer.preprocessShader(source), true);
  }
  return renderer.erosion;
}
