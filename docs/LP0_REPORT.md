# LP0: main in Chrome, 2026-11-12

**Measured baseline:** main `98b0288e`, Apple M3 Pro / 18 GiB, macOS 26.6.2, Chrome/157.0.8103.78. No editor files changed. **The LP0 table is filled with the owner-approved scripted Colors exception.** Native Colors produced 0 input events in 48 attempted drags. A separate 24-session supplement now measures the existing picker through value/input events, explicitly labeled scripted rather than native mouse. No LP0b work.

All table times are **measured milliseconds, p50 / p95**, unless labeled otherwise. Quantiles pool input events across the three fixtures, both view sizes and the two repetitions of the named map size. Superseded inputs wait for a later image that includes them; frame rate and tile throughput are not latency. The original mouse-workload numbers are retained; Colors comes from a separate timing window on the same pinned engine and is not pooled with Ambient.

| Section 2 workload | Map | First changed pixels | Whole affected view current | Release to final |
| --- | --- | ---: | ---: | ---: |
| Stroke (stroke/move/card budget) | map4 | 28.4 / 232.2 ✗ | 1191.4 / 6247.4 ✗ | 1794.9 / 5018.2 |
| Stroke (stroke/move/card budget) | map16 | 30.7 / 80.2 ✗ | 1546.7 / 6675.8 ✗ | 2586.5 / 5434.7 |
| World / rock / surface / sun | map4 | 33.2 / 94.7 ✗ | 2372.2 / 6273.3 ✗ | 1276.6 / 4733.8 |
| World / rock / surface / sun | map16 | 36.6 / 100.1 ✗ | 2407.5 / 6504.7 ✗ | 1369.3 / 4995.5 |
| Light strength (Ambient only) | map4 | 34.2 / 97.2 ✗ | 2494.5 / 6172.5 ✗ | 1279.8 / 4549.2 |
| Light strength (Ambient only) | map16 | 36.5 / 110.9 ✗ | 2585.5 / 6241.2 ✗ | 1374.6 / 4854.0 |
| Time (Rain) | map4 | 1897.2 / 6012.0 ✗ | 4558.8 / 7619.1 | 2489.7 / 4952.9 |
| Time (Rain) | map16 | 1897.9 / 3946.5 ✗ | 4423.4 / 7431.4 | 2431.4 / 5407.3 |
| Pan onto uncached ground | map4 | 30.9 / 76.8 ✗ | 503.2 / 3033.0 ✗ | 804.3 / 3303.2 |
| Pan onto uncached ground | map16 | 33.1 / 58.5 ✗ | 4092.8 / 7843.1 ✗ | 4317.9 / 7842.3 |
| First scene picture | map4 | 347.4 / 919.6 | 1842.4 / 5272.8 ✗ | 1840.8 / 5270.4 |
| First scene picture | map16 | 48.7 / 67.2 | 543.8 / 2361.4 ✗ | 2707.3 / 7467.7 |
| Colors (scripted)† | map4 | 36.1 / 91.3 ✗ | 2161.1 / 5651.4 ✗ | 1215.1 / 4440.4 |
| Colors (scripted)† | map16 | 43.8 / 96.3 ✗ | 2193.4 / 6013.7 ✗ | 1266.3 / 4817.2 |

✓/✗ tests the plan’s fixed p95 budget: first 50 ms (Rain 100 ms), whole view 100 ms (Ambient and Colors 150 ms, load 1,000 ms). Rain has no fixed whole-view deadline in the plan. Final columns establish today’s baseline; a later implementation must stay within 1.10× it. This bench does not measure early-preview overhead against another implementation. Move, shape-card, shine, palette and zoom are not separate sampled tools. † Colors’ final latency begins at the end of the scripted sequence. It excludes native chooser opening, mouse routing and popup delivery; every observed whole-current Colors image was already at final quality.

