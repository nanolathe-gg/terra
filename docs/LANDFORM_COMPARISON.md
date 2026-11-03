# Landform compared with the dedicated tools

Rendered November 3, 2026 from main `dfee4b4`, in worktree `landform-compare`.
This is a comparison dataset and review, with no editor or shader changes.

**[By eye] Keep the specialized tools for now.** The basic plateau and mountain profiles can be matched very closely with existing editable curves. The strongest remaining gaps in these examples are width taper and ramp surface behavior. The natural outlines differ, but those differences alone do not establish that another noise control is needed.

## Visual review

Each pair uses identical path coordinates, stroke seed, prefix terrain, world settings, lighting, and camera. The left column is the dedicated tool; the right is the tuned landform. The overview is reduced to 37.5%. Open the linked individual sheets below for native 1x pixels, with textured renders above and clay below. Clay removes color but retains the renderer's surface relief; it is not a bare height map.

![Six same-stroke comparisons](/private/tmp/nanolathe-map-editor/agent-landform-compare/review/comparison-overview.png)

### Basic profiles

**[Measured]** The clean plateau's mean absolute authored-height error is 0.00034 units. The clean mountain is 0.000000 units in the sampled grid. Both have 100% overlap at half their rise. These are custom curve matches, **not the current landform preset defaults**. The plateau reaches its cap at 44% of its half-section; the mountain carries the old tool's sampled profile.

**[By eye]** The shouldered hill's steep front and long back read similarly, but its end caps differ. **[Measured]** Its mean error is 1.669 units and half-rise overlap is 95.4%. Matching its old 0.66-radius front and 1.34-radius back uses a 320 px diameter and lean 203%. The old hill also settles its shape and treats its ends differently.

[Open the controlled comparisons, including end taper](/private/tmp/nanolathe-map-editor/agent-landform-compare/review/controlled-overview.png).

### Natural outlines, spurs, and mesa

**[By eye]** The natural plateau and mesa retain the right overall form, cap, and face/terrace character. The dedicated tool's scallops, face-width variation, and apron differ visibly from landform's irregularities. The natural hill has a different crest rhythm. The branching ridge preserves the branch arrangement well, with different branch widths, rounded ends, and height detail.

**[Measured]** Half-rise footprint overlap is 73.8% for the natural plateau, 61.1% for the natural hill, 79.9% for the branching ridge, and 74.7% for the mesa. Treat these as positional agreement, not artistic quality scores: equal seeds feed different noise formulas, so identical noise features are not expected.

**[By eye]** Increasing wander and width variation in a second pass made the plateau and mesa too convoluted and broke up the mesa's bands more. The first fits were kept. The hill's second pass matched peak height better but worsened overall agreement; its first fit was kept. The ridge benefited from lower elevation and less variation. **[Measured]** Its error fell from 8.239 to 5.534 units and overlap rose from 69.5% to 79.9%. There were at most two tuning passes per case.

### End taper is a distinct gap

**[Measured]** With roughness off and the crest-height curve matched, the dedicated tapered ridge measures 54 px across at half its local crest rise at both path endpoints. Landform measures 110 px. At the midpoint they measure 106 and 110 px respectively. The endpoint crest heights agree within 0.04 units; the whole affected area's error remains 6.554 units.

**[By eye + source inspection]** Lowering the along-height curve does not also narrow the footprint. One width-along-path or end-taper facility is a strong candidate to replace the dedicated crest-taper behavior. This test supports considering that one addition; it does not justify adding several new shape sliders. See `lineMultipliers` in `sculpt-gpu-fields.js` and `lfShare`/`lfEval` in `engine-shape.wgsl`.

### Ramp: close heights, different surface behavior

**[Measured]** A landform with Flatten to, elevation 104, a flat central cross-section, and an eased along-height curve follows the ramp to within 0.521 units on average; 93.7% of affected samples differ by at most 2 units. Half-rise overlap is 98.0%. The comparison uses a 120 px diameter and zero shoulder roughness to isolate the core behavior.

**[By eye]** The dedicated ramp preserves a smoother travel strip and shoulders. Landform keeps more craggy relief. The difference is clearest in the native-scale clay crop:

