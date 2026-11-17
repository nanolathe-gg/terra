export {mountMapCanvas} from './sculpt-canvas.js';

// Card D: rectangular map bounds over the prototype's square working
// field. The extra south rows supply projected art, including the void strips.
export function configureMap(config, query) {
  if (!query.has('mapX') && !query.has('mapY')) return null;
  const unitsX=Number(query.get('mapX')),unitsY=Number(query.get('mapY')),sea=Number(query.get('sea')??config.defaultSeaLevel??64);
  if (![unitsX,unitsY].every(n => Number.isInteger(n) && n>=1 && n<=40) || !Number.isInteger(sea) || sea<0 || sea>255) throw new Error('Map size must be 1–40 units on each side; sea level must be 0–255.');
  // DESIGN_MAP_GENERATOR geometry; 160 extra pixels cover base/2 even at
  // sea 255. Fields and GPU bakes are regional; this is the canonical lattice.
  config.map=mapGeometry(unitsX,unitsY);
  config.size=Math.max(config.map.width,config.map.height)+160; config.grid=config.size/2;
  config.worldSize=config.size; config.worldGrid=config.grid;
  config.baseHeight+=sea-config.seaLevel; config.seaLevel=sea;
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

// The TNT's height bytes: one per 16-px cell corner, map.widthCells x map.heightCells, each the field's height at the corner (bilinear on the
// read's lattice), rounded and clamped to 0..255; `clipped` counts the corners outside that range. `read` answers a region of the weathered
// field for a block of 32 x 32 corners (sculpt.js readRegional); `step` runs after each block. The page's export (sculpt-canvas.js
// sampleHeights) and the headless one (repro/headless.mjs) sample with this.
export function sampleField(r,x,y) {
  const a=r.fields.h,w=r.gridWidth,h=r.gridHeight,step=r.gridSpacing,ox=Math.round(r.gridOrigin[0]/step),oy=Math.round(r.gridOrigin[1]/step),clamp=(v,lo,hi) => Math.max(lo,Math.min(hi,v));
  const gx=clamp(x/step-ox,0,w-1),gy=clamp(y/step-oy,0,h-1),ix=Math.floor(gx),iy=Math.floor(gy),jx=Math.min(ix+1,w-1),jy=Math.min(iy+1,h-1),fx=gx-ix,fy=gy-iy;
  return (a[iy*w+ix]*(1-fx)+a[iy*w+jx]*fx)*(1-fy)+(a[jy*w+ix]*(1-fx)+a[jy*w+jx]*fx)*fy;
}
// Stream the same export corners a render tile (512 px) at a time. A caller
// may reprioritize unread tiles as the camera moves.
export async function* cellHeightTiles(map,read,{signal,priority=()=>0}={}) {
  const tiles=[];
  for(let z=0;z<map.heightCells;z+=32)for(let x=0;x<map.widthCells;x+=32)tiles.push({x,z,width:Math.min(32,map.widthCells-x),height:Math.min(32,map.heightCells-z)});
  while(tiles.length){
    signal?.throwIfAborted();tiles.sort((a,b)=>priority(a)-priority(b));const {x,z,width,height}=tiles.shift();
    const r=await read({x:x*16,y:z*16,width:(width-1)*16,height:(height-1)*16});signal?.throwIfAborted();
    const heights=new Uint8Array(width*height);let clipped=0;
    for(let yy=0;yy<height;yy++)for(let xx=0;xx<width;xx++){const h=sampleField(r,(x+xx)*16,(z+yy)*16);if(h<0||h>255)clipped++;heights[yy*width+xx]=Math.round(Math.max(0,Math.min(255,h)));}
    yield {heights,x,z,width,height,clipped};
  }
}
export async function cellHeights(map,read,{signal,step=async () => {}}={}) {
  const heights=new Uint8Array(map.widthCells*map.heightCells);let clipped=0;
  for await(const tile of cellHeightTiles(map,read,{signal})){
    for(let yy=0;yy<tile.height;yy++)heights.set(tile.heights.subarray(yy*tile.width,(yy+1)*tile.width),(tile.z+yy)*map.widthCells+tile.x);
    clipped+=tile.clipped;await step();
  }
  return {heights,clipped};
}
