# Retiring the specialized terrain tools

2026-11-03. This is an implementation assessment after the owner approved the refined plateau and busier mesa, and requested landing the landform improvements. No specialized tools are removed by this change. Earlier visual evidence is in [the initial comparison](LANDFORM_COMPARISON.md) and [the refinement review](LANDFORM_FOLLOWUP.md).

## What the landing includes

The reviewed green plateau is the general Landform starting shape; the existing Desert tool style starts with the reviewed mesa. Both remain ordinary numerical presets with editable cross-sections. Starting elevation is map plain +70 units, or +90 for the mesa. The generic Plateau form also gets the gentler foot. Applying a tool style to a selected stroke now applies its curve as well as its scalar settings.

The implementation also includes the reviewed radial outline variation, the new **Smooth route** control through the shared route/protection fields, and **Crest taper** reused for landform ends. Route and taper start at zero. No material settings, alternate renderer, page, or save format were added.

**[Measured]** Default-only scenes `11-plateau-default.json` and `12-mesa-default.json` have no tuned stroke card or explicit curve. Their textured PNGs, clay PNGs, and authored-height samples match the approved refined plateau and mesa captures byte for byte. The actual UI's pre-existing range steps snap the 300 px plateau diameter to 304 and the mesa's 75 px wander to 76; the interaction check verifies those UI values separately. Existing saved stroke values remain explicit. A saved landform with only the `lfPlateau` form name adopts the updated form; nonzero wander/width variation adopts the reviewed new outline behavior.

The full control audit found one exact-zero control in the new starting shapes: Facing on the symmetric mesa. Facing now appears only when the widths or sampled front/back profiles differ. The inspector passes the actual curve to the shared applicability rule, and the rendered-control audit passes values in the same engine units as the inspector. This is a control-availability correction; the approved geometry is unchanged.

## What prevents replacement now

**[Source inspection / proposal]** A static visual fit is possible for the main raised shapes, but it does not preserve every specialized tool's response to edits. `lfEval` in `engine-shape.wgsl` currently interpolates each cell's existing height toward an absolute crest. Specialized tools also use per-cell height, a sampled start height, or sampled endpoint heights. The next useful extension is a height reference in the existing Height controls, not another natural-variation slider.

| Tool or operation | Landform already supplies | Work needed before retirement |
| --- | --- | --- |
| Plateau / mesa | Editable cap, asymmetric foot, outline variation, terraces | Sample the stroke-start height for the same relative-height workflow; calibrate presets across worlds and convert old nodes. |
| Rounded and peaked ridge | Cross-section, along curve, spurs, end taper, width/height variation | A per-cell “above ground” height reference; preserve shoulders, corner treatment and the applicable ice facet feature. Natural presets need retail review beyond the Green examples. |
| Ramp | Along curve, Flatten to, smooth travel strip | Join/re-sample both endpoint heights after earlier terrain edits. Preserve rounded path handling and regional read dependencies. |
| Raise/lower, including saved `lower` nodes | Positive or negative target, arbitrary section | Signed displacement relative to each underlying cell, with the existing mask/route behavior and any enabled shore features. |
| Deep / shallow water | Cut to a below-sea elevation | Sea-relative depth; shallow passage semantics; coastal fingers, layers and plates; per-stroke water surface fields. The existing effects must accept generic feature data from landform. |
| Crater | A radial dab and editable section | Separate signed section height from coverage so a single section can have a raised rim and lowered bowl. Rim sectors/gaps, craterlets, ejecta, spurs and faceting still need reusable generators/features. |
| Fissure | A narrow lowered section and editable paths | Reuse the zigzag/branch generators, implement the network topology as generic path generation, and preserve the dark fissure field. A curve does not generate a crack network. |
| Faceted forms: crystals, columns, icebergs | Some simple peaked or terraced silhouettes | Polygonal footprints, facet planes, cluster generation, alignment, material fields and the different column/berg behavior. These need shared geometry features, not just new section presets. |
| Smooth, Reset, surface paint / sand / ground cover | Existing field plumbing is shared | These are filters or field edits, not swept height profiles. Keep them as a small Finish group unless a broader generic stroke-operation UI is explicitly desired. Reset also clears routes/masks; paint must leave height unchanged; smoothing reads a neighborhood. |

Selecting features, imported surfaces, ground generation and height-scale/flow-bake nodes are separate editor operations, not specialized sculpting profiles to silently delete.

## Two measured blockers

**[Measured]** The crossing-ridge fit initially agrees at the intersection: dedicated **138.9882**, landform **138.9887**. Change only the earlier hill's rise from 45 to 90: dedicated **183.9863**, landform **138.9951**. The maximum authored-height discrepancy becomes **44.9912 units**; mean absolute discrepancy over cells either result raises at least one unit is **3.3180**. The landform has the originally fitted along curve and absolute elevation, so it does not follow the edited hill. Fixtures `13-crossing-raised-{dedicated,landform}.json` reproduce this; the original pair is `09-crossing-*`.

