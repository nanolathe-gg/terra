// GPU intervals overlap (notably voxel build and terrain geometry). Count
// their union, and count a presented composition only when it adds a bitmap.
export function pictureWork(events,passes,from,to){
 const pictures=events.filter(e=>e.type==='coverage'&&e.fresh&&e.t>=from&&e.t<=to),n=pictures.length;
 const gpu=passes.filter(p=>p.cpuEnd>from&&p.cpuStart<to),intervals=gpu.map(p=>[Math.max(from,p.cpuStart),Math.min(to,p.cpuEnd)]).sort((a,b)=>a[0]-b[0]);
 let busy=0,end=-Infinity;for(const [a,b] of intervals){busy+=Math.max(0,b-Math.max(a,end));end=Math.max(end,b);}
 const by={};for(const p of gpu){const e=by[p.label]??={count:0,ms:0};e.count++;e.ms+=Math.min(to,p.cpuEnd)-Math.max(from,p.cpuStart);}
 return {pictures:n,gapsMs:pictures.slice(1).map((p,i)=>p.t-pictures[i].t),gpuBusyMs:busy,busyPerPictureMs:n?busy/n:null,
  passesPerPicture:Object.fromEntries(Object.entries(by).map(([k,v])=>[k,{count:v.count,perPicture:n?v.count/n:null,msPerPicture:n?v.ms/n:null}]))};
}
