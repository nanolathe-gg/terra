// Authored terrain appearance experiment. No recovered retail rendering claim.
//
// WGSL port of the former sculpt-common.glsl, shared by the draw
// (sculpt-vert.wgsl, engine-frag.wgsl), the bake (engine-bake.wgsl) and the
// modules that paste it at their COMMON mark (rock runoff, the voxel solid, the Time pass).
// Naming follows the GLSL so a GLSL diff ports line by line:
//  - uniform uFooBar is the field u.fooBar of the one uniform block below
//    (bool uniforms are i32: 0 or 1; the one rename is uDiagnostic, which
//    is u.diagnosticView because diagnostic is a WGSL keyword);
//  - sampler uFoo is the texture fooTex, with fooSamp where it is filtered.
// The renderer (sculpt-renderer.js) reads this struct to lay out its
// uniform buffer, so a new uniform needs only a field here.
// The renderer understands #ifdef NAME / #ifndef NAME / #else / #endif; a module is built with BAKE, EROSION, VOLUME_COMPUTE or VOLUME_RENDER, or none.

// A rock recipe: every number that shapes, colours and weathers one rock (sculpt-rock-presets.js ROCK_KEYS). The uniforms hold a
// table of them (Uniforms.rock); slot 0 is the world's own rock, its flat numbers as every address names them. A point reads the slot
// of the rock it belongs to (rs).
struct Rock {
    shineRock: vec4f,     // the rock row of the shine table: x gloss, y sharpness, z roughness, w roughness scale (px)
    // The recipe's colours: rows 1-5 its beds' material slots (rgb). Row 6 is its absorption colour (rgb; a = 1 when chosen, else the rock's
    // own hue); rows 0 and 7 are free (a rock's own colour is its material's Color).
    rockColors: array<vec4f, 8>,
    strata: f32,          // Strata: how much of the rock and the raised ground takes the column's bed colours
    strataContrast: f32,
    strataGrain: f32,
    // The rock column's tilt (columnOffset): the column's beds, and the strata colours and hardness they give, tilt by bedDip toward bedDipDir.
    bedDip: f32,          // bed tilt, height units per px
    bedDipDir: f32,       // direction the beds tilt down toward, degrees (0 east, 90 south)
    // Rock face: the one model of every rock face (rockFaceAt): beds along the contours with a ledge at each top, joints that cut them
    // into tilted blocks, scratches down the face and grit, all relief, so the sun lights them on any face.
    rockFace: f32,        // strength, 0: none
    rockFaceFrom: f32,    // slope where the face's relief starts (full 0.4 steeper)
    faceBed: f32,         // bed thickness, height units
    faceLedge: f32,       // ledge step, 0..1 of the bed
    faceRun: f32,         // typical unbroken ledge length, px
    faceLean: f32,        // scratches and joints lean from the screen's north-south, degrees
    faceScratch: f32,     // scratch depth, height units
    faceScratchSize: f32, // scratch spacing, px
    faceBlock: f32,       // joint depth and block tilt, height units
    faceBlockSize: f32,   // px between joints along a bed
    faceGrass: f32,       // how strongly grass takes the ledges, 0..1
    faceWear: f32,        // weathering: how far the blocks' edges round off and their partings open (0..1)
    faceLayers: f32,      // the layers' steps under grass (soil-covered terraces), 0: none
    faceMass: f32,        // the face's broad form: bulges and alcoves 30-70 px (0: none)
    faceTone: f32,        // colour variation from block to block
    faceStrata: f32,      // layer tint: each layer a little lighter or darker than the next
    faceWet: f32,         // wet streaks: the runnels and open partings darker
    faceShade: f32,       // how dark the rock face's own shadows and creases go (0: the sky still fills them; 1: black)
    faceRock: f32,        // rock's share of a steep face (the rest grass, in clumps and on ledges); a stroke's Local vegetation scales it
    faceCrease: f32,      // crease depth (fine creases along the contours, the face's grain), height units
    faceCreaseSize: f32,  // crease spacing, px
    runoff: f32,
    runoffScale: f32,
    runoffConcentration: f32,
    runoffCut: f32,
    runoffStain: f32,
    debrisAmount: f32,
    debrisReach: f32,
    debrisDepth: f32,
    faceJointTilt: f32,
    faceScaleVary: f32,
    faceFold: f32,
    faceBedVary: f32,
    bedCycleVary: f32,
    faceBreak: f32,
    faceSpall: f32,
    faceClast: f32,
    faceClastSize: f32,
    faceMineral: f32,
    faceFresh: f32,
    faceRind: f32,
    faceRindDepth: f32,
    faceRindTone: f32,
    faceRindWarmth: f32,
    faceRindRough: f32,
    faceStretch: f32, // Block length / width
    faceBlockHeight: f32, // Block height / layer height
    faceRound: f32, // Rounded blocks
    faceJoint: f32, // Joint depth
    faceJointWidth: f32,
    faceSecondary: f32,
    faceContinuity: f32,
    faceDetailPatch: f32,
    faceWhole: f32, // Whole blocks
    faceWholeLarge: f32, // Whole large blocks
    faceRegular: f32, // Block regularity
    faceExtrude: f32, // Extrusion bias: inset to projecting
    faceLamina: f32, // Fine layer relief
    faceLaminaSize: f32, // Fine layer spacing (height units, 6 to 16)
    faceScratchLength: f32, // Groove length (px)
    faceScratchAngle: f32, // Groove tilt from vertical (deg)
    looseSize: f32,       // px: the median stone diameter
    stoneRound: f32,      // world material data: 0 angular chips .. 1 rounded stones
    stoneSort: f32,       // world material data: 0 a mixed power-law gravel, 1 one size class sorted by the process (talus coarsens outward, fans and channels fine downslope)
    stoneSlab: f32,       // world material data: share of flat slabs
    // The recipe's rock column: its sections are columnSections[columnFirst .. columnFirst + columnCount) of the pool (0 sections: no column;
    // each bed's thickness and strength come from a hash).
    columnFirst: i32,
    columnCount: i32,
    // Where level ground starts to take the recipe's beds, height above the column's origin (writeRocks: the world's first section start for
    // the world's rock; a recipe with its own beds starts above the world's lowest section, so the ground at a stroke's foot keeps the plain's look).
    bedsFrom: f32,
    // Translucent rock (B4; 0 as before): how fast the colour deepens toward the absorption colour with the rock's thickness, and how much of
    // a cast shadow's sun the rock lets through, in its colour.
    absorbDepth: f32,
    shadowTint: f32,
    material: i32,        // its surface material's slot (grain, art height, shine), 0 the world's rock material (u.rockGround)
    pad2: f32,
    pad3: f32,
    // Rock surfaces, per recipe (moved from the world uniforms so a shape's rock can carry them): cracks, contour bands, moon pits,
    // cups, ribs and folds, ice crystal strokes, crests, snow caps, fibres and aprons.
    crackDark: f32,
    crackSeverity: f32,   // crack depth
    crackWidth: f32,      // crack core width, world px
    crackNetwork: f32,    // 0: rills down the slope; 1: polygonal plates
    crackSpacing: f32,    // major crack block size, world px
    banding: f32,         // contour banding strength (0: none)
    crackMinor: f32,      // share of minor cracks inside blocks
    crackHairline: f32,   // share of hairline crazing
    crackBlocks: f32,     // how far blocks step and tilt against each other
    crackMajor: f32,      // share of major cracks
    pockmark: f32,        // dark pits scattered evenly over raised ground and slopes, tops and sides alike (0: none, as before)
    pockSize: f32,        // pit spacing across the retail glint axis, px
    moonCups: f32,        // lit pits, 2-3 px wide and 4-6 px tall, many on shaded steep faces and few on lit ground (0: none; the pockmark dots are separate)
    moonRibs: f32,        // stringy light and dark strokes down steep faces, shaded by the sun (0: none)
    moonFolds: f32,       // thin dark lines that follow the form across lit and moderate slopes (0: none)
    iceCrystal: f32,      // crystal mountains: dark straight strokes in domains across the rock faces (0: none, as before)
    iceCrest: f32,        // crystal mountains: share of the raised ground under snow-white lumps (0: none)
    iceSnow: f32,         // the flat tops of raised ice lie under snow (0: none)
    iceFall: f32,         // smooth fibres down the faces of raised ice, in place of grain (0: none)
    iceApron: f32,        // dark hatched drifts spilling past the foot of raised ice into the snow (0: none)
    moonCupSize: f32,     // pit spacing across the glint axis, px (the cell is 1.5 times that along it)
    moonCupDepth: f32,    // pit depth in height units: how steep its walls shade
    cupStretch: f32,      // cups drawn out along the glint axis into strokes this many times their length and narrower, each turned a little its own way (1: the pits, as before)
    moonRibDepth: f32,    // stroke steepness: the gradient the strokes add (1: about 0.8 at their steepest)
    moonRibDark: f32,     // how much darker the strokes' mean is on faces turned from the sun (0: the face's own shade)
    moonFoldSpacing: f32, // height units between the folds' first set of contours
    rockCrown: f32,
    gougeWeb: f32,        // 0..1: a bold web of long dark gouges across raised crystal, round cells about 42 px (0: none)
}

// Absolute ground recipes; the cache holds height and unlit color parameters.
// A material slot as the terrain reads it: where its cached repeat lies and the game-palette colors it is reduced to.
struct Ground {
    cacheLayer: i32,       // the material's layer of the cached repeat (color and height, shine), -1 when the slot is empty
    colorLayer: i32,       // its layer of the palette-reduced color
    paletteCount: i32,
    dither: f32,           // 0 leaves the color continuous; 1 is the full palette reduction
    spread: f32,           // how the diffusion shares its error: 0 Floyd-Steinberg, 1 a wider kernel
    tone: f32,             // the gamma colors are compared in
    wornLayer: i32,        // the layer of its Worn color (cached and reduced like its own), -1 when it has none
    depositLayer: i32,     // the layer of its Deposit color, -1 when it has none
    weights: vec4f,        // how much a red, green or blue difference counts when a palette color is chosen
    states: vec4f,         // Worn from, Worn amount, Deposit from, Deposit amount (the Material node's)
    finish: vec4f,         // x its Relief (px: the most its art height reaches); yzw free
    palette: array<vec4f, 32>,
}
// One node of a material graph (sculpt-materials.js compileMaterial).
struct MaterialStep {
 code:vec4i, // node type, enabled, kind, color output
 links:vec4i, // the nodes its inputs read, -1 when open
 args:array<vec4f,16>,
}
struct MaterialGraph {
    program: vec4i, // node count
    steps: array<MaterialStep,40>,
}

