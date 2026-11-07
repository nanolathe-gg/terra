import {requestAdapter} from './sculpt-webgpu.js';
import {changedWeatherTiles,invalidateRefinement,refinementValid} from './sculpt-change-map.js';
import {configureMap,mountMapCanvas} from './sculpt-map.js';
import {mountEditorUI,groupToolControls,mountWorldControlIndex,worldGroup,mountColumnPanel} from './sculpt-ui.js';
import {controlRow} from './sculpt-workspace.js';
import {copyColumn} from './sculpt-column.js';
import {KNOBS,applyKnob,colorRows,pickWorldColor,strokeWaterPicks,slopeReplaced,worldPanelValues as worldPanelValuesOf} from './sculpt-knobs.js';
import {controlLabel,shapeControlAvailable,PARKED_WORLD_CONTROLS,WORLD_CHOICES,WORLD_GROUP_NAMES} from './sculpt-control-schema.js';
import {sectionPreview,FACING_CHOICES,LANDFORM_FORMS,landformTool,defaultForm,strokeKnots,thinKnots,knotCurve,leanRatio,leanSetup,landformReach,landformSides,landformBackSide,alongKnots,landformElevation,landformGround,landformDigs,landformSteps,impactPath} from './sculpt-shape-presets.js';
import {strokeKind,retiredStrokeNote,TOOL_PRESETS,MASK_KEYS,SHAPE_FIELDS,isCover,strokeParams,sceneNodes,addDefaults,DEFAULT_SEED,worldSetting as worldSettingIn,worldDefault as worldDefaultIn,shapeDefaults as shapeDefaultsIn,toolDefaults as toolDefaultsIn,strokeCard as strokeCardIn,groundDefaults as groundDefaultsIn,migrateRiver,
  shapeContext as shapeContextIn,timeKnobs,SURFACE_SLIDER_IDS,surfaceSliders,drawOptions,materialKnobs as materialKnobsIn,materialRequest,worldHexColors,rendererColors,TIME_SLIDER_IDS,surfaceGroupsHidden,weatheredCell,weatheredHeights,bilinearCells,FIELD_KEYS,regionalCheck,repeatCheck,pagedTime} from './sculpt-scene.js';
import {createGpuFields,createPagedFields,createShapeEngine,comparePlanes,readBuffer,setFailureHandler,LAYER_MEANDER,lfcWidth} from './sculpt-gpu-fields.js';

import {shapePaths,clonePaths,simplifyPath,validatePaths,appendPath,extendPoint,insertPoint,removePoint,removePath} from './sculpt-paths.js';
import {selectionTransform} from './sculpt-selection.js';
import {shareText,gzipText,shareUrl,mapIdFromSearch,withoutMap,mapsService,postMap,getMap,keepPrevious,takePrevious,dropPrevious} from './sculpt-share.js';
import {isRiver,pointsSignature,RIVER_MIN_WIDTH} from './sculpt-river.js';
const editorUI=mountEditorUI();
let syncWorldControls=()=>{},panelPicks='',syncToolGroups=()=>{},pathEditing=false,pathPoint=-1,pathIndex=0,pathAdding=false,drawMode='new';

// Offline authoring policy. These brushes are new geometry, not retail rules.
const $ = id => document.getElementById(id);
const canvas = $('terrain'), overlay = $('overlay');
const experiment = new URLSearchParams(location.search);
// DEVELOPMENT CONVENIENCE (owner request, revisit before release): one working map per browser, whatever the world, variant or map.
// It reloads on every page load and a world or variant switch carries its strokes into the new world (see carryNodes). Scratch pages keep none.
// Until the working map is first saved, a page opens the older per-world key of its own world, variant and map (legacyKey), so a map
// autosaved before this change is not lost; that key is only read.
const LOCAL_KEY = experiment.has('scratch')?null:'terraform-working-map-v1';
// The per-world key an autosave used before the working map: the world, its variant, the map's size and sea level, and a custom world.
const legacyKey=() => 'nanolathe-terrain-sculpt-v3'+(config.biomeId && config.biomeId!=='green'?'-'+config.biomeId:'')+(config.variant?'-v-'+config.variant:'')+
  (config.map?`-map-${config.map.unitsX}x${config.map.unitsY}-sea-${config.seaLevel}`:'')+(worldId!==config.biomeId?'-'+worldId:'');
let MIN_HEIGHT = -90, MAX_HEIGHT = 300;
const HELP = {
  // The shape buttons draw landforms: the path is the crest, the section across it is one curve shaped on both sides, the ground is raised, cut or flattened
  // to an elevation, and a second curve sets the crest's height along the path. Each button starts from its own preset; every setting stays editable.
  plateau:'Draw a landform that starts as a plateau: a level top at the elevation you set, with a natural foot. Change any setting below.',
  hill:'Draw a landform that starts as a rounded ridge: a short steep face and a long smooth back along the path. Change any setting below.',
  mountain:'Draw a landform that starts as a peaked ridge: a narrow crest with no flat summit. Change any setting below.',
  ramp:'Draw a landform that starts as a ramp: the ground is flattened to a grade that climbs from the plain at the start of the path to the elevation at its end (shape the climb in the along curve), and its center is kept smooth.',
  deep:'Draw a landform that starts as deep water: the ground is cut to 55 below sea level behind a smooth bank. Shore lobes, steps and plates are in their own groups.',
  shallow:'Draw a landform that starts as shallow water: the ground is flattened to 7 below sea level. Choose Raise to in Combine for a passage that leaves higher ground as it is.',
  valleyV:'Draw a landform that starts as a V valley: the ground is cut down to a floor on the path, and the walls rise at one slope, as a river leaves them. Choose any setting below; the Time pass settles walls steeper than the ground can stand.',
  valleyU:'Draw a landform that starts as a U valley: the ground is cut down to a flat floor with steep upper walls, as a glacier leaves it.',
  river:'Draw a river: a valley landform whose path is migrated by the curvature rule real rivers follow, so the line you draw grows bends that travel downstream, within Wander px of where you drew it (at most four channel widths); a loop drawn closed leaves an oxbow. Width is the channel (at least 32 px, so ships can use it). The bank is cut steep on the outside of each bend, a sand bar builds inside it, and pools and riffles follow the bends. Draw a long gentle line; Cut to sets the floodplain relative to the sea.',
  braided:'Draw a braided river: a wide, mostly dry bed of gravel bars just above the sea, which units cross, with thin threads of water that split and rejoin around the bars; grass grows back on the older, higher bars. Width sets the size of the bars and of the bed (the bed reaches about five widths either side of the line). Wander lets the whole bed stray from the line you draw, in px, as a river\'s channel does (0 keeps it as drawn).',
  valleyT:'Draw a landform that starts as a terraced valley: a V valley whose walls climb in flat treads, the levels a river left as it cut down.',
  smooth:'Blend the starting surface toward its local average. Repeat a new stroke for more smoothing.',
  crystal:'Draw a landform broken into crystal facets: a click grows a cluster round the point, a drag a row or ridge of them along the path. The section and along curves set how high they stand across and along it, and Facet shape picks prisms or stepped columns; their size, coverage, sides and tops are in Facets.',
  sand:'Paint sand cover: the ground under the brush becomes sand (on slopes too, so a hill set in sand has sandy feet). Heights do not change.',
  grass:'Paint ground cover: clears sand (painted or weathered) back to the world\'s own ground, such as grass. Heights do not change.',
  paint:'Paint a material over the ground, or a scatter density: rock showing through, snow or ice, wet (dark) ground and moss take the world\'s own materials; denser or sparser scatter multiplies the World panel\'s Boulders and Debris (at 0 nothing shows). Strength is how fully it paints, Softness the edge. Heights do not change.',
  fissure:'Cut a fissure along the stroke, or (Mode 1) a network of cuts over its footprint. Branches, jaggedness, width and depth are brush options; the world\'s own crack field is raised along the cut.',
  erase:'Paint plain ground: hills, water, craters, cracks, painted masks and style under the brush return to the dry base level, with a natural edge.',
  crater:'Strike a crater: a bowl dug into the ground where you click, a raised rim and secondaries. Drag to aim the impact: a short drag throws them downrange, a drag longer than the crater stretches it along the drag.',
  move:'Drag to move · Shift + drag for height · Shift snaps rotate / scale · P: path · V: transform · arrows: nudge · Shift F: focus canvas'
};
let mapUpdate=() => {},mapFeatures=null,mapMetadata=null,mapRevision=0;
const mapData=() => ({...mapFeatures?.serialize(),...mapMetadata?.serialize()});
function restoreMapData(data={}) { mapFeatures?.load(data||{}); mapMetadata?.load(data||{}); mapRevision++; }
function mapChanged() { mapRevision++; checkpoint(true); schedule(false); }
let config, renderer, grid, size, spacing, services;
// A world's configuration file, by the same relative path on a static host and on sculpt.py: config/<world>.json, or config/<world>--<variant>.json.
const configUrl=(world,variant)=>`config/${encodeURIComponent(world)}${variant?'--'+encodeURIComponent(variant):''}.json`;
let defaultColumn, columnOverride=null, columnEditing=false, syncColumnPanel=()=>{};
let pagedCoarseStarted=false, mapCanvas=null, regionalFields=null, originCellX=0, originCellY=0, worldSize=0, worldGrid=0, regionalWeather=null;
// Integer origins preserve the canonical multiplication order: (cell + origin)
// times spacing, rather than an accumulated floating-point world offset.
let gpuWeather=null, gpuErosionMs=null, weatherJob=0, weatherBase=null, refined=null, refinedBase=null, weatherState='pending';
let refinedInvalidRect=null;
let controlsEditing=false;
let tool='plateau', seed=DEFAULT_SEED, varySeed=true, refinementSeed=DEFAULT_SEED, stroke=null, pan=null, pointerId=null, loading=false;
const randomSeed=current=>{const next=(Math.random()*4294967296)>>>0;return next===current?(next+1)>>>0:next;};
let history=[], historyIndex=-1, historySerial=0;
let revision=0, autosaveTimer, ready=false;
const TOOL_NAMES={crater:'Crater',crystal:'Faceted forms',plateau:'Plateau',hill:'Rounded ridge',mountain:'Peaked ridge',ramp:'Ramp',deep:'Deep water',shallow:'Shallow water',valleyV:'V valley',valleyU:'U valley',valleyT:'Terraced valley',river:'River',braided:'Braided river'};
const TOOL_FIELDS={cracks:['cracks',0,100],diameter:['diameter',16,1200],amount:['amount',-80,160],roughness:['roughness',0,100],softness:['softness',0,100]};
for (const [key,id,,,lo,hi] of SHAPE_FIELDS) TOOL_FIELDS[key]=[id,lo,hi];
const worldSetting=key => worldSettingIn(config,experiment,key);
const worldDefault=key => worldDefaultIn(config,key);
const shapeDefaults=() => shapeDefaultsIn(config);
const nodeShapeParams=n => {const q={...shapeDefaults(),...n.params};return n.kind==='landform'?landformSteps(q):q;};
const shapeValue=key => { const f=SHAPE_FIELDS.find(f => f[0]===key); return Number($(f[1]).value)/f[7]; };
function buildShapeOptions() {
  // Each option row is built for its feature group (sculpt-ui.js groupToolControls). The section and along-path
  // editors are the page's own (#section-preview-control, in the curve dock).
  syncToolGroups=groupToolControls(SHAPE_FIELDS,([key,id,label,,lo,hi,step,,help,choices]) => {
    label=controlLabel(key,label);
    if(key==='fissureNetwork')choices=[[0,'Path cut'],[1,'Fracture network']];
    if(key==='plateMaterial')choices=[[1,'Polygonal slabs'],[2,'Needle band']];
    const wrap=controlRow({id,label:`${label} <output id="${id}-value"${choices?' hidden':''}></output>`,range:`min="${lo}" max="${hi}" step="${step}"`,choices,select:' style="width:100%"',help});
    wrap.id=id+'-control'; return wrap;
  });
  $('curve-form').addEventListener('change',() => { const f=$('curve-form').value; setCurve(f?{form:f}:null); if (selected>=0) { checkpoint(); queueWeather(); } });
  $('curve-reset').addEventListener('click',() => { const c=currentCurve(); setCurve(c?.form?{form:c.form}:null); if (selected>=0) { checkpoint(); queueWeather(); } });
  $('along-reset').addEventListener('click',() => { setCurve(null,'along'); if (selected>=0) { checkpoint(); queueWeather(); } });
  $('curve-link').addEventListener('click',() => { toggleLink(); if (selected>=0) { checkpoint(); queueWeather(); } });
  $('curve-mirror').addEventListener('click',() => { mirrorSides(); if (selected>=0) { checkpoint(); queueWeather(); } });
  curveEditorEvents(); alongEditorEvents();
  for (const id of ['section-preview','along-preview']) new ResizeObserver(() => { if (!$('section-preview-control').hidden) drawSection(); }).observe($(id));
  for (const [key,id] of SHAPE_FIELDS) $(id).addEventListener('input',() => {
    if(key==='heightReference'&&curveKind()==='landform'){
      const previous=nodes[selected]?.params||toolSettings[tool]||{},next=shapeValue('heightReference');
      const datum=r => Math.round(r||0)===1?config.seaLevel:Math.round(r||0)===2?config.baseHeight:0,height=shapeValue('elevation')+datum(previous.heightReference);   // a Ground offset converts as if over the plain
      heightControlRange({heightReference:next});$('lf-elevation').value=height-datum(next);
    }
    if(key==='stepReference')stepControlRange(curveKind(),{stepReference:shapeValue('stepReference')});
    rememberTool(true); updateControls(); schedule(); persistLater();
    // A reference switch changes the representation, not the other authored
    // values (which may be between the inspector sliders' ticks).
    if (selected>=0) editSelectedFromControls(key==='heightReference'?{...nodes[selected].params,heightReference:shapeValue('heightReference'),elevation:shapeValue('elevation')}:key==='stepReference'?{...nodes[selected].params,stepReference:shapeValue('stepReference'),terraces:shapeValue('terraces'),ledge:shapeValue('ledge')}:{});
  });
  // Releasing a shape option finalizes the edit like the ordinary sliders
  // below: snapshot it for Undo and restart the refinement the input handler
  // canceled. Without this the page stays "paused while editing" and Export
  // never re-enables (review A1, 2026-10-27).
  for (const [,id] of SHAPE_FIELDS) $(id).addEventListener('change',() => { if (selected>=0) { checkpoint(); queueWeather(); } });
}
let toolSettings={};
const clamp=(v,a,b) => Math.max(a,Math.min(b,v));
// Rounded authored knots preserve a long shoulder and a short exposed face.
// Zero slope at the crown avoids the knife edge of a skewed power-law dome.
setFailureHandler(err => error(err?.message??String(err)));
function error(message='') { $('error').textContent=message; $('error').hidden=!message; }
// A load's note about features or strokes it left out (sculpt-features.js, retiredStrokeNote) rides along with the load's own message, once.
let featureNotice='';
function status(message) { $('status').textContent=featureNotice&&message!==featureNotice?message+' '+featureNotice:message; if(message!==featureNotice)featureNotice=''; }
// Height slider range per shape kind; Raise / lower is signed.
const amountRange=kind => kind==='fissure'?[2,60]:['smooth','sand','grass','paint'].includes(kind)?[5,100]:[5,160];
function toolDefaults(entry,preset=config?.biomeId||'green') { return toolDefaultsIn(config,entry,preset); }
function rememberTool(custom=false) {
  const state={...toolSettings[tool]};
  for (const [key,[id]] of Object.entries(TOOL_FIELDS)) state[key]=Number($(id).value);
  if (custom) state.preset='custom';
  toolSettings[tool]=state;
}
function heightControlRange(p={}) {
  const ref=Math.round(p.heightReference||0),offset=ref===1?(config?.seaLevel||0):0;
  // A Ground offset digs or rises at most as far as a fixed elevation can from the plain.
  if(ref===2){$('lf-elevation').min='-160';$('lf-elevation').max='160';return;}
  $('lf-elevation').min=String(-80-offset);$('lf-elevation').max=String(300-offset);
}
function stepControlRange(kind,p={}) {
  const shore=kind==='landform'&&Number(p.stepReference)>0;
  $('sec-terraces').max=shore?'12':'8';$('sec-ledge').min=shore?'40':'0';$('sec-ledge').max=shore?'95':'90';
}
function showTool(state={},kind=strokeKind(tool)) {
  heightControlRange(state);stepControlRange(kind,state);
  [$('amount').min,$('amount').max]=amountRange(kind).map(String);
  for (const [key,[id,lo,hi]] of Object.entries(TOOL_FIELDS)) if (Number.isFinite(state[key])) $(id).value=clamp(state[key],lo,hi);
  $('tool-style').value=Object.hasOwn(TOOL_PRESETS,state.preset)?state.preset:'custom';
}
function updateControls() {
  const picks=JSON.stringify([strokeWaterPicks(nodes),slopeReplaced(panelFacts())]);if(picks!==panelPicks){panelPicks=picks;syncWorldControls();}   // a stroke's water choice, or the transition replacing the slope color, wakes or idles world rows
  const featureActive=Boolean(mapFeatures?.active);
  for (const b of document.querySelectorAll('[data-tool]')) b.setAttribute('aria-pressed',String(!featureActive&&b.dataset.tool===tool));
  $('feature-tool').setAttribute('aria-pressed',String(featureActive));
  $('feature-tool-host').hidden=!featureActive;
  $('brush-panel').hidden=featureActive||(tool==='move'&&!nodes[selected]?.params);
  $('selection-panel').hidden=featureActive||tool!=='move';$('drawing-options').hidden=featureActive;
  $('edit-path').setAttribute('aria-pressed',String(pathEditing));
  $('transform-mode').setAttribute('aria-pressed',String(!pathEditing&&drawMode!=='add'));
  $('selection-panel').classList.toggle('path-mode',pathEditing);
  const selectedNode=nodes[selected],hasSelection=Boolean(selectedNode?.points?.length),selectionActive=hasSelection&&tool==='move'&&!featureActive;
  // Generated features share the Select tool (sculpt-features.js): their values replace the shape's transform rows while any is selected.
  const featureSelection=!featureActive&&tool==='move'&&(mapFeatures?.selectionCount||0)>0;
  $('feature-selection').hidden=!featureSelection;$('selection-mode-buttons').hidden=$('shape-selection-actions').hidden=featureSelection;
  $('selection-empty').hidden=hasSelection||featureSelection;
  $('path-actions').hidden=!pathEditing||!hasSelection;
  $('transform-controls').hidden=pathEditing||!hasSelection||drawMode==='add';$('path-help').hidden=drawMode==='add'||featureSelection;
  $('selection-hud').hidden=!selectionActive;
  $('selection-hud').classList.toggle('path-mode',pathEditing);
  $('selection-mode').textContent=selectionActive?`${drawMode==='add'?'Add path':pathAdding?'Extend / branch':pathEditing?'Edit paths':'Transform'} · ${NODE_NAMES[selectedNode.kind]||selectedNode.kind} #${selected+1}`:'';
  $('canvas-path-mode').textContent=pathEditing?'Transform':'Edit paths';
  for(const id of ['selection-clear','selection-delete','transform-mode','canvas-path-mode','canvas-deselect'])$(id).disabled=!hasSelection||loading||Boolean(stroke||moving);
  for(const id of ['toggle-tools','toggle-inspector','focus-canvas'])$(id).disabled=loading||Boolean(stroke||moving);
  const transform=hasSelection?selectionTransform(selectedNode).values:null;
  for(const key of ['x','y','rotation','scale']){const input=$('selection-'+key);input.disabled=!hasSelection||loading||Boolean(stroke||moving);if(document.activeElement!==input)input.value=transform?String(Math.round(transform[key]*10)/10):'';}
  if(config?.map){$('selection-x').max=config.map.width-1;$('selection-y').max=config.map.height-1;}
  const paths=hasSelection?shapePaths(selectedNode):[],activePath=paths[pathIndex]||[],pointAt=activePath.indexOf(pathPoint),locked=loading||Boolean(stroke||moving);
  const editingSeed=selectedNode?.seed!==undefined;
  $('seed-label').textContent='Seed';
  if(document.activeElement!==$('seed'))$('seed').value=editingSeed?selectedNode.seed:seed;
  $('seed').disabled=$('seed-randomize').disabled=$('seed-vary').disabled=locked;
  $('seed-vary').checked=varySeed;$('seed-vary-control').hidden=false;
  $('seed-help').textContent=editingSeed?'Controls this shape’s outline and generated details. All its paths share this seed.':varySeed?'Used for the next shape, then a fresh seed is chosen.':'Reuses this seed for each new shape. Randomize chooses another variation.';
  $('draw-new').disabled=locked||!ready;
  $('simplify-strokes').disabled=locked;
  $('draw-add').disabled=locked||!hasSelection||selectedNode?.hidden;
  $('draw-new').setAttribute('aria-pressed',String(tool!=='move'&&drawMode!=='add'));
  $('draw-add').setAttribute('aria-pressed',String(drawMode==='add'));
  $('drawing-target').textContent=drawMode==='add'?`Draw into ${NODE_NAMES[selectedNode?.kind]||'shape'} #${selected+1}. Start on a point to attach a branch. Escape finishes.`:hasSelection?'Add a path to this shape, or start a new shape.':'Choose a brush, then draw a new shape.';
  $('edit-path').disabled=!hasSelection||locked;
  $('path-add').disabled=!pathEditing||pointAt<0||pointAt===activePath.length-1||locked;
  $('path-delete').disabled=!pathEditing||pathPoint<0||(selectedNode?.points?.length??0)<=1||locked;
  $('path-extend').disabled=!pathEditing||pathPoint<0||locked;
  $('path-extend').setAttribute('aria-pressed',String(pathAdding));
  $('path-remove').disabled=!pathEditing||paths.length<=1||locked;
  if(pathEditing){$('shape-path-list').replaceChildren(...paths.map((path,i)=>{const b=document.createElement('button');b.textContent=`Path ${i+1} · ${path.length} points`;b.setAttribute('aria-pressed',String(i===pathIndex));b.disabled=locked;b.onclick=()=>{pathIndex=i;pathPoint=-1;pathAdding=false;updateControls();schedule();};return b;}));}
  for(const id of ['rotate-left','rotate-right','scale-down','scale-up'])$(id).disabled=!nodes[selected]?.points;
  $('view-clay').setAttribute('aria-pressed',String($('clay').checked));
  $('view-rendered').setAttribute('aria-pressed',String(!$('clay').checked));
  for(const id of ['save','load','view-clay','view-rendered','blank'])$(id).disabled=!ready||loading||Boolean(stroke||moving);
  const pointCount=nodes[selected]?.points?.length||0;
  $('path-help').textContent=pathEditing?pathAdding?'Click to extend from the selected point. An interior point starts a branch. Escape finishes.':`${paths.length} path${paths.length===1?'':'s'} · ${pointCount} points${pathPoint>=0?' · point '+(pathPoint+1)+' selected':''}. Select a point to insert, extend, or branch.`:'Drag to move · labeled handles rotate / scale · Shift snaps handles · arrow keys nudge.';
  // With Select active, show the selected shape's own controls; a palette entry shows its stroke kind's (the shape buttons draw landforms).
  const activeTool=tool,entry=tool==='move'?(nodes[selected]?.params?nodes[selected].kind:'move'):tool,kind=strokeKind(entry);
  {
  heightControlRange({heightReference:shapeValue('heightReference')});stepControlRange(kind,{stepReference:shapeValue('stepReference')});
  $('lf-elevation-control').querySelector('label').firstChild.textContent=shapeValue('heightReference')===1?'Height above sea (units) ':shapeValue('heightReference')===2?'Height above ground (units) ':'Elevation (height units) ';
  const fixed=['erase','landform'].includes(kind);
  $('amount-control').hidden=fixed;
  $('amount-label').textContent=kind==='smooth' || isCover(kind)?'Strength':kind==='fissure'?'Depth':'Rise';
  const [lo,hi]=amountRange(kind); $('amount').min=String(lo); $('amount').max=String(hi);
  $('amount').value=String(clamp(Number($('amount').value),lo,hi));
  const amountNow=Number($('amount').value);
  $('amount-value').textContent=kind==='smooth' || isCover(kind)?amountNow+'%':'+'+amountNow;
  $('diameter-value').textContent=$('diameter').value+' units';
  $('roughness-value').textContent=$('roughness').value+'%';
  $('roughness-label').textContent=['erase','sand','grass','paint'].includes(kind)?'Edge freedom':'Roughness';
  // A fissure's outline is its own jaggedness; Roughness would do nothing.
  $('roughness').closest('.control').hidden=kind==='fissure'||kind==='landform';
  $('softness-control').hidden=!['erase','sand','grass','paint'].includes(kind);
  $('cracks-control').hidden=kind!=='landform';
  $('cracks-value').textContent=$('cracks').value+'%';
  // Spur and gully details show once their switch (spurs, gullies) is on.
  const gate={gullySize:'gullies',talus:'gullies',layerPx:'shoreLayers',layerRiser:'shoreLayers',layerLedge:'shoreLayers',layerRough:'shoreLayers',layerStyle:'shoreLayers',layerVary:'shoreLayers',layerCircle:'shoreLayers',iceFacetSize:'iceFacets',fingerSize:'fingers',spurLength:'spurCount',spurSpread:'spurCount',spurWidth:'spurCount',spurTaper:'spurCount',spurHeight:'spurCount',spurForks:'spurCount',spurBulb:'spurCount',fissureBranchLen:'fissureBranches',fissureBranchSpread:'fissureBranches',lavaSpread:'shoreLayers',lavaCircleVary:'shoreLayers'};
  if(kind==='landform')for(const key of Object.keys(gate))if(gate[key]==='shoreLayers')delete gate[key];
  // A fissure in network mode has no branches, taper or path jag to set; line mode has no block size.
  const net=kind==='fissure' && Number($('fissure-network').value)>=.5;
  const modeOff=key => kind==='fissure' && (net?['fissureBranches','fissureBranchLen','fissureBranchSpread','fissureTaper'].includes(key):key==='fissureCell');
  const frostOff=key => key==='frostNeedles' && Number($('plate-material').value)<2;
  const shapeOptions={...Object.fromEntries(SHAPE_FIELDS.map(([key])=>[key,shapeValue(key)])),curve:currentCurve(),world:renderer?worldPanelValues():{}};
  const gated=key => !shapeControlAvailable(key,kind,shapeOptions) || modeOff(key) || frostOff(key) || (gate[key] && !(Number($(SHAPE_FIELDS.find(f => f[0]===gate[key])[1]).value)>0));
  for (const [key,id,,kinds,,,,scale] of SHAPE_FIELDS) { $(id+'-control').hidden=!kinds.includes(kind) || gated(key) ; $(id+'-value').textContent=scale===1?$(id).value:scale===10?(Number($(id).value)/scale).toFixed(1):$(id).value+'%'; }
  // P28: on a river, Wander is how far in px the migration may carry the drawn line (its band), not an outline noise; once the path is edited by hand it cannot be migrated again.
  { const riv=kind==='landform'&&isRiver(shapeOptions),node=nodes[selected],stale=riv&&Boolean(node?.params)&&(node.params.river?.sig===undefined||node.params.river.sig!==pointsSignature(node.points)),why='The path was edited by hand, so it is not migrated again: draw a new river to change its bends.';
    $('lf-wander-control').querySelector('.small').textContent=stale?why:riv?'How far, in px, the river may stray from the line you drew, at most four channel widths: its bends grow by the river\'s own rule until they fill that band, and travel downstream. 0 keeps the line as drawn; a braided river\'s whole bed strays the same way. A loop drawn closed is cut off and left as an oxbow lake. A new seed gives other bends.':SHAPE_FIELDS.find(f => f[0]==='wander')[8];
    $('lf-wander').disabled=stale;$('lf-wander').title=stale?why:''; }
  $('section-preview-control').hidden=featureActive||kind!=='landform';
  if (!$('section-preview-control').hidden) drawSection();
  $('softness-value').textContent=$('softness').value+'%';
  $('relief-value').textContent=$('relief').value+'%';
  $('ring-value').textContent=$('mineral-ring').value+'%';
  $('ring-spread-value').textContent=$('ring-spread').value+'%';
  $('ring-variation-value').textContent=$('ring-variation').value+'%';
  $('material-weathering-value').textContent=$('material-weathering').value+'%';
  $('deposit-spread-value').textContent=$('deposit-spread').value+'%';
  $('transition-detail-value').textContent=$('transition-detail').value+'%';
  $('tool-style').value=toolSettings[entry==='landform'?landformTool(nodes[selected]?.params):entry]?.preset||'custom';
  $('tool-help').textContent=HELP[entry]||'';
  { const can=ready && resettable(); $('reset-strokes').disabled=!can; $('reset-strokes').title=can?'':'Draw a stroke first: there is nothing to reset.'; }
  $('undo').disabled=!ready || Boolean(stroke||moving) || historyIndex<=0;
  $('redo').disabled=!ready || Boolean(stroke||moving) || historyIndex>=history.length-1;
  $('export').disabled=!canExport(); mapUpdate();
  const view=mapCanvas?.view();$('fit').setAttribute('aria-pressed',String(view?view.overview:true));$('one').setAttribute('aria-pressed',String(view?!view.overview&&view.scale===1:false));
  }
  if (tool==='move') { $('tool-help').textContent=pathAdding?'Click to add an attached point · Escape finishes · shared junctions move together':drawMode==='add'?'Draw another path in the selected shape · start on a point to attach it · paths join without adding height':HELP.move; $('amount-control').hidden=selected<0 || ['erase','landform'].includes(nodes[selected]?.kind); }
  // Say what the brush controls change: the next stroke, or a selected shape.
  const editing=selected>=0 && nodes[selected]?.params;
  $('brush-panel').classList.toggle('editing',Boolean(editing));
  $('brush-title').textContent=editing?`Selected · ${NODE_NAMES[nodes[selected].kind]||nodes[selected].kind} #${selected+1}`:tool==='move'?'Select':`Brush · new ${TOOL_NAMES[tool]?`landform (${TOOL_NAMES[tool]})`:NODE_NAMES[tool]||tool}`;
  $('brush-scope').textContent=editing?'Shared settings for every path in this shape.':tool==='move'?'Click a shape to select and edit it.':'Settings for your new shape.';
  syncToolGroups(`${tool}:${selected}`);
  editorUI.syncTools?.(activeTool,editing?nodes[selected].kind:null,locked,featureActive);
  if(featureActive)$('tool-help').textContent=mapFeatures.hint||'Place features and starts · Space + drag to pan';
  else if(featureSelection)$('tool-help').textContent='Drag to move the selected features on the cell grid · Shift-click adds or removes · Delete removes · Escape deselects';
}

