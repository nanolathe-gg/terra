// Ground cover at 1x: the placement of vg-place, drawn as structure a TA pixel can carry instead of flat colour.
// Every class gets small heights the lab's sun and sky light (so a modern light model shades them and they agree with
// any sun), plus a colour between the heights:
//   - tufts: a jittered-grid scatter (2 x 2 candidates, a pure function of position) of star-shaped bumps, 1-2.5 px,
//     whose size, height, density and blade count are per class: fine turf, coarse leaning meadow clumps, spiky rush,
//     sparse straw tufts over soil, smooth moss cushions packed edge to edge, pebbles on bare soil;
//   - shrubs: a Cox process (a scatter whose intensity is the scrub cover at the candidate's centre times a clump field,
//     so they gather in thickets), 3 x 3 candidates; a lumpy dome 3-8 px across with leaf clumps of 1-2 px, which casts a
//     real shadow, and a halo of leaf litter round it;
//   - flowers: a Thomas cluster process (parents on an 18 px grid accepted by meadow cover, 6-17 children within 5 px),
//     single pixels, one species per cluster.
// The class draw is the same as vg-place's, without scrub (the shrubs are their own scatter). Original code; the
// ideas: point processes from spatial statistics (Neyman-Scott, Thomas; Cox), EcoBrush's (Gain et al. 2017) point
// patterns per species.
import {VG_PARAMS, VG_TERRAIN, VG_FLOW, VG_PLACE} from './vg-common.js';

