# LP3 far-view memory and preview readbacks, November 13

This follow-up stays on `live-preview/review`, based on main `f41ff288`.
It makes no main merge; unrelated main work advanced during this session.
The changes are `d3071a9a` (memory planning), `b352f9c0` (predicted pools),
and `0e692149` (on-demand measurement and proof). The comparison below is
against the previous branch tip, `e4ca918f`, which already has regional
coarse shape and Time lattices. It is not another comparison against main.

**Measured:** the far 1728×1024 map16 view at 512 MiB now refreshes in one
coarse block instead of two to four. Stroke whole-current p95 is **101.6 →
96.9 ms**; the qualifying Time-in-flight resume is **448.1 → 130.3 ms**.
The resume still misses 100 ms. These are one pair's results, not a completed
LP3 acceptance matrix or an isolated readback speed measurement.

## Changes and allocation proof

The source planner uses the same feature-aware scratch calculation as the
allocator. A graph without coast passes reserves three scratch planes;
a coastal graph also reserves its fourteen planes and site list. Prepared
geometry is shared by planning and submission, including across asynchronous
initialization. Conservative reserves cover request uniforms and uploads.
Actual buffer peaks in three small plain/coastal probes stay below their
estimates: **8.04 / 8.46**, **4.34 / 4.77**, and **9.73 / 10.20 MiB**
(actual / planned). This changes the reservation, not the shape formulas.

An idle canonical gather cache can be reclaimed before splitting a coarse
view. Outstanding feed leases prevent its destruction. A graph that grows
while the prior submission drains is checked again before source allocation;
if necessary it replans while retaining visible images. The fast lease proof
reclaims **54,740,000 bytes** only after release, including a double-release
check.

The untimed far-view proof translated the authored Green Modern 2 fixture
by (2048,2048), with its terrain view at (2048,2300). Both Rain refreshes
use one globally aligned **1728×1088** coarse block; its 641×536 renderer
input starts at coarse-grid origin (343,390). Accounted peak is **511.3 MiB**;
there is no error banner, console error, or final Rain-round-trip pixel change.
In the timed pair the overall peak is **511.5 MiB in both builds**, while
stroke peak falls **510.2 → 498.7 MiB**. These are application-accounted
terrain resources, not whole-device or driver allocations.

Warmed preview pools use the last count for their step/column dimensions,
times 1.5, bounded by the conservative brick capacity and memory budget.
They submit solid, wear, and draw work before count delivery. The GPU rejects
unused dispatches and an undersized pool; validation finishes before
presentation. Overflow drains the rejected work, then retries with the exact
count. Cold geometry and a prediction that exceeds the budget still use an
upfront exact count. Finals retain exact allocation. This removes the warmed
pre-draw allocation bubble, not every readback or the presentation validation.

A 100-ms delayed-delivery proof confirms the draw submits while delivery is
pending and no presentation submits before validation. Normal prediction and
a forced undersized pool both reproduce the bootstrap picture exactly:
**zero changed pixels**, SHA-256
`d8de0c23e54ba97b07849a30abefd03492c3ae196423fe3df8511b8a905af835`.
The Chrome stroke uses **31 predicted pools and one seed**; resume uses
**26 predicted pools and no seeds**. Neither overflows. The stroke's remaining
pre-draw wait totals 15.5 ms for its seed; resume has zero. Post-draw validation
waits total 425.9 and 373.4 ms across their refreshes, overlapping submitted GPU
work; these totals are not time saved.

## Focused Chrome comparison

Chrome 157.0.8103.78; map16, GPU budget 512 MiB, terrain 1728×1024 at
(2048,2300), the translated authored fixture above. Fresh-server warm-ups were
discarded. The retained order is after, before; each checked `ps` and passed
three consecutive driver-utilization samples at or below 20%. A prior attempt
that overlapped another agent's GPU study was discarded. A quiet start does
not establish quiet utilization throughout a five-minute run. No repeat was
added after load rose again. The optional allocation microbenchmark was
deferred after 30 seconds at 60–92% utilization.

The retained timing preceded an overflow-only queue-drain safeguard and a
128-entry bound on preflight rejection history. No measured preview overflowed;
the quick proofs below use the committed code. The benchmark adds `--origin`
and phase allocation counters without changing endpoints or coverage rules.

Times are **p50 / p95 ms**. Each release-to-final column has one completed
endpoint. Mid-drag pauses that did not reach final remain censored in the
[compact metrics](LP3_MEMORY_READBACK_METRICS.json). Pointer tiles are absent
for controls outside the terrain. First changed is measured separately from
first tile, pointer tile, and the union of painted current coverage.

