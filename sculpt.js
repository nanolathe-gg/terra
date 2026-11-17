import {requestAdapter} from './sculpt-webgpu.js';
import {savedWorld,worldOverrideCount,resetWorldOverrides,copySavedWorld,savedWorldId,sameSavedWorld,worldKeys} from './sculpt-save.js';
import {changedWeatherTiles,invalidateRefinement,refinementValid} from './sculpt-change-map.js';
import {configureMap,mapGeometry,mountMapCanvas} from './sculpt-map.js';
import {mountEditorUI,groupToolControls,mountWorldControlIndex,worldGroup,worldHome,mountColumnPanel} from './sculpt-ui.js';
import {controlRow} from './sculpt-workspace.js';
import {copyColumn,sameColumn,columnTones,toneColor,colorTone} from './sculpt-column.js';
import {materialHeightKey,materialStates,materialColor,recolorMaterial,setMaterial,addMaterial,copyMaterial,copyMaterials,adoptWorldMaterials,withWorldMaterials,worldMaterials,worldOwnMaterials,keptWorldMaterials,mergeWorldMaterials,worldKept,keepStrokeMaterials,materialsInUse,deleteMaterial,surfaceMaterials,materialTint,assignMaterial,MATERIAL_SLOTS,roleOf,roleName,worldKey,LIBRARY} from './sculpt-materials.js';
import {mountMaterialEditor} from './sculpt-material-editor.js';
import {ROCK_PRESETS,ROCK_HEADLINES,ROCK_KEYS,ROCK_SLOTS,copyRockSettings,rockPresetFor,applyWorldRock,copyRocks,worldRocks,worldRockName,keepStrokeRocks,strokeRock,rocksBeneath,rocksInUse,worldRock,recipeRock,rockRecipeFor,addRock,duplicateRock,renameRock,uniqueRockName,setRock,setRockColors,deleteRock,rockRecipeText,parseRockRecipe,giveRockMaterials} from './sculpt-rock-presets.js';
import {KNOBS,applyKnob,createWorldInputQueue,colorRows,pickWorldColor,strokeWaterPicks,slopeReplaced,worldPanelValues as worldPanelValuesOf,waterTone} from './sculpt-knobs.js';
import {shapeControlAvailable,WORLD_CHOICES} from './sculpt-control-schema.js';
import {sectionPreview,FACING_CHOICES,LANDFORM_FORMS,defaultForm,strokeKnots,thinKnots,knotCurve,leanRatio,leanSetup,landformReach,landformSides,landformBackSide,alongKnots,landformElevation,landformGround,landformDigs,landformSteps} from './sculpt-shape-presets.js';
import {strokeKind,shapeFrom,savedToolCard,MASK_KEYS,SHAPE_FIELDS,isCover,strokeParams,sceneNodes,addDefaults,borrowBeach,DEFAULT_SEED,worldSetting as worldSettingIn,worldDefault as worldDefaultIn,shapeDefaults as shapeDefaultsIn,toolDefaults as toolDefaultsIn,strokeCard as strokeCardIn,groundDefaults as groundDefaultsIn,migrateRiver,
  shapeContext as shapeContextIn,worldShapeKey,timeKnobs,SURFACE_SLIDER_IDS,surfaceSliders,drawOptions,materialKnobs as materialKnobsIn,materialRequest,worldHexColors,rendererColors,rgbColor,TIME_SLIDER_IDS,surfaceGroupsHidden,weatheredCell,weatheredHeights,bilinearCells,regionalCheck,repeatCheck,pagedTime,heightsNode} from './sculpt-scene.js';
import {createGpuFields,createPagedFields,createShapeEngine,comparePlanes,readBuffer,setFailureHandler,LAYER_MEANDER,lfcWidth,heightsBounds} from './sculpt-gpu-fields.js';

import {shapePaths,clonePaths,pathsWithin,simplifyPath,validatePaths,appendPath,extendPoint,insertPoint,removePoint,removePath} from './sculpt-paths.js';
import {selectionTransform,toggleSelection} from './sculpt-selection.js';
import {shareText,gzipText,shareUrl,mapIdFromSearch,withoutMap,mapsService,postMap,getMap,keepPrevious,takePrevious,dropPrevious} from './sculpt-share.js';
import {isRiver,pointsSignature} from './sculpt-river.js';
import {HELP_TOOLS} from './sculpt-help-examples.js';
import {copySurface,layerKey,withSurfaceMaterials} from './sculpt-material-model.js';
import {mountSurfacePanel,BUILTIN_LABELS} from './sculpt-surface-panel.js';
import {goTo} from './sculpt-find.js';
import {mountPick} from './sculpt-pick.js';
import {worldKit,sameKitData,assertKitMaterials,authoredWorldTool,newWorldKey,instantiateWorldKit,stageWorldKitEdit,publishWorldRock,publishWorldTool,addWorldRockInstance,resetWorldKitInstances,resolvedWorldCard,worldToolUnavailable} from './sculpt-world-kit.js';
import {TOOL_ICONS,LANDFORM_TOOL,FIXED_TOOLS,toolShape,worldTools,toolRockSlot,toolMaterialSlot,strokeTool,keepStrokeTools,inferStrokeTools,carryStrokes,markEdited,copyMapTools,addMapTool,deleteMapTool,MAP_TOOLS_MAX} from './sculpt-tools.js';
const editorUI=mountEditorUI();
let syncWorldControls=()=>{},panelPicks='',syncToolGroups=()=>{},pathEditing=false,pathPoint=-1,pathIndex=0,pathAdding=false,drawMode='new';
// Pick (sculpt-pick.js): whether the Pick tool is in hand (it stands in for `tool`, which it leaves as it was), and its card.
let picking=false,pickCard=null;

// Offline authoring policy. These brushes are new geometry, not retail rules.
const $ = id => document.getElementById(id);
const canvas = $('terrain'), overlay = $('overlay');
const experiment = new URLSearchParams(location.search);
// DEVELOPMENT CONVENIENCE (owner request, revisit before release): one working map per browser, whatever the world or map.
// It reloads on every page load and a world switch carries its strokes into the new world (see carryNodes). Scratch pages keep none.
const LOCAL_KEY = experiment.has('scratch')?null:'terraform-working-map-v1';
let MIN_HEIGHT = -90, MAX_HEIGHT = 300;
const HELP = {
  // The shape tools draw landforms: the path is the crest, the section across it is one curve shaped on both sides, the ground is raised, cut or flattened
  // to an elevation, and a second curve sets the crest's height along the path. Each tool starts from its shape as the world makes it (keyed here by shape;
  // a world's tool reads its shape's); every setting stays editable.
  landform:'Draw a landform from the model\'s own starting numbers: a level-topped rise at the elevation you set. Every landform setting below is yours to shape, so it can draw anything the other shape tools draw.',
  plateau:'Draw a landform that starts as a plateau: a level top at the elevation you set, with a natural foot. Change any setting below.',
  hill:'Draw a landform that starts as a rounded ridge: a short steep face and a long smooth back along the path. Change any setting below.',
  mountain:'Draw a landform that starts as a peaked ridge: a narrow crest with no flat summit. Change any setting below.',
  ramp:'Draw a landform that starts as a ramp: the ground is flattened to a grade that climbs from the plain at the start of the path to the elevation at its end (shape the climb in the along curve), and its center is kept smooth.',
  deep:'Draw a landform that starts as deep water: the ground is cut to 55 below sea level behind a smooth bank. Its light water near the bank is mostly deeper than vehicles and KBots can wade (12): draw Shallow water where they should cross. Shore lobes, steps and plates are in their own groups.',
  shallow:'Draw a landform that starts as shallow water: a level bed 7 below sea level, shallow enough for vehicles and KBots to wade across (up to 12 deep), behind a gentle bank. For a ford, start and end the path on dry land. Choose Raise to in Combine for a passage that leaves higher ground as it is.',
  valleyV:'Draw a landform that starts as a V valley: the ground is cut down to a floor on the path, and the walls rise at one slope, as a river leaves them. Choose any setting below; the Time pass settles walls steeper than the ground can stand.',
  valleyU:'Draw a landform that starts as a U valley: the ground is cut down to a flat floor with steep upper walls, as a glacier leaves it.',
  river:'Draw a river: a valley landform whose path is migrated by the curvature rule real rivers follow, so the line you draw grows bends that travel downstream, within Wander px of where you drew it (at most four channel widths); a loop drawn closed leaves an oxbow. Width is the channel (at least 32 px, so ships can use it). The bank is cut steep on the outside of each bend, a sand bar builds inside it, and pools and riffles follow the bends. Draw a long gentle line; Cut to sets the floodplain relative to the sea.',
  braided:'Draw a braided river: a mostly dry bed of gravel bars just above the sea, which units cross, with thin threads of water that split and rejoin around the bars; grass grows back on the older, higher bars. Size sets the size of the bars and of the bed (the bed reaches about two widths either side of the line), so raise it to widen the bed. Wander lets the whole bed stray from the line you draw, in px, as a river\'s channel does (0 keeps it as drawn).',
  valleyT:'Draw a landform that starts as a terraced valley: a V valley whose walls climb in flat treads, the levels a river left as it cut down.',
  smooth:'Blend the starting surface toward its local average. Repeat a new stroke for more smoothing.',
  crystal:'Draw a landform broken into crystal facets: a click grows a cluster round the point, a drag a row or ridge of them along the path. The section and along curves set how high they stand across and along it, and Facet shape picks prisms or stepped columns; their size, coverage, sides and tops are in Facets.',
  sand:'Paint sand cover: the ground under the brush becomes sand (on slopes too, so a hill set in sand has sandy feet). Heights do not change.',
  grass:'Paint ground cover: clears sand (painted or weathered) back to the world\'s own ground, such as grass. Heights do not change.',
  paint:'Paint a material over the ground, or a scatter density: rock showing through, snow or ice, wet (dark) ground and moss take the world\'s own materials; denser or sparser scatter multiplies the World panel\'s Boulders and Debris (at 0 nothing shows). Strength is how fully it paints, Softness the edge. Heights do not change.',
  fissure:'Cut a fissure along the stroke, or (Mode 1) a network of cuts over its footprint. Branches, jaggedness, width and depth are brush options; the world\'s own crack field is raised along the cut.',
  erase:'Paint plain ground: hills, water, craters, cracks, painted masks and style under the brush return to the dry base level, with a natural edge.',
  crater:'Strike a crater: a bowl dug into the ground where you click, a raised rim and secondaries. Drag to aim the impact: a short drag throws them downrange, a drag longer than the crater stretches it along the drag.',
  move:'Drag to move · Shift-click adds or removes shapes · Shift + drag for height · Shift snaps rotate / scale · P: path · V: transform · arrows: nudge · Shift F: focus canvas'
};
let mapUpdate=() => {},mapFeatures=null,mapMetadata=null,mapRevision=0;
const mapData=() => ({...mapFeatures?.serialize(),...mapMetadata?.serialize()});
function restoreMapData(data={}) { mapFeatures?.load(data||{}); mapMetadata?.load(data||{}); mapRevision++; }
function mapChanged() { mapRevision++; checkpoint(true); schedule(false); }
let config, renderer, grid, size, spacing, services;
// A world's configuration file, by the same relative path on a static host and on the Go server: config/<world>.json.
const configUrl=world=>`config/${encodeURIComponent(world)}.json`;
let defaultColumn, columnOverride=null, columnEditing=false, syncColumnPanel=()=>{};
// Rock presets (B2): the map's own rocks in slots 1-15 (sculpt-rock-presets.js); slot 0 is the world's rock, its flat settings and column.
let mapMaterials=[], materialUseKey='[]',materialEditor=null;   // the map's materials (sculpt-materials.js): its ground, its water and those strokes may choose
let mapRocks=[], rockUseKey='[]', rockSelected=0;   // rockSelected: the preset the World pane's rock settings edit (0 the world's own)
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
const TOOL_FIELDS={cracks:['cracks',0,100],diameter:['diameter',16,1200],amount:['amount',-80,160],roughness:['roughness',0,100],softness:['softness',0,100]};
for (const [key,id,,,lo,hi] of SHAPE_FIELDS) TOOL_FIELDS[key]=[id,lo,hi];
const worldSetting=key => worldSettingIn(config,experiment,key);
const worldDefault=key => worldDefaultIn(config,key);
const shapeDefaults=() => shapeDefaultsIn(config);
const nodeShapeParams=n => {const q={...shapeDefaults(),...n.params};return n.kind==='landform'?landformSteps(q):q;};
const shapeValue=key => { const f=SHAPE_FIELDS.find(f => f[0]===key); return Number($(f[1]).value)/f[7]; };
// A shape control set from a tool's or a stroke's numbers. A choice its list no longer holds (a rock preset deleted since the tool last used it)
// shows and reads as the list's first choice, Rock beneath: an empty select would read as 0, the world's rock.
const setShapeControl=(id,v) => { const e=$(id); e.value=v; if(e.selectedIndex===-1)e.selectedIndex=0; };
function buildShapeOptions() {
  // Each option row is built for its section or part of the card (sculpt-ui.js groupToolControls). The section and along-path
  // editors are the page's own (#section-preview-control, in the card's Profile section).
  syncToolGroups=groupToolControls(SHAPE_FIELDS,([key,id,label,,lo,hi,step,,help,choices]) => {
    if(key==='fissureNetwork')choices=[[0,'Path cut'],[1,'Fracture network']];
    if(key==='plateMaterial')choices=[[1,'Polygonal slabs'],[2,'Needle band']];
    // A label's parenthetical (its unit, or what it measures) is said by the hover help, not the row.
    const note=/ \(([^)]*)\)$/.exec(label),words=note?label.slice(0,note.index):label;
    const wrap=controlRow({id,label:`${words} <output id="${id}-value"${choices?' hidden':''}></output>`,range:`min="${lo}" max="${hi}" step="${step}"`,choices,select:' style="width:100%"',help});
    wrap.id=id+'-control'; if(note)wrap.dataset.note=note[1];
    // The Rock row names the rock type the shape is drawn in, with its color, and opens its settings (syncCardRock).
    if(key==='rockPreset'){const drawn=document.createElement('div');drawn.className='card-partner rock-drawn';drawn.id='lf-rock-drawn';
      drawn.innerHTML='<span class="rock-swatch" id="lf-rock-swatch"></span><span class="card-partner-text"><b id="lf-rock-name"></b> <span id="lf-rock-note"></span></span><button type="button" class="card-link" id="lf-rock-edit">Edit</button>';wrap.append(drawn);}
    return wrap;
  });
  $('lf-rock-edit').onclick=() => { const {slots}=cardRock(); openRockType(slots.length===1?slots[0]:null); };
  $('lf-rock').addEventListener('change',followCardRock);
  $('cracks-look').onclick=() => { const {slots}=cardRock(); openRockType(slots.length===1?slots[0]:null,'cracks-bands'); };
  $('curve-form').addEventListener('change',() => { const f=$('curve-form').value; setCurve(f?{form:f}:null); if (selected>=0) { checkpoint(); queueWeather(); } });
  $('curve-reset').addEventListener('click',() => { const c=currentCurve(); setCurve(c?.form?{form:c.form}:null); if (selected>=0) { checkpoint(); queueWeather(); } });
  $('along-reset').addEventListener('click',() => { setCurve(null,'along'); if (selected>=0) { checkpoint(); queueWeather(); } });
  $('curve-link').addEventListener('click',() => { toggleLink(); if (selected>=0) { checkpoint(); queueWeather(); } });
  $('curve-mirror').addEventListener('click',() => { mirrorSides(); if (selected>=0) { checkpoint(); queueWeather(); } });
  curveEditorEvents(); alongEditorEvents(); curveNumberEvents();
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
// The card's Rock row adding a rock type (syncRockChoices' "add:" choices): added first, so the row's own input handler gives the shape the new slot, and
// its change handler's checkpoint holds both in one undo step.
document.addEventListener('input',event => {
  const select=event.target;if(select.id!=='lf-rock'||!select.value.startsWith('add:'))return;
  try{const slot=addRockType(select.value.slice(4));select.value=String(slot);if(selected<0)checkpoint(true);}catch(err){status(err.message);select.value='-1';}
},true);
const clamp=(v,a,b) => Math.max(a,Math.min(b,v));
// Rounded authored knots preserve a long shoulder and a short exposed face.
// Zero slope at the crown avoids the knife edge of a skewed power-law dome.
setFailureHandler(err => error(err?.message??String(err)));
function error(message='') { $('error').textContent=message; $('error').hidden=!message; }
// A load's note about the features it left out (sculpt-features.js) rides along with the load's own message, once.
let featureNotice='';
function status(message) { $('status').textContent=featureNotice&&message!==featureNotice?message+' '+featureNotice:message; if(message!==featureNotice)featureNotice=''; }
// Height slider range per shape kind; Raise / lower is signed.
const amountRange=kind => kind==='fissure'?[2,60]:['smooth','sand','grass','paint'].includes(kind)?[5,100]:[5,160];
function toolDefaults(entry,preset=config?.biomeId||'green') { return toolDefaultsIn(config,entry,preset); }
// The toolbar's shape tools (sculpt-tools.js): the generic Landform button, the world's own, then the map's own (`own`: Save as tool; a load passes the list it
// is about to open). A tool id names a fixed button (its stroke kind) or one of these.
let worldToolList=null,currentWorldKit=null,brushWorldDefinitions=[],mapTools=[];   // the world's tools, checked once its config is in; the map's
const shapeTools=(own=mapTools) => [LANDFORM_TOOL,...(worldToolList??=worldTools(config)),...own];
const toolById=(id,own=mapTools) => shapeTools(own).find(t => t.id===id);
const toolIds=(own=mapTools) => new Set([...FIXED_TOOLS,...shapeTools(own).map(t => t.id)]);
// What a tool draws: its shape (a stroke kind for the fixed buttons; a world's own shape names its library shape by `from`), the library shape under it,
// and that shape's stroke kind.
const entryOf=id => { const t=toolById(id); return t?toolShape(t):id; };
const baseOf=id => shapeFrom(config,entryOf(id));
const toolKind=id => strokeKind(baseOf(id));
// A tool's help line: its own (a world's tool may carry one), else its library shape's.
const toolHelpLine=id => toolById(id)?.help??HELP[baseOf(id)];
// A tool's shape as world `preset` makes it, with the rock and ground material the tool names (toolRockSlot, toolMaterialSlot); a tool's starting
// card: that, or a map tool's own card.
function shapeCard(id,preset=config?.biomeId,tables) {
  const t=toolById(id),card=toolDefaults(entryOf(id),preset),slot=toolRockSlot(t,tables?.rocks??mapRocks,config.rock?.recipe),ground=toolMaterialSlot(t,tables?.materials??mapMaterials);
  if (slot!==undefined) card.rockPreset=slot;
  if (ground!==undefined) card.groundPreset=ground;
  return card;
}
const mapOwnsTool=t=>mapTools.some(m=>m.id===t?.id);
const toolUnavailable=t=>worldToolUnavailable(t,mapRocks,mapMaterials,config,currentWorldKit??{rocks:[]});
const toolCard=(id,own=mapTools,tables) => { const t=toolById(id,own); return authoredWorldTool(t)?resolvedWorldCard(t,tables?.rocks??mapRocks,tables?.materials??mapMaterials,config):t?.card?structuredClone(t.card):shapeCard(id,config?.biomeId,tables); };
function refreshWorldKit(world=activeWorld()){currentWorldKit=worldKit(baseWorldConfig??config,world);worldToolList=currentWorldKit.tools;}
function installWorldKit(kit){const checked=worldKit(baseWorldConfig??config,kit);activeWorld().tools=checked.tools;activeWorld().rocks=checked.rocks;worldStoreDirty=true;currentWorldKit=checked;worldToolList=checked.tools;}
function refreshWorldTools(world=activeWorld()){
  const previous=brushWorldDefinitions;refreshWorldKit(world);
  for(const id of Object.keys(toolSettings))if(id.startsWith('world-')){const before=previous.find(t=>t.id===id),after=worldToolList.find(t=>t.id===id);if(!after||!before||!sameKitData(before.card,after.card)||before.shape!==after.shape)delete toolSettings[id];}
  for(const t of worldToolList){toolSettings[t.id]??=toolCard(t.id);if(authoredWorldTool(t)){const resolved=resolvedWorldCard(t,mapRocks,mapMaterials,config);if(t.rock)toolSettings[t.id].rockPreset=resolved.rockPreset;if(t.ground)toolSettings[t.id].groundPreset=resolved.groundPreset;}}
  brushWorldDefinitions=structuredClone(worldToolList);
  if(!toolIds().has(tool)){tool=LANDFORM_TOOL.id;showTool(toolSettings[tool]??toolCard(tool));}
  buildToolbar();syncRockAdd();
}
function keepWorldKit(before=mapMaterials){
  if(worldStoreTransaction||!currentWorldKit)return;
  const captured=stageWorldKitEdit(config,currentWorldKit,mapRocks,mapMaterials,{before});mapMaterials=captured.materials;
  if(!sameKitData(captured.kit,currentWorldKit)){installWorldKit(captured.kit);}
}
function commitKitCandidate(candidate){
  const checked=worldKit(baseWorldConfig,candidate.kit);instantiateWorldKit({...config,worldMaterials:worldOwnMaterials(candidate.materials,config)},checked);
  installWorldKit(checked);mapRocks=candidate.rocks;mapMaterials=candidate.materials;refreshWorldTools();syncMaterialChoices();syncRockChoices();syncRocks();syncMaterials();
}

