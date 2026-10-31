// Paths reference shared vertices. A branch therefore stays attached when its
// root moves, while separate paths never acquire an implicit connecting edge.
export const shapePaths=n=>n.paths??(n.points?.length?[n.points.map((_,i)=>i)]:[]);
export const clonePaths=n=>n.paths?.map(path=>path.slice());
export function validatePaths(n){
  if(!n.points)return;
  if(!Array.isArray(n.points)||!n.points.length||n.points.some(p=>!p||!Number.isFinite(p.x)||!Number.isFinite(p.y)))throw new Error('Invalid shape points.');
  if(n.paths===undefined)return;
  if(!Array.isArray(n.paths)||!n.paths.length||n.paths.some(path=>!Array.isArray(path)||!path.length||path.some(i=>!Number.isInteger(i)||i<0||i>=n.points.length)))throw new Error('Invalid shape paths.');
  const used=new Set(n.paths.flat());
  if(used.size!==n.points.length)throw new Error('Shape contains unattached points.');
}
export function appendPath(n,points,anchor=-1){
  n.paths=shapePaths(n).map(p=>p.slice());
  const path=anchor>=0?[anchor]:[];
  for(const p of points){path.push(n.points.length);n.points.push({...p});}
  n.paths.push(path);return n.paths.length-1;
}
export function extendPoint(n,index,p,preferred=0){
  n.paths=shapePaths(n).map(path=>path.slice());
  let path=n.paths[preferred],at=path?.indexOf(index)??-1;
  if(at!==0&&at!==path?.length-1){preferred=n.paths.length;path=[index];n.paths.push(path);at=0;}
  const added=n.points.length;n.points.push({...p});
  if(at===0&&path.length>1)path.unshift(added);else path.push(added);
  return {point:added,path:preferred};
}
export function insertPoint(n,pathIndex,index){
  n.paths=shapePaths(n).map(path=>path.slice());
  const path=n.paths[pathIndex],at=path?.indexOf(index)??-1;
  if(at<0||at===path.length-1)return -1;
  const a=n.points[index],b=n.points[path[at+1]],point=n.points.length;
  n.points.push({x:(a.x+b.x)/2,y:(a.y+b.y)/2});path.splice(at+1,0,point);return point;
}
function compact(n){
  const used=new Set(n.paths.flat()),remap=new Map();
  n.points=n.points.filter((_,i)=>{if(!used.has(i))return false;remap.set(i,remap.size);return true;});
  n.paths=n.paths.map(path=>path.map(i=>remap.get(i)));return remap;
}
export function removePoint(n,index){
  if(n.points.length<=1)return false;
  n.paths=shapePaths(n).map(path=>path.filter(i=>i!==index)).filter(path=>path.length);
  compact(n);return true;
}
export function removePath(n,index){
  const paths=shapePaths(n);if(paths.length<=1)return false;
  n.paths=paths.filter((_,i)=>i!==index).map(path=>path.slice());compact(n);return true;
}
