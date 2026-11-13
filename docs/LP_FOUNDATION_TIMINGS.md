# Completed-foundation browser comparison, November 13, 2026

Main `222ace7a` versus review `fd7f8139`. Benchmark blob `ccd57760c0b4`. Terrain budget 512 MiB in both fixed-budget builds. 8 completed sessions across 2 fixtures. Two alternating pairs are required for a completed fixture; incomplete fixtures are labeled.

Completed LP0c/LP4-step-1/LP1 checkpoint against current main, two alternating main/review pairs per focused fixture, 1728x1024 terrain, 512-MiB unchanged default on both. Own servers 8904/8902, unique CDP ports; fresh main server warm-up discarded; existing candidate server warm-up already discarded. ps snapshot and unchanged <=20% quiet-start guard before each run. Scripted Colors is the authorized picker substitute. Export checked separately.

Times are milliseconds. Latency columns are p50 / p95 pooled only within one fixture and build. Inputs superseded during a gesture wait for a later current image. The final column uses the last pause/release anchor in each session. A mid-drag pause that never becomes final remains censored in the underlying evidence. `—` means that the gesture supplies no terrain pointer or the metric has no sample. Colors uses scripted value/input events on the existing picker; the five row workloads use real mouse drags. No final endpoint or threshold was changed.

| Fixture | Build | Stroke whole p95 | Rock whole p95 | Colors whole p95 | Release final median | Load final median | Worst final-cost change¹ |
| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: |
| green-modern-2/map16/1728x1024 | main | 7739.3 | 6627.6 | 6272.8 | 5829.6 | 7403.9 | — |
| green-modern-2/map16/1728x1024 | review | 3791.0 | 4243.3 | 3474.6 | 3041.7 | 3686.5 | -44.7% (knob-ambient pause) |
| green-7/map16/1728x1024 | main | 3122.9 | 3080.2 | 2465.7 | 2970.9 | 4086.2 | — |
| green-7/map16/1728x1024 | review | 3210.7 | 3114.1 | 2554.6 | 3052.4 | 4224.8 | +4.5% (colors continuous) |

Load rows use the separate corrected-marker supplement, benchmark `c6095629e43f`; other rows use the full-session benchmark above. Each load fixture also has two alternating pairs. The older censored load samples are excluded. Reported percentiles use nearest rank; the final-cost gate uses the arithmetic median of the two per-run final endpoints.

¹ Largest ratio of the two-run final medians among phases, evaluated fixture by fixture. A difference smaller than main’s own two-run spread is treated as no established difference. No ratio pooled across fixtures can hide a failed cell.

Final-cost cells over 10% and larger than main’s own spread: **0**.

## green-modern-2/map16/1728x1024

