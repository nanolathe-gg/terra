// Small per-family checks and a 1x contact sheet, not the full scene suite.
import assert from 'node:assert/strict';
import {mkdirSync,writeFileSync} from 'node:fs';
import {openHost,openScene,renderWindow} from './headless.mjs';
import {GROUND_PRESETS} from '../sculpt-ground-presets.js';
import {encodePng} from './png.mjs';
const out=process.argv.includes('--out')?process.argv[process.argv.indexOf('--out')+1]:'/private/tmp/ground-fixtures';mkdirSync(out,{recursive:true});
await openHost();
const s=await openScene({biome:'green',ground:false,strokes:[]},'biome=green&mapX=8&mapY=8');
const sheet=new Uint8Array(768*512*4),report=[];
try{
 let index=0;
 for(const [key,preset] of Object.entries(GROUND_PRESETS)){
  const grounds=[{slot:1,key,...preset}];s.setGrounds(grounds);
  s.play([['paint',[[2048,2048]],{groundPreset:1,card:{diameter:20000,amount:100,softness:0}}]]);
  const images=[];for(const[x,y]of[[896,896],[1920,896],[896,1920]])images.push(await renderWindow(s,{x,y,width:256,height:256}));
  const changed=b=>{let n=0;for(let i=0;i<b.length;i+=4)if(!images[0].subarray(i,i+4).every((v,k)=>v===b[i+k]))n++;return n;};
  const row={key,rightChangedPixels:changed(images[1]),downChangedPixels:changed(images[2])};report.push(row);console.log(JSON.stringify(row));
  const x=index%3*256,y=Math.floor(index/3)*256;for(let r=0;r<256;r++)sheet.set(images[0].subarray(r*1024,(r+1)*1024),((y+r)*768+x)*4);index++;
  writeFileSync(`${out}/${key}.png`,encodePng(256,256,images[0]));
 }
 writeFileSync(`${out}/sheet.png`,encodePng(768,512,sheet));writeFileSync(`${out}/report.json`,JSON.stringify(report,null,2)+'\n');
 assert.deepEqual(s.errors,[]);assert.ok(report.every(r=>!r.rightChangedPixels&&!r.downChangedPixels),'all six small fixtures repeat exactly');
}finally{s.dispose();}
process.exit(0);
