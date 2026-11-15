# LP6 compact sampled shell, November 13

This unit is on **live-preview/lp6**, following **2dfc6c79** in the same
worktree. It is committed for visual review, not landed. Main remains
3aff1d1c. [Compact evidence](LP6_SHELL_METRICS.json) retains every measured
load/drag/release endpoint, censoring, GPU pass cost, queue/submission wait,
frame interval, handler/callee time, pipeline call, bitmap copy and memory peak.
This is a scoped performance result, not complete LP6 acceptance.

## Change

Each candidate brick evaluates the solid at 27 points. Bricks whose sampled
range reaches a **12-density-unit band, scaled by the voxel step**, keep
full density in compact ping-pong buffers. Other bricks keep eight half-float
corner samples in a 16-byte coarse record. Their field is interpolated and
rounded back to half precision when read. They do no full density build or
wear work. Build/wear still launch the candidate grid and immediately return
for omitted bricks; a separate compact launch-list trial did not earn its
extra memory, shader and indexing machinery.

The existing per-column ranges address a raw brick map; its fourth word now
points into compact density or marks a coarse record. GPU indirect arguments
carry the candidate count. A separate 16-byte indirect buffer avoids binding
the writable counter as indirect input in the same pass. Counts return in
32 bytes instead of 16, with the same single allocation readback. The pool
overflow guard uses the kept count, and prediction/overflow validation still
precedes presentation. All new buffers count toward the budget; indirect
workgroup limits trigger subdivision. Two new compute entries are prebuilt
for each rock mask (four pipeline creations, by inspection). No cold-cache
compilation experiment was run. There is one render path and no prototype flag.

**This is approximate culling.** Twenty-seven probes are not a proven bound
on every thin feature. Full-cell audits of three extreme-setting crops still
find sign disagreements in omitted bricks. The selected image differences
below and their sheets are the review evidence; this must not be presented
as a universally byte-preserving optimization.

## Page measurements

Chrome 157, terrain **1728×1024 at (2048,2300)**, map16, authored fixture
strokes translated by (2048,2048). Own servers and distinct CDP ports; one
warm-up per fresh server discarded. Runs check `ps` and pass three consecutive
GPU-utilization samples at or below 20%. Runs alternate sequentially; one
release sample per run. Times are ms; peak is the reported release GPU MiB.

| Fixture / budget | View final before / after | Focus final before / after | Submission max before / after | Peak before / after |
| --- | ---: | ---: | ---: | ---: |
| Modern Green 2, 512 MiB, pair 1 | 3526.3 / 3085.4 | 598.0 / 657.4 | 102.8 / 73.6 | 511.2 / 505.9 |
| Green 2, 512 MiB | 4782.8 / 4499.1 | 1720.2 / 1696.6 | 71.0 / 46.5 | 473.6 / 443.5 |
| Modern Green 2, 512 MiB, pair 2 | 3608.6 / 3007.9 | 582.4 / 597.8 | 104.8 / 76.5 | 511.2 / 510.4 |
| Modern Green 2, 2048 MiB | 3497.9 / 2888.3 | 595.7 / 597.8 | 103.5 / 74.1 | 809.0 / 823.5 |

**Measured:** whole-view final improves **12.5–16.6%** in the two low-memory
Modern Green pairs, **5.9%** on Green 2, and **17.4%** at the default budget.
Do not add these percentages to earlier units. All four retained candidate
views equal fresh recipe replays exactly: zero of 1,769,472 pixels differ.
The full-page peaks are not uniformly lower: default-budget peak rises
14.4 MiB while the sampled per-tile working set falls. Strict global memory
containment and broader scene/budget acceptance remain open.

Focus is worse in the first Modern pair and varies near the 600-ms goal in
the others; this does not establish a robust focus deadline. Green 2 remains
far above it. Maximum submissions improve below 100 ms in these runs, not
necessarily every scene. Input is also a separate result. At the default
budget the drag endpoints are **p50 / p95 ms**, all 40 inputs observed:

