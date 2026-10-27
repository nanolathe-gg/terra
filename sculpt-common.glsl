// Authored terrain appearance experiment. No recovered retail rendering claim.
uniform sampler2D uHeight;
uniform sampler2D uNoise;
uniform sampler2D uFractures;
uniform sampler2D uWeather;
uniform sampler2D uRoutes;
uniform sampler2D uMaterialField;
uniform float uMaterialWeathering;
uniform bool uMaterialReady;
uniform float uFractureAmount;
uniform float uFractureDepth;
uniform bool uRockyCoasts;
uniform bool uScree;
uniform float uGrid;
uniform float uSize;
uniform float uBase;
uniform float uSea;
uniform float uDetail;
uniform bool uLayered;
uniform bool uTerraced;
uniform bool uCoastalDetail;
uniform vec3 uLight;

float baseHeight(vec2 p) {
    vec2 q = clamp(p / (uSize - 1.0), 0.0, 1.0) * (uGrid - 1.0);
    ivec2 a = ivec2(floor(q));
    ivec2 b = min(a + 1, ivec2(int(uGrid) - 1));
    vec2 f = fract(q);
    return mix(mix(texelFetch(uHeight, a, 0).r,
                   texelFetch(uHeight, ivec2(b.x, a.y), 0).r, f.x),
               mix(texelFetch(uHeight, ivec2(a.x, b.y), 0).r,
                   texelFetch(uHeight, b, 0).r, f.x), f.y);
}

vec2 broadGradient(vec2 p) {
    const float e = 5.0;
    return vec2(baseHeight(p + vec2(e, 0)) - baseHeight(p - vec2(e, 0)),
                baseHeight(p + vec2(0, e)) - baseHeight(p - vec2(0, e))) / (2.0 * e);
}

vec4 terrainNoise(vec2 p) {
    return texture(uNoise, (p + vec2(37.0, 83.0)) / 512.0);
}

float routeProtection(vec2 p) {
    return texture(uRoutes, (p / (uSize - 1.0) * (uGrid - 1.0) + 0.5) / uGrid).r;
}

float fractureDepth(vec2 p, float h, float slope) {
    float floorHeight = uRockyCoasts ? uSea : uBase;
    if (uFractureAmount <= 0.0 || h < floorHeight + 1.0 || slope < 0.06) return 0.0;
    vec2 warp = vec2(terrainNoise(p).g, terrainNoise(p + vec2(71.0, 43.0)).g) - 0.5;
    vec4 crack = texture(uFractures, (p + warp * 6.0) / 1024.0);
    float distance = (1.0 - crack.r) * 8.0;
    float group = smoothstep(crack.g - 0.025, crack.g + 0.025, uFractureAmount);
    float ground = smoothstep(0.06, 0.28, slope) * (1.0 - smoothstep(1.30, 2.20, slope));
    ground *= smoothstep(floorHeight + 1.0, floorHeight + 10.0, h);
    // Grass may bridge the finite cleft. Carving and its lit edges share the
    // same surface; this is optional authoring detail, not stored retail relief.
    float bridge = smoothstep(0.30, 0.64, terrainNoise(p + vec2(11.0, 68.0)).g);
    // A shallow weathered shoulder carries the narrower cut. Varying its
    // section avoids a constant-width ink stroke across the grass texture.
    float width = mix(0.65, 1.15, terrainNoise(p + vec2(91.0, 17.0)).b);
    float shoulder = 1.0 - smoothstep(0.20, 3.50 * width, distance);
    float core = 1.0 - smoothstep(0.05, 0.85 * width, distance);
    return (shoulder * 0.8 + core * 1.6) * group * ground * bridge * crack.b * uFractureDepth * (1.0 - routeProtection(p));
}

float screeHeight(vec2 p) {
    if (!uScree) return 0.0;
    float support = texture(uWeather, p / (uSize - 1.0)).b;
    if (support < 0.005) return 0.0;
    // Small authored angular fragments share lighting with the terrain. The
    // worker admits them only in clustered dry cliff-foot deposits.
    vec2 cell = floor(p / 7.0);
    vec3 random = fract(sin(vec3(dot(cell, vec2(127.1, 311.7)),
                                dot(cell, vec2(269.5, 183.3)),
                                dot(cell, vec2(419.2, 71.9)))) * 43758.5453);
    float present = smoothstep(random.x - 0.04, random.x + 0.04, support * 0.75);
    vec2 q = mod(p, 7.0) - 3.5 + (random.yz - 0.5) * 2.0;
    float radius = 1.1 + random.y * 1.5;
    float edge = max(max(abs(q.x) * 0.85, abs(q.y)), abs(q.x * 0.65 + q.y * 0.76));
    return max(0.0, 1.0 - edge / radius) * (1.0 + random.z * 1.5) * present;
}

