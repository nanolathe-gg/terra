# LP6 closed gates and ray march, November 13

Two more units are on `live-preview/lp6`, following the
[final-memory change](LP6_FINAL_MEMORY.md). They are committed for review,
not landed. No editor controls, export formats or benchmark defaults change.
[Compact measurements](LP6_VOXEL_METRICS.json) retain all input endpoints,
frame intervals, queue/submission waits, memory, pipeline calls and GPU costs.

## Closed-gate allocation

Commit **07b61c69** omits bricks only where soil, wear and every addressable
rock slope gate are closed. It checks every voxel XY sample in the column
for painted, rim and shore rock. A small feature between a column's center
and corners must survive; a center-only check from the prototype was unsafe.
An empty column retains its top bound for rain and rendering.

**Measured:** Green 2's sampled 512×256 window uses **28,623 → 25,185 bricks
(12.0% fewer)**; peak tile working memory is **59.4 → 58.1 MiB**. Two art
pixels move, with maximum channel difference 16. Modern Green 2, Red 3 and
Green 7 windows move zero pixels. Sampled gameplay heights are unchanged.
A four-pixel-wide painted spot on flat ground keeps four bricks and its exact
image; the unpainted plain goes from 1,120 bricks to zero. The same eight
painted pixels change in both builds.

**Measured in Chrome:** Green 2's far whole-view final improves **4983.3 →
4875.7 ms (2.2%, one pair)** and peak stroke/release GPU memory falls
**473.6 → 459.1 MiB**. Modern Green 2's first pair reads 4191.3 → 3582.0 ms,
but unrelated shape passes also became faster. The repeat is **3592.9 →
3556.4 ms (1.0%)**. The first apparent 14.5% saving is not repeatable and
is not attributed to this code. The retained case is fewer bricks/memory,
not an established large whole-view speedup.

## Corrected primary ray march

The previous ray could step eight voxels at once and miss thin rock surfaces.
The new march caps sampled steps at one voxel. It pays for that by jumping
through empty space above the maximum stored top of all four interpolation
columns, stopping at the next column boundary. Underwater rays keep their
fixed XY projection. Global sample positions, the fixed ray start, bisection
and hit quantization stay the same. There is one render path.

**Measured correctness:** on a 128×128 Green 2 cliff crop, a slower reference
with one-voxel steps and no empty-space jumps differs from the previous march
at **3,807 art pixels / 4,197 clay pixels**. The selected march differs at
**3 / 4 pixels**, respectively. This is strong local evidence for the jump;
it is not a proof that every sub-voxel surface is found. **By eye:** the
corrected cliff band is more coherent and closely matches the reference.
The Green 2 picture visibly changes and needs the owner's review.

In the four 512×256 diagnostic windows, the selected march changes 459 pixels
on Modern Green 2, 12,788 on Green 2, 378 on Red 3 and 1,801 on Green 7.
These are intentional before/after art changes, not same-build tile errors.
All repeat images are exact; Green 2's 128/256 tile comparison stays at
**zero differing pixels**. All sampled gameplay-height hashes are unchanged.

**Measured in Chrome**, relative to the closed-gate build:

| Fixture | Release → view final, before / after | Focus final, before / after | Fresh final replay |
| --- | ---: | ---: | ---: |
| Modern Green 2 | 3616.7 / 3599.7 ms | 600.8 / 587.2 ms | 0 / 1,769,472 pixels differ |
| Green 2 | 4872.9 / 4851.7 ms | 1726.3 / 1669.8 ms | 0 / 1,769,472 pixels differ |

The march correction costs essentially the same in these pairs (0.4–0.5%
faster, too small to claim a general performance improvement). Native Dawn
window medians are also similar; they are diagnostic, not page timings.
The Green 2 focus deadline remains far above 600 ms. The full view still
contains submissions over 100 ms; this does not close LP4.

Chrome 157.0.8103.78, map16, explicit 512 MiB, translated authored strokes,
1728×1024 terrain at (2048,2300). Each fresh server discards its first load;
all timed runs check `ps` and pass three GPU-utilization samples at or below
20%. Builds alternate sequentially with distinct CDP ports. Each final
endpoint has one sample per run. No broad scene or control sweep was run.
The seven relevant gate/stage unit tests and world-name gate pass. Error
logs are empty. Raw outputs are removed after reading; small review figures
are kept outside Git.

## Still open

Wear where it shows, shell compaction, tile-size measurement with the focus
deadline, and eliminating final readbacks remain LP6 work. The earlier native
count-prediction trial was rejected for negligible view benefit and more
memory. A 512-pixel view grid is not enabled while the existing Green 2 focus
already misses its deadline. Surface-atlas and per-landform Time work remain
conditional on evidence. LP5 has not started. New LP6 source needs a fresh
preview bundle before a future push; main's published LP3 bundle is unchanged.
