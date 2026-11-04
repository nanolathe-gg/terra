// Loose material: an escarpment with talus cones and rockfall runout.
// Shape: a plateau (110 units) whose west-facing cliff wanders; chutes on a jittered 1D lattice along the cliff notch it;
// below each chute a talus cone, concave in profile (steeper than repose near the apex, gentler at the toe), and a low talus
// apron along the whole foot; the ground is the smooth maximum of the three. All pure functions of position.
// Material: one multi-class scatter (ld-common.js) with masks from the cone field: supply (clast-supported on the cones),
// d50 growing down the cone (fall sorting: larger blocks run further), and a second, coarse population, the runout blocks
// past the toe (decaying over about a quarter of the cone length); fines fill the toe and the plain. Three artist numbers:
// supply, size (largest d50, px) and sorting (0 none .. 1 strong fall sorting). Original code; the geomorphology (fall
// sorting, concave talus profiles, bimodal talus, runout beyond the toe) is from the talus literature (see the report).
import {LD_SCATTER, LD_ALBEDO} from './ld-common.js';

export default {
  title: 'Loose material: talus cones and rockfall',
  about: 'Cones below chutes and an apron along the foot (pure functions), then one multi-class scatter: supply, size and fall sorting drive every class.',
  world: 'red',
  params: {cones: 1, supply: 1, size: 16, sorting: 1, repose: 0.72, round: 0.08, slab: 0.12,
           ldRmax: 12, ldJitter: 0.85, ldHeight: 0.75, ldSuppress: 2, ldContact: 0.55},
  variants: [
    {label: 'today', note: 'no cones; one class of 6 px chips in a band at the foot (as debrisStones)', params: {cones: 0, sorting: -1, size: 6, ldSuppress: 0, ldContact: 0}},
    {label: 'cones', note: 'cones, apron, five classes, fall sorting'},
    {label: 'unsorted', note: 'sorting 0: the same supply, sizes mixed everywhere', params: {sorting: 0}},
    {label: 'slabs', note: 'bedded rock: slab share 0.6', params: {slab: 0.6}},
    {label: 'green', note: 'green colours, supply 0.6', params: {supply: 0.6}, lab: {world: 'green'}},
    {label: 'cones-2x', note: '2x on a cone (apex to toe)', lab: {px: 0.5, ox: 150, oy: 110}},
  ],
  wgsl: /* wgsl */`
${LD_SCATTER}
${LD_ALBEDO}
const PLAIN = 20.0;
const CLIFF = 110.0;
const CDIR = vec2f(0.4472136, 0.8944272);     // along the cliff (down the screen, a little east)
const CNRM = vec2f(0.8944272, -0.4472136);    // into the plateau
const CORG = vec2f(300.0, 0.0);
const CHUTE = 58.0;                            // chute spacing along the cliff (px)

fn cliffS(p: vec2f) -> f32 { return dot(p - CORG, CDIR); }
fn cliffLine(s: f32) -> f32 { return 14.0 * vnoise(vec2f(s / 80.0, 1.3), 0x11u) + 5.0 * vnoise(vec2f(s / 27.0, 4.1), 0x12u); }

struct Chute { s: f32, depth: f32, half: f32, apex: vec2f, ah: f32, line: f32 };
fn chute(i: i32) -> Chute {
  var c: Chute;
  c.s = (f32(i) + 0.5 + 0.5 * (h1i(i, 0x21u) - 0.5)) * CHUTE;
  c.depth = 8.0 + 14.0 * h1i(i, 0x22u);
  c.half = 12.0 + 8.0 * h1i(i, 0x23u);
  c.ah = PLAIN + CLIFF * (0.30 + 0.25 * h1i(i, 0x24u)) * prm.cones;
  c.line = cliffLine(c.s);
  c.apex = CORG + CDIR * c.s + CNRM * (c.line + 0.45 * c.depth - 14.0);
  return c;
}

// Across-cliff coordinate with the chutes cut back into the plateau (a smooth notch each).
fn cliffN(p: vec2f, s: f32) -> f32 {
  var n = dot(p - CORG, CNRM) - cliffLine(s);
  let i0 = i32(floor(s / CHUTE));
  for (var i = i0 - 1; i <= i0 + 1; i++) {
    let c = chute(i);
    let u = clamp(abs(s - c.s) / c.half, 0.0, 1.0);
    let w = (1.0 - u * u);
    n -= c.depth * w * w * sstep(-30.0, 0.0, n);
  }
  return n;
}
// The bare escarpment: the face is a steep sigmoid about 26 px wide. cheap = no fine lumps (for the masks).
fn bedrockN(p: vec2f, n: f32, cheap: bool) -> f32 {
  let face = sstep(-13.0, 13.0, n);
  if (cheap) { return PLAIN + CLIFF * face; }
  let fl = 3.0 * vnoise(p / 9.0, 0x13u);
  let f2 = sstep(-13.0, 13.0, n + fl);
  let lumps = 2.0 * fbmBL(p, 50.0, 4, 0.5, labPx(), 0x14u);
  let h0 = PLAIN + CLIFF * f2 + lumps * (0.3 + f2) + 6.0 * fbmBL(p, 18.0, 3, 0.5, labPx(), 0x15u) * f2 * (1.0 - f2);
  // The face's own gullies and buttresses (lib.wgsl gullies(), steered up the face).
  let wall = 4.0 * f2 * (1.0 - f2);
  return gullies(p, h0, CNRM, 1.6 * wall, 26.0, 0.5, 3, 3.0 * labPx(), 0x77u);
}

// A concave talus profile: f(0) = 0, f(1) = 1, slope 1.31 at the apex and 0.69 at the toe (in units of the mean slope).
fn coneProfile(t: f32) -> f32 { let u = clamp(t, 0.0, 1.0); return (1.15 * u - 0.275 * u * u) / 0.875; }

// The talus field at p: (height above the plain, run-down fraction t of the dominant cone 0..1 (beyond the toe > 1),
// cone length L px). The apron counts as a cone of its own with its apex on the cliff foot.
fn talus(p: vec2f, s: f32) -> vec3f {
  if (prm.cones <= 0.0) { return vec3f(0.0, 9.0, 1.0); }
  let i0 = i32(floor(s / CHUTE));
  var best = 0.0; var tb = 9.0; var Lb = 1.0;
  for (var i = i0 - 1; i <= i0 + 1; i++) {
    let c = chute(i);
    let H = c.ah - PLAIN;
    let L = H / prm.repose;
    let t = distance(p, c.apex) / L;
    let hc = H * (1.0 - coneProfile(t));
    if (hc > best || (best <= 0.0 && t < tb)) { best = max(hc, 0.0); tb = t; Lb = L; }
  }
  // Apron: a low fillet along the foot, 6-16 units, at the same repose.
  let nf = dot(p - CORG, CNRM) - cliffLine(s) + 11.0;
  let aH = (6.0 + 10.0 * (vnoise(vec2f(s / 40.0, 7.0), 0x16u) * 0.5 + 0.5)) * prm.cones;
  let aL = aH / prm.repose;
  let ta = -nf / aL;
  let ha = select(aH * (1.0 - coneProfile(ta)), aH, ta < 0.0);
  if (ha > best) { best = ha; tb = max(ta, 0.0); Lb = aL; }
  return vec3f(best, tb, Lb);
}

// The masks: population a (supply, d50 px, sigma log2, fines) and b, the coarse runout blocks.
fn ldMask(q: vec2f) -> LdMask {
  var m: LdMask;
  let s = cliffS(q);
  let n = cliffN(q, s);
  let b = bedrockN(q, n, true);
  let t = talus(q, s);
  let onTalus = sstep(-1.0, 2.0, PLAIN + t.x - b) * sstep(0.0, 1.5, t.x);
  let plateau = sstep(PLAIN + 0.9 * CLIFF, PLAIN + 0.98 * CLIFF, b) * (1.0 - onTalus);
  let face = sstep(PLAIN + 0.15 * CLIFF, PLAIN + 0.35 * CLIFF, b) * (1.0 - plateau) * (1.0 - onTalus);
  if (prm.sorting < 0.0) {
    // Today: one class of chips in a band at the foot, as debrisStones() admits them from arrivals.
    let band = sstep(-80.0, -30.0, n) * (1.0 - sstep(-18.0, -12.0, n));
    m.a = vec4f(0.35 * band * prm.supply, prm.size, 0.2, 0.3);
    return m;
  }
  // The plain: sparse gravel. The plateau: residual chips of the caprock.
  var a = vec4f(0.05, 2.5, 1.0, 0.6);
  a = mix(a, vec4f(0.06, 3.0, 0.8, 0.45), plateau);
  if (onTalus > 0.0 && t.y <= 1.0) {
    // On talus: clast-supported, fall sorted. d50 grows from a fifth of the size at the apex to all of it at the toe.
    let sorted = mix(0.5, mix(0.12, 1.0, pow(t.y, 1.5)), prm.sorting);
    let ta = vec4f(0.95, prm.size * sorted, mix(1.8, 0.9, prm.sorting), mix(0.25, 0.08 + 0.3 * t.y * t.y, prm.sorting));
    a = mix(a, ta, onTalus);
  }
  // Runout: beyond the toe the largest blocks, fewer with distance; unsorted talus spreads them over the cone instead.
  let e = t.y - 1.0;
  var run = select(0.0, 0.45 * exp(-e / 0.25), e > 0.0 && e < 1.2) * prm.sorting;
  run = max(run, 0.08 * (1.0 - prm.sorting) * onTalus);
  m.b = vec4f(run, prm.size * 1.3, 0.45, 0.0);
  a.x *= (1.0 - face) * prm.supply;
  m.b.x *= (1.0 - face) * prm.supply;
  m.a = a;
  return m;
}
fn ldShapeAt(q: vec2f) -> vec2f { return vec2f(prm.round, prm.slab); }

var<private> gTal: f32;
fn heightAt(p: vec2f) -> f32 {
  let s = cliffS(p);
  let n = cliffN(p, s);
  let b = bedrockN(p, n, false);
  let t = talus(p, s);
  let tl = PLAIN + t.x + 0.8 * fbmBL(p, 30.0, 3, 0.5, labPx(), 0x17u) * sstep(0.0, 4.0, t.x);
  let g = smax(b, tl, 4.0);
  gTal = sstep(-1.0, 1.5, tl - b) * sstep(0.5, 3.0, t.x) * (1.0 - sstep(0.9, 1.15, t.y));
  return g + ldScatter(p);
}
fn matAt(p: vec2f, h: f32) -> vec4f {
  if (ldOut.y > 0.0) { return vec4f(ldOut.y, gTal, 0.0, ldOut.w); }
  return vec4f(0.0, 0.75 * gTal, 0.0, 2.0 + ldOut.z);
}
fn albedoAt(p: vec2f, h: f32, n: vec3f, m: vec4f) -> vec3f {
  let slope = length(n.xy) / max(n.z, 1e-3);
  var g = lab.cGround.rgb;
  g = mix(g, lab.cGrass.rgb, sstep(0.15, 0.4, slope) * (1.0 - sstep(0.8, 1.2, slope)) * (1.0 - m.y) * (1.0 - m.x));
  g = mix(g, lab.cRock.rgb, sstep(1.0, 1.8, slope) * (1.0 - m.y) * (1.0 - m.x));
  return ldAlbedo(p, h, n, m, g);
}
`,
};
