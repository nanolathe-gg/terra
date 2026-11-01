# H21 Impacts, part 1

Baseline: main `28e623d` (H19 and the three earlier handoffs landed). Inventory reads `sculpt.py` KNOB_DEFAULTS, WORLD_KNOBS, WORLD_VARIANTS, ENGINE_KNOBS; `sculpt.js` SHAPE_FIELDS and scriptedScene; the GPU preparation, bake and draw readers. No Impacts key occurs in ENGINE_KNOBS. Numbers below are engine units; a card's displayed percentages/tenths are converted before use. Unlisted worlds inherit the default. `=` denotes an explicit world entry equal to the default, not evidence of activity.

## Inventory

| Control | Default; explicit worlds / variants | Actual reader and result | Overlap / gate |
|---|---|---|---|
| craterlets | 3; Moon 6 | sculpt.js craterletSpot/regional bounds; sculpt-gpu-fields.js prepareNode generates satellites | Repeats crater stamps, with satellites' facets and recursive children disabled |
| craterEjecta | 0; Moon .7 | prepareNode ejecta → engine-shape.wgsl craterStamp | Throw-out outside rim; distinct from satellites |
| rimHeight | .34 | prepareNode rimH → craterStamp; rim spurs' height | Rim share of depth, not bowl depth |
| rimSectors | 0 | craterRim → rimFactors/craterStamp | Lopsided sectors; geometry, not surface folds |
| rimUnequal | .6 | craterRim sector radii/heights | Only meaningful with sectors |
| rimGaps | 0 | craterRim → rimFactors | Missing rim arcs, distinct from fissure cuts |
| rimGapWidth | 70 | craterRim gap half-width | Only meaningful with gaps |
| craterFacets | 0; Crystal 1 | prepareNode facetMode → facet job in engine-shape.wgsl | Shares plane-fitting pipeline with iceFacets (Bodies); do not fold crystal cells/slabs into Impacts |
| crystalCraterPx | 0; Crystal 16 | prepareNode facet width | 0 means radius-derived size; craterFacets gate |
| crystalCraterStep | 3; Crystal 1 | facet job fcStep | Facet height offsets; same pipeline as Ice, different parameters |
| crystalCraterSkin | 0; Crystal 1 | facet job fcSkin; fragment craterSkin | Marks crater with .74 crystal-field value; distinguishes it from columns/slabs/seams |
| crystalCraterWeb | 0; Crystal 1 | sculpt-renderer.js draw uniforms → engine-frag.wgsl craterWeb | Thin Voronoi seam on crater skin; crystal cells are Bodies' separate field |
| crystalCraterWebPx | 14; Crystal 18 | craterWeb | Cell size, skin/web gate |
| crystalCraterWobble | 0; Crystal 4 | craterWeb | Warps web position, not crater geometry |
| crystalCraterGap | 0; Crystal .25 | craterWeb / crater skin shading | Fraction of missing seams, skin/web gate |
| crystalCraterTone | 0; Crystal .12 | craterWeb / crater skin shading | Per-cell brightness, skin/web gate |
| crystalCraterLight | 1; Crystal 1.6 | fragment crater skin shading | Crater light/dark contrast, skin gate |
| pockmark | 0; Moon =0; Moon pitted 1, cracked =0 | draw uniforms → pockPits; fragmentMain | Dark elliptical pits on landforms; shares lattice idea with cups/slope marks, not their lighting |
| pockSize | 5; Moon 7.5 | pockPits | Pit spacing/size; pockmark gate |
| moonCups | 0; Moon 1; pitted/cracked 0 | draw uniforms → moonCups; fragmentMain | Lit bowl normal/cavity; overlaps pockmarks in placement, preserves bright cup walls |
| moonCupSize | 5.5; Moon 6.5 | moonCups | Cell spacing / bowl radius; cups gate |
| moonCupDepth | 1.4 | moonCups | Bowl gradient; cups gate |
| moonRibs | 0; Moon 1; pitted/cracked 0 | draw uniforms → moonRibs; fragmentMain | Fine stretched derivative-noise relief on shaded slopes |
| moonRibDepth | 1; Moon .9 | fragmentMain normal perturbation | Relief depth; ribs gate |
| moonRibDark | 0; Moon .15 | fragmentMain ribs multiplier | Extra shade-facing darkening; ribs gate |
| moonFolds | 0; Moon .55; pitted/cracked 0 | draw uniforms → moonFolds; fragmentMain | Height-contour lines on gentle slopes, not rib noise |
| moonFoldSpacing | .9 | moonFolds | Separation of two contour bundles; folds gate |
| moonLobes | 0; Moon .5; pitted/cracked 0 | outlineUniforms → outlineShift; sculpt.js and GPU bounds | Whole hill/mountain outline (including crater child spurs); shares outlineShift with baseVary already, distinct profile/wavelengths |
| worms | 0; Moon/Lava =0; Moon cracked .4 | bake uniforms → engine-bake.wgsl bake, wormDark | Two noise-ridge height/trough terms; Impacts owns H17 stray; surface mark, not an authored fissure |
| wrinkles | 0; Moon =0, Lava .6; Moon cracked .8 | draw uniforms → wrinkleLines; fragmentMain | Joined contour wrinkles/pits; Impacts owns H17 stray; cubic noise vs ribs' quintic derivative noise |
| slopeMarks | 0; Moon =0 | draw uniforms → slopeMark; fragmentMain | Jittered ellipse, dark centre/light flanks; Impacts owns H17 stray |

