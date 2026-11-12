import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createCoverage} from './perf-coverage.mjs';
const view=[{x:0,y:0,width:100,height:100}];
test('four partial blocks cover the view only after the fourth actual paint',()=>{const c=createCoverage();for(const [i,r] of [[0,0],[50,0],[0,50],[50,50]].entries()){c.paint({x:r[0],y:r[1],width:50,height:50},{serial:1});assert.equal(c.covered(view,r=>r.serial>=1),i===3);}});
test('overlapping pictures do not hide a missing strip',()=>{const c=createCoverage();c.paint({x:0,y:0,width:80,height:100},{serial:1});c.paint({x:10,y:0,width:80,height:100},{serial:1});assert.equal(c.covered(view),false);});
test('stale overpaint invalidates fresh coverage until repaired',()=>{const c=createCoverage();c.paint(view[0],{serial:2});c.paint({x:20,y:20,width:10,height:10},{serial:1});assert.equal(c.covered(view,r=>r.serial>=2),false);c.paint({x:20,y:20,width:10,height:10},{serial:2});assert.equal(c.covered(view,r=>r.serial>=2),true);c.reset();assert.equal(c.covered(view),false);});
test('clipped block cannot credit its unpainted extent or an empty target',()=>{const c=createCoverage();c.paint({x:0,y:0,width:50,height:100},{serial:2});assert.equal(c.covered(view),false);assert.equal(c.covered([{x:0,y:0,width:50,height:100}]),true);assert.equal(c.covered([]),false);});
