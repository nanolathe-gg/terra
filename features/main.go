// Command features prepares retail-derived sprite catalogues for the editor.
package main

import (
	"encoding/json"
	"flag"
	"fmt"
	"io"
	"os"
	"path"
	"path/filepath"
	"slices"
	"strings"

	"github.com/nanolathe-gg/nanolathe/formats"
	"github.com/nanolathe-gg/nanolathe/vfs"
	"github.com/nanolathe-gg/terraform/internal/featuredef"
	"github.com/nanolathe-gg/terraform/mapdata"
)

type rootsFlag []string

func (r *rootsFlag) String() string     { return strings.Join(*r, ", ") }
func (r *rootsFlag) Set(s string) error { *r = append(*r, s); return nil }

type sourceWorld struct {
	Planet         string   `json:"planet"`
	Sources        []string `json:"sources"`
	DisabledReason string   `json:"disabledReason"`
}

type sourceCatalog struct {
	Worlds  map[string]sourceWorld `json:"worlds"`
	Palette [256][3]byte           `json:"palette"`
}

func main() {
	if err := run(); err != nil {
		fmt.Fprintln(os.Stderr, "map-features:", err)
		os.Exit(1)
	}
}

func run() error {
	var roots rootsFlag
	flag.Var(&roots, "root", "game content root, repeatable; later roots win (default ~/TotalAnnihilation)")
	input := flag.String("catalog", "", "JSON from map-export --catalog")
	world := flag.String("world", "", "editor world ID")
	out := flag.String("out", "", "feature catalogue root directory")
	flag.Parse()
	if flag.NArg() != 0 || *input == "" || *world == "" || *out == "" {
		return fmt.Errorf("use --catalog PATH --world ID --out DIR; --root may be repeated")
	}
	for _, c := range *world {
		if c < 'a' || c > 'z' {
			return fmt.Errorf("world must be a lowercase editor world ID")
		}
	}
	var catalog sourceCatalog
	if err := mapdata.ReadJSON(*input, &catalog); err != nil {
		return err
	}
	info, ok := catalog.Worlds[*world]
	if !ok {
		return fmt.Errorf("unknown editor world %q", *world)
	}
	if info.DisabledReason != "" {
		return fmt.Errorf("world %s cannot prepare features: %s", *world, info.DisabledReason)
	}
	if info.Planet == "" || len(info.Sources) == 0 {
		return fmt.Errorf("world %s has no planet or source maps", *world)
	}
	if len(roots) == 0 {
		home, err := os.UserHomeDir()
		if err != nil {
			return err
		}
		roots = append(roots, filepath.Join(home, "TotalAnnihilation"))
	}
	if err := refuseContentOutput(filepath.Join(*out, *world), roots); err != nil {
		return err
	}
	fs := vfs.New()
	defer fs.Close()
	if err := fs.MountGameDirectories(roots); err != nil {
		return err
	}
	defs, err := featuredef.Read(fs)
	if err != nil {
		return err
	}
	uses, spelled, err := sourceUses(fs, info)
	if err != nil {
		return err
	}
	result, err := buildCatalog(fs, *world, info.Planet, uses, spelled, defs, catalog.Palette, filepath.Join(*out, *world))
	if err != nil {
		return err
	}
	data, err := json.MarshalIndent(result, "", "  ")
	if err != nil {
		return err
	}
	if err := publish(filepath.Join(*out, *world, "catalog.json"), func(w io.Writer) error { _, err := w.Write(append(data, '\n')); return err }); err != nil {
		return err
	}
	return json.NewEncoder(os.Stdout).Encode(result)
}

// Match mapgenSource's census: count live TNT anchors in the play area,
// excluding the engine's right/bottom strips, authored voids and legacy
// painted-metal cells. OTA schema variants do not change these weights.
func sourceUses(fs *vfs.FS, info sourceWorld) (map[string]int, map[string]string, error) {
	uses, spelled := map[string]int{}, map[string]string{}
	seen := map[string]bool{}
	for _, otaPath := range info.Sources {
		if !strings.EqualFold(path.Ext(otaPath), ".ota") {
			return nil, nil, fmt.Errorf("source %q is not an OTA path", otaPath)
		}
		key := strings.ToLower(otaPath)
		if seen[key] {
			return nil, nil, fmt.Errorf("duplicate source %s", otaPath)
		}
		seen[key] = true
		ota, err := formats.LoadOTAFile(fs, otaPath)
		if err != nil {
			return nil, nil, err
		}
		planet, _ := ota.Global.StringValue("planet", "")
		if !strings.EqualFold(strings.TrimSpace(planet), info.Planet) {
			return nil, nil, fmt.Errorf("source %s belongs to planet %q, expected %q", otaPath, planet, info.Planet)
		}
		name := strings.TrimSuffix(otaPath, path.Ext(otaPath)) + ".tnt"
		tnt, err := formats.LoadTNTFile(fs, name)
		if err != nil {
			return nil, nil, fmt.Errorf("read source %s: %w", name, err)
		}
		for _, rec := range tnt.FeatureTable {
			k := featuredef.Key(rec.Name)
			if spelled[k] == "" {
				spelled[k] = strings.TrimSpace(rec.Name)
			}
		}
		w, h := int(tnt.Width), int(tnt.Height)
		for i, a := range tnt.Attributes {
			if i%w >= w-2 || i/w >= h-8 || a.Feature == 0xFFFC || a.Metal > 0 || int(a.Feature) >= len(tnt.FeatureTable) {
				continue
			}
			uses[featuredef.Key(tnt.FeatureTable[a.Feature].Name)]++
		}
	}
	return uses, spelled, nil
}

