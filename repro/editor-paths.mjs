import {spawn} from 'node:child_process';
import {cdpPortFree} from './cdp-port.mjs';
const args=process.argv.slice(2), opt=(name, fallback)=>{const i=args.indexOf(name);return i>=0?args[i+1]:fallback};
const port=Number(opt('--port','9697')), server=opt('--server','http://127.0.0.1:8891'), sleep=ms=>new Promise(r=>setTimeout(r,ms));
await cdpPortFree(port);
const chrome=spawn('/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',['--headless=new','--enable-gpu','--use-angle=metal',`--remote-debugging-port=${port}`,`--user-data-dir=/private/tmp/terraform-fill-review-${Date.now()}`,'--window-size=1700,1300','--no-first-run','about:blank'],{stdio:'ignore'});
try {
 let info; for(let i=0;i<100&&!info;i++){try{info=(await(await fetch(`http://127.0.0.1:${port}/json/list`)).json()).find(x=>x.type==='page')}catch{} if(!info)await sleep(200)}
 if(!info)throw Error('no browser'); const ws=new WebSocket(info.webSocketDebuggerUrl);await new Promise(r=>ws.onopen=r); let id=0;const pending=new Map(),logs=[];ws.onmessage=e=>{const m=JSON.parse(e.data);if(m.id){pending.get(m.id)?.(m);pending.delete(m.id)}if(m.method==='Runtime.exceptionThrown')logs.push(m.params.exceptionDetails.exception?.description||m.params.exceptionDetails.text);if(m.method==='Runtime.consoleAPICalled'&&m.params.type==='error')logs.push(m.params.args.map(a=>a.value??a.description).join(' '))};
 const send=(method,params={})=>new Promise(r=>{const k=++id;pending.set(k,r);ws.send(JSON.stringify({id:k,method,params}))});const ev=async expression=>{const r=await send('Runtime.evaluate',{expression,awaitPromise:true,returnByValue:true});if(r.result?.exceptionDetails)throw Error(JSON.stringify(r.result.exceptionDetails));return r.result?.result?.value};
 await send('Runtime.enable');await send('Page.enable');await send('Emulation.setDeviceMetricsOverride',{width:1700,height:1300,deviceScaleFactor:1,mobile:false});await send('Page.navigate',{url:`${server}/sculpt?biome=green&mapX=1&mapY=1&scratch=fill-review-${Date.now()}&gpuMB=512`});
 for(let i=0;i<600;i++){if(await ev(`!!window.sculptCanvas && !document.getElementById('feature-tool')?.disabled`))break;await sleep(300)}
 await ev('sculptCanvas.idle()');
 await ev(`sculptDebug.scene([['hill',[[200,200],[300,200],[400,200]],{radius:30,amount:30}]],{ground:false});true`); await ev('sculptCanvas.idle()');await sleep(1000);
 await ev(`document.querySelector('.layer-name').click();document.getElementById('draw-add').click();true`);
 const anchor=await ev(`(()=>{let v=sculptCanvas.view(),r=document.getElementById('overlay').getBoundingClientRect(),h=sculptDebug.corner(300,200).eroded;return{x:r.x+(300-v.x)*v.scale,y:r.y+(200-(Math.max(sculptDebug.sea,h)-sculptDebug.base)/2-v.y)*v.scale}})()`);
 const move=async(type,x,y,buttons)=>send('Input.dispatchMouseEvent',{type,x,y,button:'left',buttons,clickCount:1});
 await move('mouseMoved',anchor.x,anchor.y,0);await move('mousePressed',anchor.x,anchor.y,1);
 for(let i=1;i<=8;i++)await move('mouseMoved',anchor.x+i*6,anchor.y+i*4,1);
 await move('mouseReleased',anchor.x+48,anchor.y+32,0);await ev('sculptCanvas.idle()');
 const branch=await ev(`sculptDebug.nodes()`);
 await ev(`document.getElementById('undo').click();true`);await ev('sculptCanvas.idle()');const undo=await ev('sculptDebug.nodes()');
 await ev(`document.getElementById('navigator').focus();true`);await send('Input.dispatchKeyEvent',{type:'keyDown',key:'ArrowRight',code:'ArrowRight',windowsVirtualKeyCode:39});await send('Input.dispatchKeyEvent',{type:'keyUp',key:'ArrowRight',code:'ArrowRight',windowsVirtualKeyCode:39});const nav=await ev('sculptCanvas.view()');
 if(branch.length!==1||branch[0].paths?.length!==2||JSON.stringify(branch[0].paths[0])!==JSON.stringify([0,1,2])||branch[0].paths[1][0]!==1||branch[0].points.length<4||branch[0].points.length>=11)throw Error('branch did not retain its shared anchor and simplify: '+JSON.stringify(branch.map(n=>({points:n.points,paths:n.paths}))));
 if(undo.length!==1||undo[0].points.length!==3||undo[0].paths)throw Error('undo did not restore the original path');
 if(nav.overview||nav.scale!==1)throw Error('minimap keyboard navigation did not leave overview');
 if(logs.length)throw Error('browser errors: '+logs.join('; '));
 console.log(JSON.stringify({sharedAnchor:true,branchPoints:branch[0].points.length,undoPoints:undo[0].points.length,minimapScale:nav.scale,consoleErrors:logs.length}));
} finally {chrome.kill()}
