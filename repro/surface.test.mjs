import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {surfaceRows, SURFACE_BUILTINS, SURFACE_STAGES, SURFACE_MAX, SURFACE_HEAD_ROW, SURFACE_LAYER_ROWS} from '../sculpt-material-model.js';

const defaults = JSON.parse(readFileSync(new URL('../materials/defaults.json', import.meta.url), 'utf8'));

test('the default surface draws every built-in once, in a stage order the draw can run', () => {
  const names = defaults.surface.map(l => l.builtin);
  assert.deepEqual([...names].sort(), Object.keys(SURFACE_BUILTINS).sort(), 'each built-in once');
  const stages = names.map(n => SURFACE_BUILTINS[n][0]);
  assert.deepEqual(stages, [...stages].sort((a, b) => a - b), 'listed in stage order');
  assert.ok(SURFACE_MAX * SURFACE_LAYER_ROWS <= SURFACE_HEAD_ROW, 'the layer rows end before the stage heads');
});

test('rows sort by stage, keep the list order within a stage, and head each stage with its first layer and count', () => {
  const {rows, head} = surfaceRows([{builtin: 'sand'}, {builtin: 'highland', amount: .5}, {builtin: 'fines', edge: {width: .2, noise: .6, noiseSize: 1}}, {builtin: 'rock'}]);
  assert.equal(rows.length, 8);
  assert.deepEqual(rows[0], [SURFACE_BUILTINS.highland[1], .5, 0, 0], 'stage 0 first, with its Amount');
  assert.deepEqual(rows.filter((_, i) => i % 2 === 0).map(r => r[0]), [0, 1, 6, 1], 'highland, rock, sand, fines by slot');
  assert.deepEqual(rows[7], [.2, .6, 1, 0], 'an edge row');
  assert.equal(head.length, SURFACE_STAGES / 2);
  assert.deepEqual(head[0], [0, 1, 0, 0], 'stage 0: one layer at 0; stage 1: none');
  assert.deepEqual(head[1], [1, 1, 0, 0], 'stage 2: rock at 1');
  assert.deepEqual(head[2].slice(2), [2, 2], 'stage 5: sand then fines, the list order kept');
});

test('a bad list is refused', () => {
  assert.throws(() => surfaceRows([{builtin: 'lava lamp'}]), /unknown built-in/);
  assert.throws(() => surfaceRows(Array.from({length: SURFACE_MAX + 1}, () => ({builtin: 'rock'}))), /at most/);
  assert.deepEqual(surfaceRows(undefined).rows, [], 'no list: no layers');
});
