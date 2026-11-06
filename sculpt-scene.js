// The scene builder: the brush cards a stroke starts from in each world and the node list a scripted scene makes from its strokes
// (repro/scenes/*.json, capture tools). No DOM: the page (sculpt.js scriptedScene, the brush panel) and the headless runner
// (repro/render-node.mjs) import the same tables and build the same nodes. A function that reads a world's values takes its config
// (sculpt.py world_configs) and, where the page's address may override them, the page's settings (pageSettings).
import {FACING_CHOICES,FORMS} from './sculpt-shape-presets.js';
import {applyRiver,isRiver} from './sculpt-river.js';
import {createShapeEngine,readBuffer,comparePlanes} from './sculpt-gpu-fields.js';
import {computeDrainage,latticeWidth,DRAIN_STEP} from './sculpt-drainage.js';
import {erosionOf} from './sculpt-erosion.js';
const clamp=(v,a,b) => Math.max(a,Math.min(b,v));
// Biomes choose starting values for the same brushes. These presets can be
// borrowed independently of the canvas materials and then edited per tool.
// Approved starting shapes use ordinary controls and editable knots. Preset elevation is a rise above the map plain; toolDefaults resolves the absolute height.
export const LANDFORM_DEFAULTS={"diameter":300,"amount":70,"roughness":0,"softness":50,"cracks":40,"faceVariation":0,"lean":100,"facing":3,"terraces":0,"elevation":70,"combine":0,"wander":90,"widthVary":35,"heightVary":3,"varySize":140,"varyFoot":115,"varyMiddle":145,"routeSmooth":0,"crestTaper":0,"fingers":0,"shoreLayers":0,"shorePlates":0,"curve":{"form":"lfPlateau","knots":[[0,0],[0.08,0.006],[0.19,0.035],[0.27,0.15],[0.37,0.65],[0.45,0.96],[0.5,1],[1,1]],"back":[[0.0,0],[0.096,0.006],[0.22799999999999998,0.035],[0.324,0.15],[0.444,0.65],[0.54,0.96],[0.6,1],[1,1]]}};
// The palette's landform presets over LANDFORM_DEFAULTS (Plateau is the defaults themselves): numbers for Landform's own controls, each the fit of the
// retired tool's default stroke that re-authored the fixtures. Elevation is a rise above the map plain, or with Height reference: Sea level, above the sea.
const smoothKnots=n=>Array.from({length:n+1},(_,i)=>{const t=i/n;return [Math.round(1000*t)/1000,Math.round(1000*t*t*(3-2*t))/1000];});
// The valleys cut to a floor below the plain (Cut to) along one curve: V and U differ only in the curve, the terraced one is the V with the Steps control.
const valley=(form,more={}) => ({diameter:240,lean:100,combine:1,elevation:-20,cracks:0,wander:20,widthVary:20,heightVary:0,varySize:120,varyFoot:100,varyMiddle:100,curve:{form,knots:FORMS[form]().knots},...more});
const hillKnots=() => [[0,0],[.25,.08],[.5,.4],[.75,.8],[.9,.95],[1,1]];
export const LANDFORM_TOOLS={
  plateau:{},
  // A hill is low and wide (240 px, rises 36), the same on both sides (lean 100), with a rounded top and shoulders (the section reaches .95 of the rise at .9 of the way up, and climbs at most .4 of it per quarter) and a smooth outline: its steepest 16 px cell steps 16 units or less against 25 at the 99th percentile of retail Green hills (measure/hill_band.py), so units cross it, and it stays off the rock slope score. Gullies 0 keeps modern Green's gully ribs off it (the other worlds have none).
  hill:{diameter:240,elevation:36,lean:100,cracks:20,gullies:0,wander:10,widthVary:10,heightVary:6,varySize:100,varyFoot:100,varyMiddle:100,curve:{form:'lfHill',knots:hillKnots(),back:hillKnots()}},
  // Peaked ridge: high (150 over the plain), a steep rock face all round (cells over 24 units on 16 px, steeper than retail Green's hills), a chain of five
  // summits with shallow saddles along the path, and divides with scree below them (Gullies, Talus). A hill is its opposite: low, round, walkable.
  mountain:{diameter:200,elevation:160,lean:100,cracks:60,wander:8,widthVary:0,heightVary:10,varySize:80,varyFoot:100,varyMiddle:100,gullies:40,gullySize:50,talus:60,styleVegetation:-70,
    along:[[0,.6],[.1,1],[.22,.74],[.36,1],[.5,.76],[.64,.95],[.76,.72],[.88,.9],[1,.6]],
    curve:{form:'lfMountain',knots:[[0,0],[.12,.01],[.25,.05],[.4,.2],[.55,.45],[.7,.68],[.85,.88],[1,1]]}},
  ramp:{diameter:200,lean:100,combine:2,routeSmooth:100,cracks:0,wander:0,widthVary:0,heightVary:0,varySize:160,varyFoot:100,varyMiddle:100,along:[[0,0],[1,1]],curve:{form:'lfRamp',knots:FORMS.lfRamp().knots}},
  deep:{diameter:200,lean:100,heightReference:1,elevation:-55,combine:1,cracks:0,wander:30,widthVary:30,heightVary:0,varySize:210,varyFoot:100,varyMiddle:100,curve:{form:'lfShore',knots:FORMS.lfShore().knots}},
  shallow:{diameter:200,lean:100,heightReference:1,elevation:-7,combine:2,cracks:0,wander:4,widthVary:0,heightVary:0,varySize:210,varyFoot:100,varyMiddle:100,curve:{form:'lfShore',knots:FORMS.lfShore().knots}},
  valleyV:valley('lfValleyV'),
  valleyU:valley('lfValleyU'),
  valleyT:valley('lfValleyV',{terraces:4,ledge:55,terraceJitter:30}),
  // A river: Width is the channel (the section reaches 6 channel half widths each side), Wander the migration steps in 4s; the floodplain sits 3 above the sea.
  river:{diameter:48,lean:100,combine:1,heightReference:1,elevation:3,cracks:0,wander:76,widthVary:0,heightVary:0,varySize:120,varyFoot:100,varyMiddle:100,surf:0,curve:{form:'lfRiver',knots:FORMS.lfRiver().knots}},
  // A braided river: the same preset with a belt of threads (its form) and no migration unless Wander is raised.
  // lfcrater: the Crater button. A bowl dug 20 below the ground it lands on with a rim .42 of that above it (the lfCrater section), 360 px foot to foot (a 200 px
  // rim), three secondaries, so a drag aims the impact (sculpt-shape-presets.js impactPath): Roughness 35 as Wander and Height variation.
  crater:{diameter:360,lean:100,heightReference:2,elevation:-20,combine:2,cracks:30,wander:20,widthVary:10,heightVary:2,varySize:95,varyFoot:100,varyMiddle:100,ejecta:0,secondaries:3,curve:{form:'lfCrater',knots:FORMS.lfCrater().knots}},
  braided:{diameter:40,lean:100,combine:1,heightReference:1,elevation:3,cracks:0,wander:0,widthVary:0,heightVary:0,varySize:120,varyFoot:100,varyMiddle:100,surf:0,curve:{form:'lfBraided',knots:FORMS.lfBraided().knots}},
  // lfcrystal: Crystals (the palette's Faceted forms) is a landform broken into prisms by its Facet shape: a click is a cluster round the point, a drag
  // rows along the path. The section is the old cluster's falloff (each prism stood 1 - .45 x its distance share lower toward the rim), the rise its Height.
  crystal:{diameter:200,elevation:40,lean:100,combine:0,cracks:0,wander:0,widthVary:0,heightVary:0,varySize:200,varyFoot:100,varyMiddle:100,iceFacets:60,facetForm:2,iceFacetSize:36,
    crystalSides:5,crystalTop:80,crystalVariation:50,crystalAlign:0,crystalTiers:100,bergJitter:20,bergBreak:0,bergRough:0,curve:{form:'lfHill',knots:[[0,0],[.03,.55],[1,1]],back:[[0,0],[.03,.55],[1,1]]}}
};
// lfcrater: a crater with no rim in its heights (retail Red and Crystal: rim/depth -.12..0), a .06 lip for the art and a wide bowl.
export const CRATER_BOWL=[[0,0],[.25,-.02],[.4,-.06],[.5,.04],[.6,.3],[.72,.58],[.83,.82],[.93,.97],[1,1]];
// A palette entry's stroke kind: the shape buttons all draw landforms.
export const strokeKind=t => Object.hasOwn(LANDFORM_TOOLS,t)?'landform':t;
export const TOOL_PRESETS={
  green:{crater:{wander:34,heightVary:4}},
  red:{crater:{wander:37,heightVary:4,curve:{form:'lfCrater',knots:CRATER_BOWL}},hill:{wander:34,widthVary:30,heightVary:10},mountain:{wander:8},deep:{diameter:176,wander:34,widthVary:35},shallow:{wander:4}},
  // The reviewed mesa; ragged feet and foot bumps on the ridges (the retired baseVary and baseBump, as wander and height variation).
  desert:{plateau:{"diameter":400,"amount":70,"roughness":0,"softness":50,"cracks":10,"faceVariation":0,"lean":100,"facing":3,"terraces":6,"elevation":90,"combine":0,"wander":75,"widthVary":30,"heightVary":1,"varySize":210,"varyFoot":100,"varyMiddle":150,"ledge":55,"terraceJitter":40,"breakup":30,"curve":{"form":"mesa","knots":[[0,0],[0.13299999999999998,0.088],[0.2667,0.25],[0.364,0.367],[0.48299999999999993,0.625],[0.5914999999999999,0.883],[0.7,1],[1,1]]}},crater:{roughness:55,softness:55,cracks:10},hill:{wander:46,widthVary:25,heightVary:10,cracks:10},mountain:{wander:24,cracks:10},deep:{wander:34,widthVary:35}},
  // Lobed hill outlines (the retired moonLobes): wander in lobes about 60 px long, from foot to crest.
  moon:{crater:{wander:37,heightVary:4,secondaries:6,ejecta:70},hill:{wander:42,widthVary:30,heightVary:9,varySize:60,varyMiddle:150},mountain:{wander:24,widthVary:5},deep:{wander:34,widthVary:35}},
  // lfcrystal: Crystal's Crystals draw a column mound (its old brush: Height 140, 480 wide, Irregularity 40): stepped columns over the mound's (1 - r^2)^1.2
  // dome, the edge noise as wander. Ice's draw one flat-topped ice block a click (Height 155; four sides, top .45 of the base, 220 px), a row of them a drag.
  crystal:{crater:{curve:{form:'lfCrater',knots:CRATER_BOWL},iceFacets:100,iceFacetSize:16},crystal:{diameter:480,elevation:140,wander:67,varySize:168,facetForm:1,iceFacets:65,iceFacetSize:32,crystalStep:14,crystalTiers:100,crystalFacet:70,crystalSizeVar:70,
    curve:{form:'lfHill',knots:[[0.0,0.0],[0.1,0.136],[0.2,0.293],[0.3,0.446],[0.4,0.585],[0.5,0.708],[0.6,0.811],[0.7,0.893],[0.8,0.952],[0.9,0.988],[1.0,1.0]],back:[[0.0,0.0],[0.1,0.136],[0.2,0.293],[0.3,0.446],[0.4,0.585],[0.5,0.708],[0.6,0.811],[0.7,0.893],[0.8,0.952],[0.9,0.988],[1.0,1.0]]}},mountain:{wander:6},deep:{wander:24,widthVary:25},shallow:{wander:6}},
  ice:{crystal:{diameter:220,elevation:155,iceFacets:100,iceFacetSize:220,crystalSides:4,crystalTop:45,crystalVariation:0,crystalTiers:100,bergJitter:12,
    curve:{form:'lfPlateau',knots:[[0,0],[.04,1],[1,1]],back:[[0,0],[.04,1],[1,1]]}},mountain:{wander:6},deep:{wander:24,widthVary:25,shorePlates:1},shallow:{wander:6,shorePlates:1}},
  // Lava banks rise ~22-24 units over 40-60 px, steep at the lava then
  // flattening (retail coasts, measure/lava_*): wide, concave dry banks, as shoreline steps and lobes.
  lava:{mountain:{wander:6},deep:{diameter:264,wander:40,fingers:100,stepReference:1,terraces:11,ledge:80,terraceJitter:70},shallow:{diameter:264,wander:6,fingers:100,stepReference:1,terraces:11,ledge:80,terraceJitter:70}},
  zhon:{crater:{wander:31,heightVary:3},hill:{wander:20,widthVary:15,heightVary:7},deep:{diameter:240,wander:48,widthVary:40},shallow:{diameter:240,wander:6}},
  archipelago:{crater:{wander:34,heightVary:4},deep:{diameter:256,wander:52,widthVary:40},shallow:{diameter:248,wander:6}}
};
// Shape options: per-shape settings, shown for the tools they apply to and
// kept in each shape, so a selected shape can be changed like a new stroke.
// Each starts at the world's value (sculpt.py KNOB_DEFAULTS / WORLD_KNOBS).
// Cross-section (card C1): the kinds that take the parametric profile, and the
// options that describe it. Wired like every shape option: SHAPE_FIELDS, the
// card scriptedScene builds, strokeParams and KNOB_DEFAULTS (sculpt.py).
// A crater's spurs keep the outline of the retired ridges: Moon's lobes, Desert's ragged foot and foot bumps. World values, no control: they ride with the stroke for the spur stamp.
export const SPUR_OUTLINE_KEYS=['moonLobes','baseVary','baseBump'];
// Line features (card C4): spurs, crest variation and crater rim sectors. All
// default off; spurs branch off a landform's crest or a crater's rim (the crest options shape a crater's spurs),
// rim options reshape a crater's rim.
export const RIDGE_KEYS=['spurCount','spurLength','spurSpread','spurWidth','spurTaper','spurHeight','spurForks','spurBulb','crestJag','crestVary','crestTaper','rimHeight','rimSectors','rimUnequal','rimGaps','rimGapWidth'];
// Placed fissures (card C4 stage 2): the Fissure tool and its options. Depth is
// the stroke's own amount; the rest are shape options kept in the shape.
export const FISSURE_KEYS=['fissureWidth','fissureJag','fissureBranches','fissureBranchLen','fissureBranchSpread','fissureTaper','fissureNetwork','fissureCell','fissureCrack','fissureDark'];
export const SECTION_KEYS=['terraces','ledge','terraceJitter','breakup'];
// Landform (card H27): the elevation and how it combines, and the variation along and across the path. The along curve (a knot list) rides with the section curve.
// lfcrater: the impact features any landform can throw (sculpt-shape-presets.js impactOn): ejecta round it and secondaries (small copies of it) beyond them.
// A stroke with either reads its path as the impact's track (direction and angle from the drag). Wired like every shape option (BACKLOG ground rule 4).
export const CRATER_KEYS=['ejecta','secondaries'];
export const LANDFORM_KEYS=['stepReference','heightReference','elevation','combine','routeSmooth','wander','widthVary','heightVary','gullies','gullySize','talus','surf','varySize','varyFoot','varyMiddle'];
// Painted masks (card C5): nine signed-byte planes per cell, where 0 changes
// nothing: rock, snow or ice, wet ground and moss (0..127 of full), scatter
// density, and four local style settings (stage 2: relief strength, cracks,
// banding and face rock share, each -127..127 about the world's own value).
// 'paint' is the brush; a landform or crater writes only its Local vegetation
// (plane 16) into its own footprint.
// Card E1 adds five more: the water choices of a deep or shallow stroke (plane 9,
// the shore edge, is no longer written; shallow-to-deep edge, bed; +127 hard /
// lit bed, -127 faded / noise water), painted ground lumps (+127 more, -127
// fewer) and the cracked-bed flag.
// Planes 0-18 are in use (14-17 are the override planes, 18 a water stroke's Surf, 0..127 of 1); 19-24 are unused placeholders (the flow bake's planes 20-24 went with it). The shape engine's buffers hold seven
// words a cell (28 planes), so the layout stays as they and the shaders read it.
export const MASK_KEYS=['mr','ms','mw','mm','md','ml','mc','mb','mf','mx','my','mz','mg','mk','ovErosion','ovDeposits','ovVegetation','ovExposure','surf','free19','fu','fv','s1','s2','s3'];
export const MASK_SHAPES=['crater','landform'];
export const MASK_CHOICES=[[1,'Rock'],[2,'Snow or ice'],[3,'Wet or dark ground'],[4,'Moss'],[5,'Denser scatter'],[6,'Sparser scatter']];
export const LUMP_CHOICES=[[16,'Ground lumps'],[17,'Smoother ground']];
// H3 override planes 14-17 (a signed value v multiplies the control it names by 1 + v; 0 changes nothing): erosion rate (H2's pass),
// loose deposits (sand and scree), vegetation (grass and moss cover), rock exposure. Paint choices 18-25 write them.
export const OVERRIDE_CHOICES=[[18,'Relaxation: more'],[19,'Relaxation: less'],[20,'Deposits: more'],[21,'Deposits: less'],[22,'Vegetation: more'],[23,'Vegetation: less'],[24,'Rock exposure: more'],[25,'Rock exposure: less']];
export const STYLE_CHOICES=[...OVERRIDE_CHOICES,[8,'Relief stronger'],[9,'Relief weaker'],[10,'Cracks more'],[11,'Cracks fewer'],[12,'Banding more'],[13,'Banding less'],[14,'Face: more rock'],[15,'Face: less rock']];
export const COAST_KEYS=['shoreLayers','layerPx','layerRiser','layerLedge','layerRough','layerStyle',
  // E10: finger size; layer width variation; the circles of scalloped layers.
  'fingerSize','layerVary','layerCircle',
  // G5 (Lava): the layers' two-dimensional wander and extra width spread; the circles' variety; the lobes' tread tilt (the hill-lobe option rides this list, as E10's).
  'lavaSpread','lavaCircleVary'];
