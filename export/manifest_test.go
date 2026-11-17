package main

import (
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func writeManifest(t *testing.T, manifest any) string {
	t.Helper()
	data, err := json.Marshal(manifest)
	if err != nil {
		t.Fatal(err)
	}
	name := filepath.Join(t.TempDir(), "metadata.json")
	if err := os.WriteFile(name, data, 0o644); err != nil {
		t.Fatal(err)
	}
	return name
}

// A densely filled 40x40 map (a tree on every other cell of every other row, as the editor sends it: 22 MiB) reads.
func TestReadRequestTakesADenselyFilledLargestMap(t *testing.T) {
	w, h := maxUnits*32+2, maxUnits*32+8
	heights := make([]int, w*h)
	for i := range heights {
		heights[i] = 100 + i%100
	}
	var features []featurePlacement
	for z := 0; z < maxUnits*32; z += 2 {
		for x := 0; x < maxUnits*32; x += 2 {
			features = append(features, featurePlacement{Name: fmt.Sprintf("TFab12Tree%d", (x+z)%9+1), X: x, Z: z})
		}
	}
	name := writeManifest(t, map[string]any{"name": "Sculpt map", "description": "Dense", "world": "green", "unitsX": maxUnits, "unitsY": maxUnits, "seaLevel": 64, "heights": heights, "features": features})
	req, err := readRequest(name)
	if err != nil {
		t.Fatal(err)
	}
	if len(req.Features) != len(features) || len(req.Heights) != w*h {
		t.Fatalf("read %d features and %d heights, want %d and %d", len(req.Features), len(req.Heights), len(features), w*h)
	}
}

// A manifest over the limit says so, rather than reporting the truncated JSON.
func TestReadRequestNamesAnOversizedManifest(t *testing.T) {
	name := writeManifest(t, map[string]any{"name": "Sculpt map", "description": strings.Repeat("x", 2<<20)})
	if _, err := readManifest(name, 1<<20); err == nil || !strings.Contains(err.Error(), "larger than 1 MiB") {
		t.Fatalf("got %v, want an error naming the size", err)
	}
	if _, err := readManifest(name, 3<<20); err != nil {
		t.Fatal(err)
	}
}
