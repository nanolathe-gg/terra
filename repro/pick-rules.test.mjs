// Pick explains why a surface layer is not at a pixel from the facts the draw recorded there (ruleHere mirrors engine-common.wgsl's
// surfaceWindow, surfaceWindows and surfaceScore; absentReason words it). The browser check compares ruleHere with the probe itself.
import assert from 'node:assert/strict';
import test from 'node:test';
import {ruleHere, SURFACE_FACTS} from '../sculpt-material-model.js';
import {absentReason} from '../sculpt-pick.js';

const facts = values => SURFACE_FACTS.map(name => values[name] ?? 0);

test('a windows rule multiplies smooth windows, as the draw does', () => {
  const layer = {id: 'low', where: [{fact: 'aboveSea', to: 5, fade: 1.5}, {fact: 'slope', from: .2, to: .8, fade: .1}]};
  assert.equal(ruleHere(layer, facts({aboveSea: 0, slope: .5})).share, 1);
  assert.equal(ruleHere(layer, facts({aboveSea: 7, slope: .5})).share, 0);
  const edge = ruleHere(layer, facts({aboveSea: 5, slope: .5}));
  assert.ok(Math.abs(edge.share - .5) < 1e-9, 'half way through the fade at the bound');
  assert.equal(ruleHere(layer, facts({aboveSea: 0, slope: .95})).terms[1].share, 0);
});

test('a score rule passes its threshold over its fade', () => {
  const layer = {id: 's', score: {from: .5, fade: .1, terms: [{fact: 'slope', weight: 2}, {fact: 'wetness', weight: -1}]}};
  const r = ruleHere(layer, facts({slope: .4, wetness: .1}));
  assert.ok(Math.abs(r.score - .7) < 1e-9); assert.equal(r.share, 1);
  assert.equal(ruleHere(layer, facts({slope: .1, wetness: .2})).share, 0);
});

test('a built-in without a rule, and the shares that grow by stage, are said as such', () => {
  assert.equal(ruleHere({builtin: 'rock'}, facts({})).kind, 'none');
  assert.equal(ruleHere({id: 'x', where: [{fact: 'rockShare', from: .5}]}, facts({rockShare: .9})).terms[0].late, true);
});

test('the reason names the failing window with its value and bounds, before the edge noise', () => {
  const layer = {id: 'low', where: [{fact: 'aboveSea', to: 5, fade: 1.5}]};
  assert.match(absentReason(layer, {section: 'drawing'}, facts({aboveSea: 139})), /Height above the sea 139\.00 here; the rule needs below 5/);
  assert.match(absentReason(layer, {section: 'drawing'}, facts({aboveSea: 0})), /edge noise or Coverage/);
  assert.match(absentReason(layer, {hidden: true}, facts({})), /Hidden while you design/);
  assert.match(absentReason(layer, {section: 'painted'}, facts({})), /only where Surface paint/);
  assert.match(absentReason(layer, {section: 'idle', reasons: ['Coverage is 0.']}, facts({})), /Coverage is 0/);
});

import {ruleToShow, ruleToHide, spreadRule} from '../sculpt-material-model.js';

test('Show here moves each failing window just past the value, and the rule then holds there', () => {
  const layer = {id: 'm', material: 'x', where: [{fact: 'slope', from: .9, fade: .2}, {fact: 'moisture', to: .5, fade: .05}]};
  const at = facts({slope: .4, moisture: .3});
  const {layer: next, moved} = ruleToShow(layer, at);
  assert.equal(ruleHere(next, at).share, 1);
  assert.deepEqual(moved.map(m => [m.fact, m.end]), [['slope', 'from']]);
  assert.ok(next.where[0].from < .2 && next.where[0].from > 0, `just past the value (${next.where[0].from})`);
  assert.equal(next.where[1].to, .5, 'a window that holds is kept');
  assert.equal(layer.where[0].from, .9, 'the layer given is not changed');
});

