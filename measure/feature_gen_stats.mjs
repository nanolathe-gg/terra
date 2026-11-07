// Write generated sprites as the PNG folders measure/feature_stats.py (branch prototype/faudit) reads.
//   node measure/feature_gen_stats.mjs OUT_DIR [--n 12]
// Folders: OUT_DIR/{tree-broadleaf,tree-conifer,burnt,shrub,rock,smudge,stain,burn-frames}/NAME.png (+ -shadow.png, .json)
import {mkdirSync, writeFileSync, readFileSync} from 'node:fs';
import {join} from 'node:path';
import {encodePNG} from './feature_gen_png.mjs';
import {generateFeature, toRGBA} from '../sculpt-feature-gen.js';
const args = process.argv.slice(2);
const out = args[0], nIdx = args.indexOf('--n'), N = nIdx > 0 ? Number(args[nIdx + 1]) : 12;
const palette = JSON.parse(readFileSync(new URL('../materials/palette.json', import.meta.url))).indexed;
const save = (dir, name, f, extra = {}) => {
  mkdirSync(dir, {recursive: true});
  const b = f.body;
  writeFileSync(join(dir, name + '.png'), encodePNG(b.w, b.h, toRGBA(b, palette)));
  const meta = {xOffset: b.ax, yOffset: b.ay, category: extra.category || ''};
  if (f.shadow) { writeFileSync(join(dir, name + '-shadow.png'), encodePNG(f.shadow.w, f.shadow.h, toRGBA(f.shadow, palette))); meta.shadow = {xOffset: f.shadow.ax, yOffset: f.shadow.ay}; }
  writeFileSync(join(dir, name + '.json'), JSON.stringify(meta));
};
const sets = {
  'tree-broadleaf': ['tree', {species: 'broadleaf'}], 'tree-conifer': ['tree', {species: 'conifer', height: 61, width: 0.5}],
  shrub: ['shrub', {}], 'burnt-conifer': ['burnt', {species: 'conifer', height: 56, width: 0.5}], rock: ['rock', {cells: '2x2'}], smudge: ['scar', {type: 'smudge'}], stain: ['scar', {type: 'stain'}],
};
for (const [dir, [kind, params]] of Object.entries(sets)) {
  for (let i = 0; i < N; i++) {
    const f = generateFeature(kind, kind === 'tree' && params.species === 'conifer' ? {...params, height: 57 + (i % 4) * 2, width: 0.44 + (i % 5) * 0.04} : params, 1000 + i * 7, {palette});
    save(join(out, dir), `${dir}-${i}`, f, {category: dir});
    if (kind === 'tree' && dir === 'tree-broadleaf' && i < N) save(join(out, 'burnt'), `burnt-${i}`, f.burnt, {category: 'burnt'});
  }
}
for (const cells of ['1x1', '3x3', '4x3']) for (let i = 0; i < 4; i++) save(join(out, 'rock-' + cells), `rock-${cells}-${i}`, generateFeature('rock', {cells}, 50 + i, {palette}), {category: 'rock'});
console.log('wrote', out);
