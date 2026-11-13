import test from 'node:test';
import assert from 'node:assert/strict';
import {alignedFieldRegion} from '../sculpt-chunk-renderer.js';
test('neighboring preview aprons share sample positions at every coarse level',()=>{
 const a={fieldsX:0,fieldsY:53,fieldsWidth:1230,fieldsHeight:1127},b={...a,fieldsX:307,fieldsWidth:718};
 for(const level of [2,4,8]){const x=alignedFieldRegion(a,level),y=alignedFieldRegion(b,level);assert.equal((y.fieldsX-x.fieldsX)%level,0);assert.equal((y.fieldsY-x.fieldsY)%level,0);assert(y.fieldsX<=b.fieldsX);assert(y.fieldsX+y.fieldsWidth>=b.fieldsX+b.fieldsWidth);assert.equal(alignedFieldRegion(y,level),y);}
});
test('final and finer field bounds are exactly the original object',()=>{
 const r={fieldsX:307,fieldsY:53,fieldsWidth:718,fieldsHeight:1127};for(const level of [1,.5,.25])assert.equal(alignedFieldRegion(r,level),r);
});
