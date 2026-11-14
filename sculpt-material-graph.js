import {STEP_LABELS,stepTypes} from './sculpt-material-steps.js';
const WIDTH=176,ROW=21;
export function nodeInputs(node){
 if(['constant','surface','hash'].includes(node.type))return [];
 if(node.type==='combine')return [['source','Base'],['other','Detail'],['mask','Mask']];
 return [['source',['noise','grain','transform'].includes(node.type)?'Coordinates':node.type==='dots'?'Coverage':'Input']];
}
export function graphPositions(steps){
 const levels=new Map(),rows=new Map(),positions=new Map();
 for(const s of steps){const depth=Math.max(-1,...['source','other','mask'].map(k=>levels.get(s[k])??-1))+1;levels.set(s.id,depth);const row=rows.get(depth)??0;rows.set(depth,row+1);positions.set(s.id,{x:depth*202,y:row*144});}
 return positions;
}
export function mountMaterialGraph(host){
 const canvas=document.getElementById('material-graph'),ctx=canvas.getContext('2d'),help=document.getElementById('graph-help');
 let zoom=1,pan={x:30,y:40},context=null,count=0,pendingFit=true,gesture=null,wire=null,hover=null,frame=0,disposed=false;
 const palette={position:'#91b9df',scalar:'#d9bf8c',color:'#9bd5ae',surface:'#d3a7dd'};
 const recipe=()=>host.recipe(),steps=()=>recipe()?.steps??[];
 const all=()=>{const list=steps(),auto=graphPositions(list),types=stepTypes(list);return list.map(s=>({step:s,position:gesture?.kind==='node'&&gesture.id===s.id?gesture.position:s.position??auto.get(s.id),type:types.get(s.id),inputs:nodeInputs(s),height:Math.max(90,54+nodeInputs(s).length*ROW)}));};
 const port=(node,key)=>({x:node.position.x+(key==='out'?WIDTH:0),y:node.position.y+48+(key==='out'?0:node.inputs.findIndex(([k])=>k===key)*ROW)});
 const point=e=>{const r=canvas.getBoundingClientRect();return {x:(e.clientX-r.left-pan.x)/zoom,y:(e.clientY-r.top-pan.y)/zoom};};
 const hit=p=>{const nodes=all();for(const node of nodes.reverse()){
   if(node.step.type!=='output'){const q=port(node,'out');if(Math.hypot(p.x-q.x,p.y-q.y)<10/zoom)return {node,key:'out'};}
   for(const [key]of node.inputs){const q=port(node,key);if(Math.hypot(p.x-q.x,p.y-q.y)<10/zoom)return {node,key};}
   if(p.x>=node.position.x&&p.x<=node.position.x+WIDTH&&p.y>=node.position.y&&p.y<=node.position.y+node.height)return {node,key:p.y<node.position.y+27&&p.x<node.position.x+24?'enabled':'body'};
  }return null;};
 const schedule=()=>{if(!frame&&!disposed)frame=requestAnimationFrame(draw);};
 function fit(){const nodes=all();if(!nodes.length)return;const r=canvas.getBoundingClientRect();if(r.width<10||r.height<10){pendingFit=true;return;}const x=Math.min(...nodes.map(n=>n.position.x))-35,y=Math.min(...nodes.map(n=>n.position.y))-35,w=Math.max(...nodes.map(n=>n.position.x+WIDTH))-x+35,h=Math.max(...nodes.map(n=>n.position.y+n.height))-y+35;zoom=Math.max(.25,Math.min(1.1,r.width/w,r.height/h));pan={x:(r.width-w*zoom)/2-x*zoom,y:(r.height-h*zoom)/2-y*zoom};pendingFit=false;schedule();}
 function line(a,b,color,width=2){ctx.beginPath();ctx.moveTo(a.x,a.y);const d=Math.max(45,Math.abs(b.x-a.x)*.45);ctx.bezierCurveTo(a.x+d,a.y,b.x-d,b.y,b.x,b.y);ctx.strokeStyle=color;ctx.lineWidth=width/zoom;ctx.stroke();}
 function text(value,x,y,max,color,size=12){ctx.font=`${size}px system-ui,sans-serif`;ctx.fillStyle=color;let shown=value;while(ctx.measureText(shown).width>max&&shown.length>1)shown=shown.slice(0,-2)+'…';ctx.fillText(shown,x,y);}
 function draw(){frame=0;if(disposed)return;const r=canvas.getBoundingClientRect(),dpr=window.devicePixelRatio||1;if(r.width<1||r.height<1)return;
  if(canvas.width!==Math.round(r.width*dpr)||canvas.height!==Math.round(r.height*dpr)){canvas.width=Math.round(r.width*dpr);canvas.height=Math.round(r.height*dpr);}
  if(pendingFit)fit();ctx.setTransform(dpr,0,0,dpr,0,0);ctx.fillStyle='#141d20';ctx.fillRect(0,0,r.width,r.height);
  const grid=32*zoom;ctx.fillStyle='#2b383d';for(let x=pan.x%grid;x<r.width;x+=grid)for(let y=pan.y%grid;y<r.height;y+=grid)ctx.fillRect(x,y,1,1);
  ctx.translate(pan.x,pan.y);ctx.scale(zoom,zoom);const nodes=all(),byId=new Map(nodes.map(n=>[n.step.id,n])),selected=host.selected()?.id;
  for(const n of nodes)for(const [key]of n.inputs){const source=byId.get(n.step[key]);if(source)line(port(source,'out'),port(n,key),palette[source.type]??palette.scalar,n.step.id===selected||source.step.id===selected?2.5:1.4);}
  if(wire){const source=byId.get(wire.source);if(source)line(port(source,'out'),wire.point??port(source,'out'),palette[source.type]??palette.scalar,2.5);}
  for(const n of [...nodes.filter(n=>n.step.id!==selected),...nodes.filter(n=>n.step.id===selected)]){
   const {x,y}=n.position,on=n.step.id===selected;ctx.globalAlpha=n.step.enabled?1:.48;ctx.fillStyle=on?'#2c3e37':'#202c30';ctx.strokeStyle=on?'#9bd5ae':'#425158';ctx.lineWidth=(on?1.8:1)/zoom;ctx.beginPath();ctx.roundRect(x,y,WIDTH,n.height,7);ctx.fill();ctx.stroke();
   ctx.fillStyle=palette[n.type]??palette.scalar;ctx.beginPath();ctx.arc(x+13,y+15,4,0,Math.PI*2);if(n.step.enabled)ctx.fill();else ctx.stroke();
   text(n.step.name,x+25,y+19,WIDTH-34,'#e2ece7',14);text(STEP_LABELS[n.step.type],x+12,y+35,WIDTH-24,'#9aafb3',11);
   for(const [key,label]of n.inputs){const q=port(n,key);ctx.beginPath();ctx.arc(q.x,q.y,4.5,0,Math.PI*2);ctx.fillStyle=n.step[key]?'#d8e5dc':'#56676e';ctx.fill();text(label,q.x+11,q.y+4,WIDTH-35,'#b7c9cc',11);}
   if(n.step.type!=='output'){const q=port(n,'out');ctx.beginPath();ctx.arc(q.x,q.y,5,0,Math.PI*2);ctx.fillStyle=palette[n.type]??palette.scalar;ctx.fill();}
   if(n.step.type==='gradient'){const g=ctx.createLinearGradient(x+12,0,x+WIDTH-12,0);n.step.colors.forEach((c,i)=>g.addColorStop(i/(n.step.colors.length-1),`rgb(${c.map(v=>Math.round(Math.min(1,v)*255)).join(',')})`));ctx.fillStyle=g;ctx.fillRect(x+12,y+n.height-15,WIDTH-24,5);}
   if(n.step.type==='combine')text(n.step.operation,x+12,y+n.height-8,WIDTH-24,'#86b499',10);
   if(n.step.type==='output')text(n.step.target.toUpperCase(),x+12,y+n.height-12,WIDTH-24,'#9bd5ae',10);
   ctx.globalAlpha=1;
  }
 }
 function connect(target){if(!wire||!target||['out','body','enabled'].includes(target.key))return false;host.connect(wire.source,target.node.step.id,target.key);wire=null;schedule();return true;}
 canvas.onpointerdown=e=>{if(e.button!==0)return;e.preventDefault();canvas.focus();const p=point(e),target=hit(p);if(connect(target))return;
  if(target?.key==='out'){wire={source:target.node.step.id,point:p};schedule();return;}
  if(target?.key==='enabled'){host.toggle(target.node.step.id);return;}
  if(target){host.choose(target.node.step.id);if(target.key!=='body'){if(e.altKey)host.connect(null,target.node.step.id,target.key);return;}gesture={kind:'node',id:target.node.step.id,start:p,original:{...target.node.position},position:{...target.node.position},moved:false};}
  else{wire=null;gesture={kind:'pan',x:e.clientX,y:e.clientY,original:{...pan}};}
  canvas.setPointerCapture(e.pointerId);schedule();
 };
 canvas.onpointermove=e=>{const p=point(e);if(wire){wire.point=p;schedule();}if(gesture?.kind==='node'){const dx=p.x-gesture.start.x,dy=p.y-gesture.start.y;gesture.moved||=Math.hypot(dx,dy)*zoom>3;if(gesture.moved)gesture.position={x:gesture.original.x+dx,y:gesture.original.y+dy};schedule();}
  else if(gesture?.kind==='pan'){pan={x:gesture.original.x+e.clientX-gesture.x,y:gesture.original.y+e.clientY-gesture.y};schedule();}
  else{hover=hit(p);canvas.style.cursor=hover?(hover.key==='body'?'grab':'crosshair'):'grab';canvas.title=hover?hover.key==='out'?`${hover.node.type} output — drag to an input`:hover.key==='enabled'?'Enable or bypass this node':hover.node.step.name:'';}
 };
 const end=e=>{if(wire)connect(hit(point(e)));const g=gesture;gesture=null;if(canvas.hasPointerCapture(e.pointerId))canvas.releasePointerCapture(e.pointerId);if(g?.kind==='node'&&g.moved)host.move(g.id,g.position);schedule();};canvas.onpointerup=end;canvas.onpointercancel=e=>{gesture=null;wire=null;if(canvas.hasPointerCapture(e.pointerId))canvas.releasePointerCapture(e.pointerId);schedule();};
 canvas.onwheel=e=>{e.preventDefault();const p=point(e),r=canvas.getBoundingClientRect();zoom=Math.max(.25,Math.min(2,zoom*Math.exp(-e.deltaY*.001)));pan={x:e.clientX-r.left-p.x*zoom,y:e.clientY-r.top-p.y*zoom};schedule();};
 canvas.onkeydown=e=>{if(e.key==='Escape'&&wire){e.preventDefault();wire=null;schedule();}else if(['Delete','Backspace'].includes(e.key)){e.preventDefault();host.remove();}else if(e.key.toLowerCase()==='f'){e.preventDefault();fit();}};
 document.getElementById('graph-fit').onclick=fit;document.getElementById('graph-arrange').onclick=()=>{host.arrange(graphPositions(steps()));fit();};
 const select=document.getElementById('graph-node-select');select.onchange=()=>host.choose(select.value);
 const resize=new ResizeObserver(()=>{pendingFit=true;schedule();});resize.observe(canvas);
 return {refresh(){const next=host.context();if(next!==context){context=next;wire=null;gesture=null;pendingFit=true;}if(steps().length!==count){count=steps().length;pendingFit=true;}document.getElementById('graph-empty').hidden=!!steps().length;select.replaceChildren(...steps().map(s=>new Option(s.name,s.id)));select.value=host.selected()?.id??'';document.getElementById('graph-arrange').disabled=document.getElementById('graph-fit').disabled=!count;schedule();},fit,dispose(){disposed=true;resize.disconnect();cancelAnimationFrame(frame);},positions:()=>all().map(n=>({id:n.step.id,...n.position,width:WIDTH,height:n.height}))};
}
