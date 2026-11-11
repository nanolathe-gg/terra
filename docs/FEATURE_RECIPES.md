# Shared feature recipes

Feature presets from every material table are available in the existing Features
panel on every world. The catalog contains 82 measured presets plus the two
shared default deposit/vent painters. The table remains the source of each
preset; `sculpt.py` includes the same catalog in development and static builds.

Choose a kind, open **Add a preset**, and add a recipe. Each recipe has its own
name, shape settings, colors, seed and variants. **Duplicate recipe** creates an
independent copy. Selecting a recipe limits manual placement and Random to that
recipe. Fill mixes the recipes of its selected kind. Editing a recipe updates
its placed instances and participates in the editor's existing undo history.
Remove a recipe after removing its placements; keep at least one per kind.

**Shape and surface** exposes plant dimensions, foliage density, crown roughness,
tendril curl, rock height/flatness/size/pitting/grain, scar size/density, vent size,
and wood color. Tree shapes can retain the recipe's original mixture or be
changed to broadleaf, conifer, tendril, dead broadleaf or dead conifer. Controls
that do not apply explain why. Foliage and stone colors are independent per
recipe; all features use the destination world's light and game palette.

## Artist controls

Recipes now expose more of the procedural shape and material model:

- Trees, shrubs, and rocks have independent height and width variation (0–60% either
  side of the nominal size). A blank field retains the preset's variation;
  zero fixes that dimension for each source shape in the recipe. Variation is
  deterministic across the recipe's variants. Editing height variation preserves
  the existing width distribution, and vice versa. Adding variants does not
  redraw earlier ones.
- Broadleaf canopies can use a full crown, separate leaf clusters, or arching
  palm fronds. The tree-shape selector also retains conifers and dead trees.
  Exposed trunk raises the canopy; existing taper, peaks, roughness, density,
  dimensions, and wood color continue to apply where meaningful.
- Tendrils expose count (1–16), nominal length (12–100 px), base thickness
  (1.2–10 px diameter), curl, and independent length/thickness variation.
  Render bounds include the bulbs even when only one arm grows from them.
- Trees, tendrils, shrubs, and rocks have an independent second color, its
  coverage, and patch size (2–24 px). Soft, seeded camouflage patches mix the
  colors before world lighting and palette quantization. Tree wood retains its
  separate color. Zero coverage is the same material at zero blend weight.
  A tiny positive value cannot abruptly replace the surface. Pattern size is
  disabled, with a reason, when coverage is zero or 100%.

These edits use the existing recipe/undo/save/export flow. The shape controls
are in **Shape and surface**; the two-color controls sit together below it.
Variation changes the finite set of recipe variants, rather than introducing
fresh random geometry for every placement. A mixed preset can still contain
several nominal source shapes; use an individual catalog preset to author one
shape family.

## Persistence and placement

The existing map `featureSet` now stores, per kind, `{nextId, recipes}`. A recipe
copies its source data and stores editable overrides, rather than looking up its
appearance in the destination biome. Each recipe has an immutable numeric ID.
Variant addresses reserve 16 slots per recipe ID, so changing another recipe's
count or order cannot redirect existing placements. A kind supports 32 recipes
with up to 16 variants apiece. Deleted recipe IDs are not reused.

When a count is reduced, placements using a removed variant choose a remaining
variant of the same recipe, preferring the same footprint. Any resulting
footprint changes must fit the map and avoid other features; generated fill
features also retain their terrain and spacing constraints. An invalid edit is
rejected as a whole. Appearance edits do not revalidate terrain beneath an
unchanged footprint.

Recipes travel with the working map across world changes, and with map saves and
share links. Creating a custom world captures the current recipes as its starting
set. Existing world-file export/import also carries that set. A saved map's own
recipes take precedence over world defaults. No additional save format, storage
key, undo stack, endpoint or drawing path was introduced. Old feature-set options
are not migrated, following the repository's pre-release save policy.

Passability and export resolve the same stable addresses as the preview. Burning
successors remain attached to their shape. Export successor seeds do not depend
on which recipe is selected in the panel.

## Initial recipe validation

Measured during implementation:

- All 82 catalog presets round-trip through all nine worlds: 738 combinations.
- All 34 terrain scenes match the branch baseline byte for byte.
- The seven existing feature look controls move 47.0–96.7% of their measured
  classes. The 17 newly exposed form/wood controls move 21.0–99.1%; all exceed 5%.
  `measure/feature_recipe_controls.mjs` measures those new controls at 1x and
  exits nonzero below 5%, using the same 4-pixel block criteria as the existing
  feature-control measurement.
