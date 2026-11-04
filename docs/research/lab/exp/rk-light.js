// Lighting for top-down rock: the lab's default light against line-sweep horizons (exact horizons in 8 azimuths, one
// thread per line, a convex-hull stack: Timonen and Westerholm 2010, Timonen 2013), a soft sun from the horizon
// angle, cosine-weighted sky visibility from the horizons (the GTAO slice integral, Jimenez et al. 2016), a
// multi-scale cavity, a warm sun against a cool sky, and gloss for varnish and wet rock. Our own code.
//
// The sim does the sweeps: iteration k sweeps azimuth sun + 45k degrees. Each pixel's state is a shift register of
// eight 12-bit horizon codes in four floats (24 bits each, exact), so every thread writes whole vec4s of its own
// pixels and no two threads write the same pixel: deterministic. The iteration knows its azimuth from how many slots
// pixel 0 has filled (4095 marks an empty slot). Light modes (prm.lm): 0 the lab's lightDefault; 1 sweep shadow and
// sky; 2 plus the cavity; 3 plus warm/cool; 4 plus gloss.
import {RK_SCENE, RK_ROCK, RK_ALBEDO, RK_PARAMS, RK_PRESETS} from './rk-lib.js';

export const RK_SWEEP = /* wgsl */`
fn rkFilled(v: vec4f) -> u32 {
  let a = vec4u(v);
  var k = 0u;
  for (var j = 0u; j < 4u; j++) { if ((a[j] >> 12u) != 4095u) { k++; } if ((a[j] & 4095u) != 4095u) { k++; } }
  return k;
}
@compute @workgroup_size(8, 8)
fn simInit(@builtin(global_invocation_id) g: vec3u) {
  let x = i32(g.x); let y = i32(g.y);
  if (x >= labW() || y >= labH()) { return; }
  SA[idx(x, y)] = vec4f(16777215.0);
}
// One thread per line of azimuth k: walk away from the azimuth, keep the upper convex hull of (distance, height) of
// the pixels passed, and the tangent from each new pixel to the hull is its horizon toward the azimuth.
fn rkSweepLine(k: u32, t: i32) {
  let W = labW(); let Hh = labH();
  let D = rot(normalize(lab.sun.xy), f32(k) * 0.78539816);
  let T = -D;
  let ax = abs(T.x); let ay = abs(T.y);
  let swap = ay > ax;
  let flipX = T.x < 0.0; let flipY = T.y < 0.0;
  let vW = select(W, Hh, swap); let vH = select(Hh, W, swap);
  var m = min(ax, ay) / max(max(ax, ay), 1e-9);
  if (m < 1e-5) { m = 0.0; }
  if (m > 1.0 - 1e-5) { m = 1.0; }
  let bMin = -i32(ceil(m * f32(vW - 1)));
  if (t >= vH - bMin) { return; }
  let b = bMin + t;
  let zk = lab.org.w; let px = labPx();
  var stk: array<vec2f, 96>;
  var n = 0;
  for (var cx = 0; cx < vW; cx++) {
    let cy = b + i32(floor(m * f32(cx) + 1e-4));
    if (cy < 0) { continue; }
    if (cy >= vH) { break; }
    var ox = select(cx, cy, swap); var oy = select(cy, cx, swap);
    if (flipX) { ox = W - 1 - ox; }
    if (flipY) { oy = Hh - 1 - oy; }
    let i = u32(oy * W + ox);
    let s = dot(vec2f(f32(ox), f32(oy)), T) * px;
    let z = H[i] * zk;
    loop {
      if (n < 2) { break; }
      let A = stk[n - 1]; let B = stk[n - 2];
      if ((B.y - z) * (s - A.x) >= (A.y - z) * (s - B.x)) { n--; } else { break; }
    }
    var ang = -1.5707963;
    if (n > 0) { let A = stk[n - 1]; ang = atan2(A.y - z, s - A.x); }
    if (n < 96) { stk[n] = vec2f(s, z); n++; } else { stk[95] = vec2f(s, z); }
    let code = u32(clamp(round((ang / PI + 0.5) * 4094.0), 0.0, 4094.0));
    let a = vec4u(SA[i]);
    SB[i] = vec4f(vec4u(((a.x & 4095u) << 12u) | (a.y >> 12u), ((a.y & 4095u) << 12u) | (a.z >> 12u),
                        ((a.z & 4095u) << 12u) | (a.w >> 12u), ((a.w & 4095u) << 12u) | code));
  }
}
@compute @workgroup_size(8, 8)
fn simStep(@builtin(global_invocation_id) g: vec3u) {
  let x = i32(g.x); let y = i32(g.y);
  if (x >= labW() || y >= labH()) { return; }
  let k = rkFilled(SA[0]);
  if (k >= 8u) { return; }
  rkSweepLine(k, y * labW() + x);
}
@compute @workgroup_size(8, 8)
fn simApply(@builtin(global_invocation_id) g: vec3u) { }

`;

