import {shapePaths} from './sculpt-paths.js';
// Shared geometry keeps the selection overlay and pointer hit targets aligned.
const clamp=(v,a,b)=>Math.max(a,Math.min(b,v));
export function selectionTransform(node, changes={}) {
  let x0=Infinity,y0=Infinity,x1=-Infinity,y1=-Infinity;
  for(const p of node.points){x0=Math.min(x0,p.x);y0=Math.min(y0,p.y);x1=Math.max(x1,p.x);y1=Math.max(y1,p.y);}
  const x=(x0+x1)/2,y=(y0+y1)/2;
  const frame=node.frame||[1,0,0,1,0,0];
  const angle=Math.atan2(frame[1],frame[0]),scale=Math.hypot(frame[0],frame[1]);
  const values={x,y,rotation:angle*180/Math.PI,scale:scale*100};
  const next={...values,...changes};
  if(Object.values(next).some(v=>!Number.isFinite(v))||next.scale<=0)throw new Error('Use finite transform values and a positive scale.');
  const turn=(next.rotation-values.rotation)*Math.PI/180,k=next.scale/values.scale;
  const a=Math.cos(turn)*k,b=Math.sin(turn)*k,c=-b,d=a;
  return {values,matrix:[a,b,c,d,next.x-a*x-c*y,next.y-b*x-d*y]};
}
// Shift-click on a shape: an unselected shape joins and becomes the primary (its handles and card show); a selected one leaves, and
// when the primary leaves the most recently added other shape takes its place. `others` keeps the order shapes were added.
export function toggleSelection(primary,others,index) {
  if(index<0)return {primary,others:[...others]};
  const rest=others.filter(i=>i!==index&&i!==primary);
  if(index===primary)return {primary:rest.length?rest.at(-1):-1,others:rest.slice(0,-1)};
  if(others.includes(index))return {primary,others:rest};
  return {primary:index,others:primary>=0?[...rest,primary]:rest};
}
export function selectionGeometry(node,project,view) {
  if(!node?.points?.length||node.hidden)return null;
  const points=node.points.map(project),scale=view.scale||1;
  let x0=Infinity,y0=Infinity,x1=-Infinity,y1=-Infinity;
  for(const p of points){x0=Math.min(x0,p.x);y0=Math.min(y0,p.y);x1=Math.max(x1,p.x);y1=Math.max(y1,p.y);}
  const {x,y}=selectionTransform(node).values,pivot={x,y},centre=project(pivot);
  const radius=node.params?.radius||0,pad=Math.max(radius+6/scale,24/scale);
  const bounds={x0:x0-pad,y0:y0-pad,x1:x1+pad,y1:y1+pad};
  const intersects=bounds.x1>=view.x&&bounds.x0<=view.x+view.width&&bounds.y1>=view.y&&bounds.y0<=view.y+view.height;
  const inset=18/scale;
  const within=p=>({x:clamp(p.x,view.x+inset,view.x+Math.max(inset,view.width-inset)),y:clamp(p.y,view.y+inset,view.y+Math.max(inset,view.height-inset))});
  const move=within(centre),rotate=within({x:centre.x,y:bounds.y0-20/scale}),resize=within({x:bounds.x1,y:bounds.y1});
  if(Math.hypot(rotate.x-move.x,rotate.y-move.y)<28/scale)rotate.y=within({x:rotate.x,y:move.y+(move.y<view.y+view.height/2?40:-40)/scale}).y;
  if(Math.hypot(resize.x-move.x,resize.y-move.y)<28/scale)resize.x=within({x:move.x+(move.x<view.x+view.width/2?40:-40)/scale,y:resize.y}).x;
  return {points,paths:shapePaths(node),pivot,centre,bounds,scale,view,visible:intersects,move,rotate,resize};
}
export function hitSelection(geometry,p,pathMode=false) {
  if(!geometry?.visible)return null;
  const reach=10/geometry.scale;
  if(pathMode){
    let index=-1,best=reach;
    geometry.points.forEach((q,i)=>{const distance=Math.hypot(p.x-q.x,p.y-q.y);if(distance<best){best=distance;index=i;}});
    return index>=0?{action:'point',index}:null;
  }
  for(const [action,key] of [['rotate','rotate'],['scale','resize'],['move','move']]){
    const q=geometry[key];if(Math.hypot(p.x-q.x,p.y-q.y)<=reach)return {action};
  }
  return null;
}
// member: another shape in a multi-selection, outlined without handles (they belong to the primary).
export function drawSelection(ctx,g,{label='',pathMode=false,point=-1,activePath=-1,hover=false,member=false}={}) {
  if(!g?.visible)return;
  const s=g.scale,b=g.bounds,color=hover?'#9ce5ef':pathMode?'#d2b1ff':'#ffe0a0';
  ctx.save();ctx.strokeStyle=color;ctx.lineWidth=(hover?1.5:1)/s;
  ctx.setLineDash([5/s,4/s]);ctx.strokeRect(b.x0,b.y0,b.x1-b.x0,b.y1-b.y0);ctx.setLineDash([]);
  for(const [i,path] of g.paths.entries()){ctx.beginPath();path.forEach((index,j)=>{const p=g.points[index];j?ctx.lineTo(p.x,p.y):ctx.moveTo(p.x,p.y);});ctx.globalAlpha=pathMode&&activePath>=0&&i!==activePath?0.45:1;ctx.lineWidth=(hover?3:2)/s;ctx.stroke();}ctx.globalAlpha=1;
  const tag=(text,p)=>{ctx.font=`${11/s}px system-ui`;ctx.textAlign='left';ctx.textBaseline='middle';const w=ctx.measureText(text).width+12/s,x=clamp(p.x,g.view.x+3/s,g.view.x+g.view.width-w-3/s),y=clamp(p.y,g.view.y+12/s,g.view.y+g.view.height-12/s);ctx.fillStyle='#142128ed';ctx.fillRect(x,y-10/s,w,20/s);ctx.fillStyle=color;ctx.fillText(text,x+6/s,y);};
  // Selected identity lives in the canvas toolbar; hover previews need a tag.
  if(hover||member){if(hover)tag(label,{x:b.x0,y:b.y0-14/s});ctx.restore();return;}
  if(pathMode){
    g.points.forEach((p,i)=>{ctx.beginPath();ctx.arc(p.x,p.y,(i===point?6:4.5)/s,0,Math.PI*2);ctx.fillStyle=i===point?color:'#18252b';ctx.fill();ctx.stroke();});
  }else{
    ctx.lineWidth=1.5/s;
    ctx.beginPath();ctx.moveTo(g.centre.x,b.y0);ctx.lineTo(g.rotate.x,g.rotate.y);ctx.stroke();
    for(const [key,name] of [['move','Move'],['rotate','Rotate'],['resize','Scale']]){
      const p=g[key];ctx.fillStyle='#17262bed';ctx.beginPath();
      if(key==='resize')ctx.rect(p.x-6/s,p.y-6/s,12/s,12/s);else ctx.arc(p.x,p.y,7/s,0,Math.PI*2);
      ctx.fill();ctx.stroke();
      if(key==='move'){ctx.beginPath();ctx.moveTo(p.x-4/s,p.y);ctx.lineTo(p.x+4/s,p.y);ctx.moveTo(p.x,p.y-4/s);ctx.lineTo(p.x,p.y+4/s);ctx.stroke();}
      tag(name,{x:p.x+12/s,y:p.y});
    }
  }
  ctx.restore();
}