// [key, element id, label, kinds, slider min, max, step, slider units per value, help, drop-down choices]
export const SHAPE_FIELDS=[
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
  ['heightReference','lf-height-reference','Height reference',['landform'],0,2,1,1,'Fixed elevation uses map height units. Sea level measures above or below the current sea; negative heights are below water. Ground measures from the ground under each place the shape covers, so the shape follows the ground it lands on, slopes included: negative heights dig into it (a crater\'s bowl), and a section that dips below 0 rises above it (the crater\'s rim).',[[0,'Fixed elevation'],[1,'Sea level'],[2,'Ground']]],
  ['elevation','lf-elevation','Elevation (height units)',['landform'],-335,300,1,1,'The height of the crest, in height units. The section canvas marks the plain (the map\'s base height) and the sea. Combine decides what the landform does to the ground it meets.'],
  ['combine','lf-combine','Combine',['landform'],0,2,1,1,'Raise to keeps the higher of the ground and the landform. Cut to keeps the lower. Flatten to sets the ground to the landform wherever it reaches, up or down.',[[0,'Raise to'],[1,'Cut to'],[2,'Flatten to']]],
  ['routeSmooth','lf-route-smooth','Smooth route',['landform'],0,100,5,100,'Keep the center of this landform clear of surface relief, cracks and debris, and protect its grade from weathering. The shoulders fade into the surrounding terrain.'],
  ['wander','lf-wander','Wander (px)',['landform'],0,120,2,1,'How far the outline moves in and out around the sides and ends, in waves as long as the Variation size. The drawn crest stays in place.'],
  ['widthVary','lf-width-vary','Width variation',['landform'],0,100,5,100,'How much the section widens and narrows along the path (100: from half to twice its width).'],
  ['heightVary','lf-height-vary','Height variation (units)',['landform'],0,40,1,1,'How far the surface rises and falls, in height units, in waves as long as the Variation size. It is zero at the feet.'],
  // P1: branching gullies on the raised faces, steered down the stroke's own fall line (engine-shape.wgsl landformGullies).
  ['gullies','lf-gullies','Gullies',['landform'],0,100,5,100,'Cut the raised faces into a divide, spurs off it and V-gullies that branch as they run down the fall line, deepest on steep faces and fading at the foot. 0: smooth faces.'],
  ['talus','lf-talus','Talus reach (px)',['landform'],0,200,5,1,'How far loose material runs out from the foot of a raised face: a concave apron that rests at the world\'s talus angle against the face and comes down level at its toe this far out, fanning from the widest gullies into one skirt. A longer reach makes a longer, gentler apron, not a taller one. 0: no talus. It needs Gullies, for the chutes, and shows only on faces steeper than the talus angle.'],
  ['gullySize','lf-gully-size','Gully size',['landform'],10,100,5,100,'How far apart the widest gullies run, as a share of the face from crest to foot; each finer set is half as far apart. Low: close rills; high: a few broad valleys between big spurs.'],
  // P27: the shore's wet sand, foam and beach by the coast distance (engine-frag.wgsl surfShore); written into mask plane 18 where the stroke makes water.
  ['surf','water-surf','Surf',['landform'],0,100,5,100,'How much the shore is worked by waves, where this stroke makes water. 0: the shore is drawn as before. A little: a thin, broken wet strip and a few flecks of foam at the waterline. More: wider wet sand, wrack lines, a beach of sand whose inland edge breaks into the grass, cusps (the land is shaped to a gentle face, a berm and a slight back-slope, up to a few units tall) and a broken breaker line over the shallows. A rocky shore is painted with the Paint tool\'s rock.'],
  // lfcrater: impact features (CRATER_KEYS).
  ['ejecta','lf-ejecta','Ejecta',['landform'],0,150,5,100,'Material thrown out round the shape: a blanket that thins away from its rim (or, on a shape that peaks on its path, its foot), broken into radial streaks and ragged lobes. Drag to aim it: a click throws it all round; a short drag gathers it downrange and, longer, leaves a gap uprange; a drag longer than the diameter stretches the shape along the drag and throws to both sides.'],
  ['secondaries','lf-secondaries','Secondaries',['landform'],0,12,1,1,'Small copies of the shape thrown beyond the ejecta, some in short chains along a ray; they gather downrange, or to the sides, as the ejecta do.'],
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
  ['crystalTiers','crystal-tiers','Stepped column tops',['crystal','landform'],0,100,5,100,'Facets: how level each column or prism top stands. 100: level at the height of the shape at the element\'s center, so its height steps distinctly from its neighbors. 0: the top follows the slope of the shape under it (a lean or a sloping section tilts it).'],
  ['crystalSides','crystal-sides','Sides',['crystal','landform'],3,10,1,1,'Prisms: the sides of each prism\'s outline (Variation mixes a few more and fewer). Columns are Voronoi cells, mostly 5 or 6 sides.'],
  ['crystalSize','crystal-size','Crystal width (px)',['crystal'],6,640,2,1,'Crystals: typical base width. Column mound: column top width (retail ~15).'],
  ['crystalStep','crystal-step','Column step',['crystal','landform'],0,64,1,1,'Stepped columns: how far a column top steps up or down from the shape\'s height at its center, in height units (retail Crystal ~16; about 40% stay flush).'],
  ['crystalCount','crystal-count','Crystals per cluster',['crystal'],1,40,1,1,'How many crystals a click grows; a longer stroke grows more.'],
  ['crystalTop','crystal-top','Flat tops',['crystal','landform'],0,95,5,100,'Prisms: the share of each prism that is its flat top. 0: pointed; higher cuts the tops level, with shorter, steeper faces (an ice block).'],
  ['crystalLean','crystal-lean','Lean',['crystal'],0,100,5,100,'How far each apex leans off its base center.'],
  ['crystalVariation','crystal-variation','Variation',['crystal','landform'],0,100,5,100,'Prisms: the spread of their sizes, heights and side counts, and how far each strays from its place in the rows. 0: even rows of equal prisms.'],
  // Water looks (card E1): each stroke may keep the world's choice (0) or set its own.
  ['waterDeep','water-deep','Shallow-to-deep edge',['landform'],0,2,1,1,'World default keeps the World panel\'s Shallow-to-deep step. Hard: the shallow color stops at one depth with ragged stairs (retail Green). Faded: the color follows the depth ramp gradually (retail Archipelago).',[[0,'World default'],[1,'Hard'],[2,'Faded']]],
  ['waterBed','water-bed','Shallow water look',['landform'],0,3,1,1,'World default keeps the World panel\'s Lit bed. Lit bed: the ground under the water, lit by the same sun and tinted (retail). Noise water: the earlier flat noise texture. Cracked bed: lit bed over cracked rock-like ground, tinted (Red\'s shelf shallows).',[[0,'World default'],[1,'Lit bed'],[2,'Noise water'],[3,'Cracked bed']]],
  ['crystalAlign','crystal-align','Align faces to the frame (berg)',['crystal','landform'],0,100,5,100,'Prisms: 0 turns each prism at random, 100 sets its faces square to the path (four sides then make boxes in a row along it).'],
  ['bergFace','berg-face','Face steepness (berg, units per px)',['crystal'],20,200,5,100,'Berg: how fast the faces rise, in height units per px (shown in percent: 90% is 0.9 units per px). Each face varies by Outline jitter.'],
  ['bergJitter','berg-jitter','Outline jitter (berg)',['crystal','landform'],0,100,5,100,'Prisms: how far each face\'s angle and distance stray from a regular polygon.'],
  ['bergBreak','berg-break','Broken corners (berg)',['crystal','landform'],0,8,1,1,'Prisms: extra planes that cut corners off each prism.'],
  ['bergRough','berg-rough','Face roughness (berg, units)',['crystal','landform'],0,30,1,1,'Prisms: fractal roughness added to the height, from 40 px lumps to 4 px grain, so the faces read as rough ice and take the world\'s own slope relief and light. 0 keeps clean crystal faces in the world\'s crystal color.'],
  ['bergTilt','berg-tilt','Top tilt (berg, 1% = 1 unit per 100 px)',['crystal'],0,60,1,100,'Berg: the slope of the ramp that brings the top down away from the Tilt direction (the top is level toward it, at Height).'],
  ['bergFlat','berg-flat','Level top toward the tilt (berg, share of radius)',['crystal'],-80,80,5,100,'Berg: how far from the center, toward the tilt direction, the top stays level before it ramps down (negative: the ramp starts on the far side of the center).'],
  ['bergTiltDir','berg-tilt-dir','Tilt direction (berg, degrees, 90 = south)',['crystal'],0,359,1,1,'Berg: the direction the top rises toward, turning with the shape\'s frame.'],
  ['paintChannel','paint-channel','Paint',['paint'],1,25,1,1,'What the brush paints. Denser scatter supplies its own stones where the World panel\'s Boulders and Debris are 0 and multiplies them where they are not. Style settings go more or less than the world\'s own value; Strength is how far. Erase clears every mask and style under the brush.',[...MASK_CHOICES,...LUMP_CHOICES,...STYLE_CHOICES,[7,'Erase all masks and style']]],
  // Local vegetation inside the shape (card C5 stage 2): a change about the world's own cover, 0 none.
  ['styleVegetation','style-vegetation','Override: vegetation',MASK_SHAPES,-100,100,5,100,'Grass and moss cover inside the shape, times 1 + this: below 0 more bare rock, above 0 more cover.'],
  // E7
  ['crystalFacet','crystal-facet','Facet tilt (column mound)',['crystal','landform'],0,100,5,100,'Stepped columns: tilts each column\'s top into one or two planes that meet at a crease, so the tops read as crumpled multi-facet crystal, not flat plates. 0 keeps flat tops.'],
  ['crystalSizeVar','crystal-size-var','Size variation (column mound)',['crystal','landform'],0,100,5,100,'Stepped columns: mixes three column widths (Facet width, about half and about a third of it), the small ones where the shape stands highest and in patches. 0 keeps one width.'],
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
  ['iceFacets','ice-facets','Angular facets',['landform'],0,100,5,100,'Breaks the raised shape into facets of the Facet shape, each standing as high as the shape at its center, so the section and along curves shape the cluster or ridge they make. This sets how much of it: angular facets and columns cover this share of the surface (the rest stays smooth), prisms stand on this share of their places. 0 keeps the smooth surface. A landform with shore features keeps those instead.'],
  // lfcrystal: what the facets are (the Crystals tool's three forms, as one landform feature that any raised landform can take).
  ['facetForm','lf-facet-form','Facet shape',['landform'],0,2,1,1,'Angular facets: tilted planes fitted to the shape\'s own surface, a little steeper, stepped a few units off their neighbors (the shape\'s own material). Stepped columns: the surface tiled with flat polygonal columns of crystal, stepped up and down, with dark seams (retail Crystal\'s mounds). Prisms: separate polygonal prisms standing on the ground in rows along the path, or round a click: crystal shards, or with Face roughness rough blocks of ice.',[[0,'Angular facets'],[1,'Stepped columns'],[2,'Prisms']]],
  ['iceFacetSize','ice-facet-size','Facet size (px)',['landform'],8,640,2,1,'Facets: the typical width of one facet, column or prism, and the spacing of their rows. A prism as wide as the shape stands alone.'],
  // G5 (Lava): contour layers wander in two dimensions and vary in width, as retail lava-1's bank.
  ['lavaCircleVary','lava-circle-vary','Circle variety (circular layers)',['landform'],0,100,5,100,'Circular layers: how much the bites differ from one another, in radius (a few large among many small), in the spacing of their rings, and in how many sites keep one, so they gather in clusters with bare stretches, as retail lava-2\'s do. 0: the even circles.'],
  ['lavaSpread','lava-spread','Layer width spread',['landform'],0,200,5,100,'Contour layers: extra spread in layer width along the shore, on top of Layer width variation (100 is about 2.7 times between the narrowest and the widest). 0: none.'],
];
export const E7_KEYS=['crystalFacet','crystalSizeVar','crystalSmooth','craterFacets'];
export const G7_KEYS=['crystalCraterPx','crystalCraterStep','crystalCraterSkin','crystalShoreSeam','plateVary'];
// G6 (Ice): the mountain facets' options, wired beside E7's (the card the stroke builds and strokeParams).
export const G6_KEYS=['iceFacets','iceFacetSize'];
// lfcrystal: the faceted structure's own option (the rest reuse the Crystals tool's keys, wired above).
export const CRYSTAL_KEYS=['facetForm'];
export const worldDefault=(config,key) => { const v=Number(config?.defaults?.[key]); return Number.isFinite(v)?v:0; };
// Values a replayed shape uses for options it was drawn without.
// Owner ruling (H10): fingers always join the coast as thumbs. The JS engine, which H12 deletes, still reads the two retired knobs, so they are fixed here.
export const shapeDefaults=config => ({...Object.fromEntries([...SHAPE_FIELDS.map(([key]) => key),...SPUR_OUTLINE_KEYS].map(key => [key,worldDefault(config,key)]))});
// Cover brushes share the plateau outline and write a field, not heights; the
// mask brush (card C5) is one of them.
export const isCover=kind => kind==='sand' || kind==='grass' || kind==='paint';
// A palette entry's starting settings in a world (a landform kind starts as the plateau). A sea-level preset keeps its elevation above the sea.
export function toolDefaults(config,entry,preset=config?.biomeId||'green') {
  const shape=entry==='landform'?'plateau':entry,kind=strokeKind(shape);
  const starting={...(kind==='landform'?{...LANDFORM_DEFAULTS,...LANDFORM_TOOLS[shape]}:{}),...TOOL_PRESETS[preset]?.[shape]},sea=Math.round(starting.heightReference||0)>=1;   // a sea-level or ground preset keeps its own offset
  return {...Object.fromEntries(SHAPE_FIELDS.map(([key,,,,lo,hi,,scale]) => [key,clamp(Math.round(worldDefault(config,key)*scale),lo,hi)])),cracks:{crater:30}[kind]??0,diameter:200,amount:kind==='fissure'?12:isCover(kind)?100:70,roughness:35,softness:50,preset,...starting,
    elevation:sea?Math.round(starting.elevation):clamp(Math.round((config?.baseHeight??24)+(starting.elevation??70)),-80,300)};
}
export function strokeParams(s) { return {...Object.fromEntries(['shorePlates','plateWaterPx','plateLandPx','plateSize','plateGap','plateHeight','plateMaterial','frostNeedles',...COAST_KEYS,...SPUR_OUTLINE_KEYS].map(k => [k,s[k]])),radius:s.radius,amount:s.amount,rough:s.rough,softness:s.softness,craterlets:s.craterlets,craterEjecta:s.craterEjecta,lean:s.lean,facing:s.facing,fingers:s.fingers,faceVariation:s.faceVariation,crystalTiers:s.crystalTiers,paintChannel:s.paintChannel,styleVegetation:s.styleVegetation,waterDeep:s.waterDeep,waterBed:s.waterBed,crystalForm:s.crystalForm,crystalStep:s.crystalStep,crystalSides:s.crystalSides,crystalSize:s.crystalSize,crystalCount:s.crystalCount,crystalTop:s.crystalTop,crystalLean:s.crystalLean,crystalVariation:s.crystalVariation,...Object.fromEntries(['crystalAlign','bergFace','bergJitter','bergBreak','bergRough','bergTilt','bergTiltDir','bergFlat'].map(k => [k,s[k]])),...Object.fromEntries(SECTION_KEYS.map(k => [k,s[k]])),...Object.fromEntries(LANDFORM_KEYS.map(k => [k,s[k]])),...Object.fromEntries(CRATER_KEYS.map(k => [k,s[k]])),curve:s.curve,along:s.along,...Object.fromEntries(RIDGE_KEYS.map(k => [k,s[k]])),...Object.fromEntries(FISSURE_KEYS.map(k => [k,s[k]])),cracks:s.cracks,
  // E7, G7, G6
  ...Object.fromEntries([...E7_KEYS,...G7_KEYS,...G6_KEYS,...CRYSTAL_KEYS].map(k => [k,s[k]]))}; }
