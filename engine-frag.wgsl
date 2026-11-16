// WGSL port of the former sculpt.frag. See engine-common.wgsl for naming:
// uniform uFoo is u.foo; sampler uFoo is fooTex with fooSamp.
/*COMMON*/
/*VOLUME*/

// Material textures, as the GLSL texture units held them. A renderer may
// bind one texture to several of these (an absent slope material reads the
// ground, as the GLSL sampler pointed at the ground's unit).
@group(1) @binding(18) var paletteTex: texture_2d<f32>;

// Above 1x a texel is one drawn pixel, not one world pixel: the pattern comes out smaller and keeps its grain and dither.
fn grainPixel(pixel: vec2f) -> vec2f {
    return pixel / min(u.chunkScale, 1.0);
}

// Move a texture to a new base colour, keeping its grain.
// Low ground: a colour moved to the low colour, its difference from its material's mean kept as grain (as a material's Color moves its steps),
// so the palette still mixes the grain's hues where a single tone would land on one entry.
fn lowTinted(c: vec3f, mean: vec3f) -> vec3f { return saturate(c - mean + u.lowColor); }
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

// The share of the sun that reaches the point past the relief toward it: 0 in a cast shadow, which takes the whole direct light (it took
// 32% of it, which left a long shadow at a low sun too faint to read), 1 in the open.
fn visibility(p: vec2f, h: f32) -> f32 {
    let toward = normalize(u.light.xy);
    let elevation = u.light.z / length(u.light.xy);
    var shadow = 0.0;
    for (var i = 4; i <= 12; i++) {
        let d = f32(i * i) * 1.4 + 2.0;
        let q = p + toward * d;
        if (q.x < 0.0 || q.y < 0.0 || q.x >= u.size || q.y >= u.size) { continue; }
        let blocker = surfaceHeight(q) - h - d * elevation;
        shadow = max(shadow, smoothstep(-2.0, 4.0, blocker));
    }
    // A lower sun casts longer shadows (a wall's is its height over the tangent of the sun's height). Past the twelfth sample the march goes
    // on from 238.6 px (where a thirteenth would be) in steps that test 6 units higher each (the smoothstep's width, so a ragged crest leaves
    // no gaps in its shadow), while a sample tests a height under 240 above the pixel, reading the authored height there: the relief's few
    // units do not move a shadow cast from that far. Each fades in as the height it tests falls from 240 to 200, so the shadow grows
    // smoothly as Sun height goes down. At every world's own sun the first tests above 240 (Green's 240.3): the march is the one it was.
    // The chunk renderer's grid apron covers these samples (sculpt-chunk-renderer.js reaches, `far`).
    let farStep = 6.0 / elevation;
    for (var k = 0; k < 40; k++) {
        let d = 238.6 + f32(k) * farStep;
        let fade = clamp((240.0 - d * elevation) / 40.0, 0.0, 1.0);
        if (fade <= 0.0) { break; }
        let q = p + toward * d;
        if (q.x < 0.0 || q.y < 0.0 || q.x >= u.size || q.y >= u.size) { continue; }
        shadow = max(shadow, fade * smoothstep(-2.0, 4.0, baseHeight(q) - h - d * elevation));
    }
    return 1.0 - shadow;
}

// B4: where visibility()'s cast shadow comes from: the sample that shades the point most (the same samples), and how much of the occluder the
// sun's line crosses there: the length of the line under the heights over 36 px about that sample (a fin's thickness, or 36 for a mesa).
// It runs only on shaded pixels and only where a rock in use colours its shadow.
fn shadowBlocker(p: vec2f, h: f32) -> vec3f {
    let toward = normalize(u.light.xy);
    let elevation = u.light.z / length(u.light.xy);
    var most = 0.0; var at = 0.0;
    for (var i = 4; i <= 12; i++) {
        let d = f32(i * i) * 1.4 + 2.0;
        let q = p + toward * d;
        if (q.x < 0.0 || q.y < 0.0 || q.x >= u.size || q.y >= u.size) { continue; }
        let s = smoothstep(-2.0, 4.0, surfaceHeight(q) - h - d * elevation);
        if (s > most) { most = s; at = d; }
    }
    let farStep = 6.0 / elevation;
    for (var k = 0; k < 40; k++) {
        let d = 238.6 + f32(k) * farStep;
        let fade = clamp((240.0 - d * elevation) / 40.0, 0.0, 1.0);
        if (fade <= 0.0) { break; }
        let q = p + toward * d;
        if (q.x < 0.0 || q.y < 0.0 || q.x >= u.size || q.y >= u.size) { continue; }
        let s = fade * smoothstep(-2.0, 4.0, baseHeight(q) - h - d * elevation);
        if (s > most) { most = s; at = d; }
    }
    var crossed = 0.0;
    for (var j = -12; j < 12; j++) { let d = at + (f32(j) + 0.5) * 1.5; crossed += select(0.0, 1.5, baseHeight(p + toward * d) > h + d * elevation); }
    return vec3f(p + toward * at, crossed);
}

fn occlusion(p: vec2f, h: f32) -> f32 {
    var result = 0.0;
    for (var i = 0; i < 8; i++) {
        let angle = f32(i) * 2.399963;
        let d = 32.0 + f32(i % 3) * 14.0;
        let q = p + vec2f(cos(angle), sin(angle)) * d;
        result += clamp((surfaceHeight(q) - h) / d - 0.12, 0.0, 1.0);
    }
    return 1.0 - result * 0.045;
}

