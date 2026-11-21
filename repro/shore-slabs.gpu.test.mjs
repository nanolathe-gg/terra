import test from 'node:test';
import assert from 'node:assert/strict';
import {openScene} from './headless.mjs';
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