struct Uniforms {
    crystalGrain: f32,    // crystal tops: 0 the slope cover's art, 1 the level ground's
    crystalFace: f32,     // crystal side-face colour, times crystal colour x 0.38 (1: as before)
    crystalTone: f32,     // crystal top brightness (1: as before)
    // Shared by the draw and the bake.
    grid: f32,
    size: f32,
    base: f32,
    sea: f32,
    pool: f32,             // card tilepool: level ground repeats every pool px (a multiple of 512), so its 32-px tiles come from (pool / 32)^2
    materialWeathering: f32,
    materialReady: i32,
    detail: f32,
    light: vec3f,
    // Draw (engine-frag.wgsl).
    riverBed: vec4f,       // riverfix: the braided bed's gravel colour (materials/<world>.json water.riverBedRGB), a = 1 when the world gives one
    clay: i32,
    slopeMaterial: i32,
    mineralMargins: i32,
    quantize: i32,
    diagnosticView: i32,   // GLSL uDiagnostic (diagnostic is a WGSL keyword)
    surfacePreview: i32,  // the row of the surface layer the Surface section previews (diagnostic view 13), -1 none
    faceFill: f32,
    slopeProfile: vec4f,
    elevatedCover: vec3f,
    slopeOnLowBanks: i32,
    rampMaterial: f32,
    groundFringe: i32,
    ringAmount: f32,
    ringSpread: f32,
    ringVariation: f32,
    fringeSignal: vec4f,
    fringeRange: vec2f,
    transitionBody: i32,
    // The shallows' tint: a tone, a shift of the water material's mean (a = 1 where the world chose its own, else its data's).
    shallowTone: vec4f,
    beach: i32,
    waterMid: vec4f,   // rgb the mid-depth colour's tone on the water material's mean, a: its depth (0: two stops)
    beachHeight: f32,
    beachWidth: f32,
    slopeSand: i32,
    grassSlopes: i32,     // 1 where the world's slopes are grass: Joined wrinkles (u.wrinkles) then draw terracettes in the bake, not Moon's dark lines in the draw
    shoreEdge: f32,   // lava coast rim, outline and lip (0: none)
    // Crystals: their own colour (world base colour 'crystal', else the world's).
    sandDust: f32,
    sandGrass: f32,
    highland: f32,      // Highland ground: how far level raised ground takes the world's highland material (0: none)
    highFrom: f32,      // the rise above the plain where the highland material starts
    highReach: f32,     // the rise over which it comes in fully
    transitionDetail: f32,
    wetBand: f32,
    shallowDepth: f32,
    deepDepth: f32,
    lightCap: f32,
    shadeDepth: f32,      // share of the directional shading kept (1: all)
    ambient: f32,       // unlit share of the light (0.42; Moon lower: no sky)
    slopeMarks: f32,    // Moon: density of crisp dark marks on slopes (0: none)
    sandCrown: f32,     // painted sand stays sand to the crown, no rock (Zhon sand bars)
    flatBank: f32,        // low dry banks lit as level ground, no wet band (0: off)
    sandLight: f32,
    sandEdge: f32,
    flatShadow: f32,
    flatOcclusion: f32,
    slopeTexture: f32,
    waterSoft: f32,
    crispShore: f32,
    bankRock: f32,
    // Bake (engine-bake.wgsl).
    reliefScale: f32,     // wavelength of the first octave, world px
    reliefAmount: f32,    // height per unit slope per wavelength
    reliefLumps: f32,     // share of isotropic lumps mixed in
    reliefGain: f32,      // amplitude ratio between octaves
    reliefWarp: f32,      // domain warp, world px
    reliefPatchy: f32,    // spatial variation of relief strength
    faceStreak: f32,      // 0: ribs down steep faces; 1: ledges along the contours
    faceStreakFrom: f32,  // slope where the turn toward the contours starts
    gentleRelief: f32,    // relief on gentle slopes
    sand: f32,            // 0 disables sand
    plainRelief: f32,     // faint lit lumps on level ground (appearance only)
    windAngle: f32,       // direction the wind blows toward, degrees (0 = east)
    ripple: f32,          // ripple wavelength, world px (0: none)
    rippleHeight: f32,    // ripple amplitude, height units
    beachDistance: f32,   // beach reach from the waterline, world px (0: none)
    hasBeach: i32,        // the world has beach-sand art: painted sand uses it
    sandBanding: f32,     // streaks on sand and ramps
    sandBandSpacing: f32,
    apron: f32,           // sand apron reach round raised ground, world px (0: none)
    worms: f32,           // wormy regolith relief on slopes (lunar)
    bandSpacing: f32,     // height between bands, height units (the column block's `bands`)
    bandSoftness: f32,    // share of each band that is riser
    bandLine: f32,        // darkness of the line along each riser (the column block's `bands`)
    bandJag: f32,         // pixel-scale wiggle of the band lines, in band steps (0: smooth)
    bandFade: f32,        // slope where bands are gone (they fade from 0.35/0.75 of it)
    sun: vec3f,           // the renderer's light, for lit crack walls
    crystalInk: f32,      // crystal outlines: 0 soft 92% dark, 1 crisp pure black
    // Painted masks (card C5).
    paintOn: i32,         // 1 once any cell carries a painted mask; 0 skips every read of masksTex
    rockIdOn: i32,        // 1 once any cell of the chunk belongs to a rock other than the world's own (mask plane 20); 0: every point is slot 0
    scatterOn: i32,       // 1 once any cell carries a painted scatter density (the bake's stones read it)
    overrideOn: i32,      // 1 once any cell carries an H3 override (planes 14-17: erosion, deposits, vegetation, rock exposure)
    styleOn: i32,         // 1 once any cell carries a painted local style (relief, cracks, banding, face rock share)
    // Moon joined wrinkles (card B3).
    wrinkles: f32,        // how much of the slope the connected wrinkle lines cover (0: none)
    // Crystal shore slabs (card C2).
    crystalSeam: f32,     // submerged crystal-field cells: 1 paints the seam marks dark and the slab fill paler (0: water as before)
    // Shine and roughness (card E2): a specular lobe and micro-normal grain per
    // material, added to the lit colour before the palette stage (0: none).
    shineOn: i32,         // 1 once any material has gloss or roughness; 0 skips every shine read
    shineStretch: f32,    // micro-normal grain length along its axis, times its width (1: round)
    shineWhite: f32,      // highlight colour: 0 the material's own hue at full brightness, 1 white
    // Per material (ground, slope cover, rock, sand, crystal): x gloss, y sharpness
    // (Blinn exponent), z roughness (normal slope amplitude), w roughness scale, px. The rock's row is its recipe's (Rock.shineRock); row 2 is unused.
    shine: array<vec4f, 5>,
    rock: array<Rock, 16>,   // the rock recipes by slot (struct Rock); slot 0 is the world's own rock
    rimReach: f32,        // bare rock at rims: how far in from a drop the soil thins, px (0 none)
    shadowTintAny: f32,   // the largest Tinted shadow of the rocks in use (writeRocks): a cast shadow's occluder may be any of them
    rockWeatherGrid: vec4f, // origin in art pixels, texture dimensions; 4px cells
    // Over the rock slots in use (sculpt-renderer.js writeRocks): whether any sheds debris or runs off, and the farthest rockfall reach. The passes
    // that gather from other points read these, and each source's own numbers from its slot.
    debrisAny: f32,
    runoffAny: f32,
    debrisReachMax: f32,
    sandLee: f32, // Wind drifts: sand in the lee of rises
    groundPatch: f32, // Ground patches: tone variation on level ground
    groundPatchSize: f32, // Patch size (px)
    shoreRock: f32,       // rock at shores: how far inland from the waterline the ground is bare rock, px (0 none)
    shoreShelf: f32,      // rock at shores: how far out under the water the bed is the same rock, px (0 none)
    // Water looks (card E1). Defaults reproduce the earlier water exactly.
    bedTint: f32,         // how far the tint replaces the bed's own colour (0: bed only; 1: the tint, lit by the bed)
    bedRelief: f32,       // bed lumps (bake): faint embossed relief under shallow water, 0: none
    bedCracks: f32,       // cracked bed: how dark the dried-mud polygon seams under shallow water are, 0: none
    bedCrackSize: f32,    // cracked bed: the polygons' typical width, px
    deepEdge: f32,        // shallow-to-deep step: 0 the depth ramp, 1 a hard step with ragged stairs
    waterOn: i32,         // 1 once any cell carries a painted water shore or edge choice (planes 9-10) or a Surf (plane 18)
    lumpOn: i32,          // 1 once any cell carries painted ground lumps (plane 12)
    lumpRelief: f32,      // height of a fully painted lump field, in the units of plainRelief
    bedBright: f32,       // brightness of the tinted bed (1: the tint as it is)
    bedContrast: f32,     // how much of the bed's light carries through the tint (1: all, 0: flat tint)
    hillLight: f32,       // brightness of the hill cover's material (Archipelago; 1: as drawn)
    ringFade: f32,        // how gradually the mineral ring fades out from the hill (0: as drawn; Archipelago)
    // Ice (card E5).
    shadeBlue: f32,       // shaded ice keeps its blue: how far the blue (and a little green) stay lit as the light falls (0: grey shade, as before)
    // Light colour (card P12b). White leaves the light grey, as before.
    sunColor: vec3f,      // the direct light's colour: multiplies the sun's share of the light, and the glints that mirror it
    skyColor: vec3f,      // the ambient light's colour: multiplies the sky's share (what the shade keeps)
    frostWet: f32,        // Ice frost band: how far cells it marks (protection above 0.02) skip the wet-band darkening above the waterline (0: as before)
    // E7 (Crystal).
    crystalShallow: f32,   // shallow water: how strongly it carries a mosaic of small crystal cells (0: as before)
    crystalShallowPx: f32, // width of those cells, px
    // G7 (Crystal craters).
    crystalCraterWeb: f32,     // crater skin (crystal mark .74): how dark the web of thin lines between them is drawn (0: no web)
    crystalCraterWebPx: f32,   // width of the web's cells, px
    crystalCraterWobble: f32,  // how far the web's lines wander off straight, px
    crystalCraterGap: f32,     // share of the web's lines left out
    crystalCraterTone: f32,    // cell-to-cell brightness variation (0: one tone)
    crystalCraterLight: f32,   // how much stronger the crater wall's light and shade run than the sun gives (1: as the sun gives)
    crystalSeamEnd: f32,       // the field value where a seam's ink has faded out (0.74 as before; lower draws thinner seams)
    crystalShallowInk: f32,    // shallow cells' seam ink (0.55 as before)
    crystalShallowAll: f32,    // how far the mosaic covers shallow water away from slabs too (0: only a fringe round the slabs, as before)
    // E8 (Painted Desert)
    baseBand: f32,         // the grey band at the foot of the raised ground (strata colour 5): its strength, 0 off
    baseBandLow: f32,      // lower edge of its height window, above the plain
    baseBandHigh: f32,     // upper edge
    baseBandWander: f32,   // how far the window drifts with position, height units
    baseBandGaps: f32,     // share of the band's length that is missing
    // G4 (Painted Desert)
    desertCapFlat: f32,    // how far level ground in a cap zone (share over .9) stays the cool bed (0: the beds as before)
    // E9 (Green rock faces).
    shineOutside: f32,    // share of the rock's glints kept outside painted rock (1: everywhere, as the shine model gives them)
    // E11: shallow water round 2 (Green, Red) and Archipelago's fringe. Every default is the earlier look.
    shelfWander: f32,     // Green, Red: how far broad noise moves the step's depth, in depth units (0: the step follows the shore)
    stepSoftPx: f32,      // Archipelago's reef bars: the true-threshold step's ramp width in px (1: a one-pixel edge, as Green and Red)
    ringContrast: f32,    // Archipelago: contour lines in the red fringe, following the hill's outline (0: none)
    ringCount: f32,       // how many lines the fringe carries from its inner to its outer edge
    ringSize: f32,        // how far out the lines reach, against the fringe's own reach (1: as far as the ring's texture)
    bedFlat: f32,         // the lit bed takes only the bed's own relief for its light, not its slope's (0: the pixel's full shading, as before)
    // E10 (Lava).
    layerCrease: f32,     // dark crease at the foot of each step of the banks between the sea and the plain, whatever its facing (0: none)
    shineSlopeGate: f32,       // slope at which the shine reaches full strength; below a third of it there is none (0: shine is not gated by slope)
    // G5 (Lava).
    lavaCrust: f32,       // hill rock as pillows, chips and creases on raised ground (0: none, as before; 1: full)
    lavaPillow: f32,      // size of a pillow, px
    lavaChip: f32,        // size of a chip, px
    lavaVeins: f32,       // darkness of the veins that hang down the fall line (0: none)
    lavaCalm: f32,        // share of the fall-line relief the crust replaces on hills
    lavaDusk: f32,        // rock turned from the sun goes darker, as a power of its shading (0: none)
    // E6 (shine fix: Moon, Ice).
    shineGate: f32,       // shine roughness only on raised ground and slopes, not the level plain (0: everywhere, as before; 1: only there)
    shineHeadroom: f32,   // dim the lit body where the lobe is low, so glints stand against it on near-white ice (0: additive only, as before)
    // E6 (Moon).
    // G8 (Moon): the surface read from retail pictures.
    // E6 (Ice mountains).
    // G3 (Archipelago rings): the fringe as stacked, offset copies of the hill's outline. Every default is the earlier look.
    ringShift: f32,       // px each copy sits from the hill's own outline (0: the earlier concentric lines; ringCount copies otherwise)
    ringShiftDir: f32,    // degrees the copies drift towards on average, clockwise from east in the world (90: south)
    ringScatter: f32,     // how far each copy's direction wanders from that mean, as a share of a half turn
    ringWobble: f32,      // px of waver in each copy's outline: lobes with inward cusps, the scalloped look (0: smooth)
    ringLobe: f32,        // px across one lobe
    ringFill: f32,        // the pale tint where every copy overlaps; each copy adds its share, so the skirt steps lighter outward (0: none)
    ringPatchSize: f32,   // px over which that reach varies
    // G6 (Ice blocks and mesas, retail ice-3 and Polar Range).
    iceSoft: f32,         // raised ice is lit by its height blurred over ~13 px, so crests are rounded and faces smooth (0: the full relief lights it, as before)
    iceFrost: f32,        // Ice frost band: fine dark-blue hairlines in parallel runs, thinning inland (0: none)
    // G1 (shallow water round 3: Green, Red, Archipelago). Every default is the earlier look.
    shoalRag: f32,        // the shallow-to-deep step's outline: pixel notches of up to this many px, whatever the bed's slope (0: as before)
    shoalShoreSoft: f32,  // Archipelago: the waterline the world draws (a stroke's Hard and Faded stay) is a dithered blend this many px wide (0: a clean line)
    // Low ground (Zhon's mud lowland): the ground from the sea up to lowReach above it, and the shallows, keep lowGrain of their grain.
    lowReach: f32,        // height above the sea where low ground ends (its ragged edge fades over the upper half)
    lowGrain: f32,        // 0..1: the share of its grain the low ground's pattern and the water's art and mottle keep (1: as drawn)
    soilRim: f32,         // 0..1: bare soil where the plant cover thins against rock, and a ragged line (not a blend) for rock's edge off the faces (0: as before)
    wetGround: f32,       // 0..1: ground that water wets (the band above a waterline, hollows and channels, runoff off rock) is darker, more saturated and glossy (0: as before)
    boulders: f32,        // 0..1: blocks fallen from a wall and lying under it, up to 60 px and more across (0: none; the runout blocks as before)
    creaseShade: f32,     // 0..1: how much light a crease (a gully or valley floor, the authored height below its rings 6 and 12 px out) loses, whatever its facing (0: none)
    // H1 (lit relief, Green). Every default is the earlier look.
    closeShadow: f32,     // how much a ledge 1-6 px toward the sun darkens the direct light on the ground behind it, 0..1 (0: only the far taps)
    cavity: f32,          // how much a crevice or crack floor (surface below the mean of a ring 1-3 px out) loses of its ambient light, 0..1 (its direct light loses .45 of that; 0: off)
    // H2, H16 (the rock column of a world's table, `column` in materials/<world>.json). Every default is the earlier look.
    columnContrast: f32,  // how much harder the hard beds are: erosion wears them 1 / (1 + 15 * this) as fast (0: all beds alike)
    columnOrigin: f32,    // the height the coordinate counts from (the plain's, or 0)
    // The rock columns of every recipe in one pool (a recipe's columnFirst and columnCount name its sections; a section names its beds).
    columnBeds: array<vec4f, 128>,      // per bed: x thickness (height units), y hardness 0..1, z material slot, w unused
    columnSections: array<vec4f, 32>,   // per section, from low to high: x the coordinate it starts at, y its first bed, z its bed count, w its period
    columnWander: f32,    // the wander the coordinate takes from value noise: its amplitude, height units
    columnTerrain: vec4f, // the wander it takes from three octaves of the terrain noise (height units): xyz their amplitudes (not in the Time pass)
    materialTable: array<vec4f, 206>,   // Green (H3 materialModel): four materials of 39 rows then six placement rows, from materials/green.json (material-model.wgsl); then from MM_COVER the world's site rows and the plants' rows (sculpt-material-model.js coverRows)
    weatherMaps: f32,     // H5: 1 when gridTex layers 2 and 3 hold the Time pass's maps (engine-weather.wgsl)
    // H5 item 3a, Green's retail marks (0: off). They read the Time pass's maps, so age, rain and hardness contrast move them.
    terraceBreak: f32,    // how far the terrace lines' phase wanders (band spacings), more where the ground is wet
    terraceCalm: f32,     // 0..1: terrace lines faded on gentle slopes (the small dashes retail does not have)
    wetSwath: f32,        // darkness of the soft swaths water leaves on grass along its flow; with a ground-cover table it is also Moisture (card P30)
    lushness: f32,        // card P30: -1..1, the world-wide baseline of the painted Vegetation override (0: none); a ground-cover table reads it as succession
    // H5 item 3b, beyond retail (0: off for Green).
    rillDepth: f32,       // height units a rill is cut, along the flow
    rillSpacing: f32,     // px between rills
    // Card P16: the one loose-material scatter (looseStones in engine-bake). Supply 0 draws none.
    looseSupply: f32,     // 0..1: ground share the stones cover where their source is full (1 is about half the ground)
    looseGrid: vec4f,     // the loose-stone mask lattice: first cell (x, y) and cell counts (z, w), cells of 4 world px (looseMain)
    plantsOn: f32,        // card P31: 1 when the world's ground-cover table has plants (its last row): the plant families of looseStones, which share the loose mask
    stoneMoss: f32,       // world material data: share of stones with a mossy cap
    // Card D: bounded regional fields, with every position on the world lattice.
    chunkGridOrigin: vec2f,   // first uploaded sample's global grid index
    chunkGridSize: vec2f,     // regional texture dimensions
    chunkGridCount: vec2f,    // supplied samples (padding repeats their last row/column)
    chunkFieldsOrigin: vec2f, // integer world pixel at baked texel (0,0)
    chunkFieldsSize: vec2f,
    chunkScreenOrigin: vec2f, // preview screen pixels; export adds floor(base/2)
    chunkScale: f32,          // World pixels per raster texel.
    chunkFieldScale: f32,     // Relief bake spacing, independent of color sampling.
    groundIdOn: i32,
    groundDefault: i32,
    highGround: i32,    // the map's highland material slot (sculpt-materials.js worldHigh), -1 none
    rockGround: i32,    // the world's rock material slot (worldRock): what a rock type with material 0 shows, -1 none
    slopeGround: i32,   // the map's slope cover material slot (worldSlope), -1 none: slopes, moss and the margins' face read it
    debrisGround: i32,  // its debris material (worldDebris): the fragments of loose stone and sand
    beachGround: i32,   // its beach material (worldBeach): the beach sand (the slope cover's grain recolored where there is none)
    fringeGround: i32,  // its mineral margins' fringe, body and ring materials (worldFringe, worldBody, worldRing)
    bodyGround: i32,
    ringGround: i32,
    crystalGround: i32, // its crystal material (worldCrystal): the crystals' color, -1 none (then the rock material's)
    waterGround: i32,
    groundAny: i32,
    groundShine: i32,      // 1 when a material in use puts out shine, so the shine pass runs for it
    ground: array<Ground, 32>,
}

