// Loose material: aeolian sand ripples as a pure function of position (bake-ready).
//   phase = (p . wind) / lambda + sinuosity + defects, profile asymmetric (gentle stoss, lee a third as long), height
//   lambda / index (impact ripples measure 15-20; 9 reads better at 1x through the palette). lambda grows linearly with the wind (Andreotti et al. 2006, Duran et
//   al. 2014: wavelength linear in shear velocity), so one control, wind, sets both.
//   Defects: dislocation dipoles on a jittered lattice. Each pair of cores (+1, -1) adds atan2(cross(a, b), dot(a, b)) / 2pi
//   to the phase (a, b the vectors to the two cores): the 2pi jump lies only on the segment between the cores, inside the
//   pair's window, so it is invisible modulo one cycle; outside it the field falls off like a dipole. Each core is a
//   Y-junction where a crest ends.
//   Coarse grains ride the crests (a darker tone); troughs are finer and lighter.
//   Obstacles: boulders from the ld scatter, each with a sand shadow downwind (a tapering tail ~6 radii long) and a
//   shallow scour upwind; ripples fade on the tail and over thin sand, where a gravel lag shows instead.
// Original code; the defect construction is ours, the physics from the ripple literature (see the report).
import {LD_SCATTER, LD_ALBEDO} from './ld-common.js';

