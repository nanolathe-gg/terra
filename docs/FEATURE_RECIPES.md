# Shared feature recipes

Feature presets from every material table are available in the existing Features
panel on every world. The catalog contains 82 measured presets plus the two
shared default deposit/vent painters. The table remains the source of each
preset; the Go site builder (`internal/site`) includes the same catalog in
development and static builds.

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
  side of the nominal size). A slider reading **Preset** retains the preset's variation;
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
Numeric feature settings use the same compact scrub sliders as the rest of the
editor: drag, Shift-drag for fine adjustments, arrow keys, or double-click/Enter
to type an exact value. Clearing a typed recipe value restores its preset.
Zero variation remains an explicit override. Variant count, gameplay values,
and fill settings also use these sliders; the seed retains its numeric field.

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
share links. World › Apply look from… (Features) and Map › New map with this look
take another world's or map's set (owner, 2026-11-19: the map holds everything; a
placed feature keeps its style). A saved map's own recipes take precedence over
world defaults. No additional save format, storage
key, undo stack, endpoint or drawing path was introduced. Old feature-set options
are not migrated, following the repository's pre-release save policy.

Passability and export resolve the same stable addresses as the preview. Burning
successors remain attached to their shape. Export successor seeds do not depend
on which recipe is selected in the panel.
