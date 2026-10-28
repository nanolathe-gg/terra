import {TerrainRenderer} from './sculpt-renderer.js';
import {quickMaterialField} from './sculpt-material-weathering.js';
import {configureMap,resizeMap,drawMapBounds,exportMapField} from './sculpt-map.js';
import {mountMapExport} from './sculpt-export.js';

// Offline authoring policy. These brushes are new geometry, not retail rules.
const $ = id => document.getElementById(id);
const canvas = $('terrain'), overlay = $('overlay'), ink = overlay.getContext('2d');
const experiment = new URLSearchParams(location.search);
let LOCAL_KEY = 'nanolathe-terrain-sculpt-v3' + (experiment.has('scratch')?'-'+experiment.get('scratch'):'');
const NATURAL_COAST = experiment.get('coast')!=='restrained';
const MIN_HEIGHT = -90, MAX_HEIGHT = 300;
const HELP = {
  plateau:'Paint a level crest above the height where this stroke begins. New strokes can build on top.',
  hill:'Paint a rounded ridge along any path. A later stroke adds more height to the existing ground.',
  mountain:'Paint a narrower, peaked ridge. New strokes add to the existing height, without a flat summit.',
  ramp:'Draw between terrain levels. A smooth centre joins the endpoint heights with rounded approaches; shoulder roughness stays outside the route. Longer paths make gentler grades.',
  deep:NATURAL_COAST?'Guide a deep channel. Coast freedom varies the banks; Automatic shallows controls extra shelves. The centre stays deep until you paint over it.':'Set the bed 55 below sea level. A whole stroke has one depth; holding still does not keep digging.',
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
  move:'Click a shape to select it; drag to move it, Shift+drag up or down to change its height. Drag the round handle to rotate and the square one to scale, or use , . and [ ]. Delete removes it.'
};
let mapUpdate=() => {};
let config, renderer, heights, protection, routes, cracks, cover, crystal, maskPlanes, grid, size, spacing, noise;
let weatherWorker, weatherJob=0, weatherBase=null, refined=null, refinedBase=null, weatherState='pending';
let tool='plateau', seed=2701, refinementSeed=2701, stroke=null, pan=null, cursor=null, space=false, pointerId=null, loading=false;
let history=[], historyIndex=-1, framePending=false, heightDirty=true, needsDraw=true;
let revision=0, renderedRevision=-1, fitView=true, autosaveTimer, ready=false;
let paintingIntervals=[],lastPaintingRAF=null,draft=false;
let lastWaterStroke=null;
// Biomes choose starting values for the same brushes. These presets can be
// borrowed independently of the canvas materials and then edited per tool.
const TOOL_PRESETS={
  green:{crater:{roughness:60},plateau:{roughness:40},hill:{roughness:35},mountain:{roughness:45},ramp:{roughness:18},deep:{roughness:45},shallow:{roughness:18}},
  red:{crater:{roughness:65,softness:40},plateau:{roughness:50,softness:35},hill:{roughness:50,softness:40},mountain:{roughness:55,softness:30},ramp:{roughness:22},deep:{roughness:55,bankWidth:38,shelves:45},shallow:{roughness:25}},
  desert:{crater:{roughness:55,softness:55,cracks:10},plateau:{roughness:30,softness:100,diameter:560,amount:67,cracks:10,profile:1,apronPx:80,apronHeight:25,facePx:130,faceCurve:0},hill:{roughness:45,softness:62,cracks:10},mountain:{roughness:50,softness:50,cracks:10},offset:{cracks:10},ramp:{roughness:18},deep:{roughness:50},shallow:{roughness:20}},
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
// card startStroke builds, strokeParams and KNOB_DEFAULTS (sculpt.py).
const SECTION_KINDS=['plateau','offset','hill','mountain','deep','shallow'];
// Line features (card C4): spurs, crest variation and crater rim sectors. All
// default off; spurs and crest options turn a hill or mountain into a ridge
// built from tapering pieces (ridgePieces), rim options reshape a crater's rim.
const RIDGE_KEYS=['spurCount','spurLength','spurSpread','spurWidth','spurTaper','spurHeight','spurForks','spurBulb','crestJag','crestVary','crestTaper','rimHeight','rimSectors','rimUnequal','rimGaps','rimGapWidth'];
const ridgeOn=(kind,o) => (kind==='hill' || kind==='mountain') && (Math.round(o.spurCount)>=1 || o.crestJag>0 || o.crestVary>0 || o.crestTaper>0);
// Placed fissures (card C4 stage 2): the Fissure tool and its options. Depth is
// the stroke's own amount; the rest are shape options kept in the shape.
const FISSURE_KEYS=['fissureWidth','fissureJag','fissureBranches','fissureBranchLen','fissureBranchSpread','fissureTaper','fissureNetwork','fissureCell','fissureCrack','fissureDark'];
const SECTION_KEYS=['profile','apronPx','apronHeight','facePx','faceCurve','terraces','ledge','terraceJitter','lip','crown','shelfPx','shelfDepth','shelfSteps'];
// Painted masks (card C5): nine signed-byte planes per cell, where 0 changes
// nothing: rock, snow or ice, wet ground and moss (0..127 of full), scatter
// density, and four local style settings (stage 2: relief strength, cracks,
// banding and face rock share, each -127..127 about the world's own value).
// 'paint' is the brush; the landforms below can also paint inside their own
// footprint (maskChannel, and styleRelief .. styleFace).
// Card E1 adds five more: the water choices of a deep or shallow stroke (shore
// edge, shallow-to-deep edge, bed; +127 hard / lit bed, -127 faded / noise
// water), painted ground lumps (+127 more, -127 fewer) and the cracked-bed flag.
const MASK_KEYS=['mr','ms','mw','mm','md','ml','mc','mb','mf','mx','my','mz','mg','mk'];
const WATER_KEYS=['waterShore','waterDeep','waterBed'];
const MASK_SHAPES=['plateau','offset','hill','mountain','crater','deep','shallow'];
const MASK_CHOICES=[[1,'Rock'],[2,'Snow or ice'],[3,'Wet or dark ground'],[4,'Moss'],[5,'Denser scatter'],[6,'Sparser scatter']];
const LUMP_CHOICES=[[16,'Ground lumps'],[17,'Smoother ground']];
const STYLE_CHOICES=[[8,'Relief stronger'],[9,'Relief weaker'],[10,'Cracks more'],[11,'Cracks fewer'],[12,'Banding more'],[13,'Banding less'],[14,'Face: more rock'],[15,'Face: less rock']];
const STYLE_KEYS=['styleRelief','styleCracks','styleBanding','styleFace'];
// [key, element id, label, kinds, slider min, max, step, slider units per value, help, drop-down choices]
const SHAPE_FIELDS=[
  ['craterlets','craterlets','Craterlets',['crater'],0,12,1,1,'Small satellite craters round the rim.'],
  ['craterEjecta','crater-ejecta','Ejecta',['crater'],0,100,5,100,'Ragged patches of throw-out beyond the rim.'],
  ['faceVariation','face-variation','Face width variation',['plateau','offset','erase',...SECTION_KINDS.slice(2)],0,150,5,100,'How much the edge face widens and narrows along the outline (with Cross-section 1, every width of the profile).'],
  ['mesaFlank','mesa-flank','Mesa flanks',['plateau'],0,100,5,100,'A narrower cap with a sharp edge and wide, even flanks to a concave foot (Painted Desert mesas).'],
  ['northFace','north-face','Wider north faces',['plateau','offset'],0,100,5,100,'TA\'s view squashes faces that look north; this widens them.'],
  ['fingers','fingers','Finger coasts',['deep','shallow'],0,150,5,100,'Interlocking land fingers and inlets along the shore.'],
  ['fingerBlunt','finger-blunt','Blunt fingers (0 pointed, 1 thumbs)',['deep','shallow'],0,1,1,1,'Fingers as retail Lava draws them: 25-35 px thumbs with rounded tips and inlets, not pointed teeth.'],
  ['bankPx','bank-px','Dry bank (px)',['deep','shallow'],0,160,2,1,'Width of the dry bank from the waterline to the level ground, whatever the shape\'s size (0: a share of the shape, set by Bank width).'],
  ['profile','sec-profile','Cross-section (0 classic, 1 parametric)',SECTION_KINDS,0,1,1,1,'0 keeps this kind\'s own curve. 1 builds the profile from the options below, in pixels from the outer edge, so it keeps its size whatever the brush diameter. Mesa flanks, Wider north faces and Beach flatness are then ignored; Slope softness and (on water) Dry bank only set the default face width.'],
  ['apronPx','sec-apron-px','Apron width (px)',SECTION_KINDS,0,160,2,1,'A gentle concave skirt at the foot (talus, desert aprons; on water, the beach at the waterline).'],
  ['apronHeight','sec-apron-height','Apron height',SECTION_KINDS,0,60,5,100,'Share of the whole rise (of the bank, on water) reached at the apron\'s top.'],
  ['facePx','sec-face-px','Face width (px)',SECTION_KINDS,0,240,2,1,'Width of the steep face above the apron (0: a share of the brush set by Slope softness; on water, from Dry bank).'],
  ['faceCurve','sec-face-curve','Face curve (− concave, + convex)',SECTION_KINDS,-100,100,5,100,'Concave: a soft foot and a crisp top edge. Convex: a crisp foot and a rounded shoulder.'],
  ['terraces','sec-terraces','Terraces',SECTION_KINDS,0,8,1,1,'Cut the face into this many flat ledges with risers between them.'],
  ['ledge','sec-ledge','Ledge (flat share of a step)',SECTION_KINDS,0,90,5,100,'How much of each step is flat; the rest is the riser.'],
  ['terraceJitter','sec-terrace-jitter','Terrace variation',SECTION_KINDS,0,100,5,100,'How much riser positions and step heights wander along the outline.'],
  ['lip','sec-lip','Lip (units; − rounds the edge)',SECTION_KINDS,-30,30,1,1,'A raised rim at the top of the face; a negative value rounds the edge off.'],
  ['crown','sec-crown','Crown roundness',['hill','mountain'],0,100,5,100,'The cap above the face: 0 is a point (or flat, with a short Face width); 100 a wide rounded dome.'],
  ['shelfPx','sec-shelf-px','Shelf width (px)',['deep','shallow'],0,200,2,1,'A submerged shelf between the waterline and the drop to the bed.'],
  ['shelfDepth','sec-shelf-depth','Shelf depth (units below sea)',['deep','shallow'],0,30,1,1,'How far below the sea the shelf lies (never deeper than the bed).'],
  ['shelfSteps','sec-shelf-steps','Shelf steps',['deep','shallow'],0,6,1,1,'0: one sloping bench; more: layered flat shelves, one below another.'],
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
  ['plateMaterial','plate-material','Plate material (0 ice floes, 1 rock slabs)',['deep','shallow','offset'],0,1,1,1,'0: white and blue floes with open gaps (Ice Scream). 1: low flat rock slabs that interlock along the shore with dark seams between them, and a shallow ledge under the water (Crystal). The band follows this stroke\'s own waterline, so separate shores stay separate.'],
  ['crystalForm','crystal-form','Form (0 crystals, 1 column mound)',['crystal'],0,1,1,1,'Crystals: separate faceted crystals (shards, or big blocks as on Ice). Column mound: a mound tiled with flat polygonal columns (Crystal world).'],
  ['crystalTiers','crystal-tiers','Stepped column tops',['crystal'],0,100,5,100,'Remove the mound incline from each column top so its height steps distinctly from its neighbours.'],
  ['crystalSides','crystal-sides','Sides',['crystal'],3,10,1,1,'Sides of each crystal\'s footprint (crystals form; columns are Voronoi, mostly 5-6 sides).'],
  ['crystalSize','crystal-size','Crystal width (px)',['crystal'],6,640,2,1,'Crystals: typical base width. Column mound: column top width (retail ~15).'],
  ['crystalStep','crystal-step','Column step',['crystal'],0,64,1,1,'Column mound: how far a column top steps up or down from its neighbours (retail ~16; ~40% flush).'],
  ['crystalCount','crystal-count','Crystals per cluster',['crystal'],1,40,1,1,'How many crystals a click grows; a longer stroke grows more.'],
  ['crystalTop','crystal-top','Flat tops',['crystal'],0,95,5,100,'0: pointed; higher cuts the tops level (a flat-topped prism).'],
  ['crystalLean','crystal-lean','Lean',['crystal'],0,100,5,100,'How far each apex leans off its base centre.'],
  ['crystalVariation','crystal-variation','Variation',['crystal'],0,100,5,100,'Spread of sizes, heights and side counts.'],
  // Water looks (card E1): each stroke may keep the world's choice (0) or set its own.
  ['waterShore','water-shore','Shore edge (shore to shallow)',['deep','shallow'],0,2,1,1,'World default keeps the World panel\'s Crisp waterline. Hard: the water starts at the shoreline with ragged stairs, as retail draws it. Faded: the water fades in over a few pixels.',[[0,'World default'],[1,'Hard'],[2,'Faded']]],
  ['waterDeep','water-deep','Shallow-to-deep edge',['deep','shallow'],0,2,1,1,'World default keeps the World panel\'s Shallow-to-deep step. Hard: the shallow colour stops at one depth with ragged stairs (retail Green). Faded: the colour follows the depth ramp gradually (retail Archipelago).',[[0,'World default'],[1,'Hard'],[2,'Faded']]],
  ['waterBed','water-bed','Shallow water look',['deep','shallow'],0,3,1,1,'World default keeps the World panel\'s Lit bed. Lit bed: the ground under the water, lit by the same sun and tinted (retail). Noise water: the earlier flat noise texture. Cracked bed: lit bed over cracked rock-like ground, tinted (Red\'s shelf shallows).',[[0,'World default'],[1,'Lit bed'],[2,'Noise water'],[3,'Cracked bed']]],
  ['paintChannel','paint-channel','Paint',['paint'],1,17,1,1,'What the brush paints. Denser scatter supplies its own stones where the World panel\'s Boulders and Debris are 0 and multiplies them where they are not. Style settings go more or less than the world\'s own value; Strength is how far. Erase clears every mask and style under the brush.',[...MASK_CHOICES,...LUMP_CHOICES,...STYLE_CHOICES,[7,'Erase all masks and style']]],
  ['maskChannel','mask-channel','Paint inside the shape',MASK_SHAPES,0,6,1,1,'Also paint a mask over the shape\'s own footprint, strongest where the shape is (a rocky mesa, a mossy hill).',[[0,'Off'],...MASK_CHOICES]],
  ['maskAmount','mask-amount','Shape paint strength',MASK_SHAPES,5,100,5,100,'How fully the shape paints its mask.'],
  // Local style inside the shape (card C5 stage 2): each is a change about the world's own value, 0 none.
  ['styleRelief','style-relief','Style: relief strength',MASK_SHAPES,-100,100,5,100,'Relief (ribs, lumps) inside the shape: below 0 smoother, above 0 stronger, up to 4x.'],
  ['styleCracks','style-cracks','Style: cracks',MASK_SHAPES,-100,100,5,100,'Cracks inside the shape: below 0 fewer, above 0 more (also where the world has none).'],
  ['styleBanding','style-banding','Style: banding',MASK_SHAPES,-100,100,5,100,'Contour banding inside the shape: below 0 fainter, above 0 stronger (also where the world has none).'],
  ['styleFace','style-face','Style: face rock',MASK_SHAPES,-100,100,5,100,'Share of rock on steep faces inside the shape: below 0 more grass and moss, above 0 more rock.'],
];
for (const [key,id,,,lo,hi] of SHAPE_FIELDS) TOOL_FIELDS[key]=[id,lo,hi];
const worldDefault=key => { const v=Number(config?.defaults?.[key]); return Number.isFinite(v)?v:0; };
// Values a replayed shape uses for options it was drawn without.
const shapeDefaults=() => Object.fromEntries(SHAPE_FIELDS.map(([key]) => [key,worldDefault(key)]));
const shapeValue=key => { const f=SHAPE_FIELDS.find(f => f[0]===key); return Number($(f[1]).value)/f[7]; };
function buildShapeOptions() {
  const root=$('shape-options');
  root.replaceChildren(...SHAPE_FIELDS.map(([key,id,label,,lo,hi,step,,help,choices]) => {
    const wrap=document.createElement('div'); wrap.className='control'; wrap.id=id+'-control';
    const input=choices?`<select id="${id}" style="width:100%">${choices.map(([v,l]) => `<option value="${v}">${l}</option>`).join('')}</select>`:`<input id="${id}" type="range" min="${lo}" max="${hi}" step="${step}">`;
    wrap.innerHTML=`<label for="${id}">${label} <output id="${id}-value"${choices?' hidden':''}></output></label>${input}<p class="small">${help}</p>`;
    return wrap;
  }));
  // The cross-section preview sits right under its switch (card C1).
  const preview=document.createElement('div'); preview.className='control'; preview.id='section-preview-control'; preview.hidden=true;
  preview.innerHTML='<canvas id="section-preview" width="222" height="84" style="width:100%;background:#172119;border:1px solid #465344;border-radius:4px"></canvas><p class="small">Cross-section, foot to cap (water: bank top to bed), before the outline noise.</p>';
  root.children[SHAPE_FIELDS.findIndex(f => f[0]==='profile')].after(preview);
  for (const [,id] of SHAPE_FIELDS) $(id).addEventListener('input',() => { rememberTool(true); updateControls(); schedule(); persistLater(); if (selected>=0) editSelectedFromControls(); });
  // Releasing a shape option finalizes the edit like the ordinary sliders
  // below: snapshot it for Undo and restart the refinement the input handler
  // cancelled. Without this the page stays "paused while editing" and Export
  // never re-enables (review A1, 2026-10-27).
  for (const [,id] of SHAPE_FIELDS) $(id).addEventListener('change',() => { if (selected>=0) { checkpoint(); queueWeather(); } });
}
let toolSettings={};
const clamp=(v,a,b) => Math.max(a,Math.min(b,v));
const smooth=(a,b,v) => { const t=clamp((v-a)/(b-a),0,1); return t*t*(3-2*t); };
// Rounded authored knots preserve a long shoulder and a short exposed face.
// Zero slope at the crown avoids the knife edge of a skewed power-law dome.
const hillKnots=[.67,.78,.89,1],hillRise=[1,.34,.02,0];
const hillTangents=hillKnots.map((_,i) => {
  if (!i || i===hillKnots.length-1) return 0;
  const a=(hillRise[i]-hillRise[i-1])/(hillKnots[i]-hillKnots[i-1]);
  const b=(hillRise[i+1]-hillRise[i])/(hillKnots[i+1]-hillKnots[i]);
  return a*b>0?2*a*b/(a+b):0;
});
function hillSection(t) {
  if (t<=0 || t>=1) return 0;
  if (t<=.67) return smooth(0,.67,t);
  let i=0; while (hillKnots[i+1]<t) i++;
  const width=hillKnots[i+1]-hillKnots[i],u=(t-hillKnots[i])/width,u2=u*u,u3=u2*u;
  return (2*u3-3*u2+1)*hillRise[i]+(u3-2*u2+u)*width*hillTangents[i]
    +(-2*u3+3*u2)*hillRise[i+1]+(u3-u2)*width*hillTangents[i+1];
}
const hillLift=(s,i) => 1+s.rough*(.75*s.noise.coastWidth[i]+.30*s.noise.detail[i]);

function error(message='') { $('error').textContent=message; $('error').hidden=!message; }
function status(message) { $('status').textContent=message; }
// Height slider range per shape kind; Raise / lower is signed.
const amountRange=kind => kind==='crystal'?[5,200]:kind==='fissure'?[2,60]:kind==='offset'?[-80,80]:['smooth','sand','grass','paint'].includes(kind)?[5,100]:[5,160];
// Cover brushes share the plateau outline and write a field, not heights; the
// mask brush (card C5) is one of them.
const isCover=kind => kind==='sand' || kind==='grass' || kind==='paint';
function toolDefaults(kind,preset=config?.biomeId||'green') {
  return {...Object.fromEntries(SHAPE_FIELDS.map(([key,,,,lo,hi,,scale]) => [key,clamp(Math.round(worldDefault(key)*scale),lo,hi)])),cracks:{hill:40,mountain:60,plateau:50,crater:30,offset:40}[kind]??0,diameter:200,amount:kind==='offset'?20:kind==='fissure'?12:isCover(kind)?100:70,roughness:35,shelves:25,bankWidth:50,beachFlatness:50,softness:50,shallowMode:'passage',preset,...TOOL_PRESETS[preset]?.[kind]};
}
function rememberTool(custom=false) {
  const state={...toolSettings[tool],shallowMode:$('shallow-mode').value};
  for (const [key,[id]] of Object.entries(TOOL_FIELDS)) state[key]=Number($(id).value);
  if (custom) state.preset='custom';
  toolSettings[tool]=state;
}
function showTool(state) {
  [$('amount').min,$('amount').max]=amountRange(tool).map(String);
  for (const [key,[id,lo,hi]] of Object.entries(TOOL_FIELDS)) if (Number.isFinite(state[key])) $(id).value=clamp(state[key],lo,hi);
  $('shallow-mode').value=state.shallowMode==='area'?'area':'passage';
  $('tool-style').value=Object.hasOwn(TOOL_PRESETS,state.preset)?state.preset:'custom';
}
function updateControls() {
  for (const b of document.querySelectorAll('[data-tool]')) b.setAttribute('aria-pressed',String(b.dataset.tool===tool));
  // With Move active, show the selected shape's own controls.
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
  $('roughness-label').textContent=tool==='ramp'?'Shoulder freedom':tool==='deep' && NATURAL_COAST?'Coast freedom':['plateau','erase','sand','grass','paint'].includes(tool) && experiment.get('edges')==='natural'?'Edge freedom':'Roughness';
  $('shelves-control').hidden=tool!=='deep' || !NATURAL_COAST;
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
  const parametric=Number($('sec-profile').value)>=.5;
  // Face width variation also drives the parametric widths of hill, mountain and water, where the classic curves ignore it.
  const profileOnly=key => (key!=='profile' && SECTION_KEYS.includes(key)) || (key==='faceVariation' && ['hill','mountain','deep','shallow'].includes(tool));
  // Spur and rim details show once their switch (spurs, sectors, gaps) is on.
  const gate={spurLength:'spurCount',spurSpread:'spurCount',spurWidth:'spurCount',spurTaper:'spurCount',spurHeight:'spurCount',spurForks:'spurCount',spurBulb:'spurCount',rimUnequal:'rimSectors',rimGapWidth:'rimGaps',fissureBranchLen:'fissureBranches',fissureBranchSpread:'fissureBranches'};
  // On a crater, the crest options only shape its spurs.
  if (tool==='crater') { gate.crestJag='spurCount'; gate.crestVary='spurCount'; }
  // A fissure in network mode has no branches, taper or path jag to set; line mode has no block size.
  const net=tool==='fissure' && Number($('fissure-network').value)>=.5;
  const modeOff=key => tool==='fissure' && (net?['fissureBranches','fissureBranchLen','fissureBranchSpread','fissureTaper'].includes(key):key==='fissureCell');
  const gated=key => modeOff(key) || (gate[key] && !(Number($(SHAPE_FIELDS.find(f => f[0]===gate[key])[1]).value)>0));
  for (const [key,id,,kinds,,,,scale] of SHAPE_FIELDS) { $(id+'-control').hidden=!kinds.includes(tool) || (profileOnly(key) && !parametric) || gated(key) || (key==='maskAmount' && Number($('mask-channel').value)<1); $(id+'-value').textContent=scale===1?$(id).value:scale===10?(Number($(id).value)/scale).toFixed(1):$(id).value+'%'; }
  $('section-preview-control').hidden=!SECTION_KINDS.includes(tool) || !parametric;
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
  $('fractures-value').textContent=$('fractures').value+'%';
  $('scree-value').textContent=$('scree').value+'%';
  $('water-edit').hidden=true;
  $('water-reapply').disabled=!lastWaterStroke || Boolean(stroke) || lastWaterStroke.kind!==tool;
  $('tool-help').textContent=tool==='shallow' && $('shallow-mode').value==='passage'
    ?'Raise the underwater bed to 7 below sea level for a shallow passage. Existing land and shallower banks keep their shape.'
    :HELP[tool];
  $('undo').disabled=!ready || Boolean(stroke) || historyIndex<=0;
  $('redo').disabled=!ready || Boolean(stroke) || historyIndex>=history.length-1;
  $('export').disabled=!canExport(); mapUpdate();
  $('fit').setAttribute('aria-pressed',String(fitView)); $('one').setAttribute('aria-pressed',String(!fitView));
  } finally { tool=activeTool; }
  if (tool==='move') { $('tool-help').textContent=HELP.move; $('amount-control').hidden=selected<0 || ['deep','shallow','ramp','erase'].includes(nodes[selected]?.kind); }
  // Say what the brush controls change: the next stroke, or a selected shape.
  const editing=selected>=0 && nodes[selected]?.params;
  $('brush-panel').classList.toggle('editing',Boolean(editing));
  $('brush-title').textContent=editing?`Selected · ${NODE_NAMES[nodes[selected].kind]||nodes[selected].kind} #${selected+1}`:tool==='move'?'Move':`Brush · new ${NODE_NAMES[tool]||tool}`;
  $('brush-scope').textContent=editing?'These controls edit the selected shape. Choose a tool to draw a new one.':tool==='move'?'Click a shape to select and edit it.':'Settings for your next stroke.';
}

function canExport() {
  return ready && !loading && !stroke && renderedRevision===revision && (!$('weather').checked || weatherState==='ready');
}

function hash(x,y,s) {
  let n=Math.imul(x,374761393)^Math.imul(y,668265263)^s;
  n=Math.imul(n^(n>>>13),1274126177); return ((n^(n>>>16))>>>0)/4294967295*2-1;
}
function valueNoise(x,y,s) {
  const ix=Math.floor(x),iy=Math.floor(y),tx=smooth(0,1,x-ix),ty=smooth(0,1,y-iy);
  const a=hash(ix,iy,s),b=hash(ix+1,iy,s),c=hash(ix,iy+1,s),d=hash(ix+1,iy+1,s);
  return (a+(b-a)*tx)*(1-ty)+(c+(d-c)*tx)*ty;
}
// Brush noise fields: two octaves each, as (wavelength, weight, salt).
const NOISE_FIELDS={x:[[95,.7,0x1863],[37,.3,0x32a7]],y:[[95,.7,0x73c1],[37,.3,0x9e15]],detail:[[64,.65,0x5b39],[23,.35,0x2ac9]],
  coastX:[[210,.65,0x5e17],[75,.35,0x37ab]],coastY:[[210,.65,0x84d1],[75,.35,0x192f]],coastWidth:[[180,.65,0x73b9],[55,.35,0x4f25]],shelf:[[170,.75,0x986d],[48,.25,0x62f3]]};
