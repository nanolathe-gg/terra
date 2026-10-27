#version 300 es
precision highp float;
precision highp int;
#define BAKE
/*COMMON*/
// Fall-line relief, baked once per height change at one texel per world
// pixel. Authored appearance detail: it is lit, never exported as height.
//
// Each octave sums oriented cosine kernels from jittered cell points. The
// kernels' wavefronts run down the local fall line, so the sum forms ribs
// and gullies that follow the slope. Later octaves turn toward the gullies
// of earlier ones, so channels branch. The kernel construction follows the
// public "eroded terrain noise" shader technique (clayjohn; Fewes); the
// scales and gains here are this prototype's own choices.
uniform float uReliefScale;    // wavelength of the first octave, world px
uniform float uReliefAmount;   // height per unit slope per wavelength
uniform float uReliefBranch;   // how strongly octaves follow earlier gullies
uniform float uReliefLumps;    // share of isotropic lumps mixed in
uniform int uReliefOctaves;
uniform float uReliefGain;      // amplitude ratio between octaves
uniform float uReliefWarp;      // domain warp, world px
uniform float uReliefPatchy;    // spatial variation of relief strength
uniform float uReliefJitter;    // per-kernel phase and wavelength variation
uniform float uGentleRelief;    // relief on gentle slopes
uniform float uBoulderDensity;   // 0 disables boulders
uniform float uBoulderSize;      // typical diameter, world px
uniform float uBoulderFoot;      // share of boulders sourced from cliff feet
uniform float uBoulderCluster;   // how strongly boulders gather into fields
uniform float uBoulderMoss;      // share of stones with mossy tops
uniform float uDebris;           // 0 disables debris
uniform float uDebrisReach;      // how far debris tumbles, world px
uniform float uDebrisSize;       // largest debris stone, world px
uniform float uDebrisSort;       // 1: coarse near the source, fine far away
uniform float uRepose;           // slope below which debris comes to rest
uniform float uSand;             // 0 disables sand
uniform float uCrackSeverity;    // crack depth
uniform float uCrackWidth;       // crack core width, world px
uniform float uCrackJagged;      // kinks and bends along a crack
uniform float uCrackNetwork;     // 0: rills down the slope; 1: polygonal plates
uniform float uCrackReach;       // 0: steep faces only; 1: onto gentle slopes
uniform int uCracksOn;           // the full bake computes cracks; previews skip them
uniform float uPlainRelief;      // faint lit lumps on level ground (appearance only)
uniform float uCrackSpacing;     // major crack block size, world px
uniform float uCrackLength;      // elongation of crack cells along the fall line
uniform float uWindAngle;        // direction the wind blows toward, degrees (0 = east)
uniform float uRipple;           // ripple wavelength, world px (0: none)
uniform float uRippleHeight;     // ripple amplitude, height units
uniform float uBeachDistance;    // beach reach from the waterline, world px (0: none)
uniform float uBanding;          // contour banding strength (0: none)
uniform bool uHasBeach;
uniform float uSandBanding, uSandBandSpacing; // streaks on sand and ramps           // the world has beach-sand art: painted sand uses it
uniform float uApron;            // sand apron reach round raised ground, world px (0: none)
uniform float uWorms;            // wormy regolith relief on slopes (lunar)
uniform float uBoulderRound;     // 0: angular boulders; 1: rounded domes
uniform float uBandSpacing;      // height between bands, height units
uniform float uBandSoftness;     // share of each band that is riser
uniform float uBandLine;         // darkness of the line along each riser
uniform int uBandStyle;          // 0 tonal steps (Green), 1 bank lines (Lava)
out vec4 outFields;

const float TAU = 6.28318530718;

vec2 cellHash(vec2 c) {
    vec2 q = vec2(dot(c, vec2(127.1, 311.7)), dot(c, vec2(269.5, 183.3)));
    return fract(sin(q) * 43758.5453);
}

// Returns (value, d/dx, d/dy) in the octave's own coordinates.
vec3 gullies(vec2 q, vec2 dir) {
    vec2 cell = floor(q), local = fract(q);
    vec3 sum = vec3(0.0);
    float weight = 0.0;
    for (int j = -2; j <= 1; j++) for (int i = -2; i <= 1; i++) {
        vec2 o = vec2(i, j);
        vec2 jitter = cellHash(cell - o);
        vec2 point = local + o - jitter * 0.5;
        float w = exp(-dot(point, point) * 2.0);
        // A random phase and wavelength per kernel keep ribs on a straight
        // face from settling into evenly spaced teeth.
        vec2 extra = cellHash(cell - o + 91.7);
        float freq = TAU * mix(1.0, 0.6 + 0.9 * extra.x, uReliefJitter);
        float phase = dot(point, dir) * freq + extra.y * TAU * uReliefJitter;
        sum += vec3(cos(phase), -sin(phase) * dir * freq) * w;
        weight += w;
    }
    return sum / weight;
}


