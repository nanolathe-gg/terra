// A paged map's material field (Material weathering above 0) is the whole map's: each page's core, made from its own window,
// matches the field one whole-map run makes. A window passes the map's spacing, not one derived from the map's size and the window's grid.
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {openScene} from './headless.mjs';
const scene=JSON.parse(readFileSync(new URL('./shape-scenes/green-landform.json',import.meta.url)));
test('each page of a paged map makes the whole map\'s material field',{timeout:240000},async()=>{
  const s=await openScene(scene,'biome=green&mapX=4&mapY=4&gpuMB=2048'),made=[];
  try{
    const material={depositSpread:.65,seed:s.refinementSeed,mineral:false},G=s.worldGrid,n=G*G,device=s.renderer.device;
    const {erosionOf}=await import('../sculpt-erosion.js'),erosion=await erosionOf(s.renderer),read=(b,o,size)=>s.fieldsModule.readBuffer(device,b,o,size);
    const eng=await s.fieldsModule.createShapeEngine({device,grid:G,spacing:s.spacing,baseHeight:s.config.baseHeight,sea:s.config.seaLevel,minH:s.minH,maxH:s.maxH});made.push(eng);
    await eng.run(s.nodes.slice(),s.context(),null);
    const whole=await erosion.runGpu({...s.engine.timeKnobs(s.renderer),planes:eng.planes,masks:eng.masks,rateMask:s.engine.MASK_KEYS.indexOf('ovErosion'),grid:G,size:s.worldSize,seaLevel:s.config.seaLevel});
    const wholeField=await erosion.materialField(s.engine.materialRequest(s.config,material,{heightBuffer:whole.weather,heightOffset:n,grid:G,size:s.worldSize}));
    const want=new Uint8Array(await read(wholeField,0,n*4));
    assert.ok(want.some(v=>v!==0),'the fixture has visible material weathering');
    const f=s.fieldsModule.createPagedFields({worldSize:s.worldSize,worldGrid:G,baseHeight:s.config.baseHeight,maskKeys:s.engine.MASK_KEYS,nodes:()=>s.nodes,device:()=>device,context:s.context,gesture:()=>false});
    made.push({destroy:()=>f.destroy()});f.changed();
    f.setTime(s.engine.pagedTime({config:s.config,renderer:s.renderer,size:s.worldSize,spacing:s.spacing,material}));
    await f.readRect({x0:0,y0:0,x1:G-1,y1:G-1});
    let cells=0,off=0,max=0,pages=0;
    for(const pg of f.debugPages()){
      assert.ok(pg.field,'a page made with Material weathering keeps its material field');pages++;
      const C=pg.core,got=new Uint8Array(await read(pg.field,0,C*C*4));
      for(let y=0;y<pg.ch;y++)for(let x=0;x<pg.cw;x++){
        const i=((pg.y0+y)*G+pg.x0+x)*4,j=(y*C+x)*4;let d=0;
        for(let c=0;c<4;c++)d=Math.max(d,Math.abs(got[j+c]-want[i+c]));
        cells++;if(d/255>.02)off++;if(d>max)max=d;
      }
    }
    console.log(`material field: ${pages} pages, ${cells} cells, ${off} differ by more than 0.02, largest ${(max/255).toFixed(4)}`);
    assert.equal(cells,n,'visited every cell including partial edge pages');
    // The Time pass behind the field differs a little near a window's sink edge (pagedWeatherCompare); the field follows it, no further.
    assert.ok(off/cells<.01,`${off} of ${cells} cells differ`);
    whole.weather.destroy();whole.maps.forEach(b=>b.destroy());wholeField.destroy();
    assert.deepEqual(s.errors,[]);
  }finally{for(const m of made)m.destroy();s.dispose();}
});
