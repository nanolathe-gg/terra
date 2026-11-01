import test from 'node:test';
import assert from 'node:assert/strict';
import {CV_N, FORMS, FORM_NAMES, knotCurve, sampleKnots, strokeCurve, strokeKnots} from '../sculpt-shape-presets.js';

test('knots become the table: it passes through every knot and holds the ends flat',()=>{
 const knots=[[0,0],[.3,.1],[.7,.8],[1,1]],t=sampleKnots(knots),f=knotCurve(knots);
 assert.equal(t.length,CV_N+3);
 for(const [x,y] of knots)assert.ok(Math.abs(f(x)-y)<1e-12);
 assert.equal(t[0],0);assert.equal(t[CV_N+2],1);
 for(let j=1;j<t.length;j++)assert.ok(t[j]>=t[j-1]-1e-12,'monotone data stays monotone');
});
test('a lip knot above 1 does not ring: the curve stays within the knot heights',()=>{
 const f=knotCurve([[0,0],[.5,.9],[.8,1.3],[1,1]]);
 let lo=1,hi=0;for(let i=0;i<=400;i++){const v=f(i/400);lo=Math.min(lo,v);hi=Math.max(hi,v);}
 assert.ok(lo>=0&&hi<=1.3+1e-9);
 assert.equal(strokeCurve('plateau',{softness:.5,curve:{form:'plateau',knots:[[0,0],[.8,1.3],[1,1]]},terraces:0},{shouldered:false}).u.cvLip,1);
 assert.equal(strokeCurve('plateau',{softness:.5,terraces:0},{shouldered:false}).u.cvLip,0);
});
test('every form is a knot list from the foot to the top, and mountain follows softness',()=>{
 for(const name of FORM_NAMES){
  const k=FORMS[name](.5).knots;
  assert.equal(k[0][0],0);assert.equal(k.at(-1)[0],1);
  for(let i=1;i<k.length;i++)assert.ok(k[i][0]>k[i-1][0]);
 }
 assert.notDeepEqual(FORMS.mountain(0).knots,FORMS.mountain(1).knots);
 assert.deepEqual(strokeKnots('mountain',{softness:.5},false).knots,FORMS.mountain(.5).knots);
 assert.deepEqual(strokeKnots('plateau',{softness:.5,curve:{form:'cliff'}},false).knots,FORMS.cliff(.5).knots);
 const own=[[0,0],[1,1]];assert.deepEqual(strokeKnots('plateau',{softness:.5,curve:{form:'cliff',knots:own}},false).knots,own);
});

import {leanSetup} from '../sculpt-shape-presets.js';
test('lean: the plateau family keeps the old north term by default, facing picks a bearing or a side',()=>{
 assert.equal(leanSetup('plateau',{}).k,.7);assert.equal(leanSetup('mountain',{}).k,0);
 assert.deepEqual([leanSetup('plateau',{}).bx,leanSetup('plateau',{}).by],[0,-1]);
 assert.equal(leanSetup('plateau',{lean:1}).k,0);assert.equal(leanSetup('mountain',{lean:3}).k,2);
 assert.deepEqual([leanSetup('hill',{facing:5}).bx,leanSetup('hill',{facing:5}).by],[1,0]);
 assert.equal(leanSetup('hill',{facing:1}).side,1);assert.equal(leanSetup('hill',{facing:2}).side,-1);
});
