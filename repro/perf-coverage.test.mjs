import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createCoverage,pictureCurrent,finalQualityObservations} from './perf-coverage.mjs';
const view=[{x:0,y:0,width:100,height:100}];
test('four partial blocks cover the view only after the fourth actual paint',()=>{const c=createCoverage();for(const [i,r] of [[0,0],[50,0],[0,50],[50,50]].entries()){c.paint({x:r[0],y:r[1],width:50,height:50},{serial:1});assert.equal(c.covered(view,r=>r.serial>=1),i===3);}});
test('overlapping pictures do not hide a missing strip',()=>{const c=createCoverage();c.paint({x:0,y:0,width:80,height:100},{serial:1});c.paint({x:10,y:0,width:80,height:100},{serial:1});assert.equal(c.covered(view),false);});
test('stale overpaint invalidates fresh coverage until repaired',()=>{const c=createCoverage();c.paint(view[0],{serial:2});c.paint({x:20,y:20,width:10,height:10},{serial:1});assert.equal(c.covered(view,r=>r.serial>=2),false);c.paint({x:20,y:20,width:10,height:10},{serial:2});assert.equal(c.covered(view,r=>r.serial>=2),true);c.reset();assert.equal(c.covered(view),false);});
test('clipped block cannot credit its unpainted extent or an empty target',()=>{const c=createCoverage();c.paint({x:0,y:0,width:50,height:100},{serial:2});assert.equal(c.covered(view),false);assert.equal(c.covered([{x:0,y:0,width:50,height:100}]),true);assert.equal(c.covered([]),false);});

test('current serial cannot credit old Time settings or a Fit backdrop',()=>{
 const input={native:true,nativeSerial:12,worldRev:{B:3}};
 const image={serial:12,current:true,canvasSerial:12,weathered:true,weatherRevB:2};
 assert.equal(pictureCurrent(image,input),false);
 assert.equal(pictureCurrent({...image,weatherRevB:3},input),true);
 assert.equal(pictureCurrent({...image,weatherRevB:3,eligible:false},input),false);
 assert.equal(pictureCurrent({...image,weatherRevB:undefined},input),false);
 assert.equal(pictureCurrent({...image,weathered:false},input),true);
 assert.equal(pictureCurrent({...image,serial:10,weatherRevB:3},input),true);
});

test('final-quality input coverage waits for native pixels and rejects coarse overpaint',()=>{
 const c=createCoverage(),input={id:1,t:10,native:true,nativeSerial:4},events=[];
 const paint=(t,rect,level,serial)=>{c.paint(rect,{level,serial});events.push({type:'coverage',t,ready:true,regions:c.snapshot()});};
 paint(11,view[0],4,4);paint(12,{x:0,y:0,width:50,height:100},1,4);
 paint(13,view[0],4,5);paint(14,{x:50,y:0,width:50,height:100},1,5);
 assert.deepEqual(finalQualityObservations({inputs:[input],events,view:view[0]}).samples,[]);
 paint(15,{x:0,y:0,width:50,height:100},1,5);
 assert.deepEqual(finalQualityObservations({inputs:[input],events,view:view[0]}).samples,[5]);
});
test('final-quality samples preserve unfinished inputs and newer weather requirements',()=>{
 const inputs=[{id:1,t:10,native:true,nativeSerial:4,worldRev:{B:2}},{id:2,t:12,native:true,nativeSerial:5,worldRev:{B:3}}];
 const events=[{type:'coverage',t:13,ready:true,regions:[{...view[0],serial:5,level:1,weathered:true,weatherRevB:2,dirty:true}]}];
 const r=finalQualityObservations({inputs,events,view:view[0]});
 assert.deepEqual(r.samples,[3]);assert.equal(r.observations[1].final,null);
 // Being dirty for a later input cannot revoke a real image for an older one.
 assert.equal(r.observations[0].final,13);
});