func buildCatalog(fs vfs.FSOps, world, planet string, uses map[string]int, spelled map[string]string, defs map[string]*featuredef.Def, palette [256][3]byte, out string) (mapdata.FeatureCatalog, error) {
	result := mapdata.FeatureCatalog{World: world, Planet: planet, Features: []mapdata.Feature{}}
	keys := make([]string, 0, len(uses))
	for key := range uses {
		keys = append(keys, key)
	}
	slices.SortFunc(keys, func(a, b string) int {
		if uses[a] != uses[b] {
			return uses[b] - uses[a]
		}
		return strings.Compare(a, b)
	})
	if err := os.MkdirAll(out, 0o755); err != nil {
		return result, err
	}
	banks := map[string]*formats.GAF{}
	for _, key := range keys {
		d := defs[key]
		if d == nil || d.Filename == "" || d.SeqName == "" || d.Object != "" || d.FootprintX < 1 || d.FootprintZ < 1 {
			continue
		}
		filename := "anims/" + d.Filename + ".gaf"
		bank := banks[filename]
		if bank == nil {
			var err error
			bank, err = formats.LoadGAFDecodedFile(fs, filename)
			if err != nil {
				return result, fmt.Errorf("feature %s: %w", spelled[key], err)
			}
			banks[filename] = bank
		}
		frame, err := firstFrame(bank, d.SeqName)
		if err != nil {
			continue // No first frame means this used record has no drawn sprite.
		}
		picture, xoff, yoff, drawn, err := spriteImage(frame, palette)
		if err != nil {
			return result, fmt.Errorf("feature %s: %w", spelled[key], err)
		}
		if !drawn {
			continue
		}
		f := mapdata.Feature{Name: spelled[key], FootprintX: int(d.FootprintX), FootprintZ: int(d.FootprintZ), Metal: int(d.Metal), Energy: int(d.Energy), Blocking: d.Blocking, Reclaimable: d.Reclaimable, Indestructible: d.Indestructible, Uses: uses[key], Kind: featureKind(d), AnimTrans: int(d.AnimTrans), ShadTrans: int(d.ShadTrans)}
		if result.DepositName == "" && f.Kind == "deposit" {
			result.DepositName = f.Name
		}
		basename := safeBasename(key)
		f.Sprite, err = writeSprite(out, world, basename+".png", picture, xoff, yoff)
		if err != nil {
			return result, err
		}
		// Some definitions name a shadow sequence with no frame. There is
		// no shadow PNG to include in that case; retain shadow:null.
		if shadow, shadowErr := firstFrame(bank, d.SeqNameShad); d.SeqNameShad != "" && shadowErr == nil {
			img, sx, sy, _, err := spriteImage(shadow, palette)
			if err != nil {
				return result, fmt.Errorf("feature %s shadow: %w", f.Name, err)
			}
			if img != nil {
				spr, err := writeSprite(out, world, basename+"-shadow.png", img, sx, sy)
				if err != nil {
					return result, err
				}
				f.Shadow = &spr
			}
		}
		result.Features = append(result.Features, f)
	}
	return result, nil
}

// Follow cmd/nanolathe/mapgen_world.go mapgenFeatures, retaining every drawn
// member rather than its generator-only limit of eight per vegetation kind.
func featureKind(d *featuredef.Def) string {
	switch {
	case d.Indestructible && d.Metal > 0 && d.FootprintX >= 2 && d.FootprintZ >= 2 && !d.Blocking:
		return "deposit"
	case d.Indestructible || !d.Reclaimable || d.FootprintX > 3 || d.FootprintZ > 3:
		return "other"
	case d.Blocking && d.Metal == 0 && d.Energy > 0:
		return "tree"
	case !d.Blocking && d.Metal == 0 && d.Energy > 0:
		return "foliage"
	case d.Metal > 0 && d.Energy == 0:
		return "rock"
	default:
		return "other"
	}
}

func firstFrame(bank *formats.GAF, name string) (*formats.GAFFrame, error) {
	entry, ok := bank.Find(name)
	if !ok || len(entry.Frames) == 0 || entry.Frames[0].Frame == nil {
		return nil, fmt.Errorf("missing first frame of GAF sequence %q", name)
	}
	return entry.Frames[0].Frame, nil
}
