package main

import (
	"bytes"
	"fmt"
	"path/filepath"
	"regexp"
	"strconv"
	"strings"

	"github.com/nanolathe-gg/nanolathe/formats"
	"github.com/nanolathe-gg/nanolathe/vfs"
	"github.com/nanolathe-gg/terraform/mapdata"
)

// A map's generated features (owner, November 2026: each map carries its own set). The page draws every sprite with
// sculpt-feature-gen.js and sends them as a pack: the feature sections and the frames of their sequences. The exporter checks
// the pack, writes it as the map's own feature file and sprite bank (features/<bank>/<bank>.tdf, anims/<bank>.gaf) and names
// the placed features in the TNT. The ideas are prototype/featproto's featpack, whose maps loaded and played in Nanolathe: one
// prefix per map so two maps never share a name, bank names unlike retail's, every successor (burnt, dead, reclaimed) in the
// pack, and painted deposits and vents carried by a feature whose only frame is one transparent pixel, as retail's Geothermal.
type featurePack struct {
	Prefix    string         `json:"prefix"`
	Defs      []packDef      `json:"defs"`
	Sequences []packSequence `json:"sequences"`
}

type packDef struct {
	Name string      `json:"name"`
	Keys [][2]string `json:"keys"`
}

type packSequence struct {
	Name   string      `json:"name"`
	Frames []packFrame `json:"frames"`
}

// A frame's palette indices, its drawn pixels (1) against the transparent ones (0), its anchor inside it (the GAF frame's
// offsets) and its display count in ticks.
type packFrame struct {
	Width    int    `json:"width"`
	Height   int    `json:"height"`
	X        int    `json:"x"`
	Y        int    `json:"y"`
	Duration int    `json:"duration"`
	Pixels   []byte `json:"pixels"`
	Opaque   []byte `json:"opaque"`
}

// What the TNT and the archive need of a checked pack: the placed features' footprints by folded name, the files, and the
// sections and sequences they hold (for the archive's self-check).
type packedFeatures struct {
	defs      map[string]packedDef
	files     []vfs.ArchiveFile
	tdf, gaf  string
	sections  []string
	sequences map[string]int // sequence name -> frame count
}

type packedDef struct {
	name       string
	footprintX int
	footprintZ int
}

var (
	packPrefix  = regexp.MustCompile(`^TF[A-Za-z0-9]{1,6}$`)
	packName    = regexp.MustCompile(`^[A-Za-z0-9]{1,31}$`)
	packSeqName = regexp.MustCompile(`^[a-z0-9]{1,31}$`)
	// Retail banks the spec names (doc 05 R-FEAT-01 section 1); a pack's bank starts with "tf", which no retail bank does.
	retailBanks = map[string]bool{"trees": true, "rocks": true, "rockshurt": true, "rockshurt2": true, "rocksdead": true, "rockrecscars": true, "geotherm": true, "greenvents": true}
	// The keys a section may set, with their bounds. Others are inert in retail (spec section 4) or not ours to set.
	packIntegers = map[string][2]int{
		"footprintx": {1, 16}, "footprintz": {1, 16}, "height": {0, 255}, "energy": {0, 100000}, "metal": {0, 255}, "damage": {0, 1 << 30},
		"animating": {0, 1}, "animtrans": {0, 1}, "shadtrans": {0, 1}, "flamable": {0, 1}, "reclaimable": {0, 1}, "blocking": {0, 1},
		"indestructible": {0, 1}, "geothermal": {0, 1}, "sparktime": {0, 100}, "spreadchance": {0, 100}, "reproduce": {0, 0},
	}
	packSequenceKeys  = map[string]bool{"seqname": true, "seqnameshad": true, "seqnameburn": true}
	packSuccessorKeys = map[string]bool{"featuredead": true, "featureburnt": true, "featurereclamate": true}
	packWeapons       = map[string]bool{"TreeBurn": true, "ShrubBurn": true} // retail's own burn weapons, in every install
)

// readExportFeatures reads the pack the page wrote (<root>/pack.json) when features are placed, checks it, and keeps only what the
// placed features reach.
func readExportFeatures(root string, req exportRequest) (*packedFeatures, error) {
	if len(req.Features) == 0 {
		return nil, nil
	}
	if root == "" {
		return nil, fmt.Errorf("--features-root DIR (holding pack.json) is required when features are placed")
	}
	var pack featurePack
	if err := mapdata.ReadJSONLimit(filepath.Join(root, "pack.json"), &pack, 256<<20); err != nil {
		return nil, fmt.Errorf("feature pack: %w", err)
	}
	placed := make([]string, len(req.Features))
	for i, p := range req.Features {
		placed[i] = p.Name
	}
	return checkPack(pack, placed)
}

