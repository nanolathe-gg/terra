// Loose material (ld-*): the WGSL the ld experiments share. Not an experiment itself (no default export).
//
// LD_SCATTER: one multi-class stone scatter, deterministic and a pure function of position.
//   - Classes k = 0..LD_K-1 have nominal radius R_k = prm.ldRmax * 2^-k (boulders, cobbles, pebbles, gravel, grit).
//   - Each class lives on its own jittered grid of cell 3.2 R_k (one candidate per cell). A stone reaches about half a
//     cell at most (1.65 R_k for the largest, wobbliest), so a pixel needs only the 2 x 2 cells nearest it: 4 candidates
//     per class, no atomics, no lists. The suppression lookups run only for candidates that reach the pixel.
//   - A full class covers about 0.3 of the ground, so number per area goes as R^-2 (a fragmentation power law, D = 2)
//     when every class is full; the mask picks which classes are present.
//   - A candidate is accepted by its own hash against P_k, from the mask at its centre: supply S (share of ground covered),
//     median diameter d50 (px) and sorting sigma (log2 spread), so P_k = S * w_k / sum(w) / 0.3, with w_k a Gaussian in
//     log2 size. Sigma large gives the power law (poorly sorted); sigma small one class (well sorted).
//   - Larger classes suppress smaller ones: a candidate is dropped when an accepted stone of one of the ldSuppress classes
//     above overlaps it (priority by size, as multi-class dart throwing does, but by lookup instead of by order).
//   - Shapes: angular chips (a convex polygon whose facets meet at an off-centre apex, a flat cap), rounded
//     superellipses with a wobbly outline, flat slabs; all partly buried by the mask's fines.
// The experiment supplies `fn ldMask(q: vec2f) -> LdMask`: two size populations, a (supply, d50 px, sigma, fines 0..1)
// and b (supply, d50, sigma, unused), so a deposit can be bimodal (a talus matrix and its runout blocks), and
// `fn ldShapeAt(q: vec2f) -> vec2f` (roundness 0 angular .. 1 round, slab share 0..1), and the params
// ldRmax, ldJitter, ldHeight, ldSuppress, ldContact. Original code (the ideas: Wei 2010 multi-class sampling; Turcotte's
// fragmentation power law; fall sorting from the talus literature).
export const LD_SCATTER = /* wgsl */`
const LD_K = 6;
const LD_COVER = 0.30;       // ground share one full class covers (pi * E[r^2] * aspect / cell^2, measured roughly)
var<private> ldOut: vec4f;   // (stone height, stone cover 0..1, contact shade 0..1, tone -1..1)
var<private> ldInfo: vec4f;  // (class of the top stone, its roundness, sdf to the nearest stone in px, unused)

fn ldR(k: i32) -> f32 { return prm.ldRmax * exp2(-f32(k)); }
fn ldU(h: u32) -> f32 { return f32(h >> 8u) / 16777216.0; }

struct LdCand { c: vec2f, r: f32, ok: bool, h0: u32, fines: f32 };
struct LdMask { a: vec4f, b: vec4f };

// Class k's share of one population (S, d50, sigma): S * w_k / sum(w), w a Gaussian in log2 diameter.
fn ldShare(k: i32, pop: vec4f) -> f32 {
  if (pop.x <= 0.0) { return 0.0; }
  let ls = log2(max(pop.y, 0.5));
  var wsum = 0.0; var wk = 0.0;
  for (var j = 0; j < LD_K; j++) {
    let z = (log2(2.0 * ldR(j)) - ls) / max(pop.z, 0.15);
    let w = exp(-0.5 * z * z);
    wsum += w; if (j == k) { wk = w; }
  }
  return pop.x * wk / max(wsum, 1e-6);
}

// Class k's candidate in cell cc, without the suppression test.
fn ldCand0(k: i32, cc: vec2i) -> LdCand {
  var o: LdCand;
  let R = ldR(k);
  let cell = 3.2 * R;
  let h0 = hash2u(cc.x, cc.y, 0x1d5au + u32(k) * 0x9e3779b9u);
  let h1 = pcg(h0 ^ 0x68e31da4u); let h2 = pcg(h1 ^ 0xb5297a4du);
  o.c = (vec2f(cc) + 0.5 + (vec2f(ldU(h0), ldU(h1)) - 0.5) * prm.ldJitter) * cell;
  // Log-uniform radius within the class: [R / sqrt 2, R sqrt 2), so the classes join into one continuous distribution.
  o.r = R * exp2(ldU(h2) - 0.5);
  o.h0 = h0;
  let m = ldMask(o.c);
  o.fines = m.a.w;
  if (m.a.x <= 0.0 && m.b.x <= 0.0) { o.ok = false; return o; }
  let P = clamp((ldShare(k, m.a) + ldShare(k, m.b)) / LD_COVER, 0.0, 1.0);
  o.ok = ldU(pcg(h2 ^ 0x1b873593u)) < P;
  return o;
}

// Suppression: true where an accepted stone of one of the prm.ldSuppress larger classes overlaps candidate o of class k.
fn ldSuppressed(k: i32, o: LdCand) -> bool {
  let depth = i32(prm.ldSuppress);
  for (var j = max(0, k - depth); j < k; j++) {
    let cellJ = 3.2 * ldR(j);
    let b = vec2i(floor(o.c / cellJ - 0.5));
    for (var jj = 0; jj <= 1; jj++) { for (var ii = 0; ii <= 1; ii++) {
      let pc = ldCand0(j, b + vec2i(ii, jj));
      if (pc.ok && distance(pc.c, o.c) < 0.85 * (pc.r + o.r)) { return true; }
    } }
  }
  return false;
}

// One stone's height (in units of its own height scale, 0..1) and signed distance (px, negative inside) at local q.
// shape: x roundness 0..1, y slab share 0..1. fines buries it (0..1).
fn ldStone(q0: vec2f, st: LdCand, shape: vec2f, fines: f32) -> vec2f {
  let h1 = pcg(st.h0 ^ 0x2545f491u); let h2 = pcg(h1 ^ 0x9e3779b9u); let h3 = pcg(h2 ^ 0x85ebca6bu); let h4 = pcg(h3 ^ 0xc2b2ae35u);
  let ang = ldU(h1) * TAU;
  let asp = 0.62 + 0.38 * ldU(h2);              // minor / major axis
  let q = rot(q0, -ang) / st.r;                 // in units of the radius
  let round = ldU(h3) < shape.x;
  let slab = ldU(h4) < shape.y;
  var h = 0.0; var d = 0.0;
  if (slab) {
    // A flat slab: a rounded box, its top a tilted plane, steep sides.
    let hb = vec2f(1.0, asp * 0.7);
    let qq = abs(q) - hb + 0.25;
    d = (length(max(qq, vec2f(0.0))) + min(max(qq.x, qq.y), 0.0) - 0.25);
    let tilt = 0.25 * (vec2f(ldU(h4 * 7u + 1u), ldU(h4 * 13u + 5u)) - 0.5);
    h = select(0.0, (0.42 + dot(q, tilt)) * smoothstep(0.0, 0.18, -d), d < 0.0);
  } else if (round || st.r < 1.3) {
    // A rounded stone: superellipse (exponent 2..3.5) with a wobbly outline, a dome on top.
    let n = 2.0 + 1.5 * ldU(h4);
    let e = vec2f(abs(q.x), abs(q.y) / asp);
    let a = atan2(q.y, q.x);
    let wob = 1.0 + 0.10 * sin(2.0 * a + ldU(h2) * TAU) + 0.07 * sin(3.0 * a + ldU(h3) * TAU);
    let s = pow(pow(e.x, n) + pow(e.y, n), 1.0 / n) / wob;
    d = s - 1.0;
    h = sqrt(max(0.0, 1.0 - s * s));
  } else {
    // An angular chip: 5-7 half planes make a convex outline; facets meet at an off-centre apex; a flat cap on top.
    let N = 5 + i32(ldU(h4) * 3.0);
    let apex = (vec2f(ldU(h2 * 3u + 7u), ldU(h3 * 5u + 3u)) - 0.5) * 0.7;
    var dd = -1e9; var roof = 1e9;
    for (var i = 0; i < N; i++) {
      let hi = pcg(st.h0 + u32(i) * 0x27d4eb2du);
      let th = (f32(i) + 0.8 * (ldU(hi) - 0.5)) * TAU / f32(N);
      let nn = vec2f(cos(th), sin(th) / asp);
      let len = length(nn);
      let nrm = nn / len;
      let off = (0.78 + 0.22 * ldU(pcg(hi))) / len;
      dd = max(dd, dot(q, nrm) - off);
      roof = min(roof, (off - dot(q, nrm)) / max(off - dot(apex, nrm), 0.05));
    }
    d = dd;
    h = min(1.0, max(roof, 0.0) * (1.25 + 0.5 * ldU(h1 * 9u + 1u)));
  }
  // Partly buried: the ground (fines) rises round the stone and cuts it below the top.
  let bury = clamp(0.12 + 0.55 * fines + 0.2 * (ldU(h2 * 11u + 3u) - 0.5), 0.0, 0.85);
  let hv = max(0.0, h - bury) / (1.0 - bury);
  // The visible outline shrinks with the burial; the sdf follows the visible part (approximately: the height above the
  // burial level stands in for the distance inside the outline, and is continuous with the outline's own sdf outside it).
  let dv = select(d + 0.6 * bury, 0.6 * (bury - h), d < 0.0);
  return vec2f(hv, dv * st.r);
}

// The scatter at p. Sets ldOut (height in TA units, cover, contact shade, tone) and ldInfo; returns the height.
fn ldScatter(p: vec2f) -> f32 {
  var best = 0.0; var cover = 0.0; var tone = 0.0; var edge = 1e9; var cls = -1.0; var rnd = 0.0; var bestR = 1.0; var edgeF = 0.0;
  let shape = ldShapeAt(p);
  for (var k = 0; k < LD_K; k++) {
    let R = ldR(k);
    if (2.0 * R < 0.7 * labPx() || R < 0.45) { break; }
    let cell = 3.2 * R;
    let b = vec2i(floor(p / cell - 0.5));
    for (var j = 0; j <= 1; j++) { for (var i = 0; i <= 1; i++) {
      let st = ldCand0(k, b + vec2i(i, j));
      if (!st.ok || distance(p, st.c) > 1.6 * st.r) { continue; }
      if (ldSuppressed(k, st)) { continue; }
      let s = ldStone(p - st.c, st, shape, st.fines);
      if (s.y < edge) { edge = s.y; edgeF = st.fines; }
      // Height scale: about 0.8 of the radius (a little more for big blocks), in TA units.
      let H = st.r * prm.ldHeight * (0.75 + 0.5 * ldU(pcg(st.h0 ^ 0x51u)));
      let hh = s.x * H;
      if (hh > best) {
        best = hh; bestR = st.r;
        cover = smoothstep(0.0, 0.15, s.x);
        tone = ldU(pcg(st.h0 ^ 0x7f4a7c15u)) * 2.0 - 1.0;
        cls = f32(k); rnd = shape.x;
      }
    } }
  }
  // Contact shade: a ring of shadowed fines round each stone, about a pixel plus a fifth of the radius wide.
  var contact = 0.0;
  // A buried stone has no gap under it: the shade fades with the fines that bury it.
  if (best <= 0.0 && edge < 1e8) { contact = prm.ldContact * (1.0 - edgeF) * (1.0 - smoothstep(0.0, max(0.9 * labPx(), 0.6) + 0.25 * min(bestR, 6.0), edge)); }
  ldOut = vec4f(best, cover, contact, tone);
  ldInfo = vec4f(cls, rnd, edge, 0.0);
  return best;
}
`;

