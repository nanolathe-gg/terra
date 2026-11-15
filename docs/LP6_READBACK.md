# LP6 final allocation readback decision, November 13

**Decision: retain count-sized final allocation.** The budget-sized pool
trials are correct but do not earn their memory and lifetime complexity in
the focused page runs. All trial source edits, including temporary benchmark
instrumentation, are restored to **ff846f12**. This is a measured rejection,
not a claim that final readback has been removed. Work stays on
`live-preview/lp6`; main is unchanged.
[Compact evidence](LP6_READBACK_METRICS.json) retains all load/drag/release
endpoints, censoring, queue/submission waits, memory, pipeline calls, off-screen
GPU cost and both normal and overflow proofs.

## Experiment

R6 proposes a budget-sized pool rather than waiting for the GPU's count to
choose allocation size. The trial submits native build/draw before count
delivery, validates asynchronously before presentation, and subdivides an
overflowed piece. The existing shader overflow guard rejects undersized
pools. No new renderer or shader path is needed.

A fresh 64-MiB pool on each tile moves the wait but adds allocation work.
A second trial reuses the empty buffers across native tiles, reclaims them
under memory pressure, and discards them before previews. A smaller 48-MiB
pool avoids wasting as much memory. The last trial reclaims an empty pool
before useful preview input/level caches, fixing the initial eviction
priority. Capacity also respects the actual renderer budget, remaining
resources and storage-buffer limit. These trials never change the art model.

## Page results

Chrome 157, map16 Modern Green 2 with translated strokes, terrain 1728×1024
at (2048,2300). One warm-up per fresh server discarded, `ps` checked, three
consecutive GPU-utilization samples at or below 20%, sequential alternating
builds, distinct CDP ports. Times are ms. Each final endpoint is one sample.

| Trial / budget | View final before / trial | Focus final before / trial | Release peak MiB before / trial | Load peak MiB before / trial |
| --- | ---: | ---: | ---: | ---: |
| Fresh 64 MiB / 2048 MiB | 2950.8 / 3019.3 | 649.9 / 608.6 | 809.0 / 809.0 | see JSON |
| Reused 64 MiB / 2048 MiB | 2896.4 / 2811.8 | 610.6 / 589.9 | 809.0 / 809.0 | see JSON |
| Reused 64 MiB / 512 MiB | 3066.8 / 3048.3 | 607.9 / 620.2 | 505.9 / 512.5 | 504.3 / 511.7 |
| Reused 48 MiB / 512 MiB | 3137.9 / 3020.8 | 683.7 / 626.5 | 505.9 / 509.4 | see JSON |
| Reused 48 MiB, pool reclaimed first / 512 MiB | 3014.1 / 3015.1 | 626.4 / 612.1 | 505.9 / 510.7 | 509.5 / 528.4 |

**Measured:** the fresh pool is 2.3% slower for the view. Reuse gains 2.9%
at the default budget but only 0.6% in its first low-memory pair. The smaller
pool initially gains 3.7%, but after correcting eviction priority the repeated
low-memory view result is flat (+0.03%). Load then exceeds 512 MiB. Input
p95 also varies: default reuse 159.8 → 168.0 ms; the smaller low-memory pool
171.9 → 188.1; reclaiming it first 193.4 → 175.1. This does not establish
R6's required combination of better final latency and unchanged early input.
The source restoration avoids adding this tradeoff to the retained build.

In the final trial the observed maximum is **18,526 kept bricks**, below its
24,576-brick pool. There are **zero overflows**, 196 native submissions and
70 pool reuses across load/drag/release. Its poor tradeoff is not explained
by overflow retries. Buffer retention competes with phased page/Time memory,
even when the pool itself fits the renderer's local budget. Moving a count
wait is not sufficient evidence of a faster complete view.

## Small correctness checks

The reusable 64-MiB trial matches Green 2's retained native hash exactly.
A delayed count-delivery probe observes build/draw submission before the
count reaches the CPU and no presentation before validation. One forced
overflow subdivides and repairs the image exactly. Native tile sizes 128,
256 and 512 and renderer budgets 256 and 96 MiB match at zero differing
pixels; the smaller budget's final resources fit. Reuse is exercised, not
only allocation. Every candidate Chrome viewport equals a fresh recipe
replay exactly: zero of 1,769,472 pixels differ. Error logs are empty.
Thirteen focused memory/preview-planning unit tests and syntax checks pass.
These checks do not excuse the measured page-budget excess.

No shader, exporter, art or save-format change is retained. No additional
large export or scene sweep is needed for restored source; the compact-shell
unit's checks remain applicable. Raw outputs and trial code are deleted after
reading, while compact evidence is kept in Git. No benchmark enters the
quick check runner.

## Transition to LP5

This closes the LP6 final-readback investigation for the current performance
pass. The retained memory, closed-gate, march, wear and shell units remain
for review. Larger tiles and the separate compact dispatch list were also
rejected on their measurements. Four-voxel bricks remain unmeasured; the
surface atlas and per-landform Time work remain conditional research, not
silently enabled approximations. LP6's visual review, robust focus/input
budgets and broader memory acceptance remain open; main is not being merged.

The next authorized work is LP5 **step 0**, the full-precision color-only
split experiment, on the same branch as requested. It must prove a warm
color-only rerun equals a full rebuild by that split build before any visible
cache or scheduler routing is implemented. Its record memory, retained
inputs and art drift will be reported explicitly. No main landing or fresh
preview publication is implied by starting the experiment.
