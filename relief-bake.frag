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
uniform float uFissures;         // share of large fissures
uniform float uFissureSpacing;   // typical spacing of large fissures, world px
uniform int uCracksOn;           // the full bake computes cracks; previews skip them
uniform float uPlainRelief;      // faint lit lumps on level ground (appearance only)
uniform float uCrackSpacing;     // typical spacing between cracks, world px
uniform float uCrackLength;      // elongation of crack cells along the fall line
uniform float uWindAngle;        // direction the wind blows toward, degrees (0 = east)
uniform float uRipple;           // ripple wavelength, world px (0: none)
uniform float uRippleHeight;     // ripple amplitude, height units
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
        float edge = max(max(abs(q.x) * 0.9, abs(q.y)), abs(q.x * 0.6 + q.y * 0.8)) / radius;
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

// Cracks: the cracked edges of an anisotropic cellular network. Cells are
// jittered world-space points; distances use a metric stretched along the
// local fall line, so cells are long down the slope and most edges run down
// it, as retail hill fissures and Gaea's eroded rock do. The domain is warped
// at two scales for bends and kinks. Each edge (a pair of cells) is cracked
// or not by its own hash, so cracks end at junctions; a noise taper lets
// some end mid-edge. Returns (distance to the nearest cracked edge in world
// px, 0..1 strength at that edge).
vec2 crackNet(vec2 p, vec2 fall, float cell, float stretch, float share, float network, float jag, float salt) {
    vec2 across = vec2(-fall.y, fall.x);
    vec2 w = p + jag * cell * (0.45 * vec2(valueNoise(p / (cell * 1.3) + salt), valueNoise(p / (cell * 1.3) + salt + 19.1))
                                      + 0.10 * vec2(valueNoise(p / (cell * 0.18) + salt + 3.3), valueNoise(p / (cell * 0.18) + salt + 7.7)));
    vec2 g = floor(w / cell);
    // Metric-space position relative to a point: along the fall line is
    // compressed by the stretch, across is kept in world px.
    float best = 1e9, second = 1e9;
    vec2 bestCell = vec2(0.0), bestPoint = vec2(0.0);
    int reach = int(ceil(stretch)) + 1;
    for (int j = -4; j <= 4; j++) for (int i = -4; i <= 4; i++) {
        if (abs(i) > reach || abs(j) > reach) continue;
        vec2 c = g + vec2(i, j);
        vec2 point = (c + 0.1 + 0.8 * cellHash(c + salt)) * cell;
        vec2 d = point - w;
        vec2 m = vec2(dot(d, fall) / stretch, dot(d, across));
        float dist = dot(m, m);
        if (dist < best) { second = best; best = dist; bestCell = c; bestPoint = point; }
        else if (dist < second) second = dist;
    }
    // Distance to each cracked bisector of the nearest cell, in metric space.
    vec2 ma = vec2(dot(bestPoint - w, fall) / stretch, dot(bestPoint - w, across));
    float edge = 1e9, strength = 0.0;
    for (int j = -4; j <= 4; j++) for (int i = -4; i <= 4; i++) {
        if (abs(i) > reach || abs(j) > reach) continue;
        vec2 c = g + vec2(i, j);
        if (c == bestCell) continue;
        vec2 point = (c + 0.1 + 0.8 * cellHash(c + salt)) * cell;
        vec2 mb = vec2(dot(point - w, fall) / stretch, dot(point - w, across));
        vec2 n = mb - ma;
        float len = length(n);
        if (len < 1e-4) continue;
        n /= len;
        // The bisector seen in the world: normal (n.x / stretch, n.y) in
        // the (fall, across) basis; the pixel sits at the origin.
        vec2 seen = vec2(n.x / stretch, n.y);
        float d = dot(0.5 * (ma + mb), n) / length(seen);
        if (d > edge) continue;
        // A normal along the fall line means the crack runs across the
        // slope. Rills keep only edges that run down it; plates keep all.
        vec2 worldNormal = normalize(fall * seen.x + across * seen.y);
        float acrossSlope = abs(dot(worldNormal, fall));
        float keep = 1.0 - smoothstep(mix(0.45, 1.05, network), mix(0.65, 1.25, network), acrossSlope);
        vec2 lo = min(bestCell, c), hi = max(bestCell, c);
        float ticket = cellHash(lo * 1.31 + hi * 7.77 + salt + 0.5).x;
        float open = keep * smoothstep(ticket - 0.08, ticket + 0.08, share);
        if (open <= 0.01) continue;
        edge = d; strength = open;
    }
    // Some cracks fade out partway along their length.
    float taper = smoothstep(-0.35, 0.25, valueNoise(p / (cell * (0.6 + 0.4 * stretch)) + salt + 41.0));
    return vec2(edge, strength * taper);
}