export default {
  title: 'Loose material: sand ripples',
  about: 'Asymmetric ripples, wavelength from the wind, Y-junction defects from dislocation dipoles, coarse crests, sand shadows behind boulders.',
  world: 'desert',
  params: {mode: 1, wind: 1.3, windDeg: 20, defects: 1, boulders: 0, lag: 0, index: 9,
           ldRmax: 7, ldJitter: 0.85, ldHeight: 0.8, ldSuppress: 1, ldContact: 0.45},
  variants: [
    {label: 'today', note: 'the bake today: sin(p . wind / 7 px + wobble) x 1.4', params: {mode: 0}},
    {label: 'ripples', note: 'asymmetric, defects, coarse crests; wind 1.3 (lambda 6 px)'},
    {label: 'no-defects', note: 'the same without the dislocation pairs', params: {defects: 0}},
    {label: 'strong-wind', note: 'wind 2 (lambda 9 px)', params: {wind: 2.0}},
    {label: 'boulders', note: 'boulders with sand shadows; thin sand shows a gravel lag', params: {boulders: 1, lag: 1}},
    {label: 'ripples-2x', note: '2x', params: {boulders: 1, lag: 1}, lab: {px: 0.5, ox: 100, oy: 80}},
  ],
  wgsl: /* wgsl */`
${LD_SCATTER}
${LD_ALBEDO}
fn windDir() -> vec2f { let a = radians(prm.windDeg); return vec2f(cos(a), sin(a)); }
fn lambda() -> f32 { return 4.6 * prm.wind; }

// Sand depth 0..1 (thin sand lets the lag show) and the sand sheet's own broad relief.
fn sandDepth(p: vec2f) -> f32 {
  if (prm.lag <= 0.0) { return 1.0; }
  return sstep(-0.35, 0.15, fbm(p, 120.0, 3, 0.5, 0x61u));
}
fn sheet(p: vec2f) -> f32 { return 30.0 + 5.0 * fbm(p, 140.0, 3, 0.5, 0x62u); }

// The dislocation field (cycles), from dipoles on a lattice of 8 lambda.
fn defectPhase(p: vec2f, w: vec2f) -> f32 {
  if (prm.defects <= 0.0) { return 0.0; }
  let L = lambda();
  let cell = 8.0 * L;
  let b = vec2i(floor(p / cell));
  let perp = vec2f(-w.y, w.x);
  var ph = 0.0;
  for (var j = -1; j <= 1; j++) { for (var i = -1; i <= 1; i++) {
    let c = b + vec2i(i, j);
    let h = hash2u(c.x, c.y, 0x6d3fu);
    if (ldU(h) > 0.7) { continue; }
    let m = (vec2f(c) + 0.5 + (vec2f(ldU(pcg(h)), ldU(pcg(h ^ 1u))) - 0.5) * 0.8) * cell;
    let sep = L * (1.5 + 2.5 * ldU(pcg(h ^ 2u)));
    let dir = rot(perp, 0.5 * (ldU(pcg(h ^ 3u)) - 0.5));
    let c1 = m - 0.5 * sep * dir; let c2 = m + 0.5 * sep * dir;
    let a = p - c1; let bb = p - c2;
    let ang = atan2(a.x * bb.y - a.y * bb.x, dot(a, bb));
    let win = 1.0 - sstep(0.55 * sep, 0.55 * sep + 3.0 * L, distance(p, m));
    ph += select(1.0, -1.0, ldU(pcg(h ^ 4u)) < 0.5) * win * ang / TAU;
  } }
  return ph;
}

// Boulders (the ld scatter's two top classes) and their sand shadows: (tail height, scour, ripple fade).
fn shadows(p: vec2f, w: vec2f) -> vec3f {
  if (prm.boulders <= 0.0) { return vec3f(0.0); }
  var tail = 0.0; var scour = 0.0; var fade = 0.0;
  let perp = vec2f(-w.y, w.x);
  let R = ldR(0);
  let cell = 3.2 * R;
  // A tail reaches 8.5 R downwind of its stone and a scour 6.5 R upwind: 5 x 5 cells round p - 1.5 R w cover both.
  let b = vec2i(floor((p - w * 1.5 * R) / cell));
  for (var j = -2; j <= 2; j++) { for (var i = -2; i <= 2; i++) {
    let st = ldCand0(0, b + vec2i(i, j));
    if (!st.ok) { continue; }
    let d = p - st.c;
    let u = dot(d, w); let v = dot(d, perp);
    let L = 6.0 * st.r;
    if (u > -st.r && u < L) {
      let t = max(u, 0.0) / L;
      let half = st.r * 0.95 * (1.0 - t * 0.85);
      let x = v / half;
      let hgt = 0.55 * st.r * prm.ldHeight * (1.0 - t) * sqrt(sstep(0.0, 0.25, t)) * exp(-x * x);
      tail = max(tail, hgt);
      fade = max(fade, (1.0 - t) * sstep(-st.r, 0.0, u) * exp(-0.5 * x * x));
    }
    let us = (u + 1.3 * st.r) / (1.1 * st.r); let vs = v / (1.6 * st.r);
    scour = max(scour, exp(-(us * us + vs * vs)) * 0.25 * st.r);
    fade = max(fade, exp(-(us * us + vs * vs)));
  } }
  return vec3f(tail, scour, fade);
}

fn ldMask(q: vec2f) -> LdMask {
  var m: LdMask;
  let d = sandDepth(q);
  // Sparse boulders standing out of the sand; a gravel lag where the sand is thin (deflation).
  m.a = vec4f(0.85 * (1.0 - d) * prm.lag, 2.2, 0.5, 0.7);
  m.b = vec4f(0.06 * prm.boulders, 11.0, 0.35, 0.0);
  return m;
}
fn ldShapeAt(q: vec2f) -> vec2f { return vec2f(0.55, 0.0); }

var<private> gCrest: f32;
var<private> gSandC: f32;
fn heightAt(p: vec2f) -> f32 {
  let w = windDir();
  var h = sheet(p);
  gCrest = 0.0; gSandC = 1.0;
  if (prm.mode < 0.5) {
    let wobble = vnoise(p / 30.0 + 2.0, 0x63u) * 2.0;
    return h + sin(dot(p, w) * TAU / 7.0 + wobble) * 1.4;
  }
  let L = lambda();
  let sd = sandDepth(p);
  let sh = shadows(p, w);
  // Phase: along the wind, crest sinuosity from noise over ~6 lambda, a slow turn of the crests over ~200 px, defects.
  let perp = vec2f(-w.y, w.x);
  let turn = 0.12 * vnoise(p / 220.0, 0x64u);
  let ph = dot(p, rot(w, turn)) / L + 0.35 * vnoise(p / (5.0 * L), 0x65u) + 0.15 * vnoise(p / (2.3 * L), 0x66u) + defectPhase(p, w);
  let u = fract(ph);
  let a = 0.3;                                         // lee share of the wavelength
  let prof = select(0.5 + 0.5 * cos(PI * (u - (1.0 - a)) / a), 0.5 - 0.5 * cos(PI * u / (1.0 - a)), u < 1.0 - a);
  let band = 1.0 - sstep(0.25, 0.5, labPx() / L);      // fade when lambda nears 2 output px
  let amp = (L / prm.index) * band * sstep(0.2, 0.6, sd) * (1.0 - 0.9 * sh.z);
  h += amp * (prof - 0.5) * 2.0;
  gCrest = sstep(0.55, 0.9, prof) * band * sstep(0.2, 0.6, sd) * (1.0 - sh.z);
  gSandC = sd;
  h += sh.x - sh.y;
  return h + ldScatter(p);
}
fn matAt(p: vec2f, h: f32) -> vec4f {
  if (ldOut.y > 0.0) { return vec4f(ldOut.y, 0.0, 0.0, ldOut.w); }
  // Sand where it is deep; m.y carries the crest's coarse grains (darker) through the free channel.
  return vec4f(-gCrest, 0.0, gSandC, 2.0 + ldOut.z);
}
fn albedoAt(p: vec2f, h: f32, n: vec3f, m: vec4f) -> vec3f {
  let crest = max(-m.x, 0.0);
  let mm = vec4f(max(m.x, 0.0), m.y, m.z, m.w);
  var c = ldAlbedo(p, h, n, mm, lab.cGround.rgb);
  if (mm.x <= 0.0) { c *= 1.0 - 0.12 * crest; }
  return c;
}
`,
};
