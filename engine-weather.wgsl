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
    ox: f32,          // the window's first column and row of the world lattice (a page's window of a larger map; 0 for a whole map)
    oy: f32,
    drainWidth: f32,  // the drainage plane's side in lattice cells; 0 when the pass is given none
    drainStep: f32,   // world cells per lattice cell
    pad0: f32, pad1: f32, pad2: f32, pad3: f32,
}

@group(1) @binding(0) var<uniform> mp: MP;
@group(1) @binding(1) var<storage, read> state: array<vec4f>;         // (rock, debris, water, sediment) after the last step
@group(1) @binding(2) var<storage, read> totals: array<vec4f>;        // x water throughput, y material deposited
@group(1) @binding(3) var<storage, read> fixedField: array<vec4f>;    // lower bound, upper bound, mobility (-1 submerged), column offset
@group(1) @binding(4) var<storage, read> authored: array<f32>;        // the height before erosion
@group(1) @binding(5) var<storage, read_write> layer0: array<u32>;
@group(1) @binding(6) var<storage, read_write> layer2: array<u32>;
@group(1) @binding(7) var<storage, read_write> layer3: array<u32>;
@group(1) @binding(8) var<storage, read> drainage: array<vec2u>;      // P21: the whole map's drainage plane (area in lattice cells, receiver), or one dummy cell

fn at(x: i32, y: i32) -> u32 { let n = i32(mp.grid); return u32(clamp(y, 0, n - 1) * n + clamp(x, 0, n - 1)); }
fn ground(i: u32) -> f32 { let s = state[i]; return s.x + s.y; }
// P21: the exact drainage area, in lattice cells, of the plane cell nearest sample (x, y) of this window; 0 when the pass has no plane. The channel map and the
// consumers to come (fans, rills, stream power) read the whole map's catchments through this: the pass itself sees only its window and apron.
fn drainageAt(x: i32, y: i32) -> f32 {
    if (mp.drainWidth < 1.0) { return 0.0; }
    let w = i32(mp.drainWidth); let s = i32(mp.drainStep);
    let cx = clamp((i32(mp.ox) + x + s / 2) / s, 0, w - 1); let cy = clamp((i32(mp.oy) + y + s / 2) / s, 0, w - 1);
    return f32(drainage[u32(cy * w + cx)].x);
}
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
    if (u.columnSectionCount > 0 && u.columnContrast > 0.0) { hardness = columnAt(c.x - u.columnOrigin + f.w).hardness; }
    // Sand: a placement rule over deposit and slope (it settles where water dropped what it carried, on ground that is not steep).
    let sand = mp.sand * smoothstep(0.03, 0.30, deposit) * (1.0 - smoothstep(0.20, 0.60, slope)) * (1.0 - smoothstep(0.75, 1.0, flow));
    // Channel: where the flow runs hard over ground that falls (a rill's own floor); ridge: flow below its neighbours (the interfluve).
    let channel = smoothstep(0.03, 0.22, flow) * smoothstep(0.05, 0.25, slope);
    let ridge = clamp(1.0 - flow / max(wet, 0.05), 0.0, 1.0);
    layer0[i] = pack4x8unorm(vec4f(flow, deposit, talus, sand));
    layer2[i] = pack4x8unorm(vec4f(wear, wet, hardness, smoothstep(0.0, 1.5, slope)));
    layer3[i] = pack4x8unorm(vec4f(fall * 0.5 + 0.5, channel, ridge));
}

