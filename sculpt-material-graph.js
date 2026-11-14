import {STEP_LABELS,stepTypes} from './sculpt-material-steps.js';
const WIDTH=176,ROW=21;
export function nodeInputs(node){
 if(['constant','surface'].includes(node.type)||node.type==='noise'&&node.kind==='pixel')return [];
 if(node.type==='combine')return [['source','Base'],['other','Detail'],['mask','Mask']];
 return [['source',['noise','transform'].includes(node.type)?'Coordinates':node.type==='dots'?'Coverage':'Input']];
}
// Place each dependency close to its first consumer, then order and align
// branches by their connected ports. Virtual vertices reserve space for long
// links during layout only; connections remain simple, smooth curves.
export function graphPositions(steps){
 const rank=new Map(),consumers=new Map(steps.map(s=>[s.id,[]])),groups=[],vertices=new Map();
 for(const s of steps){rank.set(s.id,Math.max(-1,...nodeInputs(s).map(([k])=>rank.get(s[k])??-1))+1);for(const [k]of nodeInputs(s))consumers.get(s[k])?.push(s.id);}
 for(const s of [...steps].reverse()){const next=consumers.get(s.id);if(next.length&&s.type!=='output')rank.set(s.id,Math.min(...next.map(id=>rank.get(id)))-1);}
 const add=(id,level,step=null)=>{const height=step?Math.max(90,54+nodeInputs(step).length*ROW):24,v={id,level,before:[],after:[],y:0,top:step?48:12,bottom:step?height-48:12};vertices.set(id,v);(groups[level]??=[]).push(v);return v;};
 for(const s of steps)add(s.id,rank.get(s.id),s);
 for(const s of steps)for(const [i,[key]]of nodeInputs(s).entries()){let source=vertices.get(s[key]);if(!source)continue;const target=vertices.get(s.id);
  const link=(a,b,offset)=>{a.after.push({v:b,offset});b.before.push({v:a,offset});};
  for(let level=source.level+1;level<target.level;level++){const dummy=add(`@${s.id}:${key}:${level}`,level);link(source,dummy,0);source=dummy;}
  link(source,target,i*ROW);
 }
 // Least-squares alignment under the current order and card-spacing constraint.
 // Pool adjacent groups when their desired positions would overlap.
 const pack=(group,want)=>{let shift=0;const blocks=[];
  group.forEach((v,i)=>{if(i)shift+=group[i-1].bottom+32+v.top;const b={first:i,last:i,sum:want(v)-shift,count:1};v.shift=shift;blocks.push(b);
   while(blocks.length>1){const a=blocks.at(-2),b=blocks.at(-1);if(a.sum/a.count<=b.sum/b.count)break;a.last=b.last;a.sum+=b.sum;a.count+=b.count;blocks.pop();}
  });
  for(const b of blocks)for(let i=b.first;i<=b.last;i++)group[i].y=b.sum/b.count+group[i].shift;
 };
 for(const group of groups)if(group){pack(group,()=>0);const middle=(group[0].y+group.at(-1).y)/2;for(const v of group)v.y-=middle;}
 for(let sweep=0;sweep<12;sweep++){
  const forward=sweep%2===0,levels=groups.map((_,i)=>i);if(!forward)levels.reverse();
  for(const level of levels){const group=groups[level];if(!group)continue;
   const score=v=>{const neighbors=forward?v.before:v.after;return neighbors.length?neighbors.reduce((sum,n)=>sum+n.v.y+(forward?-n.offset:n.offset),0)/neighbors.length:v.y;};
   const wanted=new Map(group.map(v=>[v,score(v)]));group.sort((a,b)=>wanted.get(a)-wanted.get(b)||a.y-b.y);pack(group,v=>wanted.get(v));
  }
 }
 const positions=new Map(steps.map(s=>{const v=vertices.get(s.id);return [s.id,{x:v.level*240,y:Math.round(v.y-48)}];}));
 // Finish by moving cards, not routing wires: open a lane where a smooth
 // connection would otherwise disappear behind an unrelated branch.
 const nodes=steps.map(s=>({s,p:positions.get(s.id),height:Math.max(90,54+nodeInputs(s).length*ROW)})),byId=new Map(nodes.map(n=>[n.s.id,n]));
 const wires=nodes.flatMap(n=>nodeInputs(n.s).flatMap(([k],i)=>byId.has(n.s[k])?[{a:byId.get(n.s[k]),b:n,offset:i*ROW}]:[]));
 const blocked=()=>{let count=0;for(const {a,b,offset}of wires){const ax=a.p.x+WIDTH,ay=a.p.y+48,bx=b.p.x,by=b.p.y+48+offset,d=Math.max(45,Math.abs(bx-ax)*.45),hit=new Set();
  for(let i=1;i<24;i++){const t=i/24,u=1-t,x=u*u*u*ax+3*u*u*t*(ax+d)+3*u*t*t*(bx-d)+t*t*t*bx,y=ay+(by-ay)*(3*t*t-2*t*t*t);
   for(const n of nodes)if(n!==a&&n!==b&&x>n.p.x-8&&x<n.p.x+WIDTH+8&&y>n.p.y-8&&y<n.p.y+n.height+8)hit.add(n);
  }count+=hit.size;
 }return count;};
 let obstruction=blocked();
 for(let pass=0;pass<4&&obstruction;pass++){let best=null,bestCount=obstruction;
  for(const n of nodes){const column=nodes.filter(o=>o!==n&&o.p.x===n.p.x);if(!column.length)continue;
   const original=n.p.y,options=[Math.min(...column.map(o=>o.p.y))-n.height-32,Math.max(...column.map(o=>o.p.y+o.height))+32];
   for(const y of options){n.p.y=y;const count=blocked();if(count<bestCount){bestCount=count;best={n,y};}}n.p.y=original;
  }
  if(!best)break;best.n.p.y=best.y;obstruction=bestCount;
 }
 return positions;
}

