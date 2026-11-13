# LP3 step 1 focused timings, 2026-11-12

Measured in Chrome on the M3 Pro, large Green Modern 2/map16, 1728×1024,
2048 MiB for both builds. Two alternating pairs, main `222ace7a` and review
`0734e877`. Fresh-server warm-ups were discarded; every run passed the
three-sample ≤20% GPU quiet-start guard and recorded its process snapshot.
The row setup points the real mouse at the center before timing, matching
its unchanged focus target. No timing path or acceptance threshold changed.

All times are p50 / p95 milliseconds, pooled only within this fixture and
build. The compact evidence retains every phase's frame, handler/callee,
queue, pipeline, GPU-pass, copy, memory and off-screen distributions.

| Phase | Build | First changed | First tile | Pointer tile | Whole current | Release → final |
| --- | --- | ---: | ---: | ---: | ---: | ---: |
| load | main | 59.3 / 62.5 | 59.3 / 62.5 | — | 2138.5 / 2188.8 | 7374.7 / 7433.8 |
| load | review | 510.3 / 543.4 | 510.3 / 543.4 | — | 510.3 / 543.4 | 2867.5 / 2886.4 |
| drag | main | 30.7 / 49.5 | 30.7 / 49.5 | 78.8 / 1547.7 | 6774.5 / 7674.5 | 5725.2 / 5777.0 |
| drag | review | 69.6 / 96.0 | 17.9 / 95.3 | 69.6 / 96.0 | 69.7 / 96.1 | 3088.7 / 3137.0 |
| release | main | 13.2 / 17.4 | 13.2 / 17.4 | — | 5725.2 / 5777.0 | 5725.2 / 5777.0 |
| release | review | 23.4 / 491.8 | 12.5 / 17.2 | — | 3088.7 / 3137.0 | 3088.7 / 3137.0 |
| resume | main | 31.1 / 81.4 | 31.1 / 81.4 | 77.2 / 1405.9 | 6512.7 / 7231.4 | 5626.7 / 5763.5 |
| resume | review | 69.4 / 97.6 | 69.4 / 97.6 | 69.4 / 97.6 | 69.4 / 97.6 | 3026.9 / 3116.2 |
| knob-faceBlockSize continuous | main | 33.4 / 36.9 | 33.4 / 36.9 | — | 5678.1 / 6492.7 | 4741.7 / 4805.8 |
| knob-faceBlockSize continuous | review | 52.1 / 90.4 | 52.1 / 90.4 | — | 52.1 / 90.4 | 2291.5 / 2393.0 |
| knob-faceBlockSize pause | main | 33.6 / 44.2 | 33.6 / 44.2 | — | 5779.3 / 7579.4 | 4828.5 / 4892.2 |
| knob-faceBlockSize pause | review | 53.2 / 90.7 | 53.2 / 90.7 | — | 53.2 / 90.7 | 2320.5 / 2332.7 |
| knob-creaseShade cold-gate | main | 55.7 / 83.7 | 55.7 / 63.7 | — | 5724.7 / 6555.0 | 4816.6 / 4835.2 |
| knob-creaseShade cold-gate | review | 51.6 / 90.0 | 51.6 / 90.0 | — | 51.6 / 90.0 | 2367.6 / 2371.4 |

Individual review p95: strokes 97.6 and 95.3 ms; continuous rock 90.4 and
90.7 ms. Both meet the focused 100-ms whole-view target. Against the prior
LP2 runs, the timing change is smaller than main's spread in those cells:
**no additional latency gain is claimed**. The memory saving is measured:
peak accounted terrain memory is about 856 MiB, versus about 994 MiB in
the preceding LP2 batch. The sampled input allocation reduction and the
one-block 512-MiB result are in [LP3_PROGRESS.md](LP3_PROGRESS.md).

Release-to-final remains about 45–52% below main. The actual centered focus
tile finishes 61–289 ms after rock pause/release, passing 600 ms there.
Stroke focus is 602–652 ms and remains outside that budget. There are no
long tasks or console errors, and no pipeline starts before either cold
preview. Both resumed strokes have Time in flight at their 100-ms restart.
Frame p95 stays about 16.8 ms. Rock input-handler p95 is below 1 ms.

The remaining largest submission is about 152 ms, from the quarter
preview's combined solid/wear/draw work; final submissions also reach
about 112 ms. That is the next LP4 target. First changed pixels still miss
50 ms. Other scenes, map4, the smaller view and low-budget latency remain
pending; the 512-MiB proof so far establishes block count and memory, not
latency. Broader final-pixel and export checks have not yet been repeated
for this combined build. This is focused evidence, not full card acceptance.
