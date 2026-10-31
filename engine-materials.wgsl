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
//
// H14b: a material whose row 39 relief is above 0 is made as the art was made: a height field, lit from one direction, reduced
// to the palette. mmLit builds the height from the bands (a share of them ridged, in a lattice sheared at an integer slope so the
// streaks run at an angle and still wrap), adds Voronoi facets (each with its own tilt and tone, dark seams between them), lights
// it, and sends the result through the same measured rank map and ramp, so the histogram still comes out right. A thin-vein overlay
// draws zero-crossing lines of its own lattice in their own colour. Levels above 0 of such a material are 2 x 2 box means of the level
// above, not the footprint rule: a seam or vein narrows and softens as the art would when drawn smaller and never vanishes.
// A material with relief 0 takes the unchanged path above, so every new number at 0 leaves it exactly as it was.
//   row 39  relief (gradient gain), light azimuth (rad), shear (whole number), height share of z
//   row 40  ridged share, cell size px (0 off), cell tilt, cell tone
//   row 41  seam width px, seam depth (z units), vein width px, vein spacing px
//   row 42  vein colour rgb, vein share of the plane (0 off)
//   row 43  warp px (every lookup is displaced by noise of 32-px cells: no lattice line shows, facet edges curve), cone strength (round pits and bumps),
//           seam variation 0..1 (the seam's width follows noise: broken, uneven seams), seam gap 0..1 (the share of the plane with no seams)
//   row 44  cell weight 0..1 (cells of uneven size with curved outlines: slabs), streak band (the stretch and shear fade out above this band; 0 = all bands), skew (whole number: the lattice slants in x as shear slants it in y, alternately by band), stroke core (extra depth of the stroke's core, share of its depth)
//   row 45  strokes: cell px (0 off), share of cells (each holds up to two), radius px (at most the cell), depth in z units; width is the vein width
// Fixed seeds: the salt of each material is its index; every operation is integer hashing or a fixed float expression,
// so the same table gives the same bits on a given GPU.

// H14d: a material whose row 2 z (dither amount) is above 0 is dithered as the art was: the art is a smooth colour reduced to a small
// palette by error diffusion, so its hue alternates pixel by pixel, which a rank ramp (hue tied to luma) cannot make. The ramp is then the
// smooth colour (measured on the image blurred, material_numbers.py --dither), and each pixel's final colour is the nearest of the
// material's own colours (up to 16), found by Floyd-Steinberg error diffusion on rgb, so the mean over any area is the smooth colour.
//   rows 46..61 per colour: rgb, and w = 1 for a colour in use (the colours are the commonest of the image, measured)
//   row 2 z   the amount: the output is the ramp plus this share of (nearest colour - ramp)
// The pass is makeDither (level 0 only): one invocation runs a serpentine error diffusion over a DITHER_BLOCK px square of the layer, the
// error never crossing a block edge, so the layer still wraps and the blocks run in parallel. Levels above 0 of a dithered material are
// 2 x 2 box means of the level above, as a lit material's are (the mean over an area is the smooth colour).
//   row 62    dots (dithered materials only): cell px (0 off), share of cells with a dot, radius px, depth in z units: a lattice of small dark
//             dots (one jittered point per cell, a gaussian dip of that radius in z), as the art's plain carries.
const MM_ROWS = 63u;
const DITHER_BLOCK = 32u;
@group(0) @binding(0) var<storage, read> table: array<vec4f>;
@group(0) @binding(1) var out: texture_storage_2d_array<rgba8unorm, write>;
struct Params { size: f32, foot: f32, pad0: f32, pad1: f32 }
@group(0) @binding(2) var<uniform> params: Params;
// The level above this one (level 1 while level 0 is made, where it is not read): a lit material's coarse levels are box means of it.
@group(0) @binding(3) var prev: texture_2d_array<f32>;

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

// The unlit model's z at a pixel (`lost` is the variance the footprint rule moves into the five-point average).
fn mmUnlitZ(id: u32, pixel: vec2f, foot: f32) -> vec2f {
    let base = id * MM_ROWS;
    let r0 = matRow(base);
    let r1 = matRow(base + 1u);
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
    return vec2f(z, lost);
}

