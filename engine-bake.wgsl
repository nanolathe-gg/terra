// WGSL port of the former relief-bake.frag, as a compute pass (measured a
// little faster than a full-screen render pass). The renderer builds this
// module with BAKE defined. See sculpt-common.wgsl for naming: uniform uFoo is u.foo.
/*COMMON*/
// Fall-line relief, baked once per height change at one texel per world
// pixel. Authored appearance detail: it is lit, never exported as height.
//
// Each octave sums oriented cosine kernels from jittered cell points. The
// kernels' wavefronts run down the local fall line, so the sum forms ribs
// and gullies that follow the slope. Later octaves turn toward the gullies
// of earlier ones, so channels branch. The kernel construction follows the
// public "eroded terrain noise" shader technique (clayjohn; Fewes); the
// scales and gains here are this prototype's own choices.
//
// Its uniforms (u.reliefScale ... u.crackMajor) are listed, with their
// meanings, in the bake section of the Uniforms struct.

const TAU = 6.28318530718;

// Returns (value, d/dx, d/dy) in the octave's own coordinates.
fn gullies(q: vec2f, dir: vec2f) -> vec3f {
    let cell = floor(q);
    let local = fract(q);
    var sum = vec3f(0.0);
    var weight = 0.0;
    for (var j = -2; j <= 1; j++) {
        for (var i = -2; i <= 1; i++) {
            let o = vec2f(f32(i), f32(j));
            let jitter = cellHash(cell - o);
            let point = local + o - jitter * 0.5;
            let w = exp(-dot(point, point) * 2.0);
            // A random phase and wavelength per kernel keep ribs on a straight
            // face from settling into evenly spaced teeth.
            let extra = cellHash(cell - o + 91.7);
            let freq = TAU * mix(1.0, 0.6 + 0.9 * extra.x, u.reliefJitter);
            let phase = dot(point, dir) * freq + extra.y * TAU * u.reliefJitter;
            sum += vec3f(cos(phase), -sin(phase) * dir * freq) * w;
            weight += w;
        }
    }
    return sum / weight;
}

// Painted scatter (card C5), f in -1..1 at p (0 unpainted). Unpainted the
// density is the world's own, exactly. Painted sparser it falls linearly to 0
// (none); painted denser it doubles up to three times (8x) and never drops
// below f * base, so the brush works where the world's slider is 0 (the base
// values are editor policy, not measurements). A painted-denser cell also
// takes stones on level ground, not only where slopes and cliff feet shed
// them. Stones read f at their centre, so a stone is wholly in or out.
const SCATTER_BASE = 0.80;
fn scatterAt(p: vec2f) -> f32 {
#ifdef CHUNK
    return textureSampleLevel(masksTex, linearClamp, maskUv(p), 1, 0.0).r;
#else
    return textureSampleLevel(masksTex, linearClamp, (p / (u.size - 1.0) * (u.grid - 1.0) + 0.5) / u.grid, 1, 0.0).r;
#endif
}
fn scatterDensity(f: f32, world: f32, base: f32) -> f32 {
    return select(world * (1.0 + f), max(world * exp2(3.0 * f), f * base), f > 0.0);
}

// Card P16: one loose-material scatter. Six size classes, each half the one before (diameters 32 .. 1 px), each on its own jittered grid
// of cells 3.2 radii wide with one candidate per cell. A pixel looks at the 2 x 2 candidates nearest it in each class, so nothing scatters and
// nothing needs atomics. A candidate is admitted by its own hash against a probability from the mask at its centre: Supply (the ground share
// it covers), a Gaussian in log size around the median diameter (Size) whose width is Sorting's. A larger class suppresses a smaller
// stone that overlaps it, by lookup. Shapes: angular chips, rounded stones with a wobbly outline, flat slabs, partly buried by the fines.
// Original code, after the ld-* lab modules (Wei 2010's multi-class idea; Turcotte's fragmentation power law).
const LS_K = 6;
const LS_COVER = 0.30;       // the ground share one full class covers
const LS_RMAX = 16.0;        // class 0's nominal radius, px
const LS_BASE = 0.50;        // the cover a Supply of 1 gives where the source is full (one candidate per cell caps it near half)
const LS_HEIGHT = 0.8;       // a stone's height as a share of its radius
const LS_CONTACT = 0.35;     // darkness of the fines in contact with a stone

struct LsOut { s: vec3f, plant: vec3f }   // looseStones: (stone height, rock cover, contact shade), (plant height, light tone, dark tone)
struct LsCand { c: vec2f, r: f32, ok: bool, h0: u32, fines: f32 }
struct LsMask { a: vec4f, b: vec4f }   // two populations (supply, median px, log2 spread, fines); b is the runout blocks

fn lsPcg(v: u32) -> u32 {
    let s = v * 747796405u + 2891336453u;
    let w = ((s >> ((s >> 28u) + 4u)) ^ s) * 277803737u;
    return (w >> 22u) ^ w;
}
fn lsHash(c: vec2i, salt: u32) -> u32 { return lsPcg(bitcast<u32>(c.x) ^ lsPcg(bitcast<u32>(c.y) + salt)); }
fn lsU(h: u32) -> f32 { return f32(h >> 8u) / 16777216.0; }
fn lsR(k: i32) -> f32 { return LS_RMAX * exp2(-f32(k)); }

// Where stones are, how big and how buried, at p, from the engine's own masks: the Time pass's talus, flow, channel and deposit
// (weatherAt, timeMapsAt), the slope and the cliff above (baseHeight), the painted scatter (scatterAt) and the deposits override.
//  - Sources: loose ground on slopes, talus aprons and the foot of a cliff, gravel where water left a deposit or runs hard.
//  - Sorting: along the way stones travel (a gentler slope is further out) rockfall coarsens, a fan or channel fines.
//  - Beyond the talus toe a second, coarser population lies: the runout blocks.
fn lsMaskCompute(c: vec2f) -> vec4f {
    let none = vec4f(0.0);
    var paint = 0.0;
    if (u.scatterOn != 0) { paint = scatterAt(c); }
    if (u.looseSupply <= 0.0 && paint <= 0.0) { return none; }
    let h0 = baseHeight(c);
    if (routeProtection(c) > 0.05 || h0 < u.sea + 1.0) { return none; }
    let tm = timeMapsAt(c);
    let deposit = tm.deposit;
    // The slope as broadGradient's units (the height difference over 10 px), from forward differences over 5 px: three height reads, not five.
    let g = 2.0 * vec2f(baseHeight(c + vec2f(5.0, 0.0)) - h0, baseHeight(c + vec2f(0.0, 5.0)) - h0);
    let slope = length(g);
    let talus = smoothstep(0.02, 0.25, tm.talus);
    // The cliff above: the Time pass's slope map 14 px up the fall line (a smoothstep of the slope, so .9 and 1.6 of the 10-px gradient are .0107 and .032 of it).
    let cliffAbove = smoothstep(0.0107, 0.032, timeMap2((c - tm.fall * 14.0) / (u.size - 1.0)).w);
    let foot = max(talus, cliffAbove * (1.0 - smoothstep(0.5, 1.0, slope)));
    let loose = smoothstep(0.10, 0.5, slope) * (1.0 - smoothstep(1.6, 2.6, slope));
    let channel = smoothstep(0.03, 0.22, tm.channel);
    let fan = smoothstep(0.05, 0.3, deposit) * (1.0 - smoothstep(0.2, 0.6, tm.slope));
    let carried = max(channel, fan);
    var source = max(max(foot, 0.8 * loose), max(0.6 * fan, 0.5 * channel));
    var supply = u.looseSupply;
    if (u.scatterOn != 0) {
        supply = scatterDensity(paint, u.looseSupply, SCATTER_BASE);
        source = max(source, max(paint, 0.0));
    }
    source *= depositsAt(c);
    // How far along its way a stone has come: a gentler slope is further out.
    let travelled = 1.0 - smoothstep(0.25, 0.9, slope);
    let sort = u.stoneSort;
    let size = u.looseSize * mix(1.0, mix(0.3 + 0.7 * travelled, 1.0 - 0.7 * travelled, carried), sort);
    let sigma = mix(2.0, 0.7, sort);
    let fines = clamp(0.15 + 0.45 * (1.0 - smoothstep(0.2, 0.8, slope)) + 0.2 * carried, 0.0, 0.85);
    let share = supply * LS_BASE * source;
    return vec4f(min(share, 0.98), size, fines, 0.35 * sort * talus * smoothstep(0.5, 1.0, travelled) * supply * LS_BASE);
}

// Card P31: where plants grow, at c: the covers of the ground-cover classes that grow them (coverAt, the draw's own site maps and windows) as shares of
// the ground: grass (turf and dry grass), meadow (and wet rush), scrub, moss. A path, water and what the draw reads as no ground give none.
fn plantMask(c: vec2f) -> vec4f {
    if (u.plantsOn < 0.5) { return vec4f(0.0); }
    let h0 = baseHeight(c);
    if (routeProtection(c) > 0.05 || h0 < u.sea + 1.0) { return vec4f(0.0); }
    let tm = timeMapsAt(c);
    let broad = broadGradient(c);
    let around = 0.25 * (baseHeight(c - vec2f(3.0, 0.0)) + baseHeight(c + vec2f(3.0, 0.0)) + baseHeight(c - vec2f(0.0, 3.0)) + baseHeight(c + vec2f(0.0, 3.0)));
    var vegetation = 1.0 + u.lushness;
    if (u.overrideOn != 0) { vegetation += textureSampleLevel(masksTex, linearClamp, maskUv(c), 4, 0.0).r; }
    let cover = coverAt(length(broad), broad, clamp((h0 - around) / 1.5, -1.0, 1.0), tm, vegetation);
    var total = 0.0;
    for (var k = 0u; k < 7u; k++) { total += cover[k]; }
    return vec4f(cover[2] + 0.6 * cover[1], cover[3] + cover[6], cover[4] + 0.3 * cover[3] + 0.2 * cover[6], cover[5]) / max(total, 1e-4);
}

// The mask is computed once on a lattice of LS_CELL-px cells over the bake's window and its margin (looseMain, a pass before the bake) and read
// here with one load: a candidate's centre reads the cell it lies in. Population a is (supply, median px, spread, fines); b the runout blocks.
const LS_CELL = 4.0;
@group(1) @binding(1) var<storage, read_write> looseMask: array<vec4f>;
fn lsCell(c: vec2f) -> u32 {
    let nx = u32(u.looseGrid.z);
    let cell = clamp(vec2i(floor(c / LS_CELL - u.looseGrid.xy)), vec2i(0), vec2i(i32(u.looseGrid.z) - 1, i32(u.looseGrid.w) - 1));
    return 2u * (u32(cell.y) * nx + u32(cell.x));
}
fn lsMask(c: vec2f) -> LsMask {
    let v = looseMask[lsCell(c)];
    var m: LsMask;
    m.a = vec4f(v.x, v.y, mix(2.0, 0.7, u.stoneSort), v.z);
    m.b = vec4f(v.w, u.looseSize * 2.2, 0.5, v.z);
    return m;
}

@compute @workgroup_size(8, 8)
fn looseMain(@builtin(global_invocation_id) id: vec3u) {
    if (f32(id.x) >= u.looseGrid.z || f32(id.y) >= u.looseGrid.w) { return; }
    let c = (vec2f(id.xy) + u.looseGrid.xy + 0.5) * LS_CELL;
    let at = 2u * (id.y * u32(u.looseGrid.z) + id.x);
    looseMask[at] = lsMaskCompute(c);
    looseMask[at + 1u] = plantMask(c);
}


// Class k's share of one population (supply, median px, spread): the supply times a Gaussian in log2 diameter, over the classes' sum.
fn lsShare(k: i32, pop: vec4f) -> f32 {
    if (pop.x <= 0.0) { return 0.0; }
    let ls = log2(max(pop.y, 0.5));
    var wsum = 0.0; var wk = 0.0;
    for (var j = 0; j < LS_K; j++) {
        let z = (log2(2.0 * lsR(j)) - ls) / max(pop.z, 0.15);
        let e = exp(-0.5 * z * z);
        wsum += e; if (j == k) { wk = e; }
    }
    return pop.x * wk / max(wsum, 1e-6);
}

// The most a class's candidate can be admitted with, whatever the mask: the supply times the class's share of a population (at most reach / .76,
// the nearest class to a median is under half an octave from it), the runout blocks adding up to .35 of the supply, a deposits override
// doubling it, painted scatter up to 8x.
fn lsBound(k: i32) -> f32 {
    if (u.scatterOn != 0) { return 1.0; }
    let x = log2(2.0 * lsR(k));
    let off = max(0.0, max(log2(0.3 * u.looseSize) - x, x - log2(u.looseSize)));
    let spread = mix(2.0, 0.7, u.stoneSort);
    let runout = x - log2(2.2 * u.looseSize);
    let reach = exp(-0.5 * off * off / (spread * spread)) + 0.35 * u.stoneSort * exp(-2.0 * runout * runout);
    return clamp(select(1.0, 2.0, u.overrideOn != 0) * u.looseSupply * LS_BASE * reach / (0.76 * LS_COVER), 0.0, 1.0);
}

// Class k's candidate in cell cc: its place and radius (log-uniform within the class, so the classes join into one continuous distribution).
fn lsGeo(k: i32, cc: vec2i) -> LsCand {
    var o: LsCand;
    let R = lsR(k);
    let cell = 3.2 * R;
    let h0 = lsHash(cc, 0x1d5au + u32(k) * 0x9e3779b9u);
    let h1 = lsPcg(h0 ^ 0x68e31da4u);
    let h2 = lsPcg(h1 ^ 0xb5297a4du);
    o.c = (vec2f(cc) + 0.5 + (vec2f(lsU(h0), lsU(h1)) - 0.5) * 0.9) * cell;
    o.r = R * exp2(lsU(h2) - 0.5);
    o.h0 = h0;
    o.ok = false; o.fines = 0.0;
    return o;
}

// Admits the candidate by its own hash against the probability the mask gives at its centre. The hash is known before the mask, so most
// candidates are turned away on the class's bound without a single mask read.
fn lsAdmit(k: i32, g: LsCand) -> LsCand {
    var o = g;
    let hAdmit = lsU(lsPcg(lsPcg(lsPcg(g.h0 ^ 0x68e31da4u) ^ 0xb5297a4du) ^ 0x1b873593u));
    if (hAdmit >= lsBound(k)) { return o; }
    let m = lsMask(o.c);
    if (m.a.x <= 0.0 && m.b.x <= 0.0) { return o; }
    o.fines = m.a.w;
    let P = clamp((lsShare(k, m.a) + lsShare(k, m.b)) / LS_COVER, 0.0, 1.0);
    o.ok = hAdmit < P;
    return o;
}

fn lsCand0(k: i32, cc: vec2i) -> LsCand { return lsAdmit(k, lsGeo(k, cc)); }

// True where an accepted stone of the next larger class overlaps candidate o of class k.
fn lsSuppressed(k: i32, o: LsCand) -> bool {
    if (k == 0) { return false; }
    let j = k - 1;
    let b = vec2i(floor(o.c / (3.2 * lsR(j)) - 0.5));
    for (var jj = 0; jj <= 1; jj++) {
        for (var ii = 0; ii <= 1; ii++) {
            let pc = lsCand0(j, b + vec2i(ii, jj));
            if (pc.ok && distance(pc.c, o.c) < 0.85 * (pc.r + o.r)) { return true; }
        }
    }
    return false;
}

