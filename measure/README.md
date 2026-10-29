# Measurements against retail

Each script compares renders with retail art, using the section catalog
written by `cmd/sectioncat` (branch `sct-reader`). The catalog and renders
stay outside Git.

| Script | Measures |
| --- | --- |
| `slope_stats.py` | Brightness, local contrast, rock (gray) and green share by slope, in 8x8 windows through TA's h/2 projection |
| `light_fit.py` | Broad light direction and strength: brightness regressed on the height gradient |
| `water_fit.py` | Water colour by depth and depth by distance from shore, from coast sections |
| `hill_profiles.py` | Rise, footprint, 20-80% rise width and slope spread of raised forms |
| `sheet.py` | Labelled 2:1 crop sheets for visual comparison |
| `crack_lines.py` | Thin dark lines by slope bin (density, contrast, strong and long coherent lines) against the surface's own texture level; retail references per world (`retail <world>`) |
| `slope_texture.py` | Slope luminance, dark share, band-pass energy, dark-mark sizes and edge crispness, relative to level ground |
| `crack_sweep.py` | Renders example scenes under knob overrides (URL parameters) and runs both metrics |
| `crack_sheet.py` | Same-window crop sheets across renders, optionally with detected lines overlaid |

Renders with heights come from `capture/capture.mjs` scenes that set
`"heights": true`. Pass `ours <label> <stem>...` (stems without `.png`),
or `retail <manifest.json> <catalog root>`.

Lava (retail maps exported by `tools/neural-terrain/export -planet Lava`):

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