// Crack groove depth at p (height units) and core darkness, from the shape's
// crack amount (mask), the slope, and the crack knobs.
vec2 cracks(vec2 p, vec2 fall, float slope, float mask, float h) {
    if (uCracksOn == 0 || mask <= 0.0 || uCrackSeverity <= 0.0 || h < uSea + 1.0) return vec2(0.0);
    float start = mix(0.95, 0.10, uCrackReach);
    float halfWidth = uCrackWidth * 0.5;
    float depth = 0.0, core = 0.0;
    // Fine cracks: dense, short, on the steeper ground.
    float onSlope = smoothstep(start, start * 1.9, slope);
    if (onSlope > 0.0) {
        vec2 fine = crackNet(p, fall, uCrackSpacing, uCrackLength, clamp(mask, 0.0, 1.0) * onSlope, uCrackNetwork, uCrackJagged, 3.7);
        // A narrow V: the lighting gives one lit and one dark wall.
        float groove = max(0.0, 1.0 - max(0.0, fine.x - halfWidth * 0.5) / (halfWidth + 1.1)) * fine.y;
        depth = groove * mix(1.0, 4.0, uCrackSeverity);
        core = (1.0 - smoothstep(halfWidth * 0.6, halfWidth + 0.6, fine.x)) * fine.y;
    }
    // Large fissures: long lines down the slope that reach well onto gentle
    // ground, as on retail Green hills.
    float bigSlope = smoothstep(start * 0.35, start * 1.1, slope);
    if (uFissures > 0.0 && bigSlope > 0.0) {
        vec2 big = crackNet(p, fall, uFissureSpacing, uCrackLength * 2.0, clamp(mask, 0.0, 1.0) * bigSlope * min(1.0, uFissures * 1.6), 0.0, uCrackJagged * 0.6, 17.3);
        float wide = halfWidth + 0.35;
        float bigGroove = max(0.0, 1.0 - max(0.0, big.x - wide * 0.5) / (wide + 0.9)) * big.y;
        // Shallower on gentle ground, where a deep groove reads as a gash.
        depth = max(depth, bigGroove * mix(1.5, 5.0, uCrackSeverity) * mix(0.35, 1.0, smoothstep(0.3, 1.0, slope)));
        core = max(core, (1.0 - smoothstep(wide * 0.6, wide + 0.6, big.x)) * big.y);
    }
    return vec2(depth, core);
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
    return clamp(field + lie * thin, 0.0, 1.0) * (1.0 - smoothstep(0.7, 1.3, slope));
}

void main() {
    vec2 p = gl_FragCoord.xy - 0.5;
    float h = baseHeight(p);
    vec2 g = broadGradient(p);
    float slope = length(g);
    // Only a route's graded surface stays smooth; its steep shoulders are
    // ordinary faces and take relief like any other (no smooth dark band).
    float route = routeProtection(p) * (1.0 - smoothstep(0.45, 0.9, length(broadGradient(p))));
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
    // Relief never carries dry ground below the water plane: it would cut
    // blob-shaped notches into the coast.
    if (h > uSea) height = max(height, uSea + 0.5 - h);
    // Nor lifts the bed above it: no specks of land in shallow water.
    else height = min(height, uSea - 0.5 - h);
    height += plain;
    float sand = sandCover(p, slope, height) * (1.0 - route);
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
    vec2 crackAt = cracks(p, fall, slope, crackMask * (1.0 - route), h) * (1.0 - buried);
    height -= crackAt.x;
    float crack = crackAt.y;
    vec2 rock = boulders(p, slope, h);
    vec2 scree = debrisStones(p, vec2(0.0));
    if (scree.x > rock.x) rock = scree;
    height += rock.x;
    rock.y *= 1.0 - buried;
    // Blue holds rock cover, or (negative) crack darkness.
    outFields = vec4(height, route, crack > 0.02 ? -crack : rock.y, sand);
}
