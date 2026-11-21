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
byte units, not degrees. The calibration comes from the parent Nanolathe project's movement
research; stock unit files and identifiers are not required by this
implementation.

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

## Shallow water crossings (November 7, 2026)

The owner's in-game test: units would not cross, or got stuck in, water drawn
with the Shallow water button. The view showed why, on the owner's 8×8 Green
save (two Shallow fords across Deep water rivers, sea 75).

**Depth blocked them, not slope** (measured on the exported heights). No wet
cell in any depth band fails a vehicle or KBot slope limit: a cell with a wet
corner uses the references' underwater span, which is unrestricted for both.
But the light (shallow) water color runs much deeper than they wade. Green
draws the light color down to its shallow-to-deep step, the midpoint of 24
and 60 (about 42, wandering by up to 24). Vehicles and KBots wade 12. On that
map, of the cells drawn light blue, 20% were at most 12 deep, 30% were 13–24
deep and 41% were 25–42 deep (one pixel sampled per cell at Fit, about 0.2×,
so approximate).

**The Shallow water section was a ridge.** The button drew Deep water's Shore
section, a smoothstep over the outer 90% of the half width, which reaches its
depth only at the path. Across the west ford the heights ran `20 24 33 46 58
66 68 68 64 55 42 30 22`: about 3 cells at most 12 deep under 6 cells of
light water. Its path ended 5 cells inside the river, leaving a dip 14–17
deep at the north bank. No row of either ford admitted all three vehicle
footprints.

**Retail.** `go run ./measure/shallowdepth` over the 46 Green-planet maps
(depth: sea less the lowest of a cell's four corners; color: the majority of
its 256 art pixels). Maps with no light water are left out:

| Map | Sea | Light-blue cells | ≤ 12 deep | Depth p50 | p90 |
| --- | ---: | ---: | ---: | ---: | ---: |
| ac02 | 72 | 710 | 57.6% | 10 | 23 |
| ac03 | 49 | 1261 | 88.6% | 5 | 13 |
| ac05 | 75 | 1501 | 18.3% | 26 | 38 |
| air assault | 75 | 1638 | 64.0% | 11 | 32 |
| battle of chimo island | 75 | 1956 | 67.0% | 11 | 26 |
| between two lakes | 75 | 1582 | 76.5% | 10 | 20 |
| black box | 75 | 294 | 52.0% | 12 | 30 |
| cavedog links cc | 75 | 11449 | 16.5% | 26 | 41 |
| com pattern five | 75 | 405 | 60.7% | 11 | 27 |
| coordinated assault | 75 | 2583 | 15.6% | 26 | 40 |
| crossing kerrap shallows | 75 | 3589 | 86.5% | 10 | 17 |
| evad river confluence | 75 | 5165 | 17.6% | 25 | 38 |
| expanded confluence | 75 | 27513 | 15.1% | 25 | 38 |
| force the strait | 75 | 4109 | 75.3% | 11 | 23 |
| fortitude race | 75 | 1167 | 84.9% | 10 | 18 |
| guardian hill | 75 | 2328 | 84.6% | 10 | 18 |
| guditha pass | 75 | 589 | 94.2% | 9 | 11 |
| island hopping | 75 | 4311 | 68.5% | 11 | 25 |
| kaki island assault | 73 | 3015 | 28.3% | 15 | 33 |
| pc games' evad river delta | 75 | 12662 | 24.0% | 22 | 37 |
| peaceful pools | 75 | 754 | 72.7% | 10 | 24 |
| river base alpha | 67 | 1188 | 84.2% | 3 | 16 |
| rotrey stream | 75 | 843 | 98.2% | 7 | 10 |
| silent slayers | 75 | 1898 | 27.8% | 21 | 34 |
| sink the battleship | 75 | 1999 | 27.6% | 21 | 35 |
| the barrier reef | 75 | 32352 | 35.7% | 16 | 35 |
| the wayneston ford engagement | 75 | 2107 | 90.4% | 10 | 11 |
| two continents | 75 | 24754 | 19.1% | 24 | 39 |
| two ore coast | 63 | 829 | 45.1% | 14 | 28 |

Retail does both. Maps built around crossings keep their light water
wadeable: their fords are level beds 7–11 deep (Wayneston Ford's p90 is 11).
Coastal maps draw a wide light band that is mostly too deep (Evad River
Confluence, Two Continents). Green's color step therefore stays as it is.
The Shallow water button now draws the crossing kind.

**Change.** Shallow water draws its own Shelf section (`lfShelf`): level over
the inner 45% of the half width, and a bank that eases in over the outer 55%.
The Shallow and Deep help text says how deep units wade. A brush card still on
its world preset now loads as the preset is today, so a working map's
Shallow button draws the Shelf too. Measured with the Shelf on the owner's
save:

- Ford paths ending on dry land: every row of both fords admits all vehicle
  and KBot footprints (narrowest row 2 candidate cells; before, none).
  Light-blue cells in the ford windows at most 12 deep: 54% (before 29%; the
  windows include the rivers' own banks).
- The west ford with its path as drawn, ending in the river: still blocked at
  the north bank. The help text says to start and end a ford on dry land.
- A Shallow pool (200 px wide, 300 px long) flattened into the plain: no dry
  cell on flat ground spans more than 15. Where it cuts into a hillside it
  leaves a cut bank (36 cells steeper than 15, against 3 for the old ridge).

These are per-row occupancy results, not connected routes. Every repro scene
carries its own water knots, so all 30 render byte for byte as before.
