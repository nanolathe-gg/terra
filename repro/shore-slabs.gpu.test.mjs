import test from 'node:test';
import assert from 'node:assert/strict';
import {openScene, renderWindow} from './headless.mjs';
import {cellHeights} from '../sculpt-map.js';

const query = 'biome=crystal&scratch=1&mapX=1&mapY=1&sea=65&plain=20&erosion=0';
const shore = (card = {}, kind = 'shallow') => [kind, [[100, 300], [420, 300]], {card: {
  shorePlates: 1, plateMaterial: 1, plateWaterPx: 100, plateLandPx: 42, plateSize: 40,
  plateHeight: 0, plateSteps: 0, plateVary: 55, diameter: 340, elevation: -9,
  wander: 0, widthVary: 0, heightVary: 0, ...card,
}}];
const open = (strokes, extra = '') => openScene({biome: 'crystal', ground: false, strokes}, query + extra);
const exportHeights = async s => (await cellHeights(s.config.map, async request => {
  await s.fields.ready();
  return s.fields.read(request);
})).heights;

test('shore slabs make physical relief on flat and sloping beds', async t => {
  for (const [kind, elevation] of [['shallow', -9], ['deep', -48]]) {
    const stroke = card => shore({elevation, ...card}, kind);
    const s = await open([stroke({shorePlates: 0})]);
    try {
      const bare = await exportHeights(s);
      s.play([stroke({plateSteps: 4})], {ground: false});
      assert.deepEqual(await exportHeights(s), bare, 'zero Plate height preserves the authored bed');
      const rect = {x0: 0, y0: 0, x1: s.worldGrid - 1, y1: s.worldGrid - 1};
      const flat = s.fields.readCells(rect).fields;
      assert.ok(flat.shoreSlab.some(x => x === 127), 'slabs still mark a bed at zero relief');

      s.play([stroke({plateHeight: 110, plateSteps: 4})], {ground: false});
      const stepped = await exportHeights(s);
      let wet = 0, dry = 0, crossed = 0;
      for (let i = 0; i < bare.length; i++) {
        if (stepped[i] === bare[i]) continue;
        if (bare[i] < 65) wet++;
        if (bare[i] > 65) dry++;
        if (bare[i] < 65 && stepped[i] > 65 || bare[i] > 65 && stepped[i] < 65) crossed++;
      }
      assert.ok(wet > 12 && dry > 6, `${wet} wet and ${dry} dry export corners moved on ${kind}`);
      assert.equal(crossed, 0, 'slab relief keeps the dry and wet sides of the waterline');
      s.play([stroke({plateHeight: 110, plateSteps: 0})], {ground: false});
      const columns = await exportHeights(s);
      const movedBySteps = stepped.reduce((count, h, i) => count + Number(h !== columns[i]), 0);
      assert.ok(movedBySteps > 8, `${movedBySteps} export corners moved when changing just Slab steps`);
      t.diagnostic(`${kind}: ${wet} wet, ${dry} dry and ${movedBySteps} step-dependent export corners`);
      assert.deepEqual(s.errors, []);
    } finally {
      s.dispose();
    }
  }
});

test('at the same depth, the packed color pass shows the bed only at physical slabs', async () => {
  const stroke = shore({plateWaterPx: 75, plateLandPx: 0, diameter: 380});
  const empty = shore({shorePlates: 0, diameter: 380});
  const window = {x: 192, y: 222, width: 128, height: 160};
  const s = await open([empty], '&slabShallows=1&crystalSeam=0&shallowDepth=0&deepDepth=10');
  try {
    const unmarked = await renderWindow(s, window);
    const bareHeights = await exportHeights(s);
    s.play([stroke], {ground: false});
    const covered = await renderWindow(s, window);
    assert.deepEqual(await exportHeights(s), bareHeights);
    const difference = y => {
      let count = 0;
      for (let x = 12; x < window.width - 12; x++) {
        const at = 4 * (y * window.width + x);
        if (unmarked[at] !== covered[at] || unmarked[at + 1] !== covered[at + 1] || unmarked[at + 2] !== covered[at + 2]) count++;
      }
      return count;
    };
    const upperShelf = Array.from({length: 25}, (_, i) => difference(17 + i)).reduce((a,b) => a+b);
    const center = Array.from({length: 12}, (_, i) => difference(74 + i)).reduce((a,b) => a+b);
    assert.ok(upperShelf > 300, `${upperShelf} changed pixels over the owned shelf`);
    assert.equal(center, 0, 'the equal-depth bed outside the band still shows only open water');
    const rect = {x0: 0, y0: 0, x1: s.worldGrid - 1, y1: s.worldGrid - 1};
    const originalMask = s.fields.readCells(rect).fields.shoreSlab;
    const cutter = ['deep', [[240, 235], [300, 235]], {card: {
      diameter: 92, elevation: -40, wander: 0, widthVary: 0, heightVary: 0, shorePlates: 0, combine: 1,
    }}];
    s.play([stroke, ['deep', cutter[1], {card: {...cutter[2].card, elevation: 8, diameter: 40}}]], {ground: false});
    await s.fields.ready();
    assert.deepEqual(s.fields.readCells(rect).fields.shoreSlab, originalMask, 'an ineffective cut keeps the slab marks');
    s.play([stroke, cutter], {ground: false});
    await s.fields.ready();
    const cutMask = s.fields.readCells(rect).fields.shoreSlab;
    assert.ok(originalMask.some((v, i) => v === 127 && cutMask[i] === 0), 'replaced terrain loses its slab mark');
    assert.deepEqual(s.errors, []);
  } finally {
    s.dispose();
  }
});