// Capture tools rebuild a map from strokes: [kind, [[x,y],...], options],
// each starting from the brush card's defaults for this world. options.card
// overrides card values (diameter, amount, roughness ... in card units); any
// other key is a stroke option.
export const strokeCard=(config,d) => ({radius:d.diameter/2,amount:d.amount,rough:d.roughness/100,softness:d.softness/100,cracks:d.cracks/100,
  ...Object.fromEntries(SHAPE_FIELDS.map(([key,,,,,,,scale]) => [key,d[key]/scale])),...Object.fromEntries(SPUR_OUTLINE_KEYS.map(k => [k,worldDefault(config,k)])),curve:d.curve,along:d.along});
export const groundDefaults=settings => ({amplitude:settings.has('undulation')?Number(settings.get('undulation')):10,wavelength:settings.has('undulationScale')?Number(settings.get('undulationScale')):200,coverage:settings.has('undulationCover')?Number(settings.get('undulationCover')):.45});

// The brush seed a page opens with (sculpt.html's Seed box): a scripted scene's strokes take their seeds from it.
export const DEFAULT_SEED=2701;
// A page's settings: its address over the world's own defaults (boot() in sculpt.js does this to its address once the config is in).
export function addDefaults(settings,defaults={}) { for (const [key,value] of Object.entries(defaults||{})) if (!settings.has(key)) settings.set(key,value); return settings; }
export const pageSettings=(config,search='') => addDefaults(new URLSearchParams(search),config.defaults);
// A world setting the page's address may override (a knob trial in a render's query), else the world's value.
export const worldSetting=(config,settings,key) => settings.has(key)?Number(settings.get(key)):worldDefault(config,key);
// Capture tools rebuild a map from strokes: [kind, [[x,y],...], options], each starting from the brush card's defaults for this world.
// options.card overrides card values (diameter, amount, roughness ... in card units); any other key is a stroke option. Stroke i takes
// the seed + i * 7919; the ground undulation (unless ground is false) comes first, from the page's settings. A river is migrated as a
// drawn one is, over the map.
export function sceneNodes(config,list,{ground=true,seed=DEFAULT_SEED,settings=pageSettings(config)}={}) {
  const out=[];
  if (ground) { const g=groundDefaults(settings); if (g.amplitude>0) out.push({kind:'ground',...g,seed:seed^0x9e37}); }
  list.forEach(([entry,points,options={}],i) => {
    const kind=strokeKind(entry),{card:override,...rest}=options,d={...toolDefaults(config,entry),...override},pts=points.map(([x,y]) => ({x,y}));
    const card={...strokeCard(config,d),seed:(seed+i*7919)>>>0};
    const probe={...card,...rest};
    const node={kind,points:pts,params:strokeParams(probe),seed:probe.seed};
    if(isRiver(node.params)){node.params.river={drawn:pts.map(p => ({...p}))};migrateRiver(config,node);}
    out.push(node);
  });
  return out;
}
// A river's path, migrated over the map (or the working field without one).
export const migrateRiver=(config,node) => applyRiver(node,{w:config.map?.width??config.worldSize??config.size,h:config.map?.height??config.worldSize??config.size});

