# LP3 regional shape and Time lattices, November 13

> Follow-up: [far-view memory and preview readbacks](LP3_MEMORY_READBACKS.md)
> resolves the sampled block splitting below and adds warmed pool prediction.
> This report retains the earlier measurements and quality limits.

This follow-up is on `live-preview/review`, after main `f41ff288`. It implements
LP3 steps 2 and 3 for paged coarse blocks. It has not been merged to main.
The full LP3 acceptance matrix and later steps remain open.

A coarse paged block evaluates the existing shape graph and Time kernels on
an approximately 4-pixel global lattice instead of the canonical approximately
2-pixel lattice. Its regional square includes the same world-space Time apron.
Quarter blocks, Fit, final tiles, picking, height bytes, and exports continue
to use their existing lattices. There is no new shader, control, or render flag.

During an authored drag, a matching completed coarse Time result can be blended
with the new authored shape using the existing refinement filter. Rain or other
Time changes require a newly completed coarse pass. The retained window can
cover a smaller dirty region, bounded by its apron, so growing a stroke does not
needlessly restart Time. Started coarse work finishes with its source serial and
B revision; a later input cannot be credited by that older image. Camera changes
still cancel it.

Only one regional source is retained. Under pressure its shape engine and target
are returned to canonical work while the smaller weather buffers survive. A
completed voxel solid is released before preparing the next source; it was
already rebuilt on every draw. Optional page copies and navigator fills yield
to view work and release idle renderer working resources before allocating.
Preview reservations constrain page counts, independently of the canonical ring.
The request's grid is excluded from world-change detection.

## Focused Chrome comparison

Measured in Chrome 157.0.8103.78 on the same machine, with explicit
2048- and 512-MiB budgets. Main is `f41ff288`; the final code is `fa03d40c`.
The order of the retained runs is main 2048, branch 2048, main 512, branch 512.
Fresh-server warm-ups were discarded. Every run checked the process list and
passed three consecutive driver-utilization samples at or below 20%; Zoom was
present in the process list. Runs were sequential, never concurrent.

At 512 MiB, stroke whole-current p95 falls from **2359.8 to 88.9 ms** (26.5×),
and held Rain from **2156.2 to 216.6 ms**. At the default budget, stroke remains
within the 100-ms whole-current target (**93.1 vs. 96.2 ms**); rock continuous
improves from **88.4 to 55.4 ms**. This establishes a large low-memory gain,
not a default-budget stroke speed gain. First-changed and whole-current input
observations are uncensored; uncompleted pause-to-final endpoints retain their
censoring counts in the compact metrics.

Accounted peak terrain memory is **533.0 vs. 510.8 MiB** at 512 MiB and
**857.6 vs. 792.0 MiB** at 2048 MiB. These are application-accounted resources,
including the new source's Time working estimate, not driver or whole-device
memory. The sampled original view uses one coarse block at 512 MiB.

The 100-ms resume has an active Time pass in both main runs and the default-budget
branch run. The 512-MiB branch run has dirty final tiles but no Time pass active
at that instant: its **90.6-ms** p95 is an early-resume result, not a new proof of
the Time-in-flight case at that budget. The default-budget branch's qualifying
resume p95 is **92.1 ms**, versus main's **96.0 ms**.

The sampled whole-current stroke/rock rows meet 100 ms. The first-changed-pixel
50/100-ms goals are still missed in some rows. Final cost remains a tradeoff:
the 512-MiB cold-gate release-to-final is **2706.9 vs. 3103.0 ms (+14.6%)** in
this single pair. This new final-cost result remains for review on the branch.
At 2048 MiB the same endpoints are
**2287.9 vs. 2323.2 ms (+1.5%)**. No new acceptance threshold was introduced.

Times below are p50 / p95 milliseconds. Each release column has one endpoint
per run. [Compact phase metrics](LP3_LATTICE_METRICS.json) retain every phase's
rAF intervals, long tasks, handler/callee times, queue/submission maxima,
pipeline counts, bitmap-copy times, memory, and off-screen GPU distributions.

### 2048 MiB