All 31 keys remain. Twelve have shape-card controls: craterlets, craterEjecta, the five rim controls, craterFacets, the three crystalCrater geometry/skin controls, moonLobes. The nine crystalCrater controls are inventoried despite not starting with `crater`, because they implement the crater's skin. Shared spur/crest controls belong to Shapes; crackSeverity and fissure authoring belong to Fractures. Crystal cells, frost, ice slabs and iceFacets belong to Bodies (H20).

The engine paths are feature/kind gated, never world-ID gated. `moon*`, `crystal*` and comments naming a world are legacy identifiers, not runtime planet selection. A geometry control's query affects new tool defaults; an authored card wins, and scriptedScene's top-level options win over that card. The sweep follows that order and touches the appropriate strokes. Crater spurs are child hills that inherit their parent crater's outline settings, even though the crater panel does not show moonLobes; the control and substitution checks include that reader.

## What draws on moon-2

`repro/scenes/moon-2.json` contains 17 strokes, none a fissure. The central deep crater (520,500; diameter 100, depth 90) requests seven long spurs, crestJag .6 and crestVary .5, but no satellites or ejecta. It sits on the large low hill at (505,545). Other craters have their own satellite counts. The baseline Moon enables cups 1, ribs 1, folds .55, lobes .5 and H19 faceRelief .5. It has crackSeverity 0, worms 0, wrinkles 0 and pockmark 0. Thus radial ridges belong to crater spurs, while cup/rib/fold marks are surface detail; neither is a long authored fissure. H17's crackSeverity .35 experiment altered surface cracks, not the missing scene strokes. That distinction must survive part 2.

## Same-idea groups and proposed merge

1. **Surface relief lighting (selected):** cups and ribs duplicate cast-shadow visibility, original diffuse light, perturbed diffuse light and the ambient/diffuse ratio. Shine uses the identical visibility term. Consolidate the shared arithmetic in fragmentMain while preserving each feature's gates, clamps and cavity/tone terms. This is the largest exact common expression group in the in-scope draw blocks; verify all 27 pixel buffers, plus a deliberately changed Moon control as the nonzero comparator.
2. Pockmarks, cups and slopeMarks each traverse a 3×3 jittered lattice, but their hashes, coordinate frames, density gates, bowl profiles and lighting differ. A generic kernel would need alternate paths/parameters and would not shorten this work. Keep pending owner decisions; not a justification to remove a look.
3. Wrinkles/ribs/worms/folds share the broad intent of regolith marks but use different coordinates and interpolation (cubic vs quintic derivatives; height contours vs world/pixel noise). Combining them moves pixels; outside this exact merge.
4. moonLobes/baseVary already share outlineShift. baseVary has priority, is capped at .15 radius, uses fixed 55/21 px wavelengths and foot-only support; moonLobes reaches .5 radius with radius-scaled three-octave noise across the face. baseBump only raises the lower face. Reproduce H15's 22/2.5 substitution before a keep/combine ruling.
5. Crater facets and Ice facets already share the facet job; crater skin's web and Bodies' crystal cells have different field ownership and gates. No new parallel path or cross-card edit.

