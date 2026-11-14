# Live-preview landing, November 14

The owner authorized merging the reported `live-preview/lp6` work through
**e1476192** onto main. Latest remote main was **a14c48c3**, the exact base
of the reviewed stack. Fetching and merging main into the branch produced
no source changes or conflicts. The landing preserves the individual idea
commits; this record changes documentation only.

The approved work includes compact regional inputs and exact tile sampling,
packed retained weather/material inputs, fair continuing color sweeps,
bounded four-tile color batches, visible-only native F shading, corrected
coverage metrics, shared shape pipelines, coarse small-map Time, and
cancellation between bounded voxel stages. There is one engine and no
comparison switch or new control.

The [morning report](LP_NOV14_MORNING.md) retains scoped measurements and
remaining work. Selected measured results are 110–142 ms native-quality
large-view Colors p95, 98.4 / 91.7 ms small-map Rain p95, and a longest
sampled paused submission of 120.1 → 70.3 ms. The compact sampler moves
0.476% of one sampled large viewport; small view/export-art crops also move
pixels. Small-map Rain's measured release-final cost rises 8–11% in its
final pair. Those reported tradeoffs are included in the authorized landing;
the thresholds, exactness assertions and measurements are unchanged.

The rendering source is identical to the checked e1476192 build. Its 193
fast tests and world-name gate pass, alongside the scoped regional, exact
partition/cache/replay, Time-byte and cancellation-ownership checks recorded
in the individual reports. Main had not moved, so no unchanged runtime
checks, broad sweeps or timing runs are repeated for this documentation-only
landing record. The normal pre-push publication gate remains enabled, and
main's workflow runs its own quick checks and site build/deployment gates.

Authored previews are pinned to **previews-36f2d2e215a88130**, with their
published receipt. Its 41 PNG hashes are identical to the preceding a2de
bundle; freshness, publication, fetch and PNG/manifest checks already pass.
No PNGs, browser output or retail-derived files enter Git.

Universal Rain/color deadlines, partial-cache/device coverage, cold
compilation, adaptive time-based piece sizing, final focus deadlines, the
coarse-contour outlier, a qualifying Time-in-flight resume and Safari/iPad
validation remain open. This landing does not claim full LP3/LP4/LP5
acceptance. Raw outputs were deleted after compact evidence was committed;
owned servers were stopped. The main checkout's optional local preview-cache
refresh remains separate from this source landing and deployment.
