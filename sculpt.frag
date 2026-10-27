#version 300 es
precision highp float;
precision highp int;
in vec2 vWorld;
in float vHeight;
out vec4 outColor;
uniform sampler2D uGrass;
uniform sampler2D uSlopeGrass;
uniform highp sampler2DArray uSlopeFringe;
uniform sampler2D uMineralRing;
uniform sampler2D uRock;
uniform sampler2D uRockWeathered;
uniform sampler2D uRockFractured;
uniform sampler2D uWater;
uniform sampler2D uWaterShallow;
uniform sampler2D uPalette;
uniform vec3 uShallowColor;
uniform vec3 uDeepColor;
uniform vec3 uWaterMean;
uniform vec3 uRockMean;
uniform bool uFull;
uniform bool uClay;
uniform bool uSlopeMaterial;
uniform bool uSoilCover;
uniform bool uMineralMargins;
uniform bool uRockLayers;
uniform bool uQuantize;
uniform bool uShapeCoverage;
uniform bool uLedgeCoverage;
uniform bool uNativeShallows;
uniform int uDiagnostic;
uniform bool uSeparateLight;
uniform float uFaceFill;
uniform vec4 uSlopeProfile;
uniform vec3 uElevatedCover;
uniform bool uSlopeOnLowBanks;
uniform float uRampMaterial;
uniform bool uGroundFringe;
uniform float uRingAmount;
uniform float uRingSpread;
uniform float uRingVariation;
uniform vec4 uFringeSignal;
uniform vec2 uFringeRange;
uniform bool uTransitionBody;
uniform float uCrackDark;
// A world's chosen base colours (a = 1 when set) and its textures' means.
uniform vec4 uGroundBase, uSlopeBase, uRockBase, uSandBase, uBeachBase, uShallowBase, uDeepBase;
uniform vec3 uGroundTexMean, uSlopeTexMean, uRockTexMean, uBeachTexMean;
uniform bool uBeach;
uniform vec4 uWaterMid;   // rgb mid-depth colour, a: its depth (0: two stops)
uniform float uBeachHeight, uBeachWidth;
// Move a texture to a new base colour, keeping its grain.
vec3 based(vec3 c, vec3 mean, vec4 base) { return base.a > 0.5 ? clamp(c - mean + base.rgb, 0.0, 1.0) : c; }
uniform float uCrackLit;
uniform float uSandDust;
uniform float uSandGrass;
uniform float uTransitionDetail;
uniform float uRockStart;
uniform float uRockFull;
uniform float uWetBand;
uniform float uShallowDepth;
uniform float uDeepDepth;
uniform float uMineralDetail;
uniform float uMicroRock;
uniform vec2 uFaceSlope;
uniform vec2 uRockShare;
uniform vec4 uFaceScore;
uniform float uFaceEdge;
uniform float uMossFromGround;
uniform float uLightCap;
uniform float uFootRim;
uniform float uCrevice;
uniform float uDither;
uniform float uSandLight;
uniform float uSandEdge;
uniform float uFlatShadow;
uniform float uFlatOcclusion;
uniform float uSlopeTexture;
uniform float uLandDither;
uniform float uGullyRock;
uniform float uWaterSoft;
uniform float uCrispShore;
uniform float uBankRock;
uniform int uGroundMode;
uniform int uGroundTiles;
uniform float uSandGrain;
/*COMMON*/

float visibility(vec2 p, float h) {
    vec2 toward = normalize(uLight.xy);
    float elevation = uLight.z / length(uLight.xy);
    float shadow = 0.0;
    for (int i = 1; i <= 12; ++i) {
        if (!uFull && i > 5) break;
        float d = float(i * i) * 1.4 + 2.0;
        vec2 q = p + toward * d;
        if (q.x < 0.0 || q.y < 0.0 || q.x >= uSize || q.y >= uSize) continue;
        float blocker = surfaceHeight(q) - h - d * elevation;
        shadow = max(shadow, smoothstep(-2.0, 4.0, blocker));
    }
    return 1.0 - 0.32 * shadow;
}

float occlusion(vec2 p, float h) {
    float result = 0.0;
    for (int i = 0; i < 8; ++i) {
        if (!uFull && i >= 4) break;
        float angle = float(i) * 2.399963;
        float d = 8.0 + float(i % 3) * 14.0;
        vec2 q = p + vec2(cos(angle), sin(angle)) * d;
        result += clamp((surfaceHeight(q) - h) / d - 0.12, 0.0, 1.0);
    }
    return 1.0 - result * (uFull ? 0.045 : 0.09);
}

vec3 paletteColor(vec3 rgb) {
    ivec3 c = ivec3(clamp(floor(rgb * 31.0 + 0.5), 0.0, 31.0));
    return texelFetch(uPalette, ivec2(c.r + 32 * c.b, c.g), 0).rgb;
}

float uphillSoil(vec2 p, vec2 uphill, float h, float reach) {
    // Nearby gentle ground supplies a connected cover layer down the face.
    // The bounded reach is authored appearance, not a retail soil simulation.
    const float distances[4] = float[4](5.0, 14.0, 30.0, 56.0);
    float support = 0.0;
    for (int i = 0; i < 4; ++i) {
        if (!uFull && i > 1) break;
        float d = distances[i];
        vec2 q = p + uphill * d;
        float gentle = 1.0 - smoothstep(0.50, 0.95, length(broadGradient(q)));
        float above = smoothstep(0.0, 2.0, baseHeight(q) - h);
        support = max(support, gentle * above * (1.0 - smoothstep(reach * 0.55, reach, d)));
    }
    return support;
}

