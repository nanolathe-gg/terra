// Vegetation placement by ecosystem rules (vg-common.js): where turf, meadow, scrub, moss, wet rush, dry grass and bare
// soil go, from the data maps the engine's Time pass already writes (flow and wetness, slope, ridge) plus the sun.
// Each class has a viability window in (moisture, soil depth, light) (Cordonnier et al. 2017; Gain et al. 2017,
// EcoBrush); covers are viabilities squared times a competitive strength, normalised, and a pixel draws its class from
// the covers with a spatially coherent uniform (Patchiness). 'today' is the lab's default: grass by slope, rock where steep.
// Flat colours only: the 1x micro-structure is vg-tufts. Original code.
import {VG_PARAMS, VG_TERRAIN, VG_FLOW, VG_PLACE} from './vg-common.js';

export default {
  title: 'Vegetation placement by ecosystem rules',
  about: 'Seven ground-cover classes placed by moisture (wetness index from MFD flow), soil depth (slope, convexity), light (insolation from the sun), with competition and a coherent class draw.',
  world: 'green',
  params: {...VG_PARAMS, vgMode: 1, vgShow: 0},
  variants: [
    {label: 'today', note: 'grass by slope (lab default)', params: {vgMode: 0}},
    {label: 'ecosystem', note: 'Moisture 1, Lushness 1, Patchiness 0.8', params: {}},
    {label: 'classes', note: 'bare, dry, turf, meadow, scrub, moss, wet', params: {vgShow: 1}, lab: {pal: 0}},
    {label: 'site', note: 'red light, green soil, blue moisture', params: {vgShow: 2}, lab: {pal: 0}},
    {label: 'sun-135', note: 'the sun from the lower right', params: {}, lab: {az: 135}},
    {label: 'dry', note: 'Moisture 0.4', params: {vgMoist: 0.4}},
    {label: 'wet', note: 'Moisture 1.6', params: {vgMoist: 1.6}},
    {label: 'fine', note: 'Patchiness 0.2', params: {vgPatchy: 0.2}},
  ],
  sim: {iterations: 320, wgsl: VG_FLOW},
  wgsl: VG_TERRAIN + VG_PLACE + /* wgsl */`
fn heightAt(p: vec2f) -> f32 { return vgTerrain(p); }
fn vgApply(x: i32, y: i32) {
  let p = worldOf(x, y);
  let s = SA[idx(x, y)];
  let k = vgPick(vgCovers(s), vgU(p));
  M[idx(x, y)] = vec4f(f32(k), s.y, s.z, s.w);
}
fn albedoAt(p: vec2f, h: f32, n: vec3f, m: vec4f) -> vec3f {
  if (prm.vgMode < 0.5) { return albedoDefault(p, h, n, vec4f(0.0)); }
  let k = i32(m.x + 0.5);
  if (prm.vgShow > 1.5) { return vec3f(clamp(0.5 * m.w, 0.0, 1.0), m.z, m.y); }
  if (prm.vgShow > 0.5) { return VG_FALSE[k]; }
  return vgAlbedo(k, p, vgSlopeOf(n));
}
// The class and site views are unlit, so each class is one colour and its share can be counted from the PNG.
fn lightAt(p: vec2f, h: f32, n: vec3f, m: vec4f, x: i32, y: i32) -> vec3f {
  if (prm.vgShow > 0.5) { return srgbToLin(albedoAt(p, h, n, m)) / lab.look.z; }
  return lightDefault(p, h, n, m, x, y);
}
`,
};
