import {changedWeatherTiles,invalidateRefinement,refinementValid} from './sculpt-change-map.js';
import {configureMap,mountMapCanvas} from './sculpt-map.js';
import {mountEditorUI,groupToolControls,mountWorldControlIndex,mountColumnPanel} from './sculpt-ui.js';
import {copyColumn, columnHasCapBed} from './sculpt-column.js';
import {controlLabel,shapeControlAvailable,PARKED_WORLD_CONTROLS,WORLD_CHOICES,WORLD_GROUP_NAMES} from './sculpt-control-schema.js';
import {sectionPreview,SECTION_KINDS,FORM_NAMES,FACING_CHOICES,defaultForm,strokeKnots,thinKnots,leanRatio,isShouldered} from './sculpt-shape-presets.js';
import {createGpuFields,createPagedFields,createShapeEngine,comparePlanes,readBuffer,setFailureHandler,LAYER_MEANDER} from './sculpt-gpu-fields.js';

import {shapePaths,clonePaths,simplifyPath,validatePaths,appendPath,extendPoint,insertPoint,removePoint,removePath} from './sculpt-paths.js';
import {selectionTransform} from './sculpt-selection.js';
const editorUI=mountEditorUI();
let syncWorldControls=()=>{},panelPicks='',syncToolGroups=()=>{},pathEditing=false,pathPoint=-1,pathIndex=0,pathAdding=false,drawMode='new';