func featureKey(name string) string { return formats.FoldASCII(strings.TrimSpace(name)) }

func checkPack(pack featurePack, placed []string) (*packedFeatures, error) {
	if !packPrefix.MatchString(pack.Prefix) {
		return nil, fmt.Errorf("feature prefix %q must be TF and 1-6 letters or digits", pack.Prefix)
	}
	bank := strings.ToLower(pack.Prefix)
	if retailBanks[bank] {
		return nil, fmt.Errorf("feature bank %q is a retail bank's name", bank)
	}
	sequences := map[string]*packSequence{}
	for i := range pack.Sequences {
		s := &pack.Sequences[i]
		if !packSeqName.MatchString(s.Name) || sequences[s.Name] != nil {
			return nil, fmt.Errorf("sequence name %q must be unique, 1-31 lower-case letters or digits", s.Name)
		}
		if len(s.Frames) < 1 || len(s.Frames) > 256 {
			return nil, fmt.Errorf("sequence %s has %d frames, expected 1..256", s.Name, len(s.Frames))
		}
		for j, f := range s.Frames {
			if f.Width < 1 || f.Height < 1 || f.Width > 1024 || f.Height > 1024 || len(f.Pixels) != f.Width*f.Height || len(f.Opaque) != f.Width*f.Height {
				return nil, fmt.Errorf("sequence %s frame %d: %dx%d with %d pixels and %d mask bytes", s.Name, j, f.Width, f.Height, len(f.Pixels), len(f.Opaque))
			}
			if f.X < -32768 || f.X > 32767 || f.Y < -32768 || f.Y > 32767 || f.Duration < 1 || f.Duration > 255 {
				return nil, fmt.Errorf("sequence %s frame %d: offset or duration out of range", s.Name, j)
			}
		}
		sequences[s.Name] = s
	}
	defs := map[string]*packDef{}
	for i := range pack.Defs {
		d := &pack.Defs[i]
		key := featureKey(d.Name)
		if !packName.MatchString(d.Name) || !strings.HasPrefix(key, featureKey(pack.Prefix)) || defs[key] != nil {
			return nil, fmt.Errorf("feature name %q must be unique, start with %s and use at most 31 letters or digits", d.Name, pack.Prefix)
		}
		defs[key] = d
	}
	get := func(d *packDef, key string) string {
		for _, kv := range d.Keys {
			if kv[0] == key {
				return kv[1]
			}
		}
		return ""
	}
	// Every placed feature, and every successor it names, transitively.
	want, order := map[string]bool{}, []string{}
	queue := append([]string(nil), placed...)
	for len(queue) > 0 {
		key := featureKey(queue[0])
		queue = queue[1:]
		if want[key] {
			continue
		}
		d := defs[key]
		if d == nil {
			return nil, fmt.Errorf("feature %q is not in the map's feature pack", key)
		}
		want[key] = true
		for _, kv := range d.Keys {
			if packSuccessorKeys[kv[0]] {
				queue = append(queue, kv[1])
			}
		}
	}
	out := &packedFeatures{defs: map[string]packedDef{}, sequences: map[string]int{}, tdf: "features/" + bank + "/" + bank + ".tdf", gaf: "anims/" + bank + ".gaf"}
	usedSequences := map[string]bool{}
	var sections []*formats.TDFWriteSection
	for _, d := range pack.Defs {
		key := featureKey(d.Name)
		if !want[key] {
			continue
		}
		order = append(order, d.Name)
		section := &formats.TDFWriteSection{Name: d.Name}
		seen := map[string]bool{}
		for _, kv := range d.Keys {
			k, v := kv[0], kv[1]
			if seen[k] {
				return nil, fmt.Errorf("%s sets %s twice", d.Name, k)
			}
			seen[k] = true
			bounds, integer := packIntegers[k]
			switch {
			case integer:
				if n, err := strconv.Atoi(v); err != nil || n < bounds[0] || n > bounds[1] {
					return nil, fmt.Errorf("%s: %s=%q, expected an integer %d..%d", d.Name, k, v, bounds[0], bounds[1])
				}
			case k == "description":
				if len(v) == 0 || len(v) > 19 || !packText(v) {
					return nil, fmt.Errorf("%s: description %q must be 1..19 plain characters", d.Name, v)
				}
			case k == "filename":
				if v != bank {
					return nil, fmt.Errorf("%s: filename %q, expected the map's bank %q", d.Name, v, bank)
				}
			case packSequenceKeys[k]:
				if sequences[v] == nil {
					return nil, fmt.Errorf("%s: %s names %q, which the pack does not draw", d.Name, k, v)
				}
				usedSequences[v] = true
			case packSuccessorKeys[k]:
				if !want[featureKey(v)] {
					return nil, fmt.Errorf("%s: %s names %q, which the pack does not define", d.Name, k, v)
				}
			case k == "burnweapon":
				if !packWeapons[v] {
					return nil, fmt.Errorf("%s: burnweapon %q is not a retail burn weapon", d.Name, v)
				}
			default:
				return nil, fmt.Errorf("%s: key %q is not one a generated feature sets", d.Name, k)
			}
			section.Set(k, v)
		}
		for _, k := range []string{"footprintx", "footprintz", "filename", "seqname"} {
			if !seen[k] {
				return nil, fmt.Errorf("%s does not set %s", d.Name, k)
			}
		}
		fx, _ := strconv.Atoi(get(&d, "footprintx"))
		fz, _ := strconv.Atoi(get(&d, "footprintz"))
		out.defs[key] = packedDef{name: d.Name, footprintX: fx, footprintZ: fz}
		sections = append(sections, section)
	}
	tdf, err := formats.EncodeTDF(sections...)
	if err != nil {
		return nil, err
	}
	var entries []formats.GAFWriteEntry
	for _, s := range pack.Sequences {
		if !usedSequences[s.Name] {
			continue
		}
		entry := formats.GAFWriteEntry{Name: s.Name, Loop: true}
		for _, f := range s.Frames {
			transparent := make([]bool, len(f.Opaque))
			for i, a := range f.Opaque {
				transparent[i] = a == 0
			}
			entry.Frames = append(entry.Frames, formats.GAFWriteFrame{Width: uint16(f.Width), Height: uint16(f.Height), XOffset: int16(f.X), YOffset: int16(f.Y),
				Duration: uint32(f.Duration), Pixels: f.Pixels, Transparent: transparent})
		}
		entries = append(entries, entry)
		out.sequences[s.Name] = len(s.Frames)
	}
	gaf, err := formats.EncodeGAF(entries)
	if err != nil {
		return nil, fmt.Errorf("sprite bank %s: %w", bank, err)
	}
	out.sections = order
	out.files = []vfs.ArchiveFile{{Path: out.gaf, Data: gaf}, {Path: out.tdf, Data: tdf}}
	return out, nil
}

