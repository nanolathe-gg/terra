// Editor-owned reference profiles, calibrated from movement-rule research, not unit records.
// Slopes are the height-byte span of ONE 16 px cell's four corners, not degrees.
// These deliberately retain distinct sizes and capability bands rather than average them.
// Coverage means all/some of these references, never all units or arbitrary mod content.
import {normalizeSet,variants} from './sculpt-feature-set.js';

const profile=(size,slope,depth=12,waterSlope=255,minDepth=-10000)=>({size,slope,depth,waterSlope,minDepth});
export const MOVEMENT_FAMILIES=Object.freeze([
  {id:'vehicles',label:'Vehicles',color:'#73c69b',profiles:[profile(2,15),profile(3,15),profile(4,15)]},
  {id:'kbots',label:'KBots',color:'#edbd68',profiles:[profile(2,11),profile(2,32),profile(3,32)]},
  {id:'hover',label:'Hover',color:'#63d2d4',profiles:[profile(3,12,10000),profile(4,12,10000)]},
  {id:'amphibious',label:'Amphibious',color:'#c09be3',profiles:[profile(2,32,100),profile(3,15,100,30)]},
  {id:'ships',label:'Ships',color:'#729ee9',profiles:[profile(4,255,10000,255,3),profile(3,255,10000,255,15),profile(6,255,10000,255,15)]},
]);
export const BLOCKED_COLOR='#a95865';
export const COVERAGE_COLORS=['#a95865','#e9bc69','#73c69b'];

// Generated shrubs, deposits, vents and scars do not block; trees and rocks do.
// Footprints come from the same variant recipes as their export (no sprite readback).
export function movementObstacles(config,data={}) {
  const set=normalizeSet(data.featureSet,config),lists=new Map();
  return (data.features||[]).filter(p=>p.kind==='tree'||p.kind==='rock').flatMap(p=>{
    if(!lists.has(p.kind))lists.set(p.kind,variants(p.kind,set,config));
    const list=lists.get(p.kind),v=list[((p.v||0)%list.length+list.length)%list.length];
    return v?[{x:p.x,z:p.z,width:v.footprint[0],height:v.footprint[1]}]:[];
  });
}

