// The scene builder: the brush cards a stroke starts from in each world and the node list a scripted scene makes from its strokes
// (repro/scenes/*.json, capture tools). No DOM: the page (sculpt.js scriptedScene, the brush panel) and the headless runner
// (repro/render-node.mjs) import the same tables and build the same nodes. A function that reads a world's values takes its config
// (sculpt.py world_configs) and, where the page's address may override them, the page's settings (pageSettings).
import {FACING_CHOICES,FORMS} from './sculpt-shape-presets.js';
import {applyRiver,isRiver} from './sculpt-river.js';
import {createShapeEngine,readBuffer,comparePlanes,DRAWN_KINDS,heightsFields} from './sculpt-gpu-fields.js';
import {erosionOf} from './sculpt-erosion.js';
const clamp=(v,a,b) => Math.max(a,Math.min(b,v));
// The shape library: the landform model's named starting shapes, which a world's tools (config.tools, its table's world.tools) and a scene's strokes
// name. A world lays its own numbers over each (config.worldShapes[world][shape], its table's world.shapes) and may draw them with other tools, so
// a scene that names a shape draws the same whatever the world's toolbar holds. Approved starting shapes use ordinary controls and editable knots.
// Elevation is a rise above the map plain; toolDefaults resolves the absolute height.
export const LANDFORM_DEFAULTS={"diameter":300,"amount":70,"roughness":0,"softness":50,"cracks":40,"faceVariation":0,"lean":100,"facing":3,"terraces":0,"elevation":70,"combine":0,"wander":90,"widthVary":35,"heightVary":3,"varySize":140,"varyFoot":115,"varyMiddle":145,"routeSmooth":0,"crestTaper":0,"fingers":0,"shoreLayers":0,"shorePlates":0,"curve":{"form":"lfPlateau","knots":[[0,0],[0.08,0.006],[0.19,0.035],[0.27,0.15],[0.37,0.65],[0.45,0.96],[0.5,1],[1,1]],"back":[[0.0,0],[0.096,0.006],[0.22799999999999998,0.035],[0.324,0.15],[0.444,0.65],[0.54,0.96],[0.6,1],[1,1]]}};
// The shapes over LANDFORM_DEFAULTS: numbers for Landform's own controls, each the fit of the
// retired tool's default stroke that re-authored the fixtures. Elevation is a rise above the map plain, or with Height reference: Sea level, above the sea.
// The valleys cut to a floor below the plain (Cut to) along one curve: V and U differ only in the curve, the terraced one is the V with the Steps control.
const valley=(form,more={}) => ({diameter:240,lean:100,combine:1,elevation:-20,cracks:0,wander:20,widthVary:20,heightVary:0,varySize:120,varyFoot:100,varyMiddle:100,curve:{form,knots:FORMS[form]().knots},...more});
const hillKnots=() => [[0,0],[.25,.08],[.5,.4],[.75,.8],[.9,.95],[1,1]];
export const LANDFORM_SHAPES={
  // The generic landform: the model's own defaults (and the world's numbers for it). Every toolbar has it (sculpt.html's Landform button), and a
  // stroke or a button card whose tool another world lacks shows as it. A scene or fixture that names it does not take the Plateau's look (its
  // gullies and scree), so the fixtures keep what they were drawn as when a shape's numbers change; to draw what the plateau draws, a scene names it.
  landform:{},
  // A plateau is high ground to build on (the owner's rule: most of it level): 800 px across and 130 over the plain, with a top that is level in the
  // game's heights (Height variation 0). Its wall takes the outer 105 px of each side (0.2625 of the half width), so the level top is 57 to 66% of the
  // footprint on a click and 66 to 77% on a drag (nine worlds, three outlines), and 48 to 68% of the footprint seats a level 64 px pad. The section is a
  // mesa's: a debris slope to 0.36 of the rise, at most 0.87 height units a px (the repose is 0.84), then a caprock cliff (70 units in 18 px, steeper
  // than any unit climbs) and a rounded brow. No vehicle or KBot reaches the top of any of those 27 walls: a way up is a ramp, drawn. Gullies 60 cut
  // the wall and set the cliff back in bays; Gully size 20 is a share of the half width (80 px between the widest), not of the wall: at 50 the ridges
  // between gullies stood 40 units over the top and the bays ate it. Talus reach 40 lays fans at the foot. A world's own plateau keeps its strata and
  // outline and takes this size and section. A scene's bare "landform" does not take these; repro/heights-fixture.mjs's plateau does.
  plateau:{diameter:800,elevation:130,gullies:60,gullySize:20,talus:40,heightVary:0,curve:{form:'lfPlateau',knots:[[0,0],[.02,.01],[.08,.12],[.17,.36],[.215,.9],[.235,.975],[.2625,1],[1,1]]}},
  // A hill is low and wide (240 px, rises 36), the same on both sides (lean 100), with a rounded top and shoulders (the section reaches .95 of the rise at .9 of the way up, and climbs at most .4 of it per quarter) and a smooth outline: its steepest 16 px cell steps 16 units or less against 25 at the 99th percentile of retail Green hills (measure/hill_band.py), so units cross it, and it stays off the rock slope score. Gullies 0 keeps modern Green's gully ribs off it (the other worlds have none).
  hill:{diameter:240,elevation:36,lean:100,cracks:20,gullies:0,styleVegetation:60,wander:10,widthVary:10,heightVary:6,varySize:100,varyFoot:100,varyMiddle:100,curve:{form:'lfHill',knots:hillKnots(),back:hillKnots()}},
  // Peaked ridge: high (150 over the plain), a steep rock face all round (cells over 24 units on 16 px, steeper than retail Green's hills), a chain of five
  // summits with shallow saddles along the path, and divides with scree below them (Gullies, Talus). A hill is its opposite: low, round, walkable.
  mountain:{diameter:200,elevation:160,lean:100,cracks:60,wander:8,widthVary:0,heightVary:10,varySize:80,varyFoot:100,varyMiddle:100,gullies:40,gullySize:50,talus:60,styleVegetation:-70,
    along:[[0,.6],[.1,1],[.22,.74],[.36,1],[.5,.76],[.64,.95],[.76,.72],[.88,.9],[1,.6]],
    curve:{form:'lfMountain',knots:[[0,0],[.12,.01],[.25,.05],[.4,.2],[.55,.45],[.7,.68],[.85,.88],[1,1]]}},
  ramp:{diameter:200,lean:100,combine:2,routeSmooth:100,cracks:0,wander:0,widthVary:0,heightVary:0,varySize:160,varyFoot:100,varyMiddle:100,along:[[0,0],[1,1]],curve:{form:'lfRamp',knots:FORMS.lfRamp().knots}},
  deep:{diameter:200,lean:100,heightReference:1,elevation:-55,combine:1,cracks:0,wander:30,widthVary:30,heightVary:0,varySize:210,varyFoot:100,varyMiddle:100,curve:{form:'lfShore',knots:FORMS.lfShore().knots}},
  // Shallow water is a ford's level bed 7 under the sea, inside the 12 vehicles and KBots wade (docs/PASSABILITY.md), on the Shelf section.
  shallow:{diameter:200,lean:100,heightReference:1,elevation:-7,combine:2,cracks:0,wander:4,widthVary:0,heightVary:0,varySize:210,varyFoot:100,varyMiddle:100,curve:{form:'lfShelf',knots:FORMS.lfShelf().knots}},
  valleyV:valley('lfValleyV'),
  valleyU:valley('lfValleyU'),
  valleyT:valley('lfValleyV',{terraces:4,ledge:55,terraceJitter:30}),
  // A river: Width is the channel (the section reaches 6 channel half widths each side), Wander the migration steps in 4s; the floodplain sits 3 above the sea.
  // Wander is the band the channel may stray in, in px (at most four channel widths). 96 (two widths at 48 px): over 8 widths of course the bends give a median
  // sinuosity of about 1.1 and stray about 1.4 widths from the chord, against retail TA rivers' 1.03 to 1.20 (median 1.12) and 0.4 to 1.6 (measure/river_band.mjs,
  // measure/river_retail.py).
  river:{diameter:48,lean:100,combine:1,heightReference:1,elevation:3,cracks:0,wander:96,widthVary:0,heightVary:0,varySize:120,varyFoot:100,varyMiddle:100,surf:0,curve:{form:'lfRiver',knots:FORMS.lfRiver().knots}},
  // A braided river: the same preset with a braided bed (its form: dry bars, thin threads, engine-shape.wgsl braidedBelt) and no migration unless Wander is raised.
  // The bed is 1.8 widths either side of the line (about 150 px across at this 40 px brush); raise Size to widen it.
  braided:{diameter:40,lean:100,combine:1,heightReference:1,elevation:3,cracks:0,wander:0,widthVary:0,heightVary:0,varySize:120,varyFoot:100,varyMiddle:100,surf:0,curve:{form:'lfBraided',knots:FORMS.lfBraided().knots}},
  // lfcrater: the Crater button. A bowl dug 20 below the ground it lands on with a rim .42 of that above it (the lfCrater section), 360 px foot to foot (a 200 px
  // rim), three secondaries, so a drag is the projectile's path (sculpt-shape-presets.js impactPoint, impactEnd): Roughness 35 as Wander and Height variation. Its
  // Length vs. height curve rises from nothing at the drag's start to the whole crater at its end, so the approach is a scar that deepens and widens into the
  // crater (a click reads the curve at its end: a whole crater). Every preset value sits on its slider's step (the panel snaps any other). lfimpact2: the
  // secondaries fall from the rim to twice as far out (Secondaries' distance 1; retail Moon's small craters gather 1-2 rim radii out round a big one, median
  // 1.46: measure/crater_secondaries.py; every other shape keeps 1.6).
  crater:{diameter:360,lean:100,heightReference:2,elevation:-20,combine:2,cracks:30,wander:20,widthVary:10,heightVary:2,varySize:100,varyFoot:100,varyMiddle:100,ejecta:0,buckling:0,secondaries:3,secondaryDistance:10,along:[[0,0],[1,1]],curve:{form:'lfCrater',knots:FORMS.lfCrater().knots}},
  // lfcrystal: Crystals (the palette's Faceted forms) is a landform broken into prisms by its Facet shape: a click is a cluster round the point, a drag
  // rows along the path. The section is the old cluster's falloff (each prism stood 1 - .45 x its distance share lower toward the rim), the rise its Height.
  crystal:{diameter:200,elevation:40,lean:100,combine:0,cracks:0,wander:0,widthVary:0,heightVary:0,varySize:200,varyFoot:100,varyMiddle:100,iceFacets:100,facetForm:2,facetSurface:1,iceFacetSize:32,
    crystalSides:5,crystalTop:80,crystalVariation:50,crystalAlign:0,crystalTiers:100,bergJitter:20,bergBreak:0,bergRough:0,curve:{form:'lfCrystal',knots:FORMS.lfCrystal().knots,back:FORMS.lfCrystal().knots}}
};
// The worlds' own numbers (their tables' world.shapes), by what they were fitted to:
// - Red's and Crystal's craters carry no rim in their heights (retail Red and Crystal: rim/depth -.12..0): a .06 lip for the art and a wide bowl.
// - Red's, Desert's, Moon's and Zhon's hills, mountains and water carry the retired outline options as wander and height variation; Desert's
//   plateau is the reviewed mesa (ragged feet, foot bumps on the ridges: the retired baseVary and baseBump), and the bare landform takes it too.
// - Moon's hills are lobed (the retired moonLobes): wander in lobes about 60 px long, from foot to crest.
// - Crystal's Faceted forms draw a column mound (its old brush: Height 140, 480 wide, Irregularity 40): stepped columns over the mound's
//   (1 - r^2)^1.2 dome, the edge noise as wander. Ice's draw an iceberg a click (retail ice-2, ice-3): one rough slab 240 px wide whose flat top
//   tilts down to the north (the front and back knots a plane through the center, Level tops 0), its corners cut, lit as the world's own slope
//   (Surface Rock); a drag scatters a field of them.
// - Lava's banks rise ~22-24 units over 40-60 px, steep at the lava then flattening (retail coasts, measure/lava_*): wide, concave dry banks, as
//   shoreline steps and lobes.
// A save's brush card for a palette button counts only if every setting it holds is one the button's card has today (or its curves and preset);
// a card holding a removed option starts from the button's preset instead (AGENTS.md rule 7: a save loads without a removed option).
export function savedToolCard(config,entry,card) {
  if (!card || typeof card!=='object') return null;
  // A card still on a world's preset was never edited (every edit marks it custom), so it is that preset as this editor has it: a preset's change
  // reaches a working map's buttons as it reaches a new map's (Shallow water's Shelf section, November 7).
  if (Object.hasOwn(config?.worldShapes||{},card.preset)) return toolDefaults(config,entry,card.preset);
  const current=new Set([...Object.keys(toolDefaults(config,entry)),'curve','along','preset']);
  return Object.keys(card).every(k => current.has(k))?card:null;
}
// A shape's or a palette entry's stroke kind: the shapes all draw landforms.
export const strokeKind=t => Object.hasOwn(LANDFORM_SHAPES,t)?'landform':t;
// Shape options: per-shape settings, shown for the tools they apply to and
// kept in each shape, so a selected shape can be changed like a new stroke.
// Each starts at the world's value (sculpt.py KNOB_DEFAULTS / WORLD_KNOBS).
// Cross-section (card C1): the kinds that take the parametric profile, and the
// options that describe it. Wired like every shape option: SHAPE_FIELDS, the
// card scriptedScene builds, strokeParams and KNOB_DEFAULTS (sculpt.py).
// Line features (card C4): spurs and the crest's taper. All default off; spurs branch off a landform's crest (or a signed section's peak).
export const RIDGE_KEYS=['spurCount','spurLength','spurSpread','spurWidth','spurTaper','spurHeight','spurForks','spurBulb','crestVary','crestTaper'];
// Placed fissures (card C4 stage 2): the Fissure tool and its options. Depth is
// the stroke's own amount; the rest are shape options kept in the shape.
export const FISSURE_KEYS=['fissureWidth','fissureJag','fissureBranches','fissureBranchLen','fissureBranchSpread','fissureTaper','fissureNetwork','fissureCell','fissureCrack','fissureDark'];
export const SECTION_KEYS=['terraces','ledge','terraceJitter','breakup'];
// Landform (card H27): the elevation and how it combines, and the variation along and across the path. The along curve (a knot list) rides with the section curve.
// lfcrater: the impact features any landform can throw (sculpt-shape-presets.js impactOn): ejecta round it and secondaries (small copies of it) beyond them;
// lfimpact2: and, on a landform that digs, the buckled ground beyond its rim; Secondaries' distance sets how far out the secondaries fall. A stroke with any of them reads its path as the impact's track (direction and angle from the drag). Wired like every shape option (BACKLOG ground rule 4).
export const CRATER_KEYS=['ejecta','buckling','secondaries','secondaryDistance'];
export const LANDFORM_KEYS=['stepReference','heightReference','elevation','combine','routeSmooth','wander','widthVary','heightVary','gullies','gullySize','talus','surf','varySize','varyFoot','varyMiddle','wallVary','beds','bedSoft'];
// Painted masks (card C5): nine signed-byte planes per cell, where 0 changes
// nothing: rock, snow or ice, wet ground and moss (0..127 of full), scatter
// density, and three local style settings (stage 2: relief strength, cracks
// and banding, each -127..127 about the world's own value); plane 8 (the face
// rock share of the old face blend; choices 14 and 15) is no longer written.
// 'paint' is the brush; a landform writes only its Local vegetation
// (plane 16) into its own footprint.
// Card E1 adds five more: the water choices of a deep or shallow stroke (plane 9,
// the shore edge, is no longer written; shallow-to-deep edge, bed; +127 hard /
// lit bed, -127 faded / noise water), painted ground lumps (+127 more, -127
// fewer) and the cracked-bed flag.
// Planes 0-20 are in use (14-17 are the override planes, 18 a water stroke's Surf, 0..127 of 1, 19 a braided river's bed, 0..127 of 1, which the draw lays as
// the world's river-bed gravel, 20 the rock a cell belongs to: the slot + 1 of a rock recipe, 0 the world's own, engine-common.wgsl rockSlotAt);
// 21-24 are unused placeholders (the flow bake's planes 20-24 went with it). The shape engine's buffers hold seven
// words a cell (28 planes), so the layout stays as they and the shaders read it.
export const MASK_KEYS=['mr','ms','mw','mm','md','ml','mc','mb','mf','mx','my','mz','mg','mk','ovErosion','ovDeposits','ovVegetation','ovExposure','surf','riverBed','rock','fv','s1','s2','s3'];
export const MASK_CHOICES=[[1,'Rock'],[2,'Snow or ice'],[3,'Wet or dark ground'],[4,'Moss'],[5,'Denser scatter'],[6,'Sparser scatter']];
export const LUMP_CHOICES=[[16,'Ground lumps'],[17,'Smoother ground']];
// H3 override planes 14-17 (a signed value v multiplies the control it names by 1 + v; 0 changes nothing): erosion rate (H2's pass),
// loose deposits (sand and scree), vegetation (grass and moss cover), rock exposure. Paint choices 18-25 write them.
export const OVERRIDE_CHOICES=[[18,'Relaxation: more'],[19,'Relaxation: less'],[20,'Deposits: more'],[21,'Deposits: less'],[22,'Vegetation: more'],[23,'Vegetation: less'],[24,'Rock exposure: more'],[25,'Rock exposure: less']];
export const STYLE_CHOICES=[...OVERRIDE_CHOICES,[8,'Relief stronger'],[9,'Relief weaker'],[10,'Cracks more'],[11,'Cracks fewer'],[12,'Banding more'],[13,'Banding less']];
export const COAST_KEYS=['shoreLayers','layerPx','layerRiser','layerLedge','layerRough','layerStyle',
  // E10: finger size; layer width variation; the circles of scalloped layers.
  'fingerSize','layerVary','layerCircle',
  // G5 (Lava): the layers' two-dimensional wander and extra width spread; the circles' variety; the lobes' tread tilt (the hill-lobe option rides this list, as E10's).
  'lavaSpread','lavaCircleVary',
  // L2 (Lava): each layer's edge jag.
  'layerJag'];
