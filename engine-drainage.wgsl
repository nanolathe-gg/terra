// P21: the drainage plane. Exact drainage area for a whole map, on a coarse lattice (one cell per DRAIN_STEP cells of the world lattice: 16 px, TA's own
// height cell), in a fixed number of gather passes.
//
//   sampleMain   the lattice heights, from a whole-map height plane (a paged map hands its coarse lattice over as it is)
//   recvMain     each cell's steepest-descent neighbour (D8), or NONE for a pit, a flat, a cell at or under sea level, or a cell with no lower neighbour
//   tourMain     the Euler tour of the receiver forest: two elements a cell (enter 2i, exit 2i+1); each one's successor is local (first child, next sibling,
//                parent's exit), so the tour is a linked list per tree built from the receivers alone
//   jumpMain     one pointer-jumping step (Wyllie): every element adds the weight of its successor's list and takes its successor's successor. After
//                ceil(log2(2N)) steps each element holds the sum of the weights from itself to the end of its list; enter weighs 1 and exit 0
//   areaMain     the drainage area of a cell, in lattice cells, is the sum at its enter less the sum at its exit; stored with its receiver
//
// u32 throughout (f32 counts are exact only below 2^24). No atomics: one thread writes each element, so a run is the same on every run, and the same
// whether the lattice came from the whole-map shape pass or from the pages' coarse lattice.
//
// Receivers compare multiples only (the diagonal's drop times 1/sqrt 2, a single correctly rounded product), never a quotient, so a CPU reference gets the
// same receiver from the same floats.

struct DU {
    width: u32,      // the lattice's side, in cells
    cells: u32,      // width * width
    grid: u32,       // sampleMain: the world lattice's side
    step: u32,       // sampleMain: world cells per lattice cell
    sea: f32,        // cells at or under this height are outlets
    pad0: u32, pad1: u32, pad2: u32,
}
const NONE: u32 = 0xffffffffu;
const INV_SQRT2: f32 = 0.70710677;

@group(0) @binding(0) var<uniform> du: DU;
@group(0) @binding(1) var<storage, read> world: array<f32>;
@group(0) @binding(2) var<storage, read_write> lat: array<f32>;
@group(0) @binding(3) var<storage, read_write> recv: array<u32>;
@group(0) @binding(4) var<storage, read_write> tour: array<vec4u>;       // jumpMain's input and areaMain's: (next of enter, sum at enter, next of exit, sum at exit)
@group(0) @binding(5) var<storage, read_write> tourOut: array<vec4u>;
@group(0) @binding(6) var<storage, read_write> plane: array<vec2u>;      // the stored plane: (area, receiver)

fn offset(k: u32) -> vec2i {
    switch k {
        case 0u: { return vec2i(1, 0); }
        case 1u: { return vec2i(1, 1); }
        case 2u: { return vec2i(0, 1); }
        case 3u: { return vec2i(-1, 1); }
        case 4u: { return vec2i(-1, 0); }
        case 5u: { return vec2i(-1, -1); }
        case 6u: { return vec2i(0, -1); }
        default: { return vec2i(1, -1); }
    }
}
fn inside(p: vec2i) -> bool { let w = i32(du.width); return p.x >= 0 && p.y >= 0 && p.x < w && p.y < w; }
fn cellOf(p: vec2i) -> u32 { return u32(p.y) * du.width + u32(p.x); }
fn cellId(i: u32) -> vec2i { let w = du.width; return vec2i(i32(i % w), i32(i / w)); }
fn at(id: vec3u, groups: u32) -> u32 { return id.x + id.y * groups * 64u; }

@compute @workgroup_size(64)
fn sampleMain(@builtin(global_invocation_id) id: vec3u, @builtin(num_workgroups) nw: vec3u) {
    let i = at(id, nw.x);
    if (i >= du.cells) { return; }
    let p = cellId(i);
    lat[i] = world[u32(p.y) * du.step * du.grid + u32(p.x) * du.step];
}

@compute @workgroup_size(64)
fn recvMain(@builtin(global_invocation_id) id: vec3u, @builtin(num_workgroups) nw: vec3u) {
    let i = at(id, nw.x);
    if (i >= du.cells) { return; }
    let p = cellId(i);
    let h = lat[i];
    var best = 0.0;
    var to = NONE;
    if (h > du.sea) {
        for (var k = 0u; k < 8u; k++) {
            let q = p + offset(k);
            if (!inside(q)) { continue; }
            let drop = h - lat[cellOf(q)];
            let score = select(drop, drop * INV_SQRT2, (k & 1u) == 1u);
            if (score > best) { best = score; to = cellOf(q); }
        }
    }
    recv[i] = to;
}

// Whether cell q (in the lattice) drains into cell p.
fn drainsTo(q: vec2i, p: u32) -> bool { return inside(q) && recv[cellOf(q)] == p; }

@compute @workgroup_size(64)
fn tourMain(@builtin(global_invocation_id) id: vec3u, @builtin(num_workgroups) nw: vec3u) {
    let i = at(id, nw.x);
    if (i >= du.cells) { return; }
    let p = cellId(i);
    // Enter: the first child's enter (children in direction order), else this cell's own exit.
    var nEnter = 2u * i + 1u;
    for (var k = 0u; k < 8u; k++) {
        let q = p + offset(k);
        if (drainsTo(q, i)) { nEnter = 2u * cellOf(q); break; }
    }
    // Exit: the next sibling's enter (the parent's children, in direction order from the parent), else the parent's exit; a root ends its list.
    var nExit = NONE;
    let parent = recv[i];
    if (parent != NONE) {
        let pp = cellId(parent);
        nExit = 2u * parent + 1u;
        var first = 0u;
        for (var k = 0u; k < 8u; k++) { if (all(pp + offset(k) == p)) { first = k + 1u; break; } }
        for (var k = first; k < 8u; k++) {
            let q = pp + offset(k);
            if (drainsTo(q, parent)) { nExit = 2u * cellOf(q); break; }
        }
    }
    tour[i] = vec4u(nEnter, 1u, nExit, 0u);
}

// The (next, sum) of element e.
fn element(e: u32) -> vec2u {
    let t = tour[e >> 1u];
    return select(t.xy, t.zw, (e & 1u) == 1u);
}

@compute @workgroup_size(64)
fn jumpMain(@builtin(global_invocation_id) id: vec3u, @builtin(num_workgroups) nw: vec3u) {
    let i = at(id, nw.x);
    if (i >= du.cells) { return; }
    var t = tour[i];
    if (t.x != NONE) { let n = element(t.x); t = vec4u(n.x, t.y + n.y, t.z, t.w); }
    if (t.z != NONE) { let n = element(t.z); t = vec4u(t.x, t.y, n.x, t.w + n.y); }
    tourOut[i] = t;
}

@compute @workgroup_size(64)
fn areaMain(@builtin(global_invocation_id) id: vec3u, @builtin(num_workgroups) nw: vec3u) {
    let i = at(id, nw.x);
    if (i >= du.cells) { return; }
    let t = tour[i];
    plane[i] = vec2u(t.y - t.w, recv[i]);
}
