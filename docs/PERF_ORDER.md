# Performance and memory work, in order (2026-11-17)

This order comes from a review of an outside audit of `fe63543a`. The audit
profiled a 4x4 Green map in Chrome on Metal, and its GPU was already 53% busy
when the run started. Each claim below was checked against the code and the
audit's own profile. Numbers marked "audit" are its measurements, numbers
marked "earlier" come from earlier sessions, and "code" means read from code.
None of the timings were rerun for this review.

## 1. Palette output from a precomputed table

**Measured (audit):** after a stroke's release, the output stage
(`engine-output.wgsl`, 8 candidates by a full palette search for every pixel)
took 66.7 ms of GPU time against 161.9 ms for terrain geometry, or 5.6 against
13.4 ms a picture. During a drag it took 6.6 ms in all, because coarse rasters
skip it. The change speeds finals, not drags.

The plan is a 64 x 64 x 64 table of each grid color's eight sorted
candidates. The output pass keeps the blue-noise threshold and looks up the
candidates. The audit's isolated probe ran 10 to 11 times faster. It moved
12.8% (Green) and 17.8% (Red) of pixels, with a mean 8 x 8 color shift of
0.56 to 0.61 / 255.

- Build the table on the GPU by running the existing candidate search over
  the grid's colors. Do not write a second copy in JavaScript (rule 7). Its
  arithmetic is in whole numbers, so every GPU builds the same table. Build
  one for each palette the output uses: a world may pick a subset of entries.
- It changes exported bytes and every preview: run `node repro/export-bytes.mjs`
  and render and publish the previews before a push. The owner judges the
  look.

## 2. Export and passability read only the planes they use

**Code:** `readRect` (`sculpt-gpu-fields.js`) copies all seven float planes,
28 bytes of masks and two weather heights for each lattice cell. JavaScript
then unpacks every mask, while the corner sampler (`sampleField`,
`sculpt-map.js`) uses only `h`, plus `r` and the weather heights for the
blend. That is 64 bytes a cell read for 20 used.

- Add an option that copies the `h` plane, plus the `r` plane and the
  weather heights when the blend needs them, with no masks, and use it for
  export corners and passability.
  Sampling stays in JavaScript, so the bytes cannot change.
- Time an export of a 16 x 16 map before and after. The audit's 993 MiB is
  data moved over a whole export, not memory held; no export time was
  measured.
- A GPU corner sampler is a later step, if the time is still worth it. It has
  to match `Math.round`, which rounds halves up, where WGSL `round` rounds
  them to even, and the weather blend runs in double precision in JavaScript.

## 3. Branches already built: `mem-color-cache` and `mem-pages`

- `088b94c4` (`mem-color-cache`) keeps color records only while color edits
  are in play. **Measured (earlier):** GPU process after load 1,067 to 618 MB
  (4x4) and 1,378 to 883 MB (16x16). The first color drag after sculpting is
  coarse and its final is slower. The owner decides.
- `mem-pages` (6 commits above `a1721f5e`) has had no review. It moves the
  CPU page spill under a budget, drops shape pages from the spill, and caps GPU
  shape pages. Review it, merge main, and rerun a probe pair.
- Sparse paint masks come after these. The audit measured 36 MiB of masks on
  a non-paged 4x4 map. On paged maps masks are half of each 56-byte page cell
  (about 224 MiB of the 448 MiB of shape pages on 16x16, earlier). The first
  cut is a page-level "no paint here" flag. Which pages to start with depends
  on `mem-pages`, which drops shape pages from the spill.

## 4. Material textures at 16 bytes a texel, and undo sharing

**Code:** each material texel takes 28 bytes: `rgba32float` color and art
height, `rgba8unorm` palette color, and `rgba16float` shine, of which the
shader reads one channel. The audit measured 84 MiB for 12 layers.

- Use `rgba16float` for color plus shine, `r32float` for height and
  `rgba8unorm` for palette color: 16 bytes a texel, 84 to 48 MiB.