const noiseValue=(field,s,x,y) => { const [[w1,a1,k1],[w2,a2,k2]]=NOISE_FIELDS[field]; return a1*valueNoise(x/w1,y/w1,s^k1)+a2*valueNoise(x/w2,y/w2,s^k2); };
function makeNoise(s) {
  // Noise is a fixed world-space field, never generated anew per draw or dab.
  const out={};
  for (const field of Object.keys(NOISE_FIELDS)) {
    const a=out[field]=new Float32Array(grid*grid);
    for (let z=0;z<grid;z++) for (let col=0;col<grid;col++) a[z*grid+col]=noiseValue(field,s,col*spacing,z*spacing);
  }
  return out;
}
// A shape's frame maps its authoring coordinates to the world: moving,
// rotating or scaling a shape changes the frame, and its brush noise is read
// through the inverse, so the shape keeps its own outline and character.
// [a,b,c,d,e,f]: world = (a·x + c·y + e, b·x + d·y + f). Absent = identity.
const IDENTITY=[1,0,0,1,0,0];
const compose=(m,n) => [m[0]*n[0]+m[2]*n[1],m[1]*n[0]+m[3]*n[1],m[0]*n[2]+m[2]*n[3],m[1]*n[2]+m[3]*n[3],m[0]*n[4]+m[2]*n[5]+m[4],m[1]*n[4]+m[3]*n[5]+m[5]];
const invert=m => { const det=m[0]*m[3]-m[1]*m[2],a=m[3]/det,b=-m[1]/det,c=-m[2]/det,d=m[0]/det; return [a,b,c,d,-(a*m[4]+c*m[5]),-(b*m[4]+d*m[5])]; };
const applyFrame=(m,x,y) => ({x:m[0]*x+m[2]*y+m[4],y:m[1]*x+m[3]*y+m[5]});
const about=(pivot,m) => compose([1,0,0,1,pivot.x,pivot.y],compose(m,[1,0,0,1,-pivot.x,-pivot.y]));
const rotation=a => [Math.cos(a),Math.sin(a),-Math.sin(a),Math.cos(a),0,0];
const scaling=k => [k,0,0,k,0,0];
const isIdentity=m => !m || m.every((v,i) => Math.abs(v-IDENTITY[i])<1e-9);
// Noise for a framed shape, gathered from the seed's world grid at each
// cell's authoring position (nearest cell; the fields are smooth), within
// rect only. Positions off the map are evaluated directly.
const framedBuffers=new WeakMap();
function framedNoise(node,seed,frame,rect) {
  const world=noiseFor(seed),inv=invert(frame);
  let out=framedBuffers.get(node);
  if (!out) { out={}; for (const field of Object.keys(NOISE_FIELDS)) out[field]=new Float32Array(grid*grid); framedBuffers.set(node,out); }
  // Source cell per target cell first, then one tight loop per field (a
  // keyed lookup per cell and field cost ~10 ms a frame while dragging).
  const w=rect.x1-rect.x0+1,h=rect.y1-rect.y0+1;
  if (w<=0 || h<=0) return out;
  const from=new Int32Array(w*h);
  for (let y=rect.y0,k=0;y<=rect.y1;y++) for (let x=rect.x0;x<=rect.x1;x++,k++) {
    const wx=x*spacing,wy=y*spacing,gx=Math.round((inv[0]*wx+inv[2]*wy+inv[4])/spacing),gy=Math.round((inv[1]*wx+inv[3]*wy+inv[5])/spacing);
    from[k]=gx>=0 && gy>=0 && gx<grid && gy<grid?gy*grid+gx:-1;
  }
  for (const field of Object.keys(NOISE_FIELDS)) {
    const dst=out[field],src=world[field];
    for (let y=rect.y0,k=0;y<=rect.y1;y++) for (let x=rect.x0,i=y*grid+x;x<=rect.x1;x++,k++,i++) {
      const j=from[k];
      if (j>=0) dst[i]=src[j];
      else { const wx=x*spacing,wy=y*spacing; dst[i]=noiseValue(field,seed,inv[0]*wx+inv[2]*wy+inv[4],inv[1]*wx+inv[3]*wy+inv[5]); }
    }
  }
  return out;
}
function sample(field,x,y) {
  const gx=clamp(x/spacing,0,grid-1),gy=clamp(y/spacing,0,grid-1),ix=Math.floor(gx),iy=Math.floor(gy);
  const jx=Math.min(ix+1,grid-1),jy=Math.min(iy+1,grid-1),fx=gx-ix,fy=gy-iy;
  return (field[iy*grid+ix]*(1-fx)+field[iy*grid+jx]*fx)*(1-fy)+(field[jy*grid+ix]*(1-fx)+field[jy*grid+jx]*fx)*fy;
}
function blurred(field,radius) {
  const tmp=new Float32Array(field.length),out=new Float32Array(field.length),width=2*radius+1;
  for (let y=0;y<grid;y++) {
    const row=y*grid; let sum=0;
    for (let k=-radius;k<=radius;k++) sum+=field[row+clamp(k,0,grid-1)];
    for (let x=0;x<grid;x++) { tmp[row+x]=sum/width; sum+=field[row+clamp(x+radius+1,0,grid-1)]-field[row+clamp(x-radius,0,grid-1)]; }
  }
  for (let x=0;x<grid;x++) {
    let sum=0; for (let k=-radius;k<=radius;k++) sum+=tmp[clamp(k,0,grid-1)*grid+x];
    for (let y=0;y<grid;y++) { out[y*grid+x]=sum/width; sum+=tmp[clamp(y+radius+1,0,grid-1)*grid+x]-tmp[clamp(y-radius,0,grid-1)*grid+x]; }
  }
  return out;
}
// Replays borrow working grids from a small stack (a crater's craterlets
// replay inside it) instead of allocating six grids per shape per frame.
const workPool=[]; let workDepth=0;
function borrowWork() {
  const n=grid*grid,w=workPool[workDepth] ??= {base:new Float32Array(n),protect:new Float32Array(n),route:new Float32Array(n),crack:new Float32Array(n),weights:new Float32Array(n),distances:new Float32Array(n),cover:new Float32Array(n),crystal:new Float32Array(n)};
  workDepth++; return w;
}
function startStroke(kind,p,options={}) {
  applySeedControl();
  const radius=options.radius ?? Number($('diameter').value)/2;
  const work=options.work;
  const copy=(src,dst) => { if (!dst) return src.slice(); dst.set(src); return dst; };
  const base=copy(heights,work?.base);
  const strokeSeed=options.seed ?? seed,frame=isIdentity(options.frame)?null:options.frame;
  const strokeNoise=frame?framedNoise(options.node,strokeSeed,frame,options.rect):noiseFor(strokeSeed);
  // Directions drawn from noise live in the authoring frame; turn them with it.
  const turn=frame?Math.atan2(frame[1],frame[0]):0;
  const faceAngle=Math.PI/2+sample(strokeNoise.coastX,p.x,p.y)*1.8+turn;
  // A hill with a parametric cross-section is the plain swept hill (like the mountain), not the shouldered ridge.
  const sec=Object.fromEntries(SECTION_KEYS.map(k => [k,options[k]??shapeValue(k)])),ridge=Object.fromEntries(RIDGE_KEYS.map(k => [k,options[k]??shapeValue(k)])),shouldered=kind==='hill' && experiment.get('forms')==='shouldered' && !(sec.profile>=.5) && !ridgeOn(kind,ridge);
  const made={kind,shouldered,base,protectBase:copy(protection,work?.protect),routeBase:copy(routes,work?.route),crackBase:copy(cracks,work?.crack),coverBase:copy(cover,work?.cover),crystalBase:copy(crystal,work?.crystal),node:options.node,cracks:options.cracks ?? Number($('cracks').value)/100,radius,amount:options.amount ?? Number($('amount').value),rough:options.rough ?? Number($('roughness').value)/100,
    bankWidth:options.bankWidth ?? Number($('bank-width').value)/100,softness:options.softness ?? Number($('softness').value)/100,
    beachFlatness:options.beachFlatness ?? Number($('beach-flatness').value)/100,
    shelves:options.shelves ?? (experiment.has('shelves')?Number(experiment.get('shelves')):Number($('shelves').value)/100),shallowMode:options.shallowMode ?? $('shallow-mode').value,path:[p],
    face:[Math.cos(faceAngle),Math.sin(faceAngle)],
    noise:strokeNoise,seed:strokeSeed,craterOffset:[Math.cos(strokeSeed%628/100+turn),Math.sin(strokeSeed%628/100+turn)],rot:[Math.cos(turn),Math.sin(turn)],inv:frame?invert(frame):null,craterlets:options.craterlets??shapeValue('craterlets'),craterEjecta:options.craterEjecta??shapeValue('craterEjecta'),northFace:options.northFace??shapeValue('northFace'),mesaFlank:options.mesaFlank??shapeValue('mesaFlank'),fingers:options.fingers??shapeValue('fingers'),bankPx:options.bankPx??shapeValue('bankPx'),faceVariation:options.faceVariation??shapeValue('faceVariation'),
    ...Object.fromEntries(['shorePlates','plateWaterPx','plateLandPx','plateSize','plateGap','plateHeight','plateMaterial','fingerBlunt','crystalTiers','crystalForm','crystalStep','crystalSides','crystalSize','crystalCount','crystalTop','crystalLean','crystalVariation','paintChannel','maskChannel','maskAmount',...STYLE_KEYS,...WATER_KEYS].map(k => [k,options[k]??shapeValue(k)])),...sec,...ridge,...Object.fromEntries(FISSURE_KEYS.map(k => [k,options[k]??shapeValue(k)])),ridge:ridgeOn(kind,ridge),piece:null,baseline:sample(options.pre??base,p.x,p.y),pre:options.pre,weights:work?work.weights.fill(0):new Float32Array(heights.length),
    distances:shouldered?(work?work.distances:new Float32Array(heights.length)).fill(Infinity):null,start:p,last:p,end:p,
    smoothTarget:kind==='smooth'?blurred(base,clamp(Math.round(radius/(spacing*7)),1,24)):null};
  made.prof=sectionSetup(made);
  made.masks=maskSetup(made,work);
  made.rim=rimSetup(made);
  made.fis=fissureSetup(made);
  return made;
}
// Painted masks (card C5). What each choice writes, as [plane, target]; the
// brush, Ground (erase) and a landform's Paint inside option all go through
// paintCell, which moves a plane from the value it had before the stroke
// toward its target by the stroke's influence, so repeated dabs never add up.
// Rock, snow and moss are surface materials: painting one clears the other two
// (a soft edge fades the old one out as the new one comes in), as the cover
// brushes replace each other. Wet ground only darkens, so it layers on any of
// them. Planes: 0 rock 1 snow 2 wet 3 moss 4 scatter 5 relief 6 cracks 7 banding 8 face
// 9 shore edge 10 shallow-to-deep edge 11 water bed 12 ground lumps 13 cracked bed.
const MASK_WRITES=[null,[[0,127],[1,0],[3,0]],[[1,127],[0,0],[3,0]],[[2,127]],[[3,127],[0,0],[1,0]],[[4,127]],[[4,-127]],
  [[0,0],[1,0],[2,0],[3,0],[4,0],[5,0],[6,0],[7,0],[8,0],[9,0],[10,0],[11,0],[12,0],[13,0]],
  [[5,127]],[[5,-127]],[[6,127]],[[6,-127]],[[7,127]],[[7,-127]],[[8,127]],[[8,-127]],[[12,127]],[[12,-127]]];
