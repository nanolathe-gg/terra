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

| Idea / assets under `trials-2` | crystal-1 MAD; crater blocks | Whole-window 1x verdict |
|---|---|---|
| 1. `crystalCraterWeb` 1→.35; `crystal-web-light` | .189; 17.51% | Closer in seam weight, but the west wall still reads dark. 75 statistics flags unchanged. |
| 2. Web .35 plus `crystalCraterLight` 1.6→1; `crystal-web-contrast` | .389; 29.18% | Closer: less dark, busy wall texture, with the lit planes and a faint web retained. 75 flags unchanged. **Kept.** |
| 3. Broader cells on idea 2: crater facet size 16→32 and web size 18→36; `crystal-broad` | 1.444; 54.64% | Further: large angular rims/steps replace the finer planes, while the dark enclosing edge becomes prominent. Rejected on the viewed pair; not extended. |

All three target pairs and 2x sheets were viewed. The web-off diagnostic is not kept: its coupled gate adds an enclosing ink rim. The final world's own defaults were then rendered in `trials-2/crystal-world` and all three whole pairs viewed: **crystal-1 closer, crystal-2 same, crystal-3 same**. The change is limited: it lightens the heavy web/contrast but does not supply retail's complete broad-plane geometry. No thin-mark exception is needed: the combination changes 29.18% of crater-class blocks.

The world-table render equals idea 2 exactly on crystal-1 (MAD .389075597, 21,800 changed pixels). crystal-2 has one changed pixel at (556,86), MAD .000011444, max channel 16; crystal-3 is byte-identical. The skin classifier is a neighbourhood test around field value .74, not an authored-crater ID, so its gate is not an absolute exclusion of non-crater scenes. That one-pixel reach is reported rather than rounded into a claim of byte equality. Heights are exact in all three. All renders exit 0, mismatch 0, console `[]`. `stats-crystal-world-2` checks the actual defaults; no flag changed and none became newly outside.

Only the two world values above are changed. `craterFacets`, facet/web sizes, step/skin, wobble, gap and tone stay as before. No shader, function, uniform, control or scene is added or removed; shader lines remain 1978/140/1383/1612. This is a table-only change, with one explanatory comment line added.

## Red craters

Only red-1 has authored craters. Any tuning must preserve its rim rings and the other two Red windows.

The switch-off table identified one numeric target: the small closed rims against retail's stronger broken rim forms. Two ideas were sufficient to reject a global default change (the three-try limit is a ceiling):

| Trial under `trials-2` | red-1 MAD; crater blocks | Viewed 1x result |
|---|---|---|
| `red-rim`: `rimHeight` .34→.6 | .148; 6.54% | Same in the main mismatch: a more pronounced small closed bowl, not the broader broken retail rim. No useful whole-window improvement. |
| `red-broken-rim`: `rimGaps` 0→1, `rimSectors` 0→4 | .104; 1.87% | Same at whole-window scale; small lip breaks are visible at 2x, but insufficient at 1x. No thin-mark exception claimed. |

Both whole retail pairs and 2x sheets viewed; both renders exit 0, mismatch 0, console `[]`. Neither was extended to red-2/-3 or sent through statistics, since it failed the visual gate first. No Red value or scene is changed. Stronger variation would be a change to the authored crater shapes (radius/depth, rough outline and local rim cuts), rather than a reason to alter every Red crater or its shared band/crack defaults. Red's bank and shallow-bed mismatches remain Shores' leftovers.

## Final checks and review record

