// Rock presets (B2): a map's list of rock recipes in slots 1-15 beside the world's own (slot 0), and the strokes that choose them.
import test from 'node:test';
import assert from 'node:assert/strict';
import {ROCK_PRESETS,SMOOTH_SOIL,STARTING_RECIPES,worldRocks,worldRockName,copyRocks,addRock,duplicateRock,renameRock,setRock,deleteRock,strokeRock,keepStrokeRocks,
  rocksInUse,rockRecipeText,parseRockRecipe,rockRecipeFor,recipeRock,worldRock,checkColors,setRockColors,ROCK_COLORS,rockByKey} from '../sculpt-rock-presets.js';

const stroke = (rockPreset, extra = {}) => ({kind: 'landform', points: [{x: 0, y: 0}], params: {rockPreset}, ...extra});

test('every world ships its own rock and Smooth soil; a world may name more', () => {
  assert.deepEqual(worldRocks({}).map(r => [r.slot, r.name]), [[1, 'Smooth soil']]);
  assert.equal(worldRocks({}).at(0).column, null, 'Smooth soil keeps the world\'s beds');
  assert.deepEqual(worldRocks({rock: {recipe: 'granite', presets: ['basalt', 'limestone']}}).map(r => r.name), ['Smooth soil', 'Jointed basalt', 'Pitted limestone']);
  assert.equal(worldRockName({rock: {recipe: 'granite'}}), 'Rounded granite');
  assert.equal(worldRockName({}), 'World rock');
  assert.equal(Object.keys(STARTING_RECIPES).length, Object.keys(ROCK_PRESETS).length + 1);
  assert.equal(STARTING_RECIPES.soil, SMOOTH_SOIL);
  assert.equal(SMOOTH_SOIL.knobs.rockFace, 0);
});

test('add, duplicate, rename and delete; the strokes of a deleted preset go to Rock beneath', () => {
  let rocks = worldRocks({});
  const a = addRock(rocks, 'basalt', 'World rock');
  assert.equal(a.slot, 2); rocks = a.rocks;
  assert.equal(rockRecipeFor(rocks[1]), 'basalt');
  const b = addRock(rocks, 'basalt', 'World rock');
  assert.equal(rocks.find(r => r.slot === b.slot), undefined, 'the operations return new lists');
  assert.equal(b.rocks.find(r => r.slot === b.slot).name, 'Jointed basalt 2', 'names stay unique');
  const d = duplicateRock(rocks, 2, null);
  assert.equal(d.rocks.find(r => r.slot === d.slot).name, 'Jointed basalt copy');
  assert.deepEqual(d.rocks.find(r => r.slot === d.slot).knobs, rocks.find(r => r.slot === 2).knobs);
  const world = worldRock('Rounded granite', {rockFace: 2, faceJoint: 1.1}, {sections: [{start: 0, beds: [[12, .8, 0]]}]}, '');
  const w = duplicateRock(rocks, 0, world);
  assert.deepEqual(w.rocks.find(r => r.slot === w.slot), {slot: w.slot, name: 'Rounded granite copy', key: null, knobs: {rockFace: 2, faceJoint: 1.1}, column: {sections: [{start: 0, beds: [[12, .8, 0]]}]}, colors: null});
  rocks = renameRock(rocks, 2, '  Columnar  ');
  assert.equal(rocks.find(r => r.slot === 2).name, 'Columnar');
  assert.throws(() => renameRock(rocks, 2, ''));
  assert.throws(() => renameRock(rocks, 9, 'x'));
  rocks = setRock(rocks, 2, {knobs: {faceJoint: 2}, column: null});
  assert.deepEqual(rocks.find(r => r.slot === 2).knobs, {faceJoint: 2});
  const nodes = [stroke(2), stroke(1), stroke(-1), {kind: 'ground'}];
  const gone = deleteRock(rocks, nodes, 2);
  assert.deepEqual(gone.rocks.map(r => r.slot), [1]);
  assert.deepEqual(gone.nodes.map(n => n.params?.rockPreset), [-1, 1, -1, undefined]);
  assert.equal(nodes[0].params.rockPreset, 2, 'the strokes given are not changed');
  assert.throws(() => deleteRock(rocks, nodes, 0), /cannot be deleted/);
  let full = [];
  for (let k = 0; k < 15; k++) full = addRock(full, 'shale').rocks;
  assert.throws(() => addRock(full, 'shale'), /at most 15/);
});

