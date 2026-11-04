// Ground cover that follows the land: Turing-like patchiness and terracettes, as pure functions of position.
//   - Turing-like patches (Klausmeier 1999, Science 284: 1826; Rietkerk et al. 2002; von Hardenberg et al. 2001): water-
//     limited vegetation self-organises into spots (dry), labyrinths, then gaps (wet) on the flat, and into bands along
//     the contours on gentle slopes. Instead of simulating the reaction-diffusion (a window simulation that regional
//     replay could not cut), the pattern is drawn as a threshold of a band-pass field: one octave of gradient noise at
//     wavelength prm.vgLambda on the flat; on slopes a cosine whose phase is the height itself over prm.vgBandDh (so
//     the bands follow the contours exactly and close up where the slope steepens), with a phase noise for the
//     forks and ends; joined by the broad slope. The threshold comes from the site's moisture, which walks the
//     sequence spots - labyrinth - gaps as the reaction-diffusion models do. Gaps take bare soil or dry grass.
//   - Terracettes (grazing or creep steps on steep grass, 1-2 m apart, along the contours): the height phase again,
//     over prm.vgTerrDh, reshaped to a riser over 30% of the cycle and a level tread, with a phase noise so they braid;
//     the inner tread is the worn path (soil). Height, so the light draws them and they agree with any sun.
// Draws with vg-tufts' 1x structure through its vgPattern hook. Original code; the ideas are from the papers named.
import {VG_PARAMS, VG_TERRAIN, VG_FLOW, VG_PLACE} from './vg-common.js';
import {VG_MICRO} from './vg-tufts.js';

export default {
  title: 'Turing-like patches and terracettes along the contours',
  about: 'A thresholded band-pass field (labyrinths on the flat, contour bands on gentle slopes, phase from the height) by moisture, and terracettes on steep grass, over vg-tufts.',
  world: 'green',
  params: {...VG_PARAMS, vgMicro: 1, vgShrubCell: 14, vgShrubs: 1.0, vgFlowers: 0.5, vgHeight: 1.0,
           vgTuring: 0, vgLambda: 26, vgBandDh: 5.0, vgTerr: 0, vgTerrDh: 4.0},
  variants: [
    {label: 'base', note: 'vg-tufts as it is', params: {}},
    {label: 'turing', note: 'patches, Moisture 1', params: {vgTuring: 1}},
    {label: 'turing-dry', note: 'patches, Moisture 0.5', params: {vgTuring: 1, vgMoist: 0.5}},
    {label: 'terracettes', note: 'steps on steep grass', params: {vgTerr: 1}},
    {label: 'terr-2x', note: '2x zoom', params: {vgTerr: 1}, lab: {px: 0.5, ox: 20, oy: 150}},
    {label: 'both-sun135', note: 'patches and steps, the sun from the lower right', params: {vgTuring: 1, vgMoist: 0.5, vgTerr: 1}, lab: {az: 135}},
  ],
  sim: {iterations: 320, wgsl: VG_FLOW},
  wgsl: VG_TERRAIN + VG_PLACE + VG_MICRO + /* wgsl */`
fn heightAt(p: vec2f) -> f32 { return vgTerrain(p); }
fn vgApply(x: i32, y: i32) { vgApplyMicro(x, y); }
fn albedoAt(p: vec2f, h: f32, n: vec3f, m: vec4f) -> vec3f { return vgAlbedoMicro(p, n, m); }
// The vegetated classes only (no bare, dry or scrub), for a pixel the pattern says is vegetated.
fn vgVeg(c0: array<f32, 7>) -> array<f32, 7> {
  var c = c0; c[0] = 0.0; c[1] = 0.0; c[4] = 0.0;
  var t = 0.0; for (var k = 0; k < 7; k++) { t += c[k]; }
  if (t <= 1e-4) { c[2] = 1.0; return c; }
  for (var k = 0; k < 7; k++) { c[k] = c[k] / t; }
  return c;
}
fn vgPattern(p: vec2f, s: vec4f, cov: array<f32, 7>, k0: i32, h0: f32) -> vec2f {
  var k = k0;
  let S = s.x;
  let m = vgSiteAdj(s).x;
  if (prm.vgTuring > 0.5) {
    let wb = sstep(0.04, 0.12, S);
    let iso = gnoised(p / prm.vgLambda, 0xa11u).x / 0.45;
    let ph = h0 / prm.vgBandDh + 0.6 * fbm(p, 3.0 * prm.vgLambda, 2, 0.5, 0xa12u) / 0.45;
    let field = mix(iso, 1.3 * cos(TAU * ph), wb) + 0.3 * vgZPixel(p) / 1.7;
    let theta = (0.25 - m) * 2.5;
    if (S < 0.6) {
      if (field < theta) { k = select(0, 1, m > 0.12 || cov[1] > 0.6 * cov[0]); }
      else if (k == 0 || k == 1) { k = vgPick(vgVeg(cov), vgU(p)); }
    }
  }
  var dz = 0.0;
  if (prm.vgTerr > 0.5 && (k == 0 || k == 1 || k == 2)) {
    let w = sstep(0.3, 0.5, S) * (1.0 - sstep(1.6, 2.2, S));
    let ph = h0 / prm.vgTerrDh + 0.5 * fbm(p, 24.0, 2, 0.5, 0xa13u) / 0.45;
    let t = fract(ph);
    dz = w * prm.vgTerrDh * (sstep(0.0, 0.3, t) - t);
    let c = vec2i(floor(p));
    if (w > 0.3 && t > 0.55 && t < 0.85 && h01(c.x, c.y, 0x7e44u) < 0.75) { k = 0; }
  }
  return vec2f(f32(k), dz);
}
`,
};
