# LP5 bounded color cache, November 13

**A first usable cache unit, not complete LP5 acceptance.** The approved LP6
and LP5 split were landed and pushed to main at **580d0fbb**, with fresh
`previews-ad20b68dd40e1adc` assets. Deployment
[succeeded](https://github.com/nanolathe-gg/terraform/actions/runs/43565184489).
This follow-up stays on **live-preview/lp6**, based on that main, for review.
[Compact evidence](LP5_CACHE_METRICS.json) preserves both builds' phase
endpoints, censoring, frame/queue/submission cost, memory, pipeline calls,
handler/callee time, off-screen GPU cost, and the small correctness proofs.

## Change

Final tiles and the 4-level preview block may retain immutable geometry and
the 2D surface inputs F actually needs. Ownership transfers from the mutable
workspace; there is no C-texture or solid clone. The cache retains height,
weather/material/Time, masks, baked fields and rock weather/source/rim plus
the geometry record. It releases routes, loose/deposit intermediates and the
old color target. Shared material textures remain shared.

One small GPU buffer copy captures the tile's uniforms, including its seven
GPU-written availability flags. A color rerun merges current CPU-owned
world uniforms with the original chunk coordinates and preserves those GPU
flags. The computed dependency map rejects earlier-stage edits. F still
has an empty solid bind group. No shader, art model, UI, save or export
format changes.

A cached whole-view block gets first priority on F input, then valid cached
native tiles. With partial coverage, one native tile yields to a needed
whole-view preview. Expensive cache misses refine after the normal pause
rather than competing with cached answers throughout a held color drag.
Three reusable color-target sizes avoid allocation churn between a block
and native tiles. Cache misses run the same existing full E→F pipeline.
The benchmark now labels color-only GPU passes with their actual rectangles
and records cache usage; it remains outside the quick runner.

Validity includes the original input rectangle/serial through E, weather
revision, display level and weathered/authored view. A through-E change
retires affected records. Panning drops records outside the view. A reader
pins its inputs across queue/allocation awaits; retirement defers resource
destruction until that reader releases them. Lowering the budget drops
optional records before fitting terrain pages. Allocation failure also
reclaims color data before useful workspace. No old image is removed merely
because its optional color inputs are evicted.

## Memory policy and limitation

The optional quota is the lesser of 40% of the terrain budget and the space
above **512 MiB**; Fit retains none. Admission keeps the whole-view block and
near-focus tiles first. **512 MiB and below retain no color records** in
this first unit: the existing preview/full-bake behavior remains available.
There is no artist-facing cache switch. This is a bounded fallback, not a
claim of better low-memory color latency.

Actual GPU objects, the cached uniform buffers and CPU uniform snapshots
are accounted. The quota is included in `pagedBudget`'s **preview minimum**,
so page counts leave room without changing the canonical shape ring. Pure
chunk-size probes exclude evictable records; an actual bake reclaims them
before refusing allocation. A budget change cannot make optional records
change the export/view grid.

**Measured:** the large view retains **13 records**: one preview block and
12 native tiles, totaling **762.7 MiB**. This is partial coverage of 35
visible native tiles. **Calculated from their raster sizes:** only about
67.9 MiB is geometry; most of the rest is duplicated C input. Reducing that
input footprint is the next useful memory unit. The existing ledger also
omits some shared generated/noise/palette and driver costs, as recorded in
step 0; the figures below are application ledger values, not physical VRAM.

## Focused page results

Chrome 157, Modern Green 2, map16, terrain **1728×1024 at (0,300)**,
**2048 MiB** requested and effective. Each real ambient drag delivers 36
input values; pause holds about 1 s in the middle. The cold-gate workload
uses the existing Crease shade row leaving zero. Separate CDP ports, own
servers, discarded first runs per server, `ps` checked and three consecutive
GPU driver samples ≤20% before timing. Runs are sequential and alternate.
One final candidate/baseline pair follows the scheduling fixes. Values are
ms, p50 / p95; release-final is one completed release sample per phase.

| Workload / endpoint | Main | Cache |
| --- | ---: | ---: |
| Ambient continuous: first changed pixels | 46.8 / 77.8 | 4.0 / 84.0 |
| Ambient continuous: whole current at any level | 46.8 / 77.8 | 4.0 / 117.4 |
| Ambient continuous: release → final | 1808.4 | 979.9 |
| Ambient pause: first changed pixels | 45.3 / 108.1 | 3.6 / 68.8 |
| Ambient pause: whole current at any level | 45.3 / 108.1 | 3.6 / 95.1 |
| Ambient pause: release → final | 1777.3 | 947.3 |
| Crease shade cold gate: first changed pixels | 40.9 / 78.1 | 5.3 / 115.3 |
| Crease shade cold gate: whole current at any level | 40.9 / 78.1 | 5.7 / 115.4 |
| Crease shade cold gate: release → final | 1765.8 | 990.9 |

**Measured:** continuous ambient median first change falls **46.8 → 4.0 ms**
and release-to-view-final **1808.4 → 979.9 ms**, a **45.8% shorter final
wait** in this pair. Paused release final falls 1777.3 → 947.3 ms (46.7%);
cold-gate release final falls 1765.8 → 990.9 ms (43.9%). Each pause phase
has one censored mid-pause final endpoint; these release samples must not be
presented as a completed p95 over both anchors.

**The tails do not uniformly improve.** Continuous first-change p95 is
77.8 → 84.0 ms and whole-current p95 77.8 → 117.4 ms; cold-gate first p95
78.1 → 115.3 ms. Paused first/whole p95 improve 108.1 → 68.8 / 95.1 ms.
The 50-ms first-change goal and 150-ms **final-quality** whole-view goal are
not met. Superseded inputs and outstanding full work remain in the samples;
the fast median does not excuse these tails.

Load final is 2548.2 → 2594.9 ms (+1.8%) in this pair. Continuous-drag peak
GPU ledger rises **704.0 → 1445.6 MiB**; the paused peak is 1462.0 MiB,
within the requested 2048-MiB ledger budget. This cost buys partial coverage,
not a complete view cache. No heavy broad sweep was run.

rAF p95 is 16.7–16.8 ms, and no long task exceeds 50 ms. Continuous-drag
longest queue wait is 64.7 → 55.6 ms and submission 61.5 → 53.3 ms; the
candidate's cold gate still has a **152.9-ms queue wait**. No new specialized
set or pipeline creation occurs during the three measured slider phases.
Color-only pass maximum is reported separately from whole-input latency in
the JSON. Pointer-tile distributions are empty for sliders; first-tile,
changed-pixel and whole-current distributions are all retained, with no
substitution of one for another.

Earlier focused iterations caught a real starvation bug: processing every
cached tile first made a continuous whole-current p95 **114.2 → 181.0 ms**.
That scheduler was discarded. Yielding a partial cache, retaining the coarse
block's F inputs, and moving full misses behind a pause lead to the retained
result above. Iteration summaries are kept rather than hiding the failed
tradeoff. These were targeted repetitions after changes, not a full LP0
matrix or a general repeatability claim.

## Quick correctness

- Four fed map16 fixtures (Modern Green 2, Green 2, Red 3 and Green 7), with
  fresh/rind/wetness/absorption/colored shadow/cavity features enabled.
  Retain tile A, render/retain a different odd-sized tile B, destroy D,
  replay A and B, then compare each to a full split rebake: **eight exact
  matches**, zero differing pixels. Green 7 uses its deep color, because
  the sampled water does not visibly respond to ambient.
- Each case rejects an earlier-stage rock edit. A reader paused at the
  queue wait keeps its inputs alive after eviction is requested, aborts
  when it resumes, and releases the retired resources. All four cases end
  at zero cached bytes with no GPU errors.
- The final Chrome viewport equals a fresh replay: **0 / 1,769,472 pixels**
  differ. Its hash is `9f6febf8d783d870ed2205f223fad4183e39b9a4c195ce0927acc166ffc12024`.
- One small map4 browser check changes the existing block-size control,
  observes stage C invalidation, and verifies all prior records retire.
  Setting 512 MiB then drops cached bytes to zero **synchronously**, keeps
  them at zero after idle, and settles at **259.8 MiB** of GPU ledger.
  This is a scripted correctness check, not mouse latency evidence.
- Twenty-two focused stage/gate/renderer/memory/preview-plan unit tests and
  syntax checks pass. No pixel tolerance or artistic requirement changes.

`node repro/color-cache.mjs --server <yours> --out <outside repo>` preserves
the small native proof on demand. No new dependencies and no additions to
`repro/check.sh`. Full export archives, all-world/control sweeps, zoom/pan
stress and low-memory timing remain on demand; they are not acceptance
claims for this unit. Raw browser/probe output is deleted after its compact
evidence is recorded.

## Next

Reduce retained C-input duplication so more of the final view fits; then
address p95 queue/input tails and prove the whole-view final-quality color
budget. Low-memory color-cache coverage, additional stage-F controls, scoped
export verification and the rest of LP5 acceptance remain unfinished. The
current map drives invalidation conservatively; the 130 historical stage-F
World rows are not all certified by this ambient/crease/deep-color sample.
Main remains the approved 580d0fbb landing. This unit needs fresh previews
before any later push; it is committed on the review branch only.
