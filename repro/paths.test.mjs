import test from 'node:test';
import assert from 'node:assert/strict';
import {shapePaths,clonePaths,validatePaths,appendPath,extendPoint,insertPoint,removePoint,removePath} from '../sculpt-paths.js';
import {selectionGeometry} from '../sculpt-selection.js';
import {prepareNode} from '../sculpt-gpu-fields.js';
const line=()=>({kind:'mountain',points:[{x:40,y:40},{x:80,y:40},{x:120,y:40}],params:{radius:12,amount:30,rough:0,softness:.5}});
const geom={grid:256,spacing:1},context={seed:1,baseHeight:99,sea:75,params:n=>new Proxy(n.params,{get:(q,k)=>q[k]??(k==='crown'?.5:0)})};

test('legacy shapes keep one path; disconnected additions have no bridging edge',()=>{
  const n=line();assert.deepEqual(shapePaths(n),[[0,1,2]]);
  appendPath(n,[{x:40,y:180},{x:120,y:180}]);validatePaths(n);
  assert.deepEqual(n.paths,[[0,1,2],[3,4]]);
  const p=prepareNode(n,geom,context);assert.equal(p.op,'stamp');assert.equal(p.multi,undefined);
  for(const s of p.segs)assert.equal(s.py,s.ey);
  const overlay=selectionGeometry(n,p=>p,{x:0,y:0,width:256,height:256,scale:1});
  assert.deepEqual(overlay.paths,n.paths);
});
test('an interior branch shares its root and an endpoint extends only its path',()=>{
  const n=line(),a=extendPoint(n,1,{x:80,y:80},0);
  assert.deepEqual(n.paths,[[0,1,2],[1,3]]);assert.deepEqual(a,{path:1,point:3});
  n.points[1].y=45;assert.equal(n.points[n.paths[1][0]].y,45);
  extendPoint(n,a.point,{x:80,y:120},a.path);
  assert.deepEqual(n.paths,[[0,1,2],[1,3,4]]);validatePaths(n);
  const before=JSON.stringify(n),copy={...n,points:n.points.map(p=>({...p})),paths:clonePaths(n)};
  extendPoint(copy,0,{x:10,y:40},0);assert.equal(JSON.stringify(n),before);
});
test('insert, delete and remove paths preserve valid shared references and round-trip',()=>{
  const n=line();appendPath(n,[{x:80,y:80}],1);
  const i=insertPoint(n,0,1);assert.equal(i,4);assert.deepEqual(n.paths,[[0,1,4,2],[1,3]]);
  removePoint(n,1);validatePaths(n);assert.equal(n.points.length,4);
  removePath(n,0);validatePaths(n);assert.equal(n.points.length,1);assert.deepEqual(n.paths,[[0]]);
  assert.equal(removePoint(n,0),false);assert.equal(removePath(n,0),false);
  const loaded=JSON.parse(JSON.stringify(n));validatePaths(loaded);assert.deepEqual(loaded,n);
});
test('path input rejects malformed references before evaluation',()=>{
  for(const paths of [[],[[]],[[0,4]],[[0,-1]],[[0,1.5]],[[0,1]],'bad'])assert.throws(()=>validatePaths({...line(),paths}));
  assert.throws(()=>validatePaths({...line(),points:[{x:NaN,y:0}]}));
});
test('ramps have independent endpoint reads in a single operation',()=>{
  const n={...line(),kind:'ramp'};appendPath(n,[{x:40,y:180},{x:120,y:180}]);
  const p=prepareNode(n,geom,context);assert.equal(p.multi,undefined);
  assert.deepEqual(p.reads,[{x:40,y:40},{x:120,y:40},{x:40,y:180},{x:120,y:180}]);
  assert.deepEqual([...new Set(p.segs.map(s=>s.f1[1]))],[0,2]);
});
test('mixed short and long hill paths retain their own tangent frames',()=>{
  const n={...line(),kind:'hill'};appendPath(n,[{x:70,y:70},{x:70,y:120}]);
  const p=prepareNode(n,geom,context);assert.equal(p.settle,true);
  assert.ok(p.segs.every(s=>s.frame));assert.ok(p.segs.every(s=>s.f0.every(Number.isFinite)&&s.f1.every(Number.isFinite)));
});
