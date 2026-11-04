// Weathering on the rk- cliff band: age (rounded edges, opened joints), lichen on lit faces, frost shattering, and
// stains run down the fall line from the tier tops (desert varnish, limestone's grey water streaks). Same model and
// numbers as rk-types; only the weathering numbers change. Lab default light.
import {RK_SCENE, RK_ROCK, RK_ALBEDO, RK_PARAMS, RK_PRESETS} from './rk-lib.js';

const G = RK_PRESETS.granite, S = RK_PRESETS.sandstone, L = RK_PRESETS.limestone;
const none = {stain: 0, lichen: 0, frost: 0};
export default {
  title: 'rk: weathering',
  about: 'Age, lichen, frost and stains as numbers on the one rock model.',
  world: 'green',
  lab: {exposure: 0.8},
  params: {...RK_PARAMS},
  variants: [
    {label: 'fresh', note: 'granite, age 0: sharp edges, tight joints', params: {...G, ...none, age: 0}},
    {label: 'aged', note: 'granite, age 1: rounded shoulders, open joints', params: {...G, ...none, age: 1}},
    {label: 'lichen', note: 'granite, age 0.7, lichen 1 on sunlit faces', params: {...G, ...none, age: 0.7, lichen: 1}},
    {label: 'frost', note: 'granite, frost 1: shattered, fresh scars, coarse talus', params: {...G, ...none, age: 0.2, frost: 1}},
    {label: 'varnish', note: 'sandstone, stain 1: desert varnish streaks', params: {...S, ...none, age: 0.6, stain: 1, stainLen: 80}, lab: {world: 'desert'}},
    {label: 'streaks', note: 'limestone, stain 0.8 in grey: water streaks', params: {...L, ...none, age: 0.6, stain: 0.8, stainLen: 60, sR: 70, sG: 72, sB: 76, lichen: 0.5}},
  ],
  wgsl: RK_SCENE + RK_ROCK + RK_ALBEDO,
};
