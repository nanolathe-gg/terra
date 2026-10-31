import test from 'node:test';
import assert from 'node:assert/strict';
import {selectionTransform,selectionGeometry,hitSelection} from '../sculpt-selection.js';

const near=(a,b)=>assert.ok(Math.abs(a-b)<1e-8,`${a} != ${b}`);
const apply=(m,p)=>({x:m[0]*p.x+m[2]*p.y+m[4],y:m[1]*p.x+m[3]*p.y+m[5]});
const node={points:[{x:100,y:120},{x:140,y:160}],params:{radius:20}};
const identity=p=>({...p});
const view={x:0,y:0,width:300,height:300,scale:1};

test('absolute transforms position, rotate and scale around the stroke centre',()=>{
  const {values,matrix}=selectionTransform(node,{x:160,y:180,rotation:90,scale:200});
  assert.deepEqual(values,{x:120,y:140,rotation:0,scale:100});
  const centre=apply(matrix,{x:120,y:140});near(centre.x,160);near(centre.y,180);
  const start=apply(matrix,node.points[0]);near(start.x,200);near(start.y,140);
  near(Math.hypot(matrix[0],matrix[1]),2);
});

test('entering the current transform is a no-op, including an existing rotation/scale',()=>{
  const angle=.7,k=1.3;
  const existing={...node,frame:[Math.cos(angle)*k,Math.sin(angle)*k,-Math.sin(angle)*k,Math.cos(angle)*k,50,80]};
  const {values}=selectionTransform(existing),{matrix}=selectionTransform(existing,values);
  matrix.forEach((value,i)=>near(value,[1,0,0,1,0,0][i]));
  const target=selectionTransform(existing,{scale:260,rotation:values.rotation+90});
  near(Math.hypot(target.matrix[0],target.matrix[1]),2);near(target.matrix[0],0);
  near(apply(target.matrix,{x:120,y:140}).x,120);
});

test('transforms reject invalid input and handle long drawn paths',()=>{
  for(const changes of [{x:NaN},{rotation:Infinity},{scale:0},{scale:-2}])assert.throws(()=>selectionTransform(node,changes));
  const long={points:Array.from({length:160000},(_,x)=>({x,y:10}))};
  assert.equal(selectionTransform(long).values.x,79999.5);
});

test('the drawn handles are clickable at a constant screen tolerance at every zoom',()=>{
  for(const scale of [.1,.5,1,4]){
    const g=selectionGeometry(node,p=>({x:p.x,y:p.y-30}),{x:120-150/scale,y:110-150/scale,width:300/scale,height:300/scale,scale});
    for(const [key,action] of [['move','move'],['rotate','rotate'],['resize','scale']]){
      assert.deepEqual(hitSelection(g,g[key]),{action});
      assert.deepEqual(hitSelection(g,{x:g[key].x+9/scale,y:g[key].y}),{action});
      assert.notEqual(hitSelection(g,{x:g[key].x+11/scale,y:g[key].y})?.action,action);
    }
  }
});

test('path mode picks the nearest visible point and never a transform handle',()=>{
  const g=selectionGeometry(node,identity,view);
  assert.deepEqual(hitSelection(g,{x:101,y:122},true),{action:'point',index:0});
  assert.equal(hitSelection(g,g.rotate,true),null);
  assert.equal(hitSelection(g,{x:200,y:200},true),null);
});

test('hidden/offscreen strokes cannot be hit; partially visible strokes keep usable handles',()=>{
  assert.equal(selectionGeometry({...node,hidden:true},identity,view),null);
  const far=selectionGeometry(node,identity,{...view,x:1000});
  assert.equal(hitSelection(far,far.move),null);
  for(const y of [-200,500]){
    const g=selectionGeometry({points:[{x:150,y}],params:{radius:400}},identity,view);
    assert.ok(g.visible);
    for(const key of ['move','rotate','resize']){
      assert.ok(g[key].x>=18&&g[key].x<=282);assert.ok(g[key].y>=18&&g[key].y<=282);
    }
    assert.ok(Math.hypot(g.move.x-g.rotate.x,g.move.y-g.rotate.y)>=28);
  }
});
