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

struct Uniforms {
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
    shallowColor: vec3f,
    riverBed: vec4f,       // riverfix: the braided bed's gravel colour (materials/<world>.json water.riverBedRGB), a = 1 when the world gives one
    deepColor: vec3f,
    waterMean: vec3f,
    rockMean: vec3f,
    clay: i32,
    slopeMaterial: i32,
    mineralMargins: i32,
    quantize: i32,
    diagnosticView: i32,   // GLSL uDiagnostic (diagnostic is a WGSL keyword)
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
    grassSlopes: i32,     // 1 where the world's slopes are grass: Joined wrinkles (u.wrinkles) then draw terracettes in the bake, not Moon's dark lines in the draw
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
    wetBand: f32,
    shallowDepth: f32,
    deepDepth: f32,
    mossFromGround: f32,
    lightCap: f32,
    shadeDepth: f32,      // share of the directional shading kept (1: all)
    ambient: f32,       // unlit share of the light (0.42; Moon lower: no sky)
    slopeMarks: f32,    // Moon: density of crisp dark marks on slopes (0: none)
    sandCrown: f32,     // painted sand stays sand to the crown, no rock (Zhon sand bars)
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
    beachLayer: i32,       // the generated layer that is the beach sand (the world's own, or one borrowed from another world's table), or -1
    groundTiles: i32,
    tileShift: f32,        // the export's TNT tile grid starts this many screen rows down: floor(base height / 2), the TA projection's offset (sculpt-chunk-renderer.js requiredRegion)
    sandGrain: f32,
    // Bake (engine-bake.wgsl).
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
    sand: f32,            // 0 disables sand
    crackSeverity: f32,   // crack depth
    crackWidth: f32,      // crack core width, world px
    crackNetwork: f32,    // 0: rills down the slope; 1: polygonal plates
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
    faceGrit: f32,        // fine grit, height units
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
    rimReach: f32,        // bare rock at rims: how far in from a drop the soil thins, px (0 none)
    rockWeatherGrid: vec4f, // origin in art pixels, texture dimensions; 4px cells
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
    faceExtrude: f32, // Extrusion bias: inset to projecting
    faceLamina: f32, // Fine layer relief
    faceLaminaSize: f32, // Fine layer spacing (height)
    faceScratchLength: f32, // Groove length (px)
    faceScratchAngle: f32, // Groove tilt from vertical (deg)
    faceGritSize: f32, // Grit size (px)
    // Water looks (card E1). Defaults reproduce the earlier water exactly.
    bedLit: f32,          // shallow water drawn as the lit bed under it, tinted (0: the noise water; 1: all bed)
    bedTint: f32,         // how far the tint replaces the bed's own colour (0: bed only; 1: the tint, lit by the bed)
    bedRelief: f32,       // bed lumps (bake): faint embossed relief under shallow water, 0: none
    deepEdge: f32,        // shallow-to-deep step: 0 the depth ramp, 1 a hard step with ragged stairs
    waterOn: i32,         // 1 once any cell carries a painted water edge or bed choice (planes 9-11, 13) or a Surf (plane 18)
    lumpOn: i32,          // 1 once any cell carries painted ground lumps (plane 12)
    lumpRelief: f32,      // height of a fully painted lump field, in the units of plainRelief
    shallowMean: vec3f,   // mean colour of the shallow water art: the lit bed's tint
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
    crackedStep: f32,     // Red: depth of the shallow-to-deep step under a cracked-bed stroke (0: the world's own step)
    bedDots: f32,         // Red: dark dots in the lit bed, as a share of brightness (0: none)
    bedDotCell: f32,      // px between those dots (one per cell of this size, a share of cells empty)
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
    pockmark: f32,        // dark pits scattered evenly over raised ground and slopes, tops and sides alike (0: none, as before)
    pockSize: f32,        // pit spacing across the retail glint axis, px
    // G8 (Moon): the surface read from retail pictures.
    moonCups: f32,        // lit pits, 2-3 px wide and 4-6 px tall, many on shaded steep faces and few on lit ground (0: none; the pockmark dots are separate)
    moonCupSize: f32,     // pit spacing across the glint axis, px (the cell is 1.5 times that along it)
    moonCupDepth: f32,    // pit depth in height units: how steep its walls shade
    cupStretch: f32,      // cups drawn out along the glint axis into strokes this many times their length and narrower, each turned a little its own way (1: the pits, as before)
    moonRibs: f32,        // stringy light and dark strokes down steep faces, shaded by the sun (0: none)
    moonRibDepth: f32,    // stroke steepness: the gradient the strokes add (1: about 0.8 at their steepest)
    moonRibDark: f32,     // how much darker the strokes' mean is on faces turned from the sun (0: the face's own shade)
    moonFolds: f32,       // thin dark lines that follow the form across lit and moderate slopes (0: none)
    moonFoldSpacing: f32, // height units between the folds' first set of contours
    // E6 (Ice mountains).
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
    // Low ground (Zhon's mud lowland): the ground from the sea up to lowReach above it, and the shallows, take lowColor (0: none, as before).
    lowTint: f32,         // 0..1: how far the low ground's color moves to lowColor (its grain stays)
    lowReach: f32,        // height above the sea where low ground ends (its ragged edge fades over the upper half)
    lowGrain: f32,        // 0..1: the share of its grain the low ground's pattern and the water's art and mottle keep (1: as drawn)
    lowColor: vec3f,      // the low ground's color (Colors: Low ground)
    looseKnoll: f32,      // 0..1: the share of loose stones drawn as knolls, a low pale ring of ground round a hollow (0: all stones, as before)
    gougeWeb: f32,        // 0..1: a bold web of long dark gouges across raised crystal, round cells about 42 px (0: none)
    creaseShade: f32,     // 0..1: how much light a crease (a gully or valley floor, the authored height below its rings 6 and 12 px out) loses, whatever its facing (0: none)
    // H1 (lit relief, Green). Every default is the earlier look.
    closeShadow: f32,     // how much a ledge 1-6 px toward the sun darkens the direct light on the ground behind it, 0..1 (0: only the far taps)
    cavity: f32,          // how much a crevice or crack floor (surface below the mean of a ring 1-3 px out) loses of its ambient light, 0..1 (its direct light loses .45 of that; 0: off)
    // H2, H16 (the rock column of a world's table, `column` in materials/<world>.json). Every default is the earlier look.
    columnSectionCount: i32,   // sections of the column (0: the world has no column; each bed's thickness and strength come from a hash)
    columnContrast: f32,  // how much harder the hard beds are: erosion wears them 1 / (1 + 15 * this) as fast (0: all beds alike)
    columnOrigin: f32,    // the height the coordinate counts from (the plain's, or 0)
    columnBeds: array<vec4f, 32>,       // per bed: x thickness (height units), y hardness 0..1, z material slot, w unused
    columnSections: array<vec4f, 8>,    // per section, from low to high: x the coordinate it starts at, y its first bed, z its bed count, w its period
    columnWander: f32,    // the wander the coordinate takes from value noise: its amplitude, height units
    columnTerrain: vec4f, // the wander it takes from three octaves of the terrain noise (height units): xyz their amplitudes (not in the Time pass)
    materialTable: array<vec4f, 206>,   // Green (H3 materialModel): four materials of 39 rows then six placement rows, from materials/green.json (material-model.wgsl); then the 44 rows of a world's ground-cover table (card P30, its plants' row 39 and flower palette rows 40 to 43, card P31; zeros: none)
    materialFoot: f32,    // Green (H3): world px one drawn pixel covers; above 1 the draw trials a coarse resolution
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
    looseSize: f32,       // px: the median stone diameter
    looseGrid: vec4f,     // the loose-stone mask lattice: first cell (x, y) and cell counts (z, w), cells of 4 world px (looseMain)
    stoneRound: f32,      // world material data: 0 angular chips .. 1 rounded stones
    stoneSort: f32,       // world material data: 0 a mixed power-law gravel, 1 one size class sorted by the process (talus coarsens outward, fans and channels fine downslope)
    stoneSlab: f32,       // world material data: share of flat slabs
    plantsOn: f32,        // card P31: 1 when the world's ground-cover table has plants (its last row): the plant families of looseStones, which share the loose mask
    stoneMoss: f32,       // world material data: share of stones with a mossy cap
    // Card D: bounded regional fields, with every position on the world lattice.
    chunkGridOrigin: vec2f,   // first uploaded sample's global grid index
    chunkGridSize: vec2f,     // padded regional texture dimensions
    chunkGridCount: vec2f,    // supplied samples (padding repeats their last row/column)
    chunkFieldsOrigin: vec2f, // integer world pixel at baked texel (0,0)
    chunkFieldsSize: vec2f,
    chunkScreenOrigin: vec2f, // preview screen pixels; export adds floor(base/2)
    chunkScale: f32,          // World pixels per raster texel.
    chunkFieldScale: f32,     // Relief bake spacing, independent of color sampling.
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
    return max(smoothstep(u.rockFaceFrom,u.rockFaceFrom+.4,slope),smoothstep(.1,.6,paintRock))*(1.0-route);
}

