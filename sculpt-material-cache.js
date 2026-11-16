// The GPU side of materials (sculpt-materials.js): each material in use has one layer of a cached repeat holding its unlit color, art
// height and shine, a layer of that color reduced to its game-palette colors, and one texel of its mean color. A graph is compiled to a
// pipeline once per shape; its numbers are a buffer upload. A palette-only edit redoes the reduction, not the fields.
import {compileMaterial, PROGRAM_BYTES, STEP_STRIDE, MAX_NODES, MAX_STAGES, materialRenderKey, programKey, programSource, stagePlan, materialCacheUsage, paletteRgb, THUMB, THUMB_STRIDE} from './sculpt-materials.js';

const SCRATCH_ROW = 8;   // the materialGraphs row a thumbnail run borrows
// A slot's row of the uniform table: its palette and how the reduction treats it.
export function writeMaterialSlot(r, material, view, at) {
  const members = r.uniform.get('ground').members, d = material.dither, reduce = material.palette.length >= 2;
  const set = (key, value, int = false) => int ? view.setInt32(at + members.get(key).offset, value, true) : view.setFloat32(at + members.get(key).offset, value, true);
  set('paletteCount', material.palette.length, true); set('dither', reduce ? d.amount : 0); set('spread', d.spread); set('tone', d.tone);
  [d.red, d.green, d.blue].forEach((v, c) => view.setFloat32(at + members.get('weights').offset + c * 4, v, true));
  material.palette.forEach((index, k) => paletteRgb(index).forEach((v, c) => view.setFloat32(at + members.get('palette').offset + k * 16 + c * 4, v / 255, true)));
}
function writeProgram(view, at, program) {
  view.setInt32(at, program.instructions.length, true);
  program.instructions.forEach((step, i) => {
    const base = at + 16 + i * STEP_STRIDE;
    [...step.code, ...step.links].forEach((v, j) => view.setInt32(base + j * 4, v, true));
    step.args.forEach((v, j) => view.setFloat32(base + 32 + j * 4, v, true));
  });
}
export class MaterialCache {
  constructor(renderer, source, reduceSource) {
    this.renderer = renderer; this.source = source; this.reduceSource = reduceSource;
    this.pipelines = new Map(); this.keys = new Map(); this.colorKeys = new Map(); this.layers = []; this.pool = 0; this.generations = 0;
    this.programBuffer = renderer.device.createBuffer({label: 'material graphs', size: PROGRAM_BYTES * (SCRATCH_ROW + 1), usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST});
    renderer.track?.(this.programBuffer, 'material graphs', this.programBuffer.size, 'materials');
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
    this.fieldTexture = this.texture(this.fieldTexture, 'material color and height', [pool, pool, count], 'rgba32float', read | GPUTextureUsage.COPY_SRC, pool * pool * count * 16);
    this.colorTexture = this.texture(this.colorTexture, 'material palette color', [pool, pool, count], 'rgba8unorm', read | GPUTextureUsage.COPY_SRC, pool * pool * count * 4);
    this.shineTexture = this.texture(this.shineTexture, 'material shine', [pool, pool, count], 'rgba16float', read, pool * pool * count * 8);
    this.meanTexture = this.texture(this.meanTexture, 'material mean color', [1, 1, count], 'rgba32float', read, count * 16);
    if (r.resources) r.fixedBytes = [...r.resources.values()].filter(v => v.kind === 'materials' || v.kind === 'shared').reduce((n, v) => n + v.bytes, 0);
    r.bindGroups = {}; this.keys.clear(); this.colorKeys.clear();
  }
  pipeline(program, thumbnails = false) {
    const id = (thumbnails ? 'thumbnails ' : '') + programKey(program);
    if (!this.pipelines.has(id)) {
      if (this.pipelines.size >= 24) this.pipelines.delete(this.pipelines.keys().next().value);
      const {taps, main} = programSource(program, thumbnails), r = this.renderer;
      const code = this.source.replace('/*MATERIAL_TAPS*/', taps).replace('/*MATERIAL_MAIN*/', main);
      this.pipelines.set(id, r.device.createComputePipeline({label: 'material graph', layout: 'auto', compute: {module: r.device.createShaderModule({label: 'material graph', code}), entryPoint: thumbnails ? 'thumbMain' : 'groundMain'}}));
    }
    return this.pipelines.get(id);
  }
  // Stages (sculpt-materials.js stagePlan): one layer a staged node (Blur, Slope blur) for what the later passes read, and two scratch
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
  stagePipelines(program) {
    const id = 'stages ' + programKey(program);
    if (!this.pipelines.has(id)) {
      if (this.pipelines.size >= 24) this.pipelines.delete(this.pipelines.keys().next().value);
      const {taps, stages} = programSource(program), r = this.renderer, plan = stagePlan(program);
      const module = r.device.createShaderModule({label: 'material blur stages', code: this.source.replace('/*MATERIAL_TAPS*/', taps).replace('/*MATERIAL_MAIN*/', stages)});
      const make = entryPoint => r.device.createComputePipeline({label: 'material ' + entryPoint, layout: 'auto', compute: {module, entryPoint}});
      this.pipelines.set(id, {stages: plan.stages.map((_, k) => make('stage' + k)), blur: make('blurPass'), slope: make('slopePass')});
    }
    return this.pipelines.get(id);
  }
  // A program's stages into `encoder`, before its own pass: each staged node's inputs over the whole repeat, then its pass into its layer
  // (a Blur across and down, a Slope blur's walk).
  runStages(encoder, program, row, size, buffers) {
    const plan = stagePlan(program); if (!plan.stages.length) return;
    this.stageTextures(size);
    const device = this.renderer.device, {stages, blur, slope} = this.stagePipelines(program), groups = Math.ceil(size / 8);
    const job = values => { const b = device.createBuffer({size: 16, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST}); buffers.push(b); device.queue.writeBuffer(b, 0, new Uint32Array(values)); return b; };
    const layer = (texture, k) => texture.createView({dimension: '2d', baseArrayLayer: k, arrayLayerCount: 1});
    const graphs = pipeline => device.createBindGroup({layout: pipeline.getBindGroupLayout(0), entries: [{binding: 15, resource: {buffer: this.programBuffer}}]});
    const run = (pipeline, entries) => { const pass = encoder.beginComputePass({label: 'material blur stage'}); pass.setPipeline(pipeline); pass.setBindGroup(0, graphs(pipeline)); pass.setBindGroup(1, device.createBindGroup({layout: pipeline.getBindGroupLayout(1), entries})); pass.dispatchWorkgroups(groups, groups); pass.end(); };
    plan.stages.forEach(({step, type}, k) => {
      run(stages[k], [{binding: 1, resource: {buffer: job([0, 0, row, 0])}}, {binding: 4, resource: layer(this.scratchTexture, 0)},
        ...(plan.stageReads[k] ? [{binding: 3, resource: this.stageTexture.createView({dimension: '2d-array'})}] : [])]);
      if (type === 'slopeblur') { run(slope, [{binding: 1, resource: {buffer: job([0, 0, row, step])}}, {binding: 5, resource: layer(this.scratchTexture, 0)}, {binding: 4, resource: layer(this.stageTexture, k)}]); return; }
      run(blur, [{binding: 1, resource: {buffer: job([0, 0, row, step])}}, {binding: 5, resource: layer(this.scratchTexture, 0)}, {binding: 4, resource: layer(this.scratchTexture, 1)}]);
      run(blur, [{binding: 1, resource: {buffer: job([1, 0, row, step])}}, {binding: 5, resource: layer(this.scratchTexture, 1)}, {binding: 4, resource: layer(this.stageTexture, k)}]);
    });
  }
  // The cache's shape for these materials (a Map of slot to material): which layer each slot reads. No GPU work is submitted.
  prepare(pool, materials) {
    const usage = materialCacheUsage(materials.size, pool);
    if (!usage.fits) throw Error(`These materials need ${(usage.bytes / 1048576).toFixed(0)} MiB; the cache budget is ${usage.budget / 1048576} MiB. Use fewer materials.`);
    const layers = [...materials.keys()].sort((a, b) => a - b);
    if (this.pool !== pool || String(this.layers) !== String(layers)) { this.allocate(layers.length ? pool : 1, Math.max(1, layers.length)); this.pool = pool; this.layers = layers; }
    const r = this.renderer, table = r.uniform.get('ground');
    for (let slot = 0; slot < table.count; slot++) for (const key of ['cacheLayer', 'colorLayer'])
      r.uniformView.setInt32(table.offset + slot * table.stride + table.members.get(key).offset, layers.indexOf(slot), true);
    this.entries = layers.map((slot, layer) => ({slot, layer, material: materials.get(slot), program: compileMaterial(materials.get(slot))}));
  }
  // Generates what changed. Called inside the draw cycle, so a fast drag never queues more than one run a frame.
  sync(pool, materials) {
    this.prepare(pool, materials);
    const r = this.renderer, device = r.device, data = new ArrayBuffer(PROGRAM_BYTES * Math.max(1, this.entries.length)), view = new DataView(data), changed = [];
    for (const e of this.entries) {
      writeProgram(view, e.layer * PROGRAM_BYTES, e.program);
      const key = JSON.stringify(e.program.instructions.map(i => [i.code, i.links, i.args]));
      if (this.keys.get(e.layer) !== key) changed.push([e, key]);
    }
    if (changed.length) {
      device.queue.writeBuffer(this.programBuffer, 0, data);
      const encoder = device.createCommandEncoder({label: 'material graphs'}), buffers = [];
      for (const [e, key] of changed) {
        const pipeline = this.pipeline(e.program), job = device.createBuffer({size: 16, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST}); buffers.push(job);
        device.queue.writeBuffer(job, 0, new Uint32Array([e.slot, e.layer, e.layer, 0]));
        this.runStages(encoder, e.program, e.layer, pool, buffers);
        const pass = encoder.beginComputePass({label: 'material graph'}); pass.setPipeline(pipeline);
        pass.setBindGroup(0, device.createBindGroup({layout: pipeline.getBindGroupLayout(0), entries: [{binding: 15, resource: {buffer: this.programBuffer}}]}));
        pass.setBindGroup(1, device.createBindGroup({layout: pipeline.getBindGroupLayout(1), entries: [
          {binding: 0, resource: this.fieldTexture.createView({dimension: '2d-array'})}, {binding: 1, resource: {buffer: job}}, {binding: 2, resource: this.shineTexture.createView({dimension: '2d-array'})},
          ...(stagePlan(e.program).mainReads ? [{binding: 3, resource: this.stageTexture.createView({dimension: '2d-array'})}] : [])]}));
        pass.dispatchWorkgroups(Math.ceil(pool / 8), Math.ceil(pool / 8)); pass.end();
        this.keys.set(e.layer, key); this.generations++;
      }
      device.queue.submit([encoder.finish()]); buffers.forEach(b => b.destroy());
    }
    this.reduce(pool, changed.map(([e]) => e.slot));
  }
  // The mean color of each regenerated material, and the palette reduction of each whose fields or palette changed.
  reduce(pool, regenerated) {
    const r = this.renderer, device = r.device;
    const stage = entryPoint => this[entryPoint] ??= device.createComputePipeline({label: entryPoint, layout: 'auto', compute: {module: this.reduceModule ??= device.createShaderModule({label: 'material reduction', code: this.reduceSource}), entryPoint}});
    const fields = this.fieldTexture.createView({dimension: '2d-array'});
    for (const e of this.entries) {
      const fresh = regenerated.includes(e.slot), key = materialRenderKey(e.material), reduces = e.material.palette.length >= 2 && e.material.dither.amount > 0;
      if (!fresh && (!reduces || this.colorKeys.get(e.slot) === key)) continue;
      r.uniformsDirty = true; r.flushUniforms();
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
      device.queue.submit([encoder.finish()]); error?.destroy(); jobs.forEach(b => b.destroy()); this.colorKeys.set(e.slot, key);
    }
  }
  // Every node's own output as a small picture (THUMB px, one layer a node in evaluation order), for the graph's cards and the Levels
  // histogram. The same node functions run; only where their values are written differs.
  async thumbnails(material, period) {
    const r = this.renderer, device = r.device, program = compileMaterial(material), count = program.instructions.length;
    const data = new ArrayBuffer(PROGRAM_BYTES); writeProgram(new DataView(data), 0, program);
    device.queue.writeBuffer(this.programBuffer, SCRATCH_ROW * PROGRAM_BYTES, data);
    this.thumbTexture ??= device.createTexture({label: 'material node thumbnails', size: [THUMB, THUMB, MAX_NODES], format: 'rgba8unorm', usage: GPUTextureUsage.STORAGE_BINDING | GPUTextureUsage.COPY_SRC});
    const pipeline = this.pipeline(program, true), job = device.createBuffer({size: 16, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST});
    device.queue.writeBuffer(job, 0, new Uint32Array([period, THUMB_STRIDE, SCRATCH_ROW, 0]));
    const bytes = THUMB * THUMB * 4, buffer = device.createBuffer({size: bytes * count, usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ});
    const encoder = device.createCommandEncoder({label: 'material node thumbnails'}), stageJobs = [];
    this.runStages(encoder, program, SCRATCH_ROW, period, stageJobs);
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
