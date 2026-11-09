# Fracture hierarchy and continuous coastal geology

Branch `fracture-coast`, based on main `7d90fda9`. Preview:
`http://127.0.0.1:8914/sculpt`. Authored fixtures and measurement artifacts:
`/private/tmp/terraform-fracture-coast`.

## Artist workflow

Rock blocks adds Joint opening width, Secondary fracture depth and Fracture
continuity. Width scales the opening independently of the existing Joint
depth setting; weathering still contributes natural widening. Secondary
fracture depth controls the finer network within the broad blocks. Continuity
varies how completely joints connect, with coherent, tapered interruptions.
Joint spacing, proportions, tilt, rounding and release retain their roles.

Fine detail clustering, in Rock weathering & detail, distributes the existing
pitting, scratches and grit into damaged patches, leaving quieter faces
between them. It does not add another noise amplitude. The geological
starting points use ordinary values of these controls. Dependency explanations
cover zero joint depth, zero rock relief, and absent fine detail.

The same volumetric cuts, weathering, normals, shadows, layer colors and
surface crusts now continue below water. Natural steep banks expose rock;
Rock paint carries it onto gentler shelves where the placement model would
otherwise choose sediment. Lit bed, Bed tint strength, Tinted bed brightness,
Bed light carried through the tint and the existing shallow/deep depth controls
set how the rock shows through water. Picking a Shallow water or Deep water
color changes the tint while retaining these controls.

All changes use the shared editor and GPU pipeline. No world-name branches,
new panels, pages, save formats, dependencies, or retail-derived assets are
added. The authored fixture is a generic raised coast, a cut with a longer
submerged foot, and the existing Rock paint brush, not traced reference data.

## Model and limits

The existing fine and broad 3D block fields supply the two fracture scales.
Coherent noise modulates joint continuity and fine-detail coverage. The zero
ends remain continuous; unchanged endpoint amounts skip unnecessary noise
work. Fresh-fracture/crust masks use the updated joint cuts too.

The sea-level cutoff is removed from voxel displacement and wear. Submerged
rock retains its shaded material through the water tint instead of being
replaced by flat-ground material. Water controls no longer change the
underwater viewing ray. Voxel allocation includes the underwater ray's
vertical interval as well as the slanted dry ray, preserving deep rock at
small chunk sizes. Allocation remains bounded by the existing memory budget.

This keeps the editor's fixed-camera water projection and depth-based color
model. It is not a fluid, optical-refraction, chemical-weathering, or fracture
propagation simulation. Large and small cracks are related procedural cell
boundaries with interrupted sections, not a stress-derived branching graph.

By eye, the authored Red comparison is closer to the supplied screenshot:
large irregular cracks and pitted faces remain legible through purple
shallows. The previous renderer loses that detail in the same shelf. This is
an assessment of the visible improvement, not a measured claim of hyperrealism
or an exact reconstruction of the screenshot.

## Measured control impact at 1x

`repro/fracture-coast.mjs` measures the rock class in a 512×512 coastal window.
Each new control exceeds 5% in both Art and Clay:

| Control | Red Art | Green Art | Desert Art |
| --- | ---: | ---: | ---: |
| Joint opening width | 35.78% | 28.86% | 24.38% |
| Secondary fracture depth | 27.62% | 23.74% | 19.62% |
| Fracture continuity | 18.14% | 14.06% | 11.70% |
| Fine detail clustering | 36.60% | 27.56% | 24.36% |

The test also checks small endpoint steps, chosen water colors, natural banks
without Rock paint, deep painted beds, unchanged gameplay heights, and exact
128/256-pixel partitions at a 96 MiB budget. All three worlds pass with
**0 partition pixel differences, 0 gameplay-height changes and 0 console
errors**. Water-color and bed-light controls leave Clay unchanged.

Production GPU field readbacks find **4,112,571 / 4,575,071 / 4,071,675**
changed submerged voxel samples on Red/Green/Desert when Rock relief goes from
0 to its fixture value. These counts include the volume apron and are not
screen pixels. They establish actual underwater geometry, not merely a color
change. The readback compares spatial brick identities because GPU allocation
order is not deterministic; rendered pixels remain deterministic.

## Retail visual review (by eye)

The retail/before/after sheets are in the external `triptych/` folder. All
windows of each affected world were reviewed. Red 1 retains its pool and hill
look; Red 2 gains darker rock along the inner bank; Red 3 gains the clearest
continuity of rough rock into the purple shelf. Green 1/3/7 and modern Green
1/3 gain bed relief near the shoreline. Green 2/6 and modern Green 2 are
visually stable at sheet scale; Green 4/5 are byte-identical. The existing
Green cliff silhouette and coverage differences from retail remain.

