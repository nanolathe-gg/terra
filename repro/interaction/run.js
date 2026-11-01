const $=id=>document.getElementById(id),log=$('log'),scenes=await(await fetch('/interaction/scenes.json')).json();
$('scene').replaceChildren(...Object.keys(scenes).sort().map(name=>new Option(name,name,name==='green-2',name==='green-2')));
let frame=$('editor'),current='',stop=false;const delay=ms=>new Promise(r=>setTimeout(r,ms)),line=s=>{log.textContent+=s+'\n';log.scrollTop=log.scrollHeight;};
const save=async(name,data)=>{const r=await fetch('/interaction/save/'+name,{method:'POST',body:(data instanceof Blob||data instanceof frame.contentWindow.Blob)?data:JSON.stringify(data)});if(!r.ok)throw Error(await r.text());};
const png=async(name,c)=>{const pixels=c.getContext('2d').getImageData(0,0,c.width,c.height).data;if(!pixels.some((v,i)=>i%4!==3&&v>2))throw Error('Empty capture: '+name);const blob=c.convertToBlob?await c.convertToBlob({type:'image/png'}):await new Promise(r=>c.toBlob(r));await save(name,blob);};
async function load(name=$('scene').value,units=Number($('units').value)){
 try{const w=frame.contentWindow;if(w.interactionPerf)w.interactionPerf.disposing=true;w.interactionEditor?.renderer?.device?.destroy();}catch{}
 const s=scenes[name],t=performance.now(),previous=frame;frame=document.createElement('iframe');frame.id='editor';frame.title='Terrain editor';frame.src=`/sculpt?biome=${s.biome}&mapX=${units}&mapY=${units}&interaction=1&scratch=interaction-${Date.now()}&gpuMB=512&heapMB=2048&${s.query||''}`;previous.replaceWith(frame);
 while(frame.contentWindow.location.href!==frame.src||!frame.contentWindow.interactionEditor?.ready()){if(performance.now()-t>90000)throw Error('Boot timeout');await delay(60);}
 line('  ready '+name);const a=frame.contentWindow.interactionEditor;a.canvas.setBusy(true);a.scene(s.strokes,{ground:s.ground!==false});await a.settle();a.canvas.setBusy(false);line('  scene ready');a.canvas.zoom(1);frame.contentDocument.getElementById('viewport').scrollTo(0,0);await a.settle();line('  view ready');current=name+':'+units;return a;
}
async function phase(name,fn,a){const P=frame.contentWindow.interactionPerf;await a.settle();await delay(100);P.reset();P.start();const start=performance.now();await fn();const release=performance.now();P.mark('release');await a.settle();P.stop();const end=performance.now(),gpu=await P.readGPU(),events=P.events.slice(),inputs=P.inputs.slice(),detail=events.filter(e=>e.type==='present'&&e.detail),releasedAt=events.find(e=>e.type==='release').t,activeFrames=P.frameRecords.filter(e=>e.t<releasedAt).map(e=>e.ms).sort((a,b)=>a-b),frames=P.frames.slice().sort((x,y)=>x-y),quant=(xs,p)=>xs.length?xs[Math.min(xs.length-1,Math.floor(xs.length*p))]:null;const gaps=detail.slice(1).map((x,i)=>x.t-detail[i].t).sort((x,y)=>x-y);
 const row={name,activeMs:release-start,settleMs:end-release,inputCount:inputs.length,frameMedian:quant(frames,.5),frameP95:quant(frames,.95),activeFrameP95:quant(activeFrames,.95),frameMax:frames.at(-1),detailPresents:detail.length,freshPresents:detail.filter(e=>e.fresh&&e.t<releasedAt).length,freshTilesPerSecond:detail.filter(e=>e.fresh&&e.t<releasedAt).length/((release-start)/1000),detailGapMedian:quant(gaps,.5),detailGapP95:quant(gaps,.95),longTasks:P.long.slice(),stages:P.stages,gpu,events,inputs,stats:a.canvas.stats()};line(`${name}: active ${row.activeMs.toFixed(0)}ms; settle ${row.settleMs.toFixed(0)}ms; frame p95 ${row.frameP95?.toFixed(1)}; ${row.freshPresents} fresh tile deliveries during input`);return row;}
