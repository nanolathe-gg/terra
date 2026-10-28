# Terrain editor prototype

Card D phases 1 and 2 add playable terrain, features, starts and OTA settings.
Limits and later phases are in [BACKLOG.md](BACKLOG.md#card-d-a-real-map-editor-full-size-maps-features-export-to-ufo).

From this worktree, build the helpers and run the private server:

```sh
mkdir -p /private/tmp/nanolathe-map-editor/agent-D/bin
go build -o /private/tmp/nanolathe-map-editor/agent-D/map-export ./tools/map-editor/export
go build -o /private/tmp/nanolathe-map-editor/agent-D/bin/map-features ./tools/map-editor/features
/private/tmp/nanolathe-neural-terrain-venv/bin/python tools/map-editor/sculpt.py \
  --port 8840 --assets-root /private/tmp/nanolathe-map-editor/agent-D
```

The prepared `assets-*` folders must already be copied under that assets root,
as the backlog specifies. Helpers read `~/TotalAnnihilation` without writing
to it. To use other content, repeat `--game-root DIR` in mount order.
`--export-tool PATH` and `--feature-tool PATH` select helpers built elsewhere.
Restart the server after Python edits or changing installed content. Each
world's derived catalogue is refreshed once per server run from its configured
content roots, even when private files already exist.

Open <http://127.0.0.1:8840/sculpt>. **Playable map** creates a blank map
canvas, with 1–4 units on each axis and a chosen sea level, initially the
upper median TNT sea level of its retail world. Each unit is 512 playable
pixels. A 4×4 map contains 130×136 cells, including the outer strips, and
2080×2176 art pixels. Yellow outlines the playable rectangle; orange marks
the height-dependent edge strips. Fit and 1× use the existing viewport.

The original 1024px study remains available. Draw a map with the existing
terrain brushes, then use the feature tools. Water brush depths and material
height thresholds are relative to sea. Choose a positive sea level for deep
water: TNT heights are unsigned bytes.

The feature catalogue is derived on first use from the world's installed
maps and TDF/GAF content. PNG sprites and shadows, offsets, footprints,
resources and usage counts stay under `<assets-root>/features/<world>/`.
The deposit tool chooses the world's most-used drawn deposit by the map
generator's rules. Worlds without a matching category show it as unavailable.
Zhon export and features remain disabled until the owner chooses a planet.

Place and erase features on cells. Fills offer trees, foliage or rocks over
a brush, lasso or connected flood region, with usage-weighted selection,
density, noise clustering, footprint spacing, a seed and margins around
starts and deposits. Fills require every covered cell to be dry and its four
corner heights to differ by at most 10, following `gentleLand`. Features use
a separate overlay; they never become terrain pixels.

Starts are numbered 1–10 and exported in pixel coordinates. The OTA settings
panel edits name, description, wind, tidal, solar, gravity, surface metal,
Moho metal and lava world. Climate starts at the world's retail medians.
Map objects and settings join the terrain in Save sketch / Load sketch and
Undo / Redo; feature/settings undo does not rerun terrain refinement.

**Export .ufo** warns when corner heights need clamping to 0–255. Art uses
the full-detail displayed field, clamped to the TNT byte range. Only TNT
attributes use quantized 16px corners. Art is projected from height zero;
the preview remains base-relative. The nearest-pixel shift is chosen once
for the entire image, including half-pixel ties. Export captures tile-aligned
PNG chunks, adds no noise, and deduplicates identical indexed tiles. The
minimap averages RGB within each block before its nearest-palette lookup.

Finished archives and indexed PNGs are downloadable and saved to
`<assets-root>/exports/`. Each archive contains `maps/<name>.ota` and
`maps/<name>.tnt`. Installed map names and existing exports are refused.
The helper decodes and checks the TNT cells, feature anchors/fringe, tiles,
minimap, OTA settings/starts and archive before publishing it.
See [the export format contract](export/README.md).

The bounded square working field retains full-resolution fields and export
images in memory. Sparse fields, visible-chunk caching, maps above 4×4,
streaming, budgets, cancellation and incremental server documents remain
phase 3. Tile reuse policy remains phase 4. Neither phase is implemented.
