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
    strataColors: array<vec4f, 5>,   // rgb; uniform arrays take a 16-byte stride
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
    footRim: f32,
    crevice: f32,
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
    bandSpacing: f32,     // height between bands, height units
    bandSoftness: f32,    // share of each band that is riser
    bandLine: f32,        // darkness of the line along each riser
    sun: vec3f,           // the renderer's light, for lit crack walls
    crackMinor: f32,      // share of minor cracks inside blocks
    crackHairline: f32,   // share of hairline crazing
    crackBlocks: f32,     // how far blocks step and tilt against each other
    crackMajor: f32,      // share of major cracks
}

@group(0) @binding(0) var<uniform> u: Uniforms;
@group(0) @binding(1) var heightTex: texture_2d<f32>;   // r32float, read with textureLoad
@group(0) @binding(2) var noiseTex: texture_2d<f32>;
@group(0) @binding(3) var fracturesTex: texture_2d<f32>;
@group(0) @binding(4) var weatherTex: texture_2d<f32>;
@group(0) @binding(5) var materialFieldTex: texture_2d<f32>;
#ifdef BAKE
@group(0) @binding(6) var routesTex: texture_2d<f32>;
#else
// World-resolution fields baked once per height change: r relief height,
// g route protection or (negative) beach, b crack/line code, a sand.
@group(0) @binding(6) var fieldsTex: texture_2d<f32>;
#endif
// The world fields (height, routes, fields, weather, material field) are
// clamped and linearly filtered; noise and fractures repeat.
@group(0) @binding(7) var linearClamp: sampler;
@group(0) @binding(8) var linearRepeat: sampler;

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
    let a = vec2i(floor(q));
    let b = min(a + 1, vec2i(i32(u.grid) - 1));
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
    return textureSampleLevel(routesTex, linearClamp, (p / (u.size - 1.0) * (u.grid - 1.0) + 0.5) / u.grid, 0.0).r;
}
#else
fn bakedFields(p: vec2f) -> vec4f { return textureSampleLevel(fieldsTex, linearClamp, (p + 0.5) / u.size, 0.0); }
fn routeProtection(p: vec2f) -> f32 { return max(bakedFields(p).g, 0.0); }
fn beachField(p: vec2f) -> f32 { return max(-bakedFields(p).g, 0.0); }
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
    let support = textureSampleLevel(weatherTex, linearClamp, p / (u.size - 1.0), 0.0).b;
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
    let deposit = textureSampleLevel(materialFieldTex, linearClamp, (p / (u.size - 1.0) * (u.grid - 1.0) + 0.5) / u.grid, 0.0);
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
