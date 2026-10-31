# Terraform tool and pipeline audit

2026-10-31 · review branch `audit/tools-and-pipeline` · baseline `c4b1b8027b9622f87e8b4fa97c6b5999d847df40`

**Recommendation:** keep the artist-authored shape graph, consolidate the tool palette, repair disconnected controls, and take the two exact performance improvements. Keep approximate algorithm replacements as experiments until their visual compromises are approved. Nothing in this branch has been merged or pushed to main.

The default output is unchanged in all 27 comparison windows: every captured pixel and every sampled height matched the baseline exactly. This is a preservation result, not a claim that the default biomes now look closer to retail. The meaningful visual changes occur when using repaired controls. The separate visual report contains the retail/before/prototype images, repaired-control comparisons, UI screenshots, candidate algorithms, timings, and searchable ledgers.

## Scope and evidence

- **417 default parameters inventoried:** 251 registered world controls, 114 registered shape controls, and 52 additional preset/compatibility parameters.
- **753 world-control measurements:** three reference-shaped windows for each of the 251 controls, with recorded dependencies. These are sensitivity tests, not 753 independent fidelity approvals.
- **299 shape/control combinations**, plus 135 basic-control/tool cases, 14 conditional retests, and all 15 underlying terrain operations. All 15 operations changed the appropriate output fields; no non-finite output was found in the shape sweep.
- **118 conditional world-control measurements**, including nonzero operating ranges; **50 internal-parameter** comparisons and **30 additional surface/legacy-control** comparisons. Ground-source controls were compared separately before and after.
- **27 complete reference scenes** before/after, **54 approximate-algorithm image comparisons**, and warm interleaved timings on one scene from each of the nine preset families.
- **36 exact feature-placement comparisons:** 30 timed before/after pairs plus six mixed-fill, overlapping-region, existing-deposit and alternate-seed cases.
- **40×40 map probe:** 400 distributed shapes; four distant 1024-pixel windows and five edits with 512 MiB GPU / 2048 MiB heap budgets. Separate feature-fill tests also use a 40×40 play rectangle.
- **22 Node tests pass.** Browser checks cover drawing modes, selected-shape conversion, undo, search, fine controls and dependency explanations. A 2×2 playable-map export passed TNT/OTA/archive self-check: 1,003 unique tiles / 1,188 slots, two starts.

`controls.csv` and `controls.json` contain the exhaustive parameter ledger: generic display label, stored key, range, decision, retail feature rationale, experiment-ledger provenance, measured sensitivity, and caveats. `workflow-controls.json` covers the remaining brush basics, feature placement, editing, navigation, colours, presets, documents, graphics budgets and export controls. `measurements.json` contains the raw numeric evidence. It does not contain retail pixels.

The reference scenes remain `repro/scenes/*.json`. Retail images come from the existing H12b map comparison sheet in the local preparation workspace; their provenance was not replaced by newly chosen examples. The three Zhon comparisons use the existing **third-party section reference**, not retail Total Annihilation. That distinction is explicit in the visual report.

## Changes in the prototype

