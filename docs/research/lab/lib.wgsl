// Terrain lab: the shared WGSL library every experiment can call. Integer hashes only, so every run on a machine gives
// the same bytes, and every function is a pure function of world position (px) unless its name says otherwise.
// Units: x, y in world art pixels; heights in TA height units (the engine's: a slope of 1 is one unit per pixel).

const TAU = 6.2831853;
const PI = 3.14159265;

// ---- hashes ------------------------------------------------------------------------------------------------------
fn pcg(v: u32) -> u32 {
  let s = v * 747796405u + 2891336453u;
  let w = ((s >> ((s >> 28u) + 4u)) ^ s) * 277803737u;
  return (w >> 22u) ^ w;
}
fn hash2u(x: i32, y: i32, s: u32) -> u32 { return pcg(bitcast<u32>(x) ^ pcg(bitcast<u32>(y) ^ pcg(s))); }
// Uniform in [0, 1).
fn h01(x: i32, y: i32, s: u32) -> f32 { return f32(hash2u(x, y, s) >> 8u) / 16777216.0; }
// Uniform in [-1, 1).
fn hs(x: i32, y: i32, s: u32) -> f32 { return h01(x, y, s) * 2.0 - 1.0; }
fn h2(c: vec2i, s: u32) -> vec2f { return vec2f(h01(c.x, c.y, s), h01(c.x, c.y, s ^ 0x9e3779b9u)); }
fn h1i(i: i32, s: u32) -> f32 { return h01(i, 0x5bd1e995, s); }

fn sstep(a: f32, b: f32, v: f32) -> f32 { let t = clamp((v - a) / (b - a), 0.0, 1.0); return t * t * (3.0 - 2.0 * t); }
fn rot(v: vec2f, a: f32) -> vec2f { let c = cos(a); let s = sin(a); return vec2f(c * v.x - s * v.y, s * v.x + c * v.y); }
// Polynomial smooth minimum and maximum (k in the same units as a and b).
fn smin(a: f32, b: f32, k: f32) -> f32 { let h = max(k - abs(a - b), 0.0) / max(k, 1e-6); return min(a, b) - h * h * k * 0.25; }
fn smax(a: f32, b: f32, k: f32) -> f32 { return -smin(-a, -b, k); }

// ---- value noise with analytic derivative (quintic): returns (value in [-1, 1], d/dx, d/dy) ------------------------
fn vnoised(p: vec2f, s: u32) -> vec3f {
  let i = vec2i(floor(p)); let f = fract(p);
  let u = f * f * f * (f * (f * 6.0 - 15.0) + 10.0);
  let du = 30.0 * f * f * (f * (f - 2.0) + 1.0);
  let a = hs(i.x, i.y, s); let b = hs(i.x + 1, i.y, s); let c = hs(i.x, i.y + 1, s); let d = hs(i.x + 1, i.y + 1, s);
  let k1 = b - a; let k2 = c - a; let k4 = a - b - c + d;
  return vec3f(a + k1 * u.x + k2 * u.y + k4 * u.x * u.y, du * vec2f(k1 + k4 * u.y, k2 + k4 * u.x));
}
fn vnoise(p: vec2f, s: u32) -> f32 { return vnoised(p, s).x; }

// ---- gradient noise with analytic derivative: (value about [-1, 1], d/dx, d/dy) ------------------------------------
fn grad2(c: vec2i, s: u32) -> vec2f { let a = h01(c.x, c.y, s) * TAU; return vec2f(cos(a), sin(a)); }
fn gnoised(p: vec2f, s: u32) -> vec3f {
  let i = vec2i(floor(p)); let f = fract(p);
  let u = f * f * f * (f * (f * 6.0 - 15.0) + 10.0);
  let du = 30.0 * f * f * (f * (f - 2.0) + 1.0);
  let ga = grad2(i, s); let gb = grad2(i + vec2i(1, 0), s); let gc = grad2(i + vec2i(0, 1), s); let gd = grad2(i + vec2i(1, 1), s);
  let va = dot(ga, f); let vb = dot(gb, f - vec2f(1.0, 0.0)); let vc = dot(gc, f - vec2f(0.0, 1.0)); let vd = dot(gd, f - vec2f(1.0, 1.0));
  let v = va + u.x * (vb - va) + u.y * (vc - va) + u.x * u.y * (va - vb - vc + vd);
  let d = ga + u.x * (gb - ga) + u.y * (gc - ga) + u.x * u.y * (ga - gb - gc + gd)
        + du * (u.yx * (va - vb - vc + vd) + vec2f(vb, vc) - va);
  return vec3f(v * 1.6, d * 1.6);
}

