# Retiring the specialized terrain tools

2026-11-03. This is an implementation assessment after the owner approved the refined plateau and busier mesa, and requested landing the landform improvements. No specialized tools are removed by this change. Earlier visual evidence is in [the initial comparison](LANDFORM_COMPARISON.md) and [the refinement review](LANDFORM_FOLLOWUP.md).

**Owner decision, November 3:** this is an unreleased project. Old saves and backward compatibility are not requirements for tool retirement. Do not build legacy-node migration or compatibility render paths. Update the project's maintained scenes and examples to the new tools so they continue to provide useful coverage.

## What the landing includes

The reviewed green plateau is the general Landform starting shape; the existing Desert tool style starts with the reviewed mesa. Both remain ordinary numerical presets with editable cross-sections. Starting elevation is map plain +70 units, or +90 for the mesa. The generic Plateau form also gets the gentler foot. Applying a tool style to a selected stroke now applies its curve as well as its scalar settings.

The implementation also includes the reviewed radial outline variation, the new **Smooth route** control through the shared route/protection fields, and **Crest taper** reused for landform ends. Route and taper start at zero. No material settings, alternate renderer, page, or save format were added.

**[Measured]** Default-only scenes `11-plateau-default.json` and `12-mesa-default.json` have no tuned stroke card or explicit curve. Their textured PNGs, clay PNGs, and authored-height samples match the approved refined plateau and mesa captures byte for byte. The actual UI's pre-existing range steps snap the 300 px plateau diameter to 304 and the mesa's 75 px wander to 76; the interaction check verifies those UI values separately. Existing saved stroke values remain explicit. A saved landform with only the `lfPlateau` form name adopts the updated form; nonzero wander/width variation adopts the reviewed new outline behavior.

The full control audit found one exact-zero control in the new starting shapes: Facing on the symmetric mesa. Facing now appears only when the widths or sampled front/back profiles differ. The inspector passes the actual curve to the shared applicability rule, and the rendered-control audit passes values in the same engine units as the inspector. This is a control-availability correction; the approved geometry is unchanged.

## What prevents replacement now

**[Source inspection / proposal]** A static visual fit is possible for the main raised shapes, but it does not preserve every specialized tool's response to edits. `lfEval` in `engine-shape.wgsl` currently interpolates each cell's existing height toward an absolute crest. Specialized tools also use per-cell height, a sampled start height, or sampled endpoint heights. The next useful extension is a height reference in the existing Height controls, not another natural-variation slider.

| Tool or operation | Landform already supplies | Work needed before retirement |
| --- | --- | --- |
| Plateau / mesa | Editable cap, asymmetric foot, outline variation, terraces | Sample the stroke-start height for the same relative-height workflow; calibrate presets across worlds and update maintained scenes. |
| Rounded and peaked ridge | Cross-section, along curve, spurs, end taper, width/height variation | A per-cell “above ground” height reference; preserve shoulders, corner treatment and the applicable ice facet feature. Natural presets need retail review beyond the Green examples. |
| Ramp | Along curve, Flatten to, smooth travel strip | Join/re-sample both endpoint heights after earlier terrain edits. Preserve rounded path handling and regional read dependencies. |
| Raise/lower | Positive or negative target, arbitrary section | Signed displacement relative to each underlying cell, with the existing mask/route behavior and any enabled shore features. |
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

1. **Height references and the first retirement batch.** Extend Height with explicit fixed-elevation, stroke-start-relative, per-cell-relative and endpoint-grade semantics. Reuse the current elevation/amount input with a suitable label and range rather than add several height sliders. Presets select those semantics with ordinary data. Include rounded-path behavior where required. Target Plateau, both Ridge variants, Ramp and Raise/lower first, removing the old `lower` kind with them.
2. **Water and signed profiles.** Let shared coastal and water-field features run from landform data, independent of a legacy tool kind; add sea-relative height and shallow-passage composition. Separately fix signed section coverage and review basic crater rim/bowl profiles. These are independent ideas and should be separate commits.
3. **Generated structure.** Move fissure paths, craterlets/rim sectors and faceted clusters into reusable geometry/feature generation. CPU path/point preparation is already used; do not add a CPU terrain evaluator. Retire each specialized kind only when its applicable features are represented and reviewed. Faceted forms are the largest conceptual gap.
4. **Replace and delete together.** Update maintained scenes, presets and tests to use landform, then remove the retired UI choices and GPU entry points. Keep one editor, one graph/save format, and one GPU implementation per feature. No old-save conversion or compatibility shader is required.

