import {sampleMapHeights,captureMapChunks} from './sculpt-map.js';
const $=id => document.getElementById(id);

// Small bridge from sculpt.js keeps authoring state and the existing draw path
// there. Format encoding, palette mapping and round-trip checks live in Go.
export function mountMapExport(api) {
  const {config}=api,map=config.map,root=document.createElement('section'); root.className='section files'; root.id='map-panel';
  root.innerHTML=`<h3>Playable map · phase 1</h3><div class="row"><label>Width (units)<input id="map-x" type="number" min="1" max="4" value="${map?.unitsX??2}"></label><label>Height (units)<input id="map-y" type="number" min="1" max="4" value="${map?.unitsY??2}"></label></div><div class="control"><label for="map-sea">Sea level (0–255)</label><input id="map-sea" type="number" min="0" max="255" value="${map?config.seaLevel:64}"></div><button id="map-new" style="margin-top:9px;width:100%">New map canvas</button><p class="small" id="map-geometry"></p><p class="small">New map starts blank. Yellow: play rectangle. Orange: height-dependent edge strips. Phase 1 exports terrain and two fixed starts; features and start editing follow in phase 2.</p><div class="control"><label for="map-name">Map name</label><input id="map-name" type="text" value="Sculpt map" style="width:100%"></div><div class="control"><label for="map-description">Description</label><input id="map-description" type="text" value="Terrain editor prototype" style="width:100%"></div><button id="map-export" style="width:100%;margin-top:9px" disabled>Export .ufo</button><p id="map-export-state" class="small" role="status">Reading installed maps and climate…</p><div id="map-download"></div>`;
  document.querySelector('aside').append(root);
  $('map-geometry').textContent=map?`${map.widthCells} × ${map.heightCells} cells · ${map.width} × ${map.height} px · play ${map.playRight} × ${map.playBottom} px`:'This is a 1024 px study. Create a map canvas to include every engine cell.';
  let catalogue=null,busy=false;
  $('map-new').onclick=() => {
    const x=Number($('map-x').value),y=Number($('map-y').value),sea=Number($('map-sea').value);
    if (![x,y].every(n => Number.isInteger(n)&&n>=1&&n<=4) || !Number.isInteger(sea)||sea<0||sea>255) { $('map-export-state').textContent='Choose 1–4 units per side and an integer sea level from 0 to 255.'; return; }
    const url=new URL(location.href); url.searchParams.set('mapX',x); url.searchParams.set('mapY',y); url.searchParams.set('sea',sea); url.searchParams.set('scratch','map-'+Date.now()); url.searchParams.delete('pendingSketch'); location.href=url;
  };
  const update=() => { $('map-export').disabled=busy || !map || !catalogue?.worlds?.[config.biomeId]?.climate || !api.ready(); };
  fetch('/map-catalog.json').then(async r => { const data=await r.json(); if (!r.ok) throw new Error(data.error||'Catalogue unavailable'); catalogue=data; const w=data.worlds[config.biomeId]; $('map-export-state').textContent=w?.climate?`OTA planet: ${w.planet}. Climate: medians from its installed maps.`:'Export disabled: '+(w?.disabledReason||'no retail planet was established for this world.'); update(); }).catch(err => { $('map-export-state').textContent=err.message; });
  api.onUpdate(update);
  async function exportMap(name=$('map-name').value,description=$('map-description').value) {
    if (!map || !catalogue?.worlds?.[config.biomeId]?.climate) throw new Error('Export is unavailable for this canvas or world.');
    if (busy || !api.ready()) throw new Error('Wait for the finished terrain before exporting.');
    const token=api.revision(),sampled=sampleMapHeights(map,api.samples());
    const warning=sampled.clipped?`Warning: ${sampled.clipped} of ${sampled.heights.length} cell heights clamped to 0–255 (range ${sampled.low.toFixed(2)}…${sampled.high.toFixed(2)}). `:'';
    busy=true; update(); api.busy(true); $('map-download').replaceChildren();
    try {
      $('map-export-state').textContent=warning+'Capturing projected terrain chunks…';
      api.render(sampled.heights);
      // Take a synchronous copy before PNG encoding yields: WebGPU's next
      // presentation can discard the drawing buffer at an animation frame.
      const snapshot=new OffscreenCanvas(api.canvas.width,api.canvas.height); snapshot.getContext('2d').drawImage(api.canvas,0,0); api.restore();
      const chunks=await captureMapChunks(snapshot,map,config.baseHeight);
      if (api.revision()!==token) throw new Error('Terrain changed during export; export the finished view again.');
      $('map-export-state').textContent=warning+`Encoding ${chunks.length} chunks and checking TNT, OTA and archive…`;
      const response=await fetch('/map-export',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({name,description,world:config.biomeId,unitsX:map.unitsX,unitsY:map.unitsY,seaLevel:config.seaLevel,heights:sampled.heights,chunks})});
      const result=await response.json(); if (!response.ok) throw new Error(result.error||'Map export failed.');
      $('map-export-state').textContent=warning+`${result.uniqueTiles} unique tiles / ${result.tileSlots} slots. Self-check passed. Two fixed starts included.`;
      for (const [label,key] of [['Download .ufo','archive'],['Indexed terrain image','indexed']]) { const a=document.createElement('a'); a.textContent=label; a.href='/map-exports/'+encodeURIComponent(result[key]); a.download=result[key]; a.style.display='block'; $('map-download').append(a); }
      return {...result,clampedCells:sampled.clipped};
    } catch (err) { $('map-export-state').textContent=warning+err.message; throw err; }
    finally { api.restore(); busy=false; api.busy(false); update(); }
  }
  $('map-export').onclick=() => exportMap().catch(() => {});
  window.sculptMap={export:exportMap,get geometry(){return map;},get catalogue(){return catalogue;}};
}
