// WGSL port of the former sculpt.frag. See sculpt-common.wgsl for naming:
// uniform uFoo is u.foo; sampler uFoo is fooTex with fooSamp.
/*COMMON*/

// Material textures, as the GLSL texture units held them. A renderer may
// bind one texture to several of these (an absent slope material reads the
// ground, as the GLSL sampler pointed at the ground's unit).
@group(1) @binding(0) var grassTex: texture_2d<f32>;
@group(1) @binding(1) var grassSamp: sampler;
@group(1) @binding(2) var slopeGrassTex: texture_2d<f32>;
@group(1) @binding(3) var slopeGrassSamp: sampler;
@group(1) @binding(4) var slopeFringeTex: texture_2d_array<f32>;
@group(1) @binding(5) var slopeFringeSamp: sampler;
@group(1) @binding(6) var mineralRingTex: texture_2d<f32>;
@group(1) @binding(7) var mineralRingSamp: sampler;
@group(1) @binding(8) var rockTex: texture_2d<f32>;
@group(1) @binding(9) var rockSamp: sampler;
@group(1) @binding(10) var rockWeatheredTex: texture_2d<f32>;
@group(1) @binding(11) var rockWeatheredSamp: sampler;
@group(1) @binding(12) var rockFracturedTex: texture_2d<f32>;
@group(1) @binding(13) var rockFracturedSamp: sampler;
@group(1) @binding(14) var waterTex: texture_2d<f32>;
@group(1) @binding(15) var waterSamp: sampler;
@group(1) @binding(16) var waterShallowTex: texture_2d<f32>;
@group(1) @binding(17) var waterShallowSamp: sampler;
@group(1) @binding(18) var paletteTex: texture_2d<f32>;

