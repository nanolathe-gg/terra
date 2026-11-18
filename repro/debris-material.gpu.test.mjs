// The world's Debris material (Materials › debris, sculpt-materials.js worldDebris) draws the debris rock weather lays at a cliff's foot
// (engine-frag.wgsl): another Debris material changes the picture where debris lies and nowhere else, and changes nothing where there is none.
// Each case edits Green's config in a dumped folder before its scene opens. Run with repro/check.sh engine. Needs Dawn.
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync, writeFileSync} from 'node:fs';
import {join} from 'node:path';
import {openHost, openScene, weather, renderWindow, knob, column, dumpConfigs} from './headless.mjs';
import {ROCK_PRESETS} from '../sculpt-rock-presets.js';

const configs = dumpConfigs(), file = join(configs, 'config', 'green.json'), original = readFileSync(file, 'utf8');
const withDebris = key => { const c = JSON.parse(original); c.materials.debris = key; writeFileSync(file, JSON.stringify(c)); };
// A sandstone escarpment whose faces shed debris over the plain below (repro/rock-weathering.mjs's fixture).
const scene = {biome: 'green', ground: true, strokes: [['landform', [[50, 450], [350, 440], [700, 470], [1000, 450]], {card: {diameter: 500, elevation: 210, lean: 180, roughness: 0, softness: 10, wander: 25, widthVary: 8, heightVary: 5, cracks: 20, terraces: 0, styleVegetation: 0}}]]};
const rect = {x: 256, y: 260, width: 512, height: 512, tile: 256};
async function view(debris) {
  const s = await openScene(scene, 'biome=green&mapX=4&mapY=4&erosion=0&scratch=debris-material');
  try {
    await weather(s);
    for (const [k, v] of Object.entries(ROCK_PRESETS.sandstone.knobs)) await knob(s, k, v);
    await column(s, {...s.worldColumn.column, sections: ROCK_PRESETS.sandstone.sections, variants: {}});
    for (const [k, v] of Object.entries({runoff: .8, debrisAmount: debris ? 1.1 : 0, debrisReach: 80, debrisDepth: 5, looseSupply: 0})) await knob(s, k, v);
    return {pixels: await renderWindow(s, rect), errors: s.errors};
  } finally { s.dispose(); }
}
const differ = (a, b) => Array.from({length: a.length / 4}, (_, i) => [0, 1, 2].some(c => a[i * 4 + c] !== b[i * 4 + c]));

test('the Debris material draws where debris lies, and only there', {timeout: 600000}, async () => {
  await openHost({configs});
  try {
    withDebris('green-debris');
    const own = await view(true), bare = await view(false);
    withDebris('red-ground');
    const other = await view(true), otherBare = await view(false);
    for (const v of [own, bare, other, otherBare]) assert.deepEqual(v.errors, []);
    const footprint = differ(own.pixels, bare.pixels), moved = differ(own.pixels, other.pixels), W = rect.width;
    // Where debris lies: the pixels it changes, and those within 3 px (a debris pixel can draw as the ground did by chance, among ones that do not).
    const near = footprint.map((_, i) => { const x = i % W, y = (i - x) / W; for (let dy = -3; dy <= 3; dy++) for (let dx = -3; dx <= 3; dx++) { const X = x + dx, Y = y + dy; if (X >= 0 && Y >= 0 && X < W && Y < W && footprint[Y * W + X]) return true; } return false; });
    const lies = footprint.filter(Boolean).length, changed = moved.filter(Boolean).length, outside = moved.filter((m, i) => m && !near[i]).length;
    assert.ok(lies > 2000, `the fixture lays debris (${lies} pixels)`);
    assert.ok(changed > lies * .2, `another Debris material changes the debris (${changed} of its ${lies} pixels)`);
    assert.equal(outside, 0, `and nothing away from it (${outside} pixels more than 3 px from the debris)`);
    assert.equal(differ(bare.pixels, otherBare.pixels).filter(Boolean).length, 0, 'without debris the Debris material changes nothing');
  } finally { writeFileSync(file, original); }
});