const next=()=>new Promise(r=>frame.contentWindow.requestAnimationFrame(r));
async function gestures(a,label){const w=frame.contentWindow,d=frame.contentDocument,o=d.getElementById('overlay');
 const capture=o.setPointerCapture.bind(o),release=o.releasePointerCapture.bind(o);o.setPointerCapture=id=>{if(id!==9042)capture(id);};o.releasePointerCapture=id=>{if(id!==9042)release(id);};
 const point=(x,y)=>{const v=a.canvas.view(),r=o.getBoundingClientRect();return {clientX:r.left+(x-v.x)*v.scale,clientY:r.top+(y-v.y)*v.scale};};
 const event=(type,x,y)=>o.dispatchEvent(new w.PointerEvent(type,{...point(x,y),pointerId:9042,pointerType:'mouse',bubbles:true,button:0,buttons:type==='pointerup'?0:1,isPrimary:true}));
 const rows=[];d.querySelector('[data-tool="hill"]').click();
 rows.push(await phase('draw',async()=>{event('pointerdown',180,260);for(let i=1;i<=90;i++){if(stop)break;event('pointermove',180+i*3.2,260+Math.sin(i/18)*40+i*.9);await next();}event('pointerup',468,260+Math.sin(5)*40+81);},a));
 await png(label+'/draw-final.png',d.getElementById('terrain'));
 const n=a.nodes.at(-1),p=n.points[Math.floor(n.points.length/2)],sy=p.y-(Math.max(a.config.seaLevel,a.region.sample(p.x,p.y))-a.config.baseHeight)/2;a.select(a.nodes.length-1);
 rows.push(await phase('drag',async()=>{event('pointerdown',p.x,sy);for(let i=1;i<=90;i++){if(stop)break;event('pointermove',p.x+Math.sin(i/30)*100,sy+Math.sin(i/18)*35);await next();}event('pointerup',p.x+Math.sin(3)*100,sy+Math.sin(5)*35);},a));
 await png(label+'/drag-final.png',d.getElementById('terrain'));
 const amount=d.getElementById('amount'),base=Number(amount.value);
 rows.push(await phase('slider',async()=>{for(let i=0;i<60;i++){if(stop)break;amount.value=base+Math.sin(i/15)*25;amount.dispatchEvent(new w.Event('input',{bubbles:true}));await next();}amount.dispatchEvent(new w.Event('change',{bubbles:true}));},a));
 await png(label+'/edit-final.png',d.getElementById('terrain'));
 d.getElementById('edit-path').click();const pp=a.nodes.at(-1).points[0],psy=pp.y-(Math.max(a.config.seaLevel,a.region.sample(pp.x,pp.y))-a.config.baseHeight)/2;
 rows.push(await phase('path-point',async()=>{event('pointerdown',pp.x,psy);for(let i=1;i<=60;i++){event('pointermove',pp.x+i*.8,psy-i*.4);await next();}event('pointerup',pp.x+48,psy-24);},a));
 await png(label+'/point-final.png',d.getElementById('terrain'));return rows;
}
async function run(fn){stop=false;log.textContent='Running\n';for(const b of document.querySelectorAll('button:not(#stop)'))b.disabled=true;try{await fn();line(stop?'STOPPED':'COMPLETE');}catch(e){line('FAIL '+e.stack);}finally{for(const b of document.querySelectorAll('button'))b.disabled=false;}}
$('stop').onclick=()=>{stop=true;};
$('load').onclick=()=>run(async()=>{await load();line('Fixture ready');});
$('run').onclick=()=>run(async()=>{const name=$('scene').value,units=Number($('units').value),label=$('label').value+'/'+name+'-'+units,a=await load(name,units),rows=[];
 rows.push(await phase('fit',async()=>{a.canvas.zoom('overview');},a));await png(label+'/fit.png',frame.contentDocument.getElementById('terrain'));a.canvas.zoom(1);frame.contentDocument.getElementById('viewport').scrollTo(0,0);await a.settle();await png(label+'/one.png',frame.contentDocument.getElementById('terrain'));
 rows.push(...await gestures(a,label));await save(label+'/interaction.json',{scene:name,units,rows});line('Saved '+label);
});

