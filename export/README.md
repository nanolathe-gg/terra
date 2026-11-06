# Terrain editor export (Card D, phases 1–3)

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
are 1–40. Images cover every cell, including the engine's outer strips: their
combined extent is `(unitsX*32+2)*16` by `(unitsY*32+8)*16` pixels. Chunk
positions and dimensions are multiples of 32, and the chunks must cover that
extent exactly once. Each chunk is at most 4096 px on either side. Paths are local files, relative to the manifest or
absolute; images must be opaque PNGs. Supply final engine-projected art in
screen coordinates (`worldY-height/2`); the exporter adds no projection shift.

Palette conversion uses exact RGB matches, then squared Euclidean RGB
distance, with the lowest index winning ties. There is no noise or dithering.
Only exact indexed 32×32 tiles are shared. Unique tiles are numbered by their
first appearance in the complete row-major tile grid, so changing chunk
dimensions, the browser's GPU budget or the exporter's spill budget does not
change TNT bytes. A map with at most 65536 unique tiles is exact. With more,
the exporter merges tiles before numbering them (`merge.go`): weighted median
cut over each tile's 8x8 grid of mean palette colors (one per 4x4 pixel block), at most 65536 clusters,
each drawn with its member nearest the cluster centroid. A tile used by many
slots resists merging, one-off grit merges first, and the result is
deterministic. The export result then carries a `merge` object (distinct tiles
before, kept, merged, slots changed, mean, 99th percentile and worst per-tile
RMS RGB error, the worst slots, milliseconds); `uniqueTiles` is the count before
merging. A map under the limit never reaches this code and exports the same
bytes as before. The 252×252 minimap follows
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
the OTA settings and numbered starts. The TNT and stored HPI writers use
fixed buffers because the public encoders accept complete byte slices.
The TNT packing matches `formats.EncodeTNT`; the HPI writer reuses
`vfs.WriteArchive`'s empty-file directory and patches the stored lengths and
offsets. Self-checks use bounded VFS range reads rather than whole-file reads.
The indexed PNG streams through a one-tile-row cache. Publication
is atomic per file and refuses an existing destination. Installed names are
also refused case-insensitively. Content roots cannot be output directories.

Stdout is one JSON result with `name`, `archive`, `indexed`, `widthCells`,
`heightCells`, `uniqueTiles`, `tileSlots`, `exactPixels`, `nearestPixels`,
`featureCount`, `starts`, `metrics` (`peakRSSBytes`, `peakTemporaryBytes`,
`exportMilliseconds`) and `selfCheck` (`tnt`, `ota`, `archive` booleans). RSS
is the helper process's high-water mark, including its content-catalogue
startup; elapsed time begins when export state is prepared and includes the
time between arriving chunks. Temporary bytes include the private job files
and staged outputs, excluding the final files' hard links. Output filenames
are basenames. Errors go to stderr with a nonzero exit status.

## Streamed HTTP export

The editor bridge keeps one Go helper per active export. It accepts one
finished PNG at a time and removes it after quantisation; it never accumulates
the map's PNGs or a complete map image.

1. `POST /map-export/start`, JSON containing the manifest metadata above,
   without `chunks`. Returns `{id,width,height,maxChunkSide}` in pixels.
2. `POST /map-export/chunk?id=ID&x=X&y=Y&width=W&height=H`, with an opaque
   PNG body. All four coordinates are integers; dimensions and positions
   align to 32 px. Send chunks in row order, increasing y then x, covering
   every tile exactly once. Each reply contains
   `{id,receivedTiles,totalTiles,uniqueTiles}`.
3. `POST /map-export/finish?id=ID`, with an empty body, returns the normal
   export result after checks and publication.
4. `DELETE /map-export?id=ID` cancels the helper and removes its exact
   temporary filenames. The id expires on finish, error or cancellation.

`POST /map-export` still accepts the original JSON/base64 `chunks` array
(1–25 chunks) and runs the same writer. Large maps use the streamed API.
Export ids are random 32-character lowercase hex strings. Metadata requests
are capped at 16 MiB; a PNG upload is capped at 64 MiB, and its declared
dimensions are checked before decoding.

The default unique-tile memory budget is 16 MiB. Set
`NANOLATHE_EXPORT_TILE_BUDGET_MB=0..64` for the HTTP bridge, or pass
`--tile-budget-mb N` to the command; zero spills immediately. Only tile hashes,
the tile index and attribute maps, minimap accumulators and the bounded tile
cache remain in memory between chunks. Hash collisions are checked against
the actual tile bytes. Chunks are immediately quantised and deduplicated.

Private jobs use `nanolathe-map-export-jobs/export-ID/` under the OS temporary
directory. `TMPDIR=/private/tmp/nanolathe-map-editor/agent-D/tmp` selects the
card's diagnostic storage. The bridge records its process id and output
directory in each job's owner file. On startup it cleans jobs belonging to
the same output directory whose owner process has exited, preserving live
jobs and unknown filenames. Cleanup unlinks exact names and removes only
empty directories. Output stages have exact `.map-export-ID-*.tmp` names;
complete output files appear by exclusive hard links after checks. The
archive is published before the preview, so a crash cannot leave a preview
without a complete archive. The server calls `MapExport.close()` at shutdown.

The command-line streaming equivalent is:

```sh
map-export --stream --input metadata.json --out exports --work PRIVATE_DIR
```

After its `{ready:true,width,height,maxChunkSide}` reply, send newline-delimited
JSON commands on stdin: `{op:"chunk",x,y,width,height,path:"local.png"}`,
`{op:"finish"}` or `{op:"cancel"}`. Each chunk gets one progress reply;
finish gets one result. EOF cancels an unfinished export. `--work` is optional
and otherwise temporary files use the OS temporary directory.