| Build / phase | First changed | First tile | Pointer tile | Whole current | Pause/release → final |
| --- | ---: | ---: | ---: | ---: | ---: |
| main / load | 55.3 / 55.9 | 55.3 / 55.9 | — / — | 2136.5 / 2137.5 | 7403.2 / 7404.5 |
| main / drag | 30.6 / 39.7 | 30.6 / 39.7 | 78.3 / 1559.4 | 6839.2 / 7739.3 | 5818.7 / 5840.5 |
| main / release | 13.0 / 13.2 | 13.0 / 13.2 | — / — | 5818.7 / 5840.5 | 5818.7 / 5840.5 |
| main / resume | 30.3 / 92.2 | 30.3 / 92.2 | 78.0 / 1446.8 | 6680.7 / 7413.0 | 5863.5 / 5882.5 |
| main / scroll | 33.2 / 34.1 | 33.2 / 34.1 | — / — | 6307.0 / 6481.0 | 6302.5 / 6477.2 |
| main / knob-faceBlockSize continuous | 56.8 / 58.6 | 56.8 / 58.6 | — / — | 5778.5 / 6611.0 | 4872.6 / 4890.3 |
| main / knob-faceBlockSize pause | 41.0 / 59.4 | 41.0 / 59.4 | — / — | 5930.6 / 7758.5 | 5020.5 / 5041.6 |
| main / knob-reliefAmount continuous | 50.1 / 84.8 | 49.8 / 84.4 | — / — | 5883.6 / 6708.6 | 4970.8 / 4995.3 |
| main / knob-reliefAmount pause | 55.0 / 64.0 | 55.0 / 64.0 | — / — | 5616.5 / 7426.7 | 4688.3 / 4730.6 |
| main / knob-ambient continuous | 30.6 / 32.3 | 30.6 / 32.3 | — / — | 5341.7 / 6166.2 | 4428.7 / 4456.7 |
| main / knob-ambient pause | 31.0 / 55.4 | 31.0 / 55.4 | — / — | 5358.3 / 7198.6 | 4461.6 / 4472.2 |
| main / knob-sunHeight continuous | 32.5 / 34.1 | 32.5 / 34.1 | — / — | 5423.9 / 6254.8 | 4517.7 / 4534.9 |
| main / knob-sunHeight pause | 34.0 / 47.6 | 34.0 / 47.6 | — / — | 5792.8 / 7593.1 | 4807.9 / 4905.5 |
| main / knob-erosionRain continuous | 1279.3 / 2096.0 | 1279.3 / 2096.0 | — / — | 6266.2 / 7109.5 | 5301.3 / 5423.7 |
| main / knob-erosionRain pause | 832.6 / 1236.6 | 832.6 / 1236.6 | — / — | 6274.6 / 8124.8 | 5332.2 / 5381.7 |
| main / colors continuous | 45.3 / 76.7 | 45.3 / 76.7 | — / — | 5638.2 / 6235.2 | 4934.8 / 4986.6 |
| main / colors pause | 44.7 / 79.1 | 44.7 / 79.1 | — / — | 5722.6 / 7307.0 | 4979.5 / 5057.9 |
| main / knob-creaseShade cold-gate | 33.2 / 133.7 | 33.1 / 82.9 | — / — | 5849.2 / 6666.0 | 4927.7 / 4963.1 |
| review / load | 61.0 / 63.3 | 61.0 / 63.3 | — / — | 806.4 / 822.0 | 3677.3 / 3695.7 |
| review / drag | 34.4 / 81.9 | 32.9 / 58.1 | 80.2 / 963.8 | 3170.7 / 3781.9 | 3012.2 / 3071.1 |
| review / release | 462.4 / 464.2 | 14.5 / 462.4 | — / — | 3012.2 / 3071.1 | 3012.2 / 3071.1 |
| review / resume | 33.6 / 82.6 | 31.9 / 46.9 | 51.3 / 96.1 | 1211.1 / 3694.2 | 2987.0 / 3068.3 |
| review / scroll | 31.4 / 33.5 | 31.4 / 33.5 | — / — | 2810.0 / 2838.8 | 2859.6 / 2889.1 |
| review / knob-faceBlockSize continuous | 60.6 / 109.2 | 60.1 / 104.0 | — / — | 3391.8 / 4242.3 | 2486.4 / 2504.0 |
| review / knob-faceBlockSize pause | 62.6 / 105.8 | 62.6 / 105.8 | — / — | 3398.2 / 5259.2 | 2483.1 / 2486.2 |
| review / knob-reliefAmount continuous | 72.2 / 113.3 | 72.1 / 110.9 | — / — | 3311.1 / 4183.4 | 2387.9 / 2412.0 |
| review / knob-reliefAmount pause | 70.3 / 112.8 | 70.3 / 112.8 | — / — | 3406.5 / 5206.0 | 2430.1 / 2468.9 |
| review / knob-ambient continuous | 61.7 / 105.6 | 61.7 / 105.6 | — / — | 3335.6 / 4194.4 | 2381.4 / 2439.2 |
| review / knob-ambient pause | 62.3 / 103.1 | 62.3 / 103.1 | — / — | 3354.8 / 5204.7 | 2466.6 / 2472.0 |
| review / knob-sunHeight continuous | 61.9 / 107.7 | 61.1 / 103.4 | — / — | 3177.5 / 4029.3 | 2265.0 / 2290.2 |
| review / knob-sunHeight pause | 56.9 / 88.2 | 56.9 / 88.2 | — / — | 3226.1 / 5038.8 | 2301.1 / 2339.1 |
| review / knob-erosionRain continuous | 1281.0 / 2105.7 | 1281.0 / 2105.7 | — / — | 3609.2 / 4434.3 | 2696.4 / 2717.1 |
| review / knob-erosionRain pause | 856.1 / 1263.6 | 856.1 / 1263.6 | — / — | 3765.1 / 5589.7 | 2849.1 / 2872.8 |
| review / colors continuous | 58.4 / 95.1 | 58.4 / 95.1 | — / — | 2851.2 / 3465.6 | 2178.5 / 2181.1 |
| review / colors pause | 61.5 / 99.1 | 61.5 / 99.1 | — / — | 3011.2 / 4614.1 | 2293.0 / 2340.9 |
| review / knob-creaseShade cold-gate | 66.0 / 154.8 | 57.0 / 100.1 | — / — | 3090.4 / 3934.8 | 2196.9 / 2236.5 |

Ancillary p50/p95 values below are the larger per-run percentile at each rank, maxima are over the two runs, and outside-region GPU times sum the two runs. GPU/CPU overlap and phase overlap mean these columns must not be summed. GPU timestamp uncertainty and uncensored sample counts remain in the compact evidence.

