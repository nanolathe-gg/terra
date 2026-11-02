// H6 (Green): shape on the GPU. Compute passes that evaluate Green's brushes (paint, erase, deep, shallow, mountain, hill, ground)
// over a rectangle of the map, beside the JS engine in sculpt.js. Every pass is one thread per cell; a thread reads and writes only
// its own cell of the field planes, so the planes are updated in place and no snapshot is needed. The hill's softening blur is the
// one neighbourhood step (two box blurs of radius 2 on the scratch weights, edge-clamped like the JS `blurred`).
//
// Arithmetic follows sculpt.js (`dab`, `settleHill`, `groundHeight`, `valueNoise`) line for line, in f32. The host (sculpt-gpu-fields.js)
// does the path preparation in JS (simplify, corner rounding, frames, boxes) and passes the capsule list, so the segments are
// bit-identical to the JS engine's. The marker below is replaced by the host with the uniform struct it fills.
//
// Planes: F holds h p r c v x as six f32 planes. Mk holds the 25 mask planes as int8, packed per cell (7 words a cell) so one thread
// owns every byte it writes. Nz is the node's noise tables (7 fields), Sc three scratch planes (weights, tmp, joined).
/*NODE_STRUCT*/

@group(0) @binding(0) var<uniform> u: Node;
@group(0) @binding(1) var<storage, read_write> F: array<f32>;
@group(0) @binding(2) var<storage, read_write> Mk: array<u32>;
@group(0) @binding(3) var<storage, read_write> Nz: array<f32>;
@group(0) @binding(4) var<storage, read_write> Sc: array<f32>;
@group(0) @binding(5) var<storage, read> Seg: array<vec4f>;
@group(0) @binding(6) var<storage, read> MW: array<vec4f>;
@group(0) @binding(7) var<storage, read_write> Out: array<u32>;
// H6c: point reads (the prefix height a node reads at its points), one f32 each, written by pointRead and read by stampN (PT: PR is the routes plane).
@group(0) @binding(8) var<storage, read_write> PT: array<f32>;

const PH = 0u; const PP = 1u; const PR = 2u; const PC = 3u; const PV = 4u; const PX = 5u;

// (wavelength 1, weight 1, wavelength 2, weight 2) and (salt 1, salt 2) of NOISE_FIELDS: x y detail coastX coastY coastWidth shelf.
var<private> NZ: array<vec4f, 7> = array<vec4f, 7>(
  vec4f(95.0, 0.7, 37.0, 0.3), vec4f(95.0, 0.7, 37.0, 0.3), vec4f(64.0, 0.65, 23.0, 0.35), vec4f(210.0, 0.65, 75.0, 0.35),
  vec4f(210.0, 0.65, 75.0, 0.35), vec4f(180.0, 0.65, 55.0, 0.35), vec4f(170.0, 0.75, 48.0, 0.25));
var<private> NS: array<vec2u, 7> = array<vec2u, 7>(
  vec2u(0x1863u, 0x32a7u), vec2u(0x73c1u, 0x9e15u), vec2u(0x5b39u, 0x2ac9u), vec2u(0x5e17u, 0x37abu),
  vec2u(0x84d1u, 0x192fu), vec2u(0x73b9u, 0x4f25u), vec2u(0x986du, 0x62f3u));

fn hashi(x: i32, y: i32, s: u32) -> f32 {
  var n = (bitcast<u32>(x) * 374761393u) ^ (bitcast<u32>(y) * 668265263u) ^ s;
  n = (n ^ (n >> 13u)) * 1274126177u;
  return f32(n ^ (n >> 16u)) / 4294967295.0 * 2.0 - 1.0;
}
fn sm(a: f32, b: f32, v: f32) -> f32 { let t = clamp((v - a) / (b - a), 0.0, 1.0); return t * t * (3.0 - 2.0 * t); }
fn vnoise(x: f32, y: f32, s: u32) -> f32 {
  let fx = floor(x); let fy = floor(y);
  let ix = i32(fx); let iy = i32(fy);
  let tx = sm(0.0, 1.0, x - fx); let ty = sm(0.0, 1.0, y - fy);
  let a = hashi(ix, iy, s); let b = hashi(ix + 1, iy, s); let c = hashi(ix, iy + 1, s); let d = hashi(ix + 1, iy + 1, s);
  return (a + (b - a) * tx) * (1.0 - ty) + (c + (d - c) * tx) * ty;
}
fn noiseValue(f: u32, s: u32, x: f32, y: f32) -> f32 {
  let w = NZ[f]; let k = NS[f];
  return w.y * vnoise(x / w.x, y / w.x, s ^ k.x) + w.w * vnoise(x / w.z, y / w.z, s ^ k.y);
}

fn gcells() -> u32 { return u.grid * u.grid; }

#ifdef PAGES
// H5b: the planes may be a page: a pw x ph block of the map whose first cell is (ox, oy) in the world lattice (a whole map: ox = oy = 0, pw = ph = grid, so
// every index below is the old y * grid + x). x, y stay world lattice coordinates; u.grid stays the whole map's size, which clamps and bounds the lattice.
fn lidx(x: i32, y: i32) -> u32 { return u32(y - u.oy) * u.pw + u32(x - u.ox); }
fn pcells() -> u32 { return u.pw * u.ph; }

// H5b (direct != 0): the node's noise at a lattice cell, evaluated where the table would have stored it (the `noise` pass's own arithmetic), so a page
// holds no tables: stamp reads them at the nearest point of each capsule, which is as far away as the node's extent.
fn noiseCell(f: u32, ix: i32, iy: i32) -> f32 {
    let n = u.grid;
    var px = f32(ix) * u.spacing; var py = f32(iy) * u.spacing;
    if (u.framed != 0u) {
        let lx = u.inv0 * px + u.inv2 * py + u.inv4; let ly = u.inv1 * px + u.inv3 * py + u.inv5;
        let gx = floor(lx / u.spacing + 0.5); let gy = floor(ly / u.spacing + 0.5);
        let inside = gx >= 0.0 && gy >= 0.0 && gx < f32(n) && gy < f32(n);
        px = select(lx, gx * u.spacing, inside); py = select(ly, gy * u.spacing, inside);
    }
    return noiseValue(f, u.seed, px, py);
}
fn nzCell(f: u32, x: i32, y: i32, i: u32, cells: u32) -> f32 {
  if (u.direct != 0u) { return noiseCell(f, x, y); }
  return Nz[f * cells + i];
}
fn nzAt(f: u32, ix: i32, iy: i32, cells: u32) -> f32 {
    if (u.direct != 0u) { return noiseCell(f, ix, iy); }
    return Nz[f * cells + u32(iy) * u.grid + u32(ix)];
}

#endif
// The node's noise tables over the rectangle: a framed node reads the world lattice through the inverse frame, quantised to the
// nearest cell (Math.round: half up) and evaluated directly off the map, as framedNoise does; an unframed one is the world field.
@compute @workgroup_size(8, 8)
fn noise(@builtin(global_invocation_id) g: vec3u) {
  let x = u.rx0 + i32(g.x); let y = u.ry0 + i32(g.y);
  if (x > u.rx1 || y > u.ry1) { return; }
#ifdef PAGES
  let n = u.grid; let i = lidx(x, y);
#else
  let n = u.grid; let i = u32(y) * n + u32(x);
#endif
  var px = f32(x) * u.spacing; var py = f32(y) * u.spacing;
  if (u.framed != 0u) {
    let lx = u.inv0 * px + u.inv2 * py + u.inv4; let ly = u.inv1 * px + u.inv3 * py + u.inv5;
    let gx = floor(lx / u.spacing + 0.5); let gy = floor(ly / u.spacing + 0.5);
    let inside = gx >= 0.0 && gy >= 0.0 && gx < f32(n) && gy < f32(n);
    px = select(lx, gx * u.spacing, inside); py = select(ly, gy * u.spacing, inside);
  }
#ifdef PAGES
  let cells = pcells();
#else
  let cells = n * n;
#endif
  for (var f = 0u; f < 7u; f++) { Nz[f * cells + i] = noiseValue(f, u.seed, px, py); }
}

// sample() of the JS engine: a bilinear read of one noise table, clamped to the lattice.
fn sampleN(f: u32, x: f32, y: f32) -> f32 {
#ifdef PAGES
  let n = u.grid; let top = f32(n - 1u);
#else
  let n = u.grid; let cells = n * n; let top = f32(n - 1u);
#endif
  let gx = clamp(x / u.spacing, 0.0, top); let gy = clamp(y / u.spacing, 0.0, top);
  let ix = u32(floor(gx)); let iy = u32(floor(gy));
  let jx = min(ix + 1u, n - 1u); let jy = min(iy + 1u, n - 1u);
  let fx = gx - f32(ix); let fy = gy - f32(iy);
#ifdef PAGES
  let cells = n * n;   // the table's plane size (a whole map only; a page evaluates directly)
  let a = nzAt(f, i32(ix), i32(iy), cells); let b = nzAt(f, i32(jx), i32(iy), cells);
  let c = nzAt(f, i32(ix), i32(jy), cells); let d = nzAt(f, i32(jx), i32(jy), cells);
  return (a * (1.0 - fx) + b * fx) * (1.0 - fy) + (c * (1.0 - fx) + d * fx) * fy;
#else
  let o = f * cells;
  return (Nz[o + iy * n + ix] * (1.0 - fx) + Nz[o + iy * n + jx] * fx) * (1.0 - fy)
       + (Nz[o + jy * n + ix] * (1.0 - fx) + Nz[o + jy * n + jx] * fx) * fy;
#endif
}

fn maskGet(i: u32, p: u32) -> i32 {
  let w = Mk[i * 7u + (p >> 2u)]; var v = i32((w >> ((p & 3u) * 8u)) & 255u);
  if (v > 127) { v = v - 256; }
  return v;
}
fn maskSet(i: u32, p: u32, v: i32) {
  let at = i * 7u + (p >> 2u); let sh = (p & 3u) * 8u;
  let w = Mk[at];
  Mk[at] = (w & ~(255u << sh)) | ((bitcast<u32>(v) & 255u) << sh);
}

// H15 part 2: one curve. The host samples a stroke's curve (height share against distance share from the foot, 0..1) at CV_N + 3 even steps, one step
// before the foot to one past the top, into MW after the node's extra rows, four samples to a row. curveAt reads it with Catmull-Rom interpolation (linear
// steps put visible slope kinks into the lighting). `off` is u.curveBase or u.backBase, relative to the node's rows past its mask writes.
/*CV_N*/
fn cvAt(at: u32, k: u32) -> f32 { return MW[at + (k >> 2u)][k & 3u]; }
fn curveRaw(off: u32, t: f32) -> f32 {
  let at = u.mwBase + u.nwrites + off;
  let x = clamp(t, 0.0, 1.0) * CV_N; let k = min(u32(x), u32(CV_N) - 1u); let f = x - f32(k);
  let p0 = cvAt(at, k); let p1 = cvAt(at, k + 1u); let p2 = cvAt(at, k + 2u); let p3 = cvAt(at, k + 3u);
  return p1 + 0.5 * f * (p2 - p0 + f * (2.0 * p0 - 5.0 * p1 + 4.0 * p2 - p3 + f * (3.0 * (p1 - p2) + p3 - p0)));
}
// A curve leaves 0..1 only when the host says it has a lip (u.cvLip): above 1 on land, below 0 on water; the excess is kept for the kind's lift.
fn keepLip(c: f32) -> f32 { return select(clamp(c, 0.0, 1.0), c, u.cvLip != 0u); }
fn curveAt(off: u32, t: f32) -> f32 { return keepLip(curveRaw(off, t)); }

// One thread per cell: every capsule of the node in order. Kinds: 0 paint 1 erase 2 deep 3 shallow 4 mountain 5 hill.
// A hill with settle != 0 only writes its raw weights (Sc plane 0); blur and compose passes finish it.
// H9 parametric cross-section, after H15 part 2: the curve is a host table (curveAt); what stays here is the terraces on the curve's value (terraced)
// and the face share a cell's reach gives the curve (faceOf).
fn terraceLevel(m: u32, n: u32, nA: f32, nB: f32) -> f32 {
  let fm = f32(m); let fnn = f32(n);
  var j = 0.0;
  if (m > 0u && m < n) { j = u.sJit * 0.3 / fnn * (nA * cos(2.4 * fm + 1.0) + nB * sin(2.4 * fm + 1.0)); }
  return fm / fnn + j;
}
fn terrace(g: f32, n: u32, nj: f32, nA: f32, nB: f32) -> f32 {
  let fnn = f32(n);
  let a = clamp(u.sJit * nj, -0.22 * fnn, 0.22 * fnn);
  let q = g * fnn + a * 4.0 * g * (1.0 - g);
  let k = u32(max(0.0, min(floor(q), fnn - 1.0)));
  let lo = terraceLevel(k, n, nA, nB); let hi = terraceLevel(k + 1u, n, nA, nB);
  return lo + (hi - lo) * sm(u.sFlat, 1.0, q - f32(k));
}
// Terraces on the curve's value over the whole of 0..1; a lip's excess (outside 0..1) rides on top untouched.
fn terraced(c: f32, x: i32, y: i32, i: u32, cells: u32) -> f32 {
  if (u.sSteps == 0u) { return c; }
  let g = clamp(c, 0.0, 1.0);
  if (g <= 0.0 || g >= 1.0) { return c; }
  return terrace(g, u.sSteps, nzF(3u, x, y, i, cells), nzF(4u, x, y, i, cells), nzF(0u, x, y, i, cells)) + (c - g);
}
// The share of its reach the curve covers at a cell, foot to top (flat beyond): the kind's own share `own` (1 minus the shoulder, or 1), or facePx, kept
// that wide whatever the stroke's size, wandering with the cell's width noise (kw, shared by the whole face) and stretched by the lean.
fn faceOf(own: f32, reach: f32, nCW: f32, leaned: f32) -> f32 {
  if (u.facePx <= 0.0) { return own; }
  let kw = clamp(1.0 + 0.5 * u.faceVar * nCW, 0.4, 1.8);
  return min(u.facePx * kw * leaned / reach, 0.98);
}
// The height lumps: the stroke's height wanders by rough times its two noise fields (nCW, nDet) at the host's weights hgtA and hgtB.
fn lumps(nCW: f32, nDet: f32) -> f32 { return 1.0 + u.rough * (u.hgtA * nCW + u.hgtB * nDet); }
// How far a cell lies toward the side the stroke leans (0..1: the cosine between the stroke's bearing and the direction from the stroke to the cell, never
// below 0). The lean side is a map bearing (bearX, bearY) or, with leanSide, the left (+1) or right (-1) of the drawn direction (none on a point).
fn leanToward(ddx: f32, ddy: f32, sx: f32, sy: f32, span2: f32) -> f32 {
  var bx = u.bearX; var by = u.bearY;
  if (u.leanSide != 0.0) {
    if (span2 <= 0.0) { return 0.0; }
    let len = sqrt(span2); bx = u.leanSide * sy / len; by = -u.leanSide * sx / len;
  }
  return max(0.0, (ddx * bx + ddy * by) / max(1e-3, sqrt(ddx * ddx + ddy * ddy)));
}