| Phase / control (both maps pooled) | First changed pixels | First fresh tile (`latency`) | Pointer tile (`latencyPointer`) | Whole area (`latencyAll`) | Release to final |
| --- | ---: | ---: | ---: | ---: | ---: |
| Load | 67.2 / 908.3 | 67.2 / 908.3 | — / — | 1787.4 / 5169.1 | 2432.8 / 7445.6 |
| Drag | 29.4 / 78.2 | 28.2 / 43.4 | 61.0 / 894.2 | 1049.1 / 6552.8 | 2166.5 / 5428.0 |
| Release | 393.4 / 1524.1 | 18.7 / 1476.5 | — / — | 2166.5 / 5428.0 | 2166.5 / 5428.0 |
| Resume | 30.4 / 293.8 | 29.6 / 258.4 | 75.7 / 731.8 | 1514.8 / 6349.7 | 2244.4 / 5396.5 |
| Rock | 38.6 / 100.5 | 38.4 / 99.0 | — / — | 2546.4 / 6504.7 | 1360.2 / 4999.3 |
| Surface | 32.0 / 87.4 | 32.0 / 86.9 | — / — | 2006.0 / 6435.6 | 1369.3 / 4733.9 |
| Ambient | 36.0 / 108.7 | 35.9 / 103.5 | — / — | 2543.9 / 6191.7 | 1374.6 / 4654.8 |
| Sun | 36.1 / 106.1 | 36.0 / 101.9 | — / — | 2544.8 / 6260.4 | 1354.2 / 4622.7 |
| Colors (scripted) | 39.2 / 93.5 | 39.2 / 93.5 | — / — | 2178.6 / 5889.8 | 1266.3 / 4778.4 |
| Rain | 1897.9 / 4863.1 | 1897.9 / 4863.1 | — / — | 4489.5 / 7498.9 | 2489.7 / 5395.2 |
| Cold | 107.3 / 1840.1 | 36.5 / 132.5 | — / — | 2578.4 / 6129.0 | 1439.4 / 4977.9 |
| Pan | 33.1 / 75.1 | 33.1 / 75.1 | — / — | 537.8 / 7674.6 | 2499.4 / 7672.5 |

Rain while held: 234/1728 inputs reached changed pixels and 0/1728 reached whole-view current before release. The table includes later completion instead of silently dropping those waiting inputs.

Primary matrix focus tile after pause/release: **35.6 / 1564.4 ms**, 417/432 anchors observed; 332/432 meet 600 ms. Unfinished mid-drag pauses are censored at the next input, not called fast. 27/120 one-second mid-drag pauses reached whole-view final. Release-to-final samples above are fully observed. Pointer is not applicable to World rows or programmatic pan/load. Release has no new pointer-move input.

| Slider or picker handler | Own time | `replaceState` | `saveWorlds` | `applyKnobs` | `syncWorldControls` | `setColors` |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| Rock | 4.3 / 5.6 | 1.6 / 2.1 | 0.0 / 0.1 | 1.0 / 1.3 | 1.5 / 1.9 | — |
| Surface | 4.1 / 5.4 | 1.5 / 2.1 | 0.0 / 0.1 | 0.9 / 1.3 | 1.4 / 1.8 | — |
| Ambient | 4.0 / 5.4 | 1.5 / 2.1 | 0.0 / 0.1 | 0.9 / 1.3 | 1.4 / 1.8 | — |
| Sun | 4.1 / 5.5 | 1.5 / 2.1 | 0.0 / 0.1 | 1.0 / 1.3 | 1.4 / 1.9 | — |
| Rain | 9.5 / 11.1 | 2.2 / 2.6 | 0.0 / 0.1 | 1.1 / 1.4 | 1.6 / 1.9 | — |
| Cold | 3.8 / 4.4 | 1.4 / 1.7 | 0.0 / 0.1 | 0.9 / 1.1 | 1.2 / 1.6 | — |
| Colors (scripted) | 4.8 / 6.2 | 0.0 / 0.0 | 0.0 / 0.1 | 0.0 / 0.0 | 1.5 / 2.0 | 0.2 / 0.3 |

