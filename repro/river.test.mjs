import test from 'node:test';
import assert from 'node:assert/strict';
import {riverCurvature, migrateRiver, applyRiver, pointsSignature, riverSteps, riverWidth, isRiver, RIVER_MIN_WIDTH, RIVER_BELT} from '../sculpt-river.js';
import {landformSides, landformReach} from '../sculpt-shape-presets.js';

const wave = (n = 40, step = 20) => Array.from({length: n}, (_, i) => ({x: 100 + i * step, y: 400 + 30 * Math.sin(i * 0.5) + (i % 3)}));
const near = (line, p) => { let best = Infinity; for (let i = 0; i + 1 < line.length; i++) { const a = line[i], b = line[i + 1], dx = b.x - a.x, dy = b.y - a.y, l2 = dx * dx + dy * dy, t = l2 ? Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / l2)) : 0; best = Math.min(best, Math.sqrt((p.x - a.x - dx * t) ** 2 + (p.y - a.y - dy * t) ** 2)); } return best; };

test('the same line, width, steps and seed give the same path', () => {
  const a = migrateRiver(wave(), {width: 40, steps: 250, seed: 7, bounds: {w: 1200, h: 800}}), b = migrateRiver(wave(), {width: 40, steps: 250, seed: 7, bounds: {w: 1200, h: 800}});
  assert.deepEqual(a, b);
  assert.notDeepEqual(a.path, migrateRiver(wave(), {width: 40, steps: 250, seed: 8, bounds: {w: 1200, h: 800}}).path);
  assert.ok(a.path.length > 20);
});

test('migration moves the line, zero steps keeps it, and a bend that closes leaves an oxbow (pinned seed)', () => {
  const none = migrateRiver(wave(), {width: 40, steps: 0, seed: 7}), many = migrateRiver(wave(), {width: 40, steps: 300, seed: 7, bounds: {w: 1200, h: 800}});
  assert.ok(none.path.every(p => near(none.drawn, p) < 1e-6));
  assert.ok(many.path.some(p => near(many.drawn, p) > 20));
  // Pinned: this line at 32 px and 300 steps cuts one neck off with this seed. The oxbow keeps a plug of silt at each end, so it never touches the river.
  const long = Array.from({length: 7}, (_, i) => ({x: i * 1000 / 6, y: 1500 + (i % 2 ? 30 : -30)}));
  const ox = migrateRiver(long, {width: 32, steps: 300, seed: 2 * 7919, bounds: {w: 4096, h: 4096}});
  assert.equal(ox.oxbows.length, 1);
  assert.ok(ox.oxbows[0].points.length >= 4 && ox.oxbows[0].age >= 0 && ox.oxbows[0].age <= 1);
  // the loop is frozen when it is cut, two samples in from each end, so its ends stand clear of the neck (the river may move on and meet it later)
  const o = ox.oxbows[0].points; assert.ok(Math.hypot(o[0].x - o.at(-1).x, o[0].y - o.at(-1).y) > 8);
});

test('a bend never outgrows the belt or the map', () => {
  const W = 40, r = migrateRiver(wave(), {width: W, steps: 1000, seed: 11, bounds: {w: 1200, h: 800}});
  for (const p of r.path) { assert.ok(near(r.drawn, p) <= RIVER_BELT * W + 1e-6); assert.ok(p.x >= 0 && p.y >= 0 && p.x <= 1199 && p.y <= 799); }
});

test('the width is at least 32 px', () => {
  assert.equal(riverWidth({radius: 9}), RIVER_MIN_WIDTH);
  assert.equal(riverWidth({radius: 30}), 60);
  const river = {radius: 5, lean: 1, curve: {form: 'lfRiver'}}, plain = {radius: 5, lean: 1};
  assert.equal(landformSides(river).front, landformSides({...river, radius: 16}).front);   // narrower than 32 px is raised to 32
  assert.equal(landformSides(river).front, 6 * 16);
  assert.equal(landformSides(plain).front, 5);
  assert.equal(landformReach({...river, wander: 75}), landformReach({...river, wander: 0}));   // a river's Wander is steps, not outline px
});

test('Wander is steps', () => { assert.equal(riverSteps(0), 0); assert.equal(riverSteps(75), 300); assert.equal(riverSteps(999), 480); });

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
