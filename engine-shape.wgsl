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

// hillSection(): the shouldered hill's cross-section: a smoothstep to 0.67 of the way across, then a monotone cubic Hermite through
// the knots (0.67, 0.78, 0.89, 1) at rises (1, 0.34, 0.02, 0); the host passes the tangents.
fn hillSection(t: f32) -> f32 {
  if (t <= 0.0 || t >= 1.0) { return 0.0; }
  if (t <= 0.67) { return sm(0.0, 0.67, t); }
  var knots = array<f32, 4>(0.67, 0.78, 0.89, 1.0);
  var rise = array<f32, 4>(1.0, 0.34, 0.02, 0.0);
  var tan = array<f32, 4>(u.tg0, u.tg1, u.tg2, u.tg3);
  var k = 0;
  loop { if (!(knots[k + 1] < t)) { break; } k = k + 1; }
  let width = knots[k + 1] - knots[k]; let uu = (t - knots[k]) / width; let u2 = uu * uu; let u3 = u2 * uu;
  return (2.0 * u3 - 3.0 * u2 + 1.0) * rise[k] + (u3 - 2.0 * u2 + uu) * width * tan[k]
       + (-2.0 * u3 + 3.0 * u2) * rise[k + 1] + (u3 - u2) * width * tan[k + 1];
}