function canExport() {
  return ready && !loading && !stroke && !moving && !mapFeatures?.busy && (!$('weather').checked || weatherState==='ready');
}

const IDENTITY=[1,0,0,1,0,0];
const compose=(m,n) => [m[0]*n[0]+m[2]*n[1],m[1]*n[0]+m[3]*n[1],m[0]*n[2]+m[2]*n[3],m[1]*n[2]+m[3]*n[3],m[0]*n[4]+m[2]*n[5]+m[4],m[1]*n[4]+m[3]*n[5]+m[5]];
const applyFrame=(m,x,y) => ({x:m[0]*x+m[2]*y+m[4],y:m[1]*x+m[3]*y+m[5]});
const about=(pivot,m) => compose([1,0,0,1,pivot.x,pivot.y],compose(m,[1,0,0,1,-pivot.x,-pivot.y]));
const rotation=a => [Math.cos(a),Math.sin(a),-Math.sin(a),Math.cos(a),0,0];
const scaling=k => [k,0,0,k,0,0];
const isIdentity=m => !m || m.every((v,i) => Math.abs(v-IDENTITY[i])<1e-9);
// The section editor (H15 part 2, step C; H27). The curve a stroke carries is {form, knots?, back?}: the form alone follows softness, knots (once one is dragged)
// are what saves, and a landform's back is a list of its own once its sides are unlinked. The canvas draws the real tables (sculpt-shape-presets.js sectionPreview)
// across both sides, the lean side (the back) on the left, before the outline noise. A landform's axis is in height units, the plain, the sea and the elevation marked.
const CV_LO=-.6,CV_HI=1.6,CV_PAD=9;
const curveKind=() => selected>=0 && nodes[selected]?.params ? nodes[selected].kind : strokeKind(tool);
const currentCurve=() => (selected>=0 && nodes[selected]?.params ? nodes[selected].params.curve : toolSettings[tool]?.curve) || null;
const currentAlong=() => (selected>=0 && nodes[selected]?.params ? nodes[selected].params.along : toolSettings[tool]?.along) || null;
function curveContext() {
  const kind=curveKind(),o=Object.fromEntries(SHAPE_FIELDS.map(([key]) => [key,shapeValue(key)]));
  return {kind,land:kind==='landform',q:{...(kind==='landform'?landformSteps(o):o),radius:Number($('diameter').value)/2,softness:Number($('softness').value)/100,curve:currentCurve(),along:currentAlong()}};
}
// Hand the curve (or, with key 'along', the along-the-path knots) to the shape being edited, or to the brush for the next stroke; null goes back to the default.
function setCurve(curve,key='curve') {
  if (selected>=0 && nodes[selected]?.params) {
    const n=nodes[selected],p={...n.params}; if (curve) p[key]=curve; else delete p[key]; n.params=p;
    updateControls(); editSelectedFromControls(); persistLater(); return;
  }
  const t={...toolSettings[tool],preset:'custom'}; if (curve) t[key]=curve; else delete t[key]; toolSettings[tool]=t;
  updateControls(); schedule(); persistLater();
}
const roundKnots=ks => ks.map(([x,v]) => [Math.round(x*1000)/1000,Math.round(v*1000)/1000]);
// The knots on each side: the front's own (or its form's, thinned when the form samples a power law or a smoothstep finely); a landform's back is its own list
// once unlinked, and the front's until then.
const frontKnots=c => { const k=strokeKnots(c.kind,c.q).knots; return c.q.curve?.knots||k.length<=12?k:thinKnots(k); };
const backKnots=c => c.land&&c.q.curve?.back?c.q.curve.back:null;
const sidesLinked=c => c.land&&!c.q.curve?.back;
function storeSection(c,front,back) {
  const curve={form:c.q.curve?.form||defaultForm(c.kind),knots:roundKnots(front)}; if (back) curve.back=roundKnots(back);
  setCurve(curve);
}
function toggleLink() { const c=curveContext(); if (!c.land) return; const f=frontKnots(c); sidesLinked(c)?storeSection(c,f,f.map(k => [...k])):storeSection(c,f); }
// Mirror flips the section left to right: the two lists swap and the lean turns round.
function mirrorSides() { const c=curveContext(),b=backKnots(c); if (!c.land || !b) return; storeSection(c,b,frontKnots(c)); setLean(1/leanRatio(c.kind,c.q)); }
function setLean(ratio) { const el=$('lean'); el.value=String(clamp(Math.round(ratio*20)*5,25,400)); el.dispatchEvent(new Event('input',{bubbles:true})); }
// The height axis of a landform's canvases: the plain, the sea and the elevation, with room for an along curve up to 1.2.
function heightAxis(c) {
  const ground=landformGround(c.q),plain=ground?0:config.baseHeight,sea=ground?null:config.seaLevel,E=landformElevation(c.q,config.seaLevel),span=Math.abs(E-plain)<1?(E<plain?-1:1):E-plain,top=plain+span*1.2;
  // A signed section (lfcrater) reaches past the ground, away from the elevation: room for its lowest knot.
  const lip=plain+span*Math.min(0,...frontKnots(c).map(k => k[1]),...(backKnots(c)||[]).map(k => k[1]));
  let lo=Math.min(sea??plain,plain,E,top,lip),hi=Math.max(sea??plain,plain,E,top,lip); const pad=Math.max(5,(hi-lo)*.1); lo-=pad; hi+=pad;
  return {plain,sea,E,span,lo,hi,ground};
}
function sectionLayout(c) {
  const cv=$('section-preview'),W=cv.width,H=cv.height,ratio=leanRatio(c.kind,c.q),xL=CV_PAD,xR=W-CV_PAD,xc=xL+(xR-xL)*ratio/(1+ratio),top=CV_PAD+2,bottom=H-CV_PAD-2,L={W,H,ratio,xL,xR,xc,top,bottom,land:c.land};
  if (c.land) {
    const a=heightAxis(c); Object.assign(L,a,{yH:h => bottom-(bottom-top)*(h-a.lo)/(a.hi-a.lo),hY:y => a.lo+(a.hi-a.lo)*(bottom-y)/(bottom-top)});
    L.yv=v => L.yH(a.plain+a.span*v); L.vy=y => (L.hY(y)-a.plain)/a.span;
  } else { L.yv=v => bottom-(bottom-top)*(v-CV_LO)/(CV_HI-CV_LO); L.vy=y => CV_LO+(CV_HI-CV_LO)*(bottom-y)/(bottom-top); }
  return L;
}
const sideX=(L,side,x) => side==='back'?L.xc-(L.xc-L.xL)*(1-x):L.xc+(L.xR-L.xc)*(1-x);
// Every handle: the front's knots on the right, and for a landform the back's on the left (a linked back shows the front's knots, which move together).
function sectionHandles(c,L) {
  const out=[],fk=frontKnots(c),bk=backKnots(c);
  fk.forEach(([x,v],i) => out.push({side:'front',i,x,v,X:sideX(L,'front',x),Y:L.yv(v)}));
  if (c.land) (bk||fk).forEach(([x,v],i) => out.push({side:'back',i,x,v,X:sideX(L,'back',x),Y:L.yv(v),edit:bk?'back':'front'}));
  return out;
}
// A landform's path as the engine sweeps it (the simplified polyline of its first path), its back side and half widths, so the editor reads the map where the shape stands.
function landformPath(n) {
  const q=nodeShapeParams(n),paths=shapePaths(n),pts=paths[0].map(i => n.points[i]);
  let path=impactPath(q,simplifyPath(pts,Math.max(1,q.radius*.04)).filter((p,k,a) => !k || Math.hypot(p.x-a[k-1].x,p.y-a[k-1].y)>=1e-4));   // an impact's track (lfcrater)
  if (path.length<2) path=[path[0],{x:path[0].x+.01,y:path[0].y}];
  const cum=[0]; for (let k=1;k<path.length;k++) cum.push(cum[k-1]+Math.hypot(path[k].x-path[k-1].x,path[k].y-path[k-1].y));
  const turn=isIdentity(n.frame)?0:Math.atan2(n.frame[1],n.frame[0]),sd=landformSides(q);
  return {path,cum,total:cum[cum.length-1],side:landformBackSide(leanSetup('landform',q),turn,path[1].x-path[0].x,path[1].y-path[0].y),front:sd.front,back:sd.back,q};
}
// The point at share t of the way along, and the unit vector from it toward the back.
function landformAt(lp,t) {
  const d=clamp(t,0,1)*lp.total; let k=1; while (k<lp.path.length-1 && lp.cum[k]<d) k++;
  const a=lp.path[k-1],b=lp.path[k],len=lp.cum[k]-lp.cum[k-1]||1,f=clamp((d-lp.cum[k-1])/len,0,1),ux=(b.x-a.x)/len,uy=(b.y-a.y)/len;
  return {x:a.x+(b.x-a.x)*f,y:a.y+(b.y-a.y)*f,bx:lp.side*uy,by:-lp.side*ux};
}
// The map's own heights (the CPU copy of the authored field) across the shape at share t: from the back's foot (-back) to the front's (+front).
const landformCut=(lp,t,n=33) => { const p=landformAt(lp,t),out=[]; for (let j=0;j<n;j++) { const a=-lp.back+(lp.back+lp.front)*j/(n-1); out.push([a,regionalFields.sample(p.x-p.bx*a,p.y-p.by*a)]); } return out; };
let lfPlace=.5;
const selectedLandform=() => selected>=0 && nodes[selected]?.kind==='landform' && nodes[selected].points?.length ? nodes[selected] : null;
function sectionMark() {
  const n=tool==='move'?selectedLandform():null; if (!n || !regionalFields) return null;
  const lp=landformPath(n),p=landformAt(lp,lfPlace); return {a:{x:p.x+p.bx*lp.back,y:p.y+p.by*lp.back},b:{x:p.x-p.bx*lp.front,y:p.y-p.by*lp.front}};
}
// Match the dock's actual dimensions so curve text and handles stay sharp.
function fitCanvas(cv) { const w=Math.round(cv.clientWidth),h=Math.round(cv.clientHeight); if (w>=120 && (cv.width!==w||cv.height!==h)) { cv.width=w; cv.height=h; } }
function drawSection() {
  fitCanvas($('section-preview')); fitCanvas($('along-preview'));
  const cv=$('section-preview'),g=cv.getContext('2d'),c=curveContext(),L=sectionLayout(c),{ys,back}=sectionPreview(c.kind,c.q),n=ys.length-1;
  g.clearRect(0,0,L.W,L.H); g.font='9px system-ui';
  const rule=(y,color,label) => { g.strokeStyle=color; g.setLineDash([3,3]); g.beginPath(); g.moveTo(L.xL,y); g.lineTo(L.xR,y); g.stroke(); g.setLineDash([]); if (label) { g.fillStyle=color; g.textAlign='left'; g.fillText(label,L.xL+2,y-2); } };
  if (c.land && L.ground) { rule(L.yH(0),'#8b9b87','ground'); rule(L.yH(L.E),'#e8f2d8',`elevation ${L.E>0?'+':''}${L.E}`); }
  else if (c.land) { rule(L.yH(L.sea),'#6aa7c4',`sea ${L.sea}`); rule(L.yH(L.plain),'#8b9b87',`plain ${L.plain}`); rule(L.yH(L.E),'#e8f2d8',`elevation ${L.E}`); }
  else { rule(L.yv(0),'#465344'); rule(L.yv(1),'#465344'); }
  const base=L.yv(0),trace=() => { for (let k=0;k<=n;k++) g.lineTo(L.xL+(L.xc-L.xL)*k/n,L.yv(back[k])); for (let k=n;k>=0;k--) g.lineTo(L.xc+(L.xR-L.xc)*(n-k)/n,L.yv(ys[k])); };
  g.beginPath(); g.moveTo(L.xL,base); trace(); g.lineTo(L.xR,base); g.closePath(); g.fillStyle='rgba(180,213,137,.25)'; g.fill();
  g.beginPath(); g.moveTo(L.xL,L.yv(back[0])); trace(); g.strokeStyle='#b4d589'; g.lineWidth=1.5; g.stroke(); g.lineWidth=1;
  // The map's own sections across the selected landform, at five places along it and at the place picked below, in height units.
  const node=c.land&&!L.ground?selectedLandform():null;
  if (node && regionalFields) {
    const lp=landformPath(node),px=a => L.xc+a*(a<0?L.xc-L.xL:L.xR-L.xc)/(a<0?lp.back:lp.front),line=(t,color,w) => { g.beginPath(); landformCut(lp,t).forEach(([a,h],j) => g[j?'lineTo':'moveTo'](px(a),L.yH(h))); g.strokeStyle=color; g.lineWidth=w; g.stroke(); };
    for (const t of [.1,.3,.5,.7,.9]) line(t,'rgba(160,200,255,.38)',1);
    line(lfPlace,'#ffd27a',2); g.lineWidth=1;
  }
  const fk=frontKnots(c),edited=Boolean(c.q.curve?.knots);
  g.fillStyle=edited?'#e8f2d8':'rgba(232,242,216,.45)';
  for (const h of sectionHandles(c,L)) { g.fillStyle=edited?(h.side==='back'&&!h.edit?'rgba(232,242,216,.55)':'#e8f2d8'):'rgba(232,242,216,.45)'; g.beginPath(); g.arc(h.X,h.Y,3.5,0,7); g.fill(); }
  // The crest's lean handle: a diamond on the crest line at the foot's height.
  g.fillStyle='#ffd27a'; g.beginPath(); g.moveTo(L.xc,base-5); g.lineTo(L.xc+5,base); g.lineTo(L.xc,base+5); g.lineTo(L.xc-5,base); g.closePath(); g.fill();
  g.strokeStyle='rgba(255,210,122,.35)'; g.setLineDash([2,3]); g.beginPath(); g.moveTo(L.xc,L.top); g.lineTo(L.xc,L.bottom); g.stroke(); g.setLineDash([]);
  g.fillStyle='#a8b7a5'; g.textAlign='left'; g.fillText('lean side',L.xL+2,L.H-2); g.textAlign='right'; g.fillText('steep side',L.xR-2,L.H-2); g.textAlign='left';
  // The controls round the canvas.
  const form=$('curve-form'),choices=LANDFORM_FORMS; if (form.dataset.kind!==c.kind) { form.replaceChildren(new Option('The shape\'s own',''),...choices.map(([id,label]) => new Option(label,id))); form.dataset.kind=c.kind; }
  form.value=choices.some(([id]) => id===c.q.curve?.form)?c.q.curve.form:''; $('curve-reset').disabled=!c.q.curve?.knots;
  $('curve-link').hidden=$('curve-mirror').hidden=!c.land; $('curve-link').setAttribute('aria-pressed',String(sidesLinked(c))); $('curve-link').textContent=sidesLinked(c)?'Sides linked':'Link sides'; $('curve-mirror').disabled=sidesLinked(c);
  $('along-block').hidden=!c.land;
  const facing=Math.round(c.q.facing||0),toward=FACING_CHOICES.find(f => f[0]===(facing||3))[1];
  $('curve-lean').textContent=`Lean ${(Math.round(L.ratio*100)/100).toFixed(2)} : 1 toward ${toward.toLowerCase()}`;
  if (c.land) drawAlong(c);
}
// The second curve: the crest's height along the path, as a share of the elevation above the plain (0 to 1.2), against the share of the way along. The dashed
// line is what was authored; the solid line is read from the map along the path.
const ALONG_HI=1.2;
function alongLayout(c) {
  const cv=$('along-preview'),W=cv.width,H=cv.height,a=heightAxis(c),xL=CV_PAD,xR=W-CV_PAD,top=CV_PAD,bottom=H-CV_PAD,yH=h => bottom-(bottom-top)*(h-a.lo)/(a.hi-a.lo);
  return {...a,W,H,xL,xR,top,bottom,yH,hY:y => a.lo+(a.hi-a.lo)*(bottom-y)/(bottom-top),X:t => xL+(xR-xL)*t,T:x => clamp((x-xL)/(xR-xL),0,1),yv:v => yH(a.plain+a.span*v),vy:y => (a.lo+(a.hi-a.lo)*(bottom-y)/(bottom-top)-a.plain)/a.span};
}
function drawAlong(c) {
  const cv=$('along-preview'),g=cv.getContext('2d'),L=alongLayout(c),knots=alongKnots(c.q),f=knotCurve(knots);
  g.clearRect(0,0,L.W,L.H); g.font='9px system-ui';
  const rule=(y,color,label) => { g.strokeStyle=color; g.setLineDash([3,3]); g.beginPath(); g.moveTo(L.xL,y); g.lineTo(L.xR,y); g.stroke(); g.setLineDash([]); g.fillStyle=color; g.textAlign='left'; g.fillText(label,L.xL+2,y-2); };
  if (L.ground) { rule(L.yH(0),'#8b9b87','ground'); rule(L.yH(L.E),'#e8f2d8',`elevation ${L.E>0?'+':''}${L.E}`); }
  else { rule(L.yH(L.sea),'#6aa7c4',`sea ${L.sea}`); rule(L.yH(L.plain),'#8b9b87',`plain ${L.plain}`); rule(L.yH(L.E),'#e8f2d8',`elevation ${L.E}`); }
  const node=L.ground?null:selectedLandform(),N=48;
  if (node && regionalFields) {
    // The crest wanders, so the line takes the extreme toward the elevation (the highest for a ridge, the lowest for a cut below the plain) near the path.
    const lp=landformPath(node),reach=Math.max(0,c.q.wander||0)*1.2+4,dir=L.E<L.plain?-1:1;
    g.beginPath(); for (let k=0;k<=N;k++) { const t=k/N,p=landformAt(lp,t); let h=-1e9; for (let j=-2;j<=2;j++) h=Math.max(h,dir*regionalFields.sample(p.x+p.bx*reach*j/2,p.y+p.by*reach*j/2)); g[k?'lineTo':'moveTo'](L.X(t),L.yH(dir*h)); }
    g.strokeStyle='#b4d589'; g.lineWidth=1.5; g.stroke(); g.lineWidth=1;
    g.strokeStyle='#ffd27a'; g.beginPath(); g.moveTo(L.X(lfPlace),L.top); g.lineTo(L.X(lfPlace),L.bottom); g.stroke();
  }
  g.setLineDash([5,3]); g.beginPath(); for (let k=0;k<=N;k++) g[k?'lineTo':'moveTo'](L.X(k/N),L.yv(clamp(f(k/N),0,ALONG_HI))); g.strokeStyle='#e8f2d8'; g.stroke(); g.setLineDash([]);
  g.fillStyle=c.q.along?'#e8f2d8':'rgba(232,242,216,.45)'; for (const [x,v] of knots) { g.beginPath(); g.arc(L.X(x),L.yv(v),3.5,0,7); g.fill(); }
}
function curveEditorEvents() {
  const cv=$('section-preview'); let drag=null;
  const at=e => { const r=cv.getBoundingClientRect(); return {px:(e.clientX-r.left)*cv.width/r.width,py:(e.clientY-r.top)*cv.height/r.height}; };
  const hit=(c,L,p) => { let best=null,d=8; for (const h of sectionHandles(c,L)) { const dd=Math.hypot(h.X-p.px,h.Y-p.py); if (dd<d) { d=dd; best=h; } } return best; };
  const distShare=(L,side,px) => clamp(1-Math.abs(px-L.xc)/(side==='back'?L.xc-L.xL:L.xR-L.xc),0,1);
  const vOf=(c,L,py) => clamp(L.vy(py),c.land?-1:0,1.5);   // a landform's knot may dip below 0: a signed section (lfcrater)
  const finish=() => { if (drag) { drag=null; if (selected>=0) { checkpoint(); queueWeather(); } } };
  const remove=(c,h) => { const list=(h.edit==='back'?backKnots(c):frontKnots(c)).map(k => [...k]); if (h.i>0 && h.i<list.length-1 && list.length>2) { list.splice(h.i,1); h.edit==='back'?storeSection(c,frontKnots(c),list):storeSection(c,list,backKnots(c)); return true; } return false; };
  cv.addEventListener('contextmenu',e => e.preventDefault());
  cv.addEventListener('pointerdown',e => {
    if (e.button===2) return;
    const p=at(e),c=curveContext(),L=sectionLayout(c);
    if (Math.hypot(L.xc-p.px,L.yv(0)-p.py)<9) { drag={lean:true}; cv.setPointerCapture(e.pointerId); return; }
    const h=hit(c,L,p);
    if (h && e.shiftKey) { if (remove(c,{...h,edit:h.edit||'front'}) && selected>=0) { checkpoint(); queueWeather(); } return; }
    if (h) drag={side:h.side,edit:h.edit||'front',i:h.i};
    else {
      const side=p.px<L.xc?'back':'front',edit=side==='back'&&!sidesLinked(c)&&c.land?'back':'front',x=clamp(distShare(L,side,p.px),.01,.99);
      const list=(edit==='back'?backKnots(c):frontKnots(c)).map(k => [...k]); let j=list.findIndex(k => k[0]>x); if (j<0) j=list.length-1;
      list.splice(j,0,[x,vOf(c,L,p.py)]); drag={side,edit,i:j}; edit==='back'?storeSection(c,frontKnots(c),list):storeSection(c,list,backKnots(c));
    }
    cv.setPointerCapture(e.pointerId);
  });
  cv.addEventListener('pointermove',e => {
    if (!drag) return;
    const p=at(e),c=curveContext(),L=sectionLayout(c);
    if (drag.lean) { const f=clamp((p.px-L.xL)/(L.xR-L.xL),.1,.9); setLean(f/(1-f)); return; }
    const list=(drag.edit==='back'?backKnots(c):frontKnots(c)).map(k => [...k]),k=list[drag.i]; if (!k) return;
    if (drag.i>0 && drag.i<list.length-1) k[0]=clamp(distShare(L,drag.side,p.px),list[drag.i-1][0]+.01,list[drag.i+1][0]-.01);
    k[1]=vOf(c,L,p.py); drag.edit==='back'?storeSection(c,frontKnots(c),list):storeSection(c,list,backKnots(c));
  });
  cv.addEventListener('pointerup',finish); cv.addEventListener('pointercancel',finish);
  cv.addEventListener('dblclick',e => { const c=curveContext(),h=hit(c,sectionLayout(c),at(e)); if (h && remove(c,{...h,edit:h.edit||'front'}) && selected>=0) { checkpoint(); queueWeather(); } });
}
// Drag a knot to edit height. Click or drag elsewhere to inspect the section
// along the path; double-click adds a knot and Shift-click removes one.
function alongEditorEvents() {
  const cv=$('along-preview'); let pointer=null,drag=-1,moved=false;
  const at=e => { const r=cv.getBoundingClientRect(); return {px:(e.clientX-r.left)*cv.width/r.width,py:(e.clientY-r.top)*cv.height/r.height}; };
  const hit=(c,L,knots,p) => { let best=-1,d=8; knots.forEach(([x,v],i) => { const dd=Math.hypot(L.X(x)-p.px,L.yv(v)-p.py); if (dd<d) { d=dd; best=i; } }); return best; };
  const store=ks => setCurve(roundKnots(ks),'along');
  const inspect=(L,p) => { lfPlace=L.T(p.px); drawSection(); schedule(); };
  const finish=e => { if(pointer!==e.pointerId)return;const edited=drag>=0&&moved;pointer=null;drag=-1;if(cv.hasPointerCapture(e.pointerId))cv.releasePointerCapture(e.pointerId);if(edited&&selected>=0){checkpoint();queueWeather();} };
  cv.addEventListener('pointerdown',e => {
    if (e.button!==0||pointer!==null) return;
    const p=at(e),c=curveContext(),L=alongLayout(c),knots=alongKnots(c.q).map(k => [...k]),i=hit(c,L,knots,p); moved=false;
    if (i>=0 && e.shiftKey) { if (i>0 && i<knots.length-1 && knots.length>2) { knots.splice(i,1); store(knots); if (selected>=0) { checkpoint(); queueWeather(); } } return; }
    pointer=e.pointerId;drag=i;cv.setPointerCapture(e.pointerId);
    if(i<0)inspect(L,p);
  });
  cv.addEventListener('pointermove',e => {
    if(pointer!==e.pointerId)return;
    const p=at(e),c=curveContext(),L=alongLayout(c);
    if(drag<0){inspect(L,p);return;}
    const knots=alongKnots(c.q).map(k => [...k]),k=knots[drag]; if (!k) return;
    if (drag>0 && drag<knots.length-1) k[0]=clamp(L.T(p.px),knots[drag-1][0]+.01,knots[drag+1][0]-.01);
    k[1]=clamp(L.vy(p.py),0,ALONG_HI); moved=true; store(knots);
  });
  cv.addEventListener('pointerup',finish); cv.addEventListener('pointercancel',finish);cv.addEventListener('lostpointercapture',finish);
  cv.addEventListener('dblclick',e => {
    const p=at(e),c=curveContext(),L=alongLayout(c),knots=alongKnots(c.q).map(k => [...k]),i=hit(c,L,knots,p);
    if (i>=0) { if (i>0 && i<knots.length-1 && knots.length>2) { knots.splice(i,1); store(knots); } }
    else { const x=clamp(L.T(p.px),.01,.99); let j=knots.findIndex(k => k[0]>x); if (j<0) j=knots.length-1; knots.splice(j,0,[x,clamp(L.vy(p.py),0,ALONG_HI)]); store(knots); }
    if (selected>=0) { checkpoint(); queueWeather(); }
  });
}
// Line features (card C4). A ridge (a hill or mountain with spurs or crest
// options) is swept as short pieces, each with width and height multipliers at
// its two ends that the brush dab reads as the piece, so the crest swells, narrows and
// tapers along its path and every spur is simply more pieces on the same
// stroke: the nearest influence wins, so a spur meets its parent at the crest
// with no seam and no detached lump. Spur geometry comes from the stroke seed
// and the path alone, never from the heights, and each cell reads only its own
// position and the pieces, so region replay stays exact.
const hasCoastPass=(kind,p) => kind==='landform' && ((p?.fingers??worldDefault('fingers'))>0 || Math.round(p?.shoreLayers??worldDefault('shoreLayers'))>=1);
// The lowest layer stands LAYER_FOOT units above the lava (retail's first shelf is
// 6-10 above it) and is reached over LAYER_WALL px: a ledge nearer the water than
// ~3 units dips under the sea in the shader's relief, and a 1-cell wall is a
// black line. Both are the engine's own constants, not controls.
const coastLayerReach=s => {
  const n=Math.max(1,Math.round(s.shoreLayers)),W=Math.max(4,s.layerPx),style=Math.round(s.layerStyle);
  if (style===2) return 1.6*n*W+2*W;
  if (style===1) { const cv=clamp(s.lavaCircleVary||0,0,1); return n*W*(1+.45*cv)+2.8*Math.max(8,s.layerCircle)*(1+.07*cv)+2*W; }
  // G5: the meander moves a layer line by up to LAYER_MEANDER layer widths, and the spread widens the widest layer;
  // both reach farther inland than the shore-following layers do.
  const spread=clamp(s.lavaSpread||0,0,2),wide=Math.max(1+.6*clamp(s.layerVary,0,1),Math.exp(.5*(clamp(s.layerVary,0,1)+spread)));
  return (n+1+LAYER_MEANDER)*W*wide+2*W;
};
// Circular layers (retail lava-2): round bites cut out of the bank, layer after layer. A bite is a disc
// centered within a radius of the waterline, one per jittered lattice cell in the shape's own frame (so a
// moved lake carries its circles along); a layer is counted from the nearest bite's edge, or the
// waterline if that is nearer, so each riser is an arc round its bite, concentric with the bite's other
// risers, meeting a neighbor's arcs at a cusp (the overlap of two discs).
function markViewChanged(invalidate=true) { revision++; $('export').disabled=true; if (mapCanvas && invalidate) mapCanvas.invalidate(); }
function markChanged() { markViewChanged(false); error(); }

