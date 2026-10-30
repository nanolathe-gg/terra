// H6 (Green): shape on the GPU. Evaluates the brushes Green's windows use (paint, erase, deep, shallow, mountain, hill and the ground
// node) with the compute passes of engine-shape.wgsl, and keeps a CPU copy of the 31 authored planes that the existing consumers read.
//
//   createShapeEngine   the GPU side: node preparation (path simplification, frames, boxes: the JS engine's own arithmetic), the
//                       passes, and the readback of a rectangle.
//   createGpuFields     the same object as createRegionalFields (read, readCells, sample, cell, changed, clear, revision, stats...)
//                       for a map, over one whole-map evaluation; a node the passes do not draw draws nothing.
//
// The CPU copy is refreshed asynchronously: changed() starts a GPU evaluation of the dirty rectangle and a readback of just that
// rectangle; read() waits (readAsync/ready) so a bake never sees a half-written copy and the frame never waits.

const FIELD_KEYS_FLOAT = ['h', 'p', 'r', 'c', 'v', 'x'];
const KIND = {paint: 0, erase: 1, deep: 2, shallow: 3, mountain: 4, hill: 5, plateau: 6, offset: 7, lower: 8, sand: 9, grass: 10, smooth: 11, ramp: 12, crater: 13, fissure: 14, crystal: 15};
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
const STYLE_PLANES = [5, 6, 7, 8, 14, 15, 16, 17], MASK_SHAPES = ['plateau', 'offset', 'hill', 'mountain', 'crater', 'deep', 'shallow'];
// H9: maskSetup() of sculpt.js for a landform or water stroke: its Paint-inside choice, style writes (target already carries the amount) and a water
// stroke's edge and bed flags (written at full strength, `flat`). Each entry is [plane, target, gain, flat].
function shapeMaskWrites(kind, q, sat) {
  if (!MASK_SHAPES.includes(kind) || sat) return [];
  const gain = clamp(q.maskAmount, 0, 1), out = (MASK_WRITES[Math.round(q.maskChannel)] || []).map(([p, t]) => [p, t, gain, 0]);
  STYLE_KEYS.forEach((k, j) => { const v = clamp(q[k] || 0, -1, 1); if (Math.abs(v) >= .005) out.push([STYLE_PLANES[j], Math.round(127 * v), 1, 0]); });
  if (kind === 'deep' || kind === 'shallow') WATER_KEYS.forEach((k, j) => {
    const c = Math.round(q[k] || 0);
    if (c < 1 || c > (k === 'waterBed' ? 3 : 2)) return;
    out.push([9 + j, c === 2 ? -127 : 127, 1, 1]);
    if (k === 'waterBed') out.push([13, c === 3 ? 127 : 0, 1, 1]);
  });
  return out;
}

// The uniform struct, in one list so the WGSL and the writer cannot drift apart: [name, type] with type f (f32), u (u32), i (i32).
const NODE_FIELDS = [
  ...['cgForm', 'fcMode', 'fcSkin'].map(k => [k, 'u']), ...['fcL', 'fcStrength', 'fcStep', 'fcShare'].map(k => [k, 'f']), ...['cgSize', 'cgFacet', 'cgSizeVar', 'cgSmooth', 'cgTiers', 'cgStep', 'cgVar', 'bgFace', 'bgTilt', 'bgFlat', 'bgRough', 'bgTx', 'bgTy', 'bgJit', 'bgAlign', 'bgBreak', 'bgTurn'].map(k => [k, 'f']),
  ...['plMat'].map(k => [k, 'u']), ...['plWater', 'plLand', 'plSize', 'plGap', 'plHeight', 'plScale', 'plSeam', 'plNeedles', 'frGapSize', 'frGapDepth', 'frGaps', 'frGapReach'].map(k => [k, 'f']),
  ...['grid', 'kind', 'nseg', 'seed', 'framed', 'natural', 'passage', 'settle', 'nwrites', 'segBase', 'mwBase', 'bsrc', 'bdst', 'blurR', 'pw', 'ph', 'direct', 'preIdx', 'olFlat', 'olMoon', 'olS0', 'olS1', 'olS2', 'bpOffset', 'plain', 'ridge', 'hole', 'hSeed', 'nSect', 'nGap', 'sOn', 'sWater', 'sDome', 'sSteps', 'sShelfSteps', 'coPutW', 'coMoved', 'coSrc', 'coScal', 'coN', 'coSNI', 'coSNJ', 'coFlatOn'].map(k => [k, 'u']),
  ...['rx0', 'ry0', 'rx1', 'ry1', 'ox', 'oy', 'coStep', 'coSI0', 'coSJ0', 'coBx0', 'coBy0', 'coBx1', 'coBy1'].map(k => [k, 'i']),
  ...['spacing', 'baseH', 'sea', 'minH', 'maxH', 'radius', 'amount', 'amountPct', 'rough', 'softness', 'northWiden', 'bankScale', 'amp', 'faceVar', 'shelves',
    'beachFlat', 'coreEdge', 'crackAmt', 'faceX', 'faceY', 'faceSide', 'rotX', 'rotY', 'inv0', 'inv1', 'inv2', 'inv3', 'inv4', 'inv5', 'backWidth', 'faceWidth',
    'tg0', 'tg1', 'tg2', 'tg3', 'mexp', 'gAmp', 'gWave', 'gCover', 'mesaFlank', 'qx', 'qy', 'cOffX', 'cOffY', 'rimH', 'ejecta', 'fHw', 'fKf', 'fJag', 'fAmp', 'fCell', 'fCrack', 'fNet', 'fDark', 'cTop', 'bankFlat', 'olAmp', 'olLo', 'olHi', 'olW0', 'olL0', 'olW1', 'olL1', 'olW2', 'olL2', 'bpAmp', 'hx', 'hy', 'hR', 'hRough', 'gapHw', 'sBed', 'sApron', 'sApronH', 'sFace', 'sShare', 'sCurve', 'sFlat', 'sJit', 'sLip', 'sCapW', 'sCapRise', 'sCapExp', 'sBank', 'sShelf', 'sShelfD', 'sVary', 'coFar', 'coLimit', 'coFReach', 'coFAmt', 'coFLow', 'cfAmount', 'cfSpread', 'cfSize', 'coW', 'coLedge', 'coIrr', 'coVary', 'coSpread', 'coMeander', 'coRc', 'coCV', 'coLReach', 'coRiser', 'coRs'].map(k => [k, 'f'])];
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
// fissurePieces() of sculpt.js: the main cut cut into short pieces, and branches (each forking once) grown from roots along it. f: fissureSetup's values.
const rand01 = (seed, a, b) => hash(a, b, seed) * .5 + .5;
const mkPiece = (a, b, r0, r1, h0, h1, jag = 0) => ({a, b, r0, r1, h0, h1, jag, reach: Math.max(r0, r1)});
function fissurePieces(f, path, s, seed, radius) {
  const out = [], taper = s.fissureTaper, cum = [0];
  for (let k = 1; k < path.length; k++) cum.push(cum[k - 1] + Math.hypot(path[k].x - path[k - 1].x, path[k].y - path[k - 1].y));
  const L = cum[cum.length - 1], longest = Math.max(16, Math.min(radius * 1.5, 60)), ends = (a, len) => { const e = len > 0 ? Math.min(a / len, 1 - a / len) : 1; return 1 - smooth(0, .3, e); };
  const taperW = u => 1 - .7 * taper * u, taperD = u => 1 - .55 * taper * u;
  if (path.length < 2) out.push(mkPiece(path[0], null, 1, 1, 1, 1));
  for (let k = 1; k < path.length; k++) {
    const a = path[k - 1], b = path[k], len = cum[k] - cum[k - 1], n = Math.max(1, Math.ceil(len / longest));
    for (let j = 0; j < n; j++) {
      const f0 = j / n, f1 = (j + 1) / n, e0 = ends(cum[k - 1] + len * f0, L), e1 = ends(cum[k - 1] + len * f1, L);
      out.push(mkPiece({x: a.x + (b.x - a.x) * f0, y: a.y + (b.y - a.y) * f0}, {x: a.x + (b.x - a.x) * f1, y: a.y + (b.y - a.y) * f1}, taperW(e0), taperW(e1), taperD(e0), taperD(e1)));
    }
  }
  const N = Math.round(clamp(s.fissureBranches, 0, 12));
  if (N < 1 || L <= 0 || f.net) return out;
  const spread = s.fissureBranchSpread, rnd = (a, b) => rand01(seed, a, b + 0x5f3);
  const grow = (x, y, heading, len, w0, d0, id, level) => {
    const step = len / 3;
    let h = heading, px = x, py = y;
    for (let j = 0; j < 3; j++) {
      h += (rnd(id, 30 + j) - .5) * .7;
      const nx = px + Math.cos(h) * step, ny = py + Math.sin(h) * step, u0 = j / 3, u1 = (j + 1) / 3;
      out.push(mkPiece({x: px, y: py}, {x: nx, y: ny}, w0 * (1 - .75 * taper * u0), w0 * (1 - .75 * taper * u1), d0 * (1 - .7 * taper * u0), d0 * (1 - .7 * taper * u1)));
      if (level === 0 && j === 1 && rnd(id, 40) < .7) grow(nx, ny, h + (rnd(id, 41) < .5 ? -1 : 1) * (.5 + .6 * rnd(id, 42)), len * .5, w0 * .7, d0 * .85, id + 100, 1);
      px = nx; py = ny;
    }
  };
  for (let k = 0; k < N; k++) {
    const at = L * (.08 + .84 * (k + .2 + .6 * rnd(k, 11)) / N), side = ((k + (rnd(k, 12) < .25 ? 1 : 0)) & 1) ? 1 : -1;
    let i = 1; while (i < cum.length - 1 && cum[i] < at) i++;
    const a = path[i - 1], b = path[i], fr = (at - cum[i - 1]) / Math.max(cum[i] - cum[i - 1], 1e-6);
    grow(a.x + (b.x - a.x) * fr, a.y + (b.y - a.y) * fr, Math.atan2(b.y - a.y, b.x - a.x) + side * (.45 + .95 * spread) * (.7 + .6 * rnd(k, 13)), s.fissureBranchLen * f.kf * (.5 + .9 * rnd(k, 14)), .75, .85, k, 0);
  }
  return out;
}
const hillKnots = [.67, .78, .89, 1], hillRise = [1, .34, .02, 0];
const hillTangents = hillKnots.map((_, i) => {
  if (!i || i === hillKnots.length - 1) return 0;
  const a = (hillRise[i] - hillRise[i - 1]) / (hillKnots[i] - hillKnots[i - 1]);
  const b = (hillRise[i + 1] - hillRise[i]) / (hillKnots[i + 1] - hillKnots[i]);
  return a * b > 0 ? 2 * a * b / (a + b) : 0;
});

const BASE_KINDS = ['plateau', 'offset', 'hill', 'mountain'], SECTION_KINDS = ['plateau', 'offset', 'hill', 'mountain', 'deep', 'shallow'];
// sectionSetup(): the cross-section's constants for a stroke, as shader uniforms (the per-step wobble weights are computed in the shader).
function sectionUniforms(kind, q, c) {
  if (!(q.profile >= .5) || !SECTION_KINDS.includes(kind)) return {};
  const water = kind === 'deep' || kind === 'shallow', dome = kind === 'hill' || kind === 'mountain', crown = dome ? q.crown : 0;
  return {sOn: 1, sWater: water ? 1 : 0, sDome: dome ? 1 : 0, sBed: c.sea + (kind === 'deep' ? -55 : -7), sApron: q.apronPx, sApronH: q.apronHeight, sFace: q.facePx, sShare: clamp(.38 + (q.softness - .5) * .6, .1, .88),
    sCurve: q.faceCurve, sSteps: Math.round(clamp(q.terraces, 0, 8)), sFlat: Math.min(q.ledge, .95), sJit: q.terraceJitter, sLip: q.lip, sCapW: .55 * crown, sCapRise: .45 * crown, sCapExp: 1 + 2 * crown,
    sBank: q.bankPx, sShelf: q.shelfPx, sShelfD: q.shelfDepth, sShelfSteps: Math.round(clamp(q.shelfSteps, 0, 6)), sVary: (q.faceVariation ?? .8) * .5};
}
// H9: the outline displacement of baseOutline (Desert's baseVary, px) and moonOutline (Moon's moonLobes, a share of the radius) as the parameters of
// one shader function: amplitude in radius units, the smoothstep window on r (none for an offset), and up to three noise terms (weight, wavelength px, salt).
function outlineUniforms(kind, q, radius) {
  if (BASE_KINDS.includes(kind) && q.baseVary > 0) {
    return {olAmp: Math.min(q.baseVary, .15 * radius) / radius, olFlat: kind === 'offset' ? 1 : 0, olLo: .5, olHi: .95, olMoon: 0, olW0: .6, olL0: 55, olS0: 0x2e83, olW1: .4, olL1: 21, olS1: 0x71d5, olW2: 0, olL2: 1, olS2: 0};
  }
  if ((kind === 'hill' || kind === 'mountain') && q.moonLobes > 0) {
    return {olAmp: q.moonLobes, olFlat: 0, olLo: .25, olHi: .8, olMoon: 1, olW0: .55, olL0: radius * .5, olS0: 0x5a31, olW1: .3, olL1: radius * .18, olS1: 0x2c47, olW2: .15, olL2: radius * .07, olS2: 0x7d13};
  }
  return {};
}
// H9: line features (card C4): lineMultipliers, spurPieces, ridgePieces of sculpt.js, the seeded arithmetic that lays out a ridge's crest and spurs as short pieces.
const ridgeOn = (kind, o) => (kind === 'hill' || kind === 'mountain') && (Math.round(o.spurCount) >= 1 || o.crestJag > 0 || o.crestVary > 0 || o.crestTaper > 0);
function lineMultipliers(s, a, len, salt, taper, ends) {
  const R = s.radius, f = len > 0 ? clamp(a / len, 0, 1) : 0, u = ends ? 1 - smooth(0, .4, Math.min(f, 1 - f)) : smooth(0, 1, f), n = valueNoise(a / (R * 2.2), .37, s.seed ^ salt), m = valueNoise(a / (R * 1.6), 2.9, s.seed ^ (salt + 0x55));
  return [clamp(1 + .45 * s.crestVary * n, .6, 1.4) * (1 - .62 * taper * u) * (ends ? 1 : 1 + .5 * (1 - smooth(0, .4, f))), (1 - .45 * s.crestVary * (.5 - .5 * m)) * (1 - .7 * taper * u)];
}
function spurPieces(s, roots, fade, jag) {
  const kf = s.inv ? 1 / Math.hypot(s.inv[0], s.inv[1]) : 1, spread = s.spurSpread, bulb = s.spurBulb, out = [];
  const grow = (x, y, heading, len, rootR, rootH, k, level, rootFade) => {
    const step = len / 3, curl = (.1 + .3 * spread) * Math.PI, salt = 0x300 + k * 97;
    let h = heading;
    for (let j = 0; j < 3; j++) {
      h += (rand01(s.seed, k, 20 + j) - .5) * curl;
      const nx = x + Math.cos(h) * step, ny = y + Math.sin(h) * step, m0 = lineMultipliers(s, step * j, len, salt, s.spurTaper, false), m1 = lineMultipliers(s, step * (j + 1), len, salt, s.spurTaper, false);
      let r0 = m0[0], r1 = m1[0], e0 = m0[1], e1 = m1[1];
      if (bulb > 0) { const b0 = bulb * smooth(.5, 1, j / 3), b1 = bulb * smooth(.5, 1, (j + 1) / 3); r0 += b0 * .7; r1 += b1 * .7; e0 += (1 - e0) * b0; e1 += (1 - e1) * b1; }
      out.push(mkPiece({x, y}, {x: nx, y: ny}, rootR * r0, rootR * r1, rootH * e0 * (j ? 1 : rootFade), rootH * e1, jag));
      if (j === 1 && level === 0 && s.spurForks > 0 && rand01(s.seed, k, 50) < s.spurForks)
        grow(nx, ny, h + (rand01(s.seed, k, 51) < .5 ? -1 : 1) * (.5 + .6 * rand01(s.seed, k, 52)), len * .5, rootR * r1 * .85, rootH * e1 * .85, k + 100, 1, 1);
      x = nx; y = ny;
    }
  };
  for (const root of roots) {
    const k = root.k;
    grow(root.x, root.y, root.heading, s.spurLength * kf * (.55 + .9 * rand01(s.seed, k, 14)), s.spurWidth * (.85 + .3 * rand01(s.seed, k, 15)), s.spurHeight, k, 0, fade);
  }
  return out;
}
function ridgePieces(s, path) {
  const cum = [0], longest = Math.max(16, s.radius * 1.5), out = [];
  for (let k = 1; k < path.length; k++) cum.push(cum[k - 1] + Math.hypot(path[k].x - path[k - 1].x, path[k].y - path[k - 1].y));
  const L = cum[cum.length - 1], jag = s.crestJag;
  if (path.length < 2) out.push(mkPiece(path[0], null, 1, 1, 1, 1, jag));
  for (let k = 1; k < path.length; k++) {
    const a = path[k - 1], b = path[k], len = cum[k] - cum[k - 1], n = Math.max(1, Math.ceil(len / longest));
    for (let j = 0; j < n; j++) {
      const f0 = j / n, f1 = (j + 1) / n, m0 = lineMultipliers(s, cum[k - 1] + len * f0, L, 0x71d, s.crestTaper, true), m1 = lineMultipliers(s, cum[k - 1] + len * f1, L, 0x71d, s.crestTaper, true);
      out.push(mkPiece({x: a.x + (b.x - a.x) * f0, y: a.y + (b.y - a.y) * f0}, {x: a.x + (b.x - a.x) * f1, y: a.y + (b.y - a.y) * f1}, m0[0], m1[0], m0[1], m1[1], jag));
    }
  }
  const N = Math.round(clamp(s.spurCount, 0, 12));
  if (N < 1) return out;
  const roots = [], spread = s.spurSpread, phase = rand01(s.seed, 7, 0x4b1) * Math.PI * 2;
  for (let k = 0; k < N; k++) {
    if (L <= 0) { roots.push({x: path[0].x, y: path[0].y, heading: phase + Math.atan2(s.rot[1], s.rot[0]) + Math.PI * 2 * (k + (rand01(s.seed, k, 11) - .5) * .5) / N, k}); continue; }
    const at = L * (.08 + .84 * (k + .2 + .6 * rand01(s.seed, k, 11)) / N), side = ((k + (rand01(s.seed, k, 12) < .25 ? 1 : 0)) & 1) ? 1 : -1;
    let i = 1; while (i < cum.length - 1 && cum[i] < at) i++;
    const a = path[i - 1], b = path[i], f = (at - cum[i - 1]) / Math.max(cum[i] - cum[i - 1], 1e-6);
    roots.push({x: a.x + (b.x - a.x) * f, y: a.y + (b.y - a.y) * f, heading: Math.atan2(b.y - a.y, b.x - a.x) + side * (.7 + .95 * spread) * (.75 + .5 * rand01(s.seed, k, 13)), k});
  }
  return out.concat(spurPieces(s, roots, 1, jag));
}
// The crater's lobed outline at an authoring-frame position (craterLobe in sculpt.js).
function craterLobe(s, lx, ly) {
  const R = s.radius, sc = Math.max(R * .55, 8);
  return 1 + s.rough * (.38 * valueNoise(lx / (R * .95), ly / (R * .95), s.seed ^ 0x4a7) + .22 * valueNoise(lx / sc, ly / sc, s.seed ^ 0x1c3) + .1 * valueNoise(lx / (sc * .6), ly / (sc * .6), s.seed ^ 0x2d9));
}
// rimSetup(): a crater's rim sectors and gaps, or null when both are off.
function craterRim(q, seed) {
  const N = Math.round(clamp(q.rimSectors, 0, 8)), G = Math.round(clamp(q.rimGaps, 0, 4));
  if (N < 2 && G < 1) return null;
  const rnd = (a, b) => rand01(seed, a, b + 0x3c5), un = clamp(q.rimUnequal, 0, 1), tau = Math.PI * 2, phase = rnd(0, 1) * tau, sect = [], gaps = [];
  if (N >= 2) for (let k = 0; k < N; k++) { const r = rnd(k, 2); sect.push({a: phase + tau * (k + (rnd(k, 3) - .5) * .5) / N, h: 1 - .85 * un * (1 - r), w: 1 + un * (1.8 * r * (.6 + .4 * rnd(k, 4)) - .4)}); }
  const gphase = rnd(9, 9) * tau;
  for (let k = 0; k < G; k++) gaps.push(gphase + tau * (k + (rnd(k, 5) - .5) * .4) / G);
  return {sect: sect.map(c => ({...c, rel: c.a - sect[0].a})), gaps, hw: clamp(q.rimGapWidth, 10, 180) * Math.PI / 360};
}
// ---- node preparation ----
// What the passes draw: every kind in KIND with at least one point (and the ground node). prepareNode returns {skip:true} for any other node,
// which draws nothing, and for a node that writes nothing, else {op:'ground'|'stamp', ...}. `c` is the host's context (see shapeContext in sculpt.js).

