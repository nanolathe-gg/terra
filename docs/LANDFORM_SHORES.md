# Landform shores — November 3, 2026

The reviewed shore prototype lands from `landform-shores`, including the requested sea-relative height and consolidated Steps controls. Current main `78c0685` is merged. This adds shore capability to the existing landform tool; specialized tools remain available. No backward-compatibility work is required. Rendered images, retail references and height samples remain outside Git.

## Result

**[By eye]** Shores work as inverted landforms. Smooth cuts already receive shallow/deep water shading from bed depth. A shelf in the section makes a genuinely flat shallow bed. For lava, the shared shoreline ledges and fingers preserve the recognizable layered apron substantially better than ordinary profile terraces alone. No new shape parameter was needed for these examples.

**[Implementation]** Landform now supplies the existing coastal footprint, runs the same finger/contour/circular-layer passes as Deep/Shallow, and carries the existing per-stroke water appearance fields. Bounds and regional read dependencies include the coastal reach. Shore effects start off on ordinary landforms. The inspector now shares one step count, flat share and variation control across profile, shoreline and circular-shoreline references. No new renderer, tool, page, save format or world-name branch was added. Shore plates remain unexposed and unqualified on landform.

| Intent | Existing landform settings |
| --- | --- |
| Excavate a basin | Cut to, elevation below sea, positive 0–1 section |
| Continuous shore / depth-colored water | Smooth section; shallow/deep materials follow bed depth |
| Physical shallow shelf | Flat section segment near sea − 7, followed by a drop to sea − 55 |
| Shallow area over land or an existing deep bed | Flatten to sea − 7 |
| Shallow passage that leaves higher ground intact | Raise to sea − 7 |
| Lava bank | Smooth cut plus shared shoreline layers; Fingers as desired |

Depths above are fixture choices, not universal constants. Choose **Height reference → Sea level** and enter a negative height for the depth below water. The target then follows the map's sea level. Fixed elevation remains the default for ordinary landforms.

## Completed: height reference and consolidated steps

**[Implementation]** Height reference reuses the Elevation slider. Fixed elevation stores the absolute target; Sea level stores its offset from the current sea. Switching reference converts the number and preserves the existing target and other authored values. The GPU and section/along previews resolve the same target; save, undo and export use the existing stroke recipe.

**[Measured]** A target of −55 relative to sea yields a center depth of **55.0 units** at sea **0, 75 and 255**. Across all 262,144 authored samples, the greatest discrepancy after subtracting sea level is **0.00001523 units**. Fixtures `08-sea-relative-*` exercise all three levels.

**[Implementation]** Steps now has one **Steps follow** choice: Profile, Shoreline or Circular shoreline. One count, flat share and step-variation set drives the selected existing pass; a landform never runs both step systems. Profile permits 0–8 steps and 0–90% flat share; shoreline modes permit 0–12 and 40–95%. Switching mode clamps only incompatible values, as one undoable edit. Breakup appears for profile steps; shoreline width/riser and circular details appear only when applicable. The four duplicate landform shore count/ledge/variation/style rows are gone. Fingers remain independent.

**[Measured]** All **13** reviewed landform shore renders remain pixel-identical after re-authoring their parameter representation. The **27** maintained scenes also remain pixel-identical. No visual retuning was needed for these two completions.

**[Measured, 1x control impact]** **21 control/mode cases** qualify at ≥5% of a visible surface class, above the 2 px × 1 px translation floor. The measurements use `measure/impact.py`'s unchanged 16 px block thresholds. Green provides the profile/general cases; Lava provides the three weak shore cases. For opaque Lava, submerged pixels are excluded before choosing each block's majority class, since the bed slope is not visible through lava. Shared flat share changes **35.11% / 44.81%** of the dry-bank gentle-slope class in contour/circular modes (floors **1.58% / 0.39%**); circular step variation changes **5.31%** (floor **0.70%**). This qualifies useful ranges on representative settings, not a 5% guarantee on every scene: circular variation on the busier reviewed finger fixture is subtler, **4.32%** of the dry-bank slope class (floor **2.52%**). [Impact measurements](/private/tmp/nanolathe-map-editor/agent-landform-shores-land/impact-summary.json).

## Matched strokes

