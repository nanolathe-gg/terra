# LP5 bounded color submissions, November 14

Four retained native color tiles now share one GPU completion wait and one
presentation canvas. In two alternating Chrome pairs, native-quality p95
is **111–140 ms** across continuous, paused and cold-gate color input;
first-changed-pixel p95 is **25–32 ms** in the second pair. This meets the
150-ms native color row for this sampled fixture. It is not full LP5
acceptance. Main remains a14c48c3; these commits stay on the review branch.
[Compact evidence](LP5_COLOR_BATCHES_METRICS.json) includes every latency
endpoint, CPU/GPU breakdown, memory, exact replay and rejected trials.

## What changed

The GPU still draws each tile with the same shader, immutable geometry,
regional uniforms, packed masks and derivative apron. Each record now owns
its 16-byte frame uniform and geometry bind group. At most four native F
draws are encoded together; each result is copied to its own rectangle of
a presentation strip. The existing output canvas resamples each rectangle
separately, preserving edge filtering. Single/coarse color draws use the
same method with one record. There is still one submitted batch in flight.

The batch shrinks if its presentation strips or target do not fit the
current budget or device dimensions. The memory ledger includes the
larger strips and all frame uniforms. Records remain pinned through the
completion wait, and earlier-stage edits still reject them. Unused
snapshots close on replanning or failure. No shader, controls, stage map,
cache quota or rendering resolution changes in this unit.

The bench now observes either single or batched F calls and attributes
each GPU pass to its tile, preserving wholly-outside/mixed accounting.
Native quality is still measured from actual painted coverage. No latency
threshold or equality assertion was relaxed.

## Focused Chrome measurements

Apple M3 Pro, map16 Modern Green 2, terrain 1728 × 1024 at (0, 300),
2048 MiB; 36 real mouse values per workload. Runs alternate candidate,
5a492216, 5a492216, candidate. The wrapper checks processes before each
run; each browser waits for three GPU-driver samples at or below 20%.
One load warm-up per owned server was discarded before this series.

| Workload | Native-quality input p95, pair 1, base → batch | Pair 2, base → batch | Release final, pair 1 | Pair 2 |
| --- | --- | --- | --- | --- |
| Continuous ambient | 141.9 → 129.0 ms | 195.5 → 111.1 ms | 60.4 → 58.0 ms | 55.0 → 59.2 ms |
| Paused ambient | 133.2 → 135.9 ms | 139.3 → 140.1 ms | 54.8 → 48.5 ms | 58.5 → 55.5 ms |
| Cold Crease shade | 130.9 → 119.8 ms | 208.2 → 121.7 ms | 64.6 → 56.8 ms | 62.1 → 56.8 ms |

The baseline's spread is substantial. The useful result is bounded tails
in both sampled candidate runs; the paused row and release costs are
mostly flat. Native median is about 76–79 ms, versus 81–86 ms. First
change waits for a small batch and is slower than single-tile replay but
stays under 50 ms p95. No drag long tasks or pipeline compilations occur.
The largest candidate color submission is 15.3 ms, below 100 ms.

Peak terrain memory is about 1318 MiB, roughly 1.7 MiB above the matching
base. Retained frame uniforms add only 576 bytes for 36 records. More
useful F tiles finish during each drag, so total color GPU time increases;
this is a latency improvement, not a claim of less energy or GPU work.
There is no wholly-off-screen F pass in these slider phases. Mixed edge
tiles still shade off-screen pixels; the report retains their measured
and area-weighted figures rather than treating them as zero.

## Quick correctness

- Four feature-enabled authored scenes: eight interleaved single cached
  results plus sixteen batched rectangles, including odd 131 × 129 tiles,
  equal the full bake exactly. Earlier-stage edits and retirement remain
  rejected. Native hashes are unchanged from the parent.
- Both Chrome pairs replay the 1,769,472-pixel final view with zero changed
  pixels; warm/cold hash is 94140e6951e957244a010a63ce736ab6c883362c1eb5d94c816267a82f3fc5b0.
- Live Relief and Rain interruption retire all old records; completed
  output equals cold replay. Lowering to 512 MiB immediately empties the
  optional cache and finishes at 495.6 MiB with no console errors.
- Two small CPU cases protect memory/device batch limits and pinning all
  records while a queued batch is retired. The fast unit suite passes.

A two-in-flight queue trial and two CPU-only uniform-copy trials were
rejected: none reliably bounded the slow input tail. Their focused
latencies are preserved in the evidence. No extra queue or uniform-copy
implementation remains.

Other worlds, viewport alignments, partial caches and scripted Colors have
not been retimed for this unit. The earlier compact-input interpolation
still needs owner visual review. Cold shader startup and Safari memory
probing remain open. No broad export, all-world or control sweep was run.