// The smooth brush's box blur radius in cells: sculpt.js's clamp(round(radius / (7 spacing)), 1, 24) at the final grid, scaled to this level's spacing.
export const smoothRadius = (radius, {spacing, refSpacing = spacing}) => Math.max(1, Math.round(clamp(Math.round(radius / (refSpacing * 7)), 1, 24) * refSpacing / spacing));
export function prepareNode(n, geom, c) {
  if (n.hidden || c.skipKind(n.kind) || (n.kind !== 'ground' && (!(n.kind in KIND) || !n.points?.length))) return {skip: true};
  const {grid, spacing} = geom;
  if (n.kind === 'ground') return {op: 'ground', seed: (n.seed ?? 1) >>> 0, amp: n.amplitude ?? 8, wave: n.wavelength ?? 160, cover: n.coverage ?? .5};
  const q = c.params(n), kind = n.kind, kcode = KIND[kind];
  const frame = isIdentity(n.frame) ? null : n.frame, inv = frame ? invert(frame) : null, turn = frame ? Math.atan2(frame[1], frame[0]) : 0;
  const seed = ((n.seed ?? c.seed) >>> 0), pts = n.points, radius = q.radius;
  const water = kind === 'deep' || kind === 'shallow', naturalWater = kind === 'deep' && c.natural;
  const naturalPlateau = ['erase', 'paint', 'plateau', 'offset', 'sand', 'grass'].includes(kind) && c.edgesNatural, plainHill = kind === 'hill' && (q.profile >= .5 || ridgeOn(kind, q)), shouldered = kind === 'hill' && !plainHill;
  const bankScale = water ? 2 ** ((q.bankWidth - .5) * 1.3) : 1;
  const faceWidth = .66 + (q.softness - .5) * .9, backWidth = q.softness === .5 ? 1.34 : 2 - faceWidth;
  // fissureSetup(): the cut's half width in px (scaled by the frame), the zigzag amplitude, and how far a cell feels a piece.
  const fis = kind === 'fissure' ? (() => {
    const kf = inv ? 1 / Math.hypot(inv[0], inv[1]) : 1, hw0 = Math.max(q.fissureWidth, 1) * .5, hw = hw0 * kf, net = q.fissureNetwork >= .5, jag = q.fissureJag, famp = hw * (.5 + 2.2 * jag) + 1;
    return {kf, hw0, hw, net, jag, amp: famp, reach: net ? radius * 1.05 + hw + 8 : hw * 3.5 + famp + 6};
  })() : null;
  const amp = kind === 'crater' ? q.rough * radius * .45 : kind === 'ramp' ? q.rough * radius * .14 : q.rough * radius * (naturalWater ? 1.1 : naturalPlateau ? .95 : shouldered ? .85 : .2);
  const extent = fis ? fis.reach : kind === 'crater' ? radius * 1.9 * (1 + .45 * q.rough) + 2 * amp : radius * (naturalWater ? Math.min(1.9, 1 + q.rough * 1.6) : naturalPlateau ? Math.min(1.7, 1 + q.rough * 1.3) : shouldered ? Math.max(1.4, backWidth) : 1) * bankScale + 2 * amp + (water && !(q.profile >= .5) ? Math.max(0, q.bankPx || 0) : 0) + (q.baseVary > 0 ? q.baseVary : 0) + (q.moonLobes > 0 ? q.moonLobes * radius : 0);
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
  const segs = [], extra = [];
  let reads = kind === 'plateau' || kind === 'crater' ? [{x: pts[0].x, y: pts[0].y}] : [];
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
  } else if (kind === 'crystal') {
    // crystalList() (the pyramid form): crystals scattered along the path and within the brush, each a polygon of planes that meets at the apex.
    const rnd = (k, a) => { let x = Math.imul((seed >>> 0) + k * 7919 + a * 104729, 2654435761) >>> 0; x ^= x >>> 15; x = Math.imul(x, 2246822519) >>> 0; x ^= x >>> 13; return (x >>> 0) / 4294967296; };
    const path = simplifyPath(pts, Math.max(1, radius * .05)), lengths = [0], form = q.crystalForm >= 1.5 ? 2 : q.crystalForm >= .5 ? 1 : 0;
    for (let k = 1; k < path.length; k++) lengths.push(lengths[k - 1] + Math.hypot(path[k].x - path[k - 1].x, path[k].y - path[k - 1].y));
    if (form === 1) {
      // Column mound (stampColumns): the shader evaluates the lattice of columns round every cell, so the host hands over the simplified path (the mound's distance) and the box.
      const pad = radius * 1.4, ax = Math.min(...path.map(p => p.x)), ay = Math.min(...path.map(p => p.y)), bx = Math.max(...path.map(p => p.x)), by = Math.max(...path.map(p => p.y));
      const box = [Math.max(0, Math.floor((ax - pad) / spacing)), Math.max(0, Math.floor((ay - pad) / spacing)), Math.min(grid - 1, Math.ceil((bx + pad) / spacing)), Math.min(grid - 1, Math.ceil((by + pad) / spacing))];
      for (let k = 0; k < path.length; k++) { const a = path[k], b = path[Math.min(k + 1, path.length - 1)]; segs.push({px: a.x, py: a.y, ex: b.x, ey: b.y, f0: [0, 0], f1: [0, 0], nx: 0, ny: 0, box}); }
    } else {
    const total = lengths[lengths.length - 1], count = Math.max(1, Math.round(q.crystalCount * (1 + total / Math.max(8, radius * 1.2))));
    const variation = q.crystalVariation, scale = inv ? 1 / Math.hypot(inv[0], inv[1]) : 1, crystalSize = q.crystalSize * scale;
    for (let k = 0; k < count; k++) {
      const along = rnd(k, 1) * total; let j = 1; while (j < path.length - 1 && lengths[j] < along) j++;
      const a = path[j - 1], b = path[j] || a, f = lengths[j] > lengths[j - 1] ? (along - lengths[j - 1]) / (lengths[j] - lengths[j - 1]) : 0;
      const spread = form === 2 && k === 0 ? 0 : Math.pow(rnd(k, 2), .8), angle = rnd(k, 3) * Math.PI * 2 + turn;
      const cx = a.x + (b.x - a.x) * f + Math.cos(angle) * spread * radius, cy = a.y + (b.y - a.y) * f + Math.sin(angle) * spread * radius;
      const width = crystalSize * (1 + variation * (rnd(k, 4) - .5) * 1.2) * (1 - .4 * spread);
      const height = q.amount * (1 - .45 * spread) * (1 + variation * (rnd(k, 5) - .5)) * Math.min(1.3, width / (Math.max(4, q.crystalSize) * scale));
      const sides = clamp(Math.round(q.crystalSides + variation * (rnd(k, 6) - .5) * 2.4), 3, 12), R = width / 2, lean = q.crystalLean * R * .75 * rnd(k, 7), leanAngle = rnd(k, 8) * Math.PI * 2 + turn;
      if (form === 2) {
        // A berg (stampBergs): the lowest of its face planes and broken-corner planes; the shader adds the waving of each outline from the plane's salt.
        const nP = clamp(Math.round(sides), 3, 12), jit = clamp(q.bergJitter, 0, 1), align = clamp(q.crystalAlign, 0, 1), rot0 = turn + (1 - align) * rnd(k, 9) * Math.PI * 2, edgeB = extra.length, reachB = R * 1.55, nBreak = Math.round(q.bergBreak);
        for (let e = 0; e < nP; e++) { const a = rot0 + (e + jit * (rnd(k, 40 + e) - .5) * .7) * Math.PI * 2 / nP; extra.push([Math.cos(a), Math.sin(a), R * Math.cos(Math.PI / nP) * (1 + jit * (rnd(k, 60 + e) - .5) * .6), q.bergFace * (1 + jit * (rnd(k, 80 + e) - .5) * 1.2)]); }
        for (let j = 0; j < nBreak; j++) { const a = rnd(k, 100 + j) * Math.PI * 2; extra.push([Math.cos(a), Math.sin(a), R * (.55 + .35 * rnd(k, 120 + j)), q.bergFace * (.55 + .9 * rnd(k, 140 + j))]); }
        const boxB = [Math.max(0, Math.floor((cx - reachB) / spacing)), Math.max(0, Math.floor((cy - reachB) / spacing)), Math.min(grid - 1, Math.ceil((cx + reachB) / spacing)), Math.min(grid - 1, Math.ceil((cy + reachB) / spacing))];
        segs.push({px: cx, py: cy, ex: R, ey: Math.max(1, height), f0: [k, nP], f1: [nP + nBreak, edgeB], nx: 0, ny: 0, box: boxB});
        continue;
      }
      const edgeBase = extra.length;
      for (let e = 0; e < sides; e++) { const t = turn + rnd(k, 9) * Math.PI * 2 + (e + .5) * Math.PI * 2 / sides; extra.push([Math.cos(t), Math.sin(t), R * Math.cos(Math.PI / sides) * (1 + q.rough * .35 * (rnd(k, 20 + e) - .5)), 0]); }
      const box = [Math.max(0, Math.floor((cx - R) / spacing)), Math.max(0, Math.floor((cy - R) / spacing)), Math.min(grid - 1, Math.ceil((cx + R) / spacing)), Math.min(grid - 1, Math.ceil((cy + R) / spacing))];
      segs.push({px: cx, py: cy, ex: R, ey: Math.max(1, height), f0: [Math.cos(leanAngle) * lean, Math.sin(leanAngle) * lean], f1: [sides, edgeBase], nx: 0, ny: 0, box});
    }
    }
  } else if (kind === 'fissure') {
    for (const pc of fissurePieces(fis, simplifyPath(pts, Math.max(1.5, fis.hw)), q, seed, radius)) segs.push({px: pc.a.x, py: pc.a.y, ex: (pc.b || pc.a).x, ey: (pc.b || pc.a).y, f0: [pc.r0, pc.r1], f1: [pc.h0, pc.h1], nx: 0, ny: 0});
  } else if (kind === 'ramp') {
    // ramp()/settleRamp(): drop repeats, then (from three points) thin the path and round its corners twice; the grade runs between the first and last point.
    let path = [pts[0]];
    for (const p of pts.slice(1)) if (Math.hypot(p.x - path[path.length - 1].x, p.y - path[path.length - 1].y) >= 1e-4) path.push(p);
    const first = path[0], last = path[path.length - 1];
    if (path.length >= 3) {
      const thin = [path[0]];
      for (const p of path.slice(1, -1)) if (Math.hypot(p.x - thin[thin.length - 1].x, p.y - thin[thin.length - 1].y) > radius * .12) thin.push(p);
      thin.push(path[path.length - 1]); path = thin;
      for (let pass = 0; pass < 2; pass++) {
        const next = [path[0]];
        for (let i = 0; i < path.length - 1; i++) { const a = path[i], b = path[i + 1]; next.push({x: .75 * a.x + .25 * b.x, y: .75 * a.y + .25 * b.y}, {x: .25 * a.x + .75 * b.x, y: .25 * a.y + .75 * b.y}); }
        next.push(path[path.length - 1]); path = next;
      }
    }
    let total = 0; const list = [];
    for (let i = 0; i < path.length - 1; i++) {
      const a = path[i], b = path[i + 1], l2 = (b.x - a.x) ** 2 + (b.y - a.y) ** 2;
      if (l2 < 1e-8) continue;
      const len = Math.sqrt(l2); list.push({a, b, cum: total, len}); total += len;
    }
    for (const e of list) segs.push({px: e.a.x, py: e.a.y, ex: e.b.x, ey: e.b.y, f0: [e.cum, e.len], f1: [total, 0], nx: 0, ny: 0});
    if (total > 0) reads = [{x: first.x, y: first.y}, {x: last.x, y: last.y}];
  } else if (ridgeOn(kind, q) || n.pieces) {
    // sweepRidge(): the crest and its spurs are pieces with a width and a height multiplier at each end, each swept as one capsule.
    const rs = {...q, radius, seed, rot: [Math.cos(turn), Math.sin(turn)], inv};
    for (const pc of n.pieces ?? ridgePieces(rs, simplifyPath(pts, Math.max(1, radius * .04)))) {
      const at = segs.length, ex = radius * pc.reach * (1) + 2 * amp * (pc.r0 + pc.r1) / 2 + (q.baseVary > 0 ? q.baseVary : 0) + (q.moonLobes > 0 ? q.moonLobes * radius : 0), e = pc.b || pc.a;
      dab(pc.a, pc.b, [pc.r0, pc.r1], [pc.h0, pc.h1]); segs[at].jag = pc.jag;
      segs[at].box = [clamp(Math.floor((Math.min(pc.a.x, e.x) - ex) / spacing), 0, grid - 1), clamp(Math.floor((Math.min(pc.a.y, e.y) - ex) / spacing), 0, grid - 1), clamp(Math.ceil((Math.max(pc.a.x, e.x) + ex) / spacing), 0, grid - 1), clamp(Math.ceil((Math.max(pc.a.y, e.y) + ex) / spacing), 0, grid - 1)];
    }
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
    s.box ??= [clamp(Math.floor((Math.min(s.px, s.ex) - extent) / spacing), 0, grid - 1), clamp(Math.floor((Math.min(s.py, s.ey) - extent) / spacing), 0, grid - 1),
      clamp(Math.ceil((Math.max(s.px, s.ex) + extent) / spacing), 0, grid - 1), clamp(Math.ceil((Math.max(s.py, s.ey) + extent) / spacing), 0, grid - 1)];
    region = !region ? {x0: s.box[0], y0: s.box[1], x1: s.box[2], y1: s.box[3]} : {x0: Math.min(region.x0, s.box[0]), y0: Math.min(region.y0, s.box[1]), x1: Math.max(region.x1, s.box[2]), y1: Math.max(region.y1, s.box[3])};
  }
  // Mask writes: paint's channel, erase's clearing of planes 0..13; each [plane, target, gain, flat].
  const writes = kind === 'fissure' ? (q.fissureDark > 0 ? [[2, 127]] : []) : kind === 'paint' ? (MASK_WRITES[Math.round(q.paintChannel)] || []) : kind === 'erase' ? MASK_WRITES[7] : shapeMaskWrites(kind, q, n.satellite);
  const rim = kind === 'crater' ? craterRim(q, seed) : null;
  if (rim) { for (const c of rim.sect) extra.push([c.a, c.h, c.w, c.rel]); for (const g of rim.gaps) extra.push([g, 0, 0, 0]); }
  const main = {op: 'stamp', kind: kcode, segs, region, settle, extra, entry: kcode === 15 ? (q.crystalForm >= 1.5 ? 'stampBerg' : q.crystalForm >= .5 ? 'stampColumns' : 'stampCrystal') : kcode === 14 ? 'stampFissure' : kcode === 13 ? 'stampCrater' : kcode === 12 ? 'stampRamp' : kcode >= 6 ? 'stampN' : 'stamp', smoothR: kind === 'smooth' ? smoothRadius(radius, geom) : 0, reads, writes: writes.map(([p, t, g = 1, f = 0]) => [p, t, g, f]),
    u: {seed, framed: inv ? 1 : 0, natural: naturalWater ? 1 : 0, passage: kind === 'shallow' && q.shallowMode === 'passage' ? 1 : 0, settle: settle ? 1 : 0,
      radius, amount: q.amount, amountPct: clamp(q.amount / 100, 0, 1), rough: q.rough, softness: q.softness, northWiden: q.northFace ?? 0, bankScale, amp, faceVar: q.faceVariation ?? .8,
      shelves: q.shelves, beachFlat: q.beachFlatness, coreEdge: c.coreEdge, crackAmt: (kind === 'hill' || kind === 'mountain' || kind === 'plateau' || kind === 'offset' || kind === 'crater') && q.cracks > 0 ? q.cracks : 0, mesaFlank: kind === 'plateau' ? q.mesaFlank || 0 : 0, cOffX: Math.cos(seed % 628 / 100 + turn), cOffY: Math.sin(seed % 628 / 100 + turn), rimH: q.rimHeight ?? 0, ejecta: q.craterEjecta || 0,
      ...outlineUniforms(kind, q, radius), ...sectionUniforms(kind, q, c), bankFlat: (kind === 'deep' || kind === 'shallow') && !(q.profile >= .5) ? Math.max(0, q.bankPx || 0) : 0, bpAmp: BASE_KINDS.includes(kind) ? Math.max(0, q.baseBump || 0) : 0, bpOffset: kind === 'offset' ? 1 : 0,
      faceX: face[0], faceY: face[1], faceSide, rotX: Math.cos(turn), rotY: Math.sin(turn),
      ...(inv ? Object.fromEntries(inv.map((v, i) => ['inv' + i, v])) : {}),
      fHw: fis?.hw0 ?? 0, fKf: fis?.kf ?? 0, fJag: fis?.jag ?? 0, fAmp: fis?.amp ?? 0, fCell: q.fissureCell, fCrack: q.fissureCrack, fNet: fis?.net ? 1 : 0, fDark: q.fissureDark, cTop: clamp(q.crystalTop ?? 0, 0, .95), backWidth, faceWidth, tg0: hillTangents[0], tg1: hillTangents[1], tg2: hillTangents[2], tg3: hillTangents[3], mexp: kind === 'hill' ? 2 : 3.5 * 2 ** ((.5 - q.softness) * 1.5), plain: plainHill ? 1 : 0, ridge: ridgeOn(kind, q) || n.pieces ? 1 : 0,
      hole: n.hole ? 1 : 0, hx: n.hole?.x ?? 0, hy: n.hole?.y ?? 0, hR: n.hole?.R ?? 0, hRough: n.hole?.rough ?? 0, hSeed: n.hole?.seed ?? 0,
      nSect: rim ? rim.sect.length : 0, nGap: rim ? rim.gaps.length : 0, gapHw: rim?.hw ?? 0}};
  if (kind === 'crystal') {
    const bt = turn + (q.bergTiltDir || 0) * Math.PI / 180;
    Object.assign(main.u, {cgForm: q.crystalForm >= 1.5 ? 2 : q.crystalForm >= .5 ? 1 : 0, cgSize: Math.max(4, q.crystalSize), cgFacet: clamp(q.crystalFacet, 0, 1), cgSizeVar: clamp(q.crystalSizeVar, 0, 1), cgSmooth: clamp(q.crystalSmooth, 0, 1),
      cgTiers: q.crystalTiers ?? 0, cgStep: q.crystalStep ?? 0, cgVar: q.crystalVariation ?? 0, bgFace: q.bergFace, bgTilt: q.bergTilt, bgFlat: q.bergFlat, bgRough: q.bergRough, bgTx: Math.cos(bt), bgTy: Math.sin(bt), bgJit: clamp(q.bergJitter, 0, 1), bgTurn: turn});
  }
  const facetMode = n.satellite ? 0 : kind === 'crater' && q.craterFacets > 0 ? 1 : kind === 'mountain' && q.iceFacets > 0 && q.amount >= 8 ? 2 : 0;
  if ((water || (kind === 'offset' && q.shorePlates > 0) || facetMode) && region) { const co = coastSetup(q, geom, region, bankScale, radius, inv, seed, water, c, facetMode); if (co) { main.coast = co; Object.assign(main.u, co.u); main.extra.push(...co.extra); } }
  if (kind !== 'crater' || n.satellite) return main;
  // The craterlets: small craters round the rim, each its own seed and noise, read after the main crater and the earlier ones (addCraterlets, craterletSpot).
  const count = Math.round(q.craterlets || 0), centre = pts[pts.length >> 1], world = geom.spacing * (geom.grid - 1) + 1, rnd = (k, a) => { let x = Math.imul((seed >>> 0) + k * 7919 + a * 104729, 2654435761) >>> 0; x ^= x >>> 15; x = Math.imul(x, 2246822519) >>> 0; return (x >>> 0) / 4294967296; };
  const out = [main];
  for (let k = 0; k < count; k++) {
    const angle = rnd(k, 1) * Math.PI * 2 + turn, dist = radius * (.9 + rnd(k, 2) * 1.1), small = radius * (.1 + .22 * rnd(k, 3));
    const spot = {x: clamp(centre.x + Math.cos(angle) * dist, 0, world - 1), y: clamp(centre.y + Math.sin(angle) * dist, 0, world - 1)};
    out.push(prepareNode({kind: 'crater', satellite: true, points: [spot], frame: n.frame, seed: (seed + k * 2654435761) >>> 0,
      params: {...n.params, rimHeight: q.rimHeight, radius: small, amount: q.amount * (.25 + .3 * rnd(k, 4)), craterlets: 0, cracks: 0, craterFacets: 0}}, geom, c));
  }
  if (Math.round(q.spurCount) >= 1) {
    // addRimSpurs(): spurs rooted round the rim crest, grown as a child mountain stroke over the finished crater; they fade out toward the bowl (the hole).
    const count = Math.round(clamp(q.spurCount, 0, 12)), rs = {...q, radius, seed, rot: [Math.cos(turn), Math.sin(turn)], inv}, phase = rand01(seed, 7, 0x4b1) * Math.PI * 2, roots = [];
    for (let k = 0; k < count; k++) {
      const ang = phase + Math.PI * 2 * (k + (rand01(seed, k, 0x4b2) - .5) * .6) / count + turn, dx = Math.cos(ang), dy = Math.sin(ang), wx = centre.x + dx * radius, wy = centre.y + dy * radius;
      const lx = inv ? inv[0] * wx + inv[2] * wy + inv[4] : wx, ly = inv ? inv[1] * wx + inv[3] * wy + inv[5] : wy, lobe = craterLobe(rs, lx, ly);
      roots.push({x: centre.x + dx * radius * lobe * 1.02, y: centre.y + dy * radius * lobe * 1.02, heading: ang + (rand01(seed, k, 0x4b3) - .5) * q.spurSpread * 1.2, k});
    }
    const pieces = spurPieces(rs, roots, .4, q.crestJag);
    out.push(prepareNode({kind: 'mountain', satellite: true, points: [roots[0]], frame: n.frame, seed, pieces, hole: {x: centre.x, y: centre.y, R: radius, rough: q.rough, seed},
      params: {...n.params, radius, amount: q.amount * q.rimHeight, rough: q.rough * .8, softness: .8, cracks: 0, craterlets: 0, craterEjecta: 0, spurCount: 0, rimSectors: 0, rimGaps: 0, crestJag: 0, crestVary: 0, crestTaper: 0, profile: 0}}, geom, c));
  }
  return {multi: out};
}

