//go:build !js

package terrain

import (
	"context"
	"crypto/sha256"
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"testing"
)

func TestNativeMaterialWorlds(t *testing.T) {
	if os.Getenv("TERRAFORM_GPU_TEST") == "" {
		t.Skip("set TERRAFORM_GPU_TEST=1")
	}
	g, e := NewGPU()
	if e != nil {
		t.Fatal(e)
	}
	defer g.Close()
	sources := map[string]string{}
	for _, pattern := range []string{"../../*.wgsl", "../../materials/*.json"} {
		files, e := filepath.Glob(pattern)
		if e != nil {
			t.Fatal(e)
		}
		for _, p := range files {
			data, e := os.ReadFile(p)
			if e != nil {
				t.Fatal(e)
			}
			key, _ := filepath.Rel("../..", p)
			sources[key] = string(data)
		}
	}
	var fixture struct {
		Adapter string            `json:"adapter"`
		Worlds  map[string]string `json:"worlds"`
	}
	fixtureBytes, e := os.ReadFile("../../repro/go-renderer-fixtures.json")
	if e != nil {
		t.Fatal(e)
	}
	if e = json.Unmarshal(fixtureBytes, &fixture); e != nil {
		t.Fatal(e)
	}
	files, e := filepath.Glob("../../materials/*.json")
	if e != nil {
		t.Fatal(e)
	}
	for _, p := range files {
		var material map[string]any
		raw, e := os.ReadFile(p)
		if e != nil {
			t.Fatal(e)
		}
		if e = json.Unmarshal(raw, &material); e != nil {
			t.Fatal(e)
		}
		if material["order"] == nil {
			continue
		}
		name := filepath.Base(p)
		t.Run(name, func(t *testing.T) {
			config := map[string]any{"baseHeight": 24., "seaLevel": 0., "material": material["material"], "water": material["water"], "materialTable": "/materials/" + name, "layers": material["order"], "chunked": true}
			for k, v := range object(material, "world") {
				config[k] = v
			}
			config["grid"], config["size"] = 33, 128
			r, e := NewRenderer(g, config, sources, material)
			if e != nil {
				t.Fatal(e)
			}
			defer r.Close()
			window := SceneWindow{X: 16, Y: 16, Width: 64, Height: 64, Scale: 1}
			reg := r.RequiredRegion(window, true)
			h := make([]float32, reg.GridWidth*reg.GridHeight)
			for y := 0; y < reg.GridHeight; y++ {
				for x := 0; x < reg.GridWidth; x++ {
					h[y*reg.GridWidth+x] = float32(number(config, "baseHeight", 24) + float64(reg.GridX+x+reg.GridY+y)*float64(float32(.6)))
				}
			}
			options := DefaultDrawOptions(config)
			options.MaterialWeathering = 0
			pixels, e := r.RenderWindow(context.Background(), WindowInput{Window: window, Region: reg, Heights: h}, options)
			if e != nil {
				t.Fatal(e)
			}
			hash := fmt.Sprintf("%x", sha256.Sum256(pixels))
			t.Logf("%s RGBA SHA256 %s", name, hash)
			if g.Adapter.Info().Name == fixture.Adapter && fixture.Worlds[name] != hash {
				t.Fatalf("original browser fixture mismatch: got %s expected %s", hash, fixture.Worlds[name])
			}
		})
	}
}