| Change | Reason and evidence | Compatibility / decision |
| --- | --- | --- |
| Four shore-pocket controls now read live world values | `frostGaps`, `frostGapReach`, `frostGapSize`, `frostGapDepth` previously read startup defaults. All four produced zero image change. The explicit needle-shore fixture now responds: 21.1%, 24.2%, 20.5%, 7.2% of coarse blocks at endpoints; 16.9%, 13.5%, 18.0%, 1.9% within the tested operating range. | Replay geometry and refinement when edited. Default scene images remain identical. |
| Mineral-detail contrast now updates during editing | `mineralDetail` was assigned once during renderer initialization. Before: zero live response. After: 16.1% endpoint / 9.6% operating blocks in Red, and 30.2% / 27.5% in Ice. | Same formula and default; live uniform update repaired. |
| Face edge / gully rock placement table now refreshes | Scalar values changed, but the table used to place materials stayed frozen. `faceEdge` and `gullyRock` now update both generated and bridged materials; `rockOrder` also updates its placement-table contribution. | Responses are small/conditional: Green endpoint maximum RGB differences 104 and 148, mean RGB changes 0.323 and 0.172. These remain fine controls, not headline controls. |
| Global strata spacing now scales authored zone widths | Preset per-zone widths overrode `strataSpacing`, making it inert in the tested Desert scenes. The global control now scales those widths relative to the preset reference. | Before: zero. After: 10.1% endpoint / 6.1% operating blocks. Preset ratios and default output remain exact; a saved world edit cannot become its own new reference on reload. |
| Ground texture choices honor the requested source | The generated-ground path always rebuilt its own material-table ground, ignoring the requested bitmap source. Two different source choices could produce the same unintended result. Explicit sampled texture or borrowed ground source now loads that source. | Default generated ground is unchanged, verified separately. Existing source selectors become truthful; no new texture algorithm. |
| Erase-all clears the four newer local-style masks | It cleared planes 0–13 but missed 14–17. A painted local style could survive an apparent erase. | CPU preparation test and actual GPU mask check: the four center bytes changed from 127 to 0 after erase. |
| Skip empty fluid work in dry refinement | At rain zero, flux, water, exchange and carry contribute nothing. Thermal settling and final map production still run. | Exact heights and map bytes at 256², 512² and 768²; rain-one control is unchanged. No quality setting added. |
| Bound feature sampling to brush/lasso regions | A small brush sampled every terrain cell on a 40×40 map. Region bounds now constrain terrain sampling, region construction and candidate gathering. | Exact placement equivalence; only complete footprints inside the original region remain eligible. Flood still computes full connectivity. |
| Reject feature candidates before sorting | Density/clustering acceptance is a pure cell-and-seed decision. Sorting rejected candidates wastes CPU and memory. | Accepted candidates retain exactly the same placement order and deterministic mix. |
| Check margins against deposits once | Every candidate previously scanned all previously placed features to find deposits. A fill only adds trees, foliage or rocks, so the deposit list can be collected once. | Existing start/deposit clearances are preserved; mixed-fill regression includes an existing deposit. |
| Retire four disconnected sand-transport controls | `sandReach`, `windStrength`, `sandPatchy`, `sandTail` have no runtime consumers in the current pipeline. They were zero in all tested contexts. | Removed from UI; saved keys remain readable. Ripple direction stays because it still drives ripple orientation. |
| Retire ineffective fringe texture selector | Both source images exist, but the shared renderer binds one bridged fringe layer; switching `fringeStyle` changed no pixels. | Hide the selector, preserve stored values. Procedural fringe amount/reach/variation remain. No speculative alternate fringe algorithm added. |
| Park broad crevice darkening | Experiment 4 explicitly left it off because it darkens whole faces rather than drawing useful crevices. Its large measured effect does not rescue its retail usefulness. | Hidden from the UI; old recipes preserve their value. Reconsider only with new target evidence. |
| Consolidate the tool palette | Separate rounded/peaked ridges, deep/shallow water, and material/sand/ground-cover painting cluttered the palette despite belonging to coherent actions. | 17 buttons become 13, including Select and Features. Underlying algorithms and old shape kinds remain compatible. |
| Use explicit drawing modes | Ridge form, water action and surface action use named choices. Form/profile/network/shore-structure mode sliders become dropdowns. | Selected shape mode changes are undoable and preserve paths, parameters and seed. |
| Hide overridden or irrelevant shape parameters | Examples: classic settled ridge foot controls, non-matching faceted-form options, shore material dependencies, explicit profile widths overriding relative widths, and outline lobes overridden by foot variation. | Availability depends on features and modes, never biome identity. Conditional tests distinguish bypasses from dead algorithms. |
| Organize world controls by process | Five stages, generic group/parameter names, search, and an explicit fine-controls toggle. Search includes fine controls and explains known inactive dependencies. | 110 primary controls / 243 total in World; three palette controls are in Graphics. Four disconnected world controls and the parked crevice-darkening control are absent. Primary is a proposed presentation tier, not blanket fidelity approval. |
| Reduce preset-management clutter | Keep biome/variant selection close; collapse custom preset management and remove duplicated heading/help space. | Existing preset creation/import/export/reset actions remain available. |
| Use behavior names | Examples: Pillow crust, Slope cups/ribs/folds, Mineral faces, Cap & face finish, Needle lines, Shore pockets, Faceted forms, Local relaxation. The OTA checkbox reads Molten terrain. | Historical keys remain for recipe compatibility. Presets and asset catalogues can still identify their source world. |

## Recommended tool set and organization