// H9: a landform's or water stroke's mask writes, once the node is settled: plane, target, gain, flat per write (maskSetup/paintCell of sculpt.js).
fn shapeMasks(i: u32, f: f32) {
  for (var m = 0u; m < u.nwrites; m++) {
    let mw = MW[u.mwBase + m]; let pl = u32(mw.x); let b = f32(maskGet(i, pl));
    var k = f * mw.z; if (mw.w != 0.0) { k = 1.0; }
    maskSet(i, pl, i32(floor(b + (mw.y - b) * k + 0.5)));
  }
}
// H9 ridge piece: the height multiplier at t along a piece (h0 -> h1), then the jagged crest (ridgeRise in sculpt.js).
fn craterLobe(R: f32, rough: f32, seed: u32, lx: f32, ly: f32) -> f32 {
  let sc = max(R * 0.55, 8.0);
  return 1.0 + rough * (0.38 * vnoise(lx / (R * 0.95), ly / (R * 0.95), seed ^ 0x4a7u) + 0.22 * vnoise(lx / sc, ly / sc, seed ^ 0x1c3u) + 0.1 * vnoise(lx / (sc * 0.6), ly / (sc * 0.6), seed ^ 0x2d9u));
}
fn ridgeRise(h0: f32, h1: f32, jag: f32, t: f32, lx: f32, ly: f32, wx: f32, wy: f32) -> f32 {
  var h = h0 + (h1 - h0) * t;
  // A crater's spurs fade out toward the bowl: none start inside the rim (u.hole: the crater's centre, radius, roughness and seed).
  if (u.hole != 0u) { let rr = sqrt((wx - u.hx) * (wx - u.hx) + (wy - u.hy) * (wy - u.hy)) / (u.hR * craterLobe(u.hR, u.hRough, u.hSeed, lx, ly)); h = h * sm(0.92, 1.2, rr); }
  if (jag > 0.0) {
    let R = u.radius;
    let n = 0.6 * vnoise(lx / (R * 0.28), ly / (R * 0.28), u.seed ^ 0x6b1u) + 0.4 * vnoise(lx / (R * 0.11), ly / (R * 0.11), u.seed ^ 0x1d7u);
    h = h * (1.0 - jag * 0.6 * (0.5 - 0.5 * n));
  }
  return h;
}
// H9 crater rim sectors and gaps (rimSetup/rimFactors in sculpt.js): the sectors' [angle, height, width, angle relative to the first] and the gaps' angles
// are in MW after the node's mask writes; returns (height factor, width factor) at the angle `ang` round the ring.
fn rimFactors(ang: f32) -> vec2f {
  let tau = 6.283185307179586; let n = u.nSect; let base = u.mwBase + u.nwrites;
  var h = 1.0; var w = 1.0;
  if (n > 1u) {
    let a0 = MW[base].x;
    let d = ((ang - a0) % tau + tau) % tau;
    var i = 0u; while (i < n - 1u && MW[base + i + 1u].w <= d) { i = i + 1u; }
    let j = (i + 1u) % n;
    var nextRel = tau; if (i < n - 1u) { nextRel = MW[base + i + 1u].w; }
    let span = nextRel - MW[base + i].w; let t = sm(0.0, 1.0, (d - MW[base + i].w) / max(span, 1e-6));
    h = MW[base + i].y + (MW[base + j].y - MW[base + i].y) * t; w = MW[base + i].z + (MW[base + j].z - MW[base + i].z) * t;
  }
  for (var g = 0u; g < u.nGap; g++) {
    let ga = MW[base + n + g].x;
    let dist = abs((((ang - ga + 3.141592653589793) % tau) + tau) % tau - 3.141592653589793);
    h = h * (0.08 + 0.92 * sm(0.5 * u.gapHw, u.gapHw, dist));
  }
  return vec2f(h, w);
}
fn nzF(f: u32, x: i32, y: i32, i: u32, cells: u32) -> f32 {
#ifdef PAGES
  return nzCell(f, x, y, i, cells);
#else
  return Nz[f * cells + i];
#endif
}

// H9 outline displacement: baseVary (Desert's ragged feet) and moonLobes (Moon's folded outline) are one function with two parameter sets (u.ol*).
// It returns the shift of r in radius units; the caller divides by width * bankScale. Window: smoothstep(olLo, olHi, r), or 1 for an offset (olFlat).
fn outlineShift(r: f32, lx: f32, ly: f32) -> f32 {
  if (u.olAmp <= 0.0) { return 0.0; }
  var win = 1.0;
  if (u.olFlat == 0u) { win = sm(u.olLo, u.olHi, r); }
  var n = u.olW0 * vnoise(lx / u.olL0, ly / u.olL0, u.seed ^ u.olS0) + u.olW1 * vnoise(lx / u.olL1, ly / u.olL1, u.seed ^ u.olS1);
  if (u.olW2 > 0.0) { n = n + u.olW2 * vnoise(lx / u.olL2, ly / u.olL2, u.seed ^ u.olS2); }
  return u.olAmp * win * n;
}
// baseBump: lumps on the apron and lower face, added to the value of a plateau, offset, hill or mountain (baseBumps in sculpt.js).
fn baseBump(lx: f32, ly: f32, w: f32) -> f32 {
  if (u.bpAmp <= 0.0) { return 0.0; }
  let off = u.bpOffset != 0u;
  return u.bpAmp * sm(0.03, select(0.12, 0.2, off), w) * select(1.0 - sm(0.12, 0.3, w), 1.0, off)
    * (0.55 * vnoise(lx / 30.0, ly / 30.0, u.seed ^ 0x4c91u) + 0.3 * vnoise(lx / 13.0, ly / 13.0, u.seed ^ 0x1a77u) + 0.25 * vnoise(lx / 6.5, ly / 6.5, u.seed ^ 0x63d9u));
}

@compute @workgroup_size(8, 8)
fn stamp(@builtin(global_invocation_id) g: vec3u) {
  let x = u.rx0 + i32(g.x); let y = u.ry0 + i32(g.y);
  if (x > u.rx1 || y > u.ry1) { return; }
#ifdef PAGES
  let n = u.grid; let cells = pcells(); let i = lidx(x, y);
#else
  let n = u.grid; let cells = n * n; let i = u32(y) * n + u32(x);
#endif
  let wx = f32(x) * u.spacing; let wy = f32(y) * u.spacing;
  var lx = wx; var ly = wy;
  if (u.framed != 0u) { lx = u.inv0 * wx + u.inv2 * wy + u.inv4; ly = u.inv1 * wx + u.inv3 * wy + u.inv5; }
  let kind = u.kind;
  let shouldered = kind == 5u && u.plain == 0u;   // H9: a hill with a cross-section or ridge options is the plain swept hill, like the mountain (startStroke)
  let coastal = kind == 0u || kind == 1u || (kind == 2u && u.natural != 0u);
  let fxF = select(0u, 3u, coastal); let fyF = select(1u, 4u, coastal);
#ifdef PAGES
  let nzx = nzCell(fxF, x, y, i, cells); let nzy = nzCell(fyF, x, y, i, cells);
  let nCW = nzCell(5u, x, y, i, cells); let nDet = nzCell(2u, x, y, i, cells); let nShelf = nzCell(6u, x, y, i, cells);
#else
  let nzx = Nz[fxF * cells + i]; let nzy = Nz[fyF * cells + i];
  let nCW = Nz[5u * cells + i]; let nDet = Nz[2u * cells + i]; let nShelf = Nz[6u * cells + i];
#endif
  let radius = u.radius;
  var best = -1.0e30; var bc = 0.0; var br = 0.0; var bcore = 0.0; var dist = 3.0e38; var visited = false;
  for (var k = 0u; k < u.nseg; k++) {
    let s0 = Seg[(u.segBase + k) * 4u]; let s1 = Seg[(u.segBase + k) * 4u + 1u]; let s2 = Seg[(u.segBase + k) * 4u + 2u];
    let bx = bitcast<vec4<i32>>(Seg[(u.segBase + k) * 4u + 3u]);
    if (x < bx.x || x > bx.z || y < bx.y || y > bx.w) { continue; }
    let px = s0.x; let py = s0.y;
    let sx = s0.z - px; let sy = s0.w - py;
    let span2 = sx * sx + sy * sy;
    var t = 0.0;
    if (span2 > 0.0) { t = clamp(((wx - px) * sx + (wy - py) * sy) / span2, 0.0, 1.0); }
    let cx = px + sx * t; let cy = py + sy * t;
    if (shouldered) {
      let d2 = (wx - cx) * (wx - cx) + (wy - cy) * (wy - cy);
      if (d2 > dist) { continue; }
      dist = d2;
    }
    var ex = nzx; var ey = nzy;
    if (span2 > 0.0) { ex = nzx - sampleN(fxF, cx, cy); ey = nzy - sampleN(fyF, cx, cy); }
    else { ex = nzx - s2.x; ey = nzy - s2.y; }
    // A ridge piece scales the outline wobble by its mean width (dab(): amp * pc.mean).
    var ampK = u.amp; if (u.ridge != 0u) { ampK = u.amp * (s1.x + s1.y) * 0.5; }
    let dx = wx - cx + ampK * (u.rotX * ex - u.rotY * ey);
    let dy = wy - cy + ampK * (u.rotY * ex + u.rotX * ey);
    var width = 1.0;
    if (u.wK != 0.0) { width = clamp(1.0 + u.rough * u.wK * nCW, u.wLo, u.wHi); }
    var reach = radius * width * u.bankScale;
    if (u.ridge != 0u) { reach = reach * (s1.x + (s1.y - s1.x) * t); }
    // Lean: the slope toward the lean side runs leanK of its length longer (shorter below 0): the reach stretches, or on a kind with a shoulder the face does.
    var leaned = 1.0;
    if (!shouldered && u.leanK != 0.0) { let ln = leanToward(wx - cx, wy - cy, sx, sy, span2); leaned = 1.0 + u.leanK * ln * ln; }
    if (kind >= 2u) { reach = reach * leaned; }
    var r = sqrt(dx * dx + dy * dy) / reach;
    var lobe = 0.0;
    if (u.olAmp > 0.0) { let shift = outlineShift(r, lx, ly) / (width * u.bankScale); r = r - shift; if (u.olMoon != 0u) { lobe = shift; } }
    // Dry bank (bankPx): the dry part of the outline radius, from this cell's waterline out, is stretched to bankPx; reads only the cell's own prefix height.
    if (u.bankFlat > 0.0 && F[PH * cells + i] > u.sea) {
      let pre = F[PH * cells + i];
      let bed = u.sea + select(-7.0, -55.0, kind == 2u) + select(0.0, 42.0 * sm(-0.15, 0.55, nShelf) * u.shelves, kind == 2u && u.natural != 0u);
      let yy = 1.0 - (pre - u.sea) / (pre - bed);
      let rw = 0.1 + 0.9 * (0.5 - sin(asin(clamp(1.0 - 2.0 * yy, -1.0, 1.0)) / 3.0));
      if (r > rw) { r = rw + (r - rw) * (1.0 - rw) * radius * width * u.bankScale / u.bankFlat; }
    }
    var core = 0.0;
    if (kind == 2u && u.natural != 0u) { core = 1.0 - sm(0.20, u.coreEdge, sqrt((wx - cx) * (wx - cx) + (wy - cy) * (wy - cy)) / radius); }
    if (r >= 1.0 && core == 0.0 && !shouldered) { continue; }
    // The curve's raw value c: a lip is c above 1 on land or below 0 on water, split off after the loop (w = clamp(c), the rest lifts the value).
    var c = 0.0;
    if (kind == 0u || kind == 1u) {
      // Plateau-like edge: a broad-scale face-width variation, the north foreshortening term, then the shoulder.
      let broad = vnoise(lx / (radius * 1.3), ly / (radius * 1.3), u.seed ^ 0x5f1u);
      let shoulder0 = clamp(0.56 + u.rough * (nDet + 0.30 * nCW) + u.faceVar * 0.22 * broad, 0.18, 0.88);
      let shoulder = clamp(shoulder0 - (u.softness - 0.5) * 0.6 - 0.32 * (leaned - 1.0), 0.12, 0.90);
      c = curveAt(u.curveBase, (1.0 - r) / faceOf(1.0 - shoulder, reach, nCW, leaned));
    } else if (kind == 2u || kind == 3u) {
      c = curveAt(u.curveBase, (1.0 - r) / faceOf(0.9, reach, nCW, leaned));
    } else if (kind == 5u && shouldered) {
      var face = vec2f(u.faceX, u.faceY);
      if (span2 > 0.0) { let len = sqrt(span2); face = vec2f(-sy / len * u.faceSide, sx / len * u.faceSide); }
      var fx = face.x; var fy = face.y;
      if (s2.z > 0.5) {
        fx = s1.x * (1.0 - t) + s1.z * t; fy = s1.y * (1.0 - t) + s1.w * t;
        let len = sqrt(fx * fx + fy * fy);
        if (len > 1e-5) { fx = fx / len; fy = fy / len; } else { fx = face.x; fy = face.y; }
      }
      let localRadius = radius * (1.0 + u.rough * 0.75 * nShelf + lobe);
      let uu = (dx * fx + dy * fy) / localRadius;
      let vv = (-dx * fy + dy * fx) / localRadius;
      let cross = uu - u.rough * 0.18 * nDet;
      let along = cross / select(u.faceWidth, u.backWidth, cross < 0.0);
      let side2 = 1.0 - along * along;
      if (side2 > vv * vv) {
        let q = 1.0 - vv * vv / side2;
        // The face side reads the front curve over faceWidth, the back side the back curve over sBack (the lean) times that.
        if (cross >= 0.0) { c = curveAt(u.curveBase, 1.0 - cross / u.faceWidth) * q * q; }
        else { c = curveAt(u.backBase, 1.0 + cross / (u.sBack * u.faceWidth)) * q * q; }
      }
    } else {
      c = curveAt(u.curveBase, (1.0 - r) / faceOf(1.0, reach, nCW, leaned));
    }
    c = terraced(c, x, y, i, cells);
    if (u.ridge != 0u) { c = c * ridgeRise(s1.z, s1.w, s2.w, t, lx, ly, wx, wy); }
    if (kind == 4u || (kind == 5u && !shouldered)) { c = keepLip(c * lumps(nCW, nDet)); }
    let key = select(max(c, core), c, core == 0.0);
    if (!shouldered && (key <= best || (c == 0.0 && core == 0.0))) { continue; }
    best = key; bc = c; br = r; bcore = core; visited = true;
  }
  if (!visited) {
    if (u.settle != 0u) { Sc[i] = 0.0; }
    return;
  }
  if (u.settle != 0u) { Sc[i] = best; return; }
  let w = clamp(bc, 0.0, 1.0); let ex = bc - w; let influence = max(w, bcore);
  if (u.coPutW != 0u) { Sc[4u * cells + i] = influence; }   // H10: the footprint the coast pass guards its crossings with (CW)
  let base = F[PH * cells + i];
  var value = base; var lift = 0.0;
  let pbase = F[PP * cells + i];
  if (kind == 0u) {
    let f = w * u.amountPct;
    for (var m = 0u; m < u.nwrites; m++) {
      let mw = MW[u.mwBase + m]; let pl = u32(mw.x); let b = f32(maskGet(i, pl));
      maskSet(i, pl, i32(floor(b + (mw.y - b) * f * mw.z + 0.5)));
    }
  } else if (kind == 1u) {
    value = base + (u.baseH - base) * w;
    F[PC * cells + i] = F[PC * cells + i] * (1.0 - w);
    F[PV * cells + i] = F[PV * cells + i] * (1.0 - w);
    F[PX * cells + i] = F[PX * cells + i] * (1.0 - w);
    for (var m = 0u; m < u.nwrites; m++) {
      let mw = MW[u.mwBase + m]; let pl = u32(mw.x); let b = f32(maskGet(i, pl));
      maskSet(i, pl, i32(floor(b + (mw.y - b) * w * mw.z + 0.5)));
    }
  } else if (kind == 4u) {
    value = base + u.amount * w + baseBump(lx, ly, w);
    lift = u.amount * ex;
  } else if (kind == 5u) {
    var mult = 1.0;
    if (u.plain == 0u) { mult = lumps(nCW, nDet); }
    value = base + u.amount * w * mult + baseBump(lx, ly, w);
    lift = u.amount * ex * mult;
  } else {
    var bed = u.sea + select(-7.0, -55.0, kind == 2u);
    if (kind == 2u && u.natural != 0u) { bed = bed + 42.0 * (sm(-0.15, 0.55, nShelf) * sm(0.08, 0.50, br)) * u.shelves; }
    value = base + (bed - base) * w;
    lift = (bed - base) * ex;   // a water lip is the curve below 0: the ground stands above where it was
    if (kind == 2u && u.natural != 0u && bcore != 0.0) { value = min(value, base + (u.sea - 55.0 - base) * bcore); }
    if (u.beachFlat != 0.5 && base > u.sea && base <= u.baseH + 1.0 && value > u.sea) {
      let above = (value - u.sea) / (base - u.sea);
      value = u.sea + (base - u.sea) * pow(above, exp2((u.beachFlat - 0.5) * 2.4));
    }
    if (kind == 3u && u.passage != 0u) { value = max(base, value); }
  }
  value = value + lift;
  F[PH * cells + i] = clamp(value, u.minH, u.maxH);
  if (kind >= 2u && u.nwrites > 0u && influence > 0.0) { shapeMasks(i, influence); }
  // Routes open where the height changed; protection follows the kind (a cover brush leaves it alone).
  if (kind != 0u && influence > 0.0) { F[PR * cells + i] = F[PR * cells + i] * (1.0 - influence); }
  if (kind == 3u && u.passage != 0u && value == base) { }
  else if (kind == 3u) { F[PP * cells + i] = max(pbase * (1.0 - w), sm(0.65, 0.95, w)); }
  else if (kind != 0u) { F[PP * cells + i] = pbase * (1.0 - influence); }
  // applyCracks: a hill or mountain marks where cracks may open.
  if ((kind == 4u || kind == 5u) && u.crackAmt > 0.0 && influence > 0.0) {
    F[PC * cells + i] = max(F[PC * cells + i], min(1.0, influence * 1.6) * u.crackAmt);
  }
}

