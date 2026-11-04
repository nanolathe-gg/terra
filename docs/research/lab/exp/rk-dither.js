// Palette quantisation and rock detail: the lab's three dither modes against three of ours, on the rk- cliff band
// lit by rk-light's line-sweep model (cavity, warm/cool off). Our modes quantise inside lightAt (the lab's palette is
// off for them) and hand back the linear value that lightMain's exposure, shoulder and gamma turn into the palette
// colour exactly. prm.dm: -1 none (the lab's pal/dither decide); 6 the engine's pair rule; 3 Knoll with 16 candidates on an 8 x 8 Bayer
// matrix; 4 a Yliluoma-style mixing plan (the best pair of the 6 nearest colours and a ratio in 16ths, mixed in
// linear light, with a penalty on pairs far apart), 8 x 8 Bayer; 5 relief-aware Knoll: the candidate spread shrinks
// where the relief already carries detail (cavity, convexity), so a 1-px crack keeps its one colour.
// Yliluoma, "Arbitrary-palette positional dithering algorithm" (2011), read for the idea only; our own code.
import {RK_SCENE, RK_ROCK, RK_ALBEDO, RK_PARAMS, RK_PRESETS} from './rk-lib.js';
import {RK_SWEEP, RK_LIGHT} from './rk-light.js';

const DITHER = /* wgsl */`
fn rkTone(c: vec3f) -> vec3f { let k = c * lab.look.z; return linToSrgb(k / (1.0 + k * 0.25)); }
fn rkUntone(s: vec3f) -> vec3f { let a = srgbToLin(s); return a / (1.0 - 0.25 * a) / lab.look.z; }
fn rkBayer8(x: i32, y: i32) -> f32 {
  // The 8 x 8 Bayer matrix from the 4 x 4 one: 4 * b4(x/2, y/2) + b2(x, y).
  let b4 = array<u32, 16>(0u, 8u, 2u, 10u, 12u, 4u, 14u, 6u, 3u, 11u, 1u, 9u, 15u, 7u, 13u, 5u);
  let b2 = array<u32, 4>(0u, 2u, 3u, 1u);
  let v = 4u * b4[u32((y >> 1) & 3) * 4u + u32((x >> 1) & 3)] + b2[u32(y & 1) * 2u + u32(x & 1)];
  return (f32(v) + 0.5) / 64.0;
}
fn rkKnoll(goal: vec3f, x: i32, y: i32, spread: f32) -> u32 {
  var cand: array<u32, 16>;
  var err = vec3f(0.0);
  for (var k = 0; k < 16; k++) {
    let c = nearestPal(goal + err * spread);
    cand[k] = c;
    err += goal - PAL[c * 2u].xyz;
  }
  for (var i = 1; i < 16; i++) {
    let v = cand[i]; var j = i - 1;
    loop { if (j < 0) { break; } if (PAL[cand[j] * 2u].x <= PAL[v * 2u].x) { break; } cand[j + 1] = cand[j]; j--; }
    cand[j + 1] = v;
  }
  return cand[min(u32(rkBayer8(x, y) * 16.0), 15u)];
}
fn rkPlan(goal: vec3f, x: i32, y: i32) -> u32 {
  var best: array<u32, 6>; var bd: array<f32, 6>;
  for (var k = 0; k < 6; k++) { best[k] = 0u; bd[k] = 1e9; }
  let np = u32(lab.extra.y);
  for (var i = 0u; i < np; i++) {
    let d = distance(PAL[i * 2u].xyz, goal);
    if (d < bd[5]) {
      var j = 5;
      loop { if (j == 0) { break; } if (bd[j - 1] <= d) { break; } bd[j] = bd[j - 1]; best[j] = best[j - 1]; j--; }
      bd[j] = d; best[j] = i;
    }
  }
  var c1 = best[0]; var c2 = best[0]; var rat = 0.0; var e0 = 1e9;
  for (var a = 0; a < 6; a++) { for (var b = a; b < 6; b++) {
    let la = srgbToLin(PAL[best[a] * 2u + 1u].xyz); let lb = srgbToLin(PAL[best[b] * 2u + 1u].xyz);
    let sep = distance(PAL[best[a] * 2u].xyz, PAL[best[b] * 2u].xyz);
    for (var r = 0; r <= 16; r++) {
      let t = f32(r) / 16.0;
      let e = distance(oklab(mix(la, lb, t)), goal);
      let pen = 0.35 * sep * (abs(t - 0.5) * 0.0 + min(t, 1.0 - t));   // only real mixtures pay for their spread
      if (e + pen < e0) { e0 = e + pen; c1 = best[a]; c2 = best[b]; rat = t; }
    }
  } }
  return select(c1, c2, rkBayer8(x, y) < rat);
}
// The engine's rule (engine-palette.wgsl): of the ten nearest in OKLab, the pair whose OKLab segment passes closest,
// plus 0.1 |A - B|^2 t (1 - t); the mix t by projection on that segment; here an 8 x 8 Bayer threshold picks.
fn rkEnginePair(goal: vec3f, x: i32, y: i32) -> u32 {
  var best: array<u32, 10>; var bd: array<f32, 10>;
  for (var k = 0; k < 10; k++) { best[k] = 0u; bd[k] = 1e30; }
  let np = u32(lab.extra.y);
  for (var i = 0u; i < np; i++) {
    var d = dot(PAL[i * 2u].xyz - goal, PAL[i * 2u].xyz - goal); var ix = i;
    for (var k = 0; k < 10; k++) { if (d < bd[k]) { let td = bd[k]; let ti = best[k]; bd[k] = d; best[k] = ix; d = td; ix = ti; } }
  }
  var err = 1e30; var pa = best[0]; var pb = best[0]; var tb = 0.0;
  for (var i = 0; i < 10; i++) { for (var j = i; j < 10; j++) {
    let a = PAL[best[i] * 2u].xyz; let b = PAL[best[j] * 2u].xyz; let d = b - a;
    let dd = max(dot(d, d), 1e-12);
    let t = clamp(dot(goal - a, d) / dd, 0.0, 1.0);
    let q = a + d * t;
    let e = dot(goal - q, goal - q) + 0.1 * dd * t * (1.0 - t);
    if (e < err) { err = e; pa = best[i]; pb = best[j]; tb = t; }
  } }
  return select(pa, pb, rkBayer8(x, y) < tb);
}
fn lightAt(p: vec2f, h: f32, n: vec3f, m: vec4f, x: i32, y: i32) -> vec3f {
  let col = rkLit(p, h, n, m, x, y);
  if (prm.dm < 2.5) { return col; }
  let goal = oklab(srgbToLin(rkTone(col)));
  var c = 0u;
  if (prm.dm < 3.5) { c = rkKnoll(goal, x, y, 0.85); }
  else if (prm.dm < 4.5) { c = rkPlan(goal, x, y); }
  else if (prm.dm > 5.5) { c = rkEnginePair(goal, x, y); }
  else {
    let detail = sstep(0.06, 0.45, abs(rkCavity(x, y, h)));
    c = rkKnoll(goal, x, y, 0.85 * (1.0 - 0.9 * detail));
  }
  return rkUntone(PAL[c * 2u + 1u].xyz);
}
`;