@group(0) @binding(0) var<uniform> u: Uniforms;
// The rock slot of the point being evaluated; 0, the world's own rock, until a pass sets it. Every read is u.rock[rs & rockMask].
var<private> rs: u32 = 0u;
// The slots a pipeline can read: 0 while the world's own rock is the only one in use, 15 otherwise (sculpt-gates.js gateValues). At 0 every
// read is slot 0's at a fixed offset, the code a single uniform's read compiles to: read through rs alone, the draw moved 1 to 2 palette
// pixels of 34 scenes. Modules built without the renderer's constants read every slot. Accepted (2026-11-11): once a
// map uses a second rock the pipelines read any slot, and 6.7% of green-modern-2's pixels step by a palette entry where every point is still slot 0
// (heights identical, the same by eye, the same bytes every time; repro/rock-slots.mjs).
override rockMask: u32 = 15u;
var<private> gs: u32 = 0u;
override groundMask: u32 = 31u;

fn cellHash(c: vec2f) -> vec2f {
    let q = vec2f(dot(c, vec2f(127.1, 311.7)), dot(c, vec2f(269.5, 183.3)));
    return fract(sin(q) * 43758.5453);
}

fn valueNoise(q: vec2f) -> f32 {
    let c = floor(q);
    let f = fract(q);
    let fade = f * f * (3.0 - 2.0 * f);   // GLSL: u
    let a = cellHash(c).x;
    let b = cellHash(c + vec2f(1.0, 0.0)).x;
    let d = cellHash(c + vec2f(0.0, 1.0)).x;
    let e = cellHash(c + vec2f(1.0, 1.0)).x;
    return mix(mix(a, b, fade.x), mix(d, e, fade.x), fade.y) * 2.0 - 1.0;
}

// Card tilepool: TA stores a map's art as 32-px tiles and can index 65,536 of them; retail maps use a few thousand, because level
// ground repeats its tiles. Here level ground repeats with the world's pool period (u.pool px, a multiple of 512, so the 512-px noise
// texture repeats with it): the fine detail a plain carries (lumps, grain and specks, cover patches, plants, the dither) is hashed on
// lattices whose coordinates wrap with the period, so a level plain is made of (pool / 32)^2 tiles at most and joins without seams
// (the pattern is continuous; it only repeats). A lattice of spacing s px has poolCells(s) cells a period, so s is rounded to
// pool / poolCells(s).
fn poolCells(s: f32) -> f32 { return max(1.0, round(u.pool / s)); }
fn poolWrap(c: vec2f, n: f32) -> vec2f { return c - n * floor(c / n); }
// The position within its period. The fields of level ground are evaluated here rather than at p: p and p + pool then give the same
// numbers to the last bit (p * s at a map's coordinates rounds differently a period apart, which flipped plants and palette pixels).
fn poolPos(p: vec2f) -> vec2f { return p - u.pool * floor(p / u.pool); }
// The pixel's lattice coordinate (1 px cells), wrapped: the per-pixel hashes of level ground read it in place of floor(p).
fn poolPixel(p: vec2f) -> vec2f { return poolWrap(floor(p), u.pool); }
// A pseudo-random permutation of 0..n-1: a bijection on the next power of two (odd multiplies, xor-shifts and a key), walked until it
// lands below n.
fn poolPerm(x: u32, n: u32, key: u32) -> u32 {
    let bits = firstLeadingBit(max(n, 2u) - 1u) + 1u;
    let mask = (1u << bits) - 1u;
    let half = max(1u, bits / 2u);
    var v = x;
    for (var k = 0; k < 24; k++) {
        v = (v * 0x2c1b3c6du + key) & mask; v ^= v >> half; v = (v * 0x297a2d39u) & mask; v ^= v >> half;
        if (v < n) { break; }
    }
    return min(v, n - 1u);
}
// A cell's index on a lattice of n cells a period: a Latin square, so every row and every column of the period holds each of the n
// indices once. Scattered features drawn from it (the plants, the flowers' dots) come in the same numbers in every row and column of a
// repeat; hashed by the cell, their chance excesses stacked into stripes a period apart at overview. salt keeps two lattices apart.
fn poolIndex(c: vec2f, n: f32, salt: u32) -> u32 {
    let w = vec2u(poolWrap(c, n));
    let m = u32(n);
    return (w.x + poolPerm(w.y, m, salt ^ 0x2b7du)) % m;   // row j turned by a shuffled offset; what is drawn from it hashes the index
}
// Anything drawn from a cell's Latin index alone (a scattered feature's place, size, tone, whether it is there) comes in the same
// numbers in every row and column of a repeat: a hash of the index stands in for a hash of the cell.
fn poolCellHash(c: vec2f, n: f32, salt: u32) -> vec2f { return cellHash(vec2f(f32(poolIndex(c, n, salt)), f32(salt & 0xffffu))); }
// valueNoise on a lattice of n cells a period (q in cells). Its lattice is hashed, not balanced: the noise fields' share of the banding
// at overview was small (modern Green's row range 0.77 -> 0.73 balanced) and a balanced lattice cost the relief bake a fifth more.
fn wrapNoise(q: vec2f, n: f32) -> f32 {
    let c = floor(q);
    let f = fract(q);
    let fade = f * f * (3.0 - 2.0 * f);
    let a = cellHash(poolWrap(c, n)).x;
    let b = cellHash(poolWrap(c + vec2f(1.0, 0.0), n)).x;
    let d = cellHash(poolWrap(c + vec2f(0.0, 1.0), n)).x;
    let e = cellHash(poolWrap(c + vec2f(1.0, 1.0), n)).x;
    return mix(mix(a, b, fade.x), mix(d, e, fade.x), fade.y) * 2.0 - 1.0;
}
// valueNoise(p / s + o) with the period's lattice: the same field at a scale rounded to a divisor of the period.
fn poolNoise(p: vec2f, s: f32, o: f32) -> f32 { let n = poolCells(s); return wrapNoise(poolPos(p) * (n / u.pool) + o, n); }
// A terrainNoise(p * m) frequency rounded so that the 512-px noise texture repeats with the pool.
fn poolScale(m: f32) -> f32 { let k = u.pool / 512.0; return max(1.0, round(m * k)) / k; }

fn rockFaceGate(slope:f32,paintRock:f32,route:f32)->f32 {
    return max(smoothstep(u.rock[rs & rockMask].rockFaceFrom,u.rock[rs & rockMask].rockFaceFrom+.4,slope),smoothstep(.1,.6,paintRock))*(1.0-route);
}

// H2 rock column: the bed coordinate, in height units, at world point p for a
// rock surface at height z. The draw (the strata colours) and the erosion and weather passes (a bed's hardness) read it
// with the surface height they hold, so it depends only on (p, z). columnOffset is the part that depends on p alone (the
// erosion pass caches it): the tilt (bedDip toward bedDipDir) and the broad wander.
fn columnOffset(p: vec2f) -> f32 {
    let a = radians(u.rock[rs & rockMask].bedDipDir);
    var offset = u.rock[rs & rockMask].bedDip * dot(p, vec2f(cos(a), sin(a)));
    let S = u.columnWander;
    if (S != 0.0) { offset += valueNoise(p / 110.0 + 3.1) * S * 0.8 + valueNoise(p / 34.0 + 8.2) * S * 0.3 + valueNoise(p / 9.0 + 2.7) * S * 0.1; }
#ifndef EROSION
    // Painted Desert's beds meander broadly and wander about a unit at 5-25 px: three octaves of the terrain noise. The Time pass
    // has no noise texture, and a world that draws this has no hardness for it to read.
    if (u.columnTerrain.x != 0.0 || u.columnTerrain.y != 0.0 || u.columnTerrain.z != 0.0) {
        offset += (terrainNoise(p * 0.08 + vec2f(5.0, 9.0)).r - 0.5) * u.columnTerrain.x
                + (terrainNoise(p * 0.7 + vec2f(17.0, 2.0)).g - 0.5) * u.columnTerrain.y
                + (terrainNoise(p * 2.1 + vec2f(3.0, 41.0)).b - 0.5) * u.columnTerrain.z;
    }
#endif
    return offset;
}
fn columnCoord(p: vec2f, z: f32) -> f32 { return z - u.columnOrigin + columnOffset(p); }

// The bed's running index, hardness, material slot, how far through it c lies, its thickness, its place j among the section's n beds
// (first: the section's first bed in columnBeds), the cycle's period, and a two-bed section's wider bed: its share of the cycle and its slot.
struct ColumnBed { index: f32, hardness: f32, slot: f32, through: f32, thick: f32, period: f32, widest: f32, widestSlot: f32, first: i32, j: i32, n: i32 }

fn columnCycleHash(k: f32) -> f32 { return fract(sin(k * 91.7 + 13.1) * 43758.5453); }