export const RK_LIGHT = /* wgsl */`
// The eight horizon elevations (radians) at a pixel: [k] toward azimuth sun + 45k.
fn rkHorizons(x: i32, y: i32) -> array<f32, 8> {
  let a = vec4u(SA[idx(x, y)]);
  var r: array<f32, 8>;
  for (var j = 0u; j < 4u; j++) {
    r[2u * j] = (f32(a[j] >> 12u) / 4094.0 - 0.5) * PI;
    r[2u * j + 1u] = (f32(a[j] & 4095u) / 4094.0 - 0.5) * PI;
  }
  return r;
}
// Cosine-weighted share of the sky the horizons leave open (1 on open level ground), from four slices.
fn rkSky(hz: array<f32, 8>, n: vec3f) -> f32 {
  let D0 = normalize(lab.sun.xy);
  var v = 0.0;
  for (var j = 0; j < 4; j++) {
    let Dj = rot(D0, f32(j) * 0.78539816);
    let ns = vec2f(dot(n.xy, Dj), n.z);
    let len = length(ns);
    let gam = atan2(ns.x, ns.y);
    let h2 = gam + min(0.5 * PI - hz[j] - gam, 0.5 * PI);
    let h1 = gam + max(-(0.5 * PI - hz[j + 4]) - gam, -0.5 * PI);
    v += len * 0.25 * (-cos(2.0 * h2 - gam) + cos(gam) + 2.0 * h2 * sin(gam) - cos(2.0 * h1 - gam) + cos(gam) + 2.0 * h1 * sin(gam));
  }
  return clamp(v * 0.25, 0.0, 1.0);
}
// Multi-scale cavity: how far the ground lies below its rings at 1, 2 and 4 px, as a slope; + concave, - convex.
fn rkCavity(x: i32, y: i32, h: f32) -> f32 {
  let zk = lab.org.w; let px = labPx();
  var k = 0.0;
  let w = array<f32, 3>(0.5, 0.3, 0.2);
  for (var s = 0; s < 3; s++) {
    let r = 1 << u32(s);
    let m = (Hc(x + r, y) + Hc(x - r, y) + Hc(x, y + r) + Hc(x, y - r) + Hc(x + r, y + r) + Hc(x - r, y - r) + Hc(x + r, y - r) + Hc(x - r, y + r)) * 0.125;
    k += w[s] * (m - h) * zk / (f32(r) * px * 1.2);
  }
  return k;
}
fn rkGrey(v: f32) -> vec3f { let a = srgbToLin(vec3f(clamp(v, 0.0, 1.0))); return a / (1.0 - 0.25 * a) / lab.look.z; }
fn lightAt(p: vec2f, h: f32, n: vec3f, m: vec4f, x: i32, y: i32) -> vec3f {
  let L = lab.sun.xyz;
  // prm.show: 1 the sun's visibility, 2 the sky's, as grey (for checking the sweep against the march).
  if (prm.lm < 0.5) {
    if (prm.show > 0.5) { return rkGrey(select(occlusion(p, h), sunShadow(p, h, L), prm.show < 1.5)); }
    return lightDefault(p, h, n, m, x, y);
  }
  let hz = rkHorizons(x, y);
  let pen = radians(prm.pen);
  let sunVis = sstep(-pen, pen, asin(L.z) - hz[0]);
  let sky = rkSky(hz, n);
  if (prm.show > 0.5) { return rkGrey(select(sky, sunVis, prm.show < 1.5)); }
  var alb = srgbToLin(albedoAt(p, h, n, m));
  var cSun = srgbToLin(lab.cSun.rgb) * 2.2;
  var cSky = srgbToLin(lab.cSky.rgb) * 1.1;
  if (prm.lm >= 2.5) {   // warm sun, cool sky: the same total on open level ground
    cSun = srgbToLin(vec3f(255.0, 222.0, 178.0) / 255.0) * 2.35;
    cSky = srgbToLin(vec3f(112.0, 146.0, 214.0) / 255.0) * 1.3;
  }
  var cav = 0.0; var vex = 0.0;
  if (prm.lm >= 1.5) {
    let k = rkCavity(x, y, h);
    cav = sstep(0.04, 0.6, k) * prm.cav;
    vex = sstep(0.04, 0.6, -k) * prm.cav;
  }
  let gl = rkGloss(m) * prm.glossOn;
  let wet = prm.wet * rkOpen(m);
  alb *= 1.0 - 0.45 * wet;
  let ndl = max(dot(n, L), 0.0);
  var col = alb * (cSun * ndl * sunVis * (1.0 - 0.35 * cav) + cSky * sky * (1.0 - 0.7 * cav))
          + alb * 0.12 * (1.0 - n.z) * sky * srgbToLin(lab.cGround.rgb) * 2.0;
  col *= 1.0 + 0.35 * vex;
  if (prm.lm >= 3.5) {   // Blinn-Phong about the view (straight down): varnish, mica, wet rock
    let Hv = normalize(L + vec3f(0.0, 0.0, 1.0));
    let sp = max(gl, wet);
    let pw = mix(24.0, 90.0, sp);
    col += cSun * sp * 0.6 * (pw + 8.0) / 25.0 * pow(max(dot(n, Hv), 0.0), pw) * ndl * sunVis;
  }
  return col;
}
`;