const S = RK_PRESETS.sandstone;
const base = {...S, age: 0.6, stain: 1, stainLen: 80, gloss: 0.8, lm: 2, dm: -1};
export default {
  title: 'rk: dithering rock detail into the TA palette',
  about: 'Nearest and Knoll (the lab) and the engine\'s pair rule against Knoll-16 on 8x8 Bayer, a Yliluoma-style mixing plan and relief-aware Knoll.',
  world: 'desert',
  lab: {exposure: 0.8},
  params: {...RK_PARAMS, lm: 2, pen: 1.5, cav: 1, glossOn: 1, wet: 0, show: 0, dm: -1},
  sim: {iterations: 8, wgsl: RK_SWEEP},
  variants: [
    {label: 'nearest', note: 'lab dither 0', params: base, lab: {dither: 0}},
    {label: 'engine', note: 'the engine\'s pair rule (10 nearest, OKLab segment), Bayer 8 x 8', params: {...base, dm: 6}, lab: {pal: 0}},
    {label: 'knoll', note: 'lab dither 2: Knoll 8, Bayer 4 x 4', params: base, lab: {dither: 2}},
    {label: 'knoll16', note: 'Knoll 16, Bayer 8 x 8', params: {...base, dm: 3}, lab: {pal: 0}},
    {label: 'plan', note: 'Yliluoma-style pair plan, Bayer 8 x 8', params: {...base, dm: 4}, lab: {pal: 0}},
    {label: 'relief', note: 'Knoll 16, spread shrinks on relief detail', params: {...base, dm: 5}, lab: {pal: 0}},
  ],
  wgsl: RK_SCENE + RK_ROCK + RK_ALBEDO + RK_LIGHT.replace('fn lightAt(', 'fn rkLit(') + DITHER,
};
