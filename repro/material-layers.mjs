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

await session(`${server}/?biome=red&mapX=2&mapY=2&gpuMB=512`,port,async({send,ev,logs,drag})=>{
 const set=(id,value,event='change')=>ev(`(()=>{const e=document.getElementById(${JSON.stringify(id)});e.value=${JSON.stringify(String(value))};e.dispatchEvent(new Event(${JSON.stringify(event)},{bubbles:true}));return true;})()`);
 const click=id=>ev(`document.getElementById(${JSON.stringify(id)}).click();true`);
 const state=()=>ev('sculptDebug.sketch()');
 const preview=async()=>{for(let i=0;i<180;i++){const text=await ev(`document.getElementById('ground-preview-count').textContent`);if(text.includes('unavailable'))throw Error(text);if(text.includes('distinct')&&!text.includes('Draft'))return text;await sleep(100);}throw Error('final preview timed out');};
 await ready(ev);await click('tab-world');await click('wsec-ground');await click('material-open');
 await ev('sculptCanvas.idle()');
 await ev(`(()=>{window.terrainSubmissions=0;const queue=sculptCanvas.renderer.device.queue,submit=queue.submit.bind(queue);queue.submit=b=>{terrainSubmissions++;submit(b);};return true;})()`);
 assert.equal(await ev('sculptCanvas.suspended'),true);assert.ok(await ev(`(()=>{const r=document.getElementById('material-editor').getBoundingClientRect();return r.left===0&&r.top===0&&r.width===innerWidth&&r.height===innerHeight;})()`),'material editor fills the viewport');
 await set('ground-add','bed');await set('ground-world-default',1);await preview();
 const base=await state();
 await set('layer-add','clouds');await set('layer-name','Cloud color');
 await set('texture-color-high','#e9c67d','input');await set('texture-color-high','#e9c67d');
 await set('layer-mask','procedural');await set('layer-maskPattern','cells');await preview();
 let m=(await state()).grounds[0];assert.equal(m.layers.length,1);assert.equal(m.layers[0].layer.name,'Cloud color');assert.equal(m.layers[0].layer.mask,'procedural');
 // Drag the second layer before the first with actual browser pointer input.
 await send('Input.setInterceptDrags',{enabled:true});
 const positions=await ev(`(()=>{const a=document.querySelector('[data-layer-index="1"] .material-layer-grip').getBoundingClientRect(),b=document.querySelector('[data-layer-index="0"]').getBoundingClientRect();return {from:{x:a.x+a.width/2,y:a.y+a.height/2},to:{x:b.x+30,y:b.y+3}};})()`);
 await send('Input.dispatchMouseEvent',{type:'mousePressed',...positions.from,button:'left',buttons:1,clickCount:1});
 await send('Input.dispatchMouseEvent',{type:'mouseMoved',x:positions.from.x+12,y:positions.from.y,button:'left',buttons:1});
 await send('Input.dispatchMouseEvent',{type:'mouseMoved',...positions.to,button:'left',buttons:1});
 for(let i=0;i<30&&!drag();i++)await sleep(30);assert.ok(drag(),'browser started a native layer drag');
 for(const type of ['dragEnter','dragOver','drop'])await send('Input.dispatchDragEvent',{type,...positions.to,data:drag()});
 await send('Input.dispatchMouseEvent',{type:'mouseReleased',...positions.to,button:'left',buttons:0,clickCount:1});await send('Input.setInterceptDrags',{enabled:false});
 m=(await state()).grounds[0];assert.equal(m.layer.name,'Cloud color');assert.deepEqual(m.texturePalette,base.grounds[0].texturePalette);
 await click('material-undo');m=(await state()).grounds[0];assert.equal(m.layers[0].layer.name,'Cloud color');await click('material-redo');
 await click('layer-down');await ev(`document.querySelector('[data-layer-index="1"] .material-layer-select').click();true`);
 await set('layer-mask','height');await set('layer-terrainLow',10,'input');await set('layer-terrainLow',10);await set('layer-terrainHigh',90,'input');await set('layer-terrainHigh',90);
 await set('material-view',8);await preview();const color=await ev(`document.getElementById('ground-preview').toDataURL()`);
 await set('material-view',10);await preview();const rough=await ev(`document.getElementById('ground-preview').toDataURL()`);assert.notEqual(color,rough,'channel previews show different data');
 await set('material-view',0);await preview();
 await click('layer-duplicate');assert.equal((await state()).grounds[0].layers.length,2);await click('layer-delete');assert.equal((await state()).grounds[0].layers.length,1);
 // Real keyboard edits use the shared scrub, including the new layer controls.
 await click('material-tab-layer');await ev(`document.querySelector('.scrub[data-source="layer-opacity"]').focus();true`);
 await send('Input.dispatchKeyEvent',{type:'keyDown',key:'ArrowLeft'});await send('Input.dispatchKeyEvent',{type:'keyUp',key:'ArrowLeft'});
 assert.equal((await state()).grounds[0].layers[0].layer.opacity,.49);
 await preview();assert.equal(await ev('terrainSubmissions'),0,'no terrain GPU submissions while editing materials');
 const beforeHide=await state();await ev(`document.querySelector('[data-layer-index="1"] .material-layer-visible').click();true`);assert.equal((await state()).grounds[0].layers[0].layer.visible,false);await click('material-undo');assert.deepEqual((await state()).grounds,beforeHide.grounds);
 await click('material-reset');assert.equal((await state()).grounds[0].layers.length,0);assert.equal((await state()).grounds[0].worldGround,true);await click('material-undo');assert.deepEqual((await state()).grounds,beforeHide.grounds,'reset is one reversible edit');
 const saved=await state();await preview();
 await send('Page.captureScreenshot',{format:'png'}).then(r=>writeFileSync(out+'/editor.png',Buffer.from(r.result.data,'base64')));
 await click('material-done');assert.equal(await ev('sculptCanvas.suspended'),false);await ev('sculptCanvas.idle()');assert.ok(await ev('terrainSubmissions>0'),'closing resumes terrain rendering');
 await sleep(700);await send('Page.reload');await ready(ev);assert.deepEqual((await state()).grounds,saved.grounds,'layer save/reload');
 await click('tab-world');await click('wsec-ground');await click('material-open');await preview();
 await send('Emulation.setDeviceMetricsOverride',{width:390,height:844,deviceScaleFactor:1,mobile:false});await sleep(300);
 assert.ok(await ev(`(()=>{const r=document.getElementById('material-editor').getBoundingClientRect();return r.left>=0&&r.right<=390;})()`));
 await send('Page.captureScreenshot',{format:'png'}).then(r=>writeFileSync(out+'/mobile.png',Buffer.from(r.result.data,'base64')));
 await send('Input.dispatchKeyEvent',{type:'keyDown',key:'Escape'});assert.equal(await ev('sculptCanvas.suspended'),false);
 assert.deepEqual(logs,[]);const report={layers:m.layers.length+1,terrainSubmissionsWhileOpen:0,resumed:true,channelPreviews:true,dragReorder:true,visibility:true,reset:true,fullscreen:true,undoRedo:true,saveReload:true,mobile:true,errors:logs};writeFileSync(out+'/report.json',JSON.stringify(report,null,2));console.log(JSON.stringify(report));
});
