const $=id => document.getElementById(id);
export const SETTINGS=[['minWind','Minimum wind'],['maxWind','Maximum wind'],['tidal','Tidal strength'],['solar','Solar strength'],['gravity','Gravity'],['surfaceMetal','Surface metal'],['mohoMetal','Moho metal']];
// The exporter runs in the page: export/ (Go) built for WebAssembly, in a worker, with its files in the Origin Private File System.
const STORE='terraform-export',UNSUPPORTED=typeof Worker!=='function' || typeof WebAssembly!=='object' || !navigator.storage?.getDirectory || !navigator.locks?
  'This browser cannot export maps: it needs WebAssembly, web workers and the Origin Private File System. Use a current Chrome, Edge, Firefox or Safari.':'';

// Each export keeps its files in its own folder of the Origin Private File System until the next one, so its download links keep
// working; a held Web Lock marks a folder in use (by this tab or another). The rest are removed: older exports, canceled ones.
async function removeOldExports() {
  let store; try { store=await (await navigator.storage.getDirectory()).getDirectoryHandle(STORE,{create:true}); } catch { return; }
  for await (const name of store.keys()) await navigator.locks.request(`${STORE}/${name}`,{ifAvailable:true},lock => lock && store.removeEntry(name,{recursive:true}).catch(() => {}));
}
const holdLock=name => new Promise(acquired => navigator.locks.request(name,() => new Promise(release => acquired(release))));
// One worker per export: it is created when the artist exports (the program is several MB) and ends with the export, freeing its memory.
function exporter() {
  const worker=new Worker(new URL('sculpt-export-worker.js',import.meta.url));
  let waiting=null;
  const settle=(error,data) => { const w=waiting; waiting=null; if (error) w?.reject(error); else w?.resolve(data); };
  worker.onmessage=({data}) => settle(data.type==='error'?new Error(data.message):null,data);
  worker.onerror=event => { event.preventDefault(); settle(new Error(event.message||'The map exporter could not start.')); };
  return {call:(message,transfer=[]) => new Promise((resolve,reject) => { waiting={resolve,reject}; worker.postMessage(message,transfer); }),
    stop:() => { worker.terminate(); settle(new DOMException('Export canceled.','AbortError')); }};
}

// What a map's export starts from without the pane: the OTA settings as the pane's fields open at a world's climate (setSettings: a number the
// climate gives, else the field's 0, and Molten terrain unless the climate says), and the description the pane opens with.
export const climateSettings=climate => ({...Object.fromEntries(SETTINGS.map(([key]) => [key,Number.isFinite(climate?.[key])?climate[key]:climate&&Object.hasOwn(climate,key)&&(climate[key]===null||Number.isNaN(climate[key]))?NaN:0])),lava:typeof climate?.lava==='boolean'?climate.lava:false});
export const DEFAULT_DESCRIPTION='Terrain editor prototype';
// The exporter's start message (export/README.md --stream): the map's metadata, the catalog and the map's feature pack (null without features).
export function exportStart({job,config,map,catalogue,palette,name,description,settings,heights,placements=[],starts,pack=null}) {
  return {op:'start',job,metadata:{name,description,world:config.biomeId,unitsX:map.unitsX,unitsY:map.unitsY,seaLevel:config.seaLevel,heights:Array.from(heights),settings,features:placements,starts},
    catalog:{worlds:catalogue.worlds,palette,installedNames:[]},features:pack,budgetMB:64};
}

