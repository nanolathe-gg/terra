// The voxel pass's height bounds are sea-relative, like the shader's heights: a high sea leaves the room above it as it was. A mountain 300
// above a sea at 255 (heightReference 1, from the sea) once threw "Terrain extends beyond the voxel projection bounds".
// Run with repro/check.sh engine, or node --test repro/voxel-bounds.gpu.test.mjs.
import test from 'node:test';
import assert from 'node:assert/strict';
import {openScene, renderWindow, weather} from './headless.mjs';

const mountain = ['landform', [[300, 500], [482, 636], [700, 700]], {
  card: {diameter: 200, elevation: 300, heightReference: 1, lean: 100, facing: 3, cracks: 60, wander: 8, widthVary: 0, heightVary: 10, varySize: 80, varyFoot: 100, varyMiddle: 100, gullies: 40, gullySize: 50, talus: 60},
  curve: {form: 'lfMountain', knots: [[0, 0], [0.12, 0.01], [0.25, 0.05], [0.4, 0.2], [0.55, 0.45], [0.7, 0.68], [0.85, 0.88], [1, 1]]}}];

test('a mountain 300 above a sea at 255 renders', async () => {
  const s = await openScene({biome: 'green', ground: true, strokes: [mountain]}, 'biome=green&mapX=2&mapY=2&sea=255&scratch=1&gpuMB=512');
  try {
    await weather(s);
    const pixels = await renderWindow(s, {x: 128, y: 256, width: 768, height: 512});
    let lit = 0; for (let i = 0; i < pixels.length; i += 4) if (pixels[i] || pixels[i + 1] || pixels[i + 2]) lit++;
    assert.ok(lit > pixels.length / 8, `the window is drawn (${lit} lit pixels)`);
    assert.deepEqual(s.errors, []);
  } finally { s.dispose(); }
});