The earlier old-save migration requirement is withdrawn by the owner decision above. New landform strokes still need correct ordering, transforms, multiple paths, masks, route/protection fields and re-evaluation after earlier terrain edits. Test normal current-format load/save/undo and regional replay; these are present editor features, not backward compatibility.

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

Re-author representative maintained scenes with landform, then compare against all three retail windows of each affected world. Review textured output and clay at 1x, authored/exported 16 px height cells, and route/protection/material fields. Include clicks, bends, self-crossings, spurs, multiple paths, transformed strokes, varied underlying terrain, and edited endpoint heights. Require regional replay, undo/reload, 8x8 paging/export and alternating interaction measurements. Untouched scenes must remain byte-identical.

**[Proposal]** Judge intentional art changes by the retail sheets and owner review. Require matching functional semantics (for example, a ramp still connects its endpoints and a passage remains traversable), rather than approving a fit only because an average pixel or height error is small. No additional variation knobs are justified by the accepted plateau/mesa review.

The probes and audit establish the gaps; the reference modes, generic coast/generator work and actual tool removals are unfinished. Rendered evidence stays outside Git under `/private/tmp/nanolathe-map-editor/agent-landform-land`; only authored JSON and documentation are committed.


## Shores as landforms

**[Source inspection / proposal, November 3]** The owner's inverted-hill model is a good fit for basic shores. A landform with a target below sea level and Cut to can use an ordinary positive 0–1 section to excavate a basin or channel. This does not require the mixed-sign rim/bowl fix described above. The low point follows the drawn path; the shoreline is the resulting intersection of the bed and sea level. Drawing the shoreline itself would be a different authoring convention and is not needed for the first experiment.

Keep physical geometry and water appearance independent:

| Profile | Physical result | Surface result |
| --- | --- | --- |
| Smooth inverted hill | Continuous bank and bed slope | Shallow/deep colors can already follow depth, with a hard or blended transition. |
| Shelf then drop | An actual shallow shelf and deeper basin, made with section knots or terraces | The same depth-based water shading; no separate shallow/deep tool is inherently needed. |
| Terraced or asymmetric cut | Steps or a steep bank on the chosen side | Can supply simple lava banks; shoreline-anchored detail still needs the existing coastal features. |

**[Source inspection]** `engine-frag.wgsl` already derives the shallow/deep blend from `sea - bed height`, with world depth thresholds, optional averaging, and hard-edge or blended rendering. A sharp color transition does not require a geometric step. Geometry still determines the exported height cells; judging passability requires those heights rather than the water color.

**[Source inspection]** The current landform profile/terrace evaluation follows distance from its stroke. The existing `coastLayers` pass builds ledges from distance to the actual joined shoreline and anchors their heights to sea level. They can differ on uneven terrain and overlapping cuts. Start by testing ordinary landform terraces; retain the shoreline-distance feature where it visibly earns its place. Reuse its section/step controls where possible instead of keeping duplicate generic and shore terrace panels.

**[Proposal]** Use Wander and Width variation for broad shore irregularity, with Height variation kept modest so shallow shelves stay useful. Preserve Fingers as a generic shore feature: the existing generator grows connected land tongues along shoreline normals and checks connection to the dry bank. This carries a recognizable structure beyond increasing outline noise. It should consume landform's affected shoreline, not depend on a `deep` or `shallow` tool kind, and should run before rebuilding shoreline contours for ledges.

The implementation seam is concrete: allow landform to supply the coastal pass's footprint, trigger its enabled features independently of legacy water kinds, carry the existing per-stroke water fields, and extend bounds/regional replay to include the coastal reach. The current landform stamp does not write the coast scratch footprint used by `coastSeed`; adding landform to a tool list alone would be incomplete. Sea-relative target depth belongs in the planned height-reference work. The existing world material settings can handle appearance without a new water-color knob.

**[Proposed next comparison]** Hold path, seed, terrain and lighting fixed: compare the dedicated shore with (1) a smooth landform cut using depth-based color, (2) a shelf-profile cut, (3) a terraced lava cut, then (4) the chosen lava profile with shared Fingers and shoreline ledges. Include flat ground, a cut across a slope and overlapping strokes; review all three Green, Archipelago and Lava retail windows before removing Deep/Shallow. This shore implementation and visual round are not done yet.
