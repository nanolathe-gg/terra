// The World panel's knob path (sculpt-knobs.js), which the page's setKnob and the headless host share: what a knob's change sets and what it
// asks the host to run again, the Colors panel's rows and picks, and the panel facts a stroke's water choices turn on.
import test from 'node:test';
import assert from 'node:assert/strict';
import {KNOBS, applyKnob, createWorldInputQueue, colorRows, pickWorldColor, strokeWaterPicks, worldPanelValues} from '../sculpt-knobs.js';

const renderer = () => ({variant: new Map(), applied: 0, applyKnobs() { this.applied++; }, transitionBody: false, groundTiled: false});

test('a knob goes into the address and the renderer, and says what else it needs', () => {
  const settings = new URLSearchParams(), r = renderer(), nodes = [{kind: 'ground', amplitude: 10, wavelength: 200, coverage: .45, seed: 1}, {kind: 'landform', points: []}];
  assert.deepEqual(applyKnob({key: 'reliefAmount', value: '.7', settings, renderer: r, nodes, seed: 2701}), {});
  assert.equal(settings.get('reliefAmount'), '.7'); assert.equal(r.variant.get('reliefAmount'), '.7'); assert.equal(r.applied, 1);
  assert.deepEqual(applyKnob({key: 'undulationScale', value: '160', settings, renderer: r, nodes, seed: 2701}), {evaluate: 0, checkpoint: true, weather: true});
  assert.equal(nodes[0].wavelength, 160);
  assert.deepEqual(applyKnob({key: 'frostGaps', value: '1', settings, renderer: r, nodes, seed: 2701}), {evaluate: 0, weather: true});
  // Coast ramp reshapes every water-making landform: the shape runs again from the first node.
  assert.deepEqual(applyKnob({key: 'coastRamp', value: '.3', settings, renderer: r, nodes, seed: 2701}), {evaluate: 0, weather: true});
  assert.deepEqual(applyKnob({key: 'faceSteep', value: '2', settings, renderer: r, nodes, seed: 2701}), {evaluate: 0, weather: true});
  assert.deepEqual(applyKnob({key: 'sand', value: '1', settings, renderer: r, nodes, seed: 2701}), {weather: true});
  // The draw's rows (Low ground, Shade in creases) only re-read the renderer's uniforms.
  for (const key of ['lowTint', 'lowGrain', 'creaseShade']) assert.deepEqual(applyKnob({key, value: '.5', settings, renderer: r, nodes, seed: 2701}), {});
  // A borrowed beach is chosen when the renderer starts (sculpt-scene.js borrowBeach): the address changes, the renderer does not.
  const applied = r.applied;
  assert.deepEqual(applyKnob({key: 'beachFrom', value: 'zhon', settings, renderer: r, nodes, seed: 2701}), {reload: true});
  assert.equal(settings.get('beachFrom'), 'zhon'); assert.equal(r.variant.has('beachFrom'), false); assert.equal(r.applied, applied);
});

test('Undulation height puts a ground node first on a map without one, and only when it turns on', () => {
  const settings = new URLSearchParams(), r = renderer(), nodes = [{kind: 'landform', points: []}];
  assert.deepEqual(applyKnob({key: 'undulation', value: '0', settings, renderer: r, nodes, seed: 2701}), {});
  assert.equal(nodes.length, 1);
  assert.deepEqual(applyKnob({key: 'undulation', value: '6', settings, renderer: r, nodes, seed: 2701}), {evaluate: 0, checkpoint: true, weather: true});
  assert.deepEqual(nodes[0], {kind: 'ground', amplitude: 6, wavelength: 160, art: 1, seed: 2701 ^ 0x9e37});
  // A new ground node takes the page's Undulation in the art.
  const kept = new URLSearchParams('undulationArt=.25'), more = [];
  applyKnob({key: 'undulation', value: '4', settings: kept, renderer: r, nodes: more, seed: 2701});
  assert.equal(more[0].art, .25);
});

test('Undulation in the art edits the ground node', () => {
  const settings = new URLSearchParams(), r = renderer(), nodes = [{kind: 'ground', amplitude: 8, wavelength: 48, coverage: 1, seed: 1}];
  assert.deepEqual(applyKnob({key: 'undulationArt', value: '0', settings, renderer: r, nodes, seed: 2701}), {evaluate: 0, checkpoint: true, weather: true});
  assert.equal(nodes[0].art, 0);
  assert.equal(settings.get('undulationArt'), '0');
  // No ground node, no undulation: nothing to evaluate.
  assert.deepEqual(applyKnob({key: 'undulationArt', value: '.5', settings, renderer: r, nodes: [], seed: 2701}), {});
});

test('every knob row has a label, a range and a default', () => {
  const keys = KNOBS.flatMap(([, list]) => list.map(k => k[0]));
  assert.equal(new Set(keys).size, keys.length, 'a knob in two groups');
  for (const [title, list] of KNOBS) for (const [key, label, min, max, step, value] of list) {
    assert.ok(title && label, key); assert.ok(min <= value && value <= max && step > 0, `${key}: ${min} ${value} ${max} ${step}`);
  }
});

