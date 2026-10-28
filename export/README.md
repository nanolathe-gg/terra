# Terrain editor export (Card D, phase 1)

Build and inspect installed content:

```sh
go build -o /private/tmp/nanolathe-map-editor/agent-D/map-export ./tools/map-editor/export
/private/tmp/nanolathe-map-editor/agent-D/map-export --catalog
```

`--root DIR` is repeatable; later roots win. With no roots, the command reads
`~/TotalAnnihilation`. The catalogue contains `worlds`, `palette` (256 RGB
triples), and `installedNames` (map file basenames). The map names in
`catalog.go` come from `repro/scenes`; their installed OTAs establish each
world's planet. All mounted OTA/TNT pairs with that planet contribute to its
climate medians and `defaultSeaLevel` (the median TNT header sea level).
For an even source count, both defaults use the upper middle value. `sources`
lists their logical OTA paths. Missing scene maps, conflicting planets, and
Zhon can produce `disabledReason` instead of an exportable climate and sea
default. Disabled worlds omit `defaultSeaLevel`; a median of zero remains
present. The palette is read in memory, including the ordinary PCX recovery
fallback.

Export a local manifest:

```sh
/private/tmp/nanolathe-map-editor/agent-D/map-export \
  --input /private/tmp/editor-export/manifest.json \
  --out /private/tmp/editor-export/maps
```

```json
{
  "name": "Two Shores",
  "description": "A small hand-painted map",
  "world": "green",
  "unitsX": 4,
  "unitsY": 4,
  "seaLevel": 32,
  "heights": [40, 40],
  "chunks": [{"x": 0, "y": 0, "path": "art.png"}]
}
```

The illustrative heights above must be replaced with exactly
`(unitsX*32+2)*(unitsY*32+8)` integer bytes, in cell row order. Both unit counts
are 1–4. Images cover every cell, including the engine's outer strips: their
combined extent is `(unitsX*32+2)*16` by `(unitsY*32+8)*16` pixels. Chunk
positions and dimensions are multiples of 32, and the chunks must cover that
extent exactly once. Paths are local files, relative to the manifest or
absolute; images must be opaque PNGs. Supply final engine-projected art in
screen coordinates (`worldY-height/2`); the exporter adds no projection shift.

Palette conversion uses exact RGB matches, then squared Euclidean RGB
distance, with the lowest index winning ties. There is no noise or dithering.
Only exact indexed 32×32 tiles are shared. The 252×252 minimap follows
`research/formats/tnt.md` "Minimap": fit the play area to its long side and
fill the unused short axis with palette index `0x64`. Each used pixel averages
all indexed-art RGB values in its source block. Blocks use truncated integer
boundaries, covering every play-area pixel exactly once; the engine's outer
strips are excluded. RGB averages round to the nearest integer (half up), then
use the same nearest-palette rule and lowest-index tie break as the art.

The fixed starts are `(256,256)` and `(unitsX*512-256,unitsY*512-256)`;
a one-unit axis uses 128px margins so its starts are distinct. Starts and
climate are written through the same OTA fields as `internal/mapgen/ota.go`.
Phase 1 places no features or resources beyond the world's surface metal.

The command writes `<name>.ufo` with stored HPI entries
`maps/<name>.ota` and `maps/<name>.tnt`, plus `<name>-indexed.png` for image
comparison. Before publishing, it reopens the staged archive through
`vfs.NewArchive` (via `MountArchiveReader`), lists and reads both files,
compares every TNT cell and tile, and parses the OTA and starts. Publication
is atomic per file and refuses an existing destination. Installed names are
also refused case-insensitively. Content roots cannot be output directories.

Stdout is one JSON result with `name`, `archive`, `indexed`, `widthCells`,
`heightCells`, `uniqueTiles`, `tileSlots`, `exactPixels`, `nearestPixels`,
`starts`, and `selfCheck` (`tnt`, `ota`, `archive` booleans). Output filenames
are basenames. Errors go to stderr with a nonzero exit status.
