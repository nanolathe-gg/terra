// The output stage: the draw's lit color (true color) reduced to the game palette, the last step of every picture.
// Pattern dithering (Knoll): for each color, N candidate palette colors by error accumulation (each picks the color nearest the lit color
// plus K of the error so far), sorted dark to light; a 32 x 32 blue-noise threshold (RANKS) picks one. A flat area is then an even,
// irregular mix whose mean is near the lit color. Each pixel depends only on its own lit color and its place, so an edit changes only the
// pixels whose lit color moved, and the threshold, keyed to art pixels and repeating with the game's 32 px tile, keeps a repeating lit tile
// repeating, and makes a preview's pixels an export's.
// The candidates come from a table (buildTable, once for each palette): a CELLS^3 grid over the 0..255 color cube, each point's N palette
// indices. A pixel reads the candidates of the grid point nearest its lit color. Searching the palette N times for every pixel cost about
// ten times the lookup (Chrome, Metal, 256 x 256 crops: 1.50 against 0.13 ms); the grid moves about an eighth of the dots, by eye the same.
// N = 8 and K = 0.5 (prototype, measured on four crops): K = 1 keeps the mean closer but picks far hues (cyan flecks in Green's water, red
// in its grass); 16 candidates changed little.
// A job that is not enabled (palette off, Clay, a diagnostic view, a raster coarser than art pixels) passes the true color through.
struct Job {
    origin: vec2i,   // the art (or drawn) pixel of the source's texel 0,0
    size: vec2u,     // the source's texels
    offset: vec2i,   // where the blit puts the result in its target
    count: u32,      // palette colors
    enabled: u32,
}
@group(0) @binding(0) var source: texture_2d<f32>;
@group(0) @binding(1) var reduced: texture_storage_2d<rgba8unorm, write>;
@group(0) @binding(2) var<storage, read> palette: array<vec4f>;   // rgb in 0..255
@group(0) @binding(3) var<uniform> job: Job;
@group(0) @binding(4) var shown: texture_2d<f32>;
@group(0) @binding(5) var<storage, read> table: array<u32>;          // patternPixels: N palette indices a grid point, 4 to a word
@group(0) @binding(6) var<storage, read_write> built: array<u32>;    // buildTable writes it
@group(0) @binding(7) var<uniform> paletteCount: vec4u;              // buildTable: x the palette's colors

const N = 8;
const K = 0.5;
const CELLS = 64u;
var<workgroup> colors: array<vec3f, 256>;

