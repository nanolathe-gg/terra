# LP4 step 1 timing details, 2026-11-12

See [the report](LP4_STEP1_REPORT.md) for the experiment, guards and limits.
All times are milliseconds. Each row pools two trials of the named phase.
Distributions use nearest rank, as LP0 does; relative final-cost guards in
the report use the conventional median of the two run endpoints.
`p50 / p95 [n/N]` gives completed observations over inputs. Missing
observations are censored, not zero, and the completed-only quantiles do
not represent a full-input percentile when `n < N`. `—` means no applicable
observation (for example a pointer tile on load).

The first three tile columns preserve `drag.latency`, `latencyPointer` and
`latencyAll` separately. Changed pixels is an additional screen comparison.
Final is pause/release-to-final. Core and controls were measured in separate
alternating windows; invalid earlier gesture runs contribute no numbers.

## green-modern-2 / map4

| Build / phase | Changed pixels | First tile | Pointer tile | Whole current | Pause/release to final |
| --- | ---: | ---: | ---: | ---: | ---: |
| main / load | 112.8 / 123.2 [2/2] | 112.8 / 123.2 [2/2] | — / — [0/0] | 5264.3 / 5265.6 [2/2] | 5260.5 / 5262.7 [2/2] |
| main / drag | 28.1 / 45.1 [80/80] | 28.1 / 45.1 [80/80] | 76.2 / 1262.2 [80/80] | 6438.3 / 7318.3 [80/80] | 5394.0 / 5488.8 [2/2] |
| main / release | 269.9 / 301.7 [2/2] | 269.9 / 301.7 [2/2] | — / — [0/0] | 5394.0 / 5488.8 [2/2] | 5394.0 / 5488.8 [2/2] |
| main / resume | 28.3 / 112.4 [64/64] | 28.3 / 112.4 [64/64] | 64.0 / 1198.3 [64/64] | 6142.7 / 6842.7 [64/64] | 5344.7 / 5385.0 [2/2] |
| main / scroll | 28.2 / 35.1 [2/2] | 28.2 / 35.1 [2/2] | — / — [0/0] | 2928.3 / 2939.4 [2/2] | — / — [0/0] |
| main / knob-faceBlockSize continuous | 30.8 / 32.7 [72/72] | 30.8 / 32.7 [72/72] | — / — [0/0] | 5617.8 / 6420.0 [72/72] | 4629.5 / 4782.0 [2/2] |
| main / knob-faceBlockSize pause | 31.1 / 56.8 [72/72] | 31.1 / 56.8 [72/72] | — / — [0/0] | 5634.3 / 7435.4 [72/72] | 4675.8 / 4747.9 [2/2] |
| main / knob-reliefAmount continuous | 47.2 / 64.8 [72/72] | 46.4 / 63.8 [72/72] | — / — [0/0] | 5612.1 / 6447.9 [72/72] | 4674.3 / 4759.0 [2/2] |
| main / knob-reliefAmount pause | 38.2 / 61.7 [72/72] | 38.2 / 61.7 [72/72] | — / — [0/0] | 5088.0 / 6930.9 [72/72] | 4194.6 / 4202.9 [2/2] |
| main / knob-ambient continuous | 30.0 / 31.6 [72/72] | 30.0 / 31.6 [72/72] | — / — [0/0] | 5486.0 / 6315.5 [72/72] | 4576.6 / 4599.3 [2/2] |
| main / knob-ambient pause | 29.7 / 41.8 [72/72] | 29.7 / 41.8 [72/72] | — / — [0/0] | 5505.3 / 7305.5 [72/72] | 4526.5 / 4618.7 [2/2] |
| main / knob-sunHeight continuous | 29.3 / 45.9 [72/72] | 29.3 / 45.9 [72/72] | — / — [0/0] | 5393.2 / 6242.3 [72/72] | 4455.4 / 4557.9 [2/2] |
| main / knob-sunHeight pause | 28.5 / 37.1 [72/72] | 28.5 / 37.1 [72/72] | — / — [0/0] | 5134.9 / 6934.6 [72/72] | 4180.6 / 4247.1 [2/2] |
| main / knob-erosionRain continuous | 1266.4 / 2184.3 [72/72] | 1266.4 / 2184.3 [72/72] | — / — [0/0] | 5937.3 / 6853.8 [72/72] | 4896.2 / 4961.9 [2/2] |
| main / knob-erosionRain pause | 800.9 / 1281.5 [72/72] | 800.9 / 1281.5 [72/72] | — / — [0/0] | 5962.5 / 7778.9 [72/72] | 4970.2 / 4989.6 [2/2] |
| main / colors continuous | 41.4 / 70.0 [72/72] | 41.4 / 70.0 [72/72] | — / — [0/0] | 5271.3 / 5856.5 [72/72] | 4610.3 / 4620.7 [2/2] |
| main / colors pause | 41.9 / 69.2 [72/72] | 41.9 / 69.2 [72/72] | — / — [0/0] | 5434.4 / 6984.0 [72/72] | 4667.1 / 4771.8 [2/2] |
| main / knob-creaseShade cold-gate | 31.4 / 81.0 [72/72] | 31.4 / 80.8 [72/72] | — / — [0/0] | 5692.7 / 6541.7 [72/72] | 4753.8 / 4849.3 [2/2] |
| build / load | 140.0 / 144.3 [2/2] | 140.0 / 144.3 [2/2] | — / — [0/0] | 5179.6 / 5263.8 [2/2] | 5173.6 / 5259.4 [2/2] |
| build / drag | 28.3 / 47.0 [80/80] | 28.3 / 47.0 [80/80] | 65.1 / 1400.7 [80/80] | 6421.2 / 7293.4 [80/80] | 5421.7 / 5442.9 [2/2] |
| build / release | 284.2 / 301.0 [2/2] | 284.2 / 301.0 [2/2] | — / — [0/0] | 5421.7 / 5442.9 [2/2] | 5421.7 / 5442.9 [2/2] |
| build / resume | 27.7 / 30.7 [64/64] | 27.7 / 30.7 [64/64] | 31.8 / 79.9 [64/64] | 6259.1 / 6976.5 [64/64] | 5337.0 / 5559.3 [2/2] |
| build / scroll | 29.8 / 30.8 [2/2] | 29.8 / 30.8 [2/2] | — / — [0/0] | 2924.9 / 2925.9 [2/2] | — / — [0/0] |
| build / knob-faceBlockSize continuous | 30.7 / 42.7 [72/72] | 30.7 / 42.7 [72/72] | — / — [0/0] | 5568.5 / 6401.7 [72/72] | 4664.8 / 4680.9 [2/2] |
| build / knob-faceBlockSize pause | 31.1 / 39.3 [72/72] | 31.1 / 39.3 [72/72] | — / — [0/0] | 5620.1 / 7412.7 [72/72] | 4623.7 / 4733.4 [2/2] |
| build / knob-reliefAmount continuous | 50.4 / 83.6 [72/72] | 50.4 / 82.5 [72/72] | — / — [0/0] | 5534.7 / 6342.4 [72/72] | 4597.8 / 4652.8 [2/2] |
| build / knob-reliefAmount pause | 37.5 / 63.9 [72/72] | 37.5 / 63.9 [72/72] | — / — [0/0] | 5100.6 / 6930.6 [72/72] | 4195.0 / 4215.5 [2/2] |
| build / knob-ambient continuous | 30.5 / 45.8 [72/72] | 30.5 / 45.8 [72/72] | — / — [0/0] | 5485.6 / 6334.2 [72/72] | 4598.6 / 4600.7 [2/2] |
| build / knob-ambient pause | 30.3 / 31.9 [72/72] | 30.3 / 31.9 [72/72] | — / — [0/0] | 5533.0 / 7332.4 [72/72] | 4557.6 / 4646.9 [2/2] |
| build / knob-sunHeight continuous | 28.7 / 29.7 [72/72] | 28.7 / 29.7 [72/72] | — / — [0/0] | 5330.4 / 6169.8 [72/72] | 4434.7 / 4444.2 [2/2] |
| build / knob-sunHeight pause | 28.3 / 41.6 [72/72] | 28.3 / 41.6 [72/72] | — / — [0/0] | 5127.9 / 6927.7 [72/72] | 4186.8 / 4242.4 [2/2] |
| build / knob-erosionRain continuous | 1133.5 / 1983.1 [72/72] | 1133.5 / 1983.1 [72/72] | — / — [0/0] | 5769.0 / 6591.0 [72/72] | 4853.3 / 4880.4 [2/2] |
| build / knob-erosionRain pause | 685.1 / 1120.2 [72/72] | 685.1 / 1120.2 [72/72] | — / — [0/0] | 5776.2 / 7575.4 [72/72] | 4813.6 / 4886.8 [2/2] |
| build / colors continuous | 41.7 / 70.0 [72/72] | 41.7 / 70.0 [72/72] | — / — [0/0] | 5372.8 / 5961.9 [72/72] | 4660.4 / 4784.8 [2/2] |
| build / colors pause | 42.7 / 69.6 [72/72] | 42.7 / 69.6 [72/72] | — / — [0/0] | 5321.7 / 6865.1 [72/72] | 4567.2 / 4669.2 [2/2] |
| build / knob-creaseShade cold-gate | 55.5 / 59.2 [72/72] | 55.5 / 59.2 [72/72] | — / — [0/0] | 5568.9 / 6405.2 [72/72] | 4619.9 / 4731.6 [2/2] |