| Build / phase | rAF p50 / p95 | Long task max | Handler p50 / p95 | Queue wait max | GPU submission max | Bitmap p50 / p95 | Sets built | GPU / heap peak MiB | Wholly outside / mixed GPU |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| main / load | 16.7 / 16.8 | 0.0 | 0.0 / 0.0 | 195.7 | 183.3 | 0.0 / 0.1 | 0 | 365.3 / 132.4 | 18.0 / 2587.8 |
| main / drag | 16.7 / 16.8 | 0.0 | 0.0 / 0.0 | 16.2 | 14.3 | 0.0 / 0.1 | 2 | 349.6 / 93.1 | 0.0 / 2834.9 |
| main / release | 16.7 / 16.8 | 0.0 | 0.0 / 0.0 | 222.0 | 205.5 | 0.0 / 0.1 | 0 | 349.6 / 93.1 | 0.0 / 2572.3 |
| main / resume | 16.7 / 16.8 | 0.0 | 0.0 / 0.0 | 216.0 | 203.3 | 0.0 / 0.1 | 0 | 349.8 / 109.0 | 0.0 / 3133.9 |
| main / scroll | 16.7 / 16.8 | 0.0 | 0.0 / 0.0 | 31.6 | 24.5 | 0.0 / 0.1 | 0 | 410.0 / 134.0 | 56.8 / 2254.4 |
| main / knob-faceBlockSize continuous | 16.7 / 16.7 | 0.0 | 4.5 / 5.2 | 41.3 | 39.3 | 0.0 / 0.1 | 0 | 350.1 / 107.7 | 0.0 / 1669.5 |
| main / knob-faceBlockSize pause | 16.7 / 16.8 | 0.0 | 4.3 / 5.6 | 42.6 | 40.2 | 0.0 / 0.1 | 0 | 350.1 / 107.2 | 0.0 / 1669.4 |
| main / knob-reliefAmount continuous | 16.7 / 16.8 | 0.0 | 4.4 / 5.1 | 43.6 | 39.6 | 0.0 / 0.1 | 0 | 364.6 / 112.2 | 0.0 / 1664.6 |
| main / knob-reliefAmount pause | 16.7 / 16.7 | 0.0 | 3.6 / 4.1 | 46.9 | 45.2 | 0.0 / 0.1 | 0 | 368.1 / 100.9 | 0.0 / 1659.2 |
| main / knob-ambient continuous | 16.7 / 16.8 | 0.0 | 3.6 / 4.0 | 40.2 | 38.6 | 0.0 / 0.1 | 0 | 350.3 / 100.1 | 0.0 / 1661.8 |
| main / knob-ambient pause | 16.7 / 16.8 | 0.0 | 3.6 / 4.0 | 41.5 | 39.0 | 0.0 / 0.1 | 0 | 350.3 / 106.9 | 0.0 / 1662.7 |
| main / knob-sunHeight continuous | 16.7 / 16.8 | 0.0 | 3.9 / 4.2 | 40.8 | 39.1 | 0.0 / 0.1 | 0 | 350.3 / 107.1 | 0.0 / 1656.2 |
| main / knob-sunHeight pause | 16.7 / 16.8 | 0.0 | 3.8 / 4.1 | 41.2 | 39.3 | 0.0 / 0.1 | 0 | 350.3 / 82.5 | 0.0 / 1658.1 |
| main / knob-erosionRain continuous | 16.7 / 16.8 | 0.0 | 8.7 / 11.3 | 225.9 | 201.9 | 0.0 / 0.1 | 0 | 341.0 / 85.3 | 17.6 / 5290.6 |
| main / knob-erosionRain pause | 16.7 / 16.8 | 0.0 | 8.3 / 11.4 | 217.7 | 198.1 | 0.0 / 0.1 | 0 | 341.0 / 84.4 | 16.7 / 5789.0 |
| main / colors continuous | 16.7 / 16.8 | 0.0 | 3.1 / 4.6 | 44.2 | 39.5 | 0.0 / 0.1 | 0 | 350.3 / 84.6 | 0.0 / 1659.3 |
| main / colors pause | 16.7 / 16.8 | 0.0 | 3.2 / 4.6 | 40.9 | 38.7 | 0.0 / 0.2 | 0 | 350.3 / 101.5 | 0.0 / 1660.1 |
| main / knob-creaseShade cold-gate | 16.7 / 16.8 | 0.0 | 4.3 / 4.7 | 41.4 | 39.3 | 0.0 / 0.1 | 2 | 350.3 / 82.9 | 0.0 / 1661.7 |
| review / load | 16.7 / 16.8 | 0.0 | 0.0 / 0.0 | 83.3 | 80.5 | 0.0 / 0.1 | 0 | 433.2 / 105.9 | 50.8 / 2534.8 |
| review / drag | 16.7 / 16.7 | 0.0 | 0.0 / 0.0 | 23.5 | 21.7 | 0.0 / 0.1 | 2 | 427.5 / 86.3 | 0.0 / 3296.1 |
| review / release | 16.7 / 16.8 | 0.0 | 0.0 / 0.0 | 106.0 | 102.8 | 0.0 / 0.1 | 0 | 427.5 / 86.3 | 0.0 / 2606.9 |
| review / resume | 16.7 / 16.8 | 0.0 | 0.0 / 0.0 | 106.1 | 103.2 | 0.0 / 0.1 | 0 | 428.7 / 70.8 | 0.0 / 3312.9 |
| review / scroll | 16.7 / 16.8 | 0.0 | 0.0 / 0.0 | 38.1 | 34.0 | 0.0 / 0.1 | 0 | 481.6 / 125.8 | 44.6 / 1885.1 |
| review / knob-faceBlockSize continuous | 16.7 / 16.8 | 0.0 | 5.6 / 6.7 | 84.5 | 81.3 | 0.0 / 0.1 | 0 | 432.6 / 65.3 | 0.0 / 1650.7 |
| review / knob-faceBlockSize pause | 16.7 / 16.8 | 0.0 | 5.7 / 8.4 | 84.5 | 81.5 | 0.1 / 0.1 | 0 | 432.8 / 67.4 | 0.0 / 2067.3 |
| review / knob-reliefAmount continuous | 16.7 / 16.8 | 0.0 | 5.5 / 6.5 | 83.0 | 79.8 | 0.0 / 0.1 | 0 | 453.9 / 77.7 | 0.0 / 1636.6 |
| review / knob-reliefAmount pause | 16.7 / 16.8 | 0.0 | 5.7 / 9.4 | 99.2 | 95.1 | 0.1 / 0.1 | 0 | 468.6 / 75.8 | 0.0 / 1984.3 |
| review / knob-ambient continuous | 16.7 / 16.8 | 0.0 | 5.6 / 6.5 | 84.2 | 80.5 | 0.0 / 0.1 | 0 | 433.1 / 77.4 | 0.0 / 1640.7 |
| review / knob-ambient pause | 16.7 / 16.7 | 0.0 | 5.5 / 8.8 | 84.7 | 81.4 | 0.0 / 0.1 | 0 | 433.1 / 76.6 | 0.0 / 2060.9 |
| review / knob-sunHeight continuous | 16.7 / 16.8 | 0.0 | 5.6 / 7.2 | 81.7 | 79.6 | 0.0 / 0.1 | 0 | 432.9 / 77.4 | 0.0 / 1633.1 |
| review / knob-sunHeight pause | 16.7 / 16.8 | 0.0 | 4.3 / 4.8 | 83.1 | 80.5 | 0.0 / 0.1 | 0 | 432.9 / 76.7 | 0.0 / 2054.2 |
| review / knob-erosionRain continuous | 16.7 / 16.8 | 0.0 | 7.9 / 8.9 | 82.5 | 80.4 | 0.0 / 0.1 | 0 | 412.6 / 78.0 | 42.6 / 4158.1 |
| review / knob-erosionRain pause | 16.7 / 16.8 | 0.0 | 8.2 / 9.3 | 82.9 | 80.2 | 0.0 / 0.1 | 0 | 412.6 / 76.7 | 42.5 / 4759.9 |
| review / colors continuous | 16.7 / 16.8 | 0.0 | 3.4 / 4.3 | 81.8 | 79.7 | 0.0 / 0.1 | 0 | 433.1 / 77.4 | 0.0 / 1636.7 |
| review / colors pause | 16.7 / 16.8 | 0.0 | 3.9 / 4.4 | 82.2 | 79.7 | 0.0 / 0.1 | 0 | 433.1 / 77.7 | 0.0 / 2058.3 |
| review / knob-creaseShade cold-gate | 16.7 / 16.8 | 0.0 | 4.4 / 5.0 | 81.7 | 79.5 | 0.0 / 0.1 | 2 | 433.1 / 77.9 | 0.0 / 1642.9 |

