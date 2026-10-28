// Command export turns a phase-1 terrain editor manifest into a playable map.
package main

import (
	"bytes"
	"encoding/json"
	"errors"
	"flag"
	"fmt"
	"image/png"
	"io"
	"os"
	"path/filepath"
	"strings"

	"github.com/nanolathe-gg/nanolathe/formats"
	"github.com/nanolathe-gg/nanolathe/vfs"
)

type rootsFlag []string

func (r *rootsFlag) String() string { return strings.Join(*r, ", ") }
func (r *rootsFlag) Set(s string) error {
	*r = append(*r, s)
	return nil
}

type exportRequest struct {
	Name        string  `json:"name"`
	Description string  `json:"description"`
	World       string  `json:"world"`
	UnitsX      int     `json:"unitsX"`
	UnitsY      int     `json:"unitsY"`
	SeaLevel    *int    `json:"seaLevel"`
	Heights     []int   `json:"heights"`
	Chunks      []chunk `json:"chunks"`
}

type chunk struct {
	X    int    `json:"x"`
	Y    int    `json:"y"`
	Path string `json:"path"`
}

type start struct {
	X int `json:"x"`
	Z int `json:"z"`
}

type exportResult struct {
	Name          string    `json:"name"`
	Archive       string    `json:"archive"`
	Indexed       string    `json:"indexed"`
	WidthCells    int       `json:"widthCells"`
	HeightCells   int       `json:"heightCells"`
	UniqueTiles   int       `json:"uniqueTiles"`
	TileSlots     int       `json:"tileSlots"`
	ExactPixels   int       `json:"exactPixels"`
	NearestPixels int       `json:"nearestPixels"`
	Starts        []start   `json:"starts"`
	SelfCheck     selfCheck `json:"selfCheck"`
}

type selfCheck struct {
	TNT     bool `json:"tnt"`
	OTA     bool `json:"ota"`
	Archive bool `json:"archive"`
}

func main() {
	if err := run(); err != nil {
		fmt.Fprintln(os.Stderr, "map-export:", err)
		os.Exit(1)
	}
}

func run() error {
	var roots rootsFlag
	flag.Var(&roots, "root", "game content root, repeatable; later roots win (default ~/TotalAnnihilation)")
	catalogOnly := flag.Bool("catalog", false, "print installed worlds, palette and map names as JSON")
	input := flag.String("input", "", "local JSON export manifest")
	out := flag.String("out", "", "output directory for the UFO and indexed PNG")
	flag.Parse()
	if flag.NArg() != 0 || (*catalogOnly && (*input != "" || *out != "")) || (!*catalogOnly && (*input == "" || *out == "")) {
		return fmt.Errorf("use --catalog, or --input PATH --out DIR; --root may be repeated")
	}
	if len(roots) == 0 {
		home, err := os.UserHomeDir()
		if err != nil {
			return err
		}
		roots = append(roots, filepath.Join(home, "TotalAnnihilation"))
	}
	fs := vfs.New()
	defer fs.Close()
	if err := fs.MountGameDirectories(roots); err != nil {
		return err
	}
	catalog, err := readCatalog(fs)
	if err != nil {
		return err
	}
	if *catalogOnly {
		return json.NewEncoder(os.Stdout).Encode(catalog)
	}
	req, err := readRequest(*input)
	if err != nil {
		return err
	}
	if err := refuseRootOutput(*out, roots); err != nil {
		return err
	}
	result, err := exportMap(req, catalog, filepath.Dir(*input), *out)
	if err != nil {
		return err
	}
	return json.NewEncoder(os.Stdout).Encode(result)
}

func readRequest(name string) (exportRequest, error) {
	var req exportRequest
	f, err := os.Open(name)
	if err != nil {
		return req, err
	}
	defer f.Close()
	decoder := json.NewDecoder(io.LimitReader(f, 4<<20))
	decoder.DisallowUnknownFields()
	if err := decoder.Decode(&req); err != nil {
		return req, fmt.Errorf("manifest %s: %w", name, err)
	}
	var extra any
	if err := decoder.Decode(&extra); err != io.EOF {
		return req, fmt.Errorf("manifest %s: expected one JSON object", name)
	}
	return req, nil
}

