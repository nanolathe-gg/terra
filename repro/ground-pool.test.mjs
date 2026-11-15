// Every world carries the period its level ground repeats with (material.groundPool).
// The renderer reads it; missing values fall back to 1,024 px.
import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {groundPool} from '../sculpt-material-model.js';

const WORLDS = ['green', 'red', 'archipelago', 'moon', 'zhon', 'lush', 'lava', 'desert', 'crystal', 'ice'];
const table = world => JSON.parse(fs.readFileSync(new URL(`../materials/${world}.json`, import.meta.url)));

test('every world table sets its ground pool period, a multiple of 512 px', () => {
  for (const world of WORLDS) {
    const pool = table(world).material?.groundPool;
    assert.ok(Number.isInteger(pool) && pool >= 512 && pool % 512 === 0, `${world}: material.groundPool is ${pool}`);
    assert.equal(groundPool(table(world).material), pool, `${world}: the draw reads the table's period`);
  }
});

test('the period rounds to a multiple of 512 and defaults to 1,024', () => {
  assert.equal(groundPool({}), 1024);
  assert.equal(groundPool(undefined), 1024);
  assert.equal(groundPool({groundPool: 2000}), 2048);
  assert.equal(groundPool({groundPool: 100}), 512);
});
