// Command export turns a terrain editor manifest into a playable map.
package main

import (
	"context"
	"encoding/json"
	"errors"
	"flag"
	"fmt"
	"io"
	"os"
	"os/signal"
	"path/filepath"
	"strings"
	"syscall"

	"github.com/nanolathe-gg/nanolathe/vfs"
	"github.com/nanolathe-gg/terra/mapdata"
)

type rootsFlag []string

func (r *rootsFlag) String() string { return strings.Join(*r, ", ") }
func (r *rootsFlag) Set(s string) error {
	*r = append(*r, s)
	return nil
}

type exportRequest struct {
	Name        string             `json:"name"`
	Description string             `json:"description"`
	World       string             `json:"world"`
	UnitsX      int                `json:"unitsX"`
	UnitsY      int                `json:"unitsY"`
	SeaLevel    *int               `json:"seaLevel"`
	Heights     []int              `json:"heights"`
	Chunks      []chunk            `json:"chunks"`
	Features    []featurePlacement `json:"features"`
	Starts      requestedStarts    `json:"starts"`
	Settings    requestedSettings  `json:"settings"`
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
	Name          string        `json:"name"`
	Archive       string        `json:"archive"`
	Indexed       string        `json:"indexed"`
	WidthCells    int           `json:"widthCells"`
	HeightCells   int           `json:"heightCells"`
	UniqueTiles   int           `json:"uniqueTiles"`
	Merge         *mergeSummary `json:"merge,omitempty"`
	TileSlots     int           `json:"tileSlots"`
	ExactPixels   int           `json:"exactPixels"`
	NearestPixels int           `json:"nearestPixels"`
	FeatureCount  int           `json:"featureCount"`
	Starts        []start       `json:"starts"`
	SelfCheck     selfCheck     `json:"selfCheck"`
	Metrics       exportMetrics `json:"metrics"`
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
	catalogFile := flag.String("catalog-file", "", "read the worlds, palette and map names from a saved --catalog JSON instead of the content roots' maps")
	input := flag.String("input", "", "local JSON export manifest")
	out := flag.String("out", "", "output directory for the UFO and indexed PNG")
	featuresRoot := flag.String("features-root", "", "directory holding the map's feature pack (pack.json, written by the editor), required for placed features")
	stream := flag.Bool("stream", false, "accept chunk/finish JSON commands on stdin, replying once per command")
	work := flag.String("work", "", "private temporary directory (default OS temporary directory)")
	tileBudget := flag.Int("tile-budget-mb", 16, "unique tile bytes retained in RAM before spilling (0..64 MiB)")
	flag.Parse()
	if flag.NArg() != 0 || (*catalogOnly && (*input != "" || *out != "" || *stream)) || (!*catalogOnly && (*input == "" || *out == "")) || *tileBudget < 0 || *tileBudget > 64 {
		return fmt.Errorf("use --catalog, or --input PATH --out DIR; --root may be repeated")
	}
	if len(roots) == 0 {
		home, err := os.UserHomeDir()
		if err != nil {
			return err
		}
		roots = append(roots, filepath.Join(home, "TotalAnnihilation"))
	}
	// A saved catalogue gives the same climate and sea-level medians without
	// the game content, so an export with one reads none (the browser's
	// exporter, this program built for WebAssembly, has none to read).
	var catalog catalog
	if *catalogFile != "" {
		if err := mapdata.ReadJSON(*catalogFile, &catalog); err != nil {
			return err
		}
	} else {
		fs := vfs.New()
		defer fs.Close()
		if err := fs.MountGameDirectories(roots); err != nil {
			return err
		}
		var err error
		if catalog, err = readCatalog(fs); err != nil {
			return err
		}
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
	pack, err := readExportFeatures(*featuresRoot, req)
	if err != nil {
		return err
	}
	ctx, cancel := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer cancel()
	if *stream {
		return runStream(ctx, req, catalog, *out, *work, *tileBudget<<20, pack)
	}
	result, err := exportMap(ctx, req, catalog, filepath.Dir(*input), *out, *work, *tileBudget<<20, pack)
	if err != nil {
		return err
	}
	return json.NewEncoder(os.Stdout).Encode(result)
}

// A map has at most maxUnits units on each side.
const maxUnits = 40

// The largest valid manifest: the largest map's corner heights and a feature
// on every play cell (footprints never overlap), as JSON of at most 5 bytes a
// height ("255, ") and 80 a placement (a name of at most 31 characters, two
// four-digit coordinates and spacing), plus 1 MiB for the name, description,
// settings and starts: about 134 MiB.
const maxManifestBytes = (maxUnits*32+2)*(maxUnits*32+8)*5 + (maxUnits*32)*(maxUnits*32)*80 + 1<<20

func readRequest(name string) (exportRequest, error) { return readManifest(name, maxManifestBytes) }

func readManifest(name string, limit int64) (exportRequest, error) {
	var req exportRequest
	f, err := os.Open(name)
	if err != nil {
		return req, err
	}
	defer f.Close()
	in := &io.LimitedReader{R: f, N: limit + 1}
	tooLarge := func() error {
		return fmt.Errorf("manifest %s is larger than %d MiB, more than a %dx%d-unit map with a feature on every cell needs", name, limit>>20, maxUnits, maxUnits)
	}
	decoder := json.NewDecoder(in)
	decoder.DisallowUnknownFields()
	if err := decoder.Decode(&req); err != nil {
		if in.N == 0 {
			return req, tooLarge()
		}
		return req, fmt.Errorf("manifest %s: %w", name, err)
	}
	var extra any
	if err := decoder.Decode(&extra); err != io.EOF {
		if in.N == 0 {
			return req, tooLarge()
		}
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
	if req.UnitsX < 1 || req.UnitsX > maxUnits || req.UnitsY < 1 || req.UnitsY > maxUnits {
		return worldInfo{}, fmt.Errorf("expected 1..%d units on each axis, got %dx%d", maxUnits, req.UnitsX, req.UnitsY)
	}
	if cells := req.UnitsX * 32 * req.UnitsY * 32; len(req.Features) > cells {
		return worldInfo{}, fmt.Errorf("%d features for %d play cells; feature footprints cannot overlap", len(req.Features), cells)
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
	if req.Settings.Present {
		if err := validateSettings(&req.Settings.Value); err != nil {
			return worldInfo{}, err
		}
		world.Climate = &req.Settings.Value
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
		// The game reads the OTA as single-byte text.
		if r > 126 {
			return fmt.Errorf("%s contains %q; the game reads map text as plain ASCII: use English letters, digits, spaces and keyboard punctuation", field, r)
		}
	}
	return nil
}

func exportMap(ctx context.Context, req exportRequest, catalog catalog, manifestDir, out, work string, tileBudget int, pack *packedFeatures) (*exportResult, error) {
	s, err := newTerrainStream(ctx, req, catalog, out, work, tileBudget, pack)
	if err != nil {
		return nil, err
	}
	defer s.close()
	chunks, err := prepareChunks(req.Chunks, manifestDir, s.width*16, s.height*16)
	if err != nil {
		return nil, err
	}
	for _, chunk := range chunks {
		if err := s.add(chunk); err != nil {
			return nil, err
		}
	}
	return s.finish()
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
