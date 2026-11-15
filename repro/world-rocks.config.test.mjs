import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync, readdirSync} from 'node:fs';
import {ROCK_KEYS, STARTING_RECIPES, worldRocks} from '../sculpt-rock-presets.js';
// Every world's own rock types are well formed: a label, a known starting recipe, rock settings only, and listed among its presets.
test('worlds\' own rock types name only rock settings', () => {
  for (const file of readdirSync(new URL('../materials/', import.meta.url)).filter(f => f.endsWith('.json'))) {
    const rock = JSON.parse(readFileSync(new URL(`../materials/${file}`, import.meta.url), 'utf8')).world?.rock;
    for (const [key, r] of Object.entries(rock?.recipes || {})) {
      const what = `${file} rock type ${key}`;
      assert.match(key, /^[a-z][a-z0-9_-]{0,39}$/, what);
      assert.ok(typeof r.label === 'string' && r.label.trim(), `${what} needs a label`);
      assert.ok(!r.from || STARTING_RECIPES[r.from], `${what} starts from an unknown recipe`);
      assert.deepEqual(Object.keys(r.knobs || {}).filter(k => !ROCK_KEYS.includes(k)), [], `${what} sets only rock settings`);
      assert.ok(rock.presets?.includes(key), `${what} is among the world's presets`);
    }
    if (rock) worldRocks({rock});
  }
});