| Build / phase | rAF p95 | Long task max | Handler p95 | GPU queue wall max | Time GPU max | Any GPU max | Bitmap p95 | Pipelines compiled | Peak GPU / accounted heap MiB | Wholly outside / mixed / area-weighted outside GPU |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| main / load | 16.7 | 0.0 | 0.0 | 232.7 | 197.7 | 197.7 | 0.1 | 0 | 282.2 / 214.1 | 0.0 / 2272.9 / 1131.4 |
| main / drag | 16.8 | 0.0 | 0.0 | 23.1 | 0.0 | 16.4 | 0.1 | 2 | 367.9 / 205.0 | 0.0 / 2659.6 / 1308.4 |
| main / release | 16.8 | 0.0 | 0.0 | 244.7 | 223.2 | 223.2 | 0.1 | 0 | 367.9 / 205.0 | 0.0 / 2382.2 / 1201.9 |
| main / resume | 16.7 | 0.0 | 0.0 | 233.6 | 217.0 | 217.0 | 0.1 | 0 | 373.7 / 278.4 | 0.0 / 2966.7 / 1524.7 |
| main / scroll | 16.8 | 0.0 | 0.0 | 23.4 | 0.0 | 22.0 | 0.1 | 0 | 200.1 / 268.9 | 0.0 / 222.6 / 167.0 |
| main / knob-faceBlockSize continuous | 16.8 | 0.0 | 5.2 | 43.1 | 0.0 | 39.2 | 0.1 | 0 | 206.4 / 204.6 | 0.0 / 1658.2 / 785.7 |
| main / knob-faceBlockSize pause | 16.8 | 0.0 | 6.6 | 43.3 | 0.0 | 40.6 | 0.1 | 0 | 206.4 / 269.5 | 0.0 / 1657.5 / 785.3 |
| main / knob-reliefAmount continuous | 16.8 | 0.0 | 5.1 | 43.9 | 0.0 | 39.4 | 0.1 | 0 | 220.4 / 272.8 | 0.0 / 1651.8 / 783.7 |
| main / knob-reliefAmount pause | 16.8 | 0.0 | 5.2 | 51.3 | 0.0 | 48.9 | 0.1 | 0 | 225.4 / 268.8 | 0.0 / 1650.3 / 781.4 |
| main / knob-ambient continuous | 16.8 | 0.0 | 3.8 | 41.8 | 0.0 | 39.5 | 0.1 | 0 | 206.8 / 202.9 | 0.0 / 1664.9 / 789.4 |
| main / knob-ambient pause | 16.7 | 0.0 | 3.8 | 44.5 | 0.0 | 42.3 | 0.1 | 0 | 206.8 / 269.6 | 0.0 / 1664.5 / 787.6 |
| main / knob-sunHeight continuous | 16.7 | 0.0 | 4.6 | 41.9 | 0.0 | 39.7 | 0.1 | 0 | 206.7 / 272.3 | 0.0 / 1668.1 / 789.2 |
| main / knob-sunHeight pause | 16.7 | 0.0 | 3.9 | 43.0 | 0.0 | 38.9 | 0.1 | 0 | 206.7 / 270.6 | 0.0 / 1640.6 / 777.5 |
| main / knob-erosionRain continuous | 16.8 | 0.0 | 9.0 | 237.6 | 215.8 | 215.8 | 0.1 | 0 | 353.6 / 271.9 | 0.0 / 5557.5 / 3421.0 |
| main / knob-erosionRain pause | 16.8 | 0.0 | 8.8 | 229.6 | 210.6 | 210.6 | 0.1 | 0 | 360.7 / 206.1 | 0.0 / 5927.8 / 3673.8 |
| main / colors continuous | 16.8 | 0.0 | 3.6 | 43.3 | 0.0 | 41.0 | 0.1 | 0 | 206.8 / 199.9 | 0.0 / 1657.7 / 785.9 |
| main / colors pause | 16.7 | 0.0 | 6.3 | 42.3 | 0.0 | 40.2 | 0.1 | 0 | 206.8 / 266.4 | 0.0 / 1649.3 / 780.4 |
| main / knob-creaseShade cold-gate | 16.8 | 0.0 | 4.8 | 82.8 | 0.0 | 73.2 | 0.1 | 2 | 206.8 / 203.2 | 0.0 / 1650.7 / 783.1 |
| build / load | 16.8 | 69.0 | 0.0 | 81.6 | 8.7 | 39.8 | 0.1 | 0 | 282.8 / 254.9 | 0.0 / 2279.6 / 1136.3 |
| build / drag | 16.8 | 0.0 | 0.0 | 17.2 | 0.0 | 11.1 | 0.1 | 2 | 368.5 / 202.5 | 0.0 / 2656.2 / 1309.8 |
| build / release | 16.7 | 0.0 | 0.0 | 53.1 | 10.1 | 51.0 | 0.1 | 0 | 368.5 / 202.5 | 0.0 / 2380.3 / 1203.6 |
| build / resume | 16.7 | 0.0 | 0.0 | 52.3 | 9.5 | 49.8 | 0.1 | 0 | 373.8 / 283.9 | 0.0 / 2759.3 / 1354.9 |
| build / scroll | 16.8 | 0.0 | 0.0 | 22.9 | 0.0 | 21.2 | 0.1 | 0 | 200.1 / 269.3 | 0.0 / 236.6 / 177.4 |
| build / knob-faceBlockSize continuous | 16.7 | 0.0 | 4.9 | 42.7 | 0.0 | 40.6 | 0.1 | 0 | 207.0 / 204.6 | 0.0 / 1661.8 / 787.9 |
| build / knob-faceBlockSize pause | 16.7 | 0.0 | 6.2 | 43.9 | 0.0 | 41.5 | 0.1 | 0 | 207.0 / 304.7 | 0.0 / 1660.4 / 785.9 |
| build / knob-reliefAmount continuous | 16.7 | 0.0 | 4.7 | 45.1 | 0.0 | 39.5 | 0.1 | 0 | 221.3 / 271.9 | 0.0 / 1645.2 / 779.5 |
| build / knob-reliefAmount pause | 16.8 | 0.0 | 4.9 | 51.1 | 0.0 | 48.3 | 0.1 | 0 | 226.7 / 269.3 | 0.0 / 1651.3 / 780.7 |
| build / knob-ambient continuous | 16.8 | 0.0 | 3.8 | 42.1 | 0.0 | 40.1 | 0.1 | 0 | 207.3 / 272.0 | 0.0 / 1650.4 / 781.8 |
| build / knob-ambient pause | 16.8 | 0.0 | 3.7 | 44.9 | 0.0 | 39.6 | 0.1 | 0 | 207.3 / 269.4 | 0.0 / 1658.0 / 785.8 |
| build / knob-sunHeight continuous | 16.8 | 0.0 | 3.6 | 41.5 | 0.0 | 39.7 | 0.1 | 0 | 207.2 / 272.1 | 0.0 / 1641.9 / 777.7 |
| build / knob-sunHeight pause | 16.8 | 0.0 | 3.6 | 41.7 | 0.0 | 40.2 | 0.1 | 0 | 207.2 / 268.8 | 0.0 / 1637.4 / 775.1 |
| build / knob-erosionRain continuous | 16.8 | 0.0 | 7.3 | 43.2 | 9.6 | 41.5 | 0.1 | 0 | 353.6 / 205.8 | 0.0 / 4406.4 / 2641.1 |
| build / knob-erosionRain pause | 16.7 | 0.0 | 9.8 | 50.5 | 9.2 | 41.7 | 0.1 | 0 | 359.7 / 270.0 | 0.0 / 4646.7 / 2806.8 |
| build / colors continuous | 16.8 | 0.0 | 3.4 | 44.0 | 0.0 | 39.8 | 0.1 | 0 | 207.3 / 200.8 | 0.0 / 1657.9 / 785.9 |
| build / colors pause | 16.8 | 0.0 | 6.3 | 43.0 | 0.0 | 40.1 | 0.1 | 0 | 207.3 / 267.4 | 0.0 / 1661.4 / 788.0 |
| build / knob-creaseShade cold-gate | 16.8 | 0.0 | 5.5 | 42.8 | 0.0 | 40.6 | 0.1 | 2 | 207.3 / 202.8 | 0.0 / 1667.4 / 789.0 |

