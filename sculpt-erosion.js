// H2: the GPU erosion pass (erosion.wgsl), run on the renderer's
// device (knob erosion 1; 0 is Weathering off). Its contract: the same mobility and lower/upper bounds (derived below from the
// same slope rules, at the worker's own largest budget), no change to submerged samples
// or to protected ones, and a height between sea -90 and sea +300. The worker then runs
// with the height this returns, so the apron, sand and material field are as before.
// Authoring prototype, not retail rules.

import {feedPasses, feedUniform} from './sculpt-gpu-fields.js';

const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
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
export class GpuErosion {
  constructor(renderer, source) {
    this.renderer = renderer;
    const device = this.device = renderer.device;
    const module = device.createShaderModule({label: 'erosion', code: source});
    this.ready = module.getCompilationInfo().then(info => {
      const errors = info.messages.filter(m => m.type === 'error');
      if (errors.length) throw new Error('nanolathe: engine-erosion.wgsl does not compile:\n' + errors.map(e => `${e.lineNum}:${e.linePos} ${e.message}`).join('\n'));
      const C = GPUShaderStage.COMPUTE;
      const buffer = type => ({visibility: C, buffer: {type}});
      this.layout1 = device.createBindGroupLayout({label: 'erosion', entries: [{binding: 0, ...buffer('uniform')}, {binding: 1, ...buffer('read-only-storage')}, {binding: 2, ...buffer('storage')},
        {binding: 3, ...buffer('read-only-storage')}, {binding: 4, ...buffer('storage')}, {binding: 5, ...buffer('storage')}, {binding: 6, ...buffer('storage')}, {binding: 7, ...buffer('storage')}, {binding: 8, ...buffer('read-only-storage')}]});
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
    const layout = device.createBindGroupLayout({label: 'engine-weather', entries: [buffer('uniform', 0), ...[1, 2, 3, 4].map(b => buffer('read-only-storage', b)), ...[5, 6, 7].map(b => buffer('storage', b)), buffer('read-only-storage', 8)]});   // 8: the drainage plane
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
    const releaseDrainage = request.drainage?.lease?.() ?? (() => {});   // P21: the plane is held until this pass's work is submitted
    try {
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
      // With no rainfall, seedMain starts water/sediment/flux at zero and these
      // four passes preserve zero. Thermal relaxation remains unchanged.
      if (rain !== 0) { step('fluxMain', flux); step('waterMain', water); step('exchangeMain', exchange); step('carryMain', carry); }
      step('thermalMain', thermalA); step('thermalMain', thermalB);
    }
    step('settleMain', thermalA);
    step('thermalMain', thermalB); step('thermalMain', thermalA); step('thermalMain', thermalB); step('thermalMain', thermalA);
    pass.end();
    const output = encoder.beginComputePass({label: 'time pass output'});
    output.setPipeline(feed.pipes.refinedMain); for (const [g, bg] of feed.groups('refinedMain', res)) output.setBindGroup(g, bg); output.dispatchWorkgroups(groups, groups);
    output.end();
    const mapParams = make('erosion map params', 64, GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST);
    const plane = request.drainage, noPlane = plane ? null : make('no drainage plane', 16);
    device.queue.writeBuffer(mapParams, 0, new Float32Array([grid, spacing, .36 / (age * BASE_RAIN), request.sand ?? 0, request.wetReach ?? 3, request.talusFull ?? 2.5, request.wearFull ?? 6, request.flowK ?? 4,
      request.ox ?? 0, request.oy ?? 0, plane ? plane.width : 0, plane ? plane.step : 1, 0, 0, 0, 0]));
    const mapGroup = device.createBindGroup({layout: mp.layout, entries: [{buffer: mapParams}, {buffer: s1}, {buffer: acc}, {buffer: fixedBuffer}, {buffer: weather, offset: 0, size: n * 4}, ...maps.map(buffer => ({buffer})), {buffer: plane ? plane.buffer : noPlane}].map((resource, binding) => ({binding, resource}))});
    const second = encoder.beginComputePass({label: 'erosion maps'});
    second.setPipeline(mp.pipeline); second.setBindGroup(0, group0); second.setBindGroup(1, mapGroup); second.dispatchWorkgroups(groups, groups); second.end();
    const tSubmit = performance.now();
    device.queue.submit([encoder.finish()]);
    releaseDrainage();
    await device.queue.onSubmittedWorkDone();
    const gpu = performance.now() - tSubmit;
    [...state, fluxA, fluxB, vel, acc, fixedBuffer, paramBuffer, tileFlag, tileList, tileCount, tileArgs, mapParams, uniform, ...(noPlane ? [noPlane] : [])].forEach(b => b.destroy());
    return {weather, maps, grid, bytes: n * 8 + n * 12, milliseconds: performance.now() - started, parts: {gpu, tiles: null, gpuFed: true}};
    } finally { releaseDrainage(); }
  }

  // The material field (engine-weather.wgsl mf*): arrival, soil, softened source and source a cell, as a GPU buffer of vec4f that the chunk feed
  // writes into gridTexture layer 1. It reads a height already on the GPU (the Time pass's eroded plane: `heightBuffer`, `heightOffset` cells in)
  // and never comes back to the CPU. {ox, oy} is the window's first lattice cell, so that pages of one map join. The caller owns the buffer.
  async materialField({heightBuffer, heightOffset = 0, grid, size, ox = 0, oy = 0, seaLevel = 0, baseHeight = 24, seed = 1, depositSpread = .65, profile = {}}) {
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
    const heightBuf = make(n * 4);
    const [source, gx, gy, basin, deposit, flow, a, b, c, soft, settled, broad, runoff] = Array.from({length: 13}, () => make(n * 4)), field = device.createBuffer({label: 'material field', size: n * 16, usage: S});
    const mineral = profile.mineral === true, elevated = profile.elevatedCover || [0, 30, 0];
    const uniform = (sigma, axis) => {
      const buf = make(80, GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST), view = new DataView(new ArrayBuffer(80));
      [grid, spacing, seaLevel, baseHeight, spread].forEach((v, i) => view.setFloat32(i * 4, v, true));
      view.setUint32(20, seed >>> 0, true); view.setUint32(24, n, true);
      [profile.rockyCoasts ? 1 : 0, mineral ? 1 : 0, elevated[0], elevated[1], elevated[2], profile.transportSlopeStart ?? (mineral ? .07 : .60), profile.transportSlopeFull ?? (mineral ? .55 : 1.35), sigma, axis, ox, oy]
        .forEach((v, i) => view.setFloat32(28 + i * 4, v, true));
      device.queue.writeBuffer(buf, 0, view.buffer); return buf;
    };
    const encoder = device.createCommandEncoder({label: 'material field'});
    encoder.copyBufferToBuffer(heightBuffer, heightOffset * 4, heightBuf, 0, n * 4);
    const run = (pipeline, ids, bufs, uni, groups) => {
      const pass = encoder.beginComputePass();
      pass.setPipeline(pipeline);
      pass.setBindGroup(2, device.createBindGroup({layout: pipeline.getBindGroupLayout(2), entries: [{binding: 0, resource: {buffer: uni}}, ...ids.map((binding, k) => ({binding, resource: {buffer: bufs[k]}}))]}));
      pass.dispatchWorkgroups(...groups); pass.end();
    };
    const tiles = Math.ceil(grid / 8), u0 = uniform(0, 0);
    run(P.source, [1, 2, 3, 4, 5], [heightBuf, source, gx, gy, basin], u0, [tiles, tiles]);
    run(P.drops, [1, 2, 3, 4, 6, 7], [heightBuf, source, gx, gy, deposit, flow], u0, [Math.ceil(n / 64)]);
    const blur = (input, output, sigma) => {
      run(P.blur, [8, 9], [input, c], uniform(sigma, 0), [tiles, tiles]);
      run(P.blur, [8, 9], [c, output], uniform(sigma, 1), [tiles, tiles]);
    };
    run(P.counts, [6, 7, 9], [deposit, flow, a], uniform(0, 1), [tiles, tiles]);
    run(P.counts, [6, 7, 9], [deposit, flow, b], uniform(0, 2), [tiles, tiles]);
    blur(source, soft, 9 + spread * 17); blur(a, settled, 2.6); blur(a, broad, 9); blur(b, runoff, 3.5);
    run(P.combine, [1, 2, 5, 10, 11, 12, 13, 14], [heightBuf, source, basin, field, settled, broad, runoff, soft], u0, [tiles, tiles]);
    device.queue.submit([encoder.finish()]);
    made.forEach(buf => buf.destroy());   // destroyed buffers wait for the submitted work
    return field;
  }
}

// H6b: the renderer's erosion instance, built on first use (Green's engine steps over active tiles).
export async function erosionOf(renderer) {
  if (!renderer.erosion) {
    const source = await (await fetch('/engine-erosion.wgsl')).text();
    renderer.erosion ??= new GpuErosion(renderer, renderer.preprocessShader(source), true);
  }
  return renderer.erosion;
}