func packText(v string) bool {
	for _, r := range v {
		if r < 32 || r > 126 || strings.ContainsRune("[]{};=", r) {
			return false
		}
	}
	return !strings.Contains(v, "//") && !strings.Contains(v, "/*")
}

// checkPackFiles reads the archive's feature files back as the game does: the sections parse and are all there, each names this
// bank, and the bank holds every sequence they name with the frames the pack drew.
func checkPackFiles(fs *vfs.FS, p *packedFeatures) error {
	for _, f := range p.files {
		got, err := fs.ReadFile(f.Path)
		if err != nil {
			return err
		}
		if !bytes.Equal(got, f.Data) {
			return fmt.Errorf("archive %s differs", f.Path)
		}
	}
	doc, err := formats.ParseTDF(p.files[1].Data)
	if err != nil {
		return fmt.Errorf("%s: %w", p.tdf, err)
	}
	sections := doc.Root.Sections()
	if len(sections) != len(p.sections) {
		return fmt.Errorf("%s holds %d sections, expected %d", p.tdf, len(sections), len(p.sections))
	}
	gaf, err := formats.LoadGAF(p.files[0].Data)
	if err != nil {
		return fmt.Errorf("%s: %w", p.gaf, err)
	}
	frames := map[string]int{}
	for _, e := range gaf.Entries {
		frames[e.Name] = len(e.Frames)
	}
	for name, n := range p.sequences {
		if frames[name] != n {
			return fmt.Errorf("%s: sequence %s has %d frames, expected %d", p.gaf, name, frames[name], n)
		}
	}
	for i, s := range sections {
		if !strings.EqualFold(s.Name, p.sections[i]) {
			return fmt.Errorf("%s: section %d is %q, expected %q", p.tdf, i, s.Name, p.sections[i])
		}
		if bank, _ := s.FirstValue("filename"); !strings.EqualFold(bank, strings.TrimSuffix(filepath.Base(p.gaf), ".gaf")) {
			return fmt.Errorf("%s: %s names bank %q", p.tdf, s.Name, bank)
		}
	}
	return nil
}