export function terrainLattice({heights,width,height,sea,obstacles=[],lava=false,edges=true,originX=0,originZ=0,mapWidth=width,mapHeight=height}) {
  if(heights.length!==width*height)throw new Error('Passability needs every corner in the sampled region.');
  const low=new Uint8Array(heights.length),high=new Uint8Array(heights.length),blocked=new Uint8Array(heights.length);
  for(let z=0;z<height;z++)for(let x=0;x<width;x++){
    const i=z*width+x,e=Math.min(x+1,width-1),s=Math.min(z+1,height-1),a=heights[i],b=heights[z*width+e],c=heights[s*width+x],d=heights[s*width+e];
    low[i]=Math.min(a,b,c,d);high[i]=Math.max(a,b,c,d);
    if(lava&&low[i]<=sea)blocked[i]=3;
  }
  // The exported TNT's height-dependent north/south void strips and right columns.
  if(edges)for(let x=0;x<width;x++){
    if(originZ===0)for(let z=0;z<height&&z*16-(heights[z*width+x]>>1)<0;z++)blocked[z*width+x]=2;
    if(originZ+height===mapHeight)for(let z=height-1;z>0&&(originZ+z)*16-(heights[z*width+x]>>1)>mapHeight*16-128;z--)blocked[(z-1)*width+x]=2;
    if(originX+x>=mapWidth-2)for(let z=0;z<height;z++)blocked[z*width+x]=2;
  }
  for(const r of obstacles)for(let z=Math.max(0,r.z);z<Math.min(height,r.z+r.height);z++)for(let x=Math.max(0,r.x);x<Math.min(width,r.x+r.width);x++)blocked[z*width+x]=1;
  return {heights,width,height,sea,low,high,blocked};
}
export function cellBlockReason(t,p,x,z) {
  if(x<0||z<0||x>=t.width-1||z>=t.height-1)return 'Map edge';
  const i=z*t.width+x,b=t.blocked[i];
  if(b)return b===1?'Blocking feature':b===3?'Molten terrain':'Map edge';
  const low=t.low[i],high=t.high[i],slope=high-low;
  if(low<t.sea-p.depth)return `Water depth ${t.sea-low} > ${p.depth}`;
  if(high>t.sea-p.minDepth)return `Water too shallow (needs ${p.minDepth})`;
  const limit=low>=t.sea?p.slope:p.waterSlope;
  return slope>limit?`${low>=t.sea?'Land':'Underwater'} slope ${slope} > ${limit}`:'';
}
// Masks are indexed by the candidate center cell. Each profile tests its full,
// snapped footprint, cell by cell, using a summed-area table of rejected cells.
// A larger footprint never averages away a bad corner or a blocking feature.
export function profileMask(t,p) {
  const {width:w,height:h}=t,stride=w+1,sum=new Uint32Array((w+1)*(h+1)),out=new Uint8Array(w*h),n=p.size,half=n>>1;
  for(let z=0;z<h;z++){
    let row=0;
    for(let x=0;x<w;x++){row+=cellBlockReason(t,p,x,z)?1:0;sum[(z+1)*stride+x+1]=sum[z*stride+x+1]+row;}
  }
  for(let z=half;z<h;z++)for(let x=half;x<w;x++){
    const x0=x-half,z0=z-half,x1=x0+n,z1=z0+n;
    if(x1>=w||z1>=h)continue;
    out[z*w+x]=Number(sum[z1*stride+x1]-sum[z0*stride+x1]-sum[z1*stride+x0]+sum[z0*stride+x0]===0);
  }
  return out;
}
export function familyCoverage(t,family) {
  const counts=new Uint8Array(t.heights.length);
  for(const p of family.profiles){const mask=profileMask(t,p);for(let i=0;i<counts.length;i++)counts[i]+=mask[i];}
  const out=new Uint8Array(counts.length);
  for(let i=0;i<out.length;i++)out[i]=counts[i]===family.profiles.length?2:counts[i]?1:0;
  return out;
}
const footprintApron=Math.max(...MOVEMENT_FAMILIES.flatMap(f=>f.profiles.map(p=>Math.ceil(p.size/2))));
export function createPassability({width,height,sea,obstacles=[],lava=false}) {
  const n=width*height;
  return {width,height,sea,obstacles,lava,heights:new Uint8Array(n),sampled:new Uint8Array(n),have:new Uint8Array(n),low:new Uint8Array(n),high:new Uint8Array(n),blocked:new Uint8Array(n),coverage:MOVEMENT_FAMILIES.map(()=>new Uint8Array(n)),cells:0};
}
// A height tile is read once. Reclassify only the cells it can complete, with
// a CPU apron of already sampled export bytes; unknown corners never imply
// passable or blocked terrain. This avoids weathering nine GPU pages per tile.
export function updatePassability(t,tile) {
  const {width:w,height:h}=t,a=footprintApron;
  for(let z=0;z<tile.height;z++){const to=(tile.z+z)*w+tile.x;t.heights.set(tile.heights.subarray(z*tile.width,(z+1)*tile.width),to);t.sampled.fill(1,to,to+tile.width);}
  const x0=Math.max(0,tile.x-a),z0=Math.max(0,Math.min(tile.z-a,tile.z+tile.height===h?h-8-a+1:h)),x1=Math.min(w,tile.x+tile.width+a),z1=Math.min(h,tile.z+tile.height+a);
  const ox=Math.max(0,x0-a),ex=Math.min(w,x1+a),top=Math.max(0,z0-a),bottom=Math.min(h,z1+a);
  // A void strip scans from the physical map edge, up to eight height-byte
  // cells away. Include that edge when a footprint can enter its strip.
  const oz=top<8?0:top,ez=bottom>=h-8?h:bottom,rw=ex-ox,rh=ez-oz,heights=new Uint8Array(rw*rh),stride=rw+1,unknown=new Uint32Array(stride*(rh+1));
  for(let z=0;z<rh;z++){
    heights.set(t.heights.subarray((oz+z)*w+ox,(oz+z)*w+ex),z*rw);let row=0;
    for(let x=0;x<rw;x++){row+=1-t.sampled[(oz+z)*w+ox+x];unknown[(z+1)*stride+x+1]=unknown[z*stride+x+1]+row;}
  }
  const lattice=terrainLattice({heights,width:rw,height:rh,sea:t.sea,obstacles:t.obstacles.map(r=>({...r,x:r.x-ox,z:r.z-oz})),lava:t.lava,originX:ox,originZ:oz,mapWidth:w,mapHeight:h}),coverage=MOVEMENT_FAMILIES.map(f=>familyCoverage(lattice,f));
  const missing=(x0,z0,x1,z1)=>unknown[(z1-oz)*stride+x1-ox]-unknown[(z0-oz)*stride+x1-ox]-unknown[(z1-oz)*stride+x0-ox]+unknown[(z0-oz)*stride+x0-ox];
  // Hover tests a ready center's whole footprint against these neighbor cells.
  for(let z=oz;z<ez-Number(ez<h);z++)for(let x=ox;x<ex-Number(ex<w);x++){
    const east=Math.min(w-1,x+1),south=Math.min(h-1,z+1),i=z*w+x,j=(z-oz)*rw+x-ox;
    if(t.sampled[i]&&t.sampled[z*w+east]&&t.sampled[south*w+x]&&t.sampled[south*w+east])for(const key of ['low','high','blocked'])t[key][i]=lattice[key][j];
  }
  for(let z=z0;z<z1;z++)for(let x=x0;x<x1;x++){
    const i=z*w+x;if(t.have[i])continue;
    const left=Math.max(0,x-a),right=Math.min(w,x+a+1),top=Math.max(0,z-a),bottom=Math.min(h,z+a+1),north=top<8?0:top,south=z+a-1>=h-8?h:bottom;
    if(missing(left,north,right,south))continue;
    const j=(z-oz)*rw+x-ox;coverage.forEach((c,k)=>t.coverage[k][i]=c[j]);t.have[i]=1;t.cells++;
  }
  return {x:x0*16,width:(x1-x0)*16};
}
export function overviewClass(coverage,i) {
  // These are overlapping access types: the legend names the color's primary
  // family; the hover readout lists EVERY family that fits, including mixtures.
  for(const f of [0,1,4,2,3])if(coverage[f][i])return f;
  return 5;
}
export function inspectMovement(t,family,x,z) {
  return family.profiles.map(p=>{
    const half=p.size>>1;let reason='';
    for(let dz=0;dz<p.size&&!reason;dz++)for(let dx=0;dx<p.size&&!reason;dx++)reason=cellBlockReason(t,p,x-half+dx,z-half+dz);
    return {size:p.size,slope:p.slope,depth:p.depth,pass:!reason,reason};
  });
}
