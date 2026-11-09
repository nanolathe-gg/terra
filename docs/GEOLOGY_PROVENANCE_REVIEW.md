# Shared voxel beds, colors and rockfall sources

Branch `geology-provenance`, based on local main `296f68eb`. The preceding
rock controls, runoff/debris and rock realism work was reviewed, passed the
landing tier, and fast-forwarded to local main at that commit. This iteration
is separate work for review. Preview: `http://127.0.0.1:8910/sculpt`.
Artifacts: `/private/tmp/terraform-geology-provenance`.

## Landing follow-up

This work is included in the combined `rock-rinds` landing. The subsequent
[fresh-fracture/crust review](ROCK_RINDS_REVIEW.md) records the final passing
landing tier and the separate correction to the two curve-test fixtures
reported below. Green and Desert now each pass all 77 curve checks. The
measurements below retain this pass's original baseline and scope.

## Artist workflow

The existing Rock column is now the common source for voxel hardness, layer
colors, and debris provenance. Its five material slots work on Green as well
as Painted Desert; worlds without a palette start from tones of their own
rock color. There is no second layer-color editor or biome-specific rendering
mode. The new Desert defaults are numbers in `materials/desert.json`.

Set bed thickness, hardness, order and slot colors in Rock column. In Strata,
Layer color coverage reaches full exposed-rock coverage at 0.5 and extends
onto the whole outcrop from 0.5 to 1. Color strength and Bed grain retain their
existing roles. These settings, the palette and column edits belong to the
existing map recipe, Undo/Redo, autosave, share payload and export.

Layer thickness, folds, dip and the new Layer waviness deform the coordinates
used for hardness and color together. Variation between repeated beds changes
the individual thicknesses inside each repeat while preserving its total
length. It works with two or more beds, with a dependency explanation for a
single-bed column. The artistic repetition variation does not change gameplay
heights or rerun the height model with different layers.

Block release recesses selected broad blocks along their joint boundaries,
weighted by bed hardness. The GPU debris field reads those same block and bed
identities at higher source positions. Released areas supply more material;
source bed thickness, hardness and joint spacing influence fragment size;
source material colors reach the apron below. Existing debris amount, reach,
depth, size sorting, loose-stone size and painted deposition still apply.

## Visual assessment by eye

The authored Green and Desert examples show coherent colored beds through
folded and fractured faces, larger missing blocks and smaller rubble at their
feet. The same controls and column work on both worlds. Neutral Green and
muted Desert palettes are also rendered in `green-example.png` and
`desert-example.png`; the high-contrast diagnostic palette makes color/shape
alignment easier to inspect. Neither example changes the world's ground.

This is a step toward the supplied references, not a measured claim of
hyperrealism. Deposits are still a bounded local surface model rather than
mass-conserving detachment and ballistic rigid bodies. Transport samples the
authored source surface, not every exposed voxel along a cliff. It carries a
weighted mixture of source colors and sizes, not individual tracked stones.
Fresh fracture color, weathering rinds, joint-guided drainage and oriented
fallen slabs remain useful next steps. Existing cap/foot-band styling is
retained; this pass does not claim to have retired all older Desert tuning.

## Measured controls and correctness

`repro/geology-provenance.mjs` uses an authored 512×512 cliff at 1x. Its rock
class has 74,024 pixels. Each new geometry control exceeds the 5% threshold in
both Art and Clay:

| Control | Art class pixels changed | Clay class pixels changed |
| --- | ---: | ---: |
| Variation between repeated beds | 63.49% | 71.18% |
| Layer waviness | 73.02% | 92.59% |
| Block release | 70.09% | 85.29% |
| Existing Layer thickness | 88.22% | 98.32% |
| Existing Fold amplitude | 87.62% | 98.27% |

Changing the palette moves **94.30%** of the colored class with **0 Clay pixel
changes**. Coverage, Color strength and Bed grain move **99.81%, 99.69%,
58.49%** respectively, also with **0 Clay changes**. From 0 to 0.0001, the
mean maximum RGB-channel changes for repetition, waviness and release are
**0.00339, 0.00533, 0.05964 / 255**. These are continuous low ends, not alternate
rendering modes.

A red upper bed deposits red material on a blue lower bed in **177 measured
GPU cells**. The fixture has **0 differing pixels** across 128/256-pixel chunks
and a 96 MiB budget, and **0 gameplay-height changes**. Weathering regressions
also have 0 chunk/height differences and add no debris to flat source-free
terrain. All nine geological types pass the existing geometry/PBR, paint and
partition checks.

The Green/Desert world sweep covers 17 selected rows per world: 30 active,
4 explained inactive, plus stroke/color probes; **0 unexplained zero responses
and 0 movement while disabled**. Shape and geology sweeps complete without
runtime errors. The geology sweep still flags the older Desert `columnContrast`
control below the 5% block-class criterion; this is recorded separately below,
not counted as a new control pass. A separate main-baseline measurement gives
3.7/4.3/4.2% in the three windows; this branch gives 3.8/4.3/4.2%. Its weakness
predates this work and remains unfinished.