// Shapes are nodes: kind, path, parameters and seed. The map is rebuilt by
// replaying nodes in order, so relative heights follow the ground beneath
// (a hill on a plateau rises with it). prefix[i] keeps the surface before
// node i, so an edit replays only from the edited node onward.
let nodes=[], selected=-1, moving=null, pendingEval=-1, pendingRect=null;
const NODE_NAMES={landform:'Landform',sand:'Sand cover',paint:'Surface paint',grass:'Ground cover',erase:'Reset ground',ground:'Ground undulation',fissure:'Fissure',smooth:'Smooth',raster:'Imported surface',compact:'Height scale',flowbake:'Flow bake'};
// The Facet shape a landform draws: its own, or angular facets where it digs (prepareNode).
const facetShape=q => landformDigs(q)?0:clamp(Math.round(q.facetForm||0),0,2);
function addNode(n) {
  nodes.push(n); regionalFields.changed(nodeBounds(n));
}
function nodeBounds(n) {
  // World-space reach of a shape, from the same extents its brush uses.
  if (!n.points) return {x0:0,y0:0,x1:grid-1,y1:grid-1};
  const q=nodeShapeParams(n),radius=q.radius||40,rough=q.rough??.35;
  const reach={erase:Math.min(1.7,1+rough*1.3)+1.9*rough,sand:Math.min(1.7,1+rough*1.3)+1.9*rough,grass:Math.min(1.7,1+rough*1.3)+1.9*rough,paint:Math.min(1.7,1+rough*1.3)+1.9*rough}[n.kind] ?? 1+.4*rough;
  let r=radius*reach+12*spacing;
  // A landform reaches its widest side grown by the width variation, the wander and the spurs (the same reach its segment boxes use).
  if(n.kind==='landform'){
    r=landformReach({...q,radius},n.frame?Math.hypot(n.frame[0],n.frame[1]):1)+12*spacing;
    // Match the shared coast pass's expanded box as well as the swept profile's reach.
    if(q.fingers>0||q.shoreLayers>=1||q.shorePlates>0)r+=Math.max(q.fingers>0?.5*radius+3*spacing:0,q.shoreLayers>=1?coastLayerReach(q):0,q.shorePlates>0?Math.max(q.plateWaterPx||0,q.plateLandPx||0)+2*spacing:0)+12*spacing;
    // Prisms stand past the footprint by up to their own width.
    if(q.iceFacets>0&&facetShape(q)===2)r+=lfcWidth(q)*(n.frame?Math.hypot(n.frame[0],n.frame[1]):1)+2*spacing;
  }
  let ax=Infinity,ay=Infinity,bx=-Infinity,by=-Infinity;
  for (const p of n.points) { ax=Math.min(ax,p.x); ay=Math.min(ay,p.y); bx=Math.max(bx,p.x); by=Math.max(by,p.y); }
  // A fissure reaches its branches (and their forks) and, in network mode, its footprint.
  if (n.kind==='fissure') { const k=n.frame?Math.hypot(n.frame[0],n.frame[1]):1; r=(q.fissureNetwork>=.5?radius*1.1:0)+(Math.round(q.fissureBranches)>=1?(q.fissureBranchLen||0)*2.4*k:0)+(q.fissureWidth||5)*3*k+24+12*spacing; }
  // Spurs (card C4) reach up to one and a half spur lengths past the ridge, plus their own width.
  // A spur's root flares to about 1.7 times Spur width.
  if (Math.round(q.spurCount)>=1 && n.kind==='landform') { const k=n.frame?Math.hypot(n.frame[0],n.frame[1]):1; r+=(q.spurLength||0)*(q.spurForks>0?2.1:1.6)*k+radius*Math.max(1,((q.spurWidth||.8)+(q.spurBulb||0)*.7)*1.7); }
  return {x0:clamp(Math.floor((ax-r)/spacing-originCellX),0,grid-1),y0:clamp(Math.floor((ay-r)/spacing-originCellY),0,grid-1),x1:clamp(Math.ceil((bx+r)/spacing-originCellX),0,grid-1),y1:clamp(Math.ceil((by+r)/spacing-originCellY),0,grid-1)};
}
const unionRect=(a,b) => !a?b:!b?a:{x0:Math.min(a.x0,b.x0),y0:Math.min(a.y0,b.y0),x1:Math.max(a.x1,b.x1),y1:Math.max(a.y1,b.y1)};
const overlaps=(a,b) => a.x0<=b.x1 && b.x0<=a.x1 && a.y0<=b.y1 && b.y0<=a.y1;
function evaluate(from=0,rect=null) {
  regionalFields.changed(regionalDirtyRect(from,rect)); markChanged();
}