| Area | Proposed controls | Why it earns its place |
| --- | --- | --- |
| Select | Whole-shape transform; edit/insert/delete path points; extend/add path; delete; visibility; order | Artist authors the composition and can revise it. Multiple paths join inside one shape; independent shapes remain ordered operations. |
| Features | Deposits, starts, individual catalogue assets, tree/foliage/rock fill | These produce gameplay/export objects, not baked terrain detail. Keep them separate from shader boulders. |
| Plateau | Classic or explicit cross-section | Flat tops, cliffs, buttes, mesas and controlled terraced forms in retail references. |
| Ridge | Rounded or peaked mode | Shared authoring intent, distinct silhouettes. Do not replace the settled ridge formula yet. |
| Ramp | Endpoint-constrained graded connection | An explicit traversable connection is not equivalent to smoothing an arbitrary hillside. |
| Raise/lower | Signed local height offset | Direct artist correction and composition over existing ground. |
| Crater | Bowl/rim/apron, sector/gap structure, satellites, ejecta, optional facets | Existing retail lunar/red examples and artist requests; seed remains an independent parameter. |
| Fissure | Path cut or fracture-network mode | Real height cuts and authored long features; distinct from thin surface crack shading. |
| Faceted forms | Shards, column mound, planar blocks | One family for angular forms, with only relevant parameters shown for each construction. |
| Water | Deep channel or shallow area/passage | Related placement actions with different height/connection guarantees. |
| Smooth | Local smoothing | Artist correction; retain separate from global refinement and micro-relief. |
| Reset ground | Restore base/clear terrain in a footprint | Distinct from lowering or removing a shape from history. |
| Surface paint | Material/local style, sand cover, restore ground cover | One place to paint material masks and regional process overrides. |

The World inspector has **Ground & variation; Relief & rock; Lighting & finish; Materials & surface; Water & shores**. Shape settings describe authored form; world settings describe shared material and procedural behavior. Map settings own dimensions/sea/export metadata. Graphics owns memory budgets and output palette. The existing shape stack remains a shape stack; true groups/layers and override inheritance are still deferred as requested.

The pipeline is still generic: authored geometry and masks → local refinement where useful → relief/material fields → shading and palette → feature overlay/export. No new biome-dispatch algorithm was introduced. Existing biome-dependent resource availability remains: for example, Zhon has no approved retail feature catalogue/export planet. That is a missing asset/metadata decision, not a reason to introduce Zhon-only geometry controls.

## What should merge, remain separate, or be retired

**Merge in presentation now:** rounded/peaked ridges; deep/shallow water actions; material/sand/restore-cover painting; the faceted-form modes; duplicated water-detail headings. Keep each mode's meaningful settings contextual.

**Keep distinct algorithms for now:** geometry terraces versus painted contour bands; fissures versus microcracks; feature objects versus rendered stones; smoothing versus constrained refinement; classic profiles versus explicit cross-sections. Their output domains or constraints differ. Sharing a word such as “rock” or “erosion” is not evidence of redundancy.

**Candidate future consolidation:** boulders/debris could share a distribution/material inspector; repeated ripple, wrinkle, rib and gully controls could share spacing/amount/orientation presentation. Do not unify their kernels until target-class comparisons show equivalent silhouettes and placement. Global and per-shape controls should share vocabulary, but preserve their different scope.

**Remove from the current UI:** the four disconnected transport parameters and the ineffective fringe texture selector. Also park the broad crevice-darkening control: experiment 4 explicitly left it off for darkening whole faces, and it has no later exact-key approval. Preserve its recipe value until a new comparison justifies exposure. Keep legacy fracture/scree/weathering controls hidden rather than reviving them. Do not delete compatibility parsing merely because a control is hidden.

**Fine tuning / quarantine:** very small or conditional controls, including face-edge breakup, gully-rock placement, several joint/bed details and tiny scratch/facet parameters. Their measured pixels justify “live,” not “worth a default UI slot.” The ledger identifies them individually. A fine control should be promoted only after an artist can identify its intended retail feature in a nonzero operating range.

## Algorithm comparisons and performance

### Exact dry-refinement optimization — recommend keeping

Five interleaved warm measurements per implementation, same device and inputs. Times include GPU queue completion; these are not isolated GPU timestamp queries.

| Grid | Rain | Before median | Prototype median | Result |
| --- | --- | --- | --- | --- |
| 256² | 0 | 78.7 ms | 49.9 ms | 1.58× faster; exact |
| 512² | 0 | 423.8 ms | 191.8 ms | 2.21× faster; exact |
| 768² | 0 | 938.4 ms | 414.7 ms | 2.26× faster; exact |
| 512² | 1 | 416.5 ms | 418.6 ms | Same path; timing noise; exact |

This skips computation, not allocations; buffer/memory reduction is a possible follow-up. The dry presets benefit; rainy refinement still warrants attention.

