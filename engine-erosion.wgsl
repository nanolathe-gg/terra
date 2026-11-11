// H5 (Green's engine): erosion.wgsl with its steps dispatched over a list of active 8 x 8 tiles (binding 8) instead of the whole grid.
// A tile is active when any sample in it, or in a tile beside it, can move (mobility above 0). Samples of inactive tiles are never
// written: the host seeds all three state buffers with the authored height, so they keep it, hold no water and act as a sink for water
// that runs onto them (flat plain and sea). The arithmetic of every step is erosion.wgsl's own. Engine 0 keeps erosion.wgsl.
// H2: grid erosion for the 1024-px study (Green), a compute pass. Virtual-pipe shallow water after Mei, Decaudin and Hu
// (2007): per cell rock R, loose debris D, water W and suspended sediment S; water moves
// through four pipes to its neighbours, the flow gives a velocity, the velocity and the
// slope give a carrying capacity, and the cell dissolves rock or deposits debris to meet
// it; the sediment is carried on the velocity. A thermal step then lets material slide
// down any slope steeper than the repose of what is at the surface: loose debris keeps a
// shallow one, rock the angle of its bed (hard beds stand, soft beds slump).
//
// Deterministic: a fixed number of iterations, every dispatch reads one buffer and writes
// another, one thread writes each cell, no atomics. The host (sculpt-erosion.js) owns the
// constants and the iteration order. The common source is pasted under EROSION, so the
// column functions are the bake's own (see columnCoord).
/*COMMON*/

struct EP {
    grid: f32,
    spacing: f32,     // world px per sample
    rain: f32,        // water added to every dry sample per iteration, height units
    kFlux: f32,       // pipe flow per unit of surface difference
    damp: f32,        // how much of last iteration's flow a pipe keeps
    kCap: f32,        // sediment capacity per unit of sin(slope) * speed
    kDissolve: f32,   // share of the capacity shortfall dissolved per iteration
    kDeposit: f32,    // share of the capacity excess deposited per iteration
    evap: f32,        // share of the water that evaporates per iteration
    wetFull: f32,     // water depth at which the full capacity applies
    contrast: f32,    // columnContrast, copied so the pass need not read the uniform for it
    rockWear: f32,    // rock wears 1 / (1 + rockWear * contrast * hardness) as fast as debris
    talusTan: f32,    // repose of loose debris, height per px
    softAngle: f32,   // repose angle of the softest rock, radians
    hardAngle: f32,   // repose angle of the hardest rock, radians
    thermal: f32,     // share of a pair's excess slope moved per thermal step
    ox: f32,          // H5b: the first column and row of this window in the world lattice (0 for a whole map), so the bed column reads world positions
    oy: f32,
}

@group(1) @binding(0) var<uniform> ep: EP;
@group(1) @binding(1) var<storage, read> src: array<vec4f>;              // (rock, debris, water, sediment)
@group(1) @binding(2) var<storage, read_write> dst: array<vec4f>;
@group(1) @binding(3) var<storage, read> fluxIn: array<vec4f>;           // pipe flow toward x-1, x+1, y-1, y+1
@group(1) @binding(4) var<storage, read_write> fluxOut: array<vec4f>;
@group(1) @binding(5) var<storage, read_write> vel: array<vec2f>;
@group(1) @binding(6) var<storage, read_write> acc: array<vec4f>;        // x water throughput, y material deposited
@group(1) @binding(7) var<storage, read_write> fixedField: array<vec4f>; // lower bound, upper bound, mobility (-1 submerged), column offset
@group(1) @binding(8) var<storage, read> tiles: array<vec2u>;           // active tiles (x, y), 8 x 8 samples each
fn tileCell(w: u32, l: vec3u) -> vec3u { let t = tiles[w]; return vec3u(t.x * 8u + l.x, t.y * 8u + l.y, 0u); }