$('cache').onclick=()=>run(async()=>{const name=$('scene').value,units=Number($('units').value),label=$('label').value+'/'+name+'-'+units,a=await load(name,units),d=frame.contentDocument;const snap=()=>a.canvas.cacheSnapshot?.()||[];const before=snap(),bakes=a.canvas.stats().bakes;
 a.region.applyStroke('hill',[{x:units*512-200,y:units*512-200}],{radius:70,amount:50,rough:.35,softness:.5,bankWidth:.5});await a.settle();const far=snap(),farBakes=a.canvas.stats().bakes-bakes;
 a.region.editNode(1,n=>{n.points=n.points?.map(p=>({x:p.x+25,y:p.y+15}));});await a.settle();const cache=document.createElement('canvas');cache.width=d.getElementById('terrain').width;cache.height=d.getElementById('terrain').height;cache.getContext('2d').drawImage(d.getElementById('terrain'),0,0);const updated=snap();
 a.canvas.invalidate();await a.settle();const x=cache.getContext('2d').getImageData(0,0,cache.width,cache.height).data,y=d.getElementById('terrain').getContext('2d').getImageData(0,0,cache.width,cache.height).data;let max=0,count=0;for(let i=0;i<x.length;i++){const e=Math.abs(x[i]-y[i]);max=Math.max(max,e);if(e)count++;}
 const view=a.canvas.view(),overlaps=e=>e.x<view.x+view.width&&e.y<view.y+view.height&&e.x+e.width>view.x&&e.y+e.height>view.y,farVisibleChanges=far.filter(e=>overlaps(e)&&before.find(b=>b.key===e.key)?.seq!==e.seq).length;
 const result={view,before,far,farBakes,farVisibleChanges,updated,forcedRefresh:{max,changedChannels:count},errors:d.getElementById('error').textContent};await save(label+'/cache.json',result);line('Cache check: distant edit '+farBakes+' bakes; forced refresh maximum difference '+max);
 a.canvas.zoom('overview');await a.settle();await png(label+'/fit-edited.png',d.getElementById('terrain'));const fit=d.getElementById('terrain'),target=new OffscreenCanvas(fit.width,fit.height),g=target.getContext('2d');g.imageSmoothingEnabled=true;g.imageSmoothingQuality='high';
 if(units<=8){a.canvas.setBusy(true);const m=a.config.map;for(let yy=0;yy<m.height;yy+=512)for(let xx=0;xx<m.width;xx+=512){const r={x:xx,y:yy,width:Math.min(512,m.width-xx),height:Math.min(512,m.height-yy)},c=await a.capture(r);g.drawImage(c,xx/m.width*target.width,yy/m.height*target.height,r.width/m.width*target.width,r.height/m.height*target.height);}await png(label+'/fit-reference.png',target);a.canvas.setBusy(false);line('Full-quality fit reference saved');}
});

