# Shape interaction performance prototype

Review branch: `perf/shape-interaction`, based on `d0d2296`. Worktree: `/private/tmp/terraform-interaction-perf`. This pass is not merged or pushed.

The primary change is to preserve detailed images and update only their dirty dependencies. The renderer now treats drawing, shape transforms, path-point edits and shape-control edits as live interactions. Fit view gets an actual terrain rendering instead of the old height-color thumbnail.

## Why editing was expensive or misleading

1. **Fit deliberately bypassed detailed rendering.** The canvas used a 128×128 CPU height thumbnail with a mean ground color. Zooming to fit could never reveal materials or surface detail, regardless of GPU performance.
2. **Invalidation removed images immediately.** A changed tile disappeared until its replacement arrived, exposing the coarse background and making progressive drawing flash between unrelated detail levels.
3. **Every tile allocation discarded reusable resources.** Identical texture dimensions, meshes, buffers and bind groups were rebuilt repeatedly. The original Green drawing measurement spent 357 ms building 45 meshes in a roughly one-second gesture.
4. **Only canvas pointer gestures counted as editing.** Range inputs and cross-section curves fell behind the “wait for refinement” gate. They changed the shape graph but produced no fresh preview tiles while the user dragged a control.
5. **Whole-map refinement invalidated the entire image cache.** A local shape edit could force distant, unchanged terrain to render again when refinement finished.
6. **Scheduling favoured the center repeatedly.** A stream of pointer events interrupted the tile list after its first job. Other dirty visible tiles could wait indefinitely behind the center.
7. **Diagnostics became map-sized work.** Paged-field statistics scanned the entire coarse-coverage array on every query: about 1.7 million cells at 40×40, repeated by memory accounting and rendering.
8. **Refinement depended on a previous render.** Its rock-column spacing and tilt uniforms were initialized only by relief baking. The first refinement could differ from a repeated refinement with no shape changes. A rendered Fit exposed this ordering dependency; the shared column initializer now sets these uniforms explicitly.
9. **Cached images were presented twice.** The canvas first painted all retained images together, then revisited them one by one, redrawing overlays and map boundaries for each. This scaled with the visible tile count despite there being nothing new to display.

## Changes and reasoning

| Change | Purpose and tradeoff |
|---|---|
| Keep stale bitmaps and mark them dirty | Preserve a useful picture until a fresh tile is ready. A dirty image is never considered a completed render. |
| Invalidate by each tile's input region | Includes shader, shadow and height-projection aprons, not just the visible output rectangle. A nearby shape can affect a tile without crossing its output boundary. |
| Retain a completed in-flight preview | Show useful completed work even if a newer input arrived; keep it dirty and schedule the latest revision. |
| Compare refinement fields on the GPU | Compare old/new height planes, packed maps and optional material fields. Read back only a small tile bitset; invalidate tiles whose dependencies overlap changed field blocks. Comparison is exact, without a tolerance that could hide a small edit. |
| Respect paged refinement's existing dirty region | Paged worlds retain their local shape/weather mechanism. Whole-map comparison is used for the non-paged refinement path. |
| Preview slider and curve edits | Reuse the existing reduced-resolution tile renderer during input, defer expensive readback/refinement until release. No extra artist-facing quality control. |
| Reuse GPU allocations | Retain matching working textures, depth/output surfaces and bind groups. Every bake still refreshes the fields that changed. |
| Cache up to four meshes | Reuse recent region meshes; discard cached meshes before refusing a bake for memory. Geometry and textures stay within the app's accounted budget. |
| Prioritize old visible dirty tiles during editing | Prevent one central tile from monopolizing live updates. Skip off-screen margin bakes until release. |
| Replan on interaction-state changes | Release moves directly to final-quality work instead of finishing an obsolete preview plan. |
| Render Fit with a bounded 512×512 shape lattice | Run the same procedural shape graph and masks, then the shared material shader in screen-sized blocks. Keeps full-map viewing viable without baking hundreds of millions of final pixels. |
| Filter downscaled presentation and palette mixtures | Smooth downsampling and average subpixel two-color palette patterns instead of sampling a fixed checkerboard phase. Full-resolution palette decisions remain unchanged. |
| Bound thumbnail sampling to 3 ms per slice | Avoid the old first-pass allowance of up to 400 ms on the main thread. |
| Count coarse coverage incrementally | Keep statistics inexpensive as the map grows. |
| Paint clean cached tiles once per pass | Avoid redundant terrain/overlay redraws and animation-frame waits. |
| Initialize rock-column inputs before refinement | Remove a pre-existing render-order dependency. The three Green reference scenes change from their initial baseline result to the same result the old app already produced after a second refinement; this is called out separately from performance changes. |
| Keep canonical tile sizing independent of the Fit reserve | Prevent entering Fit from shrinking close-view tiles and increasing the number of subsequent bakes. |

