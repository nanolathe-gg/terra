// The trailer's layers of one scene, from the engine on Dawn (repro/headless.mjs): the stages the explainer shows, all of the same window.
//   node trailer/layers.mjs <scene.json> <out-dir> [--width 1280 --height 720] [--map 4x4]
// Writes into <out-dir>:
//   final.png               the window as the editor draws it
//   clay.png                the same with Clay on (the solid, no materials)
//   clay-v8.png, clay-v4.png   Clay with 8 and 4 px voxels (the preview levels' solid) at 1x pixels
//   material.png            the page's 'material' view (each pixel's material color, unlit)
//   heights-authored.f32    the shape's heights before the Time pass (2 px samples, row-major, width/2 x width/2)
//   heights-weathered.f32   the heights after it
//   keys/<step>-<i>.f32     the authored heights at each keyframe of the scene's `trailer.steps` (its edits, applied in order)
//   info.json               sizes, sea level, height range, the strokes' points, the keyframes
// Every picture is an existing view of the one render path (the page's Clay box, its view= diagnostics, the preview levels' voxel size).
import {encodePng} from '../repro/png.mjs';
import {mkdirSync, readFileSync, writeFileSync} from 'node:fs';

const args = process.argv.slice(2);
const opt = (name, fallback) => { const i = args.indexOf(name); return i >= 0 ? args.splice(i, 2)[1] : fallback; };
const W = Number(opt('--width', 1280)), H = Number(opt('--height', 720)), [MAPX, MAPY] = opt('--map', '4x4').split('x').map(Number);
const [sceneFile, out] = args;
if (!sceneFile || !out) { console.error('usage: node trailer/layers.mjs <scene.json> <out-dir>'); process.exit(2); }
const scene = JSON.parse(readFileSync(sceneFile, 'utf8'));
mkdirSync(out, {recursive: true});
const search = new URLSearchParams(`biome=${scene.biome}&mapX=${MAPX}&mapY=${MAPY}&scratch=1&gpuMB=512&heapMB=1536${scene.query ? '&' + scene.query : ''}`).toString();

const headless = await import('../repro/headless.mjs');
const t0 = Date.now();
await headless.openHost({});
const samples = W / 2;   // square sample grid over the window's width; the explainer crops to the height
const toF32 = list => Buffer.from(new Float32Array(list).buffer);
// The keyframes: each step moves one stroke's point or eases card numbers from..to over its frames; later steps start where earlier ones ended.
let strokes = structuredClone(scene.strokes);
const s = await headless.openScene(scene, search, {strokes});
const keys = [], lerp = (a, b, t) => a + (b - a) * t;
mkdirSync(`${out}/keys`, {recursive: true});
const key = async (step, i, t, list) => {
  s.play(list);
  const file = `keys/${step}-${i}.f32`;
  writeFileSync(`${out}/${file}`, toF32(await headless.windowHeights(s, {samples})));
  keys.push({step, i, t, file, strokes: list.map(([kind, points]) => ({kind, points}))});
};
// Drawing: the strokes arrive one at a time.
for (let i = 0; i < strokes.length; i++) await key('draw', i, 1, strokes.slice(0, i + 1));
for (const step of scene.trailer?.steps ?? []) {
  const start = structuredClone(strokes[step.stroke]);
  for (let i = 0; i < step.frames; i++) {
    const t = step.frames > 1 ? i / (step.frames - 1) : 1, e = t * t * (3 - 2 * t), st = structuredClone(start);
    if (step.to) st[1][step.point] = start[1][step.point].map((v, k) => Math.round(lerp(v, step.to[k], e)));
    if (step.card) { st[2] = {...st[2], card: {...st[2].card}}; for (const [k, [a, b]] of Object.entries(step.card)) st[2].card[k] = Math.round(lerp(a, b, e)); }
    strokes[step.stroke] = st;
    await key(step.name, i, t, strokes);
  }
}
writeFileSync(`${out}/heights-authored.f32`, toF32(await headless.windowHeights(s, {samples})));
const time = await headless.weather(s);
if (!time) console.warn('layers: the Time pass did not run (erosion 0?): heights-weathered equals the authored heights');
writeFileSync(`${out}/heights-weathered.f32`, toF32(await headless.windowHeights(s, {samples})));

const shot = async (name, options) => {
  const t = Date.now(), pixels = await headless.renderWindow(s, {width: W, height: H, options});
  writeFileSync(`${out}/${name}.png`, encodePng(W, H, pixels));
  console.log(`${name}: ${Date.now() - t} ms`);
};
const base = {light: 'original'};
await shot('final', s.drawOptions(base));
await shot('clay', s.drawOptions({...base, clay: true}));
for (const v of [8, 4]) await shot(`clay-v${v}`, {...s.drawOptions({...base, clay: true}), voxelScale: v});
s.renderer.variant.set('view', 'material');
await shot('material', s.drawOptions(base));
s.renderer.variant.delete('view');

writeFileSync(`${out}/info.json`, JSON.stringify({width: W, height: H, samples, step: 2, sea: s.config.seaLevel, base: s.config.baseHeight, minH: s.minH, maxH: s.maxH, time: Boolean(time),
  strokes: strokes.map(([kind, points]) => ({kind, points})), first: scene.strokes.map(([kind, points]) => ({kind, points})), keys, errors: s.errors.slice(0, 8), ms: Date.now() - t0}, null, 1));
console.log(`layers: ${out} in ${Date.now() - t0} ms${s.errors.length ? '; errors: ' + s.errors.slice(0, 3).join(' | ') : ''}`);
s.dispose();
process.exit(0);
