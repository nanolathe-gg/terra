// er-fans: exact drainage area in O(log n) gather-only passes, and alluvial fans as a cone envelope found by jump flooding.
//
// 1. Flow. Each pixel's receiver is its steepest-descent neighbour (D8). The receivers form a forest; its Euler tour is a linked
//    list of two elements per pixel (enter, exit) whose successors are local (first child, next sibling, parent), so simInit
//    builds it from the heights alone. Pointer jumping (Wyllie 1979) gives every element the sum of the weights after it in
//    ceil(log2(2N)) steps, each a gather of the successor's (next, sum); the drainage area of a pixel is sum(enter) - sum(exit).
//    Exact, deterministic, and 19 steps at 512 x 384, against the hundreds a lagged accumulation needs (route 1: one Jacobi
//    step of multiple-direction routing per iteration, as H-Schott/StreamPowerErosion does, MIT).
// 2. Apexes. A pixel whose catchment exceeds fanArea and whose slope falls under fanBreak while a donor above it is steeper is
//    a slope break: a gully or valley mouth. Its supply sets the fan's thickness, thick = fanK * sqrt(area / 1000 px^2).
// 3. Fans. The fan surface is the upper envelope of cones h_apex + thick - fanSlope * |p - apex|; jump flooding (Rong and Tan
//    2006) carries the best apex to every pixel in log2(reach) steps. Deposit = max(0, envelope - h), joined with a smooth max.
//    Distributary channels: round 1's gullies(), steered by the cone's own fall line, cut into the deposit only.
// All passes gather; each thread writes only its own pixel; the iteration counter rides in M.w (written only by its pixel).
// Own code from the published ideas.
const W = /* wgsl */`
fn inWin(x: i32, y: i32) -> bool { return x >= 0 && y >= 0 && x < labW() && y < labH(); }
var<private> OFF: array<vec2i, 8> = array<vec2i, 8>(vec2i(1, 0), vec2i(1, 1), vec2i(0, 1), vec2i(-1, 1), vec2i(-1, 0), vec2i(-1, -1), vec2i(0, -1), vec2i(1, -1));
// The steepest-descent neighbour's direction index, or -1 (a pit or the window edge's outlet).
fn recvDir(x: i32, y: i32) -> i32 {
  let h = Hc(x, y); var best = 0.0; var d = -1;
  for (var k = 0; k < 8; k++) {
    let q = vec2i(x, y) + OFF[k];
    if (!inWin(q.x, q.y)) { continue; }
    let s = (h - Hc(q.x, q.y)) / select(1.0, 1.41421356, (k & 1) == 1);
    if (s > best) { best = s; d = k; }
  }
  return d;
}
fn cellId(x: i32, y: i32) -> f32 { return f32(y * labW() + x); }
fn cellXY(id: f32) -> vec2i { let i = i32(id); return vec2i(i % labW(), i / labW()); }
fn jSteps() -> u32 { return u32(ceil(log2(f32(2 * labW() * labH())))); }
fn routeSteps() -> u32 { return select(jSteps(), u32(prm.jac), prm.route > 0.5); }
fn floodSteps() -> u32 { return u32(ceil(log2(max(prm.reach / labPx(), 2.0)))) + 1u; }
fn slopeAt(x: i32, y: i32) -> f32 {
  let d = recvDir(x, y); if (d < 0) { return 0.0; }
  let q = vec2i(x, y) + OFF[d];
  return (Hc(x, y) - Hc(q.x, q.y)) / (select(1.0, 1.41421356, (d & 1) == 1) * labPx());
}
// Multiple-direction share of pixel j's water that goes to its neighbour in direction k (slope^1 weights), for route 1.
fn mfdShare(jx: i32, jy: i32, k: i32) -> f32 {
  let h = Hc(jx, jy); var sum = 0.0; var mine = 0.0;
  for (var m = 0; m < 8; m++) {
    let q = vec2i(jx, jy) + OFF[m];
    if (!inWin(q.x, q.y)) { continue; }
    let s = max(0.0, (h - Hc(q.x, q.y)) / select(1.0, 1.41421356, (m & 1) == 1));
    sum += s; if (m == k) { mine = s; }
  }
  return select(0.0, mine / sum, sum > 0.0);
}
@compute @workgroup_size(8, 8)
fn simInit(@builtin(global_invocation_id) g: vec3u) {
  let x = i32(g.x); let y = i32(g.y);
  if (x >= labW() || y >= labH()) { return; }
  let i = idx(x, y);
  M[i] = vec4f(0.0);
  if (prm.route > 0.5) { SA[i] = vec4f(labPx() * labPx(), 0.0, 0.0, 0.0); return; }
  // Enter element of pixel i: id 2i, weight = its area. Its successor: the first child's enter, else its own exit.
  var nE = cellId(x, y) * 2.0 + 1.0;
  for (var k = 0; k < 8; k++) {
    let q = vec2i(x, y) + OFF[k];
    if (!inWin(q.x, q.y)) { continue; }
    let r = recvDir(q.x, q.y);
    if (r >= 0 && all(q + OFF[r] == vec2i(x, y))) { nE = cellId(q.x, q.y) * 2.0; break; }
  }
  // Exit element: the next sibling's enter (children of the parent, in direction order from the parent), else the parent's exit.
  var nX = -1.0;
  let rd = recvDir(x, y);
  if (rd >= 0) {
    let p = vec2i(x, y) + OFF[rd];
    nX = cellId(p.x, p.y) * 2.0 + 1.0;
    let d0 = (rd + 4) % 8;   // direction from the parent to this pixel
    for (var k = d0 + 1; k < 8; k++) {
      let q = p + OFF[k];
      if (!inWin(q.x, q.y)) { continue; }
      let r = recvDir(q.x, q.y);
      if (r >= 0 && all(q + OFF[r] == p)) { nX = cellId(q.x, q.y) * 2.0; break; }
    }
  }
  SA[i] = vec4f(nE, labPx() * labPx(), nX, 0.0);
}
fn elemAt(e: f32) -> vec2f {   // (next, sum) of element e
  let c = cellXY(floor(e * 0.5)); let s = SA[idx(c.x, c.y)];
  return select(s.xy, s.zw, (i32(e) & 1) == 1);
}
// A fan's cone, with support out to the radius it would reach on flat ground (1.5 thick / fanSlope): a fan from an apex on a
// bench high in the range fills the valley below it, never the whole plain.
fn fanRadius(thick: f32) -> f32 { return 1.5 * thick / prm.fanSlope; }
fn fanCone(seed: f32, top: f32, thick: f32, p: vec2f) -> f32 {
  if (seed < 0.0) { return -1e9; }
  let c = cellXY(seed);
  let r = distance(p, worldOf(c.x, c.y));
  if (r > fanRadius(thick)) { return -1e9; }
  return top - prm.fanSlope * r;
}
// The deposit one fan lays at p over ground h: never thicker than at its apex, a soft edge at the support radius. The jump
// flood keeps the fan with the largest deposit (a tiny share of the cone breaks ties toward the nearer apex), so the
// surface h + max deposit is continuous: creases where fans meet, no steps.
fn fanDeposit(seed: f32, top: f32, thick: f32, p: vec2f, h: f32) -> f32 {
  let f = fanCone(seed, top, thick, p);
  if (f < -1e8) { return -1e9; }
  let c = cellXY(seed);
  let r = distance(p, worldOf(c.x, c.y));
  return min(max(0.0, f - h), thick) * (1.0 - sstep(0.7, 1.0, r / fanRadius(thick))) + 1e-3 * f;
}
@compute @workgroup_size(8, 8)
fn simStep(@builtin(global_invocation_id) g: vec3u) {
  let x = i32(g.x); let y = i32(g.y);
  if (x >= labW() || y >= labH()) { return; }
  let i = idx(x, y);
  let c = u32(M[i].w);
  let s = SA[i];
  var o = s;
  let J = routeSteps();
  if (c < J) {
    if (prm.route > 0.5) {   // lagged multiple-direction accumulation: own area plus the shares of the neighbours above
      var a = labPx() * labPx();
      for (var k = 0; k < 8; k++) {
        let q = vec2i(x, y) + OFF[k];
        if (!inWin(q.x, q.y)) { continue; }
        a += SA[idx(q.x, q.y)].x * mfdShare(q.x, q.y, (k + 4) % 8);
      }
      o = vec4f(a, 0.0, 0.0, 0.0);
    } else {                 // pointer jumping on the Euler tour
      if (s.x >= 0.0) { let n = elemAt(s.x); o.x = n.x; o.y = s.y + n.y; }
      if (s.z >= 0.0) { let n = elemAt(s.z); o.z = n.x; o.w = s.w + n.y; }
    }
  } else if (c == J) {
    o = vec4f(select(s.y - s.w, s.x, prm.route > 0.5), 0.0, 0.0, 0.0);   // drainage area, px^2
  } else if (c == J + 1u) {
    // Apex test: a big catchment, gentle here, steep just above.
    let a = s.x; let sl = slopeAt(x, y);
    var up = 0.0;
    for (var k = 0; k < 8; k++) {
      let q = vec2i(x, y) + OFF[k];
      if (!inWin(q.x, q.y)) { continue; }
      if (SA[idx(q.x, q.y)].x > 0.3 * a && Hc(q.x, q.y) > Hc(x, y)) { up = max(up, slopeAt(q.x, q.y)); }
    }
    // ... and it stays gentle for prm.run world px downstream (the range front, not a bench inside the range).
    var q = vec2i(x, y); var plain = true;
    for (var k = 0; k < 160; k++) {
      if (f32(k) * labPx() > prm.run) { break; }
      let d = recvDir(q.x, q.y); if (d < 0) { break; }
      q += OFF[d];
      if (slopeAt(q.x, q.y) >= prm.fanBreak) { plain = false; break; }
    }
    let apex = a > prm.fanArea && sl < prm.fanBreak && up >= prm.fanBreak && plain;
    let thick = prm.fanK * sqrt(a / 1000.0);
    o = vec4f(select(-1.0, cellId(x, y), apex), Hc(x, y) + thick, a, thick);
    M[i].x = sl;   // kept for simApply, which must not read H around it (it writes H)
    if (prm.view > 2.5) { M[i] = vec4f(select(0.0, 1.0, a > prm.fanArea), select(0.0, 1.0, sl < prm.fanBreak), select(0.0, 1.0, up >= prm.fanBreak), f32(c + 1u)); SB[i] = o; return; }
  } else if (c < J + 2u + floodSteps()) {
    let step = 1 << (floodSteps() - 1u - (c - J - 2u));
    let p = worldOf(x, y);
    let hp = Hc(x, y);
    var best = s.xyw; var bv = fanDeposit(s.x, s.y, s.w, p, hp);
    for (var k = 0; k < 8; k++) {
      let q = vec2i(x, y) + OFF[k] * i32(step);
      if (!inWin(q.x, q.y)) { continue; }
      let t = SA[idx(q.x, q.y)];
      let v = fanDeposit(t.x, t.y, t.w, p, hp);
      if (v > bv || (v == bv && t.x >= 0.0 && t.x < best.x)) { bv = v; best = t.xyw; }
    }
    o = vec4f(best.xy, s.z, best.z);
  }
  SB[i] = o;
  M[i].w = f32(c + 1u);
}
@compute @workgroup_size(8, 8)
fn simApply(@builtin(global_invocation_id) g: vec3u) {
  let x = i32(g.x); let y = i32(g.y);
  if (x >= labW() || y >= labH()) { return; }
  let i = idx(x, y);
  if (prm.view > 2.5) { M[i] = vec4f(M[i].xyz, 0.0); return; }
  let s = SA[i]; let p = worldOf(x, y); let h = H[i];
  let area = s.z;
  var nh = h; var dep = 0.0; var grade = 0.0;
  if (prm.fans > 0.5 && s.x >= 0.0) {
    let c = cellXY(s.x); let apex = worldOf(c.x, c.y);
    let f = fanCone(s.x, s.y, s.w, p);
    // Distributaries: gullies cut into the deposit, steered by the cone's fall line (away from the apex).
    let r = distance(p, apex); let R = fanRadius(s.w);
    let fc = gullies(p, f, p - apex, prm.fanSlope * 3.0, 26.0, 0.5, 3, 3.0 * labPx(), 0x9a1u);
    let fall = mix(f, fc, sstep(6.0, 30.0, r));
    // Never thicker than at the apex, nothing on steep ground, and a soft edge at the support radius.
    let gentle = 1.0 - sstep(0.6 * prm.fanBreak, prm.fanBreak, M[i].x);
    dep = min(max(0.0, smax(h, fall, 2.0) - h), s.w) * (1.0 - sstep(0.7, 1.0, r / R)) * gentle;
    nh = h + dep;
    grade = clamp(r / R, 0.0, 1.0);
  }
  H[i] = nh;
  let laid = sstep(0.2, 2.5, dep);   // gravel near the apex, sand toward the toe
  M[i] = vec4f(0.0, laid * (1.0 - grade) * 0.8, laid * sstep(0.3, 0.9, grade), log2(1.0 + area / (labPx() * labPx())));
  if (prm.view > 1.5) { M[i] = vec4f(select(0.0, 1.0, s.x >= 0.0), select(0.0, 1.0, s.x == cellId(x, y)), fract(s.x * 0.0137), log2(1.0 + area / (labPx() * labPx()))); }
}
`;

