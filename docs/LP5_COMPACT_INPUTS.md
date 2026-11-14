# LP5 compact regional inputs, November 14

The complete sampled color view now fits within the existing optional cache
quota: **35 native tiles plus the coarse record**, instead of 18 native tiles
plus the coarse record. In the focused page pair, release → final falls
from **759–829 ms to 87–123 ms**. This follows main a14c48c3, stays on
`live-preview/lp6`, and needs visual review before landing because filter
precision moves some pixels. [Compact evidence](LP5_COMPACT_INPUTS_METRICS.json)
keeps both builds' endpoints, memory, pipeline calls and correctness results.

## Allocation and sampling

Every level now allocates the actual regional height/weather/mask lattice,
and the actual baked-field rectangle plus one filtering guard texel. The
estimate and pure chunk-size trial use those same dimensions. Power-of-two
padding and the preview/final allocation distinction are removed. The
canonical shape ring, field spacing, apron and stored texture formats stay
unchanged. C inputs transfer into immutable F records as before; overlapping
neighbor inputs are not yet shared.

Simply removing padding was fast but failed exact tile equivalence: one
pixel in Green 2 and 18 in Modern Green differed between 128- and 256-pixel
tiles. The small odd mixed-recipe crop had passed, so it was insufficient.
That version was rejected without increasing tolerance.