// H2 rock column: the bed coordinate, in height units, at world point p for a
// rock surface at height z. The draw (the strata colours) and the erosion and weather passes (a bed's hardness) read it
// with the surface height they hold, so it depends only on (p, z). columnOffset is the part that depends on p alone (the
// erosion pass caches it): the tilt (bedDip toward bedDipDir) and the broad wander.
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
fn columnBedIn(c: f32, s: i32, variation: f32) -> ColumnBed {
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
fn columnAt(c: f32) -> ColumnBed { return columnBedIn(c, columnSectionAt(c), select(0.0,1.0,u.columnSections[columnSectionAt(c)].z==2.0)); }
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

// Painted style factor for f in -1..1 (card C5): 1 at 0 (exactly), 0 at -1,
// 4 at +1 (two doublings).
fn styleScale(f: f32) -> f32 { return select(1.0 + f, exp2(2.0 * f), f > 0.0); }
fn regionalUv(uv: vec2f) -> vec2f { return (uv * u.grid - u.chunkGridOrigin) / u.chunkGridSize; }
fn maskUv(p: vec2f) -> vec2f { return regionalUv((p / (u.size - 1.0) * (u.grid - 1.0) + 0.5) / u.grid); }

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

fn weatherAt(uv: vec2f) -> vec4f { return textureSampleLevel(gridTex, linearClamp, regionalUv(uv), 0, 0.0); }
fn timeMap2(uv: vec2f) -> vec4f { if (u.weatherMaps < 0.5) { return vec4f(0.0); } return textureSampleLevel(gridTex, linearClamp, regionalUv(uv), 2, 0.0); }
fn timeMap3(uv: vec2f) -> vec4f { if (u.weatherMaps < 0.5) { return vec4f(0.5, 0.5, 0.0, 0.0); } return textureSampleLevel(gridTex, linearClamp, regionalUv(uv), 3, 0.0); }
fn materialFieldAt(uv: vec2f) -> vec4f { return textureSampleLevel(gridTex, linearClamp, regionalUv(uv), 1, 0.0); }

// H5 override plane 17's deposits multiplier (planes 14-17: erosion, deposits, vegetation, exposure) at p: scales sand, stones and talus. 1 where nothing overrides.
fn depositsAt(p: vec2f) -> f32 {
    if (u.overrideOn == 0) { return 1.0; }
    return max(0.0, 1.0 + textureSampleLevel(masksTex, linearClamp, maskUv(p), 3, 0.0).w);
}
// H5: the Time pass's maps at world point p. layer 2: wear, wetness, hardness, slope; layer 3: fall line (-1..1), channel, ridge.
struct TimeMaps { wear: f32, wet: f32, hard: f32, slope: f32, fall: vec2f, channel: f32, ridge: f32, flow: f32, talus: f32, deposit: f32 }
fn timeMapsAt(p: vec2f) -> TimeMaps {
    let uv = p / (u.size - 1.0);
    let a = timeMap2(uv); let b = timeMap3(uv); let w = weatherAt(uv);
    return TimeMaps(a.x, a.y, a.z, a.w, b.xy * 2.0 - 1.0, b.z, b.w, w.r, w.b, w.g);
}

const MM_COVER = 162u;
fn cvr(i: u32) -> vec4f { return u.materialTable[MM_COVER + i]; }
fn coverWin(v: f32, w: vec4f) -> f32 { return smoothstep(w.x, w.y, v) * (1.0 - smoothstep(w.z, w.w, v)); }
// The two site values every class reads, moisture and light, at a point: wetness (with the wet swaths' control as its bias, and the sun's shade) and the
// sun on the broad face (level ground 1). Rock moss (engine-frag.wgsl) reads them too, so it grows where the table's moss class does.
fn coverSite(broad: vec2f, tm: TimeMaps) -> vec2f {
    let c0 = cvr(0u); let c2 = cvr(2u);
    let wn = smoothstep(c0.y, c0.z, tm.wet);
    let nb = normalize(vec3f(-broad, 1.0));
    let light = max(dot(nb, u.light), 0.0) / max(u.light.z, 0.05);
    let shade = clamp(1.0 - light, -0.6, 1.0);
    return vec2f(clamp(mix(c0.w, 1.0, wn) + c2.w * shade + c2.y * (u.wetSwath - c2.z), 0.0, 1.0), light);
}
// Soil depth at a point (0 bare, 1 deep): thin on steep and convex ground and where water wore the rock, deep in hollows and where water laid deposit.
// The seven classes read it as a window, and a tabled world's slope cover reads it as the share of thin soil (engine-frag.wgsl).
fn coverSoil(slope: f32, top: f32, tm: TimeMaps, moist: f32) -> f32 {
    let c1 = cvr(1u);
    return clamp(1.0 - smoothstep(c1.x, c1.y, slope) - c1.z * smoothstep(0.25, 0.8, top) + 0.5 * smoothstep(0.25, 0.8, -top) * c1.z + c1.w * tm.deposit + 0.2 * moist - 0.4 * tm.wear, 0.0, 1.0);
}
// The seven classes' covers at a point (groundCover in engine-frag.wgsl draws from them; looseStones in engine-bake places plants by them).
fn coverAt(slope: f32, broad: vec2f, top: f32, tm: TimeMaps, vegetation: f32) -> array<f32, 7> {
    let site = coverSite(broad, tm);
    let moist = site.x;
    let light = site.y;
    let soil = coverSoil(slope, top, tm, moist);
    let lush = clamp(1.0 + 0.5 * (vegetation - 1.0), 0.2, 1.8);
    var cover: array<f32, 7>;
    for (var k = 0u; k < 7u; k++) {
        let b = 4u + 5u * k;
        let st = cvr(b + 1u);
        var v = st.x * pow(lush, st.y);
        if (k > 0u) {
            v *= coverWin(moist, cvr(b + 2u)) * coverWin(soil, cvr(b + 3u)) * coverWin(light, cvr(b + 4u));
            v *= v;
        }
        cover[k] = v;
    }
    return cover;
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
    return textureSampleLevel(routesTex, linearClamp, maskUv(p), 0.0).r;
}
#else
// H7b: fields texel j holds the bake at world position origin + j * scale + (scale - 1) / 2 (the centre of the scale x scale block it stands
// for); at scale 1 every term below is x * 1, x / 1 or x - 0, so the lookup is the one it replaced.
fn bakedFields(p: vec2f) -> vec4f {
    let q = clamp(p, vec2f(0.0), vec2f(u.size - 1.0));
    let centre = (u.chunkFieldScale - 1.0) * 0.5;
    return textureSampleLevel(fieldsTex, linearClamp, (((q + 0.5 * u.chunkFieldScale) - u.chunkFieldsOrigin) - centre) / u.chunkFieldScale / u.chunkFieldsSize, 0.0);
}
// The texel nearest p: what a field's code is there, unblended with its neighbours'.
fn bakedFieldsNearest(p: vec2f) -> vec4f {
    let q = clamp(p, vec2f(0.0), vec2f(u.size - 1.0));
    let centre = (u.chunkFieldScale - 1.0) * 0.5;
    let t = (((q + 0.5 * u.chunkFieldScale) - u.chunkFieldsOrigin) - centre) / u.chunkFieldScale;
    return textureSampleLevel(fieldsTex, linearClamp, (floor(t) + 0.5) / u.chunkFieldsSize, 0.0);
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
fn rockWeatherAt(p:vec2f)->vec4f {
    if(u.runoff<=0.0&&u.debrisAmount<=0.0){return vec4f(0);}
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
fn rockSourceAt(p:vec2f)->vec4f {
    if(u.debrisAmount<=0.0){return vec4f(0,0,0,1);}
    return rockFieldAt(rockSourceTex,p);
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
    if(u.faceFold==0.0){return 0.0;}
    let size=max(20.0,u.faceRun);let a=radians(u.bedDipDir);
    let phase=dot(p.xy,vec2f(cos(a),sin(a)))/size*6.2831853;
    let wander=(voxelNoise(vec3f(p.xy/(size*1.6),.7))-.5)*2.4;
    return sin(phase+wander)*u.faceFold;
}
fn voxelRockSpace(p:vec3f)->vec3f {
    let a=radians(u.faceLean);let x=p.x*cos(a)+p.y*sin(a);let y=-p.x*sin(a)+p.y*cos(a);
    return vec3f(x,y,p.z+columnOffset(p.xy)+voxelFold(p));
}
struct VoxelRock {face:f32,edge:f32,tone:f32}
fn voxelBlocks(r:vec3f,size:f32)->VoxelRock {
    let tilted=vec3f(r.x-r.z*tan(radians(u.faceJointTilt)),r.y,r.z);
    let warp=vec3f(voxelNoise(r/37.0),voxelNoise((r+53.0)/43.0),voxelNoise((r-21.0)/47.0))-0.5;
    let axes=vec3f(size*u.faceStretch,size,max(2.0,u.faceBed*1.5)*u.faceBlockHeight*mix(1.0,size/max(4.0,u.faceBlockSize),u.faceScaleVary));
    // Bounded displacement varies spacing without multiplying absolute world
    // coordinates: the same rock scale remains useful far from the origin.
    let variation=(voxelNoise(tilted/(size*3.7))-.5)*size*u.faceScaleVary*2.5;
    let q=(tilted+warp*size*mix(.28,.12,u.faceScaleVary)+vec3f(variation,-variation*.7,variation*.5))/axes;
    let base=floor(q);var d1=1e8;var d2=1e8;var v1=vec3f(0);var v2=vec3f(0);var nearest=vec3f(0);
    for(var z=-1;z<=1;z++){for(var y=-1;y<=1;y++){for(var x=-1;x<=1;x++){
        let c=base+vec3f(f32(x),f32(y),f32(z));let v=c+.12+voxelRandom(c)*.76-q;let d=dot(v,v);
        if(d<d1){d2=d1;v2=v1;d1=d;v1=v;nearest=c;}else if(d<d2){d2=d;v2=v;}
    }}}
    let tilt=voxelRandom(nearest+vec3f(11,31,73))-.5;
    let plane=dot(v1,tilt)*1.15+(voxelHash(nearest+vec3f(37,5,61))-.5)*.45;
    let rounded=(.65-sqrt(d1))*1.7+(voxelHash(nearest+vec3f(37,5,61))-.5)*.25;
    return VoxelRock(mix(plane,rounded,u.faceRound),(d2-d1)/max(2.0*length(v2-v1),.001)*min(axes.x,min(axes.y,axes.z)),voxelHash(nearest)*2.0-1.0);
}
// Individual blocks retreat along their joints. Bed hardness and the block's
// own stable identity select broad scars, rather than another noise coating.
fn voxelRelease(block:VoxelRock,hard:f32)->f32 {
    let selected=smoothstep(-.35,.65,block.tone);
    return u.faceBreak*selected*smoothstep(.15,1.7,block.edge)*(.35+.65*(1.0-hard));
}
// The same cuts supply density and the depth exposed through the outer rind.
fn voxelJoint(r:vec3f,c:VoxelRock,broad:VoxelRock)->f32 {
    let width=(.65+u.faceWear*1.2)*u.faceJointWidth;
    // Coherent interruptions taper both depth and opening; they do not select
    // a different topology at zero. Fine joints subdivide the larger blocks.
    let size=max(8.0,u.faceBlockSize);
    var primary=1.0;var secondary=1.0;
    if(u.faceContinuity<1.0){
        primary=mix(smoothstep(.24,.64,voxelNoise(r/vec3f(size*2.1,size*2.1,size*1.1)+17.0)),1.0,u.faceContinuity);
        secondary=mix(smoothstep(.3,.66,voxelNoise(r/vec3f(size*.9,size*.9,size*.65)-29.0)),1.0,u.faceContinuity);
    }
    return (1.0-smoothstep(width*.25,width,c.edge))*u.faceSecondary*secondary
        +(1.0-smoothstep(width*.15,width*.85,broad.edge))*1.15*primary;
}
fn voxelDetail(r:vec3f)->f32 {
    if(u.faceDetailPatch<=0.0){return 1.0;}
    // Leave intact faces between damaged patches; the existing pitting,
    // grooves and grit retain their own amplitudes and physical scales.
    let cluster=smoothstep(.28,.65,voxelNoise(r/max(12.0,u.faceBlockSize*1.3)+vec3f(67,11,43)));
    return mix(1.0,cluster*1.6,u.faceDetailPatch);
}
fn voxelSpall(r:vec3f,c:VoxelRock,hard:f32)->f32 {
    let chip=voxelNoise(r/vec3f(max(5.0,u.faceBlockSize*.65),max(5.0,u.faceBlockSize*.65),max(3.0,u.faceBed*.8))+vec3f(19,53,7));
    return u.faceSpall*smoothstep(.32,.7,chip)*(1.0-hard*.7)*(1.0+1.8*exp(-c.edge/2.0))*3.0;
}
// Eight jittered inclusions: round pebbles through angular broken clasts.
// One field supplies both relief and mineral changes at the same 3D position.
fn voxelClasts(p:vec3f)->vec2f {
    if(u.faceClast<=0.0){return vec2f(0);}
    let q=p/max(3.0,u.faceClastSize);let b=floor(q-.5);var best=0.0;var tone=0.0;
    for(var z=0;z<=1;z++){for(var y=0;y<=1;y++){for(var x=0;x<=1;x++){
        let cell=b+vec3f(f32(x),f32(y),f32(z));let random=voxelRandom(cell+vec3f(39,7,91));
        let v=q-(cell+.5+(random-.5)*.6);let radius=.12+.45*pow(random.z,1.4);
        let metric=mix(max(abs(v.x),max(abs(v.y),abs(v.z)))*1.25,length(v),u.faceRound)/radius;
        let cap=1.0-smoothstep(.35,1.1,metric);
        if(cap>best){best=cap;tone=random.x*2.0-1.0;}
    }}}
    return vec2f(best,tone);
}
// Unequal, deformed beds use the same hardness for rock shape and wear.
fn voxelColumnCoord(p:vec3f)->f32 {
    let r=voxelRockSpace(p);
    let drift=(voxelNoise(r/vec3f(max(8.0,u.faceRun),max(8.0,u.faceRun),140.0))-.5)*2.2;
    return (columnCoord(p.xy,p.z)+voxelFold(p))*(5.5/max(2.0,u.faceBed))+drift*u.faceBed*.2*u.faceBedVary;
}
fn voxelBed(p:vec3f)->ColumnBed {
    let c=voxelColumnCoord(p);
    return columnBedIn(c,columnSectionAt(c),u.bedCycleVary);
}
fn voxelHardness(p:vec3f)->f32 {
    if(u.columnSectionCount==0){return .55;}
    return voxelBed(p).hardness;
}
// Strata: coloured bands by height on raised ground (painted desert), the colours of the column's beds (slot -> strataColors).
fn strataSlot(k: f32) -> vec3f { let i = i32(k + 0.5); return u.strataColors[clamp(i, 0, 4)].rgb; }
// The colour of the column's section s at coordinate c. A bed meets the next one over edge, a share of the cycle: a boundary inside a
// cycle is softened on both sides, the cycle's top (topFade) inside its top bed. hold (0..1) holds ground that is nearly all one bed
// (the widest bed's share of the cycle over .88) to that bed's colour: retail's pale caps are one sheet of the cool bed (card G4).
fn columnColour(c: f32, s: i32, edge: f32, topFade: bool, hold: f32) -> vec3f {
    let bed = columnBedIn(c, s, u.bedCycleVary);
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
