// er-warm: incremental erosion. After an edit, start from the last eroded result plus the edit's change in authored height,
// and run a few iterations, instead of eroding the new authored height from scratch.
//
// The model is a small gather-only stand-in for the Time pass, slow to converge as the pipe model is: lagged multiple-
// direction drainage (one Jacobi step an iteration, H-Schott/StreamPowerErosion's scheme, MIT), stream-power incision
// E = K sqrt(A) S capped at half the drop to the receiver, and stride-1 talus. SA = (height, drainage area, unused, counter).
//   mode 0  before: the old scene, N iterations
//   mode 1  cold: the new scene (old + a new spur), N iterations: what the engine computes today on release
//   mode 2  warm: N iterations of the old scene, then + the spur's height, then k more iterations (lab iters N + 1 + k)
//   mode 3  box-cold: N iterations of the old scene, then the dirty box (the spur's box plus a margin) restarts from the new
//           authored height and runs N iterations with the old result frozen around it (lab iters 2N + 1, box 1)
//   box     with mode 2, the k iterations run only inside the spur's box plus a margin (the dirty tiles); outside it the old
//           result is kept
// A warm result depends on the edit history, not only on the scene, so it cannot be the final level (regional replay and
// export need the same bytes from a fresh load); it can be the preview level while the cold run finishes.
// Own code from the published ideas.
const N = 300;
export const simText = /* wgsl */`
var<private> OFF: array<vec2i, 8> = array<vec2i, 8>(vec2i(1, 0), vec2i(1, 1), vec2i(0, 1), vec2i(-1, 1), vec2i(-1, 0), vec2i(-1, -1), vec2i(0, -1), vec2i(1, -1));
fn inWin(x: i32, y: i32) -> bool { return x >= 0 && y >= 0 && x < labW() && y < labH(); }
fn hS(x: i32, y: i32) -> f32 { return SA[idx(x, y)].x; }
fn dlen(k: i32) -> f32 { return select(1.0, 1.41421356, (k & 1) == 1) * labPx(); }
fn share(jx: i32, jy: i32, k: i32) -> f32 {   // the share of pixel j's water that goes toward direction k (slope weights)
  let h = hS(jx, jy); var sum = 0.0; var mine = 0.0;
  for (var m = 0; m < 8; m++) {
    let q = vec2i(jx, jy) + OFF[m]; if (!inWin(q.x, q.y)) { continue; }
    let s = max(0.0, (h - hS(q.x, q.y)) / dlen(m)); sum += s; if (m == k) { mine = s; }
  }
  return select(0.0, mine / sum, sum > 0.0);
}
fn erodeStep(x: i32, y: i32) -> vec2f {
  let c = SA[idx(x, y)]; let h = c.x;
  var a = labPx() * labPx();
  var sMax = 0.0; var hr = h; var out = 0.0; var gain = 0.0;
  for (var k = 0; k < 8; k++) {
    let q = vec2i(x, y) + OFF[k]; if (!inWin(q.x, q.y)) { continue; }
    let n = SA[idx(q.x, q.y)];
    a += n.y * share(q.x, q.y, (k + 4) % 8);
    let s = (h - n.x) / dlen(k);
    if (s > sMax) { sMax = s; hr = n.x; }
    if (h > n.x) { out += prm.share * max(0.0, h - n.x - prm.talus * dlen(k)); } else { gain += prm.share * max(0.0, n.x - h - prm.talus * dlen(k)); }
  }
  let edge = x == 0 || y == 0 || x == labW() - 1 || y == labH() - 1;
  let e = select(min(prm.K * sqrt(c.y) * sMax, 0.5 * (h - hr)), 0.0, edge);
  return vec2f(h - e - out + gain, a);
}
@compute @workgroup_size(8, 8)
fn simInit(@builtin(global_invocation_id) g: vec3u) {
  let x = i32(g.x); let y = i32(g.y);
  if (x >= labW() || y >= labH()) { return; }
  SA[idx(x, y)] = vec4f(H[idx(x, y)], labPx() * labPx(), 0.0, 0.0);
}
@compute @workgroup_size(8, 8)
fn simStep(@builtin(global_invocation_id) g: vec3u) {
  let x = i32(g.x); let y = i32(g.y);
  if (x >= labW() || y >= labH()) { return; }
  let i = idx(x, y); let c = SA[i]; let k = u32(c.w);
  var o = c;
  let p = worldOf(x, y);
  if (prm.mode > 2.5 && k == u32(prm.n)) {   // mode 3: the dirty box restarts from the new authored height, the rest keeps the old result
    if (inBox(p)) { o.x = rangeAt(p) + spurAt(p); o.y = labPx() * labPx(); } else { o.x = c.x + spurAt(p); }
  }
  else if (prm.mode > 1.5 && k == u32(prm.n)) { o.x = c.x + spurAt(p); }
  else if (prm.mode > 1.5 && k > u32(prm.n) && prm.box > 0.5 && !inBox(p)) { }
  else { let r = erodeStep(x, y); o.x = r.x; o.y = r.y; }
  o.w = c.w + 1.0;
  SB[i] = o;
}
@compute @workgroup_size(8, 8)
fn simApply(@builtin(global_invocation_id) g: vec3u) {
  let x = i32(g.x); let y = i32(g.y);
  if (x >= labW() || y >= labH()) { return; }
  let i = idx(x, y); let p = worldOf(x, y);
  let h0 = H[i] + select(0.0, spurAt(p), prm.mode > 1.5);
  let s = SA[i];
  H[i] = s.x;
  let chan = sstep(9.0, 14.0, log2(1.0 + s.y / (labPx() * labPx())));
  M[i] = vec4f(sstep(0.5, 5.0, h0 - s.x) * 0.7, sstep(0.3, 3.0, s.x - h0), 0.0, chan);
}
`;

