package model

import (
	"reflect"
	"testing"
)

func TestFillFeaturesDeterministicAndBounded(t *testing.T) {
	defs := []FeatureDefinition{{Name: "TREE", Kind: "tree", FootprintX: 2, FootprintZ: 2, Uses: 10}}
	region := FeatureRegion{Type: "flood", X: 8, Z: 8}
	fill := FeatureFill{Kind: "tree", Density: 100, Seed: 12, Gap: 1}
	sample := func(x, z float64) float64 { return 20 }
	a, e := FillFeatures(16, 16, 0, sample, defs, nil, nil, "", region, fill)
	if e != nil || len(a) == 0 {
		t.Fatalf("%v %v", a, e)
	}
	b, e := FillFeatures(16, 16, 0, sample, defs, nil, nil, "", region, fill)
	if e != nil || !reflect.DeepEqual(a, b) {
		t.Fatal("fill changed across runs")
	}
	for i, p := range a {
		if p.X < 0 || p.Z < 0 || p.X+2 > 16 || p.Z+2 > 16 {
			t.Fatal(p)
		}
		for _, q := range a[:i] {
			if p.X < q.X+3 && p.X+3 > q.X && p.Z < q.Z+3 && p.Z+3 > q.Z {
				t.Fatalf("gap violated: %v %v", p, q)
			}
		}
	}
	dry, e := FillFeatures(16, 16, 20, sample, defs, nil, nil, "", region, fill)
	if e != nil || len(dry) != 0 {
		t.Fatal("filled submerged ground")
	}
}
func TestFeatureBoundsExplicitZeroRadius(t *testing.T) {
	r := FeatureRegion{Type: "brush", Points: []FeaturePoint{{80, 80}}, Radius: 0, RadiusSet: true}
	b, e := FeatureRegionBounds(r, 100, 100, 128)
	if e != nil || b != (FeatureBounds{5, 5, 6, 6}) {
		t.Fatalf("explicit zero radius: %+v %v", b, e)
	}
	r.RadiusSet = false
	b, e = FeatureRegionBounds(r, 100, 100, 128)
	if e != nil || b.X0 >= 5 || b.X1 <= 6 {
		t.Fatalf("omitted radius: %+v %v", b, e)
	}
}