test('Show here and Not here store the limit less the layer’s Spread, so the drawn limit lands where it should', () => {
  for (const spread of [-.6, .7]) {
    const layer = {id: 'm', material: 'x', spread, where: [{fact: 'toWater', to: 30, fade: 2}]};
    const far = facts({toWater: 80}), near = facts({toWater: 10});
    assert.equal(ruleHere(ruleToShow(layer, far).layer, far).share, 1, `Show with Spread ${spread}`);
    const hidden = ruleToHide(layer, near).layer;
    assert.equal(ruleHere(hidden, near).share, 0, `Not here with Spread ${spread}`);
    const w = hidden.where[0];
    assert.ok(w.from == null || w.to == null || w.from <= w.to, `the stored window does not cross (${JSON.stringify(w)})`);
  }
});

test('Not here moves the one limit that cuts least of its range', () => {
  const layer = {id: 'm', material: 'x', where: [{fact: 'slope', from: .9, fade: .2}, {fact: 'aboveSea', from: 0, to: 120, fade: 2}]};
  const at = facts({slope: 3, aboveSea: 115});
  const {layer: next, moved} = ruleToHide(layer, at);
  assert.equal(ruleHere(next, at).share, 0);
  assert.equal(moved.length, 1);
  assert.deepEqual([moved[0].fact, moved[0].end], ['aboveSea', 'to'], 'lowering the height limit a little cuts less than raising the slope one past 3');
  const steep = ruleToHide(layer, facts({slope: 1.15, aboveSea: 60}));
  assert.deepEqual([steep.moved[0].fact, steep.moved[0].end], ['slope', 'from'], 'just past the slope limit, that limit moves');
});

test('a score’s threshold moves past the score both ways', () => {
  const layer = {id: 's', material: 'x', score: {from: 1.2, fade: .1, terms: [{fact: 'slope', weight: 1}, {fact: 'convexity', weight: 1}]}};
  const at = facts({slope: .5, convexity: .2});
  const shown = ruleToShow(layer, at).layer;
  assert.equal(ruleHere(shown, at).share, 1);
  assert.equal(ruleHere(ruleToHide(shown, at).layer, at).share, 0);
});

test('what no limit can do is said, not done', () => {
  assert.match(ruleToShow({builtin: 'rock'}, facts({})).reason, /World settings/);
  assert.match(ruleToHide({id: 'm', material: 'x'}, facts({})).reason, /no rule to narrow/);
  assert.match(ruleToShow({id: 'm', material: 'x', where: [{fact: 'slope', to: 2}]}, facts({slope: .5})).reason, /already holds/);
  assert.match(ruleToShow({id: 'm', material: 'x', where: [{fact: 'rockShare', from: .5}]}, facts({rockShare: .1})).reason, /finishes after this layer/);
  assert.match(ruleToHide({id: 'm', material: 'x', score: {from: .2, terms: [{fact: 'sandShare'}]}}, facts({sandShare: .9})).reason, /finishes after this layer/);
});

test('Show here at the end of a fact’s range takes the limit away rather than setting one past it', () => {
  const layer = {id: 'm', material: 'x', where: [{fact: 'sheltered', from: .3, fade: .05}]};
  const {layer: next, moved} = ruleToShow(layer, facts({sheltered: 0}));
  assert.equal(next.where[0].from, undefined);
  assert.deepEqual(moved, [{fact: 'sheltered', end: 'from', was: .3, now: null}]);
  assert.equal(ruleHere(next, facts({sheltered: 0})).share, 1);
});

test('a score’s new threshold clears the edge noise the draw adds, and a value past the range still ends fully out', () => {
  const layer = {id: 's', material: 'x', edge: {noise: .8}, score: {from: 1, fade: .05, terms: [{fact: 'slope', weight: 1}]}};
  const at = facts({slope: .5});
  const from = ruleToShow(layer, at).layer.score.from;
  assert.ok(.5 - from >= .05 + .05 + .4 - 1e-9, `below the score by fade, 0.05 and half the noise (${from})`);
  const past = {id: 'm', material: 'x', where: [{fact: 'aboveSea', from: 0, fade: 2}]};
  assert.equal(ruleHere(ruleToHide(past, facts({aboveSea: 260})).layer, facts({aboveSea: 260})).share, 0);
});