// The bed at coordinate c: its running index (unique along the whole column, so
// hashes keyed on it differ from cycle to cycle), hardness 0..1, how far through the bed
// c lies (0 at its foot, 1 at its top) and its thickness. The column is a list of sections from low to high; each repeats its
// beds upward from coordinate 0, and the one whose start c has passed (the lowest, below them all) is the one that answers.
// Section s of the recipe's column (s counts from its lowest).
fn columnSection(s: i32) -> vec4f { return u.columnSections[u.rock[rs & rockMask].columnFirst + s]; }
fn columnSectionAt(c: f32) -> i32 {
    var s = 0;
    for (var i = 1; i < u.rock[rs & rockMask].columnCount; i++) { if (c >= columnSection(i).x) { s = i; } }
    return s;
}
// Section s at coordinate c. A two-bed section's second bed has a share of the cycle (the period stays the section's): where the next
// section has the same two slots the share runs toward the next one's between their starts, and retail Painted Desert's beds vary from
// cycle to cycle (measured on the retail map), so a hash of the cycle scales it by .55 to 1.45.
fn columnBedIn(c: f32, s: i32, variation: f32) -> ColumnBed {
    let sec = columnSection(s);
    let first = i32(sec.y);
    let n = i32(sec.z);
    let period = sec.w;
    let cycle = floor(c / period);
    let r = c - cycle * period;
    var bed: ColumnBed;
    bed.period = period;
    bed.first = first;
    bed.n = n;
    var second = 0.0;
    if (n == 2) {
        var share = u.columnBeds[first + 1].x / period;
        if (s + 1 < u.rock[rs & rockMask].columnCount) {
            let nx = columnSection(s + 1);
            let next = i32(nx.y);
            if (nx.z == 2.0 && u.columnBeds[next].z == u.columnBeds[first].z && u.columnBeds[next + 1].z == u.columnBeds[first + 1].z) {
                share = mix(share, u.columnBeds[next + 1].x / nx.w, clamp((c - sec.x) / max(nx.x - sec.x, 0.1), 0.0, 1.0));
            }
        }
        bed.widest = max(share, 1.0 - share);
        bed.widestSlot = u.columnBeds[first + select(0, 1, share > 0.5)].z;
        second = period * clamp(share * (0.55 + 0.9 * columnCycleHash(cycle + 0.37) + (variation-1.0)*(0.9*columnCycleHash(cycle+.37)-.45)), 0.03, 0.97);
    }
    // More than two beds vary independently, normalized back to the authored
    // repeat length. Thickness, order and material slots stay the same table.
    var variedTotal=period;
    if(n>2&&variation>0.0){
        variedTotal=0.0;
        for(var i=0;i<n;i++){variedTotal+=u.columnBeds[first+i].x*(1.0+variation*(columnCycleHash(cycle*17.0+f32(i)*3.7)-.5)*1.6);}
    }
    var lo = 0.0;
    for (var i = 0; i < n; i++) {
        var t = u.columnBeds[first + i].x;
        if (n == 2) { t = select(period - second, second, i == 1); }
        if(n>2&&variation>0.0){t*= (1.0+variation*(columnCycleHash(cycle*17.0+f32(i)*3.7)-.5)*1.6)*period/variedTotal;}
        if (r < lo + t || i == n - 1) {
            bed.index = cycle * f32(n) + f32(i);
            bed.hardness = u.columnBeds[first + i].y;
            bed.slot = u.columnBeds[first + i].z;
            bed.through = clamp((r - lo) / t, 0.0, 1.0);
            bed.thick = t;
            bed.j = i;
            return bed;
        }
        lo += t;
    }
    return bed;
}
fn columnAt(c: f32) -> ColumnBed { return columnBedIn(c, columnSectionAt(c), select(0.0,1.0,columnSection(columnSectionAt(c)).z==2.0)); }
#ifndef EROSION
@group(0) @binding(1) var heightTex: texture_2d<f32>;   // r32float, read with textureLoad
@group(0) @binding(2) var noiseTex: texture_2d<f32>;
// Grid-resolution inputs in one array texture (a fragment stage may sample 16
// textures): layer 0 the Time pass's flow, deposit, talus, sand; layer
// 1 the material field; layers 2 and 3 its maps. Read through weatherAt, materialFieldAt, timeMap2 and timeMap3.
@group(0) @binding(4) var gridTex: texture_2d_array<f32>;
#ifdef BAKE
@group(0) @binding(6) var routesTex: texture_2d<f32>;
#else
// World-resolution fields baked once per height change: r relief height,
// g route protection, (negative) beach or 2 + crystal, b crack/line code,
// a sand.
@group(0) @binding(6) var fieldsTex: texture_2d<f32>;
#endif
// The world fields (height, routes, fields, grid inputs) are
// clamped and linearly filtered; noise repeats.
@group(0) @binding(10) var rockWeatherTex: texture_2d<f32>;
@group(0) @binding(11) var rockSourceTex: texture_2d<f32>;
@group(0) @binding(12) var rockRimTex: texture_2d<f32>;
@group(0) @binding(14) var groundColorTex: texture_2d_array<f32>;
@group(0) @binding(15) var<storage,read> materialGraphs:array<MaterialGraph>;
@group(0) @binding(16) var materialHeightTex:texture_2d_array<f32>;   // a material's art height (r32float)
@group(0) @binding(17) var materialMeanTex:texture_2d_array<f32>;   // one texel a material: the mean color of its repeat
@group(0) @binding(13) var groundTex: texture_2d_array<f32>;   // a material's unlit color and shine (rgba16float)
@group(0) @binding(7) var linearClamp: sampler;
@group(0) @binding(8) var linearRepeat: sampler;
// Painted masks (card C5), grid resolution, signed bytes so unpainted is 0.0.
// Layer 0: r rock, g snow or ice, b wet ground, a moss (0..1). Layer 1: r
// scatter density (-1 none .. +1 densest; 0 leaves the world's own), then the
// local style settings g relief, b cracks, a banding (-1 less .. +1 more than
// the world's own; 0 leaves it). Layer 2: r face rock share (same scale), then
// the water choices of a deep or shallow stroke (card E1): g unused (it was a
// stroke's shore edge), b shallow-to-deep edge (+1 hard, -1 faded), a bed (+1
// lit bed, -1 noise water); 0 leaves the world's own. Layer 3: r painted ground lumps (+1 more,
// -1 fewer than the world's own), g cracked bed (+1: the bed under this
// stroke's shallows is cracked rock-like ground).
@group(0) @binding(9) var masksTex: texture_2d_array<f32>;
// Fractions come from texel coordinates, independent of the allocation size.
// Gather at the center of the four cells: its normalized coordinate is far
// from a cell-selection boundary. Only the chosen cells use hardware sampling;
// the interpolation weights remain the same when a tile changes dimensions.
fn blendGather(v:vec4f,f:vec2f)->f32{return mix(mix(v.w,v.z,f.x),mix(v.x,v.y,f.x),f.y);}
fn sampleRegional2D(t:texture_2d<f32>,point:vec2f)->vec4f {
    let q=point-.5;let f=fract(q);let uv=(floor(q)+1.0)/vec2f(textureDimensions(t));
    return vec4f(blendGather(textureGather(0,t,linearClamp,uv),f),blendGather(textureGather(1,t,linearClamp,uv),f),blendGather(textureGather(2,t,linearClamp,uv),f),blendGather(textureGather(3,t,linearClamp,uv),f));
}
fn sampleRegionalArray(t:texture_2d_array<f32>,point:vec2f,layer:i32)->vec4f {
    let q=point-.5;let f=fract(q);let uv=(floor(q)+1.0)/vec2f(textureDimensions(t));
    return vec4f(blendGather(textureGather(0,t,linearClamp,uv,layer),f),blendGather(textureGather(1,t,linearClamp,uv,layer),f),blendGather(textureGather(2,t,linearClamp,uv,layer),f),blendGather(textureGather(3,t,linearClamp,uv,layer),f));
}
// F needs twelve of the authored mask channels; preserve their original
// SNORM values and interpolation in three layers of the same-sized texture.
#ifdef COLOR_PASS
@group(3) @binding(2) var colorMasksTex:texture_2d_array<f32>;
fn sampleMasks(uv:vec2f,layer:i32)->vec4f {
    switch layer {
      case 0:{return sampleRegionalArray(colorMasksTex,uv,0);}
      case 1:{let p=sampleRegionalArray(colorMasksTex,uv,1);return vec4f(0,p.r,0,0);}
      case 2:{let p=sampleRegionalArray(colorMasksTex,uv,1);return vec4f(0,0,p.g,0);}
      case 3:{let p=sampleRegionalArray(colorMasksTex,uv,1);return vec4f(0,0,0,p.b);}
      case 4:{let a=sampleRegionalArray(colorMasksTex,uv,1);let b=sampleRegionalArray(colorMasksTex,uv,2);return vec4f(a.a,b.rgb);}
      case 5:{let p=sampleRegionalArray(colorMasksTex,uv,2);return vec4f(p.a,0,0,0);}
      default:{return vec4f(0);}
    }
}
fn maskDimensions()->vec2u{return textureDimensions(colorMasksTex);}
// The ids (sculpt-chunk-renderer.js COLOR_INPUT_PACK): the rock id in the third mask layer's alpha, the ground id in the fall layer's blue.
fn loadRockMask(at:vec2i)->f32{return (round(textureLoad(colorMasksTex,at,2,0).a*127.0)+127.0)/127.0;}
fn loadGroundMask(at:vec2i)->f32{return round(textureLoad(gridTex,at,2,0).b*255.0)/127.0;}
#else
fn sampleMasks(uv:vec2f,layer:i32)->vec4f{return sampleRegionalArray(masksTex,uv,layer);}
fn maskDimensions()->vec2u{return textureDimensions(masksTex);}
fn loadRockMask(at:vec2i)->f32{return textureLoad(masksTex,at,5,0).r;}
fn loadGroundMask(at:vec2i)->f32{return textureLoad(masksTex,at,5,0).g;}
#endif


// Painted style factor for f in -1..1 (card C5): 1 at 0 (exactly), 0 at -1,
// 4 at +1 (two doublings).
fn styleScale(f: f32) -> f32 { return select(1.0 + f, exp2(2.0 * f), f > 0.0); }
fn regionalPoint(uv: vec2f) -> vec2f {
    // Split on the global lattice before subtracting the tile origin. A fused
    // multiply-subtract otherwise rounds at the local coordinate's precision,
    // moving a filter weight across a rounding boundary when the tile changes.
    let q = modf(uv * u.grid);
    return (q.whole - u.chunkGridOrigin) + q.fract;
}
fn maskPoint(p: vec2f) -> vec2f { return regionalPoint((p / (u.size - 1.0) * (u.grid - 1.0) + 0.5) / u.grid); }

// Slope averaged over about 14 px: the relief a painted edge follows changes
// over tens of pixels, not at the 5 px the shading's slope does.
fn wideSlope(p: vec2f) -> f32 {
    return 0.2 * (length(broadGradient(p)) + length(broadGradient(p + vec2f(14.0, 0.0))) + length(broadGradient(p - vec2f(14.0, 0.0)))
                + length(broadGradient(p + vec2f(0.0, 14.0))) + length(broadGradient(p - vec2f(0.0, 14.0))));
}
// Painted mask coverage with a soft, broken edge that follows the relief (card
// C5). raw: rock, snow or ice, wet ground, moss as painted (0..1); slope: wideSlope;
// hollow: -1 on convex tops .. +1 in hollows (0 where unknown). The painted value
// moves with the relief (rock holds on steep ground and in hollows, snow and
// wet ground on level ground and in hollows, moss on gentler tops) and with
// broad noise, and a narrow ramp then cuts it against pixel-scale noise: over
// the tens of pixels where the value crosses the ramp, grass and rock
// interleave, instead of one hard outline. A cell with nothing painted (raw 0)
// is exactly 0.
fn paintEdge(p: vec2f, raw: vec4f, slope: f32, hollow: f32) -> vec4f {
    let held = smoothstep(vec4f(0.0), vec4f(0.25), raw);
    let steep = smoothstep(0.08, 0.6, slope) - 0.35;
    let follow = vec4f(1.0, -0.6, -0.4, -0.2) * steep * 0.6 + vec4f(0.8, 0.3, 0.8, -0.3) * hollow * 0.2;
    let lobes = terrainNoise(p * 0.11 + vec2f(63.0, 17.0)).b - 0.5 + (terrainNoise(p * 0.5 + vec2f(21.0, 55.0)).r - 0.5) * 0.6;
    let grain = terrainNoise(p * 1.6 + vec2f(7.0, 99.0)).g + terrainNoise(p * 4.5 + vec2f(33.0, 5.0)).a * 0.6 - 0.8;
    return smoothstep(vec4f(0.35), vec4f(0.65), raw + (follow + lobes * 1.0 + grain * 1.8) * held);
}
// The same for a painted style amount f (-1..1): it holds where painted strongly
// and breaks up along the relief and the noise, never growing past the brush.
// 0 stays exactly 0.
fn styleEdge(p: vec2f, f: f32, slope: f32) -> f32 {
    let steep = smoothstep(0.08, 0.6, slope) - 0.35;
    let lobes = terrainNoise(p * 0.11 + vec2f(5.0, 88.0)).b - 0.5 + (terrainNoise(p * 0.5 + vec2f(41.0, 13.0)).r - 0.5) * 0.6;
    let grain = terrainNoise(p * 1.6 + vec2f(77.0, 29.0)).g + terrainNoise(p * 4.5 + vec2f(9.0, 61.0)).a * 0.6 - 0.8;
    let held = smoothstep(0.0, 0.25, abs(f));
    return f * smoothstep(0.30, 0.60, abs(f) + (steep * 0.25 + lobes * 0.4 + grain * 0.6) * held);
}

