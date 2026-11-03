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

func TestSceneGeometryValidation(t *testing.T) {
	geometry := func() map[string]any {
		return map[string]any{"unitsX": float64(1), "unitsY": float64(1), "widthCells": float64(34), "heightCells": float64(40), "width": float64(544), "height": float64(640), "playRight": float64(512), "playBottom": float64(512)}
	}
	if err := validateSceneGeometry(geometry(), 800, 400); err != nil {
		t.Fatal(err)
	}
	for _, tc := range []struct {
		key   string
		value float64
	}{
		{"unitsX", -1}, {"unitsY", 41}, {"unitsX", 1.5}, {"width", 1000000000}, {"heightCells", 999999999}, {"playRight", 0},
	} {
		g := geometry()
		g[tc.key] = tc.value
		if err := validateSceneGeometry(g, 800, 400); err == nil {
			t.Errorf("accepted %s=%g", tc.key, tc.value)
		}
	}
	if err := validateSceneGeometry(geometry(), 800, 399); err == nil {
		t.Error("accepted inconsistent grid")
	}
}

func TestSceneExportWeatherIgnoresViewToggle(t *testing.T) {
	yes, no := true, false
	if !sceneExportWeather(false, &yes) || sceneExportWeather(true, &no) || !sceneExportWeather(true, nil) {
		t.Fatal("export weather should follow weather setting, independent of preview")
	}
}

func TestSceneDefaultScree(t *testing.T) {
	config := map[string]any{"defaults": map[string]any{"scree": "70"}}
	if got := sceneDefaultScree(config, nil); got != .7 {
		t.Fatalf("default scree=%g", got)
	}
	config["engineDefaults"] = map[string]any{"scree": "40"}
	if got := sceneDefaultScree(config, map[string]any{"scree": float64(20)}); got != .2 {
		t.Fatalf("recipe scree=%g", got)
	}
}

func TestSceneRefinementSeedMatchesEditorDefaults(t *testing.T) {
	seed, refinement := uint32(42), uint32(7)
	if got := sceneRefinementSeed(nil, nil); got != 2701 {
		t.Fatalf("default = %d", got)
	}
	if got := sceneRefinementSeed(&seed, nil); got != seed {
		t.Fatalf("seed fallback = %d", got)
	}
	if got := sceneRefinementSeed(&seed, &refinement); got != refinement {
		t.Fatalf("override = %d", got)
	}
}
