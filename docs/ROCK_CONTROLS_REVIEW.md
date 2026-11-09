# Voxel rock controls review

Branch `rock-controls`, based on main `13d74571`. The editor is served for
review at `http://127.0.0.1:8904/sculpt`. Landing approved after the combined landing checks on November 9, 2026.

## Artist workflow

Open **World → Rock & cliffs → Geological starting point**. Sandstone, shale,
granite, basalt, and limestone are editable sets of the same numbers, including
Rock column bed thickness and hardness. They preserve the chosen colors and
base ground. One Undo restores the whole preset; individual rock sliders also
use the existing undo stack. Map saves, autosave and share payloads carry the
rock numbers alongside the existing column. No separate page or renderer.

Ten new controls shape the voxel density: block aspect ratio, block height,
roundness, joint depth, extrusion bias, fine layer relief and spacing, groove
length and tilt, and grit size. Existing depth, broad form, weathering, bed
hardness, pits, grooves, color and PBR controls remain in use. Rock gloss,
reflection sharpness, micro roughness, grain width and bed tilt are exposed in
the primary inspector. Related controls are grouped within the existing Rock
section. Inactive controls explain their parent requirement.

**By eye:** the authored comparison shows thin broken shale plates, larger
rounded granite masses, tall basalt joints and pitted limestone. Layered
sandstone has broad bedding with finer laminations. These are useful distinct
starting points at TA's 1x scale. They are not claims of physically simulated
lithologies or a match to every detail in the supplied Gaea images.

## Measured control impact

`repro/rock-controls-gpu.mjs` uses an authored 512×512 cliff at 1x. The rock
class is the 52,335 pixels affected by changing rock coverage from zero to one.
Values below count changed RGB pixels within that class, not the surrounding
flat ground. Scratch, grit, block and lamination parents are enabled for their
size/direction controls. Each exceeds the 5% requirement.

| Control | Rock pixels changed |
| --- | ---: |
| Block length / width | 78.6% |
| Block height / layer height | 78.4% |
| Rounded blocks | 77.7% |
| Joint depth | 79.9% |
| Extrusion bias | 85.3% |
| Fine layer relief | 78.2% |
| Fine layer spacing | 71.7% |
| Groove length | 62.2% |
| Groove tilt | 62.1% |
| Grit size | 63.9% |
| Existing wetness | 79.9% |
| Existing gloss | 83.9% |
| Existing reflection sharpness | 10.7% |
| Existing micro roughness | 52.8% |

At zero versus 0.0001, the four new amplitude controls change the mean RGBA
channel by 0.0015–0.0069 of 255. Positive size controls move the spatial sample
lattice; they do not have a zero/off state. All keep one density model.
Nondefault sandstone settings produce **0 differing pixels** across chunk sizes
and memory budgets. Gameplay heights also have **0 changes**.

## Measured preservation and retail comparison

The final quick tier passes all five checks: unit/static-site tests, world-name
gate, all 34 scene comparisons, regional replay and voxel regression. Of the
34 scene images, 31 are byte-identical to main. Green-2 changes 2 pixels,
Green-4 changes 13 and Green-modern-2 changes 4, from floating-point evaluation
of the shared bedding coordinates when fine laminations are present in the
shader. The comparison explicitly allows Green and modern Green; it does not
claim byte-identical art for those three scenes. All 34 gameplay-height files
are byte-identical. Flat ground keeps the existing generated TA base texture.

`repro/retail.sh green` ran on main's archived sources and this branch. Each
window's reported shape/look gap, in retail-family-band units (lower is closer):

| Window | Shape before → after | Look before → after |
| --- | --- | --- |
| Green-1 | 0.24 → 0.24 | 0.12 → 0.12 |
| Green-2 | 0.16 → 0.16 | 0.18 → 0.18 |
| Green-3 | 0.10 → 0.10 | 0.09 → 0.09 |
| Green-4 | 0.59 → 0.59 | 0.29 → 0.29 |
| Green-5 | 0.18 → 0.18 | 0.60 → 0.60 |
| Green-6 | 0.23 → 0.23 | 0.10 → 0.10 |
| Green-7 | 0.19 → 0.19 | 0.11 → 0.11 |
| Mean | 0.24 → 0.24 | 0.21 → 0.21 |

Modern Green's height realism reports are identical before and after:
**8.12/15** statistics inside the real range on average across 17 evaluated
windows. Gate passes are closed basins **17→17**, fabric **15→15**, hilltop
roundness **8→8**, Hack exponent **5→5**, hollow share **17→17**, valley share
**17→17**. The existing 23 gate failures are unchanged; no terrain-height model
was altered. Maximum window slope p90 remains **0.742**.

## Measured integration and performance

- World control sweeps: all 15 tested rock/finish rows plus the two exposed bed
  tilt rows respond; no unexplained zero and no control moves while disabled.
- Shape control and Green geology sweeps pass. The existing Green band-jag
  check changes 15.2% of its class in its active window.
- Editor test: preset selection is visible; one Undo/Redo restores numbers,
  column and exact art; a manual slider edit returns to its preset on Undo;
  save/load and autosave/reload reproduce exact pixels; invalid input leaves
  the scene intact; dependency explanations track the active parent.
- Existing workspace regression passes: pointer/keyboard editing, curve edits,
  undo, map navigation, weathering, help previews and tablet layout; no console
  errors.
- New sandstone settings export a 4×4 landform map twice to identical bytes.
  WebAssembly and native UFO/PNG hashes match; 3,666 unique tiles, no merging.
- Authored hover previews regenerated: 14 tools and 147 control frames. No
  reference images or retail-derived assets are committed.

Two alternating runs on the same machine, main then branch, using Green-2:

| Metric | Main runs | Branch runs |
| --- | --- | --- |
| Drag paints/sec | 59.73 / 59.94 | 59.80 / 59.78 |
| Release to final viewport | 1,403 / 1,403 ms | 1,464 / 1,427 ms |
| Export | 3,760 / 3,715 ms | 3,739 / 3,762 ms |

The mean final-render delay increases about 3%; drag responsiveness and export
are effectively unchanged in this small sample. This is not a performance
claim for every map or extreme control combination.

## Remaining work

The references also have debris distributions, sediment accumulation, broad
weathering and runoff stains that are more coherent than this local rock model.
Those remain future work. Basalt is a jointed starting point rather than a
physical hexagonal cooling-fracture solver. Presets keep the world's colors;
they do not automatically choose geology-specific palettes. Other worlds have
not received a dedicated art-tuning pass. The branch is ready for artist review,
not claimed to have reached the full realism of the reference renders.

Artifacts: `/private/tmp/terraform-rock-controls/` contains the 1x comparison
sheet, GPU impact report, UI example recipe, before/after retail sheets,
realism reports, export hashes and alternating performance logs.
