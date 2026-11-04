// ws-surface: how open water reads at 1x in the palette. One lake (a shelf, a deep basin, an island, a sand bank, weed
// beds and boulders on the bed) under ws-lib's water model, from still and clear to windy and murky.
//   - Depth colour: Beer-Lambert per channel, so the shelf goes sand -> green-teal -> slate blue as red, then green,
//     then blue are absorbed; the bed's own marks (weed, boulders, ripples) fade with depth at the same rate.
//   - Caustics on the shelf, displaced by the waves.
//   - Surface: wind waves with crests across the wind, slicks along it, Schlick sky reflection, per-pixel glint.
//   - Murk: a shorter column and an olive-brown body; the bed vanishes within a few units.
// The water is a pure function of position, depth and the three looks (Clarity/Murk, Wind, Glint); glint is a hashed
// facet per art pixel, so it is deterministic and does not crawl when a region is replayed.
import {WS_WATER, WS_WATER_PARAMS} from './ws-lib.js';

const SURF = /* wgsl */`
fn heightAt(p: vec2f) -> f32 {
  let sea = seaLevel();
  let t = (p.x * 0.8 + p.y - 260.0 + 40.0 * vnoise(p / 90.0, 0x11u)) / 420.0;
  var h = sea + 10.0 - 46.0 * sstep(0.0, 1.0, t) - 6.0 * sstep(-0.1, 0.15, t);
  let isl = length((p - vec2f(250.0, 250.0)) * vec2f(1.0, 1.4));
  h = max(h, sea + 9.0 - 0.32 * isl + 4.0 * vnoise(p / 20.0, 0x12u));
  h += 6.0 * exp(-pow(length(p - vec2f(470.0, 150.0)) / 50.0, 2.0)) * (0.8 + 0.2 * vnoise(p / 8.0, 0x13u));   // a sand bank
  h += 0.5 * sin(dot(p, vec2f(0.6, 0.8)) * TAU / 6.0 + 2.0 * vnoise(p / 17.0, 0x14u));   // bed ripples
  let v = voronoi(p, 26.0, 0.9, 0x15u);
  let boulder = select(0.0, 1.0, h01(v.id1.x, v.id1.y, 0x16u) < 0.12);
  h += boulder * 3.0 * sqrt(max(0.0, 1.0 - pow(v.f1 / 6.0, 2.0)));
  return h;
}
fn matAt(p: vec2f, h: f32) -> vec4f {
  let weed = sstep(0.15, 0.35, fbm(p, 40.0, 3, 0.55, 0x17u));
  let v = voronoi(p, 26.0, 0.9, 0x15u);
  let boulder = select(0.0, 1.0, h01(v.id1.x, v.id1.y, 0x16u) < 0.12) * (1.0 - sstep(5.0, 6.0, v.f1));
  return vec4f(boulder, 0.0, 1.0 - weed, weed);
}
fn bedAlbedo(p: vec2f, m: vec4f) -> vec3f {
  let grit = 0.07 * hs(i32(floor(p.x)), i32(floor(p.y)), 0x51edu) + 0.05 * vnoise(p / 5.0, 0x77u);
  var c = lab.cSand.rgb * 0.82;
  c = mix(c, vec3f(0.16, 0.22, 0.10), m.w);
  c = mix(c, lab.cRock.rgb * 0.9, m.x);
  return c * (1.0 + grit);
}
fn albedoAt(p: vec2f, h: f32, n: vec3f, m: vec4f) -> vec3f {
  let shore = 1.0 - sstep(seaLevel() + 1.5, seaLevel() + 4.0, h + 1.5 * vnoise(p / 6.0, 0x18u));
  return mix(albedoDefault(p, h, n, vec4f(m.x, 0.0, 0.0, 0.0)), bedAlbedo(p, m) * vec3f(0.85, 0.82, 0.78), shore);
}
fn lightAt(p: vec2f, h: f32, n: vec3f, m: vec4f, x: i32, y: i32) -> vec3f {
  let sea = seaLevel();
  if (prm.today > 0.5 || h >= sea) { return lightDefault(p, h, n, m, x, y); }
  let w = wsWater(p, sea - h, bedAlbedo(p, m), n, sunShadow(p, h, lab.sun.xyz), prm.clarity, prm.murk, prm.wind, prm.glint, prm.caustic, prm.windAng);
  return w.rgb;
}
`;

export default {
  title: 'Water at 1x',
  about: 'One lake under the shared water model: depth colour by absorption, caustics, waves, slicks, glint, murk.',
  world: 'green',
  colours: {water: [20, 52, 80], sand: [196, 180, 140], sky: [160, 182, 205]},
  lab: {sea: 40},
  params: {...WS_WATER_PARAMS, today: 0, murk: 0, wind: 0.45, caustic: 0.7},
  variants: [
    {label: 'today', note: 'built-in water, retail colours', params: {today: 1}, colours: {water: [38, 76, 225]}},
    {label: 'still', note: 'absorption only: no waves, glint or caustics', params: {wind: 0, glint: 0, caustic: 0}},
    {label: 'clear', note: 'Wind 0.45, caustics, glint', params: {}},
    {label: 'windy', note: 'Wind 1: slicks and more glint', params: {wind: 1}},
    {label: 'murky', note: 'Murk 0.75', params: {murk: 0.75}},
    {label: 'low-sun', note: 'clear, sun 20 degrees from the west-southwest', params: {}, lab: {el: 20, az: 250}},
  ],
  wgsl: WS_WATER + SURF,
};