export const VG_MICRO = /* wgsl */`
// A tuft scatter: cell px grid, accepted with prob acc, radius r0..r1, height ht, nb blades, dome 1 for a smooth cushion.
// Returns (height, tone): tone -1 between tufts, the tuft's own tone (about -0.5..1, lighter at its top) on one.
fn vgTuft(p: vec2f, cell: f32, r0: f32, r1: f32, ht: f32, acc: f32, nb: f32, dome: f32, seed: u32) -> vec2f {
  let b = vec2i(floor(p / cell - 0.5));
  var best = 0.0; var tone = -1.0;
  for (var j = 0; j <= 1; j++) { for (var i = 0; i <= 1; i++) {
    let cc = b + vec2i(i, j);
    let hh = hash2u(cc.x, cc.y, seed);
    if (vgU01(hh) >= acc) { continue; }
    let h1 = pcg(hh ^ 0x68e31da4u); let h2 = pcg(h1 ^ 0xb5297a4du); let h3 = pcg(h2 ^ 0x1b873593u);
    let c = (vec2f(cc) + 0.5 + (vec2f(vgU01(h1), vgU01(h2)) - 0.5) * 0.9) * cell;
    let r = mix(r0, r1, vgU01(h3));
    let d = p - c; let l = length(d);
    if (l >= r) { continue; }
    let t = 1.0 - l / r;
    let star = mix(1.0, 0.5 + 0.5 * cos(nb * atan2(d.y, d.x) + vgU01(pcg(h3)) * TAU), sstep(0.8, 1.8, r) * (1.0 - dome));
    let prof = mix(t, sqrt(max(0.0, 1.0 - (1.0 - t) * (1.0 - t))), dome);
    let hv = ht * (0.7 + 0.6 * vgU01(pcg(h2))) * prof * star;
    if (hv > best) { best = hv; tone = (vgU01(pcg(h1)) - 0.5) + 0.6 * t; }
  } }
  return vec2f(best, tone);
}
fn vgMicro(k: i32, p: vec2f) -> vec2f {
  switch k {
    case 0: { return vgTuft(p, 3.2, 0.6, 1.3, 0.6, 0.30, 0.0, 1.0, 0x7101u); }   // pebbles on soil
    case 1: { return vgTuft(p, 3.0, 1.0, 1.6, 0.9, 0.60, 5.0, 0.0, 0x7102u); }   // straw tufts, soil between
    case 2: { return vgTuft(p, 2.5, 0.9, 1.35, 0.55, 0.85, 5.0, 0.0, 0x7103u); } // turf
    case 3: { return vgTuft(p, 4.5, 1.7, 2.45, 2.2, 0.92, 6.0, 0.0, 0x7104u); }  // meadow clumps
    case 5: { return vgTuft(p, 4.6, 1.8, 2.5, 1.1, 0.97, 0.0, 1.0, 0x7105u); }   // moss cushions
    case 6: { return vgTuft(p, 3.4, 1.2, 1.85, 2.6, 0.80, 8.0, 0.0, 0x7106u); }  // rush
    default: { return vgTuft(p, 2.5, 0.7, 1.2, 0.3, 0.5, 0.0, 1.0, 0x7107u); }  // litter
  }
}
// Shrubs: (canopy height, 1 - r/R on the canopy, litter 0..1, tone -1..1).
fn vgShrubs(p: vec2f) -> vec4f {
  let cell = prm.vgShrubCell;
  let b = vec2i(floor(p / cell));
  var best = 0.0; var top = 0.0; var litter = 0.0; var tone = 0.0;
  for (var j = -1; j <= 1; j++) { for (var i = -1; i <= 1; i++) {
    let cc = b + vec2i(i, j);
    let hh = hash2u(cc.x, cc.y, 0x5e7bu);
    let h1 = pcg(hh ^ 0x68e31da4u); let h2 = pcg(h1 ^ 0xb5297a4du); let h3 = pcg(h2 ^ 0x1b873593u);
    let c = (vec2f(cc) + 0.5 + (vec2f(vgU01(h1), vgU01(h2)) - 0.5) * 0.85) * cell;
    let cov = vgCovers(vgSiteAt(c));
    let sc = cov[4] + 0.3 * cov[3] + 0.2 * cov[6];
    let clump = sstep(-0.35, 0.55, gnoised(c / 75.0, 0xc1u).x);
    let lam = sc * mix(1.0, 2.6 * clump * clump, prm.vgPatchy) * prm.vgShrubs;
    if (vgU01(hh) >= lam) { continue; }
    let R = mix(3.0, 6.0, vgU01(h3)) * (0.7 + 0.45 * sc);
    let d = p - c; let l = length(d);
    if (l > 1.9 * R) { continue; }
    let a = atan2(d.y, d.x);
    let re = R * (1.0 + 0.16 * sin(3.0 * a + vgU01(pcg(h1)) * TAU) + 0.1 * sin(5.0 * a + vgU01(pcg(h2)) * TAU));
    let q = l / re;
    litter = max(litter, 1.0 - sstep(1.0, 1.8, q));
    if (q >= 1.0) { continue; }
    let leaf = 0.5 + 0.5 * vnoise((p + vec2f(cc) * 37.0) / 1.4, 0x1eafu);
    let hv = R * 1.4 * sqrt(1.0 - q * q) * (0.78 + 0.4 * leaf);
    if (hv > best) { best = hv; top = (1.0 - q) * leaf; tone = vgU01(pcg(h3)) * 2.0 - 1.0; }
  } }
  return vec4f(best, top, litter, tone);
}
// Flowers: 0 none, else 1 + species (yellow, white, violet).
fn vgFlowers(p: vec2f) -> f32 {
  let cell = 18.0;
  let b = vec2i(floor(p / cell - 0.5));
  let pi = vec2i(floor(p));
  for (var j = 0; j <= 1; j++) { for (var i = 0; i <= 1; i++) {
    let cc = b + vec2i(i, j);
    let hh = hash2u(cc.x, cc.y, 0xf10eu);
    let h1 = pcg(hh ^ 0x68e31da4u); let h2 = pcg(h1 ^ 0xb5297a4du);
    let c = (vec2f(cc) + 0.5 + (vec2f(vgU01(h1), vgU01(h2)) - 0.5) * 0.9) * cell;
    let cov = vgCovers(vgSiteAt(c));
    if (vgU01(hh) >= (cov[3] + 0.35 * cov[2]) * prm.vgFlowers) { continue; }
    let n = 6 + i32(vgU01(pcg(h2)) * 12.0);
    for (var k = 0; k < n; k++) {
      let hk = pcg(hh + u32(k) * 0x9e3779b9u);
      let rr = 5.0 * sqrt(vgU01(hk)); let th = vgU01(pcg(hk)) * TAU;
      if (all(vec2i(floor(c + rr * vec2f(cos(th), sin(th)))) == pi)) { return 1.0 + floor(vgU01(pcg(h1)) * 3.0); }
    }
  } }
  return 0.0;
}
// M = (ground class, tone, code 0 ground / 1 shrub / 2 litter / 3 flower, extra).
fn vgApplyMicro(x: i32, y: i32) {
  let p = worldOf(x, y);
  let s = SA[idx(x, y)];
  let cov = vgCovers(s);
  if (prm.vgMicro < 0.5) { M[idx(x, y)] = vec4f(f32(vgPick(cov, vgU(p))), 0.0, 0.0, 0.0); return; }
  let pat = vgPattern(p, s, cov, vgPick(vgGround(cov), vgU(p)), H[idx(x, y)]);
  let k = i32(pat.x);
  let mi = vgMicro(k, p);
  let sh = vgShrubs(p);
  var hgt = mi.x + pat.y; var tone = mi.y; var code = 0.0; var extra = 0.0;
  if (sh.x > hgt) { hgt = sh.x; code = 1.0; extra = sh.y; tone = sh.w; }
  else if (sh.z > 0.0) { code = 2.0; extra = sh.z; }
  if (code == 0.0 && (k == 2 || k == 3)) {
    let fl = vgFlowers(p);
    if (fl > 0.0) { code = 3.0; extra = fl; hgt += 0.6; }
  }
  H[idx(x, y)] = H[idx(x, y)] + hgt * prm.vgHeight;
  M[idx(x, y)] = vec4f(f32(k), tone, code, extra);
}
const VG_FLOWER = array<vec3f, 3>(vec3f(0.86, 0.78, 0.25), vec3f(0.90, 0.90, 0.84), vec3f(0.56, 0.40, 0.68));
fn vgAlbedoMicro(p: vec2f, n: vec3f, m: vec4f) -> vec3f {
  let k = i32(m.x + 0.5);
  var c = vgAlbedo(k, p, vgSlopeOf(n));
  if (prm.vgMicro < 0.5) { return c; }
  let code = i32(m.z + 0.5);
  let hp = h01(i32(floor(p.x)), i32(floor(p.y)), 0x1777u);
  if (code == 1) {
    // Canopy: dark inside, lighter leaf clumps at the top; a few shrubs blue-green, a few olive.
    var leaf = mix(vec3f(0.12, 0.22, 0.085), vec3f(0.25, 0.37, 0.13), sstep(0.1, 0.8, m.w));
    leaf = mix(leaf, leaf * vec3f(0.85, 0.95, 1.25), max(m.y, 0.0) * 0.6);
    leaf = mix(leaf, leaf * vec3f(1.2, 1.05, 0.8), max(-m.y, 0.0) * 0.6);
    return leaf * (0.92 + 0.16 * hp);
  }
  if (code == 3) { return VG_FLOWER[clamp(i32(m.w + 0.5) - 1, 0, 2)]; }
  let gap = m.y <= -0.99;
  switch k {
    case 0: { if (!gap) { c = lab.cRock.rgb * (1.05 + 0.3 * m.y); } }
    case 1: { if (gap) { c = mix(VG_COL[0], c, 0.35) * 0.9; } else { c *= 1.0 + 0.25 * m.y; } }
    case 5: { if (gap) { c *= 0.62; } else { c *= 1.0 + 0.18 * m.y; } }
    case 6: { if (gap) { c = vec3f(0.10, 0.17, 0.15); } else { c *= 1.0 + 0.25 * m.y; } }
    default: { if (gap) { c *= select(0.8, 0.6, k == 3); } else { c *= 1.0 + 0.22 * m.y; } }
  }
  if (code == 2 && hp < 0.75 * m.w) { c = mix(c, vec3f(0.31, 0.24, 0.13) * (0.85 + 0.3 * hp), 0.75); }
  return c;
}
`;