| Phase | Build | First changed | First tile | Pointer tile | Whole current | Release → final |
| --- | --- | ---: | ---: | ---: | ---: | ---: |
| load | main | 517.6 / 517.6 | 517.6 / 517.6 | — | 517.6 / 517.6 | 2886.4 / 2886.4 |
| drag | main | 62.6 / 93.1 | 17.4 / 79.9 | 62.6 / 93.1 | 62.6 / 93.1 | 3046.7 / 3046.7 |
| release | main | 22.0 / 22.0 | 16.3 / 16.3 | — | 3046.7 / 3046.7 | 3046.7 / 3046.7 |
| resume | main | 69.2 / 96.0 | 69.2 / 96.0 | 69.2 / 96.0 | 69.2 / 96.0 | 3089.0 / 3089.0 |
| faceBlockSize continuous | main | 44.7 / 88.4 | 44.7 / 88.4 | — | 44.7 / 88.4 | 2321.8 / 2321.8 |
| faceBlockSize pause | main | 50.6 / 89.4 | 50.6 / 89.4 | — | 50.6 / 89.4 | 2274.2 / 2274.2 |
| erosionRain continuous | main | 1374.9 / 2191.5 | 1374.9 / 2191.5 | — | 1374.9 / 2191.5 | 2856.9 / 2856.9 |
| erosionRain pause | main | 896.7 / 1330.0 | 896.7 / 1330.0 | — | 896.7 / 1330.0 | 2793.7 / 2793.7 |
| creaseShade cold-gate | main | 56.2 / 89.5 | 56.2 / 89.5 | — | 56.2 / 89.5 | 2287.9 / 2287.9 |
| load | branch | 121.8 / 121.8 | 121.8 / 121.8 | — | 121.8 / 121.8 | 3083.2 / 3083.2 |
| drag | branch | 58.3 / 89.3 | 17.8 / 78.0 | 58.3 / 89.3 | 60.3 / 96.2 | 3020.9 / 3020.9 |
| release | branch | 112.3 / 112.3 | 15.9 / 15.9 | — | 3020.9 / 3020.9 | 3020.9 / 3020.9 |
| resume | branch | 59.7 / 92.1 | 59.7 / 92.1 | 59.7 / 92.1 | 59.7 / 92.1 | 3068.9 / 3068.9 |
| faceBlockSize continuous | branch | 54.0 / 55.4 | 54.0 / 55.4 | — | 54.0 / 55.4 | 2279.7 / 2279.7 |
| faceBlockSize pause | branch | 46.5 / 61.4 | 46.5 / 61.4 | — | 46.5 / 61.4 | 2351.8 / 2351.8 |
| erosionRain continuous | branch | 134.3 / 203.5 | 134.3 / 203.5 | — | 134.3 / 203.5 | 2827.7 / 2827.7 |
| erosionRain pause | branch | 151.3 / 212.3 | 151.3 / 212.3 | — | 151.3 / 212.3 | 2898.6 / 2898.6 |
| creaseShade cold-gate | branch | 32.5 / 60.7 | 32.5 / 60.7 | — | 32.5 / 60.7 | 2323.2 / 2323.2 |

### 512 MiB