fn mmColor(id: u32, pixel: vec2f, foot: f32) -> vec3f {
    let base = id * MM_ROWS;
    let r2 = matRow(base + 2u);
    let salt = id * 16u + 1u;
    let wrap = vec2i(i32(params.size));
    let ip = ((vec2i(floor(pixel)) % wrap) + wrap) % wrap;
    let w0 = clamp(2.0 / foot - 1.0, 0.0, 1.0);
    let zl = mmUnlitZ(id, pixel, foot);
    let z = zl.x;
    let lost = zl.y;
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

// ---- H14b: the lit height field -------------------------------------------------------------------------------------------------
// Lattice coordinates of a pixel with `cells` cells across the texture, the y axis sheared by a whole number of cells per texture
// width: the cell grid is then a parallelogram grid along the line y = -shear x, and a lattice index still wraps as (i mod cx, j mod cy),
// because a texture width moves j by shear * cy exactly.
fn mmU2(pixel: vec2f, cells: vec2f, shear: f32, skew: f32) -> vec2f {
    let q = pixel / params.size;
    return vec2f((q.x + skew * q.y) * cells.x, (q.y + shear * q.x) * cells.y);
}
fn mmWrapCell(c: vec2i, cells: vec2f) -> vec2i {
    let n = vec2i(cells);
    return ((c % n) + n) % n;
}
// Value noise on the sheared lattice in -1..1 with its gradient per pixel: (value, d/dx, d/dy).
fn mmLatticeG(pixel: vec2f, cells: vec2f, shear: f32, skew: f32, salt: u32) -> vec3f {
    let u = mmU2(pixel, cells, shear, skew);
    let c = vec2i(floor(u));
    let f = fract(u);
    let w = f * f * (3.0 - 2.0 * f);
    let dw = 6.0 * f * (1.0 - f);
    let c0 = mmWrapCell(c, cells);
    let c1 = mmWrapCell(c + vec2i(1), cells);
    let a = mmHash(c0, salt);
    let b = mmHash(vec2i(c1.x, c0.y), salt);
    let d = mmHash(vec2i(c0.x, c1.y), salt);
    let e = mmHash(c1, salt);
    let lo = mix(a, b, w.x);
    let hi = mix(d, e, w.x);
    let dux = ((b - a) * (1.0 - w.y) + (e - d) * w.y) * dw.x * 2.0;
    let duy = (hi - lo) * dw.y * 2.0;
    return vec3f((mix(lo, hi, w.y)) * 2.0 - 1.0, (dux * cells.x + duy * cells.y * shear) / params.size, (dux * cells.x * skew + duy * cells.y) / params.size);
}
struct Facet { f1: f32, f2: f32, cell: vec2i, toward: vec2f }
// Nearest and second nearest of one jittered feature point per cell of the sheared lattice (periodic through mmWrapCell).
fn mmFacets(pixel: vec2f, cells: vec2f, shear: f32, salt: u32, vary: f32) -> Facet {
    let u = mmU2(pixel, cells, shear, 0.0);
    let c = vec2i(floor(u));
    var out = Facet(9.0, 9.0, vec2i(0), vec2f(0.0));
    for (var j = -1; j <= 1; j++) {
        for (var i = -1; i <= 1; i++) {
            let cc = mmWrapCell(c + vec2i(i, j), cells);
            let point = vec2f(c + vec2i(i, j)) + vec2f(0.1 + 0.8 * mmHash(cc, salt), 0.1 + 0.8 * mmHash(cc, salt + 1u));
            // Each point carries a weight (vary 0 = none): the nearest-point test then gives cells of uneven size with curved outlines.
            let d = distance(u, point) - vary * (mmHash(cc, salt + 2u) - 0.5) * 1.6;
            if (d < out.f1) { out.f2 = out.f1; out.f1 = d; out.cell = cc; out.toward = u - point; } else if (d < out.f2) { out.f2 = d; }
        }
    }
    return out;
}
// 1 on a line, 0 beyond its half width, with half a pixel of edge: a line `width` px wide at `dist` px from its centre.
fn mmLine(dist: f32, width: f32) -> f32 { return clamp(width * 0.5 - dist + 0.5, 0.0, 1.0); }

// Short curved strokes with a dark core: per lattice cell of `size` px up to two circle arcs (its own centre, radius up to `radius`
// px, which must not exceed the cell, start angle and sweep), each present with probability `share`. Cells are periodic through
// mmWrapCell, so the layer wraps. Returns how deep the strokes cut into z at this point (line weight plus core weight times `depth`).
fn mmStrokes(p: vec2f, f: vec4f, width: f32, core: f32, salt: u32) -> f32 {
    let cells = mmCells(f.x, 1.0);
    let cpx = params.size / cells.x;
    let c = vec2i(floor(p / cpx));
    var total = 0.0;
    for (var j = -1; j <= 1; j++) {
        for (var i = -1; i <= 1; i++) {
            let cc = mmWrapCell(c + vec2i(i, j), cells);
            for (var s = 0u; s < 2u; s++) {
                let sl = salt + 40u + s * 8u;
                if (mmHash(cc, sl) > f.y) { continue; }
                let ctr = (vec2f(c + vec2i(i, j)) + vec2f(mmHash(cc, sl + 1u), mmHash(cc, sl + 2u))) * cpx;
                let r = min(f.z, cpx) * (0.3 + 0.7 * mmHash(cc, sl + 3u));
                let a0 = 6.2831853 * mmHash(cc, sl + 4u);
                let sweep = mix(0.5, 1.6, mmHash(cc, sl + 5u));
                let dv = p - ctr;
                var rel = atan2(dv.y, dv.x) - a0;
                rel -= 6.2831853 * floor(rel / 6.2831853);
                var dist = abs(length(dv) - r);
                if (rel > sweep) {
                    dist = min(distance(p, ctr + r * vec2f(cos(a0), sin(a0))), distance(p, ctr + r * vec2f(cos(a0 + sweep), sin(a0 + sweep))));
                }
                total = max(total, mmLine(dist, width) + core * mmLine(dist, width * 0.5));
            }
        }
    }
    return total * f.w;
}

// z of a lit material at a level-0 pixel, and the vein weight over it.
// Development only: params.pad0 above 0 gives every layer that salt, so candidate layers differ only in their numbers (measure/lit_fit.py).
fn mmSalt(id: u32) -> u32 { return select(id * 16u + 1u, u32(params.pad0) * 16u + 1u, params.pad0 > 0.0); }

fn mmLitZ(base: u32, id: u32, pixel: vec2f) -> vec2f {
    let r0 = matRow(base);
    let r1 = matRow(base + 1u);
    let a = matRow(base + 39u);
    let b = matRow(base + 40u);
    let c = matRow(base + 41u);
    let v = matRow(base + 42u);
    let stretch = max(r1.w, 0.1);
    let salt = mmSalt(id);
    let shear = a.z;
    let wrap = vec2i(i32(params.size));
    let ip = ((vec2i(floor(pixel)) % wrap) + wrap) % wrap;
    // The warp displaces every lookup below by two noises of 32-px cells, so no lattice line shows.
    let d = matRow(base + 43u);
    let e = matRow(base + 44u);
    var at = pixel;
    if (d.x > 0.0) {
        let wc = vec2f(16.0);
        at += d.x * vec2f(mmLatticeG(pixel, wc, 0.0, 0.0, salt + 26u).x, mmLatticeG(pixel, wc, 0.0, 0.0, salt + 27u).x);
    }
    var h = 0.0;
    var g = vec2f(0.0);
    for (var k = 1u; k < 7u; k++) {
        let cell = f32(1u << k);
        // The lattice is skewed too, alternately one way and the other by band, so no cell edge stays vertical: the light shows the
        // flat ground-slope of an edge column as a streak.
        let skew = e.z * select(-1.0, 1.0, (k & 1u) == 1u) * select(0.0, 1.0, k >= 3u);
        var n = mmLatticeG(at, mmCells(cell, stretch), shear, skew, salt + k);
        if (e.y > 0.0) {
            // Streaks at fine scale only: band k keeps its stretch and shear down to band e.y and fades into an isotropic band over the next.
            let wk = clamp(e.y + 1.0 - f32(k), 0.0, 1.0);
            if (wk < 1.0) { n = mix(mmLatticeG(at, mmCells(cell, 1.0), 0.0, skew, salt + k), n, wk); }
        }
        let ridge = select(1.0, -1.0, n.x < 0.0);
        let t = mix(n.x, 1.0 - 2.0 * abs(n.x), b.x);
        let dt = mix(1.0, -2.0 * ridge, b.x);
        let amp = mmAmp(r0, r1, k);
        h += amp * t;
        g += amp * dt * n.yz;
    }
    var z = a.w * h;
    if (b.y > 0.0) {
        let cells = mmCells(b.y, 1.0);   // facets, seams and veins are isotropic: the stretch and shear are the grain's
        let fc = mmFacets(at, cells, 0.0, salt + 21u, e.x);
        if (d.y > 0.0) {
            // A cone: its slope points from the cell's feature point, outward for a bump and inward for a pit, in pixel units.
            let off = fc.toward / cells;
            g += d.y * select(-1.0, 1.0, mmHash(fc.cell, salt + 28u) > 0.5) * normalize(off + vec2f(1e-5));
        }
        let tilt = vec2f(mmHash(fc.cell, salt + 23u), mmHash(fc.cell, salt + 24u)) * 2.0 - 1.0;
        g += b.z * tilt;
        z += b.w * (mmHash(fc.cell, salt + 25u) * 2.0 - 1.0);
        var seamW = c.x;
        if (d.z > 0.0) { seamW *= max(1.0 + d.z * 1.6 * mmLatticeG(at, max(floor(cells * 1.5), vec2f(1.0)), 0.0, 0.0, salt + 29u).x, 0.0); }
        var seam = mmLine((fc.f2 - fc.f1) * 0.5 * b.y, seamW);
        if (d.w > 0.0) { seam *= smoothstep(2.0 * d.w - 1.0, 2.0 * d.w - 0.7, mmLatticeG(at, max(floor(cells / 4.0), vec2f(1.0)), 0.0, 0.0, salt + 30u).x); }
        z -= c.y * seam;
    }
    let light = vec3f(cos(a.y) * 0.70711, sin(a.y) * 0.70711, 0.70711);
    let n3 = normalize(vec3f(-a.x * g, 1.0));
    z += 4.0 * (dot(n3, light) - 0.70711);
    z += r0.x * (mmHash(ip, salt) * 2.0 - 1.0);
    let f = matRow(base + 45u);
    if (f.x > 0.0) { z -= mmStrokes(at, f, c.z, e.w, salt); }
    var vein = 0.0;
    if (v.w > 0.0) {
        let cells = mmCells(c.w, 1.0);
        let n = mmLatticeG(at, cells, 0.0, 0.0, salt + 31u);
        let gate = mmLatticeG(at, max(floor(cells / 3.0), vec2f(1.0)), 0.0, 0.0, salt + 32u).x;
        let dist = abs(n.x) / max(length(n.yz), 1e-4);
        vein = mmLine(dist, c.z) * smoothstep(1.0 - 2.0 * v.w, 1.4 - 2.0 * v.w, gate);
    }
    return vec2f(z, vein);
}
fn mmLit(id: u32, pixel: vec2f) -> vec3f {
    let base = id * MM_ROWS;
    let r2 = matRow(base + 2u);
    let veinRow = matRow(base + 42u);
    let salt = mmSalt(id);
    let wrap = vec2i(i32(params.size));
    let ip = ((vec2i(floor(pixel)) % wrap) + wrap) % wrap;
    let zv = mmLitZ(base, id, pixel);
    let u = mmU(base, zv.x);
    var rgb = mmRamp(base, u);
    let at = clamp(u * 16.0 - 0.5, 0.0, 15.0);
    let i0 = u32(floor(at));
    let dir = mix(matRow(base + 19u + i0).rgb, matRow(base + 19u + min(i0 + 1u, 15u)).rgb, fract(at));
    let white = (mmHash(ip, salt + 8u) + mmHash(ip, salt + 9u) + mmHash(ip, salt + 10u) - 1.5) * 2.0;
    let two = mmCells(2.0, 1.0);
    let soft = (mmLattice(pixel, two, salt + 11u) + mmLattice(pixel, two, salt + 12u) + mmLattice(pixel, two, salt + 13u)) * 1.85;
    rgb += dir * mix(white, soft, r2.x) * r2.y;
    rgb = mix(rgb, veinRow.rgb, zv.y);
    return clamp(rgb, vec3f(0.0), vec3f(255.0)) / 255.0;
}

// ---- H14d: the dither pass ------------------------------------------------------------------------------------------------------
// The depth of the dot field at a pixel (row 62), periodic through mmWrapCell.
fn mmDots(p: vec2f, f: vec4f, salt: u32) -> f32 {
    let cells = mmCells(f.x, 1.0);
    let cpx = params.size / cells.x;
    let c = vec2i(floor(p / cpx));
    var total = 0.0;
    for (var j = -1; j <= 1; j++) {
        for (var i = -1; i <= 1; i++) {
            let cc = mmWrapCell(c + vec2i(i, j), cells);
            if (mmHash(cc, salt + 60u) > f.y) { continue; }
            let ctr = (vec2f(c + vec2i(i, j)) + vec2f(0.15 + 0.7 * mmHash(cc, salt + 61u), 0.15 + 0.7 * mmHash(cc, salt + 62u))) * cpx;
            let d = distance(p, ctr) / max(f.z, 0.1);
            total = max(total, exp(-0.5 * d * d));
        }
    }
    return total * f.w;
}

// One invocation per DITHER_BLOCK square of a dithered layer, level 0: serpentine Floyd-Steinberg on rgb. The field being reduced is the
// layer's own smooth colour (z through the rank map and the ramp), reduced to the nearest of the material's colours.
@compute @workgroup_size(8, 8, 1)
fn makeDither(@builtin(global_invocation_id) id: vec3u) {
    let base = id.z * MM_ROWS;
    let blocks = u32(params.size) / DITHER_BLOCK;
    if (id.x >= blocks || id.y >= blocks) { return; }
    let r2 = matRow(base + 2u);
    if (r2.z <= 0.0) { return; }
    let lit = matRow(base + 39u).x > 0.0;
    let dots = matRow(base + 62u);
    var rows: array<array<vec3f, 34>, 2>;
    for (var i = 0u; i < 34u; i++) { rows[0][i] = vec3f(0.0); rows[1][i] = vec3f(0.0); }
    let origin = vec2i(id.xy * DITHER_BLOCK);
    for (var y = 0u; y < DITHER_BLOCK; y++) {
        let cur = y & 1u;
        let nxt = cur ^ 1u;
        for (var i = 0u; i < 34u; i++) { rows[nxt][i] = vec3f(0.0); }
        let left = (y & 1u) == 0u;
        for (var j = 0u; j < DITHER_BLOCK; j++) {
            let x = select(DITHER_BLOCK - 1u - j, j, left);
            let dx = select(-1, 1, left);
            let pi = origin + vec2i(i32(x), i32(y));
            let pixel = vec2f(pi) + 0.5;
            var z = 0.0;
            var vein = 0.0;
            if (lit) {
                let zv = mmLitZ(base, id.z, pixel);
                z = zv.x;
                vein = zv.y;
            } else {
                z = mmUnlitZ(id.z, pixel, 1.0).x;
            }
            if (dots.x > 0.0) { z -= mmDots(pixel, dots, mmSalt(id.z)); }
            let smoothRgb = mmRamp(base, mmU(base, z));
            let v = clamp(smoothRgb + rows[cur][x + 1u], vec3f(0.0), vec3f(255.0));
            var best = 1e30;
            var pick = v;
            for (var k = 0u; k < 16u; k++) {
                let c = matRow(base + 46u + k);
                if (c.w <= 0.0) { continue; }
                let d = dot(c.rgb - v, c.rgb - v);
                if (d < best) { best = d; pick = c.rgb; }
            }
            let err = v - pick;
            let c1 = u32(i32(x + 1u) + dx);
            rows[cur][c1] += err * 0.4375;
            rows[nxt][u32(i32(x + 1u) - dx)] += err * 0.1875;
            rows[nxt][x + 1u] += err * 0.3125;
            rows[nxt][c1] += err * 0.0625;
            var rgb = mix(smoothRgb, pick, r2.z);
            if (lit) { rgb = mix(rgb, matRow(base + 42u).rgb, vein); }
            textureStore(out, pi, i32(id.z), vec4f(clamp(rgb, vec3f(0.0), vec3f(255.0)) / 255.0, 1.0));
        }
    }
}

@compute @workgroup_size(8, 8, 1)
fn makeMaterial(@builtin(global_invocation_id) id: vec3u) {
    let n = u32(params.size / params.foot);   // texels across this level (size is level 0's)
    if (id.x >= n || id.y >= n) { return; }
    if (matRow(id.z * MM_ROWS + 2u).z > 0.0) {
        // Dithered: level 0 is makeDither's; the levels above are box means of the one above.
        if (params.foot > 1.5) {
            let s = vec2i(id.xy) * 2;
            let sum = textureLoad(prev, s, i32(id.z), 0) + textureLoad(prev, s + vec2i(1, 0), i32(id.z), 0)
                + textureLoad(prev, s + vec2i(0, 1), i32(id.z), 0) + textureLoad(prev, s + vec2i(1, 1), i32(id.z), 0);
            textureStore(out, vec2i(id.xy), i32(id.z), vec4f(sum.rgb * 0.25, 1.0));
        }
        return;
    }
    if (matRow(id.z * MM_ROWS + 39u).x > 0.0) {
        if (params.foot > 1.5) {
            let s = vec2i(id.xy) * 2;
            let sum = textureLoad(prev, s, i32(id.z), 0) + textureLoad(prev, s + vec2i(1, 0), i32(id.z), 0)
                + textureLoad(prev, s + vec2i(0, 1), i32(id.z), 0) + textureLoad(prev, s + vec2i(1, 1), i32(id.z), 0);
            textureStore(out, vec2i(id.xy), i32(id.z), vec4f(sum.rgb * 0.25, 1.0));
        } else {
            textureStore(out, vec2i(id.xy), i32(id.z), vec4f(mmLit(id.z, vec2f(id.xy) + 0.5), 1.0));
        }
        return;
    }
    // The texel's centre in level-0 pixels, as the draw's snapped pixel of a footprint-sized step.
    let pixel = (vec2f(id.xy) + 0.5) * params.foot;
    let rgb = mmColor(id.z, pixel, params.foot);
    textureStore(out, vec2i(id.xy), i32(id.z), vec4f(rgb, 1.0));
}

// Development only (measure/swatch.mjs --z): a lit material's z at level 0, 16 bits across red and green, for the fit's rank quantiles.
@compute @workgroup_size(8, 8, 1)
fn makeZ(@builtin(global_invocation_id) id: vec3u) {
    let n = u32(params.size);
    if (id.x >= n || id.y >= n) { return; }
    let z = mmLitZ(id.z * MM_ROWS, id.z, vec2f(id.xy) + 0.5).x;
    let q = u32(clamp((z + 8.0) / 16.0, 0.0, 1.0) * 65535.0);
    textureStore(out, vec2i(id.xy), i32(id.z), vec4f(f32(q >> 8u) / 255.0, f32(q & 255u) / 255.0, 0.0, 1.0));
}