// One stone's height (0..1 of its own height) and signed distance (px, negative inside) at q, local to its centre.
fn lsStone(q0: vec2f, st: LsCand) -> vec2f {
    let h1 = lsPcg(st.h0 ^ 0x2545f491u); let h2 = lsPcg(h1 ^ 0x9e3779b9u); let h3 = lsPcg(h2 ^ 0x85ebca6bu); let h4 = lsPcg(h3 ^ 0xc2b2ae35u);
    let ang = lsU(h1) * TAU;
    let asp = 0.62 + 0.38 * lsU(h2);
    let q = turn(-ang) * q0 / st.r;
    let round = lsU(h3) < u.stoneRound;
    let slab = lsU(h4) < u.stoneSlab;
    var h = 0.0; var d = 0.0;
    if (slab) {
        let hb = vec2f(1.0, asp * 0.7);
        let qq = abs(q) - hb + 0.25;
        d = length(max(qq, vec2f(0.0))) + min(max(qq.x, qq.y), 0.0) - 0.25;
        let tilt = 0.25 * (vec2f(lsU(h4 * 7u + 1u), lsU(h4 * 13u + 5u)) - 0.5);
        h = select(0.0, (0.42 + dot(q, tilt)) * smoothstep(0.0, 0.18, -d), d < 0.0);
    } else if (round || st.r < 1.3) {
        let n = 2.0 + 1.5 * lsU(h4);
        let e = vec2f(abs(q.x), abs(q.y) / asp);
        let a = atan2(q.y, q.x);
        let wob = 1.0 + 0.10 * sin(2.0 * a + lsU(h2) * TAU) + 0.07 * sin(3.0 * a + lsU(h3) * TAU);
        let s = pow(pow(e.x, n) + pow(e.y, n), 1.0 / n) / wob;
        d = s - 1.0;
        h = sqrt(max(0.0, 1.0 - s * s));
    } else {
        // An angular chip: 5-7 half planes make a convex outline; the facets meet at an off-centre apex under a flat cap.
        let N = 5 + i32(lsU(h4) * 3.0);
        let apex = (vec2f(lsU(h2 * 3u + 7u), lsU(h3 * 5u + 3u)) - 0.5) * 0.7;
        var dd = -1e9; var roof = 1e9;
        for (var i = 0; i < N; i++) {
            let hi = lsPcg(st.h0 + u32(i) * 0x27d4eb2du);
            let th = (f32(i) + 0.8 * (lsU(hi) - 0.5)) * TAU / f32(N);
            let nn = vec2f(cos(th), sin(th) / asp);
            let len = length(nn);
            let nrm = nn / len;
            let off = (0.78 + 0.22 * lsU(lsPcg(hi))) / len;
            dd = max(dd, dot(q, nrm) - off);
            roof = min(roof, (off - dot(q, nrm)) / max(off - dot(apex, nrm), 0.05));
        }
        d = dd;
        h = min(1.0, max(roof, 0.0) * (1.25 + 0.5 * lsU(h1 * 9u + 1u)));
    }
    // Partly buried: the fines round the stone cut it below its top; the outline shrinks with the burial.
    let bury = clamp(0.12 + 0.55 * st.fines + 0.2 * (lsU(h2 * 11u + 3u) - 0.5), 0.0, 0.85);
    let hv = max(0.0, h - bury) / (1.0 - bury);
    let dv = select(d + 0.6 * bury, 0.6 * (bury - h), d < 0.0);
    return vec2f(hv, dv * st.r);
}


// Card P31: plants as heights the draw lights, the shape families of the one scatter. Each is a jittered-grid scatter (2 x 2 candidates, a pure
// function of position) admitted by its own hash against the share the plant mask gives at its centre:
//  - fine tufts (turf and dry grass): star-shaped bumps 1-1.4 px in radius, on a 2.5-px grid;
//  - coarse tufts on a 4.5-px grid: meadow clumps (2-2.5 px, leaning blades) and moss cushions (smooth domes packed edge to edge);
//  - shrubs: a lumpy dome 2.4-4.8 px in radius with leaf clumps of a pixel or two, gathered into thickets by a clump field, only on scrub. Smaller than
//    a tree sprite, so a shrub is ground, not a feature.
// Tuft size follows Size (median stone px; 5 is the unit), tuft and shrub height their scale in the world's table (row 39). Tufts fade out between
// 1 and 2 world px per pixel, shrubs between 2 and 4: finer than a pixel they would alias.
// One lattice per tuft size (cell, radius range). `which` 0 is the fine lattice (turf and dry grass); 1 the coarse one, where a candidate is a meadow clump
// or a moss cushion by the shares at its centre.
fn plantTuft(p: vec2f, cell: f32, r0: f32, r1: f32, ht: f32, which: i32, salt: u32) -> vec2f {
    let b = vec2i(floor(p / cell - 0.5));
    var best = 0.0; var tone = 0.0;
    for (var j = 0; j <= 1; j++) {
        for (var i = 0; i <= 1; i++) {
            let cc = b + vec2i(i, j);
            let h0 = lsHash(cc, salt);
            let h1 = lsPcg(h0 ^ 0x68e31da4u);
            let c = (vec2f(cc) + 0.5 + (vec2f(lsU(h0), lsU(h1)) - 0.5) * 0.9) * cell;
            let d = p - c;
            let l = length(d);
            if (l >= r1) { continue; }
            let h2 = lsPcg(h1 ^ 0xb5297a4du); let h3 = lsPcg(h2 ^ 0x1b873593u);
            let r = mix(r0, r1, lsU(h3));
            if (l >= r) { continue; }
            let m = looseMask[lsCell(c) + 1u];
            var share = m.x * 0.85;
            var dome = 0.0; var star = 1.0; var hs = 1.0;
            if (which == 1) {
                let wm = m.y * 0.92; let wc = m.w * 0.97;
                share = wm + wc;
                if (lsU(lsPcg(h3 ^ 0x7f4a7c15u)) * share >= wm) { dome = 1.0; star = 0.0; hs = 0.65; }
            }
            // Tufts gather in patches of about 14 px: the thinner ground between lets the soil's own colour through.
            share *= mix(0.55, 1.0, smoothstep(-0.3, 0.5, valueNoise(c / 14.0 + 3.0 * f32(which))));
            if (lsU(lsPcg(h2 ^ 0x2545f491u)) >= share) { continue; }
            let t = 1.0 - l / r;
            let blades = 5.0 + 3.0 * lsU(lsPcg(h1));
            var bumpy = 1.0;
            if (star > 0.0) { bumpy = mix(1.0, 0.5 + 0.5 * cos(blades * atan2(d.y, d.x) + lsU(lsPcg(h3)) * TAU), smoothstep(0.8, 1.8, r)); }
            let prof = mix(t, sqrt(max(0.0, 1.0 - (1.0 - t) * (1.0 - t))), dome);
            let hv = ht * hs * (0.7 + 0.6 * lsU(lsPcg(h2))) * prof * bumpy;
            // The tuft's own tone: its own light or dark, lighter toward its top.
            if (hv > best) { best = hv; tone = 0.6 * lsU(lsPcg(h1 ^ 0x9e3779b9u)) - 0.1 + 0.5 * t; }
        }
    }
    return vec2f(best, tone);
}
fn plantShrub(p: vec2f, scale: f32) -> vec2f {
    let cell = 16.0;
    let b = vec2i(floor(p / cell - 0.5));
    var best = 0.0; var tone = 0.0;
    for (var j = 0; j <= 1; j++) {
        for (var i = 0; i <= 1; i++) {
            let cc = b + vec2i(i, j);
            let h0 = lsHash(cc, 0x5e7bu);
            let h1 = lsPcg(h0 ^ 0x68e31da4u); let h2 = lsPcg(h1 ^ 0xb5297a4du); let h3 = lsPcg(h2 ^ 0x1b873593u);
            let c = (vec2f(cc) + 0.5 + (vec2f(lsU(h0), lsU(h1)) - 0.5) * 0.85) * cell;
            let d = p - c;
            let l = length(d);
            if (l > 5.4) { continue; }
            let sc = looseMask[lsCell(c) + 1u].z;
            if (sc <= 0.0) { continue; }
            let clump = smoothstep(-0.35, 0.55, valueNoise(c / 75.0 + 11.0));
            let lam = sc * mix(1.0, 2.6 * clump * clump, 0.8) * cvr(39u).z;
            if (lsU(lsPcg(h2 ^ 0x2545f491u)) >= lam) { continue; }
            let R = mix(2.4, 4.4, lsU(h3)) * (0.75 + 0.4 * sc);
            let a = atan2(d.y, d.x);
            let re = R * (1.0 + 0.16 * sin(3.0 * a + lsU(lsPcg(h1)) * TAU) + 0.1 * sin(5.0 * a + lsU(lsPcg(h2)) * TAU));
            let q = l / re;
            if (q >= 1.0) { continue; }
            let leaf = 0.5 + 0.5 * valueNoise((p + vec2f(cc) * 37.0) / 1.4);
            let hv = scale * re * sqrt(1.0 - q * q) * (0.78 + 0.4 * leaf);
            // A canopy is dark inside, its leaf clumps lighter at the top.
            if (hv > best) { best = hv; tone = (1.0 - q) * leaf * 1.4 - 0.7; }
        }
    }
    return vec2f(best, tone);
}
fn plantsAt(p: vec2f) -> vec3f {
    let t = cvr(39u);
    let zoom = max(1.0, fieldScale());
    let fadeTuft = 1.0 - smoothstep(1.0, 2.0, zoom);
    let fadeShrub = 1.0 - smoothstep(2.0, 4.0, zoom);
    let sz = clamp(u.looseSize / 5.0, 0.6, 1.6);
    let m = looseMask[lsCell(p) + 1u];
    var best = vec2f(0.0);
    if (fadeTuft > 0.0 && t.x > 0.0) {
        let k = t.x * sz * fadeTuft;
        let a = plantTuft(p, 4.0 * sz, 1.5 * sz, 2.2 * sz, 0.6 * k, 0, 0x7103u);
        let c = plantTuft(p, 5.0 * sz, 1.9 * sz, 2.8 * sz, 1.4 * k, 1, 0x7104u);
        if (a.x > best.x) { best = a; }
        if (c.x > best.x) { best = c; }
        // Between tufts the ground lies in their shade.
        if (best.x <= 0.0) { best.y = -0.12 * min(1.0, m.x + m.y + m.w); }
        best.y = mix(0.0, best.y, fadeTuft);
    }
    if (fadeShrub > 0.0 && t.y > 0.0 && t.z > 0.0) {
        let s = plantShrub(p, t.y * fadeShrub);
        if (s.x > best.x) { best = s; }
    }
    return vec3f(best.x, clamp(best.y, 0.0, 1.0), clamp(-best.y, 0.0, 1.0));
}

// The scatter at p: (stone height, rock cover, contact shade of the fines beside a stone, plant height).
fn looseStones(p: vec2f) -> LsOut {
    let stones = u.looseSupply > 0.0 || u.scatterOn != 0;
    if (!stones && u.plantsOn < 0.5) { return LsOut(vec3f(0.0), vec3f(0.0)); }
    var best = 0.0; var cover = 0.0; var edge = 1e9; var edgeFines = 0.0; var bestR = 1.0;
    for (var k = 0; k < LS_K; k++) {
        let R = lsR(k);
        if (R < 0.45 || !stones) { break; }
        // A class the mask cannot give a stone to is skipped: the median runs from .3 to 1 of Size, the runout blocks lie at 2.2 times it, and a
        // class more than a spread away from both holds under 4% of a population.
        let x = log2(2.0 * R);
        let off = max(0.0, max(log2(0.3 * u.looseSize) - x, x - log2(u.looseSize)));
        let spread = mix(2.0, 0.7, u.stoneSort);
        let runout = x - log2(2.2 * u.looseSize);
        let reach = max(exp(-0.5 * off * off / (spread * spread)), 0.35 * u.stoneSort * exp(-2.0 * runout * runout));
        if (reach < 0.04) { continue; }
        let cell = 3.2 * R;
        let b = vec2i(floor(p / cell - 0.5));
        for (var j = 0; j <= 1; j++) {
            for (var i = 0; i <= 1; i++) {
                var st = lsGeo(k, b + vec2i(i, j));
                if (distance(p, st.c) > 1.6 * st.r) { continue; }
                st = lsAdmit(k, st);
                if (!st.ok) { continue; }
                if (lsSuppressed(k, st)) { continue; }
                let s = lsStone(p - st.c, st);
                if (s.y < edge) { edge = s.y; edgeFines = st.fines; }
                let hh = s.x * st.r * LS_HEIGHT * (0.75 + 0.5 * lsU(lsPcg(st.h0 ^ 0x51u)));
                if (hh > best) {
                    best = hh; bestR = st.r;
                    cover = smoothstep(0.0, 0.15, s.x) * select(1.0, 0.55, lsU(lsPcg(st.h0 ^ 0x7f4a7c15u)) < u.stoneMoss);
                }
            }
        }
    }
    var contact = 0.0;
    if (best <= 0.0 && edge < 1e8) { contact = LS_CONTACT * (1.0 - edgeFines) * (1.0 - smoothstep(0.0, 1.0 + 0.25 * min(bestR, 6.0), edge)); }
    var plant = vec3f(0.0);
    if (u.plantsOn > 0.5) {
        plant = plantsAt(p);
        // A stone lies on the plants; a plant taller than the stone hides it.
        if (plant.x > best) { cover = 0.0; contact = 0.0; }
        else { plant = vec3f(0.0); }
    }
    return LsOut(vec3f(best, cover, contact), plant);
}

// Cracks, as a fractured surface rather than lines drawn on it. Three
// nested cellular networks, as retail rock and Gaea's eroded surfaces show:
//  - major cracks bound blocks; cells stretch down the fall line, so most
//    run down the slope, and on gentle ground only these reach;
//  - minor cracks split each block. Their lattice is turned and shifted per
//    block, so they end against the block's major cracks (T-junctions)
//    instead of crossing them;
//  - hairline crazing splits each minor block the same way.
// Blocks step and tilt a little against each other on rocky ground, which
// gives the surface its depth. A crack's core is dark; the wall facing the
// sun is lit and the other is in shadow.
fn turn(a: f32) -> mat2x2f { let c = cos(a); let s = sin(a); return mat2x2f(c, s, -s, c); }

struct Crack { id: vec2f, point: vec2f, dist: f32, normal: vec2f, open: f32 }