// H8 rule: the material field. Sediment that exposed ground sheds and rain carries downhill, as four channels the draw's mineral margins
// and transition read (gridTexture layer 1, via renderer.setMaterialField): arrival (how much carried material has come to rest here),
// soil (fine ground between the ribs), softened source (the join's coordinate) and source (exposed material). It runs when
// `materialWeathering` is above 0.
// Every pass reads the height the Time pass left. The drops are one thread each with a per-drop generator and scatter into fixed-point
// integer atomics, so the sums do not depend on thread order: the field is the same on every run. Group 2 is this rule's own.
//
//   mfSource    height -> source, gradient (x, y), basin
//   mfDrops     one thread a drop: carries a tracer downhill, scatters deposits and flow
//   mfCounts    the fixed-point deposit or flow counts as floats
//   mfBlur      one separable Gaussian pass (axis 0 then 1) over a buffer
//   mfCombine   the four channels
struct MF {
    grid: f32, spacing: f32, sea: f32, base: f32, spread: f32, seed: u32, count: u32, floorMode: f32,
    mineral: f32, elevatedFrom: f32, elevatedTo: f32, elevatedMix: f32, slopeStart: f32, slopeFull: f32, sigma: f32, axis: f32,
    ox: f32, oy: f32, pad0: f32, pad1: f32,   // the window's first lattice column and row: the hash and noise run on world cells, so a page's field joins its neighbours'
}
@group(2) @binding(0) var<uniform> mf: MF;
@group(2) @binding(1) var<storage, read> mfHeight: array<f32>;
@group(2) @binding(2) var<storage, read_write> mfSource: array<f32>;
@group(2) @binding(3) var<storage, read_write> mfGx: array<f32>;
@group(2) @binding(4) var<storage, read_write> mfGy: array<f32>;
@group(2) @binding(5) var<storage, read_write> mfBasin: array<f32>;
@group(2) @binding(6) var<storage, read_write> mfDeposit: array<atomic<u32>>;
@group(2) @binding(7) var<storage, read_write> mfFlow: array<atomic<u32>>;
@group(2) @binding(8) var<storage, read> mfIn: array<f32>;
@group(2) @binding(9) var<storage, read_write> mfOut: array<f32>;
@group(2) @binding(10) var<storage, read_write> mfField: array<vec4f>;
@group(2) @binding(11) var<storage, read> mfSettled: array<f32>;
@group(2) @binding(12) var<storage, read> mfBroad: array<f32>;
@group(2) @binding(13) var<storage, read> mfRunoff: array<f32>;
@group(2) @binding(14) var<storage, read> mfSoft: array<f32>;

const MF_FIXED = 4096.0;

fn mfSmooth(a: f32, b: f32, x: f32) -> f32 { let t = clamp((x - a) / (b - a), 0.0, 1.0); return t * t * (3.0 - 2.0 * t); }
fn mfHash(x: i32, y: i32, seed: u32) -> f32 {
    var h = (bitcast<u32>(x) * 374761393u) ^ (bitcast<u32>(y) * 668265263u) ^ seed;
    h = (h ^ (h >> 13u)) * 1274126177u;
    return f32(h ^ (h >> 16u)) / 4294967295.0;
}
fn mfNoise(x: f32, y: f32, seed: u32) -> f32 {
    let ix = floor(x); let iy = floor(y);
    let fx = mfSmooth(0.0, 1.0, x - ix); let fy = mfSmooth(0.0, 1.0, y - iy);
    let a = mfHash(i32(ix), i32(iy), seed); let b = mfHash(i32(ix) + 1, i32(iy), seed);
    let c = mfHash(i32(ix), i32(iy) + 1, seed); let d = mfHash(i32(ix) + 1, i32(iy) + 1, seed);
    return (a + (b - a) * fx) * (1.0 - fy) + (c + (d - c) * fx) * fy;
}
fn mfAt(x: i32, y: i32) -> i32 { let g = i32(mf.grid); return clamp(y, 0, g - 1) * g + clamp(x, 0, g - 1); }

@compute @workgroup_size(8, 8)
fn mfSourceMain(@builtin(global_invocation_id) id: vec3u) {
    let g = i32(mf.grid);
    if (i32(id.x) >= g || i32(id.y) >= g) { return; }
    let x = i32(id.x); let y = i32(id.y); let i = y * g + x;
    let h = mfHeight[i]; let l = mfHeight[mfAt(x - 1, y)]; let r = mfHeight[mfAt(x + 1, y)]; let u = mfHeight[mfAt(x, y - 1)]; let d = mfHeight[mfAt(x, y + 1)];
    let gx = (r - l) / (2.0 * mf.spacing); let gy = (d - u) / (2.0 * mf.spacing);
    mfGx[i] = gx; mfGy[i] = gy;
    var cover = mfSmooth(mf.slopeStart, mf.slopeFull, length(vec2f(gx, gy)));
    if (mf.mineral > 0.5) {
        let raised = mfSmooth(mf.base + mf.elevatedFrom, mf.base + mf.elevatedTo, h);
        cover = cover * (1.0 - mf.elevatedMix) + max(min(cover, 0.28), raised) * mf.elevatedMix;
    }
    // Ordinary low banks do not become sources of dry hill debris.
    let floorH = select(mf.base, mf.sea, mf.floorMode > 0.5);
    cover *= mfSmooth(floorH + 0.3, floorH + select(6.0, 3.0, mf.floorMode > 0.5), h);
    mfSource[i] = cover;
    // Concave resting places favour fine ground cover between exposed ribs.
    mfBasin[i] = mfSmooth(0.005, 0.12, (l + r + u + d - 4.0 * h) / (mf.spacing * mf.spacing));
}

