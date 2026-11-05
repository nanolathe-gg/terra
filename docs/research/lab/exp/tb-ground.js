// Tile budget: how ground detail can be drawn so a TA map reuses 32 x 32 tiles instead of making every one unique.
// A TNT indexes at most 65,535 tiles (a u16) and retail maps hold a median of 3,218 (BACKLOG, Phase 4), while noise in
// world space makes every slot unique. Three ways to draw the same plain with grit, stones and grass patches:
//   mode 0  everything in world space (today): every tile is unique.
//   mode 1  grit and stones in tile-local space, one of K variants per tile by a tile hash; stones are kept inside
//           the tile's interior, so tiles join with no seam. The patches stay in world space.
//   mode 2  as 1, and the patches drawn as corner tiles (Lagae and Dutre 2006, "An alternative for Wang tiles:
//           colored edges versus colored corners", the idea only): each tile corner takes one of C colours from a hash
//           of the corner, and the tile blends C periodic patch textures by bilinear corner weights. Along an edge the
//           weights depend only on its two corners and the textures repeat every tile, so patches run on across tiles
//           with no seam, and the whole plain needs at most K x C^4 tiles. With corner tiles of M px (a multiple of
//           32: M 64 spans 2 x 2 TA tiles), patterns run M / 32 times larger and the bound is K x C^4 x (M / 32)^2.
// Long-range light (horizon occlusion, cast shadows) reads neighbouring tiles, so it breaks reuse too: see the
// no-occlusion variants. Pure functions of position; integer hashes.
export default {
  title: 'Tile budget: ground that reuses tiles',
  about: 'The same plain three ways: world-space detail (every tile unique), tile-local detail with K variants, and corner-coloured patch tiles. Count tiles with docs/research/tile-budget.py.',
  world: 'green',
  size: [1024, 768],
  params: {mode: 0, K: 4, C: 2, M: 32, stones: 1, hill: 1},
  lab: {w: 1024, h: 768},
  variants: [
    {label: 'world', note: 'mode 0: world space (today)', params: {mode: 0}},
    {label: 'local', note: 'mode 1: tile-local grit and stones, K 4', params: {mode: 1}},
    {label: 'corner', note: 'mode 2: + corner-tile patches, C 2', params: {mode: 2}},
    {label: 'corner-noao', note: 'mode 2 with occlusion and shadows off on level ground', params: {mode: 2}, lab: {ao: 0, shadow: 0}},
    {label: 'world-noao', note: 'mode 0 with occlusion and shadows off', params: {mode: 0}, lab: {ao: 0, shadow: 0}},
    {label: 'corner64', note: 'mode 2, corner tiles over 2 x 2 TA tiles (64 px), stones placed freely in each tile', params: {mode: 2, M: 64}},
    {label: 'corner64-noao', note: 'the same, occlusion and shadows off', params: {mode: 2, M: 64}, lab: {ao: 0, shadow: 0}},
  ],
  wgsl: /* wgsl */`
const T = 32.0;
fn tileOf(p: vec2f) -> vec2i { return vec2i(floor(p / T)); }
fn variantOf(t: vec2i) -> u32 { return hash2u(t.x, t.y, 0x7b1u) % u32(max(prm.K, 1.0)); }
// The coordinate detail is keyed by: world space (mode 0), or the tile-local position plus the tile's variant.
fn keyed(p: vec2f) -> vec3f {
  if (prm.mode < 0.5) { return vec3f(p, 0.0); }
  let t = tileOf(p);
  return vec3f(p - vec2f(t) * T, f32(variantOf(t)) + 1.0);
}
// Stones: one candidate per 16 px cell; in tile-local modes the cells are the tile's own four, and a stone keeps a
// 4 px margin from the cell edge, so it never crosses a tile border.
fn stoneH(p: vec2f) -> f32 {
  if (prm.stones < 0.5) { return 0.0; }
  if (prm.mode > 0.5) {
    let k = keyed(p); let salt = u32(k.z) * 0x9e37u + 0x51u;
    var hmax = 0.0;
    for (var j = 0; j < 3; j++) {
      let r = 1.5 + 3.0 * h01(j, 7, salt ^ 0x2du);
      let lo = r + 3.0; let c = vec2f(lo) + h2(vec2i(j, 3), salt ^ 0x77u) * (T - 2.0 * lo);
      let d = length(k.xy - c) / r;
      if (h01(j, 11, salt) < 0.6) { hmax = max(hmax, max(0.0, 1.0 - d * d) * r * 0.8); }
    }
    return hmax;
  }
  let k = keyed(p);
  let q = k.xy; let salt = u32(k.z) * 0x9e37u + 0x51u;
  let cell = vec2i(floor(q / 16.0));
  let r = 1.5 + 3.0 * h01(cell.x, cell.y, salt ^ 0x2du);
  if (h01(cell.x, cell.y, salt) > 0.45) { return 0.0; }
  let room = 8.0 - r - 4.0;
  let c = (vec2f(cell) + 0.5) * 16.0 + (h2(cell, salt ^ 0x77u) - 0.5) * 2.0 * max(room, 0.0);
  let d = length(q - c) / r;
  return max(0.0, 1.0 - d * d) * r * 0.8;
}
// A hill in one corner, so the sheet holds slopes too (they stay unique, as on any map).
fn hillH(p: vec2f) -> f32 {
  if (prm.hill < 0.5) { return 0.0; }
  let d = length(p - vec2f(820.0, 560.0)) / 210.0;
  return 70.0 * max(0.0, 1.0 - d * d) * max(0.0, 1.0 - d * d);
}
fn heightAt(p: vec2f) -> f32 { return 20.0 + hillH(p) + stoneH(p); }
// Grass patches, 0..1: world-space noise (modes 0, 1) or corner tiles (mode 2).
fn periodicPatch(l: vec2f, c: u32) -> f32 {
  // value noise on a 4 x 4 lattice wrapped every tile (period 32 px), one texture per corner colour
  let q = l / (prm.M / 4.0); let i = vec2i(floor(q)); let f = fract(q); let u = f * f * (3.0 - 2.0 * f);
  let a = h01(i.x & 3, i.y & 3, 0x31u + c); let b = h01((i.x + 1) & 3, i.y & 3, 0x31u + c);
  let cc = h01(i.x & 3, (i.y + 1) & 3, 0x31u + c); let d = h01((i.x + 1) & 3, (i.y + 1) & 3, 0x31u + c);
  return mix(mix(a, b, u.x), mix(cc, d, u.x), u.y);
}
fn patchAt(p: vec2f) -> f32 {
  if (prm.mode < 1.5) { return sstep(0.45, 0.6, 0.5 + 0.5 * vnoise(p / 40.0, 0x3e1u) + 0.25 * vnoise(p / 13.0, 0x5aau)); }
  let t = vec2i(floor(p / prm.M)); let l = p - vec2f(t) * prm.M; let w = l / prm.M;
  let nc = u32(max(prm.C, 1.0));
  let c00 = hash2u(t.x, t.y, 0x4c1u) % nc; let c10 = hash2u(t.x + 1, t.y, 0x4c1u) % nc;
  let c01 = hash2u(t.x, t.y + 1, 0x4c1u) % nc; let c11 = hash2u(t.x + 1, t.y + 1, 0x4c1u) % nc;
  // each corner colour also sets how much grass it carries, so the patches change across the map at tile scale
  let g = mix(mix(periodicPatch(l, c00) + 0.35 * f32(c00), periodicPatch(l, c10) + 0.35 * f32(c10), w.x),
              mix(periodicPatch(l, c01) + 0.35 * f32(c01), periodicPatch(l, c11) + 0.35 * f32(c11), w.x), w.y);
  return sstep(0.55, 0.75, g);
}
fn albedoAt(p: vec2f, h: f32, n: vec3f, m: vec4f) -> vec3f {
  let k = keyed(p);
  let grit = 0.07 * hs(i32(floor(k.x)), i32(floor(k.y)), 0x51edu + u32(k.z) * 0x101u);
  var c = mix(lab.cGround.rgb * 1.05, lab.cGrass.rgb * 0.82, patchAt(p));
  let slope = length(n.xy) / max(n.z, 1e-3);
  c = mix(c, lab.cRock.rgb, sstep(0.25, 0.6, slope) * select(0.0, 1.0, stoneH(p) > 0.05));
  c = mix(c, lab.cRock.rgb * 1.1, sstep(0.05, 0.2, stoneH(p)));
  return c * (1.0 + grit);
}
`,
};
