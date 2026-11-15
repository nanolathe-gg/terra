# LP5 shade visible color pixels, November 14

Cached native F passes now shade only the visible part of edge tiles. In
two alternating Modern Green Colors pairs, native-quality input p95 is
**110–142 ms**, with first-changed-pixel p95 **27–36 ms**. Whole-view cold
replay stays exact. In the final pair, area-weighted off-screen color work
falls from **103–118 ms per workload to zero**. This is scoped page evidence,
not full LP5 acceptance. Main stays a14c48c3; source remains on the same
review branch. [Unit evidence](LP5_VISIBLE_COLOR_METRICS.json).

## Partial pictures stay honest

The color pass uses a raster scissor, rounded outward to whole samples.
Its target, global sampling coordinates, geometry and derivative apron
stay unchanged. The bitmap still has its full tile dimensions; its valid
color rectangle is recorded separately. Painting clips to that rectangle,
and native-current/foreground checks require it to cover the tile's
visible portion. Newly exposed strips after a pan therefore request F
again. A partial native image cannot hide a covering coarse block for a
missing strip. Idle/cache snapshots use the same validity rule.

Resampled output and downsampled zoom views keep full F draws so their
filter kernels retain the neighboring pixels. Exact 1×/2× native sampling
uses the scissor; there is no separate shader. Export and feature-ground
reads still call their own full bake, independently of view bitmaps.
Once all visible native pixels are current, a stale coarse color record is
left alone until it is needed for uncovered ground. Four remains the
maximum submission size, with the existing budget/device shrink rule.

The bench forwards the view argument and derives each pass's world bounds
from its actual raster scissor. Painted coverage still uses the actual
valid rectangle; black/unpainted bitmap areas earn no latency credit.
Pass timestamps do not isolate helper-lane execution or individual pixels,
so the off-screen figure is the existing rectangle-based estimate.

## Focused measurements

Apple M3 Pro, map16 Modern Green 2, 1728 × 1024 at (0, 300), 2048 MiB,
36 owner-approved scripted Colors inputs per workload. The cold Crease
shade phase remains real mouse input. Order is clipped/base/base/clipped;
base is ae22ea2f. Process snapshots precede each run, each browser waits
for three GPU-driver samples ≤20%, and fresh-server warm-ups were already
discarded. The first pair precedes the final no-unneeded-coarse-draw guard;
the second pair measures the final source.

| Workload | Native-quality p95, pair 1, base → clipped | Pair 2 | Release final, pair 1 | Pair 2 |
| --- | --- | --- | --- | --- |
| Colors continuous | 153.9 → 110.3 ms | 143.6 → 141.8 ms | 51.8 → 39.0 ms | 46.3 → 38.3 ms |
| Colors with pause | 102.0 → 114.8 ms | 145.7 → 122.1 ms | 52.8 → 44.7 ms | 35.8 → 41.8 ms |
| Cold Crease shade | 97.2 → 89.6 ms | 93.2 → 132.0 ms | 52.7 → 40.3 ms | 45.4 → 47.2 ms |

The native color target holds in both sampled candidate runs. Tails vary:
there is no uniform speedup claim for the paused/cold rows. Peak terrain
memory is unchanged at about 1279 MiB; no slider long tasks or pipeline
compilations occur. Candidate submissions stay under 16 ms. The first
pair's pause includes one unneeded coarse pass (0.26 ms estimated outside);
the final guard removes it. The final pair's wholly-outside, mixed-region
and unknown-region F times are all zero.

An eight-tile trial raised first-change p95 to 100 ms and its largest
submission to 57 ms. It was rejected; its data are retained, and no larger
batch remains. View clipping removes work while keeping the four-tile bound.

## Selected cumulative checks against main

Before this scissor unit, ae22ea2f was compared directly with a14c48c3 on
three selected cases, one pair each. These are additional scope, not two-pair
acceptance or timings of the final scissor source.
[All endpoints and breakdowns](LP5_COLOR_CHECKPOINT_METRICS.json).

| Fixture and workload | Native-quality p95, main → review branch | Release final |
| --- | --- | --- |
| Modern Green 2, map16 large, Colors continuous / pause | 2012 / 1416 → 165 / 120 ms | 845 / 814 → 57 / 41 ms |
| Red 3, map16 large, ambient continuous / pause | 2088 / 1410 → 114 / 115 ms | 572 / 568 → 42 / 46 ms |
| Red 3, map16 large, Colors continuous / pause | 1754 / 1175 → 140 / 118 ms | 593 / 578 → 37 / 36 ms |
| Green 7, map4 1208 × 841, Colors continuous / pause | 1171 / 612 → 65 / 55 ms | 16 / 19 → 16 / 17 ms |

All six runs replay exactly with no console errors. Red's sampled cold
gate is 110 ms; Green's is 57 ms. The remaining Modern continuous Colors
tail motivated the scissor follow-up above. Colors stays explicitly labeled
scripted; no native popup timing is claimed.

## Targeted correctness

- Four feature-enabled scenes: 57,872 visible clipped pixels equal the
  corresponding full F pixels byte for byte; unpainted output is required
  to stay absent. Original interleaved/batched/full and retirement checks
  still pass, including the original Green 2 pixel location.
- Live 1× panning forward/back and 2× fractional panning both equal full
  cold scene replay, with zero changed pixels. The pan checker explicitly
  waits for scroll delivery before asking the renderer to become idle.
- Fractional 1.5× zoom keeps full filter aprons and matches cold replay.
  Geometry/Rain interruption still retires records correctly; 512-MiB
  lowering finishes at 495.6 MiB with no optional cache.
- Both page pairs replay the final 1,769,472-pixel view exactly. The fast
  CPU suite and world-name gate pass in about 1.6 seconds.

No new art drift, extra resource allocation or native/export shader change
is introduced here. The earlier compact interpolation still needs owner
visual review; broader fixture/zoom/budget coverage, controlled cold
compilation and Safari memory probing remain open. No broad export or
all-world suite was run.
