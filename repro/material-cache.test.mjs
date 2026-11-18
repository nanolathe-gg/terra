// The material cache's uploads fit the buffers they write (sculpt-material-cache.js), on a stand-in device that checks every writeBuffer
// against the buffer's size as WebGPU validation does.
import test from 'node:test';
import assert from 'node:assert/strict';
import {MaterialCache} from '../sculpt-material-cache.js';
import {LIBRARY, MATERIAL_SLOTS, MATERIAL_STATES, materialStates, copyMaterial} from '../sculpt-materials.js';

globalThis.GPUBufferUsage ??= {MAP_READ: 1, MAP_WRITE: 2, COPY_SRC: 4, COPY_DST: 8, INDEX: 16, VERTEX: 32, UNIFORM: 64, STORAGE: 128, INDIRECT: 256, QUERY_RESOLVE: 512};
globalThis.GPUTextureUsage ??= {COPY_SRC: 1, COPY_DST: 2, TEXTURE_BINDING: 4, STORAGE_BINDING: 8, RENDER_ATTACHMENT: 16};
globalThis.GPUMapMode ??= {READ: 1, WRITE: 2};
function standIn() {
  const writes = [], view = () => ({});
  const pass = {setPipeline() {}, setBindGroup() {}, dispatchWorkgroups() {}, end() {}};
  const device = {
    limits: {maxStorageBufferBindingSize: 1 << 30},
    createBuffer: ({size, label}) => ({size, label, destroy() {}, mapAsync: () => new Promise(() => {}), getMappedRange: () => new ArrayBuffer(size), unmap() {}}),
    createTexture: ({size}) => ({size, createView: view, destroy() {}}),
    createShaderModule: () => ({}),
    createComputePipeline: () => ({getBindGroupLayout: () => ({})}),
    createBindGroup: () => ({}),
    createCommandEncoder: () => ({beginComputePass: () => pass, copyTextureToTexture() {}, copyTextureToBuffer() {}, finish: () => ({})}),
    queue: {submit() {}, writeBuffer(buffer, offset, data) { writes.push({label: buffer.label, end: offset + data.byteLength, size: buffer.size}); }},
  };
  // The ground table: one row a slot, with the layer indices prepare() writes.
  const keys = ['cacheLayer', 'colorLayer', ...MATERIAL_STATES.map(k => k + 'Layer')], stride = 16 * keys.length;
  const ground = {offset: 0, stride, count: 32, members: new Map(keys.map((k, i) => [k, {offset: i * 4}]))};
  const renderer = {device, uniform: new Map([['ground', ground]]), uniformView: new DataView(new ArrayBuffer(stride * 32)), flushUniforms() {}};
  return {renderer, writes};
}

test('a full map whose materials draw Worn and Deposit uploads its graphs within the graph buffer', () => {
  const {renderer, writes} = standIn(), cache = new MaterialCache(renderer, '/*MATERIAL_TAPS*/ /*MATERIAL_MAIN*/', '');
  // Every slot a map may fill, each material drawing both states: 23 graphs, 69 cache layers at a small repeat.
  const materials = new Map();
  for (let slot = 1; slot < MATERIAL_SLOTS; slot++) {
    const m = copyMaterial(LIBRARY['green-ground']), out = m.nodes.find(n => n.type === 'output');
    out.in.worn = out.in.deposit = out.in.color;
    materials.set(slot, m);
  }
  assert.deepEqual(materialStates(materials.get(1)), MATERIAL_STATES, 'the fixture draws both states');
  cache.sync(8, materials);
  const graphs = writes.filter(w => w.label === 'material graphs');
  assert.ok(graphs.length, 'the graphs were uploaded');
  for (const w of graphs) assert.ok(w.end <= w.size, `material graphs upload of ${w.end} bytes into ${w.size}`);
});