function maskSetup(s,work) {
  const shape=MASK_SHAPES.includes(s.kind);
  const choice=Math.round(s.kind==='paint'?s.paintChannel:s.kind==='erase'?7:s.kind==='fissure'?(s.fissureDark>0?3:0):shape?s.maskChannel:0);
  // [plane, target, gain] per write: gain scales the influence (the shape's paint strength; a style write's target already carries its amount).
  const writes=(MASK_WRITES[choice]||[]).map(([j,t]) => [j,t,shape?clamp(s.maskAmount,0,1):1]);
  if (shape) STYLE_KEYS.forEach((k,j) => { const v=clamp(s[k]||0,-1,1); if (Math.abs(v)>=.005) writes.push([5+j,Math.round(127*v),1]); });
  // A water stroke's own edge and bed choices (card E1): 1 sets +127, 2 sets -127, 0 writes
  // nothing. They are flags, not amounts: written at full strength wherever the stroke
  // reaches (flat), since a tapered byte would decode as a different choice.
  const flat=writes.map(() => false);
  if (s.kind==='deep' || s.kind==='shallow') WATER_KEYS.forEach((k,j) => {
    const c=Math.round(s[k]||0);
    if (c<1 || c>(k==='waterBed'?3:2)) return;
    writes.push([9+j,c===2?-127:127,1]); flat.push(true);
    // The bed choices also set or clear the cracked-bed flag (3: cracked rock).
    if (k==='waterBed') { writes.push([13,c===3?127:0,1]); flat.push(true); }
  });
  if (!writes.length) return null;
  // Replays borrow the planes from the work pool, as the other base fields.
  const pool=work?(work.masks??=maskPlanes.map(a => new Int8Array(a.length))):null;
  const base=maskPlanes.map((a,j) => { if (!pool) return a.slice(); pool[j].set(a); return pool[j]; });
  return {base:Object.fromEntries(MASK_KEYS.map((k,j) => [k,base[j]])),n:writes.length,plane:writes.map(([j]) => maskPlanes[j]),from:writes.map(([j]) => base[j]),target:writes.map(([,t]) => t),gain:writes.map(([,,g]) => g),flat,shape};
}
function paintCell(m,i,f) { for (let k=0;k<m.n;k++) { const b=m.from[k][i]; m.plane[k][i]=Math.round(b+(m.target[k]-b)*(m.flat[k]?1:f*m.gain[k])); } }
const copyMask=(m,i,j) => { for (let k=0;k<m.n;k++) m.plane[k][j]=m.plane[k][i]; };
const maskSnapshot=() => Object.fromEntries(MASK_KEYS.map((k,j) => [k,maskPlanes[j].slice()]));
function clearMasks() { for (const a of maskPlanes) a.fill(0); }
// A landform's Paint inside and Style options: over the footprint, weighted by
// the influence its dabs left in s.weights, so the paint follows the shape's
// outline and softness. Applied once the shape is settled, like cracks.
function applyShapeMask(s) {
  const m=s.masks;
  if (!m || !m.shape) return;
  const c=clip||{x0:0,y0:0,x1:grid-1,y1:grid-1};
  for (let y=c.y0;y<=c.y1;y++) for (let i=y*grid+c.x0,end=y*grid+c.x1;i<=end;i++) if (s.weights[i]>0) paintCell(m,i,s.weights[i]);
}
// Finger coasts (Lava): an interlocking fringe of tapered land fingers and
// lava inlets across the waterline. Measured on the retail Lava coast
// sections: fine lobes 11-15 px wide and ~35 px long at ~30 px spacing,
// sparse coarse fingers 18-27 px wide reaching 70-115 px, axes straight
// but fanned ~30 degrees off the coast normal, tips about a third of the
// base width. Ribs come from oriented cosine kernels at jittered world
// points (as the relief bake's gullies), with phase running along the
// coast, so each rib is a finger along the normal; a rib's crest reaches
// farthest, so fingers taper. Returns the waterline shift in world px
// (+: land reaches into the water).
function fingerRibs(x,y,tx,ty,period,salt,leanMax=.26) {
  const qx=x/period,qy=y/period,cx=Math.floor(qx),cy=Math.floor(qy),fx=qx-cx,fy=qy-cy;
  let sum=0,weight=0;
  for (let j=-2;j<=1;j++) for (let i=-2;i<=1;i++) {
    const a=hash(cx-i,cy-j,salt)*.5+.5,b=hash(cx-i,cy-j,salt^0x5bd1)*.5+.5,c=hash(cx-i,cy-j,salt^0x2f6a);
    const px=fx+i-a*.5,py=fy+j-b*.5,w=Math.exp(-(px*px+py*py)*2);
    // Each finger leans its own way off the normal.
    const lean=c*leanMax,dx=tx*Math.cos(lean)-ty*Math.sin(lean),dy=tx*Math.sin(lean)+ty*Math.cos(lean);
    sum+=Math.cos((px*dx+py*dy)*6.283185+c*3.1)*w; weight+=w;
  }
  return sum/weight;
}
// The fringe belongs to the shape: it is evaluated in the shape's own
// (authoring) coordinates and cached per shape on that grid, so moving a lake
// carries its fingers along and re-uses them instead of re-evaluating every
// kernel each frame.
const fingerCaches=new WeakMap();
function fingerCache(s) {
  if (s.fingerField) return s.fingerField;
  const key=`${s.seed}|${s.radius}|${s.rough}|${s.bankWidth}|${s.fingerBlunt}`;
  let c=s.node?fingerCaches.get(s.node):null;
  if (!c || c.key!==key) { c={key,field:new Float32Array(grid*grid).fill(NaN)}; if (s.node) fingerCaches.set(s.node,c); }
  return s.fingerField=c.field;
}
function fingerShift(s,i,wx,wy,nx,ny,amount) {
  const field=fingerCache(s),inv=s.inv;
  if (inv) {
    // Into the shape's frame: position, and the coast normal's direction.
    const lx=inv[0]*wx+inv[2]*wy+inv[4],ly=inv[1]*wx+inv[3]*wy+inv[5],mx=inv[0]*nx+inv[2]*ny,my=inv[1]*nx+inv[3]*ny,ml=Math.hypot(mx,my)||1;
    wx=lx; wy=ly; nx=mx/ml; ny=my/ml;
    const gx=Math.round(wx/spacing),gy=Math.round(wy/spacing);
    i=gx>=0 && gy>=0 && gx<grid && gy<grid?gy*grid+gx:-1;
  }
  let v=i>=0?field[i]:NaN;
  if (Number.isNaN(v)) {
    const tx=-ny,ty=nx;
    // Retail coasts (measure/lava_fingers): a land finger and a lava inlet
    // every ~45 px of coast, fingers reaching 16-24 px past the coast and
    // about one in five 40 px or more; fingers taper to blunt rounded tips
    // (tip/middle ~0.6), inlets to points (~0.4); axes within ~15 degrees of
    // the normal. A rib's positive half is flattened (blunt) and its negative
    // half sharpened (pointed); small lumps vary widths.
    if (s.fingerBlunt>=.5) {
      // Thumbs (card B3): retail's long fingers (Kill the Middle) are 25-35 px
      // wide, 40-70 px long, 70-90 px apart, with near-parallel sides, rounded
      // tips and rounded inlets between. The ribs' phase gives each finger's
      // angle from its axis; the outline across a finger is an ellipse arc, so
      // the tip is blunt, and the lumps die out toward the tip (they pinched
      // thin finger ends into pointed wedges and islets).
      const crest=clamp(fingerRibs(wx,wy,tx,ty,76,s.seed^0x71f3,.1)/.55,-1,1),ang=(1-crest)/.7;
      const thumb=ang<1?Math.sqrt(1-ang*ang)*smooth(0,.4,1-ang):0;
      const reach=46*(.75+.5*(valueNoise(wx/120,wy/120,s.seed^0x6a1)*.5+.5));
      const long=smooth(.3,.75,valueNoise(wx/160,wy/160,s.seed^0x4e11));
      const lumps=(valueNoise(wx/14,wy/14,s.seed^0x5c1)*2.5+valueNoise(wx/5,wy/5,s.seed^0x3a7))*(1-.85*thumb);
      v=thumb*reach*(1+long*.9)+lumps;
      if (i>=0) field[i]=v;
      return v*amount;
    }
    const rib=clamp(fingerRibs(wx,wy,tx,ty,46,s.seed^0x71f3)*1.6,-1,1);
    const shaped=rib>0?Math.pow(rib,.6):-Math.pow(-rib,1.5);
    const reach=20*(.8+.4*(valueNoise(wx/120,wy/120,s.seed^0x6a1)*.5+.5));
    const long=smooth(.3,.75,valueNoise(wx/160,wy/160,s.seed^0x4e11));
    const lumps=valueNoise(wx/14,wy/14,s.seed^0x5c1)*2.5+valueNoise(wx/5,wy/5,s.seed^0x3a7);
    v=(shaped>0?shaped*reach*(1+long*1.2):shaped*reach*1.1)+lumps;
    if (i>=0) field[i]=v;
  }
  return v*amount;
}
// Parametric cross-section (card C1; profile 1). Everything is measured in px
// inward from the stroke's outer edge (the foot), so a form keeps its size
// whatever the brush diameter, and every cell reads only its own position and
// the stroke's fields, so region replay stays exact. Land runs apron -> face
// (optionally terraced) -> cap; water runs plain -> bank face -> apron at the
// waterline -> shelf -> drop -> bed. Widths are scaled along the outline by the
// broad world-space noise fields times Face width variation, so a face does
// not keep one width round an arc. The lip is height added on top of the
// profile, not part of it: the profile alone stays monotone in the distance
// from the path, which the union of a sweep's dabs (nearest wins) relies on.
let sectionLift=0;
function sectionSetup(s) {
  if (!(s.profile>=.5) || !SECTION_KINDS.includes(s.kind)) return null;
  const water=s.kind==='deep' || s.kind==='shallow',dome=s.kind==='hill' || s.kind==='mountain',crown=dome?s.crown:0;
  // Per-step height wobble weights: each riser level mixes two noise fields
  // with its own phase, so neighbouring risers wander independently.
  const wobC=new Float32Array(10),wobS=new Float32Array(10);
  for (let m=0;m<10;m++) { wobC[m]=Math.cos(2.4*m+1); wobS[m]=Math.sin(2.4*m+1); }
  return {water,dome,bed:config.seaLevel+(s.kind==='deep'?-55:-7),
    apron:s.apronPx,apronHeight:s.apronHeight,face:s.facePx,faceShare:clamp(.38+(s.softness-.5)*.6,.1,.88),curve:s.faceCurve,
    steps:Math.round(clamp(s.terraces,0,8)),flat:Math.min(s.ledge,.95),jitter:s.terraceJitter,lip:s.lip,
    // A dome's face stops short of the crest; the crown is what is left, rising the last 45% of the way.
    capWidth:.55*crown,capRise:.45*crown,capExp:1+2*crown,
    bank:s.bankPx,shelf:s.shelfPx,shelfDepth:s.shelfDepth,shelfSteps:Math.round(clamp(s.shelfSteps,0,6)),vary:(s.faceVariation??.8)*.5,wobC,wobS};
}
// Level of riser m of n (0 at the foot, 1 at the top), wobbled between the ends.
const terraceLevel=(c,m,n,nA,nB) => m/n+(m>0 && m<n?c.jitter*.3/n*(nA*c.wobC[m]+nB*c.wobS[m]):0);
// Step the unstepped face share g (card formula): q = g n + jitter noise, level
// floor(q) then a smooth riser over the last (1 - ledge) of the step. The
// noise is windowed to 0 at the foot and the top, so the cap stays at full
// height, and bounded so q stays monotone in g.
function terrace(c,g,n,nj,nA,nB) {
  const a=clamp(c.jitter*nj,-.22*n,.22*n),q=g*n+a*4*g*(1-g),k=Math.max(0,Math.min(Math.floor(q),n-1));
  const lo=terraceLevel(c,k,n,nA,nB),hi=terraceLevel(c,k+1,n,nA,nB);
  return lo+(hi-lo)*smooth(c.flat,1,q-k);
}
// Rise at d px from the foot, as a share of the whole amount: the apron (a
// concave skirt reaching apronHeight) then the face up to pt. Convex faces
// are steep at the foot and round over; concave ones start soft and end crisp.
function faceRise(c,d,A,F,pt,n,nj,nA,nB) {
  if (d<=0) return 0;
  const ah=A>0?Math.min(c.apronHeight,.9*pt):0;
  if (d<A) return ah*Math.pow(d/A,1.5);
  if (d>=A+F) return pt;
  const u=(d-A)/F,k=Math.abs(c.curve);
  let g=smooth(0,1,u);
  if (k>0) g+=((c.curve>0?1-Math.pow(1-u,2.4):Math.pow(u,2.4))-g)*k;
  return ah+(pt-ah)*(n>0?terrace(c,g,n,nj,nA,nB):g);
}
// The lip's shape: t px down the face from its top (negative on the cap side).
const lipRim=(t,F) => t>=0?1-smooth(0,.45*F,t):1-smooth(0,clamp(.4*F,5,30),-t);
function landSection(c,d,reach,kw,ka,nj,nA,nB) {
  let A=c.apron*ka,F=(c.face>0?c.face:c.dome?Math.max((1-c.capWidth)*reach-c.apron,.1*reach):c.faceShare*reach)*kw;
  if (A+F>.98*reach) { const k=.98*reach/(A+F); A*=k; F*=k; }
  const top=A+F,pt=1-c.capRise;
  let p=1;
  if (d<top) p=faceRise(c,d,A,F,pt,c.steps,nj,nA,nB);
  else if (c.capRise>0) p=pt+c.capRise*(1-Math.pow(1-Math.min((d-top)/Math.max(reach-top,1e-3),1),c.capExp));
  sectionLift=c.lip!==0?c.lip*lipRim(top-d,F):0;
  return p;
}
// Surface height of a deep or shallow stroke at d px from its outer edge, on
// ground of height base. The dry bank is the land profile run from the
// waterline (its foot) up to the plain; the lip needs room beyond the bank's
// top to fade out, so a lipped bank starts that far inside the stroke.
function waterSection(c,d,reach,base,kw,ka,nj,nA,nB) {
  const sea=config.seaLevel;
  let A=c.apron*ka,F=(c.face>0?c.face:c.bank>0?Math.max(c.bank-c.apron,6):.4*reach)*kw,S=c.shelf>0 && c.shelfDepth>0?c.shelf*ka:0;
  let I=c.lip!==0?clamp(.4*F,5,30):0;
  const total=I+A+F+S;
  if (total>.92*reach) { const k=.92*reach/total; I*=k; A*=k; F*=k; S*=k; }
  const B=A+F,rest=I+B+S,depth=Math.min(c.shelfDepth,.7*(sea-c.bed));
  let v;
  if (d<I) v=base;
  else if (d<I+B) { const p=faceRise(c,B-(d-I),A,F,1,c.steps,nj,nA,nB); v=base>sea?sea+(base-sea)*p:base; }
  else if (d<rest) { const u=(d-I-B)/S; v=Math.min(base,sea-depth*(c.shelfSteps>0?1-terrace(c,1-u,c.shelfSteps,nj,nA,nB):smooth(0,.35,u))); }
  else { const top=S>0?sea-depth:sea; v=Math.min(base,top+(c.bed-top)*smooth(0,1,(d-rest)/(.7*(reach-rest)))); }
  sectionLift=c.lip!==0?c.lip*lipRim(d-I,F):0;
  return v;
}
// The one call dab() makes: the weight w (0 at the foot, 1 at the full rise or
// the bed) for the cell at index i, r of the way out to the foot, whose
// outline reaches `reach` px. The lip is left in sectionLift for the caller.
function crossSection(s,i,r,reach) {
  sectionLift=0;
  const c=s.prof,nz=s.noise,d=(1-r)*reach;
  if (d<=0) return 0;
  const kw=clamp(1+c.vary*nz.coastWidth[i],.4,1.8),ka=clamp(1+c.vary*nz.shelf[i],.4,1.8),nj=nz.coastX[i],nA=nz.coastY[i],nB=nz.x[i];
  if (!c.water) return landSection(c,d,reach,kw,ka,nj,nA,nB);
  const base=s.base[i];
  if (base-c.bed<.5) return 0;
  return clamp((base-waterSection(c,d,reach,base,kw,ka,nj,nA,nB))/(base-c.bed),0,1);
}
// The preview: the active tool's profile from the controls, drawn with the
// same functions as dab() but at neutral noise (widths unscaled, no wobble).
function drawSection() {
  const cv=$('section-preview'),g=cv.getContext('2d'),W=cv.width,H=cv.height,kind=tool;
  const probe={kind,softness:Number($('softness').value)/100,faceVariation:0,bankPx:shapeValue('bankPx'),...Object.fromEntries(SECTION_KEYS.map(k => [k,shapeValue(k)]))};
  const c=sectionSetup(probe);
  g.clearRect(0,0,W,H);
  if (!c) return;
  const radius=Number($('diameter').value)/2,reach=radius*(c.water?2**((Number($('bank-width').value)/100-.5)*1.3):1);
  const sea=config.seaLevel,top=config.baseHeight,amount=Number($('amount').value);
  const n=160,ys=new Float32Array(n+1);
  let lo=Infinity,hi=-Infinity;
  for (let k=0;k<=n;k++) {
    const d=reach*k/n;
    ys[k]=c.water?waterSection(c,d,reach,top,1,1,0,0,0)+sectionLift:landSection(c,d,reach,1,1,0,0,0)*amount+sectionLift;
    lo=Math.min(lo,ys[k]); hi=Math.max(hi,ys[k]);
  }
  if (c.water) { lo=Math.min(lo,c.bed); hi=Math.max(hi,top); } else { lo=Math.min(lo,0); hi=Math.max(hi,amount); }
  const pad=8,X=k => pad+(W-2*pad)*k/n,Y=v => H-pad-(H-2*pad)*(v-lo)/Math.max(hi-lo,1);
  g.strokeStyle='#465344'; g.setLineDash([3,3]); g.beginPath(); g.moveTo(pad,Y(c.water?sea:0)); g.lineTo(W-pad,Y(c.water?sea:0)); g.stroke(); g.setLineDash([]);
  g.beginPath(); g.moveTo(X(0),H-pad);
  for (let k=0;k<=n;k++) g.lineTo(X(k),Y(ys[k]));
  g.lineTo(X(n),H-pad); g.closePath(); g.fillStyle=c.water?'rgba(102,170,200,.28)':'rgba(180,213,137,.25)'; g.fill();
  g.beginPath(); for (let k=0;k<=n;k++) g[k?'lineTo':'moveTo'](X(k),Y(ys[k]));
  g.strokeStyle='#b4d589'; g.lineWidth=1.5; g.stroke(); g.lineWidth=1;
  g.fillStyle='#a8b7a5'; g.font='9px system-ui'; g.fillText(c.water?'bank top':'foot',pad,10); g.textAlign='right'; g.fillText(c.water?'bed':'cap',W-pad,10); g.textAlign='left';
}
// Line features (card C4). A ridge (a hill or mountain with spurs or crest
// options) is swept as short pieces, each with width and height multipliers at
// its two ends that dab() reads as s.piece, so the crest swells, narrows and
// tapers along its path and every spur is simply more pieces on the same
// stroke: the nearest influence wins, so a spur meets its parent at the crest
// with no seam and no detached lump. Spur geometry comes from the stroke seed
// and the path alone, never from the heights, and each cell reads only its own
// position and the pieces, so region replay stays exact.
const rand01=(seed,a,b) => hash(a,b,seed)*.5+.5;
const mkPiece=(a,b,r0,r1,h0,h1,jag) => ({a,b,r0,r1,h0,h1,jag,reach:Math.max(r0,r1),mean:(r0+r1)/2});
// Width and height multipliers at arc length a of a line len long: slow noise
// along the line (crest variation), then the taper. A spur (ends false) narrows
// from a flared root to a blunt tip (never under 0.38 of its root width, where
// the height has fallen to 0.3); a main crest (ends true) narrows
// toward both of its ends and is full in the middle.
function lineMultipliers(s,a,len,salt,taper,ends) {
  const R=s.radius,f=len>0?clamp(a/len,0,1):0,u=ends?1-smooth(0,.4,Math.min(f,1-f)):smooth(0,1,f),n=valueNoise(a/(R*2.2),.37,s.seed^salt),m=valueNoise(a/(R*1.6),2.9,s.seed^(salt+0x55));
  return [clamp(1+.45*s.crestVary*n,.6,1.4)*(1-.62*taper*u)*(ends?1:1+.5*(1-smooth(0,.4,f))),(1-.45*s.crestVary*(.5-.5*m))*(1-.7*taper*u)];
}
// Spurs from roots [{x,y,heading,k}]: each a wandering four-point line that
// narrows and lowers toward its tip, laid out as three pieces. A root height
// fade lets a spur rise out of a crater rim instead of stacking on it. Forks
// (Spur forks: the share of spurs that fork once, two thirds along) grow a
// shorter spur off the spur's own width and height, and Bulbous tips swell
// the last half of every spur into a rounded lobe, so a spur can end in a
// knuckle instead of a point; both off, the pieces are exactly the plain
// tapering spurs.
function spurPieces(s,roots,fade,jag) {
  const kf=s.inv?1/Math.hypot(s.inv[0],s.inv[1]):1,spread=s.spurSpread,bulb=s.spurBulb,out=[];
  const grow=(x,y,heading,len,rootR,rootH,k,level,rootFade) => {
    const step=len/3,curl=(.1+.3*spread)*Math.PI,salt=0x300+k*97;
    let h=heading;
    for (let j=0;j<3;j++) {
      h+=(rand01(s.seed,k,20+j)-.5)*curl;
      const nx=x+Math.cos(h)*step,ny=y+Math.sin(h)*step,m0=lineMultipliers(s,step*j,len,salt,s.spurTaper,false),m1=lineMultipliers(s,step*(j+1),len,salt,s.spurTaper,false);
      let r0=m0[0],r1=m1[0],e0=m0[1],e1=m1[1];
      // A lobe keeps its height as well as its width, so it stands as a knuckle rather than a soft swelling.
      if (bulb>0) { const b0=bulb*smooth(.5,1,j/3),b1=bulb*smooth(.5,1,(j+1)/3); r0+=b0*.7; r1+=b1*.7; e0+=(1-e0)*b0; e1+=(1-e1)*b1; }
      out.push(mkPiece({x,y},{x:nx,y:ny},rootR*r0,rootR*r1,rootH*e0*(j?1:rootFade),rootH*e1,jag));
      if (j===1 && level===0 && s.spurForks>0 && rand01(s.seed,k,50)<s.spurForks)
        grow(nx,ny,h+(rand01(s.seed,k,51)<.5?-1:1)*(.5+.6*rand01(s.seed,k,52)),len*.5,rootR*r1*.85,rootH*e1*.85,k+100,1,1);
      x=nx; y=ny;
    }
  };
  for (const root of roots) {
    const k=root.k;
    grow(root.x,root.y,root.heading,s.spurLength*kf*(.55+.9*rand01(s.seed,k,14)),s.spurWidth*(.85+.3*rand01(s.seed,k,15)),s.spurHeight,k,0,fade);
  }
  return out;
}
// The pieces of a ridge: the main crest cut into capsules of the same length
// sweep() uses, then its spurs rooted along the path (alternating sides, angle
// from the tangent by Spur angle spread). A single click grows spurs radiating
// from the point.
function ridgePieces(s,path) {
  const cum=[0],longest=Math.max(16,s.radius*1.5),out=[];
  for (let k=1;k<path.length;k++) cum.push(cum[k-1]+Math.hypot(path[k].x-path[k-1].x,path[k].y-path[k-1].y));
  const L=cum[cum.length-1],jag=s.crestJag;
  if (path.length<2) out.push(mkPiece(path[0],null,1,1,1,1,jag));
  for (let k=1;k<path.length;k++) {
    const a=path[k-1],b=path[k],len=cum[k]-cum[k-1],n=Math.max(1,Math.ceil(len/longest));
    for (let j=0;j<n;j++) {
      const f0=j/n,f1=(j+1)/n,m0=lineMultipliers(s,cum[k-1]+len*f0,L,0x71d,s.crestTaper,true),m1=lineMultipliers(s,cum[k-1]+len*f1,L,0x71d,s.crestTaper,true);
      out.push(mkPiece({x:a.x+(b.x-a.x)*f0,y:a.y+(b.y-a.y)*f0},{x:a.x+(b.x-a.x)*f1,y:a.y+(b.y-a.y)*f1},m0[0],m1[0],m0[1],m1[1],jag));
    }
  }
  const N=Math.round(clamp(s.spurCount,0,12));
  if (N<1) return out;
  const roots=[],spread=s.spurSpread,phase=rand01(s.seed,7,0x4b1)*Math.PI*2;
  for (let k=0;k<N;k++) {
    if (L<=0) { roots.push({x:path[0].x,y:path[0].y,heading:phase+Math.atan2(s.rot[1],s.rot[0])+Math.PI*2*(k+(rand01(s.seed,k,11)-.5)*.5)/N,k}); continue; }
    const at=L*(.08+.84*(k+.2+.6*rand01(s.seed,k,11))/N),side=((k+(rand01(s.seed,k,12)<.25?1:0))&1)?1:-1;
    let i=1; while (i<cum.length-1 && cum[i]<at) i++;
    const a=path[i-1],b=path[i],f=(at-cum[i-1])/Math.max(cum[i]-cum[i-1],1e-6);
    roots.push({x:a.x+(b.x-a.x)*f,y:a.y+(b.y-a.y)*f,heading:Math.atan2(b.y-a.y,b.x-a.x)+side*(.7+.95*spread)*(.75+.5*rand01(s.seed,k,13)),k});
  }
  return out.concat(spurPieces(s,roots,1,jag));
}
// The crater's lobed outline at an authoring-frame position, as dab's crater
// draws it (a spur must start at the rim crest, and stay out of the bowl).
function craterLobe(s,lx,ly) {
  const R=s.radius,sc=Math.max(R*.55,8);
  return 1+s.rough*(.38*valueNoise(lx/(R*.95),ly/(R*.95),s.seed^0x4a7)+.22*valueNoise(lx/sc,ly/sc,s.seed^0x1c3)+.1*valueNoise(lx/(sc*.6),ly/(sc*.6),s.seed^0x2d9));
}
// What dab() multiplies a piece's weight by at t along it: the height
// multiplier, then the jagged crest, whose peaks keep full height and whose
// dips (position noise, about a quarter and a tenth of the radius wide)
// bite down to Crest irregularity times 0.6 of it.
function ridgeRise(s,pc,t,lx,ly,wx,wy) {
  let h=pc.h0+(pc.h1-pc.h0)*t;
  // A crater's spurs fade out toward the bowl: none start inside the rim.
  if (pc.hole) { const o=pc.hole,rr=Math.hypot(wx-o.x,wy-o.y)/(o.s.radius*craterLobe(o.s,lx,ly)); h*=smooth(.92,1.2,rr); }
  if (pc.jag>0) { const R=s.radius,n=.6*valueNoise(lx/(R*.28),ly/(R*.28),s.seed^0x6b1)+.4*valueNoise(lx/(R*.11),ly/(R*.11),s.seed^0x1d7); h*=1-pc.jag*.6*(.5-.5*n); }
  return h;
}
function sweepRidge(s,points) {
  const path=simplifyPath(points,s.fis?Math.max(1.5,s.fis.hw):Math.max(1,s.radius*.04));
  for (const pc of s.fis?fissurePieces(s,path):ridgePieces(s,path)) { s.piece=pc; dab(s,pc.a,pc.b); }
  s.piece=null; s.path=points.slice(); s.last=s.end=points[points.length-1];
}
// Crater rim sectors and gaps. The rim is split into sectors, each with its
// own height and width, blended smoothly from one to the next round the ring
// (centres a little off even spacing); gaps sink the rim to a low saddle over
// an angular window. Angles are in the shape's own frame, so turning the
// shape turns its sectors. Returns null when both are off.
function rimSetup(s) {
  if (s.kind!=='crater') return null;
  const N=Math.round(clamp(s.rimSectors,0,8)),G=Math.round(clamp(s.rimGaps,0,4));
  if (N<2 && G<1) return null;
  const rnd=(a,b) => rand01(s.seed,a,b+0x3c5),u=clamp(s.rimUnequal,0,1),tau=Math.PI*2,phase=rnd(0,1)*tau,sect=[],gaps=[];
  // A strong sector is both tall and broad; a weak one low and narrow.
  if (N>=2) for (let k=0;k<N;k++) { const q=rnd(k,2); sect.push({a:phase+tau*(k+(rnd(k,3)-.5)*.5)/N,h:1-.85*u*(1-q),w:1+u*(1.8*q*(.6+.4*rnd(k,4))-.4)}); }
  const gphase=rnd(9,9)*tau;
  for (let k=0;k<G;k++) gaps.push(gphase+tau*(k+(rnd(k,5)-.5)*.4)/G);
  return {sect,rel:sect.map(c => c.a-sect[0].a),gaps,hw:clamp(s.rimGapWidth,10,180)*Math.PI/360};
}
const rimOut=[1,1];
function rimFactors(rim,ang) {
  const tau=Math.PI*2,sect=rim.sect,n=sect.length;
  let h=1,w=1;
  if (n>1) {
    const d=(((ang-sect[0].a)%tau)+tau)%tau;
    let i=0; while (i<n-1 && rim.rel[i+1]<=d) i++;
    const j=(i+1)%n,span=(i<n-1?rim.rel[i+1]:tau)-rim.rel[i],t=smooth(0,1,(d-rim.rel[i])/Math.max(span,1e-6));
    h=sect[i].h+(sect[j].h-sect[i].h)*t; w=sect[i].w+(sect[j].w-sect[i].w)*t;
  }
  for (const g of rim.gaps) { const dist=Math.abs((((ang-g+Math.PI)%tau)+tau)%tau-Math.PI); h*=.08+.92*smooth(.5*rim.hw,rim.hw,dist); }
  rimOut[0]=h; rimOut[1]=w;
  return rimOut;
}
// Spurs off a crater's rim: a child mountain stroke (as craterlets are child
// craters) whose pieces start just outside the rim crest, at seeded angles round
// the ring, and rise out of it. It borrows the crater's seed, so it reads the
// same noise fields, and adds to the finished crater: smooth, never a seam.
const rimSpurKeys=new WeakMap();
function addRimSpurs(n,s) {
  const count=Math.round(clamp(s.spurCount||0,0,12));
  if (count<1) return;
  const framed=!isIdentity(n.frame),turn=framed?Math.atan2(n.frame[1],n.frame[0]):0,inv=framed?invert(n.frame):null,c=n.points[n.points.length>>1],R=s.radius;
  const phase=rand01(s.seed,7,0x4b1)*Math.PI*2,roots=[];
  for (let k=0;k<count;k++) {
    const ang=phase+Math.PI*2*(k+(rand01(s.seed,k,0x4b2)-.5)*.6)/count+turn,dx=Math.cos(ang),dy=Math.sin(ang),wx=c.x+dx*R,wy=c.y+dy*R;
    // The rim's own lobed outline (as dab's crater), so a spur starts at the crest, not inside the bowl.
    const lx=inv?inv[0]*wx+inv[2]*wy+inv[4]:wx,ly=inv?inv[1]*wx+inv[3]*wy+inv[5]:wy;
    const lobe=craterLobe(s,lx,ly);
    roots.push({x:c.x+dx*R*lobe*1.02,y:c.y+dy*R*lobe*1.02,heading:ang+(rand01(s.seed,k,0x4b3)-.5)*s.spurSpread*1.2,k});
  }
  const pieces=spurPieces(s,roots,.4,s.crestJag),hole={x:c.x,y:c.y,s};
  for (const pc of pieces) pc.hole=hole;
  let keys=rimSpurKeys.get(n); if (!keys) rimSpurKeys.set(n,keys={});
  let rect=null;
  if (framed) {
    let ax=Infinity,ay=Infinity,bx=-Infinity,by=-Infinity;
    for (const pc of pieces) for (const q of [pc.a,pc.b]) { ax=Math.min(ax,q.x); ay=Math.min(ay,q.y); bx=Math.max(bx,q.x); by=Math.max(by,q.y); }
    const reach=R*1.5+12*spacing,box=clip||{x0:0,y0:0,x1:grid-1,y1:grid-1};
    rect={x0:Math.max(box.x0,Math.floor((ax-reach)/spacing)),y0:Math.max(box.y0,Math.floor((ay-reach)/spacing)),x1:Math.min(box.x1,Math.ceil((bx+reach)/spacing)),y1:Math.min(box.y1,Math.ceil((by+reach)/spacing))};
  }
  const work=borrowWork();
  try {
    const t=startStroke('mountain',roots[0],{...n.params,radius:R,amount:s.amount*s.rimHeight,rough:s.rough*.8,softness:.8,cracks:0,craterlets:0,craterEjecta:0,spurCount:0,rimSectors:0,rimGaps:0,crestJag:0,crestVary:0,crestTaper:0,profile:0,seed:s.seed,frame:n.frame,node:keys,rect,work});
    for (const pc of pieces) { t.piece=pc; dab(t,pc.a,pc.b); }
  } finally { workDepth--; }
}
// Placed fissures (card C4 stage 2). The Fissure tool cuts the heights (a narrow
// V trench of Depth units, widest Width px) along its stroke and raises the
// world's own crack field beside the cut, so the rock round it breaks up. Line
// mode is swept like a ridge: the main cut and its branches (each forking once)
// are short pieces whose width and depth multipliers taper them toward their
// ends; each cell reads the nearest piece, so cuts join at their roots. A
// zigzag displaces the cell's position by high-frequency noise before the
// distance is taken, and its depth wobbles along the cut. Network mode instead
// cuts the borders of a jittered cell pattern (the distance to the nearest
// bisector of two sites) inside the stroke's footprint, which fades at its edge.
// Everything is a function of the cell's own position, the stroke seed and the
// path, so region replay stays exact.
function fissureSetup(s) {
  if (s.kind!=='fissure') return null;
  const kf=s.inv?1/Math.hypot(s.inv[0],s.inv[1]):1,hw=Math.max(s.fissureWidth,1)*.5*kf,net=s.fissureNetwork>=.5,jag=s.fissureJag;
  // amp: zigzag amplitude in px; reach: how far from a piece a cell can feel it (cut, crack fringe, zigzag).
  const amp=hw*(.5+2.2*jag)+1;
  return {net,kf,hw,jag,amp,cell:s.fissureCell,crack:s.fissureCrack,dark:s.fissureDark,reach:net?s.radius*1.05+hw+8:hw*3.5+amp+6};
}
// Branches (and a fork off each) grown from roots along the main cut. A line is
// four points; width and depth fall from the root to the tip.
function fissurePieces(s,path) {
  const f=s.fis,out=[],seed=s.seed,taper=s.fissureTaper,cum=[0];
  for (let k=1;k<path.length;k++) cum.push(cum[k-1]+Math.hypot(path[k].x-path[k-1].x,path[k].y-path[k-1].y));
  const L=cum[cum.length-1],longest=Math.max(16,Math.min(s.radius*1.5,60)),ends=(a,len) => { const e=len>0?Math.min(a/len,1-a/len):1; return 1-smooth(0,.3,e); };
  const taperW=u => 1-.7*taper*u,taperD=u => 1-.55*taper*u;
  if (path.length<2) out.push(mkPiece(path[0],null,1,1,1,1,0));
  for (let k=1;k<path.length;k++) {
    const a=path[k-1],b=path[k],len=cum[k]-cum[k-1],n=Math.max(1,Math.ceil(len/longest));
    for (let j=0;j<n;j++) {
      const f0=j/n,f1=(j+1)/n,e0=ends(cum[k-1]+len*f0,L),e1=ends(cum[k-1]+len*f1,L);
      out.push(mkPiece({x:a.x+(b.x-a.x)*f0,y:a.y+(b.y-a.y)*f0},{x:a.x+(b.x-a.x)*f1,y:a.y+(b.y-a.y)*f1},taperW(e0),taperW(e1),taperD(e0),taperD(e1),0));
    }
  }
  const N=Math.round(clamp(s.fissureBranches,0,12));
  if (N<1 || L<=0 || f.net) return out;
  const spread=s.fissureBranchSpread,rnd=(a,b) => rand01(seed,a,b+0x5f3);
  // grow(x,y,heading,len,w0,d0,id,level): a four-point line that narrows and shallows to its tip, with one fork at its middle on level 0.
  const grow=(x,y,heading,len,w0,d0,id,level) => {
    const step=len/3;
    let h=heading,px=x,py=y;
    for (let j=0;j<3;j++) {
      h+=(rnd(id,30+j)-.5)*.7;
      const nx=px+Math.cos(h)*step,ny=py+Math.sin(h)*step,u0=j/3,u1=(j+1)/3;
      out.push(mkPiece({x:px,y:py},{x:nx,y:ny},w0*(1-.75*taper*u0),w0*(1-.75*taper*u1),d0*(1-.7*taper*u0),d0*(1-.7*taper*u1),0));
      if (level===0 && j===1 && rnd(id,40)<.7) grow(nx,ny,h+(rnd(id,41)<.5?-1:1)*(.5+.6*rnd(id,42)),len*.5,w0*.7,d0*.85,id+100,1);
      px=nx; py=ny;
    }
  };
  for (let k=0;k<N;k++) {
    const at=L*(.08+.84*(k+.2+.6*rnd(k,11))/N),side=((k+(rnd(k,12)<.25?1:0))&1)?1:-1;
    let i=1; while (i<cum.length-1 && cum[i]<at) i++;
    const a=path[i-1],b=path[i],fr=(at-cum[i-1])/Math.max(cum[i]-cum[i-1],1e-6);
    grow(a.x+(b.x-a.x)*fr,a.y+(b.y-a.y)*fr,Math.atan2(b.y-a.y,b.x-a.x)+side*(.45+.95*spread)*(.7+.6*rnd(k,13)),s.fissureBranchLen*f.kf*(.5+.9*rnd(k,14)),.75,.85,k,0);
  }
  return out;
}
// A trench's cut fraction at distance d from the cut, half-width hw: full depth
// within three quarters of a cell of the cut (so a narrow or tapered cut still
// reaches every cell it crosses: a pointwise V narrower than the 2 px grid broke
// into dashes), then steep up to hw, and gone beyond.
function fissureProfile(d,hw,cellPx) {
  const lo=.75*cellPx,u=(d-lo)/Math.max(hw-lo,.35*cellPx);
  return u<=0?1:u>=1?0:Math.pow(1-u,1.5);
}
function fissureCell(s,i,wx,wy,lx,ly,cx,cy,t) {
  const f=s.fis,pc=s.piece;
  let g,near;
  if (f.net) {
    // Block borders: the distance (authoring px) from this point to the bisector of the two nearest sites of a jittered grid, with the grid itself warped a little.
    const C=f.cell,wxp=lx+C*.14*valueNoise(lx/(C*.9),ly/(C*.9),s.seed^0x2e1),wyp=ly+C*.14*valueNoise(lx/(C*.9),ly/(C*.9),s.seed^0x4d7);
    const ix=Math.floor(wxp/C),iy=Math.floor(wyp/C);
    let d1=1e30,d2=1e30,x1=0,y1=0,x2=0,y2=0;
    for (let j=-1;j<=1;j++) for (let k=-1;k<=1;k++) {
      const cxs=ix+k,cys=iy+j,sx=(cxs+.5+.42*hash(cxs,cys,s.seed^0x61)) * C,sy=(cys+.5+.42*hash(cxs,cys,s.seed^0x93)) * C,dd=(wxp-sx)*(wxp-sx)+(wyp-sy)*(wyp-sy);
      if (dd<d1) { d2=d1; x2=x1; y2=y1; d1=dd; x1=sx; y1=sy; } else if (dd<d2) { d2=dd; x2=sx; y2=sy; }
    }
    const e=(d2-d1)/(2*Math.max(Math.hypot(x2-x1,y2-y1),1e-3)),hw=f.hw/f.kf,reg=1-smooth(.55,1,Math.hypot(wx-cx,wy-cy)/s.radius);
    // Each border cut has its own depth and its own width, wobbling along it.
    const vary=.65+.35*valueNoise(lx/(C*.5),ly/(C*.5),s.seed^0x7a9),wob=1+f.jag*.5*valueNoise(lx/9,ly/9,s.seed^0x1f3);
    g=fissureProfile(e,hw*wob,spacing)*vary*reg; near=(1-smooth(0,1,e/(hw*3+3)))*reg;
  } else {
    const rm=pc?pc.r0+(pc.r1-pc.r0)*t:1,hm=pc?pc.h0+(pc.h1-pc.h0)*t:1,hw=f.hw*rm;
    let dx=wx-cx,dy=wy-cy;
    if (f.jag>0) {
      dx+=f.amp*(.7*valueNoise(lx/23,ly/23,s.seed^0x5a1)+.5*valueNoise(lx/9,ly/9,s.seed^0x3c7));
      dy+=f.amp*(.7*valueNoise(lx/23,ly/23,s.seed^0x6b5)+.5*valueNoise(lx/9,ly/9,s.seed^0x2d3));
    }
    const d=Math.hypot(dx,dy);
    g=fissureProfile(d,hw,spacing)*hm*(1-.5*f.jag*(.5-.5*valueNoise(lx/17,ly/17,s.seed^0x7e1))); near=1-smooth(0,1,d/(hw*3+3));
  }
  // The crack field rises beside the cut whatever the depth there; the cut itself is a union by depth.
  if (near>0 && f.crack>0) cracks[i]=Math.max(cracks[i],f.crack*near);
  if (g<=s.weights[i]) return;
  s.weights[i]=g;
  // A cut in dry ground stays dry (as a crater's floor does): it never opens a pond.
  const cut=s.base[i]-s.amount*g;
  heights[i]=clamp(s.base[i]>config.seaLevel+1?Math.max(cut,config.seaLevel+1.5):cut,MIN_HEIGHT,MAX_HEIGHT);
  protection[i]=s.protectBase[i]*(1-smooth(0,.3,g)); routes[i]=s.routeBase[i]*(1-smooth(0,.3,g));
  if (s.masks) paintCell(s.masks,i,smooth(0,.3,g)*f.dark);
}
function dab(s,p,spanEnd=null,frameStart=null,frameEnd=null) {
  const naturalWater=s.kind==='deep' && NATURAL_COAST;
  const naturalPlateau=(s.kind==='plateau' || s.kind==='offset' || s.kind==='erase' || isCover(s.kind)) && experiment.get('edges')==='natural';
  const shoulderedHill=s.shouldered;
  const waterTool=s.kind==='deep' || s.kind==='shallow';
  const bankScale=waterTool?2**((s.bankWidth-.5)*1.3):1;
  // Dry bank of a fixed width on the ground (Lava; 0 keeps the old share).
  const bankPx=waterTool && !s.prof?(s.bankPx??0):0;
  const faceWidth=.66+(s.softness-.5)*.9,backWidth=s.softness===.5?1.34:2-faceWidth;
  // A ridge piece (card C4) scales this dab's width and wobble; null leaves every value as before.
  const pc=s.piece,radius=s.radius,amp=s.rough*radius*(naturalWater ? 1.1 : naturalPlateau ? .95 : shoulderedHill ? .85 : s.kind==='crater' ? .45 : .2)*(pc?pc.mean:1);
  const macro=naturalWater || naturalPlateau;
  const noiseX=macro?s.noise.coastX:s.noise.x,noiseY=macro?s.noise.coastY:s.noise.y;
  const nx=sample(noiseX,p.x,p.y),ny=sample(noiseY,p.x,p.y);
  const spanX=spanEnd?spanEnd.x-p.x:0,spanY=spanEnd?spanEnd.y-p.y:0,spanLength2=spanX*spanX+spanY*spanY;
  let face=s.face;
  if (shoulderedHill && spanLength2>0) {
    s.faceSide ??= (-spanY*s.face[0]+spanX*s.face[1])<0?-1:1;
    const length=Math.sqrt(spanLength2),sign=s.faceSide;
    face=[-spanY/length*sign,spanX/length*sign];
  }
  const crater=s.kind==='crater';
  // URL knobs are read once per dab, never per cell (a lookup per cell was
  // half the cost of moving a lake).
  const coreEdge=experiment.has('coreEdge')?Number(experiment.get('coreEdge')):.38;
  const faceVariation=s.faceVariation??.8;
  const bumpy=['hill','mountain','lower'].includes(s.kind);
  // TA's view squashes faces that rise toward the camera; widen them (new shapes).
  const northWiden=s.northFace??0;
  const extent=s.fis?s.fis.reach:crater?radius*1.9*(1+.45*s.rough)+2*amp:radius*(pc?pc.reach:1)*(naturalWater?Math.min(1.9,1+s.rough*1.6):naturalPlateau?Math.min(1.7,1+s.rough*1.3):shoulderedHill?Math.max(1.4,backWidth):1)*bankScale+2*amp+bankPx;
  let x0=clamp(Math.floor((Math.min(p.x,spanEnd?.x??p.x)-extent)/spacing),0,grid-1),x1=clamp(Math.ceil((Math.max(p.x,spanEnd?.x??p.x)+extent)/spacing),0,grid-1);
  let y0=clamp(Math.floor((Math.min(p.y,spanEnd?.y??p.y)-extent)/spacing),0,grid-1),y1=clamp(Math.ceil((Math.max(p.y,spanEnd?.y??p.y)+extent)/spacing),0,grid-1);
  if (clip) { x0=Math.max(x0,clip.x0); x1=Math.min(x1,clip.x1); y0=Math.max(y0,clip.y0); y1=Math.min(y1,clip.y1); }
  // Draft (while a shape is dragged): every other cell is computed and its
  // change copied to its three neighbours; release evaluates every cell.
  const step=draft?2:1;
  const copyCell=(i,j) => {
    if (shoulderedHill?s.distances[j]<s.distances[i]:s.weights[j]>=s.weights[i]) return;
    if (shoulderedHill) s.distances[j]=s.distances[i];
    s.weights[j]=s.weights[i]; heights[j]=clamp(s.base[j]+heights[i]-s.base[i],MIN_HEIGHT,MAX_HEIGHT); protection[j]=protection[i]; routes[j]=routes[i]; cover[j]=cover[i];
    if (s.masks) copyMask(s.masks,i,j);
  };
  const spread=(i,x,y) => { if (x<x1) copyCell(i,i+1); if (y<y1) { copyCell(i,i+grid); if (x<x1) copyCell(i,i+grid+1); } };
  for (let y=y0;y<=y1;y+=step) for (let x=x0;x<=x1;x+=step) {
    const i=y*grid+x,wx=x*spacing,wy=y*spacing,inv=s.inv;
    // Authoring-frame position for noise evaluated directly from position.
    const lx=inv?inv[0]*wx+inv[2]*wy+inv[4]:wx,ly=inv?inv[1]*wx+inv[3]*wy+inv[5]:wy;
    const t=spanLength2?clamp(((wx-p.x)*spanX+(wy-p.y)*spanY)/spanLength2,0,1):0;
    const cx=p.x+spanX*t,cy=p.y+spanY*t;
    if (s.fis) { fissureCell(s,i,wx,wy,lx,ly,cx,cy,t); if (step>1) spread(i,x,y); continue; }
    if (crater) {
      // Retail lunar craters: a lobed outline, a rim that rises and falls
      // (with gaps), an off-centre lumpy bowl and an uneven apron. All of the
      // variation is position-based noise from the crater's own seed.
      const sc=Math.max(radius*.55,8),n0=valueNoise(lx/(radius*.95),ly/(radius*.95),s.seed^0x4a7),n1=valueNoise(lx/sc,ly/sc,s.seed^0x1c3),n2=valueNoise(lx/(sc*.6),ly/(sc*.6),s.seed^0x2d9);
      const lobe=1+s.rough*(.38*n0+.22*n1+.1*n2);
      const off=s.craterOffset;
      const dx=wx-cx-off[0]*radius*.32*s.rough,dy=wy-cy-off[1]*radius*.32*s.rough;
      const rr=Math.hypot(wx-cx,wy-cy)/(radius*lobe),rb=Math.hypot(dx,dy)/(radius*lobe);
      if (rr>=1.9) continue;
      const influence=1-rr/1.9;
      if (influence<=s.weights[i]) continue;
      s.weights[i]=influence;
      const floorEdge=.25+.45*(1-s.softness);
      const rimNoise=valueNoise(lx/(sc*.8),ly/(sc*.8),s.seed^0x3e1);
      // Low-frequency rim noise lets whole sectors of rim sink away.
      let rimHeight=s.amount*s.rimHeight*clamp(1.1*(rimNoise*.5+.5)+.5*n0*s.rough-.15*s.rough,0,1.5);
      const rimWidth0=(.16+.2*s.softness)*(1+.35*n2);
      let rimWidth=rimWidth0;
      // Sectors and gaps (card C4), by angle in the shape's own frame.
      if (s.rim) { const f=rimFactors(s.rim,Math.atan2(wy-cy,wx-cx)-Math.atan2(s.rot[1],s.rot[0])); rimHeight*=f[0]; rimWidth*=f[1]; }
      const bowl=rb<1?1-smooth(floorEdge,1,rb):0;
      const apronReach=1-smooth(1.15+.35*n1,1.85,rr);
      // A wide sector broadens the rim on its inner side; the outer apron keeps the ring's own width,
      // and falls away faster with sectors or gaps, as the steep outer slope of a retail broken rim does.
      const rim=rr<1?Math.exp(-(((rr-1)/rimWidth)**2)):Math.exp(-(((rr-1)/(rimWidth0*(s.rim?1.4:2.4)))**2))*apronReach;
      const lumps=s.rough*(6*n2+3*n1+2*s.noise.detail[i])*(rr<1.3?1:0);
      // Ejecta: beyond the rim the throw-out breaks into scattered,
      // ragged patches that thin outward (retail lunar sections).
      let ejecta=0;
      if (s.craterEjecta>0 && rr>.8) {
        const e1=valueNoise(lx/(sc*.32),ly/(sc*.32),s.seed^0x6e7),e2=valueNoise(lx/(sc*.14),ly/(sc*.14),s.seed^0x1b5);
        const reach=1.25+.45*(n0*.5+.5);
        ejecta=s.craterEjecta*s.amount*.16*smooth(-.05,.45,e1*.7+e2*.3)*(1-smooth(1.0,reach+.25,rr))*smooth(.8,1.0,rr)*(.6+.4*e2);
      }
      const floor=Math.max(s.baseline-s.amount,Math.min(s.baseline,config.seaLevel+4));
      const target=s.baseline+rimHeight*rim-(s.baseline-floor)*bowl+lumps*(.4+.6*bowl);
      const blend=smooth(0,.15,1-rr);
      const value=(rr<1?s.base[i]+(target-s.base[i])*blend+(rr>=.85?(rimHeight*rim+lumps*.4)*(1-blend):0):s.base[i]+rimHeight*rim+lumps*.3*apronReach)+ejecta;
      // A crater on dry ground stays dry: floor lumps never dip into the sea.
      heights[i]=clamp(s.base[i]>config.seaLevel+1?Math.max(value,config.seaLevel+1.5):value,MIN_HEIGHT,MAX_HEIGHT);
      protection[i]=s.protectBase[i]*(1-smooth(0,.3,influence)); routes[i]=s.routeBase[i]*(1-smooth(0,.3,influence));
      if (step>1) spread(i,x,y);
      continue;
    }
    if (shoulderedHill) {
      const d2=(wx-cx)**2+(wy-cy)**2;
      if (d2>s.distances[i]) continue;
      s.distances[i]=d2;
    }
    // Outline displacement, turned with the shape's frame.
    const ex=noiseX[i]-(spanLength2?sample(noiseX,cx,cy):nx),ey=noiseY[i]-(spanLength2?sample(noiseY,cx,cy):ny);
    const dx=wx-cx+amp*(s.rot[0]*ex-s.rot[1]*ey);
    const dy=wy-cy+amp*(s.rot[1]*ex+s.rot[0]*ey);
    // The line anchors the channel; broad world-space fields move its banks
    // independently and vary its width. Repeated dabs do not add fresh noise.
    const width=naturalWater?clamp(1+s.rough*1.6*s.noise.coastWidth[i],.45,1.9):naturalPlateau?clamp(1+s.rough*1.3*s.noise.coastWidth[i],.55,1.7):1;
    let r=Math.sqrt(dx*dx+dy*dy)/(radius*width*bankScale);
    if (pc) r/=pc.r0+(pc.r1-pc.r0)*t;
    if (waterTool && s.fingers>0 && r>(s.fingerBlunt>=.5?.1:.25) && r<1.6) {
      // Shift the waterline across the coast band (coast near r 0.67). Thumbs
      // reach tens of px, so their band is set in px, not as a share of a small lake.
      const len=Math.sqrt(dx*dx+dy*dy)||1,band=1-smooth(.45,.9,Math.abs(r-.67)*(s.fingerBlunt>=.5?Math.min(1,radius*width*bankScale/180):1));
      if (band>0 && s.fingerBlunt>=.5) {
        // Thumbs read the ribs at the coast point on this cell's radial line, so every
        // cell along the line gets one shift: a finger is a solid prism from the
        // coast to its tip and cannot leave islets in the lava. A small lake grows shorter
        // fingers (its few fingers would make a star).
        const along=(.67*radius*width*bankScale-len)/len,fx=wx+dx*along,fy=wy+dy*along,gx=Math.round(fx/spacing),gy=Math.round(fy/spacing);
        r+=band*fingerShift(s,gx>=0 && gy>=0 && gx<grid && gy<grid?gy*grid+gx:-1,gx*spacing,gy*spacing,dx/len,dy/len,s.fingers*clamp(radius*width*bankScale/140,.35,1))/(radius*width*bankScale);
      }
      else if (band>0) r+=band*fingerShift(s,i,wx,wy,dx/len,dy/len,s.fingers)/(radius*width*bankScale);
    }
    if (bankPx>0 && s.base[i]>config.seaLevel) {
      // Retail Lava banks keep one width whatever the lake's size: the
      // profile's 50/80/90% rises sit ~14/31/39 px from the lava on Kill the
      // Middle, the shape of this brush's dry part stretched to ~60 px
      // (measure/lava_coasts.py bank). Stretch the dry part (from this
      // cell's waterline out) to bankPx; the waterline stays put.
      const bed=config.seaLevel+(s.kind==='deep'?-55:-7)+(naturalWater?42*smooth(-.15,.55,s.noise.shelf[i])*s.shelves:0);
      const y=1-(s.base[i]-config.seaLevel)/(s.base[i]-bed);
      const rw=.1+.9*(.5-Math.sin(Math.asin(clamp(1-2*y,-1,1))/3));
      if (r>rw) r=rw+(r-rw)*(1-rw)*radius*width*bankScale/bankPx;
    }
    // A continuous deep core follows the unwarped stroke. Automatic shelves
    // cannot close it; an explicit later shallow-water stroke can cross it.
    const core=naturalWater?1-smooth(.20,coreEdge,Math.sqrt((wx-cx)**2+(wy-cy)**2)/radius):0;
    if (r>=1 && !core && !shoulderedHill) continue;
    let w;
    if (s.kind==='plateau' || s.kind==='offset' || s.kind==='erase' || isCover(s.kind)) {
      // Independently vary shoulder width around the level core. An irregular
      // outline with an identical cross-section still makes a uniform rim.
      // Face width varies along the outline at a broad scale too, so a cliff
      // band does not keep one width round a smooth arc (blind round 3).
      const broadFace=valueNoise(lx/(radius*1.3),ly/(radius*1.3),s.seed^0x5f1);
      const originalShoulder=naturalPlateau?clamp(.56+s.rough*(s.noise.detail[i]+.30*s.noise.coastWidth[i])+faceVariation*.22*broadFace,.18,.88):.62;
      // A face whose outward side looks north (-y) is foreshortened to a
      // hairline in the oblique view; start it farther in so it is gentler.
      const north=northWiden>0?Math.max(0,-(wy-cy))/Math.max(1e-3,Math.hypot(wx-cx,wy-cy)):0;
      const shoulder=clamp(originalShoulder-(s.softness-.5)*.6-northWiden*.32*north*north,.12,.90);
      w=1-smooth(shoulder,1,r);
      if (s.kind==='plateau' && s.mesaFlank>0) {
        // Retail Painted Desert mesas (repro/scenes/desert.json): a narrow
        // cap (its edge at 0.55 of the shoulder) breaks sharply into a flank
        // that falls almost evenly, easing only toward the foot, so the beds
        // spread over most of the footprint. Same outline and foot.
        const cap=shoulder*(1-.45*s.mesaFlank),t=clamp((r-cap)/(1-cap),0,1);
        w=w+((1-t)*(1-t)+(1-smooth(0,1,t))*t-w)*s.mesaFlank;
      }
    }
    else if (s.kind==='deep' || s.kind==='shallow') w=1-smooth(.10,1,r);
    else if (s.kind==='hill') {
      if (shoulderedHill) {
        // Authored approximation of native shoulder/face asymmetry, not a
        // recovered universal profile. The path anchors a common crest, so
        // turning the local shoulder direction cannot split that crest.
        let fx=face[0],fy=face[1];
        if (frameStart) {
          fx=frameStart[0]*(1-t)+frameEnd[0]*t; fy=frameStart[1]*(1-t)+frameEnd[1]*t;
          const length=Math.hypot(fx,fy);
          if (length>1e-5) { fx/=length; fy/=length; } else { fx=face[0]; fy=face[1]; }
        }
        const localRadius=radius*(1+s.rough*.75*s.noise.shelf[i]);
        const u=(dx*fx+dy*fy)/localRadius;
        const v=(-dx*fy+dy*fx)/localRadius;
        const cross=u-s.rough*.18*s.noise.detail[i];
        const along=cross/(cross<0?backWidth:faceWidth);
        const sideWidth2=1-along*along;
        const section=s.softness===.5?(cross+1.34)/2:cross<0?.67*(1+cross/backWidth):.67+.33*cross/faceWidth;
        w=sideWidth2>v*v?hillSection(section)*(1-v*v/sideWidth2)**2:0;
      } else w=(1-r*r)**2;
    }
    else if (s.kind==='mountain') w=(1-r*r)**(3.5*2**((.5-s.softness)*1.5));
    else w=1-smooth(0,1,r);
    if (s.prof) w=crossSection(s,i,r,radius*width*bankScale);
    if (pc) w*=ridgeRise(s,pc,t,lx,ly,wx,wy);
    if (bumpy && !shoulderedHill) w=clamp(w*(1+s.rough*.09*s.noise.detail[i]),0,1);
    // Most brushes union influences; the swept hill instead uses its nearest
    // curve section. Neither adds height merely because the pointer dwells.
    const influence=Math.max(w,core);
    if (!shoulderedHill && influence<=s.weights[i]) continue;
    s.weights[i]=influence; const base=s.base[i]; let value=base;
    if (s.kind==='plateau') value=base+(s.baseline+s.amount+s.rough*3*s.noise.detail[i]-base)*w;
    else if (s.kind==='offset') value=base+s.amount*w;
    else if (s.kind==='erase') {
      // Plain ground: back to the dry base, and its cracks close.
      value=base+(config.baseHeight-base)*w; cracks[i]=s.crackBase[i]*(1-w); cover[i]=s.coverBase[i]*(1-w); crystal[i]=s.crystalBase[i]*(1-w);
      paintCell(s.masks,i,w);
    }
    else if (s.kind==='paint') paintCell(s.masks,i,w*clamp(s.amount/100,0,1));
    else if (isCover(s.kind)) {
      // Cover only: +1 sand, -1 the world's ground; heights stay.
      const target=s.kind==='sand'?1:-1;
      cover[i]=s.coverBase[i]+(target-s.coverBase[i])*w*clamp(s.amount/100,0,1);
    }
    else if (s.kind==='hill' || s.kind==='mountain') value=base+s.amount*w*(shoulderedHill?hillLift(s,i):1);
    else if (s.kind==='lower') value=base-s.amount*w;
    else if (s.kind==='deep' || s.kind==='shallow') {
      let bed=config.seaLevel+(s.kind==='deep'?-55:-7);
      if (naturalWater) {
        // Uneven shelves belong to the bed, not a fixed-width blue outline.
        // The deepest centre follows the input; later shallow strokes still
        // set their own continuous bed and protection mask in the usual way.
        const shelf=smooth(-.15,.55,s.noise.shelf[i])*smooth(.08,.50,r);
        bed+=42*shelf*s.shelves;
      }
      value=base+(bed-base)*w;
      if (naturalWater && core) value=Math.min(value,base+(config.seaLevel-55-base)*core);
      // Reshape only the dry part of an ordinary low bank. The waterline,
      // guided deep bed and elevated coastal terrain retain their positions.
      if (s.beachFlatness!==.5 && !s.prof && base>config.seaLevel && base<=config.baseHeight+1 && value>config.seaLevel) {
        const above=(value-config.seaLevel)/(base-config.seaLevel);
        value=config.seaLevel+(base-config.seaLevel)*above**(2**((s.beachFlatness-.5)*2.4));
      }
      // Passage authoring raises only the submerged bed. Keeping the existing
      // bank avoids a narrow canal cut into each dry-land approach.
      if (s.kind==='shallow' && s.shallowMode==='passage') value=Math.max(base,value);
    }
    else if (s.kind==='smooth') value=base+(s.smoothTarget[i]-base)*w*clamp(s.amount/100,0,1);
    if (s.prof) value+=sectionLift;
    heights[i]=clamp(value,MIN_HEIGHT,MAX_HEIGHT);
    if (s.kind!=='smooth' && value!==base) routes[i]=s.routeBase[i]*(1-influence);
    // Design intent survives weathering: buildable crests and shallow routes
    // are protected, while new hills reopen the affected slopes to weathering.
    if (s.kind==='shallow' && s.shallowMode==='passage' && value===base) protection[i]=s.protectBase[i];
    else if (s.kind==='plateau' || s.kind==='shallow') protection[i]=Math.max(s.protectBase[i]*(1-w),smooth(.65,.95,w));
    // A raised or lowered area keeps the ground's own protection; only its
    // new edge faces open to weathering.
    else if (s.kind==='offset') protection[i]=s.protectBase[i]*(1-4*w*(1-w));
    else if (s.kind!=='smooth' && !isCover(s.kind)) protection[i]=s.protectBase[i]*(1-influence);
    if (step>1) spread(i,x,y);
  }
  heightDirty=true;
}
// A stroke is replayed along its path simplified to a small tolerance, one
// swept segment (a capsule) per piece. Its cost follows the path's length,
// not how many pointer events drew it: a mountain drawn slowly once replayed
// a dab per event, over a second a frame while it was being moved.
function simplifyPath(points,tolerance) {
  if (points.length<3) return points.slice();
  const keep=new Uint8Array(points.length); keep[0]=keep[points.length-1]=1;
  const stack=[[0,points.length-1]];
  while (stack.length) {
    const [a,b]=stack.pop(),pa=points[a],pb=points[b],dx=pb.x-pa.x,dy=pb.y-pa.y,l2=dx*dx+dy*dy;
    let worst=-1,at=-1;
    for (let k=a+1;k<b;k++) {
      const q=points[k],t=l2?clamp(((q.x-pa.x)*dx+(q.y-pa.y)*dy)/l2,0,1):0,d=Math.hypot(q.x-pa.x-dx*t,q.y-pa.y-dy*t);
      if (d>worst) { worst=d; at=k; }
    }
    if (worst>tolerance) { keep[at]=1; stack.push([a,at],[at,b]); }
  }
  return points.filter((_,k) => keep[k]);
}
function sweep(s,points) {
  if (s.ridge || s.fis) { sweepRidge(s,points); return; }
  const path=simplifyPath(points,Math.max(1,s.radius*.04)),longest=Math.max(16,s.radius*1.5);
  dab(s,path[0]);
  for (let k=1;k<path.length;k++) {
    // Long diagonal pieces are split so each capsule's box stays tight.
    const a=path[k-1],b=path[k],pieces=Math.ceil(Math.hypot(b.x-a.x,b.y-a.y)/longest);
    for (let j=0;j<pieces;j++) dab(s,{x:a.x+(b.x-a.x)*j/pieces,y:a.y+(b.y-a.y)*j/pieces},{x:a.x+(b.x-a.x)*(j+1)/pieces,y:a.y+(b.y-a.y)*(j+1)/pieces});
  }
  s.path=points.slice(); s.last=s.end=points[points.length-1];
}
// Shared shore plates: geometry belongs to the water stroke, so Crystal and
// Red can reuse it with their own ground materials. Heights above sea are
// explicit; no world-wide coast inference or material-tag channel is needed.
function stampShorePlates(s) {
  const water=Math.max(0,s.plateWaterPx),land=Math.max(0,s.plateLandPx),reach=Math.max(water,land);
  if (!reach) return;
  const raw=heights.slice(),distance=new Float32Array(raw.length).fill(reach+spacing*2),sea=config.seaLevel;
  // Seed only coast segments this stroke actually touched. Fractional edge
  // crossings keep the band in pixels, independent of the height range.
  for (let y=0;y<grid;y++) for (let x=0;x<grid;x++) {
    const i=y*grid+x;
    for (const j of [x+1<grid?i+1:-1,y+1<grid?i+grid:-1]) {
      if (j<0 || (s.weights[i]<=0 && s.weights[j]<=0) || (raw[i]>sea)===(raw[j]>sea)) continue;
      const d=Math.abs(raw[i]-sea)/Math.max(1e-6,Math.abs(raw[i]-raw[j]))*spacing;
      distance[i]=Math.min(distance[i],d); distance[j]=Math.min(distance[j],spacing-d);
    }
  }
  // Distance is approximate on the height grid, especially near diagonal
  // coasts; two linear passes avoid a per-pixel coast search.
  const diagonal=spacing*Math.SQRT2;
  for (let y=0;y<grid;y++) for (let x=0;x<grid;x++) {
    const i=y*grid+x; let d=distance[i];
    if (x) d=Math.min(d,distance[i-1]+spacing);
    if (y) { d=Math.min(d,distance[i-grid]+spacing); if (x) d=Math.min(d,distance[i-grid-1]+diagonal); if (x+1<grid) d=Math.min(d,distance[i-grid+1]+diagonal); }
    distance[i]=d;
  }
  for (let y=grid-1;y>=0;y--) for (let x=grid-1;x>=0;x--) {
    const i=y*grid+x; let d=distance[i];
    if (x+1<grid) d=Math.min(d,distance[i+1]+spacing);
    if (y+1<grid) { d=Math.min(d,distance[i+grid]+spacing); if (x) d=Math.min(d,distance[i+grid-1]+diagonal); if (x+1<grid) d=Math.min(d,distance[i+grid+1]+diagonal); }
    distance[i]=d;
  }
  if (s.plateMaterial>=.5) { stampShoreSlabs(s,raw,distance,sea,water,land); return; }
  const L=Math.max(8,s.plateSize),gap=Math.max(0,s.plateGap)*.5,inv=s.inv,scale=inv?1/Math.hypot(inv[0],inv[1]):1;
  const cells=new Map(),cell=(x,y) => {
    const key=x+','+y; let c=cells.get(key);
    if (!c) { c={x:(x+.5+hash(x,y,s.seed^0x481)*.38)*L,y:(y+.5+hash(x,y,s.seed^0x287)*.38)*L,keep:hash(x,y,s.seed^0x721)*.5+.5,ridge:hash(x,y,s.seed^0x51f)>.1}; cells.set(key,c); }
    return c;
  };
  for (let y=0;y<grid;y++) for (let x=0;x<grid;x++) {
    const i=y*grid+x,wet=raw[i]<=sea,width=wet?water:land,d=distance[i];
    if (!width || d>=width) continue;
    const wx=x*spacing,wy=y*spacing,lx=inv?inv[0]*wx+inv[2]*wy+inv[4]:wx,ly=inv?inv[1]*wx+inv[3]*wy+inv[5]:wy,ci=Math.floor(lx/L),cj=Math.floor(ly/L);
    let best=null,next=null,d1=Infinity,d2=Infinity;
    for (let v=cj-1;v<=cj+1;v++) for (let u=ci-1;u<=ci+1;u++) {
      const c=cell(u,v),q=(lx-c.x)**2+(ly-c.y)**2;
      if (q<d1) { d2=d1;next=best;d1=q;best=c; } else if (q<d2) { d2=q;next=c; }
    }
    const edge=(d2-d1)/(2*Math.max(1,Math.hypot(best.x-next.x,best.y-next.y)))*scale+valueNoise(lx/5,ly/5,s.seed^0x317)*1.2;
    const support=1-smooth(.2,1,d/width),plate=smooth(gap,gap+spacing*.6,edge);
    if (wet) {
      // Offshore plate coverage thins; gaps keep the original bed and paint.
      if (best.keep>support || plate<=0) continue;
      heights[i]=clamp(raw[i]+(Math.max(raw[i],sea+s.plateHeight)-raw[i])*plate,MIN_HEIGHT,MAX_HEIGHT);
      protection[i]=Math.max(protection[i],plate); routes[i]=Math.max(routes[i],plate); cover[i]=Math.min(cover[i],-plate);
    } else if (best.ridge && next.ridge) {
      // Sparse straight polygon edges make short raised pressure ridges;
      // untouched land retains its original relief between them.
      const ridge=Math.max(0,1-Math.abs(edge-gap-2)/2)*support;
      if (ridge<=0) continue;
      heights[i]=clamp(raw[i]+ridge*Math.min(3,s.plateHeight),MIN_HEIGHT,MAX_HEIGHT);
      protection[i]=Math.max(protection[i],ridge); routes[i]=Math.max(routes[i],ridge); cover[i]=Math.min(cover[i],-ridge);
    }
  }
  heightDirty=true;
}