float valueNoise(vec2 q) {
    vec2 c = floor(q), f = fract(q);
    vec2 u = f * f * (3.0 - 2.0 * f);
    float a = cellHash(c).x, b = cellHash(c + vec2(1, 0)).x;
    float d = cellHash(c + vec2(0, 1)).x, e = cellHash(c + vec2(1, 1)).x;
    return mix(mix(a, b, u.x), mix(d, e, u.x), u.y) * 2.0 - 1.0;
}

// Height of the tallest boulder at p (0 if none) and its rock coverage.
vec2 boulders(vec2 p, float slope, float h) {
    if (uBoulderDensity <= 0.0) return vec2(0.0);
    float cellSize = uBoulderSize * 1.6;
    vec2 cell = floor(p / cellSize);
    float best = 0.0, cover = 0.0;
    for (int j = -1; j <= 1; j++) for (int i = -1; i <= 1; i++) {
        vec2 c = cell + vec2(i, j);
        vec2 r1 = cellHash(c + 31.7), r2 = cellHash(c + 77.1);
        vec2 centre = (c + 0.2 + 0.6 * r1) * cellSize;
        // Where boulders come from: anywhere on sloped ground, or gathered
        // at cliff feet where the weathering pass found talus support.
        float talus = texture(uWeather, centre / (uSize - 1.0)).b;
        float slopeAt = length(broadGradient(centre));
        float scattered = smoothstep(0.15, 0.7, slopeAt) * (1.0 - smoothstep(1.6, 2.6, slopeAt));
        vec2 up = slopeAt > 1e-4 ? -broadGradient(centre) / slopeAt : vec2(0.0);
        float cliffAbove = smoothstep(0.9, 1.6, length(broadGradient(centre - up * 14.0)));
        float foot = max(smoothstep(0.02, 0.25, talus), cliffAbove * (1.0 - smoothstep(0.5, 1.0, slopeAt)));
        float source = mix(scattered, foot, uBoulderFoot);
        float field = smoothstep(0.35, 0.75, valueNoise(centre / 120.0 + 9.0) * 0.5 + 0.5);
        float chance = uBoulderDensity * source * mix(1.0, field * 2.0, uBoulderCluster);
        if (r2.x > chance) continue;
        if (routeProtection(centre) > 0.05 || baseHeight(centre) < uSea + 1.0) continue;
        // Many small stones and few large ones.
        float radius = uBoulderSize * (0.18 + 0.82 * r2.y * r2.y * r2.y);
        // Angular outline: the largest of three rotated plane distances.
        vec2 q = p - centre;
        float a = r1.x * 6.2831;
        mat2 rot = mat2(cos(a), -sin(a), sin(a), cos(a));
        q = rot * q;
        float edge = mix(max(max(abs(q.x) * 0.9, abs(q.y)), abs(q.x * 0.6 + q.y * 0.8)), length(q * vec2(1.0, 1.15)), uBoulderRound) / radius;
        float lift = max(0.0, 1.0 - edge * edge);
        // Partly buried: the ground cuts each stone below its widest point.
        float buried = mix(0.15, 0.55, fract(r1.x * 7.31));
        float height = max(0.0, sqrt(lift) - buried) / (1.0 - buried) * radius * (0.55 + 0.35 * r1.y);
        if (height > best) { best = height; cover = smoothstep(0.0, 0.25, height / max(radius, 1.0)) * (fract(r2.x * 13.7) < uBoulderMoss ? 0.55 : 1.0); }
    }
    return vec2(best, cover);
}

// Debris arriving at p: walk uphill along steepest ascent and gather what
// steep ground above sheds. Returns (amount, mean travelled fraction).
vec2 debrisArrival(vec2 p, float slope) {
    if (uDebris <= 0.0) return vec2(0.0);
    float rest = 1.0 - smoothstep(uRepose * 0.7, uRepose * 1.3, slope);
    vec2 q = p;
    float amount = 0.0, travelled = 0.0, weight = 0.0;
    const int STEPS = 14;
    float step = uDebrisReach / float(STEPS);
    vec2 dir = vec2(0.0);
    for (int i = 1; i <= STEPS; i++) {
        // Level ground below a face has no local gradient: look wider, then
        // keep the last direction, so debris can reach the plain.
        vec2 g = broadGradient(q);
        if (length(g) < 0.05) {
            const float e = 18.0;
            g = vec2(baseHeight(q + vec2(e, 0)) - baseHeight(q - vec2(e, 0)),
                     baseHeight(q + vec2(0, e)) - baseHeight(q - vec2(0, e))) / (2.0 * e);
        }
        if (length(g) > 0.01) dir = normalize(g);
        if (dot(dir, dir) < 0.5) break;
        q += dir * step;
        float d = float(i) * step;
        float shed = smoothstep(0.9, 1.7, length(broadGradient(q))) * (1.0 - routeProtection(q));
        float w = shed * (1.0 - d / uDebrisReach);
        amount += w; travelled += w * d / uDebrisReach; weight += w;
    }
    return vec2(amount / float(STEPS) * 3.0 * rest, weight > 0.0 ? travelled / weight : 1.0);
}

