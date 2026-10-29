// H2: the GPU erosion pass (erosion.wgsl) for the 1024-px study, run on the renderer's
// device in place of the droplet loop of sculpt-weathering.js (knob erosion 1). It keeps
// that worker's contract: the same mobility and lower/upper bounds (derived below from the
// same slope rules, at the worker's own largest budget), no change to submerged samples
// or to protected ones, and a height between sea -90 and sea +300. The worker then runs
// with the height this returns, so the apron, sand and material field are as before.
// Authoring prototype, not retail rules.

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
function fixedField({height, protect, grid, size, seaLevel}) {
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
    // A coast is authored (water strokes) and a gentle shore moves its waterline far for a little height: within 20 units of the
    // sea the budget is the worker's own .35 (a dry sample stays dry), rising to BUDGET above that.
    const budget = SHORE_BUDGET + (BUDGET - SHORE_BUDGET) * smooth(seaLevel + 2, seaLevel + 20, h);
    out[i * 4] = Math.max(MIN, Math.min(h, seaLevel + 1), h - (4 + 8 * steep) * budget * weight);
    out[i * 4 + 1] = Math.min(MAX, h + (2.5 + 2.5 * steep) * budget * weight);
    out[i * 4 + 2] = weight;
  }
  return out;
}

export class GpuErosion {
  constructor(renderer, source) {
    this.renderer = renderer;
    const device = this.device = renderer.device;
    const module = device.createShaderModule({label: 'erosion', code: source});
    this.ready = module.getCompilationInfo().then(info => {
      const errors = info.messages.filter(m => m.type === 'error');
      if (errors.length) throw new Error('nanolathe: erosion.wgsl does not compile:\n' + errors.map(e => `${e.lineNum}:${e.linePos} ${e.message}`).join('\n'));
      const C = GPUShaderStage.COMPUTE;
      const buffer = type => ({visibility: C, buffer: {type}});
      this.layout1 = device.createBindGroupLayout({label: 'erosion', entries: [{binding: 0, ...buffer('uniform')}, {binding: 1, ...buffer('read-only-storage')}, {binding: 2, ...buffer('storage')},
        {binding: 3, ...buffer('read-only-storage')}, {binding: 4, ...buffer('storage')}, {binding: 5, ...buffer('storage')}, {binding: 6, ...buffer('storage')}, {binding: 7, ...buffer('storage')}]});
      this.layout0 = device.createBindGroupLayout({label: 'erosion u', entries: [{binding: 0, ...buffer('uniform')}]});
      const layout = device.createPipelineLayout({bindGroupLayouts: [this.layout0, this.layout1]});
      this.pipelines = {};
      return Promise.all(['offsetMain', 'fluxMain', 'waterMain', 'exchangeMain', 'settleMain', 'carryMain', 'thermalMain'].map(async entry =>
        { this.pipelines[entry] = await device.createComputePipelineAsync({label: entry, layout, compute: {module, entryPoint: entry}}); }));
    });
  }