Archipelago 1–3 keep their smooth blue shallows and pale beaches. Crystal
1–3 keep their fractured shelves and dark water; the existing block-scale
mismatch remains. Ice 1–3 retain the frost, berg and bank appearance. Lava
1–3 retain the opaque lava and layered bank appearance. Desert 1 has no
obvious change at sheet scale, and Desert 2/3 are byte-identical; their
existing terrace-shape differences remain. Zhon 1–3 retain their current
island and water look, including the existing large differences from the
retail sections. This pass does not claim to solve those older world targets.

## Validation

The targeted nine-world sweep passes: 67 enabled rows, 50 gated rows and 9
stroke rows, with **0 unexplained dead controls, 0 hidden-but-moving controls,
and 0 end-of-world replay differences**. The new four controls have the
separate class-based impact measurements above.

All **34 gameplay-height files match the baseline byte-for-byte**. Modern
Green's before/after realism reports are identical: **8.12/15** statistics in
range on average over 17 windows. Gate passes remain 17 closed-basins,
15 fabric, 8 hilltop-roundness, 5 Hack-exponent, 17 hollow-share and 17
valley-share windows. The existing 23 gate failures remain; maximum slope
p90 is **0.742**, below 1.62. This surface change does not change those heights.

The coastal editor test also exercises a zero-erosion recipe. Its export
readiness now uses whether a weathering pass is actually enabled; previously
the checked Weathering box could leave Export waiting forever with erosion
set to zero. Existing world water colors/settings still belong to the world's
settings; the map's rock recipe and new fracture controls use the existing
save and undo path.

The 167 unit tests pass. Existing GPU regressions pass for 21 rock/PBR
controls, the 6 fresh-fracture/crust controls, layer colors and provenance.
Their partition and height checks remain exact. Shape and geology sweeps
complete without runtime errors. The legacy geology report still flags
Desert `columnContrast` at **3.77/4.28/4.20%** of its class (identical to the
preceding rock-rinds report); it also flags seven older band/terrace rows
under its raised-block classification. Those rows are not the new fracture
controls, and this pass does not claim to resolve those measurement gaps.

The coastal editor test passes all new-control undo checks and exact
save/load/reload captures. It also proves chosen water colors keep the bed
controls live and zero erosion leaves export ready. The authored test recipe
is `ui-final/red-coast-demo.json` in the external artifacts folder. Open the
preview with the query in `repro/fixtures/fracture-coast.json`, then load that
recipe; water settings remain the existing world settings.

The Red 4-unit landforms export, with the coastal rock/water settings, is
byte-identical across two WebAssembly runs and the native exporter:
**4,073 distinct tiles, 25 chunks, 0 merged tiles, 0 console errors**. This
checks the existing landforms export fixture, not an export of the exact
coastline screenshot fixture.

`repro/check.sh land` passes in this branch: **167 unit tests**, unchanged
world-name gate, all 34 scenes, regional replay, voxel checks, all 19 brushes
across nine worlds (including the paged-map smoke test), feature editing,
passability, and exact shape replay. The 27 changed scenes are reviewed above;
the other 7 are byte-identical to main. The final tier's 34 images match the
earlier reviewed images byte-for-byte.

`repro/retail.sh` completed before and after for all nine affected world/
variant groups. Its 31 before/after renders match the reviewed sheets exactly.
The authored hover previews were regenerated: **14 tools and 147 control
frames**. No retail-derived pixels are committed.

## Interaction timing (measured)

Two alternating pairs, main `7d90fda9` on port 8912 and this branch on
8914, through `repro/perf.mjs` at 1x on the authored 4-unit coastal map.
Both use erosion 12 (active weathering) and the same rock/water settings.
The temporary timing fixture removes its duplicate URL query so each value
appears once. All other validation jobs for this branch had finished; another
workspace's control sweep was running on the shared machine.

| Run | Drag p50 | Drag p95 | Full picture after release |
| --- | ---: | ---: | ---: |
| before-1 | 16.7 ms | 16.8 ms | 3.273 s |
| after-1 | 16.7 ms | 16.8 ms | 2.935 s |
| before-2 | 16.7 ms | 16.7 ms | 3.060 s |
| after-2 | 16.7 ms | 16.7 ms | 3.450 s |

