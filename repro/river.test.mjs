import test from 'node:test';
import assert from 'node:assert/strict';
import {riverCurvature, isBraided, BRAIDED_SPAN, migrateRiver, applyRiver, pointsSignature, riverSteps, riverBand, riverWidth, isRiver, RIVER_MIN_WIDTH, RIVER_BELT, movedRiver, riverKey} from '../sculpt-river.js';
import {landformSides, landformReach} from '../sculpt-shape-presets.js';

const wave = (n = 40, step = 20) => Array.from({length: n}, (_, i) => ({x: 100 + i * step, y: 400 + 30 * Math.sin(i * 0.5) + (i % 3)}));
const near = (line, p) => { let best = Infinity; for (let i = 0; i + 1 < line.length; i++) { const a = line[i], b = line[i + 1], dx = b.x - a.x, dy = b.y - a.y, l2 = dx * dx + dy * dy, t = l2 ? Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / l2)) : 0; best = Math.min(best, Math.sqrt((p.x - a.x - dx * t) ** 2 + (p.y - a.y - dy * t) ** 2)); } return best; };

test('the same line, width, steps and seed give the same path', () => {
  const a = migrateRiver(wave(), {width: 40, band: 80, seed: 7, bounds: {w: 1200, h: 800}}), b = migrateRiver(wave(), {width: 40, band: 80, seed: 7, bounds: {w: 1200, h: 800}});
  assert.deepEqual(a, b);
  assert.notDeepEqual(a.path, migrateRiver(wave(), {width: 40, band: 80, seed: 8, bounds: {w: 1200, h: 800}}).path);
  assert.ok(a.path.length > 20);
});

test('migration moves the line, zero steps keeps it, and a loop that closes leaves an oxbow', () => {
  const none = migrateRiver(wave(), {width: 40, band: 0, seed: 7}), many = migrateRiver(wave(), {width: 40, band: 80, seed: 7, bounds: {w: 1200, h: 800}});
  assert.ok(none.path.every(p => near(none.drawn, p) < 1e-6));
  assert.ok(many.path.some(p => near(many.drawn, p) > 20));
  // A loop drawn closed (its neck 40 px, inside 1.1 widths) is cut off at the first step and kept as an oxbow, with a plug of silt at each end, so it never
  // touches the river.
  const loop = [];
  for (let x = 100; x <= 400; x += 25) loop.push({x, y: 600});
  const r = Math.hypot(20, 100), a0 = Math.atan2(100, -20), a1 = Math.atan2(100, 20) - 2 * Math.PI;
  for (let k = 1; k < 48; k++) { const a = a0 + (a1 - a0) * k / 48; loop.push({x: 420 + r * Math.cos(a), y: 500 + r * Math.sin(a)}); }
  for (let x = 440; x <= 800; x += 25) loop.push({x, y: 600});
  const ox = migrateRiver(loop, {width: 40, band: 80, steps: 4, seed: 7, bounds: {w: 1200, h: 900}});
  assert.equal(ox.oxbows.length, 1);
  assert.ok(ox.oxbows[0].points.length >= 8 && ox.oxbows[0].age >= 0 && ox.oxbows[0].age <= 1);
  const o = ox.oxbows[0].points; assert.ok(Math.hypot(o[0].x - o.at(-1).x, o[0].y - o.at(-1).y) > 8);
  assert.ok(ox.path.every(p => p.y > 560));   // the river runs on along the line, past the neck
});

