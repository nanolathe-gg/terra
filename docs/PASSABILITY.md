# Passability reference view

Passability joins Art and Clay in the existing editor. It is a diagnostic overlay;
its controls are view state and do not enter the recipe, undo history, terrain art,
or export. All classes is an overview of overlapping access types. The first
available family supplies a cell's color (vehicles, KBots, ships, hover,
amphibious); hovering lists every family. Selecting a family uses green for all
reference profiles, hatched amber for some, and red for none. Air is
terrain-independent; landing suitability is not evaluated.

## Reference profiles

These are generic numeric capability references calibrated from Nanolathe's
movement research, not a unit catalog. There are no unit identifiers, definitions,
models, or images. They deliberately preserve discrete size and capability bands.
They are approximate design aids, not an exhaustive census or percentages of
units. Mods, unusual movement types, traffic, turning, direction, and connected
routes are outside the claim. Hatching means variation among these references.

| Family | Square footprints (cells) | Land height span | Maximum water depth | Minimum water depth |
| --- | --- | --- | --- | --- |
| Vehicles | 2, 3, 4 | 15 | 12 | none |
| KBots | 2 with span 11; 2 and 3 with span 32 | 11 or 32 | 12 | none |
| Hover | 3, 4 | 12 | unlimited | none |
| Amphibious | 2 with span 32; 3 with span 15 | 32 or 15 | 100 | none |
| Ships | 4 shallow; 3 and 6 deep | unrestricted | unlimited | 3 or 15 |

The three-cell amphibious reference has underwater span limit 30. Other
references use unrestricted underwater span (255). Depths and spans are height
byte units, not degrees. The calibration is Nanolathe research doc 04 §6.1
(R-DOC04-A/B and R-SLOPE-01) and `research/formats/tdf.md`'s movement schema;
stock unit files and identifiers are not required by this implementation.

## Terrain and update contract

The view calls the export's `sampleHeights`, hence `sculpt-map.js:cellHeights`:
weathered cell corners rounded and clamped to the TNT's bytes. A cell's minimum
and maximum come from its four corners. Every covered cell must pass depth and
slope limits; footprint heights are never aggregated into one span. The plotted
candidate cell is the center, with footprint anchors offset by half their integer
size. Generated tree and rock variant footprints block, shrubs and painted
resources do not. North/south void strips, right border columns, and the export's
molten-terrain setting are included.

Analysis is lazy: it runs only while the view is open and after terrain settles.
Edits, weather changes, feature changes, and undo invalidate it. Old colors are
hidden immediately when the revision changes; incomplete or canceled samples
never become the displayed result. Family changes reuse the same sampled grid.
The display projects the analysis cells over the terrain; it uses the existing
render and overlay canvases, without adding a terrain render path. Retained
analysis arrays and its viewport image enter the editor's memory accounting.

## Checks

`node --test repro/passability.test.mjs` exercises strict depth/slope boundaries,
wet-corner selection, footprints, class variation, voids, molten terrain, and
generated feature footprints. `node repro/passability.mjs --server YOUR_SERVER
--port YOUR_CDP_PORT [--sketch /absolute/local/save.json]` checks the actual view,
unchanged recipe and art, class switching, feature edits/undo, and Art/Clay.
An optional local sketch stays outside the repository. The static build carries
both passability modules.

## Worktree validation (November 6, 2026)

Measured on the owner's authored 8×8 save, kept outside the repository:

- 135 unit/static-build tests pass. Chrome passability acceptance passes,
  including unchanged recipe/art, all five families, blocking rock edits/undo,
  and returning to Art/Clay. The feature browser regression and Green brush,
  undo, export, and `--page8` smoke checks pass.
- All 30 reference scenes match the pre-change render byte for byte. Regional
  replay reports zero mismatches; the world-name gate passes without new names.
- The visible in-app preview samples and classifies 68,112 cells in 2,979 ms.
  A separate headless Chrome acceptance run took 4,113 ms. These include GPU
  height sampling; classification alone on the previously sampled grid took
  38 ms under Node. The Fit diagnostic retained about 3.44 MB in the acceptance
  viewport, including its viewport image.
- The west gap's inspected cell spans height bytes 56–61 at sea 75; vehicles and
  KBots are blocked, both hover and amphibious references pass. In the checked
  southeast window, 179 candidate cells admit some KBot references and no
  vehicle references. These are local occupancy results, not connected routes.
- Two alternating normal-view drag benchmark pairs (`repro/perf.mjs map8
  --only drag`) keep frame p95 at 16.7–16.8 ms before and after. Pointer-to-picture
  p95 was 68.2/68.8 ms before and 328.5/69.1 ms after. The first after run's
  outlier is unresolved; this small sample does not establish pointer latency
  equivalence. The harness deliberately stops after the drag phase.

By eye, the Fit overlay exposes the river crossings and plateau rim without the
antialiasing mesh produced by independent translucent cell polygons. It stays
legible in the narrow in-app browser using the existing Focus canvas control.

Unfinished: exhaustive profile calibration, Nanolathe traversal parity for each
reference, connected-route checks, turning/traffic, landing suitability, and
larger-map performance qualification. No claim covers arbitrary mods. This is
committed for review on its branch, not merged to main.