vec2 debrisStones(vec2 p, vec2 arrival) {
    // Stones on a fine cell grid; presence from arrivals, size from distance.
    float cellSize = max(3.0, uDebrisSize * 0.9);
    vec2 cell = floor(p / cellSize);
    float best = 0.0, cover = 0.0;
    for (int j = -1; j <= 1; j++) for (int i = -1; i <= 1; i++) {
        vec2 c = cell + vec2(i, j);
        vec2 r1 = cellHash(c + 5.3), r2 = cellHash(c + 61.9);
        vec2 centre = (c + 0.15 + 0.7 * r1) * cellSize;
        vec2 here = debrisArrival(centre, length(broadGradient(centre)));
        if (r2.x > clamp(here.x * uDebris, 0.0, 0.95)) continue;
        if (baseHeight(centre) < uSea + 1.0) continue;
        float sizeAt = mix(1.0, 1.0 - 0.75 * here.y, uDebrisSort);
        float radius = uDebrisSize * 0.5 * sizeAt * (0.5 + 0.5 * r2.y);
        vec2 q = p - centre;
        float a = r1.y * 6.2831;
        q = mat2(cos(a), -sin(a), sin(a), cos(a)) * q;
        float edge = max(max(abs(q.x), abs(q.y) * 1.15), abs(q.x * 0.7 - q.y * 0.7)) / max(radius, 0.5);
        float lift = max(0.0, 1.0 - edge);
        float height = lift * radius * 0.7;
        if (height > best) { best = height; cover = smoothstep(0.0, 0.3, lift); }
    }
    return vec2(best, cover);
}

// Cracks, as a fractured surface rather than lines drawn on it. Three
// nested cellular networks, as retail rock and Gaea's eroded surfaces show:
//  - major cracks bound blocks; cells stretch down the fall line, so most
//    run down the slope, and on gentle ground only these reach;
//  - minor cracks split each block. Their lattice is turned and shifted per
//    block, so they end against the block's major cracks (T-junctions)
//    instead of crossing them;
//  - hairline crazing splits each minor block the same way.
// Blocks step and tilt a little against each other on rocky ground, which
// gives the surface its depth. A crack's core is dark; the wall facing the
// sun is lit and the other is in shadow.
mat2 turn(float a) { float c = cos(a), s = sin(a); return mat2(c, s, -s, c); }

struct Crack { vec2 id; vec2 point; float dist; vec2 normal; float open; };

// One level. q is the level's own domain (world px, perhaps turned per
// parent block); fall is the local fall line in that domain. Cells stretch
// along it. Finds the nearest cell, then the nearest *open* edge of that
// cell: its distance (world px), outward normal and openness. Each edge (a
// pair of cells) is open or not by its own hash against the share; edges
// across the slope stay closed unless network is high.
Crack fractureLevel(vec2 q, vec2 fall, float cell, float stretch, float share, float network, float salt) {
    Crack r;
    r.dist = 1e9; r.open = 0.0; r.normal = vec2(0.0);
    vec2 across = vec2(-fall.y, fall.x);
    vec2 g = floor(q / cell);
    int reach = int(ceil(stretch)) + 1;
    float best = 1e9;
    for (int j = -4; j <= 4; j++) for (int i = -4; i <= 4; i++) {
        if (abs(i) > reach || abs(j) > reach) continue;
        vec2 c = g + vec2(i, j);
        vec2 point = (c + 0.1 + 0.8 * cellHash(c + salt)) * cell;
        vec2 d = point - q;
        vec2 m = vec2(dot(d, fall) / stretch, dot(d, across));
        float dist = dot(m, m);
        if (dist < best) { best = dist; r.id = c; r.point = point; }
    }
    if (share <= 0.0) return r;
    vec2 ma = vec2(dot(r.point - q, fall) / stretch, dot(r.point - q, across));
    for (int j = -4; j <= 4; j++) for (int i = -4; i <= 4; i++) {
        if (abs(i) > reach || abs(j) > reach) continue;
        vec2 c = g + vec2(i, j);
        if (c == r.id) continue;
        vec2 point = (c + 0.1 + 0.8 * cellHash(c + salt)) * cell;
        vec2 mb = vec2(dot(point - q, fall) / stretch, dot(point - q, across));
        vec2 n = mb - ma;
        float len = length(n);
        if (len < 1e-4) continue;
        n /= len;
        // The bisector seen in the world: normal (n.x / stretch, n.y) in the
        // (fall, across) basis; the pixel sits at the origin.
        vec2 seen = vec2(n.x / stretch, n.y);
        float d = dot(0.5 * (ma + mb), n) / length(seen);
        if (d > r.dist) continue;
        vec2 worldNormal = normalize(fall * seen.x + across * seen.y);
        float acrossSlope = abs(dot(worldNormal, fall));
        float keep = 1.0 - smoothstep(mix(0.45, 1.05, network), mix(0.65, 1.25, network), acrossSlope);
        vec2 lo = min(r.id, c), hi = max(r.id, c);
        float ticket = cellHash(lo * 1.31 + hi * 7.77 + salt + 0.5).x;
        float open = keep * smoothstep(ticket - 0.06, ticket + 0.06, share);
        if (open <= 0.01) continue;
        r.dist = d; r.open = open; r.normal = worldNormal;
    }
    return r;
}