### Exact feature-fill optimization — recommend keeping

Three paired trials per case; deterministic analytic terrain and the actual Green feature catalogue. These isolate placement work from terrain/GPU rendering. They are not total interactive frame times.

| Play size / region | Before median | Prototype median | Output |
| --- | --- | --- | --- |
| 4×4 brush | 32.5 ms | 4.5 ms | Exact |
| 4×4 flood | 30.1 ms | 2.0 ms | Exact |
| 40×40 brush | 502.6 ms | 3.7 ms | Exact |
| 40×40 lasso | 137.5 ms | 0.4 ms | Exact |
| 40×40 flood, sparse density | 973.1 ms | 90.9 ms | Exact |

The 40×40 brush samples 2,035 corners instead of 1,640,961. Full-map flood still scans connectivity. Its sparse-density trial places 271 features; it does **not** establish performance for a dense forest covering the entire map. Dense flood, sprite draw cost, and placement undo memory should be profiled next.

### 16 refinement iterations — do not adopt globally

The trial is 2.8–7.5× faster in warm refinement timings across nine scenes. Across all 27 image comparisons it changes 0–8.15% of whole-window coarse blocks (median 0.63%); Green-2 and Ice-1 are conspicuous enough to reject a blanket default change. Even a small whole-window percentage can cover the entire relevant cliff or shore region.

Keep the current final-quality iteration count. A future interaction preview could use fewer iterations if it always settles to the exact final result and does not mislead the artist about the authored form. No extra artist-facing “geological age” control is proposed.

### Three relief octaves — trial only

Reducing five octaves to three gives 1.04–1.36× faster warm 1024-pixel captures in the nine repeated fixtures. In the 27 image comparisons the coarse-block change is 0–0.98%, median zero, but fine pixels still change. The visual report includes the worst case and representative windows at full resolution.

This is a plausible automatic preview-quality choice, but the gains vary and it has not demonstrated a retail-fidelity improvement. Keep the current final-quality default. Avoid another permanent knob unless the artist has a meaningful quality/cost decision to make.

### Shared cross-section replacement — reject as an equivalent replacement

A bounded fit explored 30 plateau and 90 ridge parameter combinations with the existing shared profile. Best raised-region RMS height errors were **6.40** for Plateau and **17.52** for Rounded ridge; maximum errors were **13.59** and **32.06**. That misses the silhouettes. This is not proof that no exact reparameterization exists; it is enough evidence not to silently replace the classic forms in this pass. Consolidate the UI, preserve both constructions, and use the explicit profile for deliberate authored shapes.

## Slow paths worth deeper work

1. **Cold regional refinement and rendering.** On the 40×40, 400-shape probe, distant first windows took 0.93–1.48 seconds; five edits took 264–522 ms. GPU accounting peaked around 495 MiB under the 512 MiB budget. Bounded editing is viable in this fixture, but cold navigation and settled edits do not yet meet a strong near-real-time goal.
2. **Rainy refinement / iteration count.** The exact dry shortcut does not accelerate the rainy path. Separate the visual benefit of rain/deposition from iterative transport cost using fixed retail target regions before changing its model.
3. **Crater satellites/ejecta and heavily branched ridges.** On the 384² shape microbenchmark, the crater stress case had a 19.1 ms median / 32 ms maximum including readback. The 12-spur/forked/faceted ridge had an 11.2 ms median and a 70.9 ms outlier. These are warning signals, not full-map frame guarantees.
4. **Large coverage effects and material detail.** Relief, cracks, ordered rock, shelves/shore pockets, and broad deposit changes invalidate meaningful regions and can trigger expensive bakes. Measure edit-to-visible and edit-to-settled separately; scalar uniform cost alone is misleading.
5. **Full-map dense feature flood.** Regional brush/lasso costs are much better. Full connectivity and thousands of sprites/placements still need a budget and interruptible scheduling.
6. **Export size and unique tiles.** A small export succeeded. A full 40×40 export was not run. The TNT unique-tile ceiling and detailed procedural output remain constraints; bounded viewport memory alone does not prove export viability.

## Retail usefulness and remaining visual gaps

The audit does not grant blanket approval to every inherited control. Positive sensitivity answers “does it do anything?”; it does not answer “does it make the target better?” Existing `EXPERIMENTS.md` rows provide family-level provenance and explicit kept/rejected history. Where no exact-key evidence exists, the ledger says so rather than inventing approval.

The unchanged comparison sheet still suggests the following priorities by eye:

