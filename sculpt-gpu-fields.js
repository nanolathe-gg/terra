import {terrainAllocation} from './sculpt-memory.js';
import {MATERIAL_SLOTS} from './sculpt-materials.js';
import {shapePaths,simplifyPath} from './sculpt-paths.js';
import {invalidateRefinement,refinementValid} from './sculpt-change-map.js';
import {isRiver, isBraided, riverWidth, riverCurvature} from './sculpt-river.js';
import {strokeCurve, scatterSize, leanSetup, variability, CV_N, sampleKnots, landformSides, landformReach, landformBackSide, alongKnots, landformElevation, landformSteps, landformShore, landformBeach, landformMakesWater, talusOn, landformSigned, landformDigs, impactOn, bucklingOn, secondaryNear, impactSetup, impactPoint, impactEnd, impactSpread, impactWeight, landformPeak} from './sculpt-shape-presets.js';
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

// u: the part of h the art does not show (the undulation a ground node with Undulation in the art below 1 leaves out; engine-shape.wgsl artLevel).
const FIELD_KEYS_FLOAT = ['h', 'p', 'r', 'c', 'v', 'x', 'u'];
const PLANES = FIELD_KEYS_FLOAT.length;
const KIND = {paint: 0, erase: 1, sand: 9, grass: 10, smooth: 11, fissure: 14, landform: 16};
// The stroke kinds the passes draw (a node of any other kind draws nothing).
export const DRAWN_KINDS = Object.keys(KIND);

// ---- the height image: a node of kind 'heights' ----
// It writes an image of height samples into the authored height plane (engine-shape.wgsl `heights`). Like the ground node it has no path and no
// brush card, so its values are the node's own fields (`params` is a stroke's brush card, which the panel edits):
//   image          the samples as base64 (standard alphabet, padded, no spaces), row by row from sample (0, 0): one byte a sample (bits 8), or
//                  two, low byte first (bits 16)
//   width, height  the samples across and down: at most 1282 x 1288, a 40 x 40 map's height bytes
//   x, y, cell     where it lies: sample (i, j) sits at world pixel (x + i * cell, y + j * cell). The export samples height byte (a, b) at pixel
//                  (16 a, 16 b), a cell's corner (sculpt-map.js cellHeightTiles): with cell 16 and x, y multiples of 16, sample (i, j) is byte
//                  (x / 16 + i, y / 16 + j), and an image of bytes exports the same bytes (with no Time pass, and inside the height range)
//   scale, offset  a sample's height is sample * scale + offset
//   mode           how it meets the ground under it, as a landform's Combine does: 'raise' keeps the higher, 'cut' the lower, 'flatten' sets the
//                  ground to the image and eases back into the ground across the margin, 'replace' sets it with no easing
// Between samples the surface is a bicubic one through every sample (hmWeights in the shader). It covers the samples and a margin of HEIGHTS_REACH
// cells round them (the bicubic's reach), where the edge samples repeat; outside that the node writes nothing. A cell reads the image at its own
// position and no other cell, so the node needs no read apron and no page ring.
export const HEIGHTS_LIMIT = {width: 1282, height: 1288};
export const HEIGHTS_MODES = ['raise', 'cut', 'flatten', 'replace'];   // the index is the shader's u.combine (0..2 as a landform's)
export const HEIGHTS_REACH = 2;
// The node's fields, checked, in one order (the save's) and with the defaults filled in. A node the engine cannot draw as written is an error, which
// a load reports before it changes the map (sculpt.js deserializeNodes).
export function heightsFields(n, name = 'The height image') {
  const bad = why => { throw new Error(`${name} ${why}.`); };
  const {image, bits = 8, width, height, cell = 16, x = 0, y = 0, scale = 1, offset = 0, mode = 'replace'} = n || {};
  if (bits !== 8 && bits !== 16) bad('must have 8 or 16 bits a sample');
  if (!Number.isInteger(width) || !Number.isInteger(height) || width < 1 || height < 1) bad('needs a whole number of samples across and down');
  if (width > HEIGHTS_LIMIT.width || height > HEIGHTS_LIMIT.height) bad(`has ${width} x ${height} samples, over the limit of ${HEIGHTS_LIMIT.width} x ${HEIGHTS_LIMIT.height}`);
  if (![cell, x, y, scale, offset].every(Number.isFinite) || cell < 1 || cell > 1024) bad('needs finite numbers for cell (1 to 1024 px), x, y, scale and offset');
  if (!HEIGHTS_MODES.includes(mode)) bad(`has the mode ${JSON.stringify(mode)}; the modes are ${HEIGHTS_MODES.join(', ')}`);
  const bytes = width * height * bits / 8, chars = 4 * Math.ceil(bytes / 3), padding = (3 - bytes % 3) % 3;
  if (typeof image !== 'string' || image.length !== chars || /^[A-Za-z0-9+/]*(=*)$/.exec(image)?.[1].length !== padding)
    bad(`needs ${width} x ${height} samples of ${bits} bits as base64: ${bytes} bytes, ${chars} characters`);
  return {image, bits, width, height, cell, x, y, scale, offset, mode};
}
// A node's checked fields and the heights of its samples (sample * scale + offset, as f32): checked and decoded once for a node object, and again
// only if a field has changed since (the engine prepares every node on every run).
const HEIGHTS_KEYS = ['image', 'bits', 'width', 'height', 'cell', 'x', 'y', 'scale', 'offset', 'mode'];
const heightsDecoded = new WeakMap();
export function heightsImage(n) {
  const have = heightsDecoded.get(n);
  if (have && HEIGHTS_KEYS.every(k => have.raw[k] === n[k])) return have;
  const f = heightsFields(n), text = atob(f.image), count = f.width * f.height, values = new Float32Array(count);
  if (f.bits === 8) for (let i = 0; i < count; i++) values[i] = text.charCodeAt(i) * f.scale + f.offset;
  else for (let i = 0; i < count; i++) values[i] = (text.charCodeAt(2 * i) | text.charCodeAt(2 * i + 1) << 8) * f.scale + f.offset;
  const made = {raw: Object.fromEntries(HEIGHTS_KEYS.map(k => [k, n[k]])), fields: f, values};
  heightsDecoded.set(n, made);
  return made;
}
// The world rectangle (px) a height image covers: its samples and the margin round them.
export const heightsBounds = f => ({x0: f.x - HEIGHTS_REACH * f.cell, y0: f.y - HEIGHTS_REACH * f.cell, x1: f.x + (f.width - 1 + HEIGHTS_REACH) * f.cell, y1: f.y + (f.height - 1 + HEIGHTS_REACH) * f.cell});
// Mirrors NOISE_FIELDS in sculpt.js: [wavelength, weight, salt] twice, in the order the shader indexes them.
const NOISE = [
  [[95, .7, 0x1863], [37, .3, 0x32a7]], [[95, .7, 0x73c1], [37, .3, 0x9e15]], [[64, .65, 0x5b39], [23, .35, 0x2ac9]],
  [[210, .65, 0x5e17], [75, .35, 0x37ab]], [[210, .65, 0x84d1], [75, .35, 0x192f]], [[180, .65, 0x73b9], [55, .35, 0x4f25]], [[170, .75, 0x986d], [48, .25, 0x62f3]]];
const F_X = 0, F_Y = 1, F_COAST_X = 3, F_COAST_Y = 4;
// What a painted-mask choice writes, as [plane, target] (MASK_WRITES in sculpt.js). Choices 14 and 15 (the old face rock share) write nothing.
const MASK_WRITES = [null, [[0, 127], [1, 0], [3, 0]], [[1, 127], [0, 0], [3, 0]], [[2, 127]], [[3, 127], [0, 0], [1, 0]], [[4, 127]], [[4, -127]],
  [[0, 0], [1, 0], [2, 0], [3, 0], [4, 0], [5, 0], [6, 0], [7, 0], [8, 0], [9, 0], [10, 0], [11, 0], [12, 0], [13, 0], [14, 0], [15, 0], [16, 0], [17, 0]],
  [[5, 127]], [[5, -127]], [[6, 127]], [[6, -127]], [[7, 127]], [[7, -127]], [], [], [[12, 127]], [[12, -127]],
  [[14, 127]], [[14, -127]], [[15, 127]], [[15, -127]], [[16, 127]], [[16, -127]], [[17, 127]], [[17, -127]]];
// Erase clears the painted planes by its weight, and the rock a cell belongs to all or nothing (flat 2: where the weight is a half or more), since
// a slot cannot be blended.
const ERASE_WRITES = [...MASK_WRITES[7], [20, 0, 1, 2], [21, 0, 1, 2]];
// A stroke's water edge choice, as [key, plane]. Plane 9 is a stroke's Soft bank (waterShore 1): no shore rock round its water (engine-rock-weather.wgsl).
const WATER_PLANES = [['waterDeep', 10]];
// H9: maskSetup() of sculpt.js for a landform: its Local vegetation (plane 16) and a landform stroke's
// edge flag (written at full strength, `flat`). Each entry is [plane, target, gain, flat].
// Rock presets (B2): the rock a landform is made of goes into mask plane 20 as its slot + 1, at full strength wherever the stroke moved the height
// (`flat`), so the later stroke wins where two overlap; its talus and its shore fingers claim it too (engine-shape.wgsl claimRock). Rock beneath (-1)
// writes nothing. A satellite (an impact's secondary) claims with its parent.
export const ROCK_PLANE = 20;
const rockClaim = q => { const k = Math.round(q.rockPreset ?? -1); return k >= 0 && k < 16 ? [[ROCK_PLANE, k + 1, 1, 1]] : []; };
export const GROUND_PLANE = 21;
const groundClaim = q => { const k = q.groundPreset ?? -1; return Number.isInteger(k) && k >= 0 && k < MATERIAL_SLOTS ? [[GROUND_PLANE, k + 1, 1, 1]] : []; };
function shapeMaskWrites(kind, q, sat) {
  if (kind !== 'landform') return [];
  if (sat) return [...rockClaim(q), ...groundClaim(q)];
  const out = [...rockClaim(q), ...groundClaim(q)], vegetation = clamp(q.styleVegetation || 0, -1, 1);
  if (Math.abs(vegetation) >= .005) out.push([16, Math.round(127 * vegetation), 1, 0]);
  WATER_PLANES.forEach(([k, plane]) => {
    const c = Math.round(q[k] || 0);
    if (c < 1 || c > 2) return;
    out.push([plane, c === 2 ? -127 : 127, 1, 1]);
  });
  if (Math.round(q.waterShore || 0) === 1 && landformMakesWater(q)) out.push([9, 127, 1, 1]);
  // P27: Surf, 0..1 into plane 18, at full strength inside the footprint of a stroke that makes water.
  if (q.surf > 0 && landformMakesWater(q)) out.push([18, Math.round(127 * clamp(q.surf, 0, 1)), 1, 1]);
  return out;
}