// Crack shading at a pixel from one level: (dark, lit). The core is dark;
// just outside it, the wall on this side is lit if it faces the sun, else
// in shadow. Width in world px.
vec2 crackShade(Crack c, float width, vec2 sun, float wall) {
    if (c.open <= 0.0) return vec2(0.0);
    float half_ = width * 0.5;
    float core = 1.0 - smoothstep(half_ - 0.45, half_ + 0.45, c.dist);
    float side = (smoothstep(half_ - 0.3, half_ + 0.3, c.dist) - smoothstep(half_ + 0.7, half_ + 1.5, c.dist)) * wall;
    // This pixel's wall descends toward the crack, along +normal.
    float facing = dot(c.normal, sun);
    float lit = side * smoothstep(0.1, 0.6, facing);
    float shadow = side * smoothstep(0.1, 0.6, -facing) * 0.7;
    return vec2(max(core, shadow), lit) * c.open;
}

uniform vec3 uSun;            // the renderer's light, for lit crack walls
uniform float uCrackMinor;    // share of minor cracks inside blocks
uniform float uCrackHairline; // share of hairline crazing
uniform float uCrackBlocks;   // how far blocks step and tilt against each other
uniform float uCrackMajor;    // share of major cracks

// Returns (carved depth, dark, lit, block relief).
vec4 cracks(vec2 p, vec2 fall, float slope, float mask, float h) {
    if (uCracksOn == 0 || mask <= 0.0 || uCrackSeverity <= 0.0 || h < uSea + 1.0) return vec4(0.0);
    float start = mix(0.95, 0.10, uCrackReach);
    // Rocky ground takes the whole hierarchy; gentle ground only majors.
    float rocky = smoothstep(start, start * 1.9, slope);
    float gentle = smoothstep(start * 0.35, start * 1.1, slope);
    if (gentle <= 0.0) return vec4(0.0);
    vec2 sun = normalize(uSun.xy);
    float major = uCrackSpacing, minorCell = major / 3.2, hairCell = max(3.0, major / 9.0);
    // Shared warp: every level bends with the rock.
    vec2 w = p + uCrackJagged * major * (0.30 * vec2(valueNoise(p / (major * 1.3) + 1.7), valueNoise(p / (major * 1.3) + 20.8))
                                      + 0.07 * vec2(valueNoise(p / (major * 0.16) + 5.0), valueNoise(p / (major * 0.16) + 9.4)));
    // The shape's Cracks amount sets how cracked it is; the knobs set the
    // share of each level at full strength.
    float m = smoothstep(0.0, 0.5, clamp(mask, 0.0, 1.0));
    Crack c0 = fractureLevel(w, fall, major, uCrackLength, m * gentle * uCrackMajor, uCrackNetwork, 3.7);
    // Minor lattice turned and shifted per major block.
    vec2 h0 = cellHash(c0.id + 11.1);
    mat2 r0 = turn(h0.x * TAU);
    vec2 q1 = r0 * w + h0 * minorCell * 7.0 + uCrackJagged * minorCell * 0.25 * vec2(valueNoise(p / (minorCell * 0.5) + 2.2), valueNoise(p / (minorCell * 0.5) + 6.6));
    // Minor cracks also break gentle slopes, more sparsely (retail hill
    // slopes carry short cracks every 10 px or so).
    Crack c1 = fractureLevel(q1, r0 * fall, minorCell, 1.0 + (uCrackLength - 1.0) * 0.4, m * mix(0.5, 1.0, rocky) * gentle * uCrackMinor, 1.0, 9.1);
    c1.normal = transpose(r0) * c1.normal;
    vec2 h1 = cellHash(c1.id + c0.id * 0.37 + 23.3);
    mat2 r1 = turn(h1.x * TAU);
    vec2 q2 = r1 * q1 + h1 * hairCell * 5.0;
    Crack c2 = fractureLevel(q2, r1 * r0 * fall, hairCell, 1.0, m * mix(0.4, 1.0, rocky) * gentle * uCrackHairline, 1.0, 21.7);
    c2.normal = transpose(r1 * r0) * c2.normal;
    // Shading: majors widest, hairlines a single soft dark pixel.
    float width = uCrackWidth;
    vec2 s0 = crackShade(c0, width * 1.25 * mix(0.6, 1.0, rocky), sun, 1.0);
    vec2 s1 = crackShade(c1, width * 0.9 * mix(0.8, 1.0, rocky), sun, 0.8);
    vec2 s2 = crackShade(c2, width * 0.55, sun, 0.0) * vec2(0.6, 0.0);
    float dark = max(s0.x, max(s1.x, s2.x)), lit = max(s0.y, s1.y) * (1.0 - dark);
    // A modest V for majors and minors, so the cracks also shade at scale.
    float carve = c0.open * max(0.0, 1.0 - c0.dist / (width * 0.6 + 1.2)) * mix(0.8, 3.0, uCrackSeverity) * mix(0.5, 1.0, rocky)
                + c1.open * max(0.0, 1.0 - c1.dist / (width * 0.45 + 0.9)) * mix(0.4, 1.5, uCrackSeverity);
    // Blocks step and tilt against each other on rocky ground.
    vec2 b0 = cellHash(c0.id + 5.5) - 0.5, t0 = cellHash(c0.id + 8.8) - 0.5;
    vec2 b1 = cellHash(c1.id + c0.id + 2.9) - 0.5, t1 = cellHash(c1.id + c0.id + 4.4) - 0.5;
    // Each block is a tilted plane, as retail rock's lit angular facets
    // are: majors step and lean a little, minors tilt more (tilts are in
    // slope units, so each facet catches the light differently).
    // Tilts are measured in each level's own domain (the minor lattice is
    // turned and shifted), from the block's own point.
    float blocks = b0.x * mix(1.0, 3.0, uCrackSeverity) + dot(t0, w - c0.point) * 0.25
                 + (b1.x * mix(0.6, 1.6, uCrackSeverity) + dot(t1, q1 - c1.point) * 0.9) * step(0.01, uCrackMinor);
    // Like the relief, block steps grow with the slope.
    blocks *= uCrackBlocks * rocky * m;
    return vec4(carve, dark, lit, blocks);
}

