# H21 Impacts, part 2

Baseline: main `f64afa1`, after H20, H21 part 1 and the coordinator's lighting-gate fix. Branch `H21-impacts-2`. Assets and full command logs: `/private/tmp/nanolathe-map-editor/agent-H21`, fresh `*-2` directories. No perf rounds, per the handoff. Retail is a measuring source only.

## Method

The fresh archived baseline has all 27 windows and nine wall scenes. Switch-off probes change one family at a time. Query values are replaced, not appended behind an existing value; shape options also replace the copied stroke's card and top-level engine-unit option. This includes the Moon crater's child spurs inheriting `moonLobes`. Committed scenes remain unchanged.

MAD is whole-window mean absolute RGB difference on 0–255 channels. Changed class blocks use `measure/geology_diff.py`: 16-pixel blocks, the existing luma/colour thresholds, majority membership. Moon uses slope, fold or impact as indicated. Crystal and Red use H20's narrower crater discs; the older H21 impact class also included unrelated hills. Neither class is an exact projected skin mask, and neither measures visual quality. Whole retail/editor pairs at native resolution decide the look; 2x crops identify the drawer.

## Switch-off table

34 valid switch-off renders, plus three discarded `shineOn=0` probes (that name is a derived uniform, not a query control). The corrected shine probe sets all five materials' gloss and roughness to zero. All 37 renders exit 0 with mismatch 0 and console `[]`; logs are `off-2.log` and `shine-off-2.log`. No runtime change in this step: frag/bridge/bake/shape remain 1978/140/1383/1612 physical lines.

| Window / visible mark | Switch and whole-window MAD (1/2/3 where present) | Proven drawer / limit |
|---|---|---|
| Moon all three: regular dark pits, bright lips | `moonCups` 1→0: 2.522/.915/1.188; slope blocks 35.30/34.23/34.83% | `moonCups` bowl normals plus cavity darkening. Removing it leaves ribs, not broad folds. `pockmark` is already 0, so these are not E6's unlit dots. |
| Moon all three: fine bright/dark streaks on shaded flanks | `moonRibs` 1→0: 2.925/.925/1.374; slope 21.19/14.48/20.12% | `moonRibs` derivative-noise relief and its darkening. The pits remain. |
| Moon all three: close curved lines on gentle slopes | `moonFolds` .55→0: 3.541/2.001/1.967; fold 48.18/36.71/36.61% | `moonFolds`, warped height contours. They cross slopes, rather than supplying the retail uphill folds. |
| Moon all three: lobed ridge/foot outline | `moonLobes` .5→0, including crater child hills: 5.863/2.104/4.009; impact 27.50/16.68/25.98% | Shared `outlineShift`, radius-scaled whole-face profile. Removing it smooths the outline and loses real relief. |
| Moon: satellite bowls | `craterlets` authored counts→0: .402/.757/0; impact 1.53/3.37/0% | `prepareNode` child crater stamps. moon-3 already authors zero. Independent small authored craters remain. |
| Moon: rough throw-out outside crater rims | `craterEjecta` .7 (where enabled)→0: 2.804/.871/.149 | `craterStamp` ejecta; shifts textured ground near those rims. Central moon-2 crater already authors ejecta 0. |
| moon-2: central radial ridges | `spurCount` 7→0 on the crater: 2.753; impact 19.53% | Child hill spurs. The bowl and the underlying large hill remain; the spokes disappear. |
| Moon: rock detail on near-vertical projected faces | `faceRelief` .5→0: .002/.012/.009 | H19's wall-gated relief has little support here; it does not draw the regular pit field or uphill folds. Its dedicated wall remains a separate H19 case. |
| Moon: faint fine sheen | All gloss/roughness→0: 2.161/.864/1.088; impact 1.69/1.39/1.36% | `shineTerm`; the cup pits and ribs survive. The failed derived-uniform probe proves nothing about reachability. |
| moon-2: missing sinuous fissures across plain | No corresponding stroke; cups/ribs/folds/lobes/spurs off do not reveal one | **Nothing in this scene draws them.** Needs authored fissure paths and their shape/width/depth, not a regolith value. `crackSeverity`, `worms`, `wrinkles`, `slopeMarks` and bands are already 0. |
| Moon: broad continuous folds running uphill, rounded into the rim | Lobes off loses some relief; cups/ribs/folds off separates the fine marks above | **No current surface-mark mechanism draws this form.** Outline wobble is only part of it; needs relief aligned with the formation's uphill direction, with rounded crests and variable widths. |
| red-1: crater bowl/rim and thin rings | `rimHeight` .34→0: .161, crater blocks 10.28%; `banding` .3→0: .568 whole window, 0% crater blocks | Rim geometry supplies the raised lip and its light/shadow; bands supply thin contours. The cropped rim changes below the block screen while other raised ground dominates the band MAD. |
| red-1: dark short cuts on rim/nearby ground | `crackSeverity` .3→0: .976; crater blocks 1.87% | Baked cracks, not ejecta. `craterEjecta` is already 0: its off probe is exactly equal. The current craters are small closed bowls, while retail has stronger broken rim forms. |
| crystal-1: fine wandering web across crater faces | `crystalCraterWeb` 1→0: .491; crater blocks 30.50% | `craterWeb`. The off value also disables the skin-edge ink suppression: a darker enclosing rim appears. Thus off is not a clean final simplification of this coupled gate. |
| crystal-1: broad angular planes and hard dark boundaries | `craterFacets` 1→0: 2.165; crater blocks 87.27%; `crystalCraterPx` 16→0 (auto size): 1.141, 35.28% | Shape facet job, its height discontinuities and skin/ink transition. Facets off removes the planes and their skin as well as the web. These larger dark boundaries are not all `craterWeb`. |
| crystal-1: extra dark/light contrast | `crystalCraterLight` 1.6→1: .203; crater blocks 10.34% | Crater skin contrast push; geometry and the seam layout remain. |
| crystal-1: baked surface cuts beside/on crater | `crackSeverity` .7→0: .192; crater blocks 6.90% | Baked cracks; removing them leaves the heavy web. Not its main drawer. |