**[Measured setup]** Twenty fixtures in `repro/comparisons/landform-shores` hold paths, seeds, lighting and sea level fixed within each comparison. Dedicated strokes render on unmodified main; landforms render on this branch. Captures are 1024 × 1024 at 1x. The following overviews are half-size; native sheets are linked below. Wander and Width variation use landform's own noise, so the same seed does not imply an identical shoreline.

![Green and Archipelago: dedicated, smooth cut, shelf cut](/private/tmp/nanolathe-map-editor/agent-landform-shores/water-overview.png)

**[By eye]** Green's smooth cut preserves the shallow/deep distinction without geometry steps; the shelf makes the light band wider. Archipelago also works with a smooth depth gradient, while the shelf version has a wider, calmer shallow bed. The irregular outlines are comparable in character but differ in location. This first fit has not optimized every bank or shallow-band width.

![Lava: dedicated, profile steps, shore contours, contours plus fingers; flat and overlapping on a hill](/private/tmp/nanolathe-map-editor/agent-landform-shores/lava-overview.png)

**[By eye]** Ordinary profile steps produce a narrow, regular bank. Shore contours retain the broad layered apron around the actual waterline, including the joined cuts on a slope. Fingers add connected land tongues that outline variation alone does not reproduce. The circular variant also retains the scalloped bank structure.

[Water at native resolution](/private/tmp/nanolathe-map-editor/agent-landform-shores/water-native.png) · [Lava at native resolution](/private/tmp/nanolathe-map-editor/agent-landform-shores/lava-native.png) · [Lava bank details at 1x](/private/tmp/nanolathe-map-editor/agent-landform-shores/lava-detail-1x.png) · [Circular ledges](/private/tmp/nanolathe-map-editor/agent-landform-shores/circular-native.png) · [Shallow passage](/private/tmp/nanolathe-map-editor/agent-landform-shores/passage-native.png)

**[Measured]** In the passage pair, both center beds are **−7.0**. The largest authored-height difference across 262,144 samples is **0.001945 units**; on the 16 px lattice it is **0.001248 units**. The displayed/eroded samples have the same bound in this fixture. This demonstrates the geometry match for this passage; it is not a gameplay pathfinding qualification.

**[Measured]** With natural variation enabled, wet-mask intersection-over-union is **79.1%** for Green smooth, **72.0%** for Archipelago smooth, **75.2%** for flat lava with fingers, and **76.4%** for lava fingers across the hill/overlap. These quantify outline differences, not an artistic pass/fail. With variation disabled, the water-field pair has **100% wet-mask overlap** and **0.185 height-unit mean error** over the union of wet samples. Raw comparison numbers are in [metrics.json](/private/tmp/nanolathe-map-editor/agent-landform-shores/metrics.json).

## All three retail windows

The nine authored variants under `retail-windows/` replace only Deep/Shallow strokes; other shapes, paths, order and seeds are preserved. They use a first-fit smooth section, existing coastal feature values, diameter adjusted for the dedicated Bank width, and roughness translated into landform variation. Dedicated and candidate captures both use sea 0; the extra dedicated captures avoid comparing different map sea settings. These are authored comparison fixtures, not runtime converters.

[Green: all three windows](/private/tmp/nanolathe-map-editor/agent-landform-shores/retail-green.png) · [Archipelago: all three windows](/private/tmp/nanolathe-map-editor/agent-landform-shores/retail-archipelago.png) · [Lava: all three windows](/private/tmp/nanolathe-map-editor/agent-landform-shores/retail-lava.png)

**[By eye]** Lava 1 keeps its layered coast and fingers; Lava 2 keeps the circular ledges; Lava 3 retains the broad channel silhouette. The unrelated hill/rock mismatch to retail remains in both builds. Green 1/3 retain the water treatment but shift the coastline; Green 2 has no water strokes and is a control. Archipelago 1 retains its lit shallows but changes the island silhouette and small notches; 2/3 need further outline/bank calibration. These sheets support shared coastal features, not a claim that every preset now matches retail or that the specialized tools can be removed today.

## Landing checks and deferred checks

**[Measured, after merging main `78c0685`]**

