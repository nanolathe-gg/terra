# Voxel editor integration review

Baseline: main `845acac8`. Implementation: `voxel-editor`, November 8, 2026.
See [the architecture and limits](VOXEL_SURFACE.md).

## Scope

One `/sculpt` editor and one render path for every world. Existing strokes,
curves, paint, Rock column, history, save files, feature composition, and
export feed the new transient voxel surface. Green is the tuned profile;
other worlds retain their data and need later visual tuning. No dependencies,
retail pixels, alternate editor, or alternate save format were added.

The editable source and global drainage/erosion remain the existing GPU
height lattice. Actual 3D density supplies rock shape and four local wear
passes, then surface intersection, normals, local shadow, cavity and rain
exposure. This does not implement persistent voxel editing or full-volume
hydraulic transport. TA gameplay heights remain the authored heights.

## Measured correctness

- Repeated voxel renders: 0 changed pixels.
- 256 MiB versus 96 MiB terrain budgets: 0 changed pixels; the latter
  splits the test rectangle into six pieces and retains 85,850,768 tracked
  bytes. Driver overhead is outside this accounting.
- Rock depth changes 68,428 of 131,072 Clay pixels while changing 0
  gameplay height samples. Depth 0.0001 versus 0 has mean channel error
  0.00118/255: zero is the continuous limit of the same model.
- Painted rock on an otherwise flat plain changes 43,641 of 65,536 Clay
  pixels, proving that paint can shape the solid rather than only color it.
- Regional replay remains exact across all 34 scene fixtures. All 34
  height fixture files are byte-identical to main. All 34 art
  fixtures change because the shared renderer changes.

## Measured Green reference match

Lower gap is closer. These are family-normalized aggregate metrics, not a
perceptual quality score. Shape uses the unchanged gameplay height lattice;
it does not measure the added voxel cliff detail. Source art and sheets
stay outside the repository under `/private/tmp/terraform-voxel-editor`.

| Window | Shape before → after | Look before → after | Metrics in band before → after |
| --- | --- | --- | --- |
| Green 1 | .24 → .24 | .07 → .11 | 22/25 → 23/25 |
| Green 2 | .16 → .16 | .26 → .27 | 17/24 → 17/24 |
| Green 3 | .10 → .10 | .12 → .10 | 24/25 → 24/25 |
| Green 4 | .59 → .59 | .25 → .29 | 13/24 → 10/24 |
| Green 5 | .18 → .18 | .63 → .60 | 22/24 → 22/24 |
| Green 6 | .23 → .23 | .12 → .10 | 20/24 → 20/24 |
| Green 7 | .19 → .19 | .11 → .11 | 21/25 → 20/25 |
| Mean | .24 → .24 | .22 → .23 | — |

By eye: Green 1 and 3 retain rounded, grassy landforms with craggy exposed
edges; the lit edges are brighter than retail. Green 2 has actual rough
cliff facets but still lacks retail's longer, dark horizontal courses.
Green 4's near-vertical walls carry real displaced detail and shadows;
its broader shape mismatch already exists in the baseline. Green 5 still
has too little exposed rock. Green 6 has a more visibly broken rim, with
lit faces brighter than retail. Green 7 retains the ground and water look.
This is an integration milestone, not a claim that every reference match
improved. The original fixtures were not changed to improve these scores.

## Measured control impact

The full Green sweep covered 150 enabled World rows, 50 gated rows, 85
stroke rows and one slider: zero ineffective enabled controls, hidden moving controls,
or unexplained rows. Shape and Green geology sweeps passed. Class impact
was also measured with `measure/impact.py` on 16-pixel blocks at 1x.

Examples (Green 1 / 2 / 3, percent of rock-face blocks changed):

| Control | Impact |
| --- | --- |
| Gloss | 40.5 / 98.1 / 21.4 |
| Reflection sharpness | 9.5 / 91.4 / 2.9 |
| Micro roughness | 8.7 / 92.5 / 3.6 |
| Reflection grain width | 2.9 / 31.6 / 1.1 |
| Shadow depth | 19.8 / 42.9 / 5.0 |
| Pit size | 22.7 / 34.2 / 7.6 |
| Runnel spacing | 4.1 / 7.5 / 1.5 |
| Grit | 26.9 / 36.1 / 11.6 |