// Rock slabs (card C2, Crystal): the same band, but a web of low flat slabs
// that interlock along the waterline, as retail Crystal's shores do (census
// crystal-low-shore-slabs: plates 12-80 px, bands 40-140 px, dark seams a few
// px wide on the land rim and across the shallow shelf). Seams are the crystal
// field's edge mark, which the shader inks black; slab interiors carry its
// brightness mark. On land the slabs stand up to plateHeight above their
// seams. Under water they are a shallow ledge (the bed lifted to 2.2-3.2 units
// down, never above the waterline), and the water shader reads the same marks
// (crystalSeam) to paint the seams and a paler slab fill over the ledge. Slabs
// thin out with the distance from this stroke's own waterline and stop at the
// band's width, so two shores join only where their bands meet; nothing here is
// ever raised above the sea.
function stampShoreSlabs(s,raw,distance,sea,water,land) {
  const L=Math.max(8,s.plateSize),seam=Math.max(spacing*.5,Math.max(0,s.plateGap)*.5),inv=s.inv,scale=inv?1/Math.hypot(inv[0],inv[1]):1;
  const cells=new Map(),cell=(x,y) => {
    const key=x+','+y; let c=cells.get(key);
    if (!c) { c={x:(x+.5+hash(x,y,s.seed^0x481)*.4)*L,y:(y+.5+hash(x,y,s.seed^0x287)*.4)*L,keep:hash(x,y,s.seed^0x721)*.5+.5,shade:.8+.2*(hash(x,y,s.seed^0x3b9)*.5+.5),lift:hash(x,y,s.seed^0x6d3)*.5+.5}; cells.set(key,c); }
    return c;
  };
  for (let y=0;y<grid;y++) for (let x=0;x<grid;x++) {
    const i=y*grid+x,wet=raw[i]<=sea,width=wet?water:land,d=distance[i];
    if (!width || d>=width) continue;
    const wx=x*spacing,wy=y*spacing,lx=inv?inv[0]*wx+inv[2]*wy+inv[4]:wx,ly=inv?inv[1]*wx+inv[3]*wy+inv[5]:wy,ci=Math.floor(lx/L),cj=Math.floor(ly/L);
    let best=null,next=null,d1=Infinity,d2=Infinity;
    for (let v=cj-1;v<=cj+1;v++) for (let u=ci-1;u<=ci+1;u++) {
      const c=cell(u,v),q=(lx-c.x)**2+(ly-c.y)**2;
      if (q<d1) { d2=d1;next=best;d1=q;best=c; } else if (q<d2) { d2=q;next=c; }
    }
    if (best.keep>1-smooth(.2,1,d/width)) continue;
    const edge=(d2-d1)/(2*Math.max(1,Math.hypot(best.x-next.x,best.y-next.y)))*scale+valueNoise(lx/6,ly/6,s.seed^0x317)*.5,seamed=edge<seam;
    crystal[i]=seamed?.5:best.shade; protection[i]=1;
    if (wet) heights[i]=clamp(Math.max(raw[i],sea-3.2+best.lift),MIN_HEIGHT,MAX_HEIGHT);
    else if (!seamed) heights[i]=clamp(raw[i]+best.lift*s.plateHeight,MIN_HEIGHT,MAX_HEIGHT);
  }
  heightDirty=true;
}