// fBm of gradient noise. `damp` > 0 damps each octave by 1 / (1 + damp |sum of gradients|^2) (eroded-looking fBm,
// the derivative idea; chain rule done properly: gradients are in world units). Returns (value, d/dx, d/dy).
fn fbmd(p: vec2f, wavelength: f32, octaves: i32, gain: f32, damp: f32, s: u32) -> vec3f {
  var f = 1.0 / wavelength; var a = 1.0; var sum = vec3f(0.0); var dsum = vec2f(0.0);
  for (var o = 0; o < octaves; o++) {
    let n = gnoised(p * f, s + u32(o) * 1013u);
    let g = n.yz * f;                     // world-unit gradient of this octave
    let w = 1.0 / (1.0 + damp * dot(dsum, dsum));
    sum += a * w * vec3f(n.x, g);
    dsum += a * g;
    f *= 2.0; a *= gain;
  }
  return sum;
}
fn fbm(p: vec2f, wavelength: f32, octaves: i32, gain: f32, s: u32) -> f32 { return fbmd(p, wavelength, octaves, gain, 0.0, s).x; }

// Band-limited fBm: octaves whose wavelength falls under `px` (the size of one output pixel in world px, lab.px) fade
// out instead of aliasing, so the same function renders at any resolution (resolution independence by octave fade).
fn fbmBL(p: vec2f, wavelength: f32, octaves: i32, gain: f32, px: f32, s: u32) -> f32 {
  var f = 1.0 / wavelength; var a = 1.0; var sum = 0.0;
  for (var o = 0; o < octaves; o++) {
    let keep = 1.0 - sstep(0.25, 0.5, f * px);   // fade from 4 px per cycle down to 2
    if (keep <= 0.0) { break; }
    sum += a * keep * gnoised(p * f, s + u32(o) * 1013u).x;
    f *= 2.0; a *= gain;
  }
  return sum;
}

// ---- Voronoi (cellular) -------------------------------------------------------------------------------------------
// Jittered points on a lattice of `cell` px (jitter 0..1). Returns F1, F2, and the nearest point and its cell.
struct Vor { f1: f32, f2: f32, c1: vec2f, id1: vec2i, c2: vec2f, id2: vec2i };
fn voronoi(p: vec2f, cell: f32, jitter: f32, s: u32) -> Vor {
  let q = p / cell; let b = vec2i(floor(q));
  var r: Vor; r.f1 = 1e9; r.f2 = 1e9;
  for (var j = -2; j <= 2; j++) { for (var i = -2; i <= 2; i++) {
    let c = b + vec2i(i, j);
    let pt = (vec2f(c) + 0.5 + (h2(c, s) - 0.5) * jitter) * cell;
    let d = length(p - pt);
    if (d < r.f1) { r.f2 = r.f1; r.c2 = r.c1; r.id2 = r.id1; r.f1 = d; r.c1 = pt; r.id1 = c; }
    else if (d < r.f2) { r.f2 = d; r.c2 = pt; r.id2 = c; }
  } }
  return r;
}
// Distance to the nearest Voronoi edge (exact, two-pass), in px.
fn voronoiEdge(p: vec2f, cell: f32, jitter: f32, s: u32) -> f32 {
  let v = voronoi(p, cell, jitter, s);
  let q = p / cell; let b = vec2i(floor(q));
  var md = 1e9;
  for (var j = -2; j <= 2; j++) { for (var i = -2; i <= 2; i++) {
    let c = b + vec2i(i, j);
    let pt = (vec2f(c) + 0.5 + (h2(c, s) - 0.5) * jitter) * cell;
    if (all(c == v.id1)) { continue; }
    let m = 0.5 * (v.c1 + pt); let n = normalize(pt - v.c1);
    md = min(md, dot(m - p, n));
  } }
  return md;
}