// What the page runs a scene with besides its nodes, so the headless runner runs it the same way.
// The shape engine's context (sculpt-gpu-fields.js): each node's options over the world's, the brush seed, the talus slope, the sea and
// base, the height range the fields clamp to (heightRange) and the frost gaps (world settings the address may override).
export const heightRange=config => ({minH:config.seaLevel-90,maxH:config.seaLevel+300});
export const shapeContext=({config,settings,seed,talusAngle=40,minH,maxH}) => ({params:n => ({...shapeDefaults(config),...n.params}),seed,repose:Math.tan(talusAngle*Math.PI/180),sea:config.seaLevel,baseHeight:config.baseHeight,minH,maxH,
  frost:{gapSize:worldSetting(config,settings,'frostGapSize'),gapDepth:worldSetting(config,settings,'frostGapDepth'),gaps:worldSetting(config,settings,'frostGaps'),gapReach:worldSetting(config,settings,'frostGapReach')}});
// The Time pass's knobs (sculpt-erosion.js runGpu), from the renderer's settings: the engine's, the world's, then the address.
export const timeKnobs=renderer => ({age:renderer.variantNumber('erosionAge',200),rain:renderer.variantNumber('erosionRain',1),talusAngle:renderer.variantNumber('talusAngle',40),
  envelope:renderer.variantNumber('erosionEnvelope',2),sand:renderer.variantNumber('sand',0),wetReach:renderer.variantNumber('wetReach',3),talusFull:renderer.variantNumber('talusFull',2.5),wearFull:renderer.variantNumber('wearFull',1.5),flowK:renderer.variantNumber('flowK',30)});