// Pattern mixes (card P9): retail art shows colours the palette lacks as pixel
// mixes of palette entries (Painted Desert's tans are 50/50 pairs). The lookup's
// rows 32-287 hold eight candidates per colour, sorted dark to light, whose
// mean is the colour (Knoll, engine-palette.wgsl); a per-pixel ordered
// threshold picks one.
fn palettePattern(rgb: vec3f, threshold: f32) -> vec3f {
    let c = vec3i(clamp(floor(rgb * 31.0 + 0.5), vec3f(0.0), vec3f(31.0)));
    let at = vec2i(c.r + 32 * c.b, c.g);
    // Subpixel palette patterns converge to their mixture when zoomed out.
    if(u.chunkScale>1.0){
        var sum = vec3f(0.0);
        for (var k = 0; k < 8; k++) { sum += textureLoad(paletteTex, at + vec2i(0, 32 + 32 * k), 0).rgb; }
        return sum * 0.125;
    }
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

// The world's ground and water are materials (sculpt-materials.js): unlit color and art height cached over a repeat, read at the
// world point so a level plain costs only the repeat's own 32-px tiles.
fn worldGround(p:vec2f)->vec3f { return materialPigment(p,u32(u.groundDefault)); }
fn groundMean()->vec3f { return materialMean(u32(u.groundDefault)); }
fn waterMean()->vec3f { return materialMean(u32(u.waterGround)); }
// A Hermite ramp from 0 at depth a to 1 at depth b, defined for either order (b below a runs it down); equal depths step.
fn waterRamp(a: f32, b: f32, x: f32) -> f32 {
    if (abs(b - a) < 1e-4) { return step(a, x); }
    let t = clamp((x - a) / (b - a), 0.0, 1.0);
    return t * t * (3.0 - 2.0 * t);
}
// Water is lit by its own art height here: the bed's light is another model (the shallows), and the sea has no terrain normal.
fn waterPigment(p:vec2f)->vec3f {
 let slot=u32(u.waterGround);
 let dx=materialRelief(p+vec2f(1,0),slot)-materialRelief(p-vec2f(1,0),slot);
 let dy=materialRelief(p+vec2f(0,1),slot)-materialRelief(p-vec2f(0,1),slot);
 let normal=normalize(vec3f(-vec2f(dx,dy)*.5,1));
 let light=(u.ambient+.95*max(0.0,dot(normal,u.light)))/max(.001,u.ambient+.95*u.light.z);
 let highlight=pow(max(0.0,dot(normal,normalize(u.light+vec3f(0,0,1)))),16.0)*materialShine(p,slot)*.35;
 return materialPigment(p,slot)*min(light,u.lightCap)+vec3f(highlight);
}
// The world's table rows (materials/<world>.json placement and cover: sculpt-material-model.js).
fn matRow(i: u32) -> vec4f { return u.materialTable[i]; }
// A surface's material at a native pixel: its role's (u.slopeGround, u.debrisGround...), else the fallback role's, else the ground's mean.
fn roleColor(slot: i32, fallback: i32, pixel: vec2f) -> vec3f {
    let s = select(fallback, slot, slot >= 0); if (s < 0) { return groundMean(); }
    return materialPigment(grainPixel(pixel), u32(s));
}
fn roleMean(slot: i32, fallback: i32) -> vec3f { let s = select(fallback, slot, slot >= 0); if (s < 0) { return groundMean(); } return materialMean(u32(s)); }
fn slopeGrassSource(pixel: vec2f) -> vec3f { return roleColor(u.slopeGround, u.groundDefault, pixel); }
fn slopeTexMean() -> vec3f { return roleMean(u.slopeGround, u.groundDefault); }

// H3 item 4. Where rock shows, and how much of a face is rock: the one function that decides Green's
// land placement. Its numbers are rows of materials/green.json after the five materials (MM_PLACE):
//   row 0  x: slope weight, y: form-slope weight, z: convexity weight, w: convexity range
//   row 1  x: noise weight (n.g), y: noise weight (n.r), z: weather weight, w: tap spacing, px
//   row 2  x,y: rock score start and full (the score is slope-like, about 1 on a steep face); z: weight of the third noise (n.b)
//   row 3  x: soil slope gate, y: soil height gate, z,w: soil height fade
//   row 4  x,y: low-bank source heights above the plain (rock needs land this high up-slope)
//   row 5  x,y: slope at which a smooth route stops holding rock off (start, full); z,w: with z above 0, rock only on slopes from z to w
// (A steep face is the rock face's, engine-common.wgsl rockFaceAt: the draw mixes its rock share over this placement where it lies.)
// Override planes (planes 14-17 of the masks; a signed value v multiplies its control by 1 + v, and 0 changes nothing):
// exposure scales where rock shows, vegetation scales the grass and moss that is left, deposits scale sand and scree
// (read outside, through Place.deposits); the erosion plane is read on the CPU side by the GPU pass.
const MM_PLACE = 156u;
fn pr(i: u32) -> vec4f { return matRow(MM_PLACE + i); }
struct Place { exposed: f32, lowBank: f32, top: f32, deposits: f32, vegetation: f32, exposure: f32, convexity: f32 }
fn landPlace(p: vec2f, h: f32, g: vec2f, broad: vec2f, slope: f32, n: vec4f, weather: vec2f, route: f32) -> Place {
    var out: Place;
    let r0 = pr(0u); let r1 = pr(1u); let r2 = pr(2u); let r3 = pr(3u); let r4 = pr(4u); let r5 = pr(5u);
    var exposure = 0.0;
    var vegetation = u.lushness;   // card P30: the world-wide baseline of the painted override
    out.deposits = 1.0;
    out.vegetation = 1.0 + u.lushness;
    if (u.overrideOn != 0) {
        let uv = maskPoint(p);
        let planes = sampleMasks(uv,4);
        vegetation = u.lushness + planes.r;
        out.vegetation = 1.0 + vegetation;
        exposure = planes.g;
        out.deposits = 1.0 + sampleMasks(uv,3).w;
    }
    // Rock: the broad slope, the form's slope and convexity at the tap spacing, noise, and the weathering's wear.
    let d = r1.w;
    let west = baseHeight(p - vec2f(d, 0.0));
    let east = baseHeight(p + vec2f(d, 0.0));
    let north = baseHeight(p - vec2f(0.0, d));
    let south = baseHeight(p + vec2f(0.0, d));
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
    out.exposure = 1.0 + exposure;
    out.lowBank = lowBank;
    // How far the surface stands above the mean of a ring 3 px out (a lump's top, 1; a hollow, -1): the ground cover's soil reads it.
    let around = 0.25 * (baseHeight(p - vec2f(3.0, 0.0)) + baseHeight(p + vec2f(3.0, 0.0))
                       + baseHeight(p - vec2f(0.0, 3.0)) + baseHeight(p + vec2f(0.0, 3.0)));
    out.top = clamp((h - around) / 1.5, -1.0, 1.0);
    out.convexity = convexity;   // a surface layer's fact
    return out;
}

// A coherent value for a surface layer's patches (surfacePattern): a uniform that mixes patches of `scale` px with per-pixel noise
// (COVER_PATCHINESS), repeating with the ground's pool. Patchiness is a constant: 0 to 1 moved under 4% of the blocks (card P30).
const COVER_PATCHINESS = 0.8;
fn coverZ(p: vec2f, scale: f32) -> f32 {
    let zp = (poolNoise(p, scale, 17.0) + 0.5 * poolNoise(p, 0.45 * scale, 31.0) + 0.25 * poolNoise(p, 0.2 * scale, 47.0)) / 0.46;
    let c = poolPixel(p);
    let pixel = (cellHash(c).x + cellHash(c + 7.3).x + cellHash(c + 19.1).y - 1.5) * 2.0;
    return sqrt(COVER_PATCHINESS) * zp + sqrt(1.0 - COVER_PATCHINESS) * pixel;
}
// The world's surface layers (docs/SURFACE_LAYERS.md): an ordered list, each laid over what is below. A layer draws one of the draw's own
// surfaces (a built-in: its color and share are the draw's) or a material of the map (bound to the layer by the material's worldLayer); a
// rule over the site's facts may limit where it shows. Rows (sculpt-material-model.js surfaceRows), from row 0, sorted by stage:
//   0 (built-in slot in its stage, or -1 a material layer; Amount; material slot or -1; rule rows), 1 (edge width, noise, noise size, salt),
//   then with a rule: (kind 1 windows, 2 score; score from; score half width; height contrast), and its terms: windows (fact, from, to, fade), all of which
//   must hold, or score terms (fact, weight, 0, 0), summed with the edge's noise and passed through one smoothstep.
// SURFACE_HEAD's four rows hold the eight stages' (first row, layer count) pairs; row SURFACE_FLAGS x is 1 when a layer reads facts or draws a
// material. A stage runs where the draw made its surfaces before (the effects between stages read the color below, so a layer stays in its
// stage); the caller fills `src` and `mask` by built-in slot. A built-in's share is its mask times Amount (times its rule); a material layer's
// is Amount times its rule. Coverage: with an edge of width under 1 or noise, clamp((share + noise - .5) / width + .5); a score's coverage is
// its smoothstep. Noise is Noise times an even value from -.5 to .5, by the art pixel at a size of 1 or less and in patches of that size above
// (the cover classes' pick), both repeating with the ground's pool. Width 1 and no noise lay the share itself, as the draw always has.
var<private> surfaceFacts: array<f32, 14>;
var<private> surfacePreviewCover: f32 = 0.0;   // the previewed layer's coverage (diagnostic view 13)
var<private> surfacePreviewSeen: f32 = -1.0;   // what of it the layers after it leave showing (-1 until it is drawn)
// The inspector's pixel (GeometryFrame.probe): this invocation draws it, and how many layers it has recorded (probeOut).
var<private> probeHere: bool = false;
// A braided river's bed over the sand (its gravel, and how much of it): the sand and sand dust layers draw their material under it.
var<private> riverBedOver: vec4f = vec4f(0.0);
var<private> probeCount: u32 = 0u;
// A layer's pattern, about evenly spread over 0 to 1: by the art pixel at Noise size 1, else smooth patches that size. Its edge noise and its
// coverage read the same pattern, so the pixels a ragged edge reaches first are the ones a partial Amount keeps.
fn surfacePattern(e: vec4f, p: vec2f, pixel: vec2f) -> f32 {
    return select(1.0 / (1.0 + exp(-1.702 * coverZ(p, max(e.z, 2.0)))), shelfHash(poolPixel(grainPixel(pixel)) + e.w), e.z <= 1.0);
}
fn surfaceNoise(e: vec4f, p: vec2f, pixel: vec2f) -> f32 {
    if (e.y == 0.0) { return 0.0; }
    return e.y * (surfacePattern(e, p, pixel) - 0.5);
}
fn surfaceEdge(share: f32, e: vec4f, p: vec2f, pixel: vec2f) -> f32 {
    if (e.x >= 1.0 && e.y == 0.0) { return share; }
    return clamp((share + surfaceNoise(e, p, pixel) - 0.5) / max(e.x, 0.001) + 0.5, 0.0, 1.0);
}
// The stage's layers over `color` in place; `cover` gets each built-in slot's coverage (a union where several layers draw one slot), and
// `over` the share material layers cover (they lie over what is below, so the built-ins' coverage under them shrinks).
fn surfaceStage(stage: u32, color: ptr<function, vec3f>, src: ptr<function, array<vec3f, 7>>, mask: ptr<function, array<f32, 7>>, cover: ptr<function, array<f32, 7>>, over: ptr<function, f32>, p: vec2f, pixel: vec2f) {
    let head = u.materialTable[SURFACE_HEAD + stage / 2u];
    let odd = (stage & 1u) == 1u;
    var row = u32(select(head.x, head.z, odd));
    let count = u32(select(head.y, head.w, odd));
    *cover = array<f32, 7>();
    *over = 0.0;
    for (var i = 0u; i < count; i++) {
        let layerRow = row;
        let r0 = u.materialTable[row];
        let e = u.materialTable[row + 1u];
        let ruleAt = row + 2u;
        let rules = u32(r0.w);
        row += 2u + rules;
        let builtin = r0.x >= 0.0;
        if (r0.z < -1.5) { continue; }   // a layer that draws a material the map lacks (-2: a material layer, or an engine surface) draws nothing, nor does a plants-only layer (-3)
        let k = min(u32(max(r0.x, 0.0)), 6u);
        // Amount is coverage: the share of the layer's area it covers, each covered pixel at full strength (TA's look), not an opacity.
        let amount = r0.y;
        if (amount == 0.0) { continue; }
        var share = select(1.0, (*mask)[k], builtin);
        if (share == 0.0) { continue; }   // only an exact 0: some draw shares run a little outside 0 to 1, and the mix keeps them as it always has
        var c = 0.0;
        var lift = 0.0;
        if (rules == 0u) { c = surfaceEdge(share, e, p, pixel); }
        else {
            let rule = u.materialTable[ruleAt];
            // Height contrast (the rule head's w): the layer's material against the ground below, art height in units of 4, so the taller
            // wins where the layer meets what it covers. Windows feel it only inside their edge (4 share (1 - share)); a score at its threshold;
            // a partial Amount where its coverage pattern decides.
            if (rule.w > 0.0 && r0.z >= 0.0) { lift = rule.w * 0.25 * (materialRelief(p, u32(r0.z)) - ownGroundRelief(p, gs)); }
            if (rule.x < 1.5) {
                share = surfaceWindows(ruleAt, rules, surfaceFacts, share);
                if (share == 0.0) { continue; }
                if (lift != 0.0) { share = clamp(share + lift * 4.0 * share * (1.0 - share), 0.0, 1.0); }
                c = surfaceEdge(share, e, p, pixel);
            } else {
                let score = surfaceScore(ruleAt, rules, surfaceFacts, surfaceNoise(e, p, pixel) + lift);
                c = share * smoothstep(rule.y - rule.z, rule.y + rule.z, score);
                if (c == 0.0) { continue; }
            }
        }
        if (amount < 1.0) { c *= step(1.0 - amount, surfacePattern(e, p, pixel) + lift); if (c == 0.0) { continue; } }
#ifdef COLOR_PASS
        if (probeHere && probeCount < 32u) { probeOut[PROBE_LAYERS + probeCount * 2u] = f32(layerRow); probeOut[PROBE_LAYERS + 1u + probeCount * 2u] = c; probeCount++; }
#endif
        if (surfacePreviewSeen >= 0.0) { surfacePreviewSeen *= 1.0 - c; }   // a later layer lies over the previewed one
        if (i32(layerRow) == u.surfacePreview) { surfacePreviewCover = c; surfacePreviewSeen = c; }
        if (builtin) {
            // A built-in that draws a material (docs/SURFACE_LAYERS.md phase 4) lays that material's color by its own share.
            var source = (*src)[k];
            if (r0.z >= 0.0) { source = groundPigment(p, u32(r0.z), surfaceFacts[3], surfaceFacts[4]); }
            if (stage == 5u && k >= 5u) { source = mix(source, riverBedOver.rgb, riverBedOver.a); }   // sand dust and sand: a braided river's gravel
            *color = mix(*color, source, c);
            (*cover)[k] = select(1.0 - (1.0 - (*cover)[k]) * (1.0 - c), c, (*cover)[k] == 0.0);   // layers of one slot join as a union
        } else {
            *color = mix(*color, groundPigment(p, u32(r0.z), surfaceFacts[3], surfaceFacts[4]), c);
            for (var j = 0u; j < 7u; j++) { (*cover)[j] *= 1.0 - c; }
            *over = 1.0 - (1.0 - *over) * (1.0 - c);
        }
    }
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
// With wrap above 0 the cells are hashed by their coordinate modulo wrap (card tilepool: a lattice that repeats with the pool).
struct MarkCells { id: vec4f, id2: vec4f, home: vec2i, off: vec2f, d1: f32, d2: f32 }
fn markCells(q: vec2f, salt: vec2i, jit: f32, wrap: f32) -> MarkCells {
    let cell = vec2i(floor(q));
    let at = fract(q);
    var m = MarkCells(vec4f(0.0), vec4f(0.0), cell, vec2f(0.0), 8.0, 8.0);
    for (var j = -1; j <= 1; j++) {
        for (var i = -1; i <= 1; i++) {
            let h = markHash(select(cell + vec2i(i, j), vec2i(poolWrap(vec2f(cell + vec2i(i, j)), wrap)), wrap > 0.0) + salt);
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
// Round 3 (Moon): the same cups drawn out into strokes. Retail's dark faces carry strokes 1-2 px wide and 5-12 px long where ours
// are dotted pits: each cup's length grows by stretch (and by up to .3 either way per cup) and its width shrinks by the root of
// it, and its long axis turns up to 20 degrees either way from the glint axis per cup. The axis stays the glint axis's, not the
// fall line's: retail moon-1's pits lean with it on the walls of both facings (the G8 measure), and strokes down the fall line
// lay across a wall that faces east or west. The lattice is the cups', so the strokes keep their spacing, and the neighbours two
// cells out are read, as a stroke reaches past the next cell.
fn cupStrokes(pixel: vec2f, size: f32, density: f32, depth: f32, stretch: f32) -> vec3f {
    let q = vec2f(dot(pixel, SHINE_ACROSS) / size, dot(pixel, SHINE_ALONG) / (size * 1.5));
    let c = vec2i(floor(q));
    var grad = vec2f(0.0);
    var cavity = 0.0;
    for (var j = -2; j <= 2; j++) {
        for (var i = -2; i <= 2; i++) {
            let k = c + vec2i(i, j);
            let r = markHash(k + vec2i(4001, 17));
            if (r.x >= density) { continue; }
            let centre = vec2f(k) + 0.15 + 0.7 * r.yz;
            let off = (q.x - centre.x) * size * SHINE_ACROSS + (q.y - centre.y) * size * 1.5 * SHINE_ALONG;
            let turn = (fract(r.w * 13.7) - 0.5) * 0.7;
            let along = cos(turn) * SHINE_ALONG + sin(turn) * SHINE_ACROSS;
            let across = vec2f(-along.y, along.x);
            let ax = mix(1.3, 2.0, r.w) / sqrt(stretch);
            let ay = mix(2.8, 4.2, fract(r.w * 7.3)) * stretch * mix(0.7, 1.3, fract(r.w * 3.1));
            let d = vec2f(dot(off, across) / ax, dot(off, along) / ay);
            let s = dot(d, d);
            if (s >= 2.6) { continue; }
            let x = clamp((s - 1.6) / 1.0, 0.0, 1.0);
            let w = 1.0 - x * x * (3.0 - 2.0 * x);
            let dw = -6.0 * x * (1.0 - x);
            let slope = exp(-s) * ((2.0 - s) * w + (s - 1.0) * dw);
            grad += depth * slope * 2.0 * (d.x * across / ax + d.y * along / ay);
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
    let m = markCells(pixel / 36.0, vec2i(17, 53), 0.7, 0.0);
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
    let m = markCells(pixel / 44.0, vec2i(83, 29), 0.7, 0.0);
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
fn beachColour(pixel: vec2f) -> vec3f { return roleColor(u.beachGround, u.slopeGround, pixel); }
fn beachMean() -> vec3f { return roleMean(u.beachGround, u.slopeGround); }
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
    let raw = sampleMasks(maskPoint(p),0);
    return paintEdge(p, raw, slope, hollow);
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
    let big = markCells(p / (size * 2.2), vec2i(7919, 0), 0.9, 0.0);
    var c = markCells(p / size, vec2i(0), 0.9, 0.0);
    var px = size;
    if (big.id.y < 0.4) { c = big; px = size * 2.2; }
    let seam = 1.0 - smoothstep(0.3, 1.2, (c.d2 - c.d1) * 0.5 * px);
    let lean = dot(c.off, normalize(c.id.zw - 0.5 + vec2f(0.001))) * 0.5;
    let shade = 1.0 + 0.3 * (c.id.x - 0.5) + 0.35 * lean;
    // Only a fringe round the slabs: the open sea beyond reach of the slab marks (eight taps 48 px out) stays smooth, as retail's does.
    var near = smoothstep(0.05, 0.3, slab);
    for (var k = 0; k < 8; k++) { near = max(near, smoothstep(0.05, 0.3, crystalField(p + vec2f(cos(f32(k) * 0.785398), sin(f32(k) * 0.785398)) * 48.0))); }
    // Mosaic in all shallows: a submerged reef with no slabs of its own takes the mosaic too.
    near = max(near, u.crystalShallowAll);
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
    let m = markCells((p + warp) / size, vec2i(0), 0.9, 0.0);
    let edge = (m.d2 - m.d1) * 0.5 * size;
    let w = fract((m.id.z + m.id2.z) * 7.31);
    let drawn = smoothstep(u.crystalCraterGap, u.crystalCraterGap + 0.08, w);
    let width = 0.6 + 1.0 * fract(w * 3.7 + 0.2);
    let line = (1.0 - smoothstep(width * 0.5, width * 0.5 + 0.6, edge)) * drawn;
    return vec2f(line, 1.0 + u.crystalCraterTone * (m.id.x - 0.5));
}

// Round 3 (Crystal): long dark gouges across raised crystal. Retail's crystal mounds are crossed by a bold black web over their
// facets, lines 2-4 px wide that run on from seam to seam round cells 30-60 px across, wandering, a few seams left out, where ours
// are only the facets' thin outlines (crystal-1: thin dark line density .0086 against ours .0054). Voronoi seams of GOUGE_PX
// cells, the lookup bent by the world noise as the crater web's is, each seam one width and drawn or not; returns 0..1.
const GOUGE_PX = 42.0;
fn gougeWeb(p: vec2f) -> f32 {
    let warp = (terrainNoise(p * 0.12).rg - 0.5) * 14.0 + (terrainNoise(p * 0.5).ba - 0.5) * 4.0;
    let m = markCells((p + warp) / GOUGE_PX, vec2i(61, 7), 0.9, 0.0);
    let edge = (m.d2 - m.d1) * 0.5 * GOUGE_PX;
    let w = fract((m.id.z + m.id2.z) * 5.17);
    let drawn = smoothstep(0.2, 0.28, w);
    let width = 1.4 + 2.0 * fract(w * 3.7 + 0.2);
    return (1.0 - smoothstep(width * 0.5, width * 0.5 + 0.7, edge)) * drawn;
}

// H23: how much of the sun-facing crack wall's light the rock takes, the same on every world.
const CRACK_LIT = 0.35;

// Per-material dielectric reflection over a micro-roughened surface normal.
// GGX reflection is combined with the artistic diffuse light in linear RGB,
// then passes through the highlight cap and TA palette mapping.
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
fn surfaceLinear(c:vec3f)->vec3f{return select(c/12.92,pow((max(c,vec3f(0))+.055)/1.055,vec3f(2.4)),c>vec3f(.04045));}
fn surfaceSRGB(c:vec3f)->vec3f{return select(c*12.92,1.055*pow(max(c,vec3f(0)),vec3f(1.0/2.4))-.055,c>vec3f(.0031308));}
fn surfaceFresnel(f0:f32,cosine:f32)->f32{return f0+(1.0-f0)*pow(1.0-clamp(cosine,0.0,1.0),5.0);}
// Preserve the chosen rock/bed palette beneath alteration. Fresh cuts expose
// mineral grain; the surviving rind can be dark, bleached, or oxide stained.
fn rockSkinColor(color:vec3f,grain:vec3f,skin:vec2f)->vec3f {
    if(max(skin.x,skin.y)<=0.0){return color;}
    let fresh=color*(vec3f(1)+skin.x*(vec3f(.32)+(grain-1.0)*.65));
    let crust=color*exp2(u.rock[rs & rockMask].faceRindTone*1.6)*mix(vec3f(1),vec3f(1.3,.82,.49),u.rock[rs & rockMask].faceRindWarmth);
    return saturate(mix(fresh,crust,skin.y));
}
fn shineTerm(pixel: vec2f, p: vec2f, g: vec2f, normal: vec3f, material: vec3f, exposed: f32,
             slopeCover: f32, crystalMask: f32, sunSeen: f32, landform: f32, damp: f32, mineralPatch: f32, skin:vec2f) -> vec4f {
    var sand = smoothstep(0.35, 0.95, bakedFields(p).a);
    if (u.beach != 0) { sand = max(sand, beachSand(p, 0.5)); }   // beach sand is lit as sand
    // Crystal tops only: the risers between columns stay dark and take the
    // surrounding material's lobe (the world's own note: faces are dark at every facing).
    let crystal = smoothstep(0.05, 0.3, crystalMask) * (1.0 - smoothstep(1.2, 2.5, length(g)));
    let rock = clamp(exposed, 0.0, 1.0) * (1.0 - sand);
    let slope = clamp(slopeCover, 0.0, 1.0) * clamp(1.0 - sand - rock, 0.0, 1.0);
    let ground = max(1.0 - sand - rock - slope, 0.0);
    let rest = 1.0 - crystal;
    var weight = array<f32, 5>(ground * rest, slope * rest, rock * rest, sand * rest, crystal);
    var gloss = 0.0;
    var focus = 0.0;
    var rough = 0.0;
    var scale = 0.0;
    for (var i = 0; i < 5; i++) {
        var m = select(u.shine[i], u.rock[rs & rockMask].shineRock, i == 2);
        if(i==0){m.x=max(m.x,materialShine(p,gs));m.y=select(m.y,16.0,m.y<=0.0);}   // a material's own shine adds to the world's ground row
        if(i==2){let rm=rockMaterialOf(rs);if(rm>=0){m.x=max(m.x,materialShine(grainPixel(pixel),u32(rm)));}}   // and the rock material's to the rock's (read at the native pixel, as its grain)
        gloss += weight[i] * m.x;
        focus += weight[i] * m.x * m.y;
        rough += weight[i] * m.z;
        scale += weight[i] * m.z * m.w;
    }
    rough *= 1.0-mineralPatch*rock*.45;
    focus *= 1.0+max(0.0,mineralPatch)*rock*1.6;
    // Sharpness follows the gloss that uses it, grain scale the roughness.
    focus = max(focus / max(gloss, 1e-4), 1.0);
    scale = max(scale / max(rough, 1e-4), 1.0);
    // Crust finish is independent of the fresh interior's existing rock gloss.
    // Wet films smooth its extra grain; the GGX water response below still wins.
    let rind=skin.y*rock;
    focus*=mix(1.0,mix(3.5,.12,u.rock[rs & rockMask].faceRindRough),rind)*(1.0+skin.x*rock*.8);
    rough=mix(rough,rough*.3+.35*u.rock[rs & rockMask].faceRindRough*(1.0-damp*.85),rind);
    scale=mix(scale,1.3,rind);   // the crust's sheen breaks at grit scale
    // Card E6: the sheen and its grain only sit on raised ground and slopes (Moon's plain keeps its own
    // grain); shineGate 0 is every world's earlier shine.
    let reach = mix(1.0, landform, u.shineGate);
    rough *= reach;
    gloss *= reach;
    let q=vec2f(dot(pixel,SHINE_ACROSS)/scale,dot(pixel,SHINE_ALONG)/(scale*max(u.shineStretch,1.0)));
    var grain=shineNoise(q)*rough;
    let axis=select(vec3f(0,0,1),vec3f(1,0,0),abs(normal.z)>.9);
    let tangent=normalize(cross(normal,axis));let bitangent=cross(normal,tangent);
    let grained=normalize(normal+tangent*grain.x+bitangent*grain.y);
    let litBefore=max(0.0,dot(normal,u.light));let nl=max(0.0,dot(grained,u.light));
    let lit=clamp((u.ambient+.95*nl)/(u.ambient+.95*litBefore),.5,1.6);
    // GGX / correlated Smith / Schlick. Sharpness is the artist's polish
    // control; micro-roughness adds grain without changing the actual solid.
    let perceptual=mix(pow(2.0/(focus+2.0),.25),.12,damp*.94);
    let alpha=max(.015,perceptual*perceptual);let a2=alpha*alpha;
    let halfway=normalize(u.light+SHINE_VIEW);let nv=max(.001,dot(grained,SHINE_VIEW));let nh=max(0.0,dot(grained,halfway));
    let denominator=nh*nh*(a2-1.0)+1.0;let distribution=a2/(3.14159265*denominator*denominator);
    let visibility=.5/max(nl*sqrt(nv*nv*(1.0-a2)+a2)+nv*sqrt(nl*nl*(1.0-a2)+a2),.00001);
    let f0=mix(.16*gloss*gloss,.0204,damp);
    let strength=max(clamp(gloss*4.0,0.0,1.0),damp);
    let fresnel=surfaceFresnel(f0,dot(SHINE_VIEW,halfway))*strength;
    let top=max(material.r,max(material.g,material.b));let body=smoothstep(.04,.22,top);
    let tint=surfaceLinear(mix(material/max(top,.05),vec3f(1),u.shineWhite));
    let reflected=reflect(-SHINE_VIEW,grained);
    let sky=mix(vec3f(.06,.05,.04),vec3f(.25,.28,.31),smoothstep(-.2,.8,reflected.z))*surfaceLinear(u.skyColor);
    let glint=(distribution*visibility*fresnel*nl*sunSeen*2.67*surfaceLinear(u.sunColor)+sky*surfaceFresnel(f0,nv)*strength*(1.0-.55*perceptual))*tint*body;
    let headroom=1.0-u.shineHeadroom*clamp(gloss,0.0,1.0)*(1.0-clamp(distribution*nl,0.0,1.0))*body;
    return vec4f(glint,lit*headroom*(1.0-fresnel));
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
// Cracked bed: 1 on the seams between dried-mud polygons about bedCrackSize px wide (a jittered cell grid, its outline bent by smooth
// noise so no rows show), falling to 0 a pixel away.
fn bedCrackLine(p: vec2f) -> f32 {
    let S = max(u.bedCrackSize, 8.0);
    let q = p / S + (vec2f(shelfNoise(p / 23.0 + 3.1), shelfNoise(p / 23.0 + 17.7)) - 0.5) * 0.35;
    let c = floor(q);
    var d1 = 9.0; var d2 = 9.0;
    for (var j = -1; j <= 1; j++) { for (var i = -1; i <= 1; i++) {
        let g = c + vec2f(f32(i), f32(j));
        let d = length(q - g - (vec2f(shelfHash(g + 0.37), shelfHash(g + 91.3)) * 0.85 + 0.075));
        if (d < d1) { d2 = d1; d1 = d; } else if (d < d2) { d2 = d; }
    } }
    let w = 1.0 / S;
    return 1.0 - smoothstep(w, 2.2 * w, d2 - d1);
}
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
fn sharpDeepStep(p: vec2f, pixel: vec2f, depthIn: f32) -> f32 {
    let at = 0.5 * (u.shallowDepth + u.deepDepth);
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
// Time pass's source falls off about exponentially from the hill, so lines at equal
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

// Shallow water as the bed under it (card E1): the ground colour already lit at
// this pixel, moved toward the water's own hue. The tint keeps the bed's light
// (its brightness against flat ground), so lumps, shade and grain carry through;
// bedTint is how much of the bed's own colour the tint replaces.
fn litBed(bed: vec3f, rockShare: f32, rockLevel: f32) -> vec3f {
    const luma = vec3f(0.299, 0.587, 0.114);
    // The light is the bed's brightness against its own material's: the level ground's mean for the soft bed, the rock's own colour
    // (rockLevel) for rock, so a rock darker than the ground does not count as shade and a submerged platform is as pale as the shelf
    // round it, with its joints.
    let level = max(mix(dot(groundMean(), luma), rockLevel, rockShare), 0.02);
    // Shade stays paler under water than on land (retail's shaded bank beds show
    // as soft darker blue, never as black rims), so the dark side carries less,
    // on rock as on soft ground. The artist's contrast control applies to all beds.
    let ratio = clamp(dot(bed, luma) / level, 0.25, 2.0);
    let contrast = u.bedContrast;
    let light = pow(ratio, select(contrast * 0.6, contrast, ratio >= 1.0));
    let tint = select(u.shallowMean,u.shallowBase.rgb,u.shallowBase.a>.5) * light * u.bedBright;
    return saturate(mix(bed, tint, u.bedTint));
}
// Ice frost band (card E5): the frost stroke marks every cell of its band with a
// little protection, and where frostWet is 1 those cells keep the white of the
// level snow instead of the grey the wet band gives the bank near the sea.
fn frostDry(near: f32, route: f32) -> f32 { return near * (1.0 - u.frostWet * smoothstep(0.02, 0.04, route)); }

// ---- The mineral margins and the sediment transition ----
// Nearby fractured slopes feed outcrops into their level crown and foot (the mineral margins); a table with a fringe, a ring or a body
// layer adds the fringe, the ring veins and the sediment transition. Each block is gated by a uniform, never by a world. The materials
// it reads are the map's in their roles (roleColor): the slope cover, the margin fringe, ring and body.
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
    let fringe = roleColor(u.fringeGround, u.slopeGround, pixel);
    *slopeGrass = mix(fringe, *slopeGrass, smoothstep(0.42, 0.88, cover));
    // Native fissures reach farther than their brighter mineral fill. Fade through that structure instead of blurring two full images.
    let stone = dot(*slopeGrass, vec3f(0.299, 0.587, 0.114));
    let edge = (0.26 - stone) * 0.9 + (n.b - 0.5) * 0.12;
    *slopeCover = smoothstep(0.04, 0.96, cover + edge * 4.0 * cover * (1.0 - cover)) * smoothstep(u.slopeProfile.z, u.slopeProfile.w, baseHeight(p));
    if (u.groundFringe == 0) { return; }
    // This fringe already contains native ground plus thin vein tails. Preserve its pixels before the darker face arrives.
    let face = slopeGrassSource(pixel);
    let detail = (0.35 - dot(face, vec3f(0.299, 0.587, 0.114))) * 0.12;
    *slopeGrass = mix(fringe, face, smoothstep(0.20, 0.78, cover + detail));
    if (u.ringAmount > 0.0) {
        // A connected native vein material occupies its own irregular zone before the brown core.
        let zone = cover + ((n.r - 0.5) * 0.38 + (n.g - 0.5) * 0.22) * u.ringVariation * smoothstep(0.0, 0.12, cover);
        let spread = mix(0.60, 1.80, u.ringSpread);
        let ring = roleColor(u.ringGround, u.slopeGround, pixel);
        let vein = smoothstep(u.fringeRange.x, u.fringeRange.y, dot(ring, u.fringeSignal.rgb) + u.fringeSignal.a);
        let tail = smoothstep(0.005, 0.19, max(0.0, zone));
        let ringMask = smoothstep(0.06, 0.42, zone * spread + vein * 0.15) * tail * mix(0.30, 1.0, max(vein, smoothstep(0.16, 0.40, zone)));
        var margin = mix(grass, fringe, tail * mix(0.25, 1.0, vein));
        margin = mix(margin, ring, ringMask * u.ringAmount);
        *slopeGrass = mix(margin, face, smoothstep(0.22, 0.96, zone + detail));
    }
    *slopeCover = smoothstep(0.01, 0.28, cover) * smoothstep(u.slopeProfile.z, u.slopeProfile.w, baseHeight(p));
    if (materialWeather > 0.0 && u.transitionBody != 0) {
        // The worker's spatially softened source measures a join across world pixels; all three materials use that coordinate.
        var source = sediments.b;
        let variation = ((n.r - 0.5) * 0.08 + (n.g - 0.5) * 0.04) * fringeVariation;
        source = clamp(source + variation * 4.0 * source * (1.0 - source), 0.0, 1.0);
        let ring = roleColor(u.ringGround, u.slopeGround, pixel);
        let body = roleColor(u.bodyGround, u.slopeGround, pixel);
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
            let groundLow = groundMean();
            let ringLow = roleMean(u.ringGround, u.slopeGround);   // the materials' broad colors (their caches keep no coarse levels)
            let bodyLow = roleMean(u.bodyGround, u.slopeGround);
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
        let ring = roleColor(u.ringGround, u.slopeGround, pixel);
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
        let faceLow = slopeTexMean();
        let rockLow = rockMaterialMean(rs);   // the rock material's broad color (its cache keeps no coarse levels)
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
    let xc = surfCuspX(x, q, e);
    let ramp = clamp((end - xc) / width, 0.0, 1.0);
    // At a little Surf the sand is a narrow strip, mostly continuous along the water (with breaks about every 25 px), that breaks landward into patches and then flecks of
    // varied size: sparseness grows with the distance from the water (the strip's width, then 28 px of thinning), and the patch noise (21 and 8.5 px) is weighted by how little
    // Surf there is. From Surf .6 (amt 1) none of this applies: the sand is the full beach.
    let amt = surfSandAmt(e);
    let strip = 3.0 + 12.0 * amt;
    let far = smoothstep(strip, strip + 28.0, xc);
    let patchy = 0.5 + 0.5 * (0.6 * valueNoise(p / 21.0 + vec2f(12.3, 4.1)) + 0.4 * valueNoise(p / 8.5 + vec2f(2.9, 15.7)));
    let scatter = mix(1.0, amt * (0.25 + 1.6 * patchy), (1.0 - amt) * far);
    let gate = mix(1.0, smoothstep(-0.75, -0.3, valueNoise(q / 23.0 + vec2f(4.2, 9.9))), 1.0 - amt);
    return clamp(ramp * scatter * gate, 0.0, 1.0) * step(0.0, x) * smoothstep(0.0, 0.2, amt);
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
// A rock slot's surface material (its own, else the world's rock material), -1 none; and that material's mean color (the old fixed mean without one).
// The rock's grain at a native pixel: its material's unlit color over the material's mean (1 where the rock has no material).
fn rockGrain(slot: u32, pixel: vec2f) -> vec3f {
    let m = rockMaterialOf(slot); if (m < 0) { return vec3f(1.0); }
    // Mostly its brightness: the rock type keeps the hue (a palette ramp), the material's own hue shows at a third.
    let ratio = materialRawAt(grainPixel(pixel), u.ground[u32(m) & groundMask].cacheLayer) / max(materialMean(u32(m)), vec3f(0.01));
    let luma = dot(ratio * materialMean(u32(m)), vec3f(0.299, 0.587, 0.114)) / max(dot(materialMean(u32(m)), vec3f(0.299, 0.587, 0.114)), 0.01);
    return clamp(mix(vec3f(luma), ratio, 0.33), vec3f(0.5), vec3f(1.6));
}
// A rock slot's colour as the draw lays it flat (rockFlat): its material's mean, so the material's Color is the rock's.
fn slotRock(slot: u32) -> vec3f { return rockMaterialMean(slot); }
// B4: a rock's thickness along the sun's line through a point of its surface, height units. From just inside the surface, away from the sun
// on a lit face (the rock behind what the sun lights) and toward it on a shaded face (the rock the sun's light crosses to get there), the
// length of that line lying under the heights and 3 units over the plain over 24 steps of 1.5 (36 at most: thick). Over the plain: the ground
// a stroke claims round its foot is the plain (its undulation a unit or two), not a body of its rock. It reads the heights as visibility() does, so a tile gives the same
// answer as any other; the voxel relief's few units are not in it.
fn sunChord(p: vec3f, n: vec3f) -> f32 {
    let dir = select(-u.light, u.light, dot(n, u.light) < 0.0);
    let start = p - n * 0.75;
    var inside = 0.0;
    for (var i = 1; i <= 24; i++) { let q = start + dir * (f32(i) * 1.5); inside += select(0.0, 1.5, q.z < baseHeight(q.xy) && q.z > u.base + 3.0); }
    return inside;
}
// B4: the filter a rock of `slot` puts on what it shows at thickness t: toward the hue of its absorption colour at full strength (row 6;
// unchosen, its own colour's), 1 - e^(-k t / 16) of the way for Color deepens with thickness k (a 36-unit body .89 of the way at 1, .43 at .25),
// so thin edges keep their colour and thick rock goes deep and saturated: the colour's strongest channel passes, the others are taken.
// A filter, so it deepens any surface the rock claims (its faces, crystal faces, ice cover) whatever drew it.
fn absorbFilter(slot: u32, t: f32) -> vec3f {
    let row = u.rock[slot & rockMask].rockColors[6];
    let own = slotRock(slot);
    let a = select(own, row.rgb, row.a > 0.5);
    let toward = a / max(max(a.r, max(a.g, a.b)), 0.02);
    return mix(vec3f(1.0), toward, 1.0 - exp(-u.rock[slot & rockMask].absorbDepth * t / 16.0));
}
// Weathered rock and its grains: a biome's sand, from the rock's own mean and the world's Sand row and colour. The deposits and the surf's beach draw it.
fn sandWeathered() -> vec3f {
    let rockAverage = rockMaterialMean(0u);   // the world's rock (slot 0): a world's sand
    let weathered = mix(vec3f(mix(rockAverage, vec3f(dot(rockAverage, vec3f(0.299, 0.587, 0.114))), 0.25)), vec3f(1.0), u.sandLight * 0.55);
    return weathered;
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
// Where a cliff's debris lies, to the eye, and how much of it the ground has taken back. Debris used to fade into the ground as an even
// haze, its edge a contour of the deposit's thickness (rock weather keeps that in 4 px cells). Two things break the contour up, both per pixel.
// debrisLie moves the point the deposit is read at: by stretch of the apron (up to 14 px over tens of px: tongues run out and bays cut in), by
// clump (up to 6 px: patches of gravel lie loose past the edge, clumps of the ground stand inside it) and by a pixel or two. The stones and
// the debris's relief stay where rock weather put them; only what colors the ground moves.
fn debrisLie(p: vec2f) -> vec2f {
    let far = vec2f(valueNoise(p / 47.0 + vec2f(7.0, 61.0)), valueNoise(p / 47.0 + vec2f(83.0, 19.0))) * 14.0;
    let near = vec2f(valueNoise(p / 9.0 + vec2f(29.0, 3.0)), valueNoise(p / 9.0 + vec2f(5.0, 71.0))) * 6.0;
    let speck = (terrainNoise(p * 5.0 + vec2f(13.0, 47.0)).rg - 0.5) * 4.0;
    return p + far + near + speck;
}
// debrisRegrown is the share of the debris the ground has taken back (x), and how much of that is moss (y). The ground grows back where the
// debris is thinner than the growth needs it to be. The need differs by stretch of the apron (some of it old and overgrown, some fresh and
// bare to its edge), by clump (5 to 11 px tussocks) and by tuft (single pixels), and it is higher where runoff leaves the debris damp (wet:
// rock weather's runoff there), so growth follows the water down from a face. Vegetation scales it: a lusher place takes more back. The need
// spreads over 0 to 1, so at the default vegetation debris keeps most of the cover its thickness gave it as a haze, in patches (measured on
// a granite mesa: 11.5% of the picture as haze, 9.2% now). Damp regrowth is part moss (2 to 3% of that picture), the rest the ground's own cover.
fn debrisRegrown(deposit: f32, p: vec2f, wet: f32, vegetation: f32) -> vec2f {
    let stretch = 0.5 + 0.5 * (0.6 * valueNoise(p / 83.0 + vec2f(7.0, 61.0)) + 0.4 * valueNoise(p / 31.0 + vec2f(43.0, 5.0)));
    let clump = 0.5 + 0.5 * (0.55 * valueNoise(p / 11.0 + vec2f(29.0, 3.0)) + 0.45 * valueNoise(p / 4.7 + vec2f(61.0, 17.0)));
    let tuft = terrainNoise(p * 5.0 + vec2f(13.0, 47.0)).r;
    let lush = clamp(vegetation, 0.0, 2.0);
    let need = clamp(((0.45 * stretch + 0.35 * clump + 0.2 * tuft) - 0.5) * 2.2 + 0.5, 0.03, 1.0) * lush + 0.45 * wet * min(lush, 1.0);
    let grown = 1.0 - smoothstep(need - 0.06, need + 0.06, deposit * 0.9);
    return vec2f(grown, grown * smoothstep(0.25, 0.7, wet) * min(lush, 1.0) * smoothstep(0.02, 0.1, deposit));
}

// Full-precision current-tile geometry. Scalar fields keep the stride at 56
// bytes; the one-pixel apron supplies the color pass's derivative helpers.
struct SurfaceRecord {
    y:f32,z:f32,nx:f32,ny:f32,nz:f32,rain:f32,sun:f32,sky:f32,
    cavity:f32,gx:f32,gy:f32,faceSlope:f32,ao:f32,shadow:f32,
}
// probe: the art pixel the Surface section's inspector asks about, plus one (0: none); the color pass writes what it drew there (probeOut).
struct GeometryFrame {width:u32,height:u32,probe:vec2u}
@group(3) @binding(1) var<uniform> geometryFrame:GeometryFrame;
fn geometryIndex(p:vec2i)->u32 {
    let q=clamp(p,vec2i(0),vec2i(i32(geometryFrame.width),i32(geometryFrame.height))-1);
    return u32(q.y)*geometryFrame.width+u32(q.x);
}
#ifdef GEOMETRY_PASS
@group(3) @binding(0) var<storage,read_write> geometryOut:array<SurfaceRecord>;
@fragment
fn geometryMain(v:VertexOut)->@location(0) vec4f {
    if(vCount[2]>vs.capacity){discard;}
    let pixel=v.position.xy-vec2f(1);
    let fragCoord=vec2f(pixel.x*u.chunkScale+u.chunkScreenOrigin.x,u.size-(pixel.y*u.chunkScale+u.chunkScreenOrigin.y));
    let hit=voxelHit(vec2f(fragCoord.x,u.size-fragCoord.y));
    let p=round(hit.xy*64.0)/64.0;useRock(p);let normal=voxelNormal(hit);
    let authored=voxelAuthored(p);let soft=-authored.yz/max(authored.w,.015);
    var lit=normal;var sun=voxelShadow(hit,normal);var cavity=voxelCavity(hit,normal);
    // Rock finer than the solid's voxels (rockDetail, a height outward), read as a 1 px solid's normal reads its field: it bends the normal the light reads,
    // deepens the cavity where it hollows (voxelCavity's first ring: its weight and its reach) and casts its own short shadow.
    let site=rockSite(hit);
    if(site.on){
        let ax=select(vec3f(0,0,1),vec3f(1,0,0),abs(normal.z)>.9);let t=normalize(cross(normal,ax));let b=cross(normal,t);
        let e=.75*max(u.chunkScale,1.0);   // voxelGradient's spacing in a 1 px solid
        let d0=rockDetail(hit,site);let d1=rockDetail(voxelOffset(hit,t*e),site);let d2=rockDetail(voxelOffset(hit,-t*e),site);
        let d3=rockDetail(voxelOffset(hit,b*e),site);let d4=rockDetail(voxelOffset(hit,-b*e),site);
        if(abs(d0)+abs(d1)+abs(d2)+abs(d3)+abs(d4)>0.0){
            lit=normalize(normal-(t*(d1-d2)+b*(d3-d4))/(2.0*e));
            let k=.5*(.25*(d1+d2+d3+d4)-d0)/max(e,1.0);
            cavity=clamp(max(cavity,smoothstep(.02,.5,k))-.15*smoothstep(.08,.8,-k),-.15,1.0);
            let lt=u.light-normal*dot(u.light,normal);let lw=length(lt);
            if(lw>.05&&sun>0.0){
                let dir=lt/lw;let rise=dot(u.light,normal)/lw;var over=0.0;
                for(var i=1;i<=3;i++){let s=f32(i)*.8;over=max(over,rockDetail(voxelOffset(hit,dir*s),site)-d0-s*rise);}
                sun*=1.0-smoothstep(.2,1.0,over);
            }
        }
    }
    useRock(p);
    geometryOut[geometryIndex(vec2i(floor(v.position.xy)))]=SurfaceRecord(hit.y,hit.z,lit.x,lit.y,lit.z,
        voxelRain(hit,normal),sun,voxelOcclusion(hit,normal),cavity,
        soft.x,soft.y,voxelFaceSlope(hit.xy),occlusion(p,hit.z),visibility(p,max(hit.z,u.sea)));
    return vec4f(0);
}
#endif
#ifdef COLOR_PASS
@group(3) @binding(0) var<storage,read> geometryIn:array<SurfaceRecord>;
// The inspector's record of its pixel (sculpt-renderer.js readProbe): 0 set, 1-3 the final color, 4 the ground's slot, 5 the height above the
// sea, 6-19 the surface facts, 20 the low-ground tint's share, 21 the wet band's, 22 the surf sand's, 23 whether it is the world's own ground,
// 24 how many layers drew, then each layer's (row, coverage) in draw order.
const PROBE_LAYERS = 25u;
@group(3) @binding(3) var<storage,read_write> probeOut:array<f32,96>;
@fragment
fn fragmentMain(v: VertexOut) -> @location(0) vec4f {
    let geometry=geometryIn[geometryIndex(vec2i(floor(v.position.xy))+vec2i(1))];
    if(dot(vec3f(geometry.nx,geometry.ny,geometry.nz),vec3f(geometry.nx,geometry.ny,geometry.nz))<.5){discard;}
    colorFaceSlope=geometry.faceSlope;
    // GLSL's gl_FragCoord (origin bottom left; the canvas is u.size high).
    // H7b: an output texel covers chunkScale final pixels, so its screen position is scaled back (x * 1 at final).
    let fragCoord = vec2f(v.position.x * u.chunkScale + u.chunkScreenOrigin.x, u.size - (v.position.y * u.chunkScale + u.chunkScreenOrigin.y));
    // Card tilepool: the interpolated world position is held to 1/64 px. Past 8,192 px (a 16x16 map's far side) f32 rounding moved it
    // by about 1e-3 px against the same ground a pool period nearer the origin, enough to flip palette pixels and make its tiles unique.
    let hit=vec3f(round(fragCoord.x*256.0)/256.0,geometry.y,geometry.z);
    let p=round(hit.xy*64.0)/64.0;
    useRock(p);   // the rock this pixel shows: every rock number below is its recipe's
    // TA's fixed camera permits a native-pixel material grain. World-XY
    // sampling stretches that grain over projected south-facing slopes.
    // Geometry and broad material decisions still use world coordinates.
    var pixel = vec2f(fragCoord.x, u.size - fragCoord.y);
    probeHere = geometryFrame.probe.x > 0u && all(vec2u(max(floor(pixel), vec2f(0.0))) == geometryFrame.probe - 1u);
    // Stable, stratified native-pixel sampling: retain the material distribution
    // without locking every preview texel to one phase of a repeating grain.
    if (u.chunkScale > 1.0) {
        let cell = vec2u(floor(pixel / u.chunkScale));
        var h = cell.x * 374761393u + cell.y * 668265263u;
        h = (h ^ (h >> 13u)) * 1274126177u; h = h ^ (h >> 16u);
        let phase = vec2f(f32(h & 65535u), f32(h >> 16u)) / 65536.0;
        pixel = vec2f(cell) * u.chunkScale + floor(phase * u.chunkScale) + 0.5;
    }
    // Sand grains read the rock at a noise-scattered coordinate; GLSL took
    // that lookup's level from implicit derivatives. WGSL allows derivatives
    // only in uniform control flow, so they are taken here, before any branch.
    let scatter = pixel * 1.37 + vec2f(terrainNoise(p * 2.0).r, terrainNoise(p * 2.0 + 9.0).g) * 40.0;
    let scatterDx = dpdx(scatter);
    let scatterDy = dpdy(scatter);
    let h=hit.z;
    let g=surfaceGradient(p);
    let broad = broadGradient(p);
    // Card G6: raised ice is lit by its blurred height (the gradient g keeps the relief for everything else).
    var iceMesa = 0.0;
    if (u.iceSoft > 0.0 || u.rock[rs & rockMask].iceSnow > 0.0 || u.rock[rs & rockMask].iceApron > 0.0 || u.rock[rs & rockMask].iceFall > 0.0) {
        iceMesa = smoothstep(u.base + 1.5, u.base + 8.0, baseHeight(p));
    }
    var normal=vec3f(geometry.nx,geometry.ny,geometry.nz);
    let gSoft=vec2f(geometry.gx,geometry.gy);
    let n = terrainNoise(p);
    let sediments = select(vec4f(0.0), materialFieldAt((p / (u.size - 1.0) * (u.grid - 1.0) + 0.5) / u.grid), u.materialReady != 0);
    let fringeVariation = u.ringVariation / 0.75;
    let drift = ((terrainNoise(poolPos(p) * poolScale(0.65) + vec2f(133.0, 71.0)).rg - 0.5) * 66.0 + (n.gb - 0.5) * 16.0) * fringeVariation;
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
    painted.x = max(painted.x, max(rimRockAt(p), shoreRockAt(p)));   // bare rock at a rim or a shore is painted rock (engine-common.wgsl rimRockAt, shoreRockAt)
    let place = landPlace(p, baseHeight(p), broad, broad, slope, n, weather, route);
    let bare=clamp(1.0-place.vegetation,0.0,1.0);
    let faceGate=rockFaceGate(slope/(1.0-.5*bare),painted.x,route)*(1.0-softBankAt(p));
    let rain=geometry.rain;
    let footing=u.rock[rs & rockMask].faceGrass*rain*smoothstep(.6,.95,normal.z)*smoothstep(u.sea,u.sea+2.0,h);
    let solidSlope=length(normal.xy)/max(normal.z,.1);
    let rockSlope=max(slope,solidSlope*.7*smoothstep(.12,.5,slope));
    let rise=mix(smoothstep(u.rock[rs & rockMask].rockFaceFrom,u.rock[rs & rockMask].rockFaceFrom+1.3,rockSlope),smoothstep(.5*u.rock[rs & rockMask].rockFaceFrom,.5*u.rock[rs & rockMask].rockFaceFrom+.5,rockSlope),bare);
    let share=max(clamp(u.rock[rs & rockMask].faceRock*rise*place.exposure*(2.0-clamp(place.vegetation,0.0,2.0)),0.0,1.0),smoothstep(.15,.95,painted.x)*.9);
    let patches=voxelNoise(hit/vec3f(13,13,8));
    // Coverage is patchy soil on rain-exposed ledges, rather than a gray/green
    // mixture over the whole wall. The threshold follows actual 3D footing.
    let soilEdge=.32+(patches-.5)*.8+footing*.95;
    let faceRock=smoothstep(soilEdge-.08,soilEdge+.08,share);
    let localSun=geometry.sun;let localSky=geometry.sky;
    let faceLight=u.rock[rs & rockMask].faceShade*faceGate*clamp(u.rock[rs & rockMask].rockFace*.5*voxelRelief(p,slope),0.0,1.0);
    let faceSun=mix(1.0,localSun,faceLight);
    let faceOcc=(1.0-localSky)*faceLight;
    // The beds as the solid draws them (engine-common.wgsl columnGather, voxelFine): Layer tint shades the fine layers too, each lip
    // lighter and the notch under the next one darker, so the lines the relief draws keep their tone in shadow and through the palette.
    var hard=.55;var gathered=0.0;let column=voxelColumnCoord(hit);
    if(u.rock[rs & rockMask].columnCount>0){let g=columnGather(columnBedIn(column,columnSectionAt(column),u.rock[rs & rockMask].bedCycleVary),voxelFaceSlope(hit.xy));hard=g.x;gathered=g.y;}
    let fine=voxelFine(hit,column,gathered);
    var fineTone=0.0;
    if(fine.z>0.0){fineTone=(fine.x+fine.y)*2.0/max(fine.z,2.5);}   // full tint from a depth of 2.5 (a unit each way)
    let rockTone=voxelNoise(voxelRockSpace(hit)/max(4.0,u.rock[rs & rockMask].faceBlockSize))*2.0-1.0;
    let accumulated=rockWeatherAt(p);
    let skin=voxelSkin(hit,slope,painted.x,rain);
    let rockWet=clamp(.15+.5*rain+.3*faceOcc+.2*(1.0-hard)+accumulated.w*.8,0.0,1.0);
    let flatLight = u.ambient + 0.95 * u.light.z;
    var lighting = (u.ambient + 0.95 * max(0.0, dot(normal, u.light))) / flatLight;
    lighting = min(lighting, u.lightCap);
    let ao = geometry.ao;
    let shadow = geometry.shadow;
    // Nearby shadows and cavities read the displaced solid. Comparing its
    // cut faces against the old height surface falsely buried them in shadow.
    let closeVis=mix(1.0,localSun,u.closeShadow);
    let cav=clamp(max(geometry.cavity*(u.cavity+2.0*faceLight),faceOcc)+(1.0-localSky)*(.3+faceLight),-.15,.92);
    var shading = lighting * ao * shadow;
    var lightTint = vec3f(1.0);
    // Open lit level ground keeps its brightness under any light colour (the tint is divided by its luma), so a colour changes hue and the
    // light-to-shade balance and never the exposure; white on both is exactly 1.
    let flatTintLuma = 1.0 + dot((u.ambient * (u.skyColor - 1.0) + 0.95 * u.light.z * (u.sunColor - 1.0)) / flatLight, vec3f(0.2126, 0.7152, 0.0722));
    {
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
        let castShadow = mix(1.0, shadow, mix(u.flatShadow, 1.0, onSlope)) * closeVis * faceSun;
        let occluded = mix(1.0, ao, mix(u.flatOcclusion, 1.0, onSlope));
        let skyShare = u.ambient * (1.0 - cav) + fill;
        let sunShare = 0.95 * direct * castShadow * (1.0 - 0.45 * cav);
        shading = min((skyShare + sunShare) / flatLight, u.lightCap) * occluded;
        // The share of the light that is sky takes the sky's colour and the share that is sun the sun's; white on both is exactly 1.
        lightTint = 1.0 + (skyShare * (u.skyColor - 1.0) + sunShare * (u.sunColor - 1.0)) / max(skyShare + sunShare, 0.0001);
    }
    lightTint /= max(flatTintLuma, 0.05);
    // Retail Lava faces stay close to the ground's tone whichever way they
    // look (luma regressed on the height gradient: ~8 per unit slope east to
    // west against our 20; measured on four maps), so its world keeps only
    // part of the directional shading.
    if (u.shadeDepth < 1.0) { shading = mix(1.0, shading, u.shadeDepth); lightTint = mix(vec3f(1.0), lightTint, u.shadeDepth); }
    // B4: the rock's thickness along the sun's line, for a rock that deepens with it (nothing runs for opaque rock).
    var chord = 0.0;
    if (u.rock[rs & rockMask].absorbDepth > 0.0) { chord = sunChord(hit, normal); }
    // B4: a cast shadow cast by a rock that colours its shadow lets part of the sun through, in the rock's absorption hue: Colored cast shadow of
    // the occluder (its slot where the sun's line meets it), a third of it through any thickness and the rest the less the more of the occluder
    // the line crosses (e^(-t/12)): a thick rock's shadow is dim and coloured, a thin one's brighter.
    if (u.shadowTintAny > 0.0 && shadow < 1.0) {
        let by = shadowBlocker(p, max(h, u.sea));
        let caster = rockSlotAt(by.xy);
        let row = u.rock[caster & rockMask].rockColors[6];
        let hue = select(slotRock(caster), row.rgb, row.a > 0.5);
        let onSlope = smoothstep(0.08, 0.35, slope);
        let passed = 0.95 * max(0.0, dot(normal, u.light)) * (1.0 - shadow) * mix(u.flatShadow, 1.0, onSlope) * u.rock[caster & rockMask].shadowTint * (0.3 + 0.7 * exp(-by.z / 12.0)) / flatLight;
        let filtered = hue / max(max(hue.r, max(hue.g, hue.b)), 0.02) * u.sunColor / max(flatTintLuma, 0.05);
        lightTint = (lightTint * shading + filtered * passed) / max(shading + passed, 0.0001);
        shading += passed;
    }
    // S4 (Archipelago's domes): a crease, where the authored height lies below its rings 6 and 12 px out (a gully's floor, a valley's), loses light
    // whatever its facing, after the directional shading is scaled, so gullies read on a world that keeps little of it. A plane or a crest gives 0.
    if (u.creaseShade > 0.0 && h > u.sea) {
        let hb = baseHeight(p);
        let r6 = 0.25 * (baseHeight(p + vec2f(6.0, 0.0)) + baseHeight(p - vec2f(6.0, 0.0)) + baseHeight(p + vec2f(0.0, 6.0)) + baseHeight(p - vec2f(0.0, 6.0)));
        let r12 = 0.25 * (baseHeight(p + vec2f(8.5, 8.5)) + baseHeight(p - vec2f(8.5, 8.5)) + baseHeight(p + vec2f(8.5, -8.5)) + baseHeight(p - vec2f(8.5, -8.5)));
        let crease = 0.6 * (r6 - hb) / 6.0 + 0.4 * (r12 - hb) / 12.0;
        shading *= 1.0 - 0.6 * u.creaseShade * smoothstep(0.04, 0.4, crease);
    }
    // G5 (Lava): rock turned from the sun, or in a cast shadow, goes darker than the diffuse term alone gives (retail's far sides are near black).
    // Retail's small hills keep nearly the plain's tone on their far sides; the dark masses are the tall hills', so it grows with height.
    // Only faces turned from the sun take it (n.l from .5 down to .1), so a flank that faces the light is not darkened by its occlusion.
    if (u.lavaDusk > 0.0 && shading < 1.0) { shading = pow(max(shading, 0.0), 1.0 + u.lavaDusk * smoothstep(u.base + 20.0, u.base + 60.0, baseHeight(p)) * (1.0 - smoothstep(0.1, 0.5, dot(normal, u.light)))); }
    let timeMaps = timeMapsAt(p);
    gs=groundSlotAt(p);
    var grass = groundPigment(p,gs,timeMaps.wear,timeMaps.deposit);
    // The world's own settings for level ground (its low-ground tint, its cover table, its patches) belong to its ground material;
    // a material a stroke chose keeps its own look.
    let ownGround = gs == u32(u.groundDefault);
    var surfSrc: array<vec3f, 7>;
    var surfMask: array<f32, 7>;
    var layerCover: array<f32, 7>;
    var layerOver = 0.0;
    if (u.materialTable[SURFACE_FLAGS].x > 0.0 || probeHere) {
        // The surface layers' facts (surfaceFacts), once a pixel and only when a layer reads them or draws a material.
        let site = coverSite(broad, timeMaps);
        surfaceFacts = array<f32, 14>(slope, baseHeight(p) - u.sea, baseHeight(p) - u.base, timeMaps.wear, timeMaps.deposit, timeMaps.wet,
            site.x, coverSoil(slope, place.top, timeMaps, site.x), site.y, place.top, place.convexity, 0.0, 0.0, 0.0);
    }
    if (ownGround) { let hs = highShare(p); if (hs > 0.0) { surfSrc[0] = groundPigment(p, u32(u.highGround), timeMaps.wear, timeMaps.deposit); surfMask[0] = hs; } }
    surfaceStage(0u, &grass, &surfSrc, &surfMask, &layerCover, &layerOver, p, pixel);   // stage 0: highland ground
    // Low ground: the ground from the sea up to lowReach above it takes the low color (its grain kept), by the authored
    // height (the relief's grit would speckle the edge); the edge is ragged by 20-px noise and fades over the upper half of the reach.
    // Under the sea it is all low ground: the lit bed takes it from here and the shallow water's art below.
    // Its grain (Grain kept below 1): the ground pattern about its mean, and in the water the art and the depth mottle, so mud reads smooth.
    var lowShare = 0.0;
    var lowGrain = 1.0;
    if ((u.lowTint > 0.0 || u.lowGrain < 1.0) && ownGround) {
        let above = baseHeight(p) - u.sea + (terrainNoise(p * 0.05 + vec2f(19.0, 47.0)).g - 0.5) * 0.6 * u.lowReach;
        let low = 1.0 - smoothstep(0.5 * u.lowReach, u.lowReach, above);
        let groundTone = groundMean();
        if (u.lowGrain < 1.0) { lowGrain = mix(1.0, u.lowGrain, low); grass = groundTone + (grass - groundTone) * lowGrain; }
        lowShare = u.lowTint * low;
        if (lowShare > 0.0) { grass = mix(grass, lowTinted(grass, groundTone), lowShare); }
    }
    // The model's slope grass costs noise taps, so the slope and face blocks share one read.
    // Level ground (slope under the cover ramp's start, no painted rock) never mixes it in, so it skips the taps.
    var slopeBased = vec3f(0.0);
    let slopeTexWanted = slope > u.slopeProfile.x;
    if (slopeTexWanted || u.mineralMargins != 0) { slopeBased = slopeGrassSource(pixel); }
    // The level ground before any slope cover, for crystal tops (crystalGrain).
    let levelGround = grass;
    var slopeShare = 0.0;
    if (u.slopeMaterial != 0) {
        // Small native slope interiors retain moss ribs and scattered stone.
        // This is an appearance material, not recovered albedo or geometry.
        var slopeGrass = slopeBased;
        var slopeCover = smoothstep(u.slopeProfile.x, u.slopeProfile.y, slope) * smoothstep(u.slopeProfile.z, u.slopeProfile.w, baseHeight(p));
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
        surfMask = array<f32, 7>();
        surfSrc[0] = slopeGrass; surfMask[0] = slopeCover;
        surfaceStage(1u, &grass, &surfSrc, &surfMask, &layerCover, &layerOver, p, pixel);   // stage 1: slope cover
        slopeShare = layerCover[0];
    }
    // The one rock's colour, wherever rock shows (a face, a bare top, a crown): even (its relief's light makes the pattern), each block a
    // little lighter or darker (Color variation), each layer its own tint (Layer tint), its runnels and open partings wet (Wet streaks).
    let rockFlat = slotRock(rs);
    // The grain is the rock material's, read one texel a native pixel (a 2D repeat at TA's fixed camera: 1:1 on every face).
    let grain=rockGrain(rs,pixel);
    let clasts=voxelClasts(hit);
    let mineralPatch=u.rock[rs & rockMask].faceMineral*clasts.x*clasts.y*clamp(u.rock[rs & rockMask].faceClast,0.0,1.0);   // the clasts' minerals (the grain's are the rock material's)
    var rock=rockFlat*grain*(1.0+u.rock[rs & rockMask].faceTone*rockTone+u.rock[rs & rockMask].faceStrata*(hard*2.0-1.0+fineTone))*(1.0-.6*u.rock[rs & rockMask].faceWet*rockWet);
    // Different minerals share the rock's chosen hue while varying albedo
    // and polish together. Embedded clasts read the same field as the solid.
    rock*=1.0+mineralPatch*.65;
    // H3 item 4: one placement function (landPlace); its thresholds are rows of materials/green.json.
    rock=mix(rock,rock*.42,u.rock[rs & rockMask].runoffStain*clamp(accumulated.x,0.0,1.0));
    var exposed = place.exposed;
    // Soil where the cover thins (u.soilRim). Off the faces the rock's share stops being a blend of grass and rock: rock shows where the share
    // beats a threshold that the rock's own patches and a 4 px grain move, so its edge is a ragged line. Just under that threshold, and just
    // under a face's soil edge, the cover is too thin for plants: a band of bare soil, which tufts break up toward the grass.
    var soil = 0.0;
    var faceShare = faceRock;
    if (u.soilRim > 0.0) {
        // The edges fray by the art pixel, so cover and rock interleave where they meet instead of one lying over the other: single pixels of
        // grass stand in the bare ground and single pixels of earth in the grass. Along an edge the seam of earth comes and goes (53 and 17 px).
        let fray = shelfHash(poolPixel(grainPixel(pixel)) + 37.0) - 0.5;
        let comes = smoothstep(0.25, 0.7, 0.5 + 0.5 * (0.6 * poolNoise(p, 53.0, 91.0) + 0.4 * poolNoise(p, 17.0, 57.0)));
        // Soil on level ground is a ground choice, so all of its variation
        // uses the pool. Rock-face variation remains in rock space.
        let line = 0.5 + poolNoise(p, 13.0, 43.0) * 0.2 + poolNoise(p, 4.0, 17.0) * 0.1 + fray * 0.22;
        let bared = smoothstep(line - 0.05, line + 0.05, place.exposed);
        let rimGround = smoothstep(line - 0.4, line - 0.1, place.exposed) * smoothstep(0.05, 0.2, place.exposed) * (1.0 - bared);
        let frayedFace = smoothstep(soilEdge + fray * 0.3 - 0.05, soilEdge + fray * 0.3 + 0.05, share);
        faceShare = mix(faceRock, frayedFace, u.soilRim);
        let rimFace = smoothstep(soilEdge - 0.45, soilEdge - 0.1, share) * smoothstep(0.05, 0.2, share) * (1.0 - faceShare);
        exposed = mix(exposed, bared, u.soilRim);
        let thin = u.soilRim * mix(rimGround, rimFace, faceGate) * (1.0 - route) * smoothstep(u.sea + 1.0, u.sea + 3.0, h) * (0.2 + 1.1 * comes);
        let tuft = terrainNoise(p * 5.0 + vec2f(13.0, 47.0)).r;
        let need = 0.4 * tuft + 0.45 * (fray + 0.5);
        soil = smoothstep(need - 0.04, need + 0.04, thin);
    }
    exposed = mix(exposed, faceShare, faceGate);   // on the rock face the face's share decides
    let lowBank = place.lowBank;
    let sandBar = sandBarAt(p);
    // The damp band reaches wetBand above the sea by the authored height (the relief's grit would speckle it, and on a plain just above the sea
    // blot it); at 1 or less it has no width (the ground is damp only below sea + 1).
    var nearWater = frostDry(1.0 - waterRamp(u.sea + 1.0, u.sea + max(u.wetBand, 1.0), baseHeight(p)), route);
    // Card P27, Surf: the signed distance to the waterline, and the wet sand it extends the wet band with.
    var surfX = 1.0e3;
    var surfQ = vec2f(0.0);
    var surfSlope = 0.12;
    var surfE = 0.0;
    if (u.waterOn != 0) { surfE = max(sampleMasks(maskPoint(p),4).b, 0.0); }
    if (surfE > 0.0) {
        let shore = surfShore(p);
        surfX = shore.x;
        surfQ = shore.yz;
        surfSlope = shore.w;
        // Painted rock (a rock coast's, from coastBeach, or the artist's) takes the beach away, by its ragged edge: Surf falls to almost nothing (a wet line and a lace).
        if (u.paintOn != 0) { surfE = mix(surfE, 0.02, smoothstep(0.3, 0.7, painted.x)); }
        if (surfX < 900.0) { nearWater = max(nearWater, surfWet(surfX, surfQ, p, surfE)); }
    }
    surfMask = array<f32, 7>();
    surfMask[0] = soil;   // bare soil: the world's soil material (@soil) where the cover thins
    surfSrc[1] = rock; surfMask[1] = exposed;
    if (u.beach != 0 && h > u.sea - 1.0) {
        // Beach sand within reach of the water (baked), or failing that a low band above the waterline; its inland edge is ragged and breaks into grains.
        let speck = terrainNoise(p * 6.0 + vec2f(61.0, 3.0)).b;
        let top = u.beachHeight * u.beachWidth * (0.65 + 0.7 * terrainNoise(p * 0.45 + vec2f(29.0, 5.0)).g);
        // The low band only within the water's reach: inland hollows of a low world are not beaches; steep banks stay bare.
        var beach = max(beachSand(p, speck), (1.0 - smoothstep(top * 0.6, top, h - u.sea + (speck - 0.5) * 1.5)) * (1.0 - smoothstep(0.7, 1.3, slope)) * smoothstep(0.0, 0.15, beachField(p)));
        // A sandy slope keeps its own streaked material over the beach sand.
        if (u.slopeSand != 0) { beach *= 1.0 - slopeShare; }
        surfSrc[2] = beachColour(pixel); surfMask[2] = beach * (1.0 - exposed * 0.7);
    }
    var material = grass;
    surfaceStage(2u, &material, &surfSrc, &surfMask, &layerCover, &layerOver, p, pixel);   // stage 2: bare soil, rock, beach
    exposed = layerCover[1];
    surfaceFacts[11] = exposed;
    material = joinSedimentTransition(material, pixel, rock, exposed, materialWeather);
    surfMask = array<f32, 7>();
    let crowned = u.rock[rs & rockMask].rockCrown > 0.0;
    if (crowned) {
        // Some worlds' raised ground is bare rock to its crown (Zhon's
        // domes), not only where it is steep.
        surfSrc[0] = rock; surfMask[0] = smoothstep(u.base + 5.0, u.base + 14.0, baseHeight(p) + (n.g - 0.5) * 6.0) * u.rock[rs & rockMask].rockCrown * (1.0 - route) * (1.0 - sandBar);
    }
    surfaceStage(3u, &material, &surfSrc, &surfMask, &layerCover, &layerOver, p, pixel);   // stage 3: crown rock
    if (crowned) { exposed = max(exposed, layerCover[0]); }
    exposed *= 1.0 - layerOver;
    var bandSrc = vec3f(0.0); var bandMask = 0.0;
    if (u.rock[rs & rockMask].strata > 0.0 && u.rock[rs & rockMask].columnCount > 0) {
        // Beds by height, measured on retail Painted Desert: the column's sections (a start above the plain, a pair of beds as
        // colour slots with B's share of each period). Within a section A and B alternate every period, quasi-periodically (B's
        // share varies per cycle), and B's share ramps toward the next section when both use the same pair. Beds colour all
        // raised ground, level tops included (retail mesa caps take their band's colour); edges are hard (~3 px); bed edges
        // wander ~1-1.5 units at 5-25 px and meander broadly.
        // On a level cap the authored height chooses one bed. Art relief and
        // world-space bed wander must not select a different ground material.
        let bedSlope = smoothstep(0.05, 0.22, slope);
        let levelColumn = (baseHeight(p) - u.columnOrigin) * (5.5 / max(2.0, u.rock[rs & rockMask].faceBed));
        let hr = mix(levelColumn, voxelColumnCoord(hit), bedSlope);
        let zone = columnSectionAt(hr);
        // Card G4: retail's pale caps are one sheet of the cool bed. The cap pixels (height 56 and up on slopes under .35 per px)
        // are 9.6-12% orange in retail and 22% in ours, hue 64-77 against 42: the beds' fine warp and the spread of a section's
        // split push a flat top across a bed edge in blotches, so level ground in a section that is nearly all cool bed is held to it.
        // (Retail keeps one ragged orange patch of 40-150 px per cap. A threshold on noise drew smooth stains or thin veins, so
        // ours draws none.)
        let level = 1.0 - smoothstep(0.05, 0.22, slope);
        let edge = clamp(1.5 * max(slope, 0.05) / columnSection(zone).w, 0.01, 0.2);
        let stratum = columnColour(hr, zone, edge, true, u.desertCapFlat * level);
        // Painted rock (card C5) in a world with beds takes the colour its highest ground is painted with (its top section's
        // main bed: Painted Desert's grey buttes), and (card E8) the strata run through the rock itself, so painted rock carries
        // the top section's own beds (its grey with the lines), not one flat colour, wherever it is painted. A painted mesa's
        // rock is mostly gentle: a fixed edge.
        let topZone = u.rock[rs & rockMask].columnCount - 1;
        var rockBed = vec3f(0.0);
        if (painted.x > 0.0) { rockBed = columnColour(hr, topZone, 0.04, false, 0.0); }
        let bed = mix(stratum, rockBed, painted.x);
        let lum = dot(material, vec3f(0.299, 0.587, 0.114));
        let meanLum = max(dot(groundMean(), vec3f(0.299, 0.587, 0.114)), 0.05);
        // The ground's grain survives in the beds as brightness, scaled by
        // Bed grain (retail desert bands are smooth colour).
        let bedColour = saturate(bed * mix(1.0, clamp(lum / meanLum, 0.82, 1.12), u.rock[rs & rockMask].strataGrain));
        // Where the beds begin is read from the height alone, without the column's tilt and wander: those are world-space noise, which
        // carried the first bed's colour onto the plain in patches that do not repeat with the ground's pool (a bare Desert plain drew
        // 839 distinct tiles in a 2048-px window where its pool holds 210; TA's maps are tiles). The beds themselves still wander.
        // A recipe's level ground takes its beds from its own height (bedsFrom: the world's first section start for the world's rock); its faces at every height.
        let onRaised = max(smoothstep(u.rock[rs & rockMask].bedsFrom, u.rock[rs & rockMask].bedsFrom+1.5, baseHeight(p)-u.columnOrigin),faceGate*exposed) * (1.0-route);
        let bedCoverage=clamp(u.rock[rs & rockMask].strata*2.0,0.0,1.0)*select(mix(exposed,1.0,smoothstep(.5,1.0,u.rock[rs & rockMask].strata)),exposed,!ownGround);
        // Highland ground (highShare) wins over the beds on level ground, so a world's pale caprock or jungle lies on its high tops whatever bed
        // their height falls in; faces keep their bands.
        let capped = 1.0 - level * select(0.0, highShare(p), ownGround);
        material = mix(material, bedColour, max(bedCoverage * u.rock[rs & rockMask].strataContrast * onRaised * capped, u.rock[rs & rockMask].strata * painted.x));
        if (u.baseBand > 0.0) { bandMask = baseBandMask(p, h - u.base, slope)*select(1.0,exposed,!ownGround); }   // its material: the world's band (@band)
    }
    surfMask = array<f32, 7>();
    surfSrc[0] = bandSrc; surfMask[0] = bandMask;
    surfaceStage(4u, &material, &surfSrc, &surfMask, &layerCover, &layerOver, p, pixel);   // stage 4: base band
    exposed *= 1.0 - layerOver;
    // Ground patches: level ground is not one tone. One gray field (two sizes of noise, sizes rounded to divide the pool) is read through a ramp of five flat steps: damp ground
    // up to a fifth darker, plain ground as it is, dusty ground paler toward the world's weathered sand. The steps' edges are frayed over some
    // 30 px and each tone is mottled a little, so a patch has no outline. Every part of the field repeats with the ground's pool, as the
    // ground's own tiles do, so a plain keeps the tiles it had (TA's maps are tiles, at most 65,536 of them; with the patches off the pool
    // the same plain had four times as many distinct tiles). Color only; the heights stay flat.
    if (u.groundPatch > 0.0 && ownGround) {
        let level = (1.0 - smoothstep(0.05, 0.22, slope)) * (1.0 - exposed) * (1.0 - route) * smoothstep(u.sea + 1.0, u.sea + 3.0, h);
        if (level > 0.0) {
            let size = max(40.0, u.groundPatchSize);
            let field = 0.7 * poolNoise(p, size, 31.0) + 0.3 * poolNoise(p, size * 0.41, 5.0)
                + 0.16 * poolNoise(p, 24.0, 9.0) + 0.12 * poolNoise(p, 7.0, 4.0) + 0.1 * poolNoise(p, 2.0, 6.0);
            let damp = 0.5 * (step(field, -0.2) + step(field, -0.45)); let dust = 0.5 * (step(0.2, field) + step(0.45, field));
            let tone = material * (1.0 - 0.2 * damp) * (1.0 + 0.05 * poolNoise(p, 40.0, 2.0));
            material = mix(material, mix(tone, mix(tone, sandWeathered(), 0.3) * 1.06, dust), u.groundPatch * level);
        }
    }
    material=rockSkinColor(material,grain,skin*exposed);
    // The source's mineral fines bury grass between stones. Coarse fragments
    // retain rock albedo; fine material inherits this world's existing sand.
    // The debris's edge is ragged and partly grown over (debrisLie, debrisRegrown). What is left covers the ground as gravel does, not as a haze:
    // at least .45 of it where the debris is thinnest.
    var lying=accumulated;var depositCover=0.0;
    surfMask = array<f32, 7>();   // stage 5: the loose surfaces, gathered here and laid after the sand below
    if(u.debrisAny>0.0){
        lying=rockWeatherAt(debrisLie(p));
        if(lying.y>0.0){
            // Fines hold their ground: where the debris is sand and grit, plants need it thinner before they take it, so a cliff's foot keeps its sand.
            // Sandy debris holds against regrowth (up to three times as long), and its edge frays by the art pixel: grains lie out in the grass
            // and blades stand in the sand, so the sand does not end at a line over the grass.
            let grains=lying.z*1.2*(shelfHash(floor(grainPixel(pixel))+23.0)-.5)*smoothstep(0.0,.08,lying.y);
            let regrown=debrisRegrown(max(lying.y*(1.0+2.0*lying.z)+grains,0.0),p,clamp(lying.w*1.6,0.0,1.0),place.vegetation);
            depositCover=clamp(lying.y*.9+.45,0.0,1.0)*(1.0-regrown.x);
            if(regrown.y>0.0){surfMask[0]=regrown.y*.6;}   // moss on regrown debris: the world's moss material (@moss)
        }
    }
    let source=rockSourceAt(p);
    // The debris is its source's rock (rock weather's strongest source here): its beds' colours as that recipe's Strata gives them.
    let ds=debrisSlotAt(p);
    let sourceColor=mix(rock,source.rgb*mix(1.0,clamp(dot(grain,vec3f(.3333)),.82,1.12),u.rock[ds & rockMask].strataGrain),clamp(u.rock[ds & rockMask].strata*2.0,0.0,1.0)*u.rock[ds & rockMask].strataContrast);
    // Its fines are the world's weathered sand tinted as its source's rock is tinted against the world's (the same where they share a colour).
    let fines=sandWeathered()*clamp((slotRock(ds)+.01)/(slotRock(0u)+.01),vec3f(.25),vec3f(4.0));
    let fineColor=mix(sourceColor,mix(fines,sourceColor*.9,clamp(u.rock[ds & rockMask].strata*2.0,0.0,1.0)*u.rock[ds & rockMask].strataContrast),lying.z*.65);
    surfSrc[1]=fineColor;surfMask[1]=depositCover;
    // Painted masks (card C5), after the world's own beds and before sand,
    // which covers them. Painted rock is the rock face where the face is drawn (faceGate), and the plain rock material elsewhere.
    if (u.paintOn != 0) {
        surfSrc[2] = rockSkinColor(rock,grain,skin); surfMask[2] = painted.x * (1.0 - faceGate);
        surfMask[3] = painted.y; surfMask[4] = painted.w;   // painted snow and moss: the world's snow and moss materials
    }
    {
        // Procedural sand: a colour with two scales of grain, so it needs no
        // sampled art. Coverage comes from the bake.
        let sand = bakedFields(p).a * place.deposits;
        if (sand > 0.0) {
            // The sand and its dust draw the world's sand material (@sand). riverfix: where a braided river's bed lies (mask plane 19) they are
            // its gravel and silt instead, the world's river-bed colour (or its rock's, darkened) with a mottle of pebble-sized flecks; the
            // pebbles themselves are the loose-stone scatter the bed paints denser.
            let bed = max(sampleMasks(maskPoint(p),4).a, 0.0);
            if (bed > 0.0) {
                let tone = select(rockMaterialMean(0u) * vec3f(0.78, 0.74, 0.68), u.riverBed.rgb, u.riverBed.a > 0.5);
                let fleck = valueNoise(pixel / 1.4 + 7.0) * 0.5 + valueNoise(pixel / 2.9 + 41.0) * 0.3 + valueNoise(pixel / 9.0 + 3.0) * 0.2;
                riverBedOver = vec4f(saturate(tone * (1.0 + 0.22 * fleck)), min(bed * 8.0, 1.0));   // any bed at all: its edges keep the sand cover's own scatter
            }
            // Three stages, so sand thins into the ground over tens of pixels: dust tints what is there, then grains appear between grass blades
            // (a per-pixel threshold against fine noise), then sand covers the ground.
            surfMask[5] = smoothstep(0.0, 0.6, sand) * u.sandDust * 0.6;
            surfMask[6] = sandCoverAt(sand, p, 1.0);
        }
    }
    {
        surfaceFacts[12] = surfMask[1]; surfaceFacts[13] = surfMask[6];
        surfaceStage(5u, &material, &surfSrc, &surfMask, &layerCover, &layerOver, p, pixel);
        exposed = max(exposed, layerCover[1] * (1.0 - lying.z * 0.45)) * (1.0 - layerOver);   // debris fines
        if (u.paintOn != 0) { exposed = max(exposed, painted.x); }            // painted rock
    }
    // Baked boulders take rock material, lit by the same surface.
    {
        let coverOrCrack = bakedFields(p).b;
        // A crack wall facing the sun.
        if (coverOrCrack > 1.0) { material *= 1.0 + CRACK_LIT * (coverOrCrack - 1.0); }
        else {
            // The filtered code blends a lit crack wall (above 1) or a dark line (below 0) with its neighbours into the cover's range: only
            // a texel that holds cover is rock, or every crack wall drew a rock-coloured outline on the grass.
            let held = bakedFieldsNearest(p).b;
            // A stone lying in a cliff's debris has the color of the bed it fell from, as the debris around it has (sourceColor: the
            // beds' colors as far as the faces show them, Strata's coverage and strength); a stone elsewhere is the world's rock.
            material = mix(material, mix(rock, sourceColor, clamp(accumulated.y * 2.0, 0.0, 1.0)) * 1.08, select(max(coverOrCrack, 0.0), 0.0, held > 1.0 || held <= 0.0));
        }
        // A crack's floor is in shadow: darken what is there, so a crack in
        // grass stays green-black and one in rock grey-black. The walls are
        // lit by the carved geometry.
        // Codes below -1 come only from band lines with Line darkness above
        // 1 (Green's dark terrace steps); up to -1 this is unchanged.
        material *= 1.0 - min(u.rock[rs & rockMask].crackDark * max(-coverOrCrack, 0.0), 1.0);
    }
    let chip = smoothstep(0.035, 0.40, materialChipHeight(p) * (1.0 - route)) * 0.65;
    surfMask = array<f32, 7>();
    surfSrc[0] = rock; surfMask[0] = chip * (1.0 - exposed);
    surfaceStage(6u, &material, &surfSrc, &surfMask, &layerCover, &layerOver, p, pixel);   // stage 6: chips
    exposed *= 1.0 - layerOver;
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
        let crystalColor = roleMean(u.crystalGround, u.rockGround);   // the crystal material's Color (else the rock material's)
        let jitter = clamp((crystalMask - 0.9) * 10.0, -1.0, 1.0);
        // Tops keep the ground's own grain (Crystal's streaks), moved toward the crystal material's own art (its facets and tones; the
        // rock material's where a map has none).
        // Crystal Grain 1: the tops carry the level ground's own art (retail
        // column tops are streaked like the ground), not the slope cover.
        let topBase = mix(material, levelGround, u.crystalGrain);
        let crystalArt = roleColor(u.crystalGround, u.rockGround, pixel);
        var faces = mix(topBase, crystalArt, 0.35) * (1.0 + 0.25 * jitter) * u.crystalTone;
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
        if (u.rock[rs & rockMask].gougeWeb > 0.0) {
            // Round 3: the bold gouges cross the raised formation, not a crater's skin or the shore's slabs.
            faces = mix(faces, vec3f(0.0), u.rock[rs & rockMask].gougeWeb * gougeWeb(p) * smoothstep(u.base + 3.0, u.base + 12.0, h) * (1.0 - craterBand));
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
    surfMask = array<f32, 7>();   // stage 7: snow on ice, laid after both
    if (u.rock[rs & rockMask].iceCrest > 0.0) {
        let lumps = terrainNoise(p * 0.05 + vec2f(31.0, 7.0)).r + (n.b - 0.5) * 0.12;
        let raised = smoothstep(u.base + 12.0, u.base + 40.0, h);
        let crest = smoothstep(0.0, 0.05, lumps - mix(0.75, 0.45, u.rock[rs & rockMask].iceCrest)) * raised;
        surfMask[0] = crest;   // the world's snow material (@snow)
    }
    // Card G6, snow on the flat tops of raised ice (retail ice-3's white top with a few pits): where the blurred
    // height is gentle the block is snow, its edge ragged, so the slate begins at the crest's roll-over.
    if (u.rock[rs & rockMask].iceSnow > 0.0) {
        let gentle = 1.0 - smoothstep(0.42, 0.78, length(gSoft) + (n.g - 0.5) * 0.25);
        let cap = u.rock[rs & rockMask].iceSnow * iceMesa * gentle;
        // A little under the plain's snow: lit at the block's strong light a full-white top clips and loses its pits (retail's top ~(225,232,255)).
        surfMask[1] = cap;
    }
    {
        surfaceStage(7u, &material, &surfSrc, &surfMask, &layerCover, &layerOver, p, pixel);
        exposed *= 1.0 - layerCover[0];
        exposed *= 1.0 - layerCover[1];
        exposed *= 1.0 - layerOver;
    }
    // Card P27: the surf's beach is drawn last over the material, so the bake's cracks, chips and stones do not mark it: sand with its own fine
    // grain (colour the world's Sand), the shading eased toward level, then the wet sand to the last uprush and the wrack lines.
    var surfCover = 0.0; var surfDamp = 0.0;   // the surf's own sand and its wet band, for Wet ground below
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
        surfCover = cover; surfDamp = wet;
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
    // Wet ground: where water lies or has just been, the ground is wet. That is the first units of height above a waterline (narrower than the
    // world's damp band, wetBand, which only tones the bank), the hollows and channel floors the Time pass wets, and the runoff rock weather traces
    // down the faces and over the tops. A wet patch ends at a drying front, ragged at two sizes, not at a fade. Wet, a bare surface (soil, sand,
    // debris, rock) is darker and more saturated, living cover far less; and it carries a film of water that mirrors the sky and tightens the sun's
    // highlight (the shine term's damp, below). The surf's own wet sand is already darkened: it takes the film only. It comes after every material
    // layer, so sand and debris laid over the ground are wetted too. Under the water the bed is the water's to draw.
    var wetFilm = 0.0;
    if (u.wetGround > 0.0) {
        var lies = min(nearWater, 1.0 - smoothstep(0.3, 2.6, h - u.sea)) * (1.0 - flatBank);
        if (u.weatherMaps > 0.5) { lies = max(lies, smoothstep(0.55, 0.85, timeMaps.wet) * (1.0 - smoothstep(0.3, 0.7, slope))); }
        lies = max(lies, clamp(accumulated.w * 1.2, 0.0, 1.0));
        let rag = 0.6 * terrainNoise(p * 1.3 + vec2f(71.0, 9.0)).r + 0.4 * terrainNoise(p * 6.0 + vec2f(5.0, 33.0)).g;
        let front = 0.2 + 0.45 * rag;
        let wet = u.wetGround * smoothstep(front - 0.08, front + 0.08, lies) * (1.0 - route) * (1.0 - smoothstep(0.0, 3.0, u.sea - h));
        let living = place.vegetation * (1.0 - max(max(clamp(exposed, 0.0, 1.0), depositCover), max(smoothstep(0.2, 0.6, bakedFields(p).a * place.deposits), surfCover)));
        let k = wet * mix(1.0, 0.35, living) * (1.0 - surfDamp);
        let lum = dot(material, vec3f(0.299, 0.587, 0.114));
        material = max(vec3f(0.0), lum + (material - lum) * (1.0 + 0.5 * k)) * (1.0 - 0.45 * k);
        wetFilm = wet * mix(1.0, 0.3, living);
    }
    // B4: thick rock deepens toward its absorption colour (Color deepens with thickness).
    if (u.rock[rs & rockMask].absorbDepth > 0.0) { material *= absorbFilter(rs, chord); }
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
    if (u.shineGate > 0.0 || u.rock[rs & rockMask].pockmark > 0.0 || u.rock[rs & rockMask].moonCups > 0.0) { landform = max(smoothstep(0.1, 0.35, slope), smoothstep(u.base + 3.0, u.base + 9.0, baseHeight(p))); }
    var iceFace = 0.0;
    if (u.rock[rs & rockMask].iceFall > 0.0) {
        // Card G6: the faces' fibres, in place of the rock art's grain and the glint's dashes.
        iceFace = clamp(exposed, 0.0, 1.0) * iceMesa;
        let fibre = iceFibre(pixel);
        // Dark strokes keep their blue (a plain multiply goes brown in the palette).
        color *= 1.0 + u.rock[rs & rockMask].iceFall * iceFace * select(0.2 * fibre, 0.8 * fibre, fibre < 0.0) * vec3f(1.0, 0.85, 0.55);
    }
    if (u.rock[rs & rockMask].iceApron > 0.0 && iceMesa < 0.9) {
        // Card G6: dark fibres spill past the foot into the snow and thin out with the distance (retail ice-3's
        // feathered edge): the same strokes as the faces', kept where raised ice is near and the broad noise allows.
        let near = iceNearness(p);
        let keep = smoothstep(0.0, 0.35, near * 1.5 - 0.12 - n.r * 0.6);
        // The strokes waver (a slow warp of where they are read), thin out with the distance, and a faint
        // fuzz of the same dark lies under them close to the foot.
        let wander = (terrainNoise(p * 0.22).rg - 0.5) * 16.0 + (terrainNoise(p * 0.9).ba - 0.5) * 5.0;
        let drift = smoothstep(0.12, 0.5, -iceDrift(pixel + wander)) * (0.35 + 0.65 * smoothstep(0.1, 0.6, near));
        color *= 1.0 - u.rock[rs & rockMask].iceApron * (0.5 * keep * drift + 0.16 * smoothstep(0.25, 0.8, near)) * (1.0 - iceMesa) * vec3f(1.0, 0.85, 0.55);
    }
    if (u.iceFrost > 0.0 && h > u.sea + 1.0 && route > 0.003) {
        // The band's trace in the route channel (1/255 inland .. 5/255 at the coast); the coast's own bank, the needles and
        // pockets carry more, and that is the band's seaward part (1 there). A drawn ramp in an Ice world counts as band too.
        let near = clamp((route - 0.0039) / 0.0157, 0.0, 1.0);
        let lines = iceFrostLines(pixel, 0.06 + 0.94 * near * near);
        color *= 1.0 - u.iceFrost * lines * mix(0.5, 1.0, near) * vec3f(0.95, 0.8, 0.3);
    }
    if (u.rock[rs & rockMask].iceCrystal > 0.0) {
        // Straight strokes over the rock faces, darker the more rock shows (card E6; after shadeBlue, which rebuilds the colour).
        color *= 1.0 - 0.75 * u.rock[rs & rockMask].iceCrystal * iceHatch(pixel) * smoothstep(0.3, 0.8, exposed);
    }
    // Cast shadow as the diffuse term applies it (level ground keeps flatShadow), shared by shine and the surface marks.
    let markSeen = 1.0 - (1.0 - shadow) * mix(u.flatShadow, 1.0, smoothstep(0.08, 0.35, slope));
    let turned = 1.0 - clamp(shading, 0.0, 1.0);
    if (u.shineOn != 0 || u.paintOn != 0 || u.groundShine != 0) {
        let sunSeen = markSeen * (1.0 - flatBank) * closeVis * faceSun;
        var damp=max(max(u.rock[rs & rockMask].faceWet*exposed*rockWet,painted.z*.85),wetFilm*.8);
        var shine = shineTerm(pixel, p, g, normal, material, exposed, slopeShare, crystalMask, sunSeen, landform, damp, mineralPatch, skin*(1.0-depositCover));
        // E9: the glints belong to the painted face; the small rock patches of ordinary hills keep this share of them.
        if (u.shineOutside < 1.0) { shine = vec4f(shine.xyz * mix(u.shineOutside, 1.0, smoothstep(0.4, 0.9, painted.x)), shine.w); }
        if (u.shineSlopeGate > 0.0) { shine = shineSlopeGated(shine, slope); }
        if (u.rock[rs & rockMask].iceFall > 0.0) { shine = vec4f(shine.xyz * (1.0 - 0.75 * u.rock[rs & rockMask].iceFall * iceFace), shine.w); }
        // A glint is the sun mirrored: it takes the sun's colour, not the sky's.
        color = surfaceSRGB(surfaceLinear(color)*shine.w+shine.xyz);
    }
    if (u.layerCrease > 0.0) { color *= 1.0 - u.layerCrease * layerCreaseTerm(p); }
    if (u.rock[rs & rockMask].pockmark > 0.0 && h > u.sea + 1.0 && landform > 0.0) {
        let pits = pockPits(pixel, u.rock[rs & rockMask].pockSize, u.rock[rs & rockMask].pockmark * mix(0.6, 1.0, turned));
        color *= 1.0 - pits * landform * mix(0.5, 0.92, turned);
    }
    if (u.rock[rs & rockMask].moonFolds > 0.0 && h > u.sea + 1.0) {
        // G8 (Moon): thin dark folds across the lit and moderate slopes.
        color *= 1.0 - 0.34 * u.rock[rs & rockMask].moonFolds * moonFolds(p, baseHeight(p), slope, u.rock[rs & rockMask].moonFoldSpacing);
    }
    if (u.rock[rs & rockMask].moonRibs > 0.0 && h > u.sea + 1.0) {
        // G8 (Moon): the shaded flank's strokes, on steep ground of every facing, more where turned from the sun.
        let wall = u.rock[rs & rockMask].moonRibs * smoothstep(0.15, 0.5, slope) * smoothstep(0.12, 0.5, turned);
        if (wall > 0.0) {
            let beforeRib = max(0.0, dot(normal, u.light));
            let afterRib = max(0.0, dot(normalize(vec3f(-(g + u.rock[rs & rockMask].moonRibDepth * moonRibs(pixel)), 1.0)), u.light));
            let strokes = clamp((u.ambient + 0.95 * afterRib * markSeen) / (u.ambient + 0.95 * beforeRib * markSeen), 0.3, 2.6);
            color *= mix(1.0, strokes * (1.0 - u.rock[rs & rockMask].moonRibDark * smoothstep(0.1, 0.55, turned)), wall);
        }
    }
    if (u.rock[rs & rockMask].moonCups > 0.0 && h > u.sea + 1.0 && landform > 0.0) {
        // G8 (Moon): lit cups, many on shaded steep faces, few on lit ground, none on the flat top. The
        // sun shades each one as it shades the face: the cup's wall turned from the sun goes dark, the
        // wall toward it keeps the face's light.
        let steep = smoothstep(0.08, 0.40, slope);
        let clump = 0.6 + 0.8 * (0.5 + 0.5 * wrinkleNoise(pixel / 38.0 + 5.0));
        let keep = min(u.rock[rs & rockMask].moonCups * mix(0.04, 1.0, smoothstep(0.1, 0.55, turned)) * steep * clump * landform, 1.0);
        if (keep > 0.0) {
            var cups: vec3f;
            if (u.rock[rs & rockMask].cupStretch > 1.0) {
                cups = cupStrokes(pixel, u.rock[rs & rockMask].moonCupSize, keep, u.rock[rs & rockMask].moonCupDepth, u.rock[rs & rockMask].cupStretch);
            } else {
                cups = moonCups(pixel, u.rock[rs & rockMask].moonCupSize, keep, u.rock[rs & rockMask].moonCupDepth);
            }
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
        // The tint and the shallow-to-deep step read the authored bed: its lumps (bedRelief) are art, lit by the sun,
        // and do not move the water's colour. The waterline below reads the drawn surface.
        let bedDepth = max(0.0, u.sea - baseHeight(p));
        // Sediment mottling varies apparent water colour without changing the
        // authored bed or the level water plane.
        var colorDepth = bedDepth;
        if (u.waterSoft > 0.0) {
            // Colour follows depth averaged over a disc: the authored bed
            // stays exact, but deep water fades in over a wider, uneven band.
            var sum = 0.0;
            for (var k = 0; k < 8; k++) {
                let a = f32(k) * 0.785398 + 0.3;
                let o = vec2f(cos(a), sin(a)) * u.waterSoft * (0.6 + 0.4 * f32(k % 2));
                sum += max(0.0, u.sea - baseHeight(p + o));
            }
            colorDepth = mix(bedDepth, sum / 8.0, 0.75);
        }
        var mottle = ((n.r - 0.5) * 14.0 + (n.g - 0.5) * 5.0) * smoothstep(2.0, 8.0, bedDepth);
        if (u.lowGrain < 1.0) { mottle *= lowGrain; }
        colorDepth += mottle;
        // Optional contour rings in the water colour, every 6 depth units.
        if (u.bandWater > 0.0) { colorDepth = mix(colorDepth, (floor(colorDepth / 6.0) + 0.5) * 6.0, u.bandWater * 0.7); }
        // A deep or shallow stroke's water choices (card E1), painted into the
        // masks: +1 hard, -1 faded, 0 the world's own.
        // The plane is bilinear, so a half threshold keeps a stroke's footprint
        // to within a pixel of where it was painted.
        let shoreHard = u.crispShore;
        var edgeHard = u.deepEdge;
        if (u.waterOn != 0) {
            let pick = sampleMasks(maskPoint(p),2).b;
            if (pick > 0.5) { edgeHard = 1.0; } else if (pick < -0.5) { edgeHard = 0.0; }
        }
        var deep = smoothstep(u.shallowDepth, u.deepDepth, colorDepth);
        if (edgeHard > 0.0) { deep = sharpDeepStep(p, pixel, bedDepth); }
        var grain = waterPigment(pixel) - waterMean();
        if (u.lowGrain < 1.0) { grain *= lowGrain; }
        // Colors choose the water's tint, never replace the bed-light model.
        var water=vec3f(0);
        {
            var deepWater = waterPigment(pixel);
            if (u.lowGrain < 1.0) { deepWater = waterMean() + grain; }
            // One bed model: the shallows are the ground under the water, lit by the same sun, seen through
            // the water's tint (retail draws its shallows as lit terrain through a tint). Shallows see the same
            // shaded voxel rock, beds and crusts as the exposed coast; soft ground is the level ground.
            let rockBedShare=clamp(exposed*faceGate,0.0,1.0);
            // E11 bedFlat: light the bed by its own relief only. A shelf's slope toward the deep
            // would otherwise shade the pale bed darker over a hundred px and read as blur.
            var bedShade = shading;
            // The rock under water is lit as the soft bed round it is: bedFlat takes the broad slope, its cast shadow and its occlusion out of the
            // rock's light too, and the rock keeps its own joints, crevices and close shadows.
            var rockShade = mix(shading, 1.0, flatBank);
            if (u.bedFlat > 0.0) {
                let own = normalize(vec3f(-(g - broad), 1.0));
                bedShade = mix(shading, min((u.ambient + 0.95 * max(0.0, dot(own, u.light))) / flatLight, u.lightCap), u.bedFlat);
                let ownRock = normalize(vec3f(-(-normal.xy / max(normal.z, 0.1) - broad), 1.0));
                let lit = min((u.ambient * (1.0 - cav) + 0.95 * max(0.0, dot(ownRock, u.light)) * closeVis * faceSun * (1.0 - 0.45 * cav)) / flatLight, u.lightCap);
                rockShade = mix(rockShade, mix(lit, 1.0, flatBank), u.bedFlat) / max(rockShade, 0.05);
            } else { rockShade = 1.0; }
            var bed=mix(levelGround*bedShade,color/max(lightTint,vec3f(.02))*rockShade,rockBedShare);
            // Cracked bed: the dried-mud seams darken the bed, so they read through the shallows and fade with them into the deep.
            if (u.bedCracks > 0.0) { bed = bed * (1.0 - 0.6 * u.bedCracks * bedCrackLine(p)); }
            let shallow=litBed(bed,rockBedShare,dot(material,vec3f(0.299,0.587,0.114)));
            // Depth absorption under a hard step: the bed's tint deepens toward the deep colour as the water gets deeper, so a
            // lake reads paler at its rim and darker toward the step, not one flat tone (a ramp already does this by itself).
            let absorbed = mix(shallow, deepWater, 0.3 * smoothstep(0.0, 0.5 * (u.shallowDepth + u.deepDepth), bedDepth) * select(0.0, 1.0, edgeHard > 0.0));
            water = mix(absorbed, deepWater, deep);
            // Some worlds' water passes through a third colour; a straight
            // blend of the two textures lands on colours the art never uses.
            if (u.waterMid.a > 0.0 && u.shallowBase.a < .5) {
                // A Shallow until depth past the third colour's depth runs this ramp down: the third colour at the waterline,
                // the lit bed between the two depths (a submerged shelf), deep beyond. smoothstep leaves reversed edges undefined.
                let toMid = waterRamp(u.shallowDepth, u.waterMid.a, colorDepth);
                let toDeep = smoothstep(u.waterMid.a, u.deepDepth, colorDepth);
                var mid = u.waterMid.rgb + (deepWater - waterMean()) * 0.9;
                if (lowShare > 0.0) { mid = mix(mid, lowTinted(mid, u.waterMid.rgb), lowShare); }
                water = mix(mix(shallow, mid, toMid), deepWater, toDeep);
            }
        }
        // Shared bed elevation makes a painted shallow passage persist even
        // far from shore; there is no fixed-width coastal blue collar.
        var submerged = smoothstep(-0.2, 2.8, depth);
        shoalWeight = (1.0 - deep) * submerged * select(0.0, 1.0, edgeHard > 0.0);
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
            if (u.shoalShoreSoft > 0.0) {
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
        if (u.chunkScale > 1.0) { fc = floor(vec2f(pixel.x, u.size - pixel.y)); }
        if (u.chunkScale < 1.0) { fc = floor(fragCoord / u.chunkScale); }
        // Card tilepool: the threshold repeats with the pool, as level ground does, so it does not make every tile of a plain differ.
        let ign = fract(52.9829189 * fract(dot(poolWrap(fc, u.pool), vec2f(0.06711056, 0.00583715))));
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
    // The Surface section's preview over the finished picture, in stripes so the picture shows between them: magenta where the layer it
    // names shows, cyan where it lies but a later layer covers it.
    if (u.diagnosticView == 13) {
        let cover = clamp(surfacePreviewCover, 0.0, 1.0);
        let seen = clamp(surfacePreviewSeen, 0.0, cover);
        let at = vec2u(max(floor(v.position.xy + u.chunkScreenOrigin / u.chunkScale), vec2f(0.0)));   // screen pixels, so tiles' stripes meet
        if ((at.x + at.y) % 6u < 2u && cover > 0.0) { color = mix(color, (vec3f(1.0, 0.1, 0.9) * seen + vec3f(0.1, 0.9, 1.0) * (cover - seen)) / cover, min(cover * 1.5, 1.0)); }
    }
    if (u.diagnosticView >= 8 && u.diagnosticView <= 12) {
        let slot=select(gs,u32(max(0,u.waterGround)),h<u.sea && u.waterGround>0);
        if(u.diagnosticView==8){color=materialRaw(p,slot);}
        if(u.diagnosticView==9){color=vec3f(clamp(.5+materialRelief(p,slot)/16.0,0.0,1.0));}
        if(u.diagnosticView==12){color=materialPigment(p,slot);}
    }
    if (u.diagnosticView == 7) { let code = bakedFields(p).b; color = vec3f(clamp(-code, 0.0, 1.0), clamp(code - 1.0, 0.0, 1.0), clamp(0.5 + bakedFields(p).r * 0.08, 0.0, 1.0) * 0.6); }
    if (probeHere) {
        probeOut[0] = 1.0; probeOut[1] = color.r; probeOut[2] = color.g; probeOut[3] = color.b; probeOut[4] = f32(gs); probeOut[5] = h - u.sea;
        for (var k = 0u; k < SURFACE_FACTS; k++) { probeOut[6u + k] = surfaceFacts[k]; }
        probeOut[20] = lowShare; probeOut[21] = nearWater; probeOut[22] = surfCover; probeOut[23] = select(0.0, 1.0, ownGround); probeOut[24] = f32(probeCount);
    }
    return vec4f(color, 1.0);
}

#endif