fn mfSampleH(x: f32, y: f32) -> f32 {
    let g = mf.grid - 1.001; let xc = clamp(x, 0.0, g); let yc = clamp(y, 0.0, g);
    let xx = i32(floor(xc)); let yy = i32(floor(yc)); let fx = xc - f32(xx); let fy = yc - f32(yy);
    return (mfHeight[mfAt(xx, yy)] * (1.0 - fx) + mfHeight[mfAt(xx + 1, yy)] * fx) * (1.0 - fy) + (mfHeight[mfAt(xx, yy + 1)] * (1.0 - fx) + mfHeight[mfAt(xx + 1, yy + 1)] * fx) * fy;
}
fn mfSampleG(which: u32, x: f32, y: f32) -> f32 {
    let g = mf.grid - 1.001; let xc = clamp(x, 0.0, g); let yc = clamp(y, 0.0, g);
    let xx = i32(floor(xc)); let yy = i32(floor(yc)); let fx = xc - f32(xx); let fy = yc - f32(yy);
    var a: array<f32, 4>;
    for (var k = 0u; k < 4u; k++) {
        let j = mfAt(xx + i32(k & 1u), yy + i32(k >> 1u));
        a[k] = select(select(mfSource[j], mfGx[j], which == 1u), mfGy[j], which == 2u);
    }
    return (a[0] * (1.0 - fx) + a[1] * fx) * (1.0 - fy) + (a[2] * (1.0 - fx) + a[3] * fx) * fy;
}
fn mfScatter(isFlow: bool, x: f32, y: f32, value: f32) {
    let xx = i32(floor(x)); let yy = i32(floor(y)); let fx = x - f32(xx); let fy = y - f32(yy);
    for (var k = 0u; k < 4u; k++) {
        let wx = select(1.0 - fx, fx, (k & 1u) == 1u); let wy = select(1.0 - fy, fy, (k >> 1u) == 1u);
        let j = u32(mfAt(xx + i32(k & 1u), yy + i32(k >> 1u)));
        let amount = u32(max(value * wx * wy, 0.0) * MF_FIXED + 0.5);
        if (isFlow) { atomicAdd(&mfFlow[j], amount); } else { atomicAdd(&mfDeposit[j], amount); }
    }
}

@compute @workgroup_size(64)
fn mfDropsMain(@builtin(global_invocation_id) id: vec3u) {
    // One thread a cell of the window: a drop starts in the cell with probability 0.52, from a generator seeded by the world cell. The
    // density and the drops themselves do not depend on how the map is cut into windows or pages.
    if (id.x >= mf.count) { return; }
    let g = mf.grid;
    let cx = f32(id.x % u32(g)); let cy = f32(id.x / u32(g));
    let wcx = u32(i32(mf.ox + cx)); let wcy = u32(i32(mf.oy + cy));
    var rng = (mf.seed ^ 0x4e91ad7bu ^ (wcx * 2654435761u) ^ (wcy * 2246822519u)); rng = (rng ^ (rng >> 15u)) * 2246822519u; rng = (rng ^ (rng >> 13u)) * 3266489917u; rng |= 1u;
    // xorshift32, as the worker's generator
    var s = rng;
    s ^= s << 13u; s ^= s >> 17u; s ^= s << 5u; let r0 = f32(s) / 4294967296.0;
    s ^= s << 13u; s ^= s >> 17u; s ^= s << 5u; let r1 = f32(s) / 4294967296.0;
    s ^= s << 13u; s ^= s >> 17u; s ^= s << 5u; let rs = f32(s) / 4294967296.0;
    if (rs > 0.52) { return; }
    var x = min(cx + r0, g - 1.5); var y = min(cy + r1, g - 1.5);
    let start = mfSampleG(0u, x, y); let sx = mfSampleG(1u, x, y); let sy = mfSampleG(2u, x, y); let slope = length(vec2f(sx, sy));
    s ^= s << 13u; s ^= s >> 17u; s ^= s << 5u; let ticket = f32(s) / 4294967296.0;
    if (start < 0.04 || slope < 0.04 || ticket > start) { return; }
    var dx = -sx / slope; var dy = -sy / slope; var mass = 0.35 + start * 0.65; var travel = 0.0;
    let step = 2.5 / mf.spacing; let reach = 28.0 + mf.spread * 85.0;
    for (var life = 0; life < 90 && mass > 0.006; life++) {
        let h = mfSampleH(x, y); let xx = mfSampleG(1u, x, y); let yy = mfSampleG(2u, x, y); let grade = length(vec2f(xx, yy));
        if (h <= mf.sea + 0.2) { break; }
        if (grade > 0.018) { dx = dx * 0.78 - xx / max(0.08, grade) * 0.22; dy = dy * 0.78 - yy / max(0.08, grade) * 0.22; }
        let bend = (mfNoise((x + mf.ox) * mf.spacing / 23.0, (y + mf.oy) * mf.spacing / 23.0, mf.seed ^ 0x6173u) - 0.5) * 0.20;
        let vx = dx - dy * bend; let vy = dy + dx * bend; let norm = length(vec2f(vx, vy));
        dx = vx / norm; dy = vy / norm;
        let nx = x + dx * step; let ny = y + dy * step;
        if (nx < 0.0 || ny < 0.0 || nx >= g - 1.0 || ny >= g - 1.0) { break; }
        let rise = mfSampleH(nx, ny) - h;
        if (rise > 0.65) { mfScatter(false, x, y, mass); break; }
        mfScatter(true, x, y, start * 0.12);
        let settling = 0.012 + 0.17 * (1.0 - mfSmooth(0.03, 0.55, grade)) + 0.06 * mfSmooth(reach * 0.4, reach, travel);
        let put = mass * settling; mfScatter(false, x, y, put); mass -= put;
        x = nx; y = ny; travel += 2.5;
        if (travel > reach || life == 89) { mfScatter(false, x, y, mass); break; }
    }
}

