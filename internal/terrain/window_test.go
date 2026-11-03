package terrain

import (
	"context"
	"github.com/nanolathe-gg/terraform/internal/model"
	"os"
	"testing"
)

func TestGPUEmptyShapeWindow(t *testing.T) {
	g, e := NewGPU()
	if e != nil {
		t.Skipf("GPU unavailable: %v", e)
	}
	defer g.Close()
	src, e := os.ReadFile("../../engine-shape.wgsl")
	if e != nil {
		t.Fatal(e)
	}
	s, e := NewShapeEngine(g, string(src), true)
	if e != nil {
		t.Fatal(e)
	}
	defer s.Close()
	r, e := s.EvaluateShapeWindow(context.Background(), ShapeWindowConfig{Grid: 16, Spacing: 1, BaseHeight: 24, MinHeight: 0, MaxHeight: 255, Window: CellRect{2, 3, 9, 10}}, nil)
	if e != nil {
		t.Fatal(e)
	}
	if r.Width != 8 || r.Height != 8 {
		t.Fatalf("wrong dimensions %dx%d", r.Width, r.Height)
	}
	for i, v := range r.Planes[0] {
		if v != 24 {
			t.Fatalf("height[%d]=%v", i, v)
		}
	}
}
func TestGPURegionalPaintMatchesWhole(t *testing.T) {
	g, e := NewGPU()
	if e != nil {
		t.Skipf("GPU unavailable: %v", e)
	}
	defer g.Close()
	src, e := os.ReadFile("../../engine-shape.wgsl")
	if e != nil {
		t.Fatal(e)
	}
	s, e := NewShapeEngine(g, string(src), true)
	if e != nil {
		t.Fatal(e)
	}
	defer s.Close()
	n := model.Node{Kind: "paint", Seed: 123, Points: []model.Point{{X: 10, Y: 10}, {X: 50, Y: 40}}, Params: map[string]any{"radius": 12.0, "amount": 50.0, "rough": .2, "softness": .5, "outlineVar": 1.0, "widthVar": 1.0, "heightVar": 1.0, "maskAmount": 1.0, "paintChannel": 3.0}}
	c := ShapeWindowConfig{Grid: 64, Spacing: 1, BaseHeight: 24, MinHeight: 0, MaxHeight: 255, Window: CellRect{0, 0, 63, 63}}
	whole, e := s.EvaluateShapeWindow(context.Background(), c, []model.Node{n})
	if e != nil {
		t.Fatal(e)
	}
	changed := false
	for _, v := range whole.Masks[2] {
		if v != 0 {
			changed = true
			break
		}
	}
	if !changed {
		t.Fatal("paint wrote no mask")
	}
	c.Window = CellRect{13, 17, 36, 42}
	part, e := s.EvaluateShapeWindow(context.Background(), c, []model.Node{n})
	if e != nil {
		t.Fatal(e)
	}
	for y := 0; y < part.Height; y++ {
		for x := 0; x < part.Width; x++ {
			a, b := y*part.Width+x, (y+17)*whole.Width+x+13
			for p := range part.Planes {
				if part.Planes[p][a] != whole.Planes[p][b] {
					t.Fatalf("plane %d mismatch at %d,%d", p, x, y)
				}
			}
			for p := range part.Masks {
				if part.Masks[p][a] != whole.Masks[p][b] {
					t.Fatalf("mask %d mismatch at %d,%d (%d vs %d)", p, x, y, part.Masks[p][a], whole.Masks[p][b])
				}
			}
		}
	}
}
func TestGPURegionalPlateauReadsOutsideWindow(t *testing.T) {
	g, e := NewGPU()
	if e != nil {
		t.Skipf("GPU unavailable: %v", e)
	}
	defer g.Close()
	src, e := os.ReadFile("../../engine-shape.wgsl")
	if e != nil {
		t.Fatal(e)
	}
	s, e := NewShapeEngine(g, string(src), true)
	if e != nil {
		t.Fatal(e)
	}
	defer s.Close()
	q := map[string]any{"radius": 25.0, "amount": 30.0, "rough": .2, "softness": .5, "outlineVar": 1.0, "widthVar": 1.0, "heightVar": 1.0}
	nodes := []model.Node{{Kind: "ground", Seed: 19, Amplitude: 6, Wavelength: 50, Coverage: 1}, {Kind: "plateau", Seed: 123, Points: []model.Point{{X: 16, Y: 20}, {X: 46, Y: 35}}, Params: q}}
	c := ShapeWindowConfig{Grid: 64, Spacing: 1, BaseHeight: 24, MinHeight: 0, MaxHeight: 255, Window: CellRect{0, 0, 63, 63}}
	whole, e := s.EvaluateShapeWindow(context.Background(), c, nodes)
	if e != nil {
		t.Fatal(e)
	}
	c.Window = CellRect{34, 26, 55, 45}
	part, e := s.EvaluateShapeWindow(context.Background(), c, nodes)
	if e != nil {
		t.Fatal(e)
	}
	for y := 0; y < part.Height; y++ {
		for x := 0; x < part.Width; x++ {
			a, b := y*part.Width+x, (y+26)*whole.Width+x+34
			for p := range part.Planes {
				if part.Planes[p][a] != whole.Planes[p][b] {
					t.Fatalf("plane %d mismatch at %d,%d: %v vs %v", p, x, y, part.Planes[p][a], whole.Planes[p][b])
				}
			}
		}
	}
}
