> **November 13 checkpoint:** LP0c, LP4 step 1 and LP1 are included in the
> completed-card main landing. [The overnight report](LP_OVERNIGHT_REPORT.md)
> gives fresh timings and final combined checks. The dated notes below are
> historical; broader native preview remains on `live-preview/review`.

# LP4 step 1: interruptible Time requests, 2026-11-12

**Result [measured].** Step 1 meets its focused Time-slice, submission,
resume and final-cost guards on `lp4/time-slices`. Main is `99d976c5`;
the measured build is `b791afd5`. Nothing landed or was pushed.
This is not acceptance of the rest of LP4: off-screen work still runs,
and whole-view-current latency still takes seconds.

| Fixture | Longest Time GPU submission, main → build (ms) | Resumed stroke's first changed picture, main → build (two trials, ms) | Stroke release-to-final median, main → build (ms) | Resume release-to-final median, main → build (ms) |
| --- | ---: | --- | ---: | ---: |
| green-modern-2 / map4 | 223.2 → 10.1 | 145.2, 190.4 → 15.7, 18.6 | 5441.4 → 5432.3 | 5364.8 → 5448.1 |
| green-modern-2 / map16 | 225.3 → 10.1 | 147.8, 147.6 → 32.0, 26.6 | 5889.7 → 5912.6 | 5918.2 → 5854.6 |
| red-3 / map4 | 677.5 → 29.5 | 174.6, 127.1 → 17.7, 19.1 | 3724.2 → 3713.0 | 3648.9 → 3680.5 |
| red-3 / map16 | 348.9 → 30.5 | 115.9, 107.8 → 25.5, 23.9 | 4098.5 → 4173.9 | 4045.3 → 4190.6 |

Each resumed-stroke cell has two trials; its nearest-rank p95 is the larger
number, at most **32.0 ms** in the build (the allowance is 150 ms).
Every improvement exceeds main's own spread in that cell. All **16/16**
restarts had Time active and dirty final tiles, including all map16 cases;
the actual release-to-restart intervals were **100.1–103.8 ms**.
All **48/48** gestures were verified Hill strokes, **1,152/1,152** drag and
resume inputs reached whole-view-current, and all eight obsolete build
Time requests canceled. There were zero console errors.

The longest Time submission was **30.5 ms**, below the 50 ms slice target;
the longest submission of any kind was **51.0 ms**, below 100 ms. These are
GPU timestamp spans, not `onSubmittedWorkDone` wall waits: the longest
build queue wait was **146.2 ms**. The largest release-to-final median
increase among all retained phase/fixture cells was **4.7%** (Red/map16
scroll); resumed strokes increased at most **3.6%**. Both are below 10%.
Differences within main's own spread count as no difference. Load-to-final
also stays within that guard. No task over 50 ms was observed during a
held input; load had isolated 69/92 ms tasks in the build and 76 ms in main.

[The timing appendix](LP4_STEP1_TIMINGS.md) gives changed-pixel,
first-tile, pointer-tile and whole-view-current p50/p95 separately,
completion counts, final endpoints and the other measured costs.

**Method [measured].** Two alternating main/build pairs per fixture,
Chrome 157.0.8103.78 on an Apple M3 Pro / 18 GiB, macOS 26.6.2 (25G83),
with a 1728×1024 terrain view, 512 MiB terrain and 1,536 MiB heap budgets.
The native World panel requires a 2368×1383 browser viewport for that
terrain size. Each fresh server discarded a warm-up. Before each timing
run the bench recorded `ps` and waited for three consecutive driver GPU
utilization samples at or below 20%; the display was held awake. No other
agent-owned GPU check ran alongside these samples.

The core window measures load/drag/release/resume. A separate alternating
control window measures native slider/cold-gate/scroll work: all six
requested controls on Green/map4, and Time-focused Rain plus cold-gate and
scroll on the other three cases. The small result records retain each
window's own start time, load snapshot and quiet samples. Colors remains
an explicitly labeled scripted workload, as authorized by the owner.
The baseline-size and green-7 matrix belongs to LP0; it was not repeated
for this focused slice change.