// Format encoding and round-trip checks live in Go. The terrain canvas stays
// separate from the feature overlay, so sprites never enter TNT tile art.
export function mountMapExport(api) {
  const {config}=api,map=config.map,root=document.createElement('section'); root.className='section files'; root.id='map-panel';
  root.innerHTML=`<h3>Playable map</h3><fieldset id="map-controls" style="border:0;padding:0;margin:0"><div class="row"><label>Width (units)<input id="map-x" required type="number" min="1" max="40" value="${map?.unitsX??2}"></label><label>Height (units)<input id="map-y" required type="number" min="1" max="40" value="${map?.unitsY??2}"></label></div><div class="control"><label for="map-sea">Sea level (0–255)</label><input id="map-sea" required type="number" min="0" max="255" value="${map?config.seaLevel:64}"></div><button id="map-new" style="margin-top:9px;width:100%">New map canvas</button><p class="small" id="map-geometry"></p><p class="small">New map starts blank. Yellow: play rectangle. Orange: height-dependent edge strips. Use the Features tool to place objects and player starts.</p><div class="control"><label for="map-name">Map name</label><input id="map-name" type="text" value="Sculpt map" style="width:100%"></div><div class="control"><label for="map-description">Description</label><input id="map-description" type="text" value="Terrain editor prototype" style="width:100%"></div><details><summary>OTA settings</summary><p class="small">Defaults are medians of the world's retail maps. Wind uses the OTA's stored integer units.</p>${SETTINGS.map(([key,label]) => `<div class="control"><label for="map-${key}">${label}</label><input id="map-${key}" type="number" min="0" max="${key==='surfaceMetal'?255:2147483647}" step="1" value="0"></div>`).join('')}<label><input id="map-lava" type="checkbox"> Molten terrain</label><button id="map-defaults" style="margin-top:9px">Restore world defaults</button></details></fieldset>`;
  $('map-settings-host').append(root);
  // The export action, its state and its download link belong to the Export pane.
  $('map-export-host').innerHTML='<button id="map-export" style="width:100%;margin-top:9px" disabled>Export .ufo</button><p id="map-export-state" class="small" role="status">Reading installed maps and climate…</p><button id="map-cancel" hidden style="width:100%;margin-top:9px">Cancel export</button><div id="map-download"></div>';
  $('map-geometry').textContent=map?`${map.widthCells} × ${map.heightCells} cells · ${map.width} × ${map.height} px · play ${map.playRight} × ${map.playBottom} px`:'This is a 1024 px study. Create a map canvas to include every engine cell.';
  let catalogue=null,busy=false,loadedSettings=false,abort=null,job=null;
  const defaults=() => catalogue?.worlds?.[config.biomeId]?.climate||config.exportCatalog?.worlds?.[config.biomeId]?.climate;
  function setSettings(data) { if (!data) return; for (const [key] of SETTINGS) if (Number.isFinite(data[key])) $('map-'+key).value=data[key]; else if (Object.hasOwn(data,key) && (data[key]===null || Number.isNaN(data[key]))) $('map-'+key).value=''; if (typeof data.lava==='boolean') $('map-lava').checked=data.lava; }
  function serialize() { return {name:$('map-name').value,description:$('map-description').value,settings:{...Object.fromEntries(SETTINGS.map(([key]) => [key,$('map-'+key).valueAsNumber])),lava:$('map-lava').checked}}; }
  const syncMapTitle=()=>{const name=$('map-name').value.trim()||'Untitled map',size=map?`${map.unitsX} × ${map.unitsY}`:'Study';$('tab-map').textContent=`${name} · ${size} ▾`;$('tab-map').title=`Map: ${name} · ${size} — name, size, sea level and game settings`;};
  $('map-name').addEventListener('input',syncMapTitle);syncMapTitle();
  function load(data={}) { $('map-name').value=typeof data.name==='string'?data.name:'Sculpt map'; $('map-description').value=typeof data.description==='string'?data.description:DEFAULT_DESCRIPTION; setSettings(defaults()); loadedSettings=Boolean(data.settings); if (data.settings) setSettings(data.settings); syncMapTitle(); }
  // TNT numbers tile pictures with 16 bits, so a map keeps at most 65,536 distinct 32x32 tiles; the exporter merges the most alike tiles of a map with more.
  const TILE_LIMIT=65536,tileSlots=() => map?(map.unitsX*16+1)*(map.unitsY*16+4):0;
  const tileNote=() => tileSlots()>TILE_LIMIT?` This map has ${tileSlots().toLocaleString('en-US')} tile slots. If more than ${TILE_LIMIT.toLocaleString('en-US')} of them differ, the export merges the most alike tiles.`:'';
  const update=() => { $('map-export').disabled=Boolean(UNSUPPORTED) || busy || !map || !catalogue?.worlds?.[config.biomeId]?.climate || !api.ready(); };
  const readCatalogue=config.exportCatalog?Promise.resolve(config.exportCatalog):fetch('config/catalog.json').then(async r => { const data=await r.json(); if (!r.ok) throw new Error(data.error||'Catalogue unavailable'); return data; });
  readCatalogue.then(data => { catalogue=data; if (UNSUPPORTED) { $('map-export-state').textContent=UNSUPPORTED; return update(); } const w=data.worlds[config.biomeId]; if (!map && Number.isInteger(w?.defaultSeaLevel)) $('map-sea').value=w.defaultSeaLevel; if (!loadedSettings) setSettings(w?.climate); $('map-export-state').textContent=w?.climate?`OTA planet: ${w.planet}. Climate: medians from its installed maps.${tileNote()}`:'Export disabled: '+(w?.disabledReason||'no retail planet was established for this world.'); update(); }).catch(err => { $('map-export-state').textContent=err.message; });
  setSettings(defaults());
  for (const id of ['map-name','map-description','map-lava',...SETTINGS.map(([key]) => 'map-'+key)]) $(id).addEventListener('change',() => { loadedSettings=true; api.change?.(); });
  $('map-defaults').onclick=() => { setSettings(defaults()); loadedSettings=false; api.change?.(); };
  $('map-new').onclick=() => {
    const x=Number($('map-x').value),y=Number($('map-y').value),sea=Number($('map-sea').value);
    for (const id of ['map-x','map-y','map-sea']) if (!$(id).reportValidity()) return;
    document.dispatchEvent(new CustomEvent('terraform-new-map',{detail:{x,y,sea}}));
  };
  api.onUpdate(update);
  // A finished export's files stay until the next export: its links, and the lock that keeps another tab from removing them.
  const endJob=() => { if (!job) return; for (const url of job.urls) URL.revokeObjectURL(url); job.release(); job=null; };
  $('map-cancel').onclick=() => { abort?.abort(); $('map-cancel').disabled=true; $('map-export-state').textContent='Canceling export…'; };
  async function streamedExport(name,description,settings,placements,token) {
    const signal=abort.signal;
    $('map-export-state').textContent='Sampling TNT cell corners…';
    const sampled=await api.stream.sampleHeights(signal);
    const warning=sampled.clipped?`Warning: ${sampled.clipped} cell heights clamped to 0–255. `:'';
    // The map's generated features (sculpt-features.js): their pack for the archive, their placements by name, and the deposits and
    // vents painted into the art, each anchored on these heights.
    $('map-export-state').textContent=warning+'Drawing the map’s features…';
    const drawn=await api.features?.()?.exportFeatures?.({name,heights:sampled.heights,width:map.widthCells,bakeArt:api.stream.bakeArt,signal})??{pack:null,placements:[],stamps:[]};
    const stamps=drawn.stamps.map(s => { const c=new OffscreenCanvas(128,128); c.getContext('2d').putImageData(new ImageData(s.rgba,128,128),0,0); return {...s,canvas:c}; });
    const paint=(context,rect) => { for (const s of stamps) if (s.ox<rect.x+rect.width && s.ox+128>rect.x && s.oy<rect.y+rect.height && s.oy+128>rect.y) context.drawImage(s.canvas,s.ox-rect.x,s.oy-rect.y); };
    $('map-export-state').textContent=warning+'Loading the map exporter…';
    const palette=await fetch('materials/palette.json').then(r => r.json()).then(data => data.indexed);
    const id=Array.from(crypto.getRandomValues(new Uint8Array(16)),b => b.toString(16).padStart(2,'0')).join('');
    await removeOldExports(); job={release:await holdLock(`${STORE}/${id}`),urls:[]};
    const worker=exporter(); signal.addEventListener('abort',worker.stop,{once:true});
    try {
      // The tile store's largest budget: a map within the TNT's 65,536 tiles keeps every tile in memory, and only a larger one spills to OPFS.
      await worker.call(exportStart({job:id,config,map,catalogue,palette,name,description,settings,heights:sampled.heights,placements:drawn.placements,starts:placements.starts,pack:drawn.pack}));
      await api.stream.exportChunks(async (chunk,index,total) => {
        signal.throwIfAborted(); if (api.revision()!==token) throw new Error('Map changed during export.');
        const png=await chunk.png.arrayBuffer();
        const result=await worker.call({op:'chunk',x:chunk.x,y:chunk.y,width:chunk.width,height:chunk.height,png},[png]);
        // Projected from the slots received so far; a dense map reads within 10% of its final count after 5% of the slots.
        const projected=result.receivedTiles>=result.totalTiles/20?Math.round(result.uniqueTiles/result.receivedTiles*result.totalTiles):0;
        $('map-export-state').textContent=warning+`Baking and encoding ${index+1} / ${total} chunks · ${result.uniqueTiles} unique tiles`+(projected>TILE_LIMIT?` · about ${projected.toLocaleString('en-US')} expected, over ${TILE_LIMIT.toLocaleString('en-US')}: similar tiles will be merged`:'');
      },signal,paint);
      $('map-export-state').textContent=warning+'Checking TNT, OTA and archive…';
      const {result,archive,indexed}=await worker.call({op:'finish'});
      return {...result,archiveBytes:archive.size,indexedBytes:indexed.size,files:{archive,indexed},clampedCells:sampled.clipped};
    } finally { signal.removeEventListener('abort',worker.stop); worker.stop(); }
  }
  async function exportMap(name=$('map-name').value,description=$('map-description').value) {
    if (UNSUPPORTED) throw new Error(UNSUPPORTED);
    if (!map || !catalogue?.worlds?.[config.biomeId]?.climate) throw new Error('Export is unavailable for this canvas or world.');
    if (busy || !api.ready()) throw new Error('Wait for the finished terrain before exporting.');
    const {settings}=serialize(),placements=api.mapData?.()||{};
    for (const [key] of SETTINGS) if (!Number.isInteger(settings[key]) || settings[key]<0 || settings[key]>(key==='surfaceMetal'?255:2147483647)) throw new Error('Use nonnegative integer OTA settings within the displayed bounds.');
    if (settings.minWind>settings.maxWind) throw new Error('Minimum wind must not exceed maximum wind.');
    const token=api.revision();
    busy=true; abort=new AbortController(); $('map-cancel').hidden=false; $('map-cancel').disabled=false; update(); $('map-controls').disabled=true; api.busy(true); $('map-download').replaceChildren(); endJob();
    try {
      const result=await streamedExport(name,description,settings,placements,token);
      $('map-export-state').textContent=(result.clampedCells?`Warning: ${result.clampedCells} cell heights clamped to 0–255. `:'')+(result.merge?`${result.merge.distinctTiles} distinct tiles merged into ${result.merge.keptTiles}: ${(100*result.merge.replacedSlots/result.tileSlots).toFixed(1)}% of ${result.tileSlots} slots use a similar tile instead (about ${(result.merge.meanRMS/Math.sqrt(3)).toFixed(1)} of 255 apart per color). `:`${result.uniqueTiles} unique tiles / ${result.tileSlots} slots. `)+`Self-check passed. ${result.featureCount??0} features, ${result.starts.length} starts.`;
      for (const [label,key] of [['Download .ufo','archive'],['Indexed terrain image','indexed']]) { const a=document.createElement('a'); a.textContent=label; a.href=URL.createObjectURL(result.files[key]); job.urls.push(a.href); a.download=result[key]; a.style.display='block'; $('map-download').append(a); }
      return result;
    } catch (err) {
      endJob(); setTimeout(removeOldExports,1000);   // a stopped worker lets go of its files shortly after
      $('map-export-state').textContent=err.name==='AbortError'?'Export canceled. No partial archive was published.':err.message; throw err;
    }
    finally { api.restore?.(); abort=null; $('map-cancel').hidden=true; busy=false; $('map-controls').disabled=false; api.busy(false); update(); }
  }
  $('map-export').onclick=() => exportMap().catch(()=>{});
  window.sculptMap={export:exportMap,get geometry(){return map;},get catalogue(){return catalogue;},get features(){return api.features?.();},settings:{serialize,load}};
  return {serialize,load};
}
