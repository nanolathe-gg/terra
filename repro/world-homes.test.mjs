// The World panel's homes (sculpt-ui.js WORLD_HOMES): every World setting sits in exactly one section and tab, sculpt.html holds a container for
// each home, the Rock types section holds exactly the settings that follow the selected rock type, and a setting inside a section or tab that is
// not showing still counts as offered (measure/world_controls.mjs reads that from the markup).   node --test repro/world-homes.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {WORLD_HOMES, worldHome} from '../sculpt-ui.js';
import {KNOBS} from '../sculpt-knobs.js';
import {ROCK_KEYS} from '../sculpt-rock-presets.js';
import {WORLD_PRIMARY_CONTROLS} from '../sculpt-control-schema.js';
const html = readFileSync(new URL('../sculpt.html', import.meta.url), 'utf8');
const homes = Object.entries(WORLD_HOMES).map(([home, keys]) => [home, keys.split(' ')]);
test('every World setting has exactly one home', () => {
  const keys = KNOBS.flatMap(([, list]) => list.map(k => k[0])), placed = homes.flatMap(([, list]) => list);
  assert.deepEqual(placed.filter((k, i) => placed.indexOf(k) !== i), [], 'no key sits in two homes');
  assert.deepEqual(keys.filter(k => !placed.includes(k)), [], 'no setting is without a home');
  assert.deepEqual(placed.filter(k => !keys.includes(k)), [], 'no home names a setting that does not exist');
  assert.equal(worldHome('noSuchKey'), 'World/', 'an unknown key would still show, in the World section');
});
test('sculpt.html holds one container for each home, with a place for its rows', () => {
  for (const [home] of homes) assert.equal(html.split(`data-home="${home.replace(/&/g, '&amp;')}"><h3 class="world-where">`).length, 2, home);
  assert.equal((html.match(/class="world-tab"/g) || []).length, (html.match(/<div class="world-rows"><\/div>/g) || []).length);
});
test('Rock types holds the settings of the selected rock type, and only those', () => {
  const rock = homes.filter(([home]) => home.startsWith('Rock types/')).flatMap(([, list]) => list);
  assert.deepEqual([...rock].sort(), [...ROCK_KEYS].sort());
});
test('each tab shows something before All is on', () => {
  for (const [home, list] of homes) if (!['Palette/', 'Rock types/Colors & recipe'].includes(home)) assert(list.some(k => WORLD_PRIMARY_CONTROLS.has(k)), home + ' has a main setting');
});
test('a section or tab that is not showing is a tab panel, so its settings still count as offered', () => {
  const a = html.indexOf('<section id="pane-world"'), pane = html.slice(a, html.indexOf('</section>', a));
  const hidden = [...pane.matchAll(/<([a-z0-9]+)((?:[^>"]|"[^"]*")*)>/g)].filter(m => /(^|\s)hidden(\s|=|$)/.test(m[2].replace(/"[^"]*"/g, '""')));
  const plain = hidden.filter(m => !/role="tabpanel"/.test(m[2]) && !['input', 'p'].includes(m[1])).map(m => /id="([^"]*)"/.exec(m[2])?.[1] || m[0].slice(0, 60));
  // Hidden on purpose: the look picker until a world has looks, the legacy panel, the two groups the world's layers decide, the list behind the chips, inputs.
  assert.deepEqual(plain.sort(), ['ring-controls', 'rock-presets', 'transition-detail-control', 'variant-control', '<details class="panel" hidden>'].sort());
});
