// Export generated features under retail names (NAME__x.png, NAME__x-shadow.png, NAME__x.json) for a private side-by-side with retail,
// plus the burn frames. The comparison sheets themselves stay outside the repo.
//   node measure/feature_gen_export.mjs OUT_DIR
import {mkdirSync, writeFileSync, readFileSync} from 'node:fs';
import {join} from 'node:path';
import {encodePNG} from './feature_gen_png.mjs';
import {generateFeature, paintDeposit, toRGBA} from '../sculpt-feature-gen.js';
const out = process.argv[2], palette = JSON.parse(readFileSync(new URL('../materials/palette.json', import.meta.url))).indexed;
mkdirSync(out, {recursive: true}); mkdirSync(join(out, 'fire'), {recursive: true});
const save = (dir, name, s, sh) => {
  writeFileSync(join(dir, name + '.png'), encodePNG(s.w, s.h, toRGBA(s, palette)));
  const meta = {xOffset: s.ax, yOffset: s.ay};
  if (sh) { writeFileSync(join(dir, name + '-shadow.png'), encodePNG(sh.w, sh.h, toRGBA(sh, palette))); meta.shadow = {xOffset: sh.ax, yOffset: sh.ay}; }
  meta.idx = Array.from(s.idx).map((v, k) => (s.a[k] ? v : -1)); meta.w = s.w;     // palette indices, so statistics need no color lookup (the palette has duplicate colors)
  writeFileSync(join(dir, name + '.json'), JSON.stringify(meta));
};
const F = (kind, params, seed) => generateFeature(kind, params, seed);
const list = [
  ['Tree1', F('tree', {}, 1000)], ['Tree2', F('tree', {}, 1007)], ['Tree3', F('tree', {}, 1014)],
  ['Tree4', F('tree', {species: 'conifer', height: 64, width: 0.44}, 2000)], ['Tree5', F('tree', {species: 'conifer', height: 60, width: 0.62}, 2007)], ['Tree6', F('tree', {species: 'conifer', height: 59, width: 0.54}, 2014)],
  ['Tree1Dead', F('burnt', {}, 3000)], ['Tree2Dead', F('burnt', {height: 51, width: 0.53}, 3007)], ['Tree3Dead', F('burnt', {height: 51, width: 0.78}, 3014)],
  ['Tree4Dead', F('burnt', {species: 'conifer', height: 64, width: 0.44}, 3100)], ['Tree5Dead', F('burnt', {species: 'conifer', height: 53, width: 0.58}, 3107)], ['Tree6Dead', F('burnt', {species: 'conifer', height: 51, width: 0.5}, 3114)],
  ['Rock09', F('rock', {cells: '1x1', size: 1}, 5001)], ['Rock08', F('rock', {cells: '1x1', size: 0.9}, 5002)], ['Rock05', F('rock', {cells: '2x2'}, 5100)], ['Rock06', F('rock', {cells: '2x2'}, 5101)],
  ['Rock3', F('rock', {cells: '3x2'}, 5300)], ['Rock2', F('rock', {cells: '3x3'}, 5200)], ['Rock', F('rock', {cells: '4x3'}, 5400)],
  ['Shrub1', F('shrub', {density: 0.6, width: 25, height: 16}, 4101)], ['Shrub2', F('shrub', {density: 0.6, width: 30, height: 25}, 4102)], ['Shrub3', F('shrub', {density: 0.12, width: 33, height: 26}, 4103)],
  ['Smudge01', F('scar', {type: 'smudge'}, 6000)], ['Smudge02', F('scar', {type: 'smudge'}, 6001)],
];
for (const [name, f] of list) save(out, name + '__g', f.body, f.shadow);
// deposits painted on flat ground, exported as the pixels that changed
for (const [name, metal, seed] of [['RockMetal', 187, 703], ['RockMetal1', 127, 702], ['RockMetal2', 86, 701], ['RockMetal3', 223, 704]]) {
  const W = 128, g = {w: W, h: W, rgba: new Uint8ClampedArray(W * W * 4)}; for (let i = 0; i < W * W; i++) { g.rgba[i * 4] = 70; g.rgba[i * 4 + 1] = 110; g.rgba[i * 4 + 2] = 40; g.rgba[i * 4 + 3] = 255; }
  paintDeposit(g, 64, 64, {metal}, seed, {palette});
  const rgba = new Uint8ClampedArray(W * W * 4); let x0 = W, x1 = 0, y0 = W, y1 = 0;
  for (let y = 0; y < W; y++) for (let x = 0; x < W; x++) { const k = (y * W + x) * 4; if (g.rgba[k] === 70 && g.rgba[k + 1] === 110 && g.rgba[k + 2] === 40) continue; rgba.set(g.rgba.subarray(k, k + 4), k); x0 = Math.min(x0, x); x1 = Math.max(x1, x); y0 = Math.min(y0, y); y1 = Math.max(y1, y); }
  const w = x1 - x0 + 1, h = y1 - y0 + 1, c = new Uint8ClampedArray(w * h * 4);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) c.set(rgba.subarray(((y + y0) * W + x + x0) * 4, ((y + y0) * W + x + x0) * 4 + 4), (y * w + x) * 4);
  writeFileSync(join(out, name + '__g.png'), encodePNG(w, h, c)); writeFileSync(join(out, name + '__g.json'), JSON.stringify({xOffset: 64 - x0, yOffset: 64 - y0}));
}
// burn frames: Tree1-like broadleaf, a conifer, a shrub
const burns = {tree1: F('tree', {}, 1000).burn, tree4: F('tree', {species: 'conifer', height: 64, width: 0.44}, 2000).burn, shrub1: F('shrub', {density: 0.6, width: 25, height: 16}, 4101).burn};
for (const [k, frames] of Object.entries(burns)) frames.forEach((s, i) => save(join(out, 'fire'), `${k}-${String(i).padStart(2, '0')}`, s));
console.log('wrote', out);