The [Impacts count](COMBINE_OR_DROP.md#impacts-h21) has 14 review rows: 11 unique weak/inactive controls and three unresolved bundles. The fresh seven-state Crystal sweep covers the changed web/contrast context, 21 renders, exit 0, mismatch 0 and empty console. [Numeric results](impacts-controls-2.json) give both the historical impact class and the narrower crater class: Step, Web and Light are under 5% of impact but above 10% of crater blocks. No control deletion follows from the diluted screen. The one conditional wobble line was already counted by Bodies and is not added again. No knob or runtime code changes in the count step.

### Final render and statistics delta

Fresh `after-2` versus archived `before-2`, both all 27: only **crystal-1** (MAD .3890755971272786, closer at 1x) and **crystal-2** (MAD .000011444091796875, same at 1x; one pixel) move. **crystal-3** is exact and reads the same. All three final whole retail pairs and the final 1x/2x sheets were opened. The other 24 scenes are byte-identical RGBA, a numerical equality rather than a new visual ruling. All 27 height arrays are exact. All nine wall scenes are byte-identical RGBA and exact heights.

`stats-before-2` and `stats-after-2` both exit 0. All **675** outside-retail flags are unchanged; none newly outside. **17 metric cells** change, all listed below; the other 658 cells are exact. Every listed cell remains inside its retail family range. Direction means numerical increase/decrease, not a visual quality judgment. Full precision is retained in `stats-delta-2.json` in the assets.

| Window | Cell | Before | After | Direction |
|---|---|---:|---:|---|
| crystal-1 | `pic.band_2px` | 6.12593841552734 | 6.07579898834229 | down |
| crystal-1 | `pic.band_32px` | 3.92586874961853 | 3.86748838424683 | down |
| crystal-1 | `pic.band_8px` | 5.9058952331543 | 5.89603757858276 | down |
| crystal-1 | `pic.edge_density` | 0.147225106950214 | 0.144088288176576 | down |
| crystal-1 | `pic.edge_diagonal` | 0.571597773303328 | 0.575032271944923 | up |
| crystal-1 | `pic.edge_horizontal` | 0.166686406885388 | 0.164519685886403 | down |
| crystal-1 | `pic.edge_vertical` | 0.261715819811284 | 0.260448042168675 | down |
| crystal-1 | `pic.lab_hist_dist` | 0.187716407155958 | 0.188208665983951 | up |
| crystal-1 | `pic.luma_mean` | 62.7938995361328 | 63.0571479797363 | up |
| crystal-1 | `pic.luma_sd` | 30.5093822479248 | 30.3090152740479 | down |
| crystal-1 | `pic.thin_dark_density` | 0.00431191487382975 | 0.00397963295926592 | down |
| crystal-2 | `pic.band_2px` | 6.14852809906006 | 6.14852857589722 | up |
| crystal-2 | `pic.band_32px` | 4.10844802856445 | 4.10844755172729 | down |
| crystal-2 | `pic.band_8px` | 6.26276254653931 | 6.2627592086792 | down |
| crystal-2 | `pic.lab_hist_dist` | 0.118671920150449 | 0.118671593338098 | down |
| crystal-2 | `pic.luma_mean` | 51.3677062988281 | 51.3677177429199 | up |
| crystal-2 | `pic.luma_sd` | 29.7251644134521 | 29.7251567840576 | down |

### Required checks

All required commands exit **0**. The GPU suite records each of its exits in `checks-2.log`; the separate statistics, gate and Node test exits are recorded in NOTES. Individual logs and numeric outputs are retained. No perf rounds.

| Check | Result / asset log |
|---|---|
| All 27 and compare | `after-2.log`, `compare-2.log`; render mismatch 0, console `[]`; only the two Crystal scenes above move |
| Statistics | `stats-before-2.log`, `stats-after-2.log`; 675 flags unchanged, all 17 changed metric cells above |
| Nine wall scenes | `wall-<world>-2.log`, `pixel-check-2.json`; all RGBA/heights exact, mismatch 0, console `[]` |
| Regional, all 27 | `regional-<scene>-2.log`; 837 field comparisons, all exact |
| Smoke | `smoke-2.log`; 135 brushes, eight exports and Zhon disabled by design; console `[]` |
| Page8 | Green, Lava, Ice, Zhon, Red, Archipelago: paged 5, added 1, after undo 0 in each, console `[]` |
| World gate | `gate-2.log`; passes, no new branch (existing world-named identifiers listed) |
| Node tests | `node-tests-2.log`; 35/35 pass |
| Shape controls | `shape-controls-2.log`; 161 cases, 131 shown, zero shown-but-dead `!`, console `[]` |
| H15 section | `section-check-2.log`; 288 classic cases, max RMS .003290743572358273 and max sample .02923685213806948; 12 form cases, max RMS .07893175859126196 and max sample .31502373325007227; console `[]` |
| Curve editing | `curveedit-2.log`; 48/48 checks across Green and Desert, console `[]` |

Section errors are against H15's retained classic reference and the forms' analytical knots; they are not retail-image errors. Numeric equality checks do not imply that unchanged scenes already match retail.

### What was viewed

The switch-off and trial sections above identify the images used for each ruling. In addition, opened all three final Crystal whole pairs (`after-2/crystal-{1,2,3}/pair.png`) and `sheets-final-2/{1x,2x}.png` (retail, main, final); the retained world-labelled sheets `off-views-2/moon-craterEjecta-2x.png`, `red-crackSeverity-2x.png` and `red-craterEjecta-2x.png`; and the corrected shine-off sheet. The world-labelled sheets preserve crops from the original renders where the first driver's shared knob name had overwritten a different world's summary/diagnostic file. The original render files and per-render metrics in `off-2.log` remain available.

Not viewed: the other 22 baseline whole pairs (apart from moon-1/2/3, red-1 and crystal-1), the 24 non-Crystal final whole pairs, the nine before/after wall images, the 21 final count-probe images, and the generated overview/layout images. Those checks are numerical only. No quality claim is made from these unviewed images. Trial-window symlinks are not renders and never count as extra visual evidence.

### Left for the owner

Added to **Small leftovers** in `docs/TERRAIN_ENGINE.md`: Moon's broad uphill folds and rounded formations need relief aligned with their formation, with rounded crests and variable widths; moon-2's missing sinuous fissures need authored paths with width/depth. Crystal's remaining broad-plane/rim mismatch needs facet/rim and skin-boundary work. Web-off currently also restores enclosing ink; an independent skin gate would need its own proof and owner ruling. The one changed non-crater pixel is consistent with the neighbourhood classifier, but its exact cause was not isolated; retain it for a targeted classifier check rather than treating the rounded MAD as exact zero. Red's stronger broken rims first need local authored shape work (radius/depth, rough outlines and rim cuts), rather than another global mark default. No new knob, shader branch, scene or shore-size change was made, and no further target was started after this step.

### Departures and retained files

No perf rounds and no delete commands. The regional runner is an asset-local copy that omits its profile deletion and uses an absolute import; the repository tool is unchanged. Failed `shineOn` probes are retained but excluded from the switch-off evidence. Single-scene trials were not extended after failing the visual gate. The three-try limit is a ceiling: Red stopped after two ideas. The old template's unrelated coast work and Claude attribution/session footer were not copied.

All assets are retained under `/Users/daniel/terraform-assets/agent-H21`. After review, cleanup candidates are the part-2 archive `main-src-2`, before/after and wall renders, off/shine probes, trial fixtures and renders, count probes, sheets, statistics outputs, smoke exports, shape/section/curve outputs, and owned browser profiles (including `regional-profile-2-*`). Scratch helpers and their saved copies can also go; retain NOTES, command logs and numeric evidence while reviewing. Never remove the shared targets of `features`/`map-catalog.json` symlinks or `assets-*`. Shutdown and final commit details are recorded in the asset root's `NOTES.md`.
