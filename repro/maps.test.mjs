import test from 'node:test';
import assert from 'node:assert/strict';
import {mapMeta, mapToReopen, byRecent, cleanAddress, startsMap, readTab, writeTab, TAB_KEY, holdMap, mapsInUse, importLegacyMaps, LEGACY_KEYS} from '../sculpt-maps.js';

const memory = () => { const m = new Map(); return {m, getItem: k => m.has(k) ? m.get(k) : null, setItem: (k, v) => m.set(k, String(v)), removeItem: k => m.delete(k)}; };
const sketch = (name, biome = 'green', world = biome) => ({format: 'nanolathe-terrain-sculpt', version: 6, biome, world, map: {unitsX: 4, unitsY: 2}, mapData: {name}, nodes: [{kind: 'ground'}, {kind: 'landform'}, {kind: 'landform'}]});

test('a map is listed by its name, world, size and stroke count', () => {
  assert.deepEqual(mapMeta('a', sketch(' Ridge ', 'desert', 'mine'), 5), {id: 'a', updated: 5, name: 'Ridge', biome: 'desert', world: 'mine', unitsX: 4, unitsY: 2, strokes: 2});
  assert.equal(mapMeta('b', {}).name, 'Untitled map');
});

test('a new tab reopens the map edited last, unless another tab has it', () => {
  const list = [{id: 'old', updated: 1}, {id: 'new', updated: 3}, {id: 'mid', updated: 2}];
  assert.deepEqual(byRecent(list).map(m => m.id), ['new', 'mid', 'old']);
  assert.equal(mapToReopen(list, new Set()), 'new');
  assert.equal(mapToReopen(list, new Set(['new'])), null);   // the picker asks; an older map is not opened in its place
  assert.equal(mapToReopen([], new Set()), null);
});

test('the editor reloads to an address with only the diagnostic switches', () => {
  assert.equal(cleanAddress('https://x.test/?biome=desert&mapX=2&gpuMB=512&map=abc&faceSteep=3&scratch=1#h'), 'https://x.test/?gpuMB=512');
  assert.equal(cleanAddress('https://x.test/'), 'https://x.test/');
  assert.equal(startsMap(new URLSearchParams('gpuMB=512')), false);
  assert.equal(startsMap(new URLSearchParams('biome=green')), true);
});

test('the tab remembers its map and a one-use handoff', () => {
  const s = memory();
  assert.deepEqual(readTab(s), {map: null, next: null});
  assert.ok(writeTab(s, {map: 'a', next: {biome: 'desert'}}));
  assert.deepEqual(readTab(s), {map: 'a', next: {biome: 'desert'}});
  assert.ok(writeTab(s, {map: 'a'}));
  assert.deepEqual(JSON.parse(s.getItem(TAB_KEY)), {map: 'a'});
  s.setItem(TAB_KEY, '{bad'); assert.deepEqual(readTab(s), {map: null, next: null});
  assert.deepEqual(readTab(null), {map: null, next: null});
  assert.equal(writeTab({setItem() { throw new Error('blocked'); }}, {map: 'a'}), false);
});

test('a map held by one tab is in use for another', async () => {
  const held = new Set();
  const locks = {
    request: async (name, options, cb) => { if (held.has(name)) return cb(null); held.add(name); await cb({name}); held.delete(name); },
    query: async () => ({held: [...held].map(name => ({name})).concat([{name: 'other-lock'}])}),
  };
  const release = await holdMap('a', locks);
  assert.equal(typeof release, 'function');
  assert.equal(await holdMap('a', locks), null);
  assert.deepEqual([...await mapsInUse(locks)], ['a']);
  release(); await new Promise(r => setTimeout(r));
  assert.deepEqual([...await mapsInUse(locks)], []);
  assert.equal(typeof await holdMap('a', null), 'function');   // no Web Locks: every map counts as free
  assert.deepEqual([...await mapsInUse(null)], []);
});

test('the old working copy and previous slot move once into an empty list', async () => {
  const bodies = new Map(), meta = new Map();
  const store = {list: async () => [...meta.values()], put: async (id, s, m) => { bodies.set(id, s); meta.set(id, m); }};
  const storage = memory();
  storage.setItem(LEGACY_KEYS[0], JSON.stringify(sketch('Working')));
  storage.setItem(LEGACY_KEYS[1], JSON.stringify(sketch('Previous')));
  assert.equal(await importLegacyMaps(store, storage, 100), 2);
  assert.deepEqual(byRecent([...meta.values()]).map(m => m.name), ['Working', 'Previous']);
  assert.equal(storage.m.size, 0);
  storage.setItem(LEGACY_KEYS[0], JSON.stringify(sketch('Later')));
  assert.equal(await importLegacyMaps(store, storage), 0);   // a list with maps imports nothing
  const empty = {list: async () => [], put: async () => { throw new Error('no'); }}, junk = memory();
  junk.setItem(LEGACY_KEYS[0], 'not json');
  assert.equal(await importLegacyMaps(empty, junk), 0);
  assert.equal(junk.m.size, 0);
});
