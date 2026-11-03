# Original / Go-wgpu performance comparison

Branch: `prototype/go-wgpu`, isolated worktree
`/Users/daniel/src/terraform-wt-go-wgpu`. Original: current main `dfee4b4`.
The branch is not merged into main.

## Run the comparison

The current session has independent servers:

- Original: <http://127.0.0.1:8890/sculpt>
- Go/wgpu: <http://127.0.0.1:8891/sculpt>

Use the same world, map size, zoom and recipe in both editors. For repeated
measurements in fresh Chrome processes:

```sh
cd /Users/daniel/src/terraform-wt-go-wgpu
node repro/compare-performance.mjs \
  --original http://127.0.0.1:8890 --wgpu http://127.0.0.1:8891 \
  --runs 3 --tools hill,landform --map map4 \
  --out /private/tmp/terrain-performance-comparison
```

Each run scripts the same scene, drag and pan. The order reverses between
repetitions. Raw events, timings and console output remain beside summary.json.
A refused render or browser error fails the run. Do not run another GPU test or
editor while collecting timings. `--map map8` checks the larger paged engine.

For separate diagnostic checks, use `repro/perf.mjs` with `--verify-pixels` and
`--verify-picked`. Pixel readback perturbs timing, so it is excluded from the
normal comparison. `--diagnostic-gpu` adds original-only GPU timestamp and CPU
stage instrumentation; its results are not a fair cross-build timing comparison.

## What the measurements mean

**First visible tile** measures from the scripted move mark to the first
actually drawn new bitmap whose source revision includes that move. The tile
can be unrelated to the edited area. Cached redraws do not qualify.

**Pointer overlap** applies the same test but requires the tile to intersect a
radius-sized square around the projected pointer. This is an approximation of
nearby feedback; the projected brush is not necessarily a square, and overlap
alone does not prove that changed pixels appeared under the pointer.

**Pixel verification** independently checks a 16×16 patch at the pointer for
changed pixels. It is a separate diagnostic, not an uninstrumented latency
measurement. **Picked coordinates** compare the actual terrain points chosen by
the two editors, rather than assuming identical screen input means identical
world coordinates.

Frame intervals measure UI scheduling, not GPU completion or physical
input-to-display delay. Scene timing starts after boot. Completion based on
new tile events cannot certify unchanged retained tiles; missing completion
values are reported as unavailable. Cache counters describe explicitly owned
images/fields, not whole-browser or driver memory.

## Implementation changes

- Viewport pixels stay on the GPU. A reusable OffscreenCanvas produces a
  transferable ImageBitmap, with byte-exact GPU downsampling. Captures and
  exports retain their required readbacks.
- Authored page gathering uses one compute dispatch per page instead of seven
  copy commands per row. Regional invalidation retains unaffected pages and
  images. Prepared stroke nodes and typed graph comparisons avoid repeated JSON
  preparation.
- Changed graph suffixes cross the Worker boundary with checked sequence
  numbers. Dropped queued jobs still update the receiver's graph baseline in
  message order. A 100-node unchanged graph fixture shrinks from 6,582 to 34
  wire bytes; this is a payload measurement, not a latency ratio.
- A microtask coalesces UI view requests. One bounded tile finishes while newer
  requests replace the pending snapshot. Dragging retains the original full
  mesh/shading quality with quarter-sized output and weather deferred until
  release. Fit mesh density follows display scale, as in the original.
- Ordinary view validation reports errors asynchronously. Initialization,
  capture, export and native rendering retain strict checks. GPU-owned fences
  cover even canceled work before the first bitmap. UI admission acknowledgments
  bound transferred-image residency before another GPU allocation.
- Picking coverage is independent of image coverage. Bounded projected-height
  windows refresh after gestures and on cached-image revisits. They omit the
  material/shading apron and preserve cached pictures when heights are evicted.
