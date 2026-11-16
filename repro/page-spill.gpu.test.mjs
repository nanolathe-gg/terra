// GPU integration check of the paged fields' spill (sculpt-gpu-fields.js): pages evicted from VRAM come back from their CPU copy with the same
// bytes as pages that never left, and an edit that reaches a page makes it evaluate again. Run with repro/check.sh engine. Needs Dawn.
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';

const scene = JSON.parse(readFileSync(new URL('./shape-scenes/green-landform.json', import.meta.url), 'utf8'));
const digest = arrays => { const h = createHash('sha256'); for (const a of arrays) h.update(new Uint8Array(a.buffer, a.byteOffset, a.byteLength)); return h.digest('hex'); };
async function spillSettled(fields) {
  for (let i = 0; i < 500; i++) { const s = fields.stats().gpuShape.spill; if (!s.inFlight) return s; await new Promise(r => setTimeout(r, 10)); }
  throw new Error('the spill copies did not finish');
}
// Everything a read gives (the planes, the masks, the weathered height) and the gathered weather and maps; with what the read took from the spill and
// how many Time passes it ran. Each read waits for the copies its release started, so the next read finds them.
async function pageBytes(fields, rect) {
  const before = fields.stats().gpuShape, r = await fields.readRect(rect), after = fields.stats().gpuShape;
  await spillSettled(fields);
  const g = await fields.debugGather(rect);
  await spillSettled(fields);
  return {bytes: {shape: digest([...Object.values(r.fields)]), weather: digest([g.W, ...g.maps])},
    restored: [after.spill.shapeRestores - before.spill.shapeRestores, after.spill.weatherRestores - before.spill.weatherRestores], runs: after.weatherRuns - before.weatherRuns};
}

// The resident pages' CPU copies and the coarse lattice are read in the background; letting the fields go while one is read aborts the read
// (heights.gpu.test.mjs).
async function cpuCopiesIdle(fields) {
  for (let i = 0; i < 500; i++) { const g = fields.stats().gpuShape; if (g.cpuCopyBytes >= g.shapePages * 8 * fields.pageInfo().side ** 2) return; await new Promise(r => setTimeout(r, 10)); }
}

test('evicted pages come back from the spill with the bytes of resident pages, and an edit evaluates them again', async () => {
  const headless = await import('./headless.mjs');
  const s = await headless.openScene(scene, 'biome=green&mapX=4&mapY=4&scratch=1&gpuMB=512&heapMB=1536&gpuPages=force');
  const made = [];
  try {
    const {fieldsModule, engine, renderer, config} = s;
    let nodes = s.nodes.slice();
    const common = {worldSize: s.worldSize, worldGrid: s.worldGrid, baseHeight: config.baseHeight, maskKeys: engine.MASK_KEYS, nodes: () => nodes, device: () => renderer.device, context: s.context, gesture: () => false};
    const time = engine.pagedTime({config, renderer, size: s.worldSize, spacing: s.spacing, material: s.material});
    // A keeps no page resident once its readers let go (every page goes to the spill); B keeps them all.
    const A = fieldsModule.createPagedFields({...common, shapeBudget: 1, weatherBudget: 1}), B = fieldsModule.createPagedFields(common);
    made.push(A, B);
    for (const f of [A, B]) { f.changed(); f.setTime(time); }
    const {np, core} = A.pageInfo();
    assert(np >= 3, `the map has ${np} pages a side`);
    const pageRect = (px, py) => ({x0: px * core, y0: py * core, x1: Math.min(s.worldGrid, (px + 1) * core) - 1, y1: Math.min(s.worldGrid, (py + 1) * core) - 1});
    const near = pageRect(0, 0), far = pageRect(np - 1, np - 1);

    const first = {near: await pageBytes(A, near), far: await pageBytes(A, far)};
    const g = A.stats().gpuShape;
    assert.equal(g.shapePages, 0); assert.equal(g.weatherPages, 0);
    assert(g.spill.ready >= 4, `${g.spill.ready} copies ready`);
    assert.deepEqual([first.near.restored, first.near.runs], [[0, 0], 1]);
    const again = await pageBytes(A, near);
    assert.deepEqual([again.restored, again.runs], [[1, 1], 0], 'a restored page runs no shape evaluation or Time pass');
    assert.deepEqual(again.bytes, first.near.bytes);
    const resident = await pageBytes(B, near);
    assert.deepEqual(resident.bytes, first.near.bytes, 'the same bytes as a page that stayed resident');

    // An edit in the near page's corner: its copies are stale. The far page's Time window (moved inside the map at its edge) starts 768 cells
    // before the map's end, beyond the edit, so its copies stay good.
    const [added] = engine.sceneNodes(config, [['landform', [[120, 120], [220, 160]], {card: {diameter: 80, elevation: 160}}]], {ground: false, seed: s.seed, settings: s.settings});
    nodes = [...nodes, added];
    const edit = {x0: 0, y0: 0, x1: Math.floor(480 / s.spacing), y1: Math.floor(480 / s.spacing)};
    assert(edit.x1 + 6 < s.worldGrid - 768, "the edit lies outside the far page's Time window");
    for (const f of [A, B]) f.changed(edit);
    const edited = await pageBytes(A, near);
    assert.deepEqual([edited.restored, edited.runs], [[0, 0], 1], 'an edited page is evaluated and weathered again');
    assert.notEqual(edited.bytes.shape, first.near.bytes.shape, 'the edit shows');
    assert.deepEqual((await pageBytes(B, near)).bytes, edited.bytes);
    const farAgain = await pageBytes(A, far);
    assert.deepEqual([farAgain.restored, farAgain.runs], [[1, 1], 0], 'a page the edit does not reach comes back from its copy');
    assert.deepEqual(farAgain.bytes, first.far.bytes);
    assert.deepEqual((await pageBytes(B, far)).bytes, first.far.bytes);

    // A whole-map change drops every copy.
    A.changed();
    assert.equal(A.stats().gpuShape.spill.entries, 0);
    for (const f of [A, B, s.fields]) await f.coarseSettled();
    await cpuCopiesIdle(B);
    assert.deepEqual(s.errors, []);
  } finally { for (const f of made) f.destroy(); s.dispose(); }
});
