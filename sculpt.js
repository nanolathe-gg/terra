import {changedWeatherTiles,invalidateRefinement,refinementValid} from './sculpt-change-map.js';
import {configureMap,mountMapCanvas} from './sculpt-map.js';
import {mountEditorUI,groupToolControls,mountWorldControlIndex,mountColumnPanel} from './sculpt-ui.js';
import {copyColumn, columnHasCapBed} from './sculpt-column.js';
import {controlLabel,shapeControlAvailable,PARKED_WORLD_CONTROLS,WORLD_CHOICES,WORLD_GROUP_NAMES} from './sculpt-control-schema.js';
import {sectionPreview,FACING_CHOICES,FORMS,LANDFORM_FORMS,landformTool,defaultForm,strokeKnots,thinKnots,knotCurve,leanRatio,leanSetup,landformReach,landformSides,landformBackSide,alongKnots,landformElevation,landformSteps} from './sculpt-shape-presets.js';
import {createGpuFields,createPagedFields,createShapeEngine,comparePlanes,readBuffer,setFailureHandler,LAYER_MEANDER} from './sculpt-gpu-fields.js';

import {shapePaths,clonePaths,simplifyPath,validatePaths,appendPath,extendPoint,insertPoint,removePoint,removePath} from './sculpt-paths.js';
import {selectionTransform} from './sculpt-selection.js';
import {applyRiver,isRiver,pointsSignature,RIVER_MIN_WIDTH} from './sculpt-river.js';
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
  river:'Draw a river: a valley landform whose path is migrated a seeded number of steps (Wander) by the curvature rule real rivers follow, so the line you draw becomes bends that grow and travel downstream, and a bend that closes on itself leaves an oxbow. Width is the channel (at least 32 px, so ships can use it). The bank is cut steep on the outside of each bend, a sand bar builds inside it, and pools and riffles follow the bends. Draw a long gentle line; Cut to sets the floodplain relative to the sea.',
  braided:'Draw a braided river: a wide belt of gravel bars cut by threads of water that split and rejoin, on a level floodplain. Width is the scale of a thread (at least 32 px). Wander migrates the line you draw first, as for a river (0 keeps it as drawn).',
  valleyT:'Draw a landform that starts as a terraced valley: a V valley whose walls climb in flat treads, the levels a river left as it cut down.',
  smooth:'Blend the starting surface toward its local average. Repeat a new stroke for more smoothing.',
  crystal:'Grow a cluster of faceted crystals along the stroke: their sides, size, count, how flat their tops are and how much they lean are brush options. Height sets the tallest.',
  sand:'Paint sand cover: the ground under the brush becomes sand (on slopes too, so a hill set in sand has sandy feet). Heights do not change.',
  grass:'Paint ground cover: clears sand (painted or weathered) back to the world\'s own ground, such as grass. Heights do not change.',
  paint:'Paint a material over the ground, or a scatter density: rock showing through, snow or ice, wet (dark) ground and moss take the world\'s own materials; denser or sparser scatter multiplies the World panel\'s Boulders and Debris (at 0 nothing shows). Strength is how fully it paints, Softness the edge. Heights do not change.',
  fissure:'Cut a fissure along the stroke, or (Mode 1) a network of cuts over its footprint. Branches, jaggedness, width and depth are brush options; the world\'s own crack field is raised along the cut.',
  erase:'Paint plain ground: hills, water, craters, cracks, painted masks and style under the brush return to the dry base level, with a natural edge.',
  crater:'Strike a crater: a bowl below the ground where you click, a raised rim and a fading apron. Drag for an elongated crater.',
  move:'Drag to move · Shift + drag for height · Shift snaps rotate / scale · P: path · V: transform · arrows: nudge · Shift F: focus canvas'
};
let mapUpdate=() => {},mapFeatures=null,mapMetadata=null,mapRevision=0;
const mapData=() => ({...mapFeatures?.serialize(),...mapMetadata?.serialize()});
function restoreMapData(data={}) { mapFeatures?.load(data||{}); mapMetadata?.load(data||{}); mapRevision++; }
function mapChanged() { mapRevision++; checkpoint(true); schedule(false); }
let config, renderer, grid, size, spacing;
let defaultColumn, columnOverride=null, columnEditing=false, syncColumnPanel=()=>{};
let pagedCoarseStarted=false, mapCanvas=null, regionalFields=null, originCellX=0, originCellY=0, worldSize=0, worldGrid=0, regionalWeather=null;
// Integer origins preserve the canonical multiplication order: (cell + origin)
// times spacing, rather than an accumulated floating-point world offset.
let gpuWeather=null, gpuErosionMs=null, weatherJob=0, weatherBase=null, refined=null, refinedBase=null, weatherState='pending';
let refinedInvalidRect=null;
let controlsEditing=false;
let tool='plateau', seed=2701, varySeed=true, refinementSeed=2701, stroke=null, pan=null, pointerId=null, loading=false;
const randomSeed=current=>{const next=(Math.random()*4294967296)>>>0;return next===current?(next+1)>>>0:next;};
let history=[], historyIndex=-1, historySerial=0;
let revision=0, autosaveTimer, ready=false;
// Biomes choose starting values for the same brushes. These presets can be
// borrowed independently of the canvas materials and then edited per tool.
// Approved starting shapes use ordinary controls and editable knots. Preset elevation is a rise above the map plain; toolDefaults resolves the absolute height.
const LANDFORM_DEFAULTS={"diameter":300,"amount":70,"roughness":0,"softness":50,"cracks":40,"faceVariation":0,"lean":100,"facing":3,"terraces":0,"elevation":70,"combine":0,"wander":90,"widthVary":35,"heightVary":3,"varySize":140,"varyFoot":115,"varyMiddle":145,"routeSmooth":0,"crestTaper":0,"fingers":0,"shoreLayers":0,"shorePlates":0,"curve":{"form":"lfPlateau","knots":[[0,0],[0.08,0.006],[0.19,0.035],[0.27,0.15],[0.37,0.65],[0.45,0.96],[0.5,1],[1,1]],"back":[[0.0,0],[0.096,0.006],[0.22799999999999998,0.035],[0.324,0.15],[0.444,0.65],[0.54,0.96],[0.6,1],[1,1]]}};
// The palette's landform presets over LANDFORM_DEFAULTS (Plateau is the defaults themselves): numbers for Landform's own controls, each the fit of the
// retired tool's default stroke that re-authored the fixtures. Elevation is a rise above the map plain, or with Height reference: Sea level, above the sea.
const smoothKnots=n=>Array.from({length:n+1},(_,i)=>{const t=i/n;return [Math.round(1000*t)/1000,Math.round(1000*t*t*(3-2*t))/1000];});
// The valleys cut to a floor below the plain (Cut to) along one curve: V and U differ only in the curve, the terraced one is the V with the Steps control.
const valley=(form,more={}) => ({diameter:240,lean:100,combine:1,elevation:-20,cracks:0,wander:20,widthVary:20,heightVary:0,varySize:120,varyFoot:100,varyMiddle:100,curve:{form,knots:FORMS[form]().knots},...more});
const LANDFORM_TOOLS={
  plateau:{},
  hill:{diameter:200,lean:205,wander:24,widthVary:20,heightVary:15,varySize:100,varyFoot:100,varyMiddle:100,curve:{form:'lfHill',knots:[[0,0],[.333,.02],[.667,.34],[1,1]],back:smoothKnots(12)}},
  mountain:{diameter:200,lean:100,cracks:60,wander:8,widthVary:0,heightVary:3,varySize:100,varyFoot:100,varyMiddle:100,curve:{form:'lfMountain',knots:thinKnots(FORMS.mountain(.5).knots,17)}},
  ramp:{diameter:200,lean:100,combine:2,routeSmooth:100,cracks:0,wander:0,widthVary:0,heightVary:0,varySize:160,varyFoot:100,varyMiddle:100,along:[[0,0],[1,1]],curve:{form:'lfRamp',knots:FORMS.lfRamp().knots}},
  deep:{diameter:200,lean:100,heightReference:1,elevation:-55,combine:1,cracks:0,wander:30,widthVary:30,heightVary:0,varySize:210,varyFoot:100,varyMiddle:100,curve:{form:'lfShore',knots:FORMS.lfShore().knots}},
  shallow:{diameter:200,lean:100,heightReference:1,elevation:-7,combine:2,cracks:0,wander:4,widthVary:0,heightVary:0,varySize:210,varyFoot:100,varyMiddle:100,curve:{form:'lfShore',knots:FORMS.lfShore().knots}},
  valleyV:valley('lfValleyV'),
  valleyU:valley('lfValleyU'),
  valleyT:valley('lfValleyV',{terraces:4,ledge:55,terraceJitter:30}),
  // A river: Width is the channel (the section reaches 6 channel half widths each side), Wander the migration steps in 4s; the floodplain sits 3 above the sea.
  river:{diameter:48,lean:100,combine:1,heightReference:1,elevation:3,cracks:0,wander:76,widthVary:0,heightVary:0,varySize:120,varyFoot:100,varyMiddle:100,surf:0,curve:{form:'lfRiver',knots:FORMS.lfRiver().knots}},
  // A braided river: the same preset with a belt of threads (its form) and no migration unless Wander is raised.
  braided:{diameter:40,lean:100,combine:1,heightReference:1,elevation:3,cracks:0,wander:0,widthVary:0,heightVary:0,varySize:120,varyFoot:100,varyMiddle:100,surf:0,curve:{form:'lfBraided',knots:FORMS.lfBraided().knots}}
};
const TOOL_NAMES={plateau:'Plateau',hill:'Rounded ridge',mountain:'Peaked ridge',ramp:'Ramp',deep:'Deep water',shallow:'Shallow water',valleyV:'V valley',valleyU:'U valley',valleyT:'Terraced valley',river:'River',braided:'Braided river'};
// A palette entry's stroke kind: the shape buttons all draw landforms.
const strokeKind=t => Object.hasOwn(LANDFORM_TOOLS,t)?'landform':t;
const TOOL_PRESETS={
  green:{crater:{roughness:60}},
  red:{crater:{roughness:65,softness:40},hill:{wander:34,widthVary:30,heightVary:21,lean:250},mountain:{wander:8,heightVary:4},deep:{diameter:176,wander:34,widthVary:35},shallow:{wander:4}},
  // The reviewed mesa; ragged feet and foot bumps on the ridges (the retired baseVary and baseBump, as wander and height variation).
  desert:{plateau:{"diameter":400,"amount":70,"roughness":0,"softness":50,"cracks":10,"faceVariation":0,"lean":100,"facing":3,"terraces":6,"elevation":90,"combine":0,"wander":75,"widthVary":30,"heightVary":1,"varySize":210,"varyFoot":100,"varyMiddle":150,"ledge":55,"terraceJitter":40,"breakup":30,"curve":{"form":"mesa","knots":[[0,0],[0.13299999999999998,0.088],[0.2667,0.25],[0.364,0.367],[0.48299999999999993,0.625],[0.5914999999999999,0.883],[0.7,1],[1,1]]}},crater:{roughness:55,softness:55,cracks:10},hill:{wander:46,widthVary:25,heightVary:23,lean:160,cracks:10},mountain:{wander:24,heightVary:8,cracks:10},deep:{wander:34,widthVary:35}},
  // Lobed hill outlines (the retired moonLobes): wander in lobes about 60 px long, from foot to crest.
  moon:{crater:{roughness:65,softness:45},hill:{wander:42,widthVary:30,heightVary:17,varySize:60,varyMiddle:150,lean:185},mountain:{wander:24,widthVary:5,heightVary:4,varySize:60,varyMiddle:150},deep:{wander:34,widthVary:35}},
  crystal:{crystal:{amount:140,diameter:480,roughness:40},mountain:{wander:6,heightVary:2},deep:{wander:24,widthVary:25},shallow:{wander:6}},
  ice:{crystal:{amount:155,diameter:120,roughness:20},mountain:{wander:6,heightVary:2},deep:{wander:24,widthVary:25,shorePlates:1},shallow:{wander:6,shorePlates:1}},
  // Lava banks rise ~22-24 units over 40-60 px, steep at the lava then
  // flattening (retail coasts, measure/lava_*): wide, concave dry banks, as shoreline steps and lobes.
  lava:{mountain:{wander:6,heightVary:2},deep:{diameter:264,wander:40,fingers:100,stepReference:1,terraces:11,ledge:80,terraceJitter:70},shallow:{diameter:264,wander:6,fingers:100,stepReference:1,terraces:11,ledge:80,terraceJitter:70}},
  zhon:{crater:{roughness:55,softness:60},hill:{wander:20,widthVary:15,heightVary:13,lean:280},deep:{diameter:240,wander:48,widthVary:40},shallow:{diameter:240,wander:6}},
  archipelago:{crater:{roughness:60,softness:65},hill:{lean:120},deep:{diameter:256,wander:52,widthVary:40},shallow:{diameter:248,wander:6}}
};
const TOOL_FIELDS={cracks:['cracks',0,100],diameter:['diameter',40,800],amount:['amount',-80,160],roughness:['roughness',0,100],softness:['softness',0,100]};
// Shape options: per-shape settings, shown for the tools they apply to and
// kept in each shape, so a selected shape can be changed like a new stroke.
// Each starts at the world's value (sculpt.py KNOB_DEFAULTS / WORLD_KNOBS).
// Cross-section (card C1): the kinds that take the parametric profile, and the
// options that describe it. Wired like every shape option: SHAPE_FIELDS, the
// card scriptedScene builds, strokeParams and KNOB_DEFAULTS (sculpt.py).
// A crater's spurs keep the outline of the retired ridges: Moon's lobes, Desert's ragged foot and foot bumps. World values, no control: they ride with the stroke for the spur stamp.
const SPUR_OUTLINE_KEYS=['moonLobes','baseVary','baseBump'];
// Line features (card C4): spurs, crest variation and crater rim sectors. All
// default off; spurs branch off a landform's crest or a crater's rim (the crest options shape a crater's spurs),
// rim options reshape a crater's rim.
const RIDGE_KEYS=['spurCount','spurLength','spurSpread','spurWidth','spurTaper','spurHeight','spurForks','spurBulb','crestJag','crestVary','crestTaper','rimHeight','rimSectors','rimUnequal','rimGaps','rimGapWidth'];
// Placed fissures (card C4 stage 2): the Fissure tool and its options. Depth is
// the stroke's own amount; the rest are shape options kept in the shape.
const FISSURE_KEYS=['fissureWidth','fissureJag','fissureBranches','fissureBranchLen','fissureBranchSpread','fissureTaper','fissureNetwork','fissureCell','fissureCrack','fissureDark'];
const SECTION_KEYS=['terraces','ledge','terraceJitter','breakup'];
// Landform (card H27): the elevation and how it combines, and the variation along and across the path. The along curve (a knot list) rides with the section curve.
const LANDFORM_KEYS=['stepReference','heightReference','elevation','combine','routeSmooth','wander','widthVary','heightVary','gullies','gullySize','talus','surf','varySize','varyFoot','varyMiddle'];
// Painted masks (card C5): nine signed-byte planes per cell, where 0 changes
// nothing: rock, snow or ice, wet ground and moss (0..127 of full), scatter
// density, and four local style settings (stage 2: relief strength, cracks,
// banding and face rock share, each -127..127 about the world's own value).
// 'paint' is the brush; the landforms below can also paint inside their own
// footprint (maskChannel, and styleRelief .. styleFace).
// Card E1 adds five more: the water choices of a deep or shallow stroke (shore
// edge, shallow-to-deep edge, bed; +127 hard / lit bed, -127 faded / noise
// water), painted ground lumps (+127 more, -127 fewer) and the cracked-bed flag.
// Planes 0-18 are in use (14-17 are the override planes, 18 a water stroke's Surf, 0..127 of 1); 19-24 are unused placeholders (the flow bake's planes 20-24 went with it). The shape engine's buffers hold seven
// words a cell (28 planes), so the layout stays as they and the shaders read it.
const MASK_KEYS=['mr','ms','mw','mm','md','ml','mc','mb','mf','mx','my','mz','mg','mk','ovErosion','ovDeposits','ovVegetation','ovExposure','surf','free19','fu','fv','s1','s2','s3'];
const WATER_KEYS=['waterShore','waterDeep','waterBed'];
const MASK_SHAPES=['crater','landform'];
const MASK_CHOICES=[[1,'Rock'],[2,'Snow or ice'],[3,'Wet or dark ground'],[4,'Moss'],[5,'Denser scatter'],[6,'Sparser scatter']];
const LUMP_CHOICES=[[16,'Ground lumps'],[17,'Smoother ground']];
// H3 override planes 14-17 (a signed value v multiplies the control it names by 1 + v; 0 changes nothing): erosion rate (H2's pass),
// loose deposits (sand and scree), vegetation (grass and moss cover), rock exposure. Paint choices 18-25 write them.
const OVERRIDE_CHOICES=[[18,'Relaxation: more'],[19,'Relaxation: less'],[20,'Deposits: more'],[21,'Deposits: less'],[22,'Vegetation: more'],[23,'Vegetation: less'],[24,'Rock exposure: more'],[25,'Rock exposure: less']];
const STYLE_CHOICES=[...OVERRIDE_CHOICES,[8,'Relief stronger'],[9,'Relief weaker'],[10,'Cracks more'],[11,'Cracks fewer'],[12,'Banding more'],[13,'Banding less'],[14,'Face: more rock'],[15,'Face: less rock']];
const STYLE_KEYS=['styleRelief','styleCracks','styleBanding','styleFace','styleErosion','styleDeposits','styleVegetation','styleExposure'];
const COAST_KEYS=['shoreLayers','layerPx','layerRiser','layerLedge','layerRough','layerStyle',
  // E10: finger size; layer width variation; the circles of scalloped layers.
  'fingerSize','layerVary','layerCircle',
  // G5 (Lava): the layers' two-dimensional wander and extra width spread; the circles' variety; the lobes' tread tilt (the hill-lobe option rides this list, as E10's).
  'lavaSpread','lavaCircleVary'];
