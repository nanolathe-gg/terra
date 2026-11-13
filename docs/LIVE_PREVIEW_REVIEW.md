# Live-preview implementation status

Main includes the completed foundation (**LP0c, LP1 and LP4 step 1**), the
**native LP2 implementation**, and **LP3 step 1**. On November 13 the owner
accepted the measured final-render slowdown and authorized landing the
review branch **without additional tests**. No new tests or benchmarks were
run for this merge. Earlier measurements retain their original scope.

The native implementation adds whole-view preview blocks, frame-batched
control input, automatic refinement, the adaptive 2048-MiB default, working
texture reuse, generic preview pipelines and delayed off-screen finals.
LP3 step 1 uses exact-size preview input textures. The measured +10.21%
cold-gate final-cost result is accepted for this landing; its benchmark
endpoint and historical 10% target were not changed.

LP3 regional shape and Time lattices are now implemented on the unmerged
`live-preview/review` branch. [The focused report](LP3_LATTICES.md) covers
performance, memory, final-byte checks, and the sampled contour difference.
The [memory/readback follow-up](LP3_MEMORY_READBACKS.md) now fits the sampled
far view in one block at 512 MiB and overlaps warmed pool allocation with
count delivery. Its qualifying resume p95 improves 448.1 → 130.3 ms, while
Rain and cold-gate final costs remain open tradeoffs.

Remaining work, in order:

1. **LP3:** review the regional lattice and memory/readback follow-ups;
   finish default-budget and broader scene/view acceptance, the coarse-contour
   quality decision, and quiet repeats of the final-cost regressions. Cold
   allocation seeds and tail validation remain. Try the cheaper coarse raster
   only if its measured color bias is acceptable.
2. **LP4:** cancellation between voxel pieces, time-based piece sizing and
   the remaining view-first/off-screen scheduling. Bring every GPU
   submission under 100 ms.
3. **LP5:** the color-only rerun experiment, proving it matches a full
   re-bake before retaining geometry records and routing stage-F edits.
4. **LP6:** faster finals: voxel work, final tile-size measurements, fixed
   pools without readback, and an atlas only if measurements justify it.
5. **Later validation:** finish the full scene/map/view performance matrix
   and remaining preview-quality/memory checks. Safari/iPad validation
   remains explicitly deferred. No validation was added to this merge.

Current details are in [LP2 progress](LP2_PROGRESS.md),
[LP3 progress](LP3_PROGRESS.md), and [the plan](LIVE_PREVIEW_PLAN.md).
[The overnight report](LP_OVERNIGHT_REPORT.md) and
[foundation timing tables](LP_FOUNDATION_TIMINGS.md) preserve the earlier
landing and comparison evidence. No benchmark was added to `repro/check.sh`.

An existing development server needs a restart before reloading the editor:
`sculpt-memory.js` is registered in `sculpt.py` at server startup. The native
review server at http://127.0.0.1:8903/sculpt already has that registration.
