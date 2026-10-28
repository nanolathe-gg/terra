# Terrain editor prototype

Card D phase 1 adds playable terrain export. Its limits and follow-up work
are in [BACKLOG.md](BACKLOG.md#card-d-a-real-map-editor-full-size-maps-features-export-to-ufo).

From this worktree, build the export helper and run the private server:

```sh
go build -o /private/tmp/nanolathe-map-editor/agent-D/map-export ./tools/map-editor/export
/private/tmp/nanolathe-neural-terrain-venv/bin/python tools/map-editor/sculpt.py \
  --port 8840 --assets-root /private/tmp/nanolathe-map-editor/agent-D
```

The prepared `assets-*` folders must already be copied under that assets root,
as the backlog specifies. The helper reads `~/TotalAnnihilation` without
writing to it. To use other content, repeat `--game-root DIR` in mount order.
`--export-tool PATH` selects a helper built elsewhere.

Open <http://127.0.0.1:8840/sculpt>. The **Playable map** section below the
shape tools creates a blank map canvas, with 1–4 units on each axis and a
chosen sea level (the median TNT sea level of its retail world). Each unit is 512 playable pixels. A 4×4 map
contains 130×136 cells, including the outer strips, and 2080×2176 pixels.
The yellow dashed rectangle is the playable extent; orange lines mark the
height-dependent edge strips. Fit and 1× use the existing viewport.

The original 1024px study view remains available. Creating a new map starts
blank; draw it with the existing brushes, then export the finished canvas.
Map dimensions and sea level travel with Save sketch / Load sketch. Water
brush depths are relative to sea level. Choose a positive sea level if the
map needs deep water: TNT heights are unsigned bytes.

**Export .ufo** uses a name and description, the chosen world's installed
retail climate medians, and two fixed starts. It warns when corner heights
need clamping to 0–255. Art uses the full-detail displayed field, clamped to the TNT byte range.
Only the TNT attributes use quantized 16px corners. Art is projected from
height zero, while the editor retains its base-relative preview. It captures tile-aligned PNG chunks and sends them to the helper.
No extra noise or dithering is added by export. Zhon export stays disabled
until the owner chooses a retail planet.

Finished archives and indexed PNGs are offered as downloads and saved to
`<assets-root>/exports/`. The archive contains only `maps/<name>.ota` and
`maps/<name>.tnt`. An installed map name or an existing export is refused.
See [the command's format contract](export/README.md) for the manifest,
palette mapping, tile deduplication, minimap and built-in round-trip checks.

Phase 1 uses a bounded square working field behind the rectangular view,
including a south projection apron. It retains full-resolution fields and
export images in memory. Sparse fields, visible-chunk caching, large maps,
streaming, budgets and cancellation belong to phase 3. Features, editable
starts and OTA climate controls belong to phase 2. Tile reuse policy belongs
to phase 4. None of those phases is implemented here.
