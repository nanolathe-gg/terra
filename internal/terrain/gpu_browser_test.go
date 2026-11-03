//go:build js && wasm

package terrain

import (
	"context"
	"crypto/sha256"
	"encoding/json"
	"github.com/gogpu/wgpu"
	"io"
	"net/http"
	"syscall/js"
	"testing"
)

func TestBrowserValidationScope(t *testing.T) {
	g, e := NewGPU()
	if e != nil {
		t.Fatal(e)
	}
	defer g.Close()
	g.Device.PushErrorScope(wgpu.ErrorFilterValidation)
	b, e := g.Device.CreateBuffer(&wgpu.BufferDescriptor{Label: "intentional invalid usage", Size: 16, Usage: 0})
	if b != nil {
		defer b.Release()
	}
	if e != nil {
		t.Log(e)
	}
	if validation := g.Device.PopErrorScope(); validation == nil {
		t.Fatal("invalid GPU buffer escaped error scope")
	} else {
		t.Logf("captured expected validation: %s", validation.Message)
	}
}
func TestBrowserTerrain(t *testing.T) {
	g, e := NewGPU()
	if e != nil {
		t.Fatal(e)
	}
	defer g.Close()
	origin := js.Global().Get("location").Get("origin").String()
	sources := map[string]string{}
	for _, name := range []string{"sculpt-vert.wgsl", "engine-common.wgsl", "engine-frag.wgsl", "engine-bake.wgsl", "engine-materials.wgsl", "engine-palette.wgsl", "engine-weather.wgsl", "engine-erosion.wgsl", "engine-feed.wgsl", "materials/palette.json", "materials/green.json"} {
		res, e := http.Get(origin + "/" + name)
		if e != nil {
			t.Fatal(e)
		}
		data, e := io.ReadAll(res.Body)
		res.Body.Close()
		if e != nil {
			t.Fatal(e)
		}
		sources[name] = string(data)
	}
	var material map[string]any
	if e = json.Unmarshal([]byte(sources["materials/green.json"]), &material); e != nil {
		t.Fatal(e)
	}
	config := map[string]any{"grid": 33, "size": 128, "baseHeight": 24., "seaLevel": 0., "material": material["material"], "water": material["water"], "chunked": true}
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
			h[y*reg.GridWidth+x] = 24 + float32(reg.GridX+x+reg.GridY+y)*.6
		}
	}
	p, e := r.RenderWindow(context.Background(), WindowInput{Window: window, Region: reg, Heights: h}, DrawOptions{Full: true, Detail: 1, Ring: .85, RingSpread: .65, RingVariation: .7, TransitionDetail: .65})
	if e != nil {
		t.Fatal(e)
	}
	different := false
	for i := 4; i < len(p); i++ {
		different = different || p[i] != p[i%4]
	}
	if !different {
		t.Fatal("browser terrain is a flat clear color")
	}
	t.Logf("browser chunk %d bytes SHA256 %x", len(p), sha256.Sum256(p))
}