// Crystals: clusters of faceted crystals. Each is a pyramid over a polygon
// of n sides whose apex may lean off centre; its surface is the lowest of its
// face planes, so faces are flat and meet at sharp edges. Flat tops cut it
// level (0 pointed, near 1 a flat-topped prism). Crystals in a cluster join
// by the highest; cells they cover are marked so the bake keeps faces clean.
// Placement, sizes and sides come from the shape's seed.
function crystalList(s) {
  const rnd=(k,a) => { let x=Math.imul((s.seed>>>0)+k*7919+a*104729,2654435761)>>>0; x^=x>>>15; x=Math.imul(x,2246822519)>>>0; x^=x>>>13; return (x>>>0)/4294967296; };
  const path=simplifyPath(s.path,Math.max(1,s.radius*.05)),lengths=[0];
  for (let k=1;k<path.length;k++) lengths.push(lengths[k-1]+Math.hypot(path[k].x-path[k-1].x,path[k].y-path[k-1].y));
  const total=lengths[lengths.length-1],count=Math.max(1,Math.round(s.crystalCount*(1+total/Math.max(8,s.radius*1.2))));
  const variation=s.crystalVariation,turn=Math.atan2(s.rot[1],s.rot[0]),scale=s.inv?1/Math.hypot(s.inv[0],s.inv[1]):1,crystalSize=s.crystalSize*scale,out=[];
  for (let k=0;k<count;k++) {
    // Along the path by length, then within the brush radius; denser and
    // taller toward the middle of the cluster. Offsets and lean turn with
    // the frame; width scales with it, as the cluster radius already does.
    const along=rnd(k,1)*total; let j=1; while (j<path.length-1 && lengths[j]<along) j++;
    const a=path[j-1],b=path[j]||a,f=lengths[j]>lengths[j-1]?(along-lengths[j-1])/(lengths[j]-lengths[j-1]):0;
    const spread=Math.pow(rnd(k,2),.8),angle=rnd(k,3)*Math.PI*2+turn;
    const cx=a.x+(b.x-a.x)*f+Math.cos(angle)*spread*s.radius,cy=a.y+(b.y-a.y)*f+Math.sin(angle)*spread*s.radius;
    const width=crystalSize*(1+variation*(rnd(k,4)-.5)*1.2)*(1-.4*spread);
    const height=s.amount*(1-.45*spread)*(1+variation*(rnd(k,5)-.5))*Math.min(1.3,width/(Math.max(4,s.crystalSize)*scale));
    const sides=clamp(Math.round(s.crystalSides+variation*(rnd(k,6)-.5)*2.4),3,12);
    const R=width/2,lean=s.crystalLean*R*.75*rnd(k,7),leanAngle=rnd(k,8)*Math.PI*2+turn;
    const edges=Array.from({length:sides},(_,e) => {
      const t=turn+rnd(k,9)*Math.PI*2+(e+.5)*Math.PI*2/sides;
      return {nx:Math.cos(t),ny:Math.sin(t),d:R*Math.cos(Math.PI/sides)*(1+s.rough*.35*(rnd(k,20+e)-.5))};
    });
    out.push({x:cx,y:cy,R,height:Math.max(1,height),lx:Math.cos(leanAngle)*lean,ly:Math.sin(leanAngle)*lean,edges});
  }
  return out;
}
// Column mound (retail Crystal sections, measure/crystal_geometry.py): a
// mound tiled with flat polygonal columns in a random Voronoi pattern (tops
// ~15 px, mostly 5-6 sides), each top tilted with the mound and stepped up
// or down from its neighbours (median ~16 units, ~40% flush). Crystal cells
// carry the column's brightness jitter (0.8-1.0) and mark the edges between
// columns (0.5), where the shader inks the outline.
function stampColumns(s) {
  const c=clip||{x0:0,y0:0,x1:grid-1,y1:grid-1},path=simplifyPath(s.path,Math.max(1,s.radius*.05));
  const R=s.radius,H=s.amount,L=Math.max(4,s.crystalSize),inv=s.inv;
  const rnd=(i,j,a) => { let x=Math.imul(i*73856093^j*19349663^((s.seed>>>0)+a*83492791),2654435761)>>>0; x^=x>>>15; x=Math.imul(x,2246822519)>>>0; x^=x>>>13; return (x>>>0)/4294967296; };
  // The mound: highest along the stroke, falling to zero at an uneven edge.
  const mound=(x,y) => {
    let d=Infinity;
    for (let k=0;k<path.length;k++) {
      const a=path[k],b=path[Math.min(k+1,path.length-1)],dx=b.x-a.x,dy=b.y-a.y,l2=dx*dx+dy*dy;
      const t=l2?clamp(((x-a.x)*dx+(y-a.y)*dy)/l2,0,1):0; d=Math.min(d,Math.hypot(x-a.x-dx*t,y-a.y-dy*t));
    }
    const edge=R*(1+s.rough*.35*valueNoise(x/(R*.7),y/(R*.7),s.seed^0x2c1));
    const r=d/edge; return r>=1?0:H*Math.pow(1-r*r,1.2);
  };
  const pad=R*1.4;
  let ax=Infinity,ay=Infinity,bx=-Infinity,by=-Infinity; for (const p of path) { ax=Math.min(ax,p.x); ay=Math.min(ay,p.y); bx=Math.max(bx,p.x); by=Math.max(by,p.y); }
  const rect={x0:Math.max(c.x0,Math.floor((ax-pad)/spacing)),y0:Math.max(c.y0,Math.floor((ay-pad)/spacing)),x1:Math.min(c.x1,Math.ceil((bx+pad)/spacing)),y1:Math.min(c.y1,Math.ceil((by+pad)/spacing))};
  const columns=new Map();
  const column=(i,j) => {
    const key=i*65536+j; let k=columns.get(key);
    if (!k) {
      // Column centre in the shape's own frame, then to the world.
      const lx=(i+.5+(rnd(i,j,1)-.5)*.9)*L,ly=(j+.5+(rnd(i,j,2)-.5)*.9)*L;
      const f=s.inv?invert(s.inv):null,wx=f?f[0]*lx+f[2]*ly+f[4]:lx,wy=f?f[1]*lx+f[3]*ly+f[5]:ly;
      const m=mound(wx,wy),e=2,gx=(mound(wx+e,wy)-mound(wx-e,wy))/(2*e),gy=(mound(wx,wy+e)-mound(wx,wy-e))/(2*e);
      const flush=rnd(i,j,3)<.4,step=flush?0:(rnd(i,j,4)-.35)*2*s.crystalStep*(.5+s.crystalVariation);
      k={lx,ly,wx,wy,m,gx,gy,step,shade:.8+.2*rnd(i,j,5)}; columns.set(key,k);
    }
    return k;
  };
  for (let y=rect.y0;y<=rect.y1;y++) for (let x=rect.x0;x<=rect.x1;x++) {
    const wx=x*spacing,wy=y*spacing,lx=inv?inv[0]*wx+inv[2]*wy+inv[4]:wx,ly=inv?inv[1]*wx+inv[3]*wy+inv[5]:wy;
    const ci=Math.floor(lx/L),cj=Math.floor(ly/L);
    let best=null,d1=Infinity,d2=Infinity;
    for (let j=cj-1;j<=cj+1;j++) for (let i=ci-1;i<=ci+1;i++) {
      const k=column(i,j),d=Math.hypot(lx-k.lx,ly-k.ly);
      if (d<d1) { d2=d1; d1=d; best=k; } else if (d<d2) d2=d;
    }
    if (!best || best.m<=1) continue;
    // Crystal repro 1–3: inheriting the mound incline made continuous dark
    // walls. Preserve the envelope but expose separate column tops.
    const incline=best.gx*(wx-best.wx)+best.gy*(wy-best.wy);
    const top=s.crystalTiers>0?best.m+incline*(1-clamp(s.crystalTiers,0,1))+best.step:best.m+best.gx*(wx-best.wx)+best.gy*(wy-best.wy)+best.step;
    const h=Math.max(0,top),i=y*grid+x;
    if (h<=.5) continue;
    heights[i]=clamp(s.base[i]+h,MIN_HEIGHT,MAX_HEIGHT); protection[i]=1;
    crystal[i]=d2-d1<Math.max(1.2,spacing*.6)?.5:best.shade;
  }
  s.crystalRect=rect; heightDirty=true;
}
function stampCrystals(s) {
  // Undo this stroke's previous stamp, then stamp the whole cluster again.
  const c=clip||{x0:0,y0:0,x1:grid-1,y1:grid-1};
  if (s.crystalRect) for (let y=s.crystalRect.y0;y<=s.crystalRect.y1;y++) for (let x=s.crystalRect.x0;x<=s.crystalRect.x1;x++) {
    const i=y*grid+x; heights[i]=s.base[i]; protection[i]=s.protectBase[i]; crystal[i]=s.crystalBase[i]; s.weights[i]=0;
  }
  if (s.crystalForm>=.5) { stampColumns(s); return; }
  const top=clamp(s.crystalTop,0,.95),rect={x0:grid,y0:grid,x1:-1,y1:-1};
  for (const k of crystalList(s)) {
    const x0=Math.max(c.x0,Math.floor((k.x-k.R)/spacing)),x1=Math.min(c.x1,Math.ceil((k.x+k.R)/spacing));
    const y0=Math.max(c.y0,Math.floor((k.y-k.R)/spacing)),y1=Math.min(c.y1,Math.ceil((k.y+k.R)/spacing));
    rect.x0=Math.min(rect.x0,x0); rect.y0=Math.min(rect.y0,y0); rect.x1=Math.max(rect.x1,x1); rect.y1=Math.max(rect.y1,y1);
    for (let y=y0;y<=y1;y++) for (let x=x0;x<=x1;x++) {
      const qx=x*spacing-k.x,qy=y*spacing-k.y; let m=Infinity;
      for (const e of k.edges) {
        // This face's plane: zero along its base edge, one at the apex.
        const rise=e.d-(k.lx*e.nx+k.ly*e.ny);
        m=Math.min(m,(e.d-(qx*e.nx+qy*e.ny))/Math.max(rise,e.d*.2));
      }
      if (m<=0) continue;
      const h=Math.min(k.height,k.height/(1-top)*m),i=y*grid+x;
      if (h>s.weights[i]) s.weights[i]=h;
    }
  }
  if (rect.x1<0) { s.crystalRect=null; heightDirty=true; return; }
  for (let y=rect.y0;y<=rect.y1;y++) for (let x=rect.x0;x<=rect.x1;x++) {
    const i=y*grid+x,h=s.weights[i]; if (h<=0) continue;
    heights[i]=clamp(s.base[i]+h,MIN_HEIGHT,MAX_HEIGHT); protection[i]=1; crystal[i]=Math.max(s.crystalBase[i],smooth(.2,1.5,h));
  }
  s.crystalRect=rect; heightDirty=true;
}
function extendStroke(s,p) {
  if (s.kind==='crystal') { if (Math.hypot(p.x-s.last.x,p.y-s.last.y)>=1) { s.path.push(p); s.last=s.end=p; stampCrystals(s); } return; }
  if (s.shouldered) {
    if (Math.hypot(p.x-s.last.x,p.y-s.last.y)<.2) return;
    // The first span replaces the point preview once its direction is known.
    // Exact nearest points along each segment avoid a cadence of round dabs.
    if (!s.hasSpan) { heights.set(s.base); protection.set(s.protectBase); routes.set(s.routeBase); s.weights.fill(0); s.distances.fill(Infinity); s.hasSpan=true; }
    dab(s,s.last,p); s.last=p; s.end=p; s.path.push(p); return;
  }
  // Live strokes sweep one capsule per pointer event; release replays the
  // simplified path so the shape matches every later replay.
  if (Math.hypot(p.x-s.last.x,p.y-s.last.y)>=.2) dab(s,s.last,p);
  s.last=p; s.end=p; s.path.push(p);
}
function settleHill(s) {
  if (!s.shouldered || s.path.length<3) return;
  // Round guidance corners before sweeping the final ridge. The live field is
  // still drawn immediately; release replaces its abrupt segment junctions.
  let path=[s.path[0]];
  for (const p of s.path.slice(1,-1)) {
    const last=path[path.length-1];
    if (Math.hypot(p.x-last.x,p.y-last.y)>s.radius*.16) path.push(p);
  }
  path.push(s.path[s.path.length-1]);
  for (let pass=0;pass<2;pass++) {
    const next=[path[0]];
    for (let i=0;i<path.length-1;i++) {
      const a=path[i],b=path[i+1];
      next.push({x:.75*a.x+.25*b.x,y:.75*a.y+.25*b.y}, {x:.25*a.x+.75*b.x,y:.25*a.y+.75*b.y});
    }
    next.push(path[path.length-1]); path=next;
  }
  const frames=path.map((p,i) => {
    const a=path[Math.max(0,i-1)],b=path[Math.min(path.length-1,i+1)];
    const dx=b.x-a.x,dy=b.y-a.y,length=Math.hypot(dx,dy)||1;
    return [-dy/length*s.faceSide,dx/length*s.faceSide];
  });
  // Sweep the rounded path in as few sections as keep it within a small
  // tolerance: every section scans its whole box, and ~80 short sections
  // cost over 100 ms a frame while a hill was dragged.
  const kept=simplifyPath(path.map((p,i) => ({...p,i})),Math.max(1,s.radius*.02)),longest=Math.max(16,s.radius*1.5);
  heights.set(s.base); protection.set(s.protectBase); s.weights.fill(0); s.distances.fill(Infinity);
  for (let k=0;k<kept.length-1;k++) {
    const a=kept[k],b=kept[k+1],fa=frames[a.i],fb=frames[b.i],pieces=Math.ceil(Math.hypot(b.x-a.x,b.y-a.y)/longest);
    const at=t => ({x:a.x+(b.x-a.x)*t,y:a.y+(b.y-a.y)*t}),face=t => [fa[0]+(fb[0]-fa[0])*t,fa[1]+(fb[1]-fa[1])*t];
    for (let j=0;j<pieces;j++) dab(s,at(j/pieces),at((j+1)/pieces),face(j/pieces),face((j+1)/pieces));
  }
  // Only the newly added influence is softened across nearest-section seams;
  // the terrain under it, including a plateau or a shore, is not blurred.
  const joined=blurred(blurred(s.weights,2),2);
  const c=clip||{x0:0,y0:0,x1:grid-1,y1:grid-1};
  for (let y=c.y0;y<=c.y1;y++) for (let i=y*grid+c.x0,end=y*grid+c.x1;i<=end;i++) {
    heights[i]=clamp(s.base[i]+s.amount*joined[i]*hillLift(s,i),MIN_HEIGHT,MAX_HEIGHT);
    protection[i]=s.protectBase[i]*(1-joined[i]);
    routes[i]=s.routeBase[i]*(1-joined[i]);
  }
}
function reapplyWater() {
  if (!ready || stroke || !lastWaterStroke || lastWaterStroke.kind!==tool) return;
  const old=lastWaterStroke,points=old.path;
  cancelWeather(); heights.set(old.base); protection.set(old.protectBase); routes.set(old.routeBase);
  const next=startStroke(old.kind,points[0]);
  dab(next,points[0]); for (const p of points.slice(1)) extendStroke(next,p);
  lastWaterStroke=next; markChanged(); checkpoint(); schedule(); queueWeather();
  status('Updated the last water stroke from its original path.');
}
function rampSegment(s,a,b) {
  // Cache nearest coverage only around the appended segment. Earlier spans
  // never need another nearest-segment search while the pointer is moving.
  s.rampField ??= {distance:new Float32Array(heights.length).fill(Infinity),along:new Float32Array(heights.length),touched:[],length:0};
  const field=s.rampField,dx=b.x-a.x,dy=b.y-a.y,length2=dx*dx+dy*dy;
  if (length2<1e-8) return;
  const length=Math.sqrt(length2),radius=s.radius,amp=s.rough*radius*.14;
  let x0=clamp(Math.floor((Math.min(a.x,b.x)-radius-2*amp)/spacing),0,grid-1),x1=clamp(Math.ceil((Math.max(a.x,b.x)+radius+2*amp)/spacing),0,grid-1);
  let y0=clamp(Math.floor((Math.min(a.y,b.y)-radius-2*amp)/spacing),0,grid-1),y1=clamp(Math.ceil((Math.max(a.y,b.y)+radius+2*amp)/spacing),0,grid-1);
  if (clip) { x0=Math.max(x0,clip.x0); x1=Math.min(x1,clip.x1); y0=Math.max(y0,clip.y0); y1=Math.min(y1,clip.y1); }
  // Draft (while a shape is dragged): every other cell is computed and its
  // change copied to its three neighbours; release evaluates every cell.
  const step=draft?2:1;
  const copyCell=(i,j) => {
    if (s.weights[j]>=s.weights[i]) return;
    s.weights[j]=s.weights[i]; heights[j]=clamp(s.base[j]+heights[i]-s.base[i],MIN_HEIGHT,MAX_HEIGHT); protection[j]=protection[i]; routes[j]=routes[i];
  };
  const spread=(i,x,y) => { if (x<x1) copyCell(i,i+1); if (y<y1) { copyCell(i,i+grid); if (x<x1) copyCell(i,i+grid+1); } };
  for (let y=y0;y<=y1;y+=step) for (let x=x0;x<=x1;x+=step) {
    const i=y*grid+x,wx=x*spacing,wy=y*spacing,t=clamp(((wx-a.x)*dx+(wy-a.y)*dy)/length2,0,1);
    const cx=a.x+dx*t,cy=a.y+dy*t;
    const plainDistance=Math.hypot(wx-cx,wy-cy);
    // The graded centre follows the curve exactly. Only the outer shoulder
    // borrows the brush's outline variation; it cannot buckle the grade.
    const edgeNoise=smooth(.55,1,plainDistance/radius)*amp;
    const ex=s.noise.x[i]-sample(s.noise.x,cx,cy),ey=s.noise.y[i]-sample(s.noise.y,cx,cy);
    const distance=Math.hypot(wx-cx+edgeNoise*(s.rot[0]*ex-s.rot[1]*ey),wy-cy+edgeNoise*(s.rot[1]*ex+s.rot[0]*ey));
    if (distance>=radius || distance>=field.distance[i]) continue;
    if (field.distance[i]===Infinity) field.touched.push(i);
    field.distance[i]=distance; field.along[i]=field.length+t*length;
    s.weights[i]=1-smooth(.55,1,distance/radius);
  }
  field.length+=length;
}
function gradeRamp(s) {
  const field=s.rampField;
  if (!field?.length) return;
  const ref=s.pre??s.base,ah=sample(ref,s.start.x,s.start.y),bh=sample(ref,s.end.x,s.end.y);
  // A new endpoint changes the grade along the whole path, but only covered
  // samples are visited. Heights always come from the captured starting field.
  for (const i of field.touched) {
    const w=s.weights[i],t=clamp(field.along[i]/field.length,0,1);
    // Integrate a short eased approach at each end, with constant grade in
    // between. This avoids a crease at a level endpoint without doming the path.
    const ease=Math.min(.18,s.radius/field.length);
    const grade=t<ease?t*t/(2*ease*(1-ease)):t>1-ease?1-(1-t)*(1-t)/(2*ease*(1-ease)):(t-ease*.5)/(1-ease);
    const level=ah+(bh-ah)*grade;
    heights[i]=clamp(s.base[i]+(level-s.base[i])*w,MIN_HEIGHT,MAX_HEIGHT);
    // Joining routes retain the earlier smooth corridor through this ramp's
    // shoulder; a partial overlap must not reopen it to cracks or weathering.
    protection[i]=Math.max(s.protectBase[i],smooth(.55,.92,w));
    routes[i]=Math.max(s.routeBase[i],smooth(.30,.92,w));
  }
  heightDirty=true;
}
function ramp(s,p) {
  if (Math.hypot(p.x-s.end.x,p.y-s.end.y)<1e-4) return;
  rampSegment(s,s.end,p); s.last=p; s.end=p; s.path.push(p); gradeRamp(s);
}
function settleRamp(s) {
  if (s.kind!=='ramp' || s.path.length<3) return;
  // Decimate pointer cadence before two corner-cutting passes. Exact endpoints
  // survive, so their original heights still determine the finished grade.
  let path=[s.path[0]];
  for (const p of s.path.slice(1,-1)) {
    const last=path[path.length-1];
    if (Math.hypot(p.x-last.x,p.y-last.y)>s.radius*.12) path.push(p);
  }
  path.push(s.path[s.path.length-1]);
  for (let pass=0;pass<2;pass++) {
    const next=[path[0]];
    for (let i=0;i<path.length-1;i++) {
      const a=path[i],b=path[i+1];
      next.push({x:.75*a.x+.25*b.x,y:.75*a.y+.25*b.y},{x:.25*a.x+.75*b.x,y:.25*a.y+.75*b.y});
    }
    next.push(path[path.length-1]); path=next;
  }
  heights.set(s.base); protection.set(s.protectBase); routes.set(s.routeBase); s.weights.fill(0);
  s.rampField.distance.fill(Infinity); s.rampField.touched.length=0; s.rampField.length=0;
  for (let i=0;i<path.length-1;i++) rampSegment(s,path[i],path[i+1]);
  s.path=path; gradeRamp(s);
}

function markViewChanged() { revision++; needsDraw=true; renderedRevision=-1; $('export').disabled=true; }
function markChanged() { markViewChanged(); heightDirty=true; error(); }