fn at(x: i32, y: i32) -> u32 { return u32(y * i32(ep.grid) + x); }
fn inside(x: i32, y: i32) -> bool { let n = i32(ep.grid); return x >= 0 && y >= 0 && x < n && y < n; }
fn ground(s: vec4f) -> f32 { return s.x + s.y; }

// Hardness of the rock at the surface of a sample (0 with no column or no contrast: every bed alike). The Time pass keeps the world's own rock's
// beds (slot 0: rs is never set here, and its pipelines are built with rockMask 0): a rock preset's own beds do not reach the heights yet.
fn hardnessOf(rock: f32, offset: f32) -> f32 {
    if (u.rock[rs & rockMask].columnCount == 0 || u.columnContrast <= 0.0) { return 0.0; }
    return columnAt(rock - u.columnOrigin + offset).hardness;
}

@compute @workgroup_size(8, 8)
fn offsetMain(@builtin(global_invocation_id) id: vec3u) {
    let x = i32(id.x); let y = i32(id.y);
    if (!inside(x, y)) { return; }
    let i = at(x, y);
    var f = fixedField[i];
    f.w = columnOffset((vec2f(f32(x), f32(y)) + vec2f(ep.ox, ep.oy)) * ep.spacing);
    fixedField[i] = f;
}

// Water by pipe: each of the four outflows follows the surface difference, and the
// four together never exceed the water in the cell.
@compute @workgroup_size(8, 8)
fn fluxMain(@builtin(workgroup_id) wg: vec3u, @builtin(local_invocation_id) lid: vec3u) {
    let id = tileCell(wg.x, lid);
    let x = i32(id.x); let y = i32(id.y);
    if (!inside(x, y)) { return; }
    let i = at(x, y);
    let c = src[i];
    var out = vec4f(0.0);
    if (fixedField[i].z >= 0.0) {
        let w = c.z + ep.rain;
        let h = ground(c) + w;
        let dx = vec4i(-1, 1, 0, 0); let dy = vec4i(0, 0, -1, 1);
        let before = fluxIn[i];
        for (var k = 0; k < 4; k++) {
            let nx = x + dx[k]; let ny = y + dy[k];
            if (!inside(nx, ny)) { continue; }
            let n = src[at(nx, ny)];
            let wn = n.z + select(0.0, ep.rain, fixedField[at(nx, ny)].z >= 0.0);
            out[k] = max(0.0, ep.damp * before[k] + ep.kFlux * (h - (ground(n) + wn)));
        }
        let total = out.x + out.y + out.z + out.w;
        if (total > 0.0) { out *= min(1.0, w / total); }
    }
    fluxOut[i] = out;
}

// Water update from the new pipes, and the velocity they imply. Submerged samples and
// the edge of the grid take the water away (the sea, the map edge). The old pipes are
// copied back into fluxOut for the next iteration.
@compute @workgroup_size(8, 8)
fn waterMain(@builtin(workgroup_id) wg: vec3u, @builtin(local_invocation_id) lid: vec3u) {
    let id = tileCell(wg.x, lid);
    let x = i32(id.x); let y = i32(id.y);
    if (!inside(x, y)) { return; }
    let n = i32(ep.grid);
    let i = at(x, y);
    let c = src[i];
    let f = fixedField[i];
    let edge = x == 0 || y == 0 || x == n - 1 || y == n - 1;
    var inL = 0.0; var inR = 0.0; var inT = 0.0; var inB = 0.0;
    if (x > 0) { inL = fluxIn[at(x - 1, y)].y; }
    if (x < n - 1) { inR = fluxIn[at(x + 1, y)].x; }
    if (y > 0) { inT = fluxIn[at(x, y - 1)].w; }
    if (y < n - 1) { inB = fluxIn[at(x, y + 1)].z; }
    let mine = fluxIn[i];
    let outTotal = mine.x + mine.y + mine.z + mine.w;
    var w = c.z + select(0.0, ep.rain, f.z >= 0.0) + inL + inR + inT + inB - outTotal;
    let mean = max(0.5 * (c.z + w), 1e-4);
    var v = vec2f(0.5 * (inL - mine.x + mine.y - inR), 0.5 * (inT - mine.z + mine.w - inB)) / mean;
    let speed = length(v);
    if (speed > 1.0) { v /= speed; }
    if (f.z < 0.0 || edge) { w = 0.0; v = vec2f(0.0); }
    vel[i] = v;
    dst[i] = vec4f(c.x, c.y, max(w, 0.0), c.w);
    fluxOut[i] = mine;
    acc[i].x += outTotal * max(f.z, 0.0);
}

