# LP3 answer small-map Rain before native Time, November 14

Nonpaged maps now use the same coarse shape/Time lattices as paged maps.
Native whole-map Time waits at submission boundaries while a coarse picture
is being prepared. A current coarse picture stays visible until canonical
weather is ready, instead of being covered by finer images using old weather.
The shaders, native Time operations and export source remain unchanged.
[Evidence](LP3_SMALL_MAPS_METRICS.json) preserves both builds' endpoints and
focused correctness checks. This follows the separate shared-pipeline unit.

## Measured response and cost

Chrome 157, Modern Green 2, map4, 1728×1024 terrain at (0,300), 2048 MiB.
Own servers/CDP ports; fresh-server warmups discarded, process lists checked,
three driver GPU samples ≤20% before each run. Each slider drag delivers 36
real mouse inputs, with a one-second pause in the pause scenario. Comparison
is 0f44fa52 with the corrected view-coverage bench, not an older readiness
metric. Two alternating pairs before workspace reclamation, followed by a
final-source pair, are retained. These are focused runs, not the full matrix.

The first two pairs reduce Rain first-changed/whole-current p95 from
**1797–1873 / 1076–1077 ms** (continuous / pause) to **96–109 / 94–109 ms**.
The whole-current answer is the approved 8-pixel first picture, refining
automatically to 4-pixel and native. The unchanged 100-ms target remains
narrowly missed in some phases. Final native quality still takes seconds.

Prioritizing the preview costs **+7.8–13.0%** in those release-to-final
observations: 2069–2154 → 2291–2338 ms. No final-render speedup is claimed.
The final-source pair measures **1824.2 → 98.4 ms** continuous and
**1020.2 → 91.7 ms** paused, meeting 100 ms in this one pair. Release-final
is **2031.0 → 2253.6 ms (+11.0%)** and **2023.4 → 2191.5 ms (+8.3%)**.
Load-final is 2188.8 → 2250.7 ms (+2.8%). All load/input/release p50/p95
values are in the JSON, including first tile, pointer tile, changed pixels,
any-level whole view and native-quality whole view separately. Slider pointer-tile samples
are empty because input occurs in the panel. Cold-gate F is a separate
workload; its first two candidate whole-current p95 values are 135 / 107 ms.

Frame p95 remains near 16.7 ms; no slider-phase long tasks were recorded.
The first two candidate Rain runs have maximum queue waits around 59 ms.
Shared shape pipelines eliminate the previous 140/280 creation calls; one
changed-refinement pipeline is first created after the continuous preview,
none during the paused phase. This is API reuse, not a pristine-driver cold
compilation guarantee. GPU pass, queue, handler/callee, bitmap-copy, memory
and off-screen-work summaries remain separate in the evidence. Off-screen
GPU figures in mixed passes are area estimates, not isolated timer queries.

A final-source paged-map pair keeps Rain first/whole p95 effectively flat:
**92.3 / 94.2 → 91.6 / 93.9 ms** (continuous / pause), release-final
2439 / 2462 → 2434 / 2435 ms. Both replay exactly. Its paused phase still
contains a **120.6-ms chunk submission / 141.1-ms queue wait**, so the
all-submissions-under-100-ms LP4 target is open. The timestamp breakdown points to native geometry and voxel work for
that outlier; Time's own sampled submissions stay below 24 ms.

## Priority, visibility and memory

Each native Time submission checks the optional priority boundary and then
checks staleness again. Inputs cancel it after already submitted work drains.
This does not reorder any native compute operation. Requests wait before
allocating native scratch as well. Under memory pressure, idle renderer and
lattice workspace is reclaimed first; copied current images own independent
pixels and remain visible. The planner also respects the device's storage
buffer binding limit instead of accepting an oversized geometry record.

Only display-only coarse work gets priority: quarter/native jobs can depend
on canonical weather and must not hold its producer. Whole-map refinement
waits for fresh canonical Time; paged feeds retain their on-demand preparation.
Native-cache validity, foreground readiness and coarse clipping now check
weather epochs explicitly so an old native image cannot hide current coarse
weather merely because its input serial is newer.

The corrected map4, 512-MiB probe exposed a **655.1-MiB** transient peak.
Reclaiming optional workspace before native allocation reduces it to
**498.7 MiB**, with final 431.6 MiB, identical final replay and no errors.
These are application GPU-ledger values, not physical browser memory. The
probe keeps the 512-MiB limit unchanged. Its URL and nonpaged storage are now
asserted: the earlier helper accidentally inherited map16. The previous
shared-pipeline report has been corrected to label that earlier result as
paged, not as evidence about small maps. Timed map4 runs used the right map.

## Quick correctness and limits

- Each completed measured slider run ends with zero replay differences over
  1,769,472 pixels; the Rain fixture hash is unchanged from 0f44fa52. The
  pixel comparison runs after the whole workload sequence, not after every
  phase or input.
- Native Time at grid 1168/age 200/rain 1 retains all four exact buffer
  hashes while priority GPU work runs between slices. Eleven submissions
  each pass the priority boundary. A request made stale there submits zero
  work and destroys every owned allocation once. This on-demand proof is
  `repro/time-priority.mjs`; it is not added to the quick runner.
- A real mouse stroke begun after observing native Time in flight cancels
  that stale native request in **15.5 ms**, then finishes and cold-replays
  exactly. This is a targeted correctness check, not a latency benchmark.
- The fixed 100-ms resume pair is retained honestly: the candidate has
  pending weather/final tiles, but no Time slice in flight at 100.3 ms.
  Its coarse Time already finished, so it does **not** satisfy the qualifying
  Time-in-flight resume condition. Candidate/base resume first-tile,
  pointer-tile and whole-current p95 are 95.2 / 91.4 ms; finals are
  2409.5 / 2572.9 ms. No qualifying-resume speedup is claimed. Ordinary drag
  first/pointer/whole p95 is 92.0/110.1/110.2 versus 95.3/97.2/97.2 ms.
- One authored regional replay reports zero mismatches in all 33 planes.
  The fast unit runner and world-name gate pass; syntax/diff checks pass.
  No broad scene, control, export or device sweep was repeated.
- **By eye:** the actual map4 8-pixel picture preserves the broad cliff and
  pool layout while dropping cracks, vegetation and small edges. It is an
  interaction answer, not a final-quality or quantified contour proof.

This unit adds no observed final-art drift. The earlier compact interpolation
change still moves 0.476% of one large view and awaits the owner's visual
review on this branch. Universal 100-ms Rain, all native submission bounds,
the earlier contour outlier, strict load containment across devices, Safari
and the broader acceptance matrix remain unfinished.
