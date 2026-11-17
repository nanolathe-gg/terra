// H6b (Green): the map canvas fed from the GPU fields. Compute passes that read the whole-map buffers of the GPU shape fields
// (sculpt-gpu-fields.js) and the Time pass's own buffers, and write what the CPU used to pack and upload:
//
//   Time pass input    seedMain, tileFlagMain, tileListMain, tileArgsMain   the erosion state, its fixed field (bounds, mobility) and the
//                                                                          list of active 8 x 8 tiles, from the height, protection and
//                                                                          erosion-rate planes (sculpt-erosion.js fixedField, in f32)
//   Time pass output   refinedMain                                         the eroded height beside the authored one
//   Time pass cells    timeDownMain, timeUpHeightMain, timeUpMapsMain      a lattice finer than the Time pass's cell (sculpt-erosion.js TIME_CELL):
//                                                                          its height, protection and masks on the pass's cells, then the
//                                                                          pass's change and maps back on the lattice
//   Chunk bake         feedMain                                            one chunk's height, route, weather/material and mask textures
//                                                                          (sculpt-chunk-renderer.js upload, in f32), and the painted flags
//
// Planes: F holds h p r c v x u as seven f32 planes of grid * grid; Mk holds the 25 int8 mask planes, 7 words a cell (engine-shape.wgsl).
// Every pass is one thread per output element and no thread reads what another writes in the same dispatch (atomics aside, and those
// only gather flags), so the results do not depend on thread order.

struct FU {
    grid: u32,
    cells: u32,
    ox: i32,            // the chunk's first lattice column and row
    oy: i32,
    gw: u32,            // the chunk textures' size
    gh: u32,
    cw: u32,            // the chunk's lattice size; texels beyond it repeat the last column and row
    ch: u32,
    mode: u32,          // 1: blend the Time pass's height, 2: the weather maps are present, 4: export art (height clamped to 0..255), 8: the material field is present
    rateMask: u32,      // the mask plane that holds the erosion override
    sea: f32,
    spacing: f32,
    envelope: f32,      // the erosion budget's envelope (erosionEnvelope)
    tilesWide: u32,
    pad0: u32,
    pad1: u32,
    invalidRect: vec4i, // authored edits since this refinement result; empty when current
}

@group(0) @binding(0) var<uniform> fu: FU;
@group(0) @binding(1) var<storage, read> F: array<f32>;
@group(0) @binding(2) var<storage, read> Mk: array<u32>;

// ---------------------------------------------------------------- Time pass input

@group(1) @binding(0) var<storage, read_write> st0: array<vec4f>;
@group(1) @binding(1) var<storage, read_write> st1: array<vec4f>;
@group(1) @binding(2) var<storage, read_write> st2: array<vec4f>;
@group(1) @binding(3) var<storage, read_write> fixedField: array<vec4f>;   // lower bound, upper bound, mobility (-1 submerged), column offset
@group(1) @binding(4) var<storage, read_write> tileFlag: array<atomic<u32>>;
@group(1) @binding(5) var<storage, read_write> tileList: array<vec2u>;
@group(1) @binding(6) var<storage, read_write> tileCount: atomic<u32>;
@group(1) @binding(7) var<storage, read_write> tileArgs: array<u32>;
@group(1) @binding(8) var<storage, read_write> refinedOut: array<f32>;      // the weather buffer: plane 0 the authored height, plane 1 (written here) the eroded height
@group(1) @binding(9) var<storage, read> finalState: array<vec4f>;
@group(1) @binding(10) var<storage, read_write> totals: array<vec4f>;      // the Time pass's totals: seedMain writes the painted repose share into z

const SHORE_BUDGET = 0.35;
const BUDGET = 3.0;

