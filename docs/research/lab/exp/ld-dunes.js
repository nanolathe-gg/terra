// Loose material: dunes from Werner's (1995) slab cellular automaton, made deterministic and parallel (a gather).
// The model (Werner 1995, Geology 23: 1107): sand is a stack of slabs per cell; a slab picked at random is lifted (not in a
// wind shadow) and hops L cells downwind until it lands, landing with probability pS on sand and pNS on bare ground (1 in a
// shadow: the zone below the 15 degree line from the crest upwind); slopes steeper than repose avalanche. Desertscapes
// (Paris et al. 2019, MIT code) uses the same rules with OpenMP atomics, whose result depends on thread order.
// Here: every random decision is a hash of (source cell, iteration, hop), so any cell can recompute any other cell's
// decisions. One iteration is one of four phases (the counter lives in the state, .w):
//   0 shadow: each cell marks whether it lies in the wind shadow (march 12 cells upwind);
//   1 saltation: a cell loses its slab if it was lifted, and gains, for each upwind source k hops away (k = 1..5), that
//     source's slab if the source was lifted, passed hops 1..k-1 and lands here (hop 5 always lands: mass is conserved);
//   2, 3 avalanche: each cell picks its steepest of 8 neighbours and gives 0.4 of the excess over repose; it gains what the
//     neighbours that picked it give (a 5 x 5 read). No atomics, no scatter: the same bytes every run.
// The sim runs on a coarse grid (cellPx world px per cell over a fixed periodic domain) in the corner of SA; simApply upsamples it (Catmull-Rom) and
// adds ripples on the stoss slopes and interdunes (ld-ripples' phase, without defects), none on slip faces, and a gravel
// lag (the ld scatter) where the sand is thin. Original code.
import {LD_SCATTER, LD_ALBEDO} from './ld-common.js';

