// lf-age: the scarp-retreat sequence from one number. The same plateau stroke and kind of column as lf-joints, read
// sideways: caprock scarps wear back, not down (parallel retreat), so E is a retreat distance in px. The stroke's own
// inside distance dIn (the engine has it for every stroke: reach minus the capsule distance) says how far a point lies
// behind the original edge; the top cap's front sits rho = E * (1 + noise) + joints behind it. Each hard band of the
// column (found by walking the column down from the stroke's top) is a tier whose front retreats a share tierShare of
// the one above. A tier's profile: its top inside the front, a cliff (its own thickness) at the front, then a talus
// slope; the surface is the highest tier profile, never above the stroke or below the plain. As E grows: a plateau with
// a crisp rim notched by canyon heads, promontories between canyons, buttes cut off where canyon heads meet, then bare
// plain with low tiers. Pure function of
// position, no neighbourhood. Original code; the profile is the textbook caprock scarp (cliff over talus, King 1953),
// the column and joints are lf-lib's.
//
// The 'downwear' panel is lf-lib's vertical column walk on the same scene, for comparison: it cannot make the talus
// slope under a cap stand steep, because there a slope is the budget's gradient over the soft rock's resistance.
import {LF_PARAMS, LF_WGSL, LF_PLATEAU, LF_PLATEAU_PARAMS} from './lf-lib.js';