| Reference family | Most useful next target |
| --- | --- |
| Green | Broader controlled forms and less shaggy/repetitive face detail; material placement on the steepest faces. |
| Archipelago | Reduce craggy/noisy bank character; preserve readable soft contour margins and native transitions. |
| Desert | Refine banded face/apron/cap relationships rather than adding more independent bands. The spacing repair makes existing controls useful. |
| Moon | Fine regolith structure and crater/rim character at retail scale; avoid uniformly smooth forms. |
| Ice | Planar block/facet silhouette and straight fibre character; do not substitute generic roughness for these. |
| Lava | Pillow/crust and scalloped-bank structure; preserve attached coast lobes and readable creases. |
| Crystal | Facet/seam balance and clean angular forms; avoid heavy seams overwhelming the planes. |
| Red | Rock grain, exposed-face placement and controlled angularity; use the repaired material contrast before adding effects. |
| Zhon, third-party reference | Treat as an explicit extension target; do not count it as retail evidence or infer an approved feature catalogue. |

## Measurement limits and interpretation

World sweeps compare 16×16 blocks using mean luminance, luminance spread and mean colour; they also retain pixel differences. A block changes when mean luminance differs by more than 6, luminance spread by more than 4, or the mean RGB vector by more than 8. A two-pixel horizontal / one-pixel vertical displacement noise check is included in the visual report to show why alignment and target masks matter.

These whole-window metrics are screening measures. They are **not** a substitute for the target-class, nonzero-operating-range comparisons required by `TERRAIN_ENGINE.md`. Many initial zeros came from an absent material, an off parent feature, a hard-threshold branch, authored bed overrides, or testing only endpoints of a periodic direction. Conditional fixtures resolved those distinctions. Only source-confirmed unused controls were removed as dead.

All measurements are on this local browser/device. Warm timing repetitions reduce startup noise but do not establish cross-device performance. The 40×40 terrain probe covers four regions and five edits, not every tool at every map size, a full export, an in-game run, seam stress at every boundary, or a dense full-map forest. Raster comparisons cover the 27 fixed scenes, not arbitrary user recipes. No new external simulation model was imported.

## Follow-up priorities

1. **Complete, reproducible documents and world-edit undo.** A sketch records biome/variant but not the full world knob/colour state. Saving the shape graph and separately exporting a world is currently necessary for portability. Make one document carry both, with versioned defaults and history that covers both scopes.
2. **Target-region acceptance tests.** Tag the reference sheet with cliff/shore/ground/crater masks, compare useful nonzero ranges, and attach a keep/reject decision to each remaining fine-control family. Do this before adding new effects.
3. **Edit-latency instrumentation.** Track input-to-preview, input-to-settled, invalidated area, refinement time and cache misses separately. Prioritize the cold regional/refinement path; do not optimize tiny scalar changes blindly.
4. **Playability overlays.** Slope/passability, shallow connections, start/deposit clearance and height clipping would expose map problems that attractive rendering hides. These are recommendations, not silently approved new terrain algorithms.
5. **Full export qualification.** Representative 8×8/16×16/40×40 content, tile-budget behavior, cancellation, and in-game checks. The small self-check is a useful smoke test, not completion of this qualification.
6. **Only then consider true layers/groups.** Group-level parameter overrides need explicit inheritance, precedence and masking semantics. The current shape/path simplification remains appropriate.

## Reproducing the audit

The audit host is separate from normal application serving and binds only to loopback. Private development hooks are injected only into its served script, and activate only on `?audit=1`. Retail assets and screenshots stay outside Git.

1. Preserve the baseline with `git archive c4b1b8027b9622f87e8b4fa97c6b5999d847df40` into a separate directory.
2. Use `repro/audit/inventory.mjs` to extract the baseline registries; `presentation.mjs` records current display names. Reuse the prepared local asset/catalogue directory and original reference images.
3. Start two `repro/audit/server.py` instances with `--source`, `--assets`, `--evidence`, `--out` and different loopback ports. Export helper paths are configurable.
4. Open `/audit/index.html`; use the labeled buttons for scene, world, shape, diagnostic, internal, surface, ground-source, feature, performance and scale suites. The scene start/count controls support bounded reruns.
5. Run `python3 repro/audit/analyze.py --root <evidence-root>` and `repro/audit/report.py` with the project Python environment to rebuild ledgers/media from the captured evidence.
6. Run `node --test repro/*.test.mjs`, syntax checks, and review the branch diff. Do not merge until the owner reviews the visual results.