function regionalReadApron(n) {
  if (!n.points) return 0;
  const q=nodeShapeParams(n);
  let cells=n.kind==='smooth'?clamp(Math.round(q.radius/(spacing*7)),1,24):0;
  // A framed finger cache is keyed on authoring cells; include every world
  // cell that can share that key. Radial thumbs can share a coastal key from
  // both sides of the radial band, so their first-call order needs that band.
  if (n.kind==='landform' && q.fingers>0) {
    if (n.frame) cells+=Math.ceil(2*Math.max(Math.hypot(n.frame[0],n.frame[1]),Math.hypot(n.frame[2],n.frame[3])))+2;
  }
  if (hasCoastPass(n.kind,q)) {
    // Signed-distance normals read ten neighbors and a derivative. A new
    // tongue can reach another tongue before reaching its original shore,
    // so keep the connection band as well as the visible finger reach.
    if (q.fingers>0) cells+=Math.ceil(3*(.5*q.radius+spacing*3)/spacing)+32;
    if (Math.round(q.shoreLayers)>=1) cells+=Math.ceil(coastLayerReach(q)/spacing)+2;
  }
  if(Math.round(q.layerStyle)===1&&Math.round(q.shoreLayers)>=1&&n.kind==='landform'){
    const Rc=Math.max(8,q.layerCircle),N=Math.max(1,Math.round(q.shoreLayers)),W=Math.max(4,q.layerPx),cv=clamp(q.lavaCircleVary||0,0,1),B=Math.ceil((1.4*Rc+cv*.1*Rc+N*W*(1+.45*cv))/spacing);
    cells+=Math.max(0,2*B+1+Math.ceil(1.12*Rc/spacing)+2-(Math.ceil(coastLayerReach(q)/spacing)+2));
  }
  // G6: a facet plane is fitted at its center, up to half a facet away and three cells either side of it, in the stroke's frame.
  // Stepped columns read the envelope at seeds up to about two widths away (a prism evaluates the section at its seed and reads only its own cell). A landform that digs takes angular facets.
  if(n.kind==='landform'&&q.iceFacets>0&&facetShape(q)!==2){const f=n.frame??IDENTITY,lfc=facetShape(q)===1,L=lfc?lfcWidth(q):clamp(q.iceFacetSize,16,640);cells+=Math.ceil((lfc?2.3:1.95)*L*Math.max(Math.abs(f[0])+Math.abs(f[2]),Math.abs(f[1])+Math.abs(f[3]))/spacing+.5)+(lfc?6:4);}
  if (n.kind==='landform' && q.shorePlates>0) cells+=Math.ceil(Math.max(q.plateWaterPx,q.plateLandPx)/spacing)+2;
  return cells;
}
// A shape that reads cells round its footprint (a smooth, a coast or facet pass) changes where the edit reaches into what it reads.
// This is dirty-output metadata only: it never enlarges a field read window.
function regionalDirtyRect(from,rect) {
  if (!rect) return null;
  let dirty={...rect};
  for (let i=Math.max(0,from+1);i<nodes.length;i++) {
    const n=nodes[i]; if (n.hidden || !n.points?.length) continue;
    const b=nodeBounds(n),pad=regionalReadApron(n),reach={x0:Math.max(0,dirty.x0-pad),y0:Math.max(0,dirty.y0-pad),x1:Math.min(worldGrid-1,dirty.x1+pad),y1:Math.min(worldGrid-1,dirty.y1+pad)};
    if (pad && overlaps(reach,b)) dirty=unionRect(dirty,{x0:Math.max(reach.x0,b.x0),y0:Math.max(reach.y0,b.y0),x1:Math.min(reach.x1,b.x1),y1:Math.min(reach.y1,b.y1)});
  }
  return dirty;
}
// Shape runs on the GPU: the compute passes of engine-shape.wgsl (sculpt-gpu-fields.js) draw every brush; a node they do not draw draws nothing.
const shapeKnob=(key) => renderer?.variantNumber?.(key,worldSetting(key))??worldSetting(key);
const shapeContext=() => shapeContextIn({config,settings:experiment,seed,talusAngle:renderer?.variantNumber?.('talusAngle',40)??40,minH:MIN_HEIGHT,maxH:MAX_HEIGHT});
// H5b: a map over 1168 samples a side runs its fields and Time pass in pages. gpuPages=force pages a smaller map too: a test hook for comparing pages with the whole map, not a switch (both are the GPU).
const gpuPagesForced=() => new URLSearchParams(location.search).get('gpuPages')==='force';
const pagedWanted=() => worldGrid>1168 || gpuPagesForced();
const pagedOn=() => Boolean(regionalFields?.paged && regionalFields.active());
// H12: the paged fields fit their ring and page caps to the terrain GPU budget the canvas holds (gpuMB, or its field), less the canvas's minimum.
const gpuBudget=() => ({total:(Number(document.querySelector('[data-gpu]')?.value)||Number(new URLSearchParams(location.search).get('gpuMB'))||512)*1048576,minimum:mapCanvas?.minimumBytes?.()??96*1048576});
function makeRegionalFields() {
  const common={worldSize,worldGrid,baseHeight:config.baseHeight,keys:FIELD_KEYS,maskKeys:MASK_KEYS,nodes:() => nodes,device:() => renderer?.device,context:shapeContext,gesture:() => Boolean(stroke||moving||controlsEditing)};
  // pageRing (a ring by hand) and timeApron are test hooks of the page ring rule and the Time pass's window; no page needs them.
  const query=new URLSearchParams(location.search);
  return pagedWanted()?createPagedFields({...common,budget:gpuBudget,foregroundPending:()=>mapCanvas?.foregroundPending?.()??false,apron:Number(query.get('timeApron')||128),forceRing:Number(query.get('pageRing')||0)}):createGpuFields(common);
}
// Every application receives a bounded prefix window. Temporary global views
// let the existing brush routines keep their row strides; no node retains a
// field snapshot or world-sized noise array in map mode.
function currentStrokeOptions() {
  applySeedControl();
  return {radius:Number($('diameter').value)/2,amount:Number($('amount').value),rough:Number($('roughness').value)/100,softness:Number($('softness').value)/100,cracks:Number($('cracks').value)/100,seed,...Object.fromEntries(SHAPE_FIELDS.map(([key]) => [key,shapeValue(key)])),...(toolSettings[tool]?.curve?{curve:toolSettings[tool].curve}:{}),...(toolSettings[tool]?.along?{along:toolSettings[tool].along}:{})};
}
function regionalPoints(points) {
  if (!Array.isArray(points) || !points.length || points.some(p => !Number.isFinite(p.x) || !Number.isFinite(p.y))) throw new Error('Invalid terrain stroke.');
  return points.map(p => ({x:clamp(p.x,0,(config.map?.width??size)-1),y:clamp(p.y,0,(config.map?.height??size)-1)}));
}
function beginRegionalStroke(kind,point,options={},attachment=-1,target=-1,advanceSeed=false) {
  if(stroke||moving||!(kind==='landform'||HELP[kind]&&strokeKind(kind)===kind)||kind==='move')throw new Error('A terrain gesture is already active or the brush is invalid.');
  const points=regionalPoints([point]),adding=target>=0&&nodes[target]?.points;
  const selectionBefore=selected,index=adding?target:nodes.length;
  const original=adding?cloneNodes([nodes[index]])[0]:null;
  const params=adding?{...original.params}:{...currentStrokeOptions(),...options};
  const node=adding?cloneNodes([original])[0]:{kind,points,params,seed:params.seed??seed};
  delete params.seed;cancelWeather();
  let path=0;
  if(adding){path=appendPath(node,attachment>=0?[]:points,attachment);nodes[index]=node;}
  else nodes.push(node);
  const basePoints=adding?node.points.length-(attachment>=0?0:1):0;
  stroke={regional:true,kind:node.kind,node,index,selectionBefore,original,pathIndex:path,attachment,basePoints,advanceSeed:advanceSeed&&!adding};
  selected=adding?index:-1;
  evaluate(index,nodeBounds(node));renderLayers();updateControls();schedule();return index;
}
function previewRegionalStroke(points) {
  if(!stroke?.regional)return false;
  const node=stroke.node,before=nodeBounds(node),next=regionalPoints(points);
  if(stroke.original){
    node.points=node.points.slice(0,stroke.basePoints);
    const path=stroke.attachment>=0?[stroke.attachment]:[];
    for(const p of next.slice(stroke.attachment>=0?1:0)){path.push(node.points.length);node.points.push(p);}
    node.paths[stroke.pathIndex]=path;
  }else node.points=next;
  evaluate(stroke.index,unionRect(before,nodeBounds(node)));schedule();return stroke.index;
}
const migrateRiverNode=node => migrateRiver(config,node);
function endRegionalStroke(commit=true,simplify=false) {
  if(!stroke?.regional)return false;
  if(commit&&simplify){
    // Simplify only the path just drawn, before its single undo checkpoint.
    // Three terrain pixels gives the same fidelity at every canvas zoom.
    // Reusing preview preserves shared branch roots and invalidates both bounds.
    const points=shapePaths(stroke.node)[stroke.pathIndex].map(i=>stroke.node.points[i]),reduced=simplifyPath(points,3);
    if(reduced.length<points.length)previewRegionalStroke(reduced);
  }
  // P28: a river's drawn line is migrated once, as the stroke ends; the migrated path (and any oxbows) is what the node stores from then on.
  if(commit&&!stroke.original&&isRiver(stroke.node.params)){
    const node=stroke.node,before=nodeBounds(node);
    node.params={...node.params,river:{drawn:node.points.map(p=>({x:p.x,y:p.y}))}};
    migrateRiverNode(node);evaluate(stroke.index,unionRect(before,nodeBounds(node)));
  }
  const gesture=stroke,rect=nodeBounds(gesture.node);stroke=null;
  const emptyBranch=gesture.original&&gesture.attachment>=0&&gesture.node.paths[gesture.pathIndex].length===1;
  if(!commit||emptyBranch){
    if(gesture.original)nodes[gesture.index]=gesture.original;else nodes.splice(gesture.index,1);
    selected=gesture.selectionBefore;evaluate(gesture.index,unionRect(rect,gesture.original?nodeBounds(gesture.original):null));
  }else{selected=gesture.index;pathPoint=-1;pathIndex=gesture.original?gesture.pathIndex:0;if(!gesture.original)pathEditing=false;if(gesture.advanceSeed)seed=randomSeed(gesture.node.seed);checkpoint();}
  if(selected>=0)selectNode(selected);
  if(commit&&!emptyBranch&&gesture.original){drawMode='add';pathIndex=gesture.pathIndex;}
  renderLayers();updateControls();schedule();queueWeather();return commit?gesture.index:false;
}
function applyRegionalStroke(kind,points,options={}) {
  const path=regionalPoints(points),index=beginRegionalStroke(kind,path[0],options);
  if (path.length>1) previewRegionalStroke(path);
  endRegionalStroke(true); return index;
}
function beginRegionalMove(index=selected) {
  if (stroke || moving || !nodes[index]?.points) return false;
  cancelWeather(); selectNode(index);
  const original=cloneNodes([nodes[index]])[0];
  moving={regional:true,index,original,state:nodeState(original),selectionBefore:selected,changed:false};
  updateControls(); return index;
}
// Transforms and parameter edits are relative to the gesture's first node,
// regardless of pointer cadence. A release is one undoable history entry.
function previewRegionalMove(edit) {
  if (!moving?.regional) return false;
  const gesture=moving,before=nodeBounds(nodes[gesture.index]),node=cloneNodes([gesture.original])[0];
  if (typeof edit==='function') edit(node,gesture.state);
  else {
    const q=Array.isArray(edit)?{matrix:edit}:edit||{},matrix=q.matrix??[1,0,0,1,q.dx??0,q.dy??0];
    if (!Array.isArray(matrix) || matrix.length!==6 || matrix.some(v => !Number.isFinite(v)) || Math.abs(matrix[0]*matrix[3]-matrix[1]*matrix[2])<1e-8) throw new Error('Invalid terrain transform.');
    transformNode(node,gesture.state,matrix);
    if(q.point&&Number.isInteger(q.point.index)&&node.points[q.point.index])node.points[q.point.index]={x:clamp(q.point.x,0,config.map.width-1),y:clamp(q.point.y,0,config.map.height-1)};
    if (q.params) node.params={...node.params,...q.params};
    if (Number.isFinite(q.amount)) node.params={...node.params,amount:q.amount};
  }
  nodes[gesture.index]=node; gesture.changed=true;
  evaluate(gesture.index,unionRect(before,nodeBounds(node))); schedule(); return gesture.index;
}
function endRegionalMove(commit=true) {
  if (!moving?.regional) return false;
  const gesture=moving,rect=nodeBounds(nodes[gesture.index]); moving=null;
  if (!commit) { nodes[gesture.index]=gesture.original; evaluate(gesture.index,unionRect(rect,nodeBounds(gesture.original))); }
  else if (gesture.changed) checkpoint();
  selectNode(gesture.index); updateControls(); schedule(); queueWeather(); return commit?gesture.index:false;
}
const surfaceValues=() => Object.fromEntries(SURFACE_SLIDER_IDS.map(id => [id,Number($(id).value)]));
function currentDrawOptions() { return drawOptions(surfaceValues(),{clay:$('clay').checked,light:$('light').value}); }
function regionalHeightCell(x,y) {
  const h=regionalFields.cell(x,y);
  if (!refined || !refinedBase || !$('weather').checked || !refinementValid(refinedInvalidRect,x,y)) return h;
  return weatheredCell(h,regionalFields.cell(x,y,'r'),y*worldGrid+x,refined,refinedBase);
}
function sampleRegional(x,y) {
  if (pagedOn()) return regionalFields.sampleEroded(x,y);
  if (gpuWeather && !gpuWeather.cpuHeight && !stroke && !moving && $('weather').checked) gpuWeatherCpu(false).catch(() => {});   // H6b: the first CPU reader asks for the Time pass's height
  if (!refined || !refinedBase || !$('weather').checked) return regionalFields.sample(x,y);
  return bilinearCells(x,y,spacing,worldGrid,regionalHeightCell);
}
// H6b: the map canvas fed from the GPU fields (Green's engine, maps up to 1168 samples a side). The Time pass reads the
// fields' buffers and leaves its result in two GPU buffers (gpuWeather: weather = authored then eroded height, maps = the three packed layers); a chunk
// bake reads the fields and those buffers in place (sculpt-chunk-renderer.js feedFromGpu). The CPU arrays (refined, refinedBase, regionalWeather) are
// read back only when a CPU reader asks: sampleRegional (picking, features), readRegional (export heights, the CPU bake path).
// Erosion 0 (a world that runs no Time pass) is Weathering off.
const weatherOn=() => $('weather').checked && renderer.variantNumber?.('erosion',0)>0;
const feedWeatherOk=() => Boolean(gpuFeedEligible() && (grid<=1168 || pagedOn()) && renderer.variantNumber?.('erosion',0)>0);
const gpuFeedEligible=() => Boolean(regionalFields?.gpuBuffers && (worldGrid<=1168 || regionalFields.paged) && regionalFields.active?.());
// A bake takes a lease on the Time pass's buffers when it asks for the feed and gives it back once its feed pass is submitted (work already submitted
// keeps its buffers), so a retired result is destroyed at that moment and not on a timer. gpuBytes() is what the canvas counts against its budget.
const retiredWeather=new Set(); let gpuPassBytes=0;
function destroyGpuWeather(w) { if (w.destroyed) return; w.destroyed=true; retiredWeather.delete(w); w.weather.destroy(); w.maps.forEach(m => m.destroy()); w.field?.destroy(); }
function leaseGpuWeather(w) { w.leases=(w.leases||0)+1; let given=false; return () => { if (given) return; given=true; w.leases--; if (w.retired && w.leases<=0) destroyGpuWeather(w); }; }
function retireGpuWeather(w) { w.retired=true; if (w.leases>0) retiredWeather.add(w); else destroyGpuWeather(w); }
// What the Time pass holds only while it runs: its own working memory and the results it is replacing. It takes no budget check of its own, so a bake that overlaps it is not asked to make room for it.
let drainageTransient=0;   // P21: the plane's working buffers while it is computed (a lattice cell: 48 bytes), and the stored plane (8 bytes a cell) is counted below
const gpuTransientBytes=() => [...retiredWeather].reduce((n,w) => n+w.bytes,0)+gpuPassBytes+drainageTransient;
const gpuBytes=() => (regionalFields?.stats?.().gpuShape?.gpuBytes||0)+(gpuWeather?.bytes||0)+(drainage?.destroyed===false?drainage.bytes:0)+gpuTransientBytes();
function dropGpuWeather() { if (gpuWeather) { retireGpuWeather(gpuWeather); gpuWeather=null; } }
async function gpuWeatherCpu(withMaps) {
  const w=gpuWeather; if (!w) return;
  const need=() => !w.cpuHeight || (withMaps && w.mapsOn && !w.cpuMaps), n=w.grid*w.grid;
  while (need() && gpuWeather===w) {
    if (w.loading) { await w.loading; continue; }
    w.loading=(async () => {
      if (gpuWeather!==w || w.destroyed) return;
      if (!w.cpuHeight) { const raw=await readBuffer(renderer.device,w.weather,0,n*8); if (gpuWeather===w) { refinedBase=new Float32Array(raw,0,n); refined=new Float32Array(raw,n*4,n); refinedInvalidRect=w.invalidRect??null; w.cpuHeight=true; } }
      else if (w.mapsOn && !w.cpuMaps) {
        const [a,b,c]=await Promise.all(w.maps.map(m => readBuffer(renderer.device,m,0,n*4)));
        if (gpuWeather===w && w.mapsOn) { regionalWeather={p0:new Uint8Array(a),p1:new Uint8Array(b),p2:new Uint8Array(c)}; w.cpuMaps=true; }
      }
    })().finally(() => { w.loading=null; });
    await w.loading;
    if (!withMaps && w.cpuHeight) break;
  }
}
// What the canvas bakes from, or null for the CPU read: the fields' buffers once their CPU copy holds the latest evaluation, and the Time pass's buffers when
// Weathering is on and a GPU pass produced them. Weather that came from a CPU pass keeps the CPU read, so the picture stays exactly the CPU path's.
// H5b: the Time pass in pages: the knobs the pass reads (all of them in the key, so a change drops every page's weather), and the runner a page's window goes through.
function configurePagedTime(fields=regionalFields) {
  if (!weatherOn()) return fields.setTime(null);
  return fields.setTime(pagedTime({config,renderer,size,spacing,material:materialKnobs(),drainage:drainagePlane}));
}
// P21: the drainage plane. One exact drainage area for the whole map on a 16-px lattice (sculpt-drainage.js), computed in the Time stage from the authored
// height once an edit settles, stored on the GPU, and handed to the Time pass (engine-weather.wgsl drainageAt). It is out of date from the moment the fields
// change until the plane for the new revision is computed; the Memory budgets panel says so.
let drainage=null, drainageBusy=false;
const fieldsRevision=() => regionalFields?.stats?.().revision??0;
const drainagePlane=() => drainage&&!drainage.destroyed?drainage:null;
function showDrainage() {
  const el=document.querySelector('[data-drainage]'); if (!el) return;
  const d=drainage;
  el.textContent=!d?(weatherOn()?'Drainage plane: not computed yet.':'Drainage plane: computed with Weathering on.')
    :d.revision!==fieldsRevision()?'Drainage plane: out of date; recomputed after the edit settles.'
    :`Drainage plane: ${d.width} × ${d.width} cells of 16 px, ${(d.bytes/1048576).toFixed(1)} MiB, ${Math.round(d.milliseconds)} ms.`;
}
async function drainageSource() {
  if (regionalFields.paged) {
    if (!pagedCoarseStarted) { pagedCoarseStarted=true; regionalFields.startCoarse().catch(() => {}); }
    await regionalFields.coarseSettled();
    const c=regionalFields.coarseLattice(); return c&&{revision:c.revision,input:{heights:c.heights,width:c.width}};
  }
  await regionalFields.gpuReady(); if (regionalFields.gpuPending()) return null;
  const b=regionalFields.gpuBuffers(); return b&&{revision:fieldsRevision(),input:{planes:b.planes,grid:b.grid}};
}
async function queueDrainage() {
  if (drainageBusy) return;
  if (!weatherOn()||!regionalFields?.active?.()||stroke||moving||(drainage&&drainage.revision===fieldsRevision())) { showDrainage(); return; }
  drainageBusy=true;
  try {
    const {computeDrainage}=await import('./sculpt-drainage.js');
    for (let tries=0;tries<8&&!stroke&&!moving&&!(drainage&&drainage.revision===fieldsRevision());tries++) {
      const source=await drainageSource(); if (!source) continue;
      const cells=(source.input.width??Math.floor((source.input.grid-1)/8)+1)**2; drainageTransient=cells*48;
      let plane; try { plane=await computeDrainage(renderer.device,{...source.input,sea:config.seaLevel}); } finally { drainageTransient=0; }
      plane.revision=source.revision; const old=drainage; drainage=plane; old?.retire(); showDrainage();
    }
  } catch (err) { console.error(err); }
  finally { drainageBusy=false; showDrainage(); }
}
function queuePagedWeather() {
  if (stroke||moving) return;
  const changedTime=configurePagedTime(),stale=regionalFields.settle(),on=$('weather').checked;
  weatherState=on?'ready':'disabled'; $('weather-state').textContent=on?'Weathered edges · GPU time pass in pages, on demand':'Weathering off · authored surface';
  weatherJob++;
  if (changedTime) { markViewChanged(); }
  else if (stale && on) { const pad=160*spacing; markViewChanged(false); mapCanvas?.invalidate({x:Math.max(0,stale.x-pad),y:Math.max(0,stale.y-pad),width:stale.width+2*pad,height:stale.height+2*pad}); }
  updateControls(); schedule();
}
async function gpuFeedSource(signal,regionFn,{weather=true}={}) {
  if (!gpuFeedEligible()) return null;
  if (regionalFields.paged) {
    configurePagedTime();
    const region=regionFn(),sp=region.gridSpacing,ox=Math.round(region.gridOrigin[0]/sp),oy=Math.round(region.gridOrigin[1]/sp);
    if (!pagedCoarseStarted) { pagedCoarseStarted=true; regionalFields.startCoarse().catch(() => {}); }
    const feed=await regionalFields.feedSource({x0:ox,y0:oy,x1:ox+region.gridWidth-1,y1:oy+region.gridHeight-1},weather&&$('weather').checked,{signal});
    if (signal?.aborted) { feed.release(); signal.throwIfAborted(); }
    return feed;
  }
  await regionalFields.gpuReady(); signal?.throwIfAborted();
  const buffers=regionalFields.gpuBuffers(); if (!buffers) return null;
  const on=weather&&$('weather').checked;
  if (on && refined && !gpuWeather) return null;
  const w=on?gpuWeather:null;
  return {...buffers,maskCount:MASK_KEYS.length,weather:w?.weather??null,maps:w?.mapsOn?w.maps:null,field:w?.mapsOn?w.field??null:null,get invalidRect(){return w?.invalidRect;},release:w?leaseGpuWeather(w):() => {}};
}
function readRegional(request) {
  if (pagedOn()) return regionalFields.readAsync(request);
  if (regionalFields.pending?.()) return regionalFields.ready().then(() => readRegional(request));
  if (gpuWeather && $('weather').checked && !(gpuWeather.cpuHeight && (gpuWeather.cpuMaps || !gpuWeather.mapsOn))) return gpuWeatherCpu(true).then(() => readRegional(request));   // H6b: a CPU reader of the Time pass
  const r=regionalFields.read(request);
  if (!refined || !refinedBase || !$('weather').checked) return r;
  const fields={...r.fields,h:weatheredHeights(r,{refined,refinedBase,grid:worldGrid,spacing,valid:(x,y) => refinementValid(refinedInvalidRect,x,y)})},ox=Math.round(r.gridOrigin[0]/spacing),oy=Math.round(r.gridOrigin[1]/spacing),weather={};
  const crop=(source,channels=1) => {
    if (!source) return undefined;
    const out=new source.constructor(r.gridWidth*r.gridHeight*channels);
    for (let y=0;y<r.gridHeight;y++) { const from=((y+oy)*worldGrid+ox)*channels; out.set(source.subarray(from,from+r.gridWidth*channels),y*r.gridWidth*channels); }
    return out;
  };
  ['flow','deposit','talus','sand','wear','wet','hard','slope','fx','fy','channel','ridge'].forEach((key,k) => {
    const packed=regionalWeather?.['p'+(k>>2)];
    if (!packed) { weather[key]=crop(regionalWeather?.[key]); return; }
    const out=new Float32Array(r.gridWidth*r.gridHeight);
    for (let y=0;y<r.gridHeight;y++) { const from=((y+oy)*worldGrid+ox)*4+(k&3); for (let x=0;x<r.gridWidth;x++) out[y*r.gridWidth+x]=packed[from+x*4]/255; }
    weather[key]=out;
  });
  const materialField=crop(regionalWeather?.materialField,4),extra=[fields.h,...Object.values(weather),materialField].reduce((sum,a) => sum+(a?.byteLength??0),0);
  if(refinedInvalidRect)for(let y=0;y<r.gridHeight;y++)for(let x=0;x<r.gridWidth;x++)if(!refinementValid(refinedInvalidRect,x+ox,y+oy)){
    const i=y*r.gridWidth+x;for(const a of Object.values(weather))if(a)a[i]=0;if(materialField)materialField.fill(0,i*4,i*4+4);
  }
  return {...r,fields,weather,materialField,bytes:r.bytes+extra};
}
function setMapBusy(on) {
  loading=on; $('editor').disabled=on; $('world-editor').disabled=on;
  for (const id of ['weather','clay','light','feature-tool']) $(id).disabled=on;
  for(const input of document.querySelectorAll('#rendering-host input'))input.disabled=on;
  renderLayers();updateControls();
  overlay.style.pointerEvents=on?'none':''; const panel=$('map-features-controls'); if (panel) panel.disabled=on;
}
function uniformAuthored({x=0,y=0,width=0,height=width,apron=0}={}) {
  if (![x,y,width,height,apron].every(Number.isFinite) || width<0 || height<0 || apron<0) return null;
  const rect={x0:clamp(Math.floor((x-apron)/spacing),0,worldGrid-1),y0:clamp(Math.floor((y-apron)/spacing),0,worldGrid-1),x1:clamp(Math.ceil((x+width+apron)/spacing),0,worldGrid-1),y1:clamp(Math.ceil((y+height+apron)/spacing),0,worldGrid-1)};
  let h=Math.fround(config.baseHeight);
  if (!Number.isFinite(h) || h<MIN_HEIGHT || h>MAX_HEIGHT) return null;
  for (const n of nodes) if (!n.hidden) {
    if (n.points?.length) { if (overlaps(nodeBounds(n),rect)) return null; continue; }
    if (n.kind==='ground') { if ((n.amplitude??8)!==0 || !Number.isFinite(n.wavelength??160) || (n.wavelength??160)<1 || !Number.isFinite(n.coverage??.5)) return null; }
    else if (n.kind==='compact') { if (h>config.baseHeight) h=Math.fround(config.baseHeight+(h-config.baseHeight)*n.factor); }
    else return null;
  }
  return Number.isFinite(h)?{h,p:0,r:0}:null;
}
function regionalStats() {
  const stats=regionalFields.stats(),arrays=new Set([weatherBase,refined,refinedBase,...Object.values(regionalWeather||{})].filter(a => ArrayBuffer.isView(a)));
  const weatherBytes=Array.from(arrays).reduce((sum,a) => sum+a.byteLength,0);
  return {...stats,residentBytes:stats.residentBytes+weatherBytes,weatherBytes,peakBytes:stats.peakBytes+weatherBytes};
}
const sculptRegion={
  previewScene:()=>({size:worldSize,spacing,baseHeight:config.baseHeight,sea:config.seaLevel,minH:MIN_HEIGHT,maxH:MAX_HEIGHT,nodes,context:shapeContext(),maskCount:MASK_KEYS.length,revision:regionalFields.stats().revision,fail:error}),
  fitGpuBudget:() => regionalFields?.refit?.(),
  setViewFocus:v=>regionalFields?.setFocus?.({x:(v.x+v.width/2)/spacing,y:(v.y+v.height/2)/spacing}),
  read:readRegional,gpuFeedSource,readAuthored:request => pagedOn()?regionalFields.readAsync(request,{weather:false}):regionalFields.pending?.()?regionalFields.ready().then(() => regionalFields.read(request)):regionalFields.read(request),uniformAuthored,sample:sampleRegional,sampleAuthored:(x,y,key) => regionalFields.sample(x,y,key),cell:(x,y,key) => regionalFields.cell(x,y,key),graph:() => serializeNodes(),serializeGraph:() => serializeNodes(),nodeMetadata:i => { const n=nodes[i]; return n?{kind:n.kind,hidden:n.hidden,params:n.params?{...n.params}:undefined,points:n.points?.map(p=>({...p})),paths:clonePaths(n),frame:n.frame?.slice()}:undefined; },
  loadGraph:list => { if (!Array.isArray(list) || list.some(n => n.kind==='raster')) throw new Error('A regional map requires a stroke graph.'); const next=deserializeNodes(list); cancelWeather(); nodes=next; selected=-1;pathIndex=0;pathPoint=-1;pathAdding=false;drawMode=tool==='move'?'select':'new'; evaluate(0); renderLayers(); checkpoint(); queueWeather(); },
  sketch,loadSketch:s=>loadSketchFile(s,false),maskKeys:MASK_KEYS,stats:regionalStats,revision:() => revision+mapRevision+weatherJob,
  bounds:n => { const b=nodeBounds(typeof n==='number'?nodes[n]:n); return {x:b.x0*spacing,y:b.y0*spacing,width:(b.x1-b.x0)*spacing,height:(b.y1-b.y0)*spacing}; },
  residentBuffers:()=>[...(regionalFields.buffers?.()||[]),...[nodes,...history.map(h=>h.nodes)].flatMap(list=>list.flatMap(n=>n.result?.planes?.map(a=>a.buffer)??[])),...new Set([weatherBase,refined,refinedBase,...Object.values(regionalWeather||{})].filter(ArrayBuffer.isView).map(a=>a.buffer))],subscribe:fn => regionalFields.subscribe(fn),subscribeSubmit:fn => regionalFields.subscribeSubmit?.(fn),gpuBytes,gpuTransientBytes,gpuFeedActive:() => gpuFeedEligible(),currentTool:() => tool,strokeOptions:currentStrokeOptions,applyStroke:applyRegionalStroke,
  beginStroke:(kind,p,options,attachment=-1)=>beginRegionalStroke(kind,p,options,attachment,drawMode==='add'?selected:-1,varySeed),previewStroke:previewRegionalStroke,endStroke:(commit=true)=>endRegionalStroke(commit,$('simplify-strokes').checked),beginMove:beginRegionalMove,previewMove:previewRegionalMove,endMove:endRegionalMove,gestureActive:() => Boolean(stroke||moving),previewActive:() => Boolean(stroke||moving||controlsEditing),
  sectionMark,pathEditing:()=>pathEditing,pathSelection:()=>pathPoint,pathIndex:()=>pathIndex,pathAdding:()=>pathAdding,
  drawMode:()=>drawMode,drawingKind:()=>drawMode==='add'?nodes[selected]?.kind:strokeKind(tool),
  selectPathPoint:i=>{pathPoint=i;if(i>=0&&!shapePaths(nodes[selected])[pathIndex]?.includes(i))pathIndex=shapePaths(nodes[selected]).findIndex(path=>path.includes(i));updateControls();},
  addPathPoint:p=>{if(pathAdding&&pathPoint>=0)changeSelected(n=>{const added=extendPoint(n,pathPoint,regionalPoints([p])[0],pathIndex);pathPoint=added.point;pathIndex=added.path;});pathAdding=true;updateControls();},
  select:selectNode,selectAt:p => { const i=pickNode(p); selectNode(i); return i; },selection:() => selected,pickAt:pickNode,selectionLabel:i=>`${NODE_NAMES[nodes[i]?.kind]||nodes[i]?.kind} #${i+1}`,
  editNode:(i,edit) => { selectNode(i); changeSelected(edit); },moveNode:(i,dx,dy) => { selectNode(i); changeSelected(n => transformNode(n,nodeState(n),[1,0,0,1,dx,dy])); },
  drawOptions:currentDrawOptions,mapData,restoreMapData,mapChanged,checkpoint,ready:() => ready&&!loading,canExport,
  setBusy:setMapBusy,registerFeatures:handle => { mapFeatures=handle; },registerMetadata:handle => { mapMetadata=handle; },onUpdate:fn => { mapUpdate=fn; }
};
window.sculptRegion=sculptRegion;
function cloneNodes(list=nodes) { return list.map(n => ({...n,points:n.points?.map(p => ({...p})),paths:clonePaths(n),frame:n.frame?.slice(),params:n.params?{...n.params}:undefined})); }
function nodeDistance(n,p) {
  if (!n.points || n.hidden) return Infinity;
  let best=Infinity;
  for(const path of shapePaths(n))for(let i=0;i<path.length;i++){
    const a=n.points[path[i]],b=n.points[path[Math.min(i+1,path.length-1)]],dx=b.x-a.x,dy=b.y-a.y,l2=dx*dx+dy*dy;
    const t=l2?clamp(((p.x-a.x)*dx+(p.y-a.y)*dy)/l2,0,1):0;
    best=Math.min(best,Math.hypot(p.x-a.x-dx*t,p.y-a.y-dy*t));
  }
  return best;
}
// Moving, rotating and scaling a shape: the gesture's transform applies to
// the shape as it was when the gesture began, path and frame together.
function nodeState(n) { return {drawn:n.params?.river?.drawn,points:n.points.map(q => ({...q})),frame:n.frame||IDENTITY,radius:n.params?.radius,amount:n.params?.amount}; }
function transformNode(n,start,m) {
  n.points=start.points.map(q => { const r=applyFrame(m,q.x,q.y); return {x:clamp(r.x,0,(config.map?.width??size)-1),y:clamp(r.y,0,(config.map?.height??size)-1)}; });
  n.frame=compose(m,start.frame);
  // A river's drawn line moves with it, so Wander can still migrate it from where it now lies.
  if (start.drawn&&n.params?.river) n.params={...n.params,river:{...n.params.river,drawn:start.drawn.map(q => { const r=applyFrame(m,q.x,q.y); return {x:r.x,y:r.y}; }),sig:pointsSignature(n.points)}};
  if (n.params && start.radius) n.params={...n.params,radius:clamp(start.radius*Math.hypot(m[0],m[1]),4,600)};
}
function nodePivot(n) {
  let ax=Infinity,ay=Infinity,bx=-Infinity,by=-Infinity;
  for (const p of n.points) { ax=Math.min(ax,p.x); ay=Math.min(ay,p.y); bx=Math.max(bx,p.x); by=Math.max(by,p.y); }
  return {x:(ax+bx)/2,y:(ay+by)/2,reach:Math.hypot(bx-ax,by-ay)/2+(n.params?.radius||40)};
}
function changeSelected(edit) {
  const n=nodes[selected]; if (!n?.points || stroke || moving || loading || !ready) return;
  const before=nodeBounds(n); cancelWeather(); edit(n);
  pendingRect=unionRect(pendingRect,unionRect(before,nodeBounds(n))); pendingEval=pendingEval<0?selected:Math.min(pendingEval,selected);
  flushEval(); checkpoint(); queueWeather();const adding=pathAdding,mode=drawMode;selectNode(selected);pathAdding=adding;drawMode=mode;updateControls();schedule();
}
function pickNode(p) {
  let best=-1,bestScore=Infinity;
  nodes.forEach((n,i) => { const d=nodeDistance(n,p),reach=Math.max(24,(n.params?.radius||40)); if (d<reach && d/reach<=bestScore) { bestScore=d/reach; best=i; } });
  return best;
}
function selectNode(i) {
  if(selected!==i){pathPoint=-1;pathIndex=0;}
  pathAdding=false;drawMode='select';selected=i;
  const n=nodes[i];if(n)mapFeatures?.clearSelection?.(false);
  if (n && n.params && (HELP[n.kind]||n.kind==='landform')) {
    if (tool!=='move') { rememberTool(); tool='move'; }
    mapFeatures?.deactivate();
    const p=n.params;
    heightControlRange(p);stepControlRange(n.kind,p);
    const [lo,hi]=amountRange(n.kind); $('amount').min=String(lo); $('amount').max=String(hi);
    $('diameter').value=clamp(p.radius*2,16,1200); $('amount').value=clamp(p.amount,lo,hi); $('roughness').value=clamp(Math.round(p.rough*100),0,100);
    $('softness').value=Math.round(p.softness*100); $('cracks').value=Math.round((p.cracks||0)*100);
    for (const [key,id,,,lo,hi,,scale] of SHAPE_FIELDS) $(id).value=clamp(Math.round((p[key]??worldDefault(key))*scale),lo,hi);
  }
  renderLayers(); updateControls(); schedule(false);
  if (n) status(`Selected ${NODE_NAMES[n.kind]||n.kind} #${i+1}. Drag to transform or edit its settings.`);
}
function editSelectedFromControls(overrides={}) {
  const n=nodes[selected]; if (!n || !n.params) return;
  controlsEditing=true;
  const before=nodeBounds(n);
  n.params={...n.params,radius:Number($('diameter').value)/2,amount:Number($('amount').value),rough:Number($('roughness').value)/100,
    softness:Number($('softness').value)/100,cracks:Number($('cracks').value)/100,
    ...Object.fromEntries(SHAPE_FIELDS.filter(f => f[3].includes(n.kind)).map(([key]) => [key,shapeValue(key)])),...overrides};
  migrateRiverNode(n);
  pendingRect=unionRect(pendingRect,unionRect(before,nodeBounds(n)));
  cancelWeather(); pendingEval=pendingEval<0?selected:Math.min(pendingEval,selected); schedule();
}
function reorderLayer(from,to) {
  if(!ready||loading||stroke||moving||mapFeatures?.busy||from===to||!nodes[from]||!nodes[to])return;
  cancelWeather();const [node]=nodes.splice(from,1);nodes.splice(to,0,node);selected=to;pathPoint=-1;
  evaluate(Math.min(from,to));checkpoint();selectNode(to);schedule();queueWeather();
}
function renderLayers() {
  const list=$('layers'); if (!list) return;
  $('layer-count').textContent=nodes.length;
  list.replaceChildren(...nodes.map((n,i) => {
    const item=document.createElement('li');item.draggable=true;item.dataset.index=i;
    item.className=(i===selected?'selected ':'')+(n.hidden?'is-hidden':'');
    const grip=document.createElement('span');grip.className='layer-grip';grip.textContent='⠿';grip.setAttribute('aria-hidden','true');
    const name=document.createElement('button');name.className='layer-name';name.textContent=NODE_NAMES[n.kind]||n.kind;const count=document.createElement('span');count.className='path-count';const pc=shapePaths(n).length;count.textContent=pc?`${pc} path${pc===1?'':'s'}`:'';name.setAttribute('aria-pressed',String(i===selected));name.onclick=()=>selectNode(i===selected?-1:i);
    const number=document.createElement('span');number.className='layer-index';number.textContent=String(i+1).padStart(2,'0');
    const visibility=document.createElement('button');visibility.className='layer-visibility';visibility.textContent=n.hidden?'○':'◉';visibility.title=visibility.ariaLabel=`${n.hidden?'Show':'Hide'} ${name.textContent}`;visibility.setAttribute('aria-pressed',String(!n.hidden));visibility.onclick=()=>{selected=i;nodeAction('hide');};
    name.disabled=visibility.disabled=loading||Boolean(stroke||moving);
    item.append(grip,number,name,count,visibility);
    item.ondragstart=e=>{if(stroke||moving||loading||mapFeatures?.busy){e.preventDefault();return;}e.dataTransfer.setData('application/x-terraform-layer',String(i));e.dataTransfer.effectAllowed='move';};
    item.ondragover=e=>{if(e.dataTransfer.types.includes('application/x-terraform-layer')){e.preventDefault();e.dataTransfer.dropEffect='move';item.classList.add('drag-over');}};
    item.ondragleave=()=>item.classList.remove('drag-over');
    item.ondrop=e=>{e.preventDefault();item.classList.remove('drag-over');const raw=e.dataTransfer.getData('application/x-terraform-layer');if(raw!=='')reorderLayer(Number(raw),i);};
    item.ondragend=()=>list.querySelectorAll('.drag-over').forEach(el=>el.classList.remove('drag-over'));
    return item;
  }).reverse());
  if(!nodes.length){const empty=document.createElement('p');empty.className='empty';empty.textContent='Draw a path to create a shape.';list.append(empty);}
  for (const id of ['node-seed','node-delete','node-up','node-down','node-hide']) $(id).disabled=selected<0||loading||Boolean(stroke||moving);
  $('node-up').disabled||=selected>=nodes.length-1;$('node-down').disabled||=selected<=0;
  $('node-seed').disabled||=nodes[selected]?.seed===undefined;
  $('node-hide').textContent=nodes[selected]?.hidden?'Show':'Hide';
}
function nodeAction(kind) {
  const i=selected; if (i<0 || stroke || moving || loading || !ready) return;
  if(kind==='up'||kind==='down'){reorderLayer(i,i+(kind==='up'?1:-1));return;}
  cancelWeather();
  if (kind==='delete') { nodes.splice(i,1); selected=-1; evaluate(i); }
  else if (kind==='hide') { nodes[i].hidden=!nodes[i].hidden; evaluate(i); }
  else if (kind==='seed') { if (nodes[i].seed===undefined) return; nodes[i].seed=randomSeed(nodes[i].seed); migrateRiverNode(nodes[i]); evaluate(i); }
  checkpoint(); selectNode(selected); schedule(); queueWeather();
}
// Apply a pending node edit now, so history and refinement see it.
function flushEval() {
  if (pendingEval<0) return;
  const from=pendingEval,rect=pendingRect; pendingEval=-1; pendingRect=null;
  evaluate(from,rect);
}
function checkpoint(mapOnly=false) {
  flushEval();
  history.splice(historyIndex+1); history.push({nodes:cloneNodes(),refinementSeed,mapData:mapData(),column:structuredClone(columnOverride),terrainKey:mapOnly?(history[historyIndex]?.terrainKey??++historySerial):++historySerial}); if (history.length>48) history.shift(); historyIndex=history.length-1;
  renderLayers(); updateControls(); persistLater();
}
function moveHistory(delta) {
  const next=historyIndex+delta; if (!ready || stroke || moving || mapFeatures?.busy || next<0 || next>=history.length) return;
  if (history[next].terrainKey===history[historyIndex].terrainKey) { historyIndex=next; restoreMapData(history[next].mapData); updateControls(); persistLater(); schedule(false); return; }
  cancelWeather(); nodes=cloneNodes(history[next].nodes); selected=-1;pathAdding=false;drawMode='select';pathPoint=-1;pathIndex=0; refinementSeed=history[next].refinementSeed; historyIndex=next; restoreMapData(history[next].mapData);
  if (JSON.stringify(history[next].column)!==JSON.stringify(columnOverride)) { restoreColumn(history[next].column); syncColumnPanel(); }
  evaluate(0); renderLayers(); updateControls(); persistLater(); status(delta<0?'Undid the last change.':'Restored the change.'); schedule(); queueWeather();
}