- **27** maintained renders match the refreshed baseline pixel for pixel; world-name gate passes with an identical identifier list.
- **46** regional cases (27 maintained, 13 shore, three sea levels, three transformed/disconnected paths): **zero mismatches across all 31 fields**.
- **144** brush/undo cases, **8** exports and **9** 8x8 paging/undo cases pass. Zhon export remains disabled by design. No console errors.
- **44** unit tests pass. The landform shape sweep has **24** probes, **18** applicable, and no dead applicable control. The affected control audit passes **567** stroke rows across all nine worlds, with no dead or hidden-moving rows and no console errors.
- Before the main merge, the broader audit including water fields passed **648** rows, and Green/Lava/Desert passed **65** real-editor assertions each (**195** total). All 13 re-authored comparison images matched the reviewed prototype exactly.

**[Deferred by explicit owner instruction]** The owner requested landing and skipping the remaining checks. The post-merge editor rerun and separate water-field rerun were stopped; final alternating performance runs were not completed. The post-merge comparison rerun stopped on the overlapping-contour fixture: its saved image and full replay match, but **65 pixels** differed between tile sizes while several GPU suites ran concurrently (guard limit **16**). An isolated rerun is still needed; concurrency is an unconfirmed explanation, not a diagnosis. The first eight saved comparison images match the pre-merge images exactly. The original prototype timing numbers below are historical and do not claim a completed final-build performance qualification.

Final evidence root: `/private/tmp/nanolathe-map-editor/agent-landform-shores-land`; refreshed baseline: `/private/tmp/nanolathe-map-editor/agent-landform-shores-land-baseline`. Private probes and the exact impact analysis are retained under `scripts/`. No evidence pixels, heights, exports or retail-derived files are committed.

## Original prototype validation

**[Measured]**

- All **27** existing scene renders are pixel-identical to main (`repro/all.sh`, `repro/compare.py --worlds none`).
- All **20** matched captures and **18** sea-matched retail-window captures: zero full-replay mismatch and zero console errors. Tile-size differences: at most **3 pixels**, below the existing 16-pixel rasterization tolerance.
- **13** landform comparison fixtures pass forced regional replay with **zero mismatches in all 31 fields**. Three additional transformed/disconnected-path cases cross regional boundaries and also have zero mismatches.
- **56 real-editor assertions per world** pass in Green and Lava, including actual coast-height changes, selected-node edits, undo and autosave/reload. The default-height assertion now reads the declared map plain, since a sampled point can contain generated ground undulation.
- **48 brush/undo cases**, **3 exports** containing landform shore strokes, and the **3** 8x8 paging/undo cases pass (Green, Archipelago, Lava). The 8x8 tests do not export a full large map.
- **41 unit tests** pass; the world-name gate passes with an unchanged identifier list. The landform shape sweep runs **22 probes**, with **16 applicable controls**, zero dead applicable controls and zero console errors.
- Targeted rendered-control audit: **138 rows**, including **45 landform shore rows**, zero dead rows, hidden-moving rows or console errors. This is the existing response audit, not a new class-based 5% impact certification of the final inspector.
- Three alternating 304 px lava-shore timing pairs: median drag-frame p95 **16.8 ms for both**. Median release-to-weather **102.2 → 109.7 ms**; release-to-final-visible-view **414.5 → 415.0 ms** (dedicated → landform). Both strokes enable Fingers 100, Lobe size 65 and 11 shoreline layers. This compares representative shore tools, not identical geometry. See [timing summary](/private/tmp/nanolathe-map-editor/agent-landform-shores/perf-summary.json).

Evidence root: `/private/tmp/nanolathe-map-editor/agent-landform-shores`. `scripts/capture.mjs`, `scripts/regional-transformed.mjs` and `scripts/perf-shores.mjs` there retain the private capture/timing probes used for these measurements. Reproducible scene rendering also works with the repository's `repro/render.mjs` (`--sea 0`); regional checks accept each committed fixture directly. `repro/smoke.mjs --shore` exercises a real shore rather than an ordinary raised landform.

## Before retiring Deep/Shallow

**[Proposal / unfinished]**

Items 1 (sea-relative height) and 2 (step consolidation and impact qualification) are completed above. The remaining retirement work is:

3. Tune presets and re-author maintained scenes against retail, with explicit shelf and bank widths where needed. This round has not matched the dedicated shelf-noise model exactly.
4. Qualify shore plates for Crystal/Ice, route/protection and material fields after overlapping edits, sea-level edits, and exported height behavior on more terrain. Deep strokes clear protection while landform supplies its profile protection; the near-exact shallow passage does not prove all these fields agree.
5. After review and full retirement checks, replace maintained tool use and delete the old paths together. No old-save migration or compatibility renderer is needed. This landing removes no tools.