// settleHill's blur: a box of blurR cells either side (2 at the final grid; the host scales it with the spacing), clamped at the map edge, from scratch plane bsrc to bdst.
@compute @workgroup_size(8, 8)
fn blurH(@builtin(global_invocation_id) g: vec3u) {
  let x = u.rx0 + i32(g.x); let y = u.ry0 + i32(g.y);
  if (x > u.rx1 || y > u.ry1) { return; }
#ifdef PAGES
  let n = u.grid; let cells = pcells(); let lo = max(0, u.ox); let hi = min(i32(n) - 1, u.ox + i32(u.pw) - 1);   // a page clamps at the map edge, or at its own edge (outside what its core reads)
#else
  let n = u.grid; let cells = n * n; let hi = i32(n) - 1;
#endif
  var sum = 0.0; let rr = i32(u.blurR);
#ifdef PAGES
  for (var k = -rr; k <= rr; k++) { sum = sum + Sc[u.bsrc * cells + lidx(clamp(x + k, lo, hi), y)]; }
  Sc[u.bdst * cells + lidx(x, y)] = sum / f32(2 * rr + 1);
#else
  for (var k = -rr; k <= rr; k++) { sum = sum + Sc[u.bsrc * cells + u32(y) * n + u32(clamp(x + k, 0, hi))]; }
  Sc[u.bdst * cells + u32(y) * n + u32(x)] = sum / f32(2 * rr + 1);
#endif
}
@compute @workgroup_size(8, 8)
fn blurV(@builtin(global_invocation_id) g: vec3u) {
  let x = u.rx0 + i32(g.x); let y = u.ry0 + i32(g.y);
  if (x > u.rx1 || y > u.ry1) { return; }
#ifdef PAGES
  let n = u.grid; let cells = pcells(); let lo = max(0, u.oy); let hi = min(i32(n) - 1, u.oy + i32(u.ph) - 1);
#else
  let n = u.grid; let cells = n * n; let hi = i32(n) - 1;
#endif
  var sum = 0.0; let rr = i32(u.blurR);
#ifdef PAGES
  for (var k = -rr; k <= rr; k++) { sum = sum + Sc[u.bsrc * cells + lidx(x, clamp(y + k, lo, hi))]; }
  Sc[u.bdst * cells + lidx(x, y)] = sum / f32(2 * rr + 1);
#else
  for (var k = -rr; k <= rr; k++) { sum = sum + Sc[u.bsrc * cells + u32(clamp(y + k, 0, hi)) * n + u32(x)]; }
  Sc[u.bdst * cells + u32(y) * n + u32(x)] = sum / f32(2 * rr + 1);
#endif
}

// The settled hill: height, protection and routes from the joined (blurred) weights; cracks from the raw weights.
@compute @workgroup_size(8, 8)
fn compose(@builtin(global_invocation_id) g: vec3u) {
  let x = u.rx0 + i32(g.x); let y = u.ry0 + i32(g.y);
  if (x > u.rx1 || y > u.ry1) { return; }
#ifdef PAGES
  let cells = pcells(); let i = lidx(x, y);
#else
  let n = u.grid; let cells = n * n; let i = u32(y) * n + u32(x);
#endif
  let joined = Sc[2u * cells + i]; let raw = Sc[i];
#ifdef PAGES
  let lift = lumps(nzCell(5u, x, y, i, cells), nzCell(2u, x, y, i, cells));
#else
  let lift = lumps(Nz[5u * cells + i], Nz[2u * cells + i]);
#endif
  // The weights are the raw curve (a lip passes 1), so the lift carries the excess through the blur; protection and routes read the clipped share.
  F[PH * cells + i] = clamp(F[PH * cells + i] + u.amount * joined * lift, u.minH, u.maxH);
  if (u.nwrites > 0u && raw > 0.0) { shapeMasks(i, min(raw, 1.0)); }
  F[PP * cells + i] = F[PP * cells + i] * (1.0 - min(joined, 1.0));
  F[PR * cells + i] = F[PR * cells + i] * (1.0 - min(joined, 1.0));
  if (u.crackAmt > 0.0 && raw > 0.0) { F[PC * cells + i] = max(F[PC * cells + i], min(1.0, raw * 1.6) * u.crackAmt); }
}

// The ground node: broad undulation of dry ground (groundHeight).
@compute @workgroup_size(8, 8)
fn ground(@builtin(global_invocation_id) g: vec3u) {
  let x = u.rx0 + i32(g.x); let y = u.ry0 + i32(g.y);
  if (x > u.rx1 || y > u.ry1) { return; }
#ifdef PAGES
  let cells = pcells(); let i = lidx(x, y);
#else
  let n = u.grid; let cells = n * n; let i = u32(y) * n + u32(x);
#endif
  let h = F[PH * cells + i];
  if (h <= u.sea + 1.0) { return; }
  let wx = f32(x) * u.spacing; let wy = f32(y) * u.spacing;
  let wave = u.gWave; let s = u.seed;
  let v = 0.6 * vnoise(wx / wave, wy / wave, s ^ 0x51a3u) + 0.3 * vnoise(wx * 2.1 / wave, wy * 2.1 / wave, s ^ 0x2b7du)
        + 0.1 * vnoise(wx * 4.3 / wave, wy * 4.3 / wave, s ^ 0x6c11u);
  let threshold = (0.5 - u.gCover) * 1.2;
  let blotch = sm(threshold - 0.15, threshold + 0.15, vnoise(wx / (wave * 3.2), wy / (wave * 3.2), s ^ 0x7f4bu));
  let next = h + u.gAmp * v * blotch * (1.0 - F[PP * cells + i]) * sm(u.sea + 1.0, u.sea + 8.0, h);
  F[PH * cells + i] = clamp(max(next, min(h, u.sea + 1.5)), u.minH, u.maxH);
}

// Back to the empty map over the rectangle: dry base height, nothing else.
@compute @workgroup_size(8, 8)
fn init(@builtin(global_invocation_id) g: vec3u) {
  let x = u.rx0 + i32(g.x); let y = u.ry0 + i32(g.y);
  if (x > u.rx1 || y > u.ry1) { return; }
#ifdef PAGES
  let cells = pcells(); let i = lidx(x, y);
#else
  let n = u.grid; let cells = n * n; let i = u32(y) * n + u32(x);
#endif
  F[PH * cells + i] = u.baseH;
  for (var p = 1u; p < 6u; p++) { F[p * cells + i] = 0.0; }
  for (var w = 0u; w < 7u; w++) { Mk[i * 7u + w] = 0u; }
}

// Pack the rectangle for readback: six f32 planes, then 25 int8 mask planes, each plane contiguous and row-major in the rectangle.
// Thread j writes one word: an f32, or four consecutive cells of one mask plane.
@compute @workgroup_size(256)
fn pack(@builtin(global_invocation_id) g: vec3u, @builtin(num_workgroups) ng: vec3u) {
  let j = g.y * (ng.x * 256u) + g.x;
  let w = u32(u.rx1 - u.rx0 + 1); let h = u32(u.ry1 - u.ry0 + 1); let rc = w * h;
  let q = (rc + 3u) / 4u;
#ifdef PAGES
  let cells = pcells();
#else
  let n = u.grid; let cells = n * n;
#endif
  if (j < 6u * rc) {
    let pl = j / rc; let k = j % rc;
    let cx = u32(u.rx0) + k % w; let cy = u32(u.ry0) + k / w;
#ifdef PAGES
    Out[j] = bitcast<u32>(F[pl * cells + lidx(i32(cx), i32(cy))]);
#else
    Out[j] = bitcast<u32>(F[pl * cells + cy * n + cx]);
#endif
    return;
  }
  let m = j - 6u * rc;
  if (m >= 25u * q) { return; }
  let mp = m / q; let qq = m % q;
  var word = 0u;
  for (var b = 0u; b < 4u; b++) {
    let k = qq * 4u + b;
    if (k < rc) {
      let cx = u32(u.rx0) + k % w; let cy = u32(u.ry0) + k / w;
#ifdef PAGES
      word = word | ((bitcast<u32>(maskGet(lidx(i32(cx), i32(cy)), mp)) & 255u) << (b * 8u));
#else
      word = word | ((bitcast<u32>(maskGet(cy * n + cx, mp)) & 255u) << (b * 8u));
#endif
    }
  }
  Out[j] = word;
}

#ifdef PAGES
// H5b: the authored height at every `blurR`-th cell of the rectangle (the coarse lattice the overview reads): thread j is lattice point (j % w, j / w),
// w = (rx1 - rx0) / step + 1, at cell (rx0 + step * (j % w), ry0 + step * (j / w)).
@compute @workgroup_size(256)
fn coarse(@builtin(global_invocation_id) g: vec3u, @builtin(num_workgroups) ng: vec3u) {
  let j = g.y * (ng.x * 256u) + g.x;
  let step = u.blurR;
  let w = u32(u.rx1 - u.rx0) / step + 1u; let h = u32(u.ry1 - u.ry0) / step + 1u;
  if (j >= w * h) { return; }
  let cx = u.rx0 + i32((j % w) * step); let cy = u.ry0 + i32((j / w) * step);
  Out[j] = bitcast<u32>(F[PH * pcells() + lidx(cx, cy)]);
}

#endif
// ---- H6c: the remaining shapes. New entry points only; the entries above are untouched. ----
// Kinds: 6 plateau, 7 offset, 8 lower, 9 sand, 10 grass, 11 smooth. Same capsule loop as `stamp` (the host passes the same segments); the rules for
// value, protection, routes, cover and cracks follow dab() and applyCracks() in sculpt.js.
@compute @workgroup_size(8, 8)
fn stampN(@builtin(global_invocation_id) g: vec3u) {
  let x = u.rx0 + i32(g.x); let y = u.ry0 + i32(g.y);
  if (x > u.rx1 || y > u.ry1) { return; }
#ifdef PAGES
  let n = u.grid; let cells = pcells(); let i = lidx(x, y);
#else
  let n = u.grid; let cells = n * n; let i = u32(y) * n + u32(x);
#endif
  let wx = f32(x) * u.spacing; let wy = f32(y) * u.spacing;
  var lx = wx; var ly = wy;
  if (u.framed != 0u) { lx = u.inv0 * wx + u.inv2 * wy + u.inv4; ly = u.inv1 * wx + u.inv3 * wy + u.inv5; }
  let kind = u.kind;
  let natural = kind == 6u || kind == 7u || kind == 9u || kind == 10u;
  let fxF = select(0u, 3u, natural); let fyF = select(1u, 4u, natural);
#ifdef PAGES
  let nzx = nzCell(fxF, x, y, i, cells); let nzy = nzCell(fyF, x, y, i, cells);
  let nCW = nzCell(5u, x, y, i, cells); let nDet = nzCell(2u, x, y, i, cells);
#else
  let nzx = Nz[fxF * cells + i]; let nzy = Nz[fyF * cells + i];
  let nCW = Nz[5u * cells + i]; let nDet = Nz[2u * cells + i];
#endif
  let radius = u.radius;
  var best = 0.0; var visited = false;
  for (var k = 0u; k < u.nseg; k++) {
    let s0 = Seg[(u.segBase + k) * 4u]; let s2 = Seg[(u.segBase + k) * 4u + 2u];
    let bx = bitcast<vec4<i32>>(Seg[(u.segBase + k) * 4u + 3u]);
    if (x < bx.x || x > bx.z || y < bx.y || y > bx.w) { continue; }
    let px = s0.x; let py = s0.y;
    let sx = s0.z - px; let sy = s0.w - py;
    let span2 = sx * sx + sy * sy;
    var t = 0.0;
    if (span2 > 0.0) { t = clamp(((wx - px) * sx + (wy - py) * sy) / span2, 0.0, 1.0); }
    let cx = px + sx * t; let cy = py + sy * t;
    var ex = nzx; var ey = nzy;
    if (span2 > 0.0) { ex = nzx - sampleN(fxF, cx, cy); ey = nzy - sampleN(fyF, cx, cy); }
    else { ex = nzx - s2.x; ey = nzy - s2.y; }
    let dx = wx - cx + u.amp * (u.rotX * ex - u.rotY * ey);
    let dy = wy - cy + u.amp * (u.rotY * ex + u.rotX * ey);
    var width = 1.0;
    if (u.wK != 0.0) { width = clamp(1.0 + u.rough * u.wK * nCW, u.wLo, u.wHi); }
    var reach = radius * width * u.bankScale;
    var leaned = 1.0;
    if (u.leanK != 0.0) { let ln = leanToward(wx - cx, wy - cy, sx, sy, span2); leaned = 1.0 + u.leanK * ln * ln; }
    if (!natural) { reach = reach * leaned; }
    var r = sqrt(dx * dx + dy * dy) / reach;
    if (u.olAmp > 0.0) { r = r - outlineShift(r, lx, ly) / (width * u.bankScale); }
    if (r >= 1.0) { continue; }
    var c = 0.0;
    if (natural) {
      let broad = vnoise(lx / (radius * 1.3), ly / (radius * 1.3), u.seed ^ 0x5f1u);
      let shoulder0 = clamp(0.56 + u.rough * (nDet + 0.30 * nCW) + u.faceVar * 0.22 * broad, 0.18, 0.88);
      let shoulder = clamp(shoulder0 - (u.softness - 0.5) * 0.6 - 0.32 * (leaned - 1.0), 0.12, 0.90);
      c = curveAt(u.curveBase, (1.0 - r) / faceOf(1.0 - shoulder, reach, nCW, leaned));
    } else {
      c = curveAt(u.curveBase, (1.0 - r) / faceOf(1.0, reach, nCW, leaned));
      if (kind == 8u) { c = keepLip(c * lumps(nCW, nDet)); }
    }
    c = terraced(c, x, y, i, cells);
    if (c <= best) { continue; }
    best = c; visited = true;
  }
  if (!visited) { return; }
  let w = clamp(best, 0.0, 1.0); let ex = best - w;
  if (u.coPutW != 0u) { Sc[4u * cells + i] = w; }   // H10: the footprint of an offset that carries shore plates
  let base = F[PH * cells + i];
  let pbase = F[PP * cells + i];
  var value = base; var lift = 0.0;
  if (kind == 6u) { let rise = PT[u.preIdx] + u.amount + u.rough * 3.0 * nDet - base; value = base + rise * w; lift = rise * ex; }
  else if (kind == 7u) { value = base + u.amount * w; lift = u.amount * ex; }
  else if (kind == 8u) { value = base - u.amount * w; lift = -u.amount * ex; }
  else if (kind == 9u || kind == 10u) {
    let tv = select(-1.0, 1.0, kind == 9u); let vb = F[PV * cells + i];
    F[PV * cells + i] = vb + (tv - vb) * w * u.amountPct;
  }
  else if (kind == 11u) { value = base + (Sc[2u * cells + i] - base) * w * u.amountPct; }
  value = value + baseBump(lx, ly, w) + lift;
  F[PH * cells + i] = clamp(value, u.minH, u.maxH);
  if (u.nwrites > 0u && (kind == 6u || kind == 7u) && w > 0.0) { shapeMasks(i, w); }
  if (kind != 11u && value != base) { F[PR * cells + i] = F[PR * cells + i] * (1.0 - w); }
  if (kind == 6u) { F[PP * cells + i] = max(pbase * (1.0 - w), sm(0.65, 0.95, w)); }
  else if (kind == 7u) { F[PP * cells + i] = pbase * (1.0 - 4.0 * w * (1.0 - w)); }
  else if (kind == 8u) { F[PP * cells + i] = pbase * (1.0 - w); }
  if ((kind == 6u || kind == 7u) && u.crackAmt > 0.0) {
    F[PC * cells + i] = max(F[PC * cells + i], min(1.0, w * 1.6) * u.crackAmt);
  }
}