// Beach: dry ground within reach of the water, as the world's coast
// sections show (Zhon: sand runs ~180 px inland). The reach varies along the
// coast and its inland edge is ragged. Distance to water is found by
// marching outward in 16 directions.
float beachCover(vec2 p, float h, float slope) {
    if ((uBeachDistance <= 0.0 && uApron <= 0.0) || h <= uSea) return 0.0;
    float vary = 0.45 + 0.9 * (valueNoise(p / 90.0 + 31.0) * 0.5 + 0.5);
    float reach = uBeachDistance * vary, apron = uApron * vary;
    float far = max(reach, apron) * 1.15;
    float nearWater = 1e9, nearRise = 1e9;
    for (int k = 0; k < 16; k++) {
        float a = float(k) * 0.3926991 + 0.2;
        vec2 dir = vec2(cos(a), sin(a));
        for (int r = 1; r <= 8; r++) {
            float d = far * float(r) / 8.0;
            if (d >= min(nearWater, nearRise)) break;
            float there = baseHeight(p + dir * d);
            bool water = there < uSea && d <= reach * 1.15;
            // A sand apron gathers round raised rock (Zhon's domes).
            bool rise = there > h + 6.0 && d <= apron * 1.15;
            if (!water && !rise) continue;
            // Refine the crossing between this step and the last, so the
            // band's edge is smooth rather than notched by the step.
            float lo = far * float(r - 1) / 8.0, hi = d;
            for (int b = 0; b < 4; b++) {
                float mid = 0.5 * (lo + hi), t = baseHeight(p + dir * mid);
                if (water ? t < uSea : t > h + 6.0) hi = mid; else lo = mid;
            }
            if (water) nearWater = hi; else nearRise = hi;
            break;
        }
    }
    float jitter = (valueNoise(p / 9.0 + 17.0) * 0.5);
    float beach = uBeachDistance > 0.0 ? 1.0 - smoothstep(reach * 0.88, reach, nearWater + jitter * reach * 0.12) : 0.0;
    float sandApron = uApron > 0.0 ? 1.0 - smoothstep(apron * 0.8, apron, nearRise + jitter * apron * 0.2) : 0.0;
    return max(beach, sandApron) * (1.0 - smoothstep(0.9, 1.5, slope));
}