// [key, element id, label, kinds, slider min, max, step, slider units per value, help, drop-down choices]
export const SHAPE_FIELDS=[
  ['faceVariation','face-variation','Face width variation',['erase'],0,150,5,100,'How much the edge face widens and narrows along the outline (on a carried cross-section, every width of it).'],
  ['lean','lean','Lean (back length over face)',['landform'],0,400,5,100,'How much longer the slope toward the lean side runs than the one away from it (100 or 0: the same both sides).'],
  ['facing','facing','Lean toward',['landform'],0,10,1,1,'The side the shape leans toward, the long gentle slope: a map direction or a side of the line you draw (a ridge\'s steep face is the opposite side).',FACING_CHOICES],
  ['fingers','fingers','Shore lobes',['landform'],0,150,5,100,'Interlocking land fingers and inlets along the shore.'],
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
  ['wander','lf-wander','Wander (px)',['landform'],0,200,2,1,'How far the outline moves in and out around the sides and ends, in waves as long as the Variation size. The drawn crest stays in place.'],
  ['widthVary','lf-width-vary','Width variation',['landform'],0,100,5,100,'How much the section widens and narrows along the path (100: from half to twice its width).'],
  ['heightVary','lf-height-vary','Height variation (units)',['landform'],0,40,1,1,'How far the surface rises and falls, in height units, in waves as long as the Variation size. It is zero at the feet.'],
  // P1: branching gullies on the raised faces, steered down the stroke's own fall line (engine-shape.wgsl landformGullies).
  ['gullies','lf-gullies','Gullies',['landform'],0,100,5,100,'Cut the raised faces into a divide, spurs off it and V-gullies that branch as they run down the fall line, deepest on steep faces and fading at the foot. Their depth varies along a wall, and where they cut deepest the wall stands back in bays between buttresses, so the rim leaves the drawn line. 0: smooth faces and the drawn rim.'],
  ['talus','lf-talus','Talus reach (px)',['landform'],0,200,5,1,'How far loose material runs out from the foot of a raised face: a concave apron that rests at the world\'s talus angle against the face and comes down level at its toe this far out, fanning from the widest gullies into one skirt. A longer reach makes a longer, gentler apron, not a taller one. Below any wall the Gullies cut, the ravines also lay fans of debris that end this far beyond the foot, whatever the slope. Loose ground carries stones and no rock detail. 0: no talus. It needs Gullies, for the chutes.'],
  ['gullySize','lf-gully-size','Gully size',['landform'],10,100,5,100,'How far apart the widest gullies run, as a share of the face from crest to foot; each finer set is half as far apart. Low: close rills; high: a few broad valleys between big spurs.'],
  // Hard beds: cliff bands at fixed levels up a raised face, after the Gullies (engine-shape.wgsl hardBeds).
  ['beds','lf-beds','Hard beds',['landform'],0,8,1,1,'Stand the raised face in this many cliff bands, one above another, with a gentler slope under each: hard beds that stand and soft ones that lie back. Each band keeps its level round every spur and up every gully, waves a little along the wall, and thins out over some stretches, so ledges end and the next steps out. The level top and the ground at the foot do not move. 0: the face as drawn.'],
  ['bedSoft','lf-bed-soft','Soft beds lie back',['landform'],0,100,5,100,'How far the soft bed under each hard one lies back, and so how steep the hard bed stands. 0: the face keeps its drawn slope. 100: the soft beds are nearly level benches and the hard beds stand about two and a half times as steep as the face was drawn.'],
  // P27: the shore's wet sand, foam and beach by the coast distance (engine-frag.wgsl surfShore); written into mask plane 18 where the stroke makes water.
  ['surf','water-surf','Surf',['landform'],0,100,5,100,'How much the shore is worked by waves, where this stroke makes water. 0: the shore is drawn as before. A little: a thin, broken wet strip and a few flecks of foam at the waterline. More: wider wet sand, wrack lines, a beach of sand whose inland edge breaks into the grass, cusps (the land is shaped to a gentle face, a berm and a slight back-slope, up to a few units tall) and a broken breaker line over the shallows. A rocky shore is painted with the Paint tool\'s rock.'],
  // lfcrater: impact features (CRATER_KEYS).
  ['ejecta','lf-ejecta','Ejecta',['landform'],0,300,5,100,'Material thrown out round the shape: a blanket that thins away from its rim (or, on a shape that peaks on its path, its foot), broken into radial streaks and ragged lobes. Drag to aim it: the drag is the projectile\'s path and the shape lands at its end. A click throws it all round; a short drag gathers it downrange and, longer, leaves a gap uprange; a drag longer than the diameter throws to both sides. The path before the landing is a groove, at each place as deep and as wide as Length vs. height sets.'],
  ['buckling','lf-buckling','Buckling',['landform'],0,300,5,100,'A big impact buckles the ground just beyond its rim into broken rings of uplifted blocks, highest by the rim and gone by about 1.7 rim radii, more downrange as the ejecta are. It grows with the shape: none while its rim is under about 30 px from its center, all of it from about 160 px. It shows on a shape that digs into the ground it lands on (Height reference Ground, a height below 0); with it on, a drag lands the shape at its end, as Ejecta says.'],
  ['secondaries','lf-secondaries','Secondaries',['landform'],0,12,1,1,'Small copies of the shape thrown beyond the ejecta, some in short chains along a ray; they gather downrange, or to the sides, as the ejecta do. With any impact row on, a drag lands the shape at its end, as Ejecta says.'],
  ['secondaryDistance','lf-secondary-distance','Secondaries\' distance (rim radii)',['landform'],8,40,1,10,'How far out the secondaries fall, in rim radii from the center: from this distance to twice as far, and their chains a little farther. 1 lands the nearest on the rim; retail Moon\'s small craters gather 1 to 2 rim radii out. It shows once Secondaries is 1 or more.'],
  ['varySize','lf-vary-size','Variation size (px)',['landform'],20,400,10,1,'The wavelength of the wander and of the width and height variation.'],
  ['wallVary','lf-wall-vary','Variation along the wall',['landform'],0,100,5,100,'How much one wall differs from stretch to stretch. 0: the same wander and the same gullies all the way round. Higher: the outline also bends in long waves, three Variation sizes across, with alcoves and salients; its small teeth come and go, so some stretches run straight; the Gullies leave some stretches plain, cut others far deeper, and run closer or wider apart; and Hard beds end and step more often.'],
  ['varyFoot','lf-vary-foot','Variation at the foot',['landform'],0,200,5,100,'How much of the variation acts at the foot of the section (100: all of it, 0: none, 200: twice). It blends into the next one up to the middle of the section.'],
  ['varyMiddle','lf-vary-middle','Variation up the section',['landform'],0,200,5,100,'How much of the variation acts from the middle of the section to its crest. Set the foot to 0 and this to 200 for variation that grows toward the crest.'],
  ['spurCount','spur-count','Spurs',['landform'],0,12,1,1,'Tapering spurs that branch off this ridge, grown from the shape\'s own seed. Each joins its parent at the crest; on a section that dips below the ground and peaks before its path (a crater\'s rim), they leave from that peak.'],
  ['spurLength','spur-length','Spur length (px)',['landform'],20,400,10,1,'Average reach of a spur; each runs from about half to one and a half times this.'],
  ['spurSpread','spur-spread','Spur angle spread',['landform'],0,100,5,100,'0: spurs leave swept back at about 40 degrees (off a click, straight out); 100: scattered up to square and beyond, and more winding.'],
  ['spurWidth','spur-width','Spur width',['landform'],20,200,5,100,'A spur\'s width at its root, as a share of the ridge\'s own; it flares a little where it joins.'],
  ['spurTaper','spur-taper','Spur taper',['landform'],0,100,5,100,'How much a spur narrows and lowers toward its tip.'],
  ['spurHeight','spur-height','Spur height',['landform'],10,100,5,100,'A spur\'s root height as a share of the ridge\'s crest (of the peak it leaves from).'],
  ['spurForks','spur-forks','Spur forks',['landform'],0,100,5,100,'The share of spurs that fork once, two thirds of the way out, into a shorter spur.'],
  ['spurBulb','spur-bulb','Bulbous spur tips',['landform'],0,100,5,100,'Swells the outer half of every spur into a rounded lobe, so it ends in a knuckle, not a point.'],
  ['crestVary','crest-vary','Spur variation',['landform'],0,100,5,100,'Each spur swells and narrows, and rises and dips, along its length, in waves about two spur widths long, so the spurs read as uneven ridges, not smooth tapering ones. 0: even spurs. It acts on spurs, so it shows once Spurs is on.'],
  ['crestTaper','crest-taper','Crest taper (both ends)',['landform'],0,100,5,100,'The crest narrows and lowers toward both ends of its path; it multiplies the height along the path.'],
  ['fissureWidth','fissure-width','Width (px)',['fissure'],2,24,1,1,'Width of the cut at its widest. The grid is 2 px, so a cut never reads narrower than about 4 px, however thin it is set.'],
  ['fissureJag','fissure-jag','Jaggedness',['fissure'],0,100,5,100,'How far the cut zigzags off its path, and how its depth varies along it.'],
  ['fissureBranches','fissure-branches','Branches',['fissure'],0,12,1,1,'Side cuts that leave the main cut, and fork once, grown from the shape\'s own seed. Network mode ignores them.'],
  ['fissureBranchLen','fissure-branch-len','Branch length (px)',['fissure'],20,300,5,1,'Average reach of a branch; each runs from about half to one and a half times this.'],
  ['fissureBranchSpread','fissure-branch-spread','Branch angle spread',['fissure'],0,100,5,100,'0: branches leave at about 25 degrees to the cut; 100: up to square.'],
  ['fissureTaper','fissure-taper','Taper',['fissure'],0,100,5,100,'How much the cut narrows and shallows toward its ends and its branch tips.'],
  ['fissureNetwork','fissure-network','Cut layout',['fissure'],0,1,1,1,'0: cut along the stroke. 1: a connected polygonal fracture network over the stroke\'s whole footprint (Diameter sets how far it reaches), as on Red\'s rock platforms.'],
  ['fissureCell','fissure-cell','Network block size (px)',['fissure'],30,160,5,1,'Typical width of a block between the cuts.'],
  ['fissureCrack','fissure-crack','Fractured rock beside the cut',['fissure'],0,100,5,100,'Raises the world\'s own crack field along the cut, so the rock beside it breaks up (0 leaves only the cut).'],
  ['fissureDark','fissure-dark','Darkness',['fissure'],0,100,5,100,'Paints the world\'s own wet (dark) ground along the cut, so it reads dark whatever the ground (it layers on rock, snow or moss).'],
  ['shorePlates','shore-plates','Shore plates',['landform'],0,1,1,1,'Add a band of broken plates on this stroke only. Off preserves the original water shape.'],
  ['plateWaterPx','plate-water-px','Plates: water width (px)',['landform'],0,240,4,1,'Reach from this stroke\'s waterline into the water.'],
  ['plateLandPx','plate-land-px','Plates: land width (px)',['landform'],0,240,4,1,'Reach from this stroke\'s waterline onto land, with broken pressure ridges.'],
  ['plateSize','plate-size','Plate size (px)',['landform'],8,96,2,1,'Typical width of the interlocking polygonal plates.'],
  ['plateGap','plate-gap','Plate gap (px)',['landform'],0,160,5,10,'Open gap between adjacent plates.'],
  ['plateHeight','plate-height','Plate height above sea',['landform'],0,240,5,10,'Flat water plates sit this high above sea; land keeps its existing height. Rock slabs: how far the land slabs stand above their seams.'],
  ['plateMaterial','plate-material','Shore structure',['landform'],1,2,1,1,'2: frost crystals, parallel straight needles in patches of three directions, cut by straight seams, thinning toward deep water (Plate size is the patch, Plate gap the needle spacing; retail Ice). 1: low flat rock slabs that interlock along the shore with dark seams between them, and a shallow ledge under the water (Crystal). The band follows this stroke\'s own waterline, so separate shores stay separate.'],
  ['frostNeedles','frost-needles','Frost needle share (plate material 2)',['landform'],0,100,5,100,'Frost crystals: the share of patches that carry needles at all; the rest of the band is plain ice. Needles in a patch are also dropped at random, so lines are sparse, fine and of varied length.'],
  // Water looks (card E1): each stroke may keep the world's choice (0) or set its own.
  ['waterDeep','water-deep','Shallow-to-deep edge',['landform'],0,2,1,1,'World default keeps the World panel\'s Shallow-to-deep step. Hard: the shallow color stops at one depth with ragged stairs (retail Green). Faded: the color follows the depth ramp gradually (retail Archipelago).',[[0,'World default'],[1,'Hard'],[2,'Faded']]],
  ['waterShore','water-shore','Shore',['landform'],0,1,1,1,'World default keeps the World panel\'s Rock at shores and Rock shelf under water: an open, wave-cut shore of bare jointed rock. Soft bank: no shore rock round this water, on land or on the bed (an inland lake).',[[0,'World default'],[1,'Soft bank']]],
  ['paintChannel','paint-channel','Paint',['paint'],1,25,1,1,'What the brush paints. Denser scatter supplies its own stones where the World panel\'s Boulders and Debris are 0 and multiplies them where they are not. Style settings go more or less than the world\'s own value; Strength is how far. Erase clears every mask and style under the brush.',[...MASK_CHOICES,...LUMP_CHOICES,...STYLE_CHOICES,[7,'Erase all masks and style']]],
  // Rock presets (B2): the rock this landform is made of, one of the map's presets (sculpt-rock-presets.js); -1, Rock beneath, keeps the rock that is
  // already there. Its choices are the map's presets (sculpt.js syncRockChoices).
  ['rockPreset','lf-rock','Rock',['landform'],-1,15,1,1,'The rock this shape is made of, one of the map\'s rock presets (World pane, Rock & cliffs). Rock beneath keeps whatever rock is already there: the world\'s own, or an earlier shape\'s. The shape claims its rock wherever it moves the ground, so a later shape wins where it overlaps an earlier one.',[[-1,'Rock beneath']]],
  // Local vegetation inside the shape (card C5 stage 2): a change about the world's own cover, 0 none.
  ['styleVegetation','style-vegetation','Local vegetation',['landform'],-100,100,5,100,'Grass and moss cover inside the shape, times 1 + this: below 0 more bare rock, above 0 more cover.'],
  // E10 (Lava): finger size; layer width variation; circle size of the circular layers.
  ['fingerSize','finger-size','Lobe size',['landform'],20,300,5,100,'Fingers on the joined coast: length and (less) width of each finger. Fingers never reach past this stroke\'s bank.'],
  ['layerVary','layer-vary','Layer width variation',['landform'],0,100,5,100,'How much each layer\'s width and riser height change along the shore and from one layer to the next, so risers bunch, part and merge as retail\'s do. 0 keeps the even layers.'],
  ['layerCircle','layer-circle','Circle size (px, circular layers)',['landform'],8,80,1,1,'Circular layers: the typical radius of the round bites cut from the bank.'],
  // G7 (Crystal): finer shore slabs.
  // H20b (Crystal): some slabs break into a fine mesh.
  ['plateVary','plate-vary','Slab variety',['landform'],0,100,5,100,'Rock slabs (Plate material 1): in patches, a slab breaks into a fine mesh of cells about 0.4 of Plate size inside its own outline, so the large seams stay. This sets the share of slabs that break; 0 keeps every slab whole.'],
  ['crystalShoreSeam','crystal-shore-seam','Slab seam weight',['landform'],50,65,1,100,'Rock slabs: the crystal-field value of a seam. 50 is the earlier black seam; higher values thin it (the shader inks only below 66) toward the hairline seams of retail\'s shore band.'],
  // Facets (G6, lfcrystal, lfland): one feature of any landform, on/off and coverage, shape, width, step, surface and each shape's own rows.
  ['iceFacets','ice-facets','Facets',['landform'],0,100,5,100,'Breaks the shape into facets of the Facet shape, each as high as the shape at its center, so the section and along curves shape the cluster or ridge they make. This sets how much of it: angular facets and columns cover this share of the surface (the rest stays smooth), prisms stand on this share of their places. On a landform that digs into the ground (Height reference Ground, below 0) the facets are angular, planes fitted to its own surface up and down, and this is how fully they replace it. 0 keeps the smooth surface. A landform with shore features keeps those instead.'],
  ['facetForm','lf-facet-form','Facet shape',['landform'],0,2,1,1,'Angular facets: tilted planes fitted to the shape\'s own surface, a little steeper, stepped off their neighbors. Stepped columns: the surface tiled with flat polygonal columns, stepped up and down. Prisms: separate polygonal prisms standing on the ground, scattered over the shape (a cluster round a click, a ridge along a drag): crystal shards, or as wide as the shape, one block. A landform that digs takes angular facets.',[[0,'Angular facets'],[1,'Stepped columns'],[2,'Prisms']]],
  ['facetSurface','lf-facet-surface','Surface',['landform'],0,1,1,1,'Rock: the facets are the shape\'s own ground, lit with the world\'s slope relief and light (rock facets, ice blocks). Crystal: clean crystal in the world\'s crystal color; each column or prism is shaded on its own and outlined, and angular facets become one crystal skin under the world\'s thin crystal web (Crystal\'s crater walls).',[[0,'Rock'],[1,'Crystal']]],
  ['iceFacetSize','ice-facet-size','Facet width (px)',['landform'],8,1000,2,1,'The typical width of one facet, column or prism, and the spacing of the prisms. A prism as wide as the shape stands alone.'],
  ['crystalStep','crystal-step','Step height',['landform'],0,64,1,1,'Angular facets and stepped columns: how far each facet or column steps up or down from the shape under it, in height units. Angular facets on a raised shape stand up to about twice this above it; on a landform that digs, this either way; columns up to about twice this either way, with about 40% flush (retail Crystal\'s columns: 16; its crater walls: 1).'],
  ['crystalTiers','crystal-tiers','Level tops',['landform'],0,100,5,100,'Stepped columns and prisms: how level each top stands. 100: level at the height of the shape at the element\'s center, so it steps distinctly from its neighbors. 0: the top keeps the slope of the shape under it, as one plane across the element (a lean, a sloping section or different front and back sections tilt it: an ice slab\'s tilted top).'],
  ['crystalFacet','crystal-facet','Top tilt',['landform'],0,100,5,100,'Stepped columns: tilts each column\'s top into one or two planes that meet at a crease, so the tops read as crumpled multi-facet crystal, not flat plates. 0 keeps flat tops.'],
  ['crystalSizeVar','crystal-size-var','Size mix',['landform'],0,100,5,100,'Stepped columns: mixes three column widths (Facet width, about half and about a third of it), the small ones where the shape stands highest and in patches. 0 keeps one width.'],
  ['crystalSides','crystal-sides','Polygon sides',['landform'],3,10,1,1,'Prisms: the sides of each prism\'s outline (Variation mixes a few more and fewer).'],
  ['crystalTop','crystal-top','Flat top share',['landform'],0,95,5,100,'Prisms: the share of each prism that is its flat top. 0: pointed; higher cuts the tops level, with shorter, steeper faces (an ice block).'],
  ['crystalVariation','crystal-variation','Variation',['landform'],0,100,5,100,'Prisms: the spread of their sizes, heights and side counts, and how much looser their spacing gets. 0: even sizes, still irregularly spaced.'],
  ['crystalAlign','crystal-align','Align to the path',['landform'],0,100,5,100,'Prisms: 0 turns each prism at random, 100 sets its faces square to the path where it stands (four sides then make blocks that follow the path).'],
  ['bergJitter','berg-jitter','Outline jitter',['landform'],0,100,5,100,'Prisms: how far each face\'s angle and distance stray from a regular polygon.'],
  ['bergBreak','berg-break','Corner cuts',['landform'],0,8,1,1,'Prisms: extra planes that cut corners off each prism.'],
  ['bergRough','berg-rough','Face roughness',['landform'],0,30,1,1,'Prisms: fractal roughness added to the height, from 40 px lumps to 4 px grain.'],
  // G5 (Lava): contour layers wander in two dimensions and vary in width, as retail lava-1's bank.
  ['lavaCircleVary','lava-circle-vary','Circular bite variation',['landform'],0,100,5,100,'Circular layers: how much the bites differ from one another, in radius (a few large among many small), in the spacing of their rings, and in how many sites keep one, so they gather in clusters with bare stretches, as retail lava-2\'s do. 0: the even circles.'],
  // L2 (Lava): retail's layer edges are jagged, each on its own, where their wander is smooth and shared.
  ['layerJag','layer-jag','Layer edge jag (px)',['landform'],0,12,1,1,'Shoreline steps: how far each step\'s edge zigzags, in runs of about 8 px, so the risers read ragged as retail lava\'s banks do; the waterline itself stays. 0: the edges wander smoothly.'],
  ['lavaSpread','lava-spread','Layer width spread',['landform'],0,200,5,100,'Contour layers: extra spread in layer width along the shore, on top of Layer width variation (100 is about 2.7 times between the narrowest and the widest). 0: none.'],
];
export const E7_KEYS=['crystalFacet','crystalSizeVar'];
export const G7_KEYS=['crystalShoreSeam','plateVary'];
// G6 (Ice): the mountain facets' options, wired beside E7's (the card the stroke builds and strokeParams).
export const G6_KEYS=['iceFacets','iceFacetSize'];
// Facets: the shape of the facets and their surface (the rest reuse the keys wired above).
export const CRYSTAL_KEYS=['facetForm','facetSurface'];
export const worldDefault=(config,key) => { const v=Number(config?.defaults?.[key]); return Number.isFinite(v)?v:0; };
// Values a replayed shape uses for options it was drawn without.
// Owner ruling (H10): fingers always join the coast as thumbs. The JS engine, which H12 deletes, still reads the two retired knobs, so they are fixed here.
export const shapeDefaults=config => Object.fromEntries(SHAPE_FIELDS.map(([key]) => [key,worldDefault(config,key)]));
// Cover brushes share the plateau outline and write a field, not heights; the
// mask brush (card C5) is one of them.
export const isCover=kind => kind==='sand' || kind==='grass' || kind==='paint';
// A world's own shape (its table's world.shapes.<name> = {from, ...numbers}): a shape of the library as that world makes it, with these numbers over it, so
// a world can ship two tools on one library shape (two hills). Only that world's tools name one; a scene names library shapes, so none ever moves a scene.
// The library shape a name draws: its `from` for a world's own shape (a library name keeps its own: a world's numbers for a library shape take no `from`).
export function shapeFrom(config,entry,preset=config?.biomeId||'green') {
  const from=config?.worldShapes?.[preset]?.[entry]?.from;
  return !Object.hasOwn(LANDFORM_SHAPES,entry) && typeof from==='string' && Object.hasOwn(LANDFORM_SHAPES,from)?from:entry;
}
// A shape's (or another palette entry's) starting settings as a world makes it: the library's numbers, then the world's (`preset`: by default the
// config's own world; a tool's Defaults from world may name another); a world's own shape, its library shape as the world makes it, then its own numbers.
// A sea-level preset keeps its elevation above the sea.
export function toolDefaults(config,entry,preset=config?.biomeId||'green') {
  const base=shapeFrom(config,entry,preset),kind=strokeKind(base),shapes=config?.worldShapes?.[preset],numbers=name => { const {from,...n}=shapes?.[name]||{}; return n; };
  const starting={...(kind==='landform'?{...LANDFORM_DEFAULTS,...LANDFORM_SHAPES[base]}:{}),...(base!==entry?numbers(base):{}),...numbers(entry)},sea=Math.round(starting.heightReference||0)>=1;   // a sea-level or ground preset keeps its own offset
  return {...Object.fromEntries(SHAPE_FIELDS.map(([key,,,,lo,hi,,scale]) => [key,clamp(Math.round(worldDefault(config,key)*scale),lo,hi)])),cracks:0,diameter:200,amount:kind==='fissure'?12:isCover(kind)?100:70,roughness:35,softness:50,preset,...starting,
    elevation:sea?Math.round(starting.elevation):clamp(Math.round((config?.baseHeight??24)+(starting.elevation??70)),-80,300)};
}
export function strokeParams(s) { return {...Object.fromEntries(['shorePlates','plateWaterPx','plateLandPx','plateSize','plateGap','plateHeight','plateMaterial','frostNeedles',...COAST_KEYS].map(k => [k,s[k]])),radius:s.radius,amount:s.amount,rough:s.rough,softness:s.softness,lean:s.lean,facing:s.facing,fingers:s.fingers,faceVariation:s.faceVariation,crystalTiers:s.crystalTiers,paintChannel:s.paintChannel,styleVegetation:s.styleVegetation,rockPreset:s.rockPreset,waterDeep:s.waterDeep,waterShore:s.waterShore,crystalStep:s.crystalStep,crystalSides:s.crystalSides,crystalTop:s.crystalTop,crystalVariation:s.crystalVariation,...Object.fromEntries(['crystalAlign','bergJitter','bergBreak','bergRough'].map(k => [k,s[k]])),...Object.fromEntries(SECTION_KEYS.map(k => [k,s[k]])),...Object.fromEntries(LANDFORM_KEYS.map(k => [k,s[k]])),...Object.fromEntries(CRATER_KEYS.map(k => [k,s[k]])),curve:s.curve,along:s.along,...Object.fromEntries(RIDGE_KEYS.map(k => [k,s[k]])),...Object.fromEntries(FISSURE_KEYS.map(k => [k,s[k]])),cracks:s.cracks,
  // E7, G7, G6
  ...Object.fromEntries([...E7_KEYS,...G7_KEYS,...G6_KEYS,...CRYSTAL_KEYS].map(k => [k,s[k]]))}; }
