// Vegetation and ground cover (vg-*): the WGSL the vg experiments share. Not an experiment itself (no default export).
//
// VG_TERRAIN: a test landscape with every site a placement rule needs. A gullied ridge (built like mountain-gullies.js)
//   with a sunny north flank and a shaded south flank, a rounded hill on the plain (every aspect at a gentle slope),
//   a hollow that holds water, and rolling ground.
// VG_FLOW: the data maps the engine's Time pass already writes (engine-weather.wgsl: flow, wetness, slope, ridge),
//   rebuilt here as a lab simulation so the experiments can read them:
//   - upslope area by multiple-flow-direction routing (Freeman 1991; exponent prm.vgMfd), as a gather: each step a pixel
//     sums what its higher neighbours send it, so after N steps every flow path up to N px long is exact. No atomics.
//   - On the last step each pixel writes its site: (broad slope, moisture, soil depth, light).
//     moisture: a topographic wetness index ln(a / tan b) (Beven and Kirkby 1979) over the neighbourhood mean of
//       ln(area) (the engine's wetness is a neighbourhood mean of flow), between prm.vgTwi0 and prm.vgTwi1.
//     light: the broad surface's insolation relative to level ground (a heat-load index from aspect and slope,
//       McCune and Keon 2002), for the lab's own sun, so shade follows any sun.
//     soil: thin on steep and convex ground (ridges, shoulders), deep in hollows and on footslopes (Cordonnier et al.
//       2017 keep a humus layer that thickens where it is gentle and wet; the engine's deposit and wear maps say it better).
// VG_PLACE: the placement rule. Seven classes (0 bare soil, 1 dry grass, 2 turf, 3 meadow, 4 scrub, 5 moss, 6 wet rush)
//   each have a viability window in (moisture, soil, light), as Cordonnier et al. 2017 and EcoBrush (Gain et al. 2017)
//   give each species; the covers are the viabilities squared times a competitive strength, normalised, with a fixed
//   weight for bare ground so it wins only where nothing grows well. A pixel's class is drawn from the covers by a
//   uniform that is spatially coherent: u = Phi(sqrt(P) z_patch + sqrt(1 - P) z_pixel), z_patch a three-octave noise at
//   the patch scale and z_pixel a per-pixel hash, both about N(0, 1), so the covers hold for any Patchiness P while P
//   moves the mix from salt-and-pepper to patches with ragged 1-px edges.
// Controls (prm): vgMoist (Moisture, 1 = as the terrain says), vgLush (Lushness: succession, from grazed turf and bare
//   ground at 0.5 to meadow and scrub thickets at 1.5; 1 is neutral),
//   vgPatchy (Patchiness, 0..1). Original code; the ideas are from the papers named.

export const VG_PARAMS = {vgMfd: 3.0, vgTwi0: 0.5, vgTwi1: 8.0, vgMoist: 1.0, vgLush: 1.0, vgPatchy: 0.8, vgPatch: 22.0};

export const VG_TERRAIN = /* wgsl */`
const VG_PTS = array<vec2f, 4>(vec2f(40.0, 150.0), vec2f(180.0, 70.0), vec2f(330.0, 110.0), vec2f(490.0, 35.0));
fn vgRidge(p: vec2f) -> vec2f {   // (hard distance, soft distance) to the ridge's three segments
  var d = 1e9; var acc = 0.0;
  for (var k = 0; k < 3; k++) { let s = segDist(p, VG_PTS[k], VG_PTS[k + 1]); d = min(d, s); acc += exp(-s / 28.0); }
  return vec2f(d, -28.0 * log(max(acc, 1e-30)));
}
fn vgTerrain(p: vec2f) -> f32 {
  let r = vgRidge(p);
  let reach = 135.0 * (1.0 + 0.25 * vnoise(p / 120.0, 0x77u));
  let wob = 18.0 * vnoise(p / 70.0, 0x51u);
  let t = 1.0 - clamp((r.x + wob) / reach, 0.0, 1.0);
  let lumps = 1.0 + 0.45 * (0.65 * vnoise(p / 55.0, 0x1863u) + 0.35 * vnoise(p / 22.0, 0x32a7u));
  let amp = 100.0;
  var h = 22.0 + amp * t * t * (1.6 - 0.6 * t) * lumps;
  let e = 1.0;
  let gs = vec2f(vgRidge(p + vec2f(e, 0.0)).y - vgRidge(p - vec2f(e, 0.0)).y, vgRidge(p + vec2f(0.0, e)).y - vgRidge(p - vec2f(0.0, e)).y);
  let slope = amp * t * (3.2 - 1.8 * t) * lumps / reach;
  h = gullies(p, h, -gs, slope * sstep(0.0, 0.25, t), 62.0, 0.45, 5, 3.0 * labPx(), 0x1234u);
  // A rounded hill on the plain: every aspect at a gentle slope.
  let dq = (p - vec2f(392.0, 292.0)) * vec2f(1.0, 1.2);
  let td = 1.0 - clamp(length(dq) / (88.0 * (1.0 + 0.15 * vnoise(p / 40.0, 0x2bu))), 0.0, 1.0);
  h += 34.0 * td * td * (3.0 - 2.0 * td);
  // A hollow that holds water.
  let dh = length(p - vec2f(118.0, 318.0)) / 52.0;
  h -= 8.0 * exp(-2.0 * dh * dh);
  // Rolling ground.
  h += 4.0 * fbm(p, 85.0, 3, 0.5, 0x3a1u);
  return h;
}
`;

