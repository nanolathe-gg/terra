# Rock realism pass

Branch `rock-realism`, based on `rock-weathering` at `f6365e5c` (main base
`13d74571`). Preview: `http://127.0.0.1:8908/sculpt`. Landing approved after the combined landing checks on November 9, 2026.
Artifacts and measurement logs: `/private/tmp/terraform-rock-realism`.

## Reference comparison by eye

The supplied Gaea examples have broad intact masses, broken shelves, oblique
fractures, bent beds and smaller embedded fragments. The earlier rocks had
more even horizontal stripes and similarly sized blocks. This pass increases
that hierarchy: sandstone has larger projecting masses and chipped shelves;
shale has less repetitive fine lamination; granite has larger varying masses.
Gneiss bends coherent bands around the mountain, schist has slanted flaky
plates, and conglomerate/breccia expose rounded/angular inclusions. Mineral
contrast varies color and polish together instead of relying only on grain.

These are closer structural matches by eye, not a measured claim that the
renders equal the references' hyperrealism. Fracture-driven detachment, a
mass-conserving sediment history, and different mineral species' optical
properties remain unfinished. Weathering remains the previous local surface
transport model. Gameplay terrain heights remain separate from this art detail.

## Shared controls and presets

Seven new continuous rock controls: Joint tilt, Block size variation, Fold
amplitude, Broken layer edges, Embedded fragment relief, Embedded fragment size,
and Mineral contrast. Existing layer length, bedding direction, roundness and
grit size also shape the new structures. Existing loose-stone round/slab shares
are now artist controls and preset data. This makes nine added/exposed controls.
There is one GPU pipeline, no shader branch on a rock-type name, and no new page,
map format or history stack. Nine geological presets are ordinary numbers and
column beds; all remain editable and preserve the chosen colors.

## Measured validation

The authored 512×512 cliff is rendered at 1x in Art and Clay. Every new type is
also compared across 128/256-pixel chunks and a 96 MiB budget: **0 differing
pixels**. The mountain fixture exercises several face directions and the crown.
The existing Surface relief / paint regressions pass, including **0 gameplay
height changes**. All 34 scene height files are byte-identical to main.

The rock class has 50,233 pixels. The two loose-fragment controls
use the weathered/debris class. The new control sweeps exceed 5%:

| Control | Class pixels changed at 1x |
| --- | ---: |
| Joint tilt | 75.7% |
| Block size variation | 73.4% |
| Fold amplitude | 84.5% |
| Broken layer edges | 73.7% |
| Embedded fragment relief | 75.8% |
| Embedded fragment size | 77.5% |
| Mineral contrast | 59.8% |
| Rounded fragments | 26.8% |
| Flat fragments | 37.7% |

All amplitude/angle zero-end checks pass; at 0 versus 0.0001, the largest mean
RGBA-channel change is 0.0593 of 255. Block variation uses bounded
coordinate displacement, so details do not shrink with distance from the map
origin. See the generated
`final-gallery/impact.json` and `weathering/results.json` for exact values and
zero-end continuity. The Green world sweep checks thirteen new or changed
rows, including dependencies on folding, mineral grain and embedded clasts:
no unexplained zero and no movement while a control is disabled. Shape and
Green geology sweeps pass. Existing geometry/PBR control sweeps also pass with
the new structures enabled.

Browser checks cover the nine preset choices; slider and preset Undo/Redo;
exact save/load and autosave/reload pixels; invalid recipes leaving the map
intact; and dependency explanations. A folded-mountain example is saved and
reloaded through the actual editor for user testing.

The final quick tier passes all checks, including 164 unit/static-site
tests. Of 34 default images, 32 are byte-identical to main: Green-2 changes one pixel and Green-modern-2 three. Against
the previous weathering branch, Green-2 changes one, Green-4 thirteen and
Green-modern-2 two pixels, with the other 31 images exact. These are floating-
point evaluation changes; the default ground material and new amounts remain
unchanged. All 34 gameplay-height files match main exactly.

With folding, inclusions, mineral contrast, runoff and debris active together,
a 4×4 landform map exports twice to identical bytes. Native and WebAssembly
UFO/PNG hashes match: **25 chunks, 3,690 unique tiles, no merging**. No console
errors. The authored hover previews are regenerated from the final renderer.

## Measured interaction and refinement

Two alternating runs per build use the same authored 4×4 fixture and camera,
with folding, inclusions, mineral contrast, runoff and debris requested together.
The previous weathering build ignores the new parameters. Chrome uses Metal;
no other task-owned GPU check runs concurrently.

| Build / run | Drag frame p95 | Release to final visible detail |
| --- | ---: | ---: |
| Previous weathering, 1 | 16.7 ms | 1,455.1 ms |
| This pass, 1 | 16.8 ms | 1,563.1 ms |
| Previous weathering, 2 | 16.7 ms | 1,469.7 ms |
| This pass, 2 | 16.8 ms | 1,574.8 ms |

Interaction stays around 60 frames/s. Mean release refinement rises from
1,462.4 to 1,569.0 ms, **7.3%** with the extra structure active. These are browser
animation-frame timings and asynchronous final-detail latency, not a claim
that the fully refined scene is ray-marched at 60 frames/s. All four runs have
zero console errors. Raw logs and JSON are in `timing-before-1`,
`timing-after-1`, `timing-before-2`, and `timing-after-2` under the artifact root.

## Measured default retail preservation

Green's seven retail windows have the same shape/look gaps before and after
(lower is closer):

| Window | Shape before → after | Look before → after |
| --- | --- | --- |
| Green-1 | 0.24 → 0.24 | 0.12 → 0.12 |
| Green-2 | 0.16 → 0.16 | 0.18 → 0.18 |
| Green-3 | 0.10 → 0.10 | 0.09 → 0.09 |
| Green-4 | 0.59 → 0.59 | 0.29 → 0.29 |
| Green-5 | 0.18 → 0.18 | 0.60 → 0.60 |
| Green-6 | 0.23 → 0.23 | 0.10 → 0.10 |
| Green-7 | 0.19 → 0.19 | 0.11 → 0.11 |
| Mean | 0.24 → 0.24 | 0.21 → 0.21 |

Modern Green's height realism report is identical before and after: **8.12/15**
statistics within the real range on average across 17 windows. Gate pass counts
remain closed basins **17**, fabric **15**, hilltop roundness **8**, Hack exponent
**5**, hollows **17**, valleys **17**. The 23 existing failures remain, and
maximum slope p90 stays **0.742**. Surface detailing does not fix those height-
model limitations. No retail art or reference-derived assets are committed.

## Landing verification

Current main (`13d74571`) was merged into this branch before the landing
checks. `repro/check.sh land --server http://127.0.0.1:8908 --port 9835
--worlds green,green-modern` passed every check: unit, gate, all 34 scenes,
regional replay, voxels, smoke including page8, features, passability, and
shape repetition. Art comparisons retain the pixel counts recorded above.
Logs: `/private/tmp/terraform-rock-realism/land`.
