package main

import (
	"github.com/nanolathe-gg/terraform/internal/server"
	"github.com/nanolathe-gg/terraform/internal/terrain"
	"os"
	"path/filepath"
	"testing"
)

func TestSampleNativeHeight(t *testing.T) {
	r := &terrain.SceneResult{Heights: []float32{-10, 10, 20, 300}, HeightWidth: 2, HeightHeight: 2, HeightOriginX: 32, HeightOriginY: 64, HeightSpacing: 16}
	for _, test := range []struct {
		x, y float64
		want int
	}{{32, 64, 0}, {48, 80, 255}, {40, 72, 80}} {
		v, e := sampleNativeHeight(r, test.x, test.y)
		if e != nil || v != test.want {
			t.Fatalf("(%g,%g) = %d, %v; want %d", test.x, test.y, v, e, test.want)
		}
	}
	if _, e := sampleNativeHeight(r, 31, 64); e == nil {
		t.Fatal("accepted coordinates outside readback")
	}
}
func TestNativeExportStreamsTileFiles(t *testing.T) {
	root := t.TempDir()
	helper := filepath.Join(root, "helper")
	script := `#!/bin/sh
printf '%s\n' '{"ready":true,"maxChunkSide":512}'
while IFS= read -r line; do
 case "$line" in
 *'"finish"'*) printf '%s\n' '{"archive":"map.ufo","indexed":"map.png"}'; exit 0;;
 *'"chunk"'*) printf '%s\n' '{"accepted":true}';;
 *) exit 1;;
 esac
done
`
	if e := os.WriteFile(helper, []byte(script), 0700); e != nil {
		t.Fatal(e)
	}
	tile := filepath.Join(root, "tile.png")
	if e := os.WriteFile(tile, []byte("tile"), 0600); e != nil {
		t.Fatal(e)
	}
	out := filepath.Join(root, "out")
	if e := os.Mkdir(out, 0700); e != nil {
		t.Fatal(e)
	}
	o := server.Options{ExportTool: helper, AssetsRoot: root, Prepared: true}
	geo := map[string]any{"unitsX": float64(1), "unitsY": float64(1)}
	if e := exportNative(o, out, "green", 0, geo, nil, []int{1}, []nativeTile{{0, 0, 512, 512, tile}}); e != nil {
		t.Fatal(e)
	}
}