// One level. q is the level's own domain (world px, perhaps turned per
// parent block); fall is the local fall line in that domain. Cells stretch
// along it. Finds the nearest cell, then the nearest *open* edge of that
// cell: its distance (world px), outward normal and openness. Each edge (a
// pair of cells) is open or not by its own hash against the share; edges
// across the slope stay closed unless network is high.
fn fractureLevel(q: vec2f, fall: vec2f, cell: f32, stretch: f32, share: f32, network: f32, salt: f32) -> Crack {
    var r: Crack;
    r.dist = 1e9; r.open = 0.0; r.normal = vec2f(0.0);
    let across = vec2f(-fall.y, fall.x);
    let g = floor(q / cell);
    let reach = i32(ceil(stretch)) + 1;
    var best = 1e9;
    for (var j = -4; j <= 4; j++) {
        for (var i = -4; i <= 4; i++) {
            if (abs(i) > reach || abs(j) > reach) { continue; }
            let c = g + vec2f(f32(i), f32(j));
            let point = (c + 0.1 + 0.8 * cellHash(c + salt)) * cell;
            let d = point - q;
            let m = vec2f(dot(d, fall) / stretch, dot(d, across));
            let dist = dot(m, m);
            if (dist < best) { best = dist; r.id = c; r.point = point; }
        }
    }
    if (share <= 0.0) { return r; }
    let ma = vec2f(dot(r.point - q, fall) / stretch, dot(r.point - q, across));
    for (var j = -4; j <= 4; j++) {
        for (var i = -4; i <= 4; i++) {
            if (abs(i) > reach || abs(j) > reach) { continue; }
            let c = g + vec2f(f32(i), f32(j));
            if (all(c == r.id)) { continue; }
            let point = (c + 0.1 + 0.8 * cellHash(c + salt)) * cell;
            let mb = vec2f(dot(point - q, fall) / stretch, dot(point - q, across));
            var n = mb - ma;
            let len = length(n);
            if (len < 1e-4) { continue; }
            n /= len;
            // The bisector seen in the world: normal (n.x / stretch, n.y) in the
            // (fall, across) basis; the pixel sits at the origin.
            let seen = vec2f(n.x / stretch, n.y);
            let d = dot(0.5 * (ma + mb), n) / length(seen);
            if (d > r.dist) { continue; }
            let worldNormal = normalize(fall * seen.x + across * seen.y);
            let acrossSlope = abs(dot(worldNormal, fall));
            let keep = 1.0 - smoothstep(mix(0.45, 1.05, network), mix(0.65, 1.25, network), acrossSlope);
            let lo = min(r.id, c);
            let hi = max(r.id, c);
            let ticket = cellHash(lo * 1.31 + hi * 7.77 + salt + 0.5).x;
            let open = keep * smoothstep(ticket - 0.06, ticket + 0.06, share);
            if (open <= 0.01) { continue; }
            r.dist = d; r.open = open; r.normal = worldNormal;
        }
    }
    return r;
}

// Crack shading at a pixel from one level: (dark, lit). The core is dark;
// just outside it, the wall on this side is lit if it faces the sun, else
// in shadow. Width in world px.
fn crackShade(c: Crack, width: f32, sun: vec2f, wall: f32) -> vec2f {
    if (c.open <= 0.0) { return vec2f(0.0); }
    let half_ = width * 0.5;
    let core = 1.0 - smoothstep(half_ - 0.45, half_ + 0.45, c.dist);
    let side = (smoothstep(half_ - 0.3, half_ + 0.3, c.dist) - smoothstep(half_ + 0.7, half_ + 1.5, c.dist)) * wall;
    // This pixel's wall descends toward the crack, along +normal.
    let facing = dot(c.normal, sun);
    let lit = side * smoothstep(0.1, 0.6, facing);
    let shadow = side * smoothstep(0.1, 0.6, -facing) * 0.7;
    return vec2f(max(core, shadow), lit) * c.open;
}

// H23: how far a crack's kinks and bends carry, and how far the cracks reach onto gentle slopes (0: steep faces only, 1: onto gentle ground), the same on every world.
const CRACK_JAGGED = 0.6;
const CRACK_REACH = 0.6;
// H23: the elongation of the crack cells along the fall line, the same on every world.
const CRACK_LENGTH = 2.0;
// H24: the slope a shallow cracked bed's cracks are cut for (the land's rocky faces are cut from about 1), the same on every world.
const BED_CRACK_SLOPE = 1.0;

// The relief style of crackShade (card E3, ordered rock): the groove is carved
// and lit rather than inked. Its floor keeps only a light core, the wall
// facing the sun is a wider lit lip, and the wall turned from the sun shades
// by the carved geometry plus a faint tone. Returns (dark, lit).
fn crackShadeRelief(c: Crack, width: f32, sun: vec2f, wall: f32) -> vec2f {
    if (c.open <= 0.0) { return vec2f(0.0); }
    let half_ = width * 0.5;
    let core = 1.0 - smoothstep(half_ - 0.45, half_ + 0.45, c.dist);
    let side = (smoothstep(half_ - 0.3, half_ + 0.3, c.dist) - smoothstep(half_ + 1.1, half_ + 3.0, c.dist)) * wall;
    let facing = dot(c.normal, sun);
    let lit = side * smoothstep(0.0, 0.5, facing);
    let shadow = side * smoothstep(0.0, 0.5, -facing) * 0.35;
    return vec2f(max(core * 0.3, shadow), lit) * c.open;
}

// Returns (carved depth, dark, lit, block relief).
// boost (0..1, card C5 painted cracks "more") raises the world's severity and
// level shares to at least its defaults times boost, so cracks also appear in a
// world that has none; 0 changes nothing.
fn cracks(p: vec2f, fall: vec2f, slope: f32, mask: f32, h: f32, boost: f32) -> vec4f {
    let severity = max(u.crackSeverity, 0.6 * boost);
    let majorShare = max(u.crackMajor, 0.8 * boost);
    // Frost: above 1 the finer levels fill in (full shares at 1.5), the cracks widen to double and the blocks step twice as far; the carve keeps growing with the depth.
    let frost = clamp(2.0 * (severity - 1.0), 0.0, 1.0);
    let minorShare = max(max(u.crackMinor, 0.75 * boost), frost);
    let hairShare = max(max(u.crackHairline, 0.6 * boost), frost);
    let blockShare = max(u.crackBlocks, 0.6 * boost);
    if (u.cracksOn == 0 || mask <= 0.0 || severity <= 0.0 || h < u.sea + 1.0) { return vec4f(0.0); }
    let start = mix(0.95, 0.10, CRACK_REACH);
    // Rocky ground takes the whole hierarchy; gentle ground only majors.
    let rocky = smoothstep(start, start * 1.9, slope);
    let gentle = smoothstep(start * 0.35, start * 1.1, slope);
    if (gentle <= 0.0) { return vec4f(0.0); }
    let sun = normalize(u.sun.xy);
    let major = u.crackSpacing;
    let minorCell = major / 3.2;
    let hairCell = max(3.0, major / 9.0);
    // Shared warp: every level bends with the rock.
    let w = p + CRACK_JAGGED * major * (0.30 * vec2f(valueNoise(p / (major * 1.3) + 1.7), valueNoise(p / (major * 1.3) + 20.8))
                                       + 0.07 * vec2f(valueNoise(p / (major * 0.16) + 5.0), valueNoise(p / (major * 0.16) + 9.4)));
    // The shape's Cracks amount sets how cracked it is; the knobs set the
    // share of each level at full strength.
    let m = smoothstep(0.0, 0.5, clamp(mask, 0.0, 1.0));
    // With face ledges (faceStreak) the majors on steep ground follow the
    // contours too, as the relief's wavefronts do.
    var majorFall = fall;
    if (u.faceStreak > 0.0) {
        let turnBy = u.faceStreak * smoothstep(u.faceStreakFrom, u.faceStreakFrom + 0.35, slope) * clamp(0.75 + 0.6 * valueNoise(p / 37.0 + 71.0), 0.0, 1.0);
        majorFall = normalize(mix(fall, vec2f(-fall.y, fall.x), turnBy));
    }
    let c0 = fractureLevel(w, majorFall, major, CRACK_LENGTH, m * gentle * majorShare, u.crackNetwork, 3.7);
    // Minor lattice turned and shifted per major block.
    let h0 = cellHash(c0.id + 11.1);
    let r0 = turn(h0.x * TAU);
    let q1 = r0 * w + h0 * minorCell * 7.0 + CRACK_JAGGED * minorCell * 0.25 * vec2f(valueNoise(p / (minorCell * 0.5) + 2.2), valueNoise(p / (minorCell * 0.5) + 6.6));
    // Minor cracks also break gentle slopes, more sparsely (retail hill
    // slopes carry short cracks every 10 px or so).
    var c1 = fractureLevel(q1, r0 * fall, minorCell, 1.0 + (CRACK_LENGTH - 1.0) * 0.4, m * mix(0.5, 1.0, rocky) * gentle * minorShare, 1.0, 9.1);
    c1.normal = transpose(r0) * c1.normal;
    let h1 = cellHash(c1.id + c0.id * 0.37 + 23.3);
    let r1 = turn(h1.x * TAU);
    let q2 = r1 * q1 + h1 * hairCell * 5.0;
    var c2 = fractureLevel(q2, r1 * r0 * fall, hairCell, 1.0, m * mix(0.4, 1.0, rocky) * gentle * hairShare, 1.0, 21.7);
    c2.normal = transpose(r1 * r0) * c2.normal;
    // Shading: majors widest, hairlines a single soft dark pixel.
    let width = u.crackWidth * (1.0 + frost);
    let s0 = crackShade(c0, width * 1.25 * mix(0.6, 1.0, rocky), sun, 1.0);
    let s1 = crackShade(c1, width * 0.9 * mix(0.8, 1.0, rocky), sun, 0.8);
    let s2 = crackShade(c2, width * 0.55, sun, 0.0) * vec2f(0.6, 0.0);
    var dark = max(s0.x, max(s1.x, s2.x));
    var lit = max(s0.y, s1.y) * (1.0 - dark);
    // A modest V for majors and minors, so the cracks also shade at scale.
    var carve = c0.open * max(0.0, 1.0 - c0.dist / (width * 0.6 + 1.2)) * mix(0.8, 3.0, severity) * mix(0.5, 1.0, rocky)
              + c1.open * max(0.0, 1.0 - c1.dist / (width * 0.45 + 0.9)) * mix(0.4, 1.5, severity);
    // Relief style (card E3; H23: it follows the rock's order, so ordered rock has lit relief cracks and scattered rock ink): a wider, deeper groove that the light shows, a
    // light floor and a lit lip, in place of the ink. The hairlines keep their
    // faint dark pixel: they are too fine to carve.
    if (u.rockOrder > 0.0) {
        let r0 = crackShadeRelief(c0, width * 1.25 * mix(0.6, 1.0, rocky), sun, 1.0);
        let r1 = crackShadeRelief(c1, width * 0.9 * mix(0.8, 1.0, rocky), sun, 0.8);
        let rdark = max(r0.x, max(r1.x, s2.x * 0.5));
        let rlit = max(r0.y, r1.y) * (1.0 - rdark);
        let rcarve = c0.open * max(0.0, 1.0 - c0.dist / (width * 0.9 + 2.0)) * mix(1.2, 4.0, severity) * mix(0.5, 1.0, rocky)
                   + c1.open * max(0.0, 1.0 - c1.dist / (width * 0.7 + 1.5)) * mix(0.6, 2.2, severity);
        dark = mix(dark, rdark, u.rockOrder);
        lit = mix(lit, rlit, u.rockOrder);
        carve = mix(carve, rcarve, u.rockOrder);
    }
    // Blocks step and tilt against each other on rocky ground.
    let b0 = cellHash(c0.id + 5.5) - 0.5;
    let t0 = cellHash(c0.id + 8.8) - 0.5;
    let b1 = cellHash(c1.id + c0.id + 2.9) - 0.5;
    let t1 = cellHash(c1.id + c0.id + 4.4) - 0.5;
    // Each block is a tilted plane, as retail rock's lit angular facets
    // are: majors step and lean a little, minors tilt more (tilts are in
    // slope units, so each facet catches the light differently).
    // Tilts are measured in each level's own domain (the minor lattice is
    // turned and shifted), from the block's own point.
    var blocks = b0.x * mix(1.0, 3.0, severity) + dot(t0, w - c0.point) * 0.25
               + (b1.x * mix(0.6, 1.6, severity) + dot(t1, q1 - c1.point) * 0.9) * step(0.01, minorShare);
    // Like the relief, block steps grow with the slope.
    blocks *= blockShare * (1.0 + frost) * rocky * m;
    return vec4f(carve, dark, lit, blocks);
}

// Rock structure (card E3). Sedimentary beds and joints as micro-relief the
// sun lights: a ledge's lip catches the light and the notch under it
// shades, so the rock reads as coherent layers scratched by joints rather
// than as scattered gravel. Nothing here is ink.
//
// Joints: grooves close to the screen's north-south with a slight lean,
// spaced irregularly, each running in unbroken stretches (grooveRun px) with
// gaps (GROOVE_GAPS) and deepest mid-stretch; they wander a little. The beds run
// on across them. Returns the groove height offset (<= 0).
fn jointGroove() -> Groove { return lines(u.grooveAngle, u.grooveSpacing, u.jointDepth, u.grooveRun, 2.2, 11.0); }

// H23: a bed with a riser has a lip of this height; one with none has none.
const BED_LIP = 2.0;
const BED_RAG = 1.8;   // a bed's boundary wanders at 3-7 px by this many height units (was blockChip 1.2 x 1.5 on the one world that cut blocks)
// Ledges above 1 (the row runs to 2) keep the riser as it is at 1 and lift the lip, the notch and the tread's step with the row.
fn bedLip() -> f32 { return select(0.0, BED_LIP * max(1.0, u.bedLedge), u.bedLedge > 0.0); }

// Beds: planes (tilted by bedDip toward bedDipDir) cut the face in lines that
// wander broadly and wobble finely but stay continuous between joints, so the
// eye can follow one. The picture draws a point at screen row y - height / 2,
// so a plane tilted 2 height units per px toward the north (bedDip 2, bedDipDir
// 270) shows as rows that are level on the screen whatever the terrain below
// does: retail Green's rows are level, and their spacing barely changes with
// the face's steepness (8-12 px across slope bins), as these planes give.
// bedHeight 0 instead spaces the beds in px along the ground; 1 spaces them by
// height units, as the strata colours are. Bed thickness
// varies bed to bed. Each bed's surface is pulled toward a flat tread with a
// short riser (bedLedge), and the riser's top edge carries a lip with a notch
// at its foot (H23: a bed with a riser has the lip, 2 height units, and one with none has none). Returns the height offset and the lip's rock cover
// (0..1): a lip is a convex ridge, which the face material would take for
// moss on a lump top.
// H2 (column 1): the same bed shape read from the rock column. A bed's thickness is
// its own, its hardness scales how tall its ledge stands (columnContrast), and the
// bed coordinate is columnCoord at the surface height, the one erosion reads.
// Returns the same (offset, lip cover, bed index) as bedRelief.
// A bed's cut: the tread's height offset, the lip and notch (the rock model sets their height), the bed's hardness punch, the bed's index,
// how far through it the point lies (0 foot, 1 top) and its thickness along the ground (px).
struct BedCut { off: f32, lip: f32, notch: f32, punch: f32, index: f32, through: f32, px: f32 }
fn columnBedRelief(p: vec2f, h: f32, gOver: f32) -> BedCut {
    let a = radians(u.bedDipDir);
    let dip = vec2f(cos(a), sin(a));
    let G = max(select(length(broadGradient(p) + u.bedDip * dip), gOver, gOver >= 0.0), 0.15);
    let S = max(u.bedSpacing, 2.0);
    // H4 round 2: a bed's boundary wanders at 3-7 px (blockChip x 1.5 height units), so a ledge is a ragged line, not a smooth contour curve.
    let rag = select(0.0, (valueNoise(p / 7.0 + 3.0) + 0.5 * valueNoise(p / 3.0 + 9.0)) * BED_RAG, u.rockSize > 0.0);
    let bed = columnAt(columnCoord(p, h) + rag);
    let f = bed.through;
    let bedPx = bed.thick / G;
    let riser = mix(1.0, clamp(3.5 / bedPx, 0.12, 1.0), min(u.bedLedge, 1.0));
    let step_ = smoothstep(1.0 - riser, 1.0, f) - f - (0.5 * riser - 0.5);
    var off = step_ * (bed.thick / S) * select(S, u.cliffRise, u.cliffRise > 0.0) * u.bedLedge;
    let dTop = (1.0 - f) * bedPx;
    let dFoot = (f - (1.0 - riser)) * bedPx;
    let lip = exp(-dTop * dTop / 5.0);
    let notch = exp(-(dFoot + 1.0) * (dFoot + 1.0) / 6.0);
    // Hard beds (hardness 1) stand 1.7 times a hash bed's mean ledge, soft ones (0) 0.3 times: the hash's own range.
    let punch = mix(1.0, 0.3 + 1.4 * bed.hardness, u.columnContrast);
    off *= punch;
    return BedCut(off, lip, notch, punch, bed.index, f, bedPx);
}

