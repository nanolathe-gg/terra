import {STEP_LABELS,stepTypes} from './sculpt-material-steps.js';
const WIDTH=176,ROW=21;
export function nodeInputs(node){
 if(['constant','surface'].includes(node.type)||node.type==='noise'&&node.kind==='pixel')return [];
 if(node.type==='combine')return [['source','Base'],['other','Detail'],['mask','Mask']];
 return [['source',['noise','transform'].includes(node.type)?'Coordinates':node.type==='dots'?'Coverage':'Input']];
}
// Layered DAG layout with virtual vertices for long edges. Alternating
// barycenter sweeps keep related branches together rather than using save order.
export function graphPositions(steps){
 const rank=new Map(),groups=[],vertices=new Map();
 for(const s of steps)rank.set(s.id,Math.max(-1,...nodeInputs(s).map(([k])=>rank.get(s[k])??-1))+1);
 const last=Math.max(0,...rank.values());for(const s of steps)if(s.type==='output')rank.set(s.id,last);
 const add=(id,level)=>{const v={id,level,before:[],after:[],order:0};vertices.set(id,v);(groups[level]??=[]).push(v);return v;};
 for(const s of steps)add(s.id,rank.get(s.id));
 for(const s of steps)for(const [key]of nodeInputs(s)){let source=vertices.get(s[key]);if(!source)continue;const target=vertices.get(s.id);
  for(let level=source.level+1;level<target.level;level++){const dummy=add(`@${s.id}:${key}:${level}`,level);source.after.push(dummy);dummy.before.push(source);source=dummy;}
  source.after.push(target);target.before.push(source);
 }
 const index=()=>groups.forEach(group=>group?.forEach((v,i)=>v.order=i));index();
 for(let sweep=0;sweep<8;sweep++){
  const forward=sweep%2===0,levels=groups.map((_,i)=>i);if(!forward)levels.reverse();
  for(const level of levels){const group=groups[level];if(!group)continue;const score=v=>{const neighbors=forward?v.before:v.after;return neighbors.length?neighbors.reduce((n,p)=>n+p.order,0)/neighbors.length:v.order;};group.sort((a,b)=>score(a)-score(b)||a.order-b.order);index();}
 }
 const positions=new Map();for(const s of steps){const v=vertices.get(s.id),group=groups[v.level];positions.set(s.id,{x:v.level*240,y:(v.order-(group.length-1)/2)*148});}return positions;
}

class RouteQueue {
 constructor(){this.items=[];}
 push(v){const a=this.items;let i=a.length;a.push(v);while(i){const p=(i-1)>>1;if(a[p].f<=v.f)break;a[i]=a[p];i=p;}a[i]=v;}
 pop(){const a=this.items,top=a[0],last=a.pop();if(a.length){let i=0;while(i*2+1<a.length){let j=i*2+1;if(j+1<a.length&&a[j+1].f<a[j].f)j++;if(a[j].f>=last.f)break;a[i]=a[j];i=j;}a[i]=last;}return top;}
}
// Orthogonal wires use the free gutters around nodes. A small bend/overlap cost
// favors readable routes; no segment can cut through another node's card.
export function graphRoutes(nodes){
 const pad=16,boxes=nodes.map(n=>({left:n.position.x-pad,right:n.position.x+WIDTH+pad,top:n.position.y-pad,bottom:n.position.y+n.height+pad}));
 const port=(n,k)=>({x:n.position.x+(k==='out'?WIDTH:0),y:n.position.y+48+(k==='out'?0:n.inputs.findIndex(([key])=>key===k)*ROW)});
 const xs=new Set(),ys=new Set();for(let i=0;i<nodes.length;i++){const n=nodes[i],b=boxes[i];xs.add(b.left);xs.add(b.right);ys.add(b.top);ys.add(b.bottom);ys.add(port(n,'out').y);for(const [k]of n.inputs)ys.add(port(n,k).y);}
 const x=[...xs].sort((a,b)=>a-b),y=[...ys].sort((a,b)=>a-b),nx=x.length,ny=y.length,byId=new Map(nodes.map(n=>[n.step.id,n])),used=new Map(),routes=new Map();
 const horizontal=new Uint8Array(nx*ny),vertical=new Uint8Array(nx*ny);
 for(let j=0;j<ny;j++)for(let i=0;i<nx;i++){const at=j*nx+i;
  if(i+1<nx)horizontal[at]=!boxes.some(b=>y[j]>b.top&&y[j]<b.bottom&&x[i]<b.right&&x[i+1]>b.left);
  if(j+1<ny)vertical[at]=!boxes.some(b=>x[i]>b.left&&x[i]<b.right&&y[j]<b.bottom&&y[j+1]>b.top);
 }
 const edgeKey=(a,b)=>a<b?a+':'+b:b+':'+a;
 for(const target of nodes)for(const [key]of target.inputs){const source=byId.get(target.step[key]);if(!source)continue;
  const a=port(source,'out'),b=port(target,key),start=y.indexOf(a.y)*nx+x.indexOf(a.x+pad),end=y.indexOf(b.y)*nx+x.indexOf(b.x-pad);
  const distance=new Float64Array(nx*ny*2).fill(Infinity),parent=new Int32Array(nx*ny*2).fill(-1),queue=new RouteQueue();
  const heuristic=p=>Math.abs(x[p%nx]-(b.x-pad))+Math.abs(y[Math.floor(p/nx)]-b.y);
  distance[start*2]=0;queue.push({id:start*2,g:0,f:heuristic(start)});let found=-1;
  while(queue.items.length){const item=queue.pop();if(item.g!==distance[item.id])continue;const p=item.id>>1,dir=item.id&1;if(p===end){found=item.id;break;}const i=p%nx,j=Math.floor(p/nx),next=[];
   if(i&&horizontal[p-1])next.push([p-1,0,x[i]-x[i-1]]);if(i+1<nx&&horizontal[p])next.push([p+1,0,x[i+1]-x[i]]);
   if(j&&vertical[p-nx])next.push([p-nx,1,y[j]-y[j-1]]);if(j+1<ny&&vertical[p])next.push([p+nx,1,y[j+1]-y[j]]);
   for(const [q,d,length]of next){const id=q*2+d,g=item.g+length+(d===dir?0:20)+(used.get(edgeKey(p,q))??0)*length*.2;if(g>=distance[id])continue;distance[id]=g;parent[id]=item.id;queue.push({id,g,f:g+heuristic(q)});}
  }
  let path=[];if(found>=0){for(let id=found;id>=0;id=parent[id]){const p=id>>1;path.push({x:x[p%nx],y:y[Math.floor(p/nx)]});if(parent[id]>=0){const edge=edgeKey(p,parent[id]>>1);used.set(edge,(used.get(edge)??0)+1);}}path.reverse();}
  else {const top=Math.min(...boxes.map(b=>b.top))-24;path=[{x:a.x+pad,y:a.y},{x:a.x+pad,y:top},{x:b.x-pad,y:top},{x:b.x-pad,y:b.y}];}
  path=[a,...path,b];const simple=path.filter((p,i)=>!i||i===path.length-1||!((p.x===path[i-1].x&&p.x===path[i+1].x)||(p.y===path[i-1].y&&p.y===path[i+1].y)));
  routes.set(target.step.id+':'+key,simple);
 }
 return routes;
}

