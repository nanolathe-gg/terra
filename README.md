# Terrain editor prototype

Card D phase 3 adds maps up to 40×40 units with a scrolling viewport,
bounded regional replay, live gestures, overlapping weather tiles and streamed
export. The 1024px study keeps its existing rendering path. Phase 3 review
measurements and the remaining GPU rounding difference are recorded in
`/private/tmp/nanolathe-map-editor/agent-D/NOTES.md`. Phase 4 has not started.

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
canvas. Choose 1–40 units on each axis and a sea level, initially the
upper median TNT sea level of its retail world. Each unit is 512 playable
pixels. A 4×4 map contains 130×136 cells, including the outer strips, and
2080×2176 art pixels. Yellow outlines the playable rectangle; orange marks
the height-dependent edge strips. Fit, 1×, 0.5× and the minimap navigator use a viewport-sized canvas. Export view PNG captures only the current view.

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

Full-size maps keep the stroke graph as their source. Field prefix tiles replay
with each brush's read apron; long connected coasts query earlier tiles without
expanding one connected bounding box. Visible chunks and one surrounding margin
are baked on demand. Scrolling uses an LRU image cache, while overview and the
navigator use a coarse 128×128 height preview. A stroke, move, rotation, scale or
height drag previews while held and commits one undo step; Escape cancels it.

The GPU and page heap budgets default to 512 MiB and 1 GiB, with controls in
**Map view and memory** (`gpuMB` / `heapMB` in the URL). The device requests
default WebGPU limits. Mask storage counts its actual layer count. Every selected
GPU budget uses the same canonical bake size chosen at the 128 MiB floor; lower
budgets evict and re-bake more images. Changing chunk geometry can move isolated
palette decisions because the GPU rounds interpolation differently. The remaining
Ice frost decision is documented with raw field and float probes in NOTES.md.

Maps with at most 1168 samples on their working side keep the existing global
weather solver. Larger maps use fixed 256-cell weather cores, 64-cell blend
overlap and another 128-cell solver apron. Tile seeds depend only on the map seed
and tile coordinates, so cache size and renderer chunk boundaries do not change
the result. Weather is lazy in the view; exports await it for both art and TNT
corner heights. Field, weather and upload reservations share the page budget.

**Save to server** writes graph/settings/objects and changed sparse mask chunks
under `<assets-root>/documents/documents/<id>/`; **Reload document** restores that
world/size/sea canvas. Chunks use stable coordinate keys. Sketch files remain an
alternative to server documents.

Export streams one tile-aligned PNG at a time to the helper. The helper keeps
hashes, tile indices and attributes in memory, spills tile bytes under its own
budget, and writes the indexed PNG and archive without a full-map image buffer.
Cancel removes the exact temporary job and publishes no partial archive. More
than 65536 distinct tiles is refused; the tile reuse policy is still phase 4.
