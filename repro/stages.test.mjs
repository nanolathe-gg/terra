import test from 'node:test';
import assert from 'node:assert/strict';
import {uniformStages} from '../sculpt-gates.js';

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