![Ramp surface detail at 1x](/private/tmp/nanolathe-map-editor/agent-landform-compare/review/ramp-detail-1x.png)

**[By eye + source inspection]** Keep the dedicated ramp until its endpoint-height sampling and route behavior have an equivalent workflow. `stampRamp` marks the route field; `stampLandform` reduces it. A curve match alone does not preserve this behavior. Whether that belongs in landform or remains a specialized ramp is a product decision, not something these pictures settle.

### Existing terrain

**[Measured]** Simply keeping the empty-ground elevation of 94 on a crossing hill gave a peak of 94 versus the dedicated mountain's 139. After fitting the existing along-height curve with elevation 139, mean error over the final stroke's affected area falls to 0.025 units; every affected sample is within 2 units.

**[By eye]** That fit is close enough to demonstrate that no new shape control is needed for this static example. It does require adapting the along curve to the ground underneath; fixed-elevation landform does not automatically behave like an additive hill when earlier terrain changes. The matched example is deliberately a simple crossing, not evidence that every varying prefix surface is representable this way.

[Open the ramp and existing-terrain comparisons](/private/tmp/nanolathe-map-editor/agent-landform-compare/review/behavior-overview.png).

## Measurements and native-resolution sheets

**[Measured]** Heights are sampled from the editor's authored GPU field every 2 art pixels over the same 1024×1024 window. MAE and P95 are absolute height errors over the union where either final stroke changes the prefix terrain by more than 1 unit. For ramp and crossing, the unchanged prefix is separately rendered and excluded; the rest use the flat base of 24. “Within 2” uses that same mask. Overlap is intersection-over-union above half the larger maximum rise over the prefix. These are field comparisons, not exported TNT height bytes, visual scores, or pass/fail retirement criteria.

| Comparison / native 1x sheet | Mean error (units) | P95 (units) | Within 2 units | Half-rise overlap |
| --- | ---: | ---: | ---: | ---: |
| [Plateau / controlled](/private/tmp/nanolathe-map-editor/agent-landform-compare/review/01-plateau-clean.png) | 0.0003 | 0.00 | 100.0% | 100.0% |
| [Plateau / natural edge](/private/tmp/nanolathe-map-editor/agent-landform-compare/review/02-plateau-natural.png) | 13.1308 | 45.49 | 36.5% | 73.8% |
| [Shouldered hill / controlled](/private/tmp/nanolathe-map-editor/agent-landform-compare/review/03-hill-clean.png) | 1.6691 | 7.33 | 73.1% | 95.4% |
| [Shouldered hill / natural](/private/tmp/nanolathe-map-editor/agent-landform-compare/review/04-hill-natural.png) | 9.7960 | 27.25 | 21.1% | 61.1% |
| [Mountain ridge / controlled](/private/tmp/nanolathe-map-editor/agent-landform-compare/review/05-mountain-clean.png) | 0.0000 | 0.00 | 100.0% | 100.0% |
| [Mountain ridge / spurs and tapered crest](/private/tmp/nanolathe-map-editor/agent-landform-compare/review/06-ridge-spurs.png) | 5.5341 | 18.12 | 31.8% | 79.9% |
| [Desert mesa / stepped face](/private/tmp/nanolathe-map-editor/agent-landform-compare/review/07-mesa.png) | 13.3840 | 37.67 | 29.7% | 74.7% |
| [Ramp / climb onto plateau](/private/tmp/nanolathe-map-editor/agent-landform-compare/review/08-ramp.png) | 0.5205 | 2.51 | 93.7% | 98.0% |
| [Mountain / across existing terrain](/private/tmp/nanolathe-map-editor/agent-landform-compare/review/09-crossing.png) | 0.0254 | 0.13 | 100.0% | 100.0% |
| [Ridge / end taper only](/private/tmp/nanolathe-map-editor/agent-landform-compare/review/10-end-taper.png) | 6.5536 | 19.68 | 29.7% | 86.7% |

## Parameters and replay

All examples keep sea 0, base 24, seed 2701, and procedural ground undulation off. Green is used except the Desert mesa. The two scenes with earlier terrain share identical prefix strokes and their own fixed seeds. Main's world material and weathering settings are used. The examples are synthetic and contain no retail map pixels or height data.

