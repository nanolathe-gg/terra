# LP2 focused timings, 2026-11-12

Measured in Chrome 157 on the M3 Pro, `green-modern-2`, map16, 1728×1024 terrain pixels. Both builds use 2048 MiB. Main is `222ace7a`; review is `28831a7a`. Two alternating pairs ran in order review 2 → main 2048/1 → review 3 → main 2048/2. Fresh-server warm-ups were discarded. Each run checked `ps` and passed three consecutive driver-utilization samples at or below 20%. The compact evidence records the samples, process snapshots, exact benchmark blob and every phase’s distributions.

This is one focused fixture, not LP2 acceptance. Other scenes, map4, the smaller view, 512 MiB and the full slider matrix remain pending. Broader correctness runs remain deferred at the owner’s request. Thresholds are unchanged.

All table times are milliseconds, p50 / p95, pooled only within this fixture and build. “First changed” checks RGBA changes; first tile and pointer tile are reported separately. No requested input is censored in first/whole coverage. Slider gestures have no terrain-pointer sample.

| Phase | Build | First changed | First tile | Pointer tile | Whole current | Release → final |
| --- | --- | ---: | ---: | ---: | ---: | ---: |
| Load | main | 58.0 / 58.2 | 58.0 / 58.2 | — | 2152.1 / 2168.3 | 7369.0 / 7390.7 |
| Load | review | 518.6 / 534.4 | 518.6 / 534.4 | — | 518.6 / 534.4 | 2881.9 / 2893.9 |
| Stroke drag | main | 30.5 / 50.1 | 30.5 / 50.1 | 78.1 / 1341.6 | 6734.2 / 7635.4 | 5706.7 / 5737.8 |
| Stroke drag | review | 70.3 / 97.0 | 18.7 / 96.4 | 70.3 / 97.0 | 70.3 / 97.0 | 3096.1 / 3155.1 |
| Stroke release | main | 21.5 / 379.0 | 21.5 / 379.0 | — | 5706.7 / 5737.8 | 5706.7 / 5737.8 |
| Stroke release | review | 18.8 / 481.9 | 12.7 / 15.4 | — | 3096.1 / 3155.1 | 3096.1 / 3155.1 |
| Resume stroke | main | 31.0 / 102.3 | 31.0 / 102.3 | 76.8 / 1427.5 | 6670.0 / 7459.1 | 5736.6 / 6012.0 |
| Resume stroke | review | 70.4 / 97.0 | 70.4 / 97.0 | 70.4 / 97.0 | 70.4 / 97.0 | 3045.9 / 3111.6 |
| Rock continuous | main | 33.6 / 57.6 | 33.6 / 57.6 | — | 5730.2 / 6565.7 | 4826.8 / 4844.0 |
| Rock continuous | review | 44.5 / 74.3 | 44.5 / 74.3 | — | 44.5 / 74.3 | 2313.3 / 2347.5 |
| Rock pause | main | 33.6 / 57.3 | 33.6 / 57.3 | — | 5760.9 / 7596.9 | 4862.1 / 4874.3 |
| Rock pause | review | 47.5 / 74.3 | 47.5 / 74.3 | — | 47.5 / 74.3 | 2311.0 / 2322.1 |
| Cold gate | main | 55.0 / 92.5 | 55.0 / 92.5 | — | 5743.0 / 6577.8 | 4807.1 / 4890.4 |
| Cold gate | review | 59.5 / 85.9 | 59.5 / 85.9 | — | 59.5 / 85.9 | 2432.5 / 2559.6 |

A one-second mid-drag pause does not finish the whole view on either build: two pause anchors per build are censored; the release anchors above finish. The focused final-cost gate uses release medians. Review stroke releases are 3096.1, 3155.1 ms, against 5737.8, 5706.7 ms. Rock continuous releases are 2347.5, 2313.3 ms, against 4844.0, 4826.8 ms. Both improve well beyond main’s own spread.