// Dissolve rock or deposit debris until the carried sediment meets the capacity. Debris
// goes first and wears at full rate; rock wears by its bed's hardness. A sample never
// leaves its bounds. settle (the last pass) drops everything still carried.
fn exchange(i: u32, x: i32, y: i32, settle: bool) {
    let c = src[i];
    let f = fixedField[i];
    if (f.z <= 0.0) { dst[i] = vec4f(c.x, c.y, c.z, select(c.w, 0.0, f.z < 0.0)); return; }
    let g = ground(c);
    let down = max(0.0, g - f.x);
    let up = max(0.0, f.y - g);
    let sx = (ground(src[at(min(x + 1, i32(ep.grid) - 1), y)]) - ground(src[at(max(x - 1, 0), y)])) / (2.0 * ep.spacing);
    let sy = (ground(src[at(x, min(y + 1, i32(ep.grid) - 1))]) - ground(src[at(x, max(y - 1, 0))])) / (2.0 * ep.spacing);
    let tanA = length(vec2f(sx, sy));
    let capacity = select(ep.kCap * (tanA / sqrt(1.0 + tanA * tanA)) * length(vel[i]) * smoothstep(0.0, ep.wetFull, c.z), 0.0, settle);
    var rock = c.x; var debris = c.y; var sediment = c.w;
    if (capacity > sediment) {
        let want = ep.kDissolve * (capacity - sediment) * f.z;
        let fromDebris = min(want, debris);
        let hard = hardnessOf(rock, f.w);
        let fromRock = (want - fromDebris) / (1.0 + ep.rockWear * ep.contrast * hard);
        var total = fromDebris + fromRock;
        let scale = select(1.0, down / total, total > down);
        debris -= fromDebris * scale;
        rock -= fromRock * scale;
        sediment += total * scale;
    } else {
        let drop = min(select(ep.kDeposit * (sediment - capacity), sediment, settle), min(sediment, up));
        debris += drop;
        sediment -= drop;
        acc[i].y += drop;
    }
    dst[i] = vec4f(rock, debris, c.z, sediment);
}

@compute @workgroup_size(8, 8)
fn exchangeMain(@builtin(workgroup_id) wg: vec3u, @builtin(local_invocation_id) lid: vec3u) {
    let id = tileCell(wg.x, lid);
    let x = i32(id.x); let y = i32(id.y);
    if (!inside(x, y)) { return; }
    exchange(at(x, y), x, y, false);
}

@compute @workgroup_size(8, 8)
fn settleMain(@builtin(workgroup_id) wg: vec3u, @builtin(local_invocation_id) lid: vec3u) {
    let id = tileCell(wg.x, lid);
    let x = i32(id.x); let y = i32(id.y);
    if (!inside(x, y)) { return; }
    exchange(at(x, y), x, y, true);
}

// Sediment rides the velocity (semi-Lagrangian); water evaporates.
@compute @workgroup_size(8, 8)
fn carryMain(@builtin(workgroup_id) wg: vec3u, @builtin(local_invocation_id) lid: vec3u) {
    let id = tileCell(wg.x, lid);
    let x = i32(id.x); let y = i32(id.y);
    if (!inside(x, y)) { return; }
    let n = i32(ep.grid);
    let i = at(x, y);
    let c = src[i];
    let q = clamp(vec2f(f32(x), f32(y)) - vel[i], vec2f(0.0), vec2f(f32(n - 1)));
    let b = vec2i(floor(q));
    let fr = q - vec2f(b);
    let b1 = min(b + 1, vec2i(n - 1));
    let s = mix(mix(src[at(b.x, b.y)].w, src[at(b1.x, b.y)].w, fr.x), mix(src[at(b.x, b1.y)].w, src[at(b1.x, b1.y)].w, fr.x), fr.y);
    let edge = x == 0 || y == 0 || x == n - 1 || y == n - 1;
    dst[i] = vec4f(c.x, c.y, c.z * (1.0 - ep.evap), select(s, 0.0, edge || fixedField[i].z < 0.0));
}

