// H14e: the palette lookup, made at startup from the palette's colours (materials/palette.json) in one compute pass.
// The draw reads a 1024 x 96 texture over a 32 x 32 x 32 colour cube (column r + 32 b, row g, each coordinate c standing for c * 255 / 31):
//   rows  0-31   the nearest palette colour, by distance in rgb
//   rows 32-63   colour A of the colour's best pair
//   rows 64-95   colour B of the pair
// The pair is chosen in OKLab among the ten palette colours nearest the cube colour: the one whose segment A-B passes closest to it,
// plus a small penalty on mixing distant colours (weighted by how even the mix is), so near colours are preferred where they serve.
// A world may restrict the palette to some of its colours (its table's palette.entries); colours and pairs then come only from those.
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

@compute @workgroup_size(8, 8)
fn paletteMain(@builtin(global_invocation_id) id: vec3u) {
    if (id.x >= 1024u || id.y >= 32u) { return; }
    let cube = vec3f(f32(id.x % 32u), f32(id.y), f32(id.x / 32u)) * 255.0 / 31.0;
    let lab = oklab(cube);
    let n = count.x;
    // The nearest colour in rgb, and the ten nearest in OKLab (insertion into a sorted list; an earlier colour wins a tie).
    var nearest = 0u;
    var nearestD = 1e30;
    var best = array<u32, 10>();
    var bestD = array<f32, 10>(1e30, 1e30, 1e30, 1e30, 1e30, 1e30, 1e30, 1e30, 1e30, 1e30);
    for (var i = 0u; i < n; i++) {
        let e = palette[2u * i];
        let dr = e.xyz - cube;
        let d = dot(dr, dr);
        if (d < nearestD) { nearestD = d; nearest = i; }
        let dl = palette[2u * i + 1u].xyz - lab;
        var dist = dot(dl, dl);
        var index = i;
        for (var k = 0; k < 10; k++) {
            if (dist < bestD[k]) {
                let td = bestD[k]; let ti = best[k];
                bestD[k] = dist; best[k] = index;
                dist = td; index = ti;
            }
        }
    }
    let k = min(n, 10u);
    var err = 1e30;
    var pa = best[0];
    var pb = best[0];
    for (var i = 0u; i < k; i++) {
        for (var j = i; j < k; j++) {
            let a = palette[2u * best[i] + 1u].xyz;
            let b = palette[2u * best[j] + 1u].xyz;
            let d = b - a;
            let dd = max(dot(d, d), 1e-12);
            let t = clamp(dot(lab - a, d) / dd, 0.0, 1.0);
            let p = a + d * t;
            let e = dot(lab - p, lab - p) + 0.1 * dd * t * (1.0 - t);
            if (e < err) { err = e; pa = best[i]; pb = best[j]; }
        }
    }
    let at = vec2i(id.xy);
    textureStore(out, at, vec4f(palette[2u * nearest].xyz / 255.0, 1.0));
    textureStore(out, at + vec2i(0, 32), vec4f(palette[2u * pa].xyz / 255.0, 1.0));
    textureStore(out, at + vec2i(0, 64), vec4f(palette[2u * pb].xyz / 255.0, 1.0));
}