const SIM = /* wgsl */`
fn cpx() -> f32 { return prm.cellPx; }
// The domain is fixed in world px (domW x domH, periodic), so any window or zoom shows the same dunes.
fn CW() -> i32 { return i32(prm.domW / prm.cellPx); }
fn CH() -> i32 { return i32(prm.domH / prm.cellPx); }
fn wrapc(c: vec2i) -> vec2i { let w = CW(); let h = CH(); return vec2i(((c.x % w) + w) % w, ((c.y % h) + h) % h); }
fn ci(c: vec2i) -> u32 { let q = wrapc(c); return idx(q.x, q.y); }
fn hOf(s: vec4f) -> f32 { return s.y + s.x * prm.slab; }
fn hC(c: vec2i) -> f32 { return hOf(SA[ci(c)]); }
fn rnd(c: vec2i, n: u32, k: u32) -> f32 {
  let q = wrapc(c);
  return ldU(hash2u(q.x, q.y, n * 0x9e3779b9u + k * 0x85ebca6bu + 0x5eedu));
}
// The wind at iteration n: one direction, or two alternating every prm.period saltation steps (bimodal).
fn windAt(n: u32) -> vec2f {
  var a = radians(prm.windDeg);
  if (prm.bimodal > 0.0) {
    let phase = (n / 4u / u32(prm.period)) % 2u;
    a += select(-0.5, 0.5, phase == 1u) * radians(prm.bimodal);
  }
  return vec2f(cos(a), sin(a));
}
fn hopV(n: u32) -> vec2i { return vec2i(round(prm.hop * windAt(n))); }

fn shadowAt(c: vec2i, w: vec2f) -> f32 {
  let h0 = hC(c);
  for (var d = 1; d <= 12; d++) {
    let u = c - vec2i(round(f32(d) * w));
    if (hC(u) - h0 > f32(d) * cpx() * prm.tanShadow) { return 1.0; }
  }
  return 0.0;
}
fn lifted(c: vec2i, n: u32) -> f32 {
  let s = SA[ci(c)];
  if (s.x <= 0.0 || s.z > 0.5) { return 0.0; }
  return select(0.0, min(s.x, 1.0), rnd(c, n, 0u) < prm.pLift);
}
fn lands(src: vec2i, d: vec2i, n: u32, k: u32) -> bool {
  let s = SA[ci(d)];
  if (s.z > 0.5) { return true; }
  return rnd(src, n, k) < select(prm.pBare, prm.pSand, s.x > 0.05);
}
fn saltation(c: vec2i, n: u32) -> f32 {
  var sand = SA[ci(c)].x - lifted(c, n);
  let V = hopV(n);
  for (var k = 1; k <= 5; k++) {
    let src = c - V * k;
    let q = lifted(src, n);
    if (q <= 0.0) { continue; }
    var passed = true;
    for (var m = 1; m < k; m++) { if (lands(src, src + V * m, n, u32(m))) { passed = false; break; } }
    if (!passed) { continue; }
    if (k == 5 || lands(src, c, n, u32(k))) { sand += q; }
  }
  return sand;
}
const N8 = array<vec2i, 8>(vec2i(1, 0), vec2i(1, 1), vec2i(0, 1), vec2i(-1, 1), vec2i(-1, 0), vec2i(-1, -1), vec2i(0, -1), vec2i(1, -1));
// The avalanche a cell sends: (neighbour index, amount in slabs); index -1 for none.
fn avalOut(c: vec2i) -> vec2f {
  let s = SA[ci(c)];
  if (s.x <= 0.0) { return vec2f(-1.0, 0.0); }
  let h = hOf(s);
  var bi = -1; var bg = 0.0; var bx = 0.0;
  for (var i = 0; i < 8; i++) {
    let dist = select(1.0, 1.41421356, (i & 1) == 1) * cpx();
    let drop = h - hC(c + N8[i]);
    let g = drop / dist;
    if (g > bg) { bg = g; bi = i; bx = drop - prm.tanRepose * dist; }
  }
  if (bi < 0 || bg <= prm.tanRepose) { return vec2f(-1.0, 0.0); }
  return vec2f(f32(bi), min(s.x, 0.4 * bx / prm.slab));
}
fn avalanche(c: vec2i) -> f32 {
  var sand = SA[ci(c)].x - avalOut(c).y;
  for (var i = 0; i < 8; i++) {
    let m = c + N8[i];
    let o = avalOut(m);
    if (o.x >= 0.0 && all(N8[i32(o.x)] == -N8[i])) { sand += o.y; }
  }
  return sand;
}

@compute @workgroup_size(8, 8)
fn simInit(@builtin(global_invocation_id) g: vec3u) {
  let c = vec2i(g.xy);
  if (c.x >= CW() || c.y >= CH()) { return; }
  let p = (vec2f(c) + 0.5) * cpx();
  let bed = 20.0 + 4.0 * vnoise(p / 160.0, 0x71u);
  let sand = max(0.0, prm.supply * (1.0 + 0.6 * (h01(c.x, c.y, 0x72u) - 0.5) + 0.5 * vnoise(p / 90.0, 0x73u)));
  SA[ci(c)] = vec4f(sand, bed, 0.0, 0.0);
}
@compute @workgroup_size(8, 8)
fn simStep(@builtin(global_invocation_id) g: vec3u) {
  let c = vec2i(g.xy);
  if (c.x >= CW() || c.y >= CH()) { return; }
  let s = SA[ci(c)];
  let n = u32(s.w);
  var o = s; o.w = s.w + 1.0;
  let ph = n % 4u;
  if (ph == 0u) { o.z = shadowAt(c, windAt(n)); }
  else if (ph == 1u) { o.x = saltation(c, n); }
  else { o.x = avalanche(c); }
  SB[ci(c)] = o;
}

// Catmull-Rom sample of the coarse grid at world p: (height, sand slabs).
fn cr(t: f32) -> vec4f { let t2 = t * t; let t3 = t2 * t; return vec4f(-0.5 * t3 + t2 - 0.5 * t, 1.5 * t3 - 2.5 * t2 + 1.0, -1.5 * t3 + 2.0 * t2 + 0.5 * t, 0.5 * t3 - 0.5 * t2); }
fn coarse(p: vec2f) -> vec2f {
  let q = p / cpx() - 0.5;
  let b = vec2i(floor(q)); let f = fract(q);
  let wx = cr(f.x); let wy = cr(f.y);
  var acc = vec2f(0.0);
  for (var j = 0; j < 4; j++) { for (var i = 0; i < 4; i++) {
    let s = SA[ci(b + vec2i(i - 1, j - 1))];
    acc += wx[i] * wy[j] * vec2f(hOf(s), s.x);
  } }
  return acc;
}
var<private> gCrest: f32;
var<private> gSand: f32;
fn ripplesAt(p: vec2f, w: vec2f, amt: f32) -> f32 {
  let L = prm.ripple;
  let ph = dot(p, w) / L + 0.35 * vnoise(p / (5.0 * L), 0x65u) + 0.15 * vnoise(p / (2.3 * L), 0x66u);
  let u = fract(ph); let a = 0.3;
  let prof = select(0.5 + 0.5 * cos(PI * (u - (1.0 - a)) / a), 0.5 - 0.5 * cos(PI * u / (1.0 - a)), u < 1.0 - a);
  let band = 1.0 - sstep(0.25, 0.5, labPx() / L);
  gCrest = sstep(0.55, 0.9, prof) * band * amt;
  return (L / 9.0) * band * amt * (prof - 0.5) * 2.0;
}
@compute @workgroup_size(8, 8)
fn simApply(@builtin(global_invocation_id) g: vec3u) {
  let x = i32(g.x); let y = i32(g.y);
  if (x >= labW() || y >= labH()) { return; }
  let p = worldOf(x, y);
  let e = 1.5;
  let c0 = coarse(p);
  let gx = (coarse(p + vec2f(e, 0.0)).x - coarse(p - vec2f(e, 0.0)).x) / (2.0 * e);
  let gy = (coarse(p + vec2f(0.0, e)).x - coarse(p - vec2f(0.0, e)).x) / (2.0 * e);
  let w = windAt(u32(SA[ci(vec2i(0))].w));
  let grad = vec2f(gx, gy);
  // A slip face: steep and falling downwind. Ripples there are buried by the avalanches.
  let slip = sstep(0.3, 0.5, -dot(grad, w)) ;
  let sandC = sstep(0.15, 0.8, c0.y);
  gSand = sandC;
  var h = c0.x;
  if (prm.ripples > 0.0) { h += ripplesAt(p, w, sandC * (1.0 - slip)); } else { gCrest = 0.0; }
  h += ldScatter(p);
  H[idx(x, y)] = h;
  var m = vec4f(-gCrest, 0.0, sandC, 2.0 + ldOut.z);
  if (ldOut.y > 0.0) { m = vec4f(ldOut.y, 0.0, 0.0, ldOut.w); }
  M[idx(x, y)] = m;
}
`;

