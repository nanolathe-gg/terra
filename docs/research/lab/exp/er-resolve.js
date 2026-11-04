// er-resolve: what stays the same at half, 1x, 2x and 4x, and what does not.
//
// The height is a small construction tree of feature primitives evaluated per point (after Genevaux et al. 2015, "Terrain
// modelling from feature primitives": each primitive is an elevation and a weight, combined by add, replace and carve
// operators). Everything is carried as a dual number (value, d/dx, d/dy), so the normal comes from the same evaluation as the
// height (no neighbour taps), and every octave is band-limited by the output pixel (lib.wgsl fbmBL's rule) so the same
// function renders at any scale without aliasing:
//   ground   derivative-damped gradient fBm (band-limited)
//   range    a ridge chain's soft distance through the engine's swept curve, lumps, and gullies() with its gradient
//   mesa     replace: a rounded box raised to a fixed top, ragged edge
//   valley   carve-to (decision 24's cut-to): the valley floor plus a profile of the distance to its line: V (fluvial),
//            U (glacial, parabolic), or V with fluvial terraces (flat treads, steep risers)
// Then a simulation that is not a pure function of position: multi-scale thermal (er-talus) with its strides in world px, so
// its result converges to the same shape at every scale, and its height change is stored and differenced for the normal.
// lattice > 0 runs the coarse levels on a lattice of that many world px only (1/64 of the cells at 8 px), upsamples the
// change bilinearly under the full-resolution primitives, and finishes with the fine levels (Schott et al. 2024's
// amplification order: coarse simulation, then detail, then a short fine simulation).
// Own code from the published ideas.
export const treeWgsl = /* wgsl */`
// ---- dual numbers: (value, d/dx, d/dy) ----
fn dk(v: f32) -> vec3f { return vec3f(v, 0.0, 0.0); }
fn dmul(a: vec3f, b: vec3f) -> vec3f { return vec3f(a.x * b.x, a.x * b.yz + b.x * a.yz); }
fn dss(e0: f32, e1: f32, a: vec3f) -> vec3f {
  let u = (a.x - e0) / (e1 - e0); let t = clamp(u, 0.0, 1.0);
  let dt = select(0.0, 1.0 / (e1 - e0), u > 0.0 && u < 1.0);
  return vec3f(t * t * (3.0 - 2.0 * t), 6.0 * t * (1.0 - t) * dt * a.yz);
}
fn dmix(a: vec3f, b: vec3f, t: vec3f) -> vec3f { return vec3f(mix(a.x, b.x, t.x), mix(a.yz, b.yz, t.x) + (b.x - a.x) * t.yz); }
fn dsmin(a: vec3f, b: vec3f, k: f32) -> vec3f {
  let h = max(k - abs(a.x - b.x), 0.0) / k;
  let lo = select(b, a, a.x < b.x); let hi = select(a, b, a.x < b.x);
  return vec3f(lo.x - h * h * k * 0.25, (1.0 - 0.5 * h) * lo.yz + 0.5 * h * hi.yz);
}
fn dsmax(a: vec3f, b: vec3f, k: f32) -> vec3f { return -dsmin(-a, -b, k); }
fn dseg(p: vec2f, a: vec2f, b: vec2f) -> vec3f {
  let ab = b - a; let t = clamp(dot(p - a, ab) / dot(ab, ab), 0.0, 1.0);
  let v = p - a - ab * t; let d = length(v);
  return vec3f(d, select(vec2f(0.0), v / d, d > 1e-6));
}
// Band-limited, derivative-damped fBm as a dual number (the damping weight's own derivative is left out, as in lib fbmd).
fn fbmDBL(p: vec2f, wavelength: f32, octaves: i32, gain: f32, damp: f32, s: u32) -> vec3f {
  var f = 1.0 / wavelength; var a = 1.0; var sum = vec3f(0.0); var dsum = vec2f(0.0);
  for (var o = 0; o < octaves; o++) {
    let keep = select(1.0, 1.0 - sstep(0.25, 0.5, f * labPx()), prm.bandlimit > 0.5);
    if (keep <= 0.0) { break; }
    let n = gnoised(p * f, s + u32(o) * 1013u);
    let g = n.yz * f;
    let w = 1.0 / (1.0 + damp * dot(dsum, dsum));
    sum += a * keep * w * vec3f(n.x, g);
    dsum += a * g;
    f *= 2.0; a *= gain;
  }
  return sum;
}
// lib.wgsl gullies() with the gradient of what it adds (the stripes' own normalisation left out).
fn gulliesD(p: vec2f, steer: vec2f, slope0: f32, wave0: f32, depth: f32, octaves: i32, seed: u32) -> vec3f {
  if (length(steer) < 1e-6 || slope0 < 1e-4) { return vec3f(0.0); }
  var h = 0.0; var g = normalize(steer) * slope0; let g0 = g;
  var f = 1.0 / wave0; var dk_ = depth;
  for (var k = 0; k < octaves; k++) {
    let keep = select(1.0, 1.0 - sstep(0.25, 0.5, f * labPx()), prm.bandlimit > 0.5);
    if (keep <= 0.0) { break; }
    let s = length(g); if (s < 1e-5) { break; }
    let dir = g / s; let perp = vec2f(-dir.y, dir.x);
    let cs = stripes(p, dir, f, seed + u32(k) * 0x3c6ef35fu);
    let a = keep * dk_ * (1.0 / f) * min(slope0, 1.6);
    h += a * (0.5 - abs(cs.y));
    g += -a * sign(cs.y) * cs.x * TAU * f * perp;
    f *= 2.0; dk_ *= 0.5;
  }
  return vec3f(h, g - g0);
}
var<private> RP: array<vec2f, 4> = array<vec2f, 4>(vec2f(-80.0, 150.0), vec2f(140.0, 105.0), vec2f(360.0, 150.0), vec2f(640.0, 95.0));
var<private> VP: array<vec2f, 4> = array<vec2f, 4>(vec2f(170.0, -80.0), vec2f(215.0, 90.0), vec2f(290.0, 240.0), vec2f(270.0, 480.0));
fn softDist(p: vec2f, which: i32) -> vec3f {
  var acc = 0.0; var gacc = vec2f(0.0);
  for (var k = 0; k < 3; k++) {
    let s = select(dseg(p, RP[k], RP[k + 1]), dseg(p, VP[k], VP[k + 1]), which == 1);
    let e = exp(-s.x / 28.0); acc += e; gacc += e * s.yz;
  }
  return vec3f(-28.0 * log(max(acc, 1e-30)), gacc / max(acc, 1e-30));
}
fn rangeD(p: vec2f) -> vec3f {
  let D = softDist(p, 0);
  let reach = 170.0;
  let u = 1.0 - D.x / reach; let t = clamp(u, 0.0, 1.0);
  let tD = vec3f(t, select(vec2f(0.0), -D.yz / reach, u > 0.0 && u < 1.0));
  let c = vec3f(t * t * (1.6 - 0.6 * t), t * (3.2 - 1.8 * t) * tD.yz);
  let n1 = gnoised(p / 55.0, 0x1863u); let n2 = gnoised(p / 22.0, 0x32a7u);
  let L = vec3f(1.0 + 0.4 * (0.65 * n1.x + 0.35 * n2.x), 0.4 * (0.65 * n1.yz / 55.0 + 0.35 * n2.yz / 22.0));
  let h = prm.amount * dmul(c, L);
  let slope = length(h.yz);
  return h + gulliesD(p, -D.yz, slope * sstep(0.0, 0.25, t), 62.0, 0.45, 5, 0x1234u);
}
fn boxSd(p: vec2f) -> f32 { return sdBox(p, vec2f(470.0, 330.0), vec2f(70.0, 40.0), 0.3, 10.0) + 6.0 * vnoise(p / 30.0, 0x6au); }
fn mesaW(p: vec2f) -> vec3f {   // the replace weight (FD of a pure function: no buffer, any scale)
  let e = 0.25;
  let sd = vec3f(boxSd(p), (boxSd(p + vec2f(e, 0.0)) - boxSd(p - vec2f(e, 0.0))) / (2.0 * e), (boxSd(p + vec2f(0.0, e)) - boxSd(p - vec2f(0.0, e))) / (2.0 * e));
  return dss(-4.0, 3.0, -sd);
}
// The valley's rise above its floor at distance D from its line: V, U (parabola), or V with terraces.
fn valleyRise(D: vec3f) -> vec3f {
  if (prm.valley > 1.5 && prm.valley < 2.5) { return dmul(D, D) * (1.0 / prm.trough); }
  let v = D * prm.vslope;
  if (prm.valley < 2.5) { return v; }
  // Terraces: a gentle floor (tslope) quantised into tcount treads of "tread" units, risers the last "riser" share of each
  // step; above the top tread the wall rises at vslope.
  let st = prm.tread; let top = st * prm.tcount; let lo = D * prm.tslope;
  if (lo.x >= top) { return dk(top) + (D - dk(top / prm.tslope)) * prm.vslope; }
  let u = lo * (1.0 / st); let fl = floor(u.x);
  let fr = vec3f(u.x - fl, u.yz);
  let s = dss(1.0 - prm.riser, 1.0, fr);
  return vec3f(st * (fl + s.x), st * s.yz);
}
fn procD(p: vec2f) -> vec3f {
  var h = dk(18.0) + 5.0 * fbmDBL(p, 150.0, 7, 0.45, 0.6, 0x5u);
  h += rangeD(p);
  let mw = mesaW(p);
  h = dmix(h, dk(prm.mesa) + 1.5 * fbmDBL(p, 40.0, 4, 0.4, 0.0, 0x9u), mw);
  if (prm.valley > 0.5) {
    let D = softDist(p, 1);
    let floorH = dk(16.0 + 0.03 * (480.0 - p.y));
    h = dsmin(h, floorH + valleyRise(D), 4.0);
  }
  return h;
}
fn heightAt(p: vec2f) -> f32 { return procD(p).x; }
// Decision 5's override: a soft disc (centre, radius in world px) that scales the repose by 1 + ovr inside it.
fn overrideMask(p: vec2f) -> f32 { return 1.0 - sstep(0.6, 1.0, distance(p, vec2f(prm.ovrX, prm.ovrY)) / prm.ovrR); }
fn reposeScale(p: vec2f) -> f32 { return 1.0 + prm.ovr * overrideMask(p); }
fn lightAt(p: vec2f, h: f32, n: vec3f, m: vec4f, x: i32, y: i32) -> vec3f {
  if (prm.analytic < 0.5) { return lightDefault(p, h, n, m, x, y); }
  // The primitives' exact gradient plus the finite difference of what the simulation changed (stored in M.w per pixel).
  let g = procD(p).yz;
  let px = labPx();
  let dsx = (M[idx(x + 1, y)].w - M[idx(x - 1, y)].w) / (2.0 * px);
  let dsy = (M[idx(x, y + 1)].w - M[idx(x, y - 1)].w) / (2.0 * px);
  let zk = lab.org.w;
  let na = normalize(vec3f(-(g.x + dsx) * zk, -(g.y + dsy) * zk, 1.0));
  return lightDefault(p, h, na, m, x, y);
}
`;