$('fitdraw').onclick=()=>run(async()=>{const name=$('scene').value,units=Number($('units').value),label=$('label').value+'/'+name+'-'+units,a=await load(name,units),d=frame.contentDocument,w=frame.contentWindow,o=d.getElementById('overlay');
 a.canvas.zoom('overview');await a.settle();const size=units*512,strokes=[];
 for(let y=0;y<3;y++)for(let x=0;x<3;x++)strokes.push(['hill',[[size*(.2+x*.3),size*(.2+y*.3)],[size*(.25+x*.3),size*(.23+y*.3)]],{card:{diameter:size*.15,amount:140,roughness:35}}]);
 a.scene(strokes,{ground:true});await a.settle();await png(label+'/fit-distributed.png',d.getElementById('terrain'));
 const cap=o.setPointerCapture.bind(o),rel=o.releasePointerCapture.bind(o);o.setPointerCapture=id=>{if(id!==9042)cap(id);};o.releasePointerCapture=id=>{if(id!==9042)rel(id);};
 const v=a.canvas.view(),r=o.getBoundingClientRect(),ev=(type,x,y)=>o.dispatchEvent(new w.PointerEvent(type,{clientX:r.left+(x-v.x)*v.scale,clientY:r.top+(y-v.y)*v.scale,pointerId:9042,pointerType:'mouse',bubbles:true,button:0,buttons:type==='pointerup'?0:1,isPrimary:true}));
 d.querySelector('[data-tool="hill"]').click();d.getElementById('diameter').value=String(Math.min(1600,size*.12));d.getElementById('diameter').dispatchEvent(new w.Event('input',{bubbles:true}));
 const row=await phase('fit-draw',async()=>{ev('pointerdown',size*.2,size*.6);for(let i=1;i<=90;i++){ev('pointermove',size*(.2+i*.004),size*(.6+Math.sin(i/18)*.04));await next();}ev('pointerup',size*.56,size*(.6+Math.sin(5)*.04));},a);
 await png(label+'/fit-draw-final.png',d.getElementById('terrain'));await save(label+'/fit-draw.json',row);line('Saved '+label);
});
$('gputest').onclick=()=>run(async()=>{const a=await load(),{changedWeatherTiles}=await import('/sculpt-change-map.js'),device=a.renderer.device,S=frame.contentWindow.GPUBufferUsage,grid=130,n=grid*grid,owned=[];
 const buffer=words=>{const b=device.createBuffer({size:words*4,usage:S.STORAGE|S.COPY_DST});owned.push(b);return b;},state=()=>({weather:buffer(n*2),maps:[buffer(n),buffer(n),buffer(n)],field:buffer(n*4),mapsOn:true});
 const before=state(),after=state(),results=[];const check=async(label,expected)=>{const actual=await changedWeatherTiles(device,before,after,grid,2);if(JSON.stringify(actual)!==JSON.stringify(expected))throw Error(label+' '+JSON.stringify(actual));results.push(label);};
 try{await check('equal',[]);device.queue.writeBuffer(after.weather,(n+1)*4,new Uint32Array([1]));await check('second weather plane',[{x:0,y:0,width:128,height:128}]);device.queue.writeBuffer(after.maps[2],(65*grid+65)*4,new Uint32Array([255]));await check('third map',[{x:0,y:0,width:128,height:128},{x:128,y:128,width:128,height:128}]);device.queue.writeBuffer(after.field,((129*grid+129)*4+3)*4,new Uint32Array([9]));await check('fourth material channel and edge',[{x:0,y:0,width:128,height:128},{x:128,y:128,width:128,height:128},{x:256,y:256,width:4,height:4}]);before.mapsOn=false;if(await changedWeatherTiles(device,before,after,grid,2)!==null)throw Error('Expected full reset after disabled maps');results.push('disabled maps reset');}finally{owned.forEach(b=>b.destroy());}
 await save($('label').value+'/dirty-gpu.json',{passed:results});line('Passed '+results.join(', '));
});

$('captureone').onclick=()=>run(async()=>{const name=$('scene').value,label=$('label').value,a=await load(name,4);a.canvas.setBusy(true);await png(label+'/references/'+name+'.png',await a.capture());await save(label+'/references/'+name+'-heights.json',await a.heights());a.canvas.setBusy(false);line('Saved '+name);});