fn sm(a: f32, b: f32, v: f32) -> f32 { let t = clamp((v - a) / (b - a), 0.0, 1.0); return t * t * (3.0 - 2.0 * t); }
fn maskByte(i: u32, p: u32) -> i32 {
    let w = Mk[i * 7u + (p >> 2u)];
    return (i32(w << (24u - (p & 3u) * 8u))) >> 24u;
}
fn height(x: i32, y: i32) -> f32 { return F[u32(y) * fu.grid + u32(x)]; }
fn gradientAt(x: i32, y: i32) -> f32 {
    let n = i32(fu.grid);
    let lx = max(0, x - 1); let rx = min(n - 1, x + 1); let ty = max(0, y - 1); let by = min(n - 1, y + 1);
    return length(vec2f((height(rx, y) - height(lx, y)) / (f32(rx - lx) * fu.spacing), (height(x, by) - height(x, ty)) / (f32(by - ty) * fu.spacing)));
}

@compute @workgroup_size(8, 8)
fn seedMain(@builtin(global_invocation_id) id: vec3u) {
    let n = i32(fu.grid);
    let x = i32(id.x); let y = i32(id.y);
    if (x >= n || y >= n) { return; }
    let i = u32(y) * fu.grid + u32(x);
    let h = F[i];
    // Every state buffer starts with the authored height: the tiles the steps never visit keep it.
    st0[i] = vec4f(h, 0.0, 0.0, 0.0); st1[i] = st0[i]; st2[i] = st0[i];
    var out = vec4f(h, h, 0.0, 0.0);
    let sea = fu.sea;
    if (h <= sea) { out.z = -1.0; fixedField[i] = out; return; }
    let p = F[fu.cells + i];
    if (p >= 1.0) { fixedField[i] = out; return; }
    var slope = gradientAt(x, y);
    for (var yy = max(0, y - 1); yy <= min(n - 1, y + 1); yy++) { for (var xx = max(0, x - 1); xx <= min(n - 1, x + 1); xx++) { slope = max(slope, gradientAt(xx, yy)); } }
    let weight = sm(0.035, 0.20, slope) * (1.0 - clamp(p, 0.0, 1.0));
    if (weight <= 0.0) { fixedField[i] = out; return; }
    let steep = sm(0.7, 1.5, slope);
    let budget = SHORE_BUDGET + (BUDGET * fu.envelope - SHORE_BUDGET) * sm(sea + 2.0, sea + 20.0, h);
    out.x = max(max(sea - 90.0, min(h, sea + 1.0)), h - (4.0 + 8.0 * steep) * budget * weight);
    out.y = min(sea + 300.0, h + (2.5 + 2.5 * steep) * budget * weight);
    // The erosion override plane is a rate: 1 + v / 127 (no erosion at -1).
    let rate = 1.0 + f32(maskByte(i, fu.rateMask)) / 127.0;
    out.z = weight * max(0.0, rate);
    // The same plane scales the thermal repose by the same rate (a share of 0 where nothing is painted), read by thermalMain through the pair's mean.
    totals[i].z = max(0.0, rate) - 1.0;
    fixedField[i] = out;
}

@compute @workgroup_size(8, 8)
fn tileFlagMain(@builtin(global_invocation_id) id: vec3u) {
    let n = fu.grid;
    if (id.x >= n || id.y >= n) { return; }
    if (fixedField[id.y * n + id.x].z > 0.0) { atomicStore(&tileFlag[(id.y >> 3u) * fu.tilesWide + (id.x >> 3u)], 1u); }
}

// A tile is active when it or a tile beside it holds a sample that can move. The list's order is whatever the atomic gives; the steps
// write one sample per thread from buffers they do not write, so the order does not matter.
@compute @workgroup_size(8, 8)
fn tileListMain(@builtin(global_invocation_id) id: vec3u) {
    let tw = i32(fu.tilesWide);
    let tx = i32(id.x); let ty = i32(id.y);
    if (tx >= tw || ty >= tw) { return; }
    var on = false;
    for (var dy = -1; dy <= 1; dy++) {
        for (var dx = -1; dx <= 1; dx++) {
            let a = tx + dx; let b = ty + dy;
            if (a >= 0 && b >= 0 && a < tw && b < tw && atomicLoad(&tileFlag[u32(b * tw + a)]) != 0u) { on = true; }
        }
    }
    if (on) { let k = atomicAdd(&tileCount, 1u); tileList[k] = vec2u(u32(tx), u32(ty)); }
}

