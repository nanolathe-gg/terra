export {mountMapCanvas} from './sculpt-canvas.js';

// Card D: rectangular map bounds over the prototype's square working
// field. The extra south rows supply projected art, including the void strips.
// A map's size (1-40 units a side) and sea level (0-255) as the editor can open them; a save or shared map with others is not opened.
// A map's plain: how far its level ground stands above its sea (its world's own by default; Green 9). A whole number, the plain at most 255.
export const validPlain=(plain,sea) => Number.isInteger(plain) && plain>=0 && sea+plain<=255;
// The plain a saved map holds (its baseHeight over its sea level), or null.
export const savedPlain=s => Number.isFinite(s?.baseHeight) && Number.isFinite(s?.seaLevel) ? Math.round(s.baseHeight-s.seaLevel) : null;
export const validMapSize=(unitsX,unitsY,sea) => [unitsX,unitsY].every(n => Number.isInteger(n) && n>=1 && n<=40) && Number.isInteger(sea) && sea>=0 && sea<=255;
export function configureMap(config, query) {
  if (!query.has('mapX') && !query.has('mapY')) return null;
  const unitsX=Number(query.get('mapX')),unitsY=Number(query.get('mapY')),sea=Number(query.get('sea')??config.defaultSeaLevel??64);
  if (!validMapSize(unitsX,unitsY,sea)) throw new Error('Map size must be 1–40 units on each side; sea level must be 0–255.');
  const plain=query.has('plain')?Number(query.get('plain')):null;
  if (plain!==null && !validPlain(plain,sea)) throw new Error('A map’s plain stands a whole number of units above its sea, from 0 up to 255 in all.');
  // DESIGN_MAP_GENERATOR geometry; 160 extra pixels cover base/2 even at
  // sea 255. Fields and GPU bakes are regional; this is the canonical lattice.
  config.map=mapGeometry(unitsX,unitsY);
  config.size=Math.max(config.map.width,config.map.height)+160; config.grid=config.size/2;
  config.worldSize=config.size; config.worldGrid=config.grid;
  config.baseHeight+=sea-config.seaLevel; config.seaLevel=sea;
  if (plain!==null) config.baseHeight=sea+plain;   // the map's own plain (Map › Plain height above sea), else its world's
  return config.map;
}

// A map of unitsX x unitsY units: its TNT cells (two more columns, eight more rows than the play area's 32 a unit), its pixels and its play area.
export function mapGeometry(unitsX,unitsY) {
  const widthCells=unitsX*32+2,heightCells=unitsY*32+8;
  return {unitsX,unitsY,widthCells,heightCells,width:widthCells*16,height:heightCells*16,playRight:unitsX*512,playBottom:unitsY*512};
}

export function drawMapBounds(ink,map,config,sample,view=null) {
  if (!map) return;
  // The camera/play rectangle is in projected pixels; the north and south
  // height-dependent void cells are outlined separately [03 R-TERR-01 §2].
  ink.save(); ink.lineWidth=1; ink.setLineDash([8,6]); ink.strokeStyle='#ffe69c';
  ink.strokeRect(.5,config.baseHeight/2+.5,map.playRight-1,map.playBottom-1);
  ink.setLineDash([]); ink.strokeStyle='#ffbf7590';
  // Only the grid vertices that can draw into this view need height reads.
  const x0=view?Math.max(0,Math.floor(view.x/16)*16):0,x1=view?Math.min(map.playRight,Math.ceil((view.x+view.width)/16)*16):map.playRight;
  const [minH,maxH]=config.heightBounds??[-90,300],lift=(Math.max(config.seaLevel,maxH)-config.baseHeight)/2;
  for (const south of [false,true]) {
    const low=south?Math.max(0,map.playBottom+minH/2-16)-lift:-lift;
    const high=(south?map.height-16:128)-(config.seaLevel-config.baseHeight)/2;
    if(x1<x0||view&&(view.y>high+1||view.y+view.height<low-1))continue;
    ink.beginPath();
    for (let x=x0;x<=x1;x+=16) {
      let y=south?map.height-16:0;
      if (south) { while (y>0 && y-Math.floor(sample(x,y)/2)>map.playBottom) y-=16; }
      else { while (y<128 && y-Math.floor(sample(x,y)/2)<0) y+=16; }
      const sy=y-(Math.max(config.seaLevel,sample(x,y))-config.baseHeight)/2;
      if (x===x0) ink.moveTo(x,sy); else ink.lineTo(x,sy);
    }
    ink.stroke();
  }
  ink.restore();
}

