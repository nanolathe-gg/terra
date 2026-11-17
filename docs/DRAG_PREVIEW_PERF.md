# Drag and preview performance follow-up

This closes the drag/preview handoff dated November 16, 2026. All nine items
were tried and accepted or rejected below. Work is local: pushing and preview
bundle rendering/publication are outside this task. No saved map or generated
picture is committed.

The first preview implementation landed as `7facd967`. Follow-up implementation
commits are `5bb01716`, `abd6e698`, `6c1a808a`, `0c49aab3`, and `23b44da8`.
The branch reconciles the subsequent UX and material-workspace landings.

## Decisions

| Handoff item | Decision | Evidence and resulting behavior |
| --- | --- | --- |
| 1. Preview resolution | Accepted configurable resolution | View → Editor settings offers Automatic and 2/3/4/8 px. Automatic starts with 2 px for a small edit and 4 px for a large edit. The base choice is made once per gesture. Manual choices remain fixed while moving and persist in the existing editor preferences. Raster, image-copy, and geometry estimates use the actual chosen pixels. |
| 2. Gaps between GPU submissions | Accepted batching and removal of the shape completion wait | **Measured:** an authored 256 px tile uses 20 submissions instead of 23, with an identical final RGBA hash. Geometry clear joins its first voxel draw; mask packing, color, and presentation share one submit. A preview's shape, feed, and Time use the same queue, so the feed no longer waits for shape completion on the page. Immediate-reader GPU coverage matches a fresh replay. |
| 3. Back off under load | Accepted Automatic backoff and recovery | **Measured in Chrome:** a calibrated 33.2 ms pressure pass made a large move change 4 → 8 → 4 px. Manual 4 px stayed at 4 px. Zero console errors. Raster and solid get coarser together; the source lattice remains in place, avoiding a new Time result merely because quality changed. |
| 4. Voxel solid during a drag | Accepted a coarser first Auto picture; rejected partial-column caching | **Measured:** first-picture voxelBuild in the profiled stroke fell from 4.5 to 1.0 ms. Normal solid detail follows on subsequent moving pictures. A planner trial invalidated 55.6–60% of stroke columns and 100% of mountain-move columns; see the rejected alternatives below. |
| 5. Pointer CPU work | Accepted overlay culling/coalescing and cheaper lookups | **Measured:** stroke overlay CPU fell from 100.8 to 11.4 ms in approximately one-second profile windows. Off-screen map edges and player starts need no height samples. Pointer events share a frame's overlay redraw. Projected transforms skip unused inverse terrain picks. Repeated numeric lookups and temporary rock arrays were removed. |
| 6. Small maps | Accepted deferred canonical field evaluation | **Measured at an 8 ms pointer:** 2.80 → 1.00 shape passes per picture on the authored map4 fixture; 69 → 72 pictures. Held edits announce invalidation immediately but merge until a GPU/CPU reader or release. A GPU test verifies twenty held edits become one evaluation and equal a fresh replay. |
| 7. Quality after release | Accepted early page Time during paused moves and control edits; rejected stroke prefetch | **Measured in one 700 ms hold trial:** move release-to-last-visible-final was 1589 → 1089 ms. GPU coverage verifies held refinement equals fresh replay and release reuses it. A stroke trial was 863 → 944 ms; commit simplification changes that shape again, invalidating the warmed result. Strokes therefore retain deferred refinement. |
| 8. Standard fast-pointer measurement | Accepted | `repro/perf.mjs` defaults to an 8 ms in-page pointer stream after a real press. It records the driver, fresh compositions, picture gaps, pass counts, and the union of overlapping GPU intervals. `--pointer-ms 0` retains the explicitly slow CDP workload; `--quiet-gpu` opts into the strict quiet-start gate. |
| 9. Generated export output | Accepted | `export-bytes-out/` is ignored. Validation also uses an explicit output directory outside the checkout. |

## Rejected alternatives

