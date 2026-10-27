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