Viewed: baseline whole pairs for moon-1/2/3, red-1 and crystal-1; all Moon diagnostic 2x sheets (including the discarded shine probe), the spur sheet, all five Crystal sheets, Red band/rim sheets, and both fixed crater sheets under `off-views-2`. The latter keep the crop on the craters instead of following larger changes on adjacent hills. Background art grain, global lighting, unrelated shore cells and column bodies are not Impacts marks and are not tuned. No visual judgment is inferred from the unchanged symlinked windows in single-scene probes.

## Moon targets

Ranked from the baseline whole-window pairs, with G8's comments in `sculpt.py` and the actual shader support read first:

1. **moon-1:** the large formation's slopes lack broad folds running up the wall. Regular cups and fine bright ribs dominate the shaded flank. Gentle slopes carry many thin contour lines; strengthening those cannot turn them into uphill relief.
2. **moon-2:** missing sinuous fissures across the plain, then the central radial formation's hard crater/spur structure and repeated pitting. The scene authors no fissures. Surface cracks, worms and wrinkles are different marks, not substitute scene strokes.
3. **moon-3:** the upper formation's angular, pitted rim and the lower formation's fine surface marks instead of rounded folded relief. `moonLobes` supplies some real outline relief and stays, as part 1 ruled.

G8 deliberately replaced unlit pock dots with lit cups, set bands to zero to remove straight scratches, and limited folds to .55 to avoid a contour-map appearance. Cup size controls lattice spacing, not the fixed 1.3–2.0 by 2.8–4.2 pixel bowl axes. Cup depth changes the added normal but leaves the cavity mask. Ribs are two fixed-scale, fixed-axis noise octaves. Folds are height contours on gentle slopes; wrinkles are fixed-axis noise lines and pits. None is a broad relief fold aligned uphill. Trials must preserve useful fine marks without claiming to solve that missing geometry.

**Three ideas, none kept.** All actual trial renders exit 0, mismatch 0, console `[]`. One-scene trials use baseline symlinks for the other two windows solely for the measurement tool; those zeros are not additional trials or visual verdicts.

| Idea / assets | MAD; slope blocks | Viewed 1x verdict |
|---|---|---|
| 1. Fewer lit cups: `moonCups` 1→.4; `trials-2/moon-cups-low` | moon-1 1.529; 21.19% | Further: the dark flank loses the hammered hollows and the fine streaks dominate. Still no uphill fold. Not extended to -2/-3. |
| 2. Remove fine ribs: `moonRibs` 1→0; reuse `off-2/moonRibs` | 2.925/.925/1.374; 21.19/14.48/20.12% | moon-1 mixed, -2 and -3 same in the main form mismatch: less fine hair, but more isolated, regular cups on smooth shade. No clear closer whole-window result. All three whole pairs and the 2x sheet viewed. |
| 3. Existing joined wrinkles instead: cups 1→0, ribs 1→0, wrinkles 0→.4; `trials-2/moon-wrinkles` | moon-1 6.754; 56.72% | Further: broad, flat dark blotches and scratch-like segments replace the lit pits. Not rounded uphill relief. Not extended to -2/-3. |

Both single-scene trials' whole pairs and 2x sheets were viewed. The ribs-off candidate also passed the statistics guard (75 cells, no newly outside): moon-1 `pic.band_2px` 6.927924→6.589927, `pic.luma_sd` 42.419250→40.263390 and `pic.thin_dark_density` .0153925→.0122654 went outside→inside. Those numbers alone do not justify keeping it. Log: `stats-ribs-off-2.log` (exit 0).

No further attempt at the same texture target. Increasing cup spacing or reducing its depth cannot grow or connect the fixed bowl axes; restoring pockmarks returns unlit dots; more folds strengthens contours rather than uphill relief. The missing fissures need authored paths. The rounded radial/upper formations need shape work, not a global replacement of G8's fine marks. Moon values, variants and scenes remain unchanged.

## Crystal craters

Only crystal-1 has authored craters. Its retail walls have broad lit planes and a few thin cracks; the baseline west walls have a heavy dark web. The cell drawer `markCells`, `crystalField`, `crystalShallowWater` and all shore cell sizes are protected. `crystalCraterPx` is crater facet size, not shore size. `crystalCraterLight` changes contrast, not an additive light; `crystalCraterGap` omits seams, not their thickness.

## Red craters

Only red-1 has authored craters. Any tuning must preserve its rim rings and the other two Red windows.

## Final checks and review record

To be filled from the final logs, including every changed statistics flag and the exact viewed/not-viewed list.