Ancillary percentiles are the larger per-run p95, maxima are over both
runs, and outside-region times sum both runs. Mixed-region GPU time is
measured; area weighting is an estimate, not isolated outside GPU time.

| Build / row workload | Handler total p50 / p95 | history.replaceState p50 / p95 | saveWorlds p50 / p95 | applyKnobs p50 / p95 | syncWorldControls p50 / p95 | setColors p50 / p95 |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| main / knob-faceBlockSize continuous | 4.6 / 5.2 | 1.7 / 2.0 | 0.0 / 0.1 | 1.0 / 1.2 | 1.6 / 1.8 | 0.0 / 0.0 |
| main / knob-faceBlockSize pause | 4.4 / 6.6 | 1.7 / 2.6 | 0.0 / 0.1 | 1.0 / 1.6 | 1.5 / 2.1 | 0.0 / 0.0 |
| main / knob-reliefAmount continuous | 4.1 / 5.1 | 1.6 / 2.0 | 0.0 / 0.1 | 0.9 / 1.1 | 1.4 / 1.8 | 0.0 / 0.0 |
| main / knob-reliefAmount pause | 3.8 / 5.2 | 1.5 / 1.9 | 0.0 / 0.1 | 0.8 / 1.2 | 1.3 / 2.0 | 0.0 / 0.0 |
| main / knob-ambient continuous | 3.6 / 3.8 | 1.4 / 1.6 | 0.0 / 0.1 | 0.7 / 0.8 | 1.2 / 1.4 | 0.0 / 0.0 |
| main / knob-ambient pause | 3.6 / 3.8 | 1.4 / 1.5 | 0.0 / 0.1 | 0.7 / 0.9 | 1.2 / 1.4 | 0.0 / 0.0 |
| main / knob-sunHeight continuous | 3.4 / 4.6 | 1.3 / 2.2 | 0.0 / 0.1 | 0.7 / 0.8 | 1.2 / 1.4 | 0.0 / 0.0 |
| main / knob-sunHeight pause | 3.3 / 3.9 | 1.3 / 1.5 | 0.0 / 0.1 | 0.7 / 0.8 | 1.1 / 1.4 | 0.0 / 0.0 |
| main / knob-erosionRain continuous | 7.1 / 9.0 | 1.8 / 2.3 | 0.0 / 0.1 | 0.9 / 1.1 | 1.5 / 2.0 | 0.0 / 0.0 |
| main / knob-erosionRain pause | 7.3 / 8.8 | 1.9 / 2.4 | 0.0 / 0.1 | 0.9 / 1.2 | 1.6 / 2.1 | 0.0 / 0.0 |
| main / colors continuous | 2.8 / 3.6 | 0.0 / 0.0 | 0.0 / 0.1 | 0.0 / 0.0 | 1.4 / 1.7 | 0.2 / 0.3 |
| main / colors pause | 2.9 / 6.3 | 0.0 / 0.0 | 0.0 / 0.1 | 0.0 / 0.0 | 1.5 / 3.4 | 0.2 / 0.5 |
| main / knob-creaseShade cold-gate | 4.3 / 4.8 | 1.7 / 1.8 | 0.0 / 0.1 | 0.9 / 1.0 | 1.5 / 1.9 | 0.0 / 0.0 |
| build / knob-faceBlockSize continuous | 4.5 / 4.9 | 1.7 / 1.9 | 0.0 / 0.1 | 1.0 / 1.2 | 1.5 / 1.7 | 0.0 / 0.0 |
| build / knob-faceBlockSize pause | 4.4 / 6.2 | 1.6 / 2.5 | 0.0 / 0.1 | 1.0 / 1.4 | 1.5 / 2.2 | 0.0 / 0.0 |
| build / knob-reliefAmount continuous | 4.2 / 4.7 | 1.7 / 1.9 | 0.0 / 0.1 | 0.9 / 1.1 | 1.4 / 1.6 | 0.0 / 0.0 |
| build / knob-reliefAmount pause | 3.2 / 4.9 | 1.3 / 1.8 | 0.0 / 0.1 | 0.7 / 1.2 | 1.1 / 1.5 | 0.0 / 0.0 |
| build / knob-ambient continuous | 3.5 / 3.8 | 1.4 / 1.5 | 0.0 / 0.1 | 0.7 / 0.8 | 1.2 / 1.4 | 0.0 / 0.0 |
| build / knob-ambient pause | 3.5 / 3.7 | 1.4 / 1.5 | 0.0 / 0.1 | 0.7 / 0.8 | 1.1 / 1.3 | 0.0 / 0.0 |
| build / knob-sunHeight continuous | 3.4 / 3.6 | 1.3 / 1.4 | 0.0 / 0.1 | 0.7 / 0.9 | 1.1 / 1.3 | 0.0 / 0.0 |
| build / knob-sunHeight pause | 3.3 / 3.6 | 1.3 / 1.4 | 0.0 / 0.1 | 0.7 / 0.8 | 1.1 / 1.2 | 0.0 / 0.0 |
| build / knob-erosionRain continuous | 6.5 / 7.3 | 1.8 / 2.1 | 0.0 / 0.1 | 0.8 / 1.0 | 1.4 / 1.5 | 0.0 / 0.0 |
| build / knob-erosionRain pause | 6.7 / 9.8 | 1.9 / 2.8 | 0.0 / 0.1 | 0.9 / 1.4 | 1.4 / 2.0 | 0.0 / 0.0 |
| build / colors continuous | 2.8 / 3.4 | 0.0 / 0.0 | 0.0 / 0.1 | 0.0 / 0.0 | 1.4 / 1.6 | 0.2 / 0.4 |
| build / colors pause | 2.8 / 6.3 | 0.0 / 0.0 | 0.0 / 0.1 | 0.0 / 0.0 | 1.4 / 3.2 | 0.2 / 0.5 |
| build / knob-creaseShade cold-gate | 4.3 / 5.5 | 1.7 / 2.1 | 0.0 / 0.1 | 0.9 / 1.2 | 1.4 / 1.8 | 0.0 / 0.0 |