export const VG_FLOW = /* wgsl */`
const VG_D = array<vec2i, 8>(vec2i(1, 0), vec2i(-1, 0), vec2i(0, 1), vec2i(0, -1), vec2i(1, 1), vec2i(-1, 1), vec2i(1, -1), vec2i(-1, -1));
fn vgIn(q: vec2i) -> bool { return q.x >= 0 && q.y >= 0 && q.x < labW() && q.y < labH(); }
// Outside the window the terrain is the pure function, so water leaving the window leaves it.
fn vgHq(q: vec2i) -> f32 { if (vgIn(q)) { return Hc(q.x, q.y); } return vgTerrain(worldOf(q.x, q.y)); }
fn vgMfd(drop: f32, k: i32) -> f32 {
  if (drop <= 0.0) { return 0.0; }
  let d = select(1.0, 1.41421356, k >= 4) * labPx();
  return pow(drop / d, prm.vgMfd);
}
// The site the placement reads, from the heights and the area (written once, on the last step).
fn vgSite(x: i32, y: i32) -> vec4f {
  let px = labPx(); let zk = lab.org.w;
  let h = Hc(x, y);
  let S = length(vec2f(Hc(x + 1, y) - Hc(x - 1, y), Hc(x, y + 1) - Hc(x, y - 1))) / (2.0 * px);
  let st = max(i32(round(2.0 / px)), 1);
  var la = 0.0; var ws = 0.0;
  for (var j = -2; j <= 2; j++) { for (var i = -2; i <= 2; i++) {
    let w = 1.0 / (1.0 + f32(i * i + j * j));
    la += w * log(max(SA[idx(x + i * st, y + j * st)].x / px, 1.0)); ws += w;
  } }
  la /= ws;
  let twi = la - log(S * zk + 0.05);
  let moist = sstep(prm.vgTwi0, prm.vgTwi1, twi);
  let r = max(i32(round(6.0 / px)), 1);
  let gb = vec2f(Hc(x + r, y) - Hc(x - r, y), Hc(x, y + r) - Hc(x, y - r)) / (2.0 * f32(r) * px);
  let nb = normalize(vec3f(-gb * zk, 1.0));
  let sdir = lab.sun.xyz;
  let light = max(dot(nb, sdir), 0.0) / max(sdir.z, 0.05);
  var conv = 0.0;
  for (var k = 0; k < 8; k++) {
    let a = f32(k) * 0.7853982;
    let d = vec2f(cos(a), sin(a));
    let q1 = vec2i(round(vec2f(f32(x), f32(y)) + d * 16.0 / px));
    let q2 = vec2i(round(vec2f(f32(x), f32(y)) + d * 40.0 / px));
    conv += (h - Hc(q1.x, q1.y)) + 0.5 * (h - Hc(q2.x, q2.y));
  }
  conv /= 8.0;
  let soil = clamp(1.0 - sstep(1.1, 2.6, S) - 0.5 * sstep(4.0, 16.0, conv) + 0.5 * sstep(-1.0, -7.0, conv) + 0.2 * moist, 0.0, 1.0);
  return vec4f(length(gb), moist, soil, light);
}
@compute @workgroup_size(8, 8)
fn simInit(@builtin(global_invocation_id) g: vec3u) {
  let x = i32(g.x); let y = i32(g.y);
  if (x >= labW() || y >= labH()) { return; }
  let h = Hc(x, y);
  var den = 0.0;
  for (var k = 0; k < 8; k++) { den += vgMfd(h - vgHq(vec2i(x, y) + VG_D[k]), k); }
  SA[idx(x, y)] = vec4f(labPx() * labPx(), den, 0.0, 0.0);
}
@compute @workgroup_size(8, 8)
fn simStep(@builtin(global_invocation_id) g: vec3u) {
  let x = i32(g.x); let y = i32(g.y);
  if (x >= labW() || y >= labH()) { return; }
  let h = Hc(x, y);
  var a = labPx() * labPx();
  for (var k = 0; k < 8; k++) {
    let q = vec2i(x, y) + VG_D[k];
    if (!vgIn(q)) { continue; }
    let s = SA[idx(q.x, q.y)];
    if (s.y <= 0.0) { continue; }
    a += s.x * vgMfd(Hc(q.x, q.y) - h, k) / s.y;
  }
  let me = SA[idx(x, y)];
  if (labStep() + 1u < labIter()) { SB[idx(x, y)] = vec4f(a, me.y, 0.0, 0.0); return; }
  SB[idx(x, y)] = vgSite(x, y);   // (broad slope, moisture, soil, light): the area is done with
}
@compute @workgroup_size(8, 8)
fn simApply(@builtin(global_invocation_id) g: vec3u) {
  let x = i32(g.x); let y = i32(g.y);
  if (x >= labW() || y >= labH()) { return; }
  vgApply(x, y);
}
// The site at any world point in the window (read-only in simApply, so any pixel may read any other's).
fn vgSiteAt(c: vec2f) -> vec4f { let q = vec2i(floor((c - lab.org.xy) / labPx())); return SA[idx(q.x, q.y)]; }
`;

