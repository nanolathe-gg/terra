// Texture families for material grain at 1-8 px: eight ways to make the same three grains (rock grain whose crests
// follow a curving orientation field, isotropic soil, grass blades), each a pure per-pixel function with integer hashes.
// The panel is three columns of prm.colw px: rock (wavelength lamR, crests along txRockAngle), soil (lamS, isotropic),
// grass (lamG, near-fixed blade direction). heightAt returns the texture value times prm.relief (a unit-variance
// grain, lit as micro relief); albedoAt also tints by it. `--heights` saves the raw field for docs/research/tx-grain.py.
//
// The families (prm.fam):
//   0 value   anisotropic value noise in coordinates rotated by the field at the pixel (the engine's sheared lattice,
//             made to follow a field): a global rotation that varies per pixel, so it warps far from the origin.
//   1 stripes lib stripes(): four jittered cells, (cos, sin) of the phase summed and normalised (round 1's filter).
//   2 gabor   sparse Gabor convolution (Lagae et al. 2009): 3 x 3 cells, 3 kernels each, every kernel oriented by the
//             field at its own centre; the real part. Contrast varies where kernels cancel.
//   3 phasor  phasor noise (Tricard et al. 2019): the same complex sum, but only its phase is kept: sin(arg). Constant
//             contrast, clean stripes, any profile on the phase.
//   4 lrp     local random-phase noise (Gilet et al. 2014): per cell, 6 cosines drawn from the target spectrum with random
//             phases; 2 x 2 cells blended by a window whose squares sum to 1, so the variance holds.
//   5 bomb    point-process texture basis functions / texture bombing (Guehl et al. 2020, Glanville 2004): 2 jittered
//             points per cell, each an oriented elliptic bump of random size and signed tone.
//   6 tile    a periodic exemplar of prm.tile px (periodic value noise, fixed orientation) drawn by plain wrapping: what
//             the engine's startup material textures do today (engine-materials.wgsl, read by genColor).
//   7 hpn     the same exemplar drawn by tiling and blending (Heitz and Neyret 2018; Deliot and Heitz 2019): a triangle
//             grid of prm.grid px, each vertex a random offset into the exemplar rotated to the field at that vertex,
//             three lookups blended with the variance-preserving rule sum(w e) / sqrt(sum(w^2)).
// Our own code from the papers. The official phasor code is AGPL-3.0 and the PPTBF code LGPL-2.1, and the Unity
// stochastic-texturing sample has no license file: none of them was read or ported.