Browser tests confirm preset/slider Undo/Redo, slot-color edits, thickness and
slot assignment undo, exact save/load and autosave pixels, invalid recipes
leaving the map intact, and dependency explanations. The saved editor example
is `verified-ui/layered-rock-demo.json`; a folded mountain example is alongside
it. No separate save format, history stack, page, or runtime CPU simulation
was added.

The broader curve-editor sweep is **not fully passing**: Desert passes every
assertion, while Green fails the 560-pixel braided-channel depth assertion and
its elevation-to-crest assertion. Both reproduce on unchanged main at `296f68eb`
using its own server. Main's sampled braided depth is 4.83 versus a test
threshold of 5 (this branch: 4.22). Main's sampled crest remains 154.93 before
and after the elevation edit (this branch: 154.60). Both runs have no console
errors, and all other curve assertions pass. These existing failures need
separate diagnosis before claiming the full suite is green; their presence is
not hidden by the targeted geology checks. Logs: `curveedit.log` and
`curveedit-before.log`.

The quick tier passes **165 unit/static-site tests**, gate, scene regression,
regional replay and voxels. Export with these features active repeats exactly
and matches native/WebAssembly bytes: **25 chunks, 3,699 unique tiles, no tile
merging, no console errors**. The authored hover previews were regenerated
(14 tools and 147 control frames).

## Measured default preservation and retail comparison

Against main `296f68eb`, **29/34 default images are pixel-identical**, including
all seven Green scenes. Desert-1/2/3 change 495/117/507 pixels with mean maximum
RGB-channel differences **0.02061/0.00502/0.02125 of 255**. Green-modern-2 changes
2 pixels and Green-modern-3 changes 1. All **34 gameplay-height files are
byte-identical**. Default rendering does not enable debris or block release.

Retail shape/look gaps are unchanged at the report's precision (lower is
closer). These measure preservation, not a new default tuning pass:

| Window | Shape before → after | Look before → after |
| --- | --- | --- |
| Green-1 | 0.24 → 0.24 | 0.12 → 0.12 |
| Green-2 | 0.16 → 0.16 | 0.18 → 0.18 |
| Green-3 | 0.10 → 0.10 | 0.09 → 0.09 |
| Green-4 | 0.59 → 0.59 | 0.29 → 0.29 |
| Green-5 | 0.18 → 0.18 | 0.60 → 0.60 |
| Green-6 | 0.23 → 0.23 | 0.10 → 0.10 |
| Green-7 | 0.19 → 0.19 | 0.11 → 0.11 |
| Green mean | 0.24 → 0.24 | 0.21 → 0.21 |
| Desert-1 | 0.19 → 0.19 | 0.27 → 0.27 |
| Desert-2 | 0.46 → 0.46 | 0.48 → 0.48 |
| Desert-3 | 0.41 → 0.41 | 0.35 → 0.35 |
| Desert mean | 0.35 → 0.35 | 0.37 → 0.37 |

Modern Green's unchanged heights retain **8.12/15** statistics in the real
range on average across 17 windows, before and after. Gate pass counts remain
closed basins **17**, fabric **15**, hilltop roundness **8**, Hack exponent **5**,
hollows **17**, valleys **17**. The **23 existing gate failures** remain; maximum
slope p90 is **0.742**. Voxel surface detail does not repair the height model's
existing realism limitations. Retail images and reference-derived files stay
outside the repository.

## Measured performance

Three alternating runs per build use the same authored 4×4 fixture and query,
with folding, layer colors, block release, runoff and debris requested. Main
ignores the new controls; both use the default Green column for this timing
fixture. Chrome uses Metal, and no other task-owned GPU check runs concurrently.

| Build / run | Drag frame p95 | Release to final visible detail |
| --- | ---: | ---: |
| Main, 1 | 16.7 ms | 2,851.3 ms |
| This branch, 1 | 16.7 ms | 1,726.2 ms |
| Main, 2 | 16.8 ms | 1,555.2 ms |
| This branch, 2 | 16.7 ms | 1,800.4 ms |
| Main, 3 | 16.8 ms | 1,496.8 ms |
| This branch, 3 | 16.8 ms | 1,718.2 ms |

Interaction stays near **60 frames/s**. The first main run is a startup
outlier; it is included above, not used to claim a speedup. In the two later
pairs, mean final-detail latency rises from **1,526.0 to 1,759.3 ms (+15.3%)**.
All runs have zero console errors. These measure browser animation-frame
cadence and asynchronous refinement, not full-resolution ray marching at
60 frames/s. Logs: `timings.log` and `timing-{before,after}-{1,2,3}`.

The source cache adds two rgba32float textures to the existing four. The
budget estimator now accounts for **96 bytes per 4-pixel cell** (previously 64),
and a **104-pixel apron** covers the bounded dependencies. Allocation remains
chunk-budgeted, and no field is allocated when runoff and debris are both zero.
