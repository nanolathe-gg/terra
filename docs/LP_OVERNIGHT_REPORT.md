> **November 13 landing update:** The owner accepted the measured final-render
> slowdown and authorized merging the native preview without additional tests.
> Main now includes the LP2 implementation and LP3 step 1 with the foundation.
> [Current status](LIVE_PREVIEW_REVIEW.md) lists remaining work. The dated
> measurements and decisions below are historical.

# Overnight live-preview landing, November 13, 2026

The completed checkpoint contains **LP0c, LP4 step 1 and LP1**, integrated
with main `222ace7a`. The timed engine checkpoint is `fd7f8139`; benchmark
correction `36bd7c53` changes only the load marker. The broader native
preview remains on **`live-preview/review`**. No LP2/LP3 acceptance or
completion of the remaining LP4 steps is claimed.

**Measured in Chrome 157 / Apple M3 Pro, 18 GiB.** Two alternating pairs
per fixture, `green-modern-2` and `green-7`, map16, 1728×1024 terrain pixels,
with the unchanged **512-MiB default on both builds**. Eight full sessions
and eight load-only sessions passed the quiet-start guard; server warm-ups
were discarded. Summary p95s use the larger per-run p95; final medians average
the two endpoints. Five slider rows use real mouse drags; Colors uses the
owner-approved scripted picker workload. The full phase distributions,
all three stroke latency measures, handler callees, frame intervals,
long tasks, queue waits, pipeline counts, bitmap copies, memory and
outside-view GPU work are in [the timing appendix](LP_FOUNDATION_TIMINGS.md).

| Large cliff fixture, ms | Main before | Completed checkpoint |
| --- | ---: | ---: |
| Stroke: first changed pixels p95 | 39.7 | 81.9 |
| Stroke: first tile p95 | 39.7 | 58.1 |
| Stroke: pointer tile p95 | 1559.4 | 963.8 |
| Stroke: whole view current p95 | 7739.3 | 3791.0 |
| Continuous rock row: whole view p95 | 6627.6 | 4243.3 |
| Stroke release → final, median | 5829.6 | 3041.7 |
| Load → whole view p95 | 2137.5 | 822.0 |
| Load → final, median | 7403.9 | 3686.5 |

That is **51% less whole-view stroke latency**, **48% less stroke final
time**, and **50% less load-to-final time** on this cliff fixture.
Larger tiles make the first rock change slower (58.6→111.4 ms at p95)
while bringing the whole view current sooner. Editing still takes seconds
to make the whole view current; near-instant view blocks belong to LP2.

Across these two focused fixtures, the longest Time GPU submission falls
**433.0→18.0 ms**; the longest queue wall wait falls **447.8→106.1 ms**.
The 100-ms resume workload has Time and dirty finals in flight in every
run. Its first changed stroke picture is 137.9–146.8→23.4–28.9 ms on the
cliff, and 204.5–254.2→18.4–22.9 ms on flat Green. No drag long task was
observed. Peak accounted terrain GPU memory is 481.6 MiB. These figures
are measurements, not estimates of driver residency.

Flat-map final-cost medians increase by at most **4.5%**, within the
unchanged 10% guard. Both measured fixtures pass that guard phase by phase,
including the corrected load measurements. This is a focused completed-card
comparison, not LP2’s full twelve-fixture acceptance matrix. The largest
remaining measured GPU submission is **103.2 ms**; the 100-ms global target
and the later LP4 work remain unfinished. Main-thread input batching,
adaptive 2048-MiB memory, coarse Time and final-quality color reruns also
remain outside this checkpoint.

**What changed.** View tiles stay 256 pixels when the actual budget permits;
export keeps its canonical trial. A knob crossing an export-size threshold
preserves view images, and budget probes cannot evict an active draw’s
textures. Regional UVs split on the global lattice before subtracting a
tile origin, fixing the one-pixel dependency without a tolerance. Time
runs in interruptible batches with a private world snapshot and cancels
obsolete requests. One world-uniform writer and shader-derived stage data
replace overlapping writers and blanket invalidations. Time initialization
also stops uploading into a paused draw’s shared uniform buffer.

**Measured correctness.** The clean landing tier passes: **221 unit tests,
zero skips**, all-scene comparison, regional replay, voxels, nine-world
smoke/export, paged smoke, features, passability and shape repeat. All
34 height files match main byte for byte. Exactly the previously approved
six RGB pixels move: Green 2 (3), Green 5 (2), modern Green 2 (1). The
original unchanged Green 2/map16 tile-size test compares full 1024×1024
windows at 128/256/512 pixels and repeated 256: **zero mismatches**.
No test tolerance was increased. The sampled Green 2 before/after render
is visually unchanged **[by eye]**.

The current 130-state CPU uniform comparison is exact. An injected Time
request during voxel readback changes zero pixels; the 256×256 reference
hash remains `6f1687a4…`. A complete **1,769,472-pixel** viewport after edits
matches its cold recipe replay exactly, SHA-256 `ed7bd44f…`. Green 4,
Lava 8 and Red 16 default exports each match between two Wasm passes and
the native exporter, for both archive and indexed PNG. Their full hashes
also match the prior validated export proof. No long control sweep or
full tier was run; the owner requested focused, fast correctness checks.

**Why native preview did not land.** Candidate `fe03c540` answers the flat
map’s whole-view stroke in 37–39 ms at p95, but its two-pair cold-gate
final median is **1340.25 ms versus main’s 1216.10 ms (+10.21%)** at
2048 MiB. The limit is 10%; it was not relaxed. The native full matrix
stopped at that fixture. All native implementation and its exact final
proof remain on the single review branch, documented there in
`docs/LP2_PROGRESS.md`. Its Safari memory probe stays explicitly deferred.

The browser exposed waits that static Node passes could not measure:
real input handlers, display-frame scheduling, page preparation, repeated
canvas composition and allocation-scope waits. The original Chrome
baseline is [LP0](LP0_REPORT.md); the completed cards’ detailed proofs are
[LP0c](LP0c_REPORT.md), [LP4 step 1](LP4_STEP1_REPORT.md) and
[LP1](LP1_REPORT.md). Raw runs and pictures are removed after reading;
compact numerical evidence and hashes stay outside the repository.
