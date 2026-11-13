# LP3 Rain response and final rendering, November 13

This follow-up stays on `live-preview/review`; no main merge is included.
The comparison is against the previous branch tip **737d0971**, after the
regional lattices, far-view memory fix, and predicted preview pools.
The implementation is **37575890** (Time batches), **b7023d95** (compile
preparation), and **f3ee8f64** (final-tile order).

**Measured in the final matched pair:** continuous Rain whole-current p95
improves **297.3 → 257.5 ms**, paused Rain **312.5 → 269.1 ms**.
Their release-to-final endpoints improve **5342.0 → 4393.8 ms (17.7%)** and
**5385.0 → 4513.4 ms (16.2%)**. The cold-gate final improves
**4799.7 → 3983.9 ms (17.0%)**. Rain still misses the 100-ms target.
The earlier 842-ms Rain / 7.5-second final measurements were not stable
under repetition; this report uses new matched baselines rather than
attributing all of that difference to the code.

## What changed

For this fixture, Time still runs the same kernels, lattice, 200 iterations,
and parameters.
Its adaptive batch ceiling rises from eight to 32 iterations, retaining the
25-ms queue-wait target, conservative first iteration, task yields, and
stale-request checks. The coarse request typically uses **10 submissions
instead of 28**. The first focused pair, before the tile-order change,
measures Rain p95 **312.7 → 261.6 ms** continuously and **315.8 → 273.8 ms**
with a pause. Continuous final latency is **5880.9 → 5265.2 ms** in that pair;
the cold-gate final is roughly unchanged (**4612.3 → 4741.6 ms**).
No first-pixel or whole-current endpoint was substituted for another.

The final scheduler keeps the focus tile first, then visits neighboring
visible tiles. Center-out radial order alternated opposite sides of the view,
evicting useful paged Time results under the six-page residency cap. In both
retained baselines, canonical Time completions after Rain release are **104**;
the final candidate uses **89**. Cold gate falls **102 → 87**. Off-screen order
and held preview ordering stay unchanged. This is less repeated work, without
new caches, shaders, controls, or a change to tile dimensions.

A scheduled final can prepare its focus source while its specialized pipeline
compiles. It releases the lease and leaves those pages cached, then resumes
exact drawing when the pipeline is ready. Preparation stops at that source;
walking farther during a long compile would evict it. Input can still cancel
the preparation. Direct readers and export complete their requested bake.
The unused `needsCoarse` bookkeeping is removed because a compile miss now
also wakes source preparation.

An untimed ordering proof holds a specialization promise for two seconds.
Before, **zero** canonical sources prepare during the wait. After, the focus
region finishes preparing **119.8 ms** into the wait and remains the only
prepared region. Its first final draw starts **22 ms** after readiness, versus
**170 ms** before. These are an artificial-delay diagnostic, not native compile
or input-latency measurements. Compilation itself is unchanged; actual new
shader variants can still take seconds on a cold driver cache.

## Focused Chrome comparison

Chrome 157.0.8103.78, map16, explicit 512 MiB, terrain view **1728×1024** at
**(2048,2300)**. The authored Green Modern 2 strokes are translated by
(2048,2048), matching the previous far-view report. Both fresh servers discard
a load warm-up. Each timing run checks `ps` and passes three consecutive
GPU-utilization samples at or below 20%. Runs are sequential.

The retained order is baseline, adaptive-batch candidate, then a new baseline
and the final candidate. An intervening tile-order attempt overlapped another
agent's `ui-previews.mjs` GPU run and is excluded. Both clean pairs and all
phase costs are in [the compact metrics](LP3_RAIN_FINAL_METRICS.json).
These are focused runs, not the full scene/map/view acceptance matrix.

The table uses the final baseline/candidate pair. Times are **p50 / p95 ms**.
Each release-to-final entry has one completed sample; uncompleted mid-drag
pause-to-final samples remain censored in the metrics. Pointer tiles are
absent for controls outside the terrain.