// Capture tools rebuild a map from strokes: [kind, [[x,y],...], options],
// each starting from the brush card's defaults for this world. options.card
// overrides card values (diameter, amount, roughness ... in card units); any
// other key is a stroke option.
export const strokeCard=(config,d) => ({radius:d.diameter/2,amount:d.amount,rough:d.roughness/100,softness:d.softness/100,cracks:d.cracks/100,
  ...Object.fromEntries(SHAPE_FIELDS.map(([key,,,,,,,scale]) => [key,d[key]/scale])),curve:d.curve,along:d.along});
export const groundDefaults=settings => ({amplitude:settings.has('undulation')?Number(settings.get('undulation')):0,wavelength:settings.has('undulationScale')?Number(settings.get('undulationScale')):200,coverage:settings.has('undulationCover')?Number(settings.get('undulationCover')):.45,
  art:settings.has('undulationArt')?Number(settings.get('undulationArt')):1});   // the share of the undulation the art shows (lit and painted); the game heights keep all of it

// The brush seed a page opens with (sculpt.html's Seed box): a scripted scene's strokes take their seeds from it.
export const DEFAULT_SEED=2701;
// A page's settings: its address over the world's own defaults (boot() in sculpt.js does this to its address once the config is in).
// A world with no beach of its own may take another world's (Colors & base pattern, Beach: the setting beachFrom names a world of config.beachSources,
// sculpt.py world_configs): the lender's beach layer (the renderer generates it after the world's own, from the table this names) and its beach
// width, height and color, so every reader of config.layers and config.material (the panel's facts and rows, the chunk margins, the renderer)
// sees a beach. The page's boot and the headless host call this once the settings hold the world's defaults.
export function borrowBeach(config,settings) {
  const lender=config.beachSources?.[settings.get('beachFrom')];
  if (!lender || config.layers.includes('beach')) return config;
  config.layers=[...config.layers,'beach']; config.material={...config.material,...lender.material}; config.beachTable=lender.table;
  return config;
}
export function addDefaults(settings,defaults={}) { for (const [key,value] of Object.entries(defaults||{})) if (!settings.has(key)) settings.set(key,value); return settings; }
export const pageSettings=(config,search='') => addDefaults(new URLSearchParams(search),config.defaults);
// A world setting the page's address may override (a knob trial in a render's query), else the world's value.
export const worldSetting=(config,settings,key) => settings.has(key)?Number(settings.get(key)):worldDefault(config,key);
// A height image's node (sculpt-gpu-fields.js heightsFields: the samples and where they lie), as a scene, a save and the undo history hold it: its
// fields checked and in one order, so a node saved and loaded again is the same text. `name` starts the error for a node that cannot be drawn.
export const heightsNode=(n,name) => ({kind:'heights',hidden:Boolean(n?.hidden),...heightsFields(n,name)});
// Capture tools rebuild a map from strokes: [kind, [[x,y],...], options], each starting from the brush card's defaults for this world: a shape of
// the library as the world makes it, or another kind. A landform stroke names its shape as its tool (node.tool; the page shows it as the generic
// landform where the world's toolbar lacks it), or one of the map's own tools (`tools`, sculpt-tools.js copyMapTools: a scene's `tools`), which draws
// from its own card. options.card overrides card values (diameter, amount, roughness ... in card units); any other key is a stroke option. Stroke i takes
// the seed + i * 7919; the ground undulation (unless ground is false) comes first, from the page's settings. A river is migrated as a
// drawn one is, over the map. A height image is ['heights', [], {image, bits, width, height, cell, x, y, scale, offset, mode}]: it has no path.
export function sceneNodes(config,list,{ground=true,seed=DEFAULT_SEED,settings=pageSettings(config),tools=[]}={}) {
  const out=[];
  if (ground) { const g=groundDefaults(settings); if (g.amplitude>0) out.push({kind:'ground',...g,seed:seed^0x9e37}); }
  list.forEach(([entry,points,options={}],i) => {
    const own=tools.find(t => t.id===entry),kind=own?'landform':strokeKind(entry);
    if (kind==='heights') { out.push(heightsNode(options,`scene stroke ${i}: the height image`)); return; }
    // A stroke the passes would not draw is an error, not an empty stroke: a section form (mesa, cliff, lfPlateau) is a landform's curve, not a tool.
    if (!DRAWN_KINDS.includes(kind)) throw new Error(`scene stroke ${i}: "${entry}" is not a tool the editor draws (a shape: ${Object.keys(LANDFORM_SHAPES).join(', ')}, or ${DRAWN_KINDS.filter(k => k!=='landform').join(', ')}; a section form goes in the card's curve)`);
    const {card:override,...rest}=options,d={...(own?own.card:toolDefaults(config,entry)),...override},pts=points.map(([x,y]) => ({x,y}));
    const card={...strokeCard(config,d),seed:(seed+i*7919)>>>0};
    const probe={...card,...rest};
    const node={kind,points:pts,params:strokeParams(probe),seed:probe.seed,...(kind==='landform'?{tool:entry}:{})};
    if(isRiver(node.params)){node.params.river={drawn:pts.map(p => ({...p}))};migrateRiver(config,node);}
    out.push(node);
  });
  return out;
}
// A river's path, migrated over the map (or the working field without one).
export const migrateRiver=(config,node) => applyRiver(node,{w:config.map?.width??config.worldSize??config.size,h:config.map?.height??config.worldSize??config.size});

