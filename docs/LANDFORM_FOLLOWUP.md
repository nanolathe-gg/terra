# Landform equivalence: natural edges, smooth routes, and tapered ends

November 3, 2026. Follow-up to [the first comparison](LANDFORM_COMPARISON.md), on branch `landform-compare`, based on main `dfee4b4`. This round changes the landform shape implementation and its controls. No specialized tool has been removed. The first-round fixtures and captures remain available for comparison.

**[By eye]** The plateau and mesa now have more varied shoulders and free ends. The ramp's travel strip is much closer, and the ridge ends have the missing narrowing. This is enough to review the controls, but not enough to retire the specialized tools: automatic ramp endpoint sampling and the exact dedicated natural-outline character remain different.

![Dedicated tool, previous landform, updated landform](/private/tmp/nanolathe-map-editor/agent-landform-improve/review/comparison-overview.png)

The overview is 37.5% scale. Each row uses identical path coordinates, seed 2701, prefix terrain, world settings, lighting, and camera. The old columns are the preserved main captures; the right column uses the updated implementation and fitted parameters below. Native sheets show textured output above clay; clay still includes surface relief. Neither comparison uses independently recentered crops.

| Native 1x comparison | Height MAE, previous → updated | Half-rise overlap, previous → updated |
| --- | ---: | ---: |
| [Natural plateau](/private/tmp/nanolathe-map-editor/agent-landform-improve/review/02-plateau-natural.png) | 13.131 → 14.018 | 73.8% → 73.4% |
| [Desert mesa](/private/tmp/nanolathe-map-editor/agent-landform-improve/review/07-mesa.png) | 13.384 → 13.479 | 74.7% → 74.1% |
| [Ramp](/private/tmp/nanolathe-map-editor/agent-landform-improve/review/08-ramp.png) | 0.521 → 0.521 | 98.0% → 98.0% |
| [End taper](/private/tmp/nanolathe-map-editor/agent-landform-improve/review/10-end-taper.png) | 6.554 → 2.551 | 86.7% → 89.6% |

**[Measured]** MAE is authored-height error in height units, sampled every 2 art pixels over the union affected by either final stroke (>1 unit relative to the prefix). Overlap is intersection-over-union above half the larger rise over that prefix. The ramp's prefix plateau is separately rendered and subtracted. These are the same measurements as round one. The natural-outline scores are slightly worse; the change is a visual improvement judgment, not a closer numerical reproduction of the old random outline.

## What changed

**Natural edge — existing controls.** Wander now moves the radial outline around both sides and the free end caps. Previously it shifted the signed cross-distance, leaving the end caps comparatively regular and allowing faces to fold across the path. The new displacement fades toward the drawn crest. Broad scallops carry smaller notches using the engine's shared shape-noise functions. Width variation still scales the section; Variation size and the foot/middle weights still control scale and distribution. No new variation control or world-specific branch was added.

**[By eye]** The chosen plateau setting has stronger lobes and indentations while preserving its flat cap. The mesa's bands follow a less regular shoulder, though the outer apron still develops small lobes and the dedicated tool has a different face-width rhythm. This is not an exact reproduction. Three tuning cycles were used: broad noise alone remained too smooth; the strongest mixed-scale setting made the mesa too jagged; the final settings reduce wander and width variation while retaining the mixed scales. No further tuning was done on the validation seeds.

**Crest taper — reused control.** Landform now exposes the existing **Crest taper (both ends)** control, default 0%. It narrows and lowers the main trunk near both ends, multiplying the existing along-height curve. Spurs retain their own taper. A click has no path ends to taper and keeps its full section. No width-curve editor or second taper slider was added.

**[Measured]** At 80%, the ridge's half-local-crest widths at the start / middle / end are **54 / 110 / 54 px**, compared with **54 / 106 / 54 px** for the dedicated ridge and **110 / 110 / 110 px** before. Average height error falls **61.1%**. The updated crest is 113.99 at the midpoint versus 110.25 for the original; endpoint crests agree within 0.08 units. The dedicated tool interpolates its taper across ridge pieces, while landform evaluates a smooth along-path taper. The remaining center mismatch is visible in the native sheet.

**Smooth route — one new control.** **Smooth route**, default 0%, writes the existing shared route and protection fields. At 100% the center suppresses surface relief, cracks and debris and resists weathering; the shoulders blend into the terrain. It also writes on already-level ground. Rendering, weathering and export consume the same fields as existing routes: there is no tool-specific draw/bake branch or separate CPU shape path.

![Ramp surface detail at native 1x](/private/tmp/nanolathe-map-editor/agent-landform-improve/review/ramp-detail-1x.png)

**[By eye]** The smooth strip now resembles the dedicated ramp much more closely. The join and shoulders still differ slightly. **[Measured]** Authored height error stays at 0.521 units, because this control changes route/protection behavior rather than the authored ramp grade. The established 16 px block-impact calculation reports visible changes in **15.5% of grass-slope blocks** (4.2% registration noise floor) and **6.8% of rock-face blocks** (2.8% floor) across the full image. Flat blocks do not change. Within the fixed corridor bounding the whole ramp, the corresponding shares are 16.6% and 12.1%. These are image/block measurements, not a unit-pathfinding test.

