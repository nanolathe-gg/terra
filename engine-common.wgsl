// Authored terrain appearance experiment. No recovered retail rendering claim.
//
// WGSL port of the former sculpt-common.glsl, shared by the draw
// (sculpt-vert.wgsl, sculpt-frag.wgsl) and the bake (relief-bake.wgsl).
// Naming follows the GLSL so a GLSL diff ports line by line:
//  - uniform uFooBar is the field u.fooBar of the one uniform block below
//    (bool uniforms are i32: 0 or 1; the one rename is uDiagnostic, which
//    is u.diagnosticView because diagnostic is a WGSL keyword);
//  - sampler uFoo is the texture fooTex, with fooSamp where it is filtered.
// The renderer (sculpt-renderer.js) reads this struct to lay out its
// uniform buffer, so a new uniform needs only a field here.
// The renderer understands #ifdef BAKE / #ifndef BAKE / #else / #endif.

struct Uniforms {
    // Shared by the draw and the bake.
    grid: f32,
    size: f32,
    base: f32,
    sea: f32,
    materialWeathering: f32,
    materialReady: i32,
    rockyCoasts: i32,
    scree: i32,
    detail: f32,
    layered: i32,
    terraced: i32,
    coastalDetail: i32,
    light: vec3f,
    // Draw (sculpt-frag.wgsl).
    shallowColor: vec3f,
    deepColor: vec3f,
    waterMean: vec3f,
    rockMean: vec3f,
    full: i32,
    clay: i32,
    slopeMaterial: i32,
    soilCover: i32,
    mineralMargins: i32,
    rockLayers: i32,
    quantize: i32,
    shapeCoverage: i32,
    ledgeCoverage: i32,
    nativeShallows: i32,
    diagnosticView: i32,   // GLSL uDiagnostic (diagnostic is a WGSL keyword)
    separateLight: i32,
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
    crackDark: f32,
    // A world's chosen base colours (a = 1 when set) and its textures' means.
    groundBase: vec4f,
    slopeBase: vec4f,
    rockBase: vec4f,
    sandBase: vec4f,
    beachBase: vec4f,
    shallowBase: vec4f,
    deepBase: vec4f,
    groundTexMean: vec3f,
    slopeTexMean: vec3f,
    rockTexMean: vec3f,
    beachTexMean: vec3f,
    beach: i32,
    waterMid: vec4f,   // rgb mid-depth colour, a: its depth (0: two stops)
    beachHeight: f32,
    beachWidth: f32,
    slopeSand: i32,
    shoreEdge: f32,   // lava coast rim, outline and lip (0: none)
    // Crystals: their own colour (world base colour 'crystal', else the world's).
    crystalColor: vec3f,
    crystalBase: vec4f,
    groundContrast: f32,
    groundBorrowed: i32,
    sandDust: f32,
    sandGrass: f32,
    bandWater: f32,
    rockCrown: f32,
    strata: f32,
    strataContrast: f32,
    strataGrain: f32,
    strataColors: array<vec4f, 5>,   // rgb of the column's material slots; uniform arrays take a 16-byte stride
    paletteMix: i32,
    transitionDetail: f32,
    rockStart: f32,
    rockFull: f32,
    wetBand: f32,
    shallowDepth: f32,
    deepDepth: f32,
    mineralDetail: f32,
    microRock: f32,
    faceSlope: vec2f,
    rockShare: vec2f,
    faceScore: vec4f,
    mossFromGround: f32,
    lightCap: f32,
    shadeDepth: f32,      // share of the directional shading kept (1: all)
    ambient: f32,       // unlit share of the light (0.42; Moon lower: no sky)
    slopeMarks: f32,    // Moon: density of crisp dark marks on slopes (0: none)
    sandCrown: f32,     // painted sand stays sand to the crown, no rock (Zhon sand bars)
    footRim: f32,
    crevice: f32,
    faceDark: f32,        // darkening of slopes turned from the sun, most in hollows (0: none)
    flatBank: f32,        // low dry banks lit as level ground, no wet band (0: off)
    dither: f32,
    sandLight: f32,
    sandEdge: f32,
    flatShadow: f32,
    flatOcclusion: f32,
    slopeTexture: f32,
    landDither: f32,
    waterSoft: f32,
    crispShore: f32,
    bankRock: f32,
    groundMode: i32,
    waterLayer: i32,       // H14e: the generated layers that are the deep and the shallow water's grain (the table's water materials)
    shallowLayer: i32,
    groundLayer: i32,      // H14b: the generated layer that is the plain's quilted image, or -1 (the plain is the sampled image or the tiles)
    groundTiles: i32,
    sandGrain: f32,
    // Bake (relief-bake.wgsl).
    reliefScale: f32,     // wavelength of the first octave, world px
    reliefAmount: f32,    // height per unit slope per wavelength
    reliefBranch: f32,    // how strongly octaves follow earlier gullies
    reliefLumps: f32,     // share of isotropic lumps mixed in
    reliefOctaves: i32,
    reliefGain: f32,      // amplitude ratio between octaves
    reliefWarp: f32,      // domain warp, world px
    reliefPatchy: f32,    // spatial variation of relief strength
    reliefJitter: f32,    // per-kernel phase and wavelength variation
    faceStreak: f32,      // 0: ribs down steep faces; 1: ledges along the contours
    faceStreakFrom: f32,  // slope where the turn toward the contours starts
    gentleRelief: f32,    // relief on gentle slopes
    boulderDensity: f32,  // 0 disables boulders
    boulderSize: f32,     // typical diameter, world px
    boulderFoot: f32,     // share of boulders sourced from cliff feet
    boulderCluster: f32,  // how strongly boulders gather into fields
    boulderMoss: f32,     // share of stones with mossy tops
    debris: f32,          // 0 disables debris
    debrisReach: f32,     // how far debris tumbles, world px
    debrisSize: f32,      // largest debris stone, world px
    debrisSort: f32,      // 1: coarse near the source, fine far away
    repose: f32,          // slope below which debris comes to rest
    sand: f32,            // 0 disables sand
    crackSeverity: f32,   // crack depth
    crackWidth: f32,      // crack core width, world px
    crackNetwork: f32,    // 0: rills down the slope; 1: polygonal plates
    cracksOn: i32,        // the full bake computes cracks; previews skip them
    plainRelief: f32,     // faint lit lumps on level ground (appearance only)
    crackSpacing: f32,    // major crack block size, world px
    windAngle: f32,       // direction the wind blows toward, degrees (0 = east)
    ripple: f32,          // ripple wavelength, world px (0: none)
    rippleHeight: f32,    // ripple amplitude, height units
    beachDistance: f32,   // beach reach from the waterline, world px (0: none)
    banding: f32,         // contour banding strength (0: none)
    hasBeach: i32,        // the world has beach-sand art: painted sand uses it
    sandBanding: f32,     // streaks on sand and ramps
    sandBandSpacing: f32,
    apron: f32,           // sand apron reach round raised ground, world px (0: none)
    worms: f32,           // wormy regolith relief on slopes (lunar)
    boulderRound: f32,    // 0: angular boulders; 1: rounded domes
    bandSpacing: f32,     // height between bands, height units (the column block's `bands`)
    bandSoftness: f32,    // share of each band that is riser
    bandLine: f32,        // darkness of the line along each riser (the column block's `bands`)
    bandJag: f32,         // pixel-scale wiggle of the band lines, in band steps (0: smooth)
    bandFade: f32,        // slope where bands are gone (they fade from 0.35/0.75 of it)
    sun: vec3f,           // the renderer's light, for lit crack walls
    crackMinor: f32,      // share of minor cracks inside blocks
    crackHairline: f32,   // share of hairline crazing
    crackBlocks: f32,     // how far blocks step and tilt against each other
    crackMajor: f32,      // share of major cracks
    crystalGrain: f32,    // crystal tops: 0 the slope cover's art, 1 the level ground's
    crystalFace: f32,     // crystal side-face colour, times crystal colour x 0.38 (1: as before)
    crystalInk: f32,      // crystal outlines: 0 soft 92% dark, 1 crisp pure black
    crystalTone: f32,     // crystal top brightness (1: as before)
    // Painted masks (card C5).
    paintOn: i32,         // 1 once any cell carries a painted mask; 0 skips every read of masksTex
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
    // (Blinn exponent), z roughness (normal slope amplitude), w roughness scale, px.
    shine: array<vec4f, 5>,
    // Rock structure (card E3: Green, Red, Painted Desert). All 0 is today's scattered rock.
    rockOrder: f32,       // 0 scattered relief, blocks and cracks; 1 coherent beds and joints with the scatter held back
    bedSpacing: f32,      // bed thickness, height units
    bedVary: f32,         // how much beds differ in thickness (0 even, 1 very)
    bedDip: f32,          // bed tilt, height units per px
    bedDipDir: f32,       // direction the beds tilt down toward, degrees (0 east, 90 south)
    bedLedge: f32,        // how far each bed steps (0 the smooth face, 1 flat treads and short risers)
    jointDepth: f32,      // joint depth, height units
    grooveSpacing: f32,   // distance between joint lines, and between gully lines, world px
    grooveAngle: f32,     // their lean from the screen's north-south, degrees
    grooveRun: f32,       // typical length of an unbroken joint or gully, world px
    bedHeight: f32,       // 0 beds spaced along the ground (px), 1 by height units (as the strata colours)
    rockFrom: f32,        // slope where beds and joints start on steep ground (painted rock always counts)
    // Water looks (card E1). Defaults reproduce the earlier water exactly.
    bedLit: f32,          // shallow water drawn as the lit bed under it, tinted (0: the noise water; 1: all bed)
    bedTint: f32,         // how far the tint replaces the bed's own colour (0: bed only; 1: the tint, lit by the bed)
    bedRelief: f32,       // bed lumps (bake): faint embossed relief under shallow water, 0: none
    deepEdge: f32,        // shallow-to-deep step: 0 the depth ramp, 1 a hard step with ragged stairs
    deepEdgeDepth: f32,   // depth of the hard step (0: the ramp's midpoint)
    waterOn: i32,         // 1 once any cell carries a painted water edge or bed choice (planes 9-11)
    lumpOn: i32,          // 1 once any cell carries painted ground lumps (plane 12)
    lumpRelief: f32,      // height of a fully painted lump field, in the units of plainRelief
    shallowMean: vec3f,   // mean colour of the shallow water art: the lit bed's tint
    bedBright: f32,       // brightness of the tinted bed (1: the tint as it is)
    bedContrast: f32,     // how much of the bed's light carries through the tint (1: all, 0: flat tint)
    hillLight: f32,       // brightness of the hill cover's material (Archipelago; 1: as drawn)
    ringFade: f32,        // how gradually the mineral ring fades out from the hill (0: as drawn; Archipelago)
    // Ice (card E5).
    shadeBlue: f32,       // shaded ice keeps its blue: how far the blue (and a little green) stay lit as the light falls (0: grey shade, as before)
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
    // E8 (Painted Desert)
    baseBand: f32,         // the grey band at the foot of the raised ground (strata colour 5): its strength, 0 off
    baseBandLow: f32,      // lower edge of its height window, above the plain
    baseBandHigh: f32,     // upper edge
    baseBandWander: f32,   // how far the window drifts with position, height units
    baseBandGaps: f32,     // share of the band's length that is missing
    // G4 (Painted Desert)
    desertCapFlat: f32,    // how far level ground in a cap zone (share over .9) stays the cool bed (0: the beds as before)
    // E9 (Green rock faces). Every default reproduces the earlier output exactly.
    rockMoss: f32,        // how much of the rock art's own green (fractured and weathered tiles) is kept (1: all, as before; 0: none)
    shineOutside: f32,    // share of the rock's glints kept outside painted rock (1: everywhere, as the shine model gives them)
    faceRelief: f32,      // share of the rock relief lit on a wall that faces the viewer (0: the world-space look; engine-frag.wgsl)
    rockDetail: f32,      // contrast of the rock tile's own blotches around the rock's mean colour (1: as drawn; 0: flat)
    gullyDepth: f32,      // gullies down the face: depth, height units (0: none)
    gullyWidth: f32,      // gully width across, world px
    gullyShade: f32,      // how dark a deep gully's floor is, as occlusion following its depth (0: lit like the rest)
    ribTilt: f32,         // ribs between gullies are planes tilted up to this, height units per px (0: level)
    bedPunch: f32,        // beds differ in strength, so a few ledges stand out (0: all alike)
    facetTilt: f32,       // angular facets: each tilted up to this, height units per px (0: none)
    facetCoarse: f32,     // a second, coarser level of facets (2.4 times the size) at this share of the tilt and step (0: none)
    // E11: shallow water round 2 (Green, Red) and Archipelago's fringe. Every default is the earlier look.
    shelfWander: f32,     // Green, Red: how far broad noise moves the step's depth, in depth units (0: the step follows the shore)
    shelfScale: f32,      // size of that wander, world px
    crackedStep: f32,     // Red: depth of the shallow-to-deep step under a cracked-bed stroke (0: the world's own step)
    bedDots: f32,         // Red: dark dots in the lit bed, as a share of brightness (0: none)
    bedDotCell: f32,      // px between those dots (one per cell of this size, a share of cells empty)
    stepSoftPx: f32,      // Archipelago's reef bars: the true-threshold step's ramp width in px (1: a one-pixel edge, as Green and Red)
    ringContrast: f32,    // Archipelago: contour lines in the red fringe, following the hill's outline (0: none)
    ringCount: f32,       // how many lines the fringe carries from its inner to its outer edge
    ringSize: f32,        // how far out the lines reach, against the fringe's own reach (1: as far as the ring's texture)
    bedFlat: f32,         // the lit bed takes only the bed's own relief for its light, not its slope's (0: the pixel's full shading, as before)
    // F1 (flow bake): the current and the sediment it carries (mask planes 20-24).
    flowOn: i32,          // 1 once any cell carries a baked current or sediment; 0 skips every read of it
    flowTint: f32,        // how far a full concentration of sediment replaces the water's colour
    flowShallow: f32,     // the share of that tint kept in the shallowest water (1: tinted alike at every depth)
    flowStreak: f32,      // contrast of the streaks the current draws (0: none)
    flowStreakLen: f32,   // length of a streak, world px
    flowBank: f32,        // how strongly sediment tints the banks it reaches
    sedimentColors: array<vec4f, 3>,   // rgb of the three sediments the bake carries (set by the bake's node)
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
    pockmark: f32,        // dark pits scattered evenly over raised ground and slopes, tops and sides alike (0: none, as before)
    pockSize: f32,        // pit spacing across the retail glint axis, px
    // G8 (Moon): the surface read from retail pictures.
    moonCups: f32,        // lit pits, 2-3 px wide and 4-6 px tall, many on shaded steep faces and few on lit ground (0: none; the pockmark dots are separate)
    moonCupSize: f32,     // pit spacing across the glint axis, px (the cell is 1.5 times that along it)
    moonCupDepth: f32,    // pit depth in height units: how steep its walls shade
    moonRibs: f32,        // stringy light and dark strokes down steep faces, shaded by the sun (0: none)
    moonRibDepth: f32,    // stroke steepness: the gradient the strokes add (1: about 0.8 at their steepest)
    moonRibDark: f32,     // how much darker the strokes' mean is on faces turned from the sun (0: the face's own shade)
    moonFolds: f32,       // thin dark lines that follow the form across lit and moderate slopes (0: none)
    moonFoldSpacing: f32, // height units between the folds' first set of contours
    // E6 (Ice mountains).
    iceSlate: f32,        // mountain faces are all rock from gentle slopes up, one monotone material (0: the rock and snow interleave, as before)
    iceCrystal: f32,      // crystal mountains: dark straight strokes in domains across the rock faces (0: none, as before)
    iceCrest: f32,        // crystal mountains: share of the raised ground under snow-white lumps (0: none)
    // G3 (Archipelago rings): the fringe as stacked, offset copies of the hill's outline. Every default is the earlier look.
    ringShift: f32,       // px each copy sits from the hill's own outline (0: the earlier concentric lines; ringCount copies otherwise)
    ringShiftDir: f32,    // degrees the copies drift towards on average, clockwise from east in the world (90: south)
    ringScatter: f32,     // how far each copy's direction wanders from that mean, as a share of a half turn
    ringWobble: f32,      // px of waver in each copy's outline: lobes with inward cusps, the scalloped look (0: smooth)
    ringLobe: f32,        // px across one lobe
    ringFill: f32,        // the pale tint where every copy overlaps; each copy adds its share, so the skirt steps lighter outward (0: none)
    ringPatch: f32,       // how far the stack's reach varies along the outline, from a few copies to all of them (0: every copy everywhere)
    ringPatchSize: f32,   // px over which that reach varies
    ringTone: f32,        // the copies' lines take retail's rose, darker on the inner copies and paler on the outer (0: the earlier crimson)
    // G6 (Ice blocks and mesas, retail ice-3 and Polar Range).
    iceSoft: f32,         // raised ice is lit by its height blurred over ~13 px, so crests are rounded and faces smooth (0: the full relief lights it, as before)
    iceSnow: f32,         // the flat tops of raised ice lie under snow (0: none)
    iceFall: f32,         // smooth fibres down the faces of raised ice, in place of grain (0: none)
    iceApron: f32,        // dark hatched drifts spilling past the foot of raised ice into the snow (0: none)
    iceFrost: f32,        // Ice frost band: fine dark-blue hairlines in parallel runs, thinning inland (0: none)
    // G1 (shallow water round 3: Green, Red, Archipelago). Every default is the earlier look.
    shoalBump: f32,       // the shallow bed's lit bumps: slope of the lumps the sun lights (0: none, as before)
    shoalBumpPx: f32,     // size of those lumps, screen px
    shoalRag: f32,        // the shallow-to-deep step's outline: pixel notches of up to this many px, whatever the bed's slope (0: as before)
    shoalStairs: f32,     // the hard waterline's stairs: runs of 1-3 px moving it up to this many px, whatever the bank's slope (0: as before)
    shoalGrain: f32,      // Red: the ground tile's own colour grain shows through the tint, this share of it (0: the tint replaces it, as before)
    shoalShoreSoft: f32,  // Archipelago: the waterline the world draws (a stroke's Hard and Faded stay) is a dithered blend this many px wide (0: a clean line)
    // G2 (rock faces follow the slope). Every default is the earlier look.
    cliffFollow: f32,     // beds follow the contours and joints, gullies and facets the fall line of the ground round them (0: fixed screen directions, as before)
    cliffReach: f32,      // radius of the height smoothing that gives the local fall line, world px
    cliffWide: f32,       // radius of the larger smoothing that gives it where the ground under the rock is level, world px
    cliffFlat: f32,       // slope (height per px) at the wide scale under which the beds and joints fade into plain broken rock
    cliffRise: f32,       // height of a bed's riser, height units, when beds are spaced in px (0: the bed's own height, as before)
    cliffBed: f32,        // how far the beds follow the smoothed ground (cliffReach) instead of the grid's own bumps (0: the grid's heights; 1: the smoothed ones)
    cliffStagger: f32,    // each bed's joints sit at their own offset, up to this share of the joint spacing either way (0: one lattice for every bed, as before)
    cliffFine: f32,       // a third, finer level of facets at this share of the fine level's tilt and step, 0.45 of its size (0: none)
    cliffDomain: f32,     // size of the patches that each keep their own lattice of joints, gullies and facets, world px
    // H1 (lit relief, Green). Both run only in a full draw; every default is the earlier look.
    closeShadow: f32,     // how much a ledge 1-6 px toward the sun darkens the direct light on the ground behind it, 0..1 (0: only the far taps)
    cavity: f32,          // how much a crevice or crack floor (surface below the mean of a ring 1-3 px out) loses of its ambient light, 0..1 (its direct light loses .45 of that; 0: off)
    // H2, H16 (the rock column of a world's table, `column` in materials/<world>.json). Every default is the earlier look.
    columnSectionCount: i32,   // sections of the column (0: the world has no column; each bed's thickness and strength come from a hash)
    columnContrast: f32,  // how much harder the hard beds are: their ledges stand taller, and erosion wears them 1 / (1 + 15 * this) as fast (0: all beds alike)
    columnOrigin: f32,    // the height the coordinate counts from (the plain's, or 0)
    columnBeds: array<vec4f, 32>,       // per bed: x thickness (height units), y hardness 0..1, z material slot, w unused
    columnSections: array<vec4f, 8>,    // per section, from low to high: x the coordinate it starts at, y its first bed, z its bed count, w its period
    columnWander: f32,    // the wander the coordinate takes from value noise: its amplitude, height units
    columnTerrain: vec4f, // the wander it takes from three octaves of the terrain noise (height units): xyz their amplitudes (not in the Time pass)
    materialTable: array<vec4f, 166>,   // Green (H3 materialModel): four materials of 39 rows then ten placement rows, from materials/green.json (material-model.wgsl)
    materialFoot: f32,    // Green (H3): world px one drawn pixel covers; above 1 the draw trials a coarse resolution
    // Green (H4 item 4), rock blocks: the bake's joints cut each column bed into blocks (engine-bake.wgsl blockField).
    blocks: f32,          // 1: blocks on faces (with a reduced facet and gully set, ENGINE_KNOBS); 0: none (also leaves the beds' boundaries unragged)
    blockRow: f32,        // px: height of a piece before the hardness scale (soft rock 0.7 of it, hard 1.5)
    blockWidth: f32,      // px: width of a piece (the grid is turned by a slowly varying angle)
    blockTilt: f32,       // largest tilt of a block's plane, height per px (soft beds 1.3 of it, hard ones 0.45)
    blockStep: f32,       // largest step of a block against the next, height units (hard beds 0.4 of it)
    blockSeam: f32,       // darkness of the crevice along bed boundaries and joints (also carved a share of a unit deep)
    blockChip: f32,       // px an edge wanders, chipping the block outline (hard beds 0.4 of it)
    weatherMaps: f32,     // H5: 1 when gridTex layers 2 and 3 hold the Time pass's maps (engine-weather.wgsl)
    // H5 item 3a, Green's retail marks (0: off). They read the Time pass's maps, so age, rain and hardness contrast move them.
    terraceBreak: f32,    // how far the terrace lines' phase wanders (band spacings), more where the ground is wet
    terraceCalm: f32,     // 0..1: terrace lines faded on gentle slopes (the small dashes retail does not have)
    wetSwath: f32,        // darkness of the soft swaths water leaves on grass along its flow
    outcrop: f32,         // grey rock shown where wear has bared steep grass
    // (the fall-line cracks in outcrops, moss by wetness and the grey specks are fixed at retail's rates, ROCK_CRACK and SPECKS in engine-bake and the wetness term in engine-frag: H5 found their controls under 5% of any class)
    // H5 item 3b, beyond retail (0: off for Green).
    rillDepth: f32,       // height units a rill is cut, along the flow
    rillSpacing: f32,     // px between rills
    stoneDensity: f32,    // stones and boulders where talus lies
    stoneSize: f32,       // px: the largest stone (larger below hard beds)
    // H4b (Green): rock blocks on the hills' rock, outside the structured face (0: none).
    hillBlocks: f32,      // 0..1: how much of the hill rock (slope .5 and over, off the structured face) is cut into small pieces
#ifdef CHUNK
    // Card D: bounded regional fields, with every position on the world lattice.
    chunkGridOrigin: vec2f,   // first uploaded sample's global grid index
    chunkGridSize: vec2f,     // padded regional texture dimensions
    chunkGridCount: vec2f,    // supplied samples (padding repeats their last row/column)
    chunkFieldsOrigin: vec2f, // integer world pixel at baked texel (0,0)
    chunkFieldsSize: vec2f,
    chunkScreenOrigin: vec2f, // preview screen pixels; export adds floor(base/2)
    chunkScreenSize: vec2f,
    chunkRasterOrigin: vec2f,
    chunkRasterSize: f32,
    chunkScale: f32,          // World pixels per raster texel.
    chunkFieldScale: f32,     // Relief bake spacing, independent of color sampling.
#endif
}