// H5b: the Time pass of a paged map (createPagedFields setTime): the knobs the pass reads, all of them in the key (so a change drops every page's
// weather), and the runner a page's window goes through. `material` is materialKnobs' answer; `drainage` gives the plane to hand the pass (P21).
export function pagedTime({config,renderer,size,spacing,material,drainage=() => null}) {
  const p={...timeKnobs(renderer),columnContrast:renderer.variantNumber('columnContrast',1)};
  return {key:JSON.stringify({...p,material,column:config.column,variant:config.variant}),material:Boolean(material),run:async win => {
    const erosion=await erosionOf(renderer);
    const r=await erosion.runGpu({...p,planes:win.planes,masks:win.masks,rateMask:MASK_KEYS.indexOf('ovErosion'),grid:win.grid,size,spacing,seaLevel:config.seaLevel,ox:win.ox,oy:win.oy,drainage:drainage()});
    // The window's eroded height (plane 1 of the pass's weather buffer) makes the material field; the page keeps its core of it.
    if (material) r.field=await erosion.materialField(materialRequest(config,material,{heightBuffer:r.weather,heightOffset:win.grid*win.grid,grid:win.grid,size,ox:win.ox,oy:win.oy}));
    return r;
  }};
}
// The paged fields' budget (createPagedFields `budget`; H12, H13): the terrain GPU budget (gpuMB) and what the map canvas must keep beside the
// fields: its view's canvases (`view`: the terrain canvas and its overlay, the size of the window's map view in pixels, with the overview and
// the minimap, VIEW_CANVASES), the preview's 64 MB once the overview has reserved it, the feature sprites, and one canonical chunk's whole
// working set with every mask layer, its copy, and 8 MB. The renderer's cached meshes are left out: they are given up whenever a bake needs the
// room, and counting them made the ring depend on what the view had baked before. The page gives its own view (sculpt-canvas.js minimumBytes);
// the headless runner gives the view of the Chrome window it stands in for, so both give the pages the same budget and the same ring (pages differ
// at their seams otherwise).
export const VIEW_CANVASES={overview:128,minimap:200};
export function pagedBudget({gpuMB,renderer,chunk,maskCount,view,preview=false,featureBytes=0}) {
  const MB=1048576,e=renderer.estimate(renderer.requiredRegion({x:Math.floor(renderer.size/2),y:Math.floor(renderer.size/2),width:chunk,height:chunk}),chunk,chunk,maskCount,1,false);
  const canvases=2*view.width*view.height+VIEW_CANVASES.overview**2+VIEW_CANVASES.minimap**2;
  return {total:gpuMB*MB,minimum:(preview?64*MB:0)+canvases*4+featureBytes+chunk*chunk*8+e.retainedBytes+e.workingBytes+8*MB};
}
// The surface sliders (sculpt.html's range inputs, by id): the material value each opens at and its default, then the slider's min, max and
// step. A page opens each at round(value x 100), clamped and snapped to its step as the browser does; the address may set the ring's three.
const SURFACE_SLIDERS={relief:['surfaceRelief',1,0,160,5],'material-weathering':['materialWeathering',0,0,100,1],'deposit-spread':['depositSpread',.65,0,100,1],
  'transition-detail':['transitionDetail',.65,0,100,1],'mineral-ring':['ringAmount',0,0,100,1],'ring-spread':['ringSpread',.65,0,100,1],'ring-variation':['ringVariation',.7,0,100,1]};
