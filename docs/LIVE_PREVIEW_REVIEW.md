> **November 14 approved landing:** the owner authorized merging the reported
> review branch through e1476192. The compact sampler's measured pixel changes
> and Rain's 8–11% final-cost tradeoff are included in that approval. Main had
> not moved; the rendering source and pinned previews are unchanged from the
> checked build. [Landing record](LP_NOV14_LANDING.md). Earlier branch/review
> statements below describe the checkpoint before this approval.

> **November 14 checkpoint:** main a14c48c3 includes the owner-approved
> bounded F cache, mask packing and coarse-record lifetime fixes. The newer
> compact inputs, color scheduling and small-map Rain work stays on the same
> `live-preview/lp6` review branch. [Current measured status](LP_NOV14_MORNING.md)
> supersedes the remaining-work list in this historical November 13 record.

> **November 13 LP6 and LP5 split landing:** the owner approved the retained
> LP6 units and LP5 step 0 for main. The source merge is unchanged from the
> reviewed branch; main had not moved. Fresh authored previews are pinned to
> `previews-ad20b68dd40e1adc`. The existing focused checks and measurements
> remain applicable; no broad suite is repeated. [LP6 shell](LP6_SHELL.md),
> [readback decision](LP6_READBACK.md), and [LP5 split](LP5_STEP0.md) retain
> their measured limits. Visible-record caching and control routing follow
> from this landing; whole-view stage-F acceptance is still open.
>
> **November 13 LP3 landing:** the owner approved the LP3 trial and its reported
> limits. [The landing record](LP3_LANDING.md) covers integration with cleaned
> latest main. LP6 now takes priority; the earlier LP3 acceptance gaps remain
> recorded below.

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

LP3 regional shape and Time lattices and their follow-ups are included in
the owner-approved landing on cleaned main. [The focused report](LP3_LATTICES.md) covers
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

Remaining work, with LP6 now active:

1. **LP6:** [the first final-memory unit](LP6_FINAL_MEMORY.md) is committed
   on `live-preview/lp6` for review. On the focused 512-MiB fixture, finals
   improve 12.1–14.3% by retaining canonical Time pages. The drag tail is
   somewhat slower, and the focus deadline remains unestablished. Next:
   voxel allocation/march units, wear and shell measurements, tile sizing,
   and fixed pools only when the full-view measurement justifies them.
2. **LP3:** the remaining paused Rain tail, strict load-memory containment,
   broader default-budget/scene/view acceptance and the coarse-contour
   quality decision. Cold compute variants, allocation seeds and tail
   validation remain. The cheaper coarse raster is still optional.
3. **LP4:** cancellation between voxel pieces, time-based piece sizing and
   the remaining view-first/off-screen scheduling. Bring every GPU
   submission under 100 ms.
4. **LP5:** the color-only rerun experiment, proving it matches a full
   re-bake before retaining geometry records and routing stage-F edits.
5. **Later validation:** the full scene/map/view performance matrix and
   remaining preview-quality/memory checks. Safari/iPad validation remains
   explicitly deferred.

Current details are in [LP2 progress](LP2_PROGRESS.md),
[LP3 progress](LP3_PROGRESS.md), and [the plan](LIVE_PREVIEW_PLAN.md).
[The overnight report](LP_OVERNIGHT_REPORT.md) and
[foundation timing tables](LP_FOUNDATION_TIMINGS.md) preserve the earlier
landing and comparison evidence. No benchmark was added to `repro/check.sh`.

The current development server is `go run ./cmd/terraform`; the editor is `/`.
Source and config changes reload on requests. Historical Python server and
`/sculpt` addresses in dated measurement reports are retained as provenance.