test('only the presets a shown landform stroke chooses are in use; an unknown choice is Rock beneath', () => {
  const rocks = worldRocks({rock: {presets: ['basalt']}});
  assert.deepEqual(rocksInUse([stroke(-1), stroke(0), {kind: 'ground'}], rocks), [], 'Rock beneath and the world\'s own need no slot');
  assert.deepEqual(rocksInUse([stroke(2), stroke(2), stroke(1, {hidden: true})], rocks).map(r => r.slot), [2]);
  assert.equal(strokeRock(stroke(7), rocks), -1);
  assert.deepEqual(keepStrokeRocks([stroke(7), stroke(2), {kind: 'paint', params: {}}], rocks).map(n => n.params.rockPreset), [-1, 2, undefined]);
});

test('a recipe goes to the clipboard and back; bad lists and recipes are refused before they touch the map', () => {
  const rock = {slot: 3, name: 'Columnar', ...recipeRock('basalt')};
  const back = parseRockRecipe(rockRecipeText(rock));
  assert.deepEqual(back, {name: 'Columnar', key: null, knobs: ROCK_PRESETS.basalt.knobs, column: {sections: ROCK_PRESETS.basalt.sections}, colors: recipeRock('basalt').colors});
  assert.throws(() => parseRockRecipe('{"name":"x"}'), /no rock recipe/);
  assert.throws(() => parseRockRecipe('not json'), /no rock recipe/);
  assert.throws(() => parseRockRecipe(JSON.stringify({format: 'terraform-rock-recipe', name: 'x', knobs: {faceJoint: 99}})), /faceJoint/);
  const list = [{slot: 2, name: 'B', knobs: {faceJoint: 1}, column: null}, {slot: 1, name: 'A', knobs: {}, column: {sections: [{start: 0, beds: [[5, .5, 0]]}]}}];
  assert.deepEqual(copyRocks(JSON.parse(JSON.stringify(list))).map(r => r.slot), [1, 2]);
  assert.equal(copyRocks(undefined), null);
  for (const bad of [{}, [{slot: 0, name: 'x', knobs: {}}], [{slot: 16, name: 'x', knobs: {}}], [{slot: 1, name: 'x'}, {slot: 1, name: 'y'}], [{slot: 1, name: ''}],
    [{slot: 1, name: 'x', knobs: {rockFace: -1}}], [{slot: 1, name: 'x', extra: 1}], [{slot: 1, name: 'x', column: {sections: [{start: 0, beds: [[-1, .5, 0]]}]}}],
    [{slot: 1, name: 'x', column: {colors: []}}]])
    assert.throws(() => copyRocks(bad), undefined, JSON.stringify(bad));
});

test('a share link carries the map\'s presets and each stroke\'s choice; an old save without them opens on the world\'s list', async () => {
  const {shareText, gzipText} = await import('../sculpt-share.js'), {gunzipSync} = await import('node:zlib');
  let rocks = worldRocks({rock: {recipe: 'granite', presets: ['basalt']}});
  rocks = setRock(rocks, 2, {knobs: {...rocks[1].knobs, faceJoint: 2.5}, column: rocks[1].column});
  rocks = renameRock(rocks, 2, 'Columnar');
  const save = {version: 1, rocks, nodes: [stroke(2), stroke(1), stroke(-1), stroke(0)]};
  const back = JSON.parse(gunzipSync(await gzipText(shareText(save))).toString('utf8'));
  assert.deepEqual(copyRocks(back.rocks), copyRocks(rocks));
  assert.deepEqual(keepStrokeRocks(back.nodes, copyRocks(back.rocks)).map(n => n.params.rockPreset), [2, 1, -1, 0]);
  assert.equal(shareText(back), shareText(save), 'sharing the loaded map again gives the same link');
  const old = JSON.parse(shareText({version: 1, nodes: [{kind: 'landform', points: [{x: 0, y: 0}], params: {}}]}));
  assert.equal(copyRocks(old.rocks), null, 'the page opens it on the world\'s list (worldRocks)');
  assert.deepEqual(keepStrokeRocks(old.nodes, worldRocks({})), old.nodes, 'its strokes keep the rock beneath');
});

