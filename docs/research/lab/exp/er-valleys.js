// er-valleys: valley cross-sections as presets of one carve-to profile, and a painted override inside the Time pass.
//
// The valley is decision 24's cut-to landform: the ground is cut to the valley floor plus a rise that is a function of the
// distance to the valley's line. Three rises are three presets of the same control, not three tools:
//   V         rise = vslope * d                                    (fluvial: a river cuts down, the walls stand at their slope)
//   U         rise = d^2 / trough                                  (glacial: a parabolic trough, flat floor, steep upper walls)
//   terraces  rise = a gentle floor (tslope d) quantised into tcount treads `tread` units high, risers the last `riser` share
//             of each step, then the wall at vslope (fluvial terraces: floor levels a river left as it cut down; paired)
// Then the multi-scale thermal of er-talus/er-resolve relaxes what is steeper than the repose. The last two panels paint an
// override (decision 5) on the U trough's east wall: a soft disc that scales the repose (1 + ovr) inside it. The pair rule
// uses the mean of its two ends, so the sim stays symmetric, mass-conserving and deterministic.
// The tree, the sim and their parameters are er-resolve's.
import resolve, {treeWgsl, simWgsl} from './er-resolve.js';

const L = {px: 1, ox: 6, oy: -20};
export default {
  title: 'Valleys: V, U and terraces as one carve profile',
  about: 'A cut-to valley through the range with three rise presets, then multi-scale thermal; a painted repose override on the trough wall.',
  world: 'green',
  params: {...resolve.params},
  sim: {iterations: 25, wgsl: simWgsl},
  variants: [
    {label: 'V', note: 'fluvial, rise 1.0 d', params: {valley: 1, vslope: 1.0}, lab: L},
    {label: 'U', note: 'glacial, rise d^2 / 70', params: {valley: 2}, lab: L},
    {label: 'terraces', note: 'fluvial terraces: 3 treads of 9 units on a 0.4 floor, wall 1.0', params: {valley: 3, vslope: 1.0}, lab: L},
    {label: 'U-authored', note: 'U before the Time pass', params: {valley: 2}, lab: {...L, iters: 0}},
    {label: 'U-override-steep', note: 'painted disc: repose x1.8 (rock walls kept)', params: {valley: 2, ovr: 0.8}, lab: L},
    {label: 'U-override-loose', note: 'painted disc: repose x0.6 (more scree)', params: {valley: 2, ovr: -0.4}, lab: L},
  ],
  wgsl: treeWgsl,
};
