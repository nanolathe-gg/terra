// lf-joints: the same column walk (lf-lib) on a plateau stroke (engine-shape.wgsl kind 6 style: a flat top, steep sides),
// now with vertical joint sets. A joint lowers the resistance of every bed near it (water gets in), so along joints the
// budget breaks through a hard bed that holds between them. Sharp joints: a slot grid in slickrock. One set with blocks
// that weaken toward their edges (jRound) and differ in strength (blockVar): fins. Two sets: pinnacles (hoodoos), each
// capped by the bed that held. Massive rock with rounded blocks (spheroidal weathering) and a small budget: beehive
// domes, the tor's sandstone cousin. Scarp retreat from the plateau's edge (edgeDrive) breaks the edge up first, so
// pinnacles thin out toward it. Original code; ideas from Paris et al.
// 2019 (hardness at a 3D point), Ito et al. 2003 (joint-controlled rocky scenery), Beardall et al. 2007 (goblins by
// spheroidal weathering).
import {LF_PARAMS, LF_WGSL, LF_PLATEAU, LF_PLATEAU_PARAMS} from './lf-lib.js';

export default {
  title: 'Slots, fins, pinnacles and beehives from joints',
  about: 'A plateau stroke over a massive sandstone column, eroded by lf-lib\'s column walk; vertical joint sets weaken the rock along their lines.',
  world: 'desert',
  lab: {exposure: 0.85},
  colours: {rock: [175, 111, 90], sand: [204, 178, 140], loose: [189, 140, 108]},
  params: {...LF_PARAMS, E: 100, relief: 90, noiseA: 0.35, noiseW: 110, thick: 4, cyc: 9, hardN: 3, hier: 0.25, K: 12,
    ...LF_PLATEAU_PARAMS, gullyD: 6, gullyW: 40, jSp: 24, jW: 3, jWeak: 0.9, jAng: 35, jCross: 82, jRound: 1, blockVar: 0.5},
  variants: [
    {label: 'swept', note: 'the plateau stroke, no erosion', params: {E: 0}},
    {label: 'slots', note: 'two sets, sharp joints: slot grid', params: {jSets: 2, jRound: 0, blockVar: 0, E: 120}},
    {label: 'fins', note: 'one joint set: fins', params: {jSets: 1, jSp: 20, blockVar: 0.4}},
    {label: 'pinnacles', note: 'two sets: capped pinnacles', params: {jSets: 2}},
    {label: 'beehives', note: 'massive rock, rounded blocks: beehive domes', params: {jSets: 2, jW: 5, jSp: 30, hardN: 7, K: 6, E: 40, edgeK: 1.2, gullyD: 0}},
    {label: 'pinnacles-2x', note: '2x zoom', params: {jSets: 2}, lab: {px: 0.5, ox: 60, oy: 150}},
  ],
  wgsl: /* wgsl */`
fn heightAt(p: vec2f) -> f32 { return lfHeight(p); }
fn albedoAt(p: vec2f, h: f32, n: vec3f, m: vec4f) -> vec3f { return lfAlbedo(p, h, n); }
` + LF_PLATEAU + LF_WGSL,
};