// A save's card for a tool: one still on a world's preset is that preset as this editor has it (with the tool's rock); otherwise savedToolCard.
const savedCard=(id,card) => card && Object.hasOwn(config.worldShapes||{},card.preset)?shapeCard(id,card.preset):savedToolCard(config,entryOf(id),card);
const toolLabel=id => toolById(id)?.label;
const firstTool=() => shapeTools().slice(1).find(t=>!toolUnavailable(t))?.id??LANDFORM_TOOL.id;
// The shape buttons, built from the world's list into their groups (the one exception to the page's layout living in index.html): each a copy of its icon
// from the set (Save as tool's icon choices in index.html, #tool-save-icons), its id in data-tool as every check clicks it, its shape in data-shape for the hover help.
function buildToolbar() {
  const icon=name => $('tool-save-icons').querySelector(`[data-icon-choice="${name}"] svg`).cloneNode(true);
  const button=t => {
    const b=document.createElement('button');
    b.dataset.tool=t.id; b.dataset.shape=shapeFrom(config,toolShape(t)); if (t.help) b.dataset.help=t.help; b.setAttribute('aria-pressed','false'); b.setAttribute('aria-label',t.label); b.title=t.label;
    b.style.setProperty('--tool-color',t.color); b.disabled=true;b.dataset.unavailable=toolUnavailable(t);if(b.dataset.unavailable)b.title=b.dataset.unavailable;
    if (!t.card && HELP_TOOLS.includes(b.dataset.shape)) { const pic=new Image(); pic.className='tool-pic'; pic.loading='lazy'; pic.alt=''; pic.src=`ui-previews/tool-${b.dataset.shape}.png`; b.append(pic); }
    const name=document.createElement('span'); name.className='tool-name'; name.textContent=t.label; b.append(icon(t.icon),name);
    if (t.card) b.dataset.mapTool='';   // a map's own: its hover shows its shape's sketch, not the shape's rendered example
    return b;
  };
  // Land: the world's tools under their families' headings (each tool's family), the families in the order they first come in the world's
  // list and a tool without one in a last group; then index.html's Generic group (Landform, Fissure); then this map's own tools under theirs.
  const land=shapeTools().slice(1).filter(t => t.group==='shape'),families=new Map();
  for (const t of land.filter(t => !mapOwnsTool(t))) { const f=t.family??''; if (!families.has(f)) families.set(f,[]); families.get(f).push(t); }
  $('shape-tools').replaceChildren(...[...families.keys()].sort((a,b) => (a==='')-(b==='')).map(f => {
    const g=document.createElement('div'),head=document.createElement('span'); g.className='tool-family'; g.setAttribute('role','group'); g.setAttribute('aria-label',f||'Other');
    head.className='tool-family-label'; head.setAttribute('aria-hidden','true'); head.textContent=f||'Other'; g.append(head,...families.get(f).map(button)); return g;
  }));
  $('map-shape-tools').replaceChildren(...land.filter(t => mapOwnsTool(t)).map(button));
  $('map-shape-tools').closest('.tool-family').hidden=!land.some(t => mapOwnsTool(t));
  $('water-tools').replaceChildren(...shapeTools().slice(1).filter(t => t.group==='water').map(button));
  // A toolbar with no water tool (a world without water) shows no Water group.
  $('water-tools').closest('.tool-group').hidden=!shapeTools().some(t => t.group==='water');
  // The shape card's Look: the same tools, by group (#tool-look).
  const look=$('tool-look'),value=look.value,group=(label,list) => { const g=document.createElement('optgroup'); g.label=label; g.append(...list.map(t => {const o=new Option(t.label,t.id),why=toolUnavailable(t);o.disabled=Boolean(why);o.title=why;return o;})); return g; };
  look.replaceChildren(...[['Land',t => t.group!=='water' && !mapOwnsTool(t)],['Water',t => t.group==='water' && !mapOwnsTool(t)],['This map’s tools',t => mapOwnsTool(t)]].map(([label,test]) => group(label,shapeTools().filter(test))).filter(g => g.childElementCount));
  look.value=value;
}
// The map's tools replaced (Save as tool, Delete, undo, a load or a scene): the toolbar and the cards follow, and a selected tool that is gone gives way to
// Landform. `fresh` gives every map tool its own card again (another map's tools may have had these ids).
function restoreMapTools(list,fresh=false) {
  mapTools=structuredClone(list);
  for (const id of Object.keys(toolSettings)) if (id.startsWith('map-') && (fresh || !mapTools.some(t => t.id===id))) delete toolSettings[id];
  for (const t of mapTools) toolSettings[t.id]??=toolCard(t.id);
  if (!toolIds().has(tool)) { tool=LANDFORM_TOOL.id; showTool(toolSettings[tool]); }
  buildToolbar();
}
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
function showTool(state={},kind=toolKind(tool)) {
  heightControlRange(state);stepControlRange(kind,state);
  [$('amount').min,$('amount').max]=amountRange(kind).map(String);
  for (const [key,[id,lo,hi]] of Object.entries(TOOL_FIELDS)) if (Number.isFinite(state[key])) setShapeControl(id,clamp(state[key],lo,hi));
  $('tool-style').value=Object.hasOwn(config.worldShapes||{},state.preset)?state.preset:'custom';
}
// The Defaults from world menu (#tool-style) lists the worlds that make the shape a landform tool draws (every world, for the other buttons).
function syncToolStyle(id) {
  const shape=entryOf(id),land=toolKind(id)==='landform';
  for (const o of $('tool-style').options) if (o.value!=='custom') o.hidden=land && !Object.hasOwn(config.worldShapes?.[o.value]||{},shape);
}
// The footer's help line. A tool's help shows its first sentence there, so the line ends on a whole sentence at the editor's width; the whole
// text is the line's hover title (a tool's hover card says what the shape is, not how to draw it). The feature hints fit as they are, and
// repeat the Features card's text.
const firstSentence=text => /^[\s\S]*?[.!?](?=\s+[A-Z(]|$)/.exec(text)?.[0]??text;
function setToolHelp(text,first=false) { const line=$('tool-help'); line.textContent=first?firstSentence(text):text; line.title=text; }
function updateControls() {
  if(ready&&!stroke&&!moving){const why=toolUnavailable(toolById(tool));if(why){tool=LANDFORM_TOOL.id;showTool(toolSettings[tool]??toolCard(tool));status(why);}}
  const picks=JSON.stringify([strokeWaterPicks(nodes),slopeReplaced(panelFacts())]);if(picks!==panelPicks){panelPicks=picks;syncWorldControls();}   // a stroke's water choice, or the transition replacing the slope color, wakes or idles world rows
  syncWorldHome();
  const featureActive=Boolean(mapFeatures?.active);
  for (const b of document.querySelectorAll('[data-tool]')) b.setAttribute('aria-pressed',String(!featureActive&&!picking&&b.dataset.tool===tool));
  $('feature-tool').setAttribute('aria-pressed',String(featureActive&&mapFeatures.mode!=='starts'));$('starts-tool').setAttribute('aria-pressed',String(featureActive&&mapFeatures.mode==='starts'));
  $('feature-tool-host').hidden=!featureActive;
  // Pick shows no tool's settings, only a selected shape's card (its Shape settings door).
  $('brush-panel').hidden=featureActive||(tool==='move'&&!nodes[selected]?.params)||(picking&&!nodes[selected]?.params);
  $('edit-path').setAttribute('aria-pressed',String(pathEditing));
  $('transform-mode').setAttribute('aria-pressed',String(!pathEditing&&drawMode!=='add'));
  const selectedNode=nodes[selected],hasSelection=Boolean(selectedNode?.points?.length),selectionActive=hasSelection&&tool==='move'&&!featureActive;
  // Generated features share the Select tool (sculpt-features.js): their values replace the shape's transform rows while any is selected.
  const featureSelection=!featureActive&&tool==='move'&&(mapFeatures?.selectionCount||0)>0;
  // The side panel's Selection block is the Select tool with no shape selected: its hint, or the selected features' values. A selected
  // shape's own actions are the bar on the map (#selection-hud) and the head of its card.
  $('selection-panel').hidden=featureActive||picking||tool!=='move'||(hasSelection&&!featureSelection);
  $('feature-selection').hidden=!featureSelection;$('shape-selection-actions').hidden=!selectionActive;
  $('selection-empty').hidden=hasSelection||featureSelection;
  $('path-actions').hidden=$('path-row').hidden=!pathEditing||!hasSelection;
  $('transform-controls').hidden=pathEditing||!hasSelection||drawMode==='add';
  $('selection-hud').hidden=!selectionActive||featureSelection;   // selecting a feature deselects shapes (sculpt-features.js) and a shape clears the features: one or the other
  $('selection-hud').classList.toggle('path-mode',pathEditing);
  $('selection-mode').textContent=selectionActive?`${drawMode==='add'?'Add path · ':pathAdding?'Extend / branch · ':''}${shapeName(selected)}${selectedShapes().length>1?` + ${selectedShapes().length-1} more`:''}`:'';
  for(const id of ['selection-delete','transform-mode','canvas-deselect'])$(id).disabled=!hasSelection||loading||Boolean(stroke||moving);
  for(const id of ['toggle-tools','toggle-inspector','focus-canvas'])$(id).disabled=loading||Boolean(stroke||moving);
  const transform=hasSelection?selectionTransform(selectedNode).values:null;
  for(const key of ['x','y','rotation','scale']){const input=$('selection-'+key);input.disabled=!hasSelection||loading||Boolean(stroke||moving);if(document.activeElement!==input)input.value=transform?String(Math.round(transform[key]*10)/10):'';}
  $('selection-numbers-summary').textContent=transform?`X ${Math.round(transform.x)} · Y ${Math.round(transform.y)} · ${Math.round(transform.rotation)}° · ${Math.round(transform.scale)}% ▾`:'Numbers ▾';
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
  $('draw-add').setAttribute('aria-pressed',String(drawMode==='add'));
  $('edit-path').disabled=!hasSelection||locked;
  $('path-add').disabled=!pathEditing||pointAt<0||pointAt===activePath.length-1||locked;
  $('path-delete').disabled=!pathEditing||pathPoint<0||(selectedNode?.points?.length??0)<=1||locked;
  $('path-extend').disabled=!pathEditing||pathPoint<0||locked;
  $('path-extend').setAttribute('aria-pressed',String(pathAdding));
  $('path-remove').disabled=!pathEditing||paths.length<=1||locked;
  if(pathEditing){$('shape-path-list').replaceChildren(...paths.map((path,i)=>{const b=document.createElement('button');b.textContent=`Path ${i+1} · ${path.length} points`;b.setAttribute('aria-pressed',String(i===pathIndex));b.disabled=locked;b.onclick=()=>{pathIndex=i;pathPoint=-1;pathAdding=false;updateControls();schedule();};return b;}));}
  for(const id of ['rotate-left','rotate-right','scale-down','scale-up'])$(id).disabled=!nodes[selected]?.points||locked;
  $('view-clay').setAttribute('aria-pressed',String(!$('view-passability').matches('[aria-pressed=true]')&&$('clay').checked));
  $('view-rendered').setAttribute('aria-pressed',String(!$('view-passability').matches('[aria-pressed=true]')&&!$('clay').checked));
  for(const id of ['new-map','save','load','view-clay','view-rendered','view-passability','blank'])$(id).disabled=!ready||loading||Boolean(stroke||moving);
  const pointCount=nodes[selected]?.points?.length||0;
  $('path-help').textContent=pathEditing?pathAdding?'Click to extend from the selected point. An interior point starts a branch. Escape finishes.':`${paths.length} path${paths.length===1?'':'s'} · ${pointCount} points${pathPoint>=0?' · point '+(pathPoint+1)+' selected':''}. Select a point to insert, extend, or branch.`:'Drag to move · labeled handles rotate / scale · Shift snaps handles · arrow keys nudge.';
  // With Select active, show the selected shape's own controls; a palette entry shows its stroke kind's (the shape buttons draw landforms).
  const activeTool=tool,entry=tool==='move'?(nodes[selected]?.params?nodes[selected].kind:'move'):tool,kind=toolKind(entry),ids=toolIds();
  {
  heightControlRange({heightReference:shapeValue('heightReference')});stepControlRange(kind,{stepReference:shapeValue('stepReference')});
  $('lf-elevation-control').querySelector('label').firstChild.textContent=shapeValue('heightReference')===1?'Height above sea ':shapeValue('heightReference')===2?'Height above ground ':'Height ';
  const fixed=['erase','landform'].includes(kind);
  $('amount-control').hidden=fixed;
  $('amount-label').textContent=kind==='smooth' || isCover(kind)?'Strength':kind==='fissure'?'Depth':'Rise';
  const [lo,hi]=amountRange(kind); $('amount').min=String(lo); $('amount').max=String(hi);
  $('amount').value=String(clamp(Number($('amount').value),lo,hi));
  const amountNow=Number($('amount').value);
  $('amount-value').textContent=kind==='smooth' || isCover(kind)?amountNow+'%':'+'+amountNow;
  $('diameter-value').textContent=$('diameter').value+' px';
  $('roughness-value').textContent=$('roughness').value+'%';
  $('roughness-label').textContent=['erase','sand','grass','paint'].includes(kind)?'Edge freedom':'Roughness';
  // A fissure's outline is its own jaggedness; Roughness would do nothing.
  $('roughness').closest('.control').hidden=kind==='fissure'||kind==='landform';
  $('softness-control').hidden=!['erase','sand','grass','paint'].includes(kind);
  $('cracks-control').hidden=kind!=='landform';
  $('cracks-value').textContent=$('cracks').value+'%';
  syncCardRock(kind);
  // Spur and gully details show once their switch (spurs, gullies) is on.
  const gate={gullySize:'gullies',talus:'gullies',layerPx:'shoreLayers',layerRiser:'shoreLayers',layerLedge:'shoreLayers',layerRough:'shoreLayers',layerStyle:'shoreLayers',layerVary:'shoreLayers',layerJag:'shoreLayers',layerCircle:'shoreLayers',iceFacetSize:'iceFacets',fingerSize:'fingers',spurLength:'spurCount',spurSpread:'spurCount',spurWidth:'spurCount',spurTaper:'spurCount',spurHeight:'spurCount',spurForks:'spurCount',spurBulb:'spurCount',crestVary:'spurCount',fissureBranchLen:'fissureBranches',fissureBranchSpread:'fissureBranches',lavaSpread:'shoreLayers',lavaCircleVary:'shoreLayers'};
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
  $('lf-ground-control').hidden=!(kind==='landform'||kind==='paint'&&shapeValue('paintChannel')===26); syncGroundChips(kind);
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
  { const id=tool==='move'&&nodes[selected]?.params?strokeTool(nodes[selected],ids):entry; syncToolStyle(id); $('tool-style').value=toolSettings[id]?.preset||'custom';
    $('tool-look-control').hidden=!toolById(id); if (toolById(id)) $('tool-look').value=id; }
  setToolHelp(toolById(entry)?.card?`Draw a landform with the settings, curves and rock of ${toolLabel(entry)}, a tool saved ${mapOwnsTool(toolById(entry))?'in this map':'in this world'}. Change any setting below.`:toolHelpLine(entry)||'',true);
  { const can=ready && resettable(); $('reset-strokes').disabled=!can; $('reset-strokes').title=can?'':'Draw a shape first: there is nothing to reset.'; }
  $('undo').disabled=!ready || Boolean(stroke||moving) || historyIndex<=0;
  $('redo').disabled=!ready || Boolean(stroke||moving) || historyIndex>=history.length-1;
  $('export').disabled=!canExport(); mapUpdate();
  const view=mapCanvas?.view();$('fit').setAttribute('aria-pressed',String(view?view.overview:true));$('one').setAttribute('aria-pressed',String(view?!view.overview&&view.scale===1:false));
  }
  if (tool==='move') { setToolHelp(pathAdding?'Click to add an attached point · Escape finishes · shared junctions move together':drawMode==='add'?'Draw another path in the selected shape · start on a point to attach it · paths join without adding height':HELP.move,true); $('amount-control').hidden=selected<0 || ['erase','landform'].includes(nodes[selected]?.kind); }
  // Say what the brush controls change: the next stroke, or a selected shape.
  const editing=selected>=0 && nodes[selected]?.params;
  $('brush-panel').classList.toggle('editing',Boolean(editing));
  // A selected shape's card carries its name; a drawing tool's says what the next stroke makes; a brush's is the brush.
  $('brush-title').textContent=editing?'Editing '+shapeName(selected):tool==='move'?'Select':['landform','fissure'].includes(toolKind(tool))?`New ${toolLabel(tool)||NODE_NAMES[toolKind(tool)]}`:toolLabel(tool)||NODE_NAMES[tool]||tool;
  $('brush-scope').textContent=editing?'Shared settings for every path in this shape.':tool==='move'?'Click a shape to select and edit it.':'Settings for your new shape.';
  // The scope tag says what an edit here changes: the selected shape, or the shapes the tool draws next.
  $('brush-scope-tag').textContent=editing?'This shape':'New shapes';$('brush-scope-tag').title=editing?'Edits here change this shape only':'Edits here set up the next shapes this tool draws';
  syncToolGroups(`${tool}:${selected}`);
  editorUI.syncTools?.(activeTool,editing?nodes[selected].kind:null,locked,featureActive&&(mapFeatures.mode==='starts'?'starts':'features'),picking,id=>toolUnavailable(toolById(id)));
  syncToolSave(locked,featureActive);
  if(picking)setToolHelp('Pick: click the map to see what is there, with a door to each setting · Alt-click picks from any tool · Escape closes the card, then leaves Pick');
  else if(featureActive)setToolHelp(mapFeatures.hint||'Place features and starts · Space + drag to pan');
  else if(featureSelection)setToolHelp('Drag to move the selected features on the cell grid · Shift-click adds or removes · Delete removes · Escape deselects');
}

function canExport() {
  return ready && !loading && !worldInputQueue.pending && !stroke && !moving && !mapFeatures?.busy && (!weatherOn() || weatherState==='ready');
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
const curveKind=() => selected>=0 && nodes[selected]?.params ? nodes[selected].kind : toolKind(tool);
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
  const ground=landformGround(c.q),plain=ground?0:config.baseHeight,sea=ground?null:config.seaLevel,E=landformElevation(c.q,config.seaLevel),span=Math.abs(E-plain)<1?(E<plain?-1:1):E-plain;
  const values=[...frontKnots(c),...(backKnots(c)||[])].map(k=>k[1]),top=plain+span*Math.max(1.2,...values);
  // A signed section (lfcrater) reaches past the ground, away from the elevation: room for its lowest knot.
  const lip=plain+span*Math.min(0,...values);
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
  let path=simplifyPath(pts,Math.max(1,q.radius*.04)).filter((p,k,a) => !k || Math.hypot(p.x-a[k-1].x,p.y-a[k-1].y)>=1e-4);   // as drawn: an impact's along curve runs over its approach too
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
  const n=selectedLandform(); if (!n || !regionalFields) return null;
  const lp=landformPath(n),p=landformAt(lp,lfPlace); return {a:{x:p.x+p.bx*lp.back,y:p.y+p.by*lp.back},b:{x:p.x-p.bx*lp.front,y:p.y-p.by*lp.front}};
}
// Match the dock's actual dimensions so curve text and handles stay sharp.
function fitCanvas(cv) { const w=Math.round(cv.clientWidth),h=Math.round(cv.clientHeight); if (w>=120 && (cv.width!==w||cv.height!==h)) { cv.width=w; cv.height=h; } }
let curvePoint={side:'front',i:0};
function numberKnots(c=curveContext()) { return (curvePoint.side==='along'?alongKnots(c.q):curvePoint.side==='back'?backKnots(c)||frontKnots(c):frontKnots(c)).map(k=>[...k]); }
function syncCurveNumbers(c) {
  if(!c.land&&curvePoint.side!=='front')curvePoint={side:'front',i:0};
  const side=$('curve-point-side');side.value=curvePoint.side;side.options[1].disabled=!c.land;side.options[2].disabled=!c.land;
  const ks=numberKnots(c);curvePoint.i=clamp(curvePoint.i,0,ks.length-1);const i=curvePoint.i;
  const select=$('curve-point-index');if(select.options.length!==ks.length)select.replaceChildren(...ks.map((_,j)=>new Option(String(j+1)+' of '+ks.length,j)));select.value=i;
  for(const [id,value] of [['curve-point-x',ks[i][0]],['curve-point-y',ks[i][1]]])if(document.activeElement!==$(id))$(id).value=value;
  $('curve-point-x').disabled=i===0||i===ks.length-1;$('curve-point-x').min=ks[i-1]?.[0]+.01||0;$('curve-point-x').max=ks[i+1]?.[0]-.01||1;
  $('curve-point-y').min=curvePoint.side==='along'||!c.land?0:-1;$('curve-point-y').max=curvePoint.side==='along'?ALONG_HI:1.5;
  $('curve-point-delete').disabled=i===0||i===ks.length-1||ks.length<=2;
}
function commitNumberKnots(ks) {
  const c=curveContext();if(curvePoint.side==='along')setCurve(roundKnots(ks),'along');
  else if(curvePoint.side==='back'&&!sidesLinked(c))storeSection(c,frontKnots(c),ks);
  else storeSection(c,ks,backKnots(c));
  if(selected>=0){checkpoint();queueWeather();}
}
function curveNumberEvents() {
  $('curve-point-side').onchange=()=>{curvePoint={side:$('curve-point-side').value,i:0};drawSection();};
  $('curve-point-index').onchange=()=>{curvePoint.i=Number($('curve-point-index').value);drawSection();};
  for(const [id,axis]of [['curve-point-x',0],['curve-point-y',1]])$(id).onchange=()=>{const ks=numberKnots(),input=$(id),v=Number(input.value);if(!Number.isFinite(v)||input.value===''){input.value=ks[curvePoint.i][axis];return;}const value=Math.round(clamp(v,Number(input.min),Number(input.max))*1000)/1000;input.value=value;if(value===ks[curvePoint.i][axis])return;ks[curvePoint.i][axis]=value;commitNumberKnots(ks);};
  $('curve-point-delete').onclick=()=>{const ks=numberKnots(),i=curvePoint.i;if(i<=0||i>=ks.length-1||ks.length<=2)return;ks.splice(i,1);curvePoint.i--;commitNumberKnots(ks);};
  for(const [id,amount]of [['curve-raise',.05],['curve-lower',-.05]])$(id).onclick=()=>{const c=curveContext(),lo=curvePoint.side==='along'||!c.land?0:-1,hi=curvePoint.side==='along'?ALONG_HI:1.5;commitNumberKnots(numberKnots().map(([x,y])=>[x,clamp(y+amount,lo,hi)]));};
  for(const [id,axis]of [['curve-scale-height',1],['curve-scale-width',0]])$(id).onchange=()=>{const input=$(id),factor=Number(input.value)/100;if(input.value===''||!input.reportValidity()||!Number.isFinite(factor)||factor<=0){input.value=100;return;}const c=curveContext(),ks=numberKnots(),lo=curvePoint.side==='along'||!c.land?0:-1,hi=curvePoint.side==='along'?ALONG_HI:1.5;const out=ks.map(([x,y],i)=>axis?[x,clamp(y*factor,lo,hi)]:[i===0?0:i===ks.length-1?1:1-(1-x)*factor,y]);if(out.some((k,i)=>i&&k[0]-out[i-1][0]<.01)){input.setCustomValidity('This scale would overlap points. Use a smaller change.');input.reportValidity();input.setCustomValidity('');return;}input.value=100;commitNumberKnots(out);};
}
function drawShapePreview() {
  if(!document.querySelector('.app.curves-large')||!canvas.width||!canvas.height)return;
  const cv=$('curve-shape-preview'),g=cv.getContext('2d');g.clearRect(0,0,cv.width,cv.height);
  let sx=0,sy=0,sw=canvas.width,sh=canvas.height;
  if(selected>=0&&mapCanvas){const b=nodeBounds(nodes[selected]),v=mapCanvas.view(),pad=32;const x0=clamp((b.x0*spacing-v.x)*v.scale-pad,0,canvas.width),x1=clamp((b.x1*spacing-v.x)*v.scale+pad,0,canvas.width),y0=clamp((b.y0*spacing-v.y-180)*v.scale-pad,0,canvas.height),y1=clamp((b.y1*spacing-v.y+100)*v.scale+pad,0,canvas.height);if(x1>x0&&y1>y0){sx=x0;sy=y0;sw=x1-x0;sh=y1-y0;}}
  const ratio=Math.min(cv.width/sw,cv.height/sh),w=sw*ratio,h=sh*ratio;g.drawImage(canvas,sx,sy,sw,sh,(cv.width-w)/2,(cv.height-h)/2,w,h);
}
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
  for (const h of sectionHandles(c,L)) { g.fillStyle=edited?(h.side==='back'&&!h.edit?'rgba(232,242,216,.55)':'#e8f2d8'):'rgba(232,242,216,.45)'; if(curvePoint.side!=='along'&&curvePoint.i===h.i&&curvePoint.side===(h.edit||'front'))g.fillStyle='#ffd27a';g.beginPath(); g.arc(h.X,h.Y,3.5,0,7); g.fill(); }
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
  syncCurveNumbers(c);drawShapePreview();
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
  g.fillStyle=c.q.along?'#e8f2d8':'rgba(232,242,216,.45)'; for (const [i,[x,v]] of knots.entries()) { g.fillStyle=curvePoint.side==='along'&&curvePoint.i===i?'#ffd27a':c.q.along?'#e8f2d8':'rgba(232,242,216,.45)';g.beginPath(); g.arc(L.X(x),L.yv(v),3.5,0,7); g.fill(); }
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
    if(h){curvePoint={side:h.edit||'front',i:h.i};syncCurveNumbers(c);}
    if (h) drag={side:h.side,edit:h.edit||'front',i:h.i};
    else {
      const side=p.px<L.xc?'back':'front',edit=side==='back'&&!sidesLinked(c)&&c.land?'back':'front',x=clamp(distShare(L,side,p.px),.01,.99);
      const list=(edit==='back'?backKnots(c):frontKnots(c)).map(k => [...k]); let j=list.findIndex(k => k[0]>x); if (j<0) j=list.length-1;
      list.splice(j,0,[x,vOf(c,L,p.py)]); curvePoint={side:edit,i:j};drag={side,edit,i:j}; edit==='back'?storeSection(c,frontKnots(c),list):storeSection(c,list,backKnots(c));
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
    if(i>=0){curvePoint={side:'along',i};syncCurveNumbers(c);}
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
function markViewChanged() { revision++; $('export').disabled=true; }
let worldInputs=null;
function worldInputChannels() {
  return {shape:worldShapeKey(shapeContext(),nodes),time:JSON.stringify([timeKnobs(renderer),materialKnobs(),weatherOn()])};
}
// Uniform deltas and the few inputs outside the uniform block meet here.
// A no-op is recorded for the bench, but never advances or schedules the canvas.
function worldChanged(...changes) {
  const fields=changes.flatMap(c=>c?.fields??[]),channels=changes.flatMap(c=>c?.channels??[]).map(c=>({...c,stage:c.stage??'A'})),options=changes.find(c=>c&&Object.hasOwn(c,'world'))??{},world=options.world??true,rect=options.rect??null;
  let stage=changes.map(c=>c?.stage).filter(Boolean).sort()[0]??null;
  if(world){
    const next=worldInputChannels();
    if(worldInputs)for(const [name,value]of Object.entries(next))if(worldInputs[name]!==value){const stage=name==='shape'?'A':'B';channels.push({name,stage});}
    worldInputs=next;
  }
  for(const c of channels)if(!stage||c.stage<stage)stage=c.stage;
  const result=mapCanvas?.changed({stage,rect,world,fields,channels,kind:'world'})??{stage,fields,channels,rect,tiles:0};
  if(stage)markViewChanged();
  return {...result,timeChanged:world&&(changes.some(c=>c?.timeChanged)||channels.some(c=>c.stage==='A'||c.stage==='B'))};
}
function markChanged() { markViewChanged(); error(); syncRocks(); syncMaterials(); }

// Shapes are nodes: kind, path, parameters and seed. The map is rebuilt by
// replaying nodes in order, so relative heights follow the ground beneath
// (a hill on a plateau rises with it). prefix[i] keeps the surface before
// node i, so an edit replays only from the edited node onward.
let nodes=[], selected=-1, moving=null, pendingEval=-1, pendingRect=null;
// Shift-click selects several shapes (toggleSelection): `selected` is the primary, whose handles, card and keys act on it alone;
// alsoSelected holds the others, and a drag or an arrow nudge moves them all. Indices go stale when the list changes, so every
// reorder, delete, undo, load and new stroke clears it.
let alsoSelected=[];
const selectedShapes=() => selected<0||!nodes[selected]?.points?[]:[selected,...alsoSelected.filter(i => nodes[i]?.points&&i!==selected)].sort((a,b) => a-b);
// The material editor at Full size covers the map, which then waits (canvas suspended, shape and Time work deferred) until it is uncovered;
// docked beside the map, the editor leaves it live.
let materialCovers=false,materialTerrainDirty=false;
const NODE_NAMES={landform:'Landform',sand:'Sand',paint:'Surface paint',grass:'Vegetation',erase:'Reset ground',ground:'Ground undulation',fissure:'Fissure',smooth:'Smooth',heights:'Height image'};
// A shape's name, the same on its card, the bar on the map, the Shapes list, the map's own label and the status line: its tool's name
// (a stroke whose tool the world lacks shows as Landform) and its place in the list, as in "Plateau 3".
const shapeLabel=n => n?.kind==='landform'?toolLabel(strokeTool(n,toolIds()))||NODE_NAMES.landform:NODE_NAMES[n?.kind]||n?.kind||'';
const shapeName=i => nodes[i]?`${shapeLabel(nodes[i])} ${i+1}`:'';
// The Facet shape a landform draws: its own, or angular facets where it digs (prepareNode).
const facetShape=q => landformDigs(q)?0:clamp(Math.round(q.facetForm||0),0,2);
function addNode(n) {
  nodes.push(n); regionalFields.changed(nodeBounds(n));
}
function nodeBounds(n) {
  // World-space reach of a shape, from the same extents its brush uses.
  // A height image covers its samples and the margin round them (heightsBounds); it reads no other cell, so it has no read apron (regionalReadApron).
  if (n.kind==='heights') { const b=heightsBounds(n); return {x0:clamp(Math.floor(b.x0/spacing-originCellX),0,grid-1),y0:clamp(Math.floor(b.y0/spacing-originCellY),0,grid-1),x1:clamp(Math.ceil(b.x1/spacing-originCellX),0,grid-1),y1:clamp(Math.ceil(b.y1/spacing-originCellY),0,grid-1)}; }
  if (!n.points) return {x0:0,y0:0,x1:grid-1,y1:grid-1};
  const q=nodeShapeParams(n),radius=q.radius||40,rough=q.rough??.35;
  const reach={erase:Math.min(1.7,1+rough*1.3)+1.9*rough,sand:Math.min(1.7,1+rough*1.3)+1.9*rough,grass:Math.min(1.7,1+rough*1.3)+1.9*rough,paint:Math.min(1.7,1+rough*1.3)+1.9*rough}[n.kind] ?? 1+.4*rough;
  let r=radius*reach+12*spacing;
  // A landform reaches its widest side grown by the width variation, the wander and the spurs (the same reach its segment boxes use).
  const extent=n.kind==='landform'?landformExtent(n,q):null;
  if(extent){
    r=extent.reach+12*spacing;
    // Match the shared coast pass's expanded box as well as the swept profile's reach.
    if(extent.coast!==null)r+=extent.coast+12*spacing;
    if(extent.prism!==null)r+=extent.prism;
  }
  let ax=Infinity,ay=Infinity,bx=-Infinity,by=-Infinity;
  for (const p of n.points) { ax=Math.min(ax,p.x); ay=Math.min(ay,p.y); bx=Math.max(bx,p.x); by=Math.max(by,p.y); }
  // A fissure reaches its branches (and their forks) and, in network mode, its footprint.
  if (n.kind==='fissure') { const k=n.frame?Math.hypot(n.frame[0],n.frame[1]):1; r=(q.fissureNetwork>=.5?radius*1.1:0)+(Math.round(q.fissureBranches)>=1?(q.fissureBranchLen||0)*2.4*k:0)+(q.fissureWidth||5)*3*k+24+12*spacing; }
  if (extent?.spur!=null) r+=extent.spur;
  return {x0:clamp(Math.floor((ax-r)/spacing-originCellX),0,grid-1),y0:clamp(Math.floor((ay-r)/spacing-originCellY),0,grid-1),x1:clamp(Math.ceil((bx+r)/spacing-originCellX),0,grid-1),y1:clamp(Math.ceil((by+r)/spacing-originCellY),0,grid-1)};
}
// How far past its path a landform's brush reaches, term by term (the extents its segment boxes use): `reach`, its section grown by the width
// variation, wander, talus, copies and impact (landformReach); `coast`, its shore features (null without any); `prism`, prisms standing past the
// footprint by up to their own width; `spur`, spurs reaching up to one and a half spur lengths past the ridge plus their root, which flares to
// about 1.7 times Spur width. nodeBounds adds the regional aprons to these; claimReach sums them alone.
function landformExtent(n,q=nodeShapeParams(n)) {
  const radius=q.radius||40,k=n.frame?Math.hypot(n.frame[0],n.frame[1]):1;
  return {reach:landformReach({...q,radius},k),
    coast:q.fingers>0||q.shoreLayers>=1||q.shorePlates>0?Math.max(q.fingers>0?.5*radius+3*spacing:0,q.shoreLayers>=1?coastLayerReach(q):0,q.shorePlates>0?Math.max(q.plateWaterPx||0,q.plateLandPx||0)+2*spacing:0):null,
    prism:q.iceFacets>0&&facetShape(q)===2?lfcWidth(q)*k+2*spacing:null,
    spur:Math.round(q.spurCount)>=1?(q.spurLength||0)*(q.spurForks>0?2.1:1.6)*k+radius*Math.max(1,((q.spurWidth||.8)+(q.spurBulb||0)*.7)*1.7):null};
}
// How far from its path a landform may claim its rock in mask plane 20: where it moves the height, on its talus and its shore features
// (engine-shape.wgsl shapeMasks and claimRock), all inside its brush's reach. The regional aprons of nodeBounds are not part of it.
function claimReach(n) { const e=landformExtent(n); return e.reach+(e.coast??0)+(e.prism??0)+(e.spur??0); }
const shapeLines=n => shapePaths(n).map(path => path.map(i => n.points[i]));
const unionRect=(a,b) => !a?b:!b?a:{x0:Math.min(a.x0,b.x0),y0:Math.min(a.y0,b.y0),x1:Math.max(a.x1,b.x1),y1:Math.max(a.y1,b.y1)};
const overlaps=(a,b) => a.x0<=b.x1 && b.x0<=a.x1 && a.y0<=b.y1 && b.y0<=a.y1;
function evaluate(from=0,rect=null) {
  if(materialCovers){materialTerrainDirty=true;markChanged();return;}
  regionalFields.changed(regionalDirtyRect(from,rect)); markChanged();
}
// The renderer holds the materials in use: the world's ground and water, and those a visible stroke chose.
function syncMaterials() {
  if (!renderer) return;
  const used=materialsInUse(nodes,mapMaterials,mapRocks),key=JSON.stringify(used);
  if (key===materialUseKey) return;
  // Past the cache budget (sculpt-materials.js materialCacheUsage) the renderer keeps the materials it holds and the status line says why.
  let stage; try { stage=setRendererMaterials(new Map(used.map(m=>[m.slot,m]))); } catch (error) { status(error.message); return; }
  materialUseKey=key; worldChanged({stage,world:false}); schedule();
}
// Hands the renderer its materials and says the stage the change reaches: C when the cache's layers or a material's art height change (the
// bake, the geometry and the solid read them: engine-common.wgsl materialRelief, sculpt-materials.js materialHeightKey), else the earliest
// stage that reads a uniform it changed, at least F (the material's colors are the color pass's alone).
function setRendererMaterials(next) {
  const before=renderer.grounds??new Map(),uniform=renderer.uniformStage(()=>renderer.setMaterials(next)),after=renderer.grounds;
  // A slot's cache layers and the world surfaces it draws (its roles: the solid reads which slot is the rock's, and no scan covers it).
  const layers=list=>[...list].sort(([a],[b])=>a-b).map(([slot,m])=>[slot,...materialStates(m),...Object.keys(m).filter(k=>/^world[A-Z]/.test(k)&&m[k]).sort(),m.worldLayer??''].join(':')).join(',');
  const height=layers(before)===layers(after)&&[...after].every(([slot,m])=>materialHeightKey(m)===materialHeightKey(before.get(slot)));
  return [height?null:'C',uniform,'F'].filter(Boolean).sort()[0];
}
function restoreMaterials(materials) {
  mapMaterials=structuredClone(materials); nodes=keepStrokeMaterials(nodes,mapMaterials); syncMaterialChoices(); syncMaterials(); materialEditor?.refresh(); keepWorldMaterials(); surfacePanel?.refresh();
}
// The world's materials are world settings (its ground and water, its role materials and the ones its surface layers draw): where the
// artist changed them from the library's, the world keeps them (this browser's world store) for every map drawn in it, as it keeps its
// sliders. Called once an edit is complete, not on every drag step.
function keepWorldMaterials() {
  keepWorldKit();
  const own=worldOwnMaterials(mapMaterials,config),stored=worlds[worldId]?.materials,next=mergeWorldMaterials(stored,own,config);
  config.worldMaterials=own;
  if(JSON.stringify(next)!==JSON.stringify(stored??[])){activeWorld().materials=next;worldStoreDirty=true;}
  if(worldStoreDirty&&!worldStoreTransaction){worldStoreDirty=false;saveWorlds();}
}
// A stroke's Ground choice: the ground beneath, the world's ground, or another of the map's materials (not its water).
function syncMaterialChoices() {
  const select=$('lf-ground'),value=select.value;
  select.replaceChildren(new Option('Ground beneath','-1'),new Option('World ground','0'),...mapMaterials.filter(m=>!m.worldGround&&!m.worldWater).map(m=>new Option(m.name,String(m.slot))));
  select.value=[...select.options].some(o=>o.value===value)?value:'-1';
  syncGroundChips();
  if($('rock-material'))syncRockMaterial();
}
// The Ground choice as chips: each of the select's choices with its material's color, the chosen one pressed. The Paint brush has
// nothing to paint with "Ground beneath", so it does not offer it. Grounds come first: a material whose only use is one of the world's
// surfaces (its rock, slope cover, debris…), a surface layer or a rock type's rock waits behind More… (CSS orders those chips after the
// grounds), unless a stroke already lays it down or it is the choice. Edit opens the chosen material in the material editor.
const MATERIAL_CHOICES=MATERIAL_SLOTS;
let groundChipKind='landform',groundMore=false;
const groundExtra=m=>Boolean(m&&(roleOf(m)||mapRocks.some(r=>r.material===m.slot))&&!nodes.some(n=>n.params?.groundPreset===m.slot));
const groundMaterial=v=>v===0?mapMaterials.find(m=>m.worldGround):v>0?mapMaterials.find(m=>m.slot===v):null;
function syncGroundChips(kind=groundChipKind) {
  groundChipKind=kind; const select=$('lf-ground'),hex=m=>'#'+materialTint(m).map(v=>Math.round(v*255).toString(16).padStart(2,'0')).join('');
  let behind=0;
  for (let v=-1; v<MATERIAL_CHOICES; v++) {
    const chip=$('lf-ground-chip-'+v),option=[...select.options].find(o=>o.value===String(v)),m=groundMaterial(v)??mapMaterials.find(m=>m.slot===v),extra=v>0&&groundExtra(m),chosen=select.value===String(v);
    chip.classList.toggle('material-extra',extra);
    chip.hidden=!option||(v===-1&&kind==='paint')||(extra&&!groundMore&&!chosen); if (option&&extra&&!chosen) behind++; if (chip.hidden) continue;
    chip.querySelector('.material-choice-name').textContent=option.textContent; chip.title=v===-1?'Leave the surface that is already there.':v===0?'The world’s ground: '+(m?.name??''):option.textContent;
    chip.querySelector('.material-chip').style.background=v>=0&&m?hex(m):''; chip.setAttribute('aria-checked',String(chosen)); chip.disabled=select.disabled;
  }
  const more=$('lf-ground-more');more.hidden=!behind;more.disabled=select.disabled;more.setAttribute('aria-expanded',String(groundMore));more.textContent=groundMore?'Fewer':`More… (${behind})`;
  const m=groundMaterial(Number(select.value)),edit=$('lf-ground-edit');edit.hidden=!m;edit.disabled=select.disabled;
  if(m)edit.title=`Open ${m.name} in the material editor`+(roleOf(m)?' (the world’s: every map in this world shows your edit)':'');
}
for (let v=-1; v<MATERIAL_CHOICES; v++) $('lf-ground-chip-'+v).onclick=()=>{ const select=$('lf-ground'); if (select.value===String(v)) return; select.value=String(v); select.dispatchEvent(new Event('input',{bubbles:true})); select.dispatchEvent(new Event('change',{bubbles:true})); syncGroundChips(); };
$('lf-ground-more').onclick=()=>{ groundMore=!groundMore; syncGroundChips(); };
$('lf-ground-edit').onclick=()=>{ const m=groundMaterial(Number($('lf-ground').value)); if (m) materialEditor?.open(m.slot,$('lf-ground-edit')); };
// World › Surface (sculpt-surface-panel.js, docs/SURFACE_LAYERS.md): the world's surface layers, a world setting kept in this browser's
// world store, as its sliders are; every map drawn in the world shows them. baseSurface is the world's own (its config), which Restore returns to.
let baseSurface=null,surfacePanel=null;
function setSurfaceList(list,keep) {
  config.surface=list;
  if(keep)activeWorld().surface=list; else delete activeWorld().surface;
  const stage=renderer?renderer.uniformStage(()=>renderer.setSurface(list)):'C';
  // A layer's material joins the map; a copy no layer draws leaves it unless a stroke uses it (sculpt-materials.js surfaceMaterials).
  try{const next=surfaceMaterials(list,mapMaterials,{config,nodes,rocks:mapRocks});if(JSON.stringify(next)!==JSON.stringify(mapMaterials))editMaterials(next);}catch(err){status(err.message);}   // a layer's material may enable a row (Highland ground)
  worldChanged({stage:stage??'F',world:false}); schedule();   // the surface rows alone: the color pass (a material it brings: editMaterials)
  // The World rows whose requirement reads the list (Vegetation relief needs a layer that grows plants).
  const plants=list.filter(l=>l?.plants?.amount>0).length;if(plants!==surfacePlants){surfacePlants=plants;syncWorldControls();}
}
let surfacePlants=-1;   // the surface layers that grow plants, last seen (setSurfaceList)
function applySurface(next,{commit=false}={}) {
  let list; try { list=copySurface(next); } catch (err) { status(err.message); return false; }
  setSurfaceList(list,true);
  if(commit){saveWorlds();checkpoint(true);}
  return true;
}
function surfaceHost() {
  const hex=m=>'#'+materialTint(m).map(v=>Math.round(v*255).toString(16).padStart(2,'0')).join('');
  const layerMaterial=layer=>layer.material!=null?mapMaterials.find(m=>m.worldLayer===layer.material):undefined;   // the world's copy its layers share
  const own=m=>'#'+drawnColor(m).map(v=>Math.round(v*255).toString(16).padStart(2,'0')).join('');
  const roleCopy=builtin=>{const role={highland:'worldHigh',slopeCover:'worldSlope',beach:'worldBeach',fines:'worldDebris',rock:'worldRock',crown:'worldRock',paintedRock:'worldRock',chips:'worldRock'}[builtin];return role?mapMaterials.find(m=>m[role])??null:null;};
  return {
    surface:()=>config.surface,
    apply:applySurface,
    restore:()=>{setSurfaceList(structuredClone(baseSurface),false);saveWorlds();checkpoint(true);},
    preview:row=>{if(!renderer||renderer.surfacePreview===row)return;const stage=renderer.uniformStage(()=>renderer.setSurfacePreview(row));worldChanged({stage:stage??'F',world:false});schedule();},
    // Pick on the map: the inspector's pixels come from the Pick tool (its card's Surface door, pickHost openSurface).
    pick:()=>{if(!stroke&&!moving)setPicking(true);},
    inspect:at=>mapCanvas?mapCanvas.inspect(at):Promise.resolve(null),
    // The material a built-in that draws a world role takes (Materials panel; the rock built-ins the world's rock): its name, or null.
    roleMaterial:builtin=>{const m=roleCopy(builtin);return m?{name:m.name,color:hex(m),own:own(m)}:null;},
    // A layer's material's own Color (sculpt-materials.js recolorMaterial): its copy, or for a built-in that draws a role, the role's.
    recolor:(layer,rgb,commit)=>{const m=layer.material!=null?layerMaterial(layer):roleCopy(layer.builtin);if(!m)return;editMaterials(setMaterial(mapMaterials,m.slot,recolorMaterial(m,rgb,drawnColor(m))));if(commit)checkpoint(true);},
    slotMaterial:slot=>{const m=mapMaterials.find(m=>m.slot===slot);return m?{name:m.name,color:hex(m)}:null;},
    // Layers hidden while the artist designs (their keys): a view of this page only, never saved, undone or exported.
    // The design view (Hide and Solo in World › Surface): the map says it is on and that an export still draws every layer.
    hide:(keys,{solo=null}={})=>{
      $('map-view-note').hidden=!keys.length;
      $('map-view-text').textContent=solo?`Showing ${solo} alone`:`${keys.length} surface layer${keys.length===1?'':'s'} hidden`;
      if(!renderer)return;const stage=renderer.uniformStage(()=>renderer.setSurfaceHidden(keys));worldChanged({stage:stage??'F',world:false});schedule();},
    material:layer=>{const m=layerMaterial(layer);return m?{name:m.name,color:hex(m),own:own(m),height:Boolean(m.nodes?.find(n=>n.type==='output')?.in?.height)}:null;},
    edit:(layer,button)=>{const m=layerMaterial(layer);if(m)materialEditor?.open(m.slot,button);},
    library:()=>Object.entries(LIBRARY).filter(([key])=>!key.endsWith('-water')).map(([key,m])=>({key,name:m.name,color:hex(m)})),
    // A built-in's World setting (the Surface section's Built-in settings): show its block, reveal the row if the panel folded it away as
    // unavailable, and focus it; settingNote says why it is unavailable ('' when it is not).
    settings:key=>{const row=document.querySelector(`#wpane-surface [data-knob="${key}"]`),block=row?.closest('.world-subsection');if(!row)return;
      if(row.hidden)block?.querySelector(`.unavailable-summary button[aria-expanded="false"][aria-controls~="knob-${key}-row"]`)?.click();
      (block??row).scrollIntoView({block:'center',behavior:'smooth'});row.querySelector('input,select')?.focus({preventScroll:true});},
    settingNote:key=>document.querySelector(`#wpane-surface [data-knob="${key}"] .control-requirement`)?.textContent??'',
    materialKey:preset=>{const key=preset.material.startsWith('role:')?config.materials?.[preset.material.slice(5)]:preset.material;return LIBRARY[key]?key:config.materials?.ground??'green-ground';},
    // The list's sections (sculpt-surface-panel.js layerSection): a World setting as the draw reads it (a rock type's: the largest of the
    // world's rock and the rock types in use), its row's words and requirement; a role, a world surface (config.layers), a world fact.
    control:key=>{
      const row=document.querySelector(`#knobs [data-knob="${key}"]`);if(!row||!renderer)return null;
      const own=Number(renderer.variant.get(key)??config.defaults?.[key]),rock=ROCK_KEYS.includes(key);   // a setting with no value is no claim (NaN)
      const label=(row.querySelector('label')?.title??key).replace(/\s*\([^)]*\)/g,''),group=row.closest('.world-subsection')?.querySelector('h3')?.textContent??'';
      return {value:rock?renderer.rockMax(key,own):own,rock,rocks:renderer.rocks.size,label:/\s/.test(label)?label:`${group} ${label.toLowerCase()}`,note:row.querySelector('.control-requirement')?.textContent??''};
    },
    role:key=>({present:mapMaterials.some(m=>m[key]),name:roleName(key)}),
    hasLayer:name=>(config.layers||[]).includes(name),
    fact:name=>Number(worldPanelValuesOf(panelFacts())[name])||0,
    worldName:()=>activeWorld().name,
    // Where the control that turns a layer on lives, and going there: its World section and tab opened, its row shown, the focus on it (Find's
    // goTo). A rock type's setting opens the world's rock, which the list's reason speaks of.
    place:go=>{const e=go.control?document.querySelector(`#knobs [data-knob="${go.control}"]`):$(go.id),home=e?.closest('[data-home]')?.dataset.home;if(!home)return '';
      const parts=home.split('/').filter(Boolean),group=e.closest('.world-subsection')?.querySelector('h3')?.textContent;return [...parts,...(parts.length<2&&group?[group]:[])].join(' › ');},
    open:go=>{
      if(go.control&&ROCK_KEYS.includes(go.control)&&rockSelected!==0)selectRock(0);
      const e=go.control?document.querySelector(`#knobs [data-knob="${go.control}"]`):$(go.id);if(!e)return;
      goTo(e.querySelector('.scrub,select,input')??e);
    },
  };
}
// ---- Pick (sculpt-pick.js): the rail's Pick (key I), and Alt-click from any tool. Pick stands in for the tool in hand and leaves `tool` as it
// was, so leaving it (Escape, or choosing another tool) goes back to that tool. Its card stays until Escape, its close, another pick, or a
// click on the map that is not a pick. ----
function leavePick() { picking=false; pickCard?.close(); }
function setPicking(on) { if (on===picking) return; if (on) { mapFeatures?.deactivate(); picking=true; } else leavePick(); updateControls(); }
const andList=words => words.length<2?words.join(''):`${words.slice(0,-1).join(', ')} and ${words.at(-1)}`;
const strokesWith=slot => nodes.filter(n => !n.hidden && n.params?.groundPreset===slot).length;
const shapesNote=count => count?`the ground of ${count} shape${count>1?'s':''} drawn with it`:'';
const kitOwnsMaterial=m=>Boolean(m?.key&&[...(currentWorldKit?.rocks??[]).map(r=>r.material),...(currentWorldKit?.tools??[]).map(t=>t.ground)].some(ref=>ref?.key===m.key&&ref.name===m.name&&sameKitData(ref.graph,copyMaterial(m))));
const materialIsWorld=m=>Boolean(worldKey(m)||kitOwnsMaterial(m));
const scopeOf=world => world?{tag:`Every map in ${activeWorld().name}`,scope:'world'}:{tag:'This map',scope:'map'};
// What a change to a material's Color reaches (the line under a Pick swatch): the world's surface it is, the rock types and shapes that draw it,
// on every map of the world (a world material, sculpt-materials.js worldKey) or on this map alone.
function materialReach(m) {
  const role=roleOf(m),layer=role==='worldLayer'?(config.surface||[]).filter(l => l.material===m.worldLayer).map(l => l.name||BUILTIN_LABELS[l.builtin]||l.builtin).join(', '):'';
  const surface=m.worldGround?'the world’s ground':m.worldWater?'the world’s water, and the shallows’ tint with it':role==='worldRock'?`${worldRockName(config)} and every rock type without its own material`
    :layer?`the surface layer ${layer}`:role?`the world’s ${roleName(role)}`:'';
  const parts=[surface,...mapRocks.filter(r => r.material===m.slot).map(r => r.name),shapesNote(strokesWith(m.slot))].filter(Boolean);
  return `Recolors ${m.name}: ${andList(parts)||'nothing draws it yet'}, ${materialIsWorld(m)?`on every map in ${activeWorld().name}`:'on this map'}.`;
}
// A map rock type shares its material (setRockColor's rule): none of its own, a world surface's, a layer's or another rock type's. Its Rock color
// first gives it its own copy, so no other surface moves with it.
const rockColorShared=(rock,m) => !(rock.material>0)||Boolean(roleOf(m))||Boolean(m.worldLayer)||mapRocks.some(r => r!==rock&&r.material===m.slot)||Boolean(m.key&&((currentWorldKit?.rocks??[]).some(r=>r.key!==rock.worldKey&&r.material?.key===m.key)||(currentWorldKit?.tools??[]).some(t=>t.ground?.key===m.key)));
function rockReach(slot) {
  const m=rockMaterialOf(slot);if(!m)return 'Nothing to recolor: the world has no rock material, so it draws a plain gray.';
  const more=shapesNote(strokesWith(m.slot)),reach=mapRocks.find(r=>r.slot===slot)?.worldKey?`on every map in ${activeWorld().name}`:'on this map';
  if(slot===0)return `Recolors ${m.name}: ${worldRockName(config)} and every rock type without its own material${more?`, and ${more}`:''}, on every map in ${activeWorld().name}.`;
  const rock=mapRocks.find(r => r.slot===slot);
  if(rockColorShared(rock,m))return `Gives ${rock.name} its own copy of ${m.name} to recolor: ${rock.name} alone changes, ${reach}.`;
  return `Recolors ${m.name}: ${rock.name}${more?` and ${more}`:''}, ${reach}.`;
}
// A rock type's headline rows, as World › Rock types shows them for it: the rows the page holds, by their own names.
function rockValues(slot) {
  const own=slot>0?mapRocks.find(r => r.slot===slot)?.knobs:null;
  return ROCK_HEADLINES.filter(key => $('knob-'+key)).map(key => {
    const label=$('knob-'+key).closest('[data-knob]').querySelector('label').title,value=Number(own?.[key]??renderer?.variant.get(key)??config.defaults[key]);
    return `${label.replace(/\s*\([^)]*\)/g,'')} ${+value.toFixed(2)}${/\(px\)/.test(label)?' px':''}`;
  }).join(' · ');
}
// World on one section, with no search hiding it (as openRockType).
function openWorldSection(id) {
  $('tab-world').click(); $(id).click();
}
function pickHost() {
  const material=slot => mapMaterials.find(m => m.slot===slot);
  const info=m => ({slot:m.slot,name:m.name,color:hexOfRgb(drawnColor(m)),...scopeOf(materialIsWorld(m)),reach:materialReach(m)});
  return {
    offMap:at => !mapCanvas||mapCanvas.offMap(at),
    inspect:at => mapCanvas?mapCanvas.inspect(at):Promise.resolve(null),
    client:at => mapCanvas.client(at),
    focusMap:() => overlay.focus({preventScroll:true}),
    shapeAt:p => pickNode(p),
    shape:i => {
      const n=nodes[i];if(!n)return null;const p=n.params||{},values=[];
      if(n.kind==='landform'){values.push(`Cracks ${Math.round((p.cracks||0)*100)}%`);if(shapeControlAvailable('gullies','landform',p))values.push(`Gullies ${Math.round((p.gullies??worldDefault('gullies'))*100)}%`);}
      return {name:shapeName(i),values:values.join(' · ')};
    },
    // Select: the shape selected and the Select tool in hand. Shape settings: the shape selected and its card shown, Pick still in hand.
    selectShape:i => { if (!nodes[i]) return; document.querySelector('[data-tool="move"]').click(); selectNode(i); },
    shapeSettings:i => { if (!nodes[i]) return; selectNode(i); $('tab-tool').click(); $('brush-panel').scrollIntoView({block:'nearest',behavior:'smooth'}); },
    rock:slot => {
      if (slot!==0 && !mapRocks.some(r => r.slot===slot)) return null;
      const m=rockMaterialOf(slot);
      return {name:rockName(slot),color:m?rockHex(slot):'',...scopeOf(slot===0||Boolean(mapRocks.find(r=>r.slot===slot)?.worldKey)),values:rockValues(slot),material:m?{slot:m.slot,name:m.name}:null,reach:rockReach(slot)};
    },
    recolorRock:(slot,hex,commit) => setRockColor(hex,commit,slot),
    openRock:slot => openRockType(slot),
    ground:slot => { const m=material(slot); return m?info(m):null; },
    water:() => { const m=mapMaterials.find(o => o.worldWater); return m?{...info(m),shallow:shownColor('shallowTone',mergedColors().shallowTone)}:null; },
    // A material's Color, as World › Ground and Water's Color rows and each Surface row move it (recolorMaterial): one undo step on release.
    recolor:(slot,hex,commit) => {
      const m=material(slot);if(!m)return;
      try{editMaterials(setMaterial(mapMaterials,m.slot,recolorMaterial(m,[1,3,5].map(i => parseInt(hex.slice(i,i+2),16)/255),drawnColor(m))));}catch(error){status(error.message);return;}
      if(commit){checkpoint(true);materialEditor?.refresh();}
    },
    editMaterial:(slot,button) => materialEditor?.open(slot,button),
    openSurface:(at,read) => { surfacePanel?.show(at,read); openWorldSection('wsec-surface'); $('surface-inspect-result').scrollIntoView({block:'nearest',behavior:'smooth'}); },
    // World › Surface's detail, once open, follows each new pick, so it never describes another pixel than the card.
    read:(at,read) => { if (!$('surface-inspect-result').hidden) surfacePanel?.show(at,read); },
    openColors:() => { openWorldHome('water'); document.querySelector('[data-world-color=shallowTone]').querySelector('input[type=color][aria-label^="Shallow water"]')?.focus({preventScroll:true}); },
    surface:() => config.surface||[],
  };
}
pickCard=mountPick(pickHost());
$('pick-tool').onclick=() => { if (!stroke && !moving) setPicking(true); };
// Beside the map's picture (the view at Fit shows the map with room around it), a pick says the point is off the map.
$('viewport').addEventListener('pointerdown',e => { if (e.target!==$('viewport') || e.button!==0 || !mapCanvas || stroke || moving || (!picking && !e.altKey)) return; e.preventDefault(); pickCard.pick(mapCanvas.artPoint(e),null); });
function editMaterials(materials,rocks=mapRocks) {
  const captured=worldStoreTransaction?null:stageWorldKitEdit(config,currentWorldKit,rocks,materials,{before:mapMaterials});
  materials=captured?.materials??materials;const used=materialsInUse(nodes,materials,rocks),stage=setRendererMaterials(new Map(used.map(m=>[m.slot,m])));
  mapRocks=rocks;mapMaterials=materials;if(captured&&!sameKitData(captured.kit,currentWorldKit))installWorldKit(captured.kit);materialUseKey=JSON.stringify(used);syncMaterialChoices();surfacePanel?.refresh();worldChanged({stage,world:false});persistLater();schedule();
}
function removeMaterial(slot) {
  const gone=deleteMaterial(mapMaterials,nodes,slot,mapRocks);cancelWeather();nodes=gone.nodes;editMaterials(gone.materials);evaluate(0);checkpoint();queueWeather();updateControls();
}
let rockUseBounds=new Map();
const mergeWorldRect=(a,b)=>!a?b:!b?a:{x:Math.min(a.x,b.x),y:Math.min(a.y,b.y),width:Math.max(a.x+a.width,b.x+b.width)-Math.min(a.x,b.x),height:Math.max(a.y+a.height,b.y+b.height)-Math.min(a.y,b.y)};
function syncRocks({defer=false}={}) {
  if (!renderer) return;
  const used=rocksInUse(nodes,mapRocks),key=JSON.stringify(used),bounds=new Map();
  for(const n of nodes)if(!n.hidden&&n.kind==='landform'&&n.params?.rockPreset>0){const slot=n.params.rockPreset;bounds.set(slot,mergeWorldRect(bounds.get(slot),sculptRegion.bounds(n)));}
  const before=rockUseBounds;rockUseBounds=bounds;
  if (key===rockUseKey) return;
  const next=new Map(used.map(r=>[r.slot,r])),slots=[...new Set([...renderer.rocks.keys(),...next.keys()])].filter(k=>JSON.stringify(renderer.rocks.get(k))!==JSON.stringify(next.get(k)));
  let rect=null;for(const slot of slots)rect=mergeWorldRect(rect,mergeWorldRect(before.get(slot),bounds.get(slot)));
  rockUseKey=key;const delta=renderer.setRocks(next,{sync:!defer});surfacePanel?.sync();   // a rock type in use may turn a surface layer on
  if(rect){
    const x=Math.floor(rect.x),y=Math.floor(rect.y);
    const r=renderer.requiredRegion({x,y,width:Math.ceil(rect.x+rect.width)-x,height:Math.ceil(rect.y+rect.height)-y,worldSize,worldGrid},currentDrawOptions());
    rect={x:r.gridOrigin[0],y:r.gridOrigin[1],width:(r.gridWidth-1)*r.gridSpacing,height:(r.gridHeight-1)*r.gridSpacing};
    if(defer)return {rect};
    worldChanged(delta,{world:false,rect});
  }else if(!defer)worldChanged({fields:delta.fields,stage:null},{world:false});
}
// The Rock option's choices: Rock beneath, the world's rock, then the map's presets by name. A stroke whose preset is gone shows Rock beneath.
function syncRockChoices() {
  const select=$('lf-rock'),value=select.value;
  select.replaceChildren(new Option('Rock beneath','-1'),new Option(worldRockName(config),'0'),...mapRocks.map(r => new Option(r.name,String(r.slot))));
  // A recipe or a world's rock type the map lacks (the Rock types pane's Add list, #rock-add): choosing one adds it and gives it to the shape.
  const held=new Set(mapRocks.flatMap(r => [r.key,r.worldKey&&'world:'+r.worldKey])),recipes=[...$('rock-add').options].filter(o => o.value && !o.hidden && !o.parentElement.hidden && !held.has(o.value));
  if (recipes.length && mapRocks.length<ROCK_SLOTS-1) { const g=document.createElement('optgroup'); g.label=`Add a rock type (${mapRocks.length} of ${ROCK_SLOTS-1})`; g.append(...recipes.map(o => new Option(o.textContent,'add:'+o.value))); select.append(g); }
  select.value=[...select.options].some(o => o.value===value)?value:'-1';
}
// The rock the card's shape is drawn in: its Rock choice, or on Rock beneath what the shapes under it claim (rocksBeneath): an earlier shown
// landform may show in this one where their paths come within both claim reaches, plus the rock read's 4 px of noise and a cell each way (a
// claim is held per cell: engine-common.wgsl rockSlotAt), so a doubt counts as a yes; the world's rock shows where none does. A new shape
// lands anywhere, so every rock the map's shapes claim may be under it. `slots` holds one slot, or several when the rock varies.
function cardRock() {
  const n=selected>=0&&nodes[selected]?.params&&nodes[selected].kind==='landform'?nodes[selected]:null,value=Number($('lf-rock').value),choice=Number.isInteger(value)?value:-1;
  if (choice>=0) return {choice,slots:[choice],shape:n};
  const reach=n?claimReach(n):0,lines=n?shapeLines(n):null,margin=4+2*spacing;
  return {choice,slots:rocksBeneath(nodes,n?selected:nodes.length,mapRocks,m => !n||pathsWithin(lines,shapeLines(m),reach+claimReach(m)+margin)),shape:n};
}
const rockName=slot => slot===0?worldRockName(config):mapRocks.find(r => r.slot===slot)?.name??'';
const orList=words => words.length<2?words.join(''):`${words.slice(0,-1).join(', ')} or ${words.at(-1)}`;
// The card's Rock row says which rock type the shape shows, with its color and an Edit that opens it in World; the Cracks row's line links to
// that rock type's Cracks & bands.
function syncCardRock(kind) {
  if (!$('lf-rock-drawn') || kind!=='landform') return;
  const {choice,slots,shape}=cardRock(),one=slots.length===1?slots[0]:null,more=orList(slots.filter(s => s>0).map(rockName));
  $('lf-rock-swatch').style.background=one===null?'':rockHex(one); $('lf-rock-swatch').classList.toggle('varies',one===null);
  $('lf-rock-name').textContent=one===null?'Varies':rockName(one);
  $('lf-rock-note').textContent=choice===0?'· the world’s rock type':choice>0?mapRocks.find(r=>r.slot===choice)?.worldKey?'· this world’s rock type':'· this map’s rock type':one!==null?'· the rock beneath'
    :shape?`· ${more} where earlier shapes reach it, else ${rockName(0)}`:`· ${more} over shapes made of ${slots.length>2?'them':'it'}, else ${rockName(0)}`;
  $('lf-rock-edit').title=one===null?'Open World › Rock types (this shape’s rock varies, so the picker keeps its choice)':`Open ${rockName(one)} in World › Rock types`;
  $('cracks-look').textContent=`${one===null?'Rock types':rockName(one)} › Cracks & bands`;
}
// World follows what the artist picks: selecting another shape (selectNode) or choosing a Rock on the card selects that rock type in World's
// picker. A stroke just drawn (it is selected without selectNode changing the selection), an undo, a redo or a load leave the picker alone, so a
// rock type being tuned in World stays chosen while test shapes are drawn; so does a shape whose rock varies.
function followCardRock() {
  if (curveKind()!=='landform') return;
  const {slots}=cardRock();
  if (slots.length===1 && slots[0]!==rockSelected) selectRock(slots[0]);
}
// World › Rock types (and one of its tabs) on rock type `slot`; null keeps the picker's choice. A search in World would hide the section.
function openRockType(slot,tab='') {
  if (slot!==null && slot!==rockSelected) selectRock(slot);
  $('tab-world').click(); $('wsec-rock-types').click(); if (tab) $('wtab-rock-types-'+tab).click();
  $('rock-chips').querySelector('[aria-checked="true"]')?.focus({preventScroll:true});
}
// The map's rock presets replaced (a load, an undo, a preset edited): strokes keep only choices the list holds, and the renderer and the Rock option follow.
function restoreRocks(rocks) {
  mapRocks=structuredClone(rocks); nodes=keepStrokeRocks(nodes,mapRocks); syncRockChoices(); syncRocks(); syncRockPanel();
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
const shapeContext=() => shapeContextIn({config,settings:experiment,seed,talusAngle:renderer?.variantNumber?.('talusAngle',40)??40,minH:MIN_HEIGHT,maxH:MAX_HEIGHT});
// H5b: a map over 1168 samples a side runs its fields and Time pass in pages. gpuPages=force pages a smaller map too: a test hook for comparing pages with the whole map, not a switch (both are the GPU).
const gpuPagesForced=() => new URLSearchParams(location.search).get('gpuPages')==='force';
const pagedWanted=() => worldGrid>1168 || gpuPagesForced();
const pagedOn=() => Boolean(regionalFields?.paged && regionalFields.active());
// H12: the paged fields fit their ring and page caps to the terrain GPU budget the canvas holds (gpuMB, or its field), less the canvas's minimum.
// Each minimum is worked out when it is read: the paged fields ask on every input, for one of the two.
const gpuBudget=() => ({total:(Number(document.querySelector('[data-gpu]')?.value)||Number(new URLSearchParams(location.search).get('gpuMB'))||2048)*1048576,get minimum(){return mapCanvas?.minimumBytes?.()??96*1048576;},get previewMinimum(){return mapCanvas?.minimumBytes?.({previews:true})??96*1048576;}});
function makeRegionalFields() {
  const common={worldSize,worldGrid,baseHeight:config.baseHeight,maskKeys:MASK_KEYS,nodes:() => nodes,device:() => renderer?.device,context:shapeContext,gesture:() => Boolean(stroke||moving||controlsEditing||worldInputQueue.active),gestureSettled:()=>mapCanvas?.refineWhileHeld?.()??false};
  // pageRing (a ring by hand) and timeApron are test hooks of the page ring rule and the Time pass's window; no page needs them.
  const query=new URLSearchParams(location.search);
  return pagedWanted()?createPagedFields({...common,budget:gpuBudget,foregroundPending:()=>Boolean(mapCanvas?.gpuWorkPending?.()||mapCanvas?.foregroundPending?.()),prepareBackground:bytes=>mapCanvas?.prepareBackground?.(bytes)??true,apron:Number(query.get('timeApron')||128),forceRing:Number(query.get('pageRing')||0)}):createGpuFields(common);
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
  const node=adding?cloneNodes([original])[0]:{kind,points,params,seed:params.seed??seed,...(kind==='landform'?{tool:toolKind(tool)==='landform'?tool:LANDFORM_TOOL.id}:{})};
  delete params.seed;cancelWeather();
  let path=0;
  if(adding){path=appendPath(node,attachment>=0?[]:points,attachment);nodes[index]=node;}
  else nodes.push(node);
  const basePoints=adding?node.points.length-(attachment>=0?0:1):0;
  stroke={regional:true,kind:node.kind,node,index,selectionBefore,original,pathIndex:path,attachment,basePoints,advanceSeed:advanceSeed&&!adding};
  selected=adding?index:-1;alsoSelected=[];
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
  const gesture=stroke,rect=nodeBounds(gesture.node),drawing=tool;stroke=null;
  const emptyBranch=gesture.original&&gesture.attachment>=0&&gesture.node.paths[gesture.pathIndex].length===1;
  if(!commit||emptyBranch){
    if(gesture.original)nodes[gesture.index]=gesture.original;else nodes.splice(gesture.index,1);
    selected=gesture.selectionBefore;evaluate(gesture.index,unionRect(rect,gesture.original?nodeBounds(gesture.original):null));
  }else{selected=gesture.index;pathPoint=-1;pathIndex=gesture.original?gesture.pathIndex:0;if(!gesture.original)pathEditing=false;if(gesture.advanceSeed)seed=randomSeed(gesture.node.seed);checkpoint();}
  if(selected>=0)selectNode(selected);
  // A new shape stays selected for its card, and the drawing tool stays: the next drag draws another. V or Select edits on the map.
  if(commit&&!emptyBranch&&!gesture.original&&drawing!=='move'&&tool==='move'){tool=drawing;drawMode='new';}
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
  cancelWeather();
  // Pressing any shape of a multi-selection moves them all and keeps the primary; another shape collapses the selection to it.
  const group=selectedShapes(); if (!group.includes(index) || group.length<2) selectNode(index);
  const original=cloneNodes([nodes[index]])[0];
  const members=group.length>1&&group.includes(index)?group.map(i => { const o=cloneNodes([nodes[i]])[0]; return {index:i,original:o,state:nodeState(o)}; }):null;
  moving={regional:true,index,original,state:nodeState(original),selectionBefore:selected,changed:false,members};
  updateControls(); return index;
}
// Only a plain drag moves the group; rotate, scale, height and point edits stay on the shape they started on.
const groupTranslation=edit => edit && typeof edit==='object' && !Array.isArray(edit) && !edit.matrix && !edit.point && !edit.params && !Number.isFinite(edit.amount);
// Transforms and parameter edits are relative to the gesture's first node,
// regardless of pointer cadence. A release is one undoable history entry.
function previewRegionalMove(edit) {
  if (!moving?.regional) return false;
  if (moving.members && groupTranslation(edit)) {
    const m=[1,0,0,1,edit.dx??0,edit.dy??0];
    if (m.some(v => !Number.isFinite(v))) throw new Error('Invalid terrain transform.');
    for (const g of moving.members) {
      const before=nodeBounds(nodes[g.index]),node=cloneNodes([g.original])[0];
      transformNode(node,g.state,m); nodes[g.index]=node;
      evaluate(g.index,unionRect(before,nodeBounds(node)));
    }
    moving.changed=true; schedule(); return moving.index;
  }
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
  const gesture=moving; moving=null;
  if (!commit) for (const g of gesture.members||[{index:gesture.index,original:gesture.original}]) { const rect=nodeBounds(nodes[g.index]); nodes[g.index]=g.original; evaluate(g.index,unionRect(rect,nodeBounds(g.original))); }
  else if (gesture.changed) checkpoint();
  if (gesture.members) selectNode(selected,true); else selectNode(gesture.index);
  updateControls(); schedule(); queueWeather(); return commit?gesture.index:false;
}
const readSurfaceInputs=() => Object.fromEntries(SURFACE_SLIDER_IDS.map(id=>[id,Number($(id).value)]));
let appliedSurface=null,appliedView=null;
const surfaceValues=()=>appliedSurface??readSurfaceInputs();
function syncDrawInputs(){appliedSurface=readSurfaceInputs();appliedView={clay:$('clay').checked,light:$('light').value};}
function currentDrawOptions() { return drawOptions(surfaceValues(),appliedView??{clay:$('clay').checked,light:$('light').value}); }
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
// Time working memory and retired results remain in the shared ledger.
// Whole-map requests release idle view workspace before allocating; view bakes
// also reserve this transient memory while they plan their own working sets.
const gpuTransientBytes=() => [...retiredWeather].reduce((n,w) => n+w.bytes,0)+gpuPassBytes;
const gpuBytes=() => (regionalFields?.stats?.().gpuShape?.gpuBytes||0)+(gpuWeather?.bytes||0)+gpuTransientBytes();
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
  return fields.setTime({...pagedTime({config,renderer,size,spacing,material:materialKnobs()}),revB:mapCanvas?.rev.B??0});
}
function queuePagedWeather() {
  if (stroke||moving) return;
  const changedTime=configurePagedTime(),stale=regionalFields.settle(),on=$('weather').checked;
  weatherState=on?'ready':'disabled'; $('weather-state').textContent=on?(changedTime?'Weathering pending · visible pages update on demand':'Weathered edges · GPU time pass in pages, on demand'):'Weathering off · authored surface';
  weatherJob++;
  if (changedTime) { markViewChanged(); mapCanvas?.changed({stage:'B',input:false,world:false}); }
  else if (stale && on) { const pad=160*spacing; markViewChanged(); mapCanvas?.changed({stage:'B',rect:{x:Math.max(0,stale.x-pad),y:Math.max(0,stale.y-pad),width:stale.width+2*pad,height:stale.height+2*pad},input:false,world:false}); }
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
    if(!feed.weather)feed.weatherRevB=mapCanvas.rev.B;
    else if(feed.weatherRevB>=mapCanvas.rev.B)$('weather-state').textContent='Weathered edges · GPU time pass in pages, on demand';
    return feed;
  }
  await regionalFields.gpuReady(); signal?.throwIfAborted();
  const buffers=regionalFields.gpuBuffers(); if (!buffers) return null;
  const on=weather&&$('weather').checked;
  if (on && refined && !gpuWeather) return null;
  const w=on?gpuWeather:null;
  return {...buffers,weatherRevB:on&&weatherOn()?(w?.revB??-1):mapCanvas.rev.B,maskCount:MASK_KEYS.length,weather:w?.weather??null,maps:w?.mapsOn?w.maps:null,field:w?.mapsOn?w.field??null:null,get invalidRect(){return w?.invalidRect;},release:w?leaseGpuWeather(w):() => {}};
}
function readRegional(request) {
  if (pagedOn()) return regionalFields.readAsync(request);
  if (regionalFields.pending?.()) return regionalFields.ready().then(() => readRegional(request));
  if (gpuWeather && $('weather').checked && !(gpuWeather.cpuHeight && (gpuWeather.cpuMaps || !gpuWeather.mapsOn))) return gpuWeatherCpu(true).then(() => readRegional(request));   // H6b: a CPU reader of the Time pass
  const r=regionalFields.read(request);
  r.weatherRevB=weatherOn()?(gpuWeather?.revB??-1):mapCanvas.rev.B;
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
let pendingControlRow=null,controlInputToken=0;
function renderProgress(stage,invalidated=false) {
  if(invalidated&&pendingControlRow)pendingControlRow.classList.add('render-pending');$('map-progress').hidden=!stage;$('render-stage').hidden=!stage;$('render-stage').textContent=stage||'';
  if(!stage)for(const row of document.querySelectorAll('.render-pending'))row.classList.remove('render-pending');
}
const controlRevisions=new WeakMap();
for(const event of ['input','change']){
  document.addEventListener(event,e=>{if(!ready||!e.target.closest('#editor,#world-editor,#rendering-host'))return;const row=e.target.closest('.control,.control-row,.curve-numbers label,.curve-actions');controlRevisions.set(e,{row,revision});pendingControlRow=row;const token=++controlInputToken;requestAnimationFrame(()=>requestAnimationFrame(()=>{if(controlInputToken===token)pendingControlRow=null;}));},true);
  document.addEventListener(event,e=>{const before=controlRevisions.get(e);if(before?.row&&revision!==before.revision){before.row.classList.add('render-pending');renderProgress('Updating terrain…');}});
}

function setMapBusy(on) {
  loading=on; $('editor').disabled=on; $('world-editor').disabled=on;
  for (const id of ['new-map','weather','clay','light','feature-tool','starts-tool']) $(id).disabled=on;
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
  previewQualityPreference:()=>editorUI.previewQuality,savePreviewQuality:value=>editorUI.setPreviewQuality(value),
  terrainBudgetPreference:()=>editorUI.terrainBudget,saveTerrainBudget:value=>editorUI.setTerrainBudget(value),
  // A saved copy that failed to load is retained until the artist edits (keepSaved): a restart must not replace it with the blank map.
  saveForGpuRestart:()=>!ready||keepSaved||saveWorking(),
  previewScene:()=>({size:worldSize,grid:worldGrid,spacing,baseHeight:config.baseHeight,sea:config.seaLevel,minH:MIN_HEIGHT,maxH:MAX_HEIGHT,nodes,context:shapeContext(),maskCount:MASK_KEYS.length,revision:regionalFields.stats().revision,revB:mapCanvas?.rev.B??0,paged:Boolean(regionalFields.paged),timeApron:(regionalFields.apron??128)*spacing,
    previewTime:({size:windowSize,spacing:windowSpacing})=>weatherOn()?{...pagedTime({config,renderer,size:windowSize,spacing:windowSpacing,material:materialKnobs()}),revB:mapCanvas?.rev.B??0}:null,fail:error}),
  fitGpuBudget:() => regionalFields?.refit?.(),
  releaseGpuStaging:()=>regionalFields?.releaseStaging?.()??0,
  setViewFocus:v=>{regionalFields?.setFocus?.({x:(v.x+v.width/2)/spacing,y:(v.y+v.height/2)/spacing});pickCard?.place();syncWorldHome();},
  read:readRegional,gpuFeedSource,readAuthored:request => pagedOn()?regionalFields.readAsync(request,{weather:false}):regionalFields.pending?.()?regionalFields.ready().then(() => regionalFields.read(request)):regionalFields.read(request),uniformAuthored,sample:sampleRegional,sampleAuthored:(x,y,key) => regionalFields.sample(x,y,key),cell:(x,y,key) => regionalFields.cell(x,y,key),graph:() => serializeNodes(),serializeGraph:() => serializeNodes(),nodeMetadata:i => { const n=nodes[i]; return n?{kind:n.kind,hidden:n.hidden,params:n.params?{...n.params}:undefined,points:n.points?.map(p=>({...p})),paths:clonePaths(n),frame:n.frame?.slice()}:undefined; },
  loadGraph:list => { if (!Array.isArray(list)) throw new Error('A regional map requires a stroke graph.'); const next=deserializeNodes(list); cancelWeather(); nodes=next; selected=-1;alsoSelected=[];pathIndex=0;pathPoint=-1;pathAdding=false;drawMode=tool==='move'?'select':'new'; evaluate(0); renderLayers(); checkpoint(); queueWeather(); },
  sketch,loadSketch:s=>loadSketchFile(s,false),maskKeys:MASK_KEYS,stats:regionalStats,revision:() => revision+mapRevision+weatherJob,
  bounds:n => { const b=nodeBounds(typeof n==='number'?nodes[n]:n); return {x:b.x0*spacing,y:b.y0*spacing,width:(b.x1-b.x0)*spacing,height:(b.y1-b.y0)*spacing}; },
  residentBuffers:()=>[...(regionalFields.buffers?.()||[]),...[nodes,...history.map(h=>h.nodes)].flatMap(list=>list.flatMap(n=>n.result?.planes?.map(a=>a.buffer)??[])),...new Set([weatherBase,refined,refinedBase,...Object.values(regionalWeather||{})].filter(ArrayBuffer.isView).map(a=>a.buffer))],subscribe:fn => regionalFields.subscribe(fn),subscribeSubmit:fn => regionalFields.subscribeSubmit?.(fn),gpuBytes,gpuTransientBytes,gpuFeedActive:() => gpuFeedEligible(),currentTool:() => tool,strokeOptions:currentStrokeOptions,applyStroke:applyRegionalStroke,
  beginStroke:(kind,p,options,attachment=-1)=>beginRegionalStroke(kind,p,options,attachment,drawMode==='add'?selected:-1,varySeed),previewStroke:previewRegionalStroke,endStroke:(commit=true)=>endRegionalStroke(commit,$('simplify-strokes').checked),beginMove:beginRegionalMove,previewMove:previewRegionalMove,endMove:endRegionalMove,gestureActive:() => Boolean(stroke||moving),previewActive:() => Boolean(stroke||moving||controlsEditing||worldInputQueue.active),
  sectionMark,pathEditing:()=>pathEditing,pathSelection:()=>pathPoint,pathIndex:()=>pathIndex,pathAdding:()=>pathAdding,
  drawMode:()=>drawMode,drawingKind:()=>drawMode==='add'?nodes[selected]?.kind:toolKind(tool),
  selectPathPoint:i=>{pathPoint=i;if(i>=0&&!shapePaths(nodes[selected])[pathIndex]?.includes(i))pathIndex=shapePaths(nodes[selected]).findIndex(path=>path.includes(i));updateControls();},
  addPathPoint:p=>{if(pathAdding&&pathPoint>=0)changeSelected(n=>{const added=extendPoint(n,pathPoint,regionalPoints([p])[0],pathIndex);pathPoint=added.point;pathIndex=added.path;});pathAdding=true;updateControls();},
  // Pick: a left click on the map with Pick in hand, or with Alt held, reads its pixel (art: the picture's pixel; ground: the point Select
  // hit-tests) and does nothing else; any other click closes the card.
  pickHere:(event,art,ground)=>{if(!picking&&!event.altKey){pickCard?.close();return false;}if(!stroke&&!moving)pickCard?.pick(art,ground);return true;},picking:()=>picking,
  select:selectNode,selectAt:p => { const i=pickNode(p); selectNode(i); return i; },selection:() => selected,selectedShapes,toggleShape,pickAt:pickNode,selectionLabel:shapeName,
  editNode:(i,edit) => { selectNode(i); changeSelected(edit); },moveNode:(i,dx,dy) => { selectNode(i); changeSelected(n => transformNode(n,nodeState(n),[1,0,0,1,dx,dy])); },
  pendingInputs:()=>worldInputQueue.pending,drawOptions:currentDrawOptions,mapData,restoreMapData,mapChanged,checkpoint,ready:() => ready&&!loading,canExport,
  setBusy:setMapBusy,registerFeatures:handle => { mapFeatures=handle; },registerMetadata:handle => { mapMetadata=handle; },renderProgress,presented:drawShapePreview,onUpdate:fn => { mapUpdate=fn; }
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
  flushEval(); checkpoint(); queueWeather();const adding=pathAdding,mode=drawMode;selectNode(selected,true);pathAdding=adding;drawMode=mode;updateControls();schedule();
}
function moveSelectedShapes(dx,dy) {
  const group=selectedShapes(); if (!group.length || stroke || moving || loading || !ready) return;
  cancelWeather();
  for (const i of group) { const n=nodes[i],before=nodeBounds(n); transformNode(n,nodeState(n),[1,0,0,1,dx,dy]); pendingRect=unionRect(pendingRect,unionRect(before,nodeBounds(n))); }
  pendingEval=pendingEval<0?group[0]:Math.min(pendingEval,group[0]);
  flushEval(); checkpoint(); queueWeather();const adding=pathAdding,mode=drawMode;selectNode(selected,true);pathAdding=adding;drawMode=mode;updateControls();schedule();
}
function pickNode(p) {
  let best=-1,bestScore=Infinity;
  nodes.forEach((n,i) => { const d=nodeDistance(n,p),reach=Math.max(24,(n.params?.radius||40)); if (d<reach && d/reach<=bestScore) { bestScore=d/reach; best=i; } });
  return best;
}
function selectNode(i,keepOthers=false) {
  if(!keepOthers)alsoSelected=[];
  const another=selected!==i;
  if(another){pathPoint=-1;pathIndex=0;}
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
    for (const [key,id,,,lo,hi,,scale] of SHAPE_FIELDS) setShapeControl(id,clamp(Math.round((p[key]??worldDefault(key))*scale),lo,hi));
  }
  renderLayers(); updateControls(); schedule(false);
  if (another && n?.kind==='landform' && n.params) followCardRock();
  if (n) status(alsoSelected.length?`${selectedShapes().length} shapes selected. Drag one to move them together; Shift-click adds or removes.`:`Selected ${shapeName(i)}. Drag to transform or edit its settings.`);
}
// Shift-click on the map or in the Shapes list. Answers whether the shape is now selected.
function toggleShape(i) {
  if (i<0 || !nodes[i] || stroke || moving || loading) return false;
  // Only shapes with a path move as a group; a pathless row (Ground undulation) is selected alone.
  if (pathEditing || drawMode==='add' || !nodes[i].points || (selected>=0 && !nodes[selected]?.points)) { selectNode(i); return true; }
  const next=toggleSelection(selected,alsoSelected.filter(j => nodes[j]?.points),i);
  alsoSelected=next.others; selectNode(next.primary,true);
  if (next.primary<0) status('Deselected the shape.');
  return next.primary===i || next.others.includes(i);
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
    const chosen=i===selected||alsoSelected.includes(i);item.className=(chosen?'selected ':'')+(n.hidden?'is-hidden':'');
    const grip=document.createElement('span');grip.className='layer-grip';grip.textContent='⠿';grip.setAttribute('aria-hidden','true');
    const name=document.createElement('button');name.className='layer-name';name.textContent=shapeLabel(n);const count=document.createElement('span');count.className='path-count';const pc=shapePaths(n).length;count.textContent=pc?`${pc} path${pc===1?'':'s'}`:'';name.setAttribute('aria-pressed',String(chosen));name.onclick=e=>{if(e.shiftKey)toggleShape(i);else selectNode(i===selected&&!alsoSelected.length?-1:i);};
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
  if (kind==='delete') { const group=selectedShapes().length>1?selectedShapes():[i]; for (const j of [...group].reverse()) nodes.splice(j,1); selected=-1;alsoSelected=[]; evaluate(group[0]); }
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
  flushEval(); keepWorldMaterials();
  history.splice(historyIndex+1); history.push({nodes:cloneNodes(),refinementSeed,mapData:mapData(),column:structuredClone(columnOverride),rock:rockSettings(),world:worldUndoState(),rocks:structuredClone(mapRocks),surface:structuredClone(config.surface),materials:structuredClone(mapMaterials),tools:structuredClone(mapTools),terrainKey:mapOnly?(history[historyIndex]?.terrainKey??++historySerial):++historySerial}); if (history.length>48) history.shift(); historyIndex=history.length-1;
  renderLayers(); updateControls(); persistLater();
}
function moveHistory(delta) {
  const next=historyIndex+delta; if (!ready || stroke || moving || mapFeatures?.busy || next<0 || next>=history.length) return;
  const saved=history[next].world?.stored;worldStoreTransaction++;
  try{
  if(saved)configureStoredWorld(saved,history[next].world.beachFrom);
  if(history[next].rock)setRockSettings(history[next].rock);
  if(history[next].world)restoreWorldState(history[next].world);
  if(history[next].rocks&&JSON.stringify(history[next].rocks)!==JSON.stringify(mapRocks))restoreRocks(history[next].rocks);
  // Materials first: the surface then finds its copies bound as they were and changes none.
  if(history[next].materials&&JSON.stringify(history[next].materials)!==JSON.stringify(mapMaterials))restoreMaterials(history[next].materials);
  if(history[next].surface&&JSON.stringify(history[next].surface)!==JSON.stringify(config.surface)){setSurfaceList(structuredClone(history[next].surface),JSON.stringify(history[next].surface)!==JSON.stringify(baseSurface));saveWorlds();surfacePanel?.refresh();}
  if(history[next].tools&&JSON.stringify(history[next].tools)!==JSON.stringify(mapTools))restoreMapTools(history[next].tools);
  if (history[next].terrainKey===history[historyIndex].terrainKey) { historyIndex=next; restoreMapData(history[next].mapData); updateControls(); persistLater(); schedule(false); pickCard?.refresh(); return; }
  cancelWeather(); nodes=cloneNodes(history[next].nodes); selected=-1;alsoSelected=[];pathAdding=false;drawMode='select';pathPoint=-1;pathIndex=0; refinementSeed=history[next].refinementSeed; historyIndex=next; restoreMapData(history[next].mapData);
  if (JSON.stringify(history[next].column)!==JSON.stringify(columnOverride)) { restoreColumn(history[next].column); syncColumnPanel(); }
  evaluate(0); renderLayers(); updateControls(); persistLater(); status(delta<0?'Undid the last change.':'Restored the change.'); schedule(); queueWeather(); pickCard?.refresh();
  }finally{if(saved)worlds[worldId]=structuredClone(saved);refreshWorldTools();worldStoreDirty=false;worldStoreTransaction--;saveWorlds();const change=worldChanged(renderer.setColors(worldColors(),currentDrawOptions()));if(change.timeChanged)queueWeather();buildWorldPanel();syncWorldControls();updateControls();}
}

