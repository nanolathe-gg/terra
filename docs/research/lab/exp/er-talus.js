// er-talus: thermal erosion (talus) on one grid versus a multi-scale schedule at equal cost.
//
// The engine's thermalMain (engine-erosion.wgsl) moves material between a sample and its 8 neighbours one cell away, so a cliff
// of height H needs a scree about H / tan(repose) px wide, and building that takes hundreds of iterations at 2 px a cell
// (each step moves material one cell). Here the same pairwise, symmetric rule runs with a dilated stencil: the partner is s
// cells away and the repose test uses the run s * px. A coarse-to-fine schedule (s = 32, 16, ... 1 world px) moves mass far
// in the first steps and fixes the detail in the last. The repose test at stride s is implied by the test at stride 1 (a slope
// that holds on every 1-cell pair holds over s cells), so a coarse level never moves material the fine level would keep.
// Both samples of a pair compute the same expression on the same inputs, so mass is conserved exactly and the result is
// deterministic; each thread writes only its own pixel. The strides are in world px, so the schedule is the same at 2x.
// Measured against a 20000-iteration stride-1 run (384 x 288, px 1.33): stride 1 needs about 2000 iterations for what the
// dilated schedule reaches in 24 (RMS 4.6 vs 5.1 height units); with the knight star on odd steps, 24 give 2.6 and 48 give
// 1.3. By eye the coarse levels leave marks: an 8-direction star alone turns a round needle into an 8-petalled flower
// (mass lands on single far partners); the knight star shrinks the petals but adds a few straight rays; the lattice
// cascade (multi 2) keeps the needle round but shows the lattice's squares. None is as clean as the slow reference yet.
// Own code; the idea of dilated (a-trous) stencils is old (Holschneider 1989; Rong and Tan 2006 jump flooding).
// The simulation: SA = (height, unused, unused, iteration counter). The counter is the same in every pixel, so a step can
// follow a schedule while still depending only on the state.
export const thermalWgsl = /* wgsl */`
fn levelsJ() -> i32 { return max(0, i32(floor(log2(max(prm.coarse / labPx(), 1.0)) + 1e-4))); }
// Stride in cells at iteration k of n: J+1 levels from 2^J down to 1, coarse first, equal shares (laps > 1 repeats the cycle).
fn strideAt(k: u32) -> i32 {
  if (prm.multi < 0.5) { return 1; }
  let J = levelsJ(); let L = u32(J + 1) * u32(max(prm.laps, 1.0));
  let n = max(labIter(), 1u);
  let lvl = i32(min(L - 1u, k * L / n)) % (J + 1);
  return 1 << u32(J - lvl);
}
// A pair exists when both ends are inside the window, and, for a coarse stride, both are at least s cells from its edge: a
// property of both ends, so the two samples agree. (One-sided coarse pairs at the edge push material along rows: streaks.
// In the engine the page apron, 128 cells, holds this margin.)
fn pairInside(x: i32, y: i32, s: i32) -> bool {
  let m = select(0, 2 * s, s > 1);
  return x >= m && y >= m && x < labW() - m && y < labH() - m;
}
fn pairMove(hi: f32, lo: f32, run: f32) -> f32 { return prm.share * max(0.0, hi - lo - prm.talus * run); }
// The 8 neighbours, and the 8 knight moves (the same star turned 26.6 degrees). At a coarse stride, the odd iterations of
// a level use the knight moves when prm.knight is 1: an 8-direction stencil alone moves mass along 8 rays and leaves
// lobes (a round needle relaxes to an 8-petalled flower); alternating the two stars breaks the 8-fold symmetry.
var<private> STAR: array<vec2i, 16> = array<vec2i, 16>(vec2i(1, 0), vec2i(1, 1), vec2i(0, 1), vec2i(-1, 1), vec2i(-1, 0), vec2i(-1, -1), vec2i(0, -1), vec2i(1, -1),
  vec2i(2, 1), vec2i(1, 2), vec2i(-1, 2), vec2i(-2, 1), vec2i(-2, -1), vec2i(-1, -2), vec2i(1, -2), vec2i(2, -1));
fn thermalStep(x: i32, y: i32, s: i32, odd: bool) -> f32 {
  let h = SA[idx(x, y)].x;
  var out = 0.0; var gain = 0.0;
  let base = select(0, 8, odd && s > 1 && prm.knight > 0.5);
  for (var k = 0; k < 8; k++) {
    let d = STAR[base + k];
    let nx = x + d.x * s; let ny = y + d.y * s;
    if (!pairInside(x, y, s) || !pairInside(nx, ny, s)) { continue; }
    let hn = SA[idx(nx, ny)].x;
    let run = length(vec2f(d)) * f32(s) * labPx();
    if (h > hn) { out += pairMove(h, hn, run); } else if (hn > h) { gain += pairMove(hn, h, run); }
  }
  return h - out + gain;
}
// multi 2: the levels as a cascade of lattices. Level s relaxes only the cells of the s-px lattice (partners s cells away),
// prm.per iterations, then one step spreads the lattice's change over the level to every pixel (bilinear), so the mass a
// coarse level moves lands spread over the lattice cell instead of on single far partners. Most steps touch 1/s^2 of the
// cells. SA.y holds the height at the level's start.
struct Lvl { s: i32, local: u32 };
fn cascadeLevel(k: u32) -> Lvl {
  let J = levelsJ(); let m = u32(max(prm.per, 1.0)); var kk = k;
  for (var l = 0; l <= J; l++) {
    let s = 1 << u32(J - l); let size = select(m, m + 1u, s > 1);
    if (kk < size) { return Lvl(s, kk); }
    kk -= size;
  }
  return Lvl(1, 1000000u);
}
fn cascadeStep(x: i32, y: i32, c: vec4f) -> vec4f {
  let L = cascadeLevel(u32(c.w)); let m = u32(max(prm.per, 1.0));
  var o = c; if (L.local == 0u) { o.y = c.x; }
  if (L.local >= 1000000u) { return o; }
  let onLat = x % L.s == 0 && y % L.s == 0;
  if (L.local < m) { if (onLat) { o.x = thermalStep(x, y, L.s, (L.local & 1u) == 1u); } return o; }
  if (!onLat) {   // the spread: bilinear over the four lattice cells around this pixel, of their change over the level
    let s = L.s; let b = vec2i(x - x % s, y - y % s); let f = vec2f(f32(x % s), f32(y % s)) / f32(s);
    let b1 = vec2i(min(b.x + s, ((labW() - 1) / s) * s), min(b.y + s, ((labH() - 1) / s) * s));
    let d00 = SA[idx(b.x, b.y)].x - SA[idx(b.x, b.y)].y; let d10 = SA[idx(b1.x, b.y)].x - SA[idx(b1.x, b.y)].y;
    let d01 = SA[idx(b.x, b1.y)].x - SA[idx(b.x, b1.y)].y; let d11 = SA[idx(b1.x, b1.y)].x - SA[idx(b1.x, b1.y)].y;
    o.x = c.x + mix(mix(d00, d10, f.x), mix(d01, d11, f.x), f.y);
  }
  return o;
}
@compute @workgroup_size(8, 8)
fn simInit(@builtin(global_invocation_id) g: vec3u) {
  let x = i32(g.x); let y = i32(g.y);
  if (x >= labW() || y >= labH()) { return; }
  SA[idx(x, y)] = vec4f(H[idx(x, y)], 0.0, 0.0, 0.0);
}
@compute @workgroup_size(8, 8)
fn simStep(@builtin(global_invocation_id) g: vec3u) {
  let x = i32(g.x); let y = i32(g.y);
  if (x >= labW() || y >= labH()) { return; }
  let c = SA[idx(x, y)];
  if (prm.multi > 1.5) { var o = cascadeStep(x, y, c); o.w = c.w + 1.0; SB[idx(x, y)] = o; return; }
  SB[idx(x, y)] = vec4f(thermalStep(x, y, strideAt(u32(c.w)), (u32(c.w) & 1u) == 1u), c.y, c.z, c.w + 1.0);
}
@compute @workgroup_size(8, 8)
fn simApply(@builtin(global_invocation_id) g: vec3u) {
  let x = i32(g.x); let y = i32(g.y);
  if (x >= labW() || y >= labH()) { return; }
  let i = idx(x, y);
  let h0 = H[i]; let h = SA[i].x;
  H[i] = h;
  M[i] = vec4f(sstep(0.5, 6.0, h0 - h) * 0.8, sstep(0.3, 4.0, h - h0), 0.0, 0.0);
}
`;