Handler columns give the larger per-run percentile; zero means the callee
was not observed within that handler. Callee times can overlap. Raw small
JSON records retain both trials and pipeline keys under the external evidence
folder named in the report.

## green-modern-2 / map16

| Build / phase | Changed pixels | First tile | Pointer tile | Whole current | Pause/release to final |
| --- | ---: | ---: | ---: | ---: | ---: |
| main / load | 53.8 / 53.9 [2/2] | 53.8 / 53.9 [2/2] | — / — [0/0] | — / — [0/2] | — / — [0/0] |
| main / drag | 30.0 / 41.5 [80/80] | 30.0 / 41.5 [80/80] | 77.2 / 1577.2 [80/80] | 6912.7 / 7796.9 [80/80] | 5880.9 / 5898.4 [2/2] |
| main / release | 13.0 / 390.0 [2/2] | 13.0 / 390.0 [2/2] | — / — [0/0] | 5880.9 / 5898.4 [2/2] | 5880.9 / 5898.4 [2/2] |
| main / resume | 30.9 / 85.5 [64/64] | 30.9 / 85.5 [64/64] | 78.9 / 1472.5 [64/64] | 6725.6 / 7458.5 [64/64] | 5876.8 / 5959.6 [2/2] |
| main / scroll | 30.7 / 32.5 [2/2] | 30.7 / 32.5 [2/2] | — / — [0/0] | 6192.7 / 6229.8 [2/2] | 6191.8 / 6229.0 [2/2] |
| main / knob-erosionRain continuous | 1353.3 / 2202.6 [72/72] | 1353.3 / 2202.6 [72/72] | — / — [0/0] | 6291.4 / 7182.0 [72/72] | 5250.4 / 5523.4 [2/2] |
| main / knob-erosionRain pause | 902.4 / 1340.8 [72/72] | 902.4 / 1340.8 [72/72] | — / — [0/0] | 6451.9 / 8251.8 [72/72] | 5457.3 / 5478.3 [2/2] |
| main / knob-creaseShade cold-gate | 33.9 / 87.0 [72/72] | 33.9 / 87.0 [72/72] | — / — [0/0] | 5706.1 / 6515.5 [72/72] | 4778.3 / 4819.4 [2/2] |
| build / load | 53.0 / 59.3 [2/2] | 53.0 / 59.3 [2/2] | — / — [0/0] | — / — [0/2] | — / — [0/0] |
| build / drag | 30.4 / 40.9 [80/80] | 30.4 / 40.9 [80/80] | 76.9 / 1603.6 [80/80] | 6913.3 / 7812.9 [80/80] | 5912.6 / 5912.6 [2/2] |
| build / release | 13.3 / 13.4 [2/2] | 13.3 / 13.4 [2/2] | — / — [0/0] | 5912.6 / 5912.6 [2/2] | 5912.6 / 5912.6 [2/2] |
| build / resume | 31.0 / 35.3 [64/64] | 31.0 / 35.3 [64/64] | 36.1 / 1500.4 [64/64] | 6648.8 / 7381.2 [64/64] | 5810.0 / 5899.2 [2/2] |
| build / scroll | 27.8 / 28.3 [2/2] | 27.8 / 28.3 [2/2] | — / — [0/0] | 6199.1 / 6280.0 [2/2] | 6198.3 / 6279.3 [2/2] |
| build / knob-erosionRain continuous | 1314.3 / 2152.9 [72/72] | 1314.3 / 2152.9 [72/72] | — / — [0/0] | 6235.5 / 7051.1 [72/72] | 5310.4 / 5345.1 [2/2] |
| build / knob-erosionRain pause | 853.6 / 1295.2 [72/72] | 853.6 / 1295.2 [72/72] | — / — [0/0] | 6283.7 / 8110.9 [72/72] | 5368.9 / 5392.5 [2/2] |
| build / knob-creaseShade cold-gate | 56.5 / 156.3 [72/72] | 55.6 / 84.7 [72/72] | — / — [0/0] | 5599.4 / 6433.2 [72/72] | 4660.6 / 4744.7 [2/2] |