- Do not store raw color in 8 bits. Graph color is stored unclamped, and the
  material's mean color, which colors rock and its beds, is averaged from the
  same texture (`engine-ground-dither.wgsl`), so 8 bits would move pixels
  everywhere.
- Undo keeps 48 checkpoints. Each one runs `structuredClone` on the
  materials, tools, surface, rocks and column, changed or not (`sculpt.js`
  history). Share the previous checkpoint's copy when a part is unchanged.

## 5. Neighboring color tiles share their inputs

**Measured (audit):** nine retained native tiles on Green held 56.5 MiB of
cropped height, weather/material and mask data. Perfect sharing would recover
33.6 MiB. It overlaps `088b94c4`: if that lands, records exist only during
color edits and the gain is at their peak. Do it last.

## Not funded yet: rasterizing the voxel surface

The audit proposed extracting triangles from the voxel solid and letting the
depth buffer find the visible surface. **Measured (earlier, ice-1, older
build):** the march, normal and record are about 3.1 of the geometry pass's
12.7 ms. The rest is shading after the hit (rock detail 5.0, rain and
occlusion 3.8, 2D occlusion 2.5, shadow 1.7), which a mesh would not remove,
and extraction costs GPU time of its own. Run a march-only ablation on the
current build before any prototype. Cheaper targets for drag geometry are
fewer rock-detail taps and light terms at 2 px.

## Not covered by the audit

Time and paging. On the owner's 8x8 map, Time was half the GPU time to a
final picture (2026-11-16).

## Status (2026-11-17, evening)

Each item is on its own branch from this one; none is on main. The owner
judged both look changes the same by eye.

- **1, done:** `perf/palette-table`. Output stage 5.4 to 0.25 ms a 512 px
  final tile; GPU per tile 41 to 31 ms (Node/Dawn); Chrome release to final
  on the 16 x 16 Green map 976-993 to 921-960 ms. 9.5-12% of pixels move;
  distinct colors in a window rise 5-9%. Checks: quick, engine, digest,
  export-bytes, browser smoke.
- **2, done:** `perf/height-read`. 16 x 16 corner heights 2.0-3.0 to
  1.1-2.3 s (Node/Dawn); heights and the exported `.ufo` byte-identical;
  passability on a paged 8 x 8 map in Chrome matches. A 16 x 16 export in
  headless Chrome fails on main and on this branch ("exceeds the JS memory
  budget"); with `mem-pages` it completes, also merged with this branch.
- **3, reviewed:** `mem-pages-review` merges `mem-pages` with main (review in
  `~/terraform-assets/agent-memory-2026-11-16/HANDOFF.md`). 16 x 16 after a
  pan: renderer process 916 to 387 MB, GPU process 1,272 to 1,110 MB, same
  pictures; fixes the 16 x 16 Chrome export. Waits on the owner: the
  iPhone/iPad 4 GB guess and the 24-page cap. `088b94c4` waits on the owner.
- **4, material textures done:** `perf/material-pack`. 84.3 to 48.3 MiB.
  With the palette off the picture is within one level per channel of main
  (shine published or not); with it, 42-49% of pixels pick another dot.
  The 128 MiB cache cap now admits 32 layers instead of 18 (the owner's
  call). Checks: quick, engine, digest, browser smoke, material editor.
- **4, undo sharing dropped:** on the owner's busiest map (8 x 8, 101
  features) the parts it would share are under 20 KB a checkpoint, under
  1 MB over 48 checkpoints.
- **5, not started:** waits on the `088b94c4` decision.

## Second round (2026-11-17, late)

Measured on main `ad10a3a4` (and `1f2b958e` before it). Other sessions held
the GPU at 80-100% throughout, so every timing is the fastest of several
interleaved pairs, and release-to-final times (which swung up to 1.7x
between runs of one build) are not used. Ideas came from two Fable code
reads; each was checked by ablation before it was ranked.