| Phase | Build | First changed | First tile | Pointer tile | Whole current | Release → final |
| --- | --- | ---: | ---: | ---: | ---: | ---: |
| load | before | 153.2 / 153.2 | 153.2 / 153.2 | — | 153.2 / 153.2 | 6274.6 / 6274.6 |
| drag | before | 72.1 / 101.6 | 18.0 / 100.5 | 72.1 / 101.6 | 72.1 / 101.6 | 5590.0 / 5590.0 |
| release | before | 21.1 / 21.1 | 15.2 / 15.2 | — | 5590.0 / 5590.0 | 5590.0 / 5590.0 |
| resume | before | 109.0 / 259.8 | 109.0 / 259.8 | 109.0 / 259.9 | 296.4 / 448.1 | 5314.4 / 5314.4 |
| faceBlockSize continuous | before | 40.5 / 73.4 | 40.5 / 73.4 | — | 40.5 / 73.4 | 5363.9 / 5363.9 |
| faceBlockSize pause | before | 58.0 / 209.2 | 58.0 / 209.2 | — | 71.7 / 397.3 | 4979.1 / 4979.1 |
| erosionRain continuous | before | 129.4 / 172.8 | 129.4 / 172.8 | — | 894.9 / 1461.2 | 5573.0 / 5573.0 |
| erosionRain pause | before | 140.1 / 190.5 | 140.1 / 190.5 | — | 568.4 / 879.1 | 5453.0 / 5453.0 |
| creaseShade cold-gate | before | 45.3 / 65.9 | 45.3 / 65.9 | — | 45.3 / 65.9 | 5057.7 / 5057.7 |
| load | after | 154.4 / 154.4 | 154.4 / 154.4 | — | 154.4 / 154.4 | 6179.8 / 6179.8 |
| drag | after | 68.4 / 96.9 | 18.0 / 93.5 | 68.4 / 96.9 | 68.5 / 96.9 | 5648.0 / 5648.0 |
| release | after | 171.7 / 171.7 | 19.7 / 19.7 | — | 5648.0 / 5648.0 | 5648.0 / 5648.0 |
| resume | after | 70.4 / 130.3 | 70.4 / 130.3 | 70.4 / 130.3 | 70.4 / 130.3 | 5189.4 / 5189.4 |
| faceBlockSize continuous | after | 37.8 / 59.2 | 37.8 / 59.2 | — | 37.8 / 59.2 | 5077.7 / 5077.7 |
| faceBlockSize pause | after | 44.8 / 68.3 | 44.8 / 68.3 | — | 44.8 / 68.3 | 4824.4 / 4824.4 |
| erosionRain continuous | after | 495.9 / 842.2 | 495.9 / 842.2 | — | 495.9 / 842.2 | 7495.7 / 7495.7 |
| erosionRain pause | after | 223.6 / 312.0 | 223.6 / 312.0 | — | 223.6 / 312.0 | 5440.0 / 5440.0 |
| creaseShade cold-gate | after | 45.5 / 67.6 | 45.5 / 67.6 | — | 45.5 / 67.6 | 6971.6 / 6971.6 |

Stroke, continuous rock, paused rock, and the cold gate meet 100-ms
whole-current p95 here. Load, resume, and Rain still miss it. Paused rock
improves **397.3 → 68.3 ms**, and Rain whole-current improves **1461.2 →
842.2 ms** (continuous) and **879.1 → 312.0 ms** (paused).
Rain's first changed p95 worsens **172.8 → 842.2 ms** and **190.5 →
312.0 ms**: one larger Time window answers the entire view together rather
than showing a first partial block. Continuous Rain's source-preparation
critical path has a 472-ms p95, versus a maximum 55-ms preview renderer call.
This remains a scheduling/Time cost, and no input is credited before the
new Time result is painted.

Finals remain a tradeoff: continuous Rain is **5573.0 → 7495.7 ms (+34.5%)**,
and cold gate is **5057.7 → 6971.6 ms (+37.8%)** in this pair. The latter
records a **3166.1-ms** specialized-pipeline compile, versus **46.4 ms** before;
first final-tile start shifts **191.5 → 2063.6 ms**. Its final bake wall total
is close (**1114.4 → 1134.3 ms**). This points to compilation/start delay
rather than a proportional final-shader slowdown **[inferred]**. Continuous
Rain also spends longer preparing and baking; the run does not isolate its
cause. These results are retained, with further quiet repeats open. No new
final-slowdown acceptance is presumed from the owner's earlier main landing.

| Build | Largest phase rAF p95 | Longest queue wait | Longest submission | Handler max | Specialized sets | Bitmap-copy max | Wholly off-screen / mixed GPU max |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| before | 16.8 | 108.7 | 106.2 | 0.5 | 2 | 0.2 | 55.8 / 4003.1 |
| after | 16.8 | 133.7 | 130.8 | 0.5 | 2 | 0.2 | 52.7 / 4753.7 |

No long task over 50 ms was observed. The off-screen columns are largest
individual phase totals in milliseconds; mixed-region work cannot be assigned
exactly to visible pixels. Release-only captures are excluded from the set
count to avoid overlapping the stroke. The compact metrics retain all phases'
rAF, handler/callee distributions, queue and pass times, compilation, bitmap
copies, memory, and off-screen GPU costs. Submissions over 100 ms remain open.

## Quick correctness and remaining work

Twenty focused CPU checks and the world-name gate pass. Under Node/Dawn,
the same final 256×256 windows at (256,512) on Green Modern 2, Red 3, and
Green 7 match `e4ca918f` byte for byte, with no GPU validation errors.
The Chrome candidate's final full viewport also matches its fresh recipe
replay: **zero of 1,769,472 pixels changed**. Hashes and numerical proofs
are retained in the compact metrics. Raw outputs are deleted after reading.
No benchmark was added to `repro/check.sh`.

This closes the sampled far-view splitting issue and implements the warmed
preview allocation overlap. It does not close LP3's full scene/map/view
matrix, default-budget targets, coastal far-view memory, or the earlier
[coarse-contour quality outlier](LP3_LATTICES.md#route-and-quality-checks).
Cold bootstrap readbacks, occasional exact-budget fallbacks, and tail
validation remain. The optional cheaper raster has not been started.
Broader export/correctness sweeps and Safari/iPad checks remain deferred
at the owner's request. No main merge is included.