export default {
  title: 'Talus: one grid vs multi-scale thermal',
  about: 'Cliffs of 110 units relaxed to a 35 degree repose. single: stride 1 (the engine). multi: dilated strides 32..1 world px, coarse first, knight star on odd steps. cascade: lattice levels with a bilinear spread. The 2000-iteration runs are the reference.',
  world: 'desert',
  params: {talus: 0.7, share: 0.1, multi: 1, coarse: 32, mesa: 110, laps: 1, knight: 1, per: 4},
  sim: {iterations: 24, wgsl: thermalWgsl},
  lab: {zk: 0.7},
  variants: [
    {label: 'authored', note: 'no thermal', params: {multi: 0}, lab: {iters: 0}},
    {label: 'single-24', note: 'stride 1, 24 it', params: {multi: 0}, lab: {iters: 24}},
    {label: 'multi-24', note: 'dilated 32..1 px, knight star on odd steps, 24 it', params: {multi: 1}, lab: {iters: 24}},
    {label: 'cascade-29', note: 'lattice cascade 32..1 px, 4 it a level + a spread step', params: {multi: 2}, lab: {iters: 29}},
    {label: 'single-2000', note: 'stride 1, 2000 it (reference)', params: {multi: 0}, lab: {iters: 2000}},
    {label: 'multi-48', note: 'dilated + knight, 48 it', params: {multi: 1}, lab: {iters: 48}},
    {label: 'multi-24-2x', note: '2x zoom on the needle, 28 it (one more level)', params: {multi: 1}, lab: {iters: 28, px: 0.5, ox: 282, oy: -10}},
    {label: 'single-2000-2x', note: '2x zoom, stride 1, 2000 it', params: {multi: 0}, lab: {iters: 2000, px: 0.5, ox: 282, oy: -10}},
  ],
  wgsl: /* wgsl */`
// Two mesas with steep, ragged cliffs, a needle, and a ridge: everything here is steeper than the repose.
fn heightAt(p: vec2f) -> f32 {
  let wob = 7.0 * fbmBL(p, 40.0, 3, 0.5, labPx(), 0x31u);
  let m1 = sdBox(p, vec2f(150.0, 140.0), vec2f(70.0, 45.0), 0.35, 12.0) + wob;
  let m2 = sdBox(p, vec2f(380.0, 250.0), vec2f(36.0, 60.0), -0.2, 8.0) + wob;
  let cliff = max(1.0 - sstep(-3.0, 3.0, m1), 0.75 * (1.0 - sstep(-3.0, 3.0, m2)));
  let needle = max(0.0, 1.0 - length(p - vec2f(410.0, 95.0)) / 34.0);
  let ridge = max(0.0, 1.0 - segDist(p, vec2f(70.0, 310.0), vec2f(240.0, 290.0)) / 30.0);
  let lumps = 2.0 * fbmBL(p, 30.0, 3, 0.35, labPx(), 0x77u);
  return 20.0 + prm.mesa * cliff + 95.0 * needle * needle + 70.0 * sqrt(ridge) + lumps;
}
// Bare rock where the thermal pass took material, loose debris where it laid it down (m.x, m.y).
fn matAt(p: vec2f, h: f32) -> vec4f { return vec4f(0.0); }
`,
};
