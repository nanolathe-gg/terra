// Card D phase 1: rectangular map bounds over the prototype's square working
// field. The extra south rows supply projected art, including the void strips.
export function configureMap(config, query) {
  if (!query.has('mapX') && !query.has('mapY')) return null;
  const unitsX=Number(query.get('mapX')),unitsY=Number(query.get('mapY')),sea=Number(query.get('sea')??64);
  if (![unitsX,unitsY].every(n => Number.isInteger(n) && n>=1 && n<=4) || !Number.isInteger(sea) || sea<0 || sea>255) throw new Error('Map size must be 1–4 units on each side; sea level must be 0–255.');
  const widthCells=unitsX*32+2,heightCells=unitsY*32+8,width=widthCells*16,height=heightCells*16;
  // DESIGN_MAP_GENERATOR geometry; 160 extra pixels cover base/2 even at
  // sea 255. Phase 3 replaces this bounded square backing with chunk fields.
  config.map={unitsX,unitsY,widthCells,heightCells,width,height,playRight:unitsX*512,playBottom:unitsY*512};
  config.size=Math.max(width,height)+160; config.grid=config.size/2;
  config.baseHeight+=sea-config.seaLevel; config.seaLevel=sea;
  return config.map;
}

export function resizeMap(map,size,fit,viewport,stage,canvas,overlay) {
  if (!map) return false;
  const scale=fit?Math.max(.05,Math.min((viewport.clientWidth-28)/map.width,(viewport.clientHeight-28)/map.height)):1;
  stage.style.width=map.width*scale+'px'; stage.style.height=map.height*scale+'px'; stage.style.overflow='hidden';
  for (const c of [canvas,overlay]) { c.style.width=size*scale+'px'; c.style.height=size*scale+'px'; }
  return true;
}

export function drawMapBounds(ink,map,config,sample) {
  if (!map) return;
  // The camera/play rectangle is in projected pixels; the north and south
  // height-dependent void cells are outlined separately [03 R-TERR-01 §2].
  ink.save(); ink.lineWidth=1; ink.setLineDash([8,6]); ink.strokeStyle='#ffe69c';
  ink.strokeRect(.5,config.baseHeight/2+.5,map.playRight-1,map.playBottom-1);
  ink.setLineDash([]); ink.strokeStyle='#ffbf7590';
  for (const south of [false,true]) {
    ink.beginPath();
    for (let x=0;x<=map.playRight;x+=16) {
      let y=south?map.height-16:0;
      if (south) { while (y>0 && y-Math.floor(sample(x,y)/2)>map.playBottom) y-=16; }
      else { while (y<128 && y-Math.floor(sample(x,y)/2)<0) y+=16; }
      const sy=y-(Math.max(config.seaLevel,sample(x,y))-config.baseHeight)/2;
      if (x===0) ink.moveTo(x,sy); else ink.lineTo(x,sy);
    }
    ink.stroke();
  }
  ink.restore();
}

export function sampleMapHeights(map,sample) {
  let clipped=0,low=Infinity,high=-Infinity;
  const heights=[];
  for (let y=0;y<map.heightCells;y++) for (let x=0;x<map.widthCells;x++) {
    const h=sample(x*16,y*16); low=Math.min(low,h); high=Math.max(high,h);
    if (h<0 || h>255) clipped++;
    heights.push(Math.round(Math.max(0,Math.min(255,h))));
  }
  return {heights,clipped,low,high};
}

// Export art uses the same quantised corners the engine will probe, including
// clamped peaks. Fine material relief stays with the existing bake.
export function exportMapField(map,corners,size,grid) {
  const field=new Float32Array(grid*grid),step=(size-1)/(grid-1),w=map.widthCells,h=map.heightCells;
  for (let y=0;y<grid;y++) for (let x=0;x<grid;x++) {
    const fx=Math.min(w-1,x*step/16),fy=Math.min(h-1,y*step/16),ix=Math.floor(fx),iy=Math.floor(fy),jx=Math.min(w-1,ix+1),jy=Math.min(h-1,iy+1),tx=fx-ix,ty=fy-iy;
    const a=corners[iy*w+ix]*(1-tx)+corners[iy*w+jx]*tx,b=corners[jy*w+ix]*(1-tx)+corners[jy*w+jx]*tx;
    field[y*grid+x]=a*(1-ty)+b*ty;
  }
  return field;
}

// The preview is y-(visible-base)/2; TNT art is y-visible/2 [03 §4.1].
// Copying at base/2 changes only projection, never the material or its noise.
// Chunks are tile aligned from the beginning, ready for phase 3's streamed bake.
export async function captureMapChunks(canvas,map,base,chunkSize=1024) {
  const chunks=[];
  for (let y=0;y<map.height;y+=chunkSize) for (let x=0;x<map.width;x+=chunkSize) {
    const width=Math.min(chunkSize,map.width-x),height=Math.min(chunkSize,map.height-y);
    const tile=new OffscreenCanvas(width,height),g=tile.getContext('2d'); g.imageSmoothingEnabled=false;
    g.drawImage(canvas,x,y+base/2,width,height,0,0,width,height);
    const blob=await tile.convertToBlob({type:'image/png'}),bytes=new Uint8Array(await blob.arrayBuffer());
    let binary=''; for (let i=0;i<bytes.length;i+=32768) binary+=String.fromCharCode(...bytes.subarray(i,i+32768));
    chunks.push({x,y,png:btoa(binary)});
  }
  return chunks;
}
