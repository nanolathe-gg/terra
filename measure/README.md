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

