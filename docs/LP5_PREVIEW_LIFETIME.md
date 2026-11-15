# LP5 keep the coarse color record, November 14

Keeping the completed coarse preview's color record cuts first-change p95
from **65–113 ms to 8–11 ms** in the focused three-workload page pair.
This follows mask packing at 8aed281a on `live-preview/lp6`; main remains
580d0fbb. [Measurements and correctness evidence](LP5_PREVIEW_LIFETIME_METRICS.json)
keep both builds' endpoints, censoring, queue waits, frame intervals,
pipeline calls, handler breakdown, bitmap copies, memory and GPU work.

## Behavior

The scheduler previously discarded every coarse block when the visible
native tiles became final. The next color input, including a drag resumed
after a one-second pause, rebuilt that block through geometry before F
could recolor the whole view. It now keeps a covering block at the current
preview level if its immutable color inputs are still valid. Finished
native tiles already clip and hide that block's image.

The existing revision, weather, view, level and memory rules still apply.
An earlier-stage edit retires the record. Zoom or navigation drops records
that no longer qualify, and lowering memory clears the optional cache.
The optional quota is unchanged: at 2048 MiB it remains 819.2 MiB. The
large-view sample retains **18 native records plus one coarse record**,
813.2 MiB total, instead of 18 records totaling 765.8 MiB. Cache statistics
now distinguish native tiles and preview blocks while preserving the total.
At 512 MiB and below there is still no retained color cache.

## Focused page comparison

Chrome 157, map16 Modern Green 2, terrain **1728×1024 at (0,300)**, 2048 MiB
requested and effective. Candidate then baseline, following the preceding
alternating mask-build comparisons; one pair for this narrow lifetime edit.
Each real mouse drag delivers 36 values. Own servers and distinct CDP ports;
fresh-server warmups had already been discarded. Process load was checked
and each run started after three consecutive GPU-driver samples at or below
20%. Measurements were collected November 13 Pacific time.

Times are ms, p50 / p95. Release-final is the last anchor, with the held
pause listed separately. These are distributions within one run per build,
not confidence intervals across repeated runs.

| Workload / endpoint | Mask build | Keep coarse record |
| --- | ---: | ---: |
| Ambient continuous: first changed pixels | 3.9 / 65.1 | 3.9 / 10.5 |
| Ambient continuous: whole current, any level | 3.9 / 98.3 | 3.9 / 10.5 |
| Ambient continuous: release → final | 790.5 | 813.0 |
| Ambient pause: first changed pixels | 4.8 / 112.9 | 3.7 / 8.7 |
| Ambient pause: whole current, any level | 4.8 / 112.9 | 3.7 / 8.7 |
| Ambient pause: release → final | 741.0 | 771.2 |
| Ambient pause: held pause → final | 822.4 | 840.8 |
| Crease shade cold gate: first changed pixels | 3.7 / 65.2 | 3.7 / 8.0 |
| Crease shade cold gate: whole current, any level | 3.7 / 99.3 | 3.7 / 8.0 |
| Crease shade cold gate: release → final | 801.5 | 793.0 |

**Measured:** first-change p95 falls 83.9%, 92.3% and 87.7%, respectively.
All 108 inputs and all pause/release anchors complete without censoring.
First-tile and changed-pixel distributions are preserved separately; pointer
tile samples are empty for these slider workloads. The 50-ms first-change
budget is met in these focused phases. The quick whole-current response is
at a coarse level: **LP5's 150-ms final-quality whole-view target is still
unmet**. This is not complete LP5 acceptance.

Release-final changes +2.8%, +4.1%, and −1.1% in this pair. Keeping the
coarse answer improves input response, not final throughput. Load final is
2610.0 → 2743.9 ms (+5.1%). A wider matrix and repeated pairs remain on
demand; these small final-time changes are not a broad regression estimate.

rAF p95 stays 16.7–16.8 ms. No task exceeds 50 ms. Continuous-phase maximum
queue wait/submission is 55.0/51.1 → 56.3/52.5 ms. Handler p95 is 0.3 →
0.5 ms; bitmap-copy p95 stays 0.1 ms. There are no new specialized pipeline
sets in either build. Compute-pipeline API calls during the three input
phases fall **35/70/35 → 0/0/0**, consistent with avoiding the coarse
geometry rebuild. Startup compilation is outside that claim.

Peak GPU ledger MiB for continuous/pause/cold phases is
1530.7/1549.3/1529.4 → 1388.0/1407.2/1388.0, despite the additional retained
record. Avoiding the rebuild also avoids its overlapping working sets.
Load peak is 1451.8 → 1397.0 MiB. These are application-accounted bytes,
not physical GPU memory. No wholly offscreen GPU submission is measured
between input and final in either build. Boundary/apron work remains:
continuous mixed-region GPU time is 635.2 → 598.8 ms, with the existing
area-weighted outside estimate 242.2 → 215.9 ms. The evidence keeps those
categories separate rather than treating the estimate as directly timed
invisible work.

## Quick correctness

- The large candidate view equals fresh replay exactly: **0 / 1,769,472
  pixels differ**, SHA-256
  `9f6febf8d783d870ed2205f223fad4183e39b9a4c195ce0927acc166ffc12024`.
- A small map4 browser check recomposes the final view with its retained
  coarse image present. Before/after RGBA hashes match exactly: keeping
  the image does not paint coarse pixels over completed tiles.
- Zooming to 2× leaves one block at the correct two-art-pixel preview
  spacing. A color edit using that cache equals a forced full C/D/E/F
  rebake byte for byte.
- A rock-size edit retires every previous color record before rebuilding.
  Lowering memory to 512 MiB immediately frees all records; after idle
  there are no preview blocks, and GPU ledger is 291.4 MiB within budget.
  The browser reports no errors. These lifecycle assertions use scripted
  existing controls/APIs; only the performance drags use real mouse input.
- Fifteen relevant planner, stage and memory CPU tests pass, along with
  syntax and diff checks. The preceding mask unit's signed-channel,
  interleaved cache, odd-tile and export-art proofs remain unchanged.

No art, shader, control or export format changes in this unit. Broad scene
and control sweeps, full export archives and another LP0 matrix were not
run. Own servers and raw browser output are cleaned up after recording this
evidence. Source stays committed on the review branch; fresh preview assets
are required before a future push.

The next LP5 issue is retained C-input cost and partial native coverage:
17 of the 35 visible native tiles still need geometry after a color edit.
Sharing overlapping immutable inputs is the next memory investigation;
final-quality acceptance, Safari's deferred memory probe and broader device
measurements remain open.
