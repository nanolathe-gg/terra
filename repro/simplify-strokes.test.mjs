import test from 'node:test';
import assert from 'node:assert/strict';
import {simplifyPath} from '../sculpt-paths.js';

const distance=(p,a,b)=>{
  const dx=b.x-a.x,dy=b.y-a.y,l2=dx*dx+dy*dy;
  const t=l2?Math.max(0,Math.min(1,((p.x-a.x)*dx+(p.y-a.y)*dy)/l2)):0;
  return Math.hypot(p.x-a.x-t*dx,p.y-a.y-t*dy);
};
// Check each original sample against the segment that replaces it, rather
// than a nearby segment from a different part of a looping stroke.
function withinTolerance(points,reduced,tolerance){
  let start=0;
  for(let i=1;i<reduced.length;i++){
    const end=points.indexOf(reduced[i],start+1);
    for(let k=start;k<=end;k++)assert.ok(distance(points[k],reduced[i-1],reduced[i])<=tolerance+1e-9);
    start=end;
  }
  assert.equal(start,points.length-1);
}

test('dense straight strokes retain only their exact endpoints',()=>{
  const points=Array.from({length:1000},(_,i)=>({x:i,y:20+Math.sin(i)*.5})),before=structuredClone(points);
  assert.deepEqual(simplifyPath(points,3),[points[0],points.at(-1)]);
  assert.deepEqual(points,before);
});
test('curves lose most handles while every sampled span stays within three pixels',()=>{
  const points=Array.from({length:501},(_,i)=>({x:100+i*1.6,y:300+Math.sin(i/60)*100}));
  const reduced=simplifyPath(points,3);
  assert.equal(reduced[0],points[0]);assert.equal(reduced.at(-1),points.at(-1));
  assert.ok(reduced.length<points.length/10);
  withinTolerance(points,reduced,3);
});
test('sharp corners, hairpins, and closed loops retain their shape',()=>{
  for(const coords of [
    [[0,0],[30,0],[60,0],[90,0],[90,30],[90,60],[90,90]],
    [[0,0],[30,0],[60,0],[90,0],[60,1],[30,1],[0,1]],
    Array.from({length:121},(_,i)=>[100*Math.cos(i*Math.PI/60),100*Math.sin(i*Math.PI/60)]),
    Array.from({length:201},(_,i)=>[100*Math.sin(i*Math.PI/100),100*Math.sin(i*Math.PI/50)])
  ]){
    const points=coords.map(([x,y])=>({x,y})),reduced=simplifyPath(points,3);
    assert.ok(reduced.length>=3);assert.ok(reduced.length<points.length);
    withinTolerance(points,reduced,3);
  }
});
test('clicks, short strokes, duplicates, and long strokes are safe',()=>{
  for(const points of [[],[{x:2,y:3}],[{x:2,y:3},{x:4,y:5}]]){
    const reduced=simplifyPath(points,3);assert.deepEqual(reduced,points);assert.notEqual(reduced,points);
  }
  const duplicates=Array.from({length:100},()=>({x:10,y:10}));
  assert.deepEqual(simplifyPath(duplicates,3),[duplicates[0],duplicates.at(-1)]);
  const long=Array.from({length:100000},(_,i)=>({x:i,y:i/2}));
  assert.equal(simplifyPath(long,3).length,2);
});
