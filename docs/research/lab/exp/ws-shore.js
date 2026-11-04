// ws-shore: shores drawn from one cross-shore coordinate, with three artist numbers: Surf, Rock and Murk.
//
// x is the signed distance to the coastline (onshore +), s the distance along it. Here a wavy line gives them; in the
// engine they are H10's coast distance field (coastSd, jump flooding) and its along-shore phase. Every mark is a pure
// function of (x, s, p), so the shore replays by region with an apron the size of the widest band (about 80 px).
//
// Heights (shape before colour):
//   - Beach: Dean's equilibrium shoreface offshore, depth = A d^(2/3) (Dean 1977), with a longshore bar whose crest
//     sits farther out as the surf rises; a linear beach face up to a berm, a shallow runnel, then dunes. Surf sets the
//     berm height, the face slope (a reflective steep face at low surf, a dissipative flat one at high) and the bar.
//     Beach cusps: horns every 26 px push the swash zone seaward (the rhythmic shoreline of real beaches).
//   - Rock: a hardness field. Soft rock retreats (x moves landward, so soft ground becomes bays), hard rock stands as
//     headlands. Each rock coast is a cliff with a wave-cut platform awash at its foot, wider in softer rock (Sunamura
//     1992: platform width grows with erodibility), with exposed knobs and a drop-off at its edge; a dark notch at the
//     cliff foot.
// Colour (on the shared ws-lib water model):
//   - Wet sand up to the last uprush (cusped), thin wrack lines at the old high-water marks, a dry berm, dune grass with
//     a ragged edge.
//   - Foam, static at the pixel: a lace at the waterline, a 1 px swash front on the wet sand, a broken breaker line on
//     the bar crest, and sparse foam streaks drifting between bar and shore. All scale with Surf.
//   - The bed: wet sand with ripple marks parallel to the shore, rock with an algal tint on platforms, mud in lakes.
//   - A lake is the same coast with Surf 0 and Murk high: no bar, no foam, a mud margin, and reeds in the shallows.
// Own code from the published ideas.
import {WS_WATER, WS_WATER_PARAMS} from './ws-lib.js';

const MODERN = {water: [24, 54, 70], sand: [196, 180, 140], sky: [160, 182, 205]};

