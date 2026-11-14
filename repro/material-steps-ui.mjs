// Focused Ground panel and selection check; no scene or full editor suite.
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {mkdirSync,writeFileSync} from 'node:fs';
import {cdpPortFree} from './cdp-port.mjs';
const args=process.argv.slice(2),opt=(key,fallback)=>{const i=args.indexOf(key);return i<0?fallback:args[i+1];};
const server=opt('--server','http://127.0.0.1:8991'),port=Number(opt('--port','9781')),out=opt('--out','/private/tmp/ground-panel');
mkdirSync(out,{recursive:true});const sleep=ms=>new Promise(r=>setTimeout(r,ms));
async function session(url, port, fn) {
  const logs = [];let dragData=null;
  await cdpPortFree(port);
  const chrome = spawn('/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', ['--headless=new', '--enable-gpu', '--use-angle=metal', `--remote-debugging-port=${port}`,
    `--user-data-dir=${out}/profile-${port}-${Date.now()}`, '--window-size=1700,1300', '--no-first-run', 'about:blank'], {stdio: 'ignore'});
  try {
    let ws;
    for (let i = 0; i < 100 && !ws; i++) { try { const p = (await (await fetch(`http://127.0.0.1:${port}/json/list`)).json()).find(x => x.type === 'page'); if (p) ws = new WebSocket(p.webSocketDebuggerUrl); } catch {} if (!ws) await sleep(200); }
    await new Promise(r => ws.onopen = r);
    let id = 0; const wait = new Map();
    ws.onmessage = e => {
      const m = JSON.parse(e.data);
      if (m.id) { wait.get(m.id)?.(m); wait.delete(m.id); }
      if(m.method==='Input.dragIntercepted')dragData=m.params.data;
      if (m.method === 'Runtime.exceptionThrown') logs.push(m.params.exceptionDetails.exception?.description || m.params.exceptionDetails.text);
      if (m.method === 'Runtime.consoleAPICalled' && m.params.type === 'error') logs.push(m.params.args.map(a => a.value ?? a.description).join(' ').slice(0, 300));
    };
    const send = (method, params = {}) => new Promise(r => { const k = ++id; wait.set(k, r); ws.send(JSON.stringify({id: k, method, params})); });
    const ev = async expression => { const r = await send('Runtime.evaluate', {expression, awaitPromise: true, returnByValue: true}); if (r.result?.exceptionDetails) throw new Error(r.result.exceptionDetails.exception?.description || r.result.exceptionDetails.text); return r.result.result.value; };
    await send('Runtime.enable'); await send('Page.enable');
    await send('Emulation.setDeviceMetricsOverride', {width: 1700, height: 1300, deviceScaleFactor: 1, mobile: false});
    await send('Page.navigate', {url});
    return await fn({send, ev, logs,drag:()=>dragData});
  } finally { chrome.kill(); await sleep(600); }
}
const ready = async ev => {
  for (let i = 0; i < 600; i++) {
    if (await ev(`!!window.sculptCanvas && !document.getElementById('editor').disabled && !document.getElementById('map-export').disabled`)) { await ev('sculptCanvas.idle()'); await sleep(1500); return; }
    const e = await ev(`document.getElementById('error')?.textContent`); if (e) throw new Error(e);
    await sleep(300);
  }
  throw new Error('the editor never became ready');
};

