import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {preprocess} from '../sculpt-renderer.js';

test('the color shader reads only the packed mask channels it retains',()=>{
  const file=name=>readFileSync(new URL('../'+name,import.meta.url),'utf8');
  const source=preprocess(file('engine-frag.wgsl').replace('/*VOLUME*/',file('engine-volume.wgsl')),file('engine-common.wgsl'),new Set(['VOLUME_RENDER','COLOR_PASS'])).replace(/\/\*[\s\S]*?\*\/|\/\/[^\n]*/g,'');
  // Raw masks are deliberately absent from a retained F snapshot. A new raw
  // read must fail here rather than silently sampling its zero placeholder.
  for(const use of source.matchAll(/\bmasksTex\b/g))assert.match(source.slice(use.index),/^masksTex\s*:/,'color cannot read raw masks');
  let reads=0;
  for(const use of source.matchAll(/\bsampleMasks\s*\(/g)){
    if(/\bfn\s*$/.test(source.slice(0,use.index)))continue;
    const start=use.index+use[0].length,args=[];let depth=0,at=start,end=start;
    for(;end<source.length;end++){
      const c=source[end];if(c==='(')depth++;else if(c===')'){if(depth===0){args.push(source.slice(at,end).trim());break;}depth--;}
      else if(c===','&&depth===0){args.push(source.slice(at,end).trim());at=end+1;}
    }
    const layer=Number(args[1]);assert(Number.isInteger(layer)&&layer>=0&&layer<=5,'new mask layer needs a packing dependency audit');
    const channel={1:'g',2:'b',3:'w',5:'r'}[layer];
    if(channel)assert.match(source.slice(end+1),new RegExp('^\\s*\\.'+channel+'\\b'),'new mask component needs a packing dependency audit');
    reads++;
  }
  assert(reads>0,'the actual preprocessed color shader must be inspected');
});

test('the color shader reads only its three retained weather/material layers',()=>{
  const file=name=>readFileSync(new URL('../'+name,import.meta.url),'utf8');
  const source=preprocess(file('engine-frag.wgsl').replace('/*VOLUME*/',file('engine-volume.wgsl')),file('engine-common.wgsl'),new Set(['VOLUME_RENDER','COLOR_PASS'])).replace(/\/\*[\s\S]*?\*\/|\/\/[^\n]*/g,'');
  let reads=0;
  for(const use of source.matchAll(/\bgridTex\b/g)){
    const tail=source.slice(use.index);if(/^gridTex\s*:/.test(tail))continue;
    // The ground id rides in the fall layer's blue (COLOR_INPUT_PACK), read by cell.
    if(/^gridTex\s*,\s*at\s*,\s*2\s*,\s*0\s*\)\s*\.b\b/.test(tail)){reads++;continue;}
    assert.match(tail,/^gridTex\s*,\s*regionalPoint\(uv\)\s*,\s*[012]\s*\)/,'a new grid read needs a packing dependency audit');reads++;
  }
  assert(reads>0,'inspect the actual preprocessed color shader');
});