function clearRendererWeather() { regionalWeather=null; if (gpuWeather) gpuWeather.mapsOn=false; }
function cancelWeather() {
  weatherJob++; weatherBase=null;
  weatherState=$('weather').checked?'pending':'disabled';
  $('weather-state').textContent=$('weather').checked?'Refinement paused while editing.':'Weathering off · authored surface';
  updateControls();
}
function queueWeather() {
  controlsEditing=false;
  flushEval();
  queueDrainage();
  if (pagedOn()) { queuePagedWeather(); return; }
  // H6b: a fed Time pass needs the GPU planes current, not the CPU copy; the copy a gesture left out is read in the background from here.
  if (feedWeatherOk() && regionalFields?.gpuReady) { regionalFields.settle(); if (regionalFields.gpuPending()) { regionalFields.gpuReady().then(queueWeather,err => failWeather('the shape pass failed: '+err.message,err)); return; } }
  else if (regionalFields?.pending?.()) { regionalFields.ready().then(queueWeather,err => failWeather('the shape pass failed: '+err.message,err)); return; }   // H6: the map's GPU fields are still being copied
  if (!weatherOn()) {
    weatherState='disabled'; $('weather-state').textContent='Weathering off · authored surface'; updateControls(); return;
  }
  weatherState='pending'; updateControls();
  if (stroke) { $('weather-state').textContent='Refinement paused while editing.'; return; }
  try {
    const job=++weatherJob;
    // The Time pass reads the fields' GPU buffers and leaves its result in GPU buffers (runFedWeather); with no GPU fields there is no pass.
    if (!(feedWeatherOk() && regionalFields.gpuBuffers())) { failWeather('the GPU fields are not ready'); return; }
    $('weather-state').textContent='Refining exposed slopes…';
    runFedWeather(job);
  } catch (err) { failWeather(err.message,err); }
}
// H12: the material field's knobs, or null when the Material weathering control is 0. The field comes from the Time pass's eroded height on the GPU
// (engine-weather.wgsl mf*) and joins the chunk feed in gridTexture layer 1; a change of any of these drops the weather like a change of the pass's own knobs.
const materialKnobs=() => materialKnobsIn(surfaceValues(),refinementSeed,renderer.variant.get('transition'));
// H6b: the Time pass on the fields' GPU buffers; see gpuFeedSource. Nothing comes back to the CPU here.
async function runFedWeather(job) {
  try {
    const {erosionOf}=await import('./sculpt-erosion.js'),erosion=await erosionOf(renderer);
    await regionalFields.gpuQuiet();   // the shape runs' own scratch (whole-map noise: peak 259 MB) is gone before the pass allocates its 120 B a cell
    const b=regionalFields.gpuBuffers();
    if (!b || job!==weatherJob) return;
    gpuPassBytes=grid*grid*120+Math.ceil(grid/8)**2*12;
    const request={planes:b.planes,masks:b.masks,rateMask:MASK_KEYS.indexOf('ovErosion'),grid,size,seaLevel:config.seaLevel,...timeKnobs(renderer)};
    request.drainage=drainagePlane();
    const result=await erosion.runGpu(request),material=materialKnobs();
    if (material && job===weatherJob && !stroke) result.field=await erosion.materialField(materialRequest(config,material,{heightBuffer:result.weather,heightOffset:grid*grid,grid,size}));
    gpuPassBytes=0;
    if (job!==weatherJob || stroke) { retireGpuWeather(result); return; }
    const previous=gpuWeather,release=previous?leaseGpuWeather(previous):()=>{};let dirty;
    try{dirty=await changedWeatherTiles(renderer.device,previous,result,grid,spacing);}finally{release();}
    if(job!==weatherJob||stroke||moving){retireGpuWeather(result);return;}
    const invalid=previous?.invalidRect;
    dropGpuWeather();
    gpuWeather={weather:result.weather,maps:result.maps,field:result.field??null,bytes:result.bytes+(result.field?grid*grid*16:0),mapsOn:true,grid,cpuHeight:false,cpuMaps:false,loading:null};
    gpuErosionMs=result.milliseconds; window.lastErosionParts=result.parts;
    weatherState='ready'; $('weather-state').textContent=`Weathered edges · GPU time pass ${Math.round(gpuErosionMs)} ms`;
    if (!stroke && !moving) gpuWeatherCpu(false).catch(() => {});   // picking and the cursor read heights at once; the maps stay lazy
    markViewChanged(false);if(dirty===null)mapCanvas.invalidate(null,{refinement:true});else {
      if(invalid)dirty.push({x:invalid.x0*spacing,y:invalid.y0*spacing,width:(invalid.x1-invalid.x0+1)*spacing,height:(invalid.y1-invalid.y0+1)*spacing});
      for(const rect of dirty)mapCanvas.invalidate(rect,{refinement:true});
    }
    updateControls(); schedule();
  } catch (err) { gpuPassBytes=0; if (job===weatherJob) failWeather(err.message,err); }
}
function failWeather(message,err=null) {
  console.error(err??new Error(message)); error('Weathering failed: '+message);
  weatherJob++; weatherBase=null;
  weatherState=$('weather').checked?'failed':'disabled';
  $('weather-state').textContent=$('weather').checked
    ?`Weathering failed: ${message}. Turn Weathering off to export the authored surface, then on to retry.`
    :'Weathering off · authored surface';
  updateControls();
}
function schedule() { flushEval(); mapCanvas.schedule(); }
overlay.addEventListener('contextmenu',event => event.preventDefault());
function resize() { if (!mapCanvas) return; mapCanvas.resize(); updateControls(); }