#ifdef COLOR_PASS
// F retains exactly flow/deposit, wear/wetness, material RGBA, fall XY and the ground id (fall layer blue).
fn weatherAt(uv:vec2f)->vec2f{return sampleRegionalArray(gridTex,regionalPoint(uv),0).rg;}
fn timeMap2(uv:vec2f)->vec2f{if(u.weatherMaps<0.5){return vec2f(0);}return sampleRegionalArray(gridTex,regionalPoint(uv),0).ba;}
fn timeMap3(uv:vec2f)->vec2f{if(u.weatherMaps<0.5){return vec2f(.5);}return sampleRegionalArray(gridTex,regionalPoint(uv),2).rg;}
#else
fn weatherAt(uv: vec2f) -> vec4f { return sampleRegionalArray(gridTex,regionalPoint(uv),0); }
fn timeMap2(uv: vec2f) -> vec4f { if (u.weatherMaps < 0.5) { return vec4f(0.0); } return sampleRegionalArray(gridTex,regionalPoint(uv),2); }
fn timeMap3(uv: vec2f) -> vec4f { if (u.weatherMaps < 0.5) { return vec4f(0.5, 0.5, 0.0, 0.0); } return sampleRegionalArray(gridTex,regionalPoint(uv),3); }
#endif
fn materialFieldAt(uv: vec2f) -> vec4f { return sampleRegionalArray(gridTex,regionalPoint(uv),1); }

// H5 override plane 17's deposits multiplier (planes 14-17: erosion, deposits, vegetation, exposure) at p: scales sand, stones and talus. 1 where nothing overrides.
fn depositsAt(p: vec2f) -> f32 {
    if (u.overrideOn == 0) { return 1.0; }
    return max(0.0, 1.0 + sampleMasks(maskPoint(p),3).w);
}
// H5: the Time pass's maps at world point p. layer 2: wear, wetness, hardness, slope; layer 3: fall line (-1..1), channel, ridge.
#ifdef COLOR_PASS
// Removing unused members also makes a new F dependency a compile error.
struct TimeMaps {wear:f32,wet:f32,fall:vec2f,deposit:f32}
fn timeMapsAt(p:vec2f)->TimeMaps{
    let uv=p/(u.size-1.0);let a=timeMap2(uv);let b=timeMap3(uv);let w=weatherAt(uv);
    return TimeMaps(a.x,a.y,b*2.0-1.0,w.g);
}
#else
struct TimeMaps { wear: f32, wet: f32, hard: f32, slope: f32, fall: vec2f, channel: f32, ridge: f32, flow: f32, talus: f32, deposit: f32 }
fn timeMapsAt(p: vec2f) -> TimeMaps {
    let uv = p / (u.size - 1.0);
    let a = timeMap2(uv); let b = timeMap3(uv); let w = weatherAt(uv);
    return TimeMaps(a.x, a.y, a.z, a.w, b.xy * 2.0 - 1.0, b.z, b.w, w.r, w.b, w.g);
}
#endif

// The surface layers' rows (engine-frag.wgsl surfaceStage; sculpt-material-model.js surfaceRows): the stages' heads and the flags row.
const SURFACE_HEAD = 152u;
const SURFACE_FLAGS = 151u;
// Facts (surfaceFacts): 0 slope, 1 height above the sea, 2 above the plain, 3 wear, 4 deposit, 5 wetness, 6 moisture, 7 soil depth, 8 light
// (level 1, sunward slopes more), 9 top (a lump 1, a hollow -1), 10 convexity, 11 the rock's share, 12 the debris', 13 the sand's, 14 faces
// north and 15 faces east (surfaceFacing), 16 sheltered and 17 distance to water (engine-frag.wgsl surfaceShelter, surfaceToWater: computed
// only where a rule reads them, the flags row's y). The shares exist from their stage on (0 before it).
const SURFACE_FACTS = 18u;
// Each fact's range for the Surface section's fact view (diagnostic views 14 to 17), SURFACE_FACTS order: sculpt-material-model.js
// SURFACE_FACT_RANGE holds the same numbers (repro/surface.test.mjs compares them).
const SURFACE_FACT_LO = array<f32, 18>(0.0, -20.0, -60.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, -1.0, -1.0, 0.0, 0.0, 0.0, -1.0, -1.0, 0.0, 0.0);
const SURFACE_FACT_HI = array<f32, 18>(20.0, 200.0, 200.0, 1.0, 1.0, 1.0, 1.0, 1.0, 1.6, 1.0, 1.0, 1.0, 1.0, 1.0, 1.0, 1.0, 1.0, 192.0);
// The fact view's gray at a range's low and high ends (sculpt-material-model.js SURFACE_FACT_GRAY): over black, which is the canvas outside the
// map, and under white, so the magenta where a condition holds stays apart from the gray at both ends.
const SURFACE_FACT_GRAY_LO = 0.1;
const SURFACE_FACT_GRAY_HI = 0.85;
// 1 for a fact the fact view draws on a square-root scale (sculpt-material-model.js SURFACE_FACT_ROOT: Steepness and Distance to water,
// whose limits bunch low).
const SURFACE_FACT_ROOT = array<f32, 18>(1.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 1.0);
// The flags row's y: the facts that look around a pixel which some rule reads (sculpt-material-model.js surfaceRows), so a world that reads
// neither pays for neither.
const SURFACE_LOOK_SHELTER = 1u;
const SURFACE_LOOK_WATER = 2u;
// Facing (facts 14 and 15): which way the ground falls, as its north and east parts (the map's top is north), 0 on level ground and whole from
// a slope of 0.25 (14 degrees) up. Two signed facts rather than an angle, so a window never wraps and a score can weigh any direction.
fn surfaceFacing(broad: vec2f) -> vec2f {
    let s = length(broad);
    if (s < 1e-4) { return vec2f(0.0); }
    let down = -broad / s;
    return vec2f(-down.y, down.x) * smoothstep(0.03, 0.25, s);
}
fn surfaceWindow(v: f32, lo: f32, hi: f32, fade: f32) -> f32 {
    let f = max(fade, 0.0001);
    return smoothstep(lo - f, lo + f, v) * (1.0 - smoothstep(hi - f, hi + f, v));
}
// The surface facts that look around a pixel (SURFACE_LOOK_*), over the authored height, for the color pass and the plant bake. Both reach
// less than the draw's own reach (sculpt-chunk-renderer.js reaches: the shadow march's 203.6 px), so a tile already holds every height they
// read; the bake's apron grows by SURFACE_LOOK_REACH when plants are placed and a rule reads one.
// Sheltered (fact 16): how much of the sky round the pixel the ground hides, 0 open (a top, a plain) to 1 closed (a narrow gorge). Eight looks
// at 24, 48 and 96 px, each the steepest rise that way, from 3 degrees (nothing) to 31 (all), averaged. The sea counts as level ground.
fn surfaceShelter(p: vec2f) -> f32 {
    let h = max(baseHeight(p), u.sea);
    var s = 0.0;
    for (var k = 0; k < 8; k++) {
        let a = f32(k) * 0.785398 + 0.39;
        let dir = vec2f(cos(a), sin(a));
        var rise = 0.0;
        for (var i = 0; i < 3; i++) { let d = 24.0 * exp2(f32(i)); rise = max(rise, (max(baseHeight(p + dir * d), u.sea) - h) / d); }
        s += smoothstep(0.05, 0.6, rise);
    }
    return s / 8.0;
}
// Distance to water (fact 17): px to the nearest ground under the sea, up to SURFACE_WATER_REACH, 0 in the water. Twelve rays, each to its first
// crossing of the sea, placed between two taps by their heights (as surfShore does), so the distance is smooth between taps.
const SURFACE_WATER_REACH = 192.0;
fn surfaceToWater(p: vec2f) -> f32 {
    let h0 = baseHeight(p) - u.sea;
    if (h0 < 0.0) { return 0.0; }
    var radii = array<f32, 14>(2.0, 4.0, 7.0, 11.0, 16.0, 23.0, 32.0, 43.0, 57.0, 74.0, 95.0, 120.0, 152.0, 192.0);
    var best = SURFACE_WATER_REACH;
    for (var k = 0; k < 12; k++) {
        let a = f32(k) * 0.523599 + 0.2;
        let dir = vec2f(cos(a), sin(a));
        var lastR = 0.0;
        var lastH = h0;
        for (var i = 0; i < 14; i++) {
            if (lastR >= best) { break; }
            let r = radii[i];
            let hr = baseHeight(p + dir * r) - u.sea;
            if (hr < 0.0) { best = min(best, lastR + (r - lastR) * lastH / (lastH - hr)); break; }
            lastR = r;
            lastH = hr;
        }
    }
    return best;
}

// A layer's rule over the facts, its rows from ruleAt (the head, then rules - 1 terms), one evaluator for the color pass and the bake: a
// windows rule multiplies `share` by each window in turn; a score rule adds each weighted fact to `score` (the caller's noise and lift).
fn surfaceWindows(ruleAt: u32, rules: u32, facts: array<f32, 18>, share: f32) -> f32 {
    var s = share;
    for (var t = 1u; t < rules; t++) { let w = u.materialTable[ruleAt + t]; s *= surfaceWindow(facts[min(u32(w.x), SURFACE_FACTS - 1u)], w.y, w.z, w.w); }
    return s;
}
fn surfaceScore(ruleAt: u32, rules: u32, facts: array<f32, 18>, score: f32) -> f32 {
    var s = score;
    for (var t = 1u; t < rules; t++) { let w = u.materialTable[ruleAt + t]; s += w.y * facts[min(u32(w.x), SURFACE_FACTS - 1u)]; }
    return s;
}

// The world's site rows (sculpt-material-model.js siteRows; materials/defaults.json `site`), from MM_COVER: 0 y wetness at which moisture
// starts to rise, z wetness at which it is full, w moisture of dry level ground; 1 x slope where soil thins, y slope where it is gone, z convex
// ground's loss, w deposit's gain; 2 y moisture per unit of wetSwath, z wetSwath that leaves moisture as it is, w the shade's gain. Then the
// plants' rows (PLANT_ROWS).
const MM_COVER = 162u;
fn cvr(i: u32) -> vec4f { return u.materialTable[MM_COVER + i]; }
// The two site values the surface layers' facts read, moisture and light, at a point: wetness (with the wet swaths' control as its bias, and the
// sun's shade) and the sun on the broad face (level ground 1).
fn coverSite(broad: vec2f, tm: TimeMaps) -> vec2f {
    let c0 = cvr(0u); let c2 = cvr(2u);
    let wn = smoothstep(c0.y, c0.z, tm.wet);
    let nb = normalize(vec3f(-broad, 1.0));
    let light = max(dot(nb, u.light), 0.0) / max(u.light.z, 0.05);
    let shade = clamp(1.0 - light, -0.6, 1.0);
    return vec2f(clamp(mix(c0.w, 1.0, wn) + c2.w * shade + c2.y * (u.wetSwath - c2.z), 0.0, 1.0), light);
}
// Soil depth at a point (0 bare, 1 deep): thin on steep and convex ground and where water wore the rock, deep in hollows and where water laid deposit.
fn coverSoil(slope: f32, top: f32, tm: TimeMaps, moist: f32) -> f32 {
    let c1 = cvr(1u);
    return clamp(1.0 - smoothstep(c1.x, c1.y, slope) - c1.z * smoothstep(0.25, 0.8, top) + 0.5 * smoothstep(0.25, 0.8, -top) * c1.z + c1.w * tm.deposit + 0.2 * moist - 0.4 * tm.wear, 0.0, 1.0);
}
#ifndef BAKE
struct VertexOut {
    @builtin(position) position: vec4f,
}
#endif

// World pixels per bake texel: the chunk's field scale (card P31 fades plants by it).
fn fieldScale() -> f32 {
    return max(u.chunkFieldScale, 1e-3);
}
// GLSL mod(): x - y * floor(x / y). WGSL's % truncates instead.
fn glslMod(x: vec2f, y: f32) -> vec2f { return x - y * floor(x / y); }

fn baseHeight(p: vec2f) -> f32 {
    let q = clamp(p / (u.size - 1.0), vec2f(0.0), vec2f(1.0)) * (u.grid - 1.0);
    let globalA = vec2i(floor(q));
    let globalB = min(globalA + 1, vec2i(i32(u.grid) - 1));
    let a = clamp(globalA - vec2i(u.chunkGridOrigin), vec2i(0), vec2i(u.chunkGridCount) - 1);
    let b = clamp(globalB - vec2i(u.chunkGridOrigin), vec2i(0), vec2i(u.chunkGridCount) - 1);
    let f = fract(q);
    return mix(mix(textureLoad(heightTex, a, 0).r,
                   textureLoad(heightTex, vec2i(b.x, a.y), 0).r, f.x),
               mix(textureLoad(heightTex, vec2i(a.x, b.y), 0).r,
                   textureLoad(heightTex, b, 0).r, f.x), f.y);
}

fn broadGradient(p: vec2f) -> vec2f {
    const e = 5.0;
    return vec2f(baseHeight(p + vec2f(e, 0.0)) - baseHeight(p - vec2f(e, 0.0)),
                 baseHeight(p + vec2f(0.0, e)) - baseHeight(p - vec2f(0.0, e))) / (2.0 * e);
}

