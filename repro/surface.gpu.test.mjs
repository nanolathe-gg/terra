// Surface layers on the GPU (docs/SURFACE_LAYERS.md): a rule limits a built-in, a material layer draws its material where its rule holds,
// and a material layer whose material the map lacks draws nothing. Each case edits Green's config in a dumped folder before its scene opens.
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync, writeFileSync} from 'node:fs';
import {join} from 'node:path';
import {openHost, openScene, renderWindow, dumpConfigs} from './headless.mjs';

const configs = dumpConfigs(), file = join(configs, 'config', 'green.json'), original = readFileSync(file, 'utf8');
const withSurface = edit => { const c = JSON.parse(original); c.surface = edit(c.surface); writeFileSync(file, JSON.stringify(c)); };
// A raised mesa beside level ground: rock on its faces, high ground on its top.
const scene = {biome: 'green', ground: true, query: '', strokes: [['landform', [[180, 256], [330, 256]], {card: {diameter: 230, elevation: 160}}]]};
const changed = (a, b) => { let n = 0; for (let i = 0; i < a.length; i += 4) if (a[i] !== b[i] || a[i + 1] !== b[i + 1] || a[i + 2] !== b[i + 2]) n++; return n / (a.length / 4); };
const view = async () => { const s = await openScene(scene, 'biome=green&mapX=4&mapY=4'); try { await s.fields.ready(); return {pixels: await renderWindow(s, {x: 0, y: 0, width: 512, height: 512}), errors: s.errors}; } finally { s.dispose(); } };

test('surface layers: a rule limits a built-in; a material layer draws where its rule holds; a missing material draws nothing', {timeout: 600000}, async () => {
  await openHost({configs});
  try {
    withSurface(s => s);
    const base = await view();
    assert.deepEqual(base.errors, []);
    withSurface(s => s.map(l => l.builtin === 'rock' ? {...l, where: [{fact: 'slope', from: 9, fade: .1}]} : l));
    const noRock = await view();
    assert.ok(changed(base.pixels, noRock.pixels) > .01, 'a window no slope reaches takes the rock away');
    withSurface(s => [...s, {id: 'cap', name: 'Cap', material: 'ice-ground', stage: 'snow', where: [{fact: 'abovePlain', from: 20, fade: 4}]}]);
    const capped = await view();
    const share = changed(base.pixels, capped.pixels);
    assert.ok(share > .03 && share < .6, `the cap covers the mesa's top and nothing else (${(share * 100).toFixed(1)}%)`);
    withSurface(s => [...s, {id: 'ghost', name: 'Ghost', material: 'no-such-material', where: [{fact: 'slope', from: -1}]}]);
    const ghost = await view();
    assert.equal(changed(base.pixels, ghost.pixels), 0, 'a layer whose material the map lacks draws nothing');
  } finally { writeFileSync(file, original); }
});