func validateRequest(req exportRequest, catalog catalog) (worldInfo, error) {
	if err := validateName(req.Name); err != nil {
		return worldInfo{}, err
	}
	if err := validateText("description", req.Description); err != nil {
		return worldInfo{}, err
	}
	for _, name := range catalog.InstalledNames {
		if strings.EqualFold(name, req.Name) {
			return worldInfo{}, fmt.Errorf("an installed map already uses the name %q", req.Name)
		}
	}
	world, ok := catalog.Worlds[req.World]
	if !ok {
		return worldInfo{}, fmt.Errorf("unknown editor world %q", req.World)
	}
	if world.DisabledReason != "" {
		return worldInfo{}, fmt.Errorf("world %s cannot export: %s", req.World, world.DisabledReason)
	}
	if req.UnitsX < 1 || req.UnitsX > 4 || req.UnitsY < 1 || req.UnitsY > 4 {
		return worldInfo{}, fmt.Errorf("phase 1 expects 1..4 units on each axis, got %dx%d", req.UnitsX, req.UnitsY)
	}
	if req.SeaLevel == nil || *req.SeaLevel < 0 || *req.SeaLevel > 255 {
		return worldInfo{}, fmt.Errorf("seaLevel must be an integer byte (0..255)")
	}
	w, h := req.UnitsX*32+2, req.UnitsY*32+8
	if len(req.Heights) != w*h {
		return worldInfo{}, fmt.Errorf("got %d corner heights, expected %d for %dx%d cells", len(req.Heights), w*h, w, h)
	}
	for i, height := range req.Heights {
		if height < 0 || height > 255 {
			return worldInfo{}, fmt.Errorf("corner height at cell (%d,%d) is %d, expected 0..255; clamp in the editor before export", i%w, i/w, height)
		}
	}
	return world, nil
}

func validateName(name string) error {
	if name == "" || len(name) > 80 || strings.TrimSpace(name) != name || strings.HasSuffix(name, ".") {
		return fmt.Errorf("name must have 1..80 ASCII characters, without outer whitespace or a trailing dot")
	}
	for _, r := range name {
		if r >= 'A' && r <= 'Z' || r >= 'a' && r <= 'z' || r >= '0' && r <= '9' || strings.ContainsRune(" -_'().,!&+", r) {
			continue
		}
		return fmt.Errorf("name %q contains a character unsafe in a map filename", name)
	}
	base := strings.ToUpper(strings.SplitN(name, ".", 2)[0])
	if base == "CON" || base == "PRN" || base == "AUX" || base == "NUL" || len(base) == 4 && (strings.HasPrefix(base, "COM") || strings.HasPrefix(base, "LPT")) && base[3] >= '1' && base[3] <= '9' {
		return fmt.Errorf("name %q is reserved by Windows", name)
	}
	return validateText("name", name)
}

func validateText(field, value string) error {
	if strings.ContainsAny(value, "[]{};=\r\n") || strings.Contains(value, "//") || strings.Contains(value, "/*") {
		return fmt.Errorf("%s contains a TDF-reserved character or comment opener", field)
	}
	for _, r := range value {
		if r < 32 || r == 127 {
			return fmt.Errorf("%s contains a control character", field)
		}
	}
	return nil
}