test('a preset carries its own colors: validated, kept by edits of its numbers, replaced by a recipe, on the clipboard and in a share link', async () => {
  const beds = ['#112233', '#445566', '#778899', '#aabbcc', '#ddeeff'];
  assert.equal(checkColors(null), null);
  assert.equal(checkColors({rock: null, beds: null}), null, 'no colors at all is the world\'s');
  assert.deepEqual(checkColors({rock: '#A0B0C0'}), {rock: '#a0b0c0', beds: null});
  assert.deepEqual(checkColors({beds}), {rock: null, beds});
  for (const bad of [[], 'red', {rock: 'red'}, {rock: '#12345'}, {beds: beds.slice(1)}, {beds: [...beds.slice(1), 3]}, {tint: '#000000'}])
    assert.throws(() => checkColors(bad), /colors/, JSON.stringify(bad));
  let rocks = copyRocks([{slot: 1, name: 'Dark', knobs: {}, column: null, colors: {rock: '#202830', beds}}, {slot: 2, name: 'Plain', knobs: {}}]);
  assert.deepEqual(rocks.map(r => r.colors), [{rock: '#202830', beds}, null], 'an old preset without colors takes the world\'s');
  assert.throws(() => copyRocks([{slot: 1, name: 'x', colors: {rock: 'blue'}}]));
  rocks = setRock(rocks, 1, {knobs: {faceJoint: 2}, column: null});
  assert.deepEqual(rocks[0].colors, {rock: '#202830', beds}, 'a number edited keeps the colors');
  rocks = setRock(rocks, 1, {...recipeRock('shale')});
  assert.deepEqual(rocks[0].colors, recipeRock('shale').colors, 'Start from a recipe takes its colors');
  rocks = setRockColors(rocks, 2, {rock: '#ffffff', beds: null});
  assert.deepEqual(rocks[1].colors, {rock: '#ffffff', beds: null});
  rocks = setRockColors(rocks, 2, null);
  assert.equal(rocks[1].colors, null, 'World\'s colors');
  assert.throws(() => setRockColors(rocks, 9, null));
  const dark = {slot: 3, name: 'Dark', key: null, knobs: {faceJoint: 1}, column: null, colors: {rock: '#202830', beds: null}};
  assert.deepEqual(parseRockRecipe(rockRecipeText(dark)).colors, {rock: '#202830', beds: null});
  assert.equal(parseRockRecipe(JSON.stringify({format: 'terraform-rock-recipe', name: 'Old', knobs: {}})).colors, null, 'a recipe copied before colors pastes with none');
  assert.equal(rockRecipeFor({...recipeRock('basalt'), colors: {rock: '#010101', beds: null}}), '', 'a recolored recipe is no longer the recipe');
  for (const key of Object.keys(ROCK_COLORS)) assert.deepEqual(checkColors(ROCK_COLORS[key]), ROCK_COLORS[key], key);
  const {shareText, gzipText} = await import('../sculpt-share.js'), {gunzipSync} = await import('node:zlib');
  const back = JSON.parse(gunzipSync(await gzipText(shareText({version: 1, rocks: [dark], nodes: []}))).toString('utf8'));
  assert.deepEqual(copyRocks(back.rocks), [dark]);
});