@compute @workgroup_size(1)
fn tileArgsMain() {
    tileArgs[0] = atomicLoad(&tileCount); tileArgs[1] = 1u; tileArgs[2] = 1u;
}

@compute @workgroup_size(8, 8)
fn refinedMain(@builtin(global_invocation_id) id: vec3u) {
    let n = fu.grid;
    if (id.x >= n || id.y >= n) { return; }
    let i = id.y * n + id.x;
    let s = finalState[i];
    refinedOut[fu.cells + i] = s.x + s.y;
}

// ---------------------------------------------------------------- chunk bake

@group(2) @binding(0) var<storage, read> W: array<f32>;      // plane 0: the authored height the Time pass started from; plane 1: its result
@group(2) @binding(1) var<storage, read> map0: array<u32>;   // the Time pass's maps, rgba8 a sample: flow, deposit, talus, sand
@group(2) @binding(2) var<storage, read> map1: array<u32>;   // wear, wetness, hardness, slope
@group(2) @binding(3) var<storage, read> map2: array<u32>;   // fall line x, fall line y, channel, ridge
@group(2) @binding(4) var<storage, read_write> painted: atomic<u32>;
@group(2) @binding(5) var outHeight: texture_storage_2d<r32float, write>;
@group(2) @binding(6) var outRoutes: texture_storage_2d<rgba8unorm, write>;
@group(2) @binding(7) var outGrid: texture_storage_2d_array<rgba8unorm, write>;
@group(2) @binding(8) var outMasks: texture_storage_2d_array<rgba8snorm, write>;
@group(2) @binding(9) var<storage, read> fieldIn: array<vec4f>;   // the material field (engine-weather.wgsl mf*): arrival, soil, softened source, source

var<workgroup> groupPainted: atomic<u32>;

fn toByte(v: f32) -> f32 { return floor(clamp(v, 0.0, 1.0) * 255.0 + 0.5) / 255.0; }

@compute @workgroup_size(8, 8)
fn feedMain(@builtin(global_invocation_id) id: vec3u, @builtin(local_invocation_index) li: u32) {
    if (li == 0u) { atomicStore(&groupPainted, 0u); }
    workgroupBarrier();
    var bits = 0u;
    if (id.x < fu.gw && id.y < fu.gh) {
        let cx = i32(min(id.x, fu.cw - 1u)); let cy = i32(min(id.y, fu.ch - 1u));
        let i = u32(fu.oy + cy) * fu.grid + u32(fu.ox + cx);
        var h = F[i];
        let r = F[2u * fu.cells + i];
        let cell = vec2i(fu.ox + cx, fu.oy + cy);
        let valid = !all(cell >= fu.invalidRect.xy) || !all(cell <= fu.invalidRect.zw);
        if ((fu.mode & 1u) != 0u && valid) {
            let base = W[i]; let refined = W[fu.cells + i];
            h = h + (refined - base) * (1.0 - sm(0.0, 10.0, abs(h - base))) * (1.0 - r);
        }
        h = h - F[6u * fu.cells + i];   // the art's height: less the undulation it does not show (engine-shape.wgsl artLevel); the game's keeps it
        if ((fu.mode & 4u) != 0u) { h = clamp(h, 0.0, 255.0); }
        let xy = vec2i(i32(id.x), i32(id.y));
        textureStore(outHeight, xy, vec4f(h - fu.sea, 0.0, 0.0, 0.0));
        textureStore(outRoutes, xy, vec4f(toByte(r), toByte(F[3u * fu.cells + i]), floor((clamp(F[4u * fu.cells + i], -1.0, 1.0) * 0.5 + 0.5) * 255.0 + 0.5) / 255.0, toByte(F[5u * fu.cells + i])));
        textureStore(outGrid, xy, 0, select(vec4f(0.0), unpack4x8unorm(map0[i]), (fu.mode & 2u) != 0u && valid));
        if ((fu.mode & 8u) != 0u && valid) { let m = fieldIn[i]; textureStore(outGrid, xy, 1, vec4f(toByte(m.x), toByte(m.y), toByte(m.z), toByte(m.w))); } else { textureStore(outGrid, xy, 1, vec4f(0.0)); }
        textureStore(outGrid, xy, 2, select(vec4f(0.0), unpack4x8unorm(map1[i]), (fu.mode & 2u) != 0u && valid));
        textureStore(outGrid, xy, 3, select(vec4f(0.0), unpack4x8unorm(map2[i]), (fu.mode & 2u) != 0u && valid));
        for (var l = 0u; l < 7u; l++) {
            let w = Mk[i * 7u + l];
            let b = vec4i(i32(w << 24u) >> 24u, i32(w << 16u) >> 24u, i32(w << 8u) >> 24u, i32(w) >> 24u);
            textureStore(outMasks, xy, l, vec4f(b) / 127.0);
            // Only the lattice itself counts as painted; the repeated edge texels hold the same bytes.
            if (id.x < fu.cw && id.y < fu.ch) {
                for (var k = 0u; k < 4u; k++) { if (l * 4u + k < 25u && b[k] != 0) { bits |= 1u << (l * 4u + k); } }
            }
        }
    }
    if (bits != 0u) { atomicOr(&groupPainted, bits); }
    workgroupBarrier();
    if (li == 0u) { let g = atomicLoad(&groupPainted); if (g != 0u) { atomicOr(&painted, g); } }
}