test('the Colors panel shows the rows a world has, and a cleared row the server sets stays off', () => {
  const config = {layers: ['body'], material: {}, colors: {sun: '#ffffff'}};
  const labels = colorRows(config, new URLSearchParams()).map(([, l]) => l);
  assert.ok(!labels.some(l => /Flower|Vegetation|Beach|Strata|Rock|Crystal/.test(l)), 'vegetation, flowers, rock, crystal and the beds are materials');
  assert.ok(!colorRows({...config, layers: ['beach']}, new URLSearchParams('strata=1')).some(([k]) => ['beach', 'slope', 'sand', 'strata1'].includes(k)), 'a beach, a slope cover and sand take their materials’ colors');
  // Low ground's color shows while its Tint is above 0.
  assert.ok(!labels.includes('Low ground'));
  assert.ok(colorRows(config, new URLSearchParams('lowTint=.5')).some(([k, l]) => k === 'low' && l === 'Low ground'));
  assert.deepEqual(pickWorldColor(config, {ground: '#101010'}, 'shallow', '#c03030'), {ground: '#101010', shallow: '#c03030'});
  assert.deepEqual(pickWorldColor(config, {sun: '#ffc880'}, 'sun', null), {sun: null});
  assert.deepEqual(pickWorldColor(config, {shallow: '#c03030'}, 'shallow', null), {});
});

test("a stroke's water choices count as the world switches they turn on", () => {
  const nodes = [{kind: 'ground'}, {kind: 'landform', params: {waterDeep: 2}}];
  assert.deepEqual(strokeWaterPicks(nodes), {deepEdge: 0, fadedEdge: 1});
  const r = renderer(); r.variant.set('deepEdge', '1');
  const v = worldPanelValues({config: {layers: ['ring'], water: {}}, renderer: r, nodes, colors: {shallow: [1, 0, 0]}, weathering: true, materialWeathering: 0});
  assert.equal(v.deepEdge, 1); assert.equal(v.rampWater, 1);
  assert.equal(v.waterColored, 1); assert.equal(v.waterTones, 2); assert.equal(v.ringLayer, 1); assert.equal(v.beachLayer, 0);
});

test('the column facts follow the active column: the map\'s own, or none', () => {
  const facts = column => worldPanelValues({config: {layers: [], water: {}, column}, renderer: renderer(), nodes: [], colors: {}, weathering: false, materialWeathering: 0});
  assert.equal(facts(undefined).column, 0, 'a world without a column');
  assert.equal(facts({bands: [3.7, 1]}).column, 0, 'contour bands alone are no column');
  assert.equal(facts({bands: [3.7, 1], sections: [{start: 0, beds: [[5, .8, 0], [7, .3, 1]]}]}).column, 1, 'a column the map added');
  assert.equal(facts({sections: []}).column, 0, 'every section removed');
  const rows = {sections: [{start: 0, beds: [[.3, .5, 0], [5.7, .5, 1]]}]};
  assert.equal(facts(rows).column, 1); assert.equal(facts(rows).capBed, 1);
});

// The generic host must not quietly discard a newly introduced non-uniform input.
test('an unknown non-uniform input falls back to shape, while its repeated value stays a no-op',()=>{
  const r=renderer();r.applyKnobs=()=>({fields:[],channels:[],stage:null});const settings=new Map(),nodes=[];
  const first=applyKnob({key:'futureInput',value:'1',settings,renderer:r,nodes,seed:2701});
  assert.equal(first.change.stage,'A');assert.deepEqual(first.change.channels,[{name:'futureInput',stage:'A'}]);
  assert.equal(applyKnob({key:'futureInput',value:'1',settings,renderer:r,nodes,seed:2701}).change.stage,null);
});

function inputClock(){let serial=0;const frames=new Map(),timers=new Map(),applied=[],committed=[];const queue=createWorldInputQueue({apply:b=>applied.push(b),commit:()=>committed.push(applied.at(-1)),requestFrame:fn=>{frames.set(++serial,fn);return serial;},cancelFrame:id=>frames.delete(id),setTimer:fn=>{timers.set(++serial,fn);return serial;},clearTimer:id=>timers.delete(id)});const run=map=>{const f=[...map.values()];map.clear();for(const fn of f)fn();};return {queue,applied,committed,frame:()=>run(frames),pause:()=>run(timers),frames};}
test('World inputs keep only the latest value per row and apply one batch per frame',()=>{
 const c=inputClock();for(let i=0;i<40;i++)c.queue.put('rock',i);c.queue.put('light',.6);
 assert.equal(c.applied.length,0);assert.equal(c.frames.size,1);c.frame();assert.deepEqual(c.applied,[[39,.6]]);assert.equal(c.committed.length,0);assert.equal(c.queue.active,true);c.queue.end();assert.deepEqual(c.committed,[[39,.6]]);assert.equal(c.queue.active,false);
});
test('release waits for queued values, and a pause commits the latest applied state',()=>{
 const c=inputClock();c.queue.put('rain',1);c.queue.end();assert.equal(c.committed.length,0);c.frame();assert.deepEqual(c.committed,[[1]]);c.queue.put('rain',2);c.frame();c.pause();assert.deepEqual(c.committed,[[1],[2]]);
});
test('a handoff flushes pending inputs without leaving a delayed application',()=>{
 const c=inputClock();c.queue.put('color','#778899');c.queue.flush();assert.deepEqual(c.applied,[['#778899']]);assert.deepEqual(c.committed,[['#778899']]);assert.equal(c.queue.pending,false);c.frame();c.pause();assert.equal(c.applied.length,1);assert.equal(c.committed.length,1);
});
