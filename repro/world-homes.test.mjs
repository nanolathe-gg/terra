import test from 'node:test';
import assert from 'node:assert/strict';
import {WORLD_HOMES, worldHome} from '../sculpt-ui.js';
import {KNOBS} from '../sculpt-knobs.js';
import {ROCK_KEYS,ROCK_HEADLINES} from '../sculpt-rock-presets.js';
import {WORLD_PRIMARY_CONTROLS} from '../sculpt-control-schema.js';
const homes = Object.entries(WORLD_HOMES).map(([home, keys]) => [home, keys.split(' ')]);
test('every World setting has exactly one home', () => {
  const keys = KNOBS.flatMap(([, list]) => list.map(k => k[0])), placed = homes.flatMap(([, list]) => list);
  assert.deepEqual(placed.filter((k, i) => placed.indexOf(k) !== i), [], 'no key sits in two homes');
  assert.deepEqual(keys.filter(k => !placed.includes(k)), [], 'no setting is without a home');
  assert.deepEqual(placed.filter(k => !keys.includes(k)), [], 'no home names a setting that does not exist');
  assert.equal(worldHome('noSuchKey'), 'World/', 'an unknown key would still show, in the World section');
});
test('Rock types holds the settings of the selected rock type, and only those', () => {
  const rock = homes.filter(([home]) => home.startsWith('Rock types/')).flatMap(([, list]) => list);
  assert.deepEqual([...rock].sort(), [...ROCK_KEYS].sort());
});
test('each tab shows something before All is on', () => {
  for (const [home, list] of homes) if (!['Rock types/Colors & recipe'].includes(home)) assert(list.some(k => WORLD_PRIMARY_CONTROLS.has(k)), home + ' has a main setting');
});

test('rock headlines share one ordered home with Pick', () => { assert.deepEqual(WORLD_HOMES['Rock types/Headline'].split(' '), ROCK_HEADLINES); assert.equal(worldHome('faceBlockSize'),'Rock types/Headline'); assert.equal(worldHome('crackSpacing'),'Rock types/Cracks & bands'); });

test('World home headline rows each leave their former tab',()=>{
  for(const [key,home]of [['groundPatchSize','World/Ground'],['reliefAmount','World/Ground'],['shallowDepth','World/Water'],['sunHeight','World/Light & weather'],['erosionRain','World/Light & weather']])assert.equal(worldHome(key),home);
});