// ---------------------------------------------------------------- H5b: gather a rectangle of the map from pages
// A page is a block of the map in its own buffers (sculpt-gpu-fields.js createPagedFields). A chunk's lattice spans a few of them, so each source page
// copies the part of the rectangle it holds into one staging set laid out as a small whole map (stride dw, plane size dw * dh); feedMain then runs on
// the staging set unchanged. x, y are world lattice cells. Three entry points keep each pass to at most seven storage buffers: the shape planes and masks,
// the Time pass's height planes, its three packed maps.

struct GU {
    sox: i32,           // the source buffer's first cell and size (a shape page: its ring included; a weather page: its core)
    soy: i32,
    spw: u32,
    sph: u32,
    x0: i32,            // the cells to copy (inclusive), inside the source
    y0: i32,
    x1: i32,
    y1: i32,
    dox: i32,           // the staging set's first cell and size
    doy: i32,
    dw: u32,
    dh: u32,
    invalidRect: vec4i,
}
@group(3) @binding(0) var<uniform> gu: GU;
@group(3) @binding(1) var<storage, read> gsF: array<f32>;
@group(3) @binding(2) var<storage, read> gsMk: array<u32>;
@group(3) @binding(3) var<storage, read_write> gdF: array<f32>;
@group(3) @binding(4) var<storage, read_write> gdMk: array<u32>;
@group(3) @binding(5) var<storage, read> gsW: array<f32>;
@group(3) @binding(6) var<storage, read_write> gdW: array<f32>;
@group(3) @binding(7) var<storage, read> gsM0: array<u32>;
@group(3) @binding(8) var<storage, read> gsM1: array<u32>;
@group(3) @binding(9) var<storage, read> gsM2: array<u32>;
@group(3) @binding(10) var<storage, read_write> gdM0: array<u32>;
@group(3) @binding(11) var<storage, read_write> gdM1: array<u32>;
@group(3) @binding(12) var<storage, read_write> gdM2: array<u32>;

fn gatherAt(id: vec3u) -> vec3i {   // (source index, destination index, valid)
    let x = gu.x0 + i32(id.x); let y = gu.y0 + i32(id.y);
    if (x > gu.x1 || y > gu.y1) { return vec3i(0, 0, 0); }
    return vec3i(i32(u32(y - gu.soy) * gu.spw + u32(x - gu.sox)), i32(u32(y - gu.doy) * gu.dw + u32(x - gu.dox)), 1);
}
fn gatherRefinementValid(id: vec3u) -> bool {
    let cell = vec2i(gu.x0 + i32(id.x), gu.y0 + i32(id.y));
    return !all(cell >= gu.invalidRect.xy) || !all(cell <= gu.invalidRect.zw);
}

