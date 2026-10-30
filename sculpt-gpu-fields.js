// H6 (Green): shape on the GPU. Evaluates the brushes Green's windows use (paint, erase, deep, shallow, mountain, hill and the ground
// node) with the compute passes of engine-shape.wgsl, and keeps a CPU copy of the 31 authored planes that the existing consumers read.
//
//   createShapeEngine   the GPU side: node preparation (path simplification, frames, boxes: the JS engine's own arithmetic), the
//                       passes, and the readback of a rectangle.
//   createGpuFields     the same object as createRegionalFields (read, readCells, sample, cell, changed, clear, revision, stats...)
//                       for a map, over one whole-map evaluation; a scene with any node the passes do not take is handed to the JS
//                       fields as a whole (`fallback`), and the status line says so.
//
// The CPU copy is refreshed asynchronously: changed() starts a GPU evaluation of the dirty rectangle and a readback of just that
// rectangle; read() waits (readAsync/ready) so a bake never sees a half-written copy and the frame never waits.

const FIELD_KEYS_FLOAT = ['h', 'p', 'r', 'c', 'v', 'x'];
const KIND = {paint: 0, erase: 1, deep: 2, shallow: 3, mountain: 4, hill: 5};
// Mirrors NOISE_FIELDS in sculpt.js: [wavelength, weight, salt] twice, in the order the shader indexes them.
const NOISE = [
  [[95, .7, 0x1863], [37, .3, 0x32a7]], [[95, .7, 0x73c1], [37, .3, 0x9e15]], [[64, .65, 0x5b39], [23, .35, 0x2ac9]],
  [[210, .65, 0x5e17], [75, .35, 0x37ab]], [[210, .65, 0x84d1], [75, .35, 0x192f]], [[180, .65, 0x73b9], [55, .35, 0x4f25]], [[170, .75, 0x986d], [48, .25, 0x62f3]]];
const F_X = 0, F_Y = 1, F_COAST_X = 3, F_COAST_Y = 4;
// What a painted-mask choice writes, as [plane, target] (MASK_WRITES in sculpt.js).
const MASK_WRITES = [null, [[0, 127], [1, 0], [3, 0]], [[1, 127], [0, 0], [3, 0]], [[2, 127]], [[3, 127], [0, 0], [1, 0]], [[4, 127]], [[4, -127]],
  [[0, 0], [1, 0], [2, 0], [3, 0], [4, 0], [5, 0], [6, 0], [7, 0], [8, 0], [9, 0], [10, 0], [11, 0], [12, 0], [13, 0]],
  [[5, 127]], [[5, -127]], [[6, 127]], [[6, -127]], [[7, 127]], [[7, -127]], [[8, 127]], [[8, -127]], [[12, 127]], [[12, -127]],
  [[14, 127]], [[14, -127]], [[15, 127]], [[15, -127]], [[16, 127]], [[16, -127]], [[17, 127]], [[17, -127]]];
const STYLE_KEYS = ['styleRelief', 'styleCracks', 'styleBanding', 'styleFace', 'styleErosion', 'styleDeposits', 'styleVegetation', 'styleExposure'];
const WATER_KEYS = ['waterShore', 'waterDeep', 'waterBed'];

// The uniform struct, in one list so the WGSL and the writer cannot drift apart: [name, type] with type f (f32), u (u32), i (i32).
const NODE_FIELDS = [
  ...['grid', 'kind', 'nseg', 'seed', 'framed', 'natural', 'passage', 'settle', 'nwrites', 'segBase', 'mwBase', 'bsrc', 'bdst', 'blurR'].map(k => [k, 'u']),
  ...['rx0', 'ry0', 'rx1', 'ry1'].map(k => [k, 'i']),
  ...['spacing', 'baseH', 'sea', 'minH', 'maxH', 'radius', 'amount', 'amountPct', 'rough', 'softness', 'northWiden', 'bankScale', 'amp', 'faceVar', 'shelves',
    'beachFlat', 'coreEdge', 'crackAmt', 'faceX', 'faceY', 'faceSide', 'rotX', 'rotY', 'inv0', 'inv1', 'inv2', 'inv3', 'inv4', 'inv5', 'backWidth', 'faceWidth',
    'tg0', 'tg1', 'tg2', 'tg3', 'mexp', 'gAmp', 'gWave', 'gCover'].map(k => [k, 'f'])];
const NODE_BYTES = Math.ceil(NODE_FIELDS.length * 4 / 256) * 256;
const nodeStruct = () => `struct Node {\n${NODE_FIELDS.map(([k, t]) => `  ${k}: ${{f: 'f32', u: 'u32', i: 'i32'}[t]},`).join('\n')}\n}\n`;

