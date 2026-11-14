> **November 14 approved landing:** the owner authorized merging the reported
> review branch through e1476192. The compact sampler's measured pixel changes
> and Rain's 8–11% final-cost tradeoff are included in that approval. Main had
> not moved; the rendering source and pinned previews are unchanged from the
> checked build. [Landing record](LP_NOV14_LANDING.md). Earlier branch/review
> statements below describe the checkpoint before this approval.

# Live preview overnight checkpoint, November 14

The owner-approved LP5 cache, mask packing and coarse-preview lifetime work
is landed and pushed on **main a14c48c3**. Its deployment checks passed.
All newer work is together in **live-preview/lp6**, based on that main; no
old rewritten ancestry was merged back. Remote main was still a14c48c3 at
this checkpoint. The new branch work awaits visual review of the compact
sampler before landing. Its main and review states are intentionally distinct.

## Measured improvements on the review branch

| Focused case | Earlier build p95 | Review branch p95 | Scope |
| --- | ---: | ---: | --- |
| Modern Green/map16 Colors, native whole-current | 2012 / 1416 ms | 165 / 120 ms | One direct-main continuous/pause pair, before the final scissor unit |
| Modern Green/map16 Colors after viewport scissors | Previous unit 114–136 ms | 110–142 ms | Two alternating pairs, 1728×1024; first change <36 ms |
| Red/map16 Colors, native whole-current | 1754 / 1175 ms | 140 / 118 ms | One direct-main continuous/pause pair |
| Green 7/map4 Colors, native whole-current | 1171 / 612 ms | 65 / 55 ms | One direct-main pair at the baseline view |
| Modern Green/map4 Rain, any-level whole-current | 1824 / 1020 ms | 98 / 92 ms | Final-source continuous/pause pair, 1728×1024, 2048 MiB |
| Modern Green/map4 Rain, release-final | 2031 / 2023 ms | 2254 / 2192 ms | Same pair: +11.0% / +8.3%, responsiveness tradeoff |
| Modern Green/map16 Rain, any-level whole-current | 92 / 94 ms | 92 / 94 ms | Final-source paged regression pair |

These are selected Chrome 157 measurements on this machine, with own
servers/CDP ports, discarded fresh-server warmups and quiet-start checks.
They are not a full scene/device matrix or a universal deadline guarantee.
All endpoints, censoring, rAF, handlers/callees, queue/GPU, copy and memory
measurements remain in the linked reports. Colors uses the owner-approved
scripted picker workload; the named sliders and strokes use real mouse input.

## What changed

- [Compact regional inputs](LP5_COMPACT_INPUTS.md) replace padded texture
  allocations and stabilize tile interpolation. All 35 native records fit
  at the default view; [exact grid packing](LP5_GRID_INPUTS.md) also fits
  40 records after a half-tile pan at the unchanged quota. Release-final
  drops from roughly 0.8 s to tens of milliseconds for cached color edits.
- [Fair scheduling](LP5_FAIR_COLOR.md), [continuing safe F sweeps](LP5_COLOR_SWEEPS.md)
  and [bounded four-tile batches](LP5_COLOR_BATCHES.md) keep new inputs from
  restarting work at the same tile. [Viewport scissors](LP5_VISIBLE_COLOR.md)
  shade only visible native F pixels, with explicit partial-image coverage
  and exact pan/zoom replay. A larger eight-tile batch was rejected.
- [Bounded finer chunks](LP4_CHUNK_BOUNDARIES.md) stop obsolete work after
  counts, solid completion and between pieces. The final focused Rain pair
  bounds its longest load/paused submission at 69–70 ms instead of 119–120 ms;
  the 193 fast tests and exactly-once GPU cleanup checks pass.
- The bench now separately measures [native final quality](LP5_FINAL_QUALITY_METRIC.md)
  and [actual view weather epochs](LP3_VIEW_READY_METRIC.md). Neither change
  relaxes a deadline or hides missing/stale coverage. A formerly passing
  coarse color result correctly became a 1.52-s native-quality failure.
- [Shared immutable shape pipelines](LP3_SHARED_SHAPE.md) remove 140/280
  repeated shape-pipeline API calls during sampled Rain phases.
- [Small-map coarse Time and submission priority](LP3_SMALL_MAPS.md) remove
  the whole-map native Time wait from the first answer. Idle workspace
  reclamation reduces the corrected 512-MiB probe from 655.1 to 498.7 MiB.

## Correctness and review limits

The fast runner passes **193 tests** plus the world-name gate. Scoped GPU
checks keep exact partition/cache/full-bake comparisons, native Time's four
buffer hashes, cancellation ownership and replay. Green 2 and Modern Green
map16 each have zero differing pixels in strict 128/256 tile comparisons;
the original one-pixel case is covered without increasing tolerance.
Viewport clips, fractional zoom, C/B interruption, memory lowering and one
regional replay were checked. Individual completed page runs replay their
final view exactly; this is not a pixel test after every input. No broad
all-scene, control, export or cross-device sweep was repeated.

**Visual review remains:** explicit interpolation moves 8416 of 1769472
pixels (0.476%) in one large Modern Green view, with a maximum channel
change of 220 near thresholds. Small view/export-art crops also move some
pixels. By eye their broad forms and material character remain intact.
Same-build determinism and regional equality stay exact. Later scheduling,
packing and Time-priority units add no observed final-art movement. The
owner has not reviewed the new sampler; this branch has not been landed.

**Still unfinished:** universal 100-ms Rain (earlier pairs reach 109 ms),
the 150-ms color target with partial caches/other devices, initial cold
compilation, final focus deadlines, the earlier coarse-contour outlier,
strict load-memory containment across devices and the full matrix. One
paged refinement chunk submitted 120.6 ms of GPU work and waited 141.1 ms
on the queue at the preceding checkpoint. The [bounded-stage follow-up](LP4_CHUNK_BOUNDARIES.md) reduces that sampled paused submission to 70.3 ms and queue wait to 90.2 ms, at effectively flat final cost. It keeps coarse first pictures combined; the broader submission bound and adaptive sizing remain open. The fixed-100-ms small-map resume did not catch Time in flight;
a separate observed-native-flight mouse check canceled in 15.5 ms and
replayed exactly, without being claimed as qualifying resume timing.
Safari/iPad checks remain deferred by the owner.

All 41 preview PNGs were regenerated from the frozen source and published
as [previews-a2de09dd4eeae531](https://github.com/nanolathe-gg/terraform/releases/tag/previews-a2de09dd4eeae531). All file hashes change; decoded pixels move
30,696 / 9,830,600 (0.312%). By eye, the inspected Green world/hill thumbnails
keep their form and texture character. The runtime manifest is unchanged.
The later bounded-stage receipt is pinned as
[previews-36f2d2e215a88130](https://github.com/nanolathe-gg/terraform/releases/tag/previews-36f2d2e215a88130); all 41 PNG hashes match a2de exactly.
Freshness, publication, fetch and PNG/manifest checks pass. Raw timing outputs
and Chrome profiles are disposable outside-repository files; compact
measurements stay in these reports. No benchmark was added to the quick runner.