| Phase | Build | rAF p95 | Handler p95 | Long tasks | Queue max | GPU submission max | Sets compiled | Copy p95 | Peak MiB | Wholly off-screen GPU ms |
| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| Load | main | 16.8 | 0.0 | 0.0 | 198.8 | 186.4 | 0.0 | 0.1 | 365.3 | 8.7 |
| Load | review | 16.8 | 0.0 | 0.0 | 80.5 | 77.9 | 0.0 | 0.1 | 910.5 | 24.7 |
| Stroke drag | main | 16.8 | 0.0 | 0.0 | 21.1 | 16.3 | 2.0 | 0.1 | 349.6 | 0.0 |
| Stroke drag | review | 16.8 | 0.0 | 0.0 | 43.1 | 39.6 | 2.0 | 0.1 | 915.7 | 0.0 |
| Stroke release | main | 16.8 | 0.0 | 0.0 | 232.6 | 216.5 | 0.0 | 0.1 | 349.6 | 0.0 |
| Stroke release | review | 16.8 | 0.0 | 0.0 | 106.7 | 103.0 | 2.0 | 0.1 | 915.7 | 0.0 |
| Resume stroke | main | 16.7 | 0.0 | 0.0 | 215.5 | 204.0 | 0.0 | 0.1 | 349.5 | 0.0 |
| Resume stroke | review | 16.8 | 0.0 | 0.0 | 105.5 | 103.1 | 0.0 | 0.1 | 915.8 | 0.0 |
| Rock continuous | main | 16.7 | 5.7 | 0.0 | 48.1 | 39.0 | 0.0 | 0.1 | 350.1 | 0.0 |
| Rock continuous | review | 16.8 | 0.4 | 0.0 | 87.7 | 79.0 | 0.0 | 0.1 | 915.9 | 0.0 |
| Rock pause | main | 16.8 | 6.5 | 0.0 | 41.8 | 38.7 | 0.0 | 0.1 | 350.1 | 0.0 |
| Rock pause | review | 16.8 | 0.5 | 0.0 | 157.0 | 152.8 | 0.0 | 0.1 | 994.1 | 0.0 |
| Cold gate | main | 16.7 | 6.7 | 0.0 | 41.1 | 38.9 | 2.0 | 0.1 | 350.1 | 0.0 |
| Cold gate | review | 16.8 | 0.5 | 0.0 | 90.2 | 87.5 | 2.0 | 0.2 | 954.9 | 0.0 |

The maxima/p95 columns above take the worse of the two runs; set and long-task counts sum both. Compilations are for final refinement: both review cold crossings start **zero** pipelines before their first changed preview. Main starts three pipelines there. Both builds have zero drag long tasks. The review’s total accounted terrain peak is about 994 MiB. Mixed on/off-screen passes are retained separately in the evidence; their apron share cannot be divided exactly.

Handler callee time is recorded for `history.replaceState`, `saveWorlds`, `applyKnobs` and `syncWorldControls` in every phase. In review they are zero inside the input handler because application/persistence runs at the frame or commit. Those later tasks are still included in rAF/long-task observation. For the continuous rock row, main’s per-event p50 / p95 ranges are: history 1.4–1.5 / 1.8–2.3 ms, saveWorlds 0 / 0.1 ms, applyKnobs 0.8–0.9 / 1.1–1.2 ms, and syncWorldControls 1.7 / 1.9–2.7 ms. Review records zero for each inside the handler. The detailed distributions remain in the compact evidence.

The two earlier default-budget pairs (main 512, review 2048) give the same broad result. They are kept separately and are not used for the same-budget final-cost claim. One main run hit `ENOTEMPTY` during deletion of its owned Chrome profile after `finishedAt` and all metric/console checks had been saved. Its completed measurement is retained, its profile was deleted after the child finished writing, and cleanup now retries. No performance threshold or measured endpoint changed.

Focused result: LP2’s 200-ms whole-view row passes for stroke and rock, load’s coarse picture is below one second, the final-cost limit passes, and the cold preview does not compile. The 50-ms first-changed-pixel goal is still missed. Individual stroke p95 values are 96.4 and 105.3 ms, so the 100-ms broader whole-view target is not yet a consistent pass. The focused final tile arrives 656–665 ms after rock release, missing its 600-ms target; final GPU submissions also exceed 100 ms (remaining LP4 work). These results justify continuing with LP3’s smaller preview inputs; they do not close LP2’s remaining memory, fixture and combined pixel/export gates.