**Bench correction [read, measured].** Current main switches to Select
after a stroke and hides Hill inside a rail flyout. The old driver could
click a hidden button, then move a selection or produce no stroke.
Every earlier stroke/release/resume timing was discarded. The corrected
driver opens the page's flyout with real mouse events and verifies both
tool selection and the live gesture after each press. Reselecting Hill
stays inside the same absolute 100 ms restart deadline. The retained
control/scroll windows reload the authored fixture independently and do
not use those invalid gestures. Eight injected-module syntax/anchor checks
pass; a missing slice-submit anchor fails closed.

**Change [read].** The Time runner submits initialization, batches of one
to eight complete iterations, and final settle/output/maps work. The
passes, order, lattice and page regions are unchanged. After a submission
drains, a task yield lets input and chunk work submit before the next
slice. Batch sizing starts at one iteration, targets 25 ms of queue wall
wait and caps at eight. Queue wall wait includes other work.

Each request owns a copy of the CPU-written world uniform block, so
rendering between slices cannot change its column/hardness values. Working
state stays on the GPU. Only completed results leave the runner; obsolete
requests throw `AbortError` and free all owned buffers. Whole-map callers
check job/stroke/move state. Paged callers check their Time key and page
revision, retry a canceled page at its current revision and reject a key
change during the crop. Rebuilding an identical configuration wrapper
does not cancel useful work. Retained stale weather still serves a held
gesture as before. The paged request chain required `sculpt-scene.js` and
`sculpt-gpu-fields.js` in addition to the plan's original two-file estimate.

**Correctness [measured before the owner's narrower test instruction].**
The on-demand `repro/time-slices.mjs` proof compares the unsliced main
runner with the build: **45/45** cases have identical Time bytes and
dispatch order. Nine fixtures (green-modern-2, red-3, desert-2, lava-2,
ice-2, crystal-2, moon-2, archipelago-2, zhon-2) each have four 257×257
window cases (ages 1/200 × Rain 0/1), plus a whole-map4 age-200/Rain-1 case.
Both height planes and all three maps match by SHA-256. Shared-uniform
writes plus real GPU work between slices leave an active cliff unchanged;
a hardness negative control changes its bytes. Canceling after two fences
frees all **19/19** request buffers exactly once and emits no final output.

Against merged main `99d976c5`, the completed land tier had **217 unit
tests, 0/34 changed scenes**, and passing regional/voxel/smoke/page8/
feature/passability/shape-repeat checks. Workspace passed with zero console
errors. Two WebAssembly exports and the native exporter matched exactly
on Green/map4 (25 chunks), Lava/map8 (81) and Red/map16 (289). These were
correctness runs, not timing samples. None is being repeated; subsequent
work uses focused perf and basic correctness checks at the owner's request.
`repro/check.sh` is unchanged.

**Still unfinished [measured, read].** Map16 still spends GPU time on
ground outside the view. Sums of the phase measurements (whose windows can
overlap) give wholly outside regions 114.1 ms for Green and 5,651.7 ms for
Red, and mixed regions 23,806.4/23,541.7 ms respectively. Timestamps cannot isolate their outside
share (the appendix labels the area-weighted estimate separately).
Thus full LP4's zero-off-screen-work requirement is not met. Its voxel
pieces, time-based piece sizing and off-screen scheduling remain untouched.
Whole-map Time still evaluates the whole map; changing it to view-first
continues to require the owner's decision. No shader, resolution, control,
page extent, save format or export tile size changed. LP0c's sampling fix
and the LP0b prototype editor remain on their separate branches.

Small evidence and exact run metadata are retained outside the repository
in `~/terraform-assets/agent-lp4-step1/`; raw traces, browser profiles and
generated images are removed after reading. LP0b's review server on 8900
remains separate.
