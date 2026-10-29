// Package featuredef reads the feature definitions (features/**/*.tdf) the
// map tools need: footprint, economy, flags and sprite names. It follows
// Nanolathe's feature compiler (internal/content, compile_feature.go) for
// these fields only, so the editor classifies and places a feature as the
// game will load it. Successor links are not resolved; the game's own map
// admission (Nanolathe tools/map-verify) checks a finished package.
package featuredef

import (
	"fmt"
	"strings"

	"github.com/nanolathe-gg/nanolathe/formats"
	"github.com/nanolathe-gg/nanolathe/vfs"
)

// Def is one feature section, with the game's defaults applied.
type Def struct {
	Name           string // section name as authored, trimmed
	Object         string // 3DO model; a sprite feature leaves it empty
	Filename       string // GAF bank under anims/, without extension
	SeqName        string
	SeqNameShad    string
	FootprintX     int32 // a 16-bit store, read sign-extended
	FootprintZ     int32
	Metal          int32 // masked to an unsigned 16-bit value
	Energy         int32
	AnimTrans      int32 // low bit only
	ShadTrans      int32
	Blocking       bool // flags keep the low bit; all default off
	Reclaimable    bool
	Indestructible bool
}

// Key is the name every feature lookup compares: the four TDF whitespace
// bytes trimmed and ASCII case folded. Bytes at or above 0x80 stay literal,
// as in the game.
func Key(name string) string { return formats.FoldASCII(trim(name)) }

func trim(s string) string {
	return formats.TrimASCIIFunc(s, func(b byte) bool { return b == ' ' || b == '\t' || b == '\r' || b == '\n' })
}

// Read walks features/ recursively and returns the definitions by Key. When
// two sections share a name, the first one read is kept; ReadDir order and
// section order make that deterministic.
func Read(fs vfs.FSOps) (map[string]*Def, error) {
	if fs == nil {
		return nil, fmt.Errorf("featuredef: nil VFS")
	}
	defs := map[string]*Def{}
	var walk func(dir string) error
	walk = func(dir string) error {
		entries, err := fs.ReadDir(dir)
		if err != nil {
			return fmt.Errorf("read feature directory %s: %w", dir, err)
		}
		for _, e := range entries {
			if e.IsDir {
				if err := walk(e.Path); err != nil {
					return err
				}
				continue
			}
			if !strings.HasSuffix(formats.FoldASCII(e.Path), ".tdf") {
				continue
			}
			data, err := fs.ReadFileLimit(e.Path, int64(formats.DefaultTDFLimits().MaxBytes))
			if err != nil {
				return fmt.Errorf("read feature definition %s: %w", e.Path, err)
			}
			doc, err := formats.ParseTDF(data)
			if err != nil {
				return formats.WithTDFContext(fs, err, e.Path)
			}
			for _, s := range doc.Root.Sections() {
				name := trim(s.OriginalName)
				if name == "" {
					name = trim(s.Name)
				}
				if name == "" {
					continue
				}
				if _, seen := defs[Key(name)]; !seen {
					defs[Key(name)] = section(s, name)
				}
			}
		}
		return nil
	}
	if err := walk("features"); err != nil {
		return nil, err
	}
	return defs, nil
}

func section(s *formats.Section, name string) *Def {
	str := func(key string) string {
		v, _ := s.StringValue(key, "")
		if len(v) > 255 {
			v = v[:255]
		}
		return v
	}
	flag := func(key string) bool { return s.IntValue(key, 0)&1 != 0 }
	return &Def{
		Name:           name,
		Object:         str("object"),
		Filename:       str("filename"),
		SeqName:        str("seqname"),
		SeqNameShad:    str("seqnameshad"),
		FootprintX:     int32(int16(s.IntValue("footprintx", 0))),
		FootprintZ:     int32(int16(s.IntValue("footprintz", 0))),
		Metal:          int32(uint16(s.IntValue("metal", 0))),
		Energy:         int32(uint16(s.IntValue("energy", 0))),
		AnimTrans:      s.IntValue("animtrans", 0) & 1,
		ShadTrans:      s.IntValue("shadtrans", 0) & 1,
		Blocking:       flag("blocking"),
		Reclaimable:    flag("reclaimable"),
		Indestructible: flag("indestructible"),
	}
}
