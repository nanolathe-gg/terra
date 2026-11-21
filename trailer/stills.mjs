// Engine stills for the trailer cuts, on Dawn (repro/headless.mjs): a scene's window as each stroke arrives, and optionally the export's art.
//   node trailer/stills.mjs <scene.json> <out-dir> [--width 1280 --height 720] [--map 4x4] [--steps] [--tiles] [--cells]
// Writes <out-dir>/final.png (all strokes, the Time pass run); with --steps also step-<i>.png for the first i+1 strokes; with --tiles
// tiles.json: the export art of the whole map (exportArt, as the exporter bakes it) cut into 32 px tiles, how many are distinct, and
// export.png (the window of that art); with --cells cells.json: the game's heights, one per 16 px cell corner over the window.
import {encodePng} from '../repro/png.mjs';
import {createHash} from 'node:crypto';
import {mkdirSync, readFileSync, writeFileSync} from 'node:fs';

const args = process.argv.slice(2);
const opt = (name, fallback) => { const i = args.indexOf(name); return i >= 0 ? args.splice(i, 2)[1] : fallback; };
const flag = name => { const i = args.indexOf(name); if (i >= 0) args.splice(i, 1); return i >= 0; };
const W = Number(opt('--width', 1280)), H = Number(opt('--height', 720)), [MAPX, MAPY] = opt('--map', '4x4').split('x').map(Number);
const steps = flag('--steps'), tiles = flag('--tiles'), cells = flag('--cells'), clay = flag('--clay');
const [sceneFile, out] = args;
if (!sceneFile || !out) { console.error('usage: node trailer/stills.mjs <scene.json> <out-dir> [--steps] [--tiles] [--cells]'); process.exit(2); }
const scene = JSON.parse(readFileSync(sceneFile, 'utf8'));
mkdirSync(out, {recursive: true});
const search = new URLSearchParams(`biome=${scene.biome}&mapX=${MAPX}&mapY=${MAPY}&scratch=1&gpuMB=512&heapMB=1536${scene.query ? '&' + scene.query : ''}`).toString();
const headless = await import('../repro/headless.mjs');
const t0 = Date.now();
await headless.openHost({});
const s = await headless.openScene({...scene, strokes: []}, search, {strokes: []});
// A world's own tool (Canyon, Cone, Atoll...) is a library shape with the world's numbers: a scene names library shapes, so the stroke becomes that
// shape with the card the toolbar's button starts from (sculpt-scene.js toolDefaults), the same numbers the editor draws it with.
const {LANDFORM_SHAPES, shapeFrom, toolDefaults} = await import('../sculpt-scene.js');
scene.strokes = scene.strokes.map(([entry, points, options = {}]) => Object.hasOwn(LANDFORM_SHAPES, entry) || !s.config.worldShapes?.[scene.biome]?.[entry] ? [entry, points, options]
  : [shapeFrom(s.config, entry), points, {...options, card: {...toolDefaults(s.config, entry), ...(options.card || {})}}]);
const shot = async (name, options = s.drawOptions({light: 'original'})) => writeFileSync(`${out}/${name}.png`, encodePng(W, H, await headless.renderWindow(s, {width: W, height: H, options})));
if (steps) for (let i = 0; i < scene.strokes.length; i++) { await headless.scene(s, scene.strokes.slice(0, i + 1), {ground: scene.ground !== false}); await shot(`step-${i}`); }
else await headless.scene(s, scene.strokes, {ground: scene.ground !== false});
await shot('final');
if (clay) await shot('clay', s.drawOptions({light: 'original', clay: true}));
const info = {scene: sceneFile, biome: scene.biome, sea: s.config.seaLevel, base: s.config.baseHeight, strokes: scene.strokes.map(([kind, points]) => ({kind, points})), errors: s.errors.slice(0, 8)};
if (tiles) {
  const {width: mw, height: mh} = s.config.map, art = await headless.renderWindow(s, {width: mw, height: mh, exportArt: true}), side = mw;
  const seen = new Map(), at = new Map();
  for (let ty = 0; ty + 32 <= mh; ty += 32) for (let tx = 0; tx + 32 <= mw; tx += 32) {
    const h = createHash('sha1');
    for (let r = 0; r < 32; r++) { const o = ((ty + r) * side + tx) * 4; h.update(art.subarray(o, o + 128)); }
    const d = h.digest('hex'); seen.set(d, (seen.get(d) ?? 0) + 1); at.set(`${tx},${ty}`, d);
  }
  // The window's tiles: how often each is used in the whole map (1: made for this place alone).
  const ids = [...seen.keys()], index = new Map(ids.map((d, i) => [d, i]));
  const windowTiles = Array.from({length: Math.floor(H / 32)}, (_, j) => Array.from({length: Math.floor(W / 32)}, (_, i) => { const d = at.get(`${i * 32},${j * 32}`); return [index.get(d), seen.get(d)]; }));
  const crop = new Uint8Array(W * H * 4); for (let r = 0; r < H; r++) crop.set(art.subarray(r * side * 4, r * side * 4 + W * 4), r * W * 4);
  writeFileSync(`${out}/export.png`, encodePng(W, H, crop));
  info.tiles = {width: mw, height: mh, total: Math.floor(mw / 32) * Math.floor(mh / 32), distinct: seen.size, once: [...seen.values()].filter(n => n === 1).length};
  writeFileSync(`${out}/tiles.json`, JSON.stringify({...info.tiles, window: windowTiles}));
}
if (cells) {
  const nx = W / 16 + 1, ny = H / 16 + 1, h = await headless.windowHeights(s, {samples: Math.max(nx, ny), step: 16});
  writeFileSync(`${out}/cells.json`, JSON.stringify({step: 16, nx, ny, sea: s.config.seaLevel, base: s.config.baseHeight, heights: Array.from({length: ny}, (_, j) => h.slice(j * Math.max(nx, ny), j * Math.max(nx, ny) + nx))}));
}
info.ms = Date.now() - t0;
writeFileSync(`${out}/info.json`, JSON.stringify(info, null, 1));
console.log(`stills: ${scene.biome} ${out} in ${info.ms} ms${info.tiles ? ` tiles ${info.tiles.distinct}/${info.tiles.total}` : ''}${s.errors.length ? ' errors: ' + s.errors.slice(0, 2).join(' | ') : ''}`);
s.dispose(); process.exit(0);
