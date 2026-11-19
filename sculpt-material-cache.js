// The GPU side of materials (sculpt-materials.js): each material in use has one layer of a cached repeat holding its unlit color and shine
// (half floats), one of its art height (a full float: relief is lit from its differences), one more layer of each for each state it draws (Worn,
// Deposit), a layer of that color reduced to its game-palette colors, and one texel of its mean color. A graph is compiled to a
// pipeline once per shape; its numbers are a buffer upload. A palette-only edit redoes the reduction, not the fields.
// Pipelines are compiled asynchronously (createComputePipelineAsync): a large graph takes seconds to compile, and a synchronous compile held
// the GPU queue, so the map stopped drawing at every wire edit. Until a layer's new pipeline is ready the layer keeps the picture it has, and
// the draws that must not use an old picture wait for it (TerrainRenderer.materialsReady).
import {MATERIAL_SLOTS, materialColor, compileMaterial, PROGRAM_BYTES, STEP_STRIDE, MAX_NODES, MAX_STAGES, materialRenderKey, programKey, programSource, stagePlan, materialCacheUsage, paletteRgb, THUMB, THUMB_STRIDE, materialStates, MATERIAL_STATES} from './sculpt-materials.js';

const SCRATCH_ROW = MATERIAL_SLOTS;   // the materialGraphs row a thumbnail run borrows (after one a slot)
// A slot's row of the uniform table: its palette and how the reduction treats it.
export function writeMaterialSlot(r, material, view, at) {
  const members = r.uniform.get('ground').members, d = material.dither, reduce = material.palette.length >= 2;
  const set = (key, value, int = false) => int ? view.setInt32(at + members.get(key).offset, value, true) : view.setFloat32(at + members.get(key).offset, value, true);
  set('paletteCount', material.palette.length, true); set('dither', reduce ? d.amount : 0); set('spread', d.spread); set('tone', d.tone);
  [d.red, d.green, d.blue].forEach((v, c) => view.setFloat32(at + members.get('weights').offset + c * 4, v, true));
  const out = material.nodes.find(n => n.type === 'output').params;
  [out.wornFrom, out.wornAmount, out.depositFrom, out.depositAmount].forEach((v, c) => view.setFloat32(at + members.get('states').offset + c * 4, v, true));
  view.setFloat32(at + members.get('finish').offset, material.nodes.find(n => n.type === 'output').in.height ? out.relief : 0, true);
  material.palette.forEach((index, k) => paletteRgb(index).forEach((v, c) => view.setFloat32(at + members.get('palette').offset + k * 16 + c * 4, v / 255, true)));
}
function writeProgram(view, at, program) {
  view.setInt32(at, program.instructions.length, true);
  program.instructions.forEach((step, i) => {
    const base = at + 16 + i * STEP_STRIDE;
    [...step.code, ...step.links.slice(0, 4)].forEach((v, j) => view.setInt32(base + j * 4, v, true));
    step.args.forEach((v, j) => view.setFloat32(base + 32 + j * 4, v, true));
  });
}
export class MaterialCache {
  constructor(renderer, source, reduceSource) {
    this.renderer = renderer; this.source = source; this.reduceSource = reduceSource;
    this.pipelines = new Map(); this.keys = new Map(); this.colorKeys = new Map(); this.layers = []; this.pool = 0; this.generations = 0;
    this.waiting = new Set();   // the compiles the current materials wait for (their pipelines' entries)
    this.programBuffer = renderer.device.createBuffer({label: 'material graphs', size: PROGRAM_BYTES * (SCRATCH_ROW + 1), usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST});
    renderer.track?.(this.programBuffer, 'material graphs', this.programBuffer.size, 'materials');
    renderer.worldResource?.(this.programBuffer);   // the cache is world data: each write bumps the world version in the tile input checksum
    this.allocate(1, 1);
  }
  texture(old, label, size, format, usage, bytes) {
    const r = this.renderer;
    if (old) { if (r.release) r.release(old); else old.destroy(); }
    const texture = r.device.createTexture({label, size, format, usage});
    r.track?.(texture, label, bytes, 'materials'); return texture;
  }
  allocate(pool, count) {
    const r = this.renderer, read = GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.STORAGE_BINDING;
    this.fieldTexture = this.texture(this.fieldTexture, 'material color and shine', [pool, pool, count], 'rgba16float', read, pool * pool * count * 8);
    this.heightTexture = this.texture(this.heightTexture, 'material art height', [pool, pool, count], 'r32float', read, pool * pool * count * 4);
    this.colorTexture = this.texture(this.colorTexture, 'material palette color', [pool, pool, count], 'rgba8unorm', read, pool * pool * count * 4);
    this.meanTexture = this.texture(this.meanTexture, 'material mean color', [1, 1, count], 'rgba32float', read | GPUTextureUsage.COPY_SRC, count * 16);
    for (const t of [this.fieldTexture, this.heightTexture, this.colorTexture, this.meanTexture]) r.worldResource?.(t);
    if (r.resources) r.fixedBytes = [...r.resources.values()].filter(v => v.kind === 'materials' || v.kind === 'shared').reduce((n, v) => n + v.bytes, 0);
    r.bindGroups = {}; this.keys.clear(); this.colorKeys.clear(); this.synced = null;
  }
  // A compiled pipeline (or set of them) by id: {ready, failed, promise}. The compile starts on first use; ready holds the result once it is
  // done, failed its error. At most 24 are kept; an entry still compiling is never the one let go.
  compile(id, make) {
    let e = this.pipelines.get(id);
    if (e) { this.pipelines.delete(id); this.pipelines.set(id, e); return e; }
    e = {ready: null, failed: null, promise: null};
    e.promise = Promise.resolve().then(make).then(ready => { e.ready = ready; }, error => { e.failed = error; console.error(error); });
    this.pipelines.set(id, e);
    for (const [key, held] of this.pipelines) { if (this.pipelines.size <= 24) break; if (held.ready || held.failed) this.pipelines.delete(key); }
    return e;
  }
  pipeline(program, thumbnails = false) {
    return this.compile((thumbnails ? 'thumbnails ' : '') + programKey(program), () => {
      const {taps, main} = programSource(program, thumbnails), r = this.renderer;
      const code = this.source.replace('/*MATERIAL_TAPS*/', taps).replace('/*MATERIAL_MAIN*/', main);
      return r.device.createComputePipelineAsync({label: 'material graph', layout: 'auto', compute: {module: r.device.createShaderModule({label: 'material graph', code}), entryPoint: thumbnails ? 'thumbMain' : 'groundMain'}});
    });
  }
  // Stages (sculpt-materials.js stagePlan): one layer a staged node (Blur or Slope blur) for what the later passes read, and two scratch
  // layers (a stage's inputs, then a blur's first direction). Made the first time a material in use has one, at the repeat's size; materials
  // share them, since each material's stages run just before its own pass.
  stageTextures(size) {
    if (this.stageSize === size) return;
    const usage = GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.STORAGE_BINDING;
    this.stageTexture = this.texture(this.stageTexture, 'material blur stages', [size, size, MAX_STAGES], 'rgba32float', usage, size * size * MAX_STAGES * 16);
    this.scratchTexture = this.texture(this.scratchTexture, 'material blur scratch', [size, size, 2], 'rgba32float', usage, size * size * 2 * 16);
    const r = this.renderer; if (r.resources) r.fixedBytes = [...r.resources.values()].filter(v => v.kind === 'materials' || v.kind === 'shared').reduce((n, v) => n + v.bytes, 0);
    this.stageSize = size;
  }
  // Once no material in use has a staged node, the stage textures go; the next one that needs them makes them again.
  releaseStages() {
    if (!this.stageTexture) return;
    const r = this.renderer;
    for (const texture of [this.stageTexture, this.scratchTexture]) { if (r.release) r.release(texture); else texture.destroy(); }
    this.stageTexture = this.scratchTexture = null; this.stageSize = 0;
    if (r.resources) r.fixedBytes = [...r.resources.values()].filter(v => v.kind === 'materials' || v.kind === 'shared').reduce((n, v) => n + v.bytes, 0);
  }
  stagePipelines(program) {
    return this.compile('stages ' + programKey(program), async () => {
      const {taps, stages} = programSource(program), r = this.renderer, plan = stagePlan(program);
      const module = r.device.createShaderModule({label: 'material blur stages', code: this.source.replace('/*MATERIAL_TAPS*/', taps).replace('/*MATERIAL_MAIN*/', stages)});
      const make = entryPoint => r.device.createComputePipelineAsync({label: 'material ' + entryPoint, layout: 'auto', compute: {module, entryPoint}});
      const [blur, slope, line, ...staged] = await Promise.all([make('blurPass'), make('slopePass'), make('dirPass'), ...plan.stages.map((_, k) => make('stage' + k))]);
      return {stages: staged, blur, slope, line};
    });
  }
  // The pipelines a program's pass needs, from compile(): main and, with staged nodes, its stages ({ready: {main, stages}} once both are).
  passPipelines(program) {
    const main = this.pipeline(program), stages = stagePlan(program).stages.length ? this.stagePipelines(program) : null;
    return {failed: main.failed || stages?.failed || null, ready: main.ready && (!stages || stages.ready) ? {main: main.ready, stages: stages?.ready ?? null} : null, entries: [main, stages].filter(Boolean)};
  }
  // A program's stages into `encoder`, before its own pass: each staged node's inputs over the whole repeat, then its pass into its layer
  // (a Blur across and down or a Slope blur along its slope).
  runStages(encoder, program, row, size, buffers, pipelines) {
    const plan = stagePlan(program); if (!plan.stages.length) return;
    this.stageTextures(size);
    const device = this.renderer.device, {stages, blur, slope, line} = pipelines, groups = Math.ceil(size / 8);
    const job = values => { const b = device.createBuffer({size: 16, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST}); buffers.push(b); device.queue.writeBuffer(b, 0, new Uint32Array(values)); return b; };
    const layer = (texture, k) => texture.createView({dimension: '2d', baseArrayLayer: k, arrayLayerCount: 1});
    const graphs = pipeline => device.createBindGroup({layout: pipeline.getBindGroupLayout(0), entries: [{binding: 15, resource: {buffer: this.programBuffer}}]});
    const run = (pipeline, entries) => { const pass = encoder.beginComputePass({label: 'material blur stage'}); pass.setPipeline(pipeline); pass.setBindGroup(0, graphs(pipeline)); pass.setBindGroup(1, device.createBindGroup({layout: pipeline.getBindGroupLayout(1), entries})); pass.dispatchWorkgroups(groups, groups); pass.end(); };
    plan.stages.forEach(({step, type, kind}, k) => {
      run(stages[k], [{binding: 1, resource: {buffer: job([0, 0, row, 0])}}, {binding: 4, resource: layer(this.scratchTexture, 0)},
        ...(plan.stageReads[k] ? [{binding: 3, resource: this.stageTexture.createView({dimension: '2d-array'})}] : [])]);
      if (type === 'blur' && kind === 'directional') { run(line, [{binding: 1, resource: {buffer: job([0, 0, row, step])}}, {binding: 5, resource: layer(this.scratchTexture, 0)}, {binding: 4, resource: layer(this.stageTexture, k)}]); return; }
      if (type === 'slopeblur') { run(slope, [{binding: 1, resource: {buffer: job([0, 0, row, step])}}, {binding: 5, resource: layer(this.scratchTexture, 0)}, {binding: 4, resource: layer(this.stageTexture, k)}]); return; }
      run(blur, [{binding: 1, resource: {buffer: job([0, 0, row, step])}}, {binding: 5, resource: layer(this.scratchTexture, 0)}, {binding: 4, resource: layer(this.scratchTexture, 1)}]);
      run(blur, [{binding: 1, resource: {buffer: job([1, 0, row, step])}}, {binding: 5, resource: layer(this.scratchTexture, 1)}, {binding: 4, resource: layer(this.stageTexture, k)}]);
    });
  }
  // The cache's shape for these materials (a Map of slot to material): which layer each slot reads. No GPU work is submitted.
  prepare(pool, materials) {
    // One layer a slot's color, then one a state it draws; the slot's graph is one program row, which its state layers share.
    const slots = [...materials.keys()].sort((a, b) => a - b), layers = slots.flatMap(slot => [`${slot}`, ...materialStates(materials.get(slot)).map(k => `${slot}:${k}`)]);
    const programs = new Map([...materials].map(([slot, m]) => [slot, compileMaterial(m)])), staged = [...programs.values()].some(p => stagePlan(p).stages.length);
    const usage = materialCacheUsage(layers.length, pool, staged);
    if (!usage.fits) throw Error(`These materials need ${(usage.bytes / 1048576).toFixed(0)} MiB; the cache budget is ${usage.budget / 1048576} MiB. Use fewer materials or fewer Worn and Deposit colors.`);
    if (this.pool !== pool || String(this.layers) !== String(layers)) { this.allocate(layers.length ? pool : 1, Math.max(1, layers.length)); this.pool = pool; this.layers = layers; }
    const r = this.renderer, table = r.uniform.get('ground'), set = (slot, key, v) => r.uniformView.setInt32(table.offset + slot * table.stride + table.members.get(key).offset, v, true);
    for (let slot = 0; slot < table.count; slot++) {
      for (const key of ['cacheLayer', 'colorLayer']) set(slot, key, layers.indexOf(`${slot}`));
      for (const k of MATERIAL_STATES) set(slot, k + 'Layer', layers.indexOf(`${slot}:${k}`));
    }
    this.entries = layers.map((key, layer) => {
      const [slot, state = null] = key.split(':'), s = Number(slot);
      return {slot: s, state, stateCode: state ? MATERIAL_STATES.indexOf(state) + 1 : 0, row: slots.indexOf(s), layer, material: materials.get(s), program: programs.get(s)};
    });
    if (!staged) this.releaseStages();
  }
  // Generates what changed. Called inside the draw cycle, so a fast drag never queues more than one run a frame.
  // Every tile draw and color batch calls it: the same materials (the renderer's list is replaced, never changed in place, by setMaterials)
  // at the same pool on an unchanged cache have nothing to generate, so that call returns at once (0.4-0.5 ms a call with Green's 12).
  // A layer whose pipeline is still compiling is left as it is (its key is not set) and generated by the first sync after the compile; a
  // compile that ends clears `synced` and tells the renderer (onmaterials), whose next draw comes here again.
  sync(pool, materials) {
    if (this.synced === materials && this.pool === pool) return;
    this.prepare(pool, materials);
    // One program row a material (e.row), which its Worn and Deposit layers share: the upload is sized by rows, not by cache layers.
    const rows = this.entries.reduce((n, e) => Math.max(n, e.row + 1), 1);
    const r = this.renderer, device = r.device, data = new ArrayBuffer(PROGRAM_BYTES * rows), view = new DataView(data), changed = [], waiting = new Set(), blank = new Set();
    for (const e of this.entries) {
      if (!e.state) writeProgram(view, e.row * PROGRAM_BYTES, e.program);
      const key = JSON.stringify(e.program.instructions.map(i => [i.code, i.links, i.args]));
      if (this.keys.get(e.layer) === key) continue;
      const pipelines = this.passPipelines(e.program);
      if (pipelines.failed) continue;   // the layer keeps what it holds
      if (!pipelines.ready) { for (const entry of pipelines.entries) if (!entry.ready && !entry.failed) { waiting.add(entry); if (!this.keys.has(e.layer)) blank.add(entry); } continue; }
      changed.push([e, key, pipelines.ready]);
    }
    if (changed.length) {
      r.worldResource?.(this.programBuffer);
      device.queue.writeBuffer(this.programBuffer, 0, data);
      const encoder = device.createCommandEncoder({label: 'material graphs'}), buffers = [];
      for (const [e, key, {main: pipeline, stages}] of changed) {
        const job = device.createBuffer({size: 16, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST}); buffers.push(job);
        device.queue.writeBuffer(job, 0, new Uint32Array([e.slot, e.layer, e.row, e.stateCode]));
        this.runStages(encoder, e.program, e.row, pool, buffers, stages);
        const pass = encoder.beginComputePass({label: 'material graph'}); pass.setPipeline(pipeline);
        pass.setBindGroup(0, device.createBindGroup({layout: pipeline.getBindGroupLayout(0), entries: [{binding: 15, resource: {buffer: this.programBuffer}}]}));
        pass.setBindGroup(1, device.createBindGroup({layout: pipeline.getBindGroupLayout(1), entries: [
          {binding: 0, resource: this.fieldTexture.createView({dimension: '2d-array'})}, {binding: 1, resource: {buffer: job}}, {binding: 2, resource: this.heightTexture.createView({dimension: '2d-array'})},
          ...(stagePlan(e.program).mainReads ? [{binding: 3, resource: this.stageTexture.createView({dimension: '2d-array'})}] : [])]}));
        pass.dispatchWorkgroups(Math.ceil(pool / 8), Math.ceil(pool / 8)); pass.end();
        this.keys.set(e.layer, key); this.generations++;
      }
      device.queue.submit([encoder.finish()]); buffers.forEach(b => b.destroy());
    }
    this.reduce(pool, changed.map(([e]) => e.layer));
    if (changed.length) this.readMeans();
    this.wait(waiting); this.blank = blank;
    this.synced = materials;   // only once the whole sync ran: a throw leaves the next call to try again
  }
  // The compiles the current materials wait for. Each that ends clears `synced`, so the next sync generates what it can now, and tells the
  // renderer (onmaterials), which draws again; it is told as well when the waiting starts, so the export can say why it waits.
  wait(entries) {
    const before = this.waiting.size;
    this.waiting = entries;
    for (const e of entries) e.promise.then(() => {
      if (!this.waiting.has(e)) return;
      this.waiting.delete(e); this.synced = null;
      queueMicrotask(() => this.renderer.onmaterials?.(true));
    });
    if (!before && entries.size) queueMicrotask(() => this.renderer.onmaterials?.(false));
  }
  // Whether a layer the current materials need is still compiling; with `blank`, only one that holds no picture yet (a new layer, or every
  // layer after the cache was laid out again), which nothing may draw from.
  compiling(blank = false) { return blank ? [...this.blank ?? []].some(e => this.waiting.has(e)) : this.waiting.size > 0; }
  // Resolves when the compiles the current materials waited for have ended (finished or failed).
  compiled() { return Promise.allSettled([...this.waiting].map(e => e.promise)); }
  // The mean color each slot's material is drawn in, read back after a regeneration (the renderer's drawnMeans; the editor's color pickers
  // show it). Asynchronous: a read overtaken by a newer one is dropped.
  async readMeans() {
    const r = this.renderer, device = r.device, layers = [...this.layers], entries = this.entries.filter(e => !e.state), count = layers.length;
    if (!count || !r.drawnMeans) return;
    const ticket = this.meanTicket = (this.meanTicket ?? 0) + 1, buffer = device.createBuffer({label: 'material means read', size: 256 * count, usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ});
    const encoder = device.createCommandEncoder({label: 'material means read'});
    encoder.copyTextureToBuffer({texture: this.meanTexture}, {buffer, bytesPerRow: 256, rowsPerImage: 1}, [1, 1, count]); device.queue.submit([encoder.finish()]);
    try { await buffer.mapAsync(GPUMapMode.READ); } catch { buffer.destroy(); return; }
    const v = new Float32Array(buffer.getMappedRange().slice(0)); buffer.unmap(); buffer.destroy();
    if (ticket !== this.meanTicket || r.disposed) return;
    for (const e of entries) {
      const k = layers.indexOf(`${e.slot}`); if (k < 0) continue;
      const rgb = [v[64 * k], v[64 * k + 1], v[64 * k + 2]], own = materialColor(e.material);
      r.drawnMeans.set(e.slot, {key: materialRenderKey(e.material), rgb}); r.drawnBase.set(e.slot, rgb.map((c, i) => c - own[i]));
    }
    r.onmeans?.();
  }
  // The mean color of each regenerated material, and the palette reduction of each whose fields or palette changed.
  reduce(pool, regenerated) {
    const r = this.renderer, device = r.device;
    const stage = entryPoint => this[entryPoint] ??= device.createComputePipeline({label: entryPoint, layout: 'auto', compute: {module: this.reduceModule ??= device.createShaderModule({label: 'material reduction', code: this.reduceSource}), entryPoint}});
    const fields = this.fieldTexture.createView({dimension: '2d-array'});
    for (const e of this.entries) {
      const fresh = regenerated.includes(e.layer), key = materialRenderKey(e.material), reduces = e.material.palette.length >= 2 && e.material.dither.amount > 0;
      if (!fresh && (!reduces || this.colorKeys.get(e.layer) === key)) continue;
      r.uniformsDirty = true; r.flushUniforms(); r.worldResource?.(this.colorTexture);
      const encoder = device.createCommandEncoder({label: 'material reduction'}), jobs = [];
      const job = values => { const b = device.createBuffer({size: 16, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST}); jobs.push(b); device.queue.writeBuffer(b, 0, new Uint32Array(values)); return b; };
      if (fresh) {
        const pipeline = stage('meanMaterial'), pass = encoder.beginComputePass();
        pass.setPipeline(pipeline);
        pass.setBindGroup(0, device.createBindGroup({layout: pipeline.getBindGroupLayout(0), entries: [{binding: 13, resource: fields}]}));
        pass.setBindGroup(1, device.createBindGroup({layout: pipeline.getBindGroupLayout(1), entries: [{binding: 2, resource: {buffer: job([e.slot, e.layer, 0, 0])}}, {binding: 3, resource: this.meanTexture.createView({dimension: '2d-array'})}]}));
        pass.dispatchWorkgroups(1); pass.end();
      }
      let error = null;
      if (reduces) {
        const pipeline = stage('diffuseMaterial');
        // engine-ground-dither.wgsl: rows of the pool plus its WARM (64) wrapped columns and two borders. The first dispatch runs the repeat's
        // last 64 rows without writing (WARM_ROWS_FLAG), so row 0 starts with the error the repeat's last row leaves.
        error = device.createBuffer({label: 'material error rows', size: (pool + 64 + 2) * 129 * 16, usage: GPUBufferUsage.STORAGE});
        const common = device.createBindGroup({layout: pipeline.getBindGroupLayout(0), entries: [{binding: 0, resource: {buffer: r.uniformBuffer}}, {binding: 13, resource: fields}]});
        for (const [row, count] of [[pool - 64, 64 | 0x10000], ...Array.from({length: Math.ceil(pool / 128)}, (_, k) => [k * 128, 128])]) {
          const pass = encoder.beginComputePass(); pass.setPipeline(pipeline); pass.setBindGroup(0, common);
          pass.setBindGroup(1, device.createBindGroup({layout: pipeline.getBindGroupLayout(1), entries: [{binding: 0, resource: this.colorTexture.createView({dimension: '2d-array'})}, {binding: 1, resource: {buffer: error}}, {binding: 2, resource: {buffer: job([e.slot, e.layer, row, count])}}]}));
          pass.dispatchWorkgroups(1); pass.end();
        }
      }
      device.queue.submit([encoder.finish()]); error?.destroy(); jobs.forEach(b => b.destroy()); this.colorKeys.set(e.layer, key);
    }
  }
  // Every node's own output as a small picture (THUMB px, one layer a node in evaluation order), for the graph's cards and the Levels
  // histogram. The same node functions run; only where their values are written differs.
  async thumbnails(material, period) {
    const r = this.renderer, device = r.device, program = compileMaterial(material), count = program.instructions.length;
    const main = this.pipeline(program, true), staged = stagePlan(program).stages.length ? this.stagePipelines(program) : null;
    await Promise.all([main.promise, staged?.promise]);
    if (main.failed || staged?.failed) throw main.failed || staged.failed;
    const data = new ArrayBuffer(PROGRAM_BYTES); writeProgram(new DataView(data), 0, program);
    device.queue.writeBuffer(this.programBuffer, SCRATCH_ROW * PROGRAM_BYTES, data);   // after the wait: the scratch row is this run's until its submit
    this.thumbTexture ??= device.createTexture({label: 'material node thumbnails', size: [THUMB, THUMB, MAX_NODES], format: 'rgba8unorm', usage: GPUTextureUsage.STORAGE_BINDING | GPUTextureUsage.COPY_SRC});
    const pipeline = main.ready, job = device.createBuffer({size: 16, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST});
    device.queue.writeBuffer(job, 0, new Uint32Array([period, THUMB_STRIDE, SCRATCH_ROW, 0]));
    const bytes = THUMB * THUMB * 4, buffer = device.createBuffer({size: bytes * count, usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ});
    const encoder = device.createCommandEncoder({label: 'material node thumbnails'}), stageJobs = [];
    this.runStages(encoder, program, SCRATCH_ROW, period, stageJobs, staged?.ready);
    const pass = encoder.beginComputePass();
    pass.setPipeline(pipeline);
    pass.setBindGroup(0, device.createBindGroup({layout: pipeline.getBindGroupLayout(0), entries: [{binding: 15, resource: {buffer: this.programBuffer}}]}));
    pass.setBindGroup(1, device.createBindGroup({layout: pipeline.getBindGroupLayout(1), entries: [{binding: 0, resource: this.thumbTexture.createView({dimension: '2d-array'})}, {binding: 1, resource: {buffer: job}},
      ...(stagePlan(program).stages.length ? [{binding: 3, resource: this.stageTexture.createView({dimension: '2d-array'})}] : [])]}));
    pass.dispatchWorkgroups(THUMB / 8, THUMB / 8); pass.end();
    encoder.copyTextureToBuffer({texture: this.thumbTexture}, {buffer, bytesPerRow: THUMB * 4, rowsPerImage: THUMB}, [THUMB, THUMB, count]);
    device.queue.submit([encoder.finish()]); job.destroy(); stageJobs.forEach(b => b.destroy());
    await buffer.mapAsync(GPUMapMode.READ);
    const pixels = new Uint8ClampedArray(buffer.getMappedRange()).slice(); buffer.unmap(); buffer.destroy();
    return new Map(program.nodes.map((n, i) => [n.id, pixels.subarray(i * bytes, (i + 1) * bytes)]));
  }
}