| Build / slider phase | replaceState p50 / p95 | saveWorlds p50 / p95 | applyKnobs p50 / p95 | syncWorldControls p50 / p95 |
| --- | ---: | ---: | ---: | ---: |
| main / knob-faceBlockSize continuous | 0.0 / 0.0 | 0.0 / 0.1 | 0.9 / 1.1 | 1.8 / 2.1 |
| main / knob-faceBlockSize pause | 0.0 / 0.0 | 0.0 / 0.1 | 0.9 / 1.3 | 1.7 / 2.4 |
| main / knob-reliefAmount continuous | 0.0 / 0.0 | 0.0 / 0.1 | 0.8 / 1.1 | 1.7 / 2.0 |
| main / knob-reliefAmount pause | 0.0 / 0.0 | 0.0 / 0.1 | 0.7 / 0.9 | 1.4 / 1.7 |
| main / knob-ambient continuous | 0.0 / 0.0 | 0.0 / 0.1 | 0.7 / 0.8 | 1.4 / 1.6 |
| main / knob-ambient pause | 0.0 / 0.0 | 0.0 / 0.1 | 0.7 / 0.8 | 1.4 / 1.7 |
| main / knob-sunHeight continuous | 0.0 / 0.0 | 0.0 / 0.1 | 0.7 / 0.9 | 1.5 / 1.7 |
| main / knob-sunHeight pause | 0.0 / 0.0 | 0.0 / 0.1 | 0.7 / 0.8 | 1.5 / 1.7 |
| main / knob-erosionRain continuous | 0.0 / 0.0 | 0.0 / 0.1 | 1.1 / 1.2 | 2.2 / 2.8 |
| main / knob-erosionRain pause | 0.0 / 0.0 | 0.0 / 0.1 | 1.1 / 1.5 | 2.1 / 2.8 |
| main / colors continuous | 0.0 / 0.0 | 0.0 / 0.1 | 0.0 / 0.0 | 1.7 / 2.3 |
| main / colors pause | 0.0 / 0.0 | 0.0 / 0.1 | 0.0 / 0.0 | 1.8 / 2.6 |
| main / knob-creaseShade cold-gate | 0.0 / 0.0 | 0.0 / 0.1 | 0.8 / 1.0 | 1.7 / 1.9 |
| review / knob-faceBlockSize continuous | 0.0 / 0.0 | 0.0 / 0.1 | 1.0 / 1.2 | 1.8 / 2.1 |
| review / knob-faceBlockSize pause | 0.0 / 0.0 | 0.0 / 0.1 | 1.1 / 1.6 | 1.8 / 2.9 |
| review / knob-reliefAmount continuous | 0.0 / 0.0 | 0.0 / 0.1 | 1.1 / 1.3 | 1.8 / 2.2 |
| review / knob-reliefAmount pause | 0.0 / 0.0 | 0.0 / 0.1 | 1.1 / 1.7 | 1.9 / 2.6 |
| review / knob-ambient continuous | 0.0 / 0.0 | 0.0 / 0.1 | 1.1 / 1.3 | 1.8 / 2.2 |
| review / knob-ambient pause | 0.0 / 0.0 | 0.0 / 0.1 | 1.1 / 1.8 | 1.8 / 3.0 |
| review / knob-sunHeight continuous | 0.0 / 0.0 | 0.0 / 0.1 | 1.1 / 1.4 | 1.8 / 2.3 |
| review / knob-sunHeight pause | 0.0 / 0.0 | 0.0 / 0.1 | 0.8 / 0.9 | 1.4 / 1.6 |
| review / knob-erosionRain continuous | 0.0 / 0.0 | 0.0 / 0.1 | 0.9 / 1.1 | 1.7 / 2.0 |
| review / knob-erosionRain pause | 0.0 / 0.0 | 0.0 / 0.1 | 0.9 / 1.0 | 1.8 / 2.1 |
| review / colors continuous | 0.0 / 0.0 | 0.0 / 0.2 | 0.0 / 0.0 | 1.3 / 1.5 |
| review / colors pause | 0.0 / 0.0 | 0.0 / 0.1 | 0.0 / 0.0 | 1.5 / 1.7 |
| review / knob-creaseShade cold-gate | 0.0 / 0.0 | 0.0 / 0.1 | 0.8 / 0.9 | 1.4 / 1.7 |

