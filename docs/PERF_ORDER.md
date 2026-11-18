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