// The threshold, by rank: python3 measure/blue_noise.py (void-and-cluster, sigma 1.5, fixed seed), committed as numbers.
const RANKS = array<u32, 1024>(
    910,690,137,343,70,854,280,508,53,686,891,236,615,160,668,991,578,90,494,247,1013,184,734,121,245,379,21,905,212,641,819,175,
    391,579,808,1006,560,705,943,612,216,788,323,67,770,485,30,255,764,406,896,11,675,450,883,611,985,550,852,317,472,1016,281,731,
    964,227,35,488,400,192,116,353,912,437,541,995,383,914,730,346,868,172,552,339,842,291,48,351,191,722,107,606,758,40,529,92,
    475,326,870,749,293,843,478,765,654,99,179,702,277,128,601,503,62,651,954,725,122,596,785,490,832,429,259,922,159,424,836,662,
    894,602,142,643,76,961,571,9,260,967,846,593,462,827,219,1022,782,312,208,418,519,996,166,646,77,968,537,368,691,942,308,187,
    12,421,984,512,222,689,322,821,409,513,334,25,947,88,683,394,134,477,820,44,873,234,393,899,315,678,5,806,230,117,564,774,
    693,252,793,342,856,439,161,926,723,202,660,784,416,535,261,927,555,622,977,284,664,755,91,562,767,183,445,887,632,484,997,370,
    911,551,109,713,39,1000,629,69,542,120,1008,287,170,744,862,332,4,729,119,430,548,335,951,463,265,1002,589,324,94,740,267,78,
    457,193,952,408,567,246,481,302,792,865,467,585,915,59,636,189,800,374,916,177,823,16,613,144,828,81,720,211,936,403,851,658,
    780,314,637,810,139,746,901,680,389,228,37,354,697,486,397,980,505,244,673,466,1015,224,714,925,407,539,355,805,495,23,584,140,
    973,522,20,276,932,352,49,167,982,614,757,956,135,258,837,74,590,889,54,573,748,363,507,285,669,29,892,155,684,1021,239,364,
    86,699,861,442,617,511,831,561,452,103,269,524,875,609,750,321,149,771,347,268,125,907,55,789,185,988,603,432,288,545,743,898,
    600,384,173,1011,80,217,727,292,890,665,811,423,15,190,441,1004,692,428,962,829,656,419,591,864,448,320,762,115,871,63,461,199,
    839,502,263,775,674,410,974,1,375,180,1018,333,726,935,528,96,226,554,18,492,196,990,256,111,661,532,221,940,369,783,653,303,
    733,950,102,565,310,859,150,642,790,543,72,587,248,650,367,798,626,863,307,736,82,546,753,387,953,38,712,483,588,181,986,8,
    148,635,458,909,33,496,592,921,440,220,759,884,133,833,43,294,924,171,404,945,667,336,888,165,795,301,858,73,272,849,449,350,
    882,392,218,796,701,371,241,61,318,979,469,349,506,965,425,706,482,57,604,809,210,459,3,623,476,582,411,1010,639,112,707,572,
    772,56,1001,299,158,957,737,848,655,127,696,31,747,178,574,232,983,760,278,514,113,1019,732,273,971,205,130,752,509,329,966,197,
    290,498,659,443,610,525,106,415,559,822,270,934,624,305,802,89,649,143,906,344,853,580,382,834,64,716,902,373,214,807,46,538,
    698,869,129,835,47,895,264,1009,188,380,516,95,399,1014,493,877,376,454,568,42,695,229,147,520,325,628,540,13,941,671,431,923,
    87,237,385,728,328,436,631,766,19,917,607,867,151,685,17,289,739,204,998,779,412,949,666,881,769,243,444,838,295,597,156,348,
    630,903,577,993,206,814,124,530,300,710,213,776,479,250,815,549,928,83,625,271,126,497,24,435,108,930,164,738,98,491,1007,801,
    413,504,168,6,473,929,670,365,969,451,85,331,575,908,414,162,663,487,362,886,553,818,282,1005,576,358,644,978,381,700,253,28,
    946,283,787,694,599,242,68,781,141,876,633,999,50,717,110,975,316,826,7,715,198,647,377,704,223,794,34,474,207,845,563,751,
    640,105,378,972,311,866,426,570,262,518,388,799,240,366,621,465,756,235,987,427,931,100,847,51,527,913,309,595,893,75,341,182,
    878,544,850,58,531,174,1023,708,840,14,681,169,500,939,830,195,65,605,510,136,330,583,471,960,163,433,742,131,679,517,981,453,
    238,687,153,460,761,652,45,338,200,958,306,879,741,32,298,533,897,357,677,874,778,225,719,297,638,817,249,1020,396,266,735,36,
    417,919,327,816,251,390,824,464,627,536,420,118,586,434,672,1017,123,763,274,41,455,1003,66,885,372,97,566,0,825,152,608,804,
    114,521,598,955,101,547,904,132,933,71,786,992,345,146,803,233,401,557,970,186,619,386,556,154,501,938,721,447,900,534,361,948,
    296,745,10,203,676,319,718,231,754,286,648,209,711,920,489,620,22,841,480,709,860,257,773,682,844,215,337,616,279,60,703,194,
    634,989,405,872,470,976,26,594,360,468,857,2,526,275,84,880,724,313,138,356,93,944,27,304,438,79,994,157,777,963,456,855,
    52,499,254,768,618,176,422,812,1012,145,569,402,959,813,359,446,201,937,657,797,581,398,523,918,645,791,515,688,395,104,558,340);

// Whole-number weights over whole-number colors (0..255): exact in f32 on every GPU, so the order never depends on rounding.
fn luma(c: vec3f) -> f32 { return c.r * 299.0 + c.g * 587.0 + c.b * 114.0; }
// a before b: darker first, equal lightness by red, green, blue, so the order is fixed.
fn before(a: vec3f, b: vec3f) -> bool {
    let la = luma(a); let lb = luma(b);
    if (la != lb) { return la < lb; }
    if (a.r != b.r) { return a.r < b.r; }
    if (a.g != b.g) { return a.g < b.g; }
    return a.b < b.b;
}