#ifdef PAGES
// The prefix height at the world point (qx, qy), bilinear as sample() of sculpt.js, from the window the host just evaluated (a target whose cells include the
// 2 x 2 stencil); the value goes to PT[preIdx] for the node that reads it.
@compute @workgroup_size(1)
fn pointRead() {
  let top = f32(u.grid - 1u);
  let gx = clamp(u.qx / u.spacing, 0.0, top); let gy = clamp(u.qy / u.spacing, 0.0, top);
  let ix = i32(floor(gx)); let iy = i32(floor(gy));
  let jx = min(ix + 1, i32(u.grid) - 1); let jy = min(iy + 1, i32(u.grid) - 1);
  let fx = gx - f32(ix); let fy = gy - f32(iy);
  let c = pcells();
  let a = F[PH * c + lidx(ix, iy)]; let b = F[PH * c + lidx(jx, iy)];
  let d = F[PH * c + lidx(ix, jy)]; let e = F[PH * c + lidx(jx, jy)];
  PT[u.preIdx] = (a * (1.0 - fx) + b * fx) * (1.0 - fy) + (d * (1.0 - fx) + e * fx) * fy;
}
#endif

// H6c smooth: the prefix height of the cells the box blur will read, copied to scratch plane 0 (blurH and blurV then run on it with blurR = the node's radius).
@compute @workgroup_size(8, 8)
fn smoothCopy(@builtin(global_invocation_id) g: vec3u) {
  let x = u.rx0 + i32(g.x); let y = u.ry0 + i32(g.y);
  if (x > u.rx1 || y > u.ry1) { return; }
#ifdef PAGES
  let cells = pcells(); let i = lidx(x, y);
#else
  let n = u.grid; let cells = n * n; let i = u32(y) * n + u32(x);
#endif
  Sc[i] = F[PH * cells + i];
}

// H6c ramp: the grade along a path between its end points' prefix heights (PT[preIdx], PT[preIdx + 1]). The host passes the settled path's segments (a, b in s0;
// the length before the segment, its length and the whole path's length in s1); a cell takes its nearest segment (the first on a tie), as rampSegment() and gradeRamp().
@compute @workgroup_size(8, 8)
fn stampRamp(@builtin(global_invocation_id) g: vec3u) {
  let x = u.rx0 + i32(g.x); let y = u.ry0 + i32(g.y);
  if (x > u.rx1 || y > u.ry1) { return; }
#ifdef PAGES
  let n = u.grid; let cells = pcells(); let i = lidx(x, y);
  let nzx = nzCell(0u, x, y, i, cells); let nzy = nzCell(1u, x, y, i, cells);
#else
  let n = u.grid; let cells = n * n; let i = u32(y) * n + u32(x);
  let nzx = Nz[i]; let nzy = Nz[cells + i];
#endif
  let wx = f32(x) * u.spacing; let wy = f32(y) * u.spacing;
  let radius = u.radius;
  var bestD = 3.0e38; var along = 0.0; var total = 1.0; var readOffset = 0u; var hit = false;
  for (var k = 0u; k < u.nseg; k++) {
    let s0 = Seg[(u.segBase + k) * 4u]; let s1 = Seg[(u.segBase + k) * 4u + 1u];
    let bx = bitcast<vec4<i32>>(Seg[(u.segBase + k) * 4u + 3u]);
    if (x < bx.x || x > bx.z || y < bx.y || y > bx.w) { continue; }
    let dx = s0.z - s0.x; let dy = s0.w - s0.y; let len2 = dx * dx + dy * dy;
    let t = clamp(((wx - s0.x) * dx + (wy - s0.y) * dy) / len2, 0.0, 1.0);
    let cx = s0.x + dx * t; let cy = s0.y + dy * t;
    let plain = sqrt((wx - cx) * (wx - cx) + (wy - cy) * (wy - cy));
    let edge = sm(0.55, 1.0, plain / radius) * u.amp;
    let ex = nzx - sampleN(0u, cx, cy); let ey = nzy - sampleN(1u, cx, cy);
    let ax = wx - cx + edge * (u.rotX * ex - u.rotY * ey); let ay = wy - cy + edge * (u.rotY * ex + u.rotX * ey);
    let dist = sqrt(ax * ax + ay * ay);
    if (dist >= radius || dist >= bestD) { continue; }
    bestD = dist; along = s1.x + t * s1.y; total = s1.z; readOffset = u32(s1.w); hit = true;
  }
  if (!hit) { return; }
  let w = 1.0 - sm(0.55, 1.0, bestD / radius);
  let tt = clamp(along / total, 0.0, 1.0);
  let ease = min(0.18, radius / total);
  var grade = (tt - ease * 0.5) / (1.0 - ease);
  if (tt < ease) { grade = tt * tt / (2.0 * ease * (1.0 - ease)); }
  else if (tt > 1.0 - ease) { grade = 1.0 - (1.0 - tt) * (1.0 - tt) / (2.0 * ease * (1.0 - ease)); }
  let ah = PT[u.preIdx + readOffset]; let bh = PT[u.preIdx + readOffset + 1u];
  let level = ah + (bh - ah) * grade;
  let base = F[PH * cells + i];
  F[PH * cells + i] = clamp(base + (level - base) * w, u.minH, u.maxH);
  F[PP * cells + i] = max(F[PP * cells + i], sm(0.55, 0.92, w));
  F[PR * cells + i] = max(F[PR * cells + i], sm(0.30, 0.92, w));
}

// H6c crater: dab()'s crater branch. A cell takes the capsule with the most influence (1 - rr / 1.9); its bowl, rim, lumps and ejecta are position-based noise of the
// crater's own seed. The level it digs from, PT[preIdx], is the prefix height at the crater's centre (a satellite reads it after the main crater and the earlier satellites).
@compute @workgroup_size(8, 8)
fn stampCrater(@builtin(global_invocation_id) g: vec3u) {
  let x = u.rx0 + i32(g.x); let y = u.ry0 + i32(g.y);
  if (x > u.rx1 || y > u.ry1) { return; }
#ifdef PAGES
  let n = u.grid; let cells = pcells(); let i = lidx(x, y);
  let nDet = nzCell(2u, x, y, i, cells);
#else
  let n = u.grid; let cells = n * n; let i = u32(y) * n + u32(x);
  let nDet = Nz[2u * cells + i];
#endif
  let wx = f32(x) * u.spacing; let wy = f32(y) * u.spacing;
  var lx = wx; var ly = wy;
  if (u.framed != 0u) { lx = u.inv0 * wx + u.inv2 * wy + u.inv4; ly = u.inv1 * wx + u.inv3 * wy + u.inv5; }
  let radius = u.radius; let rough = u.rough; let soft = u.softness; let amount = u.amount; let seed = u.seed;
  let base = F[PH * cells + i];
  let baseline = PT[u.preIdx];
  let sc = max(radius * 0.55, 8.0);
  let n0 = vnoise(lx / (radius * 0.95), ly / (radius * 0.95), seed ^ 0x4a7u);
  let n1 = vnoise(lx / sc, ly / sc, seed ^ 0x1c3u);
  let n2 = vnoise(lx / (sc * 0.6), ly / (sc * 0.6), seed ^ 0x2d9u);
  let lobe = 1.0 + rough * (0.38 * n0 + 0.22 * n1 + 0.1 * n2);
  var best = 0.0; var bestValue = base; var visited = false;
  for (var k = 0u; k < u.nseg; k++) {
    let s0 = Seg[(u.segBase + k) * 4u];
    let bx = bitcast<vec4<i32>>(Seg[(u.segBase + k) * 4u + 3u]);
    if (x < bx.x || x > bx.z || y < bx.y || y > bx.w) { continue; }
    let px = s0.x; let py = s0.y; let sx = s0.z - px; let sy = s0.w - py; let span2 = sx * sx + sy * sy;
    var t = 0.0;
    if (span2 > 0.0) { t = clamp(((wx - px) * sx + (wy - py) * sy) / span2, 0.0, 1.0); }
    let cx = px + sx * t; let cy = py + sy * t;
    let dx = wx - cx - u.cOffX * radius * 0.32 * rough; let dy = wy - cy - u.cOffY * radius * 0.32 * rough;
    let rr = sqrt((wx - cx) * (wx - cx) + (wy - cy) * (wy - cy)) / (radius * lobe);
    let rb = sqrt(dx * dx + dy * dy) / (radius * lobe);
    if (rr >= 1.9) { continue; }
    let influence = 1.0 - rr / 1.9;
    if (influence <= best) { continue; }
    best = influence; visited = true;
    let floorEdge = 0.25 + 0.45 * (1.0 - soft);
    let rimNoise = vnoise(lx / (sc * 0.8), ly / (sc * 0.8), seed ^ 0x3e1u);
    var rimHeight = amount * u.rimH * clamp(1.1 * (rimNoise * 0.5 + 0.5) + 0.5 * n0 * rough - 0.15 * rough, 0.0, 1.5);
    let rimWidth0 = (0.16 + 0.2 * soft) * (1.0 + 0.35 * n2);
    var rimWidth = rimWidth0; var outerK = 2.4;
    if (u.nSect > 1u || u.nGap > 0u) { let rf = rimFactors(atan2(wy - cy, wx - cx) - atan2(u.rotY, u.rotX)); rimHeight = rimHeight * rf.x; rimWidth = rimWidth * rf.y; outerK = 1.4; }
    var bowl = 0.0;
    if (rb < 1.0) { bowl = 1.0 - sm(floorEdge, 1.0, rb); }
    let apronReach = 1.0 - sm(1.15 + 0.35 * n1, 1.85, rr);
    var rim = 0.0;
    if (rr < 1.0) { let q = (rr - 1.0) / rimWidth; rim = exp(-(q * q)); }
    else { let q = (rr - 1.0) / (rimWidth0 * outerK); rim = exp(-(q * q)) * apronReach; }
    var lumpGate = 0.0;
    if (rr < 1.3) { lumpGate = 1.0; }
    let lumps = rough * (6.0 * n2 + 3.0 * n1 + 2.0 * nDet) * lumpGate;
    var ejecta = 0.0;
    if (u.ejecta > 0.0 && rr > 0.8) {
      let e1 = vnoise(lx / (sc * 0.32), ly / (sc * 0.32), seed ^ 0x6e7u);
      let e2 = vnoise(lx / (sc * 0.14), ly / (sc * 0.14), seed ^ 0x1b5u);
      let reach = 1.25 + 0.45 * (n0 * 0.5 + 0.5);
      ejecta = u.ejecta * amount * 0.16 * sm(-0.05, 0.45, e1 * 0.7 + e2 * 0.3) * (1.0 - sm(1.0, reach + 0.25, rr)) * sm(0.8, 1.0, rr) * (0.6 + 0.4 * e2);
    }
    let floorH = max(baseline - amount, min(baseline, u.sea + 4.0));
    let tgt = baseline + rimHeight * rim - (baseline - floorH) * bowl + lumps * (0.4 + 0.6 * bowl);
    let blend = sm(0.0, 0.15, 1.0 - rr);
    var value = base + rimHeight * rim + lumps * 0.3 * apronReach;
    if (rr < 1.0) {
      var extra = 0.0;
      if (rr >= 0.85) { extra = (rimHeight * rim + lumps * 0.4) * (1.0 - blend); }
      value = base + (tgt - base) * blend + extra;
    }
    value = value + ejecta;
    bestValue = clamp(select(value, max(value, u.sea + 1.5), base > u.sea + 1.0), u.minH, u.maxH);
  }
  if (!visited) { return; }
  if (u.coPutW != 0u) { Sc[4u * cells + i] = best; }   // H10: the footprint the crater facets are limited to
  F[PH * cells + i] = bestValue;
  if (u.nwrites > 0u) { shapeMasks(i, best); }
  let sw = sm(0.0, 0.3, best);
  F[PP * cells + i] = F[PP * cells + i] * (1.0 - sw);
  F[PR * cells + i] = F[PR * cells + i] * (1.0 - sw);
  if (u.crackAmt > 0.0) { F[PC * cells + i] = max(F[PC * cells + i], min(1.0, best * 1.6) * u.crackAmt); }
}

