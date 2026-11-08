import test from 'node:test';
import assert from 'node:assert/strict';
import {CV_N, FORMS, knotCurve, sampleKnots, strokeCurve, strokeKnots} from '../sculpt-shape-presets.js';

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
 assert.equal(strokeCurve('landform',{softness:.5,curve:{form:'lfPlateau',knots:[[0,0],[.8,1.3],[1,1]]},terraces:0}).u.cvLip,1);
 assert.equal(strokeCurve('erase',{softness:.5,terraces:0}).u.cvLip,0);
});
test('every form is a knot list from the foot to the top',()=>{
 for(const name of Object.keys(FORMS)){
  const k=FORMS[name](.5).knots;
  assert.equal(k[0][0],0);assert.equal(k.at(-1)[0],1);
  for(let i=1;i<k.length;i++)assert.ok(k[i][0]>k[i-1][0]);
 }
 assert.deepEqual(strokeKnots('landform',{softness:.5,curve:{form:'cliff'}}).knots,FORMS.cliff(.5).knots);
 const own=[[0,0],[1,1]];assert.deepEqual(strokeKnots('landform',{softness:.5,curve:{form:'cliff',knots:own}}).knots,own);
});

import {leanSetup} from '../sculpt-shape-presets.js';
test('lean: Reset ground and the cover brushes keep the old north term by default, facing picks a bearing or a side',()=>{
 assert.equal(leanSetup('erase',{}).k,.7);assert.equal(leanSetup('landform',{}).k,0);
 assert.deepEqual([leanSetup('erase',{}).bx,leanSetup('erase',{}).by],[0,-1]);
 assert.equal(leanSetup('erase',{lean:1}).k,0);assert.equal(leanSetup('landform',{lean:3}).k,2);
 assert.deepEqual([leanSetup('landform',{facing:5}).bx,leanSetup('landform',{facing:5}).by],[1,0]);
 assert.equal(leanSetup('landform',{facing:1}).side,1);assert.equal(leanSetup('landform',{facing:2}).side,-1);
});

import {variability} from '../sculpt-shape-presets.js';
test('variability: the per-kind constants of the brushes, a crater\'s spurs and the rest',()=>{
 const v=variability('erase',{naturalPlateau:true});
 assert.deepEqual([v.amp,v.wK,v.wLo,v.wHi,v.hgtA,v.hgtB],[.95,1.3,.55,1.7,0,0]);
 const s=variability('spurs',{});assert.deepEqual([s.amp,s.wK,s.hgtA,s.hgtB],[.2,0,0,.09]);
 const l=variability('landform',{});assert.deepEqual([l.amp,l.wK,l.wLo,l.wHi,l.hgtA,l.hgtB],[.2,0,1,1,0,0]);
});

test('Shallow water\'s shelf: a ford wide enough to wade and a pool whose dry bank vehicles can climb',()=>{
 // The units the passability view checks (sculpt-passability.js): vehicles and KBots wade up to 12 deep and climb a 16 px cell whose four corner
 // heights span at most 15. Green's plain is 99, its sea 75; the default Shallow stroke is 200 px wide with its bed 7 under the sea.
 const f=knotCurve(FORMS.lfShelf().knots),R=100,sea=75,bed=68;
 for(let i=0;i<=100;i++)if(i/100>=.55)assert.ok(f(i/100)>.9999,'level over the inner 45% of the half width');
 // A ford raised over a deep bed at 20: at any offset, five corners across it stand at most 12 deep (a 4 x 4 footprint fits).
 for(const ox of [0,4,8,12]){let n=0;for(let x=-8;x<=8;x++){const d=Math.abs(x*16-ox);if(d<R&&20+(bed-20)*f(1-d/R)>=sea-12)n++;}assert.ok(n>=5,`ford corners at offset ${ox}: ${n}`);}
 // A round pool flattened into the plain: every dry cell's span stays within 15, whichever way the lattice falls.
 let worst=0;
 for(const ox of [0,4,8,12])for(const oy of [0,5,11]){
  const h=(X,Y)=>{const r=Math.hypot(X-ox,Y-oy);return r>=R?99:99-(99-bed)*f(1-r/R);};
  for(let z=-8;z<8;z++)for(let x=-8;x<8;x++){const c=[h(x*16,z*16),h(x*16+16,z*16),h(x*16,z*16+16),h(x*16+16,z*16+16)];if(Math.min(...c)>=sea)worst=Math.max(worst,Math.max(...c)-Math.min(...c));}
 }
 assert.ok(worst<=15,`worst dry span ${worst.toFixed(1)}`);
});
