// The GPU side of materials (sculpt-materials.js): each material in use has one layer of a cached repeat holding its unlit color, art
// height and shine, a layer of that color reduced to its game-palette colors, and one texel of its mean color. A graph is compiled to a
// pipeline once per shape; its numbers are a buffer upload. A palette-only edit redoes the reduction, not the fields.
import {compileMaterial, PROGRAM_BYTES, STEP_STRIDE, MAX_NODES, materialRenderKey, programKey, programSource, materialCacheUsage, paletteRgb, THUMB, THUMB_STRIDE} from './sculpt-materials.js';

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
    this.fieldTexture = this.texture(this.fieldTexture, 'material color and height', [pool, pool, count], 'rgba32float', read | GPUTextureUsage.COPY_SRC, pool * pool * count * 16);
    this.colorTexture = this.texture(this.colorTexture, 'material palette color', [pool, pool, count], 'rgba8unorm', read | GPUTextureUsage.COPY_SRC, pool * pool * count * 4);
    this.shineTexture = this.texture(this.shineTexture, 'material shine', [pool, pool, count], 'rgba16float', read, pool * pool * count * 8);
    this.meanTexture = this.texture(this.meanTexture, 'material mean color', [1, 1, count], 'rgba32float', read, count * 16);
    for (const t of [this.fieldTexture, this.colorTexture, this.shineTexture, this.meanTexture]) r.worldResource?.(t);
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
      r.worldResource?.(this.programBuffer);
      device.queue.writeBuffer(this.programBuffer, 0, data);
      const encoder = device.createCommandEncoder({label: 'material graphs'}), buffers = [];
      for (const [e, key] of changed) {
        const pipeline = this.pipeline(e.program), job = device.createBuffer({size: 16, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST}); buffers.push(job);
        device.queue.writeBuffer(job, 0, new Uint32Array([e.slot, e.layer, e.layer, 0]));
        const pass = encoder.beginComputePass({label: 'material graph'}); pass.setPipeline(pipeline);
        pass.setBindGroup(0, device.createBindGroup({layout: pipeline.getBindGroupLayout(0), entries: [{binding: 15, resource: {buffer: this.programBuffer}}]}));
        pass.setBindGroup(1, device.createBindGroup({layout: pipeline.getBindGroupLayout(1), entries: [
          {binding: 0, resource: this.fieldTexture.createView({dimension: '2d-array'})}, {binding: 1, resource: {buffer: job}}, {binding: 2, resource: this.shineTexture.createView({dimension: '2d-array'})}]}));
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
        error = device.createBuffer({label: 'material error rows', size: (pool + 2) * 129 * 16, usage: GPUBufferUsage.STORAGE});
        const common = device.createBindGroup({layout: pipeline.getBindGroupLayout(0), entries: [{binding: 0, resource: {buffer: r.uniformBuffer}}, {binding: 13, resource: fields}]});
        for (let row = 0; row < pool; row += 128) {
          const pass = encoder.beginComputePass(); pass.setPipeline(pipeline); pass.setBindGroup(0, common);
          pass.setBindGroup(1, device.createBindGroup({layout: pipeline.getBindGroupLayout(1), entries: [{binding: 0, resource: this.colorTexture.createView({dimension: '2d-array'})}, {binding: 1, resource: {buffer: error}}, {binding: 2, resource: {buffer: job([e.slot, e.layer, row, 128])}}]}));
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
    const encoder = device.createCommandEncoder({label: 'material node thumbnails'}), pass = encoder.beginComputePass();
    pass.setPipeline(pipeline);
    pass.setBindGroup(0, device.createBindGroup({layout: pipeline.getBindGroupLayout(0), entries: [{binding: 15, resource: {buffer: this.programBuffer}}]}));
    pass.setBindGroup(1, device.createBindGroup({layout: pipeline.getBindGroupLayout(1), entries: [{binding: 0, resource: this.thumbTexture.createView({dimension: '2d-array'})}, {binding: 1, resource: {buffer: job}}]}));
    pass.dispatchWorkgroups(THUMB / 8, THUMB / 8); pass.end();
    encoder.copyTextureToBuffer({texture: this.thumbTexture}, {buffer, bytesPerRow: THUMB * 4, rowsPerImage: THUMB}, [THUMB, THUMB, count]);
    device.queue.submit([encoder.finish()]); job.destroy();
    await buffer.mapAsync(GPUMapMode.READ);
    const pixels = new Uint8ClampedArray(buffer.getMappedRange()).slice(); buffer.unmap(); buffer.destroy();
    return new Map(program.nodes.map((n, i) => [n.id, pixels.subarray(i * bytes, (i + 1) * bytes)]));
  }
}