// What the page runs a scene with besides its nodes, so the headless runner runs it the same way.
// The shape engine's context (sculpt-gpu-fields.js): each node's options over the world's, the brush seed, the talus slope, the sea and
// base, the height range the fields clamp to (heightRange), the frost gaps, the coast ramp and the face steepness (world settings the address may
// override; a world without the last two keeps its sections as drawn).
export const heightRange=config => ({minH:config.seaLevel-90,maxH:config.seaLevel+300});
export const shapeContext=({config,settings,seed,talusAngle=40,minH,maxH}) => ({params:n => ({...shapeDefaults(config),...n.params}),seed,repose:Math.tan(talusAngle*Math.PI/180),sea:config.seaLevel,baseHeight:config.baseHeight,minH,maxH,
  frost:{gapSize:worldSetting(config,settings,'frostGapSize'),gapDepth:worldSetting(config,settings,'frostGapDepth'),gaps:worldSetting(config,settings,'frostGaps'),gapReach:worldSetting(config,settings,'frostGapReach')},
  coastRamp:settings.has('coastRamp')||Number.isFinite(Number(config?.defaults?.coastRamp))?worldSetting(config,settings,'coastRamp'):1,
  faceSteep:settings.has('faceSteep')||Number.isFinite(Number(config?.defaults?.faceSteep))?worldSetting(config,settings,'faceSteep'):1});