@compute @workgroup_size(8, 8)
fn mfCountsMain(@builtin(global_invocation_id) id: vec3u) {
    let g = i32(mf.grid);
    if (i32(id.x) >= g || i32(id.y) >= g) { return; }
    let i = i32(id.y) * g + i32(id.x);
    mfOut[i] = f32(select(atomicLoad(&mfDeposit[i]), atomicLoad(&mfFlow[i]), mf.axis > 1.5)) / MF_FIXED;
}

// A blur reads mfIn (the host binds the source, the deposit or the flow) and writes mfOut.
@compute @workgroup_size(8, 8)
fn mfBlurMain(@builtin(global_invocation_id) id: vec3u) {
    let g = i32(mf.grid);
    if (i32(id.x) >= g || i32(id.y) >= g) { return; }
    let x = i32(id.x); let y = i32(id.y);
    let sigma = max(0.6, mf.sigma / mf.spacing); let radius = i32(ceil(sigma * 2.5));
    var v = 0.0; var total = 0.0;
    for (var k = -radius; k <= radius; k++) {
        let w = exp(-0.5 * pow(f32(k) / sigma, 2.0));
        let j = select(mfAt(x + k, y), mfAt(x, y + k), mf.axis > 0.5);
        v += mfIn[j] * w; total += w;
    }
    mfOut[y * g + x] = v / total;
}

@compute @workgroup_size(8, 8)
fn mfCombineMain(@builtin(global_invocation_id) id: vec3u) {
    let g = i32(mf.grid);
    if (i32(id.x) >= g || i32(id.y) >= g) { return; }
    let i = i32(id.y) * g + i32(id.x);
    if (mfHeight[i] <= mf.sea + 0.2) { mfField[i] = vec4f(0.0); return; }
    let wx = (f32(id.x) + mf.ox) * mf.spacing; let wy = (f32(id.y) + mf.oy) * mf.spacing;
    let clusters = 0.65 * mfNoise(wx / 31.0, wy / 31.0, mf.seed ^ 0x941au) + 0.35 * mfNoise(wx / 11.0, wy / 11.0, mf.seed ^ 0x4b79u);
    let arrival = 1.0 - exp(-(mfSettled[i] * 0.75 + mfBroad[i] * 0.25) * 2.8);
    let soil = (1.0 - mfSource[i]) * 0.22 + mfBasin[i] * 0.6 + mfRunoff[i] / (mfRunoff[i] + 3.0) * 0.26;
    mfField[i] = vec4f(arrival, clamp(soil * (0.35 + clusters * 1.1), 0.0, 1.0), mfSoft[i], mfSource[i]);
}
