// H8: the bridge. Per-world draw code that the engine draw dropped when it kept only Green's side of the shared draw
// (sculpt-frag.wgsl), put back so every world draws on the engine. It is appended to engine-frag.wgsl.
// Rules (TERRAIN_ENGINE "Bridges are separate and counted"):
//  - every block is gated by a uniform that already exists, never by a world;
//  - the images it reads are the world's prepared images, written into the generated array texture by the renderer
//    (sculpt-renderer.js, the bridge): layer 0 slope grass, 1 rock, 2 weathered, 3 fractured, 4 fringe, 5 transition body, 6 beach,
//    7 mineral ring. A world whose materials are numbers (a materials table) writes none of them and takes no block here;
//  - each block names the feature card that replaces it, and the card deletes the block.

// Layer 7 is the last; fetched like the engine's own generated materials (genColor, engine-frag.wgsl).
var<private> bTransGround: vec3f;
var<private> bTransFace: vec3f;
var<private> bTransLow: vec3f;
var<private> bTransPower: f32;
var<private> bTransCore: f32;
var<private> bTransShared: bool;

// Replaced by: Materials (the plain's quilted ground becomes a generated material).
// A world whose plain is one quilted image (ground texture mode) reads it directly; the 16-tile plain stays in groundTile.
fn bridgeGround(pixel: vec2f) -> vec3f { return pixelSample(grassTex, grassSamp, pixel, vec2f(512.0)).rgb; }

// Replaced by: Materials (the ground image becomes a generated material, as Green's slope grass already is).
fn bridgeGrassImage(pixel: vec2f) -> vec3f { return pixelSample(grassTex, grassSamp, pixel, vec2f(512.0)).rgb; }

// Replaced by: Shores (beach sand is a shore material). The lightest of the ground and the beach: snow takes the beach when it is lighter.
fn bridgeSnow(pixel: vec2f, snow: ptr<function, vec3f>, mean: ptr<function, vec3f>) {
    const luma = vec3f(0.299, 0.587, 0.114);
    let beachMean = select(u.beachTexMean, u.beachBase.rgb, u.beachBase.a > 0.5);
    if (u.beach != 0 && dot(beachMean, luma) > dot(*mean, luma)) {
        *snow = based(genColor(6, pixel), u.beachTexMean, u.beachBase);
        *mean = beachMean;
    }
}

// Replaced by: Shores. Beach sand is lit as sand.
fn bridgeBeachSand(p: vec2f, sand: f32) -> f32 {
    if (u.beach != 0) { return max(sand, smoothstep(0.25, 0.75, beachField(p))); }
    return sand;
}

// Replaced by: Shores. Painted sand keeps a raised bar sand to its crown (sand bars; 0 where the knob is 0).
fn bridgeSandBar(p: vec2f) -> f32 {
    if (u.sandCrown <= 0.0) { return 0.0; }
    return u.sandCrown * smoothstep(0.15, 0.6, max(-bakedFields(p).a, 0.0));
}

// Replaced by: Bodies (ice slabs). Slate faces: all face, all rock, and no snow lumps in them.
fn bridgeSlateFace(face: f32, share: f32, faceSlope: f32, route: f32, sandBar: f32) -> vec2f {
    if (u.iceSlate <= 0.0) { return vec2f(face, share); }
    return vec2f(max(face, smoothstep(0.12, 0.3, faceSlope) * (1.0 - route) * (1.0 - sandBar) * u.iceSlate), mix(share, 1.0, u.iceSlate));
}
fn bridgeSlateRock(rockMask: f32, lowGate: f32) -> f32 {
    if (u.iceFall <= 0.0) { return rockMask; }
    return mix(rockMask, lowGate, u.iceFall * u.iceSlate);
}