- **Filtered 4 px painting — by eye:** the trial softens block edges but blurs
  terrain grit and face detail. The selectable 2 px and 3 px rasters retain
  more useful detail. No additional filtering control was added.
- **Partial-column solid caching — planner measurement:** a conservative dirty
  footprint, expanded by the bake reach and six voxel steps, touched
  55.6–60% of stroke columns and every column on a mountain move. The growing
  stroke also changed its solid window eight times in 62 measured pictures.
  Preserving compacted brick addresses across those windows would require a
  larger persistent cache. A full incremental solid implementation was
  rejected after this planning trial; it is not claimed to have been built.
- **Early Time for drawn strokes — measured and inspected:** the hold trial did
  not improve release time, and release simplification changes the node again.
  Moves and held controls can reuse their warmed Time without that replay.
- **One more bake/allocation merge — measured:** experiment `8f77116e` on
  `perf/submit-prefix-trial` reduced 20 submissions to 19 with identical final
  pixels. In two alternating fixed-4-px, 120 Hz comparisons, baseline strokes
  produced 94/93 pictures versus 95/92, and moves 64/65 versus 65/65. Median
  picture gaps remained 14 ms for strokes and 20 ms for moves. This neutral
  trial stays off main; the accepted path preserves overlap between the relief
  bake and voxel resource preparation.

## Measurement limits

GPU time is the union of pass intervals. Summed pass durations double-count
work that overlaps, particularly voxel construction and geometry. The GPU is
shared, so disturbed runs are not speed claims. A single shape pass around
1.2–1.7 ms identifies the quiet phases used for comparisons. The final
submit-prefix comparison's shape pass was 1.26–1.37 ms.

The early follow-up profiles used the saved 8×8 workload, 2048 MiB, and a
1224×1045 terrain viewport. Those CPU windows precede the later unrelated
material-workspace landing. **Measured:** the numeric-reach microbenchmark
returned identical values and took 85–91 ms instead of 113–122 ms for 20,000
calls, alternating implementations over three rounds.

Automatic feedback averages four completion intervals because Chrome can
return multiple completion callbacks together. Three sustained observations
above 40 ms lower quality one step. Recovery requires a sustained fast run
and at least 500 ms of dwell. Idle time and a rebuilt preview Time source
restart the cadence window. Manual choices do not feed or obey adaptation.
**By eye:** the first Auto solid is visibly rougher but usable as a first
picture; subsequent pictures and final art refine it.

## Validation

- Quick: 280 unit tests and the world-name gate passed on the combined UX
  branch. After the final material-workspace merge, its affected material unit
  tests and full workspace/Pick browser check passed again.
- Engine: all 18 GPU checks passed, including new canonical-demand, held-Time,
  and immediate preview-reader checks. Authored Green landform regional replay
  and repeat determinism passed.
- Browser: Green brush/undo smoke; all five preview choices, actual raster
  sizes, mid-gesture preference locking, focus, and reload persistence;
  desktop/tablet workspace, Pick, and material workspace interactions passed.
- Features: placement, selection, transforms, undo, rejected overlap, recipes,
  world switches, custom-world import/export, and archive export passed. Two
  test replays now use the in-place model API rather than an importer that may
  navigate to the saved world.
- Export: two WebAssembly exports and the native export of Green 4 landforms
  have identical archive and indexed-PNG hashes.
- Cache freshness: 48 visible-tile comparisons against fresh bakes,
  zero differing tiles, zero console errors.
- Full Green digest sweep passed: every changed pair changed its checksum,
  zero unexplained controls, and no guard escapes.

Broad other-world performance sweeps and preview publication were deliberately
left on demand. No work in the accepted/rejected handoff plan remains open.

For future measurements, use an owned server/CDP pair and an external output
directory, for example:

```sh
node repro/perf.mjs map4 --scene repro/shape-scenes/green-landform.json \
  --server http://127.0.0.1:8992 --port 9791 \
  --query gpuMB=2048 --only drag --no-export --no-sliders \
  --out /tmp/terraform-perf
```