test('a bend never leaves the band about the drawn line, or the map', () => {
  for (const W of [32, 48, 96, 200]) for (const seed of [3, 11, 2701]) {
    const band = RIVER_BELT * W, r = migrateRiver(wave(), {width: W, band, seed, bounds: {w: 1200, h: 800}});
    for (const p of r.path) { assert.ok(near(r.drawn, p) <= band + 1e-6); assert.ok(p.x >= 0 && p.y >= 0 && p.x <= 1199 && p.y <= 799); }
  }
  // An S stays an S: at the preset's 48 px and Wander 96 the channel stays within 96 px of the drawn S, and its length grows by a sixth at most.
  const S = Array.from({length: 33}, (_, i) => { const t = i / 32; return {x: 200 + 1650 * t, y: 1088 + 260 * Math.sin(2 * Math.PI * t)}; });
  const len = p => p.slice(1).reduce((s, q, i) => s + Math.hypot(q.x - p[i].x, q.y - p[i].y), 0);
  for (const seed of [2701, 2701 + 7919, 2701 + 2 * 7919]) {
    const m = migrateRiver(S, {width: 48, band: riverBand(96, 48), seed, bounds: {w: 2080, h: 2176}});
    assert.ok(Math.max(...m.path.map(p => near(m.drawn, p))) <= 96 + 1e-6);
    assert.ok(len(m.path) / len(m.drawn) < 1.17, 'got ' + len(m.path) / len(m.drawn));
  }
});

test('the width is at least 32 px', () => {
  assert.equal(riverWidth({radius: 9}), RIVER_MIN_WIDTH);
  assert.equal(riverWidth({radius: 30}), 60);
  const river = {radius: 5, lean: 1, curve: {form: 'lfRiver'}}, plain = {radius: 5, lean: 1};
  assert.equal(landformSides(river).front, landformSides({...river, radius: 16}).front);   // narrower than 32 px is raised to 32
  assert.equal(landformSides(river).front, 6 * 16);
  assert.equal(landformSides(plain).front, 5);
  assert.equal(landformReach({...river, wander: 75}), landformReach({...river, wander: 0}));   // a river's Wander is its band, not outline px
});

test('Wander is the band in px, at most four channel widths, and the steps fill it', () => {
  assert.equal(riverBand(0, 48), 0); assert.equal(riverBand(96, 48), 96); assert.equal(riverBand(999, 48), 192); assert.equal(riverBand(100, 10), 100);   // 32 px at least
  assert.equal(riverSteps(0, 48), 0); assert.equal(riverSteps(96, 48), 380); assert.equal(riverSteps(192, 48), 680); assert.equal(riverSteps(999, 32), 700);
});

test('the stored path survives the save and is not computed again on load', () => {
  const node = {kind: 'landform', seed: 5, points: wave().map(p => ({...p})), params: {radius: 24, wander: 75, curve: {form: 'lfRiver'}}};
  node.params.river = {drawn: node.points.map(p => ({...p}))};
  assert.ok(isRiver(node.params) && applyRiver(node, {w: 1400, h: 900}));
  const saved = JSON.parse(JSON.stringify(node));
  assert.equal(pointsSignature(saved.points), saved.params.river.sig);
  assert.equal(applyRiver(saved, {w: 1400, h: 900}), false);
  assert.deepEqual(saved.points, node.points);
  // a Wander edit migrates the drawn line again; a hand edit of the path is left alone
  const edited = JSON.parse(JSON.stringify(saved)); edited.params.wander = 40;
  assert.ok(applyRiver(edited, {w: 1400, h: 900})); assert.notDeepEqual(edited.points, saved.points);
  const hand = JSON.parse(JSON.stringify(saved)); hand.points[3].x += 5; hand.params.wander = 40;
  assert.equal(applyRiver(hand, {w: 1400, h: 900}), false);
});

test('the curvature the channel reads is the width over the radius, positive when the bend centre is on the shader\'s c > 0 side', () => {
  const R = 200, W = 40, arc = sign => Array.from({length: 40}, (_, i) => { const a = i * 0.04; return {x: R * Math.sin(a), y: sign * R * (1 - Math.cos(a))}; });
  const toward = riverCurvature(arc(1), W), away = riverCurvature(arc(-1), W);   // heading +x, the centre at +y then -y
  assert.ok(Math.abs(toward[20] + W / R) < 0.01, 'got ' + toward[20]);
  assert.ok(Math.abs(away[20] - W / R) < 0.01, 'got ' + away[20]);
  assert.equal(toward.length, 40);
});

