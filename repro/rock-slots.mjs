// Rock recipe slots (B1 of rock presets), headless: the table with a second recipe in use and the mask plane that says which rock a cell is.
//   node repro/rock-slots.mjs [--out DIR]
// On modern Green's long cliff (scene green-modern-2):
//   1. A second slot in use over a plane of zeros (every cell the world's own rock) keeps the heights and gives the same bytes twice. Its
//      picture is not one slot's: the pipelines then read any slot (rockMask 15), and the relief bake, compiled so, moves about 7% of the
//      pixels by a palette step or a few (measured: every value it reads is the same; a bake with the plane's read compiled out, or with the
//      stones' reads at slot 0, gives one slot's bytes). report.zeroPlane says how many.
//   2. The plane painted by hand (no stroke writes it yet) with slot 1, a visibly different recipe, east of x = 512 changes the picture there,
//      and west of it no farther from the line than the farthest a pass gathers from (rockfall reach and the flow's rounds). Twice the same bytes,
//      and the same picture baked in 512-px tiles as in 256-px ones (render.mjs's 16 px), also with Size sorting at 1, where one rock skips
//      stone classes.
// Writes one.png / one-clay.png (one slot), half.png / half-clay.png (the painted half), contact.png (the two side by side round the line)
// and report.json (the numbers, the pipelines' compile time) into DIR.
import assert from 'node:assert/strict';
import {mkdirSync, readFileSync, writeFileSync} from 'node:fs';
import {openHost, openScene, weather, renderWindow, windowHeights, knob} from './headless.mjs';
import {encodePng} from './png.mjs';
import {ROCK_PRESETS} from '../sculpt-rock-presets.js';

const arg = (k, d) => process.argv.includes(k) ? process.argv[process.argv.indexOf(k) + 1] : d;
const out = arg('--out', '/private/tmp/terraform-rock-slots'); mkdirSync(out, {recursive: true});
const scene = JSON.parse(readFileSync(new URL('./scenes/green-modern-2.json', import.meta.url), 'utf8'));
const W = 1024, SPLIT = 512, SLOT = 1, RECIPE = 'basalt';
const rect = {x: 0, y: 0, width: W, height: W, tile: 256};
const png = (name, pixels, width = W, height = W) => writeFileSync(`${out}/${name}.png`, encodePng(width, height, pixels));
// Pixels that differ, and the farthest west of the line any of them lies.
function difference(a, b) {
  let moved = 0, west = 0, east = 0, farthest = 0;
  for (let i = 0; i < a.length; i += 4) {
    if (a[i] === b[i] && a[i + 1] === b[i + 1] && a[i + 2] === b[i + 2]) continue;
    moved++;
    const x = (i / 4) % W;
    if (x < SPLIT) { west++; farthest = Math.max(farthest, SPLIT - x); } else east++;
  }
  return {moved, share: moved / (a.length / 4), west, east, farthestWest: farthest};
}
const same = (a, b, what) => assert.ok(a.length === b.length && a.every((v, i) => v === b[i]), `${what}: the same scene must give the same bytes`);

