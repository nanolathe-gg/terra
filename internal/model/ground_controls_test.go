package model

import "testing"

func TestSetGroundKnobCreatesAndUpdatesStroke(t *testing.T) {
	nodes := []Node{{Kind: "hill"}}
	nodes, inserted := SetGroundKnob(nodes, "undulation", 8, 240, .35, 123)
	if !inserted || len(nodes) != 2 || nodes[0].Kind != "ground" || nodes[0].Seed != 123^0x9e37 || nodes[0].Amplitude != 8 || nodes[0].Wavelength != 240 || nodes[0].Coverage != .35 {
		t.Fatalf("created %+v", nodes)
	}
	nodes, inserted = SetGroundKnob(nodes, "undulationScale", 300, .35, .5, 123)
	if inserted || nodes[0].Wavelength != 300 {
		t.Fatalf("updated %+v", nodes)
	}
	nodes, _ = SetGroundKnob(nodes, "undulation", 0, 240, .35, 123)
	if nodes[0].Amplitude != 0 || len(nodes) != 2 {
		t.Fatalf("disabled %+v", nodes)
	}
	untouched, inserted := SetGroundKnob(nil, "undulationScale", 200, 240, .35, 123)
	if inserted || len(untouched) != 0 {
		t.Fatal("scale alone created ground")
	}
}

func TestGroundKnobsRestoresHistoryState(t *testing.T) {
	h, w, c := GroundKnobs([]Node{{Kind: "ground", Amplitude: 8, Wavelength: 300, Coverage: .35}}, 200, .45)
	if h != 8 || w != 300 || c != .35 {
		t.Fatal(h, w, c)
	}
	h, w, c = GroundKnobs(nil, 200, .45)
	if h != 0 || w != 200 || c != .45 {
		t.Fatal(h, w, c)
	}
}
