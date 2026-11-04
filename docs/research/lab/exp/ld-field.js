// Loose material: placement rules from masks, driven by three artist numbers (supply, size, sorting).
// Shape: a gentle valley with a meandering wash (a channel ~14 px wide, 3.5 units deep) and lumpy slopes either side.
// Masks, all pure functions: flow (closeness to the thalweg), curvature (a Laplacian of the smooth ground over 8 px: hollows
// and noses) and slope. Rules, each one population for the ld scatter (ld-common.js):
//   thalweg: channel lag, coarse (0.6 size) and well sorted, rounded, not buried (the fines are winnowed out);
//   channel margins: bars of gravel (0.25 size), rounded;
//   banks and hollows: fines and sand bury what lies there, few stones;
//   noses and steeper slopes: residual angular chips (0.3 size, poorly sorted);
//   flats: a sparse gravel, or with pavement on a desert pavement: a packed mosaic of 2-4 px gravel, flat and buried.
// sorting blends every rule toward one unsorted mixture (0) or the full rules (1). Original code; the rules are the
// sedimentology of channel lag, bars, hollows and desert pavement (see the report).
import {LD_SCATTER, LD_ALBEDO} from './ld-common.js';

export default {
  title: 'Loose material: placement rules',
  about: 'A wash in a valley. Supply, size and sorting drive channel lag, gravel bars, fines in hollows, residual chips on noses and (desert) pavement.',
  world: 'green',
  params: {supply: 0.6, size: 10, sorting: 0.8, pavement: 0,
           ldRmax: 10, ldJitter: 0.85, ldHeight: 0.7, ldSuppress: 2, ldContact: 0.5},
  variants: [
    {label: 'field', note: 'supply 0.6, size 10, sorting 0.8'},
    {label: 'sparse', note: 'supply 0.25', params: {supply: 0.25}},
    {label: 'coarse', note: 'size 20', params: {size: 20, ldRmax: 16}},
    {label: 'unsorted', note: 'sorting 0: one mixture everywhere', params: {sorting: 0}},
    {label: 'desert', note: 'desert colours, pavement on the flats', params: {pavement: 1, supply: 0.8}, lab: {world: 'desert'}},
    {label: 'field-2x', note: '2x on the wash', lab: {px: 0.5, ox: 130, oy: 100}},
  ],
  wgsl: /* wgsl */`
${LD_SCATTER}
${LD_ALBEDO}
fn washX(y: f32) -> f32 { return 250.0 + 46.0 * sin(y / 67.0 + 0.4) + 18.0 * vnoise(vec2f(3.1, y / 40.0), 0x41u); }
// Distance to the thalweg (px), approximately (the meander's slope corrects the horizontal distance).
fn washD(p: vec2f) -> f32 {
  let x0 = washX(p.y);
  let dx = (washX(p.y + 2.0) - washX(p.y - 2.0)) / 4.0;
  return abs(p.x - x0) / sqrt(1.0 + dx * dx);
}
// The smooth ground (no channel, no stones): a valley whose floor falls to the south, lumps on its sides.
fn smoothGround(p: vec2f) -> f32 {
  let d = washD(p);
  let ax = p.x - 250.0;
  // The broad valley has a straight axis; the meander belt (within ~70 px of the axis) is level across.
  let valley = 0.0008 * ax * ax + 0.04 * (384.0 - p.y);
  return 18.0 + valley + 7.0 * (0.7 * vnoise(p / 70.0, 0x42u) + 0.3 * vnoise(p / 31.0, 0x45u)) * sstep(10.0, 60.0, d);
}
// Which side of the wash p is on, relative to the bend: 1 on the inside (point bars), -1 on the outside (cut bank).
fn bendSide(p: vec2f) -> f32 {
  let x0 = washX(p.y);
  let curv = washX(p.y + 12.0) + washX(p.y - 12.0) - 2.0 * x0;
  return sign(p.x - x0) * (sstep(-5.0, 5.0, curv) * 2.0 - 1.0);
}
fn channelCut(d: f32) -> f32 { let u = clamp(d / 9.0, 0.0, 1.0); return 3.5 * (1.0 - u * u) * (1.0 - u * u); }

struct Site { flow: f32, curv: f32, slope: f32, d: f32, bar: f32 };
fn site(q: vec2f) -> Site {
  var s: Site;
  s.d = washD(q);
  s.flow = 1.0 - sstep(2.0, 11.0, s.d);
  s.bar = sstep(0.0, 0.6, bendSide(q));
  let e = 8.0;
  let h = smoothGround(q);
  let hx1 = smoothGround(q + vec2f(e, 0.0)); let hx0 = smoothGround(q - vec2f(e, 0.0));
  let hy1 = smoothGround(q + vec2f(0.0, e)); let hy0 = smoothGround(q - vec2f(0.0, e));
  s.curv = (hx1 + hx0 + hy1 + hy0 - 4.0 * h) / (e * e);          // > 0 in hollows
  s.slope = length(vec2f(hx1 - hx0, hy1 - hy0)) / (2.0 * e);
  return s;
}

// The rules: population a (supply, d50, sigma, fines), and the roundness (in b.w, read by ldShapeAt through gRound).
fn rules(s: Site) -> vec4f {
  let Z = prm.size;
  // Flats: sparse gravel, or desert pavement.
  var a = mix(vec4f(0.10, 0.25 * Z, 1.2, 0.55), vec4f(0.85, 2.4, 0.35, 0.78), prm.pavement);
  // Noses and steeper slopes: residual angular chips.
  let nose = sstep(0.0, 0.025, -s.curv) * sstep(0.08, 0.25, s.slope);
  a = mix(a, vec4f(0.45, 0.3 * Z, 1.5, 0.25), nose);
  // Hollows and banks: fines bury, few stones.
  let hollow = sstep(0.0, 0.02, s.curv) * (1.0 - s.flow);
  let bar = s.bar * sstep(8.0, 11.0, s.d) * (1.0 - sstep(18.0, 30.0, s.d));
  a = mix(a, vec4f(0.06, 0.2 * Z, 1.0, 0.9), max(hollow, bar));
  // Channel margins on the inside of bends: gravel bars, finer away from the thalweg; the thalweg: coarse lag, clean.
  let margin = sstep(0.15, 0.4, s.flow) * (1.0 - sstep(0.6, 0.85, s.flow)) * max(s.bar, 0.3);
  a = mix(a, vec4f(0.7, 0.25 * Z, 0.7, 0.35), margin);
  a = mix(a, vec4f(0.75, 0.6 * Z, 0.55, 0.08), sstep(0.6, 0.9, s.flow));
  // Unsorted: one mixture everywhere at the same mean supply.
  return mix(vec4f(a.x, 0.35 * Z, 1.8, 0.4), a, prm.sorting);
}
fn ldMask(q: vec2f) -> LdMask {
  var m: LdMask;
  let a = rules(site(q));
  m.a = vec4f(a.x * prm.supply / 0.6, a.yzw);
  m.a.x = min(m.a.x, 0.98);
  return m;
}
fn ldShapeAt(q: vec2f) -> vec2f {
  // Water rounds what it carries: rounded in and beside the channel, angular elsewhere.
  let f = 1.0 - sstep(4.0, 16.0, washD(q));
  return vec2f(mix(0.15, mix(0.5, 0.95, f), prm.sorting), 0.05);
}

var<private> gSand: f32;
var<private> gFines: f32;
fn heightAt(p: vec2f) -> f32 {
  let d = washD(p);
  let g = smoothGround(p) - channelCut(d) + 0.5 * fbmBL(p, 16.0, 3, 0.5, labPx(), 0x43u);
  let s = site(p);
  let a = rules(s);
  gFines = a.w * (1.0 - s.flow);
  gSand = s.bar * sstep(9.0, 12.0, d) * (1.0 - sstep(15.0, 26.0, d + 5.0 * vnoise(p / 11.0, 0x44u))) * prm.sorting;
  return g + ldScatter(p);
}
fn matAt(p: vec2f, h: f32) -> vec4f {
  if (ldOut.y > 0.0) { return vec4f(ldOut.y, 0.0, 0.0, ldOut.w); }
  return vec4f(0.0, 0.7 * sstep(0.5, 0.9, gFines), gSand, 2.0 + ldOut.z);
}
fn albedoAt(p: vec2f, h: f32, n: vec3f, m: vec4f) -> vec3f {
  let wet = 1.0 - sstep(3.0, 10.0, washD(p));
  let g = mix(lab.cGround.rgb, lab.cLoose.rgb * 0.85, wet);
  return ldAlbedo(p, h, n, m, g);
}
`,
};