## green-7/map16/1728x1024

| Build / phase | First changed | First tile | Pointer tile | Whole current | Pause/release → final |
| --- | ---: | ---: | ---: | ---: | ---: |
| main / load | 40.7 / 41.1 | 40.7 / 41.1 | — / — | 612.0 / 612.4 | 4064.5 / 4108.0 |
| main / drag | 28.5 / 78.8 | 27.5 / 39.8 | 45.3 / 1740.6 | 726.2 / 3122.9 | 2968.2 / 2973.5 |
| main / release | 1484.6 / 1502.6 | 1484.6 / 1502.6 | — / — | 2968.2 / 2973.5 | 2968.2 / 2973.5 |
| main / resume | 28.1 / 195.3 | 27.0 / 157.4 | 74.4 / 208.1 | 705.9 / 3397.8 | 2947.8 / 3012.0 |
| main / scroll | 24.2 / 25.5 | 24.2 / 25.5 | — / — | 5251.8 / 5298.5 | 5273.5 / 5322.7 |
| main / knob-faceBlockSize continuous | 30.0 / 48.3 | 30.0 / 48.3 | — / — | 2228.5 / 3058.1 | 1319.3 / 1342.7 |
| main / knob-faceBlockSize pause | 30.5 / 48.0 | 30.5 / 48.0 | — / — | 2213.7 / 4058.8 | 1319.4 / 1326.2 |
| main / knob-reliefAmount continuous | 31.0 / 49.4 | 31.0 / 49.4 | — / — | 2229.9 / 3046.9 | 1306.2 / 1344.4 |
| main / knob-reliefAmount pause | 30.7 / 56.2 | 30.7 / 56.2 | — / — | 2230.8 / 4047.6 | 1307.2 / 1341.2 |
| main / knob-ambient continuous | 29.5 / 48.5 | 29.5 / 48.5 | — / — | 2216.3 / 3057.7 | 1320.7 / 1328.5 |
| main / knob-ambient pause | 30.0 / 48.5 | 30.0 / 48.5 | — / — | 2230.9 / 4058.2 | 1320.5 / 1342.6 |
| main / knob-sunHeight continuous | 31.0 / 47.7 | 31.0 / 47.7 | — / — | 2230.0 / 3057.6 | 1320.7 / 1341.7 |
| main / knob-sunHeight pause | 31.0 / 44.3 | 31.0 / 44.3 | — / — | 2099.4 / 3945.0 | 1208.9 / 1213.1 |
| main / knob-erosionRain continuous | 2322.2 / 3131.7 | 2322.2 / 3131.7 | — / — | 4307.0 / 5146.8 | 3365.1 / 3454.2 |
| main / knob-erosionRain pause | 2409.3 / 4163.6 | 2409.3 / 4163.6 | — / — | 4324.3 / 6078.6 | 3253.2 / 3433.6 |
| main / colors continuous | 25.3 / 41.0 | 25.3 / 41.0 | — / — | 1850.8 / 2448.2 | 1192.7 / 1208.4 |
| main / colors pause | 39.7 / 41.7 | 39.7 / 41.7 | — / — | 1941.9 / 3525.8 | 1252.7 / 1291.7 |
| main / knob-creaseShade cold-gate | 59.3 / 109.8 | 32.0 / 45.5 | — / — | 2100.9 / 2948.6 | 1210.7 / 1213.9 |
| review / load | 50.8 / 52.9 | 50.8 / 52.9 | — / — | 615.0 / 617.7 | 4204.7 / 4244.8 |
| review / drag | 28.3 / 77.6 | 27.3 / 40.5 | 73.8 / 657.0 | 592.8 / 3210.7 | 3044.7 / 3060.2 |
| review / release | 1556.4 / 1564.5 | 1556.4 / 1564.5 | — / — | 3044.7 / 3060.2 | 3044.7 / 3060.2 |
| review / resume | 27.2 / 77.2 | 26.4 / 34.0 | 42.1 / 84.4 | 625.3 / 3075.2 | 2962.0 / 3034.2 |
| review / scroll | 24.0 / 24.5 | 24.0 / 24.5 | — / — | 5076.3 / 5492.2 | 5098.5 / 5515.2 |
| review / knob-faceBlockSize continuous | 29.6 / 31.0 | 29.6 / 31.0 | — / — | 2264.2 / 3099.2 | 1359.6 / 1373.8 |
| review / knob-faceBlockSize pause | 30.5 / 31.4 | 30.5 / 31.4 | — / — | 2247.5 / 4091.9 | 1352.1 / 1357.6 |
| review / knob-reliefAmount continuous | 30.7 / 45.8 | 30.7 / 45.8 | — / — | 2265.9 / 3101.1 | 1360.2 / 1376.4 |
| review / knob-reliefAmount pause | 30.8 / 57.6 | 30.8 / 57.6 | — / — | 2255.9 / 4088.5 | 1350.3 / 1366.4 |
| review / knob-ambient continuous | 29.3 / 31.8 | 29.3 / 31.8 | — / — | 2253.1 / 3087.8 | 1349.5 / 1363.1 |
| review / knob-ambient pause | 29.2 / 31.5 | 29.2 / 31.5 | — / — | 2246.9 / 4083.8 | 1344.9 / 1358.3 |
| review / knob-sunHeight continuous | 29.8 / 31.2 | 29.8 / 31.2 | — / — | 2241.1 / 3081.6 | 1342.8 / 1351.9 |
| review / knob-sunHeight pause | 27.5 / 44.9 | 27.5 / 44.9 | — / — | 2108.7 / 3951.6 | 1214.1 / 1220.7 |
| review / knob-erosionRain continuous | 2262.2 / 3105.1 | 2262.2 / 3105.1 | — / — | 4329.4 / 5166.6 | 3426.0 / 3436.4 |
| review / knob-erosionRain pause | 2256.7 / 4099.5 | 2256.7 / 4099.5 | — / — | 4297.7 / 6143.8 | 3404.9 / 3407.9 |
| review / colors continuous | 42.2 / 43.3 | 42.2 / 43.3 | — / — | 1922.4 / 2533.5 | 1244.5 / 1265.5 |
| review / colors pause | 43.6 / 47.1 | 43.6 / 47.1 | — / — | 1981.1 / 3593.6 | 1280.9 / 1305.3 |
| review / knob-creaseShade cold-gate | 76.0 / 411.3 | 27.8 / 46.5 | — / — | 2123.8 / 2957.8 | 1220.2 / 1237.7 |