const strokeCard=d => strokeCardIn(config,d);
// Capture tools rebuild a map from strokes (sculpt-scene.js sceneNodes, which the headless runner shares).
function scriptedScene(list,{ground=true}={}) {
  applySeedControl(); refinementSeed=seed;
  cancelWeather(); refined=refinedBase=null; dropGpuWeather(); clearRendererWeather(); 
  nodes=[]; selected=-1;
  for (const node of sceneNodes(config,list,{ground,seed,settings:experiment})) addNode(node);
  regionalFields.changed();
  markChanged(); checkpoint();
  updateControls(); schedule(); queueWeather();
  return nodes.length;
}
function sketch() {
  applySeedControl();
  rememberTool();
  return {format:'nanolathe-terrain-sculpt',version:6,nodes:serializeNodes(),map:config.map,mapData:mapData(),biome:config.biomeId||'green',variant:config.variant||'',size,grid,baseHeight:config.baseHeight,seaLevel:config.seaLevel,seed,varySeed,refinementSeed,
    ...(columnOverride?{column:structuredClone(columnOverride)}:{}),
    toolSettings,softness:Number($('softness').value),relief:Number($('relief').value),
    mineralRing:Number($('mineral-ring').value),ringSpread:Number($('ring-spread').value),
    ringVariation:Number($('ring-variation').value),materialWeathering:Number($('material-weathering').value),depositSpread:Number($('deposit-spread').value),transitionDetail:Number($('transition-detail').value),
    tool,diameter:Number($('diameter').value),amount:Number($('amount').value),roughness:Number($('roughness').value),weather:$('weather').checked,clay:$('clay').checked,light:$('light').value,encoding:'stroke-graph'};
}
// The working copy is the sketch plus the world it was edited in and, per stroke, the settings the artist changed by hand
// (those that differ from that world's defaults for the stroke's tool), so a switch can carry the rest to the new world's defaults.
const sameParam=(a,b) => JSON.stringify(a)===JSON.stringify(b);
function nodeDefaults(n) {
  const entry=n.kind==='landform'?landformTool(n.params):n.kind;
  return n.params && n.kind!=='ground' && entry!=='move' && Object.hasOwn(HELP,entry)?strokeParams(strokeCard(toolDefaults(entry))):null;
}
function workingCopy() {
  const s=sketch();
  s.world=worldId;
  s.nodes=s.nodes.map(n => { const base=n.kind==='ground'?null:nodeDefaults(n); return base?{...n,edited:Object.keys(n.params).filter(k => k!=='seed' && !sameParam(n.params[k],base[k]))}:n; });
  return s;
}
function saveWorking() {
  if (!LOCAL_KEY || !ready) return false;
  try { localStorage.setItem(LOCAL_KEY,JSON.stringify(workingCopy())); return true; } catch (_) { return false; }
}
// Carry a working copy's strokes into the current world: geometry, kind and tool family stay; each setting the artist changed by hand
// stays, every other one takes this world's default. Ground undulation always takes this world's.
function carryNodes(list) {
  const out=list.filter(n => n.kind!=='ground').map(n => {
    const base=n.params && Array.isArray(n.edited) && n.kind!=='ground'?nodeDefaults(n):null;
    const {edited,...rest}=n; if (!base) return rest;
    const keep=new Set(edited),params={};
    for (const k of new Set([...Object.keys(base),...Object.keys(n.params)])) params[k]=keep.has(k) || !(k in base)?n.params[k]:base[k];
    return {...rest,params};
  });
  const ground=list.find(n => n.kind==='ground'),g=groundDefaults();
  if (g.amplitude>0) out.unshift({kind:'ground',...g,seed:ground?.seed??(seed^0x9e37)});
  return out;
}
// Reset every stroke's settings to this world's defaults for its tool: the same defaults a carry gives an unedited setting. Marks of hand edits
// are the differences from these defaults, so none remain. One undo step.
const resettable=() => nodes.some(n => n.points && nodeDefaults(n));
$('reset-strokes').onclick=() => {
  if (stroke || moving || loading || !ready || !resettable()) return;
  cancelWeather();
  nodes=nodes.map(n => { const base=n.points?nodeDefaults(n):null; if(!base)return n; const m={...n,params:{...base,...(n.params.river?{river:n.params.river}:{})}}; migrateRiverNode(m); return m; });
  selected=-1; pathPoint=-1; pathAdding=false; evaluate(0); regionalFields.changed(); checkpoint(); queueWeather(); schedule();
  status('Reset every stroke to this world\'s defaults.');
};
function persistLater() {
  if (!LOCAL_KEY) { $('save-state').textContent='Comparison sketch · use Save sketch to keep it.'; return; }
  clearTimeout(autosaveTimer); autosaveTimer=setTimeout(() => {
    if (stroke || moving || loading) { persistLater(); return; }
    keepSaved=false; $('save-state').textContent=saveWorking()?'Terrain recipe autosaved locally.':'Local autosave unavailable. Use Save sketch to keep this heightfield.';
  },450);
}
let keepSaved=false;   // set while the saved copy failed to load: leaving the page must not overwrite it with a blank map
addEventListener('pagehide',() => { if (!stroke && !moving && !loading && !keepSaved) saveWorking(); });
function loadSketch(s,carry=false) {
  if (!s || s.format!=='nanolathe-terrain-sculpt' || ![4,5,6].includes(s.version) || s.size!==size || s.grid!==grid || !Array.isArray(s.nodes) || s.nodes.some(n => !n || n.kind==='raster')) throw new Error('Load a map stroke graph with the same canvas and grid size.');
  const next=deserializeNodes(carry?carryNodes(s.nodes):s.nodes),column=copyColumn(s.column,defaultColumn),leftOut=retiredStrokeNote(s.nodes);
  cancelWeather(); refined=refinedBase=regionalWeather=null; dropGpuWeather();
  seed=Number.isInteger(s.seed)?clamp(s.seed,0,4294967295):2701; varySeed=s.varySeed!==false; refinementSeed=Number.isInteger(s.refinementSeed)?clamp(s.refinementSeed,0,4294967295):seed; $('seed').value=seed;
  if (Object.hasOwn(HELP,s.tool)) tool=s.tool;
  // A shape button's saved settings count only when a landform made them (its section carries landform knots); the retired tools' settings start from the preset.
  // A shape button's saved settings count only when a landform made them: the retired tools' (shallowMode marks every one) start from the preset,
  // and Plateau takes the old Landform brush's own.
  const retired=t => Boolean(t) && Object.hasOwn(t,'shallowMode'),saved=kind => { const t=s.toolSettings?.[kind]; return strokeKind(kind)!=='landform'||!retired(t)?t:kind==='plateau'?s.toolSettings?.landform:null; };
  // Carried into another world, the brush cards and the world's sliders stay at that world's defaults.
  if (!carry) for (const kind of Object.keys(HELP)) toolSettings[kind]={...toolDefaults(kind),...(saved(kind)||{})};
  showTool(toolSettings[tool]);
  if (!carry) for (const [key,[id,lo,hi]] of Object.entries(TOOL_FIELDS)) if (Number.isFinite(s[key])) $(id).value=clamp(s[key],lo,hi);
  if (!carry) for (const [key,id,lo,hi] of [['softness','softness',0,100],['relief','relief',0,160],['mineralRing','mineral-ring',0,100],['ringSpread','ring-spread',0,100],['ringVariation','ring-variation',0,100],['materialWeathering','material-weathering',0,100],['depositSpread','deposit-spread',0,100],['transitionDetail','transition-detail',0,100]]) if (Number.isFinite(s[key])) $(id).value=clamp(s[key],lo,hi);
  if (typeof s.weather==='boolean') $('weather').checked=s.weather;
  if (typeof s.clay==='boolean') $('clay').checked=s.clay;
  if (['original','alternate'].includes(s.light)) $('light').value=s.light;
  restoreColumn(column);syncColumnPanel();
  nodes=next; selected=-1;pathIndex=0;pathPoint=-1;pathAdding=false;drawMode=tool==='move'?'select':'new'; evaluate(0); restoreMapData(s.mapData);renderLayers(); updateControls(); queueWeather();
  // An old save's crater and crystal strokes were left out (deserializeNodes keeps only kinds the editor draws): said once, with the load's own message.
  if (leftOut) featureNotice=featureNotice?featureNotice+' '+leftOut:leftOut;
}
// A sketch remembers the world it was drawn in. Loading one in another world
// reloads the recorded world first, then plays the sketch there. The file is
// too large for localStorage (a saved v4 sketch is about 4 MB), so it waits in
// the Cache API under a one-use token carried in the address (review A2).
const SKETCH_HANDOFF='nanolathe-sketch-handoff';
const pendingSketchPath=token => '/pending-sketch-'+encodeURIComponent(token)+'.json';
async function stashPendingSketch(token,s) {
  const cache=await caches.open(SKETCH_HANDOFF);
  await cache.put(pendingSketchPath(token),new Response(JSON.stringify({format:'nanolathe-sketch-handoff',token,sketch:s}),{headers:{'Content-Type':'application/json'}}));
}
async function takePendingSketch(token) {
  if (!token) return null;
  try {
    const cache=await caches.open(SKETCH_HANDOFF),response=await cache.match(pendingSketchPath(token));
    if (!response) return null;
    await cache.delete(pendingSketchPath(token));
    const data=await response.json();
    return data?.format==='nanolathe-sketch-handoff' && data.token===token?data.sketch:null;
  } catch (_) { return null; }
}
let leavingForWorld=false,openingShared=false;   // set while a load hands the map to another world's page; the second marks a shared map
async function loadSketchFile(s,commit=true) {
  if(!s || s.format!=='nanolathe-terrain-sculpt' || ![4,5,6].includes(s.version) || !Array.isArray(s.nodes) || s.nodes.some(n=>!n || n.kind==='raster'))throw new Error('Load a map stroke graph.');
  const biome=typeof s?.biome==='string'?s.biome:'';
  const mapChanged=(s?.map?.unitsX??0)!==(config.map?.unitsX??0) || (s?.map?.unitsY??0)!==(config.map?.unitsY??0) || (s?.map && s.seaLevel!==config.seaLevel);
  if (biome && (biome!==config.biomeId || mapChanged || (s.variant||'')!==(config.variant||''))) {
    let served=false,variant='';
    try {
      const response=await fetch(configUrl(biome));
      const servedConfig=response.ok?await response.json():null;
      served=servedConfig?.biomeId===biome;
      variant=served && typeof s.variant==='string' && servedConfig.variants?.[s.variant]?s.variant:'';
      if(s.variant && variant!==s.variant)throw new Error('The saved column variant is unavailable.');
      if(served)copyColumn(s.column,servedConfig.column);
    } catch (err) { error(err.message); return false; }
    if (!served) { error(`The saved terrain belongs to the ${biome} world, which this server does not have. The current terrain was left as it was.`); return false; }
    const token=Math.random().toString(36).slice(2)+Date.now().toString(36);
    try { await stashPendingSketch(token,s); }
    catch (err) { error('The saved terrain could not be carried to '+biome+': '+err.message); return false; }
    status(`Opening ${biome} for the saved terrain…`);
    leavingForWorld=true;
    goToWorld(biome,null,{pendingSketch:token,variant,shared:openingShared?1:'',mapX:s.map?.unitsX??'',mapY:s.map?.unitsY??'',sea:s.map?s.seaLevel:''});
    return false;
  }
  loadSketch(s); if(commit)checkpoint(); status('Loaded the saved terrain.'); schedule(); queueWeather();return true;
}
const groundDefaults=() => groundDefaultsIn(experiment);
function addGroundNode() {
  const g=groundDefaults();
  if (g.amplitude>0) addNode({kind:'ground',...g,seed:seed^0x9e37});
}
function serializeNodes() {
  return nodes.map(n => ({...n,points:n.points?.map(p => ({x:p.x,y:p.y})),paths:clonePaths(n)}));
}
function deserializeNodes(list) {
  return list.filter(n=>n&&NODE_NAMES[n.kind]).map(n=>{
    validatePaths(n);
    return {kind:n.kind,hidden:Boolean(n.hidden),factor:n.factor,amplitude:n.amplitude,wavelength:n.wavelength,coverage:n.coverage,seed:n.seed,params:n.params?{...n.params}:undefined,points:n.points?.map(p=>({...p})),paths:clonePaths(n),frame:Array.isArray(n.frame)&&n.frame.length===6&&n.frame.every(Number.isFinite)?n.frame.slice():undefined};
  });
}
function download(blob,name) { const url=URL.createObjectURL(blob),a=document.createElement('a'); a.href=url; a.download=name; a.click(); setTimeout(() => URL.revokeObjectURL(url),1000); }
for (const b of document.querySelectorAll('[data-tool]')) b.addEventListener('click',() => {
  if(stroke||moving)return;mapFeatures?.deactivate();rememberTool();tool=b.dataset.tool;drawMode=tool==='move'?'select':'new';pathAdding=false;
  if(tool==='move'&&selected>=0)selectNode(selected);
  else{selected=-1;pathPoint=-1;renderLayers();showTool(toolSettings[tool]);}
  updateControls();schedule();persistLater();
});
for (const id of ['diameter','amount','roughness','softness','cracks']) $(id).addEventListener('input',() => { rememberTool(true); updateControls(); schedule(); persistLater(); if (selected>=0) editSelectedFromControls(); });
for (const id of ['diameter','amount','roughness','softness','cracks']) $(id).addEventListener('change',() => { if (selected>=0) { checkpoint(); queueWeather(); } });
for (const [id,kind] of [['node-seed','seed'],['node-delete','delete'],['node-up','up'],['node-down','down'],['node-hide','hide']]) $(id).addEventListener('click',() => nodeAction(kind));
$('feature-tool').onclick=()=>{if(stroke||moving)return;selected=-1;pathAdding=false;drawMode='select';mapFeatures?.activate('deposit');renderLayers();updateControls();};
function setPathMode(on){if(stroke||moving||loading)return;pathEditing=on;pathPoint=-1;pathAdding=false;drawMode='select';updateControls();schedule();}
$('edit-path').onclick=()=>setPathMode(!pathEditing);$('transform-mode').onclick=()=>setPathMode(false);
$('canvas-path-mode').onclick=()=>setPathMode(!pathEditing);
$('selection-clear').onclick=$('canvas-deselect').onclick=()=>selectNode(-1);
$('selection-delete').onclick=()=>nodeAction('delete');
for(const key of ['x','y','rotation','scale']){
  const input=$('selection-'+key);
  input.addEventListener('change',()=>{
    if(!input.reportValidity()||input.value.trim()===''){input.blur();updateControls();return;}
    const value=Number(input.value),n=nodes[selected];if(!n?.points||!Number.isFinite(value))return;
    if(Math.abs(value-selectionTransform(n).values[key])<.051){input.blur();updateControls();return;}
    const matrix=selectionTransform(n,{[key]:value}).matrix;
    changeSelected(node=>transformNode(node,nodeState(node),matrix));input.blur();updateControls();
  });
  input.addEventListener('keydown',e=>{if(e.key==='Enter'){e.preventDefault();input.blur();}if(e.key==='Escape'){e.preventDefault();e.stopPropagation();input.value=String(Math.round(selectionTransform(nodes[selected]).values[key]*10)/10);input.blur();}});
}
$('path-add').onclick=()=>changeSelected(n=>{const added=insertPoint(n,pathIndex,pathPoint);if(added>=0)pathPoint=added;});
$('path-delete').onclick=()=>{if(pathPoint<0)return;changeSelected(n=>{if(removePoint(n,pathPoint)){pathPoint=-1;pathIndex=Math.min(pathIndex,shapePaths(n).length-1);pathAdding=false;}});};
$('path-remove').onclick=()=>changeSelected(n=>{removePath(n,pathIndex);pathIndex=0;pathPoint=-1;pathAdding=false;});
$('path-extend').onclick=()=>{pathAdding=!pathAdding;updateControls();schedule();};
$('draw-new').onclick=()=>{if(stroke||moving||loading)return;const n=nodes[selected],candidate=n?.kind==='landform'?landformTool(n.params):n?.kind||tool,entry=HELP[candidate]&&candidate!=='move'?candidate:'plateau';document.querySelector(`[data-tool="${entry}"]`)?.click();};
$('draw-add').onclick=()=>{if(stroke||moving||loading||!nodes[selected]?.points||nodes[selected].hidden)return;drawMode='add';pathEditing=false;pathAdding=false;pathPoint=-1;updateControls();schedule();};
for(const [id,value] of [['rotate-left',-Math.PI/12],['rotate-right',Math.PI/12],['scale-down',1/1.1],['scale-up',1.1]])$(id).onclick=()=>changeSelected(n=>transformNode(n,nodeState(n),about(nodePivot(n),id.startsWith('rotate')?rotation(value):scaling(value))));
document.addEventListener('terraform-feature-mode',()=>updateControls());
document.addEventListener('terraform-status',event=>{featureNotice=event.detail;status(event.detail);});
$('tool-style').addEventListener('change',() => {
  const preset=$('tool-style').value;if(!Object.hasOwn(TOOL_PRESETS,preset))return;
  // A selected landform takes the world's version of the palette entry its section form belongs to.
  const n=nodes[selected],entry=n?.kind==='landform'?landformTool(n.params):n?.kind||tool;toolSettings[tool]=toolDefaults(entry,preset);showTool(toolSettings[tool],strokeKind(entry));
  if(selected>=0){editSelectedFromControls({curve:toolSettings[tool].curve,along:toolSettings[tool].along});checkpoint();queueWeather();}
  updateControls();schedule();persistLater();
});
// A surface slider redraws; the two the material field reads (TIME_SLIDER_IDS) run the Time pass again.
for (const id of SURFACE_SLIDER_IDS) $(id).addEventListener('input',() => { markViewChanged(); updateControls(); schedule(); if (TIME_SLIDER_IDS.includes(id)) queueWeather(); persistLater(); });
function applySeedControl() {
  const next=clamp(Math.trunc(Number($('seed').value) || 0),0,4294967295);
  // Saving or adding a path must never copy the selected shape's seed into
  // the separate seed waiting for the next new shape.
  if(nodes[selected]?.seed===undefined)seed=next;
  $('seed').value=next;return next;
}
$('seed').addEventListener('change',() => {
  if(stroke||moving||loading)return;
  const next=applySeedControl();
  if(nodes[selected]?.seed!==undefined&&nodes[selected].seed!==next)changeSelected(n=>{n.seed=next;migrateRiverNode(n);});
  updateControls();schedule();persistLater();
});
$('seed-randomize').onclick=()=>{
  if(stroke||moving||loading)return;
  if(nodes[selected]?.seed!==undefined)nodeAction('seed');
  else{seed=randomSeed(seed);$('seed').value=seed;updateControls();persistLater();}
};
$('seed-vary').onchange=()=>{varySeed=$('seed-vary').checked;updateControls();persistLater();};
for (const id of ['clay','light']) $(id).addEventListener('change',() => { markViewChanged(); updateControls(); schedule(); persistLater(); });
$('weather').addEventListener('change',() => {
  cancelWeather(); markViewChanged();
  if (!$('weather').checked) clearRendererWeather();
  schedule(); queueWeather(); persistLater();
});
$('undo').addEventListener('click',() => moveHistory(-1)); $('redo').addEventListener('click',() => moveHistory(1));
$('blank').addEventListener('click',() => { if (stroke) return; applySeedControl(); refinementSeed=seed; cancelWeather(); refined=refinedBase=null; dropGpuWeather(); clearRendererWeather(); nodes=[]; selected=-1; addGroundNode(); regionalFields.changed(); markChanged(); checkpoint(); status('Blank dry ground.'); schedule(); queueWeather(); });
$('save').addEventListener('click',() => { if (!stroke) download(new Blob([JSON.stringify(sketch())],{type:'application/json'}),'terrain-sculpt-v3.json'); });
$('load').addEventListener('click',() => { if (!stroke) $('file').click(); });
$('file').addEventListener('change',async () => {
  const file=$('file').files[0]; $('file').value=''; if (!file || stroke) return;
  loading=true; $('editor').disabled=true;
  try { if (file.size>64*1024*1024) throw new Error('This sculpt sketch is too large to load.'); await loadSketchFile(JSON.parse(await file.text())); } catch (err) { error(err.message); }
  finally { loading=false; $('editor').disabled=false; updateControls(); }
});
// Share link: the save, gzipped the same way every time, goes to the save-link service; the link is this page with ?map=<id>.
// Opening such a link keeps the visitor's own map in the one "previous map" slot first, and offers to bring it back.
const shareMessage=text => { $('share-message').textContent=text; };
function showPrevious() { $('share-previous').hidden=takePrevious(localStorage)===null; }
$('share-menu').addEventListener('toggle',async () => {
  if (!$('share-menu').open) return;
  showPrevious();
  if (shareOpenedByLoad) { shareOpenedByLoad=false; return; }
  $('share-result').hidden=true;
  const service=mapsService(services);
  if (!service.url) { shareMessage(service.reason); return; }
  if (!ready || loading || stroke) { shareMessage('The map is still loading. Try again in a moment.'); return; }
  shareMessage('Making your link…');
  try {
    const id=await postMap(service.url,await gzipText(shareText(sketch())));
    $('share-url').value=shareUrl(location.href,id); $('share-result').hidden=false;
    shareMessage('Anyone with this link opens a copy of your map. Later edits are not included.');
    $('share-url').select();
  } catch (err) { shareMessage(err.message); }
});
let shareOpenedByLoad=false;
$('share-copy').addEventListener('click',async () => {
  $('share-url').select();
  try { await navigator.clipboard.writeText($('share-url').value); shareMessage('Link copied.'); } catch (_) { shareMessage('Press Ctrl+C (Cmd+C on a Mac) to copy the selected link.'); }
});
$('share-restore').addEventListener('click',async () => {
  const text=takePrevious(localStorage); if (text===null || stroke || loading) return;
  loading=true; $('editor').disabled=true;
  try {
    const previous=JSON.parse(text);
    dropPrevious(localStorage);
    leavingForWorld=false;
    const done=await loadSketchFile(previous);
    if (done) { showPrevious(); shareMessage('Your previous map is back.'); }
    else if (!leavingForWorld) keepPrevious(localStorage,text);   // the load failed: the slot stays
  } catch (err) { keepPrevious(localStorage,text); error(err.message); }
  finally { loading=false; $('editor').disabled=false; updateControls(); }
});
function announceShared() {
  status('Opened a shared map.'); shareMessage('Opened a shared map.'); showPrevious();
  if (!$('share-previous').hidden) { shareOpenedByLoad=true; $('share-menu').open=true; }
}
// Called once the editor is ready: a ?map=<id> address opens that shared map.
async function openSharedMap() {
  const id=mapIdFromSearch(location.search); if (id===null || experiment.has('pendingSketch')) return;
  const service=mapsService(services);
  if (!service.url) { error(service.reason); return; }
  loading=true; $('editor').disabled=true;
  try {
    status('Opening the shared map…');
    const shared=await getMap(service.url,id);
    if (nodes.some(n => n.kind!=='ground')) keepPrevious(localStorage,JSON.stringify(workingCopy()));   // the visitor's own map, before it is replaced
    openingShared=true; leavingForWorld=false;
    const opened=await loadSketchFile(shared); openingShared=false;
    if (opened) {
      window.history.replaceState(null,'',withoutMap(location.href));
      announceShared(); persistLater();
    }
  } catch (err) { error(err.message); }
  finally { loading=false; $('editor').disabled=false; updateControls(); }
}
$('export').addEventListener('click',async () => {
  if (!canExport()) return;
  try { await mapCanvas.idle(); canvas.toBlob(blob => { if (blob) download(blob,'terrain-view.png'); else error('PNG export is unavailable for this view.'); },'image/png'); }
  catch (err) { error(err.message); }
});
const typing=target => target instanceof HTMLElement && (['INPUT','SELECT','TEXTAREA'].includes(target.tagName) || target.isContentEditable);
window.addEventListener('keydown',event => {
  if(event.defaultPrevented)return;
  if(!typing(event.target)&&!loading&&!stroke&&!moving&&!event.ctrlKey&&!event.metaKey&&!event.altKey){
    if(event.code==='KeyF'&&event.shiftKey){event.preventDefault();editorUI.toggleFocus();return;}
    if(event.key==='Escape'&&editorUI.exitFocus()){event.preventDefault();return;}
    if(event.code==='KeyV'){event.preventDefault();if(tool==='move'&&!mapFeatures?.active)setPathMode(false);else document.querySelector('[data-tool="move"]').click();return;}
  }
  if (mapFeatures?.active && event.code!=='Space' && !(event.ctrlKey||event.metaKey)) return;
  if (event.defaultPrevented || typing(event.target) || loading) return;
  if(event.code==='KeyP'&&tool==='move'&&selected>=0&&!event.ctrlKey&&!event.metaKey&&!stroke&&!moving){event.preventDefault();setPathMode(!pathEditing);return;}
  if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase()==='z') { event.preventDefault(); moveHistory(event.shiftKey?1:-1); }
  if ((event.key==='Delete' || event.key==='Backspace') && pathEditing && pathPoint>=0 && selected>=0 && !stroke && !moving) {event.preventDefault();$('path-delete').click();return;}
  if(event.key==='Escape'&&!moving&&!stroke){event.preventDefault();if(!editorUI.exitFocus()){if(pathAdding){pathAdding=false;updateControls();schedule();}else if(drawMode==='add'){drawMode='select';updateControls();schedule();}else if(pathEditing)setPathMode(false);else selectNode(-1);}return;}
  const arrow={ArrowLeft:[-1,0],ArrowRight:[1,0],ArrowUp:[0,-1],ArrowDown:[0,1]}[event.key];
  if(arrow&&tool==='move'&&selected>=0&&event.target===overlay&&!event.metaKey&&!event.ctrlKey&&!stroke&&!moving){
    if(pathEditing&&pathPoint<0){event.preventDefault();return;}
    event.preventDefault();const step=event.shiftKey?10:1,dx=arrow[0]*step,dy=arrow[1]*step;
    changeSelected(n=>{if(pathEditing&&pathPoint>=0){const p=n.points[pathPoint];p.x=clamp(p.x+dx,0,config.map.width-1);p.y=clamp(p.y+dy,0,config.map.height-1);}else transformNode(n,nodeState(n),[1,0,0,1,dx,dy]);});return;
  }
  if ((event.key==='Delete' || event.key==='Backspace') && selected>=0 && !stroke && !moving) { event.preventDefault(); nodeAction('delete'); status('Deleted the selected shape.'); }
  // Rotate , . (15°), scale [ ] (10%), height PageUp / PageDown (5).
  const turn={',':-Math.PI/12,'.':Math.PI/12}[event.key],grow={'[':1/1.1,']':1.1}[event.key],lift={PageUp:5,PageDown:-5}[event.key];
  if (selected>=0 && nodes[selected]?.points && (turn || grow || lift) && !event.metaKey && !event.ctrlKey) {
    event.preventDefault();
    changeSelected(n => {
      if (lift) { if (n.params && n.kind!=='erase') n.params={...n.params,amount:clamp(n.params.amount+lift,...amountRange(n.kind))}; return; }
      transformNode(n,nodeState(n),about(nodePivot(n),turn?rotation(turn):scaling(grow)));
    });
  }
});
new ResizeObserver(resize).observe($('viewport'));


