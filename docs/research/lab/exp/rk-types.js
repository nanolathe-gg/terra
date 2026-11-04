// Rock types on one cliff band, from one parametric model (rk-lib.js): each variant is a preset of numbers.
import {RK_SCENE, RK_ROCK, RK_ALBEDO, RK_PARAMS, RK_PRESETS} from './rk-lib.js';

const P = RK_PRESETS;
export default {
  title: 'rk: rock types from one model',
  about: 'Joint cells, beds, laminae, inclusions and flutes, with one set of numbers per rock type; lab default light.',
  world: 'green',
  lab: {exposure: 0.8},
  params: {...RK_PARAMS},
  variants: [
    {label: 'granite', note: 'rounded joint blocks, sheets, specks', params: P.granite},
    {label: 'sandstone', note: 'beds, cross-beds, tafoni', params: P.sandstone, lab: {world: 'desert'}},
    {label: 'limestone', note: 'karren flutes, pits, grikes', params: P.limestone},
    {label: 'basalt', note: 'columns: hexagons stepped down the face', params: P.basalt, lab: {world: 'lava'}},
    {label: 'shale', note: 'thin fissile beds, chips', params: P.shale, lab: {world: 'red'}},
    {label: 'schist', note: 'wavy dipping foliation', params: P.schist},
  ],
  wgsl: RK_SCENE + RK_ROCK + RK_ALBEDO,
};