## Matched parameters

All values are the panel's units; existing curves and all other settings are preserved from round one except the taper's along curve. The exact scenes are `repro/comparisons/landform/*-improved.json`, in the ordinary scene format. `*-dedicated.json` and `*-landform.json` preserve the first round.

| Case | Updated values |
| --- | --- |
| Plateau | Wander 85 px, width variation 35%, height variation 1, size 210 px, foot weight 90%, middle weight 150% |
| Desert mesa | Wander 75 px, width variation 30%, height variation 1, size 210 px, foot weight 100%, middle weight 150% |
| Ramp | Smooth route 100%; Flatten to, elevation 104, diameter 120 px, the previous cross-section and along curve |
| End taper | Crest taper 80%; along curve reset to constant 1, elevation 114, diameter 260 px, the previous cross-section |

The tuned numbers belong to the comparison fixtures; tool preset defaults have not been retuned. Existing landform saves with nonzero wander/width variation will acquire the new outline interpretation. The new route and taper options default to zero. Clean landforms and all dedicated tools keep their old behavior.

## Verification

**[Measured]** All checks use the final implementation unless otherwise stated:

- `repro/all.sh` and `repro/compare.py --worlds none`: all **27** standard scenes are pixel-identical to main (mean difference 0, moved pixels 0%). The [Green](/private/tmp/nanolathe-map-editor/agent-landform-improve/out/retail-review/green.png) and [Desert](/private/tmp/nanolathe-map-editor/agent-landform-improve/out/retail-review/desert.png) retail/before/after sheets were inspected across all three windows; they preserve the existing retail match.
- Four final comparison captures report full replay mismatch **0**; colored tile checks differ by **0, 0, 0, 1** pixels, within the existing 16-pixel tolerance. Regional replay of all four, the branching-ridge comparison, and `green-landform.json` reports **0 mismatches across every plane**.
- Clean plateau and clean mountain PNGs, clay PNGs and authored-height samples match the first-round main captures **byte for byte**. Repeated updated natural-plateau and smooth-route captures also match their final captures byte for byte.
- All **40** unit tests pass; `repro/gate.sh` passes. The **47** curve/control interaction checks pass in each of Green and Desert, including selected-node edits, independent undo, save/reload and matching reloaded height fields.
- Smoke checks pass for all **16 brushes in all 9 worlds**. All **8 exportable worlds** export a retained landform with route 80% and taper 65%; Zhon remains intentionally nonexportable. Green and Desert 8×8 paging, drawing and undo pass.
- The landform shape sweep measures crest-taper impact at **15.11 height units**, about **21%** of the fixture's 71-unit rise. Wander, width variation, height variation, size and both weights move **3.67–9.65 units**, all above 5% of that rise. The targeted rendered-control audit across all nine worlds reports **99 rows, 0 unexpected zero effects, 0 hidden controls moving the image, and 0 unexplained results**. The route's block-impact measurements are above. Existing unrelated ledge/jitter results were not changed.
- Three alternating main/updated performance pairs, with other task browsers closed, keep median drag frame P95 at **16.7 → 16.7 ms**. Median first-picture latency is **16.5 → 16.6 ms**; median P95 latency is **17.7 → 18.1 ms**. Median release-to-weather-ready increases **110.5 → 133.3 ms** (+22.8 ms); ranges are 104.4–110.7 and 100.9–137.5 ms. This small sample establishes responsive dragging, not a zero-cost shader change. The benchmark uses a 4×4 map and the normal landform brush; route and taper are off for the drag.

The 12 additional-seed captures use seeds **2702 and 2717**, with the selected parameters held fixed. [Open the three-column seed sheet](/private/tmp/nanolathe-map-editor/agent-landform-improve/review/seeds-overview.png). **[By eye]** The increased edge variation carries across the seeds; the mesa apron remains busier and more lobed than the dedicated tool. The natural changes should be reviewed on that tradeoff, not accepted on overlap metrics alone.

## What is still open

**[By eye + source inspection]** Keep the dedicated ramp for now. Smooth route solves the rendered travel-strip gap, but landform still needs an explicitly fitted absolute elevation and along curve. It does not automatically sample both endpoints or readjust its grade when the prefix terrain changes as the ramp does. Retiring it requires a decision about that authoring workflow, not another surface-noise slider.

**[By eye]** Crest taper fills the specific end-width gap demonstrated here; the center can still be fitted further using the existing along curve. More variability controls are not justified by this round. The plateau and mesa still need the owner's visual judgment, and the changed natural outlines need broader retail-based fitting before declaring equivalence. The 27 standard retail-window scenes are regression checks, not proof that converting those scenes to landform improves their retail match.

No tools were retired, no world material settings changed, and nothing was merged into main. Evidence (renders, heights, measurements, logs, scripts, and native sheets) stays outside Git at `/private/tmp/nanolathe-map-editor/agent-landform-improve`.