Handler own time includes the measured callees; their quantiles must not be added. Timer resolution is about 0.1 ms. The unassigned handler remainder is kept in the raw per-event measurements. Colors’ unassigned handler remainder is 3.1 / 4.0 ms; its history/applyKnobs call times are zero. Dashes in the other setColors rows mean that callee was not called.

| Phase / control | rAF p95 range¹ | Long tasks: count / max | Queue wait max | Submission max | Compiled sets / pipeline calls | Bitmap copy p95 max |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| Load | 16.7–16.8 | 0 / 0.0 | 800.1 | 759.2 | 0 / 0 | 0.2 |
| Drag | 16.7–16.8 | 0 / 0.0 | 33.3 | 18.5 | 0 / 0 | 0.1 |
| Release | 16.7–16.8 | 0 / 0.0 | 831.9 | 797.7 | 0 / 12 | 0.2 |
| Resume | 16.7–16.8 | 0 / 0.0 | 842.7 | 820.4 | 0 / 0 | 0.1 |
| Rock | 16.7–33.3 | 0 / 0.0 | 92.2 | 84.4 | 0 / 0 | 0.2 |
| Surface | 16.7–16.8 | 0 / 0.0 | 95.8 | 89.2 | 0 / 0 | 0.2 |
| Ambient | 16.7–16.8 | 0 / 0.0 | 92.0 | 81.1 | 0 / 0 | 0.2 |
| Sun | 16.7–33.3 | 0 / 0.0 | 94.4 | 82.3 | 0 / 0 | 0.2 |
| Rain | 16.7–16.8 | 0 / 0.0 | 926.2 | 908.8 | 0 / 0 | 0.2 |
| Cold | 16.7–16.8 | 0 / 0.0 | 88.9 | 83.7 | 24 / 72 | 0.1 |
| Pan | 16.7–16.8 | 2 / 55.0 | 464.0 | 451.0 | 0 / 0 | 0.2 |
| Colors (scripted) | 16.7–16.8 | 0 / 0.0 | 87.8 | 80.7 | 0 / 0 | 0.1 |

¹ Range of per-phase p95 values, not a pooled frame-interval quantile. Bitmap copy is the wall time of the createImageBitmap promise. Queue waits are wall time for waits started during the phase; GPU submissions use pass timestamp spans and include a pass already in flight at resume. Drag’s task/frame/submission columns stop at release; its latency evidence continues to visible final. Release overlaps Drag’s completion window, so those costs must not be summed.

| Phase / control | Accounted peak GPU / heap, MiB² | Wholly off-screen GPU, p50 / p95 | Mixed-region GPU, p50 / p95 | Area-weighted outside estimate, p50 / p95 |
| --- | ---: | ---: | ---: | ---: |
| Load | 421.8 / 307.1 | 0.0 / 721.4 | 1072.4 / 1882.3 | 540.8 / 1246.2 |
| Drag | 400.5 / 212.7 | 0.0 / 0.0 | 1270.5 / 2278.1 | 551.0 / 1408.8 |
| Release | 400.5 / 212.7 | 0.0 / 0.0 | 932.1 / 1826.3 | 431.3 / 1229.6 |
| Resume | 402.9 / 273.8 | 0.0 / 0.0 | 1378.4 / 2493.2 | 609.7 / 1565.9 |
| Rock | 372.4 / 267.6 | 0.0 / 111.1 | 656.8 / 989.1 | 201.2 / 401.9 |
| Surface | 418.1 / 270.3 | 0.0 / 0.0 | 659.4 / 962.3 | 216.1 / 397.4 |
| Ambient | 372.7 / 270.5 | 0.0 / 107.5 | 659.0 / 947.5 | 200.3 / 402.1 |
| Sun | 372.7 / 270.3 | 0.0 / 80.1 | 655.6 / 976.7 | 197.8 / 397.9 |
| Rain | 385.9 / 271.5 | 0.0 / 654.7 | 3597.1 / 7064.1 | 2056.8 / 5508.5 |
| Cold | 372.7 / 272.7 | 0.0 / 0.0 | 400.7 / 845.3 | 152.7 / 401.5 |
| Pan | 442.6 / 285.7 | 0.0 / 1852.3 | 241.0 / 2184.9 | 92.6 / 1535.5 |
| Colors (scripted) | 371.5 / 250.8 | 0.0 / 155.5 | 629.7 / 945.8 | 190.3 / 386.2 |