| Phase | Build | First changed | First tile | Pointer tile | Whole current | Release → final |
| --- | --- | ---: | ---: | ---: | ---: | ---: |
| load | main | 519.3 / 519.3 | 519.3 / 519.3 | — | 519.3 / 519.3 | 3383.9 / 3383.9 |
| drag | main | 1458.4 / 2359.8 | 18.3 / 1058.2 | 1458.4 / 2359.8 | 1458.4 / 2359.8 | 3608.1 / 3608.1 |
| release | main | 459.0 / 459.0 | 19.3 / 19.3 | — | 3608.1 / 3608.1 | 3608.1 / 3608.1 |
| resume | main | 1294.6 / 2045.0 | 1294.6 / 2045.0 | 1294.6 / 2045.0 | 1294.6 / 2045.0 | 3851.7 / 3851.7 |
| faceBlockSize continuous | main | 49.3 / 213.1 | 49.3 / 213.1 | — | 49.3 / 213.1 | 2867.2 / 2867.2 |
| faceBlockSize pause | main | 65.2 / 299.3 | 65.2 / 299.3 | — | 65.2 / 299.3 | 2873.5 / 2873.5 |
| erosionRain continuous | main | 1323.6 / 2156.2 | 1323.6 / 2156.2 | — | 1323.6 / 2156.2 | 3313.6 / 3313.6 |
| erosionRain pause | main | 909.6 / 1347.2 | 909.6 / 1347.2 | — | 909.6 / 1347.2 | 3325.5 / 3325.5 |
| creaseShade cold-gate | main | 40.2 / 286.8 | 40.2 / 286.8 | — | 40.2 / 286.8 | 2706.9 / 2706.9 |
| load | branch | 112.2 / 112.2 | 112.2 / 112.2 | — | 112.2 / 112.2 | 3630.1 / 3630.1 |
| drag | branch | 56.8 / 88.8 | 17.8 / 76.5 | 56.8 / 88.8 | 56.9 / 88.9 | 3694.1 / 3694.1 |
| release | branch | 123.6 / 123.6 | 14.6 / 14.6 | — | 3694.1 / 3694.1 | 3694.1 / 3694.1 |
| resume | branch | 56.8 / 90.6 | 56.8 / 90.6 | 56.8 / 90.6 | 56.8 / 90.6 | 3947.3 / 3947.3 |
| faceBlockSize continuous | branch | 20.1 / 53.9 | 20.1 / 53.9 | — | 20.1 / 53.9 | 2901.6 / 2901.6 |
| faceBlockSize pause | branch | 46.0 / 60.3 | 46.0 / 60.3 | — | 46.0 / 60.3 | 2851.0 / 2851.0 |
| erosionRain continuous | branch | 149.0 / 216.6 | 149.0 / 216.6 | — | 149.0 / 216.6 | 3474.9 / 3474.9 |
| erosionRain pause | branch | 172.4 / 245.6 | 172.4 / 245.6 | — | 172.4 / 245.6 | 3360.5 / 3360.5 |
| creaseShade cold-gate | branch | 37.0 / 56.4 | 37.0 / 56.4 | — | 37.0 / 56.4 | 3103.0 / 3103.0 |

### Other observed costs

| Budget | Build | Longest queue wait | Longest GPU submission | Longest task | Handler max | Specialized sets built | Bitmap-copy max | Wholly off-screen GPU max / mixed-region max |
| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| 2048 | main | 160.2 | 156.1 | 0.0 | 0.8 | 2 | 0.2 | 33.2 / 2896.5 |
| 2048 | branch | 157.1 | 153.4 | 0.0 | 0.6 | 2 | 0.2 | 32.0 / 2905.9 |
| 512 | main | 103.2 | 100.9 | 0.0 | 0.6 | 2 | 0.2 | 68.7 / 2975.1 |
| 512 | branch | 168.2 | 157.8 | 0.0 | 1.3 | 2 | 0.2 | 57.0 / 3156.2 |

The off-screen columns are the largest individual phase totals. Mixed-region
work cannot be assigned exactly to visible versus off-screen pixels. Submission
maxima above 100 ms remain LP4 work. Specialized sets are counted without the
overlapping release-only capture. No long task over 50 ms was observed.


These are focused performance checks, not completion of LP0's full scene/map/view
matrix. Each budget has one main/candidate pair. Broader repetitions, other
controls, and other views remain open. First changed pixels are observed canvas
copies, not physical display scanout. Pointer latency is absent for sliders,
whose pointer is outside the terrain. Superseded inputs still wait for a picture
current enough to answer them; no thresholds or censoring rules changed.

The benchmark now recognizes both canonical and regional preparation, retaining
its strict source hooks. Its field-preparation interval includes either source.
Scalar memory components recorded at new peaks exposed the overlap between a
completed voxel pool and the next page preparation. Experimental versions that
canceled every coarse request or retained that pool are excluded from the tables.

## Route and quality checks