export function mountMaterialGraph(host){
 const canvas=document.getElementById('material-graph'),ctx=canvas.getContext('2d'),help=document.getElementById('graph-help');
 let zoom=1,pan={x:30,y:40},context=null,count=0,pendingFit=true,gesture=null,wire=null,hover=null,frame=0,disposed=false;
 let routeKey='',routes=new Map();
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
 function fit(){const nodes=all();if(!nodes.length)return;const r=canvas.getBoundingClientRect();if(r.width<10||r.height<10){pendingFit=true;return;}const x=Math.min(...nodes.map(n=>n.position.x))-35,y=Math.min(...nodes.map(n=>n.position.y))-35,w=Math.max(...nodes.map(n=>n.position.x+WIDTH))-x+35,h=Math.max(...nodes.map(n=>n.position.y+n.height))-y+35;zoom=Math.max(.12,Math.min(1.1,r.width/w,r.height/h));pan={x:(r.width-w*zoom)/2-x*zoom,y:(r.height-h*zoom)/2-y*zoom};pendingFit=false;schedule();}
 function line(a,b,color,width=2){ctx.beginPath();ctx.moveTo(a.x,a.y);const d=Math.max(45,Math.abs(b.x-a.x)*.45);ctx.bezierCurveTo(a.x+d,a.y,b.x-d,b.y,b.x,b.y);ctx.strokeStyle=color;ctx.lineWidth=width/zoom;ctx.stroke();}
 function text(value,x,y,max,color,size=12){ctx.font=`${size}px system-ui,sans-serif`;ctx.fillStyle=color;let shown=value;while(ctx.measureText(shown).width>max&&shown.length>1)shown=shown.slice(0,-2)+'…';ctx.fillText(shown,x,y);}
 function draw(){frame=0;if(disposed)return;const r=canvas.getBoundingClientRect(),dpr=window.devicePixelRatio||1;if(r.width<1||r.height<1)return;
  if(canvas.width!==Math.round(r.width*dpr)||canvas.height!==Math.round(r.height*dpr)){canvas.width=Math.round(r.width*dpr);canvas.height=Math.round(r.height*dpr);}
  if(pendingFit)fit();ctx.setTransform(dpr,0,0,dpr,0,0);ctx.fillStyle='#141d20';ctx.fillRect(0,0,r.width,r.height);
  const grid=32*zoom;ctx.fillStyle='#2b383d';for(let x=pan.x%grid;x<r.width;x+=grid)for(let y=pan.y%grid;y<r.height;y+=grid)ctx.fillRect(x,y,1,1);
  ctx.translate(pan.x,pan.y);ctx.scale(zoom,zoom);const nodes=all(),byId=new Map(nodes.map(n=>[n.step.id,n])),selected=host.selected()?.id;
  const nextKey=JSON.stringify(nodes.map(n=>[n.step.id,n.position,n.step.source,n.step.other,n.step.mask]));if(nextKey!==routeKey){routeKey=nextKey;routes=graphRoutes(nodes);}
  const wires=[];for(const n of nodes)for(const [key]of n.inputs){const source=byId.get(n.step[key]);if(source)wires.push({n,key,source,active:n.step.id===selected||source.step.id===selected});}
  for(const {n,key,source,active}of wires.sort((a,b)=>Number(a.active)-Number(b.active))){const points=routes.get(n.step.id+':'+key);if(!points?.length)continue;
   ctx.globalAlpha=active?1:.42;ctx.beginPath();ctx.moveTo(points[0].x,points[0].y);for(let i=1;i<points.length-1;i++)ctx.arcTo(points[i].x,points[i].y,points[i+1].x,points[i+1].y,7);ctx.lineTo(points.at(-1).x,points.at(-1).y);
   ctx.strokeStyle='#141d20';ctx.lineWidth=(active?6:4)/zoom;ctx.stroke();ctx.strokeStyle=palette[source.type]??palette.scalar;ctx.lineWidth=(active?2.3:1.3)/zoom;ctx.stroke();ctx.globalAlpha=1;
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
