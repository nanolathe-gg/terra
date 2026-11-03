//go:build !js

package terrain

import (
	"context"
	"encoding/binary"
	"math"
	"os"
	"testing"

	"github.com/nanolathe-gg/terraform/internal/model"
)

func TestRegionalShapeCacheMatchesReplay(t *testing.T) {
	if os.Getenv("TERRAFORM_GPU_TEST") == "" {
		t.Skip("set TERRAFORM_GPU_TEST=1 for hardware test")
	}
	g, e := NewGPU()
	if e != nil {
		t.Fatal(e)
	}
	defer g.Close()
	source, e := os.ReadFile("../../engine-shape.wgsl")
	if e != nil {
		t.Fatal(e)
	}
	shape, e := NewShapeEngine(g, string(source), true)
	if e != nil {
		t.Fatal(e)
	}
	defer shape.Close()
	s := &SceneRenderer{gpu: g, shape: shape, renderer: &Renderer{Uniform: &Uniforms{}}, config: map[string]any{"gpuMB": 512.}}
	defer s.clearShapeCache()
	defer s.closeShapeGather()
	cfg := ShapeWindowConfig{Grid: 1536, Spacing: 1, RefSpacing: 1, BaseHeight: 24, MinHeight: -90, MaxHeight: 300}
	local := shapeNode("hill", 150, 150, 35, 50)
	remote := shapeNode("hill", 1100, 1100, 35, 45)
	original := []model.Node{local, remote}
	render := func(nodes []model.Node, area CellRect) *weatherFeed {
		t.Helper()
		f, e := s.buildShapeFeed(context.Background(), nodes, cfg, area)
		if e != nil {
			t.Fatal(e)
		}
		return f
	}
	a := render(original, CellRect{100, 100, 140, 140})
	a.Close()
	b := render(original, CellRect{1100, 1100, 1140, 1140})
	b.Close()
	if s.shapeRuns != 2 {
		t.Fatalf("initial pages %d", s.shapeRuns)
	}
	cachedRemote := s.shapePages[[2]int{2, 2}]
	if cachedRemote == nil {
		t.Fatal("missing remote page")
	}
	edited := []model.Node{shapeNode("hill", 170, 150, 35, 65), remote}
	b = render(edited, CellRect{1100, 1100, 1140, 1140})
	b.Close()
	if s.shapeRuns != 2 || s.shapePages[[2]int{2, 2}] != cachedRemote {
		t.Fatal("unaffected remote page was rerun")
	}
	area := CellRect{90, 90, 220, 210}
	f := render(edited, area)
	defer f.Close()
	if s.shapeRuns != 3 {
		t.Fatalf("local edit replayed %d pages", s.shapeRuns)
	}
	cfg.Window = area
	direct, e := shape.EvaluateShapeWindow(context.Background(), cfg, edited)
	if e != nil {
		t.Fatal(e)
	}
	planes, e := g.ReadBuffer(context.Background(), f.Planes, 0, uint64(f.Cells*6*4))
	if e != nil {
		t.Fatal(e)
	}
	masks, e := g.ReadBuffer(context.Background(), f.Masks, 0, uint64(f.Cells*28))
	if e != nil {
		t.Fatal(e)
	}
	for y := 0; y < direct.Height; y++ {
		for x := 0; x < direct.Width; x++ {
			i := y*direct.Width + x
			j := y*f.Grid + x
			for k, p := range direct.Planes {
				bits := binary.LittleEndian.Uint32(planes[(k*f.Cells+j)*4:])
				if bits != math.Float32bits(p[i]) {
					t.Fatalf("plane %d differs at %d,%d", k, x, y)
				}
			}
			for k, p := range direct.Masks {
				if int8(masks[j*28+k]) != p[i] {
					t.Fatalf("mask %d differs at %d,%d", k, x, y)
				}
			}
		}
	}
	changed := cfg
	changed.BaseHeight++
	b, e = s.buildShapeFeed(context.Background(), edited, changed, CellRect{1100, 1100, 1140, 1140})
	if e != nil {
		t.Fatal(e)
	}
	b.Close()
	if s.shapeRuns != 4 || s.shapePages[[2]int{2, 2}] == cachedRemote {
		t.Fatal("global setting did not invalidate remote page")
	}
}
