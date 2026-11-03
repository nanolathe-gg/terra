package model

import (
	"errors"
	"testing"
)

func TestPlacementsAndStarts(t *testing.T) {
	s := NewPlacementStore(32, 32, []FeatureDefinition{{Name: "tree", Kind: "tree", FootprintX: 2, FootprintZ: 2}, {Name: "metal", Kind: "deposit", FootprintX: 1, FootprintZ: 1}}, "metal")
	if _, e := s.Add("tree", 1, 1); e != nil {
		t.Fatal(e)
	}
	if _, e := s.Add("tree", 2, 2); e == nil {
		t.Fatal("accepted overlapping footprint")
	}
	if _, e := s.Add("tree", 31, 31); e == nil {
		t.Fatal("accepted out-of-bounds footprint")
	}
	if _, e := s.AddStart(FeaturePoint{128, 128}); e == nil {
		t.Fatal("accepted duplicate start")
	}
	if _, e := s.MoveStart(0, FeaturePoint{64, 64}); e != nil {
		t.Fatal(e)
	}
	if e := s.RemoveStart(1); e != nil {
		t.Fatal(e)
	}
	if e := s.RemoveStart(0); e == nil {
		t.Fatal("removed last start")
	}
}
func TestDepositRemovesOnlyNearbyGeneratedFeatures(t *testing.T) {
	s := NewPlacementStore(32, 32, []FeatureDefinition{{Name: "tree", Kind: "tree", FootprintX: 1, FootprintZ: 1}, {Name: "metal", Kind: "deposit", FootprintX: 1, FootprintZ: 1}}, "metal")
	s.Margin = 32
	s.Features = []FeaturePlacement{{"tree", 4, 4}, {"tree", 20, 20}, {"tree", 5, 4}}
	s.Generated[featureKey(s.Features[0])] = true
	s.Generated[featureKey(s.Features[1])] = true
	removed, e := s.Add("metal", 4, 5)
	if e != nil || removed != 1 {
		t.Fatalf("removed=%d error=%v", removed, e)
	}
	if len(s.Features) != 3 || s.Features[0].X != 20 || s.Features[1].X != 5 {
		t.Fatalf("wrong survivors: %+v", s.Features)
	}
}

func TestSetMarginRemovesNearbyGeneratedOnly(t *testing.T) {
	s := NewPlacementStore(32, 32, []FeatureDefinition{{Name: "tree", Kind: "tree", FootprintX: 1, FootprintZ: 1}}, "")
	s.Features = []FeaturePlacement{{"tree", 10, 8}, {"tree", 9, 8}, {"tree", 20, 20}}
	s.Generated[featureKey(s.Features[0])] = true
	s.Generated[featureKey(s.Features[2])] = true
	if n := s.SetMargin(48); n != 1 {
		t.Fatalf("removed %d features", n)
	}
	if len(s.Features) != 2 || s.Features[0].X != 9 || s.Features[1].X != 20 {
		t.Fatalf("wrong survivors: %+v", s.Features)
	}
}

func TestFeatureFillYieldCanCancel(t *testing.T) {
	stop := errors.New("stop")
	_, err := FillFeaturesYield(32, 32, 0, func(x, z float64) float64 { return 100 },
		[]FeatureDefinition{{Name: "tree", Kind: "tree", FootprintX: 1, FootprintZ: 1}}, nil, nil, "",
		FeatureRegion{Type: "flood", X: 20, Z: 20}, FeatureFill{Kind: "tree", Density: 10},
		func() error { return stop })
	if !errors.Is(err, stop) {
		t.Fatalf("expected cancellation, got %v", err)
	}
}