| Phase | Build | First changed | First tile | Pointer tile | Whole current | Release → final |
| --- | --- | ---: | ---: | ---: | ---: | ---: |
| load | before | 147.9 / 147.9 | 147.9 / 147.9 | — | 147.9 / 147.9 | 6238.2 / 6238.2 |
| erosionRain continuous | before | 226.2 / 408.4 | 221.3 / 297.3 | — | 221.3 / 297.3 | 5342.0 / 5342.0 |
| erosionRain pause | before | 212.4 / 312.5 | 212.4 / 312.5 | — | 212.4 / 312.5 | 5385.0 / 5385.0 |
| creaseShade cold-gate | before | 20.6 / 59.6 | 20.6 / 59.6 | — | 20.6 / 59.6 | 4799.7 / 4799.7 |
| load | after | 143.0 / 143.0 | 143.0 / 143.0 | — | 143.0 / 143.0 | 5105.7 / 5105.7 |
| erosionRain continuous | after | 199.0 / 374.0 | 176.3 / 257.5 | — | 176.3 / 257.5 | 4393.8 / 4393.8 |
| erosionRain pause | after | 181.0 / 269.1 | 181.0 / 269.1 | — | 181.0 / 269.1 | 4513.4 / 4513.4 |
| creaseShade cold-gate | after | 46.0 / 64.5 | 46.0 / 64.5 | — | 46.0 / 64.5 | 3983.9 / 3983.9 |

Pixel change and freshness are separate observations. For example, candidate
continuous Rain input 19 has whole-current coverage at **257.3 ms**, but that
paint has **zero changed pixels**; its first changed paint arrives at
**407.4 ms**. Both endpoints remain in the report. The numerical example and
all censoring counts are retained in the metrics. This explains why the
first-changed p95 can exceed whole-current p95 without relaxing either test.

Rain's first-changed p95 improves **408.4 → 374.0 ms** continuously and
**312.5 → 269.1 ms** with a pause. The first-changed goals remain unmet.
Cold-gate whole-current remains below 100 ms (**59.6 → 64.5 ms**), while
its first-changed median regresses (**20.6 → 46.0 ms**); the final throughput
gain is not presented as a gain at every endpoint.

| Build | Largest phase rAF p95 | Longest queue wait | Longest submission | Time-slice wait max | Handler max | Bitmap-copy max | Peak terrain MiB | Wholly off-screen / mixed GPU max |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| before | 16.8 | 85.0 | 82.6 | 18.0 | 0.7 | 0.2 | 511.5 | 53.8 / 4179.2 |
| after | 16.8 | 85.3 | 82.6 | 27.5 | 1.6 | 0.2 | 508.8 | 32.9 / 3898.3 |

No long task over 50 ms is observed. One specialized set builds in each final
run; these warm-driver-cache compiles are **46.5 / 41.8 ms** before/after.
The off-screen columns are largest individual phase totals, in milliseconds;
mixed-region work cannot be assigned exactly to visible pixels. The compact
metrics retain handler callee times, frame distributions, GPU pass/submission
costs, memory, bitmap copies, pipeline details, Time-run distributions, and
iteration-batch counts. The larger Time batches remain below 100 ms per submission
in these samples; this does not establish that bound on other devices.

## Quick correctness and remaining work

Twenty focused CPU checks and the world-name gate pass. Three coarse Time
buffer probes (Rain 1.1, 1.2, 1.1) match the baseline byte for byte, including
the repeated Rain value. A stale-request proof cancels after the third
submitted iteration slice and enqueues **no fourth slice**. There are no GPU
validation errors in those completed checks.

The final 256×256 windows at (256,512) on Green Modern 2, Red 3, and Green 7
match the recorded baseline hashes exactly. The final candidate's full Chrome
viewport matches a fresh recipe replay: **zero of 1,769,472 pixels changed**.
The compile-delay proof also returns identical final pixels after eviction.
No shader, sampling formula, Time age, or acceptance threshold changed.
The numerical evidence is retained; raw outputs are deleted after reading.
No benchmark was added to `repro/check.sh`.

Rain remains limited by a complete coarse Time refresh and picking up the
latest value on the next refresh. The first response and whole-current target
are still open. This work also does not close default-budget or other-scene
performance, the earlier coarse-contour quality decision, cold allocation
seeds, tail readback validation, or Safari/iPad checks. The optional cheaper
raster has not been started. Broader correctness and export sweeps remain
deferred; the checks above stayed targeted.
