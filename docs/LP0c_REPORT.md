# LP0c: stable view tiles and sampling, 2026-11-12

**Status:** sampling, view-grid and cache-correctness work complete; final
regression checks are running. The owner deferred timing runs until the
system is quiet and authorized moving to the next card.
Work stays on `lp0c/view-tiles`. Nothing landed or was pushed; no LP0b work.

**Sampling fault [measured/read].** The stopped count was `green-2`, map16,
at art pixel (893,750): RGB (47,119,27) in 128 px tiles versus (43,103,19)
in 256 px tiles. Repeated 256 px pictures matched exactly. GPU probes found
the same nearby input texels, hit, normal, grass and lighting. The first
difference was the fall-line texture's X direction: 0.1916667223 versus
0.1911764145. Wet-swath color then crossed a palette threshold.

`regionalUv` fused `uv * grid - tileOrigin`, rounding at different local
precisions. For the recorded Y coordinate, the exact product is
380.9511786699295; subtracting the two origins and rounding gives
263.951171875 versus 199.95118713378906. The shared fix uses `modf` to split
the global coordinate before subtracting the origin. Both tiles then keep
the same fraction. This is one correction for all regional texture reads;
no world, tile-size or feature special case. Commit **abf61c1b**.

The owner explicitly accepted a few changed scene pixels for a better,
simpler fix. Against main 8e42ae8e, the 256 px check pictures move exactly:

| Scene | Changed pixels | Maximum RGB-channel difference |
| --- | ---: | ---: |
| green-2 | 3 | 16/255 |
| green-5 | 2 | 16/255 |
| green-modern-2 | 1 | 28/255 |
| Other 31 scenes | 0 | 0 |

**Strict tile gate [measured].** All **68 scene/map combinations** pass:
34 complete 1024×1024 check windows at (0,0), on map4 and map16. Every
128-versus-256, 512-versus-256 and repeated-256 comparison has **0 differing
pixels**, with 0 reported GPU errors. No pixel tolerance was changed.
The owner's original `tilesize.mjs` was run sequentially through the view's
fed path under Node/Dawn, with its explicit window arguments. The renderer
budget is the script's 1024 MiB after scene startup at gpuMB=512 / heapMB=1536.

| Scene | 128 vs. 256, map4 | 128 vs. 256, map16 |
| --- | ---: | ---: |
| archipelago-1 | 0 | 0 |
| archipelago-2 | 0 | 0 |
| archipelago-3 | 0 | 0 |
| crystal-1 | 0 | 0 |
| crystal-2 | 0 | 0 |
| crystal-3 | 0 | 0 |
| desert-1 | 0 | 0 |
| desert-2 | 0 | 0 |
| desert-3 | 0 | 0 |
| green-1 | 0 | 0 |
| green-2 | 0 | 0 |
| green-3 | 0 | 0 |
| green-4 | 0 | 0 |
| green-5 | 0 | 0 |
| green-6 | 0 | 0 |
| green-7 | 0 | 0 |
| green-modern-1 | 0 | 0 |
| green-modern-2 | 0 | 0 |
| green-modern-3 | 0 | 0 |
| ice-1 | 0 | 0 |
| ice-2 | 0 | 0 |
| ice-3 | 0 | 0 |
| lava-1 | 0 | 0 |
| lava-2 | 0 | 0 |
| lava-3 | 0 | 0 |
| moon-1 | 0 | 0 |
| moon-2 | 0 | 0 |
| moon-3 | 0 | 0 |
| red-1 | 0 | 0 |
| red-2 | 0 | 0 |
| red-3 | 0 | 0 |
| zhon-1 | 0 | 0 |
| zhon-2 | 0 | 0 |
| zhon-3 | 0 | 0 |

**View grid [read].** The view uses 256 px tiles independently of the
export's canonical size. Its fallback is selected from the actual GPU
budget and live reservations. A change in the export's fixed 128 MiB
trial no longer deletes the view cache. The export's tile selector and
trial reserve are unchanged. No controls or panels were added.

**Active-bake safety and cache retention [measured/read].** Larger view
tiles exposed a resource race: the export's temporary `setBudget(128 MiB)`
trial could evict textures while a bake awaited voxel allocation. The
trial and view-size selection now use the same pure estimator with explicit
budget/reservation arguments. Budget mutation waits until the renderer is
idle; `bake()` also applies the budget before the next render.

The corrected real-mouse Surface workload delivered 144 events across the
large and baseline views with 0 exceptions. At the baseline 1208×841 view,
main changed its canonical size four times and emptied 84, 15, 36 and 47
cached images respectively. LP0c made the same four flips and kept **84→84**
images every time; display tiles stayed 256 px. These are configuration
checks under shared GPU load: all latency values from those runs were
discarded. Final regression checks are being repeated after the race fix.

**Scene and realism checks [measured].** The view-grid work adds **0 pixels**
beyond the sampling fix on all 34 check scenes. Modern Green's three
height files match main byte for byte, so its before/after realism figures
are identical: mean **8.47/15** statistics in the real range over 17 windows;
maximum slope p90 **1.121**. Gate pass counts before → after: closed basins
17→17, fabric 16→16, hilltop roundness 9→9, Hack's exponent 5→5, hollow share
17→17, valley share 17→17. No terrain shape changed.

The land tier passed, with `--worlds green,green-modern` for the owner's
sampling exception; the separate exact count above prevents additional
drift from being hidden by that scope. 205 unit tests, world-name gate,
regional replay, voxel, nine-world smoke/export, paged map, features,
passability and shape-repeat checks passed. A temporary Node launcher
assigned smoke ports 11200–11202, features 11210 and passability 11211;
`repro/check.sh` was not edited.

**Memory and export [measured].** On the large `green-modern-2` map16
view, the 512→384→320→512 MiB sequence selected 256→256→128→256 px tiles,
matching the renderer's largest-fitting-tile estimate at every settled
step. The 256 px view has **35 visible tiles**; the 128 px fallback has
126. The probe's accounted GPU peak was **408.8 MiB**. A separate 256 MiB
attempt could not fit even a 32 px bake on this paged fixture.

`repro/export-bytes.mjs` passed all three default cases: Green 4×4
landforms (25 chunks), Lava 8×8 dense (81), Red 16×16 dense (289). Both
WebAssembly exports and native export match byte for byte in each case.
These are equality checks; their times are not used as speed evidence.

**Browser timing: deferred by the owner, 2026-11-12.** One successful
fresh-server warm-up was discarded for each build. No alternating timing
sample was accepted: the shared GPU remained busy. The owner said to move
on and run timings later when the system is quiet. The original gates and
20% quiet-start guard remain unchanged. Still owed: the two large rocky
fixtures on map4/map16, two alternating pairs per fixture, with first
picture, whole-view and release numbers. Speed is not inferred from the
tile count. New scalar-only `configureChunks` hooks work on both builds
and still fail closed on drift.

**Evidence and conditions.** Apple M3 Pro / 18 GiB, macOS 26.6.2 (25G83),
Node v24.5.0, existing Dawn binding. Small count and probe results are in
`~/terraform-assets/agent-lp0c/`; raw traces and generated images are
removed after reading. The original stop report is preserved in commit
5cc02477. The approved sampling exception is recorded in the plan in
commit 81c09cd8; the zero-pixel tile-size test remains strict.