// Replaced by: Layered rock (mineral margins are the beds' crown and foot) and Materials (the fringe and ring images).
// Mineral margins: nearby fractured slopes feed outcrops into their level crown and foot, with the fringe, ring veins and the
// sediment transition of Red, Painted Desert and Archipelago. It edits the slope cover and, for the shared transition, the
// private state that bridgeTransition finishes.
fn bridgeMargins(p: vec2f, h: f32, slope: f32, n: vec4f, pixel: vec2f, grass: vec3f, sediments: vec4f, brokenSediments: vec4f,
                 materialWeather: f32, fringeVariation: f32, slopeGrass: ptr<function, vec3f>, slopeCover: ptr<function, f32>) {
    bTransGround = grass; bTransFace = grass; bTransLow = grass; bTransPower = 1.0; bTransCore = 0.0; bTransShared = false;
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
        bTransGround = mix(grass, ring, ringWeight);
        var warm = smoothstep(0.02, 0.54, source);
        let warmGrain = 0.52 - dot(body, vec3f(0.299, 0.587, 0.114));
        warm = clamp(warm + warmGrain * 0.5 * 4.0 * warm * (1.0 - warm), 0.0, 1.0);
        bTransGround = mix(bTransGround, body, warm);
        if (u.ringShift > 0.0) { bTransGround = fringeCopies(bTransGround, p, sediments.b); }
        else {
            let contours = fringeContours(p, sediments.b);
            bTransGround = mix(bTransGround, contours.rgb, contours.a);
        }
        if (u.transitionDetail > 0.0) {
            let uv = pixel / 512.0;
            let groundLow = textureSampleLevel(grassTex, grassSamp, uv, 3.0).rgb;
            let ringLow = textureSampleLevel(generatedTex, linearRepeat, uv, 7, 3.0).rgb;
            let bodyLow = textureSampleLevel(generatedTex, linearRepeat, uv, 5, 3.0).rgb;
            bTransLow = mix(mix(groundLow, ringLow, ringWeight), bodyLow, warm);
            bTransPower = ((1.0 - ringWeight) * (1.0 - ringWeight) + ringWeight * ringWeight) * (1.0 - warm) * (1.0 - warm) + warm * warm;
        }
        bTransFace = face;
        bTransCore = smoothstep(0.23, 0.88, source);
        let faceGrain = 0.35 - dot(face, vec3f(0.299, 0.587, 0.114));
        bTransCore = clamp(bTransCore + faceGrain * 0.35 * 4.0 * bTransCore * (1.0 - bTransCore), 0.0, 1.0);
        bTransShared = true;
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

// Replaced by: Shores. Beach sand within reach of the water (baked), or failing that a low band above the waterline; its inland edge is
// ragged and breaks into grains, and steep banks stay bare.
fn bridgeBeach(material: vec3f, p: vec2f, pixel: vec2f, h: f32, slope: f32, slopeShare: f32, exposed: f32) -> vec3f {
    if (u.beach == 0 || h <= u.sea - 1.0) { return material; }
    let sandBeach = based(genColor(6, pixel), u.beachTexMean, u.beachBase);
    let speck = terrainNoise(p * 6.0 + vec2f(61.0, 3.0)).b;
    var beach = smoothstep(0.25, 0.75, beachField(p) + (speck - 0.5) * 0.5);
    let top = u.beachHeight * u.beachWidth * (0.65 + 0.7 * terrainNoise(p * 0.45 + vec2f(29.0, 5.0)).g);
    // The low band only within the water's reach: inland hollows of a low world are not beaches.
    beach = max(beach, (1.0 - smoothstep(top * 0.6, top, h - u.sea + (speck - 0.5) * 1.5)) * (1.0 - smoothstep(0.7, 1.3, slope)) * smoothstep(0.0, 0.15, beachField(p)));
    // A sandy slope keeps its own streaked material over the beach sand.
    if (u.slopeSand != 0) { beach *= 1.0 - slopeShare; }
    return mix(material, sandBeach, beach * (1.0 - exposed * 0.7));
}

// Replaced by: Layered rock and Materials, with bridgeMargins. The shared transition's one join to warm mineral and sand: exposed rock
// belongs inside the face family and cannot repaint a second hard perimeter.
fn bridgeTransition(material: vec3f, pixel: vec2f, rock: vec3f, exposed: f32, materialWeather: f32) -> vec3f {
    if (!bTransShared) { return material; }
    let face = mix(bTransFace, rock, exposed);
    var refined = mix(bTransGround, face, bTransCore);
    if (u.transitionDetail > 0.0) {
        let uv = pixel / 512.0;
        let faceLow = textureSampleLevel(generatedTex, linearRepeat, uv, 0, 3.0).rgb;
        var rockLow = textureSampleLevel(generatedTex, linearRepeat, uv, 1, 3.0).rgb;
        rockLow = saturate(u.rockMean + (rockLow - u.rockMean) * u.mineralDetail);
        let low = mix(bTransLow, mix(faceLow, rockLow, exposed), bTransCore);
        let facePower = (1.0 - exposed) * (1.0 - exposed) + exposed * exposed;
        let power = bTransPower * (1.0 - bTransCore) * (1.0 - bTransCore) + facePower * bTransCore * bTransCore;
        // Mixing independent native grains reduces their variance. Recover only the local detail; the accepted broad colour join stays put.
        let gain = mix(1.0, min(1.65, inverseSqrt(max(0.1, power))), u.transitionDetail);
        refined = low + (refined - low) * gain;
    }
    return mix(material, refined, materialWeather);
}