| Build / phase | rAF p95 | Long task max | Handler p95 | GPU queue wall max | Time GPU max | Any GPU max | Bitmap p95 | Pipelines compiled | Peak GPU / accounted heap MiB | Wholly outside / mixed / area-weighted outside GPU |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| main / load | 16.7 | 0.0 | 0.0 | 196.4 | 183.5 | 183.5 | 0.1 | 0 | 365.3 / 123.4 | 18.2 / 2593.6 / 1203.0 |
| main / drag | 16.7 | 0.0 | 0.0 | 18.6 | 0.0 | 15.2 | 0.1 | 2 | 349.6 / 89.8 | 0.0 / 2865.8 / 1287.8 |
| main / release | 16.7 | 0.0 | 0.0 | 217.9 | 199.3 | 199.3 | 0.1 | 0 | 349.6 / 89.8 | 0.0 / 2588.5 / 1194.0 |
| main / resume | 16.8 | 0.0 | 0.0 | 229.6 | 215.2 | 215.2 | 0.1 | 0 | 349.9 / 113.7 | 0.0 / 3170.3 / 1407.5 |
| main / scroll | 16.8 | 0.0 | 0.0 | 37.2 | 20.1 | 24.2 | 0.1 | 0 | 384.7 / 131.7 | 52.1 / 2199.5 / 1298.4 |
| main / knob-erosionRain continuous | 16.8 | 0.0 | 9.9 | 248.4 | 225.3 | 225.3 | 0.1 | 0 | 340.7 / 106.4 | 18.1 / 5529.0 / 2130.5 |
| main / knob-erosionRain pause | 16.8 | 0.0 | 10.9 | 227.7 | 203.9 | 203.9 | 0.1 | 0 | 340.7 / 98.9 | 16.1 / 6118.1 / 2375.4 |
| main / knob-creaseShade cold-gate | 16.8 | 0.0 | 5.6 | 41.8 | 0.0 | 39.7 | 0.1 | 2 | 349.9 / 81.6 | 0.0 / 1671.1 / 793.4 |
| build / load | 16.7 | 0.0 | 0.0 | 41.6 | 8.9 | 39.1 | 0.1 | 0 | 365.3 / 129.4 | 21.1 / 2620.1 / 1214.1 |
| build / drag | 16.8 | 0.0 | 0.0 | 13.2 | 0.0 | 11.6 | 0.1 | 2 | 349.6 / 86.3 | 0.0 / 2855.3 / 1287.3 |
| build / release | 16.8 | 0.0 | 0.0 | 53.8 | 8.4 | 50.7 | 0.1 | 0 | 349.6 / 86.3 | 0.0 / 2594.4 / 1200.6 |
| build / resume | 16.8 | 0.0 | 0.0 | 53.1 | 9.2 | 50.9 | 0.1 | 0 | 349.5 / 91.4 | 0.0 / 2947.6 / 1340.2 |
| build / scroll | 16.8 | 0.0 | 0.0 | 29.1 | 6.4 | 22.5 | 0.1 | 0 | 410.1 / 131.8 | 53.5 / 2201.2 / 1302.8 |
| build / knob-erosionRain continuous | 16.8 | 0.0 | 8.7 | 41.1 | 9.2 | 38.8 | 0.1 | 0 | 340.7 / 84.1 | 20.4 / 4212.9 / 1699.6 |
| build / knob-erosionRain pause | 16.8 | 0.0 | 10.9 | 42.0 | 10.1 | 39.8 | 0.1 | 0 | 340.7 / 89.4 | 19.1 / 4704.3 / 1918.8 |
| build / knob-creaseShade cold-gate | 16.8 | 0.0 | 5.9 | 41.9 | 0.0 | 38.7 | 0.1 | 2 | 350.1 / 83.3 | 0.0 / 1670.4 / 792.7 |

Ancillary percentiles are the larger per-run p95, maxima are over both
runs, and outside-region times sum both runs. Mixed-region GPU time is
measured; area weighting is an estimate, not isolated outside GPU time.

| Build / row workload | Handler total p50 / p95 | history.replaceState p50 / p95 | saveWorlds p50 / p95 | applyKnobs p50 / p95 | syncWorldControls p50 / p95 | setColors p50 / p95 |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| main / knob-erosionRain continuous | 7.9 / 9.9 | 2.0 / 2.4 | 0.0 / 0.1 | 1.0 / 1.3 | 1.7 / 2.2 | 0.0 / 0.0 |
| main / knob-erosionRain pause | 7.8 / 10.9 | 1.9 / 2.7 | 0.0 / 0.1 | 1.0 / 1.5 | 1.5 / 2.2 | 0.0 / 0.0 |
| main / knob-creaseShade cold-gate | 4.0 / 5.6 | 1.5 / 1.9 | 0.0 / 0.1 | 0.9 / 1.5 | 1.4 / 1.6 | 0.0 / 0.0 |
| build / knob-erosionRain continuous | 7.2 / 8.7 | 2.0 / 2.3 | 0.0 / 0.1 | 1.0 / 1.3 | 1.6 / 2.1 | 0.0 / 0.0 |
| build / knob-erosionRain pause | 7.3 / 10.9 | 2.1 / 2.8 | 0.0 / 0.1 | 1.0 / 1.5 | 1.6 / 2.5 | 0.0 / 0.0 |
| build / knob-creaseShade cold-gate | 4.1 / 5.9 | 1.7 / 2.1 | 0.0 / 0.1 | 0.9 / 1.2 | 1.4 / 2.0 | 0.0 / 0.0 |

