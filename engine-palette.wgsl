// H14e: the palette lookup, made at startup from the palette's colours (materials/palette.json) in one compute pass.
// The draw reads a 1024 x 288 texture over a 32 x 32 x 32 colour cube (column r + 32 b, row g, each coordinate c standing for c * 255 / 31):
//   rows   0-31   the nearest palette colour, by distance in rgb
//   rows 32-287   eight candidate colours, 32 rows each (row 32 + 32 k + g is candidate k), sorted dark to light (OKLab L)
// The candidates are Knoll's pattern dithering (card P9): eight times, take the palette colour nearest the cube colour plus the error
// accumulated so far, scaled by KNOLL (an implementation constant, 0.4: lower error and lower grain than the best-pair mix it replaced).
// The draw picks one by its ordered threshold, so a flat area is an even pattern of the colours whose mean is the colour asked for.
// A world may restrict the palette to some of its colours (its table's palette.entries); colours then come only from those.
@group(0) @binding(0) var<storage, read> palette: array<vec4f>;    // per colour: rgb in 0..255, then its OKLab (so two vec4f per colour)
@group(0) @binding(1) var<uniform> count: vec4u;                    // x: number of colours
@group(0) @binding(2) var out: texture_storage_2d<rgba8unorm, write>;

fn oklab(rgb255: vec3f) -> vec3f {
    let c = rgb255 / 255.0;
    let lin = select(pow((c + 0.055) / 1.055, vec3f(2.4)), c / 12.92, c <= vec3f(0.04045));
    let lms = vec3f(
        dot(vec3f(0.4122214708, 0.5363325363, 0.0514459929), lin),
        dot(vec3f(0.2119034982, 0.6806995451, 0.1073969566), lin),
        dot(vec3f(0.0883024619, 0.2817188376, 0.6299787005), lin));
    let q = pow(max(lms, vec3f(0.0)), vec3f(1.0 / 3.0));
    return vec3f(
        dot(vec3f(0.2104542553, 0.7936177850, -0.0040720468), q),
        dot(vec3f(1.9779984951, -2.4285922050, 0.4505937099), q),
        dot(vec3f(0.0259040371, 0.7827717662, -0.8086757660), q));
}

const KNOLL = 0.4;

@compute @workgroup_size(8, 8)
fn paletteMain(@builtin(global_invocation_id) id: vec3u) {
    if (id.x >= 1024u || id.y >= 32u) { return; }
    let cube = vec3f(f32(id.x % 32u), f32(id.y), f32(id.x / 32u)) * 255.0 / 31.0;
    let lab = oklab(cube);
    let n = count.x;
    var nearest = 0u;
    var nearestD = 1e30;
    for (var i = 0u; i < n; i++) {
        let dr = palette[2u * i].xyz - cube;
        let d = dot(dr, dr);
        if (d < nearestD) { nearestD = d; nearest = i; }
    }
    // Knoll: eight candidates by error accumulation in OKLab (an earlier colour wins a tie).
    var cand = array<u32, 8>();
    var err = vec3f(0.0);
    for (var c = 0; c < 8; c++) {
        let want = lab + err * KNOLL;
        var pick = 0u;
        var pickD = 1e30;
        for (var i = 0u; i < n; i++) {
            let dl = palette[2u * i + 1u].xyz - want;
            let d = dot(dl, dl);
            if (d < pickD) { pickD = d; pick = i; }
        }
        cand[c] = pick;
        err += lab - palette[2u * pick + 1u].xyz;
    }
    // Sort by lightness (insertion; equal lightness by index, so the order is fixed).
    for (var i = 1; i < 8; i++) {
        let v = cand[i];
        let vl = palette[2u * v + 1u].x;
        var j = i - 1;
        while (j >= 0) {
            let w = cand[j];
            let wl = palette[2u * w + 1u].x;
            if (wl < vl || (wl == vl && w <= v)) { break; }
            cand[j + 1] = w;
            j--;
        }
        cand[j + 1] = v;
    }
    let at = vec2i(id.xy);
    textureStore(out, at, vec4f(palette[2u * nearest].xyz / 255.0, 1.0));
    for (var c = 0; c < 8; c++) {
        textureStore(out, at + vec2i(0, 32 + 32 * c), vec4f(palette[2u * cand[c]].xyz / 255.0, 1.0));
    }
}