// Multi-scale thermal on a world-px schedule: levels from prm.coarse down to one cell, prm.per iterations each, coarse first.
// SA = (height, authored height, unused, counter). With prm.lattice > 0, levels at or above the lattice spacing run on the
// lattice's cells only; one step then upsamples their change bilinearly under every pixel.
export const simWgsl = /* wgsl */`
fn levelsJ() -> i32 { return max(0, i32(floor(log2(max(prm.coarse / labPx(), 1.0)) + 1e-4))); }
fn latticeCells() -> i32 { return select(0, max(1, i32(round(prm.lattice / labPx()))), prm.lattice > 0.0); }
fn upsampleAt() -> u32 {   // the iteration that upsamples (after the lattice levels), or never
  let lc = latticeCells(); if (lc <= 1) { return 0xffffffffu; }
  let J = levelsJ(); var n = 0u;
  for (var l = 0; l <= J; l++) { if ((1 << u32(J - l)) >= lc) { n += u32(prm.per); } }
  return n;
}
fn strideFor(k: u32) -> i32 {
  let J = levelsJ(); let up = upsampleAt();
  let kk = select(k, k - 1u, up != 0xffffffffu && k > up);
  let lvl = min(i32(kk / u32(max(prm.per, 1.0))), J);
  return 1 << u32(J - lvl);
}
fn pairInside(x: i32, y: i32, s: i32) -> bool {
  let m = select(0, s, s > 1);
  return x >= m && y >= m && x < labW() - m && y < labH() - m;
}
fn onLattice(x: i32, y: i32, lc: i32) -> bool { return lc <= 1 || (x % lc == 0 && y % lc == 0); }
fn thermalAt(x: i32, y: i32, s: i32) -> f32 {
  let h = SA[idx(x, y)].x;
  var out = 0.0; var gain = 0.0;
  for (var dy = -1; dy <= 1; dy++) { for (var dx = -1; dx <= 1; dx++) {
    if (dx == 0 && dy == 0) { continue; }
    let nx = x + dx * s; let ny = y + dy * s;
    if (!pairInside(x, y, s) || !pairInside(nx, ny, s)) { continue; }
    let hn = SA[idx(nx, ny)].x;
    let run = select(1.0, 1.41421356, dx != 0 && dy != 0) * f32(s) * labPx();
    // A painted override scales the repose; the pair uses the mean of its two ends, so both samples agree.
    let tal = prm.talus * 0.5 * (reposeScale(worldOf(x, y)) + reposeScale(worldOf(nx, ny)));
    if (h > hn) { out += prm.share * max(0.0, h - hn - tal * run); }
    else if (hn > h) { gain += prm.share * max(0.0, hn - h - tal * run); }
  } }
  return h - out + gain;
}
@compute @workgroup_size(8, 8)
fn simInit(@builtin(global_invocation_id) g: vec3u) {
  let x = i32(g.x); let y = i32(g.y);
  if (x >= labW() || y >= labH()) { return; }
  let h = H[idx(x, y)];
  SA[idx(x, y)] = vec4f(h, h, 0.0, 0.0);
}
@compute @workgroup_size(8, 8)
fn simStep(@builtin(global_invocation_id) g: vec3u) {
  let x = i32(g.x); let y = i32(g.y);
  if (x >= labW() || y >= labH()) { return; }
  let i = idx(x, y);
  let c = SA[i]; let k = u32(c.w);
  let lc = latticeCells();
  var h = c.x;
  if (k == upsampleAt()) {
    // The lattice's change, bilinear, under this pixel's own authored height (which holds every octave).
    let q = vec2f(f32(x), f32(y)) / f32(lc); let b = vec2i(floor(q)) * lc; let f = fract(q);
    let d00 = SA[idx(b.x, b.y)].x - SA[idx(b.x, b.y)].y; let d10 = SA[idx(b.x + lc, b.y)].x - SA[idx(b.x + lc, b.y)].y;
    let d01 = SA[idx(b.x, b.y + lc)].x - SA[idx(b.x, b.y + lc)].y; let d11 = SA[idx(b.x + lc, b.y + lc)].x - SA[idx(b.x + lc, b.y + lc)].y;
    h = c.y + mix(mix(d00, d10, f.x), mix(d01, d11, f.x), f.y);
  } else if (k < labIter()) {
    let s = strideFor(k);
    if (s < lc || onLattice(x, y, lc)) { h = thermalAt(x, y, s); }
  }
  SB[i] = vec4f(h, c.y, c.z, c.w + 1.0);
}
@compute @workgroup_size(8, 8)
fn simApply(@builtin(global_invocation_id) g: vec3u) {
  let x = i32(g.x); let y = i32(g.y);
  if (x >= labW() || y >= labH()) { return; }
  let i = idx(x, y);
  let h0 = H[i]; let h = SA[i].x;
  H[i] = h;
  M[i] = vec4f(sstep(0.5, 6.0, h0 - h) * 0.8, sstep(0.3, 4.0, h - h0), 0.0, h - h0);
}
`;

