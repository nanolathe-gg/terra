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
    fractureAmount: f32,
    fractureDepth: f32,
    rockyCoasts: i32,
    scree: i32,
    detail: f32,
    layered: i32,
    terraced: i32,
    coastalDetail: i32,
    reliefMode: i32,
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
    crackLit: f32,
    sandDust: f32,
    sandGrass: f32,
    bandWater: f32,
    rockCrown: f32,
    strata: f32,
    strataSpacing: f32,
    strataWarp: f32,
    strataContrast: f32,
    strataGrain: f32,
    strataColors: array<vec4f, 5>,   // rgb; uniform arrays take a 16-byte stride
    // Zone table: x start (height above the plain), y slot A, z slot B, w B's share.
    strataZones: array<vec4f, 6>,
    strataZoneCount: i32,
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
    faceEdge: f32,
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
    gullyRock: f32,
    waterSoft: f32,
    crispShore: f32,
    bankRock: f32,
    groundMode: i32,
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
    crackJagged: f32,     // kinks and bends along a crack
    crackNetwork: f32,    // 0: rills down the slope; 1: polygonal plates
    crackReach: f32,      // 0: steep faces only; 1: onto gentle slopes
    cracksOn: i32,        // the full bake computes cracks; previews skip them
    plainRelief: f32,     // faint lit lumps on level ground (appearance only)
    crackSpacing: f32,    // major crack block size, world px
    crackLength: f32,     // elongation of crack cells along the fall line
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
    bandStyle: i32,       // 0 tonal steps (Green), 1 bank lines (Lava)
    bandSpacing: f32,     // height between bands, height units
    bandSoftness: f32,    // share of each band that is riser
    bandLine: f32,        // darkness of the line along each riser
    bandWidth: f32,       // bank lines (style 1): width at half depth, px (0: 1.6)
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
    styleOn: i32,         // 1 once any cell carries a painted local style (relief, cracks, banding, face rock share)
    // Lava bank lines (card B3): how the contour lines break up (all 0: the plain contours).
    bandRelief: f32,      // share of the relief height that bends the lines, so they fold round ribs and lumps
    bandWander: f32,      // phase wander of the lines, in line steps
    bandGaps: f32,        // share of each line's stretches dropped, so lines break off and spacing widens
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
    bedLip: f32,          // lit lip on each ledge and the shaded notch under it, height units
    jointSpacing: f32,    // distance between joints, world px
    jointAngle: f32,      // joints' lean from the screen's north-south, degrees
    jointDepth: f32,      // groove depth, height units
    jointRun: f32,        // typical length of an unbroken joint, world px
    jointGaps: f32,       // share of each joint's length that is missing (0: the whole face)
    crackStyle: f32,      // cracks: 0 ink (dark floor), 1 relief (carved groove with a lit lip)
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
    // E8 (Painted Desert)
    strataZoneSpace: array<vec4f, 6>,   // x: bed thickness of each zone of strataZones, height units (0: the world's strataSpacing)
    baseBand: f32,         // the grey band at the foot of the raised ground (strata colour 5): its strength, 0 off
    baseBandLow: f32,      // lower edge of its height window, above the plain
    baseBandHigh: f32,     // upper edge
    baseBandWander: f32,   // how far the window drifts with position, height units
    baseBandGaps: f32,     // share of the band's length that is missing
    // E9 (Green rock faces). Every default reproduces the earlier output exactly.
    faceRock: f32,        // painted rock's interior is rock, with moss kept to its edges (0: moss blobs inside as before; 1: none inside)
    rockMoss: f32,        // how much of the rock art's own green (fractured and weathered tiles) is kept (1: all, as before; 0: none)
    shineOutside: f32,    // share of the rock's glints kept outside painted rock (1: everywhere, as the shine model gives them)
    rockDetail: f32,      // contrast of the rock tile's own blotches around the rock's mean colour (1: as drawn; 0: flat)
    gullyDepth: f32,      // gullies down the face: depth, height units (0: none)
    gullySpacing: f32,    // distance between gully lines, world px
    gullyWidth: f32,      // gully width across, world px
    gullyAngle: f32,      // gully lean from the screen's north-south, degrees
    gullyRun: f32,        // typical length of an unbroken gully, world px
    gullyGaps: f32,       // share of each gully's length that is missing
    gullyShade: f32,      // how dark a deep gully's floor is, as occlusion following its depth (0: lit like the rest)
    ribTilt: f32,         // ribs between gullies are planes tilted up to this, height units per px (0: level)
    bedFlow: f32,         // how far joints break and shift the beds (1: as before; 0: continuous beds)
    bedBend: f32,         // how far the beds follow the ribs' and gullies' height (0: not at all)
    bedPunch: f32,        // beds differ in strength, so a few ledges stand out (0: all alike)
    scratchDepth: f32,    // weathering scratches: depth, height units (0: none)
    scratchSpacing: f32,  // distance between scratches, world px
    scratchAngle: f32,    // scratch lean from the screen's north-south, degrees
    scratchRun: f32,      // typical length of an unbroken scratch, world px
    scratchGaps: f32,     // share of each scratch's length that is missing
    facetTilt: f32,       // angular facets: each tilted up to this, height units per px (0: none)
    facetSize: f32,       // facet height, world px
    facetStretch: f32,    // facet width as a multiple of its height
    facetStep: f32,       // step between neighbouring facets, height units
    facetSeam: f32,       // how dark the creases between facets are (0: lit like the facets)
    facetSkew: f32,       // facets' tilt in y as a share of their tilt in x (the picture squeezes steep y tilts: 1 as before, lower keeps them readable)
    facetCoarse: f32,     // a second, coarser level of facets (2.4 times the size) at this share of the tilt and step (0: none)
    // E11: shallow water round 2 (Green, Red) and Archipelago's fringe. Every default is the earlier look.
    stepSharp: f32,       // Green, Red: the shallow-to-deep step is a true threshold, ragged by pixels (0: the earlier smoothed step)
    shelfWander: f32,     // Green, Red: how far broad noise moves the step's depth, in depth units (0: the step follows the shore)
    shelfScale: f32,      // size of that wander, world px
    crackedStep: f32,     // Red: depth of the shallow-to-deep step under a cracked-bed stroke (0: the world's own step)
    crackedContrast: f32, // Red: how much of the cracked bed's light and cracks carry through its tint (0: bedContrast's own, compressed, path)
    bedCrackSlope: f32,   // Red (bake): the slope the cracked bed's cracks are cut for; the land's cracked faces are steeper (.8: as before)
    bedDots: f32,         // Red: dark dots in the lit bed, as a share of brightness (0: none)
    bedDotCell: f32,      // px between those dots (one per cell of this size, a share of cells empty)
    stepSoftPx: f32,      // Archipelago's reef bars: the true-threshold step's ramp width in px (1: a one-pixel edge, as Green and Red)
    bedMottleScale: f32,  // size of the bed's mottle lumps against Green's (1: 3-15 px; Archipelago's reef bars use larger blotches)
    bandFoot: f32,        // Archipelago (bake): no band lines on the hill's foot below this height above the dry base (0: lines everywhere)
    ringContrast: f32,    // Archipelago: contour lines in the red fringe, following the hill's outline (0: none)
    ringCount: f32,       // how many lines the fringe carries from its inner to its outer edge
    ringSize: f32,        // how far out the lines reach, against the fringe's own reach (1: as far as the ring's texture)
    bedMottle: f32,       // the lit bed's mid-scale mottle: lit lumps of 4-17 px, as a share of brightness (0: none; Green)
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
    lavaCreaseVary: f32,  // how far the dark crease at the bank steps breaks into dashes of varying darkness along each line (0: unbroken, as before)
    lavaCrust: f32,       // hill rock as pillows, chips and creases on raised ground (0: none, as before; 1: full)
    lavaPillow: f32,      // size of a pillow, px
    lavaChip: f32,        // size of a chip, px
    lavaVeins: f32,       // darkness of the veins that hang down the fall line (0: none)
    lavaCalm: f32,        // share of the fall-line relief the crust replaces on hills
    // E6 (shine fix: Moon, Ice).
    shineGate: f32,       // shine roughness only on raised ground and slopes, not the level plain (0: everywhere, as before; 1: only there)
    shineHeadroom: f32,   // dim the lit body where the lobe is low, so glints stand against it on near-white ice (0: additive only, as before)
    // E6 (Moon).
    pockmark: f32,        // dark pits scattered evenly over raised ground and slopes, tops and sides alike (0: none, as before)
    pockSize: f32,        // pit spacing across the retail glint axis, px
    // E6 (Ice mountains).
    iceSlate: f32,        // mountain faces are all rock from gentle slopes up, one monotone material (0: the rock and snow interleave, as before)
    iceCrystal: f32,      // crystal mountains: dark straight strokes in domains across the rock faces (0: none, as before)
    iceCrest: f32,        // crystal mountains: share of the raised ground under snow-white lumps (0: none)
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
#endif
}

