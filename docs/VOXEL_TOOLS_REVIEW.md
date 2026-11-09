# Voxel tool coverage follow-up

Baseline: main `b46a626c`. Branch: `voxel-tools`, November 8, 2026.
Artifacts: `/private/tmp/terraform-voxel-tools` (including retail art,
which stays outside the repository).

## Changes

The Surface relief slider and Relief stronger/weaker paint now scale the
voxel displacement and local wear, as well as the older surface bake.
Previously, those controls could remove baked detail while leaving all of
the new rock geometry intact. Rock exposure paint now reaches the voxel
cliff material instead of being overwritten by its coverage calculation.
Dry cut banks below the surrounding plain now receive rock structure.
The cut gate reads authored heights, so baked ground grain does not itself
qualify as a cut. Wear remains bounded by the allocated surface apron.

No tools, controls, save formats, dependencies, or render paths were added.
The editable source and gameplay height lattice remain the existing ones.

## Measured tool behavior

On a 256 × 256 authored plateau fixture, with old baked relief disabled:

| Operation | Pixels changed |
| --- | ---: |
| Surface relief 0 → 100 | 21,255 |
| Relief stronger paint | 23,306 |
| Rock exposure less paint | 15,004 |
| Rock exposure less → more | 15,870 |
| Rock depth 0 → 2 on a dry cut bank | 11,079 |

Surface relief 0 and full-strength Relief weaker produce the same Clay
pixels as Rock depth 0. The near-zero limit remains continuous. A feathered,
rough-edged relief stroke renders identically in 256-pixel and 128-pixel
tiles. Surface paint changes zero sampled gameplay heights. The existing
256 MiB versus 96 MiB partition test also remains byte-identical.

An isolated 512 × 512 flat Green patch has **0 changed pixels** against the
baseline. With the default authored ground undulations, 1,514 of 262,144
pixels change (0.58%, mean channel difference 0.076/255), because low banks
can now acquire rock detail. The procedural base color/texture is unchanged.

## Measured Green retail comparison

Lower family-normalized gap is closer. These statistics are not a perceptual
quality score. Shape measures the gameplay lattice, not voxel cliff detail.
No reference scene or Green preset was changed in this round.

| Window | Shape before → after | Look before → after |
| --- | --- | --- |
| Green 1 | .24 → .24 | .11 → .12 |
| Green 2 | .16 → .16 | .27 → .18 |
| Green 3 | .10 → .10 | .10 → .09 |
| Green 4 | .59 → .59 | .29 → .29 |
| Green 5 | .18 → .18 | .60 → .60 |
| Green 6 | .23 → .23 | .10 → .10 |
| Green 7 | .19 → .19 | .11 → .11 |
| Mean | .24 → .24 | .23 → .21 |

By eye, Green 2's relief paint has a much stronger effect on its cliff and
grassy slope. Long horizontal courses still need work; illuminated rock
edges remain too bright. Green 4's tall walls and Green 5's narrow exposed
rim have substantial pre-existing shape/coverage differences from retail.
Green 1, 3, 6, and 7 keep their overall landform and ground character.

A separate preset experiment increased block spacing and bed thickness and
reduced grit, mass, and depth. By eye, some horizontal courses became clearer,
but the mean look gap worsened from .21 to .24, with regressions in Green
2–5. That experiment was not kept. Its query and comparison sheets remain
in `retail-trial` under the artifact directory.

## Editor and export validation

- All 19 tools pass add/undo checks across nine worlds; the 8 × 8 Green
  page-boundary check also passes.
- All 23 paint channels change the picture in an active context. On the
  cliff fixture, changed pixels range from 1.66% (More cracks, already
  heavily painted) to 91.21% (Moss); Fewer cracks changes 54.63% there.
  Ground smoother has no effect when ground relief is already zero, and
  changes 18.97% on a plain with Ground lumps set to 1.
- The affected World controls and Surface relief slider have no unexplained
  zero effects or controls that move while disabled.
- Green section editing passes all 15 forms at two sizes, point editing,
  undo, shore controls, autosave, and reload. Workspace editing and recipe
  round trips pass. Ground-cover edits, reload, and world-file round trips
  pass. These checks report no browser errors.
- Passability analyzes 68,112 cells with 0 mismatches against the full-grid
  result; feature blocking and undo both rebuild access correctly.
- Repeated WebAssembly exports match the native exporter byte for byte:
  Green 4 × 4 (3,668 distinct tiles), Lava 8 × 8 (14,715), and Red 16 × 16
  (60,072). Both the `.ufo` and indexed PNG match in each case.

The final quick tier passes: unit tests, world-name gate, all 34 scenes,
regional replay, and voxel regressions. All 34 gameplay-height files are
byte-identical to the baseline. Shape and Green geology checks pass. The
hover renderer regenerated 14 tools and 147 control frames from authored
fixtures; 11 image files changed.

Modern Green remains at a mean 8.12/15 statistics in the real range over
17 windows, before and after. Gate passes remain: closed basins 17, fabric
15, hilltop roundness 8, Hack's exponent 5, hollow share 17, valley share 17.
Maximum slope p90 remains .742; the same 23 gate failures remain. None of
these source-height statistics moved because the height lattice did not.

## Measured interaction cost

Chrome/Metal, Green 2 on a 4 × 4 map at 1x. Runs alternate baseline A,
updated A, baseline B, updated B with no other checks from this task running.
These are two runs per build on this machine, not a cross-hardware promise.

| Metric | Baseline A / B | Updated A / B |
| --- | --- | --- |
| Drag picture updates per second | 59.73 / 59.94 | 59.85 / 59.76 |
| Drag frame interval p95, ms | 16.8 / 16.8 | 16.7 / 16.7 |
| Pointer picture latency median, ms | 68.2 / 68.6 | 66.3 / 68.2 |
| Pointer picture latency p95, ms | 74.0 / 74.6 | 74.0 / 74.5 |
| Load to final visible art, ms | 2385 / 1633 | 1638 / 1663 |
| Release to final visible art, ms | 1440 / 1491 | 1401 / 1414 |
| Full map export, ms | 3741 / 3744 | 3737 / 3818 |

Every run measures all 70 pointer moves and finishes without console or
export errors. Dragging remains near 60 updates/second; export cost is
similar. The first baseline load is slower than the other three, so these
numbers do not establish a load-time improvement.

## Remaining scope

Longer horizontal cliff courses, the grass/rock boundary, and the large
reference-shape differences need another Green art pass. Other biome
profiles still need their own tuning. The integration remains a transient
voxel surface over procedural authoring, with local voxel wear; persistent
voxel sculpting and full-volume hydraulic transport are not implemented.
