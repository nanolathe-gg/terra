# Prior-art research (2026-11-04)

Research notes for the owner and the next implementation agent. Nothing here
is part of the editor: the two pages are standalone WebGPU prototypes, and
no card below has landed. The full brief, with figures, licenses and the
hand-off prompt, is the artifact "Terraform Prior-Art Review":
<https://claude.ai/artifact/61EeARxFRnFAFRHPGgTrtE> (private to the owner until
shared).

## The pages

- `gully-filter.html`: one mountain built like `engine-shape.wgsl` kind 4 (a
  swept curve, the engine's `vnoise` lumps, a jagged crest), then a
  slope-aligned stripe filter that cuts branching gullies. It is original code,
  written from the published idea; port it freely. Do not copy runevision's
  erosion filter or Phacelle code (MPL-2.0) or clayjohn's and Fewes'
  `erosion()` (CC BY-NC-SA).
- `stream-power.html`: the same, plus a coarse stream-power pass
  (E = K A^m S) before the filter.

Serve this folder (`python3 -m http.server`) and open a page in a WebGPU
browser. The query string sets the variants and numbers; each page's header
comment lists them. The defaults reproduce the figures in the brief.

## What the prototype measured

On SwiftShader (a CPU rasterizer, so only ratios carry over), over 640 x 448 px:

- The filter moves the 16-px corner heights on the mountain by a median of 5
  height units, with a p90 of 17 and a maximum of 28.
- It keeps the cells whose four corners lie within 10 units of each other
  (the `gentleLand` test): 177 before, 176 after.
- It costs about 3 times the stroke evaluation.
- Two runs with the same settings render the same terrain pixels.

By eye:

- Steering by the stroke's own fall line is what makes it work. Steering by
  the gradient of the lumpy height makes the gullies curl into loops.
- A 2 x 2 normalised stripe sum with a folded profile (sharp crests, round
  floors) beats a cosine profile and a 3 x 3 sum.

## Round 2: the lab

`lab/` is a standalone WebGPU page for trying terrain ideas fast (see
`lab/README.md`). It holds 22 experiments: round 1's mountain, and four
families from round 2:

- `lf-`: landforms from the rock column;
- `rk-`: rock faces, weathering and light;
- `ld-`: loose material;
- `er-`: erosion, resolution independence and incremental editing.

`palette-mix.py` measures the engine's palette pair against Knoll
candidates. `lab/compare-heights.mjs` compares saved height fields.
`realism.py` scores them against real terrain (round 3).

## Round 3: a realism number

`realism.py` gives decision 25's "by eye for realism" a number. It cuts a
height field into the lab's 384 x 288 windows, measures 15 geomorphometric
statistics (its header lists each one with its source), and checks each
against the range measured on real terrain:

```sh
node docs/research/lab/run.mjs mountain-gullies --query "w=384&h=288&dither=1" --heights --out lab-out
python3 -I docs/research/realism.py lab-out/*.f32
python3 -I docs/research/realism.py --synthetic      # noise baselines
```

**Reference.** USGS 3DEP 1 m lidar (bare earth, public domain), read by
range requests from the public `prd-tnm` bucket. The sites are the Loess
Hills (IA), the badlands of Theodore Roosevelt NP (ND) and the Badlands Wall
(SD), the Colorado National Monument canyons (CO), and Cascade Canyon in the
Tetons (WY): 91 windows with at least 24 units of relief. Only the
percentile table is committed (`REFERENCE`, with tiles and boxes in
`SOURCES`).

- Scale: one art px is 1.5 m, area-resampled. At 1 m or 2 m the pooled
  medians move far less than the lab variants differ.
- Height: one unit is `zk` = 0.7 px of true height (the lab's lighting), so
  1.05 m. Slopes are true tangents on both sides. Teton windows span
  124-467 units (p10-p90), so real alpine relief overflows TA's 255.

**What discriminates** (measured; `--synthetic`, 6 seeds of fBm H 1 and 0.5,
ridged and billowed noise at the real median slope):

- `pitArea` is the share under closed basins deeper than 0.5 px. It is
  0.000 at the median of every real site (p95 0.007), and 0.07-0.42 in all
  24 noise windows.
- `aniso`, the fabric of aligned valleys and beds: real p5 0.049. Noise
  stays under it in 67-100% of windows per kind.
- `saHill`, the slope-area trend on divides, is positive where hilltops are
  round: Loess Hills p50 +0.05, Colorado +0.09. Every noise kind is
  negative, and fBm H 0.5 and ridged noise fall below the real p5 of -0.16.
  Badlands and alpine divides are knife-sharp and negative too, so it is a
  soil-mantled-hills test, not a universal one.
- `hack` catches ridged noise (0.24-0.29 against real p5 0.33).
  `gmHollow` and `gmValley` (PTRM's forms) catch ridged and rough noise.
- The slope statistics, `slopeShape`, both curvature skews and `betaLong`
  catch no noise. They are kept because they catch the lab's own excesses.
  The curvature skew of real windows depends on the landform (Colorado
  +0.43, the Tetons -0.40), so it says little alone.

**The lab, scored** (`in range` of 15; `excess` sums each miss's distance
outside the real p5..p95 in range widths, capped at 1 a statistic):

| Field | In range | Excess | Nearest site | Outside the real range (value) |
| --- | --- | --- | --- | --- |
| `mountain-gullies--swept` | 11/15 | 1.96 | ia-loess | pitArea 0.02, hack 0.21, betaShort 5.72, aniso 0.0226 |
| `mountain-gullies--gullies` | 8/15 | 3.49 | wy-teton | pitArea 0.0292, slope90 3.02, betaLong 1.34, saHill -0.313, curvSkew2 -1.13 ... |
| `lf-strata--swept` | 12/15 | 1.52 | ia-loess | betaShort 8.2, hack 0.258, pitArea 0.00809 |
| `lf-strata--flat` | 12/15 | 1.11 | sd-badlands | pitArea 0.0149, saHill -0.186, slopeShape 0.208 |
| `lf-strata--cuesta` | 11/15 | 2.13 | sd-badlands | pitArea 0.0266, saHill -0.591, slope90 1.73, slopeShape 0.211 |
| `lf-strata--hogback` | 9/15 | 2.69 | sd-badlands | pitArea 0.0566, slope90 2.61, aniso 0.541, gmRidge 0.184, gmValley 0.168 ... |
| `lf-strata--plunge` | 12/15 | 1.21 | sd-badlands | pitArea 0.0485, slope90 1.87, betaLong 2.86 |
| `lf-joints--swept` | 7/15 | 4.32 | ia-loess | pitArea 0.0513, betaShort 7.28, slopeShape 0.0162, concavity -0.241, hack 0.254 ... |
| `lf-joints--slots` | 4/15 | 7.21 | wy-teton | slope90 7, saHill -0.703, pitArea 0.0169, gmHollow 0.0166, hack 0.19 ... |
| `lf-joints--fins` | 3/15 | 7.65 | co-mesa | pitArea 0.0291, slope90 4.52, hack 0.0477, aniso 0.825, gmHollow 0.0224 ... |
| `lf-joints--pinnacles` | 9/15 | 4.65 | wy-teton | pitArea 0.0338, slope90 4.03, gmHollow 0.0315, hack 0.192, slopeShape 0 ... |
| `lf-joints--beehives` | 6/15 | 3.73 | ia-loess | pitArea 0.0272, hack 0.156, gmHollow 0.0366, slopeShape 0.00381, saHill 0.361 ... |
| `lf-age--swept` | 7/15 | 4.29 | ia-loess | pitArea 0.0513, betaShort 7.28, slopeShape 0.0143, concavity -0.228, hack 0.254 ... |
| `lf-age--mesa` | 7/15 | 4.44 | wy-teton | slope90 2.72, gmHollow 0.0216, hack 0.179, slopeShape 0, betaShort 2.84 ... |
| `lf-age--dissected` | 5/15 | 6.07 | wy-teton | pitArea 0.0428, slope90 4.2, hack 0.153, gmHollow 0.0346, curvSkew2 2.36 ... |
| `lf-age--buttes` | 5/15 | 7.08 | wy-teton | pitArea 0.0629, slope90 5.01, hack 0.132, concavity -0.389, gmHollow 0.035 ... |
| `lf-age--downwear` | 9/15 | 3.58 | ia-loess | saHill 0.609, gmHollow 0.0272, slopeShape 0, concavity 0.696, hack 0.243 ... |
| `er-talus--authored` | 9/15 | 1.33 | ia-loess | pitArea 0.098, slope90 0.155, hack 0.311, concavity -0.0104, gmValley 0.143 ... |
| `er-talus--single-24` | 10/15 | 2.67 | ia-loess | pitArea 0.0922, betaShort 6.97, slopeShape 0.0529, hack 0.299, concavity -0.0248 |
| `er-talus--multi-24` | 10/15 | 2.47 | co-mesa | pitArea 0.0424, saHill 0.706, hack 0.295, aniso 0.475, gmHollow 0.0848 |
| `er-talus--cascade-29` | 11/15 | 2.23 | co-mesa | pitArea 0.0411, saHill 0.688, hack 0.291, gmHollow 0.0946 |
| `er-talus--multi-48` | 8/15 | 3.26 | co-mesa | pitArea 0.0383, saHill 0.688, slopeShape 0.715, aniso 0.521, curvSkew2 1.61 ... |
| `er-talus--single-2000` | 9/15 | 2.98 | ia-loess | pitArea 0.0427, saHill 0.811, betaLong 6.27, hack 0.251, gmHollow 0.0935 ... |
| `er-valleys--U-authored` | 10/15 | 2.56 | wy-teton | pitArea 0.045, slope90 2.7, saHill -0.297, hack 0.267, betaLong 2.83 |
| `er-valleys--U` | 10/15 | 1.71 | ia-loess | concavity 0.684, slopeShape 0.777, hack 0.253, gmHollow 0.0691, aniso 0.444 |
| `er-valleys--V` | 10/15 | 2.37 | ia-loess | pitArea 0.0139, slopeShape 0.849, hack 0.257, gmHollow 0.0782, aniso 0.474 |
| `er-valleys--terraces` | 9/15 | 3.24 | wy-teton | pitArea 0.0179, concavity -0.383, slopeShape 0.86, aniso 0.508, hack 0.281 ... |
| `er-valleys--U-override-steep` | 11/15 | 0.93 | ia-loess | hack 0.262, gmHollow 0.0699, slopeShape 0.689, aniso 0.439 |
| `er-valleys--U-override-loose` | 10/15 | 1.72 | ia-loess | slopeShape 0.789, concavity 0.684, hack 0.256, gmHollow 0.07, aniso 0.447 |
| `er-fans--authored` | 6/15 | 3.69 | sd-badlands | pitArea 0.0229, slope90 2.85, betaLong 1.81, gmHollow 0.227, saHill -0.314 ... |
| `er-fans--fans` | 5/15 | 3.32 | sd-badlands | pitArea 0.0315, slope90 2.84, betaLong 1.82, gmHollow 0.218, saHill -0.216 ... |
| `ld-talus--today` | 11/15 | 2.25 | co-mesa | gmHollow 0.0106, gmSpur 0.0167, slopeShape 0.127, slope90 0.0842 |
| `ld-talus--cones` | 9/15 | 1.94 | co-mesa | gmSpur 0.0438, slopeShape 0.0221, gmHollow 0.0563, curvSkew2 1.66, concavity -0.0289 ... |
| `ld-talus--unsorted` | 10/15 | 2.87 | co-mesa | concavity -0.435, gmSpur 0.0402, slopeShape 0.0222, gmHollow 0.0594, curvSkew2 1.83 |
| `ld-talus--slabs` | 10/15 | 3.04 | co-mesa | concavity -0.574, gmHollow 0.0452, slopeShape 0.0235, gmSpur 0.0487, curvSkew2 1.93 |
| `ld-talus--green` | 10/15 | 2.14 | co-mesa | gmSpur 0.0437, slopeShape 0.0225, gmHollow 0.0513, curvSkew2 1.77, concavity -0.0857 |

Swept against gullies (`mountain-gullies`):

- The gully filter moves three statistics toward real terrain: fabric
  (`aniso` 0.023 to 0.269), Hack's exponent (0.21 to 0.30) and fine detail
  (`betaShort` 5.72 to 3.71).
- It moves five away:
  - its folded profile makes crests sharp and floors round, the reverse of
    erosion (`curvSkew2` -0.77 to -1.13; `saHill` 0.13 to -0.31);
  - its one stripe spacing flattens the mid-scale spectrum (`betaLong` 3.92
    to 1.34; real p5 2.88);
  - its walls are steeper than the Tetons (`slope90` 3.02, 72 degrees;
    real p95 1.62);
  - it adds valley forms (`gmValley` 0.029 to 0.151).
- Most lab fields leave closed basins beyond the real p95 (`pitArea`
  0.008-0.098). Only the `er-valleys` Time-pass results, the `ld-talus`
  scatters and `lf-age--downwear` stay under 0.007.
- `er-fans--fans-jacobi-19` is byte-identical to `authored`
  (`compare-heights.mjs`: RMS 0): the lagged-MFD fans deposit nothing at
  19 passes.
- The variants nearest real terrain:
  - `er-valleys--U-override-steep` (11/15, excess 0.93);
  - `lf-strata--flat` (12/15, 1.25);
  - `er-valleys--U` (10/15, 1.71).
- The furthest: `lf-joints--fins` (3/15; `aniso` 0.83, a grain no real
  window shows) and `lf-age--buttes` (5/15; vertical walls, `slope90` 5.0).

**For P24 (modern Green):** run `realism.py` on green-modern-1..3 at 1x,
each window with at least 24 units of relief. Require:

- `pitArea` at most 0.007;
- `aniso` at least 0.05;
- `saHill` at least 0 (Green's hills are soil-mantled);
- `hack` between 0.33 and 0.51;
- `gmHollow` at most 0.19 and `gmValley` at most 0.14.

Report the rest against the nearest site; `ia-loess` and `wy-teton` suit
Green. `slope90` above 1.62 means walls steeper than any real window
measured here. That may be wanted for 1x readability, so the owner judges
it rather than the check.

## Cards

The owner ruled on the brief's four questions on 2026-11-04 (decisions 25-28
in `docs/TERRAIN_ENGINE.md`): a modern Green variant first, one stored
whole-map drainage pass, the merges with their removals, and this order:
generic shared tools, then speed, then the rest.

| Card | What | Group |
| --- | --- | --- |
| P24 | Modern Green: a `modern` variant of Green (`WORLD_VARIANTS`), plus scenes green-modern-1..3; every look card sets its numbers there | 1, first |
| P16 | One loose-material scatter (Supply, Size, Sorting) in the bake, replacing five generators; fix talus sorting (`debrisStones()` runs backwards); remove the old rows | 1 |
| P1 | Gullies: the stripe filter on hill, mountain and landform strokes; remove the `spur*` rows, `heightVar`, `crestJag` | 1 |
| P13 | The column walk: differential erosion through the rock column (hogbacks, cuestas, fins, pinnacles) | 1 |
| P10 | One parametric rock model in the bake; rock types as presets; Age, Stain, Frost; remove the block rows it replaces | 1 |
| P21 | A stored, exact drainage plane by Euler tour, whole-map (decision 26) | 1 |
| P20 | Multi-scale thermal in the Time pass | 1 |
| P9 | Palette: eight Knoll candidates in the lookup cube | 1 |
| P12 | Multi-scale cavity and convexity on the cavity control | 1 |
| P4 | The draw: the surface once per pixel, not about 47 times | 2, speed |
| P11 | Exact sun and sky horizons by line sweep | 2, speed |
| P23 | Prefix checkpoints for drags; warm-0 Time previews | 2, speed |
| P5 | Several erosion iterations per dispatch in workgroup memory | 2, speed |
| P6 | `override` constants for per-world gates (fine, decision 28) | 2, speed |
| P17 | Talus cones and fans as shapes, with sorting rules | 3 |
| P18 | Ripples with defects and sand shadows | 3 |
| P22 | V, U and terraced valleys as landform presets; painted repose | 3 |
| P14 | Scarp retreat on plateau strokes: mesas and buttes | 3 |
| P15 | Apron hummocks, knolls and slumps around a shape | 3 |
| P2 | Rills in the bake, steered by the fall-line map | 3 |
| P3 | Derivative-damped lumps, fractional octaves, tilted terraces | 3 |
| P7 | Carried velocity and MacCormack sediment in the pipe model | 3 |
| P8 | A coarse stream-power pass for map-scale ranges (waits, decision 26) | 3 |
| P19 | Dunes by Werner's model as a deterministic gather (waits, decision 26) | 3 |

### Round 3 cards (2026-11-04)

Four more agents ran in their own worktrees. Their commits are on this
branch:

- `realism.py`: a realism check, calibrated on USGS 3DEP 1 m lidar;
- `vg-*`: vegetation and ground cover;
- `ws-*`: water, shores and rivers;
- `tx-*` and `tx-*.py`: texture families and palette rendering.

| Card | What | Group |
| --- | --- | --- |
| P25 | Realism gates: `realism.py` on green-modern-1..3 (closed basins, fabric, hilltop roundness, Hack, hollow and valley shares) | 1 |
| P29 | Startup material pass: dot diffusion in `makeDither`, phasor rock grain in `mmLit`, oriented grass strokes | 1 |
| P30 | Ground cover placed by ecosystem rules: Moisture, Lushness, Patchiness | 1 |
| P31 | Tufts, moss cushions, shrubs and flowers as lit structure in P16's scatter | 1 |
| P32 | Terracettes on steep grass, extending `wrinkles` | 3 |
| P26 | One water model: Beer-Lambert depth colour, murk, wind, caustics, glint (after P4) | 3 |
| P27 | Shores from `coastSd`: beach profile, foam lace, headlands by hardness | 3 |
| P28 | Rivers as a migrated stroke on P22's valley landform (at least 32 px wide) | 3 |

Round 3 also changed P1: `realism.py` scored the round 1 gully fold (sharp
crests) as less real than no gullies. With fold -1 (round crests, V-cut
floors), 10 of 15 statistics fall in the real range, against 8 of 15. See
`lab/lib.wgsl` `gulliesF`.

### The tile budget (P33)

`lab/exp/tb-ground.js` draws one plain three ways: world-space detail,
tile-local detail with K variants per tile, and corner-coloured patch tiles.
`tile-budget.py` counts unique 32 x 32 tiles and merges near-duplicates under
an edge-weighted, blurred OKLab error, keeping real tiles as representatives.

Measured over 768 slots:

| Ground | Merge threshold | Unique tiles |
| --- | --- | --- |
| World space (today) | none | 768 |
| World space | 3.0 | 178 |
| Corner tiles | 0.5 (mean error 0.37) | 239 |
| Corner tiles, level-ground light off | none | 218 |

Relief tiles barely merge below 2.0. P33 adds these specifics to BACKLOG's
Phase 4:

- key detail to tile-local coordinates plus a variant;
- draw low-frequency patterns as corner tiles with stochastic content (the
  lab's lattice textures show a plaid);
- keep long-range light off level ground, or let the merge absorb it;
- merge to the budget in order of increasing error;
- move big decorative stones into features where gameplay allows.