export function mountMaterialGraph(host){
 const canvas=document.getElementById('material-graph'),ctx=canvas.getContext('2d'),help=document.getElementById('graph-help');
 let zoom=1,pan={x:30,y:40},context=null,count=0,pendingFit=true,gesture=null,wire=null,hover=null,frame=0,disposed=false;
 const palette={position:'#91b9df',scalar:'#d9bf8c',color:'#9bd5ae',surface:'#d3a7dd'};
 const recipe=()=>host.recipe(),steps=()=>recipe()?.steps??[];
 let placementKey='',placement=new Map();
 const all=()=>{const list=steps(),key=JSON.stringify(list.map(s=>[s.id,s.type,s.kind,s.source,s.other,s.mask]));if(key!==placementKey){placementKey=key;placement=graphPositions(list);}const auto=placement,types=stepTypes(list);return list.map(s=>({step:s,position:gesture?.kind==='node'&&gesture.id===s.id?gesture.position:s.position??auto.get(s.id),type:types.get(s.id),inputs:nodeInputs(s),height:Math.max(90,54+nodeInputs(s).length*ROW)}));};
 const port=(node,key)=>({x:node.position.x+(key==='out'?WIDTH:0),y:node.position.y+48+(key==='out'?0:node.inputs.findIndex(([k])=>k===key)*ROW)});
 const point=e=>{const r=canvas.getBoundingClientRect();return {x:(e.clientX-r.left-pan.x)/zoom,y:(e.clientY-r.top-pan.y)/zoom};};
 const hit=p=>{const nodes=all();for(const node of nodes.reverse()){
   if(node.step.type!=='output'){const q=port(node,'out');if(Math.hypot(p.x-q.x,p.y-q.y)<10/zoom)return {node,key:'out'};}
   for(const [key]of node.inputs){const q=port(node,key);if(Math.hypot(p.x-q.x,p.y-q.y)<10/zoom)return {node,key};}
   if(p.x>=node.position.x&&p.x<=node.position.x+WIDTH&&p.y>=node.position.y&&p.y<=node.position.y+node.height)return {node,key:p.y<node.position.y+27&&p.x<node.position.x+24?'enabled':'body'};
  }return null;};
 const schedule=()=>{if(!frame&&!disposed)frame=requestAnimationFrame(draw);};
 function fit(){const nodes=all();if(!nodes.length)return;const r=canvas.getBoundingClientRect();if(r.width<10||r.height<10){pendingFit=true;return;}const x=Math.min(...nodes.map(n=>n.position.x))-35,y=Math.min(...nodes.map(n=>n.position.y))-35,w=Math.max(...nodes.map(n=>n.position.x+WIDTH))-x+35,h=Math.max(...nodes.map(n=>n.position.y+n.height))-y+35;zoom=Math.max(.12,Math.min(1.1,r.width/w,r.height/h));pan={x:(r.width-w*zoom)/2-x*zoom,y:(r.height-h*zoom)/2-y*zoom};pendingFit=false;schedule();}
 function line(a,b,color,width=2){ctx.beginPath();ctx.moveTo(a.x,a.y);const d=Math.max(45,Math.abs(b.x-a.x)*.45);ctx.bezierCurveTo(a.x+d,a.y,b.x-d,b.y,b.x,b.y);ctx.strokeStyle=color;ctx.lineWidth=width/zoom;ctx.stroke();}
 function text(value,x,y,max,color,size=12){ctx.font=`${size}px system-ui,sans-serif`;ctx.fillStyle=color;let shown=value;while(ctx.measureText(shown).width>max&&shown.length>1)shown=shown.slice(0,-2)+'…';ctx.fillText(shown,x,y);}
 function draw(){frame=0;if(disposed)return;const r=canvas.getBoundingClientRect(),dpr=window.devicePixelRatio||1;if(r.width<1||r.height<1)return;
  if(canvas.width!==Math.round(r.width*dpr)||canvas.height!==Math.round(r.height*dpr)){canvas.width=Math.round(r.width*dpr);canvas.height=Math.round(r.height*dpr);}
  if(pendingFit)fit();ctx.setTransform(dpr,0,0,dpr,0,0);ctx.fillStyle='#141d20';ctx.fillRect(0,0,r.width,r.height);
  const grid=32*zoom;ctx.fillStyle='#2b383d';for(let x=pan.x%grid;x<r.width;x+=grid)for(let y=pan.y%grid;y<r.height;y+=grid)ctx.fillRect(x,y,1,1);
  ctx.translate(pan.x,pan.y);ctx.scale(zoom,zoom);const nodes=all(),byId=new Map(nodes.map(n=>[n.step.id,n])),selected=host.selected()?.id;
  const wires=[];for(const n of nodes)for(const [key]of n.inputs){const source=byId.get(n.step[key]);if(source)wires.push({n,key,source,active:n.step.id===selected||source.step.id===selected});}
  for(const {n,key,source,active}of wires.sort((a,b)=>Number(a.active)-Number(b.active))){const a=port(source,'out'),b=port(n,key);
   ctx.globalAlpha=active?1:.42;line(a,b,'#141d20',active?6:4);line(a,b,palette[source.type]??palette.scalar,active?2.3:1.3);ctx.globalAlpha=1;
  }

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
  if(target){host.choose(target.node.step.id);if(target.key!=='body'){if(target.node.step[target.key])host.connect(null,target.node.step.id,target.key);return;}gesture={kind:'node',id:target.node.step.id,start:p,original:{...target.node.position},position:{...target.node.position},moved:false};}
  else{wire=null;gesture={kind:'pan',x:e.clientX,y:e.clientY,original:{...pan}};}
  canvas.setPointerCapture(e.pointerId);schedule();
 };
 canvas.onpointermove=e=>{const p=point(e);if(wire){wire.point=p;schedule();}if(gesture?.kind==='node'){const dx=p.x-gesture.start.x,dy=p.y-gesture.start.y;gesture.moved||=Math.hypot(dx,dy)*zoom>3;if(gesture.moved)gesture.position={x:gesture.original.x+dx,y:gesture.original.y+dy};schedule();}
  else if(gesture?.kind==='pan'){pan={x:gesture.original.x+e.clientX-gesture.x,y:gesture.original.y+e.clientY-gesture.y};schedule();}
  else{hover=hit(p);canvas.style.cursor=hover?(hover.key==='body'?'grab':'crosshair'):'grab';canvas.title=hover?hover.key==='out'?`${hover.node.type} output — drag to an input`:hover.key==='enabled'?'Enable or bypass this node':hover.key!=='body'&&hover.node.step[hover.key]?'Click to disconnect this input':hover.node.step.name:'';}
 };
 const end=e=>{if(wire)connect(hit(point(e)));const g=gesture;gesture=null;if(canvas.hasPointerCapture(e.pointerId))canvas.releasePointerCapture(e.pointerId);if(g?.kind==='node'&&g.moved)host.move(g.id,g.position);schedule();};canvas.onpointerup=end;canvas.onpointercancel=e=>{gesture=null;wire=null;if(canvas.hasPointerCapture(e.pointerId))canvas.releasePointerCapture(e.pointerId);schedule();};
 canvas.onwheel=e=>{e.preventDefault();const p=point(e),r=canvas.getBoundingClientRect();zoom=Math.max(.12,Math.min(2,zoom*Math.exp(-e.deltaY*.001)));pan={x:e.clientX-r.left-p.x*zoom,y:e.clientY-r.top-p.y*zoom};schedule();};
 canvas.onkeydown=e=>{if(e.key==='Escape'&&wire){e.preventDefault();wire=null;schedule();}else if(['Delete','Backspace'].includes(e.key)){e.preventDefault();host.remove();}else if(e.key.toLowerCase()==='f'){e.preventDefault();fit();}};
 document.getElementById('graph-fit').onclick=fit;document.getElementById('graph-arrange').onclick=()=>{host.arrange(graphPositions(steps()));fit();};
 const select=document.getElementById('graph-node-select');select.onchange=()=>host.choose(select.value);
 const resize=new ResizeObserver(()=>{pendingFit=true;schedule();});resize.observe(canvas);
 return {refresh(){const next=host.context();if(next!==context){context=next;wire=null;gesture=null;pendingFit=true;}if(steps().length!==count){count=steps().length;pendingFit=true;}document.getElementById('graph-empty').hidden=!!steps().length;select.replaceChildren(...steps().map(s=>new Option(s.name,s.id)));select.value=host.selected()?.id??'';document.getElementById('graph-arrange').disabled=document.getElementById('graph-fit').disabled=!count;schedule();},fit,dispose(){disposed=true;resize.disconnect();cancelAnimationFrame(frame);},positions:()=>all().map(n=>({id:n.step.id,...n.position,width:WIDTH,height:n.height}))};
}