// Shapes are nodes: kind, path, parameters and seed. The map is rebuilt by
// replaying nodes in order, so relative heights follow the ground beneath
// (a hill on a plateau rises with it). prefix[i] keeps the surface before
// node i, so an edit replays only from the edited node onward.
let nodes=[], prefix=[], selected=-1, moving=null, pendingEval=-1, pendingRect=null;
const noiseCache=new Map();
function noiseFor(s) { if (!noiseCache.has(s)) { noiseCache.set(s,makeNoise(s)); if (noiseCache.size>16) noiseCache.delete(noiseCache.keys().next().value); } return noiseCache.get(s); }
const NODE_NAMES={crystal:'Crystals',sand:'Sand cover',paint:'Painted masks',grass:'Ground cover',erase:'Ground (erase)',ground:'Ground undulation',crater:'Crater',fissure:'Fissure',offset:'Raise / lower',plateau:'Plateau',hill:'Hill',mountain:'Mountain',ramp:'Ramp',deep:'Deep water',shallow:'Shallow water',smooth:'Smooth',lower:'Lower',raster:'Imported surface',compact:'Height scale'};
function strokeParams(s) { return {...Object.fromEntries(['shorePlates','plateWaterPx','plateLandPx','plateSize','plateGap','plateHeight','plateMaterial','fingerBlunt'].map(k => [k,s[k]])),radius:s.radius,amount:s.amount,rough:s.rough,bankWidth:s.bankWidth,softness:s.softness,beachFlatness:s.beachFlatness,shelves:s.shelves,shallowMode:s.shallowMode,craterlets:s.craterlets,craterEjecta:s.craterEjecta,northFace:s.northFace,mesaFlank:s.mesaFlank,fingers:s.fingers,bankPx:s.bankPx,faceVariation:s.faceVariation,crystalTiers:s.crystalTiers,paintChannel:s.paintChannel,maskChannel:s.maskChannel,maskAmount:s.maskAmount,...Object.fromEntries(STYLE_KEYS.map(k => [k,s[k]])),...Object.fromEntries(WATER_KEYS.map(k => [k,s[k]])),crystalForm:s.crystalForm,crystalStep:s.crystalStep,crystalSides:s.crystalSides,crystalSize:s.crystalSize,crystalCount:s.crystalCount,crystalTop:s.crystalTop,crystalLean:s.crystalLean,crystalVariation:s.crystalVariation,...Object.fromEntries(SECTION_KEYS.map(k => [k,s[k]])),...Object.fromEntries(RIDGE_KEYS.map(k => [k,s[k]])),...Object.fromEntries(FISSURE_KEYS.map(k => [k,s[k]])),cracks:s.cracks}; }
function applyNode(n) {
  if (n.hidden) return;
  if (n.kind==='raster') { for (const i of clipCells()) { heights[i]=n.heights[i]; protection[i]=n.protection[i]; routes[i]=n.routes[i]; } return; }
  if (n.kind==='ground') {
    // Broad, low undulation of dry ground, as retail maps have: about half of
    // retail dry land is gently sloped rather than dead level. Protected
    // crests, ramps and passages keep their authored surface.
    const amp=n.amplitude??8,wave=n.wavelength??160,cover=n.coverage??.5,s=n.seed??1;
    for (const i of clipCells()) {
      const x=i%grid,y=(i-x)/grid,h=heights[i];
      if (h<=config.seaLevel+1) continue;
      const wx=x*spacing,wy=y*spacing;
      const v=.6*valueNoise(wx/wave,wy/wave,s^0x51a3)+.3*valueNoise(wx*2.1/wave,wy*2.1/wave,s^0x2b7d)+.1*valueNoise(wx*4.3/wave,wy*4.3/wave,s^0x6c11);
      // Retail dry land is bimodal: about half dead level, half rolling. A
      // broad mask confines the undulation to patches.
      const threshold=(.5-cover)*1.2,patch=smooth(threshold-.15,threshold+.15,valueNoise(wx/(wave*3.2),wy/(wave*3.2),s^0x7f4b));
      // Dry ground stays dry: undulation never opens new ponds.
      const next=h+amp*v*patch*(1-protection[i])*smooth(config.seaLevel+1,config.seaLevel+8,h);
      heights[i]=clamp(Math.max(next,Math.min(h,config.seaLevel+1.5)),MIN_HEIGHT,MAX_HEIGHT);
    }
    return;
  }
  if (n.kind==='compact') { for (const i of clipCells()) if (heights[i]>config.baseHeight) heights[i]=config.baseHeight+(heights[i]-config.baseHeight)*n.factor; return; }
  const work=borrowWork();
  try { replayShape(n,work); } finally { workDepth--; }
}
function replayShape(n,work) {
  const pts=n.points,b=nodeBounds(n),c=clip||{x0:0,y0:0,x1:grid-1,y1:grid-1};
  const s=startStroke(n.kind,pts[0],{...shapeDefaults(),...n.params,seed:n.seed,frame:n.frame,node:n,work,pre:regionPre?.h,
    rect:{x0:Math.max(b.x0,c.x0),y0:Math.max(b.y0,c.y0),x1:Math.min(b.x1,c.x1),y1:Math.min(b.y1,c.y1)}});
  if (n.kind==='crystal') { s.path=pts.slice(); stampCrystals(s); return; }
  if (n.kind==='ramp') { for (const p of pts.slice(1)) ramp(s,p); settleRamp(s); return; }
  if (s.shouldered && experiment.get('replay')!=='full') {
    // The settled ridge replaces every live dab, so replay goes straight to
    // it: the same accepted path and face side, without the discarded pass.
    const path=[pts[0]];
    for (const p of pts.slice(1)) if (Math.hypot(p.x-path[path.length-1].x,p.y-path[path.length-1].y)>=.2) path.push(p);
    if (path.length>=3) {
      const sx=path[1].x-path[0].x,sy=path[1].y-path[0].y;
      s.faceSide=(-sy*s.face[0]+sx*s.face[1])<0?-1:1; s.path=path; s.last=s.end=path[path.length-1];
      settleHill(s); applyCracks(s); return;
    }
  }
  if (s.shouldered) { dab(s,pts[0]); for (const p of pts.slice(1)) extendStroke(s,p); settleHill(s); }
  else sweep(s,pts);
  if (['deep','shallow','offset'].includes(n.kind) && s.shorePlates>0) stampShorePlates(s);
  if (n.kind==='crater') addCraterlets(n,s);
  applyCracks(s);
}
function applyCracks(s) {
  applyShapeMask(s);
  // A shape marks where cracks may open: its own influence times its Cracks
  // amount. The bake carves the fissures from this field.
  if (!(s.cracks>0) || !['hill','mountain','plateau','crater','offset'].includes(s.kind)) return;
  for (const i of clipCells()) if (s.weights[i]>0) cracks[i]=Math.max(cracks[i],Math.min(1,s.weights[i]*1.6)*s.cracks);
}
const craterletKeys=new WeakMap();
const craterletRand=(seed,k,a) => { let x=Math.imul((seed>>>0)+k*7919+a*104729,2654435761)>>>0; x^=x>>>15; x=Math.imul(x,2246822519)>>>0; return (x>>>0)/4294967296; };
// Craterlet k of crater node n: centre and radius, from the crater's seed
// alone (region replay needs the centres before it replays anything).
function craterletSpot(n,seed,radius,k) {
  const c=n.points[n.points.length>>1],turn=isIdentity(n.frame)?0:Math.atan2(n.frame[1],n.frame[0]);
  const angle=craterletRand(seed,k,1)*Math.PI*2+turn,dist=radius*(.9+craterletRand(seed,k,2)*1.1),small=radius*(.1+.22*craterletRand(seed,k,3));
  return {p:{x:clamp(c.x+Math.cos(angle)*dist,0,size-1),y:clamp(c.y+Math.sin(angle)*dist,0,size-1)},small};
}
function addCraterlets(n,s) {
  // Small satellite craters around the rim and apron, as on retail Moon
  // sections. Positions, sizes and depths come from the crater's seed.
  const count=Math.round(s.craterlets||0);
  const framed=!isIdentity(n.frame);
  let keys=craterletKeys.get(n); if (!keys) craterletKeys.set(n,keys=[]);
  for (let k=0;k<count;k++) {
    const h=a => craterletRand(s.seed,k,a),{p,small}=craterletSpot(n,s.seed,s.radius,k);
    let rect=null;
    if (framed) {
      const reach=small*3+12*spacing,box=clip||{x0:0,y0:0,x1:grid-1,y1:grid-1};
      rect={x0:Math.max(box.x0,Math.floor((p.x-reach)/spacing)),y0:Math.max(box.y0,Math.floor((p.y-reach)/spacing)),x1:Math.min(box.x1,Math.ceil((p.x+reach)/spacing)),y1:Math.min(box.y1,Math.ceil((p.y+reach)/spacing))};
      keys[k] ??= {};
    }
    const work=borrowWork();
    try {
      const t=startStroke('crater',p,{...n.params,rimHeight:s.rimHeight,radius:small,amount:s.amount*(.25+.3*h(4)),seed:(s.seed+k*2654435761)>>>0,craterlets:0,frame:n.frame,node:keys[k],rect,work});
      dab(t,p);
    } finally { workDepth--; }
  }
  addRimSpurs(n,s);
}
// The per-cell fields every shape may write, keyed as in prefix snapshots:
// heights, protection, routes, cracks, cover (sand/ground paint), crystal.
// and the painted masks (card C5), keyed by MASK_KEYS.
const live=() => ({h:heights,p:protection,r:routes,c:cracks,v:cover,x:crystal,...Object.fromEntries(MASK_KEYS.map((k,j) => [k,maskPlanes[j]]))});
const FIELD_KEYS=['h','p','r','c','v','x',...MASK_KEYS];
function copyFields(src,dst,rect) { for (const k of FIELD_KEYS) copyRect(src[k],dst[k],rect); }
function resetFields() { heights.fill(config.baseHeight); for (const a of [protection,routes,cracks,cover,crystal]) a.fill(0); clearMasks(); }
function snapshot() { const f=live(); return Object.fromEntries(FIELD_KEYS.map(k => [k,f[k].slice()])); }
function addNode(n) { prefix[nodes.length]=snapshot(); nodes.push(n); applyNode(n); }
let lastEvalMs=0;
// Region-limited replay. clip is the rectangle (grid cells, inclusive) that
// node application may compute; with no clip, the whole grid.
let clip=null;
// The prefix snapshot (the fields before the node) of the node a region replay
// is applying; null in a full replay, where the live fields are that state.
let regionPre=null;
function* clipCells() {
  const c=clip||{x0:0,y0:0,x1:grid-1,y1:grid-1};
  for (let y=c.y0;y<=c.y1;y++) for (let x=c.x0;x<=c.x1;x++) yield y*grid+x;
}
function nodeBounds(n) {
  // World-space reach of a shape, from the same extents its brush uses,
  // plus a few cells for the hill's softening blur.
  if (!n.points) return {x0:0,y0:0,x1:grid-1,y1:grid-1};
  const q=n.params||{},radius=q.radius||40,rough=q.rough??.35,soft=q.softness??.5;
  const bank=['deep','shallow'].includes(n.kind)?2**(((q.bankWidth??.5)-.5)*1.3):1;
  const back=soft===.5?1.34:2-(.66+(soft-.5)*.9);
  const reach={plateau:Math.min(1.7,1+rough*1.3)+1.9*rough,offset:Math.min(1.7,1+rough*1.3)+1.9*rough,erase:Math.min(1.7,1+rough*1.3)+1.9*rough,sand:Math.min(1.7,1+rough*1.3)+1.9*rough,grass:Math.min(1.7,1+rough*1.3)+1.9*rough,paint:Math.min(1.7,1+rough*1.3)+1.9*rough,hill:Math.max(1.4,back)*1.75+1.7*rough,deep:Math.min(1.9,1+rough*1.6)*bank+2.2*rough,
    shallow:bank+.4*rough,crater:2.9*(1+.45*rough)+.9*rough,ramp:1+.28*rough}[n.kind] ?? 1+.4*rough;
  let r=n.kind==='crystal'?radius*(q.crystalForm>=.5?1.35:1)+(q.crystalForm>=.5?0:(q.crystalSize||24)*(n.frame?Math.hypot(n.frame[0],n.frame[1]):1)*1.6)+12*spacing:radius*reach+12*spacing+(['deep','shallow'].includes(n.kind)?(q.fingers||0)*110+(q.bankPx||0):0)+(['deep','shallow','offset'].includes(n.kind)&&q.shorePlates>0?Math.max(q.plateWaterPx||0,q.plateLandPx||0):0);
  let ax=Infinity,ay=Infinity,bx=-Infinity,by=-Infinity;
  for (const p of n.points) { ax=Math.min(ax,p.x); ay=Math.min(ay,p.y); bx=Math.max(bx,p.x); by=Math.max(by,p.y); }
  // A fissure reaches its branches (and their forks) and, in network mode, its footprint.
  if (n.kind==='fissure') { const k=n.frame?Math.hypot(n.frame[0],n.frame[1]):1; r=(q.fissureNetwork>=.5?radius*1.1:0)+(Math.round(q.fissureBranches)>=1?(q.fissureBranchLen||0)*2.4*k:0)+(q.fissureWidth||5)*3*k+24+12*spacing; }
  // Spurs (card C4) reach up to one and a half spur lengths past the ridge or rim, plus their own width.
  // A ridge's crest also swells to 1.4 of its radius and a spur's root flares to about 1.7 times Spur width.
  if (ridgeOn(n.kind,q)) r+=radius;
  if (Math.round(q.spurCount)>=1 && ['hill','mountain','crater'].includes(n.kind)) { const k=n.frame?Math.hypot(n.frame[0],n.frame[1]):1; r+=(q.spurLength||0)*(q.spurForks>0?2.1:1.6)*k+radius*Math.max(1,((q.spurWidth||.8)+(q.spurBulb||0)*.7)*1.7); }
  return {x0:clamp(Math.floor((ax-r)/spacing),0,grid-1),y0:clamp(Math.floor((ay-r)/spacing),0,grid-1),x1:clamp(Math.ceil((bx+r)/spacing),0,grid-1),y1:clamp(Math.ceil((by+r)/spacing),0,grid-1)};
}
const unionRect=(a,b) => !a?b:!b?a:{x0:Math.min(a.x0,b.x0),y0:Math.min(a.y0,b.y0),x1:Math.max(a.x1,b.x1),y1:Math.max(a.y1,b.y1)};
const overlaps=(a,b) => a.x0<=b.x1 && b.x0<=a.x1 && a.y0<=b.y1 && b.y0<=a.y1;
function copyRect(src,dst,r) { for (let y=r.y0;y<=r.y1;y++) dst.set(src.subarray(y*grid+r.x0,y*grid+r.x1+1),y*grid+r.x0); }
// Dragging a shape costs 13-40 ms a frame for 300-400 px shapes (swept
// capsules on a simplified path, draft cells, cached finger fringe).
// TODO(perf): move node replay to a worker so the view never waits on it;
// framed noise is still gathered per frame (~5 ms) while a shape moves.
// A region replay is exact only if no node reads the heights outside the region
// or lets the edit change them there. Found with sculptDebug.replayDetail, three
// nodes sample the height at a point of their own: a plateau's or crater's
// baseline at its first point, a ramp's grade between its end points, and a
// craterlet's baseline at its centre after the main crater.
// - A point outside the region is read from the node's own prefix snapshot
//   (regionPre, the state a full replay reads), except a craterlet's, which only
//   a replay of the crater can produce: the region grows to contain every
//   craterlet of a crater it touches (centre and footprint).
// - A point inside the region changes with the edit, and with it the node's
//   whole shape: the region grows to the node's bounds.
// The growth repeats until nothing else is pulled in.
function regionClosure(from,inner,margin) {
  const expand=r => ({x0:Math.max(0,r.x0-margin),y0:Math.max(0,r.y0-margin),x1:Math.min(grid-1,r.x1+margin),y1:Math.min(grid-1,r.y1+margin)});
  const cellOf=q => ({x:Math.floor(q.x/spacing),y:Math.floor(q.y/spacing)});
  const inside=(r,c) => c.x>=r.x0 && c.x+1<=r.x1 && c.y>=r.y0 && c.y+1<=r.y1;
  for (let grown=true;grown;) {
    grown=false;
    const outer=expand(inner);
    for (let i=from;i<nodes.length;i++) {
      const n=nodes[i];
      if (n.hidden || !n.points || !overlaps(nodeBounds(n),outer)) continue;
      const pull=r => { const u=unionRect(inner,r); if (u.x0!==inner.x0 || u.y0!==inner.y0 || u.x1!==inner.x1 || u.y1!==inner.y1) { inner=u; grown=true; } };
      const reads=n.kind==='plateau' || n.kind==='crater'?[n.points[0]]:n.kind==='ramp'?[n.points[0],n.points[n.points.length-1]]:[];
      if (reads.some(q => inside(inner,cellOf(q)))) pull(nodeBounds(n));
      if (n.kind!=='crater' || !n.params) continue;
      const count=Math.round(n.params.craterlets??worldDefault('craterlets'));
      for (let k=0;k<count;k++) {
        const {p,small}=craterletSpot(n,n.seed??seed,n.params.radius,k),c=cellOf(p),reach=Math.ceil((small*4+12*spacing)/spacing);
        pull({x0:Math.max(0,c.x-reach),y0:Math.max(0,c.y-reach),x1:Math.min(grid-1,c.x+reach+1),y1:Math.min(grid-1,c.y+reach+1)});
      }
    }
  }
  return inner;
}
function evaluateRegion(from,rect) {
  // Replays nodes from 'from' inside rect only. Each node is computed over a
  // margin (for neighbourhood steps such as the hill's softening blur) and
  // the margin is put back, so nothing outside rect changes.
  const margin=6,inner=regionClosure(from,rect,margin);
  const outer={x0:Math.max(0,inner.x0-margin),y0:Math.max(0,inner.y0-margin),x1:Math.min(grid-1,inner.x1+margin),y1:Math.min(grid-1,inner.y1+margin)};
  const now=live(),save=Object.fromEntries(FIELD_KEYS.map(k => [k,new now[k].constructor(heights.length)]));
  copyFields(prefix[from],now,inner);
  for (let i=from;i<nodes.length;i++) {
    if (!prefix[i]) prefix[i]=snapshot(); else copyFields(now,prefix[i],inner);
    if (!overlaps(nodeBounds(nodes[i]),outer)) continue;
    copyFields(now,save,outer);
    clip=outer; regionPre=prefix[i]; try { applyNode(nodes[i]); } finally { clip=null; regionPre=null; }
    for (const band of [{x0:outer.x0,y0:outer.y0,x1:outer.x1,y1:inner.y0-1},{x0:outer.x0,y0:inner.y1+1,x1:outer.x1,y1:outer.y1},
                        {x0:outer.x0,y0:inner.y0,x1:inner.x0-1,y1:inner.y1},{x0:inner.x1+1,y0:inner.y0,x1:outer.x1,y1:inner.y1}]) {
      if (band.x0>band.x1 || band.y0>band.y1) continue;
      copyFields(save,now,band);
    }
  }
  prefix.length=nodes.length; heightDirty=true; markChanged();
}
function evaluate(from=0,rect=null) {
  const evalStart=performance.now();
  // Shore distance depends on neighbouring heights; replay the full suffix
  // when it contains a plate band so changes outside a small edit stay exact.
  if (rect && nodes.slice(from).some(n => ['deep','shallow','offset'].includes(n.kind) && n.params?.shorePlates>0)) rect=null;
  if (rect && from>0 && prefix[from] && prefix.length>=nodes.length) { evaluateRegion(from,rect); lastEvalMs=performance.now()-evalStart; return; }
  from=Math.max(0,Math.min(from,nodes.length));
  if (from>0 && prefix[from]) { const now=live(); for (const k of FIELD_KEYS) now[k].set(prefix[from][k]); }
  else { from=0; resetFields(); }
  for (let i=from;i<nodes.length;i++) { prefix[i]=snapshot(); applyNode(nodes[i]); }
  prefix.length=nodes.length; heightDirty=true; markChanged();
  lastEvalMs=performance.now()-evalStart;
}
function cloneNodes(list=nodes) { return list.map(n => ({...n,points:n.points?.map(p => ({...p})),params:n.params?{...n.params}:undefined})); }
function nodeDistance(n,p) {
  if (!n.points) return Infinity;
  let best=Infinity;
  for (let i=0;i<n.points.length;i++) {
    const a=n.points[i],b=n.points[Math.min(i+1,n.points.length-1)],dx=b.x-a.x,dy=b.y-a.y,l2=dx*dx+dy*dy;
    const t=l2?clamp(((p.x-a.x)*dx+(p.y-a.y)*dy)/l2,0,1):0;
    best=Math.min(best,Math.hypot(p.x-a.x-dx*t,p.y-a.y-dy*t));
  }
  return best;
}
// Moving, rotating and scaling a shape: the gesture's transform applies to
// the shape as it was when the gesture began, path and frame together.
function nodeState(n) { return {points:n.points.map(q => ({...q})),frame:n.frame||IDENTITY,radius:n.params?.radius,amount:n.params?.amount}; }
function transformNode(n,start,m) {
  n.points=start.points.map(q => { const r=applyFrame(m,q.x,q.y); return {x:clamp(r.x,0,size-1),y:clamp(r.y,0,size-1)}; });
  n.frame=compose(m,start.frame);
  if (n.params && start.radius) n.params={...n.params,radius:clamp(start.radius*Math.hypot(m[0],m[1]),4,600)};
}
function nodePivot(n) {
  let ax=Infinity,ay=Infinity,bx=-Infinity,by=-Infinity;
  for (const p of n.points) { ax=Math.min(ax,p.x); ay=Math.min(ay,p.y); bx=Math.max(bx,p.x); by=Math.max(by,p.y); }
  return {x:(ax+bx)/2,y:(ay+by)/2,reach:Math.hypot(bx-ax,by-ay)/2+(n.params?.radius||40)};
}
// Handle positions on the overlay: round rotates, square scales.
function nodeHandles(n) {
  const c=nodePivot(n),lift=(Math.max(config.seaLevel,sample(heights,c.x,c.y))-config.baseHeight)*.5;
  const r=Math.min(c.reach,size*.45),inside=v => clamp(v,12,size-12);
  return {pivot:c,centre:{cx:c.x,cy:c.y-lift},rotate:{cx:inside(c.x),cy:inside(c.y-lift-r)},scale:{cx:inside(c.x+r*.707),cy:inside(c.y-lift+r*.707)},radius:r};
}
function changeSelected(edit) {
  const n=nodes[selected]; if (!n?.points || stroke || moving) return;
  const before=nodeBounds(n); cancelWeather(); edit(n);
  pendingRect=unionRect(pendingRect,unionRect(before,nodeBounds(n))); pendingEval=pendingEval<0?selected:Math.min(pendingEval,selected);
  flushEval(); markViewChanged(); checkpoint(); queueWeather(); selectNode(selected); schedule();
}
function pickNode(p) {
  let best=-1,bestScore=Infinity;
  nodes.forEach((n,i) => { const d=nodeDistance(n,p),reach=Math.max(24,(n.params?.radius||40)); if (d<reach && d/reach<bestScore) { bestScore=d/reach; best=i; } });
  return best;
}
function selectNode(i) {
  selected=i;
  const n=nodes[i];
  if (n && n.params && HELP[n.kind]) {
    if (tool!=='move') { rememberTool(); tool=n.kind; }
    const p=n.params;
    const [lo,hi]=amountRange(n.kind); $('amount').min=String(lo); $('amount').max=String(hi);
    $('diameter').value=clamp(p.radius*2,40,800); $('amount').value=clamp(p.amount,lo,hi); $('roughness').value=clamp(Math.round(p.rough*100),0,100);
    $('softness').value=Math.round(p.softness*100); $('bank-width').value=Math.round(p.bankWidth*100); $('beach-flatness').value=Math.round(p.beachFlatness*100);
    $('shelves').value=Math.round(p.shelves*100); $('shallow-mode').value=p.shallowMode==='area'?'area':'passage'; $('cracks').value=Math.round((p.cracks||0)*100);
    for (const [key,id,,,lo,hi,,scale] of SHAPE_FIELDS) $(id).value=clamp(Math.round((p[key]??worldDefault(key))*scale),lo,hi);
  }
  renderLayers(); updateControls(); schedule(false);
  if (n) status(`Editing ${NODE_NAMES[n.kind]||n.kind} #${i+1}: sliders change this shape. Draw to start a new one.`);
}
function editSelectedFromControls() {
  const n=nodes[selected]; if (!n || !n.params) return;
  const before=nodeBounds(n);
  n.params={...n.params,radius:Number($('diameter').value)/2,amount:Number($('amount').value),rough:Number($('roughness').value)/100,
    softness:Number($('softness').value)/100,bankWidth:Number($('bank-width').value)/100,beachFlatness:Number($('beach-flatness').value)/100,
    shelves:Number($('shelves').value)/100,shallowMode:$('shallow-mode').value,cracks:Number($('cracks').value)/100,
    ...Object.fromEntries(SHAPE_FIELDS.filter(f => f[3].includes(n.kind)).map(([key]) => [key,shapeValue(key)]))};
  pendingRect=unionRect(pendingRect,unionRect(before,nodeBounds(n)));
  cancelWeather(); pendingEval=pendingEval<0?selected:Math.min(pendingEval,selected); schedule();
}
function renderLayers() {
  const list=$('layers'); if (!list) return;
  list.replaceChildren(...nodes.map((n,i) => {
    const item=document.createElement('li');
    item.textContent=`${NODE_NAMES[n.kind]||n.kind}${n.hidden?' (hidden)':''}`;
    item.className=i===selected?'selected':'';
    item.addEventListener('click',() => selectNode(i===selected?-1:i));
    return item;
  }));
  for (const id of ['node-seed','node-delete','node-up','node-down','node-hide']) $(id).disabled=selected<0;
}
function nodeAction(kind) {
  const i=selected; if (i<0 || stroke) return;
  cancelWeather();
  if (kind==='delete') { nodes.splice(i,1); selected=-1; evaluate(i); }
  else if (kind==='hide') { nodes[i].hidden=!nodes[i].hidden; evaluate(i); }
  else if (kind==='seed') { if (nodes[i].seed===undefined) return; nodes[i].seed=(Math.random()*4294967295)>>>0; evaluate(i); }
  else if (kind==='up' && i>0) { [nodes[i-1],nodes[i]]=[nodes[i],nodes[i-1]]; selected=i-1; evaluate(i-1); }
  else if (kind==='down' && i<nodes.length-1) { [nodes[i+1],nodes[i]]=[nodes[i],nodes[i+1]]; selected=i+1; evaluate(i); }
  checkpoint(); renderLayers(); schedule(); queueWeather();
}
// Apply a pending node edit now, so history and refinement see it.
function flushEval() {
  if (pendingEval<0) return;
  const from=pendingEval,rect=pendingRect; pendingEval=-1; pendingRect=null;
  // A dragged shape is evaluated in draft; releasing it re-evaluates the
  // whole area the gesture touched at full detail.
  draft=Boolean(moving) && experiment.get('draft')!=='off';
  try { evaluate(from,rect); } finally { draft=false; }
}
function checkpoint() {
  flushEval();
  history.splice(historyIndex+1); history.push({nodes:cloneNodes(),refinementSeed}); if (history.length>48) history.shift(); historyIndex=history.length-1;
  renderLayers(); updateControls(); persistLater();
}
function moveHistory(delta) {
  const next=historyIndex+delta; if (!ready || stroke || next<0 || next>=history.length) return;
  lastWaterStroke=null; cancelWeather(); nodes=cloneNodes(history[next].nodes); prefix=[]; selected=-1; refinementSeed=history[next].refinementSeed; historyIndex=next;
  evaluate(0); renderLayers(); updateControls(); persistLater(); status(delta<0?'Undid the last change.':'Restored the change.'); schedule(); queueWeather();
}

// While a shape is edited the material transport is too slow to rerun, so a
// quick approximation stands in: biomes whose colours come from it (the
// Archipelago's dark hills) keep roughly their final look instead of
// turning pale until refinement finishes.
const materialPreview=() => experiment.get('deposits')!=='off' && Number($('material-weathering').value)>0;
function quickMaterials() {
  if (!renderer || !materialPreview()) { renderer?.setMaterialField(); return; }
  renderer.setMaterialField(quickMaterialField({height:heights,grid,size,seed:refinementSeed,baseHeight:config.baseHeight,seaLevel:config.seaLevel,
    depositSpread:Number($('deposit-spread').value)/100,materialProfile:{...config.material,mineral:renderer.variant.get('transition')==='mineral'}}));
}
function cancelWeather() {
  weatherJob++; weatherBase=null;
  quickMaterials();
  weatherWorker?.postMessage({cancel:true,job:weatherJob});
  weatherState=$('weather').checked?'pending':'disabled';
  $('weather-state').textContent=$('weather').checked?'Refinement paused while editing.':'Weathering off · authored surface';
  updateControls();
}
function previewHeight() {
  if (!refined || !refinedBase || !$('weather').checked) return heights;
  const display=heights.slice();
  for (let i=0;i<display.length;i++) display[i]+=(refined[i]-refinedBase[i])*(1-smooth(0,10,Math.abs(heights[i]-refinedBase[i])))*(1-routes[i]);
  return display;
}
function queueWeather() {
  flushEval();
  if (!$('weather').checked) {
    weatherState='disabled'; $('weather-state').textContent='Weathering off · authored surface'; updateControls(); return;
  }
  weatherState='pending'; renderedRevision=-1; updateControls();
  if (stroke) { $('weather-state').textContent='Refinement paused while editing.'; return; }
  try {
    if (!weatherWorker) startWeatherWorker();
    const job=++weatherJob;
    weatherBase=heights.slice();
    $('weather-state').textContent='Refining exposed slopes…';
    const profile=experiment.get('weather')==='broad'?'broad':undefined;
    weatherWorker.postMessage({job,height:weatherBase,protect:protection,grid,size,seed:refinementSeed,strength:0.35,profile,baseHeight:config.baseHeight,talus:Number($('scree').value)/100,seaLevel:config.seaLevel,materialWeathering:experiment.get('deposits')==='off'?0:Number($('material-weathering').value)/100,depositSpread:Number($('deposit-spread').value)/100,materialProfile:{...config.material,mineral:renderer.variant.get('transition')==='mineral'},
      sand:Number(experiment.get('sand')||0),sandReach:Number(experiment.get('sandReach')??.6),sandPatchy:Number(experiment.get('sandPatchy')??.7),sandTail:Number(experiment.get('sandTail')??.6),windStrength:Number(experiment.get('windStrength')??.5),windAngle:Number(experiment.get('wind')??20)});
  } catch (err) { failWeather(err.message); }
}
function failWeather(message) {
  weatherJob++; weatherBase=null; weatherWorker?.terminate(); weatherWorker=null;
  weatherState=$('weather').checked?'failed':'disabled';
  $('weather-state').textContent=$('weather').checked
    ?`Weathering failed: ${message}. Turn Weathering off to export the authored surface, then on to retry.`
    :'Weathering off · authored surface';
  updateControls();
}
function startWeatherWorker() {
  const worker=new Worker('/sculpt-weathering.js',{type:'module'}); weatherWorker=worker;
  worker.onmessage=event => {
    const data=event.data;
    if (worker!==weatherWorker || data.job!==weatherJob || stroke || !$('weather').checked) return;
    if (data.error) { failWeather(data.error); return; }
    refined=data.height; refinedBase=weatherBase;
    renderer.setHeight(refined,grid); renderer.setRoutes(routes,cracks,cover,crystal,maskPlanes); renderer.setWeather(data.flow,data.deposit,data.talus,data.sand);
    if (data.materialField) renderer.setMaterialField(data.materialField);
    heightDirty=false;
    if (data.done) { weatherState='ready'; renderedRevision=-1; updateControls(); }
    $('weather-state').textContent=data.done?`Weathered edges · ${Math.round(data.milliseconds)} ms`:data.progress>=.93?'Settling surface materials…':`Refining exposed slopes · ${Math.round(data.progress*100)}%`;
    schedule();
  };
  worker.onerror=event => { if (worker===weatherWorker) failWeather(event.message || 'worker unavailable'); };
}
function schedule(draw=true) { if (draw) needsDraw=true; if (!framePending) { framePending=true; requestAnimationFrame(frame); } }
function drawTiming(stats,elapsed,quality) {
  const ms=Number.isFinite(stats?.milliseconds)?stats.milliseconds:elapsed;
  const gpu=Number.isFinite(stats?.gpuMilliseconds)?` · GPU ${stats.gpuMilliseconds.toFixed(1)} ms (recent)`:'';
  const interval=paintingIntervals.length?` · stroke RAF ${(paintingIntervals.reduce((sum,v) => sum+v,0)/paintingIntervals.length).toFixed(1)} ms`:' · stroke RAF —';
  $('timing').textContent=`Draw ${ms.toFixed(1)} ms CPU${gpu}${interval} · shapes ${lastEvalMs.toFixed(1)} ms · ${quality}`;
}
function frame(timestamp) {
  framePending=false; if (!renderer) return;
  if (stroke) { if (lastPaintingRAF!==null) { paintingIntervals.push(timestamp-lastPaintingRAF); if (paintingIntervals.length>10) paintingIntervals.shift(); } lastPaintingRAF=timestamp; }
  else lastPaintingRAF=null;
  try {
    flushEval();
    if (heightDirty) { renderer.setHeight(previewHeight(),grid); renderer.setRoutes(routes,cracks,cover,crystal,maskPlanes); if ((stroke || moving) && materialPreview()) quickMaterials(); heightDirty=false; }
    if (needsDraw || stroke || moving) {
      const quality=stroke||moving?'preview':'full',start=performance.now();
      const stats=renderer.draw({quality,clay:$('clay').checked,light:$('light').value,fractures:Number($('fractures').value)/100,scree:Number($('scree').value)/100,detail:Number($('relief').value)/100,ring:Number($('mineral-ring').value)/100,ringSpread:Number($('ring-spread').value)/100,ringVariation:Number($('ring-variation').value)/100,fringeStyle:$('fringe-style').value,materialWeathering:Number($('material-weathering').value)/100,transitionDetail:Number($('transition-detail').value)/100});
      drawTiming(stats,performance.now()-start,quality);
      if (!stroke && !moving) { renderedRevision=revision; updateControls(); }
      needsDraw=false;
    }
    drawOverlay();
  } catch (err) { error(err.message); status('Rendering failed. Your heightfield remains available to save.'); return; }
  if (stroke || moving) schedule();
}
function drawOverlay() {
  ink.clearRect(0,0,size,size);
  if (config.map) { const display=previewHeight(); drawMapBounds(ink,config.map,config,(x,y) => sample(display,x,y)); }
  if (cursor && !pan && !space && tool!=='move') {
    ink.strokeStyle='#b8eef3'; ink.fillStyle='#a7e6f00c'; ink.lineWidth=1.5;
    ink.beginPath(); ink.arc(cursor.cx,cursor.cy,stroke?.radius ?? Number($('diameter').value)/2,0,Math.PI*2); ink.fill(); ink.stroke();
    ink.beginPath(); ink.moveTo(cursor.cx-4,cursor.cy); ink.lineTo(cursor.cx+4,cursor.cy); ink.moveTo(cursor.cx,cursor.cy-4); ink.lineTo(cursor.cx,cursor.cy+4); ink.stroke();
  }
  if (selected>=0 && nodes[selected]?.points && !stroke) {
    ink.strokeStyle='#f3d36b'; ink.lineWidth=2; ink.beginPath();
    for (const [i,p] of nodes[selected].points.entries()) {
      const y=p.y-(Math.max(config.seaLevel,sample(heights,p.x,p.y))-config.baseHeight)*.5;
      if (i) ink.lineTo(p.x,y); else ink.moveTo(p.x,y);
    }
    ink.stroke();
  }
  if (tool==='move' && selected>=0 && nodes[selected]?.points && !stroke) {
    const hd=nodeHandles(nodes[selected]);
    ink.strokeStyle='#f3d36b88'; ink.lineWidth=1; ink.setLineDash([4,5]);
    ink.beginPath(); ink.arc(hd.centre.cx,hd.centre.cy,hd.radius,0,Math.PI*2); ink.stroke(); ink.setLineDash([]);
    ink.fillStyle='#f3d36b'; ink.strokeStyle='#1d2416'; ink.lineWidth=1.5;
    ink.beginPath(); ink.moveTo(hd.centre.cx,hd.centre.cy); ink.lineTo(hd.rotate.cx,hd.rotate.cy); ink.strokeStyle='#f3d36b88'; ink.stroke(); ink.strokeStyle='#1d2416';
    ink.beginPath(); ink.arc(hd.rotate.cx,hd.rotate.cy,7,0,Math.PI*2); ink.fill(); ink.stroke();
    ink.fillRect(hd.scale.cx-6,hd.scale.cy-6,12,12); ink.strokeRect(hd.scale.cx-6,hd.scale.cy-6,12,12);
  }
  if (stroke?.kind==='ramp') {
    ink.strokeStyle='#d4eda8'; ink.lineWidth=2; ink.setLineDash([6,5]); ink.beginPath();
    for (const [i,p] of stroke.path.entries()) {
      const y=p.y-(Math.max(config.seaLevel,sample(heights,p.x,p.y))-config.baseHeight)*.5;
      if (i) ink.lineTo(p.x,y); else ink.moveTo(p.x,y);
    }
    ink.stroke(); ink.setLineDash([]);
  }
  overlay.style.cursor=pan?'grabbing':space?'grab':tool==='move'?(moving?'grabbing':'default'):'none';
}
function screenPoint(event) { const r=canvas.getBoundingClientRect(); return {cx:(event.clientX-r.left)*canvas.width/r.width,cy:(event.clientY-r.top)*canvas.height/r.height}; }
function picked(screen) {
  let p;
  if (stroke?.kind==='ramp') {
    // The rendered ramp moves under the cursor as it is graded. Pick against
    // its captured surface instead, avoiding a feedback drift at the endpoint.
    const wx=screen.cx/canvas.width*size,sy=screen.cy/canvas.height*size;
    const projected=y => y-(Math.max(config.seaLevel,sample(stroke.base,wx,y))-config.baseHeight)*.5-sy;
    let previousY=sy+170,previous=projected(previousY);
    for (let y=previousY-2;y>=sy-80;y-=2) {
      const value=projected(y);
      if (value<=0 && previous>=0) {
        p=[wx,previousY-2*previous/Math.max(1e-6,previous-value)]; break;
      }
      previous=value; previousY=y;
    }
    p ??= [wx,sy];
  } else p=renderer.pick(screen.cx,screen.cy);
  if (!p || !Number.isFinite(p[0]) || !Number.isFinite(p[1])) return null;
  return {x:clamp(p[0],0,(config.map?.width??size)-1),y:clamp(p[1],0,(config.map?.height??size)-1)};
}
overlay.addEventListener('pointerdown',event => {
  if (!ready || loading || stroke || pan || ![0,1].includes(event.button)) return;
  event.preventDefault(); overlay.focus({preventScroll:true}); cursor=screenPoint(event);
  if (space || event.button===1) pan={x:event.clientX,y:event.clientY,left:$('viewport').scrollLeft,top:$('viewport').scrollTop};
  else {
    const p=picked(cursor); if (!p) return;
    if (tool==='move') {
      // A selected shape's handles take precedence over picking.
      let mode=null,i=-1;
      if (selected>=0 && nodes[selected]?.points) {
        const hd=nodeHandles(nodes[selected]),near=q => Math.hypot(cursor.cx-q.cx,cursor.cy-q.cy)<11;
        if (near(hd.rotate)) mode='rotate'; else if (near(hd.scale)) mode='scale';
        if (mode) i=selected;
      }
      if (!mode) { i=pickNode(p); selectNode(i); mode=event.shiftKey?'height':'move'; }
      if (i>=0 && nodes[i].points) {
        if (mode==='height' && (!nodes[i].params || ['deep','shallow','ramp','erase'].includes(nodes[i].kind))) mode='move';
        cancelWeather(); moving={index:i,mode,start:p,screen:{...cursor},pivot:nodePivot(nodes[i]),state:nodeState(nodes[i])};
      }
      pointerId=event.pointerId; overlay.setPointerCapture(event.pointerId); schedule(); return;
    }
    if (selected>=0) { selected=-1; renderLayers(); }
    cancelWeather();
    stroke=startStroke(tool,p); stroke.screenStart=cursor; paintingIntervals=[]; lastPaintingRAF=null; markChanged();
    if (tool==='crystal') stampCrystals(stroke); else if (tool!=='ramp') dab(stroke,p);
    status(tool==='ramp'?'Draw a curved route toward the other terrain level.':'Sculpting · preview draw every animation frame.'); updateControls();
  }
  pointerId=event.pointerId; overlay.setPointerCapture(event.pointerId); schedule();
});
overlay.addEventListener('pointermove',event => {
  if (!ready || (pointerId!==null && event.pointerId!==pointerId)) return; cursor=screenPoint(event);
  if (pan) { $('viewport').scrollLeft=pan.left+pan.x-event.clientX; $('viewport').scrollTop=pan.top+pan.y-event.clientY; }
  else if (moving) {
    const p=picked(cursor),n=nodes[moving.index],before=nodeBounds(n),c=moving.pivot,a=moving.start;
    if (moving.mode==='height') {
      // Drag up to raise, down to lower: half a height unit per pixel.
      const [lo,hi]=amountRange(n.kind);
      n.params={...n.params,amount:clamp(Math.round(moving.state.amount+(moving.screen.cy-cursor.cy)*.5),lo,hi)};
      $('amount').value=n.params.amount; updateControls();
    } else if (p) {
      const m=moving.mode==='rotate'?about(c,rotation(Math.atan2(p.y-c.y,p.x-c.x)-Math.atan2(a.y-c.y,a.x-c.x)))
        :moving.mode==='scale'?about(c,scaling(clamp(Math.hypot(p.x-c.x,p.y-c.y)/Math.max(4,Math.hypot(a.x-c.x,a.y-c.y)),.2,5)))
        :[1,0,0,1,p.x-a.x,p.y-a.y];
      transformNode(n,moving.state,m);
      if (moving.mode==='scale') $('diameter').value=clamp(n.params.radius*2,40,800);
    }
    pendingRect=unionRect(pendingRect,unionRect(before,nodeBounds(n))); pendingEval=pendingEval<0?moving.index:Math.min(pendingEval,moving.index);
    moving.rect=unionRect(moving.rect,pendingRect);
  }
  else if (stroke) { const p=picked(cursor); if (p) { if (stroke.kind==='ramp') ramp(stroke,p); else extendStroke(stroke,p); } }
  schedule(Boolean(stroke));
});
function endPointer(event) {
  if (pointerId!==event.pointerId) return;
  if (moving) {
    flushEval();
    if (moving.rect) { pendingRect=moving.rect; pendingEval=moving.index; }
    moving=null; pointerId=null; if (overlay.hasPointerCapture(event.pointerId)) overlay.releasePointerCapture(event.pointerId); flushEval(); markViewChanged(); checkpoint(); queueWeather(); updateControls(); schedule(); return; }
  if (stroke && event.type==='pointerup') { cursor=screenPoint(event); const p=picked(cursor); if (p) { if (stroke.kind==='ramp') ramp(stroke,p); else extendStroke(stroke,p); } }
  const hadStroke=Boolean(stroke);
  const rawPath=stroke?stroke.path.map(p => ({...p})):null;
  if (stroke) { settleHill(stroke); settleRamp(stroke); if (stroke.kind==='crater') addCraterlets({points:rawPath,params:strokeParams(stroke)},stroke); }
  if (stroke) { applyCracks(stroke); prefix[nodes.length]={h:stroke.base,p:stroke.protectBase,r:stroke.routeBase,c:stroke.crackBase,v:stroke.coverBase,x:stroke.crystalBase,...(stroke.masks?stroke.masks.base:maskSnapshot())}; nodes.push({kind:stroke.kind,points:rawPath,params:strokeParams(stroke),seed:stroke.seed}); prefix.length=nodes.length; evaluate(nodes.length-1); renderLayers(); }
  if (stroke) lastWaterStroke=['deep','shallow'].includes(stroke.kind)?stroke:null;
  stroke=null; pan=null; pointerId=null;
  if (overlay.hasPointerCapture(event.pointerId)) overlay.releasePointerCapture(event.pointerId);
  if (hadStroke) { checkpoint(); status('Stroke complete · full-detail draw.'); queueWeather(); }
  updateControls(); schedule();
}
overlay.addEventListener('pointerup',endPointer); overlay.addEventListener('pointercancel',endPointer);
overlay.addEventListener('lostpointercapture',event => { if (stroke || pan || moving) endPointer(event); });
overlay.addEventListener('pointerleave',() => { if (!stroke && !pan) cursor=null; schedule(false); }); overlay.addEventListener('contextmenu',event => event.preventDefault());
function resize() {
  if (!config) return; const viewport=$('viewport');
  const scale=fitView?Math.max(.05,Math.min((viewport.clientWidth-28)/size,(viewport.clientHeight-28)/size)):1;
  if (!resizeMap(config.map,size,fitView,viewport,$('stage'),canvas,overlay)) { $('stage').style.width=size*scale+'px'; $('stage').style.height=size*scale+'px'; }
  if (fitView) { viewport.scrollLeft=viewport.scrollTop=0; } updateControls(); schedule();
}