// Material textures are read at one texel per pixel step: GLSL's
// texture(t, pixel / D) had implicit derivatives of exactly 1 / D per
// pixel. Explicit gradients select the same level and filter, and are legal
// in non-uniform control flow, where WGSL's textureSample is not.
fn pixelSample(t: texture_2d<f32>, s: sampler, pixel: vec2f, scale: vec2f) -> vec4f {
    return textureSampleGrad(t, s, pixel / scale, vec2f(1.0 / scale.x, 0.0), vec2f(0.0, 1.0 / scale.y));
}
fn pixelSampleLayer(t: texture_2d_array<f32>, s: sampler, pixel: vec2f, scale: vec2f, layer: i32) -> vec4f {
    return textureSampleGrad(t, s, pixel / scale, layer, vec2f(1.0 / scale.x, 0.0), vec2f(0.0, 1.0 / scale.y));
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
// Strata: coloured bands by height on raised ground (painted desert).
fn strataHash(k: f32) -> f32 { return fract(sin(k * 91.7 + 13.1) * 43758.5453); }
fn strataSlot(k: f32) -> vec3f { let i = i32(k + 0.5); return u.strataColors[clamp(i, 0, 4)].rgb; }
// Card E8 (Painted Desert): the grey band at the foot of retail's raised ground. Retail's
// neutral grey (mean (118,115,112)) sits in a thin height window on the first rise of the
// raised ground (world height 9-12 on a plain of 2-3; ribbons median 9 px wide on gently
// rising ground, measure/desert_greyband.py). Here the window is 4-6.5 above the plain,
// the middle of a lobe's rim, where its slope makes the ribbon that wide; the bumpy apron
// wanders it and the gaps break it into stretches.
// hf: the height above the plain; slope: units per px, which sets the edge softness.
// Card E8: the beds of one zone at height hr as a colour, for painted rock, whose height is
// not the zone's (the same split and share as the strata block; no edge softening, as a
// painted mesa's rock is mostly gentle).
fn rockStrata(hr: f32, zone: i32, paint: f32) -> vec3f {
    if (paint <= 0.0) { return strataSlot(u.strataZones[zone].y); }
    let z = u.strataZones[zone];
    let S = max(u.strataZoneSpace[zone].x, 0.5);
    let t = hr / S;
    let k = floor(t);
    let split = clamp(1.0 - z.w * (0.55 + 0.9 * strataHash(k + 0.37)), 0.03, 0.97);
    let isB = smoothstep(split - 0.04, split + 0.04, fract(t));
    return mix(strataSlot(z.y), strataSlot(z.z), isB);
}
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

// Two-entry mixes: retail art shows colours the palette lacks as pixel
// mixes of two entries (Painted Desert's tans are 50/50 pairs). The lookup's
// rows 32-63 and 64-95 hold the colour's best pair (palette_pairs.py); the
// mix along A-B is measured per pixel and a per-pixel threshold picks one.
fn palettePair(rgb: vec3f, threshold: f32) -> vec3f {
    let c = vec3i(clamp(floor(rgb * 31.0 + 0.5), vec3f(0.0), vec3f(31.0)));
    let at = vec2i(c.r + 32 * c.b, c.g);
    let a = textureLoad(paletteTex, at + vec2i(0, 32), 0).rgb;
    let b = textureLoad(paletteTex, at + vec2i(0, 64), 0).rgb;
    let d = b - a;
    let t = clamp(dot(rgb - a, d) / max(dot(d, d), 1e-5), 0.0, 1.0);
    return select(a, b, threshold < t);
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
// are sampled offline from retail neighbour statistics (ground_tiles.py) and
// stored in the first row of the ground texture.
fn groundHash(q: vec3i) -> f32 {
    var n = u32(q.x) * 374761393u + u32(q.y) * 668265263u + u32(q.z) * 2246822519u;
    n = (n ^ (n >> 13u)) * 1274126177u;
    return f32(n ^ (n >> 16u)) / 4294967295.0;
}
fn groundTile(pixel: vec2f) -> vec3f {
    let cell = vec2i(floor(pixel / 32.0));
    let local = vec2i(glslMod(floor(pixel), 32.0));
    let tile = min(i32(groundHash(vec3i(cell, 7)) * f32(u.groundTiles)), 15);
    return textureLoad(grassTex, vec2i(tile * 32 + local.x, local.y), 0).rgb;
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

// Ice crystal mountains (card E6). Retail's second ice mountain (ice-1) is slate
// ruled with straight dark strokes, 1-2 px wide and 8-40 px long, spaced 3-6 px, in
// domains ~36 px across that each keep one of three directions (two steep, one
// shallow, as the window's strokes run); the strokes break into segments. Domains
// are the nearest of a jittered lattice's points. Returns 0..1, 1 on a stroke.
fn iceHatch(pixel: vec2f) -> f32 {
    let cell = 36.0;
    let c = vec2i(floor(pixel / cell));
    var best = 1e9;
    var id = vec4f(0.0);
    var home = c;
    for (var j = -1; j <= 1; j++) {
        for (var i = -1; i <= 1; i++) {
            let k = c + vec2i(i, j);
            let r = markHash(k + vec2i(17, 53));
            let d = length(pixel - (vec2f(k) + 0.15 + 0.7 * r.xy) * cell);
            if (d < best) { best = d; id = r; home = k; }
        }
    }
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
    var snow = groundBased(select(pixelSample(grassTex, grassSamp, pixel, vec2f(512.0)).rgb, groundTile(pixel), u.groundMode == 1));
    var mean = select(u.groundTexMean, u.groundBase.rgb, u.groundBase.a > 0.5);
    let beachMean = select(u.beachTexMean, u.beachBase.rgb, u.beachBase.a > 0.5);
    if (u.beach != 0 && dot(beachMean, luma) > dot(mean, luma)) {
        snow = based(pixelSampleLayer(slopeFringeTex, slopeFringeSamp, pixel, vec2f(textureDimensions(slopeFringeTex, 0)), 2).rgb, u.beachTexMean, u.beachBase);
        mean = beachMean;
    }
    return saturate(mix(mix(snow, mean, 0.50), vec3f(1.0), 0.55));
}
// Moss: the world's slope cover (leaning toward its ground by Moss from
// ground, as the face blend does), its brightness grain widened about the
// cover's mean (not its hue, which would speckle) and a little darker, so a
// patch reads as clumpy moss rather than ground.
fn mossMaterial(pixel: vec2f) -> vec3f {
    const luma = vec3f(0.299, 0.587, 0.114);
    let cover = based(pixelSample(slopeGrassTex, slopeGrassSamp, pixel, vec2f(512.0)).rgb, u.slopeTexMean, u.slopeBase);
    let ground = groundBased(select(pixelSample(grassTex, grassSamp, pixel, vec2f(512.0)).rgb, groundTile(pixel), u.groundMode == 1));
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
// One layer of the mosaic: the nearest cell's hash, its lean and the distance to its seam, in cells of `size` px.
struct ShallowCell { id: vec4f, lean: f32, edge: f32 }
fn shallowCell(p: vec2f, size: f32, salt: i32) -> ShallowCell {
    let q = p / size;
    let cell = vec2i(floor(q));
    let at = fract(q);
    var d1 = 8.0;
    var d2 = 8.0;
    var id = vec4f(0.0);
    var off = vec2f(0.0);
    for (var j = -1; j <= 1; j++) {
        for (var i = -1; i <= 1; i++) {
            let h = markHash(cell + vec2i(i + salt, j));
            let pt = vec2f(f32(i), f32(j)) + 0.5 + (h.xy - 0.5) * 0.9 - at;
            let d = length(pt);
            if (d < d1) { d2 = d1; d1 = d; id = h; off = -pt; }
            else if (d < d2) { d2 = d; }
        }
    }
    return ShallowCell(id, dot(off, normalize(id.zw - 0.5 + vec2f(0.001))) * 0.5, (d2 - d1) * 0.5 * size);
}
fn crystalShallowWater(color: vec3f, p: vec2f, deep: f32, submerged: f32, slab: f32) -> vec3f {
    let size = max(u.crystalShallowPx, 4.0);
    // Two scales, as retail's mosaic has: a share of the water keeps cells 2.2 times as wide, the rest the fine ones.
    let big = shallowCell(p, size * 2.2, 7919);
    var c = shallowCell(p, size, 0);
    if (big.id.y < 0.4) { c = big; }
    let seam = 1.0 - smoothstep(0.3, 1.2, c.edge);
    let shade = 1.0 + 0.3 * (c.id.x - 0.5) + 0.35 * c.lean;
    let w = u.crystalShallow * submerged * (1.0 - smoothstep(0.1, 0.55, deep)) * (1.0 - smoothstep(0.05, 0.3, slab));
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
    let q = (p + warp) / size;
    let cell = vec2i(floor(q));
    let at = fract(q);
    var d1 = 8.0;
    var d2 = 8.0;
    var id1 = vec4f(0.0);
    var id2 = vec4f(0.0);
    for (var j = -1; j <= 1; j++) {
        for (var i = -1; i <= 1; i++) {
            let h = markHash(cell + vec2i(i, j));
            let d = length(vec2f(f32(i), f32(j)) + 0.5 + (h.xy - 0.5) * 0.9 - at);
            if (d < d1) { d2 = d1; id2 = id1; d1 = d; id1 = h; }
            else if (d < d2) { d2 = d; id2 = h; }
        }
    }
    let edge = (d2 - d1) * 0.5 * size;
    let w = fract((id1.z + id2.z) * 7.31);
    let drawn = smoothstep(u.crystalCraterGap, u.crystalCraterGap + 0.08, w);
    let width = 0.6 + 1.0 * fract(w * 3.7 + 0.2);
    let line = (1.0 - smoothstep(width * 0.5, width * 0.5 + 0.6, edge)) * drawn;
    return vec2f(line, 1.0 + u.crystalCraterTone * (id1.x - 0.5));
}

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
             slopeCover: f32, crystalMask: f32, sunSeen: f32, landform: f32) -> vec4f {
    var sand = 0.0;
    if (u.reliefMode == 1) { sand = smoothstep(0.35, 0.95, bakedFields(p).a); }
    if (u.beach != 0) { sand = max(sand, smoothstep(0.25, 0.75, beachField(p))); }
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
    let grained = normalize(vec3f(-micro, 1.0));
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
    return bank * smoothstep(0.1, 0.5, around - h);
}
// E10 (Lava): shine only on slopes, so the plain stays matte while the banks and hills glint (the shine model
// weighs Lava's ground-coloured faces as ground, which is level ground's weight too). Full strength on a slope of
// shineSlopeGate and above, none at a third of it and below.
fn shineSlopeGated(shine: vec4f, slope: f32) -> vec4f {
    let gate = smoothstep(u.shineSlopeGate * 0.35, u.shineSlopeGate, slope);
    return vec4f(shine.xyz * gate, mix(1.0, shine.w, gate));
}

// The shallow-to-deep step (card E1). Retail's step is a hard edge with
// ragged stairs, not the ramp's gradual blend: the step sits at one depth (the
// ramp's midpoint unless the world names one), is read off the bed's own depth
// rather than the soft disc average, and wanders by a block-sized jitter and a
// broad wobble. hard 0 is the ramp, 1 the step; between, both narrow together.
fn hardDeepStep(pixel: vec2f, depth: f32, colorDepth: f32, n: vec4f, hard: f32) -> f32 {
    let at = select(0.5 * (u.shallowDepth + u.deepDepth), u.deepEdgeDepth, u.deepEdgeDepth > 0.0);
    let block = floor(pixel / 2.0);
    let jitter = fract(sin(dot(block, vec2f(39.3467, 11.135))) * 43758.5453) - 0.5;
    let reach = mix(0.5 * (u.deepDepth - u.shallowDepth), 0.8, hard);
    let d = mix(colorDepth, depth, hard) + (jitter * 2.6 + (n.r - 0.5) * 5.0) * hard;
    return smoothstep(at - reach, at + reach, d);
}

// E11: value noise for the shelf's wander (smooth, 0..1, four lattice hashes).
fn shelfHash(c: vec2f) -> f32 { return fract(sin(dot(c, vec2f(127.1, 311.7))) * 43758.5453); }
fn shelfNoise(q: vec2f) -> f32 {
    let i = floor(q);
    let f = fract(q);
    let s = f * f * (3.0 - 2.0 * f);
    return mix(mix(shelfHash(i), shelfHash(i + vec2f(1.0, 0.0)), s.x), mix(shelfHash(i + vec2f(0.0, 1.0)), shelfHash(i + vec2f(1.0, 1.0)), s.x), s.y);
}

// The shallow-to-deep step with a true threshold (E11, Green and Red). The ragged
// stairs are pixel blocks in the picture, not in depth: depth units would turn a
// flat shelf into a wide fuzzy band (green-3's blurry middle), so the 2-px block
// jitter is scaled by the bed's own gradient. The step's depth wanders with broad
// noise (shelfWander units over shelfScale px), so the band's outline and width
// vary along the shore instead of following it at a fixed offset.
fn sharpDeepStep(p: vec2f, pixel: vec2f, depth: f32, cracked: bool) -> f32 {
    var at = select(0.5 * (u.shallowDepth + u.deepDepth), u.deepEdgeDepth, u.deepEdgeDepth > 0.0);
    if (cracked && u.crackedStep > 0.0) { at = u.crackedStep; }
    let grad = 0.5 * length(vec2f(baseHeight(p + vec2f(1.0, 0.0)) - baseHeight(p - vec2f(1.0, 0.0)),
                                  baseHeight(p + vec2f(0.0, 1.0)) - baseHeight(p - vec2f(0.0, 1.0))));
    let block = floor(pixel / 2.0);
    let jitter = fract(sin(dot(block, vec2f(39.3467, 11.135))) * 43758.5453) - 0.5;
    let q = p / max(u.shelfScale, 8.0);
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
        rgb = mix(rgb, lineTone, line * gap * zone * vis * (1.0 - u.ringTaper * t) * u.ringContrast);
    }
    return rgb;
}

// E11: the lit bed's mid-scale mottle. Retail's shallows are lit ground whose lumps of 4-17 px
// read as crisp patches, not clouds (luma s.d. after a 5-px blur 5.6-7.5 against ours 2.8-3.9
// with the fine grain alone), so the noise is cut at a threshold roughened by a pixel hash.
// pixel: the screen pixel (the grain). Returns -1..1.
fn bedMottleField(p: vec2f, pixel: vec2f) -> f32 {
    let z = u.bedMottleScale;
    let m = shelfNoise(p / (3.2 * z) + 31.0) * 0.5 + shelfNoise(p / (6.5 * z) + 7.0) * 0.3 + shelfNoise(p / (15.0 * z) + 53.0) * 0.2;
    let grain = fract(sin(dot(floor(pixel), vec2f(12.9898, 78.233))) * 43758.5453) - 0.5;
    return smoothstep(0.3, 0.7, 0.5 + (m - 0.5) * 2.2 + grain * 0.45) * 2.0 - 1.0;
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

// Shallow water as the bed under it (card E1): the ground colour already lit at
// this pixel, moved toward the water's own hue. The tint keeps the bed's light
// (its brightness against flat ground), so lumps, shade and grain carry through;
// bedTint is how much of the bed's own colour the tint replaces.
fn litBed(bed: vec3f, cracked: bool) -> vec3f {
    const luma = vec3f(0.299, 0.587, 0.114);
    let level = max(dot(groundBased(u.groundTexMean), luma), 0.02);
    // Shade stays paler under water than on land (retail's shaded bank beds show
    // as soft darker blue, never as black rims), so the dark side carries less.
    // A cracked bed (E11) is rock-like ground: its cracks keep their depth, both sides.
    let ratio = clamp(dot(bed, luma) / level, select(0.25, 0.1, cracked && u.crackedContrast > 0.0), 2.0);
    var contrast = u.bedContrast;
    var darkSide = 0.6;
    if (cracked && u.crackedContrast > 0.0) { contrast = u.crackedContrast; darkSide = 1.0; }
    let light = pow(ratio, select(contrast * darkSide, contrast, ratio >= 1.0));
    let tint = u.shallowMean * light * u.bedBright;
    return saturate(mix(bed, tint, u.bedTint));
}
// Ice frost band (card E5): the frost stroke marks every cell of its band with a
// little protection, and where frostWet is 1 those cells keep the white of the
// level snow instead of the grey the wet band gives the bank near the sea.
fn frostDry(near: f32, route: f32) -> f32 { return near * (1.0 - u.frostWet * smoothstep(0.02, 0.04, route)); }

// ---- F1: the current and the sediment it carries (mask planes 20-24; sculpt-flow.js) ----
// What the bake wrote at p: dir and speed of the current (the planes hold the direction times the
// square root of the speed, so slow water keeps its direction in a signed byte), and the
// concentration of each of the three sediments. On land the concentration planes carry the same
// sediment fading with the distance from the shore, which tints the banks.
struct FlowSample { dir: vec2f, speed: f32, conc: vec3f }
fn flowSample(p: vec2f) -> FlowSample {
    let a = textureSampleLevel(masksTex, linearClamp, maskUv(p), 5, 0.0);
    let b = textureSampleLevel(masksTex, linearClamp, maskUv(p), 6, 0.0);
    let m = length(a.xy);
    var s: FlowSample;
    s.speed = min(1.0, m * m);
    s.dir = select(vec2f(1.0, 0.0), a.xy / m, m > 0.01);
    s.conc = max(vec3f(a.z, a.w, b.x), vec3f(0.0));
    return s;
}
// The colour the carried sediments make together (their colours weighted by concentration), and their total.
fn sedimentMix(conc: vec3f) -> vec4f {
    let total = conc.x + conc.y + conc.z;
    let sum = u.sedimentColors[0].rgb * conc.x + u.sedimentColors[1].rgb * conc.y + u.sedimentColors[2].rgb * conc.z;
    return vec4f(sum / max(total, 1e-4), total);
}
fn flowHash(c: vec2f) -> f32 { return fract(sin(dot(c, vec2f(127.1, 311.7))) * 43758.5453); }
fn flowValue(q: vec2f) -> f32 {
    let i = floor(q);
    let f = fract(q);
    let w = f * f * (3.0 - 2.0 * f);
    return mix(mix(flowHash(i), flowHash(i + vec2f(1.0, 0.0)), w.x), mix(flowHash(i + vec2f(0.0, 1.0)), flowHash(i + vec2f(1.0, 1.0)), w.x), w.y);
}
// Streaks along the current: smooth noise averaged along the local flow direction (a short line
// convolution), so the streaks follow a bending current wherever it goes. -1..1.
fn flowStreaks(p: vec2f, dir: vec2f) -> f32 {
    var sum = 0.0;
    let step = u.flowStreakLen / 6.0;
    for (var k = -6; k <= 6; k++) {
        let q = p + dir * (f32(k) * step);
        sum += 0.65 * flowValue(q / 26.0) + 0.35 * flowValue((q + vec2f(41.0, 17.0)) / 11.0);
    }
    return clamp((sum / 13.0 - 0.5) * 4.0, -1.0, 1.0);
}
// Water carrying sediment: its colour is moved toward the sediments' own as they thicken (less in
// the shallows), keeping part of the water's light so grain and lit bed carry through; streaks run
// along the current, stronger where it is fast.
fn flowWater(water: vec3f, p: vec2f, deep: f32) -> vec3f {
    let s = flowSample(p);
    let sediment = sedimentMix(s.conc);
    let carry = saturate(sediment.w * 1.1);
    var out = water;
    if (sediment.w > 0.003) {
        let level = dot(water, vec3f(0.299, 0.587, 0.114));
        let tinted = saturate(sediment.rgb * (0.8 + (level - 0.2) * 0.6));
        out = mix(water, tinted, carry * u.flowTint * mix(u.flowShallow, 1.0, deep));
    }
    if (u.flowStreak > 0.0 && s.speed > 0.02) {
        let streak = flowStreaks(p, s.dir) * u.flowStreak * smoothstep(0.04, 0.5, s.speed);
        out *= 1.0 + 0.45 * streak * (0.6 + 0.4 * carry);
    }
    return out;
}
// Banks where the sediment reaches the shore: the stain the bake left on land, broken up by the
// same kind of noise as a painted mask's edge, thinner on sand (bars and beaches), keeping the
// ground's own light.
fn flowBank(color: vec3f, p: vec2f) -> vec3f {
    let s = flowSample(p);
    let sediment = sedimentMix(s.conc);
    if (sediment.w < 0.01) { return color; }
    let lobes = terrainNoise(p * 0.07 + vec2f(11.0, 47.0)).b - 0.5 + (terrainNoise(p * 0.45 + vec2f(5.0, 91.0)).r - 0.5) * 0.6;
    let grain = terrainNoise(p * 1.7 + vec2f(37.0, 13.0)).g + terrainNoise(p * 5.0 + vec2f(8.0, 71.0)).a * 0.6 - 0.8;
    let held = smoothstep(0.02, 0.2, sediment.w);
    let stain = smoothstep(0.12, 0.45, sediment.w * 1.5 + (lobes * 0.9 + grain * 0.7) * held) * u.flowBank;
    let sand = max(smoothstep(0.35, 0.95, bakedFields(p).a), smoothstep(0.15, 0.6, max(-bakedFields(p).a, 0.0)));
    let level = dot(color, vec3f(0.299, 0.587, 0.114));
    let tinted = saturate(sediment.rgb * (0.55 + level * 2.2));
    // Only low ground: the raised sand bars and hills in the water are not stained.
    let low = 1.0 - smoothstep(22.0, 38.0, baseHeight(p) - u.sea);
    return mix(color, tinted, saturate(stain * (1.0 - 0.85 * sand) * low));
}

@fragment
fn fragmentMain(v: VertexOut) -> @location(0) vec4f {
    // GLSL's gl_FragCoord (origin bottom left; the canvas is u.size high).
#ifdef CHUNK
    let fragCoord = vec2f(v.position.x + u.chunkScreenOrigin.x, u.size - (v.position.y + u.chunkScreenOrigin.y));
#else
    let fragCoord = vec2f(v.position.x, u.size - v.position.y);
#endif
    let p = v.world;
    // TA's fixed camera permits a native-pixel material grain. World-XY
    // sampling stretches that grain over projected south-facing slopes.
    // Geometry and broad material decisions still use world coordinates.
    let pixel = vec2f(fragCoord.x, u.size - fragCoord.y);
    // Sand grains read the rock at a noise-scattered coordinate; GLSL took
    // that lookup's level from implicit derivatives. WGSL allows derivatives
    // only in uniform control flow, so they are taken here, before any branch.
    let scatter = pixel * 1.37 + vec2f(terrainNoise(p * 2.0).r, terrainNoise(p * 2.0 + 9.0).g) * 40.0;
    let scatterDx = dpdx(scatter);
    let scatterDy = dpdy(scatter);
    let h = surfaceHeight(p);
    let g = surfaceGradient(p);
    let broad = broadGradient(p);
    let normal = normalize(vec3f(-g, 1.0));
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
    let flatLight = u.ambient + 0.95 * u.light.z;
    var lighting = (u.ambient + 0.95 * max(0.0, dot(normal, u.light))) / flatLight;
    lighting = min(lighting, u.lightCap);
    let ao = occlusion(p, h);
    let shadow = visibility(p, max(h, u.sea));
    var shading = lighting * ao * shadow;
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
        let castShadow = mix(1.0, shadow, mix(u.flatShadow, 1.0, onSlope));
        let occluded = mix(1.0, ao, mix(u.flatOcclusion, 1.0, onSlope));
        shading = min((u.ambient + fill + 0.95 * direct * castShadow) / flatLight, u.lightCap) * occluded;
    }
    // Retail Lava faces stay close to the ground's tone whichever way they
    // look (luma regressed on the height gradient: ~8 per unit slope east to
    // west against our 20; measured on four maps), so its world keeps only
    // part of the directional shading.
    if (u.shadeDepth < 1.0) { shading = mix(1.0, shading, u.shadeDepth); }
    var grass = groundBased(select(pixelSample(grassTex, grassSamp, pixel, vec2f(512.0)).rgb, groundTile(pixel), u.groundMode == 1));
    // The level ground before any slope cover, for crystal tops (crystalGrain).
    let levelGround = grass;
    var transitionGround = grass;
    var transitionFace = grass;
    var transitionLow = grass;
    var transitionPower = 1.0;
    var transitionCore = 0.0;
    var sharedTransition = false;
    var slopeShare = 0.0;
    var faceCover = 0.0;   // share of the face that is moss, not rock (the shine's slope cover)
    if (u.slopeMaterial != 0) {
        // Small native slope interiors retain moss ribs and scattered stone.
        // This is an appearance material, not recovered albedo or geometry.
        var slopeGrass = based(pixelSample(slopeGrassTex, slopeGrassSamp, pixel, vec2f(512.0)).rgb, u.slopeTexMean, u.slopeBase);
        var slopeCover = smoothstep(u.slopeProfile.x, u.slopeProfile.y, slope)
                       * smoothstep(u.slopeProfile.z, u.slopeProfile.w, h);
        if (u.mineralMargins != 0) {
            var cover = mineralMargin(p, slope, n);
            // Some biome hills keep their mineral material across the crown.
            // Elevation also gives their foot a broad transition into sand.
            var elevated = smoothstep(u.base + u.elevatedCover.x, u.base + u.elevatedCover.y,
                                      h + (n.g - 0.5) * 5.0);
            if (u.groundFringe != 0) { elevated *= smoothstep(u.base + 0.25, u.base + 2.0, baseHeight(p)); }
            cover = mix(cover, max(min(cover, 0.28), elevated), u.elevatedCover.z);
            if (u.groundFringe == 0) { cover = mix(cover, weatheredCover(cover, sediments, n), materialWeather); }
            // Softer native mineral fragments carry the fringe before the
            // deeper connected cracks take over on the face. This avoids dark
            // cliff fragments appearing as separate boulders on level ground.
            let fringe = pixelSampleLayer(slopeFringeTex, slopeFringeSamp, pixel, vec2f(512.0), 0).rgb;
            slopeGrass = mix(fringe, slopeGrass, smoothstep(0.42, 0.88, cover));
            // Native fissures reach farther than their brighter mineral fill.
            // Fade through that structure instead of blurring two full images.
            let stone = dot(slopeGrass, vec3f(0.299, 0.587, 0.114));
            let edge = (0.26 - stone) * 0.9 + (n.b - 0.5) * 0.12;
            slopeCover = smoothstep(0.04, 0.96, cover + edge * 4.0 * cover * (1.0 - cover))
                       * smoothstep(u.slopeProfile.z, u.slopeProfile.w, h);
            if (u.groundFringe != 0) {
                // This fringe already contains native ground plus thin vein
                // tails. Preserve its pixels before the darker face arrives;
                // fading both layers together turns the edge into a gray blur.
                let face = pixelSample(slopeGrassTex, slopeGrassSamp, pixel, vec2f(512.0)).rgb;
                let detail = (0.35 - dot(face, vec3f(0.299, 0.587, 0.114))) * 0.12;
                slopeGrass = mix(fringe, face, smoothstep(0.20, 0.78, cover + detail));
                if (u.ringAmount > 0.0) {
                    // A connected native vein material occupies its own
                    // irregular zone before the brown core. World-space
                    // variation crosses smooth ramps without changing grade.
                    let zone = cover + ((n.r - 0.5) * 0.38 + (n.g - 0.5) * 0.22) * u.ringVariation
                                     * smoothstep(0.0, 0.12, cover);
                    let spread = mix(0.60, 1.80, u.ringSpread);
                    let ring = pixelSample(mineralRingTex, mineralRingSamp, pixel, vec2f(512.0)).rgb;
                    let vein = smoothstep(u.fringeRange.x, u.fringeRange.y, dot(ring, u.fringeSignal.rgb) + u.fringeSignal.a);
                    let tail = smoothstep(0.005, 0.19, max(0.0, zone));
                    // Veins survive farther than their sandy fill. This keeps
                    // native fine texture while breaking the outer border into
                    // fading branches, rather than a uniform coloured collar.
                    let ringMask = smoothstep(0.06, 0.42, zone * spread + vein * 0.15)
                                 * tail * mix(0.30, 1.0, max(vein, smoothstep(0.16, 0.40, zone)));
                    var margin = mix(grass, fringe, tail * mix(0.25, 1.0, vein));
                    margin = mix(margin, ring, ringMask * u.ringAmount);
                    slopeGrass = mix(margin, face, smoothstep(0.22, 0.96, zone + detail));
                }
                slopeCover = smoothstep(0.01, 0.28, cover)
                           * smoothstep(u.slopeProfile.z, u.slopeProfile.w, h);
                if (materialWeather > 0.0 && u.transitionBody != 0) {
                    // The worker's spatially softened source measures a join
                    // across world pixels. All three materials use that same
                    // coordinate; independent height thresholds draw outlines.
                    var source = sediments.b;
                    let variation = ((n.r - 0.5) * 0.08 + (n.g - 0.5) * 0.04) * fringeVariation;
                    source = clamp(source + variation * 4.0 * source * (1.0 - source), 0.0, 1.0);
                    let ring = pixelSample(mineralRingTex, mineralRingSamp, pixel, vec2f(512.0)).rgb;
                    let body = pixelSampleLayer(slopeFringeTex, slopeFringeSamp, pixel, vec2f(512.0), 1).rgb;
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
                        let groundLow = textureSampleLevel(grassTex, grassSamp, pixel / 512.0, 3.0).rgb;
                        let ringLow = textureSampleLevel(mineralRingTex, mineralRingSamp, pixel / 512.0, 3.0).rgb;
                        let bodyLow = textureSampleLevel(slopeFringeTex, slopeFringeSamp, pixel / 512.0, 1, 3.0).rgb;
                        transitionLow = mix(mix(groundLow, ringLow, ringWeight), bodyLow, warm);
                        transitionPower = ((1.0 - ringWeight) * (1.0 - ringWeight) + ringWeight * ringWeight)
                                        * (1.0 - warm) * (1.0 - warm) + warm * warm;
                    }
                    transitionFace = face;
                    transitionCore = smoothstep(0.23, 0.88, source);
                    let faceGrain = 0.35 - dot(face, vec3f(0.299, 0.587, 0.114));
                    transitionCore = clamp(transitionCore + faceGrain * 0.35 * 4.0 * transitionCore * (1.0 - transitionCore), 0.0, 1.0);
                    sharedTransition = true;
                } else if (materialWeather > 0.0) {
                    let interruption = max(0.0, sediments.a - brokenSediments.a)
                                     * (1.0 - smoothstep(0.40, 0.90, cover));
                    let crust = max(0.0, cover - interruption * 1.35);
                    var zone = weatheredCover(crust, sediments, n);
                    zone = max(zone, brokenSediments.a * 0.36 * (1.0 - smoothstep(0.05, 0.35, sediments.a)));
                    let ring = pixelSample(mineralRingTex, mineralRingSamp, pixel, vec2f(512.0)).rgb;
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
                    let core = smoothstep(0.22, 0.96, max(0.0, cover - interruption * 0.6) + (n.b - 0.5) * 0.12)
                             * smoothstep(0.02, 0.35, sediments.a);
                    margin = mix(margin, face, core);
                    slopeGrass = mix(mix(grass, slopeGrass, slopeCover), margin, materialWeather);
                    slopeCover = 1.0;
                }
            }
        }
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
        if (u.reliefMode == 1 && u.slopeSand == 0) { slopeCover *= u.slopeTexture; }
        if (u.slopeSand != 0) { slopeCover *= max(smoothstep(0.15, 0.6, beachField(p) + max(bakedFields(p).a, 0.0)), route); }
        slopeShare = slopeCover;
        grass = mix(grass, slopeGrass, slopeCover);
    }
    // Small mineral interiors supply pixel structure; the whole crown/face/
    // foot comes from this surface. Some native microshading remains baked.
    let rockSize = vec2f(textureDimensions(rockTex, 0));
    var rock = pixelSample(rockTex, rockSamp, pixel, rockSize).rgb;
    rock = saturate(u.rockMean + (rock - u.rockMean) * u.mineralDetail);
    if (u.rockLayers != 0 && h > 18.0) {
        // Broad material regions vary actual native mineral structure. No
        // repeated whole cliff, colour-only variants or fresh pixel noise.
        let formation = terrainNoise(p * 0.35 + vec2f(43.0, 87.0)).r;
        let moss = terrainNoise(p * 0.70 + vec2f(173.0, 91.0)).g + weather.g * 0.30;
        let fractured = pixelSample(rockFracturedTex, rockFracturedSamp, pixel, vec2f(256.0)).rgb;
        let weathered = pixelSample(rockWeatheredTex, rockWeatheredSamp, pixel + vec2f(73.0, 17.0), vec2f(256.0)).rgb;
        rock = mix(rock, fractured, smoothstep(0.43, 0.57, formation));
        rock = mix(rock, weathered, smoothstep(0.40, 0.62, moss));
        // E9: the weathered and fractured tiles carry green blotches (14% and 5.5% of their pixels)
        // that read as moss scattered over the face; retail's face holds grass at its edges. Clamp
        // the green to the larger of red and blue so the tile keeps its structure and loses its moss.
        if (u.rockMoss < 1.0) { rock.g = mix(min(rock.g, max(rock.r, rock.b)), rock.g, u.rockMoss); }
    }
    rock = based(rock, u.rockTexMean, u.rockBase);
    // E9: the rock tile's own blotches and cell outlines read as soft cobble over the lit form;
    // below 1 the tile's contrast around the rock's mean colour is scaled down so the carved relief carries the face.
    if (u.rockDetail < 1.0) {
        let rockFlat = select(u.rockMean, u.rockBase.rgb, u.rockBase.a > 0.5);
        rock = rockFlat + (rock - rockFlat) * u.rockDetail;
    }
    // Deposition softens the exposed face into a connected apron. Flow and
    // deposited soil come from the same weathering that changed the surface.
    var rockScore = slope + (n.g - 0.5) * 0.55 + (n.b - 0.5) * 0.30 - weather.g * 0.55;
    if (u.shapeCoverage != 0) {
        let west = surfaceHeight(p - vec2f(10.0, 0.0));
        let east = surfaceHeight(p + vec2f(10.0, 0.0));
        let north = surfaceHeight(p - vec2f(0.0, 10.0));
        let south = surfaceHeight(p + vec2f(0.0, 10.0));
        let formSlope = length(vec2f(east - west, south - north) / 20.0);
        let convexity = clamp((h - 0.25 * (west + east + north + south)) / 5.0, -1.0, 1.0);
        rockScore = 0.55 * slope + 0.45 * formSlope + convexity * 0.28
                  + (n.g - 0.5) * select(0.25, 0.80, u.soilCover != 0) - weather.g * 0.55;
        if (u.soilCover != 0) { rockScore += (n.r - 0.5) * 0.70; }
    }
    if (u.ledgeCoverage != 0) {
        let west = surfaceHeight(p - vec2f(4.0, 0.0));
        let east = surfaceHeight(p + vec2f(4.0, 0.0));
        let north = surfaceHeight(p - vec2f(0.0, 4.0));
        let south = surfaceHeight(p + vec2f(0.0, 4.0));
        let localSlope = length(vec2f(east - west, south - north) / 8.0);
        let convexity = clamp((h - 0.25 * (west + east + north + south)) / 3.0, -1.0, 1.0);
        // Let actual shelves carry grass, even inside a broadly steep face.
        rockScore = 0.15 * slope + 0.85 * localSlope + convexity * 0.15
                  + (n.g - 0.5) * 0.15 - weather.g * 0.55;
    }
    var exposed = smoothstep(u.rockStart, u.rockFull, rockScore);
    if (u.soilCover != 0 && h > 18.0 && slope > 0.20 && exposed > 0.01) {
        let reach = mix(7.0, 70.0, smoothstep(0.30, 0.70, n.g));
        var soil = uphillSoil(p, broad / slope, baseHeight(p), reach);
        // Deposition can retain grass on actual gentle ledges. Its support
        // shares the weathered geometry; it is not a random green stipple.
        let ledge = (1.0 - smoothstep(0.55, 1.20, length(g))) * smoothstep(0.08, 0.40, weather.g);
        var pockets = smoothstep(0.55, 0.72, n.g * 0.55 + n.r * 0.45 + weather.g * 0.20);
        pockets *= 1.0 - smoothstep(1.55, 2.80, slope);
        soil = max(soil, max(ledge, pockets * 0.65));
        let covered = smoothstep(0.12, 0.55, soil);
        exposed *= 1.0 - covered * smoothstep(18.0, 28.0, h);
    }
    if (u.coastalDetail != 0) {
        let bank = 1.0 - smoothstep(1.0, 8.0, abs(h - u.sea - 3.0 + (n.g - 0.5) * 4.0));
        exposed = max(exposed, bank * smoothstep(0.3, 0.8, slope) * (0.4 + 0.6 * n.b) * u.bankRock);
    }
    // A steep ground-level bank remains grassy. Only nearby elevated land
    // admits an exposed face down to water; slope alone cannot classify it.
    // This is the Green Planet authoring rule, not a recovered retail formula.
    // The same rule gates the lump-scale face rock below: a bank's slope
    // includes the drop to the bed, which alone must not expose rock.
    var lowBank = 1.0;
    if (u.rockyCoasts == 0 && h < u.base + 1.0) {
        let uphill = broad / max(0.001, slope);
        var source = max(baseHeight(p), baseHeight(p + uphill * 16.0));
        source = max(source, baseHeight(p + uphill * 36.0));
        source = max(source, baseHeight(p + uphill * 64.0));
        lowBank = smoothstep(u.base + 12.0, u.base + 36.0, source);
        exposed *= lowBank;
    }
    if (u.mineralMargins != 0) { exposed *= smoothstep(0.45, 1.40, slope); }
    if (materialWeather > 0.0 && u.mineralMargins == 0) {
        var chipped = weatheredCover(exposed, sediments, n);
        let stoneGrain = dot(rock, vec3f(0.299, 0.587, 0.114));
        chipped = clamp(chipped + (0.34 - stoneGrain) * 0.5 * 4.0 * chipped * (1.0 - chipped), 0.0, 1.0);
        exposed = mix(exposed, chipped, materialWeather);
    }
    exposed *= 1.0 - route * (1.0 - smoothstep(0.45, 0.9, slope));
    // Sand bars: painted sand keeps raised ground sand to its crown, steep
    // or not (Zhon's river sections: domes rising ~100 units from the bed
    // are sand all over, no rock). The automatic beach does not.
    let sandBar = u.sandCrown * smoothstep(0.15, 0.6, max(-bakedFields(p).a, 0.0));
    exposed *= 1.0 - sandBar;
    let nearWater = frostDry(1.0 - smoothstep(u.sea + 1.0, u.sea + u.wetBand, h), route);
    var material = mix(grass, rock, exposed);
    if (u.beach != 0 && h > u.sea - 1.0) {
        // Beach sand: within reach of the water (baked), or failing that a
        // low band above the waterline. Its inland edge is ragged and breaks
        // into grains, and steep banks stay bare.
        let sandBeach = based(pixelSampleLayer(slopeFringeTex, slopeFringeSamp, pixel, vec2f(textureDimensions(slopeFringeTex, 0)), 2).rgb, u.beachTexMean, u.beachBase);
        let speck = terrainNoise(p * 6.0 + vec2f(61.0, 3.0)).b;
        var beach = smoothstep(0.25, 0.75, beachField(p) + (speck - 0.5) * 0.5);
        let top = u.beachHeight * u.beachWidth * (0.65 + 0.7 * terrainNoise(p * 0.45 + vec2f(29.0, 5.0)).g);
        // The low band only within the water's reach: inland hollows of a
        // low world are not beaches.
        beach = max(beach, (1.0 - smoothstep(top * 0.6, top, h - u.sea + (speck - 0.5) * 1.5)) * (1.0 - smoothstep(0.7, 1.3, slope)) * smoothstep(0.0, 0.15, beachField(p)));
        // A sandy slope keeps its own streaked material over the beach sand.
        if (u.slopeSand != 0) { beach *= 1.0 - slopeShare; }
        material = mix(material, sandBeach, beach * (1.0 - exposed * 0.7));
    }
    if (sharedTransition) {
        // Exposed rock belongs inside the face family, before its one join to
        // warm mineral and sand. It cannot repaint a second hard perimeter.
        let face = mix(transitionFace, rock, exposed);
        var refined = mix(transitionGround, face, transitionCore);
        if (u.transitionDetail > 0.0) {
            let faceLow = textureSampleLevel(slopeGrassTex, slopeGrassSamp, pixel / 512.0, 3.0).rgb;
            var rockLow = textureSampleLevel(rockTex, rockSamp, pixel / rockSize, 3.0).rgb;
            rockLow = saturate(u.rockMean + (rockLow - u.rockMean) * u.mineralDetail);
            let low = mix(transitionLow, mix(faceLow, rockLow, exposed), transitionCore);
            let facePower = (1.0 - exposed) * (1.0 - exposed) + exposed * exposed;
            let power = transitionPower * (1.0 - transitionCore) * (1.0 - transitionCore)
                      + facePower * transitionCore * transitionCore;
            // Mixing independent native grains reduces their variance. Recover
            // only the local detail; the accepted broad colour join stays put.
            let gain = mix(1.0, min(1.65, inverseSqrt(max(0.1, power))), u.transitionDetail);
            refined = low + (refined - low) * gain;
        }
        material = mix(material, refined, materialWeather);
    }
    if (u.reliefMode == 1 && u.microRock > 0.0) {
        // TA-style faces: moss and rock interleave at lump scale. The broad
        // slope sets how much of the face is rock; the detailed surface
        // decides where: rock on steep flanks and in hollows, moss on tops.
        let micro = length(g);
        let around = 0.25 * (surfaceHeight(p - vec2f(3.0, 0.0)) + surfaceHeight(p + vec2f(3.0, 0.0))
                           + surfaceHeight(p - vec2f(0.0, 3.0)) + surfaceHeight(p + vec2f(0.0, 3.0)));
        let top = clamp((h - around) / 1.5, -1.0, 1.0);
        // Lump-scale noise breaks the face's upper and lower edges.
        let edgeNoise = terrainNoise(p * 1.5 + vec2f(53.0, 11.0));
        let faceSlope = slope * (1.0 + (edgeNoise.r - 0.5) * u.faceEdge);
        var face = smoothstep(u.faceSlope.x, u.faceSlope.y, faceSlope) * (1.0 - route) * (1.0 - sandBar);
        var share = mix(u.rockShare.x, u.rockShare.y, smoothstep(u.faceSlope.y, u.faceSlope.y * 1.8, slope));
        var lowGate = lowBank;
        // Ice monotone mountains (card E6): retail's common ice mountain is one slate-blue material
        // from the first slope to the crest, not snow and rock interleaved: all face, all rock.
        if (u.iceSlate > 0.0) {
            face = max(face, smoothstep(0.12, 0.3, faceSlope) * (1.0 - route) * (1.0 - sandBar) * u.iceSlate);
            share = mix(share, 1.0, u.iceSlate);
        }
        // Painted face style (card C5): below 0 less of the face is rock, above 0 more.
        if (u.styleOn != 0) {
            let f = styleEdge(p, textureSampleLevel(masksTex, linearClamp, maskUv(p), 2, 0.0).r, wideSlope(p));
            share = select(share * (1.0 + f), mix(share, 1.0, f), f > 0.0);
        }
        // Painted rock counts as face whatever the slope, and is mostly rock.
        // (A branch of its own: rewriting the expressions above in place moved
        // a few pixels of other worlds through the compiler's float ordering.)
        if (u.paintOn != 0) {
            face = max(face, painted.x * (1.0 - sandBar));
            share = mix(share, 0.92, painted.x);
            lowGate = max(lowBank, painted.x);
        }
        let fine = terrainNoise(p * 3.0 + vec2f(19.0, 7.0));
        // Gullies at channel scale expose rock in streaks down the slope.
        let wide = 0.25 * (surfaceHeight(p - vec2f(7.0, 0.0)) + surfaceHeight(p + vec2f(7.0, 0.0))
                         + surfaceHeight(p - vec2f(0.0, 7.0)) + surfaceHeight(p + vec2f(0.0, 7.0)));
        let gully = smoothstep(0.3, 2.0, wide - h);
        // Structured rock (card E3): a ledge's lip is a convex ridge, not a lump
        // of moss, so on painted rock the lump-top term steps back (a hill's
        // own faces keep their moss; the bake covers their lips with rock).
        var topTerm = u.faceScore.y * top;
        if (u.rockOrder > 0.0) { topTerm *= 1.0 - u.rockOrder * painted.x; }
        let score = u.faceScore.x * micro / max(slope, 0.25) - topTerm + u.gullyRock * gully
                  + (fine.g - 0.5) * u.faceScore.z + (n.r - 0.5) * u.faceScore.w;
        // Threshold so that roughly the chosen share of face pixels is rock.
        let threshold = mix(1.4, -0.9, share);
        var rockMask = smoothstep(threshold - 0.12, threshold + 0.12, score) * lowGate;
        // E9: inside painted rock the face is rock; moss stays at its edges and on the ledges below.
        if (u.faceRock > 0.0 && u.paintOn != 0) { rockMask = max(rockMask, smoothstep(0.5, 0.9, painted.x) * u.faceRock); }
        let moss = mix(based(pixelSample(slopeGrassTex, slopeGrassSamp, pixel, vec2f(512.0)).rgb, u.slopeTexMean, u.slopeBase), groundBased(select(pixelSample(grassTex, grassSamp, pixel, vec2f(512.0)).rgb, groundTile(pixel), u.groundMode == 1)), u.mossFromGround);
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
        let brightGrass = saturate(based(pixelSample(grassTex, grassSamp, pixel, vec2f(512.0)).rgb, u.groundTexMean, u.groundBase) * vec3f(1.15, 1.35, 1.05));
        material = mix(material, brightGrass, rim * u.footRim * (1.0 - route));
        exposed = max(exposed * (1.0 - face), rockMask * face);
        // Thin dark crevices in the relief's hollows, also across mid slopes
        // where the face material has not taken over.
        let hollow = smoothstep(0.25, 0.9, -top) * smoothstep(u.faceSlope.x * 0.4, u.faceSlope.x, faceSlope);
        material *= 1.0 - u.crevice * hollow * (1.0 - route);
    }
    if (u.rockCrown > 0.0) {
        // Some worlds' raised ground is bare rock to its crown (Zhon's
        // domes), not only where it is steep.
        let crown = smoothstep(u.base + 5.0, u.base + 14.0, h + (n.g - 0.5) * 6.0) * u.rockCrown * (1.0 - route) * (1.0 - sandBar);
        material = mix(material, rock, crown);
        exposed = max(exposed, crown);
    }
    if (u.strata > 0.0) {
        // Beds by height, measured on retail Painted Desert: a zone table
        // (start above the plain; materials A and B as colour slots; B's
        // share of each period). Within a zone A and B alternate every
        // uStrataSpacing units, quasi-periodically (B's share varies per
        // bed), and B's share ramps toward the next zone when both use the
        // same pair. Beds colour all raised ground, level tops included
        // (retail mesa caps take their band's colour); edges are hard (~3
        // px); bed edges wander ~1-1.5 units at 5-25 px and meander broadly.
        let warp = (terrainNoise(p * 0.08 + vec2f(5.0, 9.0)).r - 0.5) * u.strataWarp
                 + (terrainNoise(p * 0.7 + vec2f(17.0, 2.0)).g - 0.5) * 2.6
                 + (terrainNoise(p * 2.1 + vec2f(3.0, 41.0)).b - 0.5) * 1.2;
        let hr = h - u.base + warp;
        var zone = 0;
        for (var i = 1; i < 6; i++) { if (i < u.strataZoneCount && hr >= u.strataZones[i].x) { zone = i; } }
        let z = u.strataZones[zone];
        var share = z.w;
        if (zone + 1 < u.strataZoneCount) {
            let next = u.strataZones[zone + 1];
            if (next.y == z.y && next.z == z.z) { share = mix(z.w, next.w, clamp((hr - z.x) / max(next.x - z.x, 0.1), 0.0, 1.0)); }
        }
        var S = max(u.strataSpacing, 0.5);
        // Card E8: retail's beds thicken up the buttes (lit flanks above 60: line gaps
        // of 11-15 units, against the apron's 6), so a zone may carry its own thickness.
        if (u.strataZoneSpace[zone].x > 0.0) { S = u.strataZoneSpace[zone].x; }
        let t = hr / S;
        let k = floor(t);
        let f = fract(t);
        let split = clamp(1.0 - share * (0.55 + 0.9 * strataHash(k + 0.37)), 0.03, 0.97);
        let edge = clamp(1.5 * max(slope, 0.05) / S, 0.01, 0.2);
        let isB = smoothstep(split - edge, split + edge, f) * (1.0 - smoothstep(1.0 - edge, 1.0, f));
        // Painted rock (card C5) in a world with beds takes the colour its
        // highest ground is painted with (its top zone's main bed: Painted
        // Desert's grey buttes), not the alternating beds or the brown rock art.
        let topZone = max(u.strataZoneCount - 1, 0);
        var rockBed = strataSlot(u.strataZones[topZone].y);
        // Card E8: the strata run through the rock itself, so painted rock carries the top
        // zone's own beds (its grey with the lines), not one flat colour, wherever it is painted.
        if (u.strataZoneSpace[topZone].x > 0.0) { rockBed = rockStrata(hr, topZone, painted.x); }
        let bed = mix(mix(strataSlot(z.y), strataSlot(z.z), isB), rockBed, painted.x);
        let lum = dot(material, vec3f(0.299, 0.587, 0.114));
        let meanLum = max(dot(u.groundTexMean, vec3f(0.299, 0.587, 0.114)), 0.05);
        // The ground's grain survives in the beds as brightness, scaled by
        // Bed grain (retail desert bands are smooth colour).
        let bedColour = saturate(bed * mix(1.0, clamp(lum / meanLum, 0.82, 1.12), u.strataGrain));
        let onRaised = smoothstep(u.strataZones[0].x, u.strataZones[0].x + 1.5, hr) * (1.0 - route);
        material = mix(material, bedColour, max(u.strata * u.strataContrast * onRaised, u.strata * painted.x));
        if (u.baseBand > 0.0) { material = mix(material, strataSlot(4), baseBandMask(p, h - u.base, slope)); }
    }
    // Painted masks (card C5), after the world's own beds and before sand,
    // which covers them. Rock went through the face treatment above; where a
    // world has none (microRock 0) it is the plain rock material.
    if (u.paintOn != 0) {
        let faceHandled = select(0.0, 1.0, u.reliefMode == 1 && u.microRock > 0.0);
        material = mix(material, rock, painted.x * (1.0 - faceHandled));
        material = mix(material, snowMaterial(pixel), painted.y);
        material = mix(material, mossMaterial(pixel), painted.w);
        exposed = max(exposed, painted.x);
    }
    if (u.reliefMode == 1) {
        // Procedural sand: a colour with two scales of grain, so it needs no
        // sampled art. Coverage comes from the bake.
        let sand = bakedFields(p).a;
        if (sand > 0.0) {
            // Weathered rock: the rock's own average colour, lightened and
            // dulled by weathering, with fragments of the rock texture as
            // grains. A biome's sand therefore follows its own rock.
            let rockLevel = textureSampleLevel(rockTex, rockSamp, vec2f(0.5), 12.0).rgb;
            let rockAverage = select(rockLevel, u.rockBase.rgb, u.rockBase.a > 0.5);
            var weathered = mix(rockAverage, vec3f(dot(rockAverage, vec3f(0.299, 0.587, 0.114))), 0.25);
            weathered = mix(weathered, vec3f(1.0), u.sandLight * 0.55);
            if (u.sandBase.a > 0.5) { weathered = u.sandBase.rgb; }
            var fragment = textureSampleGrad(rockTex, rockSamp, scatter / rockSize, scatterDx / rockSize, scatterDy / rockSize).rgb;
            fragment = mix(fragment, vec3f(1.0), u.sandLight * 0.45);
            if (u.sandBase.a > 0.5) { fragment = saturate(fragment - rockLevel + u.sandBase.rgb); }
            let sandMaterial = mix(weathered, fragment, u.sandGrain);
            // Three stages, so sand thins into the ground over tens of
            // pixels: fines tint what is there, then grains appear between
            // grass blades (a per-pixel threshold against fine noise), then
            // sand covers the ground.
            material = mix(material, weathered, smoothstep(0.0, 0.6, sand) * u.sandDust * 0.6);
            let speck = terrainNoise(p * 6.0 + vec2f(17.0, 29.0)).b;
            let cover = smoothstep(0.35, 0.95, sand + (speck - 0.5) * 0.55 * u.sandEdge);
            // Grass and moss travel with the sand and regrow over it in
            // patches, more where it is thin; tufts break the patch edges.
            let patchy = terrainNoise(p * 0.35 + vec2f(51.0, 7.0)).g * 0.65 + terrainNoise(p * 1.3 + vec2f(3.0, 91.0)).b * 0.35;
            let tuft = terrainNoise(p * 5.0 + vec2f(13.0, 47.0)).r;
            let regrow = smoothstep(0.62, 0.80, patchy + (1.0 - sand) * 0.22 + (tuft - 0.5) * 0.3) * u.sandGrass;
            material = mix(material, sandMaterial, cover * (1.0 - regrow));
        }
    }
    // Baked boulders take rock material, lit by the same surface.
    if (u.reliefMode == 1) {
        let coverOrCrack = bakedFields(p).b;
        // A crack wall facing the sun.
        if (coverOrCrack > 1.0) { material *= 1.0 + u.crackLit * (coverOrCrack - 1.0); }
        else { material = mix(material, rock * 1.08, max(coverOrCrack, 0.0)); }
        // A crack's floor is in shadow: darken what is there, so a crack in
        // grass stays green-black and one in rock grey-black. The walls are
        // lit by the carved geometry.
        // Codes below -1 come only from band lines with Line darkness above
        // 1 (Green's dark terrace steps); up to -1 this is unchanged.
        material *= 1.0 - min(u.crackDark * max(-coverOrCrack, 0.0), 1.0);
    }
    var chip = smoothstep(0.08, 0.45, screeHeight(p) * (1.0 - route));
    chip = max(chip, smoothstep(0.035, 0.40, materialChipHeight(p) * (1.0 - route)) * 0.65);
    material = mix(material, rock, chip * (1.0 - exposed));
    var cleft = 0.0;
    if (u.reliefMode != 1) { cleft = smoothstep(0.15, 1.20, fractureDepth(p, h, slope)); }
    material = mix(material, mix(grass * 0.90, rock * 0.78, 0.30 + exposed * 0.50), cleft * 0.35);
    material *= 1.0 - weather.r * 0.06;
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
    var color = material * mix(shading, 1.0, flatBank);
    if (u.shadeBlue > 0.0) {
        // Ice (card E5): retail's shaded ice is periwinkle (palette entries that keep blue
        // 227-255 as red and green fall), where a plain multiply goes grey-teal in the palette.
        let fall = clamp(1.0 - shading, 0.0, 1.0) * u.shadeBlue;
        color = material * (shading + fall * vec3f(0.0, 0.35, 0.85));
    }
    // Raised or sloped ground (card E6): the footprint of the shine gate and of Moon's pockmarks; level plain is 0.
    // Raised ground counts whole, tops included, where a crater's floor counts only where it slopes.
    var landform = 1.0;
    if (u.shineGate > 0.0 || u.pockmark > 0.0) { landform = max(smoothstep(0.1, 0.35, slope), smoothstep(u.base + 3.0, u.base + 9.0, baseHeight(p))); }
    if (u.iceCrystal > 0.0) {
        // Straight strokes over the rock faces, darker the more rock shows (card E6; after shadeBlue, which rebuilds the colour).
        color *= 1.0 - 0.75 * u.iceCrystal * iceHatch(pixel) * smoothstep(0.3, 0.8, exposed);
    }
    if (u.shineOn != 0) {
        // Cast shadow as the diffuse term applies it (level ground keeps flatShadow), so no glint sits in a shadow.
        let sunSeen = (1.0 - clamp((1.0 - shadow) / 0.32, 0.0, 1.0) * mix(u.flatShadow, 1.0, smoothstep(0.08, 0.35, slope))) * (1.0 - flatBank);
        var shine = shineTerm(pixel, p, g, normal, material, exposed, faceCover, slopeShare, crystalMask, sunSeen, landform);
        // E9: the glints belong to the painted face; the small rock patches of ordinary hills keep this share of them.
        if (u.shineOutside < 1.0) { shine = vec4f(shine.xyz * mix(u.shineOutside, 1.0, smoothstep(0.4, 0.9, painted.x)), shine.w); }
        if (u.shineSlopeGate > 0.0) { shine = shineSlopeGated(shine, slope); }
        color = color * shine.w + shine.xyz;
    }
    if (u.layerCrease > 0.0) { color *= 1.0 - u.layerCrease * layerCreaseTerm(p); }
    if (u.pockmark > 0.0 && h > u.sea + 1.0 && landform > 0.0) {
        let shaded = 1.0 - clamp(shading, 0.0, 1.0);
        let pits = pockPits(pixel, u.pockSize, u.pockmark * mix(0.6, 1.0, shaded));
        color *= 1.0 - pits * landform * mix(0.5, 0.92, shaded);
    }
    if (u.slopeMarks > 0.0 && h > u.sea + 1.0) {
        // More on faces turned from the light (sections: ~0.6 as many on
        // lit faces of the same slope).
        let away = smoothstep(-0.05, 0.10, dot(broad, normalize(u.light.xy)));
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
    if (u.wrinkles > 0.0 && h > u.sea + 1.0) {
        // Joined wrinkles (Moon): on every slope, more on faces turned from the light.
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
    if (u.flowOn != 0 && h > u.sea - 1.0) { color = flowBank(color, p); }
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
        var edgeHard = u.deepEdge;
        var bedLit = u.bedLit;
        var crackedBed = false;
        if (u.waterOn != 0) {
            crackedBed = textureSampleLevel(masksTex, linearClamp, maskUv(p), 3, 0.0).g > 0.5;
            let pick = textureSampleLevel(masksTex, linearClamp, maskUv(p), 2, 0.0).gba;
            if (pick.x > 0.5) { shoreHard = 1.0; } else if (pick.x < -0.5) { shoreHard = 0.0; }
            if (pick.y > 0.5) { edgeHard = 1.0; } else if (pick.y < -0.5) { edgeHard = 0.0; }
            if (pick.z > 0.5) { bedLit = 1.0; } else if (pick.z < -0.5) { bedLit = 0.0; }
        }
        var deep = smoothstep(u.shallowDepth, u.deepDepth, colorDepth);
        if (edgeHard > 0.0) {
            if (u.stepSharp > 0.0) { deep = sharpDeepStep(p, pixel, depth, crackedBed); }
            else { deep = hardDeepStep(pixel, depth, colorDepth, n, edgeHard); }
        }
        let waterSize = vec2f(textureDimensions(waterTex, 0));
        let grain = pixelSample(waterTex, waterSamp, pixel, waterSize).rgb - u.waterMean;
        var water = mix(select(u.shallowColor, u.shallowBase.rgb, u.shallowBase.a > 0.5), select(u.deepColor, u.deepBase.rgb, u.deepBase.a > 0.5), deep) + grain * mix(2.3, 0.95, deep);
        if (u.nativeShallows != 0 && u.shallowBase.a < 0.5 && u.deepBase.a < 0.5) {
            var shallow = pixelSample(waterShallowTex, waterShallowSamp, pixel, vec2f(textureDimensions(waterShallowTex, 0))).rgb;
            let deepWater = pixelSample(waterTex, waterSamp, pixel, waterSize).rgb;
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
            if (bedLit > 0.0) { shallow = mix(shallow, litBed(select(levelGround * bedShade, color / max(shading, 0.05) * bedShade, crackedBed), crackedBed), bedLit); }
            if (u.bedDots > 0.0 && bedLit > 0.0) { shallow *= 1.0 - u.bedDots * bedDotField(pixel) * vec3f(1.0, 1.0, 0.55) * bedLit; }
            if (u.bedMottle > 0.0 && bedLit > 0.0 && !crackedBed && edgeHard > 0.0) { shallow *= 1.0 + u.bedMottle * bedMottleField(p, pixel) * bedLit; }
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
        if (u.flowOn != 0) { water = flowWater(water, p, deep); }
        var submerged = smoothstep(-0.2, 2.8, depth);
        if (shoreHard > 0.0) {
            // Retail waterlines are hard edges with small stair-step notches,
            // not soft fades: threshold depth against pixel-block jitter.
            let block = floor(pixel / 2.0);
            let jitter = fract(sin(dot(block, vec2f(12.9898, 78.233))) * 43758.5453) - 0.5;
            let crisp = step(0.6 + jitter * 1.4, depth);
            submerged = mix(submerged, crisp, shoreHard);
        }
        color = mix(color, water * (0.92 + 0.08 * shadow), submerged);
        if (u.crystalSeam > 0.0 && crystalMask > 0.05) { color = crystalSlabWater(color, crystalMask, submerged); }
        if (u.crystalShallow > 0.0) { color = crystalShallowWater(color, p, deep, submerged, crystalMask); }
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
        let fc = floor(fragCoord);
        let ign = fract(52.9829189 * fract(dot(fc, vec2f(0.06711056, 0.00583715))));
        // Smooth water gradients need dither; noisy ground grain does not.
        let ditherStrength = select(u.dither * u.landDither, u.dither, h < u.sea + 1.0);
        // Pairs mix on an ordered 4x4 threshold: retail's mixes are even
        // local checkerboards, which read as one colour; a noise threshold
        // clumped them into speckles.
        let bq = vec2i(fc) & vec2i(3);
        var bayer = array<i32, 16>(0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5);
        if (u.paletteMix != 0) { color = palettePair(color, (f32(bayer[bq.y * 4 + bq.x]) + 0.5) / 16.0); }
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
