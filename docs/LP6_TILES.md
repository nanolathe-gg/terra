# LP6 final-tile decision and review status, November 13

The work stays on **live-preview/lp6**, based directly on cleaned main
**3aff1d1c**, in the same worktree. Main has not changed. The current review
units are:

- **00c7af8e:** [release completed preview memory to final Time pages](LP6_FINAL_MEMORY.md).
- **07b61c69:** [omit closed-gate bricks](LP6_VOXEL.md).
- **76abb569:** [correct primary-ray aliasing with bounded empty jumps](LP6_VOXEL.md).
- **0a778c74:** [fade in successive wear rounds](LP6_WEAR.md), with changed cliff detail for visual review.

The percentages from these separate comparisons must not be added. The
first memory unit's 12.1–14.3% view gain remains the strongest measured
whole-view result. The later units' evidence is deliberately qualified.

## Measure first: 512-pixel view tiles

**Measured:** one alternating page pair on the same wear build, Modern Green
2/map16 with translated strokes, terrain 1728×1024 at (2048,2300), default
**2048 MiB**. Own servers and separate CDP ports; first run per fresh server
was discarded earlier. Each run checks `ps` and passes three GPU-utilization
samples at or below 20%. Each final endpoint has one sample per run.
[Compact evidence](LP6_TILES_METRICS.json) includes input endpoints, frames,
GPU pass costs, memory, compile calls and final-tile costs.

| Requested and actual view grid | Release → view final | Release → focus final | Queue wait max | GPU submission max | Peak release GPU MiB |
| --- | ---: | ---: | ---: | ---: | ---: |
| 256 px | 3550.7 ms | 620.6 ms | 106.6 ms | 104.0 ms | 809.0 |
| 512 px | 2768.3 ms | 672.3 ms | 233.8 ms | 227.3 ms | 927.0 |

**Decision:** retain **256-pixel view tiles**. The larger grid makes the
whole view **22.0% faster**, but focus is 51.7 ms later and misses the
600-ms goal; the longest submission more than doubles. The 256 build also
misses the focus goal in this pair. Larger tiles would make that problem
worse, so the plan's acceptance condition is not met. The temporary source
edits were restored exactly; no comparison switch or second render path
remains. The 512 candidate's fresh final replay is exact, with zero of
1,769,472 pixels different and no console errors. No second fixture sweep
was needed to reject a candidate that already misses these limits.

## Final small checks

After restoring the grid, the original Green 2/map16 trouble window
(768,640), 512×256, matches at **128, 256 and 512-pixel native tile sizes:
zero differing pixels**. The assertion remains strict; no tolerance changed.
The hash matches the earlier wear candidate's window exactly.

A single **1×1-unit authored Green map** with landforms exports twice through
the page's WebAssembly exporter under Dawn and once through the native
exporter, from four identical art chunks. Archive and indexed-PNG bytes
match across all three; 298 unique tiles, no merges, no errors. This is a
small byte-validity/repeat check, not a large export benchmark or a claim
that changed art preserves the preceding build's archive bytes. Together
with the units' real page strokes, exact final replays, sampled height
hashes, unit tests and preview-overflow proof, it is the targeted correctness
coverage for this work. Broad scene, realism and control sweeps stay on demand.

## Next LP6 work

The owner still needs to review the march and wear sheets before landing.
The subsequent [sampled-shell unit](LP6_SHELL.md) compacts density and skips
full build/wear work outside its sampled band. It reports default-window
equality, extreme-setting drift and a full-cell audit; the probe remains an
approximation for visual review. A separate compact dispatch-list trial was
discarded. Even after this solid speedup, the repeated 512-grid trial misses
focus and submission deadlines, so 256-pixel view tiles remain. The earlier native
count-prediction trial showed only a 0.5% view gain and increased memory; no
final-pool or final-readback change is retained. Surface-atlas and per-landform
Time work remain conditional on evidence.

**LP6 is not complete; LP5 has not started.** The retained units are committed
for review, not merged or pushed. Their changed rendering inputs require a
fresh full preview bundle before a later push. Main's published LP3 bundle
remains unchanged. Raw bench outputs and temporary runtime files are deleted
after reading; only compact measurements and small review figures outside Git
are retained. Only this task's two servers are stopped.
