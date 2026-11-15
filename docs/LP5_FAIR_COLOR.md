# LP5 native color progress during input, November 14

Fully cached color edits now refresh native tiles directly, oldest displayed
revision first. In the focused pair, final-quality input p95 drops from
**795–1556 ms to 173–199 ms**, with native-quality updates arriving before
release for almost every input. The **150-ms target is still missed**.
This follows compact inputs at fe294fbb and the corrected bench at e504449b,
on `live-preview/lp6`. Main remains a14c48c3. [Compact evidence](LP5_FAIR_COLOR_METRICS.json)
keeps both budgets' paired measurements and exact replay results.

## Scheduler change

A complete native color cache can answer without rebuilding geometry or
repainting a coarse block. It now skips that coarse refresh and orders the
cached native jobs by the image's revision, using focus distance to break
ties. Continuous input no longer restarts every turn at the same focus tile.
A partial cache still receives its covering coarse answer for uncovered
terrain. The immutable input/revision guards and ordinary geometry/Time
paths are unchanged. No shader, art, cache quota, control or saved state
changes in this unit.

The corrected native-quality metric follows actual painted coverage and
LP0's existing revision/Time predicate. Coarse images cannot satisfy it.
First-tile, changed-pixel, pointer-tile and any-level whole-current metrics
remain separate; the evidence retains all of them.

## Full-cache pair

Chrome 157, map16 Modern Green 2, terrain **1728×1024 at (0,300)**, 2048 MiB
requested/effective. Own servers and unique CDP ports, prior discarded
fresh-server warmups, alternating builds, process check and three quiet GPU
samples before timing. One candidate/baseline pair; each real mouse drag
has 36 values. Times are ms, p50 / p95; release uses the last anchor.

| Workload / endpoint | Compact scheduler | Direct oldest-first |
| --- | ---: | ---: |
| Ambient continuous: first changed pixels | 5.0 / 8.4 | 3.8 / 17.4 |
| Ambient continuous: whole current, any level | 5.0 / 8.4 | 86.1 / 173.2 |
| Ambient continuous: whole current, native quality | 838.8 / 1555.5 | 86.1 / 173.2 |
| Ambient continuous: release → final | 122.6 | 76.4 |
| Ambient pause: first changed pixels | 4.2 / 9.0 | 3.6 / 14.4 |
| Ambient pause: whole current, any level | 4.2 / 9.0 | 80.7 / 199.0 |
| Ambient pause: whole current, native quality | 421.2 / 795.1 | 80.7 / 199.0 |
| Ambient pause: release → final | 87.2 | 69.5 |
| Crease shade cold gate: first changed pixels | 4.3 / 11.2 | 5.8 / 31.8 |
| Crease shade cold gate: whole current, any level | 4.3 / 11.2 | 81.6 / 173.6 |
| Crease shade cold gate: whole current, native quality | 879.7 / 1530.7 | 81.6 / 173.6 |
| Crease shade cold gate: release → final | 111.7 | 76.2 |

**Measured:** native-quality p95 falls 88.9%, 75.0%, and 88.7%. Before
release, native quality completes for **34/36, 34/36, and 35/36** inputs,
versus **0/36, 18/36, and 0/36**. All 108 inputs eventually complete, without
native-quality censoring. First-change p95 worsens but remains below 50 ms.
The any-level whole-current endpoint becomes slower because it now waits
for native updates rather than crediting a coarse overpaint. No endpoint
was renamed to hide that tradeoff.

Release-final improves another 37.7%, 20.3%, and 31.8% in this pair. Load
final is effectively flat, 2667.1 → 2665.6 ms. Cache remains 35 native
records plus one coarse record, 758.6 MiB, and input-phase peak GPU ledger
stays 1316.6 MiB. Startup readiness is 573 → 660 ms in these warmed sessions;
the previous unit's observed first-use shader wait is still a limitation.

Continuous queue/submission maxima are 18.7/10.3 → 14.2/4.4 ms; rAF p95
stays 16.7–16.8 ms. There are no tasks over 50 ms, pipeline API calls, new
specialized sets, or wholly offscreen GPU passes during input in either
build. Handler/bitmap-copy p95 is 0.4/0.1 → 0.3/0.1 ms. These are scoped
page measurements, not across-device or repeated-run confidence intervals.

## Partial cache and quick correctness

At **1024 MiB**, both builds retain 17 native tiles plus the coarse block,
406.9 MiB within the same quota. The candidate still delivers a coarse
whole-current response at **5.3 / 6.9 / 5.7 ms p95**, versus 12.5 / 8.1 /
6.2 ms, for continuous/pause/cold workloads. Release-final is
1159.3 / 1125.4 / 1150.3 → 1176.6 / 1153.2 / 1145.0 ms, mixed −0.5% to
+2.5% changes in this single pair. Native-quality input tails remain seconds
at this partial coverage; one mid-pause final is censored in each build.
No complete LP5 acceptance is claimed at this budget.

Both full-cache and partial-cache candidate viewports equal cold recipe
replay exactly, at zero differing pixels, and browser errors are empty.
The full-cache rendering hash is unchanged from the compact-input build.
Eighteen relevant coverage, invalidation and preview-plan CPU tests pass in
45 ms; syntax/diff checks pass. The preceding strict regional sampling,
cache dependency and low-memory checks remain unchanged. Broad all-world
runs, control sweeps, and export archives were not repeated.

The remaining full-cache tail is close to the target and spends time waiting
between per-tile queue submissions. A bounded group of cheap F submissions
is the next investigation, while keeping stale GPU work short. This unit
stays on the review branch; it introduces no additional art movement beyond
the compact sampler awaiting review.
