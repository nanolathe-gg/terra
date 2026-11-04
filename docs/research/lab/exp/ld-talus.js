// Loose material: an escarpment with talus cones and rockfall runout.
// Shape: a plateau (110 units) whose west-facing cliff wanders; chutes on a jittered 1D lattice along the cliff notch it;
// below each chute a talus cone, concave in profile (steeper than repose near the apex, gentler at the toe), and a low talus
// apron along the whole foot; the ground is the smooth maximum of the three. All pure functions of position.
// Material: one multi-class scatter (ld-common.js) with masks from the cone field: supply (clast-supported on the cones),
// d50 growing down the cone (fall sorting: larger blocks run further) and the largest blocks out past the toe (runout,
// decaying over about a fifth of the cone length), fines filling the toe and the plain. Three artist numbers: supply,
// size (largest d50, px) and sorting (0 none .. 1 strong fall sorting). Original code; the geomorphology (fall sorting,
// concave talus profiles, runout beyond the toe) is from the talus literature (see the report).
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
    {label: 'cones-2x', note: '2x on a cone (apex to toe)', lab: {px: 0.5, ox: 40, oy: 120}},
  ],
  wgsl: /* wgsl */`
${LD_SCATTER}
${LD_ALBEDO}
const PLAIN = 20.0;
const CLIFF = 110.0;
const CDIR = vec2f(0.4472136, 0.8944272);     // along the cliff (down the screen, a little east)
const CNRM = vec2f(0.8944272, -0.4472136);    // into the plateau
const CORG = vec2f(250.0, 0.0);
const CHUTE = 66.0;                            // chute spacing along the cliff (px)

fn cliffS(p: vec2f) -> f32 { return dot(p - CORG, CDIR); }
fn cliffLine(s: f32) -> f32 { return 16.0 * vnoise(vec2f(s / 70.0, 1.3), 0x11u) + 7.0 * vnoise(vec2f(s / 23.0, 4.1), 0x12u); }

struct Chute { s: f32, depth: f32, half: f32, apex: vec2f, ah: f32 };
fn chute(i: i32) -> Chute {
  var c: Chute;
  c.s = (f32(i) + 0.5 + 0.6 * (h1i(i, 0x21u) - 0.5)) * CHUTE;
  c.depth = 18.0 + 22.0 * h1i(i, 0x22u);
  c.half = 14.0 + 10.0 * h1i(i, 0x23u);
  c.ah = PLAIN + CLIFF * (0.30 + 0.25 * h1i(i, 0x24u)) * prm.cones;
  let n = cliffLine(c.s) + c.depth - 16.0;
  c.apex = CORG + CDIR * c.s + CNRM * n;
  return c;
}

// The bare escarpment: the face is a steep sigmoid about 30 px wide, notched back at each chute.
fn bedrock(p: vec2f) -> f32 {
  let s = cliffS(p);
  var n = dot(p - CORG, CNRM) - cliffLine(s);
  let i0 = i32(floor(s / CHUTE));
  for (var i = i0 - 1; i <= i0 + 1; i++) {
    let c = chute(i);
    n -= c.depth * max(0.0, 1.0 - abs(s - c.s) / c.half) * sstep(-40.0, 0.0, n);
  }
  let face = sstep(-16.0, 16.0, n + 3.0 * vnoise(p / 9.0, 0x13u));
  let lumps = 2.5 * fbmBL(p, 60.0, 4, 0.5, labPx(), 0x14u);
  return PLAIN + CLIFF * face + lumps * (0.4 + face) + 1.5 * fbmBL(p, 25.0, 3, 0.5, labPx(), 0x15u) * face * (1.0 - face) * 4.0;
}

// A concave talus profile: f(0) = 0, f(1) = 1, slope 1.31 at the apex and 0.69 at the toe (in units of the mean slope).
fn coneProfile(t: f32) -> f32 { let u = clamp(t, 0.0, 1.0); return (1.15 * u - 0.275 * u * u) / 0.875; }

// The talus field at p: (height above the plain, run-down fraction t of the dominant cone 0..1 (beyond the toe > 1),
// cone length L px). The apron counts as a cone of its own with apex on the cliff foot.
fn talus(p: vec2f) -> vec3f {
  if (prm.cones <= 0.0) { return vec3f(0.0, 9.0, 1.0); }
  let s = cliffS(p);
  let i0 = i32(floor(s / CHUTE));
  var best = 0.0; var tb = 9.0; var Lb = 1.0; var dmin = 1e9;
  for (var i = i0 - 1; i <= i0 + 1; i++) {
    let c = chute(i);
    let H = c.ah - PLAIN;
    let L = H / prm.repose;
    let d = distance(p, c.apex);
    let t = d / L;
    let hc = H * (1.0 - coneProfile(t));
    if (hc > best) { best = hc; tb = t; Lb = L; }
    if (t < tb && best <= 0.0) { tb = t; Lb = L; }
  }
  // Apron: a low fillet along the foot, 8-18 units, at the same repose.
  let nf = dot(p - CORG, CNRM) - cliffLine(s) + 16.0;
  let aH = (8.0 + 10.0 * (vnoise(vec2f(s / 40.0, 7.0), 0x16u) * 0.5 + 0.5)) * prm.cones;
  let aL = aH / prm.repose;
  let ta = -nf / aL;
  let ha = select(aH * (1.0 - coneProfile(ta)), 0.0, ta < 0.0);
  if (ha > best) { best = ha; tb = ta; Lb = aL; }
  return vec3f(best, tb, Lb);
}

fn baseGround(p: vec2f) -> f32 {
  let b = bedrock(p);
  let t = talus(p);
  return smax(b, PLAIN + t.x + 1.0 * fbmBL(p, 30.0, 3, 0.5, labPx(), 0x17u) * sstep(0.0, 4.0, t.x), 5.0);
}

// The masks: (supply, d50 px, sigma log2, fines).
fn ldMask(q: vec2f) -> vec4f {
  let b = bedrock(q);
  let t = talus(q);
  let face = sstep(PLAIN + 0.25 * CLIFF, PLAIN + 0.5 * CLIFF, b) * (1.0 - sstep(PLAIN + 0.85 * CLIFF, PLAIN + 0.97 * CLIFF, b));
  let onFace = face * sstep(0.0, 6.0, b - (PLAIN + t.x));     // the bare face above the talus
  if (prm.sorting < 0.0) {
    // Today: one class of chips in a band at the foot, as debrisStones() admits them from arrivals.
    let n = dot(q - CORG, CNRM) - cliffLine(cliffS(q));
    let band = sstep(-80.0, -30.0, n) * (1.0 - sstep(-20.0, -12.0, n));
    return vec4f(0.35 * band * prm.supply, prm.size, 0.2, 0.3);
  }
  let plateau = sstep(PLAIN + 0.9 * CLIFF, PLAIN + 0.98 * CLIFF, b);
  var S = 0.0; var d50 = 2.0; var sig = 1.0; var fines = 0.6;
  if (t.y <= 1.0) {
    // On talus: clast-supported, fall sorted. d50 grows from a fifth of the size at the apex to all of it at the toe.
    let sorted = mix(0.6, mix(0.18, 1.0, pow(t.y, 1.2)), prm.sorting);
    S = 0.95 * sstep(0.0, 2.0, t.x);
    d50 = prm.size * sorted;
    sig = mix(1.8, 0.9, prm.sorting);
    fines = mix(0.25, 0.08 + 0.35 * t.y * t.y, prm.sorting);
  }
  // Runout: beyond the toe the largest blocks, fewer with distance (about a fifth of the cone length).
  let e = max(t.y - 1.0, 0.0);
  let run = select(0.0, 0.55 * exp(-e / 0.2), t.y > 1.0 && t.y < 2.5);
  if (run > S * 0.5) {
    S = max(S, run);
    d50 = prm.size * mix(0.6, 1.25, prm.sorting);
    sig = mix(1.8, 0.6, prm.sorting);
    fines = 0.5;
  }
  // Residual chips on the plateau (weathered caprock), sparse gravel on the plain, nothing on the bare face.
  S = max(S, 0.12 * plateau);
  if (plateau > 0.5) { d50 = 3.0; sig = 1.0; fines = 0.35; }
  S = max(S, 0.05 * (1.0 - plateau));
  S *= (1.0 - onFace) * prm.supply;
  return vec4f(S, d50, sig, fines);
}
fn ldShapeAt(q: vec2f) -> vec2f { return vec2f(prm.round, prm.slab); }

fn heightAt(p: vec2f) -> f32 {
  let g = baseGround(p);
  return g + ldScatter(p);
}
fn matAt(p: vec2f, h: f32) -> vec4f {
  let t = talus(p);
  let onTalus = sstep(0.5, 3.0, t.x) * (1.0 - sstep(0.95, 1.05, t.y));
  if (ldOut.y > 0.0) { return vec4f(ldOut.y, onTalus, 0.0, ldOut.w); }
  return vec4f(0.0, 0.7 * onTalus, 0.0, 2.0 + ldOut.z);
}
fn albedoAt(p: vec2f, h: f32, n: vec3f, m: vec4f) -> vec3f {
  let slope = length(n.xy) / max(n.z, 1e-3);
  var g = lab.cGround.rgb;
  g = mix(g, lab.cGrass.rgb, sstep(0.15, 0.4, slope) * (1.0 - sstep(0.8, 1.2, slope)) * (1.0 - m.y));
  g = mix(g, lab.cRock.rgb, sstep(1.1, 1.9, slope) * (1.0 - m.y) * (1.0 - m.x));
  return ldAlbedo(p, h, n, m, g);
}
`,
};