// H6c fissure: fissureCell() of sculpt.js over the pieces the host lists (a = s0.xy, b = s0.zw; width multipliers r0 r1 in s1.xy, depth multipliers h0 h1 in s1.zw).
// Every piece raises the crack field beside its cut; the deepest cut (the first on a tie) sets height, protection, routes and the wet-mask write.
fn fissureProfile(d: f32, hw: f32, cellPx: f32) -> f32 {
  let lo = 0.75 * cellPx; let q = (d - lo) / max(hw - lo, 0.35 * cellPx);
  if (q <= 0.0) { return 1.0; }
  if (q >= 1.0) { return 0.0; }
  return (1.0 - q) * sqrt(1.0 - q);
}
@compute @workgroup_size(8, 8)
fn stampFissure(@builtin(global_invocation_id) g: vec3u) {
  let x = u.rx0 + i32(g.x); let y = u.ry0 + i32(g.y);
  if (x > u.rx1 || y > u.ry1) { return; }
#ifdef PAGES
  let cells = pcells(); let i = lidx(x, y);
#else
  let n = u.grid; let cells = n * n; let i = u32(y) * n + u32(x);
#endif
  let wx = f32(x) * u.spacing; let wy = f32(y) * u.spacing;
  var lx = wx; var ly = wy;
  if (u.framed != 0u) { lx = u.inv0 * wx + u.inv2 * wy + u.inv4; ly = u.inv1 * wx + u.inv3 * wy + u.inv5; }
  let seed = u.seed; let jag = u.fJag; let net = u.fNet != 0.0;
  var bestG = 0.0; var crackV = 0.0;
  for (var k = 0u; k < u.nseg; k++) {
    let s0 = Seg[(u.segBase + k) * 4u]; let s1 = Seg[(u.segBase + k) * 4u + 1u];
    let bx = bitcast<vec4<i32>>(Seg[(u.segBase + k) * 4u + 3u]);
    if (x < bx.x || x > bx.z || y < bx.y || y > bx.w) { continue; }
    let px = s0.x; let py = s0.y; let sx = s0.z - px; let sy = s0.w - py; let span2 = sx * sx + sy * sy;
    var t = 0.0;
    if (span2 > 0.0) { t = clamp(((wx - px) * sx + (wy - py) * sy) / span2, 0.0, 1.0); }
    let cx = px + sx * t; let cy = py + sy * t;
    var gv = 0.0; var near = 0.0;
    if (net) {
      let C = u.fCell;
      let wxp = lx + C * 0.14 * vnoise(lx / (C * 0.9), ly / (C * 0.9), seed ^ 0x2e1u);
      let wyp = ly + C * 0.14 * vnoise(lx / (C * 0.9), ly / (C * 0.9), seed ^ 0x4d7u);
      let ix = i32(floor(wxp / C)); let iy = i32(floor(wyp / C));
      var d1 = 1.0e30; var d2 = 1.0e30; var x1 = 0.0; var y1 = 0.0; var x2 = 0.0; var y2 = 0.0;
      for (var j = -1; j <= 1; j++) { for (var m = -1; m <= 1; m++) {
        let cxs = ix + m; let cys = iy + j;
        let qx = (f32(cxs) + 0.5 + 0.42 * hashi(cxs, cys, seed ^ 0x61u)) * C; let qy = (f32(cys) + 0.5 + 0.42 * hashi(cxs, cys, seed ^ 0x93u)) * C;
        let dd = (wxp - qx) * (wxp - qx) + (wyp - qy) * (wyp - qy);
        if (dd < d1) { d2 = d1; x2 = x1; y2 = y1; d1 = dd; x1 = qx; y1 = qy; } else if (dd < d2) { d2 = dd; x2 = qx; y2 = qy; }
      } }
      let e = (d2 - d1) / (2.0 * max(sqrt((x2 - x1) * (x2 - x1) + (y2 - y1) * (y2 - y1)), 1e-3));
      let hw = u.fHw; let reg = 1.0 - sm(0.55, 1.0, sqrt((wx - cx) * (wx - cx) + (wy - cy) * (wy - cy)) / u.radius);
      let vary = 0.65 + 0.35 * vnoise(lx / (C * 0.5), ly / (C * 0.5), seed ^ 0x7a9u);
      let wob = 1.0 + jag * 0.5 * vnoise(lx / 9.0, ly / 9.0, seed ^ 0x1f3u);
      gv = fissureProfile(e, hw * wob, u.spacing) * vary * reg; near = (1.0 - sm(0.0, 1.0, e / (hw * 3.0 + 3.0))) * reg;
    } else {
      let rm = s1.x + (s1.y - s1.x) * t; let hm = s1.z + (s1.w - s1.z) * t; let hw = u.fHw * u.fKf * rm;
      var dx = wx - cx; var dy = wy - cy;
      if (jag > 0.0) {
        dx = dx + u.fAmp * (0.7 * vnoise(lx / 23.0, ly / 23.0, seed ^ 0x5a1u) + 0.5 * vnoise(lx / 9.0, ly / 9.0, seed ^ 0x3c7u));
        dy = dy + u.fAmp * (0.7 * vnoise(lx / 23.0, ly / 23.0, seed ^ 0x6b5u) + 0.5 * vnoise(lx / 9.0, ly / 9.0, seed ^ 0x2d3u));
      }
      let d = sqrt(dx * dx + dy * dy);
      gv = fissureProfile(d, hw, u.spacing) * hm * (1.0 - 0.5 * jag * (0.5 - 0.5 * vnoise(lx / 17.0, ly / 17.0, seed ^ 0x7e1u)));
      near = 1.0 - sm(0.0, 1.0, d / (hw * 3.0 + 3.0));
    }
    if (near > 0.0 && u.fCrack > 0.0) { crackV = max(crackV, u.fCrack * near); }
    if (gv <= bestG) { continue; }
    bestG = gv;
  }
  if (crackV > 0.0) { F[PC * cells + i] = max(F[PC * cells + i], crackV); }
  if (bestG <= 0.0) { return; }
  let base = F[PH * cells + i];
  let cut = base - u.amount * bestG;
  F[PH * cells + i] = clamp(select(cut, max(cut, u.sea + 1.5), base > u.sea + 1.0), u.minH, u.maxH);
  let sw = sm(0.0, 0.3, bestG);
  F[PP * cells + i] = F[PP * cells + i] * (1.0 - sw);
  F[PR * cells + i] = F[PR * cells + i] * (1.0 - sw);
  for (var m = 0u; m < u.nwrites; m++) {
    let mw = MW[u.mwBase + m]; let pl = u32(mw.x); let b = f32(maskGet(i, pl));
    maskSet(i, pl, i32(floor(b + (mw.y - b) * (sw * u.fDark) * mw.z + 0.5)));
  }
}

// H6c crystals (the pyramid form): stampCrystals(). A crystal is a segment of the host's list: centre in s0.xy, R and height in s0.zw, lean in s1.xy, its side count and
// where its edges start (vec4 nx, ny, d per edge, after the node's mask writes) in s1.zw. Each crystal's square box limits the cells it reaches.
@compute @workgroup_size(8, 8)
fn stampCrystal(@builtin(global_invocation_id) g: vec3u) {
  let x = u.rx0 + i32(g.x); let y = u.ry0 + i32(g.y);
  if (x > u.rx1 || y > u.ry1) { return; }
#ifdef PAGES
  let cells = pcells(); let i = lidx(x, y);
#else
  let n = u.grid; let cells = n * n; let i = u32(y) * n + u32(x);
#endif
  let wx = f32(x) * u.spacing; let wy = f32(y) * u.spacing;
  var best = 0.0;
  for (var k = 0u; k < u.nseg; k++) {
    let s0 = Seg[(u.segBase + k) * 4u]; let s1 = Seg[(u.segBase + k) * 4u + 1u];
    let bx = bitcast<vec4<i32>>(Seg[(u.segBase + k) * 4u + 3u]);
    if (x < bx.x || x > bx.z || y < bx.y || y > bx.w) { continue; }
    let qx = wx - s0.x; let qy = wy - s0.y;
    var m = 3.0e38;
    let sides = u32(s1.z); let at = u.mwBase + u.nwrites + u32(s1.w);
    for (var e = 0u; e < sides; e++) {
      let ed = MW[at + e];
      let rise = ed.z - (s1.x * ed.x + s1.y * ed.y);
      m = min(m, (ed.z - (qx * ed.x + qy * ed.y)) / max(rise, ed.z * 0.2));
    }
    if (m <= 0.0) { continue; }
    let h = min(s0.w, s0.w / (1.0 - u.cTop) * m);
    if (h > best) { best = h; }
  }
  if (best <= 0.0) { return; }
  F[PH * cells + i] = clamp(F[PH * cells + i] + best, u.minH, u.maxH);
  F[PP * cells + i] = 1.0;
  F[PX * cells + i] = max(F[PX * cells + i], sm(0.2, 1.5, best));
}

// ---- H10: the coast pass (Lava's shore layers and fingers) ----
// The coast planes live in the scratch buffer Sc after the hill's three planes (see CB..CFF). Every pass below runs over the node's coast box (the
// region the host gives it: the footprint grown by the coast's reach), one thread per cell, reading only its own cells of the planes a previous pass
// finished, so a repeat run is identical. Distances are world px, so the same passes serve every resolution.
const CB = 3u; const CW = 4u; const CPX = 5u; const CPY = 6u; const CQX = 7u; const CQY = 8u; const CDD = 9u; const CSS = 10u; const CRR = 11u; const CUU = 12u; const CFF = 13u;
const CNPL = 14u;

fn cIdx(x: i32, y: i32) -> u32 {
#ifdef PAGES
  return lidx(x, y);
#else
  return u32(y) * u.grid + u32(x);
#endif
}
fn cCells() -> u32 {
#ifdef PAGES
  return pcells();
#else
  return u.grid * u.grid;
#endif
}
fn cInBox(x: i32, y: i32) -> bool { return x >= u.rx0 && x <= u.rx1 && y >= u.ry0 && y <= u.ry1; }

// Before the node's stamp: the prefix height (B) over the box, and no footprint (W), no finger marks.
@compute @workgroup_size(8, 8)
fn coastInit(@builtin(global_invocation_id) g: vec3u) {
  let x = u.rx0 + i32(g.x); let y = u.ry0 + i32(g.y);
  if (x > u.rx1 || y > u.ry1) { return; }
  let cells = cCells(); let i = cIdx(x, y);
  Sc[CB * cells + i] = F[PH * cells + i];
  Sc[CW * cells + i] = 0.0; Sc[CUU * cells + i] = 0.0; Sc[CFF * cells + i] = 0.0;
}

// The nearest crossing of the sea (a point where the height meets the sea level along a grid edge) among the cell's four edges. A crossing needs the
// footprint on one side at least; with coMoved, one side must also have changed side of the sea since the prefix (an older lake's coast under this
// stroke's bank is that stroke's to shape). Also snapshots the heights the field was computed from (R).
@compute @workgroup_size(8, 8)
fn coastSeed(@builtin(global_invocation_id) g: vec3u) {
  let x = u.rx0 + i32(g.x); let y = u.ry0 + i32(g.y);
  if (x > u.rx1 || y > u.ry1) { return; }
  let cells = cCells(); let i = cIdx(x, y); let sea = u.sea;
  let hi = F[PH * cells + i];
  Sc[CRR * cells + i] = hi;
  let wx = f32(x) * u.spacing; let wy = f32(y) * u.spacing;
  var bd = 3.0e38; var bp = vec2f(-1.0e9, -1.0e9);
  let wi = Sc[CW * cells + i]; let bi = Sc[CB * cells + i];
  for (var k = 0; k < 4; k++) {
    let ddx = select(0, 1, k == 0) + select(0, -1, k == 1); let ddy = select(0, 1, k == 2) + select(0, -1, k == 3);
    let jx = x + ddx; let jy = y + ddy;
    if (!cInBox(jx, jy)) { continue; }
    let j = cIdx(jx, jy);
    let hj = F[PH * cells + j];
    if ((hi > sea) == (hj > sea)) { continue; }
    if (wi <= 0.0 && Sc[CW * cells + j] <= 0.0) { continue; }
    if (u.coMoved != 0u && (bi > sea) == (hi > sea) && (Sc[CB * cells + j] > sea) == (hj > sea)) { continue; }
    let t = abs(hi - sea) / max(1.0e-6, abs(hi - hj));
    let p = vec2f(wx + f32(ddx) * t * u.spacing, wy + f32(ddy) * t * u.spacing);
    let d2 = dot(p - vec2f(wx, wy), p - vec2f(wx, wy));
    if (d2 < bd) { bd = d2; bp = p; }
  }
  let dst = select(CPX, CQX, u.coSrc != 0u);
  Sc[dst * cells + i] = bp.x; Sc[(dst + 1u) * cells + i] = bp.y;
}

// One jump of the flood: coSrc selects the source pair of planes (0: P, 1: Q); the result goes to the other pair. A strict < keeps the first of equal candidates.
@compute @workgroup_size(8, 8)
fn coastJump(@builtin(global_invocation_id) g: vec3u) {
  let x = u.rx0 + i32(g.x); let y = u.ry0 + i32(g.y);
  if (x > u.rx1 || y > u.ry1) { return; }
  let cells = cCells(); let i = cIdx(x, y);
  let sx = select(CPX, CQX, u.coSrc != 0u); let dx0 = select(CQX, CPX, u.coSrc != 0u);
  let me = vec2f(f32(x) * u.spacing, f32(y) * u.spacing);
  var bd = 3.0e38; var bp = vec2f(-1.0e9, -1.0e9);
  for (var oy = -1; oy <= 1; oy++) { for (var ox = -1; ox <= 1; ox++) {
    let nx = x + ox * u.coStep; let ny = y + oy * u.coStep;
    if (!cInBox(nx, ny)) { continue; }
    let j = cIdx(nx, ny);
    let p = vec2f(Sc[sx * cells + j], Sc[(sx + 1u) * cells + j]);
    if (p.x < -1.0e8) { continue; }
    let d2 = dot(p - me, p - me);
    if (d2 < bd) { bd = d2; bp = p; }
  } }
  Sc[dx0 * cells + i] = bp.x; Sc[(dx0 + 1u) * cells + i] = bp.y;
}

// D: the distance to that point (world px), or the far value where no crossing came.
@compute @workgroup_size(8, 8)
fn coastFinish(@builtin(global_invocation_id) g: vec3u) {
  let x = u.rx0 + i32(g.x); let y = u.ry0 + i32(g.y);
  if (x > u.rx1 || y > u.ry1) { return; }
  let cells = cCells(); let i = cIdx(x, y);
  let sx = select(CPX, CQX, u.coSrc != 0u);
  let p = vec2f(Sc[sx * cells + i], Sc[(sx + 1u) * cells + i]);
  var d = u.coFar;
  if (p.x > -1.0e8) { d = length(p - vec2f(f32(x) * u.spacing, f32(y) * u.spacing)); }
  Sc[CDD * cells + i] = d;
}