export const SURFACE_SLIDER_IDS=Object.keys(SURFACE_SLIDERS);
// The slider groups the World panel shows or hides by the world's layers (sculpt.js boot sets these containers' hidden; the rest of the panel is
// its markup): Transition detail needs a body layer, the fringe's three a ring layer.
export const surfaceGroupsHidden=config => ({'transition-detail-control':!config.layers.includes('body'),'ring-controls':!config.layers.includes('ring')});
// The sliders the material field reads (materialKnobs): moving one runs the Time pass again; the others only redraw.
export const TIME_SLIDER_IDS=['material-weathering','deposit-spread'];
export const sliderRange=id => SURFACE_SLIDERS[id].slice(2);
export const sliderValue=(id,v) => { const [,,lo,hi,step]=SURFACE_SLIDERS[id]; return clamp(lo+step*Math.round((clamp(v,lo,hi)-lo)/step),lo,hi); };
export const surfaceSliders=(config,settings) => Object.fromEntries(Object.entries(SURFACE_SLIDERS).map(([id,[key,fallback]]) =>
  [id,sliderValue(id,Math.round((['ringAmount','ringSpread','ringVariation'].includes(key)&&settings.has(key)?Number(settings.get(key)):config.material?.[key]??fallback)*100))]));
// The draw's options from the slider values (by id) and the view switches.
export const drawOptions=(s,{clay=false,light='original'}={}) => ({clay,light,detail:s.relief/100,ring:s['mineral-ring']/100,ringSpread:s['ring-spread']/100,ringVariation:s['ring-variation']/100,
  materialWeathering:s['material-weathering']/100,transitionDetail:s['transition-detail']/100});