@group(0) @binding(0) var<uniform> u: Uniforms;
@group(0) @binding(1) var heightTex: texture_2d<f32>;   // r32float, read with textureLoad
@group(0) @binding(2) var noiseTex: texture_2d<f32>;
@group(0) @binding(3) var fracturesTex: texture_2d<f32>;
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
// clamped and linearly filtered; noise and fractures repeat.
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
fn materialFieldAt(uv: vec2f) -> vec4f { return textureSampleLevel(gridTex, linearClamp, regionalUv(uv), 1, 0.0); }
#else
fn weatherAt(uv: vec2f) -> vec4f { return textureSampleLevel(gridTex, linearClamp, uv, 0, 0.0); }
fn materialFieldAt(uv: vec2f) -> vec4f { return textureSampleLevel(gridTex, linearClamp, uv, 1, 0.0); }
#endif

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
fn bakedFields(p: vec2f) -> vec4f { let q = clamp(p, vec2f(0.0), vec2f(u.size - 1.0)); return textureSampleLevel(fieldsTex, linearClamp, ((q + 0.5) - u.chunkFieldsOrigin) / u.chunkFieldsSize, 0.0); }
#else
fn bakedFields(p: vec2f) -> vec4f { return textureSampleLevel(fieldsTex, linearClamp, (p + 0.5) / u.size, 0.0); }
#endif
// Green: route protection 0..1, beach as negative, or 2 + crystal cover.
fn routeProtection(p: vec2f) -> f32 { let g = bakedFields(p).g; return select(max(g, 0.0), 1.0, g > 1.5); }
fn beachField(p: vec2f) -> f32 { return max(-bakedFields(p).g, 0.0); }
fn crystalField(p: vec2f) -> f32 { let g = bakedFields(p).g; return select(0.0, clamp(g - 2.0, 0.0, 1.0), g > 1.5); }
#endif

