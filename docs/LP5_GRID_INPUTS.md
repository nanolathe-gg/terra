# LP5 exact weather/material packing, November 14

A half-tile horizontal pan exposed 40 native tiles instead of 35, leaving
three records uncached and pushing native color input p95 above a second.
Packing only the weather/material channels F actually reads now retains
all 40 native records plus the coarse block, **816.6 MiB** inside the same
**819.2-MiB** quota. In two alternating pairs, native-quality p95 falls
from **912–1729 ms to 118–130 ms**. Same-build replay and sampled art
against the parent remain byte-identical. This is on the review branch;
main remains a14c48c3. [Evidence](LP5_GRID_INPUTS_METRICS.json).

## Channels and ownership

F needs ten unsigned channels: weather flow/deposit, Time wear/wetness,
all four material channels, and the two fall-direction components used by
wet swaths. It retains three RGBA8 UNORM layers instead of four: the first
holds weather RG + wear/wetness, the second material RGBA, and the third
fall XY. No quantization or filtering precision changes.

The color shader's weather/Time helpers return only the retained components;
its TimeMaps type omits unused fields. A new dependency cannot silently
sample zero: it fails compilation or the CPU source guard. Geometry and
Time stages keep their original inputs. Packing is always part of the one
render path, including ordinary final draws and export art.

The existing in-place mask pass also packs the weather/material grid.
It uses bounded staging bands, copies their prefixes back, and runs only
after D is released. Staging now costs 24 bytes per texel instead of 12,
still capped by 64 MiB, 35% of the budget, and the storage binding limit.
Retaining a record copies just three packed grid layers; the mutable raw
four-layer grid is released. The ledger counts the staging, temporary
copies and final cache resources. No cache quota or startup budget rises.

## Page measurements

Apple M3 Pro, map16 Modern Green 2, 1728 × 1024 terrain at **(128, 300)**,
2048 MiB; 36 real mouse values per workload. Runs alternate packed,
41640e10, 41640e10, packed. Process snapshots precede timing; each browser
waits for three GPU-driver samples ≤20%. The owned servers' initial
warm-up loads were discarded earlier. No concurrent owned GPU job ran.

| Workload | Native-quality input p95, pair 1, base → packed | Pair 2 | Release final, pair 1 | Pair 2 |
| --- | --- | --- | --- | --- |
| Continuous ambient | 1713.9 → 118.0 ms | 1711.9 → 123.6 ms | 180.1 → 51.8 ms | 178.6 → 53.5 ms |
| Paused ambient | 966.2 → 130.4 ms | 912.1 → 120.8 ms | 175.9 → 60.6 ms | 161.4 → 57.9 ms |
| Cold Crease shade | 1729.3 → 123.8 ms | 1639.6 → 126.3 ms | 212.3 → 52.0 ms | 173.9 → 62.3 ms |

Packed first-changed-pixel p95 is **17–24 ms**. The native median is about
77–79 ms. The base's coarse first response remains quick; the improvement
is full native coverage. Load final is effectively flat: 2932.5 → 2882.5 ms
and 2844.0 → 2861.1 ms (−1.7% / +0.6%). Boot is about 0.6 s in the first
pair; this is warm-driver evidence, not a controlled cold-compilation claim.

The packed cache has 40 native records plus one coarse record, versus
37 plus one. Its bytes rise from 809.4 to 816.6 MiB because it holds more
useful records. Peak terrain memory is 1393 MiB versus 1381–1407 MiB during
the base slider phases. Candidate submissions stay below 18 ms; no slider
long tasks or pipeline compilations occur. Mixed edge-tile GPU work is
retained in the evidence and is not claimed as wholly on screen.

## Quick correctness and the probe correction

The on-demand channel probe had not been updated when the earlier compact
input work changed sampleMasks from normalized UVs to texel coordinates.
Rerunning it exposed that stale assumption. It now converts test points to
texel coordinates and samples the original texture with the same regional
interpolation contract. Equality is still bitwise, with zero tolerance.
This checks packing rather than comparing two different filter contracts.

The probe expands from 240 to **504 channel comparisons**, covering signed
−128/−127, unsigned 0/255 and interior values, clamped edges and filtering
across both band boundaries. Its forced budget is unchanged; it now fits
three smaller bands instead of two. All comparisons pass. The independent
1024² Green 2/Modern Green tile-size check still requires zero differences,
including the original Green 2 pixel fault.

Four feature-enabled authored scenes retain exact interleaved and batched
color/full equality, and their native hashes equal the parent. The odd
131 × 129 mixed-recipe fixture matches 64/256 tiles and preserves its
original 128-MiB low-sun startup. Nine small view/export/large-view outputs
match the parent exactly. Both Chrome pairs finish with zero differing
pixels in 1,769,472-pixel warm/cold replay; hash
b0b6423019cfb56d1661312fceeaee661c0a506158b532863a8c0e9480f4e894.
Seven directly affected CPU cases pass in 48 ms.

The first trial was stopped after the stale probe failed; it is excluded
from the reported pairs. No thresholds were loosened. No broad archive,
all-world or control sweep ran. Other scenes, budgets and Colors remain
separate measurements. Earlier interpolation drift still needs owner
visual review; this packing unit adds none in the checked outputs.
