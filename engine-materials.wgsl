// H4 item 2: Green's land materials made once at startup from materials/green.json, one compute pass per mip level.
// Output: a 2d-array texture, one layer per material in the table's order (slope grass, rock, weathered, fractured),
// TEX px square at level 0 and halved per level. The draw reads a texel with textureLoad (engine-frag.wgsl, genColor).
//
// What differs from the per-pixel model (material-model.wgsl, H3):
//  - Every noise octave is periodic over the texture: hashes take the pixel modulo the level's size, and each lattice has a whole
//    number of cells across it (a cell of 64 px in 512 divides exactly; a stretched cell is rounded to the nearest whole count),
//    so the draw wraps with a mask and shows no tile edge.
//  - Mip level L is not a box filter of level 0. It is the model evaluated with a footprint of 2^L px, which fades the bands whose
//    cells are smaller than the footprint (one band at a time) and keeps their variance through the five-point rule: the
//    footprint rule of H3, so a coarse draw reads the level the model would have made for it.
// Fixed seeds: the salt of each material is its index; every operation is integer hashing or a fixed float expression,
// so the same table gives the same bits on a given GPU.

const MM_ROWS = 39u;
@group(0) @binding(0) var<storage, read> table: array<vec4f>;
@group(0) @binding(1) var out: texture_storage_2d_array<rgba8unorm, write>;
struct Params { size: f32, foot: f32, pad0: f32, pad1: f32 }
@group(0) @binding(2) var<uniform> params: Params;

fn matRow(i: u32) -> vec4f { return table[i]; }

fn mmHash(c: vec2i, salt: u32) -> f32 {
    var n = bitcast<u32>(c.x) * 374761393u + bitcast<u32>(c.y) * 668265263u + salt * 2246822519u;
    n = (n ^ (n >> 13u)) * 1274126177u;
    n = (n ^ (n >> 16u)) * 2246822519u;
    return f32(n ^ (n >> 15u)) / 4294967295.0;
}
// Smooth value noise with `cells` lattice cells across the texture (whole numbers, so it wraps), in -1..1.
fn mmLattice(pixel: vec2f, cells: vec2f, salt: u32) -> f32 {
    let q = pixel / params.size * cells;
    let c = vec2i(floor(q));
    let f = fract(q);
    let w = f * f * (3.0 - 2.0 * f);
    let n = vec2i(cells);
    let c0 = ((c % n) + n) % n;
    let c1 = (c0 + 1) % n;
    let a = mmHash(c0, salt);
    let b = mmHash(vec2i(c1.x, c0.y), salt);
    let d = mmHash(vec2i(c0.x, c1.y), salt);
    let e = mmHash(c1, salt);
    return mix(mix(a, b, w.x), mix(d, e, w.x), w.y) * 2.0 - 1.0;
}
// Lattice cell counts for a cell of `cell` px (x stretched): whole numbers, at least 1, so a coarse level keeps a band
// as a single cell rather than losing the wrap.
fn mmCells(cell: f32, stretch: f32) -> vec2f {
    return max(vec2f(round(params.size / (cell * stretch)), round(params.size / cell)), vec2f(1.0));
}

const MM_P = array<f32, 13>(0.001, 0.01, 0.05, 0.1, 0.25, 0.4, 0.5, 0.6, 0.75, 0.9, 0.95, 0.99, 0.999);
fn mmU(base: u32, z: f32) -> f32 {
    var lo = matRow(base + 35u).x;
    var plo = MM_P[0];
    if (z <= lo) { return plo; }
    for (var k = 1u; k < 13u; k++) {
        let hi = matRow(base + 35u + k / 4u)[k % 4u];
        if (z <= hi) { return mix(plo, MM_P[k], (z - lo) / max(hi - lo, 1e-6)); }
        lo = hi;
        plo = MM_P[k];
    }
    return plo;
}
fn mmAmp(r0: vec4f, r1: vec4f, k: u32) -> f32 {
    switch (k) {
        case 0u: { return r0.x; }
        case 1u: { return r0.y; }
        case 2u: { return r0.z; }
        case 3u: { return r0.w; }
        case 4u: { return r1.x; }
        case 5u: { return r1.y; }
        default: { return r1.z; }
    }
}
const MM_V0 = 0.33333;
const MM_VL = 0.18395;
fn mmRamp(base: u32, u: f32) -> vec3f {
    let at = clamp(u * 16.0 - 0.5, 0.0, 15.0);
    let i0 = u32(floor(at));
    return mix(matRow(base + 3u + i0).rgb, matRow(base + 3u + min(i0 + 1u, 15u)).rgb, fract(at));
}

