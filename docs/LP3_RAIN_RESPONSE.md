# LP3 Rain first view and compilation, November 13

This follow-up stays on `live-preview/review`, compared with its previous tip
**30c24862**. The code commits are **9ce7d5c5**, **17fde8e5**, and
**c29b49a3**. Main is unchanged by this follow-up. The owner approved trying
an 8-pixel first Time view, with automatic 4-pixel refinement and full final
rendering. These are focused measurements, not full LP3 acceptance.

**Measured in the last alternating pair:** Rain first-changed and whole-current
p95 improve **273.8 → 97.9 ms** continuously and
**258.7 → 100.3 ms** with a pause.
Release-to-final improves **9.1%** and **6.0%**, respectively.
An earlier identical candidate logged a transient memory-budget exception
and is excluded from acceptance. The 100-ms Rain target remains unmet in the
clean pair, and repeatability is not established. The limit still includes
a full coarse Time refresh and waiting for the preceding draw to drain.

## Changes

Paged stage-B edits start at 8 terrain pixels per image pixel. The same shape
and Time kernels run on that lattice, retaining the full world-space apron,
parameters and 200 iterations. After a 100-ms quiet period the view automatically
refines through 4 pixels, then the existing 2-pixel/final ladder. Other edits
and native small-map lattices keep their existing first level. The 8-pixel
preview is temporary; finals and export keep their canonical lattice.

A current immutable block satisfies coverage without reserving another source
working set. This keeps an existing 8-pixel answer while the 4-pixel source
allocates. Input invalidates metadata without replaying the old picture on
every input frame. New results and camera changes still compose the view.
An interactive refresh can replace a queued animation-frame presentation as
soon as the preceding bake finishes. Freshness and pixel-change endpoints are
unchanged; retained old images cannot count as answering new input.

The thermal pass shares a 10×10 halo around each 8×8 workgroup, including
bed angles, instead of recalculating them for every neighbor pair. Its update
order and equations are unchanged. Adaptive Time batches retain the 25-ms
queue-wait target, conservative first iteration, task yields and stale checks;
the ceiling rises from 32 to 256. The sampled 8-pixel refresh typically uses
five or six submissions, including input/output, rather than the baseline's
ten. The compact metrics retain actual batches and maximum waits. This is
not a device-independent submission bound.

Previews and finals now share one uniform-gated fragment pipeline per rock
mask. Relief bake/loose compute pipelines still specialize. The old plan kept
specialized fragments for finals because compiler variants had moved isolated
pixels; the owner later allowed small shifts for a better, simpler fix.
The three sampled final windows here have **zero** changed pixels. This
removes the edit-time fragment compile rather than postponing it behind a
preview. New compute specializations can still compile.

In an untimed in-page probe, eight gate combinations create **eight render
pipelines before and zero after**. Seven baseline combinations take
**2696.2–2779.1 ms** each; the first takes 45.5 ms. Afterward, seven combinations
reuse the bake key and take 0 ms; the one new bake key compiles two compute
pipelines in **18.6 ms**. The gates are creaseShade, layerCrease, flatBank,
and bandWater. Driver caches were not cleared, so these are observed compile
stalls and API-call counts, not a claim about a pristine-driver startup.

A fused Time-kernel experiment changed sampled bytes and was discarded.
Moving the fragment overflow guard did not reduce compilation and was
discarded. Smaller held/off-screen voxel pieces preserved strict partition
pixels but regressed the focused timings; those changes were also discarded.

## Focused Chrome comparison

Chrome/157.0.8103.78, map16, explicit **512 MiB**, terrain view
**1728×1024 at (2048,2300)**. Green Modern 2 strokes are translated by
(2048,2048), matching the previous report. Both fresh servers discard a warm-up.
Each timing run checks `ps` and passes three consecutive GPU-utilization
samples at or below 20%; no concurrent benchmark was observed. The retained
sequence is baseline, candidate, baseline, unchanged candidate. The earlier
candidate raises a transient configureChunks memory-budget exception during
input and is excluded from acceptance. Only the last baseline/candidate pair
qualifies here, with empty error logs; other development experiments are excluded. [Compact metrics](LP3_RAIN_RESPONSE_METRICS.json)
retain all four runs with their qualification, all endpoints, costs, compile
probes and correctness evidence.

Times are **p50 / p95 ms**. Pointer tiles are absent for controls outside the
terrain. Each release has one completed final sample; the mid-drag pause's
completion/censoring remains explicit in the metrics. Paint completion is a
canvas endpoint, not physical display scanout. First changed, first tile and
whole-current are reported separately even where their values coincide.

