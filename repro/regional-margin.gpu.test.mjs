// A regional shape evaluation must leave every cell outside its rectangle as it was. A coast node makes the nodes before it cover more than the
// rectangle (rects in the engine's submit); the cells of that margin once kept only those earlier nodes, so a move near a coast wiped the later
// shapes beside the edit. Run with repro/check.sh engine, or node --test repro/regional-margin.gpu.test.mjs.
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

const card = JSON.parse(readFileSync(new URL('./scenes/green-modern-2.json', import.meta.url))).strokes[0][2];
// A landform dug below the sea with surf (the coast node) first, then a crater and a raised landform after it in the list, within its read distance of the
// rectangles below.
const sea = structuredClone(card); Object.assign(sea.card, {elevation: -55, diameter: 420, surf: 15});   // Surf: the beach pass makes it a coast node
const strokes = [
  ['landform', [[-100, 1250], [500, 1230], [1100, 1260], [1800, 1240]], sea],
  ['crater', [[330, 950]], {card: {diameter: 420, amount: 60, roughness: 40}}],
  ['landform', [[300, 740], [440, 760], [600, 790]], structuredClone(card)],
  ['landform', [[1200, 560], [1400, 520], [1620, 600]], structuredClone(card)],
];
const rects = [{x0: 350, y0: 300, x1: 550, y1: 650}, {x0: 120, y0: 520, x1: 200, y1: 640}, {x0: 300, y0: 380, x1: 420, y1: 470}];
// Words that differ outside `rect`, in planes (7 floats a cell, plane after plane) and masks (7 words a cell) of a block `w` cells wide at (ox, oy).
// Inside the rectangle a regional run may differ from the whole one by float steps off Metal (rule 12), so only the outside is held exact.
function changedOutside(before, after, per, planar, {ox, oy, w, h}, rect) {
  const a = new Uint32Array(before), b = new Uint32Array(after), cells = w * h; let n = 0;
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const gx = x + ox, gy = y + oy; if (gx >= rect.x0 && gx <= rect.x1 && gy >= rect.y0 && gy <= rect.y1) continue;
    const i = y * w + x; for (let k = 0; k < per; k++) { const at = planar ? k * cells + i : i * per + k; if (a[at] !== b[at]) n++; }
  }
  return n;
}
const open = async () => (await import('./headless.mjs')).openScene({biome: 'green', ground: false, strokes}, 'biome=green&mapX=4&mapY=4&scratch=1&gpuMB=512&heapMB=1536');
const engineOptions = s => ({device: s.renderer.device, grid: s.worldGrid, spacing: s.spacing, baseHeight: s.config.baseHeight, sea: s.config.seaLevel, minH: s.minH, maxH: s.maxH});

test('a regional evaluation on the whole map changes no cell outside its rectangle', async () => {
  const s = await open();
  try {
    const read = b => s.fieldsModule.readBuffer(s.renderer.device, b, 0, b.size), nodes = s.nodes.slice(), ctx = s.context();
    const engine = await s.fieldsModule.createShapeEngine(engineOptions(s)), block = {ox: 0, oy: 0, w: s.worldGrid, h: s.worldGrid};
    try {
      await engine.run(nodes, ctx, null, {readback: false});
      const planes = await read(engine.planes), masks = await read(engine.masks);
      for (const rect of rects) {
        await engine.run(nodes, ctx, rect, {readback: false});
        assert.equal(changedOutside(planes, await read(engine.planes), 7, true, block, rect), 0, `planes after ${JSON.stringify(rect)}`);
        assert.equal(changedOutside(masks, await read(engine.masks), 7, false, block, rect), 0, `masks after ${JSON.stringify(rect)}`);
      }
    } finally { engine.destroy(); }
    assert.deepEqual(s.errors, []);
  } finally { s.dispose(); }
});

test('a regional evaluation on a page changes no cell outside its rectangle', async () => {
  const s = await open();
  try {
    const read = b => s.fieldsModule.readBuffer(s.renderer.device, b, 0, b.size), nodes = s.nodes.slice(), ctx = s.context();
    const engine = await s.fieldsModule.createShapeEngine({...engineOptions(s), pages: true}), block = {ox: 64, oy: 192, w: 640, h: 640}, target = engine.makeTarget(block.ox, block.oy, block.w, block.h);
    try {
      await engine.submit(nodes, ctx, null, {readback: false, target}).done;
      const planes = await read(target.F), masks = await read(target.Mk);
      for (const rect of rects) {
        await engine.submit(nodes, ctx, rect, {readback: false, target}).done;
        assert.equal(changedOutside(planes, await read(target.F), 7, true, block, rect), 0, `planes after ${JSON.stringify(rect)}`);
        assert.equal(changedOutside(masks, await read(target.Mk), 7, false, block, rect), 0, `masks after ${JSON.stringify(rect)}`);
      }
    } finally { target.destroy(); engine.destroy(); }
    assert.deepEqual(s.errors, []);
  } finally { s.dispose(); }
});
