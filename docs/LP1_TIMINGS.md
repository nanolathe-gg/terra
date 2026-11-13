# Combined branch slider timings, 2026-11-12

Main `99d976c5` and review `3d4c88b7`, two alternating pairs at 1728×1024
terrain, 512 MiB terrain and 1,536 MiB heap, Chrome 157.0.8103.78. The
review combines LP0c, LP4 step 1 and LP1. Three consecutive driver GPU
samples at or below 20% preceded each run, with a process snapshot. One
warm-up was discarded on each fresh server. No correctness GPU work from
this task ran alongside timing. The extra stroke setup phases are excluded
from this focused row comparison. Every row below has 72 input observations.
No input was a no-op; all 360 review inputs bind to the page's native
serial/revision, and all 720 inputs across both builds reached whole current.

Endpoints give pooled p50 / p95 in milliseconds. Pointer tile is explicitly
`— / —`: these World inputs have no terrain pointer target. Final is the
conventional median of the two release-to-final endpoints. The following
table also gives the run spread rather than treating a tiny change as real.

| Build / workload | Changed pixels | First tile | Pointer tile | Whole current | Release-to-final median | Whole p95, two trials |
| --- | ---: | ---: | ---: | ---: | ---: | --- |
| main / knob-faceBlockSize continuous | 30.4 / 43.8 | 30.4 / 43.8 | — / — | 5494.0 / 6377.2 | 4607.2 | 6194.9, 6477.2 |
| review / knob-faceBlockSize continuous | 58.5 / 256.8 | 58.5 / 256.8 | — / — | 3072.5 / 3912.5 | 2179.7 | 3912.5, 3923.0 |
| main / knob-faceBlockSize pause | 37.5 / 92.9 | 36.4 / 88.5 | — / — | 6717.7 / 8593.2 | 5319.4 | 8693.7, 7417.7 |
| review / knob-faceBlockSize pause | 57.5 / 85.0 | 57.5 / 84.4 | — / — | 3080.6 / 4927.7 | 2174.9 | 4927.7, 4931.2 |
| main / knob-ambient continuous | 35.0 / 113.1 | 35.0 / 113.1 | — / — | 6206.1 / 8148.4 | 5450.1 | 6156.3, 8248.8 |
| review / knob-ambient continuous | 57.7 / 99.9 | 57.6 / 84.6 | — / — | 3129.5 / 3963.0 | 2233.6 | 3979.2, 3963.0 |
| main / knob-ambient pause | 28.6 / 105.7 | 28.6 / 105.7 | — / — | 6485.2 / 8684.4 | 5082.1 | 6834.4, 8801.0 |
| review / knob-ambient pause | 56.3 / 97.6 | 56.0 / 84.5 | — / — | 3032.8 / 4872.0 | 2141.4 | 4881.8, 4872.0 |
| main / knob-creaseShade cold-gate | 30.8 / 505.7 | 29.2 / 77.8 | — / — | 5327.6 / 6178.4 | 4429.9 | 6055.7, 6277.7 |
| review / knob-creaseShade cold-gate | 74.9 / 234.4 | 57.4 / 107.2 | — / — | 3116.3 / 3942.0 | 2216.0 | 3942.0, 3966.1 |

The continuous rock changed-pixel p95 regression (about 45 → 257 ms)
exceeds main's spread, as does the whole-current improvement (about 6.3 →
3.9 s). Those are different endpoints. LP0c makes tiles larger and fewer;
LP1 does not yet provide a whole-view preview. No near-instant interaction
claim follows from the faster final.

| Build / workload | Handler p95, two trials | applyKnobs p95, two trials | history.replaceState p95, two trials | Long task max | Pipelines compiled, two trials | GPU queue wall max | Peak GPU MiB |
| --- | --- | --- | --- | ---: | --- | ---: | ---: |
| main / knob-faceBlockSize continuous | 5.4, 7.0 | 1.2, 1.1 | 2.2, 1.5 | 0.0 | 0.0, 0.0 | 45.0 | 206.5 |
| review / knob-faceBlockSize continuous | 6.7, 6.2 | 1.5, 1.2 | 2.2, 2.1 | 0.0 | 0.0, 0.0 | 84.1 | 391.9 |
| main / knob-faceBlockSize pause | 4.5, 5.1 | 0.9, 1.2 | 1.8, 2.0 | 0.0 | 0.0, 0.0 | 57.0 | 206.5 |
| review / knob-faceBlockSize pause | 6.3, 9.1 | 1.4, 1.6 | 2.2, 3.4 | 0.0 | 0.0, 0.0 | 81.7 | 282.2 |
| main / knob-ambient continuous | 5.0, 6.2 | 1.2, 1.4 | 2.0, 2.6 | 0.0 | 0.0, 0.0 | 92.5 | 206.5 |
| review / knob-ambient continuous | 6.7, 6.7 | 1.5, 1.6 | 2.4, 2.4 | 0.0 | 0.0, 0.0 | 85.8 | 282.2 |
| main / knob-ambient pause | 3.5, 4.8 | 0.8, 1.1 | 1.4, 1.9 | 0.0 | 0.0, 0.0 | 76.6 | 206.5 |
| review / knob-ambient pause | 8.8, 6.3 | 1.6, 1.4 | 3.4, 2.2 | 0.0 | 0.0, 0.0 | 81.4 | 282.2 |
| main / knob-creaseShade cold-gate | 3.7, 3.8 | 0.9, 0.8 | 1.5, 1.5 | 0.0 | 1.0, 1.0 | 41.5 | 206.5 |
| review / knob-creaseShade cold-gate | 6.8, 6.3 | 1.7, 1.5 | 2.3, 2.2 | 0.0 | 1.0, 1.0 | 82.0 | 282.2 |

The cold gate still compiles one specialized set per run in both builds;
LP2 must remove that preview wait. There were zero console errors and no
held-input long tasks. Raw small JSON retains rAF intervals, the complete
handler callee split, bitmap copy time, per-kind GPU spans, pipeline keys,
heap accounting and outside/mixed-region GPU time. It is retained at
`~/terraform-assets/agent-live-preview-review/review-slider-timings.json`.
These results do not replace the larger LP0/LP4 matrix or deferred scene gates.