// The material field's knobs, or null when Material weathering is 0 (sculpt-erosion.js materialField; `seed` is the refinement seed), and its
// request over the Time pass's eroded height (heightBuffer, heightOffset cells in; ox, oy a page's first lattice cell).
export const materialKnobs=(s,seed,transition) => s['material-weathering']/100>0?{depositSpread:s['deposit-spread']/100,seed,mineral:transition==='mineral'}:null;
export const materialRequest=(config,material,{heightBuffer,heightOffset,grid,size,ox,oy}) => ({heightBuffer,heightOffset,grid,size,ox,oy,seaLevel:config.seaLevel,baseHeight:config.baseHeight,
  seed:material.seed,depositSpread:material.depositSpread,profile:{...config.material,mineral:material.mineral}});
// A world's colors for the renderer ([r, g, b], 0..1): the world's hex colors (null is off: the texture's own), ?sunColor=ffd9a8&skyColor=8fb0ff
// from the address (a light's colors tried on a page without changing the world: renders, review sheets), and an edited column's strata.
export function hexColors(colors,settings) {
  const out={...colors};
  for (const key of ['sun','sky']) { const q=settings.get(key+'Color'); if (q && /^#?[0-9a-f]{6}$/i.test(q)) out[key]=q.startsWith('#')?q:'#'+q; }
  return out;
}
export const rgbColor=h => [1,3,5].map(i => parseInt(h.slice(i,i+2),16)/255);
export function rendererColors(hex,strata) { const out={}; for (const [k,v] of Object.entries(hex)) if (typeof v==='string' && /^#[0-9a-f]{6}$/i.test(v)) out[k]=rgbColor(v); strata?.forEach((c,i)=>{out['strata'+(i+1)]=c.map(v=>v/255);});return out; }
// A world's hex colors (sculpt.js mergedColors): the server's defaults for its base world, then the world's own choices (`own`; a world that
// opens with no choices of its own, sculpt.js activeWorld, starts from its base colors), then the address.
export const worldHexColors=(config,settings,own=config.baseColors||config.colors||{}) => hexColors({...(config.colors||{}),...own},settings);

// The weathered height the page shows and samples (sculpt.js sampleRegional; render.mjs's heights): a cell's authored height h plus the Time pass's
// change there (refined - refinedBase at cell i), faded where h has moved off the height the pass started from and on protected cells (r), and
// bilinear between cells.
const smooth=(a,b,v) => { const t=clamp((v-a)/(b-a),0,1); return t*t*(3-2*t); };
export const weatheredCell=(h,r,i,refined,refinedBase) => Math.fround(h+(refined[i]-refinedBase[i])*(1-smooth(0,10,Math.abs(h-refinedBase[i])))*(1-r));
// A region read of the fields (r: its lattice, fields.h and fields.r) with the Time pass's height laid on where the refinement is `valid`
// (sculpt.js readRegional, which the export's corner heights read; the headless export reads the same): a copy of h.
export function weatheredHeights(r,{refined,refinedBase,grid,spacing,valid=() => true}) {
  const h=r.fields.h.slice(),ox=Math.round(r.gridOrigin[0]/spacing),oy=Math.round(r.gridOrigin[1]/spacing);
  for (let y=0;y<r.gridHeight;y++) for (let x=0;x<r.gridWidth;x++) if (valid(x+ox,y+oy)) { const i=y*r.gridWidth+x; h[i]=weatheredCell(r.fields.h[i],r.fields.r[i],(y+oy)*grid+x+ox,refined,refinedBase); }
  return h;
}
export function bilinearCells(x,y,spacing,grid,cell) {
  const gx=clamp(x/spacing,0,grid-1),gy=clamp(y/spacing,0,grid-1),ix=Math.floor(gx),iy=Math.floor(gy),jx=Math.min(ix+1,grid-1),jy=Math.min(iy+1,grid-1),fx=gx-ix,fy=gy-iy;
  return (cell(ix,iy)*(1-fx)+cell(jx,iy)*fx)*(1-fy)+(cell(ix,jy)*(1-fx)+cell(jx,jy)*fx)*fy;
}

// The planes a map's fields hold: the six authored planes, then the masks.
export const FIELD_KEYS=['h','p','r','c','v','x',...MASK_KEYS];
// The shape's repeat check (sculpt.js shapeCompare; repro/shapecheck.mjs): every plane of the whole map, evaluated again, must be the same.
// `settle` resolves once the fields' evaluation is done.
export async function repeatCheck({fields,grid,settle}) {
  const copy=f => ({h:f.h.slice(),p:f.p.slice(),r:f.r.slice(),c:f.c.slice(),v:f.v.slice(),x:f.x.slice(),masks:MASK_KEYS.map((k,j) => (f.masks?f.masks[j]:f[k]).slice())});
  const all={x0:0,y0:0,x1:grid-1,y1:grid-1},grab=r => ({h:r.fields.h,p:r.fields.p,r:r.fields.r,c:r.fields.c,v:r.fields.v,x:r.fields.x,masks:MASK_KEYS.map(k => r.fields[k])});
  await settle(); const a=copy(grab(fields.readCells(all)));
  fields.changed(); await settle(); const b=copy(grab(fields.readCells(all)));
  return {grid,repeat:comparePlanes(a,b,grid,MASK_KEYS)};
}
// H12b: the regional check of a scene on a map whose fields are paged (gpuPages=force): each quadrant of the map read from the pages against the same
// shape engine run directly over that window; every authored plane must match exactly. Quadrant windows, so each window is a regional run on its own.
// Then (P21) the drainage plane from the pages' coarse lattice against the one from the whole-map engine's heights: the same (area, receiver) in every
// cell. `fields` is the map's paged fields (createPagedFields over `nodes`), `startCoarse` starts their coarse lattice if nothing has yet.
export async function regionalCheck({fields,device,nodes,context,config,grid,spacing,minH,maxH,startCoarse=() => fields.startCoarse()}) {
  if (!fields?.readRect) throw new Error('the regional check needs the paged fields: open the map with gpuPages=force');
  await fields.ready?.();
  const G=grid,engine=await createShapeEngine({device,grid:G,spacing,baseHeight:config.baseHeight,sea:config.seaLevel,minH,maxH}),ctx=context;
  const planes=Object.fromEntries(FIELD_KEYS.map(k => [k,{mismatches:0,maxDifference:0,firstMismatch:null}]));
  let mismatches=0;
  try {
    const middle=Math.floor(G/2);
    for (const [y0,y1] of [[0,middle-1],[middle,G-1]]) for (const [x0,x1] of [[0,middle-1],[middle,G-1]]) {
      const rect={x0,y0,x1,y1},W=x1-x0+1,out=await engine.run(nodes.slice(),ctx,rect),rp=await fields.readRect(rect,{weather:false});
      const expected={h:out.floats[0],p:out.floats[1],r:out.floats[2],c:out.floats[3],v:out.floats[4],x:out.floats[5]};
      for (const key of FIELD_KEYS) {
        const j=MASK_KEYS.indexOf(key),want=j>=0?out.masks[j]:expected[key],got=rp.fields[key],p=planes[key];
        for (let i=0;i<W*W;i++) {
          const a=want[i],b=got[i]; if (a===b && Number.isFinite(b)) continue;
          p.mismatches++; mismatches++; p.maxDifference=Math.max(p.maxDifference,Math.abs(b-a)||Infinity); p.firstMismatch??={x:x0+i%W,y:y0+Math.floor(i/W),engine:a,paged:b};
        }
      }
    }
    {
      await startCoarse();
      await fields.coarseSettled();
      const c=fields.coarseLattice(),whole=(await engine.run(nodes.slice(),ctx,null)).floats[0],w=latticeWidth(G),heights=new Float32Array(w*w);
      for (let j=0;j<w;j++) for (let i=0;i<w;i++) heights[j*w+i]=whole[j*DRAIN_STEP*G+i*DRAIN_STEP];
      const a=await computeDrainage(device,{heights,width:w,sea:config.seaLevel}),b=await computeDrainage(device,{heights:c.heights,width:c.width,sea:config.seaLevel});
      const read=async plane => new Uint32Array(await readBuffer(device,plane.buffer,0,plane.bytes));
      const [pa,pb]=[await read(a),await read(b)],p={mismatches:0,maxDifference:0,firstMismatch:null};
      if (c.width!==w) throw new Error('the coarse lattice is not the drainage lattice');
      for (let i=0;i<pa.length;i++) if (pa[i]!==pb[i]) { p.mismatches++; mismatches++; p.maxDifference=Math.max(p.maxDifference,Math.abs(pa[i]-pb[i])); p.firstMismatch??={cell:i>>1,what:i&1?'receiver':'area',engine:pa[i],paged:pb[i]}; }
      planes.drainage=p; a.retire(); b.retire();
    }
    return {grid:G,planes,mismatches,gpuShape:true};
  } finally { engine.destroy(); }
}
