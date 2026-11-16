// Surface layers on the GPU (docs/SURFACE_LAYERS.md): a rule limits a built-in, a material layer draws its material where its rule holds,
// and a material layer whose material the map lacks draws nothing. Each case edits Green's config in a dumped folder before its scene opens.
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync, writeFileSync} from 'node:fs';
import {join} from 'node:path';
import {openHost, openScene, renderWindow, dumpConfigs} from './headless.mjs';
import {surfaceRows} from '../sculpt-material-model.js';

const configs = dumpConfigs(), file = join(configs, 'config', 'green.json'), original = readFileSync(file, 'utf8');
const withSurface = edit => { const c = JSON.parse(original); c.surface = edit(c.surface); writeFileSync(file, JSON.stringify(c)); };
// A raised mesa beside level ground: rock on its faces, high ground on its top.
const scene = {biome: 'green', ground: true, query: '', strokes: [['landform', [[180, 256], [330, 256]], {card: {diameter: 230, elevation: 160}}]]};
const changed = (a, b) => { let n = 0; for (let i = 0; i < a.length; i += 4) if (a[i] !== b[i] || a[i + 1] !== b[i + 1] || a[i + 2] !== b[i + 2]) n++; return n / (a.length / 4); };
const view = async (extra = '') => { const s = await openScene(scene, 'biome=green&mapX=4&mapY=4' + extra); try { await s.fields.ready(); return {pixels: await renderWindow(s, {x: 0, y: 0, width: 512, height: 512}), errors: s.errors}; } finally { s.dispose(); } };

test('surface layers: a rule limits a built-in; a material layer draws where its rule holds; an engine-colored built-in draws a material; amount is coverage; the inspector reads a pixel; a missing material draws nothing', {timeout: 600000}, async () => {
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
    // The inspector (renderer.setProbe, readProbe): at a pixel the cap took, the draw records the cap last, its coverage, and the pixel's color.
    let at = -1; for (let i = 0; i < capped.pixels.length; i += 4) if (capped.pixels[i] !== base.pixels[i] && capped.pixels[i + 4] !== base.pixels[i + 4] && capped.pixels[i - 4] !== base.pixels[i - 4]) { at = i / 4; break; }
    const px = at % 512, py = Math.floor(at / 512), probed = await openScene(scene, 'biome=green&mapX=4&mapY=4');
    let read;
    try { await probed.fields.ready(); probed.renderer.setProbe({x: px, y: py}); await renderWindow(probed, {x: 0, y: 0, width: 512, height: 512}); read = await probed.renderer.readProbe(); } finally { probed.dispose(); }
    assert.ok(read, 'the draw recorded the inspected pixel');
    const rows = surfaceRows(JSON.parse(readFileSync(file, 'utf8')).surface).layerRows;
    assert.equal(read.layers.at(-1).row, rows.at(-1), 'the cap is the last layer drawn there');
    assert.ok(read.layers.at(-1).cover > .5, `the cap covers it (${read.layers.at(-1).cover})`);
    // The draw ends in true color; the output stage (engine-output.wgsl) reduces it to the palette after, so the record is the pixel's color
    // with the palette off.
    const lit = await view('&palette=off');
    for (let k = 0; k < 3; k++) assert.ok(Math.abs(read.color[k] * 255 - lit.pixels[at * 4 + k]) <= 1, 'the recorded color is the pixel’s lit color');
    withSurface(s => [...s, {id: 'cap', name: 'Cap', material: 'ice-ground', stage: 'snow', where: [{fact: 'abovePlain', from: 20, fade: 4}], edge: {height: 1}}]);
    const lifted = await view();
    assert.ok(changed(capped.pixels, lifted.pixels) > 0, 'height contrast moves the cap’s edge');
    // Bare soil (where the cover thins, soilRim) drawn with a library material in place of the soil color.
    withSurface(s => s);
    const plainLit = (await view('&palette=off')).pixels;   // coverage below is counted in true color: the palette's diffusion moves a tile's other pixels
    const soil = await view('&soilRim=1');
    withSurface(s => s.map(l => l.builtin === 'soil' ? {...l, material: 'red-ground'} : l));
    const swapped = changed(soil.pixels, (await view('&soilRim=1')).pixels);
    assert.ok(swapped > .002 && swapped < .6, `the soil draws its material where the soil lies (${(swapped * 100).toFixed(2)}%)`);
    // Coverage (amount): a partial amount covers about that share of the area, each covered pixel as the full layer draws it.
    const everywhere = amount => withSurface(s => [...s, {id: 'all', name: 'All', material: 'ice-ground', stage: 'snow', amount, edge: {noiseSize: 1}}]);
    everywhere(1);
    const full = (await view('&palette=off')).pixels;
    everywhere(.3);
    const part = (await view('&palette=off')).pixels;
    let covered = 0, same = 0;
    for (let i = 0; i < part.length; i += 4) {
      if (part[i] === plainLit[i] && part[i + 1] === plainLit[i + 1] && part[i + 2] === plainLit[i + 2]) continue;
      covered++;
      if (part[i] === full[i] && part[i + 1] === full[i + 1] && part[i + 2] === full[i + 2]) same++;
    }
    const fraction = covered / (part.length / 4);
    assert.ok(fraction > .25 && fraction < .35, `amount .3 covers about 30% of the map (${(fraction * 100).toFixed(1)}%)`);
    assert.ok(same / covered > .95, `a covered pixel is the full layer’s color, not a blend (${(same / covered * 100).toFixed(1)}%)`);
    withSurface(s => [...s, {id: 'ghost', name: 'Ghost', material: 'no-such-material', where: [{fact: 'slope', from: -1}]}]);
    const ghost = await view();
    assert.equal(changed(base.pixels, ghost.pixels), 0, 'a layer whose material the map lacks draws nothing');
  } finally { writeFileSync(file, original); }
});
