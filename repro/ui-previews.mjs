// Render the hover examples (sculpt-help-examples.js) through the SAME /sculpt GPU pipeline into
// ui-previews/, which is committed and served with the editor. Authored fixtures only: no retail
// scene, crop or map is loaded. Run it again when a preset, the renderer or an example changes:
// node repro/ui-previews.mjs --server http://127.0.0.1:<port> --port <cdp> [--out DIR]
// It replaces the folder's images and manifest and removes images the examples no longer name.
import {spawn} from 'node:child_process';
import {mkdirSync,writeFileSync,renameSync,readdirSync,unlinkSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {cdpPortFree} from './cdp-port.mjs';
import {HELP_TOOLS,HELP_CONTROLS,HELP_CARD,HELP_PATH,HELP_FRAME,helpFrames,helpImage} from '../sculpt-help-examples.js';
const args=process.argv.slice(2),opt=(key,fallback)=>{const i=args.indexOf(key);return i<0?fallback:args[i+1];};
const server=opt('--server','http://127.0.0.1:8921'),port=Number(opt('--port',9927)),out=resolve(opt('--out',fileURLToPath(new URL('../ui-previews',import.meta.url))));
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
  const ready=async()=>{for(let i=0;i<480;i++){if(await ev('!!window.sculptCanvas&&!document.getElementById("map-export").disabled')){await ev('sculptCanvas.idle()');return;}await sleep(150);}throw Error('Preview renderer did not become ready: '+errors.join('\n'));};
  await send('Runtime.enable');await send('Page.navigate',{url:`${server}/sculpt.html?biome=green&mapX=4&mapY=4&scratch=hover-previews&gpuMB=512&heapMB=1536`});await ready();
  // A fixed art-only crop. All variants keep the same seed, light and camera.
  const manifest={frame:HELP_FRAME,tools:[],controls:{}},written=new Set();
  const save=(name,bytes)=>{const file=join(out,name);writeFileSync(file+'.tmp',bytes);renameSync(file+'.tmp',file);written.add(name);};
  const render=async(kind,card,index)=>{
    await ev(`sculptDebug.scene(${JSON.stringify([[kind,HELP_PATH,{card,seed:2701}]])},{ground:false})`);await ready();
    await ev(`(async()=>{const b=await sculptCanvas.debugBake({x:180,y:140,width:850,height:620},1);previewAtlas.getContext('2d').drawImage(b,${index*HELP_FRAME.width},0,${HELP_FRAME.width},${HELP_FRAME.height});b.close();})()`);
  };
  const begin=count=>ev(`window.previewAtlas=new OffscreenCanvas(${count*HELP_FRAME.width},${HELP_FRAME.height});previewAtlas.getContext('2d',{alpha:false});true`);
  const finish=async name=>{const png=await ev(`(async()=>{const blob=await previewAtlas.convertToBlob({type:'image/png'});previewAtlas.width=1;return await new Promise(r=>{const f=new FileReader();f.onload=()=>r(f.result);f.readAsDataURL(blob);});})()`);save(name,Buffer.from(png.split(',')[1],'base64'));console.log(name);};
  for(const tool of HELP_TOOLS){await begin(1);await render(tool,{},0);await finish(helpImage({tool}));manifest.tools.push(tool);}
  for(const [id,c] of Object.entries(HELP_CONTROLS)){
    const frames=helpFrames(c);await begin(frames.length);
    for(const [i,{value}] of frames.entries())await render('hill',{...HELP_CARD,...c.base,[c.key]:value},i);
    await finish(helpImage({control:id}));manifest.controls[id]=frames;
  }
  if(errors.length)throw Error(errors.join('\n'));
  save('manifest.json',JSON.stringify(manifest,null,1)+'\n');
  for(const name of readdirSync(out))if(name.endsWith('.png')&&!written.has(name)){unlinkSync(join(out,name));console.log('removed',name);}
  console.log(`Generated ${manifest.tools.length} tools and ${Object.values(manifest.controls).reduce((n,f)=>n+f.length,0)} control frames in ${out}`);
}finally{ws?.close();chrome.kill();}
