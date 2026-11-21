import test from 'node:test';
import assert from 'node:assert/strict';
import {openScene} from './headless.mjs';

test('submerged rock slabs keep the authored shelf depth while marking the bed', async t => {
  const shore = shorePlates => ['shallow', [[100, 300], [420, 300]], {card: {
    shorePlates, plateMaterial: 1, plateWaterPx: 110, plateLandPx: 32, plateHeight: 12,
    diameter: 300, elevation: -9, wander: 0, widthVary: 0, heightVary: 0,
  }}];
  const s = await openScene({biome: 'crystal', ground: false, strokes: [shore(0)]},
    'biome=crystal&scratch=1&mapX=1&mapY=1&sea=65&plain=20');
  try {
    const rect = {x0: 0, y0: 0, x1: s.worldGrid - 1, y1: s.worldGrid - 1};
    await s.fields.ready();
    const bare = s.fields.readCells(rect).fields;
    s.play([shore(1)], {ground: false});
    await s.fields.ready();
    const slabs = s.fields.readCells(rect).fields;
    const sea = s.config.seaLevel;
    let markedShelf = 0, liftedBank = 0;
    for (let i = 0; i < bare.h.length; i++) {
      if (bare.h[i] <= sea) {
        assert.equal(slabs.h[i], bare.h[i], `wet cell ${i}`);
        if (Math.abs(bare.h[i] - (sea - 9)) < 0.01 && slabs.x[i] > bare.x[i]) markedShelf++;
      } else if (slabs.h[i] > bare.h[i]) {
        liftedBank++;
      }
    }
    assert.ok(markedShelf > 100, `${markedShelf} marked cells at the authored depth`);
    assert.ok(liftedBank > 100, `${liftedBank} dry cells lifted`);
    t.diagnostic(`${markedShelf} shelf cells marked at depth 9, ${liftedBank} dry cells lifted`);
    assert.deepEqual(s.errors, []);
  } finally {
    s.dispose();
  }
});