$('stable').onclick=()=>run(async()=>{const name=$('scene').value,label=$('label').value+'/'+name+'-4',a=await load(name,4);a.canvas.setBusy(true);const first=await a.capture();a.refine();await a.settle();const second=await a.capture(),x=first.getContext('2d').getImageData(0,0,first.width,first.height).data,y=second.getContext('2d').getImageData(0,0,second.width,second.height).data;let max=0,count=0;for(let i=0;i<x.length;i++){const d=Math.abs(x[i]-y[i]);max=Math.max(max,d);if(d)count++;}await png(label+'/refined-again.png',second);await save(label+'/stability.json',{max,changedChannels:count});a.canvas.setBusy(false);line('Repeated refinement: max '+max+', changed channels '+count);});

$('colors').onclick=()=>run(async()=>{
 const name=$('scene').value,label=$('label').value+'/'+name,a=await load(name,4);a.canvas.setBusy(true);
 const capture=async(tag,level)=>{const b=await a.canvas.debugBake({x:0,y:0,width:1024,height:1024},level),c=new OffscreenCanvas(b.width,b.height);c.getContext('2d').drawImage(b,0,0);b.close();await png(label+'/'+tag+'.png',c);};
 try{
  await capture('settled-full',1);await capture('settled-preview',2);
  const index=a.nodes.findLastIndex(n=>n.points?.length);a.region.beginMove(index);a.region.previewMove({dx:32,dy:16});
  await capture('moving-preview',2);await capture('moving-full',1);
  a.region.endMove(true);await a.settle();await capture('moved-final',1);
 }finally{a.canvas.setBusy(false);}line('Saved color comparison '+label);
});

$('tilecheck').onclick=()=>run(async()=>{
 const name=$('scene').value,units=Number($('units').value),label=$('label').value+'/'+name+'-'+units,a=await load(name,units),renderer=a.renderer,normal=renderer.bakeFields,results=[];
 a.canvas.setBusy(true);
 const capture=async(rect,scale,reference)=>{
  renderer.evict();
  renderer.bakeFields=function(...args){if(reference){this.bakeWidth=this.fieldsTexture.width;this.bakeHeight=this.fieldsTexture.height;}return normal.apply(this,args);};
  const b=await a.canvas.debugBake(rect,scale),c=new OffscreenCanvas(b.width,b.height);c.getContext('2d').drawImage(b,0,0);b.close();return c;
 };
 try{
  const m=a.config.map;
  for(const rect of [{x:0,y:0,width:512,height:512},{x:509,y:513,width:511,height:257},{x:m.width-333,y:m.height-271,width:333,height:271}])for(const scale of [1,2,8]){
   const actual=await capture(rect,scale,false),reference=await capture(rect,scale,true),x=actual.getContext('2d').getImageData(0,0,actual.width,actual.height).data,y=reference.getContext('2d').getImageData(0,0,reference.width,reference.height).data;
   let max=0,count=0;for(let i=0;i<x.length;i++){const d=Math.abs(x[i]-y[i]);max=Math.max(max,d);if(d)count++;}results.push({rect,scale,max,changedChannels:count});
  }
 }finally{renderer.bakeFields=normal;a.canvas.setBusy(false);}
 await save(label+'/tile-output.json',{results,errors:frame.contentDocument.getElementById('error').textContent});
 if(results.some(r=>r.max))throw Error('Tile output differs: '+JSON.stringify(results.filter(r=>r.max)));
 line('Exact match: '+results.length+' tile/resolution pairs, including map edges.');
});

