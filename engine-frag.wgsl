// WGSL port of the former sculpt.frag. See sculpt-common.wgsl for naming:
// uniform uFoo is u.foo; sampler uFoo is fooTex with fooSamp.
/*COMMON*/

// Material textures, as the GLSL texture units held them. A renderer may
// bind one texture to several of these (an absent slope material reads the
// ground, as the GLSL sampler pointed at the ground's unit).
@group(1) @binding(0) var grassTex: texture_2d<f32>;
@group(1) @binding(1) var grassSamp: sampler;
@group(1) @binding(18) var paletteTex: texture_2d<f32>;
// H4: the land materials of materials/green.json, made at startup (engine-materials.wgsl): a layer per material, a mip level per footprint.
@group(1) @binding(19) var generatedTex: texture_2d_array<f32>;
// H19: the rock's height gradient (xy) and cavity (z), made with the materials (engine-materials.wgsl makeRelief).
@group(1) @binding(20) var reliefTex: texture_2d<f32>;

// Above 1x a texel is one drawn pixel, not one world pixel: the pattern comes out smaller and keeps its grain and dither.
fn grainPixel(pixel: vec2f) -> vec2f {
#ifdef CHUNK
    return pixel / min(u.chunkScale, 1.0);
#else
    return pixel;
#endif
}

// Material textures are read at one texel per pixel step: GLSL's
// texture(t, pixel / D) had implicit derivatives of exactly 1 / D per
// pixel. Explicit gradients select the same level and filter, and are legal
// in non-uniform control flow, where WGSL's textureSample is not.
// H7b: a drawn pixel covers materialFoot final pixels (1 at final), so the gradients pick the coarser level of a quarter draw.
fn pixelSample(t: texture_2d<f32>, s: sampler, pixel: vec2f, scale: vec2f) -> vec4f {
    return textureSampleGrad(t, s, pixel / scale, vec2f(u.materialFoot / scale.x, 0.0), vec2f(0.0, u.materialFoot / scale.y));
}
fn pixelSampleLayer(t: texture_2d_array<f32>, s: sampler, pixel: vec2f, scale: vec2f, layer: i32) -> vec4f {
    return textureSampleGrad(t, s, pixel / scale, layer, vec2f(u.materialFoot / scale.x, 0.0), vec2f(0.0, u.materialFoot / scale.y));
}