// The uniform struct, in one list so the WGSL and the writer cannot drift apart: [name, type] with type f (f32), u (u32), i (i32).
const NODE_FIELDS = [
  ...['fcMode', 'fcSurface'].map(k => [k, 'u']), ...['fcL', 'fcStrength', 'fcStep', 'fcShare'].map(k => [k, 'f']), ...['cgSize', 'cgFacet', 'cgSizeVar', 'cgSmooth', 'cgTiers', 'cgStep', 'cgVar', 'bgRough', 'bgJit'].map(k => [k, 'f']),
  ...['plMat'].map(k => [k, 'u']), ...['plWater', 'plLand', 'plSize', 'plGap', 'plHeight', 'plSeam', 'plVary', 'plNeedles', 'frGapSize', 'frGapDepth', 'frGaps', 'frGapReach'].map(k => [k, 'f']),
  ...['grid', 'kind', 'nseg', 'seed', 'framed', 'nwrites', 'segBase', 'mwBase', 'bsrc', 'bdst', 'blurR', 'pw', 'ph', 'direct', 'curveBase', 'backBase', 'cvLip', 'sSteps', 'coPutW', 'coMoved', 'coSrc', 'coScal', 'coN', 'coSNI', 'coSNJ', 'combine', 'alongBase'].map(k => [k, 'u']),
  ...['rx0', 'ry0', 'rx1', 'ry1', 'ox', 'oy', 'coStep', 'coSI0', 'coSJ0', 'coBx0', 'coBy0', 'coBx1', 'coBy1'].map(k => [k, 'i']),
  ...['spacing', 'baseH', 'sea', 'minH', 'maxH', 'radius', 'amount', 'amountPct', 'rough', 'softness', 'leanK', 'bearX', 'bearY', 'leanSide', 'wK', 'wLo', 'wHi', 'amp', 'faceVar', 
    'crackAmt', 'rotX', 'rotY', 'inv0', 'inv1', 'inv2', 'inv3', 'inv4', 'inv5', 
    'gAmp', 'gWave', 'gCover', 'fHw', 'fKf', 'fJag', 'fAmp', 'fCell', 'fCrack', 'fNet', 'fDark', 'cTop', 'sFlat', 'sJit', 'coFar', 'coLimit', 'coFReach', 'coFAmt', 'cfSize', 'coW', 'coLedge', 'coIrr', 'coVary', 'coSpread', 'coMeander', 'coRc', 'coCV', 'coLReach', 'coRiser', 'coRs',
    'sBreak', 'elev', 'lfRiver', 'lfBraid', 'lfFront', 'lfBack', 'lfWander', 'lfWidth', 'lfHeight', 'lfSize', 'lfFoot', 'lfMid', 'lfTaper', 'lfRoute', 'gully', 'gullySize', 'talusReach', 'talusTan',
    'coSurf', 'coJag'].map(k => [k, 'f']), ...['coBeach'].map(k => [k, 'u']),
  // lfcrater: a landform's Ground height reference (its elevation an offset from the ground under each cell) and a signed section (a knot below 0).
  ...['lfGround', 'lfSigned'].map(k => [k, 'u']),
  // lfcrater: the ejecta (height at the rim, the rim's distance from the path on each side) and the impact's spread (downrange, asymmetry, forbidden zones, wings).
  ...['ejAmt', 'ejPeakF', 'ejPeakB', 'imX', 'imY', 'ejAsym', 'ejFz', 'ejWing', 'ejDz'].map(k => [k, 'f']),
  // lfcrater: where a signed section peaks (its share of the half width from the foot), for spurs rooted on that peak; 0 elsewhere.
  ...['lfPeak'].map(k => [k, 'f']),
  // Gaps: breaks in what a landform raises (count, width as a share of their spacing, depth in height units); 0 breaks: none.
  ...['lfGaps', 'lfGapWidth', 'lfGapDepth'].map(k => [k, 'f']),
  // Ground edge: the outer share of the section where the stroke's ground material breaks into lobes (0: a clean edge).
  ...['lfGroundEdge'].map(k => [k, 'f']),
  // Lobe variety: clustered shore fingers, a few long and wide (0: the even comb).
  ...['cfVary', 'cfInlet'].map(k => [k, 'f']),
  // Channel depth: a river channel's depth over a quarter of its width (1: as before).
  ...['lfRiverDepth'].map(k => [k, 'f']),
  // Talus lumps: hummocky aprons (0: a smooth cone).
  ...['talusLumps'].map(k => [k, 'f']),
  // lfcrater: an impact's groove: the along curve's value at its end (the groove's width is scaled by the curve over it); 0: none.
  ...['grooveEnd'].map(k => [k, 'f']),
  // lfimpact2: the buckled ground's height (Buckling x .3 of the relief; BK_AMP in engine-shape.wgsl scales it), apart from the ejecta's; 0: none.
  ...['bkAmt'].map(k => [k, 'f']),
  // lfcrystal: a landform's faceted structure (Facet shape, the share of sites with an element, its polygon's sides, how square it turns to the path, corner cuts).
  ...['lfcForm'].map(k => [k, 'u']), ...['lfcShare', 'lfcSides', 'lfcAlign', 'lfcBreak', 'lfcStretch'].map(k => [k, 'f']),
  // The seed table of a landform's columns and prisms (lfcSeedTable): where its rows start in MW, its seeds, its path-and-level blocks and width levels, the
  // cells whose seeds the site pass fills in, and the prisms' lattice spacing and how far their seeds stray along and across the path.
  ...['lfcTab', 'lfcSites', 'lfcBlocks', 'lfcLevels'].map(k => [k, 'u']), ...['lfcWx0', 'lfcWy0', 'lfcWx1', 'lfcWy1'].map(k => [k, 'i']), ...['lfcSpace', 'lfcJs', 'lfcJc'].map(k => [k, 'f']),
  // Undulation in the art: init keeps plane u (artKeep, the second evaluation) and artLevel's share of the undulation the art shows (gArt).
  ...['artKeep'].map(k => [k, 'u']), ...['gArt'].map(k => [k, 'f']),
  // Coast ramp: the share of a water-making section's dry fall the coast keeps (1: as drawn).
  ...['lfCoast'].map(k => [k, 'f']),
  // Face steepness: the gain on a raised section's rise share (1: as drawn).
  ...['lfFace'].map(k => [k, 'f']),
  // Variation along the wall (0..1: the outline's long waves, the Gullies' plain and deep stretches) and Hard beds (their count, and how far the soft
  // beds between them lie back, 0..1).
  ...['lfVary', 'bedN', 'bedSoft'].map(k => [k, 'f']),
  // A height image (the `heights` pass): its size in samples, the window of them this pass holds in MW from mwBase (its first sample and its width), and where
  // sample (0, 0) lies and how far apart samples are, in world px. u.combine is its mode.
  ...['hmW', 'hmH', 'hmCw'].map(k => [k, 'u']), ...['hmCx', 'hmCy'].map(k => [k, 'i']), ...['hmX', 'hmY', 'hmCell'].map(k => [k, 'f'])];
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
// fissurePieces() of sculpt.js: the main cut cut into short pieces, and branches (each forking once) grown from roots along it. f: fissureSetup's values.
const rand01 = (seed, a, b) => hash(a, b, seed) * .5 + .5;
const mkPiece = (a, b, r0, r1, h0, h1) => ({a, b, r0, r1, h0, h1, reach: Math.max(r0, r1)});
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
// H9: line features (card C4): lineMultipliers and spurPieces of sculpt.js, the seeded arithmetic that lays out a landform's spurs as short pieces.
// Spur variation (crestVary) swells and narrows each piece, and lowers it, along the spur in waves of about two widths (one noise for width, one for height).
function lineMultipliers(s, a, len, salt, taper, ends) {
  const R = s.radius, f = len > 0 ? clamp(a / len, 0, 1) : 0, u = ends ? 1 - smooth(0, .4, Math.min(f, 1 - f)) : smooth(0, 1, f), n = valueNoise(a / (R * 2.2), .37, s.seed ^ salt), m = valueNoise(a / (R * 1.6), 2.9, s.seed ^ (salt + 0x55));
  return [clamp(1 + .45 * s.crestVary * n, .6, 1.4) * (1 - .62 * taper * u) * (ends ? 1 : 1 + .5 * (1 - smooth(0, .4, f))), (1 - .45 * s.crestVary * (.5 - .5 * m)) * (1 - .7 * taper * u)];
}
function spurPieces(s, roots) {
  const kf = s.inv ? 1 / Math.hypot(s.inv[0], s.inv[1]) : 1, spread = s.spurSpread, bulb = s.spurBulb, out = [];
  const grow = (x, y, heading, len, rootR, rootH, k, level) => {
    const step = len / 3, curl = (.1 + .3 * spread) * Math.PI, salt = 0x300 + k * 97;
    let h = heading;
    for (let j = 0; j < 3; j++) {
      h += (rand01(s.seed, k, 20 + j) - .5) * curl;
      const nx = x + Math.cos(h) * step, ny = y + Math.sin(h) * step, m0 = lineMultipliers(s, step * j, len, salt, s.spurTaper, false), m1 = lineMultipliers(s, step * (j + 1), len, salt, s.spurTaper, false);
      let r0 = m0[0], r1 = m1[0], e0 = m0[1], e1 = m1[1];
      if (bulb > 0) { const b0 = bulb * smooth(.5, 1, j / 3), b1 = bulb * smooth(.5, 1, (j + 1) / 3); r0 += b0 * .7; r1 += b1 * .7; e0 += (1 - e0) * b0; e1 += (1 - e1) * b1; }
      out.push(mkPiece({x, y}, {x: nx, y: ny}, rootR * r0, rootR * r1, rootH * e0, rootH * e1));
      if (j === 1 && level === 0 && s.spurForks > 0 && rand01(s.seed, k, 50) < s.spurForks)
        grow(nx, ny, h + (rand01(s.seed, k, 51) < .5 ? -1 : 1) * (.5 + .6 * rand01(s.seed, k, 52)), len * .5, rootR * r1 * .85, rootH * e1 * .85, k + 100, 1);
      x = nx; y = ny;
    }
  };
  for (const root of roots) {
    const k = root.k, first = out.length;
    grow(root.x, root.y, root.heading, s.spurLength * kf * (.55 + .9 * rand01(s.seed, k, 14)), s.spurWidth * (.85 + .3 * rand01(s.seed, k, 15)), s.spurHeight, k, 0);
    for (let j = first; j < out.length; j++) out[j].share = root.share;   // a landform reads its crest at the root's place along its path
  }
  return out;
}
// Where a ridge's spurs leave it: along the path, alternating sides with a seeded wobble (share: how far along the path, 0 to 1, for a landform's along curve).
// Spurs all round a point (L 0: a crater's click, an impact's landing) read the along curve at its end, as the click's section and the landing do.
function ridgeRoots(s, path, cum, L) {
  const N = Math.round(clamp(s.spurCount, 0, 12)), roots = [];
  if (N < 1) return roots;
  const spread = s.spurSpread, phase = rand01(s.seed, 7, 0x4b1) * Math.PI * 2;
  for (let k = 0; k < N; k++) {
    if (L <= 0) { roots.push({x: path[0].x, y: path[0].y, heading: phase + Math.atan2(s.rot[1], s.rot[0]) + Math.PI * 2 * (k + (rand01(s.seed, k, 11) - .5) * .5) / N, k, share: 1}); continue; }
    const at = L * (.08 + .84 * (k + .2 + .6 * rand01(s.seed, k, 11)) / N), side = ((k + (rand01(s.seed, k, 12) < .25 ? 1 : 0)) & 1) ? 1 : -1;
    let i = 1; while (i < cum.length - 1 && cum[i] < at) i++;
    const a = path[i - 1], b = path[i], f = (at - cum[i - 1]) / Math.max(cum[i] - cum[i - 1], 1e-6);
    roots.push({x: a.x + (b.x - a.x) * f, y: a.y + (b.y - a.y) * f, heading: Math.atan2(b.y - a.y, b.x - a.x) + side * (.7 + .95 * spread) * (.75 + .5 * rand01(s.seed, k, 13)), k, share: at / L});
  }
  return roots;
}
// lfcrater: the ejecta's uniforms. Their height is Ejecta x .3 of the shape's relief at the rim (the old crater's was .16 of its depth), thinning as the cube of the
// distance (McGetchin et al. 1973), from the section's peak (landformPeak; a section that peaks on its path throws from its foot); the spread is the impact's.
// Buckling's height is on the same scale (lfimpact2: Buckling 70 draws what Ejecta 70 buckled before the two were split), on a landform that digs.
function impactUniforms(q, sd, imp, c) {
  const pk = landformPeak(q), relief = Math.abs(Math.round(q.heightReference || 0) === 2 ? q.elevation : landformElevation(q, c.sea) - (c.baseHeight ?? 0)), sp = impactSpread(imp.angle);
  return {ejAmt: .3 * clamp(q.ejecta || 0, 0, 3) * relief, bkAmt: bucklingOn(q) ? .3 * clamp(q.buckling || 0, 0, 3) * relief : 0, ejPeakF: pk > 0 ? (1 - pk) * sd.front : sd.front, ejPeakB: pk > 0 ? (1 - pk) * sd.back : sd.back,
    imX: imp.dx, imY: imp.dy, ejAsym: sp.asym, ejFz: sp.fz, ejWing: sp.wing, ejDz: sp.dz};
}
// lfcrater: the secondaries: small copies of the stroke (its section, Height reference and options, its relief scaled with its width,
// no ejecta or secondaries of their own; a tenth to a quarter of its width), thrown from Secondaries' distance to twice as far (rim radii from the path; lfimpact2:
// 1.6 to 3.2 by default, as before the row; 1 to 2 on the Crater preset) at azimuths drawn from the impact's spread, so an
// oblique impact's land downrange and a grazing one's to the sides. About a third start a chain of one or two smaller ones farther out along the same ray.
// They are thrown from the impact point, the path's end.
function secondaryNodes(n, q, imp, seed, geom, c) {
  const count = Math.round(clamp(q.secondaries, 0, 12)), sd = landformSides(q), pk = landformPeak(q), rp = pk > 0 ? (1 - pk) * Math.max(sd.front, sd.back) : Math.max(sd.front, sd.back);
  const sp = impactSpread(imp.angle), world = geom.spacing * (geom.grid - 1) + 1, rnd = (k, a) => rand01(seed ^ 0x51ec, k, a), out = [], near = secondaryNear(q);
  const at = impactPoint(shapePaths(n)[0].map(i => n.points[i])), down = Math.atan2(imp.dy, imp.dx), aimed = imp.dx !== 0 || imp.dy !== 0;
  const ref = Math.round(q.heightReference || 0), lift = (k) => ref === 2 ? q.elevation * k : (landformElevation(q, c.sea) - c.baseHeight) * k + c.baseHeight - (ref === 1 ? c.sea : 0);
  for (let k = 0; k < count; k++) {
    // the azimuth: up to 16 draws, the first the spread accepts
    let phi = 0;
    for (let j = 0; j < 16; j++) { phi = (rnd(k, 10 + j) * 2 - 1) * Math.PI; if (rnd(k, 40 + j) * 1.9 < impactWeight(sp, phi) || j === 15) break; }
    const ang = aimed ? down + phi : phi;
    const dist = rp * (near + near * Math.pow(rnd(k, 5), .7)), size = (.1 + .16 * rnd(k, 6)), chain = rnd(k, 7) < .35 ? 1 + (rnd(k, 8) < .5 ? 1 : 0) : 0;
    for (let m = 0; m <= chain; m++) {
      const f = 1 + .28 * m, k2 = size * Math.pow(.7, m), spot = {x: clamp(at.x + Math.cos(ang + (rnd(k, 20 + m) - .5) * .12) * dist * f, 0, world - 1), y: clamp(at.y + Math.sin(ang + (rnd(k, 20 + m) - .5) * .12) * dist * f, 0, world - 1)};
      out.push(prepareNode({kind: 'landform', satellite: true, points: [spot], frame: n.frame, seed: (seed + (k * 3 + m + 1) * 2654435761) >>> 0,
        params: {...n.params, radius: q.radius * k2, elevation: lift(Math.min(1, k2 * 1.6)), ejecta: 0, buckling: 0, secondaries: 0, spurCount: 0, gullies: 0, talus: 0, along: undefined, wander: (q.wander || 0) * k2, varySize: Math.max(20, (q.varySize || 140) * k2)}}, geom, c));
    }
  }
  return out;
}
// Copies (scatterCount): Copies smaller copies of the stroke, each at a point drawn along its path (a click: the point itself) and moved within
// Copies' spread of it, its width, relief, wander and spurs scaled by its size (Copy size, varied by Copy size variation). They are nodes of their
// own, as the secondaries are (claiming with the stroke), with seeds of their own drawn from the stroke's.
function scatterNodes(n, q, seed, geom, c) {
  const count = Math.round(clamp(q.scatterCount, 0, 24)), spread = clamp(q.scatterSpread ?? 200, 0, 1200), world = geom.spacing * (geom.grid - 1) + 1;
  const rnd = (k, a) => rand01(seed ^ 0x5ca7, k, a), out = [], ref = Math.round(q.heightReference || 0);
  // A copy's relief scales with its size about the plain (Fixed) or its ground (Ground); a sea-referenced shape (an islet, a shoal) keeps its height
  // over the sea, so a small copy is not raised above its parent.
  const lift = k => ref === 2 ? q.elevation * k : ref === 1 ? q.elevation : (landformElevation(q, c.sea) - c.baseHeight) * k + c.baseHeight;
  const path = shapePaths(n)[0].map(i => n.points[i]), cum = [0];
  for (let i = 1; i < path.length; i++) cum.push(cum[i - 1] + Math.hypot(path[i].x - path[i - 1].x, path[i].y - path[i - 1].y));
  const L = cum.at(-1);
  for (let k = 0; k < count; k++) {
    let at = path[0];
    if (L > 0) { const s = rnd(k, 1) * L; let i = 1; while (i < cum.length - 1 && cum[i] < s) i++; const f = (s - cum[i - 1]) / Math.max(cum[i] - cum[i - 1], 1e-6); at = {x: path[i - 1].x + (path[i].x - path[i - 1].x) * f, y: path[i - 1].y + (path[i].y - path[i - 1].y) * f}; }
    const ang = rnd(k, 2) * Math.PI * 2, dist = spread * Math.sqrt(rnd(k, 3)), size = scatterSize(q, rnd(k, 4));
    const spot = {x: clamp(at.x + Math.cos(ang) * dist, 0, world - 1), y: clamp(at.y + Math.sin(ang) * dist, 0, world - 1)};
    out.push(prepareNode({kind: 'landform', satellite: true, points: [spot], frame: n.frame, seed: (seed + (k + 101) * 2654435761) >>> 0,
      params: {...n.params, radius: q.radius * size, elevation: lift(Math.min(1.5, size)), scatterCount: 0, secondaries: 0, ejecta: (q.ejecta || 0), along: undefined,
        wander: (q.wander || 0) * size, varySize: Math.max(20, (q.varySize || 140) * size), spurLength: (q.spurLength || 0) * size, talus: (q.talus || 0) * size, gullySize: (q.gullySize || 40) * Math.max(.3, size)}}, geom, c));
  }
  return out;
}
// A height image's pass: the cells its rectangle covers (the shader tests each cell's own position against the same rectangle) and its samples' heights.
function prepareHeights(n, {grid, spacing}) {
  const {fields: f, values} = heightsImage(n), b = heightsBounds(f);
  const region = intersect({x0: Math.floor(b.x0 / spacing), y0: Math.floor(b.y0 / spacing), x1: Math.ceil(b.x1 / spacing), y1: Math.ceil(b.y1 / spacing)}, {x0: 0, y0: 0, x1: grid - 1, y1: grid - 1});
  return {op: 'heights', region, values, fields: f, u: {combine: HEIGHTS_MODES.indexOf(f.mode), hmW: f.width, hmH: f.height, hmX: f.x, hmY: f.y, hmCell: f.cell}};
}
// ---- node preparation ----
// What the passes draw: every kind in KIND with at least one point (and the ground node). prepareNode returns {skip:true} for any other node,
// which draws nothing, and for a node that writes nothing, else {op:'ground'|'stamp', ...}. `c` is the host's context (see shapeContext in sculpt.js).

