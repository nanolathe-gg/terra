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
	"strings"
	"testing"
	"time"
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
	normalStart := time.Now()
	_, err = s.Render(context.Background(), nodes, map[string]string{"erosionAge": "1"}, nil, SceneWindow{X: 16, Y: 16, Width: 32, Height: 32, Scale: 1, ReadHeights: true}, DrawOptions{Full: true, Detail: 1, Ring: .85, RingSpread: .65, RingVariation: .7, TransitionDetail: .65, Weather: true})
	if err != nil {
		t.Fatal(err)
	}
	normalElapsed := time.Since(normalStart)
	start := time.Now()
	only, err := s.Render(context.Background(), nodes, map[string]string{"erosionAge": "1"}, nil, SceneWindow{X: 16, Y: 16, Width: 32, Height: 32, Scale: 1, HeightsOnly: true}, DrawOptions{Full: true, Detail: 1, Ring: .85, RingSpread: .65, RingVariation: .7, TransitionDetail: .65, Weather: true})
	if err != nil {
		t.Fatal(err)
	}
	elapsedOnly := time.Since(start)
	if len(only.RGBA) != 0 || len(only.Heights) != only.HeightWidth*only.HeightHeight || s.renderer.FieldsTexture != nil || s.renderer.Color != nil || s.renderer.Depth != nil {
		t.Fatal("height-only render allocated a color, depth or relief target")
	}
	for y := 0; y < only.HeightHeight; y++ {
		for x := 0; x < only.HeightWidth; x++ {
			wx := only.HeightOriginX + float64(x)*only.HeightSpacing
			wy := only.HeightOriginY + float64(y)*only.HeightSpacing
			ix := int(math.Round((wx - weather.HeightOriginX) / weather.HeightSpacing))
			iy := int(math.Round((wy - weather.HeightOriginY) / weather.HeightSpacing))
			if ix < 0 || iy < 0 || ix >= weather.HeightWidth || iy >= weather.HeightHeight {
				t.Fatal("normal render does not cover height-only sample")
			}
			if math.Float32bits(only.Heights[y*only.HeightWidth+x]) != math.Float32bits(weather.Heights[iy*weather.HeightWidth+ix]) {
				t.Fatalf("height-only sample differs at %d,%d", x, y)
			}
		}
	}
	t.Logf("normal warm weathered tile: %s; height-only warm tile: %s, %dx%d samples", normalElapsed, elapsedOnly, only.HeightWidth, only.HeightHeight)
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
	// A 40x40 map height tile stays bounded to its requested native lattice.
	oldSize, oldGrid := s.renderer.Size, s.renderer.Grid
	s.renderer.Size, s.renderer.Grid = 20768, 10384
	start = time.Now()
	large, err := s.Render(context.Background(), nil, nil, nil, SceneWindow{X: 10000, Y: 10000, Width: 256, Height: 256, Scale: 1, HeightsOnly: true}, DrawOptions{})
	if err != nil {
		t.Fatal(err)
	}
	largeElapsed := time.Since(start)
	profile := s.LastRenderProfile()
	if large.HeightWidth > 132 || large.HeightHeight > 132 || len(large.RGBA) != 0 || profile.FieldWidth != 0 || profile.WorkingBytes > 64*1024*1024 {
		t.Fatalf("unbounded large height tile: %dx%d %+v", large.HeightWidth, large.HeightHeight, profile)
	}
	t.Logf("40x40 height tile: %s, %dx%d samples, %d working bytes", largeElapsed, large.HeightWidth, large.HeightHeight, profile.WorkingBytes)
	s.renderer.Size, s.renderer.Grid = oldSize, oldGrid
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

