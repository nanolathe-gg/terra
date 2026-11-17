import test from 'node:test';
import assert from 'node:assert/strict';
import {pictureWork} from './perf-pictures.mjs';
test('presented pictures ignore repaints and overlapping GPU passes count once',()=>{
 const events=[{type:'coverage',t:10,fresh:true},{type:'paint',t:10,fresh:true},{type:'coverage',t:15,fresh:false},{type:'coverage',t:30,fresh:true}];
 const pass=(label,a,b)=>({label,cpuStart:a,cpuEnd:b});
 const p=pictureWork(events,[pass('shape passes',-5,5),pass('voxel',3,15),pass('geometry',10,20),pass('shape passes',25,50)],0,40);
 assert.equal(p.pictures,2);assert.deepEqual(p.gapsMs,[20]);assert.equal(p.gpuBusyMs,35);assert.equal(p.busyPerPictureMs,17.5);
 assert.deepEqual(p.passesPerPicture['shape passes'],{count:2,perPicture:1,msPerPicture:10});
 assert.equal(pictureWork([],[],0,40).busyPerPictureMs,null);
});
