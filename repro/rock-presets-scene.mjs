// Rock presets in a scene (B2), headless: two presets and the world's rock on three strokes of modern Green, one preset edited.
//   node repro/rock-presets-scene.mjs [--out DIR]
// A wall on Jointed basalt, a dome on the world's Rounded granite and a hill on Smooth soil (the presets modern Green ships). Editing the basalt
// preset (Joint depth), then its rock color, changes the picture on the wall and no farther from its rock than a pass gathers from; the same
// scene gives the same bytes twice, and its export is the same bytes twice. Made translucent (B4), it moves only its ground and its cast
// shadow. A world color edited reaches a preset without colors of its own and not one with them. Writes before.png, after.png, recolored.png,
// translucent.png (and their clay) and report.json into DIR.
import assert from 'node:assert/strict';
import {mkdirSync, readFileSync, writeFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {join} from 'node:path';
import {openHost, openScene, weather, renderWindow, exportMap} from './headless.mjs';
import {encodePng} from './png.mjs';
import {setRock, setRockColors} from '../sculpt-rock-presets.js';

const arg = (k, d) => process.argv.includes(k) ? process.argv[process.argv.indexOf(k) + 1] : d;
const out = arg('--out', '/tmp/terraform-rock-presets-scene'); mkdirSync(out, {recursive: true});
const W = 1024, rect = {x: 100, y: 100, width: W, height: W, tile: 256}, BASALT = 2;
const scene = {biome: 'green', ground: true, strokes: [
  ['plateau', [[260, 420], [760, 360]], {seed: 11, card: {diameter: 480, elevation: 200, rockPreset: BASALT}}],
  ['mountain', [[960, 760]], {seed: 12, card: {diameter: 300, elevation: 140, rockPreset: 0}}],
  ['hill', [[380, 900], [620, 930]], {seed: 13, card: {rockPreset: 1}}]]};
const png = (name, pixels) => writeFileSync(join(out, name), encodePng(W, W, pixels));
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const report = {};

await openHost();
const s = await openScene(scene, 'biome=green&mapX=4&mapY=4&scratch=1&gpuMB=512&heapMB=1536&sunHeight=25&flatShadow=1');
try {
  await weather(s);
  report.inUse = [...s.renderer.rocks.keys()];
  assert.deepEqual(report.inUse, [1, BASALT], 'the table holds the presets strokes choose (Pitted limestone, unused, is not in it)');
  const color = {...rect, options: s.drawOptions({clay: false, light: 'original'})}, clay = {...rect, options: s.drawOptions({clay: true, light: 'original'})};
  const before = await renderWindow(s, color); png('before.png', before); png('before-clay.png', await renderWindow(s, clay));
  // The basalt preset's Joint depth, raised: the table changes and the shape is not evaluated again.
  const basalt = s.rocks.find(r => r.slot === BASALT);
  s.setRocks(setRock(s.rocks, BASALT, {knobs: {...basalt.knobs, faceJoint: 2.5}, column: basalt.column}));
  const after = await renderWindow(s, color); png('after.png', after); png('after-clay.png', await renderWindow(s, clay));
  assert.deepEqual(await renderWindow(s, color), after, 'the same scene gives the same bytes twice');
  // Where the picture moved, against the cells the basalt claims (mask plane 20 holds slot + 1), with the reach a pass gathers from.
  const {fields, worldGrid: grid, spacing, renderer, fieldsModule} = s;
  await fields.gpuReady();
  const words = new Uint32Array(await fieldsModule.readBuffer(renderer.device, fields.gpuBuffers().masks, 0, grid * grid * 28));
  const reach = 125, cell = 8, cw = Math.ceil(W / cell), near = new Uint8Array(cw * cw);   // 8-px blocks within reach of a basalt cell
  let claimed = 0;
  // The basalt's cast shadow may fall down-sun of it, as far as a 200-unit wall's at Sun height 25 (about 430 px): a second mask, for the
  // colored shadow below.
  const sun = renderer.sunVector('original'), along = Math.hypot(sun[0], sun[1]), down = [-sun[0] / along, -sun[1] / along], shade = new Uint8Array(cw * cw);
  for (let gy = 0; gy < grid; gy++) for (let gx = 0; gx < grid; gx++) {
    if ((words[(gy * grid + gx) * 7 + 5] & 255) !== BASALT + 1) continue;
    claimed++;
    const x = gx * spacing - rect.x, y = gy * spacing - rect.y;
    for (let k = 0; k <= 56; k++) { const bx = Math.floor((x + down[0] * k * 8) / cell), by = Math.floor((y + down[1] * k * 8) / cell); for (const [ox, oy] of [[0, 0], [1, 0], [-1, 0], [0, 1], [0, -1]]) { const X = bx + ox, Y = by + oy; if (X >= 0 && Y >= 0 && X < cw && Y < cw) shade[Y * cw + X] = 1; } }
    for (let by = Math.max(0, Math.floor((y - reach) / cell)); by <= Math.min(cw - 1, Math.floor((y + reach) / cell)); by++)
      for (let bx = Math.max(0, Math.floor((x - reach) / cell)); bx <= Math.min(cw - 1, Math.floor((x + reach) / cell)); bx++) near[by * cw + bx] = 1;
  }
  const where = (a, b, shadows = false) => {
    let moved = 0, outside = 0;
    for (let i = 0; i < b.length; i += 4) {
      if (a[i] === b[i] && a[i + 1] === b[i + 1] && a[i + 2] === b[i + 2]) continue;
      moved++; const p = i / 4, x = p % W, y = Math.floor(p / W);
      // The screen is the map seen from the south: a pixel shows ground up to its height / 2 farther south, so it is tested a block's slack wide.
      const at = (X, Y) => near[Y * cw + X] || (shadows && shade[Y * cw + X]);
      if (!at(Math.floor(x / cell), Math.floor(y / cell)) && !at(Math.floor(x / cell), Math.min(cw - 1, Math.floor((y + 160) / cell)))) outside++;
    }
    return {moved, outside};
  };
  const {moved, outside} = where(before, after);
  Object.assign(report, {claimedCells: claimed, moved, movedShare: +(moved / (W * W)).toFixed(4), outsideReach: outside});
  assert.ok(claimed > 1000, 'the wall claims its rock');
  assert.ok(moved > 2000, 'editing the preset changes the wall');
  assert.equal(outside, 0, `${outside} pixels moved farther than ${reach} px from the basalt`);
  // The basalt's rock color, its own: the wall darkens, and nothing farther than the reach moves.
  s.setRocks(setRockColors(s.rocks, BASALT, {rock: '#2c3440', beds: null}));
  const recolored = await renderWindow(s, color); png('recolored.png', recolored);
  const colorEdit = where(after, recolored);
  report.recolor = {...colorEdit, movedShare: +(colorEdit.moved / (W * W)).toFixed(4)};
  assert.ok(colorEdit.moved > 2000, 'a preset recolored changes its wall');
  assert.equal(colorEdit.outside, 0, `${colorEdit.outside} pixels moved farther than ${reach} px from the basalt`);
  // The basalt made translucent (B4: Color deepens with thickness, Colored cast shadow, an absorption color): only its ground
  // and its cast shadow move.
  const solid = s.rocks.find(r => r.slot === BASALT);
  s.setRocks(setRock(s.rocks, BASALT, {knobs: {...solid.knobs, absorbDepth: .7, shadowTint: .7}, column: solid.column, colors: {...solid.colors, absorb: '#2f6b97'}}));
  const translucent = await renderWindow(s, color); png('translucent.png', translucent);
  const lightEdit = where(recolored, translucent, true);
  report.translucent = {...lightEdit, movedShare: +(lightEdit.moved / (W * W)).toFixed(4)};
  assert.ok(lightEdit.moved > 2000, 'a translucent preset changes its wall and its shadow');
  assert.equal(lightEdit.outside, 0, `${lightEdit.outside} pixels moved outside the basalt's reach and its cast shadow`);
  assert.deepEqual(await renderWindow(s, color), translucent, 'the translucent scene gives the same bytes twice');
  // Its two numbers back to 0 (the absorption color kept): opaque rock to the bit, the picture it had before.
  s.setRocks(setRock(s.rocks, BASALT, {knobs: {...solid.knobs, absorbDepth: 0, shadowTint: 0}, column: solid.column, colors: {...solid.colors, absorb: '#2f6b97'}}));
  assert.deepEqual(await renderWindow(s, color), recolored, 'the two numbers at 0 give the opaque picture to the bit');
  s.setRocks(setRock(s.rocks, BASALT, {knobs: {...solid.knobs, absorbDepth: .7, shadowTint: .7}, column: solid.column, colors: {...solid.colors, absorb: '#2f6b97'}}));
  // Baked in 512-px tiles instead of 256: its shadows cross the tiles' edges. As render.mjs allows, at most 16 pixels may differ.
  const big = await renderWindow(s, {...color, tile: 512});
  let tileMoved = 0; for (let i = 0; i < big.length; i += 4) if (big[i] !== translucent[i] || big[i + 1] !== translucent[i + 1] || big[i + 2] !== translucent[i + 2]) tileMoved++;
  report.translucent.tileSize = tileMoved;
  assert.ok(tileMoved <= 16, `${tileMoved} pixels differ between 256- and 512-px tiles`);
  // A world color edited reaches the presets that take the world's (Smooth soil, slot 1) and not the basalt, which has its own.
  const row0 = slot => [0, 1, 2, 3].map(c => renderer.uniformView.getFloat32(renderer.uniform.get('rock').offset + slot * renderer.uniform.get('rock').stride + renderer.uniform.get('rock').members.get('rockColors').offset + c * 4, true));
  const colors = {...renderer.colorOverrides}, world = [.5, .25, .125];
  renderer.setColors({...colors, rock: world});
  assert.deepEqual(row0(1), [...world, 1], 'Smooth soil follows the world\'s rock color');
  assert.deepEqual(row0(2).map(v => Math.round(v * 255)), [0x2c, 0x34, 0x40, 255], 'the basalt keeps its own');
  renderer.setColors(colors);
  // An export of the two-preset map, twice: the same bytes.
  const {buildWasm} = await import('./export-node.mjs'), wasm = readFileSync(buildWasm(join(out, 'map-export.wasm')));
  const exports = [];
  for (const pass of [0, 1]) { const x = await exportMap(s, {name: 'Rock presets', wasm}); exports.push({ufo: sha(x.archive), png: sha(x.indexed)}); }
  report.exports = exports;
  assert.deepEqual(exports[0], exports[1], 'the export is the same bytes twice');
  assert.deepEqual(s.errors, []);
} finally {
  writeFileSync(join(out, 'report.json'), JSON.stringify(report, null, 2));
  s.dispose();
}
console.log(JSON.stringify(report));
process.exit(0);