  // request: {height, protect, grid, size, seaLevel, age, rain, talusAngle}. Returns the eroded height (rock + debris), the
  // water throughput scaled like the worker's flow, the material deposited, the loose debris and the milliseconds spent.
  async run(request) {
    await this.ready;
    const {device} = this, {grid, size, seaLevel} = request, n = grid * grid, spacing = (size - 1) / (grid - 1);
    const age = Math.max(1, Math.round(request.age)), rain = BASE_RAIN * request.rain, started = performance.now();
    const talus = Math.tan(request.talusAngle * Math.PI / 180);
    const params = new Float32Array([grid, spacing, rain, K_FLUX, DAMP, K_CAP, K_DISSOLVE, K_DEPOSIT, EVAPORATION, WET_FULL,
      this.renderer.variantNumber('columnContrast', 1), ROCK_WEAR, talus, Math.min(request.talusAngle + SOFT_EXTRA, 85) * Math.PI / 180, HARD_ANGLE * Math.PI / 180, THERMAL]);
    const fixed = fixedField(request);
    const S = GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC | GPUBufferUsage.COPY_DST;
    const make = (label, bytes, usage = S) => device.createBuffer({label, size: bytes, usage});
    const state = [0, 1, 2].map(k => make('erosion state ' + k, n * 16));
    const fluxA = make('erosion flux a', n * 16), fluxB = make('erosion flux b', n * 16), vel = make('erosion velocity', n * 8), acc = make('erosion totals', n * 16);
    const fixedBuffer = make('erosion fixed', n * 16), paramBuffer = make('erosion params', 64, GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST);
    const initial = new Float32Array(n * 4);
    for (let i = 0; i < n; i++) initial[i * 4] = request.height[i];
    device.queue.writeBuffer(state[0], 0, initial);
    device.queue.writeBuffer(fixedBuffer, 0, fixed);
    device.queue.writeBuffer(paramBuffer, 0, params);
    for (const b of [state[1], state[2], fluxA, fluxB, vel, acc]) device.queue.writeBuffer(b, 0, new Float32Array(b.size / 4));
    this.renderer.setColumn();
    this.renderer.flushUniforms();
    const group1 = (src, dst, fIn, fOut) => device.createBindGroup({layout: this.layout1, entries: [{binding: 0, resource: {buffer: paramBuffer}},
      {binding: 1, resource: {buffer: src}}, {binding: 2, resource: {buffer: dst}}, {binding: 3, resource: {buffer: fIn}}, {binding: 4, resource: {buffer: fOut}},
      {binding: 5, resource: {buffer: vel}}, {binding: 6, resource: {buffer: acc}}, {binding: 7, resource: {buffer: fixedBuffer}}]});
    const group0 = device.createBindGroup({layout: this.layout0, entries: [{binding: 0, resource: {buffer: this.renderer.uniformBuffer}}]});
    const [s0, s1, s2] = state;
    const flux = group1(s0, s1, fluxA, fluxB), water = group1(s0, s2, fluxB, fluxA), exchange = group1(s2, s1, fluxA, fluxB), carry = group1(s1, s0, fluxA, fluxB);
    const thermalA = group1(s0, s1, fluxA, fluxB), thermalB = group1(s1, s0, fluxA, fluxB);
    const groups = Math.ceil(grid / 8), encoder = device.createCommandEncoder({label: 'erosion'}), pass = encoder.beginComputePass({label: 'erosion'});
    const step = (entry, group) => { pass.setPipeline(this.pipelines[entry]); pass.setBindGroup(0, group0); pass.setBindGroup(1, group); pass.dispatchWorkgroups(groups, groups); };
    step('offsetMain', flux);
    for (let it = 0; it < age; it++) {
      step('fluxMain', flux); step('waterMain', water); step('exchangeMain', exchange); step('carryMain', carry);
      step('thermalMain', thermalA); step('thermalMain', thermalB);
    }
    step('settleMain', thermalA);   // s0 -> s1: what is still carried drops where it is
    step('thermalMain', thermalB); step('thermalMain', thermalA); step('thermalMain', thermalB); step('thermalMain', thermalA);   // s1 -> s0 -> s1 -> s0 -> s1
    pass.end();
    const read = [make('erosion read state', n * 16, GPUBufferUsage.MAP_READ | GPUBufferUsage.COPY_DST), make('erosion read totals', n * 16, GPUBufferUsage.MAP_READ | GPUBufferUsage.COPY_DST), make('erosion read fixed', n * 16, GPUBufferUsage.MAP_READ | GPUBufferUsage.COPY_DST)];
    encoder.copyBufferToBuffer(s1, 0, read[0], 0, n * 16);
    encoder.copyBufferToBuffer(acc, 0, read[1], 0, n * 16);
    encoder.copyBufferToBuffer(fixedBuffer, 0, read[2], 0, n * 16);
    device.queue.submit([encoder.finish()]);
    await Promise.all(read.map(b => b.mapAsync(GPUMapMode.READ)));
    const st = new Float32Array(read[0].getMappedRange().slice(0)), at = new Float32Array(read[1].getMappedRange().slice(0)), fx = new Float32Array(read[2].getMappedRange().slice(0));
    read.forEach(b => b.destroy()); [...state, fluxA, fluxB, vel, acc, fixedBuffer, paramBuffer].forEach(b => b.destroy());
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
    return {height, flow, deposit, debris, offset, milliseconds: performance.now() - started};
  }
}