// The world fields have one level and equal minifying and magnifying
// filters, so an explicit level 0 samples exactly as GLSL texture() did,
// and is legal in the vertex stage and in non-uniform control flow.
fn terrainNoise(p: vec2f) -> vec4f {
    return textureSampleLevel(noiseTex, linearRepeat, (p + vec2f(37.0, 83.0)) / 512.0, 0.0);
}

#ifdef BAKE
fn routeProtection(p: vec2f) -> f32 {
    return sampleRegional2D(routesTex,maskPoint(p)).r;
}
#else
// H7b: fields texel j holds the bake at world position origin + j * scale + (scale - 1) / 2 (the centre of the scale x scale block it stands
// for); at scale 1 every term below is x * 1, x / 1 or x - 0, so the lookup is the one it replaced.
fn fieldPoint(p:vec2f)->vec2f {
    let q=modf((clamp(p,vec2f(0),vec2f(u.size-1.0))+.5)/u.chunkFieldScale);
    return (q.whole-u.chunkFieldsOrigin/u.chunkFieldScale)+q.fract;
}
fn bakedFields(p: vec2f) -> vec4f { return sampleRegional2D(fieldsTex,fieldPoint(p)); }
// The field code nearest p, without blending it with neighboring codes.
fn bakedFieldsNearest(p: vec2f) -> vec4f {
    return textureLoad(fieldsTex,clamp(vec2i(floor(fieldPoint(p))),vec2i(0),vec2i(textureDimensions(fieldsTex))-1),0);
}
// Green: route protection 0..1, beach as negative, or 2 + crystal cover.
fn routeProtection(p: vec2f) -> f32 { let g = bakedFields(p).g; return select(max(g, 0.0), 1.0, g > 1.5); }
fn beachField(p: vec2f) -> f32 { return max(-bakedFields(p).g, 0.0); }
fn crystalField(p: vec2f) -> f32 { let g = bakedFields(p).g; return select(0.0, clamp(g - 2.0, 0.0, 1.0), g > 1.5); }
#endif

fn materialChipHeight(p: vec2f) -> f32 {
    if (u.materialReady == 0 || u.materialWeathering <= 0.0) { return 0.0; }
    let deposit = materialFieldAt((p / (u.size - 1.0) * (u.grid - 1.0) + 0.5) / u.grid);
    let support = deposit.r * (1.0 - smoothstep(0.15, 0.60, deposit.a)) * u.materialWeathering;
    if (support < 0.03) { return 0.0; }
    let cell = floor(p / 9.0);
    let random = fract(sin(vec3f(dot(cell, vec2f(127.1, 311.7)), dot(cell, vec2f(269.5, 183.3)), dot(cell, vec2f(419.2, 71.9)))) * 43758.5453);
    let present = smoothstep(random.x - 0.06, random.x + 0.06, support * 0.65);
    let q = glslMod(p, 9.0) - 4.5 + (random.yz - 0.5) * 4.0;
    let radius = 0.65 + random.y * 1.85;
    let edge = max(max(abs(q.x) * 0.85, abs(q.y)), abs(q.x * 0.65 + q.y * 0.76));
    return max(0.0, 1.0 - edge / radius) * (0.25 + random.z * 0.55) * present;
}

fn surfaceHeight(p: vec2f) -> f32 {
    var h = baseHeight(p);
    let rough = 1.0 - routeProtection(p);
    // Author intent applies to rendered geometry as well as the weathering
    // worker. A graded route cannot acquire extra clefts or rubble afterward.
    if (rough < 0.001) { return h; }
    let debris = materialChipHeight(p) * rough;
    if (abs(h - u.sea) < 6.0) {
        // Break only the waterline into small shared geometric irregularities.
        // The designed shallow-route bed (-7) and broad flats stay untouched.
        let shoreNoise = terrainNoise(p);
        let collar = 1.0 - smoothstep(2.0, 6.0, abs(h - u.sea));
        h += ((shoreNoise.g - 0.5) * 4.0 + (shoreNoise.a - 0.5) * 1.7) * collar * rough;
    }
#ifdef BAKE
    if (h < -12.0) { return h; }
#endif
    let slope = length(broadGradient(p));
#ifndef BAKE
    // Baked relief applies at every slope, level ground included: it carries
    // its own slope gain (gentle-slope relief and level-ground lumps).
    // The bake carries the cracks (engine-bake.wgsl cracks()).
    return h + bakedFields(p).r * u.detail + debris;
#else
    // The bake itself builds the relief the draw then reads from its fields.
    if (slope < 0.10) { return h + debris; }
    let n = terrainNoise(p);
    // The same displaced surface supplies projection, normals and occlusion.
    // Broad form is authored by the brush; detail stays small relative to it.
    let gain = smoothstep(0.10, 0.72, slope) * smoothstep(-12.0, 14.0, h);
    let facets = 2.0 + 14.0 * smoothstep(0.9, 2.6, slope);
    let detail = (n.g - 0.5) * 6.0 + (n.b - 0.5) * facets;
    return h + detail * gain * u.detail * rough + debris;
#endif
}

fn surfaceGradient(p: vec2f) -> vec2f {
    const e = 1.40625;   // 90/64 px: on a position held to 1/64 px (engine-frag.wgsl) the taps stay exact at any map size (card tilepool)
    return vec2f(surfaceHeight(p + vec2f(e, 0.0)) - surfaceHeight(p - vec2f(e, 0.0)),
                 surfaceHeight(p + vec2f(0.0, e)) - surfaceHeight(p - vec2f(0.0, e))) / (2.0 * e);
}
#endif

#ifndef EROSION
// One field feeds geometry, scatter and PBR. Global coordinates preserve the
// interpolation order across regional chunks and different voxel budgets.
fn rockFieldAt(t:texture_2d<f32>,p:vec2f)->vec4f {
    let q=p/4.0-.5;let i=vec2i(floor(q))-vec2i(round(u.rockWeatherGrid.xy/4.0));let f=fract(q);
    let last=vec2i(textureDimensions(t))-1;let a=clamp(i,vec2i(0),last);let b=clamp(i+1,vec2i(0),last);
    return mix(mix(textureLoad(t,a,0),textureLoad(t,vec2i(b.x,a.y),0),f.x),mix(textureLoad(t,vec2i(a.x,b.y),0),textureLoad(t,b,0),f.x),f.y);
}
// Rock weather is a field gathered from every rock in use: it is read wherever any of them runs off or sheds debris. With one rock (rockMask 0)
// the tests are that rock's own, so every pass compiles as one rock's did (another uniform in a test moved palette pixels).
fn rockWeatherAt(p:vec2f)->vec4f {
    if(select(u.runoffAny<=0.0&&u.debrisAny<=0.0,u.rock[rs & rockMask].runoff<=0.0&&u.rock[rs & rockMask].debrisAmount<=0.0,rockMask==0u)){return vec4f(0);}
    return rockFieldAt(rockWeatherTex,p);
}
// Bare rock at a rim. Soil is thin at the edge of a drop: within Bare rock at rims' reach the ground counts as painted rock, wholly at the edge and
// less inward (engine-rock-weather.wgsl rockDeposit measures the way to the drop), so the rock skin shows through in its own joints and beds: bare
// at the edge, then patches, then only low slabs under the ground cover. It is the painted-rock path and no other (the colors, the wear and the
// light treat it as paint), except that the solid gives it half a face's relief (rimRelief): level ground stays low.
fn rimRockAt(p:vec2f)->f32 {
    if(u.rimReach<=0.0){return 0.0;}
    return rockFieldAt(rockRimTex,p).x;
}
fn rimRelief(rim:f32,route:f32)->f32 { return .5*smoothstep(.1,.6,rim)*(1.0-route); }
// Rock at a shore. Within Rock at shores' reach of the waterline the ground counts as painted rock, on land (shoreRock) and on the bed under the
// water (shoreShelf): one platform that the waterline crosses, so the rock's own joints, blocks and beds run from the shore into the shallows
// and the same solid, lit the same, is seen through the water. engine-rock-weather.wgsl rockDeposit measures the way to the waterline. It is
// the painted-rock path and no other, at a face's full relief (a rim's has half): a shore platform is cut by its joints.
fn shoreRockAt(p:vec2f)->f32 {
    if(u.shoreRock<=0.0&&u.shoreShelf<=0.0){return 0.0;}
    return rockFieldAt(rockRimTex,p).y;
}
// A soft bank. Round water whose stroke is set to Soft bank (an inland lake) the ground within the same reach is soil, not a rock face,
// however steep: 1 at the water, fading to 0 at the reach. It takes the face gate away wherever a slope's rock is decided.
fn softBankAt(p:vec2f)->f32 {
    if(u.shoreRock<=0.0&&u.shoreShelf<=0.0){return 0.0;}
    return rockFieldAt(rockRimTex,p).z;
}
fn rockSourceAt(p:vec2f)->vec4f {
    if(select(u.debrisAny<=0.0,u.rock[rs & rockMask].debrisAmount<=0.0,rockMask==0u)){return vec4f(0,0,0,1);}
    return rockFieldAt(rockSourceTex,p);
}
// The rock slot of world point p: mask plane 20 (sculpt-scene.js MASK_KEYS 'rock') holds the slot + 1 a stroke claims its cell for, read at
// the nearest cell (a slot is not blended); 0, unclaimed, is slot 0, the world's own rock. A chunk with no claim reads nothing. The read is
// moved up to 4 px by noise (8 and 3 px), so a contact between two rocks is a ragged line, not the lattice's 2-px stairs (by eye at 3x on
// sm-sun25 drawn by two strokes: the nearest cell drew a straight seam across a wall, which 4 px breaks up).
fn rockSlotAt(p:vec2f)->u32 {
    if(u.rockIdOn==0){return 0u;}
    let q=p+(vec2f(valueNoise(p/8.0+vec2f(3.1,7.7)),valueNoise(p/8.0+vec2f(11.3,5.9)))*.7+vec2f(valueNoise(p/3.0+vec2f(2.3,9.1)),valueNoise(p/3.0+vec2f(6.7,1.3)))*.3)*4.0;
    let cell=clamp(vec2i(floor(q/(u.size-1.0)*(u.grid-1.0)+.5-u.chunkGridOrigin)),vec2i(0),vec2i(maskDimensions())-1);
    return u32(clamp(round(loadRockMask(cell)*127.0)-1.0,0.0,15.0));
}
// The point being evaluated belongs to the rock at p: every rock number it reads from here on is its slot's.
fn useRock(p:vec2f) { rs=rockSlotAt(p); }
// Ground choices use the authored grid directly, with no world-space noise.
fn groundSlotAt(p:vec2f)->u32 {
    if(u.groundIdOn==0){return u32(u.groundDefault);}
    let cell=clamp(vec2i(floor(p/(u.size-1.0)*(u.grid-1.0)+.5-u.chunkGridOrigin)),vec2i(0),vec2i(maskDimensions())-1);
    let id=round(loadGroundMask(cell)*127.0);return select(u32(clamp(id-1.0,0.0,31.0)),u32(u.groundDefault),id<1.5);
}
// Highland ground: level raised ground takes the world's highland material in place of its ground material, by the rise above the plain
// (u.highFrom, over u.highReach, its edge ragged by 20-px noise), times u.highland. 0 where there is no highland material.
fn highShare(p:vec2f)->f32 {
    if(u.highGround<0 || u.highland<=0.0){return 0.0;}
    let reach=max(u.highReach,0.5);
    let rise=baseHeight(p)-u.base+(terrainNoise(p*0.05+vec2f(7.0,31.0)).g-0.5)*0.6*reach;
    return smoothstep(u.highFrom,u.highFrom+reach,rise)*u.highland;
}
// The world ground's art height, with the highland material's where it lies.
fn ownGroundRelief(p:vec2f,slot:u32)->f32 {
    let r=materialRelief(p,slot);
    if(slot!=u32(u.groundDefault)){return r;}
    let hs=highShare(p);
    if(hs<=0.0){return r;}
    return mix(r,materialRelief(p,u32(u.highGround)),hs);
}
// Blend only art height across a two-art-pixel contact. The categorical slot
// still chooses color and finish; no noise or gameplay height enters the edge.
fn groundHeightFor(p:vec2f,cell:vec2i)->f32 {
    let c=clamp(cell,vec2i(0),vec2i(maskDimensions())-1);
    let id=round(loadGroundMask(c)*127.0);let slot=select(u32(clamp(id-1.0,0.0,15.0)),u32(u.groundDefault),id<1.5);
    let layer=u.ground[slot & groundMask].cacheLayer;
    if(layer<0){return 0.0;}
    return ownGroundRelief(p,slot);
}
fn groundHeight(p:vec2f)->f32 {
    if(u.groundIdOn==0){return ownGroundRelief(p,gs);}
    let q=p/(u.size-1.0)*(u.grid-1.0)-u.chunkGridOrigin;
    let cell=vec2i(floor(q));let f=smoothstep(vec2f(.25),vec2f(.75),fract(q));
    return mix(mix(groundHeightFor(p,cell),groundHeightFor(p,cell+vec2i(1,0)),f.x),
               mix(groundHeightFor(p,cell+vec2i(0,1)),groundHeightFor(p,cell+vec2i(1,1)),f.x),f.y);
}
fn materialPixel(p:vec2f)->vec2f {return poolWrap(floor(p),f32(textureDimensions(groundTex).x));}