Handler columns give the larger per-run percentile; zero means the callee
was not observed within that handler. Callee times can overlap. Raw small
JSON records retain both trials and pipeline keys under the external evidence
folder named in the report.

## red-3 / map4

| Build / phase | Changed pixels | First tile | Pointer tile | Whole current | Pause/release to final |
| --- | ---: | ---: | ---: | ---: | ---: |
| main / load | 109.0 / 141.6 [2/2] | 109.0 / 141.6 [2/2] | — / — [0/0] | 3653.7 / 3686.0 [2/2] | 3650.0 / 3681.9 [2/2] |
| main / drag | 26.1 / 36.7 [80/80] | 26.1 / 36.7 [80/80] | 75.5 / 2326.6 [80/80] | 4715.8 / 5598.9 [80/80] | 3699.7 / 3748.7 [2/2] |
| main / release | 14.6 / 16.1 [2/2] | 14.6 / 16.1 [2/2] | — / — [0/0] | 3699.7 / 3748.7 [2/2] | 3699.7 / 3748.7 [2/2] |
| main / resume | 27.2 / 93.4 [64/64] | 27.2 / 93.4 [64/64] | 74.8 / 996.4 [64/64] | 4446.4 / 5179.3 [64/64] | 3630.2 / 3667.5 [2/2] |
| main / scroll | 26.7 / 28.8 [2/2] | 26.7 / 28.8 [2/2] | — / — [0/0] | 2106.9 / 2362.3 [2/2] | — / — [0/0] |
| main / knob-erosionRain continuous | 2527.5 / 3978.2 [72/72] | 2527.5 / 3978.2 [72/72] | — / — [0/0] | 5679.6 / 7146.1 [72/72] | 3792.5 / 4371.4 [2/2] |
| main / knob-erosionRain pause | 2445.7 / 5315.4 [72/72] | 2445.7 / 5315.4 [72/72] | — / — [0/0] | 6046.2 / 8446.1 [72/72] | 4186.7 / 4272.1 [2/2] |
| main / knob-creaseShade cold-gate | 1005.2 / 1843.4 [72/72] | 27.9 / 78.0 [72/72] | — / — [0/0] | 4014.5 / 4833.6 [72/72] | 3095.2 / 3129.1 [2/2] |
| build / load | 136.7 / 163.4 [2/2] | 136.7 / 163.4 [2/2] | — / — [0/0] | 3620.7 / 3755.5 [2/2] | 3617.1 / 3749.4 [2/2] |
| build / drag | 26.6 / 36.5 [80/80] | 26.6 / 36.5 [80/80] | 75.3 / 2346.3 [80/80] | 4728.3 / 5626.5 [80/80] | 3698.8 / 3727.2 [2/2] |
| build / release | 0.9 / 14.2 [2/2] | 0.9 / 14.2 [2/2] | — / — [0/0] | 3698.8 / 3727.2 [2/2] | 3698.8 / 3727.2 [2/2] |
| build / resume | 26.0 / 30.6 [64/64] | 26.0 / 30.6 [64/64] | 29.6 / 79.2 [64/64] | 4462.1 / 5194.7 [64/64] | 3665.4 / 3695.7 [2/2] |
| build / scroll | 24.1 / 28.7 [2/2] | 24.1 / 28.7 [2/2] | — / — [0/0] | 2099.2 / 2458.7 [2/2] | — / — [0/0] |
| build / knob-erosionRain continuous | 1632.3 / 2481.2 [72/72] | 1632.3 / 2481.2 [72/72] | — / — [0/0] | 4761.5 / 5595.3 [72/72] | 3841.2 / 3870.0 [2/2] |
| build / knob-erosionRain pause | 1148.6 / 1563.5 [72/72] | 1148.6 / 1563.5 [72/72] | — / — [0/0] | 4662.6 / 6462.1 [72/72] | 3671.7 / 3772.7 [2/2] |
| build / knob-creaseShade cold-gate | 1043.0 / 1855.7 [72/72] | 27.5 / 75.6 [72/72] | — / — [0/0] | 4014.6 / 4846.3 [72/72] | 3108.5 / 3126.5 [2/2] |

| Build / phase | rAF p95 | Long task max | Handler p95 | GPU queue wall max | Time GPU max | Any GPU max | Bitmap p95 | Pipelines compiled | Peak GPU / accounted heap MiB | Wholly outside / mixed / area-weighted outside GPU |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| main / load | 16.8 | 76.0 | 0.0 | 255.4 | 228.4 | 228.4 | 0.1 | 0 | 282.0 / 306.5 | 0.0 / 1425.2 / 725.2 |
| main / drag | 16.7 | 0.0 | 0.0 | 14.5 | 0.0 | 9.8 | 0.1 | 2 | 367.0 / 203.1 | 0.0 / 1690.2 / 853.9 |
| main / release | 16.8 | 0.0 | 0.0 | 291.9 | 239.3 | 239.3 | 0.1 | 0 | 367.0 / 203.1 | 0.0 / 1453.5 / 746.6 |
| main / resume | 16.8 | 0.0 | 0.0 | 245.2 | 236.8 | 236.8 | 0.1 | 0 | 371.6 / 282.7 | 0.0 / 1909.5 / 1005.1 |
| main / scroll | 16.8 | 0.0 | 0.0 | 18.3 | 0.0 | 9.9 | 0.1 | 0 | 187.0 / 269.1 | 0.0 / 145.2 / 108.9 |
| main / knob-erosionRain continuous | 16.8 | 0.0 | 10.0 | 712.5 | 677.5 | 677.5 | 0.1 | 0 | 340.5 / 272.8 | 0.0 / 8377.2 / 5474.6 |
| main / knob-erosionRain pause | 16.8 | 0.0 | 9.1 | 703.9 | 674.7 | 674.7 | 0.1 | 0 | 359.1 / 268.5 | 0.0 / 11048.7 / 7281.9 |
| main / knob-creaseShade cold-gate | 16.8 | 0.0 | 5.6 | 33.2 | 0.0 | 30.1 | 0.1 | 2 | 203.7 / 202.0 | 0.0 / 812.4 / 359.8 |
| build / load | 16.8 | 92.0 | 0.0 | 146.2 | 16.4 | 20.5 | 0.1 | 0 | 282.1 / 306.5 | 0.0 / 1442.8 / 734.4 |
| build / drag | 16.7 | 0.0 | 0.0 | 13.8 | 0.0 | 9.2 | 0.1 | 2 | 367.9 / 199.4 | 0.0 / 1673.1 / 841.7 |
| build / release | 16.8 | 0.0 | 0.0 | 39.7 | 16.1 | 33.9 | 0.1 | 0 | 367.9 / 199.4 | 0.0 / 1422.7 / 730.1 |
| build / resume | 16.7 | 0.0 | 0.0 | 27.8 | 22.9 | 26.4 | 0.1 | 0 | 373.4 / 281.7 | 0.0 / 1753.9 / 880.7 |
| build / scroll | 16.8 | 0.0 | 0.0 | 13.8 | 0.0 | 10.7 | 0.1 | 0 | 186.9 / 268.8 | 0.0 / 146.5 / 109.9 |
| build / knob-erosionRain continuous | 16.8 | 0.0 | 9.5 | 50.5 | 29.5 | 29.5 | 0.1 | 0 | 340.2 / 274.4 | 0.0 / 4618.0 / 2934.5 |
| build / knob-erosionRain pause | 16.7 | 0.0 | 8.4 | 32.0 | 26.1 | 26.1 | 0.1 | 0 | 359.6 / 269.1 | 0.0 / 5968.0 / 3844.9 |
| build / knob-creaseShade cold-gate | 16.8 | 0.0 | 5.8 | 30.7 | 0.0 | 27.5 | 0.1 | 2 | 203.7 / 202.2 | 0.0 / 795.3 / 351.6 |