A small Node/Dawn diagnostic compared the two existing shape routes over the
large Green Modern 2 view, with nine resident canonical pages, ring 4, and a
667-square coarse window. First calls were discarded; three subsequent calls:

| Route | Median (range), ms |
| --- | ---: |
| Resident pages, existing height-only decimation | 2.6 (2.4–3.1) |
| Changed pages plus that decimation | 10.7 (10.4–11.1) |
| Regional coarse shape, including all masks | 2.2 (2.1–2.3) |

These are diagnostic wall times under Node, not Chrome input latency. Existing
`decimate` returns only heights with readback; a complete preview needs the other
planes and masks too. Regional reevaluation is retained because it avoids
canonical page preparation after edits and already produces those inputs.

The following quick comparison uses the three requested map16 scenes, a
1024×768 window at (0,300), Time enabled, and Rain at 0, 1, and 2. Heights include
the same art-level subtraction and refinement blend as the feed shader.
Contours at sea level and seven 16-unit offsets are compared bidirectionally on
the canonical sampling grid. These are sampled contour distances, not a bound
on every possible contour or thin feature.

| Scene | Rain | Height error p95 / max, units | Contour offset p95 / max, px |
| --- | ---: | ---: | ---: |
| green-modern-2 | 0 | 0.21 / 6.58 | 0.87 / 28.52 |
| green-modern-2 | 1 | 0.50 / 6.45 | 1.49 / 28.65 |
| green-modern-2 | 2 | 0.51 / 6.41 | 1.64 / 28.88 |
| red-3 | 0 | 0.04 / 0.86 | 0.25 / 1.01 |
| red-3 | 1 | 0.49 / 3.39 | 3.16 / 6.11 |
| red-3 | 2 | 0.54 / 2.95 | 2.54 / 6.17 |
| green-7 | 0 | 0.04 / 0.43 | 0.45 / 1.09 |
| green-7 | 1 | 0.30 / 1.79 | 2.41 / 4.21 |
| green-7 | 2 | 0.32 / 1.79 | 2.43 / 4.28 |

Measured maximum contour offset is 28.9 pixels on Green Modern 2; a focused
Rain=1 check locates its 28.7-pixel outlier at the 187-unit contour, around small
high-elevation loops. That scene has no sea-level crossing in the sampled window.
Across the nine cases the largest p95 offset is 3.2 pixels. By eye, the main
contours track closely in the three Rain=1 overlays; the maximum loop difference
is reported rather than treated as an accepted quality threshold. The owner's
preview-quality judgment remains open. Dawn printed two canceled-readback
notices when disposing scenes between cases; the completed height comparisons
had no GPU validation errors.

## Quick correctness and remaining work

Fifteen focused CPU checks pass (lattice geometry and retention, field-grid
alignment, world/instance stage classification, and coverage freshness), as does
the world-name gate. The three fixed canonical 256×256 windows at (256,512),
Green Modern 2, Red 3, and Green 7, match main exactly under Node/Dawn; their
SHA-256 values are retained in the compact metrics. Both Chrome final viewport
replays change **zero of 1,769,472 pixels**, after their measured workloads.

An untimed Chrome check also exercises nonzero source origins after moving the
authored scene and viewport to (2048,2300). Its sampled final window returns to
identical pixels after a Rain round trip, with no console error or error banner,
and an accounted peak of **511.3 MiB**. This view needs **two to four coarse
blocks** at 512 MiB, so the single-block result at the original benchmark view
is not a general single-block acceptance claim. Tighter source estimates or
further memory reduction are still needed away from the map edge.

Correctness checks stayed focused; the full scene, export, control, and Safari
sweeps were not run. Temporary raw results and images were deleted after reading;
only compact numerical phase summaries remain in the repository.

No raster change or voxel-count approximation was added. The next LP3 work is
removing preview allocation readback waits, followed by the optional cheaper
raster experiment if its color bias is acceptable. The focused comparison does
not close the full LP3 acceptance gates. GPU submissions above 100 ms, focus-tile
latency, and broader Safari/iPad validation also remain open. Safari automation
was not retried. No benchmark was added to `repro/check.sh`.