Where time goes now (owner's 8x8 map, Chrome): a jump is final at 0.8-1.3 s,
a draw 0.85-1.06 s after release. A final 512 px tile is about 26 ms of GPU
(Dawn): geometry 8.6, relief bake 6.5, color 4.4, voxel build 2.9. The
"output blit" figure (4.4 ms) is a timestamp artifact: it always equals the
color pass's, and a blit writing a constant costs the same. A drag keeps the
GPU 94-96% busy, a picture every 23 ms. Deposit and vent ground patches
(`fitGround`) are 128 px export-art bakes, one at a time, after the ring.

### Built (branches, not on main)

- **`perf/bake-skip`, relief octaves where gain is 0.** Byte-identical in
  nine fixtures. Dawn: relief bake 6.4 to 4.5 ms a tile on level-heavy
  ground. Owner's map, Chrome: 5.1-5.7 against 6.8-7.1 ms a bake after a
  jump; 0.9-1.0 against 1.1-1.2 ms a drag picture.
- **`perf/bake-skip`, cavity reads the hit's gradient once.** Byte-identical.
  Dawn: geometry 8.8 to 8.3 ms a tile; inside the noise in Chrome.
- **`fix/material-field-spacing` (a look fix, not perf).** On paged maps
  with Material weathering above 0, each page's material field used
  (world size - 1) / 767 as its spacing (about 5.7 px on 8x8, not 2): 75% of
  page cells differed from a whole-map field, by up to 0.95; none do with
  the fix. New GPU test `repro/material-field-pages.gpu.test.mjs`.

### Measured, not built

1. **The color reserve starves pages on small budgets.** `colorReserve()`
   holds min(40%, budget - 512 MiB) for color records whether or not any
   are held. At `gpuMB=1024` (16x16 Green): 7 shape and 7 weather pages
   against 24 each at 2048; after a 30-step pan 154 shape evaluations
   against 90; two sliders and a hill stroke then cost 237 more against 10.
   After the pan only 47 of the 410 reserved MiB held records. Reserving
   what the records hold needs the color cache to yield to pages (and pages
   to give room back when color edits start): a design for the owner.
2. **Soil-only voxels skip the rock-face lattices** (`voxelDensity`, an early
   return when `face == 0`). Voxel build -0.4 to -0.5 ms a tile on two rocky
   fixtures; one pixel in 1,048,576 moves (a float contraction tipping one
   dither), so exported bytes may change. Low priority.
3. **Fine path at coarse samples** (rock detail, rain, occlusion when a
   sample is 2 px or more): -1.3 of 3.5 ms geometry a quarter-level picture,
   -4.5 of 10.4 ms in a final (finals keep it). Changes preview pixels:
   rule 7 and the owner's eye decide.
4. **Margins.** Fields carry 204 px on every side for the far shadow taps;
   at 128 px the relief bake falls 6.5 to 5.0 ms, at 61 px no further. A
   per-side apron (toward the sun only) or one window for 2x2 tiles would
   share it; large, unmeasured beyond that.

### Measured and dropped

- `rockFlow`'s 16 rounds in one compute pass: byte-identical, no
  measurable change (the rounds' cost is compute, not pass overhead).
- Fewer bisections (16 to 10): 0.25 ms. Far shadow loop: 0.2 ms.
- Time run waits: after a draw, Time's span minus its GPU time and the
  draft is about 60-100 ms; worth a look only with a quiet GPU to measure.
- Bigger tiles: a 1024 px tile does a 1024 px square for 25% less GPU, but
  over-covers the view; the margin items above get the same saving.

Probes and logs: `~/terraform-assets/agent-perf2-2026-11-17/` (`ab.sh`
interleaved ablations, `mapprobe4.mjs` with after-release GPU idle,
`memprobe2.mjs` with page evaluation counts, `absumm.mjs`, `pngdiff.py`).