$('viewcheck').onclick=()=>run(async()=>{
 const name=$('scene').value,units=Number($('units').value),label=$('label').value+'/'+name+'-'+units,a=await load(name,units),w=frame.contentWindow,d=frame.contentDocument,o=d.getElementById('overlay'),c=d.getElementById('terrain'),P=w.interactionPerf;
 const read=()=>c.getContext('2d').getImageData(0,0,c.width,c.height).data;
 const before=read();P.reset();const bounds=o.getBoundingClientRect();
 for(let i=0;i<30;i++){o.dispatchEvent(new w.PointerEvent('pointermove',{clientX:bounds.left+150+i*3,clientY:bounds.top+120,pointerId:9042,pointerType:'mouse',bubbles:true,buttons:0}));await next();}
 await a.settle();const hoverPaints=P.events.filter(e=>e.type==='present').length;
 a.canvas.zoom('overview');await a.settle();a.canvas.zoom(1);d.getElementById('viewport').scrollTo(0,0);await a.settle();a.canvas.resize();await a.settle();
 const after=read();let max=0,count=0;for(let i=0;i<before.length;i++){const e=Math.abs(before[i]-after[i]);max=Math.max(max,e);if(e)count++;}
 const result={hoverPaints,viewRoundTrip:{max,changedChannels:count},errors:d.getElementById('error').textContent};await save(label+'/retained-view.json',result);
 if(hoverPaints||max||result.errors)throw Error(JSON.stringify(result));line('Hover terrain paints: 0; Fit/zoom/resize round-trip: exact.');
});

$('movecheck').onclick=()=>run(async()=>{
 const name=$('scene').value,units=Number($('units').value),label=$('label').value+'/'+name,a=await load(name,units),d=frame.contentDocument,results=[];
 const capture=async(tag,rect={x:0,y:0,width:1024,height:1024})=>{const b=await a.canvas.debugBake(rect,1),c=new OffscreenCanvas(b.width,b.height);c.getContext('2d').drawImage(b,0,0);b.close();await png(label+'/'+tag+'.png',c);return c;};
 const difference=(a,b,rect={x:0,y:0,width:a.width,height:a.height})=>{const x=a.getContext('2d').getImageData(rect.x,rect.y,rect.width,rect.height).data,y=b.getContext('2d').getImageData(rect.x,rect.y,rect.width,rect.height).data;let max=0,changed=0,total=0;for(let i=0;i<x.length;i++){const e=Math.abs(x[i]-y[i]);max=Math.max(max,e);if(e)changed++;total+=e;}return {max,changedChannels:changed,mean:total/x.length};};
 const farRect={x:1400,y:1400,width:512,height:512};
 for(const kind of ['plateau','hill']){
  a.scene([[kind,[[280,480],[430,480]],{card:{diameter:300,amount:100,roughness:35}}]],{ground:true});await a.settle();a.canvas.setBusy(true);
  try{
   const before=await capture(kind+'-before'),far=await capture(kind+'-far-before',farRect);a.region.beginMove(a.nodes.length-1);a.region.previewMove({dx:330,dy:30});
   const moving=await capture(kind+'-moving'),farMoving=await capture(kind+'-far-moving',farRect);
   const weather=d.getElementById('weather'),enabled=weather.checked;weather.checked=false;
   let authored;try{authored=await capture(kind+'-authored');}finally{weather.checked=enabled;}
   a.region.endMove(false);await a.settle();const canceled=await capture(kind+'-canceled');
   const cancel=difference(before,canceled),distant=difference(far,farMoving),oldBase=difference(moving,authored,{x:64,y:300,width:300,height:360});
   results.push({kind,cancel,distant,oldBase});
   a.region.beginMove(a.nodes.length-1);a.region.previewMove({dx:330,dy:30});a.region.endMove(true);await a.settle();await capture(kind+'-released');
   if(cancel.max||distant.max)throw Error('Move/cancel changed unrelated output: '+JSON.stringify(results.at(-1)));
  }finally{a.canvas.setBusy(false);}
 }
 await save(label+'/move-check.json',{units,results,errors:d.getElementById('error').textContent});line('Saved move comparisons; cancel and distant output match exactly. '+JSON.stringify(results));
});
