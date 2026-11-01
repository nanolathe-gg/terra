import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {columnRows} from '../sculpt-column.js';

// The shaders choose a bed by the last section whose start the coordinate has passed (columnSectionAt), then by its place in the
// section's repeating cycle; a variant is a row of the world's block, never a knob override. This is that choice over the table's rows.
function columnBedAt({beds, starts}, c) {
  let s = 0;
  for (let i = 1; i < starts.length; i++) if (c >= starts[i][0]) s = i;
  const [, first, count, period] = starts[s];
  const cycle = Math.floor(c / period), r = c - cycle * period;
  let lo = 0;
  for (let i = 0; i < count; i++) {
    if (r < lo + beds[first + i][0] || i === count - 1) return {index: cycle * count + i, slot: beds[first + i][2], hardness: beds[first + i][1]};
    lo += beds[first + i][0];
  }
}

const desert = JSON.parse(readFileSync(new URL('../materials/desert.json', import.meta.url))).world.column;

test('a coordinate on each side of a section start reads the beds of its own section', () => {
  // Below 20 the cycle is 2 + 8 (slots 0, 1); from 20 it is 5 + 5 (slots 2, 3). Both repeat from coordinate 0.
  const rows = columnRows({sections: [{start: 10, beds: [[2, .5, 0], [8, .5, 1]]}, {start: 20, beds: [[5, .5, 2], [5, .5, 3]]}]}, '');
  for (const [c, slot] of [[1, 0], [5, 1], [19.9, 1], [20.1, 2], [24, 2], [25.1, 3], [29.9, 3]]) assert.equal(columnBedAt(rows, c).slot, slot, `coordinate ${c}`);
  assert.equal(columnBedAt(rows, 0.5).slot, 0, 'below every start the first section answers');
  // Painted Desert's own table: the grey section starts at 69 (slots 2 and 3), the pale one below it uses slots 0 and 1.
  const desertRows = columnRows(desert, '');
  assert.equal(columnBedAt(desertRows, 68.9).slot, 1);
  assert.equal(columnBedAt(desertRows, 69.1).slot, 2);
});

test('a variant row replaces the sections and leaves a world without one on its own table', () => {
  const base = columnRows(desert, ''), triad = columnRows(desert, 'triad');
  assert.equal(base.starts.length, 5);
  assert.deepEqual(triad.starts.map(s => s[0]), [1, 14, 60, 95]);
  assert.deepEqual(triad.bands, [4, .6], 'its bands are in the row too');
  assert.deepEqual(base.bands, [6, .2]);
  assert.equal(columnBedAt(triad, 13.9).slot, 0, 'the first triad section: period 4, B after 3 units');
  assert.equal(columnBedAt(triad, 14.1).slot, 2, 'and the grey section above its start');
  assert.deepEqual(columnRows(desert, 'unknown'), base);
  const none = columnRows(undefined, 'triad');
  assert.equal(none.starts.length, 0, 'no block, no column');
  assert.deepEqual(none.bands, [3.7, .5], 'and the default bands');
});

test('Green keeps one section of eight beds with the index the hashes are keyed on', () => {
  const green = JSON.parse(readFileSync(new URL('../materials/green.json', import.meta.url))).world.column;
  const rows = columnRows(green, '');
  assert.equal(rows.starts.length, 1);
  assert.equal(rows.starts[0][3], 47, 'the section holds its period');
  assert.equal(columnBedAt(rows, 47.5).index, 8, 'the second cycle begins at index 8');
});