## Cache contract

Authored shape edits invalidate their old and new bounds through the existing regional field notifications. An image becomes dirty when that region intersects its recorded input footprint. Unaffected images remain reusable. A revision log detects edits that arrive while a bake is in flight. Global appearance changes still invalidate all relevant images, since they can change every pixel.

Refinement compares actual field values before publishing its new result. Unchanged blocks do not trigger final rebakes. The comparison bitset is tiny relative to the fields, but the comparison itself still reads the whole non-paged field; it does **not** make the refinement algorithm incremental. Paged worlds already recompute local windows on demand.

Fit images use authored fields without the final refinement pass. Derived-field-only invalidation therefore does not discard them. Authored edits and material changes still invalidate Fit images. Fit and close-view cache entries are distinct.

## Limits and next investigations

- Fit is a display approximation, not an export preview at full resolution. Tiny forms, sharp cliffs and final weathering/material deposition can differ. Zooming in or exporting uses canonical fields and rendering.
- Live editing shows reduced-resolution tiles; the displayed shape/material transitions converge after release. A fresh tile completion is not a whole-viewport frame.
- Final refinement remains a noticeable post-release cost. The next algorithmic target is its fixed iteration count and local dependency radius, with visual comparisons before changing its output.
- Four retained meshes are a bounded cache, not a complete cache of every view. Panning into new regions still creates resources and performs GPU work.
- The Fit field normally occupies about 16 MiB in these fixtures; this prototype reserves 64 MiB conservatively in the terrain budget. That reserve could be tightened with explicit transient accounting.
- Measurements are one-machine application tests with synthetic input, not hardware-to-display latency or a cross-device performance guarantee. Raw cached-paint counts are deliberately not presented as FPS.

See the adjacent README for reproduction steps and the accompanying visual report for measurements and comparison images.


## Recorded results and verification

The 40×40, 90-input Fit drawing test took **13.53 seconds before and 1.52 seconds after** (8.9× shorter). Frame p95 fell from 216.7 to 33.7 ms while the prototype displayed rendered terrain. The prototype settled in 165 ms after release and peaked at 347 MiB of accounted terrain memory within a 512 MiB budget. The baseline Fit did no detailed rendering, so its 73 ms release time is not comparable final-quality work.

At 4×4, Green drawing rebuilt 40 meshes before and 9 after; CPU mesh work fell from 183 to 85 ms. During the slider phase, the baseline produced zero fresh tile results while input was active; the candidate produced 16–21 across the three tested scenes. At 8×8, the Green slider's frame p95 improved from 33.4 to 18.3 ms. Close-view cadence is not uniformly faster, and final refinement still takes roughly 0.4–0.75 seconds for some edits. These are single-run measurements; `results.json` records all twelve interaction rows, not just the improvements.