const C = {cx: 268, cy: 150};   // the world point every panel centres on
const at = (px, w = 512, h = 384) => ({px, ox: C.cx - w * px / 2, oy: C.cy - h * px / 2});
export default {
  title: 'Resolution independence: half, 1x, 2x, 4x',
  about: 'A primitive tree (range with gullies, mesa, U valley) as dual numbers, band-limited, with analytic normals; multi-scale thermal on a world-px schedule. Same world point at the centre of every panel.',
  world: 'green',
  params: {bandlimit: 1, analytic: 1, amount: 130, mesa: 95, valley: 2, trough: 70, vslope: 0.55, tread: 9, riser: 0.3, tslope: 0.4, tcount: 3,
    talus: 0.75, share: 0.1, coarse: 32, per: 4, lattice: 0, ovr: 0, ovrX: 300, ovrY: 170, ovrR: 70},
  sim: {iterations: 25, wgsl: simWgsl},
  variants: [
    {label: 'half', note: 'px 2, 21 it', lab: {...at(2), iters: 21}},
    {label: '1x', note: 'px 1, 25 it', lab: {...at(1), iters: 25}},
    {label: '2x', note: 'px 0.5, 29 it', lab: {...at(0.5), iters: 29}},
    {label: '4x', note: 'px 0.25, 33 it', lab: {...at(0.25), iters: 33}},
    {label: 'half-naive', note: 'px 2, no band limit, finite-difference normals', params: {bandlimit: 0, analytic: 0}, lab: {...at(2), iters: 21}},
    {label: '1x-lattice8', note: 'coarse levels on an 8-px lattice (1/64 of the cells), upsampled, then fine levels', params: {lattice: 8}, lab: {...at(1), iters: 26}},
  ],
  wgsl: treeWgsl,
};