export default {
  title: 'Fans from exact drainage in 19 passes',
  about: 'Drainage area by Euler-tour pointer jumping (exact D8, ceil(log2 2N) gather passes), slope-break apexes, and fans as a jump-flooded cone envelope with distributaries.',
  world: 'desert',
  params: {route: 0, jac: 19, fans: 1, view: 0, fanArea: 400, fanBreak: 0.32, fanK: 3.5, fanSlope: 0.07, run: 40, reach: 256, gully: 0.45, wave: 62, amount: 150},
  sim: {iterations: 40, wgsl: W},
  variants: [
    {label: 'authored', note: 'mountain front, gullies, no fans', params: {fans: 0}, lab: {iters: 0}},
    {label: 'area', note: 'log drainage area, exact (Euler tour), 19 passes', params: {fans: 0, view: 1}, lab: {pal: 0, shadow: 0, ao: 0}},
    {label: 'area-jacobi-19', note: 'lagged MFD, same 19 passes', params: {fans: 0, view: 1, route: 1, jac: 19}, lab: {pal: 0, shadow: 0, ao: 0}},
    {label: 'fans', note: 'fans at the slope breaks (exact area)', params: {}},
    {label: 'fans-jacobi-19', note: 'fans from lagged MFD at 19 passes', params: {route: 1, jac: 19}},
    {label: 'fans-2x', note: '2x zoom', params: {}, lab: {px: 0.5, ox: 140, oy: 170}},
  ],
  wgsl: /* wgsl */`
const PTS = array<vec2f, 4>(vec2f(-40.0, 60.0), vec2f(170.0, 95.0), vec2f(330.0, 70.0), vec2f(560.0, 105.0));
fn ridge(p: vec2f) -> vec2f {   // (hard distance, soft distance)
  var d = 1e9; var acc = 0.0;
  for (var k = 0; k < 3; k++) { let s = segDist(p, PTS[k], PTS[k + 1]); d = min(d, s); acc += exp(-s / 28.0); }
  return vec2f(d, -28.0 * log(max(acc, 1e-30)));
}
fn curve(t: f32) -> f32 { return t * t * (1.6 - 0.6 * t); }
fn dcurve(t: f32) -> f32 { return t * (3.2 - 1.8 * t); }
fn mountainAt(p: vec2f) -> f32 {
  let r2 = ridge(p);
  let reach = 190.0 * (1.0 + 0.2 * vnoise(p / 120.0, 0x77u));
  let wob = 16.0 * vnoise(p / 70.0, 0x51u);
  let t = 1.0 - clamp((r2.x + wob) / reach, 0.0, 1.0);
  let lumps = 1.0 + 0.4 * (0.65 * vnoise(p / 55.0, 0x1863u) + 0.35 * vnoise(p / 22.0, 0x32a7u));
  let plain = 20.0 + 0.03 * (384.0 - p.y) + 1.0 * fbmBL(p, 40.0, 3, 0.4, labPx(), 0x5u);
  let h0 = plain + prm.amount * curve(t) * lumps;
  let e = 1.0;
  let gs = vec2f(ridge(p + vec2f(e, 0.0)).y - ridge(p - vec2f(e, 0.0)).y, ridge(p + vec2f(0.0, e)).y - ridge(p - vec2f(0.0, e)).y);
  let slope = prm.amount * dcurve(t) * lumps / reach;
  return gullies(p, h0, -gs, slope * sstep(0.0, 0.25, t), prm.wave, prm.gully, 5, 3.0 * labPx(), 0x1234u);
}
fn heightAt(p: vec2f) -> f32 { return mountainAt(p); }
fn albedoAt(p: vec2f, h: f32, n: vec3f, m: vec4f) -> vec3f {
  if (prm.view > 2.5) { return m.xyz; }
  if (prm.view > 1.5) { return select(vec3f(m.z, 0.3, 0.3) * m.x, vec3f(1.0, 1.0, 0.0), m.y > 0.5); }
  if (prm.view > 0.5) {   // log2 drainage area in cells: dark blue (1 cell) to white (2^16 cells)
    let t = clamp(m.w / 16.0, 0.0, 1.0);
    return mix(mix(vec3f(0.05, 0.07, 0.2), vec3f(0.1, 0.5, 0.9), sstep(0.0, 0.5, t)), vec3f(1.0), sstep(0.45, 1.0, t));
  }
  return albedoDefault(p, h, n, m);
}
fn lightAt(p: vec2f, h: f32, n: vec3f, m: vec4f, x: i32, y: i32) -> vec3f {
  if (prm.view > 0.5) { return srgbToLin(albedoAt(p, h, n, m)) * (0.75 + 0.25 * n.z); }
  return lightDefault(p, h, n, m, x, y);
}
`,
};