Ancillary percentiles are the larger per-run p95, maxima are over both
runs, and outside-region times sum both runs. Mixed-region GPU time is
measured; area weighting is an estimate, not isolated outside GPU time.

| Build / row workload | Handler total p50 / p95 | history.replaceState p50 / p95 | saveWorlds p50 / p95 | applyKnobs p50 / p95 | syncWorldControls p50 / p95 | setColors p50 / p95 |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| main / knob-erosionRain continuous | 7.9 / 10.0 | 2.0 / 2.8 | 0.0 / 0.1 | 1.0 / 1.2 | 1.7 / 2.1 | 0.0 / 0.0 |
| main / knob-erosionRain pause | 7.6 / 9.1 | 2.0 / 2.5 | 0.0 / 0.1 | 0.9 / 1.2 | 1.5 / 1.9 | 0.0 / 0.0 |
| main / knob-creaseShade cold-gate | 3.5 / 5.6 | 1.3 / 2.1 | 0.0 / 0.1 | 0.7 / 1.2 | 1.2 / 1.7 | 0.0 / 0.0 |
| build / knob-erosionRain continuous | 8.2 / 9.5 | 2.2 / 2.6 | 0.0 / 0.1 | 0.9 / 1.1 | 1.7 / 2.1 | 0.0 / 0.0 |
| build / knob-erosionRain pause | 7.1 / 8.4 | 1.9 / 2.3 | 0.0 / 0.1 | 0.9 / 1.2 | 1.6 / 1.8 | 0.0 / 0.0 |
| build / knob-creaseShade cold-gate | 3.5 / 5.8 | 1.4 / 1.7 | 0.0 / 0.1 | 0.7 / 1.6 | 1.2 / 2.1 | 0.0 / 0.0 |

Handler columns give the larger per-run percentile; zero means the callee
was not observed within that handler. Callee times can overlap. Raw small
JSON records retain both trials and pipeline keys under the external evidence
folder named in the report.

## red-3 / map16

| Build / phase | Changed pixels | First tile | Pointer tile | Whole current | Pause/release to final |
| --- | ---: | ---: | ---: | ---: | ---: |
| main / load | 42.0 / 49.1 [2/2] | 42.0 / 49.1 [2/2] | — / — [0/0] | — / — [0/2] | — / — [0/0] |
| main / drag | 30.4 / 36.4 [80/80] | 30.4 / 36.4 [80/80] | 78.0 / 2514.2 [80/80] | 5082.4 / 5979.0 [80/80] | 4067.3 / 4129.7 [2/2] |
| main / release | 1.0 / 479.1 [2/2] | 1.0 / 479.1 [2/2] | — / — [0/0] | 4067.3 / 4129.7 [2/2] | 4067.3 / 4129.7 [2/2] |
| main / resume | 29.8 / 59.1 [64/64] | 29.8 / 59.1 [64/64] | 66.7 / 85.0 [64/64] | 4856.4 / 5572.2 [64/64] | 3983.7 / 4106.9 [2/2] |
| main / scroll | 28.0 / 36.4 [2/2] | 28.0 / 36.4 [2/2] | — / — [0/0] | 7188.0 / 7234.0 [2/2] | 7184.1 / 7233.4 [2/2] |
| main / knob-erosionRain continuous | 1906.5 / 2756.4 [72/72] | 1906.5 / 2756.4 [72/72] | — / — [0/0] | 5715.8 / 6665.7 [72/72] | 4604.8 / 5024.8 [2/2] |
| main / knob-erosionRain pause | 1660.7 / 3819.3 [72/72] | 1660.7 / 3819.3 [72/72] | — / — [0/0] | 6001.2 / 7751.1 [72/72] | 4747.5 / 5107.2 [2/2] |
| main / knob-creaseShade cold-gate | 1020.1 / 1855.4 [72/72] | 30.5 / 80.3 [72/72] | — / — [0/0] | 4165.9 / 4998.7 [72/72] | 3262.3 / 3279.5 [2/2] |
| build / load | 55.6 / 57.7 [2/2] | 55.6 / 57.7 [2/2] | — / — [0/0] | — / — [0/2] | — / — [0/0] |
| build / drag | 29.6 / 46.9 [80/80] | 29.6 / 46.9 [80/80] | 78.1 / 2593.3 [80/80] | 5182.9 / 6065.6 [80/80] | 4165.1 / 4182.8 [2/2] |
| build / release | 13.6 / 14.1 [2/2] | 13.6 / 14.1 [2/2] | — / — [0/0] | 4165.1 / 4182.8 [2/2] | 4165.1 / 4182.8 [2/2] |
| build / resume | 30.1 / 35.0 [64/64] | 30.1 / 35.0 [64/64] | 35.2 / 1356.2 [64/64] | 5013.8 / 5717.7 [64/64] | 4167.8 / 4213.4 [2/2] |
| build / scroll | 29.7 / 31.4 [2/2] | 29.7 / 31.4 [2/2] | — / — [0/0] | 7491.9 / 7609.8 [2/2] | 7491.2 / 7609.2 [2/2] |
| build / knob-erosionRain continuous | 1906.8 / 2751.9 [72/72] | 1906.8 / 2751.9 [72/72] | — / — [0/0] | 5935.3 / 6772.7 [72/72] | 4944.1 / 5132.4 [2/2] |
| build / knob-erosionRain pause | 1594.5 / 3709.0 [72/72] | 1594.5 / 3709.0 [72/72] | — / — [0/0] | 5950.1 / 7780.5 [72/72] | 5040.9 / 5042.1 [2/2] |
| build / knob-creaseShade cold-gate | 168.9 / 1764.1 [72/72] | 30.7 / 81.1 [72/72] | — / — [0/0] | 4183.0 / 5031.8 [72/72] | 3247.7 / 3345.2 [2/2] |

