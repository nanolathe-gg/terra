import test from 'node:test';
import assert from 'node:assert/strict';
import {openScene} from './headless.mjs';
import {erosionOf} from '../sculpt-erosion.js';

// A painted erosion override below zero must keep its sign and byte position,
// both when the solver reads authored masks and when it runs on coarser cells.
test('the negative erosion override protects a slope at both solver resolutions', async () => {
  const s = await openScene({biome: 'green', strokes: [], ground: false}, 'biome=green&mapX=1&mapY=1');
  const d = s.renderer.device, grid = 65, cells = grid * grid;
  const usage = GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST | GPUBufferUsage.COPY_SRC;
  const planes = d.createBuffer({size: cells * 8, usage}), masks = d.createBuffer({size: cells * 28, usage});
  try {
    const heights = new Float32Array(cells * 2);
    for (let i = 0; i < cells; i++) heights[i] = 120 + 2 * (i % grid);
    d.queue.writeBuffer(planes, 0, heights);
    const rateMask = s.engine.MASK_KEYS.indexOf('ovErosion'), paint = new Int8Array(cells * 28);
    const erosion = await erosionOf(s.renderer);
    for (const spacing of [2, 4]) {
      for (const override of [-127, 0]) {
        paint.fill(63);
        for (let i = 0; i < cells; i++) paint[i * 28 + rateMask] = override;
        d.queue.writeBuffer(masks, 0, paint);
        const result = await erosion.runGpu({...s.engine.timeKnobs(s.renderer), planes, masks, rateMask,
          grid, spacing, size: (grid - 1) * spacing + 1, seaLevel: 75, age: 32, rain: 1});
        try {
          const refined = new Float32Array(await s.fieldsModule.readBuffer(d, result.weather, cells * 4, cells * 4));
          assert.equal(refined.some((h, i) => h !== heights[i]), override === 0,
            `spacing ${spacing}, override ${override}`);
        } finally {
          result.weather.destroy();
          result.maps.forEach(b => b.destroy());
        }
      }
    }
    assert.deepEqual(s.errors, []);
  } finally {
    planes.destroy(); masks.destroy(); s.dispose();
  }
});