fn mmColor(id: u32, pixel: vec2f, foot: f32) -> vec3f {
    let base = id * MM_ROWS;
    let r0 = matRow(base);
    let r1 = matRow(base + 1u);
    let r2 = matRow(base + 2u);
    let stretch = max(r1.w, 0.1);
    let salt = id * 16u + 1u;
    let wrap = vec2i(i32(params.size));
    let ip = ((vec2i(floor(pixel)) % wrap) + wrap) % wrap;
    let w0 = clamp(2.0 / foot - 1.0, 0.0, 1.0);
    var z = r0.x * (mmHash(ip, salt) * 2.0 - 1.0) * w0;
    var lost = r0.x * r0.x * MM_V0 * (1.0 - w0 * w0);
    for (var k = 1u; k < 7u; k++) {
        let cell = f32(1u << k);
        let w = clamp((cell / foot - 0.5) * 2.0, 0.0, 1.0);
        let a = mmAmp(r0, r1, k);
        z += a * w * mmLattice(pixel, mmCells(cell, stretch), salt + k);
        lost += a * a * MM_VL * (1.0 - w * w);
    }
    var rgb = mmRamp(base, mmU(base, z));
    if (lost > 1e-6) {
        let s = sqrt(lost);
        rgb = rgb * 0.533333
            + (mmRamp(base, mmU(base, z - s * 1.355626)) + mmRamp(base, mmU(base, z + s * 1.355626))) * 0.222076
            + (mmRamp(base, mmU(base, z - s * 2.856970)) + mmRamp(base, mmU(base, z + s * 2.856970))) * 0.011257;
    }
    let at = clamp(mmU(base, z) * 16.0 - 0.5, 0.0, 15.0);
    let i0 = u32(floor(at));
    let dir = mix(matRow(base + 19u + i0).rgb, matRow(base + 19u + min(i0 + 1u, 15u)).rgb, fract(at));
    let white = (mmHash(ip, salt + 8u) + mmHash(ip, salt + 9u) + mmHash(ip, salt + 10u) - 1.5) * 2.0;
    let two = mmCells(2.0, 1.0);
    let soft = (mmLattice(pixel, two, salt + 11u) + mmLattice(pixel, two, salt + 12u) + mmLattice(pixel, two, salt + 13u)) * 1.85;
    let fade = mix(w0, clamp((2.0 / foot - 0.5) * 2.0, 0.0, 1.0), r2.x);
    rgb += dir * mix(white, soft, r2.x) * r2.y * fade;
    return clamp(rgb, vec3f(0.0), vec3f(255.0)) / 255.0;
}

@compute @workgroup_size(8, 8, 1)
fn makeMaterial(@builtin(global_invocation_id) id: vec3u) {
    let n = u32(params.size / params.foot);   // texels across this level (size is level 0's)
    if (id.x >= n || id.y >= n) { return; }
    // The texel's centre in level-0 pixels, as the draw's snapped pixel of a footprint-sized step.
    let pixel = (vec2f(id.xy) + 0.5) * params.foot;
    let rgb = mmColor(id.z, pixel, params.foot);
    textureStore(out, vec2i(id.xy), i32(id.z), vec4f(rgb, 1.0));
}
