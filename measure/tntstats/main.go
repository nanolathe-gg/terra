// tntstats prints, for every installed retail TNT, its size and how many distinct 32x32 tiles it stores (numbers only; nothing is written).
//
//	go run ./measure/tntstats [--root DIR]...
//
// Columns: map name, width x height in cells (the play area is 2 cells narrower and 8 shorter), units per side (width/32, height/32), tile slots,
// the header's tile count, and the distinct tile count after comparing tile bytes. TNT stores 16-pixel cells; a tile is 2x2 cells.
package main

import (
	"crypto/sha256"
	"encoding/binary"
	"flag"
	"fmt"
	"io"
	"os"
	"path"
	"strings"

	"github.com/nanolathe-gg/nanolathe/vfs"
)

type roots []string

func (r *roots) String() string     { return strings.Join(*r, ",") }
func (r *roots) Set(v string) error { *r = append(*r, v); return nil }

func main() {
	var rs roots
	flag.Var(&rs, "root", "content root (repeatable); default ~/TotalAnnihilation")
	flag.Parse()
	if len(rs) == 0 {
		home, _ := os.UserHomeDir()
		rs = roots{home + "/TotalAnnihilation"}
	}
	fs := vfs.New()
	if err := fs.MountGameDirectories(rs); err != nil {
		fmt.Fprintln(os.Stderr, err)
		os.Exit(1)
	}
	entries, err := fs.ReadDir("maps")
	if err != nil {
		fmt.Fprintln(os.Stderr, err)
		os.Exit(1)
	}
	seen := map[string]bool{}
	for _, e := range entries {
		if e.IsDir || strings.ToLower(path.Ext(e.Path)) != ".tnt" || seen[strings.ToLower(e.Path)] {
			continue
		}
		seen[strings.ToLower(e.Path)] = true
		f, err := fs.Open(e.Path)
		if err != nil {
			continue
		}
		var h [0x40]byte
		if _, err := io.ReadFull(f, h[:]); err != nil || binary.LittleEndian.Uint32(h[:4]) != 0x2000 {
			f.Close()
			continue
		}
		w, hh := int(binary.LittleEndian.Uint32(h[4:])), int(binary.LittleEndian.Uint32(h[8:]))
		mapData, tileGfx, tiles := int64(binary.LittleEndian.Uint32(h[12:])), int64(binary.LittleEndian.Uint32(h[20:])), int(binary.LittleEndian.Uint32(h[24:]))
		distinct := map[[32]byte]bool{}
		buf := make([]byte, 1024)
		for i := 0; i < tiles; i++ {
			if _, err := f.ReadAt(buf, tileGfx+int64(i)*1024); err != nil {
				break
			}
			distinct[sha256.Sum256(buf)] = true
		}
		f.Close()
		_ = mapData
		name := strings.TrimSuffix(path.Base(strings.ReplaceAll(e.Path, `\`, "/")), path.Ext(e.Path))
		fmt.Printf("%s\t%d\t%d\t%.1f\t%.1f\t%d\t%d\t%d\n", name, w, hh, float64(w-2)/32, float64(hh-8)/32, (w/2)*(hh/2), tiles, len(distinct))
	}
}
