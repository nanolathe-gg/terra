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
uniform float uBoulderDensity;   // 0 disables boulders
uniform float uBoulderSize;      // typical diameter, world px
uniform float uBoulderFoot;      // share of boulders sourced from cliff feet
uniform float uBoulderCluster;   // how strongly boulders gather into fields
uniform float uBoulderMoss;      // share of stones with mossy tops
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
        vec2 point = local + o - cellHash(cell - o) * 0.5;
        float w = exp(-dot(point, point) * 2.0);
        float phase = dot(point, dir) * TAU;
        sum += vec3(cos(phase), -sin(phase) * dir * TAU) * w;
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
        float edge = max(max(abs(q.x) * 0.9, abs(q.y)), abs(q.x * 0.6 + q.y * 0.8)) / radius;
        float lift = max(0.0, 1.0 - edge * edge);
        // Partly buried: the ground cuts each stone below its widest point.
        float buried = mix(0.15, 0.55, fract(r1.x * 7.31));
        float height = max(0.0, sqrt(lift) - buried) / (1.0 - buried) * radius * (0.55 + 0.35 * r1.y);
        if (height > best) { best = height; cover = smoothstep(0.0, 0.25, height / max(radius, 1.0)) * (fract(r2.x * 13.7) < uBoulderMoss ? 0.55 : 1.0); }
    }
    return vec2(best, cover);
}

void main() {
    vec2 p = gl_FragCoord.xy - 0.5;
    float h = baseHeight(p);
    vec2 g = broadGradient(p);
    float slope = length(g);
    float route = routeProtection(p);
    // Level crests and graded routes stay smooth; relief grows with slope.
    float gain = smoothstep(0.08, 0.60, slope) * smoothstep(-12.0, 10.0, h) * (1.0 - route);
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
    float height = value * uReliefAmount * clamp(slope, 0.0, 2.5) * uReliefScale * gain * patchy;
    // Relief never carries dry ground below the water plane: it would cut
    // blob-shaped notches into the coast.
    if (h > uSea) height = max(height, uSea + 0.5 - h);
    vec2 rock = boulders(p, slope, h);
    height += rock.x;
    outFields = vec4(height, route, rock.y, gain);
}
