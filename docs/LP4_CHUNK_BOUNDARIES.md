# LP4 cancel obsolete chunks between bounded stages, November 14

Large finer pieces now submit their solid/wear work separately from the
geometry draw, draining and checking for new input between them. Current
request checks also run before each voxel piece and after its allocations
and count delivery. The focused paused Rain pair reduces the longest GPU
submission **120.1 → 70.3 ms** and queue wait **140.6 → 90.2 ms**, with
identical final pixels. Native 256-pixel tiles and coarse first pictures
keep their combined submission. [Evidence](LP4_CHUNK_BOUNDARIES_METRICS.json).

## Boundaries and ownership

The canvas forwards its existing abort signal and obsolete-request check
through the chunk draw. No new input model, scheduler flag, shader, format,
render size, budget or terrain formula is introduced. Geometry validity is
cleared before allocation can yield. A canceled chunk records the queue
completion as its predecessor, so the next tile drains already submitted
work before recycling workspace. Abandoned voxel resources are released;
no partial image reaches presentation or the color cache.

A finer piece with more than 131,072 raster pixels splits solid/wear from
geometry. It awaits completion and one input turn, then checks currency
before drawing. The operations, dispatches, uniforms and their order remain
the same. This is a measured size guard, **not** the plan's future adaptive
milliseconds-per-pixel sizing. Wear and solid remain together because their
sampled combined submission is already short; this does not establish a
universal submission bound across devices or extreme settings.

The initial trial split coarse pictures too. It bounded the queue but made
sampled drag/resume p95 120/112 ms versus 105/101 ms. That version is
rejected. Keeping the already-short 4+ lattice pictures together removes
that extra wait; native/finer large work still gets the boundary. The
trial's two alternating Rain pairs and stroke pair remain in the JSON.

## Focused final-source pairs

Chrome 157, Modern Green 2/map16, 1728×1024 at (0,300), 2048 MiB, versus
79d30e0c. Own servers and unique CDP ports; discarded fresh-server warmups,
process checks and three driver GPU samples ≤20% before each run. The final
Rain pair is candidate/base, and the short stroke pair base/candidate.
Rain has 36 real mouse values per drag; the pause is about one second.
Times below are ms; p95 except single release/load observations.

| Endpoint | 79d30e0c | Bounded finer chunks |
| --- | ---: | ---: |
| Load: longest GPU submission / queue wait | 119.2 / 139.3 | 69.4 / 89.2 |
| Load → native final | 2603.9 | 2602.6 |
| Continuous Rain: changed pixels / whole-current | 94.5 / 94.5 | 93.0 / 93.0 |
| Continuous Rain: release → final | 2458.0 | 2400.3 |
| Paused Rain: changed pixels / whole-current | 94.8 / 94.8 | 96.5 / 96.5 |
| Paused Rain: longest GPU submission / queue wait | 120.1 / 140.6 | 70.3 / 90.2 |
| Paused Rain: release → final | 2403.1 | 2413.9 |
| Drag: first tile / pointer tile / whole-current | 93.1 / 116.8 / 116.8 | 91.9 / 111.3 / 111.3 |
| Drag: release → final | 2473.4 | 2471.7 |
| Resume: first tile / pointer tile / whole-current | 94.9 / 94.9 / 94.9 | 95.5 / 95.5 / 95.5 |
| Resume: release → final | 2445.4 | 2455.3 |

**Measured:** paused maximum submission falls 41.5%, queue wait 35.8%.
Final cost is effectively flat in these pairs: Rain −2.3% / +0.4%, stroke
−0.1% / +0.4%, load −0.05%. Peak Rain GPU ledger remains **1303.6 MiB**.
Frame p95 remains 16.7–16.8 ms and slider phases record no long tasks.
All original first-tile, pointer-tile and whole-view endpoints, changed
pixels, native quality, handler/callee, copy, GPU-pass, pipeline, memory and
off-screen-work summaries remain separate in the JSON, with p50/p95 and
censoring. No off-screen scheduling improvement is claimed.

The fixed-100-ms resume still does **not** satisfy LP4's Time-in-flight
precondition on either build: dirty final tiles remain but no Time slice is
active. Its measured first new-stroke preview is 73.1 → 56.2 ms, one sample
per build; this is not a qualifying-resume speedup or a statistical bound.
The drag's first new-stroke preview is 79.1 → 80.4 ms. The broader stroke
100-ms tail remains open despite the bounded large submission.

## Quick correctness

Each completed page run replays its final 1,769,472-pixel viewport exactly.
The final Rain hash is identical to 79d30e0c, not only to its own cold replay.
The pixel check runs after the workload sequence, not after every input.

The on-demand single-fixture `repro/voxel-cancel.mjs` checks two actual GPU
boundaries at native 512 pixels: cancellation after count delivery queues
no solid, and cancellation after solid completion queues no geometry or
presentation. All **8 / 10** owned allocations retire exactly once, the
readback is unmapped, geometry is invalid, and the next native tile matches
the original SHA-256 exactly. No browser or GPU errors occur. This protects
the new cleanup/drain path without an all-scene sweep or a new quick-runner
benchmark. The final fast unit runner and world-name gate pass.

This adds no observed art movement. All 41 regenerated authored preview PNG hashes match the preceding bundle
exactly. The fresh receipt is pinned as `previews-36f2d2e215a88130`. The compact sampler's earlier
visual review, adaptive time-based sizing, more devices/fixtures, a
qualifying Time-in-flight resume and complete LP4 acceptance remain open.
