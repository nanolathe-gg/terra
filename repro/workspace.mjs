// Interaction regression for the artist workspace, using real pointer/key input.
// node repro/workspace.mjs --server http://127.0.0.1:8921 --port 9927 --out /tmp/artist-ui
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {mkdirSync,writeFileSync} from 'node:fs';
import {join} from 'node:path';
import {cdpPortFree} from './cdp-port.mjs';
const args=process.argv.slice(2),opt=(k,d)=>args.includes(k)?args[args.indexOf(k)+1]:d;
const server=opt('--server','http://127.0.0.1:8921'),port=Number(opt('--port',9927)),out=opt('--out','/tmp/artist-ui');
await cdpPortFree(port);mkdirSync(out,{recursive:true});
const browser=spawn('/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',['--headless=new','--enable-gpu','--use-angle=metal',`--remote-debugging-port=${port}`,`--user-data-dir=${join(out,'profile')}`,'--window-size=1440,900','--no-first-run','about:blank'],{stdio:'ignore'});
const sleep=ms=>new Promise(r=>setTimeout(r,ms));let ws;
try{
  for(let i=0;i<100&&!ws;i++){try{const tab=(await(await fetch(`http://127.0.0.1:${port}/json/list`)).json()).find(t=>t.type==='page');if(tab)ws=new WebSocket(tab.webSocketDebuggerUrl);}catch{}if(!ws)await sleep(150);}
  await new Promise(r=>ws.onopen=r);let id=0;const pending=new Map(),errors=[],report={};
  ws.onmessage=e=>{const m=JSON.parse(e.data);if(m.id){pending.get(m.id)?.(m);pending.delete(m.id);}if(m.method==='Runtime.exceptionThrown')errors.push(m.params.exceptionDetails.exception?.description||m.params.exceptionDetails.text);if(m.method==='Runtime.consoleAPICalled'&&m.params.type==='error')errors.push(m.params.args.map(a=>a.value||a.description).join(' '));};
  const send=(method,params={})=>new Promise(r=>{const n=++id;pending.set(n,r);ws.send(JSON.stringify({id:n,method,params}));});
  const ev=async expression=>{const r=await send('Runtime.evaluate',{expression,awaitPromise:true,returnByValue:true});if(r.result?.exceptionDetails)throw Error(JSON.stringify(r.result.exceptionDetails));return r.result.result.value;};
  const ready=async()=>{for(let i=0;i<480;i++){if(await ev('!!window.sculptCanvas&&!document.getElementById("map-export").disabled')){await ev('sculptCanvas.idle()');return;}await sleep(150);}throw Error('Editor did not become ready: '+errors.join('\n'));};
  const point=selector=>ev(`(()=>{const e=document.querySelector(${JSON.stringify(selector)});e.scrollIntoView({block:'nearest'});const r=e.getBoundingClientRect();return {x:r.x+r.width/2,y:r.y+r.height/2};})()`);
  const mouse=(type,p,extra={})=>send('Input.dispatchMouseEvent',{type,...p,button:type==='mouseMoved'?'none':'left',buttons:type==='mousePressed'?1:0,clickCount:type==='mouseMoved'?0:1,...extra});
  const click=async selector=>{const p=await point(selector);await mouse('mousePressed',p);await mouse('mouseReleased',p);};
  const drag=async(a,b)=>{await mouse('mousePressed',a);for(let i=1;i<=6;i++){await mouse('mouseMoved',{x:a.x+(b.x-a.x)*i/6,y:a.y+(b.y-a.y)*i/6},{button:'left',buttons:1});await sleep(20);}await mouse('mouseReleased',b);};
  const key=async name=>{await send('Input.dispatchKeyEvent',{type:'keyDown',key:name});await send('Input.dispatchKeyEvent',{type:'keyUp',key:name});};
  const nodes=()=>ev('sculptDebug.nodes()');
  await send('Runtime.enable');await send('Page.enable');await send('Emulation.setDeviceMetricsOverride',{width:1440,height:900,deviceScaleFactor:1,mobile:false});
  await send('Page.navigate',{url:`${server}/sculpt?biome=green&mapX=4&mapY=4&scratch=workspace-test&gpuMB=512&heapMB=1536`});await ready();
  report.desktop=await ev(`({map:document.getElementById('viewport').getBoundingClientRect().toJSON(),dock:document.getElementById('curve-dock').clientHeight,curves:[...document.querySelectorAll('.curve-pane canvas')].map(c=>[c.clientWidth,c.clientHeight]),tools:document.querySelectorAll('.tool-palette button').length})`);
  assert.equal(report.desktop.tools,21);assert.equal(report.desktop.dock,167);assert(report.desktop.curves.every(c=>c[1]<=104&&c[0]>450));
  for(const tool of ['plateau','hill','mountain','ramp','deep','shallow','valleyV','valleyU','valleyT','river','braided']){await click(`[data-tool="${tool}"]`);assert.equal(await ev('sculptDebug.state().tool'),tool);assert.equal(await ev('document.getElementById("section-preview-control").hidden'),false);}
  await click('[data-tool="hill"]');const count=(await nodes()).length;await drag({x:450,y:290},{x:660,y:340});await ready();assert.equal((await nodes()).length,count+1);
  await click('#tab-objects');if(await ev('sculptDebug.state().selected')!==count)await click('#layers li:last-child .layer-name');await click('#tab-tool');assert.equal(await ev('sculptDebug.state().selected'),count);
  const before=(await nodes()).at(-1),scrub='.scrub[data-source="diameter"]',p=await point(scrub);await drag(p,{x:p.x+32,y:p.y});await ready();assert.notEqual((await nodes()).at(-1).params.radius,before.params.radius);
  await click('#undo');await ready();assert.equal((await nodes()).at(-1).params.radius,before.params.radius);report.scrubUndo='one undo restores radius';
  // The existing undo operation clears selection; select the shape again.
  await click('#tab-objects');await click('#layers li:last-child .layer-name');await click('#tab-tool');
  await click(scrub);assert.equal(await ev('document.activeElement.type'),'number');await send('Input.insertText',{text:'360'});await key('Enter');await ready();assert.equal((await nodes()).at(-1).params.radius,180);
  await click(scrub);await send('Input.insertText',{text:'440'});await key('Escape');assert.equal((await nodes()).at(-1).params.radius,180);report.typedValue='360 committed; 440 canceled';
  // Keyboard slider adjustment must not also nudge the selected shape.
  const beforeKey=(await nodes()).at(-1);await ev(`document.querySelector('${scrub}').focus()`);await key('ArrowRight');await ready();const afterKey=(await nodes()).at(-1);assert.equal(afterKey.params.radius,184);assert.deepEqual(afterKey.points,beforeKey.points);assert.deepEqual(afterKey.frame,beforeKey.frame);
  const curveBefore=JSON.stringify((await nodes()).at(-1).params.curve),cp=await ev(`sculptDebug.sectionPoint('front',.63,.72)`);await mouse('mousePressed',cp);await mouse('mouseReleased',cp);await ready();assert.notEqual(JSON.stringify((await nodes()).at(-1).params.curve),curveBefore);report.section='mouse edit saved';
  const alongBefore=JSON.stringify((await nodes()).at(-1).params.along),ap=await ev('sculptDebug.alongPoint(.45,.65)');await mouse('mousePressed',ap,{clickCount:2});await mouse('mouseReleased',ap,{clickCount:2});await ready();assert.notEqual(JSON.stringify((await nodes()).at(-1).params.along),alongBefore);report.along='double-click added point';
  const oldSeed=(await nodes()).at(-1).seed;await click('#seed-randomize');await ready();assert.notEqual((await nodes()).at(-1).seed,oldSeed);await click('#undo');await ready();assert.equal((await nodes()).at(-1).seed,oldSeed);report.seed='reroll and undo';
  const saved=await ev('sculptDebug.sketch()');await ev(`sculptDebug.loadSketch(${JSON.stringify(saved)})`);await ready();const normalized=list=>list.map(n=>({...n,hidden:Boolean(n.hidden)}));assert.deepEqual(normalized(await nodes()),normalized(saved.nodes));report.save='curve and node recipe round trip';
  const oldView=await ev('sculptCanvas.view()'),nav=await point('[data-nav]');await mouse('mousePressed',{x:nav.x+35,y:nav.y+28});await mouse('mouseReleased',{x:nav.x+35,y:nav.y+28});await ready();assert.notEqual((await ev('sculptCanvas.view()')).x,oldView.x);
  await click('#zoom-in');assert.equal((await ev('sculptCanvas.view()')).scale,2);await click('#zoom-out');await click('#one');assert.equal((await ev('sculptCanvas.view()')).scale,1);report.navigation='minimap, +, −, 1×';
  await ready();const art=await ev('document.getElementById("terrain").toDataURL()');await click('#tile-grid');await ev('sculptCanvas.idle()');assert.equal(await ev('document.getElementById("tile-grid").checked'),true);assert.equal(await ev('document.getElementById("terrain").toDataURL()'),art);await click('#tile-grid');report.grid='overlay leaves rendered art unchanged';
  await click('#weather');await ready();assert.equal(await ev('sculptDebug.sketch().weather'),false);await click('#weather');await ready();assert.equal(await ev('sculptDebug.sketch().weather'),true);report.weather='map weathering toggles off/on';
  const hp=await point('[data-tool="plateau"]');await mouse('mouseMoved',hp);await sleep(800);assert.equal(await ev('document.getElementById("visual-help").hidden'),false);assert(await ev('document.querySelector("#visual-help img").naturalWidth>0'));report.help='rendered tool hover loaded';
  await key('Escape');await click('#feature-tool');assert.equal(await ev('document.getElementById("section-preview-control").hidden'),true);assert.equal(await ev('document.getElementById("feature-tool-host").hidden'),false);await click('[data-tool="plateau"]');await send('Emulation.setDeviceMetricsOverride',{width:1024,height:768,deviceScaleFactor:1,mobile:false});await sleep(300);await ready();
  report.tablet=await ev(`({mapWidth:document.getElementById('viewport').clientWidth,dock:document.getElementById('curve-dock').clientHeight,topWidth:document.querySelector('.topbar').scrollWidth,curves:[...document.querySelectorAll('.curve-pane canvas')].map(c=>[c.clientWidth,c.clientHeight]),navigatorLeft:document.querySelector('.minimap-panel').getBoundingClientRect().left,dockRight:document.getElementById('curve-dock').getBoundingClientRect().right,inspectorLeft:document.getElementById('inspector-sidebar').getBoundingClientRect().left})`);assert.equal(report.tablet.topWidth,1024);assert(report.tablet.curves.every(c=>c[0]>=260&&c[1]<=104));assert.equal(report.tablet.navigatorLeft,0);assert.equal(report.tablet.dockRight,report.tablet.inspectorLeft);
  const screen=await send('Page.captureScreenshot',{format:'png'});writeFileSync(join(out,'tablet.png'),Buffer.from(screen.result.data,'base64'));
  assert.deepEqual(errors,[]);report.console=errors;writeFileSync(join(out,'workspace.json'),JSON.stringify(report,null,2));console.log(JSON.stringify(report));
}finally{ws?.close();browser.kill();}
