// The top bar's Find: matching, ranking and everyday words (sculpt-find.js). The index itself is read from the page; these entries
// stand in for it.
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {SYNONYMS, ACTIONS, normalize, words, stem, expand, score, search} from '../sculpt-find.js';

const entry = (name, more = {}) => ({group: 'World', path: [], words: '', note: '', ...more, name});
const names = groups => groups.flatMap(g => g.items.map(e => e.name));

test('words are compared in plain form', () => {
  assert.deepEqual(words('Cliffs & stones'), ['cliffs', 'and', 'stones']);
  assert.deepEqual(words('faceBlockSize'), ['face', 'block', 'size']);
  assert.equal(normalize('  Café, “Shallow”  water… '), 'cafe shallow water');
  assert.deepEqual(words(''), []);
});

test('plurals meet their singulars', () => {
  assert.equal(stem('gullies'), 'gully');
  assert.equal(stem('beaches'), 'beach');
  assert.equal(stem('colors'), 'color');
  assert.equal(stem('grass'), 'grass');
  assert.equal(stem('moss'), 'moss');
  assert.ok(score(entry('Gully size'), 'gullies') > 0);
  assert.ok(score(entry('Tree'), 'trees') > 0);
});

test('a word matches the start of a word, not its middle', () => {
  assert.ok(score(entry('Gullies'), 'gull') > 0);
  assert.ok(score(entry('Rain'), 'rain') > 0);
  assert.equal(score(entry('Terrain shape'), 'rain'), 0);
});

test('every word of the query must match somewhere', () => {
  assert.ok(score(entry('Sun color', {kind: 'color'}), 'sun color') > 0);
  assert.equal(score(entry('Sun height'), 'sun color'), 0);
  assert.ok(score(entry('Color', {path: ['World', 'Water & shores']}), 'water color') > 0);
});

test('a name counts more than its kind words, its path or its note', () => {
  const list = [entry('Runoff', {note: 'Water drawn down the face in grooves'}), entry('Bed slot 1', {words: 'color'}), entry('Color variation'), entry('Strength', {path: ['World', 'Colors']})];
  assert.deepEqual(names(search(list, 'color')), ['Color variation', 'Bed slot 1', 'Strength']);
  assert.deepEqual(names(search(list, 'grooves')), ['Runoff']);
});

test('an exact name comes first, then a name that starts with the query', () => {
  const list = [entry('Snow on level caps'), entry('Painted snow'), entry('Snow')];
  assert.deepEqual(names(search(list, 'snow')), ['Snow', 'Snow on level caps', 'Painted snow']);
});

test('an everyday word finds the editor’s words, below a direct match', () => {
  const list = [entry('Size'), entry('Gullies', {group: 'Shape card', path: ['Shape card', 'Details', 'Gullies']}), entry('Runoff exposure'), entry('Rain'), entry('Drain the lake')];
  const found = names(search(list, 'drain'));
  assert.deepEqual(found.slice().sort(), ['Drain the lake', 'Gullies', 'Rain', 'Runoff exposure']);
  assert.equal(found[0], 'Drain the lake');
  const [gullies, runoff, rain] = ['Gullies', 'Runoff exposure', 'Rain'].map(name => score(list.find(e => e.name === name), 'drain'));
  assert.ok(gullies > runoff && runoff > rain, 'the first word on the right ranks highest');
  assert.equal(score(entry('Talus reach', {path: ['Shape card', 'Details', 'Gullies'], note: 'Rock fallen from the gullies'}), 'drain'), 0, 'a synonym looks at names and kind words only');
  assert.ok(score(entry('Tree', {group: 'Features'}), 'forest') > 0);
  assert.ok(score(entry('Sun color'), 'darker') > 0);
  assert.ok(score(entry('Fit'), 'zoom') > 0);
});

test('expanding works while a long enough word is being typed', () => {
  assert.ok(expand('drain').includes('gully'));
  assert.ok(expand('drai').includes('gully'));
  assert.deepEqual(expand('dr'), []);
  assert.deepEqual(expand('gullies'), []);
});

test('a path that agrees with the name ranks a row first; a bias moves an entry down', () => {
  const list = [entry('Block size', {path: ['World', 'Rock types', 'Cracks & bands']}), entry('Block size', {path: ['World', 'Rock types', 'Blocks & joints'], note: 'joints'}),
    entry('Moss in damp shade', {group: 'Surface layers', bias: -4}), entry('Painted moss', {group: 'Surface layers'})];
  assert.equal(search(list, 'block')[0].items[0].note, 'joints');
  assert.deepEqual(names(search(list, 'moss')), ['Painted moss', 'Moss in damp shade']);
});

test('an unavailable row is still found, after an equal one that is available', () => {
  const list = [entry('Gloss', {unavailable: true, reason: 'Enable Shine to use this setting.'}), entry('Gloss')];
  const found = search(list, 'gloss')[0].items;
  assert.equal(found.length, 2);
  assert.equal(found[0].unavailable, undefined);
  assert.equal(found[1].reason, 'Enable Shine to use this setting.');
});

test('results group by where they live, the best group first, up to the limit', () => {
  const list = [entry('Moss in damp shade', {group: 'Surface layers'}), entry('Water material', {note: 'Green moss'}), entry('Moss', {group: 'Surface layers'}), entry('Green moss', {group: 'Materials'})];
  const groups = search(list, 'moss');
  assert.deepEqual(groups.map(g => g.group), ['Surface layers', 'Materials', 'World']);
  assert.deepEqual(groups[0].items.map(e => e.name), ['Moss', 'Moss in damp shade']);
  assert.equal(names(search(list, 'moss', 2)).length, 2);
  assert.deepEqual(search(list, '   '), []);
});

test('the word list is plain data: words on both sides, each everyday word once', () => {
  const seen = new Set();
  for (const [from, to] of SYNONYMS) {
    assert.ok(words(from).length && words(to).length, `${from} → ${to}`);
    for (const w of words(from)) { assert.ok(!seen.has(w), `${w} is listed twice`); seen.add(w); }
  }
});

test('each menu action names a button the page has, once', () => {
  // The page's markup and the shipped scripts that write markup (the Export pane's .ufo button is written by sculpt-export.js).
  const site = JSON.parse(readFileSync(new URL('../site.json', import.meta.url), 'utf8'));
  const page = site.sources.filter(f => /\.(html|js)$/.test(f)).map(f => readFileSync(new URL('../' + f, import.meta.url), 'utf8')).join('\n');
  const ids = ACTIONS.map(([id]) => id);
  assert.deepEqual(ids.filter((id, i) => ids.indexOf(id) !== i), []);
  for (const [id, how] of ACTIONS) {
    assert.ok(page.includes(`id="${id}"`), `no element has the id ${id}`);
    assert.match(how, /^(run|go|go:[\w-]+)$/);
    if (how.startsWith('go:')) assert.ok(page.includes(`id="${how.slice(3)}"`), `no element has the id ${how.slice(3)}`);
  }
});