² Editor accounting, not OS process residency. Extra retained observer bitmaps peak at 25.8 MiB including the baseline; CPU pixel comparison runs after timing stops. Timestamp query/resolve allocations are also observer overhead outside editor accounting. Off-screen figures integrate compute/render pass time from input through visible final, with GPU/CPU clock uncertainty up to ±2.10 ms. Wholly outside and mixed refer to requested ground/tile-core rectangles; aprons and per-pixel cost within a mixed pass cannot be separated. The area-weighted column is an estimate, not measured wasted work. Copy-only GPU commands are not timestamped. Unclassified pass time is at most 1.97 ms per phase.

| Fixture / terrain view | Map | Stroke whole p95 A / B, s | Rock whole p95 A / B, s | Resume first preview A / B, ms |
| --- | --- | ---: | ---: | ---: |
| green-modern-2 / 1208×841 | map4 | 2.25 / 1.54 | 3.26 / 3.45 | 143.8 / 127.4 |
| green-modern-2 / 1208×841 | map16 | 2.30 / 2.31 | 3.37 / 3.48 | 167.5 / 127.8 |
| green-modern-2 / 1728×1024 | map4 | 6.90 / 6.79 | 6.47 / 6.47 | 147.2 / 193.7 |
| green-modern-2 / 1728×1024 | map16 | 7.25 / 7.21 | 6.70 / 6.78 | 140.0 / 140.4 |
| red-3 / 1208×841 | map4 | 1.19 / 1.15 | 2.68 / 2.64 | 183.0 / 197.1 |
| red-3 / 1208×841 | map16 | 1.57 / 1.56 | 2.72 / 2.70 | 85.9 / 86.3 |
| red-3 / 1728×1024 | map4 | 5.38 / 5.34 | 4.85 / 4.80 | 176.2 / 174.7 |
| red-3 / 1728×1024 | map16 | 5.81 / 5.83 | 5.05 / 5.10 | 64.0 / 122.5 |
| green-7 / 1208×841 | map4 | 1.84 / 1.71 | 2.63 / 2.67 | 720.4 / 719.4 |
| green-7 / 1208×841 | map16 | 2.65 / 2.71 | 2.74 / 2.71 | 269.5 / 236.1 |
| green-7 / 1728×1024 | map4 | 2.37 / 2.34 | 2.97 / 3.02 | 666.8 / 760.0 |
| green-7 / 1728×1024 | map16 | 3.02 / 3.32 | 3.09 / 3.03 | 272.7 / 276.6 |

Resume used a 100 ms host wait; release-marker to resume-marker gaps were 112.1–117.2 ms (CDP observation adds time before the actual pointerdown). A Time pass was in flight in 24/24 snapshots. First changed preview of the newly begun stroke: 174.7 / 720.4 ms. The cold gate’s first input: 78.1 / 2207.3 ms to changed pixels, 3262.2 / 6767.1 ms to whole view, with three pipeline API calls before its preview in 24/24 sessions.

**What the page adds to the Node findings [measured/read].** The small baseline starts with 20 visible 256 px tiles; the large cliff/Red views start with 126 visible 128 px tiles, while flat Green starts with 35 visible 256 px tiles, rather than the plan’s 28 tiles of 256. `configureChunks` temporarily tests a 128 MiB budget and the canvas reserve changes that decision; Surface drags can change the displayed tile size again. Thus these timings are not a direct Node-to-Chrome speed ratio. The page also exposes synchronous handler cost, interrupted one-second pauses, first-tile versus whole-view staleness, and resume waiting behind Time even while rAF remains smooth. GPU work on mixed and wholly off-screen regions is measurable before visible final.

