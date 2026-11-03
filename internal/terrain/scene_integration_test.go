//go:build !js

package terrain

import (
	"context"
	"encoding/binary"
	"encoding/json"
	"github.com/nanolathe-gg/terraform/internal/model"
	"math"
	"os"
	"path/filepath"
	"testing"
)

func TestSceneWindowAndComparison(t *testing.T) {
	if os.Getenv("TERRAFORM_GPU_TEST") == "" {
		t.Skip("set TERRAFORM_GPU_TEST=1 for hardware test")
	}
	g, e := NewGPU()
	if e != nil {
		t.Fatal(e)
	}
	defer g.Close()
	sources := map[string]string{}
	for _, name := range []string{"sculpt-vert.wgsl", "engine-shape.wgsl", "engine-feed.wgsl", "engine-frag.wgsl", "engine-common.wgsl", "engine-bake.wgsl", "engine-materials.wgsl", "engine-palette.wgsl", "engine-weather.wgsl", "engine-erosion.wgsl", "materials/palette.json"} {
		b, e := os.ReadFile(filepath.Join("../..", name))
		if e != nil {
			t.Fatal(e)
		}
		sources[name] = string(b)
	}
	b, e := os.ReadFile("../../materials/green.json")
	if e != nil {
		t.Fatal(e)
	}
	var material map[string]any
	if e = json.Unmarshal(b, &material); e != nil {
		t.Fatal(e)
	}
	config := map[string]any{"grid": 33, "size": 128, "baseHeight": 24., "seaLevel": 0., "material": material["material"], "water": material["water"]}
	for k, v := range object(material, "world") {
		config[k] = v
	}
	config["grid"], config["size"] = 33, 128
	s, e := NewSceneRenderer(g, config, sources, material)
	if e != nil {
		t.Fatal(e)
	}
	defer s.Close()
	nodes := []model.Node{{Kind: "paint", Seed: 123, Points: []model.Point{{X: 40, Y: 40}}, Params: map[string]any{"radius": 20., "amount": 50., "rough": .2, "softness": .5, "paintChannel": 3.}}}
	r, e := s.Render(context.Background(), nodes, nil, nil, SceneWindow{X: 16, Y: 16, Width: 64, Height: 64, Scale: 1, ReadHeights: true}, DrawOptions{Full: true, Detail: 1, Ring: .85, RingSpread: .65, RingVariation: .7, TransitionDetail: .65})
	if e != nil {
		t.Fatal(e)
	}
	if len(r.RGBA) != 64*64*4 || len(r.Heights) != r.HeightWidth*r.HeightHeight || r.HeightSpacing != 127./32 {
		t.Fatalf("wrong output dimensions: %+v", r)
	}
	if s.shapeRuns != 1 {
		t.Fatalf("shape runs=%d want 1", s.shapeRuns)
	}
	_, repeatErr := s.Render(context.Background(), nodes, nil, nil, SceneWindow{X: 20, Y: 20, Width: 32, Height: 32, Scale: 1}, DrawOptions{Full: true, Detail: 1, Ring: .85, RingSpread: .65, RingVariation: .7, TransitionDetail: .65})
	if repeatErr != nil {
		t.Fatal(repeatErr)
	}
	if s.shapeRuns != 1 {
		t.Fatalf("repeated view reran shape: %d", s.shapeRuns)
	}
	weather, err := s.Render(context.Background(), nodes, map[string]string{"erosionAge": "1"}, nil, SceneWindow{X: 16, Y: 16, Width: 32, Height: 32, Scale: 1, ReadHeights: true}, DrawOptions{Full: true, Detail: 1, Ring: .85, RingSpread: .65, RingVariation: .7, TransitionDetail: .65, Weather: true})
	if err != nil {
		t.Fatal(err)
	}
	if len(weather.RGBA) != 32*32*4 || len(weather.Heights) != weather.HeightWidth*weather.HeightHeight {
		t.Fatal("invalid weather output dimensions")
	}
	if s.weatherRuns != 1 {
		t.Fatalf("weather runs=%d want 1", s.weatherRuns)
	}
	_, err = s.Render(context.Background(), nodes, map[string]string{"erosionAge": "1"}, nil, SceneWindow{X: 20, Y: 20, Width: 32, Height: 32, Scale: 1}, DrawOptions{Full: true, Detail: 1, Ring: .85, RingSpread: .65, RingVariation: .7, TransitionDetail: .65, Weather: true})
	if err != nil {
		t.Fatal(err)
	}
	if s.weatherRuns != 1 {
		t.Fatalf("repeated view reran weather: %d", s.weatherRuns)
	}
	// Compare a gathered feed crossing the 512-cell page boundary to direct replay.
	seamNodes := []model.Node{{Kind: "hill", Seed: 12, Points: []model.Point{{X: 500, Y: 25}, {X: 525, Y: 30}}, Params: map[string]any{"radius": 30., "amount": 40., "rough": .2, "softness": .5}}}
	c := ShapeWindowConfig{Grid: 1025, Spacing: 1, RefSpacing: 1, BaseHeight: 24, MinHeight: -90, MaxHeight: 300, Window: CellRect{500, 12, 525, 40}}
	direct, err := s.shape.EvaluateShapeWindow(context.Background(), c, seamNodes)
	if err != nil {
		t.Fatal(err)
	}
	gathered, err := s.buildShapeFeed(context.Background(), seamNodes, c, c.Window)
	if err != nil {
		t.Fatal(err)
	}
	defer gathered.Close()
	raw, err := s.gpu.ReadBuffer(context.Background(), gathered.Planes, 0, uint64(gathered.Cells*6*4))
	if err != nil {
		t.Fatal(err)
	}
	rawMasks, err := s.gpu.ReadBuffer(context.Background(), gathered.Masks, 0, uint64(gathered.Cells*28))
	if err != nil {
		t.Fatal(err)
	}
	for y := 0; y < direct.Height; y++ {
		for x := 0; x < direct.Width; x++ {
			a := y*direct.Width + x
			b := y*gathered.Grid + x
			for k := range direct.Planes {
				v := math.Float32frombits(binary.LittleEndian.Uint32(raw[(k*gathered.Cells+b)*4:]))
				if math.Float32bits(v) != math.Float32bits(direct.Planes[k][a]) {
					t.Fatalf("cached seam plane %d at %d,%d", k, x, y)
				}
			}
			for k := range direct.Masks {
				if int8(rawMasks[b*28+k]) != direct.Masks[k][a] {
					t.Fatalf("cached seam mask %d at %d,%d", k, x, y)
				}
			}
		}
	}
	cmp, e := s.CompareRegions(context.Background(), nodes, nil)
	if e != nil {
		t.Fatal(e)
	}
	for name, p := range cmp.Repeat {
		if p.Cells != 0 {
			t.Fatalf("repeat %s: %+v", name, p)
		}
	}
	for name, p := range cmp.Regional {
		if p.Cells != 0 {
			t.Fatalf("regional %s: %+v", name, p)
		}
	}
}
