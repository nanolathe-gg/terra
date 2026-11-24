// On demand: protect regional interpolation while removing texture padding.
// Two authored map16 windows include the original green-2 tile-size fault.
// node repro/texel-sampling.mjs --server http://127.0.0.1:<yours> --out /private/tmp/texel-check
import assert from 'node:assert/strict';
import {readFileSync,writeFileSync,mkdirSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {resolve,dirname,join} from 'node:path';
import {fileURLToPath} from 'node:url';
import * as H from './headless.mjs';
const args=process.argv.slice(2),opt=(name,fallback)=>{const at=args.indexOf(name);return at<0?fallback:args.splice(at,2)[1];};
const server=opt('--server',''),out=resolve(opt('--out','/private/tmp/terra-texel-sampling')),repo=resolve(dirname(fileURLToPath(import.meta.url)),'..');
if(args.length||!server||new URL(server).port==='8801'||out===repo||out.startsWith(repo+'/'))throw Error('Give your own --server and an --out folder outside the repository.');
mkdirSync(out,{recursive:true});await H.openHost({server});
const rows=[],sha=data=>createHash('sha256').update(data).digest('hex');
for(const name of ['green-2','green-modern-2']){
  const scene=JSON.parse(readFileSync(join(repo,'repro/scenes',name+'.json'))),s=await H.openScene(scene,`biome=${scene.biome}&mapX=16&mapY=16&scratch=1&gpuMB=512${scene.query?'&'+scene.query:''}`);
  await H.weather(s);s.renderer.setBudgetMB(1024);
  const rect={x:0,y:0,width:1024,height:1024},a=await H.renderWindow(s,{...rect,tile:256}),b=await H.renderWindow(s,{...rect,tile:128});
  let different=0,max=0;const first=[];
  for(let i=0;i<a.length;i+=4)if(a.subarray(i,i+4).some((v,c)=>v!==b[i+c])){
    different++;for(let c=0;c<3;c++)max=Math.max(max,Math.abs(a[i+c]-b[i+c]));
    if(first.length<12)first.push({x:i/4%rect.width,y:Math.floor(i/(rect.width*4)),a:[...a.subarray(i,i+4)],b:[...b.subarray(i,i+4)]});
  }
  await s.renderer.device.queue.onSubmittedWorkDone();await new Promise(r=>setTimeout(r,30));
  rows.push({scene:name,rect,tiles:[256,128],different,max,first,sha:[sha(a),sha(b)],errors:[...s.errors]});console.log(rows.at(-1));s.dispose();
}
writeFileSync(join(out,'texel-sampling.json'),JSON.stringify(rows));
for(const row of rows){assert.equal(row.different,0,row.scene+' must not depend on tile size');assert.deepEqual(row.errors,[]);}
process.exit(0);
