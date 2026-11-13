// Render the hover examples (sculpt-help-examples.js) through the same editor GPU pipeline into
// ui-previews/, which is published as a pinned release bundle and served with the editor. Authored fixtures only: no retail
// scene, crop or map is loaded. Run it again when a preset, the renderer or an example changes:
// node repro/ui-previews.mjs --server http://127.0.0.1:<port> --port <cdp> [--out DIR]
// Add --worlds-only to regenerate just the nine New-map thumbnails, preserving all hover examples.
// It replaces the folder's images and manifest and removes images the examples no longer name.
import {spawn,execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {mkdirSync,writeFileSync,renameSync,readdirSync,unlinkSync,readFileSync,existsSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {cdpPortFree} from './cdp-port.mjs';
import {HELP_TOOLS,HELP_CONTROLS,HELP_CARD,HELP_PATH,HELP_FRAME,helpFrames,helpImage} from '../sculpt-help-examples.js';
const args=process.argv.slice(2),opt=(key,fallback)=>{const i=args.indexOf(key);return i<0?fallback:args[i+1];};
const server=opt('--server','').replace(/\/+$/,''),port=Number(opt('--port',0)),out=resolve(opt('--out',fileURLToPath(new URL('../ui-previews',import.meta.url))));
const worldsOnly=args.includes('--worlds-only');
const root=fileURLToPath(new URL('..',import.meta.url));
if(!server||!Number.isInteger(port)||port<1024)throw Error('Give --server and --port for your own development server and CDP port.');
const previewCommand=(args,options={})=>execFileSync('go',['run','./cmd/previews',...args],{cwd:root,encoding:'utf8',...options});
const inputs=JSON.parse(previewCommand(['fingerprint','--json']));
if(worldsOnly)previewCommand(['check-render','--dir',out],{stdio:'inherit'});
// Verify this server serves the local inputs; a different checkout cannot stamp a fresh receipt.
for(const [name,hash]of Object.entries(inputs.files)){
 if(!name.endsWith('.js')&&!name.endsWith('.wgsl')&&!name.startsWith('materials/'))continue;
 if(name.startsWith('repro/')||name==='materials/defaults.json')continue;
 const response=await fetch(`${server}/${name}`);
 const data=Buffer.from(await response.arrayBuffer());
 if(!response.ok||createHash('sha256').update(data).digest('hex')!==hash)throw Error(`Render server does not match local input ${name}`);
}

await cdpPortFree(port);mkdirSync(out,{recursive:true});
const chrome=spawn('/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',['--headless=new','--enable-gpu','--use-angle=metal',`--remote-debugging-port=${port}`,`--user-data-dir=${join(tmpdir(),'terraform-ui-previews-'+port)}`,'--window-size=1440,900','--no-first-run','about:blank'],{stdio:'ignore'});
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
let ws;
try{
  for(let i=0;i<100&&!ws;i++){try{const tab=(await(await fetch(`http://127.0.0.1:${port}/json/list`)).json()).find(t=>t.type==='page');if(tab)ws=new WebSocket(tab.webSocketDebuggerUrl);}catch{}if(!ws)await sleep(150);}
  await new Promise(r=>ws.onopen=r);let id=0;const pending=new Map(),errors=[];
  ws.onmessage=e=>{const m=JSON.parse(e.data);if(m.id){pending.get(m.id)?.(m);pending.delete(m.id);}if(m.method==='Runtime.exceptionThrown')errors.push(m.params.exceptionDetails.exception?.description||m.params.exceptionDetails.text);};
  const send=(method,params={})=>new Promise(r=>{const n=++id;pending.set(n,r);ws.send(JSON.stringify({id:n,method,params}));});
  const ev=async expression=>{const r=await send('Runtime.evaluate',{expression,awaitPromise:true,returnByValue:true});if(r.result?.exceptionDetails)throw Error(JSON.stringify(r.result.exceptionDetails));return r.result.result.value;};
  const ready=async()=>{for(let i=0;i<480;i++){if(await ev('!!window.sculptCanvas&&!!window.sculptRegion&&sculptRegion.canExport()')){await ev('sculptCanvas.idle()');return;}await sleep(150);}throw Error('Preview renderer did not become ready: '+errors.join('\n'));};
  await send('Runtime.enable');await send('Page.navigate',{url:`${server}/?biome=green&mapX=4&mapY=4&scratch=hover-previews&gpuMB=512&heapMB=1536`});await ready();
  // A fixed art-only crop. All variants keep the same seed, light and camera.
  const manifest=worldsOnly&&existsSync(join(out,'manifest.json'))?JSON.parse(readFileSync(join(out,'manifest.json'),'utf8')):{frame:HELP_FRAME,tools:[],controls:{}},written=new Set();
  const save=(name,bytes)=>{const file=join(out,name);writeFileSync(file+'.tmp',bytes);renameSync(file+'.tmp',file);written.add(name);};
  const render=async(kind,card,index)=>{
    await ev(`sculptDebug.scene(${JSON.stringify([[kind,HELP_PATH,{card,seed:2701}]])},{ground:false})`);await ready();
    await ev(`(async()=>{const b=await sculptCanvas.debugBake({x:180,y:140,width:850,height:620},1);previewAtlas.getContext('2d').drawImage(b,${index*HELP_FRAME.width},0,${HELP_FRAME.width},${HELP_FRAME.height});b.close();})()`);
  };
  const begin=count=>ev(`window.previewAtlas=new OffscreenCanvas(${count*HELP_FRAME.width},${HELP_FRAME.height});previewAtlas.getContext('2d',{alpha:false});true`);
  const finish=async name=>{const png=await ev(`(async()=>{const blob=await previewAtlas.convertToBlob({type:'image/png'});previewAtlas.width=1;return await new Promise(r=>{const f=new FileReader();f.onload=()=>r(f.result);f.readAsDataURL(blob);});})()`);save(name,Buffer.from(png.split(',')[1],'base64'));console.log(name);};
  if(!worldsOnly){
  for(const tool of HELP_TOOLS){await begin(1);await render(tool,{},0);await finish(helpImage({tool}));manifest.tools.push(tool);}
  for(const [id,c] of Object.entries(HELP_CONTROLS)){
    const frames=helpFrames(c);await begin(frames.length);
    for(const [i,{value}] of frames.entries())await render('hill',{...HELP_CARD,...c.base,[c.key]:value},i);
    await finish(helpImage({control:id}));manifest.controls[id]=frames;
  }
  }
  // The same authored landform, camera and seed in every world's default material. No scene/map source is loaded.
  const worlds=['green','red','archipelago','moon','zhon','desert','lava','crystal','ice'];
  manifest.worlds={frame:HELP_FRAME,fixture:{kind:'hill',path:HELP_PATH,card:HELP_CARD,seed:2701,crop:{x:180,y:140,width:850,height:620}},images:{}};
  for(const world of worlds){
    await send('Page.navigate',{url:`${server}/?biome=${world}&mapX=4&mapY=4&scratch=world-previews&gpuMB=512&heapMB=1536`});await ready();
    await begin(1);await render('hill',HELP_CARD,0);const name=`world-${world}.png`;await finish(name);manifest.worlds.images[world]=name;
  }
  if(errors.length)throw Error(errors.join('\n'));
  save('manifest.json',JSON.stringify(manifest,null,1)+'\n');
  for(const name of readdirSync(out))if(!worldsOnly&&name.endsWith('.png')&&!written.has(name)){unlinkSync(join(out,name));console.log('removed',name);}
  previewCommand(['stamp','--dir',out,'--expected-inputs',inputs.sha256],{stdio:'inherit'});
  console.log(`Generated ${worlds.length} world thumbnails, ${manifest.tools.length} tools and ${Object.values(manifest.controls).reduce((n,f)=>n+f.length,0)} control frames in ${out}`);
}finally{ws?.close();chrome.kill();}