- Browser coverage imports Red tendrils and Lava rocks into Green, independently
  colors duplicated recipes, changes variant counts, rejects a conflicting
  footprint, fills and undoes a mixed collection, reorders and reloads recipes,
  switches to Moon, and exports them. Custom-world defaults and actual world-file
  export/import round trips also pass.
- Unit coverage checks stable placement addresses, independent edits, source
  gameplay overrides, passability footprints, and preview/export burn parity.

The `land` tier passed: 178 unit tests, the world-name gate, 34 unchanged scenes,
regional replay, voxels, all-world smoke with `--page8`, features, passability,
and shape repeat. `measure/shape_controls.mjs` and the all-world geology sweep
both exited 0. The geology report still marks some unchanged terrain controls
below 5%; no terrain generators were tuned in this work.

All three standard export-byte cases (Green 4, Lava 8, Red 16) produced matching
browser-module/Wasm and native hashes on both repetitions. The additional Chrome
case containing six feature kinds also matched both `.ufo` and indexed PNG bytes
across two browser exports and the native exporter.

Interaction measurements used `repro/perf.mjs map4 --features 10 --no-export`
on Green-2, alternating baseline, recipes, baseline, recipes. Each map contained
389 generated features. Times are milliseconds; two runs do not establish a
speedup.

| Measurement | Baseline runs | Recipe runs |
| --- | --- | --- |
| Drag frame p95 | 16.8, 16.7 | 16.8, 16.7 |
| Scroll frame p95 | 16.8, 16.8 | 16.7, 16.8 |
| Release to final view | 1914.1, 1759.8 | 1789.2, 1782.6 |
| Load to final view | 1980.7, 2097.8 | 1950.9, 2108.1 |

Stable variant addresses use a cached map for constant-time lookup. The model
and expanded feature browser regression were rerun successfully after that
final lookup change.

The unfiltered all-world control sweep was stopped at a confirmed baseline
failure, so it is **not a passing or complete sweep**. Zhon's `rippleHeight` moves
pixels while its panel gate says it is disabled (232 pixels on `zhon-1`). Running
`--worlds zhon --only rippleHeight` on the untouched `a1d6da74` baseline exits 1
with six hidden-but-moving cases, including the same 232-pixel result. This
unrelated gating issue remains unfinished.

By eye: the mixed-feature screenshots show independently colored blue/gold
plants and a blue stone spire on both Green and Moon, retaining their geometry
and responding to the world's light. Screenshots and measurement sheets remain
outside the repository under `/private/tmp/nanolathe-map-editor/agent-feature-recipes`.

The canopy selector exposes the existing cluster and frond shape families.
Continuous morphing between these families and arbitrary editable color ramps
remain outside this change; the new material controls provide two independently
chosen surface colors plus wood color.


## Expanded control validation

Measured for the artist-control follow-up:

- The final feature sweep passes all 43 comparisons at 1x, including separate
  tendril color measurements. The new controls move 51.0–99.0% of their classes;
  the minimum across all retained controls is 21.0% (rock grain). Rock height and
  width variation move 81.9% and 90.3%. Tendril coverage, second color, and patch
  size move 72.2%, 63.6%, and 51.0% respectively.
- The unit suite passes 183 tests. Added checks cover independent variation,
  source range centers, stable variant addresses, color/geometry separation,
  zero coverage, deterministic regeneration, rock footprints, control gating,
  and identical preview/export sprites and burnt successors.
- The land tier passed with the plant controls. After adding rock variation, the
  final quick tier and expanded feature browser check were rerun. The browser
  checks exercise canopy changes, percentage/diameter input units, clearing an
  override, undo, camouflage, rock variation, world changes, saves, world files,
  and archive export. All 34 terrain scenes still match the branch baseline.
- The three standard export-byte cases pass, with two Wasm exports and the native
  exporter agreeing on both archive and indexed-image hashes for each map.
- Shape and geology sweeps exit 0. The geology sweep retains its pre-existing
  below-threshold terrain rows. The targeted Zhon `rippleHeight` world sweep
  still exits 1 with six hidden-but-moving cases, matching the previously
  reproduced baseline failure. The unfiltered world sweep is not claimed as
  passing and was not repeated for this feature-only change.

By eye: the comparison sheets show distinct full, clustered, and palm canopies,
more exposed trunks, and variable proportions. The editor screenshots show blue
and pale-gold patches along enlarged tendrils on both Green and Moon. Feature
colors retain shading; wood and shadows remain separate from the patch colors.
Artifacts are outside the repository under
`/private/tmp/nanolathe-map-editor/agent-feature-recipes/artist-*`.