// Move a texture to a new base colour, keeping its grain.
fn based(c: vec3f, mean: vec3f, base: vec4f) -> vec3f { return select(c, saturate(c - mean + base.rgb), base.a > 0.5); }
// Ground pattern: its grain scaled about its mean, then moved to the base.
// A borrowed pattern (another world's) lends only its brightness grain:
// its hue variation would speckle on a different base colour.
fn groundBased(c: vec3f) -> vec3f {
    if (u.groundBorrowed != 0 && u.groundBase.a > 0.5) {
        const luma = vec3f(0.299, 0.587, 0.114);
        let grain = dot(c, luma) / max(dot(u.groundTexMean, luma), 0.02);
        return saturate(u.groundBase.rgb * (1.0 + (grain - 1.0) * u.groundContrast));
    }
    return based(u.groundTexMean + (c - u.groundTexMean) * u.groundContrast, u.groundTexMean, u.groundBase);
}
// Strata: coloured bands by height on raised ground (painted desert), the colours of the column's beds (slot -> strataColors).
fn strataSlot(k: f32) -> vec3f { let i = i32(k + 0.5); return u.strataColors[clamp(i, 0, 4)].rgb; }
// The colour of the column's section s at coordinate c. A bed meets the next one over edge, a share of the cycle: a boundary inside a
// cycle is softened on both sides, the cycle's top (topFade) inside its top bed. hold (0..1) holds ground that is nearly all one bed
// (the widest bed's share of the cycle over .88) to that bed's colour: retail's pale caps are one sheet of the cool bed (card G4).
fn columnColour(c: f32, s: i32, edge: f32, topFade: bool, hold: f32) -> vec3f {
    let bed = columnBedIn(c, s);
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
// Card E8 (Painted Desert): the grey band at the foot of retail's raised ground. Retail's
// neutral grey (mean (118,115,112)) sits in a thin height window on the first rise of the
// raised ground (world height 9-12 on a plain of 2-3; ribbons median 9 px wide on gently
// rising ground, measure/desert_greyband.py). Here the window is 4-6.5 above the plain,
// the middle of a lobe's rim, where its slope makes the ribbon that wide; the bumpy apron
// wanders it and the gaps break it into stretches.
// hf: the height above the plain; slope: units per px, which sets the edge softness.
fn baseBandMask(p: vec2f, hf: f32, slope: f32) -> f32 {
    let wander = (terrainNoise(p * 0.03 + vec2f(41.0, 7.0)).r - 0.5) * 2.0 * u.baseBandWander
               + (terrainNoise(p * 0.35 + vec2f(5.0, 63.0)).g - 0.5) * 1.5;
    let e = clamp(1.2 * max(slope, 0.05), 0.15, 1.0);
    let hh = hf + wander;
    let inside = smoothstep(u.baseBandLow - e, u.baseBandLow + e, hh) * (1.0 - smoothstep(u.baseBandHigh - e, u.baseBandHigh + e, hh));
    let gap = terrainNoise(p * 0.07 + vec2f(77.0, 3.0)).b;
    return u.baseBand * inside * smoothstep(u.baseBandGaps, u.baseBandGaps + 0.12, gap);
}

fn visibility(p: vec2f, h: f32) -> f32 {
    let toward = normalize(u.light.xy);
    let elevation = u.light.z / length(u.light.xy);
    var shadow = 0.0;
    for (var i = 1; i <= 12; i++) {
        if (u.full == 0 && i > 5) { break; }
        let d = f32(i * i) * 1.4 + 2.0;
        let q = p + toward * d;
        if (q.x < 0.0 || q.y < 0.0 || q.x >= u.size || q.y >= u.size) { continue; }
        let blocker = surfaceHeight(q) - h - d * elevation;
        shadow = max(shadow, smoothstep(-2.0, 4.0, blocker));
    }
    return 1.0 - 0.32 * shadow;
}

fn occlusion(p: vec2f, h: f32) -> f32 {
    var result = 0.0;
    for (var i = 0; i < 8; i++) {
        if (u.full == 0 && i >= 4) { break; }
        let angle = f32(i) * 2.399963;
        let d = 8.0 + f32(i % 3) * 14.0;
        let q = p + vec2f(cos(angle), sin(angle)) * d;
        result += clamp((surfaceHeight(q) - h) / d - 0.12, 0.0, 1.0);
    }
    return 1.0 - result * select(0.09, 0.045, u.full != 0);
}

// H1 close shadow: a ledge 1-6 px toward the sun shades the ground behind it. The far taps in visibility() start
// 3.4 px out, so a 1-3 px ledge never reached them. The edge is soft by how far the blocker clears the ray (the
// penumbra widens with the distance the shadow has travelled). Returns the share of the direct light that stays.
fn closeVisibility(p: vec2f, h: f32) -> f32 {
    let toward = normalize(u.light.xy);
    let elevation = u.light.z / length(u.light.xy);
    var taps = array<f32, 6>(1.0, 1.5, 2.0, 3.0, 4.0, 6.0);
    var shadow = 0.0;
    for (var i = 0; i < 6; i++) {
        let d = taps[i];
        let q = p + toward * d;
        if (q.x < 0.0 || q.y < 0.0 || q.x >= u.size || q.y >= u.size) { continue; }
        let clear = surfaceHeight(q) - h - d * elevation;
        let soft = 0.25 + 0.2 * d;
        shadow = max(shadow, smoothstep(-soft, soft, clear));
    }
    return 1.0 - u.closeShadow * shadow;
}

const CAVITY_RING_WEIGHT = array<f32, 3>(0.5, 0.3, 0.2);
const CAVITY_CONVEX = 0.15;   // how much a convex edge brightens against how much a concave floor darkens
// P12 cavity: how far the surface lies below (+) or above (-) its rings at 1, 2 and 4 px, read as a slope. Each ring is the mean of four
// taps (a cross at 1 and 4 px, a diagonal at 2 px, so the three scales also differ in direction), weighted .5, .3 and .2 and divided by its
// reach: a pit, a crack floor or the foot of a riser reads concave (up to 1), a lip or the shoulder of a ridge convex (down to
// -CAVITY_CONVEX). A plane, whatever its tilt, gives 0. Twelve taps (the full 8-tap rings, 24 taps, gave the same look at +12% of the terrain pass).
fn cavityDepth(p: vec2f, h: f32) -> f32 {
    let m1 = 0.25 * (surfaceHeight(p + vec2f(1.0, 0.0)) + surfaceHeight(p - vec2f(1.0, 0.0)) + surfaceHeight(p + vec2f(0.0, 1.0)) + surfaceHeight(p - vec2f(0.0, 1.0)));
    let m2 = 0.25 * (surfaceHeight(p + vec2f(2.0, 2.0)) + surfaceHeight(p - vec2f(2.0, 2.0)) + surfaceHeight(p + vec2f(2.0, -2.0)) + surfaceHeight(p - vec2f(2.0, -2.0)));
    let m4 = 0.25 * (surfaceHeight(p + vec2f(4.0, 0.0)) + surfaceHeight(p - vec2f(4.0, 0.0)) + surfaceHeight(p + vec2f(0.0, 4.0)) + surfaceHeight(p - vec2f(0.0, 4.0)));
    let k = CAVITY_RING_WEIGHT[0] * (m1 - h) / 1.2 + CAVITY_RING_WEIGHT[1] * (m2 - h) / 3.4 + CAVITY_RING_WEIGHT[2] * (m4 - h) / 4.8;
    return smoothstep(0.08, 0.8, k) - CAVITY_CONVEX * smoothstep(0.08, 0.8, -k);
}

// Pattern mixes (card P9): retail art shows colours the palette lacks as pixel
// mixes of palette entries (Painted Desert's tans are 50/50 pairs). The lookup's
// rows 32-287 hold eight candidates per colour, sorted dark to light, whose
// mean is the colour (Knoll, engine-palette.wgsl); a per-pixel ordered
// threshold picks one.
fn palettePattern(rgb: vec3f, threshold: f32) -> vec3f {
    let c = vec3i(clamp(floor(rgb * 31.0 + 0.5), vec3f(0.0), vec3f(31.0)));
    let at = vec2i(c.r + 32 * c.b, c.g);
#ifdef CHUNK
    // Subpixel palette patterns converge to their mixture when zoomed out.
    if(u.chunkScale>1.0){
        var sum = vec3f(0.0);
        for (var k = 0; k < 8; k++) { sum += textureLoad(paletteTex, at + vec2i(0, 32 + 32 * k), 0).rgb; }
        return sum * 0.125;
    }
#endif
    let k = min(i32(threshold * 8.0), 7);
    return textureLoad(paletteTex, at + vec2i(0, 32 + 32 * k), 0).rgb;
}
fn paletteColor(rgb: vec3f) -> vec3f {
    let c = vec3i(clamp(floor(rgb * 31.0 + 0.5), vec3f(0.0), vec3f(31.0)));
    return textureLoad(paletteTex, vec2i(c.r + 32 * c.b, c.g), 0).rgb;
}

fn uphillSoil(p: vec2f, uphill: vec2f, h: f32, reach: f32) -> f32 {
    // Nearby gentle ground supplies a connected cover layer down the face.
    // The bounded reach is authored appearance, not a retail soil simulation.
    var distances = array<f32, 4>(5.0, 14.0, 30.0, 56.0);
    var support = 0.0;
    for (var i = 0; i < 4; i++) {
        if (u.full == 0 && i > 1) { break; }
        let d = distances[i];
        let q = p + uphill * d;
        let gentle = 1.0 - smoothstep(0.50, 0.95, length(broadGradient(q)));
        let above = smoothstep(0.0, 2.0, baseHeight(q) - h);
        support = max(support, gentle * above * (1.0 - smoothstep(reach * 0.55, reach, d)));
    }
    return support;
}

fn mineralMargin(p: vec2f, slope: f32, n: vec4f) -> f32 {
    // Nearby fractured slopes feed irregular outcrops into their level crown
    // and foot. The support dies outside that neighbourhood, leaving broad
    // patterned flats quiet. Width and gaps belong to one world-space field.
    var reach = mix(9.0, 26.0, smoothstep(0.28, 0.72, n.g));
    if (u.groundFringe != 0 && u.ringAmount > 0.0) {
        let varied = mix(8.0, 48.0, smoothstep(0.20, 0.80, n.r * 0.6 + n.g * 0.4));
        reach = mix(22.0, varied, u.ringVariation) * mix(0.65, 1.60, u.ringSpread);
    }
    let neighbours = vec4f(baseHeight(p + vec2f(reach, 0.0)), baseHeight(p - vec2f(reach, 0.0)),
                           baseHeight(p + vec2f(0.0, reach)), baseHeight(p - vec2f(0.0, reach)));
    let neighbourhood = vec2f(neighbours.x - neighbours.y, neighbours.z - neighbours.w) / (2.0 * reach);
    let local = smoothstep(0.05, 0.65, slope);
    let apron = smoothstep(0.04, 0.50, length(neighbourhood)) * 0.65;
    let influence = max(local, apron);
    let pockets = (n.r - 0.5) * 0.55 + (n.g - 0.5) * 0.60;
    var result = smoothstep(0.12, 0.82, influence + pockets * smoothstep(0.0, 0.18, influence));
    if (u.groundFringe != 0) {
        // A water bank has a gradient too. This optional dry transition layer
        // needs nearby land raised above the plain, even when it reaches onto
        // flat sand outside the hill footprint.
        let source = max(baseHeight(p), max(max(neighbours.x, neighbours.y), max(neighbours.z, neighbours.w)));
        result *= smoothstep(u.base + 1.0, u.base + 7.0, source);
    }
    return result;
}

fn weatheredCover(cover: f32, deposits: vec4f, grain: vec4f) -> f32 {
    // Fine ground buries some of the source; independently transported
    // fragments survive outside it. Their support is not gated by the old edge.
    let edge = 1.0 - smoothstep(0.28, 0.82, cover);
    let clusters = grain.r * 0.45 + grain.g * 0.35 + grain.b * 0.20;
    let burial = deposits.g * (0.25 + 0.90 * smoothstep(0.36, 0.64, clusters));
    let pockets = smoothstep(0.38, 0.59, clusters) * smoothstep(0.08, 0.25, cover)
                  * (1.0 - smoothstep(0.26, 0.64, cover));
    let retained = cover * (1.0 - burial * edge) * (1.0 - pockets * 0.90);
    var remnants = max(pow(deposits.r, 0.70) * 0.80, deposits.b * 0.56)
                   * (1.0 - smoothstep(0.16, 0.65, deposits.a));
    remnants *= mix(0.20, 1.25, smoothstep(0.25, 0.73, clusters));
    let varied = max(retained, remnants);
    return clamp(varied + (clusters - 0.5) * 0.30 * sqrt(max(0.0, varied)) * edge, 0.0, 1.0);
}

// Base ground from a fixed set of 32-px tiles, randomly placed on the TNT
// tile grid, so level ground costs only uGroundTiles unique tiles. The tiles
// are measured offline from retail neighbour statistics (the table's `ground` data) and
// drawn into the first row of the ground texture at startup.
fn groundHash(q: vec3i) -> f32 {
    var n = u32(q.x) * 374761393u + u32(q.y) * 668265263u + u32(q.z) * 2246822519u;
    n = (n ^ (n >> 13u)) * 1274126177u;
    return f32(n ^ (n >> 16u)) / 4294967295.0;
}
fn groundTile(world: vec2f) -> vec3f {
    let pixel = grainPixel(world);
    let cell = vec2i(floor(pixel / 32.0));
    let local = vec2i(glslMod(floor(pixel), 32.0));
    let tile = min(i32(groundHash(vec3i(cell, 7)) * f32(u.groundTiles)), 15);
    return textureLoad(grassTex, vec2i(tile * 32 + local.x, local.y), 0).rgb;
}

// Green's land materials come from images, or (materialModel, Card H3) from the numbers in
// materials/green.json through material-model.wgsl. Every draw that wants one of them asks here.
fn matRow(i: u32) -> vec4f { return u.materialTable[i]; }
// A generated material at a drawn pixel: the level is the footprint (materialFoot, 1 at final resolution), the texel wraps with a mask.
fn genColor(layer: i32, world: vec2f) -> vec3f {
    let pixel = grainPixel(world);
    let level = clamp(i32(log2(max(u.materialFoot, 1.0)) + 0.5), 0, 6);
    let mask = vec2i((512 >> u32(level)) - 1);
    return textureLoad(generatedTex, vec2i(floor(pixel / f32(1 << u32(level)))) & mask, layer, level).rgb;
}
// The rock's relief at a drawn pixel, at the footprint's level as genColor reads the colours, so a quarter draw matches the final one.
fn rockRelief(world: vec2f) -> vec3f {
    let pixel = grainPixel(world);
    let level = clamp(i32(log2(max(u.materialFoot, 1.0)) + 0.5), 0, 6);
    let mask = vec2i((512 >> u32(level)) - 1);
    return textureLoad(reliefTex, vec2i(floor(pixel / f32(1 << u32(level)))) & mask, level).xyz;
}
// The plain keeps its 16 tiles, now built at startup from materials/green.json's `ground` data (sculpt-renderer.js), not an image file.
// H7b: at a footprint above 1 the plain's tiles are averaged over the final pixels the drawn one covers (2 x 2 at quarter), as the mip does
// for the generated materials; at final (the study included) the branch is not taken and the lookup is the one it was.
fn groundSource(pixel: vec2f) -> vec3f {
    if (u.groundMode == 0) { return genColor(u.groundLayer, pixel); }   // a world whose plain is one quilted image takes the generated layer its table's `quilt` material makes; the 16-tile plain stays in groundTile
#ifdef CHUNK
    if (u.materialFoot > 1.5) {
        return 0.25 * (groundTile(pixel + vec2f(-0.5, -0.5)) + groundTile(pixel + vec2f(0.5, -0.5)) + groundTile(pixel + vec2f(-0.5, 0.5)) + groundTile(pixel + vec2f(0.5, 0.5)));
    }
#endif
    return groundTile(pixel);
}
fn grassImage(pixel: vec2f) -> vec3f { return genColor(0, pixel); }
fn slopeGrassSource(pixel: vec2f) -> vec3f { return genColor(0, pixel); }
// The rocks keep their images until H3b: the model's noise has the rocks' grain and histogram but not their facets, and the
// Lab histogram of the rock face is worse with it (.057/.076/.083 against .049/.067/.079 by class).
fn rockSource(pixel: vec2f) -> vec3f { return genColor(1, pixel); }
fn weatheredSource(pixel: vec2f) -> vec3f { return genColor(2, pixel + vec2f(73.0, 17.0)); }
fn fracturedSource(pixel: vec2f) -> vec3f { return genColor(3, pixel); }

// H3 item 4. Where rock shows, and how much of a face is rock: the one function that decides Green's
// land placement. Its numbers are rows of materials/green.json after the five materials (MM_PLACE):
//   row 0  x: slope weight, y: form-slope weight, z: convexity weight, w: convexity range
//   row 1  x: noise weight (n.g), y: noise weight (n.r), z: weather weight, w: tap spacing, px
//   row 2  x,y: rock score start and full (the score is slope-like, about 1 on a steep face); z: weight of the third noise (n.b)
//   row 3  x: soil slope gate, y: soil height gate, z,w: soil height fade
//   row 4  x,y: low-bank source heights above the plain (rock needs land this high up-slope)
//   row 5  x,y: slope at which a smooth route stops holding rock off (start, full); z,w: with z above 0, rock only on slopes from z to w
//   row 6  x,y: face slope start and full, z: face edge noise
//   row 7  x,y: rock share at the face start and at its steepest
//   row 8  face score: x: surface roughness, y: lump top, z: fine noise, w: broad noise
//   row 9  x: gully rock, y: structured-rock order, z: painted-rock face
// Override planes (planes 14-17 of the masks; a signed value v multiplies its control by 1 + v, and 0 changes nothing):
// exposure scales where rock shows, vegetation scales the grass and moss that is left, deposits scale sand and scree
// (read outside, through Place.deposits); the erosion plane is read on the CPU side by the GPU pass.
const MM_PLACE = 156u;
fn pr(i: u32) -> vec4f { return matRow(MM_PLACE + i); }
struct Place { exposed: f32, lowBank: f32, face: f32, rockMask: f32, top: f32, faceSlope: f32, deposits: f32, vegetation: f32 }
fn landPlace(p: vec2f, h: f32, g: vec2f, broad: vec2f, slope: f32, n: vec4f, weather: vec2f, route: f32, painted: vec4f) -> Place {
    var out: Place;
    let r0 = pr(0u); let r1 = pr(1u); let r2 = pr(2u); let r3 = pr(3u); let r4 = pr(4u); let r5 = pr(5u);
    let r6 = pr(6u); let r7 = pr(7u); let r8 = pr(8u); let r9 = pr(9u);
    var exposure = 0.0;
    var vegetation = u.lushness;   // card P30: the world-wide baseline of the painted override
    out.deposits = 1.0;
    out.vegetation = 1.0 + u.lushness;
    if (u.overrideOn != 0) {
        let uv = maskUv(p);
        let planes = textureSampleLevel(masksTex, linearClamp, uv, 4, 0.0);
        vegetation = u.lushness + planes.r;
        out.vegetation = 1.0 + vegetation;
        exposure = planes.g;
        out.deposits = 1.0 + textureSampleLevel(masksTex, linearClamp, uv, 3, 0.0).w;
    }
    // Rock: the broad slope, the form's slope and convexity at the tap spacing, noise, and the weathering's wear.
    let d = r1.w;
    let west = surfaceHeight(p - vec2f(d, 0.0));
    let east = surfaceHeight(p + vec2f(d, 0.0));
    let north = surfaceHeight(p - vec2f(0.0, d));
    let south = surfaceHeight(p + vec2f(0.0, d));
    let formSlope = length(vec2f(east - west, south - north) / (2.0 * d));
    let convexity = clamp((h - 0.25 * (west + east + north + south)) / r0.w, -1.0, 1.0);
    let score = r0.x * slope + r0.y * formSlope + convexity * r0.z + (n.g - 0.5) * r1.x - weather.g * r1.z + (n.r - 0.5) * r1.y + (n.b - 0.5) * r2.z;
    var exposed = smoothstep(r2.x, r2.y, score);
    // Soil: nearby gentle ground above keeps grass on the ledges and pockets of a steep face.
    if (h > r3.y && slope > r3.x && exposed > 0.01) {
        let reach = mix(7.0, 70.0, smoothstep(0.30, 0.70, n.g));
        var soil = uphillSoil(p, broad / slope, baseHeight(p), reach);
        let ledge = (1.0 - smoothstep(0.55, 1.20, length(g))) * smoothstep(0.08, 0.40, weather.g);
        var pockets = smoothstep(0.55, 0.72, n.g * 0.55 + n.r * 0.45 + weather.g * 0.20);
        pockets *= 1.0 - smoothstep(1.55, 2.80, slope);
        soil = max(soil, max(ledge, pockets * 0.65));
        exposed *= 1.0 - smoothstep(0.12, 0.55, soil) * smoothstep(r3.z, r3.w, h);
    }
    // A low bank shows rock where it is steep and sits low; only land high up-slope lets a bank show rock to the water.
    let bank = 1.0 - smoothstep(1.0, 8.0, abs(h - u.sea - 3.0 + (n.g - 0.5) * 4.0));
    exposed = max(exposed, bank * smoothstep(0.3, 0.8, slope) * (0.4 + 0.6 * n.b) * u.bankRock);
    var lowBank = 1.0;
    if (h < u.base + 1.0) {
        let uphill = broad / max(0.001, slope);
        var source = max(baseHeight(p), baseHeight(p + uphill * 16.0));
        source = max(source, baseHeight(p + uphill * 36.0));
        source = max(source, baseHeight(p + uphill * 64.0));
        lowBank = smoothstep(u.base + r4.x, u.base + r4.y, source);
        exposed *= lowBank;
    }
    if (r5.z > 0.0) { exposed *= smoothstep(r5.z, r5.w, slope); }   // H8: mineral margins keep rock to the steep ground
    exposed *= 1.0 - route * (1.0 - smoothstep(r5.x, r5.y, slope));
    let sandBar = sandBarAt(p);
    exposed *= 1.0 - sandBar;
    exposed = 1.0 - clamp((1.0 - clamp(exposed * (1.0 + exposure), 0.0, 1.0)) * (1.0 + vegetation), 0.0, 1.0);
    // H5: the vegetation override also scales how much rock shows: +1 lets grass and moss take 40% of it back, -1 bares 40% more.
    exposed = clamp(exposed * (1.0 - 0.4 * clamp(vegetation, -1.0, 1.0)), 0.0, 1.0);
    out.exposed = exposed;
    out.lowBank = lowBank;
    // The face: lump-scale rock and moss on a slope; rock on steep flanks and in hollows, moss on tops.
    let around = 0.25 * (surfaceHeight(p - vec2f(3.0, 0.0)) + surfaceHeight(p + vec2f(3.0, 0.0))
                       + surfaceHeight(p - vec2f(0.0, 3.0)) + surfaceHeight(p + vec2f(0.0, 3.0)));
    let top = clamp((h - around) / 1.5, -1.0, 1.0);
    let edgeNoise = terrainNoise(p * 1.5 + vec2f(53.0, 11.0));
    let faceSlope = slope * (1.0 + (edgeNoise.r - 0.5) * r6.z);
    // Ice slate (iceSlate): every face from the first gentle slope up is all rock, with no snow lumps in it.
    var face = max(smoothstep(r6.x, r6.y, faceSlope), smoothstep(0.12, 0.3, faceSlope) * u.iceSlate) * (1.0 - route) * (1.0 - sandBar);
    var share = mix(mix(r7.x, r7.y, smoothstep(r6.y, r6.y * 1.8, slope)), 1.0, u.iceSlate);
    var lowGate = lowBank;
    if (u.styleOn != 0) {
        let f = styleEdge(p, textureSampleLevel(masksTex, linearClamp, maskUv(p), 2, 0.0).r, wideSlope(p));
        share = select(share * (1.0 + f), mix(share, 1.0, f), f > 0.0);
    }
    if (u.paintOn != 0) {
        face = max(face, painted.x * (1.0 - sandBar));
        share = mix(share, 0.92, painted.x);
        lowGate = max(lowBank, painted.x);
    }
    let fine = terrainNoise(p * 3.0 + vec2f(19.0, 7.0));
    let wide = 0.25 * (surfaceHeight(p - vec2f(7.0, 0.0)) + surfaceHeight(p + vec2f(7.0, 0.0))
                     + surfaceHeight(p - vec2f(0.0, 7.0)) + surfaceHeight(p + vec2f(0.0, 7.0)));
    let gully = smoothstep(0.3, 2.0, wide - h);
    let topTerm = r8.y * top * (1.0 - r9.y * painted.x);
    let faceScore = r8.x * length(g) / max(slope, 0.25) - topTerm + r9.x * gully + (fine.g - 0.5) * r8.z + (n.r - 0.5) * r8.w;
    let threshold = mix(1.4, -0.9, share);
    var rockMask = mix(smoothstep(threshold - 0.12, threshold + 0.12, faceScore) * lowGate, lowGate, u.iceFall * u.iceSlate);
    // Inside painted rock the face is rock; moss stays at its edges and on the ledges below.
    if (u.paintOn != 0) { rockMask = max(rockMask, smoothstep(0.5, 0.9, painted.x) * r9.z); }
    rockMask = 1.0 - clamp((1.0 - clamp(rockMask * (1.0 + exposure), 0.0, 1.0)) * (1.0 + vegetation), 0.0, 1.0);
    rockMask = clamp(rockMask * (1.0 - 0.4 * clamp(vegetation, -1.0, 1.0)), 0.0, 1.0);   // H5: the same 40% as the exposed rock above
    out.face = face;
    out.rockMask = rockMask;
    out.top = top;
    out.faceSlope = faceSlope;
    return out;
}

// Card P30: ground cover placed by ecosystem rules. A world whose material data carries a ground-cover table (row 0, x = 1) draws its
// grass from seven classes (0 bare soil, 1 dry grass, 2 turf, 3 meadow, 4 scrub, 5 moss, 6 wet rush) in place of the slope-only
// ramp. Each pixel has three site values from maps the Time pass already writes: moisture (wetness, with the wet swaths' control as its bias, and
// the sun's shade), soil depth (thin on steep and convex ground, deep in hollows and where water laid deposit) and light (the sun on the
// broad face, level ground 1). A class is viable inside a window of each (Cordonnier et al. 2017; Gain et al. 2017); its cover is the
// viability squared times a strength that follows Lushness (succession: grazed turf and bare ground below 1, meadow, scrub and rush above);
// a pixel draws its class from the covers by a coherent uniform that mixes patches with per-pixel noise (COVER_PATCHINESS).
// Table (MM_COVER rows): 0 x on, y wetness at which moisture starts to rise, z wetness at which it is full, w moisture of dry level ground;
// 1 x slope where soil thins, y slope where it is gone, z convex ground's loss, w deposit's gain; 2 x patch px, y moisture per unit of
// wetSwath, z wetSwath that leaves moisture as it is, w the shade's gain; 3 xyz the ground colour the class colours are measured against, w unused;
// then per class five rows: colour (rgb) and its grain, strength and Lushness exponent, and the windows of moisture, soil and light; the last row (39) holds the plants
// (card P31, engine-bake looseStones): x tuft height scale, y shrub height scale, z shrub density; zeros: no plants.
// Patchiness is a constant: 0 to 1 moves under 4% of any class's blocks on modern Green (measure/impact.py, card P30), below what a control must move.
const COVER_PATCHINESS = 0.8;
fn coverZ(p: vec2f, scale: f32) -> f32 {
    let zp = (valueNoise(p / scale + 17.0) + 0.5 * valueNoise(p / (0.45 * scale) + 31.0) + 0.25 * valueNoise(p / (0.2 * scale) + 47.0)) / 0.46;
    let c = floor(p);
    let pixel = (cellHash(c).x + cellHash(c + 7.3).x + cellHash(c + 19.1).y - 1.5) * 2.0;
    return sqrt(COVER_PATCHINESS) * zp + sqrt(1.0 - COVER_PATCHINESS) * pixel;
}
// The grass with the class this pixel draws: the class colour carries the grass art's light and dark, and keeps its chroma only within
// +-30% of that (the art's blue and red grain would otherwise swing a tan or a dark green to pink or teal).
// Card P31, flowers: dots of colour on the meadow and scrub, 1 to 2 px, in clumps of one species, drawn from the position alone (no channel through the
// bake: the draw already holds the covers, the sun and Lushness here, and a dot is a function of its pixel). The palette is the world's own: rows
// MM_COVER + 40..43 (rgb, weight; weight 0 is unused), and the density is row 39's w; none, none drawn. A pixel pair block (2 x 2 px) holds at most one dot,
// 1 px or 2 px wide; the chance of one is the density times the share of meadow and scrub here (more of both on lush ground, by their own Lushness
// exponents, and again by Lushness here), the sun on the face, and a clump field of about 10 px. A clump is one palette colour (a cell of 22 px).
// They fade out between 1 and 2 world px per pixel (chunk previews): finer than a pixel the dots would alias.
// Returns (rgb, weight). The gate is the share of open ground (no path, above the water).
fn flowersAt(p: vec2f, cover: array<f32, 7>, total: f32, light: f32, vegetation: f32, gate: f32) -> vec4f {
    let dens = cvr(39u).w;
    if (dens <= 0.0 || gate <= 0.0) { return vec4f(0.0); }
#ifdef CHUNK
    let fade = 1.0 - smoothstep(1.0, 2.0, u.chunkScale);
#else
    let fade = 1.0;
#endif
    let px = floor(p);
    let blk = floor(px * 0.5);
    let hb = cellHash(blk + vec2f(83.1, 17.7));
    if (hb.x >= dens * 4.0) { return vec4f(0.0); }
    let share = (cover[3] + 0.7 * cover[4] + 0.15 * cover[6] + 0.1 * cover[2]) / max(total, 1e-4);
    let sun = mix(0.15, 1.0, smoothstep(0.6, 1.0, light));
    let lush = clamp(1.0 + 0.5 * (vegetation - 1.0), 0.2, 1.8);
    let clump = smoothstep(0.35, 0.85, valueNoise(p / 9.0 + 7.0) * 0.5 + 0.5);
    let chance = dens * 4.0 * clump * clump * clump * share * sun * lush * gate * fade;
    if (hb.x >= chance) { return vec4f(0.0); }
    // The dot: one pixel of the block, or two side by side.
    let ho = cellHash(blk + vec2f(5.3, 61.9));
    let o = floor(ho * 2.0);
    let at = px - 2.0 * blk;
    let wide = hb.y < 0.4;
    if (!(all(at == o) || (wide && at.y == o.y))) { return vec4f(0.0); }
    // Its colour: one species to a clump, by the palette's weights.
    let pick = cellHash(floor(p / 22.0) + vec2f(41.3, 9.1)).x;
    var wsum = 0.0;
    for (var k = 0u; k < 4u; k++) { wsum += cvr(40u + k).w; }
    var acc = 0.0;
    var col = cvr(40u).rgb;
    for (var k = 0u; k < 4u; k++) {
        let c = cvr(40u + k);
        if (c.w <= 0.0) { continue; }
        acc += c.w / wsum;
        col = c.rgb;
        if (pick < acc) { break; }
    }
    return vec4f(col * (1.1 + 0.25 * ho.x), 1.0);
}
fn groundCover(p: vec2f, slope: f32, broad: vec2f, top: f32, tm: TimeMaps, vegetation: f32, grass: vec3f, gate: f32) -> vec3f {
    let c2 = cvr(2u);
    let cover = coverAt(slope, broad, top, tm, vegetation);
    var total = 0.0;
    for (var k = 0u; k < 7u; k++) { total += cover[k]; }
    let z = coverZ(p, c2.x);
    let pick = 1.0 / (1.0 + exp(-1.702 * z)) * total;
    var acc = 0.0;
    var klass = 6u;
    for (var k = 0u; k < 7u; k++) { acc += cover[k]; if (pick < acc) { klass = k; break; } }
    let col = cvr(4u + 5u * klass);
    let grain = (cellHash(floor(p) + 3.7).y - 0.5) * 2.0 * col.w;
    let ratio = grass / max(cvr(3u).rgb, vec3f(0.01));
    let tl = dot(ratio, vec3f(0.299, 0.587, 0.114));
    let ground = col.rgb * clamp(ratio, vec3f(0.7 * tl), vec3f(1.3 * tl)) * (1.0 + grain);
    let flower = flowersAt(p, cover, total, coverSite(broad, tm).y, vegetation, gate);
    return mix(ground, flower.rgb, flower.a);
}

// Moon slope marks, measured on the retail Lunar sections and the cc21
// crater (measure/slope_marks.py): crisp dark specks and short dashes on
// slopes from ~0.15, about 2 px wide and 3-7 px long, their long axis a
// median ~25-30 degrees off the screen vertical, ~0.4 of the surrounding luma, and
// flanked left and right by brighter ground (~1.15-1.25 of the local median
// 2-3 px to either side, against ~1.05 above and below). They are drawn in
// screen pixels, after shading and before the palette stage, so nothing
// blurs them. One candidate mark per 9-px cell; returns 1 in a mark, -1 on
// its flanks.
fn markHash(c: vec2i) -> vec4f {
    var s = vec4u(bitcast<vec2u>(c), 0x9e3779b9u, 0x85ebca6bu) * 1664525u + 1013904223u;
    s.x += s.y * s.w; s.y += s.z * s.x; s.z += s.x * s.y; s.w += s.y * s.z;
    s ^= s >> vec4u(16u);
    s.x += s.y * s.w; s.y += s.z * s.x; s.z += s.x * s.y; s.w += s.y * s.z;
    return vec4f(s) / 4294967296.0;
}
// The two nearest points of a lattice of jittered cells, at q in cell units: each cell of the 3 x 3 around q has its point at the cell's centre plus
// `jit` of a cell, from markHash(cell + salt). Returns the nearest's and second's hash, the nearest's cell, its offset from q's point, and both distances.
struct MarkCells { id: vec4f, id2: vec4f, home: vec2i, off: vec2f, d1: f32, d2: f32 }
fn markCells(q: vec2f, salt: vec2i, jit: f32) -> MarkCells {
    let cell = vec2i(floor(q));
    let at = fract(q);
    var m = MarkCells(vec4f(0.0), vec4f(0.0), cell, vec2f(0.0), 8.0, 8.0);
    for (var j = -1; j <= 1; j++) {
        for (var i = -1; i <= 1; i++) {
            let h = markHash(cell + vec2i(i, j) + salt);
            let pt = vec2f(f32(i), f32(j)) + 0.5 + (h.xy - 0.5) * jit - at;
            let d = length(pt);
            if (d < m.d1) { m.d2 = m.d1; m.id2 = m.id; m.d1 = d; m.id = h; m.off = -pt; m.home = cell + vec2i(i, j); }
            else if (d < m.d2) { m.d2 = d; m.id2 = h; }
        }
    }
    return m;
}
fn slopeMark(pixel: vec2f, density: f32) -> f32 {
    let cell = 9.0;
    let c = vec2i(floor(pixel / cell));
    var mark = 0.0;
    for (var j = -1; j <= 1; j++) {
        for (var i = -1; i <= 1; i++) {
            let k = c + vec2i(i, j);
            let r = markHash(k);
            if (r.x >= density) { continue; }
            let r2 = markHash(k + vec2i(7919, 104729));
            let centre = (vec2f(k) + 0.1 + 0.8 * r.yz) * cell;
            let halfLength = mix(1.3, 3.6, r.w);
            let halfWidth = mix(0.8, 1.3, r2.x);
            let angle = (r2.y - 0.5) * 1.4;
            let axis = vec2f(sin(angle), cos(angle));
            let d = pixel - centre;
            let along = dot(d, axis) / halfLength;
            let across = (d.x * axis.y - d.y * axis.x) / halfWidth;
            if (along * along + across * across < 1.0) { return 1.0; }
            let flank = across * halfWidth / (halfWidth + 2.4);
            if (along * along + flank * flank < 1.0) { mark = -1.0; }
        }
    }
    return mark;
}

// Moon joined wrinkles (card B3). The retail Lunar walls are crazed with
// connected curving dark lines and small closed pits, not the isolated specks
// slopeMark draws: lines 1-2 px wide that run along the contour, fork, close
// into loops and fade out, on faces of every steepness. They are the zero
// crossings of a stretched, warped value noise, so they join by construction;
// a finite-difference gradient gives every line one width whatever the noise
// slope. Drawn in screen pixels like the marks. Returns (dark line, lit flank).
fn wrinkleNoise(q: vec2f) -> f32 {
    let c = floor(q);
    let f = fract(q);
    let fade = f * f * (3.0 - 2.0 * f);
    let a = markHash(vec2i(c)).x;
    let b = markHash(vec2i(c) + vec2i(1, 0)).x;
    let d = markHash(vec2i(c) + vec2i(0, 1)).x;
    let e = markHash(vec2i(c) + vec2i(1, 1)).x;
    return mix(mix(a, b, fade.x), mix(d, e, fade.x), fade.y) * 2.0 - 1.0;
}
fn wrinkleField(pixel: vec2f, along: vec2f, across: vec2f, stretch: vec2f, salt: f32) -> f32 {
    let warp = vec2f(wrinkleNoise(pixel / 19.0 + salt), wrinkleNoise(pixel / 19.0 + salt + 31.7)) * 5.0;
    let d = pixel + warp;
    return wrinkleNoise(vec2f(dot(d, along) / stretch.x, dot(d, across) / stretch.y) + salt * 1.7);
}
fn wrinkleLines(pixel: vec2f, along: vec2f, across: vec2f, keep: f32, sun: vec2f, steep: f32) -> vec2f {
    var dark = 0.0;
    var lit = 0.0;
    for (var layer = 0; layer < 2; layer++) {
        // Layer 0: wrinkles stretched along the axis; layer 1: pits, dark cells ~5 px
        // across that pack closer on steeper faces (the retail walls are near-black pits
        // with light between them), from the same kind of noise.
        let stretch = select(vec2f(30.0, 6.5), vec2f(5.5, 3.5), layer == 1);
        let salt = 3.0 + 40.0 * f32(layer);
        let n0 = wrinkleField(pixel, along, across, stretch, salt);
        let gateAt = mix(0.7, -0.25, keep);
        let present = smoothstep(gateAt, gateAt + 0.25, 0.7 * wrinkleNoise(pixel / 31.0 + 7.0 + 11.0 * f32(layer)) + 0.5 * wrinkleNoise(pixel / 11.0 + 91.0 + 5.0 * f32(layer)));
        if (layer == 1) {
            let bound = mix(-0.55, -0.22, steep);
            dark = max(dark, (1.0 - smoothstep(bound - 0.05, bound + 0.05, n0)) * mix(0.35, 0.9, steep) * smoothstep(0.1, 0.4, steep + 0.3 * present));
            continue;
        }
        let nx = wrinkleField(pixel + vec2f(1.0, 0.0), along, across, stretch, salt);
        let ny = wrinkleField(pixel + vec2f(0.0, 1.0), along, across, stretch, salt);
        let grad = vec2f(nx - n0, ny - n0);
        let g = max(length(grad), 1e-3);
        // Lines where the noise crosses zero; present in patches.
        let d = abs(n0) / g;
        dark = max(dark, (1.0 - smoothstep(0.55, 1.7, d)) * present);
        // The flank on the sun side of the line, 2-3 px off.
        let toLight = select(-1.0, 1.0, dot(grad, sun) > 0.0);
        let dl = abs(n0 - toLight * 2.4 * g) / g;
        lit = max(lit, (1.0 - smoothstep(0.5, 1.8, dl)) * present);
    }
    return vec2f(dark, lit * (1.0 - dark));
}

// Moon pockmarks (card E6). Retail's hills and crater walls are one rough
// pitted surface from crest to foot, with no cracks: small dark pits about
// 2-3 px wide and 3-4 px tall, leaning with the retail glint axis, packed
// close on shaded faces (near black on dark ground) and thin on lit ones. One
// pit per cell of a lattice stretched along that axis, jittered and sized per
// cell; density is the share of cells that hold one. Returns 0..1.
fn pockPits(pixel: vec2f, size: f32, density: f32) -> f32 {
    // Retail's pits cluster and thin in patches ~40 px across, so the lattice's evenness never shows.
    let clump = 0.55 + 0.9 * (0.5 + 0.5 * wrinkleNoise(pixel / 38.0 + 5.0));
    var pit = 0.0;
    for (var layer = 0; layer < 2; layer++) {
        // Layer 1: a finer, sparser set between the large pits.
        let cell = select(size, size * 0.55, layer == 1);
        let weight = select(1.0, 0.7, layer == 1);
        let keep = select(density, density * 0.7, layer == 1) * clump;
        let q = vec2f(dot(pixel, SHINE_ACROSS) / cell, dot(pixel, SHINE_ALONG) / (cell * 1.4));
        let c = vec2i(floor(q));
        for (var j = -1; j <= 1; j++) {
            for (var i = -1; i <= 1; i++) {
                let k = c + vec2i(i, j);
                let r = markHash(k + vec2i(311 + 700 * layer, 977));
                if (r.x >= keep) { continue; }
                let centre = vec2f(k) + 0.15 + 0.7 * r.yz;
                let d = (q - centre) / vec2f(mix(0.18, 0.4, r.w), mix(0.18, 0.4, fract(r.w * 7.3)));
                pit = max(pit, weight * (1.0 - smoothstep(0.55, 1.0, dot(d, d))));
            }
        }
    }
    return pit;
}

// G8 (Moon): small lit cups. Retail's pits are not dots: each is a hollow 2-3 px wide and 4-6 px
// tall, leaning with the glint axis, whose wall turned from the sun is near black and whose
// sun side is lit, and they pack on shaded steep faces and thin out on lit ground. A pit is a
// bowl with a low lip, stood on a jittered lattice stretched along the glint axis; the function
// returns the height gradient the pits add (for the sun to shade) and a cavity weight (the
// floor, which no facing lights). density is the share of cells that hold a pit.
fn moonCups(pixel: vec2f, size: f32, density: f32, depth: f32) -> vec3f {
    let q = vec2f(dot(pixel, SHINE_ACROSS) / size, dot(pixel, SHINE_ALONG) / (size * 1.5));
    let c = vec2i(floor(q));
    var grad = vec2f(0.0);
    var cavity = 0.0;
    for (var j = -1; j <= 1; j++) {
        for (var i = -1; i <= 1; i++) {
            let k = c + vec2i(i, j);
            let r = markHash(k + vec2i(4001, 17));
            if (r.x >= density) { continue; }
            let centre = vec2f(k) + 0.15 + 0.7 * r.yz;
            // Half axes in px: 1.3-2.0 across the axis, 2.8-4.2 along it.
            let ax = mix(1.3, 2.0, r.w);
            let ay = mix(2.8, 4.2, fract(r.w * 7.3));
            let d = vec2f((q.x - centre.x) * size / ax, (q.y - centre.y) * size * 1.5 / ay);
            let s = dot(d, d);
            if (s >= 2.6) { continue; }
            // Height (s - 1) e^-s: a bowl of depth 1 at the centre, level at the rim, a low lip beyond.
            // The window ends the lip before the neighbouring cell.
            let x = clamp((s - 1.6) / 1.0, 0.0, 1.0);
            let w = 1.0 - x * x * (3.0 - 2.0 * x);
            let dw = -6.0 * x * (1.0 - x);
            let slope = exp(-s) * ((2.0 - s) * w + (s - 1.0) * dw);
            grad += depth * slope * 2.0 * (d.x * SHINE_ACROSS / ax + d.y * SHINE_ALONG / ay);
            cavity = max(cavity, 1.0 - smoothstep(0.2, 1.0, s));
        }
    }
    return vec3f(grad, cavity);
}

// G8 (Moon): the stringy relief of the shaded flank. Retail's steep walls are crossed by thin light
// and dark strokes, 1-2 px wide and 5-12 px long, leaning with the glint axis whichever way the wall
// turns; they are relief the sun shades, so the strokes whose wall faces it are light and the rest
// stay dark. Two octaves of value noise stretched along that axis; returns the height gradient they
// add (the noise's own derivative, so there is no finite difference to alias at this scale).
fn moonNoiseD(x: vec2f, salt: i32) -> vec3f {
    let i = vec2i(floor(x));
    let f = fract(x);
    let w = f * f * f * (f * (f * 6.0 - 15.0) + 10.0);
    let dw = 30.0 * f * f * (f * (f - 2.0) + 1.0);
    let a = markHash(i + vec2i(salt, 5)).x;
    let b = markHash(i + vec2i(1 + salt, 5)).x;
    let c = markHash(i + vec2i(salt, 6)).x;
    let d = markHash(i + vec2i(1 + salt, 6)).x;
    let value = a + (b - a) * w.x + (c - a) * w.y + (a - b - c + d) * w.x * w.y;
    let slope = dw * vec2f((b - a) + (a - b - c + d) * w.y, (c - a) + (a - b - c + d) * w.x);
    return vec3f(value, slope);
}
fn moonRibs(pixel: vec2f) -> vec2f {
    let across = dot(pixel, SHINE_ACROSS);
    let along = dot(pixel, SHINE_ALONG);
    let a = moonNoiseD(vec2f(across / 2.0, along / 5.5), 9100);
    let b = moonNoiseD(vec2f(across / 1.2 + 31.0, along / 2.6 + 7.0), 9300);
    // Height 2 (a - .5) + (b - .5); the chain rule takes each octave's derivative back to pixels.
    let ga = a.y * 2.0 / 2.0 * SHINE_ACROSS + a.z * 2.0 / 5.5 * SHINE_ALONG;
    let gb = b.y / 1.2 * SHINE_ACROSS + b.z / 2.6 * SHINE_ALONG;
    return ga + gb;
}

// G8 (Moon): the folds of lit slopes. Retail's gentle and moderate slopes, and the top of a dome, are
// crossed by thin, slightly dark lines, 1 px wide, that follow the form: bundles of three to six, four to
// six px apart, wandering a few px from side to side and breaking off, nested round a hill like contours
// and nothing like a straight scratch. They are contours of the sculpted height (so they follow the form
// by construction), warped by two scales of noise so they wander, in two bundles of different spacing so
// they are not a regular set, present in patches about 40 px across, and no wider than a pixel whatever
// the slope (the distance to the line is taken in px from the slope). Returns 0..1.
fn moonFolds(p: vec2f, base: f32, slope: f32, spacing: f32) -> f32 {
    let wander = 0.8 * wrinkleNoise(p / 26.0 + 13.0) + 0.5 * wrinkleNoise(p / 7.0 + 71.0) + 0.1 * wrinkleNoise(p / 3.0 + 5.0);
    var line = 0.0;
    for (var bundle = 0; bundle < 2; bundle++) {
        let gap = select(spacing, spacing * 1.9, bundle == 1);
        let t = base / gap + wander * select(1.0, 0.6, bundle == 1) + select(0.0, 0.37, bundle == 1);
        let nearest = 0.5 - abs(fract(t) - 0.5);
        let px = nearest / (slope / gap + 0.04);
        line = max(line, (1.0 - smoothstep(0.35, 1.0, px)) * select(1.0, 0.7, bundle == 1));
    }
    // Lines break off: a second, finer patch noise opens gaps along them.
    let present = smoothstep(-0.6, -0.1, wrinkleNoise(p / 40.0 + 301.0)) * smoothstep(-0.7, -0.2, wrinkleNoise(p / 9.0 + 211.0));
    return line * present * smoothstep(0.025, 0.09, slope) * (1.0 - smoothstep(0.35, 0.6, slope));
}

// Ice crystal mountains (card E6). Retail's second ice mountain (ice-1) is slate
// ruled with straight dark strokes, 1-2 px wide and 8-40 px long, spaced 3-6 px, in
// domains ~36 px across that each keep one of three directions (two steep, one
// shallow, as the window's strokes run); the strokes break into segments. Domains
// are the nearest of a jittered lattice's points. Returns 0..1, 1 on a stroke.
fn iceHatch(pixel: vec2f) -> f32 {
    let m = markCells(pixel / 36.0, vec2i(17, 53), 0.7);
    let id = m.id;
    let home = m.home;
    // Steep leaning right (72 degrees) in 45% of domains, steep leaning left (110) in 40%, shallow (29) in 15%.
    let angle = select(select(0.5, 1.92, id.z < 0.85), 1.26, id.z < 0.45) + (id.w - 0.5) * 0.25;
    let along = vec2f(cos(angle), sin(angle));
    let across = vec2f(-along.y, along.x);
    let s = dot(pixel, across) / mix(3.6, 6.0, fract(id.w * 13.7));
    let band = abs(fract(s) - 0.5);
    let stroke = 1.0 - smoothstep(0.18, 0.32, band);
    let rs = markHash(vec2i(i32(floor(s)), home.x * 7 + home.y * 13) + vec2i(101, 7));
    // Some domains are bare, some strokes of a domain are missing, and the rest break into runs of 16-42 px.
    let run = dot(pixel, along) / mix(16.0, 42.0, rs.x) + rs.y * 10.0;
    return stroke * step(0.3, id.x) * step(0.35, rs.z) * step(0.45, fract(run));
}

// Ice blocks and mesas (card G6). Retail's blocks (ice-3, Polar Range) are soft: crests are
// rounded and faces shade smoothly with no hard creases, so the light reads the height blurred
// over ~13 px (six samples a side: three offsets across each difference, so a plane's edge
// becomes a ramp instead of a line). Returns the blurred height's gradient.
fn iceSoftGradient(p: vec2f) -> vec2f {
    const R = 6.5;
    var d = vec2f(0.0);
    for (var k = -1; k <= 1; k++) {
        let o = f32(k) * R * 0.6;
        d.x += baseHeight(p + vec2f(R, o)) - baseHeight(p + vec2f(-R, o));
        d.y += baseHeight(p + vec2f(o, R)) - baseHeight(p + vec2f(o, -R));
    }
    return d / (6.0 * R);
}

// Smooth fibres down the faces of raised ice (card G6). Retail's ice-3 faces carry no grain: they
// are one dark slate crossed by fine strokes running down the slope, 1-2 px wide and 10-25 px long,
// leaning ~20 degrees (the window's structure tensor on the three faces: stroke directions 109-142
// degrees from +x with y down). Two scales of value noise stretched along that lean, -1..1.
fn iceFibre(pixel: vec2f) -> f32 {
    const ALONG = vec2f(-0.34, 0.94);
    const ACROSS = vec2f(0.94, 0.34);
    let fine = shineNoise(vec2f(dot(pixel, ACROSS) / 1.5, dot(pixel, ALONG) / 10.0) + vec2f(3.0, 11.0)).x;
    let coarse = shineNoise(vec2f(dot(pixel, ACROSS) / 3.4, dot(pixel, ALONG) / 28.0) + vec2f(29.0, 5.0)).y;
    return clamp(0.8 * fine + 0.6 * coarse, -1.0, 1.0);
}

// Longer, sparser strokes than the faces' fibres, for the apron: 1 px wide, 20-40 px long, same lean.
fn iceDrift(pixel: vec2f) -> f32 {
    const ALONG = vec2f(-0.34, 0.94);
    const ACROSS = vec2f(0.94, 0.34);
    return shineNoise(vec2f(dot(pixel, ACROSS) / 1.3, dot(pixel, ALONG) / 15.0) + vec2f(61.0, 17.0)).x;
}

// How near raised ice is, 0 far .. 1 at its foot, from rings of height samples out to ~44 px (card G6 apron).
fn iceNearness(p: vec2f) -> f32 {
    var near = 0.0;
    for (var k = 0; k < 8; k++) {
        let dir = vec2f(cos(f32(k) * 0.785398 + 0.2), sin(f32(k) * 0.785398 + 0.2));
        for (var j = 0; j < 4; j++) {
            let r = 10.0 + 14.0 * f32(j) + 2.0 * f32(j * j);
            near = max(near, smoothstep(u.base + 6.0, u.base + 24.0, baseHeight(p + dir * r)) * (1.0 - r / 72.0));
        }
    }
    return near;
}

// Fine hairlines of the Ice frost band (card G6). Retail's band (ice-1, Ice Scream) is white ice crossed by
// crisp dark-blue lines about 1 px wide, in parallel runs 3-5 px apart that keep one of the three crystal
// directions over a domain ~44 px across, the runs 8-34 px long with gaps; some domains are bare.
// `keep` is the share of domains that carry lines (1 at the coast, less inland). Returns 0..1, 1 on a line.
fn iceFrostLines(pixel: vec2f, keep: f32) -> f32 {
    let m = markCells(pixel / 44.0, vec2i(83, 29), 0.7);
    let id = m.id;
    let home = m.home;
    let angle = select(select(0.5, 1.92, id.z < 0.8), 1.26, id.z < 0.4) + (id.w - 0.5) * 0.2;
    let along = vec2f(cos(angle), sin(angle));
    let across = vec2f(-along.y, along.x);
    let s = dot(pixel, across) / mix(3.2, 5.2, fract(id.w * 11.3));
    let line = 1.0 - smoothstep(0.22, 0.4, abs(fract(s) - 0.5) * 2.0);
    let rs = markHash(vec2i(i32(floor(s)), home.x * 5 + home.y * 11) + vec2i(7, 211));
    let run = dot(pixel, along) / mix(10.0, 44.0, rs.x) + rs.y * 9.0;
    return line * mix(0.45, 1.0, rs.w) * step(id.x, keep) * step(0.25, rs.z) * step(0.35, fract(run));
}

// The beach (Zhon, the one world with the beach layer): sand where the bake found water within reach (beachField), sand bars painted to their crown
// (the baked alpha, negative) and the beach's own colour. Beach sand is a shore material, so every read of the baked beach comes through here.
fn beachColour(pixel: vec2f) -> vec3f { return based(genColor(6, pixel), u.beachTexMean, u.beachBase); }
fn beachMean() -> vec3f { return select(u.beachTexMean, u.beachBase.rgb, u.beachBase.a > 0.5); }
// The beach's cover at p, its inland edge ragged by speck (0.5: smooth); the sand bars' own cover, before sandCrown scales it.
fn beachSand(p: vec2f, speck: f32) -> f32 { return smoothstep(0.25, 0.75, beachField(p) + (speck - 0.5) * 0.5); }
fn barCover(p: vec2f) -> f32 { return smoothstep(0.15, 0.6, max(-bakedFields(p).a, 0.0)); }
fn sandBarAt(p: vec2f) -> f32 {
    if (u.sandCrown <= 0.0) { return 0.0; }
    return u.sandCrown * barCover(p);
}

// Painted material masks (card C5). paintCoverage turns the planes into 0..1
// coverage of rock, snow or ice, wet ground and moss with a ragged edge, so a
// painted border breaks up as painted sand's does; an unpainted cell (raw 0)
// stays exactly 0. Every colour is one the world already draws: its rock, its
// slope cover (moss), its lightest ground or beach (snow), its ground darkened
// as the shoreline band darkens it (wet).
fn paintCoverage(p: vec2f, slope: f32, hollow: f32) -> vec4f {
#ifdef CHUNK
    let raw = textureSampleLevel(masksTex, linearClamp, maskUv(p), 0, 0.0);
#else
    let raw = textureSampleLevel(masksTex, linearClamp, (p / (u.size - 1.0) * (u.grid - 1.0) + 0.5) / u.grid, 0, 0.0);
#endif
    return paintEdge(p, raw, slope, hollow);
}
// The lightest of the world's ground and beach materials, grain damped (snow
// lies smoother than the ground it covers) and frosted: lifted 55% toward white,
// as the sand block lifts the rock's colour by Sand light, so a dark ground
// still reads as snow with its own tint. Lift 0 would be the bare material.
fn snowMaterial(pixel: vec2f) -> vec3f {
    const luma = vec3f(0.299, 0.587, 0.114);
    var snow = groundBased(groundSource(pixel));
    var mean = select(u.groundTexMean, u.groundBase.rgb, u.groundBase.a > 0.5);
    if (u.beach != 0 && dot(beachMean(), luma) > dot(mean, luma)) { snow = beachColour(pixel); mean = beachMean(); }   // snow takes the beach when it is lighter
    return saturate(mix(mix(snow, mean, 0.50), vec3f(1.0), 0.55));
}
// Moss: the world's slope cover (leaning toward its ground by Moss from
// ground, as the face blend does), its brightness grain widened about the
// cover's mean (not its hue, which would speckle) and a little darker, so a
// patch reads as clumpy moss rather than ground.
fn mossMaterial(pixel: vec2f) -> vec3f {
    const luma = vec3f(0.299, 0.587, 0.114);
    let cover = based(slopeGrassSource(pixel), u.slopeTexMean, u.slopeBase);
    let ground = groundBased(groundSource(pixel));
    let mean = mix(select(u.slopeTexMean, u.slopeBase.rgb, u.slopeBase.a > 0.5), select(u.groundTexMean, u.groundBase.rgb, u.groundBase.a > 0.5), u.mossFromGround);
    let face = mix(cover, ground, u.mossFromGround);
    let grain = dot(face, luma) / max(dot(mean, luma), 0.02);
    return saturate(face * (1.0 + (grain - 1.0) * 0.8) * 0.85);
}

// Crystal shore slabs (card C2): water repaints whatever colour a crystal mark
// gives, so the marks of cells under water are read here. A slab's bed is lit
// paler than the water round it, slab by slab (the field's 0.8-1.0 brightness
// mark), and the 0.5 edge marks are thin dark seams.
fn crystalSlabWater(color: vec3f, mask: f32, submerged: f32) -> vec3f {
    let seam = 1.0 - smoothstep(0.58, u.crystalSeamEnd, mask);
    let fill = smoothstep(0.66, 0.8, mask);
    let jitter = clamp((mask - 0.9) * 10.0, -1.0, 1.0);
    let slab = color * (1.0 + u.crystalSeam * fill * (0.32 + 0.14 * jitter)) * (1.0 - u.crystalSeam * 0.7 * seam);
    return mix(color, slab, submerged);
}

// Crystal shallows (card E7): retail's shallow Crystal water, everywhere it is
// shallow, is a mosaic of small crystals: cells about 6-14 px across, each with its
// own brightness and a slight lean (lighter toward one side), outlined by a thin
// dark seam. The bed is art in retail (the TNT height grid is 16 px), so this
// is drawn from position, not from heights. The cells fade out as the water
// deepens, and stand aside where the larger shore slabs (the crystal field's
// marks) already cover the water.
fn crystalShallowWater(color: vec3f, p: vec2f, deep: f32, submerged: f32, slab: f32) -> vec3f {
    let size = max(u.crystalShallowPx, 4.0);
    // Two scales, as retail's mosaic has: a share of the water keeps cells 2.2 times as wide, the rest the fine ones.
    let big = markCells(p / (size * 2.2), vec2i(7919, 0), 0.9);
    var c = markCells(p / size, vec2i(0), 0.9);
    var px = size;
    if (big.id.y < 0.4) { c = big; px = size * 2.2; }
    let seam = 1.0 - smoothstep(0.3, 1.2, (c.d2 - c.d1) * 0.5 * px);
    let lean = dot(c.off, normalize(c.id.zw - 0.5 + vec2f(0.001))) * 0.5;
    let shade = 1.0 + 0.3 * (c.id.x - 0.5) + 0.35 * lean;
    // Only a fringe round the slabs: the open sea beyond reach of the slab marks (eight taps 48 px out) stays smooth, as retail's does.
    var near = smoothstep(0.05, 0.3, slab);
    for (var k = 0; k < 8; k++) { near = max(near, smoothstep(0.05, 0.3, crystalField(p + vec2f(cos(f32(k) * 0.785398), sin(f32(k) * 0.785398)) * 48.0))); }
    let w = u.crystalShallow * submerged * near * (1.0 - smoothstep(0.1, 0.55, deep)) * (1.0 - smoothstep(0.05, 0.3, slab));
    return color * (1.0 + w * (shade - 1.0)) * (1.0 - w * u.crystalShallowInk * seam);
}

// A crater's skin is the crystal field's exact value .74 (sculpt.js CRATER_SKIN). A column mound's seam ramps cross that value
// too, so a pixel counts as skin only when it and its four neighbours three px off all read it.
fn skinBand(m: f32) -> f32 { return 1.0 - smoothstep(0.012, 0.03, abs(m - 0.74)); }
fn craterSkin(p: vec2f, m: f32) -> f32 {
    var band = skinBand(m);
    for (var k = 0; k < 4; k++) {
        if (band <= 0.0) { break; }
        band = min(band, skinBand(crystalField(p + vec2f(cos(f32(k) * 1.570796), sin(f32(k) * 1.570796)) * 3.0)));
    }
    return band;
}

// Crater web (card G7, Crystal): retail's crater and hollow walls are smooth lit and shaded planes crossed by a thin dark web
// that wanders, fades in and out and varies in weight, not a tiling of crisp facets. The web is drawn here from position at
// pixel size (a field mark is two px wide, which can only draw blocky dashes): Voronoi seams of crystalCraterWebPx cells, the
// lookup bent by the world noise so the lines wander, each seam given one weight (its width, and whether it is drawn at all)
// that both of its cells agree on, and each cell a slight brightness of its own. Returns (line 0-1, cell tone).
fn craterWeb(p: vec2f) -> vec2f {
    let size = max(u.crystalCraterWebPx, 6.0);
    let warp = (terrainNoise(p * 0.25).rg - 0.5) * 2.0 * u.crystalCraterWobble;
    let m = markCells((p + warp) / size, vec2i(0), 0.9);
    let edge = (m.d2 - m.d1) * 0.5 * size;
    let w = fract((m.id.z + m.id2.z) * 7.31);
    let drawn = smoothstep(u.crystalCraterGap, u.crystalCraterGap + 0.08, w);
    let width = 0.6 + 1.0 * fract(w * 3.7 + 0.2);
    let line = (1.0 - smoothstep(width * 0.5, width * 0.5 + 0.6, edge)) * drawn;
    return vec2f(line, 1.0 + u.crystalCraterTone * (m.id.x - 0.5));
}

// H23: how much of the sun-facing crack wall's light the rock takes, the same on every world.
const CRACK_LIT = 0.35;

// Shine and roughness (card E2). Nanolathe look, not a retail claim: a
// Blinn lobe over a micro-roughened surface normal, per material, added to
// the lit colour (so it passes the highlight cap) before the palette stage.
// The camera looks along the projection's null direction (screenY = y - 0.5 h,
// so the viewer sits south and above: (0, 0.5, 1) normalised); the lobe peaks
// on a facet tilted about 21 degrees toward the sun's side, not on level
// ground, so a sharp lobe lights facets and the grain decides which.
// Retail's glints run as thin streaks ~27 degrees off the screen vertical (the
// same axis as the slope marks), so the micro-normal noise is stretched along it.
const SHINE_VIEW = vec3f(0.0, 0.4472136, 0.8944272);
const SHINE_ALONG = vec2f(0.454, 0.891);
const SHINE_ACROSS = vec2f(0.891, -0.454);
fn shineLattice(c: vec2i) -> vec2f { return markHash(c).xy * 2.0 - 1.0; }
// Smooth value noise, two decorrelated components in -1..1.
fn shineNoise(q: vec2f) -> vec2f {
    let i = vec2i(floor(q));
    let f = fract(q);
    let w = f * f * f * (f * (f * 6.0 - 15.0) + 10.0);
    return mix(mix(shineLattice(i), shineLattice(i + vec2i(1, 0)), w.x),
               mix(shineLattice(i + vec2i(0, 1)), shineLattice(i + vec2i(1, 1)), w.x), w.y);
}
// Returns (highlight to add, factor on the lit colour). g is the surface's
// height gradient, normal its normal; the weights come from coverage the
// material code already settled (rock: exposed; slope cover: the face blend
// and the sampled slope cover; sand and crystal from their baked fields).
fn shineTerm(pixel: vec2f, p: vec2f, g: vec2f, normal: vec3f, material: vec3f, exposed: f32, faceCover: f32,
             slopeCover: f32, crystalMask: f32, sunSeen: f32, landform: f32, faceRelief: f32) -> vec4f {
    var sand = smoothstep(0.35, 0.95, bakedFields(p).a);
    if (u.beach != 0) { sand = max(sand, beachSand(p, 0.5)); }   // beach sand is lit as sand
    // Crystal tops only: the risers between columns stay dark and take the
    // surrounding material's lobe (the world's own note: faces are dark at every facing).
    let crystal = smoothstep(0.05, 0.3, crystalMask) * (1.0 - smoothstep(1.2, 2.5, length(g)));
    let rock = clamp(exposed, 0.0, 1.0) * (1.0 - sand);
    let slope = clamp(max(faceCover, slopeCover), 0.0, 1.0) * clamp(1.0 - sand - rock, 0.0, 1.0);
    let ground = max(1.0 - sand - rock - slope, 0.0);
    let rest = 1.0 - crystal;
    var weight = array<f32, 5>(ground * rest, slope * rest, rock * rest, sand * rest, crystal);
    var gloss = 0.0;
    var focus = 0.0;
    var rough = 0.0;
    var scale = 0.0;
    for (var i = 0; i < 5; i++) {
        let m = u.shine[i];
        gloss += weight[i] * m.x;
        focus += weight[i] * m.x * m.y;
        rough += weight[i] * m.z;
        scale += weight[i] * m.z * m.w;
    }
    // Sharpness follows the gloss that uses it, grain scale the roughness.
    focus = max(focus / max(gloss, 1e-4), 1.0);
    scale = max(scale / max(rough, 1e-4), 1.0);
    // Card E6: the sheen and its grain only sit on raised ground and slopes (Moon's plain keeps its own
    // grain); shineGate 0 is every world's earlier shine.
    let reach = mix(1.0, landform, u.shineGate);
    rough *= reach;
    gloss *= reach;
    var micro = g;
    if (rough > 0.0) {
        let q = vec2f(dot(pixel, SHINE_ACROSS) / scale, dot(pixel, SHINE_ALONG) / (scale * max(u.shineStretch, 1.0)));
        micro = g + rough * shineNoise(q);
    }
    var grained = normalize(vec3f(-micro, 1.0));
    if (faceRelief > 0.001) {
        // The grain above is a top-down normal, which would cancel the relief's tilt on a wall: tilt the wall's own normal instead.
        let axis = select(vec3f(0.0, 0.0, 1.0), vec3f(0.0, 1.0, 0.0), abs(normal.z) > 0.95);
        let tangent = normalize(cross(axis, normal));
        let q = vec2f(dot(pixel, SHINE_ACROSS) / scale, dot(pixel, SHINE_ALONG) / (scale * max(u.shineStretch, 1.0)));
        let grain = shineNoise(q) * rough;
        grained = normalize(mix(grained, normalize(normal + tangent * grain.x + cross(normal, tangent) * grain.y), faceRelief));
    }
    // The grain tilts the facets under the diffuse light too.
    let litBefore = max(0.0, dot(normal, u.light));
    let litAfter = max(0.0, dot(grained, u.light));
    let lit = clamp((u.ambient + 0.95 * litAfter) / (u.ambient + 0.95 * litBefore), 0.5, 1.6);
    var glint = vec3f(0.0);
    var dim = 1.0;
    if (gloss > 0.0) {
        let halfway = normalize(u.light + SHINE_VIEW);
        let lobe = pow(max(dot(grained, halfway), 0.0), focus) * smoothstep(0.0, 0.15, dot(grained, u.light));
        // Seams and crack floors are gaps in shadow, not surface: no glint on black.
        let top = max(material.r, max(material.g, material.b));
        let body = smoothstep(0.04, 0.22, top);
        let tint = mix(material / max(top, 0.05), vec3f(1.0), u.shineWhite);
        glint = tint * (gloss * lobe * sunSeen * body);
        // Card E6, shine on near-white ice: adding light to a body already near white only clips, so
        // the glint has nothing to stand against and the surface reads rough, not shiny. The headroom
        // takes light off the body wherever the lobe is low and leaves it at the lobe's peak, so a
        // glint is a bright fleck over a body a little duller than the plain's.
        if (u.shineHeadroom > 0.0) { dim = 1.0 - u.shineHeadroom * clamp(gloss, 0.0, 1.0) * (1.0 - clamp(lobe, 0.0, 1.0)) * body; }
    }
    return vec4f(glint, lit * dim);
}

// H24: how far the crease at the bank steps breaks into dashes of varying darkness along each line, the same on every world.
const LAVA_CREASE_VARY = 0.2;
// E10 (Lava): retail draws the step between two shore layers as a dark line whichever way it faces, where a
// lit riser is only dark on the side turned from the sun. This is that line as a cavity: how far the four
// neighbours 2.5 px round a point stand above it (the foot of a riser has higher ground on one side; a lip
// and a flat have none), on the banks only: ground between the sea and the plain, so hills keep their own look.
fn layerCreaseTerm(p: vec2f) -> f32 {
    let h = baseHeight(p);
    let bank = smoothstep(u.sea + 0.5, u.sea + 2.0, h) * (1.0 - smoothstep(u.base - 1.5, u.base - 0.3, h));
    if (bank <= 0.0) { return 0.0; }
    const r = 2.5;
    let around = 0.25 * (baseHeight(p + vec2f(r, 0.0)) + baseHeight(p - vec2f(r, 0.0)) + baseHeight(p + vec2f(0.0, r)) + baseHeight(p - vec2f(0.0, r)));
    // G5: retail's step lines fade and break along their length; a noise of ~14 px takes whole stretches out and weakens others.
    let dash = 1.0 - LAVA_CREASE_VARY * (1.0 - smoothstep(0.36, 0.62, terrainNoise(p * 0.07 + vec2f(19.0, 43.0)).b));
    return bank * smoothstep(0.1, 0.5, around - h) * dash;
}
// E10 (Lava): shine only on slopes, so the plain stays matte while the banks and hills glint (the shine model
// weighs Lava's ground-coloured faces as ground, which is level ground's weight too). Full strength on a slope of
// shineSlopeGate and above, none at a third of it and below.
fn shineSlopeGated(shine: vec4f, slope: f32) -> vec4f {
    let gate = smoothstep(u.shineSlopeGate * 0.35, u.shineSlopeGate, slope);
    return vec4f(shine.xyz * gate, mix(1.0, shine.w, gate));
}

// The step's 2-px block jitter, -.5..+.5, and the bank's slope in height per px (the water section's two readers).
fn stepJitter(pixel: vec2f) -> f32 { return fract(sin(dot(floor(grainPixel(pixel) / 2.0), vec2f(39.3467, 11.135))) * 43758.5453) - 0.5; }
fn bankGrad(p: vec2f) -> f32 { return 0.5 * length(vec2f(baseHeight(p + vec2f(1.0, 0.0)) - baseHeight(p - vec2f(1.0, 0.0)), baseHeight(p + vec2f(0.0, 1.0)) - baseHeight(p - vec2f(0.0, 1.0)))); }

// E11: value noise for the shelf's wander (smooth, 0..1, four lattice hashes).
fn shelfHash(c: vec2f) -> f32 { return fract(sin(dot(c, vec2f(127.1, 311.7))) * 43758.5453); }
fn shelfNoise(q: vec2f) -> f32 {
    let i = floor(q);
    let f = fract(q);
    let s = f * f * (3.0 - 2.0 * f);
    return mix(mix(shelfHash(i), shelfHash(i + vec2f(1.0, 0.0)), s.x), mix(shelfHash(i + vec2f(0.0, 1.0)), shelfHash(i + vec2f(1.0, 1.0)), s.x), s.y);
}

// H24: the size (world px) of the broad noise that wanders the step's depth, the same on every world.
const SHELF_SCALE = 140.0;
// The hard shallow-to-deep step (cards E1 and E11). Retail's step is a hard edge
// with ragged stairs, not the ramp's gradual blend: it sits at one depth (the ramp's
// midpoint), read off the bed's own depth rather than the soft disc average. The
// stairs are pixel blocks in the picture, not in depth: depth units would turn a
// flat shelf into a wide fuzzy band (green-3's blurry middle), so the 2-px block
// jitter is scaled by the bed's own gradient. The step's depth wanders with broad
// noise (shelfWander units over SHELF_SCALE px), so the band's outline and width
// vary along the shore instead of following it at a fixed offset.
fn sharpDeepStep(p: vec2f, pixel: vec2f, depthIn: f32, cracked: bool) -> f32 {
    var at = 0.5 * (u.shallowDepth + u.deepDepth);
    if (cracked && u.crackedStep > 0.0) { at = u.crackedStep; }
    var depth = depthIn;
    if (u.shoalRag > 0.0) {
        // G1: the outline is notched in pixels, not in depth. Retail's step is a ragged line with notches of 2-8 px
        // and fingers, also across a gentle shelf, where the depth jitter below is the bed's gradient times
        // nothing. The depth is read where a displaced point sits: 2-px blocks (the stairs) and a 6-px noise
        // (the notches' own run), each up to shoalRag px.
        let blk = floor(grainPixel(pixel) / 2.0);
        let stairs = vec2f(shelfHash(blk + 3.7), shelfHash(blk + 19.1)) - 0.5;
        let notch = vec2f(shelfNoise(p / 6.0 + 3.0), shelfNoise(p / 6.0 + 41.0)) - 0.5;
        depth = depth + baseHeight(p) - baseHeight(p + (stairs * 0.8 + notch * 1.6) * u.shoalRag);
    }
    let grad = bankGrad(p);
    let jitter = stepJitter(pixel);
    let q = p / SHELF_SCALE;
    let wander = ((shelfNoise(q + 17.0) * 0.55 + shelfNoise(q * 2.7 + 5.0) * 0.3 + shelfNoise(q * 7.0 + 29.0) * 0.15) - 0.5) * 2.0 * u.shelfWander;
    // The wander fades in with depth, so the shore side of the band keeps its own width.
    let d = depth - jitter * 4.0 * max(grad, 0.05);
    return smoothstep(-0.5, 0.5, (d - (at + wander * smoothstep(1.0, at, depth))) / (max(grad, 0.04) * max(u.stepSoftPx, 1.0)));
}

// E11: contour lines in Archipelago's red fringe. Retail's fringe is a stack of thin wavy
// lines 2-4 px apart that follow the hill's outline (a hill's border, not a texture laid on
// the screen). The mineral field's own falloff is the outline's distance measure: the
// weathering worker's source falls off about exponentially from the hill, so lines at equal
// steps of its logarithm are equally spaced in px, whatever the hill's shape. Pixel width
// comes from the field's gradient. field: the material field's source (.b); returns the
// line colour and its weight.
fn fringeField(q: vec2f) -> f32 {
    return log(max(materialFieldAt((q / (u.size - 1.0) * (u.grid - 1.0) + 0.5) / u.grid).b, 1e-4));
}
fn fringeContours(p: vec2f, field: f32) -> vec4f {
    if (u.ringContrast <= 0.0 || u.materialReady == 0) { return vec4f(0.0); }
    let outer = 0.004 / max(u.ringSize * u.ringSize, 0.05);
    if (field < outer * 0.5 || field > 0.65) { return vec4f(0.0); }
    const e = 2.0;
    let grad = 0.5 / e * length(vec2f(fringeField(p + vec2f(e, 0.0)) - fringeField(p - vec2f(e, 0.0)),
                                      fringeField(p + vec2f(0.0, e)) - fringeField(p - vec2f(0.0, e))));
    let scale = max(u.ringCount, 1.0) / max(log(0.3 / outer), 0.5);
    let wobble = (shelfNoise(p / 7.0 + 13.0) - 0.5) * 1.7 + (shelfNoise(p / 2.6 + 71.0) - 0.5) * 0.8;
    let k = -log(max(field, 1e-4)) * scale + wobble;
    let rate = max(grad * scale, 0.02);
    let f = fract(k);
    let line = 1.0 - smoothstep(0.3, 0.9, min(f, 1.0 - f) / rate);
    let dash = smoothstep(0.25, 0.6, shelfNoise(p / 8.0 + 91.0));
    let zone = smoothstep(outer * 0.5, outer * 3.0, field) * (1.0 - smoothstep(0.25, 0.6, field)) * smoothstep(0.04, 0.12, rate);
    let tone = mix(vec3f(0.50, 0.16, 0.28), vec3f(0.30, 0.12, 0.13), smoothstep(0.02, 0.3, field));
    return vec4f(tone, line * dash * zone * u.ringContrast);
}

// G3: the red fringe as stacked, offset copies of the hill's outline. Retail steps out from the
// hill in many thin crimson outlines, each a copy of the foot moved a few px from the last, so
// they cross and scallop instead of nesting (the owner's "offset faded copies"). Copy j is the
// same softened outline the concentric lines read, at its own level and at its own offset (a
// hashed direction around ringShiftDir, wandering slowly across the map, a length up to
// ringShift), with scalloped lobes in its edge. The field is a Gaussian blur of the hill, whose
// tail falls as exp(-d^2): the square root of its negative logarithm is therefore about
// proportional to the distance from the hill, so levels at equal steps of that measure are
// equally spaced in px, where equal steps of the logarithm would crowd into the far tail. Its edge
// is a line one px wide, whose distance in px comes from the measure's gradient at the pixel
// (copies sit within a few px, where it barely changes). Outer copies are drawn first so inner
// lines lie over them. base: the ground so far.
fn ringHash(k: f32) -> f32 { return fract(sin(k * 12.9898 + 78.233) * 43758.5453); }
// How far a copy's outline bulges at p, -0.4..0.6 of ringWobble: round lobes about jittered centres (one per
// ringLobe px cell, new for each copy) that meet in inward cusps, as a union of discs outlines. A noise waver
// would only ripple the line; retail's copies read as overlapping scales.
fn ringScallop(p: vec2f, seed: f32) -> f32 {
    let q = p / max(u.ringLobe, 4.0);
    let c = floor(q);
    var nearest = 4.0;
    for (var dy = -1; dy <= 1; dy++) {
        for (var dx = -1; dx <= 1; dx++) {
            let cell = c + vec2f(f32(dx), f32(dy)) + vec2f(seed * 17.0, seed * 5.0);
            let at = c + vec2f(f32(dx), f32(dy)) + vec2f(shelfHash(cell), shelfHash(cell + vec2f(57.3, 31.1)));
            nearest = min(nearest, distance(q, at));
        }
    }
    let x = clamp(nearest / 0.7, 0.0, 1.0);
    return sqrt(1.0 - x * x) - 0.4;
}
fn ringReachMeasure(q: vec2f) -> f32 { return sqrt(max(-fringeField(q), 0.01)); }
// H24: the outermost copy's line is this much fainter than the innermost's, the same on every world.
const RING_TAPER = 0.35;
fn fringeCopies(base: vec3f, p: vec2f, field: f32) -> vec3f {
    if (u.ringContrast <= 0.0 || u.materialReady == 0) { return base; }
    let outer = 0.004 / max(u.ringSize * u.ringSize, 0.05);
    if (field < outer * 0.3 || field > 0.65) { return base; }
    let zone = smoothstep(outer * 0.3, outer * 1.5, field) * (1.0 - smoothstep(0.45, 0.7, field));
    if (zone <= 0.0) { return base; }
    let count = i32(clamp(u.ringCount, 1.0, 24.0));
    let inner = sqrt(-log(0.45));
    let far = sqrt(-log(outer));
    let tone = mix(vec3f(0.50, 0.16, 0.28), vec3f(0.30, 0.12, 0.13), smoothstep(0.02, 0.3, field));
    // Each copy tints what it covers (ringFill: the tint where every copy overlaps, so the skirt steps
    // lighter outward) and the reach of the stack varies along the outline (ringPatch).
    let fillStep = 1.0 - pow(1.0 - clamp(u.ringFill, 0.0, 0.95), 1.0 / f32(count));
    let fillTone = vec3f(0.70, 0.70, 0.50);
    let span = (shelfNoise(p / max(u.ringPatchSize, 20.0) + 53.0) * 0.65 + shelfNoise(p / (0.37 * max(u.ringPatchSize, 20.0)) + 11.0) * 0.35);
    let reach = mix(2.0, smoothstep(0.3, 0.7, span) * 1.05, u.ringPatch);
    var rgb = base;
    for (var n = 0; n < count; n++) {
        let j = f32(count - 1 - n);
        let t = j / max(f32(count - 1), 1.0);
        let vis = 1.0 - smoothstep(reach - 0.12, reach + 0.12, t);
        let level = mix(inner, far, (j + 0.5) / f32(count));
        let wander = (shelfNoise(p / 170.0 + j * 7.3) - 0.5) * 2.0;
        let angle = radians(u.ringShiftDir) + ((ringHash(j + 1.0) - 0.5) * 2.0 + wander * 0.5) * u.ringScatter * 3.14159;
        let shift = u.ringShift * (0.45 + 0.55 * ringHash(j + 41.0));
        let at = p - shift * vec2f(cos(angle), sin(angle));
        let waver = ringScallop(p, j) * u.ringWobble;
        // The copy's own gradient: the field's tail is not uniform, and a line drawn from the pixel's
        // gradient fattens into blobs where the copy lies on a flatter stretch.
        const e = 3.0;
        let here = ringReachMeasure(at);
        let slope = length(vec2f(ringReachMeasure(at + vec2f(e, 0.0)) - here, ringReachMeasure(at + vec2f(0.0, e)) - here)) / e;
        let d = (here - level) / max(slope, 0.012) + waver;
        let line = 1.0 - smoothstep(0.3, 0.75, abs(d));
        let gap = 0.75 + 0.25 * smoothstep(0.15, 0.5, shelfNoise(p / 11.0 + 91.0 + j * 5.1));
        let inside = 1.0 - smoothstep(-0.7, 0.7, d);
        rgb = mix(rgb, fillTone, inside * fillStep * zone * vis);
        // Retail's lines run from a dusky rose (155, 91, 99) on the inner copies to a pale one (215, 163, 179) on the outer.
        let lineTone = mix(tone, mix(vec3f(0.55, 0.27, 0.31), vec3f(0.84, 0.62, 0.68), t), u.ringTone);
        rgb = mix(rgb, lineTone, line * gap * zone * vis * (1.0 - RING_TAPER * t) * u.ringContrast);
    }
    return rgb;
}

// E11: dark dots in the lit bed. Retail's lilac lake shows small dark dots (3-4 px, one every
// 12-20 px, blue-purple) that the ground tiles' fine grain does not give (dark components
// of >= 3 px average 6.5-11 px in retail against 4.3-6.7 in ours). One jittered dot per
// cell of bedDotCell screen px, a share of cells empty; 0..1 coverage.
fn bedDotField(pixel: vec2f) -> f32 {
    let cell = max(u.bedDotCell, 6.0);
    let c = floor(pixel / cell);
    let r = vec2f(shelfHash(c + 3.1), shelfHash(c + 91.7));
    let centre = (c + 0.2 + 0.6 * r) * cell;
    let radius = 1.5 + 1.0 * shelfHash(c + 47.3);
    let present = step(0.3, shelfHash(c + 11.9));
    return present * (1.0 - smoothstep(radius - 0.6, radius + 0.4, length(pixel - centre)));
}

// G1: the shallow bed's lit bumps. Retail's shallows read as lit, bumpy ground under a tint: lumps
// with a bright side toward the sun and a shaded side away from it, not noise. The bumps are a
// height field of three octaves (about 5, 9 and 17 px at shoalBumpPx 6, weighted so each octave
// gives about the same slope), lit like the ground by the same sun, and returned as the light
// they change against level ground (1 on a flat). Positions are the world position only.
fn shoalHeight(p: vec2f) -> f32 {
    let z = max(u.shoalBumpPx, 2.0) / 6.0;
    return shelfNoise(p / (5.0 * z) + 11.0) * 0.5 + shelfNoise(p / (9.0 * z) + 47.0) * 0.8 + shelfNoise(p / (17.0 * z) + 83.0) * 1.4;
}
fn shoalBumpLight(p: vec2f) -> f32 {
    const e = 1.0;
    let slope = u.shoalBump * 0.5 / e * vec2f(shoalHeight(p + vec2f(e, 0.0)) - shoalHeight(p - vec2f(e, 0.0)),
                                              shoalHeight(p + vec2f(0.0, e)) - shoalHeight(p - vec2f(0.0, e)));
    let normal = normalize(vec3f(-slope, 1.0));
    let flatLight = u.ambient + 0.95 * u.light.z;
    return min((u.ambient + 0.95 * max(0.0, dot(normal, u.light))) / flatLight, u.lightCap);
}

// H24: how much of a cracked bed's light and cracks carry through its tint, the same on every world.
const CRACKED_CONTRAST = 0.45;
// Shallow water as the bed under it (card E1): the ground colour already lit at
// this pixel, moved toward the water's own hue. The tint keeps the bed's light
// (its brightness against flat ground), so lumps, shade and grain carry through;
// bedTint is how much of the bed's own colour the tint replaces.
fn litBed(bed: vec3f, cracked: bool) -> vec3f {
    const luma = vec3f(0.299, 0.587, 0.114);
    let level = max(dot(groundBased(u.groundTexMean), luma), 0.02);
    // Shade stays paler under water than on land (retail's shaded bank beds show
    // as soft darker blue, never as black rims), so the dark side carries less.
    // A cracked bed (E11) is rock-like ground: its cracks keep their depth, both sides, at CRACKED_CONTRAST.
    let ratio = clamp(dot(bed, luma) / level, select(0.25, 0.1, cracked), 2.0);
    var contrast = u.bedContrast;
    var darkSide = 0.6;
    if (cracked) { contrast = CRACKED_CONTRAST; darkSide = 1.0; }
    let light = pow(ratio, select(contrast * darkSide, contrast, ratio >= 1.0));
    let tint = u.shallowMean * light * u.bedBright;
    return saturate(mix(bed, tint, u.bedTint));
}
// Ice frost band (card E5): the frost stroke marks every cell of its band with a
// little protection, and where frostWet is 1 those cells keep the white of the
// level snow instead of the grey the wet band gives the bank near the sea.
fn frostDry(near: f32, route: f32) -> f32 { return near * (1.0 - u.frostWet * smoothstep(0.02, 0.04, route)); }

// ---- The mineral margins and the sediment transition ----
// Nearby fractured slopes feed outcrops into their level crown and foot (the mineral margins); a table with a fringe, a ring or a body
// layer adds the fringe, the ring veins and the sediment transition. Each block is gated by a uniform, never by a world. The generated
// layers it reads come from the table's `order`: 0 slope grass, 1 rock, 2 weathered, 3 fractured, 4 fringe, 5 transition body,
// 6 beach, 7 mineral ring (fetched like the engine's own generated materials, genColor; layer 7 is the last).
// The state drawMineralMargins leaves for joinSedimentTransition to finish:
var<private> transitionGround: vec3f;
var<private> transitionFace: vec3f;
var<private> transitionLow: vec3f;
var<private> transitionPower: f32;
var<private> transitionCore: f32;
var<private> transitionShared: bool;

// Edits the slope cover and, for the shared transition, leaves the state joinSedimentTransition finishes.
fn drawMineralMargins(p: vec2f, h: f32, slope: f32, n: vec4f, pixel: vec2f, grass: vec3f, sediments: vec4f, brokenSediments: vec4f,
                      materialWeather: f32, fringeVariation: f32, slopeGrass: ptr<function, vec3f>, slopeCover: ptr<function, f32>) {
    transitionGround = grass; transitionFace = grass; transitionLow = grass; transitionPower = 1.0; transitionCore = 0.0; transitionShared = false;
    if (u.mineralMargins == 0) { return; }
    var cover = mineralMargin(p, slope, n);
    // Some biome hills keep their mineral material across the crown. Elevation also gives their foot a broad transition into sand.
    var elevated = smoothstep(u.base + u.elevatedCover.x, u.base + u.elevatedCover.y, h + (n.g - 0.5) * 5.0);
    if (u.groundFringe != 0) { elevated *= smoothstep(u.base + 0.25, u.base + 2.0, baseHeight(p)); }
    cover = mix(cover, max(min(cover, 0.28), elevated), u.elevatedCover.z);
    if (u.groundFringe == 0) { cover = mix(cover, weatheredCover(cover, sediments, n), materialWeather); }
    // Softer native mineral fragments carry the fringe before the deeper connected cracks take over on the face.
    let fringe = genColor(4, pixel);
    *slopeGrass = mix(fringe, *slopeGrass, smoothstep(0.42, 0.88, cover));
    // Native fissures reach farther than their brighter mineral fill. Fade through that structure instead of blurring two full images.
    let stone = dot(*slopeGrass, vec3f(0.299, 0.587, 0.114));
    let edge = (0.26 - stone) * 0.9 + (n.b - 0.5) * 0.12;
    *slopeCover = smoothstep(0.04, 0.96, cover + edge * 4.0 * cover * (1.0 - cover)) * smoothstep(u.slopeProfile.z, u.slopeProfile.w, h);
    if (u.groundFringe == 0) { return; }
    // This fringe already contains native ground plus thin vein tails. Preserve its pixels before the darker face arrives.
    let face = genColor(0, pixel);
    let detail = (0.35 - dot(face, vec3f(0.299, 0.587, 0.114))) * 0.12;
    *slopeGrass = mix(fringe, face, smoothstep(0.20, 0.78, cover + detail));
    if (u.ringAmount > 0.0) {
        // A connected native vein material occupies its own irregular zone before the brown core.
        let zone = cover + ((n.r - 0.5) * 0.38 + (n.g - 0.5) * 0.22) * u.ringVariation * smoothstep(0.0, 0.12, cover);
        let spread = mix(0.60, 1.80, u.ringSpread);
        let ring = genColor(7, pixel);
        let vein = smoothstep(u.fringeRange.x, u.fringeRange.y, dot(ring, u.fringeSignal.rgb) + u.fringeSignal.a);
        let tail = smoothstep(0.005, 0.19, max(0.0, zone));
        let ringMask = smoothstep(0.06, 0.42, zone * spread + vein * 0.15) * tail * mix(0.30, 1.0, max(vein, smoothstep(0.16, 0.40, zone)));
        var margin = mix(grass, fringe, tail * mix(0.25, 1.0, vein));
        margin = mix(margin, ring, ringMask * u.ringAmount);
        *slopeGrass = mix(margin, face, smoothstep(0.22, 0.96, zone + detail));
    }
    *slopeCover = smoothstep(0.01, 0.28, cover) * smoothstep(u.slopeProfile.z, u.slopeProfile.w, h);
    if (materialWeather > 0.0 && u.transitionBody != 0) {
        // The worker's spatially softened source measures a join across world pixels; all three materials use that coordinate.
        var source = sediments.b;
        let variation = ((n.r - 0.5) * 0.08 + (n.g - 0.5) * 0.04) * fringeVariation;
        source = clamp(source + variation * 4.0 * source * (1.0 - source), 0.0, 1.0);
        let ring = genColor(7, pixel);
        let body = genColor(5, pixel);
        let vein = smoothstep(u.fringeRange.x, u.fringeRange.y, dot(ring, u.fringeSignal.rgb) + u.fringeSignal.a);
        let arrivals = max(source * 1.30, sediments.r * 0.55) * exp2((u.ringSpread - 0.70) * 2.0);
        var fine = smoothstep(0.002, 0.23 + 0.5 * u.ringFade, arrivals * (1.0 + 0.6 * u.ringFade));
        fine *= 1.0 - sediments.g * smoothstep(0.38, 0.63, n.r * 0.55 + n.g * 0.45) * 0.75;
        let fill = smoothstep(0.018, 0.17 + 0.4 * u.ringFade, arrivals * (1.0 + 0.6 * u.ringFade));
        let ringWeight = fine * mix(fill, 1.0, vein) * u.ringAmount;
        transitionGround = mix(grass, ring, ringWeight);
        var warm = smoothstep(0.02, 0.54, source);
        let warmGrain = 0.52 - dot(body, vec3f(0.299, 0.587, 0.114));
        warm = clamp(warm + warmGrain * 0.5 * 4.0 * warm * (1.0 - warm), 0.0, 1.0);
        transitionGround = mix(transitionGround, body, warm);
        if (u.ringShift > 0.0) { transitionGround = fringeCopies(transitionGround, p, sediments.b); }
        else {
            let contours = fringeContours(p, sediments.b);
            transitionGround = mix(transitionGround, contours.rgb, contours.a);
        }
        if (u.transitionDetail > 0.0) {
            let uv = grainPixel(pixel) / 512.0;
            let groundLow = select(textureSampleLevel(grassTex, grassSamp, uv, 3.0).rgb, textureSampleLevel(generatedTex, linearRepeat, uv, max(u.groundLayer, 0), 3.0).rgb, u.groundLayer >= 0);
            let ringLow = textureSampleLevel(generatedTex, linearRepeat, uv, 7, 3.0).rgb;
            let bodyLow = textureSampleLevel(generatedTex, linearRepeat, uv, 5, 3.0).rgb;
            transitionLow = mix(mix(groundLow, ringLow, ringWeight), bodyLow, warm);
            transitionPower = ((1.0 - ringWeight) * (1.0 - ringWeight) + ringWeight * ringWeight) * (1.0 - warm) * (1.0 - warm) + warm * warm;
        }
        transitionFace = face;
        transitionCore = smoothstep(0.23, 0.88, source);
        let faceGrain = 0.35 - dot(face, vec3f(0.299, 0.587, 0.114));
        transitionCore = clamp(transitionCore + faceGrain * 0.35 * 4.0 * transitionCore * (1.0 - transitionCore), 0.0, 1.0);
        transitionShared = true;
    } else if (materialWeather > 0.0) {
        let interruption = max(0.0, sediments.a - brokenSediments.a) * (1.0 - smoothstep(0.40, 0.90, cover));
        let crust = max(0.0, cover - interruption * 1.35);
        var zone = weatheredCover(crust, sediments, n);
        zone = max(zone, brokenSediments.a * 0.36 * (1.0 - smoothstep(0.05, 0.35, sediments.a)));
        let ring = genColor(7, pixel);
        let vein = smoothstep(u.fringeRange.x, u.fringeRange.y, dot(ring, u.fringeSignal.rgb) + u.fringeSignal.a);
        let arrivals = max(sediments.b * 1.30, sediments.r * 0.55) * exp2((u.ringSpread - 0.70) * 2.0);
        var fine = smoothstep(0.002, 0.23 + 0.5 * u.ringFade, arrivals * (1.0 + 0.6 * u.ringFade));
        fine *= 1.0 - sediments.g * smoothstep(0.38, 0.63, n.r * 0.55 + n.g * 0.45) * 0.75;
        let veil = smoothstep(0.06, 0.78, zone);
        var margin = mix(grass, fringe, veil * 0.55);
        let fill = smoothstep(0.018, 0.17 + 0.4 * u.ringFade, arrivals * (1.0 + 0.6 * u.ringFade));
        margin = mix(margin, ring, fine * mix(fill, 1.0, vein) * u.ringAmount);
        if (u.ringShift > 0.0) { margin = fringeCopies(margin, p, sediments.b); }
        else {
            let contours = fringeContours(p, sediments.b);
            margin = mix(margin, contours.rgb, contours.a);
        }
        let core = smoothstep(0.22, 0.96, max(0.0, cover - interruption * 0.6) + (n.b - 0.5) * 0.12) * smoothstep(0.02, 0.35, sediments.a);
        margin = mix(margin, face, core);
        *slopeGrass = mix(mix(grass, *slopeGrass, *slopeCover), margin, materialWeather);
        *slopeCover = 1.0;
    }
}

// The shared transition's one join to warm mineral and sand: exposed rock belongs inside the face family and cannot repaint a second hard perimeter.
fn joinSedimentTransition(material: vec3f, pixel: vec2f, rock: vec3f, exposed: f32, materialWeather: f32) -> vec3f {
    if (!transitionShared) { return material; }
    let face = mix(transitionFace, rock, exposed);
    var refined = mix(transitionGround, face, transitionCore);
    if (u.transitionDetail > 0.0) {
        let uv = grainPixel(pixel) / 512.0;
        let faceLow = textureSampleLevel(generatedTex, linearRepeat, uv, 0, 3.0).rgb;
        var rockLow = textureSampleLevel(generatedTex, linearRepeat, uv, 1, 3.0).rgb;
        rockLow = saturate(u.rockMean + (rockLow - u.rockMean) * u.mineralDetail);
        let low = mix(transitionLow, mix(faceLow, rockLow, exposed), transitionCore);
        let facePower = (1.0 - exposed) * (1.0 - exposed) + exposed * exposed;
        let power = transitionPower * (1.0 - transitionCore) * (1.0 - transitionCore) + facePower * transitionCore * transitionCore;
        // Mixing independent native grains reduces their variance. Recover only the local detail; the accepted broad colour join stays put.
        let gain = mix(1.0, min(1.65, inverseSqrt(max(0.1, power))), u.transitionDetail);
        refined = low + (refined - low) * gain;
    }
    return mix(material, refined, materialWeather);
}

// Card P27, Surf: the shore as one cross-shore coordinate. surfShore marches 8 rays from the pixel over the height field and returns x, the signed
// distance in world px to the drawn waterline (onshore +; the drawn edge sits where the bed is 0.6 under the sea, so the bank's own run is added),
// the nearest shore point q, a coordinate along the coast that value noise can use, and the bed's slope there (units per px). Beyond SURF_REACH, or where the height is more than a beach
// above or a surf zone below the sea, x is 1e3. Every term is a function of position, so a chunk replays to the same bytes.
const SURF_REACH = 104.0;
fn surfShore(p: vec2f) -> vec4f {
    let h0 = baseHeight(p) - u.sea;
    let dry = h0 >= 0.0;
    if ((dry && h0 > 12.0) || (!dry && h0 < -16.0)) { return vec4f(1.0e3, 0.0, 0.0, 0.0); }
    var radii = array<f32, 13>(1.5, 3.0, 5.0, 8.0, 12.0, 17.0, 24.0, 33.0, 44.0, 56.0, 70.0, 86.0, 104.0);
    var best = SURF_REACH;
    var q = p;
    for (var k = 0; k < 8; k++) {
        let a = f32(k) * 0.785398 + 0.2;
        let dir = vec2f(cos(a), sin(a));
        var lastR = 0.0;
        var lastH = h0;
        for (var i = 0; i < 13; i++) {
            let r = radii[i];
            if (lastR >= best) { break; }
            let hr = baseHeight(p + dir * r) - u.sea;
            if ((hr >= 0.0) != dry) {
                let d = lastR + (r - lastR) * lastH / (lastH - hr);
                if (d < best) { best = d; q = p + dir * d; }
                break;
            }
            lastR = r;
            lastH = hr;
        }
    }
    if (best >= SURF_REACH) { return vec4f(1.0e3, 0.0, 0.0, 0.0); }
    let slope = max(bankGrad(p), 0.12);
    return vec4f(select(-best, best, dry) + 0.6 / slope, q, slope);
}
// The beach the surf builds: the berm crest 3 + 45 Surf px from the water (the heights' own, coastBeach in engine-shape.wgsl: 0.3 + 2.2 Surf units tall).
// Surf works from 0: surfBeach is how much of a beach there is (the square root, so a small Surf already shows: the sand's share, its cusps, the wet reach, the breakers).
fn surfBeach(e: f32) -> f32 { return sqrt(clamp(e, 0.0, 1.0)); }
fn surfBerm(e: f32) -> f32 { return 3.0 + 45.0 * e; }
// How much of the beach is sand: none at a little Surf (a wet strip and foam, as a lake has), flecks from about .18, all of it from .6.
fn surfSandAmt(e: f32) -> f32 { return clamp((e - 0.08) / 0.52, 0.0, 1.0); }
// The cross-shore coordinate with the beach cusps: horns that push the swash seaward every ~26 px along the coast.
fn surfCuspX(x: f32, q: vec2f, e: f32) -> f32 {
    return x + 3.5 * e * surfBeach(e) * (0.5 + 0.5 * valueNoise(q / 13.0 + vec2f(5.1, 2.7))) * (1.0 - smoothstep(surfBerm(e) * 0.7, surfBerm(e) * 1.1, x));
}
// The beach's sand as a share (0..1, thick at the water, thinning inland) that sandCoverAt draws through, as the deposits' sand is drawn: the edge is a scatter of
// clumps with the grass regrowing through it, not a line. Where the share ends wanders along the coast (headlands of sand and bays of grass, 41 and 17 px), its
// width changes (12 to 36 px), and position noise at 14 and 6 px sends grass tongues into the sand and sand patches into the grass. It ends before SURF_REACH, past which
// surfShore knows no shore.
fn surfSand(x: f32, q: vec2f, p: vec2f, e: f32) -> f32 {
    let along = valueNoise(q / 41.0 + vec2f(3.3, 8.1)) * 0.5 + 0.5;
    let near = valueNoise(q / 17.0 + vec2f(1.7, 6.2)) * 0.5 + 0.5;
    let ragged = 9.0 * valueNoise(p / 14.0 + vec2f(5.0, 1.0)) + 4.0 * valueNoise(p / 6.0 + vec2f(2.0, 9.0));
    let end = min(surfBerm(e) + 8.0 + 24.0 * along + 8.0 * near + ragged, SURF_REACH - 6.0);
    let width = 14.0 + 24.0 * (valueNoise(q / 61.0 + vec2f(8.8, 2.2)) * 0.5 + 0.5);
    return clamp((end - surfCuspX(x, q, e)) / width, 0.0, 1.0) * step(0.0, x) * surfSandAmt(e);
}
// The wet sand up to the last uprush (1 where wet). The band is the world's wet band, at least 1 px, grown with Surf to half the berm.
fn surfWet(x: f32, q: vec2f, p: vec2f, e: f32) -> f32 {
    let reach = (0.5 + 0.25 * valueNoise(q / 30.0)) * surfBerm(e) * surfBeach(e) + 1.0;
    // The last uprush dries out gradually (over a quarter of the reach) along a ragged line (the swash leaves tongues and dry flecks), not a 2 px step.
    let ragged = 0.18 * reach * valueNoise(p / 7.0 + vec2f(4.4, 1.1));
    return (1.0 - smoothstep(reach - 1.5 - 0.25 * reach, reach + 1.0, surfCuspX(x, q, e) + ragged)) * step(0.0, x);
}
// Foam at a pixel, static (hashed per art pixel): on the water a lace at the waterline and, with Surf, a broken breaker line along an isobath
// with spray behind it; on the wet sand a 1 px swash front. depth is the bed under the sea (0 on land).
fn surfFoam(pixel: vec2f, p: vec2f, x: f32, q: vec2f, depth: f32, slope: f32, e: f32) -> f32 {
    let cell = floor(grainPixel(pixel));
    if (x < 0.0) {
        let xs = -x;
        // The lace is a broken fringe, not a line: along the coast it comes and goes in runs of about 6 to 25 px (value noise on the shore coordinate at 11 and 37 px),
        // its width swells from 1 px to 2-4 px where the run is strong (more with Surf), its inner edge is ragged, and a few single bubbles stand off it. Hashed per art pixel.
        let run = 0.5 + 0.5 * valueNoise(q / 11.0 + vec2f(2.3, 5.7));
        let long = 0.5 + 0.5 * valueNoise(q / 37.0 + vec2f(6.1, 1.9));
        let gate = smoothstep(0.30, 0.52, mix(run, long, 0.45) + 0.2 * surfBeach(e));
        let w = (0.9 + (0.8 + 1.8 * surfBeach(e)) * smoothstep(0.35, 0.9, run)) * (0.75 + 0.5 * long);
        let edge = xs + 0.5 * (1.0 + valueNoise(p / 3.0)) + 0.4 * valueNoise(p / 1.7 + 8.0);
        let fringe = (1.0 - smoothstep(0.45 * w, w, edge)) * step(shelfHash(cell + 47.0), mix(0.92, 0.7, smoothstep(1.2, 3.5, w)));
        let bubbles = step(shelfHash(cell + 48.0), 0.05 + 0.07 * surfBeach(e)) * smoothstep(0.8, 1.6, xs) * (1.0 - smoothstep(2.5, 3.0 + w, xs)) * smoothstep(0.35, 0.7, long);
        let lace = max(fringe * gate, bubbles * gate);
        // The breakers stand on the isobath where the water is 1.5 + 3 Surf units deep (over a bar, on its crest), in px along the bed's slope.
        let ofBreak = (depth - (1.5 + 3.0 * e)) / slope + 0.5 * valueNoise(p / 6.0);
        let breaking = smoothstep(-0.15, 0.2, valueNoise(q / 40.0 + vec2f(0.5, 3.0)) + e - 0.8);
        // The crest breaks into runs of 5 to 20 px that swell and thin (0.5 to 2.5 px), so the breakers are a chain of whitecaps and not one line.
        let cap = 0.5 + 0.5 * valueNoise(q / 8.0 + vec2f(3.7, 9.1));
        let crest = (1.0 - smoothstep(0.35, 0.6 + 1.9 * cap, abs(ofBreak))) * breaking * smoothstep(0.25, 0.5, cap + 0.2 * valueNoise(q / 29.0)) * step(shelfHash(cell + 74.0), 0.8);
        let spray = (1.0 - smoothstep(1.5, 4.0, -ofBreak)) * smoothstep(0.0, 1.5, -ofBreak) * breaking * step(shelfHash(cell + 75.0), 0.18);
        return clamp(max(lace, (crest + spray) * e * surfBeach(e)), 0.0, 1.0);
    }
    let xf = 1.5 + 0.3 * surfBerm(e) * (0.5 + 0.5 * valueNoise(q / 22.0 + vec2f(2.0, 8.0)));
    let front = (1.0 - smoothstep(0.3, 1.0, abs(surfCuspX(x, q, e) - xf))) * step(shelfHash(cell + 45.0), 0.7) * surfBeach(e) * smoothstep(-0.1, 0.25, valueNoise(q / 30.0 + vec2f(9.0, 1.0)));
    return front * 0.85;
}
// Weathered rock and its grains: a biome's sand, from the rock's own mean and the world's Sand row and colour. The deposits and the surf's beach draw it.
fn sandWeathered() -> vec3f {
    let rockAverage = select(u.rockTexMean, u.rockBase.rgb, u.rockBase.a > 0.5);
    let weathered = mix(vec3f(mix(rockAverage, vec3f(dot(rockAverage, vec3f(0.299, 0.587, 0.114))), 0.25)), vec3f(1.0), u.sandLight * 0.55);
    return select(weathered, u.sandBase.rgb, u.sandBase.a > 0.5);
}
// How much of a pixel the sand covers, from the sand's share there (0..1): over the thinning edge a scatter of clumps 3 to 8 px across,
// with the ground's grass and moss regrowing through it in tufts (regrowth scales them: 1 for the deposits, less on the surf's beach near the water). The deposits' sand and the surf's beach draw through it.
fn sandCoverAt(sand: f32, p: vec2f, regrowth: f32) -> f32 {
    let speck = terrainNoise(p * 6.0 + vec2f(17.0, 29.0)).b;
    // Over the thinning edge sand is a scatter of clumps 3 to 8 px across, more of them the thicker it is, not a line: each clump
    // takes the sand where the sand's share beats the clump's own threshold; deep sand covers every clump, as before.
    let clump = (valueNoise(p / 3.7 + 29.0) * 0.5 + 0.5) * 0.55 + (valueNoise(p / 8.3 + 61.0) * 0.5 + 0.5) * 0.45;
    let threshold = 0.22 + 0.68 * smoothstep(0.25, 0.75, clump);
    let scatter = smoothstep(threshold - 0.07, threshold + 0.07, sand);
    let solid = smoothstep(0.35, 0.95, sand + (speck - 0.5) * 0.55 * u.sandEdge);
    let cover = mix(scatter, solid, smoothstep(0.6, 0.95, sand));
    // Grass and moss travel with the sand and regrow over it in
    // patches, more where it is thin; tufts break the patch edges.
    let patchy = terrainNoise(p * 0.35 + vec2f(51.0, 7.0)).g * 0.65 + terrainNoise(p * 1.3 + vec2f(3.0, 91.0)).b * 0.35;
    let tuft = terrainNoise(p * 5.0 + vec2f(13.0, 47.0)).r;
    // Where the sand thins toward its edge the ground shows through in tufts: the thinner, the more the tufts decide and the
    // more of the patch's own regrowth pushes through (the edge is a scatter 3 to 8 px across, not a line).
    let thin = 1.0 - smoothstep(0.35, 0.95, sand);
    let regrow = smoothstep(0.62, 0.80, patchy + (1.0 - sand) * 0.22 + thin * 0.42 + (tuft - 0.5) * (0.3 + 0.7 * thin)) * u.sandGrass * regrowth;
    return cover * (1.0 - regrow);
}
fn sandMaterialAt(scatter: vec2f) -> vec3f {
    let rockLevel = u.rockTexMean;
    let weathered = sandWeathered();
    var fragment = genColor(2, scatter);
    fragment = mix(fragment, vec3f(1.0), u.sandLight * 0.45);
    if (u.sandBase.a > 0.5) { fragment = saturate(fragment - rockLevel + u.sandBase.rgb); }
    return mix(weathered, fragment, u.sandGrain);
}

@fragment
fn fragmentMain(v: VertexOut) -> @location(0) vec4f {
    // GLSL's gl_FragCoord (origin bottom left; the canvas is u.size high).
#ifdef CHUNK
    // H7b: an output texel covers chunkScale final pixels, so its screen position is scaled back (x * 1 at final).
    let fragCoord = vec2f(v.position.x * u.chunkScale + u.chunkScreenOrigin.x, u.size - (v.position.y * u.chunkScale + u.chunkScreenOrigin.y));
#else
    let fragCoord = vec2f(v.position.x, u.size - v.position.y);
#endif
    let p = v.world;
    // TA's fixed camera permits a native-pixel material grain. World-XY
    // sampling stretches that grain over projected south-facing slopes.
    // Geometry and broad material decisions still use world coordinates.
    var pixel = vec2f(fragCoord.x, u.size - fragCoord.y);
#ifdef CHUNK
    // Stable, stratified native-pixel sampling: retain the material distribution
    // without locking every preview texel to one phase of a repeating grain.
    if (u.chunkScale > 1.0) {
        let cell = vec2u(floor(pixel / u.chunkScale));
        var h = cell.x * 374761393u + cell.y * 668265263u;
        h = (h ^ (h >> 13u)) * 1274126177u; h = h ^ (h >> 16u);
        let phase = vec2f(f32(h & 65535u), f32(h >> 16u)) / 65536.0;
        pixel = vec2f(cell) * u.chunkScale + floor(phase * u.chunkScale) + 0.5;
    }
#endif
    // Sand grains read the rock at a noise-scattered coordinate; GLSL took
    // that lookup's level from implicit derivatives. WGSL allows derivatives
    // only in uniform control flow, so they are taken here, before any branch.
    let scatter = pixel * 1.37 + vec2f(terrainNoise(p * 2.0).r, terrainNoise(p * 2.0 + 9.0).g) * 40.0;
    let scatterDx = dpdx(scatter);
    let scatterDy = dpdy(scatter);
    let h = surfaceHeight(p);
    let g = surfaceGradient(p);
    let broad = broadGradient(p);
    // Card G6: raised ice is lit by its blurred height (the gradient g keeps the relief for everything else).
    var iceMesa = 0.0;
    var gSoft = g;
    if (u.iceSoft > 0.0 || u.iceSnow > 0.0 || u.iceApron > 0.0 || u.iceFall > 0.0) {
        iceMesa = smoothstep(u.base + 1.5, u.base + 8.0, baseHeight(p));
        gSoft = iceSoftGradient(p);
    }
    var gLit = g;
    if (u.iceSoft > 0.0) { gLit = mix(g, gSoft, u.iceSoft * iceMesa); }
    var normal = normalize(vec3f(-gLit, 1.0));
    let n = terrainNoise(p);
    let sediments = select(vec4f(0.0), materialFieldAt((p / (u.size - 1.0) * (u.grid - 1.0) + 0.5) / u.grid), u.materialReady != 0);
    let fringeVariation = u.ringVariation / 0.75;
    let drift = ((terrainNoise(p * 0.65 + vec2f(133.0, 71.0)).rg - 0.5) * 66.0 + (n.gb - 0.5) * 16.0) * fringeVariation;
    let brokenSediments = select(sediments, materialFieldAt(((p + drift) / (u.size - 1.0) * (u.grid - 1.0) + 0.5) / u.grid), u.materialReady != 0);
    let materialWeather = select(0.0, u.materialWeathering, u.materialReady != 0);
    let weather = weatherAt(p / (u.size - 1.0)).rg;
    let slope = length(broad);
    let route = routeProtection(p);
    // Painted masks (card C5): coverage of rock, snow, wet ground and moss.
    // Rock takes the face treatment below; the others mix after the beds.
    var painted = vec4f(0.0);
    if (u.paintOn != 0) {
        // Hollow: how far below its surroundings the relief lies here (the face blend's top, negated).
        let around = 0.25 * (surfaceHeight(p - vec2f(3.0, 0.0)) + surfaceHeight(p + vec2f(3.0, 0.0)) + surfaceHeight(p - vec2f(0.0, 3.0)) + surfaceHeight(p + vec2f(0.0, 3.0)));
        painted = paintCoverage(p, wideSlope(p), clamp((around - h) / 1.5, -1.0, 1.0));
    }
    // H19: TA's camera is fixed and oblique, so a wall that faces the viewer spreads one world pixel over several screen pixels (a screen
    // row is 1 - broad.y / 2 world rows: above 1), and everything baked in world space smears down it. Only a wall facing the viewer
    // stretches (broad.y < 0 there; one facing away compresses and keeps the world-space look). Where the rock stands on such a wall,
    // its relief is lit in screen pixels instead: the atlas's gradient on the broad face's normal, its cavity for the top-down one.
    let place = landPlace(p, h, g, broad, slope, n, weather, route, painted);
    let faceRelief = smoothstep(1.5, 3.0, 1.0 - 0.5 * broad.y)
                   * clamp(max(place.exposed, place.face * place.rockMask * u.microRock), 0.0, 1.0) * u.faceRelief;
    var faceCavity = 0.0;
    if (faceRelief > 0.001) {
        let relief = rockRelief(pixel);
        let formNormal = normalize(vec3f(-broad, 1.0));
        // Heightfield normals have n.z > 0, so this frame is continuous at every facing.
        let a = 1.0 / (1.0 + formNormal.z);
        let b = -formNormal.x * formNormal.y * a;
        let tangent = vec3f(1.0 - formNormal.x * formNormal.x * a, b, -formNormal.x);
        let bitangent = vec3f(b, 1.0 - formNormal.y * formNormal.y * a, -formNormal.y);
        normal = normalize(mix(normal, formNormal, faceRelief) - (relief.x * tangent + relief.y * bitangent) * faceRelief);
        faceCavity = relief.z;
    }
    let flatLight = u.ambient + 0.95 * u.light.z;
    var lighting = (u.ambient + 0.95 * max(0.0, dot(normal, u.light))) / flatLight;
    lighting = min(lighting, u.lightCap);
    let ao = occlusion(p, h);
    let shadow = visibility(p, max(h, u.sea));
    // H1: ledge shadow and crevices at the scale of a pixel, from the same surface. Full draws only (a drag keeps today's taps).
    var closeVis = 1.0;
    var cav = 0.0;
    if (u.full != 0) {
        if (u.closeShadow > 0.0) { closeVis = closeVisibility(p, max(h, u.sea)); }
        if (u.cavity > 0.0) { cav = mix(u.cavity * cavityDepth(p, h), u.cavity * faceCavity, faceRelief); }
    }
    var shading = lighting * ao * shadow;
    var lightTint = vec3f(1.0);
    // Open lit level ground keeps its brightness under any light colour (the tint is divided by its luma), so a colour changes hue and the
    // light-to-shade balance and never the exposure; white on both is exactly 1.
    let flatTintLuma = 1.0 + dot((u.ambient * (u.skyColor - 1.0) + 0.95 * u.light.z * (u.sunColor - 1.0)) / flatLight, vec3f(0.2126, 0.7152, 0.0722));
    if (u.separateLight != 0) {
        // Cast shadows attenuate the direct sun. The ambient term already
        // receives local occlusion, so shadowing it again buries dark faces.
        let direct = max(0.0, dot(normal, u.light));
        // Optional authored sky/bounce fill keeps unlit steep faces from all
        // hitting one dark floor. Flat ground and sunlit surfaces retain their
        // accepted response; this does not move the sculpted surface.
        let fill = u.faceFill * (1.0 - normal.z) * (1.0 - smoothstep(0.0, 0.50, direct));
        // Retail Green casts no shadows onto level ground: gate cast shadow
        // and occlusion by slope, with knobs for other looks.
        let onSlope = smoothstep(0.08, 0.35, slope);
        let castShadow = mix(1.0, shadow, mix(u.flatShadow, 1.0, onSlope)) * closeVis;
        let occluded = mix(1.0, ao, mix(u.flatOcclusion, 1.0, onSlope));
        let skyShare = u.ambient * (1.0 - cav) + fill;
        let sunShare = 0.95 * direct * castShadow * (1.0 - 0.45 * cav);
        shading = min((skyShare + sunShare) / flatLight, u.lightCap) * occluded;
        // The share of the light that is sky takes the sky's colour and the share that is sun the sun's; white on both is exactly 1.
        lightTint = 1.0 + (skyShare * (u.skyColor - 1.0) + sunShare * (u.sunColor - 1.0)) / max(skyShare + sunShare, 0.0001);
    } else {
        let skyShare = u.ambient;
        let sunShare = 0.95 * max(0.0, dot(normal, u.light)) * shadow;
        lightTint = 1.0 + (skyShare * (u.skyColor - 1.0) + sunShare * (u.sunColor - 1.0)) / max(skyShare + sunShare, 0.0001);
    }
    lightTint /= max(flatTintLuma, 0.05);
    // Retail Lava faces stay close to the ground's tone whichever way they
    // look (luma regressed on the height gradient: ~8 per unit slope east to
    // west against our 20; measured on four maps), so its world keeps only
    // part of the directional shading.
    if (u.shadeDepth < 1.0) { shading = mix(1.0, shading, u.shadeDepth); lightTint = mix(vec3f(1.0), lightTint, u.shadeDepth); }
    // G5 (Lava): rock turned from the sun, or in a cast shadow, goes darker than the diffuse term alone gives (retail's far sides are near black).
    // Retail's small hills keep nearly the plain's tone on their far sides; the dark masses are the tall hills', so it grows with height.
    // Only faces turned from the sun take it (n.l from .5 down to .1), so a flank that faces the light is not darkened by its occlusion.
    if (u.lavaDusk > 0.0 && shading < 1.0) { shading = pow(max(shading, 0.0), 1.0 + u.lavaDusk * smoothstep(u.base + 20.0, u.base + 60.0, baseHeight(p)) * (1.0 - smoothstep(0.1, 0.5, dot(normal, u.light)))); }
    let timeMaps = timeMapsAt(p);
    var grass = groundBased(groundSource(pixel));
    let grass0 = grass;
    // The model's slope grass costs noise taps, so the slope and face blocks share one read.
    // Level ground (slope under the cover ramp's start, no painted rock) never mixes it in, so it skips the taps.
    var slopeBased = vec3f(0.0);
    // Card P30: a world with a ground-cover table has no slope ramp: its slope cover is the share of thin soil (the table's soil depth, which
    // is what bares and dries the ground there), and the slope texture is read wherever the soil is not full.
    let tabled = cvr(0u).x > 0.5;
    var thinSoil = 0.0;
    if (tabled) { thinSoil = 1.0 - smoothstep(0.1, 0.5, coverSoil(slope, place.top, timeMaps, coverSite(broad, timeMaps).x)); }
    // A tabled world reads it wherever a consumer can be: the thin soil, the faces' moss, and the rock that shows (a face, wear's outcrops from slope .3).
    let slopeTexWanted = select(slope > u.slopeProfile.x, thinSoil > 0.0 || place.face > 0.0 || place.exposed > 0.0 || (u.outcrop > 0.0 && slope > 0.3), tabled);
    if (slopeTexWanted || u.paintOn != 0 || u.mineralMargins != 0) { slopeBased = based(slopeGrassSource(pixel), u.slopeTexMean, u.slopeBase); }
    // The level ground before any slope cover, for crystal tops (crystalGrain).
    let levelGround = grass;
    var slopeShare = 0.0;
    var faceCover = 0.0;   // share of the face that is moss, not rock (the shine's slope cover)
    if (u.slopeMaterial != 0) {
        // Small native slope interiors retain moss ribs and scattered stone.
        // This is an appearance material, not recovered albedo or geometry.
        var slopeGrass = slopeBased;
        var slopeCover = select(smoothstep(u.slopeProfile.x, u.slopeProfile.y, slope) * smoothstep(u.slopeProfile.z, u.slopeProfile.w, h), thinSoil, tabled);
        drawMineralMargins(p, h, slope, n, pixel, grass, sediments, brokenSediments, materialWeather, fringeVariation, &slopeGrass, &slopeCover);
        // Level dry ground can receive mineral tails from a nearby hill.
        // Only banks below that plane need the high-coast admission check.
        if (u.slopeOnLowBanks == 0 && h < u.base - 0.25) {
            let uphill = broad / max(0.001, slope);
            var source = max(baseHeight(p), baseHeight(p + uphill * 16.0));
            source = max(source, baseHeight(p + uphill * 36.0));
            source = max(source, baseHeight(p + uphill * 64.0));
            slopeCover *= smoothstep(u.base + 8.0, u.base + 26.0, source);
        }
        // A smooth route can retain native hill grain without inheriting
        // displaced cracks or rubble. Geometry protection remains separate.
        slopeCover *= 1.0 - route * (1.0 - u.rampMaterial);
        // The sampled slope texture carries baked shading that reads as
        // smudges on gentle ground; the fall-line surface lights grass itself.
        // A sandy slope's streaks are the world's look (Zhon dune slopes),
        // not baked shading, so they keep full strength.
        if (u.slopeSand == 0) { slopeCover *= u.slopeTexture; }
        if (u.slopeSand != 0) { slopeCover *= max(smoothstep(0.15, 0.6, beachField(p) + max(bakedFields(p).a, 0.0)), route); }
        slopeShare = slopeCover;
        grass = mix(grass, slopeGrass, slopeCover);
    }
    // Card P30: a world with a ground-cover table colours its grass by class (the slope-only ramp above still gates the slope texture).
    if (cvr(0u).x > 0.5) { grass = groundCover(p, slope, broad, place.top, timeMaps, place.vegetation, grass, (1.0 - route) * step(u.sea + 1.0, h)); }
    // Small mineral interiors supply pixel structure; the whole crown/face/
    // foot comes from this surface. Some native microshading remains baked.
    var rock = rockSource(pixel);
    rock = saturate(u.rockMean + (rock - u.rockMean) * u.mineralDetail);
    if (u.rockLayers != 0 && h > 18.0) {
        // Broad material regions vary actual native mineral structure. No
        // repeated whole cliff, colour-only variants or fresh pixel noise.
        let formation = terrainNoise(p * 0.35 + vec2f(43.0, 87.0)).r;
        let moss = terrainNoise(p * 0.70 + vec2f(173.0, 91.0)).g + weather.g * 0.30;
        let fractured = fracturedSource(pixel);
        let weathered = weatheredSource(pixel);
        rock = mix(rock, fractured, smoothstep(0.43, 0.57, formation));
        rock = mix(rock, weathered, smoothstep(0.40, 0.62, moss));
        // E9: the weathered and fractured tiles carry green blotches (14% and 5.5% of their pixels)
        // that read as moss scattered over the face; retail's face holds grass at its edges. Clamp
        // the green to the larger of red and blue so the tile keeps its structure and loses its moss.
        // H4 round 2: clamped to 85% (the .15 of Green's old rockMoss); the moss on rock is the rockMoss rule below, which places it by form.
        rock.g = mix(min(rock.g, max(rock.r, rock.b)), rock.g, 0.15);
    }
    rock = based(rock, u.rockTexMean, u.rockBase);
    // E9: the rock tile's own blotches and cell outlines read as soft cobble over the lit form;
    // below 1 the tile's contrast around the rock's mean colour is scaled down so the carved relief carries the face.
    if (u.rockDetail < 1.0) {
        let rockFlat = select(u.rockMean, u.rockBase.rgb, u.rockBase.a > 0.5);
        rock = rockFlat + (rock - rockFlat) * u.rockDetail;
    }
    // H3 item 4: one placement function (landPlace); its thresholds are rows of materials/green.json.
    var exposed = place.exposed;
    // H5 3a: wear bares steep grass in grey outcrops (the bake draws their cracks by the same rule).
    exposed = max(exposed, outcropAt(p, slope, timeMaps.wear, timeMaps.hard) * (1.0 - route) * place.deposits);
    let lowBank = place.lowBank;
    let sandBar = sandBarAt(p);
    var nearWater = frostDry(1.0 - smoothstep(u.sea + 1.0, u.sea + u.wetBand, h), route);
    // Card P27, Surf: the signed distance to the waterline, and the wet sand it extends the wet band with.
    var surfX = 1.0e3;
    var surfQ = vec2f(0.0);
    var surfSlope = 0.12;
    var surfE = 0.0;
    if (u.waterOn != 0) { surfE = max(textureSampleLevel(masksTex, linearClamp, maskUv(p), 4, 0.0).b, 0.0); }
    if (surfE > 0.0) {
        let shore = surfShore(p);
        surfX = shore.x;
        surfQ = shore.yz;
        surfSlope = shore.w;
        // Painted rock (a rock coast's, from coastBeach, or the artist's) takes the beach away, by its ragged edge: Surf falls to almost nothing (a wet line and a lace).
        if (u.paintOn != 0) { surfE = mix(surfE, 0.02, smoothstep(0.3, 0.7, painted.x)); }
        if (surfX < 900.0) { nearWater = max(nearWater, surfWet(surfX, surfQ, p, surfE)); }
    }
    var material = mix(grass, rock, exposed);
    if (u.beach != 0 && h > u.sea - 1.0) {
        // Beach sand within reach of the water (baked), or failing that a low band above the waterline; its inland edge is ragged and breaks into grains.
        let speck = terrainNoise(p * 6.0 + vec2f(61.0, 3.0)).b;
        let top = u.beachHeight * u.beachWidth * (0.65 + 0.7 * terrainNoise(p * 0.45 + vec2f(29.0, 5.0)).g);
        // The low band only within the water's reach: inland hollows of a low world are not beaches; steep banks stay bare.
        var beach = max(beachSand(p, speck), (1.0 - smoothstep(top * 0.6, top, h - u.sea + (speck - 0.5) * 1.5)) * (1.0 - smoothstep(0.7, 1.3, slope)) * smoothstep(0.0, 0.15, beachField(p)));
        // A sandy slope keeps its own streaked material over the beach sand.
        if (u.slopeSand != 0) { beach *= 1.0 - slopeShare; }
        material = mix(material, beachColour(pixel), beach * (1.0 - exposed * 0.7));
    }
    material = joinSedimentTransition(material, pixel, rock, exposed, materialWeather);
    if (u.microRock > 0.0) {
        // TA-style faces: moss and rock interleave at lump scale. The broad
        // slope sets how much of the face is rock; the detailed surface
        // decides where: rock on steep flanks and in hollows, moss on tops.
        let top = place.top;
        let faceSlope = place.faceSlope;
        let face = place.face;
        var rockMask = place.rockMask;
        let moss = mix(slopeBased, grass0, u.mossFromGround);
        let faceMaterial = mix(moss, rock, rockMask);
        material = mix(material, faceMaterial, face * u.microRock);
        faceCover = face * u.microRock * (1.0 - rockMask);
        // Steep faces turned from the sun are much darker in retail than
        // ours (12 Green maps, slope >= 0.55 facing away: median luma 42,
        // range 26-48; ours 49-61). Lit faces (65) and gentler slopes turned
        // away (59) already match, so only steep shaded faces darken, most
        // in the relief's hollows.
        if (u.faceDark > 0.0) {
            let turned = 1.0 - smoothstep(0.3, 0.6, dot(normalize(vec3f(-broad, 1.0)), u.light));
            material *= 1.0 - u.faceDark * turned * smoothstep(0.4, 0.65, slope) * (1.0 - route)
                            * (0.6 + 0.4 * smoothstep(-0.3, 0.7, -top));
        }
        // A light, crisp grass rim where rough ground meets the level plain.
        let rim = smoothstep(u.faceSlope.x * 0.35, u.faceSlope.x * 0.6, faceSlope)
                * (1.0 - smoothstep(u.faceSlope.x * 0.7, u.faceSlope.x * 1.05, faceSlope));
        let brightGrass = saturate(based(grassImage(pixel), u.groundTexMean, u.groundBase) * vec3f(1.15, 1.35, 1.05));
        material = mix(material, brightGrass, rim * u.footRim * (1.0 - route));
        exposed = max(exposed * (1.0 - face), rockMask * face);
        // Thin dark crevices in the relief's hollows, also across mid slopes
        // where the face material has not taken over.
        let hollow = smoothstep(0.25, 0.9, -top) * smoothstep(u.faceSlope.x * 0.4, u.faceSlope.x, faceSlope);
        material *= 1.0 - u.crevice * hollow * (1.0 - route);
    }
    // H4 round 2, rockMoss: moss and grass flecks on exposed rock, a dash of 2 px to small clumps. Retail's face carries them in its
    // crevices and on the tops of its ledges and blocks (green share of the face 12%, ours 2%). The chance of a fleck grows with the
    // crevice (H1's cavity depth) and the lump top, is clumped by a 5-px noise, and is drawn from a per-pixel hash against it, so a
    // fleck is whole pixels. The colour is the slope grass of the table, brightened toward the plain's grass. The vegetation
    // override plane (1 + v) scales it, as it scales H3's other grass and moss.
    if (u.rockMoss > 0.0 && exposed > 0.02) {
        let crevice = smoothstep(0.15, 0.7, cav / max(u.cavity, 0.001));
        let ledge = smoothstep(0.1, 0.7, place.top);
        let clump = valueNoise(p / 5.0 + 91.0) * 0.5 + 0.5;
        // Card P30: with a ground-cover table the flecks are the table's moss class, in its colour and where its moisture and light windows are
        // open (the table's own placement, so they follow Lushness, the wet swaths and the sun as the moss on the ground does); without one they
        // keep the old rule, the vegetation plane and the wetness (H5 3a: moss grows where water runs).
        let wetMoss = (0.25 + 1.6 * timeMaps.wet);
        var want = u.rockMoss * place.vegetation * wetMoss * (0.08 + 0.6 * crevice + 0.5 * ledge) * (0.4 + 1.2 * clump);
        var mossColour = saturate(slopeBased * vec3f(1.0, 1.25, 0.95));
        if (cvr(0u).x > 0.5) {
            let cs = coverSite(broad, timeMaps);
            let moss = cvr(4u + 5u * 5u);
            let mossSpot = (0.08 + 0.6 * crevice + 0.5 * ledge) * (0.4 + 1.2 * clump);
            want = u.rockMoss * place.vegetation * (0.3 + 1.5 * coverWin(cs.x, cvr(4u + 5u * 5u + 2u)) * coverWin(cs.y, cvr(4u + 5u * 5u + 4u))) * mossSpot;
            let ratio = slopeBased / max(cvr(3u).rgb, vec3f(0.01));
            mossColour = saturate(moss.rgb * clamp(dot(ratio, vec3f(0.299, 0.587, 0.114)), 0.7, 1.3));
        }
        // A wall's flecks are drawn in screen pixels, or each dash would be stretched into a streak down it.
        let ticket = mix(cellHash(vec2f(floor(p.x * 0.5), floor(p.y)) + 311.0).x, cellHash(vec2f(floor(pixel.x * 0.5), floor(pixel.y)) + 311.0).x, faceRelief);
        let fleck = step(ticket, want) * exposed;   // 2 px wide, 1 px tall: the dashes of retail's flecks
        material = mix(material, mossColour, fleck);
        // Card P10, lichen: rosettes of 1 to 4 px radius on the faces that look at the sun and at the sky (the lit normal, relief included), off the
        // crevices. The rock type's cover (its `lichen`) grows with Age and is scaled by this row, as the flecks are; a wall's rosettes are drawn
        // in screen pixels like its flecks.
        let lichen = u.rockMoss * u.rockLichen * (0.4 + 0.6 * clamp(u.rockAge, 0.0, 1.0)) * clamp(place.vegetation, 0.0, 2.0);
        if (lichen > 0.0) {
            let lq = select(p, pixel, faceRelief > 0.5);
            let rosette = markCells(lq / 8.0, vec2i(433, 71), 1.0);
            let lit = smoothstep(0.25, 0.65, dot(normal, u.light)) * smoothstep(0.35, 0.75, normal.z);
            let radius = (0.6 + 3.4 * rosette.id.x) * sqrt(min(lichen, 1.5)) * (1.0 + 0.3 * (cellHash(floor(lq) + 5.0).x - 0.5));
            let onRosette = step(rosette.id.y, lichen * 1.2) * step(rosette.d1 * 8.0, radius) * lit * (1.0 - crevice) * exposed;
            var tint = vec3f(150.0, 158.0, 120.0) / 255.0;   // grey-green
            if (rosette.id.z > 0.4) { tint = vec3f(196.0, 192.0, 168.0) / 255.0; }   // pale crust
            if (rosette.id.z > 0.7) { tint = vec3f(178.0, 176.0, 72.0) / 255.0; }   // yellow-green
            if (rosette.id.z > 0.95) { tint = vec3f(206.0, 118.0, 38.0) / 255.0; }   // orange
            material = mix(material, tint, 0.85 * onRosette);
        }
    }
    if (u.rockCrown > 0.0) {
        // Some worlds' raised ground is bare rock to its crown (Zhon's
        // domes), not only where it is steep.
        let crown = smoothstep(u.base + 5.0, u.base + 14.0, h + (n.g - 0.5) * 6.0) * u.rockCrown * (1.0 - route) * (1.0 - sandBar);
        material = mix(material, rock, crown);
        exposed = max(exposed, crown);
    }
    if (u.strata > 0.0 && u.columnSectionCount > 0) {
        // Beds by height, measured on retail Painted Desert: the column's sections (a start above the plain, a pair of beds as
        // colour slots with B's share of each period). Within a section A and B alternate every period, quasi-periodically (B's
        // share varies per cycle), and B's share ramps toward the next section when both use the same pair. Beds colour all
        // raised ground, level tops included (retail mesa caps take their band's colour); edges are hard (~3 px); bed edges
        // wander ~1-1.5 units at 5-25 px and meander broadly.
        let hr = columnCoord(p, h);
        let zone = columnSectionAt(hr);
        // Card G4: retail's pale caps are one sheet of the cool bed. The cap pixels (height 56 and up on slopes under .35 per px)
        // are 9.6-12% orange in retail and 22% in ours, hue 64-77 against 42: the beds' fine warp and the spread of a section's
        // split push a flat top across a bed edge in blotches, so level ground in a section that is nearly all cool bed is held to it.
        // (Retail keeps one ragged orange patch of 40-150 px per cap. A threshold on noise drew smooth stains or thin veins, so
        // ours draws none.)
        let level = 1.0 - smoothstep(0.05, 0.22, slope);
        let edge = clamp(1.5 * max(slope, 0.05) / u.columnSections[zone].w, 0.01, 0.2);
        let stratum = columnColour(hr, zone, edge, true, u.desertCapFlat * level);
        // Painted rock (card C5) in a world with beds takes the colour its highest ground is painted with (its top section's
        // main bed: Painted Desert's grey buttes), and (card E8) the strata run through the rock itself, so painted rock carries
        // the top section's own beds (its grey with the lines), not one flat colour, wherever it is painted. A painted mesa's
        // rock is mostly gentle: a fixed edge.
        let topZone = u.columnSectionCount - 1;
        var rockBed = vec3f(0.0);
        if (painted.x > 0.0) { rockBed = columnColour(hr, topZone, 0.04, false, 0.0); }
        let bed = mix(stratum, rockBed, painted.x);
        let lum = dot(material, vec3f(0.299, 0.587, 0.114));
        let meanLum = max(dot(u.groundTexMean, vec3f(0.299, 0.587, 0.114)), 0.05);
        // The ground's grain survives in the beds as brightness, scaled by
        // Bed grain (retail desert bands are smooth colour).
        let bedColour = saturate(bed * mix(1.0, clamp(lum / meanLum, 0.82, 1.12), u.strataGrain));
        let onRaised = smoothstep(u.columnSections[0].x, u.columnSections[0].x + 1.5, hr) * (1.0 - route);
        material = mix(material, bedColour, max(u.strata * u.strataContrast * onRaised, u.strata * painted.x));
        if (u.baseBand > 0.0) { material = mix(material, strataSlot(4), baseBandMask(p, h - u.base, slope)); }
    }
    // Painted masks (card C5), after the world's own beds and before sand,
    // which covers them. Rock went through the face treatment above; where a
    // world has none (microRock 0) it is the plain rock material.
    if (u.paintOn != 0) {
        let faceHandled = select(0.0, 1.0, u.microRock > 0.0);
        material = mix(material, rock, painted.x * (1.0 - faceHandled));
        material = mix(material, snowMaterial(pixel), painted.y);
        material = mix(material, mossMaterial(pixel), painted.w);
        exposed = max(exposed, painted.x);
    }
    {
        // Procedural sand: a colour with two scales of grain, so it needs no
        // sampled art. Coverage comes from the bake.
        let sand = bakedFields(p).a * place.deposits;
        if (sand > 0.0) {
            // Weathered rock and its grains (sandMaterialAt): a biome's sand follows its own rock.
            let weathered = sandWeathered();
            let sandMaterial = sandMaterialAt(scatter);
            // Three stages, so sand thins into the ground over tens of
            // pixels: fines tint what is there, then grains appear between
            // grass blades (a per-pixel threshold against fine noise), then
            // sand covers the ground.
            material = mix(material, weathered, smoothstep(0.0, 0.6, sand) * u.sandDust * 0.6);
            material = mix(material, sandMaterial, sandCoverAt(sand, p, 1.0));
        }
    }
    // Baked boulders take rock material, lit by the same surface.
    {
        let coverOrCrack = bakedFields(p).b * (1.0 - faceRelief);
        // A crack wall facing the sun.
        if (coverOrCrack > 1.0) { material *= 1.0 + CRACK_LIT * (coverOrCrack - 1.0); }
        else { material = mix(material, rock * 1.08, max(coverOrCrack, 0.0)); }
        // A crack's floor is in shadow: darken what is there, so a crack in
        // grass stays green-black and one in rock grey-black. The walls are
        // lit by the carved geometry.
        // Codes below -1 come only from band lines with Line darkness above
        // 1 (Green's dark terrace steps); up to -1 this is unchanged.
        material *= 1.0 - min(u.crackDark * max(-coverOrCrack, 0.0), 1.0);
    }
    let chip = smoothstep(0.035, 0.40, materialChipHeight(p) * (1.0 - route)) * 0.65;
    material = mix(material, rock, chip * (1.0 - exposed));
    material *= 1.0 - weather.r * 0.06;
    // H5 3a: wet swaths. Water darkens grass along its flow: soft streaks 15-40 px across and 70 px along the fall line, where the
    // wetness map is high and the ground slopes (the retail slopes' diagonal dark swaths, 20-40 px wide).
    if (u.wetSwath > 0.0 && u.weatherMaps > 0.5) {
        let flen = length(timeMaps.fall);
        if (flen > 0.05) {
            let fl = timeMaps.fall / flen;
            let q = vec2f(dot(p, vec2f(-fl.y, fl.x)) / 22.0, dot(p, fl) / 90.0);
            // Broad gentle bands of tone, lighter as well as darker (the mean stays), by the wetness map.
            let tone = valueNoise(q + 13.0) * 0.8 + 0.2 * valueNoise(q * 2.7 + 5.0);
            material *= clamp(1.0 + u.wetSwath * timeMaps.wet * tone * smoothstep(0.06, 0.25, slope) * (1.0 - exposed) * place.vegetation, 0.4, 1.6);
        }
    }
    // Retail Archipelago sand runs level to a crisp waterline (hundred
    // isles): its low bank shows no light, shade or wet band. With flatBank
    // the dry ground below the plain is lit as level and stays dry-coloured.
    var flatBank = 0.0;
    if (u.flatBank > 0.0) {
        let bh = baseHeight(p);
        flatBank = u.flatBank * step(u.sea, bh) * (1.0 - smoothstep(u.base - 0.5, u.base + 0.5, bh));
    }
    material *= 1.0 - nearWater * 0.17 * (1.0 - flatBank);
    // Painted wet or dark ground darkens as the shoreline band does, twice as strongly.
    material *= 1.0 - painted.z * 0.34;
    let crystalMask = crystalField(p);
    if (crystalMask > 0.05) {
        // Retail Crystal (measure/crystal_geometry.py): flat tops take the
        // crystal colour and the light, with a per-column brightness jitter
        // (the field's 0.8-1.0); steep side faces are dark at every facing
        // (luma 26-40 against tops ~60-78); outlines are black ink where the
        // field marks a column edge (0.5) or a crystal's rim. No edge
        // highlights.
        let crystalColor = select(u.crystalColor, u.crystalBase.rgb, u.crystalBase.a > 0.5);
        let jitter = clamp((crystalMask - 0.9) * 10.0, -1.0, 1.0);
        // Tops keep the ground's own grain (Crystal's streaks), moved
        // toward the crystal colour.
        // Crystal Grain 1: the tops carry the level ground's own art (retail
        // column tops are streaked like the ground), not the slope cover.
        let topBase = mix(material, levelGround, u.crystalGrain);
        let grainLum = dot(topBase, vec3f(0.299, 0.587, 0.114)) / max(dot(u.groundTexMean, vec3f(0.299, 0.587, 0.114)), 0.05);
        var faces = mix(topBase, crystalColor * clamp(grainLum, 0.6, 1.5), 0.35) * (1.0 + 0.25 * jitter) * u.crystalTone;
        faces = mix(faces, crystalColor * 0.38 * u.crystalFace, smoothstep(1.2, 2.5, length(g)));
        // G7: a crater's skin has no seams, so the ramp from its mark to bare ground (the only place below .66) draws no outline.
        var skinEdge = 0.0;
        if (u.crystalCraterWeb > 0.0 && crystalMask < 0.66) {
            // Skin beside this pixel: a step toward it, then three more (flat skin there, not a seam's ramp that crosses .74).
            for (var k = 0; k < 4; k++) {
                let d = vec2f(cos(f32(k) * 1.570796), sin(f32(k) * 1.570796));
                let q = p + d * 3.0;
                let side = skinBand(crystalField(q)) * skinBand(crystalField(q + d * 3.0));
                if (side > 0.0) { skinEdge = max(skinEdge, side * skinBand(crystalField(q + vec2f(-d.y, d.x) * 3.0)) * skinBand(crystalField(q - vec2f(-d.y, d.x) * 3.0))); }
            }
        }
        // Crystal Ink 1: crisp pure-black outlines (retail index 0), not a
        // soft 92% darkening of the column edge.
        let ink = mix((1.0 - smoothstep(0.58, 0.74, crystalMask)) * 0.92, 1.0 - step(0.66, crystalMask), u.crystalInk) * (1.0 - skinEdge);
        faces = mix(faces, vec3f(0.0), ink);
        // G7: a crater's skin is the field's value .74 (a column's marks are .8 and over, its seams .5). Its wall takes the sun's light and shade
        // harder, as retail's lit east wall and dark west wall do, and the thin web crosses it.
        var craterBand = 0.0;
        if (u.crystalCraterWeb > 0.0 || u.crystalCraterLight != 1.0) { craterBand = craterSkin(p, crystalMask); }
        if (craterBand > 0.0) {
            // The push is a factor on the faces, which the light multiplies later (shading itself is left as it was).
            let s = max(shading, 0.05);
            let pushed = select(max(1.0 - (1.0 - s) * u.crystalCraterLight, 0.3), min(1.0 + (s - 1.0) * u.crystalCraterLight, u.lightCap + 0.1), s > 1.0);
            faces *= mix(1.0, pushed / s, craterBand);
            if (u.crystalCraterWeb > 0.0) {
                let web = craterWeb(p);
                faces *= mix(1.0, web.y, craterBand);
                // Lines run fainter on the lit wall, darker in shade.
                faces = mix(faces, vec3f(0.0), u.crystalCraterWeb * web.x * craterBand * mix(0.6, 1.0, smoothstep(0.1, 0.45, slope)) * mix(1.0, 0.6, smoothstep(0.95, 1.1, s)));
            }
        }
        material = mix(material, faces, smoothstep(0.05, 0.3, crystalMask));
    } else {
        // A dark apron round a crystal formation, fading over ~16 px.
        var near = 0.0;
        for (var k = 0; k < 8; k++) {
            let dir = vec2f(cos(f32(k) * 0.785398), sin(f32(k) * 0.785398));
            near = max(near, step(0.3, crystalField(p + dir * 5.0)) * 0.75);
            near = max(near, step(0.3, crystalField(p + dir * 11.0)) * 0.35);
        }
        material *= 1.0 - 0.3 * near;
    }
    // Archipelago's hills are lighter than their material draws them: retail's mound
    // pixels average 1.14-1.18 times ours in each channel in all three windows.
    // Only the hill's own dark cover is lifted: sand at the foot is already light and would clip.
    if (u.hillLight != 1.0) {
        let dark = 1.0 - smoothstep(0.45, 0.70, dot(material, vec3f(0.299, 0.587, 0.114)));
        material *= mix(1.0, u.hillLight, smoothstep(u.base + 1.0, u.base + 10.0, baseHeight(p)) * dark);
    }
    // Ice crystal mountains (card E6): snow-white lumps ~30-50 px across stand on the raised ground (retail ice-1:
    // six or seven rounded white caps on one mountain), a ragged edge, taken before the light so they shade as snow.
    if (u.iceCrest > 0.0) {
        let lumps = terrainNoise(p * 0.05 + vec2f(31.0, 7.0)).r + (n.b - 0.5) * 0.12;
        let raised = smoothstep(u.base + 12.0, u.base + 40.0, h);
        let crest = smoothstep(0.0, 0.05, lumps - mix(0.75, 0.45, u.iceCrest)) * raised;
        material = mix(material, snowMaterial(pixel), crest);
        exposed *= 1.0 - crest;
    }
    // Card G6, snow on the flat tops of raised ice (retail ice-3's white top with a few pits): where the blurred
    // height is gentle the block is snow, its edge ragged, so the slate begins at the crest's roll-over.
    if (u.iceSnow > 0.0) {
        let gentle = 1.0 - smoothstep(0.42, 0.78, length(gSoft) + (n.g - 0.5) * 0.25);
        let cap = u.iceSnow * iceMesa * gentle;
        // A little under the plain's snow: lit at the block's strong light a full-white top clips and loses its pits (retail's top ~(225,232,255)).
        material = mix(material, snowMaterial(pixel) * 0.9, cap);
        exposed *= 1.0 - cap;
    }
    // Card P27: the surf's beach is drawn last over the material, so the bake's cracks, chips and stones do not mark it: sand with its own fine
    // grain (colour the world's Sand), the shading eased toward level, then the wet sand to the last uprush and the wrack lines.
    if (surfE > 0.0 && surfX < 900.0 && surfX >= 0.0) {
        let cover = sandCoverAt(surfSand(surfX, surfQ, p, surfE) * (1.0 - smoothstep(0.7, 1.3, slope + 0.2 * valueNoise(p / 5.0 + 17.0) + 0.15 * valueNoise(p / 13.0 + 43.0))) * (1.0 - smoothstep(6.0, 12.0, h - u.sea + 2.5 * valueNoise(p / 8.0 + vec2f(6.6, 2.2)))) * (1.0 - exposed * 0.7), p, smoothstep(surfBerm(surfE) * 0.5, surfBerm(surfE) * 1.6, surfX));
        let cell = floor(grainPixel(pixel));
        // Dry sand varies in tone: patches of 20 and 7 px lighter and darker, and a slow drift between a warmer and a cooler sand.
        let toneBlot = 0.11 * valueNoise(p / 21.0 + vec2f(9.2, 3.1)) + 0.07 * valueNoise(p / 7.0 + vec2f(1.4, 7.7));
        let drift = valueNoise(p / 43.0 + vec2f(2.6, 6.4));
        let grain = 1.0 + 0.12 * (shelfHash(cell + 11.0) - 0.5) + 0.06 * valueNoise(p / 5.0) + 0.05 * valueNoise(p / 17.0) + toneBlot;
        let sandColour = select(sandWeathered() * grain, beachColour(pixel), u.beach != 0) * mix(vec3f(0.97, 0.99, 1.03), vec3f(1.03, 1.0, 0.95), 0.5 + 0.5 * drift);
        material = mix(material, sandColour, cover);
        shading = mix(shading, mix(shading, 1.0, 0.6), cover);
        let wet = surfWet(surfX, surfQ, p, surfE);
        material *= mix(vec3f(1.0), vec3f(0.68, 0.62, 0.52), wet);
        let wrackAt = surfBerm(surfE) * 0.78 + 2.5 * valueNoise(surfQ / 40.0 + vec2f(5.0, 5.0));
        let wrack = (1.0 - smoothstep(0.35, 1.0, abs(surfCuspX(surfX, surfQ, surfE) - wrackAt))) * step(shelfHash(cell + 63.0), 0.65)
                  * smoothstep(-0.2, 0.2, valueNoise(surfQ / 25.0 + vec2f(7.0, 3.0))) * cover;
        material = mix(material, vec3f(0.33, 0.30, 0.20), wrack * 0.6 * surfE);
        // A few pebbles (2 x 2 px, the world's rock a little lighter or darker), more near the wrack line and the berm, none on the wet sand.
        let stoneAt = floor(grainPixel(pixel) * 0.5);
        let nearLine = 1.0 - smoothstep(2.0, 14.0, abs(surfCuspX(surfX, surfQ, surfE) - wrackAt));
        let pebble = step(shelfHash(stoneAt + 91.0), (0.004 + 0.03 * nearLine) * smoothstep(-0.3, 0.4, valueNoise(p / 15.0 + vec2f(3.0, 8.0)))) * cover * (1.0 - wet);
        material = mix(material, rock * (0.75 + 0.5 * shelfHash(stoneAt + 92.0)), pebble * 0.85);
    }
    var color = material * mix(shading, 1.0, flatBank);
    if (u.shadeBlue > 0.0) {
        // Ice (card E5): retail's shaded ice is periwinkle (palette entries that keep blue
        // 227-255 as red and green fall), where a plain multiply goes grey-teal in the palette.
        let fall = clamp(1.0 - shading, 0.0, 1.0) * u.shadeBlue;
        color = material * (shading + fall * vec3f(0.0, 0.35, 0.85));
    }
    // The light's colour, on the lit material (after shadeBlue, which rebuilds the colour).
    color *= lightTint;
    // Raised or sloped ground (card E6): the footprint of the shine gate and of Moon's pockmarks; level plain is 0.
    // Raised ground counts whole, tops included, where a crater's floor counts only where it slopes.
    var landform = 1.0;
    if (u.shineGate > 0.0 || u.pockmark > 0.0 || u.moonCups > 0.0) { landform = max(smoothstep(0.1, 0.35, slope), smoothstep(u.base + 3.0, u.base + 9.0, baseHeight(p))); }
    var iceFace = 0.0;
    if (u.iceFall > 0.0) {
        // Card G6: the faces' fibres, in place of the rock art's grain and the glint's dashes.
        iceFace = clamp(exposed, 0.0, 1.0) * iceMesa;
        let fibre = iceFibre(pixel);
        // Dark strokes keep their blue (a plain multiply goes brown in the palette).
        color *= 1.0 + u.iceFall * iceFace * select(0.2 * fibre, 0.8 * fibre, fibre < 0.0) * vec3f(1.0, 0.85, 0.55);
    }
    if (u.iceApron > 0.0 && iceMesa < 0.9) {
        // Card G6: dark fibres spill past the foot into the snow and thin out with the distance (retail ice-3's
        // feathered edge): the same strokes as the faces', kept where raised ice is near and the broad noise allows.
        let near = iceNearness(p);
        let keep = smoothstep(0.0, 0.35, near * 1.5 - 0.12 - n.r * 0.6);
        // The strokes waver (a slow warp of where they are read), thin out with the distance, and a faint
        // fuzz of the same dark lies under them close to the foot.
        let wander = (terrainNoise(p * 0.22).rg - 0.5) * 16.0 + (terrainNoise(p * 0.9).ba - 0.5) * 5.0;
        let drift = smoothstep(0.12, 0.5, -iceDrift(pixel + wander)) * (0.35 + 0.65 * smoothstep(0.1, 0.6, near));
        color *= 1.0 - u.iceApron * (0.5 * keep * drift + 0.16 * smoothstep(0.25, 0.8, near)) * (1.0 - iceMesa) * vec3f(1.0, 0.85, 0.55);
    }
    if (u.iceFrost > 0.0 && h > u.sea + 1.0 && route > 0.003) {
        // The band's trace in the route channel (1/255 inland .. 5/255 at the coast); the coast's own bank, the needles and
        // pockets carry more, and that is the band's seaward part (1 there). A drawn ramp in an Ice world counts as band too.
        let near = clamp((route - 0.0039) / 0.0157, 0.0, 1.0);
        let lines = iceFrostLines(pixel, 0.06 + 0.94 * near * near);
        color *= 1.0 - u.iceFrost * lines * mix(0.5, 1.0, near) * vec3f(0.95, 0.8, 0.3);
    }
    if (u.iceCrystal > 0.0) {
        // Straight strokes over the rock faces, darker the more rock shows (card E6; after shadeBlue, which rebuilds the colour).
        color *= 1.0 - 0.75 * u.iceCrystal * iceHatch(pixel) * smoothstep(0.3, 0.8, exposed);
    }
    // Cast shadow as the diffuse term applies it (level ground keeps flatShadow), shared by shine and the surface marks.
    let markSeen = 1.0 - clamp((1.0 - shadow) / 0.32, 0.0, 1.0) * mix(u.flatShadow, 1.0, smoothstep(0.08, 0.35, slope));
    let turned = 1.0 - clamp(shading, 0.0, 1.0);
    if (u.shineOn != 0) {
        let sunSeen = markSeen * (1.0 - flatBank) * closeVis;
        var shine = shineTerm(pixel, p, gLit, normal, material, exposed, faceCover, slopeShare, crystalMask, sunSeen, landform, faceRelief);
        // E9: the glints belong to the painted face; the small rock patches of ordinary hills keep this share of them.
        if (u.shineOutside < 1.0) { shine = vec4f(shine.xyz * mix(u.shineOutside, 1.0, smoothstep(0.4, 0.9, painted.x)), shine.w); }
        if (u.shineSlopeGate > 0.0) { shine = shineSlopeGated(shine, slope); }
        if (u.iceFall > 0.0) { shine = vec4f(shine.xyz * (1.0 - 0.75 * u.iceFall * iceFace), shine.w); }
        // A glint is the sun mirrored: it takes the sun's colour, not the sky's.
        color = color * shine.w + shine.xyz * u.sunColor;
    }
    if (u.layerCrease > 0.0) { color *= 1.0 - u.layerCrease * layerCreaseTerm(p); }
    if (u.pockmark > 0.0 && h > u.sea + 1.0 && landform > 0.0) {
        let pits = pockPits(pixel, u.pockSize, u.pockmark * mix(0.6, 1.0, turned));
        color *= 1.0 - pits * landform * mix(0.5, 0.92, turned);
    }
    if (u.moonFolds > 0.0 && h > u.sea + 1.0) {
        // G8 (Moon): thin dark folds across the lit and moderate slopes.
        color *= 1.0 - 0.34 * u.moonFolds * moonFolds(p, baseHeight(p), slope, u.moonFoldSpacing);
    }
    if (u.moonRibs > 0.0 && h > u.sea + 1.0) {
        // G8 (Moon): the shaded flank's strokes, on steep ground of every facing, more where turned from the sun.
        let wall = u.moonRibs * smoothstep(0.15, 0.5, slope) * smoothstep(0.12, 0.5, turned);
        if (wall > 0.0) {
            let beforeRib = max(0.0, dot(normal, u.light));
            let afterRib = max(0.0, dot(normalize(vec3f(-(g + u.moonRibDepth * moonRibs(pixel)), 1.0)), u.light));
            let strokes = clamp((u.ambient + 0.95 * afterRib * markSeen) / (u.ambient + 0.95 * beforeRib * markSeen), 0.3, 2.6);
            color *= mix(1.0, strokes * (1.0 - u.moonRibDark * smoothstep(0.1, 0.55, turned)), wall);
        }
    }
    if (u.moonCups > 0.0 && h > u.sea + 1.0 && landform > 0.0) {
        // G8 (Moon): lit cups, many on shaded steep faces, few on lit ground, none on the flat top. The
        // sun shades each one as it shades the face: the cup's wall turned from the sun goes dark, the
        // wall toward it keeps the face's light.
        let steep = smoothstep(0.08, 0.40, slope);
        let clump = 0.6 + 0.8 * (0.5 + 0.5 * wrinkleNoise(pixel / 38.0 + 5.0));
        let keep = min(u.moonCups * mix(0.04, 1.0, smoothstep(0.1, 0.55, turned)) * steep * clump * landform, 1.0);
        if (keep > 0.0) {
            let cups = moonCups(pixel, u.moonCupSize, keep, u.moonCupDepth);
            let before = max(0.0, dot(normal, u.light));
            let after = max(0.0, dot(normalize(vec3f(-(g + cups.xy), 1.0)), u.light));
            color *= clamp((u.ambient + 0.95 * after * markSeen) / (u.ambient + 0.95 * before * markSeen), 0.2, 1.3) * (1.0 - 0.7 * cups.z);
        }
    }
    if (u.slopeMarks > 0.0 && h > u.sea + 1.0) {
        let away = smoothstep(-0.05, 0.10, dot(broad, normalize(u.light.xy)));
        // More on faces turned from the light (sections: ~0.6 as many on
        // lit faces of the same slope).
        // Fewer on lit faces (eight Lunar maps: ~1.9% of px against ~5.4% on
        // shaded faces of the same slope; our surface already has some).
        let density = u.slopeMarks * smoothstep(0.12, 0.45, slope) * mix(0.15, 1.0, away);
        if (density > 0.0) {
            let mark = slopeMark(pixel, density);
            // The flanks brighten shaded ground only, never past the lit material.
            if (mark > 0.0) { color *= 1.0 - 0.62 * mark; }
            else if (mark < 0.0) { color = min(color * (1.0 + 0.32 * away), max(color, material * 0.9)); }
        }
    }
    if (u.wrinkles > 0.0 && u.grassSlopes == 0 && h > u.sea + 1.0) {
        // Joined wrinkles (Moon; a grass world's are the bake's terracettes): on every slope, more on faces turned from the light.
        let away = smoothstep(-0.05, 0.10, dot(broad, normalize(u.light.xy)));
        let gate = smoothstep(0.05, 0.30, slope) * mix(0.55, 1.0, away);
        if (gate > 0.0) {
            // The long axis stays fixed on the screen, ~27 degrees off vertical as the
            // retail marks' (measure/slope_marks.py): a frame turned with the local slope
            // would scramble the phase, its angle error growing with the distance from the origin.
            let lines = wrinkleLines(pixel, vec2f(0.454, 0.891), vec2f(0.891, -0.454), u.wrinkles, normalize(u.light.xy), smoothstep(0.2, 0.8, slope));
            let depthDark = (0.2 + 0.3 * smoothstep(0.15, 0.8, slope)) * gate;
            color *= 1.0 - depthDark * lines.x;
            color = min(color * (1.0 + 0.2 * away * gate * lines.y), max(color, material * 0.9));
        }
    }
    var shoalWeight = 0.0;   // G1: how much of this pixel is lit shallow bed, for the palette dither below
    var surfWater = 0.0;     // Card P27: how much of this pixel is drawn as water, for the foam below
    if (h < u.sea + 1.0) {
        let depth = max(0.0, u.sea - h);
        // Sediment mottling varies apparent water colour without changing the
        // authored bed or the level water plane.
        var colorDepth = depth;
        if (u.waterSoft > 0.0) {
            // Colour follows depth averaged over a disc: the authored bed
            // stays exact, but deep water fades in over a wider, uneven band.
            var sum = 0.0;
            for (var k = 0; k < 8; k++) {
                let a = f32(k) * 0.785398 + 0.3;
                let o = vec2f(cos(a), sin(a)) * u.waterSoft * (0.6 + 0.4 * f32(k % 2));
                sum += max(0.0, u.sea - baseHeight(p + o));
            }
            colorDepth = mix(depth, sum / 8.0, 0.75);
        }
        if (u.coastalDetail != 0) { colorDepth += ((n.r - 0.5) * 14.0 + (n.g - 0.5) * 5.0) * smoothstep(2.0, 8.0, depth); }
        // Optional contour rings in the water colour, every 6 depth units.
        if (u.bandWater > 0.0) { colorDepth = mix(colorDepth, (floor(colorDepth / 6.0) + 0.5) * 6.0, u.bandWater * 0.7); }
        // A deep or shallow stroke's water choices (card E1), painted into the
        // masks: +1 hard / lit bed, -1 faded / noise water, 0 the world's own.
        // The plane is bilinear, so a half threshold keeps a stroke's footprint
        // to within a pixel of where it was painted.
        var shoreHard = u.crispShore;
        var shoreOwn = true;   // G1: the stroke leaves the shore edge to the world's own
        var edgeHard = u.deepEdge;
        var bedLit = u.bedLit;
        var crackedBed = false;
        if (u.waterOn != 0) {
            crackedBed = textureSampleLevel(masksTex, linearClamp, maskUv(p), 3, 0.0).g > 0.5;
            let pick = textureSampleLevel(masksTex, linearClamp, maskUv(p), 2, 0.0).gba;
            if (pick.x > 0.5) { shoreHard = 1.0; shoreOwn = false; } else if (pick.x < -0.5) { shoreHard = 0.0; shoreOwn = false; }
            if (pick.y > 0.5) { edgeHard = 1.0; } else if (pick.y < -0.5) { edgeHard = 0.0; }
            if (pick.z > 0.5) { bedLit = 1.0; } else if (pick.z < -0.5) { bedLit = 0.0; }
        }
        var deep = smoothstep(u.shallowDepth, u.deepDepth, colorDepth);
        if (edgeHard > 0.0) { deep = sharpDeepStep(p, pixel, depth, crackedBed); }
        let grain = genColor(u.waterLayer, pixel) - u.waterMean;
        var water = mix(select(u.shallowColor, u.shallowBase.rgb, u.shallowBase.a > 0.5), select(u.deepColor, u.deepBase.rgb, u.deepBase.a > 0.5), deep) + grain * mix(2.3, 0.95, deep);
        if (u.shallowBase.a < 0.5 && u.deepBase.a < 0.5) {
            var shallow = genColor(u.shallowLayer, pixel);
            let deepWater = genColor(u.waterLayer, pixel);
            // The lit bed: the ground under the water, lit by the same sun and
            // tinted, replaces the shallow art's noise (retail draws its shallows
            // as the lit terrain through a blue tint).
            // The bed is the level ground under the sun and shade at this pixel: the slope
            // and rock materials of its banks are not drawn through the water.
            // A cracked bed keeps its drawn material, cracks and all.
            // E11 bedFlat: light the bed by its own relief only. A shelf's slope toward the deep
            // would otherwise shade the pale bed darker over a hundred px and read as blur.
            var bedShade = shading;
            if (u.bedFlat > 0.0) {
                let own = normalize(vec3f(-(g - broad), 1.0));
                bedShade = mix(shading, min((u.ambient + 0.95 * max(0.0, dot(own, u.light))) / flatLight, u.lightCap), u.bedFlat);
            }
            if (bedLit > 0.0) { shallow = mix(shallow, litBed(select(levelGround * bedShade, color / (max(shading, 0.05) * max(lightTint, vec3f(0.02))) * bedShade, crackedBed), crackedBed), bedLit); }
            // The bumps' light moves red and green more than blue, so a shaded lump goes toward deep blue
            // and a lit one toward pale blue, where a plain multiply lands between the palette's blues (teal).
            // Only hard-step water takes them: Archipelago's lakes and channels stay smooth, as retail's.
            if (u.shoalBump > 0.0 && bedLit > 0.0 && edgeHard > 0.0) { shallow *= 1.0 + (shoalBumpLight(p) - 1.0) * vec3f(1.0, 1.0, 0.4) * bedLit; }
            // G1: retail's lilac lake keeps salmon and pink pixels of the ground under it; the tint alone replaces them.
            if (u.shoalGrain > 0.0 && bedLit > 0.0) { shallow += u.shoalGrain * (levelGround - groundBased(u.groundTexMean)) * bedShade * bedLit; }
            if (u.bedDots > 0.0 && bedLit > 0.0) { shallow *= 1.0 - u.bedDots * bedDotField(pixel) * vec3f(1.0, 1.0, 0.55) * bedLit; }
            water = mix(shallow, deepWater, deep);
            // Some worlds' water passes through a third colour; a straight
            // blend of the two textures lands on colours the art never uses.
            if (u.waterMid.a > 0.0) {
                let toMid = smoothstep(u.shallowDepth, u.waterMid.a, colorDepth);
                let toDeep = smoothstep(u.waterMid.a, u.deepDepth, colorDepth);
                let mid = u.waterMid.rgb + (deepWater - u.waterMean) * 0.9;
                water = mix(mix(shallow, mid, toMid), deepWater, toDeep);
            }
        }
        // Shared bed elevation makes a painted shallow passage persist even
        // far from shore; there is no fixed-width coastal blue collar.
        var submerged = smoothstep(-0.2, 2.8, depth);
        shoalWeight = (1.0 - deep) * submerged * bedLit * select(0.0, 1.0, edgeHard > 0.0);
        if (shoreHard > 0.0) {
            // Retail waterlines are hard edges with small stair-step notches,
            // not soft fades: threshold depth against pixel-block jitter.
            let block = floor(grainPixel(pixel) / 2.0);
            let jitter = fract(sin(dot(block, vec2f(12.9898, 78.233))) * 43758.5453) - 0.5;
            var crisp = step(0.6 + jitter * 1.4, depth);
            if (u.shoalStairs > 0.0) {
                // G1: retail's waterline steps in runs of 1-3 px on any bank. The earlier jitter is in depth, so
                // a steep bank is cut straight and a gentle one in 6-px notches; here the depth is read where a
                // point displaced by smooth noise of 3 and 7 px sits, up to shoalStairs px (smooth, so the cut
                // leaves runs and no isolated pixels, which per-pixel hashes did).
                let off = ((vec2f(shelfNoise(p / 3.0 + 5.3), shelfNoise(p / 3.0 + 37.9)) - 0.5) * 1.0 + (vec2f(shelfNoise(p / 7.0 + 9.1), shelfNoise(p / 7.0 + 77.3)) - 0.5) * 1.6) * u.shoalStairs;
                crisp = step(0.6, depth + baseHeight(p) - baseHeight(p + off));
            }
            if (u.shoalShoreSoft > 0.0 && shoreOwn) {
                // G1: retail's Archipelago shore is not a clean line: 2-4 px of sand and water pixels mix at it. The
                // depth is turned into a coverage over shoalShoreSoft px (the bank's gradient, floored for flat
                // banks) and each pixel is cut against its own hash.
                let cover = clamp((depth - 0.6) / (max(bankGrad(p), 0.15) * u.shoalShoreSoft) + 0.5, 0.0, 1.0);
                crisp = step(shelfHash(floor(grainPixel(pixel)) + 71.0), cover);
            }
            submerged = mix(submerged, crisp, shoreHard);
        }
        surfWater = submerged;
        color = mix(color, water * lightTint * (0.92 + 0.08 * shadow), submerged);
        if (u.crystalSeam > 0.0 && crystalMask > 0.05) { color = crystalSlabWater(color, crystalMask, submerged); }
        if (u.crystalShallow > 0.0) { color = crystalShallowWater(color, p, deep, submerged, crystalMask); }
    }
    if (surfE > 0.0 && surfX < 900.0) {
        // Card P27: static foam, white as lit as the water is. It marks the playable edge on both sides: the lace on the water, the swash on the sand.
        let foam = surfFoam(pixel, p, surfX, surfQ, max(0.0, u.sea - baseHeight(p)), surfSlope, surfE);
        color = mix(color, vec3f(0.93, 0.96, 0.94) * lightTint * (0.9 + 0.1 * shadow), foam * select(1.0 - surfWater, surfWater, surfX < 0.0));
    }
    if (u.shoreEdge > 0.0 && abs(h - u.sea) < 10.0) {
        // Lava coasts (retail, measure/lava_*.py): a 1 px dark-red rim just
        // inside the lava; on the land a dark outline on the first pixel
        // (darkest on east and south edges), a light lip on the second (west,
        // north and south edges), and east edges shaded a little farther in.
        let wet = h < u.sea;
        var nearest = 9.0;
        var toward = vec2f(0.0);
        for (var k = 0; k < 8; k++) {
            let dir = vec2f(cos(f32(k) * 0.785398), sin(f32(k) * 0.785398));
            for (var r = 1; r <= 8; r++) {
                if (f32(r) >= nearest) { break; }
                if ((baseHeight(p + dir * f32(r)) < u.sea) != wet) { nearest = f32(r); toward = dir; break; }
            }
        }
        if (wet) {
            if (nearest <= 1.0) { color *= mix(1.0, 0.78, u.shoreEdge); }
        } else if (nearest < 9.0) {
            let east = smoothstep(0.2, 0.7, toward.x);
            let south = smoothstep(0.2, 0.7, toward.y);
            let westNorth = clamp(smoothstep(0.2, 0.7, -toward.x) + smoothstep(0.2, 0.7, -toward.y), 0.0, 1.0);
            if (nearest <= 1.0) { color *= mix(1.0, mix(0.8, 0.55, max(east, south)), u.shoreEdge); }
            else if (nearest <= 2.0) { color *= mix(1.0, 1.0 + 0.15 * clamp(westNorth + south, 0.0, 1.0) * (1.0 - east), u.shoreEdge); }
            if (nearest > 1.0) { color *= mix(1.0, 0.82, east * u.shoreEdge); }
        }
    }
    if (u.clay != 0) {
        color = vec3f(0.53, 0.51, 0.46) * shading;
        if (h < u.sea) { color = mix(color, vec3f(0.20, 0.32, 0.40), 0.72); }
    }
    color = saturate(color);
    if (u.quantize != 0 && u.clay == 0) {
        // Ordered dither before the palette lookup: a fixed per-pixel
        // threshold pattern, so edits change only local pixels and level
        // ground keeps a repeating pattern. Strength is in palette-LUT steps.
        var fc = floor(fragCoord);
#ifdef CHUNK
        if (u.chunkScale > 1.0) { fc = floor(vec2f(pixel.x, u.size - pixel.y)); }
        if (u.chunkScale < 1.0) { fc = floor(fragCoord / u.chunkScale); }
#endif
        let ign = fract(52.9829189 * fract(dot(fc, vec2f(0.06711056, 0.00583715))));
        // Smooth water gradients need dither; noisy ground grain does not.
        // The hard step's lit bed takes no palette dither (where a world draws lit bumps there, they replace its noise).
        let ditherStrength = select(u.dither * u.landDither, u.dither * (1.0 - shoalWeight), h < u.sea + 1.0);
        // Pairs mix on an ordered 4x4 threshold: retail's mixes are even
        // local checkerboards, which read as one colour; a noise threshold
        // clumped them into speckles.
        let bq = vec2i(fc) & vec2i(3);
        var bayer = array<i32, 16>(0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5);
        if (u.paletteMix != 0) { color = palettePattern(color, (f32(bayer[bq.y * 4 + bq.x]) + 0.5) / 16.0); }
        else {
            color = saturate(color + (ign - 0.5) * ditherStrength / 31.0);
            color = paletteColor(color);
        }
    }
    // Read-only pixel probes separate shaded form from material coverage.
    if (u.diagnosticView == 1) { color = vec3f(lighting); }
    if (u.diagnosticView == 2) { color = vec3f(ao); }
    if (u.diagnosticView == 3) { color = vec3f(shadow); }
    if (u.diagnosticView == 4) { color = vec3f(exposed); }
    if (u.diagnosticView == 5) { color = vec3f(lighting, ao, shadow); }
    if (u.diagnosticView == 6) { color = material; }
    if (u.diagnosticView == 7) { let code = bakedFields(p).b; color = vec3f(clamp(-code, 0.0, 1.0), clamp(code - 1.0, 0.0, 1.0), clamp(0.5 + bakedFields(p).r * 0.08, 0.0, 1.0) * 0.6); }
    return vec4f(color, 1.0);
}