@compute @workgroup_size(8, 8)
fn gatherShape(@builtin(global_invocation_id) id: vec3u) {
    let a = gatherAt(id);
    if (a.z == 0) { return; }
    let si = u32(a.x); let di = u32(a.y); let sc = gu.spw * gu.sph; let dc = gu.dw * gu.dh;
    for (var p = 0u; p < 7u; p++) { gdF[p * dc + di] = gsF[p * sc + si]; }
    for (var w = 0u; w < 7u; w++) { gdMk[di * 7u + w] = gsMk[si * 7u + w]; }
}

@compute @workgroup_size(8, 8)
fn gatherHeight(@builtin(global_invocation_id) id: vec3u) {
    let a = gatherAt(id);
    if (a.z == 0) { return; }
    let si = u32(a.x); let di = u32(a.y); let sc = gu.spw * gu.sph; let dc = gu.dw * gu.dh;
    for (var p = 0u; p < 2u; p++) { gdW[p * dc + di] = select(0.0, gsW[p * sc + si], gatherRefinementValid(id)); }
}

@group(3) @binding(13) var<storage, read> gsFd: array<vec4f>;
@group(3) @binding(14) var<storage, read_write> gdFd: array<vec4f>;

@compute @workgroup_size(8, 8)
fn gatherField(@builtin(global_invocation_id) id: vec3u) {
    let a = gatherAt(id);
    if (a.z == 0) { return; }
    gdFd[u32(a.y)] = select(vec4f(0.0), gsFd[u32(a.x)], gatherRefinementValid(id));
}

@compute @workgroup_size(8, 8)
fn gatherMaps(@builtin(global_invocation_id) id: vec3u) {
    let a = gatherAt(id);
    if (a.z == 0) { return; }
    let si = u32(a.x); let di = u32(a.y);
    let valid = gatherRefinementValid(id);
    gdM0[di] = select(0u, gsM0[si], valid); gdM1[di] = select(0u, gsM1[si], valid); gdM2[di] = select(0u, gsM2[si], valid);
}

// ---------------------------------------------------------------- the Time pass's own cells

// The Time pass simulates on cells of TIME_CELL px (sculpt-erosion.js): a finer lattice is read down to them, and the pass's result comes back
// as a change of the lattice's own heights. Here fu.grid and fu.cells are the fine lattice's, fu.gw is the coarse side, fu.gh the step in fine
// cells, and (fu.ox, fu.oy) the fine cell of the first coarse one (chosen so coarse cells sit on the same world cells in every window).
@group(3) @binding(15) var<storage, read_write> tcF: array<f32>;    // coarse h and p, two planes
@group(3) @binding(16) var<storage, read_write> tcMk: array<u32>;   // coarse masks, 7 words a cell
@group(3) @binding(17) var<storage, read> tcW: array<f32>;          // the coarse pass's weather: authored, eroded
@group(3) @binding(18) var<storage, read> tcM0: array<u32>;
@group(3) @binding(19) var<storage, read> tcM1: array<u32>;
@group(3) @binding(20) var<storage, read> tcM2: array<u32>;
@group(3) @binding(21) var<storage, read_write> tfW: array<f32>;    // the fine weather: plane 0 the authored height; plane 1 holds the protection until the eroded height replaces it
@group(3) @binding(22) var<storage, read> tfH: array<f32>;          // the same buffer, read (the maps pass)
@group(3) @binding(23) var<storage, read_write> tfM0: array<u32>;
@group(3) @binding(24) var<storage, read_write> tfM1: array<u32>;
@group(3) @binding(25) var<storage, read_write> tfM2: array<u32>;

