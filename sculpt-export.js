import {sampleMapHeights,captureMapChunks} from './sculpt-map.js';
const $=id => document.getElementById(id);
const SETTINGS=[['minWind','Minimum wind'],['maxWind','Maximum wind'],['tidal','Tidal strength'],['solar','Solar strength'],['gravity','Gravity'],['surfaceMetal','Surface metal'],['mohoMetal','Moho metal']];

// Format encoding and round-trip checks live in Go. The terrain canvas stays
// separate from the feature overlay, so sprites never enter TNT tile art.
export function mountMapExport(api) {
  const {config}=api,map=config.map,root=document.createElement('section'); root.className='section files'; root.id='map-panel';
  root.innerHTML=`<h3>Playable map</h3><fieldset id="map-controls" style="border:0;padding:0;margin:0"><div class="row"><label>Width (units)<input id="map-x" type="number" min="1" max="40" value="${map?.unitsX??2}"></label><label>Height (units)<input id="map-y" type="number" min="1" max="40" value="${map?.unitsY??2}"></label></div><div class="control"><label for="map-sea">Sea level (0–255)</label><input id="map-sea" type="number" min="0" max="255" value="${map?config.seaLevel:64}"></div><button id="map-new" style="margin-top:9px;width:100%">New map canvas</button><p class="small" id="map-geometry"></p><p class="small">New map starts blank. Yellow: play rectangle. Orange: height-dependent edge strips. Use the Features tool to place objects and player starts.</p><div class="control"><label for="map-name">Map name</label><input id="map-name" type="text" value="Sculpt map" style="width:100%"></div><div class="control"><label for="map-description">Description</label><input id="map-description" type="text" value="Terrain editor prototype" style="width:100%"></div><details><summary>OTA settings</summary><p class="small">Defaults are medians of the world's retail maps. Wind uses the OTA's stored integer units.</p>${SETTINGS.map(([key,label]) => `<div class="control"><label for="map-${key}">${label}</label><input id="map-${key}" type="number" min="0" max="${key==='surfaceMetal'?255:2147483647}" step="1" value="0"></div>`).join('')}<label><input id="map-lava" type="checkbox"> Molten terrain</label><button id="map-defaults" style="margin-top:9px">Restore world defaults</button></details></fieldset>`;
  $('map-settings-host').append(root);
  // The export action, its state and its download link belong to the Export pane.
  $('map-export-host').innerHTML='<button id="map-export" style="width:100%;margin-top:9px" disabled>Export .ufo</button><p id="map-export-state" class="small" role="status">Reading installed maps and climate…</p><button id="map-cancel" hidden style="width:100%;margin-top:9px">Cancel export</button><div id="map-download"></div>';
  $('map-geometry').textContent=map?`${map.widthCells} × ${map.heightCells} cells · ${map.width} × ${map.height} px · play ${map.playRight} × ${map.playBottom} px`:'This is a 1024 px study. Create a map canvas to include every engine cell.';
  let catalogue=null,busy=false,loadedSettings=false,abort=null,exportId=null;
  const defaults=() => catalogue?.worlds?.[config.biomeId]?.climate||config.exportCatalog?.worlds?.[config.biomeId]?.climate;
  function setSettings(data) { if (!data) return; for (const [key] of SETTINGS) if (Number.isFinite(data[key])) $('map-'+key).value=data[key]; else if (Object.hasOwn(data,key) && (data[key]===null || Number.isNaN(data[key]))) $('map-'+key).value=''; if (typeof data.lava==='boolean') $('map-lava').checked=data.lava; }
  function serialize() { return {name:$('map-name').value,description:$('map-description').value,settings:{...Object.fromEntries(SETTINGS.map(([key]) => [key,$('map-'+key).valueAsNumber])),lava:$('map-lava').checked}}; }
  function load(data={}) { $('map-name').value=typeof data.name==='string'?data.name:'Sculpt map'; $('map-description').value=typeof data.description==='string'?data.description:'Terrain editor prototype'; setSettings(defaults()); loadedSettings=Boolean(data.settings); if (data.settings) setSettings(data.settings); }
  // TNT numbers tile pictures with 16 bits, so a map keeps at most 65,536 distinct 32x32 tiles; the exporter merges the most alike tiles of a map with more.
  const TILE_LIMIT=65536,tileSlots=() => map?(map.unitsX*16+1)*(map.unitsY*16+4):0;
  const tileNote=() => tileSlots()>TILE_LIMIT?` This map has ${tileSlots().toLocaleString('en-US')} tile slots. If more than ${TILE_LIMIT.toLocaleString('en-US')} of them differ, the export merges the most alike tiles; it is invisible at 1x.`:'';
  const update=() => { $('map-export').disabled=busy || !map || !catalogue?.worlds?.[config.biomeId]?.climate || !api.ready(); };
  const readCatalogue=config.exportCatalog?Promise.resolve(config.exportCatalog):fetch('/map-catalog.json').then(async r => { const data=await r.json(); if (!r.ok) throw new Error(data.error||'Catalogue unavailable'); return data; });
  readCatalogue.then(data => { catalogue=data; const w=data.worlds[config.biomeId]; if (!map && Number.isInteger(w?.defaultSeaLevel)) $('map-sea').value=w.defaultSeaLevel; if (!loadedSettings) setSettings(w?.climate); $('map-export-state').textContent=w?.climate?`OTA planet: ${w.planet}. Climate: medians from its installed maps.${tileNote()}`:'Export disabled: '+(w?.disabledReason||'no retail planet was established for this world.'); update(); }).catch(err => { $('map-export-state').textContent=err.message; });
  setSettings(defaults());
  for (const id of ['map-name','map-description','map-lava',...SETTINGS.map(([key]) => 'map-'+key)]) $(id).addEventListener('change',() => { loadedSettings=true; api.change?.(); });
  $('map-defaults').onclick=() => { setSettings(defaults()); loadedSettings=false; api.change?.(); };
  $('map-new').onclick=() => {
    const x=Number($('map-x').value),y=Number($('map-y').value),sea=Number($('map-sea').value);
    if (![x,y].every(n => Number.isInteger(n)&&n>=1&&n<=40) || !Number.isInteger(sea)||sea<0||sea>255) { $('map-export-state').textContent='Choose 1–40 units per side and an integer sea level from 0 to 255.'; return; }
    const url=new URL(location.href); url.searchParams.set('mapX',x); url.searchParams.set('mapY',y); url.searchParams.set('sea',sea); url.searchParams.set('scratch','map-'+Date.now()); url.searchParams.delete('pendingSketch'); location.href=url;
  };
  api.onUpdate(update);
  const responseJSON=async response => { const result=await response.json(); if (!response.ok) throw new Error(result.error||'Map export failed.'); return result; };
  $('map-cancel').onclick=() => { abort?.abort(); $('map-cancel').disabled=true; $('map-export-state').textContent='Canceling export…'; if (exportId) fetch('/map-export?id='+encodeURIComponent(exportId),{method:'DELETE'}).catch(()=>{}); };
  async function streamedExport(name,description,settings,placements,token) {
    const signal=abort.signal;
    $('map-export-state').textContent='Sampling TNT cell corners…';
    const sampled=await api.stream.sampleHeights(signal);
    const warning=sampled.clipped?`Warning: ${sampled.clipped} cell heights clamped to 0–255. `:'';
    const body={name,description,world:config.biomeId,unitsX:map.unitsX,unitsY:map.unitsY,seaLevel:config.seaLevel,heights:Array.from(sampled.heights),settings,features:placements.features,starts:placements.starts};
    const started=await fetch('/map-export/start',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body),signal}).then(responseJSON);
    exportId=started.id;
    await api.stream.exportChunks(async (chunk,index,total) => {
      signal.throwIfAborted(); if (api.revision()!==token) throw new Error('Map changed during export.');
      const query=new URLSearchParams({id:exportId,x:chunk.x,y:chunk.y,width:chunk.width,height:chunk.height});
      const result=await fetch('/map-export/chunk?'+query,{method:'POST',headers:{'Content-Type':'image/png'},body:chunk.png,signal}).then(responseJSON);
      // Projected from the slots received so far; a dense map reads within 10% of its final count after 5% of the slots.
      const projected=result.receivedTiles>=result.totalTiles/20?Math.round(result.uniqueTiles/result.receivedTiles*result.totalTiles):0;
      $('map-export-state').textContent=warning+`Baking and encoding ${index+1} / ${total} chunks · ${result.uniqueTiles} unique tiles`+(projected>TILE_LIMIT?` · about ${projected.toLocaleString('en-US')} expected, over ${TILE_LIMIT.toLocaleString('en-US')}: similar tiles will be merged`:'');
      await new Promise(resolve=>setTimeout(resolve,0));
    },signal);
    $('map-export-state').textContent=warning+'Checking TNT, OTA and archive…';
    const result=await fetch('/map-export/finish?id='+encodeURIComponent(exportId),{method:'POST',signal}).then(responseJSON);
    exportId=null; return {...result,clampedCells:sampled.clipped};
  }
  async function exportMap(name=$('map-name').value,description=$('map-description').value) {
    if (!map || !catalogue?.worlds?.[config.biomeId]?.climate) throw new Error('Export is unavailable for this canvas or world.');
    if (busy || !api.ready()) throw new Error('Wait for the finished terrain before exporting.');
    const {settings}=serialize(),placements=api.mapData?.()||{};
    for (const [key] of SETTINGS) if (!Number.isInteger(settings[key]) || settings[key]<0 || settings[key]>(key==='surfaceMetal'?255:2147483647)) throw new Error('Use nonnegative integer OTA settings within the displayed bounds.');
    if (settings.minWind>settings.maxWind) throw new Error('Minimum wind must not exceed maximum wind.');
    const token=api.revision(),sampled=api.stream?{clipped:0,heights:[],low:0,high:0}:sampleMapHeights(map,api.samples());
    const warning=sampled.clipped?`Warning: ${sampled.clipped} of ${sampled.heights.length} cell heights clamped to 0–255 (range ${sampled.low.toFixed(2)}…${sampled.high.toFixed(2)}). `:'';
    busy=true; abort=new AbortController(); $('map-cancel').hidden=false; $('map-cancel').disabled=false; update(); $('map-controls').disabled=true; api.busy(true); $('map-download').replaceChildren();
    try {
      let result;
      if (api.stream) result=await streamedExport(name,description,settings,placements,token);
      else {
      $('map-export-state').textContent=warning+'Capturing projected terrain chunks…';
      api.render(true);
      // Copy before PNG encoding yields: WebGPU presentation can discard the
      // drawing buffer at the next animation frame.
      const snapshot=new OffscreenCanvas(api.canvas.width,api.canvas.height); snapshot.getContext('2d').drawImage(api.canvas,0,0); api.restore();
      const chunks=await captureMapChunks(snapshot,map,config.baseHeight);
      if (api.revision()!==token) throw new Error('Map changed during export; export the finished view again.');
      $('map-export-state').textContent=warning+`Encoding ${chunks.length} chunks and checking TNT, OTA and archive…`;
      const body={name,description,world:config.biomeId,unitsX:map.unitsX,unitsY:map.unitsY,seaLevel:config.seaLevel,heights:sampled.heights,chunks,settings};
      if (placements.features) body.features=placements.features; if (placements.starts) body.starts=placements.starts;
      const response=await fetch('/map-export',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body),signal:abort.signal});
      result=await response.json(); if (!response.ok) throw new Error(result.error||'Map export failed.');
      }
      const completedWarning=api.stream&&result.clampedCells?`Warning: ${result.clampedCells} cell heights clamped to 0–255. `:warning;
      $('map-export-state').textContent=completedWarning+(result.merge?`${result.merge.distinctTiles} distinct tiles merged into ${result.merge.keptTiles}: ${(100*result.merge.replacedSlots/result.tileSlots).toFixed(1)}% of ${result.tileSlots} slots use a similar tile instead (about ${(result.merge.meanRMS/Math.sqrt(3)).toFixed(1)} of 255 apart per color). `:`${result.uniqueTiles} unique tiles / ${result.tileSlots} slots. `)+`Self-check passed. ${result.featureCount??0} features, ${result.starts.length} starts.`;
      for (const [label,key] of [['Download .ufo','archive'],['Indexed terrain image','indexed']]) { if (!result[key]) continue; const a=document.createElement('a'); a.textContent=label; a.href='/map-exports/'+encodeURIComponent(result[key]); a.download=result[key]; a.style.display='block'; $('map-download').append(a); }
      return {...result,clampedCells:result.clampedCells??sampled.clipped};
    } catch (err) { if (exportId) await fetch('/map-export?id='+encodeURIComponent(exportId),{method:'DELETE'}).catch(()=>{}); exportId=null; $('map-export-state').textContent=err.name==='AbortError'?'Export canceled. No partial archive was published.':warning+err.message; throw err; }
    finally { api.restore?.(); abort=null; $('map-cancel').hidden=true; busy=false; $('map-controls').disabled=false; api.busy(false); update(); }
  }
  $('map-export').onclick=() => exportMap().catch(()=>{});
  window.sculptMap={export:exportMap,get geometry(){return map;},get catalogue(){return catalogue;},get features(){return api.features?.();},settings:{serialize,load}};
  return {serialize,load};
}