**Primary matrix budgets already met [measured].** No >50 ms long task occurred during the sampled stroke or slider drags. Warm sliders and active strokes compiled no specialized set; the intentional cold gate compiled 24 sets / 72 pipelines. Twelve map4 releases also created the lazy `changed refinement tiles` compute pipeline (0.0–0.1 ms API time), after the stroke’s first preview; `specStats` does not count it. Uninterrupted Drag-phase submissions fit the 50 ms preview-unit budget. The fixed pooled picture-latency budgets fail at both map sizes; handler p95 exceeds 4 ms. Rain/Time submissions violate the global 100 ms submission budget. Individual pan first pictures sometimes meet 50 ms; that does not make the pooled p95 pass. Final ratios and early-preview overhead await a later implementation.

**Primary matrix protocol and limits.** 24 complete sessions = 3 scenes × 2 maps × 2 terrain views × 2 repetitions, one fresh Chrome/profile and distinct CDP port per session, terrain at 1× and (0,300), gpuMB=512 / heapMB=1536. Small Chrome window was 1600×1200; large used `--viewport 1728x1024`. Forward workload order alternated map4/map16; the second pass reversed it. Five A sessions were replaced at the end to repair missing/uncertain GPU-clock calibration, again alternating map sizes for the Green fixture. Both repetitions measure the same pinned main, not two builds. The quiet-start guard waited for three consecutive GPU readings ≤20%; the accepted final readings were 10.0–19.0%; 1-minute CPU load average was 2.0–6.4. Required top-process snapshots were captured; a 10-second watcher (excluding perf.mjs) found no other named repro/measure job overlapping the accepted sessions. Desktop/background activity still existed. The fresh-server warm-up was discarded; all earlier experiments were excluded.

Primary matrix input counts: 9,504 real slider events and 1,728 stroke moves. Each real row has 36 value-change events per scenario, continuous and with a requested 1,000 ms middle pause. Relief has fewer than 30 distinct legal positions, so its continuous sweep reverses at the endpoint. A separate `creaseShade` row leaves a verified 0: the requested rock and sun rows cannot reach zero, and not every zero is a shader gate. Native Colors popup drags delivered no input events (exit 2). The owner-approved scripted Colors workload supplies the separately labeled measurements above (exit 0). Export was skipped (`--no-export`); the phase remains available and has no plan budget.

Paint means the canvas draw endpoint, not physical scanout. First changed pixels are verified from tile RGBA after timing, replaying the immutable ImageBitmaps the page already created; pixel reads do not run on the timed path. CDP injects timing-only metadata/callee observers into served responses, with source-anchor assertions. Editor source on disk is unchanged. Earlier trace pointer positions and Rain feed serials were corrected from recorded screen paths/bake starts without altering timestamps; recovered Rain serials matched 723/723 directly recorded comparison paints. Scene load here is replay in an already booted page, matching the existing perf phase, not cold URL startup.

**Scripted Colors supplement [measured, owner authorized 2026-11-12].** 24 sessions / 48 sequences / 1728 input events, on Ground base color, all 36 distinct values per sequence and zero missing changed-pixel/whole-view samples. A full hue sweep uses saturation/value 0.65, 30 ms requested spacing, and a requested 1,000 ms middle pause in the paused case. Each sequence ends by restoring the original color and override checkbox outside timing. The default remains native; use `--colors scripted` explicitly. This supplement starts at Colors in a fresh session and does not replay the earlier five slider rows.