// The signed distance (positive on dry ground) into plane P.x, ready for the blur.
@compute @workgroup_size(8, 8)
fn coastSd(@builtin(global_invocation_id) g: vec3u) {
  let x = u.rx0 + i32(g.x); let y = u.ry0 + i32(g.y);
  if (x > u.rx1 || y > u.ry1) { return; }
  let cells = cCells(); let i = cIdx(x, y);
  let d = Sc[CDD * cells + i];
  Sc[CPX * cells + i] = select(-d, d, Sc[CRR * cells + i] > u.sea);
}
// blurredBox: a box blur of radius blurR from plane bsrc to bdst, clamped at the box edge (the pass region).
@compute @workgroup_size(8, 8)
fn coastBlurH(@builtin(global_invocation_id) g: vec3u) {
  let x = u.rx0 + i32(g.x); let y = u.ry0 + i32(g.y);
  if (x > u.rx1 || y > u.ry1) { return; }
  let cells = cCells(); var sum = 0.0; let rr = i32(u.blurR);
  for (var k = -rr; k <= rr; k++) { sum = sum + Sc[u.bsrc * cells + cIdx(clamp(x + k, u.rx0, u.rx1), y)]; }
  Sc[u.bdst * cells + cIdx(x, y)] = sum / f32(2 * rr + 1);
}
@compute @workgroup_size(8, 8)
fn coastBlurV(@builtin(global_invocation_id) g: vec3u) {
  let x = u.rx0 + i32(g.x); let y = u.ry0 + i32(g.y);
  if (x > u.rx1 || y > u.ry1) { return; }
  let cells = cCells(); var sum = 0.0; let rr = i32(u.blurR);
  for (var k = -rr; k <= rr; k++) { sum = sum + Sc[u.bsrc * cells + cIdx(x, clamp(y + k, u.ry0, u.ry1))]; }
  Sc[u.bdst * cells + cIdx(x, y)] = sum / f32(2 * rr + 1);
}

// Debug and checks: one scratch plane (bsrc) over the rectangle into Out, as floats.
@compute @workgroup_size(256)
fn packPlane(@builtin(global_invocation_id) g: vec3u, @builtin(num_workgroups) ng: vec3u) {
  let j = g.y * (ng.x * 256u) + g.x;
  let w = u32(u.rx1 - u.rx0 + 1); let h = u32(u.ry1 - u.ry0 + 1);
  if (j >= w * h) { return; }
  let cx = i32(u.rx0) + i32(j % w); let cy = i32(u.ry0) + i32(j / w);
  Out[j] = bitcast<u32>(Sc[u.bsrc * cCells() + cIdx(cx, cy)]);
}

// ---- coast fingers ----
// Thumb fingers (retail lava-1: tendrils and stubs in clusters, tapering to a round tip, now and then forked): one per jittered lattice site in the shape's
// frame; the coast point at tangent offset tau from a site's axis reaches the finger's outline. Everything about a finger comes from its site's hashes.
const THUMB_CELL = 44.0;
const THUMB_SPREAD = 0.5;   // how much a cluster's noise raises a site's chance of a finger
const THUMB_AMOUNT = 1.4;   // H24: the share of lattice sites that grow one, the same on every world
fn uhash(i: i32, j: i32, salt: u32, k: u32) -> f32 { return hashi(i, j, salt ^ k) * 0.5 + 0.5; }
fn thumbAt(lx: f32, ly: f32, nx: f32, ny: f32, amount: f32) -> f32 {
  let tx = -ny; let ty = nx; let salt = u.seed;
  let ci = i32(floor(lx / THUMB_CELL)); let cj = i32(floor(ly / THUMB_CELL));
  var best = 0.0;
  let size = u.cfSize;
  for (var j = cj - 1; j <= cj + 1; j++) { for (var i = ci - 1; i <= ci + 1; i++) {
    let ax = (f32(i) + 0.5 + 0.45 * hashi(i, j, salt ^ 0x5a7u)) * THUMB_CELL;
    let ay = (f32(j) + 0.5 + 0.45 * hashi(i, j, salt ^ 0x1d3u)) * THUMB_CELL;
    let chance = clamp((0.7 + 1.5 * THUMB_SPREAD * vnoise(ax / 130.0, ay / 130.0, salt ^ 0x1f3u)) * THUMB_AMOUNT, 0.04, 0.97);
    if (uhash(i, j, salt, 0x31fu) >= chance) { continue; }
    // Only sites within half a cell of the coast along its normal grow a finger here.
    if (abs((lx - ax) * nx + (ly - ay) * ny) >= THUMB_CELL * 0.5) { continue; }
    let L = amount * 52.0 * (0.3 + 2.0 * pow(uhash(i, j, salt, 0x4e5u), 2.4)) * size;
    let fork = L > 40.0 * amount * size && L < 95.0 * amount * size && uhash(i, j, salt, 0x2c9u) > 0.8;
    var h0 = clamp(5.0 + 0.15 * L / max(amount, 0.2) + (uhash(i, j, salt, 0x6b1u) - 0.5) * 6.0, 7.0, 24.0) * min(1.0, 0.4 + amount * 0.6);
    if (fork) { h0 = clamp(h0 * 1.3, 16.0, 26.0); }
    let tau = abs((lx - ax) * tx + (ly - ay) * ty);
    if (tau >= h0) { continue; }
    let ht = max(4.5, 0.8 * h0); let Ls = max(L - ht, 0.0);
    let sh = (tau - ht) / (h0 - ht);
    var r = Ls + sqrt(max(ht * ht - tau * tau, 0.0));
    if (tau > ht) { r = Ls * (1.0 - sh * sh); }
    if (fork && r > 0.5 * L) { let wn = 0.42 * h0; if (tau < wn) { r = min(r, 0.5 * L + (r - 0.5 * L) * tau / wn); } }
    best = max(best, r);
  } }
  return best + vnoise(lx / 12.0, ly / 12.0, salt ^ 0x5c1u) * 1.6;
}
// thumbReach: the world position and inland normal go into the shape's frame; the lattice is turned 26 degrees off the axes.
fn thumbReach(wx: f32, wy: f32, nx: f32, ny: f32, amount: f32) -> f32 {
  var lx = wx; var ly = wy; var mx = nx; var my = ny;
  if (u.framed != 0u) {
    lx = u.inv0 * wx + u.inv2 * wy + u.inv4; ly = u.inv1 * wx + u.inv3 * wy + u.inv5;
    mx = u.inv0 * nx + u.inv2 * ny; my = u.inv1 * nx + u.inv3 * ny;
    var ml = sqrt(mx * mx + my * my); if (ml == 0.0) { ml = 1.0; }
    mx = mx / ml; my = my / ml;
  }
  let ca = 0.8988; let sa = 0.4384;
  return thumbAt(ca * lx + sa * ly, -sa * lx + ca * ly, ca * mx + sa * my, -sa * mx + ca * my, amount);
}
// The inland unit normal at a cell: the gradient of the blurred signed distance (plane CSS), clamped at the box.
fn coastNormal(x: i32, y: i32, cells: u32) -> vec3f {
  let gx = Sc[CSS * cells + cIdx(min(x + 1, u.rx1), y)] - Sc[CSS * cells + cIdx(max(x - 1, u.rx0), y)];
  let gy = Sc[CSS * cells + cIdx(x, min(y + 1, u.ry1))] - Sc[CSS * cells + cIdx(x, max(y - 1, u.ry0))];
  let len = sqrt(gx * gx + gy * gy);
  if (len < 1.0e-3) { return vec3f(0.0, 0.0, 0.0); }
  return vec3f(gx / len, gy / len, 1.0);
}
// H24: the height (units above the sea) of a finger's flat top, the same on every world.
const FINGER_LOW = 3.5;
// At each cell near the coast the finger field is read at the nearest coast point (back along the normal) and the cell is raised to a flat tongue (or
// sunk, for an inlet). U marks the raised cells for the connectivity march; F keeps a flat finger's height for the layers.
@compute @workgroup_size(8, 8)
fn coastFinger(@builtin(global_invocation_id) g: vec3u) {
  let x = u.rx0 + i32(g.x); let y = u.ry0 + i32(g.y);
  if (x > u.rx1 || y > u.ry1) { return; }
  let cells = cCells(); let i = cIdx(x, y); let sea = u.sea;
  let dist = Sc[CDD * cells + i];
  if (dist > u.coLimit) { return; }
  let nm = coastNormal(x, y, cells);
  if (nm.z == 0.0) { return; }
  let sd = select(-dist, dist, Sc[CRR * cells + i] > sea);
  let wx = f32(x) * u.spacing; let wy = f32(y) * u.spacing;
  let f = clamp(thumbReach(wx - sd * nm.x, wy - sd * nm.y, nm.x, nm.y, u.coFAmt), -u.coFReach, u.coFReach);
  if (sd < 0.0 && -sd < f) {
    F[PH * cells + i] = clamp(sea + FINGER_LOW, u.minH, u.maxH);
    Sc[CUU * cells + i] = 1.0;
    Sc[CFF * cells + i] = FINGER_LOW;
  } else if (sd > 0.0 && sd < -f) {
    F[PH * cells + i] = clamp(sea - 0.5 - 2.5 * (1.0 - sd / -f), u.minH, u.maxH);
  }
}
// A tongue is land joined to land. Instead of flooding out from the old dry ground, a raised cell marches back along its normal toward the coast and keeps
// its height only if it reaches ground that was dry before the fingers by way of raised cells alone (a finger is one prism from the coast to its tip).
@compute @workgroup_size(8, 8)
fn coastJoin(@builtin(global_invocation_id) g: vec3u) {
  let x = u.rx0 + i32(g.x); let y = u.ry0 + i32(g.y);
  if (x > u.rx1 || y > u.ry1) { return; }
  let cells = cCells(); let i = cIdx(x, y); let sea = u.sea;
  if (Sc[CUU * cells + i] == 0.0) { return; }
  let nm = coastNormal(x, y, cells);
  var ok = false;
  if (nm.z != 0.0) {
    let reachPx = Sc[CDD * cells + i] + 2.0 * u.spacing;
    let step = 0.5 * u.spacing; let steps = i32(ceil(reachPx / step));
    let p0 = vec2f(f32(x), f32(y));
    for (var k = 1; k <= steps; k++) {
      let p = p0 + vec2f(nm.x, nm.y) * (f32(k) * step / u.spacing);
      // The four cells round the sample: dry old ground among them joins the finger; none raised or dry ends the march.
      let fx = i32(floor(p.x)); let fy = i32(floor(p.y));
      var any = false;
      for (var q = 0; q < 4; q++) {
        let cx = fx + (q & 1); let cy = fy + (q >> 1);
        if (!cInBox(cx, cy)) { continue; }
        let j = cIdx(cx, cy);
        if (Sc[CRR * cells + j] > sea) { ok = true; break; }
        if (Sc[CUU * cells + j] != 0.0) { any = true; }
      }
      if (ok || !any) { break; }
    }
  }
  if (!ok) { F[PH * cells + i] = Sc[CRR * cells + i]; Sc[CFF * cells + i] = 0.0; }
}

// ---- shore layers ----
// Circular layers: the bites. One thread per jittered lattice site (in the shape's frame); a bite is kept only if it straddles the waterline. A site is four
// floats at the end of the scratch buffer: world x, world y, radius (negative: none), spacing factor.
@compute @workgroup_size(8, 8)
fn coastSites(@builtin(global_invocation_id) g: vec3u) {
  if (g.x >= u.coSNI || g.y >= u.coSNJ) { return; }
  let i = u.coSI0 + i32(g.x); let j = u.coSJ0 + i32(g.y);
  let cells = cCells(); let salt = u.seed; let cv = u.coCV; let C = u.coRc * 1.3;
  let at = (CNPL * cells + (g.y * u.coSNI + g.x) * 4u);
  Sc[at + 2u] = -1.0;
  if (hashi(i, j, salt ^ 0x91du) < -0.55 + 0.45 * cv) { return; }
  let lx = (f32(i) + 0.5 + 0.4 * hashi(i, j, salt ^ 0x13bu)) * C; let ly = (f32(j) + 0.5 + 0.4 * hashi(i, j, salt ^ 0x5c9u)) * C;
  var wx = lx; var wy = ly;
  if (u.framed != 0u) {
    // the frame's inverse of inv: the forward transform
    let det = u.inv0 * u.inv3 - u.inv1 * u.inv2;
    let a = u.inv3 / det; let b = -u.inv1 / det; let c = -u.inv2 / det; let d = u.inv0 / det;
    let e = -(a * u.inv4 + c * u.inv5); let f = -(b * u.inv4 + d * u.inv5);
    wx = a * lx + c * ly + e; wy = b * lx + d * ly + f;
  }
  let gx = i32(floor(wx / u.spacing + 0.5)); let gy = i32(floor(wy / u.spacing + 0.5));
  if (gx < u.coBx0 || gx > u.coBx1 || gy < u.coBy0 || gy > u.coBy1) { return; }
  let u0 = hashi(i, j, salt ^ 0x77fu) * 0.5 + 0.5; let k = cIdx(gx, gy);
  let dk = Sc[CDD * cells + k]; let sd = select(-dk, dk, Sc[CRR * cells + k] > u.sea);
  let r = u.coRc * ((0.4 + pow(u0, 1.3)) * (1.0 - cv) + (0.3 + 1.2 * u0 * u0) * cv);
  let sc = 1.0 - cv + cv * (0.55 + 0.9 * (hashi(i, j, salt ^ 0x2c1u) * 0.5 + 0.5));
  if (sd < -0.5 * r || sd > 0.8 * r) { return; }
  Sc[at] = wx; Sc[at + 1u] = wy; Sc[at + 2u] = r; Sc[at + 3u] = sc;
}
// The land's height as a staircase in the distance from the coast (or, scalloped, from the nearest bite's edge), the layers' edges wandering with
// position-only noise in the shape's frame. Layer k tops out at sea + foot + riser k; the last riser meets the plain. Weights (varied risers) are the
// node's mask-write records after its own writes: x the riser's height weight, y the height below it (both in risers).
@compute @workgroup_size(8, 8)
fn coastLayers(@builtin(global_invocation_id) g: vec3u) {
  let x = u.rx0 + i32(g.x); let y = u.ry0 + i32(g.y);
  if (x > u.rx1 || y > u.ry1) { return; }
  let cells = cCells(); let i = cIdx(x, y); let sea = u.sea;
  let raw = Sc[CRR * cells + i];
  if (!(raw > sea)) { return; }
  let d = Sc[CDD * cells + i]; let base = Sc[CB * cells + i];
  let W = u.coW; let vary = u.coVary; let n = i32(u.coN); let salt = u.seed;
  let rise = u.baseH - sea; let foot = min(6.0, 0.3 * rise); var riser = u.coRiser;
  if (riser <= 0.0) { riser = (rise - foot) / f32(n); }
  if (d >= u.coLReach) { if (Sc[CW * cells + i] > 0.0 && raw < base) { F[PH * cells + i] = base; } return; }
  let wx = f32(x) * u.spacing; let wy = f32(y) * u.spacing;
  var lx = wx; var ly = wy;
  if (u.framed != 0u) { lx = u.inv0 * wx + u.inv2 * wy + u.inv4; ly = u.inv1 * wx + u.inv3 * wy + u.inv5; }
  let scal = u.coScal != 0u;
  let ledge = clamp(u.coLedge + u.coIrr * 0.3 * vnoise(lx / 33.0, ly / 33.0, salt ^ 0x2b1u), 0.3, 0.95);
  var dd = d;
  if (scal) {
    let C = u.coRc * 1.3; let rs = u.coRs;
    let ia = max(i32(floor((lx - rs) / C)), u.coSI0); let ib = min(i32(floor((lx + rs) / C)), u.coSI0 + i32(u.coSNI) - 1);
    let ja = max(i32(floor((ly - rs) / C)), u.coSJ0); let jb = min(i32(floor((ly + rs) / C)), u.coSJ0 + i32(u.coSNJ) - 1);
    for (var j = ja; j <= jb; j++) { for (var ii = ia; ii <= ib; ii++) {
      let at = CNPL * cells + (u32(j - u.coSJ0) * u.coSNI + u32(ii - u.coSI0)) * 4u;
      let r = Sc[at + 2u];
      if (r < 0.0) { continue; }
      dd = min(dd, (length(vec2f(wx - Sc[at], wy - Sc[at + 1u])) - r) / Sc[at + 3u]);
    } }
    dd = max(0.0, dd);
  }
  let wob = u.coIrr * select(1.0, 0.4, scal) * (0.55 * vnoise(lx / 42.0, ly / 42.0, salt ^ 0x7a1u) + 0.25 * vnoise(lx / 14.0, ly / 14.0, salt ^ 0x3c5u) + 0.12 * vnoise(lx / 6.0, ly / 6.0, salt ^ 0x5e3u));
  var Wl = W;
  if (vary > 0.0 || u.coSpread > 0.0) { Wl = W * exp((0.5 * vary + 0.5 * u.coSpread) * vnoise(lx / 75.0, ly / 75.0, salt ^ 0x91fu)); }
  var meanderQ = 0.0;
  if (u.coMeander > 0.0 && !scal) {
    meanderQ = u.coMeander * (0.55 * vnoise(lx / (3.6 * W), ly / (3.6 * W), salt ^ 0x1d7u) + 0.35 * vnoise(lx / (1.6 * W), ly / (1.6 * W), salt ^ 0x4c3u) + 0.2 * vnoise(lx / (0.7 * W), ly / (0.7 * W), salt ^ 0x2f9u));
  }
  var extraQ = 0.0;
  if (vary > 0.0) { extraQ = vary * (0.4 * vnoise(lx / 17.0, ly / 17.0, salt ^ 0x6d3u) + 0.2 * vnoise(lx / 8.0, ly / 8.0, salt ^ 0x4e1u)); }
  let q = max(0.0, dd / Wl + wob + meanderQ + extraQ);
  if (q >= f32(n) + select(0.0, 1.0, vary > 0.0)) { if (raw < base) { F[PH * cells + i] = base; } return; }
  var level = 0.0;
  if (vary > 0.0) {
    let k0 = max(0, i32(floor(q)) - 2); let k1 = min(n - 1, i32(floor(q)) + 1);
    level = foot + riser * MW[u.mwBase + u.nwrites + u32(k0)].y;
    for (var k = k0; k <= k1; k++) {
      let wsz = 24.0 + 9.0 * f32(k % 4);
      let off = vary * 0.45 * vnoise(lx / wsz, ly / wsz, salt ^ u32(0x3a7 + k * 977));
      level = level + riser * MW[u.mwBase + u.nwrites + u32(k)].x * sm(f32(k) + ledge + off, f32(k) + 1.0 + off, q);
    }
  } else {
    let k = floor(q);
    level = foot + riser * (k + sm(ledge, 1.0, q - k));
  }
  // Fingers stay as flat as they were laid, under the ledge they would be raised to.
  let ff = Sc[CFF * cells + i];
  if (ff > 0.0) { level = min(level, ff); }
  F[PH * cells + i] = clamp(min(min(base, u.baseH), sea + level * sm(0.0, 5.0, d)) + max(0.0, base - u.baseH), u.minH, u.maxH);
}

