package model

import "testing"

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
