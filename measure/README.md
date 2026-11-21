# Measurements against retail

Each script compares renders with retail art, using the section catalog
written by `cmd/sectioncat` (branch `sct-reader`). The catalog and renders
stay outside Git. This page lists the main scripts; the rest describe
themselves in their own header comments.

| Script | Measures |
| --- | --- |
| `slope_stats.py` | Brightness, local contrast, rock (gray) and green share by slope, in 8x8 windows through TA's h/2 projection |
| `light_fit.py` | Broad light direction and strength: brightness regressed on the height gradient |
| `water_fit.py` | Water colour by depth and depth by distance from shore, from coast sections |
| `hill_band.py` | Retail hills of every raised form per rise bin (rise, area, 20-80% width, top flatness, slope, per-cell steepness band) and the same for a render |
| `hill_profiles.py` | Rise, footprint, 20-80% rise width and slope spread of raised forms |
| `sheet.py` | Labelled 2:1 crop sheets for visual comparison |
| `crack_lines.py` | Thin dark lines by slope bin (density, contrast, strong and long coherent lines) against the surface's own texture level; retail references per world (`retail <world>`) |
| `slope_texture.py` | Slope luminance, dark share, band-pass energy, dark-mark sizes and edge crispness, relative to level ground |
| `crack_sweep.py` | Renders example scenes under knob overrides (URL parameters) and runs both metrics |
| `crack_sheet.py` | Same-window crop sheets across renders, optionally with detected lines overlaid |
| `material_numbers.py` | A world's prepared images as `materials/<world>.json`: per-material ramp, tint and octave bands, the plain's tiles, and the world's `material` and `water` numbers (cards H3, H14) |
| `material_fit.py` | Fits the table's `model` (band amplitudes, rank quantiles) to the measured bands by rendering swatches of the engine's own startup pass (`swatch.mjs`) |
| `material_lit.py` | (library) What a lit height field needs from a prepared image: light axis (west end), orientation, anisotropy, dark lines, cell size, veins; and the numbers a swatch is compared by (card H14b) |
| `lit_lab.py` | Tries lit numbers on one prepared image: image beside the engine's swatch at 1x, 2x and the quarter level, with the numbers |
| `lit_fit.py` | Pattern search for a lit material's numbers on swatches rendered in one Chrome session (`material_fit.py --lit` runs it) |
| `material_swatches.py` | Each prepared image beside the engine's generated layer, at 1x, 2x and quarter resolution, with the numbers |
| `river_retail.py` | Retail TA rivers from their 16-px heights: width, sinuosity and offset from the chord over 4 and 8 widths, bend wavelength and amplitude (the table is in its header) |
| `river_band.mjs` | The same numbers on the River preset's stroke-time migration (`sculpt-river.js`), on a straight line, a gentle curve and an S, per Wander |

Renders with heights come from `capture/capture.mjs` scenes that set
`"heights": true`. Pass `ours <label> <stem>...` (stems without `.png`),
or `retail <manifest.json> <catalog root>`.

Lava (retail maps exported with the parent Nanolathe project's retail exporter):

| Script | Measures |
| --- | --- |
| `lava_maps.py` | Loads exported retail maps and sculpt captures (`OurMap`); 1:1 crops |
| `lava_world.py` | Resamples art into world space (each world point at its projected row) |
| `lava_bands.py` | Contour bands: dark-line census by slope and facing, spacing in px and height, tonal profile, line topology, whole-face line counts |
| `lava_coasts.py` | Finger coasts: colours across the waterline, bank height by distance from lava, finger and inlet shapes |
| `lava_strokes.mjs` | Draws brush strokes on a blank page headlessly and saves the render and heights |
| `lava_sheets.py` | Labelled retail-over-ours crop sheets |


Painted Desert (a repro/all.sh output directory: retail.png, heights.npy, crop.json, ours.png, ours-heights.json):

| Script | Measures |
| --- | --- |
| `desert_hue.py` | Colour (mean RGB, hue, R/G, luma s.d., orange and grey shares) by the height of the ground each pixel shows, in classes plain, apron, bands, cap and the flattest 40% of pixels, retail beside ours (card G4) |

Retail maps, read in place from `~/TotalAnnihilation` (numbers only, nothing written):

| Tool | Measures |
| --- | --- |
| `tntstats` | Each TNT's size, tile slots and distinct 32x32 tiles |
| `shallowdepth` | Water depth under the shallow (light) and deep blue of named TNTs, per map and pooled by depth band (docs/PASSABILITY.md) |