float mineralMargin(vec2 p, float slope, vec4 n) {
    // Nearby fractured slopes feed irregular outcrops into their level crown
    // and foot. The support dies outside that neighbourhood, leaving broad
    // patterned flats quiet. Width and gaps belong to one world-space field.
    float reach = mix(9.0, 26.0, smoothstep(0.28, 0.72, n.g));
    if (uGroundFringe && uRingAmount > 0.0) {
        float varied = mix(8.0, 48.0, smoothstep(0.20, 0.80, n.r * 0.6 + n.g * 0.4));
        reach = mix(22.0, varied, uRingVariation) * mix(0.65, 1.60, uRingSpread);
    }
    vec4 neighbours = vec4(baseHeight(p + vec2(reach, 0.0)), baseHeight(p - vec2(reach, 0.0)),
                           baseHeight(p + vec2(0.0, reach)), baseHeight(p - vec2(0.0, reach)));
    vec2 neighbourhood = vec2(neighbours.x - neighbours.y, neighbours.z - neighbours.w) / (2.0 * reach);
    float local = smoothstep(0.05, 0.65, slope);
    float apron = smoothstep(0.04, 0.50, length(neighbourhood)) * 0.65;
    float influence = max(local, apron);
    float pockets = (n.r - 0.5) * 0.55 + (n.g - 0.5) * 0.60;
    float result = smoothstep(0.12, 0.82, influence + pockets * smoothstep(0.0, 0.18, influence));
    if (uGroundFringe) {
        // A water bank has a gradient too. This optional dry transition layer
        // needs nearby land raised above the plain, even when it reaches onto
        // flat sand outside the hill footprint.
        float source = max(baseHeight(p), max(max(neighbours.x, neighbours.y), max(neighbours.z, neighbours.w)));
        result *= smoothstep(uBase + 1.0, uBase + 7.0, source);
    }
    return result;
}

float weatheredCover(float cover, vec4 deposits, vec4 grain) {
    // Fine ground buries some of the source; independently transported
    // fragments survive outside it. Their support is not gated by the old edge.
    float edge=1.0-smoothstep(0.28,0.82,cover);
    float clusters=grain.r*0.45+grain.g*0.35+grain.b*0.20;
    float burial=deposits.g*(0.25+0.90*smoothstep(0.36,0.64,clusters));
    float pockets=smoothstep(0.38,0.59,clusters)*smoothstep(0.08,0.25,cover)
                  *(1.0-smoothstep(0.26,0.64,cover));
    float retained=cover*(1.0-burial*edge)*(1.0-pockets*0.90);
    float remnants=max(pow(deposits.r,0.70)*0.80,deposits.b*0.56)
                  *(1.0-smoothstep(0.16,0.65,deposits.a));
    remnants*=mix(0.20,1.25,smoothstep(0.25,0.73,clusters));
    float varied=max(retained,remnants);
    return clamp(varied+(clusters-0.5)*0.30*sqrt(max(0.0,varied))*edge,0.0,1.0);
}

// Base ground from a fixed set of 32-px tiles, randomly placed on the TNT
// tile grid, so level ground costs only uGroundTiles unique tiles. The tiles
// are sampled offline from retail neighbour statistics (ground_tiles.py) and
// stored in the first row of the ground texture.
float groundHash(ivec3 q) {
    uint n = uint(q.x) * 374761393u + uint(q.y) * 668265263u + uint(q.z) * 2246822519u;
    n = (n ^ (n >> 13)) * 1274126177u;
    return float(n ^ (n >> 16)) / 4294967295.0;
}
vec3 groundTile(vec2 pixel) {
    ivec2 cell = ivec2(floor(pixel / 32.0));
    ivec2 local = ivec2(mod(floor(pixel), 32.0));
    int tile = min(int(groundHash(ivec3(cell, 7)) * float(uGroundTiles)), 15);
    return texelFetch(uGrass, ivec2(tile * 32 + local.x, local.y), 0).rgb;
}

