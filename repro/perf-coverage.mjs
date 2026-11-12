// Opaque painted rectangles, partitioned after every real canvas copy. A stale
// overpaint removes the fresh pixels underneath it; overlaps never double-count.
export function createCoverage(){
  const intersect=(a,b)=>{const x=Math.max(a.x,b.x),y=Math.max(a.y,b.y),right=Math.min(a.x+a.width,b.x+b.width),bottom=Math.min(a.y+a.height,b.y+b.height);return right>x&&bottom>y?{x,y,width:right-x,height:bottom-y}:null;};
  const subtract=(a,b)=>{const c=intersect(a,b);if(!c)return [a];const out=[],put=(x,y,width,height)=>{if(width>0&&height>0)out.push({...a,x,y,width,height});};put(a.x,a.y,a.width,c.y-a.y);put(a.x,c.y+c.height,a.width,a.y+a.height-c.y-c.height);put(a.x,c.y,c.x-a.x,c.height);put(c.x+c.width,c.y,a.x+a.width-c.x-c.width,c.height);return out;};
  let regions=[];
  return {intersect,reset(){regions=[];},paint(rect,metadata){regions=regions.flatMap(r=>subtract(r,rect));regions.push({...rect,...metadata});},snapshot(){return regions.map(r=>({...r}));},covered(targets,predicate=()=>true,snapshot=regions){return targets.length>0&&targets.every(t=>{let remaining=[t];for(const r of snapshot)if(predicate(r))remaining=remaining.flatMap(p=>subtract(p,r));return remaining.length===0;});}};
}