| Phase | Build | First changed | First tile | Pointer tile | Whole current | Release → final |
| --- | --- | ---: | ---: | ---: | ---: | ---: |
| load | before | 151.7 / 151.7 | 151.7 / 151.7 | — | 151.7 / 151.7 | 5342.5 / 5342.5 |
| knob-erosionRain/continuous | before | 192.5 / 273.8 | 192.5 / 273.8 | — | 192.5 / 273.8 | 4641.5 / 4641.5 |
| knob-erosionRain/pause | before | 180.6 / 258.7 | 180.6 / 258.7 | — | 180.6 / 258.7 | 4495.1 / 4495.1 |
| knob-creaseShade/cold-gate | before | 39.5 / 64.3 | 39.5 / 64.3 | — | 39.5 / 64.3 | 3970.4 / 3970.4 |
| load | after | 132.4 / 132.4 | 132.4 / 132.4 | — | 132.4 / 132.4 | 4914.7 / 4914.7 |
| knob-erosionRain/continuous | after | 72.1 / 97.9 | 72.1 / 97.9 | — | 72.1 / 97.9 | 4219.4 / 4219.4 |
| knob-erosionRain/pause | after | 73.1 / 100.3 | 73.1 / 100.3 | — | 73.1 / 100.3 | 4224.2 / 4224.2 |
| knob-creaseShade/cold-gate | after | 48.5 / 68.8 | 48.5 / 68.8 | — | 48.5 / 68.8 | 3827.3 / 3827.3 |

| Build | Largest rAF p95 | Queue wait max | Submission max | Handler max | Bitmap-copy max | Peak terrain MiB | Wholly off-screen / mixed GPU max |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| before | 16.8 | 87.4 | 84.1 | 0.4 | 0.2 | 508.8 | 32.4 / 3595.1 |
| after | 16.8 | 85.5 | 83.2 | 0.7 | 0.2 | 513.1 | 31.3 / 3075.5 |

Off-screen numbers are largest individual phase totals in ms. Mixed passes
cannot be assigned exactly to visible pixels. Handler callee distributions
(history.replaceState, saveWorlds, applyKnobs, syncWorldControls), GPU passes,
source/page waits, memory, actual pipeline calls, long tasks and batch sizes
remain in the metrics. No long task over 50 ms is observed in the final pair.
The candidate load phase briefly reaches **513.1 MiB**, **1.1 MiB over** the
requested budget, while canonical pages grow beside the retained 4-pixel
source. Its Rain/cold-gate phases peak at **504.8 MiB**. Strict load-time
memory containment remains open; this run is not proof of an absolute 512-MiB
ceiling. The largest focus-final p95 is **610.2 ms**
against the plan's 600-ms target; it remains a separate endpoint.

## Quick correctness and preview quality

All **21** focused CPU checks and the world-name gate pass. Three coarse Time
buffer probes (Rain 1.1, 1.2, 1.1) retain exact baseline hashes. The larger-batch
stale proof stops after two submitted iteration slices and submits **no third**.
The strict Green 2/map16 partition comparison (256-pixel versus 128-pixel tiles,
512×256 window around the earlier differing pixel) has **zero** changed pixels;
no threshold or test was loosened. The final 256×256 windows at (256,512) on
Green Modern 2, Red 3 and Green 7 retain their baseline hashes. The final Chrome
viewport matches a fresh replay: **zero of 1,769,472 pixels changed**. No GPU
validation errors occur in these checks.

The 8-pixel quality sample compares canonical and coarse Time heights at Rain 1
on a 1024×768 window at (0,300) for each scene. Contours include sea level and
seven 16-unit elevation intervals, with symmetric nearest-contour offsets in
terrain pixels, using a 64-pixel target apron so a contour exiting the view
is not mistaken for a missing feature. This is a small quality sample, not the
full Rain 0/1/2 matrix.

| Scene | Height error p95 / max | Contour offset p95 / max, px | Unmatched contour points |
| --- | ---: | ---: | ---: |
| green-modern-2 | 0.93 / 9.90 | 2.49 / 31.48 | 0 |
| red-3 | 0.95 / 2.88 | 4.49 / 7.96 | 0 |
| green-7 | 0.55 / 2.91 | 4.18 / 5.87 | 0 |

By eye, the broad outlines follow one another. Green Modern's fine high-elevation
features can lose small contour loops: the largest offset is **31.5 px**, from
final (98.5,730.1) to coarse (128.4,720.1) at height 187. Its p95 is 2.49 px,
but that does not dismiss the outlier. The temporary 8-pixel quality remains
open for owner review. An initial 471.9-pixel diagnostic maximum came from
clipping both contours at the window edge; the target apron corrects that
measurement. No pixel acceptance threshold changed. The helper also now drains
GPU work and callbacks before teardown, eliminating its initial cancellation
errors; the corrected quality samples have zero errors.

Strict load-memory containment, default-budget and other-view/scene performance, the broader contour decision,
cold allocation seeds, tail readback validation, Safari/iPad, and the optional
cheaper raster remain open. Broader correctness/export/realism sweeps stay
deferred at the owner's request. No benchmark was added to `repro/check.sh`.
Raw outputs are deleted after reading; this report and compact evidence remain.