func TestSceneBudgetChangeBoundsPages(t *testing.T) {
	if os.Getenv("TERRAFORM_GPU_TEST") == "" {
		t.Skip("set TERRAFORM_GPU_TEST=1 for hardware test")
	}
	gpu, err := NewGPU()
	if err != nil {
		t.Fatal(err)
	}
	defer gpu.Close()
	sources := map[string]string{}
	for _, name := range []string{"sculpt-vert.wgsl", "engine-shape.wgsl", "engine-feed.wgsl", "engine-frag.wgsl", "engine-common.wgsl", "engine-bake.wgsl", "engine-materials.wgsl", "engine-palette.wgsl", "engine-weather.wgsl", "engine-erosion.wgsl", "materials/palette.json"} {
		b, e := os.ReadFile(filepath.Join("../..", name))
		if e != nil {
			t.Fatal(e)
		}
		sources[name] = string(b)
	}
	b, err := os.ReadFile("../../materials/green.json")
	if err != nil {
		t.Fatal(err)
	}
	var material map[string]any
	if err = json.Unmarshal(b, &material); err != nil {
		t.Fatal(err)
	}
	config := map[string]any{"grid": 257, "size": 512, "baseHeight": 24., "seaLevel": 0., "gpuMB": 512., "material": material["material"], "water": material["water"]}
	s, err := NewSceneRenderer(gpu, config, sources, material)
	if err != nil {
		t.Fatal(err)
	}
	defer s.Close()
	nodes := []model.Node{{Kind: "hill", Seed: 123, Points: []model.Point{{X: 100, Y: 100}, {X: 180, Y: 140}}, Params: map[string]any{"radius": 50., "amount": 70., "rough": .2, "softness": .5}}}
	window := SceneWindow{X: 64, Y: 64, Width: 128, Height: 128, Scale: 1, ReadHeights: true}
	options := DrawOptions{Full: true, Weather: true, Detail: 1, Ring: .85, RingSpread: .65, RingVariation: .7, TransitionDetail: .65}
	if _, err = s.Render(context.Background(), nodes, map[string]string{"erosionAge": "1"}, nil, window, options); err != nil {
		t.Fatal(err)
	}
	// The canonical weather page exceeds one cache share, but fits the
	// pooled retention budget and must be reused by the next visible tile.
	if err = s.UpdateConfig(map[string]any{"uiBitmapBytes": float64(186 * 1024 * 1024)}); err != nil {
		t.Fatal(err)
	}
	if _, err = s.Render(context.Background(), nodes, map[string]string{"erosionAge": "1"}, nil, window, options); err != nil {
		t.Fatal(err)
	}
	runs := s.weatherRuns
	if len(s.weatherPages) != 1 || pageCacheBytes(s.weatherPages) <= s.cacheBudget() {
		t.Fatal("fixture did not exercise pooled weather cache")
	}
	if _, err = s.Render(context.Background(), nodes, map[string]string{"erosionAge": "1"}, nil, window, options); err != nil {
		t.Fatal(err)
	}
	if s.weatherRuns != runs {
		t.Fatal("whole-map weather replay repeated on cache hit")
	}
	if err = s.UpdateConfig(map[string]any{"uiBitmapBytes": 0.}); err != nil {
		t.Fatal(err)
	}
	before := s.cacheResidentBytes()
	if before <= 0 {
		t.Fatal("expected retained pages")
	}
	if err = s.UpdateConfig(map[string]any{"gpuMB": 128.}); err != nil {
		t.Fatal(err)
	}
	if n := s.cacheResidentBytes(); n > 2*s.cacheBudget() {
		t.Fatalf("budget update retained %d bytes beyond the cache limits", n)
	}
	result, err := s.Render(context.Background(), nodes, map[string]string{"erosionAge": "1"}, nil, window, options)
	if err != nil {
		if !strings.Contains(err.Error(), "budget") {
			t.Fatalf("unexpected budget refusal: %v", err)
		}
		t.Logf("128 MiB tile safely refused: %v", err)
	} else if len(result.RGBA) != window.Width*window.Height*4 {
		t.Fatal("invalid tile output")
	}
	shapeBytes, weatherBytes := 0, 0
	for _, p := range s.shapePages {
		shapeBytes += p.bytes
	}
	for _, p := range s.weatherPages {
		weatherBytes += p.bytes
	}
	if shapeBytes > s.cacheBudget() || weatherBytes > s.cacheBudget() {
		t.Fatalf("page budgets exceeded: authored=%d weather=%d limit=%d", shapeBytes, weatherBytes, s.cacheBudget())
	}
	if err == nil && s.LastRenderProfile().WorkingBytes > 128*1024*1024 {
		t.Fatalf("tile exceeded 128 MiB: %+v", s.LastRenderProfile())
	}
	budget128 := s.cacheBudget()
	// Refuse an impossible working set before touching retained textures/buffers.
	if err = s.UpdateConfig(map[string]any{"gpuBudgetBytes": 1}); err != nil {
		t.Fatal(err)
	}
	region := s.renderer.RequiredRegion(window, true)
	heights := make([]float32, region.GridWidth*region.GridHeight)
	resourcesBefore := len(s.renderer.resources)
	heightBefore := s.renderer.HeightTexture
	_, err = s.renderer.RenderWindow(context.Background(), WindowInput{Window: window, Region: region, Heights: heights}, options)
	if err == nil || !strings.Contains(err.Error(), "budget") {
		t.Fatalf("expected preallocation refusal, got %v", err)
	}
	if len(s.renderer.resources) != resourcesBefore || s.renderer.HeightTexture != heightBefore {
		t.Fatal("budget refusal changed GPU working allocations")
	}
	t.Logf("retained before=%d, after authored=%d weather=%d, per-cache budget=%d", before, shapeBytes, weatherBytes, budget128)
}