- Weather gathering uses two raw-u32 compute dispatches per page instead of
  13 copies per row (6,656 calls for a 512-row page). Copies preserve float bits,
  masks, nonzero origins and optional fields. A cached weather page that contains
  the requested window feeds the draw directly, avoiding a duplicate buffer.
- All weather pages can borrow unused authored-cache capacity within the
  unchanged combined cap. Previously, reserved UI bitmap space could push the
  canonical weather page over its separate allowance, causing full weather
  recomputation for every tile. Cache limits reserve space for browser bitmaps
  and evict old pages before allocation. No budget was raised to pass timings.
- Navigation uses authored quarter-size previews while moving, retains valid
  detail, and finishes weather/heights after a 180 ms quiet period. Terrain
  ray picking and expensive overlays wait until navigation stops.
- Cache pages record their submitted GPU uses and wait before ownership and
  accounting are released. Transient view feeds retain asynchronous presentation.
  Time/material scratch destruction keeps the original stage completion waits.
  This bounds managed resources; it does not measure total driver/browser peak.

## Verification and measured results

Measurements use this Apple M3 Pro, Chrome WebGPU, a 1020×989 viewport and the
Green fixture. Values are medians across runs, Hill / Landform, in milliseconds.
The 4×4 test has three alternating pairs per tool (12 runs); the 8×8 test has
two pairs per tool (8 runs). All 20 runs completed with zero console errors and
zero censored moves: 210/210 per build/tool at 4×4 and 140/140 at 8×8.
The repeated comparison used `5624027`; final resource-lifetime fixes at
`49c7046` were checked separately below.

### 4×4 map

| Metric | Original | Go/wgpu |
| --- | --- | --- |
| First visible new tile p50 | 16.3 / 16.2 | 32.8 / 31.5 |
| First visible new tile p95 | 18.6 / 17.4 | 40.7 / 37.2 |
| Pointer-overlapping new tile p50 | 97.0 / 96.9 | 32.8 / 31.5 |
| Pointer-overlapping new tile p95 | 279.2 / 279.4 | 40.7 / 37.2 |
| Drag frame interval p95 | 16.8 / 16.7 | 16.8 / 16.7 |
| Scene complete after boot | 1,063.1 / 1,059.1 | 697.9 / 714.9 |
| Release to full picture | 571.8 / 570.0 | 586.2 / 524.4 |
| Pan frame interval p95 | 16.8 / 16.8 | 16.8 / 16.7 |
| Pan stop to full picture | unavailable / unavailable | 541.1 / 527.0 |

### 8×8 map

| Metric | Original | Go/wgpu |
| --- | --- | --- |
| First visible new tile p50 | 16.2 / 16.2 | 33.1 / 31.7 |
| First visible new tile p95 | 18.1 / 18.0 | 40.2 / 36.4 |
| Pointer-overlapping new tile p50 | 96.6 / 96.1 | 33.1 / 31.7 |
| Pointer-overlapping new tile p95 | 280.0 / 273.5 | 40.2 / 36.4 |
| Drag frame interval p95 | 16.8 / 16.7 | 16.8 / 16.8 |
| Scene complete after boot | 999.6 / 1,026.1 | 801.9 / 817.8 |
| Release to full picture | 638.8 / 621.8 | 680.8 / 657.4 |
| Pan frame interval p95 | 16.7 / 16.8 | 16.8 / 16.7 |
| Pan stop to full picture | 485.2 / 477.0 | 597.4 / 610.0 |

Nearby feedback is substantially faster, and drag/pan frame pacing stays at
16.7–16.8 ms. Scene completion is faster. Release completion is mixed: about
8% faster to 3% slower at 4×4, and 6–7% slower at 8×8. First-new-tile-anywhere
latency still takes about twice as long, even though that tile can be unrelated
to the edited area. Final 8×8 detail after panning takes about 0.60 s versus
0.48 s (23–28% longer); the editor stays responsive during that work. These
results do not support an unqualified claim that every aspect is faster.