The landform matches carry custom cross-section knots in the existing `curve` format. The hill unlinks its back; the mesa compresses its profile into 70% of the half-width; the ramp uses a section that reaches full influence at 45% of the half-width. The ridge, ramp, crossing, and end-taper cases also carry `along` knots. Landform uses Raise to except the ramp, which uses Flatten to. Percent-style values below are the existing panel's units, e.g. lean 203 means 2.03×.

| Scene | Main landform settings |
| --- | --- |
| 01-plateau-clean | diameter 300, elevation 94, lean 100, wander 0, widthVary 0, heightVary 0, varySize 160 |
| 02-plateau-natural | diameter 300, elevation 94, lean 100, wander 42, widthVary 28, heightVary 1, varySize 160 |
| 03-hill-clean | diameter 320, elevation 94, lean 203, wander 0, widthVary 0, heightVary 0, varySize 160 |
| 04-hill-natural | diameter 320, elevation 94, lean 203, wander 38, widthVary 20, heightVary 15, varySize 160 |
| 05-mountain-clean | diameter 300, elevation 114, lean 100, wander 0, widthVary 0, heightVary 0, varySize 160 |
| 06-ridge-spurs | diameter 220, elevation 108, lean 100, wander 8, widthVary 10, heightVary 5, varySize 120 |
| 07-mesa | diameter 400, elevation 114, lean 100, wander 38, widthVary 20, heightVary 1, varySize 160 |
| 08-ramp | diameter 120, elevation 104, lean 100, wander 0, widthVary 0, heightVary 0, varySize 160 |
| 09-crossing | diameter 260, elevation 139, lean 100, wander 0, widthVary 0, heightVary 0, varySize 160 |
| 10-end-taper | diameter 260, elevation 114, lean 100, wander 0, widthVary 0, heightVary 0, varySize 160 |

The exact dedicated and landform settings, cross-sections, along curves, points, and seeds are in `repro/comparisons/landform/*-dedicated.json` and `*-landform.json`. They use the existing repro scene format and renderer. Start an owned server according to BACKLOG, then, for example:

```sh
node repro/render.mjs repro/comparisons/landform/08-ramp-dedicated.json "$OUT/ramp-dedicated" --server "$SERVER" --port "$CDP" --sea 0
node repro/render.mjs repro/comparisons/landform/08-ramp-landform.json "$OUT/ramp-landform" --server "$SERVER" --port "$CDP" --sea 0
# Repeat with --clay for the neutral material view.
```

`query: "sea=0"` is also stored in every fixture so regional replay uses the same absolute datum.

## Verification, limits, and next decision

**[Measured]** 20 final scene renders reported full replay mismatch 0. Their standard colored tile checks differed by 0–1 pixels, within the renderer's 16-pixel tolerance over 1,048,576 pixels. Five repeated standard-render captures matched the original PNG bytes exactly. Four regional checks (branching ridge, mesa, ramp, end taper) reported 0 mismatches across all planes. All 40 unit tests passed. `repro/gate.sh` passed with its identifier list unchanged.

An early capture wrapper ran the tile check after switching to clay and got 17 differing clay pixels in one hill image. The wrapper was corrected to run the standard colored check before switching views; that scene then reported 0 colored tile differences. The original result remains in the scratch log.

No production render code, controls, or presets changed. Consequently this is not a visual regression of main and no all-world before/after guard, control-impact sweep, performance benchmark, or export/smoke suite was run. Exported traversability and ramp route behavior still need explicit validation before retirement. Retail quality comparisons across the three windows of each world and additional seeds remain open; these screenshots answer dedicated-tool equivalence, not retail fidelity. No tool was removed or new knob added.

**[By eye] Suggested order:** first save calibrated old-shape equivalents as ordinary landform presets; then review a single width/taper replacement; preserve or port ramp semantics; finally compare natural variations across seeds and retail windows. These examples do not demonstrate a need for another dedicated hill/plateau/mesa tool or more random-variation knobs.

Local evidence: `/private/tmp/nanolathe-map-editor/agent-landform-compare`. It includes original 1024 px images, clay images, height samples, serialized nodes, tuning rounds, measurements, render and verification logs, and the capture/sheet scripts. Renders remain outside Git. The comparison branch is for review and has not been merged to main.
