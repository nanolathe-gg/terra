# Live-preview implementation status

The overnight main checkpoint contains **LP0c, LP4 step 1 and LP1**,
with current main’s UI preserved. See [the measured overnight report](LP_OVERNIGHT_REPORT.md)
and [the complete focused timing tables](LP_FOUNDATION_TIMINGS.md).

The completed work fixes exact regional sampling, keeps view tiles stable,
slices and cancels Time requests, gives Time private uniforms, and derives
world changes from one uniform writer. The original strict pixel test and
the landing tier pass, with only the six owner-approved sampling pixels.

Broader native preview, frame batching, adaptive memory and LP3 experiments
remain together on **`live-preview/review`**. Their cold-gate final median
missed the unchanged 10% guard at +10.21%; they are not part of main’s
completed checkpoint. The review branch’s `docs/LP2_PROGRESS.md` records
that result and remaining gates. Safari validation stays deferred.

The historical proof remains [LP0b](LP0b_REPORT.md); its prototype code is
outside the shipping implementation. No benchmark was added to
`repro/check.sh`. The owner’s overnight instruction authorized this
completed-card landing; the rest remains available for review.