test('a braided river is a river preset with a wider valley, and migrates the same way', () => {
  const b = {radius: 20, lean: 1, wander: 0, curve: {form: 'lfBraided'}};
  assert.ok(isBraided(b) && isRiver(b) && !isBraided({curve: {form: 'lfRiver'}}));
  assert.equal(landformSides(b).front, BRAIDED_SPAN * 20);
  const node = {kind: 'landform', seed: 5, points: wave().map(p => ({...p})), params: {...b, river: {drawn: wave()}}};
  assert.ok(applyRiver(node, {w: 1400, h: 900}));
  assert.equal(node.points.length, migrateRiver(wave(), {width: 40, band: 0, seed: 5}).path.length);   // Wander 0: the line as drawn
});

// sculpt.js transformNode: the points and the drawn line take the matrix, and the river takes movedRiver.
const drawnRiver = () => { const drawn = []; for (let i = 0; i <= 40; i++) drawn.push({x: 200 + i * 40, y: 1000}); const node = {kind: 'landform', seed: 1234, points: drawn.map(p => ({...p})), params: {radius: 24, wander: 120, curve: {form: 'lfRiver'}, river: {drawn: drawn.map(p => ({...p}))}}}; applyRiver(node, {w: 4096, h: 4096}); return node; };
const transform = (node, m) => {
  const ap = q => ({x: m[0] * q.x + m[2] * q.y + m[4], y: m[1] * q.x + m[3] * q.y + m[5]}), before = {points: node.points.map(p => ({...p})), params: {...node.params}, seed: node.seed};
  node.points = before.points.map(ap); node.params = {...node.params, radius: Math.max(4, Math.min(600, before.params.radius * Math.hypot(m[0], m[1])))};
  node.params = {...node.params, river: movedRiver(before.params.river, before, {points: node.points, params: node.params, seed: node.seed}, ap)};
};

test('a river edited by hand stays so when it is moved: Wander does not migrate it from the old line', () => {
  const node = drawnRiver(), bounds = {w: 4096, h: 4096};
  node.points[10] = {x: node.points[10].x, y: node.points[10].y + 300};   // a point dragged in path mode
  assert.notEqual(node.params.river.sig, pointsSignature(node.points));
  transform(node, [1, 0, 0, 1, 50, 0]);
  assert.notEqual(node.params.river.sig, pointsSignature(node.points), 'still edited by hand after the move');
  const hand = {...node.points[10]};
  node.params = {...node.params, wander: 121};
  assert.equal(applyRiver(node, bounds), false);
  assert.deepEqual(node.points[10], hand);
  assert.equal(node.params.river.drawn[0].x, 250, 'the drawn line moves with it');
});

test('a migrated river moved, turned or scaled is not migrated again by an unrelated edit, and is by a river edit', () => {
  const bounds = {w: 4096, h: 4096};
  for (const m of [[1, 0, 0, 1, 50, -20], [0, 1, -1, 0, 3000, 0], [1.5, 0, 0, 1.5, -500, -500]]) {
    const node = drawnRiver();
    transform(node, m);
    assert.equal(node.params.river.sig, pointsSignature(node.points));
    assert.equal(node.params.river.key, riverKey(node.params, node.seed), 'the key follows a scale');
    const after = node.points.map(p => ({...p}));
    node.params = {...node.params, rough: .5};   // Roughness, the Rock row: nothing a river is built from
    assert.equal(applyRiver(node, bounds), false);
    assert.deepEqual(node.points, after);
    node.params = {...node.params, wander: 90};   // Wander migrates it again, from the moved drawn line
    assert.equal(applyRiver(node, bounds), true);
  }
});