Ancillary p50/p95 values below are the larger per-run percentile at each rank, maxima are over the two runs, and outside-region GPU times sum the two runs. GPU/CPU overlap and phase overlap mean these columns must not be summed. GPU timestamp uncertainty and uncensored sample counts remain in the compact evidence.

| Build / phase | rAF p50 / p95 | Long task max | Handler p50 / p95 | Queue wait max | GPU submission max | Bitmap p50 / p95 | Sets built | GPU / heap peak MiB | Wholly outside / mixed GPU |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| main / load | 16.7 / 16.7 | 0.0 | 0.0 / 0.0 | 383.2 | 371.3 | 0.0 / 0.1 | 0 | 354.5 / 86.8 | 1426.6 / 3716.3 |
| main / drag | 16.7 / 16.7 | 0.0 | 0.0 / 0.0 | 18.4 | 15.8 | 0.0 / 0.1 | 2 | 373.6 / 86.5 | 0.0 / 4389.5 |
| main / release | 16.7 / 16.8 | 0.0 | 0.0 / 0.0 | 392.6 | 380.7 | 0.1 / 0.1 | 0 | 373.6 / 86.5 | 0.0 / 3735.1 |
| main / resume | 16.7 / 16.8 | 0.0 | 0.0 / 0.0 | 425.0 | 402.7 | 0.0 / 0.1 | 0 | 373.3 / 84.3 | 0.0 / 4827.6 |
| main / scroll | 16.7 / 16.8 | 0.0 | 0.0 / 0.0 | 447.8 | 433.0 | 0.0 / 0.1 | 0 | 410.0 / 135.1 | 3709.1 / 4456.3 |
| main / knob-faceBlockSize continuous | 16.7 / 16.8 | 0.0 | 5.1 / 5.6 | 59.0 | 56.6 | 0.0 / 0.1 | 0 | 372.4 / 75.0 | 0.0 / 794.3 |
| main / knob-faceBlockSize pause | 16.7 / 16.7 | 0.0 | 5.2 / 7.6 | 59.7 | 56.3 | 0.1 / 0.1 | 0 | 372.4 / 78.5 | 0.0 / 1308.5 |
| main / knob-reliefAmount continuous | 16.7 / 16.8 | 0.0 | 4.5 / 5.2 | 60.0 | 57.1 | 0.0 / 0.1 | 0 | 393.4 / 102.7 | 0.0 / 796.0 |
| main / knob-reliefAmount pause | 16.7 / 16.7 | 0.0 | 4.8 / 7.5 | 59.8 | 56.8 | 0.0 / 0.1 | 0 | 417.2 / 94.7 | 0.0 / 1287.9 |
| main / knob-ambient continuous | 16.7 / 16.8 | 0.0 | 4.8 / 5.3 | 58.8 | 56.6 | 0.1 / 0.2 | 0 | 372.7 / 94.1 | 0.0 / 793.6 |
| main / knob-ambient pause | 16.7 / 16.8 | 0.0 | 5.0 / 6.3 | 60.2 | 56.5 | 0.1 / 0.1 | 0 | 372.7 / 93.1 | 0.0 / 1308.6 |
| main / knob-sunHeight continuous | 16.7 / 16.8 | 0.0 | 4.9 / 5.6 | 59.6 | 57.0 | 0.0 / 0.1 | 0 | 372.7 / 92.3 | 0.0 / 794.8 |
| main / knob-sunHeight pause | 16.7 / 16.8 | 0.0 | 3.5 / 3.9 | 57.6 | 56.1 | 0.0 / 0.1 | 0 | 372.7 / 91.4 | 0.0 / 1385.8 |
| main / knob-erosionRain continuous | 16.7 / 16.7 | 0.0 | 7.8 / 8.2 | 417.0 | 401.9 | 0.0 / 0.1 | 0 | 357.7 / 88.9 | 1343.8 / 6596.8 |
| main / knob-erosionRain pause | 16.7 / 16.8 | 0.0 | 7.2 / 8.3 | 407.2 | 392.8 | 0.0 / 0.1 | 0 | 357.7 / 90.2 | 1342.5 / 8589.6 |
| main / colors continuous | 16.7 / 16.8 | 0.0 | 2.5 / 2.9 | 57.9 | 56.2 | 0.0 / 0.1 | 0 | 372.7 / 91.5 | 0.0 / 796.4 |
| main / colors pause | 16.7 / 16.7 | 0.0 | 2.8 / 3.2 | 58.3 | 56.5 | 0.0 / 0.1 | 0 | 372.7 / 103.1 | 0.0 / 1335.1 |
| main / knob-creaseShade cold-gate | 16.7 / 16.8 | 0.0 | 3.6 / 4.0 | 57.3 | 55.8 | 0.1 / 0.1 | 2 | 372.7 / 89.6 | 0.0 / 795.7 |
| review / load | 16.7 / 16.8 | 0.0 | 0.0 / 0.0 | 57.6 | 55.2 | 0.0 / 0.1 | 0 | 354.5 / 81.4 | 1418.8 / 3740.6 |
| review / drag | 16.7 / 16.8 | 0.0 | 0.0 / 0.0 | 18.5 | 16.0 | 0.0 / 0.1 | 2 | 373.9 / 79.8 | 0.0 / 4339.3 |
| review / release | 16.7 / 16.7 | 0.0 | 0.0 / 0.0 | 74.6 | 71.2 | 0.1 / 0.1 | 0 | 373.9 / 79.8 | 0.0 / 3754.9 |
| review / resume | 16.7 / 16.8 | 0.0 | 0.0 / 0.0 | 74.5 | 71.6 | 0.0 / 0.1 | 0 | 374.0 / 77.8 | 0.0 / 4348.3 |
| review / scroll | 16.7 / 16.8 | 0.0 | 0.0 / 0.0 | 20.1 | 17.8 | 0.1 / 0.1 | 0 | 424.7 / 124.1 | 3337.2 / 4528.1 |
| review / knob-faceBlockSize continuous | 16.7 / 16.7 | 0.0 | 6.0 / 6.6 | 58.9 | 55.6 | 0.0 / 0.1 | 0 | 372.3 / 72.9 | 0.0 / 814.6 |
| review / knob-faceBlockSize pause | 16.7 / 16.8 | 0.0 | 6.0 / 9.1 | 58.8 | 55.7 | 0.1 / 0.1 | 0 | 372.3 / 76.2 | 0.0 / 1342.2 |
| review / knob-reliefAmount continuous | 16.7 / 16.7 | 0.0 | 5.8 / 6.3 | 59.2 | 56.1 | 0.1 / 0.1 | 0 | 389.7 / 98.8 | 0.0 / 817.6 |
| review / knob-reliefAmount pause | 16.7 / 16.7 | 0.0 | 5.7 / 7.0 | 59.4 | 55.8 | 0.0 / 0.1 | 0 | 417.7 / 98.7 | 0.0 / 1309.4 |
| review / knob-ambient continuous | 16.7 / 16.8 | 0.0 | 5.8 / 6.3 | 58.4 | 55.3 | 0.0 / 0.1 | 0 | 372.6 / 99.2 | 0.0 / 817.6 |
| review / knob-ambient pause | 16.7 / 16.8 | 0.0 | 6.0 / 8.8 | 58.6 | 55.6 | 0.0 / 0.1 | 0 | 372.6 / 99.1 | 0.0 / 1339.3 |
| review / knob-sunHeight continuous | 16.7 / 16.8 | 0.0 | 5.9 / 6.5 | 58.1 | 55.5 | 0.1 / 0.1 | 0 | 372.6 / 99.6 | 0.0 / 815.7 |
| review / knob-sunHeight pause | 16.7 / 16.8 | 0.0 | 4.3 / 4.7 | 58.1 | 55.9 | 0.0 / 0.1 | 0 | 372.6 / 99.2 | 0.0 / 1424.3 |
| review / knob-erosionRain continuous | 16.7 / 16.8 | 0.0 | 8.9 / 9.7 | 57.1 | 55.0 | 0.1 / 0.2 | 0 | 356.7 / 104.8 | 1373.2 / 5334.5 |
| review / knob-erosionRain pause | 16.7 / 16.7 | 0.0 | 6.8 / 9.2 | 57.4 | 55.0 | 0.0 / 0.1 | 0 | 356.7 / 95.4 | 1367.6 / 6998.4 |
| review / colors continuous | 16.7 / 16.7 | 0.0 | 3.6 / 4.3 | 63.2 | 61.3 | 0.0 / 0.1 | 0 | 372.6 / 96.2 | 0.0 / 821.5 |
| review / colors pause | 16.7 / 16.8 | 0.0 | 3.9 / 4.6 | 57.3 | 55.0 | 0.0 / 0.1 | 0 | 372.6 / 98.7 | 0.0 / 1340.2 |
| review / knob-creaseShade cold-gate | 16.7 / 16.8 | 0.0 | 4.3 / 4.7 | 56.3 | 54.6 | 0.0 / 0.1 | 2 | 372.6 / 95.7 | 0.0 / 820.8 |

