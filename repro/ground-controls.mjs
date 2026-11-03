import {spawn} from 'node:child_process';
import {cdpPortFree} from './cdp-port.mjs';
const args=process.argv.slice(2), opt=(name, fallback)=>{const i=args.indexOf(name);return i>=0?args[i+1]:fallback};
const port=Number(opt('--port','9694')), server=opt('--server','http://127.0.0.1:8956'), sleep=ms=>new Promise(r=>setTimeout(r,ms));
await cdpPortFree(port);
const chrome=spawn('/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',['--headless=new','--enable-gpu','--use-angle=metal',`--remote-debugging-port=${port}`,`--user-data-dir=/private/tmp/terraform-fill-review-${Date.now()}`,'--window-size=1700,1296','--no-first-run','about:blank'],{stdio:'ignore'});
try {
 let info; for(let i=0;i<100&&!info;i++){try{info=(await(await fetch(`http://127.0.0.1:${port}/json/list`)).json()).find(x=>x.type==='page')}catch{} if(!info)await sleep(200)}
 if(!info)throw Error('no browser'); const ws=new WebSocket(info.webSocketDebuggerUrl);await new Promise(r=>ws.onopen=r); let id=0;const pending=new Map(),logs=[];ws.onmessage=e=>{const m=JSON.parse(e.data);if(m.id){pending.get(m.id)?.(m);pending.delete(m.id)}if(m.method==='Runtime.exceptionThrown')logs.push(m.params.exceptionDetails.exception?.description||m.params.exceptionDetails.text);if(m.method==='Runtime.consoleAPICalled'&&m.params.type==='error')logs.push(m.params.args.map(a=>a.value??a.description).join(' '))};
 const send=(method,params={})=>new Promise(r=>{const k=++id;pending.set(k,r);ws.send(JSON.stringify({id:k,method,params}))});const ev=async expression=>{const r=await send('Runtime.evaluate',{expression,awaitPromise:true,returnByValue:true});if(r.result?.exceptionDetails)throw Error(JSON.stringify(r.result.exceptionDetails));return r.result?.result?.value};
 await send('Runtime.enable');await send('Page.enable');await send('Emulation.setDeviceMetricsOverride',{width:1700,height:1296,deviceScaleFactor:1,mobile:false});await send('Page.navigate',{url:`${server}/sculpt?biome=green&mapX=1&mapY=1&scratch=fill-review-${Date.now()}&gpuMB=512`});
 for(let i=0;i<600;i++){if(await ev(`!!window.sculptCanvas && !document.getElementById('feature-tool')?.disabled`))break;await sleep(296)}
 await ev('sculptCanvas.idle()');
 await ev(`sculptDebug.scene([],{ground:false});true`); await ev('sculptCanvas.idle()');
 const set = async (id,v) => { await ev(`(()=>{const e=document.getElementById(${JSON.stringify(id)});e.value=${JSON.stringify(String(v))};e.dispatchEvent(new Event('input',{bubbles:true}));e.dispatchEvent(new Event('change',{bubbles:true}));})()`); await ev('sculptCanvas.idle()') };
 const state = () => ev(`({nodes:sculptDebug.nodes(),values:['undulation','undulationScale','undulationCover'].map(k=>Number(document.getElementById('knob-'+k).value))})`);
 const digest = () => ev(`(async()=>{const r=await sculptRegion.readAuthored({x:0,y:0,width:128,height:128}), a=new Uint8Array(r.data),b=await crypto.subtle.digest('SHA-256',a);return Array.from(new Uint8Array(b)).map(x=>x.toString(16).padStart(2,'0')).join('')})()`);
 const plain=await digest();await set('knob-undulationScale',296);await set('knob-undulationCover',.25);await set('knob-undulation',8);const created=await state(), raised=await digest();
 if(created.nodes[0]?.kind!=='ground'||created.nodes[0].amplitude!==8||created.nodes[0].wavelength!==296||created.nodes[0].coverage!==.25||plain===raised)throw Error('ground creation '+JSON.stringify(created));
 await ev(`document.getElementById('undo').click()`);await ev('sculptCanvas.idle()');const undone=await state(),back=await digest();
 if(undone.nodes.some(n=>n.kind==='ground')||undone.values.join()!=[0,296,.25].join()||back!==plain)throw Error('undo ground '+JSON.stringify(undone));
 await ev(`document.getElementById('redo').click()`);await ev('sculptCanvas.idle()');const redone=await state(),again=await digest();
 if(redone.values.join()!=[8,296,.25].join()||again!==raised)throw Error('redo ground '+JSON.stringify(redone));
 await set('knob-undulationScale',360);await ev(`document.getElementById('undo').click()`);await ev('sculptCanvas.idle()');const scaleUndo=await state();
 if(scaleUndo.values.join()!=[8,296,.25].join()||scaleUndo.nodes[0].wavelength!==296||await digest()!==raised)throw Error('undo wavelength '+JSON.stringify(scaleUndo));
 if(logs.length)throw Error('console '+logs.join('; ')); console.log(JSON.stringify({customGround:created.nodes[0],undo:undone.values,redo:redone.values,scaleUndo:scaleUndo.values,bytesRestored:true,consoleErrors:logs.length}));

} finally {chrome.kill()}