export default {
  title: 'Incremental erosion: warm start after an edit',
  about: 'A spur is added to an eroded range. cold: erode the new scene from scratch (300 it). warm-k: the old result plus the spur, then k iterations. box: the k iterations only on the dirty tiles.',
  world: 'green',
  params: {mode: 1, n: N, box: 0, margin: 48, K: 0.0016, talus: 0.8, share: 0.08, edit: 1, amount: 125},
  sim: {iterations: N, wgsl: simText},
  variants: [
    {label: 'before', note: 'old scene, 300 it', params: {mode: 0}, lab: {iters: N}},
    {label: 'cold', note: 'new scene from scratch, 300 it', params: {mode: 1}, lab: {iters: N}},
    {label: 'warm-0', note: 'old result + spur, no iterations', params: {mode: 2}, lab: {iters: N + 1}},
    {label: 'warm-30', note: 'old result + spur, 30 it', params: {mode: 2}, lab: {iters: N + 31}},
    {label: 'warm-75', note: 'old result + spur, 75 it', params: {mode: 2}, lab: {iters: N + 76}},
    {label: 'warm-30-box', note: '30 it on the dirty box only', params: {mode: 2, box: 1}, lab: {iters: N + 31}},
    {label: 'box-cold', note: 'the dirty box from scratch, 300 it, old result frozen around it', params: {mode: 3, box: 1}, lab: {iters: 2 * N + 1}},
  ],
  wgsl: /* wgsl */`
const SPUR_A = vec2f(250.0, 150.0); const SPUR_B = vec2f(330.0, 300.0);
fn rangeAt(p: vec2f) -> f32 {
  let d = min(segDist(p, vec2f(-40.0, 90.0), vec2f(200.0, 120.0)), segDist(p, vec2f(200.0, 120.0), vec2f(560.0, 80.0)));
  let t = 1.0 - clamp((d + 14.0 * vnoise(p / 60.0, 0x51u)) / 170.0, 0.0, 1.0);
  let lumps = 1.0 + 0.35 * (0.6 * vnoise(p / 45.0, 0x1863u) + 0.4 * vnoise(p / 19.0, 0x32a7u));
  return 20.0 + 0.02 * (384.0 - p.y) + prm.amount * t * t * (1.6 - 0.6 * t) * lumps + 2.0 * fbmBL(p, 30.0, 3, 0.45, labPx(), 0x7u);
}
// The edit: a spur running down from the range.
fn spurAt(p: vec2f) -> f32 {
  let d = segDist(p, SPUR_A, SPUR_B) + 8.0 * vnoise(p / 25.0, 0x99u);
  let t = 1.0 - clamp(d / 60.0, 0.0, 1.0);
  let along = clamp(dot(p - SPUR_A, SPUR_B - SPUR_A) / dot(SPUR_B - SPUR_A, SPUR_B - SPUR_A), 0.0, 1.0);
  return prm.edit * 70.0 * (1.0 - 0.6 * along) * t * t * (3.0 - 2.0 * t);
}
fn inBox(p: vec2f) -> bool {
  let lo = min(SPUR_A, SPUR_B) - vec2f(60.0 + prm.margin); let hi = max(SPUR_A, SPUR_B) + vec2f(60.0 + prm.margin);
  return all(p >= lo) && all(p <= hi);
}
fn heightAt(p: vec2f) -> f32 { return rangeAt(p) + select(0.0, spurAt(p), prm.mode > 0.5 && prm.mode < 1.5); }
`,
};
