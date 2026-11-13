# LP0b: coarse blocks in the page, 2026-11-12

Historical proof report, retained on the unified review branch. The throwaway
prototype editor remains on `prototype/lp0b`; its code is not merged here.

**Status:** the throwaway slice is built on `prototype/lp0b`; correctness
checks, the land tier and workspace checks pass. Nothing landed
or was pushed. **No speed claim or Go decision:** the owner deferred timing
runs until the shared GPU is quiet. The original thresholds stay in force.
LP1 and later work wait for the owner's look and Go decision.

**Try it.** The server stays running at
[the 2,048 MiB Green editor](http://127.0.0.1:8900/sculpt.html?biome=green&variant=modern&mapX=16&mapY=16&gpuMB=2048&heapMB=1536).
Use **Load** to open the [native cliff recipe](/Users/daniel/terraform-assets/agent-lp0b/LP0b-green-modern-2-map16.json),
choose 1x, and pan to the map's upper-left corner. Draw a stroke, or hold
**Joint spacing (px)** in the World panel's rock rows (`knob-faceBlockSize`). For four blocks, change `gpuMB=2048` to `gpuMB=512`.
The normal default remains 512 MiB in this proof; LP2 owns the new default
and detection. No controls or panels were added.

**Slice [read].** Commit `25ea2270` uses today's `clear()` and `changeSeq`.
While interacting at 1x, the same renderer makes level-4 pictures over the
visible view, on a 64 px global grid. At 2,048 MiB it is one block; at
512 MiB it is four. These images live outside the tile cache and count
against the terrain budget. Making a block cannot evict a visible final
image. Stale finals remain underneath; blocks are clipped around current
or newer finals. Release runs today's final-tile plan and removes the
blocks once the visible finals are current.

The rock row queues the newest value once per animation frame. Its queued
value remains pending until applied, so neither the page nor the bench
mistakes an old picture for a settled new value. The existing release
checkpoint follows that application. Held pauses stay coarse in this
minimal slice; LP2 owns automatic refinement and the quarter/final ladder.
The fixed one/four split is a proof, not LP2's adaptive block planner.

**Correctness [measured].** All eight combinations below passed at a
1728×1024 terrain view, art origin (0,300), under shared GPU load. These
are assertions, not accepted timing runs.

| Scene | Map | GPU MiB | Fresh coarse blocks | Visible final tiles retained | Final canvas after restoring the row |
| --- | ---: | ---: | ---: | ---: | --- |
| green-modern-2 | 4 | 512 | 4 | 35/35 | identical SHA-256 |
| green-modern-2 | 4 | 2048 | 1 | 35/35 | identical SHA-256 |
| green-modern-2 | 16 | 512 | 4 | 35/35 | identical SHA-256 |
| green-modern-2 | 16 | 2048 | 1 | 35/35 | identical SHA-256 |
| red-3 | 4 | 512 | 4 | 35/35 | identical SHA-256 |
| red-3 | 4 | 2048 | 1 | 35/35 | identical SHA-256 |
| red-3 | 16 | 512 | 4 | 35/35 | identical SHA-256 |
| red-3 | 16 | 2048 | 1 | 35/35 | identical SHA-256 |

Every case also checked interaction while held, release back to finals,
zero remaining preview blocks, a 36-event burst becoming exactly one
application, and zero console errors. The large
view's padded block is (0,256), 1728×1088; its four pieces have widths
896/832 and heights 576/512. By eye, the coarse picture has obvious four-art-pixel grain; the broad
cliff footprint appears aligned with the final. Fineness remains the
owner's judgment in the page.

**Bench [read/measured].** Commit `8b3d6779` credits the union of actual
painted rectangles from either cache, with their clips and input revision.
Overlaps cannot fill a missing strip, and stale overpaint removes fresh
coverage underneath. A synchronous composition gets one coverage
snapshot. Pixel comparisons still happen after timing stops. Four focused
coverage tests pass; all four injected modules compile against both main
and the prototype, and a deliberately missing anchor is rejected.

A 512 MiB continuous-stroke validation painted just one coarse quadrant;
the held-pause checks let all four finish. The coverage observer waits for
real coverage rather than assuming that every planned block finished.
How often the view catches up during a drag remains for the quiet runs.

The bench keeps first picture, pointer picture and whole-current endpoints;
it adds p90 and prints drag and resume separately, with held shares.
The page wait is a union of the feed-preparation wall interval and its
outstanding shape/Time GPU passes before the chunk starts. CPU/GPU overlap
is counted once. Input-to-current apart from that dependency and preview
render wall time apart from it print separately. The latter still includes
other queue waits. GPU clock uncertainty is reported. Resume is printed
but not judged, as the plan requires.

The first nominal 2,048 MiB validation revealed that the bench appended a
second `gpuMB` query while the page read the first, 512. Query options now
replace defaults, and every run checks the page's actual budget before
measuring. That attempt is explicitly excluded as 2,048 MiB evidence; the
verified-budget rerun produced one block. No timing from either run is
accepted.

**Regression checks.** All 34 scene comparisons against LP0c find
**0 differing pixels**. The three Modern Green height files also
match, so its realism figures remain 8.47/15 in both builds, with gates
17/16/9/5/17/17 and maximum slope p90 1.121 (conditions in LP0c's report).
The land tier passed: 209 unit tests, world-name gate, regional replay,
voxel checks, nine-world smoke/export with paged-map coverage, features,
passability and shape repeat. Workspace pointer/keyboard, undo, save and
tablet checks also passed, with zero console errors. Smoke used ports
11600–11602, features 11610, passability 11611 and workspace 11620, assigned
by a temporary launcher. LP0c's sampling fix is inherited:
six authorized scene pixels against main `8e42ae8e`; its 68 strict tile-size
comparisons remain zero. See [LP0c_REPORT.md](LP0c_REPORT.md).
`repro/check.sh` is unchanged.

**Still owed, by the owner's timing deferral.** Two alternating pairs of
main/prototype for both rocky fixtures, map4/map16 and 512/2048 MiB. Report
fixture-level p50/p90/p95 whole-current waits, held shares and page waits;
report resume apart. At 2,048 MiB the original p90 ≤300 ms and 3× main
floor remain pending, as does the >100 ms median page-wait flag. No quiet
guard or acceptance threshold was lowered. No LP0b Go, LP1, LP2 or LP4
implementation follows this report.

**Conditions and evidence.** Apple M3 Pro, 18 GiB, macOS 26.6.2 (25G83),
Chrome 157.0.8103.78, Node v24.5.0. Small assertion results and the
reproducible correctness driver and the deferred 32-run manifest are in
`~/terraform-assets/agent-lp0b/`.
Raw traces, profiles and generated images are removed after reading;
the owned server and its separate assets root remain for review.