export const VG_PLACE = /* wgsl */`
fn vgWin(v: f32, a: f32, b: f32, c: f32, d: f32) -> f32 { return sstep(a, b, v) * (1.0 - sstep(c, d, v)); }
// (moisture, soil, light) after the Moisture control and the aspect: a face turned from the sun keeps its water.
fn vgSiteAdj(s: vec4f) -> vec3f {
  let shade = clamp(1.0 - s.w, -0.6, 1.0);
  return vec3f(clamp(s.y + 0.28 * shade + 0.4 * (prm.vgMoist - 1.0), 0.0, 1.0), s.z, s.w);
}
// Covers of the seven classes: 0 bare, 1 dry grass, 2 turf, 3 meadow, 4 scrub, 5 moss, 6 wet rush.
fn vgCovers(s: vec4f) -> array<f32, 7> {
  let q = vgSiteAdj(s); let m = q.x; let so = q.y; let li = q.z;
  let L = prm.vgLush;
  var v: array<f32, 7>;
  v[0] = 0.0;
  v[1] = 0.65 * vgWin(m, -1.0, 0.0, 0.2, 0.42) * sstep(0.05, 0.3, so) * sstep(1.0, 1.35, li);
  v[2] = max(2.0 - L, 0.0) * vgWin(m, -0.1, 0.12, 0.72, 0.92) * sstep(0.08, 0.3, so);
  v[3] = L * 1.1 * vgWin(m, 0.42, 0.65, 0.9, 1.01) * sstep(0.4, 0.75, so) * sstep(0.55, 0.9, li);
  v[4] = L * L * 1.15 * vgWin(m, 0.35, 0.6, 0.86, 0.97) * sstep(0.5, 0.85, so);
  v[5] = 0.8 * sstep(0.12, 0.4, m) * (1.0 - sstep(0.6, 0.95, li)) * (1.0 - 0.5 * sstep(0.6, 0.9, so));
  v[6] = L * sstep(0.84, 0.97, m) * sstep(0.45, 0.75, so);
  let bare = 0.045 / max(L, 0.1);
  var tot = bare;
  for (var k = 1; k < 7; k++) { v[k] = v[k] * v[k]; tot += v[k]; }
  v[0] = bare;
  for (var k = 0; k < 7; k++) { v[k] = v[k] / tot; }
  return v;
}
// About N(0, 1): coherent at the patch scale, and per pixel.
fn vgZPatch(p: vec2f) -> f32 {
  let s = prm.vgPatch;
  return (gnoised(p / s, 0x71u).x + 0.5 * gnoised(p / (0.45 * s), 0x93u).x + 0.25 * gnoised(p / (0.2 * s), 0xb7u).x) / 0.36;
}
fn vgZPixel(p: vec2f) -> f32 {
  let c = vec2i(floor(p));
  return (h01(c.x, c.y, 0x11u) + h01(c.x, c.y, 0x22u) + h01(c.x, c.y, 0x33u) - 1.5) * 2.0;
}
fn vgU(p: vec2f) -> f32 {
  let P = clamp(prm.vgPatchy, 0.0, 1.0);
  let z = sqrt(P) * vgZPatch(p) + sqrt(1.0 - P) * vgZPixel(p);
  return 1.0 / (1.0 + exp(-1.702 * z));
}
fn vgPick(c: array<f32, 7>, u: f32) -> i32 {
  var acc = 0.0;
  for (var k = 0; k < 7; k++) { acc += c[k]; if (u < acc) { return k; } }
  return 6;
}
// Modern Green's class colours (sRGB 0..1): grass near Green's measured ground (55, 93, 27).
const VG_COL = array<vec3f, 7>(
  vec3f(0.40, 0.34, 0.22),   // bare soil
  vec3f(0.45, 0.44, 0.22),   // dry grass, straw
  vec3f(0.235, 0.385, 0.12), // turf, short grass
  vec3f(0.19, 0.37, 0.10),   // meadow, tall grass
  vec3f(0.13, 0.245, 0.10),  // scrub
  vec3f(0.21, 0.33, 0.15),   // moss
  vec3f(0.16, 0.29, 0.17));  // wet rush
const VG_FALSE = array<vec3f, 7>(vec3f(0.80, 0.66, 0.46), vec3f(0.92, 0.86, 0.35), vec3f(0.50, 0.80, 0.25), vec3f(0.15, 0.58, 0.15),
  vec3f(0.06, 0.30, 0.08), vec3f(0.25, 0.70, 0.70), vec3f(0.18, 0.30, 0.85));
// A class's colour with its own grain at 1x (slope in height units per px; bare ground turns to rock where steep).
fn vgAlbedo(k: i32, p: vec2f, slope: f32) -> vec3f {
  let c = vec2i(floor(p));
  let hp = hs(c.x, c.y, 0x5a17u);
  var col = VG_COL[k];
  var g = 0.0;
  switch k {
    case 0: { col = mix(col, lab.cRock.rgb, sstep(0.55, 1.2, slope)); g = 0.12 * hp + 0.05 * vnoise(p / 4.0, 0x31u); }
    case 1: { g = 0.10 * hp + 0.06 * vnoise(p / 3.0, 0x32u); }
    case 2: { g = 0.07 * hp + 0.04 * vnoise(p / 5.0, 0x33u); }
    case 3: { g = 0.05 * hp + 0.12 * vnoise(p / 1.7, 0x34u); }
    case 4: { g = 0.06 * hp + 0.18 * vnoise(p / 2.2, 0x35u); }
    case 5: { g = 0.03 * hp + 0.07 * vnoise(p / 3.0, 0x36u); }
    default: { g = 0.10 * hs(c.x, c.y / 2, 0x5a18u) + 0.05 * vnoise(p / 3.0, 0x37u); }
  }
  return col * (1.0 + g);
}
// The ground classes without scrub (its share goes to the others), for a page that draws shrubs as their own scatter.
fn vgGround(c0: array<f32, 7>) -> array<f32, 7> {
  var c = c0; let keep = max(1.0 - c[4], 1e-4); c[4] = 0.0;
  for (var k = 0; k < 7; k++) { c[k] = c[k] / keep; }
  return c;
}
fn vgU01(h: u32) -> f32 { return f32(h >> 8u) / 16777216.0; }
fn vgSlopeOf(n: vec3f) -> f32 { return length(n.xy) / max(n.z, 1e-3) / max(lab.org.w, 1e-3); }
`;
