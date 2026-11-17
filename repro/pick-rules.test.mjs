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
