# LP5 keep native color sweeps moving, November 14

A fully cached F sweep now continues across further F inputs, snapshots each
job's actual revision, and paints a safely completed native rectangle even
if another color input arrived. The redundant task between native jobs is
removed; each next job still awaits the preceding GPU completion. In the
focused pair, native-quality input p95 is **160 / 116 / 138 ms** for
continuous/pause/cold-gate workloads, versus **213 / 201 / 134 ms**.
Continuous still misses 150 ms, and cold-gate p95 is slightly worse in this
pair. This follows 9c807b05 on the same review branch; main stays a14c48c3.
[Evidence](LP5_COLOR_SWEEPS_METRICS.json) preserves the pairs, trials and
quick interruption/replay checks.

## Work and cancellation

Further color input leaves immutable C/E records valid. The loop now
rechecks that every visible record is valid at both boundaries instead of
stopping for a new animation frame after each input. Each F job records the
serial and stage revisions at its own start, not the frame's older token.
Partial coverage, geometry/Time input, navigation, level changes and busy
state still stop/replan through the existing guards.

While this complete-cache path runs, no newer coarse block is painted.
Its finished tile can update just its own rectangle even if newer F input
has made it dirty. Earlier-stage results retain the existing composition
and clipping rules. Continuous ambient paint calls fall **1090 → 703**
while F calls are 613 → 634: avoiding repeated unchanged copies is the
purpose, not reducing the number of useful tile updates.

Zero-delay timers can inherit a [four-ms nesting clamp](https://html.spec.whatwg.org/multipage/timers-and-user-prompts.html#timer-initialisation-steps).
A MessageChannel-yield trial remained near the target and added a resource
without removing the redundant wait. It was discarded. The retained loop
uses the existing GPU-completion/snapshot yields; it neither grows the GPU
queue nor changes shaders, image values, ownership, cache limits or controls.
The [queue-completion contract](https://www.w3.org/TR/webgpu/#dom-gpuqueue-onsubmittedworkdone)
is unchanged. There is no new scheduler switch or browser-specific path.

## Focused page pair

Chrome 157, map16 Modern Green 2, **1728×1024 at (0,300)**, 2048 MiB.
Own servers and unique CDP ports, discarded fresh-server warmups, alternating
builds, process checks and three consecutive driver GPU samples ≤20% before
runs. One retained implementation/baseline pair; each real mouse drag has
36 values. Times are ms, p95 unless specified.

| Endpoint | Previous native scheduler | Moving sweep |
| --- | ---: | ---: |
| Continuous: first changed pixels | 12.5 | 10.2 |
| Continuous: native whole-current | 213.1 | 159.9 |
| Continuous: release → final | 81.5 | 58.4 |
| Pause: first changed pixels | 12.7 | 8.7 |
| Pause: native whole-current | 201.0 | 116.4 |
| Pause: release → final | 93.9 | 59.4 |
| Cold gate: first changed pixels | 14.9 | 19.8 |
| Cold gate: native whole-current | 133.5 | 138.1 |
| Cold gate: release → final | 77.0 | 61.6 |

**Measured:** native-quality p95 changes −25.0%, −42.1%, and +3.4%.
Release-final changes −28.3%, −36.7%, and −20.0%. Any-level whole-current
is the same native coverage in this complete-cache path. Every input and
pause/release anchor completes without censoring. All p50/p95 endpoints,
including first tile and the empty slider pointer-tile sample set, are kept
separately in the JSON. First-change p95 remains under 50 ms; this single
pair does not establish complete LP5 acceptance or a cross-device bound.

Memory is unchanged at **1316.6 MiB peak GPU ledger**, with 35 native
records plus the coarse record. Continuous queue/submission maxima are
19.8/4.4 → 11.7/4.4 ms. Frame p95 stays near 16.7 ms, no long task exceeds
50 ms, and no pipeline call or specialized set occurs during input.
Load final is 2659.1 → 2703.9 ms (+1.7%), not a measured load improvement.
The initial sweeps remain variable; all candidate/baseline timing results,
including continuation-only and MessageChannel trials, are retained.

## Quick correctness and stroke check

- Each completed slider run finishes with a viewport identical to cold recipe
  replay: **zero differing pixels**, same hash as 9c807b05. The pixel check
  runs after the workload sequence, not separately after every phase.
- A scripted page check interrupts the first native F call during its wait,
  first with Relief amount (C), then with Rain (B). All old records retire,
  the view completes without browser errors, and the final picture equals
  an evicted cold recipe replay exactly. These are correctness inputs,
  not mouse-latency measurements.
- Lowering memory then frees all F records immediately. After idle the page
  uses **495.6 MiB within 512 MiB**, with no retained color cache.
- Since the inter-tile yield is shared, one short alternating real mouse
  stroke/release pair was run at the same large view. Drag p95 first tile /
  pointer tile / whole area is **97.8 / 111.5 / 111.6 → 94.7 / 118.6 /
  119.1 ms**. Release-final is **2478.2 → 2522.1 ms (+1.8%)**. Both final
  replays are exact. No stroke speedup is claimed; its existing deadline
  gaps remain open.
- Eighteen relevant coverage, invalidation and preview-plan CPU tests pass
  in 43 ms, with syntax/diff checks. Unchanged shader, regional-tile and
  export-art checks were not repeated. No broad suite was added or run.

No additional art movement is introduced. The compact sampler's visual
review, wider-device measurements, partial-cache native quality and cold
shader startup remain open. The remaining complete-cache tail includes
per-tile queue completion waits; a small bounded number of outstanding F
submissions is the next experiment. This source stays on the review branch.
