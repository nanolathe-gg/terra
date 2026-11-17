import test from 'node:test';
import assert from 'node:assert/strict';
import {drawMapBounds} from '../sculpt-map.js';
const map={playRight:4096,playBottom:4096,height:4224},config={baseHeight:84,seaLevel:75,heightBounds:[-90,375]};
const trace=(view,sample=()=>160)=>{
 let reads=0;const paths=[],ink={save(){},restore(){},setLineDash(){},strokeRect(){},beginPath(){paths.push([]);},moveTo(x,y){paths.at(-1).push([x,y]);},lineTo(x,y){paths.at(-1).push([x,y]);},stroke(){}};
 drawMapBounds(ink,map,config,(...a)=>{reads++;return sample(...a);},view);return {paths,reads};
};
test('off-screen north and south map edges require no terrain samples',()=>{
 assert.equal(trace({x:200,y:500,width:1200,height:1000}).reads,0);
 assert(trace(null).reads>500);
});
test('a visible edge samples only its clipped global grid, with the same projected points',()=>{
 const view={x:203,y:-150,width:310,height:400},sample=(x,y)=>120+Math.sin(x/80)*40;
 const full=trace(null,sample),clipped=trace(view,sample);
 assert.equal(clipped.paths.length,1);
 const expected=full.paths[0].filter(([x])=>x>=192&&x<=528);
 assert.deepEqual(clipped.paths[0],expected);assert(clipped.reads<full.reads/5);
 for(const y of [-90,0,375]){
  const south={x:203,y:3950,width:310,height:500},a=trace(null,()=>y),b=trace(south,()=>y);
  assert.deepEqual(b.paths.at(-1),a.paths[1].filter(([x])=>x>=192&&x<=528));
 }
});
