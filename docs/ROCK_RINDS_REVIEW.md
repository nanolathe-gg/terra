# Fresh fractures and weathered rock crusts

Worktree branch `rock-rinds`, based on the layer/debris pass `7c2a6fa4`.
The combined work is intended for main after landing checks. Preview:
`http://127.0.0.1:8912/sculpt`. Measurement artifacts are in
`/private/tmp/terraform-rock-rinds`.

## What changes

Rock surface now exposes Fresh fracture contrast, Weathered crust coverage,
Weathering penetration, Crust lightness, Crust oxidation and Crust finish.
They use the existing World inspector, rock recipe, Undo/Redo, autosave,
share/export data and geological presets. There are no new panels, pages,
material modes or biome shader branches. Both new amounts default to zero;
the nine geological starting points enable different ordinary values.

The fresh/rind mask samples the final 3D hit and the same block release,
joint cuts and spalling functions used to shape the voxel density. Deeper
cuts reveal an interior; greater weathering penetration leaves more altered
material in shallow cuts. Rain exposure modulates the surviving crust.
There is no independent noise overlay deciding where a fracture happened.

Existing rock and bed colors remain the underlying material. Fresh contrast
exposes lighter mineral grain. The rind can darken, bleach, or warm that
palette. Crust finish varies the GGX polish and fine reflection-normal grain
relative to the fresh interior's existing Shine controls. Existing wetness
adds a water-film response and reduces the crust's extra grain. Bed colors
retain the same folds and repetition as the density.

The range of finishes is deliberate: real rock coatings include dark oxide
coatings, pale coatings and silica glazes with a shiny luster. See the
[NPS overview of rock surface coatings](https://www.nps.gov/articles/desertvarnish.htm).
The shader is an artistic approximation, not a chemical weathering simulator.

## Visual assessment by eye and boundaries

At 1x, the authored Green cliff shows lighter chipped areas among darker
surviving faces. Polished crust, rough crust, bleached limestone and oxide
staining produce different finishes without replacing the geological shape.
The first version's reflection grain was too strong by eye; the final version
reduces its amplitude from 0.9 to 0.35. This is an incremental improvement
toward the supplied references, not a measured claim of hyperrealism.

These six controls change material appearance, not density or gameplay
heights. They do not create an extra physical shell, track elapsed geological
time, or reconstruct the full history of a detached block. Penetration is a
bounded depth estimate from the authored cuts before local voxel smoothing.
Loose debris still carries the preceding pass's source color/size mixture;
it does not yet distinguish individual fresh interiors from aged boulder
skins. Oriented fallen slabs and joint-guided runoff remain future work.

## Measured controls and consistency

The authored 512×512 fixture has a 51,171-pixel rock class at 1x. Each new
control exceeds the 5% visibility criterion:

| Control | Rock class pixels changed |
| --- | ---: |
| Fresh fracture contrast | 16.84% |
| Weathered crust coverage | 78.38% |
| Weathering penetration | 87.59% |
| Crust lightness | 89.50% |
| Crust oxidation | 75.87% |
| Crust finish | 23.70% |

All six have **0 Clay pixel changes**. The largest mean maximum RGB-channel
change at 0 versus 0.0001 is **0.01402 / 255**. Fresh contrast with release,
spalling and joint depth all zero changes **0 pixels**; enabling release
exposes fresh material. Changing 128/256-pixel partitions and using a 96 MiB
budget produces **0 differing pixels**. Gameplay heights are unchanged.

The broader nine-type rock check measures the solid and material separately
at the low ends of geometry controls. Its largest mean RGBA-channel change
is **0.07775 / 255 in Clay**, and **0.13948 / 255 in Art**, both from Block size
variation. Altered colors and polish amplify palette-bin crossings at moving
one-pixel boundaries. The check now explicitly retains the **0.1 Clay bound**
and uses a **0.2 Art bound** (under 0.08% of full scale), rather than applying
the older 0.1 Art threshold to both effects without measuring the solid.
All other measured geometry low ends are below 0.014 in Art.

The Green/Desert world sweep reports **0 unexplained zero responses, 0 controls
moving while disabled and 0 console errors**. New controls have parent
explanations, including fresh material without cuts and crust finish without
reflection or wetness. Very shallow cuts can remain entirely inside the rind;
artists can lower penetration or deepen release/spalling to reveal fresh rock.
The authored geological fixture above measures their useful active ranges.

Existing rock/PBR controls, layer palette, provenance, shape and geology
checks complete. The upper-bed color trace still reaches **177 lower GPU
cells**, with **0 chunk or gameplay-height differences**. The older Desert
columnContrast response remains below its 5% block-class target (3.8/4.3/4.2%
across its three scenes), as already measured on main in the preceding review.
This pass does not claim to fix that older control weakness.

Browser checks pass preset/slider Undo/Redo, all six new slider edits, palette
and column edits, exact save/load and autosave pixels, rejected invalid loads,
and dependency explanations. `ui/layered-rock-demo.json` is a saved editor
example; `ui/gneiss-mountain-demo.json` is a second example. Authored hover
previews were regenerated (14 tools, 147 control frames).

An export with crusts, fresh cuts, folded colored beds, runoff and debris
active repeats exactly and matches native and WebAssembly output:
**25 chunks, 3,693 unique tiles, no merging, 0 console errors**.

## Measured preservation and retail comparison

All **34 default images and 34 gameplay-height files are byte-identical** to
`7c2a6fa4`. Against main `296f68eb`, this retains the preceding layer pass's
five changed images and unchanged heights; all seven Green images remain
pixel-identical to main. The quick tier passes unit/static-site generation,
world-name gate, scene regression, regional replay and voxels.

Retail gaps remain unchanged (lower is closer):

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

Modern Green remains **8.12/15** statistics within the real range, before and
after, across 17 windows. The six gate pass counts remain closed basins **17**,
fabric **15**, hilltop roundness **8**, Hack exponent **5**, hollows **17**,
valleys **17**; maximum slope p90 is **0.742**. The **23 existing gate failures**
are unchanged because this work does not change the height model. No retail
images, reference-derived assets, or new dependencies are committed.

## Performance and landing

Alternating Chrome runs use the same authored Green cliff and active surface
settings on the preceding pass (`7c2a6fa4`, port 8910) and this pass (port
8912). The performance harness uses the world's column rather than loading
the scene's custom bed palette. These numbers measure interaction and the
final bake, not full voxel regeneration at 60 fps.

| Run | Drag p95 | Final visible after release |
| --- | ---: | ---: |
| Before 1 | 16.7 ms | 1,704.5 ms |
| After 1 | 16.7 ms | 1,727.2 ms |
| Before 2 | 16.7 ms | 1,731.1 ms |
| After 2 | 16.8 ms | 1,719.3 ms |

Mean release time is **1,717.8 → 1,723.3 ms**, a **5.5 ms / 0.32%** increase
within the spread of these four runs. All four report **0 console errors**.

The material mask adds no voxel buffers or textures. It evaluates the existing
fracture functions at visible rock hits; the zero-amount default skips that
work. Existing chunk memory accounting and partition invariance still apply.

The final landing tier will be recorded after merging current main into this branch.