Original 4×4 pan completion cannot be certified from new-tile events because
unchanged retained tiles emit no fresh bake. Missing values are not discarded
when calculating medians. The cache counter is 32,204,916 bytes at 4×4 in Go,
including picking heights, versus 19,435,520 bitmap bytes in the original;
at 8×8 it is about 37.7 MB versus 28.1 MB. These are different accounting scopes,
not comparable whole-process memory peaks.

### Final-source checks and diagnostic limits

After the independent review's resource-lifetime fixes, `49c7046` Hill runs
measured nearby feedback p95 37.2 ms at 4×4 and 39.2 ms at 8×8, with all 70/70
moves measured in each. Drag/pan frame intervals were 16.7–16.8 ms, release
completion 533/697 ms, scene completion 685/830 ms and pan completion 534/636 ms.
Both runs had zero errors. These are single final-source checks, not replacements
for the repeated comparison above.

Separate pixel-readback diagnostics verified changed pixels at the Hill pointer
for all 70/70 moves in each editor. Observed diagnostic latency was p50/p95
188.7/326.3 ms in the original and 40.5/61.3 ms in Go. Readback changes the
workload, so these are supporting evidence rather than normal interaction timing.
The actual Hill terrain paths differed by at most 0.6472 art pixels despite
identical screen input. The front-to-back picking algorithm matches the original;
exact sampled-coordinate parity is not claimed.

The same Landform diagnostic verified 67/70 pointer patches in the original and
63/70 in Go, with zero probe errors, zero console errors and all 70 terrain
coordinates recorded in each. Both diagnostic commands exit 1 because not every
patch changed. A 16×16 tip patch does not establish whether the wider Landform
region changed; changed-pixel latency is therefore inconclusive for this tool
and no ratio is claimed. Normal revision/presentation measurements cover all
70 moves in each run. The maximum picked-coordinate difference is again
0.6472 art pixels.

Final-source regressions also pass: cached picking retains 30 images while
refreshing only evicted heights; all 30 image admissions respect their
reservation; 128 MiB GPU/heap tests restore identical pixels after a deliberate
oversized-job refusal; zoom restores identical pixels and 3,211,264 regional
packed bytes; foreground RPCs and cancellation reply correctly; all 16 Green
brushes draw/undo, including the paged 8×8 path. A real 8×8 browser export
contains 17,436,672 exact art pixels and zero clamped cells. Export cancellation
passes at start/chunk/finish with no abandoned jobs. Ghost sampling returns 443
points and four independent GPU checks differ by zero. These runs have no
browser console errors.

The final 27-scene RGBA rerun matches 28,311,552 pixels exactly. Native Metal
hardware tests, race tests and native/WASM vet pass. Two browser-free Hill
exports produce identical archive, indexed PNG and height bytes; Landform also
exports through the Apple M3 Pro Metal adapter. See the
[spike report](GO_WGPU_SPIKE.md) for full validation scope and platform limits.

### Evidence

All paths are private local artifacts, intentionally outside git:

- `/private/tmp/terraform-go-opt/final-map4/summary.json`: 12-run comparison.
- `/private/tmp/terraform-go-opt/final-map8/summary.json`: 8-run comparison.
- `/private/tmp/terraform-go-opt/cache-lifetime`: final-source Hill checks.
- `/private/tmp/terraform-go-opt/verified-original-hill` and
  `verified-go-hill`: changed-pixel and actual-picking diagnostics.
- `/private/tmp/terraform-go-opt/verified-original-landform` and
  `verified-go-landform`: qualified Landform diagnostic results.
- `/private/tmp/terraform-go-opt/final-*.log`, `final-pixel-comparison.json` and
  `native-repeat.json`: final-source regression and deterministic-export evidence.

Earlier development results include failed preflight checks, a weather-cache
admission regression, and slow paged-map navigation. They led to the fixes above
and are not used as accepted measurements. The comparison harness, raw events,
complete-run summaries and explicit unavailable counts make the remaining costs
reviewable and reproducible.
