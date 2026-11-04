// lf-strata: one mechanism, many landforms. A broad hill stroke (engine-shape.wgsl kind 5 style: a swept curve on a soft
// distance, value-noise lumps) is eroded through a tilted, folded rock column by lf-lib's closed-form column walk. Only the
// structure changes between variants: flat beds give stepped benches and mesas, a gentle dip gives cuestas, a steep dip
// hogbacks, a plunging fold zig-zag ridges (vertical beds make razor walls without a talus step: see the report). Original code; ideas from Cordonnier et al. 2018.
import {LF_PARAMS, LF_WGSL} from './lf-lib.js';

export default {
  title: 'Landforms from the rock column',
  about: 'One hill, one erosion budget; only the beds\' dip, strike and folding change. Hard beds (1 + K * hardness) stand, soft beds strip.',
  world: 'desert',
  lab: {exposure: 0.85},   // the desert's measured ground is pale; the lab's default exposure washes it out
  // Desert has no measured rock colour; these are the desert column's own bed colours (materials/desert.json world.column).
  colours: {rock: [175, 111, 90], sand: [204, 178, 140], loose: [189, 140, 108]},
  params: {...LF_PARAMS, E: 105, relief: 120, noiseA: 0.25, gullyD: 10, thick: 3, cyc: 10, hardN: 2, K: 12, strike: 20, sx: 170, sy: 205, ex: 350, ey: 180, reach: 215, amount: 140},
  variants: [
    {label: 'swept', note: 'the stroke, no erosion', params: {E: 0}},
    {label: 'flat', note: 'flat beds: benches, mesas', params: {dip: 0}},
    {label: 'cuesta', note: 'dip 9 deg: cuestas', params: {dip: 9}},
    {label: 'hogback', note: 'dip 50 deg: hogbacks', params: {dip: 50}},
    {label: 'plunge', note: 'plunging folds: zig-zag ridges', params: {dip: 6, strike: 110, foldA: 45, foldW: 230, foldAng: 20}},
    {label: 'hogback-2x', note: '2x zoom', params: {dip: 50}, lab: {px: 0.5, ox: 150, oy: 120}},
  ],
  wgsl: /* wgsl */`
fn baseHeight(p: vec2f) -> f32 {
  let a = vec2f(prm.sx, prm.sy); let b = vec2f(prm.ex, prm.ey);
  let reach = prm.reach * (1.0 + 0.2 * vnoise(p / 130.0, 0x77u));
  let d = segDist(p, a, b) + 16.0 * vnoise(p / 70.0, 0x51u);
  let t = 1.0 - clamp(d / reach, 0.0, 1.0);
  let lumps = 1.0 + 0.3 * (0.65 * vnoise(p / 60.0, 0x1863u) + 0.35 * vnoise(p / 24.0, 0x32a7u));
  return prm.base + prm.amount * t * t * (3.0 - 2.0 * t) * lumps;
}
// The stroke's smooth fall line: away from the segment, times the swept curve's slope (no lumps).
fn baseFall(p: vec2f) -> vec2f {
  let a = vec2f(prm.sx, prm.sy); let b = vec2f(prm.ex, prm.ey);
  let ab = b - a; let q = a + ab * clamp(dot(p - a, ab) / dot(ab, ab), 0.0, 1.0);
  let d = length(p - q); let t = 1.0 - clamp(d / prm.reach, 0.0, 1.0);
  return normalize(p - q + vec2f(1e-4, 0.0)) * prm.amount * 6.0 * t * (1.0 - t) / prm.reach;
}
fn edgeDrive(p: vec2f, h0: f32) -> f32 { return 0.0; }
fn heightAt(p: vec2f) -> f32 { return lfHeight(p); }
fn albedoAt(p: vec2f, h: f32, n: vec3f, m: vec4f) -> vec3f { return lfAlbedo(p, h, n); }
` + LF_WGSL,
};