function clearRendererWeather() { regionalWeather=null; if (gpuWeather) gpuWeather.mapsOn=false; }
function cancelWeather() {
  weatherJob++; weatherBase=null;
  weatherState=$('weather').checked?'pending':'disabled';
  $('weather-state').textContent=$('weather').checked?'Refinement paused while editing.':'Weathering off · authored surface';
  updateControls();
}
let materialWeatherPending=false;
function queueWeather() {
  controlsEditing=false;
  if(materialCovers){materialWeatherPending=true;return;}
  materialWeatherPending=false;
  flushEval();
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
// One Time request at a time. A newer edit stops it after the submitted
// slice drains; only the newest waiting request allocates the next working set.
let timePass=null;
// A display-only source has no canonical dependency. Let it answer the view
// before allocating or submitting another whole-map Time slice.
async function yieldToPreview(job,bytes=0){
  while(job===weatherJob&&!stroke&&!moving&&(mapCanvas?.previewWorkPending?.()||bytes&&mapCanvas?.prepareTime?.(bytes)===false))await new Promise(resolve=>setTimeout(resolve,0));
}
async function runFedWeather(job) {
  try {
    const {erosionOf}=await import('./sculpt-erosion.js'),erosion=await erosionOf(renderer);
    while (timePass) { await timePass; if (job!==weatherJob) return; }
    await regionalFields.gpuQuiet();   // the shape runs' own scratch (whole-map noise: peak 259 MB) is gone before the pass allocates its 120 B a cell
    const workingBytes=grid*grid*120+Math.ceil(grid/8)**2*12;
    await yieldToPreview(job,workingBytes);
    const b=regionalFields.gpuBuffers();
    if (!b || job!==weatherJob) return;
    gpuPassBytes=workingBytes;
    const revB=mapCanvas.rev.B;
    const request={planes:b.planes,masks:b.masks,rateMask:MASK_KEYS.indexOf('ovErosion'),grid,size,seaLevel:config.seaLevel,...timeKnobs(renderer),stale:()=>job!==weatherJob||Boolean(stroke||moving),beforeSlice:()=>yieldToPreview(job)};
    const pass=erosion.runGpu(request),flight=pass.then(() => {},() => {}).then(() => { if (timePass===flight) timePass=null; });   // cleared when the pass ends, failed or not, before a waiting request looks
    timePass=flight;
    const result=await pass,material=materialKnobs();
    if (material && job===weatherJob && !stroke) result.field=await erosion.materialField(materialRequest(config,material,{heightBuffer:result.weather,heightOffset:grid*grid,grid,size}));
    gpuPassBytes=0;
    if (job!==weatherJob || stroke) { retireGpuWeather(result); return; }
    const previous=gpuWeather,release=previous?leaseGpuWeather(previous):()=>{};let dirty;
    try{dirty=await changedWeatherTiles(renderer.device,previous,result,grid,spacing);}finally{release();}
    if(job!==weatherJob||stroke||moving){retireGpuWeather(result);return;}
    const invalid=previous?.invalidRect;
    dropGpuWeather();
    gpuWeather={revB,weather:result.weather,maps:result.maps,field:result.field??null,bytes:result.bytes+(result.field?grid*grid*16:0),mapsOn:true,grid,cpuHeight:false,cpuMaps:false,loading:null};
    gpuErosionMs=result.milliseconds; window.lastErosionParts=result.parts;
    weatherState='ready'; $('weather-state').textContent=`Weathered edges · GPU time pass ${Math.round(gpuErosionMs)} ms`;
    if (!stroke && !moving) gpuWeatherCpu(false).catch(() => {});   // picking and the cursor read heights at once; the maps stay lazy
    markViewChanged();if(dirty===null)mapCanvas.changed({stage:'B',refinement:true,input:false});else {
      if(invalid)dirty.push({x:invalid.x0*spacing,y:invalid.y0*spacing,width:(invalid.x1-invalid.x0+1)*spacing,height:(invalid.y1-invalid.y0+1)*spacing});
      for(const rect of dirty)mapCanvas.changed({stage:'B',rect,refinement:true,input:false});
    }
    updateControls(); schedule();
  } catch (err) { gpuPassBytes=0; if(err.name!=='AbortError'&&job===weatherJob){if(await mapCanvas.recoverMemory(err))queueWeather();else failWeather(err.message,err);} }
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
function scriptedScene(list,{ground=true,tools,materials}={}) {
  const nextMaterials=materials===undefined?mapMaterials:withWorldMaterials(materials,config);
  worldInputQueue.flush();
  if (tools!==undefined) restoreMapTools(copyMapTools(tools)??[],true);   // a scene's own tools (a scene's `tools`), which its strokes may name
  mapMaterials=nextMaterials;syncMaterialChoices();materialEditor?.refresh();if(materials!==undefined)keepWorldMaterials();   // a scene's ground and water become the world's, as an edit's do
  applySeedControl(); refinementSeed=seed;
  cancelWeather(); refined=refinedBase=null; dropGpuWeather(); clearRendererWeather(); 
  nodes=[]; selected=-1;alsoSelected=[];
  for (const node of sceneNodes(config,list,{ground,seed,settings:experiment,tools:[...(worldToolList??[]).filter(authoredWorldTool).map(t=>({...t,card:toolCard(t.id)})),...mapTools]})) addNode(node);
  nodes=keepStrokeTools(keepStrokeMaterials(keepStrokeRocks(nodes,mapRocks),mapMaterials),toolIds());   // a stroke choosing a preset the map's list does not hold keeps the rock beneath (as headless play does)
  regionalFields.changed();
  markChanged(); checkpoint();
  updateControls(); schedule(); queueWeather();
  return nodes.length;
}
function sketch() {
  worldInputQueue.flush();
  applySeedControl();
  rememberTool();
  return {format:'nanolathe-terrain-sculpt',version:6,nodes:serializeNodes(),map:config.map,mapData:mapData(),biome:config.biomeId||'green',world:worldId,worldSettings:savedWorld(config,experiment,{...activeWorld(),materials:mapMaterials}),size,grid,baseHeight:config.baseHeight,seaLevel:config.seaLevel,seed,varySeed,refinementSeed,
    ...(columnOverride?{column:structuredClone(columnOverride)}:{}),rock:rockSettings(),rocks:structuredClone(mapRocks),materials:structuredClone(mapMaterials),...(mapTools.length?{tools:structuredClone(mapTools)}:{}),
    toolSettings,softness:Number($('softness').value),relief:Number($('relief').value),
    mineralRing:Number($('mineral-ring').value),ringSpread:Number($('ring-spread').value),
    ringVariation:Number($('ring-variation').value),materialWeathering:Number($('material-weathering').value),depositSpread:Number($('deposit-spread').value),transitionDetail:Number($('transition-detail').value),
    tool,diameter:Number($('diameter').value),amount:Number($('amount').value),roughness:Number($('roughness').value),weather:$('weather').checked,clay:$('clay').checked,light:$('light').value,encoding:'stroke-graph'};
}
// The working copy is the sketch plus the world it was edited in and, per stroke, the settings the artist changed by hand
// (those that differ from that world's defaults for the stroke's tool), so a switch can carry the rest to the new world's defaults.
function nodeDefaults(n,own=mapTools,tables) {
  const id=strokeTool(n,toolIds(own));
  return n.params && (n.kind==='landform' || FIXED_TOOLS.includes(id)) && id!=='move'?strokeParams(strokeCard(toolCard(id,own,tables))):null;
}
function workingCopy() {
  const s=sketch();
  s.world=worldId;
  s.nodes=markEdited(s.nodes,n => nodeDefaults(n));
  return s;
}
function saveWorking() {
  if (!LOCAL_KEY || !ready) return false;
  try { localStorage.setItem(LOCAL_KEY,JSON.stringify(workingCopy())); return true; } catch (_) { return false; }
}
// Carry a working copy's strokes into the current world: geometry, kind and tool stay; where this world has the stroke's tool, each setting the artist
// changed by hand stays and every other one takes this world's default. A stroke whose tool this world lacks shows as the generic landform with every
// number as it was (there is no default of its own to take). Ground undulation always takes this world's.
function carryNodes(list,own=mapTools,tables) {
  const out=carryStrokes(list,toolIds(own),n => nodeDefaults(n,own,tables));
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
  nodes=nodes.map(n => { const base=n.points?nodeDefaults(n):null; if(!base)return n; const {kept,...rest}=n,m={...rest,params:{...base,...(n.params.river?{river:n.params.river}:{})}}; migrateRiverNode(m); return m; });   // reset, a stroke that fell back follows the world again
  selected=-1;alsoSelected=[]; pathPoint=-1; pathAdding=false; evaluate(0); regionalFields.changed(); checkpoint(); queueWeather(); schedule();
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
addEventListener('pagehide',() => { worldInputQueue.flush();if (!stroke && !moving && !loading && !keepSaved) saveWorking(); });
// A save's strokes with their tools: one saved before strokes named their tool takes the one its section form belongs to, once (inferStrokeTools); a map carried
// from another world goes through carryNodes, and a loaded one keeps the tools the toolbar has (any other shows as the generic landform). `own`: the map's tools.
const savedStrokes=(list,carry,own,tables) => { const ids=toolIds(own),saved=inferStrokeTools(list,ids); return carry?carryNodes(saved,own,tables):keepStrokeTools(saved,ids); };
function loadSketch(s,carry=false) {
  if (!s || s.format!=='nanolathe-terrain-sculpt' || s.version!==6 || s.size!==size || s.grid!==grid || !Array.isArray(s.nodes) || s.nodes.some(n => !n)) throw new Error('Load a map stroke graph with the same canvas and grid size.');
  const column=copyColumn(s.column),rock=copyRockSettings(s.rock),rocks=copyRocks(s.rocks),materials=copyMaterials(s.materials),own=copyMapTools(s.tools)??[],ids=toolIds(own);
  const supplied=rocks??worldRocks(config),adopted=surfaceMaterials(config.surface,adoptWorldMaterials(materials,config,{carried:carry}),{config,nodes:s.nodes,rocks:supplied}),staged=instantiateWorldKit(config,activeWorld(),{rocks:supplied,materials:adopted,source:s.worldSettings??{},append:s.worldSettings?.rocks!==undefined});
  const next=deserializeNodes(savedStrokes(s.nodes,carry,own,staged));
  // Reject damaged saves before committing any pending edit to the old map.
  worldInputQueue.flush();worldStoreTransaction++;try{
  if(!carry&&rock)setRockSettings(rock);
  cancelWeather(); refined=refinedBase=regionalWeather=null; dropGpuWeather();
  seed=Number.isInteger(s.seed)?clamp(s.seed,0,4294967295):2701; varySeed=s.varySeed!==false; refinementSeed=Number.isInteger(s.refinementSeed)?clamp(s.refinementSeed,0,4294967295):seed; $('seed').value=seed;
  // A button's saved brush card counts only if it holds no removed option (savedToolCard); otherwise it starts from the button's preset.
  // Carried into another world, the brush cards and the world's sliders stay at that world's defaults; a selected tool this world lacks gives way to
  // the generic Landform, which takes its card's numbers. The map's own tools go with it, their cards as saved.
  restoreMapTools(own,true);
  if (ids.has(s.tool)) tool=s.tool;
  else if (carry && typeof s.tool==='string' && s.toolSettings?.[s.tool]) { tool=LANDFORM_TOOL.id; toolSettings[tool]=savedToolCard(config,tool,{...s.toolSettings[s.tool],preset:'custom'})||toolCard(tool); }
  if (!carry) for (const id of ids) {const entry=toolById(id),saved=savedCard(id,s.toolSettings?.[id])||{};if(authoredWorldTool(entry)){if(entry.rock)delete saved.rockPreset;if(entry.ground)delete saved.groundPreset;}toolSettings[id]={...toolCard(id),...saved};}
  showTool(toolSettings[tool]);
  if (!carry) for (const [key,[id,lo,hi]] of Object.entries(TOOL_FIELDS)) if (Number.isFinite(s[key])) setShapeControl(id,clamp(s[key],lo,hi));
  if (!carry) for (const [key,id,lo,hi] of [['softness','softness',0,100],['relief','relief',0,160],['mineralRing','mineral-ring',0,100],['ringSpread','ring-spread',0,100],['ringVariation','ring-variation',0,100],['materialWeathering','material-weathering',0,100],['depositSpread','deposit-spread',0,100],['transitionDetail','transition-detail',0,100]]) if (Number.isFinite(s[key])) $(id).value=clamp(s[key],lo,hi);
  if (typeof s.weather==='boolean') $('weather').checked=s.weather;
  if (typeof s.clay==='boolean') $('clay').checked=s.clay;
  if (['original','alternate'].includes(s.light)) $('light').value=s.light;
  syncDrawInputs();
  restoreColumn(column);syncColumnPanel();
  mapRocks=staged.rocks;mapMaterials=staged.materials;if(staged.reason)status(staged.reason); syncMaterialChoices();materialEditor?.refresh();materialEditor?.resetView(); rockSelected=0; syncRockChoices(); syncRockPanel(); nodes=keepStrokeMaterials(keepStrokeRocks(next,mapRocks),mapMaterials); selected=-1;alsoSelected=[];pathIndex=0;pathPoint=-1;pathAdding=false;drawMode=tool==='move'?'select':'new'; evaluate(0); restoreMapData(s.mapData);renderLayers(); updateControls(); queueWeather();
  // The tools' cards still on a world's preset name their rock among this map's presets, now that the map's list is in.
  for (const id of ids) if (Object.hasOwn(config.worldShapes||{},toolSettings[id]?.preset)) toolSettings[id]=shapeCard(id,toolSettings[id].preset);
  for(const t of worldToolList??[])if(authoredWorldTool(t)){const resolved=resolvedWorldCard(t,mapRocks,mapMaterials,config);if(t.rock)toolSettings[t.id].rockPreset=resolved.rockPreset;if(t.ground)toolSettings[t.id].groundPreset=resolved.groundPreset;}
  showTool(toolSettings[tool]); updateControls(); surfacePanel?.refresh();
  }finally{worldStoreTransaction--;saveWorlds();}
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
  pickCard?.close();   // another map: the card's pixel is gone
  if(!s || s.format!=='nanolathe-terrain-sculpt' || s.version!==6 || !Array.isArray(s.nodes) || s.nodes.some(n=>!n))throw new Error('Load a map stroke graph.');
  const biome=typeof s?.biome==='string'?s.biome:'';
  const savedId=s.worldSettings?savedWorldId(s):(typeof s.world==='string'&&worlds[s.world]?.base===biome?s.world:biome);
  const mapChanged=(s?.map?.unitsX??0)!==(config.map?.unitsX??0) || (s?.map?.unitsY??0)!==(config.map?.unitsY??0) || (s?.map && s.seaLevel!==config.seaLevel);
  if (biome && (biome!==config.biomeId || savedId!==worldId || s.worldSettings!==undefined || mapChanged)) {
    let served=false;
    try {
      const response=await fetch(configUrl(biome));
      const servedConfig=response.ok?await response.json():null;
      served=servedConfig?.biomeId===biome;
      if(served)copySavedWorld(s.worldSettings,servedConfig);
      copyMapTools(s.tools);copyColumn(s.column);copyRockSettings(s.rock);copyRocks(s.rocks);copyMaterials(s.materials);s.nodes.forEach(checkedHeights);
    } catch (err) { error(err.message); return false; }
    if (!served) { error(`The saved terrain belongs to the ${biome} world, which this server does not have. The current terrain was left as it was.`); return false; }
    const token=Math.random().toString(36).slice(2)+Date.now().toString(36);
    try { await stashPendingSketch(token,s); }
    catch (err) { error('The saved terrain could not be carried to '+biome+': '+err.message); return false; }
    status(`Opening ${biome} for the saved terrain…`);
    leavingForWorld=true;
    goToWorld(biome,savedId,{pendingSketch:token,shared:openingShared?1:'',mapX:s.map?.unitsX??'',mapY:s.map?.unitsY??'',sea:s.map?s.seaLevel:''});
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
// A height image a save holds, checked (its size, its samples, its numbers): one the engine cannot draw is an error before the map changes.
function checkedHeights(n,i) { return n?.kind==='heights'?heightsNode(n,`Height image (stroke ${i+1})`):null; }
function deserializeNodes(list) {
  return list.filter(n=>n&&NODE_NAMES[n.kind]).map(n=>{
    if(n.kind==='heights')return checkedHeights(n,list.indexOf(n));
    validatePaths(n);
    return {kind:n.kind,...(n.kind==='landform'?{tool:n.tool,...(n.kept?{kept:true}:{})}:{}),hidden:Boolean(n.hidden),amplitude:n.amplitude,wavelength:n.wavelength,coverage:n.coverage,art:n.art,seed:n.seed,params:n.params?{...n.params}:undefined,points:n.points?.map(p=>({...p})),paths:clonePaths(n),frame:Array.isArray(n.frame)&&n.frame.length===6&&n.frame.every(Number.isFinite)?n.frame.slice():undefined};
  });
}
function download(blob,name) { const url=URL.createObjectURL(blob),a=document.createElement('a'); a.href=url; a.download=name; a.click(); setTimeout(() => URL.revokeObjectURL(url),1000); }
// The palette's buttons, fixed and built, by delegation (the shape buttons are built once the world's config is in).
document.querySelector('.tool-groups').addEventListener('click',event => {
  const b=event.target.closest('[data-tool]');if(!b)return;
  if(stroke||moving)return;const unavailable=toolUnavailable(toolById(b.dataset.tool));if(unavailable){status(unavailable);return;}mapFeatures?.deactivate();leavePick();rememberTool();tool=b.dataset.tool;drawMode=tool==='move'?'select':'new';pathAdding=false;
  // A card still on a world's preset is made afresh, so the rock its tool names is the map's preset as the map holds it now (added, moved or gone).
  if(Object.hasOwn(config.worldShapes||{},toolSettings[tool]?.preset))toolSettings[tool]=shapeCard(tool,toolSettings[tool].preset);
  if(authoredWorldTool(toolById(tool))){const entry=toolById(tool),resolved=resolvedWorldCard(entry,mapRocks,mapMaterials,config);if(entry.rock)toolSettings[tool].rockPreset=resolved.rockPreset;if(entry.ground)toolSettings[tool].groundPreset=resolved.groundPreset;}
  if(tool==='move'&&selected>=0)selectNode(selected);
  else{selected=-1;alsoSelected=[];pathPoint=-1;renderLayers();showTool(toolSettings[tool]);}
  updateControls();schedule();persistLater();
});
for (const id of ['diameter','amount','roughness','softness','cracks']) $(id).addEventListener('input',() => { rememberTool(true); updateControls(); schedule(); persistLater(); if (selected>=0) editSelectedFromControls(); });
for (const id of ['diameter','amount','roughness','softness','cracks']) $(id).addEventListener('change',() => { if (selected>=0) { checkpoint(); queueWeather(); } });
for (const [id,kind] of [['node-seed','seed'],['node-delete','delete'],['node-up','up'],['node-down','down'],['node-hide','hide']]) $(id).addEventListener('click',() => nodeAction(kind));
// Features and Starts are two entries on the rail for the one tool (sculpt-features.js): Features opens it to place, Starts in its starts mode.
const openFeatures=mode=>{if(stroke||moving)return;leavePick();selected=-1;alsoSelected=[];pathAdding=false;drawMode='select';mapFeatures?.activate(mode);renderLayers();updateControls();};
$('feature-tool').onclick=()=>openFeatures('deposit');$('starts-tool').onclick=()=>openFeatures('starts');
function setPathMode(on){if(stroke||moving||loading)return;if(on)alsoSelected=[];pathEditing=on;pathPoint=-1;pathAdding=false;drawMode='select';updateControls();schedule();}
$('edit-path').onclick=()=>setPathMode(!pathEditing);$('transform-mode').onclick=()=>setPathMode(false);
$('canvas-deselect').onclick=()=>selectNode(-1);
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
$('draw-new').onclick=()=>{if(stroke||moving||loading)return;const ids=toolIds(),n=nodes[selected],candidate=n?.params?strokeTool(n,ids):tool,entry=ids.has(candidate)&&candidate!=='move'?candidate:firstTool();document.querySelector(`[data-tool="${CSS.escape(entry)}"]`)?.click();};
$('draw-add').onclick=()=>{if(stroke||moving||loading||!nodes[selected]?.points||nodes[selected].hidden)return;alsoSelected=[];drawMode='add';pathEditing=false;pathAdding=false;pathPoint=-1;updateControls();schedule();};
for(const [id,value] of [['rotate-left',-Math.PI/12],['rotate-right',Math.PI/12],['scale-down',1/1.1],['scale-up',1.1]])$(id).onclick=()=>changeSelected(n=>transformNode(n,nodeState(n),about(nodePivot(n),id.startsWith('rotate')?rotation(value):scaling(value))));
document.addEventListener('terraform-feature-mode',()=>updateControls());
document.addEventListener('terraform-status',event=>{featureNotice=event.detail;status(event.detail);});
$('tool-style').addEventListener('change',() => {
  const preset=$('tool-style').value;if(!Object.hasOwn(config.worldShapes||{},preset))return;
  // A selected landform takes that world's version of its tool's shape.
  const n=nodes[selected],id=n?.params?strokeTool(n,toolIds()):tool;toolSettings[tool]=shapeCard(id,preset);showTool(toolSettings[tool],toolKind(id));
  if(selected>=0){editSelectedFromControls({curve:toolSettings[tool].curve,along:toolSettings[tool].along});checkpoint();queueWeather();}
  updateControls();schedule();persistLater();
});
// Look (#tool-look): another shape tool for the selected landform and for the next stroke. The size, height, rock and ground the artist set (where
// they differ from the old tool's own) stay; the rest of the card, its curves included, becomes the new tool's. One undo step.
const LOOK_KEPT=['diameter','heightReference','elevation','amount','rockPreset','groundPreset'];
$('tool-look').addEventListener('change',() => {
  const next=$('tool-look').value,ids=toolIds();if(stroke||moving||!toolById(next))return;const unavailable=toolUnavailable(toolById(next));if(unavailable){status(unavailable);return;}
  const n=nodes[selected],editing=selected>=0&&n?.kind==='landform'&&Boolean(n.params),from=editing?strokeTool(n,ids):tool;
  const now={};for(const [key,[id]] of Object.entries(TOOL_FIELDS))now[key]=Number($(id).value);
  const was=toolCard(from),card=toolCard(next);
  for(const key of LOOK_KEPT)if(Number.isFinite(now[key])&&now[key]!==was[key])card[key]=now[key];
  mapFeatures?.deactivate();
  if(!editing||tool!=='move'){rememberTool();tool=next;drawMode=editing?drawMode:'new';toolSettings[next]=card;}
  showTool(card,toolKind(next));
  if(editing){n.tool=next;editSelectedFromControls({curve:card.curve,along:card.along});checkpoint();queueWeather();}
  else{selected=-1;alsoSelected=[];pathPoint=-1;renderLayers();}
  updateControls();schedule();persistLater();
});
// Save as tool (in a selected landform's options): a button in this map's toolbar that draws with the shape's settings as the panel shows them, its curves and
// its rock, after the world's tools in the group of the tool the shape was drawn with. One undo step; strokes are not changed. Delete (on a map tool's brush)
// takes the button away; shapes drawn with it keep their numbers and show as Landform.
let toolSaveFor='',toolSaveIcon=LANDFORM_TOOL.icon;
function pickToolIcon(icon) {
  toolSaveIcon=icon;
  for (const b of $('tool-save-icons').children) b.setAttribute('aria-checked',String(b.dataset.iconChoice===icon));
}
for (const b of $('tool-save-icons').children) b.onclick=() => pickToolIcon(b.dataset.iconChoice);
function prefillToolSave(n) {
  const from=toolById(strokeTool(n,toolIds()))??LANDFORM_TOOL,taken=new Set(shapeTools().map(t => t.label));
  let k=2; while (taken.has(`${from.label} ${k}`)) k++;
  $('tool-save-to').value=worldId in (config.biomes??{})?'map':'world';
  const families=[...new Set((worldToolList??[]).filter(t=>t.group==='shape').map(t=>t.family).filter(Boolean))];$('tool-save-family').replaceChildren(new Option('Other',''),...families.map(f=>new Option(f,f)));$('tool-save-family').value=from.family??'';
  $('tool-save-name').value=`${from.label} ${k}`; $('tool-save-color').value=from.color; $('tool-save-icons').style.setProperty('--choice-color',from.color); pickToolIcon(from.icon);
}
function syncToolSave(locked,featureActive) {
  const n=nodes[selected],saving=!featureActive && tool==='move' && n?.kind==='landform' && Boolean(n.params);
  $('tool-save').hidden=!saving;
  if (saving) {
    const key=`${selected}:${n.tool}`; if (toolSaveFor!==key) { toolSaveFor=key; prefillToolSave(n); }
    const toWorld=$('tool-save-to').value==='world',from=toolById(strokeTool(n,toolIds()))??LANDFORM_TOOL,full=(toWorld?(worldToolList??[]).filter(authoredWorldTool).length:mapTools.length)>=MAP_TOOLS_MAX,named=Boolean($('tool-save-name').value.trim());
    $('tool-save-family-row').hidden=!toWorld||from.group!=='shape';$('tool-save-description').textContent=toWorld?'Save this shape’s settings, curves, rock and material in the world for every new map.':'Save this shape’s settings, curves and rock with this map only.';
    $('tool-save-button').disabled=locked || full || !named;
    $('tool-save-note').textContent=full?`This ${toWorld?'world':'map'} holds ${MAP_TOOLS_MAX} authored tools: delete one to save another.`:named?'':'Give the tool a name.';
  } else toolSaveFor='';
  $('tool-delete-control').hidden=featureActive || !mapTools.some(t => t.id===tool)&&!authoredWorldTool(toolById(tool));
}
$('tool-save-to').onchange=()=>updateControls();
$('tool-save-name').addEventListener('input',() => updateControls());
$('tool-save-color').addEventListener('input',() => $('tool-save-icons').style.setProperty('--choice-color',$('tool-save-color').value));
$('tool-save-button').onclick=() => {
  const n=nodes[selected]; if (stroke || moving || loading || !ready || tool!=='move' || n?.kind!=='landform') return;
  const from=toolById(strokeTool(n,toolIds()))??LANDFORM_TOOL;
  const card={...Object.fromEntries(Object.entries(TOOL_FIELDS).map(([key,[id]]) => [key,Number($(id).value)])),...(n.params.curve?{curve:structuredClone(n.params.curve)}:{}),...(n.params.along?{along:structuredClone(n.params.along)}:{})};
  try {
    const toWorld=$('tool-save-to').value==='world',spec={label:$('tool-save-name').value,icon:toolSaveIcon,color:$('tool-save-color').value,group:from.group,shape:shapeFrom(config,toolShape(from)),card};let id;
    if(toWorld){if(from.group==='shape'&&$('tool-save-family').value)spec.family=$('tool-save-family').value;const added=publishWorldTool(currentWorldKit,mapRocks,mapMaterials,spec);commitKitCandidate(added);id=added.id;}
    else{const added=addMapTool(mapTools,nodes,spec);restoreMapTools(added.tools);id=added.id;}
    toolSaveFor='';$('tool-save').open=false;checkpoint(true);
    status(`Saved ${toolLabel(id)} to ${toWorld?'the world “'+activeWorld().name+'”':'this map'}.`);
  } catch (err) { $('tool-save-note').textContent=err.message; }
};
$('tool-delete').onclick=() => {
  const entry=toolById(tool),world=authoredWorldTool(entry);if(stroke||moving||loading||!ready||!world&&!mapTools.some(t=>t.id===tool))return;
  const label=toolLabel(tool);
  if(world)commitKitCandidate({kit:{...currentWorldKit,tools:currentWorldKit.tools.filter(t=>t.id!==tool)},rocks:mapRocks,materials:mapMaterials});
  else restoreMapTools(deleteMapTool(mapTools,tool));
  checkpoint(true);status(`Deleted ${label} from ${world?'this world':'this map'}. Shapes drawn with it keep their settings and show as Landform.`);
};
// A surface slider redraws; the two the material field reads (TIME_SLIDER_IDS) run the Time pass again.
for(const id of SURFACE_SLIDER_IDS){
  $(id).addEventListener('input',()=>{const out=$(id).closest('.control')?.querySelector('output');if(out)out.textContent=$(id).value+'%';worldInputQueue.put('surface:'+id,{type:'surface'});});
  $(id).addEventListener('change',()=>worldInputQueue.end());
}
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
for(const id of ['clay','light'])$(id).addEventListener('change',()=>{worldInputQueue.put('view',{type:'surface'});worldInputQueue.end();});
$('weather').addEventListener('change',() => {
  cancelWeather(); worldChanged({channels:[{name:'weather',stage:'B'}]});
  if (!$('weather').checked) clearRendererWeather();
  schedule(); queueWeather(); persistLater();
});
$('undo').addEventListener('click',() => moveHistory(-1)); $('redo').addEventListener('click',() => moveHistory(1));
$('blank').addEventListener('click',() => { if (stroke) return; applySeedControl(); refinementSeed=seed; cancelWeather(); refined=refinedBase=null; dropGpuWeather(); clearRendererWeather(); nodes=[]; selected=-1;alsoSelected=[]; addGroundNode(); regionalFields.changed(); markChanged(); checkpoint(); status('Blank dry ground.'); schedule(); queueWeather(); });
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
    if (done) { showPrevious(); status('Your previous map is back.'); }
    else if (!leavingForWorld) keepPrevious(localStorage,text);   // the load failed: the slot stays
  } catch (err) { keepPrevious(localStorage,text); error(err.message); }
  finally { loading=false; $('editor').disabled=false; updateControls(); }
});
function announceShared() {
  status('Opened a shared map.'); shareMessage('Opened a shared map.'); showPrevious();
  if (!$('share-previous').hidden && $('pane-map').hidden) $('tab-map').click();
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
  // Escape first closes what is open on top of the editor (a tool flyout, a menu, the full-size curves, a menu inside the material editor),
  // wherever the focus is. Then Pick's card, then the docked material editor; once they are closed, Escape leaves Pick (below).
  if(event.key==='Escape'&&!stroke&&!moving&&(editorUI.closeTop()||pickCard?.close()||editorUI.closeDocked())){event.preventDefault();return;}
  if(!typing(event.target)&&!loading&&!stroke&&!moving&&!event.ctrlKey&&!event.metaKey&&!event.altKey){
    if(event.code==='KeyF'&&event.shiftKey){event.preventDefault();editorUI.toggleFocus();return;}
    if(event.key==='Escape'&&editorUI.exitFocus()){event.preventDefault();return;}
    // Tab on the map (not in a panel, where it moves between controls) hides both panels, and shows them again.
    if(event.key==='Tab'&&!event.shiftKey&&(event.target===overlay||event.target===document.body)){event.preventDefault();editorUI.toggleFocus();return;}
    if(event.code==='KeyV'){event.preventDefault();if(tool==='move'&&!mapFeatures?.active&&!picking)setPathMode(false);else document.querySelector('[data-tool="move"]').click();return;}
    if(event.code==='KeyI'){event.preventDefault();$('pick-tool').click();return;}
  }
  if (mapFeatures?.active && event.code!=='Space' && !(event.ctrlKey||event.metaKey)) return;
  if (event.defaultPrevented || typing(event.target) || loading) return;
  if(event.code==='KeyP'&&tool==='move'&&selected>=0&&!event.ctrlKey&&!event.metaKey&&!stroke&&!moving){event.preventDefault();setPathMode(!pathEditing);return;}
  if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase()==='z') { event.preventDefault(); moveHistory(event.shiftKey?1:-1); }
  if ((event.key==='Delete' || event.key==='Backspace') && pathEditing && pathPoint>=0 && selected>=0 && !stroke && !moving) {event.preventDefault();$('path-delete').click();return;}
  if(event.key==='Escape'&&!moving&&!stroke){event.preventDefault();if(!editorUI.exitFocus()){if(picking)setPicking(false);else if(pathAdding){pathAdding=false;updateControls();schedule();}else if(drawMode==='add'){drawMode='select';updateControls();schedule();}else if(pathEditing)setPathMode(false);else selectNode(-1);}return;}
  const arrow={ArrowLeft:[-1,0],ArrowRight:[1,0],ArrowUp:[0,-1],ArrowDown:[0,1]}[event.key];
  if(arrow&&tool==='move'&&selected>=0&&event.target===overlay&&!event.metaKey&&!event.ctrlKey&&!stroke&&!moving){
    if(pathEditing&&pathPoint<0){event.preventDefault();return;}
    event.preventDefault();const step=event.shiftKey?10:1,dx=arrow[0]*step,dy=arrow[1]*step;
    if(pathEditing&&pathPoint>=0)changeSelected(n=>{const p=n.points[pathPoint];p.x=clamp(p.x+dx,0,config.map.width-1);p.y=clamp(p.y+dy,0,config.map.height-1);});else moveSelectedShapes(dx,dy);return;
  }
  if ((event.key==='Delete' || event.key==='Backspace') && selected>=0 && !stroke && !moving) { event.preventDefault(); const count=Math.max(1,selectedShapes().length); nodeAction('delete'); status(count>1?`Deleted ${count} shapes.`:'Deleted the selected shape.'); }
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
const COLOR_HELP={shallowTone:'The tint of the shallows, kept as a shift of the water material\'s color, so recoloring the water moves its shallows too. Off: the world\'s own tint.',
  sun:'The direct light and the glints it mirrors. A warm sun lights slopes that face it.',sky:'The ambient light that fills the shade. A cool sky keeps shaded ground and the lee of hills blue.'};
let baseWorldConfig=null,worldStoreTransaction=0;
let worlds={},worldId=null,openedAsOwnWorld=null;   // the last: set when a map's world opened as a world of its own
function loadWorlds() { try { worlds=JSON.parse(localStorage.getItem(WORLD_STORE)||'{}')||{}; } catch (_) { worlds={}; } }
function saveWorlds() { if(worldStoreTransaction)return;try { localStorage.setItem(WORLD_STORE,JSON.stringify(worlds)); } catch (_) {} }
function activeWorld() { return worlds[worldId] ??= {name:config.biome,base:config.biomeId,colors:{...(config.colors||{})},knobs:{}}; }
const hexColor=c => '#'+c.map(v => Math.round(clamp(v,0,1)*255).toString(16).padStart(2,'0')).join('');
// A world's colors: the server's defaults for its base world, then the
// world's own choices; null means explicitly off (the texture's own color).
function mergedColors() { return worldHexColors(config,experiment,activeWorld().colors||{}); }
function worldColors() { return rendererColors(mergedColors()); }
// The world's column as the Rock column panel edits it: its bed tones shown as the colors they draw (the world's rock material's drawn color
// and each tone, sculpt-column.js toneColor), 0-255; editColumn turns a changed color back into its tone and keeps the others.
let columnShown=null;
function columnForEdit(){
  const column=structuredClone(config.column);if(!column)return column;
  const rock=rockDrawn(0),tones=columnTones(column);delete column.tones;
  column.colors=tones.map(t=>toneColor(rock,t).map(v=>Math.round(v*255)));columnShown={colors:structuredClone(column.colors),tones,own:Boolean(config.column?.tones)};
  return column;
}
// A rock slot's material's drawn color, [r, g, b] 0..1 (the plain gray the draw uses without one).
function rockDrawn(slot){const m=rockMaterialOf(slot);return m?drawnColor(m):[.33,.33,.33];}
function restoreColumn(column){
  columnOverride=column;config.column=column||defaultColumn;columnEditing=false;
  const change=worldChanged(renderer.setColors(worldColors(),currentDrawOptions()));
  if(change.timeChanged){cancelWeather();refined=refinedBase=null;dropGpuWeather();clearRendererWeather();}
  syncWorldControls();return change;
}
function editColumn(value){
  if(value?.colors){
    const rock=rockDrawn(0),shown=columnShown,changed=value.colors.map((c,i)=>!shown||c.some((v,k)=>v!==shown.colors[i]?.[k]));
    const tones=value.colors.map((c,i)=>changed[i]?colorTone(rock,c.map(v=>v/255)):shown.tones[i]);
    value={...value};delete value.colors;if(changed.some(Boolean)||shown?.own)value.tones=tones;
  }
  const column=copyColumn(value),next=sameColumn(column,defaultColumn)?null:column;
  if(sameColumn(next,columnOverride))return;
  const change=restoreColumn(next);columnEditing=true;if(change.timeChanged)queueWeather();persistLater();
}
function commitColumn(){if(!columnEditing)return;columnEditing=false;checkpoint();queueWeather();}
// The water material's drawn color, which Shallow water's tone shifts (its data's mean before there is one).
function waterDrawn(){const m=mapMaterials.find(m=>m.worldWater);return m?drawnColor(m):(config.water?.meanRGB||[0,0,0]).map(v=>v/255);}
// What a Colors row shows: Shallow water's tone (the world's own, else its data's) on the water's drawn color; a light's color, else white.
function shownColor(key,set) {
  if (key==='shallowTone') return hexColor(toneColor(waterDrawn(),set||waterTone(config,'shallow')||[0,0,0]));
  return set||hexColor([1,1,1]);
}
let refreshShallowRow=()=>{};
function goToWorld(base,id,extra) {
  worldInputQueue.flush();
  if (!stroke && !moving && !loading) saveWorking();   // the working map goes with the artist to the new world
  const url=new URL(location.origin+location.pathname); url.searchParams.set('biome',base); if (id && id!==base) url.searchParams.set('world',id);
  if (config.map) for (const [key,value] of Object.entries({mapX:config.map.unitsX,mapY:config.map.unitsY,sea:config.seaLevel})) url.searchParams.set(key,value);
  for (const [key,value] of Object.entries(extra||{})) if (value!=='' && value!==null && value!==undefined) url.searchParams.set(key,value); else url.searchParams.delete(key);
  location.href=url.toString();
}
// Your own worlds in this browser's store: each on a built-in world this server has.
const ownWorlds=() => Object.entries(worlds).filter(([id,w]) => !(id in (config.biomes||{})) && w.base in (config.biomes||{}));
// A new world of your own named `name`, made from the world `from` (World › New world, and Start a map's New world); returns its id, kept in
// the store. The world this page is in starts from its settings as they are now: its colors, the rows' values, its own materials, the map's
// feature set and its surface layers. Another world starts from what this browser keeps of it (a built-in nobody changed: nothing, so its
// defaults), as it would open.
function makeWorld(name,from=worldId) {
  const id=name.toLowerCase().replace(/[^a-z0-9]+/g,'-').replace(/^-|-$/g,'').slice(0,24)+'-'+Math.random().toString(36).slice(2,6);
  if (from===worldId) {
    const world=activeWorld(),knobs={...world.knobs}; for (const [,list] of KNOBS) for (const [key] of list) if (experiment.has(key)) knobs[key]=experiment.get(key);
    worlds[id]={...worldKit(baseWorldConfig,world),name,materials:worldOwnMaterials(mapMaterials,config),base:config.biomeId,colors:{...world.colors},knobs,featureSet:mapFeatures?.serialize().featureSet,...(world.surface?{surface:structuredClone(world.surface)}:{})};
  } else {
    const {openedFrom,...kept}=structuredClone(worlds[from]??{});
    worlds[id]={colors:{},knobs:{},...kept,name,base:worlds[from]?.base??from};
  }
  saveWorlds(); return id;
}
// Reset and history share one persistence boundary: intermediate material/surface restores never become saved defaults.
function configureStoredWorld(world,beach=world.knobs?.beachFrom){
  for(const key of ['defaults','engineDefaults','layers','material','materials','beachTable','featureSet']){
    if(baseWorldConfig[key]===undefined)delete config[key];else config[key]=structuredClone(baseWorldConfig[key]);
  }
  config.defaults={...config.defaults,...world.knobs};
  refreshWorldTools(world);
  for(const key of Object.keys(config.engineDefaults||{}))if(world.knobs?.[key]!==undefined)config.engineDefaults[key]=world.knobs[key];
  if(world.featureSet)config.featureSet=structuredClone(world.featureSet);
  const settings=new Map(beach?[['beachFrom',beach]]:[]);borrowBeach(config,settings);renderer.layers=new Set(config.layers);
}
function resetWorld(){
  worldInputQueue.flush();const reset=resetWorldOverrides(activeWorld());
  const base=worldMaterials(baseWorldConfig);let next=mapMaterials;
    for(const m of next.filter(worldKey)){
      const key=worldKey(m),source=base.find(b=>worldKey(b)===key);
      if(source)next=setMaterial(next,m.slot,source).map(x=>x.slot===m.slot?{...x,name:source.name}:x);
      else next=next.map(x=>{if(x.slot!==m.slot)return x;const own={...x};delete own[key.startsWith('layer:')?'worldLayer':key];return own;});
    }
  try{for(const source of base){const key=worldKey(source);if(!key||next.some(m=>worldKey(m)===key))continue;const added=addMaterial(next,source,source.name);next=added.materials.map(m=>m.slot===added.slot?{...m,[key.startsWith('layer:')?'worldLayer':key]:key.startsWith('layer:')?key.slice(6):true}:m);}}
  catch(err){status('Reset needs room for the built-in materials: '+err.message);return;}
  let resetKit;try{resetKit=resetWorldKitInstances(baseWorldConfig,currentWorldKit,mapRocks,next);next=resetKit.materials;}catch(err){status('Reset kept the map: '+err.message);return;}
  worldStoreTransaction++;
  try{
    configureStoredWorld(reset);worlds[worldId]=reset;mapRocks=resetKit.rocks;nodes=keepStrokeTools(nodes,toolIds());refreshWorldTools();
    const defaults=Object.fromEntries(KNOBS.flatMap(([,rows])=>rows.map(([key,,,,,value])=>[key,value])));
    for(const key of worldKeys(baseWorldConfig)){
      const value=baseWorldConfig.defaults?.[key]??baseWorldConfig.engineDefaults?.[key]??defaults[key];
      if(value===undefined){experiment.delete(key);renderer.variant.delete(key);}else if(key==='beachFrom'){experiment.set(key,String(value));}else applyKnob({key,value:String(value),settings:experiment,renderer,nodes,seed,sync:false});
      const input=$('knob-'+key);if(input&&value!==undefined){input.value=String(value);input.closest('[data-knob]').querySelector('output').textContent=String(value);}
    }
    restoreMaterials(next);setSurfaceList(structuredClone(baseSurface),false);
    worldChanged(renderer.setColors(worldColors(),currentDrawOptions()));cancelWeather();evaluate(0);queueWeather();
    const url=new URL(location.href);for(const key of worldKeys(baseWorldConfig)){const value=experiment.get(key);if(value==null)url.searchParams.delete(key);else url.searchParams.set(key,value);}window.history.replaceState(null,'',url);
    worlds[worldId]=reset;checkpoint();
  }finally{worldStoreDirty=false;worldStoreTransaction--;saveWorlds();}
  buildWorldPanel();syncRockChoices();syncRocks();syncRockPanel();syncWorldControls();surfacePanel?.refresh();updateControls();status('Reset world settings to '+baseWorldConfig.biome+'.');
}
for(const id of ['wsec-world','tab-world'])$(id).addEventListener('click',()=>requestAnimationFrame(syncWorldHome));
function openWorldHome(card){openWorldSection('wsec-world');syncWorldHome();const el=$('world-home-'+card);el?.scrollIntoView({block:'start'});el?.querySelector('button,input,select')?.focus({preventScroll:true});}
let worldHomeSummary='';
function syncWorldHome(){
  if(!baseWorldConfig||!renderer||!worldId||!$('world-home-rock-list')||!$('wpane-world').getClientRects().length)return;
  const count=worldOverrideCount(activeWorld(),baseWorldConfig);$('world-override-count').textContent=`${count} change${count===1?'':'s'} from ${baseWorldConfig.biome}`;
  const view=mapCanvas?.view(),used=new Set(),boxes=new Map();
  const box=n=>{if(boxes.has(n))return boxes.get(n);const p=shapeLines(n).flat(),r=claimReach(n),b={x0:Math.min(...p.map(p=>p.x))-r,x1:Math.max(...p.map(p=>p.x))+r,y0:Math.min(...p.map(p=>p.y))-r,y1:Math.max(...p.map(p=>p.y))+r};boxes.set(n,b);return b;};
  const intersects=(a,b)=>a.x0<=b.x1&&a.x1>=b.x0&&a.y0<=b.y1&&a.y1>=b.y0;
  const rect=view?{x0:view.x,x1:view.x+view.width,y0:view.y,y1:view.y+view.height}:null;
  for(let i=0;i<nodes.length;i++){const n=nodes[i];if(n.kind!=='landform'||n.hidden||!n.points?.length||!rect||!intersects(box(n),rect))continue;
    const slot=strokeRock(n,mapRocks);for(const k of slot<0?rocksBeneath(nodes,i,mapRocks,m=>intersects(box(m),rect)&&intersects(box(m),box(n))):[slot])used.add(k);
  }
  const rocks=[{slot:0,name:worldRockName(config)},...mapRocks].map(r=>({slot:r.slot,name:r.name,used:used.has(r.slot),color:hexColor(rockDrawn(r.slot))}));
  const layers=surfacePanel?.summary()??[],state=JSON.stringify([rocks,layers]);if(state===worldHomeSummary)return;worldHomeSummary=state;
  const list=$('world-home-rock-list');list.replaceChildren();
  for(const rock of rocks){const line=document.createElement('div'),b=document.createElement('button');b.type='button';b.className='world-home-rock';b.dataset.slot=rock.slot;b.innerHTML='<span class="material-chip" aria-hidden="true"></span><span></span><span class="world-use-dot" aria-label="Used by a shape in view"></span>';b.children[0].style.background=rock.color;b.children[1].textContent=rock.name;b.children[2].hidden=!rock.used;b.onclick=()=>{openWorldSection('wsec-rock-types');selectRock(rock.slot);};line.append(b);if(!rock.used){const note=document.createElement('p');note.className='small';note.textContent=`Nothing in view uses ${rock.name}.`;line.append(note);}list.append(line);}
  const surface=$('world-home-layers');surface.replaceChildren();
  for(const layer of layers.filter(l=>l.section==='drawing')){const b=document.createElement('button');b.type='button';b.className='link world-home-layer';b.textContent=`${layer.name} · Coverage: ${layer.coverage}`;b.onclick=()=>{openWorldSection('wsec-surface');surfacePanel.open(layer.key);};surface.append(b);}
  const drawing=layers.filter(l=>l.section==='drawing').length;$('world-home-layer-count').textContent=`${drawing} draw here · ${layers.length-drawing} more`;
}
function buildWorldPanel() {
  const world=activeWorld();
  $('world-name').textContent=world.name;
  for(const b of document.querySelectorAll('[data-world-card]'))b.onclick=()=>openWorldHome(b.dataset.worldCard);
  for(const b of document.querySelectorAll('[data-world-section]'))b.onclick=()=>openWorldSection('wsec-'+b.dataset.worldSection);
  $('world-home-layer-add').onclick=()=>{openWorldSection('wsec-surface');$('surface-add').click();};
  $('world-scope-tag').textContent=`Every map in ${world.name}`;$('world-scope-tag').title=`World settings: every map drawn in ${world.name} shows them. Rows tagged This map are saved with the map.`;
  const select=$('biome-select');
  const builtIn=Object.entries(config.biomes||{}).map(([id,name]) => new Option(name,'biome:'+id,false,worldId===id));
  const custom=ownWorlds().map(([id,w]) => new Option(w.name+' (custom)','world:'+id,false,worldId===id));
  select.replaceChildren(...builtIn,...custom);
  select.onchange=() => { const [kind,id]=select.value.split(':'); if (kind==='biome') goToWorld(id); else goToWorld(worlds[id].base,id); };
  for(const home of document.querySelectorAll('[data-world-color]'))home.replaceChildren();
  for (const [key,label] of colorRows(config,experiment)) {
    const rows=document.querySelector(`[data-world-color="${key}"]`);
    const row=document.createElement('div'); row.className='color-row';
    const set=mergedColors()[key];
    row.innerHTML=`<span>${label}</span><input type="checkbox" aria-label="Use a base color for ${label}"${set?' checked':''}><input type="color" aria-label="${label} base color" value="${shownColor(key,set)}">`;
    const [box,pick]=row.querySelectorAll('input');
    // Shallow water keeps the pick as a tone of the water's drawn color (sculpt-column.js colorTone), as the Rock column's beds do.
    const value=() => key==='shallowTone'?colorTone(waterDrawn(),rgbColor(pick.value)):pick.value;
    const apply=() => setWorldColor(key,box.checked?value():null);
    if (key==='shallowTone') refreshShallowRow=() => { if (document.activeElement!==pick) pick.value=shownColor(key,mergedColors()[key]); };
    box.addEventListener('change',()=>{apply();worldInputQueue.end();});pick.addEventListener('input',()=>{box.checked=true;apply();});pick.addEventListener('change',()=>worldInputQueue.end());
    rows.append(row);
    if (COLOR_HELP[key]) { const help=document.createElement('p'); help.className='small'; help.textContent=COLOR_HELP[key]; rows.append(help); }
  }
  // Beach: a world without a beach of its own may take another world's sand (sculpt-scene.js borrowBeach); choosing reloads the page.
  const beaches=Object.entries(config.beachSources||{}).filter(([id]) => id!==config.biomeId);
  if (beaches.length && (!config.layers.includes('beach') || config.beachTable)) {
    const beachRow=document.createElement('div'); beachRow.className='control';
    beachRow.innerHTML=`<label for="beach-from">Beach</label><select id="beach-from" style="width:100%"><option value="">None</option>${beaches.map(([id,b]) => `<option value="${id}">${b.name}</option>`).join('')}</select><p class="small">Another world's beach sand along this world's shores. Beach width below sets its reach.</p>`;
    document.querySelector('#knobs [data-slot="beach-from"]').replaceChildren(beachRow);
    $('beach-from').value=config.beachSources[experiment.get('beachFrom')]?experiment.get('beachFrom'):'';
    $('beach-from').onchange=() => setKnob('beachFrom',$('beach-from').value);
  }
  $('world-reset').onclick=resetWorld;
  $('world-save-as').onclick=()=>{const row=$('world-save-row');row.hidden=!row.hidden;$('world-save-as').setAttribute('aria-expanded',String(!row.hidden));if(!row.hidden)$('world-new-name').focus();};
  $('world-new').onclick=() => {
    const name=$('world-new-name').value.trim(); if (!name) { $('world-new-name').focus(); status('Name the new world first.'); return; }
    goToWorld(config.biomeId,makeWorld(name));
  };
  $('world-export').onclick=() => download(new Blob([JSON.stringify({format:'nanolathe-map-world',version:1,world:{...world,...worldKit(baseWorldConfig,world),materials:structuredClone(worldKept(mapMaterials)),knobs:{...world.knobs},featureSet:mapFeatures?.serialize().featureSet}},null,1)],{type:'application/json'}),(world.name||'world').replace(/[^\w-]+/g,'_')+'.world.json');
  $('world-import').onclick=() => $('world-file').click();
  $('world-file').onchange=async () => {
    try {
      const data=JSON.parse(await $('world-file').files[0].text()),w=data?.world;
      if (data?.format!=='nanolathe-map-world' || !w || typeof w.name!=='string' || !(w.base in (config.biomes||{}))) throw new Error('Not a world file for a world this server has.');
      const id=w.name.toLowerCase().replace(/[^a-z0-9]+/g,'-').slice(0,24)+'-'+Math.random().toString(36).slice(2,6);
      const response=await fetch(configUrl(w.base));if(!response.ok)throw Error('The world’s base could not be read.');const base=applyWorldRock(await response.json()),checked=copySavedWorld({...w,colors:w.colors??{},knobs:w.knobs??{}},base);
      worlds[id]=checked;
      saveWorlds(); goToWorld(w.base,id);
    } catch (err) { error(err.message); }
  };
  const isCustom=!(worldId in (config.biomes||{}));
  $('world-delete').hidden=!isCustom;$('world-delete').textContent='Delete this world';
  $('world-delete').onclick=() => { delete worlds[worldId]; saveWorlds(); goToWorld(config.biomeId); };
  // A world a map brought (its world differed from yours): say so, and offer to make it yours. Your earlier one stays, renamed.
  const from=worlds[worldId]?.openedFrom,target=from?(worlds[from.world]?.name||config.biomes?.[from.world]||from.world):'';
  $('world-from').hidden=$('world-adopt').hidden=!from;
  if (from) {
    $('world-from').textContent=`Opened from the map “${from.map}”, whose world differs from your ${target}. Your ${target} is unchanged.`;
    $('world-adopt').textContent=`Use for my ${target}`;
    $('world-adopt').onclick=() => {
      const {openedFrom,...adopted}=worlds[worldId];
      if (worlds[from.world]) { const keep=`${target} before ${from.map}`.slice(0,120); worlds[keep.toLowerCase().replace(/[^a-z0-9]+/g,'-').replace(/^-|-$/g,'').slice(0,24)+'-'+Math.random().toString(36).slice(2,6)]={...worlds[from.world],name:keep}; }
      worlds[from.world]={...adopted,name:target}; delete worlds[worldId]; saveWorlds(); goToWorld(adopted.base,from.world);
    };
  }
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
  // Rendering sits with the graphics settings; every other group is a block in its rows' home in the World panel (sculpt-ui.js WORLD_HOMES).
  const group = (title, open = false) => { const d = document.createElement('details'); d.className = 'knobs-group'; d.open = open; const t = document.createElement('summary'); t.textContent = title; d.append(t); $('rendering-host').append(d); return d; };
  const render = group('Rendering',true);
  const toggle = (key, label, on, off, isOn) => {
    const row = document.createElement('label'); row.className = 'small'; row.style.display = 'flex'; row.style.gap = '6px';
    const box = document.createElement('input'); box.type = 'checkbox'; box.checked = isOn;
    box.addEventListener('change', () => setKnob(key, box.checked ? on : off));
    row.append(box, label); render.append(row);
  };
  toggle('palette', 'TA palette', 'nearest', 'off', params.get('palette') !== 'off');
  // Every knob needs a world default (materials/defaults.json knobs).
  const missing = [...KNOBS.flatMap(([, list]) => list.map(k => k[0])), ...SHAPE_FIELDS.map(f => f[0])].filter(k => !(k in (config.defaults || {})));
  if (missing.length) console.warn('Knobs without a world default:', missing.join(', '));
  const addKnob=(title,[key,label,min,max,step,value])=>{
      const id = 'knob-' + key, current = params.has(key) ? Number(params.get(key)) : value, choices = WORLD_CHOICES[key];
      // A value shows at most three decimals (Sun height's defaults are the old light's height, 45.20597821393736 degrees on most worlds).
      const cleanLabel=label.replace(/\s*\([^)]*\)/g,'');
      const wrap = controlRow({id,label:`${cleanLabel} <output${choices?' hidden':''}>${+current.toFixed(3)}</output>`,range:`min="${min}" max="${max}" step="${step}" value="${current}"`,choices});
      const home=worldHome(key),direct=home==='Rock types/Headline'||home.startsWith('World/');
      const {block:box,search}=direct?{block:document.querySelector(`[data-home="${home}"] .world-rows`),search:title}:worldGroup(title,key);
      wrap.dataset.knob=key;wrap.dataset.searchGroup=search+' '+label;wrap.querySelector('label').title=label;(wrap.querySelector('.scrub')||wrap).title=label;
      const input = wrap.querySelector('#'+id), out = wrap.querySelector('output');
      if(choices)input.value=String(current);
      input.addEventListener('input', () => { out.textContent = input.value; if (rockSelected>0 && ROCK_KEYS.includes(key)) setPresetKnob(key, Number(input.value)); else setKnob(key, input.value); });
      input.addEventListener('change',()=>worldInputQueue.end());
      if(key==='faceBlockSize'){const note=document.createElement('p');note.className='small rock-headline-note';note.textContent='Block size reads most clearly once Whole blocks are high.';wrap.append(note);}
      box.append(wrap);
  };
  for (const [title, knobs] of KNOBS) {
    if (title === 'Cracks') {
      const box=worldGroup(title,'crackSpacing').block;
      const wrap = document.createElement('div'); wrap.className = 'control';
      wrap.innerHTML = `<label for="crack-style">Style</label><select id="crack-style" style="width:100%"><option value="">Choose a style…</option>${Object.keys(CRACK_STYLES).map(k => `<option>${k}</option>`).join('')}</select><p class="small">How much each shape cracks is its own Cracks row, in the shape’s card.</p>`;
      wrap.querySelector('select').addEventListener('change', event => {
        const style = CRACK_STYLES[event.target.value]; if (!style) return;
        for (const [key, value] of Object.entries(style)) {
          const input = $('knob-' + key); if (input) { input.value = value; input.previousElementSibling.querySelector('output').textContent = value; }
          if (rockSelected>0 && ROCK_KEYS.includes(key)) setPresetKnob(key, value); else setKnob(key, value);   // the selected rock type's, as its sliders
        }
        worldInputQueue.end();
      });
      box.append(wrap);
    }
    for (const row of knobs) if(!ROCK_HEADLINES.includes(row[0])) addKnob(title,row);
  }
  for(const key of ROCK_HEADLINES){const [title,rows]=KNOBS.find(([,rows])=>rows.some(row=>row[0]===key));addKnob(title,rows.find(row=>row[0]===key));}
  const sync=mountWorldControlIndex(root,worldPanelValues);
  syncWorldControls=()=>{sync();$('rock-preset').value=rockSelected>0?rockRecipeFor(mapRocks.find(r=>r.slot===rockSelected)):rockPresetFor(rockSettings(),config.column);syncRockColors();materialEditor?.refreshPreview();};
  $('rock-preset').onchange=()=>{
    const key=$('rock-preset').value;
    // A preset started from a recipe takes its numbers, beds and colors, and its rock material (the recipe's color): the map's copy of it.
    if(rockSelected>0){
      if(!key)return;
      const slot=rockSelected,rocks=setRock(mapRocks,slot,recipeRock(key,config)).map(r=>r.slot===slot?(({material,...o})=>o)(r):r);
      try{const given=giveRockMaterials(rocks,mapMaterials,[slot],config,()=>key);assertLocalRockAddition(given);
      editMaterials(given.materials,given.rocks);rockUseKey='';syncRocks();syncRockChoices();checkpoint(true);}catch(error){status(error.message);}syncRockPanel();return;
    }
    const p=ROCK_PRESETS[key]||(key==='soil'?{knobs:recipeRock(key).knobs,sections:null}:null);if(!p)return;
    setRockSettings(p.knobs);
    if(p.sections)editColumn({...columnForEdit(),sections:structuredClone(p.sections)});   // Smooth soil keeps the world's beds
    if(columnEditing)commitColumn();else checkpoint(true);
    syncColumnPanel();syncWorldControls();
  };
  mountRockPanel();
  materialEditor?.dispose();materialEditor=mountMaterialEditor({suspend:on=>{materialCovers=on;if(!on&&materialTerrainDirty){materialTerrainDirty=false;evaluate(0);}mapCanvas?.setSuspended(on);if(!on&&materialWeatherPending)queueWeather();},dock:editor=>editorUI.dock(editor),worlds:()=>config.biomes||{},world:()=>config.biomeId,materials:()=>mapMaterials,strokes:()=>nodes,rocks:()=>mapRocks,renderer:()=>renderer,edit:editMaterials,delete:removeMaterial,checkpoint:()=>checkpoint(true),status,
    scope:m=>materialIsWorld(m)?`Every map in ${activeWorld().name}`:'This map',
    layerName:key=>{const names=(config.surface||[]).filter(l=>l.material===key).map(l=>l.name||BUILTIN_LABELS[l.builtin]||l.builtin);return names.length?names.join(', '):null;}});
  surfacePanel=mountSurfacePanel(surfaceHost());$('map-view-show').onclick=()=>surfacePanel?.showAll();
}
// The facts the World panel enables a row by (sculpt-knobs.js worldPanelValues, which worldControlRequirement reads).
const panelFacts=() => ({config,renderer,nodes,materials:mapMaterials,colors:worldColors(),weathering:weatherOn(),materialWeathering:surfaceValues()['material-weathering']});
function worldPanelValues() {
  const values=worldPanelValuesOf(panelFacts()),rock=mapRocks.find(r=>r.slot===rockSelected);
  return rock?{...values,...rock.knobs}:values;   // a selected preset's rows are enabled by its own numbers
}
// Rock changes share the editor's history and recipe, including the existing
// material controls used by the geological starting points.
function rockSettings(){return Object.fromEntries(ROCK_KEYS.map(k=>[k,Number(renderer.variant.get(k)??config.defaults[k])]));}
// The rest of the World panel an undo step restores (the rock rows ride in `rock`): every other World row as drawn, and the world's colors.
function worldUndoState(){
  const knobs={};
  for(const [,rows] of KNOBS)for(const [key] of rows){if(key==='beachFrom'||ROCK_KEYS.includes(key))continue;const v=renderer.variant.get(key)??config.defaults?.[key];if(v!==undefined&&v!==null)knobs[key]=String(v);}
  return {knobs,colors:structuredClone(activeWorld().colors||{}),stored:structuredClone(activeWorld()),beachFrom:experiment.get('beachFrom')};
}
// Back to a step's World rows and colors, through the same queue the sliders use; a restore adds no undo step of its own.
function restoreWorldState(w){
  if(w.stored){configureStoredWorld(w.stored,w.beachFrom);if(w.beachFrom==null)experiment.delete('beachFrom');else experiment.set('beachFrom',w.beachFrom);const url=new URL(location.href);if(w.beachFrom==null)url.searchParams.delete('beachFrom');else url.searchParams.set('beachFrom',w.beachFrom);window.history.replaceState(null,'',url);}
  let any=false;
  for(const [key,value] of Object.entries(w.knobs||{}))if(String(renderer.variant.get(key)??config.defaults?.[key])!==value){
    worldInputQueue.put('knob:0:'+key,{type:'knob',slot:0,key,value,restore:true});any=true;
    const input=$('knob-'+key);if(input){input.value=value;const out=input.closest('[data-knob]')?.querySelector('output');if(out)out.textContent=value;}   // the row shows it, as a rock row's undo does
  }
  if(w.colors&&JSON.stringify(activeWorld().colors||{})!==JSON.stringify(w.colors)){worldInputQueue.put('colors',{type:'colors',value:w.colors,restore:true});any=true;}
  if(any)worldInputQueue.flush();
}
function setRockSettings(values){
  worldInputQueue.flush();
  const url=new URL(location.href);let changed=false;
  for(const [key,value] of Object.entries(values)){
    if(!ROCK_KEYS.includes(key))continue;
    if(Number(renderer.variant.get(key))!==value)changed=true;
    experiment.set(key,String(value));renderer.variant.set(key,String(value));activeWorld().knobs[key]=String(value);url.searchParams.set(key,String(value));
    const input=$('knob-'+key);if(input){input.value=value;input.closest('[data-knob]').querySelector('output').textContent=value;}
  }
  window.history.replaceState(null,'',url);saveWorlds();
  if(!changed)return;
  worldChanged(renderer.applyKnobs());syncWorldControls();persistLater();
}
// ---- Rock presets (B2): the World pane's list. The selected preset's numbers fill the rock rows and its beds the Rock column panel. ----
const rockNote=text => { $('rock-presets-note').textContent=text; $('rock-presets-note').hidden=!text; };
// The selected preset as a recipe: a preset of the list, or slot 0 as the world has it now.
function selectedRock() {
  return mapRocks.find(r=>r.slot===rockSelected)||worldRock(worldRockName(config),Object.fromEntries(ROCK_KEYS.map(k=>[k,renderer.variant.get(k)??config.defaults[k]])),config.column);
}
// A new list (an edit of the selected preset, an add or a delete): the renderer follows when a stroke uses a changed preset (syncRocks).
function editRocks(rocks) { const captured=worldStoreTransaction?null:stageWorldKitEdit(config,currentWorldKit,rocks,mapMaterials);const before=rockUseKey;mapRocks=rocks;if(captured){mapMaterials=captured.materials;if(!sameKitData(captured.kit,currentWorldKit))installWorldKit(captured.kit);} nodes=keepStrokeRocks(nodes,mapRocks); syncRockChoices(); syncRocks(); if(before===rockUseKey)worldChanged({stage:null},{world:false});persistLater(); }
// One rock row moved while a preset is selected: that preset's number, not the world's (no address, no saved world).
function setPresetKnob(key,value) { worldInputQueue.put('knob:'+rockSelected+':'+key,{type:'knob',slot:rockSelected,key,value}); }
// The list, the name, the buttons (each disabled one saying why), the rock rows' values and the Rock column panel, for the selected preset.
// The world's own rock types (config.rock.recipes) join the Add list's last group, which index.html holds empty.
function syncRockAdd(){const g=$('rock-add-world'),types=currentWorldKit?.rocks??[];g.replaceChildren(...types.map(r=>new Option(r.name,'world:'+r.key)));g.hidden=!types.length;}
function syncRockPanel() {
  if(!renderer||!$('knob-rockFace'))return;   // before the World pane is built
  if(!mapRocks.some(r=>r.slot===rockSelected))rockSelected=0;
  const list=$('rock-presets'),world=rockSelected===0,full=mapRocks.length>=ROCK_SLOTS-1;
  list.replaceChildren(new Option(`${worldRockName(config)} (the world's rock)`,'0'),...mapRocks.map(r=>new Option(r.name,String(r.slot))));
  list.value=String(rockSelected);
  const focusedChip=$('rock-chips').contains(document.activeElement);
  $('rock-chips').replaceChildren(...[...list.options].map(option=>{
    const slot=Number(option.value),chip=document.createElement('button'),swatch=document.createElement('span'),name=slot===0?worldRockName(config):option.textContent;
    chip.type='button';chip.className='rock-chip';chip.setAttribute('role','radio');chip.setAttribute('aria-checked',String(slot===rockSelected));chip.dataset.slot=option.value;chip.tabIndex=slot===rockSelected?0:-1;chip.title=slot===0?`${name}: the world\u2019s rock type`:name;
    swatch.className='rock-swatch';swatch.style.background=rockHex(slot);chip.append(swatch,name);
    chip.onkeydown=e=>{const keys=['ArrowRight','ArrowDown','ArrowLeft','ArrowUp','Home','End'];if(!keys.includes(e.key))return;e.preventDefault();const chips=[...$('rock-chips').children],i=chips.indexOf(chip),next=e.key==='Home'?0:e.key==='End'?chips.length-1:(i+(e.key==='ArrowRight'||e.key==='ArrowDown'?1:-1)+chips.length)%chips.length;chips[next].click();$('rock-chips').querySelector('[aria-checked=true]').focus();};
    chip.onclick=()=>{list.value=option.value;list.dispatchEvent(new Event('change'));};
    return chip;
  }));
  if(focusedChip)$('rock-chips').querySelector('[aria-checked=true]').focus();
  $('rock-current-name').textContent=world?worldRockName(config):mapRocks.find(r=>r.slot===rockSelected).name;
  const owned=world||Boolean(mapRocks.find(r=>r.slot===rockSelected)?.worldKey);
  $('rock-current-scope').textContent=world?'The world\u2019s rock type: every shape\u2019s default. Edits change the world.':owned?`This world’s rock type. Edits change every map in ${activeWorld().name}.`:'This map\u2019s rock type. Saved with the map.';
  $('rock-current-tag').textContent=owned?`Every map in ${activeWorld().name}`:'This map';$('rock-current-tag').className='scope-tag '+(owned?'scope-world':'scope-map');
  $('rock-current-swatch').style.background=rockHex(rockSelected);
  if(document.activeElement!==$('rock-name'))$('rock-name').value=world?worldRockName(config):mapRocks.find(r=>r.slot===rockSelected).name;
  $('rock-name').disabled=$('rock-rename').disabled=world;$('rock-delete').disabled=world;$('rock-duplicate').disabled=$('rock-add').disabled=full;
  const fullNote=full?'This map holds 15 rock types besides the world\u2019s, the most it can: delete one to add another.':'';
  rockNote(world?'The world\u2019s rock type keeps its recipe\u2019s name and cannot be deleted: every shape that chooses no other is made of it.':fullNote);$('rock-add').title=$('rock-duplicate').title=fullNote;
  const values=world?null:{...Object.fromEntries(ROCK_KEYS.map(k=>[k,Number(renderer.variant.get(k)??config.defaults[k])])),...mapRocks.find(r=>r.slot===rockSelected).knobs};
  for(const key of ROCK_KEYS){const input=$('knob-'+key);if(!input)continue;const v=values?values[key]:Number(renderer.variant.get(key)??config.defaults[key]);if(!Number.isFinite(v))continue;input.value=v;input.closest('[data-knob]').querySelector('output').textContent=+v.toFixed(3);}
  syncWorldControls();syncColumnPanel();syncRockColors();
}
// The color a material is drawn in (sculpt-renderer.js drawnColor: the GPU's mean of it), what the Color pickers show and move.
const drawnColor=m=>renderer?.drawnColor?renderer.drawnColor(m):materialColor(m);
// Rock types the map had no room to give their own material (giveRockMaterials): they show the world's rock material, and the status says so.
function noteMissedRocks(given) { if(given.missed.length)status(`No room for the rock material of ${given.missed.join(', ')}: ${given.missed.length>1?'they show':'it shows'} the world\u2019s rock material. Remove a material to make room.`); }
// A rock type's material: its own, else the world's rock material (slot 0's), or null when the world has none.
function rockMaterialOf(slot) {
  const own=slot>0?mapRocks.find(r=>r.slot===slot)?.material:0;
  return (own>0&&mapMaterials.find(m=>m.slot===own))||mapMaterials.find(m=>m.worldRock)||null;
}
// A rock type's color as its faces wear it: its material's Color ('#rrggbb'), the draw's fixed gray without one.
const hexOfRgb=rgb=>'#'+rgb.map(v=>Math.round(Math.min(1,Math.max(0,v))*255).toString(16).padStart(2,'0')).join('');
function rockHex(slot) { const m=rockMaterialOf(slot); return m?hexOfRgb(drawnColor(m)):'#545454'; }
// The selected rock type's Color picked: its material's Color (recolorMaterial). The world's rock recolors the world's rock material; another
// rock type recolors its own material, or first takes its own copy of the one it shares (the world's rock material, or one another rock type,
// a world surface or a layer draws), so no other surface moves with it.
// `slot` is the selected rock type's unless another is named (the Pick card's swatch): World's selection stays as it is.
function setRockColor(hex,commit,slot=rockSelected) {
  const m=rockMaterialOf(slot);if(!m)return;
  const rgb=[1,3,5].map(i=>parseInt(hex.slice(i,i+2),16)/255),rock=mapRocks.find(r=>r.slot===slot);
  const shared=slot>0&&rockColorShared(rock,m);
  try{
    if(!shared)editMaterials(setMaterial(mapMaterials,m.slot,recolorMaterial(m,rgb,drawnColor(m))));
    else{
      const added=addMaterial(mapMaterials,recolorMaterial(m,rgb,drawnColor(m)),rock.name);
      const rocks=mapRocks.map(r=>r.slot===slot?{...r,material:added.slot}:r);assertKitMaterials(added.materials);editMaterials(added.materials,rocks);rockUseKey='';syncRocks();materialEditor?.refresh();
    }
  }catch(error){status(error.message);return;}
  // Every chip's swatch (rock types that share the recolored material move with it), and the selected rock type's own row when it moved.
  for(const chip of $('rock-chips').children)chip.querySelector('.rock-swatch').style.background=rockHex(Number(chip.dataset.slot));
  if(slot===rockSelected){$('rock-current-swatch').style.background=rockHex(slot);const snap=renderer.paletteNearest(hex);$('rock-color-snap').style.background=snap;$('rock-color-snap').title=$('rock-color-snap').ariaLabel=`Palette entry ${snap}`;}
  else if(rockMaterialOf(rockSelected)?.slot===rockMaterialOf(slot)?.slot)$('rock-current-swatch').style.background=rockHex(rockSelected);
  if(commit){checkpoint(true);syncRockMaterial();if(slot!==rockSelected)syncRockColors();}
}
let bedShown=null;   // the bed colors the Rock types pane shows and the tones behind them (a changed picker sets only its own tone)
// The selected preset's colors: its rock's (its material's Color), and its beds' and absorption's own, or the world's where it takes them
// (World's colors), each with the palette entry the game draws.
const BED_COLOR_IDS=[1,2,3,4,5].map(i=>'rock-bed-'+i);
function syncRockColors() {
  if(!renderer||!$('rock-color'))return;
  const world=rockSelected===0,rock=mapRocks.find(r=>r.slot===rockSelected),own=rock?.colors,shown=renderer.slotColors(0);
  const paint=(id,hex,off)=>{$(id).value=hex;$(id).disabled=off;const snap=renderer.paletteNearest(hex);$(id+'-snap').style.background=snap;$(id+'-snap').title=$(id+'-snap').ariaLabel=`Palette entry ${snap}`;};
  if(document.activeElement!==$('rock-color'))paint('rock-color',rockHex(rockSelected),!rockMaterialOf(rockSelected));
  // Every chip in its own rock type's color: a material another rock type shares (the world's rock) may have moved them all.
  $('rock-current-swatch').style.background=rockHex(rockSelected);for(const chip of $('rock-chips').children)chip.querySelector('.rock-swatch').style.background=rockHex(Number(chip.dataset.slot));
  // Its beds: its own tones, else the world column's, shown as the colors they draw on this rock type's material.
  const rock2=rockDrawn(rockSelected),tones=own?.beds??columnTones(config.column);bedShown={slot:rockSelected,tones,colors:tones.map(t=>hexOfRgb(toneColor(rock2,t)))};
  BED_COLOR_IDS.forEach((id,k)=>{if(document.activeElement!==$(id))paint(id,bedShown.colors[k],world||!own?.beds);});
  $('rock-beds-world').checked=world||!own?.beds;
  $('rock-beds-world').disabled=world;
  // The absorption color (Rock translucency): a preset's own or the world's; on the world's rock, the world's choice (none: the rock's own hue).
  const worldAbsorb=mergedColors().absorb||null;
  paint('rock-absorb',world?worldAbsorb||shown.absorb:own?.absorb||shown.absorb,world?!worldAbsorb:!own?.absorb);
  $('rock-absorb-world').checked=world?!worldAbsorb:!own?.absorb;
  $('rock-colors-note').textContent=!rockMaterialOf(rockSelected)?'The world has no rock material, so its rock is a plain gray: choose a Surface material to give it a Color.'
    :world?'The world\u2019s rock beds take the Rock column\u2019s material slot colors, under Layers; Absorption here is the world\u2019s own.'
    :!own?.beds||!own?.absorb?'A color under World\u2019s colors follows the world\u2019s: clear World\u2019s colors to choose this rock type\u2019s own.':'';
  $('rock-colors-note').hidden=!$('rock-colors-note').textContent;
  syncRockMaterial();
}
// The selected rock type's surface material (grain, grit, shine): on the world's rock, the map's world rock material (choosing one assigns
// that role); on another, the world's rock material or any of the map's other materials.
function syncRockMaterial() {
  const select=$('rock-material'),world=rockSelected===0,rock=mapRocks.find(r=>r.slot===rockSelected),own=mapMaterials.find(m=>m.worldRock);
  const choices=mapMaterials.filter(m=>world?!roleOf(m)||m.worldRock:!roleOf(m));   // a material that draws another of the world's surfaces is not offered
  select.replaceChildren(...(world?[]:[new Option(own?`World rock material (${own.name})`:'World rock material (none)','0')]),...choices.map(m=>new Option(m.name,String(m.slot))));
  if(world&&!own)select.prepend(new Option('None (plain gray)',''));
  select.value=world?(own?String(own.slot):''):String(rock?.material||0);
  $('rock-material-note').textContent=world?'The world\u2019s rock material: what every rock type without its own shows. Edit it in Materials, in the top bar.':'';
  $('rock-material-note').hidden=!$('rock-material-note').textContent;
}
$('rock-material').onchange=()=>{
  const v=Number($('rock-material').value);
  if(rockSelected===0){ if(v>0){ try{editMaterials(assignMaterial(mapMaterials,v,'worldRock'));checkpoint();}catch(error){status(error.message);} } }
  else { try{editMaterials(mapMaterials,mapRocks.map(r=>r.slot===rockSelected?(({material,...o})=>v>0?{...o,material:v}:o)(r):r));rockUseKey='';syncRocks();syncMaterials();worldChanged({stage:'C',world:false});checkpoint();}catch(error){status(error.message);} }
  materialEditor?.refresh(); syncRockColors();
};
// A color of the selected preset changed (live while the picker moves; one undo step when it is let go).
function setPresetColors(colors,commit) {
  if(rockSelected===0)return;
  for(const [key,value]of Object.entries(colors))worldInputQueue.put('preset-color:'+rockSelected+':'+key,{type:'presetColor',slot:rockSelected,key,value});
  if(commit)worldInputQueue.end();
}
function selectRock(slot) { worldInputQueue.flush();rockSelected=slot; syncRockPanel(); }
// A rock type added from a starting recipe or the world's rock type `key`, with its material where the map has room; its slot. The caller checkpoints.
function finishRockAddition(added,scope=$('rock-save-to').value){
  if(scope==='world'&&added.existingWorldKey){commitKitCandidate({kit:currentWorldKit,rocks:added.rocks,materials:added.materials});}
  else if(scope==='world'){const published=publishWorldRock(currentWorldKit,added.rocks,added.materials,added.slot);commitKitCandidate(published);}
  else{assertLocalRockAddition(added);editMaterials(added.materials,added.rocks);rockUseKey='';syncRockChoices();syncRocks();}
  status(`Added ${mapRocks.find(r=>r.slot===added.slot).name} to ${scope==='world'?'the world “'+activeWorld().name+'”':'this map'}.`);return added.slot;
}
function assertLocalRockAddition(added){if(added.missed?.length)throw Error('This rock type needs another material slot; remove a material first.');}
function addRockType(key,recipe=null) {
  if(key?.startsWith('world:')){const t=currentWorldKit.rocks.find(r=>r.key===key.slice(6));if(!t)throw Error('That world rock type is missing.');const added=addWorldRockInstance(t,mapRocks,mapMaterials);
    if($('rock-save-to').value==='world'&&!mapRocks.some(r=>r.worldKey===t.key)){added.existingWorldKey=t.key;added.rocks=added.rocks.map(r=>r.slot===added.slot?{...r,worldKey:t.key}:r);}
    else added.rocks=renameRock(added.rocks,added.slot,uniqueRockName(mapRocks,t.name,worldRockName(config)));
    return finishRockAddition(added);}
  const added=addRock(mapRocks,recipe?'soil':key,worldRockName(config),config);let rocks=added.rocks;
  if(recipe)rocks=renameRock(setRock(rocks,added.slot,recipe),added.slot,uniqueRockName(mapRocks,recipe.name,worldRockName(config)));
  const given=giveRockMaterials(rocks,mapMaterials,[added.slot],config,r=>r.slot===added.slot?(recipe?.key??key):r.key);assertLocalRockAddition(given);
  return finishRockAddition({...given,slot:added.slot});
}
function mountRockPanel() {
  $('rock-presets').onchange=()=>selectRock(Number($('rock-presets').value));
  const shown=()=>renderer.slotColors(0);
  // World's colors cleared: the preset starts from the colors it shows (the world's), so nothing changes until one is moved.
  $('rock-beds-world').onchange=()=>setPresetColors({beds:$('rock-beds-world').checked?null:structuredClone(columnTones(config.column))},true);
  $('rock-color').oninput=()=>setRockColor($('rock-color').value,false);$('rock-color').onchange=()=>setRockColor($('rock-color').value,true);
  // A bed's color picked: its tone on this rock type's material (sculpt-column.js colorTone); the beds not touched keep theirs.
  const bedColors=commit=>{const rock=rockDrawn(rockSelected),shownNow=bedShown;if(!shownNow||shownNow.slot!==rockSelected)return;
    setPresetColors({beds:BED_COLOR_IDS.map((id,k)=>$(id).value===shownNow.colors[k]?shownNow.tones[k]:colorTone(rock,[1,3,5].map(i=>parseInt($(id).value.slice(i,i+2),16)/255)))},commit);};
  for(const id of BED_COLOR_IDS){$(id).oninput=()=>bedColors(false);$(id).onchange=()=>bedColors(true);}
  // The absorption color: a preset's (as its other colors), or on the world's rock the world's own 'absorb' color (saved with the world's colors).
  const worldAbsorb=value=>setWorldColor('absorb',value);
  const absorbColor=commit=>{if(rockSelected===0)worldAbsorb($('rock-absorb').value);else setPresetColors({absorb:$('rock-absorb').value},commit);};
  $('rock-absorb').oninput=()=>absorbColor(false);$('rock-absorb').onchange=()=>{absorbColor(true);if(rockSelected===0)worldInputQueue.end();};
  $('rock-absorb-world').onchange=()=>{const off=$('rock-absorb-world').checked;if(rockSelected===0){worldAbsorb(off?null:shown().absorb);worldInputQueue.end();}else setPresetColors({absorb:off?null:shown().absorb},true);};
  $('rock-add').onchange=()=>{
    const key=$('rock-add').value;$('rock-add').value='';if(!key)return;
    try{const slot=addRockType(key);selectRock(slot);checkpoint(true);}catch(err){rockNote(err.message);}
  };
  $('rock-duplicate').onclick=()=>{
    try{const copy=duplicateRock(mapRocks,rockSelected,selectedRock());finishRockAddition({...copy,materials:mapMaterials});selectRock(copy.slot);checkpoint(true);}catch(err){rockNote(err.message);}
  };
  const rename=()=>{
    if(rockSelected===0)return;
    try{const rocks=renameRock(mapRocks,rockSelected,$('rock-name').value);if(JSON.stringify(rocks)===JSON.stringify(mapRocks))return;editRocks(rocks);syncRockPanel();checkpoint(true);}catch(err){rockNote(err.message);}
  };
  $('rock-rename').onclick=rename;$('rock-name').onkeydown=e=>{if(e.key==='Enter')rename();};
  // Deleting a preset sends its strokes to Rock beneath in the same undo step: the shapes claim again, so the terrain is evaluated.
  $('rock-delete').onclick=()=>{
    if(rockSelected===0)return;
    const name=mapRocks.find(r=>r.slot===rockSelected).name,gone=deleteRock(mapRocks,nodes,rockSelected),moved=nodes.filter((n,i)=>n!==gone.nodes[i]).length;
    const owned=mapRocks.find(r=>r.slot===rockSelected)?.worldKey;
    if(owned){const tools=currentWorldKit.tools.map(t=>{if(!authoredWorldTool(t)||t.rock!==owned)return t;const {rock:_,...rest}=t;return {...rest,card:{...rest.card,rockPreset:-1}};});installWorldKit({tools,rocks:currentWorldKit.rocks.filter(r=>r.key!==owned)});refreshWorldTools();}
    cancelWeather();nodes=gone.nodes;editRocks(gone.rocks);selectRock(0);evaluate(0);checkpoint();queueWeather();
    status(`Deleted the rock preset ${name}${moved?`; ${moved} shape${moved===1?'':'s'} now keep the rock beneath`:''}.`);
  };
  // Copy and Paste a recipe (JSON on the clipboard): its name, numbers and beds, to compare two sets of numbers or move one between maps and worlds.
  $('rock-copy').onclick=async()=>{
    try{await navigator.clipboard.writeText(rockRecipeText(selectedRock()));rockNote('');status('Copied the rock recipe to the clipboard.');}catch(err){rockNote('The clipboard could not be written: '+err.message);}
  };
  $('rock-paste-new').onclick=async()=>{
    try{const recipe=parseRockRecipe(await navigator.clipboard.readText()),slot=addRockType(recipe.key,recipe);selectRock(slot);checkpoint(true);rockNote('');}catch(err){rockNote(err.message);}
  };
  $('rock-paste').onclick=async()=>{
    try{
      const recipe=parseRockRecipe(await navigator.clipboard.readText());
      if(rockSelected===0){setRockSettings(recipe.knobs);if(recipe.column)editColumn({...columnForEdit(),sections:recipe.column.sections});if(columnEditing)commitColumn();else checkpoint(true);syncColumnPanel();}
      else{editRocks(setRock(mapRocks,rockSelected,recipe));checkpoint(true);}
      // The world's rock wears the world's colors (Colors & base pattern): a recipe's own colors land on presets only.
      syncRockPanel();rockNote(rockSelected===0&&recipe.colors?'The world\u2019s rock keeps the world\u2019s colors; the recipe\u2019s numbers and beds were pasted. Paste on a preset to take its colors too.':'');status(`Pasted the rock recipe ${recipe.name}.`);
    }catch(err){rockNote(err.message);}
  };
  syncRockPanel();
}
// A world row's change: address, world store, panel and renderer settings, then
// the shape or Time work requested by the shared applyKnob operation.
const pendingWorldAddress=new Map();let worldStoreDirty=false,worldPanelDirty=false,worldCheckpoint=false;
const worldInputQueue=createWorldInputQueue({apply:applyWorldInputs,commit:commitWorldInputs});
function setKnob(key,value) { worldInputQueue.put('knob:0:'+key,{type:'knob',slot:0,key,value}); }
function setWorldColor(key,value) { worldInputQueue.put('color:'+key,{type:'color',key,value}); }
function applyWorldInputs(batch) {
  let colors=false,presets=false,reload=false;const nexts=[];
  for(const input of batch){
    if(input.type==='surface'){syncDrawInputs();continue;}
    if(input.type==='color'){
      const world=activeWorld();world.colors=pickWorldColor(config,world.colors,input.key,input.value);colors=worldStoreDirty=worldCheckpoint=true;continue;
    }
    if(input.type==='colors'){activeWorld().colors=structuredClone(input.value);colors=worldStoreDirty=worldPanelDirty=true;continue;}   // an undo step's colors
    const {key,value,slot}=input;
    if(input.type==='presetColor'){
      const rock=mapRocks.find(r=>r.slot===slot);if(!rock)continue;
      mapRocks=setRockColors(mapRocks,slot,{...rock.colors,[key]:value});presets=worldCheckpoint=true;continue;
    }
    if(slot>0){
      const rock=mapRocks.find(r=>r.slot===slot);if(!rock)continue;
      mapRocks=setRock(mapRocks,slot,{knobs:{...rock.knobs,[key]:Number(value)},column:rock.column});presets=worldCheckpoint=true;continue;
    }
    const next=applyKnob({key,value,settings:experiment,renderer,nodes,seed,sync:false});nexts.push(next);reload ||= Boolean(next.reload);
    activeWorld().knobs[key]=String(value);pendingWorldAddress.set(key,String(value));worldStoreDirty=true;
    worldPanelDirty ||= key==='strata';worldCheckpoint ||= !input.restore;
  }
  if(reload){commitWorldInputs();location.reload();return;}
  const local=presets?syncRocks({defer:true}):null,onlyPresets=batch.every(input=>input.slot>0);
  // setColors writes the complete block too, including the knobs just stored.
  // Otherwise the batch has exactly one applyKnobs call, regardless of input count.
  const delta=colors?renderer.setColors(worldColors(),currentDrawOptions()):renderer.applyKnobs(currentDrawOptions());
  if(!delta.fields.length&&!delta.channels.length)for(const next of nexts)if(next.unknownInput){delta.channels.push({name:next.unknownInput,stage:'A'});delta.stage='A';}
  const change=worldChanged(delta,onlyPresets?{world:false,rect:local?.rect??null}:{world:true});
  if(change.timeChanged){
    cancelWeather();const from=nexts.filter(n=>n.evaluate!==undefined).map(n=>n.evaluate);
    if(from.length&&change.channels.some(c=>c.name==='shape'))evaluate(Math.min(...from));
    queueWeather();
  }
}
function commitWorldInputs() {
  mapCanvas?.releaseInput();
  if(pendingWorldAddress.size){const url=new URL(location.href);for(const [key,value]of pendingWorldAddress)url.searchParams.set(key,value);window.history.replaceState(null,'',url);pendingWorldAddress.clear();}
  if(worldStoreDirty){worldStoreDirty=false;saveWorlds();}
  if(worldPanelDirty){worldPanelDirty=false;buildWorldPanel();}
  syncWorldControls();updateControls();surfacePanel?.sync();   // World › Surface's sections follow the settings that turn layers on
  if(worldCheckpoint){worldCheckpoint=false;checkpoint(true);}
  persistLater();
}
// Values must reach the model before a different action reads its recipe.
document.addEventListener('pointerdown',e=>{if(!e.target.closest('[data-knob],.world-colors'))worldInputQueue.flush();},true);
document.addEventListener('click',e=>{if(e.target.closest('button'))worldInputQueue.flush();},true);
document.addEventListener('keydown',e=>{if((e.metaKey||e.ctrlKey)&&['z','y','s'].includes(e.key.toLowerCase()))worldInputQueue.flush();},true);

async function bootMap(pending=null) {
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
  if(!experiment.has('newMap'))addGroundNode();
  mapCanvas=await mountMapCanvas({config,canvas,overlay,api:sculptRegion,drawOptions:currentDrawOptions});
  if (regionalFields.paged) { pagedCoarseStarted=true; regionalFields.subscribe(() => mapCanvas.schedule()); regionalFields.startCoarse().catch(() => {}); }   // H5b: the overview's coarse lattice fills in the background
  renderer=mapCanvas.renderer; renderer.onerror=message => error(message); materialUseKey='[]'; syncMaterials();
  // A material's drawn color read back (sculpt-material-cache.js readMeans): the Color pickers show it.
  renderer.onmeans=()=>{syncRockColors();refreshShallowRow();surfacePanel?.refresh();materialEditor?.refreshColors?.();pickCard?.colors();};   // the world's ground and water are materials: a renderer has none until told
  worldChanged(renderer.setColors(worldColors()));$('export').textContent='Save view image';
  buildKnobs(); buildWorldPanel();
  // The Rock column panel edits the selected preset's beds: the world's column for slot 0, a preset's own sections (its copy of the world's
  // until edited; Restore gives it the world's again).
  const presetColumn=()=>{const rock=mapRocks.find(r=>r.slot===rockSelected),own=config.column?.sections||[];return {column:{sections:structuredClone(rock.column?.sections??own)},bedColors:renderer.slotColors(rockSelected).beds,edited:Boolean(rock.column)};};
  const editPresetColumn=column=>{const rock=mapRocks.find(r=>r.slot===rockSelected);editRocks(setRock(mapRocks,rockSelected,{knobs:rock.knobs,column:{sections:column.sections??[]}}));};
  syncColumnPanel=mountColumnPanel(()=>rockSelected>0?presetColumn():({column:columnForEdit(),bedColors:renderer.slotColors(0).beds,edited:Boolean(columnOverride)}),
    column=>rockSelected>0?editPresetColumn(column):editColumn(column),()=>rockSelected>0?checkpoint(true):commitColumn(),
    ()=>{if(rockSelected>0){const rock=mapRocks.find(r=>r.slot===rockSelected);editRocks(setRock(mapRocks,rockSelected,{knobs:rock.knobs,column:null}));checkpoint(true);}else{editColumn(null);commitColumn();}});
  let saved=null; try { if (LOCAL_KEY && !experiment.has('pendingSketch') && !experiment.has('newMap')) saved=localStorage.getItem(LOCAL_KEY); } catch (_) {}
  if (saved) {
    try {
      const s=JSON.parse(saved),same=s.biome===config.biomeId && (s.world||s.biome)===worldId;
      loadSketch(s,!same); status(same?'Restored your saved map recipe.':'Carried your working map into this world.');
    } catch (err) { keepSaved=true; error('Saved map could not be loaded: '+err.message+' The saved copy is retained until you edit.'); }
  }
  else status('Blank map ready · draw terrain with the existing tools.');
  ready=true; $('editor').disabled=false; $('world-editor').disabled=false;
  history=[{nodes:cloneNodes(),refinementSeed,mapData:mapData(),column:structuredClone(columnOverride),rock:rockSettings(),world:worldUndoState(),rocks:structuredClone(mapRocks),surface:structuredClone(config.surface),materials:structuredClone(mapMaterials),tools:structuredClone(mapTools),terrainKey:++historySerial}]; historyIndex=0; renderLayers();
  if (pending) { try {
    loadSketch(pending);
    // The one-use handoff is consumed. A refresh must restore the imported working map.
    const shared=experiment.has('shared'),url=new URL(location.href);
    for(const key of ['pendingSketch','shared']){experiment.delete(key);url.searchParams.delete(key);}
    window.history.replaceState(null,'',url);checkpoint();status('Loaded the saved map.');if(shared)announceShared();
    if(openedAsOwnWorld){   // said in the status line and in the Map menu, which a shared map opens
      const note=`Opened in its own world, “${openedAsOwnWorld.name}”: the map’s world differs from your ${openedAsOwnWorld.mine}, which is unchanged. World › Use for my ${openedAsOwnWorld.mine} adopts it.`;
      status(note);$('map-world-note').textContent=note;$('map-world-note').hidden=false;if(shared&&$('pane-map').hidden)$('tab-map').click();
    }
  } catch (err) { error('The handed-over terrain could not be loaded: '+err.message); } }
  $('levels').textContent=`Dry base ${config.baseHeight} · sea ${config.seaLevel} · heights ${MIN_HEIGHT}…${MAX_HEIGHT}`;
  updateControls(); resize(); schedule(); queueWeather();
  $(experiment.has('newMap')?'fit':'one').click();   // a new map opens at Fit, to see all of it; every other load at 1x, centered on the map
  await openSharedMap();
  $('new-map').disabled=false;showPrevious();
  if(experiment.has('newMap')){const url=new URL(location.href);url.searchParams.delete('newMap');$('map-name').value=url.searchParams.get('mapName')||'Untitled map';$('map-name').dispatchEvent(new Event('input'));url.searchParams.delete('mapName');window.history.replaceState(null,'',url);saveWorking();}
  else if(!saved&&!location.search&&!$('new-map-dialog').open)openNewMap(true);
  newMapReady();
}
// New and first run share one picker and the existing previous-map slot. The picker needs no GPU: a first visit opens it as soon as the
// world list is read (boot), and Create only goes to the new map's address. Open a map file and New world wait for the editor (newMapReady).
const firstVisit=() => { if (location.search) return false; try { return !LOCAL_KEY || !localStorage.getItem(LOCAL_KEY); } catch (_) { return true; } };
function newMapReady() { for (const id of ['new-map-open','new-map-world','new-map-world-make']) $(id).disabled=!ready; }
function openNewMap(first=false, dimensionsFromMap=null) {
  const dialog=$('new-map-dialog'); let picked=worldId;   // a built-in world's id, or one of your own worlds'
  $('new-map-title').textContent=first?'Start a map':'New map';
  $('new-map-cancel').hidden=$('new-map-previous').hidden=first;
  $('new-map-error').textContent='';
  // The cards: the built-in worlds, each with its picture and its line (site.json), then your own worlds, each from its built-in one.
  const choices=() => [...Object.entries(config.biomes||{}).map(([id,name]) => ({id,name,line:config.biomeDescriptions?.[id]||'',picture:`ui-previews/world-${id}.png`})),
    ...ownWorlds().map(([id,w]) => ({id,name:w.name,line:`Yours · from ${config.biomes[w.base]}`}))];
  const pick=id => { picked=id; for (const b of $('new-map-worlds').children) b.setAttribute('aria-pressed',String(b.dataset.world===id)); $('new-map-world-from').textContent=choices().find(c => c.id===id)?.name||''; };
  const cards=() => { $('new-map-worlds').replaceChildren(...choices().map(({id,name,line,picture}) => {
    const b=document.createElement('button'); b.type='button'; b.dataset.world=id;
    // Every card has the same picture box: a world without a picture (one of your own, or a missing file) shows a plain one that says so.
    const none=() => { const box=document.createElement('span'); box.className='new-map-no-picture'; box.textContent='No picture yet'; return box; };
    if (picture) { const image=document.createElement('img'); image.onerror=() => image.replaceWith(none()); image.src=picture; image.alt=''; image.width=260; image.height=190; b.append(image); } else b.append(none());
    const title=document.createElement('span'); title.className='new-map-world-name'; title.textContent=name;
    const note=document.createElement('span'); note.className='new-map-world-line'; note.textContent=line;
    b.append(title,note); b.onclick=() => pick(id); return b;
  })); pick(choices().some(c => c.id===picked)?picked:config.biomeId); };
  cards();
  // New world: named here, made as World › New world makes one (makeWorld), from the world picked; its card is picked. The page stays.
  const row=$('new-map-world-row'),showRow=on => { row.hidden=!on; $('new-map-world').setAttribute('aria-expanded',String(on)); };
  showRow(false); $('new-map-world-name').value='';
  $('new-map-world').onclick=() => { showRow(row.hidden); if (!row.hidden) $('new-map-world-name').focus(); };
  const make=() => { const name=$('new-map-world-name').value.trim(); if (!name) { $('new-map-world-name').focus(); return; } if (!ready) return; picked=makeWorld(name,picked); showRow(false); $('new-map-world-name').value=''; cards(); };
  $('new-map-world-make').onclick=make;
  $('new-map-world-name').onkeydown=e => { if (e.key==='Enter') { e.preventDefault(); make(); } };   // not the form's Create
  newMapReady();
  // The sizes: four squares, each named, or Custom, which alone shows Width and Height.
  $('new-map-width').value=dimensionsFromMap?.x??config.map?.unitsX??4;$('new-map-height').value=dimensionsFromMap?.y??config.map?.unitsY??4;
  const square=n => [4,8,12,16].includes(n);
  let custom=!(square(Number($('new-map-width').value))&&$('new-map-width').value===$('new-map-height').value);
  const dimensions=()=>{const m=mapGeometry(Number($('new-map-width').value),Number($('new-map-height').value));$('new-map-pixels').textContent=`${m.width} × ${m.height} pixels`;$('new-map-custom').hidden=!custom;for(const b of $('new-map-sizes').children)b.setAttribute('aria-pressed',String(custom?b.dataset.size==='custom':Number(b.dataset.size)===m.unitsX&&m.unitsX===m.unitsY));};
  $('new-map-name').value='Untitled map';
  for(const b of $('new-map-sizes').children)b.onclick=()=>{custom=b.dataset.size==='custom';if(!custom)$('new-map-width').value=$('new-map-height').value=b.dataset.size;dimensions();if(custom)$('new-map-width').focus();};
  $('new-map-open').onclick=()=>{if(!ready)return;dialog.close();$('load').click();};
  $('new-map-width').oninput=$('new-map-height').oninput=dimensions;dimensions();
  dialog.oncancel=e=>{if(first)e.preventDefault();};$('new-map-cancel').onclick=()=>dialog.close();
  $('new-map-form').onsubmit=e=>{e.preventDefault();if(!e.target.reportValidity())return;
    if(!first&&!keepPrevious(localStorage,JSON.stringify(workingCopy()))){$('new-map-error').textContent='Your previous map could not be kept. Save it as a file before starting a new map.';return;}
    clearTimeout(autosaveTimer);keepSaved=true;
    const own=!(picked in (config.biomes||{}))&&worlds[picked];
    const url=new URL(location.origin+location.pathname);url.searchParams.set('biome',own?own.base:picked);if(own)url.searchParams.set('world',picked);url.searchParams.set('mapName',$('new-map-name').value.trim()||'Untitled map');url.searchParams.set('mapX',$('new-map-width').value);url.searchParams.set('mapY',$('new-map-height').value);url.searchParams.set('newMap','1');if(dimensionsFromMap)url.searchParams.set('sea',dimensionsFromMap.sea);location.href=url;
  };
  dialog.showModal();
}
document.addEventListener('terraform-new-map',e=>{if(ready&&!loading&&!stroke&&!moving)openNewMap(false,e.detail);});
$('new-map').onclick=()=>{if(ready&&!loading&&!stroke&&!moving)openNewMap();};
async function boot() {
  try {
    await requestAdapter();   // a browser without WebGPU, or an adapter below the engine's limits, gets a plain message before anything loads
    services=await (await fetch('services.json')).json();   // which server-side services this host has (export, features, saving to a server)
    const response=await fetch(configUrl(experiment.get('biome')||services.defaultWorld)); if (!response.ok) throw new Error('Could not load the sculpt configuration.'); config=applyWorldRock(await response.json()); config.services=services;
    defaultColumn=config.column;baseWorldConfig=structuredClone(config);
    const pending=await takePendingSketch(experiment.get('pendingSketch'));let automatic=null;
    try{if(!pending&&LOCAL_KEY&&!experiment.has('newMap')){const a=JSON.parse(localStorage.getItem(LOCAL_KEY)||'null');if(a?.biome===config.biomeId&&(a.world||a.biome)===(experiment.get('world')||config.biomeId))automatic=a;}}catch{}
    const restoring=pending??automatic,embedded=copySavedWorld(restoring?.worldSettings,config);
    loadWorlds();
    if(embedded){
      // A map's world never replaces yours. One that draws differently from this browser's world of the same id opens as a world of
      // its own, named for the map; "Use for my <world>" (World section) adopts it on purpose. A world this browser lacks is added.
      let id=savedWorldId(restoring);const mine=worlds[id]??(id===config.biomeId?{}:null);
      // The same world under another id (a fork opened before, the built-in a fork came from, a world of your own): open in it.
      const match=mine&&sameSavedWorld(embedded,mine,config)?id:[config.biomeId,...Object.keys(worlds)].find(w=>w!==id&&(w===config.biomeId||worlds[w]?.base===config.biomeId)&&sameSavedWorld(embedded,worlds[w]??{},config));
      if(match&&match!==id){id=match;const url=new URL(location.href);if(id===config.biomeId){experiment.delete('world');url.searchParams.delete('world');}else{experiment.set('world',id);url.searchParams.set('world',id);}window.history.replaceState(null,'',url);}
      else if(!match&&mine){
        const from=String(restoring.mapData?.name||'a map').trim().slice(0,60)||'a map',name=`${embedded.name} from ${from}`.slice(0,120);
        id=name.toLowerCase().replace(/[^a-z0-9]+/g,'-').replace(/^-|-$/g,'').slice(0,24)+'-'+Math.random().toString(36).slice(2,6);
        worlds[id]={...embedded,name,openedFrom:{map:from,world:savedWorldId(restoring)},materials:worldOwnMaterials(embedded.materials,config)};
        experiment.set('world',id);const url=new URL(location.href);url.searchParams.set('world',id);window.history.replaceState(null,'',url);
        openedAsOwnWorld={name,from,mine:worlds[savedWorldId(restoring)]?.name||config.biome};
      } else if(!match) worlds[id]={...embedded,materials:mergeWorldMaterials(worlds[id]?.materials,worldOwnMaterials(embedded.materials,config),config)};   // the store keeps the two only where they differ from the library's
      if(automatic&&automatic.world!==id){automatic.world=id;localStorage.setItem(LOCAL_KEY,JSON.stringify(automatic));}
      saveWorlds();
      for(const [key,value]of Object.entries(embedded.knobs))experiment.set(key,value);
    }
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
    configureMap(config,experiment);
    if(embedded&&Number.isFinite(restoring.baseHeight))config.baseHeight=restoring.baseHeight;
    MIN_HEIGHT=config.seaLevel-90; MAX_HEIGHT=config.seaLevel+300;
    if ((!config.map && config.size!==1024) || !Number.isInteger(config.grid) || config.grid<2 || config.grid>(config.map?16384:1024) || !Number.isFinite(config.baseHeight) || !Number.isFinite(config.seaLevel)) throw new Error('Unsupported sculpt configuration.');
    $('world-title').textContent=config.biome||'Green Planet';
    // The world: built-in (the biome itself) or a custom one based on it.
    // Its remembered settings come before the biome's own defaults.
    worldId=experiment.has('world') && worlds[experiment.get('world')]?.base===config.biomeId?experiment.get('world'):config.biomeId;
    config.featureSet=worlds[worldId]?.featureSet;
    if (firstVisit()) openNewMap(true);   // the picker before the renderer starts: Create waits for nothing (newMapReady)
    // The world's surface layers where the artist changed them (the Surface section); a damaged one falls back to the world's own.
    baseSurface=structuredClone(config.surface);
    if (worlds[worldId]?.surface) { try { config.surface=withSurfaceMaterials(copySurface(worlds[worldId].surface),baseSurface); } catch (err) { delete worlds[worldId].surface; } }
    // The world's materials where the artist changed them (keepWorldMaterials): its ground, water, role materials and the ones its surface
    // layers draw (which needs the layers above); the rest are the library's.
    config.worldMaterials=keptWorldMaterials(worlds[worldId]?.materials,config);
    config.presetDefaults={...config.defaults};
    // Only the rows this build has: a stored world keeps a removed option's value (lowTint) until it is saved again, and it must not reach
    // the defaults, where a map save would carry it (sculpt-save.js savedWorld) and the open would drop it.
    const known=worldKeys(config),worldKnobs=Object.fromEntries(Object.entries(worlds[worldId]?.knobs||{}).filter(([key])=>known.has(key)));
    config.defaults={...config.defaults,...worldKnobs};
    config.engineDefaults=Object.fromEntries(Object.entries(config.engineDefaults||{}).map(([key,value])=>[key,worldKnobs[key]??value]));
    if (worldId!==config.biomeId) $('world-title').textContent=worlds[worldId].name;
    addDefaults(experiment,config.defaults);
    borrowBeach(config,experiment);   // a beach another world lends (World, Ground): before the renderer and the panel read the world's layers
    refreshWorldKit();brushWorldDefinitions=structuredClone(worldToolList);buildShapeOptions();{const kit=instantiateWorldKit(config,activeWorld());mapMaterials=kit.materials;mapRocks=kit.rocks;if(kit.reason)status(kit.reason);}syncMaterialChoices();syncRockAdd();syncRockChoices();buildToolbar();
    $('rock-save-to').value=worldId in (config.biomes??{})?'map':'world';
    // A new map starts with the world's tools, on the first of them where the world has no Plateau.
    if (!toolIds().has(tool)) tool=firstTool();
    for (const id of toolIds()) toolSettings[id]=toolCard(id);
    showTool(toolSettings[tool]);
    // The surface sliders open at the world's material values; the address may set the ring's three (a world's own fringe settings, 0..1).
    for (const [id,value] of Object.entries(surfaceSliders(config,experiment))) $(id).value=value;
    syncDrawInputs();
    for (const [id,hidden] of Object.entries(surfaceGroupsHidden(config))) $(id).hidden=hidden;
    $('world-surface-detail').hidden=Object.values(surfaceGroupsHidden(config)).every(Boolean);   // its heading (and This map tag) goes with its rows
    await bootMap(pending);
  } catch (err) { if ($('new-map-dialog').open) $('new-map-dialog').close(); error(err.message); status('The experimental renderer could not start.'); }
}
// Read-only hook for capture tools: the displayed (refined) heights.
// bakeMs and drawMs resolve to milliseconds from submit to GPU completion;
// bakeGpuMs and drawMs's gpuMs are the pass's own GPU time (timestamp queries).
// Repeat check (repro/shapecheck.mjs): two GPU evaluations of this page's scene give identical planes.
async function shapeCompare() {
  const idle=async () => { for (let i=0;i<4000 && regionalFields.pending?.();i++) await new Promise(r => setTimeout(r,10)); };
  return repeatCheck({fields:regionalFields,grid:worldGrid,settle:idle});
}
// H12b: the regional check on the map (sculpt-scene.js regionalCheck; repro/regional.mjs): the paged fields (gpuPages=force) against the shape engine.
function gpuRegionalCheck(ulps=0) {
  return regionalCheck({fields:regionalFields,ulps,device:renderer.device,nodes,context:shapeContext(),config,grid:worldGrid,spacing,minH:MIN_HEIGHT,maxH:MAX_HEIGHT,
    startCoarse:() => { if (!pagedCoarseStarted) { pagedCoarseStarted=true; regionalFields.startCoarse().catch(() => {}); } }});
}
window.sculptDebug = {dirty:()=>mapCanvas?.dirty(),inputs:()=>worldInputQueue.stats(),curve:() => currentCurve(),along:() => currentAlong(),place:() => lfPlace,sectionPoint:(side,x,v) => { const cv=$('section-preview'),r=cv.getBoundingClientRect(),L=sectionLayout(curveContext()); return {x:r.left+sideX(L,side,x)*r.width/cv.width,y:r.top+L.yv(v)*r.height/cv.height}; },leanPoint:() => { const cv=$('section-preview'),r=cv.getBoundingClientRect(),L=sectionLayout(curveContext()); return {x:r.left+L.xc*r.width/cv.width,y:r.top+L.yv(0)*r.height/cv.height}; },alongPoint:(t,v) => { const cv=$('along-preview'),r=cv.getBoundingClientRect(),L=alongLayout(curveContext()); return {x:r.left+L.X(t)*r.width/cv.width,y:r.top+L.yv(v)*r.height/cv.height}; },pageInfo:() => regionalFields?.pageInfo?.()??null,shapeCompare,shape:() => ({fields:regionalFields?.stats?.().gpuShape??null,fieldsReason:regionalFields?.reason?.()??null}),corner:(x,y) => regionalFields?{eroded:sampleRegional(x,y),authored:regionalFields.sample(x,y)}:null,regionalCheck:gpuRegionalCheck,state: () => ({tool, stroke: Boolean(stroke), moving: Boolean(moving), selected, pointerId, pan: Boolean(pan)}), bakeMs: (quality='full') => renderer.timeBake(quality), get bakeGpuMs() { return renderer.lastBakeGPU; }, get specStats() { return renderer.specStats && {...renderer.specStats, cached: renderer.specCache.size, key: renderer.specKey().key}; }, get engine() { return renderer.engine; }, get startupParts() { return renderer.startupParts; },
  drawMs: (quality='full') => renderer.timeDraw({quality,clay:$('clay').checked,light:$('light').value,detail:Number($('relief').value)/100,ring:Number($('mineral-ring').value)/100,ringSpread:Number($('ring-spread').value)/100,ringVariation:Number($('ring-variation').value)/100,materialWeathering:Number($('material-weathering').value)/100,transitionDetail:Number($('transition-detail').value)/100}),
  scene: scriptedScene,
  // sketch and loadSketch round-trip a recipe.
  sketch: () => JSON.parse(JSON.stringify(sketch())), loadSketch: s => { loadSketch(s); }, nodes: () => JSON.parse(JSON.stringify(serializeNodes())), get biome() { return config.biomeId; }, get grid() { return grid; }, get size() { return size; }, get base() { return config.baseHeight; }, get sea() { return config.seaLevel; }};
// H5b: the paged shape planes against the whole-map engine's, over the whole map (4x4 with gpuPages=force): max |d| per plane and the mask steps.
// H10: an optional square rect compares a window (a whole 8x8 map is too large for one readback); the pages are read over the same rect.
window.sculptDebug.pagedShapeCompare=async rect => {
  const eng=await createShapeEngine({device:renderer.device,grid:worldGrid,spacing,baseHeight:config.baseHeight,sea:config.seaLevel,minH:MIN_HEIGHT,maxH:MAX_HEIGHT});
  const out=await eng.run(nodes.slice(),shapeContext(),rect||null),G=rect?rect.x1-rect.x0+1:worldGrid;
  const a={h:out.floats[0],p:out.floats[1],r:out.floats[2],c:out.floats[3],v:out.floats[4],x:out.floats[5],u:out.floats[6],masks:out.masks};
  const rp=await regionalFields.readRect(rect||{x0:0,y0:0,x1:G-1,y1:G-1},{weather:false});
  const b={h:rp.fields.h,p:rp.fields.p,r:rp.fields.r,c:rp.fields.c,v:rp.fields.v,x:rp.fields.x,u:rp.fields.u,masks:MASK_KEYS.map(k => rp.fields[k])};
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
  const B=createPagedFields({worldSize,worldGrid,baseHeight:config.baseHeight,maskKeys:MASK_KEYS,nodes:() => nodes,device:() => renderer?.device,context:shapeContext,gesture:() => false,apron:other});
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
