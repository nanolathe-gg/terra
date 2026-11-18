import test from 'node:test';
import assert from 'node:assert/strict';
import {shapePaths,clonePaths,validatePaths,appendPath,extendPoint,insertPoint,removePoint,removePath,pathsWithin} from '../sculpt-paths.js';
import {selectionGeometry} from '../sculpt-selection.js';
import {prepareNode} from '../sculpt-gpu-fields.js';
const line=()=>({kind:'erase',points:[{x:40,y:40},{x:80,y:40},{x:120,y:40}],params:{radius:12,amount:30,rough:0,softness:.5}});
const geom={grid:256,spacing:1},context={seed:1,baseHeight:99,sea:75,params:n=>new Proxy(n.params,{get:(q,k)=>q[k]??0})};

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

test('two shapes\' paths are as far apart as their nearest points: a near miss is no, a crossing or a touch is yes',()=>{
  const P=(x,y)=>({x,y}),flat=[[P(0,0),P(100,0)]],above=[[P(0,100),P(100,100)]];
  assert.equal(pathsWithin(flat,above,99.9),false,'parallel and 100 apart, near but not touching');
  assert.equal(pathsWithin(flat,above,100),true,'exactly the gap: yes');
  assert.equal(pathsWithin(flat,[[P(50,-40),P(50,40)]],0),true,'crossing paths are 0 apart');
  assert.equal(pathsWithin(flat,[[P(150,0)]],49),false,'a click past the end: its distance to the end point');
  assert.equal(pathsWithin(flat,[[P(150,0)]],50),true);
  assert.equal(pathsWithin([[P(0,0)]],[[P(30,40)]],50),true,'two clicks');
  assert.equal(pathsWithin([[P(0,0),P(1000,1000)]],[[P(700,100)]],400),false,'a long diagonal\'s box holds the point, its line does not come near it');
  assert.equal(pathsWithin([[P(0,0),P(1000,1000)]],[[P(700,100)]],425),true);
  assert.equal(pathsWithin([[P(500,500)],[P(0,0),P(10,0)]],[[P(0,20),P(10,20)]],20),true,'any path of a shape with several');
  assert.equal(pathsWithin([[]],flat,1e9),false,'no points, no reach');
});
