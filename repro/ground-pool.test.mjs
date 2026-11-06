// Card tilepool: every world's table carries the period its level ground repeats with (material.groundPool), and the tool that
// rewrites the tables keeps it. Without it the draw falls back to 1,024 px silently, and a world's own value would be lost.
import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {groundPool} from '../sculpt-material-model.js';

const WORLDS = ['green', 'red', 'archipelago', 'moon', 'zhon', 'lava', 'desert', 'crystal', 'ice'];
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

test('material_numbers.py keeps the pool period when it rewrites a table', () => {
  const source = fs.readFileSync(new URL('../measure/material_numbers.py', import.meta.url), 'utf8');
  const kept = /^TABLE_MATERIAL_KEYS = \(([^)]*)\)/m.exec(source);
  assert.ok(kept, 'material_numbers.py defines TABLE_MATERIAL_KEYS');
  assert.match(kept[1], /'groundPool'/);
  assert.match(source, /old\['material'\] = \{\*\*config\['material'\], \*\*\{k: v for k, v in old\.get\('material', \{\}\)\.items\(\) if k in TABLE_MATERIAL_KEYS\}\}/);
});