fn bedRelief(p: vec2f, h: f32, gOver: f32) -> BedCut {
    if (u.columnSectionCount > 0) { return columnBedRelief(p, h, gOver); }
    let a = radians(u.bedDipDir);
    let dip = vec2f(cos(a), sin(a));
    let tilt = u.bedDip * dot(p, dip);
    // How fast the bed coordinate changes along the ground: beds are that many
    // px apart per unit of spacing in px mode.
    // G2: cliffFollow passes the smoothed slope instead (gOver >= 0), so beds keep their px spacing without the grid's noise.
    let G = max(select(length(broadGradient(p) + u.bedDip * dip), gOver, gOver >= 0.0), 0.15);
    let S = max(u.bedSpacing, 2.0) * pow(G, 1.0 - u.bedHeight);
    let wander = valueNoise(p / 110.0 + 3.1) * S * 0.8 + valueNoise(p / 34.0 + 8.2) * S * 0.3 + valueNoise(p / 9.0 + 2.7) * S * 0.1;
    let L = (h + tilt + wander) / S;
    // Bed boundaries sit within 0.4 of each whole step, so they never cross.
    var k = floor(L);
    var lo = k + u.bedVary * 0.8 * (cellHash(vec2f(k, 3.7)).x - 0.5);
    if (L < lo) { k -= 1.0; lo = k + u.bedVary * 0.8 * (cellHash(vec2f(k, 3.7)).x - 0.5); }
    let hi = k + 1.0 + u.bedVary * 0.8 * (cellHash(vec2f(k + 1.0, 3.7)).x - 0.5);
    let thick = hi - lo;
    let f = clamp((L - lo) / thick, 0.0, 1.0);
    // Bed thickness along the ground (px), the riser a few px wide whatever the bed.
    let bedPx = thick * S / G;
    let riser = mix(1.0, clamp(3.5 / bedPx, 0.12, 1.0), min(u.bedLedge, 1.0));
    let step_ = smoothstep(1.0 - riser, 1.0, f) - f - (0.5 * riser - 0.5);
    // G2: cliffRise gives the riser a height of its own; spaced in px the bed's height unit follows the slope and fine beds on a gentle face would carry no relief (0: the bed's own height).
    var off = step_ * thick * select(S, u.cliffRise, u.cliffRise > 0.0) * u.bedLedge;
    // The lip on the riser's top edge and the notch at its foot.
    let dTop = (1.0 - f) * bedPx;
    let dFoot = (f - (1.0 - riser)) * bedPx;
    let lip = exp(-dTop * dTop / 5.0);
    let notch = exp(-(dFoot + 1.0) * (dFoot + 1.0) / 6.0);
    // E9 bedPunch: beds differ in how hard they weather, so a few ledges stand out
    // and the eye can follow them (0: every bed alike, as before).
    let punch = mix(1.0, 0.3 + 1.4 * cellHash(vec2f(k, 9.1)).y, u.bedPunch);
    off *= punch;
    return BedCut(off, lip, notch, punch, k, f, bedPx);
}

// H4b: a hill's pieces against a face's: width and length (down the fall line) as shares of blockWidth and blockRow.
const HILL_WIDTH = 0.6;
const HILL_LENGTH = 2.2;
const HILL_RELIEF = 1.8;   // a hill's piece heights against a face's (the hills' pieces are small, so their planes need more to light)
const HILL_SEAM = 0.7;   // crevice half-width on a hill, px (a face's is 1.2): retail's hill cracks are 1-2 px
// Rock face form (card E9). Retail's big green faces are carved: broad gullies
// and ribs run down the face at a slight lean, tens of px apart, so whole
// stripes read lit or shaded; the beds run on across them; and the fine detail is angular facets, not rounded cells.
// Everything is height the sun lights; nothing here is ink.

// One groove, for every mark cut as lines (joints, gullies): a lattice of lines `spacing` apart, leaning `angle` degrees from the
// screen's north-south and bending with two octaves of noise; each line a smooth channel up to `depth` deep in runs of about `run` px with
// gaps, deepest mid-run. A family is the numbers of its Groove (jointGroove, gullyGroove); the code is shared, and so is every
// number a family does not own: its half-width is the one thing it adds, and its salt (apart from the others') seeds every noise it draws.
struct Groove {
    line: vec4f,    // angle (degrees), spacing (px), depth, run (px)
    shape: vec3f,   // the share of a run missing; the mean half-width of a channel (px); the family's salt
}
// H23: every family's runs have the same gaps (two fifths of a line's length); the worlds that cut grooves all set that.
const GROOVE_GAPS = 0.4;
fn lines(angle: f32, spacing: f32, depth: f32, run: f32, half_: f32, salt: f32) -> Groove {
    return Groove(vec4f(angle, max(spacing, 3.0), depth, max(run, 12.0)), vec3f(GROOVE_GAPS, half_, salt));
}
// The deepest cut here (a depth), the lattice coordinates (x across the lines, with `off` px added; y along them) and the index of the line
// left of x, where a gully's rib begins.
struct Cut { depth: f32, x: f32, y: f32, left: f32 }
// A line sits at (cell + .15 + .7 * hash) spacings.
fn groovePos(c: f32, g: Groove) -> f32 { return (c + 0.15 + 0.7 * cellHash(vec2f(c, g.shape.z)).x) * g.line.y; }
// Whether the stretch of a groove at distance y along its line is present: runs of about `run` px with gaps (a share of the length), per cell and salt.
fn grooveRun(cell: f32, y: f32, run: f32, gaps: f32, salt: f32) -> f32 {
    return smoothstep(mix(-1.1, 0.15, gaps), mix(-0.7, 0.55, gaps), valueNoise(vec2f(y / run, cell * 3.7) + salt));
}
fn groove(p: vec2f, g: Groove, off: f32) -> Cut {
    let a = radians(g.line.x);
    let S = g.line.y;
    let salt = g.shape.z;
    let y = dot(p, vec2f(sin(a), cos(a)));
    let x = dot(p, vec2f(cos(a), -sin(a))) + S * 0.5 * valueNoise(p / (S * 4.0) + salt) + S * 0.1 * valueNoise(p / (S * 0.9) + salt + 9.0) + off;
    let c = floor(x / S);
    var cut = Cut(0.0, x, y, c - 1.0);
    for (var i = -1; i <= 1; i++) {
        let ci = c + f32(i);
        let pos = groovePos(ci, g);
        if (pos <= x && ci > cut.left) { cut.left = ci; }
        // One hash per line: .x its width (0.7-1.3 of the half-width), .y its depth share (0.5-1.4).
        let h = cellHash(vec2f(ci, salt + 1.0));
        let t = max(0.0, 1.0 - abs(x - pos) / (g.shape.y * (0.7 + 0.6 * h.x)));
        if (t <= 0.0) { continue; }
        let swell = 0.6 + 0.4 * valueNoise(vec2f(y / (g.line.w * 0.5), ci * 5.1) + salt + 12.0);
        cut.depth = max(cut.depth, g.line.z * (0.5 + 0.9 * h.y) * swell * grooveRun(ci, y, g.line.w, g.shape.x, salt) * t * t * (3.0 - 2.0 * t));
    }
    return cut;
}

// Gullies and ribs. Gully lines lean grooveAngle from the screen's north-south
// and sit grooveSpacing apart (0.6-1.4 of it), bending with broad noise. A rib is
// the stretch of face between two gully lines: a plane tilted by its own random
// slope (ribTilt, height per px at most), so a stripe faces the sun or turns from
// it as a whole. A gully is carved into the line as a smooth channel gullyWidth
// across and up to gullyDepth deep, in runs of grooveRun px with gaps (GROOVE_GAPS),
// deepest mid-run. Returns (height offset, how deep the gully floor is here, 0..1).
fn gullyGroove() -> Groove { return lines(u.grooveAngle, u.grooveSpacing, u.gullyDepth, u.grooveRun, 0.5 * max(u.gullyWidth, 2.0), 61.0); }
fn gullyField(p: vec2f) -> vec2f {
    let g = gullyGroove();
    let cut = groove(p, g, 0.0);
    let pl = groovePos(cut.left, g);
    let t = clamp((cut.x - pl) / (groovePos(cut.left + 1.0, g) - pl), 0.0, 1.0);
    let hl = u.ribTilt * g.line.y * (cellHash(vec2f(cut.left, 77.0)).x - 0.5) * 2.0;
    let hr = u.ribTilt * g.line.y * (cellHash(vec2f(cut.left + 1.0, 77.0)).x - 0.5) * 2.0;
    return vec2f(mix(hl, hr, mix(t, smoothstep(0.0, 1.0, t), 0.4)) - cut.depth, select(0.0, cut.depth / u.gullyDepth, u.gullyDepth > 0.0));
}

// The jittered point of each cell in the 3 x 3 around q (cell units), at jit.x + jit.y * hash of its cell (facets .15 + .7, Lava .12 + .76): the nearest, its
// cell's id, and the squared distances to the nearest, second and third nearest, measured as (point - q) * metric (cell units: 1; the pieces' px: their size).
struct CellPick { id: vec2f, point: vec2f, best: f32, second: f32, third: f32 }
fn cells(q: vec2f, metric: vec2f, salt: f32, jit: vec2f) -> CellPick {
    let g = floor(q);
    var n = CellPick(g, vec2f(0.0), 1e9, 1e9, 1e9);
    for (var j = -1; j <= 1; j++) {
        for (var i = -1; i <= 1; i++) {
            let c = g + vec2f(f32(i), f32(j));
            let point = c + jit.x + jit.y * cellHash(c + salt);
            let d = (point - q) * metric;
            let dd = dot(d, d);
            if (dd < n.best) { n.third = n.second; n.second = n.best; n.best = dd; n.id = c; n.point = point; }
            else if (dd < n.second) { n.third = n.second; n.second = dd; }
            else if (dd < n.third) { n.third = dd; }
        }
    }
    return n;
}
// Card P10: the one rock model. Three parting sets cut the rock: beds (the bed's planes, read from the column), and two joint sets
// (staggered cells inside each bed, on a row-offset lattice: jitter 0 gives hexagons). Each parting is open (a crevice) or tight (a step
// only), by a hash of the two cells it separates. Each block is flattened toward its own level (terr: basalt organ pipes, stepped blocks)
// and tilted and stepped (vary); age rounds open edges and opens more partings; chips and grit are the fine facets. A rock type is the
// numbers u.rock* (world material data), never a branch. It replaced blockField, facetField, jointFieldAt and the lip and notch of bedRelief.
// H23: a tilt's y share against its x share, the same on every world (the picture squeezes steep y tilts).
const FACET_SKEW = 0.25;
// The three parting sets of the one rock model, each switched by the preset's numbers: cells (rockSize > 0: the blocks above), joint lines
// (jointDepth > 0: long grooves close to the fall line, spaced grooveSpacing apart, each bed's own offset) and beds (the tread bedRelief
// returns, and the lip on its riser's top edge with the notch at its foot: a bed with a riser has the lip, BED_LIP units, one with none has none).
// The joint lines: `off` moves the whole lattice along the beds by that many px (the stagger from bed to bed). Returns the height offset (<= 0).
fn rockLines(pf: vec2f, off: f32) -> f32 { return -groove(pf, jointGroove(), off).depth; }
fn rockLip(bed: BedCut) -> f32 { return bed.punch * bedLip() * (bed.lip - 0.8 * bed.notch); }
struct RockCell { c1: vec2f, id: vec2f, id2: vec2f, edge: f32 }
// The two nearest points of a row-staggered jittered lattice of cells `sz` px, in px: the nearest point, the cells' ids and the distance
// to the edge between the two nearest (the bisector's, exact there).
fn rockCells(x: vec2f, sz: vec2f, jit: f32, salt: f32) -> RockCell {
    let q = x / sz;
    let by = floor(q.y);
    var d1 = 1e9; var d2 = 1e9;
    var p1 = vec2f(0.0); var p2 = vec2f(0.0);
    var id = vec2f(0.0); var id2 = vec2f(0.0);
    for (var j = -1; j <= 1; j++) {
        let row = by + f32(j);
        let off = select(0.0, 0.5, fract(row * 0.5) > 0.25);
        let bx = floor(q.x - off);
        for (var i = -1; i <= 1; i++) {
            let c = vec2f(bx + f32(i), row);
            let pt = (vec2f(c.x + 0.5 + off, c.y + 0.5) + (cellHash(c + salt) - 0.5) * jit) * sz;
            let d = x - pt;
            let dd = dot(d, d);
            if (dd < d1) { d2 = d1; p2 = p1; id2 = id; d1 = dd; p1 = pt; id = c; }
            else if (dd < d2) { d2 = dd; p2 = pt; id2 = c; }
        }
    }
    return RockCell(p1, id, id2, 0.5 * (d2 - d1) / max(length(p2 - p1), 1e-4));
}
// pf: the face's own coordinates; p: the world position (fine noise); bed: the bed cut here; gx: the ground's gradient in pf's axes.
// Returns (height offset, crevice 0..1).
fn rockModel(p: vec2f, pf: vec2f, bed: BedCut, gx: vec2f, hill: f32) -> vec2f {
    let age = clamp(u.rockAge, 0.0, 1.0);
    let bs = fract(bed.index * 0.6180339) * 50.0;   // this bed's own salt and offset
    let jsz = vec2f(u.rockSize * sqrt(u.rockAspect), u.rockSize / sqrt(u.rockAspect) * select(1.0, 0.866, u.rockJitter < 0.5)) * mix(vec2f(1.0), vec2f(HILL_WIDTH, HILL_LENGTH), hill);
    let cl = rockCells(pf + vec2f(bs * 1.94, 0.0), jsz, u.rockJitter, 17.0 + bs);
    let hc = cellHash(cl.id + 23.0 + bs);
    let hv = cellHash(cl.id + 41.0 + bs);
    // A joint is open (a crevice) or tight (a step and tilt only), by a hash of the pair of cells it parts.
    let pairOpen = step(cellHash(cl.id + cl.id2 + 7.0 + bs).x, u.rockOpen + 0.3 * age);
    let bedEdge = min(bed.through, 1.0 - bed.through) * bed.px;
    let bedOpen = step(cellHash(vec2f(bed.index, 5.5)).x, u.rockBedOpen + 0.2 * age);
    let edge = min(select(1e9, cl.edge, pairOpen > 0.5), select(1e9, bedEdge, bedOpen > 0.5));
    let toPt = pf - cl.c1;
    var dh = -u.rockTerr * dot(gx, toPt) + u.rockVary * (2.4 * clamp(jsz.y / 12.0, 0.2, 1.5) * (hc.y - 0.5) + dot((hv - 0.5) * vec2f(1.0, FACET_SKEW), toPt));
    // Age: rounded shoulders.
    let roundR = age * 0.42 * min(min(jsz.x, jsz.y), bed.px);
    if (roundR > 0.3) {
        let t = 1.0 - min(edge / roundR, 1.0);
        dh -= 1.1 * roundR * (1.0 - sqrt(max(1.0 - t * t, 0.0)));
    }
    let crev = 1.0 - smoothstep(0.0, u.rockCrevW * mix(1.0, HILL_SEAM / 1.2, hill) * (1.0 + 0.6 * age), edge + 0.6 * valueNoise(p / 2.1 + 19.0));
    dh -= u.rockCrev * crev;
    // Angular chips: small facets, worn away with age.
    let chipA = u.rockChip * (1.0 - 0.7 * age);
    if (chipA > 0.01) {
        let ch = rockCells(pf + vec2f(5.0, 3.0), vec2f(u.rockChipSize, u.rockChipSize * 0.8), 1.0, 61.0 + bs);
        let k = cellHash(ch.id + 3.0);
        dh += chipA * (0.8 * dot((k - 0.5) * vec2f(1.0, FACET_SKEW), pf - ch.c1) + 0.9 * (k.y - 0.5));
        dh -= chipA * 0.5 * (1.0 - smoothstep(0.0, 0.7, ch.edge));
    }
    dh += u.rockGrit * (cellHash(floor(p) + 13.0).x - 0.5) * 2.0;
    return vec2f(dh, crev);
}

