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
 const compute=`fn indirect(){return u.rock[slot & mask].faceWear+u.form+u.table[u.rock[slot & mask].columnFirst].x;}
 @compute @workgroup_size(8,8) fn bakeMain(){indirect();}`;
 const stages=uniformStages([{source:fragment,stage:'F'},{source:fragment,stage:'E',roots:['geometry']},{source:compute,stage:'C'}]);
 assert.deepEqual(Object.fromEntries([...stages].map(([name,v])=>[name,v.stage])),{on:'F',tint:'F',form:'C',faceWear:'C',table:'C',columnFirst:'C'});
 assert.deepEqual(stages.get('form').entries,['fragmentMain','geometry','bakeMain']);
 assert(!stages.has('never')&&!stages.has('comment'));
 assert.throws(()=>uniformStages([{source:fragment,stage:'E',roots:['missing']}]),/Missing stage root/);
});

test('world comparison ignores chunk flags and names changed rock slots once',()=>{
 const scalar=offset=>({offset,width:1,count:1,stride:0,kind:'f'});
 const layout={fields:new Map([['ambient',scalar(0)],['paintOn',scalar(4)],['chunkScale',scalar(8)],['grid',scalar(12)],['rock',{offset:16,count:2,stride:16,kind:'struct',members:new Map([['faceWear',scalar(0)]])}],['faceWear',scalar(16)]])};
 const stages=new Map([['ambient',{stage:'F'}],['faceWear',{stage:'D'}],['grid',{stage:'C'}]]),before=new Uint32Array(12),after=new ArrayBuffer(48),v=new DataView(after);
 v.setFloat32(0,.4,true);v.setInt32(4,1,true);v.setFloat32(8,2,true);v.setFloat32(32,.7,true);v.setFloat32(12,2121,true);
 assert.deepEqual(worldUniformDelta(before,after,layout,stages),{fields:[{name:'ambient',stage:'F'},{name:'rock[1].faceWear',stage:'D'}],stage:'D',rockSlots:[1]});
 assert.deepEqual(worldUniformDelta(new Uint32Array(after),after,layout,stages),{fields:[],stage:null,rockSlots:[]});
});

test('a Ground member counts apart, a whole-slot read counts for every member, and a member change is seen',()=>{
 const fragment=`fn pigment(){let r=u.ground[slot & groundMask];return r.palette[0].x;}
 @fragment fn fragmentMain()->@location(0) f32{return pigment()+u.ground[slot & groundMask].finish.x;}`;
 const compute=`@compute @workgroup_size(8,8) fn bakeMain(){let l=u.ground[slot & groundMask].cacheLayer;}`;
 const stages=uniformStages([{source:fragment,stage:'F'},{source:compute,stage:'C'}]);
 assert.deepEqual(Object.fromEntries([...stages].map(([name,v])=>[name,v.stage])),{ground:'F','ground.finish':'F','ground.cacheLayer':'C'});
 const scalar=offset=>({offset,width:1,count:1,stride:0,kind:'f'});
 const layout={fields:new Map([['ground',{offset:0,count:2,stride:16,kind:'struct',members:new Map([['cacheLayer',scalar(0)],['palette',scalar(4)]])}]])};
 const before=new Uint32Array(8),after=new ArrayBuffer(32),v=new DataView(after);
 v.setFloat32(16+4,.5,true);   // slot 1's palette
 assert.deepEqual(worldUniformDelta(before,after,layout,stages),{fields:[{name:'ground.palette',stage:'F'}],stage:'F',rockSlots:[]});
 v.setInt32(0,3,true);   // slot 0's cache layer
 assert.deepEqual(worldUniformDelta(before,after,layout,stages).stage,'C');
});