Before sequence end, 1703/1728 inputs reached changed pixels and 144/1728 reached whole-view current. Focus final: 24.0 / 72.5 ms, 72/72 pause/end anchors observed. Colors pipeline compilation was 0 specialized sets / 0 API calls. Its handler p95 exceeds 4 ms; the 50 ms first-picture and 150 ms whole-view budget statuses are shown above. 8/24 individual Colors sessions meet the first-pixel p95 budget and 0/24 meet the whole-view budget. Its 80.7 ms maximum GPU submission meets the 100 ms submission budget, and 0 long tasks / 0 compiles meet those limits. Paired Colors rows below pool the continuous and paused sequence within each repetition.

| Colors fixture / terrain view | Map | First changed p95 A / B, ms | Whole view p95 A / B, s | Sequence end to final p95 A / B, s |
| --- | --- | ---: | ---: | ---: |
| green-modern-2 / 1208×841 | map4 | 111.8 / 118.4 | 3.69 / 3.68 | 1.46 / 1.46 |
| green-modern-2 / 1208×841 | map16 | 119.3 / 121.4 | 3.77 / 3.72 | 1.48 / 1.50 |
| green-modern-2 / 1728×1024 | map4 | 74.0 / 73.9 | 6.72 / 6.71 | 4.44 / 4.46 |
| green-modern-2 / 1728×1024 | map16 | 76.1 / 77.7 | 7.09 / 7.09 | 4.82 / 4.82 |
| red-3 / 1208×841 | map4 | 78.4 / 75.5 | 2.18 / 2.16 | 0.90 / 0.87 |
| red-3 / 1208×841 | map16 | 79.9 / 77.8 | 2.23 / 2.17 | 0.95 / 0.97 |
| red-3 / 1728×1024 | map4 | 38.3 / 43.8 | 5.31 / 5.33 | 3.05 / 3.08 |
| red-3 / 1728×1024 | map16 | 45.7 / 45.4 | 5.63 / 5.56 | 3.38 / 3.32 |
| green-7 / 1208×841 | map4 | 71.9 / 74.3 | 2.17 / 2.14 | 0.88 / 0.87 |
| green-7 / 1208×841 | map16 | 76.9 / 77.4 | 2.19 / 2.18 | 0.90 / 0.88 |
| green-7 / 1728×1024 | map4 | 45.5 / 44.7 | 3.48 / 3.49 | 1.21 / 1.22 |
| green-7 / 1728×1024 | map16 | 46.2 / 44.2 | 3.50 / 3.50 | 1.25 / 1.27 |

The supplement ran 2026-11-12T16:56:01.986Z to 2026-11-12T17:20:18.310Z, using the same scene/view/map settings and the forward/reverse map-alternating order. One fresh-server warm-up was discarded; each session had a unique CDP port. Accepted quiet-start GPU readings were 0.0–19.0%, CPU load average 1.8–4.6, and the 10-second process watcher found 0 overlapping external repro/measure jobs. GPU clock uncertainty was at most ±2.10 ms. The quick tier passed again (203 unit tests, 0/34 scenes changed); all supplemental pages had 0 exceptions/GPU validation errors. Supplemental load/cold-gate diagnostics are not pooled into the original tables.

**Validation [measured].** `node --check repro/perf.mjs`, `git diff --check`, and `repro/check.sh quick --worlds none` passed; 203 unit tests passed and 0/34 scenes changed. Report endpoint checks covered empty phases, blocked Colors and older Rain feeds. The matrix has no page exceptions/GPU validation errors. Raw traces and temporary outputs were read for this report and deleted as requested. Nothing was landed on main.

Run on an isolated server and outside output root, then print any selected set of result files:

```sh
node repro/perf.mjs map16 --scene repro/scenes/green-modern-2.json \
  --server http://127.0.0.1:8897 --port 10500 --out /private/tmp/lp0 --warmup
node repro/perf.mjs map16 --scene repro/scenes/green-modern-2.json \
  --server http://127.0.0.1:8897 --port 10501 --out /private/tmp/lp0 --no-export --colors scripted
node repro/perf.mjs --report /private/tmp/lp0/*-perf.json
```