## Evidence and checks

Results are appended by the following commits. Assets: `/private/tmp/nanolathe-map-editor/agent-H21`; reproducible numeric reports only are committed, never retail images or height arrays.

### Measurement method

The normal sweep moves each effective scene value to KNOB_DEFAULTS. Shape targets override authored cards in engine units, including inherited crater-spur lobes; absent eligible strokes print `=` and do not vote. The precedence fixture (query .1, card .2/.4/.1, top-level .3 on the first scene) reports .3/.4/.1. Shores' state enumeration remains byte-identical to archived main.

The `impact` class is dry relief at least 1.5 units above **or below** the plain, so crater bowls count; it also includes unrelated hills, conservatively diluting small crater effects. `fold` is dry slope .025–.60; other regolith marks use the existing slope >=.10 class with its 40-pixel margin. These height-grid masks approximate displayed projection and do not isolate individual crater skin pixels. Reported 5% crossings are this screening rule, not proof of a useful control across its range. Small moves back to defaults are not min/max tests.

The existing shifted-image noise check (2 px horizontally, 1 vertically) gives these changed-block percentages on baseline windows 1/2/3:

| World / class | Shift floor % |
|---|---|
| Moon / impact | 17.30 / 23.04 / 23.71 |
| Moon / slope | 22.60 / 34.33 / 32.92 |
| Moon / fold | 15.23 / 15.51 / 18.25 |
| Red / impact | .59 / 2.64 / 5.24 |
| Crystal / impact | 23.47 / 27.89 / 14.29 |
| Lava / slope | 9.17 / 11.39 / 7.95 |

These dense textures do not inherit Green's historical 1–3% floor. In particular, a geometry control may move many pixels just by re-registering texture. No zero or weak row authorizes deletion, and no sweep row is claimed visually closer to retail.

### Control sweep results

38 states, all 31 keys, 123 renders (including 9 conditional baselines), zero replay mismatches and empty console logs; every sweep exit 0. Raw data: [impacts-controls.json](impacts-controls.json). Base runs use archived main's 27 renders. All three windows are measured even where a class/control is absent. `=` means no eligible stroke or already at target; `|` separates authored values within one scene. The gated rim fixture holds sectors 4 and gaps 2 on crater strokes. Pitted/cracked fixtures select the named Moon variant, leaving their other parameters intact. The wider rib-depth probe is .9→0.

**Zero first:** Moon pockSize 7.5→5 is exactly inactive with default pockmark 0; under the pitted variant it moves 32.6/27.7/28.6% of the class. No control is proved globally dead. **Under 5% in every H21 probe:** craterlets (Moon and Red), crystalCraterStep/WebPx/Wobble/Gap/Tone/Light, rimUnequal. moonRibDepth .9→1 is under 5%, but .9→0 moves 17.2/8.0/12.6%; do not call it weak across its range. Several above-5% results remain below the registration floor above; no visual usefulness claim follows from this threshold alone.

Values and measurements are window 1 / 2 / 3. Rows are sorted zero, below threshold, then above threshold; MAD is mean absolute RGB difference, moved is pixels with max-channel difference >8, class is majority 16-pixel blocks. No preset or scene value is committed.