// The grid point nearest a lit color (whole numbers 0..255), and the color of a grid point: in whole numbers, so every GPU agrees.
fn cellOf(lit: vec3u) -> vec3u { return (lit * (2u * (CELLS - 1u)) + 255u) / 510u; }
fn cellColor(cell: vec3u) -> vec3f { return vec3f((cell * 510u + (CELLS - 1u)) / (2u * (CELLS - 1u))); }
fn cellIndex(cell: vec3u) -> u32 { return cell.x + CELLS * (cell.y + CELLS * cell.z); }

// Each grid point's candidates: N palette indices, dark to light, packed 4 to a word. The palette's colors are whole numbers (0..255),
// so the distances are exact on every GPU and the table is the same everywhere.
@compute @workgroup_size(64)
fn buildTable(@builtin(global_invocation_id) id: vec3u, @builtin(local_invocation_index) lane: u32) {
    let count = min(paletteCount.x, 256u);
    for (var i = lane; i < count; i += 64u) { colors[i] = palette[i].rgb; }
    workgroupBarrier();
    if (id.x >= CELLS * CELLS * CELLS) { return; }
    let cell = vec3u(id.x % CELLS, (id.x / CELLS) % CELLS, id.x / (CELLS * CELLS));
    let lit = cellColor(cell);
    var cand: array<u32, N>;
    var error = vec3f(0.0);
    for (var c = 0; c < N; c++) {
        let want = lit + error * K;
        var best = 0u;
        var distance = 1e20;
        for (var i = 0u; i < count; i++) {
            let delta = colors[i] - want;
            let e = dot(delta, delta);
            if (e < distance) { distance = e; best = i; }
        }
        cand[c] = best;
        error += lit - colors[best];
    }
    for (var i = 1; i < N; i++) {
        let v = cand[i];
        var j = i - 1;
        while (j >= 0 && before(colors[v], colors[cand[j]])) { cand[j + 1] = cand[j]; j--; }
        cand[j + 1] = v;
    }
    let at = cellIndex(cell) * (N / 4);
    for (var w = 0; w < N / 4; w++) {
        built[at + u32(w)] = cand[w * 4] | (cand[w * 4 + 1] << 8u) | (cand[w * 4 + 2] << 16u) | (cand[w * 4 + 3] << 24u);
    }
}

@compute @workgroup_size(8, 8)
fn patternPixels(@builtin(global_invocation_id) id: vec3u) {
    let p = vec2i(id.xy);
    if (any(p >= vec2i(job.size))) { return; }
    let raw = textureLoad(source, p, 0).rgb;
    if (job.enabled == 0u) { textureStore(reduced, p, vec4f(raw, 1.0)); return; }
    let lit = vec3u(round(clamp(raw, vec3f(0.0), vec3f(1.0)) * 255.0));
    let at = ((job.origin + p) % 32 + vec2i(32)) % 32;
    let threshold = (f32(RANKS[at.y * 32 + at.x]) + 0.5) / 1024.0;
    let k = u32(min(N - 1, i32(threshold * f32(N))));
    let index = (table[cellIndex(cellOf(lit)) * (N / 4) + k / 4u] >> ((k % 4u) * 8u)) & 255u;
    textureStore(reduced, p, vec4f(palette[index].rgb / 255.0, 1.0));
}

// The reduced picture into the presentation target (the canvas's format, which a storage texture may not have), at job.offset.
@vertex
fn blitVertex(@builtin(vertex_index) i: u32) -> @builtin(position) vec4f {
    let p = vec2f(f32((i << 1u) & 2u), f32(i & 2u));
    return vec4f(p * 2.0 - 1.0, 0.0, 1.0);
}
@fragment
fn blitFragment(@builtin(position) at: vec4f) -> @location(0) vec4f {
    return vec4f(textureLoad(shown, vec2i(floor(at.xy)) - job.offset, 0).rgb, 1.0);
}
