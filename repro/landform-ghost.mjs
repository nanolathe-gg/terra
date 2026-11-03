// Verify Landform ghost samples against authored GPU readback, including an offscreen point.
import {spawn} from 'node:child_process';
import {cdpPortFree} from './cdp-port.mjs';
const args=process.argv.slice(2),opt=(name,fallback)=>{const i=args.indexOf(name);return i<0?fallback:args[i+1]};
const port=Number(opt('--port',9697)),server=opt('--server','http://127.0.0.1:8891'),sleep=ms=>new Promise(r=>setTimeout(r,ms));
await cdpPortFree(port);
const chrome=spawn('/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',['--headless=new','--enable-gpu','--use-angle=metal',`--remote-debugging-port=${port}`,`--user-data-dir=/private/tmp/terraform-fill-review-${Date.now()}`,'--window-size=1700,1300','--no-first-run','about:blank'],{stdio:'ignore'});
try {
 let info; for(let i=0;i<100&&!info;i++){try{info=(await(await fetch(`http://127.0.0.1:${port}/json/list`)).json()).find(x=>x.type==='page')}catch{} if(!info)await sleep(200)}
 if(!info)throw Error('no browser'); const ws=new WebSocket(info.webSocketDebuggerUrl);await new Promise(r=>ws.onopen=r); let id=0;const pending=new Map(),logs=[];ws.onmessage=e=>{const m=JSON.parse(e.data);if(m.id){pending.get(m.id)?.(m);pending.delete(m.id)}if(m.method==='Runtime.exceptionThrown')logs.push(m.params.exceptionDetails.exception?.description||m.params.exceptionDetails.text);if(m.method==='Runtime.consoleAPICalled'&&m.params.type==='error')logs.push(m.params.args.map(a=>a.value??a.description).join(' '))};
 const send=(method,params={})=>new Promise(r=>{const k=++id;pending.set(k,r);ws.send(JSON.stringify({id:k,method,params}))});const ev=async expression=>{const r=await send('Runtime.evaluate',{expression,awaitPromise:true,returnByValue:true});if(r.result?.exceptionDetails)throw Error(JSON.stringify(r.result.exceptionDetails));return r.result?.result?.value};
 await send('Runtime.enable');await send('Page.enable');await send('Emulation.setDeviceMetricsOverride',{width:1700,height:1300,deviceScaleFactor:1,mobile:false});await send('Page.navigate',{url:`${server}/sculpt?biome=green&mapX=4&mapY=4&scratch=ghost-review-${Date.now()}&audit=1&gpuMB=512`});
 for(let i=0;i<600;i++){if(await ev(`!!window.sculptCanvas && !document.getElementById('feature-tool')?.disabled`))break;await sleep(300)}
 await ev('sculptCanvas.idle()');
 await ev(`sculptDebug.scene([['landform',[[200,350],[1800,350]],{radius:90,elevation:100,combine:0,lean:2,facing:1,wander:12}]],{ground:false});true`);await ev('sculptCanvas.idle()');
 await ev(`document.querySelector('.layer-name').click();document.querySelector('#section-preview').closest('details').open=true;true`);
 let ghost;for(let i=0;i<1000;i++){ghost=await ev('sculptDebug.ghostSamples()');if(ghost?.values?.length===443)break;await sleep(250)}
 if(ghost?.values?.length!==443)throw Error('ghost samples not ready: '+JSON.stringify(ghost));
 let checked=await ev(`(async()=>{const s=sculptDebug.ghostSamples(),spacing=(sculptDebug.size-1)/(sculptDebug.grid-1),out=[];for(const index of [0,132,197,400]){const p=s.points[index],gx=Math.max(0,Math.min(sculptDebug.grid-1,p.x/spacing)),gy=Math.max(0,Math.min(sculptDebug.grid-1,p.y/spacing)),ix=Math.floor(gx),iy=Math.floor(gy),m=await sculptRegion.readAuthored({x:ix,y:iy,width:2,height:2}),v=new DataView(m.data),at=i=>v.getFloat32(i*4,true),fx=gx-ix,fy=gy-iy,want=(at(0)*(1-fx)+at(1)*fx)*(1-fy)+(at(2)*(1-fx)+at(3)*fx)*fy;out.push({index,x:p.x,y:p.y,actual:s.values[index],want,difference:Math.abs(s.values[index]-want)})}return out})()`);
 console.log(JSON.stringify({samples:ghost.values.length,checked,logs}));if(checked.some(x=>x.difference>1e-4)||logs.length)process.exitCode=1;
} finally {chrome.kill()}
