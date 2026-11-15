// Opaque painted rectangles, partitioned after every real canvas copy. A stale
// overpaint removes the fresh pixels underneath it; overlaps never double-count.
export function createCoverage(){
  const intersect=(a,b)=>{const x=Math.max(a.x,b.x),y=Math.max(a.y,b.y),right=Math.min(a.x+a.width,b.x+b.width),bottom=Math.min(a.y+a.height,b.y+b.height);return right>x&&bottom>y?{x,y,width:right-x,height:bottom-y}:null;};
  const subtract=(a,b)=>{const c=intersect(a,b);if(!c)return [a];const out=[],put=(x,y,width,height)=>{if(width>0&&height>0)out.push({...a,x,y,width,height});};put(a.x,a.y,a.width,c.y-a.y);put(a.x,c.y+c.height,a.width,a.y+a.height-c.y-c.height);put(a.x,c.y,c.x-a.x,c.height);put(c.x+c.width,c.y,a.x+a.width-c.x-c.width,c.height);return out;};
  let regions=[];
  return {intersect,reset(){regions=[];},paint(rect,metadata){regions=regions.flatMap(r=>subtract(r,rect));regions.push({...rect,...metadata});},snapshot(){return regions.map(r=>({...r}));},covered(targets,predicate=()=>true,snapshot=regions){return targets.length>0&&targets.every(t=>{let remaining=[t];for(const r of snapshot)if(predicate(r))remaining=remaining.flatMap(p=>subtract(p,r));return remaining.length===0;});}};
}

// A newly baked image can still read retained weather from older Time settings.
// Fit images supply a background at detail zoom, not current detail coverage.
export function pictureCurrent(p,m) {
  if(m.native){
    if(p.eligible===false||m.nativeSerial==null)return false;
    if(p.weathered&&m.worldRev&&!(p.weatherRevB>=m.worldRev.B))return false;
    return p.serial>=m.nativeSerial||p.current&&p.canvasSerial>=m.nativeSerial;
  }
  return m.kind==='stroke'&&m.rev!=null?p.rev>=m.rev:m.control==='knob-erosionRain'?p.feedSerial>=m.id:p.serial>=m.id;
}

// Native pictures carry the exact Time epoch they read. Whole-map export
// readiness can lag a correct coarse view; keep epoch/serial coverage authoritative.
// Legacy builds without that metadata still need their global ready flag.
export const coverageReadyForInput=(event,input)=>Boolean(input.native||event.ready);

// A coarse answer is current terrain, but cannot satisfy LP5's final-quality
// color budget. Use the actual painted partition, including any overpaint.
export function finalQualityObservations({inputs=[],events=[],view}={}) {
  const coverage=createCoverage(),pictures=events.filter(e=>e.type==='coverage');
  const observations=inputs.map(m=>{
    const targets=view?(m.rectangles?.length?m.rectangles:[view]).map(r=>coverage.intersect(r,view)).filter(Boolean):[];
    const done=pictures.find(e=>e.t>=m.t&&coverageReadyForInput(e,m)&&coverage.covered(targets,p=>p.level<=1&&pictureCurrent(p,m),e.regions));
    return {id:m.id,t:m.t,final:done?.t??null};
  });
  return {observations,samples:observations.filter(o=>o.final!==null).map(o=>o.final-o.t)};
}