// Contour bands, as in retail maps rendered from height-banded terrain:
// the ground steps in shallow terraces of uBandSpacing height units, so thin
// wavy lines follow the contours (measured on retail Green: median step 3.7,
// lines 10-20 px apart on gentle slopes, tight rings round lakes). Each
// riser carries a thin dark line; the lines wander and break into dashes.
// Returns (height offset, line strength, facing: +1 lit riser, -1 shaded).
// Retail lines are tonal steps, not drawn lines: a riser facing the sun is
// a light line and one facing away a dark one; they are jagged at pixel
// scale, broken into dashes, and mostly on gentle slopes (blind round 7).
vec3 contourBands(vec2 p, float h, float slope, vec2 fall) {
    if (uBanding <= 0.0 || h < uSea + 0.5) return vec3(0.0);
    float gate = smoothstep(0.07, 0.18, slope) * (1.0 - smoothstep(0.35, 0.75, slope));
    if (gate <= 0.0) return vec3(0.0);
    float S = uBandSpacing;
    float u = (h + valueNoise(p / 34.0 + 7.0) * S * 0.55 + valueNoise(p / 11.0 + 3.0) * S * 0.15
                 + valueNoise(p / 3.3 + 19.0) * S * 0.06 * min(1.0, 0.3 / max(slope, 0.05))) / S;
    float v = fract(u), w = clamp(uBandSoftness, 0.05, 1.0);
    float offset = S * (floor(u) + smoothstep(1.0 - w, 1.0, v)) - u * S;
    float dash = smoothstep(-0.55, 0.05, valueNoise(p / 22.0 + 51.0)) * smoothstep(-0.7, -0.1, valueNoise(p / 6.0 + 33.0))
               * (0.55 + 0.45 * (valueNoise(p / 70.0 + 9.0) * 0.5 + 0.5));
    float strength = uBanding * gate * dash;
    // Distance from the riser's middle, in world px along the slope.
    float px = abs(v - (1.0 - w * 0.5)) * S / max(slope, 0.02);
    float line = (1.0 - smoothstep(0.3, 1.0, px)) * strength * uBandLine;
    // The riser leans downhill (-fall): lit if that faces the sun.
    float facing = dot(-fall, normalize(uSun.xy + 1e-6));
    return vec3(offset * strength, line, facing);
}

// Sand streaks, as on Zhon's sandy slopes and ramps: fine continuous lines
// along the contours, a few px apart, curving with the ground (retail ramp
// sections). Tonal only: a dark line, deeper where the slope faces away
// from the sun. Returns (line strength, facing).
vec2 sandStreaks(vec2 p, float h, float slope, vec2 fall, float strength) {
    float gate = smoothstep(0.03, 0.10, slope) * (1.0 - smoothstep(0.8, 1.4, slope));
    if (gate <= 0.0 || strength <= 0.0) return vec2(0.0);
    float S = max(uSandBandSpacing, 0.2);
    float u = (h + valueNoise(p / 55.0 + 3.0) * S * 2.2 + valueNoise(p / 14.0 + 11.0) * S * 0.45) / S;
    float v = fract(u);
    float px = min(v, 1.0 - v) * S / max(slope, 0.02);
    float line = (1.0 - smoothstep(0.35, 1.2, px)) * strength * gate
               * (0.7 + 0.3 * smoothstep(-0.6, 0.2, valueNoise(p / 15.0 + 61.0)));
    return vec2(line, dot(-fall, normalize(uSun.xy + 1e-6)));
}

// Lava bank lines (retail section-built Lava maps, measure/lava_*.py):
// continuous braided dark lines along the contours, spaced by distance on
// the ground rather than by a fixed height step (about 10 (s/0.5)^-0.3 px
// at broad slope s), from slope 0.15 up with no upper limit, denser and
// darker on steep ground; a dark V 3 px wide at half depth (5-6 px on steep
// shaded faces), dark on every facing, no light lines. The broad slope sets
// the step, so neighbouring lines converge and merge where it changes.
// Returns (line strength, facing).
vec2 lavaLines(vec2 p, float h, float slope, vec2 fall) {
    if (uBanding <= 0.0 || h < uSea + 0.5 || slope < 0.12) return vec2(0.0);
    // Broad slope of the dry land only: the lava bed would steepen a bank.
    vec2 broad = vec2(max(baseHeight(p + vec2(16.0, 0.0)), uSea) - max(baseHeight(p - vec2(16.0, 0.0)), uSea),
                      max(baseHeight(p + vec2(0.0, 16.0)), uSea) - max(baseHeight(p - vec2(0.0, 16.0)), uSea)) / 32.0;
    // On a narrow steep bank the broad slope is gentler than the face, so
    // the steeper of the two sets the step (lines no closer than ~7 px).
    float S = uBandSpacing * pow(max(max(length(broad), slope), 0.12) / 0.5, 0.7);
    float u = (h + valueNoise(p / 28.0 + 5.0) * S * 0.45 + valueNoise(p / 9.0 + 23.0) * S * 0.18) / S;
    float v = fract(u);
    float px = min(v, 1.0 - v) * S / max(slope, 0.05);
    float facing = dot(-fall, normalize(uSun.xy + 1e-6));
    // A 1 px core with half-dark neighbours (3 px wide at half depth),
    // wider on steep shaded faces.
    float halfWidth = mix(1.6, 2.2, smoothstep(0.8, 1.4, slope) * smoothstep(0.1, -0.4, facing));
    float line = clamp(1.0 - px / halfWidth, 0.0, 1.0);
    float strength = smoothstep(0.12, 0.25, slope) * (0.75 + 0.25 * smoothstep(0.3, 1.5, slope));
    return vec2(line * strength * uBanding, facing);
}