// A material's cached repeat: unlit color and shine, art height, and its color reduced to its palette.
// A rock slot's surface material (its rock type's, else the world's rock material), -1 none.
fn rockMaterialOf(slot:u32)->i32 {
 let m=u.rock[slot & rockMask].material;
 if(m>0&&u.ground[u32(m) & groundMask].cacheLayer>=0){return m;}   // a slot the map no longer draws falls back to the world's rock material
 if(u.rockGround>=0&&u.ground[u32(u.rockGround) & groundMask].cacheLayer>=0){return u.rockGround;}
 return -1;
}
// A cache layer's art height at a native pixel q, bilinear between texels (the taps that light it read between pixels).
fn materialReliefBilinear(q:vec2f,layer:i32)->f32 {
 let size=f32(textureDimensions(groundTex).x);let b=floor(q-.5);let f=q-.5-b;
 let a00=textureLoad(materialHeightTex,vec2i(poolWrap(b,size)),layer,0).x;let a10=textureLoad(materialHeightTex,vec2i(poolWrap(b+vec2f(1,0),size)),layer,0).x;
 let a01=textureLoad(materialHeightTex,vec2i(poolWrap(b+vec2f(0,1),size)),layer,0).x;let a11=textureLoad(materialHeightTex,vec2i(poolWrap(b+vec2f(1,1),size)),layer,0).x;
 return mix(mix(a00,a10,f.x),mix(a01,a11,f.x),f.y);
}
fn materialRaw(p:vec2f,slot:u32)->vec3f { return materialRawAt(p,u.ground[slot & groundMask].cacheLayer); }
fn materialRawAt(p:vec2f,layer:i32)->vec3f {
 return textureLoad(groundTex,vec2i(materialPixel(p)),layer,0).rgb;
}
fn materialRelief(p:vec2f,slot:u32)->f32 {
 return textureLoad(materialHeightTex,vec2i(materialPixel(p)),u.ground[slot & groundMask].cacheLayer,0).x;
}
fn materialShine(p:vec2f,slot:u32)->f32 {
 return textureLoad(groundTex,vec2i(materialPixel(p)),u.ground[slot & groundMask].cacheLayer,0).a;
}
fn materialMean(slot:u32)->vec3f {
 return textureLoad(materialMeanTex,vec2i(0),u.ground[slot & groundMask].cacheLayer,0).rgb;
}
// A rock slot's material's mean color (rockMaterialOf: its own, else the world's rock material's; the old fixed mean without one): the
// rock's color, and the color its beds' tones shift (bedColor).
fn rockMaterialMean(slot: u32) -> vec3f { let m = rockMaterialOf(slot); if (m < 0) { return vec3f(0.33); } return materialMean(u32(m)); }
// A bed slot k (0-4) of a rock slot: its rock's color shifted by the bed's tone (rows 1-5 of rockColors, sculpt-column.js columnTones).
fn bedColor(slot: u32, k: i32) -> vec3f { return saturate(rockMaterialMean(slot) + u.rock[slot & rockMask].rockColors[1 + clamp(k, 0, 4)].rgb); }
fn materialPigment(p:vec2f,slot:u32)->vec3f { return materialPigmentAt(p,slot,u.ground[slot & groundMask].cacheLayer); }
// A layer of slot's cache as the map draws it: its color, reduced to the slot's palette as far as its dither says (a state's layer shares
// the slot's palette and its index in the reduced colors). The list is an option for the game palette's output: with the palette off
// (true color) the material keeps its continuous color.
fn materialPigmentAt(p:vec2f,slot:u32,layer:i32)->vec3f {
 let r=u.ground[slot & groundMask];let raw=materialRawAt(p,layer);
 if(r.dither<=0.0||u.quantize==0){return raw;}
 return mix(raw,textureLoad(groundColorTex,vec2i(materialPixel(p)),layer,0).rgb,r.dither);
}
// The ground's color where Time's water wore it (wear) or laid sediment (deposit), both 0 to 1: the material's own color, then its Worn and
// Deposit colors over it from each one's From level (over .35 of the map) as far as its Amount. The ground and high ground read it; snow,
// moss and water keep the material's own color.
fn groundPigment(p:vec2f,slot:u32,wear:f32,deposit:f32)->vec3f {
 let r=u.ground[slot & groundMask];var c=materialPigment(p,slot);
 if(r.wornLayer>=0){c=mix(c,materialPigmentAt(p,slot,r.wornLayer),r.states.y*smoothstep(r.states.x,r.states.x+.35,wear));}
 if(r.depositLayer>=0){c=mix(c,materialPigmentAt(p,slot,r.depositLayer),r.states.w*smoothstep(r.states.z,r.states.z+.35,deposit));}
 return c;
}

