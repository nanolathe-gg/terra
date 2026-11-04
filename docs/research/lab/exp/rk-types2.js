// More rock types from the one model (rk-lib.js), the Size control, and the model at 2x (the same world, so detail
// that only reads at 2x shows here). Lab default light.
import {RK_SCENE, RK_ROCK, RK_ALBEDO, RK_PARAMS, RK_PRESETS} from './rk-lib.js';

const P = RK_PRESETS;
export default {
  title: 'rk: gneiss, conglomerate, Size, 2x',
  about: 'Two more rock types, one Size control scaling every px size of the model, and two types at 2x.',
  world: 'green',
  lab: {exposure: 0.8},
  params: {...RK_PARAMS},
  variants: [
    {label: 'gneiss', note: 'banded wavy foliation, specks', params: P.gneiss},
    {label: 'conglomerate', note: 'pebbles standing proud of the beds', params: P.conglomerate, lab: {world: 'desert'}},
    {label: 'granite-size0.6', note: 'granite, Size 0.6', params: {...P.granite, size: 0.6}},
    {label: 'granite-size1.6', note: 'granite, Size 1.6', params: {...P.granite, size: 1.6}},
    {label: 'limestone-2x', note: 'limestone at 2x', params: P.limestone, lab: {px: 0.5, ox: 140, oy: 70}},
    {label: 'conglomerate-2x', note: 'conglomerate at 2x', params: P.conglomerate, lab: {px: 0.5, ox: 140, oy: 70, world: 'desert'}},
  ],
  wgsl: RK_SCENE + RK_ROCK + RK_ALBEDO,
};