| Run / world | Control: effective → target | MAD | Pixels moved % | Class | Class share % | Blocks changed % | 5% |
|---|---|---|---|---|---|---|---|
| sweep / moon | `pockSize`: 7.5/7.5/7.5 → 5 | 0.00/0.00/0.00 | 0.00/0.00/0.00 | impact | 76.61/33.37/42.94 | 0.00/0.00/0.00 | under |
| sweep / crystal | `crystalCraterGap`: 0.25/0.25/0.25 → 0 | 0.10/0.00/0.00 | 0.29/0.00/0.00 | impact | 46.70/45.61/37.60 | 1.25/0.00/0.00 | under |
| sweep / crystal | `crystalCraterLight`: 1.6/1.6/1.6 → 1 | 0.20/0.00/0.00 | 1.28/0.00/0.00 | impact | 46.70/45.61/37.60 | 2.04/0.00/0.00 | under |
| sweep / crystal | `crystalCraterStep`: 1// → 3 | 0.57/0.00/0.00 | 2.86/0.00/0.00 | impact | 46.70/45.61/37.60 | 3.03/=/= | under |
| sweep / crystal | `crystalCraterTone`: 0.12/0.12/0.12 → 0 | 0.08/0.00/0.00 | 0.58/0.00/0.00 | impact | 46.70/45.61/37.60 | 0.00/0.00/0.00 | under |
| sweep / crystal | `crystalCraterWebPx`: 18/18/18 → 14 | 0.56/0.00/0.00 | 1.98/0.00/0.00 | impact | 46.70/45.61/37.60 | 2.98/0.00/0.00 | under |
| sweep / crystal | `crystalCraterWobble`: 4/4/4 → 0 | 0.17/0.00/0.00 | 0.69/0.00/0.00 | impact | 46.70/45.61/37.60 | 0.05/0.00/0.00 | under |
| sweep / moon | `craterlets`: 2\|0/1\|0\|6/0 → 3 | 0.89/0.63/0.53 | 2.81/1.64/1.31 | impact | 76.61/33.37/42.94 | 3.25/2.85/1.88 | under |
| sweep / moon | `moonRibDepth`: 0.9/0.9/0.9 → 1 | 0.23/0.07/0.11 | 1.59/0.51/0.78 | slope | 53.81/23.61/29.37 | 0.00/0.00/0.00 | under |
| rim-gates / moon | `rimUnequal`: 0.6/0.6/0.6 → 0 | 3.00/1.00/0.80 | 15.44/4.88/4.01 | impact | 71.85/31.69/40.33 | 3.02/4.39/2.78 | under |
| sweep / red | `craterlets`: 0// → 3 | 0.06/0.00/0.00 | 0.34/0.00/0.00 | impact | 61.82/47.17/13.96 | 0.36/=/= | under |
| sweep / crystal | `craterFacets`: 1// → 0 | 2.17/0.00/0.00 | 7.59/0.00/0.00 | impact | 46.70/45.61/37.60 | 14.69/=/= | yes |
| sweep / crystal | `crystalCraterPx`: 16// → 0 | 1.14/0.00/0.00 | 4.98/0.00/0.00 | impact | 46.70/45.61/37.60 | 6.64/=/= | yes |
| sweep / crystal | `crystalCraterSkin`: 1// → 0 | 1.04/0.00/0.00 | 3.09/0.00/0.00 | impact | 46.70/45.61/37.60 | 9.41/=/= | yes |
| sweep / crystal | `crystalCraterWeb`: 1/1/1 → 0 | 0.49/0.00/0.00 | 1.60/0.00/0.00 | impact | 46.70/45.61/37.60 | 5.91/0.00/0.00 | yes |
| sweep / lava | `wrinkles`: 0.6/0.6/0.6 → 0 | 0.37/0.59/1.04 | 2.79/4.07/7.15 | slope | 34.35/29.59/46.66 | 4.26/12.46/12.56 | yes |
| sweep / moon | `craterEjecta`: 0.7/0.7\|0/0\|0.7 → 0 | 2.80/0.87/0.15 | 13.19/4.47/0.80 | impact | 76.61/33.37/42.94 | 14.09/4.02/0.17 | yes |
| sweep / moon | `moonCupDepth`: 1.4/1.4/1.4 → 0 | 1.43/0.49/0.64 | 6.22/2.15/2.91 | slope | 53.81/23.61/29.37 | 5.67/1.86/2.16 | yes |
| sweep / moon | `moonCupSize`: 6.5/6.5/6.5 → 5.5 | 4.88/1.71/2.35 | 12.18/4.28/6.03 | slope | 53.81/23.61/29.37 | 32.03/26.16/30.42 | yes |
| sweep / moon | `moonCups`: 1/1/1 → 0 | 2.52/0.92/1.19 | 7.00/2.51/3.39 | slope | 53.81/23.61/29.37 | 35.30/34.23/34.83 | yes |
| sweep / moon | `moonFoldSpacing`: 0.9/0.9/0.9 → 1.8 | 3.27/1.90/1.79 | 15.72/9.34/8.78 | fold | 59.79/48.49/43.75 | 17.11/6.19/9.10 | yes |
| sweep / moon | `moonFolds`: 0.55/0.55/0.55 → 0 | 3.54/2.00/1.97 | 16.33/9.29/9.06 | fold | 59.79/48.49/43.75 | 48.18/36.71/36.61 | yes |
| sweep / moon | `moonLobes`: 0.5/0.5/0.5 → 0 | 5.86/1.37/4.01 | 23.04/6.14/12.17 | impact | 76.61/33.37/42.94 | 27.50/10.90/25.98 | yes |
| sweep / moon | `moonRibDark`: 0.15/0.15/0.15 → 0 | 1.17/0.38/0.58 | 7.33/2.41/3.66 | slope | 53.81/23.61/29.37 | 16.79/12.72/16.96 | yes |
| rib-depth / moon | `moonRibDepth`: 0.9/0.9/0.9 → 0 | 2.77/0.86/1.28 | 11.32/3.67/5.44 | slope | 53.81/23.61/29.37 | 17.20/7.96/12.55 | yes |
| sweep / moon | `moonRibs`: 1/1/1 → 0 | 2.92/0.93/1.37 | 11.70/3.91/5.70 | slope | 53.81/23.61/29.37 | 21.19/14.48/20.12 | yes |
| pitted / moon | `pockSize`: 7.5/7.5/7.5 → 5 | 12.68/4.93/6.37 | 24.21/10.04/12.10 | impact | 76.17/33.18/42.92 | 32.60/27.67/28.61 | yes |
| pitted / moon | `pockmark`: 1/1/1 → 0 | 8.09/3.19/3.98 | 14.70/6.21/7.26 | impact | 76.17/33.18/42.92 | 70.51/59.01/61.09 | yes |
| sweep / moon | `pockmark`: 0/0/0 → 1 | 7.42/3.01/3.70 | 14.34/6.20/7.17 | impact | 76.61/33.37/42.94 | 69.63/57.57/59.98 | yes |
| rim-gates / moon | `rimGapWidth`: 70/70/70 → 140 | 2.37/0.77/0.61 | 11.69/3.73/2.95 | impact | 71.85/31.69/40.33 | 6.39/4.85/3.57 | yes |
| sweep / moon | `rimGaps`: 0/0/0 → 2 | 4.22/1.67/1.11 | 20.63/7.69/5.17 | impact | 76.61/33.37/42.94 | 14.24/10.61/6.54 | yes |
| sweep / moon | `rimHeight`: 0.34/0.34/0.34 → 0 | 7.08/5.02/1.91 | 32.48/15.96/8.24 | impact | 76.61/33.37/42.94 | 33.91/34.38/15.46 | yes |
| sweep / moon | `rimSectors`: 0/0/0 → 4 | 4.73/1.82/1.19 | 23.83/8.53/6.00 | impact | 76.61/33.37/42.94 | 8.00/9.07/5.80 | yes |
| sweep / moon | `slopeMarks`: 0/0/0 → 1 | 2.37/0.92/1.16 | 6.04/2.25/3.00 | slope | 53.81/23.61/29.37 | 33.17/22.65/24.77 | yes |
| cracked / moon | `worms`: 0.4/0.4/0.4 → 0 | 3.87/1.80/2.15 | 22.00/10.53/12.27 | slope | 53.81/23.41/28.81 | 28.81/25.86/28.73 | yes |
| sweep / moon | `worms`: 0/0/0 → .4 | 4.17/1.87/2.29 | 23.61/10.98/13.01 | slope | 53.81/23.61/29.37 | 52.04/44.26/48.71 | yes |
| cracked / moon | `wrinkles`: 0.8/0.8/0.8 → 0 | 4.07/1.48/2.22 | 15.25/5.75/8.19 | slope | 53.81/23.41/28.81 | 52.31/44.11/51.95 | yes |
| sweep / moon | `wrinkles`: 0/0/0 → .8 | 4.13/1.53/2.29 | 14.69/5.78/8.04 | slope | 53.81/23.61/29.37 | 50.27/41.88/51.87 | yes |
