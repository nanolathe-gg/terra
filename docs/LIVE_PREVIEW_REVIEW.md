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
count delivery. Its qualifying resume p95 improves 448.1 → 130.3 ms.
The [Rain/finals follow-up](LP3_RAIN_FINALS.md) improves continuous Rain
whole-current p95 297.3 → 257.5 ms and final latency 5342.0 → 4393.8 ms in
its matched 512-MiB pair. Cold-gate final latency improves 4799.7 → 3983.9 ms.
The [Rain first-view and compilation follow-up](LP3_RAIN_RESPONSE.md) tries
the owner-approved 8-pixel first Time picture. Continuous Rain p95 improves
273.8 → 97.9 ms and paused Rain 258.7 → 100.3 ms; finals improve 6–9% in
the final pair. Shared fragments remove edit-time ray-marcher compilation.
These remain focused measurements: paused Rain still misses 100 ms, the
worst sampled contour offset is 31.5 px, and load briefly exceeds the 512-MiB
budget by 1.1 MiB. An earlier candidate also logged a transient memory-budget
exception and is excluded from acceptance. Sampled final and tile-partition
pixels stay exact.

Remaining work, in order:

1. **LP3:** review the regional lattice and memory/readback follow-ups;
   finish the paused Rain tail, strict load-memory containment, broader
   default-budget/scene/view acceptance, and the coarse-contour quality
   decision. Cold compute variants, allocation seeds, and tail validation
   remain. Try the cheaper coarse raster
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