fn fractureDepth(p: vec2f, h: f32, slope: f32) -> f32 {
    let floorHeight = select(u.base, u.sea, u.rockyCoasts != 0);
    if (u.fractureAmount <= 0.0 || h < floorHeight + 1.0 || slope < 0.06) { return 0.0; }
    let warp = vec2f(terrainNoise(p).g, terrainNoise(p + vec2f(71.0, 43.0)).g) - 0.5;
    let crack = textureSampleLevel(fracturesTex, linearRepeat, (p + warp * 6.0) / 1024.0, 0.0);
    let distance = (1.0 - crack.r) * 8.0;
    let group = smoothstep(crack.g - 0.025, crack.g + 0.025, u.fractureAmount);
    var ground = smoothstep(0.06, 0.28, slope) * (1.0 - smoothstep(1.30, 2.20, slope));
    ground *= smoothstep(floorHeight + 1.0, floorHeight + 10.0, h);
    // Grass may bridge the finite cleft. Carving and its lit edges share the
    // same surface; this is optional authoring detail, not stored retail relief.
    let bridge = smoothstep(0.30, 0.64, terrainNoise(p + vec2f(11.0, 68.0)).g);
    // A shallow weathered shoulder carries the narrower cut. Varying its
    // section avoids a constant-width ink stroke across the grass texture.
    let width = mix(0.65, 1.15, terrainNoise(p + vec2f(91.0, 17.0)).b);
    let shoulder = 1.0 - smoothstep(0.20, 3.50 * width, distance);
    let core = 1.0 - smoothstep(0.05, 0.85 * width, distance);
    return (shoulder * 0.8 + core * 1.6) * group * ground * bridge * crack.b * u.fractureDepth * (1.0 - routeProtection(p));
}

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
    // The bake carries the cracks in this mode (relief-bake.wgsl cracks()).
    if (u.reliefMode == 1) { return h + bakedFields(p).r * u.detail + debris; }
#endif
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
    return h + detail * gain * u.detail * rough + debris - fractureDepth(p, h, slope);
}

fn surfaceGradient(p: vec2f) -> vec2f {
    const e = 1.4;
    return vec2f(surfaceHeight(p + vec2f(e, 0.0)) - surfaceHeight(p - vec2f(e, 0.0)),
                 surfaceHeight(p + vec2f(0.0, e)) - surfaceHeight(p - vec2f(0.0, e))) / (2.0 * e);
}
