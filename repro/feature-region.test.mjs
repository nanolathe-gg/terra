import test from 'node:test';
import assert from 'node:assert/strict';
import {featureRegionBounds} from '../sculpt-features.js';

test('brush bounds include every possible accepted cell centre, including edges and segments',()=>{
 for(const [points,radius] of [[[[5,5],[800,700]],64],[[[-90,-20],[0,40]],200],[[[20479,20479]],180]]){
  const b=featureRegionBounds({type:'brush',points,radius},1280,1280,128);
  for(const p of points)for(let x=Math.max(0,Math.floor((p[0]-radius)/16));x<Math.min(1280,Math.ceil((p[0]+radius)/16));x++)for(let z=Math.max(0,Math.floor((p[1]-radius)/16));z<Math.min(1280,Math.ceil((p[1]+radius)/16));z++){
   if(Math.hypot(x*16+8-p[0],z*16+8-p[1])<=radius)assert.ok(x>=b.x0&&x<b.x1&&z>=b.z0&&z<b.z1);
  }
  assert.ok(b.x0>=0&&b.z0>=0&&b.x1<=1280&&b.z1<=1280);
 }
});
test('flood retains complete connectivity; invalid and empty regions remain safe',()=>{
 assert.deepEqual(featureRegionBounds({type:'flood'},1280,1280,0),{x0:0,z0:0,x1:1280,z1:1280});
 assert.deepEqual(featureRegionBounds({type:'lasso',points:[]},1280,1280,0),{x0:0,z0:0,x1:0,z1:0});
 assert.throws(()=>featureRegionBounds({type:'brush',points:[[NaN,4]]},128,128,10),/invalid point/);
 assert.throws(()=>featureRegionBounds({type:'unknown'},128,128,10),/Choose/);
});
