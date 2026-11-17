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
  --features-root /private/tmp/nanolathe-map-editor/agent-D/features   # holds pack.json
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
  "features": [{"name": "TFab12cdMetal127", "x": 24, "z": 24}],
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
A manifest may be as large as a 40×40 map with a feature on every play cell
needs (about 134 MiB of JSON); a larger one is refused with that reason.

Palette conversion uses exact RGB matches, then squared Euclidean RGB
distance, with the lowest index winning ties. There is no noise or dithering.
Only exact indexed 32×32 tiles are shared. Unique tiles are numbered by their
first appearance in the complete row-major tile grid, so changing chunk
dimensions, the browser's GPU budget or the exporter's spill budget does not
change TNT bytes. A map with at most 65536 unique tiles is exact. With more,
the exporter merges tiles before numbering them (`merge.go`): weighted median
cut over each tile's 8x8 grid of mean palette colors (one per 4x4 pixel block), at most 65536 clusters,
each drawn with its member nearest the cluster centroid. When the clusters left
cannot be split (their tiles differ only inside 4x4 blocks) before the limit,
the merged tiles that cost most (use count times squared pixel error) are kept
until it is reached. A tile used by many
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
Every name must be defined in the map's feature pack: `<features-root>/pack.json`,
which the page writes (`sculpt-features.js`). The pack holds the map's generated
feature sections and the frames of their sequences; `featurepack.go` checks it
(a `TF` prefix and bank, names of at most 31 characters, the keys a generated
feature sets and their ranges, every sequence and successor present) and writes
what the placed features reach as `features/<bank>/<bank>.tdf` and
`anims/<bank>.gaf` in the archive. Painted deposits and vents are features whose
only frame is one transparent pixel, as retail's `Geothermal`. A deterministic
sorted name table supplies anchor indices, with `0xFFFE` in each remaining
footprint cell. The terrain image must not contain feature sprites; deposits and
vents are painted into it by the page.

A supplied settings object contains every field shown above. Integer values
are nonnegative signed-32-bit OTA values, with minimum wind no greater than
maximum wind; surface metal additionally fits the engine's byte store
(0–255). `lava` is boolean. These are format/store bounds, not retail maxima.
Starts and settings use the same OTA keys as `internal/mapgen/ota.go`.

The command writes `<name>.ufo` with stored HPI entries
`maps/<name>.ota` and `maps/<name>.tnt` (and the feature pack's TDF and GAF), plus `<name>-indexed.png` for image
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

## Streamed export

The exporter accepts one finished PNG at a time and forgets it after
quantisation; it never accumulates the map's PNGs or a complete map image.
Chunks must arrive in row order, increasing y then x, covering every tile
exactly once; positions and dimensions align to 32 px.

The default unique-tile memory budget is 16 MiB. Pass `--tile-budget-mb N`
(0..64); zero spills immediately. Only tile hashes, the tile index and
attribute maps, minimap accumulators and the bounded tile cache remain in
memory between chunks. Hash collisions are checked against the actual tile
bytes. Chunks are immediately quantised and deduplicated.

`--work` names the private directory for temporary files (default the OS
temporary directory); a work directory named `export-<32 hex digits>` gives
the output stages exact `.map-export-ID-*.tmp` names. Complete output files
appear by exclusive hard links after checks. The archive is published before
the preview, so a crash cannot leave a preview without a complete archive.

Run it so:

```sh
map-export --stream --input metadata.json --out exports --work PRIVATE_DIR
```

After its `{ready:true,width,height,maxChunkSide}` reply, send newline-delimited
JSON commands on stdin: `{op:"chunk",x,y,width,height,path:"local.png"}`,
`{op:"finish"}` or `{op:"cancel"}`. Each chunk gets one progress reply;
finish gets one result. EOF cancels an unfinished export. `--work` is optional
and otherwise temporary files use the OS temporary directory.

## In the browser

The editor runs this same program in the page, on the Go development server and on the
static site alike: `GOOS=js GOARCH=wasm go build ./export` (the Go site tool builds
it, with `-trimpath -buildvcs=false -ldflags=-s -w`; nothing built is
committed), in a Web Worker (`sculpt-export-worker.js`), in stream mode with
the commands above. The worker plays the shell's part: it writes each chunk
PNG where the program reads it and hands the reply lines to the page. Go's
js/wasm port reaches files through a Node-style `fs`; the worker's keeps them
in the browser's Origin Private File System through synchronous access
handles, so the tile store spills there past its budget, and the two outputs
stay there as disk-backed files the page offers as downloads until the next
export.

The worker passes `--catalog-file` with the page's world defaults
(`config/catalog.json`, committed in `materials/<world>.json`), the palette
(`materials/palette.json`) and no installed map names, and, when features are
placed, `--features-root` with the map's feature pack from the page. It reads no game content. The result's
`peakRSSBytes` is the size of the module's linear memory, which never shrinks,
so it is the peak (the worker reads it; Go's own `MemStats.Sys` counts
reserved address space and reads more than twice as high).

The WebAssembly and the native exporter write the same bytes for the same
chunks. Tile merging converts every summed product explicitly, because Go may
fuse `x*y+z` into one rounding on arm64 and WebAssembly never does;
`TestMergeTilesPinned` pins a merge and passes both ways
(`GOOS=js GOARCH=wasm PATH="$PATH:$(go env GOROOT)/lib/wasm" go test ./export`).
