// The feature pack an export writes (sculpt-features.js featurePack), made under Node: the page and its feature worker are stand-ins, the
// generator and the pack are the editor's own. Run with repro/check.sh features.
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {generateFeature} from '../sculpt-feature-gen.js';
import {variants} from '../sculpt-feature-set.js';

const palette = JSON.parse(readFileSync(new URL('../materials/palette.json', import.meta.url))).indexed;
// The feature worker's 'full' job (sculpt-feature-worker.js), answered on this thread.
class FeatureWorker {
  postMessage(data) {
    queueMicrotask(() => {
      const plain = s => s && {w: s.w, h: s.h, ax: s.ax, ay: s.ay, idx: s.idx, a: s.a};
      let out;
      try {
        if (data.type !== 'full') throw new Error('unexpected job ' + data.type);
        const f = generateFeature(data.kind, data.params, data.seed, {light: data.light, tint: data.light?.tint, palette});
        out = {id: data.id, body: plain(f.body), shadow: plain(f.shadow), burn: f.burn?.map(plain) ?? null, bodyBlend: f.bodyBlend, gameplay: f.gameplay,
          burnt: f.burnt && {body: plain(f.burnt.body), shadow: plain(f.burnt.shadow), gameplay: f.burnt.gameplay}};
      } catch (error) { out = {id: data.id, error: String(error?.message || error)}; }
      this.onmessage({data: out});
    });
  }
  terminate() {}
}
// A page element that takes whatever the panel sets on it.
function element() {
  const e = {dataset: {}, style: {}, options: [], children: [], value: '', textContent: '', title: '', hidden: false, disabled: false, step: '1'};
  return Object.assign(e, {replaceChildren(...c) { e.children = c; }, append() {}, setAttribute() {}, getAttribute() { return null; }, addEventListener() {},
    closest() { return null; }, querySelector() { return null; }, querySelectorAll() { return []; }, focus() {}, click() {}});
}
async function mount(world) {
  const elements = new Map();
  globalThis.document = {getElementById: id => { if (!elements.has(id)) elements.set(id, element()); return elements.get(id); }, querySelector: () => element(),
    querySelectorAll: () => [], createElement: () => element(), addEventListener() {}, dispatchEvent() {}, activeElement: null};
  globalThis.Worker = FeatureWorker;
  globalThis.requestAnimationFrame ??= f => setTimeout(f, 0);
  const {mountMapFeatures} = await import('../sculpt-features.js');
  const data = JSON.parse(readFileSync(new URL(`../materials/${world}.json`, import.meta.url)));
  const widthCells = 4 * 32 + 2, heightCells = 4 * 32 + 8;
  const map = {unitsX: 4, unitsY: 4, widthCells, heightCells, width: widthCells * 16, height: heightCells * 16, playRight: 4 * 512, playBottom: 4 * 512};
  const config = {biome: world, biomeId: world, map, baseHeight: 128, seaLevel: 64, features: data.features, featureCatalog: []};
  const canvas = {ownerDocument: globalThis.document, addEventListener() {}, hasPointerCapture() { return false; }, style: {}};
  const features = await mountMapFeatures({config, canvas, sample: () => 100, enabled: () => true, change() {}, schedule() {}, light: () => [-0.5, -0.5, 0.7071], pick: (x, z) => [x, z]});
  return {features, config, map};
}

test('a scar exports translucent exactly when the editor draws it translucent', async () => {
  for (const world of ['archipelago', 'green']) {
    const {features, config, map} = await mount(world);
    const set = features.serialize().featureSet, scars = variants('scar', set, config);
    assert.ok(scars.length, `${world} has scars`);
    scars.forEach((v, i) => assert.ok(features.addFeature('scar', 6 + i * 22, 6, {v: v.index}), `${world} scar ${v.index + 1} placed`));
    const heights = new Uint8Array(map.widthCells * map.heightCells).fill(100);
    const {pack, placements} = await features.exportFeatures({name: 'Scar test', heights, width: map.widthCells, bakeArt: async rect => ({data: new Uint8ClampedArray(rect.width * rect.height * 4)})});
    const defs = new Map(pack.defs.map(d => [d.name, Object.fromEntries(d.keys)]));
    const names = [...new Set(placements.map(p => p.name))];
    assert.equal(names.length, scars.length);
    for (const v of scars) {
      const drawn = generateFeature('scar', v.params, v.seed, {palette, bodyOnly: true}).bodyBlend;
      const def = defs.get(names.find(n => n.endsWith(`Scar${v.index + 1}`)));
      assert.equal(def.animtrans, drawn < 1 ? '1' : '0', `${world} scar ${v.index + 1} (${v.params.type}): drawn at ${drawn}, exported animtrans ${def.animtrans}`);
    }
  }
});
