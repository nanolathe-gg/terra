import test from 'node:test';
import assert from 'node:assert/strict';
import {openScene, renderWindow} from './headless.mjs';

test('changing the light leaves the art on a flat dry plain near sea level unchanged', async () => {
  const s = await openScene({biome: 'lush', ground: false, strokes: []},
    'biome=lush&mapX=4&mapY=4&scratch=1&sea=48&plain=2');
  try {
    const window = {x: 320, y: 320, width: 192, height: 192};
    const west = await renderWindow(s, {...window, options: s.drawOptions({light: 'original'})});
    const east = await renderWindow(s, {...window, options: s.drawOptions({light: 'alternate'})});
    assert.ok(west.some((byte, i) => i % 4 !== 3 && byte !== 0), 'the ground is drawn');
    assert.deepEqual(east, west);
    assert.deepEqual(s.errors, []);
  } finally { s.dispose(); }
});