// The TNT's height bytes: one per 16-px cell corner, map.widthCells x map.heightCells, each the field's mean over the corner's footprint
// (cornerHeight, below), rounded and clamped to 0..255; `clipped` counts the corners outside that range. `read` answers a region of the
// weathered field for a block of 32 x 32 corners and the footprint's apron (sculpt.js readRegional); `step` runs after each block. The page's
// export (sculpt-canvas.js sampleHeights and exportCorners) and the headless one (repro/headless.mjs) sample with this.
// sampleField: the field at one point (bilinear on the read's lattice): the displayed height (sculpt-canvas.js heightSample).
export function sampleField(r,x,y) {
  const a=r.fields.h,w=r.gridWidth,h=r.gridHeight,step=r.gridSpacing,ox=Math.round(r.gridOrigin[0]/step),oy=Math.round(r.gridOrigin[1]/step),clamp=(v,lo,hi) => Math.max(lo,Math.min(hi,v));
  const gx=clamp(x/step-ox,0,w-1),gy=clamp(y/step-oy,0,h-1),ix=Math.floor(gx),iy=Math.floor(gy),jx=Math.min(ix+1,w-1),jy=Math.min(iy+1,h-1),fx=gx-ix,fy=gy-iy;
  return (a[iy*w+ix]*(1-fx)+a[iy*w+jx]*fx)*(1-fy)+(a[jy*w+ix]*(1-fx)+a[jy*w+jx]*fx)*fy;
}
// A corner's footprint. The game keeps one height byte a 16 px cell corner, so relief finer than a cell (a landform's Face roughness, the
// art's fine relief) is smoothed away before the byte is taken: the byte is the field's mean over the corner's 16 px square (a box of
// +-8 px), not its value at one point; level ground stays level. The filter is 1 px taps (the box's end taps at half weight: the box's
// integral over the field's linear surface), each folded onto the read's lattice by its bilinear weights. Per axis that is a short list of
// lattice weights, the same for every corner at the same fraction of a lattice cell, summed in one order, so a corner reads the same bytes
// from any read that holds its footprint (regional determinism). A read asks for FOOTPRINT_APRON px past its corners: the taps' reach plus a
// lattice cell (16 px covers any lattice up to a corner's spacing).
// kind 'point' (the field at the corner, before the mean) is for checks that ask where the surface itself lies (repro/heights.gpu.test.mjs).
// The box was chosen over a Gaussian of sigma 8 (owner, 2026-11-21).
export const CORNER_FOOTPRINT={kind:'box',radius:8};
export const footprintReach=(f=CORNER_FOOTPRINT) => f.kind==='point'?0:f.radius;
export const footprintApron=(f=CORNER_FOOTPRINT) => f.kind==='point'?0:footprintReach(f)+16;
function footprintTaps(f) {
  if (f.kind==='point') return [[0,1]];
  const reach=footprintReach(f),taps=[];let sum=0;
  for (let t=-reach;t<=reach;t++) { const w=Math.abs(t)===reach?.5:1;taps.push([t,w]);sum+=w; }
  return taps.map(([t,w]) => [t,w/sum]);
}
// One axis: the lattice weights of the taps about c px, on a read of n samples `step` px apart from world sample `origin`: {first, weights},
// weights[k] multiplying local sample first + k. A tap past the read clamps to its edge, as sampleField does; that is right only at the
// world's own edge (the read holds all of the world there), so elsewhere a read that stops short of a tap is an error, not a quiet seam.
function axisWeights(c,step,origin,n,world,taps) {
  const parts=[];let first=Infinity,last=-Infinity;
  for (const [t,w] of taps) {
    const g=(c+t)/step-origin,raw=Math.floor(g),f=g-raw;
    if ((raw<0&&origin>0)||(raw+(f>0?1:0)>n-1&&world!==undefined&&origin+n<world)) throw new Error(`nanolathe: a corner's footprint reaches past its read (${c+t} px; samples ${origin}..${origin+n-1} of ${world})`);
    const i0=Math.max(0,Math.min(n-1,raw)),i1=Math.max(0,Math.min(n-1,raw+1));
    parts.push(i0,w*(1-f),i1,w*f);first=Math.min(first,i0);last=Math.max(last,i1);
  }
  const weights=new Float64Array(last-first+1);
  for (let k=0;k<parts.length;k+=2) weights[parts[k]-first]+=parts[k+1];
  return {first,weights};
}
function footprintMean(r,ax,ay) {
  const a=r.fields.h,w=r.gridWidth;let sum=0;
  for (let j=0;j<ay.weights.length;j++) {
    const wy=ay.weights[j];if (wy===0) continue;
    const row=(ay.first+j)*w+ax.first;let s=0;
    for (let i=0;i<ax.weights.length;i++) s+=ax.weights[i]*a[row+i];
    sum+=wy*s;
  }
  return sum;
}
// The export's height at corner (x, y) px, before rounding: the footprint mean over a read that holds the footprint (footprintApron).
export function cornerHeight(r,x,y,f=CORNER_FOOTPRINT) {
  const taps=footprintTaps(f),step=r.gridSpacing;
  return footprintMean(r,axisWeights(x,step,Math.round(r.gridOrigin[0]/step),r.gridWidth,r.worldGrid,taps),axisWeights(y,step,Math.round(r.gridOrigin[1]/step),r.gridHeight,r.worldGrid,taps));
}
// Stream the same export corners a render tile (512 px) at a time. A caller
// may reprioritize unread tiles as the camera moves.
export async function* cellHeightTiles(map,read,{signal,priority=()=>0,footprint=CORNER_FOOTPRINT}={}) {
  const tiles=[],taps=footprintTaps(footprint),apron=footprintApron(footprint);
  for(let z=0;z<map.heightCells;z+=32)for(let x=0;x<map.widthCells;x+=32)tiles.push({x,z,width:Math.min(32,map.widthCells-x),height:Math.min(32,map.heightCells-z)});
  while(tiles.length){
    signal?.throwIfAborted();tiles.sort((a,b)=>priority(a)-priority(b));const {x,z,width,height}=tiles.shift();
    const r=await read({x:x*16,y:z*16,width:(width-1)*16,height:(height-1)*16,apron});signal?.throwIfAborted();
    const step=r.gridSpacing,ox=Math.round(r.gridOrigin[0]/step),oy=Math.round(r.gridOrigin[1]/step);
    const cols=Array.from({length:width},(_,xx) => axisWeights((x+xx)*16,step,ox,r.gridWidth,r.worldGrid,taps));
    const heights=new Uint8Array(width*height);let clipped=0;
    for(let yy=0;yy<height;yy++){
      const row=axisWeights((z+yy)*16,step,oy,r.gridHeight,r.worldGrid,taps);
      for(let xx=0;xx<width;xx++){const h=footprintMean(r,cols[xx],row);if(h<0||h>255)clipped++;heights[yy*width+xx]=Math.round(Math.max(0,Math.min(255,h)));}
    }
    yield {heights,x,z,width,height,clipped};
  }
}
export async function cellHeights(map,read,{signal,step=async () => {},footprint}={}) {
  const heights=new Uint8Array(map.widthCells*map.heightCells);let clipped=0;
  for await(const tile of cellHeightTiles(map,read,{signal,footprint})){
    for(let yy=0;yy<tile.height;yy++)heights.set(tile.heights.subarray(yy*tile.width,(yy+1)*tile.width),(tile.z+yy)*map.widthCells+tile.x);
    clipped+=tile.clipped;await step();
  }
  return {heights,clipped};
}