test('a preset carries a stable key: the recipe a world ships it from, unique in the map, kept by a rename; a world\'s tool resolves it to a slot', async () => {
  let rocks = worldRocks({rock: {recipe: 'granite', presets: ['basalt', 'limestone']}});
  assert.deepEqual(rocks.map(r => [r.slot, r.key]), [[1, 'soil'], [2, 'basalt'], [3, 'limestone']]);
  assert.equal(rockByKey(rocks, 'soil'), 1);
  assert.equal(rockByKey(rocks, 'basalt'), 2);
  assert.equal(rockByKey(rocks, 'granite', 'granite'), 0, 'the world\'s own rock by its recipe');
  assert.equal(rockByKey(rocks, 'shale', 'granite'), -1, 'a rock the map does not hold is Rock beneath');
  assert.equal(rockByKey(rocks, null), -1);
  rocks = renameRock(rocks, 1, 'Meadow soil');
  assert.equal(rockByKey(rocks, 'soil'), 1, 'a rename keeps the key');
  const again = addRock(rocks, 'basalt');
  assert.equal(again.rocks.find(r => r.slot === again.slot).key, null, 'a second preset from a recipe another carries gets none');
  const shale = addRock(rocks, 'shale');
  assert.equal(shale.rocks.find(r => r.slot === shale.slot).key, 'shale', 'added from a recipe no other preset carries');
  const copy = duplicateRock(rocks, 2, null);
  assert.equal(copy.rocks.find(r => r.slot === copy.slot).key, null, 'a duplicate gets none');
  const gone = deleteRock(rocks, [], 1).rocks;
  assert.equal(rockByKey(gone, 'soil'), -1, 'its preset deleted, the key resolves to Rock beneath');
  const soil = addRock(gone, 'soil');
  assert.equal(rockByKey(soil.rocks, 'soil'), soil.slot, 'added again, the key names the new preset');
  // Start from a recipe keeps the key; a recipe pasted on a preset without one gives it the recipe's key if no other carries it.
  assert.equal(setRock(rocks, 2, recipeRock('shale')).find(r => r.slot === 2).key, 'basalt');
  const pasted = parseRockRecipe(rockRecipeText(shale.rocks.find(r => r.key === 'shale')));
  assert.equal(pasted.key, 'shale');
  assert.equal(setRock(copy.rocks, copy.slot, pasted).find(r => r.slot === copy.slot).key, 'shale');
  assert.equal(setRock(copy.rocks, copy.slot, {...pasted, key: 'basalt'}).find(r => r.slot === copy.slot).key, null, 'not a key another carries');
  // Saves and share links: the key travels; an old preset has none; two presets cannot share one; a bad key is refused.
  assert.deepEqual(copyRocks(JSON.parse(JSON.stringify(rocks))).map(r => r.key), ['soil', 'basalt', 'limestone']);
  assert.equal(copyRocks([{slot: 1, name: 'Old', knobs: {}}])[0].key, null);
  assert.throws(() => copyRocks([{slot: 1, name: 'a', key: 'soil'}, {slot: 2, name: 'b', key: 'soil'}]), /one preset/);
  assert.throws(() => copyRocks([{slot: 1, name: 'a', key: 'Soil Rock'}]), /key/);
  const {shareText, gzipText} = await import('../sculpt-share.js'), {gunzipSync} = await import('node:zlib');
  const back = JSON.parse(gunzipSync(await gzipText(shareText({version: 1, rocks, nodes: []}))).toString('utf8'));
  assert.deepEqual(copyRocks(back.rocks).map(r => r.key), ['soil', 'basalt', 'limestone']);
});

test('light through a rock (B4): three numbers a preset carries and an absorption color, checked and carried like the others', async () => {
  const {copyRockSettings, ROCK_KEYS} = await import('../sculpt-rock-presets.js');
  for (const key of ['lightThrough', 'absorbDepth', 'shadowTint']) {
    assert.ok(ROCK_KEYS.includes(key), key);
    assert.deepEqual(copyRockSettings({[key]: 0.6}), {[key]: 0.6});
    assert.throws(() => copyRockSettings({[key]: 1.5}), new RegExp(key));
    assert.throws(() => copyRockSettings({[key]: -0.1}), new RegExp(key));
  }
  assert.deepEqual(checkColors({absorb: '#2F6B97'}), {rock: null, beds: null, absorb: '#2f6b97'});
  assert.deepEqual(checkColors({rock: '#101010', absorb: null}), {rock: '#101010', beds: null}, 'no absorption color: the world\'s');
  assert.throws(() => checkColors({absorb: 'blue'}), /colors/);
  const ice = {slot: 4, name: 'Glacier ice', key: null, knobs: {lightThrough: 0.8, absorbDepth: 0.7, shadowTint: 0.7}, column: null, colors: {rock: null, beds: null, absorb: '#1b4b77'}};
  assert.deepEqual(copyRocks(JSON.parse(JSON.stringify([ice]))), [ice]);
  assert.deepEqual(parseRockRecipe(rockRecipeText(ice)), {name: 'Glacier ice', key: null, knobs: ice.knobs, column: null, colors: ice.colors});
  assert.deepEqual(setRock([ice], 4, {knobs: {...ice.knobs, absorbDepth: 0.2}, column: null})[0].colors, ice.colors, 'a number edited keeps the absorption color');
  const {shareText, gzipText} = await import('../sculpt-share.js'), {gunzipSync} = await import('node:zlib');
  const back = JSON.parse(gunzipSync(await gzipText(shareText({version: 1, rocks: [ice], nodes: []}))).toString('utf8'));
  assert.deepEqual(copyRocks(back.rocks), [ice]);
});