// One thread per cell: every capsule of the node in order. Kinds: 0 paint 1 erase 2 deep 3 shallow 4 mountain 5 hill.
// A hill with settle != 0 only writes its raw weights (Sc plane 0); blur and compose passes finish it.
// H9 parametric cross-section (card C1: sectionSetup, crossSection, landSection, waterSection, faceRise, terrace in sculpt.js). u.s* hold the stroke's section
// constants; the per-cell inputs are the noise tables kw/ka (coast width, shelf) and nj/nA/nB (coast x, coast y, x). sLift carries the lip back to the caller.
var<private> sLift: f32 = 0.0;
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
fn faceRise(d: f32, A: f32, F: f32, pt: f32, n: u32, nj: f32, nA: f32, nB: f32) -> f32 {
  if (d <= 0.0) { return 0.0; }
  var ah = 0.0;
  if (A > 0.0) { ah = min(u.sApronH, 0.9 * pt); }
  if (d < A) { return ah * pow(d / A, 1.5); }
  if (d >= A + F) { return pt; }
  let t = (d - A) / F; let k = abs(u.sCurve);
  var g = sm(0.0, 1.0, t);
  if (k > 0.0) {
    var c = pow(t, 2.4);
    if (u.sCurve > 0.0) { c = 1.0 - pow(1.0 - t, 2.4); }
    g = g + (c - g) * k;
  }
  var lev = g;
  if (n > 0u) { lev = terrace(g, n, nj, nA, nB); }
  return ah + (pt - ah) * lev;
}
fn lipRim(t: f32, F: f32) -> f32 {
  if (t >= 0.0) { return 1.0 - sm(0.0, 0.45 * F, t); }
  return 1.0 - sm(0.0, clamp(0.4 * F, 5.0, 30.0), -t);
}
fn landSection(d: f32, reach: f32, kw: f32, ka: f32, nj: f32, nA: f32, nB: f32) -> f32 {
  var A = u.sApron * ka;
  var Fw = u.sShare * reach;
  if (u.sFace > 0.0) { Fw = u.sFace; } else if (u.sDome != 0u) { Fw = max((1.0 - u.sCapW) * reach - u.sApron, 0.1 * reach); }
  Fw = Fw * kw;
  if (A + Fw > 0.98 * reach) { let k = 0.98 * reach / (A + Fw); A = A * k; Fw = Fw * k; }
  let top = A + Fw; let pt = 1.0 - u.sCapRise;
  var p = 1.0;
  if (d < top) { p = faceRise(d, A, Fw, pt, u.sSteps, nj, nA, nB); }
  else if (u.sCapRise > 0.0) { p = pt + u.sCapRise * (1.0 - pow(1.0 - min((d - top) / max(reach - top, 1e-3), 1.0), u.sCapExp)); }
  sLift = 0.0;
  if (u.sLip != 0.0) { sLift = u.sLip * lipRim(top - d, Fw); }
  return p;
}
fn waterSection(d: f32, reach: f32, base: f32, kw: f32, ka: f32, nj: f32, nA: f32, nB: f32) -> f32 {
  let sea = u.sea;
  var A = u.sApron * ka;
  var Fw = 0.0;
  if (u.sFace > 0.0) { Fw = u.sFace; } else if (u.sBank > 0.0) { Fw = max(u.sBank - u.sApron, 6.0); } else { Fw = 0.4 * reach; }
  Fw = Fw * kw;
  var S = 0.0;
  if (u.sShelf > 0.0 && u.sShelfD > 0.0) { S = u.sShelf * ka; }
  var I = 0.0;
  if (u.sLip != 0.0) { I = clamp(0.4 * Fw, 5.0, 30.0); }
  let total = I + A + Fw + S;
  if (total > 0.92 * reach) { let k = 0.92 * reach / total; I = I * k; A = A * k; Fw = Fw * k; S = S * k; }
  let B = A + Fw; let rest = I + B + S; let depth = min(u.sShelfD, 0.7 * (sea - u.sBed));
  var v = 0.0;
  if (d < I) { v = base; }
  else if (d < I + B) { let p = faceRise(B - (d - I), A, Fw, 1.0, u.sSteps, nj, nA, nB); if (base > sea) { v = sea + (base - sea) * p; } else { v = base; } }
  else if (d < rest) {
    let t = (d - I - B) / S;
    var drop = sm(0.0, 0.35, t);
    if (u.sShelfSteps > 0u) { drop = 1.0 - terrace(1.0 - t, u.sShelfSteps, nj, nA, nB); }
    v = min(base, sea - depth * drop);
  } else {
    var top = sea; if (S > 0.0) { top = sea - depth; }
    v = min(base, top + (u.sBed - top) * sm(0.0, 1.0, (d - rest) / (0.7 * (reach - rest))));
  }
  sLift = 0.0;
  if (u.sLip != 0.0) { sLift = u.sLip * lipRim(d - I, Fw); }
  return v;
}
// The one call the stamps make: the weight w for the cell whose outline reaches `reach` px, r of the way out; the lip is left in sLift.
fn crossSection(r: f32, reach: f32, base: f32, nCW: f32, nShelf: f32, nj: f32, nA: f32, nB: f32) -> f32 {
  sLift = 0.0;
  let d = (1.0 - r) * reach;
  if (d <= 0.0) { return 0.0; }
  let kw = clamp(1.0 + u.sVary * nCW, 0.4, 1.8); let ka = clamp(1.0 + u.sVary * nShelf, 0.4, 1.8);
  if (u.sWater == 0u) { return landSection(d, reach, kw, ka, nj, nA, nB); }
  if (base - u.sBed < 0.5) { return 0.0; }
  return clamp((base - waterSection(d, reach, base, kw, ka, nj, nA, nB)) / (base - u.sBed), 0.0, 1.0);
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
  var best = 0.0; var bw = 0.0; var br = 0.0; var bcore = 0.0; var dist = 3.0e38; var visited = false; var blift = 0.0;
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
    if (kind == 2u && u.natural != 0u) { width = clamp(1.0 + u.rough * 1.6 * nCW, 0.45, 1.9); }
    else if (kind == 0u || kind == 1u) { width = clamp(1.0 + u.rough * 1.3 * nCW, 0.55, 1.7); }
    var r = sqrt(dx * dx + dy * dy) / (radius * width * u.bankScale);
    if (u.ridge != 0u) { r = r / (s1.x + (s1.y - s1.x) * t); }
    var lobe = 0.0;
    if (u.olAmp > 0.0) { let shift = outlineShift(r, lx, ly) / (width * u.bankScale); r = r - shift; if (u.olMoon != 0u) { lobe = shift; } }
    var core = 0.0;
    if (kind == 2u && u.natural != 0u) { core = 1.0 - sm(0.20, u.coreEdge, sqrt((wx - cx) * (wx - cx) + (wy - cy) * (wy - cy)) / radius); }
    if (r >= 1.0 && core == 0.0 && !shouldered) { continue; }
    var w = 0.0;
    if (kind == 0u || kind == 1u) {
      // Plateau-like edge: a broad-scale face-width variation, the north foreshortening term, then the shoulder.
      let broad = vnoise(lx / (radius * 1.3), ly / (radius * 1.3), u.seed ^ 0x5f1u);
      let shoulder0 = clamp(0.56 + u.rough * (nDet + 0.30 * nCW) + u.faceVar * 0.22 * broad, 0.18, 0.88);
      var north = 0.0;
      if (u.northWiden > 0.0) { north = max(0.0, -(wy - cy)) / max(1e-3, sqrt((wx - cx) * (wx - cx) + (wy - cy) * (wy - cy))); }
      let shoulder = clamp(shoulder0 - (u.softness - 0.5) * 0.6 - u.northWiden * 0.32 * north * north, 0.12, 0.90);
      w = 1.0 - sm(shoulder, 1.0, r);
    } else if (kind == 2u || kind == 3u) {
      w = 1.0 - sm(0.10, 1.0, r);
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
      var section = 0.0;
      if (u.softness == 0.5) { section = (cross + 1.34) / 2.0; }
      else if (cross < 0.0) { section = 0.67 * (1.0 + cross / u.backWidth); }
      else { section = 0.67 + 0.33 * cross / u.faceWidth; }
      if (side2 > vv * vv) { let q = 1.0 - vv * vv / side2; w = hillSection(section) * q * q; }
    } else {
      w = pow(1.0 - r * r, u.mexp);
    }
    var lift = 0.0;
    if (u.sOn != 0u) {
      w = crossSection(r, radius * width * u.bankScale, F[PH * cells + i], nCW, nShelf, nzF(3u, x, y, i, cells), nzF(4u, x, y, i, cells), nzF(0u, x, y, i, cells));
      lift = sLift;
    }
    if (u.ridge != 0u) { w = w * ridgeRise(s1.z, s1.w, s2.w, t, lx, ly, wx, wy); }
    if (kind == 4u || (kind == 5u && !shouldered)) { w = clamp(w * (1.0 + u.rough * 0.09 * nDet), 0.0, 1.0); }
    let influence = max(w, core);
    if (!shouldered && influence <= best) { continue; }
    best = influence; bw = w; br = r; bcore = core; blift = lift; visited = true;
  }
  if (!visited) {
    if (u.settle != 0u) { Sc[i] = 0.0; }
    return;
  }
  if (u.settle != 0u) { Sc[i] = best; return; }
  let influence = best; let w = bw;
  let base = F[PH * cells + i];
  var value = base;
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
    value = base + u.amount * w;
    value = value + baseBump(lx, ly, w);
  } else if (kind == 5u) {
    value = base + u.amount * w;
    if (u.plain == 0u) { value = base + u.amount * w * (1.0 + u.rough * (0.75 * nCW + 0.30 * nDet)); }
    value = value + baseBump(lx, ly, w);
  } else {
    var bed = u.sea + select(-7.0, -55.0, kind == 2u);
    if (kind == 2u && u.natural != 0u) { bed = bed + 42.0 * (sm(-0.15, 0.55, nShelf) * sm(0.08, 0.50, br)) * u.shelves; }
    value = base + (bed - base) * w;
    if (kind == 2u && u.natural != 0u && bcore != 0.0) { value = min(value, base + (u.sea - 55.0 - base) * bcore); }
    if (u.sOn == 0u && u.beachFlat != 0.5 && base > u.sea && base <= u.baseH + 1.0 && value > u.sea) {
      let above = (value - u.sea) / (base - u.sea);
      value = u.sea + (base - u.sea) * pow(above, exp2((u.beachFlat - 0.5) * 2.4));
    }
    if (kind == 3u && u.passage != 0u) { value = max(base, value); }
  }
  if (u.sOn != 0u) { value = value + blift; }
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
  let lift = 1.0 + u.rough * (0.75 * nzCell(5u, x, y, i, cells) + 0.30 * nzCell(2u, x, y, i, cells));