export default {
  title: 'Loose material: dunes (Werner slab CA, deterministic gather)',
  about: 'Werner 1995 on a 4 px grid over a periodic 1024 x 768 px domain: hashed decisions, a gather instead of atomics; ripples on stoss and interdune, a gravel lag where sand is thin.',
  world: 'desert',
  size: [256, 192],
  lab: {px: 4},
  params: {cellPx: 4, domW: 1024, domH: 768, supply: 1.6, slab: 1.2, hop: 5, pLift: 0.3, pSand: 0.6, pBare: 0.4, tanShadow: 0.27, tanRepose: 0.62,
           windDeg: 8, bimodal: 0, period: 60, ripple: 6, ripples: 1,
           ldRmax: 5, ldJitter: 0.85, ldHeight: 0.8, ldSuppress: 1, ldContact: 0.4},
  sim: {iterations: 3200, wgsl: SIM},
  variants: [
    {label: 'barchans', note: 'overview (1 output px = 4 world px): supply 1.6 slabs, one wind, 800 saltation steps'},
    {label: 'transverse', note: 'overview: supply 5 slabs', params: {supply: 5}},
    {label: 'bimodal', note: 'overview: two winds 100 degrees apart, alternating every 60 steps, supply 3', params: {supply: 3, bimodal: 100, windDeg: 0}},
    {label: 'early', note: 'overview: barchans after 200 saltation steps', lab: {iters: 800}},
    {label: 'barchans-1x', note: 'a 256 x 192 px window of the barchan field at TA scale', lab: {px: 1, ox: 80, oy: 60}},
    {label: 'barchans-2x', note: '2x of one barchan', lab: {px: 0.5, ox: 140, oy: 100}},
  ],

  wgsl: /* wgsl */`
${LD_SCATTER}
${LD_ALBEDO}
fn ldMask(q: vec2f) -> LdMask {
  var m: LdMask;
  let s = coarse(q).y;
  m.a = vec4f(0.8 * (1.0 - sstep(0.05, 0.5, s)), 2.2, 0.5, 0.65);
  return m;
}
fn ldShapeAt(q: vec2f) -> vec2f { return vec2f(0.5, 0.0); }
fn heightAt(p: vec2f) -> f32 { return 20.0; }
fn albedoAt(p: vec2f, h: f32, n: vec3f, m: vec4f) -> vec3f {
  let crest = max(-m.x, 0.0);
  let mm = vec4f(max(m.x, 0.0), m.y, m.z, m.w);
  var c = ldAlbedo(p, h, n, mm, lab.cGround.rgb * 0.92);
  if (mm.x <= 0.0) { c *= 1.0 - 0.12 * crest; }
  return c;
}
`,
};
