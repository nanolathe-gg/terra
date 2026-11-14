// The input checksum's guard. A view tile keeps its picture when its inputs check the same (TerrainRenderer.inputDigest), so the checksum
// must cover everything a draw reads. This guard watches every draw and fails loudly when something could escape it. It runs in tests and in
// debug runs only (`?digestGuard` in the address, or the engine's digest check); the editor never installs it, since it wraps the device's calls.
//
// During a draw, after the checksum is taken, it records every buffer and texture bound to a pass and every queue write. Then:
//  1. Each bound resource must be in one of TerrainRenderer.digestClasses()'s three classes: an input (checksummed), one the draw produces
//     from its inputs, or a world resource (versioned: its version is in the checksum). Anything else is reported by its label.
//  2. A world resource's content is hashed after each draw; a change while the world version stayed the same is reported.
//  3. Two draws with the same checksum must end with the same uniforms (the per-chunk ones the checksum leaves out included; the flags the
//     GPU writes left out) and write the same bytes to any other resource both write during the draw (the voxel region settings).
// A violation is logged once and kept in `violations`; the renderer then returns no checksum, so a tile drawn after one is never kept.

const isBuffer = r => r && typeof r === 'object' && 'mapState' in r && 'size' in r;
const isSampler = r => r?.constructor?.name === 'GPUSampler';
const nameOf = r => r?.label || (isBuffer(r) ? `an unlabeled ${r.size}-byte buffer` : r?.width ? `an unlabeled ${r.width}x${r.height} texture` : 'an unknown resource');
// FNV-1a over bytes, continued from h.
const fnv = (bytes, h = 0x811c9dc5) => { for (let i = 0; i < bytes.length; i++) h = Math.imul(h ^ bytes[i], 0x01000193); return h >>> 0; };
const bytesOf = (data, offset = 0, size) => {
  const view = ArrayBuffer.isView(data) ? new Uint8Array(data.buffer, data.byteOffset, data.byteLength) : new Uint8Array(data);
  const unit = ArrayBuffer.isView(data) && !(data instanceof DataView) ? data.BYTES_PER_ELEMENT : 1;   // writeBuffer counts typed-array offsets in elements
  return view.subarray(offset * unit, size === undefined ? undefined : (offset + size) * unit);
};

export const digestGuardRequested = () => { try { return new URLSearchParams(globalThis.location?.search || '').has('digestGuard'); } catch { return false; } };

// Wrap the device before the renderer makes its resources: views and bind groups are traced back to the textures and buffers they hold.
export function installDigestGuard(device) {
  const viewTexture = new WeakMap(), groupResources = new WeakMap();
  const guard = {violations: [], window: null, writes: new Map(), world: new Map(), draws: 0};
  const createTexture = device.createTexture.bind(device);
  device.createTexture = descriptor => {
    const texture = createTexture(descriptor), createView = texture.createView.bind(texture);
    texture.createView = d => { const view = createView(d); viewTexture.set(view, texture); return view; };
    return texture;
  };
  const createBindGroup = device.createBindGroup.bind(device);
  device.createBindGroup = descriptor => {
    const group = createBindGroup(descriptor);
    groupResources.set(group, (descriptor.entries || []).map(({resource: r}) => isBuffer(r?.buffer) ? r.buffer : isBuffer(r) ? r : viewTexture.get(r) ?? (isSampler(r) ? null : {unknown: r?.label || 'a view of a texture made before the guard'})).filter(Boolean));
    return group;
  };
  const createCommandEncoder = device.createCommandEncoder.bind(device);
  device.createCommandEncoder = descriptor => {
    const encoder = createCommandEncoder(descriptor);
    for (const begin of ['beginComputePass', 'beginRenderPass']) {
      const open = encoder[begin].bind(encoder);
      encoder[begin] = d => {
        const pass = open(d), set = pass.setBindGroup.bind(pass);
        pass.setBindGroup = (index, group, ...rest) => {
          if (guard.window && group) for (const r of groupResources.get(group) ?? [{unknown: group.label || 'a bind group made before the guard'}]) guard.window.bound.add(r);
          return set(index, group, ...rest);
        };
        return pass;
      };
    }
    return encoder;
  };
  const queue = device.queue, writeBuffer = queue.writeBuffer.bind(queue), writeTexture = queue.writeTexture.bind(queue);
  const wrote = (target, bytes) => { if (guard.window) { const w = guard.window.writes; w.set(target, fnv(bytes, w.get(target) ?? 0x811c9dc5)); } };
  queue.writeBuffer = (buffer, at, data, offset, size) => { wrote(buffer, bytesOf(data, offset, size)); return writeBuffer(buffer, at, data, offset, size); };
  queue.writeTexture = (destination, data, layout, size) => { wrote(destination.texture, bytesOf(data)); return writeTexture(destination, data, layout, size); };

  const report = message => { if (guard.violations.includes(message)) return; guard.violations.push(message); console.error('digest guard: ' + message); };
  guard.begin = () => { guard.window = {bound: new Set(), writes: new Map()}; };
  // After a draw: true when nothing escaped the checksum. renderer: the TerrainRenderer that drew; digest: its input checksum, or null.
  guard.check = async (renderer, digest) => {
    const window = guard.window; guard.window = null; if (!window) return true; guard.draws++;
    const {input, produced, world} = renderer.digestClasses(), worldBound = [];
    for (const r of window.bound) {
      if (r.unknown) report(`a draw binds ${r.unknown}, which the guard cannot trace: make it after the renderer installs the guard`);
      else if (world.has(r)) worldBound.push(r);
      else if (!input.has(r) && !produced.has(r)) report(`a draw reads '${nameOf(r)}', which the input checksum does not cover: hash it in inputDigest, or classify it in digestClasses (sculpt-renderer.js)`);
    }
    if (worldBound.length) {
      const sums = await renderer.textureSums(worldBound.flatMap(texture => Array.from({length: texture.mipLevelCount}, (_, mip) => ({texture, mip}))));
      let k = 0;
      for (const texture of worldBound) {
        const hash = sums.slice(k, k += 2 * texture.mipLevelCount).join('.'), seen = guard.world.get(texture);
        if (seen?.epoch === renderer.worldEpoch && seen.hash !== hash) report(`the world texture '${nameOf(texture)}' changed without a world version bump (worldResource in sculpt-renderer.js)`);
        guard.world.set(texture, {epoch: renderer.worldEpoch, hash});
      }
    }
    if (digest) {
      const uniforms = renderer.uniformData.slice(0), seen = guard.writes.get(digest);
      if (seen) {
        const names = renderer.digestUniformDiff(seen.uniforms, uniforms);
        if (names.length) report(`two draws with the same input checksum ran with different uniforms (${names.join(', ')}): what sets them must be in the checksum`);
        for (const [r, hash] of window.writes) if (r !== renderer.uniformBuffer && seen.writes.has(r) && seen.writes.get(r) !== hash)
          report(`two draws with the same input checksum wrote different data to '${nameOf(r)}': what sets it must be in the checksum`);
      } else {
        if (guard.writes.size >= 4096) guard.writes.delete(guard.writes.keys().next().value);
        guard.writes.set(digest, {uniforms, writes: window.writes});
      }
    }
    return !guard.violations.length;
  };
  return guard;
}