#else
  let lift = 1.0 + u.rough * (0.75 * Nz[5u * cells + i] + 0.30 * Nz[2u * cells + i]);
#endif
  F[PH * cells + i] = clamp(F[PH * cells + i] + u.amount * joined * lift, u.minH, u.maxH);
  if (u.nwrites > 0u && raw > 0.0) { shapeMasks(i, raw); }
  F[PP * cells + i] = F[PP * cells + i] * (1.0 - joined);
  F[PR * cells + i] = F[PR * cells + i] * (1.0 - joined);
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
  var best = 0.0; var visited = false; var blift = 0.0;
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
    if (natural) { width = clamp(1.0 + u.rough * 1.3 * nCW, 0.55, 1.7); }
    var r = sqrt(dx * dx + dy * dy) / (radius * width * u.bankScale);
    if (u.olAmp > 0.0) { r = r - outlineShift(r, lx, ly) / (width * u.bankScale); }
    if (r >= 1.0) { continue; }
    var w = 0.0; var lift = 0.0;
    if (natural) {
      let broad = vnoise(lx / (radius * 1.3), ly / (radius * 1.3), u.seed ^ 0x5f1u);
      let shoulder0 = clamp(0.56 + u.rough * (nDet + 0.30 * nCW) + u.faceVar * 0.22 * broad, 0.18, 0.88);
      var north = 0.0;
      if (u.northWiden > 0.0) { north = max(0.0, -(wy - cy)) / max(1e-3, sqrt((wx - cx) * (wx - cx) + (wy - cy) * (wy - cy))); }
      let shoulder = clamp(shoulder0 - (u.softness - 0.5) * 0.6 - u.northWiden * 0.32 * north * north, 0.12, 0.90);
      w = 1.0 - sm(shoulder, 1.0, r);
      if (kind == 6u && u.mesaFlank > 0.0) {
        let cap = shoulder * (1.0 - 0.45 * u.mesaFlank); let tt = clamp((r - cap) / (1.0 - cap), 0.0, 1.0);
        w = w + ((1.0 - tt) * (1.0 - tt) + (1.0 - sm(0.0, 1.0, tt)) * tt - w) * u.mesaFlank;
      }
    } else {
      w = 1.0 - sm(0.0, 1.0, r);
      if (kind == 8u) { w = clamp(w * (1.0 + u.rough * 0.09 * nDet), 0.0, 1.0); }
    }
    if (u.sOn != 0u) {
      w = crossSection(r, radius * width * u.bankScale, F[PH * cells + i], nCW, nzF(6u, x, y, i, cells), nzF(3u, x, y, i, cells), nzF(4u, x, y, i, cells), nzF(0u, x, y, i, cells));
      lift = sLift;
    }
    if (w <= best) { continue; }
    best = w; blift = lift; visited = true;
  }
  if (!visited) { return; }
  let w = best;
  let base = F[PH * cells + i];
  let pbase = F[PP * cells + i];
  var value = base;
  if (kind == 6u) { value = base + (PT[u.preIdx] + u.amount + u.rough * 3.0 * nDet - base) * w; }
  else if (kind == 7u) { value = base + u.amount * w; }
  else if (kind == 8u) { value = base - u.amount * w; }
  else if (kind == 9u || kind == 10u) {
    let tv = select(-1.0, 1.0, kind == 9u); let vb = F[PV * cells + i];
    F[PV * cells + i] = vb + (tv - vb) * w * u.amountPct;
  }
  else if (kind == 11u) { value = base + (Sc[2u * cells + i] - base) * w * u.amountPct; }
  value = value + baseBump(lx, ly, w);
  if (u.sOn != 0u) { value = value + blift; }
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
  var bestD = 3.0e38; var along = 0.0; var total = 1.0; var hit = false;
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
    bestD = dist; along = s1.x + t * s1.y; total = s1.z; hit = true;
  }
  if (!hit) { return; }
  let w = 1.0 - sm(0.55, 1.0, bestD / radius);
  let tt = clamp(along / total, 0.0, 1.0);
  let ease = min(0.18, radius / total);
  var grade = (tt - ease * 0.5) / (1.0 - ease);
  if (tt < ease) { grade = tt * tt / (2.0 * ease * (1.0 - ease)); }
  else if (tt > 1.0 - ease) { grade = 1.0 - (1.0 - tt) * (1.0 - tt) / (2.0 * ease * (1.0 - ease)); }
  let ah = PT[u.preIdx]; let bh = PT[u.preIdx + 1u];
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
