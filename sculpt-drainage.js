// P21: the drainage plane (engine-drainage.wgsl explains the passes). One plane a map: for every cell of a coarse lattice (DRAIN_STEP cells of the world
// lattice, 16 px), the exact drainage area in lattice cells and the receiver's index, as (u32, u32) in a storage buffer. The lattice is the authored height:
// a whole-map map hands over its shape plane (sampled here), a paged map its coarse lattice, which holds the same samples, so both give the same plane.
// The plane is stored like the flow bake's planes: the Time pass reads it (engine-weather.wgsl `drainageAt`), and fans, rills and stream power will.

export const DRAIN_STEP = 8;                                // world cells per lattice cell: 16 px, one TA height cell
export const DRAIN_BYTES = 8;                               // a stored cell: area and receiver, u32 each
export const latticeWidth = worldGrid => Math.floor((worldGrid - 1) / DRAIN_STEP) + 1;
export const jumpPasses = cells => { let j = 0; while (2 ** j < 2 * cells) j++; return j; };   // ceil(log2(2N)): the longest list is the 2N elements of one chain

const pipelines = new WeakMap();
async function pipelinesOf(device) {
  let p = pipelines.get(device);
  if (p) return p;
  p = (async () => {
    const module = device.createShaderModule({label: 'engine-drainage', code: await (await fetch('/engine-drainage.wgsl')).text()});
    const errors = (await module.getCompilationInfo()).messages.filter(m => m.type === 'error');
    if (errors.length) throw new Error('nanolathe: engine-drainage.wgsl does not compile:\n' + errors.map(e => `${e.lineNum}:${e.linePos} ${e.message}`).join('\n'));
    const out = {};
    await Promise.all(['sampleMain', 'recvMain', 'tourMain', 'jumpMain', 'areaMain'].map(async entryPoint => { out[entryPoint] = await device.createComputePipelineAsync({label: entryPoint, layout: 'auto', compute: {module, entryPoint}}); }));
    return out;
  })();
  pipelines.set(device, p);
  return p;
}

// Compute the plane. Give either `heights` (a Float32Array lattice of width x width) or `planes` (the whole-map height plane, `grid` cells a side, from which every
// DRAIN_STEP-th cell is taken). Cells at or under `sea` are outlets. Returns {buffer, width, cells, bytes, passes, milliseconds, destroy}; the caller owns the buffer.
export async function computeDrainage(device, {heights = null, planes = null, grid = 0, width = 0, sea = -1e30}) {
  const P = await pipelinesOf(device), started = performance.now();
  if (planes) width = latticeWidth(grid);
  const cells = width * width, passes = jumpPasses(cells);
  const S = GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC | GPUBufferUsage.COPY_DST, made = [];
  const make = (label, bytes, usage = S) => { const b = device.createBuffer({label, size: Math.max(16, bytes), usage}); made.push(b); return b; };
  const lat = make('drainage lattice', cells * 4), recv = make('drainage receivers', cells * 4), tourA = make('drainage tour a', cells * 16), tourB = make('drainage tour b', cells * 16);
  const plane = device.createBuffer({label: 'drainage plane', size: Math.max(16, cells * DRAIN_BYTES), usage: S});
  const uniform = make('drainage uniform', 32, GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST), view = new DataView(new ArrayBuffer(32));
  [width, cells, grid, DRAIN_STEP].forEach((v, i) => view.setUint32(i * 4, v, true)); view.setFloat32(16, sea, true);
  device.queue.writeBuffer(uniform, 0, view.buffer);
  if (heights) { if (heights.length !== cells) throw new Error(`nanolathe: the drainage lattice is ${heights.length} cells, not ${width} x ${width}`); device.queue.writeBuffer(lat, 0, heights); }
  const groups = Math.ceil(cells / 64), gx = Math.min(groups, 65535), gy = Math.ceil(groups / gx);
  const encoder = device.createCommandEncoder({label: 'drainage'});
  const run = (entry, buffers) => {
    const pipeline = P[entry], pass = encoder.beginComputePass({label: entry});
    pass.setPipeline(pipeline);
    pass.setBindGroup(0, device.createBindGroup({layout: pipeline.getBindGroupLayout(0), entries: [{binding: 0, resource: {buffer: uniform}}, ...Object.entries(buffers).map(([binding, buffer]) => ({binding: Number(binding), resource: {buffer}}))]}));
    pass.dispatchWorkgroups(gx, gy); pass.end();
  };
  if (planes) run('sampleMain', {1: planes, 2: lat});
  run('recvMain', {2: lat, 3: recv});
  run('tourMain', {3: recv, 4: tourA});
  let src = tourA, dst = tourB;
  for (let k = 0; k < passes; k++) { run('jumpMain', {4: src, 5: dst}); [src, dst] = [dst, src]; }
  run('areaMain', {3: recv, 4: src, 6: plane});
  device.queue.submit([encoder.finish()]);
  await device.queue.onSubmittedWorkDone();
  made.forEach(b => b.destroy());
  return storedPlane({buffer: plane, width, cells, bytes: cells * DRAIN_BYTES, passes, transientBytes: cells * (4 + 4 + 16 + 16), milliseconds: performance.now() - started});
}

// The stored plane, shared by readers: a Time pass leases it while it encodes its work, and a replaced plane is destroyed once no lease is left.
function storedPlane(plane) {
  let leases = 0, retired = false, destroyed = false;
  const destroy = () => { if (!destroyed) { destroyed = true; plane.buffer.destroy(); } };
  return Object.assign(plane, {step: DRAIN_STEP,
    lease() { leases++; let given = false; return () => { if (given) return; given = true; if (--leases <= 0 && retired) destroy(); }; },
    retire() { retired = true; if (leases <= 0) destroy(); },
    get destroyed() { return destroyed; }});
}