const WGSL = /* wgsl */`
fn txCol(p: vec2f) -> i32 { return clamp(i32(floor(p.x / prm.colw)), 0, 2); }
// The crest direction (radians from +x) the rock grain is asked to follow: a field that curves over 60-100 px.
fn txRockAngle(p: vec2f) -> f32 { return 0.6 + 1.0 * sin(p.y / 70.0) + 0.5 * sin(p.x / 55.0); }
fn txAngle(p: vec2f, col: i32) -> f32 {
  if (col == 0) { return txRockAngle(p); }
  if (col == 2) { return 1.25 + 0.25 * sin(p.y / 40.0); }
  return 0.0;
}
fn txLam(col: i32) -> f32 { return select(select(prm.lamG, prm.lamS, col == 1), prm.lamR, col == 0); }
fn txStretch(col: i32) -> f32 { return select(select(4.0, 1.0, col == 1), 3.0, col == 0); }
fn txSeed(col: i32) -> u32 { return 0x2545f491u + u32(col) * 0x9e3779b9u; }
fn txDir(a: f32) -> vec2f { return vec2f(cos(a), sin(a)); }

// 0: value noise in coordinates rotated by the field at the pixel itself.
fn txValue(p: vec2f, col: i32) -> f32 {
  let d = txDir(txAngle(p, col)); let lam = txLam(col);
  let q = vec2f(dot(p, d) / (lam * txStretch(col)), dot(p, vec2f(-d.y, d.x)) / lam);
  return (vnoise(q, txSeed(col)) + 0.5 * vnoise(q * 2.03, txSeed(col) + 7u)) * 2.6;
}

// 1: lib stripes(); soil takes a slowly turning direction (stripes are oriented by nature).
fn txStripes(p: vec2f, col: i32) -> f32 {
  var a = txAngle(p, col);
  if (col == 1) { a = 3.14159 * vnoise(p / 10.0, 0x51u); }
  return stripes(p, txDir(a), 1.0 / txLam(col), txSeed(col)).y * 1.4142;
}

// 2, 3: the sparse complex Gabor sum. Kernels on a lattice of 2 wavelengths, 3 per cell; envelope exp(-pi a^2 r^2)
// falls to 0.05 at one cell; each kernel's wave vector is perpendicular to the field at its own centre, spread a little.
fn txSparse(p: vec2f, col: i32) -> vec2f {
  let lam = txLam(col); let C = 2.0 * lam; let a = 0.977 / C; let f = 1.0 / lam;
  let spread = select(0.75 / txStretch(col), 3.14159, col == 1);
  let b = vec2i(floor(p / C));
  var acc = vec2f(0.0);
  for (var j = -1; j <= 1; j++) { for (var i = -1; i <= 1; i++) {
    let c = b + vec2i(i, j);
    for (var k = 0u; k < 3u; k++) {
      let s = txSeed(col) + k * 0x632be5abu;
      let x = (vec2f(c) + h2(c, s)) * C;
      let r = p - x;
      let env = exp(-3.14159 * a * a * dot(r, r));
      let ang = txAngle(x, col) + 1.5708 + spread * hs(c.x, c.y, s ^ 0x27d4eb2fu);
      let ph = TAU * f * dot(txDir(ang), r) + TAU * h01(c.x, c.y, s ^ 0x165667b1u);
      acc += env * vec2f(cos(ph), sin(ph));
    }
  } }
  return acc;
}
fn txGabor(p: vec2f, col: i32) -> f32 { return txSparse(p, col).x / 0.885; }
fn txPhasor(p: vec2f, col: i32) -> f32 { let s = txSparse(p, col); return s.y / max(length(s), 1e-6) * 1.4142; }

// 4: local random-phase noise. Cells of 2.5 wavelengths; the window cos(pi t / 2), sin(pi t / 2) per axis.
fn txLrp(p: vec2f, col: i32) -> f32 {
  let lam = txLam(col); let L = 2.5 * lam;
  let spread = select(0.75 / txStretch(col), 3.14159, col == 1);
  let q = p / L - 0.5; let c0 = vec2i(floor(q)); let t = q - floor(q);
  let wx = vec2f(cos(1.5708 * t.x), sin(1.5708 * t.x)); let wy = vec2f(cos(1.5708 * t.y), sin(1.5708 * t.y));
  var v = 0.0;
  for (var j = 0; j <= 1; j++) { for (var i = 0; i <= 1; i++) {
    let c = c0 + vec2i(i, j);
    let xc = (vec2f(c) + 0.5) * L;
    let w = wx[i] * wy[j];
    let base = txAngle(xc, col) + 1.5708;
    var cell = 0.0;
    for (var k = 0u; k < 6u; k++) {
      let s = txSeed(col) + k * 0x7feb352du;
      let ang = base + spread * hs(c.x, c.y, s);
      let fr = (1.0 + 0.25 * hs(c.x, c.y, s ^ 0x846ca68bu)) / lam;
      cell += cos(TAU * fr * dot(txDir(ang), p - xc) + TAU * h01(c.x, c.y, s ^ 0x3c6ef372u));
    }
    v += w * cell * 0.57735;            // sqrt(2 / 6): six cosines of unit amplitude make unit variance
  } }
  return v;
}

// 5: bombing with oriented elliptic bumps (stones in soil, flakes in rock, blades in grass).
fn txBomb(p: vec2f, col: i32) -> f32 {
  let lam = txLam(col); let C = 1.6 * lam; let st = txStretch(col);
  let b = vec2i(floor(p / C));
  var v = 0.0;
  for (var j = -2; j <= 2; j++) { for (var i = -2; i <= 2; i++) {
    let c = b + vec2i(i, j);
    for (var k = 0u; k < 2u; k++) {
      let s = txSeed(col) + k * 0x1b873593u;
      let x = (vec2f(c) + h2(c, s)) * C;
      var ang = txAngle(x, col) + 0.2 * hs(c.x, c.y, s ^ 0x5u);
      if (col == 1) { ang = 3.14159 * h01(c.x, c.y, s ^ 0x5u); }
      let d = txDir(ang); let r = p - x;
      let hl = 0.5 * lam * st * (0.6 + 0.8 * h01(c.x, c.y, s ^ 0x6u));
      let hw = 0.5 * lam * (0.6 + 0.8 * h01(c.x, c.y, s ^ 0x7u));
      let e = vec2f(dot(r, d) / hl, dot(r, vec2f(-d.y, d.x)) / hw);
      let kk = max(0.0, 1.0 - dot(e, e));
      v += hs(c.x, c.y, s ^ 0x8u) * kk * kk;
    }
  } }
  return v * 2.2;
}

// 6, 7: the periodic exemplar, crests along its own u.x, prm.tile px square; whole numbers of lattice cells across it.
fn txPerNoise(u: vec2f, n: vec2f, s: u32) -> f32 {
  let q = u / prm.tile * n; let i = vec2i(floor(q)); let f = fract(q);
  let w = f * f * (3.0 - 2.0 * f);
  let ni = vec2i(n);
  let i0 = ((i % ni) + ni) % ni; let i1 = (((i + 1) % ni) + ni) % ni;
  let a = hs(i0.x, i0.y, s); let b = hs(i1.x, i0.y, s); let c = hs(i0.x, i1.y, s); let d = hs(i1.x, i1.y, s);
  return mix(mix(a, b, w.x), mix(c, d, w.x), w.y);
}
fn txExemplar(u: vec2f, col: i32) -> f32 {
  let lam = txLam(col);
  let n = max(vec2f(1.0), round(prm.tile / vec2f(lam * txStretch(col), lam)));
  return (txPerNoise(u, n, txSeed(col)) + 0.5 * txPerNoise(u, n * 2.0, txSeed(col) + 7u)) * 2.4;
}
fn txMeanAngle(col: i32) -> f32 { return select(select(1.25, 0.0, col == 1), 0.6, col == 0); }
fn txTile(p: vec2f, col: i32) -> f32 { return txExemplar(rot(p, -txMeanAngle(col)), col); }
fn txHpn(p: vec2f, col: i32) -> f32 {
  // A triangle grid: skew the plane so equilateral triangles of prm.grid px become half unit squares.
  let uv = p / prm.grid * 3.4641016;
  let sk = vec2f(uv.x - 0.57735027 * uv.y, 1.15470054 * uv.y);
  let base = vec2i(floor(sk)); let fr = fract(sk);
  let z = 1.0 - fr.x - fr.y;
  var v0 = base; var v1 = base + vec2i(0, 1); var v2 = base + vec2i(1, 0); var w = vec3f(z, fr.y, fr.x);
  if (z < 0.0) { v0 = base + vec2i(1, 1); v1 = base + vec2i(1, 0); v2 = base + vec2i(0, 1); w = vec3f(-z, 1.0 - fr.y, 1.0 - fr.x); }
  var vs = array<vec2i, 3>(v0, v1, v2);
  var acc = 0.0;
  for (var k = 0; k < 3; k++) {
    let v = vs[k];
    let vp = vec2f(f32(v.x) + 0.5 * f32(v.y), 0.8660254 * f32(v.y)) * prm.grid / 3.4641016;   // the vertex in px
    let off = h2(v, txSeed(col) ^ 0xa511e9b3u) * prm.tile;
    var ang = txAngle(vp, col);
    if (col == 1) { ang = TAU * h01(v.x, v.y, 0x77u); }       // isotropic: any rotation hides the tile better
    acc += w[k] * txExemplar(rot(p, -ang) + off, col);
  }
  return acc / sqrt(dot(w, w));
}

fn txGrain(p: vec2f) -> f32 {
  let col = txCol(p); let fam = i32(prm.fam + 0.5);
  switch (fam) {
    case 0: { return txValue(p, col); }
    case 1: { return txStripes(p, col); }
    case 2: { return txGabor(p, col); }
    case 3: { return txPhasor(p, col); }
    case 4: { return txLrp(p, col); }
    case 5: { return txBomb(p, col); }
    case 6: { return txTile(p, col); }
    default: { return txHpn(p, col); }
  }
}

fn heightAt(p: vec2f) -> f32 { return txGrain(p) * prm.relief; }
fn albedoAt(p: vec2f, h: f32, n: vec3f, m: vec4f) -> vec3f {
  let col = txCol(p);
  let c = select(select(lab.cGrass.rgb, lab.cGround.rgb, col == 1), lab.cRock.rgb, col == 0);
  return c * (1.0 + 0.14 * clamp(h / prm.relief, -2.5, 2.5));
}
`;

const FAMS = ['value', 'stripes', 'gabor', 'phasor', 'lrp', 'bomb', 'tile', 'hpn'];
export default {
  title: 'tx: texture families for material grain',
  about: 'Rock grain on a curving field, isotropic soil, grass blades; eight families, each per pixel and deterministic.',
  world: 'green',
  size: [384, 288],
  colours: {ground: [112, 88, 60], rock: [118, 112, 100]},
  lab: {zk: 0.7, el: 40},
  params: {fam: 0, colw: 128, lamR: 6, lamS: 3, lamG: 2.5, relief: 1.2, tile: 64, grid: 24},
  variants: FAMS.map((label, fam) => ({label, params: {fam}})),
  wgsl: WGSL,
};