// The smooth brush's box blur radius in cells: sculpt.js's clamp(round(radius / (7 spacing)), 1, 24) at the final grid, scaled to this level's spacing.
export const smoothRadius = (radius, {spacing, refSpacing = spacing}) => Math.max(1, Math.round(clamp(Math.round(radius / (refSpacing * 7)), 1, 24) * refSpacing / spacing));
// prepareNode's result, kept while the node, the lattice and the context read the same. A gesture edits one node of many and every input
// plans the preview's lattices again, so the others' preparations are reused. Nodes are edited in place: a node is known by its text, and the
// context by its settings and the world's shape defaults (the params of a node with none). A height image is prepared each time: its samples
// are its own arrays and the preparation only points at them.
export const nodeContextKey = c => JSON.stringify(c) + '|' + JSON.stringify(c.params({params: {}}));
export function createNodePreparer(limit = 4) {
  const kept = new Map();   // lattice and context -> WeakMap(node -> {text, prepared})
  return (n, geom, c, contextKey = nodeContextKey(c)) => {
    if (n.kind === 'heights') return prepareNode(n, geom, c);
    const key = [geom.grid, geom.spacing, geom.refSpacing ?? '', contextKey].join('|');
    let nodes = kept.get(key);
    if (!nodes) { if (kept.size >= limit) kept.delete(kept.keys().next().value); kept.set(key, nodes = new WeakMap()); }
    const text = JSON.stringify(n), hit = nodes.get(n);
    if (hit?.text === text) return hit.prepared;
    const prepared = prepareNode(n, geom, c);
    nodes.set(n, {text, prepared});
    return prepared;
  };
}
export function prepareNode(n, geom, c) {
  if (n.kind === 'heights' && !n.hidden) return prepareHeights(n, geom);
  if (n.hidden || (n.kind !== 'ground' && (!(n.kind in KIND) || !n.points?.length))) return {skip: true};
  const {grid, spacing} = geom;
  if (n.kind === 'ground') return {op: 'ground', seed: (n.seed ?? 1) >>> 0, amp: n.amplitude ?? 8, wave: n.wavelength ?? 160, cover: n.coverage ?? .5, art: clamp(n.art ?? 1, 0, 1)};
  const kind = n.kind, q = kind === 'landform' ? landformSteps(c.params(n)) : c.params(n), kcode = KIND[kind];
  const frame = isIdentity(n.frame) ? null : n.frame, inv = frame ? invert(frame) : null, turn = frame ? Math.atan2(frame[1], frame[0]) : 0;
  const seed = ((n.seed ?? c.seed) >>> 0), allPoints = n.points, paths = shapePaths(n), radius = q.radius;
  const shoreShape = kind === 'landform', naturalPlateau = ['erase', 'paint', 'sand', 'grass'].includes(kind);
  const lean = leanSetup(kind, q);
  // fissureSetup(): the cut's half width in px (scaled by the frame), the zigzag amplitude, and how far a cell feels a piece.
  const fis = kind === 'fissure' ? (() => {
    const kf = inv ? 1 / Math.hypot(inv[0], inv[1]) : 1, hw0 = Math.max(q.fissureWidth, 1) * .5, hw = hw0 * kf, net = q.fissureNetwork >= .5, jag = q.fissureJag, famp = hw * (.5 + 2.2 * jag) + 1;
    return {kf, hw0, hw, net, jag, amp: famp, reach: net ? radius * 1.05 + hw + 8 : hw * 3.5 + famp + 6};
  })() : null;
  const vary = variability(kind, {naturalPlateau}, q);
  const amp = q.rough * radius * vary.amp;
  const frameScale = inv ? 1 / Math.hypot(inv[0], inv[1]) : 1;
  const extent = kind === 'landform' ? landformReach(q, frameScale, 1, true) : fis ? fis.reach : radius * (vary.wK ? Math.min(vary.wHi, 1 + q.rough * vary.wK) : 1) * (!lean.family && lean.ratio > 1 ? lean.ratio : 1) + 2 * amp;
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
  const fx = naturalPlateau ? F_COAST_X : F_X, fy = naturalPlateau ? F_COAST_Y : F_Y;
  const segs = [], extra = [];
  let impact = null, grooved = false;
  const dab = (p, e, f0, f1) => segs.push({px: p.x, py: p.y, ex: (e || p).x, ey: (e || p).y, f0, f1, nx: sampleNoise(fx, p.x, p.y), ny: sampleNoise(fy, p.x, p.y)});
  // Prepare paths independently, then submit their capsules as one shape.
  // Heights, masks, smoothing and coastal effects are applied once to the union.
  for (const [pathNo, indices] of paths.entries()) {
  const pts=indices.map(i=>allPoints[i]);
  if (kind === 'fissure') {
    for (const pc of fissurePieces(fis, simplifyPath(pts, Math.max(1.5, fis.hw)), q, seed, radius)) segs.push({px: pc.a.x, py: pc.a.y, ex: (pc.b || pc.a).x, ey: (pc.b || pc.a).y, f0: [pc.r0, pc.r1], f1: [pc.h0, pc.h1], nx: 0, ny: 0});
  } else if (kind === 'landform') {
    // H27 landform: the path is the crest, swept as segments that carry the length before them, their own and the whole path's (the rows the along
    // curve reads), the side the back is on, and which ends close the section round them. A click is a tiny segment closed at both ends.
    let path = simplifyPath(pts, Math.max(1, radius * .04)).filter((p, k, a) => !k || Math.hypot(p.x - a[k - 1].x, p.y - a[k - 1].y) >= 1e-4);
    // lfcrater: a stroke with impact features reads its first path as the projectile's: the shape lands whole at the path's end (the node's first segment, a
    // whole-section piece there, which the ejecta centre on), and the path before it is the approach, the trunk swept as a groove (u.grooveEnd).
    let landing = null;
    if (impactOn(q) && pathNo === 0) { impact = impactSetup({...q, radius}, path); if (path.length > 1 && impact.L > 0) landing = impactPoint(path); }
    if (landing) { grooved = true; segs.push({px: landing.x, py: landing.y, ex: landing.x + .01, ey: landing.y, f0: [1, 0], f1: [-2, landformBackSide(lean, turn, .01, 0)], nx: 1, ny: 1, w2: 1, w3: 1}); }
    if (path.length < 2) path = [path[0], {x: path[0].x + .01, y: path[0].y}];
    const cum = [0];
    for (let k = 1; k < path.length; k++) cum.push(cum[k - 1] + Math.hypot(path[k].x - path[k - 1].x, path[k].y - path[k - 1].y));
    const total = cum[cum.length - 1], first = path[1], dx = first.x - path[0].x, dy = first.y - path[0].y, len = Math.hypot(dx, dy) || 1;
    // The back is the lean side: left or right of the way drawn, or whichever side a map bearing (turned with the frame) falls on, decided once by the first segment.
    const side = landformBackSide(lean, turn, dx, dy);
    // P28: a river's trunk segments carry the path's curvature times the channel width at their two ends (s2.y, s2.z) and how silted the path is (s2.w: 1 the river,
    // less for an oxbow, by its age), which the section's channel reads (engine-shape.wgsl riverChannel).
    const river = isRiver(q), kw = river ? riverCurvature(path, riverWidth(q)) : null, silt = pathNo === 0 ? 1 : 1 - .9 * (q.river?.ages?.[pathNo - 1] ?? .5);
    for (let k = 1; k < path.length; k++) segs.push({px: path[k - 1].x, py: path[k - 1].y, ex: path[k].x, ey: path[k].y, f0: [cum[k - 1], cum[k] - cum[k - 1]], f1: [total, side], nx: (k === 1 ? 1 : 0) | (k === path.length - 1 ? 2 : 0), ny: river ? kw[k - 1] : 0, ...(river ? {w2: kw[k], w3: silt} : {}), path: pathNo});
    // Spurs (the ridge's own, spurPieces): each piece draws the landform's section scaled by its width and height multipliers, closed at both ends, and takes the crest at
    // its root's place along the path. Its back side follows its own direction the way the trunk's does.
    if (Math.round(q.spurCount) >= 1) {
      const rs = {...q, radius, seed, rot: [Math.cos(turn), Math.sin(turn)], inv};
      // lfcrater: a signed section that peaks before its path (a crater's rim) roots its spurs on that peak, and each spur carries the section's outer flank
      // (foot to peak) across its own width (lfCraterSpurShare).
      const pk = landformSigned(q) ? landformPeak(q) : 0, sd0 = landformSides({...q, radius}), roots = landing ? ridgeRoots(rs, [landing, {x: landing.x + .01, y: landing.y}], [0, .01], 0) : ridgeRoots(rs, path, cum, pk > 0 && total < 1 ? 0 : total);   // a click's spurs leave all round it, an impact's round where it lands
      if (pk > 0) for (const r of roots) { r.x += Math.cos(r.heading) * (1 - pk) * sd0.front; r.y += Math.sin(r.heading) * (1 - pk) * sd0.front; }
      for (const pc of spurPieces(rs, roots)) {
        const e = pc.b || pc.a, at = segs.length, ex = landformReach(q, frameScale, Math.max(pc.r0, pc.r1), true) + (q.spurBulb > 0 ? q.spurBulb * radius : 0);
        segs.push({px: pc.a.x, py: pc.a.y, ex: e.x, ey: e.y, f0: [0, 0], f1: [-1 - (pc.share ?? 0), landformBackSide(lean, turn, e.x - pc.a.x, e.y - pc.a.y)], nx: pc.r0, ny: pc.r1, w2: pc.h0, w3: pc.h1});
        segs[at].box = [clamp(Math.floor((Math.min(pc.a.x, e.x) - ex) / spacing), 0, grid - 1), clamp(Math.floor((Math.min(pc.a.y, e.y) - ex) / spacing), 0, grid - 1), clamp(Math.ceil((Math.max(pc.a.x, e.x) + ex) / spacing), 0, grid - 1), clamp(Math.ceil((Math.max(pc.a.y, e.y) + ex) / spacing), 0, grid - 1)];
      }
    }
  } else {
    const path = simplifyPath(pts, Math.max(1, radius * .04)), longest = Math.max(16, radius * 1.5);
    dab(path[0]);
    for (let k = 1; k < path.length; k++) {
      const a = path[k - 1], b = path[k], pieces = Math.ceil(Math.hypot(b.x - a.x, b.y - a.y) / longest);
      for (let j = 0; j < pieces; j++) dab({x: a.x + (b.x - a.x) * j / pieces, y: a.y + (b.y - a.y) * j / pieces}, {x: a.x + (b.x - a.x) * (j + 1) / pieces, y: a.y + (b.y - a.y) * (j + 1) / pieces});
    }
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
  const writes = kind === 'fissure' ? (q.fissureDark > 0 ? [[2, 127]] : []) : kind === 'paint' ? ((q.paintChannel === 26 || (q.paintChannel === undefined && q.groundPreset !== undefined)) ? groundClaim(q) : MASK_WRITES[Math.round(q.paintChannel)] || []) : kind === 'erase' ? ERASE_WRITES : shapeMaskWrites(kind, q, n.satellite);
  const main = {op: 'stamp', kind: kcode, segs, region, extra, entry: kcode === 14 ? 'stampFissure' : kcode === 16 ? 'stampLandform' : kcode >= 6 ? 'stampN' : 'stamp', smoothR: kind === 'smooth' ? smoothRadius(radius, geom) : 0, writes: writes.map(([p, t, g = 1, f = 0]) => [p, t, g, f]),
    u: {seed, framed: inv ? 1 : 0,
      radius, amount: q.amount, amountPct: clamp(q.amount / 100, 0, 1), rough: q.rough, softness: q.softness, leanK: lean.k, bearX: lean.bx, bearY: lean.by, leanSide: lean.side, wK: vary.wK, wLo: vary.wLo, wHi: vary.wHi, amp, faceVar: q.faceVariation ?? .8,
      crackAmt: kind === 'landform' && q.cracks > 0 ? q.cracks : 0,
      rotX: Math.cos(turn), rotY: Math.sin(turn),
      ...(inv ? Object.fromEntries(inv.map((v, i) => ['inv' + i, v])) : {}),
      fHw: fis?.hw0 ?? 0, fKf: fis?.kf ?? 0, fJag: fis?.jag ?? 0, fAmp: fis?.amp ?? 0, fCell: q.fissureCell, fCrack: q.fissureCrack, fNet: fis?.net ? 1 : 0, fDark: q.fissureDark}};
  // Facets re-tile the landform's result; a landform with shore features keeps its coast pass instead (shapeControlAvailable hides the row there). A landform
  // that digs into the ground it lands on (landformDigs: Height reference Ground, below 0) takes angular facets fitted to its own surface up and down (mode 1);
  // a raised one takes its Facet shape (mode 2).
  const facetMode = n.satellite || kind !== 'landform' || !(q.iceFacets > 0) || landformShore(q) ? 0 : landformDigs(q) ? 1 : 2;
  // lfcrystal: Facet shape (1 stepped columns, 2 prisms) breaks the landform's envelope into elements on the same pass; prisms stand past the footprint by up to their own width.
  const lfc = facetMode === 2 ? clamp(Math.round(q.facetForm || 0), 0, 2) : 0, seeds = lfc && region ? lfcSeedTable(segs, lfc, lfcWidth(q) * frameScale, q, extent, spacing) : null, lfcL = seeds ? seeds.L : 0;
  if (lfc === 2 && region) main.region = region = expand(region, Math.ceil(.9 * lfcL / spacing) + 2, grid);
  if ((shoreShape || facetMode) && region) { const co = coastSetup(q, geom, region, radius, inv, seed, shoreShape, c, facetMode, lfcL); if (co) { main.coast = co; Object.assign(main.u, co.u); main.extra.push(...co.extra); } }
  // The seed table (lfCrystalSites): its rows in MW, its seeds after the coast planes in the scratch.
  if (seeds && main.coast) {
    Object.assign(main.coast, {siteFloats: seeds.sites * 12, lfcRows: Math.max(1, Math.ceil(seeds.sites / 256)), lfcMargin: seeds.margin});
    Object.assign(main.u, {lfcTab: main.extra.length, lfcSites: seeds.sites, lfcBlocks: seeds.blocks, lfcLevels: seeds.levels, lfcSpace: seeds.space, lfcJs: seeds.js, lfcJc: seeds.jc});
    main.extra.push(...seeds.rows);
  }
  if (lfc) Object.assign(main.u, {cTop: clamp(q.crystalTop ?? 0, 0, .95), lfcForm: lfc, lfcShare: clamp(q.iceFacets, 0, 1), lfcSides: clamp(Math.round(q.crystalSides ?? 6), 3, 12), lfcStretch: clamp(q.crystalStretch ?? 1, 1, 3), lfcAlign: clamp(q.crystalAlign ?? 0, 0, 1), lfcBreak: clamp(Math.round(q.bergBreak ?? 0), 0, 8),
    cgSize: lfcL, cgFacet: clamp(q.crystalFacet ?? 0, 0, 1), cgSizeVar: clamp(q.crystalSizeVar ?? 0, 0, 1), cgSmooth: 1 - clamp(q.iceFacets, 0, 1), cgTiers: clamp(q.crystalTiers ?? 0, 0, 1), cgStep: Math.max(0, q.crystalStep ?? 0),
    cgVar: clamp(q.crystalVariation ?? 0, 0, 1), bgRough: Math.max(0, q.bergRough ?? 0), bgJit: clamp(q.bergJitter ?? 0, 0, 1)});
  // H15 part 2: the stroke's curve tables, after every other extra row (rim sectors, coast sites); the shader reads them at curveBase and backBase.
  const cv = strokeCurve(kind, q);
  const put = t => { const at = main.extra.length; for (let j = 0; j < t.length; j += 4) main.extra.push([t[j], t[j + 1] ?? 0, t[j + 2] ?? 0, t[j + 3] ?? 0]); return at; };
  if (cv) {
    Object.assign(main.u, cv.u); main.u.curveBase = put(cv.front); if (cv.back) main.u.backBase = put(cv.back);
  }
  if (kind === 'landform') {
    // H27: the elevation and how it combines, the two half widths, the along curve's table, and the variation (px in the shape's own frame: wander scales with it).
    const sd = landformSides({...q, radius});
    Object.assign(main.u, {elev: landformElevation(q, c.sea), combine: clamp(Math.round(q.combine || 0), 0, 2), lfFront: sd.front, lfBack: sd.back, alongBase: put(sampleKnots(alongKnots(q))),
      lfRiver: isRiver(q) ? riverWidth(q) : 0, lfRiverDepth: clamp(q.riverDepth ?? 1, .25, 4), lfBraid: isBraided(q) ? 1 : 0, lfWander: isRiver(q) ? 0 : Math.max(0, q.wander || 0) * frameScale,   // a river's Wander is the band its migration may fill (sculpt-river.js), not an outline noise
      lfWidth: Math.max(0, q.widthVary || 0), lfHeight: Math.max(0, q.heightVary || 0), lfSize: Math.max(8, q.varySize || 0),
      lfFoot: q.varyFoot ?? 1, lfMid: q.varyMiddle ?? 1, lfTaper: clamp(q.crestTaper || 0, 0, 1), lfRoute: clamp(q.routeSmooth || 0, 0, 1),
      lfGaps: Math.round(clamp(q.rimGaps || 0, 0, 12)), lfGapWidth: clamp(q.rimGapWidth ?? .3, .05, 1), lfGapDepth: clamp(q.rimGapDepth ?? 200, 1, 400), lfGroundEdge: clamp(q.groundEdge || 0, 0, 1),
      // P1 Gullies: 100% is the research lab's depth (.45 per wavelength per unit slope); the first wavelength is a share of the wider side (world px, as the
      // sides are), given in the shape's own frame, where the pattern runs.
      gully: .45 * clamp(q.gullies || 0, 0, 1.5), gullySize: clamp(clamp(q.gullySize ?? .4, .1, 1) * Math.max(sd.front, sd.back), 16, 480) / frameScale,
      // P17 Talus: cones below the Gullies' chutes, as long as the reach (world px) at the repose of the world's talusAngle; only where Gullies cut and the stroke raises.
      lfVary: isRiver(q) ? 0 : clamp(q.wallVary || 0, 0, 1), bedN: clamp(Math.round(q.beds || 0), 0, 8), bedSoft: clamp(q.bedSoft ?? .6, 0, 1),
      talusReach: talusOn(q) ? clamp(q.talus, 0, 400) : 0, talusLumps: clamp(q.talusLumps || 0, 0, 1), talusTan: c.repose ?? .84, lfPeak: Math.round(q.spurCount) >= 1 && landformSigned(q) ? landformPeak(q) : 0,
      lfGround: Math.round(q.heightReference || 0) === 2 ? 1 : 0, lfSigned: landformSigned(q) ? 1 : 0,
      // Coast ramp: a stroke whose crest stands under the sea (a fixed or sea-level height) makes a coast; others keep their sections as drawn.
      lfCoast: Math.round(q.heightReference || 0) !== 2 && landformElevation(q, c.sea) < c.sea ? clamp(c.coastRamp ?? 1, 0, 1) : 1,
      // Face steepness: a raised section (Raise to, above the plain or its ground; not a crater's signed section or a river's valley).
      lfFace: Math.round(q.combine || 0) === 0 && !landformSigned(q) && !isRiver(q) && (Math.round(q.heightReference || 0) === 2 ? q.elevation > 0 : landformElevation(q, c.sea) > c.baseHeight) ? clamp(c.faceSteep ?? 1, 1, 4) : 1,
      // lfcrater: an impact's groove (its first segment the landing): the along curve's value at the end, which the groove's width is scaled by; 0: no groove.
      grooveEnd: grooved ? impactEnd(q) : 0});
    if (impact) Object.assign(main.u, impactUniforms(q, sd, impact, c));
  }
  const satellites = kind === 'landform' && !n.satellite ? [...(impact && Math.round(q.secondaries || 0) >= 1 ? secondaryNodes(n, q, impact, seed, geom, c) : []), ...(Math.round(q.scatterCount || 0) >= 1 ? scatterNodes(n, q, seed, geom, c) : [])] : [];
  return satellites.length ? {multi: [main, ...satellites]} : main;
}

// ---- the coast pass (H10): fingers on the joined coast and shore layers, after the stroke is swept (stampCoastShore in sculpt.js) ----
// H24: how far the layer lines wander across the bank in two dimensions, in layer widths (retail's layers wander, loop and pinch), the same on every world.
export const LAYER_MEANDER = 1.2;
// P27: how far the beach profile reaches from the waterline (px): the berm and the back-slope, then the blend into the bank, at most about 120.
const BEACH_REACH = 140;
// How far the layers reach from the coast (px), the skip distance included (coastLayerReach). The mounds style (2) is not on the GPU path.
const coastLayerReach = q => {
  const n = Math.max(1, Math.round(q.shoreLayers)), W = Math.max(4, q.layerPx), style = Math.round(q.layerStyle);
  if (style === 1) { const cv = clamp(q.lavaCircleVary || 0, 0, 1); return n * W * (1 + .45 * cv) + 2.8 * Math.max(8, q.layerCircle) * (1 + .07 * cv) + 2 * W; }
  const spread = clamp(q.lavaSpread || 0, 0, 2), vary = clamp(q.layerVary, 0, 1), wide = Math.max(1 + .6 * vary, Math.exp(.5 * (vary + spread)));
  return (n + 1 + LAYER_MEANDER) * W * wide + 2 * W + clamp(q.layerJag || 0, 0, 12);
};
// The shared coast pass of a shape with shore features, or null when it has none: the coast box (the footprint grown by the reach and 12 cells), the cells the pass reads
// beyond that box (readR: the blur of the fingers' normals), its uniforms, the layers' riser weights (after the node's own mask writes in MW) and the
// size of the circular bites' lattice.
function coastSetup(q, geom, region, radius, inv, seed, shoreShape, c, facet = 0, lfcL = 0) {
  const fingers = shoreShape && q.fingers > 0, layers = shoreShape && Math.round(q.shoreLayers) >= 1;
  const beach = shoreShape && landformBeach(q);
  const plWater = Math.max(0, q.plateWaterPx || 0), plLand = Math.max(0, q.plateLandPx || 0), plates = q.shorePlates > 0 && Math.max(plWater, plLand) > 0;
  if (!fingers && !layers && !plates && !facet && !beach) return null;
  const {grid, spacing, refSpacing = spacing} = geom;
  if (facet) {
    // Facets: a pass over the node's own result. Angular facets' seeds (the 3 x 3 lattice neighbours) lie within 2 widths of a cell, and read 3 cells round
    // themselves; columns read the envelope at seeds up to about two widths away; prisms evaluate the section at their seeds and read only their own cell.
    const L = lfcL || clamp(q.iceFacetSize, 16, 640), mF = lfcL && Math.round(q.facetForm) === 2 ? 2 : Math.ceil((lfcL ? 2.2 : 2.1) * L / spacing) + 6, boxF = expand(region, mF, grid), am = clamp(q.iceFacets, 0, 1);
    return {box: boxF, readR: mF + 2, fingers: false, layers: false, plates: false, facet, lfc: lfcL > 0, scal: false, blurR: 1, maxCells: 0, sites: {i0: 0, j0: 0, ni: 0, nj: 0}, siteFloats: 0, sideR: 0, extra: [],
      u: {fcMode: facet, fcL: L, fcStrength: clamp(q.iceFacets, 0, 1), fcStep: Math.max(0, q.crystalStep ?? 0), fcSurface: Math.round(q.facetSurface || 0) >= 1 ? 1 : 0, fcShare: .2 + .5 * am, coPutW: 1, coBx0: boxF.x0, coBy0: boxF.y0, coBx1: boxF.x1, coBy1: boxF.y1}};
  }
  // Lobe variety grows a few fingers up to about three times the usual length: their reach grows with it, so a spit is not cut off flat.
  const fReach = .5 * radius * (1 + 1.95 * clamp(q.fingerVary || 0, 0, 1)), fLimit = fReach + spacing * 3, lReach = layers ? coastLayerReach(q) : 0, reach = Math.max(fingers ? fLimit : 0, lReach, beach ? BEACH_REACH : 0, plates ? Math.max(plWater, plLand) + 2 * spacing : 0);
  const m = Math.ceil(reach / spacing) + 12, box = expand(region, m, grid), blurR = Math.max(1, Math.round(10 * refSpacing / spacing));
  const n = Math.max(1, Math.round(q.shoreLayers)), W = Math.max(4, q.layerPx), vary = clamp(q.layerVary, 0, 1), scal = layers && Math.round(q.layerStyle) === 1;
  const Rc = Math.max(8, q.layerCircle), cv = clamp(q.lavaCircleVary || 0, 0, 1), C = Rc * 1.3;
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
    box, readR: m + (fingers ? blurR : 0) + 2, fingers, layers, plates, beach, scal, blurR, maxCells: Math.ceil(reach / spacing) + 4, sites, siteFloats: sites.ni * sites.nj * 4, sideR: Math.ceil(Math.max(fingers ? fLimit : 0, plates ? Math.max(plWater, plLand) + 2 * spacing : 0) / spacing) + 2, extra,
    u: {
      plMat: plates ? (q.plateMaterial >= 1.5 ? 2 : 1) : 0, plWater, plLand, plSize: q.plateSize, plGap: q.plateGap, plHeight: q.plateHeight, plSeam: q.crystalShoreSeam ?? .5, plVary: q.plateVary ?? 0, plNeedles: q.frostNeedles ?? 0,
      frGapSize: Math.max(3, c.frost?.gapSize ?? 3), frGapDepth: c.frost?.gapDepth ?? 0, frGaps: c.frost?.gaps ?? 0, frGapReach: c.frost?.gapReach ?? 0,
      coPutW: 1, coFar: 1e5 + 2 * spacing, coLimit: fLimit, coFReach: fReach, coFAmt: q.fingers * clamp(radius / 140, .35, 1),
      cfSize: q.fingerSize ?? 1, cfVary: clamp(q.fingerVary || 0, 0, 1), cfInlet: clamp(q.fingerInlet || 0, 0, 1),
      coN: n, coW: W, coLedge: clamp(q.layerLedge, .4, .95), coIrr: clamp(q.layerRough, 0, 1), coVary: vary, coSpread: clamp(q.lavaSpread || 0, 0, 2), coMeander: LAYER_MEANDER,
      coLReach: lReach, coRiser: q.layerRiser > 0 ? q.layerRiser : 0, coScal: scal ? 1 : 0, coRc: Rc, coCV: cv, coRs: 1.4 * Rc + cv * .1 * Rc + n * W * (1 + .45 * cv) + spacing,
      coBeach: beach ? 1 : 0, coSurf: beach ? clamp(q.surf, 0, 1) : 0, coJag: layers ? clamp(q.layerJag || 0, 0, 12) : 0,
      coSI0: sites.i0, coSJ0: sites.j0, coSNI: sites.ni, coSNJ: sites.nj, coBx0: box.x0, coBy0: box.y0, coBx1: box.x1, coBy1: box.y1,
    },
  };
}

// The width of a landform's columns and prisms (Facet width, px in the shape's own frame).
export const lfcWidth = q => clamp(q.iceFacetSize, 4, 1200);
// The most seeds one stroke's table holds (12 floats each): past it the columns or prisms are laid out wider, so a huge stroke of tiny columns stays in memory.
const LFC_SEEDS = 1 << 20, SZL = [1, .55, .3];
// Prisms: their lattice is this many Facet widths apart, and each seed strays up to .3 of it (.5 at Variation 100) along and across the path, so the nearest
// neighbour lies about .7 of a spacing away (.6 at Variation 100) and a prism, kept to half that, stands about Facet width wide.
const PRISM_SPACE = 1.45;
// The seed table of a landform's columns or prisms (engine-shape.wgsl lfCrystalSites): for every path and width level, the lattice of seeds over the path's
// own coordinates, from before its start to past its end by the shape's reach (s) and as far across (c, a box's corners included), with three seeds to spare
// round every edge. Rows: one per segment (its path, -1 for a spur piece), one per path and level (first seed, i0, ni, j0). L: the element width the table is
// laid out for; space: the prisms' lattice; js, jc: how far a prism's seed strays along and across the path, in spacings (all of it once the shape is a prism
// wider than one, none while it is about one prism wide: a lone prism stays on its click).
function lfcSeedTable(segs, lfc, L0, q, extent, spacing) {
  const paths = [];
  segs.forEach((sg, k) => { if (sg.path !== undefined && !paths[sg.path]) paths[sg.path] = {total: sg.f1[0]}; });
  const levels = lfc === 1 && clamp(q.crystalSizeVar ?? 0, 0, 1) > 0 ? 3 : 1, sd = landformSides(q), half = Math.max(sd.front, sd.back);
  const layout = L => {
    const cMax = 1.45 * (extent + L + 2 * spacing), rows = [], space = PRISM_SPACE * L;
    let base = 0;
    for (let p = 0; p < paths.length; p++) for (let lv = 0; lv < 3; lv++) {
      if (lv >= levels || !paths[p]) { rows.push([base, 0, 0, 0]); continue; }
      const along = lfc === 2 ? space : L * SZL[lv], across = lfc === 2 ? .8660254 * space : along, total = paths[p].total;
      const i0 = Math.floor(-cMax / along) - 3, ni = Math.ceil((total + cMax) / along) + 4 - i0, jh = Math.ceil(cMax / across) + 3;
      rows.push([base, i0, ni, -jh]); base += ni * (2 * jh + 1);
    }
    return {rows, sites: base, space};
  };
  let L = L0, t = layout(L);
  if (t.sites > LFC_SEEDS) { L = L0 * Math.sqrt(t.sites / LFC_SEEDS) * 1.02; t = layout(L); }
  const J = .6 + .4 * clamp(q.crystalVariation ?? 0, 0, 1), total = Math.max(0, ...paths.filter(Boolean).map(p => p.total));
  return {L, sites: t.sites, blocks: paths.length * 3, levels, space: t.space, rows: [...segs.map(sg => [sg.path ?? -1, 0, 0, 0]), ...t.rows],
    js: J * clamp((half + .5 * total - .6 * L) / (.4 * L), 0, 1), jc: J * clamp((half - .6 * L) / (.4 * L), 0, 1), margin: Math.ceil((lfc === 2 ? 5 : 2.6) * L / spacing) + 4};   // a column reads seeds 2.2 widths away; a prism's size reads its neighbours' too
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
// Shared by actual target allocation and display-source planning. A graph without
// coastal passes needs three blur planes; coast graphs also keep their sites.
export function shapeScratchBytes(cells,prepared){
  let sites=-1;for(const p of prepared)if(p.coast)sites=Math.max(sites,p.coast.siteFloats);
  return 4*(sites<0?3*cells:14*cells+sites);
}
export function shapeRequestBytes(prepared){
  // Includes two art-level evaluations, every possible coast field/jump pass,
  // segment/mask uploads and the full source of any authored height image.
  return 65536+prepared.reduce((n,p)=>n+(p.coast?256:24)*NODE_BYTES+(p.segs?.length??0)*64+((p.writes?.length??0)+(p.extra?.length??0))*16+(p.values?.byteLength??0),0);
}
// Shader layouts and pipelines depend only on device and storage variant.
// Each engine still owns all fields, uniforms, scratch and request queues.
const shapePipelineCache=new WeakMap();
async function sharedShapePipelines(device,pages){
  let variants=shapePipelineCache.get(device);if(!variants){variants=new Map();shapePipelineCache.set(device,variants);}
  if(!variants.has(pages)){
    const pending=(async()=>{
      const raw = await (await fetch('engine-shape.wgsl')).text();
      const S = GPUShaderStage.COMPUTE, rw = {type: 'storage'}, ro = {type: 'read-only-storage'};
      const layout = device.createBindGroupLayout({entries: [
        {binding: 0, visibility: S, buffer: {type: 'uniform', hasDynamicOffset: true}}, {binding: 1, visibility: S, buffer: rw}, {binding: 2, visibility: S, buffer: rw},
        {binding: 3, visibility: S, buffer: rw}, {binding: 4, visibility: S, buffer: rw}, {binding: 5, visibility: S, buffer: ro}, {binding: 6, visibility: S, buffer: ro}, {binding: 7, visibility: S, buffer: rw}]});
      const pl = device.createPipelineLayout({bindGroupLayouts: [layout]});
      // The pipelines of one variant of the shader: the whole-map text, or the pages text (direct noise, a target's own origin).
      const buildPipes = (paged, entries) => {
        const source = preprocessShader(raw, paged ? ['PAGES'] : []).replace('/*NODE_STRUCT*/', nodeStruct()).replace('/*CV_N*/', `const CV_N = ${CV_N}.0;`);
        const module = device.createShaderModule({label: paged ? 'shape (pages)' : 'shape', code: source}), out = {};
        for (const e of entries) out[e] = device.createComputePipeline({layout: pl, compute: {module, entryPoint: e}});
        return out;
      };
      const MAIN = ['noise', 'stamp', 'stampN', 'stampLandform', 'stampFissure', 'smoothCopy', 'blurH', 'blurV', 'ground', 'heights', 'init', 'artHold', 'artLevel', 'pack', 'coastInit', 'coastSeed', 'coastJump', 'coastFinish', 'coastSd', 'coastBlurH', 'coastBlurV', 'coastFinger', 'coastJoin', 'coastSites', 'coastJag', 'coastLayers', 'coastPlates', 'coastBeach', 'facetSnap', 'facetApply', 'packPlane', 'lfCrystalSites', 'lfCrystalRoom', 'lfCrystalApply'];
      const pipes = buildPipes(pages, [...MAIN, ...(pages ? ['coarse'] : [])]);
      return {layout,pipes};
    })();
    variants.set(pages,pending);pending.catch(()=>{if(variants.get(pages)===pending)variants.delete(pages);});
  }
  return variants.get(pages);
}

export async function createShapeEngine({device, grid, spacing, baseHeight, sea, minH, maxH, refSpacing = spacing, pages = false}) {
  const {layout,pipes}=await sharedShapePipelines(device,pages);
  const cells = pages ? 0 : grid * grid, buf = (size, usage, label) => device.createBuffer({size: Math.max(16, size), usage, label});
  const ST = GPUBufferUsage.STORAGE, CD = GPUBufferUsage.COPY_DST, CS = GPUBufferUsage.COPY_SRC;
  const F = buf(PLANES * cells * 4, ST | CD | CS, 'shape planes'), Mk = buf(7 * cells * 4, ST | CD | CS, 'shape masks');
  let Nz = null, Sc = null, dummy = null, queue = Promise.resolve(), peak = 0, last = {};
  // H10: scratch uses the shared feature-aware calculation below.
  const scratch = floats => { Nz ??= buf(7 * cells * 4, ST, 'shape noise'); if (!Sc || Sc.size < floats * 4) { const old = Sc; Sc = buf(floats * 4, ST, 'shape scratch'); old?.destroy(); } };
  // H5b: a page is a pw x ph block of the map with its own planes and masks (the shader's lidx); its noise is evaluated directly (u.direct), so only the
  // scratch weights of the hill's blur are shared: one buffer, grown to the largest target.
  let pageScratch = null;
  const bytes = () => F.size + Mk.size + (Nz?.size || 0) + (Sc?.size || 0) + (pageScratch?.size || 0);
  function makeTarget(ox, oy, pw, ph) {
    const F2 = buf(PLANES * pw * ph * 4, ST | CD | CS, 'page planes'), Mk2 = buf(pw * ph * 28, ST | CD | CS, 'page masks');
    return {F: F2, Mk: Mk2, ox, oy, pw, ph, bytes: F2.size + Mk2.size, destroy() { F2.destroy(); Mk2.destroy(); }};
  }

  // Evaluate `list` over `rect` (cells, inclusive; null = the whole map) and read the rectangle back. One at a time, in order.
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
    dummy ??= buf(16, ST, 'shape unused');
    const expandIn = (r, m) => intersect({x0: r.x0 - m, y0: r.y0 - m, x1: r.x1 + m, y1: r.y1 + m}, whole);
    const geom = {grid, spacing, refSpacing};
    const passes = [], segData = [], mwData = [], mwBlocks = [], ops = [];
    let segCount = 0, mwCount = 0;
    const base = {grid, spacing, baseH: baseHeight, sea, minH, maxH, blurR: Math.max(1, Math.round(2 * refSpacing / spacing)), ox: target ? target.ox : 0, oy: target ? target.oy : 0, pw: target ? target.pw : grid, ph: target ? target.ph : grid, direct: target ? 1 : 0};
    const add = (entry, region, extra = {}) => passes.push({entry, region, u: {...base, rx0: region.x0, ry0: region.y0, rx1: region.x1, ry1: region.y1, ...extra}});
    if (!readOnly) {
    // Phase 1: prepare every node (its segment and mask-write lists).
    const prepared = [];
    for (const n of list) { const p0 = (prepare || prepareNode)(n, geom, ctx); if (p0.multi) prepared.push(...p0.multi); else prepared.push(p0); }
    if (target) { const need = shapeScratchBytes(target.pw * target.ph, prepared); if (!pageScratch || pageScratch.size < need) { pageScratch?.destroy(); pageScratch = buf(need, ST, 'page scratch'); } }
    else scratch(shapeScratchBytes(cells, prepared)/4);
    for (const p of prepared) {
      if (p.skip) continue;
      if (p.op === 'ground') { ops.push({ground: true, art: p.amp !== 0 ? p.art : 1, u: {seed: p.seed, gAmp: p.amp, gWave: p.wave, gCover: p.cover}}); continue; }
      if (p.op === 'heights') { if (p.region) ops.push({heights: p}); continue; }
      if (!p.region) continue;
      const node = {...p.u, nseg: p.segs.length, kind: p.kind, segBase: segCount, mwBase: mwCount, nwrites: p.writes.length};
      for (const s of p.segs) {
        segData.push(s.px, s.py, s.ex, s.ey, s.f0?.[0] ?? 0, s.f0?.[1] ?? 0, s.f1?.[0] ?? 0, s.f1?.[1] ?? 0, s.nx, s.ny, s.w2 ?? (s.frame ? 1 : 0), s.w3 ?? 0, {box: s.box});
      }
      segCount += p.segs.length;
      for (const w of p.writes) mwData.push(...w);
      mwCount += p.writes.length;
      for (const e of p.extra || []) mwData.push(...e);
      mwCount += (p.extra || []).length;
      ops.push({p, node});
    }
    // H10: a node with a coast pass. Its coast box is the footprint grown by the coast's reach; the cells wanted exact (hit) read the prefix, the crossings of
    // the sea and the blur's window out to readR, so the passes run over that, inside the box. Order: the prefix and a clear footprint, the stamp (which
    // writes its influence), then the fingers (the field, the blurred normal, the thumbs, the march) and the layers (the field again on the new heights).
    const emitCoast = (p, node, R, ex, noise) => {
      const c = p.coast, hit = intersect(R, c.box), wide = hit ? intersect(ex(hit, c.readR), c.box) : null;
      if (!wide) return;
      add('coastInit', wide, node);
      emitBody(p, {...node, coPutW: 1}, wide, ex, noise);
      if (c.facet) {
        add('facetSnap', wide, node);
        if (c.lfc) {
          const seeds = {x0: 0, y0: 0, x1: 255, y1: c.lfcRows - 1};
          add('lfCrystalSites', seeds, {...node, lfcWx0: wide.x0 - c.lfcMargin, lfcWy0: wide.y0 - c.lfcMargin, lfcWx1: wide.x1 + c.lfcMargin, lfcWy1: wide.y1 + c.lfcMargin});
          if (node.lfcForm === 2) add('lfCrystalRoom', seeds, node);
        }
        const fb = intersect(wide, p.region); if (fb) add(c.lfc ? 'lfCrystalApply' : 'facetApply', fb, node); return;
      }
      const field = (moved = 1) => {
        const N = Math.max(1, Math.ceil(Math.log2(c.maxCells + 1)));
        add('coastSeed', wide, {...node, coSrc: 0, coMoved: moved});
        let src = 0;
        for (let k = N - 1; k >= -0; k--) { add('coastJump', wide, {...node, coSrc: src, coStep: 1 << k}); src ^= 1; if (k === 0) { add('coastJump', wide, {...node, coSrc: src, coStep: 1}); src ^= 1; } }
        add('coastFinish', wide, {...node, coSrc: src});
        return src;
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
        if (c.u.coJag > 0) add('coastJag', wide, node);   // L2: the layers' edge jag, on their distance field
        add('coastLayers', wide, node);
      }
      // Shore plates run after the coast pass on the heights it left, with every crossing of the sea the footprint touches (not only the ones this node moved).
      if (c.plates) { field(0); add('coastPlates', wide, node); }
      // The beach is last, on the heights the others left; its field is the coast of those heights.
      if (c.beach) { add('coastBeach', wide, {...node, coSrc: field()}); }
    };
    // Phase 2: the passes of one node over the rectangle R (the evaluation's, or a window's), `ex` growing a rectangle inside what exists.
    // A height image over R: the pass takes only the samples its cells read, as a block of MW after every node's rows (one f32 a sample, four to a row).
    // A cell reads the four samples round its place in each axis, clamped to the image; the window keeps one more each side, since the shader finds that
    // place in f32. The window is cut out by whole samples, so what a cell reads does not depend on the window: a page and the whole map agree.
    const emitHeights = (op, R) => {
      const p = op.heights, f = p.fields, body = intersect(R, p.region);
      if (!body) return;
      const key = `${body.x0},${body.y0},${body.x1},${body.y1}`;
      if (op.key !== key) {
        const first = (cell, origin, n) => clamp(Math.floor((cell * spacing - origin) / f.cell) - 2, 0, n - 1), last = (cell, origin, n) => clamp(Math.floor((cell * spacing - origin) / f.cell) + 3, 0, n - 1);
        const i0 = first(body.x0, f.x, f.width), i1 = last(body.x1, f.x, f.width), j0 = first(body.y0, f.y, f.height), j1 = last(body.y1, f.y, f.height), cw = i1 - i0 + 1, ch = j1 - j0 + 1;
        const data = new Float32Array(Math.ceil(cw * ch / 4) * 4);
        for (let j = 0; j < ch; j++) data.set(p.values.subarray((j0 + j) * f.width + i0, (j0 + j) * f.width + i0 + cw), j * cw);
        mwBlocks.push({row: mwCount, data});
        op.key = key; op.u = {...p.u, mwBase: mwCount, hmCx: i0, hmCy: j0, hmCw: cw};
        mwCount += data.length / 4;
      }
      add('heights', body, op.u);
    };
    const emitOp = (op, R, ex, noise) => {
      if (op.ground) { add('ground', R, op.u); return; }
      if (op.heights) { emitHeights(op, R); return; }
      const p = op.p, node = op.node;
      if (p.coast) { emitCoast(p, node, R, ex, noise); return; }
      emitBody(p, node, R, ex, noise);
    };
    // The node's own stamp passes over R (the host's coast pass runs them with the footprint plane switched on).
    const emitBody = (p, node, R, ex, noise) => {
      const body = p.region ? intersect(R, p.region) : null;
      if (!body) return;
      if (noise) add('noise', ex(p.region, 1), node);
      const entry = p.entry || 'stamp';
      if (p.smoothR) {
        // The blurred prefix over the footprint: copy the prefix height over the footprint plus the radius, blur along rows over that, then down columns over the footprint.
        const wide = ex(body, p.smoothR);
        add('smoothCopy', wide, node); add('blurH', wide, {...node, bsrc: 0, bdst: 1, blurR: p.smoothR}); add('blurV', body, {...node, bsrc: 1, bdst: 2, blurR: p.smoothR});
        add(entry, body, node); return;
      }
      add(entry, body, node);
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
      // Undulation in the art below 1: the list without its ground node first, its height held in plane u, then the whole list, and artLevel over what init
      // covered (every plane is as exact there as h).
      const span = ops.length ? need : R, level = ops.find(op => op.ground && op.art < 1);
      if (level) {
        add('init', span);
        ops.forEach((op, j) => { if (!op.ground) emitOp(op, rects[j], exMain, !target); });
        add('artHold', span);
      }
      add('init', span, level ? {artKeep: 1} : {});
      ops.forEach((op, j) => {
        emitOp(op, rects[j], exMain, !target);
      });
      if (level) add('artLevel', span, {...level.u, gArt: level.art});
    }
    }
    // Pack the rectangle for readback.
    const rw0 = P ? P.x1 - P.x0 + 1 : 0, rh0 = P ? P.y1 - P.y0 + 1 : 0, rc = rw0 * rh0, q4 = Math.ceil(rc / 4), outWords = plane === null ? PLANES * rc + 25 * q4 : rc;
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
    if (mwData.length) device.queue.writeBuffer(MWB, 0, new Float32Array(mwData));
    for (const b of mwBlocks) device.queue.writeBuffer(MWB, b.row * 16, b.data);   // the height images' windows, after every node's rows
    const OutB = buf(readback ? outWords * 4 : 16, ST | CS, 'shape out');
    const group = device.createBindGroup({layout, entries: [
      {binding: 0, resource: {buffer: ub, size: NODE_BYTES}}, {binding: 1, resource: {buffer: TF}}, {binding: 2, resource: {buffer: TMk}}, {binding: 3, resource: {buffer: (target ? null : Nz) ?? dummy}},
      {binding: 4, resource: {buffer: (target ? pageScratch : Sc) ?? dummy}}, {binding: 5, resource: {buffer: SegB}}, {binding: 6, resource: {buffer: MWB}}, {binding: 7, resource: {buffer: OutB}}]});
    const enc = device.createCommandEncoder({label: 'shape'}), pass = enc.beginComputePass({label: 'shape passes'});
    passes.forEach((ps, k) => {
      pass.setPipeline(pipes[ps.entry]); pass.setBindGroup(0, group, [k * NODE_BYTES]);
      const w = ps.region.x1 - ps.region.x0 + 1, h = ps.region.y1 - ps.region.y0 + 1;
      if (ps.entry === 'pack' || ps.entry === 'packPlane') { const g = Math.ceil(outWords / 256), gx = Math.min(g, 65535); pass.dispatchWorkgroups(gx, Math.ceil(g / gx)); }
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
      return {rect: P, width: rw0, height: rh0, floats: FIELD_KEYS_FLOAT.map((_, k) => new Float32Array(raw, k * rc * 4, rc)), masks: Array.from({length: 25}, (_, m) => new Int8Array(raw, (PLANES * rc + m * q4) * 4, rc))};
    })();
    peak = Math.max(peak, bytes() + sd.byteLength + mwBlocks.reduce((sum, b) => sum + b.data.byteLength, 0) + passes.length * NODE_BYTES + (readback ? 2 * outWords * 4 : 0));
    done.then(() => {
      ub.destroy(); SegB.destroy(); MWB.destroy(); OutB.destroy();
      if (release && !target && Nz === nz) { nz.destroy(); sc.destroy(); Nz = Sc = null; }
      if (!readback) last = {passes: passes.length, segments: segCount, ms: performance.now() - t0, prepareMs: tSubmit - t0, gpuMs: performance.now() - tSubmit, readbackMs: 0, cells: rc};
    });
    return {done, land, rect: R};
  }
  // Copy a readback rectangle into row-major CPU planes of the given row stride (the planes are `grid` wide).
  function copyOut(out, planes) {
    const {rect, width, height} = out;
    for (let k = 0; k < PLANES; k++) { const dst = planes[FIELD_KEYS_FLOAT[k]]; for (let y = 0; y < height; y++) dst.set(out.floats[k].subarray(y * width, (y + 1) * width), (rect.y0 + y) * grid + rect.x0); }
    for (let m = 0; m < 25; m++) { const dst = planes.masks[m]; for (let y = 0; y < height; y++) dst.set(out.masks[m].subarray(y * width, (y + 1) * width), (rect.y0 + y) * grid + rect.x0); }
  }
  // H5b: the authored height at every `step`-th cell of a rectangle of a target (the overview's coarse lattice), read back: (w x h) floats, w = (x1 - x0) / step + 1.
  async function decimate(target, rect, step) {
    const w = Math.floor((rect.x1 - rect.x0) / step) + 1, h = Math.floor((rect.y1 - rect.y0) / step) + 1, ub = buf(NODE_BYTES, GPUBufferUsage.UNIFORM | CD, 'coarse uniform'), dv = new DataView(new ArrayBuffer(NODE_BYTES));
    const u = {grid, spacing, rx0: rect.x0, ry0: rect.y0, rx1: rect.x1, ry1: rect.y1, ox: target.ox, oy: target.oy, pw: target.pw, ph: target.ph, blurR: step};
    NODE_FIELDS.forEach(([name, type], j) => { const v = u[name] ?? 0; if (type === 'f') dv.setFloat32(j * 4, v, true); else if (type === 'u') dv.setUint32(j * 4, v >>> 0, true); else dv.setInt32(j * 4, v, true); });
    device.queue.writeBuffer(ub, 0, dv.buffer);
    const d3 = buf(16, ST, 'coarse unused 3'), d4 = buf(16, ST, 'coarse unused 4'), d56 = buf(16, ST, 'coarse unused 56');
    const out = buf(w * h * 4, ST | CS, 'coarse out'), stage = buf(w * h * 4, GPUBufferUsage.MAP_READ | CD, 'coarse read');
    const bg = device.createBindGroup({layout, entries: [{binding: 0, resource: {buffer: ub, size: NODE_BYTES}}, {binding: 1, resource: {buffer: target.F}}, {binding: 2, resource: {buffer: target.Mk}}, {binding: 3, resource: {buffer: d3}},
      {binding: 4, resource: {buffer: d4}}, {binding: 5, resource: {buffer: d56}}, {binding: 6, resource: {buffer: d56}}, {binding: 7, resource: {buffer: out}}]});
    const enc = device.createCommandEncoder({label: 'coarse'}), pass = enc.beginComputePass({label: 'coarse'});
    pass.setPipeline(pipes.coarse); pass.setBindGroup(0, bg, [0]);
    const g = Math.ceil(w * h / 256), gx = Math.min(g, 65535); pass.dispatchWorkgroups(gx, Math.ceil(g / gx)); pass.end();
    enc.copyBufferToBuffer(out, 0, stage, 0, w * h * 4); device.queue.submit([enc.finish()]);
    await stage.mapAsync(GPUMapMode.READ); const values = new Float32Array(stage.getMappedRange().slice(0)); stage.unmap();
    stage.destroy(); out.destroy(); ub.destroy(); d3.destroy(); d4.destroy(); d56.destroy();
    return {w, h, values};
  }
  return {run, submit, copyOut, bytes, makeTarget, decimate, planes: F, masks: Mk, stats: () => ({gpuBytes: bytes(), peakGpuBytes: peak, planeBytes: F.size, maskBytes: Mk.size, noiseBytes: Nz?.size || 0, scratchBytes: Sc?.size || 0, last}),
    destroy() { F.destroy(); Mk.destroy(); Nz?.destroy(); Sc?.destroy(); pageScratch?.destroy(); Nz = Sc = pageScratch = null; }, grid, spacing, device};
}

// ---- the fields object ----
// opts: the createRegionalFields options (worldSize, worldGrid, baseHeight, maskKeys, nodes), plus device() (the GPU device, or null
// until the renderer exists), context() (the host context for prepareNode).
// A failed pass is never silent: it reaches the console and, through the handler the editor installs, its error line.
let onFailure = null;
export function setFailureHandler(fn) { onFailure = fn; }
const fail = err => { console.error(err); onFailure?.(err); };
export function createGpuFields(opts) {
  const {worldSize, worldGrid, baseHeight, maskKeys, nodes, device, context} = opts;   // opts.forceRing (page parameter pageRing=N): a ring chosen by hand, for checking the ring rule against the whole-map engine
  const spacing = (worldSize - 1) / (worldGrid - 1), cells = worldGrid * worldGrid, listeners = new Set();
  const clip = r => ({x0: clamp(r.x0, 0, worldGrid - 1), y0: clamp(r.y0, 0, worldGrid - 1), x1: clamp(r.x1, 0, worldGrid - 1), y1: clamp(r.y1, 0, worldGrid - 1)});
  const worldRect = r => ({x: r.x0 * spacing, y: r.y0 * spacing, width: (r.x1 - r.x0) * spacing, height: (r.y1 - r.y0) * spacing});
  let revision = 0, planes = null, engine = null, enginePromise = null, valid = false, gpuValid = false, error = null;
  let lastEval = {}, firstReady = 0;
  // H6b: announce a requested change immediately, then merge its rectangle
  // while a gesture uses the preview lattice. A canonical reader or release
  // submits the merged request; at most two runs remain in flight. The newest
  // node list is read when a run starts. CPU copies wait for release or an
  // explicit reader, and overview/saving listeners hear only after that copy.
  const gesture = opts.gesture || (() => false);
  let submittedRevision = 0, outstanding = 0, starting = null, waiters = [], queued = null, copyDirty = false, copyRect = null, landing = 0, landChain = Promise.resolve(), reported = null, generation = 0, flushWanted = false;
  const submitListeners = new Set(), runLog = [];let gpuReaders=0;
  const joinRect = (a, b) => !a || !b ? null : {x0: Math.min(a.x0, b.x0), y0: Math.min(a.y0, b.y0), x1: Math.max(a.x1, b.x1), y1: Math.max(a.y1, b.y1)};
  const joinWorld = (a, b) => !a || !b ? null : (() => { const x0 = Math.min(a.x, b.x), y0 = Math.min(a.y, b.y); return {x: x0, y: y0, width: Math.max(a.x + a.width, b.x + b.width) - x0, height: Math.max(a.y + a.height, b.y + b.height) - y0}; })();
  const joinEvent = (a, b) => !a ? b : !b ? a : {revision: Math.max(a.revision, b.revision), rect: joinWorld(a.rect, b.rect)};
  const allocate = () => { planes ??= {...Object.fromEntries(FIELD_KEYS_FLOAT.map(k => [k, new Float32Array(cells)])), masks: maskKeys.map(() => new Int8Array(cells))}; };
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
      } catch (err) { error = err; fail(err); }
      finally { landing--; }
    });
  }
  const MAX_OUTSTANDING = 2;   // runs submitted whose GPU work is not finished; more wait in `queued` and merge
  const progress = () => { const w = waiters; waiters = []; for (const fn of w) fn(); };
  function pump() {
    if (!queued) { progress(); return; }
    // Drag pictures read their own preview lattice. Do not queue whole-map
    // work for every pointer event ahead of those pictures.
    if(gpuValid&&gesture()&&!gpuReaders){progress();return;}
    if (!engine) {
      if (!starting) starting = getEngine().catch(err => { error = err; fail(err); queued = null; }).then(() => { starting = null; pump(); });
      return;
    }
    while (queued && outstanding < MAX_OUTSTANDING) {
      const q = queued; queued = null;
      const whole = !gpuValid || !q.rect, wasValid = valid, wasGpu = gpuValid, gen = generation;
      const nextCopyRect = copyDirty ? joinRect(copyRect, whole ? null : q.rect) : (whole ? null : q.rect);
      const readNow = !gesture() || !valid || whole;
      let h;
      try { h = engine.submit(nodes(), context(), whole ? null : q.rect, {readback: readNow, readRect: nextCopyRect, release: whole}); }
      catch (err) { error = err; fail(err); continue; }
      error = null;
      reported = joinEvent(reported, q.event); copyRect = nextCopyRect; copyDirty = true;
      const entry = {t: performance.now(), whole, readNow}; runLog.push(entry); if (runLog.length > 400) runLog.shift();
      submittedRevision = Math.max(submittedRevision, q.event?.revision ?? 0); gpuValid = true;
      if (!q.event && !wasGpu) { const ev = {revision, rect:null}; for (const fn of submitListeners) fn(ev); }
      if (readNow) { const report = reported; reported = null; copyDirty = false; copyRect = null; land(h, whole, report, wasValid, gen); }
      outstanding++;
      h.done.catch(err => { error = err; fail(err); }).then(() => { entry.doneAt = performance.now(); outstanding--; pump(); if (!outstanding && !queued) flushIfDue(); });
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
    for(const fn of submitListeners)fn(event);
    evaluate(r, event);
    return event;
  }
  const quiet = async () => { while (queued || starting || outstanding > 0) await new Promise(r => waiters.push(r)); };
  const settled = async () => { while (queued || starting) await new Promise(r => waiters.push(r)); };
  // The GPU buffers are current once every requested run has been submitted (the queue is in order on one device, so a bake that records its own
  // work next sees them): it does not wait for the work to finish.
  // A failed run leaves the fields invalid; asking again would fail again at once and spin the page in a loop of resolved promises, so a waiter gets the error.
  const demand=async wait=>{gpuReaders++;try{pump();await wait();}finally{gpuReaders--;}};
  const gpuReady = async () => { if (!gpuValid && !queued && !starting) { if (error) throw error; evaluate(null); } await demand(settled); if (!gpuValid && error) throw error; };
  // The CPU copy is current: also waits for the reads. A CPU reader forces the read that a gesture left out.
  const whenReady = async () => {
    gpuReaders++;try{pump();
    if (!valid && !queued && !starting && landing === 0) { if (error) throw error; evaluate(null); }
    for (;;) {
      if (!valid && error && !queued && !starting) throw error;
      if (queued || starting) { await settled(); continue; }
      flushIfDue(true);
      if (landing > 0) { await landChain; continue; }
      break;
    }
    }finally{gpuReaders--;}
  };
  function crop(request) {
    const rect = clip({x0: Math.floor(request.x0), y0: Math.floor(request.y0), x1: Math.ceil(request.x1), y1: Math.ceil(request.y1)});
    const w = rect.x1 - rect.x0 + 1, h = rect.y1 - rect.y0 + 1, fields = {};
    const cut = (src, ctor) => { const out = new ctor(w * h); for (let y = 0; y < h; y++) out.set(src.subarray((rect.y0 + y) * worldGrid + rect.x0, (rect.y0 + y) * worldGrid + rect.x0 + w), y * w); return out; };
    for (const k of FIELD_KEYS_FLOAT) fields[k] = cut(planes[k], Float32Array);
    maskKeys.forEach((k, j) => { fields[k] = cut(planes.masks[j], Int8Array); });
    return {fields, maskPlanes: maskKeys.map(k => fields[k]), gridWidth: w, gridHeight: h, gridSpacing: spacing, gridOrigin: [rect.x0 * spacing, rect.y0 * spacing], worldSize, worldGrid, revision,
      bytes: w * h * (4 * PLANES + maskKeys.length), rect: worldRect(rect)};
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
    const g = engine?.stats() || {}, cpu = planes ? cells * (4 * PLANES + maskKeys.length) : 0;
    return {revision, residentBytes: cpu, cacheBytes: cpu, cacheEntries: planes ? 1 : 0, lastWorkingBytes: 0, peakBytes: cpu, budget: cpu, hits: 0, misses: 0, replays: 0, evictions: 0,
      chunkCells: worldGrid, worldSize, worldGrid, gridSpacing: spacing, bytesPerCell: 4 * PLANES + maskKeys.length, workspaceBytesPerCell: 0, maxWorkingCells: 0, pointSamples: 0,
      connectionTiles: 0, connectionCells: 0, gpuShape: {...g, cpuCopyBytes: cpu, pending: outstanding + (queued ? 1 : 0) + landing, runLog: runLog.slice(-120), lastEval, error: error?.message || null}};
  };
  return {
    buffers: () => planes ? [...FIELD_KEYS_FLOAT.map(k => planes[k].buffer), ...planes.masks.map(a => a.buffer)] : [],
    read, readCells, sample, cell, changed, ready: () => whenReady(), pending: () => (queued !== null || starting !== null || landing > 0 || copyDirty || !valid),
    readAsync: async (request, o) => { await whenReady(); return read(request, o); },
    subscribe(fn) { listeners.add(fn); return () => listeners.delete(fn); },
    stats, active: () => true,
    planes: () => planes, engine: () => engine,
    // H6b: the engine's whole-map buffers (the h p r c v x planes, the packed masks) for the passes that read them in place. Await ready() first.
    gpuBuffers: () => gpuValid && engine ? {planes: engine.planes, masks: engine.masks, grid: worldGrid, spacing, revision: submittedRevision} : null,
    subscribeSubmit(fn) { submitListeners.add(fn); return () => submitListeners.delete(fn); },
    gpuReady: () => gpuReady(), gpuQuiet: () => demand(quiet), gpuPending: () => (queued !== null || starting !== null || !gpuValid),
    // Start the read of what a gesture left out, once the gesture is over (the weather glue calls this on release).
    settle: () => { pump();flushIfDue(); },
  };
}