// Sandiness from the weathering worker's transport (wind and water): 0
// none, small values a dusting, 1 deep sand. Thin sand lies in hollows
// first while ribs and lumps of the relief poke through it; deep sand
// covers both. Steep faces shed it.
float sandCover(vec2 p, float slope, float relief) {
    if (uSand <= 0.0) return 0.0;
    float field = texture(uWeather, p / (uSize - 1.0)).a;
    if (field <= 0.0) return 0.0;
    float lie = clamp(-relief * 0.07, -0.35, 0.35) + valueNoise(p / 24.0 + 13.0) * 0.12;
    float thin = smoothstep(0.0, 0.25, field) * (1.0 - field);
    return clamp(field + lie * thin, 0.0, 1.0) * (1.0 - smoothstep(0.95, 1.6, slope));
}

void main() {
    vec2 p = gl_FragCoord.xy - 0.5;
    float h = baseHeight(p);
    vec2 g = broadGradient(p);
    float slope = length(g);
    // Only a route's graded surface stays smooth; its steep shoulders are
    // ordinary faces and take relief like any other (no smooth dark band).
    // Crystal cells (Crystals brush) keep clean flat faces: no relief,
    // cracks, bands or sand, as on a graded route.
    float crystalCell = smoothstep(0.15, 0.6, texture(uRoutes, (p / (uSize - 1.0) * (uGrid - 1.0) + 0.5) / uGrid).a);
    float route = max(routeProtection(p) * (1.0 - smoothstep(0.45, 0.9, length(broadGradient(p)))), crystalCell);
    float crackMask = texture(uRoutes, (p / (uSize - 1.0) * (uGrid - 1.0) + 0.5) / uGrid).g;
    // Retail level ground is not dead flat in the art: faint embossed lumps
    // at 10-30 px. Appearance only; exported heights stay level.
    float plain = 0.0;
    if (uPlainRelief > 0.0 && h > uSea + 1.0) {
        plain = (valueNoise(p / 13.0 + 41.0) * 0.6 + valueNoise(p / 29.0 + 7.0) * 0.4) * uPlainRelief * 1.6
              * (1.0 - smoothstep(0.1, 0.4, slope));
    }
    // Level crests and graded routes stay smooth; relief grows with slope.
    // Gentle slopes carry low lumps too, so ground turned from the sun is
    // textured rather than a smooth gradient; level ground stays level.
    float gain = max(smoothstep(0.08, 0.60, slope), uGentleRelief * smoothstep(0.015, 0.10, slope))
               * smoothstep(-12.0, 10.0, h) * (1.0 - route);
    vec2 fall = slope > 1e-5 ? g / slope : vec2(0.0, 1.0);

    vec3 acc = vec3(0.0);
    float amplitude = 1.0, frequency = 1.0 / uReliefScale, total = 0.0;
    float firstOctave = 0.0;
    for (int k = 0; k < 6; k++) {
        if (k >= uReliefOctaves) break;
        // Contour direction, bent toward the accumulated gullies.
        vec2 steer = fall + acc.yz * uReliefBranch;
        vec2 dir = vec2(steer.y, -steer.x);
        float len = length(dir);
        dir = len > 1e-5 ? dir / len : vec2(1.0, 0.0);
        // Domain warp varies rib spacing and width so faces are not combed.
        vec2 warp = vec2(valueNoise(p / 48.0 + float(k) * 3.7), valueNoise(p / 48.0 + 11.3 + float(k) * 3.7)) * uReliefWarp;
        vec2 q = (p + warp) * frequency + vec2(float(k) * 17.31, float(k) * 9.13);
        vec3 e = gullies(q, dir);
        // Lumps keep faces from reading as combed stripes.
        float lump = valueNoise(q * 1.7 + 3.1);
        e.x = mix(e.x, lump, uReliefLumps);
        acc += vec3(e.x, e.yz * frequency) * amplitude;
        if (k == 0) firstOctave = e.x;
        total += amplitude;
        amplitude *= uReliefGain;
        frequency *= 2.0;
    }
    float value = acc.x / max(total, 1e-5);
    // Steeper ground carries proportionally taller ribs.
    float patchy = mix(1.0, 0.35 + 1.3 * (valueNoise(p / 90.0 + 5.0) * 0.5 + 0.5), uReliefPatchy);
    // Height scales with slope, with a floor so gentle lumps are visible.
    float height = value * uReliefAmount * max(clamp(slope, 0.0, 2.5), 0.25 * uGentleRelief) * uReliefScale * gain * patchy;
    height += plain;
    // Lunar regolith: fine wormy ridges on any slope, fading onto the
    // level dust, as on the retail Moon sections.
    float wormDark = 0.0;
    if (uWorms > 0.0 && h > uSea) {
        vec2 q = p + 6.0 * vec2(valueNoise(p / 17.0 + 3.0), valueNoise(p / 17.0 + 8.0));
        float worm = 1.0 - abs(valueNoise(q / 4.6 + 11.0));
        float worm2 = 1.0 - abs(valueNoise(q / 2.4 + 23.0));
        float on = smoothstep(0.03, 0.2, slope) * (0.55 + 0.45 * smoothstep(0.2, 0.8, slope));
        float ridge = pow(worm, 5.0) * 4.0 + pow(worm2, 5.0) * 1.6;
        height += ridge * uWorms * on * (0.6 + 0.4 * min(slope, 2.0));
        // The squiggles read as dark lines in the art: shade their troughs.
        wormDark = smoothstep(0.82, 0.97, max(worm, worm2 * 0.97)) * uWorms * on * 0.85;
    }
    vec3 bandsAt = uBandStyle == 1 ? vec3(0.0) : contourBands(p, h, slope, fall);
    vec2 bands = bandsAt.xy * (1.0 - route);
    height += bands.x;
    float bandDark = bands.y * smoothstep(-0.25, 0.35, -bandsAt.z);
    float bandLit = bands.y * smoothstep(0.1, 0.6, bandsAt.z) * 0.6;
    if (uBandStyle == 1) bandDark = lavaLines(p, h, slope, fall).x * uBandLine * (1.0 - route);
    float sand = sandCover(p, slope, height) * (1.0 - route);
    // Painted cover (Sand / Ground cover brushes): sand lies on slopes too,
    // so a hill set in sand has sandy feet; steep faces still shed it.
    // Ground cover clears weathered and painted sand alike.
    vec4 paint = texture(uRoutes, (p / (uSize - 1.0) * (uGrid - 1.0) + 0.5) / uGrid);
    float paintEdge = valueNoise(p / 13.0 + 41.0) * 0.20 + valueNoise(p / 4.0 + 7.0) * 0.08;
    float paintSand = smoothstep(0.30, 0.70, paint.b * 2.0 - 1.0 + paintEdge) * (1.0 - smoothstep(1.0, 1.8, slope)) * (1.0 - route);
    float paintGround = smoothstep(0.30, 0.70, 1.0 - paint.b * 2.0 + paintEdge);
    if (!uHasBeach) sand = max(sand, paintSand);
    sand *= 1.0 - paintGround;
    // Only sand deep enough to cover the ground buries relief and stones.
    float buried = smoothstep(0.35, 0.9, sand);
    if (sand > 0.0 && uRipple > 0.0) {
        float a = radians(uWindAngle);
        vec2 wind = vec2(cos(a), sin(a));
        float wobble = valueNoise(p / 30.0 + 2.0) * 2.0;
        height += sin(dot(p, wind) * 6.2831 / uRipple + wobble) * uRippleHeight * smoothstep(0.5, 0.95, sand);
    }
    // Sand buries relief beneath it.
    height *= 1.0 - 0.8 * buried;
    // Cracks, carved into the relief; sand fills them.
    vec4 crackAt = cracks(p, fall, slope, crackMask * (1.0 - route), h) * (1.0 - buried);
    // Where rock is broken into blocks, the blocks replace part of the
    // fall-line ribs, so faces read as fractured rock rather than combed.
    float broken = uCracksOn == 1 ? smoothstep(0.0, 0.5, crackMask) * uCrackBlocks * smoothstep(0.5, 1.2, slope) * (1.0 - route) : 0.0;
    height = height * (1.0 - 0.75 * broken) + crackAt.w - crackAt.x;
    // Relief never carries dry ground below the water plane: it would cut
    // blob-shaped notches into the coast. Nor lifts the bed above it.
    if (h > uSea) height = max(height, uSea + 0.5 - h);
    else height = min(height, uSea - 0.5 - h);
    vec2 rock = boulders(p, slope, h);
    vec2 scree = debrisStones(p, vec2(0.0));
    if (scree.x > rock.x) rock = scree;
    height += rock.x;
    rock.y *= 1.0 - buried;
    // Blue holds crack darkness (negative), rock cover (0..1), or a lit
    // crack wall (1 + light).
    // Band lines share the crack darkness code.
    float lineDark = max(max(crackAt.y, bandDark * (1.0 - buried)), wormDark * (1.0 - buried));
    if (uSandBanding > 0.0) {
        vec2 streak = sandStreaks(p, h, slope, fall, uSandBanding * max(max(paintSand, smoothstep(0.3, 0.8, sand)), route * 0.6));
        lineDark = max(lineDark, streak.x * (0.55 + 0.45 * smoothstep(-0.3, 0.4, -streak.y)));
    }
    crackAt.z = max(crackAt.z, bandLit * (1.0 - buried));
    float crackCode = lineDark > 0.02 ? -lineDark : crackAt.z > 0.02 ? 1.0 + crackAt.z : rock.y;
    // Green holds route protection, or (negative) beach cover off routes.
    float beach = beachCover(p, h, slope);
    if (uHasBeach) beach = max(beach, paintSand);
    beach *= 1.0 - paintGround;
    // Green: 2 + crystal on crystal cells.
    outFields = vec4(height, crystalCell > 0.02 ? 2.0 + crystalCell : route > 0.01 || beach <= 0.0 ? route : -beach, crackCode, sand);
}