// ---- the JS engine's own noise and path arithmetic, copied so the segment list is bit-identical ----
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const smooth = (a, b, v) => { const t = clamp((v - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };
function hash(x, y, s) {
  let n = Math.imul(x, 374761393) ^ Math.imul(y, 668265263) ^ s;
  n = Math.imul(n ^ (n >>> 13), 1274126177); return ((n ^ (n >>> 16)) >>> 0) / 4294967295 * 2 - 1;
}
function valueNoise(x, y, s) {
  const ix = Math.floor(x), iy = Math.floor(y), tx = smooth(0, 1, x - ix), ty = smooth(0, 1, y - iy);
  const a = hash(ix, iy, s), b = hash(ix + 1, iy, s), c = hash(ix, iy + 1, s), d = hash(ix + 1, iy + 1, s);
  return (a + (b - a) * tx) * (1 - ty) + (c + (d - c) * tx) * ty;
}
const noiseValue = (f, s, x, y) => { const [[w1, a1, k1], [w2, a2, k2]] = NOISE[f]; return a1 * valueNoise(x / w1, y / w1, s ^ k1) + a2 * valueNoise(x / w2, y / w2, s ^ k2); };
const invert = m => { const det = m[0] * m[3] - m[1] * m[2], a = m[3] / det, b = -m[1] / det, c = -m[2] / det, d = m[0] / det; return [a, b, c, d, -(a * m[4] + c * m[5]), -(b * m[4] + d * m[5])]; };
const IDENTITY = [1, 0, 0, 1, 0, 0];
const isIdentity = m => !m || m.every((v, i) => Math.abs(v - IDENTITY[i]) < 1e-9);
function simplifyPath(points, tolerance) {
  if (points.length < 3) return points.slice();
  const keep = new Uint8Array(points.length); keep[0] = keep[points.length - 1] = 1;
  const stack = [[0, points.length - 1]];
  while (stack.length) {
    const [a, b] = stack.pop(), pa = points[a], pb = points[b], dx = pb.x - pa.x, dy = pb.y - pa.y, l2 = dx * dx + dy * dy;
    let worst = -1, at = -1;
    for (let k = a + 1; k < b; k++) {
      const q = points[k], t = l2 ? clamp(((q.x - pa.x) * dx + (q.y - pa.y) * dy) / l2, 0, 1) : 0, d = Math.hypot(q.x - pa.x - dx * t, q.y - pa.y - dy * t);
      if (d > worst) { worst = d; at = k; }
    }
    if (worst > tolerance) { keep[at] = 1; stack.push([a, at], [at, b]); }
  }
  return points.filter((_, k) => keep[k]);
}
const hillKnots = [.67, .78, .89, 1], hillRise = [1, .34, .02, 0];
const hillTangents = hillKnots.map((_, i) => {
  if (!i || i === hillKnots.length - 1) return 0;
  const a = (hillRise[i] - hillRise[i - 1]) / (hillKnots[i] - hillKnots[i - 1]);
  const b = (hillRise[i + 1] - hillRise[i]) / (hillKnots[i + 1] - hillKnots[i]);
  return a * b > 0 ? 2 * a * b / (a + b) : 0;
});

// ---- node preparation ----
// Returns {reason} when the passes do not take the node (the scene then runs on the JS engine), or {skip:true} for a node that
// writes nothing, else {op:'ground'|'stamp', ...}. `c` is the host's context (see makeShapeContext in sculpt.js).
export function nodeSupport(n, c) {
  if (n.hidden) return null;
  if (c.skipKind(n.kind)) return null;
  if (n.kind === 'ground') return null;
  if (!(n.kind in KIND)) return `${n.kind} is not on the GPU path`;
  const q = c.params(n), kind = n.kind, water = kind === 'deep' || kind === 'shallow';
  if (!n.points?.length) return `${kind} without points`;
  if (kind === 'hill' && (!c.shouldered || c.replayFull)) return 'hill outside the shouldered form';
  if ((kind === 'paint' || kind === 'erase') && !c.edgesNatural) return `${kind} without natural edges`;
  if (kind === 'deep' && !c.natural) return 'restrained coast';
  if (q.profile >= .5) return 'parametric cross-section';
  const ridge = (kind === 'hill' || kind === 'mountain') && (Math.round(q.spurCount) >= 1 || q.crestJag > 0 || q.crestVary > 0 || q.crestTaper > 0);
  if (ridge) return 'ridge options';
  if ((kind === 'hill' || kind === 'mountain') && (q.hillLobes >= .5 || q.iceFacets > 0 || q.moonLobes > 0 || q.baseVary > 0 || q.baseBump > 0)) return 'hill lobes, facets or base options';
  if (q.fingerCoast >= .5 || Math.round(q.shoreLayers) >= 1) return 'coast pass';
  if (water && (q.fingers > 0 || q.bankPx > 0 || q.shorePlates > 0)) return 'water fingers, bank or plates';
  if (kind === 'hill' || kind === 'mountain' || water) {
    if (Math.round(q.maskChannel) !== 0 || STYLE_KEYS.some(k => Math.abs(clamp(q[k] || 0, -1, 1)) >= .005)) return 'shape mask writes';
    if (water && WATER_KEYS.some(k => { const v = Math.round(q[k] || 0); return v >= 1 && v <= (k === 'waterBed' ? 3 : 2); })) return 'water mask choices';
  }
  return null;
}

export function prepareNode(n, geom, c) {
  if (n.hidden || c.skipKind(n.kind)) return {skip: true};
  const {grid, spacing} = geom;
  if (n.kind === 'ground') return {op: 'ground', seed: (n.seed ?? 1) >>> 0, amp: n.amplitude ?? 8, wave: n.wavelength ?? 160, cover: n.coverage ?? .5};
  const q = c.params(n), kind = n.kind, kcode = KIND[kind];
  const frame = isIdentity(n.frame) ? null : n.frame, inv = frame ? invert(frame) : null, turn = frame ? Math.atan2(frame[1], frame[0]) : 0;
  const seed = ((n.seed ?? c.seed) >>> 0), pts = n.points, radius = q.radius;
  const water = kind === 'deep' || kind === 'shallow', naturalWater = kind === 'deep' && c.natural;
  const naturalPlateau = (kind === 'erase' || kind === 'paint') && c.edgesNatural, shouldered = kind === 'hill';
  const bankScale = water ? 2 ** ((q.bankWidth - .5) * 1.3) : 1;
  const faceWidth = .66 + (q.softness - .5) * .9, backWidth = q.softness === .5 ? 1.34 : 2 - faceWidth;
  const amp = q.rough * radius * (naturalWater ? 1.1 : naturalPlateau ? .95 : shouldered ? .85 : .2);
  const extent = radius * (naturalWater ? Math.min(1.9, 1 + q.rough * 1.6) : naturalPlateau ? Math.min(1.7, 1 + q.rough * 1.3) : shouldered ? Math.max(1.4, backWidth) : 1) * bankScale + 2 * amp;
  // The stored noise tables (7 fields) at a lattice cell, as framedNoise or makeNoise would hold them in a Float32Array.
  const cellNoise = (f, ix, iy) => {
    const wx = ix * spacing, wy = iy * spacing;
    if (!inv) return Math.fround(noiseValue(f, seed, wx, wy));
    const lx = inv[0] * wx + inv[2] * wy + inv[4], ly = inv[1] * wx + inv[3] * wy + inv[5], gx = Math.round(lx / spacing), gy = Math.round(ly / spacing);
    const inside = gx >= 0 && gy >= 0 && gx < grid && gy < grid;
    return Math.fround(noiseValue(f, seed, inside ? gx * spacing : lx, inside ? gy * spacing : ly));
  };
  const sampleNoise = (f, x, y) => {
    const gx = clamp(x / spacing, 0, grid - 1), gy = clamp(y / spacing, 0, grid - 1), ix = Math.floor(gx), iy = Math.floor(gy);
    const jx = Math.min(ix + 1, grid - 1), jy = Math.min(iy + 1, grid - 1), fx = gx - ix, fy = gy - iy;
    return (cellNoise(f, ix, iy) * (1 - fx) + cellNoise(f, jx, iy) * fx) * (1 - fy) + (cellNoise(f, ix, jy) * (1 - fx) + cellNoise(f, jx, jy) * fx) * fy;
  };
  const macro = naturalWater || naturalPlateau, fx = macro ? F_COAST_X : F_X, fy = macro ? F_COAST_Y : F_Y;
  const segs = [];
  const dab = (p, e, f0, f1) => segs.push({px: p.x, py: p.y, ex: (e || p).x, ey: (e || p).y, f0, f1, nx: sampleNoise(fx, p.x, p.y), ny: sampleNoise(fy, p.x, p.y)});
  let settle = false, faceSide = 1, face = [1, 0];
  if (shouldered) {
    face = [Math.cos(Math.PI / 2 + sampleNoise(F_COAST_X, pts[0].x, pts[0].y) * 1.8 + turn), Math.sin(Math.PI / 2 + sampleNoise(F_COAST_X, pts[0].x, pts[0].y) * 1.8 + turn)];
    const path = [pts[0]];
    for (const p of pts.slice(1)) if (Math.hypot(p.x - path[path.length - 1].x, p.y - path[path.length - 1].y) >= .2) path.push(p);
    if (path.length >= 3) {
      const sx = path[1].x - path[0].x, sy = path[1].y - path[0].y;
      faceSide = (-sy * face[0] + sx * face[1]) < 0 ? -1 : 1;
      settle = true;
      // settleHill: round the corners twice, sweep the rounded path in a few sections, soften the weights.
      let rounded = [path[0]];
      for (const p of path.slice(1, -1)) { const last = rounded[rounded.length - 1]; if (Math.hypot(p.x - last.x, p.y - last.y) > radius * .16) rounded.push(p); }
      rounded.push(path[path.length - 1]);
      for (let pass = 0; pass < 2; pass++) {
        const next = [rounded[0]];
        for (let i = 0; i < rounded.length - 1; i++) {
          const a = rounded[i], b = rounded[i + 1];
          next.push({x: .75 * a.x + .25 * b.x, y: .75 * a.y + .25 * b.y}, {x: .25 * a.x + .75 * b.x, y: .25 * a.y + .75 * b.y});
        }
        next.push(rounded[rounded.length - 1]); rounded = next;
      }
      const frames = rounded.map((p, i) => {
        const a = rounded[Math.max(0, i - 1)], b = rounded[Math.min(rounded.length - 1, i + 1)];
        const dx = b.x - a.x, dy = b.y - a.y, length = Math.hypot(dx, dy) || 1;
        return [-dy / length * faceSide, dx / length * faceSide];
      });
      const kept = simplifyPath(rounded.map((p, i) => ({...p, i})), Math.max(1, radius * .02)), longest = Math.max(16, radius * 1.5);
      for (let k = 0; k < kept.length - 1; k++) {
        const a = kept[k], b = kept[k + 1], fa = frames[a.i], fb = frames[b.i], pieces = Math.ceil(Math.hypot(b.x - a.x, b.y - a.y) / longest);
        const at = t => ({x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t}), fc = t => [fa[0] + (fb[0] - fa[0]) * t, fa[1] + (fb[1] - fa[1]) * t];
        for (let j = 0; j < pieces; j++) { const s = segs.length; dab(at(j / pieces), at((j + 1) / pieces), fc(j / pieces), fc((j + 1) / pieces)); segs[s].frame = true; }
      }
    } else if (path.length === 2) {
      // One span: the point preview is discarded when the first span arrives, and settleHill returns on a path under three points.
      const sx = path[1].x - path[0].x, sy = path[1].y - path[0].y;
      faceSide = (-sy * face[0] + sx * face[1]) < 0 ? -1 : 1;
      dab(path[0], path[1]);
    } else dab(path[0]);
  } else {
    const path = simplifyPath(pts, Math.max(1, radius * .04)), longest = Math.max(16, radius * 1.5);
    dab(path[0]);
    for (let k = 1; k < path.length; k++) {
      const a = path[k - 1], b = path[k], pieces = Math.ceil(Math.hypot(b.x - a.x, b.y - a.y) / longest);
      for (let j = 0; j < pieces; j++) dab({x: a.x + (b.x - a.x) * j / pieces, y: a.y + (b.y - a.y) * j / pieces}, {x: a.x + (b.x - a.x) * (j + 1) / pieces, y: a.y + (b.y - a.y) * (j + 1) / pieces});
    }
  }
  // The integer box of every capsule, as dab() clamps it; the union is the node's region.
  let region = null;
  for (const s of segs) {
    s.box = [clamp(Math.floor((Math.min(s.px, s.ex) - extent) / spacing), 0, grid - 1), clamp(Math.floor((Math.min(s.py, s.ey) - extent) / spacing), 0, grid - 1),
      clamp(Math.ceil((Math.max(s.px, s.ex) + extent) / spacing), 0, grid - 1), clamp(Math.ceil((Math.max(s.py, s.ey) + extent) / spacing), 0, grid - 1)];
    region = !region ? {x0: s.box[0], y0: s.box[1], x1: s.box[2], y1: s.box[3]} : {x0: Math.min(region.x0, s.box[0]), y0: Math.min(region.y0, s.box[1]), x1: Math.max(region.x1, s.box[2]), y1: Math.max(region.y1, s.box[3])};
  }
  // Mask writes: paint's channel, erase's clearing of planes 0..13; each [plane, target, gain, flat].
  const writes = kind === 'paint' ? (MASK_WRITES[Math.round(q.paintChannel)] || []) : kind === 'erase' ? MASK_WRITES[7] : [];
  return {op: 'stamp', kind: kcode, segs, region, settle, writes: writes.map(([p, t]) => [p, t, 1, 0]),
    u: {seed, framed: inv ? 1 : 0, natural: naturalWater ? 1 : 0, passage: kind === 'shallow' && q.shallowMode === 'passage' ? 1 : 0, settle: settle ? 1 : 0,
      radius, amount: q.amount, amountPct: clamp(q.amount / 100, 0, 1), rough: q.rough, softness: q.softness, northWiden: q.northFace ?? 0, bankScale, amp, faceVar: q.faceVariation ?? .8,
      shelves: q.shelves, beachFlat: q.beachFlatness, coreEdge: c.coreEdge, crackAmt: (kind === 'hill' || kind === 'mountain') && q.cracks > 0 ? q.cracks : 0,
      faceX: face[0], faceY: face[1], faceSide, rotX: Math.cos(turn), rotY: Math.sin(turn),
      ...(inv ? Object.fromEntries(inv.map((v, i) => ['inv' + i, v])) : {}),
      backWidth, faceWidth, tg0: hillTangents[0], tg1: hillTangents[1], tg2: hillTangents[2], tg3: hillTangents[3], mexp: 3.5 * 2 ** ((.5 - q.softness) * 1.5)}};
}

const expand = (r, m, grid) => ({x0: Math.max(0, r.x0 - m), y0: Math.max(0, r.y0 - m), x1: Math.min(grid - 1, r.x1 + m), y1: Math.min(grid - 1, r.y1 + m)});
const intersect = (a, b) => { const r = {x0: Math.max(a.x0, b.x0), y0: Math.max(a.y0, b.y0), x1: Math.min(a.x1, b.x1), y1: Math.min(a.y1, b.y1)}; return r.x0 > r.x1 || r.y0 > r.y1 ? null : r; };

// ---- the GPU side ----
// refSpacing: the final grid's spacing; the hill's blur is defined in world units (2 final cells), so a coarser level uses the whole number of its own cells nearest that distance (1 at double spacing).
export async function createShapeEngine({device, grid, spacing, baseHeight, sea, minH, maxH, refSpacing = spacing}) {
  const source = (await (await fetch('/engine-shape.wgsl')).text()).replace('/*NODE_STRUCT*/', nodeStruct());
  const module = device.createShaderModule({label: 'shape', code: source});
  const S = GPUShaderStage.COMPUTE, rw = {type: 'storage'}, ro = {type: 'read-only-storage'};
  const layout = device.createBindGroupLayout({entries: [
    {binding: 0, visibility: S, buffer: {type: 'uniform', hasDynamicOffset: true}}, {binding: 1, visibility: S, buffer: rw}, {binding: 2, visibility: S, buffer: rw},
    {binding: 3, visibility: S, buffer: rw}, {binding: 4, visibility: S, buffer: rw}, {binding: 5, visibility: S, buffer: ro}, {binding: 6, visibility: S, buffer: ro}, {binding: 7, visibility: S, buffer: rw}]});
  const pl = device.createPipelineLayout({bindGroupLayouts: [layout]});
  const pipes = {};
  for (const e of ['noise', 'stamp', 'blurH', 'blurV', 'compose', 'ground', 'init', 'pack']) pipes[e] = device.createComputePipeline({layout: pl, compute: {module, entryPoint: e}});
  const cells = grid * grid, buf = (size, usage, label) => device.createBuffer({size: Math.max(16, size), usage, label});
  const ST = GPUBufferUsage.STORAGE, CD = GPUBufferUsage.COPY_DST, CS = GPUBufferUsage.COPY_SRC;
  const F = buf(6 * cells * 4, ST | CD | CS, 'shape planes'), Mk = buf(7 * cells * 4, ST | CD | CS, 'shape masks');
  let Nz = null, Sc = null, queue = Promise.resolve(), peak = 0, last = {};
  const scratch = () => { Nz ??= buf(7 * cells * 4, ST, 'shape noise'); Sc ??= buf(3 * cells * 4, ST, 'shape scratch'); };
  const bytes = () => F.size + Mk.size + (Nz?.size || 0) + (Sc?.size || 0);

  // Evaluate `list` over `rect` (cells, inclusive; null = the whole map) and read the rectangle back.
  function run(list, ctx, rect, {readback = true, release = false} = {}) {
    const job = queue.then(() => runNow(list, ctx, rect, readback, release));
    queue = job.catch(() => {});
    return job;
  }
  async function runNow(list, ctx, rect, readback, release) {
    const t0 = performance.now();
    const R = rect ? intersect(rect, {x0: 0, y0: 0, x1: grid - 1, y1: grid - 1}) : {x0: 0, y0: 0, x1: grid - 1, y1: grid - 1};
    if (!R) return null;
    scratch();
    const geom = {grid, spacing};
    const passes = [], segData = [], mwData = [];
    let segCount = 0, mwCount = 0;
    const base = {grid, spacing, baseH: baseHeight, sea, minH, maxH, blurR: Math.max(1, Math.round(2 * refSpacing / spacing))};
    const add = (entry, region, extra = {}) => passes.push({entry, region, u: {...base, rx0: region.x0, ry0: region.y0, rx1: region.x1, ry1: region.y1, ...extra}});
    add('init', R);
    for (const n of list) {
      const p = prepareNode(n, geom, ctx);
      if (p.skip) continue;
      if (p.op === 'ground') { add('ground', R, {seed: p.seed, gAmp: p.amp, gWave: p.wave, gCover: p.cover}); continue; }
      if (!p.region) continue;
      const node = {...p.u, nseg: p.segs.length, kind: p.kind, segBase: segCount, mwBase: mwCount, nwrites: p.writes.length};
      for (const s of p.segs) {
        segData.push(s.px, s.py, s.ex, s.ey, s.f0?.[0] ?? 0, s.f0?.[1] ?? 0, s.f1?.[0] ?? 0, s.f1?.[1] ?? 0, s.nx, s.ny, s.frame ? 1 : 0, 0, {box: s.box});
      }
      segCount += p.segs.length;
      for (const w of p.writes) mwData.push(...w);
      mwCount += p.writes.length;
      const noiseRegion = expand(p.region, 1, grid), body = p.settle ? intersect(R, expand(p.region, 4, grid)) : intersect(R, p.region);
      if (!body) continue;
      add('noise', noiseRegion, node);
      if (!p.settle) { add('stamp', body, node); continue; }
      const wide = expand(body, 4, grid);
      add('stamp', wide, node);
      for (const [entry, bsrc, bdst] of [['blurH', 0, 1], ['blurV', 1, 2], ['blurH', 2, 1], ['blurV', 1, 2]]) add(entry, wide, {...node, bsrc, bdst});
      add('compose', body, node);
    }
    // Pack the rectangle for readback.
    const rw0 = R.x1 - R.x0 + 1, rh0 = R.y1 - R.y0 + 1, rc = rw0 * rh0, q4 = Math.ceil(rc / 4), outWords = 6 * rc + 25 * q4;
    if (readback) add('pack', R);
    const ub = buf(passes.length * NODE_BYTES, GPUBufferUsage.UNIFORM | CD, 'shape uniforms'), udata = new ArrayBuffer(passes.length * NODE_BYTES), dv = new DataView(udata);
    passes.forEach((pass, k) => {
      NODE_FIELDS.forEach(([name, type], j) => {
        const v = pass.u[name] ?? 0, at = k * NODE_BYTES + j * 4;
        if (type === 'f') dv.setFloat32(at, v, true); else if (type === 'u') dv.setUint32(at, v >>> 0, true); else dv.setInt32(at, v, true);
      });
    });
    device.queue.writeBuffer(ub, 0, udata);
    const sd = new ArrayBuffer(Math.max(16, segCount * 64)), sf = new Float32Array(sd), si = new Int32Array(sd);
    {
      let at = 0;
      for (const v of segData) {
        if (typeof v === 'object') { si.set(v.box, at); at += 4; } else sf[at++] = v;
      }
    }
    const SegB = buf(sd.byteLength, ST | CD, 'shape segments'), MWB = buf(Math.max(16, mwCount * 16), ST | CD, 'shape mask writes');
    device.queue.writeBuffer(SegB, 0, sd);
    if (mwCount) device.queue.writeBuffer(MWB, 0, new Float32Array(mwData));
    const OutB = buf(readback ? outWords * 4 : 16, ST | CS, 'shape out');
    const bg = device.createBindGroup({layout, entries: [
      {binding: 0, resource: {buffer: ub, size: NODE_BYTES}}, {binding: 1, resource: {buffer: F}}, {binding: 2, resource: {buffer: Mk}}, {binding: 3, resource: {buffer: Nz}},
      {binding: 4, resource: {buffer: Sc}}, {binding: 5, resource: {buffer: SegB}}, {binding: 6, resource: {buffer: MWB}}, {binding: 7, resource: {buffer: OutB}}]});
    const enc = device.createCommandEncoder({label: 'shape'}), pass = enc.beginComputePass({label: 'shape passes'});
    passes.forEach((ps, k) => {
      pass.setPipeline(pipes[ps.entry]); pass.setBindGroup(0, bg, [k * NODE_BYTES]);
      const w = ps.region.x1 - ps.region.x0 + 1, h = ps.region.y1 - ps.region.y0 + 1;
      if (ps.entry === 'pack') { const g = Math.ceil(outWords / 256), gx = Math.min(g, 65535); pass.dispatchWorkgroups(gx, Math.ceil(g / gx)); }
      else pass.dispatchWorkgroups(Math.ceil(w / 8), Math.ceil(h / 8));
    });
    pass.end();
    let stage = null;
    if (readback) { stage = buf(outWords * 4, GPUBufferUsage.MAP_READ | CD, 'shape readback'); enc.copyBufferToBuffer(OutB, 0, stage, 0, outWords * 4); }
    device.queue.submit([enc.finish()]);
    const tSubmit = performance.now();
    let out = null, tGpu = 0;
    if (readback) {
      await device.queue.onSubmittedWorkDone(); tGpu = performance.now();
      await stage.mapAsync(GPUMapMode.READ);
      const raw = stage.getMappedRange().slice(0); stage.unmap(); stage.destroy();
      out = {rect: R, width: rw0, height: rh0, floats: FIELD_KEYS_FLOAT.map((_, k) => new Float32Array(raw, k * rc * 4, rc)), masks: Array.from({length: 25}, (_, m) => new Int8Array(raw, (6 * rc + m * q4) * 4, rc))};
    } else await device.queue.onSubmittedWorkDone();
    peak = Math.max(peak, bytes() + sd.byteLength + passes.length * NODE_BYTES + (readback ? 2 * outWords * 4 : 0));
    ub.destroy(); SegB.destroy(); MWB.destroy(); OutB.destroy();
    if (release) { Nz.destroy(); Sc.destroy(); Nz = Sc = null; }
    last = {passes: passes.length, segments: segCount, ms: performance.now() - t0, prepareMs: tSubmit - t0, gpuMs: readback ? tGpu - tSubmit : performance.now() - tSubmit, readbackMs: readback ? performance.now() - tGpu : 0, cells: rc};
    return out;
  }
  // Copy a readback rectangle into row-major CPU planes of the given row stride (the planes are `grid` wide).
  function copyOut(out, planes) {
    const {rect, width, height} = out;
    for (let k = 0; k < 6; k++) { const dst = planes[FIELD_KEYS_FLOAT[k]]; for (let y = 0; y < height; y++) dst.set(out.floats[k].subarray(y * width, (y + 1) * width), (rect.y0 + y) * grid + rect.x0); }
    for (let m = 0; m < 25; m++) { const dst = planes.masks[m]; for (let y = 0; y < height; y++) dst.set(out.masks[m].subarray(y * width, (y + 1) * width), (rect.y0 + y) * grid + rect.x0); }
  }
  return {run, copyOut, bytes, stats: () => ({gpuBytes: bytes(), peakGpuBytes: peak, planeBytes: F.size, maskBytes: Mk.size, noiseBytes: Nz?.size || 0, scratchBytes: Sc?.size || 0, last}),
    destroy() { F.destroy(); Mk.destroy(); Nz?.destroy(); Sc?.destroy(); Nz = Sc = null; }, grid, spacing};
}

// ---- the fields object ----
// opts: the createRegionalFields options (worldSize, worldGrid, baseHeight, keys, maskKeys, nodes), plus device() (the GPU device, or null
// until the renderer exists), context() (the host context for prepareNode) and fallback (a createRegionalFields instance).
export function createGpuFields(opts) {
  const {worldSize, worldGrid, baseHeight, keys, maskKeys, nodes, fallback, device, context} = opts;
  const spacing = (worldSize - 1) / (worldGrid - 1), cells = worldGrid * worldGrid, listeners = new Set();
  const clip = r => ({x0: clamp(r.x0, 0, worldGrid - 1), y0: clamp(r.y0, 0, worldGrid - 1), x1: clamp(r.x1, 0, worldGrid - 1), y1: clamp(r.y1, 0, worldGrid - 1)});
  const worldRect = r => ({x: r.x0 * spacing, y: r.y0 * spacing, width: (r.x1 - r.x0) * spacing, height: (r.y1 - r.y0) * spacing});
  let revision = 0, planes = null, engine = null, enginePromise = null, valid = false, pendingRuns = 0, settled = Promise.resolve(), reason = null, error = null;
  let lastEval = {}, firstReady = 0;
  const allocate = () => { planes ??= {h: new Float32Array(cells), p: new Float32Array(cells), r: new Float32Array(cells), c: new Float32Array(cells), v: new Float32Array(cells), x: new Float32Array(cells), masks: maskKeys.map(() => new Int8Array(cells))}; };
  const live = () => nodes().filter(n => !n.hidden);
  const check = () => { reason = null; for (const n of nodes()) { const r = nodeSupport(n, context()); if (r) { reason = r; return false; } } return true; };
  const getEngine = () => enginePromise ??= (async () => {
    let d = device();
    for (let i = 0; !d && i < 600; i++) { await new Promise(r => setTimeout(r, 50)); d = device(); }   // the renderer is created after the fields
    if (!d) throw new Error('nanolathe: the GPU device is not ready for the shape passes');
    const c = context();
    return engine = await createShapeEngine({device: d, grid: worldGrid, spacing, baseHeight, sea: c.sea, minH: c.minH, maxH: c.maxH});
  })();
  const subscribeFallback = fallback?.subscribe(ev => { if (!gpuMode()) for (const fn of listeners) fn(ev); });
  let mode = true;
  const gpuMode = () => mode;
  function evaluate(rect) {
    pendingRuns++; allocate();
    const whole = !valid || !rect, r = whole ? null : clip({x0: rect.x0 - 6, y0: rect.y0 - 6, x1: rect.x1 + 6, y1: rect.y1 + 6});
    const t0 = performance.now(), list = nodes();
    settled = (async () => {
      try {
        const e = await getEngine();
        const out = await e.run(list, context(), r, {release: whole});
        if (out) { e.copyOut(out, planes); if (whole) valid = true; }
        lastEval = {ms: performance.now() - t0, whole, ...e.stats().last};
        firstReady ||= performance.now();
      } catch (err) { error = err; console.error(err); }
      finally { pendingRuns--; }
    })();
    return settled;
  }
  function changed(rect = null, keepPrefix = 0) {
    revision++;
    mode = check();
    const fb = fallback.changed(rect, keepPrefix);   // always, so the JS fields never hold a stale compiled list
    if (!mode) { valid = false; return fb; }
    const cr = rect ? clip(rect) : null;
    evaluate(cr);
    const event = {revision, rect: cr ? worldRect(cr) : null};
    for (const fn of listeners) fn(event);
    return event;
  }
  // A copy that was never filled (no evaluation ran, or the last one failed) is started here, so a reader that waits cannot wait forever.
  const whenReady = async () => { if (mode && !valid && pendingRuns === 0) evaluate(null); while (pendingRuns > 0) await settled; };
  const front = () => mode ? null : fallback;
  function crop(request) {
    const rect = clip({x0: Math.floor(request.x0), y0: Math.floor(request.y0), x1: Math.ceil(request.x1), y1: Math.ceil(request.y1)});
    const w = rect.x1 - rect.x0 + 1, h = rect.y1 - rect.y0 + 1, fields = {};
    const cut = (src, ctor) => { const out = new ctor(w * h); for (let y = 0; y < h; y++) out.set(src.subarray((rect.y0 + y) * worldGrid + rect.x0, (rect.y0 + y) * worldGrid + rect.x0 + w), y * w); return out; };
    for (const k of FIELD_KEYS_FLOAT) fields[k] = cut(planes[k], Float32Array);
    maskKeys.forEach((k, j) => { fields[k] = cut(planes.masks[j], Int8Array); });
    return {fields, maskPlanes: maskKeys.map(k => fields[k]), gridWidth: w, gridHeight: h, gridSpacing: spacing, gridOrigin: [rect.x0 * spacing, rect.y0 * spacing], worldSize, worldGrid, revision,
      bytes: w * h * (24 + maskKeys.length), rect: worldRect(rect)};
  }
  function readCells(request, o) {
    if (front()) return fallback.readCells(request, o);
    if (!planes || !valid) throw new Error('nanolathe: the GPU shape fields are not ready; await ready() or readAsync() first');
    return crop(request);
  }
  const read = ({x = 0, y = 0, width = 0, height = width, apron = 0}, o) => readCells({x0: Math.floor((x - apron) / spacing), y0: Math.floor((y - apron) / spacing), x1: Math.ceil((x + width + apron) / spacing), y1: Math.ceil((y + height + apron) / spacing)}, o);
  const cell = (ix, iy, key = 'h') => {
    if (front()) return fallback.cell(ix, iy, key);
    ix = clamp(Math.round(ix), 0, worldGrid - 1); iy = clamp(Math.round(iy), 0, worldGrid - 1);
    if (!planes || !valid) return key === 'h' ? baseHeight : 0;
    const j = maskKeys.indexOf(key);
    return j >= 0 ? planes.masks[j][iy * worldGrid + ix] : planes[key][iy * worldGrid + ix];
  };
  const sample = (x, y, key = 'h') => {
    if (front()) return fallback.sample(x, y, key);
    const gx = clamp(x / spacing, 0, worldGrid - 1), gy = clamp(y / spacing, 0, worldGrid - 1), ix = Math.floor(gx), iy = Math.floor(gy);
    const jx = Math.min(ix + 1, worldGrid - 1), jy = Math.min(iy + 1, worldGrid - 1), fx = gx - ix, fy = gy - iy;
    return (cell(ix, iy, key) * (1 - fx) + cell(jx, iy, key) * fx) * (1 - fy) + (cell(ix, jy, key) * (1 - fx) + cell(jx, jy, key) * fx) * fy;
  };
  const stats = () => {
    if (front()) return fallback.stats();
    const g = engine?.stats() || {}, cpu = planes ? cells * (24 + maskKeys.length) : 0;
    return {revision, residentBytes: cpu, cacheBytes: cpu, cacheEntries: planes ? 1 : 0, lastWorkingBytes: 0, peakBytes: cpu, budget: cpu, hits: 0, misses: 0, replays: 0, evictions: 0,
      chunkCells: worldGrid, worldSize, worldGrid, gridSpacing: spacing, bytesPerCell: 24 + maskKeys.length, workspaceBytesPerCell: 0, maxWorkingCells: 0, pointSamples: 0,
      connectionTiles: 0, connectionCells: 0, gpuShape: {...g, cpuCopyBytes: cpu, pending: pendingRuns, lastEval, error: error?.message || null}};
  };
  return {
    buffers: () => front() ? fallback.buffers() : planes ? [...FIELD_KEYS_FLOAT.map(k => planes[k].buffer), ...planes.masks.map(a => a.buffer)] : [],
    read, readCells, sample, cell, changed, ready: () => front() ? Promise.resolve() : whenReady(), pending: () => !front() && (pendingRuns > 0 || !valid),
    readAsync: async (request, o) => { await (front() ? null : whenReady()); return read(request, o); },
    replayDetail: () => front() ? fallback.replayDetail() : Object.fromEntries(keys.map(k => [k, 0])),
    subscribe(fn) { listeners.add(fn); return () => listeners.delete(fn); },
    setBudget: bytes => fallback.setBudget(bytes),
    clear: () => { fallback.clear(); },
    stats, reason: () => reason, active: () => mode, reference: () => mode ? fallback : null,
    maskChunks: () => {
      if (front()) return fallback.maskChunks();
      if (!planes || !valid) return [];
      const out = [], T = 256;
      for (let ty = 0; ty < worldGrid; ty += T) for (let tx = 0; tx < worldGrid; tx += T) {
        const r = {x0: tx, y0: ty, x1: Math.min(tx + T, worldGrid) - 1, y1: Math.min(ty + T, worldGrid) - 1}, c = crop({x0: r.x0, y0: r.y0, x1: r.x1, y1: r.y1});
        if (!maskKeys.some(k => c.fields[k].some(v => v !== 0))) continue;
        out.push({key: [r.x0, r.y0, r.x1, r.y1].join('_'), rect: c.rect, gridWidth: c.gridWidth, gridHeight: c.gridHeight, gridOrigin: c.gridOrigin, gridSpacing: spacing, revision, version: revision,
          planes: maskKeys.map(k => c.fields[k]), masks: Object.fromEntries(maskKeys.map(k => [k, c.fields[k]]))});
      }
      return out;
    },
    planes: () => planes, engine: () => engine,
  };
}

// ---- the check tool's comparison (repro/shapecheck.mjs reads it through sculptDebug.shapeCompare) ----
// Compares two sets of planes {h,p,r,c,v,x, masks:[25 Int8Array]} of `grid` x `grid` cells. Float planes: max |d| and the share of cells over
// 0.01, 0.5 and 1 unit; masks: the share over 0, exactly 1 step and over 1 step. Height clusters over 0.5 are 4-connected components.
export function comparePlanes(a, b, grid, maskKeys) {
  const out = {planes: {}, clusters: []}, n = grid * grid;
  for (const k of FIELD_KEYS_FLOAT) {
    let max = 0, o01 = 0, o05 = 0, o1 = 0, bad = 0;
    for (let i = 0; i < n; i++) { const d = Math.abs(a[k][i] - b[k][i]); if (!(d === d)) { bad++; continue; } if (d > max) max = d; if (d > .01) o01++; if (d > .5) o05++; if (d > 1) o1++; }
    out.planes[k] = {max, over001: o01 / n, over05: o05 / n, over1: o1 / n, nan: bad};
  }
  maskKeys.forEach((k, j) => {
    let max = 0, o0 = 0, exact1 = 0, more = 0;
    for (let i = 0; i < n; i++) { const d = Math.abs(a.masks[j][i] - b.masks[j][i]); if (d > max) max = d; if (d > 0) o0++; if (d === 1) exact1++; else if (d > 1) more++; }
    out.planes[k] = {max, over0: o0 / n, exactly1: exact1 / n, over1: more / n, cellsOver0: o0, cellsExactly1: exact1, cellsOver1: more};
  });
  const seen = new Uint8Array(n);
  for (let s = 0; s < n; s++) {
    if (seen[s] || !(Math.abs(a.h[s] - b.h[s]) > .5)) continue;
    const stack = [s]; seen[s] = 1; let cells = 0, max = 0, at = s, x0 = grid, y0 = grid, x1 = 0, y1 = 0;
    while (stack.length) {
      const i = stack.pop(), x = i % grid, y = (i - x) / grid, d = Math.abs(a.h[i] - b.h[i]);
      cells++; if (d > max) { max = d; at = i; } x0 = Math.min(x0, x); x1 = Math.max(x1, x); y0 = Math.min(y0, y); y1 = Math.max(y1, y);
      for (const j of [x > 0 ? i - 1 : -1, x < grid - 1 ? i + 1 : -1, y > 0 ? i - grid : -1, y < grid - 1 ? i + grid : -1]) if (j >= 0 && !seen[j] && Math.abs(a.h[j] - b.h[j]) > .5) { seen[j] = 1; stack.push(j); }
    }
    out.clusters.push({cells, max, at: [at % grid, Math.floor(at / grid)], box: [x0, y0, x1, y1], a: a.h[at], b: b.h[at]});
  }
  out.clusters.sort((p, q) => q.cells - p.cells); out.clusterCount = out.clusters.length; out.clusters = out.clusters.slice(0, 12);
  return out;
}