Distant edits changed **zero visible cached tiles** in all three cache fixtures. At 4×4, two off-screen margin tiles rebuilt because their dependency aprons overlap the edit; at 8×8 and 40×40 none rebuilt. Retained images versus forced full redraws had maximum channel difference **0** in all three fixtures.

Final reference verification: **24/27 initial images are pixel-for-pixel equal**, and all 27 sampled authored-height grids are equal. The three Green initial images differ by mean absolute RGB 0.81–1.73/255 because of the initialization bug described above. Each candidate is pixel-identical to the old app after a second refinement. Repeating refinement on the candidate changes zero pixels in all three Green scenes.

Validation also includes 29 passing Node tests, the live GPU dirty-field fixture, JavaScript syntax checks, Python compilation and `git diff --check`. Normal pointer interactions in the standalone app were checked for drawing, moving and cross-section knot dragging; the resulting rendered Fit view is saved in the review screenshot.

Local review: <http://127.0.0.1:8909/> (comparison report), <http://127.0.0.1:8908/sculpt?biome=green&mapX=4&mapY=4&scratch=interaction-review> (prototype). Durable report files, images and raw evidence are in `/Users/daniel/.codex/visualizations/2026/10/31/01a18f70-7ff3-7c53-ad0a-419df8071add/interaction/`.


## Preview color and American English follow-up

The previous reduced-resolution preview averaged material textures before nonlinear material coverage and palette quantization. This changed the color distribution even with identical settled terrain and weather fields: Green gained green and lost warm tones; Red shifted toward purple. The comparison fixture isolates render resolution from weathering by baking both resolutions from the same state, then separately captures moving and released states.

The fix keeps native material variance through coverage, lighting and palette mapping. Relief keeps its inexpensive preview lattice; the color raster evaluates up to four native samples per cached pixel and downsamples only the resulting colors. At larger zoom-out levels, deterministic native-pixel samples avoid locking onto one phase of a repeating texture or dither pattern. Raster spacing and relief spacing now have separate shader uniforms. Allocation keys, budget estimates and resident memory accounting include both the larger raster and the smaller cached output. Final resolution follows the same sampling path as before.

In Green-2, mean chromatic bias magnitude fell from 4.14 to 0.41 (90%); in Red-2 it fell from 8.00 to 0.026 (99.7%), in RGB units on a 0–255 scale. This metric is the Euclidean norm of mean RGB error with its neutral component removed; it measures broad color balance, not all perceptual differences. Green retains a small brightness offset from coarser relief. Preview shape, lighting and weathering can still refine after release.

There is additional GPU color work. A fresh same-machine comparison against commit `153fd4b` kept 40×40 Fit-drawing frame p95 at 25 ms; active drawing time changed from 1.074 to 1.115 seconds and peak accounted GPU memory from 346 to 347 MiB. Green 4×4 drawing/dragging frame p95 stayed near 9 ms. Fresh tiles during those input sequences changed from 33/38 to 29/31; the slider and path-point cases also completed fewer fresh tiles. The updated draw/drag cases produced about 35–37 fresh tiles per second, not whole-viewport FPS. Full rows are in `color-results.json`; these are single-run results.

User-visible labels, help, accessible names, preset descriptions and export messages now use American English: color, center, gray, neighbor, labeled and canceled. The document language is `en-US`; the README records this as the project convention. Serialized data and API identifiers retain compatibility.

Validation: 29 Node tests pass; one final reference from every biome (nine scenes) is pixel-identical to the preceding prototype. The cache fixture still matches a forced redraw with maximum channel difference 0. JavaScript syntax, Python compilation and diff whitespace checks pass. Normal standalone drawing and moving were checked, including visible Center / Colors labels.

Review the [color comparison](http://127.0.0.1:8909/color-preview.html) and [updated prototype](http://127.0.0.1:8908/sculpt?biome=green&mapX=4&mapY=4&scratch=color-review). The visual report includes final / previous preview / updated preview images, the performance tradeoff and an editor screenshot.