| Build / slider phase | replaceState p50 / p95 | saveWorlds p50 / p95 | applyKnobs p50 / p95 | syncWorldControls p50 / p95 |
| --- | ---: | ---: | ---: | ---: |
| main / knob-faceBlockSize continuous | 0.0 / 0.0 | 0.0 / 0.1 | 1.0 / 1.2 | 2.0 / 2.2 |
| main / knob-faceBlockSize pause | 0.0 / 0.0 | 0.0 / 0.1 | 1.0 / 1.3 | 2.0 / 3.4 |
| main / knob-reliefAmount continuous | 0.0 / 0.0 | 0.0 / 0.1 | 0.8 / 1.0 | 1.8 / 2.1 |
| main / knob-reliefAmount pause | 0.0 / 0.0 | 0.0 / 0.1 | 0.9 / 1.5 | 1.9 / 3.0 |
| main / knob-ambient continuous | 0.0 / 0.0 | 0.0 / 0.1 | 0.9 / 1.0 | 1.8 / 2.1 |
| main / knob-ambient pause | 0.0 / 0.0 | 0.0 / 0.1 | 0.9 / 1.1 | 1.9 / 2.6 |
| main / knob-sunHeight continuous | 0.0 / 0.0 | 0.0 / 0.1 | 0.9 / 1.1 | 2.0 / 2.3 |
| main / knob-sunHeight pause | 0.0 / 0.0 | 0.0 / 0.1 | 0.6 / 0.8 | 1.4 / 1.6 |
| main / knob-erosionRain continuous | 0.0 / 0.0 | 0.0 / 0.1 | 0.9 / 1.0 | 1.8 / 2.1 |
| main / knob-erosionRain pause | 0.0 / 0.0 | 0.0 / 0.1 | 0.9 / 1.0 | 1.7 / 2.0 |
| main / colors continuous | 0.0 / 0.0 | 0.0 / 0.1 | 0.0 / 0.0 | 1.4 / 1.6 |
| main / colors pause | 0.0 / 0.0 | 0.0 / 0.1 | 0.0 / 0.0 | 1.5 / 1.8 |
| main / knob-creaseShade cold-gate | 0.0 / 0.0 | 0.0 / 0.1 | 0.6 / 0.8 | 1.4 / 1.6 |
| review / knob-faceBlockSize continuous | 0.0 / 0.0 | 0.0 / 0.1 | 1.1 / 1.2 | 2.0 / 2.2 |
| review / knob-faceBlockSize pause | 0.0 / 0.0 | 0.0 / 0.1 | 1.1 / 1.7 | 2.0 / 3.3 |
| review / knob-reliefAmount continuous | 0.0 / 0.0 | 0.0 / 0.1 | 1.0 / 1.2 | 1.9 / 2.1 |
| review / knob-reliefAmount pause | 0.0 / 0.0 | 0.0 / 0.1 | 1.0 / 1.3 | 1.9 / 2.3 |
| review / knob-ambient continuous | 0.0 / 0.0 | 0.0 / 0.1 | 1.0 / 1.3 | 1.9 / 2.1 |
| review / knob-ambient pause | 0.0 / 0.0 | 0.0 / 0.1 | 1.1 / 1.7 | 1.9 / 3.1 |
| review / knob-sunHeight continuous | 0.0 / 0.0 | 0.0 / 0.1 | 1.1 / 1.2 | 2.0 / 2.2 |
| review / knob-sunHeight pause | 0.0 / 0.0 | 0.0 / 0.1 | 0.7 / 0.9 | 1.4 / 1.6 |
| review / knob-erosionRain continuous | 0.0 / 0.0 | 0.0 / 0.1 | 0.8 / 1.0 | 1.9 / 2.2 |
| review / knob-erosionRain pause | 0.0 / 0.0 | 0.0 / 0.1 | 0.8 / 0.9 | 1.6 / 1.9 |
| review / colors continuous | 0.0 / 0.0 | 0.0 / 0.1 | 0.0 / 0.0 | 1.3 / 1.6 |
| review / colors pause | 0.0 / 0.0 | 0.0 / 0.1 | 0.0 / 0.0 | 1.5 / 1.8 |
| review / knob-creaseShade cold-gate | 0.0 / 0.0 | 0.0 / 0.1 | 0.7 / 0.9 | 1.4 / 1.6 |

Editor memory accounting covers terrain resources, not driver residency. Wholly outside GPU time is measured pass time for a requested region entirely outside the view; mixed regions contain visible ground and aprons, so their outside cost cannot be isolated. An area-weighted estimate is retained separately and is not called measured wasted time. CPU pixel comparison runs after timing. Cold final replays are untimed correctness checks. Export was checked separately and has no timing budget.
