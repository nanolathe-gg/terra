// The output stage: the draw's lit color (true color) reduced to the game palette, the last step of every picture.
// Each 32 x 32 art tile (the game's tile, keyed to art pixels so an export's tiles are TNT tiles) is reduced on its own by serpentine
// Floyd-Steinberg error diffusion, so a tile's colors depend only on that tile's lit colors: the same lit tile always comes out the same,
// level ground repeats as it did, and a redrawn region rediffuses only its own tiles. The error starts at zero in each tile; a 32 px grid
// does not show (prototype, by eye on water, slopes and Desert's bands).
// DAMP carries 0.8 of each pixel's error on: full error diffusion over the whole palette scatters far hues (dark green flecks in Green's
// blue water) where the error builds up; 0.8 keeps the mean (within a level on the prototype's crops) and drops most of them.
// A job that is not enabled (palette off, Clay, a diagnostic view, a zoomed-out or resampled picture) passes the true color through.
struct Job {
    origin: vec2i,   // the art (or drawn) pixel of the source's texel 0,0
    size: vec2u,     // the source's texels
    offset: vec2i,   // where the blit puts the result in its target
    count: u32,      // palette colors
    enabled: u32,
}
@group(0) @binding(0) var source: texture_2d<f32>;
@group(0) @binding(1) var reduced: texture_storage_2d<rgba8unorm, write>;
@group(0) @binding(2) var<storage, read> palette: array<vec4f>;   // rgb in 0..255
@group(0) @binding(3) var<uniform> job: Job;
@group(0) @binding(4) var shown: texture_2d<f32>;

const TILE = 32;
const DAMP = 0.8;
var<workgroup> colors: array<vec3f, 256>;

@compute @workgroup_size(64)
fn diffuseTiles(@builtin(global_invocation_id) id: vec3u, @builtin(local_invocation_index) lane: u32) {
    for (var i = lane; i < min(job.count, 256u); i += 64u) { colors[i] = palette[i].rgb; }
    workgroupBarrier();
    let size = vec2i(job.size);
    // The source texel of the first tile's corner (at or before 0), and the tiles that cover the source.
    let first = vec2i(floor(vec2f(job.origin) / f32(TILE))) * TILE - job.origin;
    let tiles = (size - first + vec2i(TILE - 1)) / TILE;
    if (i32(id.x) >= tiles.x * tiles.y) { return; }
    let corner = first + vec2i(i32(id.x) % tiles.x, i32(id.x) / tiles.x) * TILE;
    var row: array<vec3f, 34>;    // this row's carried error, one cell of border each side
    var next: array<vec3f, 34>;
    for (var y = 0; y < TILE; y++) {
        for (var k = 0; k < 34; k++) { next[k] = vec3f(0.0); }
        let forward = (y & 1) == 0;
        let d = select(-1, 1, forward);
        for (var s = 0; s < TILE; s++) {
            let x = select(TILE - 1 - s, s, forward);
            let p = corner + vec2i(x, y);
            if (any(p < vec2i(0)) || any(p >= size)) { continue; }
            let raw = textureLoad(source, p, 0).rgb;
            if (job.enabled == 0u) { textureStore(reduced, p, vec4f(raw, 1.0)); continue; }
            let want = clamp(round(raw * 255.0) + row[x + 1], vec3f(0.0), vec3f(255.0));
            var best = colors[0];
            var distance = 1e20;
            for (var i = 0u; i < job.count; i++) {
                let delta = colors[i] - want;
                let e = dot(delta, delta);
                if (e < distance) { distance = e; best = colors[i]; }
            }
            textureStore(reduced, p, vec4f(best / 255.0, 1.0));
            let error = (want - best) * DAMP;
            row[x + 1 + d] += error * (7.0 / 16.0);
            next[x + 1 - d] += error * (3.0 / 16.0);
            next[x + 1] += error * (5.0 / 16.0);
            next[x + 1 + d] += error * (1.0 / 16.0);
        }
        row = next;
    }
}

// The reduced picture into the presentation target (the canvas's format, which a storage texture may not have), at job.offset.
@vertex
fn blitVertex(@builtin(vertex_index) i: u32) -> @builtin(position) vec4f {
    let p = vec2f(f32((i << 1u) & 2u), f32(i & 2u));
    return vec4f(p * 2.0 - 1.0, 0.0, 1.0);
}
@fragment
fn blitFragment(@builtin(position) at: vec4f) -> @location(0) vec4f {
    return vec4f(textureLoad(shown, vec2i(floor(at.xy)) - job.offset, 0).rgb, 1.0);
}
