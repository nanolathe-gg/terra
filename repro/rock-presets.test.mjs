// Rock presets (B2): a map's list of rock recipes in slots 1-15 beside the world's own (slot 0), and the strokes that choose them.
import test from 'node:test';
import assert from 'node:assert/strict';
import {ROCK_PRESETS,SMOOTH_SOIL,STARTING_RECIPES,worldRocks,worldRockName,copyRocks,addRock,duplicateRock,renameRock,setRock,deleteRock,strokeRock,keepStrokeRocks,
  rocksInUse,rockRecipeText,parseRockRecipe,rockRecipeFor,recipeRock,worldRock} from '../sculpt-rock-presets.js';

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
  assert.deepEqual(w.rocks.find(r => r.slot === w.slot), {slot: w.slot, name: 'Rounded granite copy', knobs: {rockFace: 2, faceJoint: 1.1}, column: {sections: [{start: 0, beds: [[12, .8, 0]]}]}});
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
  assert.deepEqual(back, {name: 'Columnar', knobs: ROCK_PRESETS.basalt.knobs, column: {sections: ROCK_PRESETS.basalt.sections}});
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
