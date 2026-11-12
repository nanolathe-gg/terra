import test from 'node:test';
import assert from 'node:assert/strict';
import {uniformStages,worldUniformDelta} from '../sculpt-gates.js';

test('stage scan follows calls, keeps gated reads, separates geometry, and ignores unused code',()=>{
 const fragment=`
 /* fn fake(){return u.comment;} /* nested */ */
 fn color(){if(u.on>0.0){return u.tint;}return 0.0;}
 fn geometry(){return u.form;}
 fn unused(){return u.never;}
 @fragment fn fragmentMain()->@location(0) f32{return color()+geometry();}`;
 const compute=`fn indirect(){return u.rock[slot & mask].faceWear+u.form;}
 @compute @workgroup_size(8,8) fn bakeMain(){indirect();}`;
 const stages=uniformStages([{source:fragment,stage:'F'},{source:fragment,stage:'E',roots:['geometry']},{source:compute,stage:'C'}]);
 assert.deepEqual(Object.fromEntries([...stages].map(([name,v])=>[name,v.stage])),{on:'F',tint:'F',form:'C',faceWear:'C'});
 assert.deepEqual(stages.get('form').entries,['fragmentMain','geometry','bakeMain']);
 assert(!stages.has('never')&&!stages.has('comment'));
 assert.throws(()=>uniformStages([{source:fragment,stage:'E',roots:['missing']}]),/Missing stage root/);
});

test('world comparison ignores chunk flags and names changed rock slots once',()=>{
 const scalar=offset=>({offset,width:1,count:1,stride:0,kind:'f'});
 const layout={fields:new Map([['ambient',scalar(0)],['paintOn',scalar(4)],['chunkScale',scalar(8)],['rock',{offset:16,count:2,stride:16,kind:'struct',members:new Map([['faceWear',scalar(0)]])}],['faceWear',scalar(16)]])};
 const stages=new Map([['ambient',{stage:'F'}],['faceWear',{stage:'D'}]]),before=new Uint32Array(12),after=new ArrayBuffer(48),v=new DataView(after);
 v.setFloat32(0,.4,true);v.setInt32(4,1,true);v.setFloat32(8,2,true);v.setFloat32(32,.7,true);
 assert.deepEqual(worldUniformDelta(before,after,layout,stages),{fields:[{name:'ambient',stage:'F'},{name:'rock[1].faceWear',stage:'D'}],stage:'D',rockSlots:[1]});
 assert.deepEqual(worldUniformDelta(new Uint32Array(after),after,layout,stages),{fields:[],stage:null,rockSlots:[]});
});
