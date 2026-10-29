// Card H3: a land material made from numbers, with no image (Green).
//
// A material is MM_ROWS vec4f rows, read through the host's matRow(i):
//   row 0   band amplitudes for cells of 1, 2, 4 and 8 px (z units)
//   row 1   amplitudes for cells of 16, 32 and 64 px; w: stretch (grain runs along x when above 1)
//   row 2   x: tint spatial mix (0: per pixel, 1: cells of 2 px); y: tint scale; z: 1 for a palette mosaic (the plain)
//   rows 3-18   the ramp: RGB (0..255) at 16 luma quantiles, darkest first; for a palette mosaic, 16 entries in luma order with their share in w
//   rows 19-34  the tint: at each quantile, the direction the colours leave the ramp, times its s.d.
// materials/green.json holds the numbers and how each was measured.
//
// The colour at a pixel: z is a sum of band-limited noise (a hash per pixel,
// then smooth value noise at cells of 2, 4 ... 64 px) with the measured
// amplitudes, so it has the image's spectrum. The normal distribution turns z
// into a rank u, the ramp turns u into a colour with the image's histogram,
// and the tint adds the colour spread that luma does not explain.
//
// Footprint: foot is the size of one drawn pixel in material pixels (1 at
// final resolution, 4 at a quarter). Bands whose cells are smaller than the
// footprint fade out, so a coarse draw keeps the mean and the broad pattern
// and loses only the grain it cannot show. The marginal is not renormalised:
// a coarser draw has less contrast, as a blurred image has.
const MM_ROWS = 35u;

fn mmHash(c: vec2i, salt: u32) -> f32 {
    var n = bitcast<u32>(c.x) * 374761393u + bitcast<u32>(c.y) * 668265263u + salt * 2246822519u;
    n = (n ^ (n >> 13u)) * 1274126177u;
    n = (n ^ (n >> 16u)) * 2246822519u;
    return f32(n ^ (n >> 15u)) / 4294967295.0;
}
// Smooth value noise on a lattice of `cell` pixels, in -1..1.
fn mmLattice(pixel: vec2f, cell: vec2f, salt: u32) -> f32 {
    let q = pixel / cell;
    let c = vec2i(floor(q));
    let f = fract(q);
    let w = f * f * (3.0 - 2.0 * f);
    let a = mmHash(c, salt);
    let b = mmHash(c + vec2i(1, 0), salt);
    let d = mmHash(c + vec2i(0, 1), salt);
    let e = mmHash(c + vec2i(1, 1), salt);
    return mix(mix(a, b, w.x), mix(d, e, w.x), w.y) * 2.0 - 1.0;
}
// The normal distribution function, by its tanh form (error under .002).
fn mmPhi(z: f32) -> f32 { return 0.5 + 0.5 * tanh(0.7978846 * z * (1.0 + 0.044715 * z * z)); }

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

// Variance of the bands, in z units squared per unit amplitude: a hash in -1..1 is 1/3; a smoothstep lattice of
// those is (1/3) * .7429 ^ 2 (the mean squared weight of a cell's corners, in x and in y).
const MM_V0 = 0.33333;
const MM_VL = 0.18395;

fn mmRamp(base: u32, u: f32) -> vec3f {
    let at = clamp(u * 16.0 - 0.5, 0.0, 15.0);
    let i0 = u32(floor(at));
    return mix(matRow(base + 3u + i0).rgb, matRow(base + 3u + min(i0 + 1u, 15u)).rgb, fract(at));
}

fn mmPick(base: u32, u: f32) -> vec3f {
    var cum = 0.0;
    for (var i = 0u; i < 16u; i++) {
        let e = matRow(base + 3u + i);
        cum += e.w;
        if (u <= cum) { return e.rgb; }
    }
    return matRow(base + 18u).rgb;
}

fn mmColor(id: u32, pixel: vec2f, foot: f32) -> vec3f {
    let base = id * MM_ROWS;
    let r0 = matRow(base);
    let r1 = matRow(base + 1u);
    let r2 = matRow(base + 2u);
    let stretch = max(r1.w, 0.1);
    let salt = id * 16u + 1u;
    let ip = vec2i(floor(pixel));
    // Band 0 (cells of 1 px) is the hash itself: no lattice to fade, it goes when a pixel covers more than one.
    let w0 = clamp(2.0 / foot - 1.0, 0.0, 1.0);
    var z = r0.x * (mmHash(ip, salt) * 2.0 - 1.0) * w0;
    var lost = r0.x * r0.x * MM_V0 * (1.0 - w0 * w0);
    for (var k = 1u; k < 7u; k++) {
        let cell = f32(1u << k);
        let w = clamp((cell / foot - 0.5) * 2.0, 0.0, 1.0);
        let a = mmAmp(r0, r1, k);
        z += a * w * mmLattice(pixel, vec2f(cell * stretch, cell), salt + k);
        lost += a * a * MM_VL * (1.0 - w * w);
    }
    // A coarse draw averages the grain it cannot show: a five-point Gauss-Hermite rule over the lost
    // variance keeps the mean colour (the ramp at the median alone would not) and the image's broad histogram.
    let s = sqrt(lost);
    // A palette mosaic (the plain) names one entry by its share, so the draw holds exact palette colours; a coarse
    // draw averages the entries over the lost grain as the ramp does.
    if (r2.z > 0.5) {
        return (mmPick(base, mmPhi(z)) * 0.533333
              + (mmPick(base, mmPhi(z - s * 1.355626)) + mmPick(base, mmPhi(z + s * 1.355626))) * 0.222076
              + (mmPick(base, mmPhi(z - s * 2.856970)) + mmPick(base, mmPhi(z + s * 2.856970))) * 0.011257) / 255.0;
    }
    var rgb = mmRamp(base, mmPhi(z)) * 0.533333
            + (mmRamp(base, mmPhi(z - s * 1.355626)) + mmRamp(base, mmPhi(z + s * 1.355626))) * 0.222076
            + (mmRamp(base, mmPhi(z - s * 2.856970)) + mmRamp(base, mmPhi(z + s * 2.856970))) * 0.011257;
    let at = clamp(mmPhi(z) * 16.0 - 0.5, 0.0, 15.0);
    let i0 = u32(floor(at));
    let dir = mix(matRow(base + 19u + i0).rgb, matRow(base + 19u + min(i0 + 1u, 15u)).rgb, fract(at));
    // The tint noise: three hashes make a near-normal value per pixel, mixed toward cells of 2 px.
    let white = (mmHash(ip, salt + 8u) + mmHash(ip, salt + 9u) + mmHash(ip, salt + 10u) - 1.5) * 2.0;
    let soft = (mmLattice(pixel, vec2f(2.0), salt + 11u) + mmLattice(pixel, vec2f(2.0), salt + 12u) + mmLattice(pixel, vec2f(2.0), salt + 13u)) * 1.85;
    let fade = mix(w0, clamp((2.0 / foot - 0.5) * 2.0, 0.0, 1.0), r2.x);
    rgb += dir * mix(white, soft, r2.x) * r2.y * fade;
    return clamp(rgb, vec3f(0.0), vec3f(255.0)) / 255.0;
}