function demoStroke(kind,points,options) {
  const defaults=toolDefaults(kind);
  // Older reviewed examples keep their authored geometry. New island scenes
  // exercise the biome's default shapes.
  const island=experiment.get('example')==='islands';
  const probe=startStroke(kind,points[0],{...shapeDefaults(),cracks:(experiment.has('hillCracks')?Number(experiment.get('hillCracks')):1)*defaults.cracks/100,bankWidth:island?defaults.bankWidth/100:.5,beachFlatness:island?defaults.beachFlatness/100:.5,softness:experiment.has('soft')?Number(experiment.get('soft')):island?defaults.softness/100:.5,...options});
  addNode({kind,points:points.map(p => ({...p})),params:strokeParams(probe),seed:probe.seed});
}
function demoRamp(points,options) {
  const probe=startStroke('ramp',points[0],options);
  addNode({kind:'ramp',points:points.map(p => ({...p})),params:strokeParams(probe),seed:probe.seed});
}
// Capture tools rebuild a map from strokes: [kind, [[x,y],...], options],
// each starting from the brush card's defaults for this world. options.card
// overrides card values (diameter, amount, roughness ... in card units); any
// other key is a startStroke option.
function scriptedScene(list,{ground=true}={}) {
  applySeedControl(); refinementSeed=seed;
  lastWaterStroke=null; cancelWeather(); refined=refinedBase=null; renderer.setWeather(); heights.fill(config.baseHeight); protection.fill(0); routes.fill(0); cracks.fill(0); cover.fill(0); crystal.fill(0); clearMasks();
  nodes=[]; prefix=[]; selected=-1;
  if (ground) addGroundNode();
  list.forEach(([kind,points,options={}],i) => {
    const {card:override,...rest}=options,d={...toolDefaults(kind),...override},pts=points.map(([x,y]) => ({x,y}));
    const card={radius:d.diameter/2,amount:d.amount,rough:d.roughness/100,shelves:d.shelves/100,bankWidth:d.bankWidth/100,beachFlatness:d.beachFlatness/100,softness:d.softness/100,cracks:d.cracks/100,shallowMode:d.shallowMode,
      ...Object.fromEntries(SHAPE_FIELDS.map(([key,,,,,,,scale]) => [key,d[key]/scale])),seed:(seed+i*7919)>>>0};
    const probe=startStroke(kind,pts[0],{...card,...rest});
    addNode({kind,points:pts,params:strokeParams(probe),seed:probe.seed});
  });
  markChanged(); checkpoint(); updateControls(); schedule(); queueWeather();
  return nodes.length;
}
function mixedScene() {
  applySeedControl(); refinementSeed=seed;
  lastWaterStroke=null; cancelWeather(); refined=refinedBase=null; renderer?.setWeather(); heights.fill(config.baseHeight); protection.fill(0); routes.fill(0); cracks.fill(0); cover.fill(0); crystal.fill(0); clearMasks();
  nodes=[]; prefix=[]; selected=-1;
  addGroundNode();
  if (experiment.get('example')==='columns') {
    // Crystal's starting example shows the tool that defines its islands.
    demoStroke('deep',[{x:70,y:0},{x:45,y:480},{x:95,y:1023}],{radius:180,rough:.4,shelves:.8});
    demoStroke('deep',[{x:0,y:1040},{x:530,y:990},{x:1050,y:1040}],{radius:160,rough:.4,shelves:.8});
    demoStroke('crystal',[{x:520,y:300},{x:660,y:370},{x:730,y:500}],{radius:150,amount:115,rough:.6,crystalForm:1});
    demoStroke('crystal',[{x:330,y:600},{x:300,y:780}],{radius:100,amount:65,rough:.5,crystalForm:1});
    demoStroke('crystal',[{x:215,y:180},{x:235,y:510},{x:225,y:810}],{radius:85,amount:10,rough:.45,crystalForm:0,crystalSize:30,crystalCount:5,crystalTop:.88,crystalLean:0});
    return;
  }
  if (experiment.get('example')==='islands') {
    demoStroke('deep',[{x:50,y:0},{x:100,y:300},{x:35,y:650},{x:150,y:1023}],{radius:150,rough:.6,shelves:.9});
    demoStroke('deep',[{x:0,y:900},{x:450,y:910},{x:1023,y:850}],{radius:165,rough:.55,shelves:.8});
    demoStroke('deep',[{x:1023,y:0},{x:960,y:280},{x:960,y:570},{x:1023,y:1023}],{radius:125,rough:.5,shelves:.85});
    demoStroke('deep',[{x:105,y:575},{x:320,y:630},{x:470,y:760}],{radius:90,rough:.5,shelves:.8});
    demoStroke('shallow',[{x:55,y:270},{x:115,y:365}],{radius:60,rough:.3,shallowMode:'area'});
    demoStroke('shallow',[{x:600,y:910},{x:735,y:910}],{radius:70,rough:.3,shallowMode:'area'});
    demoStroke('hill',[{x:440,y:240},{x:555,y:285}],{radius:95,amount:38,rough:.35});
    demoStroke('hill',[{x:680,y:420},{x:730,y:455}],{radius:54,amount:26,rough:.45});
    demoStroke('plateau',[{x:450,y:470},{x:550,y:480}],{radius:82,amount:40,rough:.4});
    demoRamp([{x:525,y:480},{x:600,y:535},{x:640,y:595}],{radius:32,rough:.18});
    markChanged(); return;
  }
  if (experiment.get('example')==='intersections') {
    // Deliberately small joins exercise the same freehand brushes as the editor.
    demoStroke('plateau',[{x:210,y:230},{x:340,y:245},{x:420,y:330},{x:530,y:315}],{radius:65,amount:54,rough:.5});
    demoStroke('plateau',[{x:215,y:230},{x:260,y:235}],{radius:70,amount:30,rough:.4});
    demoStroke('hill',[{x:230,y:227},{x:262,y:238}],{radius:35,amount:24,rough:.5});
    demoRamp([{x:520,y:315},{x:575,y:355},{x:545,y:415},{x:605,y:460}],{radius:25,rough:.18});
    demoStroke('hill',[{x:180,y:430},{x:240,y:470},{x:320,y:445}],{radius:27,amount:28,rough:.5});
    demoStroke('mountain',[{x:755,y:230},{x:805,y:315}],{radius:62,amount:70,rough:.5});
    demoStroke('plateau',[{x:760,y:500},{x:855,y:525}],{radius:115,amount:65,rough:.5});
    demoStroke('deep',[{x:0,y:690},{x:300,y:675},{x:650,y:700},{x:1023,y:695}],{radius:145,rough:.55});
    demoStroke('shallow',[{x:485,y:495},{x:470,y:825}],{radius:33,rough:.3,shallowMode:'passage'});
    markChanged(); return;
  }
  if (experiment.get('example')==='joins') {
    // Compact relative levels leave room to judge their joins against grass.
    demoStroke('plateau',[{x:270,y:290},{x:420,y:310}],{radius:112,amount:42,rough:.32});
    demoStroke('plateau',[{x:285,y:275},{x:320,y:270}],{radius:67,amount:38,rough:.26});
    demoRamp([{x:305,y:280},{x:360,y:295},{x:425,y:300}],{radius:27,rough:.14});
    demoRamp([{x:430,y:325},{x:485,y:370},{x:450,y:440},{x:505,y:500},{x:610,y:535}],{radius:38,rough:.18});
    demoStroke('hill',[{x:190,y:590},{x:250,y:560},{x:315,y:595},{x:365,y:655}],{radius:39,amount:35,rough:.35});
    markChanged(); return;
  }
  if (experiment.get('example')==='coasts') {
    // Ordinary banks and a raised plateau cut by the same channel make the
    // elevation-dependent coastal materials visible in one comparison.
    demoStroke('plateau',[{x:690,y:320},{x:830,y:350}],{radius:140,amount:85,rough:.5});
    demoStroke('hill',[{x:230,y:250},{x:310,y:275}],{radius:82,amount:35,rough:.45});
    demoStroke('deep',[{x:0,y:530},{x:320,y:500},{x:700,y:520},{x:1023,y:550}],{radius:165,rough:.45});
    demoStroke('shallow',[{x:465,y:320},{x:485,y:750}],{radius:45,rough:.22,shallowMode:'area'});
    markChanged(); return;
  }
  if (experiment.get('example')==='mesas') {
    // Painted Desert landforms at about retail proportions: a broad mesa
    // (cap ~30% of its foot) with a spire, a lower mesa and rounded hills.
    demoStroke('plateau',[{x:470,y:560},{x:560,y:600}],{radius:300,amount:67,rough:.18,softness:1});
    demoStroke('mountain',[{x:530,y:570}],{radius:60,amount:60,rough:.5,softness:.3});
    demoStroke('plateau',[{x:150,y:180},{x:260,y:220}],{radius:150,amount:45,rough:.25,softness:.9});
    demoStroke('hill',[{x:860,y:180},{x:900,y:260}],{radius:110,amount:35,rough:.45});
    demoStroke('hill',[{x:170,y:860}],{radius:80,amount:25,rough:.45});
    markChanged(); return;
  }
  if (experiment.get('example')==='hills') {
    // Same authored strokes for profile comparisons at native feature scales.
    demoStroke('hill',[{x:210,y:245}],{radius:76,amount:55,rough:.45});
    demoStroke('hill',[{x:610,y:180},{x:720,y:225},{x:800,y:190}],{radius:82,amount:55,rough:.45});
    demoStroke('hill',[{x:165,y:565},{x:240,y:610},{x:310,y:710}],{radius:48,amount:45,rough:.5});
    demoStroke('hill',[{x:650,y:620},{x:730,y:680}],{radius:118,amount:38,rough:.45});
    markChanged(); return;
  }
  demoStroke('deep',[{x:70,y:760},{x:260,y:710},{x:450,y:680},{x:650,y:730},{x:850,y:870},{x:1023,y:880}],{radius:150,rough:.35});
  demoStroke('shallow',[{x:440,y:560},{x:455,y:810}],{radius:49,rough:.18,shallowMode:'area'});
  demoStroke('plateau',[{x:220,y:250},{x:330,y:255},{x:350,y:350},{x:250,y:390}],{radius:98,amount:80,rough:.4});
  demoStroke('hill',[{x:260,y:280},{x:275,y:295}],{radius:65,amount:40,rough:.35});
  demoStroke('hill',[{x:590,y:290},{x:680,y:340},{x:750,y:470}],{radius:115,amount:80,rough:.45});
  demoStroke('mountain',[{x:800,y:160},{x:860,y:250}],{radius:100,amount:150,rough:.5});
  demoRamp([{x:280,y:350},{x:430,y:535}],{radius:65,rough:.22});
  if (experiment.get('scene')==='compact') addNode({kind:'compact',factor:.60});
  markChanged();
}
function encodedHeights(field=heights) {
  const bytes=new Uint8Array(field.length*4),view=new DataView(bytes.buffer);
  for (let i=0;i<field.length;i++) view.setFloat32(i*4,field[i],true);
  let text=''; for (let i=0;i<bytes.length;i+=32768) text+=String.fromCharCode(...bytes.subarray(i,i+32768));
  return btoa(text);
}
function sketch() {
  applySeedControl();
  rememberTool();
  return {format:'nanolathe-terrain-sculpt',version:4,nodes:serializeNodes(),map:config.map,biome:config.biomeId||'green',variant:config.variant||'',size,grid,baseHeight:config.baseHeight,seaLevel:config.seaLevel,seed,refinementSeed,
    toolSettings,bankWidth:Number($('bank-width').value),softness:Number($('softness').value),relief:Number($('relief').value),
    beachFlatness:Number($('beach-flatness').value),mineralRing:Number($('mineral-ring').value),ringSpread:Number($('ring-spread').value),
    ringVariation:Number($('ring-variation').value),fringeStyle:$('fringe-style').value,materialWeathering:Number($('material-weathering').value),depositSpread:Number($('deposit-spread').value),transitionDetail:Number($('transition-detail').value),
    tool,diameter:Number($('diameter').value),amount:Number($('amount').value),roughness:Number($('roughness').value),shelves:Number($('shelves').value),shallowMode:$('shallow-mode').value,fractures:Number($('fractures').value),scree:Number($('scree').value),weather:$('weather').checked,clay:$('clay').checked,light:$('light').value,encoding:'float32-le/base64',heights:encodedHeights(),protection:encodedHeights(protection),routes:encodedHeights(routes)};
}
function persistLater() {
  if (experiment.has('scratch')) { $('save-state').textContent='Comparison sketch · use Save sketch to keep it.'; return; }
  clearTimeout(autosaveTimer); autosaveTimer=setTimeout(() => {
    if (stroke || loading) { persistLater(); return; }
    try { localStorage.setItem(LOCAL_KEY,JSON.stringify(sketch())); $('save-state').textContent='Terrain recipe autosaved locally.'; }
    catch (_) { $('save-state').textContent='Local autosave unavailable. Use Save sketch to keep this heightfield.'; }
  },450);
}
function loadSketch(s) {
  if (!s || s.format!=='nanolathe-terrain-sculpt' || ![3,4].includes(s.version) || s.size!==size || s.grid!==grid || s.encoding!=='float32-le/base64' || typeof s.heights!=='string' || s.heights.length>heights.length*6) throw new Error('Load a v3 sculpt sketch with the same canvas and grid size. Painter sketches use a different format.');
  const binary=atob(s.heights); if (binary.length!==heights.length*4) throw new Error('The saved heightfield has the wrong length.');
  const bytes=Uint8Array.from(binary,c => c.charCodeAt(0)),view=new DataView(bytes.buffer),next=new Float32Array(heights.length);
  for (let i=0;i<next.length;i++) { const v=view.getFloat32(i*4,true); if (!Number.isFinite(v) || v<MIN_HEIGHT || v>MAX_HEIGHT) throw new Error('The sketch contains an invalid terrain height.'); next[i]=v; }
  const nextProtect=new Float32Array(next.length);
  if (s.protection) {
    const raw=atob(s.protection); if (raw.length!==next.length*4) throw new Error('Invalid protected-surface mask.');
    const buffer=Uint8Array.from(raw,c=>c.charCodeAt(0)),values=new DataView(buffer.buffer);
    for (let i=0;i<next.length;i++) { const v=values.getFloat32(i*4,true); if (!Number.isFinite(v)||v<0||v>1) throw new Error('Invalid protected-surface value.'); nextProtect[i]=v; }
  }
  const nextRoutes=new Float32Array(next.length);
  if (s.routes) {
    const raw=atob(s.routes); if (raw.length!==next.length*4) throw new Error('Invalid ramp surface mask.');
    const values=new DataView(Uint8Array.from(raw,c=>c.charCodeAt(0)).buffer);
    for (let i=0;i<next.length;i++) { const v=values.getFloat32(i*4,true); if (!Number.isFinite(v)||v<0||v>1) throw new Error('Invalid ramp surface value.'); nextRoutes[i]=v; }
  }
  lastWaterStroke=null; cancelWeather(); refined=refinedBase=null; renderer?.setWeather();
  heights.set(next); protection.set(nextProtect); routes.set(nextRoutes); cracks.fill(0); cover.fill(0); crystal.fill(0); clearMasks(); seed=Number.isInteger(s.seed)?clamp(s.seed,0,4294967295):2701; $('seed').value=seed; noise=makeNoise(seed);
  refinementSeed=Number.isInteger(s.refinementSeed)?clamp(s.refinementSeed,0,4294967295):seed;
  if (Object.hasOwn(HELP,s.tool)) tool=s.tool;
  for (const kind of Object.keys(HELP)) {
    const restored={...toolDefaults(kind)},saved=s.toolSettings?.[kind];
    if (saved && typeof saved==='object') {
      for (const [key,[,lo,hi]] of Object.entries(TOOL_FIELDS)) if (Number.isFinite(saved[key])) restored[key]=clamp(saved[key],lo,hi);
      restored.preset=Object.hasOwn(TOOL_PRESETS,saved.preset)?saved.preset:'custom';
      restored.shallowMode=saved.shallowMode==='area'?'area':'passage';
    }
    toolSettings[kind]=restored;
  }
  showTool(toolSettings[tool]);
  if (Number.isFinite(s.diameter)) $('diameter').value=clamp(s.diameter,40,800);
  if (Number.isFinite(s.amount)) $('amount').value=clamp(s.amount,...amountRange(tool));
  if (Number.isFinite(s.roughness)) $('roughness').value=clamp(s.roughness,0,100);
  if (Number.isFinite(s.shelves)) $('shelves').value=clamp(s.shelves,0,100);
  $('shallow-mode').value=s.shallowMode==='passage'?'passage':'area';
  $('fractures').value=Number.isFinite(s.fractures)?clamp(s.fractures,0,100):0;
  $('scree').value=Number.isFinite(s.scree)?clamp(s.scree,0,100):0;
  $('bank-width').value=Number.isFinite(s.bankWidth)?clamp(s.bankWidth,0,100):50;
  $('beach-flatness').value=Number.isFinite(s.beachFlatness)?clamp(s.beachFlatness,0,100):50;
  $('softness').value=Number.isFinite(s.softness)?clamp(s.softness,0,100):50;
  $('relief').value=Number.isFinite(s.relief)?clamp(s.relief,0,160):Math.round((config.material?.surfaceRelief??1)*100);
  $('mineral-ring').value=Number.isFinite(s.mineralRing)?clamp(s.mineralRing,0,100):Math.round((config.material?.ringAmount??0)*100);
  $('ring-spread').value=Number.isFinite(s.ringSpread)?clamp(s.ringSpread,0,100):Math.round((config.material?.ringSpread??.65)*100);
  $('material-weathering').value=Number.isFinite(s.materialWeathering)?clamp(s.materialWeathering,0,100):Math.round((config.material?.materialWeathering??0)*100);
  $('deposit-spread').value=Number.isFinite(s.depositSpread)?clamp(s.depositSpread,0,100):Math.round((config.material?.depositSpread??.65)*100);
  $('transition-detail').value=Number.isFinite(s.transitionDetail)?clamp(s.transitionDetail,0,100):Math.round((config.material?.transitionDetail??.65)*100);
  $('ring-variation').value=Number.isFinite(s.ringVariation)?clamp(s.ringVariation,0,100):Math.round((config.material?.ringVariation??.7)*100);
  $('fringe-style').value=config.textures.mineralRings&&(s.fringeStyle==='rings'||!config.textures.mineralRing)?'rings':'veins';
  rememberTool(!s.toolSettings);
  if (typeof s.weather==='boolean') $('weather').checked=s.weather;
  if (typeof s.clay==='boolean') $('clay').checked=s.clay;
  if (['original','alternate'].includes(s.light)) $('light').value=s.light;
  // A v4 recipe rebuilds from its nodes; a v3 sketch becomes one raster node.
  nodes=s.version===4 && Array.isArray(s.nodes)?deserializeNodes(s.nodes):[{kind:'raster',heights:heights.slice(),protection:protection.slice(),routes:routes.slice()}];
  prefix=[]; selected=-1; evaluate(0); renderLayers();
  markChanged(); updateControls();
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
async function loadSketchFile(s) {
  const biome=typeof s?.biome==='string'?s.biome:'';
  const mapChanged=(s?.map?.unitsX??0)!==(config.map?.unitsX??0) || (s?.map?.unitsY??0)!==(config.map?.unitsY??0) || (s?.map && s.seaLevel!==config.seaLevel);
  if (biome && (biome!==config.biomeId || mapChanged)) {
    let served=false,variant='';
    try {
      const response=await fetch('/sculpt-config.json?biome='+encodeURIComponent(biome));
      const servedConfig=response.ok?await response.json():null;
      served=servedConfig?.biomeId===biome;
      variant=served && typeof s.variant==='string' && servedConfig.variants?.[s.variant]?s.variant:'';
    } catch (_) {}
    if (!served) { error(`The saved terrain belongs to the ${biome} world, which this server does not have. The current terrain was left as it was.`); return; }
    const token=Math.random().toString(36).slice(2)+Date.now().toString(36);
    try { await stashPendingSketch(token,s); }
    catch (err) { error('The saved terrain could not be carried to '+biome+': '+err.message); return; }
    status(`Opening ${biome} for the saved terrain…`);
    goToWorld(biome,null,{pendingSketch:token,variant,mapX:s.map?.unitsX??'',mapY:s.map?.unitsY??'',sea:s.map?s.seaLevel:''});
    return;
  }
  loadSketch(s); checkpoint(); status('Loaded the saved terrain.'); schedule(); queueWeather();
}
function addGroundNode() {
  const amplitude=experiment.has('undulation')?Number(experiment.get('undulation')):10;
  if (amplitude>0) addNode({kind:'ground',amplitude,wavelength:experiment.has('undulationScale')?Number(experiment.get('undulationScale')):200,coverage:experiment.has('undulationCover')?Number(experiment.get('undulationCover')):.45,seed:seed^0x9e37});
}
function serializeNodes() {
  return nodes.map(n => n.kind==='raster'?{kind:'raster',hidden:n.hidden,heights:encodedHeights(n.heights),protection:encodedHeights(n.protection),routes:encodedHeights(n.routes)}:{...n,points:n.points?.map(p => ({x:p.x,y:p.y}))});
}
function deserializeNodes(list) {
  const decode=text => { const raw=atob(text),view=new DataView(Uint8Array.from(raw,c => c.charCodeAt(0)).buffer),out=new Float32Array(raw.length/4); for (let i=0;i<out.length;i++) out[i]=view.getFloat32(i*4,true); return out; };
  return list.filter(n => n && (NODE_NAMES[n.kind])).map(n => n.kind==='raster'?{kind:'raster',hidden:Boolean(n.hidden),heights:decode(n.heights),protection:decode(n.protection),routes:decode(n.routes)}:{kind:n.kind,hidden:Boolean(n.hidden),factor:n.factor,amplitude:n.amplitude,wavelength:n.wavelength,coverage:n.coverage,seed:n.seed,params:n.params,points:n.points,frame:Array.isArray(n.frame) && n.frame.length===6 && n.frame.every(Number.isFinite)?n.frame:undefined});
}
function download(blob,name) { const url=URL.createObjectURL(blob),a=document.createElement('a'); a.href=url; a.download=name; a.click(); setTimeout(() => URL.revokeObjectURL(url),1000); }
for (const b of document.querySelectorAll('[data-tool]')) b.addEventListener('click',() => { if (stroke) return; rememberTool(); tool=b.dataset.tool; if (tool!=='move' && selected>=0) { selected=-1; renderLayers(); } showTool(toolSettings[tool]); updateControls(); schedule(); persistLater(); });
for (const id of ['diameter','amount','roughness','shelves','bank-width','beach-flatness','softness','cracks']) $(id).addEventListener('input',() => { rememberTool(true); updateControls(); schedule(); persistLater(); if (selected>=0) editSelectedFromControls(); });
for (const id of ['diameter','amount','roughness','shelves','bank-width','beach-flatness','softness','cracks']) $(id).addEventListener('change',() => { if (selected>=0) { checkpoint(); queueWeather(); } });
for (const [id,kind] of [['node-seed','seed'],['node-delete','delete'],['node-up','up'],['node-down','down'],['node-hide','hide']]) $(id).addEventListener('click',() => nodeAction(kind));
$('tool-style').addEventListener('change',() => { const preset=$('tool-style').value; if (!Object.hasOwn(TOOL_PRESETS,preset)) return; toolSettings[tool]=toolDefaults(tool,preset); showTool(toolSettings[tool]); updateControls(); schedule(); persistLater(); });
for (const id of ['relief','transition-detail']) $(id).addEventListener('input',() => { markViewChanged(); updateControls(); schedule(); persistLater(); });
for (const id of ['mineral-ring','ring-spread','ring-variation']) $(id).addEventListener('input',() => { markViewChanged(); updateControls(); schedule(); persistLater(); });
for(const id of ['material-weathering','deposit-spread']) $(id).addEventListener('input',()=>{markViewChanged();updateControls();schedule();queueWeather();persistLater();});
$('fringe-style').addEventListener('change',() => { markViewChanged(); schedule(); persistLater(); });
$('fractures').addEventListener('input',() => { markViewChanged(); updateControls(); schedule(); persistLater(); });
$('shallow-mode').addEventListener('change',() => { rememberTool(true); updateControls(); persistLater(); if (selected>=0) { editSelectedFromControls(); checkpoint(); queueWeather(); } });
$('scree').addEventListener('input',() => { markViewChanged(); updateControls(); schedule(); queueWeather(); persistLater(); });
$('water-reapply').addEventListener('click',reapplyWater);
function applySeedControl() {
  const next=clamp(Math.trunc(Number($('seed').value) || 0),0,4294967295);
  if (next!==seed) { seed=next; if (config) noise=makeNoise(seed); }
  $('seed').value=seed;
}
$('seed').addEventListener('change',() => { applySeedControl(); schedule(); persistLater(); });
for (const id of ['clay','light']) $(id).addEventListener('change',() => { markViewChanged(); schedule(); persistLater(); });
$('weather').addEventListener('change',() => {
  cancelWeather(); markViewChanged();
  if (!$('weather').checked) renderer.setWeather();
  heightDirty=true; schedule(); queueWeather(); persistLater();
});
$('fit').addEventListener('click',() => { fitView=true; resize(); }); $('one').addEventListener('click',() => { fitView=false; resize(); });
$('undo').addEventListener('click',() => moveHistory(-1)); $('redo').addEventListener('click',() => moveHistory(1));
$('demo').addEventListener('click',() => {
  if (stroke) return;
  experiment.set('example',$('example').value); mixedScene(); checkpoint();
  status('Example loaded · sculpt across the joins.'); schedule(); queueWeather();
});
$('blank').addEventListener('click',() => { if (stroke) return; applySeedControl(); refinementSeed=seed; lastWaterStroke=null; cancelWeather(); refined=refinedBase=null; renderer.setWeather(); heights.fill(config.baseHeight); protection.fill(0); routes.fill(0); cracks.fill(0); cover.fill(0); crystal.fill(0); clearMasks(); nodes=[]; prefix=[]; selected=-1; addGroundNode(); markChanged(); checkpoint(); status('Blank dry ground.'); schedule(); queueWeather(); });
$('save').addEventListener('click',() => { if (!stroke) download(new Blob([JSON.stringify(sketch())],{type:'application/json'}),'terrain-sculpt-v3.json'); });
$('load').addEventListener('click',() => { if (!stroke) $('file').click(); });
$('file').addEventListener('change',async () => {
  const file=$('file').files[0]; $('file').value=''; if (!file || stroke) return;
  loading=true; $('editor').disabled=true;
  try { if (file.size>64*1024*1024) throw new Error('This sculpt sketch is too large to load.'); await loadSketchFile(JSON.parse(await file.text())); } catch (err) { error(err.message); }
  finally { loading=false; $('editor').disabled=false; updateControls(); }
});
function renderExportView(corners) {
  if (corners) { renderer.setHeight(exportMapField(config.map,corners,size,grid),grid); heightDirty=false; }
  if (heightDirty) { renderer.setHeight(previewHeight(),grid); renderer.setRoutes(routes,cracks,cover,crystal,maskPlanes); heightDirty=false; }
  const start=performance.now(),stats=renderer.draw({quality:'full',clay:$('clay').checked,light:$('light').value,fractures:Number($('fractures').value)/100,scree:Number($('scree').value)/100,detail:Number($('relief').value)/100,ring:Number($('mineral-ring').value)/100,ringSpread:Number($('ring-spread').value)/100,ringVariation:Number($('ring-variation').value)/100,fringeStyle:$('fringe-style').value,materialWeathering:Number($('material-weathering').value)/100,transitionDetail:Number($('transition-detail').value)/100});
  drawTiming(stats,performance.now()-start,'full');
}
$('export').addEventListener('click',() => {
  if (!canExport()) return;
  try {
    renderExportView(); const rev=revision,job=weatherJob;
    canvas.toBlob(blob => { if (!blob) error('PNG export is unavailable for this renderer.'); else if (revision!==rev || weatherJob!==job || !canExport()) error('The terrain changed during export. Export the finished view again.'); else download(blob,'terrain-sculpt.png'); },'image/png');
  } catch (err) { error(err.message); }
});
const typing=target => target instanceof HTMLElement && (['INPUT','SELECT','TEXTAREA'].includes(target.tagName) || target.isContentEditable);
window.addEventListener('keydown',event => {
  if (typing(event.target) || loading) return;
  if (event.code==='Space' && !(event.target instanceof HTMLButtonElement)) { event.preventDefault(); space=true; schedule(false); }
  if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase()==='z') { event.preventDefault(); moveHistory(event.shiftKey?1:-1); }
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
window.addEventListener('keyup',event => { if (event.code==='Space') { space=false; schedule(false); } });
window.addEventListener('blur',() => { space=false; cursor=null; schedule(false); }); new ResizeObserver(resize).observe($('viewport'));


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
  ['Sand', [['sand','Weathering supply',0,2,.05,0],['sandReach','Water transport',0,1,.05,.6],['windStrength','Wind strength',0,1,.05,.5],
    ['wind','Wind toward (deg)',0,360,5,20],['sandPatchy','Patchiness (flows and piles)',0,1,.05,.7],['sandTail','Fines carried beyond',0,1,.05,.6],['sandDust','Dusting tint',0,1,.05,.5],['sandGrass','Grass regrowing over sand',0,1,.05,.6],['sandLight','Weathered lightness',0,1,.05,.25],['sandGrain','Rock grain in sand',0,1,.05,.8],
    ['ripple','Ripple length (px)',0,16,1,7],['rippleHeight','Ripple height',0,3,.1,1.4]]],
  ['Cracks', [['crackSeverity','Depth',0,1,.05,.6],['crackSpacing','Block size (px)',16,96,2,40],['crackLength','Length down the slope',1,4,.25,2],
    ['crackMajor','Major cracks',0,1,.05,.8],['crackMinor','Minor cracks',0,1,.05,.75],['crackHairline','Hairline crazing',0,1,.05,.6],['crackBlocks','Facets (block relief)',0,1.5,.05,.6],
    ['crackWidth','Width (px)',.5,2.5,.1,1],['crackJagged','Jaggedness',0,1,.05,.6],['crackNetwork','Majors: rills to plates',0,1,.05,.35],['crackReach','Reach onto gentle slopes',0,1,.05,.6],
    ['crackDark','Floor darkness',0,1,.05,.75],['crackLit','Lit wall',0,1,.05,.35],['crackStyle','Style (0 ink, 1 lit relief)',0,1,.05,0]]],
  ['Rock structure', [['rockOrder','Order (0 scattered, 1 beds and joints)',0,1,.05,0],['rockFrom','Beds and joints from slope (painted rock always)',.3,2,.05,.6],['bedSpacing','Bed thickness (px along the ground, or height units)',3,80,1,12],['bedHeight','Beds spaced by height (0 px along the ground)',0,1,.05,0],['bedVary','Bed thickness variation',0,1,.05,.5],
    ['bedDip','Bed tilt (height per px; 2 north: level rows)',-4,4,.05,0],['bedDipDir','Bed tilt toward (deg, 0 east, 90 south)',0,360,5,90],['bedLedge','Ledge step strength',0,1,.05,.5],['bedLip','Ledge lip and notch (height)',0,4,.1,1],
    ['jointSpacing','Joint spacing (px)',12,120,2,36],['jointAngle','Joint lean from north-south (deg)',-60,60,1,0],['jointDepth','Joint depth (height)',0,6,.1,2],['jointRun','Joint run (px)',30,400,10,120],['jointGaps','Joint gaps',0,1,.05,.3]]],
  ['Contour bands', [['banding','Strength',0,1,.05,0],['bandSpacing','Height per band',1,12,.25,3.7],['bandSoftness','Riser share',.05,1,.05,.35],['bandLine','Line darkness',0,1,.05,.5],['bandWidth','Bank line width at half depth (px; 0 thin)',0,4,.1,0],['bandStyle','Style (0 tonal steps, 1 bank lines)',0,1,1,0],['bandRelief','Bank lines bent by relief',0,1,.05,0],['bandWander','Bank line wander',0,2,.05,0],['bandGaps','Bank line gaps',0,1,.05,0],['bandWater','Rings in water colour',0,1,.05,0],['sandBanding','Streaks on sand and ramps',0,1,.05,0],['sandBandSpacing','Streak height step',.3,4,.1,2]]],
  ['Strata', [['strata','Strength (painted beds)',0,1,.05,0],['strataSpacing','Bed thickness (height)',3,40,1,10],['strataWarp','Bed waviness',0,40,1,12],['strataContrast','Colour strength',0,1,.05,.6],['strataGrain','Bed grain',0,1,.05,1]]],
  ['Water', [['beachWidth','Beach width (worlds with beaches)',0,2,.05,.6],['apron','Sand apron round raised rock (px)',0,120,2,0],['shallowDepth','Shallow until depth',0,60,1,24],['deepDepth','Deep from depth',10,100,1,60],['waterSoft','Colour depth averaging (px)',0,64,2,32],['crispShore','Crisp waterline (shore to shallow)',0,1,.05,1],['deepEdge','Hard shallow-to-deep step (0 ramp)',0,1,.05,0],['deepEdgeDepth','Step depth (0: the ramp\'s midpoint)',0,100,1,0],['bedLit','Lit bed under shallow water (0 noise water)',0,1,.05,0],['bedTint','Bed tint strength',0,1,.05,.85],['bedBright','Tinted bed brightness',.5,1.5,.02,1],['bedContrast','Bed light carried through the tint',0,1.5,.05,1],['bedRelief','Bed lumps (lit relief under shallows)',0,3,.05,0],['shoreEdge','Coast rim and lip (Lava)',0,1,.05,0],['bankRock','Rock on low banks',0,1,.05,.25]]],
  ['Palette', [['paletteMix','Mix palette pairs (0 nearest, 1 pairs)',0,1,1,0],['dither','Dither (water)',0,4,.1,2],['landDither','Land dither share',0,1,.05,.25]]],
];
// Worlds. A world is a biome's materials (prepared per biome by the server)
// plus the map-wide settings and base colours chosen for it. Built-in worlds
// can be adjusted; New world copies the current one under a new name. Kept in
// this browser (localStorage) and exportable as JSON.
const WORLD_STORE='nanolathe-map-editor-worlds';
const COLOR_KEYS=[['ground','Ground'],['slope','Slope cover'],['rock','Rock'],['sand','Sand'],['beach','Beach'],['shallow','Shallow water'],['deep','Deep water'],['crystal','Crystal'],['strata1','Strata 1'],['strata2','Strata 2'],['strata3','Strata 3'],['strata4','Strata 4'],['strata5','Strata 5']];
let worlds={},worldId=null;
function loadWorlds() { try { worlds=JSON.parse(localStorage.getItem(WORLD_STORE)||'{}')||{}; } catch (_) { worlds={}; } }
function saveWorlds() { try { localStorage.setItem(WORLD_STORE,JSON.stringify(worlds)); } catch (_) {} }
// A variant's colours (card C5) stay in config.colors; the world keeps only its base ones, so choosing a variant never writes into the world's own store.
function activeWorld() { return worlds[worldId] ??= {name:config.biome,base:config.biomeId,colors:{...(config.baseColors||config.colors||{})},knobs:{}}; }
const hexColor=c => '#'+c.map(v => Math.round(clamp(v,0,1)*255).toString(16).padStart(2,'0')).join('');
const rgbColor=h => [1,3,5].map(i => parseInt(h.slice(i,i+2),16)/255);
// A world's colours: the server's defaults for its base world, then the
// world's own choices; null means explicitly off (the texture's own colour).
function mergedColors() { return {...(config.colors||{}),...(activeWorld().colors||{})}; }
function worldColors() { const out={}; for (const [k,v] of Object.entries(mergedColors())) if (typeof v==='string' && /^#[0-9a-f]{6}$/i.test(v)) out[k]=rgbColor(v); return out; }
function defaultColor(key) {
  const m=renderer.means,w=config.water||{},mat=config.material||{};
  const rgb=v => v&&v.map(x => x/255);
  const strata=(config.strataColors||[[146,74,58],[188,122,96],[140,124,138],[198,182,158],[166,98,76]]).map(rgb);
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
    if (key==='beach' && !config.textures.beach) continue;
    if (key.startsWith('strata') && !(Number(experiment.get('strata'))>0)) continue;
    const row=document.createElement('div'); row.className='color-row';
    const set=mergedColors()[key];
    row.innerHTML=`<span>${label}</span><input type="checkbox" aria-label="Use a base colour for ${label}"${set?' checked':''}><input type="color" aria-label="${label} base colour" value="${set||hexColor(defaultColor(key))}">`;
    const [box,pick]=row.querySelectorAll('input');
    const apply=() => { if (box.checked) world.colors[key]=pick.value; else if (config.colors?.[key]) world.colors[key]=null; else delete world.colors[key]; saveWorlds(); renderer.setColors(worldColors()); markViewChanged(); schedule(); };
    box.addEventListener('change',apply); pick.addEventListener('input',() => { box.checked=true; apply(); });
    rows.append(row);
  }
  // Ground pattern: this world's own, or another world's, recoloured by
  // the Ground base colour above.
  const patterns=config.groundPatterns||{},patternRow=document.createElement('div'); patternRow.className='control';
  patternRow.innerHTML=`<label for="ground-pattern">Ground pattern</label><select id="ground-pattern" style="width:100%"><option value="">This world's own</option>${Object.entries(patterns).filter(([id]) => id!==config.biomeId).map(([id,p]) => `<option value="${id}">${p.name}</option>`).join('')}</select><p class="small">Another world's ground grain, moved to this world's Ground colour. Contrast is under Ground below.</p>`;
  rows.append(patternRow);
  $('ground-pattern').value=patterns[experiment.get('groundPattern')]?experiment.get('groundPattern'):'';
  $('ground-pattern').onchange=() => {
    // Keep this world's ground colour when only the grain changes.
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
  'Retail Green':{crackSeverity:.6,crackSpacing:40,crackLength:2,crackMajor:.8,crackMinor:.75,crackHairline:.6,crackBlocks:.6,crackWidth:1,crackJagged:.6,crackNetwork:.35,crackReach:.6,crackDark:.75,crackLit:.35},
  'Hairline':{crackSeverity:.35,crackSpacing:30,crackLength:2,crackMajor:.5,crackMinor:.5,crackHairline:1,crackBlocks:.2,crackWidth:.7,crackJagged:.6,crackNetwork:.2,crackReach:.6,crackDark:.7,crackLit:.25},
  'Plates (Gaea rock)':{crackSeverity:.7,crackSpacing:48,crackLength:1.25,crackMajor:.9,crackMinor:.9,crackHairline:.7,crackBlocks:1,crackWidth:1,crackJagged:.7,crackNetwork:1,crackReach:.9,crackDark:.8,crackLit:.45},
  'Deep fissures':{crackSeverity:.9,crackSpacing:56,crackLength:3,crackMajor:1,crackMinor:.4,crackHairline:.3,crackBlocks:.5,crackWidth:1.5,crackJagged:.6,crackNetwork:0,crackReach:.8,crackDark:.85,crackLit:.4},
};
function buildKnobs() {
  const root = $('knobs'), params = experiment;
  const group = (title, open = false) => { const d = document.createElement('details'); d.className = 'knobs-group'; d.open = open; const t = document.createElement('summary'); t.textContent = title; d.append(t); root.append(d); return d; };
  const render = group('Rendering');
  const toggle = (key, label, on, off, isOn) => {
    const row = document.createElement('label'); row.className = 'small'; row.style.display = 'flex'; row.style.gap = '6px';
    const box = document.createElement('input'); box.type = 'checkbox'; box.checked = isOn;
    box.addEventListener('change', () => setKnob(key, box.checked ? on : off));
    row.append(box, label); render.append(row);
  };
  toggle('detail', 'Fall-line surface (off: lab look)', 'fall', 'lab', params.get('detail') !== 'lab');
  toggle('palette', 'TA palette', 'nearest', 'off', params.get('palette') !== 'off');
  toggle('ground', 'Procedural ground tiles (off: lab texture)', 'tiles', 'texture', params.get('ground') !== 'texture');
  // Every knob needs a world default (sculpt.py KNOB_DEFAULTS).
  const missing = [...KNOBS.flatMap(([, list]) => list.map(k => k[0])), ...SHAPE_FIELDS.map(f => f[0])].filter(k => !(k in (config.defaults || {})));
  if (missing.length) console.warn('Knobs without a world default:', missing.join(', '));
  for (const [title, knobs] of KNOBS) {
    const box = group(title, title === 'Cracks');
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
    for (const [key, label, min, max, step, value] of knobs) {
      const wrap = document.createElement('div'); wrap.className = 'control';
      const id = 'knob-' + key, current = params.has(key) ? Number(params.get(key)) : value;
      wrap.innerHTML = `<label for="${id}">${label} <output>${current}</output></label><input id="${id}" type="range" min="${min}" max="${max}" step="${step}" value="${current}">`;
      const input = wrap.querySelector('input'), out = wrap.querySelector('output');
      input.addEventListener('input', () => { out.textContent = input.value; setKnob(key, input.value); });
      box.append(wrap);
    }
  }
}
function setKnob(key, value) {
  const url = new URL(location.href); url.searchParams.set(key, value); window.history.replaceState(null, '', url);
  experiment.set(key, value);
  if (config) { activeWorld().knobs[key] = String(value); saveWorlds(); if (key==='strata') buildWorldPanel(); }
  // Textures are chosen when the renderer starts, so this switch reloads.
  if (key === 'ground' || key === 'groundPattern') { location.reload(); return; }
  renderer.variant.set(key, value); renderer.applyKnobs(); markViewChanged(); schedule();
  if (key==='detail') $('fracture-control').hidden=!config.textures.fractures || value!=='lab';
  if (key==='undulation' || key==='undulationScale' || key==='undulationCover') {
    const i=nodes.findIndex(n => n.kind==='ground');
    if (i>=0) { nodes[i][{undulation:'amplitude',undulationScale:'wavelength',undulationCover:'coverage'}[key]]=Number(value); cancelWeather(); evaluate(i); checkpoint(); queueWeather(); }
    else if (key==='undulation' && Number(value)>0) { nodes.unshift({kind:'ground',amplitude:Number(value),wavelength:160,seed:seed^0x9e37}); prefix=[]; cancelWeather(); evaluate(0); checkpoint(); queueWeather(); }
    return;
  }
  // Transport knobs change where sand is carried, so the worker re-runs.
  if (['sand','sandReach','windStrength','wind','sandPatchy','sandTail'].includes(key)) { cancelWeather(); queueWeather(); }
}
async function boot() {
  try {
    const response=await fetch('/sculpt-config.json?'+new URLSearchParams([...(experiment.has('biome')?[['biome',experiment.get('biome')]]:[]),...(experiment.get('variant')?[['variant',experiment.get('variant')]]:[])])); if (!response.ok) throw new Error('Could not load the sculpt configuration.'); config=await response.json();
    configureMap(config,experiment);
    if ((!config.map && config.size!==1024) || !Number.isInteger(config.grid) || config.grid<2 || config.grid>(config.map?1168:1024) || !Number.isFinite(config.baseHeight) || !Number.isFinite(config.seaLevel)) throw new Error('Unsupported sculpt configuration.');
    if (config.biomeId && config.biomeId!=='green') LOCAL_KEY+='-'+config.biomeId;
    if (config.variant) LOCAL_KEY+='-v-'+config.variant;
    if (config.map) LOCAL_KEY+=`-map-${config.map.unitsX}x${config.map.unitsY}-sea-${config.seaLevel}`;
    document.querySelector('.topbar h2').textContent=(config.biome||'Green Planet')+' terrain';
    // The world: built-in (the biome itself) or a custom one based on it.
    // Its remembered settings come before the biome's own defaults.
    loadWorlds();
    worldId=experiment.has('world') && worlds[experiment.get('world')]?.base===config.biomeId?experiment.get('world'):config.biomeId;
    if (worldId!==config.biomeId) LOCAL_KEY+='-'+worldId;
    config.defaults={...config.defaults,...(worlds[worldId]?.knobs||{})};
    if (worldId!==config.biomeId) document.querySelector('.topbar h2').textContent=worlds[worldId].name+' terrain';
    for (const [key,value] of Object.entries(config.defaults || {})) if (!experiment.has(key)) experiment.set(key,value);
    $('example').value=['joins','coasts','hills','intersections','islands','mesas','columns'].includes(experiment.get('example'))?experiment.get('example'):'mixed';
    buildShapeOptions();
    for (const kind of Object.keys(HELP)) toolSettings[kind]=toolDefaults(kind);
    showTool(toolSettings[tool]);
    $('relief').value=Math.round((config.material?.surfaceRelief??1)*100);
    $('material-weathering').value=Math.round((config.material?.materialWeathering??0)*100);
    $('deposit-spread').value=Math.round((config.material?.depositSpread??.65)*100);
    $('transition-detail').value=Math.round((config.material?.transitionDetail??.65)*100);
    $('transition-detail-control').hidden=!config.textures.transitionBody;
    $('ring-controls').hidden=!config.textures.mineralRing && !config.textures.mineralRings;
    $('fringe-style').querySelector('[value="veins"]').disabled=!config.textures.mineralRing;
    $('fringe-style').querySelector('[value="rings"]').disabled=!config.textures.mineralRings;
    // The world's own choice (fringeStyle, a string knob): Archipelago's retail rings are
    // curved contours, not veins.
    $('fringe-style').value=config.textures.mineralRings&&(!config.textures.mineralRing||experiment.get('fringeStyle')==='rings')?'rings':'veins';
    $('mineral-ring').value=Math.round((config.material?.ringAmount??0)*100);
    $('ring-spread').value=Math.round((config.material?.ringSpread??.65)*100);
    $('ring-variation').value=Math.round((config.material?.ringVariation??.7)*100);
    // The address may set the three ring sliders (a world's own fringe settings, 0..1).
    for (const [key,id] of [['ringAmount','mineral-ring'],['ringSpread','ring-spread'],['ringVariation','ring-variation']]) if (experiment.has(key)) $(id).value=Math.round(Number(experiment.get(key))*100);
    size=config.size; grid=config.grid; spacing=(size-1)/(grid-1); heights=new Float32Array(grid*grid); protection=new Float32Array(grid*grid); routes=new Float32Array(grid*grid); cracks=new Float32Array(grid*grid); cover=new Float32Array(grid*grid); crystal=new Float32Array(grid*grid); maskPlanes=MASK_KEYS.map(() => new Int8Array(grid*grid)); heights.fill(config.baseHeight);
    canvas.width=canvas.height=overlay.width=overlay.height=size; seed=Number($('seed').value); refinementSeed=seed; noise=makeNoise(seed);
    renderer=await TerrainRenderer.create(canvas,config);
    renderer.onerror=message => error(message);
    renderer.setColors(worldColors());
    buildKnobs(); buildWorldPanel();
    // The fracture texture only applies to the lab surface; the fall-line
    // surface draws its cracks in the bake (Cracks knobs).
    $('fracture-control').hidden=!config.textures.fractures || experiment.get('detail')!=='lab';
    $('fractures').value=clamp(Number(experiment.get('fractures'))||0,0,100);
    $('scree').value=clamp(Number(experiment.get('scree'))||0,0,100);
    let saved=null; try { if (!experiment.has('scratch')) saved=localStorage.getItem(LOCAL_KEY); } catch (_) {}
    if (saved) { try { loadSketch(JSON.parse(saved)); status('Restored your saved terrain.'); } catch (err) { mixedScene(); error('Saved sculpt sketch could not be loaded: '+err.message+' The saved copy is retained until you edit.'); status('Mixed example shown.'); } }
    else if (config.map) { scriptedScene([]); status('Blank map ready · draw terrain with the existing tools.'); }
    else { mixedScene(); status('Mixed scene ready · paint any continuous shape.'); }
    ready=true; $('editor').disabled=false; $('world-editor').disabled=false; history=[{nodes:cloneNodes(),refinementSeed}]; historyIndex=0; renderLayers();
    // A sketch loaded in another world was handed to this page before the
    // reload; play it now that this world's renderer and fields exist.
    const pending=await takePendingSketch(experiment.get('pendingSketch'));
    if (pending) {
      try {
        if (pending.biome!==config.biomeId) throw new Error(`it belongs to the ${pending.biome} world but ${config.biomeId} opened`);
        loadSketch(pending); checkpoint(); status('Loaded the saved terrain.');
      } catch (err) { error('The handed-over terrain could not be loaded: '+err.message); }
    }
    $('levels').textContent=`Dry base ${config.baseHeight} · sea ${config.seaLevel} · heights ${MIN_HEIGHT}…${MAX_HEIGHT}`;
    mountMapExport({config,canvas,ready:canExport,revision:() => revision+':'+weatherJob,samples:() => { const display=previewHeight(); return (x,y) => sample(display,x,y); },render:renderExportView,restore:() => { heightDirty=true; schedule(); },onUpdate:fn => { mapUpdate=fn; },busy:on => { loading=on; $('editor').disabled=on; $('world-editor').disabled=on; overlay.style.pointerEvents=on?'none':''; }});
    updateControls(); resize(); schedule(); queueWeather();
  } catch (err) { error(err.message); status('The experimental renderer could not start.'); }
}
// Read-only hook for capture tools: the displayed (refined) heights.
// bakeMs and drawMs resolve to milliseconds from submit to GPU completion;
// bakeGpuMs and drawMs's gpuMs are the pass's own GPU time (timestamp queries).
function replayDetail() {
  flushEval();
  const keys=['h',...MASK_KEYS],now=live(),before=keys.map(k => now[k].slice()),worst={};
  prefix=[]; evaluate(0);
  keys.forEach((k,j) => { let w=0; for (let i=0;i<before[j].length;i++) w=Math.max(w,Math.abs(before[j][i]-now[k][i])); worst[k]=w; });
  return worst;
}
window.sculptDebug = {state: () => ({tool, stroke: Boolean(stroke), moving: Boolean(moving), selected, pointerId, pan: Boolean(pan)}), bakeMs: (quality='full') => renderer.timeBake(quality), get bakeGpuMs() { return renderer.lastBakeGPU; },
  drawMs: (quality='full') => renderer.timeDraw({quality,clay:$('clay').checked,light:$('light').value,fractures:Number($('fractures').value)/100,scree:Number($('scree').value)/100,detail:Number($('relief').value)/100,ring:Number($('mineral-ring').value)/100,ringSpread:Number($('ring-spread').value)/100,ringVariation:Number($('ring-variation').value)/100,fringeStyle:$('fringe-style').value,materialWeathering:Number($('material-weathering').value)/100,transitionDetail:Number($('transition-detail').value)/100}),
  scene: scriptedScene, heights: () => Array.from(previewHeight()), authored: () => Array.from(heights), // replayAll: the worst difference in heights or any painted mask between the fields as edited and a full replay of every node.
  replayAll: () => Math.max(...Object.values(replayDetail())),
  // replayDetail: the same, per field key (h, then the mask planes).
  replayDetail,
  // masks: per plane [sum, non-zero cells], to compare channels across a save and load; sketch and loadSketch round-trip a recipe.
  masks: () => maskPlanes.map(a => { let sum=0,count=0; for (let i=0;i<a.length;i++) if (a[i]) { sum+=a[i]; count++; } return [sum,count]; }), sketch: () => JSON.parse(JSON.stringify(sketch())), loadSketch: s => { loadSketch(s); }, nodes: () => JSON.parse(JSON.stringify(serializeNodes())), get biome() { return config.biomeId; }, get grid() { return grid; }, get size() { return size; }, get base() { return config.baseHeight; }, get sea() { return config.seaLevel; }};
boot();