| Build / phase | rAF p95 | Long task max | Handler p95 | GPU queue wall max | Time GPU max | Any GPU max | Bitmap p95 | Pipelines compiled | Peak GPU / accounted heap MiB | Wholly outside / mixed / area-weighted outside GPU |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| main / load | 16.8 | 0.0 | 0.0 | 141.7 | 134.5 | 134.5 | 0.1 | 0 | 351.8 / 91.2 | 335.9 / 2042.2 / 1037.3 |
| main / drag | 16.8 | 0.0 | 0.0 | 16.2 | 0.0 | 10.6 | 0.1 | 2 | 350.3 / 90.5 | 0.0 / 2041.9 / 1001.0 |
| main / release | 16.8 | 0.0 | 0.0 | 114.1 | 107.6 | 107.6 | 0.1 | 0 | 350.3 / 90.5 | 0.0 / 1787.3 / 903.0 |
| main / resume | 16.8 | 0.0 | 0.0 | 110.1 | 102.2 | 102.2 | 0.1 | 0 | 350.2 / 90.4 | 0.0 / 2081.6 / 1051.8 |
| main / scroll | 16.8 | 0.0 | 0.0 | 346.1 | 333.0 | 333.0 | 0.1 | 0 | 397.1 / 129.5 | 2709.3 / 3908.0 / 2646.3 |
| main / knob-erosionRain continuous | 16.8 | 0.0 | 8.8 | 363.8 | 348.9 | 348.9 | 0.1 | 0 | 327.6 / 86.4 | 919.5 / 5707.5 / 2460.7 |
| main / knob-erosionRain pause | 16.8 | 0.0 | 10.5 | 365.8 | 348.9 | 348.9 | 0.1 | 0 | 327.6 / 91.4 | 958.1 / 7560.8 / 3525.5 |
| main / knob-creaseShade cold-gate | 16.8 | 0.0 | 5.3 | 34.9 | 0.0 | 31.1 | 0.1 | 2 | 347.4 / 83.3 | 0.0 / 824.2 / 366.2 |
| build / load | 16.7 | 0.0 | 0.0 | 26.0 | 16.1 | 21.2 | 0.1 | 0 | 351.8 / 73.7 | 344.3 / 2036.6 / 1038.9 |
| build / drag | 16.7 | 0.0 | 0.0 | 21.6 | 0.0 | 12.1 | 0.1 | 2 | 350.2 / 94.9 | 0.0 / 2069.0 / 1014.0 |
| build / release | 16.7 | 0.0 | 0.0 | 27.1 | 12.6 | 25.0 | 0.1 | 0 | 350.2 / 94.9 | 0.0 / 1802.2 / 914.7 |
| build / resume | 16.8 | 0.0 | 0.0 | 29.5 | 5.2 | 25.2 | 0.1 | 0 | 350.2 / 93.1 | 0.0 / 2066.1 / 1040.8 |
| build / scroll | 16.8 | 0.0 | 0.0 | 17.2 | 16.0 | 16.0 | 0.1 | 0 | 397.3 / 145.4 | 2902.8 / 4181.1 / 2866.6 |
| build / knob-erosionRain continuous | 16.7 | 0.0 | 8.9 | 48.7 | 30.5 | 43.0 | 0.1 | 0 | 327.5 / 84.8 | 1200.5 / 4459.0 / 2054.1 |
| build / knob-erosionRain pause | 16.7 | 0.0 | 15.1 | 23.0 | 14.2 | 20.4 | 0.1 | 0 | 327.5 / 79.7 | 1204.2 / 6102.6 / 3074.9 |
| build / knob-creaseShade cold-gate | 16.8 | 0.0 | 4.8 | 31.9 | 0.0 | 28.6 | 0.1 | 2 | 347.0 / 83.7 | 0.0 / 825.0 / 366.5 |

Ancillary percentiles are the larger per-run p95, maxima are over both
runs, and outside-region times sum both runs. Mixed-region GPU time is
measured; area weighting is an estimate, not isolated outside GPU time.

| Build / row workload | Handler total p50 / p95 | history.replaceState p50 / p95 | saveWorlds p50 / p95 | applyKnobs p50 / p95 | syncWorldControls p50 / p95 | setColors p50 / p95 |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| main / knob-erosionRain continuous | 7.9 / 8.8 | 2.0 / 2.3 | 0.0 / 0.2 | 1.0 / 1.3 | 1.7 / 2.0 | 0.0 / 0.0 |
| main / knob-erosionRain pause | 8.0 / 10.5 | 2.1 / 2.8 | 0.0 / 0.1 | 1.0 / 1.5 | 1.6 / 2.3 | 0.0 / 0.0 |
| main / knob-creaseShade cold-gate | 3.5 / 5.3 | 1.3 / 2.1 | 0.0 / 0.1 | 0.7 / 1.2 | 1.2 / 1.6 | 0.0 / 0.0 |
| build / knob-erosionRain continuous | 7.2 / 8.9 | 2.1 / 2.3 | 0.0 / 0.1 | 1.0 / 1.2 | 1.7 / 2.1 | 0.0 / 0.0 |
| build / knob-erosionRain pause | 7.5 / 15.1 | 2.3 / 5.2 | 0.0 / 0.1 | 1.0 / 1.5 | 1.6 / 3.2 | 0.0 / 0.0 |
| build / knob-creaseShade cold-gate | 3.6 / 4.8 | 1.4 / 2.1 | 0.0 / 0.1 | 0.7 / 1.0 | 1.2 / 1.6 | 0.0 / 0.0 |

Handler columns give the larger per-run percentile; zero means the callee
was not observed within that handler. Callee times can overlap. Raw small
JSON records retain both trials and pipeline keys under the external evidence
folder named in the report.