// Rock structure that follows the ground (card G2). Retail's strata lie along the contours of the
// hill they are cut in and its joints run down the fall line, so on a face turned east the beds
// are vertical on the screen and the joints run across it. The fixed screen directions above
// (bedDip, grooveAngle) are the earlier look; with cliffFollow 1 the
// ground gives the directions instead, from heights smoothed at two scales, so the direction
// does not shiver with the grid's own roughness. Where the smoothed slope is small even at the
// wide scale (painted rock on level ground) there is no fall line to follow, and the structure
// fades away (cliffFlat) into the plain broken rock the scatter makes.
struct CliffFrame { up: vec2f, grade: f32, local: f32, wideMean: f32, midMean: f32, gradient: f32 }

// The slope of the ground averaged on a ring of radius r (the first moment of eight taps, exact
// for a plane), and the ring's mean height. Only baseHeight is read, so the chunk path has it.
fn cliffRing(p: vec2f, r: f32) -> vec3f {
    var g = vec2f(0.0);
    var m = 0.0;
    for (var i = 0; i < 8; i++) {
        let a = f32(i) * 0.78539816;
        let d = vec2f(cos(a), sin(a));
        let hh = baseHeight(p + d * r);
        g += d * hh;
        m += hh;
    }
    return vec3f(g * (0.25 / r), m * 0.125);
}
fn cliffFrame(p: vec2f) -> CliffFrame {
    let mid = cliffRing(p, max(u.cliffReach, 4.0));
    let wide = cliffRing(p, max(u.cliffWide, u.cliffReach * 1.5));
    // The local fall line decides where the ground slopes; the wide one takes over where it does not.
    let local = smoothstep(0.02, 0.10, length(mid.xy));
    let v = mix(wide.xy, mid.xy, local);
    let s = length(v);
    var fr: CliffFrame;
    fr.up = select(vec2f(0.0, -1.0), v / max(s, 1e-6), s > 1e-4);
    fr.gradient = s;
    fr.local = local;
    fr.wideMean = wide.z;
    fr.midMean = mid.z;
    fr.grade = select(1.0, smoothstep(u.cliffFlat, 2.5 * u.cliffFlat, s), u.cliffFlat > 0.0);
    return fr;
}
// World position p in the frame's own coordinates: x along the contour, y down the fall line,
// measured from the seed of the patch p lies in (a jittered lattice cut by a warp, so the patch
// borders are ragged). The orientation is the ground's at the patch's seed, one for the whole
// patch: it must not vary inside it, because a coordinate x = dot(p - seed, direction(p)) shears
// with every degree the direction turns over its distance from the seed, and the grid's own
// roughness turns it tens of degrees over a few px. So each patch has straight, parallel joints
// along its seed's fall line, and neighbours differ by how far the ground turned between seeds,
// as a real face is broken into blocks. The seed's hash offsets the pattern so patches differ.
fn cliffLocal(p: vec2f) -> vec2f {
    let D = max(u.cliffDomain, 24.0);
    let pw = p + 0.2 * D * vec2f(valueNoise(p / (D * 1.1) + 7.7), valueNoise(p / (D * 1.1) + 17.3));
    let q = pw / D;
    let g = floor(q);
    var best = 1e9;
    var seed = g;
    var id = g;
    for (var j = -1; j <= 1; j++) {
        for (var i = -1; i <= 1; i++) {
            let c = g + vec2f(f32(i), f32(j));
            let pt = c + 0.2 + 0.6 * cellHash(c + 3.3);
            let d = pt - q;
            let dd = dot(d, d);
            if (dd < best) { best = dd; seed = pt; id = c; }
        }
    }
    let rel = (q - seed) * D;
    let up = cliffFrame(seed * D).up;
    let contour = vec2f(-up.y, up.x);
    return vec2f(dot(rel, contour), dot(rel, -up)) + (cellHash(id + 9.9) - 0.5) * 600.0;
}

// Beach: dry ground within reach of the water, as the world's coast
// sections show (Zhon: sand runs ~180 px inland). The reach varies along the
// coast and its inland edge is ragged. Distance to water is found by
// marching outward in 16 directions.
fn beachCover(p: vec2f, h: f32, slope: f32) -> f32 {
    if ((u.beachDistance <= 0.0 && u.apron <= 0.0) || h <= u.sea) { return 0.0; }
    let vary = 0.45 + 0.9 * (valueNoise(p / 90.0 + 31.0) * 0.5 + 0.5);
    let reach = u.beachDistance * vary;
    let apron = u.apron * vary;
    let far = max(reach, apron) * 1.15;
    var nearWater = 1e9;
    var nearRise = 1e9;
    for (var k = 0; k < 16; k++) {
        let a = f32(k) * 0.3926991 + 0.2;
        let dir = vec2f(cos(a), sin(a));
        for (var r = 1; r <= 8; r++) {
            let d = far * f32(r) / 8.0;
            if (d >= min(nearWater, nearRise)) { break; }
            let there = baseHeight(p + dir * d);
            let water = there < u.sea && d <= reach * 1.15;
            // A sand apron gathers round raised rock (Zhon's domes).
            let rise = there > h + 6.0 && d <= apron * 1.15;
            if (!water && !rise) { continue; }
            // Refine the crossing between this step and the last, so the
            // band's edge is smooth rather than notched by the step.
            var lo = far * f32(r - 1) / 8.0;
            var hi = d;
            for (var b = 0; b < 4; b++) {
                let mid = 0.5 * (lo + hi);
                let t = baseHeight(p + dir * mid);
                if (select(t > h + 6.0, t < u.sea, water)) { hi = mid; } else { lo = mid; }
            }
            if (water) { nearWater = hi; } else { nearRise = hi; }
            break;
        }
    }
    let jitter = (valueNoise(p / 9.0 + 17.0) * 0.5);
    var beach = 0.0;
    if (u.beachDistance > 0.0) { beach = 1.0 - smoothstep(reach * 0.88, reach, nearWater + jitter * reach * 0.12); }
    var sandApron = 0.0;
    if (u.apron > 0.0) { sandApron = 1.0 - smoothstep(apron * 0.8, apron, nearRise + jitter * apron * 0.2); }
    return max(beach, sandApron) * (1.0 - smoothstep(0.9, 1.5, slope));
}

// Contour bands, as in retail maps rendered from height-banded terrain:
// the ground steps in shallow terraces of uBandSpacing height units, so thin
// wavy lines follow the contours (measured on retail Green: median step 3.7,
// lines 10-20 px apart on gentle slopes, tight rings round lakes). Each
// riser carries a thin dark line; the lines wander and break into dashes.
// Returns (height offset, line strength, facing: +1 lit riser, -1 shaded).
// Retail lines are tonal steps, not drawn lines: a riser facing the sun is
// a light line and one facing away a dark one; they are jagged at pixel
// scale, broken into dashes, and mostly on gentle slopes (blind round 7).
fn contourBands(p: vec2f, h: f32, slope: f32, fall: vec2f, banding: f32) -> vec3f {
    if (banding <= 0.0 || h < u.sea + 0.5) { return vec3f(0.0); }
    // Low banks drawn level (flatBank, Archipelago) carry no bands either.
    if (u.flatBank > 0.0 && h < u.base - 0.5) { return vec3f(0.0); }
    // Bands fade out over slopes bandFade * 0.35 / 0.75 to bandFade (default
    // 0.35-0.75; Green fades sooner, as retail's banded slopes are gentle).
    var gate = smoothstep(0.07, 0.18, slope) * (1.0 - smoothstep(u.bandFade * (0.35 / 0.75), u.bandFade, slope));
    // H5 3a: retail's gentle slopes carry few of the small dashes the risers make there.
    gate *= 1.0 - u.terraceCalm * (1.0 - smoothstep(0.15, 0.40, slope));
    if (gate <= 0.0) { return vec3f(0.0); }
    let S = u.bandSpacing;
    // H5 3a: the lines of retail's terraced grass follow no contour for long: their phase wanders over 17 px and 6 px, further
    // where water has run (the wetness map), so a line bends, ends against its neighbour and re-forms.
    var wander = 0.0;
    if (u.terraceBreak > 0.0 && u.weatherMaps > 0.5) {
        let wetT = timeMapsAt(p).wet;
        wander = u.terraceBreak * (0.6 + 0.4 * wetT) * S * (valueNoise(p / 17.0 + 61.0) * 1.1 + valueNoise(p / 6.0 + 77.0) * 0.5);
    }
    // Jag: retail's terraced slopes (Great Divide) show short dashes stacked
    // like scales rather than long smooth lines: each small cell (~8 px,
    // jittered) shifts its band phase, so a line breaks and steps at the
    // cell borders.
    var jag = 0.0;
    if (u.bandJag > 0.0) {
        let q = p / 8.0 + 0.6 * vec2f(valueNoise(p / 9.0 + 5.0), valueNoise(p / 9.0 + 17.0));
        jag = (cellHash(floor(q) + 13.0).x - 0.5) * S * 0.6 * u.bandJag;
    }
    let uu = (h + jag + wander + valueNoise(p / 34.0 + 7.0) * S * 0.55 + valueNoise(p / 11.0 + 3.0) * S * 0.15
                + valueNoise(p / 3.3 + 19.0) * S * 0.06 * min(1.0, 0.3 / max(slope, 0.05))) / S;   // GLSL: u
    let v = fract(uu);
    let w = clamp(u.bandSoftness, 0.05, 1.0);
    let offset = S * (floor(uu) + smoothstep(1.0 - w, 1.0, v)) - uu * S;
    var dash = smoothstep(-0.55, 0.05, valueNoise(p / 22.0 + 51.0)) * smoothstep(-0.7, -0.1, valueNoise(p / 6.0 + 33.0))
             * (0.55 + 0.45 * (valueNoise(p / 70.0 + 9.0) * 0.5 + 0.5));
    // Jagged cells already break the lines; retail covers the whole slope.
    dash = mix(dash, 1.0, 0.7 * clamp(u.bandJag, 0.0, 1.0));
    let strength = banding * gate * dash;
    // Distance from the riser's middle, in world px along the slope.
    let px = abs(v - (1.0 - w * 0.5)) * S / max(slope, 0.02);
    let line = (1.0 - smoothstep(0.3, 1.0, px)) * strength * u.bandLine;
    // The riser leans downhill (-fall): lit if that faces the sun.
    let facing = dot(-fall, normalize(u.sun.xy + 1e-6));
    return vec3f(offset * strength, line, facing);
}

// Sand streaks, as on Zhon's sandy slopes and ramps: fine continuous lines
// along the contours, a few px apart, curving with the ground (retail ramp
// sections). Tonal only: a dark line, deeper where the slope faces away
// from the sun. Returns (line strength, facing).
fn sandStreaks(p: vec2f, h: f32, slope: f32, fall: vec2f, strength: f32) -> vec2f {
    let gate = smoothstep(0.03, 0.10, slope) * (1.0 - smoothstep(0.8, 1.4, slope));
    if (gate <= 0.0 || strength <= 0.0) { return vec2f(0.0); }
    let S = max(u.sandBandSpacing, 0.2);
    let uu = (h + valueNoise(p / 55.0 + 3.0) * S * 2.2 + valueNoise(p / 14.0 + 11.0) * S * 0.45) / S;   // GLSL: u
    let v = fract(uu);
    let px = min(v, 1.0 - v) * S / max(slope, 0.02);
    let line = (1.0 - smoothstep(0.35, 1.2, px)) * strength * gate
             * (0.7 + 0.3 * smoothstep(-0.6, 0.2, valueNoise(p / 15.0 + 61.0)));
    return vec2f(line, dot(-fall, normalize(u.sun.xy + 1e-6)));
}