@group(0) @binding(0) var<uniform> u: Uniforms;

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

// H2 rock column: the bed coordinate, in height units, at world point p for a
// rock surface at height z. The bake (bedRelief) and the erosion pass (erosion.wgsl) both
// call it with the surface height of the grid they hold, so a ledge erosion leaves
// stands where the bake draws one: it depends only on (p, z), not on the smoothed
// ground cliffFollow gives the hash beds. columnOffset is the part that depends on p alone (the erosion pass caches it). The tilt (bedDip)
// and the broad wander are the hash beds' own.
fn columnOffset(p: vec2f) -> f32 {
    let a = radians(u.bedDipDir);
    var offset = u.bedDip * dot(p, vec2f(cos(a), sin(a)));
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
fn columnSectionAt(c: f32) -> i32 {
    var s = 0;
    for (var i = 1; i < u.columnSectionCount; i++) { if (c >= u.columnSections[i].x) { s = i; } }
    return s;
}
// Section s at coordinate c. A two-bed section's second bed has a share of the cycle (the period stays the section's): where the next
// section has the same two slots the share runs toward the next one's between their starts, and retail Painted Desert's beds vary from
// cycle to cycle (measured on the retail map), so a hash of the cycle scales it by .55 to 1.45.
fn columnBedIn(c: f32, s: i32) -> ColumnBed {
    let sec = u.columnSections[s];
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
        if (s + 1 < u.columnSectionCount) {
            let nx = u.columnSections[s + 1];
            let next = i32(nx.y);
            if (nx.z == 2.0 && u.columnBeds[next].z == u.columnBeds[first].z && u.columnBeds[next + 1].z == u.columnBeds[first + 1].z) {
                share = mix(share, u.columnBeds[next + 1].x / nx.w, clamp((c - sec.x) / max(nx.x - sec.x, 0.1), 0.0, 1.0));
            }
        }
        bed.widest = max(share, 1.0 - share);
        bed.widestSlot = u.columnBeds[first + select(0, 1, share > 0.5)].z;
        second = period * clamp(share * (0.55 + 0.9 * columnCycleHash(cycle + 0.37)), 0.03, 0.97);
    }
    var lo = 0.0;
    for (var i = 0; i < n; i++) {
        var t = u.columnBeds[first + i].x;
        if (n == 2) { t = select(period - second, second, i == 1); }
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
fn columnAt(c: f32) -> ColumnBed { return columnBedIn(c, columnSectionAt(c)); }
#ifndef EROSION
@group(0) @binding(1) var heightTex: texture_2d<f32>;   // r32float, read with textureLoad
@group(0) @binding(2) var noiseTex: texture_2d<f32>;
// Grid-resolution inputs in one array texture (a fragment stage may sample 16
// textures): layer 0 the weathering worker's flow, deposit, talus, sand; layer
// 1 the material field. Read through weatherAt and materialFieldAt.
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
@group(0) @binding(7) var linearClamp: sampler;
@group(0) @binding(8) var linearRepeat: sampler;
// Painted masks (card C5), grid resolution, signed bytes so unpainted is 0.0.
// Layer 0: r rock, g snow or ice, b wet ground, a moss (0..1). Layer 1: r
// scatter density (-1 none .. +1 densest; 0 leaves the world's own), then the
// local style settings g relief, b cracks, a banding (-1 less .. +1 more than
// the world's own; 0 leaves it). Layer 2: r face rock share (same scale), then
// the water choices of a deep or shallow stroke (card E1): g shore edge, b
// shallow-to-deep edge (+1 hard, -1 faded), a bed (+1 lit bed, -1 noise
// water); 0 leaves the world's own. Layer 3: r painted ground lumps (+1 more,
// -1 fewer than the world's own), g cracked bed (+1: the bed under this
// stroke's shallows is cracked rock-like ground).
@group(0) @binding(9) var masksTex: texture_2d_array<f32>;

// Painted style factor for f in -1..1 (card C5): 1 at 0 (exactly), 0 at -1,
// 4 at +1 (two doublings).
fn styleScale(f: f32) -> f32 { return select(1.0 + f, exp2(2.0 * f), f > 0.0); }
#ifdef CHUNK
fn regionalUv(uv: vec2f) -> vec2f { return (uv * u.grid - u.chunkGridOrigin) / u.chunkGridSize; }
fn maskUv(p: vec2f) -> vec2f { return regionalUv((p / (u.size - 1.0) * (u.grid - 1.0) + 0.5) / u.grid); }
#else
fn maskUv(p: vec2f) -> vec2f { return (p / (u.size - 1.0) * (u.grid - 1.0) + 0.5) / u.grid; }
#endif

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

#ifdef CHUNK
fn weatherAt(uv: vec2f) -> vec4f { return textureSampleLevel(gridTex, linearClamp, regionalUv(uv), 0, 0.0); }
fn timeMap2(uv: vec2f) -> vec4f { if (u.weatherMaps < 0.5) { return vec4f(0.0); } return textureSampleLevel(gridTex, linearClamp, regionalUv(uv), 2, 0.0); }
fn timeMap3(uv: vec2f) -> vec4f { if (u.weatherMaps < 0.5) { return vec4f(0.5, 0.5, 0.0, 0.0); } return textureSampleLevel(gridTex, linearClamp, regionalUv(uv), 3, 0.0); }
fn materialFieldAt(uv: vec2f) -> vec4f { return textureSampleLevel(gridTex, linearClamp, regionalUv(uv), 1, 0.0); }
#else
fn weatherAt(uv: vec2f) -> vec4f { return textureSampleLevel(gridTex, linearClamp, uv, 0, 0.0); }
fn timeMap2(uv: vec2f) -> vec4f { if (u.weatherMaps < 0.5) { return vec4f(0.0); } return textureSampleLevel(gridTex, linearClamp, uv, 2, 0.0); }
fn timeMap3(uv: vec2f) -> vec4f { if (u.weatherMaps < 0.5) { return vec4f(0.5, 0.5, 0.0, 0.0); } return textureSampleLevel(gridTex, linearClamp, uv, 3, 0.0); }
fn materialFieldAt(uv: vec2f) -> vec4f { return textureSampleLevel(gridTex, linearClamp, uv, 1, 0.0); }
#endif

// H5 override plane 17's deposits multiplier (planes 14-17: erosion, deposits, vegetation, exposure) at p: scales sand, stones and talus. 1 where nothing overrides.
fn depositsAt(p: vec2f) -> f32 {
    if (u.overrideOn == 0) { return 1.0; }
    return max(0.0, 1.0 + textureSampleLevel(masksTex, linearClamp, maskUv(p), 3, 0.0).w);
}
// H5: the Time pass's maps at world point p. layer 2: wear, wetness, hardness, slope; layer 3: fall line (-1..1), channel, ridge.
struct TimeMaps { wear: f32, wet: f32, hard: f32, slope: f32, fall: vec2f, channel: f32, ridge: f32, flow: f32, talus: f32 }
fn timeMapsAt(p: vec2f) -> TimeMaps {
    let uv = p / (u.size - 1.0);
    let a = timeMap2(uv); let b = timeMap3(uv); let w = weatherAt(uv);
    return TimeMaps(a.x, a.y, a.z, a.w, b.xy * 2.0 - 1.0, b.z, b.w, w.r, w.b);
}
// Where wear has bared steep grass: clumps of 10-20 px on slopes, by how much rock the water took. Bake and draw share it,
// so the cracks lie where the grey shows.
fn outcropAt(p: vec2f, slope: f32, wear: f32, hard: f32) -> f32 {
    if (u.outcrop <= 0.0) { return 0.0; }
    let clumps = smoothstep(0.22, 0.5, valueNoise(p / 17.0 + 7.0) * 0.5 + 0.5 + 0.15 * valueNoise(p / 5.0 + 3.0));
    return u.outcrop * smoothstep(0.02, 0.22, wear) * smoothstep(0.30, 0.55, slope) * (1.0 - smoothstep(0.9, 1.4, slope)) * smoothstep(0.35, 0.7, hard) * clumps;
}

#ifndef BAKE
struct VertexOut {
    @builtin(position) position: vec4f,
    @location(0) world: vec2f,
    @location(1) height: f32,
}
#endif

// GLSL mod(): x - y * floor(x / y). WGSL's % truncates instead.
fn glslMod(x: vec2f, y: f32) -> vec2f { return x - y * floor(x / y); }

fn baseHeight(p: vec2f) -> f32 {
    let q = clamp(p / (u.size - 1.0), vec2f(0.0), vec2f(1.0)) * (u.grid - 1.0);
#ifdef CHUNK
    let globalA = vec2i(floor(q));
    let globalB = min(globalA + 1, vec2i(i32(u.grid) - 1));
    let a = clamp(globalA - vec2i(u.chunkGridOrigin), vec2i(0), vec2i(u.chunkGridCount) - 1);
    let b = clamp(globalB - vec2i(u.chunkGridOrigin), vec2i(0), vec2i(u.chunkGridCount) - 1);
#else
    let a = vec2i(floor(q));
    let b = min(a + 1, vec2i(i32(u.grid) - 1));
#endif
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
#ifdef CHUNK
    return textureSampleLevel(routesTex, linearClamp, maskUv(p), 0.0).r;
#else
    return textureSampleLevel(routesTex, linearClamp, (p / (u.size - 1.0) * (u.grid - 1.0) + 0.5) / u.grid, 0.0).r;
#endif
}
#else
#ifdef CHUNK
// H7b: fields texel j holds the bake at world position origin + j * scale + (scale - 1) / 2 (the centre of the scale x scale block it stands
// for); at scale 1 every term below is x * 1, x / 1 or x - 0, so the lookup is the one it replaced.
fn bakedFields(p: vec2f) -> vec4f {
    let q = clamp(p, vec2f(0.0), vec2f(u.size - 1.0));
    let centre = (u.chunkFieldScale - 1.0) * 0.5;
    return textureSampleLevel(fieldsTex, linearClamp, (((q + 0.5 * u.chunkFieldScale) - u.chunkFieldsOrigin) - centre) / u.chunkFieldScale / u.chunkFieldsSize, 0.0);
}
#else
fn bakedFields(p: vec2f) -> vec4f { return textureSampleLevel(fieldsTex, linearClamp, (p + 0.5) / u.size, 0.0); }
#endif
// Green: route protection 0..1, beach as negative, or 2 + crystal cover.
fn routeProtection(p: vec2f) -> f32 { let g = bakedFields(p).g; return select(max(g, 0.0), 1.0, g > 1.5); }
fn beachField(p: vec2f) -> f32 { return max(-bakedFields(p).g, 0.0); }
fn crystalField(p: vec2f) -> f32 { let g = bakedFields(p).g; return select(0.0, clamp(g - 2.0, 0.0, 1.0), g > 1.5); }
#endif

fn screeHeight(p: vec2f) -> f32 {
    if (u.scree == 0) { return 0.0; }
    let support = weatherAt(p / (u.size - 1.0)).b;
    if (support < 0.005) { return 0.0; }
    // Small authored angular fragments share lighting with the terrain. The
    // worker admits them only in clustered dry cliff-foot deposits.
    let cell = floor(p / 7.0);
    let random = fract(sin(vec3f(dot(cell, vec2f(127.1, 311.7)),
                                 dot(cell, vec2f(269.5, 183.3)),
                                 dot(cell, vec2f(419.2, 71.9)))) * 43758.5453);
    let present = smoothstep(random.x - 0.04, random.x + 0.04, support * 0.75);
    let q = glslMod(p, 7.0) - 3.5 + (random.yz - 0.5) * 2.0;
    let radius = 1.1 + random.y * 1.5;
    let edge = max(max(abs(q.x) * 0.85, abs(q.y)), abs(q.x * 0.65 + q.y * 0.76));
    return max(0.0, 1.0 - edge / radius) * (1.0 + random.z * 1.5) * present;
}

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
    let debris = (screeHeight(p) + materialChipHeight(p)) * rough;
    if (u.coastalDetail != 0 && abs(h - u.sea) < 6.0) {
        // Break only the waterline into small shared geometric irregularities.
        // The designed shallow-route bed (-7) and broad flats stay untouched.
        let shoreNoise = terrainNoise(p);
        let collar = 1.0 - smoothstep(2.0, 6.0, abs(h - u.sea));
        h += ((shoreNoise.g - 0.5) * 4.0 + (shoreNoise.a - 0.5) * 1.7) * collar * rough;
    }
    if (h < -12.0) { return h; }
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
    if (u.layered != 0) {
        let cliff = smoothstep(0.8, 1.8, slope) * smoothstep(0.0, 18.0, h) * rough;
        // A bounded irregular face displacement and interrupted short ledges
        // challenge the smooth extrusion; protected broad flats stay level.
        let warp = vec2f(n.g, terrainNoise(p + vec2f(191.0, 317.0)).g) - 0.5;
        h = mix(h, baseHeight(p + warp * select(24.0, 16.0, u.terraced != 0)), cliff);
        let phase = h / 18.0 + (n.r - 0.5) * 2.0 + (n.g - 0.5) * 0.8;
        let f = fract(phase);
        h += (smoothstep(0.20, 0.80, f) - f) * select(12.6, 16.5, u.terraced != 0) * cliff;
    }
    let facets = 2.0 + 14.0 * smoothstep(0.9, 2.6, slope);
    let detail = (n.g - 0.5) * 6.0 + (n.b - 0.5) * facets;
    return h + detail * gain * u.detail * rough + debris;
#endif
}

fn surfaceGradient(p: vec2f) -> vec2f {
    const e = 1.4;
    return vec2f(surfaceHeight(p + vec2f(e, 0.0)) - surfaceHeight(p - vec2f(e, 0.0)),
                 surfaceHeight(p + vec2f(0.0, e)) - surfaceHeight(p - vec2f(0.0, e))) / (2.0 * e);
}
#endif