// Offline authoring policy. These brushes are new geometry, not retail rules.
const $ = id => document.getElementById(id);
const canvas = $('terrain'), overlay = $('overlay');
const experiment = new URLSearchParams(location.search);
let LOCAL_KEY = 'nanolathe-terrain-sculpt-v3' + (experiment.has('scratch')?'-'+experiment.get('scratch'):'');
let MIN_HEIGHT = -90, MAX_HEIGHT = 300;
const HELP = {
  plateau:'Paint a level crest above the height where this stroke begins. New strokes can build on top.',
  hill:'Paint a rounded ridge along any path. A later stroke adds more height to the existing ground.',
  mountain:'Paint a narrower, peaked ridge. New strokes add to the existing height, without a flat summit.',
  ramp:'Draw between terrain levels. A smooth center joins the endpoint heights with rounded approaches; shoulder roughness stays outside the route. Longer paths make gentler grades.',
  deep:'Guide a deep channel. Coast freedom varies the banks; Automatic shallows controls extra shelves. The center stays deep until you paint over it.',
  shallow:'Set the bed 7 below sea level. Paint through deep water to make a shallow passage, or through land to make shallows.',
  smooth:'Blend the starting surface toward its local average. Repeat a new stroke for more smoothing.',
  lower:'Lower the starting surface by the chosen amount. New strokes can dig farther.',
  offset:'Paint an area to raise or lower by the chosen height. Its edge is natural and its softness sets cliff or slope; the ground keeps its own relief.',
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
const TOOL_PRESETS={
  green:{crater:{roughness:60},plateau:{roughness:40},hill:{roughness:35},mountain:{roughness:45},ramp:{roughness:18},deep:{roughness:45},shallow:{roughness:18}},
  red:{crater:{roughness:65,softness:40},plateau:{roughness:50,softness:35},hill:{roughness:50,softness:40},mountain:{roughness:55,softness:30},ramp:{roughness:22},deep:{roughness:55,bankWidth:38,shelves:45},shallow:{roughness:25}},
  desert:{crater:{roughness:55,softness:55,cracks:10},plateau:{roughness:30,softness:100,diameter:560,amount:67,cracks:10,facePx:210,curve:{form:'mesa'}},hill:{roughness:45,softness:62,cracks:10},mountain:{roughness:50,softness:50,cracks:10},offset:{cracks:10},ramp:{roughness:18},deep:{roughness:50},shallow:{roughness:20}},
  moon:{crater:{roughness:65,softness:45},plateau:{roughness:45,softness:45},hill:{roughness:40,softness:55},mountain:{roughness:50,softness:40},ramp:{roughness:18},deep:{roughness:50},shallow:{roughness:20}},
  // Lava banks rise ~22-24 units over 40-60 px, steep at the lava then
  // flattening (retail coasts, measure/lava_*): wide, concave dry banks.
  crystal:{crystal:{amount:140,diameter:480,roughness:40}},
  ice:{crystal:{amount:155,diameter:120,roughness:20}},
  lava:{deep:{roughness:45,bankWidth:80,beachFlatness:30},shallow:{roughness:30,bankWidth:80,beachFlatness:30}},
  zhon:{crater:{roughness:55,softness:60},plateau:{roughness:45,softness:55},hill:{roughness:30,softness:35},mountain:{roughness:45,softness:55},ramp:{roughness:18},deep:{roughness:60,bankWidth:70,beachFlatness:75,shelves:70},shallow:{roughness:30,bankWidth:70,beachFlatness:75}},
  archipelago:{crater:{roughness:60,softness:65},plateau:{roughness:45,softness:72},hill:{roughness:35,softness:78},mountain:{roughness:45,softness:65},ramp:{roughness:18},deep:{roughness:60,bankWidth:78,beachFlatness:80,shelves:90},shallow:{roughness:30,bankWidth:75,beachFlatness:80}}
};
const TOOL_FIELDS={cracks:['cracks',0,100],diameter:['diameter',40,800],amount:['amount',-80,160],roughness:['roughness',0,100],shelves:['shelves',0,100],bankWidth:['bank-width',0,100],beachFlatness:['beach-flatness',0,100],softness:['softness',0,100]};
// Shape options: per-shape settings, shown for the tools they apply to and
// kept in each shape, so a selected shape can be changed like a new stroke.
// Each starts at the world's value (sculpt.py KNOB_DEFAULTS / WORLD_KNOBS).
// Cross-section (card C1): the kinds that take the parametric profile, and the
// options that describe it. Wired like every shape option: SHAPE_FIELDS, the
// card scriptedScene builds, strokeParams and KNOB_DEFAULTS (sculpt.py).
// Card E8: the kinds whose feet may be ragged and bumpy (baseVary, baseBump).
const BASE_KINDS=['plateau','offset','hill','mountain'];
// Line features (card C4): spurs, crest variation and crater rim sectors. All
// default off; spurs and crest options turn a hill or mountain into a ridge
// built from tapering pieces (ridgePieces), rim options reshape a crater's rim.
const RIDGE_KEYS=['spurCount','spurLength','spurSpread','spurWidth','spurTaper','spurHeight','spurForks','spurBulb','crestJag','crestVary','crestTaper','rimHeight','rimSectors','rimUnequal','rimGaps','rimGapWidth'];
const ridgeOn=(kind,o) => (kind==='hill' || kind==='mountain') && (Math.round(o.spurCount)>=1 || o.crestJag>0 || o.crestVary>0 || o.crestTaper>0);
// Placed fissures (card C4 stage 2): the Fissure tool and its options. Depth is
// the stroke's own amount; the rest are shape options kept in the shape.
const FISSURE_KEYS=['fissureWidth','fissureJag','fissureBranches','fissureBranchLen','fissureBranchSpread','fissureTaper','fissureNetwork','fissureCell','fissureCrack','fissureDark'];
const SECTION_KEYS=['facePx','terraces','ledge','terraceJitter'];
// Painted masks (card C5): nine signed-byte planes per cell, where 0 changes
// nothing: rock, snow or ice, wet ground and moss (0..127 of full), scatter
// density, and four local style settings (stage 2: relief strength, cracks,
// banding and face rock share, each -127..127 about the world's own value).
// 'paint' is the brush; the landforms below can also paint inside their own
// footprint (maskChannel, and styleRelief .. styleFace).
// Card E1 adds five more: the water choices of a deep or shallow stroke (shore
// edge, shallow-to-deep edge, bed; +127 hard / lit bed, -127 faded / noise
// water), painted ground lumps (+127 more, -127 fewer) and the cracked-bed flag.
// Planes 14-24 are unused placeholders (the flow bake's planes 20-24 went with it); the layout stays as the shaders read it.
const MASK_KEYS=['mr','ms','mw','mm','md','ml','mc','mb','mf','mx','my','mz','mg','mk','ovErosion','ovDeposits','ovVegetation','ovExposure','free18','free19','fu','fv','s1','s2','s3'];
const WATER_KEYS=['waterShore','waterDeep','waterBed'];
const MASK_SHAPES=['plateau','offset','hill','mountain','crater','deep','shallow'];
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
  ['faceVariation','face-variation','Face width variation',['plateau','offset','erase',...SECTION_KINDS.slice(2)],0,150,5,100,'How much the edge face widens and narrows along the outline (on a carried cross-section, every width of it).'],
  ['lean','lean','Lean (back length over face; 0: the shape\'s own)',SECTION_KINDS,0,400,5,100,'How much longer the slope toward the lean side runs than the one away from it (100: the same both sides). 0 keeps what the shape does on its own: a hill\'s long back, a plateau\'s wider faces toward north, no lean on the rest.'],
  ['outlineVar','outline-var','Outline wander',SECTION_KINDS,0,200,5,100,'How far the outline strays from the line you drew, as a share of what roughness gives this kind (100: as it is; 0: a clean outline).'],
  ['widthVar','width-var','Width variation',['plateau','offset','deep'],0,200,5,100,'How much the shape widens and narrows along its outline, as a share of what roughness gives it (100: as it is; 0: an even width).'],
  ['heightVar','height-var','Height lumps',['hill','mountain'],0,200,5,100,'How much the height wanders along the shape, as a share of what roughness gives it (100: as it is; 0: an even crest).'],
  ['facing','facing','Lean toward',SECTION_KINDS,0,10,1,1,'The side the shape leans toward, the long gentle slope: a map direction or a side of the line you draw (a ridge\'s steep face is the opposite side).',FACING_CHOICES],
  ['fingers','fingers','Finger coasts',['deep','shallow'],0,150,5,100,'Interlocking land fingers and inlets along the shore.'],
  ['bankPx','bank-px','Dry bank (px)',['deep','shallow'],0,160,2,1,'Width of the dry bank from the waterline to the level ground, whatever the shape\'s size (0: a share of the shape, set by Bank width).'],
  // Card E4 (Lava): fingers and terraces cut into the joined coast once the stroke is swept (stampCoastShore).
  ['shoreLayers','shore-layers','Shore layers',['deep','shallow'],0,12,1,1,'Cut the bank into this many flat terraces stepping down to the water, as real heights the sun lights (a lit top, a shaded riser), counted from the waterline this stroke leaves. 0: the plain bank.'],
  ['layerPx','layer-px','Layer width (px)',['deep','shallow'],4,60,1,1,'Width of one layer, ledge and riser together: Shore layers times this is how far the terraces reach inland.'],
  ['layerRiser','layer-riser','Riser height (units; 0 fits the bank)',['deep','shallow'],0,80,1,10,'Height of each step. 0 shares the bank\'s whole rise out between the layers, so the last one meets the plain.'],
  ['layerLedge','layer-ledge','Flat share of a layer',['deep','shallow'],40,95,5,100,'How much of each layer is flat ledge; the rest is the riser, which the sun shades.'],
  ['layerRough','layer-rough','Layer irregularity',['deep','shallow'],0,100,5,100,'How far the layer edges wander, so neighboring risers meet and part and no two layers run parallel for long.'],
  ['layerStyle','layer-style','Layer style',['deep','shallow'],0,1,1,1,'Contour: the layers follow the shoreline. Circular: many round bites cut out of the bank, layer after layer, each step a scalloped arc (retail lava-2).',[[0,'Contour'],[1,'Circular']]],
  ['facePx','sec-face-px','Face width (px)',SECTION_KINDS,0,400,2,1,'Width of the whole curve, foot to top, kept the same whatever the brush size (0: a share of the brush set by Slope softness).'],
  ['terraces','sec-terraces','Terraces',SECTION_KINDS,0,8,1,1,'Cut the face into this many flat ledges with risers between them.'],
  ['ledge','sec-ledge','Ledge (flat share of a step)',SECTION_KINDS,0,90,5,100,'How much of each step is flat; the rest is the riser.'],
  ['terraceJitter','sec-terrace-jitter','Terrace variation',SECTION_KINDS,0,100,5,100,'How much riser positions and step heights wander along the outline.'],
  ['spurCount','spur-count','Spurs',['hill','mountain','crater'],0,12,1,1,'Tapering spurs that branch off this ridge (off a crater, its rim), grown from the shape\'s own seed. Each joins its parent at the crest.'],
  ['spurLength','spur-length','Spur length (px)',['hill','mountain','crater'],20,400,10,1,'Average reach of a spur; each runs from about half to one and a half times this.'],
  ['spurSpread','spur-spread','Spur angle spread',['hill','mountain','crater'],0,100,5,100,'0: spurs leave swept back at about 40 degrees (off a crater, straight out); 100: scattered up to square and beyond, and more winding.'],
  ['spurWidth','spur-width','Spur width',['hill','mountain','crater'],20,200,5,100,'A spur\'s width at its root, as a share of the ridge\'s own (a crater\'s radius, on a crater); it flares a little where it joins.'],
  ['spurTaper','spur-taper','Spur taper',['hill','mountain','crater'],0,100,5,100,'How much a spur narrows and lowers toward its tip.'],
  ['spurHeight','spur-height','Spur height',['hill','mountain','crater'],10,100,5,100,'A spur\'s root height as a share of the ridge\'s crest (of the crater\'s rim height).'],
  ['spurForks','spur-forks','Spur forks',['hill','mountain','crater'],0,100,5,100,'The share of spurs that fork once, two thirds of the way out, into a shorter spur.'],
  ['spurBulb','spur-bulb','Bulbous spur tips',['hill','mountain','crater'],0,100,5,100,'Swells the outer half of every spur into a rounded lobe, so it ends in a knuckle, not a point.'],
  ['crestJag','crest-jag','Crest irregularity',['hill','mountain','crater'],0,100,5,100,'Jagged crest: its height drops in and out along the ridge (the peaks keep full height); on a crater, its spurs.'],
  ['crestVary','crest-vary','Crest width and height variation',['hill','mountain','crater'],0,100,5,100,'The ridge swells and shrinks, wider and lower in places, along its path (a crater\'s spurs, on a crater).'],
  ['crestTaper','crest-taper','Crest taper (both ends)',['hill','mountain'],0,100,5,100,'The ridge narrows and lowers toward both ends of its path.'],
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
  ['shorePlates','shore-plates','Shore plates',['deep','shallow','offset'],0,1,1,1,'Add a band of broken plates on this stroke only. Off preserves the original water shape.'],
  ['plateWaterPx','plate-water-px','Plates: water width (px)',['deep','shallow','offset'],0,240,4,1,'Reach from this stroke\'s waterline into the water.'],
  ['plateLandPx','plate-land-px','Plates: land width (px)',['deep','shallow','offset'],0,240,4,1,'Reach from this stroke\'s waterline onto land, with broken pressure ridges.'],
  ['plateSize','plate-size','Plate size (px)',['deep','shallow','offset'],8,96,2,1,'Typical width of the interlocking polygonal plates.'],
  ['plateGap','plate-gap','Plate gap (px)',['deep','shallow','offset'],0,160,5,10,'Open gap between adjacent plates.'],
  ['plateHeight','plate-height','Plate height above sea',['deep','shallow','offset'],0,240,5,10,'Flat water plates sit this high above sea; land keeps its existing height. Rock slabs: how far the land slabs stand above their seams.'],
  ['plateMaterial','plate-material','Plate material (1 rock slabs, 2 frost crystals)',['deep','shallow','offset'],1,2,1,1,'2: frost crystals, parallel straight needles in patches of three directions, cut by straight seams, thinning toward deep water (Plate size is the patch, Plate gap the needle spacing; retail Ice). 1: low flat rock slabs that interlock along the shore with dark seams between them, and a shallow ledge under the water (Crystal). The band follows this stroke\'s own waterline, so separate shores stay separate.'],
  ['frostNeedles','frost-needles','Frost needle share (plate material 2)',['deep','shallow','offset'],0,100,5,100,'Frost crystals: the share of patches that carry needles at all; the rest of the band is plain ice. Needles in a patch are also dropped at random, so lines are sparse, fine and of varied length.'],
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
  ['waterShore','water-shore','Shore edge (shore to shallow)',['deep','shallow'],0,2,1,1,'World default keeps the World panel\'s Crisp waterline. Hard: the water starts at the shoreline with ragged stairs, as retail draws it. Faded: the water fades in over a few pixels.',[[0,'World default'],[1,'Hard'],[2,'Faded']]],
  ['waterDeep','water-deep','Shallow-to-deep edge',['deep','shallow'],0,2,1,1,'World default keeps the World panel\'s Shallow-to-deep step. Hard: the shallow color stops at one depth with ragged stairs (retail Green). Faded: the color follows the depth ramp gradually (retail Archipelago).',[[0,'World default'],[1,'Hard'],[2,'Faded']]],
  ['waterBed','water-bed','Shallow water look',['deep','shallow'],0,3,1,1,'World default keeps the World panel\'s Lit bed. Lit bed: the ground under the water, lit by the same sun and tinted (retail). Noise water: the earlier flat noise texture. Cracked bed: lit bed over cracked rock-like ground, tinted (Red\'s shelf shallows).',[[0,'World default'],[1,'Lit bed'],[2,'Noise water'],[3,'Cracked bed']]],
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
  ['styleErosion','style-erosion','Override: erosion',MASK_SHAPES,-100,100,5,100,'Erosion rate inside the shape (the GPU pass), times 1 + this: below 0 less, above 0 more, -100% none.'],
  ['styleDeposits','style-deposits','Override: loose deposits',MASK_SHAPES,-100,100,5,100,'Sand and scree inside the shape, times 1 + this: below 0 less, above 0 more.'],
  ['styleVegetation','style-vegetation','Override: vegetation',MASK_SHAPES,-100,100,5,100,'Grass and moss cover inside the shape, times 1 + this: below 0 more bare rock, above 0 more cover.'],
  ['styleExposure','style-exposure','Override: rock exposure',MASK_SHAPES,-100,100,5,100,'Where rock shows inside the shape, times 1 + this: below 0 less, above 0 more.'],
  // E7
  ['crystalFacet','crystal-facet','Facet tilt (column mound)',['crystal'],0,100,5,100,'Column mound: tilts each column\'s top into one or two planes that meet at a crease, so the tops read as crumpled multi-facet crystal, not flat plates. 0 keeps flat tops.'],
  ['crystalSizeVar','crystal-size-var','Size variation (column mound)',['crystal'],0,100,5,100,'Column mound: the mound mixes three column widths (Column width, about half and about a third of it), the small ones where the mound is highest and in patches. 0 keeps one width.'],
  ['crystalSmooth','crystal-smooth','Smooth hill between crystals (column mound)',['crystal'],0,100,5,100,'Column mound: the share of the widest columns (and some of the middle ones) left as smooth hill with no flat top, taking the world\'s hill relief. 0 tiles the whole mound.'],
  ['craterFacets','crater-facets','Crystal facets',['crater'],0,100,5,100,'Crater: tiles the bowl, rim and apron with polygonal facets (planes fitted to the crater\'s own surface, stepped a few units from each other), so its contours are straight-edged like crystal. 0 keeps the smooth crater.'],
  // E8 (Painted Desert): ragged feet and bumpy aprons.
  ['baseVary','base-vary','Foot outline raggedness (px)',BASE_KINDS,0,60,2,1,'How far the outline of the foot strays in and out, in lobes of about 20 and 55 px (Painted Desert aprons and mesa feet).'],
  ['baseBump','base-bump','Foot bumps (height units)',BASE_KINDS,0,80,5,10,'Lumps of this height, 13 to 30 px across, on the apron and the lower face; the level cap and the plain are left alone.'],
  // E10 (Lava): finger size; layer width variation; circle size of the circular layers.
  ['fingerSize','finger-size','Finger size',['deep','shallow'],20,300,5,100,'Fingers on the joined coast: length and (less) width of each finger. Fingers never reach past this stroke\'s bank.'],
  ['layerVary','layer-vary','Layer width variation',['deep','shallow'],0,100,5,100,'How much each layer\'s width and riser height change along the shore and from one layer to the next, so risers bunch, part and merge as retail\'s do. 0 keeps the even layers.'],
  ['layerCircle','layer-circle','Circle size (px, circular layers)',['deep','shallow'],8,80,1,1,'Circular layers: the typical radius of the round bites cut from the bank.'],
  // G7 (Crystal): craters with smaller, softer facets.
  ['crystalCraterPx','crystal-crater-px','Facet width (px, crystal craters)',['crater'],0,48,2,1,'Crater facets: the width of each polygonal facet. 0 sizes them by the crater\'s radius (about a third of it, 14-36 px); retail\'s crater walls break into cells of 12-20 px.'],
  ['crystalCraterStep','crystal-crater-step','Facet step (units, crystal craters)',['crater'],0,60,5,10,'Crater facets: how far each facet may stand above or below the crater\'s own surface, in height units either way (shown in tenths: 3 is the earlier ragged crater). Retail\'s crater walls are smooth planes broken by a thin web, so a small step keeps the sun\'s light running smoothly across the wall.'],
  ['crystalCraterSkin','crystal-crater-skin','Web in the shader (crystal craters)',['crater'],0,100,100,100,'Crater facets: 100 marks the whole crater as one crystal skin (no seams in the crystal field) and leaves the thin web between the facets to the shader (World knobs crystalCraterWeb and its relatives), drawn at pixel size so its lines run thin and wander; 0 inks each facet\'s seam in the field as before.'],
  // G7 (Crystal): finer shore slabs.
  // H20b (Crystal): some slabs break into a fine mesh.
  ['plateVary','plate-vary','Rock slab variety (share of slabs broken into fine mesh)',['deep','shallow','offset'],0,100,5,100,'Rock slabs (Plate material 1): in patches, a slab breaks into a fine mesh of cells about 0.4 of Plate size inside its own outline, so the large seams stay. This sets the share of slabs that break; 0 keeps every slab whole.'],
  ['crystalShoreSeam','crystal-shore-seam','Rock slab seam mark (crystal shores)',['deep','shallow','offset'],50,65,1,100,'Rock slabs: the crystal-field value of a seam. 50 is the earlier black seam; higher values thin it (the shader inks only below 66) toward the hairline seams of retail\'s shore band.'],
  // G6 (Ice): angular facets that belong to the mountain.
  ['iceFacets','ice-facets','Angular facets',['mountain'],0,100,5,100,'Ice: breaks part of the mountain into angular facets: tilted planes fitted to the mountain\'s own surface, a little steeper, stepped a few units off their neighbors and partly buried where the ground rises past them. They share the mountain\'s material and light, so they stand out of the snow as part of it. 0 keeps the smooth mountain.'],
  ['iceFacetSize','ice-facet-size','Facet size (px)',['hill','mountain'],16,96,2,1,'Ice facets: the typical width of one facet.'],
  // G8 (Moon): lumpy, folded outlines.
  ['moonLobes','moon-lobes','Outline lobes (share of radius)',['hill','mountain'],0,60,2,100,'How far the hill\'s whole outline, crest to foot, strays in and out in lobes of about half, a fifth and a fourteenth of its radius, so it folds like a retail lunar formation instead of an oval. 0 keeps the smooth outline.'],
  // G5 (Lava): contour layers wander in two dimensions and vary in width, as retail lava-1's bank.
  ['lavaCircleVary','lava-circle-vary','Circle variety (circular layers)',['deep','shallow'],0,100,5,100,'Circular layers: how much the bites differ from one another, in radius (a few large among many small), in the spacing of their rings, and in how many sites keep one, so they gather in clusters with bare stretches, as retail lava-2\'s do. 0: the even circles.'],
  ['lavaSpread','lava-spread','Layer width spread',['deep','shallow'],0,200,5,100,'Contour layers: extra spread in layer width along the shore, on top of Layer width variation (100 is about 2.7 times between the narrowest and the widest). 0: none.'],
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
const shapeDefaults=() => ({...Object.fromEntries(SHAPE_FIELDS.map(([key]) => [key,worldDefault(key)]))});
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
  // The curve editor sits above the face width (H15 part 2, step C): a form to pick, the curve's knots to drag, and the lean.
  const preview=document.createElement('div'); preview.className='control'; preview.id='section-preview-control'; preview.hidden=true;
  const cvStyle='width:100%;background:#172119;border:1px solid #465344;border-radius:4px;touch-action:none;display:block;margin-top:4px';
  preview.innerHTML=`<label for="curve-form">Curve</label><select id="curve-form" style="width:100%"><option value="">The shape\'s own</option>${FORM_NAMES.map(f => `<option value="${f}">${f[0].toUpperCase()+f.slice(1)}</option>`).join('')}</select>`+
    `<canvas id="section-preview" width="222" height="120" style="${cvStyle};cursor:crosshair"></canvas><canvas id="section-across" width="222" height="44" style="${cvStyle}"></canvas>`+
    `<div style="display:flex;gap:6px;margin-top:4px;align-items:center"><button type="button" id="curve-reset" style="flex:none">Reset to the form</button><span class="small" id="curve-lean" style="flex:1"></span></div>`+
    '<p class="small">Height share against distance share, foot to top. Drag a knot; click the line to add one; double-click a knot (or Shift-click) to remove it. A knot above 1 makes a lip (on water, below 0).</p>';
  root.children[SHAPE_FIELDS.findIndex(f => f[0]==='facePx')].before(preview);
  $('curve-form').addEventListener('change',() => { const f=$('curve-form').value; setCurve(f?{form:f}:null); if (selected>=0) { checkpoint(); queueWeather(); } });
  $('curve-reset').addEventListener('click',() => { const c=currentCurve(); setCurve(c?.form?{form:c.form}:null); if (selected>=0) { checkpoint(); queueWeather(); } });
  curveEditorEvents();
  for (const [,id] of SHAPE_FIELDS) $(id).addEventListener('input',() => { rememberTool(true); updateControls(); schedule(); persistLater(); if (selected>=0) editSelectedFromControls(); });
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
const amountRange=kind => kind==='crystal'?[5,200]:kind==='fissure'?[2,60]:kind==='offset'?[-80,80]:['smooth','sand','grass','paint'].includes(kind)?[5,100]:[5,160];
// Cover brushes share the plateau outline and write a field, not heights; the
// mask brush (card C5) is one of them.
const isCover=kind => kind==='sand' || kind==='grass' || kind==='paint';
function toolDefaults(kind,preset=config?.biomeId||'green') {
  return {...Object.fromEntries(SHAPE_FIELDS.map(([key,,,,lo,hi,,scale]) => [key,clamp(Math.round(worldDefault(key)*scale),lo,hi)])),cracks:{hill:40,mountain:60,plateau:50,crater:30,offset:40}[kind]??0,diameter:200,amount:kind==='offset'?20:kind==='fissure'?12:isCover(kind)?100:70,roughness:35,shelves:25,bankWidth:50,beachFlatness:50,softness:50,shallowMode:'area',preset,...TOOL_PRESETS[preset]?.[kind]};
}
function rememberTool(custom=false) {
  const state={...toolSettings[tool],shallowMode:$('shallow-mode').value};
  for (const [key,[id]] of Object.entries(TOOL_FIELDS)) state[key]=Number($(id).value);
  if (custom) state.preset='custom';
  toolSettings[tool]=state;
}
function showTool(state={},kind=tool) {
  [$('amount').min,$('amount').max]=amountRange(kind).map(String);
  for (const [key,[id,lo,hi]] of Object.entries(TOOL_FIELDS)) if (Number.isFinite(state[key])) $(id).value=clamp(state[key],lo,hi);
  $('shallow-mode').value=state.shallowMode==='passage'?'passage':'area';
  $('tool-style').value=Object.hasOwn(TOOL_PRESETS,state.preset)?state.preset:'custom';
}
function updateControls() {
  const picks=JSON.stringify(strokeWaterPicks());if(picks!==panelPicks){panelPicks=picks;syncWorldControls();}   // a stroke's water choice wakes or idles world rows
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
  // With Select active, show the selected shape's own controls.
  const activeTool=tool;
  if (tool==='move') tool=nodes[selected]?.params?nodes[selected].kind:'move';
  try {
  const fixed=['deep','shallow','ramp','erase'].includes(tool);
  $('amount-control').hidden=fixed;
  $('amount-label').textContent=tool==='smooth' || isCover(tool)?'Strength':tool==='crystal'?'Height':tool==='lower'?'Lower by':tool==='crater' || tool==='fissure'?'Depth':tool==='offset'?'Height change':'Rise';
  const [lo,hi]=amountRange(tool); $('amount').min=String(lo); $('amount').max=String(hi);
  $('amount').value=String(clamp(Number($('amount').value),lo,hi));
  const amountNow=Number($('amount').value);
  $('amount-value').textContent=tool==='smooth' || isCover(tool)?amountNow+'%':tool==='offset'?(amountNow<0?'−':'+')+Math.abs(amountNow):(tool==='lower'?'−':'+')+amountNow;
  $('diameter-value').textContent=$('diameter').value+' units';
  $('roughness-value').textContent=$('roughness').value+'%';
  $('roughness-label').textContent=tool==='ramp'?'Shoulder freedom':tool==='deep'?'Coast freedom':['plateau','erase','sand','grass','paint'].includes(tool)?'Edge freedom':'Roughness';
  $('shelves-control').hidden=tool!=='deep';
  $('shallow-mode-control').hidden=tool!=='shallow';
  $('shelves-value').textContent=$('shelves').value+'%';
  $('bank-control').hidden=!['deep','shallow'].includes(tool);
  // A fissure's outline is its own jaggedness; Roughness would do nothing.
  $('roughness').closest('.control').hidden=tool==='fissure';
  $('beach-control').hidden=!['deep','shallow'].includes(tool);
  $('softness-control').hidden=!['plateau','hill','mountain','crater','offset','erase','sand','grass','paint'].includes(tool);
  if (tool==='crystal') $('roughness-label').textContent='Irregularity';
  $('cracks-control').hidden=!['plateau','hill','mountain','crater','offset'].includes(tool);
  $('cracks-value').textContent=$('cracks').value+'%';
  // Spur and rim details show once their switch (spurs, sectors, gaps) is on.
  const gate={layerPx:'shoreLayers',layerRiser:'shoreLayers',layerLedge:'shoreLayers',layerRough:'shoreLayers',layerStyle:'shoreLayers',layerVary:'shoreLayers',layerCircle:'shoreLayers',iceFacetSize:'iceFacets',fingerSize:'fingers',spurLength:'spurCount',spurSpread:'spurCount',spurWidth:'spurCount',spurTaper:'spurCount',spurHeight:'spurCount',spurForks:'spurCount',spurBulb:'spurCount',rimUnequal:'rimSectors',rimGapWidth:'rimGaps',fissureBranchLen:'fissureBranches',fissureBranchSpread:'fissureBranches',lavaSpread:'shoreLayers',lavaCircleVary:'shoreLayers'};
  // On a crater, the crest options only shape its spurs.
  if (tool==='crater') { gate.crestJag='spurCount'; gate.crestVary='spurCount'; }
  // A fissure in network mode has no branches, taper or path jag to set; line mode has no block size.
  const net=tool==='fissure' && Number($('fissure-network').value)>=.5;
  const modeOff=key => tool==='fissure' && (net?['fissureBranches','fissureBranchLen','fissureBranchSpread','fissureTaper'].includes(key):key==='fissureCell');
  // Berg options show only for the berg form.
  const frostOff=key => (key==='frostNeedles' && Number($('plate-material').value)<2) || (key==='layerCircle' && Number($('layer-style').value)!==1);
  const bergOff=key => tool==='crystal' && ['crystalAlign','bergFace','bergJitter','bergBreak','bergRough','bergTilt','bergTiltDir','bergFlat'].includes(key) && Number($('crystal-form').value)<2;
  const shapeOptions={...Object.fromEntries(SHAPE_FIELDS.map(([key])=>[key,shapeValue(key)])),world:renderer?worldPanelValues():{}};
  const gated=key => !shapeControlAvailable(key,tool,shapeOptions) || modeOff(key) || bergOff(key) || frostOff(key) || (gate[key] && !(Number($(SHAPE_FIELDS.find(f => f[0]===gate[key])[1]).value)>0));
  for (const [key,id,,kinds,,,,scale] of SHAPE_FIELDS) { $(id+'-control').hidden=!kinds.includes(tool) || gated(key) || (key==='maskAmount' && Number($('mask-channel').value)<1); $(id+'-value').textContent=scale===1?$(id).value:scale===10?(Number($(id).value)/scale).toFixed(1):$(id).value+'%'; }
  if(SECTION_KINDS.includes(tool) && !shapeControlAvailable('softness',tool,{...shapeOptions,curve:currentCurve()}))$('softness-control').hidden=true;
  if(shapeOptions.bankPx>0 && !(shapeOptions.facePx>0))$('bank-control').hidden=true;
  $('section-preview-control').hidden=!SECTION_KINDS.includes(tool);
  if (!$('section-preview-control').hidden) drawSection();
  $('bank-value').textContent=$('bank-width').value+'%';
  $('beach-value').textContent=$('beach-flatness').value+'%';
  $('softness-value').textContent=$('softness').value+'%';
  $('relief-value').textContent=$('relief').value+'%';
  $('ring-value').textContent=$('mineral-ring').value+'%';
  $('ring-spread-value').textContent=$('ring-spread').value+'%';
  $('ring-variation-value').textContent=$('ring-variation').value+'%';
  $('material-weathering-value').textContent=$('material-weathering').value+'%';
  $('deposit-spread-value').textContent=$('deposit-spread').value+'%';
  $('transition-detail-value').textContent=$('transition-detail').value+'%';
  $('tool-style').value=toolSettings[tool]?.preset||'custom';
  $('scree-value').textContent=$('scree').value+'%';
  $('tool-help').textContent=tool==='shallow' && $('shallow-mode').value==='passage'
    ?'Raise the underwater bed to 7 below sea level for a shallow passage. Existing land and shallower banks keep their shape.'
    :HELP[tool];
  $('undo').disabled=!ready || Boolean(stroke||moving) || historyIndex<=0;
  $('redo').disabled=!ready || Boolean(stroke||moving) || historyIndex>=history.length-1;
  $('export').disabled=!canExport(); mapUpdate();
  const view=mapCanvas?.view();$('fit').setAttribute('aria-pressed',String(view?view.overview:true));$('one').setAttribute('aria-pressed',String(view?!view.overview&&view.scale===1:false));
  } finally { tool=activeTool; }
  if (tool==='move') { $('tool-help').textContent=pathAdding?'Click to add an attached point · Escape finishes · shared junctions move together':drawMode==='add'?'Draw another path in the selected shape · start on a point to attach it · paths join without adding height':HELP.move; $('amount-control').hidden=selected<0 || ['deep','shallow','ramp','erase'].includes(nodes[selected]?.kind); }
  // Say what the brush controls change: the next stroke, or a selected shape.
  const editing=selected>=0 && nodes[selected]?.params;
  $('brush-panel').classList.toggle('editing',Boolean(editing));
  $('brush-title').textContent=editing?`Selected · ${NODE_NAMES[nodes[selected].kind]||nodes[selected].kind} #${selected+1}`:tool==='move'?'Select':`Brush · new ${NODE_NAMES[tool]||tool}`;
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
// The curve editor (H15 part 2, step C). The curve a stroke carries is {form, knots?}: the form alone follows softness, knots (once one is dragged) are what
// saves. The preview draws the real table (sculpt-shape-presets.js sectionPreview), foot to top, before the outline noise.
const CV_LO=-.6,CV_HI=1.6,CV_PAD=9;
const curveKind=() => selected>=0 && nodes[selected]?.params ? nodes[selected].kind : tool;
const currentCurve=() => (selected>=0 && nodes[selected]?.params ? nodes[selected].params.curve : toolSettings[tool]?.curve) || null;
function curveContext() {
  const kind=curveKind(),o=Object.fromEntries(SHAPE_FIELDS.map(([key]) => [key,shapeValue(key)])),shouldered=isShouldered(kind,o,ridgeOn(kind,o));
  return {kind,shouldered,water:kind==='deep' || kind==='shallow',q:{...o,radius:Number($('diameter').value)/2,softness:Number($('softness').value)/100,curve:currentCurve()}};
}
// Hand the curve to the shape being edited (or to the brush, for the next stroke); null goes back to the kind's own form.
function setCurve(curve) {
  if (selected>=0 && nodes[selected]?.params) {
    const n=nodes[selected],p={...n.params}; if (curve) p.curve=curve; else delete p.curve; n.params=p;
    updateControls(); editSelectedFromControls(); persistLater(); return;
  }
  const t={...toolSettings[tool],preset:'custom'}; if (curve) t.curve=curve; else delete t.curve; toolSettings[tool]=t;
  updateControls(); schedule(); persistLater();
}
const cvXY=(x,v,W,H) => [CV_PAD+(W-2*CV_PAD)*x,H-CV_PAD-(H-2*CV_PAD)*(v-CV_LO)/(CV_HI-CV_LO)];
function drawSection() {
  const cv=$('section-preview'),g=cv.getContext('2d'),W=cv.width,H=cv.height,c=curveContext(),{water,ys,knots}=sectionPreview(c.kind,c.q,c.shouldered),n=ys.length-1;
  g.clearRect(0,0,W,H);
  g.strokeStyle='#465344'; g.setLineDash([3,3]); for (const v of [0,1]) { const [,y]=cvXY(0,v,W,H); g.beginPath(); g.moveTo(CV_PAD,y); g.lineTo(W-CV_PAD,y); g.stroke(); } g.setLineDash([]);
  const [,y0]=cvXY(0,0,W,H); g.beginPath(); g.moveTo(CV_PAD,y0);
  for (let k=0;k<=n;k++) g.lineTo(...cvXY(k/n,ys[k],W,H));
  g.lineTo(W-CV_PAD,y0); g.closePath(); g.fillStyle=water?'rgba(102,170,200,.28)':'rgba(180,213,137,.25)'; g.fill();
  g.beginPath(); for (let k=0;k<=n;k++) g[k?'lineTo':'moveTo'](...cvXY(k/n,ys[k],W,H));
  g.strokeStyle='#b4d589'; g.lineWidth=1.5; g.stroke(); g.lineWidth=1;
  // The handles: the stroke's own knots, or its form's (a power law or a smoothstep shows nine, which a drag then makes its own).
  g.fillStyle=c.q.curve?.knots?'#e8f2d8':'rgba(232,242,216,.45)'; for (const [x,v] of (c.q.curve?.knots||knots.length<=12?knots:thinKnots(knots))) { g.beginPath(); g.arc(...cvXY(x,v,W,H),3.5,0,7); g.fill(); }
  g.fillStyle='#a8b7a5'; g.font='9px system-ui'; g.fillText(water?'ground':'foot',CV_PAD,10); g.textAlign='right'; g.fillText(water?'bed':'top',W-CV_PAD,10); g.textAlign='left';
  $('curve-form').value=c.q.curve?.form||''; $('curve-reset').disabled=!c.q.curve?.knots;
  // Lean: the whole cross-section, the long slope toward the lean side on the left (its back curve where the shape has one).
  const ratio=leanRatio(c.kind,c.q,c.shouldered),across=$('section-across'),a=across.getContext('2d'),AW=across.width,AH=across.height,{back}=sectionPreview(c.kind,c.q,c.shouldered);
  const facing=Math.round(c.q.facing||0),toward=FACING_CHOICES.find(f => f[0]===(facing||3))[1];
  $('curve-lean').textContent=`Lean ${(Math.round(ratio*100)/100).toFixed(2)} : 1 toward ${toward.toLowerCase()}`;
  across.hidden=c.water; a.clearRect(0,0,AW,AH);
  if (!c.water) {
    const total=ratio+1,X=t => CV_PAD+(AW-2*CV_PAD)*t/total,Y=v => AH-6-(AH-12)*Math.min(Math.max(v,0),1.5)/1.5;
    a.beginPath(); a.moveTo(X(0),Y(0));
    for (let k=0;k<=n;k++) a.lineTo(X(ratio*(1-k/n)),Y(back[k]));
    for (let k=n;k>=0;k--) a.lineTo(X(ratio+(1-k/n)),Y(ys[k]));
    a.lineTo(X(total),Y(0)); a.closePath(); a.fillStyle='rgba(180,213,137,.25)'; a.fill(); a.strokeStyle='#b4d589'; a.stroke();
  }
}
function curveEditorEvents() {
  const cv=$('section-preview'); let drag=-1;
  const at=e => { const r=cv.getBoundingClientRect(),W=cv.width,H=cv.height,px=(e.clientX-r.left)*W/r.width,py=(e.clientY-r.top)*H/r.height; return {px,py,x:clamp((px-CV_PAD)/(W-2*CV_PAD),0,1),v:CV_LO+(CV_HI-CV_LO)*(H-CV_PAD-py)/(H-2*CV_PAD)}; };
  // The knots to edit: the stroke's own, or its form's (thinned when the form samples a power law or a smoothstep finely).
  const knotsNow=() => { const c=curveContext(),k=strokeKnots(c.kind,c.q,c.shouldered).knots; return {c,knots:(c.q.curve?.knots||k.length<=12?k:thinKnots(k)).map(p => [...p])}; };
  const store=(c,knots) => setCurve({form:c.q.curve?.form||defaultForm(c.kind,c.shouldered),knots:knots.map(([x,v]) => [Math.round(x*1000)/1000,Math.round(v*1000)/1000])});
  const hit=(knots,p) => { let best=-1,d=8; knots.forEach(([x,v],i) => { const [kx,ky]=cvXY(x,v,cv.width,cv.height),dd=Math.hypot(kx-p.px,ky-p.py); if (dd<d) { d=dd; best=i; } }); return best; };
  const remove=(c,knots,i) => { if (i>0 && i<knots.length-1 && knots.length>2) { knots.splice(i,1); store(c,knots); return true; } return false; };
  cv.addEventListener('contextmenu',e => e.preventDefault());
  cv.addEventListener('pointerdown',e => {
    const p=at(e),{c,knots}=knotsNow(),i=hit(knots,p); if (e.button===2) return;
    if (i>=0 && e.shiftKey) { if (remove(c,knots,i) && selected>=0) { checkpoint(); queueWeather(); } return; }
    if (i>=0) { drag=i; } else {
      const x=clamp(p.x,.01,.99); let j=knots.findIndex(k => k[0]>x); if (j<0) j=knots.length-1;
      knots.splice(j,0,[x,clamp(p.v,c.water?-.5:0,1.5)]); drag=j; store(c,knots);
    }
    cv.setPointerCapture(e.pointerId);
  });
  cv.addEventListener('pointermove',e => {
    if (drag<0) return;
    const p=at(e),{c,knots}=knotsNow(),k=knots[drag];
    if (drag>0 && drag<knots.length-1) k[0]=clamp(p.x,knots[drag-1][0]+.01,knots[drag+1][0]-.01);
    k[1]=clamp(p.v,c.water?-.5:0,1.5); store(c,knots);
  });
  const finish=() => { if (drag>=0) { drag=-1; if (selected>=0) { checkpoint(); queueWeather(); } } };
  cv.addEventListener('pointerup',finish); cv.addEventListener('pointercancel',finish);
  cv.addEventListener('dblclick',e => { const p=at(e),{c,knots}=knotsNow(),i=hit(knots,p); if (i>=0 && remove(c,knots,i) && selected>=0) { checkpoint(); queueWeather(); } });
}
// Line features (card C4). A ridge (a hill or mountain with spurs or crest
// options) is swept as short pieces, each with width and height multipliers at
// its two ends that the brush dab reads as the piece, so the crest swells, narrows and
// tapers along its path and every spur is simply more pieces on the same
// stroke: the nearest influence wins, so a spur meets its parent at the crest
// with no seam and no detached lump. Spur geometry comes from the stroke seed
// and the path alone, never from the heights, and each cell reads only its own
// position and the pieces, so region replay stays exact.
const hasCoastPass=(kind,p) => (kind==='deep' || kind==='shallow') && (true && (p?.fingers??worldDefault('fingers'))>0 || Math.round(p?.shoreLayers??worldDefault('shoreLayers'))>=1);
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
const NODE_NAMES={crystal:'Faceted form',sand:'Sand cover',paint:'Surface paint',grass:'Ground cover',erase:'Reset ground',ground:'Ground undulation',crater:'Crater',fissure:'Fissure',offset:'Raise / lower',plateau:'Plateau',hill:'Rounded ridge',mountain:'Peaked ridge',ramp:'Ramp',deep:'Deep water',shallow:'Shallow water',smooth:'Smooth',lower:'Lower',raster:'Imported surface',compact:'Height scale',flowbake:'Flow bake'};
function strokeParams(s) { return {...Object.fromEntries(['shorePlates','plateWaterPx','plateLandPx','plateSize','plateGap','plateHeight','plateMaterial','frostNeedles',...COAST_KEYS,/* E8 */'baseVary','baseBump','moonLobes'].map(k => [k,s[k]])),radius:s.radius,amount:s.amount,rough:s.rough,bankWidth:s.bankWidth,softness:s.softness,beachFlatness:s.beachFlatness,shelves:s.shelves,shallowMode:s.shallowMode,craterlets:s.craterlets,craterEjecta:s.craterEjecta,lean:s.lean,facing:s.facing,outlineVar:s.outlineVar,widthVar:s.widthVar,heightVar:s.heightVar,fingers:s.fingers,bankPx:s.bankPx,faceVariation:s.faceVariation,crystalTiers:s.crystalTiers,paintChannel:s.paintChannel,maskChannel:s.maskChannel,maskAmount:s.maskAmount,...Object.fromEntries(STYLE_KEYS.map(k => [k,s[k]])),...Object.fromEntries(WATER_KEYS.map(k => [k,s[k]])),crystalForm:s.crystalForm,crystalStep:s.crystalStep,crystalSides:s.crystalSides,crystalSize:s.crystalSize,crystalCount:s.crystalCount,crystalTop:s.crystalTop,crystalLean:s.crystalLean,crystalVariation:s.crystalVariation,...Object.fromEntries(['crystalAlign','bergFace','bergJitter','bergBreak','bergRough','bergTilt','bergTiltDir','bergFlat'].map(k => [k,s[k]])),...Object.fromEntries(SECTION_KEYS.map(k => [k,s[k]])),curve:s.curve,...Object.fromEntries(RIDGE_KEYS.map(k => [k,s[k]])),...Object.fromEntries(FISSURE_KEYS.map(k => [k,s[k]])),cracks:s.cracks,
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
  // World-space reach of a shape, from the same extents its brush uses,
  // plus a few cells for the hill's softening blur.
  if (!n.points) return {x0:0,y0:0,x1:grid-1,y1:grid-1};
  const q={...shapeDefaults(),...n.params},radius=q.radius||40,rough=q.rough??.35,soft=q.softness??.5;
  const bank=['deep','shallow'].includes(n.kind)?2**(((q.bankWidth??.5)-.5)*1.3):1;
  const back=soft===.5?1.34:2-(.66+(soft-.5)*.9);
  const reach={plateau:Math.min(1.7,1+rough*1.3)+1.9*rough,offset:Math.min(1.7,1+rough*1.3)+1.9*rough,erase:Math.min(1.7,1+rough*1.3)+1.9*rough,sand:Math.min(1.7,1+rough*1.3)+1.9*rough,grass:Math.min(1.7,1+rough*1.3)+1.9*rough,paint:Math.min(1.7,1+rough*1.3)+1.9*rough,hill:Math.max(1.4,back)*1.75+1.7*rough,deep:Math.min(1.9,1+rough*1.6)*bank+2.2*rough,
    shallow:bank+.4*rough,crater:2.9*(1+.45*rough)+.9*rough,ramp:1+.28*rough}[n.kind] ?? 1+.4*rough;
  let r=n.kind==='crystal'?radius*(q.crystalForm>=.5 && q.crystalForm<1.5?1.35:1)+(q.crystalForm>=.5 && q.crystalForm<1.5?0:(q.crystalSize||24)*(n.frame?Math.hypot(n.frame[0],n.frame[1]):1)*1.6)+12*spacing:radius*reach+12*spacing+(['deep','shallow'].includes(n.kind)?(q.fingers||0)*110+(q.bankPx||0)+(q.shoreLayers>=1?coastLayerReach(q):0):0)+(['deep','shallow','offset'].includes(n.kind)&&q.shorePlates>0?Math.max(q.plateWaterPx||0,q.plateLandPx||0):0);
  if(BASE_KINDS.includes(n.kind))r+=Math.max(0,q.baseVary||0);
  if(['hill','mountain'].includes(n.kind))r+=Math.max(0,q.moonLobes||0)*radius;
  let ax=Infinity,ay=Infinity,bx=-Infinity,by=-Infinity;
  for (const p of n.points) { ax=Math.min(ax,p.x); ay=Math.min(ay,p.y); bx=Math.max(bx,p.x); by=Math.max(by,p.y); }
  // A fissure reaches its branches (and their forks) and, in network mode, its footprint.
  if (n.kind==='fissure') { const k=n.frame?Math.hypot(n.frame[0],n.frame[1]):1; r=(q.fissureNetwork>=.5?radius*1.1:0)+(Math.round(q.fissureBranches)>=1?(q.fissureBranchLen||0)*2.4*k:0)+(q.fissureWidth||5)*3*k+24+12*spacing; }
  // Spurs (card C4) reach up to one and a half spur lengths past the ridge or rim, plus their own width.
  // A ridge's crest also swells to 1.4 of its radius and a spur's root flares to about 1.7 times Spur width.
  if (ridgeOn(n.kind,q)) r+=radius;
  if (Math.round(q.spurCount)>=1 && ['hill','mountain','crater'].includes(n.kind)) { const k=n.frame?Math.hypot(n.frame[0],n.frame[1]):1; r+=(q.spurLength||0)*(q.spurForks>0?2.1:1.6)*k+radius*Math.max(1,((q.spurWidth||.8)+(q.spurBulb||0)*.7)*1.7); }
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
    const q={...shapeDefaults(),...n.params},s=n.seed??seed;
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
  const q={...shapeDefaults(),...n.params},bank=2**(((q.bankWidth??.5)-.5)*1.3);
  let cells=n.kind==='smooth'?clamp(Math.round(q.radius/(spacing*7)),1,24):isShouldered(n.kind,q,ridgeOn(n.kind,q))?4:0;
  // A framed finger cache is keyed on authoring cells; include every world
  // cell that can share that key. Radial thumbs can share a coastal key from
  // both sides of the radial band, so their first-call order needs that band.
  if (['deep','shallow'].includes(n.kind) && q.fingers>0) {
    if (n.frame) cells+=Math.ceil(2*Math.max(Math.hypot(n.frame[0],n.frame[1]),Math.hypot(n.frame[2],n.frame[3])))+2;
  }
  if (hasCoastPass(n.kind,q)) {
    // Signed-distance normals read ten neighbors and a derivative. A new
    // tongue can reach another tongue before reaching its original shore,
    // so keep the connection band as well as the visible finger reach.
    if (q.fingers>0) cells+=Math.ceil(3*(.5*q.radius*bank+spacing*3)/spacing)+32;
    if (Math.round(q.shoreLayers)>=1) cells+=Math.ceil(coastLayerReach(q)/spacing)+2;
  }
  if(Math.round(q.layerStyle)===1&&Math.round(q.shoreLayers)>=1&&['deep','shallow'].includes(n.kind)){
    const Rc=Math.max(8,q.layerCircle),N=Math.max(1,Math.round(q.shoreLayers)),W=Math.max(4,q.layerPx),cv=clamp(q.lavaCircleVary||0,0,1),B=Math.ceil((1.4*Rc+cv*.1*Rc+N*W*(1+.45*cv))/spacing);
    cells+=Math.max(0,2*B+1+Math.ceil(1.12*Rc/spacing)+2-(Math.ceil(coastLayerReach(q)/spacing)+2));
  }
  if(BASE_KINDS.includes(n.kind))cells+=Math.ceil(Math.max(0,q.baseVary||0)/spacing);
  if(['hill','mountain'].includes(n.kind))cells+=Math.ceil(Math.max(0,q.moonLobes||0)*(q.radius||40)/spacing);
  // G6: a facet plane is fitted at its center, up to half a facet away and three cells either side of it, in the stroke's frame.
  if(n.kind==='mountain'&&q.iceFacets>0){const f=n.frame??IDENTITY,L=clamp(q.iceFacetSize,16,96);cells+=Math.ceil(1.95*L*Math.max(Math.abs(f[0])+Math.abs(f[2]),Math.abs(f[1])+Math.abs(f[3]))/spacing+.5)+4;}
  if(n.kind==='crater'&&q.craterFacets>0){const f=n.frame??IDENTITY,L=craterFacetWidth(q);cells+=Math.ceil(1.95*L*Math.max(Math.abs(f[0])+Math.abs(f[2]),Math.abs(f[1])+Math.abs(f[3]))/spacing+.5)+3;}
  if (['deep','shallow','offset'].includes(n.kind) && q.shorePlates>0) cells+=Math.ceil(Math.max(q.plateWaterPx,q.plateLandPx)/spacing)+2;
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
    const b=nodeBounds(n),points=['plateau','crater'].includes(n.kind)?[n.points[0]]:n.kind==='ramp'?shapePaths(n).flatMap(path=>[n.points[path[0]],n.points[path.at(-1)]]):[];
    if (n.kind==='crater') for (let k=0;k<Math.round(n.params?.craterlets??worldDefault('craterlets'));k++) points.push(craterletSpot(n,n.seed??seed,n.params?.radius??40,k).p);
    if (points.some(pointTouched)) { dirty=unionRect(dirty,b); continue; }
    const pad=regionalReadApron(n),reach={x0:Math.max(0,dirty.x0-pad),y0:Math.max(0,dirty.y0-pad),x1:Math.min(worldGrid-1,dirty.x1+pad),y1:Math.min(worldGrid-1,dirty.y1+pad)};
    if (pad && overlaps(reach,b)) dirty=unionRect(dirty,{x0:Math.max(reach.x0,b.x0),y0:Math.max(reach.y0,b.y0),x1:Math.min(reach.x1,b.x1),y1:Math.min(reach.y1,b.y1)});
  }
  return dirty;
}
// Shape runs on the GPU: the compute passes of engine-shape.wgsl (sculpt-gpu-fields.js) draw every brush; a node they do not draw draws nothing.
const shapeContext=() => ({params:n => ({...shapeDefaults(),...n.params}),seed,sea:config.seaLevel,baseHeight:config.baseHeight,minH:MIN_HEIGHT,maxH:MAX_HEIGHT,
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
  return pagedWanted()?createPagedFields({...common,budget:gpuBudget,apron:Number(query.get('timeApron')||128),forceRing:Number(query.get('pageRing')||0)}):createGpuFields(common);
}
// Every application receives a bounded prefix window. Temporary global views
// let the existing brush routines keep their row strides; no node retains a
// field snapshot or world-sized noise array in map mode.
function currentStrokeOptions() {
  applySeedControl();
  return {radius:Number($('diameter').value)/2,amount:Number($('amount').value),rough:Number($('roughness').value)/100,bankWidth:Number($('bank-width').value)/100,softness:Number($('softness').value)/100,beachFlatness:Number($('beach-flatness').value)/100,shelves:Number($('shelves').value)/100,shallowMode:$('shallow-mode').value,cracks:Number($('cracks').value)/100,seed,...Object.fromEntries(SHAPE_FIELDS.map(([key]) => [key,shapeValue(key)])),...(toolSettings[tool]?.curve?{curve:toolSettings[tool].curve}:{})};
}
function regionalPoints(points) {
  if (!Array.isArray(points) || !points.length || points.some(p => !Number.isFinite(p.x) || !Number.isFinite(p.y))) throw new Error('Invalid terrain stroke.');
  return points.map(p => ({x:clamp(p.x,0,(config.map?.width??size)-1),y:clamp(p.y,0,(config.map?.height??size)-1)}));
}
function beginRegionalStroke(kind,point,options={},attachment=-1,target=-1,advanceSeed=false) {
  if(stroke||moving||!HELP[kind]||kind==='move')throw new Error('A terrain gesture is already active or the brush is invalid.');
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
function endRegionalStroke(commit=true,simplify=false) {
  if(!stroke?.regional)return false;
  if(commit&&simplify){
    // Simplify only the path just drawn, before its single undo checkpoint.
    // Three terrain pixels gives the same fidelity at every canvas zoom.
    // Reusing preview preserves shared branch roots and invalidates both bounds.
    const points=shapePaths(stroke.node)[stroke.pathIndex].map(i=>stroke.node.points[i]),reduced=simplifyPath(points,3);
    if(reduced.length<points.length)previewRegionalStroke(reduced);
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
  return {clay:$('clay').checked,light:$('light').value,scree:Number($('scree').value)/100,detail:Number($('relief').value)/100,ring:Number($('mineral-ring').value)/100,ringSpread:Number($('ring-spread').value)/100,ringVariation:Number($('ring-variation').value)/100,materialWeathering:Number($('material-weathering').value)/100,transitionDetail:Number($('transition-detail').value)/100};
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
  const p={age:renderer.variantNumber('erosionAge',200),rain:renderer.variantNumber('erosionRain',1),talusAngle:renderer.variantNumber('talusAngle',40),columnContrast:renderer.variantNumber('columnContrast',1),
    envelope:renderer.variantNumber('erosionEnvelope',2),sand:renderer.variantNumber('sand',0),wetReach:renderer.variantNumber('wetReach',3),talusFull:renderer.variantNumber('talusFull',2.5),wearFull:renderer.variantNumber('wearFull',1.5),flowK:renderer.variantNumber('flowK',30)};
  const material=materialKnobs();
  return fields.setTime({key:JSON.stringify({...p,material,column:config.column,variant:config.variant}),material:Boolean(material),run:async win => {
    const {erosionOf}=await import('./sculpt-erosion.js'),erosion=await erosionOf(renderer);
    const r=await erosion.runGpu({...p,planes:win.planes,masks:win.masks,rateMask:MASK_KEYS.indexOf('ovErosion'),grid:win.grid,size,spacing,seaLevel:config.seaLevel,ox:win.ox,oy:win.oy});
    // The window's eroded height (plane 1 of the pass's weather buffer) makes the material field; the page keeps its core of it.
    if (material) r.field=await erosion.materialField({heightBuffer:r.weather,heightOffset:win.grid*win.grid,grid:win.grid,size,ox:win.ox,oy:win.oy,seaLevel:config.seaLevel,baseHeight:config.baseHeight,seed:material.seed,depositSpread:material.depositSpread,profile:{...config.material,mineral:material.mineral}});
    return r;
  }});
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
async function gpuFeedSource(signal,regionFn) {
  if (!gpuFeedEligible()) return null;
  if (regionalFields.paged) {
    configurePagedTime();
    const region=regionFn(),sp=region.gridSpacing,ox=Math.round(region.gridOrigin[0]/sp),oy=Math.round(region.gridOrigin[1]/sp);
    if (!pagedCoarseStarted) { pagedCoarseStarted=true; regionalFields.startCoarse().catch(() => {}); }
    const feed=await regionalFields.feedSource({x0:ox,y0:oy,x1:ox+region.gridWidth-1,y1:oy+region.gridHeight-1},$('weather').checked);
    if (signal?.aborted) { feed.release(); signal.throwIfAborted(); }
    return feed;
  }
  await regionalFields.gpuReady(); signal?.throwIfAborted();
  const buffers=regionalFields.gpuBuffers(); if (!buffers) return null;
  const on=$('weather').checked;
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
  read:readRegional,gpuFeedSource,readAuthored:request => pagedOn()?regionalFields.readAsync(request,{weather:false}):regionalFields.pending?.()?regionalFields.ready().then(() => regionalFields.read(request)):regionalFields.read(request),uniformAuthored,sample:sampleRegional,sampleAuthored:(x,y,key) => regionalFields.sample(x,y,key),cell:(x,y,key) => regionalFields.cell(x,y,key),graph:() => serializeNodes(),serializeGraph:() => serializeNodes(),nodeMetadata:i => { const n=nodes[i]; return n?{kind:n.kind,hidden:n.hidden,params:n.params?{...n.params}:undefined,points:n.points?.map(p=>({...p})),paths:clonePaths(n),frame:n.frame?.slice()}:undefined; },
  loadGraph:list => { if (!Array.isArray(list) || list.some(n => n.kind==='raster')) throw new Error('A regional map requires a stroke graph.'); const next=deserializeNodes(list); cancelWeather(); nodes=next; selected=-1;pathIndex=0;pathPoint=-1;pathAdding=false;drawMode=tool==='move'?'select':'new'; evaluate(0); renderLayers(); checkpoint(); queueWeather(); },
  sketch,loadSketch:(s,id)=>loadSketchFile(s,false,id),maskKeys:MASK_KEYS,maskChunks:() => regionalFields.maskChunks(),stats:regionalStats,revision:() => revision+mapRevision+weatherJob,
  bounds:n => { const b=nodeBounds(typeof n==='number'?nodes[n]:n); return {x:b.x0*spacing,y:b.y0*spacing,width:(b.x1-b.x0)*spacing,height:(b.y1-b.y0)*spacing}; },
  residentBuffers:()=>[...(regionalFields.buffers?.()||[]),...[nodes,...history.map(h=>h.nodes)].flatMap(list=>list.flatMap(n=>n.result?.planes?.map(a=>a.buffer)??[])),...new Set([weatherBase,refined,refinedBase,...Object.values(regionalWeather||{})].filter(ArrayBuffer.isView).map(a=>a.buffer))],subscribe:fn => regionalFields.subscribe(fn),subscribeSubmit:fn => regionalFields.subscribeSubmit?.(fn),gpuBytes,gpuTransientBytes,gpuFeedActive:() => gpuFeedEligible(),currentTool:() => tool,strokeOptions:currentStrokeOptions,applyStroke:applyRegionalStroke,
  beginStroke:(kind,p,options,attachment=-1)=>beginRegionalStroke(kind,p,options,attachment,drawMode==='add'?selected:-1,varySeed),previewStroke:previewRegionalStroke,endStroke:(commit=true)=>endRegionalStroke(commit,$('simplify-strokes').checked),beginMove:beginRegionalMove,previewMove:previewRegionalMove,endMove:endRegionalMove,gestureActive:() => Boolean(stroke||moving),previewActive:() => Boolean(stroke||moving||controlsEditing),
  pathEditing:()=>pathEditing,pathSelection:()=>pathPoint,pathIndex:()=>pathIndex,pathAdding:()=>pathAdding,
  drawMode:()=>drawMode,drawingKind:()=>drawMode==='add'?nodes[selected]?.kind:tool,
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
function nodeState(n) { return {points:n.points.map(q => ({...q})),frame:n.frame||IDENTITY,radius:n.params?.radius,amount:n.params?.amount}; }
function transformNode(n,start,m) {
  n.points=start.points.map(q => { const r=applyFrame(m,q.x,q.y); return {x:clamp(r.x,0,(config.map?.width??size)-1),y:clamp(r.y,0,(config.map?.height??size)-1)}; });
  n.frame=compose(m,start.frame);
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
  if (n && n.params && HELP[n.kind]) {
    if (tool!=='move') { rememberTool(); tool='move'; }
    mapFeatures?.deactivate();
    const p=n.params;
    const [lo,hi]=amountRange(n.kind); $('amount').min=String(lo); $('amount').max=String(hi);
    $('diameter').value=clamp(p.radius*2,40,800); $('amount').value=clamp(p.amount,lo,hi); $('roughness').value=clamp(Math.round(p.rough*100),0,100);
    $('softness').value=Math.round(p.softness*100); $('bank-width').value=Math.round(p.bankWidth*100); $('beach-flatness').value=Math.round(p.beachFlatness*100);
    $('shelves').value=Math.round(p.shelves*100); $('shallow-mode').value=p.shallowMode==='passage'?'passage':'area'; $('cracks').value=Math.round((p.cracks||0)*100);
    for (const [key,id,,,lo,hi,,scale] of SHAPE_FIELDS) $(id).value=clamp(Math.round((p[key]??worldDefault(key))*scale),lo,hi);
  }
  renderLayers(); updateControls(); schedule(false);
  if (n) status(`Selected ${NODE_NAMES[n.kind]||n.kind} #${i+1}. Drag to transform or edit its settings.`);
}
function editSelectedFromControls() {
  const n=nodes[selected]; if (!n || !n.params) return;
  controlsEditing=true;
  const before=nodeBounds(n);
  n.params={...n.params,radius:Number($('diameter').value)/2,amount:Number($('amount').value),rough:Number($('roughness').value)/100,
    softness:Number($('softness').value)/100,bankWidth:Number($('bank-width').value)/100,beachFlatness:Number($('beach-flatness').value)/100,
    shelves:Number($('shelves').value)/100,shallowMode:$('shallow-mode').value,cracks:Number($('cracks').value)/100,
    ...Object.fromEntries(SHAPE_FIELDS.filter(f => f[3].includes(n.kind)).map(([key]) => [key,shapeValue(key)]))};
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
  else if (kind==='seed') { if (nodes[i].seed===undefined) return; nodes[i].seed=randomSeed(nodes[i].seed); evaluate(i); }
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
function scriptedScene(list,{ground=true}={}) {
  applySeedControl(); refinementSeed=seed;
  cancelWeather(); refined=refinedBase=null; dropGpuWeather(); clearRendererWeather(); 
  nodes=[]; selected=-1;
  if (ground) addGroundNode();
  list.forEach(([kind,points,options={}],i) => {
    const {card:override,...rest}=options,d={...toolDefaults(kind),...override},pts=points.map(([x,y]) => ({x,y}));
    const card={radius:d.diameter/2,amount:d.amount,rough:d.roughness/100,shelves:d.shelves/100,bankWidth:d.bankWidth/100,beachFlatness:d.beachFlatness/100,softness:d.softness/100,cracks:d.cracks/100,shallowMode:d.shallowMode,
      ...Object.fromEntries(SHAPE_FIELDS.map(([key,,,,,,,scale]) => [key,d[key]/scale])),curve:d.curve,seed:(seed+i*7919)>>>0};
    const probe={...card,...rest};
    addNode({kind,points:pts,params:strokeParams(probe),seed:probe.seed});
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
    toolSettings,bankWidth:Number($('bank-width').value),softness:Number($('softness').value),relief:Number($('relief').value),
    beachFlatness:Number($('beach-flatness').value),mineralRing:Number($('mineral-ring').value),ringSpread:Number($('ring-spread').value),
    ringVariation:Number($('ring-variation').value),materialWeathering:Number($('material-weathering').value),depositSpread:Number($('deposit-spread').value),transitionDetail:Number($('transition-detail').value),
    tool,diameter:Number($('diameter').value),amount:Number($('amount').value),roughness:Number($('roughness').value),shelves:Number($('shelves').value),shallowMode:$('shallow-mode').value,scree:Number($('scree').value),weather:$('weather').checked,clay:$('clay').checked,light:$('light').value,encoding:'stroke-graph'};
}
function persistLater() {
  if (experiment.has('scratch')) { $('save-state').textContent='Comparison sketch · use Save sketch to keep it.'; return; }
  clearTimeout(autosaveTimer); autosaveTimer=setTimeout(() => {
    if (stroke || moving || loading) { persistLater(); return; }
    try { localStorage.setItem(LOCAL_KEY,JSON.stringify(sketch())); $('save-state').textContent='Terrain recipe autosaved locally.'; }
    catch (_) { $('save-state').textContent='Local autosave unavailable. Use Save sketch to keep this heightfield.'; }
  },450);
}
function loadSketch(s) {
  if (!s || s.format!=='nanolathe-terrain-sculpt' || ![4,5,6].includes(s.version) || s.size!==size || s.grid!==grid || !Array.isArray(s.nodes) || s.nodes.some(n => !n || n.kind==='raster')) throw new Error('Load a map stroke graph with the same canvas and grid size.');
  const next=deserializeNodes(s.nodes),column=copyColumn(s.column,defaultColumn);
  cancelWeather(); refined=refinedBase=regionalWeather=null; dropGpuWeather();
  seed=Number.isInteger(s.seed)?clamp(s.seed,0,4294967295):2701; varySeed=s.varySeed!==false; refinementSeed=Number.isInteger(s.refinementSeed)?clamp(s.refinementSeed,0,4294967295):seed; $('seed').value=seed;
  if (Object.hasOwn(HELP,s.tool)) tool=s.tool;
  for (const kind of Object.keys(HELP)) toolSettings[kind]={...toolDefaults(kind),...(s.toolSettings?.[kind]||{})};
  showTool(toolSettings[tool]);
  for (const [key,[id,lo,hi]] of Object.entries(TOOL_FIELDS)) if (Number.isFinite(s[key])) $(id).value=clamp(s[key],lo,hi);
  for (const [key,id,lo,hi] of [['bankWidth','bank-width',0,100],['beachFlatness','beach-flatness',0,100],['softness','softness',0,100],['scree','scree',0,100],['relief','relief',0,160],['mineralRing','mineral-ring',0,100],['ringSpread','ring-spread',0,100],['ringVariation','ring-variation',0,100],['materialWeathering','material-weathering',0,100],['depositSpread','deposit-spread',0,100],['transitionDetail','transition-detail',0,100]]) if (Number.isFinite(s[key])) $(id).value=clamp(s[key],lo,hi);
  $('shallow-mode').value=s.shallowMode==='area'?'area':'passage';
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
function addGroundNode() {
  const amplitude=experiment.has('undulation')?Number(experiment.get('undulation')):10;
  if (amplitude>0) addNode({kind:'ground',amplitude,wavelength:experiment.has('undulationScale')?Number(experiment.get('undulationScale')):200,coverage:experiment.has('undulationCover')?Number(experiment.get('undulationCover')):.45,seed:seed^0x9e37});
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
editorUI.onMode(kind=>{if(selected>=0&&nodes[selected]?.params){changeSelected(n=>{n.kind=kind;});}else document.querySelector(`[data-tool="${kind}"]`)?.click();});
for (const b of document.querySelectorAll('[data-tool]')) b.addEventListener('click',() => {
  if(stroke||moving)return;mapFeatures?.deactivate();rememberTool();tool=b.dataset.tool;drawMode=tool==='move'?'select':'new';pathAdding=false;
  if(tool==='move'&&selected>=0)selectNode(selected);
  else{selected=-1;pathPoint=-1;renderLayers();showTool(toolSettings[tool]);}
  updateControls();schedule();persistLater();
});
for (const id of ['diameter','amount','roughness','shelves','bank-width','beach-flatness','softness','cracks']) $(id).addEventListener('input',() => { rememberTool(true); updateControls(); schedule(); persistLater(); if (selected>=0) editSelectedFromControls(); });
for (const id of ['diameter','amount','roughness','shelves','bank-width','beach-flatness','softness','cracks']) $(id).addEventListener('change',() => { if (selected>=0) { checkpoint(); queueWeather(); } });
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
$('draw-new').onclick=()=>{if(stroke||moving||loading)return;const candidate=nodes[selected]?.kind||tool,kind=HELP[candidate]&&candidate!=='move'?candidate:'plateau';document.querySelector(`[data-tool="${kind}"]`)?.click();};
$('draw-add').onclick=()=>{if(stroke||moving||loading||!nodes[selected]?.points||nodes[selected].hidden)return;drawMode='add';pathEditing=false;pathAdding=false;pathPoint=-1;updateControls();schedule();};
for(const [id,value] of [['rotate-left',-Math.PI/12],['rotate-right',Math.PI/12],['scale-down',1/1.1],['scale-up',1.1]])$(id).onclick=()=>changeSelected(n=>transformNode(n,nodeState(n),about(nodePivot(n),id.startsWith('rotate')?rotation(value):scaling(value))));
document.addEventListener('terraform-feature-mode',()=>updateControls());
$('tool-style').addEventListener('change',() => {
  const preset=$('tool-style').value;if(!Object.hasOwn(TOOL_PRESETS,preset))return;
  const kind=nodes[selected]?.kind||tool;toolSettings[tool]=toolDefaults(kind,preset);showTool(toolSettings[tool],kind);
  if(selected>=0){editSelectedFromControls();checkpoint();queueWeather();}
  updateControls();schedule();persistLater();
});
for (const id of ['relief','transition-detail']) $(id).addEventListener('input',() => { markViewChanged(); updateControls(); schedule(); persistLater(); });
for (const id of ['mineral-ring','ring-spread','ring-variation']) $(id).addEventListener('input',() => { markViewChanged(); updateControls(); schedule(); persistLater(); });
for(const id of ['material-weathering','deposit-spread']) $(id).addEventListener('input',()=>{markViewChanged();updateControls();schedule();queueWeather();persistLater();});
$('shallow-mode').addEventListener('change',() => { rememberTool(true); updateControls(); persistLater(); if (selected>=0) { editSelectedFromControls(); checkpoint(); queueWeather(); } });
$('scree').addEventListener('input',() => { markViewChanged(); updateControls(); schedule(); queueWeather(); persistLater(); });
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
  if(nodes[selected]?.seed!==undefined&&nodes[selected].seed!==next)changeSelected(n=>{n.seed=next;});
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
      if (lift) { if (n.params && !['deep','shallow','ramp','erase'].includes(n.kind)) n.params={...n.params,amount:clamp(n.params.amount+lift,...amountRange(n.kind))}; return; }
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
  ['Faces', [['hillLight','Hill cover brightness (Archipelago)',.6,1.6,.01,1],['ringFade','Mineral ring fade length (Archipelago)',0,2,.05,0],['faceFill','Fill light on shaded faces',0,.5,.02,0],['rockCrown','Bare rock to the crown',0,1,.05,0],['sandCrown','Painted sand to the crown (sand bars)',0,1,.05,0],['slopeTexture','Sampled slope texture',0,1,.05,.3],['faceEdge','Edge breakup',0,2,.05,.8],['gullyRock','Rock in gullies',0,2,.05,.5],['moss','Moss from ground',0,1,.05,0],['crevice','Crevices',0,1,.05,0],['slopeMarks','Dark marks on slopes (Moon)',0,1,.05,0],['wrinkles','Joined wrinkles on slopes (Moon)',0,1,.05,0]]],
  ['Shine', [['shineStretch','Grain streak length (x its width)',1,8,.25,1],['shineWhite','Highlight whiteness (0 material hue, 1 white)',0,1,.05,.35]]],
  ['Shine: ground', [['shineGround','Gloss (highlight strength)',0,2,.05,0],['shineGroundSharp','Sharpness (lobe exponent)',2,200,2,24],['shineGroundRough','Roughness (grain slope)',0,2,.05,0],['shineGroundScale','Grain width (px)',1,24,.5,6]]],
  ['Shine: slope cover', [['shineSlope','Gloss (highlight strength)',0,2,.05,0],['shineSlopeSharp','Sharpness (lobe exponent)',2,200,2,24],['shineSlopeRough','Roughness (grain slope)',0,2,.05,0],['shineSlopeScale','Grain width (px)',1,24,.5,6]]],
  ['Shine: rock', [['shineRock','Gloss (highlight strength)',0,2,.05,0],['shineRockSharp','Sharpness (lobe exponent)',2,200,2,24],['shineRockRough','Roughness (grain slope)',0,2,.05,0],['shineRockScale','Grain width (px)',1,24,.5,6]]],
  ['Shine: sand', [['shineSand','Gloss (highlight strength)',0,2,.05,0],['shineSandSharp','Sharpness (lobe exponent)',2,200,2,24],['shineSandRough','Roughness (grain slope)',0,2,.05,0],['shineSandScale','Grain width (px)',1,24,.5,6]]],
  ['Shine: crystal', [['shineCrystal','Gloss (highlight strength)',0,2,.05,0],['shineCrystalSharp','Sharpness (lobe exponent)',2,200,2,24],['shineCrystalRough','Roughness (grain slope)',0,2,.05,0],['shineCrystalScale','Grain width (px)',1,24,.5,6]]],
  ['Boulders', [['boulders','Density',0,1,.05,0],['boulderSize','Size (px)',4,24,1,9],['boulderFoot','From cliff feet',0,1,.05,.5],
    ['boulderCluster','Clustering',0,1,.05,.6],['boulderMoss','Mossy tops',0,1,.05,.35],['boulderRound','Roundness',0,1,.05,0]]],
  ['Debris', [['debris','Amount',0,1,.05,0],['debrisReach','Reach (px)',16,128,4,48],['debrisSize','Size (px)',3,12,1,6],['debrisSort','Sorting',0,1,.05,.8],['repose','Rest slope',.3,1,.05,.6]]],
  ['Sand', [['sand','Weathering supply',0,2,.05,0],
    ['wind','Wind toward (deg)',0,360,5,20],['sandDust','Dusting tint',0,1,.05,.5],['sandGrass','Grass regrowing over sand',0,1,.05,.6],['sandLight','Weathered lightness',0,1,.05,.25],['sandGrain','Rock grain in sand',0,1,.05,.8],
    ['ripple','Ripple length (px)',0,16,1,7],['rippleHeight','Ripple height',0,3,.1,1.4]]],
  ['Cracks', [['crackSeverity','Depth',0,1,.05,.6],['crackSpacing','Block size (px)',16,96,2,40],
    ['crackMajor','Major cracks',0,1,.05,.8],['crackMinor','Minor cracks',0,1,.05,.75],['crackHairline','Hairline crazing',0,1,.05,.6],['crackBlocks','Facets (block relief)',0,1.5,.05,.6],
    ['crackWidth','Width (px)',.5,2.5,.1,1],['crackNetwork','Majors: rills to plates',0,1,.05,.35],
    ['crackDark','Floor darkness',0,1,.05,.75]]],
  ['Rock structure', [['rockOrder','Order (0 scattered, ink cracks; 1 beds, joints, lit relief cracks)',0,1,.05,0],['rockFrom','Beds and joints from slope (painted rock always)',.3,2,.05,.6],['bedSpacing','Bed thickness (px along the ground, or height units)',3,80,1,12],['bedHeight','Beds spaced by height (0 px along the ground)',0,1,.05,0],['bedVary','Bed thickness variation',0,1,.05,.5],
    ['bedDip','Bed tilt (height per px; 2 north: level rows)',-4,4,.05,0],['bedDipDir','Bed tilt toward (deg, 0 east, 90 south)',0,360,5,90],['bedLedge','Ledge step strength',0,1,.05,.5],
    ['jointDepth','Joint depth (height)',0,6,.1,2],['grooveSpacing','Joint and gully spacing (px)',12,120,2,36],['grooveAngle','Joint and gully lean from north-south (deg)',-60,60,1,0],['grooveRun','Joint and gully length (px)',30,400,10,120]]],
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
  ['Rock face: facets', [['facetTilt','Facet tilt (height per px; 0 none)',0,2,.05,0],['facetCoarse','Coarser second level of facets (share)',0,1.5,.05,0]]],
  // G2: rock faces follow the slope; every default is the earlier look.
  ['Rock face: follows the slope', [['cliffFollow','Beds on the contours, joints down the fall line (0 fixed screen directions)',0,1,1,0],['cliffReach','Fall line smoothing radius (px)',6,60,1,20],['cliffWide','Wide fall line radius, level ground under rock (px)',20,160,2,56],['cliffFlat','Slope under which structure fades into broken rock',0,.3,.005,.04],['cliffRise','Bed riser height (units; 0 the bed\'s own)',0,40,1,0],['cliffBed','Beds follow the smoothed ground (0 the grid\'s own bumps)',0,1,.05,.5],['cliffStagger','Joints offset from bed to bed (share of spacing)',0,.8,.05,0],['cliffFine','Third, finer facet level (share of tilt)',0,1.5,.05,0],['cliffDomain','Joint lattice patch size (px)',30,240,5,90]]],
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
const COLOR_KEYS=[['ground','Ground'],['slope','Slope cover'],['rock','Rock'],['sand','Sand'],['beach','Beach'],['shallow','Shallow water'],['deep','Deep water'],['crystal','Crystal'],['strata1','Strata 1'],['strata2','Strata 2'],['strata3','Strata 3'],['strata4','Strata 4'],['strata5','Strata 5']];
let worlds={},worldId=null;
function loadWorlds() { try { worlds=JSON.parse(localStorage.getItem(WORLD_STORE)||'{}')||{}; } catch (_) { worlds={}; } }
function saveWorlds() { try { localStorage.setItem(WORLD_STORE,JSON.stringify(worlds)); } catch (_) {} }
// A variant's colors (card C5) stay in config.colors; the world keeps only its base ones, so choosing a variant never writes into the world's own store.
function activeWorld() { return worlds[worldId] ??= {name:config.biome,base:config.biomeId,colors:{...(config.baseColors||config.colors||{})},knobs:{}}; }
const hexColor=c => '#'+c.map(v => Math.round(clamp(v,0,1)*255).toString(16).padStart(2,'0')).join('');
const rgbColor=h => [1,3,5].map(i => parseInt(h.slice(i,i+2),16)/255);
// A world's colors: the server's defaults for its base world, then the
// world's own choices; null means explicitly off (the texture's own color).
function mergedColors() { return {...(config.colors||{}),...(activeWorld().colors||{})}; }
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
    crystal:(config.material?.crystalRGB||[110,150,225]).map(v => v/255),strata1:strata[0],strata2:strata[1],strata3:strata[2],strata4:strata[3],strata5:strata[4]}[key]||[.5,.5,.5];
}
function goToWorld(base,id,extra) {
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
    const apply=() => { if (box.checked) world.colors[key]=pick.value; else if (config.colors?.[key]) world.colors[key]=null; else delete world.colors[key]; saveWorlds(); renderer.setColors(worldColors()); markViewChanged(); schedule(); };
    box.addEventListener('change',apply); pick.addEventListener('input',() => { box.checked=true; apply(); });
    rows.append(row);
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
  $('world-reset').onclick=() => { world.colors={...(config.colors||{})}; saveWorlds(); buildWorldPanel(); renderer.setColors(worldColors()); markViewChanged(); schedule(); };
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
      worlds[id]={name:w.name,base:w.base,flowColors:(Array.isArray(w.flowColors)?w.flowColors:[]).filter(v => /^#[0-9a-f]{6}$/i.test(v)).slice(0,12),colors:Object.fromEntries(Object.entries(w.colors||{}).filter(([,v]) => v===null || /^#[0-9a-f]{6}$/i.test(v))),knobs:Object.fromEntries(Object.entries(w.knobs||{}).map(([k,v]) => [k,String(v)]))};
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
// A deep or shallow stroke's own water choices, which turn the hard step, the ramp and the lit bed on inside its footprint whatever the world says (engine-frag.wgsl's `pick`).
function strokeWaterPicks() {
  const water=nodes.filter(n=>['deep','shallow'].includes(n.kind)),picked=(key,...choices)=>water.some(n=>choices.includes(Math.round(n.params?.[key]||0)))?1:0;
  return {deepEdge:picked('waterDeep',1),fadedEdge:picked('waterDeep',2),bedLit:picked('waterBed',1,3),crackedBed:picked('waterBed',3)};
}
// How many tones the world's water has: 1 where shallow and deep are one colour, 3 where a third colour follows the depth, else 2.
function waterTones() {
  const w=config.water||{};
  return w.midRGB&&config.material?.midDepth?3:w.shallow===w.deep&&String(w.shallowRGB)===String(w.deepRGB)?1:2;
}
// What worldControlRequirement may read: the renderer's settings, a stroke's water choices counted as the switch they turn on, and the facts of the world's material that no slider sets.
function worldPanelValues() {
  const layers=config.layers||[],own=Object.fromEntries(renderer.variant),picks=strokeWaterPicks();
  return {...own,deepEdge:Math.max(Number(own.deepEdge)||0,picks.deepEdge),bedLit:Math.max(Number(own.bedLit)||0,picks.bedLit),rampWater:Number(own.deepEdge)>0?picks.fadedEdge:1,crackedBed:picks.crackedBed,waterTones:waterTones(),waterTinted:own.water==='tinted'?1:0,column:config.column?.sections?1:0,capBed:columnHasCapBed(config.column,config.variant)?1:0,ringLayer:layers.includes('ring')?1:0,beachLayer:layers.includes('beach')?1:0,groundTiled:renderer.groundTiled?1:0,slopeSand:config.material?.slopeSand?1:0};
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
  if (['frostGaps','frostGapReach','frostGapSize','frostGapDepth'].includes(key)) { cancelWeather();evaluate(0);queueWeather();return; }
  // Deposit supply changes the generated deposit field.
  if (['sand'].includes(key)) { cancelWeather(); queueWeather(); }
}
async function bootMap() {
  worldSize=config.worldSize??config.size; worldGrid=config.worldGrid??config.grid;
  size=worldSize; grid=worldGrid; spacing=(worldSize-1)/(worldGrid-1);
  // Outside a scoped regional replay, only the graph and empty placeholders
  // exist. In particular, opening a 40×40 map allocates no world field planes.
  seed=Number($('seed').value); refinementSeed=seed; regionalFields=makeRegionalFields();
  regionalFields.subscribeSubmit(change=>{
    if(regionalFields.paged)return;
    const r=change.rect,rect=r?{x0:Math.floor(r.x/spacing),y0:Math.floor(r.y/spacing),x1:Math.ceil((r.x+r.width)/spacing),y1:Math.ceil((r.y+r.height)/spacing)}:null;
    if(gpuWeather)gpuWeather.invalidRect=invalidateRefinement(gpuWeather.invalidRect,rect,worldGrid);
    if(refined)refinedInvalidRect=invalidateRefinement(refinedInvalidRect,rect,worldGrid);
  });
  addGroundNode();
  mapCanvas=await mountMapCanvas({config,canvas,overlay,api:sculptRegion,drawOptions:currentDrawOptions});
  if (regionalFields.paged) { pagedCoarseStarted=true; regionalFields.subscribe(() => mapCanvas.schedule()); regionalFields.startCoarse().catch(() => {}); }   // H5b: the overview's coarse lattice fills in the background
  renderer=mapCanvas.renderer; renderer.onerror=message => error(message); renderer.setColors(worldColors());$('export').textContent='Export view PNG';
  buildKnobs(); buildWorldPanel();
  syncColumnPanel=mountColumnPanel(()=>({column:columnForEdit(),variant:config.variant,edited:Boolean(columnOverride)}),editColumn,commitColumn,()=>{editColumn(null);commitColumn();});
  $('scree').value=clamp(Number(experiment.get('scree'))||0,0,100);
  let saved=null; try { if (!experiment.has('scratch')) saved=localStorage.getItem(LOCAL_KEY); } catch (_) {}
  if (saved) { try { loadSketch(JSON.parse(saved)); status('Restored your saved map recipe.'); } catch (err) { error('Saved map could not be loaded: '+err.message+' The saved copy is retained until you edit.'); } }
  else status('Blank map ready · draw terrain with the existing tools.');
  ready=true; $('editor').disabled=false; $('world-editor').disabled=false;
  history=[{nodes:cloneNodes(),refinementSeed,mapData:mapData(),column:structuredClone(columnOverride),terrainKey:++historySerial}]; historyIndex=0; renderLayers();
  const pending=await takePendingSketch(experiment.get('pendingSketch'));
  if (pending) { try { loadSketch(pending); checkpoint(); status('Loaded the saved map.'); } catch (err) { error('The handed-over terrain could not be loaded: '+err.message); } }
  $('levels').textContent=`Dry base ${config.baseHeight} · sea ${config.seaLevel} · heights ${MIN_HEIGHT}…${MAX_HEIGHT}`;
  updateControls(); resize(); schedule(); queueWeather();
}
async function boot() {
  try {
    const response=await fetch('/sculpt-config.json?'+new URLSearchParams([...(experiment.has('biome')?[['biome',experiment.get('biome')]]:[]),...(experiment.get('variant')?[['variant',experiment.get('variant')]]:[])])); if (!response.ok) throw new Error('Could not load the sculpt configuration.'); config=await response.json();
    defaultColumn=config.column;
    // H12b: the editor always works on a map; an address without a size opens the default 4x4 one.
    if (!experiment.has('mapX') && !experiment.has('mapY')) { experiment.set('mapX','4'); experiment.set('mapY','4'); }
    {
      const response=await fetch('/map-catalog.json'),data=await response.json(); if (!response.ok) throw new Error(data.error||'Could not read map defaults from the installed content.');
      config.exportCatalog=data; config.defaultSeaLevel=config.exportCatalog.worlds[config.biomeId]?.defaultSeaLevel;
    }
    configureMap(config,experiment); MIN_HEIGHT=config.seaLevel-90; MAX_HEIGHT=config.seaLevel+300;
    if ((!config.map && config.size!==1024) || !Number.isInteger(config.grid) || config.grid<2 || config.grid>(config.map?16384:1024) || !Number.isFinite(config.baseHeight) || !Number.isFinite(config.seaLevel)) throw new Error('Unsupported sculpt configuration.');
    if (config.biomeId && config.biomeId!=='green') LOCAL_KEY+='-'+config.biomeId;
    if (config.variant) LOCAL_KEY+='-v-'+config.variant;
    if (config.map) LOCAL_KEY+=`-map-${config.map.unitsX}x${config.map.unitsY}-sea-${config.seaLevel}`;
    document.querySelector('.canvas-caption h2').textContent=(config.biome||'Green Planet')+' terrain';
    // The world: built-in (the biome itself) or a custom one based on it.
    // Its remembered settings come before the biome's own defaults.
    loadWorlds();
    worldId=experiment.has('world') && worlds[experiment.get('world')]?.base===config.biomeId?experiment.get('world'):config.biomeId;
    if (worldId!==config.biomeId) LOCAL_KEY+='-'+worldId;
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
    return {grid:G,planes,mismatches,gpuShape:true};
  } finally { engine.destroy(); }
}
window.sculptDebug = {curve:() => currentCurve(),pageInfo:() => regionalFields?.pageInfo?.()??null,shapeCompare,shape:() => ({fields:regionalFields?.stats?.().gpuShape??null,fieldsReason:regionalFields?.reason?.()??null}),corner:(x,y) => regionalFields?{eroded:sampleRegional(x,y),authored:regionalFields.sample(x,y)}:null,regionalCheck:gpuRegionalCheck,state: () => ({tool, stroke: Boolean(stroke), moving: Boolean(moving), selected, pointerId, pan: Boolean(pan)}), bakeMs: (quality='full') => renderer.timeBake(quality), get bakeGpuMs() { return renderer.lastBakeGPU; }, get engine() { return renderer.engine; }, get startupMs() { return renderer.startupMs; }, remakeMaterials: () => renderer.makeMaterials(), readGenerated: (layer, level) => renderer.readGenerated(layer, level), get startupParts() { return renderer.startupParts; },
  drawMs: (quality='full') => renderer.timeDraw({quality,clay:$('clay').checked,light:$('light').value,scree:Number($('scree').value)/100,detail:Number($('relief').value)/100,ring:Number($('mineral-ring').value)/100,ringSpread:Number($('ring-spread').value)/100,ringVariation:Number($('ring-variation').value)/100,materialWeathering:Number($('material-weathering').value)/100,transitionDetail:Number($('transition-detail').value)/100}),
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