// ---- H10: shore plates (materials 1 slabs and 2 frost), after the coast field (coMoved 0, so every crossing the footprint touches seeds it) ----
// One thread per cell of the band: its own distance D, the snapshot of its own height R, a jittered Voronoi lattice in the shape's frame, value noise. No cell reads another's
// result, so a repeat run is identical. The band is plWater px into the water and plLand px onto land from the stroke's waterline.
fn plH(x: i32, y: i32, salt: u32) -> f32 { return hashi(x, y, u.seed ^ salt); }
fn plHalf(x: i32, y: i32, salt: u32) -> f32 { return hashi(x, y, u.seed ^ salt) * 0.5 + 0.5; }
// The two nearest points of the lattice of L-sized cells around (lx, ly) in the shape's frame: each cell's point is its centre moved by plH (salts sa and sb) times jit of a cell.
// Squared distances, the points, and the cells, nearest (b) first.
struct PlCells { d1: f32, d2: f32, b: vec2f, n: vec2f, bi: i32, bj: i32, ni: i32, nj: i32 }
fn plCells(lx: f32, ly: f32, L: f32, sa: u32, sb: u32, jit: f32) -> PlCells {
  var r = PlCells(3.0e38, 3.0e38, vec2f(0.0), vec2f(0.0), 0, 0, 0, 0);
  let ci = i32(floor(lx / L)); let cj = i32(floor(ly / L));
  for (var v = cj - 1; v <= cj + 1; v++) { for (var w = ci - 1; w <= ci + 1; w++) {
    let c = vec2f((f32(w) + 0.5 + plH(w, v, sa) * jit) * L, (f32(v) + 0.5 + plH(w, v, sb) * jit) * L);
    let q = (lx - c.x) * (lx - c.x) + (ly - c.y) * (ly - c.y);
    if (q < r.d1) { r.d2 = r.d1; r.n = r.b; r.ni = r.bi; r.nj = r.bj; r.d1 = q; r.b = c; r.bi = w; r.bj = v; } else if (q < r.d2) { r.d2 = q; r.n = c; r.ni = w; r.nj = v; }
  } }
  return r;
}

@compute @workgroup_size(8, 8)
fn coastPlates(@builtin(global_invocation_id) g: vec3u) {
  let x = u.rx0 + i32(g.x); let y = u.ry0 + i32(g.y);
  if (x > u.rx1 || y > u.ry1) { return; }
  let cells = cCells(); let i = cIdx(x, y); let sea = u.sea;
  let raw = Sc[CRR * cells + i];
  let wet = raw <= sea;
  let width = select(u.plLand, u.plWater, wet);
  let d = Sc[CDD * cells + i];
  if (!(width > 0.0) || d >= width) { return; }
  let wx = f32(x) * u.spacing; let wy = f32(y) * u.spacing;
  var lx = wx; var ly = wy; var scale = 1.0;
  if (u.framed != 0u) { lx = u.inv0 * wx + u.inv2 * wy + u.inv4; ly = u.inv1 * wx + u.inv3 * wy + u.inv5; scale = 1.0 / length(vec2f(u.inv0, u.inv1)); }
  let ph = PH * cells + i; let pp = PP * cells + i; let pr = PR * cells + i; let pv = PV * cells + i; let px = PX * cells + i;
  if (u.plMat == 1u) {
    let L = max(8.0, u.plSize); let seam = max(u.spacing * 0.5, max(0.0, u.plGap) * 0.5);
    let k = plCells(lx, ly, L, 0x481u, 0x287u, 0.4);
    let keep = plHalf(k.bi, k.bj, 0x721u); var shade = 0.8 + 0.2 * plHalf(k.bi, k.bj, 0x3b9u); let lift = plHalf(k.bi, k.bj, 0x6d3u);
    if (keep > 1.0 - sm(0.2, 1.0, d / width)) { return; }
    let wob = vnoise(lx / 6.0, ly / 6.0, u.seed ^ 0x317u) * 0.5;
    var edge = (k.d2 - k.d1) / (2.0 * max(1.0, length(k.b - k.n))) * scale + wob;
    // H20b: a wet plate whose centre reads low in a slow noise breaks into a mesh of cells 0.4 of L, its own outline kept as the nearer seam. Wet only: on land a mesh this fine
    // inks its seams into black clumps (retail's fine mesh is the water band). The noise sits close to .5, so the cut is pulled toward it (0.72) to make the share about plVary.
    if (wet && u.plVary > 0.0 && 0.5 + 0.5 * vnoise(k.b.x / (L * 4.0), k.b.y / (L * 4.0), u.seed ^ 0x5d1u) < 0.5 + 0.72 * (u.plVary - 0.5)) {
      let f = plCells(lx, ly, L * 0.4, 0x6a9u, 0x2e3u, 0.4);
      edge = min(edge, (f.d2 - f.d1) / (2.0 * max(1.0, length(f.b - f.n))) * scale + wob);
      shade = 0.8 + 0.2 * plHalf(f.bi, f.bj, 0x1f5u);
    }
    let seamed = edge < seam;
    F[px] = select(shade, u.plSeam, seamed); F[pp] = 1.0;
    if (wet) { F[ph] = clamp(max(raw, sea - 3.2 + lift), u.minH, u.maxH); }
    else if (!seamed) { F[ph] = clamp(raw + lift * u.plHeight, u.minH, u.maxH); }
    return;
  }
  if (u.plMat != 2u) { return; }
  // Frost: patches (size L) carry needles in one of three directions 60 degrees apart; seams run between much larger cells (3 L).
  let gapSize = u.frGapSize; let L = max(20.0, u.plSize); let sp0 = max(3.0, u.plGap); let turn = atan2(u.rotY, u.rotX);
  F[pp] = max(F[pp], 0.04);
  F[pr] = max(F[pr], (1.0 + 4.0 * (1.0 - d / width)) / 255.0);
  let pc = plCells(lx, ly, L, 0x481u, 0x287u, 0.4);
  let kind3 = i32(floor(plHalf(pc.bi, pc.bj, 0x5d1u) * 3.0)) % 3;
  let pkeep = plHalf(pc.bi, pc.bj, 0x721u); let needles = plHalf(pc.bi, pc.bj, 0x9c5u) < u.plNeedles;
  let angle = turn + 1.5707963 + f32(kind3) * 1.0471976 + plH(pc.bi, pc.bj, 0x3c9u) * 0.12;
  let pgap = sp0 * (0.8 + 0.5 * plHalf(pc.bi, pc.bj, 0x6b7u)); let phase = plHalf(pc.bi, pc.bj, 0x1f3u);
  let pid = (pc.bi * 73856093) ^ (pc.bj * 19349663);
  let support = 1.0 - sm(0.1, 1.0, d / width);
  let ca = cos(angle); let sa = sin(angle);
  let across = (lx * ca + ly * sa) / (pgap * scale) + phase; let along = (-lx * sa + ly * ca) / scale;
  let index = i32(floor(across + 0.5)); let off = abs(across - f32(index)) * pgap;
  let nlen = pgap * (1.5 + 4.0 * plHalf(index, pid, 0x2e7u)); let stretch = i32(floor(along / nlen + plH(index, pid, 0x4a9u) * 2.0));
  let here = plHalf(index, stretch ^ pid, 0x91du); let line = plHalf(index, pid, 0x63du);
  var strip = 0.0;
  if (needles && !(pkeep > support) && !(line < 0.45)) { strip = sm(1.5, 0.5, off) * sm(0.15, 0.5, here - (1.0 - support) * 0.35); }
  if (wet) {
    let across2 = (lx * ca + ly * sa) / scale;
    let field = vnoise(along / 64.0, across2 / 20.0, u.seed ^ 0x1a7u) * 0.45 + vnoise(along / 26.0, across2 / 6.0, u.seed ^ 0x2b1u) * 0.3 + vnoise(along / 10.0, across2 / 3.0, u.seed ^ 0x3d7u) * 0.18 + 0.5;
    strip = max(strip, sm(0.0, 0.12, pow(support, 1.25) * 1.25 - field));
    if (strip <= 0.05) { return; }
    let top = sea + u.plHeight * (0.6 + 0.4 * plHalf(index, pid, 0x7b3u));
    F[ph] = clamp(raw + (max(raw, top) - raw) * strip, u.minH, u.maxH);
    F[pp] = max(F[pp], strip); F[pr] = max(F[pr], strip); F[pv] = min(F[pv], -strip);
    return;
  }
  // Land: a low ridge along each needle, a groove along the seam between the big cells, melt pockets.
  let sk = plCells(lx, ly, L * 3.0, 0x6c1u, 0x7e9u, 0.42);
  let skb = plHalf(sk.bi, sk.bj, 0x8d3u); let skn = plHalf(sk.ni, sk.nj, 0x8d3u);
  let sedge = (sk.d2 - sk.d1) / (2.0 * max(1.0, length(sk.b - sk.n))) * scale + vnoise(lx / 9.0, ly / 9.0, u.seed ^ 0x317u) * 1.2;
  var seam = 0.0;
  if (max(skb, skn) > 1.0 - support * 0.9) { seam = sm(1.6, 0.3, sedge); }
  let lift = strip * min(2.5, u.plHeight * 0.7) - seam * 2.5;
  var holeShare = 0.0;
  if (u.frGapReach > 0.0) { holeShare = u.frGaps * sm(u.frGapReach, 0.0, d / width); }
  var hole = 0.0;
  if (holeShare > 0.0) { hole = sm(0.0, 0.1, vnoise(lx / gapSize, ly / gapSize, u.seed ^ 0x4e1u) * 0.5 + vnoise(lx / (gapSize * 0.41), ly / (gapSize * 0.41), u.seed ^ 0x5f3u) * 0.22 + 0.5 - (1.0 - holeShare)); }
  if (hole > 0.02) {
    F[ph] = clamp(raw + (min(raw, sea - u.frGapDepth) - raw) * hole, u.minH, u.maxH);
    F[pp] = max(F[pp], hole); F[pr] = max(F[pr], hole); F[pv] = min(F[pv], -hole);
    return;
  }
  if (lift == 0.0) { return; }
  F[ph] = clamp(raw + lift, u.minH, u.maxH);
  let keepM = max(strip, seam); F[pp] = max(F[pp], keepM); F[pr] = max(F[pr], keepM); F[pv] = min(F[pv], -keepM);
}

// ---- H10: crystal columns (form 1) and bergs (form 2) ----
// Columns: a mound tiled with flat polygonal columns in a Voronoi pattern of up to three widths (stampColumns in sculpt.js). Each cell evaluates the columns of the
// 3 x 3 lattice neighbours of every width in use itself (the mound is a distance to the stroke's path, cheap to evaluate), so there is no record pass and no thread
// reads another's result. Seg k holds the path point k and the next (the last repeats itself).
var<private> SZL: array<f32, 3> = array<f32, 3>(1.0, 0.55, 0.3);
var<private> SZS: array<f32, 3> = array<f32, 3>(1.0, 0.65, 0.4);
var<private> SZB: array<f32, 3> = array<f32, 3>(1.0, 0.4, 0.0);