// The Time pass's knobs (sculpt-erosion.js runGpu), from the renderer's settings: the engine's, the world's, then the address.
export const timeKnobs=renderer => ({age:renderer.variantNumber('erosionAge',200),rain:renderer.variantNumber('erosionRain',1),talusAngle:renderer.variantNumber('talusAngle',40),
  envelope:renderer.variantNumber('erosionEnvelope',2),sand:renderer.variantNumber('sand',0),wetReach:renderer.variantNumber('wetReach',3),talusFull:renderer.variantNumber('talusFull',2.5),wearFull:renderer.variantNumber('wearFull',1.5),flowK:renderer.variantNumber('flowK',30)});
// H5b: the Time pass of a paged map (createPagedFields setTime): the knobs the pass reads, all of them in the key (so a change drops every page's
// weather), and the runner a page's window goes through. `material` is materialKnobs' answer.
export function pagedTime({config,renderer,size,spacing,material}) {
  const p={...timeKnobs(renderer),columnContrast:renderer.variantNumber('columnContrast',1)};
  return {key:JSON.stringify({...p,material,column:config.column,variant:config.variant}),material:Boolean(material),run:async win => {
    const erosion=await erosionOf(renderer);
    const r=await erosion.runGpu({...p,planes:win.planes,masks:win.masks,rateMask:MASK_KEYS.indexOf('ovErosion'),grid:win.grid,size,spacing,seaLevel:config.seaLevel,ox:win.ox,oy:win.oy});
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
// and ?lowColor=5c322a from the address (a light's or the low ground's colors tried on a page without changing the world: renders, review
// sheets), and an edited column's strata.
export function hexColors(colors,settings) {
  const out={...colors};
  for (const key of ['sun','sky','low']) { const q=settings.get(key+'Color'); if (q && /^#?[0-9a-f]{6}$/i.test(q)) out[key]=q.startsWith('#')?q:'#'+q; }
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

// The planes a map's fields hold: the seven authored planes (u: the part of h the art does not show), then the masks.
export const FIELD_KEYS=['h','p','r','c','v','x','u',...MASK_KEYS];
// The shape's repeat check (sculpt.js shapeCompare; repro/shapecheck.mjs): every plane of the whole map, evaluated again, must be the same.
// `settle` resolves once the fields' evaluation is done.
export async function repeatCheck({fields,grid,settle}) {
  const copy=f => ({h:f.h.slice(),p:f.p.slice(),r:f.r.slice(),c:f.c.slice(),v:f.v.slice(),x:f.x.slice(),u:f.u.slice(),masks:MASK_KEYS.map((k,j) => (f.masks?f.masks[j]:f[k]).slice())});
  const all={x0:0,y0:0,x1:grid-1,y1:grid-1},grab=r => ({h:r.fields.h,p:r.fields.p,r:r.fields.r,c:r.fields.c,v:r.fields.v,x:r.fields.x,u:r.fields.u,masks:MASK_KEYS.map(k => r.fields[k])});
  await settle(); const a=copy(grab(fields.readCells(all)));
  fields.changed(); await settle(); const b=copy(grab(fields.readCells(all)));
  return {grid,repeat:comparePlanes(a,b,grid,MASK_KEYS)};
}
// H12b: the regional check of a scene on a map whose fields are paged (gpuPages=force): each quadrant of the map read from the pages against the same
// shape engine run directly over that window; every authored plane must match exactly. Quadrant windows, so each window is a regional run on its own.
// Then the pages' coarse lattice (one height a 16 px cell, which the overview draws) against the whole-map engine's heights at the same cells: the
// same value in every cell. `fields` is the map's paged fields (createPagedFields over `nodes`), `startCoarse` starts their coarse lattice if nothing has yet.
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
      const expected={h:out.floats[0],p:out.floats[1],r:out.floats[2],c:out.floats[3],v:out.floats[4],x:out.floats[5],u:out.floats[6]};
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
      const c=fields.coarseLattice(),whole=(await engine.run(nodes.slice(),ctx,null)).floats[0],step=c.step,w=Math.floor((G-1)/step)+1,p={mismatches:0,maxDifference:0,firstMismatch:null};
      if (c.width!==w) throw new Error('the coarse lattice is not one cell a 16 px height cell');
      for (let j=0;j<w;j++) for (let i=0;i<w;i++) {
        const a=whole[j*step*G+i*step],b=c.heights[j*w+i]; if (a===b && Number.isFinite(b)) continue;
        p.mismatches++; mismatches++; p.maxDifference=Math.max(p.maxDifference,Math.abs(b-a)||Infinity); p.firstMismatch??={cell:j*w+i,engine:a,paged:b};
      }
      planes.coarse=p;
    }
    return {grid:G,planes,mismatches,gpuShape:true};
  } finally { engine.destroy(); }
}