| Build | First changed pixels | First tile | Pointer tile | Whole current |
| --- | ---: | ---: | ---: | ---: |
| before | 68.2 / 147.8 | 49.4 / 125.0 | 68.2 / 147.8 | 68.2 / 147.8 |
| shell | 71.8 / 170.3 | 55.3 / 154.1 | 71.8 / 170.3 | 71.9 / 170.3 |

The default-budget input tail is slower in this pair; faster finals are not
claimed as universally faster input. Drag rAF p95 is 16.7–16.8 ms and no
long task above 50 ms is observed in any measured load/drag/release phase.
The JSON includes all other pairs' input endpoints and compile observations.

## Small windows and review sheets

Native Dawn diagnostics, 512×256 authored windows, 1024-MiB renderer budget.
One warm render and two measured repeats; every repeat is exact. Medians
are ms. Bricks sum both 256-pixel tiles; peak is the larger tile's working MiB.
These are not Chrome timings.

| Fixture | Window before / after | Full-density bricks before / after | Peak working MiB before / after |
| --- | ---: | ---: | ---: |
| green-modern-2 | 172.7 / 135.2 | 56,627 / 30,965 | 76.9 / 61.7 |
| green-2 | 65.4 / 57.5 | 25,185 / 15,185 | 58.1 / 52.0 |
| red-3 | 80.0 / 57.6 | 47,386 / 20,793 | 76.4 / 53.4 |
| green-7 | 106.8 / 71.4 | 46,876 / 21,025 | 68.4 / 51.5 |

**Measured:** all four default windows remain byte-identical to the preceding
build, including sampled gameplay heights. Green 2 matches strictly at
**128, 256 and 512-pixel native tile sizes**. At 256 and 96 MiB, its 512×256
window also matches exactly while subdivision changes from one to two pieces;
reported final renderer resources fit each budget. No tolerance changed.

Three 256×128 Green 2 stress crops exercise small whole blocks, large inset
blocks, and maximum fine detail/depth/weathering. They change **48, 7 and
277 of 32,768 pixels**, respectively (0.15%, 0.02%, 0.85%). The small-block
case also matches at different tile sizes. **By eye:** the overall forms
remain very similar at 1×; small rock flecks and fine detail move. The full-cell
audit finds 895, 1,211 and 3,947 omitted-cell sign disagreements in the unsplit
crops, so the probe is still not a field bound. These selected stress cases
are not an exhaustive control sweep. The owner must review this approximation
before landing. Small authored before/after sheets stay outside Git.

The seven gate/stage unit tests, world-name gate and JavaScript syntax check
pass. Delayed readback, normal prediction and forced overflow produce the
same preview image, with no unvalidated presentation. One 1×1-unit Green map
exports twice through WebAssembly and once natively in each build; bytes agree
within each build. **Across builds, one indexed-art pixel changes out of
348,160**, maximum channel difference 20. All gameplay heights and other
export metadata match. Export archives therefore differ across builds;
unchanged default windows are not a promise of universally unchanged art.
Error logs are empty. No broad integration suite, large export, realism run
or control sweep was run.

## Decisions and remaining work

An eight-unit band was faster but moved 20/8/6/0 default pixels and up to
533 stress pixels. Twelve units keeps these defaults exact and reduces the
largest stress difference to 277. A 27-sample coarse record increased metadata
memory; eight corners recover the savings. The dense launch-list trial added
about 2.4 MiB per sampled tile without a consistent timing benefit, so it was
removed. The four-voxel brick experiment is not implemented or timed here.

A new **512-pixel view-grid trial** on this faster solid reads **2888.3 →
2172.0 ms** for the default-budget view, but focus is **597.8 → 614.7 ms**
and maximum submission **74.1 → 153.9 ms**. Its replay is exact, but it still
misses the deadlines. The temporary grid edits were restored. The view stays
at **256 pixels**; no larger-grid switch remains.

Final readbacks/fixed-pool work remains open; the earlier prediction trial
was rejected. Surface-atlas and per-landform Time changes remain conditional
on evidence. LP6 has outstanding review and acceptance work; **LP5 has not
started**. The branch is committed for review, not merged or pushed. A fresh
full preview bundle is required before any later push. Raw bench outputs and
temporary runtime files are removed after reading; only compact evidence and
small review figures are retained. Only this task's servers are stopped.
