package terrain

import (
	"github.com/nanolathe-gg/terraform/internal/model"
	"reflect"
	"testing"
)

func shapeNode(kind string, x, y, radius, amount float64) model.Node {
	return model.Node{Kind: kind, Seed: 42, Points: []model.Point{{X: x, Y: y}}, Params: map[string]any{"radius": radius, "amount": amount, "rough": .2, "softness": .5}}
}
func TestChangedShapeRegionLocalEditAndGlobalGround(t *testing.T) {
	cfg := ShapeWindowConfig{Grid: 2048, Spacing: 1}
	first := shapeNode("hill", 100, 100, 25, 60)
	far := shapeNode("hill", 1600, 1600, 25, 60)
	changed := shapeNode("hill", 170, 100, 25, 60)
	r, full, err := ChangedShapeRegion([]model.Node{first, far}, []model.Node{changed, far}, cfg)
	if err != nil || full || r == nil {
		t.Fatalf("local edit: %v %v %v", r, full, err)
	}
	for _, p := range []model.Point{{X: 100, Y: 100}, {X: 170, Y: 100}} {
		if float64(r.X0) > p.X || float64(r.X1) < p.X || float64(r.Y0) > p.Y || float64(r.Y1) < p.Y {
			t.Fatalf("lost old/new extent: %+v", r)
		}
	}
	if r.X1 >= 512 || r.Y1 >= 512 {
		t.Fatalf("local edit invalidates far page: %+v", r)
	}
	same, full, err := ChangedShapeRegion([]model.Node{first}, []model.Node{first}, cfg)
	if err != nil || full || same != nil {
		t.Fatalf("unchanged: %v %v %v", same, full, err)
	}
	ground := model.Node{Kind: "ground", Seed: 1, Amplitude: 5, Wavelength: 100, Coverage: .5}
	r, full, err = ChangedShapeRegion([]model.Node{first}, []model.Node{ground, first}, cfg)
	if err != nil || !full || r == nil || *r != (CellRect{0, 0, 2047, 2047}) {
		t.Fatalf("global ground: %v %v %v", r, full, err)
	}
}
func TestChangedShapeRegionPropagatesPrefixAndSmooth(t *testing.T) {
	cfg := ShapeWindowConfig{Grid: 2048, Spacing: 1}
	low := shapeNode("hill", 300, 300, 25, 30)
	high := shapeNode("hill", 300, 300, 25, 60)
	crater := shapeNode("crater", 305, 300, 200, 70)
	r, full, err := ChangedShapeRegion([]model.Node{low, crater}, []model.Node{high, crater}, cfg)
	if err != nil || full || r == nil || r.X1 < 600 {
		t.Fatalf("prefix influence not propagated to crater: %+v full=%v err=%v", r, full, err)
	}
	smooth := shapeNode("smooth", 350, 300, 120, 100)
	r, _, err = ChangedShapeRegion([]model.Node{low, smooth}, []model.Node{high, smooth}, cfg)
	if err != nil || r == nil || r.X1 <= 330 {
		t.Fatalf("smooth influence missing: %+v %v", r, err)
	}
}

func TestChangedShapeRegionTailMatchesFullPlanner(t *testing.T) {
	c := ShapeWindowConfig{Grid: 1025, Spacing: 16, RefSpacing: 16, Defaults: map[string]any{}}
	prefix := []model.Node{shapeNode("hill", 100, 100, 90, 20), shapeNode("crater", 300, 300, 90, 20)}
	cases := [][2][]model.Node{
		{append(append([]model.Node{}, prefix...), shapeNode("hill", 900, 800, 90, 20)), append(append([]model.Node{}, prefix...), shapeNode("hill", 1100, 1000, 90, 20))},
		{prefix, append(append([]model.Node{}, prefix...), shapeNode("smooth", 900, 800, 90, 20))},
		{append(append([]model.Node{}, prefix...), shapeNode("crater", 900, 800, 90, 20)), prefix},
	}
	for i, p := range cases {
		fast, ff, fe := changedShapeRegion(p[0], p[1], c, true)
		slow, sf, se := changedShapeRegion(p[0], p[1], c, false)
		if fe != nil || se != nil || ff != sf || !reflect.DeepEqual(fast, slow) {
			t.Fatalf("case %d: fast %v/%v/%v full %v/%v/%v", i, fast, ff, fe, slow, sf, se)
		}
	}
}