// ---- distances --------------------------------------------------------------------------------------------------
fn segDist(p: vec2f, a: vec2f, b: vec2f) -> f32 { let ab = b - a; let t = clamp(dot(p - a, ab) / dot(ab, ab), 0.0, 1.0); return length(p - a - ab * t); }
// Signed distance to a rounded box centred at c with half size hb, rotated by ang.
fn sdBox(p: vec2f, c: vec2f, hb: vec2f, ang: f32, r: f32) -> f32 {
  let q = abs(rot(p - c, -ang)) - hb + r;
  return length(max(q, vec2f(0.0))) + min(max(q.x, q.y), 0.0) - r;
}

// ---- strata ------------------------------------------------------------------------------------------------------
// A layered rock column, tilted: the bed coordinate of the point (x, y, z) for beds `thick` units thick that dip `dip`
// (height units per px) toward `dir` (unit). Returns (bed index, position inside the bed 0..1).
fn bedAt(p: vec2f, z: f32, thick: f32, dip: f32, dir: vec2f) -> vec2f {
  let c = (z + dip * dot(p, dir)) / thick;
  return vec2f(floor(c), fract(c));
}
// A bed's hardness 0..1 from its index: alternating hard and soft beds with a little variety (hardShare: the share
// of beds that are hard).
fn bedHardness(bed: f32, hardShare: f32, s: u32) -> f32 {
  let r = h1i(i32(bed), s);
  return select(0.15 + 0.2 * r, 0.75 + 0.25 * r, r < hardShare);
}

// ---- slope-aligned gullies (the first round's filter, docs/research/gully-filter.html) ---------------------------
// The four nearest jittered cells, smooth weights, (cos, sin) summed and normalised: stripes whose crests run along dir.
fn stripes(p: vec2f, dir: vec2f, f: f32, seed: u32) -> vec2f {
  let perp = vec2f(-dir.y, dir.x);
  let q = p * f; let c0 = floor(q - 0.5); let fr = q - 0.5 - c0;
  var acc = vec2f(0.0);
  for (var j = 0; j <= 1; j++) { for (var i = 0; i <= 1; i++) {
    let cell = vec2i(c0) + vec2i(i, j);
    let o = q - (vec2f(cell) + 0.5 + (h2(cell, seed) - 0.5) * 0.7);
    let wx = select(1.0 - fr.x, fr.x, i == 1); let wy = select(1.0 - fr.y, fr.y, j == 1);
    let w = wx * wx * (3.0 - 2.0 * wx) * wy * wy * (3.0 - 2.0 * wy);
    let ph = TAU * dot(o, perp);
    acc += w * vec2f(cos(ph), sin(ph));
  } }
  let l = length(acc);
  return select(vec2f(1.0, 0.0), acc / l, l > 1e-5);
}
// Branching gullies cut into a height h0 whose fall line is steer (any length) and slope magnitude slope0.
// wave0: first wavelength (px); depth: depth per wavelength per unit slope; octaves; minWave: stop below this.
fn gullies(p: vec2f, h0: f32, steer: vec2f, slope0: f32, wave0: f32, depth: f32, octaves: i32, minWave: f32, seed: u32) -> f32 {
  return gulliesF(p, h0, steer, slope0, wave0, depth, octaves, minWave, seed, 1.0, 0.5);
}
// fold +1: sharp crests and round floors (round 1); fold -1: round crests and sharp, V-cut floors, the soil-mantled form that
// realism.py scores closer to real lidar. gain: each octave's depth against the one before (0.5 in round 1).
fn gulliesF(p: vec2f, h0: f32, steer: vec2f, slope0: f32, wave0: f32, depth: f32, octaves: i32, minWave: f32, seed: u32, fold: f32, gain: f32) -> f32 {
  if (length(steer) < 1e-6) { return h0; }
  var h = h0; var g = normalize(steer) * max(slope0, 1e-3);
  var f = 1.0 / wave0; var dk = depth;
  for (var k = 0; k < octaves; k++) {
    if (1.0 / f < minWave) { break; }
    let s = length(g); if (s < 1e-5) { break; }
    let dir = g / s; let perp = vec2f(-dir.y, dir.x);
    let cs = stripes(p, dir, f, seed + u32(k) * 0x3c6ef35fu);
    let a = dk * (1.0 / f) * min(slope0, 1.6);
    h += fold * a * (0.5 - abs(cs.y));
    g += -fold * a * sign(cs.y) * cs.x * TAU * f * perp;
    f *= 2.0; dk *= gain;
  }
  return h;
}