fn tcFine(c: vec2u) -> vec2u { return min(vec2u(u32(fu.ox), u32(fu.oy)) + c * fu.gh, vec2u(fu.grid - 1u)); }
// A coarse height is the fine heights around its cell under a 1 2 1 tent, so the pass erodes the ground at its own scale and not one fine
// sample's; protection and the masks are the cell's own (a mean would blur a protected edge).
@compute @workgroup_size(8, 8)
fn timeDownMain(@builtin(global_invocation_id) id: vec3u) {
    let gc = fu.gw;
    if (id.x >= gc || id.y >= gc) { return; }
    let f = vec2i(tcFine(id.xy)); let n = i32(fu.grid); let j = id.y * gc + id.x;
    var h = 0.0;
    for (var dy = -1; dy <= 1; dy++) { for (var dx = -1; dx <= 1; dx++) {
        let w = f32((2 - abs(dx)) * (2 - abs(dy))) / 16.0;
        h += w * F[u32(clamp(f.y + dy, 0, n - 1)) * fu.grid + u32(clamp(f.x + dx, 0, n - 1))];
    } }
    let i = u32(f.y) * fu.grid + u32(f.x);
    tcF[j] = h; tcF[gc * gc + j] = F[fu.cells + i];
    for (var k = 0u; k < 7u; k++) { tcMk[j * 7u + k] = Mk[i * 7u + k]; }
}
// Where a fine cell sits among the coarse ones: the four around it and its weights.
struct TcAt { i: array<u32, 4>, w: vec4f }
fn tcAt(id: vec2u) -> TcAt {
    let gc = fu.gw;
    let q = clamp((vec2f(id) - vec2f(f32(fu.ox), f32(fu.oy))) / f32(fu.gh), vec2f(0.0), vec2f(f32(gc - 1u)));
    let a = vec2u(floor(q)); let b = min(a + 1u, vec2u(gc - 1u)); let t = q - vec2f(a);
    return TcAt(array<u32, 4>(a.y * gc + a.x, a.y * gc + b.x, b.y * gc + a.x, b.y * gc + b.x), vec4f((1.0 - t.x) * (1.0 - t.y), t.x * (1.0 - t.y), (1.0 - t.x) * t.y, t.x * t.y));
}
// The pass's change of height, laid on the fine lattice's own heights. The runner's contract holds per fine cell: a submerged or protected
// cell keeps its height, land stays above the waterline, and every height stays within the heights a map holds.
@compute @workgroup_size(8, 8)
fn timeUpHeightMain(@builtin(global_invocation_id) id: vec3u) {
    if (id.x >= fu.grid || id.y >= fu.grid) { return; }
    let i = id.y * fu.grid + id.x; let h = tfW[i]; let p = tfW[fu.cells + i];
    var out = h;
    if (h > fu.sea && p < 1.0) {
        let c = tcAt(id.xy); let nc = fu.gw * fu.gw;
        var d = 0.0;
        for (var k = 0; k < 4; k++) { d += c.w[k] * (tcW[nc + c.i[k]] - tcW[c.i[k]]); }
        out = clamp(h + d, max(fu.sea - 90.0, min(h, fu.sea + 1.0)), fu.sea + 300.0);
    }
    tfW[fu.cells + i] = out;
}
fn tcMix(a: u32, b: u32, c: u32, d: u32, w: vec4f) -> u32 { return pack4x8unorm(unpack4x8unorm(a) * w.x + unpack4x8unorm(b) * w.y + unpack4x8unorm(c) * w.z + unpack4x8unorm(d) * w.w); }
// The pass's maps on the fine lattice; a submerged cell's are the ones the maps pass gives one (engine-weather.wgsl mapsMain).
@compute @workgroup_size(8, 8)
fn timeUpMapsMain(@builtin(global_invocation_id) id: vec3u) {
    if (id.x >= fu.grid || id.y >= fu.grid) { return; }
    let i = id.y * fu.grid + id.x;
    if (tfH[i] <= fu.sea) { tfM0[i] = 0u; tfM1[i] = 0u; tfM2[i] = pack4x8unorm(vec4f(0.5, 0.5, 0.0, 0.0)); return; }
    let c = tcAt(id.xy);
    tfM0[i] = tcMix(tcM0[c.i[0]], tcM0[c.i[1]], tcM0[c.i[2]], tcM0[c.i[3]], c.w);
    tfM1[i] = tcMix(tcM1[c.i[0]], tcM1[c.i[1]], tcM1[c.i[2]], tcM1[c.i[3]], c.w);
    tfM2[i] = tcMix(tcM2[c.i[0]], tcM2[c.i[1]], tcM2[c.i[2]], tcM2[c.i[3]], c.w);
}