export default {
  title: 'Plateau, mesa, butte, spire: one budget',
  about: 'Parallel scarp retreat of the column\'s hard bands behind the plateau stroke\'s edge; only E (retreat, px) changes between panels.',
  world: 'desert',
  lab: {exposure: 0.85},
  colours: {rock: [175, 111, 90], sand: [204, 178, 140], loose: [170, 118, 92]},
  params: {...LF_PARAMS, relief: 90, thick: 4, cyc: 15, hardN: 3, zOrg: -16, vary: 0.3, hier: 0.3, K: 12, capSharp: 10,
    ...LF_PLATEAU_PARAMS, amount: 102, edgeK: 0, retreatW: 30, edgeNoise: 0,
    jSets: 2, jSp: 40, jW: 3, jWeak: 1, jAng: 35, jCross: 82, jRound: 0.6, blockVar: 0.4,
    rNoise: 0.4, rWave: 70, rFine: 3, jRet: 22, canyonA: 0.6, canyonW: 80, tierShare: 0.45, talus: 1.1, cliffW: 2.5, mode: 1},
  variants: [
    {label: 'swept', note: 'the stroke', params: {E: 0}},
    {label: 'mesa', note: 'E 45: rim notched by canyon heads', params: {E: 45}},
    {label: 'dissected', note: 'E 80: promontories', params: {E: 80}},
    {label: 'buttes', note: 'E 110: cut-off buttes', params: {E: 110}},
    {label: 'downwear', note: 'lf-lib vertical walk, E 100', params: {E: 100, mode: 0, jSets: 0, jRound: 0, edgeK: 2, edgeNoise: 0.7, noiseA: 0.15, vary: 0, hier: 0}},
    {label: 'buttes-2x', note: '2x zoom', params: {E: 110}, lab: {px: 0.5, ox: 200, oy: 110}},
  ],
  wgsl: /* wgsl */`
// The hard bands of the column below the stroke's nominal top at p: up to three (top, bottom, mean hardness).
struct Tiers { n: i32, top: array<f32, 3>, bot: array<f32, 3>, hard: array<f32, 3> };
fn tiersAt(p: vec2f) -> Tiers {
  var t: Tiers; t.n = 0;
  let z0 = prm.base + prm.amount + 2.0;
  var k = floor(lfCoord(p, z0));
  var inBand = false; var hs = 0.0; var nb = 0.0;
  for (var i = 0; i < 48; i++) {
    let zTop = prm.zOrg + (k + 1.0) * prm.thick; let zBot = zTop - prm.thick;   // flat beds (dip 0) in this experiment
    if (zTop < prm.base) { break; }
    let h = lfHard(k);
    if (h >= 0.3) {
      if (!inBand) { inBand = true; t.top[t.n] = min(zTop, z0); hs = 0.0; nb = 0.0; }
      hs += h; nb += 1.0; t.bot[t.n] = max(zBot, prm.base);
    } else if (inBand) {
      inBand = false; t.hard[t.n] = hs / nb; t.n += 1;
      if (t.n == 3) { break; }
    }
    k -= 1.0;
  }
  if (inBand && t.n < 3) { t.hard[t.n] = hs / max(nb, 1.0); t.n += 1; }
  return t;
}
// The top cap's smooth front at p: E behind the edge, wandering broadly and finely, and running ahead up canyons: grooves
// of the stripe pattern (lib stripes()) laid along the outline's normal, so they head inward from the edge. Where two
// canyons' heads meet behind a promontory, the promontory is cut off: a butte.
fn frontAt(p: vec2f) -> f32 {
  let e = 2.0;
  let g = vec2f(plateauD(p + vec2f(e, 0.0), false) - plateauD(p - vec2f(e, 0.0), false),
                plateauD(p + vec2f(0.0, e), false) - plateauD(p - vec2f(0.0, e), false));
  let nrm = normalize(g + vec2f(1e-5, 0.0));
  // |sin| cubed: narrow canyons between broad interfluves (|sin| alone gives broad grooves and knife-edged spurs).
  let c1 = pow(abs(stripes(p, nrm, 1.0 / prm.canyonW, 0xca7u).y), 3.0);
  let c2 = pow(abs(stripes(p, nrm, 2.3 / prm.canyonW, 0xca8u).y), 3.0);
  // Canyons differ in length round the rim: some heads run far in, some barely notch the edge.
  let len = 0.35 + 0.65 * sstep(-0.4, 0.5, vnoise(p / 85.0, 0xca9u));
  let canyon = len * (0.85 * (2.0 * c1 - 1.0) + 0.15 * (2.0 * c2 - 1.0));
  return prm.E * (1.0 + prm.rNoise * fbm(p, prm.rWave, 3, 0.5, 0x6d1u) + prm.canyonA * canyon) + prm.rFine * fbm(p, 36.0, 2, 0.5, 0x6d2u);
}
fn retreatHeight(p: vec2f) -> f32 {
  let h0 = baseHeight(p);
  let dIn = -plateauD(p, true);
  let rhoS = frontAt(p);
  // The front wanders, so "how far past it" is (rho - dIn) over its gradient's length (a displaced distance field
  // stays a distance only when divided by its Lipschitz bound): talus slopes then stand at talus in every direction,
  // across canyon walls as well as down the old edge's normal.
  let e = 1.5;
  let gr = vec2f(frontAt(p + vec2f(e, 0.0)) - frontAt(p - vec2f(e, 0.0)), frontAt(p + vec2f(0.0, e)) - frontAt(p - vec2f(0.0, e))) / (2.0 * e);
  let gd = vec2f(plateauD(p + vec2f(e, 0.0), true) - plateauD(p - vec2f(e, 0.0), true), plateauD(p + vec2f(0.0, e), true) - plateauD(p - vec2f(0.0, e), true)) / (2.0 * e);
  // Joints let the front run ahead along them: they decide where a cap still stands (slots, angular rims, rounded
  // blocks) but not the talus below, which follows the smooth front.
  let rhoJ = rhoS + prm.jRet * lfJoint(p) * lfBlock(p);
  let tr = tiersAt(p);
  var z = prm.base;
  var share = 1.0;
  for (var i = 0; i < 3; i++) {
    if (i >= tr.n) { break; }
    // A harder band retreats less than a softer one, and every band below retreats a share of the one above.
    let hk = (1.0 + prm.K * 0.8) / (1.0 + prm.K * tr.hard[i]) * share;
    let lip = max(length(gr * hk + gd), 0.5);
    let dS = (rhoS * hk - dIn) / lip;                          // px out past this tier's smooth front
    let dJ = (rhoJ * hk - dIn) / lip;                          // the same with the joints
    let cliff = (tr.top[i] - tr.bot[i]) * sstep(0.0, prm.cliffW, dJ);
    let prof = tr.top[i] - cliff - prm.talus * max(dS - prm.cliffW, 0.0);
    z = max(z, prof);
    share *= prm.tierShare;
  }
  // Above the top cap the soft overburden is gone wherever the cap is; never above the stroke.
  return min(h0, z);
}
fn heightAt(p: vec2f) -> f32 {
  if (prm.E <= 0.0) { return baseHeight(p); }
  if (prm.mode < 0.5) { return lfHeight(p); }
  return retreatHeight(p);
}
fn albedoAt(p: vec2f, h: f32, n: vec3f, m: vec4f) -> vec3f { return lfAlbedo(p, h, n); }
` + LF_PLATEAU + LF_WGSL,
};