Soil-covered terraces change 26.2 / 49.0 / 22.7 percent of grass-slope
blocks. Reflection shape tests use Gloss .8 and Micro roughness .8;
pit-size and runnel-spacing tests use their parent strength 4. These are
active artist contexts, not claims that each subordinate control matters
with its parent at zero. Each retained rock/reflection control exceeds
5% of its relevant class in at least one reference window. Not every
control exceeds 5% in every window, particularly those with little rock.

## Measured modern Green terrain statistics

Before and after reports are byte-identical: mean 8.12 of 15 statistics
inside the real range over 17 eligible windows. Gate passes before → after:
closed basins 17 → 17, fabric 15 → 15, hilltop roundness 8 → 8, Hack's
exponent 5 → 5, hollow share 17 → 17, valley share 17 → 17. The 23 existing
gate failures remain; maximum slope p90 is .742. The voxel surface does
not change these source-height measurements.

## Remaining work after integration

Green's rock tone, long horizontal courses, and grass/rock transition need
further artist review. Other biome profiles need their own visual tuning.
Local wear is an appearance model, and bounded rain/shadow probes are
approximations. The higher final-render cost is measured separately below.

## Measured interaction and export cost

Chrome/Metal on this machine, Green 2 at 1x on a 4×4 map, default 512 MiB
budget. Runs alternate main A, voxel A, main B, voxel B with no other
agent GPU checks running. Values below retain both runs; they are not a
cross-hardware performance promise.

| Metric | Main A / B | Voxels A / B |
| --- | --- | --- |
| Drag picture updates per second | 59.84 / 59.98 | 59.75 / 59.46 |
| Drag frame interval p95, ms | 16.7 / 16.8 | 16.7 / 16.7 |
| Pointer picture latency median, ms | 57.5 / 64.4 | 65.0 / 59.3 |
| Pointer picture latency p95, ms | 69.0 / 68.9 | 75.2 / 73.5 |
| Load to final visible art, ms | 1355.9 / 1388.1 | 2154.5 / 1664.6 |
| Release to final visible art, ms | 1112.3 / 1096.8 | 1381.8 / 1399.2 |
| Full map export, ms | 1810.6 / 1835.5 | 3741.3 / 3697.0 |
| Reported peak GPU allocation, MiB | 354.5 / 353.5 | 347.5 / 347.5 |

All four runs completed without console errors, with all 70 pointer moves
measured. Live dragging remains near 60 updates/second on this fixture;
final refinement takes about 26% longer and export about twice as long.
GPU numbers are the renderer's tracked allocation estimates. The new path
also accounts for resized stone/vegetation masks that main did not track,
so the accounting is more complete and these are not physical VRAM samples.

## Editor and export validation

- The landing tier passed: unit checks, world-name gate, all 34 scenes,
  regional replay, voxel partition/continuity checks, nine worlds × 19
  tools, larger-map undo, features, passability and shape repetition.
- Section-editor interactions and autosave round trips passed for Green
  and Desert. Workspace save/load, transforms, curves, navigation, undo,
  hover help and responsive layout passed.
- Vegetation and flower edits, reload, world-file export/import and reset
  passed. The focused final Green control sweep has 29 enabled world rows,
  one gated row and one stroke row, with no unexplained behavior.
- Default export-byte checks passed for Green 4×4, Lava 8×8 and Red 16×16.
  Green's final browser export with six placed features repeats exactly and
  matches a freshly built native exporter: identical `.ufo` and indexed
  PNG hashes, 3,668 unique tiles, no console errors.
- Authored hover art regenerated: 14 tools and 147 control frames.
- Manual editor review drew a plateau, hill and mountain, inspected their
  actual relief in Clay, restored Art and saved the existing recipe format.

Code review also preserved bake-state rollback when shader specialization
requires a retry across an async boundary, with two focused regressions.
An initially parallel passability run timed out; isolated runs passed.
The first browser/native feature comparison used an outdated external
native binary; rebuilding the current exporter resolved it without an
editor/exporter source change.
