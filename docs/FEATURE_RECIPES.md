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

## Validation

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

Further generator parameters remain preset data. Exposing additional controls,
such as the clustering model, needs its own continuity and visibility checks;
this change does not redesign those generators.
