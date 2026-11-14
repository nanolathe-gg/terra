# LP6 final-memory reuse, November 13

LP3 is landed and deployed on cleaned main at **3aff1d1c**, with the fresh
published preview bundle and the newer main fixes preserved. See
[the landing record](LP3_LANDING.md). This first LP6 unit is **00c7af8e** on
`live-preview/lp6`, based directly on that main, in the same worktree.
It is committed for review; it has not been merged or pushed to main.

**Measured:** final rendering improves **12.1–14.3%** in two focused alternating
pairs. Canonical Time completions before the visible final fall **18 → 9**.
Both candidate viewports match fresh replays exactly: **zero of 1,769,472
pixels changed**. This is a 512-MiB result, not a claim about the default
2048-MiB budget or the complete scene/view matrix.

## Change

A completed coarse image is immutable and remains visible while final tiles
replace it. Once settled native final refinement begins, the previous GPU
work drains, then the coarse source lattice and its future preview working
reservation are released. The page cache reserves the actual retained image
bytes instead. It can retain more canonical shape/Time pages, avoiding repeated
Time work for neighboring final tiles and the near-view background ring.

Before input/camera reconfiguration or an uncached preview, the full preview
reservation is restored and page residency is refitted. Preview and final
rendering use the same kernels, age, parameters, apron, lattice and tile size
as before. The canonical ring's minimum remains independent of preview working
memory; only page residency changes. No shader, control, save or export format
changes. No source cache is needed to continue displaying a retained bitmap.

## Focused page measurements

Chrome 157.0.8103.78, translated Green Modern 2/map16, terrain **1728×1024**
at **(2048,2300)**, explicit **512 MiB**. Each fresh server discards a warm-up;
measured runs check `ps` and pass three consecutive GPU-utilization samples
at or below 20%. Runs are sequential. The retained order is before, candidate,
before, unchanged candidate; one discarded allocation-pool trial occurred
between the first baseline and first retained candidate.

Each final endpoint has one completed release sample per run. Times are ms.
The second Time count includes the one-tile near-view background ring after
the visible final; it is not substituted for the visible-final count.

| Build | Release → view final | Release → focus final | Native Time before view final | Native Time through ring | Peak stroke/release MiB |
| --- | ---: | ---: | ---: | ---: | ---: |
| before 1 | 4216.8 | 631.0 | 18 | 72 | 509.5 |
| after 1 | 3613.1 | 595.9 | 9 | 15 | 511.2 |
| before 2 | 4167.2 | 590.0 | 18 | 72 | 509.5 |
| after 2 | 3663.5 | 632.4 | 9 | 15 | 511.2 |

The peak column covers the stroke/release workload. Across the measured load
phases, baseline peaks are 509.5–517.5 MiB and candidate peaks are
511.4–511.6 MiB; strict load containment remains open.

The focus endpoint varies around the 600-ms goal in both builds; this work
does not establish that goal. Input responsiveness is also a separate result.
The drag values below are **p50 / p95 ms**, with all 40 inputs observed in
each run. The slower first-changed/whole-current tail remains visible in the
table; faster finals are not presented as faster input at every endpoint.
The first-tile and changed-pixel endpoints differ in the second candidate.

| Build | First changed | First tile | Pointer tile | Whole current |
| --- | ---: | ---: | ---: | ---: |
| before 1 | 70.3 / 169.8 | 68.5 / 168.3 | 70.3 / 169.8 | 70.3 / 169.8 |
| after 1 | 67.5 / 181.3 | 66.7 / 181.3 | 67.5 / 181.3 | 67.5 / 181.3 |
| before 2 | 70.9 / 173.3 | 70.4 / 173.3 | 70.9 / 173.3 | 70.9 / 173.3 |
| after 2 | 74.4 / 183.9 | 69.3 / 155.8 | 74.4 / 183.9 | 74.4 / 183.9 |

| Build | Drag rAF p95 | Release queue wait max | Submission max | Handler max | Bitmap-copy max | Wholly off-screen / mixed GPU ms |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| before 1 | 16.7 | 112.1 | 109.4 | 0.0 | 0.1 | 16.4 / 1842.5 |
| after 1 | 16.7 | 109.5 | 106.6 | 0.0 | 0.2 | 5.0 / 1473.4 |
| before 2 | 16.7 | 109.5 | 107.2 | 0.0 | 0.1 | 16.5 / 1803.3 |
| after 2 | 16.7 | 109.7 | 107.4 | 0.0 | 0.1 | 5.0 / 1517.9 |

Off-screen work is clipped by the bench's input-to-visible-final attribution;
mixed-region passes cannot be assigned exactly to pixels. Maximum submissions
still exceed the 100-ms LP4 goal in both builds; this change does not close it.
No long task above 50 ms is observed in these measured phases.
[Compact evidence](LP6_FINAL_MEMORY_METRICS.json) retains
load/drag/release endpoints, censoring, callee times, memory, pipeline calls,
GPU pass costs, Time batches and both pairs. Raw outputs are deleted after
reading. The existing LP3 strict load-memory and broader acceptance limits
remain open; this does not claim a universal 512-MiB bound.

## Small correctness checks and rejected experiment

All **14** focused canonical-grid, geometry and freshness tests pass. Both
candidate viewports match fresh final replays exactly, with empty error logs.
A targeted new-stroke probe waits for final refinement and a busy native
allocation before using the real mouse. It resumes at **705.5 ms** after
release, with `finalizing`, `rendererBusy`, `gpuWorkPending` and foreground
pending all true. The page restores preview capacity, completes the stroke,
and again matches a fresh final replay exactly with no errors. Its first-tile,
pointer and whole-current p95 are **175.8 ms**. No Time pass is
active at that exact instant: this protects the pinned allocation case and is
not the original LP0/LP4 100-ms Time-in-flight acceptance run. The repository
benchmark's defaults and endpoints remain unchanged. An earlier fixed 600-ms
probe reached finalization but missed the busy allocation boundary; it is
retained as diagnostic evidence only.

Extending predicted brick pools to finals was tried first. Native and sampled
export art remained exact, including forced overflow and delayed delivery,
but the whole-view result was only **4216.8 → 4195.8 ms (0.5%)** while native
pool working memory rose about 80.6 → 109.7 MB on the sampled tile. That is
not a worthwhile measured gain; both source and proof-tool changes were
reverted. There is no new final-pool path or feature flag in the retained build.

Next LP6 work remains the voxel allocation/march units, wear where it shows,
thin-shell measurements, final-tile sizing with the focus deadline, and a
fixed final pool only if it improves the full view. Broader scene/default-budget,
export and visual sweeps remain on demand. No benchmark was added to
`repro/check.sh`. This LP6 source change needs a fresh preview bundle before
any later push; the bundle on main remains valid for landed LP3.
