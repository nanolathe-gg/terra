// lf-dome: a low round hill stroke over a high structural dome (lf-lib's domeA: the beds arch 200 units under an 80 unit
// hill), eroded by lf-lib's column walk. The hill truncates many beds, so each hard bed crops out as a ring: hogback and
// cuesta rings, dip slopes outward, scarps facing the core (a stripped dome). Fall-line gullies (lf-lib gullyD) deep
// enough to notch the hard beds cut the outer dip slopes into facets (flatirons). A large budget breaches the soft core
// into a lowland ringed by hogbacks (a breached dome). Original code; ideas from Cordonnier et al. 2018 (folded strata under erosion).
import {LF_PARAMS, LF_WGSL} from './lf-lib.js';

export default {
  title: 'Hogback rings and flatirons on a dome',
  about: 'A round mountain over arched beds, eroded by lf-lib\'s column walk; the dome\'s height, the budget and the gullies change.',
  world: 'red',
  lab: {exposure: 1.0},
  // Red has no measured rock or ground; its quilt and slope colours are the measured ones, the rock is red's slope darkened.
  colours: {ground: [110, 61, 46], loose: [124, 72, 54], rock: [150, 84, 62], sand: [158, 104, 76]},
  params: {...LF_PARAMS, E: 70, relief: 140, thick: 3, cyc: 11, hardN: 2, vary: 0.3, hier: 0.35, K: 12, capSharp: 5,
    domeA: 200, domeR: 150, domeX: 256, domeY: 200, gullyD: 6, gullyW: 34, noiseA: 0.15,
    amount: 80, R: 230, cxm: 256, cym: 200},
  variants: [
    {label: 'swept', note: 'the stroke', params: {E: 0}},
    {label: 'rings', note: 'dome 200 under an 80 hill, E 90: hogback rings', params: {E: 90}},
    {label: 'flatirons', note: 'gullies 30: dip slopes cut into facets', params: {E: 90, gullyD: 30, gullyW: 40}},
    {label: 'breached', note: 'E 160: the core breached', params: {E: 160}},
    {label: 'flatirons-2x', note: '2x zoom', params: {E: 90, gullyD: 30, gullyW: 40}, lab: {px: 0.5, ox: 290, oy: 230}},
  ],
  wgsl: /* wgsl */`
fn baseHeight(p: vec2f) -> f32 {
  let d = p - vec2f(prm.cxm, prm.cym);
  let r = length(d) + 10.0 * vnoise(p / 80.0, 0x51u);
  let q = clamp(1.0 - r * r / (prm.R * prm.R), 0.0, 1.0); let t = q * q * q;   // a compact bell: the plain is flat
  let lumps = 1.0 + 0.12 * (0.65 * vnoise(p / 60.0, 0x1863u) + 0.35 * vnoise(p / 24.0, 0x32a7u));
  return prm.base + prm.amount * t * lumps;
}
// Smooth fall line: radially out, times the bell's slope (no lumps).
fn baseFall(p: vec2f) -> vec2f {
  let d = p - vec2f(prm.cxm, prm.cym); let r = length(d);
  let q = clamp(1.0 - r * r / (prm.R * prm.R), 0.0, 1.0);
  return normalize(d + vec2f(1e-4, 0.0)) * prm.amount * 6.0 * r / (prm.R * prm.R) * q * q;
}
fn edgeDrive(p: vec2f, h0: f32) -> f32 { return 0.0; }
fn heightAt(p: vec2f) -> f32 { return lfHeight(p); }
fn albedoAt(p: vec2f, h: f32, n: vec3f, m: vec4f) -> vec3f { return lfAlbedo(p, h, n); }
` + LF_WGSL,
};