// The slot of the debris lying at p: rock weather's strongest source there (rockDeposit), read at the nearest 4-px cell.
fn debrisSlotAt(p:vec2f)->u32 {
    if(u.rockIdOn==0){return 0u;}
    let i=vec2i(floor(p/4.0))-vec2i(round(u.rockWeatherGrid.xy/4.0));
    return u32(textureLoad(rockRimTex,clamp(i,vec2i(0),vec2i(textureDimensions(rockRimTex))-1),0).w+.5);
}
fn voxelHash(p:vec3f)->f32 {
    let i=vec3i(floor(p));
    var n=(bitcast<u32>(i.x)*374761393u) ^ (bitcast<u32>(i.y)*668265263u) ^ (bitcast<u32>(i.z)*2246822519u);
    n=(n^(n>>13u))*1274126177u;return f32(n^(n>>16u))/4294967295.0;
}
fn voxelRandom(p:vec3f)->vec3f{return vec3f(voxelHash(p),voxelHash(p+vec3f(71,17,39)),voxelHash(p+vec3f(13,97,7)));}
fn voxelNoise(p:vec3f)->f32 {
    let i=floor(p);let f=fract(p);let a=f*f*(3.0-2.0*f);
    return mix(mix(mix(voxelHash(i),voxelHash(i+vec3f(1,0,0)),a.x),mix(voxelHash(i+vec3f(0,1,0)),voxelHash(i+vec3f(1,1,0)),a.x),a.y),mix(mix(voxelHash(i+vec3f(0,0,1)),voxelHash(i+vec3f(1,0,1)),a.x),mix(voxelHash(i+vec3f(0,1,1)),voxelHash(i+vec3f(1,1,1)),a.x),a.y),a.z);
}
// Folding is one coherent deformation shared by bed hardness, laminations,
// fracture blocks and material. The existing layer length and dip direction
// set its wavelength and orientation; no separate stack of color stripes.
fn voxelFold(p:vec3f)->f32 {
    if(u.rock[rs & rockMask].faceFold==0.0){return 0.0;}
    let size=max(20.0,u.rock[rs & rockMask].faceRun);let a=radians(u.rock[rs & rockMask].bedDipDir);
    let phase=dot(p.xy,vec2f(cos(a),sin(a)))/size*6.2831853;
    let wander=(voxelNoise(vec3f(p.xy/(size*1.6),.7))-.5)*2.4;
    return sin(phase+wander)*u.rock[rs & rockMask].faceFold;
}
fn voxelRockSpace(p:vec3f)->vec3f {
    let a=radians(u.rock[rs & rockMask].faceLean);let x=p.x*cos(a)+p.y*sin(a);let y=-p.x*sin(a)+p.y*cos(a);
    return vec3f(x,y,p.z+columnOffset(p.xy)+voxelFold(p));
}
struct VoxelRock {face:f32,edge:f32,tone:f32}
// The thinnest bed the face draws, in height units on a vertical face: 2 px up the screen (a height unit is half a pixel) and 4 voxels at
// 1x. A bed that would be drawn thinner aliases against the pixel and voxel grids into rows of dashes, so it is gathered (columnGather). A
// repeated line needs more: lines 4 units apart (2 px) break into moire wherever they tilt against the pixel rows, so fine layers are never
// closer than FACE_LINES (voxelFine). Blocks are never shorter than FACE_BLOCKS (voxelBlockAxes): Thin shale drew blocks 1.8 units tall,
// each tilted its own way, rows of dashes; at 3.5 a block is near 2 px tall, and every world's own rock (classic Green's 3.75) is taller.
const FACE_FINEST = 4.0;
const FACE_LINES = 6.0;
const FACE_BLOCKS = 3.5;
fn voxelBlockAxes(size:f32)->vec3f{return vec3f(size*u.rock[rs & rockMask].faceStretch,size,max(FACE_BLOCKS,max(2.0,u.rock[rs & rockMask].faceBed*1.5)*u.rock[rs & rockMask].faceBlockHeight*mix(1.0,size/max(4.0,u.rock[rs & rockMask].faceBlockSize),u.rock[rs & rockMask].faceScaleVary)));}
// A point of rock space in the lattice of blocks: a grid of the blocks' axes, tilted with the joints and bent by noise.
// Block regularity straightens the bends and (voxelBlockSeed) draws the blocks' middles onto the grid: 0 scattered, 1 a grid of boxes.
fn voxelLattice(r:vec3f,size:f32)->vec3f {
    let tilted=vec3f(r.x-r.z*tan(radians(u.rock[rs & rockMask].faceJointTilt)),r.y,r.z);
    let warp=vec3f(voxelNoise(r/37.0),voxelNoise((r+53.0)/43.0),voxelNoise((r-21.0)/47.0))-0.5;
    // Bounded displacement varies spacing without multiplying absolute world
    // coordinates: the same rock scale remains useful far from the origin.
    let variation=(voxelNoise(tilted/(size*3.7))-.5)*size*u.rock[rs & rockMask].faceScaleVary*2.5;
    return (tilted+warp*size*mix(.28,.12,u.rock[rs & rockMask].faceScaleVary)*(1.0-u.rock[rs & rockMask].faceRegular)+vec3f(variation,-variation*.7,variation*.5))/voxelBlockAxes(size);
}
fn voxelRandomOnce(p:vec3f)->vec3f{let i=vec3i(floor(p));var n=(bitcast<u32>(i.x)*374761393u) ^ (bitcast<u32>(i.y)*668265263u) ^ (bitcast<u32>(i.z)*2246822519u);n=(n^(n>>13u))*1274126177u;n=n^(n>>16u);return vec3f(f32(n&2047u)/2047.0,f32((n>>11u)&2047u)/2047.0,f32(n>>22u)/1023.0);}
fn voxelBlockSeed(cell:vec3f)->vec3f{return cell+(.12+.38*u.rock[rs & rockMask].faceRegular)+voxelRandomOnce(cell)*(.76*(1.0-u.rock[rs & rockMask].faceRegular));}
// The cells of the two blocks nearest a point (voxelBlocks finds the same two), for a question asked of a whole block: voxelBlockMiddle.
struct VoxelBlockPair {near:vec3f,next:vec3f}
fn voxelBlockPair(r:vec3f,size:f32)->VoxelBlockPair {
    let q=voxelLattice(r,size);let base=floor(q);var d1=1e8;var d2=1e8;var near=vec3f(0);var next=vec3f(0);
    for(var z=-1;z<=1;z++){for(var y=-1;y<=1;y++){for(var x=-1;x<=1;x++){
        let c=base+vec3f(f32(x),f32(y),f32(z));let v=voxelBlockSeed(c)-q;let d=dot(v,v);
        if(d<d1){d2=d1;next=near;d1=d;near=c;}else if(d<d2){d2=d;next=c;}
    }}}
    return VoxelBlockPair(near,next);
}
// A block's middle in the world, from its cell alone, so that every voxel of a block agrees on it. The lattice is bent by noise read at the
// voxel; reading that noise at the middle instead, twice over, lands within a fraction of a block of the true middle.
fn voxelBlockMiddle(cell:vec3f,size:f32)->vec3f {
    let home=voxelBlockSeed(cell)*voxelBlockAxes(size);
    let lean=tan(radians(u.rock[rs & rockMask].faceJointTilt));var t=home;
    for(var i=0;i<2;i++){
        let r=vec3f(t.x+t.z*lean,t.y,t.z);
        let warp=vec3f(voxelNoise(r/37.0),voxelNoise((r+53.0)/43.0),voxelNoise((r-21.0)/47.0))-0.5;
        let variation=(voxelNoise(t/(size*3.7))-.5)*size*u.rock[rs & rockMask].faceScaleVary*2.5;
        t=home-warp*size*mix(.28,.12,u.rock[rs & rockMask].faceScaleVary)*(1.0-u.rock[rs & rockMask].faceRegular)-vec3f(variation,-variation*.7,variation*.5);
    }
    let a=radians(u.rock[rs & rockMask].faceLean);let x=t.x+t.z*lean;let xy=vec2f(x*cos(a)-t.y*sin(a),x*sin(a)+t.y*cos(a));
    return vec3f(xy,t.z-columnOffset(xy)-voxelFold(vec3f(xy,0)));
}
fn voxelBlocks(r:vec3f,size:f32)->VoxelRock {
    let axes=voxelBlockAxes(size);let q=voxelLattice(r,size);
    let base=floor(q);var d1=1e8;var d2=1e8;var v1=vec3f(0);var v2=vec3f(0);var nearest=vec3f(0);
    for(var z=-1;z<=1;z++){for(var y=-1;y<=1;y++){for(var x=-1;x<=1;x++){
        let c=base+vec3f(f32(x),f32(y),f32(z));let v=voxelBlockSeed(c)-q;let d=dot(v,v);
        if(d<d1){d2=d1;v2=v1;d1=d;v1=v;nearest=c;}else if(d<d2){d2=d;v2=v;}
    }}}
    let tilt=voxelRandom(nearest+vec3f(11,31,73))-.5;
    let plane=dot(v1,tilt)*1.15+(voxelHash(nearest+vec3f(37,5,61))-.5)*.45;
    let rounded=(.65-sqrt(d1))*1.7+(voxelHash(nearest+vec3f(37,5,61))-.5)*.25;
    return VoxelRock(mix(plane,rounded,u.rock[rs & rockMask].faceRound),(d2-d1)/max(2.0*length(v2-v1),.001)*min(axes.x,min(axes.y,axes.z)),voxelHash(nearest)*2.0-1.0);
}
// Individual blocks retreat along their joints. Bed hardness and the block's
// own stable identity select broad scars, rather than another noise coating.
fn voxelRelease(block:VoxelRock,hard:f32)->f32 {
    let selected=smoothstep(-.35,.65,block.tone);
    return u.rock[rs & rockMask].faceBreak*selected*smoothstep(.15,1.7,block.edge)*(.35+.65*(1.0-hard));
}
// The same cuts supply density and the depth exposed through the outer rind.
fn voxelJoint(r:vec3f,c:VoxelRock,broad:VoxelRock,hard:f32)->f32 { let wear=voxelJointWear(hard);return voxelJointW(r,c,broad,voxelJointWidth(wear),voxelJointFine(wear)); }
// Weathering at a joint (0 to 1): the rock's Wear, more where its bed is soft (hard .55 is the bed of a rock with no column). It opens the joints
// wider and wears the hairlines away first; rockDetail also fills the floor of what the solid cannot hold.
fn voxelJointWear(hard:f32)->f32 { return clamp(u.rock[rs & rockMask].faceWear*(1.45-hard),0.0,1.0); }
fn voxelJointWidth(wear:f32)->f32 { return (.65+wear*1.2)*u.rock[rs & rockMask].faceJointWidth; }
fn voxelJointFine(wear:f32)->f32 { return u.rock[rs & rockMask].faceSecondary*(1.0-.6*wear); }
// The joints' opening (0 to 1.15) for joints width units wide, the fine joints at share secondary.
fn voxelJointW(r:vec3f,c:VoxelRock,broad:VoxelRock,width:f32,secondary:f32)->f32 {
    // Coherent interruptions taper both depth and opening; they do not select
    // a different topology at zero. Fine joints subdivide the larger blocks.
    let size=max(8.0,u.rock[rs & rockMask].faceBlockSize);
    var primary=1.0;var fine=1.0;
    if(u.rock[rs & rockMask].faceContinuity<1.0){
        primary=mix(smoothstep(.24,.64,voxelNoise(r/vec3f(size*2.1,size*2.1,size*1.1)+17.0)),1.0,u.rock[rs & rockMask].faceContinuity);
        fine=mix(smoothstep(.3,.66,voxelNoise(r/vec3f(size*.9,size*.9,size*.65)-29.0)),1.0,u.rock[rs & rockMask].faceContinuity);
    }
    return (1.0-smoothstep(width*.25,width,c.edge))*secondary*fine
        +(1.0-smoothstep(width*.15,width*.85,broad.edge))*1.15*primary;
}
fn voxelDetail(r:vec3f)->f32 {
    if(u.rock[rs & rockMask].faceDetailPatch<=0.0){return 1.0;}
    // Leave intact faces between damaged patches; the existing pitting,
    // grooves and grit retain their own amplitudes and physical scales.
    let cluster=smoothstep(.28,.65,voxelNoise(r/max(12.0,u.rock[rs & rockMask].faceBlockSize*1.3)+vec3f(67,11,43)));
    return mix(1.0,cluster*1.6,u.rock[rs & rockMask].faceDetailPatch);
}
fn voxelSpall(r:vec3f,c:VoxelRock,hard:f32)->f32 {
    let chip=voxelNoise(r/vec3f(max(5.0,u.rock[rs & rockMask].faceBlockSize*.65),max(5.0,u.rock[rs & rockMask].faceBlockSize*.65),max(3.0,u.rock[rs & rockMask].faceBed*.8))+vec3f(19,53,7));
    return u.rock[rs & rockMask].faceSpall*smoothstep(.32,.7,chip)*(1.0-hard*.7)*(1.0+1.8*exp(-c.edge/2.0))*3.0;
}
// Eight jittered inclusions: round pebbles through angular broken clasts.
// One field supplies both relief and mineral changes at the same 3D position.
fn voxelClasts(p:vec3f)->vec2f {
    if(u.rock[rs & rockMask].faceClast<=0.0){return vec2f(0);}
    let q=p/max(3.0,u.rock[rs & rockMask].faceClastSize);let b=floor(q-.5);var best=0.0;var tone=0.0;
    for(var z=0;z<=1;z++){for(var y=0;y<=1;y++){for(var x=0;x<=1;x++){
        let cell=b+vec3f(f32(x),f32(y),f32(z));let random=voxelRandom(cell+vec3f(39,7,91));
        let v=q-(cell+.5+(random-.5)*.6);let radius=.12+.45*pow(random.z,1.4);
        let metric=mix(max(abs(v.x),max(abs(v.y),abs(v.z)))*1.25,length(v),u.rock[rs & rockMask].faceRound)/radius;
        let cap=1.0-smoothstep(.35,1.1,metric);
        if(cap>best){best=cap;tone=random.x*2.0-1.0;}
    }}}
    return vec2f(best,tone);
}
// Unequal, deformed beds use the same hardness for rock shape and wear.
fn voxelColumnCoord(p:vec3f)->f32 {return voxelColumnAt(p,voxelRockSpace(p));}
// voxelColumnCoord at p, whose rock space point (voxelRockSpace(p)) the caller already has.
fn voxelColumnAt(p:vec3f,r:vec3f)->f32 {
    let drift=(voxelNoise(r/vec3f(max(8.0,u.rock[rs & rockMask].faceRun),max(8.0,u.rock[rs & rockMask].faceRun),140.0))-.5)*2.2;
    return (columnCoord(p.xy,p.z)+voxelFold(p))*(5.5/max(2.0,u.rock[rs & rockMask].faceBed))+drift*u.rock[rs & rockMask].faceBed*.2*u.rock[rs & rockMask].faceBedVary;
}
fn voxelBed(p:vec3f)->ColumnBed {
    let c=voxelColumnCoord(p);
    return columnBedIn(c,columnSectionAt(c),u.rock[rs & rockMask].bedCycleVary);
}
// Beds thinner than the face can draw are gathered. A bed t units thick is about t/2 px tall on a vertical face and t/s px wide on ground
// of slope s (rise per px), so its drawn size, as height units on a vertical face, is t (1 + 2/s): the same bed is a line on a gentle slope
// (classic Green's contour lines) and a stripe per voxel row on a cliff. From half of FACE_FINEST down, a bed's hardness gives way to the
// mean of its section's beds that are as thin there, so the ledges, chips, wear and tint that hardness drives draw them as one bed. x: the
// hardness drawn; y: how much the gathered beds' hardness spread (their standard deviation, in this bed's share), which voxelFine draws as
// fine layers instead. A section of beds thick enough, or of one hardness, keeps each bed's own hardness exactly. slope: the surface's
// (voxelFaceSlope, or the ground's where there is no solid).
fn columnGather(bed:ColumnBed,slope:f32)->vec2f {
    let scale=max(2.0,u.rock[rs & rockMask].faceBed)/5.5*(1.0+2.0/max(slope,.05));   // drawn height units per column unit (voxelColumnCoord)
    // A bed thick enough to draw keeps its own hardness: answered first, since most beds are, and the solid asks at every sample.
    let own=1.0-smoothstep(.5*FACE_FINEST,FACE_FINEST,u.columnBeds[bed.first+bed.j].x*scale);
    if(own<=0.0){return vec2f(bed.hardness,0.0);}
    var w=0.0;var wh=0.0;var whh=0.0;var lo=bed.hardness;var hi=bed.hardness;
    for(var i=0;i<bed.n;i++){
        let b=u.columnBeds[bed.first+i];let thin=b.x*(1.0-smoothstep(.5*FACE_FINEST,FACE_FINEST,b.x*scale));
        w+=thin;wh+=thin*b.y;whh+=thin*b.y*b.y;
        if(thin>0.0){lo=min(lo,b.y);hi=max(hi,b.y);}
    }
    // Beds of one hardness have nothing to gather: answered by comparison, since the GPU's division need not round the mean exactly.
    if(w<=0.0||hi<=lo){return vec2f(bed.hardness,0.0);}
    let mean=wh/w;
    return vec2f(bed.hardness+(mean-bed.hardness)*own,sqrt(max(whh/w-mean*mean,0.0))*own);
}
fn voxelHardness(p:vec3f,slope:f32)->f32 {
    if(u.rock[rs & rockMask].columnCount==0){return .55;}
    return columnGather(voxelBed(p),slope).x;
}
// One fine layer at phase (layers up the column) for layers spacing units apart, about its mean (-.5 to .5): a lip and a notch. The
// layer's top recedes and the next layer's foot stands out over it within a unit, so the sun lights the layer and the notch under each lip
// reads as a fine dark line.
fn fineLayer(phase:f32,spacing:f32)->f32 {
    let f=fract(phase);let lip=min(.5,1.0/spacing);
    return smoothstep(0.0,lip,f)*(1.0-f)-.5+.5*lip;
}
// The fine layers at p, on the column coordinate c (voxelColumnCoord), so they bend with folds, drift and tilt with the beds and run on
// unbroken until a joint or a block cuts them. Two sets: the ledges of the beds gathered as too thin to draw (columnGather's spread, by
// Hard-layer ledges) at the finest spacing a repeated line keeps, FACE_LINES, and Fine layer relief at Fine layer spacing (height units,
// 6 to 16, never closer than FACE_LINES; the same lines at 6). In a column section of two beds or more, Variation between repeated
// beds varies both: their spacing and darkness wander slowly, over Layer variation length along the wall and a few layers up it (0: evenly
// spaced and even, as one bed repeated). With no column or one bed the panel offers no variation (sculpt-control-schema.js), and they stay
// even. x: the gathered beds' relief, y: Fine layer relief's, in height units; z: their depth together.
fn voxelFine(p:vec3f,c:f32,gathered:f32)->vec3f {
    let thin=gathered*u.rock[rs & rockMask].faceLedge*2.4;let own=u.rock[rs & rockMask].faceLamina*2.5;
    if(thin+own<=0.0){return vec3f(0.0);}
    let z=c*max(2.0,u.rock[rs & rockMask].faceBed)/5.5;   // height up the deformed column
    let vary=select(0.0,u.rock[rs & rockMask].bedCycleVary,u.rock[rs & rockMask].columnCount>0&&columnSection(columnSectionAt(c)).z>=2.0);
    var warp=0.0;var dark=1.0;
    if(vary>0.0){
        let r=voxelRockSpace(p);let run=max(20.0,u.rock[rs & rockMask].faceRun);
        warp=(voxelNoise(vec3f(r.xy/run,z/(5.0*FACE_LINES))+vec3f(31,7,59))-.5)*1.6*vary*FACE_LINES;
        dark+=(voxelNoise(vec3f(r.xy/run,z/(3.0*FACE_LINES))+vec3f(3,83,17))-.5)*1.6*vary;
    }
    let spacing=max(u.rock[rs & rockMask].faceLaminaSize,FACE_LINES);
    return vec3f(thin*fineLayer((z+warp)/FACE_LINES,FACE_LINES)*dark,own*fineLayer((z+warp)/spacing,spacing)*dark,thin+own);
}
// Strata: coloured bands by height on raised ground (painted desert), the colours of the column's beds (slot -> bedColor).
fn strataSlot(k: f32) -> vec3f { return bedColor(rs, i32(k + 0.5)); }
// The colour of the column's section s at coordinate c. A bed meets the next one over edge, a share of the cycle: a boundary inside a
// cycle is softened on both sides, the cycle's top (topFade) inside its top bed. hold (0..1) holds ground that is nearly all one bed
// (the widest bed's share of the cycle over .88) to that bed's colour: retail's pale caps are one sheet of the cool bed (card G4).
fn columnColour(c: f32, s: i32, edge: f32, topFade: bool, hold: f32) -> vec3f {
    let bed = columnBedIn(c, s, u.rock[rs & rockMask].bedCycleVary);
    let w = edge * bed.period;
    let r = bed.through * bed.thick;
    var rgb = strataSlot(bed.slot);
    if (bed.j > 0 && r < w) {
        rgb = mix(strataSlot(u.columnBeds[bed.first + bed.j - 1].z), rgb, smoothstep(-w, w, r));
    } else if (bed.j < bed.n - 1 && bed.thick - r < w) {
        rgb = mix(rgb, strataSlot(u.columnBeds[bed.first + bed.j + 1].z), smoothstep(-w, w, r - bed.thick));
    }
    if (topFade && bed.j == bed.n - 1 && bed.thick - r < w) {
        rgb = mix(rgb, strataSlot(u.columnBeds[bed.first].z), smoothstep(bed.thick - w, bed.thick, r));
    }
    return mix(rgb, strataSlot(bed.widestSlot), hold * smoothstep(0.88, 0.94, bed.widest));
}
#endif
