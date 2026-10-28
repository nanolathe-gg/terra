# Terrain editor export (Card D, phases 1 and 2)

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
  --out /private/tmp/editor-export/maps \
  --features-root /private/tmp/nanolathe-map-editor/agent-D/features
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
  "chunks": [{"x": 0, "y": 0, "path": "art.png"}],
  "features": [{"name": "RockMetal1", "x": 24, "z": 24}],
  "starts": [{"x": 256, "z": 256}, {"x": 1792, "z": 1792}],
  "settings": {"minWind": 500, "maxWind": 4500, "tidal": 25, "solar": 20, "gravity": 112, "surfaceMetal": 3, "mohoMetal": 40, "lava": false}
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

`features`, `starts` and `settings` are optional. Omitted features give bare
terrain; omitted starts preserve the phase-1 pair at 256px margins (128px on
one-unit axes); omitted settings use the world's retail medians. Explicit
starts contain 1–10 distinct integer pixel positions inside the play area.
Their order becomes `StartPos1` through `StartPosN`, and `numplayers` matches.

Feature x/z are top-left anchor **cells**, rather than pixel positions. Every
full footprint must lie inside the play area, without overlapping another.
The name must appear in the prepared world's catalogue and its mounted TDF;
footprints are checked against that TDF. A deterministic sorted name table
supplies anchor indices, with `0xFFFE` in each remaining footprint cell.
The terrain image must not contain feature sprites.

A supplied settings object contains every field shown above. Integer values
are nonnegative signed-32-bit OTA values, with minimum wind no greater than
maximum wind; surface metal additionally fits the engine's byte store
(0–255). `lava` is boolean. These are format/store bounds, not retail maxima.
Starts and settings use the same OTA keys as `internal/mapgen/ota.go`.

Prepare a private feature catalogue before exporting placed features:

```sh
go build -o /private/tmp/nanolathe-map-editor/agent-D/bin/map-features ./tools/map-editor/features
/private/tmp/nanolathe-map-editor/agent-D/map-export --catalog > /private/tmp/nanolathe-map-editor/agent-D/map-catalog.json
/private/tmp/nanolathe-map-editor/agent-D/bin/map-features \
  --catalog /private/tmp/nanolathe-map-editor/agent-D/map-catalog.json \
  --world green --out /private/tmp/nanolathe-map-editor/agent-D/features
```

The helper also accepts repeated `--root` flags. It writes
`<out>/<world>/catalog.json`, first-frame PNGs and optional shadow PNGs,
with authored GAF offsets and transparency. It counts TNT play-area anchors
across the world's source maps, following `mapgenSource`; classification and
deposit selection follow `mapgenFeatures`. Unlike that generator, the editor
retains every drawn member instead of eight per vegetation category. Missing
optional shadow sequences produce `null`; composite children retain their
common anchor. A destination-dependent alternate child returns an explicit
error, since one transparent PNG cannot represent it. All derived files
stay outside the checkout and the content roots.

The command writes `<name>.ufo` with stored HPI entries
`maps/<name>.ota` and `maps/<name>.tnt`, plus `<name>-indexed.png` for image
comparison. Before publishing, it reopens the staged archive through
`vfs.NewArchive` (via `MountArchiveReader`), lists and reads both files,
compares every TNT cell, feature record, tile and minimap byte, and parses
the OTA settings and numbered starts. Publication
is atomic per file and refuses an existing destination. Installed names are
also refused case-insensitively. Content roots cannot be output directories.

Stdout is one JSON result with `name`, `archive`, `indexed`, `widthCells`,
`heightCells`, `uniqueTiles`, `tileSlots`, `exactPixels`, `nearestPixels`,
`featureCount`, `starts`, and `selfCheck` (`tnt`, `ota`, `archive` booleans). Output filenames
are basenames. Errors go to stderr with a nonzero exit status.