// Thermal weathering: while the slope between a pair of samples exceeds a repose, material at
// the top of the higher one slides to the lower. Two reposes apply. Loose debris slides on
// anything steeper than the debris angle, whatever it rests on (so it never clings to a hard
// face and gathers at the foot instead); rock slumps only where the slope exceeds the repose
// of its own bed, so hard beds stand and soft beds fall away. Both samples of a pair evaluate
// the same expression on the same inputs, so what one loses the other gains exactly; each
// thread writes only its own sample.
fn rockTan(s: vec4f, offset: f32) -> f32 {
    // The angle, not its tangent, follows the hardness: a soft bed (hardness .15-.3) is well under the tangent a mix would give.
    return tan(mix(ep.softAngle, ep.hardAngle, clamp(hardnessOf(s.x, offset) * ep.contrast, 0.0, 1.0)));
}

// What the higher sample hands to the lower: debris first, then rock, never past the
// higher one's lower bound or the lower one's upper bound (an eighth each, for its eight pairs).
// The painted repose: the erosion override plane scales both reposes (seedMain stores its share in a sample's totals, z). A pair uses the mean of its
// two samples' shares, so both ends of a pair compute the same scale and the exchange stays symmetric. Nothing painted: a scale of exactly 1.
fn slide(hi: vec4f, hf: vec4f, lo: vec4f, lf: vec4f, length_: f32, painted: f32) -> f32 {
    let drop = ground(hi) - ground(lo);
    let run = length_ * ep.spacing * (1.0 + painted);
    let debris = select(0.0, max(0.0, drop - ep.talusTan * run), hi.y > 0.0);
    let rock = max(0.0, drop - rockTan(hi, hf.w) * run);
    let share = min(max(0.0, ground(hi) - hf.x), max(0.0, lf.y - ground(lo))) / 8.0;
    return min(ep.thermal * (min(debris, hi.y * 4.0) + rock), share) * min(max(hf.z, 0.0), max(lf.z, 0.0));
}

@compute @workgroup_size(8, 8)
fn thermalMain(@builtin(workgroup_id) wg: vec3u, @builtin(local_invocation_id) lid: vec3u) {
    let id = tileCell(wg.x, lid);
    let x = i32(id.x); let y = i32(id.y);
    if (!inside(x, y)) { return; }
    let i = at(x, y);
    let c = src[i];
    let f = fixedField[i];
    var out = 0.0; var gain = 0.0;
    if (f.z > 0.0) {
        for (var dy = -1; dy <= 1; dy++) {
            for (var dx = -1; dx <= 1; dx++) {
                if (dx == 0 && dy == 0) { continue; }
                let nx = x + dx; let ny = y + dy;
                if (!inside(nx, ny)) { continue; }
                let j = at(nx, ny);
                let n = src[j];
                let len = select(1.0, 1.41421356, dx != 0 && dy != 0);
                let painted = 0.5 * (acc[i].z + acc[j].z);
                if (ground(c) > ground(n)) { out += slide(c, f, n, fixedField[j], len, painted); }
                else if (ground(n) > ground(c)) { gain += slide(n, fixedField[j], c, f, len, painted); }
            }
        }
    }
    let fromDebris = min(c.y, out);
    dst[i] = vec4f(c.x - (out - fromDebris), c.y - fromDebris + gain, c.z, c.w);
    acc[i].y += gain;
}