// [key, element id, label, kinds, slider min, max, step, slider units per value, help, drop-down choices]
const SHAPE_FIELDS=[
  ['craterlets','craterlets','Craterlets',['crater'],0,12,1,1,'Small satellite craters round the rim.'],
  ['craterEjecta','crater-ejecta','Ejecta',['crater'],0,100,5,100,'Ragged patches of throw-out beyond the rim.'],
  ['faceVariation','face-variation','Face width variation',['erase'],0,150,5,100,'How much the edge face widens and narrows along the outline (on a carried cross-section, every width of it).'],
  ['lean','lean','Lean (back length over face)',['landform'],0,400,5,100,'How much longer the slope toward the lean side runs than the one away from it (100 or 0: the same both sides).'],
  ['facing','facing','Lean toward',['landform'],0,10,1,1,'The side the shape leans toward, the long gentle slope: a map direction or a side of the line you draw (a ridge\'s steep face is the opposite side).',FACING_CHOICES],
  ['fingers','fingers','Finger coasts',['landform'],0,150,5,100,'Interlocking land fingers and inlets along the shore.'],
  ['layerPx','layer-px','Layer width (px)',['landform'],4,60,1,1,'Width of one shoreline step, ledge and riser together. The step count times this is how far the terraces reach inland.'],
  ['layerRiser','layer-riser','Riser height (units; 0 fits the bank)',['landform'],0,80,1,10,'Height of each step. 0 shares the bank\'s whole rise out between the layers, so the last one meets the plain.'],
  ['stepReference','lf-step-reference','Steps follow',['landform'],0,2,1,1,'Profile steps divide the drawn section. Shoreline steps follow the joined waterline, including overlaps and uneven banks. Circular shoreline steps cut scalloped arcs.',[[0,'Profile'],[1,'Shoreline'],[2,'Circular shoreline']]],
  ['terraces','sec-terraces','Steps',['landform'],0,12,1,1,'Cut the face into this many flat ledges with risers between them.'],
  ['ledge','sec-ledge','Flat share of a step',['landform'],0,95,5,100,'How much of each step is flat; the rest is the riser.'],
  ['terraceJitter','sec-terrace-jitter','Step variation',['landform'],0,100,5,100,'How much riser positions and step heights wander along the outline.'],
  ['breakup','sec-breakup','Step breakup',['landform'],0,100,5,100,'How many stretches of the terraces lose their shelf, so the steps no longer run unbroken round the shape (100: most stretches lose it, and short ledges survive). 0 keeps the terraces whole.'],
  // Landform (card H27): the elevation, how it combines, and the variation weighted by the place on the section.
  ['heightReference','lf-height-reference','Height reference',['landform'],0,1,1,1,'Fixed elevation uses map height units. Sea level measures above or below the current sea; negative heights are below water.',[[0,'Fixed elevation'],[1,'Sea level']]],
  ['elevation','lf-elevation','Elevation (height units)',['landform'],-335,300,1,1,'The height of the crest, in height units. The section canvas marks the plain (the map\'s base height) and the sea. Combine decides what the landform does to the ground it meets.'],
  ['combine','lf-combine','Combine',['landform'],0,2,1,1,'Raise to keeps the higher of the ground and the landform. Cut to keeps the lower. Flatten to sets the ground to the landform wherever it reaches, up or down.',[[0,'Raise to'],[1,'Cut to'],[2,'Flatten to']]],
  ['routeSmooth','lf-route-smooth','Smooth route',['landform'],0,100,5,100,'Keep the center of this landform clear of surface relief, cracks and debris, and protect its grade from weathering. The shoulders fade into the surrounding terrain.'],
  ['wander','lf-wander','Wander (px)',['landform'],0,120,2,1,'How far the outline moves in and out around the sides and ends, in waves as long as the Variation size. The drawn crest stays in place.'],
  ['widthVary','lf-width-vary','Width variation',['landform'],0,100,5,100,'How much the section widens and narrows along the path (100: from half to twice its width).'],
  ['heightVary','lf-height-vary','Height variation (units)',['landform'],0,40,1,1,'How far the surface rises and falls, in height units, in waves as long as the Variation size. It is zero at the feet.'],
  // P1: branching gullies on the raised faces, steered down the stroke's own fall line (engine-shape.wgsl landformGullies).
  ['gullies','lf-gullies','Gullies',['landform'],0,100,5,100,'Cut the raised faces into a divide, spurs off it and V-gullies that branch as they run down the fall line, deepest on steep faces and fading at the foot. 0: smooth faces.'],
  ['talus','lf-talus','Talus reach (px)',['landform'],0,200,5,1,'How far talus cones run down from the foot of a raised face, below each of the widest gullies: a loose slope at the world\'s talus angle that buries the foot. 0: no talus. It needs Gullies, for the chutes, and shows only on faces steeper than the talus angle.'],
  ['gullySize','lf-gully-size','Gully size',['landform'],10,100,5,100,'How far apart the widest gullies run, as a share of the face from crest to foot; each finer set is half as far apart. Low: close rills; high: a few broad valleys between big spurs.'],
  // P27: the shore's wet sand, foam and beach by the coast distance (engine-frag.wgsl surfShore); written into mask plane 18 where the stroke makes water.
  ['surf','water-surf','Surf',['landform'],0,100,5,100,'How much the shore is worked by waves, where this stroke makes water. 0: the shore is drawn as before. Low (lakes): a dark wet line and a 1 px foam lace at the waterline. Higher: wet sand, wrack lines, a sand beach with cusps, and a broken breaker line over the shallows.'],
  ['varySize','lf-vary-size','Variation size (px)',['landform'],20,400,10,1,'The wavelength of the wander and of the width and height variation.'],
  ['varyFoot','lf-vary-foot','Variation at the foot',['landform'],0,200,5,100,'How much of the variation acts at the foot of the section (100: all of it, 0: none, 200: twice). It blends into the next one up to the middle of the section.'],
  ['varyMiddle','lf-vary-middle','Variation up the section',['landform'],0,200,5,100,'How much of the variation acts from the middle of the section to its crest. Set the foot to 0 and this to 200 for variation that grows toward the crest.'],
  ['spurCount','spur-count','Spurs',['crater','landform'],0,12,1,1,'Tapering spurs that branch off this ridge (off a crater, its rim), grown from the shape\'s own seed. Each joins its parent at the crest.'],
  ['spurLength','spur-length','Spur length (px)',['crater','landform'],20,400,10,1,'Average reach of a spur; each runs from about half to one and a half times this.'],
  ['spurSpread','spur-spread','Spur angle spread',['crater','landform'],0,100,5,100,'0: spurs leave swept back at about 40 degrees (off a crater, straight out); 100: scattered up to square and beyond, and more winding.'],
  ['spurWidth','spur-width','Spur width',['crater','landform'],20,200,5,100,'A spur\'s width at its root, as a share of the ridge\'s own (a crater\'s radius, on a crater); it flares a little where it joins.'],
  ['spurTaper','spur-taper','Spur taper',['crater','landform'],0,100,5,100,'How much a spur narrows and lowers toward its tip.'],
  ['spurHeight','spur-height','Spur height',['crater','landform'],10,100,5,100,'A spur\'s root height as a share of the ridge\'s crest (of the crater\'s rim height).'],
  ['spurForks','spur-forks','Spur forks',['crater','landform'],0,100,5,100,'The share of spurs that fork once, two thirds of the way out, into a shorter spur.'],
  ['spurBulb','spur-bulb','Bulbous spur tips',['crater','landform'],0,100,5,100,'Swells the outer half of every spur into a rounded lobe, so it ends in a knuckle, not a point.'],
  ['crestJag','crest-jag','Crest irregularity',['crater'],0,100,5,100,'Jagged spurs: each spur\'s crest drops in and out along it (the peaks keep full height).'],
  ['crestVary','crest-vary','Crest width and height variation',['crater'],0,100,5,100,'Each spur swells and shrinks, wider and lower in places, along its length.'],
  ['crestTaper','crest-taper','Crest taper (both ends)',['landform'],0,100,5,100,'The crest narrows and lowers toward both ends of its path; it multiplies the height along the path.'],
  ['rimHeight','rim-height','Rim height (share of depth)',['crater'],0,150,1,100,'How high the rim stands, as a share of the crater\'s Depth (34% is the usual rim); the bowl floor does not change, so a tall rim needs no deeper bowl.'],
  ['rimSectors','rim-sectors','Rim sectors',['crater'],0,8,1,1,'Split the rim into this many sectors of different height and width (a lopsided ring, not an even one).'],
  ['rimUnequal','rim-unequal','Sector inequality',['crater'],0,100,5,100,'How different the sectors are: 0 equal; 100 from a faint low ridge to a tall, broad massif.'],
  ['rimGaps','rim-gaps','Rim gaps',['crater'],0,4,1,1,'Deliberate breaks in the rim, where it sinks to a low saddle.'],
  ['rimGapWidth','rim-gap-width','Gap width (degrees)',['crater'],10,180,5,1,'Angular width of each gap; a wide one leaves an open crescent.'],
  ['fissureWidth','fissure-width','Width (px)',['fissure'],2,24,1,1,'Width of the cut at its widest. The grid is 2 px, so a cut never reads narrower than about 4 px, however thin it is set.'],
  ['fissureJag','fissure-jag','Jaggedness',['fissure'],0,100,5,100,'How far the cut zigzags off its path, and how its depth varies along it.'],
  ['fissureBranches','fissure-branches','Branches',['fissure'],0,12,1,1,'Side cuts that leave the main cut, and fork once, grown from the shape\'s own seed. Network mode ignores them.'],
  ['fissureBranchLen','fissure-branch-len','Branch length (px)',['fissure'],20,300,5,1,'Average reach of a branch; each runs from about half to one and a half times this.'],
  ['fissureBranchSpread','fissure-branch-spread','Branch angle spread',['fissure'],0,100,5,100,'0: branches leave at about 25 degrees to the cut; 100: up to square.'],
  ['fissureTaper','fissure-taper','Taper',['fissure'],0,100,5,100,'How much the cut narrows and shallows toward its ends and its branch tips.'],
  ['fissureNetwork','fissure-network','Mode (0 line, 1 network)',['fissure'],0,1,1,1,'0: cut along the stroke. 1: a connected polygonal fracture network over the stroke\'s whole footprint (Diameter sets how far it reaches), as on Red\'s rock platforms.'],
  ['fissureCell','fissure-cell','Network block size (px)',['fissure'],30,160,5,1,'Typical width of a block between the cuts.'],
  ['fissureCrack','fissure-crack','Fractured rock beside the cut',['fissure'],0,100,5,100,'Raises the world\'s own crack field along the cut, so the rock beside it breaks up (0 leaves only the cut).'],
  ['fissureDark','fissure-dark','Darkness',['fissure'],0,100,5,100,'Paints the world\'s own wet (dark) ground along the cut, so it reads dark whatever the ground (it layers on rock, snow or moss).'],
  ['shorePlates','shore-plates','Shore plates',['landform'],0,1,1,1,'Add a band of broken plates on this stroke only. Off preserves the original water shape.'],
  ['plateWaterPx','plate-water-px','Plates: water width (px)',['landform'],0,240,4,1,'Reach from this stroke\'s waterline into the water.'],
  ['plateLandPx','plate-land-px','Plates: land width (px)',['landform'],0,240,4,1,'Reach from this stroke\'s waterline onto land, with broken pressure ridges.'],
  ['plateSize','plate-size','Plate size (px)',['landform'],8,96,2,1,'Typical width of the interlocking polygonal plates.'],
  ['plateGap','plate-gap','Plate gap (px)',['landform'],0,160,5,10,'Open gap between adjacent plates.'],
  ['plateHeight','plate-height','Plate height above sea',['landform'],0,240,5,10,'Flat water plates sit this high above sea; land keeps its existing height. Rock slabs: how far the land slabs stand above their seams.'],
  ['plateMaterial','plate-material','Plate material (1 rock slabs, 2 frost crystals)',['landform'],1,2,1,1,'2: frost crystals, parallel straight needles in patches of three directions, cut by straight seams, thinning toward deep water (Plate size is the patch, Plate gap the needle spacing; retail Ice). 1: low flat rock slabs that interlock along the shore with dark seams between them, and a shallow ledge under the water (Crystal). The band follows this stroke\'s own waterline, so separate shores stay separate.'],
  ['frostNeedles','frost-needles','Frost needle share (plate material 2)',['landform'],0,100,5,100,'Frost crystals: the share of patches that carry needles at all; the rest of the band is plain ice. Needles in a patch are also dropped at random, so lines are sparse, fine and of varied length.'],
  ['crystalForm','crystal-form','Form (0 crystals, 1 column mound, 2 berg)',['crystal'],0,2,1,1,'Crystals: separate faceted crystals (shards, or big blocks as on Ice). Column mound: a mound tiled with flat polygonal columns (Crystal world). Berg: a rough ice block with an uneven outline, broken corners and rough faces that take the world\'s own slope relief (Ice); Sides, Width, Height and Variation apply.'],
  ['crystalTiers','crystal-tiers','Stepped column tops',['crystal'],0,100,5,100,'Remove the mound incline from each column top so its height steps distinctly from its neighbors.'],
  ['crystalSides','crystal-sides','Sides',['crystal'],3,10,1,1,'Sides of each crystal\'s footprint (crystals form; columns are Voronoi, mostly 5-6 sides).'],
  ['crystalSize','crystal-size','Crystal width (px)',['crystal'],6,640,2,1,'Crystals: typical base width. Column mound: column top width (retail ~15).'],
  ['crystalStep','crystal-step','Column step',['crystal'],0,64,1,1,'Column mound: how far a column top steps up or down from its neighbors (retail ~16; ~40% flush).'],
  ['crystalCount','crystal-count','Crystals per cluster',['crystal'],1,40,1,1,'How many crystals a click grows; a longer stroke grows more.'],
  ['crystalTop','crystal-top','Flat tops',['crystal'],0,95,5,100,'0: pointed; higher cuts the tops level (a flat-topped prism).'],
  ['crystalLean','crystal-lean','Lean',['crystal'],0,100,5,100,'How far each apex leans off its base center.'],
  ['crystalVariation','crystal-variation','Variation',['crystal'],0,100,5,100,'Spread of sizes, heights and side counts.'],
  // Water looks (card E1): each stroke may keep the world's choice (0) or set its own.
  ['waterShore','water-shore','Shore edge (shore to shallow)',['landform'],0,2,1,1,'World default keeps the World panel\'s Crisp waterline. Hard: the water starts at the shoreline with ragged stairs, as retail draws it. Faded: the water fades in over a few pixels.',[[0,'World default'],[1,'Hard'],[2,'Faded']]],
  ['waterDeep','water-deep','Shallow-to-deep edge',['landform'],0,2,1,1,'World default keeps the World panel\'s Shallow-to-deep step. Hard: the shallow color stops at one depth with ragged stairs (retail Green). Faded: the color follows the depth ramp gradually (retail Archipelago).',[[0,'World default'],[1,'Hard'],[2,'Faded']]],
  ['waterBed','water-bed','Shallow water look',['landform'],0,3,1,1,'World default keeps the World panel\'s Lit bed. Lit bed: the ground under the water, lit by the same sun and tinted (retail). Noise water: the earlier flat noise texture. Cracked bed: lit bed over cracked rock-like ground, tinted (Red\'s shelf shallows).',[[0,'World default'],[1,'Lit bed'],[2,'Noise water'],[3,'Cracked bed']]],
  ['crystalAlign','crystal-align','Align faces to the frame (berg)',['crystal'],0,100,5,100,'Berg: 0 turns each block at random, 100 sets its faces square to the shape\'s frame (four sides then make an axis-aligned box).'],
  ['bergFace','berg-face','Face steepness (berg, units per px)',['crystal'],20,200,5,100,'Berg: how fast the faces rise, in height units per px (shown in percent: 90% is 0.9 units per px). Each face varies by Outline jitter.'],
  ['bergJitter','berg-jitter','Outline jitter (berg)',['crystal'],0,100,5,100,'Berg: how far the face angles, distances and steepness stray from a regular polygon, and how much each face wavers along its length.'],
  ['bergBreak','berg-break','Broken corners (berg)',['crystal'],0,8,1,1,'Berg: extra planes of their own steepness that cut corners off the block.'],
  ['bergRough','berg-rough','Face roughness (berg, units)',['crystal'],0,30,1,1,'Berg: fractal roughness added to the height, from 40 px lumps to 4 px grain.'],
  ['bergTilt','berg-tilt','Top tilt (berg, 1% = 1 unit per 100 px)',['crystal'],0,60,1,100,'Berg: the slope of the ramp that brings the top down away from the Tilt direction (the top is level toward it, at Height).'],
  ['bergFlat','berg-flat','Level top toward the tilt (berg, share of radius)',['crystal'],-80,80,5,100,'Berg: how far from the center, toward the tilt direction, the top stays level before it ramps down (negative: the ramp starts on the far side of the center).'],
  ['bergTiltDir','berg-tilt-dir','Tilt direction (berg, degrees, 90 = south)',['crystal'],0,359,1,1,'Berg: the direction the top rises toward, turning with the shape\'s frame.'],
  ['paintChannel','paint-channel','Paint',['paint'],1,25,1,1,'What the brush paints. Denser scatter supplies its own stones where the World panel\'s Boulders and Debris are 0 and multiplies them where they are not. Style settings go more or less than the world\'s own value; Strength is how far. Erase clears every mask and style under the brush.',[...MASK_CHOICES,...LUMP_CHOICES,...STYLE_CHOICES,[7,'Erase all masks and style']]],
  ['maskChannel','mask-channel','Paint inside the shape',MASK_SHAPES,0,6,1,1,'Also paint a mask over the shape\'s own footprint, strongest where the shape is (a rocky mesa, a mossy hill).',[[0,'Off'],...MASK_CHOICES]],
  ['maskAmount','mask-amount','Shape paint strength',MASK_SHAPES,5,100,5,100,'How fully the shape paints its mask.'],
  // Local style inside the shape (card C5 stage 2): each is a change about the world's own value, 0 none.
  ['styleRelief','style-relief','Style: relief strength',MASK_SHAPES,-100,100,5,100,'Relief (ribs, lumps) inside the shape: below 0 smoother, above 0 stronger, up to 4x.'],
  ['styleCracks','style-cracks','Style: cracks',MASK_SHAPES,-100,100,5,100,'Cracks inside the shape: below 0 fewer, above 0 more (also where the world has none).'],
  ['styleBanding','style-banding','Style: banding',MASK_SHAPES,-100,100,5,100,'Contour banding inside the shape: below 0 fainter, above 0 stronger (also where the world has none).'],
  ['styleFace','style-face','Style: face rock',MASK_SHAPES,-100,100,5,100,'Share of rock on steep faces inside the shape: below 0 more grass and moss, above 0 more rock.'],
  ['styleErosion','style-erosion','Override: erosion',MASK_SHAPES,-100,100,5,100,'Erosion rate inside the shape (the GPU pass), times 1 + this: below 0 less, above 0 more, -100% none. It also scales how steep loose slopes stand there, so more erosion cuts steeper walls.'],
  ['styleDeposits','style-deposits','Override: loose deposits',MASK_SHAPES,-100,100,5,100,'Sand and scree inside the shape, times 1 + this: below 0 less, above 0 more.'],
  ['styleVegetation','style-vegetation','Override: vegetation',MASK_SHAPES,-100,100,5,100,'Grass and moss cover inside the shape, times 1 + this: below 0 more bare rock, above 0 more cover.'],
  ['styleExposure','style-exposure','Override: rock exposure',MASK_SHAPES,-100,100,5,100,'Where rock shows inside the shape, times 1 + this: below 0 less, above 0 more.'],
  // E7
  ['crystalFacet','crystal-facet','Facet tilt (column mound)',['crystal'],0,100,5,100,'Column mound: tilts each column\'s top into one or two planes that meet at a crease, so the tops read as crumpled multi-facet crystal, not flat plates. 0 keeps flat tops.'],
  ['crystalSizeVar','crystal-size-var','Size variation (column mound)',['crystal'],0,100,5,100,'Column mound: the mound mixes three column widths (Column width, about half and about a third of it), the small ones where the mound is highest and in patches. 0 keeps one width.'],
  ['crystalSmooth','crystal-smooth','Smooth hill between crystals (column mound)',['crystal'],0,100,5,100,'Column mound: the share of the widest columns (and some of the middle ones) left as smooth hill with no flat top, taking the world\'s hill relief. 0 tiles the whole mound.'],
  ['craterFacets','crater-facets','Crystal facets',['crater'],0,100,5,100,'Crater: tiles the bowl, rim and apron with polygonal facets (planes fitted to the crater\'s own surface, stepped a few units from each other), so its contours are straight-edged like crystal. 0 keeps the smooth crater.'],
  // E10 (Lava): finger size; layer width variation; circle size of the circular layers.
  ['fingerSize','finger-size','Finger size',['landform'],20,300,5,100,'Fingers on the joined coast: length and (less) width of each finger. Fingers never reach past this stroke\'s bank.'],
  ['layerVary','layer-vary','Layer width variation',['landform'],0,100,5,100,'How much each layer\'s width and riser height change along the shore and from one layer to the next, so risers bunch, part and merge as retail\'s do. 0 keeps the even layers.'],
  ['layerCircle','layer-circle','Circle size (px, circular layers)',['landform'],8,80,1,1,'Circular layers: the typical radius of the round bites cut from the bank.'],
  // G7 (Crystal): craters with smaller, softer facets.
  ['crystalCraterPx','crystal-crater-px','Facet width (px, crystal craters)',['crater'],0,48,2,1,'Crater facets: the width of each polygonal facet. 0 sizes them by the crater\'s radius (about a third of it, 14-36 px); retail\'s crater walls break into cells of 12-20 px.'],
  ['crystalCraterStep','crystal-crater-step','Facet step (units, crystal craters)',['crater'],0,60,5,10,'Crater facets: how far each facet may stand above or below the crater\'s own surface, in height units either way (shown in tenths: 3 is the earlier ragged crater). Retail\'s crater walls are smooth planes broken by a thin web, so a small step keeps the sun\'s light running smoothly across the wall.'],
  ['crystalCraterSkin','crystal-crater-skin','Web in the shader (crystal craters)',['crater'],0,100,100,100,'Crater facets: 100 marks the whole crater as one crystal skin (no seams in the crystal field) and leaves the thin web between the facets to the shader (World knobs crystalCraterWeb and its relatives), drawn at pixel size so its lines run thin and wander; 0 inks each facet\'s seam in the field as before.'],
  // G7 (Crystal): finer shore slabs.
  // H20b (Crystal): some slabs break into a fine mesh.
  ['plateVary','plate-vary','Rock slab variety (share of slabs broken into fine mesh)',['landform'],0,100,5,100,'Rock slabs (Plate material 1): in patches, a slab breaks into a fine mesh of cells about 0.4 of Plate size inside its own outline, so the large seams stay. This sets the share of slabs that break; 0 keeps every slab whole.'],
  ['crystalShoreSeam','crystal-shore-seam','Rock slab seam mark (crystal shores)',['landform'],50,65,1,100,'Rock slabs: the crystal-field value of a seam. 50 is the earlier black seam; higher values thin it (the shader inks only below 66) toward the hairline seams of retail\'s shore band.'],
  // G6 (Ice): angular facets on a raised landform.
  ['iceFacets','ice-facets','Angular facets',['landform'],0,100,5,100,'Breaks part of the raised shape into angular facets: tilted planes fitted to the shape\'s own surface, a little steeper, stepped a few units off their neighbors and partly buried where the ground rises past them. They share the shape\'s material and light, so they stand out of the snow as part of it. 0 keeps the smooth surface. A landform with shore features keeps those instead.'],
  ['iceFacetSize','ice-facet-size','Facet size (px)',['landform'],16,96,2,1,'Ice facets: the typical width of one facet.'],
  // G5 (Lava): contour layers wander in two dimensions and vary in width, as retail lava-1's bank.
  ['lavaCircleVary','lava-circle-vary','Circle variety (circular layers)',['landform'],0,100,5,100,'Circular layers: how much the bites differ from one another, in radius (a few large among many small), in the spacing of their rings, and in how many sites keep one, so they gather in clusters with bare stretches, as retail lava-2\'s do. 0: the even circles.'],
  ['lavaSpread','lava-spread','Layer width spread',['landform'],0,200,5,100,'Contour layers: extra spread in layer width along the shore, on top of Layer width variation (100 is about 2.7 times between the narrowest and the widest). 0: none.'],
];
const E7_KEYS=['crystalFacet','crystalSizeVar','crystalSmooth','craterFacets'];
const G7_KEYS=['crystalCraterPx','crystalCraterStep','crystalCraterSkin','crystalShoreSeam','plateVary'];
// G6 (Ice): the mountain facets' options, wired beside E7's (the card the stroke builds and strokeParams).
const G6_KEYS=['iceFacets','iceFacetSize'];
for (const [key,id,,,lo,hi] of SHAPE_FIELDS) TOOL_FIELDS[key]=[id,lo,hi];
const worldSetting=key => experiment.has(key)?Number(experiment.get(key)):worldDefault(key);
const worldDefault=key => { const v=Number(config?.defaults?.[key]); return Number.isFinite(v)?v:0; };
// Values a replayed shape uses for options it was drawn without.
// Owner ruling (H10): fingers always join the coast as thumbs. The JS engine, which H12 deletes, still reads the two retired knobs, so they are fixed here.
const shapeDefaults=() => ({...Object.fromEntries([...SHAPE_FIELDS.map(([key]) => key),...SPUR_OUTLINE_KEYS].map(key => [key,worldDefault(key)]))});
const nodeShapeParams=n => {const q={...shapeDefaults(),...n.params};return n.kind==='landform'?landformSteps(q):q;};
const shapeValue=key => { const f=SHAPE_FIELDS.find(f => f[0]===key); return Number($(f[1]).value)/f[7]; };
function buildShapeOptions() {
  const root=$('shape-options');
  root.replaceChildren(...SHAPE_FIELDS.map(([key,id,label,,lo,hi,step,,help,choices]) => {
    label=controlLabel(key,label);
    if(key==='crystalForm')choices=[[0,'Faceted shards'],[1,'Column mound'],[2,'Planar blocks']];
    if(key==='fissureNetwork')choices=[[0,'Path cut'],[1,'Fracture network']];
    if(key==='plateMaterial')choices=[[1,'Polygonal slabs'],[2,'Needle band']];
    const wrap=document.createElement('div'); wrap.className='control'; wrap.id=id+'-control';
    const input=choices?`<select id="${id}" style="width:100%">${choices.map(([v,l]) => `<option value="${v}">${l}</option>`).join('')}</select>`:`<input id="${id}" type="range" min="${lo}" max="${hi}" step="${step}">`;
    wrap.innerHTML=`<label for="${id}">${label} <output id="${id}-value"${choices?' hidden':''}></output></label>${input}<p class="small">${help}</p>`;
    return wrap;
  }));
  // The section editor sits above the face width (H15 part 2, step C; H27): a form to pick, the whole section across both sides to drag, the lean, and for a
  // landform the sides' link and the second curve, the elevation along the path.
  const preview=document.createElement('div'); preview.className='control'; preview.id='section-preview-control'; preview.hidden=true;
  const cvStyle='width:100%;background:#172119;border:1px solid #465344;border-radius:4px;touch-action:none;display:block;margin-top:4px';
  preview.innerHTML=`<label for="curve-form">Section</label><select id="curve-form" style="width:100%"></select>`+
    `<canvas id="section-preview" width="480" height="240" style="${cvStyle};cursor:crosshair"></canvas>`+
    `<div style="display:flex;gap:6px;margin-top:4px;align-items:center;flex-wrap:wrap"><button type="button" id="curve-link" style="flex:none" aria-pressed="true" title="Both sides share one curve">Link sides</button><button type="button" id="curve-mirror" style="flex:none" title="Flip the section left to right">Mirror</button><button type="button" id="curve-reset" style="flex:none">Reset to the form</button><span class="small" id="curve-lean" style="flex:1 1 100%"></span></div>`+
    '<p class="small" id="curve-help">Height against distance across the shape, both sides. Drag a knot; click the line to add one; double-click a knot (or Shift-click) to remove it. Drag the diamond at the crest sideways to lean the shape. A knot above the top makes a lip (on water, below 0).</p>'+
    `<div id="along-block" hidden><label for="along-preview">Height along the path</label><canvas id="along-preview" width="480" height="140" style="${cvStyle};cursor:crosshair"></canvas>`+
    '<div style="display:flex;gap:6px;margin-top:4px"><button type="button" id="along-reset" style="flex:none">Level along the path</button></div>'+
    '<p class="small">The dashed line is the crest\'s height along the path you drew, as a share of the elevation above the plain; the solid line is read from the map. Click to pick the place the section shows (marked on the map); double-click the line to add a knot, drag a knot to move it, Shift-click a knot to remove it.</p></div>';
  root.children[SHAPE_FIELDS.findIndex(f => f[0]==='lean')].before(preview);
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
      const height=landformElevation({elevation:shapeValue('elevation'),heightReference:previous.heightReference},config.seaLevel);
      heightControlRange({heightReference:next});$('lf-elevation').value=height-(next===1?config.seaLevel:0);
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
  syncToolGroups=groupToolControls(SHAPE_FIELDS);
}
let toolSettings={};
const clamp=(v,a,b) => Math.max(a,Math.min(b,v));
const smooth=(a,b,v) => { const t=clamp((v-a)/(b-a),0,1); return t*t*(3-2*t); };
// Rounded authored knots preserve a long shoulder and a short exposed face.
// Zero slope at the crown avoids the knife edge of a skewed power-law dome.
setFailureHandler(err => error(err?.message??String(err)));
function error(message='') { $('error').textContent=message; $('error').hidden=!message; }
function status(message) { $('status').textContent=message; }
// Height slider range per shape kind; Raise / lower is signed.
const amountRange=kind => kind==='crystal'?[5,200]:kind==='fissure'?[2,60]:['smooth','sand','grass','paint'].includes(kind)?[5,100]:[5,160];
// Cover brushes share the plateau outline and write a field, not heights; the
// mask brush (card C5) is one of them.
const isCover=kind => kind==='sand' || kind==='grass' || kind==='paint';
// A palette entry's starting settings in a world (a landform kind starts as the plateau). A sea-level preset keeps its elevation above the sea.
function toolDefaults(entry,preset=config?.biomeId||'green') {
  const shape=entry==='landform'?'plateau':entry,kind=strokeKind(shape);
  const starting={...(kind==='landform'?{...LANDFORM_DEFAULTS,...LANDFORM_TOOLS[shape]}:{}),...TOOL_PRESETS[preset]?.[shape]},sea=Math.round(starting.heightReference||0)===1;
  return {...Object.fromEntries(SHAPE_FIELDS.map(([key,,,,lo,hi,,scale]) => [key,clamp(Math.round(worldDefault(key)*scale),lo,hi)])),cracks:{crater:30}[kind]??0,diameter:200,amount:kind==='fissure'?12:isCover(kind)?100:70,roughness:35,softness:50,preset,...starting,
    elevation:sea?Math.round(starting.elevation):clamp(Math.round((config?.baseHeight??24)+(starting.elevation??70)),-80,300)};
}
function rememberTool(custom=false) {
  const state={...toolSettings[tool]};
  for (const [key,[id]] of Object.entries(TOOL_FIELDS)) state[key]=Number($(id).value);
  if (custom) state.preset='custom';
  toolSettings[tool]=state;
}
function heightControlRange(p={}) {
  const offset=Math.round(p.heightReference||0)===1?(config?.seaLevel||0):0;
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
  const picks=JSON.stringify([strokeWaterPicks(),slopeReplaced()]);if(picks!==panelPicks){panelPicks=picks;syncWorldControls();}   // a stroke's water choice, or the transition replacing the slope color, wakes or idles world rows
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
  $('selection-empty').hidden=hasSelection;
  $('path-actions').hidden=!pathEditing||!hasSelection;
  $('transform-controls').hidden=pathEditing||!hasSelection||drawMode==='add';$('path-help').hidden=drawMode==='add';
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
  $('seed-label').textContent=editingSeed?'Shape seed':'Brush seed';
  if(document.activeElement!==$('seed'))$('seed').value=editingSeed?selectedNode.seed:seed;
  $('seed').disabled=$('seed-randomize').disabled=$('seed-vary').disabled=locked;
  $('seed-vary').checked=varySeed;$('seed-vary-control').hidden=editingSeed;
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
  $('lf-elevation-control').querySelector('label').firstChild.textContent=shapeValue('heightReference')===1?'Height above sea (units) ':'Elevation (height units) ';
  const fixed=['erase','landform'].includes(kind);
  $('amount-control').hidden=fixed;
  $('amount-label').textContent=kind==='smooth' || isCover(kind)?'Strength':kind==='crystal'?'Height':kind==='crater' || kind==='fissure'?'Depth':'Rise';
  const [lo,hi]=amountRange(kind); $('amount').min=String(lo); $('amount').max=String(hi);
  $('amount').value=String(clamp(Number($('amount').value),lo,hi));
  const amountNow=Number($('amount').value);
  $('amount-value').textContent=kind==='smooth' || isCover(kind)?amountNow+'%':'+'+amountNow;
  $('diameter-value').textContent=$('diameter').value+' units';
  $('roughness-value').textContent=$('roughness').value+'%';
  $('roughness-label').textContent=['erase','sand','grass','paint'].includes(kind)?'Edge freedom':'Roughness';
  // A fissure's outline is its own jaggedness; Roughness would do nothing.
  $('roughness').closest('.control').hidden=kind==='fissure'||kind==='landform';
  $('softness-control').hidden=!['crater','erase','sand','grass','paint'].includes(kind);
  if (kind==='crystal') $('roughness-label').textContent='Irregularity';
  $('cracks-control').hidden=!['crater','landform'].includes(kind);
  $('cracks-value').textContent=$('cracks').value+'%';
  // Spur, rim and gully details show once their switch (spurs, sectors, gaps, gullies) is on.
  const gate={gullySize:'gullies',talus:'gullies',layerPx:'shoreLayers',layerRiser:'shoreLayers',layerLedge:'shoreLayers',layerRough:'shoreLayers',layerStyle:'shoreLayers',layerVary:'shoreLayers',layerCircle:'shoreLayers',iceFacetSize:'iceFacets',fingerSize:'fingers',spurLength:'spurCount',spurSpread:'spurCount',spurWidth:'spurCount',spurTaper:'spurCount',spurHeight:'spurCount',spurForks:'spurCount',spurBulb:'spurCount',rimUnequal:'rimSectors',rimGapWidth:'rimGaps',fissureBranchLen:'fissureBranches',fissureBranchSpread:'fissureBranches',lavaSpread:'shoreLayers',lavaCircleVary:'shoreLayers'};
  if(kind==='landform')for(const key of Object.keys(gate))if(gate[key]==='shoreLayers')delete gate[key];
  // On a crater, the crest options only shape its spurs.
  if (kind==='crater') { gate.crestJag='spurCount'; gate.crestVary='spurCount'; }
  // A fissure in network mode has no branches, taper or path jag to set; line mode has no block size.
  const net=kind==='fissure' && Number($('fissure-network').value)>=.5;
  const modeOff=key => kind==='fissure' && (net?['fissureBranches','fissureBranchLen','fissureBranchSpread','fissureTaper'].includes(key):key==='fissureCell');
  // Berg options show only for the berg form.
  const frostOff=key => key==='frostNeedles' && Number($('plate-material').value)<2;
  const bergOff=key => kind==='crystal' && ['crystalAlign','bergFace','bergJitter','bergBreak','bergRough','bergTilt','bergTiltDir','bergFlat'].includes(key) && Number($('crystal-form').value)<2;
  const shapeOptions={...Object.fromEntries(SHAPE_FIELDS.map(([key])=>[key,shapeValue(key)])),curve:currentCurve(),world:renderer?worldPanelValues():{}};
  const gated=key => !shapeControlAvailable(key,kind,shapeOptions) || modeOff(key) || bergOff(key) || frostOff(key) || (gate[key] && !(Number($(SHAPE_FIELDS.find(f => f[0]===gate[key])[1]).value)>0));
  for (const [key,id,,kinds,,,,scale] of SHAPE_FIELDS) { $(id+'-control').hidden=!kinds.includes(kind) || gated(key) || (key==='maskAmount' && Number($('mask-channel').value)<1); $(id+'-value').textContent=scale===1?$(id).value:scale===10?(Number($(id).value)/scale).toFixed(1):$(id).value+'%'; }
  // P28: on a river, Wander is the migration (how many steps the drawn line is carried), not an outline noise in px; once the path is edited by hand it cannot be migrated again.
  { const riv=kind==='landform'&&isRiver(shapeOptions),node=nodes[selected],stale=riv&&Boolean(node?.params)&&(node.params.river?.sig===undefined||node.params.river.sig!==pointsSignature(node.points)),why='The path was edited by hand, so it is not migrated again: draw a new river to change its bends.';
    $('lf-wander-control').querySelector('label').firstChild.nodeValue=riv?'Wander (bends) ':'Wander (px) ';
    $('lf-wander-control').querySelector('.small').textContent=stale?why:riv?'How far the line you drew is carried by the river\'s own rule, as migration steps (4 a unit): 0 keeps it as drawn, more grows meander bends that travel downstream and leave oxbow lakes where a neck closes. A new seed gives other bends.':SHAPE_FIELDS.find(f => f[0]==='wander')[8];
    $('lf-wander').disabled=stale;$('lf-wander').title=stale?why:''; }
  $('section-preview-control').hidden=kind!=='landform';
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
  const plain=config.baseHeight,sea=config.seaLevel,E=landformElevation(c.q,sea),span=Math.abs(E-plain)<1?(E<plain?-1:1):E-plain,top=plain+span*1.2;
  let lo=Math.min(sea,plain,E,top),hi=Math.max(sea,plain,E,top); const pad=Math.max(5,(hi-lo)*.1); lo-=pad; hi+=pad;
  return {plain,sea,E,span,lo,hi};
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
  let path=simplifyPath(pts,Math.max(1,q.radius*.04)).filter((p,k,a) => !k || Math.hypot(p.x-a[k-1].x,p.y-a[k-1].y)>=1e-4);
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
// A canvas is drawn at the pixels it is shown in (as wide as its panel, 2 to 1), so its text stays small and sharp.
function fitCanvas(cv,ratio) { const w=Math.round(cv.clientWidth); if (w>=120 && cv.width!==w) { cv.width=w; cv.height=Math.round(w*ratio); } }
function drawSection() {
  fitCanvas($('section-preview'),.5); fitCanvas($('along-preview'),.3);
  const cv=$('section-preview'),g=cv.getContext('2d'),c=curveContext(),L=sectionLayout(c),{ys,back}=sectionPreview(c.kind,c.q),n=ys.length-1;
  g.clearRect(0,0,L.W,L.H); g.font='9px system-ui';
  const rule=(y,color,label) => { g.strokeStyle=color; g.setLineDash([3,3]); g.beginPath(); g.moveTo(L.xL,y); g.lineTo(L.xR,y); g.stroke(); g.setLineDash([]); if (label) { g.fillStyle=color; g.textAlign='left'; g.fillText(label,L.xL+2,y-2); } };
  if (c.land) { rule(L.yH(L.sea),'#6aa7c4',`sea ${L.sea}`); rule(L.yH(L.plain),'#8b9b87',`plain ${L.plain}`); rule(L.yH(L.E),'#e8f2d8',`elevation ${L.E}`); }
  else { rule(L.yv(0),'#465344'); rule(L.yv(1),'#465344'); }
  const base=L.yv(0),trace=() => { for (let k=0;k<=n;k++) g.lineTo(L.xL+(L.xc-L.xL)*k/n,L.yv(back[k])); for (let k=n;k>=0;k--) g.lineTo(L.xc+(L.xR-L.xc)*(n-k)/n,L.yv(ys[k])); };
  g.beginPath(); g.moveTo(L.xL,base); trace(); g.lineTo(L.xR,base); g.closePath(); g.fillStyle='rgba(180,213,137,.25)'; g.fill();
  g.beginPath(); g.moveTo(L.xL,L.yv(back[0])); trace(); g.strokeStyle='#b4d589'; g.lineWidth=1.5; g.stroke(); g.lineWidth=1;
  // The map's own sections across the selected landform, at five places along it and at the place picked below, in height units.
  const node=c.land?selectedLandform():null;
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
  rule(L.yH(L.sea),'#6aa7c4',`sea ${L.sea}`); rule(L.yH(L.plain),'#8b9b87',`plain ${L.plain}`); rule(L.yH(L.E),'#e8f2d8',`elevation ${L.E}`);
  const node=selectedLandform(),N=48;
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
  const vOf=(c,L,py) => clamp(L.vy(py),0,1.5);
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
// The along-the-path canvas: drag a knot, double-click the line to add one, Shift-click or double-click a knot to remove it (the ends stay); a click elsewhere picks the
// place whose section the canvas above shows.
function alongEditorEvents() {
  const cv=$('along-preview'); let drag=-1,moved=false;
  const at=e => { const r=cv.getBoundingClientRect(); return {px:(e.clientX-r.left)*cv.width/r.width,py:(e.clientY-r.top)*cv.height/r.height}; };
  const hit=(c,L,knots,p) => { let best=-1,d=8; knots.forEach(([x,v],i) => { const dd=Math.hypot(L.X(x)-p.px,L.yv(v)-p.py); if (dd<d) { d=dd; best=i; } }); return best; };
  const store=ks => setCurve(roundKnots(ks),'along');
  const finish=() => { if (drag>=0) { const edited=moved; drag=-1; if (edited && selected>=0) { checkpoint(); queueWeather(); } } };
  cv.addEventListener('pointerdown',e => {
    if (e.button!==0) return;
    const p=at(e),c=curveContext(),L=alongLayout(c),knots=alongKnots(c.q).map(k => [...k]),i=hit(c,L,knots,p); moved=false;
    if (i>=0 && e.shiftKey) { if (i>0 && i<knots.length-1 && knots.length>2) { knots.splice(i,1); store(knots); if (selected>=0) { checkpoint(); queueWeather(); } } return; }
    if (i>=0) { drag=i; cv.setPointerCapture(e.pointerId); return; }
    lfPlace=L.T(p.px); drawSection(); schedule();
  });
  cv.addEventListener('pointermove',e => {
    if (drag<0) return;
    const p=at(e),c=curveContext(),L=alongLayout(c),knots=alongKnots(c.q).map(k => [...k]),k=knots[drag]; if (!k) return;
    if (drag>0 && drag<knots.length-1) k[0]=clamp(L.T(p.px),knots[drag-1][0]+.01,knots[drag+1][0]-.01);
    k[1]=clamp(L.vy(p.py),0,ALONG_HI); moved=true; store(knots);
  });
  cv.addEventListener('pointerup',finish); cv.addEventListener('pointercancel',finish);
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
const NODE_NAMES={landform:'Landform',crystal:'Faceted form',sand:'Sand cover',paint:'Surface paint',grass:'Ground cover',erase:'Reset ground',ground:'Ground undulation',crater:'Crater',fissure:'Fissure',smooth:'Smooth',raster:'Imported surface',compact:'Height scale',flowbake:'Flow bake'};
function strokeParams(s) { return {...Object.fromEntries(['shorePlates','plateWaterPx','plateLandPx','plateSize','plateGap','plateHeight','plateMaterial','frostNeedles',...COAST_KEYS,...SPUR_OUTLINE_KEYS].map(k => [k,s[k]])),radius:s.radius,amount:s.amount,rough:s.rough,softness:s.softness,craterlets:s.craterlets,craterEjecta:s.craterEjecta,lean:s.lean,facing:s.facing,fingers:s.fingers,faceVariation:s.faceVariation,crystalTiers:s.crystalTiers,paintChannel:s.paintChannel,maskChannel:s.maskChannel,maskAmount:s.maskAmount,...Object.fromEntries(STYLE_KEYS.map(k => [k,s[k]])),...Object.fromEntries(WATER_KEYS.map(k => [k,s[k]])),crystalForm:s.crystalForm,crystalStep:s.crystalStep,crystalSides:s.crystalSides,crystalSize:s.crystalSize,crystalCount:s.crystalCount,crystalTop:s.crystalTop,crystalLean:s.crystalLean,crystalVariation:s.crystalVariation,...Object.fromEntries(['crystalAlign','bergFace','bergJitter','bergBreak','bergRough','bergTilt','bergTiltDir','bergFlat'].map(k => [k,s[k]])),...Object.fromEntries(SECTION_KEYS.map(k => [k,s[k]])),...Object.fromEntries(LANDFORM_KEYS.map(k => [k,s[k]])),curve:s.curve,along:s.along,...Object.fromEntries(RIDGE_KEYS.map(k => [k,s[k]])),...Object.fromEntries(FISSURE_KEYS.map(k => [k,s[k]])),cracks:s.cracks,
  // E7, G7, G6
  ...Object.fromEntries([...E7_KEYS,...G7_KEYS,...G6_KEYS].map(k => [k,s[k]]))}; }
const craterFacetWidth=q => q.crystalCraterPx>0?q.crystalCraterPx:clamp(q.radius*.36,14,36);
// The crystal mark of a crater's skin (G7): the shader reads exactly this value, which no column's mark (.8 and over) or seam (.5) has.
const craterletRand=(seed,k,a) => { let x=Math.imul((seed>>>0)+k*7919+a*104729,2654435761)>>>0; x^=x>>>15; x=Math.imul(x,2246822519)>>>0; return (x>>>0)/4294967296; };
// Craterlet k of crater node n: center and radius, from the crater's seed
// alone (region replay needs the centers before it replays anything).
function craterletSpot(n,seed,radius,k) {
  const first=shapePaths(n)[0],c=n.points[first[first.length>>1]],turn=isIdentity(n.frame)?0:Math.atan2(n.frame[1],n.frame[0]);
  const angle=craterletRand(seed,k,1)*Math.PI*2+turn,dist=radius*(.9+craterletRand(seed,k,2)*1.1),small=radius*(.1+.22*craterletRand(seed,k,3));
  return {p:{x:clamp(c.x+Math.cos(angle)*dist,0,size-1),y:clamp(c.y+Math.sin(angle)*dist,0,size-1)},small};
}
const FIELD_KEYS=['h','p','r','c','v','x',...MASK_KEYS];
function addNode(n) {
  nodes.push(n); regionalFields.changed(nodeBounds(n));
}
function nodeBounds(n) {
  // World-space reach of a shape, from the same extents its brush uses.
  if (!n.points) return {x0:0,y0:0,x1:grid-1,y1:grid-1};
  const q=nodeShapeParams(n),radius=q.radius||40,rough=q.rough??.35;
  const reach={erase:Math.min(1.7,1+rough*1.3)+1.9*rough,sand:Math.min(1.7,1+rough*1.3)+1.9*rough,grass:Math.min(1.7,1+rough*1.3)+1.9*rough,paint:Math.min(1.7,1+rough*1.3)+1.9*rough,crater:2.9*(1+.45*rough)+.9*rough}[n.kind] ?? 1+.4*rough;
  let r=n.kind==='crystal'?radius*(q.crystalForm>=.5 && q.crystalForm<1.5?1.35:1)+(q.crystalForm>=.5 && q.crystalForm<1.5?0:(q.crystalSize||24)*(n.frame?Math.hypot(n.frame[0],n.frame[1]):1)*1.6)+12*spacing:radius*reach+12*spacing;
  // A landform reaches its widest side grown by the width variation, the wander and the spurs (the same reach its segment boxes use).
  if(n.kind==='landform'){
    r=landformReach({...q,radius},n.frame?Math.hypot(n.frame[0],n.frame[1]):1)+12*spacing;
    // Match the shared coast pass's expanded box as well as the swept profile's reach.
    if(q.fingers>0||q.shoreLayers>=1||q.shorePlates>0)r+=Math.max(q.fingers>0?.5*radius+3*spacing:0,q.shoreLayers>=1?coastLayerReach(q):0,q.shorePlates>0?Math.max(q.plateWaterPx||0,q.plateLandPx||0)+2*spacing:0)+12*spacing;
  }
  let ax=Infinity,ay=Infinity,bx=-Infinity,by=-Infinity;
  for (const p of n.points) { ax=Math.min(ax,p.x); ay=Math.min(ay,p.y); bx=Math.max(bx,p.x); by=Math.max(by,p.y); }
  // A fissure reaches its branches (and their forks) and, in network mode, its footprint.
  if (n.kind==='fissure') { const k=n.frame?Math.hypot(n.frame[0],n.frame[1]):1; r=(q.fissureNetwork>=.5?radius*1.1:0)+(Math.round(q.fissureBranches)>=1?(q.fissureBranchLen||0)*2.4*k:0)+(q.fissureWidth||5)*3*k+24+12*spacing; }
  // Spurs (card C4) reach up to one and a half spur lengths past the ridge or rim, plus their own width.
  // A spur's root flares to about 1.7 times Spur width.
  if (Math.round(q.spurCount)>=1 && ['crater','landform'].includes(n.kind)) { const k=n.frame?Math.hypot(n.frame[0],n.frame[1]):1; r+=(q.spurLength||0)*(q.spurForks>0?2.1:1.6)*k+radius*Math.max(1,((q.spurWidth||.8)+(q.spurBulb||0)*.7)*1.7); }
  return {x0:clamp(Math.floor((ax-r)/spacing-originCellX),0,grid-1),y0:clamp(Math.floor((ay-r)/spacing-originCellY),0,grid-1),x1:clamp(Math.ceil((bx+r)/spacing-originCellX),0,grid-1),y1:clamp(Math.ceil((by+r)/spacing-originCellY),0,grid-1)};
}
const unionRect=(a,b) => !a?b:!b?a:{x0:Math.min(a.x0,b.x0),y0:Math.min(a.y0,b.y0),x1:Math.max(a.x1,b.x1),y1:Math.max(a.y1,b.y1)};
const overlaps=(a,b) => a.x0<=b.x1 && b.x0<=a.x1 && a.y0<=b.y1 && b.y0<=a.y1;
function evaluate(from=0,rect=null) {
  regionalFields.changed(regionalDirtyRect(from,rect),regionalStages(nodes.slice(0,from)).length); markChanged();
}

// Satellite crater baselines see the completed bowl and preceding satellites.
// Split those steps into prefix stages rather than pulling a whole crater into
// every touched tile. Their dabs do not write the parent's masks/crack field,
// so applying that parent-only field before its satellites preserves ordering.
function regionalStages(list=nodes) {
  const out=[];
  for (const n of list) {
    if (n.hidden) continue;
    if (n.kind!=='crater') { out.push(n); continue; }
    const q=nodeShapeParams(n),s=n.seed??seed;
    out.push({...n,regionalBody:true});
    for (let k=0;k<Math.round(q.craterlets||0);k++) {
      const {p,small}=craterletSpot(n,s,q.radius,k);
      out.push({...n,points:[p],paths:undefined,params:{...q,radius:small,amount:q.amount*(.25+.3*craterletRand(s,k,4)),craterlets:0},seed:(s+k*2654435761)>>>0,regionalChild:true});
    }
    if (Math.round(q.spurCount)>=1) out.push({...n,regionalSpurs:true});
  }
  return out;
}
function regionalReadApron(n) {
  if (!n.points || n.regionalChild || n.regionalSpurs) return 0;
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
  if(n.kind==='landform'&&q.iceFacets>0){const f=n.frame??IDENTITY,L=clamp(q.iceFacetSize,16,96);cells+=Math.ceil(1.95*L*Math.max(Math.abs(f[0])+Math.abs(f[2]),Math.abs(f[1])+Math.abs(f[3]))/spacing+.5)+4;}
  if(n.kind==='crater'&&q.craterFacets>0){const f=n.frame??IDENTITY,L=craterFacetWidth(q);cells+=Math.ceil(1.95*L*Math.max(Math.abs(f[0])+Math.abs(f[2]),Math.abs(f[1])+Math.abs(f[3]))/spacing+.5)+3;}
  if (n.kind==='landform' && q.shorePlates>0) cells+=Math.ceil(Math.max(q.plateWaterPx,q.plateLandPx)/spacing)+2;
  return cells;
}
// A remote baseline can change a later shape far outside the edited cells.
// This is dirty-output metadata only: it never enlarges a field read window.
function regionalDirtyRect(from,rect) {
  if (!rect) return null;
  let dirty={...rect};
  const pointTouched=p => { const x=p.x/spacing,y=p.y/spacing; return overlaps(dirty,{x0:Math.floor(x),y0:Math.floor(y),x1:Math.ceil(x),y1:Math.ceil(y)}); };
  for (let i=Math.max(0,from+1);i<nodes.length;i++) {
    const n=nodes[i]; if (n.hidden || !n.points?.length) continue;
    const b=nodeBounds(n),points=n.kind==='crater'?[n.points[0]]:[];   // a crater reads its rim height at its first point
    if (n.kind==='crater') for (let k=0;k<Math.round(n.params?.craterlets??worldDefault('craterlets'));k++) points.push(craterletSpot(n,n.seed??seed,n.params?.radius??40,k).p);
    if (points.some(pointTouched)) { dirty=unionRect(dirty,b); continue; }
    const pad=regionalReadApron(n),reach={x0:Math.max(0,dirty.x0-pad),y0:Math.max(0,dirty.y0-pad),x1:Math.min(worldGrid-1,dirty.x1+pad),y1:Math.min(worldGrid-1,dirty.y1+pad)};
    if (pad && overlaps(reach,b)) dirty=unionRect(dirty,{x0:Math.max(reach.x0,b.x0),y0:Math.max(reach.y0,b.y0),x1:Math.min(reach.x1,b.x1),y1:Math.min(reach.y1,b.y1)});
  }
  return dirty;
}
// Shape runs on the GPU: the compute passes of engine-shape.wgsl (sculpt-gpu-fields.js) draw every brush; a node they do not draw draws nothing.
const shapeContext=() => ({params:n => ({...shapeDefaults(),...n.params}),seed,repose:Math.tan((renderer?.variantNumber?.('talusAngle',40)??40)*Math.PI/180),sea:config.seaLevel,baseHeight:config.baseHeight,minH:MIN_HEIGHT,maxH:MAX_HEIGHT,
    frost:{gapSize:worldSetting('frostGapSize'),gapDepth:worldSetting('frostGapDepth'),gaps:worldSetting('frostGaps'),gapReach:worldSetting('frostGapReach')}});
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
  return {radius:Number($('diameter').value)/2,amount:Number($('amount').value),rough:Number($('roughness').value)/100,softness:Number($('softness').value)/100,cracks:Number($('cracks').value)/100,seed,...Object.fromEntries(SHAPE_FIELDS.map(([key]) => [key,shapeValue(key)])),...Object.fromEntries(SPUR_OUTLINE_KEYS.map(k => [k,worldDefault(k)])),...(toolSettings[tool]?.curve?{curve:toolSettings[tool].curve}:{}),...(toolSettings[tool]?.along?{along:toolSettings[tool].along}:{})};
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
const migrateRiverNode=node => applyRiver(node,{w:config.map?.width??size,h:config.map?.height??size});
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
function currentDrawOptions() {
  return {clay:$('clay').checked,light:$('light').value,detail:Number($('relief').value)/100,ring:Number($('mineral-ring').value)/100,ringSpread:Number($('ring-spread').value)/100,ringVariation:Number($('ring-variation').value)/100,materialWeathering:Number($('material-weathering').value)/100,transitionDetail:Number($('transition-detail').value)/100};
}
function regionalHeightCell(x,y) {
  const h=regionalFields.cell(x,y),i=y*worldGrid+x;
  if (!refined || !refinedBase || !$('weather').checked || !refinementValid(refinedInvalidRect,x,y)) return h;
  return Math.fround(h+(refined[i]-refinedBase[i])*(1-smooth(0,10,Math.abs(h-refinedBase[i])))*(1-regionalFields.cell(x,y,'r')));
}
function sampleRegional(x,y) {
  if (pagedOn()) return regionalFields.sampleEroded(x,y);
  if (gpuWeather && !gpuWeather.cpuHeight && !stroke && !moving && $('weather').checked) gpuWeatherCpu(false).catch(() => {});   // H6b: the first CPU reader asks for the Time pass's height
  if (!refined || !refinedBase || !$('weather').checked) return regionalFields.sample(x,y);
  const gx=clamp(x/spacing,0,worldGrid-1),gy=clamp(y/spacing,0,worldGrid-1),ix=Math.floor(gx),iy=Math.floor(gy),jx=Math.min(ix+1,worldGrid-1),jy=Math.min(iy+1,worldGrid-1),fx=gx-ix,fy=gy-iy;
  return (regionalHeightCell(ix,iy)*(1-fx)+regionalHeightCell(jx,iy)*fx)*(1-fy)+(regionalHeightCell(ix,jy)*(1-fx)+regionalHeightCell(jx,jy)*fx)*fy;
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
  const p={age:renderer.variantNumber('erosionAge',200),rain:renderer.variantNumber('erosionRain',1),talusAngle:renderer.variantNumber('talusAngle',40),columnContrast:renderer.variantNumber('columnContrast',1),
    envelope:renderer.variantNumber('erosionEnvelope',2),sand:renderer.variantNumber('sand',0),wetReach:renderer.variantNumber('wetReach',3),talusFull:renderer.variantNumber('talusFull',2.5),wearFull:renderer.variantNumber('wearFull',1.5),flowK:renderer.variantNumber('flowK',30)};
  const material=materialKnobs();
  return fields.setTime({key:JSON.stringify({...p,material,column:config.column,variant:config.variant}),material:Boolean(material),run:async win => {
    const {erosionOf}=await import('./sculpt-erosion.js'),erosion=await erosionOf(renderer);
    const r=await erosion.runGpu({...p,planes:win.planes,masks:win.masks,rateMask:MASK_KEYS.indexOf('ovErosion'),grid:win.grid,size,spacing,seaLevel:config.seaLevel,ox:win.ox,oy:win.oy,drainage:drainagePlane()});
    // The window's eroded height (plane 1 of the pass's weather buffer) makes the material field; the page keeps its core of it.
    if (material) r.field=await erosion.materialField({heightBuffer:r.weather,heightOffset:win.grid*win.grid,grid:win.grid,size,ox:win.ox,oy:win.oy,seaLevel:config.seaLevel,baseHeight:config.baseHeight,seed:material.seed,depositSpread:material.depositSpread,profile:{...config.material,mineral:material.mineral}});
    return r;
  }});
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
  const fields={...r.fields,h:r.fields.h.slice()},ox=Math.round(r.gridOrigin[0]/spacing),oy=Math.round(r.gridOrigin[1]/spacing),weather={};
  const crop=(source,channels=1) => {
    if (!source) return undefined;
    const out=new source.constructor(r.gridWidth*r.gridHeight*channels);
    for (let y=0;y<r.gridHeight;y++) { const from=((y+oy)*worldGrid+ox)*channels; out.set(source.subarray(from,from+r.gridWidth*channels),y*r.gridWidth*channels); }
    return out;
  };
  for (let y=0;y<r.gridHeight;y++) for (let x=0;x<r.gridWidth;x++) {
    const i=y*r.gridWidth+x,j=(y+oy)*worldGrid+x+ox,h=r.fields.h[i];
    if(refinementValid(refinedInvalidRect,x+ox,y+oy))fields.h[i]+=(refined[j]-refinedBase[j])*(1-smooth(0,10,Math.abs(h-refinedBase[j])))*(1-r.fields.r[i]);
  }
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
  sketch,loadSketch:(s,id)=>loadSketchFile(s,false,id),maskKeys:MASK_KEYS,maskChunks:() => regionalFields.maskChunks(),stats:regionalStats,revision:() => revision+mapRevision+weatherJob,
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
  const n=nodes[i];
  if (n && n.params && (HELP[n.kind]||n.kind==='landform')) {
    if (tool!=='move') { rememberTool(); tool='move'; }
    mapFeatures?.deactivate();
    const p=n.params;
    heightControlRange(p);stepControlRange(n.kind,p);
    const [lo,hi]=amountRange(n.kind); $('amount').min=String(lo); $('amount').max=String(hi);
    $('diameter').value=clamp(p.radius*2,40,800); $('amount').value=clamp(p.amount,lo,hi); $('roughness').value=clamp(Math.round(p.rough*100),0,100);
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
const materialKnobs=() => { const amount=Number($('material-weathering')?.value)/100; return amount>0?{depositSpread:Number($('deposit-spread').value)/100,seed:refinementSeed,mineral:renderer.variant.get('transition')==='mineral'}:null; };
// H6b: the Time pass on the fields' GPU buffers; see gpuFeedSource. Nothing comes back to the CPU here.
async function runFedWeather(job) {
  try {
    const {erosionOf}=await import('./sculpt-erosion.js'),erosion=await erosionOf(renderer);
    await regionalFields.gpuQuiet();   // the shape runs' own scratch (whole-map noise: peak 259 MB) is gone before the pass allocates its 120 B a cell
    const b=regionalFields.gpuBuffers();
    if (!b || job!==weatherJob) return;
    gpuPassBytes=grid*grid*120+Math.ceil(grid/8)**2*12;
    const request={planes:b.planes,masks:b.masks,rateMask:MASK_KEYS.indexOf('ovErosion'),grid,size,seaLevel:config.seaLevel,age:renderer.variantNumber('erosionAge',200),rain:renderer.variantNumber('erosionRain',1),talusAngle:renderer.variantNumber('talusAngle',40),
      envelope:renderer.variantNumber('erosionEnvelope',2),sand:renderer.variantNumber('sand',0),wetReach:renderer.variantNumber('wetReach',3),talusFull:renderer.variantNumber('talusFull',2.5),wearFull:renderer.variantNumber('wearFull',1.5),flowK:renderer.variantNumber('flowK',30)};
    request.drainage=drainagePlane();
    const result=await erosion.runGpu(request),material=materialKnobs();
    if (material && job===weatherJob && !stroke) result.field=await erosion.materialField({heightBuffer:result.weather,heightOffset:grid*grid,grid,size,seaLevel:config.seaLevel,baseHeight:config.baseHeight,seed:material.seed,depositSpread:material.depositSpread,profile:{...config.material,mineral:material.mineral}});
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

// Capture tools rebuild a map from strokes: [kind, [[x,y],...], options],
// each starting from the brush card's defaults for this world. options.card
// overrides card values (diameter, amount, roughness ... in card units); any
// other key is a stroke option.
const strokeCard=d => ({radius:d.diameter/2,amount:d.amount,rough:d.roughness/100,softness:d.softness/100,cracks:d.cracks/100,
  ...Object.fromEntries(SHAPE_FIELDS.map(([key,,,,,,,scale]) => [key,d[key]/scale])),...Object.fromEntries(SPUR_OUTLINE_KEYS.map(k => [k,worldDefault(k)])),curve:d.curve,along:d.along});
function scriptedScene(list,{ground=true}={}) {
  applySeedControl(); refinementSeed=seed;
  cancelWeather(); refined=refinedBase=null; dropGpuWeather(); clearRendererWeather(); 
  nodes=[]; selected=-1;
  if (ground) addGroundNode();
  list.forEach(([entry,points,options={}],i) => {
    const kind=strokeKind(entry),{card:override,...rest}=options,d={...toolDefaults(entry),...override},pts=points.map(([x,y]) => ({x,y}));
    const card={...strokeCard(d),seed:(seed+i*7919)>>>0};
    const probe={...card,...rest};
    const node={kind,points:pts,params:strokeParams(probe),seed:probe.seed};
    if(isRiver(node.params)){node.params.river={drawn:pts.map(p => ({...p}))};migrateRiverNode(node);}   // a scripted river is migrated as a drawn one is
    addNode(node);
  });
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
  const next=deserializeNodes(carry?carryNodes(s.nodes):s.nodes),column=copyColumn(s.column,defaultColumn);
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
async function loadSketchFile(s,commit=true,documentId=null) {
  if(!s || s.format!=='nanolathe-terrain-sculpt' || ![4,5,6].includes(s.version) || !Array.isArray(s.nodes) || s.nodes.some(n=>!n || n.kind==='raster'))throw new Error('Load a map stroke graph.');
  const biome=typeof s?.biome==='string'?s.biome:'';
  const mapChanged=(s?.map?.unitsX??0)!==(config.map?.unitsX??0) || (s?.map?.unitsY??0)!==(config.map?.unitsY??0) || (s?.map && s.seaLevel!==config.seaLevel);
  if (biome && (biome!==config.biomeId || mapChanged || (s.variant||'')!==(config.variant||''))) {
    let served=false,variant='';
    try {
      const response=await fetch('/sculpt-config.json?biome='+encodeURIComponent(biome));
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
    goToWorld(biome,null,{pendingSketch:token,variant,document:documentId,mapX:s.map?.unitsX??'',mapY:s.map?.unitsY??'',sea:s.map?s.seaLevel:''});
    return false;
  }
  loadSketch(s); if(commit)checkpoint(); status('Loaded the saved terrain.'); schedule(); queueWeather();return true;
}
const groundDefaults=() => ({amplitude:experiment.has('undulation')?Number(experiment.get('undulation')):10,wavelength:experiment.has('undulationScale')?Number(experiment.get('undulationScale')):200,coverage:experiment.has('undulationCover')?Number(experiment.get('undulationCover')):.45});
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
editorUI.onMode(entry=>{if(selected>=0&&nodes[selected]?.params&&strokeKind(entry)===entry){changeSelected(n=>{n.kind=entry;});}else document.querySelector(`[data-tool="${entry}"]`)?.click();});
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
$('tool-style').addEventListener('change',() => {
  const preset=$('tool-style').value;if(!Object.hasOwn(TOOL_PRESETS,preset))return;
  // A selected landform takes the world's version of the palette entry its section form belongs to.
  const n=nodes[selected],entry=n?.kind==='landform'?landformTool(n.params):n?.kind||tool;toolSettings[tool]=toolDefaults(entry,preset);showTool(toolSettings[tool],strokeKind(entry));
  if(selected>=0){editSelectedFromControls({curve:toolSettings[tool].curve,along:toolSettings[tool].along});checkpoint();queueWeather();}
  updateControls();schedule();persistLater();
});
for (const id of ['relief','transition-detail']) $(id).addEventListener('input',() => { markViewChanged(); updateControls(); schedule(); persistLater(); });
for (const id of ['mineral-ring','ring-spread','ring-variation']) $(id).addEventListener('input',() => { markViewChanged(); updateControls(); schedule(); persistLater(); });
for(const id of ['material-weathering','deposit-spread']) $(id).addEventListener('input',()=>{markViewChanged();updateControls();schedule();queueWeather();persistLater();});
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


// Surface knobs: each writes the page address and the renderer's variant,
// then the renderer re-reads its uniforms and re-bakes its fields.
const KNOBS = [
  ['Ground', [['groundTiles','Unique ground tiles',1,16,1,16],['groundContrast','Pattern contrast',0,2,.05,1],['undulation','Undulation height',0,16,.5,10],['undulationScale','Undulation size (px)',48,400,8,200],['undulationCover','Undulating share of land',0,1,.05,.45]]],
  ['Relief', [['reliefScale','Scale (px)',8,64,1,28],['reliefAmount','Strength',0,1.2,.05,.5],['reliefLumps','Lumps',0,1,.05,.7],
    ['reliefBranch','Branching',0,4,.1,2],['reliefWarp','Warp (px)',0,24,1,10],['reliefPatchy','Patchiness',0,1,.05,1],['reliefJitter','Rib irregularity',0,1,.05,.8],['gentleRelief','Gentle-slope relief',0,1,.05,.6],['plainRelief','Level-ground lumps',0,3,.05,1.2],['lumpRelief','Painted ground lumps (Paint brush)',0,8,.1,4],['reliefOctaves','Octaves',1,6,1,5],['worms','Wormy relief on slopes',0,1,.05,0]]],
  ['Light', [['flatShadow','Cast shadow on level ground',0,1,.05,0],['flatOcclusion','Occlusion on level ground',0,1,.05,.4],['lightCap','Highlight cap',1,1.6,.01,1.13],['shadeDepth','Directional shading kept',0,1,.05,1],['sunTilt','Light from the south (0: due west)',-1,1,.05,1],['ambient','Ambient (unlit share)',0,.8,.02,.42]]],
  ['Faces', [['hillLight','Hill cover brightness (Archipelago)',.6,1.6,.01,1],['ringFade','Mineral ring fade length (Archipelago)',0,2,.05,0],['faceFill','Fill light on shaded faces',0,.5,.02,0],['rockCrown','Bare rock to the crown',0,1,.05,0],['sandCrown','Painted sand to the crown (sand bars)',0,1,.05,0],['slopeTexture','Sampled slope texture',0,1,.05,.3],['faceEdge','Edge breakup',0,2,.05,.8],['gullyRock','Rock in gullies',0,2,.05,.5],['moss','Moss from ground',0,1,.05,0],['wetSwath','Moisture',0,1,.05,0],['lushness','Lushness',-1,1,.05,0],['crevice','Crevices',0,1,.05,0],['slopeMarks','Dark marks on slopes (Moon)',0,1,.05,0],['wrinkles','Joined wrinkles on slopes (Moon; terracettes on grass)',0,1,.05,0]]],
  ['Shine', [['shineStretch','Grain streak length (x its width)',1,8,.25,1],['shineWhite','Highlight whiteness (0 material hue, 1 white)',0,1,.05,.35]]],
  ['Shine: ground', [['shineGround','Gloss (highlight strength)',0,2,.05,0],['shineGroundSharp','Sharpness (lobe exponent)',2,200,2,24],['shineGroundRough','Roughness (grain slope)',0,2,.05,0],['shineGroundScale','Grain width (px)',1,24,.5,6]]],
  ['Shine: slope cover', [['shineSlope','Gloss (highlight strength)',0,2,.05,0],['shineSlopeSharp','Sharpness (lobe exponent)',2,200,2,24],['shineSlopeRough','Roughness (grain slope)',0,2,.05,0],['shineSlopeScale','Grain width (px)',1,24,.5,6]]],
  ['Shine: rock', [['shineRock','Gloss (highlight strength)',0,2,.05,0],['shineRockSharp','Sharpness (lobe exponent)',2,200,2,24],['shineRockRough','Roughness (grain slope)',0,2,.05,0],['shineRockScale','Grain width (px)',1,24,.5,6]]],
  ['Shine: sand', [['shineSand','Gloss (highlight strength)',0,2,.05,0],['shineSandSharp','Sharpness (lobe exponent)',2,200,2,24],['shineSandRough','Roughness (grain slope)',0,2,.05,0],['shineSandScale','Grain width (px)',1,24,.5,6]]],
  ['Shine: crystal', [['shineCrystal','Gloss (highlight strength)',0,2,.05,0],['shineCrystalSharp','Sharpness (lobe exponent)',2,200,2,24],['shineCrystalRough','Roughness (grain slope)',0,2,.05,0],['shineCrystalScale','Grain width (px)',1,24,.5,6]]],
  ['Loose stone', [['looseSupply','Supply',0,1,.05,0],['looseSize','Size (median, px)',2,24,1,6]]],
  ['Sand', [['sand','Weathering supply',0,2,.05,0],
    ['wind','Wind toward (deg)',0,360,5,20],['sandDust','Dusting tint',0,1,.05,.5],['sandGrass','Grass regrowing over sand',0,1,.05,.6],['sandLight','Weathered lightness',0,1,.05,.25],['sandGrain','Rock grain in sand',0,1,.05,.8],
    ['ripple','Ripple length (px)',0,16,1,7],['rippleHeight','Ripple height',0,3,.1,1.4]]],
  ['Cracks', [['crackSeverity','Frost (crack depth; above 1 the fine fractures fill in)',0,1.5,.05,.6],['crackSpacing','Block size (px)',16,96,2,40],
    ['crackMajor','Major cracks',0,1,.05,.8],['crackMinor','Minor cracks',0,1,.05,.75],['crackHairline','Hairline crazing',0,1,.05,.6],['crackBlocks','Facets (block relief)',0,1.5,.05,.6],
    ['crackWidth','Width (px)',.5,2.5,.1,1],['crackNetwork','Majors: rills to plates',0,1,.05,.35],
    ['crackDark','Floor darkness',0,1,.05,.75]]],
  ['Rock structure', [['rockOrder','Order (0 scattered, ink cracks; 1 beds, joints, lit relief cracks)',0,1,.05,0],['rockFrom','Beds and joints from slope (painted rock always)',.3,2,.05,.6],['bedSpacing','Bed thickness (px along the ground, or height units)',3,80,1,12],['bedHeight','Beds spaced by height (0 px along the ground)',0,1,.05,0],['bedVary','Bed thickness variation',0,1,.05,.5],
    ['bedDip','Bed tilt (height per px; 2 north: level rows)',-4,4,.05,0],['bedDipDir','Bed tilt toward (deg, 0 east, 90 south)',0,360,5,90],['bedLedge','Ledges (step strength; above 1 taller lips and notches)',0,2,.05,.5],
    ['grooveSpacing','Joint and gully spacing (px)',12,120,2,36],['grooveAngle','Joint and gully lean from north-south (deg)',-60,60,1,0],['grooveRun','Joint and gully length (px)',30,400,10,120]]],
  ['Contour bands', [['banding','Strength',0,1,.05,0],['bandSoftness','Riser share',.05,1,.05,.35],['bandWater','Rings in water color',0,1,.05,0],['sandBanding','Streaks on sand and ramps',0,1,.05,0],['sandBandSpacing','Streak height step',.3,4,.1,2]]],
  ['Strata', [['strata','Strength (painted beds)',0,1,.05,0],['strataContrast','Color strength',0,1,.05,.6],['strataGrain','Bed grain',0,1,.05,1]]],
  ['Water', [['beachWidth','Beach width (worlds with beaches)',0,2,.05,.6],['apron','Sand apron round raised rock (px)',0,120,2,0],['shallowDepth','Shallow until depth',0,60,1,24],['deepDepth','Deep from depth',10,100,1,60],['waterSoft','Color depth averaging (px)',0,64,2,32],['crispShore','Crisp waterline (shore to shallow)',0,1,.05,1],['deepEdge','Hard shallow-to-deep step (0 ramp)',0,1,1,0],['bedLit','Lit bed under shallow water (0 noise water)',0,1,.05,0],['bedTint','Bed tint strength',0,1,.05,.85],['bedBright','Tinted bed brightness',.5,1.5,.02,1],['bedContrast','Bed light carried through the tint',0,1.5,.05,1],['bedRelief','Bed lumps (lit relief under shallows)',0,3,.05,0],['shoreEdge','Coast rim and lip (Lava)',0,1,.05,0],['bankRock','Rock on low banks',0,1,.05,.25]]],
  ['Palette', [['paletteMix','Mix palette pairs (0 nearest, 1 pairs)',0,1,1,0],['dither','Dither (water)',0,4,.1,2],['landDither','Land dither share',0,1,.05,.25]]],
  // E8 (Painted Desert): the gray band at the foot of the raised ground (strata color 5); its heights are above the plain.
  ['Desert foot band', [['baseBand','Gray band strength',0,1,.05,0],['baseBandLow','Window from (height)',0,12,.5,4],['baseBandHigh','Window to (height)',1,16,.5,6.5],['baseBandWander','Window drift (height)',0,4,.25,1],['baseBandGaps','Share missing',0,.9,.05,.45]]],
  // G4 (Painted Desert): the pale cap kept as one sheet.
  ['Desert caps', [['desertCapFlat','Level cap kept cool (0 beds as before)',0,1,.05,0]]],
  // E9 (Green rock faces); every default is the earlier look.
  ['Rock face', [['rockMoss','Green kept in the rock art (1 all, 0 none)',0,1,.05,1],['rockDetail','Rock tile blotch contrast (1 as drawn, 0 flat)',0,1,.05,1],['faceRelief','Rock relief lit on walls that face the viewer (0: world-space look)',0,1,.05,1],['shineOutside','Rock glints kept outside painted rock',0,1,.05,1],
    ['bedPunch','Beds differ in strength',0,1,.05,0]]],
  ['Rock face: gullies and ribs', [['gullyDepth','Gully depth (height; 0 none)',0,16,.5,0],['gullyWidth','Gully width (px)',4,40,1,14],
    ['gullyShade','Gully floor shade (occlusion)',0,3,.05,0],['ribTilt','Rib tilt (height per px)',0,1,.02,0]]],
  // Card P10: the rock model's blocks (the rock type is the world's preset; Size and Age are its two rows).
  ['Rock face: blocks', [['rockScale','Block size (share of the rock type\'s)',.4,3,.05,1],['rockAge','Age (rounds edges, opens joints, wears chips)',0,1,.05,.5],['rockOpen','Open joints (joint depth and crevice darkness, share of the rock type\'s)',0,2,.05,1]]],
  // G2: rock faces follow the slope; every default is the earlier look.
  ['Rock face: follows the slope', [['cliffFollow','Beds on the contours, joints down the fall line (0 fixed screen directions)',0,1,1,0],['cliffReach','Fall line smoothing radius (px)',6,60,1,20],['cliffWide','Wide fall line radius, level ground under rock (px)',20,160,2,56],['cliffFlat','Slope under which structure fades into broken rock',0,.3,.005,.04],['cliffRise','Bed riser height (units; 0 the bed\'s own)',0,40,1,0],['cliffBed','Beds follow the smoothed ground (0 the grid\'s own bumps)',0,1,.05,.5],['cliffStagger','Joints offset from bed to bed (share of spacing)',0,.8,.05,0],['cliffDomain','Joint lattice patch size (px)',30,240,5,90]]],
  // E11: shallow water round 2 and Archipelago's fringe lines.
  ['Shallow water, round 2', [['stepSoftPx','Threshold edge softness (px)',1,40,1,1],['shelfWander','Shelf wander (depth units)',0,40,1,0],['bedFlat','Bed lit by its own relief only',0,1,.05,0],['bedDots','Dark dots in the bed (Red)',0,1,.02,0],['bedDotCell','Dot spacing (px)',6,40,1,14],['crackedStep','Cracked-bed step depth (Red; 0: the world\'s)',0,60,1,0]]],
  // G1: shallow water round 3.
  ['Shallow water, round 3', [['shoalBump','Lit bumps in the bed (slope)',0,6,.1,0],['shoalBumpPx','Bump size (px)',2,16,.5,6],['shoalGrain','Ground grain through the tint (Red)',0,1,.05,0],['shoalRag','Shallow-to-deep notches (px)',0,16,.5,0],['shoalStairs','Hard waterline stairs (px)',0,6,.1,0],['shoalShoreSoft','Default waterline blur (px; Archipelago)',0,12,.5,0]]],
  ['Fringe lines (Archipelago)', [['ringContrast','Fringe contour lines: contrast',0,1,.05,0],['ringCount','Fringe contour lines: count',1,30,1,7],['ringSize','Fringe contour lines: reach',.1,2,.05,1]]],
  // G3
  ['Fringe copies (Archipelago)', [['ringShift','Offset between copies (px; 0: concentric lines)',0,30,.5,0],['ringShiftDir','Drift direction (deg clockwise from east)',0,360,5,315],['ringScatter','Direction wander (share of a half turn)',0,1,.05,.5],['ringWobble','Outline waver (px)',0,10,.5,3],['ringLobe','Lobe size (px)',8,60,1,22],['ringFill','Pale tint where copies overlap',0,1,.05,0],['ringPatch','Reach varies along the outline',0,1,.05,0],['ringPatchSize','Reach variation size (px)',30,400,5,120],['ringTone','Retail rose, paler outward',0,1,.05,0]]],
  // E10 (Lava)
  ['Lava hill rock', [['lavaCrust','Crust: pillows, chips and creases on hills',0,1,.05,0],['lavaPillow','Pillow size (px)',16,80,1,34],['lavaChip','Chip size (px)',3,12,.5,5.5],['lavaVeins','Veins hanging down the slope',0,1,.05,0],['lavaCalm','Fall-line relief replaced by the crust',0,1,.05,.6],['lavaDusk','Dusk on rock turned from the sun',0,2,.05,0]]],
  ['Lava banks', [['layerCrease','Dark crease at each step foot, any facing',0,1,.05,0],['shineSlopeGate','Shine only on slopes above (0: everywhere)',0,1.5,.05,0]]],
  // E6
  ['Shine: gate and headroom', [['shineGate','Roughness only on raised ground and slopes',0,1,.05,0],['shineHeadroom','Dim the body between glints (near-white ice)',0,1,.05,0]]],
  ['Pockmarks (Moon)', [['pockmark','Dark pits on raised ground and slopes',0,1,.05,0],['pockSize','Pit spacing (px)',3,12,.5,5]]],
  // G8 (Moon)
  ['Moon surface', [['moonCups','Lit cups on shaded steep faces',0,1,.05,0],['moonCupSize','Cup spacing (px)',3,12,.5,5.5],['moonCupDepth','Cup depth (wall steepness)',.4,3,.1,1.4],['moonRibs','Strokes down steep faces',0,1,.05,0],['moonRibDepth','Stroke steepness',.2,3,.1,1],['moonRibDark','Darker where turned from the sun',0,.9,.05,0],['moonFolds','Folds: thin dark lines that follow the form',0,1,.05,0],['moonFoldSpacing','Fold spacing (height units)',.3,3,.1,.9]]],
  ['Ice mountains', [['iceSlate','Monotone slate faces from the first slope',0,1,.05,0],['mineralDetail','Rock art contrast',0,2,.05,1],['iceCrystal','Crystal mountains: straight strokes on the faces',0,1,.05,0],['iceCrest','Crystal mountains: share of the raised ground under snow lumps',0,1,.05,0]]],
  // G6
  ['Ice blocks and mesas', [['iceSoft','Rounded light: raised ice lit by its blurred height',0,1,.05,0],['iceSnow','Snow on the flat tops of raised ice',0,1,.05,0],['iceFall','Smooth fibres down the faces',0,1,.05,0],['iceApron','Hatched drifts past the foot',0,1,.05,0]]],
  ['Ice frost lines', [['iceFrost','Fine hairlines in the frost band',0,1,.05,0]]],
  ['Ice frost band', [['frostGaps','Melt pockets: share of cells at the coast',0,.6,.01,.17],['frostGapReach','Melt pockets: reach inland (share of the band)',.2,1.2,.05,.65],['frostGapSize','Melt pockets: size (px)',3,24,1,11],['frostGapDepth','Melt pockets: depth below the sea',.5,6,.1,3]]],
];
// Worlds. A world is a biome's materials (prepared per biome by the server)
// plus the map-wide settings and base colors chosen for it. Built-in worlds
// can be adjusted; New world copies the current one under a new name. Kept in
// this browser (localStorage) and exportable as JSON.
const WORLD_STORE='nanolathe-map-editor-worlds';
// Card P12b: the light's two colors ride with the world's colors; white (off) is the grey light. Help for each row is shown under it.
const LIGHT_COLOR_HELP={sun:'The direct light and the glints it mirrors. A warm sun lights slopes that face it.',sky:'The ambient light that fills the shade. A cool sky keeps shaded ground and the lee of hills blue.'};
const COLOR_KEYS=[['ground','Ground'],['slope','Slope cover'],['rock','Rock'],['sand','Sand'],['beach','Beach'],['shallow','Shallow water'],['deep','Deep water'],['crystal','Crystal'],['sun','Sun color'],['sky','Sky color'],['strata1','Strata 1'],['strata2','Strata 2'],['strata3','Strata 3'],['strata4','Strata 4'],['strata5','Strata 5']];
let worlds={},worldId=null;
function loadWorlds() { try { worlds=JSON.parse(localStorage.getItem(WORLD_STORE)||'{}')||{}; } catch (_) { worlds={}; } }
function saveWorlds() { try { localStorage.setItem(WORLD_STORE,JSON.stringify(worlds)); } catch (_) {} }
// A variant's colors (card C5) stay in config.colors; the world keeps only its base ones, so choosing a variant never writes into the world's own store.
function activeWorld() { return worlds[worldId] ??= {name:config.biome,base:config.biomeId,colors:{...(config.baseColors||config.colors||{})},knobs:{}}; }
const hexColor=c => '#'+c.map(v => Math.round(clamp(v,0,1)*255).toString(16).padStart(2,'0')).join('');
const rgbColor=h => [1,3,5].map(i => parseInt(h.slice(i,i+2),16)/255);
// A world's colors: the server's defaults for its base world, then the
// world's own choices; null means explicitly off (the texture's own color).
function mergedColors() {
  const out={...(config.colors||{}),...(activeWorld().colors||{})};
  // ?sunColor=ffd9a8&skyColor=8fb0ff try the light's colors on a page without changing the world (renders, review sheets).
  for (const key of ['sun','sky']) { const q=experiment.get(key+'Color'); if (q && /^#?[0-9a-f]{6}$/i.test(q)) out[key]=q.startsWith('#')?q:'#'+q; }
  return out;
}
function worldColors() { const out={}; for (const [k,v] of Object.entries(mergedColors())) if (typeof v==='string' && /^#[0-9a-f]{6}$/i.test(v)) out[k]=rgbColor(v); columnOverride?.colors?.forEach((c,i)=>{out['strata'+(i+1)]=c.map(v=>v/255);});return out; }
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
function commitColumn(){if(!columnEditing)return;columnEditing=false;checkpoint();queueWeather();mapCanvas.saveDocument().catch(()=>{});}
function defaultColor(key) {
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
  // Staying in the same world keeps its variant.
  if (base===config.biomeId && config.variant && !(extra && 'variant' in extra)) url.searchParams.set('variant',config.variant);
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
  variantSelect.onchange=() => goToWorld(config.biomeId,worldId===config.biomeId?null:worldId,{variant:variantSelect.value});
  const rows=$('world-colors'); rows.replaceChildren();
  for (const [key,label] of COLOR_KEYS) {
    if (key==='beach' && !config.layers.includes('beach')) continue;
    if (key.startsWith('strata') && (config.column?.colors || !(Number(experiment.get('strata'))>0))) continue;
    const row=document.createElement('div'); row.className='color-row';
    const set=mergedColors()[key];
    row.innerHTML=`<span>${label}</span><input type="checkbox" aria-label="Use a base color for ${label}"${set?' checked':''}><input type="color" aria-label="${label} base color" value="${set||hexColor(defaultColor(key))}">`;
    const [box,pick]=row.querySelectorAll('input');
    const apply=() => { if (box.checked) world.colors[key]=pick.value; else if (config.colors?.[key]) world.colors[key]=null; else delete world.colors[key]; saveWorlds(); renderer.setColors(worldColors()); syncWorldControls(); updateControls(); markViewChanged(); schedule(); };
    box.addEventListener('change',apply); pick.addEventListener('input',() => { box.checked=true; apply(); });
    rows.append(row);
    if (LIGHT_COLOR_HELP[key]) { const help=document.createElement('p'); help.className='small'; help.textContent=LIGHT_COLOR_HELP[key]; rows.append(help); }
  }
  // Ground pattern: this world's own, or another world's, recolored by
  // the Ground base color above.
  const patterns=config.groundPatterns||{},patternRow=document.createElement('div'); patternRow.className='control';
  patternRow.innerHTML=`<label for="ground-pattern">Ground pattern</label><select id="ground-pattern" style="width:100%"><option value="">This world's own</option>${Object.entries(patterns).filter(([id]) => id!==config.biomeId).map(([id,p]) => `<option value="${id}">${p.name}</option>`).join('')}</select><p class="small">Another world's ground grain, moved to this world's Ground color. Contrast is under Ground below.</p>`;
  rows.append(patternRow);
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
    worlds[id]={name,base:config.biomeId,colors:{...world.colors},knobs}; saveWorlds(); goToWorld(config.biomeId,id);
  };
  $('world-export').onclick=() => download(new Blob([JSON.stringify({format:'nanolathe-map-world',version:1,world:{...world,knobs:{...world.knobs}}},null,1)],{type:'application/json'}),(world.name||'world').replace(/[^\w-]+/g,'_')+'.world.json');
  $('world-import').onclick=() => $('world-file').click();
  $('world-file').onchange=async () => {
    try {
      const data=JSON.parse(await $('world-file').files[0].text()),w=data?.world;
      if (data?.format!=='nanolathe-map-world' || !w || typeof w.name!=='string' || !(w.base in (config.biomes||{}))) throw new Error('Not a world file for a world this server has.');
      const id=w.name.toLowerCase().replace(/[^a-z0-9]+/g,'-').slice(0,24)+'-'+Math.random().toString(36).slice(2,6);
      worlds[id]={name:w.name,base:w.base,colors:Object.fromEntries(Object.entries(w.colors||{}).filter(([,v]) => v===null || /^#[0-9a-f]{6}$/i.test(v))),knobs:Object.fromEntries(Object.entries(w.knobs||{}).map(([k,v]) => [k,String(v)]))};
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
  const group = (title, open = false) => { const d = document.createElement('details'); d.className = 'knobs-group'; d.open = open; const t = document.createElement('summary'); t.textContent = title; d.append(t); root.append(d); return d; };
  const render = group('Rendering',true);$('rendering-host').append(render);
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
    const box=groups.get(name)||group(name);groups.set(name,box);box.dataset.group=name;
    if(title==='Palette')$('rendering-host').append(box);
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
      const wrap = document.createElement('div'); wrap.className = 'control';
      wrap.dataset.knob=key;
      const id = 'knob-' + key, current = params.has(key) ? Number(params.get(key)) : value;
      wrap.innerHTML = `<label for="${id}">${label} <output>${current}</output></label><input id="${id}" type="range" min="${min}" max="${max}" step="${step}" value="${current}">`;
      let input = wrap.querySelector('input'); const out = wrap.querySelector('output');
      if(WORLD_CHOICES[key]){const select=document.createElement('select');select.id=id;select.replaceChildren(...WORLD_CHOICES[key].map(([value,label])=>new Option(label,String(value))));select.value=String(current);input.replaceWith(select);input=select;out.hidden=true;}
      input.addEventListener('input', () => { out.textContent = input.value; setKnob(key, input.value); });
      box.append(wrap);
    }
  }
  syncWorldControls=mountWorldControlIndex(root,worldPanelValues);
}
// A shape's own water choices, which turn the hard step, the ramp and the lit bed on inside its footprint whatever the world says (engine-frag.wgsl's `pick`).
function strokeWaterPicks() {
  const water=nodes.filter(n=>n.kind==='landform'),picked=(key,...choices)=>water.some(n=>choices.includes(Math.round(n.params?.[key]||0)))?1:0;
  return {deepEdge:picked('waterDeep',1),fadedEdge:picked('waterDeep',2),bedLit:picked('waterBed',1,3),crackedBed:picked('waterBed',3)};
}
// A Shallow water or Deep water base color picked in the Colors panel: the water is then two flat tones, whatever the world's own (engine-frag.wgsl skips the lit bed and the third colour).
function waterColored() { const c=worldColors(); return Boolean(c.shallow||c.deep); }
// How many tones the world's water has: 1 where shallow and deep are one colour, 3 where a third colour follows the depth, else 2; a picked base color makes it 2.
function waterTones() {
  const w=config.water||{};
  if(waterColored())return 2;
  return w.midRGB&&config.material?.midDepth?3:w.shallow===w.deep&&String(w.shallowRGB)===String(w.deepRGB)?1:2;
}
// engine-frag.wgsl's sediment transition: at full Material weathering its color (built from the ground, before the slope cover is mixed in) replaces the slope cover's outright.
function slopeReplaced() { const own=renderer.variant; return Boolean(renderer.transitionBody&&config.material?.groundFringe===true&&weatherOn()&&own.get('deposits')!=='off'&&own.get('transition')==='mineral'&&own.get('margins')!=='slope'&&Number($('material-weathering').value)>=100); }
// What worldControlRequirement may read: the renderer's settings, a stroke's water choices counted as the switch they turn on, and the facts of the world's material that no slider sets.
function worldPanelValues() {
  const layers=config.layers||[],own=Object.fromEntries(renderer.variant),picks=strokeWaterPicks();
  return {...own,deepEdge:Math.max(Number(own.deepEdge)||0,picks.deepEdge),bedLit:Math.max(Number(own.bedLit)||0,picks.bedLit),rampWater:Number(own.deepEdge)>0?picks.fadedEdge:1,crackedBed:picks.crackedBed,waterTones:waterTones(),waterColored:waterColored()?1:0,slopeReplaced:slopeReplaced()?1:0,column:config.column?.sections?1:0,capBed:columnHasCapBed(config.column,config.variant)?1:0,ringLayer:layers.includes('ring')?1:0,beachLayer:layers.includes('beach')?1:0,groundTiled:renderer.groundTiled?1:0,slopeSand:config.material?.slopeSand?1:0};
}
function setKnob(key, value) {
  const url = new URL(location.href); url.searchParams.set(key, value); window.history.replaceState(null, '', url);
  experiment.set(key, value);
  if (config) { activeWorld().knobs[key] = String(value); saveWorlds(); if (key==='strata') buildWorldPanel(); }
  // Textures are chosen when the renderer starts, so this switch reloads.
  if (key === 'ground' || key === 'groundPattern') { location.reload(); return; }
  renderer.variant.set(key, value); renderer.applyKnobs(); syncWorldControls(); markViewChanged(); schedule();
  if (key==='undulation' || key==='undulationScale' || key==='undulationCover') {
    const i=nodes.findIndex(n => n.kind==='ground');
    if (i>=0) { nodes[i][{undulation:'amplitude',undulationScale:'wavelength',undulationCover:'coverage'}[key]]=Number(value); cancelWeather(); evaluate(i); checkpoint(); queueWeather(); }
    else if (key==='undulation' && Number(value)>0) { nodes.unshift({kind:'ground',amplitude:Number(value),wavelength:160,seed:seed^0x9e37}); cancelWeather(); evaluate(0); checkpoint(); queueWeather(); }
    return;
  }
  if (['frostGaps','frostGapReach','frostGapSize','frostGapDepth','talusAngle'].includes(key)) { cancelWeather();evaluate(0);queueWeather();return; }
  // Deposit supply changes the generated deposit field.
  if (['sand'].includes(key)) { cancelWeather(); queueWeather(); }
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
  if (pending) { try { loadSketch(pending); checkpoint(); status('Loaded the saved map.'); } catch (err) { error('The handed-over terrain could not be loaded: '+err.message); } }
  $('levels').textContent=`Dry base ${config.baseHeight} · sea ${config.seaLevel} · heights ${MIN_HEIGHT}…${MAX_HEIGHT}`;
  updateControls(); resize(); schedule(); queueWeather();
  $('one').click();   // every page load starts at 1x, centered on the map
}
async function boot() {
  try {
    const response=await fetch('/sculpt-config.json?'+new URLSearchParams([...(experiment.has('biome')?[['biome',experiment.get('biome')]]:[]),...(experiment.get('variant')?[['variant',experiment.get('variant')]]:[])])); if (!response.ok) throw new Error('Could not load the sculpt configuration.'); config=await response.json();
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
      const response=await fetch('/map-catalog.json'),data=await response.json(); if (!response.ok) throw new Error(data.error||'Could not read map defaults from the installed content.');
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
    for (const [key,value] of Object.entries(config.defaults || {})) if (!experiment.has(key)) experiment.set(key,value);
    buildShapeOptions();
    for (const kind of Object.keys(HELP)) toolSettings[kind]=toolDefaults(kind);
    showTool(toolSettings[tool]);
    $('relief').value=Math.round((config.material?.surfaceRelief??1)*100);
    $('material-weathering').value=Math.round((config.material?.materialWeathering??0)*100);
    $('deposit-spread').value=Math.round((config.material?.depositSpread??.65)*100);
    $('transition-detail').value=Math.round((config.material?.transitionDetail??.65)*100);
    $('transition-detail-control').hidden=!config.layers.includes('body');
    $('ring-controls').hidden=!config.layers.includes('ring');
    $('mineral-ring').value=Math.round((config.material?.ringAmount??0)*100);
    $('ring-spread').value=Math.round((config.material?.ringSpread??.65)*100);
    $('ring-variation').value=Math.round((config.material?.ringVariation??.7)*100);
    // The address may set the three ring sliders (a world's own fringe settings, 0..1).
    for (const [key,id] of [['ringAmount','mineral-ring'],['ringSpread','ring-spread'],['ringVariation','ring-variation']]) if (experiment.has(key)) $(id).value=Math.round(Number(experiment.get(key))*100);
    await bootMap();
  } catch (err) { error(err.message); status('The experimental renderer could not start.'); }
}
// Read-only hook for capture tools: the displayed (refined) heights.
// bakeMs and drawMs resolve to milliseconds from submit to GPU completion;
// bakeGpuMs and drawMs's gpuMs are the pass's own GPU time (timestamp queries).
function replayDetail() { flushEval(); return regionalFields.replayDetail(); }
// Repeat check (repro/shapecheck.mjs): two GPU evaluations of this page's scene give identical planes.
async function shapeCompare() {
  const copy=f => ({h:f.h.slice(),p:f.p.slice(),r:f.r.slice(),c:f.c.slice(),v:f.v.slice(),x:f.x.slice(),masks:MASK_KEYS.map((k,j) => (f.masks?f.masks[j]:f[k]).slice())});
  const idle=async () => { for (let i=0;i<4000 && regionalFields.pending?.();i++) await new Promise(r => setTimeout(r,10)); };
  const all={x0:0,y0:0,x1:worldGrid-1,y1:worldGrid-1},grab=r => ({h:r.fields.h,p:r.fields.p,r:r.fields.r,c:r.fields.c,v:r.fields.v,x:r.fields.x,masks:MASK_KEYS.map(k => r.fields[k])});
  await idle(); const a=copy(grab(regionalFields.readCells(all)));
  regionalFields.changed(); await idle(); const b=copy(grab(regionalFields.readCells(all)));
  return {grid:worldGrid,repeat:comparePlanes(a,b,worldGrid,MASK_KEYS)};
}
// H12b: the regional check on the map. The map's paged fields (gpuPages=force) read each quadrant of the map; the same
// shape engine runs the same window directly; every authored plane must match exactly. Quadrant windows, so each window
// is a regional run on its own.
async function gpuRegionalCheck() {
  if (!regionalFields?.readRect) throw new Error('the regional check needs the paged fields: open the map with gpuPages=force');
  await regionalFields.ready?.();
  const G=worldGrid,engine=await createShapeEngine({device:renderer.device,grid:G,spacing,baseHeight:config.baseHeight,sea:config.seaLevel,minH:MIN_HEIGHT,maxH:MAX_HEIGHT}),ctx=shapeContext();
  const planes=Object.fromEntries(FIELD_KEYS.map(k => [k,{mismatches:0,maxDifference:0,firstMismatch:null}]));
  let mismatches=0;
  try {
    const middle=Math.floor(G/2);
    for (const [y0,y1] of [[0,middle-1],[middle,G-1]]) for (const [x0,x1] of [[0,middle-1],[middle,G-1]]) {
      const rect={x0,y0,x1,y1},W=x1-x0+1,out=await engine.run(nodes.slice(),ctx,rect),rp=await regionalFields.readRect(rect,{weather:false});
      const expected={h:out.floats[0],p:out.floats[1],r:out.floats[2],c:out.floats[3],v:out.floats[4],x:out.floats[5]};
      for (const key of FIELD_KEYS) {
        const j=MASK_KEYS.indexOf(key),want=j>=0?out.masks[j]:expected[key],got=rp.fields[key],p=planes[key];
        for (let i=0;i<W*W;i++) {
          const a=want[i],b=got[i]; if (a===b && Number.isFinite(b)) continue;
          p.mismatches++; mismatches++; p.maxDifference=Math.max(p.maxDifference,Math.abs(b-a)||Infinity); p.firstMismatch??={x:x0+i%W,y:y0+Math.floor(i/W),engine:a,paged:b};
        }
      }
    }
    // P21: the drainage plane from the paged fields' coarse lattice against the one from the whole-map engine's heights: the same (area, receiver) in every cell.
    {
      const {computeDrainage,latticeWidth,DRAIN_STEP}=await import('./sculpt-drainage.js');
      if (!pagedCoarseStarted) { pagedCoarseStarted=true; regionalFields.startCoarse().catch(() => {}); }
      await regionalFields.coarseSettled();
      const c=regionalFields.coarseLattice(),whole=(await engine.run(nodes.slice(),ctx,null)).floats[0],w=latticeWidth(G),heights=new Float32Array(w*w);
      for (let j=0;j<w;j++) for (let i=0;i<w;i++) heights[j*w+i]=whole[j*DRAIN_STEP*G+i*DRAIN_STEP];
      const a=await computeDrainage(renderer.device,{heights,width:w,sea:config.seaLevel}),b=await computeDrainage(renderer.device,{heights:c.heights,width:c.width,sea:config.seaLevel});
      const read=async plane => new Uint32Array(await readBuffer(renderer.device,plane.buffer,0,plane.bytes));
      const [pa,pb]=[await read(a),await read(b)],p={mismatches:0,maxDifference:0,firstMismatch:null};
      if (c.width!==w) throw new Error('the coarse lattice is not the drainage lattice');
      for (let i=0;i<pa.length;i++) if (pa[i]!==pb[i]) { p.mismatches++; mismatches++; p.maxDifference=Math.max(p.maxDifference,Math.abs(pa[i]-pb[i])); p.firstMismatch??={cell:i>>1,what:i&1?'receiver':'area',engine:pa[i],paged:pb[i]}; }
      planes.drainage=p; a.retire(); b.retire();
    }
    return {grid:G,planes,mismatches,gpuShape:true};
  } finally { engine.destroy(); }
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
  const p={age:renderer.variantNumber('erosionAge',200),rain:renderer.variantNumber('erosionRain',1),talusAngle:renderer.variantNumber('talusAngle',40),envelope:renderer.variantNumber('erosionEnvelope',2),sand:renderer.variantNumber('sand',0),wetReach:renderer.variantNumber('wetReach',3),talusFull:renderer.variantNumber('talusFull',2.5),wearFull:renderer.variantNumber('wearFull',1.5),flowK:renderer.variantNumber('flowK',30)};
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
