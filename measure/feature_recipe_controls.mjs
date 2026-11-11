// Recipe form controls at 1x: the same 4-pixel class measure as feature_controls.mjs.
// Run with --configs <sculpt.py --dump-configs directory> and --out <directory>.
import {readFileSync, mkdirSync, writeFileSync, mkdtempSync} from 'node:fs';
import {execFileSync} from 'node:child_process';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {generateFeature,drawFeature,paintVent} from '../sculpt-feature-gen.js';
import {defaultSet,makeRecipe,normalizeSet,variants,FORMS,controlRequirement} from '../sculpt-feature-set.js';
import {encodePNG} from './feature_gen_png.mjs';
const args=process.argv.slice(2),opt=(name,fallback)=>args.includes(name)?args[args.indexOf(name)+1]:fallback;
const root=new URL('..',import.meta.url).pathname,dir=opt('--configs',mkdtempSync(join(tmpdir(),'feature-control-config-'))),out=opt('--out','');
if(!args.includes('--configs'))execFileSync(process.env.PYTHON||'/Users/daniel/src/terraform/.venv/bin/python',[root+'sculpt.py','--dump-configs',dir]);
const config=JSON.parse(readFileSync(join(dir,'config/green.json'))), palette=JSON.parse(readFileSync(root+'materials/palette.json')).indexed;
const W=512,H=384,AX=256,AY=260,light={x:-0.623,y:-0.026},ground=[52,67,37];
function picture(kind,params,seed){
 const g={w:W,h:H,rgba:new Uint8ClampedArray(W*H*4)},mask=new Uint8Array(W*H);
 for(let i=0;i<W*H;i++)g.rgba.set([...ground,255],i*4);
 if(kind==='vent'){paintVent(g,AX,AY,params,seed,{palette,light});for(let i=0;i<mask.length;i++)mask[i]=ground.some((c,j)=>g.rgba[i*4+j]!==c);}
 else {const f=generateFeature(kind,params,seed,{palette,light,bodyOnly:true});drawFeature(g,f,AX,AY,palette);
 for(const s of [f.body,f.shadow])if(s)for(let y=0;y<s.h;y++)for(let x=0;x<s.w;x++)if(s.a[y*s.w+x]){const xx=AX+x-s.ax,yy=AY+y-s.ay;if(xx<0||yy<0||xx>=W||yy>=H)throw Error('Measurement clips the feature');mask[yy*W+xx]=1;}}
 return {g,mask};
}
function impact(a,b){let cls=0,moved=0;
 for(let y=0;y<H;y+=4)for(let x=0;x<W;x+=4){let any=false;const stats=[];
 for(const p of [a,b]){let mean=0,sq=0,rgb=[0,0,0];for(let dy=0;dy<4;dy++)for(let dx=0;dx<4;dx++){const i=(y+dy)*W+x+dx;any ||= !!p.mask[i];const c=[...p.g.rgba.subarray(i*4,i*4+3)],l=.299*c[0]+.587*c[1]+.114*c[2];mean+=l/16;sq+=l*l/16;rgb=rgb.map((v,j)=>v+c[j]/16);}stats.push({mean,sd:Math.sqrt(Math.max(0,sq-mean*mean)),rgb});}
 if(any){cls++;const [p,q]=stats;if(Math.abs(p.mean-q.mean)>6||Math.abs(p.sd-q.sd)>4||Math.hypot(...p.rgb.map((v,j)=>v-q.rgb[j]))>8)moved++;}}
 return {cls,moved};
}
if(out)mkdirSync(out,{recursive:true});
let failures=0;const rows=[];
for(const [kind,controls] of Object.entries({...FORMS,tree:{...FORMS.tree,trunkColor:[0,1]}}))for(const [key,[lo,hi]] of Object.entries(controls)){
 const base=defaultSet(config);let recipe=base[kind].recipes[0];
 if(key==='curl')recipe=makeRecipe(kind,config.featureCatalog.find(p=>p.kind===kind&&p.data.types[0].params.species==='tendril').data);
 if(key==='trunkColor')recipe={...recipe,params:{species:'dead'}};
 const samples=variants(kind,{...base,[kind]:{nextId:1,recipes:[recipe]}},config).filter(v=>!controlRequirement(kind,key,v.params)).slice(0,3);
 let cls=0,moved=0;
 for(const [i,v] of samples.entries()){
 const edit=t=>key==='trunkColor'?{trunkColor:t?'#b19a77':'#3b3323'}:{[key]:t};
 const params=t=>{const set=normalizeSet({...base,[kind]:{nextId:1,recipes:[{...recipe,params:{...recipe.params,...edit(t)}}]}},config);return variants(kind,set,config).find(q=>q.index===v.index).params;};
 const a=picture(kind,params(lo),v.seed),b=picture(kind,params(hi),v.seed),m=impact(a,b);cls+=m.cls;moved+=m.moved;
 if(out&&i===0){const rgba=new Uint8ClampedArray(W*2*H*4);for(let y=0;y<H;y++){rgba.set(a.g.rgba.subarray(y*W*4,(y+1)*W*4),y*W*8);rgba.set(b.g.rgba.subarray(y*W*4,(y+1)*W*4),y*W*8+W*4);}writeFileSync(join(out,`${kind}-${key}.png`),encodePNG(W*2,H,rgba));}
 }
 const share=cls?moved/cls:0,pass=share>=.05;failures+=!pass;rows.push({kind,key,samples:samples.length,cls,share,pass});console.log(`${kind}.${key}: ${(share*100).toFixed(1)}% of ${cls} blocks (${samples.length} variants) ${pass?'ok':'FAIL'}`);
}
if(out)writeFileSync(join(out,'report.json'),JSON.stringify(rows,null,2));
process.exitCode=failures?1:0;