await session(`${server}/?biome=red&mapX=2&mapY=2&gpuMB=512`,port,async({send,ev,logs})=>{
 const click=id=>ev(`document.getElementById(${JSON.stringify(id)}).click();true`);
 const set=(id,value,event='change')=>ev(`(()=>{const e=document.getElementById(${JSON.stringify(id)});e.value=${JSON.stringify(String(value))};e.dispatchEvent(new Event(${JSON.stringify(event)},{bubbles:true}));return true;})()`);
 const state=()=>ev('sculptDebug.sketch()');
 const choose=async(type,predicate='')=>{const nodes=(await state()).grounds[0].steps,id=nodes.find(s=>s.type===type&&(!predicate||s.target===predicate)).id;await set('graph-node-select',id);return id;};
 const preview=async()=>{for(let i=0;i<180;i++){const text=await ev(`document.getElementById('ground-preview-count').textContent`);if(text.includes('unavailable'))throw Error(text);if(text.includes('distinct')&&!text.includes('Draft'))return;await sleep(100);}throw Error('preview timed out');};
 const picture=()=>ev(`document.getElementById('ground-preview').toDataURL()`);
 const nodePicture=()=>ev(`document.getElementById('node-preview').toDataURL()`);
 const nodeReady=async()=>{for(let i=0;i<180;i++){if(await ev(`document.getElementById('node-preview').getAttribute('aria-busy')==='false'`)){const text=await ev(`document.getElementById('node-preview-note').textContent`);assert.doesNotMatch(text,/unavailable|Invalid/);return;}await sleep(100);}throw Error('node preview timed out');};
 const shot=async name=>{await send('Page.captureScreenshot',{format:'png'}).then(r=>writeFileSync(out+'/'+name+'.png',Buffer.from(r.result.data,'base64')));};
 await ready(ev);await click('materials-toolbar');
 await ev(`(()=>{window.terrainSubmissions=0;window.terrainJobs=[];const queue=sculptCanvas.renderer.device.queue,submit=queue.submit.bind(queue);queue.submit=b=>{terrainSubmissions++;terrainJobs.push({labels:[...b].map(x=>x.label),stack:new Error().stack});submit(b);};return true;})()`);
 await set('ground-add','rust-mottling');await choose('noise');await preview();await nodeReady();
 if(process.argv.includes('--visual-only')){await sleep(300);await shot('editor');await send('Emulation.setDeviceMetricsOverride',{width:390,height:844,deviceScaleFactor:1,mobile:false});await sleep(300);await shot('mobile');assert.deepEqual(logs,[]);await click('material-done');return;}
 for(const key of ['cloudy-green','blue-streaked-water','violet-rippled-water']){await set('ground-add',key);await preview();}
 assert.equal(await ev(`document.getElementById('material-layer-list')===null`),true);
 await set('ground-presets',1);await choose('noise');assert.equal((await state()).grounds[0].layers,undefined);assert.equal((await state()).grounds[0].layer,undefined);await preview();const before=await picture(),original=structuredClone((await state()).grounds[0]);
 await nodeReady();const noisePicture=await nodePicture();assert.notEqual(noisePicture,before,'node and final previews show different outputs');await choose('gradient');await nodeReady();assert.notEqual(await nodePicture(),noisePicture);assert.equal(await picture(),before,'selecting a node preserves final preview');await choose('transform');await nodeReady();assert.match(await ev(`document.getElementById('node-preview-note').textContent`),/reference cells/);await choose('noise');await nodeReady();
 // One Noise node changes type; the inspector offers an explicit disconnect.
 assert.equal(await ev(`document.querySelectorAll('#step-add option[value="noise"]').length`),1);
 assert.equal(await ev(`document.querySelectorAll('#step-add option[value="grain"],#step-add option[value="hash"]').length`),0);
 await set('step-kind','fine');assert.equal((await state()).grounds[0].steps.find(s=>s.id===original.steps.find(s=>s.type==='noise').id).kind,'fine');await click('material-undo');
 await click('step-source-disconnect');assert.equal((await state()).grounds[0].steps.find(s=>s.type==='noise').source,null);await click('material-undo');await preview();assert.equal(await picture(),before);
 await set('step-param-0',17,'input');await set('step-param-0',17);await preview();assert.notEqual(await picture(),before,'noise settings update material');await click('material-undo');await preview();assert.equal(await picture(),before,'undo restores exact material');
 // Pointer interactions use the fitted coordinates of the public layout helper.
 await click('graph-fit');await sleep(100);
 const coords=()=>ev(`(async()=>{const {graphPositions,nodeInputs}=await import('./sculpt-material-graph.js'),steps=sculptDebug.sketch().grounds[0].steps,auto=graphPositions(steps),nodes=steps.map(s=>({s,p:s.position??auto.get(s.id),h:Math.max(90,54+nodeInputs(s).length*21)})),rect=document.getElementById('material-graph').getBoundingClientRect(),x=Math.min(...nodes.map(n=>n.p.x))-35,y=Math.min(...nodes.map(n=>n.p.y))-35,w=Math.max(...nodes.map(n=>n.p.x+176))-x+35,h=Math.max(...nodes.map(n=>n.p.y+n.h))-y+35,z=Math.max(.12,Math.min(1.1,rect.width/w,rect.height/h)),px=(rect.width-w*z)/2-x*z,py=(rect.height-h*z)/2-y*z,n=nodes[0];const point=(dx,dy)=>({x:rect.x+px+(n.p.x+dx)*z,y:rect.y+py+(n.p.y+dy)*z});const next=nodes.find(n=>n.s.type==='noise');return {id:n.s.id,z,body:point(75,15),out:point(176,48),input:point(0,48),noiseInput:{x:rect.x+px+next.p.x*z,y:rect.y+py+(next.p.y+48)*z}};})()`);
 let c=await coords();const drag=async(from,to)=>{await send('Input.dispatchMouseEvent',{type:'mousePressed',...from,button:'left',buttons:1,clickCount:1});await send('Input.dispatchMouseEvent',{type:'mouseMoved',...to,button:'left',buttons:1});await send('Input.dispatchMouseEvent',{type:'mouseReleased',...to,button:'left',buttons:0,clickCount:1});};
 await drag(c.body,{x:c.body.x+50,y:c.body.y+25});assert.ok((await state()).grounds[0].steps[0].position,'pointer drag stores node position');await click('material-undo');assert.equal((await state()).grounds[0].steps[0].position,undefined);await click('graph-fit');await sleep(100);c=await coords();await drag(c.out,c.input);assert.match(await ev(`document.getElementById('graph-help').textContent`),/cycle/);assert.deepEqual((await state()).grounds[0].steps,original.steps,'cycle rejected without changing the recipe');
 await click('graph-fit');c=await coords();const input=c.noiseInput;
 await send('Input.dispatchMouseEvent',{type:'mousePressed',...input,button:'left',buttons:1,clickCount:1});await send('Input.dispatchMouseEvent',{type:'mouseReleased',...input,button:'left',buttons:0,clickCount:1});
 assert.equal((await state()).grounds[0].steps.find(s=>s.type==='noise').source,null,'click input disconnects');await click('material-undo');await preview();
 await set('step-add','constant');await set('step-name','Clod height');await set('step-param-0',.35,'input');await set('step-param-0',.35);const constant=(await state()).grounds[0].steps.find(s=>s.name==='Clod height').id;
 await choose('output','height');await set('step-source',constant);await set('step-param-0',2,'input');await set('step-param-0',2);await preview();assert.notEqual(await picture(),before,'graph source drives height');
 await set('graph-node-select',constant);await click('step-delete');assert.equal((await state()).grounds[0].steps.find(s=>s.target==='height').source,null,'delete disconnects wires');await click('material-undo');assert.equal((await state()).grounds[0].steps.find(s=>s.target==='height').source,constant);
 await click('material-reset');await preview();assert.deepEqual((await state()).grounds[0].steps,original.steps);await choose('gradient');await set('step-color-1','#cc9966','input');await set('step-color-1','#cc9966');await preview();assert.notEqual(await picture(),before,'gradient changes color');await click('material-reset');await choose('noise');await preview();
 await click('graph-arrange');assert.ok((await state()).grounds[0].steps.every(s=>s.position));const saved=await state();await ev(`sculptDebug.loadSketch(${JSON.stringify(saved)});true`);assert.deepEqual((await state()).grounds,saved.grounds);await preview();await sleep(300);await shot('editor');
 assert.equal(await ev('terrainSubmissions'),0,'terrain remains paused while editing the graph '+JSON.stringify(await ev('terrainJobs')));assert.equal((await state()).grounds.some(p=>p.worldGround||p.worldWater),false);assert.deepEqual(logs,[]);
 await send('Emulation.setDeviceMetricsOverride',{width:390,height:844,deviceScaleFactor:1,mobile:false});await sleep(300);assert.ok(await ev(`document.getElementById('material-editor').getBoundingClientRect().right<=390`));await shot('mobile');await click('material-done');await ev('sculptCanvas.idle()');assert.equal(await ev('sculptCanvas.suspended'),false);assert.ok(await ev('terrainSubmissions>0'),'closing resumes pending terrain work');
 console.log(JSON.stringify({fourPresets:true,singleGraph:true,globalAccess:true,noiseTypes:true,disconnect:true,noise:true,gradient:true,heightConnection:true,dualPreviews:true,referencePreview:true,pointerMove:true,cycleRejected:true,deleteDisconnects:true,undoExact:true,reset:true,graphSaveReload:true,terrainSubmissionsWhileOpen:0,mobile:true,worldDefaultsUnchanged:true,errors:logs}));
});
