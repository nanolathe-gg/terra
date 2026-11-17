// Paths reference shared vertices. A branch therefore stays attached when its
// root moves, while separate paths never acquire an implicit connecting edge.
export const shapePaths=n=>n.paths??(n.points?.length?[n.points.map((_,i)=>i)]:[]);
export const clonePaths=n=>n.paths?.map(path=>path.slice());
// Whether two shapes' paths come within `gap` of each other. Each argument is a list of polylines ([{x, y}, ...]; one point is a click). The
// nearest points of every two segments count, so paths that cross are 0 apart and a near miss is as far apart as it looks.
export function pathsWithin(a, b, gap) {
  const box = path => path.reduce((r, p) => ({x0: Math.min(r.x0, p.x), y0: Math.min(r.y0, p.y), x1: Math.max(r.x1, p.x), y1: Math.max(r.y1, p.y)}), {x0: Infinity, y0: Infinity, x1: -Infinity, y1: -Infinity});
  for (const pa of a) {
    if (!pa.length) continue;
    const ba = box(pa);
    for (const pb of b) {
      if (!pb.length) continue;
      const bb = box(pb);
      if (ba.x0 - gap > bb.x1 || bb.x0 - gap > ba.x1 || ba.y0 - gap > bb.y1 || bb.y0 - gap > ba.y1) continue;
      for (let i = 0; i < Math.max(1, pa.length - 1); i++) for (let j = 0; j < Math.max(1, pb.length - 1); j++)
        if (segmentGap(pa[i], pa[Math.min(i + 1, pa.length - 1)], pb[j], pb[Math.min(j + 1, pb.length - 1)]) <= gap) return true;
    }
  }
  return false;
}
const pointToSegment = (p, a, b) => { const dx = b.x - a.x, dy = b.y - a.y, l2 = dx * dx + dy * dy, t = l2 ? Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / l2)) : 0; return Math.hypot(p.x - a.x - dx * t, p.y - a.y - dy * t); };
const turn = (o, a, b) => (a.x - o.x) * (b.y - o.y) - (a.y - o.y) * (b.x - o.x);
function segmentGap(a, b, c, d) {
  const d1 = turn(c, d, a), d2 = turn(c, d, b), d3 = turn(a, b, c), d4 = turn(a, b, d);
  if (d1 * d2 < 0 && d3 * d4 < 0) return 0;
  return Math.min(pointToSegment(a, c, d), pointToSegment(b, c, d), pointToSegment(c, a, b), pointToSegment(d, a, b));
}
// Ramer–Douglas–Peucker: keep endpoints and bends within tolerance of the
// sampled polyline. Return original vertices without changing the input.
// The iterative stack also handles long strokes without recursive calls.
export function simplifyPath(points, tolerance) {
  if (points.length < 3) return points.slice();
  const keep = new Uint8Array(points.length); keep[0] = keep[points.length - 1] = 1;
  const stack = [[0, points.length - 1]];
  while (stack.length) {
    const [a, b] = stack.pop(), pa = points[a], pb = points[b], dx = pb.x - pa.x, dy = pb.y - pa.y, l2 = dx * dx + dy * dy;
    let worst = -1, at = -1;
    for (let k = a + 1; k < b; k++) {
      const q = points[k], t = l2 ? Math.max(0, Math.min(1, ((q.x - pa.x) * dx + (q.y - pa.y) * dy) / l2)) : 0, d = Math.hypot(q.x - pa.x - dx * t, q.y - pa.y - dy * t);
      if (d > worst) { worst = d; at = k; }
    }
    if (worst > tolerance) { keep[at] = 1; stack.push([a, at], [at, b]); }
  }
  return points.filter((_, k) => keep[k]);
}
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