func exportMap(req exportRequest, catalog catalog, manifestDir, out string) (*exportResult, error) {
	world, err := validateRequest(req, catalog)
	if err != nil {
		return nil, err
	}
	t, picture, exact, nearest, err := terrain(req, manifestDir, catalog.Palette)
	if err != nil {
		return nil, err
	}
	// The fixed pair leaves a 256px margin on normal maps. A one-unit axis
	// uses 128px instead, so its two starts remain distinct and in bounds.
	playW, playH := req.UnitsX*512, req.UnitsY*512
	mx, mz := min(256, playW/4), min(256, playH/4)
	starts := []start{{mx, mz}, {playW - mx, playH - mz}}
	ota, err := encodeOTA(req, world, starts)
	if err != nil {
		return nil, err
	}
	tnt, err := formats.EncodeTNT(t)
	if err != nil {
		return nil, err
	}
	otaPath, tntPath := "maps/"+req.Name+".ota", "maps/"+req.Name+".tnt"
	var archive bytes.Buffer
	// Stored method 0 is accepted directly; no SQSH decoder is involved
	// [fmt hpi] "Stored files (compression 0)".
	if err := vfs.WriteArchive(&archive, []vfs.ArchiveFile{{Path: otaPath, Data: ota}, {Path: tntPath, Data: tnt}}, vfs.ArchiveWriteOptions{Compress: false}); err != nil {
		return nil, err
	}
	if err := os.MkdirAll(out, 0o755); err != nil {
		return nil, err
	}
	archiveName, indexedName := req.Name+".ufo", req.Name+"-indexed.png"
	entries, err := os.ReadDir(out)
	if err != nil {
		return nil, err
	}
	for _, entry := range entries {
		if strings.EqualFold(entry.Name(), archiveName) || strings.EqualFold(entry.Name(), indexedName) {
			return nil, fmt.Errorf("export %q already exists in %s; choose a new name", entry.Name(), out)
		}
	}
	archiveTemp, err := stageFile(out, func(w io.Writer) error { _, err := w.Write(archive.Bytes()); return err })
	if err != nil {
		return nil, err
	}
	defer os.Remove(archiveTemp)
	indexedTemp, err := stageFile(out, func(w io.Writer) error {
		encoder := png.Encoder{CompressionLevel: png.BestSpeed}
		return encoder.Encode(w, picture)
	})
	if err != nil {
		return nil, err
	}
	defer os.Remove(indexedTemp)
	checked, err := checkArchive(archiveTemp, req, world, starts, t, ota, tnt)
	if err != nil {
		return nil, fmt.Errorf("archive self-check: %w", err)
	}
	// A hard link publishes the complete file atomically and refuses an
	// existing destination, including one created since the directory scan.
	indexedDest := filepath.Join(out, indexedName)
	if err := os.Link(indexedTemp, indexedDest); err != nil {
		return nil, err
	}
	if err := os.Link(archiveTemp, filepath.Join(out, archiveName)); err != nil {
		os.Remove(indexedDest) // only the file this call just published
		return nil, err
	}
	return &exportResult{
		Name: req.Name, Archive: archiveName, Indexed: indexedName,
		WidthCells: t.Width, HeightCells: t.Height,
		UniqueTiles: len(t.TileGraphics) / 1024, TileSlots: len(t.TileIndices),
		ExactPixels: exact, NearestPixels: nearest, Starts: starts, SelfCheck: checked,
	}, nil
}

func stageFile(out string, write func(io.Writer) error) (string, error) {
	f, err := os.CreateTemp(out, ".map-export-*")
	if err != nil {
		return "", err
	}
	name := f.Name()
	err = write(f)
	if err == nil {
		err = f.Chmod(0o644)
	}
	if err == nil {
		err = f.Sync()
	}
	err = errors.Join(err, f.Close())
	if err != nil {
		os.Remove(name)
		return "", err
	}
	return name, nil
}

// Resolve even a not-yet-created output through its nearest existing parent,
// so a symlink cannot direct export files into a read-only content root.
func resolvedHostPath(name string) (string, error) {
	abs, err := filepath.Abs(name)
	if err != nil {
		return "", err
	}
	var suffix []string
	for {
		resolved, err := filepath.EvalSymlinks(abs)
		if err == nil {
			for i := len(suffix) - 1; i >= 0; i-- {
				resolved = filepath.Join(resolved, suffix[i])
			}
			return resolved, nil
		}
		if !errors.Is(err, os.ErrNotExist) || filepath.Dir(abs) == abs {
			return "", err
		}
		suffix = append(suffix, filepath.Base(abs))
		abs = filepath.Dir(abs)
	}
}

func refuseRootOutput(out string, roots []string) error {
	output, err := resolvedHostPath(out)
	if err != nil {
		return err
	}
	for _, root := range roots {
		resolved, err := resolvedHostPath(root)
		if err != nil {
			return err
		}
		// Content roots may live on a case-insensitive volume (including the
		// usual macOS install), so also refuse differently cased spellings.
		rel, err := filepath.Rel(strings.ToLower(resolved), strings.ToLower(output))
		if err != nil {
			return err
		}
		if rel != ".." && !strings.HasPrefix(rel, ".."+string(filepath.Separator)) {
			return fmt.Errorf("output %s is inside content root %s; export to a separate directory", out, root)
		}
	}
	return nil
}