await openHost();
const s = await openScene(scene, `biome=${scene.biome}&mapX=4&mapY=4&scratch=1&gpuMB=512&heapMB=1536${scene.query ? '&' + scene.query : ''}`);
const report = {scene: 'green-modern-2', recipe: RECIPE, slot: SLOT, split: SPLIT};
try {
  await weather(s);
  const clay = {...rect, options: s.drawOptions({clay: true, light: 'original'})}, color = {...rect, options: s.drawOptions({clay: false, light: 'original'})};
  const heights = await windowHeights(s);
  const one = await renderWindow(s, color), oneClay = await renderWindow(s, clay);
  png('one', one); png('one-clay', oneClay);

  // 1. A second slot in use, the plane all zeros.
  const stats = () => ({...s.renderer.specStats});
  const before = stats();
  s.renderer.setRocks(new Map([[SLOT, {knobs: ROCK_PRESETS[RECIPE].knobs, column: {sections: ROCK_PRESETS[RECIPE].sections}}]]));
  // The pipelines that read any slot, built as a specialization miss builds them (the draw's, the bake's, the voxel solid's, rock weather's).
  const t0 = performance.now();
  await s.renderer.specialize(s.renderer.specKey());
  report.compile = {wallMs: Math.round(performance.now() - t0)};
  const two = await renderWindow(s, color);
  same(two, await renderWindow(s, color), 'two slots, zero plane');
  const twoClay = await renderWindow(s, clay);
  const after = stats();
  Object.assign(report.compile, {pipelineSets: after.built - before.built, drawAndBakeMs: Math.round(after.ms - before.ms), voxelAndRockWeatherMs: Math.round((after.rockMs ?? 0) - (before.rockMs ?? 0))});
  const zero = difference(one, two);
  report.zeroPlane = zero;
  assert.deepEqual(await windowHeights(s), heights, 'two slots over a zero plane keep the heights');

  // 2. Paint the plane: cells east of the line are slot 1's (the plane holds the slot + 1).
  const {renderer, fields, worldGrid: grid, spacing, fieldsModule} = s;
  await fields.gpuReady();
  const {masks} = fields.gpuBuffers();
  const words = new Uint32Array(await fieldsModule.readBuffer(renderer.device, masks, 0, grid * grid * 28));
  let painted = 0;
  for (let y = 0; y < grid; y++) for (let x = 0; x < grid; x++) {
    if (x * spacing < SPLIT) continue;
    const at = (y * grid + x) * 7 + 5;   // plane 20: word 5, byte 0
    words[at] = (words[at] & ~255) | (SLOT + 1); painted++;
  }
  renderer.device.queue.writeBuffer(masks, 0, words);
  report.paintedCells = painted;
  const half = await renderWindow(s, color), halfClay = await renderWindow(s, clay);
  same(half, await renderWindow(s, color), 'the painted plane');
  png('half', half); png('half-clay', halfClay);
  const tiles = (a, b) => difference(a, b).moved;
  report.tileSize = {painted: tiles(half, await renderWindow(s, {...color, tile: 512}))};
  assert.ok(report.tileSize.painted <= 16, `${report.tileSize.painted} pixels change with the tile size`);
  const reach = renderer.uniformValue('uDebrisReachMax');
  // The farthest a pass gathers from: rockfall (the largest reach in use, its 4-px cells and their blend) and then the stones that debris lays
  // (the largest class's radius 16 px, up to 1.41 times it, seen 1.6 radii out), or the flow's 16 rounds of 4 px.
  report.allowedWest = Math.ceil(Math.max(reach + 8 + 1.6 * 16 * 1.41, 16 * 4 + 8));
  report.painted = difference(two, half);
  report.paintedClay = difference(twoClay, halfClay);
  assert.ok(report.painted.east > 0.05 * W * W / 2, 'slot 1 must change the picture east of the line');
  assert.ok(report.paintedClay.farthestWest <= report.allowedWest, `a relief change ${report.paintedClay.farthestWest} px west of the line`);
  assert.ok(report.painted.farthestWest <= report.allowedWest, `a change ${report.painted.farthestWest} px west of the line, past the ${report.allowedWest} px a pass gathers from`);

  await knob(s, 'stoneSort', 1);
  report.tileSize.sorted = tiles(await renderWindow(s, color), await renderWindow(s, {...color, tile: 512}));
  assert.ok(report.tileSize.sorted <= 16, `${report.tileSize.sorted} pixels change with the tile size (Size sorting 1)`);
  // The contact for looking at: 384 px each side of the line, one slot above, the painted half below, colour left and clay right.
  const crop = (pixels, x0, y0, w, h) => { const c = new Uint8Array(w * h * 4); for (let y = 0; y < h; y++) c.set(pixels.subarray(((y0 + y) * W + x0) * 4, ((y0 + y) * W + x0 + w) * 4), y * w * 4); return c; };
  const cw = 512, ch = 512, x0 = SPLIT - cw / 2, y0 = 512, sheet = new Uint8Array(cw * 2 * ch * 2 * 4);
  const place = (pixels, px, py) => { for (let y = 0; y < ch; y++) sheet.set(pixels.subarray(y * cw * 4, (y + 1) * cw * 4), ((py + y) * cw * 2 + px) * 4); };
  place(crop(one, x0, y0, cw, ch), 0, 0); place(crop(oneClay, x0, y0, cw, ch), cw, 0);
  place(crop(half, x0, y0, cw, ch), 0, ch); place(crop(halfClay, x0, y0, cw, ch), cw, ch);
  png('contact', sheet, cw * 2, ch * 2);
  assert.deepEqual(s.errors, []);
} finally {
  writeFileSync(`${out}/report.json`, JSON.stringify(report, null, 2));
  s.dispose();
}
console.log(JSON.stringify(report));
process.exit(0);