export const WS_SHORE = /* wgsl */`
const SH_C = vec2f(330.0, 236.0);
fn shBay(s: f32) -> f32 { return 52.0 * sin(s / 130.0 + 0.9) + 20.0 * vnoise(vec2f(s / 64.0, 3.1), 0x41u); }
fn shJag(p: vec2f) -> f32 { return 3.0 * vnoise(p / 7.0, 0x31u) + 1.5 * vnoise(p / 3.0, 0x32u); }
// (x: signed cross-shore distance, onshore +; s: along-shore; hardness 0..1)
fn shCoast(p: vec2f) -> vec3f {
  let nrm = normalize(vec2f(-0.45, -1.0)); let tng = vec2f(-nrm.y, nrm.x);
  let q = p - SH_C; let s = dot(q, tng);
  let b = shBay(s); let db = shBay(s + 1.0) - b;
  var x = (dot(q, nrm) + b) / sqrt(1.0 + db * db);
  let hn = 0.5 + 0.6 * fbm(p, 170.0, 3, 0.5, 0x2b1u);
  let hard = sstep(1.0 - prm.rock - 0.06, 1.0 - prm.rock + 0.06, hn) * sstep(0.0, 0.05, prm.rock);
  x -= 36.0 * prm.rock * (1.0 - hard);
  return vec3f(x, s, hard);
}
// The surf's beach geometry: (berm height, face slope, berm distance, bar distance).
fn shGeom() -> vec4f {
  let e = prm.surf;
  let bermH = 1.5 + 3.0 * e; let face = mix(0.30, 0.12, e);
  return vec4f(bermH, face, bermH / face, 24.0 + 30.0 * e);
}
fn shCusp(x: f32, s: f32) -> f32 {
  let g = shGeom();
  return 3.5 * prm.surf * (0.5 - 0.5 * cos(TAU * s / 26.0)) * (1.0 - sstep(g.z * 0.7, g.z * 1.1, x));
}
fn shBeach(p: vec2f, x: f32, s: f32) -> f32 {
  let e = prm.surf; let g = shGeom();
  let xc = x + shCusp(x, s);
  if (xc < 0.0) {
    let d = -xc;
    let bar = 3.0 * e * exp(-pow((d - g.w) / 9.0, 2.0)) * (0.75 + 0.25 * vnoise(vec2f(s / 50.0, 1.0), 0x7au));
    return min(-mix(mix(1.5, 0.75, e), 0.35, prm.murk) * pow(d, 0.6667) + bar, -0.35);
  }
  var b = g.y * min(xc, g.z);
  b -= 0.35 * g.x * sstep(g.z, g.z + 8.0, xc) * (1.0 - sstep(g.z + 10.0, g.z + 22.0, xc));
  let duneX = g.z + 16.0;
  b += (2.0 + 6.0 * e) * sstep(duneX, duneX + 34.0, xc) * (0.55 + 0.45 * vnoise(p / 30.0, 0x9du)) * (1.0 - sstep(duneX + 40.0, duneX + 90.0, xc));
  return b + 12.0 * sstep(duneX + 30.0, duneX + 110.0, xc);
}
fn shRock(p: vec2f, x: f32, hard: f32) -> f32 {
  let xr = x + shJag(p);
  if (xr < 0.0) {
    let d = -xr;
    let plat = mix(30.0, 8.0, hard);
    let top = -0.8 + 1.0 * vnoise(p / 5.0, 0x33u) + 0.5 * vnoise(p / 2.5, 0x34u) - 0.015 * d;
    return top - 2.0 * sstep(plat - 3.0, plat + 2.0, d) - 1.5 * pow(max(d - plat, 0.0), 0.75);
  }
  return 12.0 * sstep(0.0, 8.0, xr);
}
fn heightAt(p: vec2f) -> f32 {
  let c = shCoast(p); let x = c.x;
  let sea = seaLevel();
  let inland = sstep(40.0, 130.0, x) * (0.05 * (x - 40.0) + 5.0 * fbm(p, 80.0, 3, 0.5, 0x77u));
  if (prm.today > 0.5) {
    return sea + inland + select(-1.1 * pow(max(-x, 0.0), 0.6667) - 0.3, 0.1 * x, x > 0.0);
  }
  var b = shBeach(p, x, c.y);
  if (prm.rock > 0.0) { b = mix(b, shRock(p, x, c.z), c.z); }
  return sea + b + inland;
}
fn matAt(p: vec2f, h: f32) -> vec4f { let c = shCoast(p); return vec4f(c.z, c.x, c.y, 0.0); }
fn shGrit(p: vec2f) -> f32 { return 0.07 * hs(i32(floor(p.x)), i32(floor(p.y)), 0x51edu) + 0.05 * vnoise(p / 5.0, 0x77u); }
fn shMud() -> vec3f { return vec3f(0.29, 0.26, 0.17); }
fn albedoAt(p: vec2f, h: f32, n: vec3f, m: vec4f) -> vec3f {
  if (prm.today > 0.5) { return albedoDefault(p, h, n, vec4f(0.0)); }
  let hard = m.x; let x = m.y; let s = m.z; let g = shGeom();
  let grit = shGrit(p);
  let xc = x + shCusp(x, s);
  var sand = lab.cSand.rgb * (1.0 + grit);
  // Wet sand up to the last uprush.
  let wetX = (0.5 + 0.25 * vnoise(vec2f(s / 30.0, 0.0), 0x3du)) * g.z * sstep(0.02, 0.2, prm.surf) + 1.0;
  sand = mix(sand, sand * vec3f(0.68, 0.62, 0.52), 1.0 - sstep(wetX - 1.5, wetX + 1.0, xc));
  // Wrack lines at old high-water marks: broken dark specks, 1 px.
  for (var k = 0; k < 1; k++) {
    let xl = g.z * (0.78 + 0.22 * f32(k)) + 2.5 * vnoise(vec2f(s / 40.0, f32(k) * 5.0), 0x3eu);
    let line = 1.0 - sstep(0.35, 1.0, abs(xc - xl));
    let speck = select(0.0, 1.0, h01(i32(floor(p.x)), i32(floor(p.y)), 0x3fu + u32(k)) < 0.65);
    sand = mix(sand, vec3f(0.33, 0.30, 0.20), line * speck * 0.6 * prm.surf * sstep(-0.2, 0.2, vnoise(vec2f(s / 25.0, 7.0), 0x40u)));
  }
  // Dune grass with a ragged edge.
  let veg = sstep(-0.1, 0.15, (xc - (g.z + 20.0)) / 30.0 + 0.4 * fbm(p, 24.0, 3, 0.55, 0x5au));
  var c = mix(sand, lab.cGrass.rgb * (1.0 + grit), veg);
  // Lake margin: mud a few px wide, then grass straight away.
  let mud = (1.0 - sstep(4.0, 9.0, x + 3.0 * vnoise(p / 9.0, 0x61u))) * prm.reeds;
  c = mix(c, mix(lab.cGrass.rgb, shMud(), mud) * (1.0 + grit), prm.reeds * max(mud, 1.0 - veg));
  // Rock: the cliff, a wet dark platform, the notch.
  if (hard > 0.01) {
    var rk = lab.cRock.rgb * (1.0 + 1.6 * grit);
    let xr = x + shJag(p);
    let platform = 1.0 - sstep(-0.5, 0.5, xr);
    rk = mix(rk, rk * vec3f(0.62, 0.68, 0.55), platform);
    rk *= 1.0 - 0.55 * (1.0 - sstep(0.6, 2.0, xr)) * sstep(-0.5, 0.2, xr);
    let top = sstep(8.0, 12.0, xr + 3.0 * vnoise(p / 6.0, 0x62u));
    rk = mix(rk, lab.cGrass.rgb * (1.0 + grit), top);
    c = mix(c, rk, hard);
  }
  return c;
}
fn shFoamC(p: vec2f, h: f32) -> vec3f { return srgbToLin(vec3f(0.90, 0.93, 0.91)) * wsFlatLight(p, h); }
fn shPix(p: vec2f, s: u32) -> f32 { let c = vec2i(floor(p / max(labPx(), 1.0))); return h01(c.x, c.y, s); }
// Reeds: clumps of 1 x 2 px stalks, dark olive with lighter tips; the water under a clump is shaded.
fn shReeds(col: vec3f, p: vec2f, h: f32, zone: f32) -> vec3f {
  if (prm.reeds <= 0.0 || zone <= 0.0) { return col; }
  let clump = sstep(-0.05, 0.15, fbm(p, 16.0, 3, 0.55, 0x8au) + 0.6 * zone - 0.38);
  if (clump <= 0.0) { return col; }
  let stalk = vec2i(i32(floor(p.x / max(labPx(), 1.0))), i32(floor(p.y / (2.0 * max(labPx(), 1.0)))));
  let r = h01(stalk.x, stalk.y, 0x8bu);
  let light = wsFlatLight(p, h);
  var reed = col * 0.55;
  if (r < 0.55) { reed = srgbToLin(vec3f(0.22, 0.27, 0.10)) * light; }
  else if (r < 0.72) { reed = srgbToLin(vec3f(0.42, 0.46, 0.25)) * light; }
  return mix(col, reed, clump * prm.reeds);
}
fn lightAt(p: vec2f, h: f32, n: vec3f, m: vec4f, x: i32, y: i32) -> vec3f {
  let sea = seaLevel();
  if (prm.today > 0.5) { return lightDefault(p, h, n, m, x, y); }
  let hard = m.x; let xs = m.y; let s = m.z; let e = prm.surf; let g = shGeom();
  let xc = xs + shCusp(xs, s);
  if (h >= sea) {
    var col = lightDefault(p, h, n, m, x, y);
    // The swash front: a 1 px broken foam line on the wet sand.
    let xf = 1.5 + 0.3 * g.z * (0.5 + 0.5 * vnoise(vec2f(s / 22.0, 2.0), 0x44u));
    let front = (1.0 - sstep(0.3, 1.0, abs(xc - xf))) * select(0.0, 1.0, shPix(p, 0x45u) < 0.7) * sstep(0.1, 0.4, e) * sstep(-0.1, 0.25, gnoised(vec2f(s / 30.0, 9.0), 0x43u).x) * (1.0 - hard);
    col = mix(col, shFoamC(p, h), front * 0.85);
    return shReeds(col, p, h, 1.0 - sstep(3.0, 8.0, xs));
  }
  let depth = sea - h;
  let grit = shGrit(p);
  // The bed.
  var bed = lab.cSand.rgb * 0.8 * (1.0 + grit);
  let rip = 0.5 + 0.5 * sin(TAU * (xs + 1.8 * vnoise(p / 14.0, 0x12u)) / 5.0);
  bed *= 1.0 - 0.08 * rip * sstep(0.5, 3.0, depth) * sstep(-0.1, 0.4, vnoise(p / 23.0, 0x13u));
  bed = mix(bed, lab.cRock.rgb * vec3f(0.75, 0.85, 0.68) * (1.0 + 1.6 * grit), hard);
  bed = mix(bed, shMud() * (1.0 + grit), prm.reeds);
  let w = wsWater(p, depth, bed, n, sunShadow(p, h, lab.sun.xyz), prm.clarity, prm.murk, prm.wind, prm.glint, prm.caustic, prm.windAng);
  var col = w.rgb;
  // Foam.
  let slopeU = length(n.xy) / max(n.z, 1e-3) / lab.org.w;
  let dEdge = depth / max(slopeU, 0.12);
  let lace = (1.0 - sstep(0.6, 2.0, dEdge + 1.3 * vnoise(p / 3.0, 0x46u))) * select(0.0, 1.0, shPix(p, 0x47u) < 0.75);
  var foam = lace * sstep(0.1, 0.5, e);
  let dd = -xc - g.w + 1.0 * vnoise(p / 6.0, 0x48u);
  let breaking = sstep(-0.15, 0.2, gnoised(vec2f(s / 40.0, 0.5), 0x49u).x + e - 0.55);
  let crest = (1.0 - sstep(0.5, 1.8, abs(dd))) * breaking * select(0.0, 1.0, shPix(p, 0x4au) < 0.85);
  let spray = (1.0 - sstep(1.5, 4.0, dd)) * sstep(0.0, 1.5, dd) * breaking * select(0.0, 1.0, shPix(p, 0x4bu) < 0.18);
  foam = max(foam, (crest + spray) * e * (1.0 - hard));
  let fs = gnoised(vec2f(s / 34.0, xc / 6.0), 0x4cu).x;
  let streak = sstep(0.5, 0.7, fs) * sstep(-g.w + 2.0, -g.w + 10.0, xc) * (1.0 - sstep(-6.0, -2.0, xc));
  foam = max(foam, streak * e * select(0.0, 1.0, shPix(p, 0x4du) < 0.45) * (1.0 - hard));
  // Rock coasts: foam where the platform is awash and around knobs.
  let awash = (1.0 - sstep(0.15, 0.7, depth)) * hard * select(0.0, 1.0, shPix(p, 0x4eu) < 0.6);
  foam = max(foam, awash * sstep(0.1, 0.5, e));
  col = mix(col, shFoamC(p, sea), clamp(foam, 0.0, 1.0) * (1.0 - w.w));
  return shReeds(col, p, h, 1.0 - sstep(2.5, 5.0, depth));
}
`;

export default {
  title: 'Shores',
  about: 'One cross-shore coordinate drives beach, rock and lake shores; Surf, Rock and Murk; foam static at the pixel.',
  world: 'green',
  colours: MODERN,
  lab: {w: 640, h: 448, sea: 40},
  params: {...WS_WATER_PARAMS, windAng: -1.99, today: 0, surf: 0.6, rock: 0, murk: 0.15, reeds: 0},
  variants: [
    {label: 'today', note: 'plain coast, built-in water, retail colours', params: {today: 1}, colours: {water: [38, 76, 225]}},
    {label: 'beach', note: 'Surf 0.6: bar, breaker, cusps, wet sand, wrack', params: {}},
    {label: 'headlands', note: 'Rock 0.5: cliffs and platforms in hard rock, pocket beaches in soft', params: {rock: 0.5}},
    {label: 'lake', note: 'Surf 0, Murk 0.7: mud margin, reeds', params: {surf: 0, murk: 0.7, reeds: 1, wind: 0.25, caustic: 0}},
    {label: 'beach-2x', note: 'the surf zone at 2x', params: {}, lab: {px: 0.5, ox: 300, oy: 230}},
  ],
  wgsl: WS_WATER + WS_SHORE,
};