export default {
  title: 'Ground cover at 1x: tufts, cushions, shrubs, litter, flowers',
  about: 'vg-place\'s classes drawn as lit 1-8 px structure: tuft scatters per class, moss cushions, shrubs as a clumped Cox process with litter halos and cast shadows, flowers as Thomas clusters.',
  world: 'green',
  params: {...VG_PARAMS, vgMicro: 1, vgShrubCell: 14, vgShrubs: 1.0, vgFlowers: 0.5, vgHeight: 1.0},
  variants: [
    {label: 'flat', note: 'placement only (vg-place)', params: {vgMicro: 0}},
    {label: 'micro', note: 'tufts, cushions, shrubs, litter, flowers', params: {}},
    {label: 'micro-raw', note: 'no palette', params: {}, lab: {pal: 0}},
    {label: 'micro-2x', note: '2x zoom, same world', params: {}, lab: {px: 0.5, ox: 200, oy: 235}},
    {label: 'micro-sun135', note: 'the sun from the lower right', params: {}, lab: {az: 135}},
  ],
  sim: {iterations: 320, wgsl: VG_FLOW},
  wgsl: VG_TERRAIN + VG_PLACE + VG_MICRO + /* wgsl */`
fn heightAt(p: vec2f) -> f32 { return vgTerrain(p); }
fn vgApply(x: i32, y: i32) { vgApplyMicro(x, y); }
fn vgPattern(p: vec2f, s: vec4f, cov: array<f32, 7>, k: i32, h0: f32) -> vec2f { return vec2f(f32(k), 0.0); }
fn albedoAt(p: vec2f, h: f32, n: vec3f, m: vec4f) -> vec3f { return vgAlbedoMicro(p, n, m); }
`,
};