The common regional sampler now takes texel coordinates and computes
bilinear weights explicitly, after splitting global coordinates before
subtracting a regional origin. Baked fields use the same rule. A gather
fetches the four adjacent cells at their center, away from a cell-selection
boundary; the shader applies the original global fraction itself. The
[WGSL gather ordering](https://www.w3.org/TR/WGSL/#texturegather) determines
which two values form each row. Component gathers let unused channels be
removed by the compiler; this is an explanation by inspection, not a count
of native GPU instructions. A four-integer-load version was also exact but
had 115–149 ms release-final times in its focused pair; the gather version
measures 87–123 ms. Only the gather implementation is kept.

One shared sampler serves shape-dependent C inputs and E/F readers across
worlds. No world branch, old renderer flag, new control or CPU terrain copy
is added. The field/mask/height formats retain their original precision.

## Sampled art movement and strict checks

Explicit f32 filtering changes interpolation precision from the native
sampler. A tiny driver probe measured 257 distinct native filter outputs
for 4097 input fractions on these three formats; that observation is not a
portable hardware contract or a device-specific shader setting.

**Measured against main**, 131×129 crops move:

| Scene | View pixels changed | Export-art pixels changed | Maximum RGB-channel change |
| --- | ---: | ---: | ---: |
| Modern Green 2 | 137 / 16,899 | 207 / 16,899 | 88 / 255 |
| Green 2 | 106 / 16,899 | 71 / 16,899 | 68 / 255 |
| Red 3 | 21 / 16,899 | 15 / 16,899 | 24 / 255 |
| Green 7 | 0 / 16,899 | 0 / 16,899 | 0 |

The large Modern Green window moves **8,416 / 1,769,472 pixels (0.476%)**,
maximum channel change 220. These are numeric/palette-threshold movements,
not a new terrain formula. **By eye**, the four small 1× before/after crops
retain their terrain forms, materials and texture character. The owner has
not reviewed them; no broad all-world art claim is made.

- Both full 1024×1024 map16 windows, Green 2 and Modern Green 2, have
  **zero** 128-versus-256 differences and zero GPU errors. The first includes
  the original (893,750) sampling regression. `repro/texel-sampling.mjs`
  preserves this exact, on-demand check outside the quick runner.
- The odd 131×129 mixed world/slot-2 fixture matches between 64- and
  256-pixel tiles. Its original low-sun 128-MiB startup trial still passes.
- All eight interleaved retained tiles on the four feature-enabled scenes
  equal full rebakes exactly; earlier-stage edits reject reuse and pinned
  retirement safely frees resources.
- The large page equals a fresh recipe replay at **zero differing pixels**.
- The previously refused large Sun=25° view now starts at **512 MiB**,
  retains no color records, peaks at **476.8 MiB** of GPU ledger, and equals
  fresh replay exactly. The fixed startup trial was not raised.
- All **186 fast unit tests** and the world-name gate pass (1.46 / 0.14 s),
  as do syntax/diff checks. Export archives and broad scene/control sweeps
  remain on demand; the scoped export-art crops above were compared.

## Focused Chrome pair

Chrome 157, Modern Green 2, map16, terrain **1728×1024 at (0,300)**,
2048 MiB requested/effective. Own servers, unique CDP ports; one discarded
warmup per fresh server, alternating builds, process checks and three
consecutive driver GPU samples ≤20% before timing. One pair of this final
implementation versus main; 36 real mouse values per drag. Times are ms,
p50 / p95. Release is the last anchor, not the held-pause maximum.

| Workload / endpoint | Main | Compact inputs |
| --- | ---: | ---: |
| Ambient continuous: first changed pixels | 3.7 / 9.0 | 4.0 / 6.2 |
| Ambient continuous: whole current, any level | 3.7 / 9.0 | 4.0 / 6.2 |
| Ambient continuous: release → final | 828.8 | 123.4 |
| Ambient pause: first changed pixels | 3.6 / 10.5 | 4.1 / 15.5 |
| Ambient pause: whole current, any level | 3.6 / 10.5 | 4.1 / 15.5 |
| Ambient pause: release → final | 759.4 | 87.7 |
| Ambient pause: held pause → final | 841.0 | 57.3 |
| Crease shade cold gate: first changed pixels | 3.2 / 7.2 | 3.8 / 6.0 |
| Crease shade cold gate: whole current, any level | 3.2 / 7.2 | 3.8 / 6.0 |
| Crease shade cold gate: release → final | 811.3 | 86.8 |

**Measured:** release-final falls 85.1%, 88.5% and 89.3%. All inputs and
pause/release anchors complete without censoring. First-tile, changed-pixel,
pointer-tile and whole-current metrics remain distinct in the evidence;
pointer-tile samples are empty for these sliders.

The cache uses **758.6 MiB**, below the unchanged 819.2-MiB quota, versus
main's 813.2 MiB. Each pair of retained feature-enabled native test tiles
falls from 54.09 → 28.76 MiB (Modern Green), 33.86 → 17.35 (Green 2),
54.15 → 27.67 (Red 3), and 33.86 → 17.35 (Green 7). Continuous peak GPU
ledger falls 1397.2 → 1316.6 MiB. These are application-accounted bytes,
not physical VRAM. Load final is 2689.5 → 2639.2 ms (−1.9%).

Continuous maximum queue wait/submission falls 55.9/52.4 → 20.9/10.5 ms.
rAF p95 stays 16.7–16.8 ms, with no long task over 50 ms. Handler p95 stays
0.4 ms and bitmap-copy p95 stays 0.1 ms. No pipeline API calls or new
specialized sets occur during the input phases. Wholly offscreen GPU time
is zero in those phases; mixed/apron work is kept separately in the JSON.

Startup readiness is **4861 ms** for the new gather shaders versus 571 ms
for the already-warm main shaders in this pair. These driver cache states
are not a controlled cold comparison, but the observed first-use wait is
real and no cold-start improvement is claimed. The load-final number above
begins after boot and does not hide that distinction.

## Remaining input scheduling

A separate analysis of actual painted coverage requires every affected
visible pixel to be native level, current by LP0's revision predicate.
Despite the fast release, continuous-input final-quality p95 is still
**1623.5 ms** (main 2278.4 ms), and no continuous input finishes at native
quality before release. New inputs repeatedly repaint the coarse block and
restart native work at the focus. The final-quality 150-ms target is still
unmet; a six-ms coarse answer is not that endpoint.

The next unit should let a fully cached F edit update native tiles directly
and service the oldest displayed revision first. Partial caches still need
the coarse answer. Fresh previews are required before any future push of
this source; main remains the already-deployed a14c48c3.