// Sandiness from the weathering worker's transport (wind and water): 0
// none, small values a dusting, 1 deep sand. Thin sand lies in hollows
// first while ribs and lumps of the relief poke through it; deep sand
// covers both. Steep faces shed it.
fn sandCover(p: vec2f, slope: f32, relief: f32) -> f32 {
    if (u.sand <= 0.0) { return 0.0; }
    // The Time pass lays sand where deposit gathers, which follows the foot of every shape as an even band. Let it run out onto the plain
    // in lumps: taps round p (radius 10-120 px, direction wandering at 17 px) carry the sand of nearby cells to p only if the tap lies no
    // lower than p (sand moves downhill and outward, never up a slope) and only onto ground that is flat at p, so nothing new lands on
    // the flanks. Each tap fades over a reach that grows with how much deposit gathers there (low, concave ground runs out far, a
    // spur's foot hardly). The cover's strength wanders at 61, 23 and 9 px, so the fringe is ragged.
    let uv = p / (u.size - 1.0);
    var raw = weatherAt(uv).a;
    let reachN = valueNoise(p / 53.0 + 71.0) * 0.5 + 0.5;
    let flatHere = 1.0 - smoothstep(0.05, 0.25, slope);
    if (flatHere > 0.0) {
        let hHere = baseHeight(p);
        for (var k = 0; k < 8; k++) {
            let a = f32(k) * 0.7853982 + valueNoise(p / 17.0 + f32(k) * 3.1) * 1.4;
            let r = 10.0 + 110.0 * fract(f32(k) * 0.381966 + reachN * 0.8);
            let q = p + vec2f(cos(a), sin(a)) * r;
            let tap = weatherAt(q / (u.size - 1.0));
            let reach = 150.0 * (0.2 + 0.8 * clamp(tap.g * 2.5, 0.0, 1.0)) * (0.35 + 1.1 * reachN);
            let downhill = smoothstep(-3.0, 1.0, baseHeight(q) - hHere);
            raw = max(raw, tap.a * (1.0 - smoothstep(0.1, 1.0, r / reach)) * downhill * flatHere);
        }
    }
    let lump = clamp(0.25 + 1.5 * (0.5 + 0.5 * (0.55 * valueNoise(p / 61.0 + 5.0) + 0.3 * valueNoise(p / 23.0 + 29.0) + 0.15 * valueNoise(p / 9.0 + 3.0))), 0.0, 1.4);
    // The lumps thin the sand anywhere but add to it only on flat ground; a flank keeps less of the Time pass's sand than the plain does.
    let field = min(raw * min(lump, 1.0 + 0.4 * flatHere), 1.0) * (1.0 - 0.7 * smoothstep(0.1, 0.45, slope)) * depositsAt(p);
    if (field <= 0.0) { return 0.0; }
    let lie = clamp(-relief * 0.07, -0.35, 0.35) + valueNoise(p / 24.0 + 13.0) * 0.12;
    let thin = smoothstep(0.0, 0.25, field) * (1.0 - field);
    return clamp(field + lie * thin, 0.0, 1.0) * (1.0 - smoothstep(0.95, 1.6, slope));
}

// The painted-cover texture (Sand, Ground cover and Paint strokes) at world point p.
fn paintAt(p: vec2f) -> vec4f {
#ifdef CHUNK
    return textureSampleLevel(routesTex, linearClamp, maskUv(p), 0.0);
#else
    return textureSampleLevel(routesTex, linearClamp, (p / (u.size - 1.0) * (u.grid - 1.0) + 0.5) / u.grid, 0.0);
#endif
}

// Painted sand seen through a blur: (the share of a ring of taps 9 to 20 px out that lies inside the painted sand, which feathers the
// edge over a band a few px wide; the same at 8 to 18 px, which says how deep inside the sand p lies). The radii wander at 31 and 23 px,
// so the bands' widths are irregular. (0, 0) when no sand lies within 32 px.
fn paintSandBlur(p: vec2f, centerDepth: f32) -> vec2f {
    var near = centerDepth;
    for (var k = 0; k < 4; k++) {
        let a = f32(k) * 1.5707963 + 0.8;
        near = max(near, paintAt(p + vec2f(cos(a), sin(a)) * 32.0).b * 2.0 - 1.0);
    }
    if (near < 0.3) { return vec2f(0.0); }
    let rf = 9.0 + 11.0 * (valueNoise(p / 31.0 + 9.0) * 0.5 + 0.5);
    let rd = 8.0 + 10.0 * (valueNoise(p / 23.0 + 101.0) * 0.5 + 0.5);
    var edge = smoothstep(0.3, 0.7, centerDepth);
    var deep = 0.0;
    for (var k = 0; k < 8; k++) {
        let a = f32(k) * 0.7853982 + 0.4;
        let d = vec2f(cos(a), sin(a));
        edge += smoothstep(0.3, 0.7, paintAt(p + d * rf).b * 2.0 - 1.0);
        deep += smoothstep(0.3, 0.7, paintAt(p + d * rd).b * 2.0 - 1.0);
    }
    return vec2f(edge / 9.0, deep / 8.0);
}

const RIPPLE_CREST = 0.22;   // the darkness of the coarse grains on a crest
// Card P18: sand ripples as a pure function of position. The phase is p.w / lambda (lambda the Ripple length) plus crest sinuosity from noise
// and dislocation pairs: on a jittered lattice of 8 lambda, each pair of cores (+1, -1) adds atan2(cross(a, b), dot(a, b)) / 2pi to the phase,
// whose 2pi jump lies only between the cores and so shows nowhere modulo a cycle; each core is a Y-junction where a crest ends. The profile is
// asymmetric (a gentle stoss, a lee 0.3 lambda wide). Coarse grains ride the crests (a darker tone). Stones of the scatter's largest classes
// shed a sand shadow downwind (a tail about 6 radii long that holds the ripples flat) and scour the sand upwind.
// Returns (ripple profile -1..1, crest tone 0..1, drift height from the shadows and scours, in height units).
fn sandRipples(p: vec2f, lambda: f32) -> vec3f {
    let a = radians(u.windAngle);
    let w = vec2f(cos(a), sin(a));
    let perp = vec2f(-w.y, w.x);
    var tail = 0.0; var scour = 0.0; var fade = 0.0;
    if (u.looseSupply > 0.0 || u.scatterOn != 0) {
        for (var k = 0; k < 3; k++) {
            let R = lsR(k);
            let x = log2(2.0 * R);
            let off = max(0.0, max(log2(0.3 * u.looseSize) - x, x - log2(u.looseSize)));
            let spread = mix(2.0, 0.7, u.stoneSort);
            let runout = x - log2(2.2 * u.looseSize);
            // A class holding under a fifth of the population's stones casts too few shadows to be worth the search.
            if (max(exp(-0.5 * off * off / (spread * spread)), 0.35 * u.stoneSort * exp(-2.0 * runout * runout)) < 0.2) { continue; }
            let cell = 3.2 * R;
            let rmax = R * 1.4143;
            // A stone's centre lies up to 5 radii upwind of p and 2.5 radii downwind of it, and 1.6 radii to either side.
            let e0 = p - w * 5.0 * rmax; let e1 = p + w * 2.5 * rmax;
            let lo = vec2i(floor((min(e0, e1) - 1.6 * rmax) / cell));
            let hi = vec2i(floor((max(e0, e1) + 1.6 * rmax) / cell));
            for (var j = lo.y; j <= min(hi.y, lo.y + 5); j++) {
                for (var i = lo.x; i <= min(hi.x, lo.x + 5); i++) {
                    // Where a stone is cannot touch p is known from the cell's own hash, before the mask is read.
                    var st = lsGeo(k, vec2i(i, j));
                    let d = p - st.c;
                    let du = dot(d, w); let dv = dot(d, perp);
                    if (du < -2.5 * st.r || du > 5.0 * st.r || abs(dv) > 1.6 * st.r) { continue; }
                    st = lsAdmit(k, st);
                    if (!st.ok || lsSuppressed(k, st)) { continue; }
                    let L = 5.0 * st.r;
                    if (du > -st.r && du < L) {
                        let t = max(du, 0.0) / L;
                        let half = st.r * 0.95 * (1.0 - t * 0.85);
                        let xx = dv / half;
                        tail = max(tail, 0.55 * st.r * LS_HEIGHT * (1.0 - t) * sqrt(smoothstep(0.0, 0.25, t)) * exp(-xx * xx));
                        fade = max(fade, (1.0 - t) * smoothstep(-st.r, 0.0, du) * exp(-0.5 * xx * xx));
                    }
                    let us = (du + 1.3 * st.r) / (1.1 * st.r); let vs = dv / (1.6 * st.r);
                    scour = max(scour, exp(-(us * us + vs * vs)) * 0.25 * st.r);
                    fade = max(fade, exp(-(us * us + vs * vs)));
                }
            }
        }
    }
    // Phase in cycles: along the wind, a slow turn of the crests over about 200 px, sinuosity over about 6 lambda, and the defects.
    var ph = dot(p, w) / lambda;
    ph += 0.12 * valueNoise(p / 220.0 + 5.0) * dot(p, perp) / lambda;
    ph += 0.35 * valueNoise(p / (5.0 * lambda) + 2.0) + 0.15 * valueNoise(p / (2.3 * lambda) + 9.0);
    // A pair's window reaches 5.2 lambda, 0.65 of a cell, from a centre placed 0.1 to 0.9 into its cell: the own cell and the nearer one on each axis.
    let dcell = 8.0 * lambda;
    let b = vec2i(floor(p / dcell));
    let side = select(vec2i(1), vec2i(-1), fract(p / dcell) < vec2f(0.5));
    for (var j = 0; j <= 1; j++) {
        for (var i = 0; i <= 1; i++) {
            let c = b + vec2i(i, j) * side;
            let h = lsHash(c, 0x6d3fu);
            if (lsU(h) > 0.7) { continue; }
            let m = (vec2f(c) + 0.5 + (vec2f(lsU(lsPcg(h)), lsU(lsPcg(h ^ 1u))) - 0.5) * 0.8) * dcell;
            let sep = lambda * (1.5 + 2.5 * lsU(lsPcg(h ^ 2u)));
            let tilt = 0.5 * (lsU(lsPcg(h ^ 3u)) - 0.5);
            let dir = perp * cos(tilt) + w * sin(tilt);
            let ra = p - (m - 0.5 * sep * dir); let rb = p - (m + 0.5 * sep * dir);
            let ang = atan2(ra.x * rb.y - ra.y * rb.x, dot(ra, rb));
            let win = 1.0 - smoothstep(0.55 * sep, 0.55 * sep + 3.0 * lambda, distance(p, m));
            ph += select(1.0, -1.0, lsU(lsPcg(h ^ 4u)) < 0.5) * win * ang / TAU;
        }
    }
    let t = fract(ph);
    let lee = 0.3;
    let prof = select(0.5 + 0.5 * cos(0.5 * TAU * (t - (1.0 - lee)) / lee), 0.5 - 0.5 * cos(0.5 * TAU * t / (1.0 - lee)), t < 1.0 - lee);
    // Ripples finer than a few output pixels would alias; the shadows hold them flat.
    let band = 1.0 - smoothstep(0.25, 0.5, max(1.0, fieldScale()) / lambda);
    return vec3f((prof - 0.5) * 2.0 * band * (1.0 - 0.9 * fade), smoothstep(0.55, 0.9, prof) * band * (1.0 - fade), tail - scour);
}

// G5 (Lava): the hill rock. Retail's Lava hills are crust: a pile of rounded pillows 25-60 px across, each tilted, with a
// dark crease where it meets the next and a dark wedge where three meet; every pillow's surface is chipped into 4-8 px
// facets, olive toward the sun and brown away from it, split by hairline cracks; and thin dark veins hang down the fall
// line and fork. This builds that as height (lit by the sun like any relief) and as the dark of its creases, from the
// world position only. Returns (height added, darkness as a crack code, how much of the fall-line relief to replace).
fn lavaCrust(p: vec2f, h: f32, slope: f32, fall: vec2f) -> vec3f {
    // Raised ground only: hills and their flanks, not the banks between the sea and the plain.
    // Lava's plain undulates up to ~4 units over the base, so the crust starts above that (open ground keeps its own lumps).
    let gate = u.lavaCrust * smoothstep(u.base + 2.5, u.base + 6.5, h);
    // The fall-line relief gives way on the hill and on its foot's slope; the banks well below the plain keep theirs.
    let calm = u.lavaCalm * max(smoothstep(u.base + 0.2, u.base + 2.5, h), smoothstep(u.base - 0.6, u.base - 0.1, h) * smoothstep(0.06, 0.22, slope));
    if (gate <= 0.0) { return vec3f(0.0, 0.0, calm); }
    let across = vec2f(fall.y, -fall.x);
    // Pillows, a little longer along the contour, their borders wandering.
    let warp = vec2f(valueNoise(p / 31.0 + 3.0), valueNoise(p / 31.0 + 17.0)) * 0.22 * u.lavaPillow;
    let pp = p + warp;
    let qp = vec2f(dot(pp, across) / (u.lavaPillow * 1.35), dot(pp, fall) / u.lavaPillow);
    let pil = cells(qp, vec2f(1.0), 5.0, vec2f(0.12, 0.76));
    let pd = sqrt(vec3f(pil.best, pil.second, pil.third));
    let t = clamp(pd.x / max(pd.y, 1e-3), 0.0, 1.0);
    // A rounded dome that falls steeply at its border, each pillow standing a little higher or lower than the next.
    let dome = 1.0 - pow(t, 2.4);
    // Retail's small hills are nearly smooth (lava-1) or carry broad arcs (lava-2); the heaped pillows are the tall ones' (lava-3), so
    // the pillows and their creases grow with the height above the plain.
    let tall = smoothstep(u.base + 18.0, u.base + 70.0, h);
    var height = u.lavaPillow * mix(0.035, 0.11, tall) * (dome + 0.7 * (cellHash(pil.id + 5.0 + 31.7).x - 0.5));
    // Crease on every border, deepest toward the shade; the wedge where three pillows meet is a cut-out.
    let border = smoothstep(0.80, 0.97, t);
    let triple = 1.0 - smoothstep(0.0, 0.16, (pd.z - pd.x));
    height -= u.lavaPillow * mix(0.03, 0.08, tall) * triple;
    var dark = mix(0.2, 1.5, tall) * border + mix(0.6, 2.4, tall) * triple * smoothstep(0.35, 0.8, t);
    // Chips: flat facets tilted at random, hairline cracks on some of their borders.
    let qc = p / u.lavaChip;
    let chip = cells(qc, vec2f(1.0), 11.0, vec2f(0.12, 0.76));
    let cid = cellHash(chip.id + 11.0 + 31.7);
    let tilt = (cid - 0.5) * 2.0;
    height += dot(tilt, qc - chip.point) * u.lavaChip * mix(0.07, 0.12, tall);
    let seam = 1.0 - smoothstep(0.0, 0.16, sqrt(chip.second) - sqrt(chip.best));
    dark = max(dark, mix(0.25, 0.9, tall) * seam * step(0.55, cid.x));
    // Veins hang down the fall line: zero lines of a noise stretched along it, in stretches that begin and end.
    if (u.lavaVeins > 0.0) {
        let qv = vec2f(dot(p, across) / 7.0, dot(p, fall) / 40.0) + 0.5 * vec2f(valueNoise(p / 23.0 + 5.0), valueNoise(p / 23.0 + 9.0));
        let line = 1.0 - smoothstep(0.03, 0.17, abs(valueNoise(qv)));
        let present = smoothstep(-0.55, 0.0, valueNoise(p / 29.0 + 61.0));
        // Retail's veins are black on an untouched surface: the crack code is scaled by the world's crack darkness (.35 on Lava), so 2.9 is full.
        dark = max(dark, 2.9 * u.lavaVeins * line * present * smoothstep(0.02, 0.10, slope));
    }
    return vec3f(height * gate, dark * gate, calm);
}

// The world-resolution fields texture: one compute invocation per texel.
@group(1) @binding(0) var fieldsOut: texture_storage_2d<rgba16float, write>;

@compute @workgroup_size(8, 8)
fn bakeMain(@builtin(global_invocation_id) id: vec3u) {
    if (any(id.xy >= textureDimensions(fieldsOut))) { return; }
    // Texel (x, y) of the fields is world pixel (x, y), as in GLSL.
#ifdef CHUNK
    // Convert the global integer texel once, just as the whole-map bake does;
    // every hash/noise call receives that same world position.
    // H7b: texel (x, y) is the bake at origin + (x, y) * scale + (scale - 1) / 2, the centre of the block of final pixels it stands for.
    textureStore(fieldsOut, id.xy, bake(vec2f(id.xy) * u.chunkFieldScale + u.chunkFieldsOrigin + (u.chunkFieldScale - 1.0) * 0.5));
#else
    textureStore(fieldsOut, id.xy, bake(vec2f(id.xy)));
#endif
}