const S = RK_PRESETS.sandstone;
const base = {...S, age: 0.6, stain: 1, stainLen: 80, gloss: 0.8};
export default {
  title: 'rk: lighting',
  about: 'The lab light against line-sweep horizons, sky visibility, multi-scale cavity, warm/cool and gloss, on varnished sandstone.',
  world: 'desert',
  lab: {exposure: 0.8},
  params: {...RK_PARAMS, lm: 1, pen: 1.5, cav: 1, glossOn: 1, wet: 0, show: 0},
  sim: {iterations: 8, wgsl: RK_SWEEP},
  variants: [
    {label: 'default', note: 'lab light: 64-step march, 8 x 5 horizon taps', params: {...base, lm: 0}, lab: {iters: 0}},
    {label: 'sweep', note: 'line-sweep sun (1.5 degree disc) and sky visibility', params: {...base, lm: 1}},
    {label: 'cavity', note: '+ multi-scale cavity and convexity', params: {...base, lm: 2}},
    {label: 'warm', note: '+ warm sun, cool sky', params: {...base, lm: 3}},
    {label: 'gloss', note: '+ gloss on the varnish', params: {...base, lm: 4}},
    {label: 'wet-2x', note: 'all, rain-wet rock, 2x', params: {...base, lm: 4, wet: 0.8}, lab: {px: 0.5, ox: 150, oy: 60}},
  ],
  wgsl: RK_SCENE + RK_ROCK + RK_ALBEDO + RK_LIGHT,
};