// ---- the coast pass (H10): fingers on the joined coast and shore layers, after the stroke is swept (stampCoastShore in sculpt.js) ----
// How far the layers reach from the coast (px), the skip distance included (coastLayerReach). The mounds style (2) is not on the GPU path.
const coastLayerReach = q => {
  const n = Math.max(1, Math.round(q.shoreLayers)), W = Math.max(4, q.layerPx), style = Math.round(q.layerStyle);
  if (style === 1) { const cv = clamp(q.lavaCircleVary || 0, 0, 1); return n * W * (1 + .45 * cv) + 2.8 * Math.max(8, q.layerCircle) * (1 + .07 * cv) + 2 * W; }
  const meander = clamp(q.lavaMeander || 0, 0, 3), spread = clamp(q.lavaSpread || 0, 0, 2), vary = clamp(q.layerVary, 0, 1);
  if (meander > 0 || spread > 0) { const wide = Math.max(1 + .6 * vary, Math.exp(.5 * (vary + spread))); return (n + 1 + meander) * W * wide + 2 * W; }
  return n * W * (1 + .6 * vary) + 2 * W;
};
// The coast pass of a deep or shallow stroke, or null when it has none: the coast box (the footprint grown by the reach and 12 cells), the cells the pass reads
// beyond that box (readR: the blur of the fingers' normals), its uniforms, the layers' riser weights (after the node's own mask writes in MW) and the
// size of the circular bites' lattice.
function coastSetup(q, geom, region, bankScale, radius, inv, seed, water, c, facet = 0) {
  const fingers = water && q.fingers > 0, layers = water && Math.round(q.shoreLayers) >= 1;
  const plWater = Math.max(0, q.plateWaterPx || 0), plLand = Math.max(0, q.plateLandPx || 0), plates = q.shorePlates > 0 && Math.max(plWater, plLand) > 0;
  if (!fingers && !layers && !plates && !facet) return null;
  const {grid, spacing, refSpacing = spacing} = geom;
  if (facet) {
    // Crater and mountain facets: a pass over the node's own result. The seeds of the 3 x 3 lattice neighbours lie within 2 widths of a cell, and read 3 cells round themselves.
    const L = facet === 1 ? (q.crystalCraterPx > 0 ? q.crystalCraterPx : clamp(radius * .36, 14, 36)) : clamp(q.iceFacetSize, 16, 96), mF = Math.ceil(2.1 * L / spacing) + 6, boxF = expand(region, mF, grid), am = clamp(q.iceFacets, 0, 1);
    return {box: boxF, readR: mF + 2, fingers: false, layers: false, plates: false, facet, scal: false, blurR: 1, maxCells: 0, sites: {i0: 0, j0: 0, ni: 0, nj: 0}, siteFloats: 0, sideR: 0, extra: [],
      u: {fcMode: facet, fcL: L, fcStrength: clamp(q.craterFacets, 0, 1), fcStep: q.crystalCraterStep ?? 0, fcSkin: q.crystalCraterSkin >= .5 ? 1 : 0, fcShare: .2 + .5 * am, coPutW: 1, coBx0: boxF.x0, coBy0: boxF.y0, coBx1: boxF.x1, coBy1: boxF.y1}};
  }
  const fReach = .5 * radius * bankScale, fLimit = fReach + spacing * 3, lReach = layers ? coastLayerReach(q) : 0, reach = Math.max(fingers ? fLimit : 0, lReach, plates ? Math.max(plWater, plLand) + 2 * spacing : 0);
  const m = Math.ceil(reach / spacing) + 12, box = expand(region, m, grid), blurR = Math.max(1, Math.round(10 * refSpacing / spacing));
  const n = Math.max(1, Math.round(q.shoreLayers)), W = Math.max(4, q.layerPx), vary = clamp(q.layerVary, 0, 1), scal = layers && Math.round(q.layerStyle) === 1;
  const Rc = Math.max(8, q.layerCircle), cv = clamp(q.lavaCircleVary || 0, 0, 1), C = Rc * 1.3, flat = q.fingerHeight > 0;
  const extra = [];
  if (layers && vary > 0) {
    const w = []; let total = 0;
    for (let k = 0; k < n; k++) { w.push(1 + .6 * vary * hash(k, 7, seed ^ 0x2e9)); total += w[k]; }
    let cum = 0;
    for (let k = 0; k < n; k++) { const wn = w[k] * n / total; extra.push([wn, cum, 0, 0]); cum += wn; }
  }
  let sites = {i0: 0, j0: 0, ni: 0, nj: 0};
  if (scal) {
    const cs = [[box.x0, box.y0], [box.x1, box.y0], [box.x0, box.y1], [box.x1, box.y1]].map(([x, y]) => { const wx = x * spacing, wy = y * spacing; return inv ? [inv[0] * wx + inv[2] * wy + inv[4], inv[1] * wx + inv[3] * wy + inv[5]] : [wx, wy]; });
    const i0 = Math.floor(Math.min(...cs.map(c => c[0])) / C) - 1, i1 = Math.ceil(Math.max(...cs.map(c => c[0])) / C) + 1, j0 = Math.floor(Math.min(...cs.map(c => c[1])) / C) - 1, j1 = Math.ceil(Math.max(...cs.map(c => c[1])) / C) + 1;
    sites = {i0, j0, ni: i1 - i0 + 1, nj: j1 - j0 + 1};
  }
  return {
    box, readR: m + (fingers ? blurR : 0) + 2, fingers, layers, plates, scal, blurR, maxCells: Math.ceil(reach / spacing) + 4, sites, siteFloats: sites.ni * sites.nj * 4, sideR: Math.ceil(Math.max(fingers ? fLimit : 0, plates ? Math.max(plWater, plLand) + 2 * spacing : 0) / spacing) + 2, extra,
    u: {
      plMat: plates ? (q.plateMaterial >= 1.5 ? 2 : 1) : 0, plWater, plLand, plSize: q.plateSize, plGap: q.plateGap, plHeight: q.plateHeight, plScale: q.crystalShoreScale ?? 1, plSeam: q.crystalShoreSeam ?? .5, plNeedles: q.frostNeedles ?? 0,
      frGapSize: Math.max(3, c.frost?.gapSize ?? 3), frGapDepth: c.frost?.gapDepth ?? 0, frGaps: c.frost?.gaps ?? 0, frGapReach: c.frost?.gapReach ?? 0,
      coPutW: 1, coFar: 1e5 + 2 * spacing, coLimit: fLimit, coFReach: fReach, coFAmt: q.fingers * clamp(radius * bankScale / 140, .35, 1), coFLow: q.fingerHeight, coFlatOn: flat ? 1 : 0,
      cfAmount: q.fingerAmount ?? 1, cfSpread: q.fingerSpread ?? .5, cfSize: q.fingerSize ?? 1,
      coN: n, coW: W, coLedge: clamp(q.layerLedge, .4, .95), coIrr: clamp(q.layerRough, 0, 1), coVary: vary, coSpread: clamp(q.lavaSpread || 0, 0, 2), coMeander: clamp(q.lavaMeander || 0, 0, 3),
      coLReach: lReach, coRiser: q.layerRiser > 0 ? q.layerRiser : 0, coScal: scal ? 1 : 0, coRc: Rc, coCV: cv, coRs: 1.4 * Rc + cv * .1 * Rc + n * W * (1 + .45 * cv) + spacing,
      coSI0: sites.i0, coSJ0: sites.j0, coSNI: sites.ni, coSNJ: sites.nj, coBx0: box.x0, coBy0: box.y0, coBx1: box.x1, coBy1: box.y1,
    },
  };
}