// H5 constants (retail's rates, measured in NOTES): the cracks' darkness. The cracks ride on `outcrop`, so engine 0 style off-states stay off.
const ROCK_CRACK = 2.5;

// H5 3b: rills cut along the flow. Lines parallel to the fall line, one per u.rillSpacing px across, each present for stretches
// of about 80 px, 1-3 px wide by the flow, only where the channel map says water runs hard over falling ground.
// Returns (height cut, darkness of the floor).
fn rillAt(p: vec2f, slope: f32) -> vec2f {
    if (u.rillDepth <= 0.0 || u.weatherMaps < 0.5) { return vec2f(0.0); }
    let m = timeMapsAt(p);
    // The fall line is the base height's own gradient at p, smooth at 1 px; the map's (2-px grid) only says where water runs.
    let g = broadGradient(p);
    let len = length(g);
    if (len < 0.02) { return vec2f(0.0); }
    let f = g / len;
    let perp = vec2f(-f.y, f.x);
    let spacing = max(u.rillSpacing, 3.0);
    let across = dot(p, perp) / spacing + 0.6 * valueNoise(vec2f(dot(p, f) / 60.0, dot(p, perp) / 40.0) + 7.0);
    let id = floor(across);
    let at = fract(across) - 0.5;
    let hsh = cellHash(vec2f(id, 3.1));
    let present = smoothstep(-0.25, 0.25, valueNoise(vec2f(id * 3.7, dot(p, f) / 80.0)));
    let w = (0.05 + 0.14 * m.flow) * (0.7 + 0.6 * hsh.x);
    let trough = 1.0 - smoothstep(0.0, w, abs(at - (hsh.y - 0.5) * 0.3));
    let gate = smoothstep(0.05, 0.3, m.channel) * smoothstep(0.18, 0.40, slope) * (1.0 - smoothstep(1.2, 1.8, slope)) * present;
    return vec2f(-u.rillDepth * trough * gate, trough * gate);
}

// H5 3a: the 1-2 px cracks down the fall line in grey outcrops, 20-60 px long: the zero lines of a noise stretched along the fall
// line, in stretches that begin and end. Returns their darkness.
fn outcropCracks(p: vec2f, slope: f32) -> f32 {
    if (u.weatherMaps < 0.5 || u.outcrop <= 0.0) { return 0.0; }
    let m = timeMapsAt(p);
    let zone = outcropAt(p, slope, m.wear, m.hard);
    if (zone <= 0.0) { return 0.0; }
    let len = length(m.fall);
    if (len < 0.05) { return 0.0; }
    let f = m.fall / len;
    let perp = vec2f(-f.y, f.x);
    let q = vec2f(dot(p, perp) / 6.0, dot(p, f) / 38.0) + 0.6 * vec2f(valueNoise(p / 21.0 + 41.0), valueNoise(p / 21.0 + 43.0));
    let line = 1.0 - smoothstep(0.03, 0.15, abs(valueNoise(q)));
    let present = smoothstep(-0.3, 0.25, valueNoise(p / 29.0 + 67.0));
    return ROCK_CRACK * line * present * smoothstep(0.1, 0.5, zone);
}

// Terracettes (card P32): the steps grazing and creep wear into steep grass, a riser and a level tread along the contours (the lab's vg-bands).
// The phase is the height itself, so the steps follow the contours; a phase noise braids them. The sawtooth is reshaped to a riser over a
// third of the cycle and a level tread, about 0.7 of a step high (5.6 for an 8-unit step), art only: the 16-px height bytes never see them.
// They wear on straight slopes of about 6 to 35 degrees: round hills and hollows (a contour of small radius) would close them into rings, so the
// amount fades as the radius of the contour falls. Returns (height added, worn-path darkness).
const TERRACE_STEP = 8.0;
fn terracettes(p: vec2f, h: f32, slope: f32) -> vec2f {
    let w = smoothstep(0.10, 0.20, slope) * (1.0 - smoothstep(0.62, 0.84, slope));
    if (w <= 0.0) { return vec2f(0.0); }
    // 1 / radius of the contour (px): the ring of heights 14 px out against the middle, over the slope.
    let d = 14.0;
    let ring = 0.25 * (baseHeight(p + vec2f(d, 0.0)) + baseHeight(p - vec2f(d, 0.0)) + baseHeight(p + vec2f(0.0, d)) + baseHeight(p - vec2f(0.0, d))) - h;
    let curve = abs(ring) * 4.0 / (d * d * max(slope, 0.1));
    let straight = 1.0 - smoothstep(0.008, 0.02, curve);
    let amount = w * straight;
    if (amount <= 0.0) { return vec2f(0.0); }
    let ph = h / TERRACE_STEP + 0.5 * (valueNoise(p / 24.0 + 83.0) * 0.7 + valueNoise(p / 11.0 + 29.0) * 0.3);
    let t = fract(ph);
    let dz = amount * TERRACE_STEP * (smoothstep(0.0, 0.3, t) - t);
    // The worn path along the inner tread: bare, in dashes.
    let tread = smoothstep(0.5, 0.6, t) * (1.0 - smoothstep(0.8, 0.9, t));
    let dash = smoothstep(-0.2, 0.2, valueNoise(p / 5.0 + 47.0));
    return vec2f(dz, amount * tread * dash);
}