// LD_ALBEDO: the material colour the ld experiments share. m = (stone cover, fines/loose share, sand, code) where code is the
// stone's tone (-1..1) on a stone, or 2 + contact shade on the ground.
export const LD_ALBEDO = /* wgsl */`
fn ldAlbedo(p: vec2f, h: f32, n: vec3f, m: vec4f, ground: vec3f) -> vec3f {
  var c = ground;
  c = mix(c, lab.cLoose.rgb, clamp(m.y, 0.0, 1.0));
  c = mix(c, lab.cSand.rgb, clamp(m.z, 0.0, 1.0));
  let grit = 0.05 * hs(i32(floor(p.x)), i32(floor(p.y)), 0x51edu) + 0.04 * vnoise(p / 5.0, 0x77u);
  c *= 1.0 + grit;
  if (m.w >= 1.5) {
    c *= 1.0 - 0.55 * clamp(m.w - 2.0, 0.0, 1.0);
  } else if (m.x > 0.0) {
    // Each stone its own tone: rock colour, a little lighter (weathered rind) or darker (fresh), and a few grey.
    let t = m.w;
    var rock = lab.cRock.rgb * (1.0 + 0.28 * t);
    rock = mix(rock, vec3f(dot(rock, vec3f(0.33))), 0.25 * max(0.0, -t));
    c = mix(c, rock, m.x);
  }
  return c;
}
`;