float materialChipHeight(vec2 p) {
    if (!uMaterialReady || uMaterialWeathering<=0.0) return 0.0;
    vec4 deposit=texture(uMaterialField,(p/(uSize-1.0)*(uGrid-1.0)+0.5)/uGrid);
    float support=deposit.r*(1.0-smoothstep(0.15,0.60,deposit.a))*uMaterialWeathering;
    if (support<0.03) return 0.0;
    vec2 cell=floor(p/9.0);
    vec3 random=fract(sin(vec3(dot(cell,vec2(127.1,311.7)),dot(cell,vec2(269.5,183.3)),dot(cell,vec2(419.2,71.9))))*43758.5453);
    float present=smoothstep(random.x-0.06,random.x+0.06,support*0.65);
    vec2 q=mod(p,9.0)-4.5+(random.yz-0.5)*4.0;
    float radius=0.65+random.y*1.85;
    float edge=max(max(abs(q.x)*0.85,abs(q.y)),abs(q.x*0.65+q.y*0.76));
    return max(0.0,1.0-edge/radius)*(0.25+random.z*0.55)*present;
}

float surfaceHeight(vec2 p) {
    float h = baseHeight(p);
    float rough = 1.0 - routeProtection(p);
    // Author intent applies to rendered geometry as well as the weathering
    // worker. A graded route cannot acquire extra clefts or rubble afterward.
    if (rough < 0.001) return h;
    float debris = (screeHeight(p)+materialChipHeight(p)) * rough;
    if (uCoastalDetail && abs(h - uSea) < 6.0) {
        // Break only the waterline into small shared geometric irregularities.
        // The designed shallow-route bed (-7) and broad flats stay untouched.
        vec4 shoreNoise = terrainNoise(p);
        float collar = 1.0 - smoothstep(2.0, 6.0, abs(h - uSea));
        h += ((shoreNoise.g - 0.5) * 4.0 + (shoreNoise.a - 0.5) * 1.7) * collar * rough;
    }
    if (h < -12.0) return h;
    float slope = length(broadGradient(p));
    if (slope < 0.10) return h + debris;
    vec4 n = terrainNoise(p);
    // The same displaced surface supplies projection, normals and occlusion.
    // Broad form is authored by the brush; detail stays small relative to it.
    float gain = smoothstep(0.10, 0.72, slope) * smoothstep(-12.0, 14.0, h);
    if (uLayered) {
        float cliff = smoothstep(0.8, 1.8, slope) * smoothstep(0.0, 18.0, h) * rough;
        // A bounded irregular face displacement and interrupted short ledges
        // challenge the smooth extrusion; protected broad flats stay level.
        vec2 warp = vec2(n.g, terrainNoise(p + vec2(191.0, 317.0)).g) - 0.5;
        h = mix(h, baseHeight(p + warp * (uTerraced ? 16.0 : 24.0)), cliff);
        float phase = h / 18.0 + (n.r - 0.5) * 2.0 + (n.g - 0.5) * 0.8;
        float f = fract(phase);
        h += (smoothstep(0.20, 0.80, f) - f) * (uTerraced ? 16.5 : 12.6) * cliff;
    }
    float facets = 2.0 + 14.0 * smoothstep(0.9, 2.6, slope);
    float detail = (n.g - 0.5) * 6.0 + (n.b - 0.5) * facets;
    return h + detail * gain * uDetail * rough + debris - fractureDepth(p, h, slope);
}

vec2 surfaceGradient(vec2 p) {
    const float e = 1.4;
    return vec2(surfaceHeight(p + vec2(e, 0)) - surfaceHeight(p - vec2(e, 0)),
                surfaceHeight(p + vec2(0, e)) - surfaceHeight(p - vec2(0, e))) / (2.0 * e);
}