// GLSL main(): the fields at world pixel p.
fn bake(p: vec2f) -> vec4f {
    let h = baseHeight(p);
    let g = broadGradient(p);
    let slope = length(g);
    // Painted rock and moss (card C5) take relief like a face: for the relief's
    // gain and amplitude and the cracks' reach the ground there counts as
    // sloped (rock like 0.8, moss half as much), so level painted ground gets
    // ribs, lumps and cracks instead of a flat stain. The real slope still
    // sets the fall line.
    var paintRock = 0.0;
    var faceSlope = slope;
    var paintFall = vec2f(0.0, 1.0);
    if (u.paintOn != 0) {
        paintFall = normalize(vec2f(valueNoise(p / 60.0 + 3.0), valueNoise(p / 60.0 + 9.0)) + vec2f(1e-3));
#ifdef CHUNK
        let raw = textureSampleLevel(masksTex, linearClamp, maskUv(p), 0, 0.0);
#else
        let raw = textureSampleLevel(masksTex, linearClamp, (p / (u.size - 1.0) * (u.grid - 1.0) + 0.5) / u.grid, 0, 0.0);
#endif
        let cover = paintEdge(p, raw, wideSlope(p), 0.0);
        paintRock = cover.x;
        faceSlope = max(slope, 0.8 * max(paintRock, 0.5 * cover.w));
    }
    // Painted local style (card C5): relief strength, cracks and banding, each
    // -1 less .. +1 more than the world's own, 0 unchanged.
    var style = vec3f(0.0);
    if (u.styleOn != 0) {
        let raw = textureSampleLevel(masksTex, linearClamp, maskUv(p), 1, 0.0).gba;
        let wide = wideSlope(p);
        style = vec3f(styleEdge(p, raw.x, wide), styleEdge(p, raw.y, wide), styleEdge(p, raw.z, wide));
    }
    // Only a route's graded surface stays smooth; its steep shoulders are
    // ordinary faces and take relief like any other (no smooth dark band).
    // Crystal cells (Crystals brush) keep clean flat faces: no relief,
    // cracks, bands or sand, as on a graded route.
    // The crystal channel also carries a column's brightness (0.8-1.0) and
    // its edges (0.5); the shader reads it raw from the fields.
#ifdef CHUNK
    let crystalRaw = textureSampleLevel(routesTex, linearClamp, maskUv(p), 0.0).a;
#else
    let crystalRaw = textureSampleLevel(routesTex, linearClamp, (p / (u.size - 1.0) * (u.grid - 1.0) + 0.5) / u.grid, 0.0).a;
#endif
    let crystalCell = smoothstep(0.15, 0.6, crystalRaw);
    let route = max(routeProtection(p) * (1.0 - smoothstep(0.45, 0.9, length(broadGradient(p)))), crystalCell);
#ifdef CHUNK
    let crackShape = max(textureSampleLevel(routesTex, linearClamp, maskUv(p), 0.0).g, 0.6 * paintRock);
#else
    let crackShape = max(textureSampleLevel(routesTex, linearClamp, (p / (u.size - 1.0) * (u.grid - 1.0) + 0.5) / u.grid, 0.0).g, 0.6 * paintRock);
#endif
    // Painted cracks: fewer scales the shape's mask down, more raises it to at least the painted amount.
    let crackMask = select(crackShape * (1.0 + style.y), max(crackShape, style.y), style.y > 0.0);
    // Retail level ground is not dead flat in the art: faint embossed lumps
    // at 10-30 px. Appearance only; exported heights stay level.
    // Painted ground lumps (card E1) add to the world's own lumps, or (below 0)
    // take them away; unpainted ground (0) keeps exactly the world's.
    var lumpGain = 1.0;
    var lumpAdd = 0.0;
    if (u.lumpOn != 0) {
        let painted = textureSampleLevel(masksTex, linearClamp, maskUv(p), 3, 0.0).r;
        lumpGain = 1.0 + min(painted, 0.0);
        lumpAdd = max(painted, 0.0) * u.lumpRelief;
    }
    var plain = 0.0;
    if (u.plainRelief > 0.0 && h > u.sea + 1.0) {
        plain = (valueNoise(p / 13.0 + 41.0) * 0.6 + valueNoise(p / 29.0 + 7.0) * 0.4) * (u.plainRelief * lumpGain) * 1.6
              * (1.0 - smoothstep(0.1, 0.4, slope));
    }
    // Painted lumps are retail's small lit bumps (8-14 px, in patches), finer than the
    // world's own broad lumps, so they carry their own scales.
    if (lumpAdd > 0.0 && h > u.sea + 1.0) {
        plain += (valueNoise(p / 8.0 + 17.0) * 0.6 + valueNoise(p / 14.0 + 53.0) * 0.4) * lumpAdd * 1.6
               * (1.0 - smoothstep(0.1, 0.4, slope));
    }
    // The bed under shallow water carries its own faint lumps, lit with the
    // rest (card E1); the relief clamp below keeps it under the water plane.
    if (u.bedRelief > 0.0 && h <= u.sea + 1.0) {
        plain = (valueNoise(p / 11.0 + 71.0) * 0.55 + valueNoise(p / 23.0 + 5.0) * 0.45) * u.bedRelief * 1.6
              * (1.0 - smoothstep(0.1, 0.4, slope));
    }
    // Level crests and graded routes stay smooth; relief grows with slope.
    // Gentle slopes carry low lumps too, so ground turned from the sun is
    // textured rather than a smooth gradient; level ground stays level.
    let gain = max(smoothstep(0.08, 0.60, faceSlope), u.gentleRelief * smoothstep(0.015, 0.10, faceSlope))
             * smoothstep(-12.0, 10.0, h) * (1.0 - route);
    var fall = vec2f(0.0, 1.0);
    if (slope > 1e-5) { fall = g / slope; } else { fall = paintFall; }
    // G2: the ground round the rock gives its direction. Where the ground is level under painted rock
    // there is no fall line of its own, so the wide one (heights smoothed over cliffWide px) stands in,
    // not the noise paintFall draws; the local one takes over from slope .03 to .12.
    var cliff = CliffFrame(vec2f(0.0, -1.0), 1.0, 1.0, h, h, 1.0);
    var cliffOn = false;
    if (u.cliffFollow > 0.0 && u.rockOrder > 0.0 && u.cracksOn != 0 && h > u.sea + 1.0 && (paintRock > 0.0 || slope > u.rockFrom)) {
        cliff = cliffFrame(p);
        cliffOn = true;
        let own = smoothstep(0.03, 0.12, slope);
        let a = select(cliff.up, -cliff.up, dot(cliff.up, fall) < 0.0);
        // With no wide slope either (level ground all round) there is no direction to give: paintFall's noise stays, not
        // a default north that would comb every returning scatter rib the same way.
        let have = smoothstep(0.0, 0.02, cliff.gradient);
        fall = normalize(mix(fall, mix(a, fall, own), have) + vec2f(1e-5));
    }

    var acc = vec3f(0.0);
    var amplitude = 1.0;
    var frequency = 1.0 / u.reliefScale;
    var total = 0.0;
    var firstOctave = 0.0;
    for (var k = 0; k < 6; k++) {
        if (k >= u.reliefOctaves) { break; }
        // Contour direction, bent toward the accumulated gullies.
        let steer = fall + acc.yz * u.reliefBranch;
        var dir = vec2f(steer.y, -steer.x);
        let len = length(dir);
        dir = select(vec2f(1.0, 0.0), dir / len, len > 1e-5);
        // Retail escarpments (Great Divide) read as blocky rock with ledges
        // along the contours, not ribs down the fall line: on steep ground
        // turn the wavefronts toward the contours, by a varying amount so
        // ledges, diagonal facets and a few ribs mix.
        if (u.faceStreak > 0.0 && len > 1e-5) {
            let turnBy = u.faceStreak * smoothstep(u.faceStreakFrom, u.faceStreakFrom + 0.35, slope)
                       * clamp(0.75 + 0.6 * valueNoise(p / 37.0 + f32(k) * 5.3 + 71.0), 0.0, 1.0);
            dir = normalize(mix(dir, vec2f(-dir.y, dir.x), turnBy));
        }
        // Domain warp varies rib spacing and width so faces are not combed.
        let warp = vec2f(valueNoise(p / 48.0 + f32(k) * 3.7), valueNoise(p / 48.0 + 11.3 + f32(k) * 3.7)) * u.reliefWarp;
        let q = (p + warp) * frequency + vec2f(f32(k) * 17.31, f32(k) * 9.13);
        var e = gullies(q, dir);
        // Lumps keep faces from reading as combed stripes.
        let lump = valueNoise(q * 1.7 + 3.1);
        e.x = mix(e.x, lump, u.reliefLumps);
        acc += vec3f(e.x, e.yz * frequency) * amplitude;
        if (k == 0) { firstOctave = e.x; }
        total += amplitude;
        amplitude *= u.reliefGain;
        frequency *= 2.0;
    }
    let value = acc.x / max(total, 1e-5);
    // Steeper ground carries proportionally taller ribs.
    let patchy = mix(1.0, 0.35 + 1.3 * (valueNoise(p / 90.0 + 5.0) * 0.5 + 0.5), u.reliefPatchy);
    // Height scales with slope, with a floor so gentle lumps are visible.
    var height = value * u.reliefAmount * max(clamp(faceSlope, 0.0, 2.5), 0.25 * u.gentleRelief) * u.reliefScale * gain * patchy * styleScale(style.x);
    height += plain;
    // Lunar regolith: fine wormy ridges on any slope, fading onto the
    // level dust, as on the retail Moon sections.
    var wormDark = 0.0;
    if (u.worms > 0.0 && h > u.sea) {
        let q = p + 6.0 * vec2f(valueNoise(p / 17.0 + 3.0), valueNoise(p / 17.0 + 8.0));
        let worm = 1.0 - abs(valueNoise(q / 4.6 + 11.0));
        let worm2 = 1.0 - abs(valueNoise(q / 2.4 + 23.0));
        let on = smoothstep(0.03, 0.2, slope) * (0.55 + 0.45 * smoothstep(0.2, 0.8, slope));
        let ridge = pow(worm, 5.0) * 4.0 + pow(worm2, 5.0) * 1.6;
        height += ridge * u.worms * on * (0.6 + 0.4 * min(slope, 2.0));
        // The squiggles read as dark lines in the art: shade their troughs.
        wormDark = smoothstep(0.82, 0.97, max(worm, worm2 * 0.97)) * u.worms * on * 0.85;
    }
    // Painted banding: fainter scales the world's strength down, stronger
    // doubles it up to twice and never drops below 0.8 times the painted amount.
    let banding = select(u.banding * (1.0 + style.z), max(u.banding * styleScale(style.z), 0.8 * style.z), style.z > 0.0);
    let bandsAt = contourBands(p, h, slope, fall, banding);
    var bands = bandsAt.xy * (1.0 - route);
    // E11: the dark lines round Archipelago's hills were the first contour risers on the
    // hill's foot; retail has red fringe lines there instead (fringeContours draws those).
    // The same flatBank worlds start them 8 units above the dry base.
    if (u.flatBank > 0.0) { bands.y *= smoothstep(u.base + 4.0 * u.flatBank, u.base + 8.0 * u.flatBank, h); }
    height += bands.x;
    // Terracettes (P32): Joined wrinkles on a grass world. Rock, sand and routes take them away below, as they do the bands.
    var stepWorn = 0.0;
    if (u.wrinkles > 0.0 && u.grassSlopes != 0 && h > u.sea + 1.0) {
        let terrace = terracettes(p, h, slope);
        height += terrace.x * u.wrinkles * (1.0 - route);
        stepWorn = terrace.y * u.wrinkles * (1.0 - route);
    }
    let bandDark = bands.y * smoothstep(-0.25, 0.35, -bandsAt.z);
    let bandLit = bands.y * smoothstep(0.1, 0.6, bandsAt.z) * 0.6;
    var sand = sandCover(p, slope, height) * (1.0 - route);
    // Painted cover (Sand / Ground cover brushes): sand lies on slopes too,
    // so a hill set in sand has sandy feet; steep faces still shed it.
    // Ground cover clears weathered and painted sand alike.
    let paint = paintAt(p);
    let paintEdge = valueNoise(p / 13.0 + 41.0) * 0.20 + valueNoise(p / 4.0 + 7.0) * 0.08;
    // Sand bars (sandCrown) keep their sand on steep flanks.
    // Painted sand's edge is feathered over a band of several px and broken at 4 to 27 px, so the sand thins out into the ground (grass
    // and soil show through it, the draw's Vegetation through sand) instead of stopping at a line.
    let sandDepth = paint.b * 2.0 - 1.0;
    let sandBlur = paintSandBlur(p, sandDepth);
    let sandBreak = paintEdge + valueNoise(p / 6.0 + 83.0) * 0.10 + valueNoise(p / 27.0 + 57.0) * 0.12;
    let paintSand = smoothstep(0.15, 0.85, sandBlur.x + sandBreak) * (1.0 - smoothstep(1.0, 1.8, slope) * (1.0 - u.sandCrown)) * (1.0 - route);
    let paintGround = smoothstep(0.30, 0.70, 1.0 - paint.b * 2.0 + paintEdge);
    let sandWeathered = sand * (1.0 - paintGround);
    if (u.hasBeach == 0) { sand = max(sand, paintSand); }
    sand *= 1.0 - paintGround;
    // Only sand deep enough to cover the ground buries relief and stones;
    // painted sand bars (sandCrown) bury theirs too.
    let buried = max(smoothstep(0.10, 0.90, sand), paintSand * u.sandCrown);
    // Sand ripples (card P18): asymmetric crests with defects, coarse grains on the crests, and sand shadows behind the scatter's big stones.
    // They lie on the buried ground, so they go in after the sand buries relief. Height is lambda / 9 at the default Ripple height (1.4).
    var drift = 0.0;
    var crestTone = 0.0;
    if (sand > 0.0 && u.ripple > 0.0) {
        let rp = sandRipples(p, u.ripple);
        // Ripples need sand deep enough to hold them: thin sand at a painted edge stays flat, over a band several px wide whose width wanders.
        let paintDeep = smoothstep(0.55, 0.98, sandBlur.y + 0.4 * sandBreak) * paintSand;
        let deep = max(smoothstep(0.5, 0.95, sandWeathered), select(0.0, paintDeep * (1.0 - paintGround), u.hasBeach == 0));
        drift = (rp.x * u.rippleHeight * u.ripple / (9.0 * 1.4) + rp.z) * deep;
        crestTone = rp.y * deep;
    }
    // Sand buries relief beneath it.
    height *= 1.0 - 0.8 * buried;
    height += drift;
    // Cracks, carved into the relief; sand fills them.
    // A cracked shallow bed (card E1, Red's first shallow mode): a stroke that
    // sets it carves the crack network into the bed under its shallows, as if
    // the bed were rocky ground, so the lit bed shows retail's cracked terrain.
    var crackedBed = false;
    if (u.waterOn != 0 && h <= u.sea + 1.0) { crackedBed = textureSampleLevel(masksTex, linearClamp, maskUv(p), 3, 0.0).g > 0.5; }
    var crackAt = cracks(p, fall, faceSlope, crackMask * (1.0 - route), h, max(style.y, 0.0)) * (1.0 - buried);
    if (crackedBed) { crackAt = cracks(p, fall, max(faceSlope, BED_CRACK_SLOPE), max(crackMask, 0.9), u.sea + 5.0, max(style.y, 0.0)); }
    // Where rock is broken into blocks, the blocks replace part of the
    // fall-line ribs, so faces read as fractured rock rather than combed.
    var broken = 0.0;
    if (u.cracksOn == 1) { broken = smoothstep(0.0, 0.5, crackMask) * max(u.crackBlocks, 0.6 * max(style.y, 0.0)) * smoothstep(0.5, 1.2, faceSlope) * (1.0 - route); }
    // Rock structure (card E3): the structured face steps in as the scatter
    // (ribs, block steps, minor cracks) steps back; its relief is added below.
    var structureRock = 0.0;
    var gullyFloor = 0.0;
    var blockCrevice = 0.0;
    var order = 0.0;
    var steep = 0.0;
    if (u.rockOrder > 0.0 && u.cracksOn != 0 && h > u.sea + 1.0) {
        order = u.rockOrder * smoothstep(0.0, 0.5, clamp(crackMask, 0.0, 1.0)) * (1.0 - route) * (1.0 - buried);
        // Beds and joints are for faces: steep ground (full from slope
        // rockFrom + 0.5) and painted rock, which counts as a face whatever the slope.
        steep = max(smoothstep(u.rockFrom, u.rockFrom + 0.5, slope), paintRock);
        // G2: where the ground is level all round there is nothing to run beds or joints along:
        // the structure gives way to the scatter (plain broken rock) as the wide slope falls.
        if (cliffOn) { order *= mix(1.0, cliff.grade, u.cliffFollow); }
        height *= 1.0 - 0.85 * order * steep;
        crackAt.w *= 1.0 - 0.85 * order * steep;
        crackAt.x *= 1.0 - 0.5 * order * steep;
        crackAt.y *= 1.0 - 0.5 * order * steep;
    }
    height = height * (1.0 - 0.75 * broken) + crackAt.w - crackAt.x;
    // G5 (Lava): the crust replaces most of the fall-line relief on hills and adds its own, with the dark of its creases. Its height is relief too, so a stroke's Style: relief strength scales it.
    var crustDark = 0.0;
    if (u.lavaCrust > 0.0) {
        let crust = lavaCrust(p, h, slope, fall);
        height = height * (1.0 - crust.z) + crust.x * styleScale(style.x);
        crustDark = crust.y;
    }
    if (order > 0.0) {
        // G2: the frame's own coordinates when the ground gives the directions (x along the contour, y
        // down the fall line, from the patch's seed); the fixed screen ones otherwise.
        var pf = p;
        var bedG = -1.0;
        var bedH = h;
        if (cliffOn) {
            pf = cliffLocal(p);
            // Beds are the contours of the ground; of the heights smoothed wide where it is level, so painted rock
            // on a plain takes the rings of the hill beside it.
            bedH = mix(cliff.wideMean, mix(h, cliff.midMean, u.cliffBed), cliff.local);
            // The px spacing keeps the grid's own slope where it is steep and cliffBed is 0 (as before), the smoothed one otherwise.
            bedG = mix(cliff.gradient, slope, cliff.local * (1.0 - u.cliffBed));
        }
        // H2: the rock column reads the surface itself, the coordinate erosion reads (columnCoord), not G2's smoothed ground.
        if (u.columnSectionCount > 0) { bedH = h; }
        // E9: the face's own form. Gullies and ribs carve the face; the beds follow
        // them (H23: all the way) and run on across the joints.
        // The form fades out over the face's foot, so no gully reaches the water plane.
        var carved = vec2f(0.0);
        if (u.gullyDepth > 0.0 || u.ribTilt > 0.0) { carved = gullyField(pf) * smoothstep(u.base + 2.0, u.base + 16.0, h); }
        let bed = bedRelief(p, bedH + carved.x, bedG);
        // G2: each bed's joints sit at their own offset (up to cliffStagger of a spacing either way), so a joint
        // kinks at every bed instead of running straight down the face as one ruled line: broken rock, not masonry
        // (the offset is keyed on the bed's index). A joint of no depth cuts nothing.
        var joint = 0.0;
        if (u.jointDepth > 0.0) {
            let stagger = select(0.0, u.cliffStagger * max(u.grooveSpacing, 6.0) * 2.0 * (cellHash(vec2f(bed.index, 71.0)).x - 0.5), cliffOn && u.cliffStagger > 0.0);
            joint = rockLines(pf, stagger);
        }
        height += order * steep * (bed.off + rockLip(bed) + joint);
        // The form eases in over the painted edge (a smoothstep of the cover, not the cover itself), so the rim stays smooth.
        let gate = smoothstep(0.15, 0.85, order * steep);
        height += gate * carved.x;
        gullyFloor = gate * carved.y;
        if (u.rockSize > 0.0) {
            // The cell set, in the face's axes (the ground's gradient there: along the fall line only on a patch frame).
            let gx = select(vec2f(0.0, -slope), g, !cliffOn);
            let rk = rockModel(p, pf, bed, gx, 0.0);
            height += gate * rk.x;
            blockCrevice = gate * rk.y;
        }
        structureRock = order * steep * bed.lip * step(0.01, bedLip());
    }
    // H4b: the hills' rock (slope from .35, full at .65; the rock class of measure/material_classes.py starts at .5) off the structured face takes small
    // pieces, in patches, with the pieces' edges mostly down the fall line.
    if (u.hillBlocks > 0.0 && u.rockSize > 0.0 && h > u.sea + 1.0) {
        let patches = smoothstep(-0.2, 0.3, valueNoise(p / 26.0 + 53.0));
        let hill = u.hillBlocks * smoothstep(0.35, 0.65, slope) * patches * (1.0 - order * steep) * (1.0 - route) * (1.0 - buried);
        if (hill > 0.0) {
            let across = vec2f(-fall.y, fall.x);
            let pfh = vec2f(dot(p, across), dot(p, fall));
            let block = rockModel(p, pfh, BedCut(0.0, 0.0, 0.0, 1.0, 0.0, 0.5, 1e9), vec2f(0.0, -slope), 1.0);
            height += hill * HILL_RELIEF * block.x;
            blockCrevice = max(blockCrevice, hill * block.y);
        }
    }
    // H5 3b: rills along the flow.
    let rill = rillAt(p, slope);
    height += rill.x * (1.0 - buried);
    // H5: the fall-line cracks of the outcrops are notches in the height (a lit wall and a dark floor), not only a tint.
    let notch = outcropCracks(p, slope);
    height -= 0.9 * notch / ROCK_CRACK;
    // Relief never carries dry ground below the water plane: it would cut
    // blob-shaped notches into the coast. Nor lifts the bed above it.
    if (h > u.sea) { height = max(height, u.sea + 0.5 - h); }
    else { height = min(height, u.sea - 0.5 - h); }
    let scatter = looseStones(p);
    let loose = scatter.s;
    var rock = vec2f(loose.x, loose.y);
    height += rock.x;
    if (scatter.plant.x > 0.0) { height += max(scatter.plant.x * (1.0 - buried) - rock.x, 0.0); }
    rock.y *= 1.0 - buried;
    rock.y = max(rock.y, structureRock);
    // Blue holds crack darkness (negative), rock cover (0..1), or a lit
    // crack wall (1 + light).
    // Band lines share the crack darkness code.
    var lineDark = max(max(crackAt.y, bandDark * (1.0 - buried)), wormDark * (1.0 - buried));
    // E9: a deep gully's floor lies in its own shade (occlusion baked as tone; it follows the carved depth, not a drawn line).
    lineDark = max(lineDark, gullyFloor * u.gullyShade * (1.0 - buried));
    lineDark = max(lineDark, crustDark);
    lineDark = max(lineDark, RIPPLE_CREST * crestTone);
    lineDark = max(lineDark, loose.z * (1.0 - buried));
    lineDark = max(lineDark, scatter.plant.z * (1.0 - buried));
    lineDark = max(lineDark, 1.0 * stepWorn * (1.0 - buried));
    lineDark = max(lineDark, max(notch, rill.y * 0.5 * u.rillDepth) * (1.0 - buried));
    // E9: the creases between facets lie in shade too (a fraction of a pixel to a pixel wide, never a drawn outline: it follows the facet cells).
    lineDark = max(lineDark, blockCrevice * u.blockSeam * (1.0 - buried));
    if (u.sandBanding > 0.0) {
        // Sand bars (sandCrown) are smooth rippled sand, not streaked dune slopes.
        let streak = sandStreaks(p, h, slope, fall, u.sandBanding * max(max(paintSand * (1.0 - u.sandCrown), smoothstep(0.3, 0.8, sand)), route * 0.6));
        lineDark = max(lineDark, streak.x * (0.55 + 0.45 * smoothstep(-0.3, 0.4, -streak.y)));
    }
    crackAt.z = max(max(crackAt.z, bandLit * (1.0 - buried)), scatter.plant.y * (1.0 - buried));
    var crackCode = rock.y;
    if (lineDark > 0.02) { crackCode = -lineDark; } else if (crackAt.z > 0.02) { crackCode = 1.0 + crackAt.z; }
    // Green holds route protection, or (negative) beach cover off routes.
    var beach = beachCover(p, h, slope);
    if (u.hasBeach != 0) { beach = max(beach, paintSand); }
    beach *= 1.0 - paintGround;
    // Alpha holds sand, or (negative) painted sand bars (sandCrown) in a
    // world whose painted sand is beach art, so the draw can tell them from
    // the automatic beach.
    let bar = select(0.0, paintSand * u.sandCrown * (1.0 - paintGround), u.hasBeach != 0 && sand <= 0.0);
    // Green: 2 + crystal on crystal cells.
    return vec4f(height, select(select(-beach, route, route > 0.01 || beach <= 0.0), 2.0 + crystalRaw, crystalCell > 0.02), crackCode, select(sand, -bar, bar > 0.0));
}