// The CPU copies of pages evicted from VRAM (createPagedFields' spill), an LRU by bytes under cap(). An entry is reserved at eviction with the stamp
// of its inputs (begin) and holds its bytes once the GPU copy is read back (fill). take() gives the bytes only to a caller with the same stamp, and only
// once: the page is resident again and its copy is let go. A stale or unfinished copy is dropped where it is found, never returned.
export function createPageSpill(cap) {
  const entries = new Map();
  let bytes = 0, tick = 0, hits = 0, misses = 0, stale = 0, unfinished = 0, dropped = 0;
  const remove = key => { const e = entries.get(key); if (!e) return false; entries.delete(key); bytes -= e.size; return true; };
  function trim() {
    const limit = cap();
    while (bytes > limit && entries.size) {
      let victim = null; for (const [k, e] of entries) if (!victim || e.used < victim[1].used) victim = [k, e];
      remove(victim[0]); dropped++;
    }
  }
  return {
    // Reserve `size` bytes for `key` copied under `stamp`, replacing an older copy of the key; null when the cap cannot hold it.
    begin(key, stamp, size, meta = null) {
      remove(key);
      if (!(size <= cap())) return null;
      const e = {stamp, size, meta, data: null, used: ++tick};
      entries.set(key, e); bytes += size; trim();
      return entries.get(key) === e ? e : null;
    },
    // The read-back bytes of an entry begin() returned; false when the entry was dropped or replaced meanwhile (the bytes are let go).
    fill(key, e, data) { if (entries.get(key) !== e) return false; if (!data) { remove(key); return false; } e.data = data; return true; },
    take(key, stamp) {
      const e = entries.get(key);
      if (!e) { misses++; return null; }
      remove(key);
      if (e.stamp !== stamp) { stale++; return null; }
      if (!e.data) { unfinished++; return null; }
      hits++; return {data: e.data, meta: e.meta};
    },
    drop: key => remove(key),
    clear(match = null) { for (const k of [...entries.keys()]) if (!match || match(k)) remove(k); },
    trim,
    stats: () => ({bytes, entries: entries.size, ready: [...entries.values()].filter(e => e.data).length, cap: cap(), hits, misses, stale, unfinished, dropped}),
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
  const {worldSize, worldGrid, baseHeight, maskKeys, nodes, device, context} = opts;
  const CORE = opts.core ?? 512, APRON = opts.apron ?? 128, COARSE = 8, SHIFT = Math.log2(CORE);
  const spacing = (worldSize - 1) / (worldGrid - 1), np = Math.ceil(worldGrid / CORE), gesture = opts.gesture || (() => false);
  const foregroundPending = opts.foregroundPending || (() => false);
  // H6c: the ring is 4 cells (the hill's blur) plus the longest chain of overlapping smooth radii among the nodes, bucketed to RINGS; it follows the node list.
  const RINGS = [4, 16, 32, 64, 128, 192, 320];
  const PAGE_CELL = 4 * PLANES + 28;   // a shape page's bytes a cell: the float planes and the packed masks
  let RING = 4, SIDE = CORE + 2 * RING, SHAPE_BYTES = SIDE * SIDE * PAGE_CELL;
  const WEATHER_BYTES = CORE * CORE * 20, CPU_PAGES = 16;
  // Page caps (fitCaps): as many as the GPU budget's room holds, never under the 6 a chunk's feed gathers at once.
  let SHAPE_PAGES = 9, WEATHER_PAGES = 24;
  const shapeBudget = () => opts.shapeBudget ?? SHAPE_PAGES * SHAPE_BYTES, weatherBudget = () => opts.weatherBudget ?? WEATHER_PAGES * WEATHER_BYTES;   // H13: a function like shapeBudget, so a refit's page cap holds (it was read once, at 24 pages)
  const listeners = new Set(), submitListeners = new Set(), pagesMap = new Map();
  const clip = r => ({x0: clamp(r.x0, 0, worldGrid - 1), y0: clamp(r.y0, 0, worldGrid - 1), x1: clamp(r.x1, 0, worldGrid - 1), y1: clamp(r.y1, 0, worldGrid - 1)});
  const worldRect = r => ({x: r.x0 * spacing, y: r.y0 * spacing, width: (r.x1 - r.x0) * spacing, height: (r.y1 - r.y0) * spacing});
  const hits = (a, b) => a.x0 <= b.x1 && b.x0 <= a.x1 && a.y0 <= b.y1 && b.y0 <= a.y1;
  let revision = 0, engine = null, enginePromise = null, error = null, tick = 0, prep = new Map(), prepContext = null, time = null, timeKey = '', staging = null, scratchT = null, firstError = null;
  let coarseFilled = 0;
  let pendingStale = null, coarseDone = 0, coarseStart = 0, coarseFirstView = 0, focus = null;
  const coarseW = Math.floor((worldGrid - 1) / COARSE) + 1, coarse = new Float32Array(coarseW * coarseW).fill(baseHeight), coarseHave = new Uint8Array(coarseW * coarseW);
  const coarseQueue = new Map();   // page key -> the world rect to announce when it is done
  let coarseRunning = false, coarseTimer = 0, coarseWaiters = [];
  // P21: the lattice is whole when every page has filled it and none is queued (an edit queues the pages it touches again).
  const coarseComplete = () => !coarseRunning && !coarseTimer && !coarseQueue.size && coarseFilled === coarse.length;
  const key = (px, py) => py * np + px;
  const page = (px, py) => {
    let pg = pagesMap.get(key(px, py));
    if (!pg) {
      const x0 = px * CORE, y0 = py * CORE;
      pg = {px, py, x0, y0, cw: Math.min(CORE, worldGrid - x0), ch: Math.min(CORE, worldGrid - y0), target: null, rev: 0, shapeSeq: 0, weatherSeq: 0, cpu: null, cpuW: null, cpuBusy: false, cpuRev: -1, weather: null, stale: false, staleSeq: 0, weatherJob: null, used: 0, pins: 0, key: key(px, py)};
      pagesMap.set(pg.key, pg);
    }
    return pg;
  };
  const coreRect = pg => ({x0: pg.x0, y0: pg.y0, x1: pg.x0 + pg.cw - 1, y1: pg.y0 + pg.ch - 1});
  const bufRect = pg => ({x0: pg.x0 - RING, y0: pg.y0 - RING, x1: pg.x0 + CORE + RING - 1, y1: pg.y0 + CORE + RING - 1});
  const windowRect = pg => ({x0: pg.x0 - APRON, y0: pg.y0 - APRON, x1: pg.x0 + CORE + APRON - 1, y1: pg.y0 + CORE + APRON - 1});
  // The cells a page's Time pass evaluates and erodes: windowRect moved inside the world at its edges.
  const weatherSide = Math.min(worldGrid, CORE + 2 * APRON);
  const weatherWindow = pg => { const x0 = clamp(pg.x0 - APRON, 0, worldGrid - weatherSide), y0 = clamp(pg.y0 - APRON, 0, worldGrid - weatherSide); return {x0, y0, x1: x0 + weatherSide - 1, y1: y0 + weatherSide - 1}; };
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
  const STAGING_BYTES = 700 * 850 * (4 * PLANES + 64), FEED_PAGES = 6, PAGE_FIELD = CORE * CORE * 36;
  const engineEstimate = ring => 16e6 + (CORE + 2 * ring) ** 2 * 44;
  const available = (preview=false) => { const b = opts.budget?.(); return b ? b.total - (preview?(b.previewMinimum??b.minimum):b.minimum) : Infinity; };
  const residentSet = ring => FEED_PAGES * (CORE + 2 * ring) ** 2 * PAGE_CELL + FEED_PAGES * PAGE_FIELD + STAGING_BYTES + engineEstimate(ring);
  // Time results first (a page's Time pass costs far more than evaluating its shape), then as many shape pages as the rest holds: after an edit a
  // view's tiles gather from 20-odd pages, and a cap of 9 had them evict each other tile after tile (24 pages evaluated 144 times in one settle).
  // At most 24 weather and 64 shape pages for each 2 GiB of the budget: at the default 2 GiB the pages hold about 1.2 GB (the smallest ring) and the rest of the room
  // stays with the renderer's caches, and a larger budget keeps proportionally more pages resident (96 and 256 at 8 GiB).
  function fitCaps() {
    const room = 0.92 * available(true) - STAGING_BYTES - engineEstimate(RING), per = Math.max(1, (opts.budget?.()?.total || 0) / 2 ** 31);
    WEATHER_PAGES = clamp(Math.floor(0.4 * room / PAGE_FIELD), FEED_PAGES, Math.round(24 * per));
    SHAPE_PAGES = clamp(Math.floor((room - WEATHER_PAGES * PAGE_FIELD) / SHAPE_BYTES), FEED_PAGES, Math.round(64 * per));
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
      RING = ring; SIDE = CORE + 2 * RING; SHAPE_BYTES = SIDE * SIDE * PAGE_CELL; ringChanges++;
      for (const pg of pagesMap.values()) dropShape(pg);
      spill.clear(k => k[0] === 's');
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
  // One preparation of each node for a revision; a node the revision did not change keeps the last one's (createNodePreparer).
  const keptPrepare = createNodePreparer();
  const prepare = (n, geom, c) => { let p = prep.get(n); if (!p) { p = keptPrepare(n, geom, c, prepContext ??= nodeContextKey(c)); prep.set(n, p); } return p; };

  // ---- resources
  const shapeBytes = () => { let n = 0; for (const pg of pagesMap.values()) if (pg.target) n += pg.target.bytes; return n; };
  const weatherBytes = () => { let n = 0; for (const pg of pagesMap.values()) if (pg.weather) n += WEATHER_BYTES + (pg.weather.field ? CORE * CORE * 16 : 0); return n; };
  const stagingBytes = () => (staging?.bytes || 0) + (scratchT?.bytes || 0);
  const cpuBytes = () => { let n = 0; for (const pg of pagesMap.values()) n += (pg.cpu ? 8 * SIDE * SIDE : 0) + (pg.cpuW ? 8 * CORE * CORE : 0); return n; };
  const gpuBytes = () => shapeBytes() + weatherBytes() + stagingBytes() + (engine?.bytes() || 0);
  // A page that is read or gathered right now (pinned) keeps its buffers until the last reader lets go.
  function dropShape(pg) { if (pg.target) { if (pg.pins) (pg.zombies ??= []).push(pg.target); else pg.target.destroy(); } pg.target = null; pg.late = null; pg.cpu = null; pg.cpuRev = -1; }
  function unpin(pg) { pg.pins--; if (!pg.pins && pg.zombies?.length) { for (const t of pg.zombies) t.destroy(); pg.zombies = []; } }
  function dropWeather(pg) { if (pg.weather) { pg.weather.weather.destroy(); pg.weather.maps.forEach(b => b.destroy()); pg.weather.field?.destroy(); pg.weather = null; pg.cpuW = null; } }

  // ---- the spill: a CPU copy of each page the LRU evicts, its buffers' bytes in their GPU layout, so the page comes back with writeBuffer instead of
  // its shape evaluation or its Time pass. A copy is stamped with the inputs it holds: the ring and the page's shapeSeq (shape), the weather's own
  // weatherSeq and the Time key (weather). changed() bumps those for every page an edit reaches (resident or not) and drops the copies there, a ring or
  // Time key change drops them all, and take() returns a copy only under the stamp it was made with. The cap: a quarter of the device memory the
  // browser reports (navigator.deviceMemory, at most 8 GB), at most 2 GiB: about 130 shape pages or 210 weather pages, more than the default GPU
  // budget holds resident, while a 4 GB machine keeps 1 GiB.
  const SPILL_BYTES = Math.min(2, (globalThis.navigator?.deviceMemory || 8) / 4) * 1024 ** 3;
  const spill = createPageSpill(() => opts.spillBytes ?? SPILL_BYTES), spilling = new Set();
  const shapeStamp = pg => `${RING} ${pg.shapeSeq}`, weatherStamp = seq => `${seq} ${timeKey}`;
  let shapeRestores = 0, weatherRestores = 0, shapeEvals = 0;
  // The copy is submitted now, ahead of the buffers' destruction (WebGPU keeps them until the copy has run), and read back without waiting: the copy
  // becomes usable when its map completes. A staging buffer that cannot be made (out of memory) leaves the page without a copy, never an error.
  function spillOut(key, stamp, meta, sources) {
    const d = device(), size = sources.reduce((n, b) => n + b.size, 0), entry = d ? spill.begin(key, stamp, size, meta) : null;
    if (!entry) return;
    let stage = null;
    d.pushErrorScope('validation'); d.pushErrorScope('out-of-memory');
    try {
      stage = d.createBuffer({label: 'page spill', size, usage: GPUBufferUsage.MAP_READ | GPUBufferUsage.COPY_DST});
      const enc = d.createCommandEncoder({label: 'page spill'}); let at = 0;
      for (const b of sources) { enc.copyBufferToBuffer(b, 0, stage, at, b.size); at += b.size; }
      d.queue.submit([enc.finish()]);
    } catch { stage?.destroy(); stage = null; }
    const scopes = [d.popErrorScope(), d.popErrorScope()];
    if (!stage) { scopes.forEach(p => p.catch(() => {})); spill.fill(key, entry, null); return; }
    spilling.add(stage);
    Promise.all(scopes).then(async errors => {
      if (errors.some(Boolean)) return spill.fill(key, entry, null);
      await stage.mapAsync(GPUMapMode.READ);
      const data = stage.getMappedRange().slice(0); stage.unmap();
      spill.fill(key, entry, data);
    }).catch(() => spill.fill(key, entry, null)).finally(() => { spilling.delete(stage); stage.destroy(); });
  }
  // Eviction (the LRU in trim): the page's buffers go to the spill first. A resident shape page holds its current inputs once the cells an edit
  // reached have been evaluated again (current(), ahead of the copy); a weather result only while no edit reached its window since its pass read the shape (w.seq) and it is not stale.
  function evictShape(pg) { const t = pg.target; if (t && !pg.pins) { current(pg); spillOut('s' + pg.key, shapeStamp(pg), null, [t.F, t.Mk]); } dropShape(pg); }
  function evictWeather(pg) {
    const w = pg.weather;
    if (w && time && !pg.pins && !pg.stale && !w.invalidRect && !pg.weatherJob && w.seq === pg.weatherSeq)
      spillOut('w' + pg.key, weatherStamp(w.seq), {seq: w.seq, field: Boolean(w.field)}, [w.weather, ...w.maps, ...(w.field ? [w.field] : [])]);
    dropWeather(pg);
  }
  // A page's shape or weather from its copy, when one holds its current stamp: the same bytes in new buffers, and the CPU copies the sync reads use.
  // Restored weather carries the current Time revision (revB), as a pass run now would: its inputs are the same as when the pass ran.
  function restoreShape(pg) {
    const got = spill.take('s' + pg.key, shapeStamp(pg));
    if (!got) return false;
    const t = engine.makeTarget(pg.x0 - RING, pg.y0 - RING, SIDE, SIDE), q = device().queue, n = SIDE * SIDE;
    if (t.F.size + t.Mk.size !== got.data.byteLength) { t.destroy(); return false; }
    q.writeBuffer(t.F, 0, got.data, 0, t.F.size); q.writeBuffer(t.Mk, 0, got.data, t.F.size, t.Mk.size);
    pg.target = t; pg.rev++; shapeRestores++;
    pg.cpu = {h: new Float32Array(got.data.slice(0, n * 4)), r: new Float32Array(got.data.slice(2 * n * 4, 3 * n * 4))}; pg.cpuRev = pg.rev;
    return true;
  }
  function restoreWeather(pg) {
    const got = spill.take('w' + pg.key, weatherStamp(pg.weatherSeq));
    if (!got) return false;
    const d = device(), w = {revB: time.revB, seq: got.meta.seq, ...weatherBuffers(d, got.meta.field)}, parts = [w.weather, ...w.maps, ...(w.field ? [w.field] : [])], n = CORE * CORE;
    if (parts.reduce((s, b) => s + b.size, 0) !== got.data.byteLength) { parts.forEach(b => b.destroy()); return false; }
    let at = 0; for (const b of parts) { d.queue.writeBuffer(b, 0, got.data, at, b.size); at += b.size; }
    dropWeather(pg); pg.weather = w; pg.stale = false; weatherRestores++;
    pg.cpuW = {base: new Float32Array(got.data.slice(0, n * 4)), e: new Float32Array(got.data.slice(n * 4, 2 * n * 4)), source: w};
    return true;
  }
  const weatherBuffers = (d, field) => {
    const S = GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC | GPUBufferUsage.COPY_DST;
    return {weather: d.createBuffer({label: 'page weather', size: 2 * CORE * CORE * 4, usage: S}), maps: [0, 1, 2].map(k => d.createBuffer({label: 'page map ' + k, size: CORE * CORE * 4, usage: S})),
      field: field ? d.createBuffer({label: 'page material field', size: CORE * CORE * 16, usage: S}) : null};
  };
  function trim() {
    const lru = (has, free, budget, size) => {
      let total = 0; for (const pg of pagesMap.values()) if (has(pg)) total += size;
      while (total > budget) {
        let victim = null; for (const pg of pagesMap.values()) if (has(pg) && !pg.pins && (!victim || pg.used < victim.used)) victim = pg;
        if (!victim) break; free(victim); total -= size;
      }
    };
    lru(pg => pg.target, evictShape, shapeBudget(), SHAPE_BYTES);
    lru(pg => pg.weather, evictWeather, weatherBudget(), WEATHER_BYTES);
    spill.trim();
    let withCpu = 0; for (const pg of pagesMap.values()) if (pg.cpu) withCpu++;
    while (withCpu > CPU_PAGES) { let victim = null; for (const pg of pagesMap.values()) if (pg.cpu && !pg.pins && (!victim || pg.used < victim.used)) victim = pg; if (!victim) break; victim.cpu = null; victim.cpuW = null; withCpu--; }
  }

  // ---- shape
  function evalPage(pg, rect = null) {
    if (!pg.target) { pg.target = engine.makeTarget(pg.x0 - RING, pg.y0 - RING, SIDE, SIDE); rect = null; }
    engine.submit(nodes(), context(), rect, {readback: false, target: pg.target, prepare});
    pg.rev++; touch(pg); shapeEvals++;
  }
  // An edit leaves the cells it reached on a resident page to be evaluated when the page is next read (a tile's gather, the CPU copy, the coarse
  // lattice, the spill), not as it arrives: a gesture's own previews read the preview lattice, never the pages, and a pointer that moved faster
  // than the pictures queued three or four page evaluations an event that nothing read. The cells of every edit since the last read are evaluated
  // once, from the nodes as they are then: the same result, since a cell outside an edit's rectangle is not changed by it.
  const late = (pg, r) => { const a = pg.late; pg.late = a ? {x0: Math.min(a.x0, r.x0), y0: Math.min(a.y0, r.y0), x1: Math.max(a.x1, r.x1), y1: Math.max(a.y1, r.y1)} : {...r}; pg.rev++; touch(pg); };
  const current = pg => { if (pg.late && pg.target) { const r = pg.late; pg.late = null; evalPage(pg, r); } };
  const ensureShape = pg => { if (!pg.target && !restoreShape(pg)) { evalPage(pg); wantCpu(pg); } current(pg); touch(pg); };

  // ---- CPU copies of resident pages: h and r (shape), the authored and eroded height (weather)
  const cpuWanted = new Set(); let cpuTimer = 0, cpuReading = 0;
  function wantCpu(pg) { cpuWanted.add(pg.key); if (!cpuTimer) cpuTimer = setTimeout(pumpCpu, 0); }
  async function pumpCpu() {
    cpuTimer = 0;
    for (const k of [...cpuWanted]) {
      if (gesture() || foregroundPending() || opts.prepareBackground?.(SIDE*SIDE*8)===false) { cpuTimer = setTimeout(pumpCpu, 100); return; }
      cpuWanted.delete(k); const pg = pagesMap.get(k); if (!pg) continue;
      pg.pins++; cpuReading++;   // not evicted while its buffers are read
      try {
        if (pg.target) {
          current(pg);
          const rev = pg.rev, t = pg.target, n = SIDE * SIDE, d = device(), h = new Float32Array(await readBuffer(d, t.F, 0, n * 4)), r = new Float32Array(await readBuffer(d, t.F, 2 * n * 4, n * 4));
          if (pg.target === t && pg.rev === rev) { pg.cpu = {h, r}; pg.cpuRev = rev; } else wantCpu(pg);
        }
        if (pg.weather && !pg.stale) {
          const w = pg.weather, raw = await readBuffer(device(), w.weather, 0, 2 * CORE * CORE * 4);
          if (pg.weather === w) pg.cpuW = {base: new Float32Array(raw, 0, CORE * CORE), e: new Float32Array(raw, CORE * CORE * 4, CORE * CORE),source:w};
        }
      } catch (err) { error = err; fail(err); } finally { unpin(pg); cpuReading--; }
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
        if (gesture() || foregroundPending() || !engine || opts.prepareBackground?.(16*1024*1024+SIDE*SIDE*112)===false) { coarseTimer = setTimeout(pumpCoarse, 150); return; }
        // the page nearest the focus (the view) first
        let best = null, bd = Infinity;
        for (const k of coarseQueue.keys()) { const pg = pagesMap.get(k), d = focus ? Math.hypot(pg.x0 + CORE / 2 - focus.x, pg.y0 + CORE / 2 - focus.y) : pg.key; if (d < bd) { bd = d; best = pg; } }
        const announce = coarseQueue.get(best.key); coarseQueue.delete(best.key);
        current(best);
        let target = best.target;
        if (!target) {
          scratchT ??= engine.makeTarget(0, 0, SIDE, SIDE);
          scratchT.ox = best.x0 - RING; scratchT.oy = best.y0 - RING; target = scratchT;
          engine.submit(nodes(), context(), null, {readback: false, target, prepare});
        }
        const i0 = Math.ceil(best.x0 / COARSE), j0 = Math.ceil(best.y0 / COARSE), i1 = Math.floor((best.x0 + best.cw - 1) / COARSE), j1 = Math.floor((best.y0 + best.ch - 1) / COARSE);
        if (i1 >= i0 && j1 >= j0) {
          const out = await engine.decimate(target, {x0: i0 * COARSE, y0: j0 * COARSE, x1: i1 * COARSE, y1: j1 * COARSE}, COARSE);
          for (let j = 0; j < out.h; j++) for (let i = 0; i < out.w; i++) { const at = (j0 + j) * coarseW + i0 + i; coarse[at] = out.values[j * out.w + i]; if (!coarseHave[at]) { coarseHave[at] = 1; coarseFilled++; } }
        }
        coarseDone++;
        if (announce) { const ev = {revision, rect: announce}; for (const fn of listeners) fn(ev); }
        else if (coarseDone === 1 || !coarseQueue.size) { const ev = {revision, rect: null}; for (const fn of listeners) fn(ev); }
        await new Promise(r => setTimeout(r, 0));
      }
      if (!coarseFullAt) coarseFullAt = performance.now();
      scratchT?.destroy(); scratchT = null;   // the evaluation target the background fill borrowed (14 MB) goes back
    } catch (err) { error = err; fail(err); }
    finally { coarseRunning = false; if (coarseComplete()) { const w = coarseWaiters; coarseWaiters = []; for (const fn of w) fn(); } }
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
    spill.clear(k => k[0] === 'w');
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
    if (!time || restoreWeather(pg)) return;
    const t0 = performance.now(), side = weatherSide, {x0: wx0, y0: wy0} = weatherWindow(pg), seq = pg.staleSeq, wseq = pg.weatherSeq, tm = time, key = timeKey;
    const T = engine.makeTarget(wx0, wy0, side, side);
    try {
      engine.submit(nodes(), context(), null, {readback: false, target: T, prepare});
      const r = await tm.run({planes: T.F, masks: T.Mk, grid: side, ox: wx0, oy: wy0, stale: () => timeKey!==key || pg.staleSeq!==seq});
      if (timeKey !== key) { r.weather.destroy(); r.maps.forEach(b => b.destroy()); r.field?.destroy(); return; }
      const d = device(), w = {revB: tm.revB, seq: wseq, ...weatherBuffers(d, Boolean(r.field))};
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
      if(timeKey!==key){w.weather.destroy();w.maps.forEach(b=>b.destroy());w.field?.destroy();return;}
      // An edit can arrive while this page refines. Keep its invalid footprint
      // on the late result too; the next settled read will compute it again.
      if(pg.staleSeq!==seq){w.invalidRect=pg.weather?.invalidRect??coreRect(pg);pg.stale=true;}
      dropWeather(pg); pg.weather = w; if (pg.staleSeq === seq) pg.stale = false;
      pg.weatherMs = performance.now() - t0; weatherRuns++; weatherMsTotal += pg.weatherMs;
      touch(pg); wantCpu(pg);
    } catch (err) {
      if(err.name!=='AbortError'||timeKey===key&&pg.staleSeq===seq)throw err;
    } finally { T.destroy(); }
  }
  let weatherRuns = 0, weatherMsTotal = 0;

  // ---- ensure a rectangle (cells) is ready to be read; returns a lease that pins its pages
  async function prepareRect(rect, wantWeather, signal) {
    signal?.throwIfAborted();
    fitCaps();trim();   // view/level changes may reserve more preview memory
    if (!engine) await getEngine();
    signal?.throwIfAborted();
    focus ??= {x: (rect.x0 + rect.x1) / 2, y: (rect.y0 + rect.y1) / 2};
    const need = overlapping(rect); for (const pg of need) pg.pins++;
    let released = false;
    const lease = {pages: need, release() { if (released) return; released = true; for (const pg of need) unpin(pg); trim(); }};
    try {
      for (const pg of need) { signal?.throwIfAborted(); ensureShape(pg); }
      if (wantWeather && time) for (const pg of need) {
        signal?.throwIfAborted();
        // A superseded page releases its working set and retries at the current
        // Time key/revision. A retained stale page still serves a held gesture.
        while(time&&(!pg.weather||(pg.stale&&(!gesture()||opts.gestureSettled?.())))){await ensureWeather(pg);signal?.throwIfAborted();}
        // The submitted slice drains, but a canceled camera must not enqueue
        // the remaining pages while the new camera is waiting.
        signal?.throwIfAborted();touch(pg);
      }
      trim();
    } catch (err) { lease.release(); throw err; }
    return lease;
  }

  // ---- gather: encode the copy of `rect` from the pages' buffers into the destination set (encoder passes; pipelines from feedPasses)
  function encodeGather(enc, passes, rect, dst, wantWeather) {
    const d = device(), gw = rect.x1 - rect.x0 + 1, gh = rect.y1 - rect.y0 + 1, tmp = [];
    for (const pg of overlapping(rect)) {
      // The lease pins the page, but a ring change or a whole-map change during the lease's awaits (weather, feed passes) drops its target.
      // The gather re-acquires it here, on the current ring, ahead of this encoder on the queue.
      ensureShape(pg);
      const dispatch = (entry, src, box, res) => {
        const o = {x0: Math.max(rect.x0, box.x0), y0: Math.max(rect.y0, box.y0), x1: Math.min(rect.x1, box.x1), y1: Math.min(rect.y1, box.y1)};
        if (o.x1 < o.x0 || o.y1 < o.y0) return;
        const u = d.createBuffer({label: 'gather uniform', size: 64, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST}), dv = new DataView(new ArrayBuffer(64));
        [src.ox, src.oy, src.pw, src.ph, o.x0, o.y0, o.x1, o.y1, rect.x0, rect.y0, gw, gh].forEach((v, i) => { if ([0, 1, 4, 5, 6, 7, 8, 9].includes(i)) dv.setInt32(i * 4, v, true); else dv.setUint32(i * 4, v, true); });
        const invalid=pg.weather?.invalidRect;[invalid?.x0??1,invalid?.y0??1,invalid?.x1??0,invalid?.y1??0].forEach((v,i)=>dv.setInt32(48+i*4,v,true));
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
    const d = device(), S = GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC | GPUBufferUsage.COPY_DST, owned=[],mk = (n, l) => {const b=d.createBuffer({label: label + ' ' + l, size: Math.max(16, n), usage: S});owned.push(b);return b;};
    try{
    const set = {cells, F: mk(cells * 4 * PLANES, 'planes'), Mk: mk(cells * 28, 'masks'), W: mk(cells * 8, 'height'), M: [0, 1, 2].map(k => mk(cells * 4, 'map ' + k)), Fd: mk(cells * 16, 'material field')};
    set.bytes = cells * (4 * PLANES + 64); set.destroy = () => { set.F.destroy(); set.Mk.destroy(); set.W.destroy(); set.M.forEach(b => b.destroy()); set.Fd.destroy(); };
    return set;
    }catch(error){for(const b of owned)b.destroy();throw error;}
  }
  // The staging set the chunk bake reads, reused (grown, never shrunk): the queue is in order, so a later gather runs after an earlier bake's feed pass.
  function stagingFor(cells) {
    if (!staging || staging.cells < cells) { const old = staging; staging = makeSet(Math.max(cells, 700 * 850), 'feed staging'); old?.destroy(); }
    return staging;
  }

  let stagingPins=0,stagingDrops=0;
  let stagingChain=Promise.resolve();
  function prepareStaging(cells){
    const job=stagingChain.then(async()=>{
      if(staging&&staging.cells>=cells)return;
      const before=staging;
      try{await terrainAllocation(device(),()=>stagingFor(cells));}
      catch(error){if(staging!==before){staging?.destroy();staging=null;}throw error;}
    });
    stagingChain=job.catch(()=>{});return job;
  }

  // ---- reads
  const cropFrom = (rect, planes, masks, hBlend) => {
    const w = rect.x1 - rect.x0 + 1, h = rect.y1 - rect.y0 + 1, n = w * h, fields = {};
    FIELD_KEYS_FLOAT.forEach((k, p) => { fields[k] = planes.slice(p * n, (p + 1) * n); });
    if (hBlend) fields.h = hBlend;
    maskKeys.forEach((k, m) => { const out = new Int8Array(n); for (let i = 0; i < n; i++) { const word = masks[i * 7 + (m >> 2)]; out[i] = (word << (24 - (m & 3) * 8)) >> 24; } fields[k] = out; });
    return {fields, maskPlanes: maskKeys.map(k => fields[k]), gridWidth: w, gridHeight: h, gridSpacing: spacing, gridOrigin: [rect.x0 * spacing, rect.y0 * spacing], worldSize, worldGrid, revision, bytes: n * (4 * PLANES + maskKeys.length), rect: worldRect(rect)};
  };
  async function readRect(rect, {weather = true} = {}) {
    const wantWeather = weather && Boolean(time), lease = await prepareRect(rect, wantWeather);
    try {
      const passes = await feedPasses(device()), gw = rect.x1 - rect.x0 + 1, gh = rect.y1 - rect.y0 + 1, n = gw * gh, set = makeSet(n, 'read'), d = device();
      const weatherRevB=wantWeather?Math.min(...lease.pages.map(pg=>pg.weather?.revB??-1)):time?.revB;
      const enc = d.createCommandEncoder({label: 'read rect'}), tmp = encodeGather(enc, passes, rect, set, wantWeather);
      const stage = (b, bytes) => { const s = d.createBuffer({label: 'read stage', size: Math.max(16, bytes), usage: GPUBufferUsage.MAP_READ | GPUBufferUsage.COPY_DST}); enc.copyBufferToBuffer(b, 0, s, 0, bytes); return s; };
      const sF = stage(set.F, n * 4 * PLANES), sM = stage(set.Mk, n * 28), sW = wantWeather ? stage(set.W, n * 8) : null;
      d.queue.submit([enc.finish()]); lease.release();
      await Promise.all([sF, sM, sW].filter(Boolean).map(b => b.mapAsync(GPUMapMode.READ)));
      const planes = new Float32Array(sF.getMappedRange().slice(0)), masks = new Uint32Array(sM.getMappedRange().slice(0)), wt = sW ? new Float32Array(sW.getMappedRange().slice(0)) : null;
      [sF, sM, sW].forEach(b => b?.destroy()); set.destroy(); tmp.forEach(b => b.destroy());
      let blend = null;
      if (wt) { blend = new Float32Array(n); const base = wt.subarray(0, n), e = wt.subarray(n); for (let i = 0; i < n; i++) { const h = planes[i]; blend[i] = h + (e[i] - base[i]) * (1 - smooth(0, 10, Math.abs(h - base[i]))) * (1 - planes[2 * n + i]); } }
      return {...cropFrom(rect, planes, masks, blend),weatherRevB};
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
    if (!time || !pg.cpuW || !refinementValid(pg.cpuW.source?.invalidRect,ix,iy)) return h;
    const j = (iy - pg.y0) * CORE + ix - pg.x0, base = pg.cpuW.base[j];
    return h + (pg.cpuW.e[j] - base) * (1 - smooth(0, 10, Math.abs(h - base))) * (1 - pg.cpu.r[i]);
  };

  // ---- changes
  function changed(rect = null, keepPrefix = 0) {
    revision++; prep = new Map(); prepContext = null;
    check();
    const cr = rect ? clip(rect) : null, r = cr ? clip({x0: cr.x0 - 6, y0: cr.y0 - 6, x1: cr.x1 + 6, y1: cr.y1 + 6}) : null, event = {revision, rect: cr ? worldRect(cr) : null};
    const announce = event.rect;
    for (const pg of pagesMap.values()) {
      if (!r) {
        dropShape(pg);pg.staleSeq++;pg.shapeSeq++;pg.weatherSeq++;
        // A held whole-map shape row uses the same authored-first behavior as
        // a local stroke. Keep the weather allocation, invalidate its contents
        // for the gather, and refine once input is quiet.
        if(gesture()&&pg.weather){pg.weather.invalidRect=coreRect(pg);pg.stale=true;}
        else{dropWeather(pg);pg.stale=false;}
        continue;
      }
      if ((pg.weather||pg.weatherJob) && hits(windowRect(pg), {x0: r.x0 - 6, y0: r.y0 - 6, x1: r.x1 + 6, y1: r.y1 + 6})) { if(pg.weather)pg.weather.invalidRect=invalidateRefinement(pg.weather.invalidRect,r,worldGrid);pg.stale = true; pg.staleSeq++; pendingStale = pendingStale ? joinWorld(pendingStale, worldRect(r)) : worldRect(r); }
      // The spill's stamps: the window the Time pass actually reads (windowRect moved inside the world), and the shape page's whole buffer.
      if (hits(grow(weatherWindow(pg), 6), r)) { pg.weatherSeq++; spill.drop('w' + pg.key); }
      if (hits(bufRect(pg), r)) { pg.shapeSeq++; spill.drop('s' + pg.key); if (pg.target && engine) { late(pg, r); wantCpu(pg); } }
    }
    if (!r) spill.clear();
    if (!r) { pendingStale = gesture()?{x:0,y:0,width:worldSize-1,height:worldSize-1}:null; for (let py = 0; py < np; py++) for (let px = 0; px < np; px++) coarseAdd(page(px, py), null); }
    else for (const pg of overlapping(r)) coarseAdd(pg, announce);
    for (const fn of submitListeners) fn(event);
    return event;
  }
  // The gesture is over: the stale pages' region (for the canvas to rebake), and the deferred reads. The stale pages' Time pass starts now
  // (pumpWeather), not when a tile first asks for its page.
  function settle() {
    const out = pendingStale; pendingStale = null;
    for (const pg of pagesMap.values()) if (pg.target && !pg.cpu) wantCpu(pg);
    for (const pg of pagesMap.values()) if (pg.target && pg.cpuRev !== pg.rev) wantCpu(pg);
    if (time) pumpWeather();
    return out;
  }
  // After an edit, the stale pages' Time pass runs ahead of the tiles that read them, the page nearest the view first, one page at a time:
  // the job a tile's prepareRect would start (ensureWeather), so the result is the same, but the tiles of pages already done draw meanwhile,
  // and a tile that needs another page waits behind only the running one. It starts a page only when no Time pass runs, so two passes never
  // split the queue. A held gesture stops it; the next settle starts it again.
  let weatherPumping = false;
  async function pumpWeather() {
    if (weatherPumping) return; weatherPumping = true;
    try {
      while (time && !gesture()) {
        let best = null, bd = Infinity;
        for (const pg of pagesMap.values()) {
          if (!pg.stale || !pg.weather || pg.weatherJob) continue;
          const d = focus ? Math.hypot(pg.x0 + CORE / 2 - focus.x, pg.y0 + CORE / 2 - focus.y) : 0;
          if (d < bd) { bd = d; best = pg; }
        }
        if (!best) break;
        await time.quiet?.(); if (!time || gesture() || !best.stale || best.weatherJob) continue;   // after any running pass (the preview's own, a page a tile asked for)
        best.pins++;
        try { await ensureWeather(best); } finally { unpin(best); }
        await new Promise(r => setTimeout(r, 0));
      }
    } catch (err) { fail(err); }
    finally { weatherPumping = false; trim(); }
  }

  const stats = () => {
    const g = engine?.stats() || {}, resident = [...pagesMap.values()].filter(p => p.target).length, weathers = [...pagesMap.values()].filter(p => p.weather).length;
    return {revision, residentBytes: cpuBytes() + coarse.byteLength, cacheBytes: cpuBytes(), cacheEntries: resident, lastWorkingBytes: 0, peakBytes: cpuBytes(), budget: shapeBudget() + weatherBudget(), hits: 0, misses: 0, replays: 0, evictions: 0,
      chunkCells: CORE, worldSize, worldGrid, gridSpacing: spacing, bytesPerCell: PAGE_CELL, workspaceBytesPerCell: 0, maxWorkingCells: 0, pointSamples: 0, connectionTiles: 0, connectionCells: 0,
      gpuShape: {...g, gpuBytes: gpuBytes(), paged: true, core: CORE, ring: RING, ringChanges, apron: APRON, shapePages: resident, shapeEvals, weatherPages: weathers, pagesTotal: np * np, shapeBytes: shapeBytes(), weatherBytes: weatherBytes(), stagingBytes: stagingBytes(), stagingDrops, cpuCopyBytes: cpuBytes(), cpuCopiesPending: cpuWanted.size + cpuReading,
        coarse: {points: coarse.length, filled: coarseFilled, done: coarseDone, queued: coarseQueue.size, fullAt: coarseFullAt}, weatherRuns, weatherMsTotal, spill: {...spill.stats(), inFlight: spilling.size, shapeRestores, weatherRestores}, error: (error || firstError)?.message || null}};
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
    subscribe(fn) { listeners.add(fn); return () => listeners.delete(fn); }, subscribeSubmit(fn) { submitListeners.add(fn); return () => submitListeners.delete(fn); },
    stats, active: () => true,
    planes: () => null, engine: () => engine, gpuBuffers: () => null,
    gpuReady: () => Promise.resolve(), gpuQuiet: () => Promise.resolve(), gpuPending: () => false,
    settle,
    // the map canvas's feed: pages ready for `rect` (cells), and a gather to encode into the bake's encoder
    async feedSource(rect, wantWeather, {signal} = {}) {
      const lease = await prepareRect(rect, wantWeather && Boolean(time), signal);stagingPins++;
      try{await prepareStaging((rect.x1-rect.x0+1)*(rect.y1-rect.y0+1));signal?.throwIfAborted();}
      catch(error){stagingPins--;lease.release();throw error;}
      let released=false;const release=()=>{if(released)return;released=true;stagingPins--;lease.release();};
      const weather = wantWeather && Boolean(time),material=weather&&Boolean(time?.material);
      const weatherRevB=weather?Math.min(...lease.pages.map(pg=>pg.weather?.revB??-1)):null;
      return {paged: true, weather, weatherRevB, revision, release, maskCount: maskKeys.length,   // revision: the fields' revision the bake read (perf.mjs's move-to-picture latency)
        gather(enc, passes) {
          const gw = rect.x1 - rect.x0 + 1, gh = rect.y1 - rect.y0 + 1, set = stagingFor(gw * gh), tmp = encodeGather(enc, passes, rect, set, weather);
          return {planes: set.F, masks: set.Masks ?? set.Mk, weather: weather ? set.W : null, maps: weather ? set.M : null, field: material ? set.Fd : null, grid: gw, cells: gw * gh, tmp};
        }};
    },
    // Regional display sources do not use the canonical gather cache. Its
    // completed consumers release their leases before this memory is reclaimed.
    releaseStaging:()=>{if(stagingPins||!staging)return 0;const bytes=staging.bytes;staging.destroy();staging=null;stagingDrops++;return bytes;},
    setTime, timeOn: () => Boolean(time),
    setFocus: r => { focus = r; },
    // The authored heights at every COARSE-th cell once all of them are current (null while pages are queued), and a promise for the moment they are.
    coarseLattice: () => coarseComplete() ? {heights: coarse, width: coarseW, step: COARSE, revision} : null,
    coarseSettled: () => coarseComplete() ? Promise.resolve() : new Promise(resolve => coarseWaiters.push(resolve)),
    startCoarse: () => getEngine().then(() => { coarseStart = performance.now(); for (let py = 0; py < np; py++) for (let px = 0; px < np; px++) coarseAdd(page(px, py), null); }),
    debugGather: async rect => {
      const lease = await prepareRect(rect, true), passes = await feedPasses(device()), d = device(), n = (rect.x1 - rect.x0 + 1) * (rect.y1 - rect.y0 + 1), set = makeSet(n, 'dbg');
      const enc = d.createCommandEncoder(), tmp = encodeGather(enc, passes, rect, set, true); d.queue.submit([enc.finish()]); lease.release();
      const W = new Float32Array(await readBuffer(d, set.W, 0, n * 8)), maps = await Promise.all(set.M.map(b => readBuffer(d, b, 0, n * 4).then(x => new Uint8Array(x))));
      set.destroy(); tmp.forEach(b => b.destroy()); return {W, maps, n};
    },
    debugPages: () => [...pagesMap.values()].filter(p => p.weather).map(p => ({x0: p.x0, y0: p.y0, cw: p.cw, ch: p.ch, weather: p.weather.weather, maps: p.weather.maps, core: CORE})),
    pageInfo: () => ({np, core: CORE, need: lastNeed, ring: RING, apron: APRON, side: SIDE}),
    destroy() { for (const pg of pagesMap.values()) { dropShape(pg); dropWeather(pg); } spill.clear(); for (const s of spilling) s.destroy(); staging?.destroy(); scratchT?.destroy(); engine?.destroy(); },
  };
}

// ---- H6b: the feed passes (engine-feed.wgsl) ----
// Which bindings (group.binding) each entry point reads or writes: the pipelines take their layouts from the shader ('auto'), which holds only
// the bindings an entry point uses, so a bind group must carry exactly these.
const FEED_USES = {
  seedMain: ['0.0', '0.1', '0.2', '1.0', '1.1', '1.2', '1.3', '1.10'], tileFlagMain: ['0.0', '1.3', '1.4'], tileListMain: ['0.0', '1.4', '1.5', '1.6'],
  tileArgsMain: ['1.6', '1.7'], refinedMain: ['0.0', '1.8', '1.9'],
  // The Time pass's own cells (sculpt-erosion.js runCoarse)
  timeDownMain: ['0.0', '0.1', '0.2', '3.15', '3.16'], timeUpHeightMain: ['0.0', '3.17', '3.21'], timeUpMapsMain: ['0.0', '3.18', '3.19', '3.20', '3.22', '3.23', '3.24', '3.25'],
  feedMain: ['0.0', '0.1', '0.2', '2.0', '2.1', '2.2', '2.3', '2.4', '2.5', '2.6', '2.7', '2.8', '2.9'],
  // H5b: the gather from pages
  gatherShape: ['3.0', '3.1', '3.2', '3.3', '3.4'], gatherHeight: ['3.0', '3.5', '3.6'], gatherMaps: ['3.0', '3.7', '3.8', '3.9', '3.10', '3.11', '3.12'], gatherField: ['3.0', '3.13', '3.14']};
const feedCache = new WeakMap();
// {pipes, groups(entry, resources)}: resources maps 'group.binding' to a binding resource; groups() returns [[index, bindGroup]...].
export function feedPasses(device) {
  let cached = feedCache.get(device);
  if (cached) return cached;
  cached = (async () => {
    const module = device.createShaderModule({label: 'engine-feed', code: await (await fetch('engine-feed.wgsl')).text()});
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
// The feed passes' uniform (struct FU of engine-feed.wgsl): 20 words.
export function feedUniform(device, f) {
  const buffer = device.createBuffer({label: 'feed uniform', size: 80, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST}), dv = new DataView(new ArrayBuffer(80));
  const u = ['grid', 'cells', 'ox', 'oy', 'gw', 'gh', 'cw', 'ch', 'mode', 'rateMask'], fl = ['sea', 'spacing', 'envelope'];
  u.forEach((k, i) => { if (['ox', 'oy'].includes(k)) dv.setInt32(i * 4, f[k] ?? 0, true); else dv.setUint32(i * 4, (f[k] ?? 0) >>> 0, true); });
  fl.forEach((k, i) => dv.setFloat32((10 + i) * 4, f[k] ?? 0, true));
  dv.setUint32(13 * 4, f.tilesWide ?? 0, true);
  const r=f.invalidRect;[r?.x0??1,r?.y0??1,r?.x1??0,r?.y1??0].forEach((v,i)=>dv.setInt32(64+i*4,v,true));
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