fn cgRnd(i: i32, j: i32, a: u32) -> f32 {
  var x = ((bitcast<u32>(i) * 73856093u) ^ (bitcast<u32>(j) * 19349663u) ^ (u.seed + a * 83492791u)) * 2654435761u;
  x = x ^ (x >> 15u); x = x * 2246822519u; x = x ^ (x >> 13u);
  return f32(x) / 4294967296.0;
}
fn cgMound(x: f32, y: f32) -> f32 {
  var d = 3.0e38;
  for (var k = 0u; k < u.nseg; k++) {
    let s0 = Seg[(u.segBase + k) * 4u];
    let a = s0.xy; let dd = s0.zw - s0.xy; let l2 = dot(dd, dd);
    var t = 0.0;
    if (l2 > 0.0) { t = clamp(dot(vec2f(x, y) - a, dd) / l2, 0.0, 1.0); }
    d = min(d, length(vec2f(x, y) - a - dd * t));
  }
  let edge = u.radius * (1.0 + u.rough * 0.35 * vnoise(x / (u.radius * 0.7), y / (u.radius * 0.7), u.seed ^ 0x2c1u));
  let r = d / edge;
  if (r >= 1.0) { return 0.0; }
  return u.amount * pow(1.0 - r * r, 1.2);
}
fn cgLevel(x: f32, y: f32, m: f32) -> i32 {
  if (!(u.cgSizeVar > 0.0)) { return 0; }
  let f = 0.5 + 0.32 * vnoise(x / 64.0, y / 64.0, u.seed ^ 0x51au) + 0.18 * vnoise(x / 27.0, y / 27.0, u.seed ^ 0x2e7u) + 0.3 * (m / u.amount - 0.5);
  if (f > 1.17 - 0.4 * u.cgSizeVar) { return 2; }
  if (f > 0.84 - 0.3 * u.cgSizeVar) { return 1; }
  return 0;
}
// The jittered point of cell (i, j) of size L in the shape's frame (hash salts 1 + o and 2 + o, jit of a cell around its centre), and a point of the frame in the world.
fn cgPoint(i: i32, j: i32, L: f32, jit: f32, o: u32) -> vec2f {
  return vec2f((f32(i) + 0.5 + (cgRnd(i, j, 1u + o) - 0.5) * jit) * L, (f32(j) + 0.5 + (cgRnd(i, j, 2u + o) - 0.5) * jit) * L);
}
fn cgWorld(l: vec2f) -> vec2f {
  if (u.framed == 0u) { return l; }
  let det = u.inv0 * u.inv3 - u.inv1 * u.inv2;
  let a = u.inv3 / det; let b = -u.inv1 / det; let c = -u.inv2 / det; let d = u.inv0 / det;
  let e = -(a * u.inv4 + c * u.inv5); let f = -(b * u.inv4 + d * u.inv5);
  return vec2f(a * l.x + c * l.y + e, b * l.x + d * l.y + f);
}

@compute @workgroup_size(8, 8)
fn stampColumns(@builtin(global_invocation_id) g: vec3u) {
  let x = u.rx0 + i32(g.x); let y = u.ry0 + i32(g.y);
  if (x > u.rx1 || y > u.ry1) { return; }
#ifdef PAGES
  let cells = pcells(); let i = lidx(x, y);
#else
  let cells = u.grid * u.grid; let i = u32(y) * u.grid + u32(x);
#endif
  let wx = f32(x) * u.spacing; let wy = f32(y) * u.spacing;
  var lx = wx; var ly = wy;
  if (u.framed != 0u) { lx = u.inv0 * wx + u.inv2 * wy + u.inv4; ly = u.inv1 * wx + u.inv3 * wy + u.inv5; }
  let levels = select(1, 3, u.cgSizeVar > 0.0);
  var d1 = 3.0e38; var d2 = 3.0e38; var bl = -1; var bi = 0; var bj = 0;
  // The nearest column centre of any width in use here.
  for (var lv = 0; lv < levels; lv++) {
    let Ll = u.cgSize * SZL[lv]; let ci = i32(floor(lx / Ll)); let cj = i32(floor(ly / Ll));
    for (var j = cj - 1; j <= cj + 1; j++) { for (var ii = ci - 1; ii <= ci + 1; ii++) {
      let cl = cgPoint(ii, j, u.cgSize * SZL[lv], 0.9, u32(lv) * 16u); let cw = cgWorld(cl);
      if (levels > 1 && cgLevel(cw.x, cw.y, cgMound(cw.x, cw.y)) != lv) { continue; }
      let d = length(vec2f(lx, ly) - cl);
      if (d < d1) { d2 = d1; d1 = d; bl = lv; bi = ii; bj = j; } else if (d < d2) { d2 = d; }
    } }
  }
  if (bl < 0) {
    // No width in use is near: the widest columns, whatever they asked for.
    let ci = i32(floor(lx / u.cgSize)); let cj = i32(floor(ly / u.cgSize));
    for (var j = cj - 1; j <= cj + 1; j++) { for (var ii = ci - 1; ii <= ci + 1; ii++) {
      let d = length(vec2f(lx, ly) - cgPoint(ii, j, u.cgSize, 0.9, 0u));
      if (d < d1) { d2 = d1; d1 = d; bl = 0; bi = ii; bj = j; } else if (d < d2) { d2 = d; }
    } }
  }
  let o = u32(bl) * 16u;
  let cl = cgPoint(bi, bj, u.cgSize * SZL[bl], 0.9, o); let cw = cgWorld(cl);
  let m = cgMound(cw.x, cw.y);
  if (m <= 1.0) { return; }
  let base = F[PH * cells + i];
  // A bare column is the mound's own smooth hill: no flat top, no crystal mark, no protection.
  if (u.cgSmooth > 0.0 && cgRnd(bi, bj, 12u + o) < u.cgSmooth * SZB[bl]) {
    let hill = cgMound(wx, wy);
    if (hill > 0.5) { F[PH * cells + i] = clamp(base + hill, u.minH, u.maxH); }
    return;
  }
  let e = 2.0;
  let gx = (cgMound(cw.x + e, cw.y) - cgMound(cw.x - e, cw.y)) / (2.0 * e); let gy = (cgMound(cw.x, cw.y + e) - cgMound(cw.x, cw.y - e)) / (2.0 * e);
  var step = 0.0;
  if (!(cgRnd(bi, bj, 3u + o) < 0.4)) { step = (cgRnd(bi, bj, 4u + o) - 0.35) * 2.0 * u.cgStep * (0.5 + u.cgVar) * SZS[bl]; }
  let shade = 0.8 + 0.2 * cgRnd(bi, bj, 5u + o);
  let incline = gx * (wx - cw.x) + gy * (wy - cw.y);
  var top = m + step;
  if (u.cgTiers > 0.0) { top = top + incline * (1.0 - clamp(u.cgTiers, 0.0, 1.0)); } else { top = top + incline; }
  if (u.cgFacet > 0.0) {
    let fa = u.cgFacet;
    let h0 = cgRnd(bi, bj, 6u + o) * 6.2831853; let h1 = h0 + 3.1415927 * (0.5 + cgRnd(bi, bj, 7u + o));
    let m0 = fa * (0.2 + 0.8 * cgRnd(bi, bj, 8u + o)); var m1 = 0.0;
    if (!(cgRnd(bi, bj, 9u + o) < 0.3)) { m1 = fa * (0.2 + 0.8 * cgRnd(bi, bj, 10u + o)); }
    let ox = lx - cl.x; let oy = ly - cl.y;
    let pa = cos(h0) * m0 * ox + sin(h0) * m0 * oy; let pb = cos(h1) * m1 * ox + sin(h1) * m1 * oy;
    if (cgRnd(bi, bj, 11u + o) < 0.5) { top = top + min(pa, pb); } else { top = top + max(pa, pb); }
  }
  let h = max(0.0, top);
  if (h <= 0.5) { return; }
  F[PH * cells + i] = clamp(base + h, u.minH, u.maxH); F[PP * cells + i] = 1.0;
  F[PX * cells + i] = select(shade, 0.5, d2 - d1 < max(1.2, u.spacing * 0.6));
}

// Bergs: per block the lowest of its face planes and broken-corner planes, each outline waving along its face, a tilted top and roughness; the highest block wins.
// Seg k: (x, y, R, height), (index, faces, planes, first plane in the extra table), box.
@compute @workgroup_size(8, 8)
fn stampBerg(@builtin(global_invocation_id) g: vec3u) {
  let x = u.rx0 + i32(g.x); let y = u.ry0 + i32(g.y);
  if (x > u.rx1 || y > u.ry1) { return; }
#ifdef PAGES
  let cells = pcells(); let i = lidx(x, y);
#else
  let cells = u.grid * u.grid; let i = u32(y) * u.grid + u32(x);
#endif
  let wx = f32(x) * u.spacing; let wy = f32(y) * u.spacing;
  var best = 0.0;
  for (var k = 0u; k < u.nseg; k++) {
    let s0 = Seg[(u.segBase + k) * 4u]; let s1 = Seg[(u.segBase + k) * 4u + 1u];
    let bx = bitcast<vec4<i32>>(Seg[(u.segBase + k) * 4u + 3u]);
    if (x < bx.x || x > bx.z || y < bx.y || y > bx.w) { continue; }
    let qx = wx - s0.x; let qy = wy - s0.y; let R = s0.z; let height = s0.w;
    let reach = R * 1.55; let wave = R * (0.02 + 0.12 * u.bgJit);
    var m = (reach - length(vec2f(qx, qy))) * u.bgFace;
    if (m <= 0.0) { continue; }
    let idx = i32(s1.x); let nf = u32(s1.y); let np = u32(s1.z); let at = u.mwBase + u.nwrites + u32(s1.w);
    for (var e = 0u; e < np; e++) {
      let p = MW[at + e];
      var salt = u.seed ^ (0x6a1u + e * 977u);
      if (e >= nf) { salt = u.seed ^ (0x9b3u + (e - nf) * 1301u); }
      let along = -qx * p.y + qy * p.x; let d = p.z + wave * vnoise(along / (R * 0.45), f32(idx) * 7.3, salt);
      m = min(m, (d - (qx * p.x + qy * p.y)) * p.w);
      if (m <= 0.0) { break; }
    }
    if (m <= 0.0) { continue; }
    var h = min(m, height - u.bgTilt * max(0.0, R * u.bgFlat - (qx * u.bgTx + qy * u.bgTy)));
    if (h <= 0.0) { continue; }
    if (u.bgRough > 0.0) {
      let f = vnoise(wx / 40.0, wy / 40.0, u.seed ^ 0x2a1u) * 0.3 + vnoise(wx / 17.0, wy / 17.0, u.seed ^ 0x4c7u) * 0.3 + vnoise(wx / 8.0, wy / 8.0, u.seed ^ 0x6e3u) * 0.28 + vnoise(wx / 4.0, wy / 4.0, u.seed ^ 0x8f9u) * 0.18;
      h = h + u.bgRough * f * sm(0.0, 4.0, h);
    }
    if (h > best) { best = h; }
  }
  if (best <= 0.0) { return; }
  F[PH * cells + i] = clamp(F[PH * cells + i] + best, u.minH, u.maxH);
}

// ---- H10: crater and mountain facets, a pass over the node's own result ----
// facetSnap copies the node's result to plane R; facetApply then re-tiles the cells the node touched (footprint plane W > 0) with Voronoi facets, each the plane through the
// result at the facet's seed (height and slope over 3 cells, read from R inside the footprint and from the prefix B elsewhere). Every read is of R, B or W, which no
// thread of the pass writes, so a repeat run is identical. Reads clamp to the node's box (the host grows it by the seeds' reach).
@compute @workgroup_size(8, 8)
fn facetSnap(@builtin(global_invocation_id) g: vec3u) {
  let x = u.rx0 + i32(g.x); let y = u.ry0 + i32(g.y);
  if (x > u.rx1 || y > u.ry1) { return; }
  let cells = cCells(); let i = cIdx(x, y);
  Sc[CRR * cells + i] = F[PH * cells + i];
}
fn fcAt(gx: i32, gy: i32, cells: u32) -> f32 {
  let j = cIdx(clamp(gx, max(u.coBx0, 0), min(u.coBx1, i32(u.grid) - 1)), clamp(gy, max(u.coBy0, 0), min(u.coBy1, i32(u.grid) - 1)));
  return select(Sc[CB * cells + j], Sc[CRR * cells + j], Sc[CW * cells + j] > 0.0);
}
struct FcSeed { l: vec2f, w: vec2f, h: f32, dx: f32, dy: f32, step: f32, shade: f32, steep: f32, on: bool }
fn fcSeed(i: i32, j: i32, cells: u32) -> FcSeed {
  let L = u.fcL; let crater = u.fcMode == 1u;
  let jit = select(1.0, 0.9, crater);
  let l = cgPoint(i, j, L, jit, 0u); let w = cgWorld(l);
  let gx = i32(floor(w.x / u.spacing + 0.5)); let gy = i32(floor(w.y / u.spacing + 0.5)); let e3 = 3;
  var s: FcSeed; s.l = l; s.w = w;
  s.h = fcAt(gx, gy, cells);
  s.dx = (fcAt(gx + e3, gy, cells) - fcAt(gx - e3, gy, cells)) / (2.0 * 3.0 * u.spacing);
  s.dy = (fcAt(gx, gy + e3, cells) - fcAt(gx, gy - e3, cells)) / (2.0 * 3.0 * u.spacing);
  s.step = 0.0; s.shade = 0.0; s.steep = 1.0; s.on = true;
  if (crater) { s.step = (cgRnd(i, j, 3u) - 0.5) * 2.0 * u.fcStep; s.shade = 0.7 + 0.17 * cgRnd(i, j, 5u); }
  else {
    s.on = cgRnd(i, j, 4u) < u.fcShare;
    s.dx = s.dx + (cgRnd(i, j, 6u) - 0.5) * 0.7; s.dy = s.dy + (cgRnd(i, j, 7u) - 0.5) * 0.7;
    s.steep = 1.1 + 0.3 * cgRnd(i, j, 5u); s.step = (cgRnd(i, j, 3u) - 0.2) * 10.0;
  }
  return s;
}
@compute @workgroup_size(8, 8)
fn facetApply(@builtin(global_invocation_id) g: vec3u) {
  let x = u.rx0 + i32(g.x); let y = u.ry0 + i32(g.y);
  if (x > u.rx1 || y > u.ry1) { return; }
  let cells = cCells(); let i = cIdx(x, y);
  if (!(Sc[CW * cells + i] > 0.0)) { return; }
  let snap = Sc[CRR * cells + i]; let base = Sc[CB * cells + i]; let relief = snap - base;
  let crater = u.fcMode == 1u;
  if (crater) { if (abs(relief) < 0.6) { return; } } else { if (relief < 2.0) { return; } }
  let wx = f32(x) * u.spacing; let wy = f32(y) * u.spacing;
  var lx = wx; var ly = wy;
  if (u.framed != 0u) { lx = u.inv0 * wx + u.inv2 * wy + u.inv4; ly = u.inv1 * wx + u.inv3 * wy + u.inv5; }
  let L = u.fcL; let ci = i32(floor(lx / L)); let cj = i32(floor(ly / L));
  var d1 = 3.0e38; var d2 = 3.0e38; var bi = 0; var bj = 0;
  for (var j = cj - 1; j <= cj + 1; j++) { for (var ii = ci - 1; ii <= ci + 1; ii++) {
    let d = length(vec2f(lx, ly) - cgPoint(ii, j, L, select(1.0, 0.9, crater), 0u));
    if (d < d1) { d2 = d1; d1 = d; bi = ii; bj = j; } else if (d < d2) { d2 = d; }
  } }
  let s = fcSeed(bi, bj, cells);
  if (crater) {
    let facet = s.h + s.dx * (wx - s.w.x) + s.dy * (wy - s.w.y) + s.step * sm(0.0, 4.0, abs(relief));
    let value = snap + (facet - snap) * u.fcStrength;
    F[PH * cells + i] = clamp(select(value, max(value, u.sea + 1.5), base > u.sea + 1.0), u.minH, u.maxH);
    if (abs(relief) >= 2.0) {
      F[PP * cells + i] = 1.0;
      if (u.fcSkin != 0u) { F[PX * cells + i] = 0.74; } else { F[PX * cells + i] = select(s.shade, 0.5, d2 - d1 < max(1.2, u.spacing * 0.6)); }
    }
    return;
  }
  if (!s.on) { return; }
  let plane = s.h + (s.dx * (wx - s.w.x) + s.dy * (wy - s.w.y)) * s.steep + s.step * sm(0.0, 10.0, relief);
  let value = max(plane, base); let fade = sm(2.0, 10.0, relief);
  F[PH * cells + i] = clamp(snap + (value - snap) * fade, u.minH, u.maxH);
}