void main() {
    vec2 p = vWorld;
    float h = surfaceHeight(p);
    vec2 g = surfaceGradient(p);
    vec2 broad = broadGradient(p);
    vec3 normal = normalize(vec3(-g, 1.0));
    vec4 n = terrainNoise(p);
    vec4 sediments=uMaterialReady?texture(uMaterialField,(p/(uSize-1.0)*(uGrid-1.0)+0.5)/uGrid):vec4(0.0);
    float fringeVariation=uRingVariation/0.75;
    vec2 drift=((terrainNoise(p*0.65+vec2(133.0,71.0)).rg-0.5)*66.0+(n.gb-0.5)*16.0)*fringeVariation;
    vec4 brokenSediments=uMaterialReady?texture(uMaterialField,((p+drift)/(uSize-1.0)*(uGrid-1.0)+0.5)/uGrid):sediments;
    float materialWeather=uMaterialReady?uMaterialWeathering:0.0;
    vec2 weather = texture(uWeather, p / (uSize - 1.0)).rg;
    float slope = length(broad);
    float route = routeProtection(p);
    float flatLight = 0.42 + 0.95 * uLight.z;
    float lighting = (0.42 + 0.95 * max(0.0, dot(normal, uLight))) / flatLight;
    lighting = min(lighting, uLightCap);
    float ao = occlusion(p, h);
    float shadow = visibility(p, max(h, uSea));
    float shading = lighting * ao * shadow;
    if (uSeparateLight) {
        // Cast shadows attenuate the direct sun. The ambient term already
        // receives local occlusion, so shadowing it again buries dark faces.
        float direct = max(0.0, dot(normal, uLight));
        // Optional authored sky/bounce fill keeps unlit steep faces from all
        // hitting one dark floor. Flat ground and sunlit surfaces retain their
        // accepted response; this does not move the sculpted surface.
        float fill = uFaceFill * (1.0 - normal.z) * (1.0 - smoothstep(0.0, 0.50, direct));
        // Retail Green casts no shadows onto level ground: gate cast shadow
        // and occlusion by slope, with knobs for other looks.
        float onSlope = smoothstep(0.08, 0.35, slope);
        float castShadow = mix(1.0, shadow, mix(uFlatShadow, 1.0, onSlope));
        float occluded = mix(1.0, ao, mix(uFlatOcclusion, 1.0, onSlope));
        shading = min((0.42 + fill + 0.95 * direct * castShadow) / flatLight, uLightCap) * occluded;
    }
    // TA's fixed camera permits a native-pixel material grain. World-XY
    // sampling stretches that grain over projected south-facing slopes.
    // Geometry and broad material decisions still use world coordinates.
    vec2 pixel = vec2(gl_FragCoord.x, uSize - gl_FragCoord.y);
    vec3 grass = based(uGroundMode == 1 ? groundTile(pixel) : texture(uGrass, pixel / 512.0).rgb, uGroundTexMean, uGroundBase);
    vec3 transitionGround=grass,transitionFace=grass,transitionLow=grass;
    float transitionPower=1.0;
    float transitionCore=0.0;
    bool sharedTransition=false;
    if (uSlopeMaterial) {
        // Small native slope interiors retain moss ribs and scattered stone.
        // This is an appearance material, not recovered albedo or geometry.
        vec3 slopeGrass = based(texture(uSlopeGrass, pixel / 512.0).rgb, uSlopeTexMean, uSlopeBase);
        float slopeCover = smoothstep(uSlopeProfile.x, uSlopeProfile.y, slope)
                         * smoothstep(uSlopeProfile.z, uSlopeProfile.w, h);
        if (uMineralMargins) {
            float cover = mineralMargin(p, slope, n);
            // Some biome hills keep their mineral material across the crown.
            // Elevation also gives their foot a broad transition into sand.
            float elevated = smoothstep(uBase + uElevatedCover.x, uBase + uElevatedCover.y,
                                        h + (n.g - 0.5) * 5.0);
            if (uGroundFringe) elevated *= smoothstep(uBase + 0.25, uBase + 2.0, baseHeight(p));
            cover = mix(cover, max(min(cover, 0.28), elevated), uElevatedCover.z);
            if (!uGroundFringe) cover=mix(cover,weatheredCover(cover,sediments,n),materialWeather);
            // Softer native mineral fragments carry the fringe before the
            // deeper connected cracks take over on the face. This avoids dark
            // cliff fragments appearing as separate boulders on level ground.
            vec3 fringe = texture(uSlopeFringe, vec3(pixel / 512.0,0.0)).rgb;
            slopeGrass = mix(fringe, slopeGrass, smoothstep(0.42, 0.88, cover));
            // Native fissures reach farther than their brighter mineral fill.
            // Fade through that structure instead of blurring two full images.
            float stone = dot(slopeGrass, vec3(0.299, 0.587, 0.114));
            float edge = (0.26 - stone) * 0.9 + (n.b - 0.5) * 0.12;
            slopeCover = smoothstep(0.04, 0.96, cover + edge * 4.0 * cover * (1.0 - cover))
                       * smoothstep(uSlopeProfile.z, uSlopeProfile.w, h);
            if (uGroundFringe) {
                // This fringe already contains native ground plus thin vein
                // tails. Preserve its pixels before the darker face arrives;
                // fading both layers together turns the edge into a gray blur.
                vec3 face = texture(uSlopeGrass, pixel / 512.0).rgb;
                float detail = (0.35 - dot(face, vec3(0.299, 0.587, 0.114))) * 0.12;
                slopeGrass = mix(fringe, face, smoothstep(0.20, 0.78, cover + detail));
                if (uRingAmount > 0.0) {
                    // A connected native vein material occupies its own
                    // irregular zone before the brown core. World-space
                    // variation crosses smooth ramps without changing grade.
                    float zone = cover + ((n.r - 0.5) * 0.38 + (n.g - 0.5) * 0.22) * uRingVariation
                                       * smoothstep(0.0, 0.12, cover);
                    float spread = mix(0.60, 1.80, uRingSpread);
                    vec3 ring = texture(uMineralRing, pixel / 512.0).rgb;
                    float vein = smoothstep(uFringeRange.x, uFringeRange.y, dot(ring, uFringeSignal.rgb) + uFringeSignal.a);
                    float tail = smoothstep(0.005, 0.19, max(0.0, zone));
                    // Veins survive farther than their sandy fill. This keeps
                    // native fine texture while breaking the outer border into
                    // fading branches, rather than a uniform coloured collar.
                    float ringMask = smoothstep(0.06, 0.42, zone * spread + vein * 0.15)
                                   * tail * mix(0.30, 1.0, max(vein, smoothstep(0.16, 0.40, zone)));
                    vec3 margin = mix(grass, fringe, tail * mix(0.25, 1.0, vein));
                    margin = mix(margin, ring, ringMask * uRingAmount);
                    slopeGrass = mix(margin, face, smoothstep(0.22, 0.96, zone + detail));
                }
                slopeCover = smoothstep(0.01, 0.28, cover)
                           * smoothstep(uSlopeProfile.z, uSlopeProfile.w, h);
                if (materialWeather>0.0 && uTransitionBody) {
                    // The worker's spatially softened source measures a join
                    // across world pixels. All three materials use that same
                    // coordinate; independent height thresholds draw outlines.
                    float source=sediments.b;
                    float variation=((n.r-0.5)*0.08+(n.g-0.5)*0.04)*fringeVariation;
                    source=clamp(source+variation*4.0*source*(1.0-source),0.0,1.0);
                    vec3 ring=texture(uMineralRing,pixel/512.0).rgb;
                    vec3 body=texture(uSlopeFringe,vec3(pixel/512.0,1.0)).rgb;
                    float vein=smoothstep(uFringeRange.x,uFringeRange.y,dot(ring,uFringeSignal.rgb)+uFringeSignal.a);
                    float arrivals=max(source*1.30,sediments.r*0.55)*exp2((uRingSpread-0.70)*2.0);
                    float fine=smoothstep(0.002,0.23,arrivals);
                    fine*=1.0-sediments.g*smoothstep(0.38,0.63,n.r*0.55+n.g*0.45)*0.75;
                    float fill=smoothstep(0.018,0.17,arrivals);
                    float ringWeight=fine*mix(fill,1.0,vein)*uRingAmount;
                    transitionGround=mix(grass,ring,ringWeight);
                    float warm=smoothstep(0.02,0.54,source);
                    float warmGrain=0.52-dot(body,vec3(0.299,0.587,0.114));
                    warm=clamp(warm+warmGrain*0.5*4.0*warm*(1.0-warm),0.0,1.0);
                    transitionGround=mix(transitionGround,body,warm);
                    if (uTransitionDetail>0.0) {
                        vec3 groundLow=textureLod(uGrass,pixel/512.0,3.0).rgb;
                        vec3 ringLow=textureLod(uMineralRing,pixel/512.0,3.0).rgb;
                        vec3 bodyLow=textureLod(uSlopeFringe,vec3(pixel/512.0,1.0),3.0).rgb;
                        transitionLow=mix(mix(groundLow,ringLow,ringWeight),bodyLow,warm);
                        transitionPower=((1.0-ringWeight)*(1.0-ringWeight)+ringWeight*ringWeight)
                                       *(1.0-warm)*(1.0-warm)+warm*warm;
                    }
                    transitionFace=face;
                    transitionCore=smoothstep(0.23,0.88,source);
                    float faceGrain=0.35-dot(face,vec3(0.299,0.587,0.114));
                    transitionCore=clamp(transitionCore+faceGrain*0.35*4.0*transitionCore*(1.0-transitionCore),0.0,1.0);
                    sharedTransition=true;
                } else if (materialWeather>0.0) {
                    float interruption=max(0.0,sediments.a-brokenSediments.a)
                                      *(1.0-smoothstep(0.40,0.90,cover));
                    float crust=max(0.0,cover-interruption*1.35);
                    float zone=weatheredCover(crust,sediments,n);
                    zone=max(zone,brokenSediments.a*0.36*(1.0-smoothstep(0.05,0.35,sediments.a)));
                    vec3 ring=texture(uMineralRing,pixel/512.0).rgb;
                    float vein=smoothstep(uFringeRange.x,uFringeRange.y,dot(ring,uFringeSignal.rgb)+uFringeSignal.a);
                    float arrivals=max(sediments.b*1.30,sediments.r*0.55)*exp2((uRingSpread-0.70)*2.0);
                    float fine=smoothstep(0.002,0.23,arrivals);
                    fine*=1.0-sediments.g*smoothstep(0.38,0.63,n.r*0.55+n.g*0.45)*0.75;
                    float veil=smoothstep(0.06,0.78,zone);
                    vec3 margin=mix(grass,fringe,veil*0.55);
                    float fill=smoothstep(0.018,0.17,arrivals);
                    margin=mix(margin,ring,fine*mix(fill,1.0,vein)*uRingAmount);
                    float core=smoothstep(0.22,0.96,max(0.0,cover-interruption*0.6)+(n.b-0.5)*0.12)
                              *smoothstep(0.02,0.35,sediments.a);
                    margin=mix(margin,face,core);
                    slopeGrass=mix(mix(grass,slopeGrass,slopeCover),margin,materialWeather);
                    slopeCover=1.0;
                }
            }
        }
        // Level dry ground can receive mineral tails from a nearby hill.
        // Only banks below that plane need the high-coast admission check.
        if (!uSlopeOnLowBanks && h < uBase - 0.25) {
            vec2 uphill = broad / max(0.001, slope);
            float source = max(baseHeight(p), baseHeight(p + uphill * 16.0));
            source = max(source, baseHeight(p + uphill * 36.0));
            source = max(source, baseHeight(p + uphill * 64.0));
            slopeCover *= smoothstep(uBase + 8.0, uBase + 26.0, source);
        }
        // A smooth route can retain native hill grain without inheriting
        // displaced cracks or rubble. Geometry protection remains separate.
        slopeCover *= 1.0 - route * (1.0 - uRampMaterial);
        // The sampled slope texture carries baked shading that reads as
        // smudges on gentle ground; the fall-line surface lights grass itself.
        if (uReliefMode == 1) slopeCover *= uSlopeTexture;
        grass = mix(grass, slopeGrass, slopeCover);
    }
    // Small mineral interiors supply pixel structure; the whole crown/face/
    // foot comes from this surface. Some native microshading remains baked.
    vec3 rock = texture(uRock, pixel / vec2(textureSize(uRock, 0))).rgb;
    rock = clamp(uRockMean + (rock - uRockMean) * uMineralDetail, 0.0, 1.0);
    if (uRockLayers && h > 18.0) {
        // Broad material regions vary actual native mineral structure. No
        // repeated whole cliff, colour-only variants or fresh pixel noise.
        float formation = terrainNoise(p * 0.35 + vec2(43.0, 87.0)).r;
        float moss = terrainNoise(p * 0.70 + vec2(173.0, 91.0)).g + weather.g * 0.30;
        vec3 fractured = texture(uRockFractured, pixel / 256.0).rgb;
        vec3 weathered = texture(uRockWeathered, (pixel + vec2(73.0, 17.0)) / 256.0).rgb;
        rock = mix(rock, fractured, smoothstep(0.43, 0.57, formation));
        rock = mix(rock, weathered, smoothstep(0.40, 0.62, moss));
    }
    rock = based(rock, uRockTexMean, uRockBase);
    // Deposition softens the exposed face into a connected apron. Flow and
    // deposited soil come from the same weathering that changed the surface.
    float rockScore = slope + (n.g - 0.5) * 0.55 + (n.b - 0.5) * 0.30 - weather.g * 0.55;
    if (uShapeCoverage) {
        float west = surfaceHeight(p - vec2(10.0, 0.0));
        float east = surfaceHeight(p + vec2(10.0, 0.0));
        float north = surfaceHeight(p - vec2(0.0, 10.0));
        float south = surfaceHeight(p + vec2(0.0, 10.0));
        float formSlope = length(vec2(east - west, south - north) / 20.0);
        float convexity = clamp((h - 0.25 * (west + east + north + south)) / 5.0, -1.0, 1.0);
        rockScore = 0.55 * slope + 0.45 * formSlope + convexity * 0.28
                  + (n.g - 0.5) * (uSoilCover ? 0.80 : 0.25) - weather.g * 0.55;
        if (uSoilCover) rockScore += (n.r - 0.5) * 0.70;
    }
    if (uLedgeCoverage) {
        float west = surfaceHeight(p - vec2(4.0, 0.0));
        float east = surfaceHeight(p + vec2(4.0, 0.0));
        float north = surfaceHeight(p - vec2(0.0, 4.0));
        float south = surfaceHeight(p + vec2(0.0, 4.0));
        float localSlope = length(vec2(east - west, south - north) / 8.0);
        float convexity = clamp((h - 0.25 * (west + east + north + south)) / 3.0, -1.0, 1.0);
        // Let actual shelves carry grass, even inside a broadly steep face.
        rockScore = 0.15 * slope + 0.85 * localSlope + convexity * 0.15
                  + (n.g - 0.5) * 0.15 - weather.g * 0.55;
    }
    float exposed = smoothstep(uRockStart, uRockFull, rockScore);
    if (uSoilCover && h > 18.0 && slope > 0.20 && exposed > 0.01) {
        float reach = mix(7.0, 70.0, smoothstep(0.30, 0.70, n.g));
        float soil = uphillSoil(p, broad / slope, baseHeight(p), reach);
        // Deposition can retain grass on actual gentle ledges. Its support
        // shares the weathered geometry; it is not a random green stipple.
        float ledge = (1.0 - smoothstep(0.55, 1.20, length(g))) * smoothstep(0.08, 0.40, weather.g);
        float pockets = smoothstep(0.55, 0.72, n.g * 0.55 + n.r * 0.45 + weather.g * 0.20);
        pockets *= 1.0 - smoothstep(1.55, 2.80, slope);
        soil = max(soil, max(ledge, pockets * 0.65));
        float covered = smoothstep(0.12, 0.55, soil);
        exposed *= 1.0 - covered * smoothstep(18.0, 28.0, h);
    }
    if (uCoastalDetail) {
        float bank = 1.0 - smoothstep(1.0, 8.0, abs(h - uSea - 3.0 + (n.g - 0.5) * 4.0));
        exposed = max(exposed, bank * smoothstep(0.3, 0.8, slope) * (0.4 + 0.6 * n.b) * uBankRock);
    }
    // A steep ground-level bank remains grassy. Only nearby elevated land
    // admits an exposed face down to water; slope alone cannot classify it.
    // This is the Green Planet authoring rule, not a recovered retail formula.
    if (!uRockyCoasts && exposed > 0.001 && h < uBase + 1.0) {
        vec2 uphill = broad / max(0.001, slope);
        float source = max(baseHeight(p), baseHeight(p + uphill * 16.0));
        source = max(source, baseHeight(p + uphill * 36.0));
        source = max(source, baseHeight(p + uphill * 64.0));
        exposed *= smoothstep(uBase + 12.0, uBase + 36.0, source);
    }
    if (uMineralMargins) exposed *= smoothstep(0.45, 1.40, slope);
    if (materialWeather>0.0 && !uMineralMargins) {
        float chipped=weatheredCover(exposed,sediments,n);
        float stoneGrain=dot(rock,vec3(0.299,0.587,0.114));
        chipped=clamp(chipped+(0.34-stoneGrain)*0.5*4.0*chipped*(1.0-chipped),0.0,1.0);
        exposed=mix(exposed,chipped,materialWeather);
    }
    exposed *= 1.0 - route * (1.0 - smoothstep(0.45, 0.9, slope));
    float nearWater = 1.0 - smoothstep(uSea + 1.0, uSea + uWetBand, h);
    vec3 material = mix(grass, rock, exposed);
    if (uBeach && h > uSea - 1.0) {
        // Beach sand: within reach of the water (baked), or failing that a
        // low band above the waterline. Its inland edge is ragged and breaks
        // into grains, and steep banks stay bare.
        vec3 sandBeach = based(texture(uSlopeFringe, vec3(pixel / vec2(textureSize(uSlopeFringe, 0).xy), 2.0)).rgb, uBeachTexMean, uBeachBase);
        float speck = terrainNoise(p * 6.0 + vec2(61.0, 3.0)).b;
        float beach = smoothstep(0.25, 0.75, beachField(p) + (speck - 0.5) * 0.5);
        float top = uBeachHeight * uBeachWidth * (0.65 + 0.7 * terrainNoise(p * 0.45 + vec2(29.0, 5.0)).g);
        beach = max(beach, (1.0 - smoothstep(top * 0.6, top, h - uSea + (speck - 0.5) * 1.5)) * (1.0 - smoothstep(0.7, 1.3, slope)));
        material = mix(material, sandBeach, beach * (1.0 - exposed * 0.7));
    }
    if (sharedTransition) {
        // Exposed rock belongs inside the face family, before its one join to
        // warm mineral and sand. It cannot repaint a second hard perimeter.
        vec3 face=mix(transitionFace,rock,exposed);
        vec3 refined=mix(transitionGround,face,transitionCore);
        if (uTransitionDetail>0.0) {
            vec3 faceLow=textureLod(uSlopeGrass,pixel/512.0,3.0).rgb;
            vec3 rockLow=textureLod(uRock,pixel/vec2(textureSize(uRock,0)),3.0).rgb;
            rockLow=clamp(uRockMean+(rockLow-uRockMean)*uMineralDetail,0.0,1.0);
            vec3 low=mix(transitionLow,mix(faceLow,rockLow,exposed),transitionCore);
            float facePower=(1.0-exposed)*(1.0-exposed)+exposed*exposed;
            float power=transitionPower*(1.0-transitionCore)*(1.0-transitionCore)
                       +facePower*transitionCore*transitionCore;
            // Mixing independent native grains reduces their variance. Recover
            // only the local detail; the accepted broad colour join stays put.
            float gain=mix(1.0,min(1.65,inversesqrt(max(0.1,power))),uTransitionDetail);
            refined=low+(refined-low)*gain;
        }
        material=mix(material,refined,materialWeather);
    }
    if (uReliefMode == 1 && uMicroRock > 0.0) {
        // TA-style faces: moss and rock interleave at lump scale. The broad
        // slope sets how much of the face is rock; the detailed surface
        // decides where: rock on steep flanks and in hollows, moss on tops.
        float micro = length(g);
        float around = 0.25 * (surfaceHeight(p - vec2(3.0, 0.0)) + surfaceHeight(p + vec2(3.0, 0.0))
                             + surfaceHeight(p - vec2(0.0, 3.0)) + surfaceHeight(p + vec2(0.0, 3.0)));
        float top = clamp((h - around) / 1.5, -1.0, 1.0);
        // Lump-scale noise breaks the face's upper and lower edges.
        vec4 edgeNoise = terrainNoise(p * 1.5 + vec2(53.0, 11.0));
        float faceSlope = slope * (1.0 + (edgeNoise.r - 0.5) * uFaceEdge);
        float face = smoothstep(uFaceSlope.x, uFaceSlope.y, faceSlope) * (1.0 - route);
        float share = mix(uRockShare.x, uRockShare.y, smoothstep(uFaceSlope.y, uFaceSlope.y * 1.8, slope));
        vec4 fine = terrainNoise(p * 3.0 + vec2(19.0, 7.0));
        // Gullies at channel scale expose rock in streaks down the slope.
        float wide = 0.25 * (surfaceHeight(p - vec2(7.0, 0.0)) + surfaceHeight(p + vec2(7.0, 0.0))
                           + surfaceHeight(p - vec2(0.0, 7.0)) + surfaceHeight(p + vec2(0.0, 7.0)));
        float gully = smoothstep(0.3, 2.0, wide - h);
        float score = uFaceScore.x * micro / max(slope, 0.25) - uFaceScore.y * top + uGullyRock * gully
                    + (fine.g - 0.5) * uFaceScore.z + (n.r - 0.5) * uFaceScore.w;
        // Threshold so that roughly the chosen share of face pixels is rock.
        float threshold = mix(1.4, -0.9, share);
        float rockMask = smoothstep(threshold - 0.12, threshold + 0.12, score);
        vec3 moss = mix(based(texture(uSlopeGrass, pixel / 512.0).rgb, uSlopeTexMean, uSlopeBase), based(uGroundMode == 1 ? groundTile(pixel) : texture(uGrass, pixel / 512.0).rgb, uGroundTexMean, uGroundBase), uMossFromGround);
        vec3 faceMaterial = mix(moss, rock, rockMask);
        material = mix(material, faceMaterial, face * uMicroRock);
        // A light, crisp grass rim where rough ground meets the level plain.
        float rim = smoothstep(uFaceSlope.x * 0.35, uFaceSlope.x * 0.6, faceSlope)
                  * (1.0 - smoothstep(uFaceSlope.x * 0.7, uFaceSlope.x * 1.05, faceSlope));
        vec3 brightGrass = clamp(based(texture(uGrass, pixel / 512.0).rgb, uGroundTexMean, uGroundBase) * vec3(1.15, 1.35, 1.05), 0.0, 1.0);
        material = mix(material, brightGrass, rim * uFootRim * (1.0 - route));
        exposed = max(exposed * (1.0 - face), rockMask * face);
        // Thin dark crevices in the relief's hollows, also across mid slopes
        // where the face material has not taken over.
        float hollow = smoothstep(0.25, 0.9, -top) * smoothstep(uFaceSlope.x * 0.4, uFaceSlope.x, faceSlope);
        material *= 1.0 - uCrevice * hollow * (1.0 - route);
    }
    if (uReliefMode == 1) {
        // Procedural sand: a colour with two scales of grain, so it needs no
        // sampled art. Coverage comes from the bake.
        float sand = bakedFields(p).a;
        if (sand > 0.0) {
            // Weathered rock: the rock's own average colour, lightened and
            // dulled by weathering, with fragments of the rock texture as
            // grains. A biome's sand therefore follows its own rock.
            vec3 rockAverage = uRockBase.a > 0.5 ? uRockBase.rgb : textureLod(uRock, vec2(0.5), 12.0).rgb;
            vec3 weathered = mix(rockAverage, vec3(dot(rockAverage, vec3(0.299, 0.587, 0.114))), 0.25);
            weathered = mix(weathered, vec3(1.0), uSandLight * 0.55);
            if (uSandBase.a > 0.5) weathered = uSandBase.rgb;
            vec2 scatter = pixel * 1.37 + vec2(terrainNoise(p * 2.0).r, terrainNoise(p * 2.0 + 9.0).g) * 40.0;
            vec3 fragment = texture(uRock, scatter / vec2(textureSize(uRock, 0))).rgb;
            fragment = mix(fragment, vec3(1.0), uSandLight * 0.45);
            if (uSandBase.a > 0.5) fragment = clamp(fragment - textureLod(uRock, vec2(0.5), 12.0).rgb + uSandBase.rgb, 0.0, 1.0);
            vec3 sandMaterial = mix(weathered, fragment, uSandGrain);
            // Three stages, so sand thins into the ground over tens of
            // pixels: fines tint what is there, then grains appear between
            // grass blades (a per-pixel threshold against fine noise), then
            // sand covers the ground.
            material = mix(material, weathered, smoothstep(0.0, 0.6, sand) * uSandDust * 0.6);
            float speck = terrainNoise(p * 6.0 + vec2(17.0, 29.0)).b;
            float cover = smoothstep(0.35, 0.95, sand + (speck - 0.5) * 0.55 * uSandEdge);
            // Grass and moss travel with the sand and regrow over it in
            // patches, more where it is thin; tufts break the patch edges.
            float patchy = terrainNoise(p * 0.35 + vec2(51.0, 7.0)).g * 0.65 + terrainNoise(p * 1.3 + vec2(3.0, 91.0)).b * 0.35;
            float tuft = terrainNoise(p * 5.0 + vec2(13.0, 47.0)).r;
            float regrow = smoothstep(0.62, 0.80, patchy + (1.0 - sand) * 0.22 + (tuft - 0.5) * 0.3) * uSandGrass;
            material = mix(material, sandMaterial, cover * (1.0 - regrow));
        }
    }
    // Baked boulders take rock material, lit by the same surface.
    if (uReliefMode == 1) {
        float coverOrCrack = bakedFields(p).b;
        // A crack wall facing the sun.
        if (coverOrCrack > 1.0) material *= 1.0 + uCrackLit * (coverOrCrack - 1.0);
        else material = mix(material, rock * 1.08, max(coverOrCrack, 0.0));
        // A crack's floor is in shadow: darken what is there, so a crack in
        // grass stays green-black and one in rock grey-black. The walls are
        // lit by the carved geometry.
        material *= 1.0 - uCrackDark * clamp(-coverOrCrack, 0.0, 1.0);
    }
    float chip = smoothstep(0.08, 0.45, screeHeight(p) * (1.0 - route));
    chip=max(chip,smoothstep(0.035,0.40,materialChipHeight(p)*(1.0-route))*0.65);
    material = mix(material, rock, chip * (1.0 - exposed));
    float cleft = uReliefMode == 1 ? 0.0 : smoothstep(0.15, 1.20, fractureDepth(p, h, slope));
    material = mix(material, mix(grass * 0.90, rock * 0.78, 0.30 + exposed * 0.50), cleft * 0.35);
    material *= 1.0 - weather.r * 0.06;
    material *= 1.0 - nearWater * 0.17;
    vec3 color = material * shading;
    if (h < uSea + 1.0) {
        float depth = max(0.0, uSea - h);
        // Sediment mottling varies apparent water colour without changing the
        // authored bed or the level water plane.
        float colorDepth = depth;
        if (uWaterSoft > 0.0) {
            // Colour follows depth averaged over a disc: the authored bed
            // stays exact, but deep water fades in over a wider, uneven band.
            float sum = 0.0;
            for (int k = 0; k < 8; k++) {
                float a = float(k) * 0.785398 + 0.3;
                vec2 o = vec2(cos(a), sin(a)) * uWaterSoft * (0.6 + 0.4 * float(k % 2));
                sum += max(0.0, uSea - baseHeight(p + o));
            }
            colorDepth = mix(depth, sum / 8.0, 0.75);
        }
        if (uCoastalDetail) colorDepth += ((n.r - 0.5) * 14.0 + (n.g - 0.5) * 5.0) * smoothstep(2.0, 8.0, depth);
        float deep = smoothstep(uShallowDepth, uDeepDepth, colorDepth);
        vec3 grain = texture(uWater, pixel / vec2(textureSize(uWater, 0))).rgb - uWaterMean;
        vec3 water = mix(uShallowBase.a > 0.5 ? uShallowBase.rgb : uShallowColor, uDeepBase.a > 0.5 ? uDeepBase.rgb : uDeepColor, deep) + grain * mix(2.3, 0.95, deep);
        if (uNativeShallows && uShallowBase.a < 0.5 && uDeepBase.a < 0.5) {
            vec3 shallow = texture(uWaterShallow, pixel / vec2(textureSize(uWaterShallow, 0))).rgb;
            vec3 deepWater = texture(uWater, pixel / vec2(textureSize(uWater, 0))).rgb;
            water = mix(shallow, deepWater, deep);
            // Some worlds' water passes through a third colour; a straight
            // blend of the two textures lands on colours the art never uses.
            if (uWaterMid.a > 0.0) {
                float toMid = smoothstep(uShallowDepth, uWaterMid.a, colorDepth);
                float toDeep = smoothstep(uWaterMid.a, uDeepDepth, colorDepth);
                vec3 mid = uWaterMid.rgb + (deepWater - uWaterMean) * 0.9;
                water = mix(mix(shallow, mid, toMid), deepWater, toDeep);
            }
        }
        // Shared bed elevation makes a painted shallow passage persist even
        // far from shore; there is no fixed-width coastal blue collar.
        float submerged = smoothstep(-0.2, 2.8, depth);
        if (uCrispShore > 0.0) {
            // Retail waterlines are hard edges with small stair-step notches,
            // not soft fades: threshold depth against pixel-block jitter.
            vec2 block = floor(pixel / 2.0);
            float jitter = fract(sin(dot(block, vec2(12.9898, 78.233))) * 43758.5453) - 0.5;
            float crisp = step(0.6 + jitter * 1.4, depth);
            submerged = mix(submerged, crisp, uCrispShore);
        }
        color = mix(color, water * (0.92 + 0.08 * shadow), submerged);
    }
    if (uClay) {
        color = vec3(0.53, 0.51, 0.46) * shading;
        if (h < uSea) color = mix(color, vec3(0.20, 0.32, 0.40), 0.72);
    }
    color = clamp(color, 0.0, 1.0);
    if (uQuantize && !uClay) {
        // Ordered dither before the palette lookup: a fixed per-pixel
        // threshold pattern, so edits change only local pixels and level
        // ground keeps a repeating pattern. Strength is in palette-LUT steps.
        vec2 fc = floor(gl_FragCoord.xy);
        float ign = fract(52.9829189 * fract(dot(fc, vec2(0.06711056, 0.00583715))));
        // Smooth water gradients need dither; noisy ground grain does not.
        float ditherStrength = h < uSea + 1.0 ? uDither : uDither * uLandDither;
        color = clamp(color + (ign - 0.5) * ditherStrength / 31.0, 0.0, 1.0);
        color = paletteColor(color);
    }
    // Read-only pixel probes separate shaded form from material coverage.
    if (uDiagnostic == 1) color = vec3(lighting);
    if (uDiagnostic == 2) color = vec3(ao);
    if (uDiagnostic == 3) color = vec3(shadow);
    if (uDiagnostic == 4) color = vec3(exposed);
    if (uDiagnostic == 5) color = vec3(lighting, ao, shadow);
    if (uDiagnostic == 6) color = material;
    if (uDiagnostic == 7) { float code = bakedFields(p).b; color = vec3(clamp(-code, 0.0, 1.0), clamp(code - 1.0, 0.0, 1.0), clamp(0.5 + bakedFields(p).r * 0.08, 0.0, 1.0) * 0.6); }
    outColor = vec4(color, 1.0);
}