The mean release-to-final time is **3.166 s before → 3.193 s after**.
Drag frame timing is unchanged in these samples; full refinement is comparable,
with run-to-run variation larger than the mean difference. All four runs have
**0 console errors**. The editor supplies responsive previews while the final
surface refines; this is not a claim that every full-volume rebake finishes
within one 16.7 ms frame.

The work is committed on `fracture-coast` for review and testing. Remaining
work is artist tuning of biome defaults and the older shape/measurement gaps
noted above. Fractures remain a procedural hierarchy, not a stress simulation.


## Retail scores (measured)

Shape and look are gaps from each retail crop in family-band units; lower is closer. All shape scores are unchanged. The 31-window mean look gap is **0.2586 → 0.2608**. Red 3 gains a statistic in the retail band (20 → 21), but its aggregate look gap increases, chiefly from thin dark lines (about 20 additional detected pixels in a 1024×1024 window). This is a visible-detail tradeoff, not an across-the-board score improvement.

| Window | Shape before → after | Look before → after | In band before → after |
| --- | ---: | ---: | ---: |
| archipelago-1 | 0.228 → 0.228 | 0.239 → 0.253 | 20 → 20 / 24 |
| archipelago-2 | 0.199 → 0.199 | 0.157 → 0.148 | 19 → 19 / 24 |
| archipelago-3 | 0.087 → 0.087 | 0.662 → 0.659 | 17 → 17 / 24 |
| crystal-1 | 0.084 → 0.084 | 0.168 → 0.173 | 25 → 25 / 25 |
| crystal-2 | 0.256 → 0.256 | 0.133 → 0.145 | 25 → 24 / 25 |
| crystal-3 | 0.095 → 0.095 | 0.112 → 0.119 | 23 → 23 / 25 |
| desert-1 | 0.188 → 0.188 | 0.274 → 0.274 | 11 → 11 / 23 |
| desert-2 | 0.459 → 0.459 | 0.483 → 0.483 | 19 → 19 / 23 |
| desert-3 | 0.414 → 0.414 | 0.354 → 0.354 | 13 → 13 / 23 |
| green-1 | 0.245 → 0.245 | 0.115 → 0.101 | 22 → 22 / 25 |
| green-2 | 0.163 → 0.163 | 0.181 → 0.182 | 15 → 15 / 24 |
| green-3 | 0.104 → 0.104 | 0.094 → 0.088 | 24 → 24 / 25 |
| green-4 | 0.592 → 0.592 | 0.289 → 0.289 | 10 → 10 / 24 |
| green-5 | 0.183 → 0.183 | 0.597 → 0.597 | 22 → 22 / 24 |
| green-6 | 0.226 → 0.226 | 0.098 → 0.098 | 20 → 20 / 24 |
| green-7 | 0.194 → 0.194 | 0.109 → 0.133 | 21 → 21 / 25 |
| green-modern-1 | 0.279 → 0.279 | 0.547 → 0.545 | 19 → 19 / 25 |
| green-modern-2 | 0.123 → 0.123 | 0.553 → 0.553 | 15 → 15 / 24 |
| green-modern-3 | 0.176 → 0.176 | 0.482 → 0.494 | 20 → 20 / 25 |
| ice-1 | 0.217 → 0.217 | 0.063 → 0.066 | 20 → 20 / 25 |
| ice-2 | 0.118 → 0.118 | 0.094 → 0.094 | 22 → 22 / 25 |
| ice-3 | 0.120 → 0.120 | 0.115 → 0.114 | 25 → 25 / 25 |
| lava-1 | 0.089 → 0.089 | 0.133 → 0.137 | 23 → 23 / 25 |
| lava-2 | 0.100 → 0.100 | 0.072 → 0.072 | 21 → 21 / 25 |
| lava-3 | 0.182 → 0.182 | 0.168 → 0.167 | 25 → 25 / 25 |
| red-1 | 0.189 → 0.189 | 0.182 → 0.196 | 22 → 22 / 24 |
| red-2 | 0.245 → 0.245 | 0.199 → 0.186 | 18 → 18 / 24 |
| red-3 | 0.142 → 0.142 | 0.352 → 0.410 | 20 → 21 / 24 |
| zhon-1 | 0.095 → 0.095 | 0.465 → 0.446 | 22 → 22 / 25 |
| zhon-2 | 0.172 → 0.172 | 0.272 → 0.265 | 21 → 22 / 25 |
| zhon-3 | 0.137 → 0.137 | 0.257 → 0.243 | 22 → 22 / 25 |