// Worlds. A world is a biome's materials (prepared per biome by the server)
// plus the map-wide settings and base colors chosen for it. Built-in worlds
// can be adjusted; New world copies the current one under a new name. Kept in
// this browser (localStorage) and exportable as JSON.
const WORLD_STORE='nanolathe-map-editor-worlds';
// Card P12b: the light's two colors ride with the world's colors; white (off) is the grey light. Help for each row is shown under it.
const LIGHT_COLOR_HELP={sun:'The direct light and the glints it mirrors. A warm sun lights slopes that face it.',sky:'The ambient light that fills the shade. A cool sky keeps shaded ground and the lee of hills blue.'};
let worlds={},worldId=null;
function loadWorlds() { try { worlds=JSON.parse(localStorage.getItem(WORLD_STORE)||'{}')||{}; } catch (_) { worlds={}; } }
function saveWorlds() { try { localStorage.setItem(WORLD_STORE,JSON.stringify(worlds)); } catch (_) {} }
// A variant's colors (card C5) stay in config.colors; the world keeps only its base ones, so choosing a variant never writes into the world's own store.
function activeWorld() { return worlds[worldId] ??= {name:config.biome,base:config.biomeId,colors:{...(config.baseColors||config.colors||{})},knobs:{}}; }
const hexColor=c => '#'+c.map(v => Math.round(clamp(v,0,1)*255).toString(16).padStart(2,'0')).join('');
// A world's colors: the server's defaults for its base world, then the
// world's own choices; null means explicitly off (the texture's own color).
function mergedColors() { return worldHexColors(config,experiment,activeWorld().colors||{}); }
function worldColors() { return rendererColors(mergedColors(),columnOverride?.colors); }
function columnForEdit(){const column=structuredClone(config.column);if(column?.colors){const colors=worldColors();column.colors=column.colors.map((c,i)=>colors['strata'+(i+1)]?.map(v=>v*255)||c);}return column;}
function restoreColumn(column){
  columnOverride=column;config.column=column||defaultColumn;columnEditing=false;
  cancelWeather();refined=refinedBase=null;dropGpuWeather();clearRendererWeather();renderer.applyKnobs();renderer.setColors(worldColors());syncWorldControls();markViewChanged();
}
function editColumn(value){
  const column=copyColumn(value,defaultColumn),next=JSON.stringify(column)===JSON.stringify(defaultColumn)?null:column;
  if(JSON.stringify(next)===JSON.stringify(columnOverride))return;
  restoreColumn(next);columnEditing=true;schedule();queueWeather();persistLater();
}
function commitColumn(){if(!columnEditing)return;columnEditing=false;checkpoint();queueWeather();}
function defaultColor(key) {
  const flower=/^flower([1-4])$/.exec(key);if(flower)return (config.material?.groundCover?.plants?.flowers?.palette?.[Number(flower[1])-1]?.slice(0,3)||[255,255,255]).map(v=>v/255);
  const m=renderer.means,w=config.water||{},mat=config.material||{};
  const rgb=v => v&&v.map(x => x/255);
  const strata=(config.column?.colors||[[146,74,58],[188,122,96],[140,124,138],[198,182,158],[166,98,76]]).map(rgb);
  return {ground:m.ground,slope:m.slope,rock:m.rock,sand:m.rock&&m.rock.map(v => v+(1-v)*.3),beach:rgb(mat.beachRGB),shallow:rgb(w.shallowRGB),deep:rgb(w.deepRGB),
    crystal:(config.material?.crystalRGB||[110,150,225]).map(v => v/255),sun:[1,1,1],sky:[1,1,1],strata1:strata[0],strata2:strata[1],strata3:strata[2],strata4:strata[3],strata5:strata[4]}[key]||[.5,.5,.5];
}
function goToWorld(base,id,extra) {
  if (!stroke && !moving && !loading) saveWorking();   // the working map goes with the artist to the new world
  const url=new URL(location.origin+location.pathname); url.searchParams.set('biome',base); if (id && id!==base) url.searchParams.set('world',id);
  if (config.map) for (const [key,value] of Object.entries({mapX:config.map.unitsX,mapY:config.map.unitsY,sea:config.seaLevel})) url.searchParams.set(key,value);
  // A saved world carries the material variant its controls were authored for.
  const savedVariant=id&&worlds[id]?.variant;
  if(typeof savedVariant==='string')url.searchParams.set('variant',savedVariant);
  else if (base===config.biomeId && config.variant) url.searchParams.set('variant',config.variant);
  for (const [key,value] of Object.entries(extra||{})) if (value!=='' && value!==null && value!==undefined) url.searchParams.set(key,value); else url.searchParams.delete(key);
  location.href=url.toString();
}
function buildWorldPanel() {
  const world=activeWorld();
  $('world-name').textContent=world.name;
  const select=$('biome-select');
  const builtIn=Object.entries(config.biomes||{}).map(([id,name]) => new Option(name,'biome:'+id,false,worldId===id));
  const custom=Object.entries(worlds).filter(([id,w]) => !(id in (config.biomes||{})) && w.base in (config.biomes||{})).map(([id,w]) => new Option(w.name+' (custom)','world:'+id,false,worldId===id));
  select.replaceChildren(...builtIn,...custom);
  select.onchange=() => { const [kind,id]=select.value.split(':'); if (kind==='biome') goToWorld(id); else goToWorld(worlds[id].base,id); };
  // Variants of this world (card C5 stage 3): named presets over its own. The
  // world's own preset is the default and a variant reloads the page.
  const variants=Object.entries(config.variants||{}),variantSelect=$('variant-select');
  $('variant-control').hidden=!variants.length;
  variantSelect.replaceChildren(new Option("The world's own",''),...variants.map(([id,label]) => new Option(label,id)));
  variantSelect.value=config.variant||'';
  variantSelect.onchange=() => { if(worldId!==config.biomeId){world.variant=variantSelect.value;saveWorlds();}goToWorld(config.biomeId,worldId===config.biomeId?null:worldId,{variant:variantSelect.value}); };
  const rows=$('world-colors'); rows.replaceChildren();
  for (const [key,label] of colorRows(config,experiment)) {
    const row=document.createElement('div'); row.className='color-row';
    const set=mergedColors()[key];
    row.innerHTML=`<span>${label}</span><input type="checkbox" aria-label="Use a base color for ${label}"${set?' checked':''}><input type="color" aria-label="${label} base color" value="${set||hexColor(defaultColor(key))}">`;
    const [box,pick]=row.querySelectorAll('input');
    const apply=() => { world.colors=pickWorldColor(config,world.colors,key,box.checked?pick.value:null); saveWorlds(); renderer.setColors(worldColors()); syncWorldControls(); updateControls(); markViewChanged(); schedule(); };
    box.addEventListener('change',apply); pick.addEventListener('input',() => { box.checked=true; apply(); });
    rows.append(row);
    if (LIGHT_COLOR_HELP[key]) { const help=document.createElement('p'); help.className='small'; help.textContent=LIGHT_COLOR_HELP[key]; rows.append(help); }
  }
  // Ground pattern: this world's own, or another world's, recolored by
  // the Ground base color above.
  const patterns=config.groundPatterns||{},patternRow=document.createElement('div'); patternRow.className='control';
  patternRow.innerHTML=`<label for="ground-pattern">Ground pattern</label><select id="ground-pattern" style="width:100%"><option value="">This world's own</option>${Object.entries(patterns).filter(([id]) => id!==config.biomeId).map(([id,p]) => `<option value="${id}">${p.name}</option>`).join('')}</select><p class="small">Another world's ground grain, moved to this world's Ground color. Contrast is under Ground below.</p>`;
  rows.prepend(patternRow);
  $('ground-pattern').value=patterns[experiment.get('groundPattern')]?experiment.get('groundPattern'):'';
  $('ground-pattern').onchange=() => {
    // Keep this world's ground color when only the grain changes.
    if (!mergedColors().ground && renderer.means.ground) { world.colors={...world.colors,ground:hexColor(renderer.means.ground)}; saveWorlds(); }
    setKnob('groundPattern',$('ground-pattern').value);
  };
  $('world-reset').onclick=() => { world.colors={...(config.colors||{})}; saveWorlds(); buildWorldPanel(); renderer.setColors(worldColors()); syncWorldControls(); updateControls(); markViewChanged(); schedule(); };
  $('world-new').onclick=() => {
    const name=$('world-new-name').value.trim(); if (!name) { $('world-new-name').focus(); status('Name the new world first.'); return; }
    const id=name.toLowerCase().replace(/[^a-z0-9]+/g,'-').replace(/^-|-$/g,'').slice(0,24)+'-'+Math.random().toString(36).slice(2,6);
    const knobs={...world.knobs}; for (const [,list] of KNOBS) for (const [key] of list) if (experiment.has(key)) knobs[key]=experiment.get(key);
    worlds[id]={name,base:config.biomeId,variant:config.variant||'',colors:{...world.colors},knobs}; saveWorlds(); goToWorld(config.biomeId,id);
  };
  $('world-export').onclick=() => download(new Blob([JSON.stringify({format:'nanolathe-map-world',version:1,world:{...world,variant:config.variant||'',knobs:{...world.knobs}}},null,1)],{type:'application/json'}),(world.name||'world').replace(/[^\w-]+/g,'_')+'.world.json');
  $('world-import').onclick=() => $('world-file').click();
  $('world-file').onchange=async () => {
    try {
      const data=JSON.parse(await $('world-file').files[0].text()),w=data?.world;
      if (data?.format!=='nanolathe-map-world' || !w || typeof w.name!=='string' || !(w.base in (config.biomes||{}))) throw new Error('Not a world file for a world this server has.');
      const id=w.name.toLowerCase().replace(/[^a-z0-9]+/g,'-').slice(0,24)+'-'+Math.random().toString(36).slice(2,6);
      worlds[id]={name:w.name,base:w.base,...(typeof w.variant==='string'?{variant:w.variant}:{}),colors:Object.fromEntries(Object.entries(w.colors||{}).filter(([,v]) => v===null || /^#[0-9a-f]{6}$/i.test(v))),knobs:Object.fromEntries(Object.entries(w.knobs||{}).map(([k,v]) => [k,String(v)]))};
      saveWorlds(); goToWorld(w.base,id);
    } catch (err) { error(err.message); }
  };
  const isCustom=!(worldId in (config.biomes||{}));
  $('world-delete').textContent=isCustom?'Delete this world':'Restore built-in settings';
  $('world-delete').onclick=() => { delete worlds[worldId]; saveWorlds(); goToWorld(config.biomeId); };
}

// Crack styles set several crack knobs at once; each stays editable.
const CRACK_STYLES={
  'Branching rock':{crackSeverity:.6,crackSpacing:40,crackMajor:.8,crackMinor:.75,crackHairline:.6,crackBlocks:.6,crackWidth:1,crackNetwork:.35,crackDark:.75},
  'Hairline':{crackSeverity:.35,crackSpacing:30,crackMajor:.5,crackMinor:.5,crackHairline:1,crackBlocks:.2,crackWidth:.7,crackNetwork:.2,crackDark:.7},
  'Polygonal plates':{crackSeverity:.7,crackSpacing:48,crackMajor:.9,crackMinor:.9,crackHairline:.7,crackBlocks:1,crackWidth:1,crackNetwork:1,crackDark:.8},
  'Deep fissures':{crackSeverity:.9,crackSpacing:56,crackMajor:1,crackMinor:.4,crackHairline:.3,crackBlocks:.5,crackWidth:1.5,crackNetwork:0,crackDark:.85},
};
function buildKnobs() {
  const root = $('knobs'), params = experiment;
  // Rendering and Palette sit with the graphics settings; every other group is a block in a World section.
  const group = (title, open = false) => { const d = document.createElement('details'); d.className = 'knobs-group'; d.open = open; const t = document.createElement('summary'); t.textContent = title; d.append(t); $('rendering-host').append(d); return d; };
  const render = group('Rendering',true);
  const toggle = (key, label, on, off, isOn) => {
    const row = document.createElement('label'); row.className = 'small'; row.style.display = 'flex'; row.style.gap = '6px';
    const box = document.createElement('input'); box.type = 'checkbox'; box.checked = isOn;
    box.addEventListener('change', () => setKnob(key, box.checked ? on : off));
    row.append(box, label); render.append(row);
  };
  toggle('palette', 'TA palette', 'nearest', 'off', params.get('palette') !== 'off');
  // Every knob needs a world default (sculpt.py KNOB_DEFAULTS).
  const missing = [...KNOBS.flatMap(([, list]) => list.map(k => k[0])), ...SHAPE_FIELDS.map(f => f[0])].filter(k => !(k in (config.defaults || {})));
  if (missing.length) console.warn('Knobs without a world default:', missing.join(', '));
  const groups=new Map();
  for (const [title, knobs] of KNOBS) {
    const name=WORLD_GROUP_NAMES[title]||title;
    if(!groups.has(name)){if(title==='Palette'){const box=group(name);box.dataset.group=name;groups.set(name,{block:box});}else groups.set(name,worldGroup(name));}
    const {block:box,search}=groups.get(name);
    if (title === 'Cracks') {
      const wrap = document.createElement('div'); wrap.className = 'control';
      wrap.innerHTML = `<label for="crack-style">Style</label><select id="crack-style" style="width:100%"><option value="">Choose a style…</option>${Object.keys(CRACK_STYLES).map(k => `<option>${k}</option>`).join('')}</select><p class="small">How much each shape cracks is its own Cracks slider (Shape panel).</p>`;
      wrap.querySelector('select').addEventListener('change', event => {
        const style = CRACK_STYLES[event.target.value]; if (!style) return;
        for (const [key, value] of Object.entries(style)) {
          const input = $('knob-' + key); if (input) { input.value = value; input.previousElementSibling.querySelector('output').textContent = value; }
          setKnob(key, value);
        }
      });
      box.append(wrap);
    }
    for (const [key, oldLabel, min, max, step, value] of knobs) {
      if(PARKED_WORLD_CONTROLS.has(key))continue;
      const label=controlLabel(key,oldLabel);
      const id = 'knob-' + key, current = params.has(key) ? Number(params.get(key)) : value, choices = WORLD_CHOICES[key];
      const wrap = controlRow({id,label:`${label} <output${choices?' hidden':''}>${current}</output>`,range:`min="${min}" max="${max}" step="${step}" value="${current}"`,choices});
      wrap.dataset.knob=key;if(search)wrap.dataset.searchGroup=search;
      const input = wrap.querySelector('#'+id), out = wrap.querySelector('output');
      if(choices)input.value=String(current);
      input.addEventListener('input', () => { out.textContent = input.value; setKnob(key, input.value); });
      box.append(wrap);
    }
  }
  syncWorldControls=mountWorldControlIndex(root,worldPanelValues);
}
// The facts the World panel enables a row by (sculpt-knobs.js worldPanelValues, which worldControlRequirement reads).
const panelFacts=() => ({config,renderer,nodes,colors:worldColors(),weathering:weatherOn(),materialWeathering:Number($('material-weathering').value)});
function worldPanelValues() { return worldPanelValuesOf(panelFacts()); }
// A world row's change (sculpt-knobs.js applyKnob, which the headless host shares): the address, the world's store and the panel here, the
// renderer's settings there, then the reload, shape and Time pass it asks for.
function setKnob(key, value) {
  const url = new URL(location.href); url.searchParams.set(key, value); window.history.replaceState(null, '', url);
  const next = applyKnob({key, value, settings: experiment, renderer, nodes, seed});
  if (config) { activeWorld().knobs[key] = String(value); saveWorlds(); if (key==='strata') buildWorldPanel(); }
  if (next.reload) { location.reload(); return; }
  syncWorldControls(); markViewChanged(); schedule();
  if (!next.weather) return;
  cancelWeather(); if (next.evaluate!==undefined) evaluate(next.evaluate); if (next.checkpoint) checkpoint(); queueWeather();
}
async function bootMap() {
  worldSize=config.worldSize??config.size; worldGrid=config.worldGrid??config.grid;
  size=worldSize; grid=worldGrid; spacing=(worldSize-1)/(worldGrid-1);
  // Outside a scoped regional replay, only the graph and empty placeholders
  // exist. In particular, opening a 40×40 map allocates no world field planes.
  seed=Number($('seed').value); refinementSeed=seed; regionalFields=makeRegionalFields();
  regionalFields.subscribe?.(() => { if (selectedLandform() && !$('section-preview-control').hidden) drawSection(); });   // the sections read from the map follow its CPU copy
  regionalFields.subscribeSubmit(change=>{
    if(regionalFields.paged)return;
    const r=change.rect,rect=r?{x0:Math.floor(r.x/spacing),y0:Math.floor(r.y/spacing),x1:Math.ceil((r.x+r.width)/spacing),y1:Math.ceil((r.y+r.height)/spacing)}:null;
    if(gpuWeather)gpuWeather.invalidRect=invalidateRefinement(gpuWeather.invalidRect,rect,worldGrid);
    if(refined)refinedInvalidRect=invalidateRefinement(refinedInvalidRect,rect,worldGrid);
  });
  addGroundNode();
  mapCanvas=await mountMapCanvas({config,canvas,overlay,api:sculptRegion,drawOptions:currentDrawOptions});
  regionalFields.subscribeSubmit?.(showDrainage);
  if (regionalFields.paged) { pagedCoarseStarted=true; regionalFields.subscribe(() => mapCanvas.schedule()); regionalFields.startCoarse().catch(() => {}); }   // H5b: the overview's coarse lattice fills in the background
  renderer=mapCanvas.renderer; renderer.onerror=message => error(message); renderer.setColors(worldColors());$('export').textContent='Export view PNG';
  buildKnobs(); buildWorldPanel();
  syncColumnPanel=mountColumnPanel(()=>({column:columnForEdit(),variant:config.variant,edited:Boolean(columnOverride)}),editColumn,commitColumn,()=>{editColumn(null);commitColumn();});
  let saved=null; try { if (LOCAL_KEY && !experiment.has('pendingSketch')) saved=localStorage.getItem(LOCAL_KEY)??localStorage.getItem(legacyKey()); } catch (_) {}
  if (saved) {
    try {
      const s=JSON.parse(saved),same=s.biome===config.biomeId && (s.variant||'')===(config.variant||'') && (s.world||s.biome)===worldId;
      loadSketch(s,!same); status(same?'Restored your saved map recipe.':'Carried your working map into this world.');
    } catch (err) { keepSaved=true; error('Saved map could not be loaded: '+err.message+' The saved copy is retained until you edit.'); }
  }
  else status('Blank map ready · draw terrain with the existing tools.');
  ready=true; $('editor').disabled=false; $('world-editor').disabled=false;
  history=[{nodes:cloneNodes(),refinementSeed,mapData:mapData(),column:structuredClone(columnOverride),terrainKey:++historySerial}]; historyIndex=0; renderLayers();
  const pending=await takePendingSketch(experiment.get('pendingSketch'));
  if (pending) { try { loadSketch(pending); checkpoint(); status('Loaded the saved map.'); if (experiment.get('shared')) { window.history.replaceState(null,'',(u => (u.searchParams.delete('shared'),u.toString()))(new URL(location.href))); announceShared(); } } catch (err) { error('The handed-over terrain could not be loaded: '+err.message); } }
  $('levels').textContent=`Dry base ${config.baseHeight} · sea ${config.seaLevel} · heights ${MIN_HEIGHT}…${MAX_HEIGHT}`;
  updateControls(); resize(); schedule(); queueWeather();
  $('one').click();   // every page load starts at 1x, centered on the map
  await openSharedMap();
}
async function boot() {
  try {
    await requestAdapter();   // a browser without WebGPU, or an adapter below the engine's limits, gets a plain message before anything loads
    services=await (await fetch('services.json')).json();   // which server-side services this host has (export, features, saving to a server)
    const response=await fetch(configUrl(experiment.get('biome')||services.defaultWorld,experiment.get('variant'))); if (!response.ok) throw new Error('Could not load the sculpt configuration.'); config=await response.json(); config.services=services;
    defaultColumn=config.column;
    // H12b: the editor always works on a map; an address without a size opens the default 4x4 one.
    if (!experiment.has('mapX') && !experiment.has('mapY')) {
      // A bare address reopens the working map's size and sea level.
      let w=null; try { if (LOCAL_KEY && !experiment.has('pendingSketch')) w=JSON.parse(localStorage.getItem(LOCAL_KEY)||'null'); } catch (_) {}
      const m=w?.map;
      if (m?.unitsX>0 && m?.unitsY>0) { experiment.set('mapX',String(m.unitsX)); experiment.set('mapY',String(m.unitsY)); if (!experiment.has('sea') && w.biome===config.biomeId && Number.isFinite(w.seaLevel)) experiment.set('sea',String(w.seaLevel)); }
      else { experiment.set('mapX','4'); experiment.set('mapY','4'); }
    }
    {
      const response=await fetch('config/catalog.json'),data=await response.json(); if (!response.ok) throw new Error(data.error||'Could not read map defaults from the installed content.');
      config.exportCatalog=data; config.defaultSeaLevel=config.exportCatalog.worlds[config.biomeId]?.defaultSeaLevel;
    }
    configureMap(config,experiment); MIN_HEIGHT=config.seaLevel-90; MAX_HEIGHT=config.seaLevel+300;
    if ((!config.map && config.size!==1024) || !Number.isInteger(config.grid) || config.grid<2 || config.grid>(config.map?16384:1024) || !Number.isFinite(config.baseHeight) || !Number.isFinite(config.seaLevel)) throw new Error('Unsupported sculpt configuration.');
    document.querySelector('.canvas-caption h2').textContent=(config.biome||'Green Planet')+' terrain';
    // The world: built-in (the biome itself) or a custom one based on it.
    // Its remembered settings come before the biome's own defaults.
    loadWorlds();
    worldId=experiment.has('world') && worlds[experiment.get('world')]?.base===config.biomeId?experiment.get('world'):config.biomeId;
    config.presetDefaults={...config.defaults};
    config.defaults={...config.defaults,...(worlds[worldId]?.knobs||{})};
    if (worldId!==config.biomeId) document.querySelector('.canvas-caption h2').textContent=worlds[worldId].name+' terrain';
    addDefaults(experiment,config.defaults);
    buildShapeOptions();
    for (const kind of Object.keys(HELP)) toolSettings[kind]=toolDefaults(kind);
    showTool(toolSettings[tool]);
    // The surface sliders open at the world's material values; the address may set the ring's three (a world's own fringe settings, 0..1).
    for (const [id,value] of Object.entries(surfaceSliders(config,experiment))) $(id).value=value;
    for (const [id,hidden] of Object.entries(surfaceGroupsHidden(config))) $(id).hidden=hidden;
    await bootMap();
  } catch (err) { error(err.message); status('The experimental renderer could not start.'); }
}
// Read-only hook for capture tools: the displayed (refined) heights.
// bakeMs and drawMs resolve to milliseconds from submit to GPU completion;
// bakeGpuMs and drawMs's gpuMs are the pass's own GPU time (timestamp queries).
function replayDetail() { flushEval(); return regionalFields.replayDetail(); }
// Repeat check (repro/shapecheck.mjs): two GPU evaluations of this page's scene give identical planes.
async function shapeCompare() {
  const idle=async () => { for (let i=0;i<4000 && regionalFields.pending?.();i++) await new Promise(r => setTimeout(r,10)); };
  return repeatCheck({fields:regionalFields,grid:worldGrid,settle:idle});
}
// H12b: the regional check on the map (sculpt-scene.js regionalCheck; repro/regional.mjs): the paged fields (gpuPages=force) against the shape engine.
function gpuRegionalCheck() {
  return regionalCheck({fields:regionalFields,device:renderer.device,nodes,context:shapeContext(),config,grid:worldGrid,spacing,minH:MIN_HEIGHT,maxH:MAX_HEIGHT,
    startCoarse:() => { if (!pagedCoarseStarted) { pagedCoarseStarted=true; regionalFields.startCoarse().catch(() => {}); } }});
}
// P21: the drainage plane's checks. drainageRun gives a lattice of heights to the GPU passes and reads the plane back; drainageLive waits for the live map's plane to be
// current and reads it back with the heights it came from (repro/drainage.mjs compares both with a CPU reference). The stored plane is also what status() reports.
window.drainageRun=async ({heights,width,sea=-1e30}) => {
  const {computeDrainage}=await import('./sculpt-drainage.js'),h=Float32Array.from(heights),plane=await computeDrainage(renderer.device,{heights:h,width,sea});
  const raw=new Uint32Array(await readBuffer(renderer.device,plane.buffer,0,plane.bytes)),area=new Uint32Array(plane.cells),recv=new Uint32Array(plane.cells);
  for (let i=0;i<plane.cells;i++) { area[i]=raw[2*i]; recv[i]=raw[2*i+1]; }
  const out={area:[...area],recv:[...recv],passes:plane.passes,fillPasses:plane.fillPasses,flatPasses:plane.flatPasses,milliseconds:plane.milliseconds,bytes:plane.bytes}; plane.retire(); return out;
};
window.drainageLive=async () => {
  const {DRAIN_STEP}=await import('./sculpt-drainage.js');
  for (let i=0;i<400&&!(drainage&&drainage.revision===fieldsRevision()&&!drainageBusy);i++) { queueDrainage(); await new Promise(r => setTimeout(r,100)); }
  const d=drainage; if (!d||d.revision!==fieldsRevision()) return {error:'no current plane',weatherOn:weatherOn()};
  const raw=new Uint32Array(await readBuffer(renderer.device,d.buffer,0,d.bytes)),b64=a => { let t='';for (let i=0;i<a.byteLength;i+=8192)t+=String.fromCharCode(...new Uint8Array(a.buffer,a.byteOffset+i,Math.min(8192,a.byteLength-i)));return btoa(t); };
  let heights;
  if (regionalFields.paged) heights=new Float32Array(regionalFields.coarseLattice().heights);
  else { const G=worldGrid,h=new Float32Array(await readBuffer(renderer.device,regionalFields.gpuBuffers().planes,0,G*G*4));heights=new Float32Array(d.cells);for (let j=0;j<d.width;j++) for (let i=0;i<d.width;i++) heights[j*d.width+i]=h[j*DRAIN_STEP*G+i*DRAIN_STEP]; }
  return {width:d.width,cells:d.cells,sea:config.seaLevel,passes:d.passes,fillPasses:d.fillPasses,flatPasses:d.flatPasses,milliseconds:d.milliseconds,bytes:d.bytes,transientBytes:d.transientBytes,paged:Boolean(regionalFields.paged),heights:b64(heights),plane:b64(raw)};
};
window.sculptDebug = {curve:() => currentCurve(),along:() => currentAlong(),place:() => lfPlace,sectionPoint:(side,x,v) => { const cv=$('section-preview'),r=cv.getBoundingClientRect(),L=sectionLayout(curveContext()); return {x:r.left+sideX(L,side,x)*r.width/cv.width,y:r.top+L.yv(v)*r.height/cv.height}; },leanPoint:() => { const cv=$('section-preview'),r=cv.getBoundingClientRect(),L=sectionLayout(curveContext()); return {x:r.left+L.xc*r.width/cv.width,y:r.top+L.yv(0)*r.height/cv.height}; },alongPoint:(t,v) => { const cv=$('along-preview'),r=cv.getBoundingClientRect(),L=alongLayout(curveContext()); return {x:r.left+L.X(t)*r.width/cv.width,y:r.top+L.yv(v)*r.height/cv.height}; },pageInfo:() => regionalFields?.pageInfo?.()??null,shapeCompare,shape:() => ({fields:regionalFields?.stats?.().gpuShape??null,fieldsReason:regionalFields?.reason?.()??null}),corner:(x,y) => regionalFields?{eroded:sampleRegional(x,y),authored:regionalFields.sample(x,y)}:null,regionalCheck:gpuRegionalCheck,state: () => ({tool, stroke: Boolean(stroke), moving: Boolean(moving), selected, pointerId, pan: Boolean(pan)}), bakeMs: (quality='full') => renderer.timeBake(quality), get bakeGpuMs() { return renderer.lastBakeGPU; }, get specStats() { return renderer.specStats && {...renderer.specStats, cached: renderer.specCache.size, key: renderer.specKey().key}; }, get engine() { return renderer.engine; }, get startupMs() { return renderer.startupMs; }, remakeMaterials: () => renderer.makeMaterials(), readGenerated: (layer, level) => renderer.readGenerated(layer, level), get startupParts() { return renderer.startupParts; },
  drawMs: (quality='full') => renderer.timeDraw({quality,clay:$('clay').checked,light:$('light').value,detail:Number($('relief').value)/100,ring:Number($('mineral-ring').value)/100,ringSpread:Number($('ring-spread').value)/100,ringVariation:Number($('ring-variation').value)/100,materialWeathering:Number($('material-weathering').value)/100,transitionDetail:Number($('transition-detail').value)/100}),
  scene: scriptedScene, // replayAll: the worst difference in heights or any painted mask between the fields as edited and a full replay of every node.
  replayAll: () => Math.max(...Object.values(replayDetail())),
  // replayDetail: the same, per field key (h, then the mask planes).
  replayDetail,
  // sketch and loadSketch round-trip a recipe.
  sketch: () => JSON.parse(JSON.stringify(sketch())), loadSketch: s => { loadSketch(s); }, nodes: () => JSON.parse(JSON.stringify(serializeNodes())), get biome() { return config.biomeId; }, get grid() { return grid; }, get size() { return size; }, get base() { return config.baseHeight; }, get sea() { return config.seaLevel; }};
// H5b: the paged shape planes against the whole-map engine's, over the whole map (4x4 with gpuPages=force): max |d| per plane and the mask steps.
// H10: an optional square rect compares a window (a whole 8x8 map is too large for one readback); the pages are read over the same rect.
window.sculptDebug.pagedShapeCompare=async rect => {
  const eng=await createShapeEngine({device:renderer.device,grid:worldGrid,spacing,baseHeight:config.baseHeight,sea:config.seaLevel,minH:MIN_HEIGHT,maxH:MAX_HEIGHT});
  const out=await eng.run(nodes.slice(),shapeContext(),rect||null),G=rect?rect.x1-rect.x0+1:worldGrid;
  const a={h:out.floats[0],p:out.floats[1],r:out.floats[2],c:out.floats[3],v:out.floats[4],x:out.floats[5],masks:out.masks};
  const rp=await regionalFields.readRect(rect||{x0:0,y0:0,x1:G-1,y1:G-1},{weather:false});
  const b={h:rp.fields.h,p:rp.fields.p,r:rp.fields.r,c:rp.fields.c,v:rp.fields.v,x:rp.fields.x,masks:MASK_KEYS.map(k => rp.fields[k])};
  eng.destroy();
  const cmp=comparePlanes(a,b,G,MASK_KEYS);
  return {planes:Object.fromEntries(Object.entries(cmp.planes).filter(([k,v]) => (v.max||0)>0)),clusterCount:cmp.clusterCount,clusters:cmp.clusters.slice(0,4),allPlanes:Object.keys(cmp.planes).length};
};
// H5b: the pages' Time pass results against the whole-map pass over the same shape (4x4 with gpuPages=force): eroded height and the three packed maps.
window.sculptDebug.pagedWeatherCompare=async () => {
  const G=worldGrid,n=G*G,{erosionOf}=await import('./sculpt-erosion.js'),erosion=await erosionOf(renderer);
  await regionalFields.readRect({x0:0,y0:0,x1:G-1,y1:G-1},{weather:true});
  const eng=await createShapeEngine({device:renderer.device,grid:G,spacing,baseHeight:config.baseHeight,sea:config.seaLevel,minH:MIN_HEIGHT,maxH:MAX_HEIGHT});
  await eng.run(nodes.slice(),shapeContext(),null);
  const p=timeKnobs(renderer);
  const whole=await erosion.runGpu({...p,planes:eng.planes,masks:eng.masks,rateMask:MASK_KEYS.indexOf('ovErosion'),grid:G,size,seaLevel:config.seaLevel});
  const wa=new Float32Array(await readBuffer(renderer.device,whole.weather,0,n*4)),we=new Float32Array(await readBuffer(renderer.device,whole.weather,n*4,n*4)),wm=await Promise.all(whole.maps.map(m => readBuffer(renderer.device,m,0,n*4).then(b => new Uint8Array(b))));
  let maxE=0,maxA=0,nE=0,mapBad=[0,0,0],mapMax=[0,0,0],pages=0,at=null;
  for (const pg of regionalFields.debugPages()) {
    pages++; const C=pg.core,w=new Float32Array(await readBuffer(renderer.device,pg.weather,0,2*C*C*4)),m=await Promise.all(pg.maps.map(b => readBuffer(renderer.device,b,0,C*C*4).then(x => new Uint8Array(x))));
    for (let y=0;y<pg.ch;y++) for (let x=0;x<pg.cw;x++) {
      const i=(pg.y0+y)*G+pg.x0+x,j=y*C+x,de=Math.abs(w[C*C+j]-we[i]),da=Math.abs(w[j]-wa[i]); if (de>maxE) { maxE=de; at=[pg.x0+x,pg.y0+y]; } if (da>maxA) maxA=da; if (de>.01) nE++;
      for (let k=0;k<3;k++) for (let c=0;c<4;c++) { const d=Math.abs(m[k][j*4+c]-wm[k][i*4+c]); if (d>8) mapBad[k]++; if (d>mapMax[k]) mapMax[k]=d; }
    }
  }
  const rect={x0:100,y0:300,x1:699,y1:899},g=await regionalFields.debugGather(rect),gw=600; let gMax=0,gBad=[0,0,0];
  for (let y=0;y<600;y++) for (let x=0;x<600;x++) { const i=(rect.y0+y)*G+rect.x0+x,j=y*gw+x; gMax=Math.max(gMax,Math.abs(g.W[g.n+j]-we[i])); for (let k=0;k<3;k++) for (let c=0;c<4;c++) if (Math.abs(g.maps[k][j*4+c]-wm[k][i*4+c])>8) gBad[k]++; }
  eng.destroy(); whole.weather.destroy(); whole.maps.forEach(b => b.destroy());
  return {gather:{maxE:gMax,mapBad:gBad},pages,maxErodedDiff:maxE,at,over001:nE,maxAuthoredDiff:maxA,mapBytesOver8:mapBad,mapMax};
};
// H5b: the Time pass at two window aprons over the same shape (8x8, say): a second paged object at `other` cells of apron against the live one; max and count of the eroded height differences and the maps.
window.sculptDebug.apronCompare=async other => {
  const B=createPagedFields({worldSize,worldGrid,baseHeight:config.baseHeight,keys:FIELD_KEYS,maskKeys:MASK_KEYS,nodes:() => nodes,device:() => renderer?.device,context:shapeContext,gesture:() => false,apron:other});
  configurePagedTime(B); const A=regionalFields,np=A.pageInfo().np,C=A.core; let maxE=0,over001=0,over01=0,mapBad=0,cells=0,at=null;
  const rd=(b,bytes) => readBuffer(renderer.device,b,0,bytes);
  for (let py=0;py<np;py++) for (let px=0;px<np;px++) {
    const rect={x0:px*C,y0:py*C,x1:Math.min(worldGrid,px*C+C)-1,y1:Math.min(worldGrid,py*C+C)-1};
    await A.readRect(rect,{weather:true}); await B.readRect(rect,{weather:true});
    const pa=A.debugPages().find(q => q.x0===rect.x0&&q.y0===rect.y0),pb=B.debugPages().find(q => q.x0===rect.x0&&q.y0===rect.y0);
    const wa=new Float32Array(await rd(pa.weather,2*C*C*4)),wb=new Float32Array(await rd(pb.weather,2*C*C*4)),ma=await Promise.all(pa.maps.map(b => rd(b,C*C*4).then(x => new Uint8Array(x)))),mb=await Promise.all(pb.maps.map(b => rd(b,C*C*4).then(x => new Uint8Array(x))));
    for (let y=0;y<pa.ch;y++) for (let x=0;x<pa.cw;x++) { const j=y*C+x,d=Math.abs(wa[C*C+j]-wb[C*C+j]); cells++; if (d>maxE) { maxE=d; at=[rect.x0+x,rect.y0+y]; } if (d>.001) over001++; if (d>.01) over01++; for (let k=0;k<3;k++) for (let c=0;c<4;c++) if (Math.abs(ma[k][j*4+c]-mb[k][j*4+c])>8) mapBad++; }
  }
  const gb=B.stats().gpuShape; B.destroy();
  return {apronA:A.apron,apronB:other,cells,maxErodedDiff:maxE,at,over0_001:over001,over0_01:over01,mapBytesOver8:mapBad,pagedMsA:A.stats().gpuShape.weatherMsTotal,pagedMsB:gb.weatherMsTotal,runsA:A.stats().gpuShape.weatherRuns,runsB:gb.weatherRuns};
};
boot();
