// H5 (Green's engine): the Time pass's data maps. After erosion.wgsl has run (the host,
// sculpt-erosion.js, owns the order), one compute pass reads the final state of each
// sample and writes the maps the engine bake and draw steer their marks by, packed as
// rgba8 so they upload to gridTexture layers as they are. Same grid and 2-px spacing as
// the erosion pass; everything finer comes from the bake. One thread writes each sample.
//
//   layer 0  flow, deposit, talus, sand     (the layer the shared worker made; same meanings)
//   layer 2  wear, wetness, hardness, slope
//   layer 3  fall-line x, fall-line y (both 0.5 = none, 1 = +1), channel (rill depth), ridge (flow divergence)
//
// Deterministic: no atomics, reads are of buffers no thread writes.
/*COMMON*/

struct MP {
    grid: f32,
    spacing: f32,     // world px per sample
    flowScale: f32,   // turns water throughput into the shared worker's flow units (.36 / (age * rain))
    sand: f32,        // 0..1: how much of the deposit settles as sand (a rule, not a slab model)
    wetReach: f32,    // samples: the radius over which flow wets the ground beside it
    talusFull: f32,   // debris depth (height units) that counts as full talus
    wearFull: f32,    // rock lowered by this much (height units) counts as full wear
    flowK: f32,       // flow units at which the saturating flow map reaches one half
}

@group(1) @binding(0) var<uniform> mp: MP;
@group(1) @binding(1) var<storage, read> state: array<vec4f>;         // (rock, debris, water, sediment) after the last step
@group(1) @binding(2) var<storage, read> totals: array<vec4f>;        // x water throughput, y material deposited
@group(1) @binding(3) var<storage, read> fixedField: array<vec4f>;    // lower bound, upper bound, mobility (-1 submerged), column offset
@group(1) @binding(4) var<storage, read> authored: array<f32>;        // the height before erosion
@group(1) @binding(5) var<storage, read_write> layer0: array<u32>;
@group(1) @binding(6) var<storage, read_write> layer2: array<u32>;
@group(1) @binding(7) var<storage, read_write> layer3: array<u32>;

fn at(x: i32, y: i32) -> u32 { let n = i32(mp.grid); return u32(clamp(y, 0, n - 1) * n + clamp(x, 0, n - 1)); }
fn ground(i: u32) -> f32 { let s = state[i]; return s.x + s.y; }
fn flowAt(i: u32) -> f32 { let f = totals[i].x * mp.flowScale; return f / (f + mp.flowK); }

@compute @workgroup_size(8, 8)
fn mapsMain(@builtin(global_invocation_id) id: vec3u) {
    let n = i32(mp.grid);
    let x = i32(id.x); let y = i32(id.y);
    if (x >= n || y >= n) { return; }
    let i = at(x, y);
    let f = fixedField[i];
    if (f.z < 0.0) {
        layer0[i] = 0u; layer2[i] = 0u; layer3[i] = pack4x8unorm(vec4f(0.5, 0.5, 0.0, 0.0));
        return;
    }
    let c = state[i];
    // The ground's gradient over +-2 samples (4 px each side): the fall line the marks run along.
    let gx = (ground(at(x + 2, y)) - ground(at(x - 2, y))) / (4.0 * mp.spacing);
    let gy = (ground(at(x, y + 2)) - ground(at(x, y - 2))) / (4.0 * mp.spacing);
    let slope = length(vec2f(gx, gy));
    let fall = select(vec2f(0.0), -vec2f(gx, gy) / slope, slope > 1e-4);
    // Flow: the saturating scale of the shared worker, so the draw's readers see the same range.
    let flow = flowAt(i);
    let d = totals[i].y;
    let deposit = d / (d + 1.2);
    let talus = smoothstep(0.05, mp.talusFull, c.y);
    // Wetness: flow wets the ground beside it. A weighted mean of the flow over the reach.
    var wet = 0.0; var wsum = 0.0;
    let reach = i32(ceil(mp.wetReach));
    for (var dy = -reach; dy <= reach; dy++) {
        for (var dx = -reach; dx <= reach; dx++) {
            let r = length(vec2f(f32(dx), f32(dy)));
            if (r > mp.wetReach) { continue; }
            let w = 1.0 - r / (mp.wetReach + 1.0);
            let j = at(x + dx, y + dy);
            wet += w * select(0.0, flowAt(j), fixedField[j].z >= 0.0);
            wsum += w;
        }
    }
    wet = clamp(2.0 * wet / wsum, 0.0, 1.0);
    let wear = smoothstep(0.0, mp.wearFull, max(0.0, authored[i] - c.x));
    var hardness = 0.0;
    if (u.column > 0.0) { hardness = columnAt(c.x + f.w).hardness; }
    // Sand: a placement rule over deposit and slope (it settles where water dropped what it carried, on ground that is not steep).
    let sand = mp.sand * smoothstep(0.03, 0.30, deposit) * (1.0 - smoothstep(0.20, 0.60, slope)) * (1.0 - smoothstep(0.75, 1.0, flow));
    // Channel: where the flow runs hard over ground that falls (a rill's own floor); ridge: flow below its neighbours (the interfluve).
    let channel = smoothstep(0.03, 0.22, flow) * smoothstep(0.05, 0.25, slope);
    let ridge = clamp(1.0 - flow / max(wet, 0.05), 0.0, 1.0);
    layer0[i] = pack4x8unorm(vec4f(flow, deposit, talus, sand));
    layer2[i] = pack4x8unorm(vec4f(wear, wet, hardness, smoothstep(0.0, 1.5, slope)));
    layer3[i] = pack4x8unorm(vec4f(fall * 0.5 + 0.5, channel, ridge));
}