![The fitted ridge before and after editing the underlying hill](/private/tmp/nanolathe-map-editor/agent-landform-land/audit/height-reference-comparison.png)

**[By eye]** The first row is a close fit; after the earlier hill is raised, the landform ridge merges into it while the dedicated ridge rises over it. This demonstrates an authoring-semantic gap, not a request to make the default noisier.

**[Measured]** `14-signed-profile-landform.json` has a plain at 24, elevation 94, Flatten to, and a section ending at -0.5, with a positive rim. The intended signed center is `24 + (94-24)*(-0.5) = -11`. The actual authored center and minimum are both **24**, while the rim reaches **44.9935**. Full replay mismatch is **0**, colored tile mismatch **0**, and console errors **0** for this probe and both raised-prefix probes. The missing bowl is current behavior, not a replay failure.

**[Source inspection]** `lfEval` returns `clamp(q,0,1)` as its influence, and `stampLandform` rejects candidates with nonpositive influence. Negative section values are therefore dropped even though the curve table can store them. Fixing coverage would enable the basic rim/bowl shape; it would not by itself reproduce the crater's angular structure and satellite craters.

## Recommended sequence

1. **Height references and the first retirement batch.** Extend Height with explicit fixed-elevation, stroke-start-relative, per-cell-relative and endpoint-grade semantics. Reuse the current elevation/amount input with a suitable label and range rather than add several height sliders. Presets select those semantics with ordinary data. Include rounded-path behavior where required. Target Plateau, both Ridge variants, Ramp and Raise/lower first, with old `lower` included in migration.
2. **Water and signed profiles.** Let shared coastal and water-field features run from landform data, independent of a legacy tool kind; add sea-relative height and shallow-passage composition. Separately fix signed section coverage and review basic crater rim/bowl profiles. These are independent ideas and should be separate commits.
3. **Generated structure.** Move fissure paths, craterlets/rim sectors and faceted clusters into reusable geometry/feature generation. CPU path/point preparation is already used; do not add a CPU terrain evaluator. Retire each specialized kind only when its applicable features are represented and reviewed. Faceted forms are the largest conceptual gap.
4. **Migrate and delete together.** Convert old nodes to landform data before unknown-kind filtering, then remove the retired UI choices and GPU entry points. Keep one editor, one graph/save format, and one GPU implementation per feature. Retaining the old shader behind a hidden compatibility flag would not count as retirement.

**[Source inspection]** `deserializeNodes` currently filters against `NODE_NAMES`, and `prepareNode` skips unknown `KIND` values. Merely removing names or enum entries would silently lose old terrain. Migration must retain seed, ordering, frame, multiple paths, masks, route/protection fields and editable parameters. Re-evaluation must use the preceding terrain, including when an earlier stroke moves or changes height. Test load/save/undo and regional replay of converted graphs; do not freeze an old save into a CPU-generated height raster to bypass migration.

**[Measured inventory]** The 27 standard retail-window scenes contain **271 authored strokes**:

| Family | Strokes |
| --- | ---: |
| Hill / mountain / plateau | 69 / 9 / 10 = 88 |
| Deep / shallow water | 51 / 31 = 82 |
| Crater | 29 |
| Faceted form | 18 |
| Raise / lower | 9 / 1 = 10 |
| Sand / paint / reset | 27 / 16 / 1 = 44 |

There are **zero ramp, fissure or smooth strokes** in those 27 scenes. Their shape fixtures, demo cases and smoke coverage must be included in a retirement review. A green plateau comparison alone cannot qualify the other families.

## Acceptance for each retirement batch

Convert representative existing scenes using deterministic data mappings, then compare against all three retail windows of each affected world. Review textured output and clay at 1x, authored/exported 16 px height cells, and route/protection/material fields. Include clicks, bends, self-crossings, spurs, multiple paths, transformed strokes, varied underlying terrain, and edited endpoint heights. Require regional replay, undo/reload, 8x8 paging/export and alternating interaction measurements. Untouched scenes must remain byte-identical.

**[Proposal]** Judge intentional art changes by the retail sheets and owner review. Require matching functional semantics (for example, a ramp still connects its endpoints and a passage remains traversable), rather than approving a fit only because an average pixel or height error is small. No additional variation knobs are justified by the accepted plateau/mesa review.

The probes and audit establish the gaps; the reference modes, migrations, generic coast/generator work and actual tool removals are unfinished. Rendered evidence stays outside Git under `/private/tmp/nanolathe-map-editor/agent-landform-land`; only authored JSON and documentation are committed.