const expand = (r, m, grid) => ({x0: Math.max(0, r.x0 - m), y0: Math.max(0, r.y0 - m), x1: Math.min(grid - 1, r.x1 + m), y1: Math.min(grid - 1, r.y1 + m)});
const intersect = (a, b) => { const r = {x0: Math.max(a.x0, b.x0), y0: Math.max(a.y0, b.y0), x1: Math.min(a.x1, b.x1), y1: Math.min(a.y1, b.y1)}; return r.x0 > r.x1 || r.y0 > r.y1 ? null : r; };

// H5b: `#ifdef NAME` / `#else` / `#endif` lines in a shader (no nesting): the branch the defines select stays, the directive lines go, every other character is untouched,
// so a variant compiles to the text its author wrote (the whole-map variant of engine-shape.wgsl is its `#else` side, byte for byte what it was before pages).
export function preprocessShader(text, defines = []) {
  const out = []; let on = true, inIf = false;
  for (const line of text.split('\n')) {
    const d = line.match(/^#(ifdef|else|endif)(?:\s+(\w+))?\s*$/);
    if (!d) { if (on) out.push(line); continue; }
    if (d[1] === 'ifdef') { inIf = true; on = defines.includes(d[2]); } else if (d[1] === 'else') on = !on; else { inIf = false; on = true; }
  }
  if (inIf) throw new Error('nanolathe: unterminated #ifdef in a shader');
  return out.join('\n');
}

// ---- the GPU side ----
// refSpacing: the final grid's spacing; the hill's blur is defined in world units (2 final cells), so a coarser level uses the whole number of its own cells nearest that distance (1 at double spacing).
// The smooth radii (cells) of the nodes before ops[j]: how far a window must reach past the point it reads (their neighbourhood reads shrink the exact area).
const readRadius = p => p?.smoothR || p?.coast?.readR || 0;
const windowMargin = (ops, j) => { let m = 0; for (let k = 0; k < j; k++) m += readRadius(ops[k].p); return m; };
export async function createShapeEngine({device, grid, spacing, baseHeight, sea, minH, maxH, refSpacing = spacing, pages = false}) {
  const raw = await (await fetch('/engine-shape.wgsl')).text();
  const S = GPUShaderStage.COMPUTE, rw = {type: 'storage'}, ro = {type: 'read-only-storage'};
  const layout = device.createBindGroupLayout({entries: [
    {binding: 0, visibility: S, buffer: {type: 'uniform', hasDynamicOffset: true}}, {binding: 1, visibility: S, buffer: rw}, {binding: 2, visibility: S, buffer: rw},
    {binding: 3, visibility: S, buffer: rw}, {binding: 4, visibility: S, buffer: rw}, {binding: 5, visibility: S, buffer: ro}, {binding: 6, visibility: S, buffer: ro}, {binding: 7, visibility: S, buffer: rw},
    {binding: 8, visibility: S, buffer: rw}]});
  const pl = device.createPipelineLayout({bindGroupLayouts: [layout]});
  // The pipelines of one variant of the shader: the whole-map text, or the pages text (direct noise, a target's own origin).
  const buildPipes = (paged, entries) => {
    const source = preprocessShader(raw, paged ? ['PAGES'] : []).replace('/*NODE_STRUCT*/', nodeStruct());
    const module = device.createShaderModule({label: paged ? 'shape (pages)' : 'shape', code: source}), out = {};
    for (const e of entries) out[e] = device.createComputePipeline({layout: pl, compute: {module, entryPoint: e}});
    return out;
  };
  const MAIN = ['noise', 'stamp', 'stampN', 'stampRamp', 'stampCrater', 'stampFissure', 'stampCrystal', 'smoothCopy', 'blurH', 'blurV', 'compose', 'ground', 'init', 'pack', 'coastInit', 'coastSeed', 'coastJump', 'coastFinish', 'coastSd', 'coastBlurH', 'coastBlurV', 'coastFinger', 'coastJoin', 'coastSites', 'coastLayers', 'coastPlates', 'facetSnap', 'facetApply', 'stampColumns', 'stampBerg', 'packPlane'];
  const pipes = buildPipes(pages, [...MAIN, ...(pages ? ['coarse', 'pointRead'] : [])]);
  // A point-read window is always evaluated with the pages variant (it is a target of its own, with direct noise): the pages engine's own pipelines, or a second set made when first needed.
  let pipesW = null;
  const windowPipes = () => pages ? pipes : pipesW ??= buildPipes(true, [...MAIN, 'pointRead']);
  const cells = pages ? 0 : grid * grid, buf = (size, usage, label) => device.createBuffer({size: Math.max(16, size), usage, label});
  const ST = GPUBufferUsage.STORAGE, CD = GPUBufferUsage.COPY_DST, CS = GPUBufferUsage.COPY_SRC;
  const F = buf(6 * cells * 4, ST | CD | CS, 'shape planes'), Mk = buf(7 * cells * 4, ST | CD | CS, 'shape masks');
  let Nz = null, Sc = null, dummy = null, queue = Promise.resolve(), peak = 0, last = {};
  // H10: the scratch planes are three (the hill's blur), or CO_PLANES plus the circular bites when the node list has a coast pass.
  const CO_PLANES = 14, scFloats = (n, sites) => sites < 0 ? 3 * n : CO_PLANES * n + sites;
  const scratch = floats => { Nz ??= buf(7 * cells * 4, ST, 'shape noise'); if (!Sc || Sc.size < floats * 4) { const old = Sc; Sc = buf(floats * 4, ST, 'shape scratch'); old?.destroy(); } };
  // H5b: a page is a pw x ph block of the map with its own planes and masks (the shader's lidx); its noise is evaluated directly (u.direct), so only the
  // scratch weights of the hill's blur are shared: one buffer, grown to the largest target.
  let pageScratch = null;
  const bytes = () => F.size + Mk.size + (Nz?.size || 0) + (Sc?.size || 0) + (pageScratch?.size || 0);
  function makeTarget(ox, oy, pw, ph) {
    const F2 = buf(6 * pw * ph * 4, ST | CD | CS, 'page planes'), Mk2 = buf(pw * ph * 28, ST | CD | CS, 'page masks');
    return {F: F2, Mk: Mk2, ox, oy, pw, ph, bytes: F2.size + Mk2.size, destroy() { F2.destroy(); Mk2.destroy(); }};
  }

  // Evaluate `list` over `rect` (cells, inclusive; null = the whole map) and read the rectangle back. One at a time, in order (the study).
  function run(list, ctx, rect, {readback = true, release = false, plane = null} = {}) {
    const job = queue.then(async () => { const h = submit(list, ctx, rect, {readback, release, plane}); await h.done; return h.land ? await h.land : null; });
    queue = job.catch(() => {});
    return job;
  }
  // H6b: record the passes and submit them now; nothing here waits. Returns {done, land, rect}: done resolves when the GPU has finished, land
  // (only with readback) resolves to the rectangle's planes. The queue is in order on one device, so a later submit sees this one's writes.
  // readRect: the rectangle to read back when it is not the one evaluated (the cells changed since the last read); readOnly: no shape passes,
  // only the read of readRect.
  function submit(list, ctx, rect, {readback = true, release = false, readRect = null, readOnly = false, target = null, prepare = null, plane = null} = {}) {
    const t0 = performance.now();
    const whole = target ? intersect({x0: target.ox, y0: target.oy, x1: target.ox + target.pw - 1, y1: target.oy + target.ph - 1}, {x0: 0, y0: 0, x1: grid - 1, y1: grid - 1}) : {x0: 0, y0: 0, x1: grid - 1, y1: grid - 1};
    const R = rect ? intersect(rect, whole) : whole;
    const P = readRect ? intersect(readRect, whole) : R;
    if (!R || (readback && !P)) return {done: Promise.resolve(), land: null, rect: null};
    const TF = target ? target.F : F, TMk = target ? target.Mk : Mk;
    let coastSites = -1;   // the longest list of circular bites among the coast nodes (floats), or -1 when none has a coast pass
    dummy ??= buf(16, ST, 'shape unused');
    const expandIn = (r, m) => intersect({x0: r.x0 - m, y0: r.y0 - m, x1: r.x1 + m, y1: r.y1 + m}, whole);
    const geom = {grid, spacing, refSpacing};
    const passes = [], segData = [], mwData = [], ops = [];
    let segCount = 0, mwCount = 0, nReads = 0;
    const base = {grid, spacing, baseH: baseHeight, sea, minH, maxH, blurR: Math.max(1, Math.round(2 * refSpacing / spacing)), ox: target ? target.ox : 0, oy: target ? target.oy : 0, pw: target ? target.pw : grid, ph: target ? target.ph : grid, direct: target ? 1 : 0};
    // cur: where the passes being recorded go: group 0 is the evaluation itself, group 1 a point-read window (a small target of its own, evaluated with the pages variant of the shader).
    let cur = {b: base, grp: 0};
    const windows = [];
    const add = (entry, region, extra = {}) => passes.push({entry, region, grp: cur.grp, u: {...cur.b, rx0: region.x0, ry0: region.y0, rx1: region.x1, ry1: region.y1, ...extra}});
    if (!readOnly) {
    // Phase 1: prepare every node (segment and mask-write lists are shared by the evaluation and its windows).
    const prepared = [];
    for (const n of list) { const p0 = (prepare || prepareNode)(n, geom, ctx); if (p0.multi) prepared.push(...p0.multi); else prepared.push(p0); }
    for (const p of prepared) if (p.coast) coastSites = Math.max(coastSites, p.coast.siteFloats);
    if (target) { const need = scFloats(target.pw * target.ph, coastSites); if (!pageScratch || pageScratch.size < need * 4) { pageScratch?.destroy(); pageScratch = buf(need * 4, ST, 'page scratch'); } }
    else scratch(scFloats(cells, coastSites));
    for (const p of prepared) {
      if (p.skip) continue;
      if (p.op === 'ground') { ops.push({ground: true, u: {seed: p.seed, gAmp: p.amp, gWave: p.wave, gCover: p.cover}}); continue; }
      if (!p.region) continue;
      const node = {...p.u, nseg: p.segs.length, kind: p.kind, segBase: segCount, mwBase: mwCount, nwrites: p.writes.length};
      for (const s of p.segs) {
        segData.push(s.px, s.py, s.ex, s.ey, s.f0?.[0] ?? 0, s.f0?.[1] ?? 0, s.f1?.[0] ?? 0, s.f1?.[1] ?? 0, s.nx, s.ny, s.frame ? 1 : 0, s.jag ?? 0, {box: s.box});
      }
      segCount += p.segs.length;
      for (const w of p.writes) mwData.push(...w);
      mwCount += p.writes.length;
      for (const e of p.extra || []) mwData.push(...e);
      mwCount += (p.extra || []).length;
      const op = {p, node, reads: []};
      for (const q of p.reads || []) op.reads.push({x: q.x, y: q.y, idx: nReads++});
      if (op.reads.length) node.preIdx = op.reads[0].idx;
      ops.push(op);
    }
    // H10: a node with a coast pass. Its coast box is the footprint grown by the coast's reach; the cells wanted exact (hit) read the prefix, the crossings of
    // the sea and the blur's window out to readR, so the passes run over that, inside the box. Order: the prefix and a clear footprint, the stamp (which
    // writes its influence), then the fingers (the field, the blurred normal, the thumbs, the march) and the layers (the field again on the new heights).
    const emitCoast = (p, node, R, ex, noise) => {
      const c = p.coast, hit = intersect(R, c.box), wide = hit ? intersect(ex(hit, c.readR), c.box) : null;
      if (!wide) return;
      add('coastInit', wide, node);
      emitBody(p, {...node, coPutW: 1}, wide, ex, noise);
      if (c.facet) { add('facetSnap', wide, node); const fb = intersect(wide, p.region); if (fb) add('facetApply', fb, node); return; }
      const field = (moved = 1) => {
        const N = Math.max(1, Math.ceil(Math.log2(c.maxCells + 1)));
        add('coastSeed', wide, {...node, coSrc: 0, coMoved: moved});
        let src = 0;
        for (let k = N - 1; k >= -0; k--) { add('coastJump', wide, {...node, coSrc: src, coStep: 1 << k}); src ^= 1; if (k === 0) { add('coastJump', wide, {...node, coSrc: src, coStep: 1}); src ^= 1; } }
        add('coastFinish', wide, {...node, coSrc: src});
      };
      if (c.fingers) {
        field();
        add('coastSd', wide, node);
        add('coastBlurH', wide, {...node, bsrc: 5, bdst: 7, blurR: c.blurR}); add('coastBlurV', wide, {...node, bsrc: 7, bdst: 10, blurR: c.blurR});
        add('coastFinger', wide, node); if (!(typeof location !== 'undefined' && /[?&]noJoin/.test(location.search))) add('coastJoin', wide, node);   // (noJoin: a diagnostic switch for comparing the march with the flood)
      }
      if (c.layers) {
        field();
        if (c.scal) add('coastSites', {x0: 0, y0: 0, x1: c.sites.ni - 1, y1: c.sites.nj - 1}, node);
        add('coastLayers', wide, node);
      }
      // Shore plates run after the coast pass on the heights it left, with every crossing of the sea the footprint touches (not only the ones this node moved).
      if (c.plates) { field(0); add('coastPlates', wide, node); }
    };
    // Phase 2: the passes of one node over the rectangle R (the evaluation's, or a window's), `ex` growing a rectangle inside what exists.
    const emitOp = (op, R, ex, noise) => {
      if (op.ground) { add('ground', R, op.u); return; }
      const p = op.p, node = op.node;
      if (p.coast) { emitCoast(p, node, R, ex, noise); return; }
      emitBody(p, node, R, ex, noise);
    };
    // The node's own stamp passes over R (the host's coast pass runs them with the footprint plane switched on).
    const emitBody = (p, node, R, ex, noise) => {
      const reg = p.settle ? ex(p.region, 4) : p.region, body = reg ? intersect(R, reg) : null;
      if (!body) return;
      if (noise) add('noise', ex(p.region, 1), node);
      const entry = p.entry || 'stamp';
      if (p.smoothR) {
        // The blurred prefix over the footprint: copy the prefix height over the footprint plus the radius, blur along rows over that, then down columns over the footprint.
        const wide = ex(body, p.smoothR);
        add('smoothCopy', wide, node); add('blurH', wide, {...node, bsrc: 0, bdst: 1, blurR: p.smoothR}); add('blurV', body, {...node, bsrc: 1, bdst: 2, blurR: p.smoothR});
        add(entry, body, node); return;
      }
      if (!p.settle) { add(entry, body, node); return; }
      const wide = ex(body, 4);
      add(entry, wide, node);
      for (const [e, bsrc, bdst] of [['blurH', 0, 1], ['blurV', 1, 2], ['blurH', 2, 1], ['blurV', 1, 2]]) add(e, wide, {...node, bsrc, bdst});
      add('compose', body, node);
    };
    const exMain = (r, m) => expandIn(r, m);
    // A smooth node reads the prefix height `smoothR` cells beyond its footprint, so every node before it is evaluated over that much more (rects[k]: what node k
    // must cover so the cells wanted exact, R, come out exact). Without a smooth node every rectangle is R.
    const rects = new Array(ops.length);
    {
      let need = R;
      for (let k = ops.length - 1; k >= 0; k--) {
        rects[k] = need;
        const q = ops[k].p;
        if (q?.coast) { const hit = intersect(need, q.coast.box); if (hit) { const e = expandIn(hit, q.coast.readR); need = {x0: Math.min(need.x0, e.x0), y0: Math.min(need.y0, e.y0), x1: Math.max(need.x1, e.x1), y1: Math.max(need.y1, e.y1)}; } }
        if (q?.smoothR && q.region) { const hit = intersect(need, q.region); if (hit) { const e = expandIn(hit, q.smoothR); need = {x0: Math.min(need.x0, e.x0), y0: Math.min(need.y0, e.y0), x1: Math.max(need.x1, e.x1), y1: Math.max(need.y1, e.y1)}; } }
      }
      add('init', ops.length ? need : R);
    }
    ops.forEach((op, j) => {
      if (op.reads?.length && !op.ground) {
        const reg = op.p.region, body = reg ? intersect(rects[j], reg) : null;
        if (body) for (const q of op.reads) {
          // The prefix height at the point (the nodes before this one, evaluated in a window around the stencil, margin 4 for the hill's blur plus the
          // smooth radii among them), read into PT. Position-based, so the window needs nothing of the neighbouring map.
          const top = grid - 1, gx = clamp(q.x / spacing, 0, top), gy = clamp(q.y / spacing, 0, top), ix = Math.floor(gx), iy = Math.floor(gy);
          const M = 4 + windowMargin(ops, j), W = {x0: Math.max(0, ix - M), y0: Math.max(0, iy - M), x1: Math.min(grid - 1, Math.min(ix + 1, top) + M), y1: Math.min(grid - 1, Math.min(iy + 1, top) + M)};
          const wd = {pw: W.x1 - W.x0 + 1, ph: W.y1 - W.y0 + 1};
          windows.push(wd.pw * wd.ph);
          cur = {b: {...base, ox: W.x0, oy: W.y0, pw: wd.pw, ph: wd.ph, direct: 1}, grp: 1};
          add('init', W);
          for (let k = 0; k < j; k++) emitOp(ops[k], W, (r, m) => intersect({x0: r.x0 - m, y0: r.y0 - m, x1: r.x1 + m, y1: r.y1 + m}, W), false);
          add('pointRead', W, {qx: q.x, qy: q.y, preIdx: q.idx});
          cur = {b: base, grp: 0};
        }
      }
      emitOp(op, rects[j], exMain, !target);
    });
    }
    // Pack the rectangle for readback.
    const rw0 = P ? P.x1 - P.x0 + 1 : 0, rh0 = P ? P.y1 - P.y0 + 1 : 0, rc = rw0 * rh0, q4 = Math.ceil(rc / 4), outWords = plane === null ? 6 * rc + 25 * q4 : rc;
    if (readback) add(plane === null ? 'pack' : 'packPlane', P, plane === null ? {} : {bsrc: plane});
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
    const OutB = buf(readback ? outWords * 4 : 16, ST | CS, 'shape out'), PTB = buf(nReads * 4, ST | CS, 'shape point reads');
    const mkGroup = (F1, Mk1, Nz1, Sc1) => device.createBindGroup({layout, entries: [
      {binding: 0, resource: {buffer: ub, size: NODE_BYTES}}, {binding: 1, resource: {buffer: F1}}, {binding: 2, resource: {buffer: Mk1}}, {binding: 3, resource: {buffer: Nz1}},
      {binding: 4, resource: {buffer: Sc1}}, {binding: 5, resource: {buffer: SegB}}, {binding: 6, resource: {buffer: MWB}}, {binding: 7, resource: {buffer: OutB}}, {binding: 8, resource: {buffer: PTB}}]});
    const bgs = [mkGroup(TF, TMk, (target ? null : Nz) ?? dummy, (target ? pageScratch : Sc) ?? dummy)];
    let win = null;
    if (windows.length) {
      const cellsW = Math.max(...windows);
      win = {F: buf(6 * cellsW * 4, ST, 'window planes'), Mk: buf(cellsW * 28, ST, 'window masks'), Sc: buf(scFloats(cellsW, coastSites) * 4, ST, 'window scratch')};
      bgs.push(mkGroup(win.F, win.Mk, dummy, win.Sc));
    }
    const wpipes = windows.length ? windowPipes() : null;
    const enc = device.createCommandEncoder({label: 'shape'}), pass = enc.beginComputePass({label: 'shape passes'});
    passes.forEach((ps, k) => {
      pass.setPipeline((ps.grp ? wpipes : pipes)[ps.entry]); pass.setBindGroup(0, bgs[ps.grp], [k * NODE_BYTES]);
      const w = ps.region.x1 - ps.region.x0 + 1, h = ps.region.y1 - ps.region.y0 + 1;
      if (ps.entry === 'pack' || ps.entry === 'packPlane') { const g = Math.ceil(outWords / 256), gx = Math.min(g, 65535); pass.dispatchWorkgroups(gx, Math.ceil(g / gx)); }
      else if (ps.entry === 'pointRead') pass.dispatchWorkgroups(1);
      else pass.dispatchWorkgroups(Math.ceil(w / 8), Math.ceil(h / 8));
    });
    pass.end();
    let stage = null;
    if (readback) { stage = buf(outWords * 4, GPUBufferUsage.MAP_READ | CD, 'shape readback'); enc.copyBufferToBuffer(OutB, 0, stage, 0, outWords * 4); }
    device.queue.submit([enc.finish()]);
    const tSubmit = performance.now(), nz = Nz, sc = Sc;   // (a target evaluation keeps no whole-map scratch)
    const done = device.queue.onSubmittedWorkDone();
    let land = null;
    if (readback) land = (async () => {
      await done; const tGpu = performance.now();
      await stage.mapAsync(GPUMapMode.READ);
      const raw = stage.getMappedRange().slice(0); stage.unmap(); stage.destroy();
      last = {passes: passes.length, segments: segCount, ms: performance.now() - t0, prepareMs: tSubmit - t0, gpuMs: tGpu - tSubmit, readbackMs: performance.now() - tGpu, cells: rc};
      if (plane !== null) return {rect: P, width: rw0, height: rh0, plane: new Float32Array(raw)};
      return {rect: P, width: rw0, height: rh0, floats: FIELD_KEYS_FLOAT.map((_, k) => new Float32Array(raw, k * rc * 4, rc)), masks: Array.from({length: 25}, (_, m) => new Int8Array(raw, (6 * rc + m * q4) * 4, rc))};
    })();
    peak = Math.max(peak, bytes() + sd.byteLength + passes.length * NODE_BYTES + (readback ? 2 * outWords * 4 : 0));
    done.then(() => {
      ub.destroy(); SegB.destroy(); MWB.destroy(); OutB.destroy(); PTB.destroy(); if (win) { win.F.destroy(); win.Mk.destroy(); win.Sc.destroy(); }
      if (release && !target && Nz === nz) { nz.destroy(); sc.destroy(); Nz = Sc = null; }
      if (!readback) last = {passes: passes.length, segments: segCount, ms: performance.now() - t0, prepareMs: tSubmit - t0, gpuMs: performance.now() - tSubmit, readbackMs: 0, cells: rc};
    });
    return {done, land, rect: R};
  }
  // Copy a readback rectangle into row-major CPU planes of the given row stride (the planes are `grid` wide).
  function copyOut(out, planes) {
    const {rect, width, height} = out;
    for (let k = 0; k < 6; k++) { const dst = planes[FIELD_KEYS_FLOAT[k]]; for (let y = 0; y < height; y++) dst.set(out.floats[k].subarray(y * width, (y + 1) * width), (rect.y0 + y) * grid + rect.x0); }
    for (let m = 0; m < 25; m++) { const dst = planes.masks[m]; for (let y = 0; y < height; y++) dst.set(out.masks[m].subarray(y * width, (y + 1) * width), (rect.y0 + y) * grid + rect.x0); }
  }
  // H5b: the authored height at every `step`-th cell of a rectangle of a target (the overview's coarse lattice), read back: (w x h) floats, w = (x1 - x0) / step + 1.
  async function decimate(target, rect, step) {
    const w = Math.floor((rect.x1 - rect.x0) / step) + 1, h = Math.floor((rect.y1 - rect.y0) / step) + 1, ub = buf(NODE_BYTES, GPUBufferUsage.UNIFORM | CD, 'coarse uniform'), dv = new DataView(new ArrayBuffer(NODE_BYTES));
    const u = {grid, spacing, rx0: rect.x0, ry0: rect.y0, rx1: rect.x1, ry1: rect.y1, ox: target.ox, oy: target.oy, pw: target.pw, ph: target.ph, blurR: step};
    NODE_FIELDS.forEach(([name, type], j) => { const v = u[name] ?? 0; if (type === 'f') dv.setFloat32(j * 4, v, true); else if (type === 'u') dv.setUint32(j * 4, v >>> 0, true); else dv.setInt32(j * 4, v, true); });
    device.queue.writeBuffer(ub, 0, dv.buffer);
    const d8 = buf(16, ST, 'coarse unused 8'), d3 = buf(16, ST, 'coarse unused 3'), d4 = buf(16, ST, 'coarse unused 4'), d56 = buf(16, ST, 'coarse unused 56');
    const out = buf(w * h * 4, ST | CS, 'coarse out'), stage = buf(w * h * 4, GPUBufferUsage.MAP_READ | CD, 'coarse read');
    const bg = device.createBindGroup({layout, entries: [{binding: 0, resource: {buffer: ub, size: NODE_BYTES}}, {binding: 1, resource: {buffer: target.F}}, {binding: 2, resource: {buffer: target.Mk}}, {binding: 3, resource: {buffer: d3}},
      {binding: 4, resource: {buffer: d4}}, {binding: 5, resource: {buffer: d56}}, {binding: 6, resource: {buffer: d56}}, {binding: 7, resource: {buffer: out}}, {binding: 8, resource: {buffer: d8}}]});
    const enc = device.createCommandEncoder({label: 'coarse'}), pass = enc.beginComputePass({label: 'coarse'});
    pass.setPipeline(pipes.coarse); pass.setBindGroup(0, bg, [0]);
    const g = Math.ceil(w * h / 256), gx = Math.min(g, 65535); pass.dispatchWorkgroups(gx, Math.ceil(g / gx)); pass.end();
    enc.copyBufferToBuffer(out, 0, stage, 0, w * h * 4); device.queue.submit([enc.finish()]);
    await stage.mapAsync(GPUMapMode.READ); const values = new Float32Array(stage.getMappedRange().slice(0)); stage.unmap();
    stage.destroy(); out.destroy(); ub.destroy(); d3.destroy(); d4.destroy(); d56.destroy(); d8.destroy();
    return {w, h, values};
  }
  return {run, submit, copyOut, bytes, makeTarget, decimate, planes: F, masks: Mk, stats: () => ({gpuBytes: bytes(), peakGpuBytes: peak, planeBytes: F.size, maskBytes: Mk.size, noiseBytes: Nz?.size || 0, scratchBytes: Sc?.size || 0, last}),
    destroy() { F.destroy(); Mk.destroy(); Nz?.destroy(); Sc?.destroy(); pageScratch?.destroy(); Nz = Sc = pageScratch = null; }, grid, spacing, device};
}

// ---- the fields object ----
// opts: the createRegionalFields options (worldSize, worldGrid, baseHeight, keys, maskKeys, nodes), plus device() (the GPU device, or null
// until the renderer exists), context() (the host context for prepareNode).
export function createGpuFields(opts) {
  const {worldSize, worldGrid, baseHeight, keys, maskKeys, nodes, device, context} = opts;   // opts.forceRing (page parameter pageRing=N): a ring chosen by hand, for checking the ring rule against the whole-map engine
  const spacing = (worldSize - 1) / (worldGrid - 1), cells = worldGrid * worldGrid, listeners = new Set();
  const clip = r => ({x0: clamp(r.x0, 0, worldGrid - 1), y0: clamp(r.y0, 0, worldGrid - 1), x1: clamp(r.x1, 0, worldGrid - 1), y1: clamp(r.y1, 0, worldGrid - 1)});
  const worldRect = r => ({x: r.x0 * spacing, y: r.y0 * spacing, width: (r.x1 - r.x0) * spacing, height: (r.y1 - r.y0) * spacing});
  let revision = 0, planes = null, engine = null, enginePromise = null, valid = false, gpuValid = false, error = null;
  let lastEval = {}, firstReady = 0;
  // H6b: a change is requested (queued), submitted to the GPU at once unless two runs are still unfinished, and its rectangle read
  // back into the CPU copy only when nothing is being edited: during a gesture (opts.gesture) the copy is left, and one read of everything changed
  // since covers the release. A request that arrives while a run is in flight merges into the one waiting (union rectangle; the newest node list is
  // read when it starts). Two kinds of listener: submit listeners (the canvas rebakes from the GPU buffers) hear of a change as it is submitted;
  // the others (overview sampling, saving, the CPU readers) only once the CPU copy holds it, as before (1a1a85f).
  const gesture = opts.gesture || (() => false);
  let submittedRevision = 0, outstanding = 0, starting = null, waiters = [], queued = null, copyDirty = false, copyRect = null, landing = 0, landChain = Promise.resolve(), reported = null, generation = 0, flushWanted = false;
  const submitListeners = new Set(), runLog = [];
  const joinRect = (a, b) => !a || !b ? null : {x0: Math.min(a.x0, b.x0), y0: Math.min(a.y0, b.y0), x1: Math.max(a.x1, b.x1), y1: Math.max(a.y1, b.y1)};
  const joinWorld = (a, b) => !a || !b ? null : (() => { const x0 = Math.min(a.x, b.x), y0 = Math.min(a.y, b.y); return {x: x0, y: y0, width: Math.max(a.x + a.width, b.x + b.width) - x0, height: Math.max(a.y + a.height, b.y + b.height) - y0}; })();
  const joinEvent = (a, b) => !a ? b : !b ? a : {revision: Math.max(a.revision, b.revision), rect: joinWorld(a.rect, b.rect)};
  const allocate = () => { planes ??= {h: new Float32Array(cells), p: new Float32Array(cells), r: new Float32Array(cells), c: new Float32Array(cells), v: new Float32Array(cells), x: new Float32Array(cells), masks: maskKeys.map(() => new Int8Array(cells))}; };
  const getEngine = () => enginePromise ??= (async () => {
    let d = device();
    for (let i = 0; !d && i < 600; i++) { await new Promise(r => setTimeout(r, 50)); d = device(); }   // the renderer is created after the fields
    if (!d) throw new Error('nanolathe: the GPU device is not ready for the shape passes');
    const c = context();
    return engine = await createShapeEngine({device: d, grid: worldGrid, spacing, baseHeight, sea: c.sea, minH: c.minH, maxH: c.maxH});
  })();
  // Land a read: copy the rectangle into the CPU planes, in order, then tell the listeners (the first whole copy is announced too, since readers that
  // sampled before it read the base height).
  function land(h, whole, report, wasValid, gen) {
    landing++;
    const t0 = performance.now();
    landChain = landChain.then(async () => {
      try {
        const out = await h.land;
        if (gen !== generation) return;
        if (out) { engine.copyOut(out, planes); if (whole) valid = true; }
        lastEval = {...lastEval, copyMs: performance.now() - t0, whole, ...engine.stats().last};
        firstReady ||= performance.now();
        if (out && (report || !wasValid)) { const ev = {revision: report?.revision ?? revision, rect: whole ? null : report.rect}; for (const fn of listeners) fn(ev); }
      } catch (err) { error = err; console.error(err); }
      finally { landing--; }
    });
  }
  const MAX_OUTSTANDING = 2;   // runs submitted whose GPU work is not finished; more wait in `queued` and merge
  const progress = () => { const w = waiters; waiters = []; for (const fn of w) fn(); };
  function pump() {
    if (!queued) { progress(); return; }
    if (!engine) {
      if (!starting) starting = getEngine().catch(err => { error = err; console.error(err); queued = null; }).then(() => { starting = null; pump(); });
      return;
    }
    while (queued && outstanding < MAX_OUTSTANDING) {
      const q = queued; queued = null;
      const whole = !gpuValid || !q.rect, wasValid = valid, wasGpu = gpuValid, gen = generation;
      const nextCopyRect = copyDirty ? joinRect(copyRect, whole ? null : q.rect) : (whole ? null : q.rect);
      const readNow = !gesture() || !valid || whole;
      let h;
      try { h = engine.submit(nodes(), context(), whole ? null : q.rect, {readback: readNow, readRect: nextCopyRect, release: whole}); }
      catch (err) { error = err; console.error(err); continue; }
      reported = joinEvent(reported, q.event); copyRect = nextCopyRect; copyDirty = true;
      const entry = {t: performance.now(), whole, readNow}; runLog.push(entry); if (runLog.length > 400) runLog.shift();
      submittedRevision = Math.max(submittedRevision, q.event?.revision ?? 0); gpuValid = true;
      if (q.event || !wasGpu) { const ev = {revision: q.event?.revision ?? revision, rect: whole ? null : q.event?.rect ?? null}; for (const fn of submitListeners) fn(ev); }
      if (readNow) { const report = reported; reported = null; copyDirty = false; copyRect = null; land(h, whole, report, wasValid, gen); }
      outstanding++;
      h.done.catch(() => {}).then(() => { entry.doneAt = performance.now(); outstanding--; pump(); if (!outstanding && !queued) flushIfDue(); });
    }
    progress();
  }
  // The copy of what changed during a gesture: one read-only submit. Forced (a CPU reader is waiting) or once the gesture is over.
  function flushIfDue(force = false) {
    if (!copyDirty || queued || !engine || (!force && gesture())) return;
    const report = reported; reported = null; const rect = copyRect; copyDirty = false; copyRect = null;
    land(engine.submit([], context(), null, {readback: true, readRect: rect, readOnly: true}), false, report, valid, generation);
  }
  function evaluate(rect, event = null) {
    allocate();
    const e = event ? {revision: event.revision, rect: event.rect} : null;
    queued = queued ? {rect: joinRect(queued.rect, rect), event: joinEvent(queued.event, e)} : {rect, event: e};
    pump();
  }
  function changed(rect = null, keepPrefix = 0) {
    revision++;
    const cr = rect ? clip(rect) : null, r = cr ? clip({x0: cr.x0 - 6, y0: cr.y0 - 6, x1: cr.x1 + 6, y1: cr.y1 + 6}) : null, event = {revision, rect: cr ? worldRect(cr) : null};
    evaluate(r, event);
    return event;
  }
  const quiet = async () => { while (queued || starting || outstanding > 0) await new Promise(r => waiters.push(r)); };
  const settled = async () => { while (queued || starting) await new Promise(r => waiters.push(r)); };
  // The GPU buffers are current once every requested run has been submitted (the queue is in order on one device, so a bake that records its own
  // work next sees them): it does not wait for the work to finish.
  const gpuReady = async () => { if (!gpuValid && !queued && !starting) evaluate(null); await settled(); };
  // The CPU copy is current: also waits for the reads. A CPU reader forces the read that a gesture left out.
  const whenReady = async () => {
    if (!valid && !queued && !starting && landing === 0) evaluate(null);
    for (;;) {
      if (queued || starting) { await settled(); continue; }
      flushIfDue(true);
      if (landing > 0) { await landChain; continue; }
      break;
    }
  };
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
    if (!planes || !valid) throw new Error('nanolathe: the GPU shape fields are not ready; await ready() or readAsync() first');
    return crop(request);
  }
  const read = ({x = 0, y = 0, width = 0, height = width, apron = 0}, o) => readCells({x0: Math.floor((x - apron) / spacing), y0: Math.floor((y - apron) / spacing), x1: Math.ceil((x + width + apron) / spacing), y1: Math.ceil((y + height + apron) / spacing)}, o);
  const cell = (ix, iy, key = 'h') => {
    ix = clamp(Math.round(ix), 0, worldGrid - 1); iy = clamp(Math.round(iy), 0, worldGrid - 1);
    if (!planes || !valid) return key === 'h' ? baseHeight : 0;
    const j = maskKeys.indexOf(key);
    return j >= 0 ? planes.masks[j][iy * worldGrid + ix] : planes[key][iy * worldGrid + ix];
  };
  const sample = (x, y, key = 'h') => {
    const gx = clamp(x / spacing, 0, worldGrid - 1), gy = clamp(y / spacing, 0, worldGrid - 1), ix = Math.floor(gx), iy = Math.floor(gy);
    const jx = Math.min(ix + 1, worldGrid - 1), jy = Math.min(iy + 1, worldGrid - 1), fx = gx - ix, fy = gy - iy;
    return (cell(ix, iy, key) * (1 - fx) + cell(jx, iy, key) * fx) * (1 - fy) + (cell(ix, jy, key) * (1 - fx) + cell(jx, jy, key) * fx) * fy;
  };
  const stats = () => {
    const g = engine?.stats() || {}, cpu = planes ? cells * (24 + maskKeys.length) : 0;
    return {revision, residentBytes: cpu, cacheBytes: cpu, cacheEntries: planes ? 1 : 0, lastWorkingBytes: 0, peakBytes: cpu, budget: cpu, hits: 0, misses: 0, replays: 0, evictions: 0,
      chunkCells: worldGrid, worldSize, worldGrid, gridSpacing: spacing, bytesPerCell: 24 + maskKeys.length, workspaceBytesPerCell: 0, maxWorkingCells: 0, pointSamples: 0,
      connectionTiles: 0, connectionCells: 0, gpuShape: {...g, cpuCopyBytes: cpu, pending: outstanding + (queued ? 1 : 0) + landing, runLog: runLog.slice(-120), lastEval, error: error?.message || null}};
  };
  return {
    buffers: () => planes ? [...FIELD_KEYS_FLOAT.map(k => planes[k].buffer), ...planes.masks.map(a => a.buffer)] : [],
    read, readCells, sample, cell, changed, ready: () => whenReady(), pending: () => (queued !== null || starting !== null || landing > 0 || copyDirty || !valid),
    readAsync: async (request, o) => { await whenReady(); return read(request, o); },
    replayDetail: () => Object.fromEntries(keys.map(k => [k, 0])),
    subscribe(fn) { listeners.add(fn); return () => listeners.delete(fn); },
    stats, active: () => true,
    maskChunks: () => {
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
    // H6b: the engine's whole-map buffers (the h p r c v x planes, the packed masks) for the passes that read them in place. Await ready() first.
    gpuBuffers: () => gpuValid && engine ? {planes: engine.planes, masks: engine.masks, grid: worldGrid, spacing, revision: submittedRevision} : null,
    subscribeSubmit(fn) { submitListeners.add(fn); return () => submitListeners.delete(fn); },
    gpuReady: () => gpuReady(), gpuQuiet: () => quiet(), gpuPending: () => (queued !== null || starting !== null || !gpuValid),
    // Start the read of what a gesture left out, once the gesture is over (the weather glue calls this on release).
    settle: () => { flushIfDue(); },
  };
}

// ---- H5b: the map in pages ----
// A page is a core of CORE x CORE cells of the world lattice (aligned at multiples of CORE) with its own buffers. Three reaches, kept apart:
//   shape      a stored shape page is its core plus RING cells (the hill's blur reads weights 4 cells away in each axis); noise is evaluated directly
//              (engine-shape.wgsl noiseCell), so a page has no tables and the stamp's reads of the noise at the capsule points need no apron
//   Time pass  a page's weather comes from a window of its core plus APRON cells each side (the Time pass moves water a cell an iteration but flat ground and
//              sea are sinks); the window's shape is evaluated afresh from the nodes, so it needs no resident neighbour. Only the core is kept.
//   feed       a chunk's input lattice (hundreds of cells beyond it) is gathered from up to 2 x 3 page cores into a staging set (engine-feed.wgsl gather*)
// The same object as createGpuFields for the callers that read the fields (sample, cell, readAsync, changed, subscribe...), over pages that come and go
// (an LRU by bytes); a CPU copy exists only for resident pages, and a coarse lattice of authored heights (every COARSE-th cell, filled in the background,
// view first) answers everything else.
export function createPagedFields(opts) {
  const {worldSize, worldGrid, baseHeight, keys, maskKeys, nodes, device, context} = opts;
  const CORE = opts.core ?? 512, APRON = opts.apron ?? 128, COARSE = 8, SHIFT = Math.log2(CORE);
  const spacing = (worldSize - 1) / (worldGrid - 1), np = Math.ceil(worldGrid / CORE), gesture = opts.gesture || (() => false);
  // H6c: the ring is 4 cells (the hill's blur) plus the longest chain of overlapping smooth radii among the nodes, bucketed to RINGS; it follows the node list.
  const RINGS = [4, 16, 32, 64, 128, 192, 320];
  let RING = 4, SIDE = CORE + 2 * RING, SHAPE_BYTES = SIDE * SIDE * 52;
  const WEATHER_BYTES = CORE * CORE * 20, CPU_PAGES = 16;
  // Page caps: 9 shape pages and 24 weather pages when the GPU budget allows; fewer (never under the 6 a chunk's feed gathers at once) when it does not.
  let SHAPE_PAGES = 9, WEATHER_PAGES = 24;
  const shapeBudget = () => opts.shapeBudget ?? SHAPE_PAGES * SHAPE_BYTES, weatherBudget = opts.weatherBudget ?? WEATHER_PAGES * WEATHER_BYTES;
  const listeners = new Set(), submitListeners = new Set(), pagesMap = new Map();
  const clip = r => ({x0: clamp(r.x0, 0, worldGrid - 1), y0: clamp(r.y0, 0, worldGrid - 1), x1: clamp(r.x1, 0, worldGrid - 1), y1: clamp(r.y1, 0, worldGrid - 1)});
  const worldRect = r => ({x: r.x0 * spacing, y: r.y0 * spacing, width: (r.x1 - r.x0) * spacing, height: (r.y1 - r.y0) * spacing});
  const hits = (a, b) => a.x0 <= b.x1 && b.x0 <= a.x1 && a.y0 <= b.y1 && b.y0 <= a.y1;
  let revision = 0, engine = null, enginePromise = null, error = null, tick = 0, prep = new Map(), time = null, timeKey = '', staging = null, scratchT = null, firstError = null;
  let pendingStale = null, coarseDone = 0, coarseStart = 0, coarseFirstView = 0, focus = null;
  const coarseW = Math.floor((worldGrid - 1) / COARSE) + 1, coarse = new Float32Array(coarseW * coarseW).fill(baseHeight), coarseHave = new Uint8Array(coarseW * coarseW);
  const coarseQueue = new Map();   // page key -> the world rect to announce when it is done
  let coarseRunning = false, coarseTimer = 0;
  const key = (px, py) => py * np + px;
  const page = (px, py) => {
    let pg = pagesMap.get(key(px, py));
    if (!pg) {
      const x0 = px * CORE, y0 = py * CORE;
      pg = {px, py, x0, y0, cw: Math.min(CORE, worldGrid - x0), ch: Math.min(CORE, worldGrid - y0), target: null, rev: 0, cpu: null, cpuW: null, cpuBusy: false, cpuRev: -1, weather: null, stale: false, staleSeq: 0, weatherJob: null, used: 0, pins: 0, key: key(px, py)};
      pagesMap.set(pg.key, pg);
    }
    return pg;
  };
  const coreRect = pg => ({x0: pg.x0, y0: pg.y0, x1: pg.x0 + pg.cw - 1, y1: pg.y0 + pg.ch - 1});
  const bufRect = pg => ({x0: pg.x0 - RING, y0: pg.y0 - RING, x1: pg.x0 + CORE + RING - 1, y1: pg.y0 + CORE + RING - 1});
  const windowRect = pg => ({x0: pg.x0 - APRON, y0: pg.y0 - APRON, x1: pg.x0 + CORE + APRON - 1, y1: pg.y0 + CORE + APRON - 1});
  const overlapping = r => { const out = []; for (let py = r.y0 >> SHIFT; py <= r.y1 >> SHIFT; py++) for (let px = r.x0 >> SHIFT; px <= r.x1 >> SHIFT; px++) out.push(page(px, py)); return out; };
  const touch = pg => { pg.used = ++tick; };
  // The ring the node list needs: 4 (the hill's blur) plus how far, beyond a page's core, the cells the shape reads reach going back through the nodes.
  // It follows the engine's own rectangles (rects in the shape run), page by page and clipped to the world, with one difference for coast nodes (H10).
  // A smooth node reads the prefix height `smoothR` cells beyond its footprint, and the next one reads that, so those add. A coast node reads the land/sea
  // side of the prefix at its seeds (cells of its own footprint) and the prefix height of its own cell. Stamps and layers are local (layers cut heights on
  // land and never across sea level: a land cell keeps sea + level * sm(0, 5, d) over the sea, equal to it only at a seed), so heights pass through them;
  // fingers and plates move the waterline away from the stroke, by `sideR` cells. Two rectangles go back through the nodes: H, where heights must be
  // exact, and S, where sides must be exact. A coast node needs its seeds present within its reach of H (the buffer must hold them: K, coverage) and within
  // `sideR` of S. Only the presence of seeds needs the whole reach. A seed whose side an earlier node got wrong (it too lacked seeds beyond the buffer) moves
  // the later node's coast by about the distance field's blur (blurR + 2 cells), not by its reach again: so S grows by that per link and K by the reach
  // once. A chain of lake strokes then costs the extent of its strokes plus a margin a link, not the sum of their reaches (5 lava strokes summed to 640).
  // [Supported inference: checked with chained lakes at rings below the rule's value (pagedShapeCompare), see H10 notes; not proven for every stroke order.]
  const grow = (r, m) => ({x0: r.x0 - m, y0: r.y0 - m, x1: r.x1 + m, y1: r.y1 + m});
  const meet = (a, b) => { const r = {x0: Math.max(a.x0, b.x0), y0: Math.max(a.y0, b.y0), x1: Math.min(a.x1, b.x1), y1: Math.min(a.y1, b.y1)}; return r.x0 <= r.x1 && r.y0 <= r.y1 ? r : null; };
  const span = (a, b) => !a ? b : !b ? a : {x0: Math.min(a.x0, b.x0), y0: Math.min(a.y0, b.y0), x1: Math.max(a.x1, b.x1), y1: Math.max(a.y1, b.y1)};
  function ringNeed() {
    const geom = {grid: worldGrid, spacing, refSpacing: spacing}, c = context(), ns = [];
    for (const n of nodes()) {
      const p = prepare(n, geom, c);
      if (p.smoothR && p.region) ns.push({smooth: true, read: p.smoothR, reg: p.region});
      else if (p.coast) ns.push({smooth: false, read: p.coast.readR, side: p.coast.sideR, local: p.coast.blurR + 2, reg: p.region, box: p.coast.box});
    }
    const top = worldGrid - 1, clipW = r => ({x0: Math.max(0, r.x0), y0: Math.max(0, r.y0), x1: Math.min(top, r.x1), y1: Math.min(top, r.y1)});
    let deepest = 0;
    for (let py = 0; py < np; py++) for (let px = 0; px < np; px++) {
      const core = {x0: px * CORE, y0: py * CORE, x1: Math.min(top, px * CORE + CORE - 1), y1: Math.min(top, py * CORE + CORE - 1)};
      let H = core, S = null, K = null;
      for (let i = ns.length - 1; i >= 0; i--) {
        const a = ns[i];
        if (a.smooth) {
          const hit = meet(span(H, S), a.reg);
          if (hit) { const e = clipW(grow(hit, a.read)); H = span(H, e); S = span(S, e); }
          continue;
        }
        const seeds = grow(a.reg, 2), hitH = meet(H, a.box);
        if (hitH) { const e = meet(clipW(grow(hitH, a.read)), seeds); if (e) { K = span(K, e); S = span(S, meet(clipW(grow(hitH, a.local)), seeds)); } }
        const hitS = a.side > 0 && S ? meet(S, grow(a.reg, a.side)) : null;
        if (hitS) { const e = meet(clipW(grow(hitS, a.side)), seeds); if (e) K = span(K, e); const l = meet(clipW(grow(hitS, a.local)), seeds); if (l) S = span(S, l); }
      }
      const U = span(span(H, S), K);
      deepest = Math.max(deepest, core.x0 - U.x0, core.y0 - U.y0, U.x1 - core.x1, U.y1 - core.y1);
    }
    return 4 + deepest;
  }
  // H12: the budget the pages may use: the GPU budget less what the renderer needs at least (materials and one chunk), or null when no budget is given.
  // The resident set of a ring is the 2 x 3 pages a chunk's feed gathers at once (shape and weather, with the material field), the feed's staging set and the
  // shape engine's scratch (about 16 MB and 44 bytes a cell of a page's side); a ring is allowed when that set fits.
  const STAGING_BYTES = 700 * 850 * 88, FEED_PAGES = 6, PAGE_FIELD = CORE * CORE * 36;
  const engineEstimate = ring => 16e6 + (CORE + 2 * ring) ** 2 * 44;
  const available = () => { const b = opts.budget?.(); return b ? b.total - b.minimum : Infinity; };
  const residentSet = ring => FEED_PAGES * (CORE + 2 * ring) ** 2 * 52 + FEED_PAGES * PAGE_FIELD + STAGING_BYTES + engineEstimate(ring);
  function fitCaps() {
    const room = 0.92 * available() - STAGING_BYTES - engineEstimate(RING);
    SHAPE_PAGES = clamp(Math.floor(0.8 * room / SHAPE_BYTES), FEED_PAGES, 9);
    WEATHER_PAGES = clamp(Math.floor((room - SHAPE_PAGES * SHAPE_BYTES) / PAGE_FIELD), FEED_PAGES, 24);
    if (!(room > 0)) SHAPE_PAGES = WEATHER_PAGES = FEED_PAGES;
  }
  function setRing(need) {
    // The ring is the first step that holds the chain; a chain deeper than the top ring, or than the budget's largest ring, is clamped to that ring
    // (never refused): the pages read what the ring holds, so a seam may show between pages where the chain reaches further. One warning a time the
    // chain crosses the limit.
    const room = available();
    let top = RINGS.length - 1; while (top > 0 && residentSet(RINGS[top]) > room) top--;
    let ring = RINGS.find(r => r >= need);
    if (ring === undefined || ring > RINGS[top]) {
      ring = RINGS[top];
      if (!ringClamped) console.warn(`nanolathe: the stroke chain needs a page ring of ${need} cells; clamped to ${ring}${ring < RINGS[RINGS.length - 1] ? ' by the GPU memory budget' : ''}, so seams may show between pages`);
      ringClamped = true;
    } else ringClamped = false;
    if (ring !== RING) {
      RING = ring; SIDE = CORE + 2 * RING; SHAPE_BYTES = SIDE * SIDE * 52; ringChanges++;
      for (const pg of pagesMap.values()) dropShape(pg);
      scratchT?.destroy(); scratchT = null;
    }
    fitCaps(); trim();
    return true;
  }
  let ringChanges = 0, lastNeed = 0, ringClamped = false;
  const check = () => { lastNeed = opts.forceRing || ringNeed(); setRing(lastNeed); };
  const getEngine = () => enginePromise ??= (async () => {
    let d = device();
    for (let i = 0; !d && i < 600; i++) { await new Promise(r => setTimeout(r, 50)); d = device(); }
    if (!d) throw new Error('nanolathe: the GPU device is not ready for the shape passes');
    const c = context();
    return engine = await createShapeEngine({device: d, grid: worldGrid, spacing, baseHeight, sea: c.sea, minH: c.minH, maxH: c.maxH, pages: true});
  })();
  const prepare = (n, geom, c) => { let p = prep.get(n); if (!p) { p = prepareNode(n, geom, c); prep.set(n, p); } return p; };

  // ---- resources
  const shapeBytes = () => { let n = 0; for (const pg of pagesMap.values()) if (pg.target) n += pg.target.bytes; return n; };
  const weatherBytes = () => { let n = 0; for (const pg of pagesMap.values()) if (pg.weather) n += WEATHER_BYTES + (pg.weather.field ? CORE * CORE * 16 : 0); return n; };
  const stagingBytes = () => (staging?.bytes || 0) + (scratchT?.bytes || 0);
  const cpuBytes = () => { let n = 0; for (const pg of pagesMap.values()) n += (pg.cpu ? 8 * SIDE * SIDE : 0) + (pg.cpuW ? 8 * CORE * CORE : 0); return n; };
  const gpuBytes = () => shapeBytes() + weatherBytes() + stagingBytes() + (engine?.bytes() || 0);
  // A page that is read or gathered right now (pinned) keeps its buffers until the last reader lets go.
  function dropShape(pg) { if (pg.target) { if (pg.pins) (pg.zombies ??= []).push(pg.target); else pg.target.destroy(); } pg.target = null; pg.cpu = null; pg.cpuRev = -1; }
  function unpin(pg) { pg.pins--; if (!pg.pins && pg.zombies?.length) { for (const t of pg.zombies) t.destroy(); pg.zombies = []; } }
  function dropWeather(pg) { if (pg.weather) { pg.weather.weather.destroy(); pg.weather.maps.forEach(b => b.destroy()); pg.weather.field?.destroy(); pg.weather = null; pg.cpuW = null; } }
  function trim() {
    const lru = (has, free, budget, size) => {
      let total = 0; for (const pg of pagesMap.values()) if (has(pg)) total += size;
      while (total > budget) {
        let victim = null; for (const pg of pagesMap.values()) if (has(pg) && !pg.pins && (!victim || pg.used < victim.used)) victim = pg;
        if (!victim) break; free(victim); total -= size;
      }
    };
    lru(pg => pg.target, dropShape, shapeBudget(), SHAPE_BYTES);
    lru(pg => pg.weather, dropWeather, weatherBudget, WEATHER_BYTES);
    let withCpu = 0; for (const pg of pagesMap.values()) if (pg.cpu) withCpu++;
    while (withCpu > CPU_PAGES) { let victim = null; for (const pg of pagesMap.values()) if (pg.cpu && !pg.pins && (!victim || pg.used < victim.used)) victim = pg; if (!victim) break; victim.cpu = null; victim.cpuW = null; withCpu--; }
  }

  // ---- shape
  function evalPage(pg, rect = null) {
    if (!pg.target) { pg.target = engine.makeTarget(pg.x0 - RING, pg.y0 - RING, SIDE, SIDE); rect = null; }
    engine.submit(nodes(), context(), rect, {readback: false, target: pg.target, prepare});
    pg.rev++; touch(pg);
  }
  const ensureShape = pg => { if (!pg.target) { evalPage(pg); wantCpu(pg); } touch(pg); };

  // ---- CPU copies of resident pages: h and r (shape), the authored and eroded height (weather)
  const cpuWanted = new Set(); let cpuTimer = 0;
  function wantCpu(pg) { cpuWanted.add(pg.key); if (!cpuTimer) cpuTimer = setTimeout(pumpCpu, 0); }
  async function pumpCpu() {
    cpuTimer = 0;
    for (const k of [...cpuWanted]) {
      if (gesture()) { cpuTimer = setTimeout(pumpCpu, 100); return; }
      cpuWanted.delete(k); const pg = pagesMap.get(k); if (!pg) continue;
      pg.pins++;   // not evicted while its buffers are read
      try {
        if (pg.target) {
          const rev = pg.rev, t = pg.target, n = SIDE * SIDE, d = device(), h = new Float32Array(await readBuffer(d, t.F, 0, n * 4)), r = new Float32Array(await readBuffer(d, t.F, 2 * n * 4, n * 4));
          if (pg.target === t && pg.rev === rev) { pg.cpu = {h, r}; pg.cpuRev = rev; } else wantCpu(pg);
        }
        if (pg.weather && !pg.stale) {
          const w = pg.weather, raw = await readBuffer(device(), w.weather, 0, 2 * CORE * CORE * 4);
          if (pg.weather === w) pg.cpuW = {base: new Float32Array(raw, 0, CORE * CORE), e: new Float32Array(raw, CORE * CORE * 4, CORE * CORE)};
        }
      } catch (err) { error = err; } finally { unpin(pg); }
    }
    trim();
  }

  // ---- the coarse lattice
  function coarseAdd(pg, announce) {
    const k = pg.key, prev = coarseQueue.get(k);
    coarseQueue.set(k, !announce ? prev ?? null : prev ? joinWorld(prev, announce) : announce);
    if (!coarseTimer && !coarseRunning) coarseTimer = setTimeout(pumpCoarse, 0);
  }
  const joinWorld = (a, b) => { const x0 = Math.min(a.x, b.x), y0 = Math.min(a.y, b.y); return {x: x0, y: y0, width: Math.max(a.x + a.width, b.x + b.width) - x0, height: Math.max(a.y + a.height, b.y + b.height) - y0}; };
  async function pumpCoarse() {
    coarseTimer = 0; if (coarseRunning) return; coarseRunning = true;
    try {
      while (coarseQueue.size) {
        if (gesture() || !engine) { coarseTimer = setTimeout(pumpCoarse, 150); return; }
        // the page nearest the focus (the view) first
        let best = null, bd = Infinity;
        for (const k of coarseQueue.keys()) { const pg = pagesMap.get(k), d = focus ? Math.hypot(pg.x0 + CORE / 2 - focus.x, pg.y0 + CORE / 2 - focus.y) : pg.key; if (d < bd) { bd = d; best = pg; } }
        const announce = coarseQueue.get(best.key); coarseQueue.delete(best.key);
        let target = best.target;
        if (!target) {
          scratchT ??= engine.makeTarget(0, 0, SIDE, SIDE);
          scratchT.ox = best.x0 - RING; scratchT.oy = best.y0 - RING; target = scratchT;
          engine.submit(nodes(), context(), null, {readback: false, target, prepare});
        }
        const i0 = Math.ceil(best.x0 / COARSE), j0 = Math.ceil(best.y0 / COARSE), i1 = Math.floor((best.x0 + best.cw - 1) / COARSE), j1 = Math.floor((best.y0 + best.ch - 1) / COARSE);
        if (i1 >= i0 && j1 >= j0) {
          const out = await engine.decimate(target, {x0: i0 * COARSE, y0: j0 * COARSE, x1: i1 * COARSE, y1: j1 * COARSE}, COARSE);
          for (let j = 0; j < out.h; j++) for (let i = 0; i < out.w; i++) { const at = (j0 + j) * coarseW + i0 + i; coarse[at] = out.values[j * out.w + i]; coarseHave[at] = 1; }
        }
        coarseDone++;
        if (announce) { const ev = {revision, rect: announce}; for (const fn of listeners) fn(ev); }
        else if (coarseDone === 1 || !coarseQueue.size) { const ev = {revision, rect: null}; for (const fn of listeners) fn(ev); }
        await new Promise(r => setTimeout(r, 0));
      }
      if (!coarseFullAt) coarseFullAt = performance.now();
      scratchT?.destroy(); scratchT = null;   // the evaluation target the background fill borrowed (14 MB) goes back
    } catch (err) { error = err; console.error(err); }
    finally { coarseRunning = false; }
  }
  let coarseFullAt = 0;
  const coarseAt = (ix, iy) => {   // the lattice, bilinear, at cell (ix, iy)
    const gx = clamp(ix / COARSE, 0, coarseW - 1), gy = clamp(iy / COARSE, 0, coarseW - 1), i = Math.floor(gx), j = Math.floor(gy), i2 = Math.min(i + 1, coarseW - 1), j2 = Math.min(j + 1, coarseW - 1), fx = gx - i, fy = gy - j;
    return (coarse[j * coarseW + i] * (1 - fx) + coarse[j * coarseW + i2] * fx) * (1 - fy) + (coarse[j2 * coarseW + i] * (1 - fx) + coarse[j2 * coarseW + i2] * fx) * fy;
  };

  // ---- Time pass per page
  function setTime(t) {
    const k = t ? t.key : '';
    if (k === timeKey && !!t === !!time) { time = t; return false; }
    time = t; timeKey = k;
    for (const pg of pagesMap.values()) { dropWeather(pg); pg.stale = false; pg.staleSeq++; }
    return true;
  }
  let weatherChain = Promise.resolve();
  const ensureWeather = pg => {
    if (pg.weatherJob) return pg.weatherJob;
    const job = weatherChain.then(() => computeWeather(pg)).finally(() => { if (pg.weatherJob === job) pg.weatherJob = null; });
    weatherChain = job.catch(() => {});
    return pg.weatherJob = job;
  };
  async function computeWeather(pg) {
    if (!time) return;
    const t0 = performance.now(), side = Math.min(worldGrid, CORE + 2 * APRON), wx0 = clamp(pg.x0 - APRON, 0, worldGrid - side), wy0 = clamp(pg.y0 - APRON, 0, worldGrid - side), seq = pg.staleSeq, tm = time;
    const T = engine.makeTarget(wx0, wy0, side, side);
    try {
      engine.submit(nodes(), context(), null, {readback: false, target: T, prepare});
      const r = await tm.run({planes: T.F, masks: T.Mk, grid: side, ox: wx0, oy: wy0});
      if (time !== tm) { r.weather.destroy(); r.maps.forEach(b => b.destroy()); r.field?.destroy(); return; }
      const d = device(), S = GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC | GPUBufferUsage.COPY_DST;
      const w = {weather: d.createBuffer({label: 'page weather', size: 2 * CORE * CORE * 4, usage: S}), maps: [0, 1, 2].map(k => d.createBuffer({label: 'page map ' + k, size: CORE * CORE * 4, usage: S})),
        field: r.field ? d.createBuffer({label: 'page material field', size: CORE * CORE * 16, usage: S}) : null};
      const enc = d.createCommandEncoder({label: 'page weather crop'}), wn = side * side;
      for (let row = 0; row < pg.ch; row++) {
        const from = (pg.y0 - wy0 + row) * side + (pg.x0 - wx0), to = row * CORE;
        for (let p = 0; p < 2; p++) enc.copyBufferToBuffer(r.weather, (p * wn + from) * 4, w.weather, (p * CORE * CORE + to) * 4, pg.cw * 4);
        for (let k = 0; k < 3; k++) enc.copyBufferToBuffer(r.maps[k], from * 4, w.maps[k], to * 4, pg.cw * 4);
        if (r.field) enc.copyBufferToBuffer(r.field, from * 16, w.field, to * 16, pg.cw * 16);
      }
      d.queue.submit([enc.finish()]);
      await d.queue.onSubmittedWorkDone();
      r.weather.destroy(); r.maps.forEach(b => b.destroy()); r.field?.destroy();
      dropWeather(pg); pg.weather = w; if (pg.staleSeq === seq) pg.stale = false;
      pg.weatherMs = performance.now() - t0; weatherRuns++; weatherMsTotal += pg.weatherMs;
      touch(pg); wantCpu(pg);
    } finally { T.destroy(); }
  }
  let weatherRuns = 0, weatherMsTotal = 0;

  // ---- ensure a rectangle (cells) is ready to be read; returns a lease that pins its pages
  async function prepareRect(rect, wantWeather) {
    if (!engine) await getEngine();
    const need = overlapping(rect); for (const pg of need) pg.pins++;
    let released = false;
    const lease = {pages: need, release() { if (released) return; released = true; for (const pg of need) unpin(pg); trim(); }};
    try {
      for (const pg of need) ensureShape(pg);
      if (wantWeather && time) for (const pg of need) { if (!pg.weather || (pg.stale && !gesture())) await ensureWeather(pg); touch(pg); }
      trim();
    } catch (err) { lease.release(); throw err; }
    focus = {x: (rect.x0 + rect.x1) / 2, y: (rect.y0 + rect.y1) / 2};
    return lease;
  }

  // ---- gather: encode the copy of `rect` from the pages' buffers into the destination set (encoder passes; pipelines from feedPasses)
  function encodeGather(enc, passes, rect, dst, wantWeather) {
    const d = device(), gw = rect.x1 - rect.x0 + 1, gh = rect.y1 - rect.y0 + 1, tmp = [];
    for (const pg of overlapping(rect)) {
      const dispatch = (entry, src, box, res) => {
        const o = {x0: Math.max(rect.x0, box.x0), y0: Math.max(rect.y0, box.y0), x1: Math.min(rect.x1, box.x1), y1: Math.min(rect.y1, box.y1)};
        if (o.x1 < o.x0 || o.y1 < o.y0) return;
        const u = d.createBuffer({label: 'gather uniform', size: 64, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST}), dv = new DataView(new ArrayBuffer(64));
        [src.ox, src.oy, src.pw, src.ph, o.x0, o.y0, o.x1, o.y1, rect.x0, rect.y0, gw, gh].forEach((v, i) => { if ([0, 1, 4, 5, 6, 7, 8, 9].includes(i)) dv.setInt32(i * 4, v, true); else dv.setUint32(i * 4, v, true); });
        d.queue.writeBuffer(u, 0, dv.buffer); tmp.push(u);
        const r = {'3.0': {buffer: u}, ...res}, pass = enc.beginComputePass({label: entry});
        pass.setPipeline(passes.pipes[entry]); for (const [g, bg] of passes.groups(entry, r)) pass.setBindGroup(g, bg);
        pass.dispatchWorkgroups(Math.ceil((o.x1 - o.x0 + 1) / 8), Math.ceil((o.y1 - o.y0 + 1) / 8)); pass.end();
      };
      const core = coreRect(pg);
      dispatch('gatherShape', {ox: pg.x0 - RING, oy: pg.y0 - RING, pw: SIDE, ph: SIDE}, core, {'3.1': {buffer: pg.target.F}, '3.2': {buffer: pg.target.Mk}, '3.3': {buffer: dst.F}, '3.4': {buffer: dst.Mk}});
      if (wantWeather && pg.weather) {
        const src = {ox: pg.x0, oy: pg.y0, pw: CORE, ph: CORE};
        dispatch('gatherHeight', src, core, {'3.5': {buffer: pg.weather.weather}, '3.6': {buffer: dst.W}});
        if (pg.weather.field) dispatch('gatherField', src, core, {'3.13': {buffer: pg.weather.field}, '3.14': {buffer: dst.Fd}});
        dispatch('gatherMaps', src, core, {'3.7': {buffer: pg.weather.maps[0]}, '3.8': {buffer: pg.weather.maps[1]}, '3.9': {buffer: pg.weather.maps[2]}, '3.10': {buffer: dst.M[0]}, '3.11': {buffer: dst.M[1]}, '3.12': {buffer: dst.M[2]}});
      }
    }
    return tmp;
  }
  function makeSet(cells, label) {
    const d = device(), S = GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC | GPUBufferUsage.COPY_DST, mk = (n, l) => d.createBuffer({label: label + ' ' + l, size: Math.max(16, n), usage: S});
    const set = {cells, F: mk(cells * 24, 'planes'), Mk: mk(cells * 28, 'masks'), W: mk(cells * 8, 'height'), M: [0, 1, 2].map(k => mk(cells * 4, 'map ' + k)), Fd: mk(cells * 16, 'material field')};
    set.bytes = cells * 88; set.destroy = () => { set.F.destroy(); set.Mk.destroy(); set.W.destroy(); set.M.forEach(b => b.destroy()); set.Fd.destroy(); };
    return set;
  }
  // The staging set the chunk bake reads, reused (grown, never shrunk): the queue is in order, so a later gather runs after an earlier bake's feed pass.
  function stagingFor(cells) {
    if (!staging || staging.cells < cells) { const old = staging; staging = makeSet(Math.max(cells, 700 * 850), 'feed staging'); old?.destroy(); }
    return staging;
  }

  // ---- reads
  const cropFrom = (rect, planes, masks, hBlend) => {
    const w = rect.x1 - rect.x0 + 1, h = rect.y1 - rect.y0 + 1, n = w * h, fields = {};
    FIELD_KEYS_FLOAT.forEach((k, p) => { fields[k] = planes.slice(p * n, (p + 1) * n); });
    if (hBlend) fields.h = hBlend;
    maskKeys.forEach((k, m) => { const out = new Int8Array(n); for (let i = 0; i < n; i++) { const word = masks[i * 7 + (m >> 2)]; out[i] = (word << (24 - (m & 3) * 8)) >> 24; } fields[k] = out; });
    return {fields, maskPlanes: maskKeys.map(k => fields[k]), gridWidth: w, gridHeight: h, gridSpacing: spacing, gridOrigin: [rect.x0 * spacing, rect.y0 * spacing], worldSize, worldGrid, revision, bytes: n * (24 + maskKeys.length), rect: worldRect(rect)};
  };
  async function readRect(rect, {weather = true} = {}) {
    const wantWeather = weather && Boolean(time), lease = await prepareRect(rect, wantWeather);
    try {
      const passes = await feedPasses(device()), gw = rect.x1 - rect.x0 + 1, gh = rect.y1 - rect.y0 + 1, n = gw * gh, set = makeSet(n, 'read'), d = device();
      const enc = d.createCommandEncoder({label: 'read rect'}), tmp = encodeGather(enc, passes, rect, set, wantWeather);
      const stage = (b, bytes) => { const s = d.createBuffer({label: 'read stage', size: Math.max(16, bytes), usage: GPUBufferUsage.MAP_READ | GPUBufferUsage.COPY_DST}); enc.copyBufferToBuffer(b, 0, s, 0, bytes); return s; };
      const sF = stage(set.F, n * 24), sM = stage(set.Mk, n * 28), sW = wantWeather ? stage(set.W, n * 8) : null;
      d.queue.submit([enc.finish()]); lease.release();
      await Promise.all([sF, sM, sW].filter(Boolean).map(b => b.mapAsync(GPUMapMode.READ)));
      const planes = new Float32Array(sF.getMappedRange().slice(0)), masks = new Uint32Array(sM.getMappedRange().slice(0)), wt = sW ? new Float32Array(sW.getMappedRange().slice(0)) : null;
      [sF, sM, sW].forEach(b => b?.destroy()); set.destroy(); tmp.forEach(b => b.destroy());
      let blend = null;
      if (wt) { blend = new Float32Array(n); const base = wt.subarray(0, n), e = wt.subarray(n); for (let i = 0; i < n; i++) { const h = planes[i]; blend[i] = h + (e[i] - base[i]) * (1 - smooth(0, 10, Math.abs(h - base[i]))) * (1 - planes[2 * n + i]); } }
      return cropFrom(rect, planes, masks, blend);
    } finally { lease.release(); }
  }
  const toCells = ({x = 0, y = 0, width = 0, height = width, apron = 0}) => ({x0: Math.floor((x - apron) / spacing), y0: Math.floor((y - apron) / spacing), x1: Math.ceil((x + width + apron) / spacing), y1: Math.ceil((y + height + apron) / spacing)});

  // ---- sync reads
  const pageAt = (ix, iy) => pagesMap.get(key(ix >> SHIFT, iy >> SHIFT));
  const cell = (ix, iy, k = 'h') => {
    ix = clamp(Math.round(ix), 0, worldGrid - 1); iy = clamp(Math.round(iy), 0, worldGrid - 1);
    const pg = pageAt(ix, iy);
    if (pg?.cpu && pg.cpuRev === pg.rev) { const i = (iy - pg.y0 + RING) * SIDE + ix - pg.x0 + RING; return k === 'h' ? pg.cpu.h[i] : k === 'r' ? pg.cpu.r[i] : 0; }
    return k === 'h' ? coarseAt(ix, iy) : 0;
  };
  const bilinear = (x, y, at) => {
    const gx = clamp(x / spacing, 0, worldGrid - 1), gy = clamp(y / spacing, 0, worldGrid - 1), ix = Math.floor(gx), iy = Math.floor(gy), jx = Math.min(ix + 1, worldGrid - 1), jy = Math.min(iy + 1, worldGrid - 1), fx = gx - ix, fy = gy - iy;
    return (at(ix, iy) * (1 - fx) + at(jx, iy) * fx) * (1 - fy) + (at(ix, jy) * (1 - fx) + at(jx, jy) * fx) * fy;
  };
  const erodedCell = (ix, iy) => {
    const pg = pageAt(ix, iy);
    if (!pg?.cpu || pg.cpuRev !== pg.rev) return coarseAt(ix, iy);
    const i = (iy - pg.y0 + RING) * SIDE + ix - pg.x0 + RING, h = pg.cpu.h[i];
    if (!time || !pg.cpuW) return h;
    const j = (iy - pg.y0) * CORE + ix - pg.x0, base = pg.cpuW.base[j];
    return h + (pg.cpuW.e[j] - base) * (1 - smooth(0, 10, Math.abs(h - base))) * (1 - pg.cpu.r[i]);
  };

  // ---- changes
  function changed(rect = null, keepPrefix = 0) {
    revision++; prep = new Map();
    check();
    const cr = rect ? clip(rect) : null, r = cr ? clip({x0: cr.x0 - 6, y0: cr.y0 - 6, x1: cr.x1 + 6, y1: cr.y1 + 6}) : null, event = {revision, rect: cr ? worldRect(cr) : null};
    const announce = event.rect;
    for (const pg of pagesMap.values()) {
      if (!r) { dropShape(pg); dropWeather(pg); pg.staleSeq++; pg.stale = false; continue; }
      if (pg.weather && hits(windowRect(pg), {x0: r.x0 - 6, y0: r.y0 - 6, x1: r.x1 + 6, y1: r.y1 + 6})) { pg.stale = true; pg.staleSeq++; pendingStale = pendingStale ? joinWorld(pendingStale, worldRect(r)) : worldRect(r); }
      if (pg.target && engine && hits(bufRect(pg), r)) { evalPage(pg, r); wantCpu(pg); }
    }
    if (!r) { pendingStale = null; for (let py = 0; py < np; py++) for (let px = 0; px < np; px++) coarseAdd(page(px, py), null); }
    else for (const pg of overlapping(r)) coarseAdd(pg, announce);
    for (const fn of submitListeners) fn(event);
    return event;
  }
  // The gesture is over: the stale pages' region (for the canvas to rebake), and the deferred reads.
  function settle() {
    const out = pendingStale; pendingStale = null;
    for (const pg of pagesMap.values()) if (pg.target && !pg.cpu) wantCpu(pg);
    for (const pg of pagesMap.values()) if (pg.target && pg.cpuRev !== pg.rev) wantCpu(pg);
    return out;
  }

  const stats = () => {
    const g = engine?.stats() || {}, resident = [...pagesMap.values()].filter(p => p.target).length, weathers = [...pagesMap.values()].filter(p => p.weather).length;
    return {revision, residentBytes: cpuBytes() + coarse.byteLength, cacheBytes: cpuBytes(), cacheEntries: resident, lastWorkingBytes: 0, peakBytes: cpuBytes(), budget: shapeBudget() + weatherBudget, hits: 0, misses: 0, replays: 0, evictions: 0,
      chunkCells: CORE, worldSize, worldGrid, gridSpacing: spacing, bytesPerCell: 52, workspaceBytesPerCell: 0, maxWorkingCells: 0, pointSamples: 0, connectionTiles: 0, connectionCells: 0,
      gpuShape: {...g, gpuBytes: gpuBytes(), paged: true, core: CORE, ring: RING, ringChanges, apron: APRON, shapePages: resident, weatherPages: weathers, pagesTotal: np * np, shapeBytes: shapeBytes(), weatherBytes: weatherBytes(), stagingBytes: stagingBytes(), cpuCopyBytes: cpuBytes(),
        coarse: {points: coarse.length, filled: coarseHave.reduce((a, b) => a + b, 0), done: coarseDone, queued: coarseQueue.size, fullAt: coarseFullAt}, weatherRuns, weatherMsTotal, error: (error || firstError)?.message || null}};
  };

  return {
    paged: true, core: CORE, apron: APRON, ring: RING,
    buffers: () => [],
    read: () => { throw new Error('nanolathe: a paged map is read with readAsync'); }, readCells: () => { throw new Error('nanolathe: a paged map is read with readAsync'); },
    sample: (x, y, k = 'h') => bilinear(x, y, (ix, iy) => cell(ix, iy, k)), cell: (ix, iy, k) => cell(ix, iy, k),
    sampleEroded: (x, y) => bilinear(x, y, erodedCell),
    changed, refit: () => { const before = RING; check(); if (RING !== before) changed(); }, ready: () => Promise.resolve(), pending: () => false,
    readAsync: async (request, o) => readRect(toCells(request), o),
    readRect: (rect, o) => readRect(clip(rect), o),
    replayDetail: () => Object.fromEntries(keys.map(k => [k, 0])),
    subscribe(fn) { listeners.add(fn); return () => listeners.delete(fn); }, subscribeSubmit(fn) { submitListeners.add(fn); return () => submitListeners.delete(fn); },
    stats, active: () => true,
    maskChunks: async () => {
      const out = [], T = 256;
      for (let ty = 0; ty < worldGrid; ty += T) for (let tx = 0; tx < worldGrid; tx += T) {
        const r = {x0: tx, y0: ty, x1: Math.min(tx + T, worldGrid) - 1, y1: Math.min(ty + T, worldGrid) - 1}, c = await readRect(r, {weather: false});
        if (!maskKeys.some(k => c.fields[k].some(v => v !== 0))) continue;
        out.push({key: [r.x0, r.y0, r.x1, r.y1].join('_'), rect: c.rect, gridWidth: c.gridWidth, gridHeight: c.gridHeight, gridOrigin: c.gridOrigin, gridSpacing: spacing, revision, version: revision, planes: maskKeys.map(k => c.fields[k]), masks: Object.fromEntries(maskKeys.map(k => [k, c.fields[k]]))});
      }
      return out;
    },
    planes: () => null, engine: () => engine, gpuBuffers: () => null,
    gpuReady: () => Promise.resolve(), gpuQuiet: () => Promise.resolve(), gpuPending: () => false,
    settle,
    // the map canvas's feed: pages ready for `rect` (cells), and a gather to encode into the bake's encoder
    async feedSource(rect, wantWeather) {
      const lease = await prepareRect(rect, wantWeather && Boolean(time));
      const weather = wantWeather && Boolean(time);
      return {paged: true, weather, revision, release: () => lease.release(), maskCount: maskKeys.length,   // revision: the fields' revision the bake read (perf.mjs's move-to-picture latency)
        gather(enc, passes) {
          const gw = rect.x1 - rect.x0 + 1, gh = rect.y1 - rect.y0 + 1, set = stagingFor(gw * gh), tmp = encodeGather(enc, passes, rect, set, weather);
          return {planes: set.F, masks: set.Masks ?? set.Mk, weather: weather ? set.W : null, maps: weather ? set.M : null, field: weather && time.material ? set.Fd : null, grid: gw, cells: gw * gh, tmp};
        }};
    },
    setTime, timeOn: () => Boolean(time),
    setFocus: r => { focus = r; },
    startCoarse: () => getEngine().then(() => { coarseStart = performance.now(); for (let py = 0; py < np; py++) for (let px = 0; px < np; px++) coarseAdd(page(px, py), null); }),
    debugGather: async rect => {
      const lease = await prepareRect(rect, true), passes = await feedPasses(device()), d = device(), n = (rect.x1 - rect.x0 + 1) * (rect.y1 - rect.y0 + 1), set = makeSet(n, 'dbg');
      const enc = d.createCommandEncoder(), tmp = encodeGather(enc, passes, rect, set, true); d.queue.submit([enc.finish()]); lease.release();
      const W = new Float32Array(await readBuffer(d, set.W, 0, n * 8)), maps = await Promise.all(set.M.map(b => readBuffer(d, b, 0, n * 4).then(x => new Uint8Array(x))));
      set.destroy(); tmp.forEach(b => b.destroy()); return {W, maps, n};
    },
    debugPages: () => [...pagesMap.values()].filter(p => p.weather).map(p => ({x0: p.x0, y0: p.y0, cw: p.cw, ch: p.ch, weather: p.weather.weather, maps: p.weather.maps, core: CORE})),
    pageInfo: () => ({np, core: CORE, need: lastNeed, ring: RING, apron: APRON, side: SIDE}),
    destroy() { for (const pg of pagesMap.values()) { dropShape(pg); dropWeather(pg); } staging?.destroy(); scratchT?.destroy(); engine?.destroy(); },
  };
}

// ---- H6b: the feed passes (engine-feed.wgsl) ----
// Which bindings (group.binding) each entry point reads or writes: the pipelines take their layouts from the shader ('auto'), which holds only
// the bindings an entry point uses, so a bind group must carry exactly these.
const FEED_USES = {
  seedMain: ['0.0', '0.1', '0.2', '1.0', '1.1', '1.2', '1.3'], tileFlagMain: ['0.0', '1.3', '1.4'], tileListMain: ['0.0', '1.4', '1.5', '1.6'],
  tileArgsMain: ['1.6', '1.7'], refinedMain: ['0.0', '1.8', '1.9'],
  feedMain: ['0.0', '0.1', '0.2', '2.0', '2.1', '2.2', '2.3', '2.4', '2.5', '2.6', '2.7', '2.8', '2.9'],
  // H5b: the gather from pages
  gatherShape: ['3.0', '3.1', '3.2', '3.3', '3.4'], gatherHeight: ['3.0', '3.5', '3.6'], gatherMaps: ['3.0', '3.7', '3.8', '3.9', '3.10', '3.11', '3.12'], gatherField: ['3.0', '3.13', '3.14']};
const feedCache = new WeakMap();
// {pipes, groups(entry, resources)}: resources maps 'group.binding' to a binding resource; groups() returns [[index, bindGroup]...].
export function feedPasses(device) {
  let cached = feedCache.get(device);
  if (cached) return cached;
  cached = (async () => {
    const module = device.createShaderModule({label: 'engine-feed', code: await (await fetch('/engine-feed.wgsl')).text()});
    const info = await module.getCompilationInfo(), errors = info.messages.filter(m => m.type === 'error');
    if (errors.length) throw new Error('nanolathe: engine-feed.wgsl does not compile:\n' + errors.map(e => `${e.lineNum}:${e.linePos} ${e.message}`).join('\n'));
    const pipes = {};
    await Promise.all(Object.keys(FEED_USES).map(async entry => { pipes[entry] = await device.createComputePipelineAsync({label: entry, layout: 'auto', compute: {module, entryPoint: entry}}); }));
    const groups = (entry, resources) => {
      const byGroup = new Map();
      for (const key of FEED_USES[entry]) {
        const [g, b] = key.split('.').map(Number);
        if (!resources[key]) throw new Error(`nanolathe: feed pass ${entry} needs binding ${key}`);
        if (!byGroup.has(g)) byGroup.set(g, []);
        byGroup.get(g).push({binding: b, resource: resources[key]});
      }
      return [...byGroup].map(([g, entries]) => [g, device.createBindGroup({label: entry, layout: pipes[entry].getBindGroupLayout(g), entries})]);
    };
    return {pipes, groups};
  })();
  feedCache.set(device, cached);
  return cached;
}
// The feed passes' uniform (struct FU of engine-feed.wgsl): 16 words.
export function feedUniform(device, f) {
  const buffer = device.createBuffer({label: 'feed uniform', size: 64, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST}), dv = new DataView(new ArrayBuffer(64));
  const u = ['grid', 'cells', 'ox', 'oy', 'gw', 'gh', 'cw', 'ch', 'mode', 'rateMask'], fl = ['sea', 'spacing', 'envelope'];
  u.forEach((k, i) => { if (['ox', 'oy'].includes(k)) dv.setInt32(i * 4, f[k] ?? 0, true); else dv.setUint32(i * 4, (f[k] ?? 0) >>> 0, true); });
  fl.forEach((k, i) => dv.setFloat32((10 + i) * 4, f[k] ?? 0, true));
  dv.setUint32(13 * 4, f.tilesWide ?? 0, true);
  device.queue.writeBuffer(buffer, 0, dv.buffer);
  return buffer;
}
// Read `bytes` of a buffer (which needs COPY_SRC) from `offset`, through a staging buffer.
export async function readBuffer(device, buffer, offset, bytes) {
  const stage = device.createBuffer({label: 'feed readback', size: Math.max(4, bytes), usage: GPUBufferUsage.MAP_READ | GPUBufferUsage.COPY_DST}), enc = device.createCommandEncoder({label: 'feed readback'});
  enc.copyBufferToBuffer(buffer, offset, stage, 0, bytes);
  device.queue.submit([enc.finish()]);
  await stage.mapAsync(GPUMapMode.READ);
  const out = stage.getMappedRange().slice(0, bytes); stage.unmap(); stage.destroy();
  return out;
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
